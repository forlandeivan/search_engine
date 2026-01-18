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
import { randomUUID } from 'crypto';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { llmChatLimiter } from '../middleware/rate-limit';
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
} from '../chat-service';
import { scheduleChatTitleGenerationIfNeeded } from '../chat-title-jobs';
import { getSkillById, createUnicaChatSkillForWorkspace, UNICA_CHAT_SYSTEM_KEY } from '../skills';
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

// ============================================================================
// Validation Schemas
// ============================================================================

const createChatMessageSchema = z.object({
  content: z.string().trim().min(1, 'Сообщение не может быть пустым'),
  workspaceId: z.string().optional(),
  stream: z.boolean().optional(),
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
      logger.error({ err: logError }, `[chat] skill execution log start failed for chat=${req.params.chatId}`);
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
      logger.error({ err: logError }, `[chat] skill execution finish failed chat=${req.params.chatId}`);
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

    const context = await buildChatLlmContext(req.params.chatId, workspaceId, user.id, { executionId });

    // RAG skill handling
    if (context.skill.isRagSkill) {
      const ragStepInput = { chatId: req.params.chatId, workspaceId, skillId: context.skill.id, knowledgeBaseId: context.skillConfig.knowledgeBaseIds?.[0] ?? null, collections: context.skillConfig.ragConfig?.collectionIds ?? [] };
      await safeLogStep('CALL_RAG_PIPELINE', SKILL_EXECUTION_STEP_STATUS.RUNNING, { input: ragStepInput });

      let ragResult: KnowledgeBaseRagPipelineResponse | null = null;
      try {
        ragResult = await callRagForSkillChat({ req, skill: context.skillConfig, workspaceId, userMessage: payload.content, runPipeline: runKnowledgeBaseRagPipeline, stream: null }) as KnowledgeBaseRagPipelineResponse;
        await safeLogStep('CALL_RAG_PIPELINE', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { answerPreview: ragResult.response.answer.slice(0, 160), knowledgeBaseId: ragResult.response.knowledgeBaseId, usage: ragResult.response.usage ?? null } });
      } catch (ragError) {
        logger.error({ err: ragError }, `[CHAT RAG] ERROR in callRagForSkillChat`);
        const info = describeErrorForLog(ragError);
        await safeLogStep('CALL_RAG_PIPELINE', SKILL_EXECUTION_STEP_STATUS.ERROR, { errorCode: info.code, errorMessage: info.message, diagnosticInfo: info.diagnosticInfo, input: ragStepInput });
        if (ragError instanceof SkillRagConfigurationError) throw new ChatServiceError(ragError.message, 400);
        throw ragError;
      }

      if (!ragResult) throw new Error('RAG pipeline returned empty result');

      const citations = Array.isArray(ragResult.response.citations) ? ragResult.response.citations : [];
      const metadata = citations.length > 0 ? { citations } : undefined;

      if (wantsStream) {
        streamingResponseStarted = true;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const answer = ragResult.response.answer;
        const chunkSize = 5;
        for (let i = 0; i < answer.length; i += chunkSize) {
          const chunk = answer.substring(i, i + chunkSize);
          if (chunk.length > 0) {
            sendSseEvent(res, 'delta', { text: chunk });
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }

        const assistantMessage = await writeAssistantMessage(req.params.chatId, workspaceId, user.id, answer, metadata);
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

    // Standard LLM completion
    const requestBody = buildChatCompletionRequestBody(context, { stream: wantsStream });
    const accessToken = await fetchAccessToken(context.provider);
    const totalPromptChars = Array.isArray(requestBody[context.requestConfig.messagesField]) ? JSON.stringify(requestBody[context.requestConfig.messagesField]).length : 0;
    const resolvedModelKey = context.model ?? context.provider.model ?? null;
    const resolvedModelId = context.modelInfo?.id ?? null;
    const llmCallInput = { providerId: context.provider.id, endpoint: context.provider.completionUrl ?? null, model: resolvedModelKey, modelId: resolvedModelId, stream: wantsStream, temperature: context.requestConfig.temperature ?? null, messageCount: context.messages.length, promptLength: totalPromptChars };

    const llmGuardDecision = await workspaceOperationGuard.check(buildLlmOperationContext({ workspaceId, providerId: context.provider.id ?? context.provider.providerType ?? 'unknown', model: resolvedModelKey, modelId: resolvedModelId, modelKey: context.modelInfo?.modelKey ?? resolvedModelKey, scenario: context.skillConfig ? 'skill' : 'chat', tokens: context.requestConfig.maxTokens }));
    if (!llmGuardDecision.allowed) {
      throw new OperationBlockedError(mapDecisionToPayload(llmGuardDecision, { workspaceId, operationType: 'LLM_REQUEST', meta: { llm: { provider: context.provider.id, model: resolvedModelKey, modelId: resolvedModelId, modelKey: context.modelInfo?.modelKey ?? resolvedModelKey } } }));
    }

    // Preflight credits check
    const promptTokensEstimate = Math.ceil(totalPromptChars / 4);
    const maxOutputTokens = context.requestConfig.maxTokens ?? null;
    try {
      await ensureCreditsForLlmPreflight(workspaceId, context.modelInfo as ModelInfoForUsage, promptTokensEstimate, maxOutputTokens);
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

      logger.info(`[chat] user=${user.id} workspace=${workspaceId} chat=${req.params.chatId} streaming response`);
      await safeLogStep('STREAM_TO_CLIENT_START', SKILL_EXECUTION_STEP_STATUS.RUNNING, { input: { chatId: req.params.chatId, workspaceId, stream: true } });

      const completionPromise = executeLlmCompletion(context.provider, accessToken, requestBody, { stream: true });
      const streamIterator = completionPromise.streamIterator;
      const forwarder = streamIterator && forwardLlmStreamEvents(streamIterator, (eventName: string, payload?: unknown) => sendSseEvent(res, eventName, payload));

      try {
        const completion = await completionPromise;
        llmCallCompleted = true;
        const tokensTotal = completion.usageTokens ?? Math.ceil(completion.answer.length / 4);
        const llmUsageMeasurement = measureTokensForModel(tokensTotal, { consumptionUnit: context.modelInfo?.consumptionUnit ?? 'TOKENS_1K', modelKey: context.modelInfo?.modelKey ?? resolvedModelKey });
        const llmPrice = calculatePriceSnapshot(context.modelInfo as ModelInfoForUsage, llmUsageMeasurement);
        const usageOperationId = operationId ?? executionId ?? randomUUID();

        await safeLogStep('CALL_LLM', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { usageTokens: tokensTotal, usageUnits: llmUsageMeasurement?.quantity ?? null, usageUnit: llmUsageMeasurement?.unit ?? null, creditsCharged: llmPrice ? centsToCredits(llmPrice.creditsChargedCents) : null, responsePreview: completion.answer.slice(0, 160) } });

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

        if (forwarder) await forwarder;
        const assistantMessage = await writeAssistantMessage(req.params.chatId, workspaceId, user.id, completion.answer);
        logger.info(`[chat] user=${user.id} workspace=${workspaceId} chat=${req.params.chatId} streaming finished`);
        sendSseEvent(res, 'done', { assistantMessageId: assistantMessage.id, userMessageId: userMessageRecord?.id ?? null, usage: { llmTokens: llmUsageMeasurement?.quantityRaw ?? tokensTotal, llmUnits: llmUsageMeasurement?.quantity ?? null, llmUnit: llmUsageMeasurement?.unit ?? null, llmCredits: llmPrice ? centsToCredits(llmPrice.creditsChargedCents) : null } });
        await safeLogStep('STREAM_TO_CLIENT_FINISH', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { reason: 'completed' } });
        await safeFinishExecution(SKILL_EXECUTION_STATUS.SUCCESS);
        res.end();
      } catch (error) {
        const info = describeErrorForLog(error);
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
      completion = await executeLlmCompletion(context.provider, accessToken, requestBody);
      llmCallCompleted = true;
      const tokensTotal = completion.usageTokens ?? Math.ceil(completion.answer.length / 4);
      llmUsageMeasurement = measureTokensForModel(tokensTotal, { consumptionUnit: context.modelInfo?.consumptionUnit ?? 'TOKENS_1K', modelKey: context.modelInfo?.modelKey ?? resolvedModelKey });
      llmPrice = calculatePriceSnapshot(context.modelInfo as ModelInfoForUsage, llmUsageMeasurement ?? null);
      const usageOperationId = operationId ?? executionId ?? randomUUID();

      await safeLogStep('CALL_LLM', SKILL_EXECUTION_STEP_STATUS.SUCCESS, { output: { usageTokens: tokensTotal, usageUnits: llmUsageMeasurement?.quantity ?? null, usageUnit: llmUsageMeasurement?.unit ?? null, creditsCharged: llmPrice ? centsToCredits(llmPrice.creditsChargedCents) : null, responsePreview: completion.answer.slice(0, 160) } });

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
    } catch (error) {
      const info = describeErrorForLog(error);
      await safeLogStep('CALL_LLM', SKILL_EXECUTION_STEP_STATUS.ERROR, { errorCode: info.code, errorMessage: info.message, diagnosticInfo: info.diagnosticInfo });
      throw error;
    }

    const assistantMessage = await writeAssistantMessage(req.params.chatId, workspaceId, user.id, completion.answer);
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
