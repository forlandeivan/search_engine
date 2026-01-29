import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { registerRouteModules } from "./routes/index";
import fetch, {
  Headers,
  type HeadersInit,
  type Response as FetchResponse,
  type RequestInit as FetchRequestInit,
} from "node-fetch";
import { createHash, randomUUID, randomBytes } from "crypto";
import { extname } from "path";
import { performance } from "perf_hooks";
import { storage } from "./storage";
import {
  uploadWorkspaceFile,
  deleteObject as deleteWorkspaceObject,
  getWorkspaceFile,
  generateWorkspaceFileDownloadUrl,
} from "./workspace-storage-service";
import { uploadFileToProvider, FileUploadToProviderError } from "./file-storage-provider-upload-service";
import { cleanupFailedSkillFileUpload, type UploadedSkillFileDescriptor } from "./skill-file-upload-utils";
import type { KnowledgeChunkSearchEntry, WorkspaceMemberWithUser } from "./storage";
import { resolveStorageTarget, ExternalStorageNotImplementedError } from "./storage-routing";
import {
  startKnowledgeBaseCrawl,
  getKnowledgeBaseCrawlJob,
  getKnowledgeBaseCrawlJobStateForBase,
  subscribeKnowledgeBaseCrawlJob,
  pauseKnowledgeBaseCrawl,
  resumeKnowledgeBaseCrawl,
  cancelKnowledgeBaseCrawl,
  retryKnowledgeBaseCrawl,
  crawlKnowledgeDocumentPage,
} from "./kb-crawler";
import { z } from "zod";
import { invalidateCorsCache } from "./cors-cache";
import { getQdrantClient, QdrantConfigurationError } from "./qdrant";
import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  buildLlmRequestBody,
  mergeLlmRequestConfig,
  mergeLlmResponseConfig,
  type LlmContextRecord,
  type RagResponseFormat,
} from "./search/utils";
import {
  listKnowledgeBases,
  getKnowledgeNodeDetail,
  deleteKnowledgeNode,
  updateKnowledgeNodeParent,
  KnowledgeBaseError,
  createKnowledgeBase,
  deleteKnowledgeBase,
  createKnowledgeFolder,
  createKnowledgeDocument,
  updateKnowledgeDocument,
  startKnowledgeBaseIndexing,
  resetKnowledgeBaseIndex,
  getKnowledgeBaseIndexingSummary,
  getKnowledgeBaseIndexingChanges,
} from "./knowledge-base";
import { knowledgeBaseIndexingActionsService } from "./knowledge-base-indexing-actions";
import {
  previewKnowledgeDocumentChunks,
  createKnowledgeDocumentChunkSet,
  updateKnowledgeDocumentChunkVectorRecords,
} from "./knowledge-chunks";
import {
  listSkills,
  createSkill,
  updateSkill,
  archiveSkill,
  getSkillById,
  getSkillBearerToken,
  SkillServiceError,
  UNICA_CHAT_SYSTEM_KEY,
  createUnicaChatSkillForWorkspace,
  generateNoCodeCallbackToken,
  verifyNoCodeCallbackToken,
} from "./skills";
import { asrExecutionLogService } from "./asr-execution-log-context";
import {
  listAdminSkillExecutions,
  getAdminSkillExecutionDetail,
} from "./admin-skill-executions";
import {
  adminAsrExecutionsQuerySchema,
  getAdminAsrExecutionDetail,
  listAdminAsrExecutions,
} from "./admin-asr-executions";
import { skillExecutionLogService } from "./skill-execution-log-context";
import { logger } from "./lib/logger";
import { emailConfirmationTokenService, EmailConfirmationTokenError } from "./email-confirmation-token-service";
import { registrationEmailService } from "./email-sender-registry";
import { SmtpSendError } from "./smtp-email-sender";
import { EmailValidationError } from "./email";
import { searchSkillFileVectors, deleteSkillFileVectors, VectorStoreError } from "./skill-file-vector-store";
import { systemNotificationLogService } from "./system-notification-log-service";
import {
  clearWorkspaceIcon,
  uploadWorkspaceIcon,
  workspaceIconUpload,
  WorkspaceIconError,
  getWorkspaceIcon,
} from "./workspace-icon-service";
import {
  SKILL_EXECUTION_STATUS,
  SKILL_EXECUTION_STEP_STATUS,
  type SkillExecutionStatus,
  type SkillExecutionStepStatus,
  type SkillExecutionStepType,
} from "./skill-execution-log";
import type { SkillExecutionStartContext } from "./skill-execution-log-service";
import {
  listUserChats,
  createChat,
  renameChat,
  deleteChat,
  getChatMessages,
  addUserMessage,
  buildChatLlmContext,
  buildChatCompletionRequestBody,
  addAssistantMessage,
  addNoCodeCallbackMessage,
  addNoCodeStreamChunk,
  upsertBotActionForChat,
  listBotActionsForChat,
  sanitizeDisplayText,
  setNoCodeAssistantAction,
  ChatServiceError,
  getChatById,
  ensureChatAndSkillAreActive,
  ensureSkillIsActive,
  mapMessage,
} from "./chat-service";
import { getCardById } from "./card-service";
import { offChatEvent, onChatEvent } from "./chat-events";
import {
  buildMessageCreatedEventPayload,
  buildFileUploadedEventPayload,
  getNoCodeConnectionInternal,
  scheduleNoCodeEventDelivery,
} from "./no-code-events";
import { enqueueFileEventForSkill } from "./no-code-file-events";
import { buildContextPack } from "./context-pack";
import {
  assistantActionTypes,
  botActionStatuses,
  chatCardTypes,
  transcriptStatuses,
  type AssistantActionType,
  type BotActionStatus,
  type TranscriptStatus,
  type ModelType,
  type ModelConsumptionUnit,
  type ModelCostLevel,
  type SkillFile,
  type FileStorageProvider,
} from "@shared/schema";
type NoCodeFlowFailureReason = "NOT_CONFIGURED" | "TIMEOUT" | "UPSTREAM_ERROR";
const NO_CODE_FLOW_MESSAGES: Record<NoCodeFlowFailureReason, string> = {
  NOT_CONFIGURED: "No-code сценарий недоступен. Проверьте подключение или попробуйте позже.",
  TIMEOUT: "No-code сценарий не ответил (таймаут). Попробуйте ещё раз.",
  UPSTREAM_ERROR: "No-code сценарий завершился с ошибкой. Попробуйте ещё раз.",
};

function createNoCodeFlowError(reason: NoCodeFlowFailureReason): ChatServiceError {
  const code = reason === "NOT_CONFIGURED" ? "NO_CODE_UNAVAILABLE" : "NO_CODE_FAILED";
  return new ChatServiceError(NO_CODE_FLOW_MESSAGES[reason], 503, code, { reason });
}

function buildChatServiceErrorPayload(error: ChatServiceError) {
  const payload: Record<string, unknown> = { message: error.message };
  if (error.code) {
    payload.errorCode = error.code;
  }
  if (error.details !== undefined) {
    payload.details = error.details;
  }
  return payload;
}

/**
 * Отправляет письмо подтверждения регистрации с повторными попытками.
 * Делает до 3 попыток с экспоненциальной задержкой (1s, 2s, 4s).
 * @returns true если письмо успешно отправлено, false если все попытки неудачны
 */
async function sendRegistrationEmailWithRetry(
  userEmail: string,
  userDisplayName: string | null,
  confirmationLink: string,
  userId: string,
  maxAttempts: number = 3,
): Promise<{ success: boolean; attempts: number; lastError?: Error }> {
  const delays = [1000, 2000, 4000]; // Экспоненциальная задержка: 1s, 2s, 4s
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await registrationEmailService.sendRegistrationConfirmationEmail(
        userEmail,
        userDisplayName,
        confirmationLink,
      );
      console.info("[auth/register] email sent successfully", {
        userId,
        email: userEmail,
        attempt,
        totalAttempts: maxAttempts,
      });
      return { success: true, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isLastAttempt = attempt === maxAttempts;
      const delay = delays[attempt - 1] ?? delays[delays.length - 1];

      console.error(`[auth/register] email send attempt ${attempt}/${maxAttempts} failed`, {
        userId,
        email: userEmail,
        attempt,
        totalAttempts: maxAttempts,
        willRetry: !isLastAttempt,
        nextDelayMs: isLastAttempt ? undefined : delay,
        errorType: lastError.constructor.name,
        errorMessage: lastError.message,
        errorName: lastError.name,
        stack: lastError.stack,
        isEmailValidationError: lastError instanceof EmailValidationError,
        isSmtpSendError: lastError instanceof SmtpSendError,
      });

      if (isLastAttempt) {
        console.error("[auth/register] email send failed after all retries - CRITICAL ERROR", {
          userId,
          email: userEmail,
          totalAttempts: maxAttempts,
          finalError: {
            type: lastError.constructor.name,
            message: lastError.message,
            name: lastError.name,
            stack: lastError.stack,
          },
        });
        break;
      }

      // Ждем перед следующей попыткой
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return { success: false, attempts: maxAttempts, lastError };
}

function formatZodValidationError(error: z.ZodError, endpoint?: string): {
  message: string;
  details: Array<{
    field: string;
    message: string;
    received: string;
    expected?: string;
    example?: string;
  }>;
  example?: Record<string, unknown>;
} {
  const details = error.issues.map((issue) => {
    const path = issue.path.join(".");
    const field = path || "body";
    let message = issue.message;
    let expected: string | undefined;
    let example: string | undefined;
    const receivedValue = "received" in issue ? String(issue.received) : "undefined";

    // Улучшаем сообщения для разных типов ошибок
    if (issue.code === "invalid_type") {
      if (receivedValue === "undefined") {
        message = `Поле "${field}" обязательно для заполнения`;
        if (field === "status") {
          expected = "Одно из: 'processing', 'done', 'error'";
          example = '"done"';
        } else if (field === "actionId") {
          message = `Поле "${field}" обязательно. Используйте actionId, полученный из ответа start`;
        } else if (field === "chatId") {
          message = `Поле "${field}" обязательно. Укажите идентификатор чата`;
        } else if (field === "actionType") {
          message = `Поле "${field}" обязательно. Укажите тип действия (например: 'transcribe_audio', 'summarize', 'generate_image', 'process_file')`;
          example = '"transcribe_audio"';
        }
      } else {
        message = `Поле "${field}" имеет неверный тип. Получено: ${receivedValue}, ожидается: ${issue.expected}`;
        expected = issue.expected;
      }
    } else if (issue.code === "invalid_value") {
      message = `Поле "${field}" содержит недопустимое значение. Получено: "${receivedValue}"`;
      const values = "values" in issue ? issue.values : [];
      if (Array.isArray(values) && values.length > 0) {
        expected = `Одно из: ${values.map((opt: unknown) => `'${opt}'`).join(", ")}`;
        example = `"${values[0]}"`;
      }
    } else if (issue.code === "too_small") {
      message = `Поле "${field}" слишком короткое. Минимальная длина: ${(issue as { minimum?: unknown }).minimum}`;
    } else if (issue.code === "too_big") {
      message = `Поле "${field}" слишком длинное. Максимальная длина: ${(issue as { maximum?: unknown }).maximum}`;
    }

    return {
      field,
      message,
      received: receivedValue,
      ...(expected ? { expected } : {}),
      ...(example ? { example } : {}),
    };
  });

  // Формируем пример правильного запроса
  let exampleRequest: Record<string, unknown> | undefined;
  if (endpoint?.includes("actions/start")) {
    exampleRequest = {
      workspaceId: "5aededcf-84fc-4b39-ba3d-28a338ba5107",
      chatId: "867001b6-6a30-4f63-87d5-4c25956b16a3",
      actionType: "transcribe_audio",
      displayText: "Готовим стенограмму...",
      payload: {
        transcriptId: "",
        fileName: "audio.mp3",
      },
    };
  } else if (endpoint?.includes("actions/update")) {
    exampleRequest = {
      workspaceId: "5aededcf-84fc-4b39-ba3d-28a338ba5107",
      chatId: "867001b6-6a30-4f63-87d5-4c25956b16a3",
      actionId: "5501885d-19be-4249-b5f4-636a30a9c6c3",
      actionType: "transcribe_audio",
      status: "done",
      displayText: "Стенограмма готова",
      payload: {
        transcriptId: "1291febd-9f69-4c32-93e7-f41ca92da867",
      },
    };
  }

  const mainMessage =
    details.length === 1
      ? details[0].message
      : `Обнаружено ${details.length} ошибок в данных запроса`;

  return {
    message: mainMessage,
    details,
    ...(exampleRequest ? { example: exampleRequest } : {}),
  };
}
import { callRagForSkillChat, SkillRagConfigurationError } from "./chat-rag";
import { setRagPipelineImpl } from "./lib/rag-pipeline";
import {
  getOrCreateCache,
  addRetrievalToCache,
  findSimilarCachedRetrieval,
  getAccumulatedChunks,
  type RagChunk,
} from "./rag-context-cache";
import {
  fetchLlmCompletion,
  executeLlmCompletion,
  checkLlmProviderHealth,
  type LlmCompletionResult,
  type LlmStreamEvent,
} from "./llm-client";
import {
  recordLlmUsageEvent,
  getWorkspaceLlmUsageSummary,
  recordEmbeddingUsageEvent,
  getWorkspaceEmbeddingUsageSummary,
  getWorkspaceAsrUsageSummary,
  getWorkspaceStorageUsageSummary,
  getWorkspaceObjectsUsageSummary,
  adjustWorkspaceQdrantUsage,
  getWorkspaceQdrantUsage,
} from "./usage/usage-service";
import { measureUsageForModel, tokensToUnits, UsageMeterError, type UsageMeasurement } from "./consumption-meter";
import { calculatePriceForUsage } from "./price-calculator";
import { estimateLlmPreflight, estimateEmbeddingsPreflight, estimateAsrPreflight } from "./preflight-estimator";
import { assertSufficientWorkspaceCredits, InsufficientCreditsError } from "./credits-precheck";
import { applyIdempotentUsageCharge, IdempotencyKeyReusedError } from "./idempotent-charge-service";
import { workspaceOperationGuard } from "./guards/workspace-operation-guard";
import { OperationBlockedError, mapDecisionToPayload } from "./guards/errors";
import { listGuardBlockEvents } from "./guards/block-log-service";
import { buildEmbeddingsOperationContext, buildStorageUploadOperationContext, buildLlmOperationContext } from "./guards/helpers";
import { fetchAccessToken, type OAuthProviderConfig } from "./llm-access-token";
import { tariffPlanService } from "./tariff-plan-service";
import { TARIFF_LIMIT_CATALOG } from "./tariff-limit-catalog";
import { PlanDowngradeNotAllowedError, workspacePlanService } from "./workspace-plan-service";
import {
  listModels,
  createModel,
  updateModel,
  ensureModelAvailable,
  tryResolveModel,
  syncModelsWithLlmProvider,
  syncModelsWithEmbeddingProvider,
  syncModelsWithSpeechProvider,
  ModelInactiveError,
  ModelValidationError,
  ModelUnavailableError,
  type ModelInput,
} from "./model-service";
import {
  ensureWorkspaceCreditAccount,
  getWorkspaceCreditAccount,
  applyManualCreditAdjustment,
  getRecentManualAdjustments,
} from "./credits-service";
import { getWorkspaceCreditSummary } from "./credit-summary-service";
import { scheduleChatTitleGenerationIfNeeded } from "./chat-title-jobs";
import {
  applyTlsPreferences,
  parseJson,
  sanitizeHeadersForLog,
  type ApiRequestLog,
  type NodeFetchOptions,
} from "./http-utils";
import { sanitizeLlmModelOptions } from "./llm-utils";
import passport from "passport";
import bcrypt from "bcryptjs";
import {
  registerUserSchema,
  type PublicUser,
  type User,
  type PersonalApiToken,
  userRoles,
  insertEmbeddingProviderSchema,
  updateEmbeddingProviderSchema,
  insertLlmProviderSchema,
  updateLlmProviderSchema,
  canvasDocumentTypes,
  upsertAuthProviderSchema,
  type PublicEmbeddingProvider,
  type PublicLlmProvider,
  type EmbeddingProvider,
  type LlmProvider,
  type LlmModelOption,
  type LlmRequestConfig,
  type LlmResponseConfig,
  type CanvasDocument,
  type AuthProviderInsert,
  type Site,
  type WorkspaceEmbedKey,
  DEFAULT_QDRANT_CONFIG,
  DEFAULT_LLM_REQUEST_CONFIG,
  DEFAULT_LLM_RESPONSE_CONFIG,
  workspaceMemberRoles,
  type KnowledgeBaseAskAiPipelineStepLog,
  type UnicaChatConfigInsert,
  type ChatMessageMetadata,
  type ChatMessage,
  type File,
  models,
  workspaceCreditLedger,
} from "@shared/schema";
import { GIGACHAT_EMBEDDING_VECTOR_SIZE } from "@shared/constants";
import type { KnowledgeBaseSearchSettingsRow } from "@shared/schema";
import { centsToCredits, tryParseCreditsToCents } from "@shared/credits";
import { createSkillSchema, updateSkillSchema } from "@shared/skills";
import {
  actionInputTypes,
  actionOutputModes,
  actionPlacements,
  actionTargets,
} from "@shared/skills";
import { actionsRepository } from "./actions";
import type { SkillDto, ActionPlacement, ActionDto } from "@shared/skills";
import { skillActionsRepository } from "./skill-actions";
import { resolveLlmConfigForAction, LlmConfigNotFoundError } from "./llm-config-resolver";
import type {
  KnowledgeDocumentVectorizationJobStatus,
  KnowledgeDocumentVectorizationJobResult,
  KnowledgeBaseCrawlJobStatus,
  KnowledgeBaseCrawlConfig,
  KnowledgeBaseRagConfigResponse,
  KnowledgeBaseAskAiRunListResponse,
  KnowledgeBaseAskAiRunDetail,
} from "@shared/knowledge-base";
import {
  KNOWLEDGE_BASE_SEARCH_CONSTRAINTS,
  mergeChunkSearchSettings,
  mergeRagSearchSettings,
  type KnowledgeBaseSearchSettingsResponsePayload,
} from "@shared/knowledge-base-search";
import {
  castValueToType,
  collectionFieldTypes,
  normalizeArrayValue,
  renderLiquidTemplate,
  type CollectionSchemaFieldInput,
} from "@shared/vectorization";
import {
  requireAuth,
  requireAdmin,
  getSessionUser,
  toPublicUser,
  reloadGoogleAuth,
  reloadYandexAuth,
  ensureWorkspaceContext,
  ensureWorkspaceContextMiddleware,
  buildSessionResponse,
  getRequestWorkspace,
  getRequestWorkspaceMemberships,
  resolveOptionalUser,
  WorkspaceContextError,
} from "./auth";
import { smtpSettingsService, SmtpSettingsError } from "./smtp-settings";
import { updateSmtpSettingsSchema } from "@shared/smtp";
import { smtpTestService } from "./smtp-test-service";
import {
  indexingRulesService,
  IndexingRulesError,
  IndexingRulesDomainError,
  resolveEmbeddingProviderForWorkspace,
} from "./indexing-rules";
import {
  knowledgeBaseIndexingPolicyService,
  KnowledgeBaseIndexingPolicyError,
  KnowledgeBaseIndexingPolicyDomainError,
} from "./knowledge-base-indexing-policy";
import {
  knowledgeBaseIndexingPolicySchema,
  updateKnowledgeBaseIndexingPolicySchema,
} from "@shared/knowledge-base-indexing-policy";
import { listEmbeddingProvidersWithStatus, resolveEmbeddingProviderModels } from "./embedding-provider-registry";
import {
  DEFAULT_INDEXING_RULES,
  MAX_CHUNK_SIZE,
  MAX_RELEVANCE_THRESHOLD,
  MAX_TOP_K,
  MIN_CHUNK_SIZE,
  MIN_RELEVANCE_THRESHOLD,
  MIN_TOP_K,
  indexingRulesSchema,
  updateIndexingRulesSchema,
} from "@shared/indexing-rules";
import {
  speechProviderService,
  SpeechProviderServiceError,
  SpeechProviderNotFoundError,
  SpeechProviderDisabledError,
  type SpeechProviderSummary,
  type SpeechProviderDetail,
  type SpeechProviderSecretsPatch,
} from "./speech-provider-service";
import {
  fileStorageProviderService,
  normalizeFileProviderConfig,
  defaultProviderConfig,
  FileStorageProviderServiceError,
  FileStorageProviderNotFoundError,
} from "./file-storage-provider-service";
import {
  yandexSttService,
  YandexSttError,
  YandexSttConfigError,
  isSupportedAudioFormat,
} from "./yandex-stt-service";
import {
  yandexSttAsyncService,
  YandexSttAsyncError,
  YandexSttAsyncConfigError,
} from "./yandex-stt-async-service";
import { yandexIamTokenService } from "./yandex-iam-token-service";
import multer from "multer";
import { getLlmPromptDebugConfig, isLlmPromptDebugEnabled, setLlmPromptDebugEnabled } from "./llm-debug-config";
import { getRecommendedAitunnelModels } from "./llm-providers/aitunnel-models";
import { parseBuffer as parseAudioBuffer } from "music-metadata";

import { getErrorCode, getSyscall, type NodeErrorLike } from "./types/errors";

// Глобальная страховка: не валим процесс на write EOF и подобные сетевые ошибки.
process.on("uncaughtException", (err: unknown) => {
  if (err && typeof err === 'object') {
    const nodeErr = err as NodeErrorLike;
    if (getErrorCode(nodeErr) === "EOF" && getSyscall(nodeErr) === "write") {
      console.warn("[process] swallowed write EOF:", err);
      return;
    }
  }
  console.error("[process] uncaughtException:", err);
});
process.on("unhandledRejection", (reason: unknown) => {
  if (reason && typeof reason === 'object') {
    const nodeErr = reason as NodeErrorLike;
    if (getErrorCode(nodeErr) === "EOF" && getSyscall(nodeErr) === "write") {
      console.warn("[process] swallowed write EOF (promise):", reason);
      return;
    }
  }
  console.error("[process] unhandledRejection:", reason);
});

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const segments: string[] = [];

    const baseMessage = typeof error.message === "string" ? error.message.trim() : "";
    if (baseMessage.length > 0) {
      segments.push(baseMessage);
    }

    const metadata = error as unknown as Record<string, unknown>;

    const appendDetail = (label: string) => {
      const value = metadata[label];
      if (typeof value === "string" && value.trim().length > 0) {
        segments.push(`${label}=${value.trim()}`);
      }
    };

    appendDetail("code");
    appendDetail("detail");
    appendDetail("hint");
    appendDetail("schema");
    appendDetail("table");
    appendDetail("column");
    appendDetail("constraint");

    const contextValue = metadata["context"];
    if (contextValue && typeof contextValue === "object") {
      try {
        segments.push(`context=${JSON.stringify(contextValue)}`);
      } catch {
        segments.push("context=[unserializable]");
      }
    }

    if (error.cause instanceof Error) {
      const causeMessage = error.cause.message?.trim();
      if (causeMessage) {
        segments.push(`cause=${causeMessage}`);
      }
    } else if (typeof error.cause === "string" && error.cause.trim().length > 0) {
      segments.push(`cause=${error.cause.trim()}`);
    }

    if (typeof error.stack === "string") {
      const [, firstStackLine] = error.stack.split("\n");
      if (firstStackLine) {
        segments.push(`stack=${firstStackLine.trim()}`);
      }
    }

    if (segments.length === 0) {
      segments.push(error.name || "Error");
    }

    return segments.join("; ");
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function recordEmbeddingUsageSafe(params: {
  workspaceId?: string | null;
  provider: EmbeddingProvider;
  modelKey?: string | null;
  modelId?: string | null;
  tokensTotal?: number | null;
  contentBytes?: number | null;
  operationId?: string;
  occurredAt?: Date;
}): Promise<void> {
  if (!params.workspaceId) return;
  const tokensTotal =
    params.tokensTotal ??
    (params.contentBytes !== null && params.contentBytes !== undefined
      ? Math.max(1, Math.ceil(params.contentBytes / 4))
      : null);
  if (tokensTotal === null || tokensTotal === undefined) return;

  let modelId: string | null = params.modelId ?? null;
  let modelName: string | null = null;
  let modelCreditsPerUnit: number | null = null;
  const modelKey = params.modelKey ?? params.provider.model ?? null;
  if (!modelId && modelKey) {
    try {
      const resolvedModel = await tryResolveModel(modelKey, { expectedType: "EMBEDDINGS" });
      modelId = resolvedModel?.id ?? null;
      modelName = resolvedModel?.displayName ?? null;
      modelCreditsPerUnit = resolvedModel?.creditsPerUnit ?? null;
    } catch (error) {
      if (error instanceof ModelValidationError || error instanceof ModelUnavailableError) {
        console.warn(
          `[usage] embedding model resolve failed for workspace ${params.workspaceId}: ${error.message}`,
        );
      } else {
        throw error;
      }
    }
  }

  try {
    const pricingUnits = tokensToUnits(tokensTotal);
    const appliedCreditsPerUnitCents = Math.max(0, Math.trunc(modelCreditsPerUnit ?? 0));
    const creditsChargedCents = pricingUnits.units * appliedCreditsPerUnitCents;
    const operationId = params.operationId ?? `embed-${randomUUID()}`;
    const measurement = {
      unit: "TOKENS_1K",
      quantityRaw: pricingUnits.raw,
      quantityUnits: pricingUnits.units,
      metadata: { provider: params.provider.id ?? params.provider.providerType ?? "unknown" },
    } satisfies UsageMeasurement;

    await recordEmbeddingUsageEvent({
      workspaceId: params.workspaceId,
      operationId,
      provider: params.provider.id ?? params.provider.providerType ?? "unknown",
      model: params.modelKey ?? params.provider.model ?? "unknown",
      modelId,
      tokensTotal,
      contentBytes: params.contentBytes,
      appliedCreditsPerUnit: appliedCreditsPerUnitCents,
      creditsCharged: creditsChargedCents,
      occurredAt: params.occurredAt,
    });

    await applyIdempotentUsageCharge({
      workspaceId: params.workspaceId,
      operationId,
      model: {
        id: modelId,
        key: params.modelKey ?? params.provider.model ?? null,
        name: modelName,
        type: "EMBEDDINGS",
        consumptionUnit: measurement.unit,
      },
      measurement,
      price: {
        creditsChargedCents,
        appliedCreditsPerUnitCents,
        unit: measurement.unit,
        quantityUnits: measurement.quantityUnits,
        quantityRaw: measurement.quantityRaw,
      },
      occurredAt: params.occurredAt,
      metadata: {
        source: "embedding",
        provider: params.provider.id ?? params.provider.providerType ?? "unknown",
      },
    });
  } catch (error) {
    console.error(
      `[usage] Failed to record embedding usage for workspace ${params.workspaceId}: ${getErrorDetails(error)}`,
    );
  }
}

function createQueryPreview(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function maskSensitiveInfoInUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.password) {
      parsed.password = "***";
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/:[^:@]*@/, ":***@");
  }
}

const chunkSearchConstraints = KNOWLEDGE_BASE_SEARCH_CONSTRAINTS.chunk;
const ragSearchConstraints = KNOWLEDGE_BASE_SEARCH_CONSTRAINTS.rag;

const chunkSearchSettingsSchema = z
  .object({
    topK: z.number().int().min(chunkSearchConstraints.topK.min).max(chunkSearchConstraints.topK.max).optional(),
    bm25Weight: z
      .number()
      .min(chunkSearchConstraints.bm25Weight.min)
      .max(chunkSearchConstraints.bm25Weight.max)
      .optional(),
    synonyms: z.array(z.string()).max(chunkSearchConstraints.synonyms.maxItems ?? 100).optional(),
    includeDrafts: z.boolean().optional(),
    highlightResults: z.boolean().optional(),
    filters: z.string().max(8000).optional(),
  })
  .partial();

const ragSearchSettingsSchema = z
  .object({
    topK: z.number().int().min(ragSearchConstraints.topK.min).max(ragSearchConstraints.topK.max).optional(),
    bm25Weight: z
      .number()
      .min(ragSearchConstraints.bm25Weight.min)
      .max(ragSearchConstraints.bm25Weight.max)
      .optional(),
    bm25Limit: z
      .number()
      .int()
      .min(ragSearchConstraints.bm25Limit.min)
      .max(ragSearchConstraints.bm25Limit.max)
      .nullable()
      .optional(),
    vectorWeight: z
      .number()
      .min(ragSearchConstraints.vectorWeight.min)
      .max(ragSearchConstraints.vectorWeight.max)
      .nullable()
      .optional(),
    vectorLimit: z
      .number()
      .int()
      .min(ragSearchConstraints.vectorLimit.min)
      .max(ragSearchConstraints.vectorLimit.max)
      .nullable()
      .optional(),
    embeddingProviderId: z.string().max(255).nullable().optional(),
    collection: z.string().max(255).nullable().optional(),
    llmProviderId: z.string().max(255).nullable().optional(),
    llmModel: z.string().max(255).nullable().optional(),
    temperature: z
      .number()
      .min(ragSearchConstraints.temperature.min)
      .max(ragSearchConstraints.temperature.max)
      .nullable()
      .optional(),
    maxTokens: z
      .number()
      .int()
      .min(ragSearchConstraints.maxTokens.min)
      .max(ragSearchConstraints.maxTokens.max)
      .nullable()
      .optional(),
    systemPrompt: z.string().max(8000).optional(),
    responseFormat: z.enum(["text", "markdown", "html"]).nullable().optional(),
  })
  .partial();

const knowledgeBaseSearchSettingsSchema = z
  .object({
    chunkSettings: chunkSearchSettingsSchema.optional(),
    ragSettings: ragSearchSettingsSchema.optional(),
  })
  .default({});

function normalizeTimestamp(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return null;
}

function buildSearchSettingsResponse(
  record: KnowledgeBaseSearchSettingsRow | null,
): KnowledgeBaseSearchSettingsResponsePayload {
  const chunkSettings = mergeChunkSearchSettings(record?.chunkSettings ?? null);
  const ragSettings = mergeRagSearchSettings(record?.ragSettings ?? null, {
    topK: chunkSettings.topK,
    bm25Weight: chunkSettings.bm25Weight,
  });

  return {
    chunkSettings,
    ragSettings,
    updatedAt: normalizeTimestamp(record?.updatedAt ?? null),
  };
}

function getNodeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}

function pickFirstString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }

  return null;
}

function pickFirstStringOrUndefined(...candidates: Array<unknown>): string | undefined {
  const value = pickFirstString(...candidates);
  return value === null ? undefined : value;
}

const resolveWorkspaceIdForRequest = (req: Request, candidate?: string | null) => {
  const currentWorkspace = getRequestWorkspace(req);
  const normalized = candidate?.trim();
  if (!normalized) {
    return currentWorkspace.id;
  }
  if (normalized === currentWorkspace.id) {
    return normalized;
  }
  const memberships = getRequestWorkspaceMemberships(req);
  const hasAccess = memberships.some((entry) => entry.id === normalized);
  if (!hasAccess) {
    throw new HttpError(403, "Нет доступа к рабочему пространству");
  }
  return normalized;
};

