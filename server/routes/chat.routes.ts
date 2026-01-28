/**
 * Chat Routes Module
 * 
 * Handles chat session operations:
 * - GET /api/chat/sessions - List chat sessions
 * - POST /api/chat/sessions - Create chat session
 * - PATCH /api/chat/sessions/:chatId - Rename chat
 * - DELETE /api/chat/sessions/:chatId - Delete chat
 * - GET /api/chat/sessions/:chatId/messages - Get messages
 * - POST /api/chat/sessions/:chatId/messages/llm - Send message to LLM
 * - POST /api/chat/sessions/:chatId/messages/file - Upload file to chat (no-code mode)
 * - POST /api/chat/sessions/:chatId/messages/:messageId/send - Send uploaded file event (no-code)
 * - GET /api/chat/actions - List bot actions
 * - POST /api/chat/actions/start - Start bot action
 * - POST /api/chat/actions/update - Update bot action status
 */

import { Router, type Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import multer from 'multer';
import { storage } from '../storage';
import { createLogger, logger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { llmChatLimiter } from '../middleware/rate-limit';
import { uploadFileToProvider, FileUploadToProviderError } from '../file-storage-provider-upload-service';
import { enqueueFileEventForSkill } from '../no-code-file-events';
import { buildFileUploadedEventPayload } from '../no-code-events';
import {
  ChatServiceError,
  buildChatServiceErrorPayload,
  createChat,
  renameChat,
  deleteChat,
  getChatMessages,
  getChatById,
  listUserChats,
  addUserMessage,
  addAssistantMessage,
  mapMessage,
  mapChatSummary,
  buildChatLlmContext,
  buildChatCompletionRequestBody,
  upsertBotActionForChat,
  listBotActionsForChat,
} from '../chat-service';
import { scheduleChatTitleGenerationIfNeeded } from '../chat-title-jobs';
import { getSkillById, getSkillBearerToken, createUnicaChatSkillForWorkspace, UNICA_CHAT_SYSTEM_KEY } from '../skills';
import { SkillRagConfigurationError, callRagForSkillChat } from '../chat-rag';
import { runKnowledgeBaseRagPipeline } from '../lib/rag-pipeline';
import { OperationBlockedError, mapDecisionToPayload } from '../guards/errors';
import { workspaceOperationGuard } from '../guards/workspace-operation-guard';
import { buildLlmOperationContext } from '../guards/helpers';
import { executeLlmCompletion } from '../llm-client';
import { fetchAccessToken } from '../llm-access-token';
import { measureTokensForModel } from '../lib/embedding-utils';
import { recordLlmUsageEvent } from '../usage/usage-service';
import { applyIdempotentUsageCharge } from '../idempotent-charge-service';
import { skillExecutionLogService } from '../skill-execution-log-context';
import type { SkillExecutionStartContext } from '../skill-execution-log-service';
import { SKILL_EXECUTION_STATUS, SKILL_EXECUTION_STEP_STATUS, type SkillExecutionStepType, type SkillExecutionStepStatus, type SkillExecutionStatus } from '../skill-execution-log';
import { getNoCodeConnectionInternal, scheduleNoCodeEventDelivery, buildMessageCreatedEventPayload } from '../no-code-events';
import { onChatEvent, offChatEvent, type ChatEventPayload } from '../chat-events';
import { centsToCredits } from '@shared/credits';
import {
  createNoCodeFlowError,
  sendSseEvent,
  calculatePriceSnapshot,
  handlePreflightError,
  ensureCreditsForLlmPreflight,
  forwardLlmStreamEvents,
  sanitizeHeadersForLog,
  resolveOperationId,
  getErrorDetails,
  type ModelInfoForUsage,
} from '../lib/chat-llm-helpers';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('chat');

export const chatRouter = Router();

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

function pickFirstString(...values: unknown[]): string | undefined {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

function resolveWorkspaceIdForRequest(req: Request, explicitId: string | null): string {
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

/**
 * GET /sessions/:chatId/sources
 * Get accumulated sources from all messages in the chat
 */
chatRouter.get('/sessions/:chatId/sources', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const chatId = req.params.chatId;
  
  // Проверяем доступ к чату
  await getChatById(chatId, workspaceId, user.id);
  
  // Получаем все сообщения чата
  const messages = await getChatMessages(chatId, workspaceId, user.id);
  
  // Накопление источников
  const sourcesMap = new Map<string, {
    chunk_id: string;
    doc_id: string;
    doc_title: string;
    section_title: string | null;
    snippet?: string;
    score?: number;
    totalScore: number;
    usedInMessages: string[];
    firstUsedAt: string;
    node_id?: string | null;
    node_slug?: string | null;
    knowledge_base_id?: string | null;
  }>();
  
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    
    const metadata = message.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    
    const citations = (metadata as { citations?: unknown }).citations;
    if (!Array.isArray(citations)) continue;
    
    for (const citation of citations) {
      if (typeof citation !== "object" || citation === null) continue;
      
      const citationRecord = citation as Record<string, unknown>;
      const chunkId = typeof citationRecord.chunk_id === "string" ? citationRecord.chunk_id : null;
      const docId = typeof citationRecord.doc_id === "string" ? citationRecord.doc_id : null;
      
      if (!chunkId && !docId) continue;
      
      const key = chunkId || docId || "";
      const score = typeof citationRecord.score === "number" ? citationRecord.score : 0;
      
      if (sourcesMap.has(key)) {
        const existing = sourcesMap.get(key)!;
        if (!existing.usedInMessages.includes(message.id)) {
          existing.usedInMessages.push(message.id);
        }
        existing.totalScore = Math.max(existing.totalScore, score);
      } else {
        sourcesMap.set(key, {
          chunk_id: chunkId || "",
          doc_id: docId || "",
          doc_title: typeof citationRecord.doc_title === "string" ? citationRecord.doc_title : "",
          section_title: typeof citationRecord.section_title === "string" ? citationRecord.section_title : null,
          snippet: typeof citationRecord.snippet === "string" ? citationRecord.snippet : undefined,
          score: score > 0 ? score : undefined,
          totalScore: score,
          usedInMessages: [message.id],
          firstUsedAt: message.createdAt,
          node_id: typeof citationRecord.node_id === "string" ? citationRecord.node_id : null,
          node_slug: typeof citationRecord.node_slug === "string" ? citationRecord.node_slug : null,
          knowledge_base_id: typeof citationRecord.knowledge_base_id === "string" ? citationRecord.knowledge_base_id : null,
        });
      }
    }
  }
  
  const sources = Array.from(sourcesMap.values())
    .sort((a, b) => b.totalScore - a.totalScore);
  
  const totalDocuments = new Set(sources.map(s => s.doc_id)).size;
  
  res.json({
    chatId,
    totalSources: sources.length,
    totalDocuments,
    sources,
  });
}));

/**
 * GET /sessions/:chatId/events
 * Subscribe to chat events (SSE)
 */
chatRouter.get('/sessions/:chatId/events', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const chatId = req.params.chatId;
  await getChatById(chatId, workspaceId, user.id);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const flushHeaders = (res as Response & { flushHeaders?: () => void }).flushHeaders;
  if (typeof flushHeaders === 'function') {
    flushHeaders.call(res);
  }

  // Heartbeat для поддержания соединения активным (особенно важно для HTTP/2)
  // Отправляем комментарий каждые 30 секунд, чтобы соединение не считалось idle
  const heartbeatInterval = setInterval(() => {
    try {
      // SSE комментарии используются как keep-alive
      res.write(': heartbeat\n\n');
      const flusher = (res as Response & { flush?: () => void }).flush;
      if (typeof flusher === 'function') {
        flusher.call(res);
      }
    } catch (error) {
      // Игнорируем ошибки записи (соединение может быть закрыто)
      logger.debug({ chatId, error }, 'Heartbeat write error, connection may be closed');
    }
  }, 30000); // 30 секунд

  const listener = (payload: ChatEventPayload) => {
    try {
      logger.debug({ chatId, payloadType: payload.type, hasMessage: !!payload.message, hasAction: !!payload.action }, 'Sending SSE event to client');
      sendSseEvent(res, 'message', payload);
    } catch (error) {
      // Игнорируем ошибки записи (соединение может быть закрыто)
      logger.debug({ chatId, error }, 'Failed to send SSE event, connection may be closed');
      offChatEvent(chatId, listener);
      clearInterval(heartbeatInterval);
    }
  };

  onChatEvent(chatId, listener);

  req.on('close', () => {
    clearInterval(heartbeatInterval);
    offChatEvent(chatId, listener);
    res.end();
  });
}));

