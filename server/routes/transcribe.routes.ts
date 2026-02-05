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
import crypto from 'crypto';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { storage } from '../storage';
import { yandexSttService } from '../yandex-stt-service';
import { yandexSttAsyncService, YandexSttAsyncError, type TranscribeOperationStatus } from '../yandex-stt-async-service';
import { unicaAsrService, UnicaAsrError } from '../unica-asr-service';
import { speechProviderService } from '../speech-provider-service';
import { asrExecutionLogService } from '../asr-execution-log-context';
import { actionsRepository } from '../actions';
import { skillActionsRepository } from '../skill-actions';
import { getSkillById } from '../skills';
import { runTranscriptActionCommon } from '../lib/transcript-actions';
import { upsertBotActionForChat, mapMessage } from '../chat-service';
import { scheduleChatTitleGenerationIfNeeded } from '../chat-title-jobs';
import { uploadFileToProvider, FileUploadToProviderError } from '../file-storage-provider-upload-service';
import type { PublicUser, ChatMessageMetadata, UnicaAsrConfig } from '@shared/schema';

const logger = createLogger('transcribe');

export const transcribeRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Логирует ошибку в ASR execution log
 * Если executionId нет - создаёт новую запись с ошибкой
 */
async function logAsrError(params: {
  executionId?: string | null;
  workspaceId?: string;
  chatId?: string;
  skillId?: string;
  provider?: string;
  stage: string;
  error: unknown;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { executionId, workspaceId, chatId, skillId, provider, stage, error, details } = params;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorCode = (error as any)?.code || (error as any)?.name || 'UNKNOWN_ERROR';
  
  try {
    if (executionId) {
      // Обновляем существующую запись
      await asrExecutionLogService.addEvent(
        executionId,
        {
          stage: 'asr_error',
          details: {
            errorStage: stage,
            errorMessage,
            errorCode,
            ...details,
          },
        },
        'failed',
      );
      await asrExecutionLogService.updateExecution(executionId, {
        status: 'failed',
        errorMessage,
      });
    } else if (workspaceId && chatId) {
      // Создаём новую запись с ошибкой
      await asrExecutionLogService.createExecution({
        workspaceId,
        chatId,
        skillId: skillId || null,
        provider: provider || 'unknown',
        mode: 'standard',
        status: 'failed',
        errorMessage,
        startedAt: new Date(),
        completedAt: new Date(),
        pipelineEvents: [
          {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            stage: 'asr_error',
            details: {
              errorStage: stage,
              errorMessage,
              errorCode,
              ...details,
            } as any,
          },
        ],
      });
    }
  } catch (logError) {
    logger.warn({ logError, originalError: errorMessage }, '[ASR] Failed to log error to execution log');
  }
}

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

  // Получить ASR провайдер для навыка
  let asrProvider = null;
  let asrType: string | null = null;

  if (chat.skillId) {
    const skill = await getSkillById(workspaceId, chat.skillId);
    if (skill) {
      asrProvider = await speechProviderService.getAsrProviderForSkill(skill.id);
      if (asrProvider) {
        asrType = speechProviderService.getAsrProviderType(asrProvider.provider);
        logger.info({
          operationId,
          chatId,
          skillId: skill.id,
          asrProviderId: asrProvider.provider.id,
          asrType,
        }, '[TRANSCRIBE-STEP] ASR provider selected');
      } else {
        logger.error(
          { operationId, chatId, workspaceId, skillId: skill.id },
          '[TRANSCRIBE-ERROR] ASR provider is not configured for this skill',
        );
        return res.status(400).json({
          message: 'Выберите ASR провайдер в настройках навыка для стандартного режима транскрибации',
          code: 'ASR_PROVIDER_REQUIRED',
        });
      }
    }
  }

  // Handle Unica ASR
  if (asrType === "unica" && asrProvider && chat.skillId) {
    logger.info("[UNICA-ASR] ========== UNICA ASR FLOW START ==========");
    logger.info({ operationId, chatId, workspaceId, asrProviderId: asrProvider.provider.id }, "[UNICA-ASR] Using Unica ASR provider");

    const skill = await getSkillById(workspaceId, chat.skillId);
    if (!skill) {
      logger.error({ skillId: chat.skillId }, "[UNICA-ASR] ❌ Skill not found");
      return res.status(404).json({ message: 'Навык не найден' });
    }

    logger.info({ skillId: skill.id, skillName: skill.name }, "[UNICA-ASR] Skill loaded");

    const config = asrProvider.config as unknown as UnicaAsrConfig;
    const fileProviderFromSkill =
      skill.noCodeConnection?.effectiveFileStorageProvider?.id ??
      skill.noCodeConnection?.fileStorageProviderId ??
      null;
    const fileProviderFromAsrConfig = config.fileStorageProviderId ?? null;
    const fileProviderId = fileProviderFromSkill ?? fileProviderFromAsrConfig ?? null;
    const fileProviderSource = skill.noCodeConnection?.effectiveFileStorageProviderSource ?? null;
    const resolvedFileProviderSource = fileProviderFromSkill
      ? `skill:${fileProviderSource ?? 'unknown'}`
      : fileProviderFromAsrConfig
        ? 'asr_provider_config'
        : 'none';

    logger.info({
      config: {
        baseUrl: config.baseUrl,
        workspaceId: config.workspaceId,
        pollingIntervalMs: config.pollingIntervalMs,
        timeoutMs: config.timeoutMs,
        fileStorageProviderId: fileProviderFromAsrConfig,
      },
      fileProviderId,
      fileProviderSource: resolvedFileProviderSource,
    }, "[UNICA-ASR] Configuration");

    if (!fileProviderId) {
      logger.error("[UNICA-ASR] ❌ No file provider configured for skill");
      return res.status(400).json({
        message: 'Для Unica ASR необходимо настроить файловый провайдер (в навыке/дефолт в воркспейсе/в настройках ASR провайдера)',
        code: 'FILE_PROVIDER_REQUIRED',
      });
    }

    try {
      // 1. Создать запись файла в БД
      logger.info({
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      }, "[UNICA-ASR] Creating file record in DB");

      const audioFile = await storage.createFile({
        workspaceId,
        name: file.originalname || 'audio.wav',
        kind: 'audio',
        sizeBytes: BigInt(file.size),
        mimeType: file.mimetype || 'audio/wav',
        status: 'uploading',
        storageType: 'external_provider',
        providerId: fileProviderId,
        skillId: skill.id,
        chatId,
        userId: user.id,
        metadata: {
          originalName: file.originalname,
          uploadedAt: new Date().toISOString(),
        },
      });

      logger.info({ fileId: audioFile.id }, "[UNICA-ASR] ✅ File record created");

      // 2. Загрузить файл через файловый провайдер
      logger.info({ fileProviderId, fileId: audioFile.id }, "[UNICA-ASR] Uploading file to provider");

      const uploadedFile = await uploadFileToProvider({
        fileId: audioFile.id,
        providerId: fileProviderId,
        data: file.buffer,
        fileName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        context: {
          workspaceId,
          skillId: skill.id,
          chatId,
          userId: user.id,
        },
      });

      // Получить filePath из провайдера (providerFileId)
      const filePath = uploadedFile.providerFileId;
      if (!filePath) {
        logger.error({ uploadedFile }, "[UNICA-ASR] ❌ Provider did not return file path");
        throw new Error('Provider did not return file path');
      }

      logger.info({
        filePath,
        providerFileId: uploadedFile.providerFileId,
        status: uploadedFile.status,
      }, "[UNICA-ASR] ✅ File uploaded to provider");

      // 2. Запустить транскрибацию через Unica ASR
      logger.info({ filePath }, "[UNICA-ASR] Starting recognition via Unica ASR service...");
      
      const { taskId, operationId: unicaOperationId } = await unicaAsrService.startRecognition(
        filePath,
        config
      );

      const elapsed = Date.now() - startTime;
      logger.info({
        unicaOperationId,
        taskId,
        elapsed,
      }, "[UNICA-ASR] ✅ Recognition started successfully");

      // 3. Создать ASR execution record
      logger.info("[UNICA-ASR] Creating ASR execution log...");
      const execution = await asrExecutionLogService.createExecution({
        workspaceId,
        chatId,
        skillId: skill.id,
        transcriptId: null,
        audioFileUrl: filePath,
        status: 'processing',
        provider: 'unica',
        mode: 'standard',
        pipelineEvents: [
          {
            id: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            stage: 'asr_request_sent',
            details: {
              unicaOperationId,
              taskId,
              asrProviderType: 'unica',
              fileProviderId,
              filePath,
              fileId: audioFile.id,
            } as any,
          },
        ],
      });
      // Связать executionId с операцией для логирования polling
      unicaAsrService.setExecutionId(unicaOperationId, execution.id);
      logger.info({ executionId: execution.id }, "[UNICA-ASR] ✅ ASR execution log created");

      // 4. Create BotAction to show processing indicator
      try {
        logger.info("[UNICA-ASR] Creating bot action for processing indicator...");
        await upsertBotActionForChat({
          workspaceId,
          chatId,
          actionId: `transcribe-${unicaOperationId}`,
          actionType: 'transcribe_audio',
          status: 'processing',
          displayText: `Распознаём речь: ${file.originalname || 'audio'}`,
          userId: user.id,
        });
        logger.info("[UNICA-ASR] ✅ Bot action created");
      } catch (botActionError) {
        logger.warn({ error: botActionError, operationId: unicaOperationId }, '[UNICA-ASR] ⚠️ Failed to create bot action');
      }

      // Schedule chat title generation
      logger.info("[UNICA-ASR] Scheduling chat title generation...");
      scheduleChatTitleGenerationIfNeeded({
        chatId,
        workspaceId,
        userId: user.id,
        messageText: file.originalname || 'audio',
        messageMetadata: { type: 'audio', fileName: file.originalname || 'audio' },
        chatTitle: chat.title,
        executionId: executionId,
      });

      // Create user message in database so it persists after page refresh
      let audioMessage = null;
      try {
        const userMessage = await storage.createChatMessage({
          chatId,
          role: 'user',
          messageType: 'file',
          content: `[Загружено аудио: ${file.originalname || 'audio'}]`,
          metadata: {
            type: 'audio',
            fileName: file.originalname || 'audio',
            mimeType: file.mimetype,
            sizeBytes: file.size,
            transcriptionStatus: 'processing',
            operationId: unicaOperationId,
          },
        });
        audioMessage = mapMessage(userMessage);
        logger.info({ messageId: userMessage.id, chatId }, "[UNICA-ASR] ✅ User audio message created");
      } catch (msgError) {
        logger.warn({ error: msgError, chatId }, "[UNICA-ASR] ⚠️ Failed to create user audio message");
      }

      logger.info("[UNICA-ASR] ========== UNICA ASR FLOW COMPLETED ==========");
      logger.info({ unicaOperationId, message: "Client should poll for status" }, "[UNICA-ASR] Response sent to client");

      return res.json({
        status: 'started',
        operationId: unicaOperationId,
        message: 'Аудио файл загружен и отправлен на транскрибацию через Unica ASR',
        audioMessage,
      });
    } catch (error) {
      const errorObj = error as { name?: string; status?: number; code?: string; statusCode?: number; message?: string; details?: unknown };
      logger.error({
        errorName: errorObj?.name,
        errorMessage: errorObj?.message,
        errorStatus: errorObj?.status ?? errorObj?.statusCode,
        errorCode: errorObj?.code,
        errorDetails: errorObj?.details,
        chatId,
        operationId,
        elapsed: Date.now() - startTime,
      }, '[UNICA-ASR] ❌ Recognition start failed');

      // Логируем ошибку в ASR execution log для отображения в UI
      await logAsrError({
        workspaceId,
        chatId,
        skillId: skill?.id,
        provider: 'unica',
        stage: 'transcription_start',
        error,
        details: { operationId, elapsed: Date.now() - startTime },
      });

      // Check by instanceof or by error name (fallback for cross-module issues)
      if (error instanceof FileUploadToProviderError || errorObj?.name === 'FileUploadToProviderError') {
        const status = errorObj?.status ?? 502;
        const details = errorObj?.details;
        logger.error({
          chatId,
          operationId,
          status,
          message: errorObj?.message,
          details,
        }, '[UNICA-ASR] ❌ File upload to provider failed');
        return res.status(status).json({
          message: errorObj?.message ?? 'Ошибка загрузки файла в провайдер',
          code: 'FILE_UPLOAD_ERROR',
          details,
        });
      }

      if (error instanceof UnicaAsrError || errorObj?.name === 'UnicaAsrError') {
        const statusCode = errorObj?.statusCode ?? errorObj?.status ?? 500;
        logger.error({
          code: errorObj?.code,
          statusCode,
          message: errorObj?.message,
        }, "[UNICA-ASR] ❌ UnicaAsrError details");
        return res.status(statusCode).json({
          message: errorObj?.message,
          code: errorObj?.code,
        });
      }

      logger.error({ userId: user.id, chatId, operationId, error }, '[UNICA-ASR] ❌ Unexpected error');
      throw error;
    }
  }

  // Handle Yandex ASR (existing logic)
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

    // Schedule chat title generation from audio file name
    scheduleChatTitleGenerationIfNeeded({
      chatId,
      workspaceId,
      userId: user.id,
      messageText: file.originalname || 'audio',
      messageMetadata: { type: 'audio', fileName: file.originalname || 'audio' },
      chatTitle: chat.title,
      executionId: executionId,
    });

    // Create user message in database so it persists after page refresh
    let audioMessage = null;
    try {
      const userMessage = await storage.createChatMessage({
        chatId,
        role: 'user',
        messageType: 'file',
        content: `[Загружено аудио: ${file.originalname || 'audio'}]`,
        metadata: {
          type: 'audio',
          fileName: file.originalname || 'audio',
          mimeType: file.mimetype,
          sizeBytes: file.size,
          transcriptionStatus: 'processing',
          operationId: result.operationId,
        },
      });
      audioMessage = mapMessage(userMessage);
      logger.info({ messageId: userMessage.id, chatId }, "[TRANSCRIBE] ✅ User audio message created");
    } catch (msgError) {
      logger.warn({ error: msgError, chatId }, "[TRANSCRIBE] ⚠️ Failed to create user audio message");
    }

    res.json({
      status: 'started',
      operationId: result.operationId,
      message: 'Аудио файл загружен и отправлен на транскрибацию',
      audioMessage,
    });
  } catch (error) {
    logger.error({
      error,
      chatId,
      operationId,
      elapsed: Date.now() - startTime,
    }, '[TRANSCRIBE-ERROR] Transcription start failed');
    
    // Логируем ошибку в ASR execution log для отображения в UI
    await logAsrError({
      workspaceId,
      chatId,
      provider: 'yandex_speechkit',
      stage: 'transcription_start',
      error,
      details: { operationId, elapsed: Date.now() - startTime },
    });
    
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
 * POST /upload
 * Upload audio file for later transcription (upload-only mode)
 * 
 * This uploads the file to S3 immediately when user attaches it,
 * but does not start transcription until they press "Send".
 */
transcribeRouter.post('/upload', upload.single('audio'), asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'Аудио файл не предоставлен' });
  }

  const chatId = typeof req.body.chatId === 'string' ? req.body.chatId.trim() : null;

  logger.info({
    chatId,
    fileName: file.originalname,
    fileSize: file.size,
    mimeType: file.mimetype,
    userId: user.id,
  }, '[UPLOAD-ONLY-START] Starting upload-only pipeline');

  if (!chatId) {
    return res.status(400).json({ message: 'Chat ID обязателен' });
  }

  const chat = await storage.getChatSessionById(chatId);
  if (!chat || chat.userId !== user.id) {
    return res.status(404).json({ message: 'Чат не найден или недоступен' });
  }

  const workspaceId = chat.workspaceId;

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
        }, 'Skill is in no-code mode, returning no-code flow indicator');
        
        return res.status(200).json({
          status: 'no_code_required',
          mode: 'no_code',
          message: 'Навык использует no-code режим транскрибации',
        });
      }
    }
  }

  // Upload-only flow is currently supported only for Yandex async STT.
  // For other ASR providers (e.g. Unica) we intentionally skip pre-upload and let the client
  // use the single-call `/api/chat/transcribe` flow on "Send" (so provider selection is respected).
  if (chat.skillId) {
    const skill = await getSkillById(workspaceId, chat.skillId);
    if (skill) {
      let asrProviderId: string | null = null;
      let asrType: string | null = null;
      try {
        const asrProvider = await speechProviderService.getAsrProviderForSkill(skill.id);
        if (asrProvider) {
          asrProviderId = asrProvider.provider.id;
          asrType = speechProviderService.getAsrProviderType(asrProvider.provider);
        }
      } catch (e) {
        // If provider is disabled/misconfigured, still skip preupload to avoid "attachment failed" UX.
        logger.warn({ err: e, chatId, skillId: skill.id }, "[UPLOAD-ONLY] Failed to resolve ASR provider; skipping preupload");
      }

      // Handle Unica ASR pre-upload
      if (asrType === "unica") {
        logger.info(
          { chatId, skillId: skill.id, asrProviderId, asrType },
          "[UPLOAD-ONLY] Starting Unica pre-upload to file provider",
        );

        const asrProvider = await speechProviderService.getAsrProviderForSkill(skill.id);
        if (!asrProvider) {
          return res.status(400).json({
            message: 'ASR провайдер не настроен для этого навыка',
            code: 'ASR_PROVIDER_REQUIRED',
          });
        }

        const config = asrProvider.config as unknown as UnicaAsrConfig;
        const fileProviderFromSkill =
          skill.noCodeConnection?.effectiveFileStorageProvider?.id ??
          skill.noCodeConnection?.fileStorageProviderId ??
          null;
        const fileProviderFromAsrConfig = config.fileStorageProviderId ?? null;
        const fileProviderId = fileProviderFromSkill ?? fileProviderFromAsrConfig ?? null;

        if (!fileProviderId) {
          return res.status(400).json({
            message: 'Для Unica ASR необходимо настроить файловый провайдер',
            code: 'FILE_PROVIDER_REQUIRED',
          });
        }

        try {
          // Create file record in DB
          const audioFile = await storage.createFile({
            workspaceId,
            name: file.originalname || 'audio.wav',
            kind: 'audio',
            sizeBytes: BigInt(file.size),
            mimeType: file.mimetype || 'audio/wav',
            status: 'uploading',
            storageType: 'external_provider',
            providerId: fileProviderId,
            skillId: skill.id,
            chatId,
            userId: user.id,
            metadata: {
              originalName: file.originalname,
              uploadedAt: new Date().toISOString(),
              preUpload: true,
            },
          });

          logger.info({ fileId: audioFile.id, fileProviderId }, "[UPLOAD-ONLY-UNICA] File record created, uploading to provider");

          // Upload to file provider
          const uploadedFile = await uploadFileToProvider({
            fileId: audioFile.id,
            providerId: fileProviderId,
            data: file.buffer,
            fileName: file.originalname || 'audio.wav',
            mimeType: file.mimetype || 'audio/wav',
            sizeBytes: file.size,
            context: {
              workspaceId,
              skillId: skill.id,
              chatId,
              userId: user.id,
            },
          });

          const providerFileId = uploadedFile.providerFileId;
          if (!providerFileId) {
            logger.error({ uploadedFile }, "[UPLOAD-ONLY-UNICA] Provider did not return file path");
            throw new Error('Provider did not return file path');
          }

          logger.info({
            chatId,
            fileId: audioFile.id,
            providerFileId,
            elapsed: Date.now() - startTime,
          }, '[UPLOAD-ONLY-UNICA] File pre-uploaded successfully');

          // Create ASR execution record with file_uploaded event
          let executionId: string | null = null;
          try {
            const execution = await asrExecutionLogService.createExecution({
              workspaceId,
              chatId,
              skillId: skill.id,
              provider: 'unica',
              mode: 'pre_upload',
              status: 'pending',
              fileName: file.originalname || 'audio.wav',
              fileSizeBytes: file.size,
              startedAt: new Date(),
              pipelineEvents: [
                {
                  id: crypto.randomUUID(),
                  timestamp: new Date().toISOString(),
                  stage: 'file_uploaded',
                  details: {
                    fileId: audioFile.id,
                    providerFileId,
                    fileProviderId,
                    mimeType: file.mimetype,
                    sizeBytes: file.size,
                    elapsed: Date.now() - startTime,
                  } as any,
                },
              ],
            });
            executionId = execution.id;
            logger.info({ executionId, fileId: audioFile.id }, '[UPLOAD-ONLY-UNICA] ASR execution log created');
          } catch (logError) {
            logger.warn({ error: logError, fileId: audioFile.id }, '[UPLOAD-ONLY-UNICA] Failed to create ASR execution log');
          }

          return res.json({
            status: 'uploaded',
            fileId: audioFile.id,
            providerFileId,
            fileName: file.originalname,
            asrType: 'unica',
            asrProviderId,
            executionId,
            message: 'Файл загружен. Нажмите "Отправить" для начала транскрибации.',
          });
        } catch (error) {
          logger.error({
            error,
            chatId,
            elapsed: Date.now() - startTime,
          }, '[UPLOAD-ONLY-UNICA] Pre-upload failed');

          // Логируем ошибку в ASR execution log
          await logAsrError({
            workspaceId,
            chatId,
            skillId: skill?.id,
            provider: 'unica',
            stage: 'file_upload',
            error,
            details: { elapsed: Date.now() - startTime },
          });

          if (error instanceof FileUploadToProviderError) {
            return res.status(error.status).json({
              message: error.message,
              code: 'FILE_UPLOAD_ERROR',
              details: error.details,
            });
          }

          throw error;
        }
      }

      // Skip preupload for other non-yandex ASR providers
      if (asrType && asrType !== "yandex") {
        logger.info(
          { chatId, skillId: skill.id, asrProviderId, asrType },
          "[UPLOAD-ONLY] Skipping preupload for non-yandex ASR provider",
        );
        return res.json({
          status: "skip_preupload",
          asrType,
          asrProviderId,
          message: "Pre-upload is supported only for Yandex STT. Will upload on Send.",
        });
      }

      if (!asrType) {
        logger.info(
          { chatId, skillId: skill.id },
          "[UPLOAD-ONLY] ASR provider not configured; skipping preupload",
        );
        return res.json({
          status: "skip_preupload",
          asrType: null,
          asrProviderId: null,
          message: "ASR provider is not configured for this skill. Will validate on Send.",
        });
      }
    }
  }

  try {
    const result = await yandexSttAsyncService.uploadAudioOnly({
      audioBuffer: file.buffer,
      mimeType: file.mimetype || 'audio/wav',
      userId: user.id,
      workspaceId,
      originalFileName: file.originalname || 'audio.wav',
      chatId,
    });

    logger.info({
      chatId,
      s3Uri: result.s3Uri,
      objectKey: result.objectKey,
      durationSeconds: result.durationSeconds,
      elapsed: Date.now() - startTime,
    }, '[UPLOAD-ONLY-DONE] File uploaded successfully');

    res.json({
      status: 'uploaded',
      s3Uri: result.s3Uri,
      objectKey: result.objectKey,
      bucketName: result.bucketName,
      durationSeconds: result.durationSeconds,
      fileName: file.originalname,
      executionId: result.executionId,
      message: 'Файл загружен. Нажмите "Отправить" для начала транскрибации.',
    });
  } catch (error) {
    logger.error({
      error,
      chatId,
      elapsed: Date.now() - startTime,
    }, '[UPLOAD-ONLY-ERROR] Upload failed');
    
    // Логируем ошибку в ASR execution log
    await logAsrError({
      workspaceId,
      chatId,
      provider: 'yandex_speechkit',
      stage: 'file_upload',
      error,
      details: { elapsed: Date.now() - startTime },
    });
    
    if (error instanceof YandexSttAsyncError) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
      });
    }

    logger.error({ userId: user.id, chatId, error }, 'Error uploading audio');
    throw error;
  }
}));

