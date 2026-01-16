/**
 * Chat Routes Module
 * 
 * Handles chat session operations:
 * - POST /api/chat/sessions - Create chat session
 * - PATCH /api/chat/sessions/:chatId - Rename chat
 * - DELETE /api/chat/sessions/:chatId - Delete chat
 * - GET /api/chat/sessions/:chatId/messages - Get messages
 * - POST /api/chat/sessions/:chatId/messages/llm - Send message to LLM
 */

import { Router, type Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import {
  ChatServiceError,
  buildChatServiceErrorPayload,
  createChat,
  renameChat,
  deleteChat,
  getChatMessages,
  listUserChats,
  mapMessage,
  mapChatSummary,
} from '../chat-service';
import { getSkillById, createUnicaChatSkillForWorkspace } from '../skills';
import { OperationBlockedError } from '../guards/errors';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('chat');

export const chatRouter = Router();

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
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: workspaceId };
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

function resolveWorkspaceIdForRequest(req: any, explicitId: string | null): string {
  if (explicitId && explicitId.trim().length > 0) {
    return explicitId.trim();
  }
  return getRequestWorkspace(req).id;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

// ============================================================================
// Validation Schemas
// ============================================================================

const createChatSessionSchema = z.object({
  skillId: z.string().trim().min(1).optional(),
  title: z.string().trim().max(255).optional(),
  workspaceId: z.string().trim().min(1).optional(),
});

const updateChatSessionSchema = z.object({
  title: z.string().trim().min(1).max(255),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /sessions
 * List user's chat sessions
 */
chatRouter.get('/sessions', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const skillIdFilter = pickFirstString(req.query.skillId, req.query.skill_id);
  
  const chats = await listUserChats(workspaceId, user.id, skillIdFilter);
  res.json({ chats: chats.map(mapChatSummary) });
}));

/**
 * POST /sessions
 * Create new chat session
 */
chatRouter.post('/sessions', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createChatSessionSchema.parse(req.body ?? {});
  const workspaceId = resolveWorkspaceIdForRequest(req, payload.workspaceId ?? null);
  
  let resolvedSkillId = payload.skillId?.trim() ?? '';
  if (!resolvedSkillId) {
    const systemSkill = await createUnicaChatSkillForWorkspace(workspaceId);
    if (!systemSkill) {
      throw new HttpError(500, 'Не удалось автоматически создать навык Unica Chat');
    }
    resolvedSkillId = systemSkill.id;
  }

  logger.info({ userId: user.id, workspaceId, skillId: resolvedSkillId }, 'Creating chat session');

  const skill = await getSkillById(workspaceId, resolvedSkillId);
  if (!skill) {
    return res.status(404).json({ message: 'Навык не найден' });
  }
  if (skill.status === 'archived') {
    return res.status(403).json({ message: 'Навык архивирован, новые чаты создавать нельзя' });
  }

  const chat = await createChat({
    workspaceId,
    userId: user.id,
    skillId: resolvedSkillId,
    title: payload.title,
  });

  res.status(201).json({ chat });
}));

/**
 * PATCH /sessions/:chatId
 * Rename chat session
 */
chatRouter.patch('/sessions/:chatId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = updateChatSessionSchema.parse(req.body ?? {});
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const chat = await renameChat(req.params.chatId, workspaceId, user.id, payload.title);
  res.json({ chat });
}));

/**
 * DELETE /sessions/:chatId
 * Delete chat session
 */
chatRouter.delete('/sessions/:chatId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const workspaceCandidate = pickFirstString(req.query.workspaceId, req.query.workspace_id);
  const workspaceId = resolveWorkspaceIdForRequest(req, workspaceCandidate as string | null);
  
  await deleteChat(req.params.chatId, workspaceId, user.id);
  res.status(204).send();
}));

/**
 * GET /sessions/:chatId/messages
 * Get chat messages
 */
chatRouter.get('/sessions/:chatId/messages', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const messages = await getChatMessages(req.params.chatId, workspaceId, user.id);
  
  res.json({ messages: messages.map(mapMessage) });
}));

// Error handler for this router
chatRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: 'Неверные данные', details: err.issues });
  }
  if (err instanceof ChatServiceError) {
    return res.status(err.status).json(buildChatServiceErrorPayload(err));
  }
  if (err instanceof OperationBlockedError) {
    return res.status(err.status).json(err.toJSON());
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message });
  }
  next(err);
});

export default chatRouter;