function normalizeDomainCandidate(candidate: unknown): string | null {
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return null;
  }

  const withScheme = /^(https?:)?\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    return url.hostname.toLowerCase();
  } catch {
    const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, "");
    const hostname = withoutScheme.split(/[/?#]/, 1)[0]?.split(":", 1)[0]?.trim() ?? "";
    return hostname ? hostname.toLowerCase() : null;
  }
}

function extractRequestDomain(req: Request, bodySource: Record<string, unknown>): string | null {
  const headerOrigin = Array.isArray(req.headers["x-embed-origin"]) ? req.headers["x-embed-origin"][0] : req.headers["x-embed-origin"];
  const headerCandidates = [
    headerOrigin,
    req.headers.origin,
    req.headers.referer,
  ];

  for (const value of headerCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  const queryCandidates = [
    req.query.origin,
    req.query.domain,
    req.query.host,
  ];

  for (const value of queryCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  const bodyCandidates = [bodySource.origin, bodySource.domain, bodySource.host];
  for (const value of bodyCandidates) {
    const normalized = normalizeDomainCandidate(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

interface PublicCollectionContext {
  apiKey?: string;
  workspaceId: string;
  site?: Site;
  embedKey?: WorkspaceEmbedKey;
  knowledgeBaseId?: string;
}

function normalizeResponseFormat(
  value: unknown,
): RagResponseFormat | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized === "md" || normalized === "markdown") {
    return "markdown";
  }

  if (normalized === "html") {
    return "html";
  }

  if (normalized === "text" || normalized === "plain") {
    return "text";
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

function buildSourceSnippet(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const normalized = candidate.replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    if (normalized.length > 240) {
      return `${normalized.slice(0, 240)}…`;
    }

    return normalized;
  }

  return null;
}

function pickAbsoluteUrl(baseUrls: string[], ...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }

    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const direct = new URL(trimmed);
      return direct.toString();
    } catch {
      for (const base of baseUrls) {
        try {
          const resolved = new URL(trimmed, base);
          return resolved.toString();
        } catch {
          // ignore invalid base resolution
        }
      }
    }
  }

  return null;
}

async function resolvePublicCollectionRequest(
  req: Request,
  res: Response,
): Promise<PublicCollectionContext | null> {
  const bodySource: Record<string, unknown> =
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? { ...(req.body as Record<string, unknown>) }
      : {};

  const headerKey = req.headers["x-api-key"];
  const apiKey = pickFirstString(
    Array.isArray(headerKey) ? headerKey[0] : headerKey,
    bodySource.apiKey,
    req.query.apiKey,
    req.query.apikey,
  );

  const paramPublicId = typeof req.params?.publicId === "string" ? req.params.publicId : undefined;
  const publicId = pickFirstString(
    paramPublicId,
    bodySource.publicId,
    bodySource.sitePublicId,
    req.query.publicId,
    req.query.sitePublicId,
    req.query.siteId,
  );

  const workspaceIdCandidate = pickFirstString(
    bodySource.workspaceId,
    bodySource.workspace_id,
    req.query.workspaceId,
    req.query.workspace_id,
  );

  const knowledgeBaseIdCandidate = pickFirstString(
    bodySource.kbId,
    bodySource.kb_id,
    req.query.kbId,
    req.query.kb_id,
  );

  const requestDomain = extractRequestDomain(req, bodySource);

  async function ensureWorkspaceAccess(targetWorkspaceId: string): Promise<boolean> {
    const workspaceMemberships = getRequestWorkspaceMemberships(req);
    if (workspaceMemberships.length > 0) {
      const hasAccess = workspaceMemberships.some((entry) => entry.id === targetWorkspaceId);
      if (!hasAccess) {
        res.status(403).json({ error: "Нет доступа к рабочему пространству" });
        return false;
      }
    } else {
      const user = await resolveOptionalUser(req);
      if (user) {
        const isMember = await storage.isWorkspaceMember(targetWorkspaceId, user.id);
        if (!isMember) {
          res.status(403).json({ error: "Нет доступа к рабочему пространству" });
          return false;
        }
      }
    }

    return true;
  }

  if (!apiKey) {
    let resolvedWorkspaceId = workspaceIdCandidate;

    if (!resolvedWorkspaceId) {
      const user = await resolveOptionalUser(req);
      if (!user) {
        res.status(401).json({ error: "Укажите X-API-Key в заголовке или apiKey в запросе" });
        return null;
      }

      try {
        const context = await ensureWorkspaceContext(req, user);
        resolvedWorkspaceId = context.active.id;
      } catch (error) {
        if (error instanceof WorkspaceContextError) {
          res.status(error.status).json({ error: error.message });
          return null;
        }
        throw error;
      }
    }

    if (!resolvedWorkspaceId) {
      res.status(400).json({ error: "Передайте workspace_id или X-Workspace-Id" });
      return null;
    }

    if (!(await ensureWorkspaceAccess(resolvedWorkspaceId))) {
      return null;
    }

    if (knowledgeBaseIdCandidate) {
      const base = await storage.getKnowledgeBase(knowledgeBaseIdCandidate);
      if (!base) {
        res.status(404).json({ error: "База знаний не найдена" });
        return null;
      }

      if (base.workspaceId !== resolvedWorkspaceId) {
        res.status(403).json({ error: "Нет доступа к базе знаний" });
        return null;
      }

      return { workspaceId: resolvedWorkspaceId, knowledgeBaseId: base.id };
    }

    return { workspaceId: resolvedWorkspaceId };
  }

  if (publicId) {
    if (!workspaceIdCandidate) {
      res.status(400).json({ error: "Передайте workspace_id в теле запроса" });
      return null;
    }

    console.log(
      `[RAG DEBUG] API Key: ${apiKey.substring(0, 10)}..., Workspace ID: ${workspaceIdCandidate}, Public ID: ${publicId}`,
    );

    if (!(await ensureWorkspaceAccess(workspaceIdCandidate))) {
      return null;
    }

    const site = await storage.getSiteByPublicId(publicId);

    if (!site) {
      res.status(404).json({ error: "Коллекция не найдена" });
      return null;
    }

    if (site.workspaceId !== workspaceIdCandidate) {
      res.status(403).json({ error: "Нет доступа к рабочему пространству" });
      return null;
    }

    if (site.publicApiKey !== apiKey) {
      res.status(401).json({ error: "Некорректный API-ключ" });
      return null;
    }

    return { site, apiKey, workspaceId: workspaceIdCandidate };
  }

  console.log(`[RAG DEBUG] Looking up site by API key...`);
  const site = await storage.getSiteByPublicApiKey(apiKey);

  if (site) {
    console.log(`[RAG DEBUG] getSiteByPublicApiKey result: found site ${site.id}, workspace ${site.workspaceId}`);

    if (workspaceIdCandidate && site.workspaceId !== workspaceIdCandidate) {
      res.status(403).json({ error: "Нет доступа к рабочему пространству" });
      return null;
    }

    if (!(await ensureWorkspaceAccess(site.workspaceId))) {
      return null;
    }

    if (site.publicApiKey !== apiKey) {
      res.status(401).json({ error: "Некорректный API-ключ" });
      return null;
    }

    return { site, apiKey, workspaceId: site.workspaceId };
  }

  console.log(`[RAG DEBUG] public site not found, checking embed key context`);
  const embedKey = await storage.getWorkspaceEmbedKeyByPublicKey(apiKey);

  if (!embedKey) {
    res.status(404).json({ error: "Коллекция не найдена" });
    return null;
  }

  if (workspaceIdCandidate && workspaceIdCandidate !== embedKey.workspaceId) {
    res.status(403).json({ error: "Нет доступа к рабочему пространству" });
    return null;
  }

  if (!(await ensureWorkspaceAccess(embedKey.workspaceId))) {
    return null;
  }

  const allowedDomains = await storage.listWorkspaceEmbedKeyDomains(embedKey.id);
  const allowedDomainSet = new Set(
    allowedDomains
      .map((entry) => typeof entry.domain === "string" ? entry.domain.trim().toLowerCase() : "")
      .filter((domain) => domain.length > 0),
  );

  if (allowedDomainSet.size > 0) {
    if (!requestDomain) {
      res.status(403).json({ error: "Домен запроса не определён. Передайте заголовок Origin или X-Embed-Origin." });
      return null;
    }

    if (!allowedDomainSet.has(requestDomain)) {
      res.status(403).json({ error: `Домен ${requestDomain} не добавлен в allowlist для данного ключа` });
      return null;
    }
  }

  return {
    apiKey,
    workspaceId: embedKey.workspaceId,
    embedKey,
    knowledgeBaseId: embedKey.knowledgeBaseId,
  };
}

async function resolveGenerativeWorkspace(
  req: Request,
  res: Response,
): Promise<{ workspaceId: string; site?: Site | null; isPublic: boolean } | null> {
  const bodySource: Record<string, unknown> =
    req.body && typeof req.body === "object" && !Array.isArray(req.body) ? { ...(req.body as Record<string, unknown>) } : {};

  const headerKey = req.headers["x-api-key"];
  const apiKey = pickFirstString(
    Array.isArray(headerKey) ? headerKey[0] : headerKey,
    bodySource.apiKey,
    req.query.apiKey,
    req.query.apikey,
  );

  if (!apiKey) {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      const workspaceIdStrict = workspaceId as string;
      return { workspaceId, site: null, isPublic: false };
    } catch (error) {
      if (error instanceof WorkspaceContextError) {
        res.status(401).json({ error: "Требуется авторизация" });
        return null;
      }
      throw error;
    }
  }

  const publicContext = await resolvePublicCollectionRequest(req, res);
  if (!publicContext) {
    return null;
  }

  return { workspaceId: publicContext.workspaceId, site: publicContext.site ?? null, isPublic: true };
}

class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function handleKnowledgeBaseRouteError(error: unknown, res: Response) {
  if (error instanceof KnowledgeBaseError) {
    return res.status(error.status).json({ error: error.message });
  }

  if (error instanceof WorkspaceContextError) {
    return res.status(error.status).json({ error: error.message });
  }

  console.error("Knowledge base request failed", error);
  return res
    .status(500)
    .json({ error: "Не удалось обработать запрос к базе знаний" });
}

function parseKnowledgeNodeParentId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === "") {
    return null;
  }

  if (typeof raw !== "string") {
    throw new KnowledgeBaseError("Некорректный идентификатор родителя", 400);
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function sanitizeRedirectPath(candidate: unknown): string {
  if (typeof candidate !== "string") {
    return "/";
  }

  const trimmed = candidate.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }

  try {
    const base = "http://localhost";
    const parsed = new URL(trimmed, base);
    if (parsed.origin !== base) {
      return "/";
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function appendAuthErrorParam(path: string, code: string): string {
  const hashIndex = path.indexOf("#");
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";

  const questionIndex = base.indexOf("?");
  const pathname = questionIndex >= 0 ? base.slice(0, questionIndex) : base;
  const query = questionIndex >= 0 ? base.slice(questionIndex + 1) : "";

  const params = new URLSearchParams(query);
  params.set("authError", code);

  const queryString = params.toString();
  return `${pathname}${queryString ? `?${queryString}` : ""}${hash}`;
}

function parseVectorSize(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function resolveVectorSizeForCollection(
  provider: EmbeddingProvider,
  detectedVectorLength: number,
): number {
  const configuredSize = parseVectorSize(provider.qdrantConfig?.vectorSize);
  if (configuredSize) {
    return configuredSize;
  }

  if (detectedVectorLength > 0) {
    return detectedVectorLength;
  }

  if (provider.providerType === "gigachat") {
    return GIGACHAT_EMBEDDING_VECTOR_SIZE;
  }

  throw new Error(
    "Не удалось определить размер вектора для новой коллекции. Укажите vectorSize в настройках сервиса эмбеддингов",
  );
}

async function ensureCollectionCreatedIfNeeded(options: {
  client: QdrantClient;
  provider: EmbeddingProvider;
  collectionName: string;
  detectedVectorLength: number;
  shouldCreateCollection: boolean;
  collectionExists: boolean;
}): Promise<boolean> {
  const {
    client,
    provider,
    collectionName,
    detectedVectorLength,
    shouldCreateCollection,
    collectionExists,
  } = options;

  if (collectionExists || !shouldCreateCollection) {
    return false;
  }

  const vectorSizeForCreation = resolveVectorSizeForCollection(
    provider,
    detectedVectorLength,
  );

  await client.createCollection(collectionName, {
    vectors: {
      size: vectorSizeForCreation,
      distance: "Cosine",
    },
  });

  return true;
}

function extractQdrantApiError(error: unknown):
  | {
      status: number;
      message: string;
      details: unknown;
    }
  | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as {
    status?: unknown;
    statusText?: unknown;
    data?: unknown;
    message?: unknown;
  };

  if (typeof candidate.status !== "number") {
    return undefined;
  }

  if (typeof candidate.statusText !== "string" && typeof candidate.message !== "string") {
    return undefined;
  }

  const data = candidate.data;
  let message: string | undefined;

  if (data && typeof data === "object") {
    const dataRecord = data as Record<string, unknown>;
    const nestedError = dataRecord.error;
    const nestedStatus = dataRecord.status;
    const nestedMessage = dataRecord.message;

    if (typeof nestedError === "string" && nestedError.trim().length > 0) {
      message = nestedError;
    } else if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
      message = nestedMessage;
    } else if (typeof nestedStatus === "string" && nestedStatus.trim().length > 0) {
      message = nestedStatus;
    }
  }

  if (!message) {
    if (typeof candidate.message === "string" && candidate.message.trim().length > 0) {
      message = candidate.message;
    } else if (
      typeof candidate.statusText === "string" &&
      candidate.statusText.trim().length > 0
    ) {
      message = candidate.statusText;
    } else {
      message = "Ошибка Qdrant";
    }
  }

  return {
    status: candidate.status,
    message,
    details: data ?? null,
  };
}

const ADMIN_SPEECH_PROVIDER_TIMEOUT_MS = 30_000;
const ADMIN_SPEECH_PROVIDER_RATE_LIMIT = 30;
const ADMIN_SPEECH_PROVIDER_RATE_WINDOW_MS = 60_000;
const ADMIN_SPEECH_PROVIDER_BODY_LIMIT_BYTES = 64 * 1024;

class SpeechProviderRateLimitError extends Error {
  constructor() {
    super("Rate limit exceeded");
    this.name = "SpeechProviderRateLimitError";
  }
}

const speechProviderRateLimitBuckets = new Map<string, number[]>();

function trackSpeechProviderRateLimit(adminId: string) {
  const now = Date.now();
  const windowStart = now - ADMIN_SPEECH_PROVIDER_RATE_WINDOW_MS;
  const timestamps = speechProviderRateLimitBuckets.get(adminId) ?? [];
  const recent = timestamps.filter((value) => value > windowStart);
  if (recent.length >= ADMIN_SPEECH_PROVIDER_RATE_LIMIT) {
    throw new SpeechProviderRateLimitError();
  }
  recent.push(now);
  speechProviderRateLimitBuckets.set(adminId, recent);
}

async function runWithAdminTimeout<T>(operation: () => Promise<T>): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Request timeout"));
    }, ADMIN_SPEECH_PROVIDER_TIMEOUT_MS);
    operation()
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

type AdminMeta = { id: string; email: string | null } | null;

async function resolveAdminMeta(adminId?: string | null): Promise<AdminMeta> {
  if (!adminId) {
    return null;
  }
  try {
    const user = await storage.getUser(adminId);
    return {
      id: adminId,
      email: user?.email ?? null,
    };
  } catch {
    return {
      id: adminId,
      email: null,
    };
  }
}

function parseSpeechProviderListParams(req: Request):
  | { limit: number; offset: number }
  | { error: string } {
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const offsetRaw = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;

  const parseNumber = (value: unknown): number | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return NaN;
  };

  const limitCandidate = parseNumber(limitRaw);
  if (limitCandidate !== undefined) {
    if (!Number.isInteger(limitCandidate) || limitCandidate < 1 || limitCandidate > 100) {
      return { error: "Invalid value for field 'limit'" };
    }
  }

  const offsetCandidate = parseNumber(offsetRaw);
  if (offsetCandidate !== undefined) {
    if (!Number.isInteger(offsetCandidate) || offsetCandidate < 0 || offsetCandidate > 1000) {
      return { error: "Invalid value for field 'offset'" };
    }
  }

  return {
    limit: (limitCandidate ?? 50) as number,
    offset: (offsetCandidate ?? 0) as number,
  };
}

function parseFileStorageProviderListParams(req: Request):
  | { limit: number; offset: number }
  | { error: string } {
  const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
  const offsetRaw = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;

  const parseNumber = (value: unknown): number | undefined => {
    if (value === undefined) {
      return undefined;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return NaN;
  };

  const limitCandidate = parseNumber(limitRaw);
  if (limitCandidate !== undefined) {
    if (!Number.isInteger(limitCandidate) || limitCandidate < 1 || limitCandidate > 500) {
      return { error: "Invalid value for field 'limit'" };
    }
  }

  const offsetCandidate = parseNumber(offsetRaw);
  if (offsetCandidate !== undefined) {
    if (!Number.isInteger(offsetCandidate) || offsetCandidate < 0 || offsetCandidate > 5000) {
      return { error: "Invalid value for field 'offset'" };
    }
  }

  return {
    limit: (limitCandidate ?? 50) as number,
    offset: (offsetCandidate ?? 0) as number,
  };
}

async function buildSpeechProviderListItem(summary: SpeechProviderSummary) {
  const adminMeta = await resolveAdminMeta(summary.updatedByAdminId ?? null);
  return {
    id: summary.id,
    name: summary.displayName,
    type: summary.providerType,
    direction: summary.direction,
    status: summary.status,
    isEnabled: summary.isEnabled,
    lastUpdatedAt: summary.updatedAt,
    lastStatusChangedAt: summary.lastStatusChangedAt ?? null,
    updatedByAdmin: adminMeta,
  };
}

async function buildSpeechProviderResponse(detail: SpeechProviderDetail) {
  const adminMeta = await resolveAdminMeta(detail.provider.updatedByAdminId ?? null);
  return {
    id: detail.provider.id,
    name: detail.provider.displayName,
    type: detail.provider.providerType,
    direction: detail.provider.direction,
    status: detail.provider.status,
    isEnabled: detail.provider.isEnabled,
    lastUpdatedAt: detail.provider.updatedAt,
    lastStatusChangedAt: detail.provider.lastStatusChangedAt ?? null,
    lastValidationAt: detail.provider.lastValidationAt ?? null,
    lastErrorCode: detail.provider.lastErrorCode ?? null,
    lastErrorMessage: detail.provider.lastErrorMessage ?? null,
    config: detail.config,
    secrets: detail.secrets,
    updatedByAdmin: adminMeta,
  };
}

const speechProviderConfigSchema = z
  .object({
    languageCode: z.string().trim().max(64).optional(),
    model: z.string().trim().max(128).optional(),
    enablePunctuation: z.boolean().optional(),
    iamMode: z.enum(["manual", "auto"]).optional(),
    iamToken: z.string().trim().max(4096).optional(),
  })
  .strict();

const speechProviderSecretsSchema = z
  .object({
    apiKey: z.union([z.string().trim(), z.null()]).optional(),
    folderId: z.union([z.string().trim(), z.null()]).optional(),
    serviceAccountKey: z.union([z.string().trim(), z.null()]).optional(),
    s3AccessKeyId: z.union([z.string().trim(), z.null()]).optional(),
    s3SecretAccessKey: z.union([z.string().trim(), z.null()]).optional(),
    s3BucketName: z.union([z.string().trim(), z.null()]).optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasAnyS3 = data.s3AccessKeyId || data.s3SecretAccessKey || data.s3BucketName;
      if (!hasAnyS3) return true;
      return data.s3AccessKeyId && data.s3SecretAccessKey && data.s3BucketName;
    },
    { message: "Необходимо заполнить все три поля S3 (Access Key ID, Secret Access Key, Bucket Name) или оставить их пустыми" }
  );

const updateSpeechProviderSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    config: speechProviderConfigSchema.optional(),
    secrets: speechProviderSecretsSchema.optional(),
  })
  .strict();

function normalizeSpeechProviderConfigPatch(
  config?: z.infer<typeof speechProviderConfigSchema>,
): Record<string, unknown> | undefined {
  if (!config) {
    return undefined;
  }
  const payload: Record<string, unknown> = {};
  if (config.languageCode !== undefined) {
    payload.languageCode = config.languageCode;
  }
  if (config.model !== undefined) {
    payload.model = config.model;
  }
  if (config.enablePunctuation !== undefined) {
    payload.enablePunctuation = config.enablePunctuation;
  }
  if (config.iamMode !== undefined) {
    payload.iamMode = config.iamMode;
  }
  if (config.iamToken !== undefined) {
    payload.iamToken = config.iamToken;
  }
  return Object.keys(payload).length > 0 ? payload : undefined;
}

function normalizeSpeechProviderSecretsPatch(
  secrets?: z.infer<typeof speechProviderSecretsSchema>,
): SpeechProviderSecretsPatch | undefined {
  if (!secrets) {
    return undefined;
  }
  const entries: SpeechProviderSecretsPatch = [];
  for (const [key, value] of Object.entries(secrets)) {
    if (value === undefined) {
      continue;
    }
    if (value === null || (typeof value === "string" && value.trim().length === 0)) {
      entries.push({ key, clear: true });
    } else {
      entries.push({ key, value });
    }
  }
  return entries.length > 0 ? entries : undefined;
}

function computeNextSecretFlags(
  current: Record<string, { isSet: boolean }>,
  patch?: SpeechProviderSecretsPatch,
) {
  const next: Record<string, { isSet: boolean }> = {};
  for (const [key, value] of Object.entries(current)) {
    next[key] = { isSet: value.isSet };
  }
  if (!patch) {
    return next;
  }
  for (const entry of patch) {
    if (!entry.key) {
      continue;
    }
    if (entry.clear || !entry.value) {
      next[entry.key] = { isSet: false };
    } else {
      next[entry.key] = { isSet: true };
    }
  }
  return next;
}

function logSpeechProviderAudit(options: {
  adminId: string;
  providerId: string;
  fields: string[];
  fromStatus: string;
  toStatus: string;
}) {
  const fieldsLabel = options.fields.length > 0 ? options.fields.join(",") : "none";
  console.info(
    `[speech-provider] admin=${options.adminId} provider=${options.providerId} fields=${fieldsLabel} status=${options.fromStatus}->${options.toStatus}`,
  );
}

export function __resetSpeechProviderRateLimitForTests() {
  speechProviderRateLimitBuckets.clear();
}

export function __seedSpeechProviderRateLimitForTests(adminId: string, timestamps: number[]) {
  speechProviderRateLimitBuckets.set(adminId, [...timestamps]);
}

function getAuthorizedUser(req: Request, res: Response): PublicUser | undefined {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: "Требуется авторизация" });
    return undefined;
  }

  return user;
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const normalized = fullName.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) {
    return { firstName: "Пользователь", lastName: "" };
  }

  const [first, ...rest] = normalized.split(" ");
  return {
    firstName: first,
    lastName: rest.join(" ") ?? "",
  };
}

type PersonalApiTokenSummary = {
  id: string;
  lastFour: string;
  createdAt: string;
  revokedAt: string | null;
};

function toPersonalApiTokenSummary(token: PersonalApiToken): PersonalApiTokenSummary {
  const createdAt = token.createdAt instanceof Date ? token.createdAt.toISOString() : String(token.createdAt);
  const revokedAt = token.revokedAt
    ? token.revokedAt instanceof Date
      ? token.revokedAt.toISOString()
      : String(token.revokedAt)
    : null;

  return {
    id: token.id,
    lastFour: token.lastFour,
    createdAt,
    revokedAt,
  };
}

function toIsoDate(value: Date | string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function toWorkspaceMemberResponse(entry: WorkspaceMemberWithUser, currentUserId: string) {
  const { member, user } = entry;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: member.role,
    createdAt: toIsoDate(member.createdAt),
    updatedAt: toIsoDate(member.updatedAt),
    isYou: user.id === currentUserId,
  };
}

async function loadTokensAndSyncUser(userId: string): Promise<{
  tokens: PersonalApiToken[];
  activeTokens: PersonalApiToken[];
  latestActive: PersonalApiToken | null;
}> {
  const tokens = await storage.listUserPersonalApiTokens(userId);
  const activeTokens = tokens.filter((token) => !token.revokedAt);
  const latestActive = activeTokens.length > 0 ? activeTokens[0]! : null;

  if (latestActive) {
    await storage.setUserPersonalApiToken(userId, {
      hash: latestActive.tokenHash,
      lastFour: latestActive.lastFour,
      generatedAt: latestActive.createdAt,
    });
  } else {
    await storage.setUserPersonalApiToken(userId, {
      hash: null,
      lastFour: null,
      generatedAt: null,
    });
  }

  return { tokens, activeTokens, latestActive };
}

function toPublicEmbeddingProvider(provider: EmbeddingProvider): PublicEmbeddingProvider {
  const { authorizationKey, ...rest } = provider;
  let qdrantConfig =
    rest.qdrantConfig && typeof rest.qdrantConfig === "object"
      ? { ...rest.qdrantConfig }
      : undefined;

  if (rest.providerType === "gigachat") {
    const baseConfig = qdrantConfig ?? { ...DEFAULT_QDRANT_CONFIG };
    const normalizedSize = parseVectorSize(baseConfig.vectorSize);

    qdrantConfig = {
      ...baseConfig,
      vectorSize: normalizedSize ?? GIGACHAT_EMBEDDING_VECTOR_SIZE,
    };
  }

  return {
    ...rest,
    qdrantConfig: qdrantConfig ?? rest.qdrantConfig,
    hasAuthorizationKey: Boolean(authorizationKey && authorizationKey.length > 0),
  };
}

function toPublicLlmProvider(provider: LlmProvider): PublicLlmProvider {
  const { authorizationKey, availableModels, ...rest } = provider;
  const rawRequestConfig =
    rest.requestConfig && typeof rest.requestConfig === "object"
      ? (rest.requestConfig as Record<string, unknown>)
      : undefined;
  const rawResponseConfig =
    rest.responseConfig && typeof rest.responseConfig === "object"
      ? (rest.responseConfig as Record<string, unknown>)
      : undefined;

  const requestConfig = {
    ...DEFAULT_LLM_REQUEST_CONFIG,
    ...(rawRequestConfig ?? {}),
  };

  const responseConfig = {
    ...DEFAULT_LLM_RESPONSE_CONFIG,
    ...(rawResponseConfig ?? {}),
  };

  return {
    ...rest,
    requestConfig,
    responseConfig,
    hasAuthorizationKey: Boolean(authorizationKey && authorizationKey.length > 0),
    availableModels: sanitizeLlmModelOptions(availableModels),
    recommendedModels:
      rest.providerType === "aitunnel"
        ? getRecommendedAitunnelModels()
        : [],
  };
}

const sendJsonToWebhookSchema = z.object({
  webhookUrl: z.string().trim().url("Некорректный URL"),
  payload: z.string().min(1, "JSON не может быть пустым")
});

const canvasDocumentTypeEnum = z.enum(canvasDocumentTypes);
const createCanvasDocumentSchema = z.object({
  chatId: z.string().trim().min(1, "Укажите чат"),
  transcriptId: z.string().trim().min(1).optional().nullable().transform((v) => (v && v.length > 0 ? v : undefined)),
  skillId: z.string().trim().min(1).optional().nullable().transform((v) => (v && v.length > 0 ? v : undefined)),
  actionId: z.string().trim().min(1).optional().nullable().transform((v) => (v && v.length > 0 ? v : undefined)),
  type: canvasDocumentTypeEnum.default("derived"),
  title: z.string().trim().min(1, "Укажите заголовок"),
  content: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (typeof v === "string" ? v : "")),
  isDefault: z.boolean().optional(),
});
const updateCanvasDocumentSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().optional(),
  isDefault: z.boolean().optional(),
});


const distanceEnum = z.enum(["Cosine", "Euclid", "Dot", "Manhattan"]);

const sparseVectorSchema = z.object({
  indices: z.array(z.number()),
  values: z.array(z.number()),
});

const pointVectorSchema = z.union([
  z.array(z.number()),
  z.array(z.array(z.number())),
  z.record(z.any()),
  sparseVectorSchema,
]);

const namedVectorSchema = z.object({
  name: z.string(),
  vector: z.array(z.number()),
});

const namedSparseVectorSchema = z.object({
  name: z.string(),
  vector: sparseVectorSchema,
});

const searchVectorSchema = z.union([
  z.array(z.number()),
  namedVectorSchema,
  namedSparseVectorSchema,
]);

const createVectorCollectionSchema = z.object({
  name: z.string().min(1).max(128),
  vectorSize: z.number().int().positive(),
  distance: distanceEnum.default("Cosine"),
  onDiskPayload: z.boolean().optional(),
});

const testEmbeddingCredentialsSchema = z.object({
  tokenUrl: z.string().trim().url("Некорректный URL для получения токена"),
  embeddingsUrl: z.string().trim().url("Некорректный URL сервиса эмбеддингов"),
  authorizationKey: z.string().trim().min(1, "Укажите Authorization key"),
  scope: z.string().trim().min(1, "Укажите OAuth scope"),
  model: z.string().trim().min(1, "Укажите модель эмбеддингов"),
  allowSelfSignedCertificate: z.boolean().default(false),
  requestHeaders: z.record(z.string()).default({}),
});

const TEST_EMBEDDING_TEXT = "привет!";
const KNOWLEDGE_DOCUMENT_PAYLOAD_TEXT_LIMIT = 4000;
const KNOWLEDGE_DOCUMENT_PAYLOAD_HTML_LIMIT = 6000;

function createEmbeddingRequestBody(model: string, sampleText: string): Record<string, unknown> {
  return {
    model,
    input: [sampleText],
    encoding_format: "float",
  };
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return null;
    }

    return Math.round(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  return null;
}

function extractEmbeddingTokenLimit(provider: EmbeddingProvider): number | null {
  const limitKeys = ["max_tokens_per_vectorization", "maxTokensPerVectorization"];

  const getFromRecord = (record: Record<string, unknown> | null | undefined): number | null => {
    if (!record) {
      return null;
    }

    for (const key of limitKeys) {
      if (key in record) {
        const parsed = parsePositiveInteger(record[key]);
        if (parsed !== null) {
          return parsed;
        }

        const raw = record[key];
        if (raw === 0 || raw === "0") {
          return null;
        }
      }
    }

    return null;
  };

  const providerRecord = provider as Record<string, unknown>;
  const directLimit = getFromRecord(providerRecord);
  if (directLimit !== null) {
    return directLimit;
  }

  const requestConfig =
    provider.requestConfig && typeof provider.requestConfig === "object"
      ? (provider.requestConfig as Record<string, unknown>)
      : null;

  const configLimit = getFromRecord(requestConfig);
  if (configLimit !== null) {
    return configLimit;
  }

  const additionalFields =
    requestConfig && typeof requestConfig.additionalBodyFields === "object"
      ? (requestConfig.additionalBodyFields as Record<string, unknown>)
      : null;

  return getFromRecord(additionalFields);
}

function ensureNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers: number[] = [];

  for (const item of value) {
    if (typeof item !== "number" || Number.isNaN(item)) {
      return undefined;
    }

    numbers.push(item);
  }

  return numbers;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function createDeterministicUuid(value: string): string {
  const hash = createHash("sha256").update(value).digest();
  const bytes = hash.subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizePointId(candidate: string | number): string | number {
  if (typeof candidate === "number") {
    return candidate;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return createDeterministicUuid("empty");
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  if (isUuid(trimmed)) {
    return trimmed;
  }

  return createDeterministicUuid(trimmed);
}

function normalizeDocumentText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countPlainTextWords(text: string): number {
  if (!text) {
    return 0;
  }

  return text.split(/\s+/).filter(Boolean).length;
}

function buildDocumentExcerpt(text: string, maxLength = 200): string {
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}…`;
}

function truncatePayloadValue(value: unknown, limit: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (limit <= 0 || trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

interface KnowledgeDocumentChunk {
  id?: string;
  content: string;
  index: number;
  start: number;
  end: number;
  charCount: number;
  wordCount: number;
  tokenCount: number;
  excerpt: string;
  vectorRecordId?: string | null;
}

function createKnowledgeDocumentChunks(
  text: string,
  chunkSize: number,
  chunkOverlap: number,
): KnowledgeDocumentChunk[] {
  const normalizedText = normalizeDocumentText(text);
  if (!normalizedText) {
    return [];
  }

  const effectiveSize = Math.max(1, chunkSize);
  const effectiveOverlap = Math.max(0, Math.min(chunkOverlap, effectiveSize - 1));
  const step = Math.max(1, effectiveSize - effectiveOverlap);
  const totalLength = normalizedText.length;
  const chunks: KnowledgeDocumentChunk[] = [];

  for (let start = 0, index = 0; start < totalLength; start += step, index += 1) {
    const end = Math.min(start + effectiveSize, totalLength);
    const slice = normalizedText.slice(start, end);
    const trimmed = slice.trim();

    if (!trimmed) {
      if (end >= totalLength) {
        break;
      }
      continue;
    }

    const charCount = trimmed.length;
    const wordCount = countPlainTextWords(trimmed);
    const tokenCount = wordCount;
    const excerpt = buildDocumentExcerpt(trimmed);

    chunks.push({
      id: `chunk-${index + 1}`,
      content: trimmed,
      index,
      start,
      end,
      charCount,
      wordCount,
      tokenCount,
      excerpt,
    });

    if (end >= totalLength) {
      break;
    }
  }

  return chunks;
}

function extractEmbeddingResponse(parsedBody: unknown) {
  if (!parsedBody || typeof parsedBody !== "object") {
    throw new Error("Не удалось разобрать ответ сервиса эмбеддингов");
  }

  const body = parsedBody as Record<string, unknown>;
  const data = body.data;

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Сервис эмбеддингов не вернул данные");
  }

  const firstEntry = data[0];
  if (!firstEntry || typeof firstEntry !== "object") {
    throw new Error("Сервис эмбеддингов вернул некорректный ответ");
  }

  const entryRecord = firstEntry as Record<string, unknown>;
  const vectorCandidate = entryRecord.embedding ?? entryRecord.vector;
  const vector = ensureNumberArray(vectorCandidate);

  if (!vector || vector.length === 0) {
    throw new Error("Сервис эмбеддингов не вернул числовой вектор");
  }

  let usageTokens: number | undefined;
  const usage = body.usage as Record<string, unknown> | undefined;
  const usageValue = usage?.total_tokens;

  if (typeof usageValue === "number" && Number.isFinite(usageValue)) {
    usageTokens = usageValue;
  } else if (typeof usageValue === "string" && usageValue.trim()) {
    const parsedNumber = Number.parseFloat(usageValue);
    if (!Number.isNaN(parsedNumber)) {
      usageTokens = parsedNumber;
    }
  }

  let embeddingId: string | number | undefined;
  if (typeof entryRecord.id === "string" || typeof entryRecord.id === "number") {
    embeddingId = entryRecord.id;
  }

  return { vector, usageTokens, embeddingId };
}

function sanitizeCollectionName(source: string): string {
  const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 60) : "default";
}

function buildWorkspaceScopedCollectionName(workspaceId: string, projectId: string, collectionId: string): string {
  const workspaceSlug = sanitizeCollectionName(workspaceId);
  const projectSlug = sanitizeCollectionName(projectId);
  const collectionSlug = sanitizeCollectionName(collectionId);
  return `ws_${workspaceSlug}__proj_${projectSlug}__coll_${collectionSlug}`;
}

function buildCollectionName(site: Site | undefined, provider: EmbeddingProvider, workspaceId: string): string {
  const projectId = site?.id ?? provider.id;
  return buildWorkspaceScopedCollectionName(workspaceId, projectId, provider.id);
}

function buildKnowledgeCollectionName(
  base: { id?: string | null; name?: string | null } | null | undefined,
  provider: EmbeddingProvider,
  workspaceId: string,
): string {
  const baseId = base?.id;
  if (!baseId) {
    throw new Error("База знаний должна иметь ID для создания коллекции");
  }
  const baseSlug = baseId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase().slice(0, 60) || "default";
  const workspaceSlug = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase().slice(0, 60) || "default";
  return `kb_${baseSlug}_ws_${workspaceSlug}`;
}

function buildKnowledgeCollectionNameFromIds(baseId: string, workspaceId: string): string {
  const baseSlug = sanitizeCollectionName(baseId);
  const workspaceSlug = sanitizeCollectionName(workspaceId);
  return `kb_${baseSlug}_ws_${workspaceSlug}`;
}

function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedDeep(item)) as unknown as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, current]) => current !== undefined)
      .map(([key, current]) => [key, removeUndefinedDeep(current)]);
    return Object.fromEntries(entries) as unknown as T;
  }

  return value;
}

function buildVectorPayload(
  vector: number[],
  _vectorFieldName?: string | null | undefined,
): number[] {
  if (!Array.isArray(vector) || vector.length === 0) {
    return vector;
  }

  const sanitizedVector = vector.map((entry, index) => {
    if (typeof entry !== "number" || Number.isNaN(entry)) {
      throw new Error(`Некорректное значение компоненты вектора (index=${index})`);
    }

    if (!Number.isFinite(entry)) {
      throw new Error(`Компонента вектора содержит бесконечность (index=${index})`);
    }

    return entry;
  });

  return sanitizedVector;
}

function cloneVectorPayload(vector: number[]): number[] {
  return vector.slice();
}

function normalizeBaseUrl(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (error) {
    console.warn(
      `[public-api] Некорректный базовый URL публичного API: ${trimmed}. ${getErrorDetails(error)}`,
    );
    return null;
  }
}

function resolvePublicApiBaseUrl(req: Request): string {
  const candidates = [process.env.PUBLIC_API_BASE_URL, process.env.PUBLIC_RAG_API_BASE_URL];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const forwardedProtoHeader = req.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;
  const protocolCandidate =
    typeof forwardedProto === "string" && forwardedProto.trim().length > 0
      ? forwardedProto.split(",")[0]?.trim()
      : req.protocol;
  const protocol = protocolCandidate && protocolCandidate.length > 0 ? protocolCandidate : "http";
  const host = req.get("host");

  if (!host) {
    throw new Error(
      "Не удалось определить базовый URL публичного API. Укажите PUBLIC_API_BASE_URL в переменных окружения.",
    );
  }

  const parsed = new URL(`${protocol}://${host}`);
  return parsed.toString().replace(/\/$/, "");
}

function normalizeVectorScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function buildCustomPayloadFromSchema(
  fields: CollectionSchemaFieldInput[],
  context: Record<string, unknown>,
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((acc, field) => {
    try {
      const rendered = renderLiquidTemplate(field.template ?? "", context);
      const typedValue = castValueToType(rendered, field.type);
      acc[field.name] = normalizeArrayValue(typedValue, field.isArray);
    } catch (error) {
      console.error(`Не удалось обработать поле схемы "${field.name}"`, error);
      acc[field.name] = null;
    }

    return acc;
  }, {});
}

interface EmbeddingVectorResult {
  vector: number[];
  usageTokens?: number;
  embeddingId?: string | number;
  rawResponse: unknown;
  request: ApiRequestLog;
}

const EMBEDDING_MAX_RETRIES = 3;
const EMBEDDING_RETRY_DELAY_MS = 200;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchEmbeddingVector(
  provider: EmbeddingProvider,
  accessToken: string,
  text: string,
  options?: { onBeforeRequest?: (details: ApiRequestLog) => void },
): Promise<EmbeddingVectorResult> {
  const embeddingHeaders = new Headers();
  embeddingHeaders.set("Content-Type", "application/json");
  embeddingHeaders.set("Accept", "application/json");

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    embeddingHeaders.set(key, value);
  }

  if (!embeddingHeaders.has("Authorization")) {
    embeddingHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const embeddingBody = createEmbeddingRequestBody(provider.model, text);
  const sanitizedHeaders = sanitizeHeadersForLog(embeddingHeaders);

  options?.onBeforeRequest?.({
    url: provider.embeddingsUrl,
    headers: sanitizedHeaders,
    body: embeddingBody,
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= EMBEDDING_MAX_RETRIES; attempt++) {
    let embeddingResponse: FetchResponse | null = null;

    try {
      const requestOptions = applyTlsPreferences<NodeFetchOptions>(
        {
          method: "POST",
          headers: embeddingHeaders,
          body: JSON.stringify(embeddingBody),
        },
        provider.allowSelfSignedCertificate,
      );

      embeddingResponse = await fetch(provider.embeddingsUrl, requestOptions);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastError = new Error(`Failed to call embeddings service: ${errorMessage}`);

      if (attempt < EMBEDDING_MAX_RETRIES) {
        await sleep(EMBEDDING_RETRY_DELAY_MS * attempt);
        continue;
      }

      throw lastError;
    }

    const rawBody = await embeddingResponse.text();
    const parsedBody = parseJson(rawBody);

    if (!embeddingResponse.ok) {
      let message = `Embeddings service returned status ${embeddingResponse.status}`;

      if (parsedBody && typeof parsedBody === "object") {
        const body = parsedBody as Record<string, unknown>;
        if (typeof body.error_description === "string") {
          message = body.error_description;
        } else if (typeof body.message === "string") {
          message = body.message;
        }
      } else if (typeof parsedBody === "string" && parsedBody.trim()) {
        message = parsedBody.trim();
      }

      const isRetryable = embeddingResponse.status === 429 || embeddingResponse.status === 503;
      if (isRetryable && attempt < EMBEDDING_MAX_RETRIES) {
        await sleep(EMBEDDING_RETRY_DELAY_MS * attempt);
        continue;
      }

      throw new Error(`Ошибка на этапе получения вектора: ${message}`);
    }

    const { vector, usageTokens, embeddingId } = extractEmbeddingResponse(parsedBody);

    return {
      vector,
      usageTokens,
      embeddingId,
      rawResponse: parsedBody,
      request: {
        url: provider.embeddingsUrl,
        headers: sanitizedHeaders,
        body: embeddingBody,
      },
    };
  }

  throw lastError ?? new Error("Не удалось получить вектор эмбеддингов");
}

type GenerativeContextEntry = {
  id: string | number;
  payload: Record<string, unknown> | null;
  score?: number | null;
  shard_key?: unknown;
  order_value?: unknown;
};

type GigachatStreamOptions = {
  req: Request;
  res: Response;
  provider: LlmProvider;
  accessToken: string;
  query: string;
  context: LlmContextRecord[];
  sanitizedResults: GenerativeContextEntry[];
  embeddingResult: EmbeddingVectorResult;
  embeddingProvider: EmbeddingProvider;
  selectedModelValue?: string | null;
  selectedModelMeta: LlmModelOption | null;
  limit: number;
  contextLimit: number;
  responseFormat?: RagResponseFormat;
  includeContextInResponse: boolean;
  includeQueryVectorInResponse: boolean;
  collectionName: string;
};

function sendSseEvent(res: Response, eventName: string, data?: unknown) {
  const body =
    typeof data === "string" || data === undefined ? data ?? "" : JSON.stringify(data);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${body}\n\n`);

  const flusher = (res as Response & { flush?: () => void }).flush;
  if (typeof flusher === "function") {
    flusher.call(res);
  }
}

function buildTranscriptPreview(fullText: string, maxWords = 60): string {
  if (!fullText) return "";
  const words = fullText.trim().split(/\s+/);
  if (words.length <= maxWords) {
    return fullText.trim();
  }
  return words.slice(0, maxWords).join(" ");
}

function extractTextDeltaFromChunk(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") {
    return "";
  }

  const record = chunk as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const parts: string[] = [];

  for (const choice of choices) {
    if (!choice || typeof choice !== "object") {
      continue;
    }

    const choiceRecord = choice as Record<string, unknown>;
    const delta = choiceRecord.delta;
    if (delta && typeof delta === "object") {
      const content = (delta as Record<string, unknown>).content;
      if (typeof content === "string") {
        parts.push(content);
      }
    }

    const text = choiceRecord.text;
    if (typeof text === "string") {
      parts.push(text);
    }

    const message = choiceRecord.message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (typeof content === "string") {
        parts.push(content);
      }
    }
  }

  return parts.join("");
}

function extractUsageTokensFromChunk(chunk: unknown): number | null {
  if (!chunk || typeof chunk !== "object") {
    return null;
  }

  const usage = (chunk as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const usageRecord = usage as Record<string, unknown>;
  if (typeof usageRecord.total_tokens === "number") {
    return usageRecord.total_tokens;
  }

  if (typeof usageRecord.completion_tokens === "number") {
    return usageRecord.completion_tokens;
  }

  return null;
}

async function streamGigachatCompletion(options: GigachatStreamOptions): Promise<void> {
  const {
    req,
    res,
    provider,
    accessToken,
    query,
    context,
    sanitizedResults,
    embeddingResult,
    embeddingProvider,
    selectedModelValue,
    selectedModelMeta,
    limit,
    contextLimit,
    responseFormat,
    includeContextInResponse,
    includeQueryVectorInResponse,
    collectionName,
  } = options;

  const streamHeaders = new Headers();
  streamHeaders.set("Content-Type", "application/json");
  streamHeaders.set("Accept", "text/event-stream");

  if (!streamHeaders.has("RqUID")) {
    streamHeaders.set("RqUID", randomUUID());
  }

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    streamHeaders.set(key, value);
  }

  if (!streamHeaders.has("Authorization")) {
    streamHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const requestBody = buildLlmRequestBody(provider, query, context, selectedModelValue ?? undefined, {
    stream: true,
    responseFormat,
  });

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const flushHeaders = (res as Response & { flushHeaders?: () => void }).flushHeaders;
  if (typeof flushHeaders === "function") {
    flushHeaders.call(res);
  }

  const abortController = new AbortController();
  req.on("close", () => {
    abortController.abort();
  });

  const metadataPayload: Record<string, unknown> = {
    usage: { embeddingTokens: embeddingResult.usageTokens ?? null },
    provider: {
      id: provider.id,
      name: provider.name,
      model: selectedModelValue ?? provider.model,
      modelLabel: selectedModelMeta?.label ?? selectedModelValue ?? provider.model,
    },
    embeddingProvider: {
      id: embeddingProvider.id,
      name: embeddingProvider.name,
    },
    limit,
    contextLimit,
    format: responseFormat ?? "text",
    collection: collectionName,
  };

  if (includeContextInResponse) {
    metadataPayload.context = sanitizedResults;
  }

  if (includeQueryVectorInResponse) {
    metadataPayload.queryVector = embeddingResult.vector;
    metadataPayload.vectorLength = embeddingResult.vector.length;
  }

  sendSseEvent(res, "status", { stage: "thinking", message: "Думаю…" });
  sendSseEvent(res, "status", { stage: "retrieving", message: "Ищу источники…" });

  const streamedContextEntries = sanitizedResults.map((entry) => ({
    id: entry.id ?? null,
    score: typeof entry.score === "number" ? entry.score : null,
    payload: entry.payload ?? null,
    shard_key: entry.shard_key ?? null,
    order_value: entry.order_value ?? null,
  }));

  streamedContextEntries.slice(0, contextLimit).forEach((contextEntry, index) => {
    sendSseEvent(res, "source", { index: index + 1, context: contextEntry });
  });

  let completionResponse: FetchResponse;

  try {
    const requestOptions = applyTlsPreferences<NodeFetchOptions>(
      {
        method: "POST",
        headers: streamHeaders,
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      },
      provider.allowSelfSignedCertificate,
    );

    completionResponse = await fetch(provider.completionUrl, requestOptions);
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    sendSseEvent(res, "error", {
      message: `Не удалось выполнить запрос к LLM: ${errorMessage}`,
    });
    res.end();
    return;
  }

  if (!completionResponse.ok) {
    const rawBody = await completionResponse.text();
    let message = `LLM вернул статус ${completionResponse.status}`;

    const parsedBody = parseJson(rawBody);
    if (parsedBody && typeof parsedBody === "object") {
      const body = parsedBody as Record<string, unknown>;
      if (typeof body.error_description === "string") {
        message = body.error_description;
      } else if (typeof body.message === "string") {
        message = body.message;
      }
    } else if (typeof parsedBody === "string" && parsedBody.trim()) {
      message = parsedBody.trim();
    }

    sendSseEvent(res, "error", { message: `Ошибка на этапе генерации ответа: ${message}` });
    res.end();
    return;
  }

  if (!completionResponse.body) {
    sendSseEvent(res, "error", {
      message: "LLM не вернул поток данных",
    });
    res.end();
    return;
  }

  sendSseEvent(res, "status", { stage: "answering", message: "Формулирую ответ…" });

  const decoder = new TextDecoder();
  let buffer = "";
  let aggregatedAnswer = "";
  let llmUsageTokens: number | null = null;

  try {
    for await (const chunk of completionResponse.body as unknown as AsyncIterable<Uint8Array>) {
      if (abortController.signal.aborted) {
        return;
      }

      buffer += decoder.decode(chunk, { stream: true });

      let boundaryIndex = buffer.indexOf("\n\n");
      while (boundaryIndex >= 0) {
        const rawEvent = buffer.slice(0, boundaryIndex).replace(/\r/g, "");
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf("\n\n");

        if (!rawEvent.trim()) {
          continue;
        }

        const lines = rawEvent.split("\n");
        let eventName = "message";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const dataPayload = dataLines.join("\n");
        if (!dataPayload) {
          continue;
        }

        if (dataPayload === "[DONE]") {
          sendSseEvent(res, "status", { stage: "done", message: "Готово" });
          sendSseEvent(res, "done", {
            answer: aggregatedAnswer,
            usage: {
              embeddingTokens: embeddingResult.usageTokens ?? null,
              llmTokens: llmUsageTokens,
            },
            sourcesCount: streamedContextEntries.slice(0, contextLimit).length,
            metadata: metadataPayload,
            provider: metadataPayload.provider ?? null,
            embeddingProvider: metadataPayload.embeddingProvider ?? null,
            collection: collectionName,
            format: responseFormat ?? "text",
          });
          res.end();
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(dataPayload);
        } catch {
          continue;
        }

        const delta = extractTextDeltaFromChunk(parsed);
        if (delta) {
          aggregatedAnswer += delta;
          const normalizedEventName = eventName === "message" ? "delta" : eventName;
          sendSseEvent(res, normalizedEventName === "delta" ? "delta" : normalizedEventName, { text: delta });
        }

        const maybeUsage = extractUsageTokensFromChunk(parsed);
        if (typeof maybeUsage === "number") {
          llmUsageTokens = maybeUsage;
        }
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    sendSseEvent(res, "error", {
      message: `Ошибка при чтении потока LLM: ${errorMessage}`,
    });
    res.end();
    return;
  }

  sendSseEvent(res, "status", { stage: "done", message: "Готово" });
  sendSseEvent(res, "done", {
    answer: aggregatedAnswer,
    usage: {
      embeddingTokens: embeddingResult.usageTokens ?? null,
      llmTokens: llmUsageTokens,
    },
    sourcesCount: streamedContextEntries.slice(0, contextLimit).length,
    metadata: metadataPayload,
    provider: metadataPayload.provider ?? null,
    embeddingProvider: metadataPayload.embeddingProvider ?? null,
    collection: collectionName,
    format: responseFormat ?? "text",
  });
  res.end();
}

const upsertPointsSchema = z.object({
  wait: z.boolean().optional(),
  ordering: z.enum(["weak", "medium", "strong"]).optional(),
  points: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    vector: pointVectorSchema,
    payload: z.record(z.any()).optional(),
  })).min(1),
});

const searchPointsSchema = z.object({
  vector: searchVectorSchema,
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().min(0).optional(),
  filter: z.unknown().optional(),
  params: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  scoreThreshold: z.number().optional(),
  shardKey: z.unknown().optional(),
  consistency: z.union([
    z.number().int().positive(),
    z.literal("majority"),
    z.literal("quorum"),
    z.literal("all"),
  ]).optional(),
  timeout: z.number().positive().optional(),
});

const textSearchPointsSchema = z.object({
  query: z.string().trim().min(1, "Введите поисковый запрос"),
  embeddingProviderId: z.string().trim().min(1, "Укажите сервис эмбеддингов"),
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().min(0).optional(),
  filter: z.unknown().optional(),
  params: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  scoreThreshold: z.number().optional(),
  shardKey: z.unknown().optional(),
  consistency: z.union([
    z.number().int().positive(),
    z.literal("majority"),
    z.literal("quorum"),
    z.literal("all"),
  ]).optional(),
  timeout: z.number().positive().optional(),
});

const generativeSearchPointsSchema = textSearchPointsSchema.extend({
  llmProviderId: z.string().trim().min(1, "Укажите провайдера LLM"),
  llmModel: z.string().trim().min(1, "Укажите модель LLM").optional(),
  contextLimit: z.number().int().positive().max(50).optional(),
  responseFormat: z.string().optional(),
  includeContext: z.boolean().optional(),
  includeQueryVector: z.boolean().optional(),
  llmTemperature: z.coerce.number().min(0).max(2).optional(),
  llmMaxTokens: z.coerce.number().int().min(16).max(4_096).optional(),
  llmSystemPrompt: z.string().optional(),
  llmResponseFormat: z.string().optional(),
});

const publicVectorSearchSchema = searchPointsSchema.extend({
  collection: z.string().trim().min(1, "Укажите коллекцию Qdrant"),
});

const publicVectorizeSchema = z.object({
  text: z.string().trim().min(1, "Текст для векторизации не может быть пустым"),
  embeddingProviderId: z.string().trim().min(1, "Укажите сервис эмбеддингов"),
  collection: z.string().trim().min(1, "Укажите коллекцию Qdrant").optional(),
});

const publicHybridBm25Schema = z
  .object({
    weight: z.coerce.number().min(0).max(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  })
  .optional()
  .default({});

const publicHybridVectorSchema = z
  .object({
    weight: z.coerce.number().min(0).max(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    collection: z.string().trim().min(1).optional(),
    embeddingProviderId: z.string().trim().min(1).optional(),
  })
  .optional()
  .default({});

const publicHybridConfigSchema = z
  .object({
    bm25: publicHybridBm25Schema,
    vector: publicHybridVectorSchema,
  })
  .default({ bm25: {}, vector: {} });

const publicGenerativeSearchSchema = generativeSearchPointsSchema.extend({
  collection: z.string().trim().min(1, "Укажите коллекцию Qdrant"),
  kbId: z.string().trim().min(1, "Укажите базу знаний").optional(),
  topK: z.coerce.number().int().min(1).max(20).optional(),
  hybrid: publicHybridConfigSchema,
  llmTemperature: z.coerce.number().min(0).max(2).optional(),
  llmMaxTokens: z.coerce.number().int().min(16).max(4_096).optional(),
  llmSystemPrompt: z.string().optional(),
  llmResponseFormat: z.string().optional(),
});

const scrollCollectionSchema = z.object({
  limit: z.number().int().positive().max(100).default(20),
  offset: z.union([z.string(), z.number()]).optional(),
  filter: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  orderBy: z.unknown().optional(),
});

const vectorizeCollectionSchemaFieldSchema = z.object({
  name: z.string().trim().min(1, "Укажите название поля").max(120),
  type: z.enum(collectionFieldTypes),
  isArray: z.boolean().optional().default(false),
  template: z.string().default(""),
});

const vectorizeCollectionSchemaSchema = z.object({
  fields: z
    .array(vectorizeCollectionSchemaFieldSchema)
    .max(50, "Слишком много полей в схеме"),
  embeddingFieldName: z.string().trim().min(1).max(120).optional().nullable(),
});

const knowledgeDocumentChunkConfigSchema = z
  .object({
    maxTokens: z.number().int().min(50).max(4_000).optional(),
    maxChars: z.number().int().min(200).max(20_000).optional(),
    overlapTokens: z.number().int().min(0).max(4_000).optional(),
    overlapChars: z.number().int().min(0).max(20_000).optional(),
    splitByPages: z.boolean().optional(),
    respectHeadings: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.maxTokens && !value.maxChars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxTokens"],
        message: "Укажите ограничение по токенам или символам",
      });
    }

    if (value.overlapTokens && value.maxTokens && value.overlapTokens >= value.maxTokens) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overlapTokens"],
        message: "Перехлёст по токенам должен быть меньше лимита",
      });
    }

    if (value.overlapChars && value.maxChars && value.overlapChars >= value.maxChars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overlapChars"],
        message: "Перехлёст по символам должен быть меньше лимита",
      });
    }
  });

const knowledgeDocumentChunkItemSchema = z.object({
  id: z.string().trim().min(1).optional(),
  index: z.coerce.number().int().min(0),
  text: z.string().trim().min(1, "Чанк не может быть пустым"),
  charStart: z.coerce.number().int().min(0).optional(),
  charEnd: z.coerce.number().int().min(0).optional(),
  tokenCount: z.coerce.number().int().min(0).optional(),
  pageNumber: z.coerce.number().int().min(0).optional().nullable(),
  sectionPath: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional(),
  contentHash: z.string().trim().optional(),
  vectorRecordId: z.union([z.string(), z.number()]).optional(),
});

const knowledgeDocumentChunksSchema = z.object({
  chunkSetId: z.string().trim().min(1).optional(),
  documentId: z.string().trim().min(1).optional(),
  versionId: z.string().trim().min(1).optional(),
  items: z.array(knowledgeDocumentChunkItemSchema).min(1),
  totalCount: z.coerce.number().int().min(0).optional(),
  config: knowledgeDocumentChunkConfigSchema.optional(),
});

const vectorizePageSchema = z.object({
  embeddingProviderId: z.string().uuid("Некорректный идентификатор сервиса эмбеддингов").optional(),
  collectionName: z
    .string()
    .trim()
    .min(1, "Укажите название коллекции")
    .optional(),
  createCollection: z.boolean().optional(),
  schema: vectorizeCollectionSchemaSchema.optional(),
});

const vectorizeKnowledgeDocumentSchema = vectorizePageSchema.extend({
  document: z.object({
    id: z.string().trim().min(1, "Укажите идентификатор документа"),
    title: z.string().optional().nullable(),
    text: z.string().trim().min(1, "Документ не может быть пустым"),
    html: z.string().optional().nullable(),
    path: z.string().optional().nullable(),
    sourceUrl: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
    charCount: z.number().int().min(0).optional(),
    wordCount: z.number().int().min(0).optional(),
    excerpt: z.string().optional().nullable(),
    chunks: knowledgeDocumentChunksSchema.optional(),
  }),
  base: z
    .object({
      id: z.string().trim().min(1, "Укажите идентификатор библиотеки"),
      name: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  chunkSize: z.coerce.number().int().min(MIN_CHUNK_SIZE).max(MAX_CHUNK_SIZE).default(800),
  chunkOverlap: z.coerce.number().int().min(0).max(4000).default(0),
});

type KnowledgeDocumentVectorizationJobInternal = KnowledgeDocumentVectorizationJobStatus & {
  workspaceId: string;
  result: KnowledgeDocumentVectorizationJobResult | null;
};

const knowledgeDocumentVectorizationJobs = new Map<string, KnowledgeDocumentVectorizationJobInternal>();
const knowledgeDocumentVectorizationJobCleanup = new Map<string, NodeJS.Timeout>();
const VECTORIZE_JOB_FAILURE_CLEANUP_DELAY_MS = 5_000;

function updateKnowledgeDocumentVectorizationJob(
  jobId: string,
  patch: Partial<KnowledgeDocumentVectorizationJobInternal>,
) {
  const current = knowledgeDocumentVectorizationJobs.get(jobId);
  if (!current) {
    return;
  }

  knowledgeDocumentVectorizationJobs.set(jobId, {
    ...current,
    ...patch,
  });
}

function scheduleKnowledgeDocumentVectorizationJobCleanup(jobId: string, delayMs = 60_000) {
  const existing = knowledgeDocumentVectorizationJobCleanup.get(jobId);
  if (existing) {
    clearTimeout(existing);
  }

  const timeout = setTimeout(() => {
    knowledgeDocumentVectorizationJobs.delete(jobId);
    knowledgeDocumentVectorizationJobCleanup.delete(jobId);
  }, delayMs);

  knowledgeDocumentVectorizationJobCleanup.set(jobId, timeout);
}

const fetchKnowledgeVectorRecordsSchema = z.object({
  collectionName: z.string().trim().min(1, "Укажите коллекцию"),
  recordIds: z
    .array(z.union([z.string().trim().min(1), z.number()]))
    .min(1, "Передайте хотя бы один идентификатор")
    .max(256, "За один запрос можно получить не более 256 записей"),
  includeVector: z.boolean().optional(),
});

const knowledgeSuggestQuerySchema = z.object({
  q: z.string().trim().min(1, "Укажите запрос"),
  kb_id: z.string().trim().min(1, "Укажите базу знаний"),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }

      const numeric = typeof value === "number" ? value : Number.parseInt(String(value), 10);
      if (!Number.isFinite(numeric)) {
        return undefined;
      }

      return numeric;
    }),
});

const knowledgeRagRequestSchema = z.object({
  q: z.string().trim().min(1, "Укажите запрос"),
  original_query_for_embedding: z.string().trim().optional(), // Оригинальный запрос без истории (для embedding)
  kb_id: z.string().trim().min(1, "Укажите базу знаний"),
  kb_ids: z.array(z.string().trim().min(1)).optional(), // Список баз знаний
  top_k: z.coerce.number().int().min(MIN_TOP_K).max(MAX_TOP_K).default(DEFAULT_INDEXING_RULES.topK),
  skill_id: z.string().trim().optional(),
  workspace_id: z.string().trim().optional(),
  conversation_history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      })
    )
    .optional(),
  chat_id: z.string().trim().optional(), // ID чата для кэширования контекста
  collection: z.string().trim().optional(), // Для обратной совместимости
  collections: z.array(z.string().trim().min(1)).optional(), // Список коллекций
  hybrid: z
    .object({
      bm25: z
        .object({
          weight: z.coerce.number().min(0).max(1).optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
        })
        .default({}),
      vector: z
        .object({
          weight: z.coerce.number().min(0).max(1).optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
          collection: z.string().trim().optional(),
          collections: z.array(z.string().trim().min(1)).optional(), // Список коллекций для vector
          embedding_provider_id: z.string().trim().optional(),
        })
        .default({}),
    })
    .default({ bm25: {}, vector: {} }),
  llm: z.object({
    provider: z.string().trim().min(1, "Укажите провайдера LLM"),
    model: z.string().trim().optional(),
    temperature: z.coerce.number().min(0).max(2).optional(),
    max_tokens: z.coerce.number().int().min(16).max(4096).optional(),
    system_prompt: z.string().optional(),
    response_format: z.string().optional(),
  }),
  stream: z.boolean().optional(),
});

type KnowledgeRagRequest = z.infer<typeof knowledgeRagRequestSchema>;

export interface KnowledgeBaseRagCombinedChunk {
  chunkId: string;
  documentId: string;
  docTitle: string;
  sectionTitle: string | null;
  text: string;
  snippet: string;
  bm25Score: number;
  vectorScore: number;
  bm25Normalized: number;
  vectorNormalized: number;
  combinedScore: number;
  nodeId: string | null;
  nodeSlug: string | null;
  knowledgeBaseId?: string; // Добавляем информацию о БЗ
}

interface SanitizedVectorSearchResult {
  id: unknown;
  payload: Record<string, unknown> | null;
  score: number | null;
  shard_key: unknown;
  order_value: unknown;
}

interface KnowledgeBaseRagPipelineSuccess {
  response: {
    query: string;
    knowledgeBaseId: string; // Для обратной совместимости
    knowledgeBaseIds?: string[]; // Новое поле для списка БЗ
    normalizedQuery: string;
    answer: string;
    citations: Array<{
      chunk_id: string;
      doc_id: string;
      doc_title: string;
      section_title: string | null;
      snippet: string;
      score: number;
      scores: { bm25: number; vector: number };
      node_id: string | null;
      node_slug: string | null;
      knowledge_base_id?: string | null; // Добавляем информацию о БЗ
    }>;
    chunks: Array<{
      chunk_id: string;
      doc_id: string;
      doc_title: string;
      section_title: string | null;
      snippet: string;
      text: string;
      score: number;
      scores: { bm25: number; vector: number };
      node_id: string | null;
      node_slug: string | null;
      knowledge_base_id?: string | null; // Добавляем информацию о БЗ
    }>;
    usage: { embeddingTokens: number | null; llmTokens: number | null };
    timings: {
      total_ms: number;
      retrieval_ms: number;
      bm25_ms: number;
      vector_ms: number;
      llm_ms: number;
    };
    debug: { vectorSearch: Array<Record<string, unknown>> | null };
    responseFormat: RagResponseFormat;
  };
  metadata: {
    pipelineLog: KnowledgeBaseAskAiPipelineStepLog[];
    workspaceId: string;
    embeddingProvider: EmbeddingProvider | null;
    embeddingResult: EmbeddingVectorResult | null;
    llmProvider: LlmProvider;
    llmModel: string | null;
    llmModelLabel: string | null;
    sanitizedVectorResults: SanitizedVectorSearchResult[];
    bm25Sections: Array<KnowledgeChunkSearchEntry>;
    bm25Weight: number;
    bm25Limit: number;
    vectorWeight: number;
    vectorLimit: number;
    vectorCollection: string | null;
    vectorResultCount: number | null;
    vectorDocumentCount: number | null;
    combinedResultCount: number | null;
    embeddingUsageTokens: number | null;
    llmUsageTokens: number | null;
    retrievalDuration: number | null;
    bm25Duration: number | null;
    vectorDuration: number | null;
    llmDuration: number | null;
    totalDuration: number | null;
    normalizedQuery: string;
    combinedResults: KnowledgeBaseRagCombinedChunk[];
  };
}

type KnowledgeBaseRagPipelineStream = {
  onEvent: (eventName: string, payload?: unknown) => void;
};

export function resolveEffectiveRetrievalParams(options: {
  bodyTopK?: number | null;
  rulesTopK: number;
  rulesRelevanceThreshold: number;
  hasExplicitTopKOverride: boolean;
  skillId?: string | null;
}): { topK: number; minScore: number } {
  const clampedRulesTopK = Math.min(Math.max(options.rulesTopK, MIN_TOP_K), MAX_TOP_K);
  const allowRequestOverride = options.hasExplicitTopKOverride && !options.skillId;
  const requestedTopK = typeof options.bodyTopK === "number" ? options.bodyTopK : null;
  const resolvedTopK = allowRequestOverride ? requestedTopK ?? clampedRulesTopK : clampedRulesTopK;
  const topK = Math.min(Math.max(resolvedTopK, MIN_TOP_K), MAX_TOP_K);
  const minScore = Math.min(
    Math.max(options.rulesRelevanceThreshold ?? MIN_RELEVANCE_THRESHOLD, MIN_RELEVANCE_THRESHOLD),
    MAX_RELEVANCE_THRESHOLD,
  );

  return { topK, minScore };
}

export function resolveAllowSources(options: {
  rulesCitationsEnabled: boolean;
  skillShowSources?: boolean | null;
}): boolean {
  const globalAllowed = Boolean(options.rulesCitationsEnabled);
  if (!globalAllowed) {
    return false;
  }
  if (options.skillShowSources === false) {
    return false;
  }
  return true;
}

export function applyRetrievalPostProcessing(options: {
  combinedResults: KnowledgeBaseRagCombinedChunk[];
  topK: number;
  minScore: number;
  maxContextTokens?: number | null;
  estimateTokens: (text: string) => number;
}): { combinedResults: KnowledgeBaseRagCombinedChunk[]; rawCombinedResults: KnowledgeBaseRagCombinedChunk[] } {
  const rawCombinedResults = [...options.combinedResults];
  let processedResults = [...options.combinedResults];

  if (options.minScore > 0) {
    const filtered = processedResults.filter((item) => item.combinedScore >= options.minScore);
    if (filtered.length > 0) {
      processedResults = filtered;
    }
  }

  const clampedTopK = Math.min(Math.max(options.topK, MIN_TOP_K), MAX_TOP_K);
  processedResults = processedResults.slice(0, clampedTopK);

  if (processedResults.length === 0 && rawCombinedResults.length > 0) {
    processedResults = rawCombinedResults.slice(0, Math.max(1, clampedTopK));
  }

  if (options.maxContextTokens && options.maxContextTokens > 0 && processedResults.length > 0) {
    const limited: KnowledgeBaseRagCombinedChunk[] = [];
    let usedTokens = 0;
    for (const item of processedResults) {
      const tokens = options.estimateTokens(item.text);
      if (limited.length > 0 && usedTokens + tokens > options.maxContextTokens) {
        break;
      }
      limited.push(item);
      usedTokens += tokens;
      if (usedTokens >= options.maxContextTokens) {
        break;
      }
    }
    if (limited.length > 0) {
      processedResults = limited;
    }
  }

  return { combinedResults: processedResults, rawCombinedResults };
}

function forwardLlmStreamEvents(
  iterator: AsyncIterable<LlmStreamEvent>,
  emit: (eventName: string, payload?: unknown) => void,
) {
  return (async () => {
    const startTime = Date.now();
    let chunkCount = 0;
    let lastChunkTime = startTime;
    let firstChunkTime: number | null = null;

    for await (const entry of iterator) {
      chunkCount++;
      const currentTime = Date.now();
      
      if (firstChunkTime === null) {
        firstChunkTime = currentTime;
        const timeToFirstChunk = currentTime - startTime;
        console.log(`[RAG STREAM] First chunk received after ${timeToFirstChunk}ms`);
      }
      
      const timeSinceLastChunk = currentTime - lastChunkTime;
      lastChunkTime = currentTime;
      
      console.log(`[RAG STREAM] Chunk #${chunkCount} (О"${timeSinceLastChunk}ms):`, 
        JSON.stringify(entry.data).slice(0, 100));
      
      const eventName = entry.event || "delta";
      emit(eventName, entry.data);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`[RAG STREAM] Stream completed: ${chunkCount} chunks in ${totalTime}ms`);
  })();
}

