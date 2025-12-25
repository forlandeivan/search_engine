import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { createHash, randomBytes, timingSafeEqual, randomUUID } from "crypto";
import { db } from "./db";
import {
  skills,
  skillKnowledgeBases,
  knowledgeBases,
  skillExecutionModes,
  skillRagModes,
  skillTranscriptionModes,
  skillTranscriptionFlowModes,
  noCodeAuthTypes,
  chatSessions,
} from "@shared/schema";
import type { SkillDto, SkillRagConfig, CreateSkillPayload } from "@shared/skills";
import type {
  SkillExecutionMode,
  SkillMode,
  SkillRagMode,
  SkillTranscriptionMode,
  SkillTranscriptionFlowMode,
  SkillStatus,
  NoCodeAuthType,
} from "@shared/schema";
import { adjustWorkspaceObjectCounters } from "./usage/usage-service";
import { getUsagePeriodForDate } from "./usage/usage-types";
import { workspaceOperationGuard } from "./guards/workspace-operation-guard";
import { mapDecisionToPayload, OperationBlockedError } from "./guards/errors";
import { ensureModelAvailable, ModelValidationError, ModelUnavailableError } from "./model-service";
import { workspacePlanService } from "./workspace-plan-service";

export class SkillServiceError extends Error {
  public status: number;
  public code?: string;

  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = "SkillServiceError";
    this.status = status;
    this.code = code;
  }
}

type SkillRow = typeof skills.$inferSelect;
type KnowledgeBaseRelationRow = { knowledgeBaseId: string };
type KnowledgeBaseIdRow = { id: string };
type SkillKnowledgeBaseLinkRow = { skillId: string; knowledgeBaseId: string };
type EditableSkillColumns = Pick<
  SkillRow,
  | "name"
  | "description"
  | "systemPrompt"
  | "modelId"
  | "llmProviderConfigId"
  | "collectionName"
  | "icon"
  | "status"
  | "executionMode"
  | "mode"
  | "transcriptionFlowMode"
  | "onTranscriptionMode"
  | "onTranscriptionAutoActionId"
  | "noCodeEndpointUrl"
  | "noCodeAuthType"
  | "noCodeBearerToken"
  | "noCodeCallbackKey"
  | "contextInputLimit"
>;

function generateCallbackKey(): string {
  return randomUUID();
}

type RagConfigInput = CreateSkillPayload["ragConfig"];

type SkillEditableInput = Partial<EditableSkillColumns> & {
  knowledgeBaseIds?: string[];
  ragConfig?: RagConfigInput;
};

type NormalizedSkillEditableInput = Omit<SkillEditableInput, "ragConfig"> & {
  executionMode?: SkillExecutionMode;
  mode?: SkillMode;
  transcriptionFlowMode?: SkillTranscriptionFlowMode;
  ragConfig?: SkillRagConfig;
  contextInputLimit?: number | null;
};

const DEFAULT_RAG_CONFIG: SkillRagConfig = {
  mode: "all_collections",
  collectionIds: [],
  topK: 5,
  minScore: 0.7,
  maxContextTokens: 3000,
  showSources: true,
  bm25Weight: null,
  bm25Limit: null,
  vectorWeight: null,
  vectorLimit: null,
  embeddingProviderId: null,
  llmTemperature: null,
  llmMaxTokens: null,
  llmResponseFormat: null,
};
// Режим выполнения фиксируем отдельным полем в skills, чтобы менять маршрут без изменения остальных настроек.
const DEFAULT_SKILL_EXECUTION_MODE: SkillExecutionMode = "standard";
const DEFAULT_SKILL_MODE: SkillMode = "rag";
const DEFAULT_TRANSCRIPTION_FLOW_MODE: SkillTranscriptionFlowMode = "standard";
const DEFAULT_TRANSCRIPTION_MODE: SkillTranscriptionMode = "raw_only";
const DEFAULT_CONTEXT_INPUT_LIMIT: number | null = null;
const CALLBACK_UNAUTHORIZED_CODE = "CALLBACK_UNAUTHORIZED";

function hashCallbackToken(token: string): { token: string; hash: string; lastFour: string; rotatedAt: Date } {
  const rawToken = token.trim();
  const hash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const lastFour = rawToken.slice(-4);
  return { token: rawToken, hash, lastFour, rotatedAt: new Date() };
}

function generateCallbackToken(): { token: string; hash: string; lastFour: string; rotatedAt: Date } {
  const rawToken = randomBytes(32).toString("hex");
  return hashCallbackToken(rawToken);
}

