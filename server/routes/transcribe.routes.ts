/**
 * Transcribe Routes Module
 * 
 * Handles speech-to-text transcription operations:
 * - POST /api/chat/transcribe - Start transcription with audio file
 * - GET /api/chat/transcribe/operations/:operationId - Get transcription operation status
 * - GET /api/chat/transcribe/status - Check transcription service health
 * - POST /api/chat/transcribe/complete/:operationId - Complete transcription and create message
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { storage } from '../storage';
import { yandexSttService } from '../yandex-stt-service';
import { yandexSttAsyncService, YandexSttAsyncError, type TranscribeOperationStatus } from '../yandex-stt-async-service';
import { asrExecutionLogService } from '../asr-execution-log-context';
import { actionsRepository } from '../actions';
import { skillActionsRepository } from '../skill-actions';
import { getSkillById } from '../skills';
import { runTranscriptActionCommon } from '../lib/transcript-actions';
import type { PublicUser, ChatMessageMetadata } from '@shared/schema';

const logger = createLogger('transcribe');

export const transcribeRouter = Router();

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
// Routes
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

/**
 * POST /
 * Start transcription with audio file
 */
transcribeRouter.post('/', upload.single('audio'), asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'Аудио файл не предоставлен' });
  }

  const chatId = typeof req.body.chatId === 'string' ? req.body.chatId.trim() : null;
  const operationId = typeof req.body.operationId === 'string' ? req.body.operationId.trim() : null;
  const transcriptId = typeof req.body.transcriptId === 'string' ? req.body.transcriptId.trim() : null;
  const executionId = typeof req.body.executionId === 'string' ? req.body.executionId.trim() : null;

  if (!chatId) {
    return res.status(400).json({ message: 'Chat ID обязателен' });
  }

  if (!operationId) {
    return res.status(400).json({ message: 'Operation ID обязателен' });
  }

  const chat = await storage.getChatSessionById(chatId);
  if (!chat || chat.userId !== user.id) {
    return res.status(404).json({ message: 'Чат не найден или недоступен' });
  }

  const workspaceId = chat.workspaceId;

  try {
    const result = await yandexSttAsyncService.startAsyncTranscription({
      audioBuffer: file.buffer,
      mimeType: file.mimetype || 'audio/wav',
      userId: user.id,
      workspaceId,
      originalFileName: file.originalname || 'audio.wav',
      chatId,
      transcriptId: transcriptId || null,
      executionId: executionId || null,
    });

    res.json({
      status: 'uploaded',
      operationId: result.operationId,
      message: 'Аудио файл загружен и отправлен на транскрибацию',
    });
  } catch (error) {
    if (error instanceof YandexSttAsyncError) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
      });
    }

    logger.error({ userId: user.id, chatId, operationId, error }, 'Error starting transcription');
    throw error;
  }
}));

/**
 * GET /operations/:operationId
 * Get transcription operation status
 */
transcribeRouter.get('/operations/:operationId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { operationId } = req.params;
  if (!operationId || !operationId.trim()) {
    return res.status(400).json({ message: 'ID операции не предоставлен' });
  }

  try {
    const status = await yandexSttAsyncService.getOperationStatus(user.id, operationId);
    res.json(status);
  } catch (err) {
    logger.error({ userId: user.id, operationId, err }, 'Error getting transcribe operation status');
    
    if (err instanceof YandexSttAsyncError) {
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    throw err;
  }
}));

/**
 * GET /status
 * Check transcription service health
 */
transcribeRouter.get('/status', asyncHandler(async (_req, res) => {
  const health = await yandexSttService.checkHealth();
  res.json(health);
}));

/**
 * POST /complete/:operationId
 * Complete transcription operation and create chat message with card
 */
