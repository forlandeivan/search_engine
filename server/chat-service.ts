import { storage } from "./storage";
import type { SkillDto } from "@shared/skills";
import { getSkillById, UNICA_CHAT_SYSTEM_KEY } from "./skills";
import { isRagSkill, isUnicaChatSkill } from "./skill-type";
import type { ChatSession, ChatMessage, ChatMessageRole, LlmProvider, LlmRequestConfig, Model } from "@shared/schema";
import { mergeLlmRequestConfig } from "./search/utils";
import { sanitizeLlmModelOptions } from "./llm-utils";
import { skillExecutionLogService } from "./skill-execution-log-context";
import {
  SKILL_EXECUTION_STEP_STATUS,
  type SkillExecutionStepStatus,
  type SkillExecutionStepType,
} from "./skill-execution-log";
import { ensureModelAvailable, tryResolveModel, ModelValidationError, ModelUnavailableError } from "./model-service";

export class ChatServiceError extends Error {
  public status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ChatServiceError";
    this.status = status;
  }
}

export type ChatSummary = ChatSession & {
  skillName: string | null;
  skillIsSystem: boolean;
  skillSystemKey: string | null;
};

const sanitizeTitle = (title?: string | null) => title?.trim() ?? "";

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
    return { code: `${error.status}`, message: error.message, diagnosticInfo: undefined as string | undefined };
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
  if (error instanceof ModelValidationError || error instanceof ModelUnavailableError) {
    const status = (error as any)?.status ?? (error instanceof ModelUnavailableError ? 404 : 400);
    return new ChatServiceError(error.message, status);
  }
  return null;
};

const mapChatSummary = (
  session: ChatSession & { skillName: string | null; skillIsSystem?: boolean; skillSystemKey?: string | null },
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
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  deletedAt: session.deletedAt ?? null,
});

const mapMessage = (message: ChatMessage) => ({
  id: message.id,
  chatId: message.chatId,
  role: message.role,
  content: message.content,
  metadata: message.metadata ?? {},
  // Всегда возвращаем ISO в UTC; отображение в UI — локальное время браузера.
  createdAt: new Date(message.createdAt ?? Date.now()).toISOString(),
});

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
  await getOwnedChat(chatId, workspaceId, userId);
  const message = await storage.createChatMessage({
    chatId,
    role: "user",
    content,
    metadata: {},
  });
  await storage.touchChatSession(chatId);
  return mapMessage(message);
}

type ChatConversationMessage = {
  role: ChatMessageRole;
  content: string;
};

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

  const isUnica = isUnicaChatSkill(skill);
  const isRag = isRagSkill(skill);
  const isLlmMode = skill.mode === "llm";
  const skillType: ChatSkillType = isUnica ? "UNICA_CHAT" : isLlmMode ? "LLM_SKILL" : "RAG_SKILL";
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
      modelInfo = await tryResolveModel(resolvedModelKey, { expectedType: "LLM" });
    } catch (error) {
      const mapped = mapModelErrorToChatError(error);
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
      },
    },
  });

  const chatMessages = await storage.listChatMessages(chatId);
  const conversation: ChatConversationMessage[] = chatMessages.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  // TODO: for skillContext.isRagSkill, enrich conversation with RAG context before calling LLM.

  return {
    chat,
    skill: skillContext,
    skillConfig: skill,
    provider: configuredProvider,
    requestConfig,
    model: resolvedModelKey ?? null,
    modelInfo,
    messages: conversation,
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
    content,
    metadata: metadata ?? {},
  });
  await storage.touchChatSession(chatId);
  return mapMessage(message);
}
