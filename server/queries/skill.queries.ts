/**
 * Skill Prepared Queries
 * 
 * Prepared statements for frequently used skill queries.
 * These are compiled once and reused for better performance.
 */

import { eq, desc, and, asc, sql } from 'drizzle-orm';
import { skills, skillFiles } from '@shared/schema';
import { db } from '../db';

/**
 * Get skill by ID - prepared statement
 * Used in skill operations
 */
export const getSkillByIdPrepared = db
  .select()
  .from(skills)
  .where(eq(skills.id, sql.placeholder('skillId')))
  .limit(1)
  .prepare('get_skill_by_id');

/**
 * List skills by workspace - prepared statement
 * Used when loading workspace skills
 */
export const listSkillsByWorkspacePrepared = db
  .select()
  .from(skills)
  .where(eq(skills.workspaceId, sql.placeholder('workspaceId')))
  .orderBy(desc(skills.createdAt))
  .prepare('list_skills_by_workspace');

/**
 * Get skill with RAG configuration - prepared statement
 * Used in chat/LLM operations (RAG config stored in skills table)
 */
export const getSkillWithRagConfigPrepared = db
  .select({
    id: skills.id,
    name: skills.name,
    mode: skills.mode,
    ragMode: skills.ragMode,
    ragCollectionIds: skills.ragCollectionIds,
    ragTopK: skills.ragTopK,
    ragMinScore: skills.ragMinScore,
    ragMaxContextTokens: skills.ragMaxContextTokens,
    ragShowSources: skills.ragShowSources,
    ragBm25Weight: skills.ragBm25Weight,
    ragBm25Limit: skills.ragBm25Limit,
    ragVectorWeight: skills.ragVectorWeight,
    ragVectorLimit: skills.ragVectorLimit,
    ragEmbeddingProviderId: skills.ragEmbeddingProviderId,
    ragLlmTemperature: skills.ragLlmTemperature,
    ragLlmMaxTokens: skills.ragLlmMaxTokens,
    ragLlmResponseFormat: skills.ragLlmResponseFormat,
    systemPrompt: skills.systemPrompt,
    llmProviderConfigId: skills.llmProviderConfigId,
    collectionName: skills.collectionName,
  })
  .from(skills)
  .where(eq(skills.id, sql.placeholder('skillId')))
  .limit(1)
  .prepare('get_skill_with_rag_config');

/**
 * List skill files - prepared statement
 * Used in skill file management
 */
export const listSkillFilesPrepared = db
  .select()
  .from(skillFiles)
  .where(eq(skillFiles.skillId, sql.placeholder('skillId')))
  .orderBy(asc(skillFiles.createdAt))
  .prepare('list_skill_files');

/**
 * Get skill file by ID - prepared statement
 * Used when downloading or viewing skill file
 */
export const getSkillFileByIdPrepared = db
  .select()
  .from(skillFiles)
  .where(
    and(
      eq(skillFiles.id, sql.placeholder('fileId')),
      eq(skillFiles.skillId, sql.placeholder('skillId')),
    ),
  )
  .limit(1)
  .prepare('get_skill_file_by_id');

// Type-safe execution helpers
export async function getSkillById(skillId: string) {
  const result = await getSkillByIdPrepared.execute({ skillId });
  return result[0] ?? undefined;
}

export async function listSkillsByWorkspace(workspaceId: string) {
  return await listSkillsByWorkspacePrepared.execute({ workspaceId });
}

export async function getSkillWithRagConfig(skillId: string) {
  const result = await getSkillWithRagConfigPrepared.execute({ skillId });
  return result[0] ?? null;
}

export async function listSkillFiles(skillId: string) {
  return await listSkillFilesPrepared.execute({ skillId });
}

export async function getSkillFileById(skillId: string, fileId: string) {
  const result = await getSkillFileByIdPrepared.execute({ skillId, fileId });
  return result[0] ?? undefined;
}