function timingSafeHashEquals(expectedHex: string, actualHex: string): boolean {
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = Buffer.from(actualHex, "hex");
    if (expected.length === 0 || expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeCollectionIds(ids: readonly string[] | undefined): string[] {
  if (!ids || ids.length === 0) {
    return [];
  }

  const unique = new Set<string>();
  for (const entry of ids) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }

  // TODO(forlandeivan): validate that each collection belongs to the workspace before saving.
  return Array.from(unique);
}

async function assertNoCodeFlowAllowed(workspaceId: string): Promise<void> {
  const allowed = await workspacePlanService.isNoCodeFlowEnabled(workspaceId);
  if (!allowed) {
    throw new SkillServiceError("No-code режим недоступен на текущем тарифе", 403, "NO_CODE_NOT_ALLOWED");
  }
}

const isSkillRagMode = (value: unknown): value is SkillRagMode =>
  typeof value === "string" &&
  skillRagModes.includes(value as SkillRagMode);

const normalizeRagModeFromValue = (value: unknown): SkillRagMode =>
  isSkillRagMode(value) ? value : DEFAULT_RAG_CONFIG.mode;

const isSkillTranscriptionMode = (value: unknown): value is SkillTranscriptionMode =>
  typeof value === "string" && skillTranscriptionModes.includes(value as SkillTranscriptionMode);

const normalizeTranscriptionMode = (value: unknown): SkillTranscriptionMode =>
  isSkillTranscriptionMode(value) ? value : DEFAULT_TRANSCRIPTION_MODE;

const isSkillTranscriptionFlowMode = (value: unknown): value is SkillTranscriptionFlowMode =>
  typeof value === "string" && skillTranscriptionFlowModes.includes(value as SkillTranscriptionFlowMode);

const normalizeTranscriptionFlowMode = (value: unknown): SkillTranscriptionFlowMode =>
  isSkillTranscriptionFlowMode(value) ? value : DEFAULT_TRANSCRIPTION_FLOW_MODE;

const isSkillExecutionMode = (value: unknown): value is SkillExecutionMode =>
  typeof value === "string" && skillExecutionModes.includes(value as SkillExecutionMode);

const normalizeSkillExecutionMode = (value: unknown): SkillExecutionMode =>
  isSkillExecutionMode(value) ? value : DEFAULT_SKILL_EXECUTION_MODE;

const normalizeSkillMode = (value: unknown): SkillMode =>
  value === "llm" ? "llm" : DEFAULT_SKILL_MODE;

const isNoCodeAuthType = (value: unknown): value is NoCodeAuthType =>
  typeof value === "string" && noCodeAuthTypes.includes(value as NoCodeAuthType);

const normalizeNoCodeAuthType = (value: unknown): NoCodeAuthType =>
  isNoCodeAuthType(value) ? value : "none";

const normalizeActionId = (value: string | null | undefined): string | null => {
  const normalized = normalizeNullableString(value);
  return normalized;
};

function assertRagRequirements(
  ragConfig: SkillRagConfig,
  knowledgeBaseIds: readonly string[],
  executionMode?: SkillExecutionMode,
): void {
  if (executionMode === "no_code") {
    return;
  }

  const hasKnowledgeBases = Boolean(knowledgeBaseIds?.length);
  const hasCollections = Boolean(ragConfig.collectionIds?.length);
  const hasRagSources = hasKnowledgeBases || hasCollections;

  if (!hasRagSources) {
    return;
  }

  if (hasCollections && !hasKnowledgeBases) {
    throw new SkillServiceError("Для выбранных коллекций укажите базу знаний", 400);
  }
  if (ragConfig.mode === "selected_collections" && (!ragConfig.collectionIds || ragConfig.collectionIds.length === 0)) {
    return;
  }
}

function normalizeRagConfigInput(input?: RagConfigInput | null): SkillRagConfig {
  if (!input) {
    return { ...DEFAULT_RAG_CONFIG };
  }

  const sanitizedTopK =
    typeof input.topK === "number" && Number.isInteger(input.topK) && input.topK >= 1 && input.topK <= 50
      ? input.topK
      : DEFAULT_RAG_CONFIG.topK;

  const sanitizedMinScore =
    typeof input.minScore === "number" && input.minScore >= 0 && input.minScore <= 1
      ? Number(input.minScore.toFixed(3))
      : DEFAULT_RAG_CONFIG.minScore;

  const sanitizedMaxContextTokens =
    input.maxContextTokens === null
      ? null
      : typeof input.maxContextTokens === "number" &&
          Number.isInteger(input.maxContextTokens) &&
          input.maxContextTokens >= 500
        ? input.maxContextTokens
        : DEFAULT_RAG_CONFIG.maxContextTokens;

  const sanitizeWeight = (value: unknown): number | null => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return null;
    }
    if (value < 0 || value > 1) {
      return null;
    }
    return Number(value.toFixed(3));
  };

  const sanitizeLimit = (value: unknown): number | null => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return null;
    }
    if (value < 1 || value > 50) {
      return null;
    }
    return value;
  };

  const sanitizeTemperature = (value: unknown): number | null => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return null;
    }
    if (value < 0 || value > 2) {
      return null;
    }
    return Number(value.toFixed(3));
  };

  const sanitizeMaxTokens = (value: unknown): number | null => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return null;
    }
    if (value < 16 || value > 4096) {
      return null;
    }
    return value;
  };

  const sanitizeResponseFormat = (value: unknown): "text" | "markdown" | "html" | null => {
    if (value !== "text" && value !== "markdown" && value !== "html") {
      return null;
    }
    return value;
  };

  const sanitizeEmbeddingProvider = (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    mode: normalizeRagModeFromValue(input.mode),
    collectionIds: normalizeCollectionIds(input.collectionIds),
    topK: sanitizedTopK,
    minScore: sanitizedMinScore,
    maxContextTokens: sanitizedMaxContextTokens,
    showSources: input.showSources ?? DEFAULT_RAG_CONFIG.showSources,
    bm25Weight: sanitizeWeight(input.bm25Weight),
    bm25Limit: sanitizeLimit(input.bm25Limit),
    vectorWeight: sanitizeWeight(input.vectorWeight),
    vectorLimit: sanitizeLimit(input.vectorLimit),
    embeddingProviderId: sanitizeEmbeddingProvider(input.embeddingProviderId),
    llmTemperature: sanitizeTemperature(input.llmTemperature),
    llmMaxTokens: sanitizeMaxTokens(input.llmMaxTokens),
    llmResponseFormat: sanitizeResponseFormat(input.llmResponseFormat) ?? DEFAULT_RAG_CONFIG.llmResponseFormat,
  };
}

