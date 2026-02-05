/**
 * Skill Repository
 * 
 * Handles all skill-related database operations.
 * Extracted from storage.ts for better code organization.
 */

import { eq, and, sql, desc, or, isNull, inArray } from 'drizzle-orm';
import {
  skills,
  skillFiles,
  skillFileIngestionJobs,
  type SkillFile,
  type SkillFileInsert,
  type SkillFileIngestionJob,
  type SkillFileIngestionJobInsert,
} from '@shared/schema';
import { db } from './base.repository';
import { createLogger } from '../lib/logger';

const logger = createLogger('skill-repository');

/**
 * Skill Repository - handles all skill data operations
 */
export const skillRepository = {
  // Skill Files

  /**
   * Create skill files in batch
   */
  async createFiles(files: SkillFileInsert[]): Promise<SkillFile[]> {
    if (files.length === 0) {
      return [];
    }
    const created = await db.insert(skillFiles).values(files).returning();
    return created;
  },

  /**
   * List skill files
   */
  async listFiles(workspaceId: string, skillId: string): Promise<SkillFile[]> {
    return await db
      .select()
      .from(skillFiles)
      .where(and(eq(skillFiles.workspaceId, workspaceId), eq(skillFiles.skillId, skillId)))
      .orderBy(desc(skillFiles.createdAt));
  },

  /**
   * Get skill file by ID
   */
  async getFile(id: string, workspaceId: string, skillId: string): Promise<SkillFile | undefined> {
    const [file] = await db
      .select()
      .from(skillFiles)
      .where(
        and(
          eq(skillFiles.id, id),
          eq(skillFiles.workspaceId, workspaceId),
          eq(skillFiles.skillId, skillId),
        ),
      );
    return file ?? undefined;
  },

  /**
   * Delete skill file
   */
  async deleteFile(id: string, workspaceId: string, skillId: string): Promise<boolean> {
    const deleted = await db
      .delete(skillFiles)
      .where(
        and(
          eq(skillFiles.id, id),
          eq(skillFiles.workspaceId, workspaceId),
          eq(skillFiles.skillId, skillId),
        ),
      )
      .returning({ id: skillFiles.id });
    return deleted.length > 0;
  },

  /**
   * Update skill file status
   */
  async updateFileStatus(
    id: string,
    status: SkillFile['status'],
    meta?: {
      errorMessage?: string | null;
      vectorChunkCount?: number | null;
      vectorStorageKey?: string | null;
    },
  ): Promise<SkillFile | undefined> {
    const updates: Record<string, unknown> = {
      status,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    };

    if (meta?.errorMessage !== undefined) {
      updates.errorMessage = meta.errorMessage;
    }
    if (meta?.vectorChunkCount !== undefined) {
      updates.vectorChunkCount = meta.vectorChunkCount;
    }
    if (meta?.vectorStorageKey !== undefined) {
      updates.vectorStorageKey = meta.vectorStorageKey;
    }

    const [updated] = await db
      .update(skillFiles)
      .set(updates)
      .where(eq(skillFiles.id, id))
      .returning();
    return updated ?? undefined;
  },

  /**
   * List ready skill file IDs
   */
  async listReadyFileIds(workspaceId: string, skillId: string): Promise<string[]> {
    const rows = await db
      .select({ id: skillFiles.id })
      .from(skillFiles)
      .where(
        and(
          eq(skillFiles.workspaceId, workspaceId),
          eq(skillFiles.skillId, skillId),
          eq(skillFiles.status, 'ready'),
        ),
      );
    return rows.map((row: { id: string }) => row.id);
  },

  /**
   * Check if skill has ready files
   */
  async hasReadyFiles(workspaceId: string, skillId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: skillFiles.id })
      .from(skillFiles)
      .where(
        and(
          eq(skillFiles.workspaceId, workspaceId),
          eq(skillFiles.skillId, skillId),
          eq(skillFiles.status, 'ready'),
        ),
      )
      .limit(1);
    return Boolean(row);
  },

  // Skill File Ingestion Jobs

  /**
   * Create ingestion job
   */
  async createIngestionJob(values: SkillFileIngestionJobInsert): Promise<SkillFileIngestionJob> {
    const [created] = await db.insert(skillFileIngestionJobs).values(values).returning();
    return created;
  },

  /**
   * Claim next pending ingestion job
   */
  async claimNextIngestionJob(now: Date = new Date()): Promise<SkillFileIngestionJob | null> {
    const [job] = await db
      .update(skillFileIngestionJobs)
      .set({
        status: 'running',
        attempts: sql`${skillFileIngestionJobs.attempts} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(skillFileIngestionJobs.status, 'pending'),
          or(
            isNull(skillFileIngestionJobs.nextRetryAt),
            sql`${skillFileIngestionJobs.nextRetryAt} <= ${now}`,
          ),
        ),
      )
      .returning();
    return job ?? null;
  },

  /**
   * Mark ingestion job as done
   */
  async markIngestionJobDone(
    id: string,
    result?: { vectorChunkCount?: number | null },
  ): Promise<SkillFileIngestionJob | null> {
    const updates: Record<string, unknown> = {
      status: 'done',
      updatedAt: sql`CURRENT_TIMESTAMP`,
    };

    if (result?.vectorChunkCount !== undefined) {
      updates.vectorChunkCount = result.vectorChunkCount;
    }

    const [updated] = await db
      .update(skillFileIngestionJobs)
      .set(updates)
      .where(eq(skillFileIngestionJobs.id, id))
      .returning();
    return updated ?? null;
  },

  /**
   * Reschedule ingestion job
   */
  async rescheduleIngestionJob(
    id: string,
    nextRetryAt: Date,
    error?: string | null,
  ): Promise<SkillFileIngestionJob | null> {
    const [updated] = await db
      .update(skillFileIngestionJobs)
      .set({
        status: 'pending',
        nextRetryAt,
        lastError: error ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(skillFileIngestionJobs.id, id))
      .returning();
    return updated ?? null;
  },

  /**
   * Fail ingestion job
   */
  async failIngestionJob(id: string, error?: string | null): Promise<SkillFileIngestionJob | null> {
    const [updated] = await db
      .update(skillFileIngestionJobs)
      .set({
        status: 'error',
        lastError: error ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(skillFileIngestionJobs.id, id))
      .returning();
    return updated ?? null;
  },

  /**
   * Find ingestion job by file ID
   */
  async findIngestionJobByFileId(fileId: string): Promise<SkillFileIngestionJob | null> {
    const [job] = await db
      .select()
      .from(skillFileIngestionJobs)
      .where(eq(skillFileIngestionJobs.fileId, fileId))
      .orderBy(desc(skillFileIngestionJobs.createdAt))
      .limit(1);
    return job ?? null;
  },
};
