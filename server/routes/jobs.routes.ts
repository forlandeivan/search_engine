/**
 * Jobs Routes Module
 * 
 * Handles background job operations (crawling, indexing):
 * - GET /api/jobs/:jobId - Get job status
 * - POST /api/jobs/:jobId/pause - Pause job
 * - POST /api/jobs/:jobId/resume - Resume job
 * - POST /api/jobs/:jobId/cancel - Cancel job
 * - POST /api/jobs/:jobId/retry - Retry job
 * - GET /api/jobs/:jobId/sse - Subscribe to job updates via SSE
 */

import { Router, type Response } from 'express';
import { createLogger } from '../lib/logger';
import {
  getKnowledgeBaseCrawlJob,
  pauseKnowledgeBaseCrawl,
  resumeKnowledgeBaseCrawl,
  cancelKnowledgeBaseCrawl,
  retryKnowledgeBaseCrawl,
  subscribeKnowledgeBaseCrawlJob,
  type KnowledgeBaseCrawlJobStatus,
} from '../kb-crawler';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('jobs');

export const jobsRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: Request): PublicUser | null {
  return (req as Request & { user?: PublicUser }).user ?? null;
}

function getRequestWorkspace(req: Request): { id: string } {
  // Check header first (most common from frontend)
  const headerWorkspaceRaw = req.headers["x-workspace-id"];
  const headerWorkspaceId = Array.isArray(headerWorkspaceRaw)
    ? headerWorkspaceRaw[0]
    : typeof headerWorkspaceRaw === "string"
      ? headerWorkspaceRaw.trim()
      : undefined;

  const workspaceId = req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    headerWorkspaceId ||
    req.params.workspaceId ||
    req.query.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: String(workspaceId) };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /:jobId
 * Get job status
 */
jobsRouter.get('/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = getKnowledgeBaseCrawlJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  return res.json({ job });
});

/**
 * POST /:jobId/pause
 * Pause job
 */
jobsRouter.post('/:jobId/pause', (req, res) => {
  const { jobId } = req.params;
  const job = pauseKnowledgeBaseCrawl(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  return res.json({ job });
});

/**
 * POST /:jobId/resume
 * Resume job
 */
jobsRouter.post('/:jobId/resume', (req, res) => {
  const { jobId } = req.params;
  const job = resumeKnowledgeBaseCrawl(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  return res.json({ job });
});

/**
 * POST /:jobId/cancel
 * Cancel job
 */
jobsRouter.post('/:jobId/cancel', (req, res) => {
  const { jobId } = req.params;
  const job = cancelKnowledgeBaseCrawl(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  return res.json({ job });
});

/**
 * POST /:jobId/retry
 * Retry failed job
 */
jobsRouter.post('/:jobId/retry', (req, res) => {
  const { jobId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);

  try {
    const job = retryKnowledgeBaseCrawl(jobId, workspaceId);
    if (!job) {
      return res.status(404).json({ error: 'Задача не найдена' });
    }
    return res.status(201).json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось перезапустить краулинг';
    return res.status(409).json({ error: message });
  }
});

/**
 * GET /:jobId/sse
 * Subscribe to job updates via Server-Sent Events
 */
jobsRouter.get('/:jobId/sse', (req, res) => {
  const { jobId } = req.params;
  const job = getKnowledgeBaseCrawlJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  res.flushHeaders?.();

  const sendEvent = (event: KnowledgeBaseCrawlJobStatus) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  sendEvent(job);

  const unsubscribe = subscribeKnowledgeBaseCrawlJob(jobId, sendEvent);
  if (!unsubscribe) {
    res.end();
    return;
  }

  req.on('close', () => {
    unsubscribe();
    res.end();
  });
});

export default jobsRouter;
