import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { skills, skillKnowledgeBases, knowledgeBases, skillRagModes } from "@shared/schema";
import type { SkillDto, SkillRagConfig, CreateSkillPayload } from "@shared/skills";
import type { SkillRagMode } from "@shared/schema";

export class SkillServiceError extends Error {
  public status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SkillServiceError";
    this.status = status;
  }
}

type SkillRow = typeof skills.$inferSelect;
type KnowledgeBaseRelationRow = { knowledgeBaseId: string };
type KnowledgeBaseIdRow = { id: string };
type SkillKnowledgeBaseLinkRow = { skillId: string; knowledgeBaseId: string };
type EditableSkillColumns = Pick<
  SkillRow,
  "name" | "description" | "systemPrompt" | "modelId" | "llmProviderConfigId" | "collectionName"
>;

type RagConfigInput = CreateSkillPayload["ragConfig"];

type SkillEditableInput = Partial<EditableSkillColumns> & {
  knowledgeBaseIds?: string[];
  ragConfig?: RagConfigInput;
};

type NormalizedSkillEditableInput = Omit<SkillEditableInput, "ragConfig"> & {
  ragConfig?: SkillRagConfig;
};

const DEFAULT_RAG_CONFIG: SkillRagConfig = {
  mode: "all_collections",
  collectionIds: [],
  topK: 5,
  minScore: 0.7,
  maxContextTokens: 3000,
  showSources: true,
};

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

const isSkillRagMode = (value: unknown): value is SkillRagMode =>
  typeof value === "string" &&
  skillRagModes.includes(value as SkillRagMode);

const normalizeRagModeFromValue = (value: unknown): SkillRagMode =>
  isSkillRagMode(value) ? value : DEFAULT_RAG_CONFIG.mode;

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

  return {
    mode: normalizeRagModeFromValue(input.mode),
    collectionIds: normalizeCollectionIds(input.collectionIds),
    topK: sanitizedTopK,
    minScore: sanitizedMinScore,
    maxContextTokens: sanitizedMaxContextTokens,
    showSources: input.showSources ?? DEFAULT_RAG_CONFIG.showSources,
  };
}

function mapSkillRow(row: SkillRow, knowledgeBaseIds: string[]): SkillDto {
  const toIso = (value: Date | string): string =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();

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
    knowledgeBaseIds,
    ragConfig: {
      mode: normalizeRagModeFromValue(row.ragMode),
      collectionIds: (row.ragCollectionIds ?? []) as string[],
      topK: row.ragTopK ?? DEFAULT_RAG_CONFIG.topK,
      minScore: row.ragMinScore ?? DEFAULT_RAG_CONFIG.minScore,
      maxContextTokens: row.ragMaxContextTokens ?? DEFAULT_RAG_CONFIG.maxContextTokens,
      showSources: row.ragShowSources ?? DEFAULT_RAG_CONFIG.showSources,
    },
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

export async function listSkills(workspaceId: string): Promise<SkillDto[]> {
  const rows: SkillRow[] = await db
    .select()
    .from(skills)
    .where(eq(skills.workspaceId, workspaceId))
    .orderBy(asc(skills.createdAt));

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
  



  const normalized = buildEditableColumns(input);
  const validKnowledgeBases = normalized.knowledgeBaseIds
    ? await filterWorkspaceKnowledgeBases(workspaceId, normalized.knowledgeBaseIds)
    : [];

  if ((normalized.knowledgeBaseIds?.length ?? 0) !== validKnowledgeBases.length) {
    throw new SkillServiceError("Некоторые базы знаний не найдены в рабочем пространстве", 400);
  }

  const ragConfig = normalized.ragConfig ?? { ...DEFAULT_RAG_CONFIG };

  const [inserted] = await db
    .insert(skills)
    .values({
      workspaceId,
      name: normalized.name,
      description: normalized.description,
      systemPrompt: normalized.systemPrompt,
      modelId: normalized.modelId,
      llmProviderConfigId: normalized.llmProviderConfigId,
      collectionName: normalized.collectionName,
      ragMode: ragConfig.mode,
      ragCollectionIds: ragConfig.collectionIds,
      ragTopK: ragConfig.topK,
      ragMinScore: ragConfig.minScore,
      ragMaxContextTokens: ragConfig.maxContextTokens,
      ragShowSources: ragConfig.showSources,
    })
    .returning();

  const knowledgeBaseIds = await replaceSkillKnowledgeBases(inserted.id, workspaceId, validKnowledgeBases);

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
    throw new SkillServiceError("????????? ?????? ?????? ?????? ?? ?????? ???????? ????????????", 403);
  }

  const normalized = buildEditableColumns(input);
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

  let updatedRow = row;
  const ragUpdates = normalized.ragConfig;
  const hasRagUpdates = ragUpdates !== undefined;
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
    const validKnowledgeBases = await filterWorkspaceKnowledgeBases(
      workspaceId,
      normalized.knowledgeBaseIds,
    );

    if (validKnowledgeBases.length !== normalized.knowledgeBaseIds.length) {
      throw new SkillServiceError("Некоторые базы знаний не найдены в рабочем пространстве", 400);
    }

    knowledgeBaseIds = await replaceSkillKnowledgeBases(skillId, workspaceId, validKnowledgeBases);
  } else {
    knowledgeBaseIds = await getSkillKnowledgeBaseIds(skillId, workspaceId);
  }

  return mapSkillRow(updatedRow, knowledgeBaseIds);
}

export async function deleteSkill(workspaceId: string, skillId: string): Promise<boolean> {

  const existing = await db

    .select({ id: skills.id, isSystem: skills.isSystem })

    .from(skills)

    .where(and(eq(skills.workspaceId, workspaceId), eq(skills.id, skillId)))

    .limit(1);



  const row = existing[0];

  if (!row) {

    return false;

  }



  if (row.isSystem) {

    throw new SkillServiceError("????????? ?????? ?????? ??????? ?? ???????? ????????????", 403);

  }



  await db.delete(skills).where(and(eq(skills.workspaceId, workspaceId), eq(skills.id, skillId)));

  return true;

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

