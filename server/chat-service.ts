import { storage } from "./storage";
import { emitChatMessage } from "./chat-events";
import type { SkillDto } from "@shared/skills";
import { getSkillById, UNICA_CHAT_SYSTEM_KEY } from "./skills";
import { isRagSkill, isUnicaChatSkill } from "./skill-type";
import type {
  ChatSession,
  ChatMessage,
  ChatMessageRole,
  ChatStatus,
  LlmProvider,
  LlmRequestConfig,
  Model,
  AssistantActionType,
} from "@shared/schema";
import { mergeLlmRequestConfig } from "./search/utils";
import { sanitizeLlmModelOptions } from "./llm-utils";
import { skillExecutionLogService } from "./skill-execution-log-context";
import {
  SKILL_EXECUTION_STEP_STATUS,
  type SkillExecutionStepStatus,
  type SkillExecutionStepType,
} from "./skill-execution-log";
import {
  ensureModelAvailable,
  ModelInactiveError,
  ModelUnavailableError,
  ModelValidationError,
  tryResolveModel,
} from "./model-service";
import { resolveEmbeddingProviderForWorkspace } from "./indexing-rules";
import { searchSkillFileVectors } from "./skill-file-vector-store";
import { embedTextWithProvider } from "./skill-file-embeddings";
import type { SyncFinalResult } from "./no-code-events";

export class ChatServiceError extends Error {
  public status: number;
  public code?: string;
  public details?: unknown;

  constructor(message: string, status = 400, code?: string, details?: unknown) {
    super(message);
    this.name = "ChatServiceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ChatSummary = {
  id: string;
  workspaceId: string;
  userId: string;
  skillId: string;
  status: ChatStatus;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
  skillName: string | null;
  skillIsSystem: boolean;
  skillSystemKey: string | null;
  skillStatus: string | null;
  currentAssistantActionType?: AssistantActionType | null;
  currentAssistantActionText?: string | null;
  currentAssistantActionTriggerMessageId?: string | null;
  currentAssistantActionUpdatedAt?: Date | string | null;
  currentAssistantAction?: {
    type: AssistantActionType;
    text: string | null;
    triggerMessageId: string | null;
    updatedAt: string | null;
  } | null;
};

const sanitizeTitle = (title?: string | null) => title?.trim() ?? "";
const clampTemperature = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(2, Math.max(0, value));
};
const clampMaxTokens = (value: number | null | undefined) => {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const rounded = Math.round(value);
  return Math.min(4096, Math.max(16, rounded));
};

type ExecutionLogMeta = {
  input?: unknown;
  output?: unknown;
  errorCode?: string;
  errorMessage?: string;
  diagnosticInfo?: string;
};

async function logExecutionStepForChat(
  executionId: string | null | undefined,
  type: SkillExecutionStepType,
  status: SkillExecutionStepStatus,
  meta: ExecutionLogMeta = {},
) {
  if (!executionId) {
    return;
  }
  try {
    const payload = {
      executionId,
      type,
      input: meta.input,
      output: meta.output,
      errorCode: meta.errorCode,
      errorMessage: meta.errorMessage,
      diagnosticInfo: meta.diagnosticInfo,
    };
    if (status === SKILL_EXECUTION_STEP_STATUS.SUCCESS) {
      await skillExecutionLogService.logStepSuccess(payload);
    } else if (status === SKILL_EXECUTION_STEP_STATUS.ERROR) {
      await skillExecutionLogService.logStepError(payload);
    } else {
      await skillExecutionLogService.logStep({ ...payload, status });
    }
  } catch (error) {
    console.error(`[chat-service] failed to log ${type}:`, error);
  }
}

const describeError = (error: unknown) => {
  if (error instanceof ChatServiceError) {
    return { code: error.code ?? `${error.status}`, message: error.message, diagnosticInfo: undefined as string | undefined };
  }
  if (error instanceof Error) {
    return { code: undefined, message: error.message, diagnosticInfo: error.stack };
  }
  return {
    code: undefined,
    message: typeof error === "string" ? error : "Unknown error",
    diagnosticInfo: undefined as string | undefined,
  };
};

const mapModelErrorToChatError = (error: unknown): ChatServiceError | null => {
  if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
    const status =
      (error as any)?.status ??
      (error instanceof ModelUnavailableError ? 404 : 400);
    return new ChatServiceError(error.message, status, (error as any)?.code);
  }
  return null;
};

const mapAssistantAction = (session: ChatSession): ChatSummary["currentAssistantAction"] => {
  const rawType = (session as any).currentAssistantActionType as AssistantActionType | null | undefined;
  if (!rawType) {
    return null;
  }

  const normalizedType = rawType.toUpperCase() as AssistantActionType;
  return {
    type: normalizedType,
    text: (session as any).currentAssistantActionText ?? null,
    triggerMessageId: (session as any).currentAssistantActionTriggerMessageId ?? null,
    updatedAt:
      (session as any).currentAssistantActionUpdatedAt instanceof Date
        ? (session as any).currentAssistantActionUpdatedAt.toISOString()
        : (session as any).currentAssistantActionUpdatedAt
          ? new Date((session as any).currentAssistantActionUpdatedAt).toISOString()
          : null,
  };
};

