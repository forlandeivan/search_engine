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
import { upsertBotActionForChat } from '../chat-service';
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
 * 
 * If skill is in no-code mode (executionMode === 'no_code' or transcriptionFlowMode === 'no_code'),
 * returns 409 to signal client should use file upload flow instead.
 */
transcribeRouter.post('/', upload.single('audio'), asyncHandler(async (req, res) => {
  const startTime = Date.now();
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

  logger.info({
    operationId,
    chatId,
    transcriptId,
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
    userId: user.id,
  }, '[TRANSCRIBE-START] Starting transcription pipeline');

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
  
  logger.info({
    operationId,
    chatId,
    workspaceId,
    skillId: chat.skillId,
    elapsed: Date.now() - startTime,
  }, '[TRANSCRIBE-STEP] Chat and workspace loaded');

  // Check if skill is in no-code mode - if so, redirect to file upload flow
  if (chat.skillId) {
    const skill = await getSkillById(workspaceId, chat.skillId);
    if (skill) {
      const isNoCodeExecution = skill.executionMode === 'no_code';
      const isNoCodeTranscription = skill.transcriptionFlowMode === 'no_code';
      
      if (isNoCodeExecution || isNoCodeTranscription) {
        logger.info({
          chatId,
          skillId: skill.id,
          executionMode: skill.executionMode,
          transcriptionFlowMode: skill.transcriptionFlowMode,
        }, 'Skill is in no-code mode, returning no-code flow indicator');
        
        // Return 200 with special status to indicate no-code flow
        // Client will handle this and use file upload flow instead
        return res.status(200).json({
          status: 'no_code_required',
          mode: 'no_code',
          message: 'Навык использует no-code режим транскрибации',
        });
      }
    }
  }

  logger.info({
    operationId,
    chatId,
    workspaceId,
    elapsed: Date.now() - startTime,
  }, '[TRANSCRIBE-STEP] Starting async transcription service');

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

    logger.info({
      operationId,
      yandexOperationId: result.operationId,
      elapsed: Date.now() - startTime,
    }, '[TRANSCRIBE-STARTED] Transcription started successfully');

    // Create BotAction to show processing indicator in chat (standard mode only)
    try {
      await upsertBotActionForChat({
        workspaceId,
        chatId,
        actionId: `transcribe-${result.operationId}`,
        actionType: 'transcribe_audio',
        status: 'processing',
        displayText: `Распознаём речь: ${file.originalname || 'audio'}`,
        userId: user.id,
      });
      logger.info({
        operationId,
        yandexOperationId: result.operationId,
      }, '[TRANSCRIBE-BOT-ACTION] Created processing bot action');
    } catch (botActionError) {
      // Non-critical error, log and continue
      logger.warn({ error: botActionError, operationId }, '[TRANSCRIBE-BOT-ACTION] Failed to create bot action');
    }

    res.json({
      status: 'started',
      operationId: result.operationId,
      message: 'Аудио файл загружен и отправлен на транскрибацию',
    });
  } catch (error) {
    logger.error({
      error,
      chatId,
      operationId,
      elapsed: Date.now() - startTime,
    }, '[TRANSCRIBE-ERROR] Transcription start failed');
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
  const completeStartTime = Date.now();
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { operationId } = req.params;
  if (!operationId || !operationId.trim()) {
    return res.status(400).json({ message: 'ID операции не предоставлен' });
  }

  logger.info({
    operationId,
    userId: user.id,
  }, '[COMPLETE-START] Starting transcription completion');

  const status: TranscribeOperationStatus = await yandexSttAsyncService.getOperationStatus(user.id, operationId);
  
  if (status.status !== 'completed' || !status.result?.text) {
    logger.warn({ operationId, status: status.status, hasText: Boolean(status.result?.text) }, 'Operation not ready');
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

  const transcriptText = status.result.text || 'Стенограмма получена';
  const skill = chat.skillId ? await getSkillById(chat.workspaceId, chat.skillId) : null;
  const autoActionEnabled = Boolean(
    skill && skill.onTranscriptionMode === 'auto_action' && skill.onTranscriptionAutoActionId,
  );
  const asrExecutionId = result.executionId ?? null;

  // Create transcript record if not exists
  let transcriptId: string | null = result.transcriptId ?? null;
  let transcriptRecord = transcriptId ? await storage.getTranscriptById?.(transcriptId) : null;
  
  if (!transcriptRecord) {
    const initialStatus = autoActionEnabled ? 'postprocessing' : 'ready';
    transcriptRecord = await storage.createTranscript({
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      status: initialStatus,
      title: 'Стенограмма',
      previewText: transcriptText.substring(0, 200),
      fullText: transcriptText,
      sourceFileId: null,
    });
    transcriptId = transcriptRecord.id;
    logger.info({
      operationId,
      transcriptId,
      chatId: chat.id,
    }, '[COMPLETE-STEP] Created transcript record');
  }
  
  if (asrExecutionId) {
    await asrExecutionLogService.addEvent(asrExecutionId, {
      stage: 'transcribe_complete_called',
      details: { operationId, chatId: chat.id, transcriptId },
    });
  }
  
  logger.info({
    chatId: chat.id,
    skillId: skill?.id ?? null,
    mode: skill?.onTranscriptionMode ?? null,
    autoActionId: skill?.onTranscriptionAutoActionId ?? null,
    enabled: autoActionEnabled,
    executionId: asrExecutionId,
    transcriptId,
  }, 'Processing transcribe complete');

  const initialTranscriptStatus = autoActionEnabled ? 'postprocessing' : 'ready';
  const previewText = transcriptText.substring(0, 200);

  logger.info({
    operationId,
    chatId: chat.id,
    transcriptId,
    textLength: transcriptText.length,
    autoActionEnabled,
    initialStatus: initialTranscriptStatus,
    elapsed: Date.now() - completeStartTime,
  }, '[COMPLETE-STEP] Creating chat card');

  const card = await storage.createChatCard({
    workspaceId: chat.workspaceId,
    chatId: chat.id,
    type: 'transcript',
    title: transcriptRecord?.title ?? 'Стенограмма',
    previewText,
    transcriptId,
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
      transcriptId: transcriptId,
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
      transcriptId: transcriptId ?? null,
    });
  }

  if (autoActionEnabled && skill) {
    const autoActionStartTime = Date.now();
    try {
      const actionId = skill.onTranscriptionAutoActionId!;
      logger.info({
        chatId: chat.id,
        transcriptId: transcriptId,
        actionId,
        operationId,
        elapsed: Date.now() - completeStartTime,
      }, '[AUTO-ACTION-START] Starting auto-action');
      
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
        transcriptId: transcriptId,
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
        transcriptId: transcriptId,
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
      
      if (transcriptId) {
        await storage.updateTranscript(transcriptId, {
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
          details: { transcriptId: transcriptId },
        });
        await asrExecutionLogService.updateExecution(asrExecutionId, {
          status: 'success',
          finishedAt: new Date(),
          transcriptId: transcriptId ?? null,
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
      
      if (transcriptId) {
        await storage.updateTranscript(transcriptId, {
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
          transcriptId: transcriptId ?? null,
          transcriptMessageId: createdMessage.id,
          finishedAt: new Date(),
        });
      }
    }
  } else {
    if (transcriptId) {
      await storage.updateTranscript(transcriptId, {
        status: 'ready',
        previewText: transcriptText.substring(0, 200),
      });
    }
    await storage.updateChatCard(card.id, { previewText: transcriptText.substring(0, 200) });
    
    if (asrExecutionId) {
      await asrExecutionLogService.addEvent(asrExecutionId, {
        stage: 'transcript_saved',
        details: { transcriptId: transcriptId },
      });
      await asrExecutionLogService.updateExecution(asrExecutionId, {
        status: 'success',
        finishedAt: new Date(),
        transcriptId: transcriptId ?? null,
        transcriptMessageId: createdMessage.id,
      });
    }
  }

  // Update BotAction to show completion (standard mode)
  try {
    await upsertBotActionForChat({
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      actionId: `transcribe-${operationId}`,
      actionType: 'transcribe_audio',
      status: 'done',
      displayText: 'Распознавание завершено',
      userId: user.id,
    });
    logger.info({ operationId }, '[COMPLETE-BOT-ACTION] Updated bot action to done');
  } catch (botActionError) {
    // Non-critical error, log and continue
    logger.warn({ error: botActionError, operationId }, '[COMPLETE-BOT-ACTION] Failed to update bot action');
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
