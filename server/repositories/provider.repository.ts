/**
 * Provider Repository
 * 
 * Handles all provider-related database operations (LLM, Embedding, Speech).
 * Extracted from storage.ts for better code organization.
 */

import { eq, and, sql, desc, or } from 'drizzle-orm';
import {
  llmProviders,
  embeddingProviders,
  speechProviders,
  speechProviderSecrets,
  type LlmProvider,
  type LlmProviderInsert,
  type EmbeddingProvider,
  type EmbeddingProviderInsert,
  type SpeechProvider,
  type SpeechProviderInsert,
  type SpeechProviderSecret,
} from '@shared/schema';
import { db } from './base.repository';
import { createLogger } from '../lib/logger';

const logger = createLogger('provider-repository');

/**
 * Provider Repository - handles all provider data operations
 */
export const providerRepository = {
  // LLM Providers

  /**
   * List LLM providers
   */
  async listLlmProviders(workspaceId?: string): Promise<LlmProvider[]> {
    if (workspaceId) {
      return await db
        .select()
        .from(llmProviders)
        .where(
          or(
            eq(llmProviders.workspaceId, workspaceId), 
            eq(llmProviders.isGlobal, true),
            sql`${llmProviders.workspaceId} IS NULL`
          ),
        )
        .orderBy(desc(llmProviders.createdAt));
    }
    return await db.select().from(llmProviders).orderBy(desc(llmProviders.createdAt));
  },

  /**
   * Get LLM provider by ID
   */
  async getLlmProvider(id: string, workspaceId?: string): Promise<LlmProvider | undefined> {
    const condition = workspaceId
      ? and(
          eq(llmProviders.id, id),
          or(
            eq(llmProviders.workspaceId, workspaceId), 
            eq(llmProviders.isGlobal, true),
            sql`${llmProviders.workspaceId} IS NULL`
          ),
        )
      : eq(llmProviders.id, id);
    const [provider] = await db.select().from(llmProviders).where(condition);
    return provider ?? undefined;
  },

  /**
   * Create LLM provider
   */
  async createLlmProvider(provider: LlmProviderInsert): Promise<LlmProvider> {
    const [created] = await db.insert(llmProviders).values(provider).returning();
    if (!created) {
      throw new Error('Не удалось создать LLM провайдера');
    }
    return created;
  },

  /**
   * Update LLM provider
   */
  async updateLlmProvider(
    id: string,
    updates: Partial<LlmProviderInsert>,
    workspaceId?: string,
  ): Promise<LlmProvider | undefined> {
    const condition = workspaceId
      ? and(
          eq(llmProviders.id, id),
          or(
            eq(llmProviders.workspaceId, workspaceId), 
            eq(llmProviders.isGlobal, true),
            sql`${llmProviders.workspaceId} IS NULL`
          ),
        )
      : eq(llmProviders.id, id);

    const [updated] = await db
      .update(llmProviders)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(condition)
      .returning();
    return updated ?? undefined;
  },

  /**
   * Delete LLM provider
   */
  async deleteLlmProvider(id: string, workspaceId?: string): Promise<boolean> {
    const condition = workspaceId
      ? and(
          eq(llmProviders.id, id),
          or(
            eq(llmProviders.workspaceId, workspaceId), 
            sql`${llmProviders.workspaceId} IS NULL`
          )
        )
      : eq(llmProviders.id, id);

    const deleted = await db
      .delete(llmProviders)
      .where(condition)
      .returning({ id: llmProviders.id });
    return deleted.length > 0;
  },

  // Embedding Providers

  /**
   * List embedding providers
   */
  async listEmbeddingProviders(workspaceId?: string): Promise<EmbeddingProvider[]> {
    if (workspaceId) {
      return await db
        .select()
        .from(embeddingProviders)
        .where(
          or(
            eq(embeddingProviders.workspaceId, workspaceId), 
            eq(embeddingProviders.isGlobal, true),
            sql`${embeddingProviders.workspaceId} IS NULL`
          ),
        )
        .orderBy(desc(embeddingProviders.createdAt));
    }
    return await db.select().from(embeddingProviders).orderBy(desc(embeddingProviders.createdAt));
  },

  /**
   * Get embedding provider by ID
   */
  async getEmbeddingProvider(id: string, workspaceId?: string): Promise<EmbeddingProvider | undefined> {
    const condition = workspaceId
      ? and(
          eq(embeddingProviders.id, id),
          or(
            eq(embeddingProviders.workspaceId, workspaceId), 
            eq(embeddingProviders.isGlobal, true),
            sql`${embeddingProviders.workspaceId} IS NULL`
          ),
        )
      : eq(embeddingProviders.id, id);
    const [provider] = await db.select().from(embeddingProviders).where(condition);
    return provider ?? undefined;
  },

  /**
   * Create embedding provider
   */
  async createEmbeddingProvider(provider: EmbeddingProviderInsert): Promise<EmbeddingProvider> {
    const [created] = await db.insert(embeddingProviders).values(provider).returning();
    if (!created) {
      throw new Error('Не удалось создать провайдера эмбеддингов');
    }
    return created;
  },

  /**
   * Update embedding provider
   */
  async updateEmbeddingProvider(
    id: string,
    updates: Partial<EmbeddingProviderInsert>,
    workspaceId?: string,
  ): Promise<EmbeddingProvider | undefined> {
    const condition = workspaceId
      ? and(
          eq(embeddingProviders.id, id),
          or(
            eq(embeddingProviders.workspaceId, workspaceId), 
            eq(embeddingProviders.isGlobal, true),
            sql`${embeddingProviders.workspaceId} IS NULL`
          ),
        )
      : eq(embeddingProviders.id, id);

    const [updated] = await db
      .update(embeddingProviders)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(condition)
      .returning();
    return updated ?? undefined;
  },

  /**
   * Delete embedding provider
   */
  async deleteEmbeddingProvider(id: string, workspaceId?: string): Promise<boolean> {
    const condition = workspaceId
      ? and(
          eq(embeddingProviders.id, id),
          or(
            eq(embeddingProviders.workspaceId, workspaceId), 
            sql`${embeddingProviders.workspaceId} IS NULL`
          )
        )
      : eq(embeddingProviders.id, id);

    const deleted = await db
      .delete(embeddingProviders)
      .where(condition)
      .returning({ id: embeddingProviders.id });
    return deleted.length > 0;
  },

  // Speech Providers

  /**
   * List speech providers
   */
  async listSpeechProviders(): Promise<SpeechProvider[]> {
    return await db.select().from(speechProviders).orderBy(desc(speechProviders.createdAt));
  },

  /**
   * Get speech provider by ID
   */
  async getSpeechProvider(id: string): Promise<SpeechProvider | undefined> {
    const [provider] = await db.select().from(speechProviders).where(eq(speechProviders.id, id));
    return provider ?? undefined;
  },

  /**
   * Update speech provider
   */
  async updateSpeechProvider(
    id: string,
    updates: Partial<SpeechProviderInsert>,
  ): Promise<SpeechProvider | undefined> {
    const [updated] = await db
      .update(speechProviders)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(speechProviders.id, id))
      .returning();
    return updated ?? undefined;
  },

  // Speech Provider Secrets

  /**
   * Get speech provider secrets
   */
  async getSpeechProviderSecrets(providerId: string): Promise<SpeechProviderSecret[]> {
    return await db
      .select()
      .from(speechProviderSecrets)
      .where(eq(speechProviderSecrets.providerId, providerId));
  },

  /**
   * Upsert speech provider secret
   */
  async upsertSpeechProviderSecret(
    providerId: string,
    secretKey: string,
    secretValue: string,
  ): Promise<void> {
    const [existing] = await db
      .select()
      .from(speechProviderSecrets)
      .where(
        and(
          eq(speechProviderSecrets.providerId, providerId),
          eq(speechProviderSecrets.secretKey, secretKey),
        ),
      );

    if (existing) {
      await db
        .update(speechProviderSecrets)
        .set({ secretValue, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(
          and(
            eq(speechProviderSecrets.providerId, providerId),
            eq(speechProviderSecrets.secretKey, secretKey),
          ),
        );
    } else {
      await db.insert(speechProviderSecrets).values({
        providerId,
        secretKey,
        secretValue,
      });
    }
  },

  /**
   * Delete speech provider secret
   */
  async deleteSpeechProviderSecret(providerId: string, secretKey: string): Promise<void> {
    await db
      .delete(speechProviderSecrets)
      .where(
        and(
          eq(speechProviderSecrets.providerId, providerId),
          eq(speechProviderSecrets.secretKey, secretKey),
        ),
      );
  },
};