function mapSkillRow(row: SkillRow, knowledgeBaseIds: string[]): SkillDto {
  const toIso = (value: Date | string): string =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();

  const callbackTokenHash =
    typeof row.noCodeCallbackTokenHash === "string" ? row.noCodeCallbackTokenHash.trim() : "";
  const responseFormatRaw = row.ragLlmResponseFormat;
  const normalizedResponseFormat =
    responseFormatRaw === "text" || responseFormatRaw === "markdown" || responseFormatRaw === "html"
      ? responseFormatRaw
      : DEFAULT_RAG_CONFIG.llmResponseFormat;

  const payload: SkillDto = {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name ?? null,
    description: row.description ?? null,
    systemPrompt: row.systemPrompt ?? null,
    modelId: row.modelId ?? null,
    llmProviderConfigId: row.llmProviderConfigId ?? null,
    collectionName: row.collectionName ?? null,
    isSystem: Boolean(row.isSystem),
    systemKey: row.systemKey ?? null,
    executionMode: normalizeSkillExecutionMode(row.executionMode),
    status: (row.status as SkillStatus) ?? "active",
    mode: normalizeSkillMode(row.mode),
    icon: row.icon ?? null,
    noCodeConnection: {
      endpointUrl: row.noCodeEndpointUrl ?? null,
      authType: normalizeNoCodeAuthType(row.noCodeAuthType),
      tokenIsSet: Boolean(row.noCodeBearerToken?.trim()),
      callbackTokenIsSet: callbackTokenHash.length > 0,
      callbackTokenLastRotatedAt: row.noCodeCallbackTokenRotatedAt ? toIso(row.noCodeCallbackTokenRotatedAt) : null,
      callbackTokenLastFour: row.noCodeCallbackTokenLastFour ?? null,
      callbackKey: row.noCodeCallbackKey ?? null,
    },
    knowledgeBaseIds,
    contextInputLimit: row.contextInputLimit ?? DEFAULT_CONTEXT_INPUT_LIMIT,
    ragConfig: {
      mode: normalizeRagModeFromValue(row.ragMode),
      collectionIds: (row.ragCollectionIds ?? []) as string[],
      topK: row.ragTopK ?? DEFAULT_RAG_CONFIG.topK,
      minScore: row.ragMinScore ?? DEFAULT_RAG_CONFIG.minScore,
      maxContextTokens: row.ragMaxContextTokens ?? DEFAULT_RAG_CONFIG.maxContextTokens,
      showSources: row.ragShowSources ?? DEFAULT_RAG_CONFIG.showSources,
      bm25Weight: row.ragBm25Weight ?? DEFAULT_RAG_CONFIG.bm25Weight,
      bm25Limit: row.ragBm25Limit ?? DEFAULT_RAG_CONFIG.bm25Limit,
      vectorWeight: row.ragVectorWeight ?? DEFAULT_RAG_CONFIG.vectorWeight,
      vectorLimit: row.ragVectorLimit ?? DEFAULT_RAG_CONFIG.vectorLimit,
      embeddingProviderId: row.ragEmbeddingProviderId ?? DEFAULT_RAG_CONFIG.embeddingProviderId,
      llmTemperature: row.ragLlmTemperature ?? DEFAULT_RAG_CONFIG.llmTemperature,
      llmMaxTokens: row.ragLlmMaxTokens ?? DEFAULT_RAG_CONFIG.llmMaxTokens,
      llmResponseFormat: normalizedResponseFormat,
    },
    transcriptionFlowMode: normalizeTranscriptionFlowMode(row.transcriptionFlowMode),
    onTranscriptionMode: normalizeTranscriptionMode(row.onTranscriptionMode),
    onTranscriptionAutoActionId: row.onTranscriptionAutoActionId ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };

  return payload;
}

async function getSkillKnowledgeBaseIds(skillId: string, workspaceId: string): Promise<string[]> {
  const records: KnowledgeBaseRelationRow[] = await db
    .select({ knowledgeBaseId: skillKnowledgeBases.knowledgeBaseId })
    .from(skillKnowledgeBases)
    .where(
      and(
        eq(skillKnowledgeBases.skillId, skillId),
        eq(skillKnowledgeBases.workspaceId, workspaceId),
      ),
    )
    .orderBy(asc(skillKnowledgeBases.knowledgeBaseId));

  return records.map((record) => record.knowledgeBaseId);
}

async function filterWorkspaceKnowledgeBases(
  workspaceId: string,
  knowledgeBaseIds: readonly string[],
): Promise<string[]> {
  const uniqueIds = Array.from(new Set(knowledgeBaseIds.filter((id) => typeof id === "string" && id.trim().length > 0)));
  if (uniqueIds.length === 0) {
    return [];
  }

  const rows: KnowledgeBaseIdRow[] = await db
    .select({ id: knowledgeBases.id })
    .from(knowledgeBases)
    .where(and(eq(knowledgeBases.workspaceId, workspaceId), inArray(knowledgeBases.id, uniqueIds)));

  const allowed = new Set(rows.map((row) => row.id));
  return uniqueIds.filter((id) => allowed.has(id));
}

async function replaceSkillKnowledgeBases(
  skillId: string,
  workspaceId: string,
  knowledgeBaseIds: string[],
): Promise<string[]> {
  await db
    .delete(skillKnowledgeBases)
    .where(and(eq(skillKnowledgeBases.skillId, skillId), eq(skillKnowledgeBases.workspaceId, workspaceId)));

  if (knowledgeBaseIds.length === 0) {
    return [];
  }

  await db.insert(skillKnowledgeBases).values(
    knowledgeBaseIds.map((knowledgeBaseId) => ({
      skillId,
      knowledgeBaseId,
      workspaceId,
    })),
  );

  return knowledgeBaseIds;
}