/**
 * GET /actions
 * List bot actions for chat
 */
chatRouter.get('/actions', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const workspaceCandidate = pickFirstString(req.query.workspaceId, req.query.workspace_id);
  const workspaceId = resolveWorkspaceIdForRequest(req, workspaceCandidate as string | null);
  const chatId = pickFirstString(req.query.chatId, req.query.chat_id);
  
  if (!chatId) {
    return res.status(400).json({ message: 'chatId is required' });
  }

  const statusParam = pickFirstString(req.query.status);
  const status = statusParam === 'processing' || statusParam === 'done' || statusParam === 'error' ? statusParam : 'processing';
  
  const actions = await listBotActionsForChat({
    workspaceId,
    chatId,
    userId: user.id,
    status,
  });
  
  res.json({ actions });
}));

/**
 * POST /actions/start
 * Start bot action
 */
chatRouter.post('/actions/start', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = startBotActionSchema.parse(req.body ?? {});
  
  const action = await upsertBotActionForChat({
    workspaceId: payload.workspaceId,
    chatId: payload.chatId,
    actionId: payload.actionId,
    actionType: payload.actionType,
    status: 'processing',
    displayText: payload.displayText,
    payload: payload.payload ?? null,
    userId: user.id,
  });
  
  res.json({ action });
}));

/**
 * POST /actions/update
 * Update bot action status
 */
chatRouter.post('/actions/update', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = updateBotActionSchema.parse(req.body ?? {});
  
  const action = await upsertBotActionForChat({
    workspaceId: payload.workspaceId,
    chatId: payload.chatId,
    actionId: payload.actionId,
    actionType: payload.actionType,
    status: payload.status,
    displayText: payload.displayText,
    payload: payload.payload ?? null,
    userId: user.id,
  });
  
  res.json({ action });
}));

// ============================================================================
// Validation Schemas
// ============================================================================

const createChatMessageSchema = z.object({
  content: z.string().trim().min(1, 'Сообщение не может быть пустым'),
  workspaceId: z.string().optional(),
  stream: z.boolean().optional(),
});

const startBotActionSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  actionId: z.string().trim().min(1),
  actionType: z.string().trim().min(1),
  displayText: z.string().trim().optional(),
  payload: z.record(z.unknown()).optional(),
});

const updateBotActionSchema = z.object({
  workspaceId: z.string().trim().min(1),
  chatId: z.string().trim().min(1),
  actionId: z.string().trim().min(1),
  actionType: z.string().trim().min(1),
  status: z.enum(['processing', 'done', 'error']),
  displayText: z.string().trim().optional(),
  payload: z.record(z.unknown()).optional().nullable(),
});

// ============================================================================
// LLM Chat Endpoint Types
// ============================================================================

interface KnowledgeBaseRagPipelineResponse {
  response: {
    answer: string;
    knowledgeBaseId?: string;
    normalizedQuery?: string;
    citations?: unknown[];
    usage?: unknown;
    query?: string;
  };
}

type StepLogMeta = {
  input?: unknown;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  diagnosticInfo?: string;
};

/**
 * POST /sessions/:chatId/messages/llm
 * Send message to LLM and get response (supports streaming)
 */