export const mapChatSummary = (
  session: ChatSession & {
    skillName: string | null;
    skillIsSystem?: boolean;
    skillSystemKey?: string | null;
    skillStatus?: string | null;
  },
) => ({
  id: session.id,
  workspaceId: session.workspaceId,
  userId: session.userId,
  skillId: session.skillId,
  status: session.status,
  title: session.title,
  skillName: session.skillName,
  skillStatus: (session as any).skillStatus ?? null,
  skillIsSystem: Boolean(session.skillIsSystem),
  skillSystemKey: session.skillSystemKey ?? null,
  currentAssistantActionType: (session as any).currentAssistantActionType ?? null,
  currentAssistantActionText: (session as any).currentAssistantActionText ?? null,
  currentAssistantActionTriggerMessageId: (session as any).currentAssistantActionTriggerMessageId ?? null,
  currentAssistantActionUpdatedAt: (session as any).currentAssistantActionUpdatedAt ?? null,
  currentAssistantAction: mapAssistantAction(session),
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  deletedAt: session.deletedAt ?? null,
});

const ARCHIVED_CHAT_ERROR_MESSAGE = "Чат архивирован. Отправка сообщений недоступна.";
const ARCHIVED_SKILL_ERROR_MESSAGE = "Навык архивирован. Отправка сообщений недоступна.";

export function ensureChatAndSkillAreActive(chat: ChatSummary) {
  if (chat.status === "archived") {
    throw new ChatServiceError(ARCHIVED_CHAT_ERROR_MESSAGE, 403, "CHAT_ARCHIVED");
  }
  if (chat.skillStatus === "archived") {
    throw new ChatServiceError(ARCHIVED_SKILL_ERROR_MESSAGE, 403, "SKILL_ARCHIVED");
  }
}

export function ensureSkillIsActive(skill: SkillDto) {
  if (skill.status === "archived") {
    throw new ChatServiceError(ARCHIVED_SKILL_ERROR_MESSAGE, 403, "SKILL_ARCHIVED");
  }
}

export async function clearAssistantActionForChat(opts: {
  workspaceId: string;
  chatId: string;
  triggerMessageId?: string | null;
}): Promise<void> {
  const chatRecord = await storage.getChatSessionById(opts.chatId);
  if (!chatRecord || chatRecord.workspaceId !== opts.workspaceId) {
    return;
  }
  const chat = mapChatSummary(chatRecord);
  const trigger = opts.triggerMessageId?.trim();
  const current = chat.currentAssistantAction;
  if (current && trigger && current.triggerMessageId && trigger !== current.triggerMessageId) {
    return;
  }

  await storage.clearChatAssistantAction(opts.chatId);
}

// message может приходить как запись из БД или из временных локальных объектов; упрощаем тип для совместимости
export const mapMessage = (message: any) => {
  const metadata = message.metadata ?? {};
  const type = (message as any).messageType ?? (message as any).type ?? "text";
  const cardId = (message as any).cardId ?? (metadata as any)?.cardId ?? null;
  const fileMeta = (metadata as any).file ?? null;
  const file =
    type === "file"
      ? {
          attachmentId: fileMeta?.attachmentId ?? null,
          filename: fileMeta?.filename ?? message.content,
          mimeType: fileMeta?.mimeType ?? null,
          sizeBytes: typeof fileMeta?.sizeBytes === "number" ? fileMeta.sizeBytes : null,
          uploadedByUserId: fileMeta?.uploadedByUserId ?? null,
          downloadUrl: fileMeta?.downloadUrl ?? `/api/chat/messages/${message.id}/file`,
          expiresAt: fileMeta?.expiresAt ?? null,
        }
      : undefined;

  return {
    id: message.id,
    chatId: message.chatId,
    role: message.role,
    type,
    cardId,
    content: message.content,
    metadata,
    file,
    // Всегда возвращаем ISO в UTC; отображение в UI — локальное время браузера.
    createdAt: new Date(message.createdAt ?? Date.now()).toISOString(),
  };
};

async function getOwnedChat(
  chatId: string,
  workspaceId: string,
  userId: string,
): Promise<ChatSummary> {
  const chat = await storage.getChatSessionById(chatId);
  if (!chat || chat.workspaceId !== workspaceId || chat.userId !== userId) {
    throw new ChatServiceError("Чат не найден", 404);
  }
  return mapChatSummary(chat);
}

export async function listUserChats(
  workspaceId: string,
  userId: string,
  searchQuery?: string,
  options: { includeArchived?: boolean } = {},
) {
  const chats = await storage.listChatSessions(workspaceId, userId, searchQuery, options);
  return chats.map(mapChatSummary);
}

export async function getChatById(chatId: string, workspaceId: string, userId: string) {
  return await getOwnedChat(chatId, workspaceId, userId);
}