function buildEditableColumns(input: SkillEditableInput): NormalizedSkillEditableInput {
  const next: NormalizedSkillEditableInput = {};

  if (input.name !== undefined) {
    next.name = normalizeNullableString(input.name);
  }
  if (input.description !== undefined) {
    next.description = normalizeNullableString(input.description);
  }
  if (input.systemPrompt !== undefined) {
    next.systemPrompt = normalizeNullableString(input.systemPrompt);
  }
  if (input.modelId !== undefined) {
    next.modelId = normalizeNullableString(input.modelId);
  }
  if (input.llmProviderConfigId !== undefined) {
    next.llmProviderConfigId = normalizeNullableString(input.llmProviderConfigId);
  }
  if (input.collectionName !== undefined) {
    next.collectionName = normalizeNullableString(input.collectionName);
  }
  if (input.executionMode !== undefined) {
    next.executionMode = normalizeSkillExecutionMode(input.executionMode);
  }
  if (input.mode !== undefined) {
    next.mode = normalizeSkillMode(input.mode);
  }
  if (input.transcriptionFlowMode !== undefined) {
    next.transcriptionFlowMode = normalizeTranscriptionFlowMode(input.transcriptionFlowMode);
  }
  if (input.icon !== undefined) {
    next.icon = normalizeNullableString(input.icon);
  }
  if (input.onTranscriptionMode !== undefined) {
    next.onTranscriptionMode = normalizeTranscriptionMode(input.onTranscriptionMode);
  }
  if (input.onTranscriptionAutoActionId !== undefined) {
    next.onTranscriptionAutoActionId = normalizeActionId(input.onTranscriptionAutoActionId);
  }
  if (input.noCodeEndpointUrl !== undefined) {
    next.noCodeEndpointUrl = normalizeNullableString(input.noCodeEndpointUrl);
  }
  if (input.noCodeAuthType !== undefined) {
    next.noCodeAuthType = normalizeNoCodeAuthType(input.noCodeAuthType);
  }
  if (input.noCodeBearerToken !== undefined) {
    next.noCodeBearerToken = normalizeNullableString(input.noCodeBearerToken);
  }
  if (input.contextInputLimit !== undefined) {
    const value =
      input.contextInputLimit === null || input.contextInputLimit === undefined
        ? null
        : Number.isFinite(input.contextInputLimit)
          ? Math.trunc(Number(input.contextInputLimit))
          : null;
    next.contextInputLimit = value;
  }
  if (input.knowledgeBaseIds !== undefined) {
    const filtered = input.knowledgeBaseIds.filter(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
    next.knowledgeBaseIds = Array.from(new Set(filtered));
  }
  if (input.ragConfig !== undefined) {
    next.ragConfig = normalizeRagConfigInput(input.ragConfig);
  }

  return next;
}

export async function listSkills(
  workspaceId: string,
  options: { includeArchived?: boolean } = {},
): Promise<SkillDto[]> {
  const fetchSkillsForWorkspace = async (): Promise<SkillRow[]> => {
    const baseCondition = eq(skills.workspaceId, workspaceId);
    const condition = options.includeArchived ? baseCondition : and(baseCondition, eq(skills.status, "active"));
    return await db.select().from(skills).where(condition as SQL<unknown>).orderBy(asc(skills.createdAt));
  };

  let rows: SkillRow[] = await fetchSkillsForWorkspace();

  const hasUnicaChat = rows.some((row) => row.isSystem && row.systemKey === UNICA_CHAT_SYSTEM_KEY);
  if (!hasUnicaChat) {
    try {
      const ensured = await createUnicaChatSkillForWorkspace(workspaceId);
      if (ensured) {
        rows = await fetchSkillsForWorkspace();
      }
    } catch (error) {
      console.error(
        `[skills] Не удалось создать системный навык Unica Chat для workspace ${workspaceId}`,
        error,
      );
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const skillIds = rows.map((row) => row.id);
  const relations: SkillKnowledgeBaseLinkRow[] = await db
    .select({ skillId: skillKnowledgeBases.skillId, knowledgeBaseId: skillKnowledgeBases.knowledgeBaseId })
    .from(skillKnowledgeBases)
    .where(and(eq(skillKnowledgeBases.workspaceId, workspaceId), inArray(skillKnowledgeBases.skillId, skillIds)));

  const grouped = new Map<string, string[]>();
  for (const relation of relations) {
    if (!grouped.has(relation.skillId)) {
      grouped.set(relation.skillId, []);
    }
    grouped.get(relation.skillId)!.push(relation.knowledgeBaseId);
  }

  return rows.map((row) => mapSkillRow(row, grouped.get(row.id) ?? []));
}

export async function createSkill(
  workspaceId: string,
  input: SkillEditableInput,
): Promise<SkillDto> {
  const decision = await workspaceOperationGuard.check({
    workspaceId,
    operationType: "CREATE_SKILL",
    expectedCost: { objects: 1 },
    meta: { objects: { entityType: "skill" } },
  });
  if (!decision.allowed) {
    throw new OperationBlockedError(
      mapDecisionToPayload(decision, {
        workspaceId,
        operationType: "CREATE_SKILL",
        meta: { objects: { entityType: "skill" } },
      }),
    );
  }

  const normalized = buildEditableColumns(input);
  const submittedNoCodeEndpoint = normalized.noCodeEndpointUrl ?? null;
  const submittedNoCodeAuth = normalizeNoCodeAuthType(normalized.noCodeAuthType ?? "none");
  if (submittedNoCodeAuth === "bearer" && !submittedNoCodeEndpoint) {
    throw new SkillServiceError("Укажите URL для no-code подключения", 400);
  }
  const submittedBearerCandidate = Boolean(normalized.noCodeBearerToken);
  if (submittedNoCodeAuth === "bearer" && !submittedBearerCandidate) {
    throw new SkillServiceError("Введите токен для Bearer-авторизации", 400);
  }
  let nextBearerToken = normalized.noCodeBearerToken ?? null;
  if (submittedNoCodeAuth === "none" || !submittedNoCodeEndpoint) {
    nextBearerToken = null;
  }
  const normalizedEndpointUrl = normalized.noCodeEndpointUrl ?? null;
  const normalizedAuthType = submittedNoCodeAuth;
  let normalizedBearerToken = normalized.noCodeBearerToken ?? null;

  if (normalizedAuthType === "bearer") {
    if (!normalizedEndpointUrl) {
      throw new SkillServiceError("Укажите URL для no-code подключения", 400);
    }
    if (!normalizedBearerToken) {
      throw new SkillServiceError("Введите токен для Bearer-авторизации", 400);
    }
  } else {
    normalizedBearerToken = null;
  }

  if (!normalizedEndpointUrl) {
    normalizedBearerToken = null;
  }
  if (normalized.executionMode === "no_code") {
    await assertNoCodeFlowAllowed(workspaceId);
  }
  const validKnowledgeBases = normalized.knowledgeBaseIds
    ? await filterWorkspaceKnowledgeBases(workspaceId, normalized.knowledgeBaseIds)
    : [];

  if ((normalized.knowledgeBaseIds?.length ?? 0) !== validKnowledgeBases.length) {
    throw new SkillServiceError("Некоторые базы знаний не найдены в рабочем пространстве", 400);
  }

  const ragConfig = normalized.ragConfig ?? { ...DEFAULT_RAG_CONFIG };
  const transcriptionFlowMode = normalized.transcriptionFlowMode ?? DEFAULT_TRANSCRIPTION_FLOW_MODE;
  const transcriptionMode = normalized.onTranscriptionMode ?? DEFAULT_TRANSCRIPTION_MODE;
  const transcriptionAutoActionId = normalized.onTranscriptionAutoActionId ?? null;
  const executionMode = normalized.executionMode ?? DEFAULT_SKILL_EXECUTION_MODE;
  const mode = normalized.mode ?? DEFAULT_SKILL_MODE;
  const callbackKey = executionMode === "no_code" ? generateCallbackKey() : null;
  assertRagRequirements(ragConfig, validKnowledgeBases, executionMode);
  let resolvedModelId: string | null = normalized.modelId ?? null;
  if (normalized.modelId) {
    try {
      const model = await ensureModelAvailable(normalized.modelId, { expectedType: "LLM" });
      resolvedModelId = model.modelKey;
    } catch (error) {
      if (error instanceof ModelValidationError || error instanceof ModelUnavailableError) {
        throw new SkillServiceError(error.message, (error as any)?.status ?? 400);
      }
      throw error;
    }
  }

  const [inserted] = await db
    .insert(skills)
    .values({
      workspaceId,
      name: normalized.name,
      description: normalized.description,
      systemPrompt: normalized.systemPrompt,
      modelId: resolvedModelId,
      llmProviderConfigId: normalized.llmProviderConfigId,
      collectionName: normalized.collectionName,
      executionMode,
      mode,
      icon: normalized.icon,
      ragMode: ragConfig.mode,
      ragCollectionIds: ragConfig.collectionIds,
      ragTopK: ragConfig.topK,
      ragMinScore: ragConfig.minScore,
      ragMaxContextTokens: ragConfig.maxContextTokens,
      ragShowSources: ragConfig.showSources,
      ragBm25Weight: ragConfig.bm25Weight,
      ragBm25Limit: ragConfig.bm25Limit,
      ragVectorWeight: ragConfig.vectorWeight,
      ragVectorLimit: ragConfig.vectorLimit,
      ragEmbeddingProviderId: ragConfig.embeddingProviderId,
      ragLlmTemperature: ragConfig.llmTemperature,
      ragLlmMaxTokens: ragConfig.llmMaxTokens,
      ragLlmResponseFormat: ragConfig.llmResponseFormat,
      transcriptionFlowMode,
      onTranscriptionMode: transcriptionMode,
      onTranscriptionAutoActionId: transcriptionAutoActionId,
      noCodeEndpointUrl: normalizedEndpointUrl,
      noCodeAuthType: normalizedAuthType,
      noCodeBearerToken: normalizedBearerToken,
      contextInputLimit: normalized.contextInputLimit ?? DEFAULT_CONTEXT_INPUT_LIMIT,
      noCodeCallbackTokenHash: null,
      noCodeCallbackTokenLastFour: null,
      noCodeCallbackTokenRotatedAt: null,
      noCodeCallbackKey: callbackKey,
    })
    .returning();

  const knowledgeBaseIds = await replaceSkillKnowledgeBases(inserted.id, workspaceId, validKnowledgeBases);

  if (!inserted.isSystem && inserted.status === "active") {
    const period = getUsagePeriodForDate(inserted.createdAt ? new Date(inserted.createdAt) : new Date());
    await adjustWorkspaceObjectCounters(workspaceId, { skillsDelta: 1 }, period);
  }

  return mapSkillRow(inserted, knowledgeBaseIds);
}

export async function updateSkill(
  workspaceId: string,
  skillId: string,
  input: SkillEditableInput,
): Promise<SkillDto> {
  const existing = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)))
    .limit(1);

  const row = existing[0];
  if (!row) {
    throw new SkillServiceError("Навык не найден", 404);
  }

  if (row.isSystem) {

    throw new SkillServiceError("Системные навыки нельзя менять на уровне рабочего пространства", 403);

  }



  const normalized = buildEditableColumns(input);
  const submittedExecutionMode = normalized.executionMode ?? normalizeSkillExecutionMode(row.executionMode);
  const existingNoCodeEndpoint = row.noCodeEndpointUrl ?? null;
  const existingNoCodeAuth = normalizeNoCodeAuthType(row.noCodeAuthType);
  const existingBearerToken = row.noCodeBearerToken ?? null;
  const submittedNoCodeEndpoint =
    normalized.noCodeEndpointUrl !== undefined ? normalized.noCodeEndpointUrl : existingNoCodeEndpoint;
  const submittedNoCodeAuth =
    normalized.noCodeAuthType !== undefined ? normalizeNoCodeAuthType(normalized.noCodeAuthType) : existingNoCodeAuth;
  if (submittedExecutionMode === "no_code" && submittedNoCodeAuth === "bearer" && !submittedNoCodeEndpoint) {
    throw new SkillServiceError("Укажите URL для no-code подключения", 400);
  }
  const submittedBearerCandidate =
    normalized.noCodeBearerToken !== undefined ? Boolean(normalized.noCodeBearerToken) : Boolean(existingBearerToken);
  if (submittedExecutionMode === "no_code" && submittedNoCodeAuth === "bearer" && !submittedBearerCandidate) {
    throw new SkillServiceError("Введите токен для Bearer-авторизации", 400);
  }
  let nextBearerToken =
    normalized.noCodeBearerToken !== undefined ? normalized.noCodeBearerToken : existingBearerToken;
  if (submittedExecutionMode === "no_code" && (submittedNoCodeAuth === "none" || !submittedNoCodeEndpoint)) {
    nextBearerToken = null;
  }
  if (submittedExecutionMode === "no_code") {
    await assertNoCodeFlowAllowed(workspaceId);
  }
  const previousExecutionMode = normalizeSkillExecutionMode(row.executionMode);
  const isSwitchingExecutionMode = normalized.executionMode !== undefined;
  let callbackKeyUpdate: string | null | undefined;

  if (isSwitchingExecutionMode) {
    if (submittedExecutionMode === "no_code") {
      callbackKeyUpdate = row.noCodeCallbackKey ?? generateCallbackKey();
    } else if (previousExecutionMode === "no_code") {
      callbackKeyUpdate = null;
    }
  } else if (!row.noCodeCallbackKey && submittedExecutionMode === "no_code") {
    callbackKeyUpdate = generateCallbackKey();
  }
  const updates: Partial<EditableSkillColumns> = {};

  (Object.keys(normalized) as (keyof SkillEditableInput)[]).forEach((key) => {
    if (key === "knowledgeBaseIds") {
      return;
    }
    if (key === "ragConfig") {
      return;
    }
    if (normalized[key] !== undefined) {
      (updates as Record<string, unknown>)[key] = normalized[key];
    }
  });

  updates.noCodeEndpointUrl = submittedNoCodeEndpoint;
  updates.noCodeAuthType = submittedNoCodeAuth;
  updates.noCodeBearerToken = nextBearerToken;
  if (normalized.contextInputLimit !== undefined) {
    updates.contextInputLimit = normalized.contextInputLimit;
  }
  if (callbackKeyUpdate !== undefined) {
    updates.noCodeCallbackKey = callbackKeyUpdate;
  }

  const currentRagConfig: SkillRagConfig = {
    mode: normalizeRagModeFromValue(row.ragMode),
    collectionIds: row.ragCollectionIds ?? [],
    topK: row.ragTopK ?? DEFAULT_RAG_CONFIG.topK,
    minScore: row.ragMinScore ?? DEFAULT_RAG_CONFIG.minScore,
    maxContextTokens: row.ragMaxContextTokens ?? DEFAULT_RAG_CONFIG.maxContextTokens,
    showSources: row.ragShowSources ?? DEFAULT_RAG_CONFIG.showSources,
    bm25Weight: row.ragBm25Weight ?? DEFAULT_RAG_CONFIG.bm25Weight,
    bm25Limit: row.ragBm25Limit ?? DEFAULT_RAG_CONFIG.bm25Limit,
    vectorWeight: row.ragVectorWeight ?? DEFAULT_RAG_CONFIG.vectorWeight,
    vectorLimit: row.ragVectorLimit ?? DEFAULT_RAG_CONFIG.vectorLimit,
    embeddingProviderId: row.ragEmbeddingProviderId ?? DEFAULT_RAG_CONFIG.embeddingProviderId,
    llmTemperature: row.ragLlmTemperature ?? DEFAULT_RAG_CONFIG.llmTemperature,
    llmMaxTokens: row.ragLlmMaxTokens ?? DEFAULT_RAG_CONFIG.llmMaxTokens,
    llmResponseFormat: row.ragLlmResponseFormat ?? DEFAULT_RAG_CONFIG.llmResponseFormat,
  };
  const ragUpdates = normalized.ragConfig;
  const hasRagUpdates = ragUpdates !== undefined;
  const nextRagConfig = ragUpdates ?? currentRagConfig;
  const effectiveMode = normalized.mode ?? normalizeSkillMode(row.mode);

  let knowledgeBaseIdsForValidation: string[];
  if (normalized.knowledgeBaseIds !== undefined) {
    const validKnowledgeBases = await filterWorkspaceKnowledgeBases(
      workspaceId,
      normalized.knowledgeBaseIds,
    );

    if (validKnowledgeBases.length !== normalized.knowledgeBaseIds.length) {
      throw new SkillServiceError("Некоторые базы знаний не найдены в рабочем пространстве", 400);
    }
    knowledgeBaseIdsForValidation = validKnowledgeBases;
  } else {
    knowledgeBaseIdsForValidation = await getSkillKnowledgeBaseIds(skillId, workspaceId);
  }

  assertRagRequirements(nextRagConfig, knowledgeBaseIdsForValidation, submittedExecutionMode);

  if (normalized.modelId !== undefined) {
    if (normalized.modelId === null) {
      updates.modelId = null;
    } else {
      try {
        const model = await ensureModelAvailable(normalized.modelId, { expectedType: "LLM" });
        updates.modelId = model.modelKey;
      } catch (error) {
        if (error instanceof ModelValidationError || error instanceof ModelUnavailableError) {
          throw new SkillServiceError(error.message, (error as any)?.status ?? 400);
        }
        throw error;
      }
    }
  }

  let updatedRow = row;
  if (Object.keys(updates).length > 0 || hasRagUpdates) {
    const [updated] = await db
      .update(skills)
      .set({
        ...updates,
        ...(ragUpdates
          ? {
              ragMode: ragUpdates.mode,
              ragCollectionIds: ragUpdates.collectionIds,
              ragTopK: ragUpdates.topK,
              ragMinScore: ragUpdates.minScore,
              ragMaxContextTokens: ragUpdates.maxContextTokens,
              ragShowSources: ragUpdates.showSources,
              ragBm25Weight: ragUpdates.bm25Weight,
              ragBm25Limit: ragUpdates.bm25Limit,
              ragVectorWeight: ragUpdates.vectorWeight,
              ragVectorLimit: ragUpdates.vectorLimit,
              ragEmbeddingProviderId: ragUpdates.embeddingProviderId,
              ragLlmTemperature: ragUpdates.llmTemperature,
              ragLlmMaxTokens: ragUpdates.llmMaxTokens,
              ragLlmResponseFormat: ragUpdates.llmResponseFormat,
            }
          : {}),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)))
      .returning();

    if (updated) {
      updatedRow = updated;
    }
  }

  let knowledgeBaseIds: string[];
  if (normalized.knowledgeBaseIds !== undefined) {
    knowledgeBaseIds = await replaceSkillKnowledgeBases(skillId, workspaceId, knowledgeBaseIdsForValidation);
  } else {
    knowledgeBaseIds = knowledgeBaseIdsForValidation;
  }

  return mapSkillRow(updatedRow, knowledgeBaseIds);
}