chatRouter.post('/sessions/:chatId/messages/llm', llmChatLimiter, asyncHandler(async (req, res, next) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const acceptHeader = typeof req.headers.accept === 'string' ? req.headers.accept.toLowerCase() : '';
  let streamingResponseStarted = false;
  let resolvedWorkspaceId: string | null = null;
  let executionId: string | null = null;
  let userMessageRecord: ReturnType<typeof mapMessage> | null = null;
  const operationId = resolveOperationId(req);

  const safeStartExecution = async (context: SkillExecutionStartContext) => {
    try {
      const execution = await skillExecutionLogService.startExecution(context);
      executionId = execution?.id ?? null;
    } catch (logError) {
    }
  };

  const safeLogStep = async (type: SkillExecutionStepType | string, status: SkillExecutionStepStatus, meta: StepLogMeta = {}) => {
    if (!executionId) return;
    try {
      const payload = { executionId, type: type as SkillExecutionStepType, input: meta.input, output: meta.output, errorCode: meta.errorCode, errorMessage: meta.errorMessage, diagnosticInfo: meta.diagnosticInfo };
      if (status === SKILL_EXECUTION_STEP_STATUS.SUCCESS) {
        await skillExecutionLogService.logStepSuccess(payload);
      } else if (status === SKILL_EXECUTION_STEP_STATUS.ERROR) {
        await skillExecutionLogService.logStepError(payload);
      } else {
        await skillExecutionLogService.logStep({ ...payload, status });
      }
    } catch (logError) {
      logger.error({ err: logError }, `[chat] step log failed type=${type} chat=${req.params.chatId}`);
    }
  };

  const safeFinishExecution = async (status: SkillExecutionStatus) => {
    if (!executionId) return;
    try {
      const extra = { userMessageId: userMessageRecord?.id };
      if (status === SKILL_EXECUTION_STATUS.SUCCESS) {
        await skillExecutionLogService.markExecutionSuccess(executionId, extra);
      } else if (status === SKILL_EXECUTION_STATUS.ERROR) {
        await skillExecutionLogService.markExecutionFailed(executionId, extra);
      } else {
        await skillExecutionLogService.finishExecution(executionId, status, extra);
      }
    } catch (logError) {
    }
  };

  const describeErrorForLog = (error: unknown) => {
    if (error instanceof ChatServiceError) {
      return { code: `${error.status}`, message: error.message, diagnosticInfo: undefined as string | undefined };
    }
    if (error instanceof Error) {
      return { code: undefined, message: error.message, diagnosticInfo: error.stack };
    }
    return { code: undefined, message: typeof error === 'string' ? error : 'Unknown error', diagnosticInfo: undefined as string | undefined };
  };

  const writeAssistantMessage = async (chatId: string, workspaceId: string, userId: string, answer: string, metadata?: Record<string, unknown>) => {
    try {
      const message = await addAssistantMessage(chatId, workspaceId, userId, answer, metadata);
      await safeLogStep('WRITE_ASSISTANT_MESSAGE', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { input: { chatId, workspaceId, responseLength: answer.length }, output: { messageId: message.id } });
      return message;
    } catch (assistantError) {
      const info = describeErrorForLog(assistantError);
      await safeLogStep('WRITE_ASSISTANT_MESSAGE', SKILL_EXECUTION_STEP_STATUS.ERROR, { input: { chatId, workspaceId }, errorCode: info.code, errorMessage: info.message, diagnosticInfo: info.diagnosticInfo });
      throw assistantError;
    }
  };

  try {
    const payload = createChatMessageSchema.parse(req.body ?? {});
    const workspaceCandidate = pickFirstString(payload.workspaceId, req.query.workspaceId as string | undefined, req.query.workspace_id as string | undefined);
    const workspaceId = resolveWorkspaceIdForRequest(req, workspaceCandidate ?? null);
    resolvedWorkspaceId = workspaceId;
    const wantsStream = payload.stream !== false;

    const chat = await getChatById(req.params.chatId, workspaceId, user.id);
    if (chat.status === 'archived') {
      return res.status(403).json({ message: 'Чат архивирован и доступен только для чтения' });
    }

    const skillForChat = await getSkillById(workspaceId, chat.skillId);
    if (skillForChat && skillForChat.status === 'archived') {
      return res.status(403).json({ message: 'Навык архивирован, чат доступен только для чтения' });
    }

    await safeStartExecution({
      workspaceId,
      userId: user.id,
      skillId: chat.skillId,
      chatId: chat.id,
      source: chat.skillIsSystem && chat.skillSystemKey === UNICA_CHAT_SYSTEM_KEY ? 'system_unica_chat' : 'workspace_skill',
    });

    await safeLogStep('RECEIVE_HTTP_REQUEST', SKILL_EXECUTION_STEP_STATUS.SUCCESS, {
      input: { chatId: req.params.chatId, workspaceId, hasStreamHeader: acceptHeader.includes('text/event-stream'), bodyLength: payload.content.length, headers: sanitizeHeadersForLog(new Headers(req.headers as HeadersInit)) },
      output: { wantsStream },
    });

    logger.info(`[chat] user=${user.id} workspace=${workspaceId} chat=${req.params.chatId} incoming message`);

    try {
      userMessageRecord = await addUserMessage(req.params.chatId, workspaceId, user.id, payload.content);
      await safeLogStep('WRITE_USER_MESSAGE', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { input: { chatId: req.params.chatId, contentLength: payload.content.length }, output: { messageId: userMessageRecord.id } });
      scheduleChatTitleGenerationIfNeeded({ chatId: req.params.chatId, workspaceId, userId: user.id, messageText: payload.content, messageMetadata: userMessageRecord?.metadata ?? {}, chatTitle: chat.title });
    } catch (messageError) {
      await safeLogStep('WRITE_USER_MESSAGE', SKILL_EXECUTION_STEP_STATUS.ERROR, { input: { chatId: req.params.chatId }, errorCode: messageError instanceof ChatServiceError ? `${messageError.status}` : undefined, errorMessage: messageError instanceof Error ? messageError.message : 'Failed to save user message' });
      throw messageError;
    }

    if (!userMessageRecord) throw new Error('Failed to create user message');

    // No-code skill handling
    if (skillForChat && skillForChat.executionMode === 'no_code') {
      const connection = await getNoCodeConnectionInternal({ workspaceId, skillId: skillForChat.id });
      if (!connection?.endpointUrl) throw createNoCodeFlowError('NOT_CONFIGURED');
      if (connection.authType === 'bearer' && !connection.bearerToken) throw createNoCodeFlowError('NOT_CONFIGURED');

      await safeLogStep('DISPATCH_NO_CODE_EVENT', SKILL_EXECUTION_STEP_STATUS.RUNNING, { input: { chatId: chat.id, userMessageId: userMessageRecord?.id, skillId: skillForChat.id } });

      const eventPayload = buildMessageCreatedEventPayload({ workspaceId, chatId: chat.id, skillId: skillForChat.id, message: userMessageRecord, actorUserId: user.id });
      scheduleNoCodeEventDelivery({ endpointUrl: connection.endpointUrl, authType: connection.authType, bearerToken: connection.bearerToken, payload: eventPayload });

      await safeLogStep('DISPATCH_NO_CODE_EVENT', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { eventId: eventPayload.eventId } });
      await safeFinishExecution(SKILL_EXECUTION_STATUS.SUCCESS);
      return res.status(202).json({ accepted: true, userMessage: userMessageRecord });
    }

    const pipelineStartTime = performance.now();
    const context = await buildChatLlmContext(req.params.chatId, workspaceId, user.id, { executionId });

    // RAG skill handling
    if (context.skill.isRagSkill) {
      const ragStepInput = { chatId: req.params.chatId, workspaceId, skillId: context.skill.id, knowledgeBaseId: context.skillConfig.knowledgeBaseIds?.[0] ?? null, collections: context.skillConfig.ragConfig?.collectionIds ?? [] };
      await safeLogStep('CALL_RAG_PIPELINE', SKILL_EXECUTION_STEP_STATUS.RUNNING, { input: ragStepInput });

      logger.info({
        step: "rag_chat_start",
        chatId: req.params.chatId,
        skillId: context.skill.id,
        workspaceId,
        userMessageId: userMessageRecord?.id,
        userMessageLength: payload.content.length,
        multiTurnEnabled: true,
      }, "[MULTI_TURN_RAG] Starting RAG chat with multi-turn support");

      let ragResult: KnowledgeBaseRagPipelineResponse | null = null;
      try {
        // Создаем stream handler если нужен streaming
        const streamHandler = wantsStream ? {
          onEvent: (eventName: string, payload?: unknown) => {
            sendSseEvent(res, eventName, payload);
          }
        } : null;
        
        // Устанавливаем SSE headers до вызова pipeline если нужен streaming
        if (wantsStream) {
          streamingResponseStarted = true;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no');
        }
        
        ragResult = await callRagForSkillChat({ 
          req, 
          skill: context.skillConfig, 
          workspaceId, 
          userMessage: payload.content,
          chatId: req.params.chatId, // Передаем chatId для получения истории
          excludeMessageId: userMessageRecord?.id, // Исключаем текущее сообщение из истории
          runPipeline: runKnowledgeBaseRagPipeline, 
          stream: streamHandler
        }) as KnowledgeBaseRagPipelineResponse;
        
        logger.info({
          component: 'RAG_PIPELINE',
          step: "rag_pipeline_complete",
          chatId: req.params.chatId,
          skillId: context.skill.id,
          skillName: context.skill.name,
          workspaceId,
          answerLength: ragResult.response.answer.length,
          citationsCount: ragResult.response.citations?.length ?? 0,
          chunksCount: ragResult.response.chunks?.length ?? 0,
          knowledgeBaseId: ragResult.response.knowledgeBaseId,
          normalizedQuery: ragResult.response.normalizedQuery?.substring(0, 100),
          usage: ragResult.response.usage,
          timings: ragResult.response.timings,
          queryRewritingEnabled: context.skillConfig.ragConfig?.enableQueryRewriting ?? true,
          historyEnabled: context.skillConfig.ragConfig?.historyMessagesLimit !== 0,
        }, `[RAG] Pipeline complete: ${ragResult.response.answer.length} chars answer, ${ragResult.response.citations?.length ?? 0} citations`);
        await safeLogStep('CALL_RAG_PIPELINE', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { answerPreview: ragResult.response.answer.slice(0, 160), knowledgeBaseId: ragResult.response.knowledgeBaseId, usage: ragResult.response.usage ?? null } });
      } catch (ragError) {
        const info = describeErrorForLog(ragError);
        logger.error({
          component: 'RAG_PIPELINE',
          step: "rag_pipeline_error",
          chatId: req.params.chatId,
          skillId: context.skill.id,
          skillName: context.skill?.name,
          workspaceId,
          errorCode: info.code,
          errorMessage: info.message,
          diagnosticInfo: info.diagnosticInfo,
          errorStack: ragError instanceof Error ? ragError.stack?.split('\n').slice(0, 5).join('\n') : undefined,
        }, `[RAG] Pipeline failed: ${info.message}`);
        
        await safeLogStep('CALL_RAG_PIPELINE', SKILL_EXECUTION_STEP_STATUS.ERROR, { errorCode: info.code, errorMessage: info.message, diagnosticInfo: info.diagnosticInfo, input: ragStepInput });
        if (ragError instanceof SkillRagConfigurationError) throw new ChatServiceError(ragError.message, 400);
        throw ragError;
      }

      if (!ragResult) throw new Error('RAG pipeline returned empty result');

      const citations = Array.isArray(ragResult.response.citations) ? ragResult.response.citations : [];
      
      // Проверяем настройку показа источников
      const showSources = context.skillConfig.ragConfig?.showSources ?? true;
      
      logger.info({
        component: 'CHAT_RAG',
        step: 'citations_processing',
        chatId: req.params.chatId,
        skillId: context.skill.id,
        citationsCount: citations.length,
        showSources,
        ragConfig: context.skillConfig.ragConfig,
        citationsSample: citations.length > 0 ? {
          chunk_id: citations[0].chunk_id,
          doc_id: citations[0].doc_id,
          doc_title: citations[0].doc_title,
          score: citations[0].score,
        } : null,
      }, `[CHAT RAG] Processing citations: ${citations.length} citations, showSources=${showSources}`);
      
      // Citations уже отфильтрованы в pipeline на основе allowSources (который учитывает настройку навыка)
      // Но на всякий случай проверяем ещё раз настройку навыка для дополнительной безопасности
      const metadata = showSources && citations.length > 0 ? { citations } : undefined;
      
      if (metadata) {
        logger.info({
          component: 'CHAT_RAG',
          step: 'metadata_created',
          chatId: req.params.chatId,
          citationsCount: metadata.citations.length,
        }, `[CHAT RAG] Metadata created with ${metadata.citations.length} citations`);
      } else {
        logger.info({
          component: 'CHAT_RAG',
          step: 'metadata_skipped',
          chatId: req.params.chatId,
          reason: !showSources ? 'showSources=false' : citations.length === 0 ? 'no_citations' : 'unknown',
        }, `[CHAT RAG] Metadata skipped (showSources=${showSources}, citations=${citations.length})`);
      }

      if (wantsStream) {
        // Streaming уже выполнен в pipeline, просто отправляем done event
        const assistantMessage = await writeAssistantMessage(req.params.chatId, workspaceId, user.id, ragResult.response.answer, metadata);
        
        logger.info({
          component: 'CHAT_RAG',
          step: 'sse_done_sent',
          chatId: req.params.chatId,
          assistantMessageId: assistantMessage.id,
          citationsInPayload: ragResult.response.citations.length,
          metadataCitations: metadata?.citations?.length ?? 0,
        }, `[CHAT RAG] SSE done event sent with ${ragResult.response.citations.length} citations in payload`);
        
        sendSseEvent(res, 'done', { assistantMessageId: assistantMessage.id, userMessageId: userMessageRecord?.id ?? null, rag: { knowledgeBaseId: ragResult.response.knowledgeBaseId, normalizedQuery: ragResult.response.normalizedQuery, citations: ragResult.response.citations } });
        await safeFinishExecution(SKILL_EXECUTION_STATUS.SUCCESS);
        res.end();
      } else {
        const assistantMessage = await writeAssistantMessage(req.params.chatId, workspaceId, user.id, ragResult.response.answer, metadata);
        await safeFinishExecution(SKILL_EXECUTION_STATUS.SUCCESS);
        res.json({ message: assistantMessage, userMessage: userMessageRecord, usage: ragResult.response.usage ?? null, rag: { knowledgeBaseId: ragResult.response.knowledgeBaseId, normalizedQuery: ragResult.response.normalizedQuery, citations: ragResult.response.citations } });
      }
      return;
    }

    // Standard LLM completion (no RAG)
    let stepStartTime = performance.now();
    
    const requestBody = buildChatCompletionRequestBody(context, { stream: wantsStream });
    const step1Duration = performance.now() - stepStartTime;
    logger.info({
      component: 'LLM_PIPELINE',
      step: '1_build_request_body',
      chatId: req.params.chatId,
      durationMs: Math.round(step1Duration),
    }, `[LLM PIPELINE] Step 1: Build request body - ${Math.round(step1Duration)}ms`);
    
    stepStartTime = performance.now();
    const accessToken = await fetchAccessToken(context.provider);
    const step2Duration = performance.now() - stepStartTime;
    logger.info({
      component: 'LLM_PIPELINE',
      step: '2_fetch_access_token',
      chatId: req.params.chatId,
      durationMs: Math.round(step2Duration),
    }, `[LLM PIPELINE] Step 2: Fetch access token - ${Math.round(step2Duration)}ms`);
    
    const totalPromptChars = Array.isArray(requestBody[context.requestConfig.messagesField]) ? JSON.stringify(requestBody[context.requestConfig.messagesField]).length : 0;
    const resolvedModelKey = context.model ?? context.provider.model ?? null;
    const resolvedModelId = context.modelInfo?.id ?? null;
    const llmCallInput = { providerId: context.provider.id, endpoint: context.provider.completionUrl ?? null, model: resolvedModelKey, modelId: resolvedModelId, stream: wantsStream, temperature: context.requestConfig.temperature ?? null, messageCount: context.messages.length, promptLength: totalPromptChars };

    // Log LLM request start (pure LLM without RAG)
    const llmStartTime = performance.now();
    logger.info({
      component: 'LLM_PIPELINE',
      step: 'start',
      chatId: req.params.chatId,
      skillId: context.skill?.id ?? null,
      skillName: context.skill?.name ?? null,
      workspaceId,
      providerId: context.provider.id,
      providerName: context.provider.name,
      model: resolvedModelKey,
      modelId: resolvedModelId,
      isStreaming: wantsStream,
      messagesCount: context.messages.length,
      promptLength: totalPromptChars,
      temperature: context.requestConfig.temperature ?? null,
      maxTokens: context.requestConfig.maxTokens ?? null,
      userMessagePreview: payload.content.substring(0, 200),
      hasSystemPrompt: !!context.skill?.systemPrompt,
      systemPromptLength: context.skill?.systemPrompt?.length ?? 0,
    }, `[LLM PIPELINE] START: chat=${req.params.chatId}, provider=${context.provider.name}, model=${resolvedModelKey}, messages=${context.messages.length}, stream=${wantsStream}`);

    stepStartTime = performance.now();
    const llmGuardDecision = await workspaceOperationGuard.check(buildLlmOperationContext({ workspaceId, providerId: context.provider.id ?? context.provider.providerType ?? 'unknown', model: resolvedModelKey, modelId: resolvedModelId, modelKey: context.modelInfo?.modelKey ?? resolvedModelKey, scenario: context.skillConfig ? 'skill' : 'chat', tokens: context.requestConfig.maxTokens }));
    const step3Duration = performance.now() - stepStartTime;
    logger.info({
      component: 'LLM_PIPELINE',
      step: '3_guard_check',
      chatId: req.params.chatId,
      durationMs: Math.round(step3Duration),
    }, `[LLM PIPELINE] Step 3: Guard check - ${Math.round(step3Duration)}ms`);
    if (!llmGuardDecision.allowed) {
      throw new OperationBlockedError(mapDecisionToPayload(llmGuardDecision, { workspaceId, operationType: 'LLM_REQUEST', meta: { llm: { provider: context.provider.id, model: resolvedModelKey, modelId: resolvedModelId, modelKey: context.modelInfo?.modelKey ?? resolvedModelKey } } }));
    }

    // Preflight credits check
    stepStartTime = performance.now();
    const promptTokensEstimate = Math.ceil(totalPromptChars / 4);
    const maxOutputTokens = context.requestConfig.maxTokens ?? null;
    try {
      await ensureCreditsForLlmPreflight(workspaceId, context.modelInfo as ModelInfoForUsage, promptTokensEstimate, maxOutputTokens);
      const step4Duration = performance.now() - stepStartTime;
      logger.info({
        component: 'LLM_PIPELINE',
        step: '4_credits_check',
        chatId: req.params.chatId,
        durationMs: Math.round(step4Duration),
      }, `[LLM PIPELINE] Step 4: Credits check - ${Math.round(step4Duration)}ms`);
    } catch (error) {
      if (handlePreflightError(res, error)) return;
      throw error;
    }

    await safeLogStep('CALL_LLM', SKILL_EXECUTION_STEP_STATUS.RUNNING, { input: llmCallInput });
    let llmCallCompleted = false;

    if (wantsStream) {
      streamingResponseStarted = true;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      await safeLogStep('STREAM_TO_CLIENT_START', SKILL_EXECUTION_STEP_STATUS.RUNNING, { input: { chatId: req.params.chatId, workspaceId, stream: true } });

      stepStartTime = performance.now();
      const completionPromise = executeLlmCompletion(context.provider, accessToken, requestBody, { stream: true });
      const streamIterator = completionPromise.streamIterator;
      const forwarder = streamIterator && forwardLlmStreamEvents(streamIterator, (eventName: string, payload?: unknown) => sendSseEvent(res, eventName, payload));

      try {
        const completion = await completionPromise;
        llmCallCompleted = true;
        const step5Duration = performance.now() - stepStartTime;
        const llmDurationMs = performance.now() - llmStartTime;
        logger.info({
          component: 'LLM_PIPELINE',
          step: '5_llm_call',
          chatId: req.params.chatId,
          durationMs: Math.round(step5Duration),
        }, `[LLM PIPELINE] Step 5: LLM call - ${Math.round(step5Duration)}ms`);
        const tokensTotal = completion.usageTokens ?? Math.ceil(completion.answer.length / 4);
        const llmUsageMeasurement = measureTokensForModel(tokensTotal, { consumptionUnit: context.modelInfo?.consumptionUnit ?? 'TOKENS_1K', modelKey: context.modelInfo?.modelKey ?? resolvedModelKey });
        const llmPrice = calculatePriceSnapshot(context.modelInfo as ModelInfoForUsage, llmUsageMeasurement);
        const usageOperationId = operationId ?? executionId ?? randomUUID();

        // Log LLM response (streaming)
        logger.info({
          component: 'LLM_PIPELINE',
          step: 'response',
          chatId: req.params.chatId,
          skillId: context.skill?.id ?? null,
          workspaceId,
          providerId: context.provider.id,
          model: resolvedModelKey,
          isStreaming: true,
          answerLength: completion.answer.length,
          usageTokens: tokensTotal,
          durationMs: Math.round(llmDurationMs),
          answerPreview: completion.answer.substring(0, 200),
        }, `[LLM PIPELINE] RESPONSE: ${completion.answer.length} chars, ${tokensTotal} tokens in ${Math.round(llmDurationMs)}ms (streaming)`);

        await safeLogStep('CALL_LLM', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { usageTokens: tokensTotal, usageUnits: llmUsageMeasurement?.quantity ?? null, usageUnit: llmUsageMeasurement?.unit ?? null, creditsCharged: llmPrice ? centsToCredits(llmPrice.creditsChargedCents) : null, responsePreview: completion.answer.slice(0, 160) } });

        stepStartTime = performance.now();
        if (tokensTotal) {
          try {
            await recordLlmUsageEvent({ workspaceId, executionId: usageOperationId, provider: context.provider.id ?? context.provider.providerType ?? 'unknown', model: resolvedModelKey ?? 'unknown', modelId: resolvedModelId ?? null, tokensTotal: llmUsageMeasurement?.quantityRaw ?? tokensTotal, appliedCreditsPerUnit: llmPrice?.appliedCreditsPerUnitCents ?? null, creditsCharged: llmPrice?.creditsChargedCents ?? null, occurredAt: new Date() });
            if (workspaceId && llmUsageMeasurement && llmPrice) {
              await applyIdempotentUsageCharge({ workspaceId, operationId: usageOperationId, model: { id: resolvedModelId ?? null, key: resolvedModelKey ?? null, name: context.modelInfo?.displayName ?? null, type: context.modelInfo?.modelType ?? 'LLM', consumptionUnit: llmUsageMeasurement.unit }, measurement: llmUsageMeasurement, price: llmPrice, metadata: { source: 'chat_llm', chatId: req.params.chatId, executionId } });
            }
          } catch (usageError) {
            logger.error({ err: usageError }, `[usage] Failed to record LLM tokens for operation ${usageOperationId}`);
          }
        }
        const step6Duration = performance.now() - stepStartTime;
        logger.info({
          component: 'LLM_PIPELINE',
          step: '6_record_usage',
          chatId: req.params.chatId,
          durationMs: Math.round(step6Duration),
        }, `[LLM PIPELINE] Step 6: Record usage - ${Math.round(step6Duration)}ms`);

        if (forwarder) await forwarder;
        stepStartTime = performance.now();
        const assistantMessage = await writeAssistantMessage(req.params.chatId, workspaceId, user.id, completion.answer);
        const step7Duration = performance.now() - stepStartTime;
        logger.info({
          component: 'LLM_PIPELINE',
          step: '7_write_message',
          chatId: req.params.chatId,
          durationMs: Math.round(step7Duration),
        }, `[LLM PIPELINE] Step 7: Write message - ${Math.round(step7Duration)}ms`);
        
        const totalDuration = performance.now() - pipelineStartTime;
        logger.info({
          component: 'LLM_PIPELINE',
          step: 'total',
          chatId: req.params.chatId,
          durationMs: Math.round(totalDuration),
        }, `[LLM PIPELINE] TOTAL: ${Math.round(totalDuration)}ms`);
        sendSseEvent(res, 'done', { assistantMessageId: assistantMessage.id, userMessageId: userMessageRecord?.id ?? null, usage: { llmTokens: llmUsageMeasurement?.quantityRaw ?? tokensTotal, llmUnits: llmUsageMeasurement?.quantity ?? null, llmUnit: llmUsageMeasurement?.unit ?? null, llmCredits: llmPrice ? centsToCredits(llmPrice.creditsChargedCents) : null } });
        await safeLogStep('STREAM_TO_CLIENT_FINISH', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { reason: 'completed' } });
        await safeFinishExecution(SKILL_EXECUTION_STATUS.SUCCESS);
        res.end();
      } catch (error) {
        const info = describeErrorForLog(error);
        const llmErrorDurationMs = performance.now() - llmStartTime;
        
        // Log LLM error (streaming)
        logger.error({
          component: 'LLM_PIPELINE',
          step: 'error',
          chatId: req.params.chatId,
          skillId: context.skill?.id ?? null,
          workspaceId,
          providerId: context.provider.id,
          model: resolvedModelKey,
          isStreaming: true,
          errorCode: info.code,
          errorMessage: info.message,
          durationMs: Math.round(llmErrorDurationMs),
          llmCallCompleted,
        }, `[LLM PIPELINE] ERROR: ${info.message} in ${Math.round(llmErrorDurationMs)}ms (streaming)`);
        
        if (!llmCallCompleted) await safeLogStep('CALL_LLM', SKILL_EXECUTION_STEP_STATUS.ERROR, { errorCode: info.code, errorMessage: info.message, diagnosticInfo: info.diagnosticInfo });
        if (forwarder) { try { await forwarder; } catch { /* ignore */ } }
        sendSseEvent(res, 'error', { message: error instanceof Error ? error.message : 'Ошибка генерации ответа' });
        await safeLogStep('STREAM_TO_CLIENT_FINISH', SKILL_EXECUTION_STEP_STATUS.ERROR, { errorCode: info.code, errorMessage: info.message, output: { reason: 'error' } });
        await safeFinishExecution(SKILL_EXECUTION_STATUS.ERROR);
        res.end();
      }
      return;
    }

    // Sync completion
    let completion;
    let llmUsageMeasurement: ReturnType<typeof measureTokensForModel> | null = null;
    let llmPrice: ReturnType<typeof calculatePriceSnapshot> = null;
    try {
      stepStartTime = performance.now();
      completion = await executeLlmCompletion(context.provider, accessToken, requestBody);
      llmCallCompleted = true;
      const step5Duration = performance.now() - stepStartTime;
      const llmDurationMs = performance.now() - llmStartTime;
      logger.info({
        component: 'LLM_PIPELINE',
        step: '5_llm_call',
        chatId: req.params.chatId,
        durationMs: Math.round(step5Duration),
      }, `[LLM PIPELINE] Step 5: LLM call - ${Math.round(step5Duration)}ms`);
      const tokensTotal = completion.usageTokens ?? Math.ceil(completion.answer.length / 4);
      llmUsageMeasurement = measureTokensForModel(tokensTotal, { consumptionUnit: context.modelInfo?.consumptionUnit ?? 'TOKENS_1K', modelKey: context.modelInfo?.modelKey ?? resolvedModelKey });
      llmPrice = calculatePriceSnapshot(context.modelInfo as ModelInfoForUsage, llmUsageMeasurement ?? null);
      const usageOperationId = operationId ?? executionId ?? randomUUID();

      // Log LLM response (sync)
      logger.info({
        component: 'LLM_PIPELINE',
        step: 'response',
        chatId: req.params.chatId,
        skillId: context.skill?.id ?? null,
        workspaceId,
        providerId: context.provider.id,
        model: resolvedModelKey,
        isStreaming: false,
        answerLength: completion.answer.length,
        usageTokens: tokensTotal,
        durationMs: Math.round(llmDurationMs),
        answerPreview: completion.answer.substring(0, 200),
      }, `[LLM PIPELINE] RESPONSE: ${completion.answer.length} chars, ${tokensTotal} tokens in ${Math.round(llmDurationMs)}ms (sync)`);

      await safeLogStep('CALL_LLM', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { usageTokens: tokensTotal, usageUnits: llmUsageMeasurement?.quantity ?? null, usageUnit: llmUsageMeasurement?.unit ?? null, creditsCharged: llmPrice ? centsToCredits(llmPrice.creditsChargedCents) : null, responsePreview: completion.answer.slice(0, 160) } });

      stepStartTime = performance.now();
      if (tokensTotal) {
        try {
          await recordLlmUsageEvent({ workspaceId, executionId: usageOperationId, provider: context.provider.id ?? context.provider.providerType ?? 'unknown', model: resolvedModelKey ?? 'unknown', modelId: resolvedModelId ?? null, tokensTotal: llmUsageMeasurement?.quantityRaw ?? tokensTotal, appliedCreditsPerUnit: llmPrice?.appliedCreditsPerUnitCents ?? null, creditsCharged: llmPrice?.creditsChargedCents ?? null, occurredAt: new Date() });
          if (workspaceId && llmUsageMeasurement && llmPrice) {
            await applyIdempotentUsageCharge({ workspaceId, operationId: usageOperationId, model: { id: resolvedModelId ?? null, key: resolvedModelKey ?? null, name: context.modelInfo?.displayName ?? null, type: context.modelInfo?.modelType ?? 'LLM', consumptionUnit: llmUsageMeasurement.unit }, measurement: llmUsageMeasurement, price: llmPrice, metadata: { source: 'chat_llm', chatId: req.params.chatId, executionId } });
          }
        } catch (usageError) {
          logger.error({ err: usageError }, `[usage] Failed to record LLM tokens for operation ${usageOperationId}`);
        }
      }
      const step6Duration = performance.now() - stepStartTime;
      logger.info({
        component: 'LLM_PIPELINE',
        step: '6_record_usage',
        chatId: req.params.chatId,
        durationMs: Math.round(step6Duration),
      }, `[LLM PIPELINE] Step 6: Record usage - ${Math.round(step6Duration)}ms`);
    } catch (error) {
      const info = describeErrorForLog(error);
      const llmErrorDurationMs = performance.now() - llmStartTime;
      
      // Log LLM error (sync)
      logger.error({
        component: 'LLM_PIPELINE',
        step: 'error',
        chatId: req.params.chatId,
        skillId: context.skill?.id ?? null,
        workspaceId,
        providerId: context.provider.id,
        model: resolvedModelKey,
        isStreaming: false,
        errorCode: info.code,
        errorMessage: info.message,
        durationMs: Math.round(llmErrorDurationMs),
        llmCallCompleted,
      }, `[LLM PIPELINE] ERROR: ${info.message} in ${Math.round(llmErrorDurationMs)}ms (sync)`);
      
      await safeLogStep('CALL_LLM', SKILL_EXECUTION_STEP_STATUS.ERROR, { errorCode: info.code, errorMessage: info.message, diagnosticInfo: info.diagnosticInfo });
      throw error;
    }

    stepStartTime = performance.now();
    const assistantMessage = await writeAssistantMessage(req.params.chatId, workspaceId, user.id, completion.answer);
    const step7Duration = performance.now() - stepStartTime;
    logger.info({
      component: 'LLM_PIPELINE',
      step: '7_write_message',
      chatId: req.params.chatId,
      durationMs: Math.round(step7Duration),
    }, `[LLM PIPELINE] Step 7: Write message - ${Math.round(step7Duration)}ms`);
    
    const totalDuration = performance.now() - pipelineStartTime;
    logger.info({
      component: 'LLM_PIPELINE',
      step: 'total',
      chatId: req.params.chatId,
      durationMs: Math.round(totalDuration),
    }, `[LLM PIPELINE] TOTAL: ${Math.round(totalDuration)}ms`);
    
    logger.info(`[chat] user=${user.id} workspace=${workspaceId} chat=${req.params.chatId} sync response finished`);
    await safeFinishExecution(SKILL_EXECUTION_STATUS.SUCCESS);
    res.json({ message: assistantMessage, userMessage: userMessageRecord, usage: { llmTokens: completion.usageTokens ?? Math.ceil(completion.answer.length / 4), llmUnits: llmUsageMeasurement?.quantity ?? null, llmUnit: llmUsageMeasurement?.unit ?? null, llmCredits: llmPrice ? centsToCredits(llmPrice.creditsChargedCents) : null } });
  } catch (error) {
    if (streamingResponseStarted) {
      sendSseEvent(res, 'error', { message: error instanceof Error ? error.message : 'Ошибка' });
      await safeFinishExecution(SKILL_EXECUTION_STATUS.ERROR);
      res.end();
      return;
    }
    logger.error({ err: error }, `[chat] user=${user?.id ?? 'unknown'} workspace=${resolvedWorkspaceId ?? 'unknown'} chat=${req.params.chatId} failed`);
    await safeFinishExecution(SKILL_EXECUTION_STATUS.ERROR);
    next(error);
  }
}));

