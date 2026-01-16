/**
 * Vectorization Jobs Service
 * 
 * Shared state and utilities for document vectorization jobs.
 * Used by knowledge document vectorization endpoints.
 */

import type { KnowledgeDocumentVectorizationJobStatus, KnowledgeDocumentVectorizationJobResult } from '@shared/knowledge-base';

export type KnowledgeDocumentVectorizationJobInternal = KnowledgeDocumentVectorizationJobStatus & {
  workspaceId: string;
  result: KnowledgeDocumentVectorizationJobResult | null;
};

// In-memory storage for vectorization jobs
const knowledgeDocumentVectorizationJobs = new Map<string, KnowledgeDocumentVectorizationJobInternal>();
const knowledgeDocumentVectorizationJobCleanup = new Map<string, NodeJS.Timeout>();
const VECTORIZE_JOB_FAILURE_CLEANUP_DELAY_MS = 5_000;

export function getVectorizationJob(jobId: string): KnowledgeDocumentVectorizationJobInternal | undefined {
  return knowledgeDocumentVectorizationJobs.get(jobId);
}

export function setVectorizationJob(jobId: string, job: KnowledgeDocumentVectorizationJobInternal): void {
  knowledgeDocumentVectorizationJobs.set(jobId, job);
}

export function deleteVectorizationJob(jobId: string): void {
  knowledgeDocumentVectorizationJobs.delete(jobId);
}

export function updateVectorizationJob(
  jobId: string,
  patch: Partial<KnowledgeDocumentVectorizationJobInternal>,
): void {
  const current = knowledgeDocumentVectorizationJobs.get(jobId);
  if (!current) {
    return;
  }

  knowledgeDocumentVectorizationJobs.set(jobId, {
    ...current,
    ...patch,
  });
}

export function scheduleVectorizationJobCleanup(jobId: string, delayMs = 60_000): void {
  const existing = knowledgeDocumentVectorizationJobCleanup.get(jobId);
  if (existing) {
    clearTimeout(existing);
  }

  const timeout = setTimeout(() => {
    knowledgeDocumentVectorizationJobs.delete(jobId);
    knowledgeDocumentVectorizationJobCleanup.delete(jobId);
  }, delayMs);

  knowledgeDocumentVectorizationJobCleanup.set(jobId, timeout);
}

// Re-export the internal Map for direct access 
export { knowledgeDocumentVectorizationJobs };

// Aliases for backward compatibility with routes.ts naming
export const updateKnowledgeDocumentVectorizationJob = updateVectorizationJob;
export const scheduleKnowledgeDocumentVectorizationJobCleanup = scheduleVectorizationJobCleanup;
export { VECTORIZE_JOB_FAILURE_CLEANUP_DELAY_MS };