export async function archiveSkill(
  workspaceId: string,
  skillId: string,
): Promise<{ skill: SkillDto; archivedChats: number }> {
  const existing = await db
    .select()
    .from(skills)
    .where(and(eq(skills.workspaceId, workspaceId), eq(skills.id, skillId)))
    .limit(1);

  const row = existing[0];

  if (!row) {
    throw new SkillServiceError("Навык не найден", 404);
  }

  if (row.isSystem) {
    throw new SkillServiceError("Системные навыки нельзя удалять из рабочего пространства", 403);
  }

  if (row.status === "archived") {
    const knowledgeBaseIds = await getSkillKnowledgeBaseIds(skillId, workspaceId);
    return { skill: mapSkillRow(row, knowledgeBaseIds), archivedChats: 0 };
  }

  const [updatedSkill] = await db
    .update(skills)
    .set({ status: "archived", updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)))
    .returning();

  const archivedChatsResult = await db
    .update(chatSessions)
    .set({ status: "archived", updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(chatSessions.workspaceId, workspaceId), eq(chatSessions.skillId, skillId)))
    .returning({ id: chatSessions.id });

  const knowledgeBaseIds = await getSkillKnowledgeBaseIds(skillId, workspaceId);
  const period = getUsagePeriodForDate(updatedSkill.updatedAt ? new Date(updatedSkill.updatedAt) : new Date());
  await adjustWorkspaceObjectCounters(workspaceId, { skillsDelta: -1 }, period);

  return {
    skill: mapSkillRow(updatedSkill, knowledgeBaseIds),
    archivedChats: archivedChatsResult.length,
  };
}