export async function createChat({
  workspaceId,
  userId,
  skillId,
  title,
}: {
  workspaceId: string;
  userId: string;
  skillId: string;
  title?: string;
}) {
  const skill = await getSkillById(workspaceId, skillId);
  if (!skill) {
    throw new ChatServiceError("Навык не найден", 404);
  }

  const session = await storage.createChatSession({
    workspaceId,
    userId,
    skillId,
    title: sanitizeTitle(title),
  });

  return mapChatSummary({
    ...session,
    skillName: skill.name ?? null,
    skillIsSystem: Boolean(skill.isSystem),
    skillSystemKey: skill.systemKey ?? null,
  });
}

export async function renameChat(
  chatId: string,
  workspaceId: string,
  userId: string,
  title: string,
) {
  await getOwnedChat(chatId, workspaceId, userId);
  const updated = await storage.updateChatSession(chatId, { title: sanitizeTitle(title) });
  if (!updated) {
    throw new ChatServiceError("Чат не найден", 404);
  }
  const session = await storage.getChatSessionById(chatId);
  if (!session) {
    throw new ChatServiceError("Чат не найден", 404);
  }
  return mapChatSummary(session);
}

export async function deleteChat(chatId: string, workspaceId: string, userId: string) {
  await getOwnedChat(chatId, workspaceId, userId);
  await storage.softDeleteChatSession(chatId);
}

export async function getChatMessages(
  chatId: string,
  workspaceId: string,
  userId: string,
) {
  await getOwnedChat(chatId, workspaceId, userId);
  const messages = await storage.listChatMessages(chatId);
  return messages.map(mapMessage);
}

export async function addUserMessage(
  chatId: string,
  workspaceId: string,
  userId: string,
  content: string,
) {
  const chat = await getOwnedChat(chatId, workspaceId, userId);
  ensureChatAndSkillAreActive(chat);
  const message = await storage.createChatMessage({
    chatId,
    role: "user",
    messageType: "text",
    content,
    metadata: {},
  });
  await storage.touchChatSession(chatId);
  const mapped = mapMessage(message);
  emitChatMessage(chatId, mapped);
  return mapped;
}

export type ChatConversationMessage = {
  role: ChatMessageRole;
  content: string;
};

export function applyContextLimitByCharacters(
  messages: ChatConversationMessage[],
  limit: number | null,
): ChatConversationMessage[] {
  if (!limit || limit <= 0) return messages;
  const reversed: ChatConversationMessage[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i];
    const len = (entry.content ?? "").length;
    if (total + len > limit && reversed.length > 0) {
      break;
    }
    total += len;
    reversed.push(entry);
  }
  return reversed.reverse();
}

export type ChatSkillType = "UNICA_CHAT" | "RAG_SKILL" | "LLM_SKILL";

export type ChatSkillContext = {
  id: string;
  name: string | null;
  isSystem: boolean;
  systemKey: string | null;
  type: ChatSkillType;
  isUnicaChat: boolean;
  isRagSkill: boolean;
   mode: "rag" | "llm";
};

export type ChatLlmContext = {
  chat: ChatSummary;
  skill: ChatSkillContext;
  skillConfig: SkillDto;
  provider: LlmProvider;
  requestConfig: LlmRequestConfig;
  model: string | null;
  modelInfo: Model | null;
  messages: ChatConversationMessage[];
  contextInputLimit: number | null;
  retrievedContext?: string[];
};

class RetrievalTimeoutError extends Error {
  constructor(public readonly operation: string, public readonly timeoutMs: number) {
    super(`Retrieval timeout: ${operation} exceeded ${timeoutMs}ms`);
    this.name = "RetrievalTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer: NodeJS.Timeout | null = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new RetrievalTimeoutError(operation, timeoutMs));
      }, timeoutMs);
    }),
  ]);
}

const EMBED_TIMEOUT_MS = Number(process.env.CHAT_RETRIEVAL_EMBED_TIMEOUT_MS ?? "800");
const VECTOR_TIMEOUT_MS = Number(process.env.CHAT_RETRIEVAL_VECTOR_TIMEOUT_MS ?? "800");