async function runKnowledgeBaseRagPipeline(options: {
  req: Request;
  body: KnowledgeRagRequest;
  stream?: KnowledgeBaseRagPipelineStream | null;
  }): Promise<KnowledgeBaseRagPipelineSuccess> {
    const { req, body, stream } = options;
    const skillIdCandidate = typeof body.skill_id === "string" ? body.skill_id.trim() : "";
    const normalizedSkillId = skillIdCandidate.length > 0 ? skillIdCandidate : null;
  
    const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  const normalizeCollectionList = (list?: readonly string[] | null): string[] => {
    if (!list) {
      return [];
    }
    const unique = new Set<string>();
    for (const entry of list) {
      if (typeof entry !== "string") {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length > 0) {
        unique.add(trimmed);
        }
      }
      return Array.from(unique);
    };
  
    const hasExplicitTopKOverride = Object.prototype.hasOwnProperty.call(req.body ?? {}, "top_k");
    const indexingRules = await indexingRulesService.getIndexingRules();
    const retrievalParams = resolveEffectiveRetrievalParams({
      bodyTopK: body.top_k,
      rulesTopK: indexingRules.topK,
      rulesRelevanceThreshold: indexingRules.relevanceThreshold,
      hasExplicitTopKOverride,
      skillId: normalizedSkillId,
    });

    let effectiveTopK = retrievalParams.topK;
    let effectiveMinScore = retrievalParams.minScore;
    let effectiveMaxContextTokens: number | null = indexingRules.maxContextTokens;
    
    // Получаем настройки навыка для allowSources и кэширования
    let skillShowSources: boolean | null = null;
    let enableContextCaching: boolean | null = null;
    let contextCacheTtlSeconds: number | null = null;
    if (normalizedSkillId) {
      try {
        const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id.trim() : null;
        if (workspaceId) {
          const skill = await getSkillById(workspaceId, normalizedSkillId);
          if (skill) {
            skillShowSources = skill.ragConfig?.showSources ?? null;
            enableContextCaching = skill.ragConfig?.enableContextCaching ?? null;
            contextCacheTtlSeconds = skill.ragConfig?.contextCacheTtlSeconds ?? null;
            logger.info({
              component: 'RAG_PIPELINE',
              step: 'skill_config_check',
              skillId: normalizedSkillId,
              workspaceId,
              skillShowSources,
              enableContextCaching,
              contextCacheTtlSeconds,
              ragConfig: skill.ragConfig,
            }, '[RAG] Skill config loaded for showSources and caching check');
          }
        }
      } catch (error) {
        logger.warn({
          component: 'RAG_PIPELINE',
          step: 'skill_config_check',
          error: error instanceof Error ? error.message : String(error),
        }, '[RAG] Failed to load skill for showSources and caching check');
      }
    }
    
    let allowSources = resolveAllowSources({ 
      rulesCitationsEnabled: indexingRules.citationsEnabled,
      skillShowSources,
    });
    
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'allow_sources_resolution',
      indexingRulesCitationsEnabled: indexingRules.citationsEnabled,
      skillShowSources,
      allowSources,
      skillId: normalizedSkillId,
    }, '[RAG] allowSources resolved');
    
    let skillCollectionFilter: string[] = [];

  const pipelineLog: KnowledgeBaseAskAiPipelineStepLog[] = [];
  const emitStreamEvent = (eventName: string, payload?: unknown) => {
    if (!stream?.onEvent) {
      return;
    }
    try {
      stream.onEvent(eventName, payload);
    } catch (eventError) {
      console.error(
        `[public/rag/answer] Не удалось отправить событие ${eventName}: ${getErrorDetails(eventError)}`,
      );
    }
  };
  const emitStreamStatus = (stage: string, message: string) => {
    emitStreamEvent("status", { stage, message });
  };
  const query = body.q.trim(); // Расширенный запрос с историей (для LLM)
  // Для embedding используем оригинальный запрос без истории (чтобы не превысить лимит токенов провайдера)
  const queryForEmbedding = typeof body.original_query_for_embedding === "string" && body.original_query_for_embedding.trim().length > 0
    ? body.original_query_for_embedding.trim()
    : query; // Fallback на query, если original_query_for_embedding не указан
  // Поддержка нескольких БЗ: используем kb_ids если есть, иначе fallback на kb_id
  const knowledgeBaseIds = Array.isArray(body.kb_ids) && body.kb_ids.length > 0
    ? body.kb_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : typeof body.kb_id === "string" && body.kb_id.trim().length > 0
      ? [body.kb_id.trim()]
      : [];
  
  if (knowledgeBaseIds.length === 0) {
    throw new HttpError(400, "Не указана база знаний");
  }
  
  const knowledgeBaseId = knowledgeBaseIds[0]; // Для обратной совместимости
  const wantsLlmStream = Boolean(stream);
  
  logger.info({
    component: 'RAG_PIPELINE',
    step: 'start',
    query: query.slice(0, 100),
    queryLength: query.length,
    queryForEmbedding: queryForEmbedding.slice(0, 100),
    queryForEmbeddingLength: queryForEmbedding.length,
    hasOriginalQueryForEmbedding: typeof body.original_query_for_embedding === "string" && body.original_query_for_embedding.trim().length > 0,
    kb_ids: knowledgeBaseIds,
    skill_id: normalizedSkillId,
    workspace_id: typeof body.workspace_id === "string" ? body.workspace_id : null,
    top_k: body.top_k,
    effectiveTopK,
    effectiveMinScore,
    hasStream: !!stream,
    wantsLlmStream,
    collections: Array.isArray(body.collections) ? body.collections : [body.collection].filter(Boolean),
  }, `[RAG PIPELINE] START: query=${query.length} chars, embeddingQuery=${queryForEmbedding.length} chars, kb_ids=[${knowledgeBaseIds.join(", ")}]`);

  if (!query) {
    throw new HttpError(400, "Укажите поисковый запрос");
  }

  emitStreamStatus("thinking", "Анализирую запрос…");
  const runStartedAt = new Date();
  let runStatus: "success" | "error" = "success";
  let runErrorMessage: string | null = null;
  let workspaceId: string | null = null;
  let normalizedQuery = query;

  let bm25Limit = body.hybrid.bm25.limit ?? effectiveTopK;
  let vectorLimit = body.hybrid.vector.limit ?? effectiveTopK;
  const recomputeLimits = () => {
    bm25Limit = body.hybrid.bm25.limit ?? effectiveTopK;
    vectorLimit = body.hybrid.vector.limit ?? effectiveTopK;
  };

  const requestedEmbeddingProviderId =
    typeof body.hybrid.vector.embedding_provider_id === "string"
      ? body.hybrid.vector.embedding_provider_id.trim()
      : "";
  
  // Поддержка нескольких коллекций: используем collections если есть, иначе fallback на collection
  const requestedVectorCollections = Array.isArray(body.hybrid?.vector?.collections) && body.hybrid.vector.collections.length > 0
    ? body.hybrid.vector.collections.filter((col): col is string => typeof col === "string" && col.trim().length > 0)
    : Array.isArray(body.collections) && body.collections.length > 0
      ? body.collections.filter((col): col is string => typeof col === "string" && col.trim().length > 0)
      : typeof body.hybrid.vector.collection === "string" && body.hybrid.vector.collection.trim().length > 0
        ? [body.hybrid.vector.collection.trim()]
        : typeof body.collection === "string" && body.collection.trim().length > 0
          ? [body.collection.trim()]
          : [];
  
  const requestedVectorCollection = requestedVectorCollections.length > 0 ? requestedVectorCollections[0] : "";
  const bm25WeightOverride = body.hybrid.bm25.weight;
  const vectorWeightOverride = body.hybrid.vector.weight;
  const hasBm25WeightOverride = bm25WeightOverride !== undefined;
  const hasVectorWeightOverride = vectorWeightOverride !== undefined;

  let embeddingProviderId = requestedEmbeddingProviderId || null;
  let vectorCollection = requestedVectorCollection || null;
  let vectorConfigured = Boolean(embeddingProviderId && vectorCollection);
  console.log(`[RAG PIPELINE] embeddingProviderId=${embeddingProviderId}, vectorCollection=${vectorCollection}, vectorConfigured=${vectorConfigured}`);

  let bm25Weight = hasBm25WeightOverride
    ? bm25WeightOverride!
    : vectorConfigured
      ? 0.5
      : 1;
  let vectorWeight = hasVectorWeightOverride
    ? vectorWeightOverride!
    : vectorConfigured
      ? 0.5
      : 0;

  let bm25Duration: number | null = null;
  let vectorDuration: number | null = null;
  let retrievalDuration: number | null = null;
  let llmDuration: number | null = null;
  let totalDuration: number | null = null;

  let embeddingUsageTokens: number | null = null;
  let embeddingUsageMeasurement: ReturnType<typeof measureTokensForModel> | null = null;
  let llmUsageTokens: number | null = null;

  let bm25ResultCount: number | null = null;
  let vectorResultCount: number | null = null;
  let vectorDocumentCount: number | null = null;
  let combinedResultCount: number | null = null;

  let vectorSearchDetails: Array<Record<string, unknown>> | null = null;

  const vectorDocumentIds = new Set<string>();
  const vectorChunks: Array<{
    chunkId: string;
    score: number;
    recordId: string | null;
    payload: Record<string, unknown> | null;
  }> = [];
  const sanitizedVectorResults: SanitizedVectorSearchResult[] = [];
  const aggregatedVectorResults: Array<{ collection: string; record: Record<string, unknown> }> = [];
  let vectorCollectionsToSearch: string[] = [];

  let llmProviderId = body.llm.provider?.trim() || null;
  let llmModel = body.llm.model?.trim() || null;
  let llmModelLabel: string | null = null;
  let llmModelInfo: ModelInfoForUsage | null = null;

  let selectedEmbeddingProvider: EmbeddingProvider | null = null;
  let embeddingResultForMetadata: EmbeddingVectorResult | null = null;

  const startPipelineStep = (
    key: string,
    input: Record<string, unknown> | null,
    title: string,
  ) => {
    const step: KnowledgeBaseAskAiPipelineStepLog = {
      key,
      title,
      status: "success",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: null,
      input: input ? removeUndefinedDeep(input) : null,
      output: null,
      error: null,
    };
    pipelineLog.push(step);
    const startedAt = performance.now();
    return {
      setInput(nextInput?: Record<string, unknown> | null) {
        step.input = nextInput ? removeUndefinedDeep(nextInput) : null;
      },
      finish(output?: Record<string, unknown> | null) {
        step.finishedAt = new Date().toISOString();
        step.durationMs = Number((performance.now() - startedAt).toFixed(2));
        step.output = output ? removeUndefinedDeep(output) : null;
      },
      fail(error: unknown) {
        step.finishedAt = new Date().toISOString();
        step.durationMs = Number((performance.now() - startedAt).toFixed(2));
        step.status = "error";
        step.error = getErrorDetails(error);
      },
    };
  };

  const skipPipelineStep = (key: string, title: string, reason: string) => {
    pipelineLog.push({
      key,
      title,
      status: "skipped",
      startedAt: null,
      finishedAt: null,
      durationMs: null,
      input: { reason },
      output: null,
      error: null,
    });
  };

  const finalizeRunLog = async () => {
    if (!workspaceId) {
      return;
    }

    const toNumber = (value: number | null) =>
      value === null ? null : Number(value.toFixed(2));
    const totalTokens =
      embeddingUsageTokens === null && llmUsageTokens === null
        ? null
        : (embeddingUsageTokens ?? 0) + (llmUsageTokens ?? 0);

    try {
      await storage.recordKnowledgeBaseAskAiRun({
        workspaceId,
        knowledgeBaseId,
        prompt: query,
        normalizedQuery,
        status: runStatus,
        errorMessage: runErrorMessage,
        topK: effectiveTopK ?? null,
        bm25Weight,
        bm25Limit,
        vectorWeight,
        vectorLimit: vectorConfigured ? vectorLimit : null,
        vectorCollection: vectorConfigured ? vectorCollection : null,
        embeddingProviderId: vectorConfigured ? embeddingProviderId : null,
        llmProviderId,
        llmModel,
        bm25ResultCount,
        vectorResultCount,
        vectorDocumentCount,
        combinedResultCount,
        embeddingTokens: embeddingUsageTokens,
        llmTokens: llmUsageTokens,
        totalTokens,
        retrievalDurationMs: toNumber(retrievalDuration),
        bm25DurationMs: toNumber(bm25Duration),
        vectorDurationMs: vectorResultCount !== null ? toNumber(vectorDuration) : null,
        llmDurationMs:
          llmUsageTokens !== null || (llmDuration !== null && llmDuration > 0)
            ? toNumber(llmDuration)
            : null,
        totalDurationMs: toNumber(totalDuration),
        startedAt: runStartedAt.toISOString(),
        pipelineLog,
      });
    } catch (logError) {
      console.error(
        `[public/rag/answer] Не удалось сохранить журнал выполнения Ask AI: ${getErrorDetails(
          logError,
        )}`,
        { workspaceId, knowledgeBaseId },
      );
    }
  };

  try {
    // Проверяем, что все БЗ существуют и принадлежат одному workspace
    const bases = await Promise.all(
      knowledgeBaseIds.map((kbId) => storage.getKnowledgeBase(kbId)),
    );
    
    const missingBases = bases.filter((base) => !base);
    if (missingBases.length > 0) {
      runStatus = "error";
      runErrorMessage = "Одна или несколько баз знаний не найдены";
      await finalizeRunLog();
      throw new HttpError(404, "Одна или несколько баз знаний не найдены");
    }
    
    const allBases = bases.filter((base): base is NonNullable<typeof base> => base !== null);
    const workspaceIds = new Set(allBases.map((base) => base.workspaceId));
    
    if (workspaceIds.size !== 1) {
      runStatus = "error";
      runErrorMessage = "Все базы знаний должны принадлежать одному рабочему пространству";
      await finalizeRunLog();
      throw new HttpError(400, "Все базы знаний должны принадлежать одному рабочему пространству");
    }
    
    workspaceId = allBases[0].workspaceId;

    if (normalizedSkillId) {
      const skill = await getSkillById(workspaceId, normalizedSkillId);
      if (!skill) {
        runStatus = "error";
        runErrorMessage = "пїЅ?пїЅпїЅпїЅ?пїЅ<пїЅпїЅ пїЅ?пїЅпїЅ пїЅ?пїЅпїЅпїЅпїЅпїЅ?пїЅпїЅ?";
        await finalizeRunLog();
        throw new HttpError(404, "пїЅ?пїЅпїЅпїЅ?пїЅ<пїЅпїЅ пїЅ?пїЅпїЅ пїЅ?пїЅпїЅпїЅпїЅпїЅ?пїЅпїЅ?");
      }

      if (skill.isSystem && skill.systemKey === UNICA_CHAT_SYSTEM_KEY) {

        // TODO(forlandeivan): apply global Unica Chat config when selecting LLM/prompt.

      }


      // Стандартный режим: не подмешиваем ragConfig из навыка, используем только правила/входные параметры.
      skillCollectionFilter = [];
    }

    // Поддержка нескольких коллекций: используем requestedVectorCollections если есть
    vectorCollectionsToSearch =
      skillCollectionFilter.length > 0
        ? skillCollectionFilter
        : requestedVectorCollections.length > 0
          ? requestedVectorCollections
          : requestedVectorCollection
            ? [requestedVectorCollection]
            : [];
    // TODO: validate that selected collections belong to the current workspace/knowledge base.

    vectorCollection =
      vectorCollectionsToSearch.length > 0 ? vectorCollectionsToSearch.join(", ") : null;

    if (normalizedSkillId && vectorCollectionsToSearch.length > 0) {
      const expectedCollections = knowledgeBaseIds.map((kbId) =>
        buildKnowledgeCollectionNameFromIds(kbId, workspaceId),
      );
      const collectionsToRegister = vectorCollectionsToSearch.filter((collection) =>
        expectedCollections.includes(collection),
      );
      if (collectionsToRegister.length > 0) {
        await Promise.all(
          collectionsToRegister.map((collection) =>
            storage.upsertCollectionWorkspace(collection, workspaceId),
          ),
        );
      }
    }

    vectorConfigured = Boolean(vectorCollectionsToSearch.length > 0 && embeddingProviderId);
    if (normalizedSkillId && vectorCollectionsToSearch.length === 0 && embeddingProviderId) {
      vectorCollectionsToSearch = ["__skill_file_autoselect__"];
      vectorCollection = vectorCollectionsToSearch[0];
      vectorConfigured = true;
    }
    // Если используется векторный поиск, но веса не заданы явно - используем только векторный поиск (bm25Weight=0, vectorWeight=1.0)
    // Если векторный поиск не настроен - используем только BM25 (bm25Weight=1.0, vectorWeight=0)
    if (vectorConfigured) {
      if (!hasVectorWeightOverride && !hasBm25WeightOverride) {
        // По умолчанию: только векторный поиск, BM25 отключен
        bm25Weight = 0;
        vectorWeight = 1.0;
      } else if (!hasVectorWeightOverride) {
        vectorWeight = 1.0 - bm25Weight;
      } else if (!hasBm25WeightOverride) {
        bm25Weight = 1.0 - vectorWeight;
      }
    } else {
      // Векторный поиск не настроен - используем только BM25
      vectorWeight = 0;
      if (!hasBm25WeightOverride) {
        bm25Weight = 1.0;
      }
    }

    if (vectorCollectionsToSearch.length > 0) {
      console.log("[RAG PIPELINE] Vector collections selected:", vectorCollectionsToSearch);
    }

    const weightSum = bm25Weight + vectorWeight;
    if (weightSum > 0) {
      bm25Weight /= weightSum;
      vectorWeight /= weightSum;
    } else {
      bm25Weight = 1;
      vectorWeight = 0;
    }
    
    // Логирование конфигурации поиска
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'search_config',
      query: query.substring(0, 100),
      bm25Weight,
      bm25Limit,
      vectorWeight,
      vectorLimit,
      effectiveTopK,
      effectiveMinScore,
      effectiveMaxContextTokens,
      embeddingProviderId,
      vectorCollections: vectorCollectionsToSearch,
      knowledgeBaseIds,
    }, `[RAG] Search config: BM25(${bm25Weight.toFixed(2)}, limit=${bm25Limit}) + Vector(${vectorWeight.toFixed(2)}, limit=${vectorLimit}), topK=${effectiveTopK}, minScore=${effectiveMinScore}`);

    // Context Caching: проверяем cache hit перед retrieval
    const chatId = typeof body.chat_id === "string" ? body.chat_id.trim() : null;
    const workspaceIdForCache = typeof body.workspace_id === "string" ? body.workspace_id.trim() : null;
    let cacheHit = false;
    let cachedCombinedResults: KnowledgeBaseRagCombinedChunk[] | null = null;

    if (enableContextCaching && chatId && workspaceIdForCache) {
      try {
        // Инициализируем кэш для чата
        getOrCreateCache(chatId, workspaceIdForCache, contextCacheTtlSeconds ?? undefined);
        
        // Проверяем, есть ли похожий кэшированный результат
        const cachedResult = findSimilarCachedRetrieval(
          chatId,
          query,
          undefined, // embeddingVector ещё не вычислен
          0.85
        );
        
        if (cachedResult && cachedResult.chunks.length > 0) {
          cacheHit = true;
          // Преобразуем кэшированные chunks в KnowledgeBaseRagCombinedChunk[]
          cachedCombinedResults = cachedResult.chunks.map((chunk) => ({
            chunkId: chunk.chunk_id,
            documentId: chunk.doc_id,
            docTitle: chunk.doc_title,
            sectionTitle: chunk.section_title,
            snippet: chunk.snippet,
            text: chunk.text ?? chunk.snippet,
            bm25Score: chunk.scores?.bm25 ?? 0,
            vectorScore: chunk.scores?.vector ?? 0,
            nodeId: chunk.node_id ?? null,
            nodeSlug: chunk.node_slug ?? null,
            knowledgeBaseId: chunk.knowledge_base_id ?? undefined,
            combinedScore: chunk.score,
            bm25Normalized: 0,
            vectorNormalized: 0,
          }));
          
          logger.info({
            component: 'RAG_PIPELINE',
            step: 'context_cache_hit',
            chatId,
            query: query.substring(0, 100),
            cachedChunksCount: cachedCombinedResults.length,
          }, '[RAG CACHE] Cache hit, using cached retrieval results');
        }
      } catch (error) {
        logger.warn({
          component: 'RAG_PIPELINE',
          step: 'context_cache_hit_error',
          chatId,
          error: error instanceof Error ? error.message : String(error),
        }, '[RAG CACHE] Cache hit check failed, proceeding with retrieval');
      }
    }

    const totalStart = performance.now();
    emitStreamStatus("retrieving", cacheHit ? "Использую кэш…" : "Ищу источники…");
    const retrievalStart = performance.now();
    const suggestionLimit = Math.max(bm25Limit, vectorLimit, effectiveTopK);

    type SuggestSections = Awaited<
      ReturnType<typeof storage.searchKnowledgeBaseSuggestions>
    >["sections"];
    let bm25Sections: SuggestSections = [];

    // BM25 поиск выполняется только если bm25Weight > 0 И нет cache hit
    if (bm25Weight > 0 && !cacheHit) {
      const bm25Step = startPipelineStep(
        "bm25_search",
        { limit: suggestionLimit, weight: bm25Weight, knowledgeBaseIds },
        "BM25 поиск",
      );
      const bm25Start = performance.now();
      try {
        // Для BM25 используем оригинальный запрос (без истории), чтобы избежать проблем с длинными запросами
        const bm25Query = queryForEmbedding !== query ? queryForEmbedding : query;
        
        // Выполняем BM25 поиск по всем выбранным БЗ и объединяем результаты
        const bm25ResultsPromises = knowledgeBaseIds.map((kbId) =>
          storage.searchKnowledgeBaseSuggestions(kbId, bm25Query, suggestionLimit),
        );
        const bm25Results = await Promise.all(bm25ResultsPromises);
        
        bm25Duration = performance.now() - bm25Start;
        
        // Используем normalizedQuery из первого результата
        normalizedQuery = bm25Results[0]?.normalizedQuery || bm25Query;
        
        // Объединяем результаты из всех БЗ
        const allBm25Sections: SuggestSections = [];
        for (let i = 0; i < bm25Results.length; i++) {
          const kbId = knowledgeBaseIds[i];
          const sections = bm25Results[i]?.sections
            .filter((entry) => entry.source === "content")
            .map((entry) => ({
              ...entry,
              // Добавляем информацию о БЗ для идентификации источника
              knowledgeBaseId: kbId,
            }));
          allBm25Sections.push(...sections);
        }
        
        // Сортируем по релевантности и берем топ результатов
        allBm25Sections.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        bm25Sections = allBm25Sections.slice(0, bm25Limit);
        bm25ResultCount = bm25Sections.length;
        
        bm25Step.finish({
          normalizedQuery,
          candidates: bm25ResultCount,
          knowledgeBasesSearched: knowledgeBaseIds.length,
        });
        
        // Логирование результатов BM25
        logger.info({
          component: 'RAG_PIPELINE',
          step: 'bm25_results',
          query: bm25Query.substring(0, 100),
          normalizedQuery: normalizedQuery.substring(0, 100),
          originalQueryLength: queryForEmbedding.length,
          enhancedQueryLength: query.length,
          usingOriginalQuery: bm25Query !== query,
          resultCount: bm25ResultCount,
          durationMs: Math.round(bm25Duration),
          knowledgeBaseIds,
          topScores: bm25Sections.slice(0, 5).map(s => ({
            score: s.score,
            docTitle: ((s as any).docTitle || (s as any).doc_title || '').substring(0, 50),
            chunkId: (s as any).chunkId || (s as any).chunk_id,
          })),
        }, `[RAG] BM25 search completed: ${bm25ResultCount} results in ${Math.round(bm25Duration)}ms (using ${bm25Query !== query ? 'original' : 'enhanced'} query)`);
      } catch (error) {
        bm25Duration = performance.now() - bm25Start;
        bm25Step.fail(error);
        logger.error({
          component: 'RAG_PIPELINE',
          step: 'bm25_error',
          error: error instanceof Error ? error.message : String(error),
          durationMs: Math.round(bm25Duration),
        }, `[RAG] BM25 search failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    } else {
      skipPipelineStep(
        "bm25_search",
        "BM25 поиск",
        "BM25 поиск отключён (bm25Weight=0)",
      );
      // Если BM25 пропущен, используем оригинальный запрос для normalizedQuery
      normalizedQuery = queryForEmbedding !== query ? queryForEmbedding : query;
      bm25ResultCount = 0;
      
      logger.info({
        component: 'RAG_PIPELINE',
        step: 'bm25_skipped',
        reason: cacheHit ? 'cache_hit' : 'bm25_weight_zero',
        bm25Weight,
        cacheHit,
      }, `[RAG] BM25 search skipped: ${cacheHit ? 'cache hit' : 'bm25Weight=0'}`);
    }

    // Векторный поиск выполняется только если vectorWeight > 0 И нет cache hit
    if (vectorWeight > 0 && !cacheHit) {
      const vectorStep = startPipelineStep(
        "vector_search",
        {
          limit: vectorLimit,
          collection: vectorCollection,
          embeddingProviderId,
        },
        "Векторный поиск",
      );
      const vectorStart = performance.now();
      try {
        const embeddingProvider = await storage.getEmbeddingProvider(
          embeddingProviderId!,
          workspaceId,
        );

        if (!embeddingProvider) {
          throw new HttpError(404, "Сервис эмбеддингов не найден");
        }

        if (!embeddingProvider.isActive) {
          throw new HttpError(400, "Выбранный сервис эмбеддингов отключён");
        }

        embeddingProviderId = embeddingProvider.id;
        selectedEmbeddingProvider = embeddingProvider;

        // Для embedding ВСЕГДА используем queryForEmbedding (оригинальный запрос без истории)
        // Это гарантирует, что мы не превысим лимит токенов провайдера embedding
        // queryForEmbedding берётся из body.original_query_for_embedding (переписанный запрос без истории)
        // или fallback на query если original_query_for_embedding не указан
        const embeddingQuery = queryForEmbedding;
        
        const embeddingStep = startPipelineStep(
          "vector_embedding",
          {
            providerId: embeddingProvider.id,
            model: embeddingProvider.model,
            text: embeddingQuery,
            originalQueryLength: queryForEmbedding.length,
            enhancedQueryLength: query.length,
            usingOriginalQuery: embeddingQuery !== query,
          },
          "Векторизация запроса",
        );

        let embeddingResult: EmbeddingVectorResult;
        try {
          const embeddingInputTokens = estimateTokens(embeddingQuery);
          try {
            const embeddingModel = embeddingProvider.model 
              ? await tryResolveModel(embeddingProvider.model, { expectedType: "EMBEDDINGS" })
              : null;
            await ensureCreditsForEmbeddingPreflight(workspaceId, {
              consumptionUnit: "TOKENS_1K",
              modelKey: embeddingProvider.model ?? null,
              id: embeddingModel?.id ?? null,
              creditsPerUnit: embeddingModel?.creditsPerUnit ?? 0,
            }, embeddingInputTokens);
          } catch (error) {
            if (error instanceof InsufficientCreditsError) {
              throw new HttpError(error.status, error.message, error.details);
            }
            throw error;
          }

          const embeddingAccessToken = await fetchAccessToken(embeddingProvider);
          embeddingResult = await fetchEmbeddingVector(
            embeddingProvider,
            embeddingAccessToken,
            embeddingQuery, // Используем оригинальный запрос без истории
            {
              onBeforeRequest(details) {
                embeddingStep.setInput({
                  providerId: embeddingProvider.id,
                  model: embeddingProvider.model,
                  text: embeddingQuery, // Используем оригинальный запрос
                  request: details,
                });
              },
            },
          );
          embeddingUsageTokens = embeddingResult.usageTokens ?? null;
          const embeddingTokensForUsage = embeddingUsageTokens ?? estimateTokens(embeddingQuery);
          embeddingUsageMeasurement = measureTokensForModel(embeddingTokensForUsage, {
            consumptionUnit: "TOKENS_1K",
            modelKey: embeddingProvider.model ?? null,
          });
          embeddingResultForMetadata = embeddingResult;
          embeddingStep.finish({
            usageTokens: embeddingUsageTokens,
            usageUnits: embeddingUsageMeasurement?.quantityUnits ?? null,
            usageUnit: embeddingUsageMeasurement?.unit ?? null,
            embeddingId: embeddingResult.embeddingId ?? null,
            vectorDimensions: embeddingResult.vector.length,
            response: embeddingResult.rawResponse,
          });
          
          // Логирование embedding
          logger.info({
            component: 'RAG_PIPELINE',
            step: 'embedding_generated',
            query: embeddingQuery.substring(0, 100),
            originalQueryLength: queryForEmbedding.length,
            enhancedQueryLength: query.length,
            usingOriginalQuery: embeddingQuery !== query,
            providerId: embeddingProvider.id,
            providerName: embeddingProvider.name,
            model: embeddingProvider.model,
            vectorDimensions: embeddingResult.vector.length,
            usageTokens: embeddingUsageTokens,
          }, `[RAG] Embedding generated: ${embeddingResult.vector.length} dimensions, ${embeddingUsageTokens ?? 'N/A'} tokens (using ${embeddingQuery !== query ? 'original' : 'enhanced'} query)`);
        } catch (error) {
          embeddingUsageTokens = null;
          embeddingResultForMetadata = null;
          embeddingStep.fail(error);
          
          logger.error({
            component: 'RAG_PIPELINE',
            step: 'embedding_error',
            query: embeddingQuery.substring(0, 100),
            originalQueryLength: queryForEmbedding.length,
            enhancedQueryLength: query.length,
            usingOriginalQuery: embeddingQuery !== query,
            providerId: embeddingProviderId,
            error: error instanceof Error ? error.message : String(error),
          }, `[RAG] Embedding generation failed: ${error instanceof Error ? error.message : String(error)} (query length: ${embeddingQuery.length} chars, ${estimateTokens(embeddingQuery)} tokens)`);
          throw error;
        }

        await recordEmbeddingUsageSafe({
          workspaceId,
          provider: embeddingProvider,
          modelKey: embeddingProvider.model ?? null,
          tokensTotal: embeddingUsageMeasurement?.quantityRaw ?? embeddingUsageTokens ?? estimateTokens(embeddingQuery),
          contentBytes: Buffer.byteLength(embeddingQuery, "utf8"), // Используем оригинальный запрос
          operationId: `rag-query-${randomUUID()}`,
        });

        if (!workspaceId) {
          throw new Error("Не удалось определить workspaceId для запроса к публичному API коллекций");
        }

        const vectorPayload = buildVectorPayload(
          embeddingResult.vector,
          embeddingProvider.qdrantConfig?.vectorFieldName,
        );

        let lastVectorResponseStatus = 200;
        // Если есть явно указанная коллекция базы знаний (не skill files), используем её
        // Иначе, если есть skillId и нет явной коллекции, ищем в skill files
        const hasExplicitKnowledgeBaseCollection = vectorCollectionsToSearch.length > 0 && 
          !vectorCollectionsToSearch.includes("__skill_file_autoselect__") &&
          vectorCollectionsToSearch.some(coll => coll.startsWith("kb_"));

        if (normalizedSkillId && !hasExplicitKnowledgeBaseCollection) {
          // Ищем в skill files только если нет явной коллекции базы знаний
          const searchResult = await searchSkillFileVectors({
            workspaceId,
            skillId: normalizedSkillId,
            provider: embeddingProvider,
            vector: vectorPayload,
            limit: vectorLimit,
            caller: "rag_pipeline",
          });

          if (searchResult.guardrailTriggered) {
            vectorCollectionsToSearch = [];
            vectorCollection = null;
            vectorConfigured = false;
            console.warn("[RAG VECTOR] guardrail triggered, vector search skipped", {
              reason: searchResult.guardrailReason,
              workspaceId,
              skillId: normalizedSkillId,
            });
          } else {
            vectorCollectionsToSearch = [searchResult.collection!];
            vectorCollection = searchResult.collection;
            vectorConfigured = true;
            if (!hasVectorWeightOverride && vectorWeight === 0) {
              vectorWeight = 0.5;
            }
            if (!hasBm25WeightOverride && vectorWeight > 0 && bm25Weight === 1) {
              bm25Weight = 0.5;
            }

            aggregatedVectorResults.push(
              ...searchResult.results.map((item) => ({
                collection: searchResult.collection!,
                record: item as Record<string, unknown>,
              })),
            );
          }

          vectorDuration = performance.now() - vectorStart;
      } else {
        const apiBaseUrl = resolvePublicApiBaseUrl(req);
          const requestUrl = new URL(
            "/api/public/collections/search/vector",
            `${apiBaseUrl}/`,
          ).toString();

          for (const collectionName of vectorCollectionsToSearch) {
            const embedKey = await storage.getOrCreateWorkspaceEmbedKey(
              workspaceId,
              collectionName,
              knowledgeBaseId,
            );
            const embedDomains = await storage.listWorkspaceEmbedKeyDomains(embedKey.id, workspaceId);
            const embedOriginDomain =
              embedDomains.find((entry) => typeof entry.domain === "string" && entry.domain.trim().length > 0)
                ?.domain?.trim() ?? null;
            const embedOriginHeader = embedOriginDomain ? `https://${embedOriginDomain}` : null;

            const vectorRequestPayload = removeUndefinedDeep({
              collection: collectionName,
              workspace_id: workspaceId,
              vector: cloneVectorPayload(vectorPayload),
              limit: vectorLimit,
              withPayload: true,
              withVector: false,
            });

            vectorStep.setInput({
              limit: vectorLimit,
              collections: vectorCollectionsToSearch,
              collection: collectionName,
              embeddingProviderId,
              request: {
                url: requestUrl,
                headers: {
                  "Content-Type": "application/json",
                  "X-API-Key": "***",
                },
                payload: vectorRequestPayload,
              },
            });

            let vectorResponse: FetchResponse;
            try {
              vectorResponse = await fetch(requestUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-API-Key": embedKey.publicKey,
                  ...(embedOriginHeader
                    ? { "X-Embed-Origin": embedOriginHeader, Origin: embedOriginHeader }
                    : {}),
                },
                body: JSON.stringify(vectorRequestPayload),
              });
            } catch (networkError) {
              throw new Error(
                "Vector search API request failed before reaching the workspace endpoint",
              );
            }

            lastVectorResponseStatus = vectorResponse.status;

            const rawVectorResponse = await vectorResponse.text();
            vectorDuration = performance.now() - vectorStart;
            const parsedVectorResponse = parseJson(rawVectorResponse);

            console.log(`[RAG VECTOR DEBUG] Response status: ${vectorResponse.status}`);
            console.log(`[RAG VECTOR DEBUG] Response body: ${rawVectorResponse.slice(0, 500)}`);
            console.log(`[RAG VECTOR DEBUG] Collection: ${collectionName}`);
            console.log(`[RAG VECTOR DEBUG] Embed key: ${embedKey.publicKey.slice(0, 10)}...`);

            if (!vectorResponse.ok) {
              const errorMessage =
                parsedVectorResponse && typeof parsedVectorResponse === "object" &&
                typeof (parsedVectorResponse as Record<string, unknown>).error === "string"
                  ? ((parsedVectorResponse as Record<string, unknown>).error as string)
                  : `Vector API error (${vectorResponse.status}): ${rawVectorResponse.slice(0, 200)}`;
              console.error(`[RAG VECTOR DEBUG] Error: ${errorMessage}`);
              throw new HttpError(vectorResponse.status, errorMessage, parsedVectorResponse);
            }

            if (
              !parsedVectorResponse ||
              typeof parsedVectorResponse !== "object" ||
              !Array.isArray((parsedVectorResponse as Record<string, unknown>).results)
            ) {
              throw new Error("Workspace vector search API returned a malformed response");
            }

            const vectorResults = (parsedVectorResponse as {
              results: Array<Record<string, unknown>>;
            }).results;


            aggregatedVectorResults.push(
              ...vectorResults.map((item) => ({
                collection: collectionName,
                record: item,
              })),
            );
          }
        }

        const formattedResults = aggregatedVectorResults.map(({ collection, record }) => ({
          collection,
          id: record.id ?? null,
          score: normalizeVectorScore(record.score),
          payload: (record.payload as Record<string, unknown> | undefined) ?? null,
        }));

        vectorSearchDetails = [
          ...(vectorSearchDetails ?? []),
          ...formattedResults,
        ];

        sanitizedVectorResults.push(
          ...aggregatedVectorResults.map(({ record }) => ({
            id: record.id ?? null,
            payload: (record.payload as Record<string, unknown> | undefined) ?? null,
            score: normalizeVectorScore(record.score),
            shard_key: (record as Record<string, unknown>).shard_key ?? null,
            order_value: (record as Record<string, unknown>).order_value ?? null,
          })),
        );

        for (const { record } of aggregatedVectorResults) {
          const payload = (record.payload as Record<string, unknown> | undefined) ?? null;
          const rawScore = normalizeVectorScore(record.score);

          const recordId =
            typeof record.id === "string"
              ? record.id
              : typeof record.id === "number"
                ? record.id.toString()
                : null;

          vectorChunks.push({
            chunkId: typeof payload?.chunk_id === "string" ? payload.chunk_id : "",
            score: rawScore ?? 0,
            recordId,
            payload,
          });
        }

        vectorResultCount = vectorChunks.length;
        vectorDuration = performance.now() - vectorStart;
        
        vectorStep.finish({
          hits: vectorResultCount,
          usageTokens: embeddingUsageTokens,
          response: {
            status: lastVectorResponseStatus,
            collection: vectorCollection,
            collections: vectorCollectionsToSearch,
            results: vectorSearchDetails,
          },
        });
        
        // Логирование результатов vector search
        logger.info({
          component: 'RAG_PIPELINE',
          step: 'vector_results',
          query: normalizedQuery.substring(0, 100),
          resultCount: vectorResultCount,
          durationMs: Math.round(vectorDuration),
          collections: vectorCollectionsToSearch,
          documentsFound: vectorDocumentIds.size,
          topScores: vectorChunks.slice(0, 5).map(c => ({
            score: c.score,
            chunkId: c.chunkId,
          })),
        }, `[RAG] Vector search completed: ${vectorResultCount} results in ${Math.round(vectorDuration)}ms`);
      } catch (error) {
        vectorDuration = performance.now() - vectorStart;
        vectorStep.fail(error);
        
        logger.error({
          component: 'RAG_PIPELINE',
          step: 'vector_error',
          error: error instanceof Error ? error.message : String(error),
          durationMs: Math.round(vectorDuration),
          collections: vectorCollectionsToSearch,
        }, `[RAG] Vector search failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    } else {
      skipPipelineStep(
        "vector_embedding",
        "Векторизация запроса",
        "Векторный поиск отключён",
      );
      
      logger.info({
        component: 'RAG_PIPELINE',
        step: 'vector_skipped',
        reason: cacheHit ? 'cache_hit' : 'vector_weight_zero',
        vectorWeight,
        cacheHit,
      }, `[RAG] Vector search skipped: ${cacheHit ? 'cache hit' : 'vectorWeight=0'}`);
      
      skipPipelineStep("vector_search", "Векторный поиск", "Векторный поиск отключён");
    }

    // Фильтрация по skill files нужна только если мы искали в skill files коллекции
    // Если искали в коллекции базы знаний (kb_..._ws_...), то эта фильтрация не нужна
    const isSkillFilesCollection = vectorCollectionsToSearch.length > 0 && 
      (vectorCollectionsToSearch[0] === "__skill_file_autoselect__" ||
       vectorCollectionsToSearch.some(coll => coll.includes("__proj_skill_files__")));
    
    if (normalizedSkillId && vectorChunks.length > 0 && isSkillFilesCollection) {
      const files = await storage.listSkillFiles(workspaceId, normalizedSkillId);
      const readyIds = new Set(
        files
          .filter((entry) => entry.processingStatus === "ready")
          .map((entry) => entry.id)
          .filter(Boolean),
      );

      if (readyIds.size === 0) {
        vectorChunks.length = 0;
        sanitizedVectorResults.length = 0;
      } else {
        const filteredVectorChunks = vectorChunks.filter((entry) => {
          const docId = typeof entry.payload?.doc_id === "string" ? entry.payload.doc_id : null;
          return docId ? readyIds.has(docId) : true;
        });
        
        const filteredSanitized = sanitizedVectorResults.filter((entry) => {
          const docId = typeof entry.payload?.doc_id === "string" ? entry.payload.doc_id : null;
          return docId ? readyIds.has(docId) : true;
        });
        
        vectorChunks.length = 0;
        vectorChunks.push(...filteredVectorChunks);

        sanitizedVectorResults.length = 0;
        sanitizedVectorResults.push(...filteredSanitized);
      }
    }

    const chunkIdsFromVector = Array.from(new Set(vectorChunks.map((entry) => entry.chunkId).filter(Boolean)));
    
    // Получаем chunk details для всех БЗ
    const chunkDetailsFromVectorPromises = knowledgeBaseIds.map((kbId) =>
      storage.getKnowledgeChunksByIds(kbId, chunkIdsFromVector),
    );
    const chunkDetailsFromVectorArrays = await Promise.all(chunkDetailsFromVectorPromises);
    const chunkDetailsFromVector = chunkDetailsFromVectorArrays.flat();
    
    const vectorRecordIds = vectorChunks
      .map((entry) => entry.recordId)
      .filter((value): value is string => Boolean(value));
    
    // Получаем chunk details по record IDs для всех БЗ
    const chunkDetailsFromRecordsPromises = knowledgeBaseIds.map((kbId) =>
      vectorRecordIds.length > 0
        ? storage.getKnowledgeChunksByVectorRecords(kbId, vectorRecordIds)
        : Promise.resolve([]),
    );
    const chunkDetailsFromRecordsArrays = await Promise.all(chunkDetailsFromRecordsPromises);
    const chunkDetailsFromRecords = chunkDetailsFromRecordsArrays.flat();
    

    // Создаем мапу для определения БЗ по коллекции
    const collectionToKnowledgeBaseId = new Map<string, string>();
    for (let i = 0; i < knowledgeBaseIds.length; i++) {
      const kbId = knowledgeBaseIds[i];
      if (i < vectorCollectionsToSearch.length) {
        collectionToKnowledgeBaseId.set(vectorCollectionsToSearch[i], kbId);
      }
    }
    
    // Получаем БЗ для каждого chunk из векторных результатов
    const chunkToKnowledgeBaseId = new Map<string, string>();
    for (const { collection, record } of aggregatedVectorResults) {
      const kbId = collectionToKnowledgeBaseId.get(collection);
      if (kbId) {
        const chunkId = typeof record.payload?.chunk_id === "string" ? record.payload.chunk_id : null;
        if (chunkId) {
          chunkToKnowledgeBaseId.set(chunkId, kbId);
        }
      }
    }
    
    const chunkDetailsMap = new Map<
      string,
      {
        documentId: string;
        docTitle: string;
        sectionTitle: string | null;
        text: string;
        nodeId: string | null;
        nodeSlug: string | null;
        knowledgeBaseId?: string; // Добавляем информацию о БЗ
      }
    >();
    const recordToChunk = new Map<string, string>();

    for (const detail of chunkDetailsFromVector) {
      const kbId = chunkToKnowledgeBaseId.get(detail.chunkId);
      chunkDetailsMap.set(detail.chunkId, {
        documentId: detail.documentId,
        docTitle: detail.docTitle,
        sectionTitle: detail.sectionTitle,
        text: detail.text,
        nodeId: detail.nodeId,
        nodeSlug: detail.nodeSlug,
        knowledgeBaseId: kbId,
      });
    }

    for (const detail of chunkDetailsFromRecords) {
      const kbId = chunkToKnowledgeBaseId.get(detail.chunkId);
      chunkDetailsMap.set(detail.chunkId, {
        documentId: detail.documentId,
        docTitle: detail.docTitle,
        sectionTitle: detail.sectionTitle,
        text: detail.text,
        nodeId: detail.nodeId,
        nodeSlug: detail.nodeSlug,
        knowledgeBaseId: kbId,
      });

      if (detail.vectorRecordId) {
        recordToChunk.set(detail.vectorRecordId, detail.chunkId);
      }
    }
    

    const aggregated = new Map<
      string,
      {
        chunkId: string;
        documentId: string;
        docTitle: string;
        sectionTitle: string | null;
        text: string;
        snippet: string;
        bm25Score: number;
        vectorScore: number;
        nodeId: string | null;
        nodeSlug: string | null;
        knowledgeBaseId?: string; // Добавляем информацию о БЗ
      }
    >();

    const buildSnippet = (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length <= 320) {
        return trimmed;
      }
      return `${trimmed.slice(0, 320)}…`;
    };

    for (const entry of bm25Sections) {
      const snippet = entry.snippet || buildSnippet(entry.text);
      // Получаем knowledgeBaseId из entry (если было добавлено в BM25 поиске)
      const kbId = 'knowledgeBaseId' in entry ? (entry as typeof entry & { knowledgeBaseId?: string }).knowledgeBaseId : undefined;
      aggregated.set(entry.chunkId, {
        chunkId: entry.chunkId,
        documentId: entry.documentId,
        docTitle: entry.docTitle,
        sectionTitle: entry.sectionTitle,
        text: entry.text,
        snippet,
        bm25Score: entry.score,
        vectorScore: 0,
        nodeId: entry.nodeId ?? null,
        nodeSlug: entry.nodeSlug ?? null,
        knowledgeBaseId: kbId,
      });
    }

    let vectorChunksProcessed = 0;
    let vectorChunksSkippedNoChunkId = 0;
    let vectorChunksSkippedNoDetail = 0;
    
    for (const entry of vectorChunks) {
      let chunkId = entry.chunkId;
      if (!chunkId && entry.recordId) {
        chunkId = recordToChunk.get(entry.recordId) ?? "";
      }

      if (!chunkId) {
        vectorChunksSkippedNoChunkId++;
        continue;
      }

      const detail = chunkDetailsMap.get(chunkId);
      if (!detail) {
        vectorChunksSkippedNoDetail++;
        continue;
      }
      
      vectorChunksProcessed++;

      const existing = aggregated.get(chunkId);
      const baseSnippet =
        entry.payload && typeof entry.payload === "object"
          ? (() => {
              const chunkPayload = (entry.payload as { chunk?: { excerpt?: unknown } }).chunk;
              if (chunkPayload && typeof chunkPayload.excerpt === "string") {
                return chunkPayload.excerpt;
              }
              return null;
            })()
          : null;

      const snippet = baseSnippet ?? existing?.snippet ?? buildSnippet(detail.text);
      const nodeId = detail.nodeId ?? existing?.nodeId ?? null;
      const nodeSlug = detail.nodeSlug ?? existing?.nodeSlug ?? null;

      aggregated.set(chunkId, {
        chunkId,
        documentId: detail.documentId,
        docTitle: detail.docTitle,
        sectionTitle: detail.sectionTitle,
        text: detail.text,
        snippet,
        bm25Score: existing?.bm25Score ?? 0,
        vectorScore: Math.max(existing?.vectorScore ?? 0, entry.score),
        nodeId,
        nodeSlug,
        knowledgeBaseId: detail.knowledgeBaseId ?? existing?.knowledgeBaseId,
      });

      vectorDocumentIds.add(detail.documentId);
    }
    

    const bm25Max = Math.max(...Array.from(aggregated.values()).map((item) => item.bm25Score), 0);
    const vectorMax = Math.max(...Array.from(aggregated.values()).map((item) => item.vectorScore), 0);
    
    // Логирование агрегации результатов
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'aggregation',
      query: query.substring(0, 100),
      bm25SectionsCount: bm25Sections.length,
      vectorChunksCount: vectorChunks.length,
      vectorChunksProcessed,
      vectorChunksSkippedNoChunkId,
      vectorChunksSkippedNoDetail,
      aggregatedCount: aggregated.size,
      bm25MaxScore: bm25Max,
      vectorMaxScore: vectorMax,
    }, `[RAG] Aggregation: ${aggregated.size} unique chunks from BM25(${bm25Sections.length}) + Vector(${vectorChunks.length}, processed=${vectorChunksProcessed}, skipped=${vectorChunksSkippedNoChunkId + vectorChunksSkippedNoDetail})`);

    const combinedStep = startPipelineStep(
      "combine_results",
      { topK: effectiveTopK, bm25Weight, vectorWeight, cacheHit },
      "Combining retrieval results",
    );

    let combinedResults: KnowledgeBaseRagCombinedChunk[];
    
    if (cacheHit && cachedCombinedResults) {
      // Используем кэшированные результаты
      combinedResults = cachedCombinedResults;
      logger.info({
        component: 'RAG_PIPELINE',
        step: 'using_cached_results',
        cachedResultsCount: combinedResults.length,
      }, '[RAG CACHE] Using cached combined results');
    } else {
      // Обычная логика объединения результатов
      combinedResults = Array.from(aggregated.values())
        .map((item) => {
          const bm25Normalized = bm25Max > 0 ? item.bm25Score / bm25Max : 0;
          const vectorNormalized = vectorMax > 0 ? item.vectorScore / vectorMax : 0;
          const combinedScore = bm25Normalized * bm25Weight + vectorNormalized * vectorWeight;

          return {
            ...item,
            combinedScore,
            bm25Normalized,
            vectorNormalized,
            } satisfies KnowledgeBaseRagCombinedChunk;
          })
          .sort((a, b) => b.combinedScore - a.combinedScore);
    }

    const beforePostProcessing = {
      count: combinedResults.length,
      tokens: combinedResults.reduce((sum, c) => sum + estimateTokens(c.text), 0),
    };
    
    const { combinedResults: processedResults } = applyRetrievalPostProcessing({
      combinedResults,
      topK: effectiveTopK,
      minScore: effectiveMinScore,
      maxContextTokens: effectiveMaxContextTokens,
      estimateTokens,
    });
    combinedResults = processedResults;
    
    // Логирование постобработки
    const afterPostProcessing = {
      count: combinedResults.length,
      tokens: combinedResults.reduce((sum, c) => sum + estimateTokens(c.text), 0),
    };
    
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'post_processing',
      query: query.substring(0, 100),
      beforeCount: beforePostProcessing.count,
      afterCount: afterPostProcessing.count,
      beforeTokens: beforePostProcessing.tokens,
      afterTokens: afterPostProcessing.tokens,
      effectiveTopK,
      effectiveMinScore,
      effectiveMaxContextTokens,
      filteredByTopK: beforePostProcessing.count > effectiveTopK,
      filteredByMinScore: effectiveMinScore > 0,
      filteredByTokens: effectiveMaxContextTokens ? afterPostProcessing.tokens < beforePostProcessing.tokens : false,
    }, `[RAG] Post-processing: ${beforePostProcessing.count} → ${afterPostProcessing.count} chunks, ${beforePostProcessing.tokens} → ${afterPostProcessing.tokens} tokens`);
    
    if (allowSources) {
      combinedResults.forEach((item, index) => {
        emitStreamEvent("source", {
          index: index + 1,
          context: {
            chunk_id: item.chunkId,
            doc_id: item.documentId,
            doc_title: item.docTitle,
            section_title: item.sectionTitle,
            snippet: item.snippet,
            score: item.combinedScore,
            scores: {
              bm25: item.bm25Score,
              vector: item.vectorScore,
              bm25_normalized: item.bm25Normalized,
              vector_normalized: item.vectorNormalized,
            },
            node_id: item.nodeId ?? null,
            node_slug: item.nodeSlug ?? null,
            knowledge_base_id: item.knowledgeBaseId ?? null, // Добавляем информацию о БЗ
          },
        });
      });
    }

    combinedResultCount = combinedResults.length;
    vectorDocumentCount = vectorResultCount !== null ? vectorDocumentIds.size : null;
    retrievalDuration = performance.now() - retrievalStart;
    combinedStep.finish({ combined: combinedResultCount, vectorDocuments: vectorDocumentCount });
    
    // Логирование объединённых результатов
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'combined_results',
      query: query.substring(0, 100),
      bm25ResultCount,
      vectorResultCount,
      combinedResultCount,
      vectorDocumentCount,
      retrievalDurationMs: Math.round(retrievalDuration),
      bm25Weight,
      vectorWeight,
      effectiveTopK,
      effectiveMinScore,
      cacheHit,
      topCombinedScores: combinedResults.slice(0, 5).map(c => ({
        score: c.combinedScore,
        bm25Score: c.bm25Score,
        vectorScore: c.vectorScore,
        docTitle: (c.docTitle || '').substring(0, 50),
        chunkId: c.chunkId,
      })),
    }, `[RAG] Retrieval completed: ${combinedResultCount} combined from BM25(${bm25ResultCount ?? 0}) + Vector(${vectorResultCount ?? 0}) in ${Math.round(retrievalDuration)}ms`);

    // ВАЖНО: Сохраняем результаты ТЕКУЩЕГО поиска ДО добавления accumulated chunks
    // Эти результаты будут использоваться для формирования citations (источников для UI)
    // Accumulated chunks нужны только для контекста LLM, но НЕ должны отображаться как источники текущего ответа
    const currentSearchResultsForCitations = [...combinedResults];

    // Context Caching: сохраняем результаты retrieval в кэш (только если не было cache hit)
    // chatId и workspaceIdForCache уже объявлены выше при проверке cache hit
    
    if (enableContextCaching && chatId && workspaceIdForCache && !cacheHit) {
      try {
        // Преобразуем combinedResults в RagChunk[] для кэширования
        const chunksToCache: RagChunk[] = combinedResults.map((item) => ({
          chunk_id: item.chunkId,
          doc_id: item.documentId,
          doc_title: item.docTitle,
          section_title: item.sectionTitle,
          snippet: item.snippet,
          text: item.text ?? item.snippet,
          score: item.combinedScore,
          scores: {
            bm25: item.bm25Score,
            vector: item.vectorScore,
          },
          node_id: item.nodeId ?? null,
          node_slug: item.nodeSlug ?? null,
          knowledge_base_id: item.knowledgeBaseId ?? null,
        }));
        
        // Сохраняем результаты в кэш
        addRetrievalToCache(chatId, {
          query: query,
          normalizedQuery: normalizedQuery,
          chunks: chunksToCache,
          timestamp: Date.now(),
          embeddingVector: embeddingResultForMetadata?.vector,
        });
        
        logger.info({
          component: 'RAG_PIPELINE',
          step: 'context_cache_save',
          chatId,
          chunksCount: chunksToCache.length,
          query: query.substring(0, 100),
        }, '[RAG CACHE] Saved retrieval results to cache');
        
        // Опционально: добавляем накопленные chunks из предыдущих запросов
        const accumulatedChunks = getAccumulatedChunks(chatId, 5); // До 5 чанков из предыдущих запросов
        if (accumulatedChunks.length > 0) {
          const existingChunkIds = new Set(combinedResults.map(c => c.chunkId));
          const newChunks = accumulatedChunks.filter(c => !existingChunkIds.has(c.chunk_id));
          
          if (newChunks.length > 0) {
            // Преобразуем накопленные chunks в KnowledgeBaseRagCombinedChunk
            const additionalChunks: KnowledgeBaseRagCombinedChunk[] = newChunks.map((chunk) => ({
              chunkId: chunk.chunk_id,
              documentId: chunk.doc_id,
              docTitle: chunk.doc_title,
              sectionTitle: chunk.section_title,
              snippet: chunk.snippet,
              text: chunk.text ?? chunk.snippet,
              bm25Score: chunk.scores?.bm25 ?? 0,
              vectorScore: chunk.scores?.vector ?? 0,
              nodeId: chunk.node_id ?? null,
              nodeSlug: chunk.node_slug ?? null,
              knowledgeBaseId: chunk.knowledge_base_id ? chunk.knowledge_base_id : undefined,
              combinedScore: chunk.score,
              bm25Normalized: 0,
              vectorNormalized: 0,
            }));
            
            // Добавляем к combinedResults (с более низким приоритетом)
            combinedResults = [...combinedResults, ...additionalChunks];
            
            // КРИТИЧНО: Повторно применяем обрезку по maxContextTokens после добавления accumulated chunks
            // Иначе накопленные чанки могут превысить лимит токенов
            if (effectiveMaxContextTokens && effectiveMaxContextTokens > 0) {
              const beforeCount = combinedResults.length;
              const { combinedResults: reProcessedResults } = applyRetrievalPostProcessing({
                combinedResults,
                topK: effectiveTopK + additionalChunks.length, // Увеличиваем лимит, но токены ограничат
                minScore: 0, // Не фильтруем по score для accumulated chunks
                maxContextTokens: effectiveMaxContextTokens,
                estimateTokens,
              });
              combinedResults = reProcessedResults;
              
              logger.info({
                component: 'RAG_PIPELINE',
                step: 'context_cache_accumulated',
                chatId,
                additionalChunksCount: additionalChunks.length,
                beforeCount,
                afterCount: combinedResults.length,
                maxContextTokens: effectiveMaxContextTokens,
                tokensUsed: combinedResults.reduce((sum, c) => sum + estimateTokens(c.text), 0),
              }, `[RAG CACHE] Added ${additionalChunks.length} accumulated chunks, re-trimmed to ${combinedResults.length} (maxTokens=${effectiveMaxContextTokens})`);
            } else {
              logger.info({
                component: 'RAG_PIPELINE',
                step: 'context_cache_accumulated',
                chatId,
                additionalChunksCount: additionalChunks.length,
                maxContextTokens: null,
              }, `[RAG CACHE] Added ${additionalChunks.length} accumulated chunks (no token limit)`);
            }
          }
        }
      } catch (error) {
        logger.warn({
          component: 'RAG_PIPELINE',
          step: 'context_cache_error',
          chatId,
          error: error instanceof Error ? error.message : String(error),
        }, '[RAG CACHE] Failed to use context cache, continuing without cache');
      }
    }

    // Финальная проверка: логируем количество токенов перед формированием contextRecords
    const totalTokensBeforeContext = combinedResults.reduce((sum, c) => sum + estimateTokens(c.text), 0);
    const tokensPerChunk = combinedResults.slice(0, 10).map(c => ({
      chunkId: c.chunkId.substring(0, 20),
      tokens: estimateTokens(c.text),
      textLength: c.text.length,
    }));
    
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'context_records_formation',
      query: query.substring(0, 100),
      chunksCount: combinedResults.length,
      totalTokens: totalTokensBeforeContext,
      maxContextTokens: effectiveMaxContextTokens,
      tokensWithinLimit: effectiveMaxContextTokens ? totalTokensBeforeContext <= effectiveMaxContextTokens : true,
      tokensExceededBy: effectiveMaxContextTokens && totalTokensBeforeContext > effectiveMaxContextTokens 
        ? totalTokensBeforeContext - effectiveMaxContextTokens 
        : 0,
      tokensPerChunk: tokensPerChunk,
      avgTokensPerChunk: combinedResults.length > 0 ? Math.round(totalTokensBeforeContext / combinedResults.length) : 0,
    }, `[RAG] Forming context records: ${combinedResults.length} chunks, ${totalTokensBeforeContext} tokens (limit: ${effectiveMaxContextTokens ?? 'none'}, exceeded by: ${effectiveMaxContextTokens && totalTokensBeforeContext > effectiveMaxContextTokens ? totalTokensBeforeContext - effectiveMaxContextTokens : 0})`);

    const contextRecords: LlmContextRecord[] = combinedResults.map((item, index) => ({
      index,
      score: item.combinedScore,
      payload: {
        chunk: {
          id: item.chunkId,
          text: item.text,
          snippet: item.snippet,
          sectionTitle: item.sectionTitle,
          nodeId: item.nodeId,
          nodeSlug: item.nodeSlug,
          knowledgeBaseId: item.knowledgeBaseId, // Добавляем информацию о БЗ
        },
        document: {
          id: item.documentId,
          title: item.docTitle,
          nodeId: item.nodeId,
          nodeSlug: item.nodeSlug,
          knowledgeBaseId: item.knowledgeBaseId, // Добавляем информацию о БЗ
        },
        scores: {
          bm25: item.bm25Score,
          vector: item.vectorScore,
          bm25Normalized: item.bm25Normalized,
          vectorNormalized: item.vectorNormalized,
        },
      },
    }));

    // retrievalDuration уже установлен выше перед логом
    // retrievalDuration = performance.now() - retrievalStart;

    const ragResponseFormat = normalizeResponseFormat(body.llm.response_format);
    if (ragResponseFormat === null) {
      runStatus = "error";
      runErrorMessage = "Некорректный формат ответа";
      await finalizeRunLog();
      throw new HttpError(400, "Некорректный формат ответа", {
        details: "Поддерживаются значения text, md/markdown или html",
      });
    }
    const responseFormat: RagResponseFormat = ragResponseFormat ?? "text";
    
    // Логирование подготовки к LLM
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'llm_preparation',
      query: query.substring(0, 100),
      contextRecordsCount: contextRecords.length,
      responseFormat,
      llmProviderId: body.llm.provider,
      llmModel: body.llm.model,
      temperature: body.llm.temperature,
      maxTokens: body.llm.max_tokens,
      hasSystemPrompt: Boolean(body.llm.system_prompt),
    }, `[RAG] Preparing LLM request: ${contextRecords.length} context records, format=${responseFormat}`);

    const llmProvider = await storage.getLlmProvider(body.llm.provider, workspaceId);
    if (!llmProvider) {
      runStatus = "error";
      runErrorMessage = "Провайдер LLM не найден";
      await finalizeRunLog();
      throw new HttpError(404, "Провайдер LLM не найден");
    }

    if (!llmProvider.isActive) {
      throw new HttpError(400, "Выбранный провайдер LLM отключён");
    }

    const requestConfig = mergeLlmRequestConfig(llmProvider);

    if (body.llm.system_prompt !== undefined) {
      requestConfig.systemPrompt = body.llm.system_prompt || undefined;
    }

    if (body.llm.temperature !== undefined) {
      requestConfig.temperature = body.llm.temperature;
    }

    if (body.llm.max_tokens !== undefined) {
      requestConfig.maxTokens = body.llm.max_tokens;
    }

    const configuredProvider: LlmProvider = {
      ...llmProvider,
      requestConfig,
    };

    llmProviderId = llmProvider.id;

    const sanitizedModels = sanitizeLlmModelOptions(llmProvider.availableModels);
    const requestedModel = typeof body.llm.model === "string" ? body.llm.model.trim() : "";
    const normalizedModelFromList =
      sanitizedModels.find((model) => model.value === requestedModel)?.value ??
      sanitizedModels.find((model) => model.label === requestedModel)?.value ??
      null;
    const selectedModelValue =
      (normalizedModelFromList && normalizedModelFromList.trim().length > 0
        ? normalizedModelFromList.trim()
        : undefined) ??
      (requestedModel.length > 0 ? requestedModel : undefined) ??
      llmProvider.model;
    const selectedModelMeta =
      sanitizedModels.find((model) => model.value === selectedModelValue) ?? null;
    llmModel = selectedModelValue ?? null;
    llmModelLabel = selectedModelMeta?.label ?? selectedModelValue ?? null;
    if (requestedModel.length > 0) {
      try {
        const model = await ensureModelAvailable(selectedModelValue ?? requestedModel, { expectedType: "LLM" });
        llmModelInfo = {
          id: model.id,
          modelKey: model.modelKey,
          consumptionUnit: model.consumptionUnit,
          creditsPerUnit: model.creditsPerUnit,
        };
        llmModel = model.modelKey;
      } catch (error) {
        if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
          runStatus = "error";
          runErrorMessage = error.message;
          await finalizeRunLog();
          const httpError = new HttpError(error.status ?? 400, error.message);
          if (error.code) {
            (httpError as HttpError & { code?: string }).code = error.code;
          }
          throw httpError;
        }
        throw error;
      }
    } else if (selectedModelValue) {
      try {
        const model = await ensureModelAvailable(selectedModelValue, { expectedType: "LLM" });
        llmModelInfo = {
          id: model.id,
          modelKey: model.modelKey,
          consumptionUnit: model.consumptionUnit,
          creditsPerUnit: model.creditsPerUnit,
        };
        llmModel = model.modelKey;
      } catch (error) {
        if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
          runStatus = "error";
          runErrorMessage = error.message;
          await finalizeRunLog();
          const httpError = new HttpError(error.status ?? 400, error.message);
          if (error.code) {
            (httpError as HttpError & { code?: string }).code = error.code;
          }
          throw httpError;
        }
        throw error;
      }
    }

    emitStreamStatus("answering", "Формулирую ответ…");
    const llmAccessToken = await fetchAccessToken(configuredProvider);
    const llmStep = startPipelineStep(
      "llm_completion",
      { providerId: llmProviderId, model: llmModel },
      "Генерация ответа LLM",
    );
    const llmStart = performance.now();
    let completion: LlmCompletionResult;
    // Получаем историю из body для передачи в LLM completion
    const conversationHistory = Array.isArray(body.conversation_history) 
      ? body.conversation_history.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        }))
      : undefined;
    
    if (conversationHistory && conversationHistory.length > 0) {
      logger.info({
        component: 'RAG_PIPELINE',
        step: 'llm_completion_with_history',
        historyMessagesCount: conversationHistory.length,
        historyLength: conversationHistory.reduce((sum, msg) => sum + (msg.content?.length ?? 0), 0),
      }, '[MULTI_TURN_RAG] Passing conversation history to LLM completion');
    }
    
    const completionPromise = fetchLlmCompletion(
      configuredProvider,
      llmAccessToken,
      normalizedQuery,
      contextRecords,
      selectedModelValue,
      {
        stream: wantsLlmStream,
        responseFormat,
        conversationHistory,
        onBeforeRequest(details) {
          llmStep.setInput({
            providerId: llmProviderId,
            model: llmModel,
            request: details,
          });
        },
      },
    );
    const llmStreamIterator = wantsLlmStream ? completionPromise.streamIterator : null;
    const llmStreamForwarder =
      wantsLlmStream && llmStreamIterator
        ? forwardLlmStreamEvents(llmStreamIterator, emitStreamEvent)
        : null;
    // Логирование LLM запроса
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'llm_request',
      query: normalizedQuery.substring(0, 100),
      providerId: llmProviderId,
      providerName: configuredProvider?.name ?? 'unknown',
      model: selectedModelValue,
      contextChunksCount: contextRecords.length,
      contextLength: contextRecords.reduce((sum, r) => sum + ((r as any).text?.length ?? (r as any).content?.length ?? 0), 0),
      hasConversationHistory: (conversationHistory?.length ?? 0) > 0,
      historyMessagesCount: conversationHistory?.length ?? 0,
      isStreaming: wantsLlmStream,
    }, `[RAG] LLM request: ${selectedModelValue}, ${contextRecords.length} context chunks, streaming=${wantsLlmStream}`);
    
    try {
      completion = await completionPromise;
      if (llmStreamForwarder) {
        await llmStreamForwarder;
      }
      llmDuration = performance.now() - llmStart;
      llmUsageTokens = completion.usageTokens ?? null;
      llmStep.finish({
        tokens: llmUsageTokens,
        response: completion.rawResponse,
        answerPreview: completion.answer.slice(0, 160),
      });
      
      // Логирование LLM ответа
      logger.info({
        component: 'RAG_PIPELINE',
        step: 'llm_response',
        providerId: llmProviderId,
        model: selectedModelValue,
        answerLength: completion.answer.length,
        usageTokens: llmUsageTokens,
        durationMs: Math.round(llmDuration),
        answerPreview: completion.answer.substring(0, 200),
      }, `[RAG] LLM response: ${completion.answer.length} chars, ${llmUsageTokens ?? 'N/A'} tokens in ${Math.round(llmDuration)}ms`);
    } catch (error) {
      if (llmStreamForwarder) {
        try {
          await llmStreamForwarder;
        } catch (streamError) {
          console.error("Ошибка пересылки потока LLM:", getErrorDetails(streamError));
        }
      }
      llmDuration = performance.now() - llmStart;
      llmStep.fail(error);
      
      // Логирование ошибки LLM
      logger.error({
        component: 'RAG_PIPELINE',
        step: 'llm_error',
        providerId: llmProviderId,
        model: selectedModelValue,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(llmDuration),
      }, `[RAG] LLM request failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    totalDuration = performance.now() - totalStart;

    await storage.recordKnowledgeBaseRagRequest({
      workspaceId,
      knowledgeBaseId,
      topK: effectiveTopK ?? null,
      bm25Weight,
      bm25Limit,
      vectorWeight,
      vectorLimit: vectorConfigured ? vectorLimit : null,
      embeddingProviderId: vectorConfigured ? embeddingProviderId : null,
      collection: vectorConfigured ? vectorCollection : null,
    });

    // ВАЖНО: Citations формируются из результатов ТЕКУЩЕГО поиска (currentSearchResultsForCitations),
    // а НЕ из combinedResults, который может содержать accumulated chunks из предыдущих запросов.
    // Accumulated chunks нужны только для контекста LLM, но не должны отображаться как источники текущего ответа.
    const citations = allowSources
      ? currentSearchResultsForCitations.map((item) => ({
          chunk_id: item.chunkId,
          doc_id: item.documentId,
          doc_title: item.docTitle,
          section_title: item.sectionTitle,
          snippet: item.snippet,
          score: item.combinedScore,
          scores: {
            bm25: item.bm25Score,
            vector: item.vectorScore,
          },
          node_id: item.nodeId ?? null,
          node_slug: item.nodeSlug ?? null,
          knowledge_base_id: item.knowledgeBaseId ?? null, // Добавляем информацию о БЗ
        }))
      : [];

    logger.info({
      component: 'RAG_PIPELINE',
      step: 'citations_formation',
      allowSources,
      currentSearchResultsCount: currentSearchResultsForCitations.length,
      combinedResultsWithAccumulatedCount: combinedResults.length,
      citationsCount: citations.length,
      citations: citations.length > 0 ? citations.slice(0, 3).map(c => ({
        chunk_id: c.chunk_id,
        doc_id: c.doc_id,
        doc_title: c.doc_title,
        score: c.score,
      })) : [],
    }, `[RAG] Citations formed: ${citations.length} citations from ${currentSearchResultsForCitations.length} current search results (${combinedResults.length} total with accumulated, allowSources=${allowSources})`);

    const responseChunks = allowSources
      ? combinedResults.map((item) => ({
          chunk_id: item.chunkId,
          doc_id: item.documentId,
          doc_title: item.docTitle,
          section_title: item.sectionTitle,
          snippet: item.snippet,
          text: item.text,
          score: item.combinedScore,
          scores: {
            bm25: item.bm25Score,
            vector: item.vectorScore,
          },
          node_id: item.nodeId ?? null,
          node_slug: item.nodeSlug ?? null,
          knowledge_base_id: item.knowledgeBaseId ?? null, // Добавляем информацию о БЗ
        }))
      : [];

    const llmTokensForUsage = llmUsageTokens ?? estimateTokens(completion.answer);
    const llmUsageMeasurement = measureTokensForModel(llmTokensForUsage, llmModelInfo);
    const llmPrice = calculatePriceSnapshot(llmModelInfo, llmUsageMeasurement);

    const response = {
      query,
      knowledgeBaseId, // Для обратной совместимости
      knowledgeBaseIds, // Новое поле для списка БЗ
      normalizedQuery,
      answer: completion.answer,
      citations,
      chunks: responseChunks,
      usage: {
        embeddingTokens: embeddingUsageMeasurement?.quantityRaw ?? embeddingUsageTokens,
        embeddingUnits: embeddingUsageMeasurement?.quantityUnits ?? null,
        embeddingUnit: embeddingUsageMeasurement?.unit ?? null,
        llmTokens: llmUsageMeasurement?.quantityRaw ?? llmUsageTokens,
        llmUnits: llmUsageMeasurement?.quantityUnits ?? null,
        llmUnit: llmUsageMeasurement?.unit ?? null,
        llmCredits: llmPrice ? centsToCredits(llmPrice.creditsChargedCents) : null,
        llmCreditsPerUnit: llmPrice ? centsToCredits(llmPrice.appliedCreditsPerUnitCents) : null,
      },
      timings: {
        total_ms: Number((totalDuration ?? 0).toFixed(2)),
        retrieval_ms: Number((retrievalDuration ?? 0).toFixed(2)),
        bm25_ms: Number((bm25Duration ?? 0).toFixed(2)),
        vector_ms: Number((vectorDuration ?? 0).toFixed(2)),
        llm_ms: Number((llmDuration ?? 0).toFixed(2)),
      },
      debug: {
        vectorSearch: vectorSearchDetails,
      },
      responseFormat,
    } as const;

    // Финальное логирование с полной статистикой pipeline
    logger.info({
      component: 'RAG_PIPELINE',
      step: 'response_ready',
      query: query.substring(0, 100),
      citationsCount: response.citations.length,
      chunksCount: response.chunks.length,
      answerLength: response.answer.length,
      allowSources,
      usage: {
        embeddingTokens: response.usage.embeddingTokens,
        llmTokens: response.usage.llmTokens,
        totalTokens: (response.usage.embeddingTokens ?? 0) + (response.usage.llmTokens ?? 0),
      },
      timings: {
        total: response.timings.total_ms,
        retrieval: response.timings.retrieval_ms,
        bm25: response.timings.bm25_ms,
        vector: response.timings.vector_ms,
        llm: response.timings.llm_ms,
      },
      retrievalStats: {
        bm25ResultCount,
        vectorResultCount,
        combinedResultCount,
        vectorDocumentCount,
      },
      cacheHit,
      skillId: normalizedSkillId,
    }, `[RAG] Response ready: ${response.citations.length} citations, ${response.chunks.length} chunks, ${response.answer.length} chars answer, ${response.timings.total_ms}ms total (retrieval=${response.timings.retrieval_ms}ms, llm=${response.timings.llm_ms}ms)`);

    if (!wantsLlmStream) {
      emitStreamEvent("delta", { text: response.answer });
    }
      emitStreamStatus("done", "Готово");
      
      logger.info({
        component: 'RAG_PIPELINE',
        step: 'sse_done_emitted',
        citationsInEvent: response.citations.length,
        answerLength: response.answer.length,
      }, `[RAG PIPELINE] SSE done event emitted with ${response.citations.length} citations`);
      
      emitStreamEvent("done", {
        answer: response.answer,
        query: response.query,
        kb_id: response.knowledgeBaseId,
      normalized_query: response.normalizedQuery,
      citations: response.citations,
      chunks: response.chunks,
      usage: response.usage,
      timings: response.timings,
      debug: response.debug,
      format: response.responseFormat,
    });
      
      logger.info({
        component: 'RAG_PIPELINE',
        step: 'sse_done_emitted',
        citationsInEvent: response.citations.length,
      }, `[RAG PIPELINE] SSE done event emitted with ${response.citations.length} citations`);

    if (workspaceId) {
      if (llmTokensForUsage > 0) {
        await recordLlmUsageEvent({
          workspaceId,
          executionId: `rag-llm-${randomUUID()}`,
          provider: llmProviderId ?? "unknown",
          model: llmModel ?? llmModelInfo?.modelKey ?? "unknown",
          modelId: llmModelInfo?.id ?? null,
          tokensTotal: llmUsageMeasurement?.quantityRaw ?? llmTokensForUsage,
          appliedCreditsPerUnit: llmPrice?.appliedCreditsPerUnitCents ?? null,
          creditsCharged: llmPrice?.creditsChargedCents ?? null,
          occurredAt: new Date(),
        });
      }
    }

    await finalizeRunLog();

    return {
      response,
      metadata: {
        pipelineLog,
        workspaceId,
        embeddingProvider: selectedEmbeddingProvider,
        embeddingResult: embeddingResultForMetadata,
        llmProvider,
        llmModel,
        llmModelLabel,
        sanitizedVectorResults,
        bm25Sections,
        bm25Weight,
        bm25Limit,
        vectorWeight,
        vectorLimit,
        vectorCollection,
        vectorResultCount,
        vectorDocumentCount,
        combinedResultCount,
        embeddingUsageTokens,
        llmUsageTokens,
        retrievalDuration,
        bm25Duration,
        vectorDuration,
        llmDuration,
        totalDuration,
        normalizedQuery,
        combinedResults,
      },
    };
  } catch (error) {
    runStatus = "error";
    runErrorMessage = getErrorDetails(error);
    await finalizeRunLog();
    throw error;
  }
}

