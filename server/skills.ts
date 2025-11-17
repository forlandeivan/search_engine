import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import { skills, skillKnowledgeBases, knowledgeBases } from "@shared/schema";
import type { SkillDto } from "@shared/skills";

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

type SkillEditableInput = Partial<EditableSkillColumns> & {
  knowledgeBaseIds?: string[];
};

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
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
    knowledgeBaseIds,
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

function buildEditableColumns(input: SkillEditableInput): SkillEditableInput {
  const next: SkillEditableInput = {};

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

  const normalized = buildEditableColumns(input);
  const updates: Partial<EditableSkillColumns> = {};

  (Object.keys(normalized) as (keyof SkillEditableInput)[]).forEach((key) => {
    if (key === "knowledgeBaseIds") {
      return;
    }
    if (normalized[key] !== undefined) {
      (updates as Record<string, unknown>)[key] = normalized[key];
    }
  });

  let updatedRow = row;
  if (Object.keys(updates).length > 0) {
    const [updated] = await db
      .update(skills)
      .set({
        ...updates,
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
  const result = await db
    .delete(skills)
    .where(and(eq(skills.workspaceId, workspaceId), eq(skills.id, skillId)))
    .returning({ id: skills.id });

  return result.length > 0;
}