// ============================================================================
// File Upload for No-Code Mode
// ============================================================================

// ============================================================================
// File Attachments
// ============================================================================

const chatAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB (from chat-file-utils)
    files: 1,
  },
});

/**
 * POST /sessions/:chatId/messages/attachment
 * Upload file attachment to chat (documents or audio)
 * 
 * Universal endpoint for attaching files to chat messages.
 * - Documents (PDF, DOCX, DOC, TXT): text extraction + indexing
 * - Audio (MP3, WAV, OGG): stored with metadata (transcription handled separately)
 */
chatRouter.post('/sessions/:chatId/messages/attachment', chatAttachmentUpload.single('file'), asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { chatId } = req.params;
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({ message: 'Файл не предоставлен' });
  }

  // Dynamic imports
  const { 
    getFileCategory, 
    validateChatFile, 
    MAX_EXTRACTED_TEXT_CHARS 
  } = await import('../chat-file-utils');
  const { extractTextFromBuffer, TextExtractionError } = await import('../text-extraction');
  const { uploadWorkspaceFile } = await import('../workspace-storage-service');

  // 1. Get chat and verify access
  const chat = await storage.getChatSessionById(chatId);
  if (!chat) {
    return res.status(404).json({ message: 'Чат не найден' });
  }

  const workspaceId = chat.workspaceId;
  const membership = await storage.getWorkspaceMember(user.id, workspaceId);
  if (!membership) {
    return res.status(403).json({ message: 'Нет доступа к рабочему пространству' });
  }

  // 2. Get skill
  const skill = chat.skillId ? await getSkillById(workspaceId, chat.skillId) : null;
  if (!skill) {
    return res.status(400).json({ message: 'Навык не найден' });
  }

  // 3. Validate file
  const filename = file.originalname || 'file';
  const mimeType = file.mimetype || null;
  const validation = validateChatFile({
    size: file.size,
    mimeType,
    filename,
  });

  if (!validation.valid) {
    return res.status(400).json({ message: validation.error });
  }

  const category = validation.category!;

  // 4. Route by file type
  if (category === 'audio') {
    // Audio files: store with metadata (transcription handled separately)
    try {
      const storageKey = `chat-attachments/${chat.id}/${randomUUID()}-${filename}`;
      
      await uploadWorkspaceFile(workspaceId, storageKey, file.buffer, mimeType || 'audio/mpeg', file.size);

      const attachment = await storage.createChatAttachment({
        workspaceId,
        chatId: chat.id,
        uploaderUserId: user.id,
        filename,
        mimeType,
        sizeBytes: file.size,
        storageKey,
      });

      const message = await storage.createChatMessage({
        chatId: chat.id,
        role: 'user',
        messageType: 'file',
        content: `[Загружено аудио: ${filename}]`,
        metadata: {
          type: 'audio',
          fileName: filename,
          mimeType,
          sizeBytes: file.size,
          attachmentId: attachment.id,
          transcriptionStatus: 'pending',
        },
      });

      logger.info({ chatId: chat.id, attachmentId: attachment.id, category: 'audio' }, 'Audio file uploaded');

      return res.status(201).json({
        message: mapMessage(message),
        attachment: {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        },
      });
    } catch (error) {
      logger.error({ err: error, chatId: chat.id }, 'Failed to upload audio file');
      return res.status(500).json({ message: 'Не удалось загрузить аудио файл' });
    }
  }

  if (category === 'document') {
    // Document files: extract text + create ingestion job
    try {
      // 1. Extract text from file
      let extractedText: string;
      let extractionError: string | null = null;
      
      try {
        const result = await extractTextFromBuffer({
          buffer: file.buffer,
          filename,
          mimeType,
        });
        extractedText = result.text;
      } catch (error) {
        if (error instanceof TextExtractionError) {
          extractionError = error.message;
          extractedText = '';
        } else {
          throw error;
        }
      }

      // 2. Truncate text to limit
      const truncatedText = extractedText.slice(0, MAX_EXTRACTED_TEXT_CHARS);
      const isTruncated = extractedText.length > MAX_EXTRACTED_TEXT_CHARS;

      // 3. Save file to storage
      const storageKey = `chat-attachments/${chat.id}/${randomUUID()}-${filename}`;
      await uploadWorkspaceFile(workspaceId, storageKey, file.buffer, mimeType || 'application/octet-stream', file.size);

      // 4. Create attachment record
      const attachment = await storage.createChatAttachment({
        workspaceId,
        chatId: chat.id,
        uploaderUserId: user.id,
        filename,
        mimeType,
        sizeBytes: file.size,
        storageKey,
      });

      // 5. Create message with extracted text
      const message = await storage.createChatMessage({
        chatId: chat.id,
        role: 'user',
        messageType: 'file',
        content: `[Загружен документ: ${filename}]`,
        metadata: {
          type: 'document',
          fileName: filename,
          mimeType,
          sizeBytes: file.size,
          attachmentId: attachment.id,
          extractedText: truncatedText,
          extractedTextLength: extractedText.length,
          isTruncated,
          extractionError,
          isIndexed: false, // Will be set to true after ingestion
        },
      });

      // 6. Create ingestion job for background indexing (if text extracted)
      if (extractedText.length > 0) {
        await storage.createChatFileIngestionJob({
          workspaceId,
          skillId: skill.id,
          chatId: chat.id,
          attachmentId: attachment.id,
          fileVersion: 1,
        });
      }

      logger.info({ 
        chatId: chat.id, 
        attachmentId: attachment.id, 
        category: 'document',
        textLength: extractedText.length,
        hasError: !!extractionError,
      }, 'Document file uploaded');

      return res.status(201).json({
        message: mapMessage(message),
        attachment: {
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        },
        extraction: {
          success: !extractionError,
          textLength: extractedText.length,
          isTruncated,
          error: extractionError,
        },
      });
    } catch (error) {
      logger.error({ err: error, chatId: chat.id }, 'Failed to upload document file');
      return res.status(500).json({ message: 'Не удалось обработать документ' });
    }
  }

  return res.status(400).json({ message: 'Неподдерживаемый тип файла' });
}));