// Public search API request/response schemas

interface PublicSearchResponse {
  hits: Array<{
    objectID: string;
    url: string;
    title?: string;
    content?: string;
    hierarchy?: {
      lvl0?: string;
      lvl1?: string;
      lvl2?: string;
    };
    excerpt?: string;
    _highlightResult?: {
      title?: { value: string; matchLevel: string };
      content?: { value: string; matchLevel: string };
    };
  }>;
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  query: string;
  params: string;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightQuery(text: string, query: string): { value: string; matchLevel: "none" | "partial" | "full" } {
  if (!text.trim()) {
    return { value: text, matchLevel: "none" };
  }

  const terms = Array.from(new Set(query.split(/\s+/).filter(Boolean)));
  if (terms.length === 0) {
    return { value: text, matchLevel: "none" };
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  let hasMatch = false;
  const highlighted = text.replace(pattern, (match) => {
    hasMatch = true;
    return `<mark>${match}</mark>`;
  });

  return { value: highlighted, matchLevel: hasMatch ? "partial" : "none" };
}

type ModelInfoForUsage = {
  consumptionUnit: "TOKENS_1K" | "MINUTES";
  id?: string | null;
  modelKey?: string | null;
  creditsPerUnit?: number | null;
};

function measureTokensForModel(
  tokens: number | null | undefined,
  modelInfo?: ModelInfoForUsage | null,
  fallbackUnit: "TOKENS_1K" | "MINUTES" = "TOKENS_1K",
) {
  const normalizedTokens = Math.max(0, Math.floor(tokens ?? 0));
  if (!Number.isFinite(normalizedTokens) || normalizedTokens <= 0) {
    return null;
  }

  if (modelInfo) {
    try {
      return measureUsageForModel(modelInfo, { kind: "TOKENS", tokens: normalizedTokens });
    } catch (error) {
      const modelLabel = modelInfo.modelKey ?? modelInfo.id ?? "unknown";
      if (error instanceof UsageMeterError) {
        console.warn(`[usage] модель ${modelLabel}: несовпадение unit/usage (${error.message})`);
      } else {
        console.error(`[usage] не удалось измерить LLM usage для модели ${modelLabel}:`, error);
      }
    }
  }

  const fallback = tokensToUnits(normalizedTokens);
  return {
    unit: fallbackUnit,
    quantityRaw: fallback.raw,
    quantityUnits: fallback.units,
    metadata: { modelResolved: false },
  };
}

function calculatePriceSnapshot(
  modelInfo: ModelInfoForUsage | null | undefined,
  measurement: UsageMeasurement | null,
) {
  if (!modelInfo || !measurement || !modelInfo.consumptionUnit) return null;
  try {
    const price = calculatePriceForUsage(
      { 
        consumptionUnit: modelInfo.consumptionUnit as "TOKENS_1K" | "MINUTES", 
        creditsPerUnit: modelInfo.creditsPerUnit ?? 0 
      },
      measurement,
    );
    return price;
  } catch (error) {
    console.warn(`[pricing] failed to calculate price for model ${modelInfo.modelKey ?? modelInfo.id ?? "unknown"}`, error);
    return null;
  }
}

function handlePreflightError(res: Response, error: unknown): boolean {
  if (error instanceof InsufficientCreditsError) {
    res.status(error.status).json({
      errorCode: error.code,
      message: error.message,
      details: error.details,
    });
    return true;
  }
  if (error instanceof IdempotencyKeyReusedError) {
    res.status(error.status).json({
      errorCode: error.code,
      message: error.message,
      details: error.details,
    });
    return true;
  }
  return false;
}

function resolveOperationId(req: Request): string | null {
  const headerKey =
    typeof req.headers["idempotency-key"] === "string"
      ? req.headers["idempotency-key"]
      : typeof req.headers["Idempotency-Key" as keyof typeof req.headers] === "string"
        ? (req.headers["Idempotency-Key" as keyof typeof req.headers] as string)
        : null;
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) 
    ? req.body as Record<string, unknown>
    : null;
  const bodyKey =
    body && typeof body.operationId === "string" && body.operationId.trim().length > 0
      ? body.operationId.trim()
      : null;
  const resolved = (headerKey || bodyKey || "").trim();
  return resolved || null;
}

async function ensureCreditsForLlmPreflight(
  workspaceId: string | null,
  modelInfo: ModelInfoForUsage | null,
  promptTokens: number,
  maxOutputTokens: number | null | undefined,
) {
  if (!workspaceId || !modelInfo) return;
  const estimate = estimateLlmPreflight(
    { 
      consumptionUnit: modelInfo.consumptionUnit as "TOKENS_1K" | "MINUTES", 
      creditsPerUnit: modelInfo.creditsPerUnit ?? 0 
    },
    { promptTokens, maxOutputTokens },
  );
  await assertSufficientWorkspaceCredits(workspaceId, estimate.estimatedCreditsCents, {
    modelId: modelInfo.id ?? null,
    modelKey: modelInfo.modelKey ?? null,
    unit: estimate.unit,
    estimatedUnits: estimate.estimatedUnits,
  });
}

async function ensureCreditsForEmbeddingPreflight(
  workspaceId: string | null,
  modelInfo: ModelInfoForUsage | null,
  inputTokens: number,
) {
  if (!workspaceId || !modelInfo || !modelInfo.consumptionUnit) return;
  const estimate = estimateEmbeddingsPreflight(
    { 
      consumptionUnit: modelInfo.consumptionUnit as "TOKENS_1K" | "MINUTES", 
      creditsPerUnit: modelInfo.creditsPerUnit ?? 0 
    },
    { inputTokens },
  );
  await assertSufficientWorkspaceCredits(workspaceId, estimate.estimatedCreditsCents, {
    modelId: modelInfo.id ?? null,
    modelKey: modelInfo.modelKey ?? null,
    unit: estimate.unit,
    estimatedUnits: estimate.estimatedUnits,
  });
}

async function ensureCreditsForAsrPreflight(
  workspaceId: string | null,
  modelInfo: ModelInfoForUsage | null,
  durationSeconds: number | null | undefined,
) {
  if (!workspaceId || !modelInfo || !modelInfo.consumptionUnit) return;
  const estimate = estimateAsrPreflight(
    { 
      consumptionUnit: modelInfo.consumptionUnit as "TOKENS_1K" | "MINUTES", 
      creditsPerUnit: modelInfo.creditsPerUnit ?? 0 
    },
    { durationSeconds: durationSeconds ?? 0 },
  );
  await assertSufficientWorkspaceCredits(workspaceId, estimate.estimatedCreditsCents, {
    modelId: modelInfo.id ?? null,
    modelKey: modelInfo.modelKey ?? null,
    unit: estimate.unit,
    estimatedUnits: estimate.estimatedUnits,
  });
}

function buildExcerpt(content: string | null | undefined, query: string, maxLength = 220): string | undefined {
  if (!content) {
    return undefined;
  }

  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return undefined;
  }

