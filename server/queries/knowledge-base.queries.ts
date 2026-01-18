/**
 * Knowledge Base Prepared Queries
 * 
 * Prepared statements for frequently used knowledge base queries.
 * These are compiled once and reused for better performance.
 */

import { eq, desc, and, inArray, sql, asc } from 'drizzle-orm';
import { 
  knowledgeBases, 
  knowledgeNodes, 
  knowledgeDocumentChunkItems,
  knowledgeBaseSearchSettings,
  knowledgeDocuments,
} from '@shared/schema';
import { db } from '../db';

/**
 * Get knowledge base by ID - prepared statement
 * Used in many KB operations
 */
export const getKnowledgeBaseByIdPrepared = db
  .select()
  .from(knowledgeBases)
  .where(eq(knowledgeBases.id, sql.placeholder('knowledgeBaseId')))
  .limit(1)
  .prepare('get_knowledge_base_by_id');

/**
 * List knowledge bases by workspace - prepared statement
 * Used when loading workspace KB list
 */
export const listKnowledgeBasesByWorkspacePrepared = db
  .select()
  .from(knowledgeBases)
  .where(eq(knowledgeBases.workspaceId, sql.placeholder('workspaceId')))
  .orderBy(desc(knowledgeBases.createdAt))
  .prepare('list_knowledge_bases_by_workspace');

/**
 * Get knowledge base search settings - prepared statement
 * Used in RAG operations
 */
export const getKnowledgeBaseSearchSettingsPrepared = db
  .select()
  .from(knowledgeBaseSearchSettings)
  .where(eq(knowledgeBaseSearchSettings.knowledgeBaseId, sql.placeholder('knowledgeBaseId')))
  .limit(1)
  .prepare('get_knowledge_base_search_settings');

/**
 * List nodes in knowledge base - prepared statement
 * Used when loading KB documents/folders
 */
export const listKnowledgeNodesPrepared = db
  .select()
  .from(knowledgeNodes)
  .where(eq(knowledgeNodes.baseId, sql.placeholder('knowledgeBaseId')))
  .orderBy(asc(knowledgeNodes.position), desc(knowledgeNodes.createdAt))
  .prepare('list_knowledge_nodes');

/**
 * Count nodes in knowledge base - prepared statement
 * Used for statistics
 */
export const countKnowledgeNodesPrepared = db
  .select({ count: sql<number>`COUNT(*)` })
  .from(knowledgeNodes)
  .where(eq(knowledgeNodes.baseId, sql.placeholder('knowledgeBaseId')))
  .prepare('count_knowledge_nodes');

/**
 * Count chunks in knowledge base - prepared statement
 * Used for statistics
 */
export const countKnowledgeChunksPrepared = db
  .select({ count: sql<number>`COUNT(*)` })
  .from(knowledgeDocumentChunkItems)
  .innerJoin(knowledgeDocuments, eq(knowledgeDocumentChunkItems.documentId, knowledgeDocuments.id))
  .where(eq(knowledgeDocuments.baseId, sql.placeholder('knowledgeBaseId')))
  .prepare('count_knowledge_chunks');

// Type-safe execution helpers
export async function getKnowledgeBaseById(knowledgeBaseId: string) {
  const result = await getKnowledgeBaseByIdPrepared.execute({ knowledgeBaseId });
  return result[0] ?? undefined;
}

export async function listKnowledgeBasesByWorkspace(workspaceId: string) {
  return await listKnowledgeBasesByWorkspacePrepared.execute({ workspaceId });
}

export async function getKnowledgeBaseSearchSettings(knowledgeBaseId: string) {
  const result = await getKnowledgeBaseSearchSettingsPrepared.execute({ knowledgeBaseId });
  return result[0] ?? null;
}

export async function listKnowledgeNodes(knowledgeBaseId: string) {
  return await listKnowledgeNodesPrepared.execute({ knowledgeBaseId });
}

export async function countKnowledgeNodes(knowledgeBaseId: string) {
  const result = await countKnowledgeNodesPrepared.execute({ knowledgeBaseId });
  return Number(result[0]?.count ?? 0);
}

export async function countKnowledgeChunks(knowledgeBaseId: string) {
  const result = await countKnowledgeChunksPrepared.execute({ knowledgeBaseId });
  return Number(result[0]?.count ?? 0);
}

/**
 * Get chunks by IDs - dynamic query (cannot be prepared with variable array length)
 */
export async function getKnowledgeChunksByIds(chunkIds: string[]) {
  if (chunkIds.length === 0) return [];
  
  return await db
    .select()
    .from(knowledgeDocumentChunkItems)
    .where(inArray(knowledgeDocumentChunkItems.id, chunkIds));
}