/**
 * POST /start
 * Start transcription for a pre-uploaded file
 * 
 * This is called when user presses "Send" after file was already uploaded.
 */
transcribeRouter.post('/start', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { chatId, s3Uri, objectKey, durationSeconds, operationId: clientOperationId, fileName, fileId, providerFileId, executionId: clientExecutionId } = req.body;

  // Validate required fields - either Yandex (s3Uri) or Unica (providerFileId)
  if (!chatId) {
    return res.status(400).json({ message: 'chatId обязателен' });
  }
  if (!s3Uri && !providerFileId) {
    return res.status(400).json({ message: 'Необходим s3Uri (Yandex) или providerFileId (Unica)' });
  }

  const operationId = clientOperationId || `asr-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  logger.info({
    operationId,
    chatId,
    s3Uri,
    providerFileId,
    fileId,
    durationSeconds,
    userId: user.id,
  }, '[START-TRANSCRIBE] Starting transcription for pre-uploaded file');

  const chat = await storage.getChatSessionById(chatId);
  if (!chat || chat.userId !== user.id) {
    return res.status(404).json({ message: 'Чат не найден или недоступен' });
  }

  const workspaceId = chat.workspaceId;

  // Determine ASR provider type
  let asrProvider = null;
  let asrType: string | null = null;
  if (chat.skillId) {
    const skill = await getSkillById(workspaceId, chat.skillId);
    if (skill) {
      try {
        asrProvider = await speechProviderService.getAsrProviderForSkill(skill.id);
        asrType = asrProvider ? speechProviderService.getAsrProviderType(asrProvider.provider) : null;
      } catch (e) {
        logger.warn({ err: e, chatId, skillId: skill.id }, "[START-TRANSCRIBE] Failed to resolve ASR provider");
      }
    }
  }

  // Handle Unica ASR start
  if (asrType === "unica" && providerFileId && asrProvider) {
    logger.info({ chatId, providerFileId, fileId }, "[START-TRANSCRIBE-UNICA] Starting Unica ASR recognition");

    const skill = await getSkillById(workspaceId, chat.skillId!);
    if (!skill) {
      return res.status(404).json({ message: 'Навык не найден' });
    }

    const config = asrProvider.config as unknown as UnicaAsrConfig;

    try {
      const { taskId, operationId: unicaOperationId } = await unicaAsrService.startRecognition(
        providerFileId,
        config
      );

      logger.info({
        taskId,
        operationId: unicaOperationId,
        elapsed: Date.now() - startTime,
      }, '[START-TRANSCRIBE-UNICA] Recognition started successfully');

      // Update or create ASR execution log
      let effectiveExecutionId: string | null = null;
      try {
        if (clientExecutionId) {
          // Update existing execution record from pre-upload
          await asrExecutionLogService.addEvent(
            clientExecutionId,
            {
              stage: 'asr_request_sent',
              details: {
                unicaOperationId,
                taskId,
                asrProviderId: asrProvider.provider.id,
                providerFileId,
                fileId,
                elapsed: Date.now() - startTime,
              },
            },
            'processing',
          );
          effectiveExecutionId = clientExecutionId;
          logger.info({ executionId: clientExecutionId, unicaOperationId }, '[START-TRANSCRIBE-UNICA] ASR execution log updated');
        } else {
          // Create new execution record (fallback for old clients)
          const execution = await asrExecutionLogService.createExecution({
            workspaceId,
            chatId,
            skillId: skill.id,
            provider: 'unica',
            mode: 'standard',
            status: 'processing',
            fileName: fileName || 'audio',
            startedAt: new Date(),
            pipelineEvents: [
              {
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                stage: 'asr_request_sent',
                details: {
                  unicaOperationId,
                  taskId,
                  asrProviderId: asrProvider.provider.id,
                  providerFileId,
                  fileId,
                } as any,
              },
            ],
          });
          effectiveExecutionId = execution.id;
          logger.info({ executionId: execution.id, unicaOperationId }, '[START-TRANSCRIBE-UNICA] ASR execution log created');
        }
        // Связать executionId с операцией для логирования polling
        if (effectiveExecutionId) {
          unicaAsrService.setExecutionId(unicaOperationId, effectiveExecutionId);
        }
      } catch (logError) {
        logger.warn({ error: logError, operationId: unicaOperationId }, '[START-TRANSCRIBE-UNICA] Failed to update/create execution log');
      }

      // Create BotAction to show processing indicator
      try {
        await upsertBotActionForChat({
          workspaceId,
          chatId,
          actionId: `transcribe-${unicaOperationId}`,
          actionType: 'transcribe_audio',
          status: 'processing',
          displayText: `Распознаём речь: ${fileName || 'audio'}`,
          userId: user.id,
        });
      } catch (botActionError) {
        logger.warn({ error: botActionError, operationId: unicaOperationId }, '[START-TRANSCRIBE-UNICA] Failed to create bot action');
      }

      // Schedule chat title generation
      scheduleChatTitleGenerationIfNeeded({
        chatId,
        workspaceId,
        userId: user.id,
        messageText: fileName || 'audio',
        messageMetadata: { type: 'audio', fileName: fileName || 'audio' },
        chatTitle: chat.title,
      });

      // Create user message in database so it persists after page refresh
      let audioMessage = null;
      try {
        const userMessage = await storage.createChatMessage({
          chatId,
          role: 'user',
          messageType: 'file',
          content: `[Загружено аудио: ${fileName || 'audio'}]`,
          metadata: {
            type: 'audio',
            fileName: fileName || 'audio',
            transcriptionStatus: 'processing',
            operationId: unicaOperationId,
          },
        });
        audioMessage = mapMessage(userMessage);
        logger.info({ messageId: userMessage.id, chatId }, "[START-TRANSCRIBE-UNICA] ✅ User audio message created");
      } catch (msgError) {
        logger.warn({ error: msgError, chatId }, "[START-TRANSCRIBE-UNICA] ⚠️ Failed to create user audio message");
      }

      return res.json({
        status: 'started',
        operationId: unicaOperationId,
        taskId,
        message: 'Транскрибация началась',
        audioMessage,
      });
    } catch (error) {
      logger.error({
        error,
        chatId,
        providerFileId,
        elapsed: Date.now() - startTime,
      }, '[START-TRANSCRIBE-UNICA] Failed to start recognition');

      // Логируем ошибку в ASR execution log
      await logAsrError({
        executionId: clientExecutionId || null,
        workspaceId,
        chatId,
        skillId: skill?.id,
        provider: 'unica',
        stage: 'start_recognition',
        error,
        details: { providerFileId, elapsed: Date.now() - startTime },
      });

      if (error instanceof UnicaAsrError) {
        return res.status(error.statusCode || 500).json({
          message: error.message,
          code: error.code,
        });
      }

      throw error;
    }
  }

  // Guard: Yandex flow requires s3Uri
  if (!s3Uri) {
    return res.status(400).json({ 
      message: 'Для Yandex STT необходим s3Uri',
      code: 'S3_URI_REQUIRED',
    });
  }

  // Guard: Only Yandex is supported for s3Uri flow
  if (asrType && asrType !== "yandex" && asrType !== "unica") {
    logger.warn({ chatId, asrType }, "[START-TRANSCRIBE] Called for unsupported ASR provider");
    return res.status(400).json({
      message: "Upload-only start is supported only for Yandex STT and Unica ASR.",
      code: "UPLOAD_ONLY_NOT_SUPPORTED",
    });
  }

  try {
    const result = await yandexSttAsyncService.startAsyncTranscription({
      mimeType: 'audio/ogg', // Pre-uploaded files are already converted
      userId: user.id,
      workspaceId,
      originalFileName: fileName || 'audio',
      chatId,
      s3Uri,
      s3ObjectKey: objectKey,
      durationSeconds: durationSeconds ?? null,
      executionId: clientExecutionId || null,
    });

    logger.info({
      operationId: result.operationId,
      executionId: clientExecutionId,
      elapsed: Date.now() - startTime,
    }, '[START-TRANSCRIBE-DONE] Transcription started successfully');

    // Create BotAction to show processing indicator
    try {
      await upsertBotActionForChat({
        workspaceId,
        chatId,
        actionId: `transcribe-${result.operationId}`,
        actionType: 'transcribe_audio',
        status: 'processing',
        displayText: `Распознаём речь: ${fileName || 'audio'}`,
        userId: user.id,
      });
    } catch (botActionError) {
      logger.warn({ error: botActionError, operationId: result.operationId }, '[START-TRANSCRIBE] Failed to create bot action');
    }

    // Schedule chat title generation from audio file name
    scheduleChatTitleGenerationIfNeeded({
      chatId,
      workspaceId,
      userId: user.id,
      messageText: fileName || 'audio',
      messageMetadata: { type: 'audio', fileName: fileName || 'audio' },
      chatTitle: chat.title,
      // executionId is not explicitly available in this flow's body, 
      // but we could try to pass it if we had it.
    });

    // Create user message in database so it persists after page refresh
    let audioMessage = null;
    try {
      const userMessage = await storage.createChatMessage({
        chatId,
        role: 'user',
        messageType: 'file',
        content: `[Загружено аудио: ${fileName || 'audio'}]`,
        metadata: {
          type: 'audio',
          fileName: fileName || 'audio',
          transcriptionStatus: 'processing',
          operationId: result.operationId,
        },
      });
      audioMessage = mapMessage(userMessage);
      logger.info({ messageId: userMessage.id, chatId }, "[START-TRANSCRIBE] ✅ User audio message created");
    } catch (msgError) {
      logger.warn({ error: msgError, chatId }, "[START-TRANSCRIBE] ⚠️ Failed to create user audio message");
    }

    res.json({
      status: 'started',
      operationId: result.operationId,
      message: 'Транскрибация началась',
      audioMessage,
    });
  } catch (error) {
    logger.error({
      error,
      chatId,
      s3Uri,
      elapsed: Date.now() - startTime,
    }, '[START-TRANSCRIBE-ERROR] Failed to start transcription');

    // Логируем ошибку в ASR execution log
    await logAsrError({
      executionId: clientExecutionId || null,
      workspaceId,
      chatId,
      provider: 'yandex_speechkit',
      stage: 'start_recognition',
      error,
      details: { s3Uri, elapsed: Date.now() - startTime },
    });

    if (error instanceof YandexSttAsyncError) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code,
      });
    }
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
    // Определить тип операции по префиксу
    if (operationId.startsWith('unica_')) {
      // Unica ASR операция
      logger.info({ operationId, userId: user.id }, "[UNICA-ASR] ========== POLLING STATUS ==========");
      logger.info({ operationId }, "[UNICA-ASR] Checking Unica ASR operation status");
      
      const status = await unicaAsrService.getOperationStatus(operationId);
      
      logger.info({
        operationId,
        done: status.done,
        status: status.status,
        hasText: !!status.text,
        textLength: status.text?.length,
        error: status.error,
      }, "[UNICA-ASR] Status retrieved");
      
      if (status.done) {
        logger.info({ operationId, status: status.status }, "[UNICA-ASR] ✅ Operation completed");
      } else {
        logger.info({ operationId, status: status.status }, "[UNICA-ASR] ⏳ Operation still in progress");
      }
      logger.info("[UNICA-ASR] ========================================");
      
      return res.json({
        status: status.done ? (status.status === 'failed' ? 'failed' : 'completed') : 'processing',
        done: status.done,
        result: status.text ? { text: status.text } : undefined,
        error: status.error,
      });
    } else {
      // Yandex ASR операция (существующая логика)
      const status = await yandexSttAsyncService.getOperationStatus(user.id, operationId);
      return res.json(status);
    }
  } catch (err) {
    logger.error({ userId: user.id, operationId, err }, 'Error getting transcribe operation status');
    
    if (err instanceof YandexSttAsyncError) {
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    if (err instanceof UnicaAsrError) {
      logger.error({
        operationId,
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
      }, "[UNICA-ASR] ❌ Error getting operation status");
      return res.status(err.statusCode || 500).json({ message: err.message, code: err.code });
    }
    throw err;
  }
}));

/**
 * GET /status
 * Check transcription service health
 */
transcribeRouter.get('/status', asyncHandler(async (_req, res) => {
  // UI availability: if at least one ASR provider is enabled, show audio attach.
  const providers = await speechProviderService.getAvailableAsrProviders();
  const anyEnabled = providers.some((p) => p.provider.isEnabled);

  // Keep legacy Yandex health details (best-effort; Yandex may be absent on some envs).
  let yandexHealth: unknown = null;
  try {
    yandexHealth = await yandexSttService.checkHealth();
  } catch (err) {
    logger.warn({ err }, "[TRANSCRIBE-STATUS] Failed to check Yandex STT health");
  }

  res.json({
    available: anyEnabled,
    providers: providers.map((p) => ({
      id: p.provider.id,
      asrProviderType: p.provider.asrProviderType ?? null,
      isEnabled: p.provider.isEnabled,
    })),
    yandex: yandexHealth,
  });
}));

/**
 * GET /asr-providers
 * Get list of available ASR providers
 */
transcribeRouter.get('/asr-providers', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const providers = await speechProviderService.getAvailableAsrProviders();
  
  return res.json(providers.map(p => ({
    id: p.provider.id,
    displayName: p.provider.displayName,
    asrProviderType: p.provider.asrProviderType,
    isEnabled: p.provider.isEnabled,
    isDefaultAsr: p.provider.isDefaultAsr ?? false,
    status: p.provider.status,
  })));
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

  // Определить тип операции и получить результат
  let status: TranscribeOperationStatus;
  let transcriptText: string;
  let chatId: string | undefined;
  let transcriptId: string | undefined;
  let executionId: string | undefined;

  if (operationId.startsWith('unica_')) {
    // Unica ASR операция
    logger.info({ operationId }, "[UNICA-ASR] ========== COMPLETE TRANSCRIPTION ==========");
    logger.info({ operationId }, "[UNICA-ASR] Processing Unica ASR operation completion");

    const bodyText = typeof (req as any).body?.text === "string" ? String((req as any).body.text) : null;
    const bodyChatId = typeof (req as any).body?.chatId === "string" ? String((req as any).body.chatId) : null;
    const incomingText = bodyText && bodyText.trim().length > 0 ? bodyText.trim() : null;
    const incomingChatId = bodyChatId && bodyChatId.trim().length > 0 ? bodyChatId.trim() : null;

    if (incomingChatId) {
      chatId = incomingChatId;
    }

    if (incomingText) {
      transcriptText = incomingText;
      logger.info({ operationId, textLength: transcriptText.length }, "[UNICA-ASR] Using transcript text from client");
    } else {
      const unicaStatus = await unicaAsrService.getOperationStatus(operationId);
    
      logger.info({
        operationId,
        done: unicaStatus.done,
        status: unicaStatus.status,
        hasText: Boolean(unicaStatus.text),
        textLength: unicaStatus.text?.length,
        error: unicaStatus.error,
      }, "[UNICA-ASR] Final operation status");
    
      if (!unicaStatus.done || unicaStatus.status !== 'completed' || !unicaStatus.text) {
        logger.warn({
          operationId,
          status: unicaStatus.status,
          hasText: Boolean(unicaStatus.text),
        }, '[UNICA-ASR] ❌ Operation not ready for completion');
        return res.status(400).json({ message: 'Операция не завершена или нет текста' });
      }

      transcriptText = unicaStatus.text;
      logger.info({ operationId, textLength: transcriptText.length }, "[UNICA-ASR] ✅ Transcription text retrieved");
    }
    
    // Всегда ищем ASR execution по operationId — нужен executionId для записи asr_result_final и transcript_saved
    logger.info({ operationId }, "[UNICA-ASR] Looking up ASR execution record by operationId...");
    const executions = await asrExecutionLogService.listExecutions();
    const taskId = operationId.slice("unica_".length);
    
    const execution = executions.find((e) => {
      if (!e.pipelineEvents) return false;
      return e.pipelineEvents.some((evt) => {
        const details: any = (evt as any)?.details ?? null;
        return details?.unicaOperationId === operationId || details?.taskId === taskId;
      });
    });
    
    if (execution) {
      if (!chatId) chatId = execution.chatId ?? undefined;
      if (!transcriptId) transcriptId = execution.transcriptId ?? undefined;
      executionId = execution.id;
      logger.info({
        operationId,
        chatId,
        transcriptId,
        executionId,
      }, "[UNICA-ASR] ✅ Execution record found");
    } else {
      logger.warn({ operationId }, "[UNICA-ASR] Execution record not found (pipeline events will not be updated)");
    }

    // Очистить операцию из кэша
    logger.info({ operationId }, "[UNICA-ASR] Clearing operation from cache");
    unicaAsrService.clearOperation(operationId);
  } else {
    // Yandex ASR операция (существующая логика)
    status = await yandexSttAsyncService.getOperationStatus(user.id, operationId);
    
    if (status.status !== 'completed' || !status.result?.text) {
      logger.warn({ operationId, status: status.status, hasText: Boolean(status.result?.text) }, 'Operation not ready');
      return res.status(400).json({ message: 'Операция не завершена или нет текста' });
    }

    const result = status as typeof status & { chatId?: string; transcriptId?: string; executionId?: string };
    chatId = result.chatId;
    transcriptId = result.transcriptId;
    executionId = result.executionId;
    transcriptText = status.result.text || 'Стенограмма получена';
  }

  if (!chatId) {
    logger.error({ operationId }, "[UNICA-ASR] ❌ Chat ID not found in operation");
    return res.status(400).json({ message: 'Chat ID не найден в операции' });
  }

  logger.info({ chatId, operationId }, operationId.startsWith('unica_') ? "[UNICA-ASR] Loading chat session..." : "Loading chat session");

  const chat = await storage.getChatSessionById(chatId);
  if (!chat || chat.userId !== user.id) {
    logger.error({ chatId, userId: user.id }, operationId.startsWith('unica_') ? "[UNICA-ASR] ❌ Chat not found or access denied" : "Chat not found or access denied");
    return res.status(404).json({ message: 'Чат не найден или недоступен' });
  }

  logger.info({ chatId, skillId: chat.skillId }, operationId.startsWith('unica_') ? "[UNICA-ASR] ✅ Chat loaded" : "Chat loaded");

  const skill = chat.skillId ? await getSkillById(chat.workspaceId, chat.skillId) : null;
  const autoActionEnabled = Boolean(
    skill && skill.onTranscriptionMode === 'auto_action' && skill.onTranscriptionAutoActionId,
  );
  const asrExecutionId = executionId ?? null;

  if (operationId.startsWith('unica_')) {
    logger.info({
      skillId: skill?.id,
      onTranscriptionMode: skill?.onTranscriptionMode,
      autoActionEnabled,
      autoActionId: skill?.onTranscriptionAutoActionId,
    }, "[UNICA-ASR] Skill configuration for transcription");
  }

  // Create transcript record if not exists
  logger.info({ transcriptId, operationId }, operationId.startsWith('unica_') ? "[UNICA-ASR] Creating transcript record..." : "Creating transcript record");
  
  let transcriptIdFinal: string | null = transcriptId ?? null;
  let transcriptRecord = transcriptIdFinal ? await storage.getTranscriptById?.(transcriptIdFinal) : null;
  
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
    transcriptIdFinal = transcriptRecord.id;
    logger.info({
      operationId,
      transcriptId: transcriptIdFinal,
      chatId: chat.id,
      status: initialStatus,
    }, operationId.startsWith('unica_') ? "[UNICA-ASR] ✅ Transcript record created" : '[COMPLETE-STEP] Created transcript record');
  }
  
  if (asrExecutionId) {
    await asrExecutionLogService.addEvent(asrExecutionId, {
      stage: 'transcribe_complete_called',
      details: { operationId, chatId: chat.id, transcriptId: transcriptIdFinal },
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
    transcriptId: transcriptIdFinal,
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
    transcriptId: transcriptIdFinal,
    createdByUserId: user.id,
  });

  let createdMessage = await storage.createChatMessage({
    chatId: chatId,
    role: 'assistant',
    messageType: 'card',
    cardId: card.id,
    content: previewText,
    metadata: {
      type: 'transcript',
      transcriptId: transcriptIdFinal,
      transcriptStatus: initialTranscriptStatus,
      previewText,
      cardId: card.id,
      asrExecutionId,
    },
  });
  
  if (asrExecutionId) {
    const provider = operationId.startsWith('unica_') ? 'unica' : 'yandex_speechkit';
    await asrExecutionLogService.addEvent(asrExecutionId, {
      stage: 'asr_result_final',
      details: { provider, operationId, previewText: transcriptText.substring(0, 200) },
    });
    await asrExecutionLogService.updateExecution(asrExecutionId, {
      transcriptMessageId: createdMessage.id,
      transcriptId: transcriptIdFinal ?? null,
    });
  }

  if (autoActionEnabled && skill) {
    const autoActionStartTime = Date.now();
    try {
      const actionId = skill.onTranscriptionAutoActionId!;
      logger.info({
        chatId: chat.id,
        transcriptId: transcriptIdFinal,
        actionId,
        operationId,
        elapsed: Date.now() - completeStartTime,
        transcriptTextLength: transcriptText.length,
      }, '[AUTO-ACTION-START] Starting auto-action with input text');
      
      if (asrExecutionId) {
        await asrExecutionLogService.addEvent(asrExecutionId, {
          stage: 'auto_action_triggered',
          details: { skillId: skill.id, actionId, transcriptTextLength: transcriptText.length },
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
        transcriptId: transcriptIdFinal,
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
        transcriptId: transcriptIdFinal,
        transcriptText,
        context: ctx,
      });

      const updatedPreviewText = (resultAction.text ?? transcriptText).slice(0, 200);
      logger.info({ 
        chatId: chat.id, 
        actionId: action.id,
        originalTextLength: transcriptText.length,
        resultTextLength: resultAction.text?.length || 0,
        previewLength: updatedPreviewText.length,
        applied: resultAction.applied,
      }, '[AUTO-ACTION-SUCCESS] Auto-action completed successfully');
      
      await storage.updateChatCard(card.id, { previewText: updatedPreviewText });
      
      if (asrExecutionId) {
        await asrExecutionLogService.addEvent(asrExecutionId, {
          stage: 'auto_action_completed',
          details: { skillId: skill.id, actionId, success: true },
        });
      }
      
      if (transcriptIdFinal) {
        await storage.updateTranscript(transcriptIdFinal, {
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
          details: { transcriptId: transcriptIdFinal },
        });
        await asrExecutionLogService.updateExecution(asrExecutionId, {
          status: 'success',
          finishedAt: new Date(),
          transcriptId: transcriptIdFinal ?? null,
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
      
      if (transcriptIdFinal) {
        await storage.updateTranscript(transcriptIdFinal, {
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
          transcriptId: transcriptIdFinal ?? null,
          transcriptMessageId: createdMessage.id,
          finishedAt: new Date(),
        });
      }
    }
  } else {
    if (transcriptIdFinal) {
      await storage.updateTranscript(transcriptIdFinal, {
        status: 'ready',
        previewText: transcriptText.substring(0, 200),
      });
    }
    await storage.updateChatCard(card.id, { previewText: transcriptText.substring(0, 200) });
    
    if (asrExecutionId) {
      await asrExecutionLogService.addEvent(asrExecutionId, {
        stage: 'transcript_saved',
        details: { transcriptId: transcriptIdFinal },
      });
      await asrExecutionLogService.updateExecution(asrExecutionId, {
        status: 'success',
        finishedAt: new Date(),
        transcriptId: transcriptIdFinal ?? null,
        transcriptMessageId: createdMessage.id,
      });
    }
  }

  // Update BotAction to show completion (standard mode)
  try {
    logger.info({ operationId, chatId: chat.id }, operationId.startsWith('unica_') ? "[UNICA-ASR] Updating bot action to completed" : "Updating bot action");
    await upsertBotActionForChat({
      workspaceId: chat.workspaceId,
      chatId: chat.id,
      actionId: `transcribe-${operationId}`,
      actionType: 'transcribe_audio',
      status: 'done',
      displayText: 'Распознавание завершено',
      userId: user.id,
    });
    logger.info({ operationId }, operationId.startsWith('unica_') ? "[UNICA-ASR] ✅ Bot action updated" : '[COMPLETE-BOT-ACTION] Updated bot action to done');
  } catch (botActionError) {
    // Non-critical error, log and continue
    logger.warn({ error: botActionError, operationId }, operationId.startsWith('unica_') ? "[UNICA-ASR] ⚠️ Failed to update bot action" : '[COMPLETE-BOT-ACTION] Failed to update bot action');
  }

  if (operationId.startsWith('unica_')) {
    logger.info({
      operationId,
      messageId: createdMessage.id,
      transcriptId: transcriptIdFinal,
      chatId: chat.id,
      elapsed: Date.now() - completeStartTime,
    }, "[UNICA-ASR] ========== TRANSCRIPTION COMPLETE ==========");
    logger.info({ operationId }, "[UNICA-ASR] ✅ Unica ASR flow successfully completed!");
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
