import { storage } from "./storage";
import { getSkillById, UNICA_CHAT_SYSTEM_KEY } from "./skills";
import type { ChatSession, ChatMessage, ChatMessageRole, LlmProvider, LlmRequestConfig } from "@shared/schema";
import { mergeLlmRequestConfig } from "./search/utils";
import { sanitizeLlmModelOptions } from "./llm-utils";

export class ChatServiceError extends Error {
  public status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ChatServiceError";
    this.status = status;
  }
}

export type ChatSummary = ChatSession & { skillName: string | null };

const sanitizeTitle = (title?: string | null) => title?.trim() ?? "";

const mapChatSummary = (session: ChatSession & { skillName: string | null }) => ({
  id: session.id,
  workspaceId: session.workspaceId,
  userId: session.userId,
  skillId: session.skillId,
  title: session.title,
  skillName: session.skillName,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
});

const mapMessage = (message: ChatMessage) => ({
  id: message.id,
  chatId: message.chatId,
  role: message.role,
  content: message.content,
  metadata: message.metadata ?? {},
  createdAt: message.createdAt,
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
) {
  const chats = await storage.listChatSessions(workspaceId, userId, searchQuery);
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

  return mapChatSummary({ ...session, skillName: skill.name ?? null });
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

export type ChatLlmContext = {
  chat: ChatSummary;
  provider: LlmProvider;
  requestConfig: LlmRequestConfig;
  model: string | null;
  messages: ChatConversationMessage[];
};

export async function buildChatLlmContext(
  chatId: string,
  workspaceId: string,
  userId: string,
): Promise<ChatLlmContext> {
  const chat = await getOwnedChat(chatId, workspaceId, userId);
  const skill = await getSkillById(workspaceId, chat.skillId);
  if (!skill) {
    throw new ChatServiceError("Навык не найден", 404);
  }

  let providerId = skill.llmProviderConfigId ?? null;
  let modelOverride = skill.modelId ?? null;
  let systemPromptOverride = skill.systemPrompt ?? null;
  const requestOverrides: Partial<LlmRequestConfig> = {};

  if (skill.isSystem && skill.systemKey === UNICA_CHAT_SYSTEM_KEY) {
    const unicaConfig = await storage.getUnicaChatConfig();
    if (unicaConfig.llmProviderConfigId) {
      providerId = unicaConfig.llmProviderConfigId;
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

  if (!providerId) {
    throw new ChatServiceError("Для навыка не настроен провайдер LLM", 400);
  }

  const provider = await storage.getLlmProvider(providerId, workspaceId);
  if (!provider) {
    throw new ChatServiceError("LLM-провайдер не найден", 404);
  }

  if (!provider.isActive) {
    throw new ChatServiceError("LLM-провайдер отключён", 400);
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

  const sanitizedModels = sanitizeLlmModelOptions(provider.availableModels);
  let resolvedModel: string | null = null;

  if (modelOverride && modelOverride.trim().length > 0) {
    const trimmed = modelOverride.trim();
    resolvedModel =
      sanitizedModels.find((candidate) => candidate.value === trimmed)?.value ??
      sanitizedModels.find((candidate) => candidate.label === trimmed)?.value ??
      trimmed;
  } else if (provider.model && provider.model.trim().length > 0) {
    resolvedModel = provider.model.trim();
  }

  const chatMessages = await storage.listChatMessages(chatId);
  const conversation: ChatConversationMessage[] = chatMessages.map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));

  return {
    chat,
    provider: configuredProvider,
    requestConfig,
    model: resolvedModel ?? null,
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
) {
  await getOwnedChat(chatId, workspaceId, userId);
  const message = await storage.createChatMessage({
    chatId,
    role: "assistant",
    content,
    metadata: {},
  });
  await storage.touchChatSession(chatId);
  return mapMessage(message);
}
