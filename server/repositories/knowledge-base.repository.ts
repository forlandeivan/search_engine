/**
 * Knowledge Base Repository
 * 
 * Handles all knowledge base related database operations.
 * Extracted from storage.ts for better code organization.
 */

import { eq, desc, and, sql, inArray, or } from 'drizzle-orm';
import {
  knowledgeBases,
  knowledgeDocuments,
  knowledgeDocumentChunkItems,
  knowledgeDocumentChunkSets,
  knowledgeBaseSearchSettings,
  knowledgeBaseAskAiRuns,
  knowledgeBaseRagRequests,
  knowledgeBaseIndexingJobs,
  knowledgeBaseIndexingPolicy,
  knowledgeBaseIndexingActions,
  knowledgeDocumentIndexRevisions,
  knowledgeDocumentIndexState,
  knowledgeBaseIndexState,
  type KnowledgeBaseSearchSettingsRow,
  type KnowledgeBaseChunkSearchSettings,
  type KnowledgeBaseRagSearchSettings,
  type KnowledgeBaseAskAiRun,
  type KnowledgeBaseAskAiRunInsert,
  type KnowledgeBaseIndexingJob,
  type KnowledgeBaseIndexingJobInsert,
  type KnowledgeBaseIndexingPolicy,
  type KnowledgeBaseIndexingActionRecord,
  type KnowledgeBaseIndexingActionInsert,
  type KnowledgeDocumentIndexRevisionRecord,
  type KnowledgeDocumentIndexRevisionInsert,
  type KnowledgeDocumentIndexStateRecord,
  type KnowledgeDocumentIndexStateInsert,
  type KnowledgeBaseIndexStateRecord,
  type KnowledgeBaseIndexStateInsert,
} from '@shared/schema';
import { db } from './base.repository';
import { createLogger } from '../lib/logger';

const logger = createLogger('knowledge-base-repository');

/**
 * Knowledge base row type
 */