async function buildSkillRetrievalContext(options: {
  workspaceId: string;
  skill: SkillDto;
  userMessage: string;
}): Promise<string[] | null> {
  const { workspaceId, skill, userMessage } = options;
  const readyFileIds = await storage.listReadySkillFileIds(workspaceId, skill.id);
  if (readyFileIds.length === 0) {
    return null;
  }

  let provider;
  let rules;
  try {
    const resolved = await resolveEmbeddingProviderForWorkspace({ workspaceId });
    provider = resolved.provider;
    rules = resolved.rules;
  } catch (error) {
    console.warn("[chat-retrieval] embedding provider not available", { workspaceId, skillId: skill.id, error });
    return null;
  }

  let embedding;
  try {
    embedding = await withTimeout(
      embedTextWithProvider(provider, userMessage),
      EMBED_TIMEOUT_MS,
      "query_embedding",
    );
  } catch (error) {
    console.warn("[chat-retrieval] failed to embed user message", { workspaceId, skillId: skill.id, error });
    return null;
  }

  let searchResult;
  try {
    searchResult = await withTimeout(
      searchSkillFileVectors({
        workspaceId,
        skillId: skill.id,
        provider,
        vector: embedding.vector,
        limit: rules.topK ?? 6,
        caller: "chat_runtime",
      }),
      VECTOR_TIMEOUT_MS,
      "vector_search",
    );
  } catch (error) {
    console.warn("[chat-retrieval] vector search failed", { workspaceId, skillId: skill.id, error });
    return null;
  }

  if (!searchResult || searchResult.guardrailTriggered) {
    return null;
  }

  const threshold = rules.relevanceThreshold ?? 0;
  const filtered = (searchResult.results ?? []).filter((item) => {
    const score = typeof item.score === "number" ? item.score : null;
    if (score !== null && score < threshold) {
      return false;
    }
    const docId = typeof (item.payload as any)?.doc_id === "string" ? (item.payload as any).doc_id : null;
    if (docId && !readyFileIds.includes(docId)) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    return null;
  }

  const fragments: string[] = [];
  for (const entry of filtered.slice(0, rules.topK ?? 6)) {
    const textCandidate = (entry.payload as any)?.chunk_text ?? (entry.payload as any)?.text ?? null;
    if (typeof textCandidate === "string" && textCandidate.trim()) {
      fragments.push(textCandidate.trim());
    }
  }

  if (fragments.length > 0) {
    console.info("[chat-retrieval] scope", {
      workspaceId,
      skillId: skill.id,
      topK: rules.topK ?? null,
      threshold: rules.relevanceThreshold ?? null,
      results: fragments.length,
    });
  }

  return fragments.length > 0 ? fragments : null;
}

export const __chatServiceTestUtils = {
  buildSkillRetrievalContext,
};

export type BuildChatLlmContextOptions = {
  executionId?: string | null;
};

export async function buildChatLlmContext(
  chatId: string,
  workspaceId: string,
  userId: string,
  options?: BuildChatLlmContextOptions,
): Promise<ChatLlmContext> {
  const executionId = options?.executionId ?? null;
  const chat = await getOwnedChat(chatId, workspaceId, userId);

  try {
    ensureChatAndSkillAreActive(chat);
  } catch (error) {
    const info = describeError(error);
    await logExecutionStepForChat(executionId, "LOAD_SKILL_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
      input: { chatId, workspaceId, skillId: chat.skillId },
      errorCode: info.code,
      errorMessage: info.message,
      diagnosticInfo: info.diagnosticInfo,
    });
    throw error;
  }

  let skill;
  try {
    skill = await getSkillById(workspaceId, chat.skillId);
  } catch (error) {
    const info = describeError(error);
    await logExecutionStepForChat(executionId, "LOAD_SKILL_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
      input: { chatId, workspaceId, skillId: chat.skillId },
      errorCode: info.code,
      errorMessage: info.message,
      diagnosticInfo: info.diagnosticInfo,
    });
    throw error;
  }

  if (!skill) {
    const notFound = new ChatServiceError("Навык не найден", 404);
    const info = describeError(notFound);
    await logExecutionStepForChat(executionId, "LOAD_SKILL_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
      input: { chatId, workspaceId, skillId: chat.skillId },
      errorCode: info.code,
      errorMessage: info.message,
      diagnosticInfo: info.diagnosticInfo,
    });
    throw notFound;
  }

  ensureSkillIsActive(skill);

  const isUnica = isUnicaChatSkill(skill);
  const isRag = isRagSkill(skill);
  const isLlmMode = !isRag;
  const skillType: ChatSkillType = isUnica ? "UNICA_CHAT" : isRag ? "RAG_SKILL" : "LLM_SKILL";
  const skillContext: ChatSkillContext = {
    id: skill.id,
    name: skill.name ?? null,
    isSystem: Boolean(skill.isSystem),
    systemKey: skill.systemKey ?? null,
    type: skillType,
    isUnicaChat: isUnica,
    isRagSkill: isRag,
    mode: isLlmMode ? "llm" : "rag",
  };

  await logExecutionStepForChat(executionId, "LOAD_SKILL_CONFIG", SKILL_EXECUTION_STEP_STATUS.SUCCESS, {
    input: { chatId, workspaceId, skillId: chat.skillId },
    output: {
      skillId: skill.id,
      isSystem: skillContext.isSystem,
      systemKey: skillContext.systemKey,
      skillType: skillContext.type,
      mode: skillContext.mode,
      providerId: skill.llmProviderConfigId ?? null,
      modelId: skill.modelId ?? null,
      hasSystemPrompt: Boolean(skill.systemPrompt && skill.systemPrompt.trim()),
    },
  });

  let providerId = skill.llmProviderConfigId ?? null;
  let modelOverride = skill.modelId ?? null;
  let modelInfo: Model | null = null;
  let systemPromptOverride = skill.systemPrompt ?? null;
  const requestOverrides: Partial<LlmRequestConfig> = {};
  let providerSource: "skill" | "global_unica_chat" = "skill";

  if (isUnica) {
    const unicaConfig = await storage.getUnicaChatConfig();
    if (unicaConfig.llmProviderConfigId) {
      providerId = unicaConfig.llmProviderConfigId;
      providerSource = "global_unica_chat";
    }
    if (typeof unicaConfig.modelId === "string" && unicaConfig.modelId.trim()) {
      modelOverride = unicaConfig.modelId.trim();
    }
    if (typeof unicaConfig.systemPrompt === "string") {
      systemPromptOverride = unicaConfig.systemPrompt;
    }

    if (typeof unicaConfig.temperature === "number") {
      requestOverrides.temperature = unicaConfig.temperature;
    }
    if (typeof unicaConfig.topP === "number") {
      requestOverrides.topP = unicaConfig.topP;
    }
    if (typeof unicaConfig.maxTokens === "number") {
      requestOverrides.maxTokens = unicaConfig.maxTokens;
    }
  }
  if (!isUnica) {
    const skillTemperature = clampTemperature(skill.ragConfig?.llmTemperature ?? null);
    if (skillTemperature !== null) {
      requestOverrides.temperature = skillTemperature;
    }
    const skillMaxTokens = clampMaxTokens(skill.ragConfig?.llmMaxTokens ?? null);
    if (skillMaxTokens !== null) {
      requestOverrides.maxTokens = skillMaxTokens;
    }
  }

  const providerLogInput = {
    chatId,
    workspaceId,
    skillId: chat.skillId,
    providerSourceCandidate: providerSource,
    skillProviderId: skill.llmProviderConfigId ?? null,
  };

  if (!providerId) {
    const providerError = new ChatServiceError("Не удалось определить LLM-провайдера", 400);
    const info = describeError(providerError);
    await logExecutionStepForChat(executionId, "RESOLVE_LLM_PROVIDER_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
      input: providerLogInput,
      errorCode: info.code,
      errorMessage: info.message,
    });
    throw providerError;
  }

  let provider: LlmProvider | null = null;
  try {
    const resolved = await storage.getLlmProvider(providerId, workspaceId);
    provider = resolved ?? null;
  } catch (error) {
    const info = describeError(error);
    await logExecutionStepForChat(executionId, "RESOLVE_LLM_PROVIDER_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
      input: { ...providerLogInput, providerId },
      errorCode: info.code,
      errorMessage: info.message,
      diagnosticInfo: info.diagnosticInfo,
    });
    throw error;
  }

  if (!provider) {
    const notFound = new ChatServiceError("LLM-провайдер не найден", 404);
    const info = describeError(notFound);
    await logExecutionStepForChat(executionId, "RESOLVE_LLM_PROVIDER_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
      input: { ...providerLogInput, providerId },
      errorCode: info.code,
      errorMessage: info.message,
    });
    throw notFound;
  }

  if (!provider.isActive) {
    const inactive = new ChatServiceError("LLM-провайдер отключён", 400);
    const info = describeError(inactive);
    await logExecutionStepForChat(executionId, "RESOLVE_LLM_PROVIDER_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
      input: { ...providerLogInput, providerId },
      errorCode: info.code,
      errorMessage: info.message,
    });
    throw inactive;
  }

  const requestConfig = mergeLlmRequestConfig(provider);
  if (systemPromptOverride && systemPromptOverride.trim()) {
    requestConfig.systemPrompt = systemPromptOverride.trim();
  }

  if (requestOverrides.temperature !== undefined) {
    requestConfig.temperature = requestOverrides.temperature;
  }
  if (requestOverrides.topP !== undefined) {
    requestConfig.topP = requestOverrides.topP;
  }
  if (requestOverrides.maxTokens !== undefined) {
    requestConfig.maxTokens = requestOverrides.maxTokens;
  }

  const configuredProvider: LlmProvider = {
    ...provider,
    requestConfig,
  };

  const preferredModel = modelOverride?.trim() ?? null;
  const modelLogInput = { ...providerLogInput, providerId, modelOverride: preferredModel ?? null };
  if (preferredModel) {
    try {
      modelInfo = await ensureModelAvailable(preferredModel, { expectedType: "LLM" });
    } catch (error) {
      const mapped = mapModelErrorToChatError(error);
      const info = describeError(mapped ?? error);
      await logExecutionStepForChat(executionId, "RESOLVE_LLM_PROVIDER_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
        input: modelLogInput,
        errorCode: info.code,
        errorMessage: info.message,
        diagnosticInfo: info.diagnosticInfo,
      });
      throw mapped ?? error;
    }
  }

  const sanitizedModels = sanitizeLlmModelOptions(provider.availableModels);
  const normalizeModel = (value: string | null) =>
    value
      ? sanitizedModels.find((candidate) => candidate.value === value)?.value ??
        sanitizedModels.find((candidate) => candidate.label === value)?.value ??
        value
      : null;
  const resolvedModelKey =
    normalizeModel(modelInfo?.modelKey ?? preferredModel) ?? normalizeModel(provider.model?.trim() ?? null);

  if (!modelInfo && resolvedModelKey) {
    try {
      modelInfo = await ensureModelAvailable(resolvedModelKey, { expectedType: "LLM" });
    } catch (error) {
      const mapped = mapModelErrorToChatError(error);
      const info = describeError(mapped ?? error);
      await logExecutionStepForChat(executionId, "RESOLVE_LLM_PROVIDER_CONFIG", SKILL_EXECUTION_STEP_STATUS.ERROR, {
        input: { ...providerLogInput, providerId, resolvedModelKey },
        errorCode: info.code,
        errorMessage: info.message,
        diagnosticInfo: info.diagnosticInfo,
      });
      throw mapped ?? error;
    }
  }

  await logExecutionStepForChat(executionId, "RESOLVE_LLM_PROVIDER_CONFIG", SKILL_EXECUTION_STEP_STATUS.SUCCESS, {
    input: { ...providerLogInput, providerId },
    output: {
      providerId,
      providerSource,
      modelKey: resolvedModelKey ?? provider.model ?? null,
      modelId: modelInfo?.id ?? null,
      modelDisplayName: modelInfo?.displayName ?? null,
      overrides: {
        hasSystemPromptOverride: Boolean(systemPromptOverride && systemPromptOverride.trim()),
        temperature: requestOverrides.temperature ?? null,
        topP: requestOverrides.topP ?? null,
        maxTokens: requestOverrides.maxTokens ?? null,
        contextInputLimit: skill.contextInputLimit ?? null,
      },
    },
  });

  const chatMessages = await storage.listChatMessages(chatId);
  const conversation: ChatConversationMessage[] = chatMessages.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  const contextLimit = skill.contextInputLimit ?? null;
  const limitedConversation = applyContextLimitByCharacters(conversation, contextLimit);
  let retrievedContext: string[] | undefined;

  const lastUserMessage = [...limitedConversation].reverse().find((entry) => entry.role === "user");
  if (lastUserMessage?.content) {
    try {
      const fragments = await buildSkillRetrievalContext({
        workspaceId,
        skill,
        userMessage: lastUserMessage.content,
      });
      if (fragments && fragments.length > 0) {
        retrievedContext = fragments;
      }
    } catch (error) {
      console.warn("[chat-retrieval] unexpected error while building context", {
        workspaceId,
        skillId: skill.id,
        error,
      });
    }
  }

  return {
    chat,
    skill: skillContext,
    skillConfig: skill,
    provider: configuredProvider,
    requestConfig,
    model: resolvedModelKey ?? null,
    modelInfo,
    messages: limitedConversation,
    contextInputLimit: contextLimit,
    retrievedContext,
  };
}