const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024 }, // 512MB
});

/**
 * POST /sessions/:chatId/messages/file
 * Upload file to chat for no-code processing
 * 
 * This endpoint is used when skill is in no-code mode.
 * File is uploaded to the configured file storage provider and
 * an event is sent to the no-code endpoint.
 */
chatRouter.post('/sessions/:chatId/messages/file', fileUpload.single('file'), asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const chatId = req.params.chatId;
  
  // Try to get workspaceId from request, but if not available, get it from chat
  let workspaceId: string;
  try {
    workspaceId = getRequestWorkspace(req).id;
  } catch {
    // If workspaceId not in request, get it from chat
    const chatRecord = await storage.getChatSessionById(chatId);
    if (!chatRecord || chatRecord.userId !== user.id) {
      return res.status(404).json({ message: 'Чат не найден или недоступен' });
    }
    workspaceId = chatRecord.workspaceId;
  }

  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'Файл не предоставлен' });
  }

  // Get chat and verify access
  const chat = await getChatById(chatId, workspaceId, user.id);
  if (!chat.skillId) {
    return res.status(400).json({ message: 'Чат не привязан к навыку' });
  }

  // Get skill and verify no-code mode
  const skill = await getSkillById(workspaceId, chat.skillId);
  if (!skill) {
    return res.status(404).json({ message: 'Навык не найден' });
  }

  const isNoCodeMode = skill.executionMode === 'no_code';
  if (!isNoCodeMode) {
    return res.status(400).json({ 
      message: 'Навык не в no-code режиме. Используйте стандартную транскрибацию.',
      code: 'NOT_NO_CODE_MODE',
    });
  }

  // Get file storage provider
  const providerId = skill.noCodeConnection?.fileStorageProviderId ?? null;
  if (!providerId) {
    return res.status(400).json({ 
      message: 'File storage provider не настроен для этого навыка',
      code: 'NO_FILE_STORAGE_PROVIDER',
    });
  }

  const fileName = file.originalname || 'audio.wav';
  const mimeType = file.mimetype || 'application/octet-stream';
  const sizeBytes = file.size;

  logger.info({
    chatId,
    skillId: skill.id,
    fileName,
    mimeType,
    sizeBytes,
    providerId,
  }, 'Uploading file to provider for no-code skill');

  try {
    // Get bearer token for the skill
    const bearerToken = await getSkillBearerToken({ workspaceId, skillId: skill.id });

    // Create file record
    const fileRecord = await storage.createFile({
      workspaceId,
      skillId: skill.id,
      chatId,
      userId: user.id,
      name: fileName,
      mimeType,
      sizeBytes: BigInt(sizeBytes),
      kind: 'audio',
      status: 'uploading',
      storageType: 'external_provider',
      providerId,
    });

    // Create user message with file
    const messageContent = fileName;
    const messageMetadata = {
      type: 'audio' as const,
      fileName,
      mimeType,
      sizeBytes,
      fileId: fileRecord.id,
    };

    const userMessage = await storage.createChatMessage({
      chatId,
      role: 'user',
      content: messageContent,
      messageType: 'file',
      metadata: messageMetadata,
    });

    // Schedule chat title generation from audio file name
    scheduleChatTitleGenerationIfNeeded({
      chatId,
      workspaceId,
      userId: user.id,
      messageText: fileName,
      messageMetadata,
      chatTitle: chat.title,
    });

    // Upload file to provider
    const uploadedFile = await uploadFileToProvider({
      fileId: fileRecord.id,
      providerId,
      bearerToken,
      data: file.buffer,
      mimeType,
      fileName,
      sizeBytes,
      context: {
        workspaceId,
        workspaceName: null,
        skillId: skill.id,
        skillName: skill.name ?? null,
        chatId,
        userId: user.id,
        messageId: userMessage.id,
        fileNameOriginal: fileName,
      },
      skillContext: {
        executionMode: skill.executionMode,
        noCodeEndpointUrl: skill.noCodeConnection?.endpointUrl ?? null,
        noCodeAuthType: skill.noCodeConnection?.authType ?? null,
        noCodeBearerToken: bearerToken,
      },
    });

    // NOTE: Event is NOT sent here - it will be sent when user explicitly sends the message
    // via POST /sessions/:chatId/messages/:messageId/send

    logger.info({
      chatId,
      skillId: skill.id,
      fileId: uploadedFile.id,
      messageId: userMessage.id,
    }, 'File uploaded for no-code skill (event NOT sent yet, waiting for explicit send)');

    res.json({
      status: 'uploaded',
      message: mapMessage(userMessage),
      fileId: uploadedFile.id,
    });
  } catch (error) {
    logger.error({ err: error, chatId, skillId: skill.id }, 'Failed to upload file for no-code skill');
    
    if (error instanceof FileUploadToProviderError) {
      return res.status(error.status).json({
        message: error.message,
        code: 'FILE_UPLOAD_ERROR',
        details: error.details,
      });
    }
    throw error;
  }
}));