export async function getSkillById(
  workspaceId: string,
  skillId: string,
): Promise<SkillDto | null> {
  const rows: SkillRow[] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  const knowledgeBaseIds = await getSkillKnowledgeBaseIds(skillId, workspaceId);
  return mapSkillRow(row, knowledgeBaseIds);
}

export async function generateNoCodeCallbackToken(opts: {
  workspaceId: string;
  skillId: string;
}): Promise<{ token: string; lastFour: string; rotatedAt: string; skill: SkillDto }> {
  const { workspaceId, skillId } = opts;
  const existingRows = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)))
    .limit(1);

  const existing = existingRows[0];
  if (!existing) {
    throw new SkillServiceError("Навык не найден", 404);
  }

  if (existing.isSystem) {
    throw new SkillServiceError("Системные навыки нельзя менять на уровне рабочего пространства", 403);
  }

  if ((existing.status as SkillStatus) === "archived") {
    throw new SkillServiceError("Навык архивирован", 409);
  }

  if (existing.executionMode !== "no_code") {
    throw new SkillServiceError("Навык не находится в no-code режиме", 409, "NO_CODE_MODE_REQUIRED");
  }

  await assertNoCodeFlowAllowed(workspaceId);

  const secrets = generateCallbackToken();
  const callbackKey = existing.noCodeCallbackKey ?? generateCallbackKey();
  const [updated] = await db
    .update(skills)
    .set({
      noCodeCallbackTokenHash: secrets.hash,
      noCodeCallbackTokenLastFour: secrets.lastFour,
      noCodeCallbackTokenRotatedAt: secrets.rotatedAt,
      noCodeCallbackKey: callbackKey,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(skills.id, skillId), eq(skills.workspaceId, workspaceId)))
    .returning();

  const knowledgeBaseIds = await getSkillKnowledgeBaseIds(skillId, workspaceId);
  const skill = mapSkillRow(updated ?? existing, knowledgeBaseIds);

  return {
    token: secrets.token,
    lastFour: secrets.lastFour,
    rotatedAt: secrets.rotatedAt.toISOString(),
    skill,
  };
}

