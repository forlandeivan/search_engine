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
  res.json({ bases });
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
  const node = await getKnowledgeNodeDetail(workspaceId, req.params.baseId, req.params.nodeId);
  
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

  const { id: workspaceId } = getRequestWorkspace(req);
  const summary = await getKnowledgeBaseIndexingSummary(workspaceId, req.params.baseId);
  res.json(summary);
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