export function buildChatCompletionRequestBody(
  context: ChatLlmContext,
  options?: { stream?: boolean },
) {
  const { requestConfig } = context;
  const messagesField = requestConfig.messagesField;
  const modelField = requestConfig.modelField;

  const llmMessages: Array<{ role: string; content: string }> = [];
  const systemPrompt = requestConfig.systemPrompt?.trim();

  if (systemPrompt) {
    llmMessages.push({ role: "system", content: systemPrompt });
  }

  if (context.retrievedContext && context.retrievedContext.length > 0) {
    const contextLines = context.retrievedContext
      .slice(0, requestConfig.maxTokens ? Math.max(1, Math.min(context.retrievedContext.length, 8)) : 8)
      .map((entry, index) => `${index + 1}. ${entry}`)
      .join("\n");
    llmMessages.push({
      role: "system",
      content: `Контекст из документов навыка (используй только как фактологическую опору, не придумывай новое):\n${contextLines}`,
    });
  }

  for (const message of context.messages) {
    const content = message.content?.trim();
    if (!content) {
      continue;
    }
    llmMessages.push({ role: message.role, content });
  }

  const body: Record<string, unknown> = {
    [messagesField]: llmMessages,
    [modelField]: context.model ?? context.provider.model,
  };

  if (requestConfig.temperature !== undefined) {
    body.temperature = requestConfig.temperature;
  }
  if (requestConfig.maxTokens !== undefined) {
    body.max_tokens = requestConfig.maxTokens;
  }
  if (requestConfig.topP !== undefined) {
    body.top_p = requestConfig.topP;
  }
  if (requestConfig.presencePenalty !== undefined) {
    body.presence_penalty = requestConfig.presencePenalty;
  }
  if (requestConfig.frequencyPenalty !== undefined) {
    body.frequency_penalty = requestConfig.frequencyPenalty;
  }

  const additionalFields = requestConfig.additionalBodyFields ?? {};
  for (const [key, value] of Object.entries(additionalFields)) {
    if (body[key] === undefined) {
      body[key] = value;
    }
  }

  if (options?.stream !== undefined) {
    body.stream = options.stream;
  } else if (body.stream === undefined && context.provider.providerType === "gigachat") {
    body.stream = true;
  }

  return body;
}

