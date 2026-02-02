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
import { decryptSecret, encryptSecret } from "./secret-storage";
import { indexingRulesService } from "./indexing-rules";
import { getCache, cacheKeys } from "./cache";

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
  | "asrProviderId"
  | "noCodeEndpointUrl"
  | "noCodeFileEventsUrl"
  | "noCodeAuthType"
  | "noCodeBearerToken"
  | "noCodeCallbackKey"
  | "noCodeFileStorageProviderId"
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

type FileStorageProviderShort = {
  id: string;
  name: string;
  baseUrl: string;
  authType: NoCodeAuthType;
};

type FileStorageProviderResolution = {
  selectedProviderId: string | null;
  effective: FileStorageProviderShort | null;
  source: "skill" | "workspace_default" | "none";
};

type FileStorageProviderLookup = {
  defaultProvider: FileStorageProviderShort | null;
  selectedProviders: Map<string, FileStorageProviderShort | null>;
};

let storageSingleton: typeof import("./storage").storage | null = null;
const SECRET_PLACEHOLDER = "__secret__";

async function getStorage() {
  if (!storageSingleton) {
    const module = await import("./storage");
    storageSingleton = module.storage;
  }
  return storageSingleton;
}

function encodeBearerToken(token: string | null): string | null {
  if (!token) return null;
  return encryptSecret(token);
}

function decodeBearerToken(token: string | null): string | null {
  if (!token) return null;
  return decryptSecret(token);
}

const toProviderShort = (provider: {
  id: string;
  name: string;
  baseUrl: string;
  authType: string;
}): FileStorageProviderShort => ({
  id: provider.id,
  name: provider.name,
  baseUrl: provider.baseUrl,
  authType: normalizeNoCodeAuthType(provider.authType),
});

async function buildFileStorageProviderLookup(
  workspaceId: string,
  providerIds: Set<string>,
): Promise<FileStorageProviderLookup> {
  const storage = await getStorage();
  const defaultProviderRow = await storage.getWorkspaceDefaultFileStorageProvider(workspaceId);
  const defaultProvider =
    defaultProviderRow && defaultProviderRow.isActive ? toProviderShort(defaultProviderRow) : null;

  const selectedProviders = new Map<string, FileStorageProviderShort | null>();
  await Promise.all(
    Array.from(providerIds).map(async (id) => {
      const provider = await storage.getFileStorageProvider(id);
      selectedProviders.set(id, provider && provider.isActive ? toProviderShort(provider) : null);
    }),
  );

  return { defaultProvider, selectedProviders };
}

function resolveProviderForSkill(
  selectedProviderId: string | null,
  lookup: FileStorageProviderLookup,
): FileStorageProviderResolution {
  const selected = selectedProviderId ? lookup.selectedProviders.get(selectedProviderId) ?? null : null;

  if (selectedProviderId && selected) {
    return { selectedProviderId, effective: selected, source: "skill" };
  }

  if (lookup.defaultProvider) {
    return { selectedProviderId, effective: lookup.defaultProvider, source: "workspace_default" };
  }

  return { selectedProviderId, effective: null, source: "none" };
}

async function assertFileStorageProviderActive(providerId: string | null): Promise<void> {
  if (!providerId) {
    return;
  }
  const storage = await getStorage();
  const provider = await storage.getFileStorageProvider(providerId);
  if (!provider) {
    throw new SkillServiceError("Выбранный файловый провайдер не найден", 400, "FILE_STORAGE_PROVIDER_NOT_FOUND");
  }
  if (!provider.isActive) {
    throw new SkillServiceError("Выбранный файловый провайдер отключён", 400, "FILE_STORAGE_PROVIDER_INACTIVE");
  }
}

