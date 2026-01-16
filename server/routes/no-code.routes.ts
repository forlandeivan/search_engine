/**
 * No-Code Callback Routes Module
 * 
 * Handles callbacks from no-code integrations:
 * - POST /api/no-code/callback/transcripts - Create transcript
 * - PATCH /api/no-code/callback/transcripts/:transcriptId - Update transcript
 * - POST /api/no-code/callback/messages - Create message
 * - POST /api/no-code/callback/stream - Stream message chunks
 * - POST /api/no-code/callback/assistant-action - Set assistant action
 * - POST /api/no-code/callback/actions/start - Start bot action
 * - POST /api/no-code/callback/actions/update - Update bot action
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { SkillServiceError } from '../skills';
import {
  ChatServiceError,
  addNoCodeCallbackMessage,
  addNoCodeStreamChunk,
  setNoCodeAssistantAction,
  buildChatServiceErrorPayload,
  upsertBotActionForChat,
} from '../chat-service';
import type { TranscriptStatus, AssistantActionType } from '@shared/schema';

const logger = createLogger('no-code');

export const noCodeRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function buildTranscriptPreview(fullText: string, maxLength: number = 60): string {
  if (!fullText) return '';
  const trimmed = fullText.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return trimmed.slice(0, maxLength - 3) + '...';
}

function formatZodValidationError(error: z.ZodError, endpoint: string) {
  return {
    message: 'Некорректные данные',
    details: error.issues,
    endpoint,
  };
}

// ============================================================================
// Validation Schemas
// ============================================================================

const noCodeCallbackTranscriptCreateSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  fullText: z.string(),
  previewText: z.string().optional(),
  title: z.string().optional(),
  status: z.enum(['pending', 'processing', 'ready', 'error']).optional(),
});

const noCodeCallbackTranscriptUpdateSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  fullText: z.string(),
  previewText: z.string().optional(),
  title: z.string().optional(),
  status: z.enum(['pending', 'processing', 'ready', 'error']).optional(),
});

const noCodeCallbackCreateMessageSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().optional(),
  text: z.string().optional(),
  triggerMessageId: z.string().optional(),
  correlationId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  card: z.object({
    type: z.string(),
    title: z.string().optional(),
    previewText: z.string().optional(),
    transcriptId: z.string().optional(),
  }).optional(),
});

const noCodeCallbackStreamSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  triggerMessageId: z.string().optional(),
  streamId: z.string(),
  chunkId: z.string().optional(),
  delta: z.string().optional(),
  text: z.string().optional(),
  isFinal: z.boolean().optional(),
  role: z.enum(['user', 'assistant', 'system']).optional(),
  seq: z.number().optional(),
});

const noCodeCallbackAssistantActionSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  actionType: z.string(),
  actionText: z.string().optional(),
  triggerMessageId: z.string().optional(),
  occurredAt: z.string().optional(),
});

const botActionStartSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  actionType: z.string(),
  displayText: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

const botActionUpdateSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  actionId: z.string().trim().min(1),
  actionType: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']),
  displayText: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /callback/transcripts
 * Create transcript from no-code callback
 */
noCodeRouter.post('/callback/transcripts', asyncHandler(async (req, res) => {
  try {
    const payload = noCodeCallbackTranscriptCreateSchema.parse(req.body ?? {});

    if (!payload.workspaceId || payload.workspaceId.trim().length === 0) {
      throw new SkillServiceError('workspaceId обязателен', 400);
    }
    const workspaceId = payload.workspaceId.trim();

    const chat = await storage.getChatSessionById(payload.chatId);
    if (!chat || chat.workspaceId !== workspaceId) {
      throw new SkillServiceError('Чат не найден или принадлежит другому workspace', 404, 'CHAT_NOT_FOUND');
    }

    const fullText = payload.fullText.trim();
    const previewText = (payload.previewText ?? buildTranscriptPreview(fullText, 60)).trim();
    const transcript = await storage.createTranscript({
      workspaceId,
      chatId: payload.chatId,
      status: (payload.status ?? 'ready') as TranscriptStatus,
      title: payload.title ?? null,
      previewText: previewText || null,
      fullText,
      sourceFileId: null,
    });

    return res.status(201).json({ transcript });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    if (error instanceof SkillServiceError) {
      return res.status(error.status).json({
        message: error.message,
        ...(error.code ? { errorCode: error.code } : {}),
      });
    }
    if (error instanceof ChatServiceError) {
      return res.status(error.status).json(buildChatServiceErrorPayload(error));
    }
    throw error;
  }
}));

