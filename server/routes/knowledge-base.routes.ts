/**
 * Knowledge Base Routes Module
 * 
 * Handles knowledge base operations:
 * - GET /api/knowledge/bases - List knowledge bases
 * - POST /api/knowledge/bases - Create knowledge base (handled in routes.ts)
 * - DELETE /api/knowledge/bases/:baseId - Delete knowledge base
 * - GET /api/knowledge/bases/:baseId/nodes/:nodeId - Get node detail
 * - POST /api/knowledge/bases/:baseId/folders - Create folder
 * - POST /api/knowledge/bases/:baseId/documents - Create document
 * - PATCH /api/knowledge/bases/:baseId/nodes/:nodeId - Update node
 * - DELETE /api/knowledge/bases/:baseId/nodes/:nodeId - Delete node
 * - GET /api/knowledge/bases/:baseId/indexing/summary - Get indexing summary
 * - POST /api/knowledge/bases/:baseId/index - Start indexing
 */

import { Router, type Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import {
  listKnowledgeBases,
  deleteKnowledgeBase,
  getKnowledgeNodeDetail,
  createKnowledgeFolder,
  createKnowledgeDocument,
  updateKnowledgeDocument,
  deleteKnowledgeNode,
  getKnowledgeBaseIndexingSummary,
  startKnowledgeBaseIndexing,
  KnowledgeBaseError,
} from '../knowledge-base';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('knowledge-base');

export const knowledgeBaseRouter = Router();

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
// Validation Schemas
// ============================================================================

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().trim().min(1).optional(),
});

const createDocumentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  content: z.string().optional(),
  parentId: z.string().trim().min(1).optional(),
});

const updateNodeSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  content: z.string().optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /bases
 * List knowledge bases for workspace
 */
knowledgeBaseRouter.get('/bases', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const bases = await listKnowledgeBases(workspaceId);
  // Возвращаем просто массив, как ожидает фронтенд
  res.json(bases);
}));

/**
 * DELETE /bases/:baseId
 * Delete knowledge base
 */
knowledgeBaseRouter.delete('/bases/:baseId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  await deleteKnowledgeBase(workspaceId, req.params.baseId);
  res.status(204).send();
}));

/**
 * GET /bases/:baseId/nodes/:nodeId
 * Get node detail
 */
knowledgeBaseRouter.get('/bases/:baseId/nodes/:nodeId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const baseId = req.params.baseId;
  
  // Проверяем существует ли база и к какому workspace она принадлежит
  const baseCheck = await storage.getKnowledgeBase(baseId);
  logger.info({ 
    baseId, 
    workspaceId,
    baseExists: !!baseCheck,
    baseWorkspaceId: baseCheck?.workspaceId,
    matches: baseCheck?.workspaceId === workspaceId
  }, 'Getting node detail - base check');
  
  const node = await getKnowledgeNodeDetail(baseId, req.params.nodeId, workspaceId);
  
  if (!node) {
    return res.status(404).json({ message: 'Узел не найден' });
  }
  
  res.json({ node });
}));

/**
 * POST /bases/:baseId/folders
 * Create folder
 */
knowledgeBaseRouter.post('/bases/:baseId/folders', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createFolderSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const folder = await createKnowledgeFolder(workspaceId, req.params.baseId, {
    name: payload.name,
    parentId: payload.parentId,
  });
  
  res.status(201).json({ folder });
}));

/**
 * POST /bases/:baseId/documents
 * Create document
 */
knowledgeBaseRouter.post('/bases/:baseId/documents', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createDocumentSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const document = await createKnowledgeDocument(workspaceId, req.params.baseId, {
    name: payload.name,
    content: payload.content,
    parentId: payload.parentId,
    createdByUserId: user.id,
  });
  
  res.status(201).json({ document });
}));

/**
 * PATCH /bases/:baseId/nodes/:nodeId
 * Update node
 */