export async function addAssistantMessage(
  chatId: string,
  workspaceId: string,
  userId: string,
  content: string,
  metadata?: Record<string, unknown>,
) {
  await getOwnedChat(chatId, workspaceId, userId);
  const message = await storage.createChatMessage({
    chatId,
    role: "assistant",
    messageType: "text",
    content,
    metadata: metadata ?? {},
  });
  await storage.touchChatSession(chatId);
  const mapped = mapMessage(message);
  emitChatMessage(chatId, mapped);
  return mapped;
}

export async function addNoCodeCallbackMessage(opts: {
  chatId: string;
  workspaceId: string;
  role: ChatMessageRole;
  content: string;
  messageType?: "text" | "card";
  cardId?: string | null;
  triggerMessageId?: string | null;
  metadata?: Record<string, unknown> | null;
  expectedSkillId?: string | null;
}): Promise<ReturnType<typeof mapMessage>> {
  const chatRecord = await storage.getChatSessionById(opts.chatId);
  if (!chatRecord || chatRecord.workspaceId !== opts.workspaceId) {
    throw new ChatServiceError("Чат не найден", 404);
  }

  if (opts.expectedSkillId && chatRecord.skillId !== opts.expectedSkillId) {
    throw new ChatServiceError("Неверный callback-ключ для навыка", 403);
  }

  const chat = mapChatSummary(chatRecord);
  ensureChatAndSkillAreActive(chat);

  const skill = await getSkillById(opts.workspaceId, chat.skillId);
  if (!skill) {
    throw new ChatServiceError("Навык не найден", 404);
  }
  ensureSkillIsActive(skill);
  if (skill.executionMode !== "no_code") {
    throw new ChatServiceError("Навык не находится в no-code режиме", 409, "NO_CODE_MODE_REQUIRED");
  }

  const content = opts.content?.trim() ?? "";
  if (!content) {
    throw new ChatServiceError("Сообщение не может быть пустым", 400);
  }

  const metadata: Record<string, unknown> = { ...(opts.metadata ?? {}) };
  if (opts.cardId) {
    metadata.cardId = opts.cardId;
  }
  const triggerMessageId = opts.triggerMessageId?.trim() ?? "";
  if (triggerMessageId) {
    metadata.triggerMessageId = triggerMessageId;
  }

  const message = await storage.createChatMessage({
    chatId: opts.chatId,
    role: opts.role,
    content,
    messageType: opts.messageType ?? "text",
    cardId: opts.cardId ?? undefined,
    metadata,
  });
  await storage.touchChatSession(opts.chatId);
  await clearAssistantActionForChat({
    workspaceId: opts.workspaceId,
    chatId: opts.chatId,
    triggerMessageId,
  });
  const mapped = mapMessage(message);
  emitChatMessage(opts.chatId, mapped);
  return mapped;
}