  const lowerContent = normalized.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerContent.indexOf(lowerQuery);

  if (matchIndex === -1) {
    return normalized.slice(0, maxLength) + (normalized.length > maxLength ? "…" : "");
  }

  const start = Math.max(0, matchIndex - Math.floor(maxLength / 2));
  const end = Math.min(normalized.length, start + maxLength);
  const excerpt = normalized.slice(start, end);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < normalized.length ? "…" : "";
  return `${prefix}${excerpt}${suffix}`;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize RAG pipeline for modular routes
  setRagPipelineImpl(runKnowledgeBaseRagPipeline);

  const httpDebug = process.env.DEBUG_HTTP === "1";
  if (httpDebug) {
    app.use((req, _res, next) => {
      console.warn(`[http] ${req.method} ${req.url}`);
      next();
    });
  }
  // Глобально отслеживаем ошибки стримов, чтобы write EOF и обрывы не валили процесс.
  app.use((req, res, next) => {
    req.on("error", (err) => {
      console.error("[http] req error:", err?.message ?? err);
    });
    req.on("aborted", () => {
      console.warn("[http] request aborted");
    });
    res.on("error", (err) => {
      console.error("[http] res error:", err?.message ?? err);
    });
    next();
  });
  const isGoogleAuthEnabled = () => Boolean(app.get("googleAuthConfigured"));
  const isYandexAuthEnabled = () => Boolean(app.get("yandexAuthConfigured"));