export async function verifyNoCodeCallbackToken(opts: {
  workspaceId: string;
  chatId: string;
  token: string | null;
}): Promise<{ skillId: string }> {
  const token = typeof opts.token === "string" ? opts.token.trim() : "";
  if (!token) {
    throw new SkillServiceError("API-токен для callback не указан", 401, CALLBACK_UNAUTHORIZED_CODE);
  }

  const chatRows = await db
    .select({
      id: chatSessions.id,
      workspaceId: chatSessions.workspaceId,
      skillId: chatSessions.skillId,
    })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, opts.chatId), eq(chatSessions.workspaceId, opts.workspaceId)))
    .limit(1);

  const chat = chatRows[0];
  if (!chat) {
    throw new SkillServiceError("Чат не найден", 404);
  }

  const skillRows = await db
    .select({
      id: skills.id,
      status: skills.status,
      executionMode: skills.executionMode,
      callbackTokenHash: skills.noCodeCallbackTokenHash,
    })
    .from(skills)
    .where(and(eq(skills.id, chat.skillId), eq(skills.workspaceId, chat.workspaceId)))
    .limit(1);

  const skill = skillRows[0];
  if (!skill) {
    throw new SkillServiceError("Навык не найден", 404);
  }

  if ((skill.status as SkillStatus) === "archived") {
    throw new SkillServiceError("Навык архивирован", 409);
  }

  if (skill.executionMode !== "no_code") {
    throw new SkillServiceError("Навык не находится в no-code режиме", 409, "NO_CODE_MODE_REQUIRED");
  }

  const expectedHash = typeof skill.callbackTokenHash === "string" ? skill.callbackTokenHash.trim() : "";
  if (!expectedHash) {
    throw new SkillServiceError(
      "API-токен для callback не задан",
      401,
      CALLBACK_UNAUTHORIZED_CODE,
    );
  }

  const providedHash = hashCallbackToken(token).hash;
  const tokenMatches = timingSafeHashEquals(expectedHash, providedHash);
  if (!tokenMatches) {
    throw new SkillServiceError("Некорректный API-токен", 401, CALLBACK_UNAUTHORIZED_CODE);
  }

  return { skillId: skill.id };
}