export async function addNoCodeSyncFinalResults(opts: {
  workspaceId: string;
  chatId: string;
  skillId: string;
  triggerMessageId: string;
  results: SyncFinalResult[];
}): Promise<Array<ReturnType<typeof mapMessage>>> {
  const chatRecord = await storage.getChatSessionById(opts.chatId);
  if (!chatRecord || chatRecord.workspaceId !== opts.workspaceId) {
    throw new ChatServiceError("Чат не найден", 404);
  }
  const chat = mapChatSummary(chatRecord);
  ensureChatAndSkillAreActive(chat);

  const skill = await getSkillById(opts.workspaceId, chat.skillId);
  if (!skill) {
    throw new ChatServiceError("Навык не найден", 404);
  }
  ensureSkillIsActive(skill);
  if (skill.executionMode !== "no_code") {
    throw new ChatServiceError("Навык не находится в no-code режиме", 409, "NO_CODE_MODE_REQUIRED");
  }

  const created: Array<ReturnType<typeof mapMessage>> = [];
  const newMessages: Array<ReturnType<typeof mapMessage>> = [];
  let createdNew = false;

  for (const result of opts.results) {
    const content = result.text?.trim() ?? "";
    if (!content) {
      continue;
    }

    const existing = await storage.findChatMessageByResultId(opts.chatId, result.resultId);
    if (existing) {
      created.push(mapMessage(existing));
      continue;
    }

    const metadata: Record<string, unknown> = {
      resultId: result.resultId,
    };
    const triggerMessageId = result.triggerMessageId?.trim() || opts.triggerMessageId || "";
    if (triggerMessageId) {
      metadata.triggerMessageId = triggerMessageId;
    }

    const message = await storage.createChatMessage({
      chatId: opts.chatId,
      role: result.role,
      messageType: (result as any).messageType ?? "text",
      content,
      metadata,
    });
    const mapped = mapMessage(message);
    created.push(mapped);
    newMessages.push(mapped);
    createdNew = true;
  }

  if (created.length > 0) {
    await storage.touchChatSession(opts.chatId);
  }

  if (createdNew) {
    await clearAssistantActionForChat({
      workspaceId: opts.workspaceId,
      chatId: opts.chatId,
      triggerMessageId: opts.triggerMessageId,
    });
  }

  if (newMessages.length > 0) {
    newMessages.forEach((message) => emitChatMessage(opts.chatId, message));
  }

  return created;
}