  // Register modular routes (migrated from this file)
  registerRouteModules(app);

  const registerPublicCollectionRoute = (path: string, handler: RequestHandler) => {
    app.post(path, handler);
  };

  const publicSearchHandler: RequestHandler = async (req, res) => {
    const publicContext = await resolvePublicCollectionRequest(req, res);
    if (!publicContext) {
      return;
    }

    res.status(410).json({
      error: "Эндпоинт удалён",
      message: "Публичный поиск по старым страницам больше не поддерживается. Используйте базы знаний.",
    });
  };


  registerPublicCollectionRoute("/api/public/collections/:publicId/search", publicSearchHandler);
  registerPublicCollectionRoute("/api/public/collections/search", publicSearchHandler);

  const publicVectorSearchHandler: RequestHandler = async (req, res) => {
    try {
      console.log(`[PUBLIC VECTOR SEARCH] Incoming request body keys: ${Object.keys(req.body ?? {}).join(", ")}`);
      
      const publicContext = await resolvePublicCollectionRequest(req, res);
      if (!publicContext) {
        console.log(`[PUBLIC VECTOR SEARCH] No public context - auth failed`);
        return;
      }

      const workspaceId = publicContext.workspaceId;
      const site = publicContext.site ?? null;
      const bodySource: Record<string, unknown> =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? { ...(req.body as Record<string, unknown>) }
          : {};
      delete bodySource.workspaceId;
      delete bodySource.workspace_id;
      
      console.log(`[PUBLIC VECTOR SEARCH] Parsing body. Collection: ${bodySource.collection}, has vector: ${Array.isArray(bodySource.vector)}, vector length: ${Array.isArray(bodySource.vector) ? (bodySource.vector as number[]).length : "N/A"}`);
      
      const body = publicVectorSearchSchema.parse(bodySource);
      const { collection, ...searchOptions } = body;

      const collectionName = collection.trim();
      const ownerWorkspaceId = await storage.getCollectionWorkspace(collectionName);

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({ error: "Коллекция не найдена" });
      }

      const client = getQdrantClient();
      const searchPayload: Parameters<QdrantClient["search"]>[1] = {
        vector: searchOptions.vector as Schemas["NamedVectorStruct"],
        limit: searchOptions.limit,
      };

      if (searchOptions.offset !== undefined) {
        searchPayload.offset = searchOptions.offset;
      }

      if (searchOptions.filter !== undefined) {
        searchPayload.filter = searchOptions.filter as Parameters<QdrantClient["search"]>[1]["filter"];
      }

      if (searchOptions.params !== undefined) {
        searchPayload.params = searchOptions.params as Parameters<QdrantClient["search"]>[1]["params"];
      }

      if (searchOptions.withPayload !== undefined) {
        searchPayload.with_payload = searchOptions.withPayload as Parameters<
          QdrantClient["search"]
        >[1]["with_payload"];
      }

      if (searchOptions.withVector !== undefined) {
        searchPayload.with_vector = searchOptions.withVector as Parameters<
          QdrantClient["search"]
        >[1]["with_vector"];
      }

      if (searchOptions.scoreThreshold !== undefined) {
        searchPayload.score_threshold = searchOptions.scoreThreshold;
      }

      if (searchOptions.shardKey !== undefined) {
        searchPayload.shard_key = searchOptions.shardKey as Parameters<QdrantClient["search"]>[1]["shard_key"];
      }

      if (searchOptions.consistency !== undefined) {
        searchPayload.consistency = searchOptions.consistency;
      }

      if (searchOptions.timeout !== undefined) {
        searchPayload.timeout = searchOptions.timeout;
      }

      const results = await client.search(collectionName, searchPayload);

      res.json({ collection: collectionName, results });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        console.log(`[PUBLIC VECTOR SEARCH] Qdrant not configured`);
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        console.log(`[PUBLIC VECTOR SEARCH] Zod validation error: ${JSON.stringify(error.issues)}`);
        return res.status(400).json({
          error: "Некорректные параметры поиска",
          details: error.issues,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(
          `[PUBLIC VECTOR SEARCH] Qdrant error in collection ${req.body?.collection ?? "<unknown>"}:`,
          error,
        );
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error("[PUBLIC VECTOR SEARCH] Unknown error:", error);
      res.status(500).json({ error: "Не удалось выполнить векторный поиск" });
    }
  };

  registerPublicCollectionRoute(
    "/api/public/collections/:publicId/search/vector",
    publicVectorSearchHandler,
  );
  registerPublicCollectionRoute("/api/public/collections/search/vector", publicVectorSearchHandler);

  const publicVectorizeHandler: RequestHandler = async (req, res) => {
    try {
      const publicContext = await resolvePublicCollectionRequest(req, res);
      if (!publicContext) {
        return;
      }

      const workspaceId = publicContext.workspaceId;
      const bodySource: Record<string, unknown> =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? { ...(req.body as Record<string, unknown>) }
          : {};
      delete bodySource.workspaceId;
      delete bodySource.workspace_id;
      const body = publicVectorizeSchema.parse(bodySource);
      const provider = await storage.getEmbeddingProvider(body.embeddingProviderId, workspaceId);

      if (!provider) {
        return res.status(404).json({ error: "Сервис эмбеддингов не найден" });
      }

      if (!provider.isActive) {
        throw new HttpError(400, "Выбранный сервис эмбеддингов отключён");
      }

      let collectionVectorSize: number | null = null;
      let collectionName: string | null = null;

      if (body.collection) {
        collectionName = body.collection.trim();
        if (collectionName.length === 0) {
          collectionName = null;
        }
      }

      if (collectionName) {
        const ownerWorkspaceId = await storage.getCollectionWorkspace(collectionName);
        if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
          return res.status(404).json({ error: "Коллекция не найдена" });
        }

        try {
          const client = getQdrantClient();
          const info = await client.getCollection(collectionName);
          const vectorsConfig = info.config?.params?.vectors as
            | { size?: number | null }
            | undefined;
          collectionVectorSize = vectorsConfig?.size ?? null;
        } catch (error) {
          const qdrantError = extractQdrantApiError(error);
          if (qdrantError) {
            return res.status(qdrantError.status).json({
              error: qdrantError.message,
              details: qdrantError.details,
            });
          }

          throw error;
        }
      }

      const accessToken = await fetchAccessToken(provider);
      const embeddingResult = await fetchEmbeddingVector(provider, accessToken, body.text);
      const embeddingTokensForUsage =
        embeddingResult.usageTokens ?? Math.max(1, Math.ceil(Buffer.byteLength(body.text, "utf8") / 4));
      const embeddingUsageMeasurement = measureTokensForModel(embeddingTokensForUsage, {
        consumptionUnit: "TOKENS_1K",
        modelKey: provider.model ?? null,
      });

      if (collectionVectorSize && embeddingResult.vector.length !== collectionVectorSize) {
        throw new HttpError(
          400,
          `Полученный вектор имеет длину ${embeddingResult.vector.length}, ожидалось ${collectionVectorSize}.`,
        );
      }

      await recordEmbeddingUsageSafe({
        workspaceId,
        provider,
        modelKey: provider.model ?? null,
        tokensTotal: embeddingUsageMeasurement?.quantityRaw ?? embeddingTokensForUsage,
        contentBytes: Buffer.byteLength(body.text, "utf8"),
        operationId: `public-embed-${randomUUID()}`,
      });

      res.json({
        vector: embeddingResult.vector,
        vectorLength: embeddingResult.vector.length,
        embeddingId: embeddingResult.embeddingId ?? null,
        usage: {
          embeddingTokens: embeddingUsageMeasurement?.quantityRaw ?? embeddingResult.usageTokens ?? null,
          embeddingUnits: embeddingUsageMeasurement?.quantityUnits ?? null,
          embeddingUnit: embeddingUsageMeasurement?.unit ?? null,
        },
        embeddingProvider: {
          id: provider.id,
          name: provider.name,
          model: provider.model,
        },
        collection: collectionName
          ? {
              name: collectionName,
              vectorSize: collectionVectorSize,
            }
          : null,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные параметры векторизации",
          details: error.issues,
        });
      }

      console.error("Ошибка публичной векторизации текста:", error);
      res.status(500).json({ error: "Не удалось выполнить векторизацию" });
    }
  };

  registerPublicCollectionRoute(
    "/api/public/collections/:publicId/vectorize",
    publicVectorizeHandler,
  );
  registerPublicCollectionRoute("/api/public/collections/vectorize", publicVectorizeHandler);

  const publicRagSearchHandler: RequestHandler = async (req, res) => {
    let collectionName = "";
    try {
      const publicContext = await resolvePublicCollectionRequest(req, res);
      if (!publicContext) {
        return;
      }

      const { site } = publicContext;
      const embedKey = publicContext.embedKey ?? null;
      const workspaceId = publicContext.workspaceId;

      const baseUrlSet = new Set<string>();
      const registerBaseUrl = (value: unknown) => {
        if (typeof value !== "string") {
          return;
        }

        const trimmed = value.trim();
        if (!trimmed) {
          return;
        }

        try {
          const parsed = new URL(trimmed);
          baseUrlSet.add(parsed.toString());
          baseUrlSet.add(`${parsed.origin}/`);
        } catch {
          // ignore invalid base url candidates
        }
      };

      registerBaseUrl(site?.url);
      if (Array.isArray(site?.startUrls)) {
        for (const startUrl of site.startUrls) {
          registerBaseUrl(startUrl);
        }
      }

      const baseUrls = Array.from(baseUrlSet);

      const payloadSource: Record<string, unknown> =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
          ? { ...(req.body as Record<string, unknown>) }
          : {};

      const parseBooleanParam = (value: unknown): boolean | undefined => {
        if (typeof value === "boolean") {
          return value;
        }

        if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          if (normalized === "true" || normalized === "1") {
            return true;
          }
          if (normalized === "false" || normalized === "0") {
            return false;
          }
        }

        return undefined;
      };

      const parseIntegerParam = (value: unknown): number | undefined => {
        if (typeof value === "number" && Number.isInteger(value)) {
          return value;
        }

        if (typeof value === "string") {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }

        return undefined;
      };

      const parseNumberParam = (value: unknown): number | undefined => {
        if (typeof value === "number") {
          return Number.isFinite(value) ? value : undefined;
        }

        if (typeof value === "string") {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }

        return undefined;
      };

      delete payloadSource.apiKey;
      delete payloadSource.publicId;
      delete payloadSource.sitePublicId;
      delete payloadSource.workspaceId;
      delete payloadSource.workspace_id;

      if (!("query" in payloadSource)) {
        if (typeof req.query.q === "string" && req.query.q.trim()) {
          payloadSource.query = req.query.q.trim();
        } else if (typeof req.query.query === "string" && req.query.query.trim()) {
          payloadSource.query = req.query.query.trim();
        }
      }

      if (!("embeddingProviderId" in payloadSource) && typeof req.query.embeddingProviderId === "string") {
        payloadSource.embeddingProviderId = req.query.embeddingProviderId;
      }

      if (!("llmProviderId" in payloadSource) && typeof req.query.llmProviderId === "string") {
        payloadSource.llmProviderId = req.query.llmProviderId;
      }

      if (!("llmModel" in payloadSource) && typeof req.query.llmModel === "string") {
        payloadSource.llmModel = req.query.llmModel;
      }

      if (!("limit" in payloadSource)) {
        const parsedLimit = parseIntegerParam(req.query.limit);
        if (parsedLimit !== undefined) {
          payloadSource.limit = parsedLimit;
        }
      }

      if (!("contextLimit" in payloadSource)) {
        const parsedContextLimit = parseIntegerParam(req.query.contextLimit);
        if (parsedContextLimit !== undefined) {
          payloadSource.contextLimit = parsedContextLimit;
        }
      }

      if (!("topK" in payloadSource)) {
        const parsedTopK = parseIntegerParam(req.query.topK ?? req.query.top_k);
        if (parsedTopK !== undefined) {
          payloadSource.topK = parsedTopK;
        }
      }

      if (!("kbId" in payloadSource)) {
        const kbCandidate =
          typeof req.query.kbId === "string"
            ? req.query.kbId
            : typeof req.query.kb_id === "string"
            ? req.query.kb_id
            : undefined;
        if (kbCandidate) {
          payloadSource.kbId = kbCandidate;
        }
      }

      if (!("llmTemperature" in payloadSource)) {
        const parsedTemperature = parseNumberParam(req.query.llmTemperature);
        if (parsedTemperature !== undefined) {
          payloadSource.llmTemperature = parsedTemperature;
        }
      }

      if (!("llmMaxTokens" in payloadSource)) {
        const parsedMaxTokens = parseIntegerParam(
          req.query.llmMaxTokens ?? req.query.maxTokens,
        );
        if (parsedMaxTokens !== undefined) {
          payloadSource.llmMaxTokens = parsedMaxTokens;
        }
      }

      if (!("llmSystemPrompt" in payloadSource) && typeof req.query.llmSystemPrompt === "string") {
        payloadSource.llmSystemPrompt = req.query.llmSystemPrompt;
      }

      if (!("llmResponseFormat" in payloadSource) && typeof req.query.llmResponseFormat === "string") {
        payloadSource.llmResponseFormat = req.query.llmResponseFormat;
      }

      if (!("includeContext" in payloadSource)) {
        const parsedIncludeContext = parseBooleanParam(req.query.includeContext);
        if (parsedIncludeContext !== undefined) {
          payloadSource.includeContext = parsedIncludeContext;
        }
      }

      if (!("includeQueryVector" in payloadSource)) {
        const parsedIncludeQueryVector = parseBooleanParam(req.query.includeQueryVector);
        if (parsedIncludeQueryVector !== undefined) {
          payloadSource.includeQueryVector = parsedIncludeQueryVector;
        }
      }

      if (!("withPayload" in payloadSource)) {
        const parsedWithPayload = parseBooleanParam(req.query.withPayload);
        if (parsedWithPayload !== undefined) {
          payloadSource.withPayload = parsedWithPayload;
        }
      }

      if (!("withVector" in payloadSource)) {
        const parsedWithVector = parseBooleanParam(req.query.withVector);
        if (parsedWithVector !== undefined) {
          payloadSource.withVector = parsedWithVector;
        }
      }

      if (!("collection" in payloadSource) && typeof req.query.collection === "string") {
        const candidate = req.query.collection.trim();
        if (candidate) {
          payloadSource.collection = candidate;
        }
      }

      if (!("responseFormat" in payloadSource) && typeof req.query.format === "string") {
        const candidate = req.query.format.trim();
        if (candidate) {
          payloadSource.responseFormat = candidate;
        }
      }

      const streamParamBeforeParse = payloadSource.stream;

      const body = publicGenerativeSearchSchema.parse(payloadSource);
      collectionName = body.collection.trim();

      if (embedKey && collectionName !== embedKey.collection) {
        return res.status(403).json({ error: "Коллекция недоступна для данного ключа" });
      }

      const responseFormatCandidate = normalizeResponseFormat(body.responseFormat);
      if (responseFormatCandidate === null) {
        return res.status(400).json({
          error: "Неверный формат ответа",
          details: "Допустимые варианты формата: text, md/markdown или html",
        });
      }

      const responseFormat: RagResponseFormat = responseFormatCandidate ?? "text";
      const includeContextInResponse = body.includeContext ?? true;
      const includeQueryVectorInResponse = body.includeQueryVector ?? true;

      const llmResponseFormatCandidate = normalizeResponseFormat(body.llmResponseFormat);
      if (llmResponseFormatCandidate === null) {
        return res.status(400).json({
          error: "Неверный формат ответа LLM",
          details: "Допустимые варианты формата: text, md/markdown или html",
        });
      }

      const llmResponseFormatRaw =
        llmResponseFormatCandidate ??
        (typeof body.responseFormat === "string" ? body.responseFormat : responseFormat);
      const llmResponseFormatNormalized =
        llmResponseFormatCandidate ?? responseFormat;
      
      console.log(`[RAG DEBUG] Looking up collection "${collectionName}" workspace...`);
      const ownerWorkspaceId = await storage.getCollectionWorkspace(collectionName);
      console.log(
        `[RAG DEBUG] Collection workspace: ${ownerWorkspaceId || 'NOT FOUND'}, Request workspace: ${workspaceId}, Match: ${ownerWorkspaceId === workspaceId}`,
      );

      if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
        return res.status(404).json({ error: "Коллекция не найдена" });
      }

      const knowledgeBaseId =
        publicContext.knowledgeBaseId ?? embedKey?.knowledgeBaseId ?? null;

      if (knowledgeBaseId) {
        const ragTopK = Math.max(
          1,
          Math.min(body.contextLimit ?? body.limit ?? 6, 20),
        );
        const vectorLimitForPipeline = Math.max(
          1,
          Math.min(body.limit ?? ragTopK, 50),
        );

        const ragRequest: KnowledgeRagRequest = {
          q: body.query,
          kb_id: knowledgeBaseId,
          top_k: ragTopK,
          hybrid: {
            bm25: {
              limit: ragTopK,
            },
            vector: {
              limit: vectorLimitForPipeline,
              collection: collectionName,
              embedding_provider_id: body.embeddingProviderId,
            },
          },
          llm: {
            provider: body.llmProviderId,
            model: body.llmModel ?? undefined,
            temperature: undefined,
            max_tokens: undefined,
            system_prompt: undefined,
            response_format: body.responseFormat,
          },
        };

        const acceptHeader = typeof req.headers.accept === "string" ? req.headers.accept : "";
        const wantsStream = Boolean(
          streamParamBeforeParse === true || acceptHeader.toLowerCase().includes("text/event-stream"),
        );

        console.log('[RAG STREAM DEBUG] streamParamBeforeParse:', streamParamBeforeParse);
        console.log('[RAG STREAM DEBUG] acceptHeader:', acceptHeader);
        console.log('[RAG STREAM DEBUG] wantsStream:', wantsStream);

        if (wantsStream) {
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache, no-transform");
          res.setHeader("Connection", "keep-alive");
          res.setHeader("X-Accel-Buffering", "no");
          const flusher = (res as Response & { flushHeaders?: () => void }).flushHeaders;
          if (typeof flusher === "function") {
            flusher.call(res);
          }

          try {
            await runKnowledgeBaseRagPipeline({
              req,
              body: ragRequest,
              stream: {
                onEvent: (eventName, payload) => {
                  sendSseEvent(res, eventName, payload);
                },
              },
            });
            res.end();
          } catch (error) {
            if (error instanceof HttpError) {
              sendSseEvent(res, "error", { message: error.message, details: error.details ?? null });
              res.end();
              return;
            }

            if (error instanceof QdrantConfigurationError) {
              sendSseEvent(res, "error", { message: "Qdrant не настроен", details: error.message });
              res.end();
              return;
            }

            console.error("Ошибка RAG-поиска (SSE):", error);
            sendSseEvent(res, "error", { message: "Не удалось получить ответ от LLM" });
            res.end();
          }

          return;
        }

        const pipelineResult = await runKnowledgeBaseRagPipeline({
          req,
          body: ragRequest,
        });

        const sanitizedResults = pipelineResult.metadata.sanitizedVectorResults;
        const contextLimit = Math.max(
          0,
          Math.min(body.contextLimit ?? sanitizedResults.length, sanitizedResults.length),
        );

        const sourcesMap = new Map<
          string,
          {
            url: string;
            title: string | null;
            snippet: string | null;
            chunkId: string | null;
            documentId: string | null;
          }
        >();

        for (const entry of sanitizedResults) {
          const payloadRecord = toRecord(entry.payload);
          if (!payloadRecord) {
            continue;
          }

          const chunkRecord = toRecord(payloadRecord.chunk);
          const documentRecord = toRecord(payloadRecord.document);
          const metadataRecord = toRecord(chunkRecord?.metadata);

          const sourceUrl = pickAbsoluteUrl(
            baseUrls,
            metadataRecord?.sourceUrl,
            metadataRecord?.source_url,
            chunkRecord?.deepLink,
            chunkRecord?.sourceUrl,
            documentRecord?.sourceUrl,
            documentRecord?.url,
            documentRecord?.path,
          );

          if (!sourceUrl) {
            continue;
          }

          const sourceTitle = pickFirstString(
            chunkRecord?.title,
            metadataRecord?.title,
            metadataRecord?.heading,
            metadataRecord?.sectionTitle,
            documentRecord?.title,
          );

          const snippet = buildSourceSnippet(
            metadataRecord?.snippet,
            metadataRecord?.excerpt,
            chunkRecord?.excerpt,
            chunkRecord?.text,
            documentRecord?.excerpt,
          );

          const chunkId = pickFirstString(chunkRecord?.id);
          const documentId = pickFirstString(documentRecord?.id);

          if (!sourcesMap.has(sourceUrl)) {
            sourcesMap.set(sourceUrl, {
              url: sourceUrl,
              title: sourceTitle ?? null,
              snippet,
              chunkId: chunkId ?? null,
              documentId: documentId ?? null,
            });
          }
        }

        const responsePayload: Record<string, unknown> = {
          answer: pipelineResult.response.answer,
          format: pipelineResult.response.responseFormat,
          usage: pipelineResult.response.usage,
          provider: {
            id: pipelineResult.metadata.llmProvider.id,
            name: pipelineResult.metadata.llmProvider.name,
            model:
              pipelineResult.metadata.llmModel ?? pipelineResult.metadata.llmProvider.model,
            modelLabel:
              pipelineResult.metadata.llmModelLabel ??
              pipelineResult.metadata.llmModel ??
              pipelineResult.metadata.llmProvider.model,
          },
          embeddingProvider: pipelineResult.metadata.embeddingProvider
            ? {
                id: pipelineResult.metadata.embeddingProvider.id,
                name: pipelineResult.metadata.embeddingProvider.name,
              }
            : null,
          collection: collectionName,
          citations: pipelineResult.response.citations,
          chunks: pipelineResult.response.chunks,
          timings: pipelineResult.response.timings,
          debug: pipelineResult.response.debug,
        };

        const maxSources = (() => {
          if (contextLimit > 0) {
            return contextLimit;
          }
          if (body.limit && body.limit > 0) {
            return Math.min(body.limit, sourcesMap.size);
          }
          return sourcesMap.size;
        })();

        const limitedSources = Array.from(sourcesMap.values()).slice(0, maxSources);
        if (limitedSources.length > 0) {
          responsePayload.sources = limitedSources.map((source) => ({
            url: source.url,
            title: source.title,
            snippet: source.snippet,
            chunkId: source.chunkId,
            documentId: source.documentId,
          }));
        }

        if (includeContextInResponse) {
          responsePayload.context = sanitizedResults;
        }

        const embeddingResult = pipelineResult.metadata.embeddingResult;
        if (includeQueryVectorInResponse && embeddingResult) {
          responsePayload.queryVector = embeddingResult.vector;
          responsePayload.vectorLength = embeddingResult.vector.length;
        }

        res.json(responsePayload);
        return;
      }

      const embeddingProvider = await storage.getEmbeddingProvider(body.embeddingProviderId, workspaceId);
      if (!embeddingProvider) {
        return res.status(404).json({ error: "Сервис эмбеддингов не найден" });
      }

      if (!embeddingProvider.isActive) {
        throw new HttpError(400, "Выбранный сервис эмбеддингов отключён");
      }

      const llmProvider = await storage.getLlmProvider(body.llmProviderId, workspaceId);
      if (!llmProvider) {
        return res.status(404).json({ error: "Провайдер LLM не найден" });
      }

      if (!llmProvider.isActive) {
        throw new HttpError(400, "Выбранный провайдер LLM отключён");
      }

      const llmRequestConfig = mergeLlmRequestConfig(llmProvider);

      if (body.llmSystemPrompt !== undefined) {
        llmRequestConfig.systemPrompt = body.llmSystemPrompt || undefined;
      }

      if (body.llmTemperature !== undefined) {
        llmRequestConfig.temperature = body.llmTemperature;
      }

      if (body.llmMaxTokens !== undefined) {
        llmRequestConfig.maxTokens = body.llmMaxTokens;
      }

      const configuredLlmProvider: LlmProvider = {
        ...llmProvider,
        requestConfig: llmRequestConfig,
      };

      const sanitizedModels = sanitizeLlmModelOptions(configuredLlmProvider.availableModels);
      const requestedModel = typeof body.llmModel === "string" ? body.llmModel.trim() : "";
      const normalizedModelFromList =
        sanitizedModels.find((model) => model.value === requestedModel)?.value ??
        sanitizedModels.find((model) => model.label === requestedModel)?.value ??
        null;
      const selectedModelValue =
        (normalizedModelFromList && normalizedModelFromList.trim().length > 0
          ? normalizedModelFromList.trim()
          : undefined) ??
        (requestedModel.length > 0 ? requestedModel : undefined) ??
        configuredLlmProvider.model;
      const selectedModelMeta =
        sanitizedModels.find((model) => model.value === selectedModelValue) ?? null;

      const client = getQdrantClient();
      const collectionInfo = await client.getCollection(collectionName);
      const vectorsConfig = collectionInfo.config?.params?.vectors as
        | { size?: number | null }
        | undefined;
      const collectionVectorSize = vectorsConfig?.size ?? null;
      const providerVectorSize = parseVectorSize(embeddingProvider.qdrantConfig?.vectorSize);

      if (
        collectionVectorSize &&
        providerVectorSize &&
        Number(collectionVectorSize) !== Number(providerVectorSize)
      ) {
        throw new HttpError(
          400,
          `Размер вектора коллекции (${collectionVectorSize}) не совпадает с настройкой сервиса (${providerVectorSize}).`,
        );
      }

      const embeddingAccessToken = await fetchAccessToken(embeddingProvider);
      const embeddingResult = await fetchEmbeddingVector(embeddingProvider, embeddingAccessToken, body.query);

      if (collectionVectorSize && embeddingResult.vector.length !== collectionVectorSize) {
        throw new HttpError(
          400,
          `Сервис эмбеддингов вернул вектор длиной ${embeddingResult.vector.length}, ожидалось ${collectionVectorSize}.`,
        );
      }

      const embeddingTokensForUsage =
        embeddingResult.usageTokens ?? Math.max(1, Math.ceil(Buffer.byteLength(body.query, "utf8") / 4));
      const embeddingUsageMeasurement = measureTokensForModel(embeddingTokensForUsage, {
        consumptionUnit: "TOKENS_1K",
        modelKey: selectedModelValue ?? embeddingProvider.model ?? null,
      });

      await recordEmbeddingUsageSafe({
        workspaceId,
        provider: embeddingProvider,
        modelKey: selectedModelValue ?? embeddingProvider.model ?? null,
        tokensTotal: embeddingUsageMeasurement?.quantityRaw ?? embeddingTokensForUsage,
        contentBytes: Buffer.byteLength(body.query, "utf8"),
        operationId: `collection-search-${randomUUID()}`,
      });

      const searchPayload: Parameters<QdrantClient["search"]>[1] = {
        vector: buildVectorPayload(
          embeddingResult.vector,
          embeddingProvider.qdrantConfig?.vectorFieldName,
        ),
        limit: body.limit,
      };

      if (body.offset !== undefined) {
        searchPayload.offset = body.offset;
      }

      if (body.filter !== undefined) {
        searchPayload.filter = body.filter as Parameters<QdrantClient["search"]>[1]["filter"];
      }

      if (body.params !== undefined) {
        searchPayload.params = body.params as Parameters<QdrantClient["search"]>[1]["params"];
      }

      searchPayload.with_payload = (body.withPayload ?? true) as Parameters<QdrantClient["search"]>[1]["with_payload"];

      if (body.withVector !== undefined) {
        searchPayload.with_vector = body.withVector as Parameters<QdrantClient["search"]>[1]["with_vector"];
      }

      if (body.scoreThreshold !== undefined) {
        searchPayload.score_threshold = body.scoreThreshold;
      }

      if (body.shardKey !== undefined) {
        searchPayload.shard_key = body.shardKey as Parameters<QdrantClient["search"]>[1]["shard_key"];
      }

      if (body.consistency !== undefined) {
        searchPayload.consistency = body.consistency;
      }

      if (body.timeout !== undefined) {
        searchPayload.timeout = body.timeout;
      }

      const results = await client.search(collectionName, searchPayload);
      const sanitizedResults = results.map((result) => {
        const payload = result.payload ?? null;
        return {
          id: result.id,
          payload,
          score: result.score ?? null,
          shard_key: result.shard_key ?? null,
          order_value: result.order_value ?? null,
        };
      });

      const sourcesMap = new Map<
        string,
        {
          url: string;
          title: string | null;
          snippet: string | null;
          chunkId: string | null;
          documentId: string | null;
        }
      >();

      for (const entry of sanitizedResults) {
        const payloadRecord = toRecord(entry.payload);
        if (!payloadRecord) {
          continue;
        }

        const chunkRecord = toRecord(payloadRecord.chunk);
        const documentRecord = toRecord(payloadRecord.document);
        const metadataRecord = toRecord(chunkRecord?.metadata);

        const sourceUrl = pickAbsoluteUrl(
          baseUrls,
          metadataRecord?.sourceUrl,
          metadataRecord?.source_url,
          chunkRecord?.deepLink,
          chunkRecord?.sourceUrl,
          documentRecord?.sourceUrl,
          documentRecord?.url,
          documentRecord?.path,
        );

        if (!sourceUrl) {
          continue;
        }

        const sourceTitle = pickFirstString(
          chunkRecord?.title,
          metadataRecord?.title,
          metadataRecord?.heading,
          metadataRecord?.sectionTitle,
          documentRecord?.title,
        );

        const snippet = buildSourceSnippet(
          metadataRecord?.snippet,
          metadataRecord?.excerpt,
          chunkRecord?.excerpt,
          chunkRecord?.text,
          documentRecord?.excerpt,
        );

        const chunkId = pickFirstString(chunkRecord?.id);
        const documentId = pickFirstString(documentRecord?.id);

        if (!sourcesMap.has(sourceUrl)) {
          sourcesMap.set(sourceUrl, {
            url: sourceUrl,
            title: sourceTitle ?? null,
            snippet,
            chunkId: chunkId ?? null,
            documentId: documentId ?? null,
          });
        }
      }

      const desiredContext = body.contextLimit ?? sanitizedResults.length;
      const contextLimit = Math.max(0, Math.min(desiredContext, sanitizedResults.length));
      const contextRecords: LlmContextRecord[] = sanitizedResults.slice(0, contextLimit).map((entry, index) => {
        const basePayload = entry.payload;
        let contextPayload: Record<string, unknown> | null = null;

        if (basePayload && typeof basePayload === "object" && !Array.isArray(basePayload)) {
          contextPayload = { ...(basePayload as Record<string, unknown>) };
        } else if (basePayload !== null && basePayload !== undefined) {
          contextPayload = { value: basePayload };
        }

        return {
          index: index + 1,
          score: typeof entry.score === "number" ? entry.score : null,
          payload: contextPayload,
        } satisfies LlmContextRecord;
      });

      const llmAccessToken = await fetchAccessToken(configuredLlmProvider);
      const acceptHeader = typeof req.headers.accept === "string" ? req.headers.accept : "";
      const wantsStreamingResponse =
        configuredLlmProvider.providerType === "gigachat" && acceptHeader.toLowerCase().includes("text/event-stream");

      if (wantsStreamingResponse) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        await streamGigachatCompletion({
          req,
          res,
          provider: configuredLlmProvider,
          accessToken: llmAccessToken,
          query: body.query,
          context: contextRecords,
          sanitizedResults,
          embeddingResult,
          embeddingProvider,
          selectedModelValue,
          selectedModelMeta,
          limit: body.limit,
          contextLimit,
          responseFormat: llmResponseFormatNormalized,
          includeContextInResponse,
          includeQueryVectorInResponse,
          collectionName: typeof req.params.name === "string" ? req.params.name : "",
        });
        return;
      }

      const completion = await fetchLlmCompletion(
        configuredLlmProvider,
        llmAccessToken,
        body.query,
        contextRecords,
        selectedModelValue,
        { responseFormat: llmResponseFormatNormalized },
      );

      const responsePayload: Record<string, unknown> = {
        answer: completion.answer,
        format: llmResponseFormatNormalized,
        usage: {
          embeddingTokens: embeddingResult.usageTokens ?? null,
          llmTokens: completion.usageTokens ?? null,
        },
        provider: {
          id: configuredLlmProvider.id,
          name: configuredLlmProvider.name,
          model: selectedModelValue,
          modelLabel: selectedModelMeta?.label ?? selectedModelValue,
        },
        embeddingProvider: {
          id: embeddingProvider.id,
          name: embeddingProvider.name,
        },
        collection: collectionName,
      };

      const maxSources = (() => {
        if (contextLimit > 0) {
          return contextLimit;
        }
        if (body.limit && body.limit > 0) {
          return body.limit;
        }
        return sourcesMap.size;
      })();

      const limitedSources = Array.from(sourcesMap.values()).slice(0, maxSources);
      if (limitedSources.length > 0) {
        responsePayload.sources = limitedSources.map((source) => ({
          url: source.url,
          title: source.title,
          snippet: source.snippet,
          chunkId: source.chunkId,
          documentId: source.documentId,
        }));
      }

      if (includeContextInResponse) {
        responsePayload.context = sanitizedResults;
      }

      if (includeQueryVectorInResponse) {
        responsePayload.queryVector = embeddingResult.vector;
        responsePayload.vectorLength = embeddingResult.vector.length;
      }

      res.json(responsePayload);
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          error: error.message,
          details: error.details,
        });
      }

      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные параметры генеративного поиска",
          details: error.issues,
        });
      }

      const qdrantError = extractQdrantApiError(error);
      if (qdrantError) {
        console.error(
          `Ошибка Qdrant при публичном генеративном поиске в коллекции ${collectionName}:`,
          error,
        );
        return res.status(qdrantError.status).json({
          error: qdrantError.message,
          details: qdrantError.details,
        });
      }

      console.error("Ошибка публичного RAG-поиска:", error);
      res.status(500).json({ error: "Не удалось получить ответ от LLM" });
    }
  };

  registerPublicCollectionRoute(
    "/api/public/collections/:publicId/search/rag",
    publicRagSearchHandler,
  );
  registerPublicCollectionRoute("/api/public/collections/search/rag", publicRagSearchHandler);
  // app.get("/api/auth/providers", ...);

  const resolveFrontendBaseUrl = (req: Request): string => {
    const envBase = process.env.FRONTEND_URL || process.env.PUBLIC_URL;
    if (envBase) return envBase;
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.startsWith("http")) return origin;
    const host = req.headers.host;
    const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
    return host ? `${proto}://${host}` : "http://localhost:5000";
  };