transcribeRouter.post('/complete/:operationId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { operationId } = req.params;
  if (!operationId || !operationId.trim()) {
    return res.status(400).json({ message: 'ID операции не предоставлен' });
  }

  const status: TranscribeOperationStatus = await yandexSttAsyncService.getOperationStatus(user.id, operationId);
  
  if (status.status !== 'completed' || !status.text) {
    logger.warn({ operationId, status: status.status, hasText: Boolean(status.text) }, 'Operation not ready');
    return res.status(400).json({ message: 'Операция не завершена или нет текста' });
  }

  const result = status as typeof status & { chatId?: string; transcriptId?: string; executionId?: string };
  if (!result.chatId) {
    return res.status(400).json({ message: 'Chat ID не найден в операции' });
  }

  const chat = await storage.getChatSessionById(result.chatId);
  if (!chat || chat.userId !== user.id) {
    return res.status(404).json({ message: 'Чат не найден или недоступен' });
  }

  const transcriptText = status.text || 'Стенограмма получена';
  const skill = chat.skillId ? await getSkillById(chat.workspaceId, chat.skillId) : null;
  const autoActionEnabled = Boolean(
    skill && skill.onTranscriptionMode === 'auto_action' && skill.onTranscriptionAutoActionId,
  );
  const asrExecutionId = result.executionId ?? null;
  
  if (asrExecutionId) {
    await asrExecutionLogService.addEvent(asrExecutionId, {
      stage: 'transcribe_complete_called',
      details: { operationId, chatId: chat.id, transcriptId: result.transcriptId ?? null },
    });
  }
  
  logger.info({
    chatId: chat.id,
    skillId: skill?.id ?? null,
    mode: skill?.onTranscriptionMode ?? null,
    autoActionId: skill?.onTranscriptionAutoActionId ?? null,
    enabled: autoActionEnabled,
    executionId: asrExecutionId,
    transcriptId: result.transcriptId ?? null,
  }, 'Processing transcribe complete');

  const initialTranscriptStatus = autoActionEnabled ? 'postprocessing' : 'ready';
  const previewText = transcriptText.substring(0, 200);
  const transcriptRecord = result.transcriptId ? await storage.getTranscriptById?.(result.transcriptId) : null;

  const card = await storage.createChatCard({
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    type: 'transcript',
    title: transcriptRecord?.title ?? 'Стенограмма',
    previewText,
    transcriptId: result.transcriptId ?? null,
    createdByUserId: user.id,
  });

  let createdMessage = await storage.createChatMessage({
    chatId: result.chatId,
    role: 'assistant',
    messageType: 'card',
    cardId: card.id,
    content: previewText,
    metadata: {
      type: 'transcript',
      transcriptId: result.transcriptId,
      transcriptStatus: initialTranscriptStatus,
      previewText,
      cardId: card.id,
      asrExecutionId,
    },
  });
  
  if (asrExecutionId) {
    await asrExecutionLogService.addEvent(asrExecutionId, {
      stage: 'asr_result_final',
      details: { provider: 'yandex_speechkit', operationId, previewText: transcriptText.substring(0, 200) },
    });
    await asrExecutionLogService.updateExecution(asrExecutionId, {
      transcriptMessageId: createdMessage.id,
      transcriptId: result.transcriptId ?? null,
    });
  }

  if (autoActionEnabled && skill) {
    try {
      const actionId = skill.onTranscriptionAutoActionId!;
      logger.info({ chatId: chat.id, transcriptId: result.transcriptId, actionId }, 'Starting auto-action');
      
      if (asrExecutionId) {
        await asrExecutionLogService.addEvent(asrExecutionId, {
          stage: 'auto_action_triggered',
          details: { skillId: skill.id, actionId },
        });
      }
      
      const action = await actionsRepository.getByIdForWorkspace(skill.workspaceId, actionId);
      if (!action || action.target !== 'transcript') {
        logger.warn({ actionId, workspaceId: skill.workspaceId }, 'Action not found or wrong target');
        throw new Error('auto action not applicable');
      }
      
      const skillAction = await skillActionsRepository.getForSkillAndAction(skill.id, action.id);
      if (!skillAction || !skillAction.enabled) {
        logger.warn({ skillId: skill.id, actionId: action.id }, 'Skill action disabled');
        throw new Error('auto action disabled');
      }
      
      const allowedPlacements = action.placements ?? [];
      const enabledPlacements = skillAction.enabledPlacements ?? [];
      const placement = enabledPlacements.find((p) => allowedPlacements.includes(p)) ?? allowedPlacements[0] ?? null;
      
      if (!placement) {
        logger.warn({ actionId: action.id }, 'No suitable placement for auto-action');
        throw new Error('no placement');
      }

      const ctx = {
        transcriptId: result.transcriptId,
        selectionText: transcriptText,
        chatId: chat.id,
        trigger: 'auto_action',
      };

      if (asrExecutionId) {
        await asrExecutionLogService.addEvent(asrExecutionId, {
          stage: 'auto_action_triggered',
          details: { skillId: skill.id, actionId: action.id, placement },
        });
      }
      
      const resultAction = await runTranscriptActionCommon({
        userId: chat.userId,
        skill,
        action,
        placement,
        transcriptId: result.transcriptId,
        transcriptText,
        context: ctx,
      });

      const updatedPreviewText = (resultAction.text ?? transcriptText).slice(0, 200);
      logger.info({ chatId: chat.id, actionId: action.id }, 'Auto-action success');
      
      await storage.updateChatCard(card.id, { previewText: updatedPreviewText });
      
      if (asrExecutionId) {
        await asrExecutionLogService.addEvent(asrExecutionId, {
          stage: 'auto_action_completed',
          details: { skillId: skill.id, actionId, success: true },
        });
      }
      
      if (result.transcriptId) {
        await storage.updateTranscript(result.transcriptId, {
          previewText: updatedPreviewText,
          defaultViewActionId: action.id,
          status: 'ready',
        });
      }
      
      const updatedMetadata: ChatMessageMetadata = {
        ...(createdMessage.metadata as ChatMessageMetadata),
        transcriptStatus: 'ready',
        previewText: updatedPreviewText,
        defaultViewActionId: action.id,
        autoActionFailed: false,
      };
      
      await storage.updateChatMessage(createdMessage.id, {
        metadata: updatedMetadata,
        content: updatedPreviewText,
      });
      
      createdMessage = {
        ...createdMessage,
        metadata: updatedMetadata as ChatMessageMetadata,
        content: updatedPreviewText,
      };
      
      if (asrExecutionId) {
        await asrExecutionLogService.addEvent(asrExecutionId, {
          stage: 'transcript_saved',
          details: { transcriptId: result.transcriptId },
        });
        await asrExecutionLogService.updateExecution(asrExecutionId, {
          status: 'success',
          finishedAt: new Date(),
          transcriptId: result.transcriptId ?? null,
        });
      }
    } catch (autoError) {
      logger.error({ error: autoError }, 'Auto-action failed');
      
      const failedMetadata: ChatMessageMetadata = {
        ...(createdMessage.metadata as ChatMessageMetadata),
        transcriptStatus: 'auto_action_failed',
        autoActionFailed: true,
        previewText: transcriptText.substring(0, 200),
      };
      
      await storage.updateChatCard(card.id, { previewText: transcriptText.substring(0, 200) });
      await storage.updateChatMessage(createdMessage.id, { metadata: failedMetadata });
      createdMessage = { ...createdMessage, metadata: failedMetadata as ChatMessageMetadata };
      
      if (result.transcriptId) {
        await storage.updateTranscript(result.transcriptId, {
          status: 'ready',
          previewText: transcriptText.substring(0, 200),
        });
      }
      
      if (asrExecutionId) {
        await asrExecutionLogService.addEvent(asrExecutionId, {
          stage: 'auto_action_completed',
          details: {
            skillId: skill?.id ?? null,
            actionId: skill?.onTranscriptionAutoActionId ?? null,
            success: false,
            errorMessage: autoError instanceof Error ? autoError.message : String(autoError),
          },
        });
        await asrExecutionLogService.updateExecution(asrExecutionId, {
          status: 'failed',
          errorMessage: autoError instanceof Error ? autoError.message : String(autoError),
          transcriptId: result.transcriptId ?? null,
          transcriptMessageId: createdMessage.id,
          finishedAt: new Date(),
        });
      }
    }
  } else {
    if (result.transcriptId) {
      await storage.updateTranscript(result.transcriptId, {
        status: 'ready',
        previewText: transcriptText.substring(0, 200),
      });
    }
    await storage.updateChatCard(card.id, { previewText: transcriptText.substring(0, 200) });
    
    if (asrExecutionId) {
      await asrExecutionLogService.addEvent(asrExecutionId, {
        stage: 'transcript_saved',
        details: { transcriptId: result.transcriptId },
      });
      await asrExecutionLogService.updateExecution(asrExecutionId, {
        status: 'success',
        finishedAt: new Date(),
        transcriptId: result.transcriptId ?? null,
        transcriptMessageId: createdMessage.id,
      });
    }
  }

  res.json({
    status: 'ok',
    message: {
      id: createdMessage.id,
      chatId: createdMessage.chatId,
      role: createdMessage.role,
      content: createdMessage.content,
      messageType: createdMessage.messageType,
      metadata: createdMessage.metadata,
      createdAt: createdMessage.createdAt,
    },
  });
}));

export default transcribeRouter;
