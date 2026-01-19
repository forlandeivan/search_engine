/**
 * Knowledge Base Indexing Routes Module
 * 
 * Handles knowledge base indexing operations:
 * - POST /api/knowledge/bases/:baseId/indexing/actions/start - Start indexing action
 * - POST /api/knowledge/bases/:baseId/indexing/actions/update - Update indexing action
 * - GET /api/knowledge/bases/:baseId/indexing/actions/status - Get indexing status
 * - GET /api/knowledge/bases/:baseId/indexing/actions/history - Get indexing history
 * - GET /api/knowledge/bases/:baseId/indexing/actions/:actionId/logs - Get action logs
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { knowledgeBaseIndexingActionsService } from '../knowledge-base-indexing-actions';
import type { IndexingStage, KnowledgeBaseIndexingActionStatus } from '@shared/schema';
import {
  KnowledgeBaseError,
  getKnowledgeBaseIndexingChanges,
  resetKnowledgeBaseIndex,
  listKnowledgeBases,
} from '../knowledge-base';
import { deleteIndexedDataForAction } from '../knowledge-base-indexing-cleanup';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('knowledge-indexing');

export const knowledgeIndexingRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: Request): PublicUser | null {
  return (req as Request & { user?: PublicUser }).user ?? null;
}

function getAuthorizedUser(req: Request, res: Response): PublicUser | null {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return null;
  }
  return user;
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
 * POST /bases/:baseId/indexing/actions/start
 * Start a new indexing action
 */
knowledgeIndexingRouter.post('/bases/:baseId/indexing/actions/start', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const { actionId, initialStage } = req.body as { actionId?: string; initialStage?: string };

  const action = await knowledgeBaseIndexingActionsService.start(
    workspaceId,
    baseId,
    actionId,
    initialStage as IndexingStage | undefined,
  );
  res.json(action);
}));

/**
 * POST /bases/:baseId/indexing/actions/update
 * Update indexing action status
 */
knowledgeIndexingRouter.post('/bases/:baseId/indexing/actions/update', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const { actionId, status, stage, displayText, payload } = req.body as {
    actionId: string;
    status?: string;
    stage?: string;
    displayText?: string | null;
    payload?: Record<string, unknown> | null;
  };

  if (!actionId) {
    return res.status(400).json({ error: 'actionId обязателен' });
  }

  const action = await knowledgeBaseIndexingActionsService.update(workspaceId, baseId, actionId, {
    status: status as KnowledgeBaseIndexingActionStatus | undefined,
    stage: stage as IndexingStage | undefined,
    displayText,
    payload,
  });
  
  if (!action) {
    return res.status(404).json({ error: 'Статус индексации не найден' });
  }
  res.json(action);
}));

/**
 * GET /bases/:baseId/indexing/actions/status
 * Get current or specific indexing action status
 */
knowledgeIndexingRouter.get('/bases/:baseId/indexing/actions/status', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const { actionId } = req.query as { actionId?: string };

  let action;
  if (actionId) {
    action = await knowledgeBaseIndexingActionsService.get(workspaceId, baseId, actionId);
  } else {
    action = await knowledgeBaseIndexingActionsService.getLatest(workspaceId, baseId);
  }
  
  if (!action) {
    return res.status(404).json({ error: 'Статус индексации не найден' });
  }
  res.json(action);
}));

/**
 * GET /bases/:baseId/indexing/actions/history
 * Get indexing actions history
 */
knowledgeIndexingRouter.get('/bases/:baseId/indexing/actions/history', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = limitRaw ? Math.min(Math.max(1, Number(limitRaw)), 100) : 25;

  const history = await knowledgeBaseIndexingActionsService.listHistory(workspaceId, baseId, limit);
  
  const items = history.map((action) => ({
    actionId: action.actionId,
    status: action.status,
    stage: action.stage,
    displayText: action.displayText,
    startedAt: action.createdAt ?? new Date().toISOString(),
    finishedAt: action.status === 'processing' ? null : action.updatedAt,
    userId: action.userId,
    userName: action.userName,
    userEmail: action.userEmail,
    totalDocuments: action.totalDocuments,
    processedDocuments: action.processedDocuments,
    failedDocuments: action.failedDocuments,
    totalChunks: action.totalChunks,
  }));

  res.json({ items });
}));

/**
 * GET /bases/:baseId/indexing/actions/:actionId/logs
 * Get logs for a specific indexing action
 */
knowledgeIndexingRouter.get('/bases/:baseId/indexing/actions/:actionId/logs', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId, actionId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const limit = limitRaw ? Math.min(Math.max(1, Number(limitRaw)), 500) : 100;
  const offsetRaw = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
  const offset = offsetRaw ? Math.max(0, Number(offsetRaw)) : 0;

  const action = await knowledgeBaseIndexingActionsService.get(workspaceId, baseId, actionId);
  if (!action) {
    return res.status(404).json({ error: 'Статус индексации не найден' });
  }

  const logs = await storage.listKnowledgeBaseIndexingActionLogs(actionId, { limit, offset });
  res.json({
    actionId,
    logs: logs.items,
    hasMore: logs.hasMore,
    nextOffset: logs.nextOffset,
  });
}));

/**
 * POST /bases/:baseId/indexing/reset
 * Reset indexing (delete collection and optionally reindex)
 */
knowledgeIndexingRouter.post('/bases/:baseId/indexing/reset', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const deleteCollection = payload.deleteCollection !== false;
  const reindex = payload.reindex !== false;

  logger.info({ userId: user.id, workspaceId, baseId, deleteCollection, reindex }, 'Indexing reset requested');
  
  const result = await resetKnowledgeBaseIndex(baseId, workspaceId, {
    deleteCollection,
    reindex,
    userId: user.id,
  });
  
  logger.info({
    userId: user.id,
    workspaceId,
    baseId,
    deletedCollection: result.deletedCollection,
    jobCount: result.jobCount,
    actionId: result.actionId ?? null,
  }, 'Indexing reset completed');
  
  res.json(result);
}));