export async function verifyNoCodeCallbackKey(opts: {
  workspaceId: string;
  callbackKey: string;
}): Promise<{ skillId: string }> {
  const callbackKey = typeof opts.callbackKey === "string" ? opts.callbackKey.trim() : "";
  if (!callbackKey) {
    throw new SkillServiceError("Callback-ключ не указан", 401, CALLBACK_UNAUTHORIZED_CODE);
  }

  const rows = await db
    .select({
      id: skills.id,
      status: skills.status,
      executionMode: skills.executionMode,
    })
    .from(skills)
    .where(and(eq(skills.workspaceId, opts.workspaceId), eq(skills.noCodeCallbackKey, callbackKey)))
    .limit(1);

  const skill = rows[0];
  if (!skill) {
    throw new SkillServiceError("Навык не найден", 404);
  }

  if ((skill.status as SkillStatus) === "archived") {
    throw new SkillServiceError("Навык архивирован", 409);
  }

  if (normalizeSkillExecutionMode(skill.executionMode) !== "no_code") {
    throw new SkillServiceError("Навык не находится в no-code режиме", 409, "NO_CODE_MODE_REQUIRED");
  }

  return { skillId: skill.id };
}

export const UNICA_CHAT_SYSTEM_KEY = "UNICA_CHAT";
const UNICA_CHAT_DEFAULT_NAME = "Unica Chat";

export async function createUnicaChatSkillForWorkspace(
  workspaceId: string,
): Promise<SkillDto | null> {
  const existing = await db
    .select()
    .from(skills)
    .where(and(eq(skills.workspaceId, workspaceId), eq(skills.systemKey, UNICA_CHAT_SYSTEM_KEY)))
    .limit(1);

  const existingRow = existing[0];
  if (existingRow) {
    const knowledgeBaseIds = await getSkillKnowledgeBaseIds(existingRow.id, workspaceId);
    return mapSkillRow(existingRow, knowledgeBaseIds);
  }

  const ragConfig = { ...DEFAULT_RAG_CONFIG };

  const [inserted] = await db
    .insert(skills)
    .values({
      workspaceId,
      name: UNICA_CHAT_DEFAULT_NAME,
      isSystem: true,
      systemKey: UNICA_CHAT_SYSTEM_KEY,
      ragMode: ragConfig.mode,
      ragCollectionIds: ragConfig.collectionIds,
      ragTopK: ragConfig.topK,
      ragMinScore: ragConfig.minScore,
      ragMaxContextTokens: ragConfig.maxContextTokens,
      ragShowSources: ragConfig.showSources,
    })
    .returning();

  return mapSkillRow(inserted, []);
}