/**
 * PATCH /callback/transcripts/:transcriptId
 * Update transcript
 */
noCodeRouter.patch('/callback/transcripts/:transcriptId', asyncHandler(async (req, res) => {
  try {
    const payload = noCodeCallbackTranscriptUpdateSchema.parse(req.body ?? {});

    if (!payload.workspaceId || payload.workspaceId.trim().length === 0) {
      throw new SkillServiceError('workspaceId обязателен', 400);
    }
    const workspaceId = payload.workspaceId.trim();

    const transcriptId = req.params.transcriptId;
    const transcript = await storage.getTranscriptById?.(transcriptId);
    if (!transcript || transcript.workspaceId !== workspaceId) {
      throw new SkillServiceError('Стенограмма не найдена', 404, 'TRANSCRIPT_NOT_FOUND');
    }
    if (transcript.chatId !== payload.chatId) {
      throw new SkillServiceError('Стенограмма принадлежит другому чату', 400, 'CHAT_MISMATCH');
    }

    const fullText = payload.fullText.trim();
    const previewText = (payload.previewText ?? buildTranscriptPreview(fullText, 60)).trim();
    const updated = await storage.updateTranscript(transcriptId, {
      fullText,
      previewText: previewText || null,
      title: payload.title ?? transcript.title,
      status: payload.status ?? transcript.status,
    });

    if (!updated) {
      return res.status(404).json({ message: 'Стенограмма не найдена' });
    }

    return res.json({ transcript: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    if (error instanceof SkillServiceError) {
      return res.status(error.status).json({
        message: error.message,
        ...(error.code ? { errorCode: error.code } : {}),
      });
    }
    if (error instanceof ChatServiceError) {
      return res.status(error.status).json(buildChatServiceErrorPayload(error));
    }
    throw error;
  }
}));

/**
 * POST /callback/messages
 * Create message from no-code callback
 */
noCodeRouter.post('/callback/messages', asyncHandler(async (req, res) => {
  try {
    const payload = noCodeCallbackCreateMessageSchema.parse(req.body ?? {});
    const content = (payload.content ?? payload.text ?? '').trim();
    const triggerMessageId = (payload.triggerMessageId ?? payload.correlationId ?? '').trim() || null;

    if (!payload.workspaceId || payload.workspaceId.trim().length === 0) {
      throw new SkillServiceError('workspaceId обязателен', 400);
    }
    const workspaceId = payload.workspaceId.trim();

    const chat = await storage.getChatSessionById(payload.chatId);
    if (!chat || chat.workspaceId !== workspaceId) {
      throw new SkillServiceError('Чат не найден или принадлежит другому workspace', 404, 'CHAT_NOT_FOUND');
    }
    if (!chat.skillId) {
      throw new SkillServiceError('У чата не указан навык', 400);
    }

    const transcriptId =
      typeof payload.card?.transcriptId === 'string' && payload.card.transcriptId.trim().length > 0
        ? payload.card.transcriptId.trim()
        : null;
    if (transcriptId) {
      const transcript = await storage.getTranscriptById?.(transcriptId);
      if (!transcript || transcript.workspaceId !== workspaceId || transcript.chatId !== payload.chatId) {
        throw new SkillServiceError('Некорректный transcriptId', 400, 'TRANSCRIPT_NOT_FOUND');
      }
    }

    let cardId: string | null = null;
    let messageType: 'text' | 'card' = 'text';
    if (payload.card) {
      const card = await storage.createChatCard({
        workspaceId,
        chatId: payload.chatId,
        type: payload.card.type,
        title: payload.card.title ?? null,
        previewText: (payload.card.previewText ?? content) || 'Карточка',
        transcriptId: payload.card.transcriptId ?? null,
        createdByUserId: null,
      });
      cardId = card.id;
      messageType = 'card';
    }

    const message = await addNoCodeCallbackMessage({
      workspaceId,
      chatId: payload.chatId,
      role: payload.role,
      content: content || payload.card?.previewText || payload.card?.title || 'Карточка',
      triggerMessageId,
      metadata: {
        ...(payload.metadata ?? {}),
        ...(cardId ? { cardId, transcriptId: payload.card?.transcriptId } : {}),
      },
      expectedSkillId: chat.skillId,
      messageType,
      cardId,
    });

    return res.status(201).json({ message });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    if (error instanceof SkillServiceError) {
      return res.status(error.status).json({
        message: error.message,
        ...(error.code ? { errorCode: error.code } : {}),
      });
    }
    if (error instanceof ChatServiceError) {
      return res.status(error.status).json(buildChatServiceErrorPayload(error));
    }
    throw error;
  }
}));

/**
 * POST /callback/stream
 * Stream message chunks
 */
noCodeRouter.post('/callback/stream', asyncHandler(async (req, res) => {
  try {
    const payload = noCodeCallbackStreamSchema.parse(req.body ?? {});

    const delta = (payload.delta ?? payload.text ?? '') ?? '';
    const message = await addNoCodeStreamChunk({
      workspaceId: payload.workspaceId,
      chatId: payload.chatId,
      triggerMessageId: payload.triggerMessageId,
      streamId: payload.streamId,
      chunkId: payload.chunkId,
      delta,
      isFinal: payload.isFinal ?? false,
      role: payload.role ?? 'assistant',
      seq: payload.seq ?? null,
    });

    return res.status(200).json({ message });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    if (error instanceof SkillServiceError) {
      return res.status(error.status).json({
        message: error.message,
        ...(error.code ? { errorCode: error.code } : {}),
      });
    }
    if (error instanceof ChatServiceError) {
      return res.status(error.status).json(buildChatServiceErrorPayload(error));
    }
    throw error;
  }
}));

/**
 * POST /callback/assistant-action
 * Set assistant action state
 */
noCodeRouter.post('/callback/assistant-action', asyncHandler(async (req, res) => {
  try {
    const payload = noCodeCallbackAssistantActionSchema.parse(req.body ?? {});

    const action = await setNoCodeAssistantAction({
      workspaceId: payload.workspaceId,
      chatId: payload.chatId,
      actionType: payload.actionType as AssistantActionType,
      actionText: payload.actionText ?? null,
      triggerMessageId: payload.triggerMessageId ?? null,
      occurredAt: payload.occurredAt ?? null,
    });

    return res.status(200).json({
      ok: true,
      chatId: action.id,
      currentAssistantAction: action.currentAssistantAction ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Некорректные данные', details: error.issues });
    }
    if (error instanceof SkillServiceError) {
      return res.status(error.status).json({
        message: error.message,
        ...(error.code ? { errorCode: error.code } : {}),
      });
    }
    if (error instanceof ChatServiceError) {
      return res.status(error.status).json(buildChatServiceErrorPayload(error));
    }
    throw error;
  }
}));

/**
 * POST /callback/actions/start
 * Start a bot action
 */
noCodeRouter.post('/callback/actions/start', asyncHandler(async (req, res) => {
  try {
    const payload = botActionStartSchema.parse(req.body ?? {});

    const actionId = randomUUID();

    const action = await upsertBotActionForChat({
      workspaceId: payload.workspaceId!,
      chatId: payload.chatId,
      actionId,
      actionType: payload.actionType,
      status: 'processing',
      displayText: payload.displayText ?? undefined,
      payload: payload.payload ?? null,
    });

    return res.status(200).json({ action });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formatted = formatZodValidationError(error, '/api/no-code/callback/actions/start');
      return res.status(400).json(formatted);
    }
    if (error instanceof ChatServiceError) {
      return res.status(error.status).json(buildChatServiceErrorPayload(error));
    }
    throw error;
  }
}));

/**
 * POST /callback/actions/update
 * Update bot action status
 */
noCodeRouter.post('/callback/actions/update', asyncHandler(async (req, res) => {
  try {
    const payload = botActionUpdateSchema.parse(req.body ?? {});

    const action = await upsertBotActionForChat({
      workspaceId: payload.workspaceId!,
      chatId: payload.chatId,
      actionId: payload.actionId,
      actionType: payload.actionType,
      status: payload.status,
      displayText: payload.displayText ?? undefined,
      payload: payload.payload ?? null,
    });

    return res.status(200).json({ action });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formatted = formatZodValidationError(error, '/api/no-code/callback/actions/update');
      return res.status(400).json(formatted);
    }
    if (error instanceof ChatServiceError) {
      return res.status(error.status).json(buildChatServiceErrorPayload(error));
    }
    throw error;
  }
}));

export default noCodeRouter;