knowledgeBaseRouter.patch('/bases/:baseId/nodes/:nodeId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = updateNodeSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const node = await updateKnowledgeDocument(
    workspaceId, 
    req.params.baseId, 
    req.params.nodeId, 
    payload
  );
  
  res.json({ node });
}));

/**
 * DELETE /bases/:baseId/nodes/:nodeId
 * Delete node
 */
knowledgeBaseRouter.delete('/bases/:baseId/nodes/:nodeId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  await deleteKnowledgeNode(workspaceId, req.params.baseId, req.params.nodeId);
  res.status(204).send();
}));

/**
 * GET /bases/:baseId/indexing/summary
 * Get indexing summary
 */
knowledgeBaseRouter.get('/bases/:baseId/indexing/summary', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  try {
    const { id: workspaceId } = getRequestWorkspace(req);
    const baseId = req.params.baseId;
    
    // Проверяем существует ли база и к какому workspace она принадлежит
    const baseCheck = await storage.getKnowledgeBase(baseId);
    logger.info({ 
      baseId, 
      workspaceId,
      baseExists: !!baseCheck,
      baseWorkspaceId: baseCheck?.workspaceId,
      matches: baseCheck?.workspaceId === workspaceId
    }, 'Getting indexing summary - base check');
    
    const summary = await getKnowledgeBaseIndexingSummary(baseId, workspaceId);
    res.json(summary);
  } catch (error) {
    const baseCheck = await storage.getKnowledgeBase(req.params.baseId).catch(() => null);
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      baseId: req.params.baseId, 
      workspaceId: req.headers["x-workspace-id"],
      baseExists: !!baseCheck,
      baseWorkspaceId: baseCheck?.workspaceId,
    }, 'Error getting indexing summary');
    throw error;
  }
}));

/**
 * POST /bases/:baseId/index
 * Start indexing
 */
knowledgeBaseRouter.post('/bases/:baseId/index', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const result = await startKnowledgeBaseIndexing(workspaceId, req.params.baseId, {
    triggeredByUserId: user.id,
  });
  res.json(result);
}));

/**
 * GET /bases/:baseId/rag/config/latest
 * Get latest RAG configuration for knowledge base
 */
knowledgeBaseRouter.get('/bases/:baseId/rag/config/latest', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const config = await storage.getLatestKnowledgeBaseRagConfig(workspaceId, baseId);
  res.json({
    config: config ?? {
      workspaceId,
      knowledgeBaseId: baseId,
      topK: null,
      bm25: null,
      vector: null,
      recordedAt: null,
    },
  });
}));

/**
 * GET /bases/:baseId/ask-ai/runs
 * List Ask AI runs for knowledge base
 */
knowledgeBaseRouter.get('/bases/:baseId/ask-ai/runs', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const offsetParam = typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined;

  const result = await storage.listKnowledgeBaseAskAiRuns(workspaceId, baseId, {
    limit: Number.isFinite(limitParam) ? Number(limitParam) : undefined,
    offset: Number.isFinite(offsetParam) ? Number(offsetParam) : undefined,
  });

  res.json({
    items: result.items,
    hasMore: result.hasMore,
    nextOffset: result.nextOffset,
  });
}));

/**
 * GET /bases/:baseId/ask-ai/runs/:runId
 * Get Ask AI run detail
 */
knowledgeBaseRouter.get('/bases/:baseId/ask-ai/runs/:runId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId, runId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const run = await storage.getKnowledgeBaseAskAiRun(runId, workspaceId, baseId);
  if (!run) {
    return res.status(404).json({ error: 'Запуск не найден' });
  }

  res.json(run);
}));

// Error handler for this router
knowledgeBaseRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: 'Некорректные данные', details: err.issues });
  }
  if (err instanceof KnowledgeBaseError) {
    return res.status(err.status).json({ message: err.message });
  }
  next(err);
});

export default knowledgeBaseRouter;