export interface KnowledgeBaseRow {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  collection?: string | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

/**
 * Knowledge chunk for search results
 */
export interface KnowledgeChunk {
  id: string;
  documentId: string;
  chunkSetId: string;
  content: string;
  heading?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  createdAt?: Date | null;
}

/**
 * Ask AI run record input
 */
export interface KnowledgeBaseAskAiRunRecordInput {
  workspaceId: string;
  knowledgeBaseId: string;
  question: string;
  answer?: string | null;
  generatedAt?: Date | null;
  chunksCount?: number | null;
  llmProviderId?: string | null;
  llmModel?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  chunkTokens?: number | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  pipelineStepsLog?: unknown[] | null;
}

/**
 * Knowledge Base Repository
 */
export const knowledgeBaseRepository = {
  /**
   * Get knowledge base by ID
   */
  async getById(baseId: string): Promise<KnowledgeBaseRow | null> {
    const [kb] = await db.select().from(knowledgeBases).where(eq(knowledgeBases.id, baseId));
    return kb ?? null;
  },

  /**
   * Get search settings for knowledge base
   */
  async getSearchSettings(knowledgeBaseId: string): Promise<KnowledgeBaseSearchSettingsRow | null> {
    const [settings] = await db
      .select()
      .from(knowledgeBaseSearchSettings)
      .where(eq(knowledgeBaseSearchSettings.knowledgeBaseId, knowledgeBaseId));
    return settings ?? null;
  },

  /**
   * Upsert search settings
   */
  async upsertSearchSettings(
    knowledgeBaseId: string,
    workspaceId: string,
    settings: {
      chunkSettings?: Partial<KnowledgeBaseChunkSearchSettings>;
      ragSettings?: Partial<KnowledgeBaseRagSearchSettings>;
    },
  ): Promise<KnowledgeBaseSearchSettingsRow | null> {
    const existing = await this.getSearchSettings(knowledgeBaseId);

    const chunkSettingsValue = settings.chunkSettings
      ? { ...(existing?.chunkSettings || {}), ...settings.chunkSettings }
      : existing?.chunkSettings || null;

    const ragSettingsValue = settings.ragSettings
      ? { ...(existing?.ragSettings || {}), ...settings.ragSettings }
      : existing?.ragSettings || null;

    if (existing) {
      const [updated] = await db
        .update(knowledgeBaseSearchSettings)
        .set({
          chunkSettings: chunkSettingsValue,
          ragSettings: ragSettingsValue,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(knowledgeBaseSearchSettings.knowledgeBaseId, knowledgeBaseId))
        .returning();
      return updated ?? null;
    }

    const [created] = await db
      .insert(knowledgeBaseSearchSettings)
      .values({
        workspaceId,
        knowledgeBaseId,
        chunkSettings: chunkSettingsValue,
        ragSettings: ragSettingsValue,
      })
      .returning();
    return created ?? null;
  },

  /**
   * Get chunks by IDs
   */
  async getChunksByIds(
    chunkIds: string[],
    options?: { includeContent?: boolean },
  ): Promise<KnowledgeChunk[]> {
    if (chunkIds.length === 0) {
      return [];
    }

    const selectFields: Record<string, unknown> = {
      id: knowledgeDocumentChunkItems.id,
      documentId: knowledgeDocumentChunkItems.documentId,
      chunkSetId: knowledgeDocumentChunkItems.chunkSetId,
      charStart: knowledgeDocumentChunkItems.charStart,
      charEnd: knowledgeDocumentChunkItems.charEnd,
      sectionPath: knowledgeDocumentChunkItems.sectionPath,
      createdAt: knowledgeDocumentChunkItems.createdAt,
    };

    if (options?.includeContent !== false) {
      selectFields.text = knowledgeDocumentChunkItems.text;
    }

    const rows = await db
      .select(selectFields as any)
      .from(knowledgeDocumentChunkItems)
      .where(inArray(knowledgeDocumentChunkItems.id, chunkIds));

    return rows.map((row: any) => ({
      id: row.id,
      documentId: row.documentId,
      chunkSetId: row.chunkSetId,
      content: row.text || '',
      heading: row.sectionPath?.[0] ?? null,
      startOffset: row.charStart ?? null,
      endOffset: row.charEnd ?? null,
      createdAt: row.createdAt ?? null,
    }));
  },

  /**
   * Record RAG request
   */
  async recordRagRequest(entry: {
    workspaceId: string;
    knowledgeBaseId: string;
    topK?: number | null;
    bm25Weight?: number | null;
    bm25Limit?: number | null;
    vectorWeight?: number | null;
    vectorLimit?: number | null;
    embeddingProviderId?: string | null;
    collection?: string | null;
  }): Promise<void> {
    await db.insert(knowledgeBaseRagRequests).values({
      workspaceId: entry.workspaceId,
      knowledgeBaseId: entry.knowledgeBaseId,
      topK: entry.topK ?? null,
      bm25Weight: entry.bm25Weight ?? null,
      bm25Limit: entry.bm25Limit ?? null,
      vectorWeight: entry.vectorWeight ?? null,
      vectorLimit: entry.vectorLimit ?? null,
      embeddingProviderId: entry.embeddingProviderId ?? null,
      collection: entry.collection ?? null,
    });
  },

  /**
   * Record Ask AI run
   */
  async recordAskAiRun(entry: KnowledgeBaseAskAiRunRecordInput): Promise<void> {
    await db.insert(knowledgeBaseAskAiRuns).values({
      workspaceId: entry.workspaceId,
      knowledgeBaseId: entry.knowledgeBaseId,
      question: entry.question,
      answer: entry.answer ?? null,
      generatedAt: entry.generatedAt ?? null,
      chunksCount: entry.chunksCount ?? null,
      llmProviderId: entry.llmProviderId ?? null,
      llmModel: entry.llmModel ?? null,
      inputTokens: entry.inputTokens ?? null,
      outputTokens: entry.outputTokens ?? null,
      chunkTokens: entry.chunkTokens ?? null,
      errorMessage: entry.errorMessage ?? null,
      durationMs: entry.durationMs ?? null,
      pipelineStepsLog: entry.pipelineStepsLog ?? null,
    });
  },

  /**
   * List Ask AI runs
   */
  async listAskAiRuns(
    knowledgeBaseId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<KnowledgeBaseAskAiRun[]> {
    let query = db
      .select()
      .from(knowledgeBaseAskAiRuns)
      .where(eq(knowledgeBaseAskAiRuns.knowledgeBaseId, knowledgeBaseId))
      .orderBy(desc(knowledgeBaseAskAiRuns.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    return await query;
  },

  /**
   * Get Ask AI run by ID
   */
  async getAskAiRun(id: string): Promise<KnowledgeBaseAskAiRun | null> {
    const [run] = await db
      .select()
      .from(knowledgeBaseAskAiRuns)
      .where(eq(knowledgeBaseAskAiRuns.id, id));
    return run ?? null;
  },

  // Indexing Policy

  /**
   * Get indexing policy
   */
  async getIndexingPolicy(): Promise<KnowledgeBaseIndexingPolicy | null> {
    const [policy] = await db.select().from(knowledgeBaseIndexingPolicy).limit(1);
    return policy ?? null;
  },

  /**
   * Update indexing policy
   */
  async updateIndexingPolicy(
    updates: Partial<Omit<KnowledgeBaseIndexingPolicy, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<KnowledgeBaseIndexingPolicy | null> {
    const existing = await this.getIndexingPolicy();

    if (existing) {
      const [updated] = await db
        .update(knowledgeBaseIndexingPolicy)
        .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(knowledgeBaseIndexingPolicy.id, existing.id))
        .returning();
      return updated ?? null;
    }

    const [created] = await db
      .insert(knowledgeBaseIndexingPolicy)
      .values(updates as any)
      .returning();
    return created ?? null;
  },

  // Indexing Jobs

  /**
   * Create indexing job
   */
  async createIndexingJob(values: KnowledgeBaseIndexingJobInsert): Promise<KnowledgeBaseIndexingJob> {
    const [created] = await db.insert(knowledgeBaseIndexingJobs).values(values).returning();
    return created;
  },

  /**
   * Claim next pending indexing job
   */
  async claimNextIndexingJob(now: Date = new Date()): Promise<KnowledgeBaseIndexingJob | null> {
    const [job] = await db
      .update(knowledgeBaseIndexingJobs)
      .set({
        status: 'processing',
        attempts: sql`${knowledgeBaseIndexingJobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeBaseIndexingJobs.status, 'pending'),
          or(
            sql`${knowledgeBaseIndexingJobs.nextRetryAt} IS NULL`,
            sql`${knowledgeBaseIndexingJobs.nextRetryAt} <= ${now}`,
          ),
        ),
      )
      .returning();
    return job ?? null;
  },

  /**
   * Count indexing jobs by status
   */
  async countIndexingJobs(status: string): Promise<number> {
    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(knowledgeBaseIndexingJobs)
      .where(sql`${knowledgeBaseIndexingJobs.status} = ${status}`);
    return Number(result?.count ?? 0);
  },

  // Document Index State

  /**
   * Upsert document index state
   */
  async upsertDocumentIndexState(
    values: KnowledgeDocumentIndexStateInsert,
  ): Promise<KnowledgeDocumentIndexStateRecord | null> {
    const [existing] = await db
      .select()
      .from(knowledgeDocumentIndexState)
      .where(eq(knowledgeDocumentIndexState.documentId, values.documentId));

    if (existing) {
      const [updated] = await db
        .update(knowledgeDocumentIndexState)
        .set({ ...values, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(knowledgeDocumentIndexState.documentId, values.documentId))
        .returning();
      return updated ?? null;
    }

    const [created] = await db
      .insert(knowledgeDocumentIndexState)
      .values(values)
      .returning();
    return created ?? null;
  },

  /**
   * Get document index state
   */
  async getDocumentIndexState(documentId: string): Promise<KnowledgeDocumentIndexStateRecord | null> {
    const [state] = await db
      .select()
      .from(knowledgeDocumentIndexState)
      .where(eq(knowledgeDocumentIndexState.documentId, documentId));
    return state ?? null;
  },

  // Knowledge Base Index State

  /**
   * Upsert knowledge base index state
   */
  async upsertKnowledgeBaseIndexState(
    values: KnowledgeBaseIndexStateInsert,
  ): Promise<KnowledgeBaseIndexStateRecord | null> {
    const [existing] = await db
      .select()
      .from(knowledgeBaseIndexState)
      .where(eq(knowledgeBaseIndexState.baseId, values.baseId));

    if (existing) {
      const [updated] = await db
        .update(knowledgeBaseIndexState)
        .set({ ...values, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(knowledgeBaseIndexState.baseId, values.baseId))
        .returning();
      return updated ?? null;
    }

    const [created] = await db.insert(knowledgeBaseIndexState).values(values).returning();
    return created ?? null;
  },

  /**
   * Get knowledge base index state
   */
  async getKnowledgeBaseIndexState(
    baseId: string,
  ): Promise<KnowledgeBaseIndexStateRecord | null> {
    const [state] = await db
      .select()
      .from(knowledgeBaseIndexState)
      .where(eq(knowledgeBaseIndexState.baseId, baseId));
    return state ?? null;
  },

  // Indexing Actions

  /**
   * Create indexing action
   */
  async createIndexingAction(
    values: KnowledgeBaseIndexingActionInsert,
  ): Promise<KnowledgeBaseIndexingActionRecord> {
    const [created] = await db.insert(knowledgeBaseIndexingActions).values(values).returning();
    return created;
  },

  /**
   * Get indexing action by ID
   */
  async getIndexingAction(id: string): Promise<KnowledgeBaseIndexingActionRecord | null> {
    const [action] = await db
      .select()
      .from(knowledgeBaseIndexingActions)
      .where(eq(knowledgeBaseIndexingActions.id, id));
    return action ?? null;
  },

  /**
   * List indexing actions history
   */
  async listIndexingActionsHistory(
    baseId: string,
    options?: { limit?: number },
  ): Promise<KnowledgeBaseIndexingActionRecord[]> {
    let query = db
      .select()
      .from(knowledgeBaseIndexingActions)
      .where(eq(knowledgeBaseIndexingActions.baseId, baseId))
      .orderBy(desc(knowledgeBaseIndexingActions.createdAt));

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    return await query;
  },

  // Document Index Revisions

  /**
   * Create document index revision
   */
  async createDocumentIndexRevision(
    values: KnowledgeDocumentIndexRevisionInsert,
  ): Promise<KnowledgeDocumentIndexRevisionRecord> {
    const [created] = await db.insert(knowledgeDocumentIndexRevisions).values(values).returning();
    return created;
  },

  /**
   * Get document index revision
   */
  async getDocumentIndexRevision(id: string): Promise<KnowledgeDocumentIndexRevisionRecord | null> {
    const [revision] = await db
      .select()
      .from(knowledgeDocumentIndexRevisions)
      .where(eq(knowledgeDocumentIndexRevisions.id, id));
    return revision ?? null;
  },
};
