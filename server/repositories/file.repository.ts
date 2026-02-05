/**
 * File Repository
 * 
 * Handles all file-related database operations.
 * Extracted from storage.ts for better code organization.
 */

import { eq, and, sql, or, isNull } from 'drizzle-orm';
import {
  files,
  fileEventOutbox,
  fileStorageProviders,
  type File,
  type FileInsert,
  type FileEventOutbox,
  type FileEventOutboxInsert,
  type FileStorageProvider,
  type FileStorageProviderInsert,
} from '@shared/schema';
import { db } from './base.repository';
import { createLogger } from '../lib/logger';

const logger = createLogger('file-repository');

/**
 * File Repository - handles all file data operations
 */
export const fileRepository = {
  /**
   * Create a new file
   */
  async create(file: FileInsert): Promise<File> {
    const [created] = await db.insert(files).values(file).returning();
    if (!created) {
      throw new Error('Не удалось создать файл');
    }
    return created;
  },

  /**
   * Get file by ID
   */
  async getById(id: string, workspaceId?: string): Promise<File | undefined> {
    const condition = workspaceId
      ? and(eq(files.id, id), eq(files.workspaceId, workspaceId))
      : eq(files.id, id);
    const [file] = await db.select().from(files).where(condition);
    return file ?? undefined;
  },

  /**
   * Update file
   */
  async update(id: string, updates: Partial<FileInsert>): Promise<File | undefined> {
    const [updated] = await db
      .update(files)
      .set({
        ...updates,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(files.id, id))
      .returning();
    return updated ?? undefined;
  },

  // File Event Outbox

  /**
   * Enqueue a file event
   */
  async enqueueEvent(event: FileEventOutboxInsert): Promise<FileEventOutbox> {
    const [created] = await db
      .insert(fileEventOutbox)
      .values({
        ...event,
        status: 'queued',
        attempts: 0,
      })
      .returning();
    if (!created) {
      throw new Error('Не удалось добавить событие файла в очередь');
    }
    return created;
  },

  /**
   * Claim next pending file event
   */
  async claimNextEvent(now: Date = new Date()): Promise<FileEventOutbox | null> {
    const [event] = await db
      .update(fileEventOutbox)
      .set({
        status: 'retrying',
        attempts: sql`${fileEventOutbox.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(fileEventOutbox.status, 'queued'),
          or(
            isNull(fileEventOutbox.nextAttemptAt),
            sql`${fileEventOutbox.nextAttemptAt} <= ${now}`,
          ),
        ),
      )
      .returning();
    return event ?? null;
  },

  /**
   * Mark file event as sent
   */
  async markEventSent(id: string): Promise<void> {
    await db
      .update(fileEventOutbox)
      .set({
        status: 'sent',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(fileEventOutbox.id, id));
  },

  /**
   * Reschedule file event
   */
  async rescheduleEvent(id: string, nextAttemptAt: Date, error?: string | null): Promise<void> {
    await db
      .update(fileEventOutbox)
      .set({
        status: 'retrying',
        nextAttemptAt,
        lastError: error ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(fileEventOutbox.id, id));
  },

  /**
   * Mark file event as failed
   */
  async failEvent(id: string, error?: string | null): Promise<void> {
    await db
      .update(fileEventOutbox)
      .set({
        status: 'failed',
        lastError: error ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(fileEventOutbox.id, id));
  },

  // File Storage Providers

  /**
   * List file storage providers
   */
  async listStorageProviders(): Promise<FileStorageProvider[]> {
    return await db
      .select()
      .from(fileStorageProviders)
      .orderBy(fileStorageProviders.createdAt);
  },

  /**
   * Get storage provider by ID
   */
  async getStorageProvider(id: string): Promise<FileStorageProvider | undefined> {
    const [provider] = await db
      .select()
      .from(fileStorageProviders)
      .where(eq(fileStorageProviders.id, id));
    return provider ?? undefined;
  },

  /**
   * Create storage provider
   */
  async createStorageProvider(provider: FileStorageProviderInsert): Promise<FileStorageProvider> {
    const [created] = await db.insert(fileStorageProviders).values(provider).returning();
    if (!created) {
      throw new Error('Не удалось создать провайдера хранения');
    }
    return created;
  },

  /**
   * Update storage provider
   */
  async updateStorageProvider(
    id: string,
    updates: Partial<FileStorageProviderInsert>,
  ): Promise<FileStorageProvider | undefined> {
    const [updated] = await db
      .update(fileStorageProviders)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(fileStorageProviders.id, id))
      .returning();
    return updated ?? undefined;
  },

  /**
   * Delete storage provider
   */
  async deleteStorageProvider(id: string): Promise<boolean> {
    const deleted = await db
      .delete(fileStorageProviders)
      .where(eq(fileStorageProviders.id, id))
      .returning({ id: fileStorageProviders.id });
    return deleted.length > 0;
  },
};
