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

import { Router, type Response } from 'express';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { knowledgeBaseIndexingActionsService } from '../knowledge-base-indexing-actions';
import { KnowledgeBaseError } from '../knowledge-base';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('knowledge-indexing');

export const knowledgeIndexingRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: any): PublicUser | null {
  return req.user as PublicUser | null;
}

function getAuthorizedUser(req: any, res: Response): PublicUser | null {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return null;
  }
  return user;
}

function getRequestWorkspace(req: any): { id: string } {
  const workspaceId = req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: workspaceId };
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
    initialStage as any,
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
    status: status as any,
    stage: stage as any,
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

// Error handler for this router
knowledgeIndexingRouter.use((err: Error, req: any, res: Response, next: any) => {
  if (err instanceof KnowledgeBaseError) {
    return res.status(err.status).json({ error: err.message });
  }
  next(err);
});

export default knowledgeIndexingRouter;