type AutoActionRunPayload = {
  userId: string;
  skill: SkillDto;
  action: ActionDto;
  placement: ActionPlacement;
  transcriptId?: string | null;
  transcriptText: string;
  context: Record<string, unknown>;
};

async function runTranscriptActionCommon(payload: AutoActionRunPayload): Promise<{
  text: string;
  applied: boolean;
  appliedChanges: unknown;
}> {
  const LLM_DEBUG_PROMPTS = isLlmPromptDebugEnabled();
  const truncate = (value: string, limit = 2000) =>
    typeof value === "string" && value.length > limit ? `${value.slice(0, limit)}…` : value;
  const { userId, skill, action, transcriptId, transcriptText, context } = payload;
  const logContext = {
    workspaceId: skill.workspaceId,
    skillId: skill.id,
    userId,
    chatId: typeof context?.chatId === "string" ? context.chatId : undefined,
    actionId: action.id,
    target: action.target,
    placement: payload.placement,
    transcriptId: transcriptId ?? undefined,
    trigger: typeof context?.trigger === "string" ? context.trigger : undefined,
  };
  const executionMetadata = {
    trigger: logContext.trigger ?? "manual_action",
    actionId: logContext.actionId,
    target: logContext.target,
    placement: logContext.placement,
    transcriptId: logContext.transcriptId,
  };
  const execution = await skillExecutionLogService.startExecution({
    workspaceId: logContext.workspaceId,
    skillId: logContext.skillId,
    userId: logContext.userId ?? null,
    chatId: logContext.chatId ?? null,
    userMessageId: null,
    source: "workspace_skill",
    metadata: executionMetadata,
  });
  const executionId = execution?.id ?? null;

  const prompt = action.promptTemplate.replace(/{{\s*text\s*}}/gi, transcriptText);
  const resolvedProvider = await resolveLlmConfigForAction(skill, action);
  const modelOverride = skill.modelId && skill.modelId.trim().length > 0 ? skill.modelId.trim() : null;
  const llmProvider = modelOverride ? { ...resolvedProvider, model: modelOverride } : resolvedProvider;
  const requestConfig = mergeLlmRequestConfig(llmProvider);

  const messages: Array<{ role: string; content: string }> = [];
  if (requestConfig.systemPrompt && requestConfig.systemPrompt.trim()) {
    messages.push({ role: "system", content: requestConfig.systemPrompt.trim() });
  }
  messages.push({ role: "user", content: prompt });

  const requestBody: Record<string, unknown> = {
    [requestConfig.modelField]: llmProvider.model,
    [requestConfig.messagesField]: messages,
  };

  if (requestConfig.temperature !== undefined) {
    requestBody.temperature = requestConfig.temperature;
  }
  if (requestConfig.maxTokens !== undefined) {
    requestBody.max_tokens = requestConfig.maxTokens;
  }

  const accessToken = await fetchAccessToken(llmProvider);
  let completion: Awaited<ReturnType<typeof executeLlmCompletion>>;
  try {
    completion = await executeLlmCompletion(llmProvider, accessToken, requestBody);
    if (executionId) {
      await skillExecutionLogService.logStepSuccess({
        executionId,
        type: "CALL_LLM",
        input: {
          model: llmProvider.model,
          provider: llmProvider.name,
          actionId: action.id,
          target: action.target,
          placement: payload.placement,
          ...(LLM_DEBUG_PROMPTS
            ? {
                prompt: truncate(prompt, 2000),
                systemPrompt: truncate(requestConfig.systemPrompt ?? "", 1200),
              }
            : {}),
        },
        output: {
          usageTokens: completion.usageTokens ?? null,
        },
      });
    }
  } catch (llmError) {
    if (executionId) {
      await skillExecutionLogService.logStepError({
        executionId,
        type: "CALL_LLM",
        input: {
          model: llmProvider.model,
          provider: llmProvider.name,
          actionId: action.id,
          target: action.target,
          placement: payload.placement,
          ...(LLM_DEBUG_PROMPTS
            ? {
                prompt: truncate(prompt, 2000),
                systemPrompt: truncate(requestConfig.systemPrompt ?? "", 1200),
              }
            : {}),
        },
        errorMessage: llmError instanceof Error ? llmError.message : String(llmError),
      });
      await skillExecutionLogService.markExecutionFailed(executionId);
    }
    throw llmError;
  }
  const llmText = completion.answer;

  // Применяем только replace_text для transcript
  if (action.outputMode !== "replace_text") {
    console.warn(
      `[auto-action] action=${action.id} outputMode=${action.outputMode} не поддерживается для авто-действия`,
    );
    if (executionId) {
      await skillExecutionLogService.markExecutionSuccess(executionId);
    }
    return { text: llmText, applied: false, appliedChanges: null };
  }
  if (!transcriptId) {
    console.warn(`[auto-action] transcriptId отсутствует, пропускаем применение`);
    if (executionId) {
      await skillExecutionLogService.markExecutionSuccess(executionId);
    }
    return { text: llmText, applied: false, appliedChanges: null };
  }
  const transcript = await storage.getTranscriptById?.(transcriptId);
  if (!transcript || transcript.workspaceId !== skill.workspaceId) {
    console.warn(`[auto-action] transcript ${transcriptId} не найден или не принадлежит workspace=${skill.workspaceId}`);
    if (executionId) {
      await skillExecutionLogService.markExecutionSuccess(executionId);
    }
    return { text: llmText, applied: false, appliedChanges: null };
  }

  let newText = llmText;
  if (action.inputType === "selection") {
    if (typeof context.selectionText === "string" && context.selectionText.length > 0) {
      const full = transcript.fullText ?? "";
      newText = full.replace(context.selectionText, llmText);
    }
  }

  await storage.updateTranscript(transcriptId, {
    fullText: newText,
    lastEditedByUserId: userId,
  });
  if (executionId) {
    await skillExecutionLogService.markExecutionSuccess(executionId);
  }

  console.info(`[transcript-action] skill=${skill.id} action=${action.id} применён к transcript=${transcriptId}`);
  return {
    text: llmText,
    applied: true,
    appliedChanges: {
      type: "transcript_replace",
      transcriptId,
    },
  };
}

  // Apply requireAuth to all /api/* EXCEPT public endpoints
  app.use("/api", (req, res, next) => {
    // Skip auth for no-code callbacks and public endpoints
    const fullPath = req.originalUrl || req.url;
    const publicPaths = [
      '/api/no-code/',
      '/api/public/',
      '/public/',
      '/api/auth/', // auth endpoints handle their own auth
    ];
    const isPublic = publicPaths.some(path => fullPath.startsWith(path));
    if (isPublic) {
      return next();
    }
    return requireAuth(req, res, next);
  });

  const updateProfileSchema = z.object({
    firstName: z
      .string()
      .trim()
      .min(1, "Введите имя")
      .max(100, "Слишком длинное имя"),
    lastName: z
      .string()
      .trim()
      .max(120, "Слишком длинная фамилия")
      .optional(),
    phone: z
      .string()
      .trim()
      .max(30, "Слишком длинный номер")
      .optional()
      .refine((value) => !value || /^[0-9+()\s-]*$/.test(value), "Некорректный номер телефона"),
  });

  const switchWorkspaceSchema = z.object({
    workspaceId: z
      .string({ message: "workspaceId is required" })
      .trim()
      .min(1, "workspaceId is required"),
  });

  const inviteWorkspaceMemberSchema = z.object({
    email: z.string().trim().email("Введите корректный email"),
    role: z.enum(workspaceMemberRoles).default("user"),
  });

  const updateWorkspaceMemberSchema = z.object({
    role: z.enum(workspaceMemberRoles),
  });

  const updateUnicaChatConfigSchema = z.object({
    llmProviderConfigId: z.string().trim().min(1, "Укажите провайдера LLM"),
    modelId: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    systemPrompt: z.string().max(20000).optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    maxTokens: z.number().int().min(16).max(65536).optional(),
  });


  const createChatSessionSchema = z.object({
    workspaceId: z.string().trim().min(1, "Укажите рабочее пространство").optional(),
    skillId: z
      .string()
      .trim()
      .min(1, "Укажите навык")
      .optional(),
    title: z.string().trim().max(200).optional(),
  });

  const updateChatSessionSchema = z.object({
    title: z.string().trim().min(1, "Название не может быть пустым").max(200),
  });

  const createChatMessageSchema = z.object({
    workspaceId: z.string().trim().min(1, "Укажите рабочее пространство").optional(),
    content: z
      .string()
      .trim()
      .min(1, "Сообщение не может быть пустым")
      .max(20000, "Сообщение слишком длинное"),
    stream: z.boolean().optional(),
    operationId: z.string().trim().max(200).optional(),
  });

  const MAX_UPLOAD_FILE_SIZE_BYTES = 512 * 1024 * 1024;

  const fileUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
      files: 1,
    },
  });

  const MAX_SKILL_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_SIZE_BYTES;
  const MAX_DOC_TOKENS = 2_000_000;
  const APPROX_BYTES_PER_TOKEN = 4;
  const MAX_DOC_SIZE_FOR_TOKENS = MAX_DOC_TOKENS * APPROX_BYTES_PER_TOKEN;

  const skillFilesUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_SKILL_FILE_SIZE_BYTES,
      files: 10,
    },
  });

  const sanitizeFilename = (name: string): string => {
    const safe = name.replace(/[\\/:*?"<>|]/g, "_").trim();
    return safe.length > 0 ? safe : "file";
  };

  const toStorageSafeName = (name: string): string => {
    const sanitized = sanitizeFilename(name);
    // S3-compatible: strip exotic symbols, collapse separators, keep extension readable
    const ascii = sanitized
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .trim();
    const clipped = ascii.length > 180 ? ascii.slice(-180) : ascii;
    return clipped || "file";
  };

  const decodeFilename = (name: string): string => {
    if (!name) return "file";
    const hasCyrillic = /[\u0400-\u04FF]/.test(name);
    const looksMojibake = /[\u00C0-\u024F]/.test(name) && !hasCyrillic;
    if (looksMojibake) {
      try {
        const decoded = Buffer.from(name, "latin1").toString("utf8");
        return decoded || name;
      } catch {
        return name;
      }
    }
    return name;
  };

  const ALLOWED_SKILL_FILE_EXTENSIONS = new Set([".pdf", ".docx", ".doc", ".txt"]);

  const buildAttachmentKey = (chatId: string, filename: string): string => {
    return `attachments/${chatId}/${randomUUID()}-${filename}`;
  };

  const ATTACHMENT_URL_TTL_SECONDS = Math.max(
    60,
    Math.min(Number.parseInt(process.env.ATTACHMENT_URL_TTL_SECONDS ?? "900", 10) || 900, 3600),
  );

  const noCodeCallbackCreateMessageSchema = z
    .object({
      workspaceId: z.string().trim().min(1, "Укажите рабочее пространство"),
      chatId: z.string().trim().min(1, "Укажите чат"),
      role: z.enum(["user", "assistant", "system"]),
      content: z.string().trim().max(20000).optional(),
      text: z.string().trim().max(20000).optional(),
      triggerMessageId: z.string().trim().max(200).optional(),
      correlationId: z.string().trim().max(200).optional(),
      metadata: z.record(z.unknown()).optional(),
      card: z
        .object({
          type: z.enum(chatCardTypes),
          transcriptId: z.string().trim().max(200).optional(),
          title: z.string().trim().max(500).optional(),
          previewText: z.string().trim().max(20000).optional(),
        })
        .optional(),
    })
    .superRefine((val, ctx) => {
      const content = (val.content ?? val.text ?? "").trim();
      if (!content && !val.card) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["content"],
          message: "Сообщение не может быть пустым (или передайте card)",
        });
      }
    });

  type TranscriptStatusEnum = (typeof transcriptStatuses)[number];
  const transcriptStatusSchema = z.enum(
    transcriptStatuses as [TranscriptStatusEnum, ...TranscriptStatusEnum[]],
  );
  const TRANSCRIPT_MAX_LENGTH = 500_000;

  const noCodeCallbackTranscriptCreateSchema = z.object({
    workspaceId: z.string().trim().min(1, "Укажите рабочее пространство"),
    chatId: z.string().trim().min(1, "Укажите чат"),
    fullText: z
      .string()
      .trim()
      .min(1, "fullText обязателен")
      .max(TRANSCRIPT_MAX_LENGTH, `fullText слишком длинный (макс ${TRANSCRIPT_MAX_LENGTH} символов)`),
    title: z.string().trim().max(500).optional(),
    previewText: z.string().trim().max(20000).optional(),
    status: transcriptStatusSchema.optional(),
  });

  const noCodeCallbackTranscriptUpdateSchema = z.object({
    workspaceId: z.string().trim().min(1, "Укажите рабочее пространство"),
    chatId: z.string().trim().min(1, "Укажите чат"),
    fullText: z
      .string()
      .trim()
      .min(1, "fullText обязателен")
      .max(TRANSCRIPT_MAX_LENGTH, `fullText слишком длинный (макс ${TRANSCRIPT_MAX_LENGTH} символов)`),
    title: z.string().trim().max(500).optional(),
    previewText: z.string().trim().max(20000).optional(),
    status: transcriptStatusSchema.optional(),
  });

  const assistantActionTypeSchema = z
    .string()
    .trim()
    .transform((val) => val.toUpperCase())
    .refine((val): val is AssistantActionType => assistantActionTypes.includes(val as AssistantActionType), { message: "Недопустимый actionType" });

  const displayTextSchema = z
    .string()
    .max(300)
    .transform((val) => sanitizeDisplayText(val, 300))
    .refine((val) => val === null || val.length > 0, { message: "displayText пустой" })
    .optional();

  const botActionTypeSchema = z.string().trim().min(1, "Укажите тип действия (actionType)");
  const botActionStatusSchema = z.enum(botActionStatuses, {
    error: `Статус (status) должен быть одним из: ${botActionStatuses.join(", ")}`,
  });

  const botActionStartSchema = z.object({
    workspaceId: z.string().trim().optional(),
    chatId: z.string().trim().min(1, "Укажите идентификатор чата (chatId)"),
    actionType: botActionTypeSchema,
    displayText: displayTextSchema,
    payload: z.record(z.any()).optional(),
  });

  const botActionUpdateSchema = z.object({
    workspaceId: z.string().trim().optional(),
    chatId: z.string().trim().min(1, "Укажите идентификатор чата (chatId)"),
    actionId: z
      .string()
      .trim()
      .min(1, "Укажите идентификатор действия (actionId), полученный из ответа start"),
    actionType: botActionTypeSchema,
    status: botActionStatusSchema,
    displayText: displayTextSchema,
    payload: z.record(z.any()).optional(),
  });

  const noCodeCallbackAssistantActionSchema = z.object({
    workspaceId: z.string().trim().min(1, "Укажите рабочее пространство"),
    chatId: z.string().trim().min(1, "Укажите чат"),
    actionType: assistantActionTypeSchema,
    actionText: z.string().trim().max(2000).optional(),
    triggerMessageId: z.string().trim().max(200).optional(),
    occurredAt: z.string().datetime().optional(),
  });

  const noCodeCallbackStreamSchema = z.object({
    workspaceId: z.string().trim().min(1, "Укажите рабочее пространство"),
    chatId: z.string().trim().min(1, "Укажите чат"),
    triggerMessageId: z.string().trim().min(1, "Укажите исходное сообщение"),
    streamId: z.string().trim().min(1, "Укажите streamId"),
    chunkId: z.string().trim().min(1, "Укажите chunkId"),
    delta: z.string().max(20000).optional(),
    text: z.string().max(20000).optional(),
    role: z.enum(["user", "assistant", "system"]).optional(),
    seq: z.number().int().nonnegative().optional(),
    isFinal: z.boolean().optional(),
  });


  const adminLlmExecutionStatusSchema = z.enum(["pending", "running", "success", "error", "timeout", "cancelled"]);
  const adminLlmExecutionsQuerySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    workspaceId: z.string().uuid().optional(),
    skillId: z.string().uuid().optional(),
    userId: z.string().optional(),
    status: adminLlmExecutionStatusSchema.optional(),
    hasError: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => (value === undefined ? undefined : value === "true")),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  });

  // ========================================================================
  // CHAT EVENTS & ACTIONS - TODO: MIGRATE TO chat.routes.ts
  // Complex SSE endpoints with real-time events
  // ========================================================================

  // ========================================================================
  // CHAT MESSAGES ENDPOINTS - TODO: MIGRATE TO chat.routes.ts
  // Complex endpoints with file uploads and no-code integration
  // ========================================================================

  // ========================================================================
  // SKILL ACTIONS RUN - TODO: MIGRATE TO skill.routes.ts
  // Complex LLM endpoint with action execution
  // ========================================================================
  
  // ========================================================================
  // TRANSCRIPTS ENDPOINTS - TODO: MIGRATE TO transcribe.routes.ts
  // ========================================================================

  // ========================================================================
  // CHAT TRANSCRIBE - TODO: MIGRATE TO transcribe.routes.ts
  // ========================================================================

  // Sites management


  // Extended sites with pages count - must come before /api/sites/:id


  // Crawling operations

  // Re-crawl existing site to find new pages


  // Emergency stop all crawls - simple database solution

  // Pages management

  // Search API

  // Webhook endpoint for automated crawling (e.g., from Tilda)

  // Get all pages


  const crawlSelectorsSchema = z
    .object({
      title: z.string().trim().min(1).optional(),
      content: z.string().trim().min(1).optional(),
    })
    .partial();

  const crawlAuthSchema = z
    .object({
      headers: z.record(z.string()).optional(),
    })
    .partial();

  const crawlConfigSchema = z.object({
    start_urls: z.array(z.string().trim().min(1)).min(1),
    sitemap_url: z
      .string()
      .trim()
      .min(1)
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    allowed_domains: z.array(z.string().trim().min(1)).optional(),
    include: z.array(z.string().trim().min(1)).optional(),
    exclude: z.array(z.string().trim().min(1)).optional(),
    max_pages: z.number().int().positive().optional(),
    max_depth: z.number().int().min(0).optional(),
    rate_limit: z.number().positive().optional(),
    rate_limit_rps: z.number().positive().optional(),
    robots_txt: z.boolean().optional(),
    selectors: crawlSelectorsSchema.optional(),
    language: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    auth: crawlAuthSchema.optional(),
  });

  const createKnowledgeBaseSchema = z.object({
    id: z
      .string()
      .trim()
      .min(1, "Некорректный идентификатор базы знаний")
      .max(191, "Слишком длинный идентификатор базы знаний")
      .optional(),
    name: z
      .string()
      .trim()
      .min(1, "Укажите название базы знаний")
      .max(200, "Название не должно превышать 200 символов"),
    description: z
      .string()
      .trim()
      .max(2000, "Описание не должно превышать 2000 символов")
      .optional(),
  });

  const createKnowledgeBaseWithCrawlSchema = z.object({
    name: z
      .string()
      .trim()
      .min(1, "Укажите название базы знаний")
      .max(200, "Название не должно превышать 200 символов"),
    description: z.string().trim().max(2000).optional(),
    source: z.literal("crawl"),
    crawl_config: crawlConfigSchema,
  });

  const restartKnowledgeBaseCrawlSchema = z.object({
    crawl_config: crawlConfigSchema,
  });

  function mapCrawlConfig(input: z.infer<typeof crawlConfigSchema>): KnowledgeBaseCrawlConfig {
    const normalizeArray = (value?: string[]) =>
      value
        ?.map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

    const startUrls = normalizeArray(input.start_urls) ?? [];

    const rateLimit =
      (typeof input.rate_limit_rps === "number" && Number.isFinite(input.rate_limit_rps)
        ? input.rate_limit_rps
        : undefined) ??
      (typeof input.rate_limit === "number" && Number.isFinite(input.rate_limit)
        ? input.rate_limit
        : undefined) ??
      null;

    return {
      startUrls,
      sitemapUrl: input.sitemap_url ?? null,
      allowedDomains: normalizeArray(input.allowed_domains) ?? undefined,
      include: normalizeArray(input.include) ?? undefined,
      exclude: normalizeArray(input.exclude) ?? undefined,
      maxPages: input.max_pages ?? null,
      maxDepth: input.max_depth ?? null,
      rateLimitRps: rateLimit,
      robotsTxt: input.robots_txt ?? true,
      selectors: input.selectors
        ? {
            title: input.selectors.title?.trim() || null,
            content: input.selectors.content?.trim() || null,
          }
        : null,
      language: input.language?.trim() || null,
      version: input.version?.trim() || null,
      auth: input.auth?.headers
        ? {
            headers: Object.fromEntries(
              Object.entries(input.auth.headers)
                .filter(([key, value]) => key.trim().length > 0 && value.trim().length > 0)
                .map(([key, value]) => [key, value.trim()]),
            ),
          }
        : null,
    } satisfies KnowledgeBaseCrawlConfig;
  }

  const deleteKnowledgeBaseSchema = z.object({
    confirmation: z
      .string()
      .trim()
      .min(1, "Введите название базы знаний для подтверждения удаления"),
  });

  const createKnowledgeFolderSchema = z.object({
    title: z
      .string()
      .trim()
      .min(1, "Укажите название подраздела")
      .max(200, "Название не должно превышать 200 символов"),
  });

  const createKnowledgeDocumentSchema = z.object({
    title: z
      .string()
      .trim()
      .min(1, "Укажите название документа")
      .max(500, "Название не должно превышать 500 символов"),
    content: z
      .string()
      .max(20_000_000, "Документ слишком большой. Ограничение — 20 МБ текста")
      .optional()
      .default(""),
    sourceType: z.enum(["manual", "import"]).optional(),
    importFileName: z
      .string()
      .trim()
      .max(500, "Имя файла не должно превышать 500 символов")
      .optional()
      .nullable(),
  });

  const createCrawledKnowledgeDocumentSchema = z.object({
    url: z
      .string()
      .trim()
      .min(1, "Укажите ссылку на страницу")
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return parsed.protocol === "http:" || parsed.protocol === "https:";
        } catch {
          return false;
        }
      }, "Укажите корректный URL страницы"),
    selectors: crawlSelectorsSchema.optional(),
    language: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    auth: crawlAuthSchema.optional(),
  });

  const updateKnowledgeDocumentSchema = z.object({
    title: z
      .string()
      .trim()
      .min(1, "Укажите название документа")
      .max(500, "Название не должно превышать 500 символов"),
    content: z
      .string()
      .max(20_000_000, "Документ слишком большой. Ограничение — 20 МБ текста")
      .optional(),
  });

  // ========================================================================
  // KNOWLEDGE BASES - TODO: MIGRATE TO knowledge-base.routes.ts
  // ========================================================================

  // ========================================================================
  // ========================================================================

  const knowledgeBaseSearchSettingsPath = "/api/knowledge/bases/:baseId/search/settings";

  async function ensureKnowledgeBaseAccessible(baseId: string, workspaceId: string) {
    const base = await storage.getKnowledgeBase(baseId);
    if (!base || base.workspaceId !== workspaceId) {
      throw new KnowledgeBaseError("База знаний не найдена", 404);
    }
  }

  app
    .route(knowledgeBaseSearchSettingsPath)
    .get(requireAuth, async (req, res) => {
      const { baseId } = req.params;

      try {
        const { id: workspaceId } = getRequestWorkspace(req);
        await ensureKnowledgeBaseAccessible(baseId, workspaceId);

        const record = await storage.getKnowledgeBaseSearchSettings(workspaceId, baseId);
        return res.json(buildSearchSettingsResponse(record));
      } catch (error) {
        if (error instanceof KnowledgeBaseError) {
          return res.status(error.status).json({ error: error.message });
        }

        console.error("Не удалось получить настройки поиска базы знаний:", error);
        return res.status(500).json({ error: "Не удалось получить настройки поиска" });
      }
    })
    .put(requireAuth, async (req, res) => {
      const { baseId } = req.params;

      try {
        const { id: workspaceId } = getRequestWorkspace(req);
        await ensureKnowledgeBaseAccessible(baseId, workspaceId);

        const parsed = knowledgeBaseSearchSettingsSchema.parse(req.body ?? {});
        const chunkSettings = mergeChunkSearchSettings(parsed.chunkSettings ?? null);
        const ragSettings = mergeRagSearchSettings(parsed.ragSettings ?? null, {
          topK: chunkSettings.topK,
          bm25Weight: chunkSettings.bm25Weight,
        });

        const record = await storage.upsertKnowledgeBaseSearchSettings(workspaceId, baseId, {
          chunkSettings: {
            topK: chunkSettings.topK,
            bm25Weight: chunkSettings.bm25Weight,
            synonyms: chunkSettings.synonyms,
            includeDrafts: chunkSettings.includeDrafts,
            highlightResults: chunkSettings.highlightResults,
            filters: chunkSettings.filters,
          },
          ragSettings: {
            topK: ragSettings.topK,
            bm25Weight: ragSettings.bm25Weight,
            bm25Limit: ragSettings.bm25Limit,
            vectorWeight: ragSettings.vectorWeight,
            vectorLimit: ragSettings.vectorLimit,
            embeddingProviderId: ragSettings.embeddingProviderId,
            collection: ragSettings.collection,
            llmProviderId: ragSettings.llmProviderId,
            llmModel: ragSettings.llmModel,
            temperature: ragSettings.temperature,
            maxTokens: ragSettings.maxTokens,
            systemPrompt: ragSettings.systemPrompt,
            responseFormat: ragSettings.responseFormat,
          },
        });

        return res.json(buildSearchSettingsResponse(record));
      } catch (error) {
        if (error instanceof KnowledgeBaseError) {
          return res.status(error.status).json({ error: error.message });
        }

        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: "Некорректные данные", details: error.issues });
        }

        console.error("Не удалось сохранить настройки поиска базы знаний:", error);
        return res.status(500).json({ error: "Не удалось сохранить настройки поиска" });
      }
    });

  // ========================================================================
  // KNOWLEDGE DOCUMENTS ENDPOINTS - TODO: MIGRATE TO knowledge-base.routes.ts
  // ========================================================================


  // Bulk delete pages

  // Statistics endpoint

  const httpServer = createServer(app);
  // Гасим сетевые ошибки, чтобы процесс не падал на обрыве соединения (write EOF и пр.)
  httpServer.on("clientError", (err, socket) => {
    const message = err?.message ?? "";
    // Шум от keep-alive/простоя: Request timeout / ECONNRESET часто валятся, когда клиент закрывает соединение.
    const code = (err && typeof err === "object" && "code" in err && typeof err.code === "string" ? err.code : undefined) as string | undefined;
    const isNoise =
      message.toLowerCase().includes("request timeout") ||
      code === "ECONNRESET" ||
      code === "EPIPE" ||
      code === "ETIMEDOUT";
    if (!isNoise) {
      console.error("[http] clientError:", message || err);
    }
    try {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } catch {}
  });
  // Ловим ошибки на отдельных соединениях, чтобы падения сокета не валили процесс (write EOF и т.п.).
  httpServer.on("connection", (socket) => {
    socket.on("error", (err) => {
      console.error("[http] socket error:", err?.message ?? err);
    });
  });
  httpServer.on("error", (err) => {
    console.error("[http] server error:", err);
  });

  return httpServer;
}