/**
 * POST /sessions/:chatId/messages/:messageId/send
 * Send event for already uploaded file message (no-code mode)
 * 
 * Used when audio was uploaded in no-code mode and client needs to trigger event delivery.
 */
chatRouter.post('/sessions/:chatId/messages/:messageId/send', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { chatId, messageId } = req.params;
  
  logger.info({
    chatId,
    messageId,
    userId: user.id,
  }, 'Received request to send file event for no-code skill');
  
  // Try to get workspaceId from request, but if not available, get it from chat
  let workspaceId: string;
  try {
    workspaceId = getRequestWorkspace(req).id;
  } catch {
    // If workspaceId not in request, get it from chat
    const chatRecord = await storage.getChatSessionById(chatId);
    if (!chatRecord || chatRecord.userId !== user.id) {
      return res.status(404).json({ message: 'Чат не найден или недоступен' });
    }
    workspaceId = chatRecord.workspaceId;
  }

  // Get chat and verify access
  const chat = await getChatById(chatId, workspaceId, user.id);
  if (!chat.skillId) {
    return res.status(400).json({ message: 'Чат не привязан к навыку' });
  }

  // Get message
  const messages = await getChatMessages(chatId, workspaceId, user.id);
  const message = messages.find(m => m.id === messageId);
  if (!message) {
    return res.status(404).json({ message: 'Сообщение не найдено' });
  }

  // Get skill
  const skill = await getSkillById(workspaceId, chat.skillId);
  if (!skill) {
    return res.status(404).json({ message: 'Навык не найден' });
  }

  const isNoCodeMode = skill.executionMode === 'no_code';
  if (!isNoCodeMode) {
    return res.status(400).json({ message: 'Навык не в no-code режиме' });
  }

  // Build and send file.uploaded event
  const metadata = message.metadata as Record<string, unknown> | null;
  const fileId = metadata?.fileId as string | undefined;
  
  logger.info({
    chatId,
    messageId,
    fileId,
    metadataKeys: metadata ? Object.keys(metadata) : null,
  }, 'Processing file event send request');
  
  if (fileId) {
    const fileRecord = await storage.getFile(fileId, workspaceId);
    if (fileRecord) {
      const bearerToken = await getSkillBearerToken({ workspaceId, skillId: skill.id });
      const targetUrl = skill.noCodeConnection?.fileEventsUrl ?? skill.noCodeConnection?.endpointUrl ?? null;
      
      logger.info({
        chatId,
        messageId,
        fileId: fileRecord.id,
        skillId: skill.id,
        targetUrl,
        noCodeFileEventsUrl: skill.noCodeConnection?.fileEventsUrl ?? null,
        noCodeEndpointUrl: skill.noCodeConnection?.endpointUrl ?? null,
      }, 'Enqueuing file event for no-code skill');
      
      await enqueueFileEventForSkill({
        file: fileRecord,
        action: 'file_uploaded',
        skill: {
          executionMode: skill.executionMode,
          noCodeFileEventsUrl: skill.noCodeConnection?.fileEventsUrl ?? null,
          noCodeEndpointUrl: skill.noCodeConnection?.endpointUrl ?? null,
          noCodeAuthType: skill.noCodeConnection?.authType ?? null,
          noCodeBearerToken: bearerToken,
        },
      });
      
      logger.info({
        chatId,
        messageId,
        fileId: fileRecord.id,
        skillId: skill.id,
        targetUrl,
      }, 'File event enqueued for no-code skill');
    } else {
      logger.warn({
        chatId,
        messageId,
        fileId,
      }, 'File record not found for fileId');
    }
  } else {
    logger.warn({
      chatId,
      messageId,
      metadata,
    }, 'No fileId found in message metadata');
  }

  res.json({ status: 'ok' });
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
  if (err instanceof FileUploadToProviderError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }
  next(err);
});

export default chatRouter;