export async function addNoCodeStreamChunk(opts: {
  workspaceId: string;
  chatId: string;
  streamId: string;
  triggerMessageId: string;
  chunkId: string;
  delta?: string | null;
  role?: ChatMessageRole;
  isFinal?: boolean;
  seq?: number | null;
}): Promise<ReturnType<typeof mapMessage>> {
  const chatRecord = await storage.getChatSessionById(opts.chatId);
  if (!chatRecord || chatRecord.workspaceId !== opts.workspaceId) {
    throw new ChatServiceError("Чат не найден", 404);
  }
  const chat = mapChatSummary(chatRecord);
  ensureChatAndSkillAreActive(chat);

  const skill = await getSkillById(opts.workspaceId, chat.skillId);
  if (!skill) {
    throw new ChatServiceError("Навык не найден", 404);
  }
  ensureSkillIsActive(skill);
  if (skill.executionMode !== "no_code") {
    throw new ChatServiceError("Навык не находится в no-code режиме", 409, "NO_CODE_MODE_REQUIRED");
  }

  const role: ChatMessageRole = opts.role ?? "assistant";
  if (!["assistant", "user", "system"].includes(role)) {
    throw new ChatServiceError("Некорректная роль", 400);
  }

  const streamId = opts.streamId.trim();
  const chunkId = opts.chunkId.trim();
  const triggerMessageId = opts.triggerMessageId.trim();
  if (!streamId || !chunkId || !triggerMessageId) {
    throw new ChatServiceError("streamId, chunkId и triggerMessageId обязательны", 400);
  }

  const delta = opts.delta ?? "";
  const existing = await storage.findChatMessageByStreamId(opts.chatId, streamId);

  if (existing) {
    const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
    const processedChunks = Array.isArray(existingMetadata.processedChunkIds)
      ? existingMetadata.processedChunkIds.map((id) => String(id))
      : [];
    if (processedChunks.includes(chunkId)) {
      return mapMessage(existing);
    }

    const nextContent = `${existing.content ?? ""}${delta}`;
    const nextMetadata = {
      ...existingMetadata,
      triggerMessageId,
      streamId,
      processedChunkIds: [...processedChunks, chunkId],
      streamSeq: opts.seq ?? existingMetadata.streamSeq ?? null,
      streaming: !opts.isFinal,
    };

    const updated = await storage.updateChatMessage(existing.id, {
      content: nextContent,
      metadata: nextMetadata,
    });
    if (!updated) {
      throw new ChatServiceError("Не удалось обновить сообщение стрима", 500);
    }
    await storage.touchChatSession(opts.chatId);
    return mapMessage(updated);
  }

  const metadata: Record<string, unknown> = {
    triggerMessageId,
    streamId,
    processedChunkIds: [chunkId],
    streamSeq: opts.seq ?? null,
    streaming: !opts.isFinal,
  };

  const message = await storage.createChatMessage({
    chatId: opts.chatId,
    role,
    messageType: "text",
    content: delta,
    metadata,
  });
  await storage.touchChatSession(opts.chatId);
  await clearAssistantActionForChat({
    workspaceId: opts.workspaceId,
    chatId: opts.chatId,
    triggerMessageId,
  });
  return mapMessage(message);
}

export async function setNoCodeAssistantAction(opts: {
  workspaceId: string;
  chatId: string;
  actionType: AssistantActionType;
  actionText?: string | null;
  triggerMessageId?: string | null;
  occurredAt?: string | Date | null;
}): Promise<ChatSummary> {
  const chatRecord = await storage.getChatSessionById(opts.chatId);
  if (!chatRecord || chatRecord.workspaceId !== opts.workspaceId) {
    throw new ChatServiceError("Чат не найден", 404);
  }

  const chat = mapChatSummary(chatRecord);
  ensureChatAndSkillAreActive(chat);

  const skill = await getSkillById(opts.workspaceId, chat.skillId);
  if (!skill) {
    throw new ChatServiceError("Навык не найден", 404);
  }
  ensureSkillIsActive(skill);
  if (skill.executionMode !== "no_code") {
    throw new ChatServiceError("Навык не находится в no-code режиме", 409, "NO_CODE_MODE_REQUIRED");
  }

  let normalizedOccurredAt: Date | null = null;
  if (opts.occurredAt) {
    const parsed =
      opts.occurredAt instanceof Date ? opts.occurredAt : new Date(opts.occurredAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new ChatServiceError("Некорректное значение occurredAt", 400);
    }
    normalizedOccurredAt = parsed;
  }

  const normalizedText = opts.actionText?.trim() ?? "";
  const normalizedTrigger = opts.triggerMessageId?.trim() ?? "";

  const updated = await storage.setChatAssistantAction(chat.id, {
    type: opts.actionType,
    text: normalizedText.length > 0 ? normalizedText : null,
    triggerMessageId: normalizedTrigger.length > 0 ? normalizedTrigger : null,
    updatedAt: normalizedOccurredAt ?? new Date(),
  });

  if (!updated) {
    throw new ChatServiceError("Не удалось обновить состояние действия", 500);
  }

  return mapChatSummary({
    ...updated,
    skillName: chat.skillName,
    skillIsSystem: chat.skillIsSystem,
    skillSystemKey: chat.skillSystemKey,
    skillStatus: chat.skillStatus,
  } as any);
}