const DEFAULT_RAG_CONFIG: SkillRagConfig = {
  historyMessagesLimit: 6,
  historyCharsLimit: 4000,
  enableQueryRewriting: true,
  queryRewriteModel: null,
  enableContextCaching: false,
  contextCacheTtlSeconds: 300, // 5 минут
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
const DEFAULT_SKILL_MODE: SkillMode = "llm";
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
  value === "rag" ? "rag" : "llm";

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
  // Стандартный режим больше не требует rag-настроек в навыке.
  if (executionMode !== "no_code") {
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

  const sanitizeHistoryMessagesLimit = (value: number | null | undefined): number | null => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return null;
    }
    if (value < 0 || value > 20) {
      return null;
    }
    return value;
  };

  const sanitizeHistoryCharsLimit = (value: number | null | undefined): number | null => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return null;
    }
    if (value < 0 || value > 50000) {
      return null;
    }
    return value;
  };

  const sanitizeOptionalString = (value: string | null | undefined): string | undefined =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

  const sanitizeContextCacheTtl = (value: number | null | undefined): number | null => {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return null;
    }
    if (value < 60 || value > 1800) {
      return null; // от 1 минуты до 30 минут
    }
    return value;
  };

  return {
    mode: normalizeRagModeFromValue(input.mode),
    collectionIds: normalizeCollectionIds(input.collectionIds),
    topK: sanitizedTopK,
    minScore: sanitizedMinScore,
    maxContextTokens: sanitizedMaxContextTokens,
    showSources: input.showSources ?? DEFAULT_RAG_CONFIG.showSources,
    historyMessagesLimit: sanitizeHistoryMessagesLimit(input.historyMessagesLimit) ?? DEFAULT_RAG_CONFIG.historyMessagesLimit,
    historyCharsLimit: sanitizeHistoryCharsLimit(input.historyCharsLimit) ?? DEFAULT_RAG_CONFIG.historyCharsLimit,
    enableQueryRewriting: input.enableQueryRewriting ?? DEFAULT_RAG_CONFIG.enableQueryRewriting,
    queryRewriteModel: sanitizeOptionalString(input.queryRewriteModel) ?? DEFAULT_RAG_CONFIG.queryRewriteModel,
    enableContextCaching: input.enableContextCaching ?? DEFAULT_RAG_CONFIG.enableContextCaching,
    contextCacheTtlSeconds: sanitizeContextCacheTtl(input.contextCacheTtlSeconds) ?? DEFAULT_RAG_CONFIG.contextCacheTtlSeconds,
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

function mapSkillRow(
  row: SkillRow,
  knowledgeBaseIds: string[],
  providerInfo?: FileStorageProviderResolution,
): SkillDto {
  const toIso = (value: Date | string): string =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();

  const callbackTokenHash =
    typeof row.noCodeCallbackTokenHash === "string" ? row.noCodeCallbackTokenHash.trim() : "";
  const responseFormatRaw = row.ragLlmResponseFormat;
  const normalizedResponseFormat =
    responseFormatRaw === "text" || responseFormatRaw === "markdown" || responseFormatRaw === "html"
      ? responseFormatRaw
      : DEFAULT_RAG_CONFIG.llmResponseFormat;
  const effectiveProvider = providerInfo?.effective ?? null;
  const authType = effectiveProvider?.authType ?? normalizeNoCodeAuthType(row.noCodeAuthType);

  // Если у навыка есть БЗ, но mode в БД "llm" - исправляем на "rag"
  const storedMode = normalizeSkillMode(row.mode);
  const hasKnowledgeBases = knowledgeBaseIds.length > 0;
  const effectiveMode: SkillMode = hasKnowledgeBases && storedMode === "llm" ? "rag" : storedMode;
  
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
    mode: effectiveMode,
    icon: row.icon ?? null,
    sharedChatFiles: Boolean(row.sharedChatFiles),
    noCodeConnection: {
      endpointUrl: row.noCodeEndpointUrl ?? null,
      fileEventsUrl: row.noCodeFileEventsUrl ?? null,
      fileStorageProviderId: row.noCodeFileStorageProviderId ?? null,
      selectedFileStorageProviderId: providerInfo?.selectedProviderId ?? row.noCodeFileStorageProviderId ?? null,
      effectiveFileStorageProvider: effectiveProvider,
      effectiveFileStorageProviderSource: providerInfo?.source ?? "none",
      authType,
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
      historyMessagesLimit: row.ragHistoryMessagesLimit ?? DEFAULT_RAG_CONFIG.historyMessagesLimit,
      historyCharsLimit: row.ragHistoryCharsLimit ?? DEFAULT_RAG_CONFIG.historyCharsLimit,
      enableQueryRewriting: row.ragEnableQueryRewriting ?? DEFAULT_RAG_CONFIG.enableQueryRewriting,
      queryRewriteModel: row.ragQueryRewriteModel ?? DEFAULT_RAG_CONFIG.queryRewriteModel,
      enableContextCaching: row.ragEnableContextCaching ?? DEFAULT_RAG_CONFIG.enableContextCaching,
      contextCacheTtlSeconds: row.ragContextCacheTtlSeconds ?? DEFAULT_RAG_CONFIG.contextCacheTtlSeconds,
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
    asrProviderId: row.asrProviderId ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };

  return payload;
}

async function resolveSkillFileStorageProvider(opts: {
  workspaceId: string;
  selectedProviderId: string | null;
}): Promise<FileStorageProviderResolution> {
  const providerIds = new Set<string>();
  if (opts.selectedProviderId) {
    providerIds.add(opts.selectedProviderId);
  }
  const lookup = await buildFileStorageProviderLookup(opts.workspaceId, providerIds);
  return resolveProviderForSkill(opts.selectedProviderId, lookup);
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
  if (input.asrProviderId !== undefined) {
    next.asrProviderId = normalizeNullableString(input.asrProviderId);
  }
  if (input.noCodeEndpointUrl !== undefined) {
    next.noCodeEndpointUrl = normalizeNullableString(input.noCodeEndpointUrl);
  }
  if (input.noCodeFileEventsUrl !== undefined) {
    next.noCodeFileEventsUrl = normalizeNullableString(input.noCodeFileEventsUrl);
  }
  if (input.noCodeFileStorageProviderId !== undefined) {
    next.noCodeFileStorageProviderId = normalizeNullableString(input.noCodeFileStorageProviderId);
  }
  if (input.noCodeAuthType !== undefined) {
    next.noCodeAuthType = normalizeNoCodeAuthType(input.noCodeAuthType);
  }
  if (input.noCodeBearerToken !== undefined) {
    next.noCodeBearerToken =
      input.noCodeBearerToken === "" ? "" : normalizeNullableString(input.noCodeBearerToken);
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

  const selectedProviderIds = new Set<string>();
  for (const row of rows) {
    const providerId = normalizeNullableString(row.noCodeFileStorageProviderId);
    if (providerId) {
      selectedProviderIds.add(providerId);
    }
  }

  const providerLookup = await buildFileStorageProviderLookup(workspaceId, selectedProviderIds);

  return rows.map((row) =>
    mapSkillRow(
      row,
      grouped.get(row.id) ?? [],
      resolveProviderForSkill(normalizeNullableString(row.noCodeFileStorageProviderId), providerLookup),
    ),
  );
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
  const executionMode = normalized.executionMode ?? DEFAULT_SKILL_EXECUTION_MODE;
  const isNoCodeMode = executionMode === "no_code";
  const submittedNoCodeEndpoint = normalized.noCodeEndpointUrl ?? null;
  const submittedNoCodeFileEvents = normalized.noCodeFileEventsUrl ?? null;
  const selectedFileStorageProviderId = normalized.noCodeFileStorageProviderId ?? null;
  await assertFileStorageProviderActive(selectedFileStorageProviderId);
  if (isNoCodeMode) {
    await assertNoCodeFlowAllowed(workspaceId);
  }
  let providerInfo = await resolveSkillFileStorageProvider({
    workspaceId,
    selectedProviderId: selectedFileStorageProviderId,
  });
  const effectiveProvider = providerInfo.effective;
  const normalizedAuthType = effectiveProvider?.authType ?? "none";
  const isBearerProvider = normalizedAuthType === "bearer";
  const needsBearer = isNoCodeMode && isBearerProvider;
  const bearerInput = normalized.noCodeBearerToken;
  const isClearingBearer = bearerInput === "";
  const hasBearerUpdate = bearerInput !== undefined && bearerInput !== "" && bearerInput !== null;
  let normalizedBearerToken = hasBearerUpdate ? bearerInput : null;

  if (isNoCodeMode) {
    if (!submittedNoCodeEndpoint) {
      throw new SkillServiceError("Укажите URL для no-code подключения", 400, "NO_CODE_ENDPOINT_REQUIRED");
    }
    if (!submittedNoCodeFileEvents) {
      throw new SkillServiceError("Укажите URL для событий файлов no-code", 400, "NO_CODE_FILE_EVENTS_REQUIRED");
    }
    if (!effectiveProvider) {
      throw new SkillServiceError(
        "File storage provider is not configured for this no-code skill",
        400,
        "NO_CODE_PROVIDER_REQUIRED",
      );
    }
  }

  if (needsBearer && !isClearingBearer) {
    if (!normalizedBearerToken) {
      throw new SkillServiceError("Введите токен для Bearer-авторизации", 400);
    }
  }

  if (!needsBearer || !submittedNoCodeEndpoint || isClearingBearer) {
    normalizedBearerToken = null;
  }
  const normalizedEndpointUrl = normalized.noCodeEndpointUrl ?? null;
  
  // Валидация embedding-провайдера для выбранных БЗ
  const selectedKnowledgeBases = normalized.knowledgeBaseIds ?? [];
  if (selectedKnowledgeBases.length > 0) {
    const indexingRules = await indexingRulesService.getIndexingRules();
    const embeddingProviderId = indexingRules.embeddingsProvider;
    if (!embeddingProviderId || embeddingProviderId.trim().length === 0) {
      throw new SkillServiceError(
        "Для использования баз знаний необходимо настроить embedding-провайдер в правилах индексации (Админ → Правила индексации → Навыки)",
        400,
        "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      );
    }
  }
  
  const validKnowledgeBases = normalized.knowledgeBaseIds
    ? await filterWorkspaceKnowledgeBases(workspaceId, normalized.knowledgeBaseIds)
    : [];

  if ((normalized.knowledgeBaseIds?.length ?? 0) !== validKnowledgeBases.length) {
    throw new SkillServiceError("Некоторые базы знаний не найдены в рабочем пространстве", 400);
  }

  const ragConfig = normalized.ragConfig ?? { ...DEFAULT_RAG_CONFIG };
  const hasRagSources = Boolean(validKnowledgeBases.length);
  const inferredMode: SkillMode = hasRagSources ? "rag" : "llm";
  const mode = normalized.mode ?? inferredMode;
  const isStandardMode = mode === "llm";
  const effectiveKnowledgeBases = isStandardMode ? [] : validKnowledgeBases;
  const effectiveRagConfig = isStandardMode ? { ...DEFAULT_RAG_CONFIG } : ragConfig;
  const transcriptionFlowMode = normalized.transcriptionFlowMode ?? DEFAULT_TRANSCRIPTION_FLOW_MODE;
  const transcriptionMode = normalized.onTranscriptionMode ?? DEFAULT_TRANSCRIPTION_MODE;
  const transcriptionAutoActionId = normalized.onTranscriptionAutoActionId ?? null;
  const callbackKey = executionMode === "no_code" ? generateCallbackKey() : null;
  assertRagRequirements(effectiveRagConfig, effectiveKnowledgeBases, executionMode);
  let resolvedModelId: string | null = normalized.modelId ?? null;
  if (normalized.modelId) {
    try {
      const model = await ensureModelAvailable(normalized.modelId, { expectedType: "LLM" });
      resolvedModelId = model.modelKey;
    } catch (error) {
      if (error instanceof ModelValidationError || error instanceof ModelUnavailableError) {
        throw new SkillServiceError(error.message, error.status ?? 400);
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
      ragCollectionIds: effectiveRagConfig.collectionIds,
      ragTopK: effectiveRagConfig.topK,
      ragMinScore: effectiveRagConfig.minScore,
      ragHistoryMessagesLimit: effectiveRagConfig.historyMessagesLimit,
      ragHistoryCharsLimit: effectiveRagConfig.historyCharsLimit,
      ragEnableQueryRewriting: effectiveRagConfig.enableQueryRewriting,
      ragQueryRewriteModel: effectiveRagConfig.queryRewriteModel,
      ragEnableContextCaching: effectiveRagConfig.enableContextCaching,
      ragContextCacheTtlSeconds: effectiveRagConfig.contextCacheTtlSeconds,
      ragMaxContextTokens: effectiveRagConfig.maxContextTokens,
      ragShowSources: effectiveRagConfig.showSources,
      ragBm25Weight: effectiveRagConfig.bm25Weight,
      ragBm25Limit: effectiveRagConfig.bm25Limit,
      ragVectorWeight: effectiveRagConfig.vectorWeight,
      ragVectorLimit: effectiveRagConfig.vectorLimit,
      ragEmbeddingProviderId: effectiveRagConfig.embeddingProviderId,
      ragLlmTemperature: effectiveRagConfig.llmTemperature,
      ragLlmMaxTokens: effectiveRagConfig.llmMaxTokens,
      ragLlmResponseFormat: effectiveRagConfig.llmResponseFormat,
      transcriptionFlowMode,
      onTranscriptionMode: transcriptionMode,
      onTranscriptionAutoActionId: transcriptionAutoActionId,
      asrProviderId: normalized.asrProviderId,
      noCodeEndpointUrl: normalizedEndpointUrl,
      noCodeFileEventsUrl: submittedNoCodeFileEvents,
      noCodeFileStorageProviderId: selectedFileStorageProviderId,
      noCodeAuthType: normalizedAuthType,
      noCodeBearerToken: encodeBearerToken(normalizedBearerToken),
      contextInputLimit: normalized.contextInputLimit ?? DEFAULT_CONTEXT_INPUT_LIMIT,
      noCodeCallbackTokenHash: null,
      noCodeCallbackTokenLastFour: null,
      noCodeCallbackTokenRotatedAt: null,
      noCodeCallbackKey: callbackKey,
    })
    .returning();

  const knowledgeBaseIds = await replaceSkillKnowledgeBases(inserted.id, workspaceId, effectiveKnowledgeBases);

  if (!inserted.isSystem && inserted.status === "active") {
    const period = getUsagePeriodForDate(inserted.createdAt ? new Date(inserted.createdAt) : new Date());
    await adjustWorkspaceObjectCounters(workspaceId, { skillsDelta: 1 }, period);
  }

  const result = mapSkillRow(inserted, knowledgeBaseIds, providerInfo);
  
  // Cache the newly created skill (2 minutes TTL)
  const cache = getCache();
  await cache.set(cacheKeys.skill(workspaceId, inserted.id), result, 2 * 60 * 1000);
  
  return result;
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
  const isNoCodeMode = submittedExecutionMode === "no_code";
  const existingNoCodeEndpoint = row.noCodeEndpointUrl ?? null;
  const submittedNoCodeEndpoint =
    normalized.noCodeEndpointUrl !== undefined ? normalized.noCodeEndpointUrl : existingNoCodeEndpoint;
  const submittedNoCodeFileEvents =
    normalized.noCodeFileEventsUrl !== undefined ? normalized.noCodeFileEventsUrl : row.noCodeFileEventsUrl ?? null;
  const selectedFileStorageProviderId =
    normalized.noCodeFileStorageProviderId !== undefined
      ? normalized.noCodeFileStorageProviderId
      : normalizeNullableString(row.noCodeFileStorageProviderId);
  if (normalized.noCodeFileStorageProviderId !== undefined) {
    await assertFileStorageProviderActive(normalized.noCodeFileStorageProviderId ?? null);
  }
  let providerInfo = await resolveSkillFileStorageProvider({
    workspaceId,
    selectedProviderId: selectedFileStorageProviderId,
  });
  const effectiveProvider = providerInfo.effective;
  const submittedNoCodeAuth = effectiveProvider?.authType ?? "none";
  const isBearerProvider = submittedNoCodeAuth === "bearer";
  const needsBearer = isNoCodeMode && isBearerProvider;
  const existingBearerToken = row.noCodeBearerToken ?? null;
  const bearerInput = normalized.noCodeBearerToken;
  const isClearingBearer = bearerInput === "";
  const hasBearerUpdate = bearerInput !== undefined && bearerInput !== "" && bearerInput !== null;
  let nextBearerToken: string | null | undefined = undefined;
  if (isClearingBearer) {
    nextBearerToken = null;
  } else if (hasBearerUpdate) {
    nextBearerToken = bearerInput;
  }
  if (isNoCodeMode) {
    if (!submittedNoCodeEndpoint) {
      throw new SkillServiceError("Укажите URL для no-code подключения", 400, "NO_CODE_ENDPOINT_REQUIRED");
    }
    if (!submittedNoCodeFileEvents) {
      throw new SkillServiceError("Укажите URL для событий файлов no-code", 400, "NO_CODE_FILE_EVENTS_REQUIRED");
    }
    if (!effectiveProvider) {
      throw new SkillServiceError(
        "File storage provider is not configured for this no-code skill",
        400,
        "NO_CODE_PROVIDER_REQUIRED",
      );
    }
  }
  if (needsBearer && !isClearingBearer) {
    if (!submittedNoCodeEndpoint) {
      throw new SkillServiceError("Укажите URL для no-code подключения", 400);
    }
    const candidateToken = nextBearerToken === undefined ? existingBearerToken : nextBearerToken;
    if (!candidateToken || !candidateToken.trim()) {
      throw new SkillServiceError("Введите токен для Bearer-авторизации", 400);
    }
  }
  if (!needsBearer || !submittedNoCodeEndpoint) {
    nextBearerToken = null;
  }
  if (isNoCodeMode) {
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
  updates.noCodeFileEventsUrl = submittedNoCodeFileEvents;
  if (normalized.noCodeFileStorageProviderId !== undefined) {
    updates.noCodeFileStorageProviderId = normalized.noCodeFileStorageProviderId;
  }
  updates.noCodeAuthType = submittedNoCodeAuth;
  if (nextBearerToken !== undefined) {
    updates.noCodeBearerToken = nextBearerToken ? encodeBearerToken(nextBearerToken) : null;
  }
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
    historyMessagesLimit: row.ragHistoryMessagesLimit ?? DEFAULT_RAG_CONFIG.historyMessagesLimit,
    historyCharsLimit: row.ragHistoryCharsLimit ?? DEFAULT_RAG_CONFIG.historyCharsLimit,
    enableQueryRewriting: row.ragEnableQueryRewriting ?? DEFAULT_RAG_CONFIG.enableQueryRewriting,
    queryRewriteModel: row.ragQueryRewriteModel ?? DEFAULT_RAG_CONFIG.queryRewriteModel,
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
  const hasKnowledgeBases = normalized.knowledgeBaseIds
    ? normalized.knowledgeBaseIds.length > 0
    : Boolean(row.ragCollectionIds && row.ragCollectionIds.length > 0);
  const inferredMode: SkillMode = hasKnowledgeBases ? "rag" : "llm";
  const effectiveMode = normalized.mode ?? normalizeSkillMode(row.mode) ?? inferredMode;
  const isStandardMode = effectiveMode === "llm";
  const nextRagConfig = isStandardMode ? { ...DEFAULT_RAG_CONFIG } : ragUpdates ?? currentRagConfig;

  // Обновляем mode, если он изменился (например, при добавлении/удалении БЗ)
  const currentMode = normalizeSkillMode(row.mode);
  if (effectiveMode !== currentMode) {
    updates.mode = effectiveMode;
    console.log(`[SKILL UPDATE] mode changed: ${currentMode} -> ${effectiveMode} (skillId=${skillId}, hasKnowledgeBases=${hasKnowledgeBases})`);
  }

  let knowledgeBaseIdsForValidation: string[];
  if (isStandardMode) {
    knowledgeBaseIdsForValidation = [];
  } else if (normalized.knowledgeBaseIds !== undefined) {
    const validKnowledgeBases = await filterWorkspaceKnowledgeBases(workspaceId, normalized.knowledgeBaseIds);

    if (validKnowledgeBases.length !== normalized.knowledgeBaseIds.length) {
      throw new SkillServiceError("Некоторые базы знаний не найдены в рабочем пространстве", 400);
    }
    knowledgeBaseIdsForValidation = validKnowledgeBases;
  } else {
    knowledgeBaseIdsForValidation = await getSkillKnowledgeBaseIds(skillId, workspaceId);
  }

  // Валидация embedding-провайдера для выбранных БЗ
  if (knowledgeBaseIdsForValidation.length > 0) {
    const indexingRules = await indexingRulesService.getIndexingRules();
    const embeddingProviderId = indexingRules.embeddingsProvider;
    if (!embeddingProviderId || embeddingProviderId.trim().length === 0) {
      throw new SkillServiceError(
        "Для использования баз знаний необходимо настроить embedding-провайдер в правилах индексации (Админ → Правила индексации → Навыки)",
        400,
        "EMBEDDING_PROVIDER_NOT_CONFIGURED",
      );
    }
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
          throw new SkillServiceError(error.message, error.status ?? 400);
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
              ragHistoryMessagesLimit: ragUpdates.historyMessagesLimit,
              ragHistoryCharsLimit: ragUpdates.historyCharsLimit,
              ragEnableQueryRewriting: ragUpdates.enableQueryRewriting,
              ragQueryRewriteModel: ragUpdates.queryRewriteModel,
              ragEnableContextCaching: ragUpdates.enableContextCaching,
              ragContextCacheTtlSeconds: ragUpdates.contextCacheTtlSeconds,
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
  if (isStandardMode) {
    knowledgeBaseIds = await replaceSkillKnowledgeBases(skillId, workspaceId, []);
  } else if (normalized.knowledgeBaseIds !== undefined) {
    knowledgeBaseIds = await replaceSkillKnowledgeBases(skillId, workspaceId, knowledgeBaseIdsForValidation);
  } else {
    knowledgeBaseIds = knowledgeBaseIdsForValidation;
  }

  const selectedProviderId = normalizeNullableString(updatedRow.noCodeFileStorageProviderId);
  providerInfo = await resolveSkillFileStorageProvider({
    workspaceId,
    selectedProviderId,
  });

  const result = mapSkillRow(updatedRow, knowledgeBaseIds, providerInfo);
  
  // Invalidate and update skill cache (2 minutes TTL)
  const cache = getCache();
  await cache.del(cacheKeys.skill(workspaceId, skillId));
  await cache.set(cacheKeys.skill(workspaceId, skillId), result, 2 * 60 * 1000);

  return result;
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
    const providerInfo = await resolveSkillFileStorageProvider({
      workspaceId,
      selectedProviderId: normalizeNullableString(row.noCodeFileStorageProviderId),
    });
    return { skill: mapSkillRow(row, knowledgeBaseIds, providerInfo), archivedChats: 0 };
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
  const providerInfo = await resolveSkillFileStorageProvider({
    workspaceId,
    selectedProviderId: normalizeNullableString(updatedSkill.noCodeFileStorageProviderId ?? null),
  });
  const period = getUsagePeriodForDate(updatedSkill.updatedAt ? new Date(updatedSkill.updatedAt) : new Date());
  await adjustWorkspaceObjectCounters(workspaceId, { skillsDelta: -1 }, period);

  const resultSkill = mapSkillRow(updatedSkill, knowledgeBaseIds, providerInfo);
  
  // Invalidate and update skill cache (2 minutes TTL)
  const cache = getCache();
  await cache.del(cacheKeys.skill(workspaceId, skillId));
  await cache.set(cacheKeys.skill(workspaceId, skillId), resultSkill, 2 * 60 * 1000);

  return {
    skill: resultSkill,
    archivedChats: archivedChatsResult.length,
  };
}



export async function getSkillById(
  workspaceId: string,
  skillId: string,
): Promise<SkillDto | null> {
  const cache = getCache();
  const cacheKey = cacheKeys.skill(workspaceId, skillId);
  
  // Try cache first
  const cached = await cache.get<SkillDto>(cacheKey);
  if (cached !== null) {
    return cached;
  }
  
  // Cache miss - fetch from DB
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
  const providerInfo = await resolveSkillFileStorageProvider({
    workspaceId,
    selectedProviderId: normalizeNullableString(row.noCodeFileStorageProviderId),
  });
  const result = mapSkillRow(row, knowledgeBaseIds, providerInfo);
  
  // Cache result (2 minutes TTL)
  await cache.set(cacheKey, result, 2 * 60 * 1000);
  
  return result;
}

export async function getSkillBearerToken(opts: { workspaceId: string; skillId: string }): Promise<string | null> {
  const rows = await db
    .select({ bearerToken: skills.noCodeBearerToken })
    .from(skills)
    .where(and(eq(skills.id, opts.skillId), eq(skills.workspaceId, opts.workspaceId)))
    .limit(1);

  const tokenRaw = rows[0]?.bearerToken ?? null;
  const decoded = decodeBearerToken(tokenRaw);
  const normalized = typeof decoded === "string" ? decoded.trim() : "";
  return normalized.length > 0 ? normalized : null;
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
  const targetRow = updated ?? existing;
  const providerInfo = await resolveSkillFileStorageProvider({
    workspaceId,
    selectedProviderId: normalizeNullableString(targetRow.noCodeFileStorageProviderId),
  });
  const skill = mapSkillRow(targetRow, knowledgeBaseIds, providerInfo);

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

  // Проверить bearer token пользователя
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const storage = await getStorage();
  const user = await storage.getUserByPersonalApiTokenHash(tokenHash);
  if (!user) {
    throw new SkillServiceError("Некорректный API-токен", 401, CALLBACK_UNAUTHORIZED_CODE);
  }

  // Проверить доступ пользователя к workspace
  const workspace = await storage.getWorkspace(opts.workspaceId);
  if (!workspace) {
    throw new SkillServiceError("Рабочее пространство не найдено", 404);
  }

  const membership = await storage.getWorkspaceMember(user.id, opts.workspaceId);
  if (!membership || membership.status !== "active") {
    throw new SkillServiceError("Нет доступа к рабочему пространству", 403);
  }

  // Проверить, что chatId принадлежит workspaceId и получить навык
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

  // Проверить, что навык существует и находится в no-code режиме
  const skillRows = await db
    .select({
      id: skills.id,
      status: skills.status,
      executionMode: skills.executionMode,
    })
    .from(skills)
    .where(and(eq(skills.id, chat.skillId), eq(skills.workspaceId, opts.workspaceId)))
    .limit(1);

  const skill = skillRows[0];
  if (!skill) {
    throw new SkillServiceError("Навык не найден", 404);
  }

  if (normalizeSkillExecutionMode(skill.executionMode) !== "no_code") {
    throw new SkillServiceError("Навык не находится в no-code режиме", 409, "NO_CODE_MODE_REQUIRED");
  }

  if ((skill.status as SkillStatus) === "archived") {
    throw new SkillServiceError("Навык архивирован", 409);
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
    const providerInfo = await resolveSkillFileStorageProvider({
      workspaceId,
      selectedProviderId: normalizeNullableString(existingRow.noCodeFileStorageProviderId),
    });
    return mapSkillRow(existingRow, knowledgeBaseIds, providerInfo);
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
      ragHistoryMessagesLimit: ragConfig.historyMessagesLimit,
      ragHistoryCharsLimit: ragConfig.historyCharsLimit,
      ragEnableQueryRewriting: ragConfig.enableQueryRewriting,
      ragQueryRewriteModel: ragConfig.queryRewriteModel,
      ragEnableContextCaching: ragConfig.enableContextCaching,
      ragContextCacheTtlSeconds: ragConfig.contextCacheTtlSeconds,
    })
    .returning();

  const providerInfo = await resolveSkillFileStorageProvider({
    workspaceId,
    selectedProviderId: normalizeNullableString(inserted.noCodeFileStorageProviderId),
  });

  return mapSkillRow(inserted, [], providerInfo);
}