/**
 * GET /indexing/active
 * Get all active indexing actions for workspace
 */
knowledgeIndexingRouter.get('/indexing/active', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);

  // Получаем все базы знаний workspace
  const bases = await listKnowledgeBases(workspaceId);
  
  logger.info({ workspaceId, baseCount: bases.length }, 'Fetching active indexing actions');
  
  // Для каждой базы получаем последний action
  const activeActions = await Promise.all(
    bases.map(async (base) => {
      const action = await knowledgeBaseIndexingActionsService.getLatest(workspaceId, base.id);
      if (action) {
        logger.debug({ 
          baseId: base.id, 
          baseName: base.name, 
          actionId: action.actionId, 
          status: action.status 
        }, 'Found action for base');
        
        if (action.status === "processing" || action.status === "paused") {
          return {
            ...action,
            baseName: base.name ?? "Без названия",
          };
        }
      }
      return null;
    }),
  );

  const filtered = activeActions.filter((action): action is NonNullable<typeof action> => action !== null);
  
  logger.info({ workspaceId, activeCount: filtered.length }, 'Returning active indexing actions');
  
  res.json({ actions: filtered });
}));

/**
 * GET /bases/:baseId/indexing/changes
 * Get indexing changes (documents pending indexing)
 */
knowledgeIndexingRouter.get('/bases/:baseId/indexing/changes', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const offsetRaw = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;

  const parseNumber = (value: unknown): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === 'string' && value.trim().length === 0) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return NaN;
  };

  const limitCandidate = parseNumber(limitRaw);
  if (limitCandidate !== undefined) {
    if (!Number.isInteger(limitCandidate) || limitCandidate < 1) {
      return res.status(400).json({ error: 'Некорректный параметр limit' });
    }
  }

  const offsetCandidate = parseNumber(offsetRaw);
  if (offsetCandidate !== undefined) {
    if (!Number.isInteger(offsetCandidate) || offsetCandidate < 0) {
      return res.status(400).json({ error: 'Некорректный параметр offset' });
    }
  }

  const limit = (limitCandidate ?? 50) as number;
  const offset = (offsetCandidate ?? 0) as number;

  const changes = await getKnowledgeBaseIndexingChanges(baseId, workspaceId, { limit, offset });
  res.json(changes);
}));

/**
 * POST /bases/:baseId/indexing/cancel
 * Cancel indexing action
 */
knowledgeIndexingRouter.post('/bases/:baseId/indexing/cancel', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const { actionId, deleteIndexedData } = req.body as { actionId?: string; deleteIndexedData?: boolean };

  logger.info({ userId: user.id, workspaceId, baseId, actionId, deleteIndexedData }, 'Indexing cancel requested');
  
  const result = await knowledgeBaseIndexingActionsService.cancel(
    workspaceId,
    baseId,
    actionId,
  );
  
  let cleanupResult = null;
  if (deleteIndexedData) {
    try {
      cleanupResult = await deleteIndexedDataForAction(workspaceId, baseId, result.actionId);
    } catch (error) {
      logger.error(
        { userId: user.id, workspaceId, baseId, actionId: result.actionId, error },
        'Failed to cleanup indexed data',
      );
      // Не прерываем отмену, если cleanup не удался
      cleanupResult = {
        deletedVectors: 0,
        deletedRevisions: 0,
        restoredDocuments: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }
  
  logger.info({
    userId: user.id,
    workspaceId,
    baseId,
    actionId: result.actionId,
    canceledJobs: result.canceledJobs,
    completedJobs: result.completedJobs,
    cleanupPerformed: deleteIndexedData,
  }, 'Indexing cancel completed');
  
  res.json({
    ...result,
    cleanup: cleanupResult,
  });
}));

/**
 * POST /bases/:baseId/indexing/pause
 * Pause indexing action
 */
knowledgeIndexingRouter.post('/bases/:baseId/indexing/pause', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const { actionId } = req.body as { actionId?: string };

  logger.info({ userId: user.id, workspaceId, baseId, actionId }, 'Indexing pause requested');
  
  const result = await knowledgeBaseIndexingActionsService.pause(
    workspaceId,
    baseId,
    actionId,
  );
  
  logger.info({
    userId: user.id,
    workspaceId,
    baseId,
    actionId: result.actionId,
    processedDocuments: result.processedDocuments,
    pendingDocuments: result.pendingDocuments,
  }, 'Indexing pause completed');
  
  res.json(result);
}));

/**
 * POST /bases/:baseId/indexing/resume
 * Resume indexing action
 */
knowledgeIndexingRouter.post('/bases/:baseId/indexing/resume', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const { actionId } = req.body as { actionId?: string };

  logger.info({ userId: user.id, workspaceId, baseId, actionId }, 'Indexing resume requested');
  
  const result = await knowledgeBaseIndexingActionsService.resume(
    workspaceId,
    baseId,
    actionId,
  );
  
  logger.info({
    userId: user.id,
    workspaceId,
    baseId,
    actionId: result.actionId,
    pendingDocuments: result.pendingDocuments,
  }, 'Indexing resume completed');
  
  res.json(result);
}));

// Error handler for this router
knowledgeIndexingRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof KnowledgeBaseError) {
    return res.status(err.status).json({ error: err.message });
  }
  next(err);
});

export default knowledgeIndexingRouter;
