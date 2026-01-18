/**
 * Canvas Documents Routes Module
 * 
 * Handles canvas document operations:
 * - GET /api/chats/:chatId/canvas-documents - List canvas documents for chat
 * - GET /api/transcripts/:transcriptId/canvas-documents - List canvas documents for transcript
 * - POST /api/canvas-documents - Create canvas document
 * - PATCH /api/canvas-documents/:id - Update canvas document
 * - DELETE /api/canvas-documents/:id - Delete canvas document
 * - POST /api/canvas-documents/:id/duplicate - Duplicate canvas document
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('canvas');

export const canvasRouter = Router();

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

// ============================================================================
// Validation Schemas
// ============================================================================

const createCanvasDocumentSchema = z.object({
  chatId: z.string().trim().min(1),
  transcriptId: z.string().trim().min(1).optional(),
  skillId: z.string().trim().min(1).optional(),
  actionId: z.string().trim().min(1).optional(),
  type: z.enum(['text', 'code', 'markdown']).optional().default('text'),
  title: z.string().trim().min(1).max(255),
  content: z.string().optional().default(''),
  isDefault: z.boolean().optional(),
});

const updateCanvasDocumentSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: z.string().optional(),
  isDefault: z.boolean().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /chats/:chatId/canvas-documents
 * List canvas documents for a chat
 */
canvasRouter.get('/chats/:chatId/canvas-documents', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { chatId } = req.params;
  const chat = await storage.getChatSessionById(chatId);
  if (!chat) {
    return res.status(404).json({ message: 'Чат не найден' });
  }
  
  const isMember = await storage.isWorkspaceMember(chat.workspaceId, user.id);
  if (!isMember) {
    return res.status(403).json({ message: 'Нет доступа к этому workspace' });
  }
  
  const documents = await storage.listCanvasDocumentsByChat(chatId);
  res.json({ documents });
}));

/**
 * GET /transcripts/:transcriptId/canvas-documents
 * List canvas documents for a transcript
 */
canvasRouter.get('/transcripts/:transcriptId/canvas-documents', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { transcriptId } = req.params;
  const transcript = await storage.getTranscriptById?.(transcriptId);
  if (!transcript) {
    return res.status(404).json({ message: 'Стенограмма не найдена' });
  }
  
  const isMember = await storage.isWorkspaceMember(transcript.workspaceId, user.id);
  if (!isMember) {
    return res.status(403).json({ message: 'Нет доступа к этому workspace' });
  }
  
  const documents = await storage.listCanvasDocumentsByTranscript(transcriptId);
  res.json({ documents });
}));

/**
 * POST /canvas-documents
 * Create a new canvas document
 */
canvasRouter.post('/canvas-documents', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createCanvasDocumentSchema.parse(req.body ?? {});
  const chat = await storage.getChatSessionById(payload.chatId);
  if (!chat) {
    return res.status(404).json({ message: 'Чат не найден' });
  }
  
  const isMember = await storage.isWorkspaceMember(chat.workspaceId, user.id);
  if (!isMember) {
    return res.status(403).json({ message: 'Нет доступа к этому workspace' });
  }
  
  if (payload.transcriptId) {
    const transcript = await storage.getTranscriptById?.(payload.transcriptId);
    if (!transcript || transcript.chatId !== chat.id) {
      return res.status(400).json({ message: 'Стенограмма не принадлежит чату' });
    }
  }
  
  const document = await storage.createCanvasDocument({
    workspaceId: chat.workspaceId,
    chatId: payload.chatId,
    transcriptId: payload.transcriptId,
    skillId: payload.skillId,
    actionId: payload.actionId,
    type: payload.type,
    title: payload.title,
    content: payload.content,
    isDefault: payload.isDefault ?? false,
    createdByUserId: user.id,
  });
  
  if (payload.isDefault) {
    await storage.setDefaultCanvasDocument(payload.chatId, document.id);
  }
  
  res.status(201).json({ document });
}));

/**
 * PATCH /canvas-documents/:id
 * Update a canvas document
 */
canvasRouter.patch('/canvas-documents/:id', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id } = req.params;
  const document = await storage.getCanvasDocument(id);
  if (!document || document.deletedAt) {
    return res.status(404).json({ message: 'Документ не найден' });
  }
  
  const isMember = await storage.isWorkspaceMember(document.workspaceId, user.id);
  if (!isMember) {
    return res.status(403).json({ message: 'Нет доступа к этому workspace' });
  }
  
  const payload = updateCanvasDocumentSchema.parse(req.body ?? {});
  const updated = await storage.updateCanvasDocument(id, {
    title: payload.title,
    content: payload.content,
    isDefault: payload.isDefault,
  });
  
  if (payload.isDefault) {
    await storage.setDefaultCanvasDocument(document.chatId, id);
  }
  
  res.json({ document: updated });
}));

/**
 * DELETE /canvas-documents/:id
 * Soft delete a canvas document
 */
canvasRouter.delete('/canvas-documents/:id', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id } = req.params;
  const document = await storage.getCanvasDocument(id);
  if (!document || document.deletedAt) {
    return res.status(404).json({ message: 'Документ не найден' });
  }
  
  const isMember = await storage.isWorkspaceMember(document.workspaceId, user.id);
  if (!isMember) {
    return res.status(403).json({ message: 'Нет доступа к этому workspace' });
  }
  
  await storage.softDeleteCanvasDocument(id);
  res.status(204).send();
}));

/**
 * POST /canvas-documents/:id/duplicate
 * Duplicate a canvas document
 */
canvasRouter.post('/canvas-documents/:id/duplicate', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id } = req.params;
  const { title } = (req.body ?? {}) as { title?: string };
  const document = await storage.getCanvasDocument(id);
  if (!document || document.deletedAt) {
    return res.status(404).json({ message: 'Документ не найден' });
  }
  
  const isMember = await storage.isWorkspaceMember(document.workspaceId, user.id);
  if (!isMember) {
    return res.status(403).json({ message: 'Нет доступа к этому workspace' });
  }
  
  const duplicated = await storage.duplicateCanvasDocument(id, title);
  if (!duplicated) {
    return res.status(400).json({ message: 'Не удалось дублировать документ' });
  }
  
  res.status(201).json({ document: duplicated });
}));

// Error handler for this router
canvasRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: 'Некорректные данные', details: err.issues });
  }
  next(err);
});

export default canvasRouter;
