import type { LlmProvider, LlmRequestConfig } from "@shared/schema";
import { createUnicaChatSkillForWorkspace } from "./skills";
import { storage } from "./storage";
import { mergeLlmRequestConfig } from "./search/utils";
import { sanitizeLlmModelOptions } from "./llm-utils";
import { fetchAccessToken } from "./llm-access-token";
import { executeLlmCompletion } from "./llm-client";
import { ensureModelAvailable, ModelInactiveError, ModelValidationError, ModelUnavailableError } from "./model-service";

const FALLBACK_CHAT_TITLE = process.env.CHAT_TITLE_FALLBACK ?? "Новый чат";
const CHAT_TITLE_MAX_WORDS = Number(process.env.CHAT_TITLE_MAX_WORDS ?? 5);
const CHAT_TITLE_MAX_LENGTH = Number(process.env.CHAT_TITLE_MAX_LENGTH ?? 64);
const CHAT_TITLE_MESSAGE_SNIPPET_WORDS = Number(process.env.CHAT_TITLE_SNIPPET_WORDS ?? 15);
const CHAT_TITLE_MESSAGE_SNIPPET_CHARS = Number(process.env.CHAT_TITLE_SNIPPET_CHARS ?? 240);
const CHAT_TITLE_GENERATION_TEMPERATURE = Number(process.env.CHAT_TITLE_TEMPERATURE ?? 0.3);
const CHAT_TITLE_LANGUAGE = process.env.CHAT_TITLE_LANGUAGE ?? "русском языке";

const TITLE_SYSTEM_PROMPT = `
Ты — помощник, который придумывает короткие и ёмкие названия чатов.
У тебя будет текст первого сообщения пользователя. На основе этого текста сформулируй лаконичное название чата на ${CHAT_TITLE_LANGUAGE}.
Не используй кавычек и точек, не добавляй вводные слова вроде "Тема".
`.trim();

export type ChatTitleGeneratorInput = {
  workspaceId: string;
  userId: string;
  chatId: string;
  firstMessageText: string;
};

export interface ChatTitleGeneratorService {
  generateTitleForChat(input: ChatTitleGeneratorInput): Promise<string | null>;
}

async function resolveUnicaChatProvider(workspaceId: string) {
  const skill = await createUnicaChatSkillForWorkspace(workspaceId);
  if (!skill) {
    throw new Error("Системный навык Unica Chat недоступен");
  }

  const unicaConfig = await storage.getUnicaChatConfig();

  let providerId = skill.llmProviderConfigId ?? null;
  let modelOverride = skill.modelId ?? null;
  const requestOverrides: Partial<LlmRequestConfig> = {};

  if (unicaConfig.llmProviderConfigId) {
    providerId = unicaConfig.llmProviderConfigId;
  }
  if (typeof unicaConfig.modelId === "string" && unicaConfig.modelId.trim()) {
    modelOverride = unicaConfig.modelId.trim();
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

  if (!providerId) {
    throw new Error("Для Unica Chat не настроен LLM-провайдер");
  }

  const provider = await storage.getLlmProvider(providerId, workspaceId);
  if (!provider) {
    throw new Error("LLM-провайдер не найден");
  }
  if (!provider.isActive) {
    throw new Error("LLM-провайдер отключён");
  }

  const requestConfig = mergeLlmRequestConfig(provider);
  if (typeof requestOverrides.temperature === "number") {
    requestConfig.temperature = requestOverrides.temperature;
  }
  if (typeof requestOverrides.topP === "number") {
    requestConfig.topP = requestOverrides.topP;
  }
  if (typeof requestOverrides.maxTokens === "number") {
    requestConfig.maxTokens = requestOverrides.maxTokens;
  }

  const sanitizedModels = sanitizeLlmModelOptions(provider.availableModels);
  const preferredModel = modelOverride?.trim() ?? null;
  let modelKey: string | null = null;

  if (preferredModel) {
    try {
      const model = await ensureModelAvailable(preferredModel, { expectedType: "LLM" });
      modelKey = model.modelKey;
    } catch (error) {
      if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
        throw new Error(error.message);
      }
      throw error;
    }
  }

  const normalizeModel = (value: string | null) =>
    value
      ? sanitizedModels.find((model) => model.value === value)?.value ??
        sanitizedModels.find((model) => model.label === value)?.value ??
        value
      : null;
  const resolvedModel = normalizeModel(modelKey ?? preferredModel) ?? normalizeModel(provider.model?.trim() ?? null);

  if (!modelKey && resolvedModel) {
    try {
      const resolved = await ensureModelAvailable(resolvedModel, { expectedType: "LLM" });
      modelKey = resolved.modelKey;
    } catch (error) {
      if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
        throw new Error(error.message);
      }
      throw error;
    }
  }

  return { provider, requestConfig, model: resolvedModel };
}

function normalizeSnippet(text: string): string {
  if (!text) {
    return "";
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }
  const words = cleaned.split(" ").slice(0, CHAT_TITLE_MESSAGE_SNIPPET_WORDS);
  let result = words.join(" ");
  if (result.length > CHAT_TITLE_MESSAGE_SNIPPET_CHARS) {
    result = result.slice(0, CHAT_TITLE_MESSAGE_SNIPPET_CHARS).trim();
  }
  return result;
}

function cleanGeneratedTitle(answer: string | null | undefined): string | null {
  if (!answer) {
    return null;
  }
  let value = answer.replace(/[\n\r]+/g, " ").trim();
  if (!value) {
    return null;
  }
  value = value.replace(/^[\"'«»]+|[\"'«»]+$/g, "").trim();
  value = value.replace(/[.!?…]+$/g, "").trim();
  const words = value.split(/\s+/).slice(0, CHAT_TITLE_MAX_WORDS);
  value = words.join(" ");
  if (value.length > CHAT_TITLE_MAX_LENGTH) {
    value = value.slice(0, CHAT_TITLE_MAX_LENGTH).trim();
  }
  if (!value) {
    return null;
  }
  return value;
}

async function requestTitleFromUnicaChat(
  provider: LlmProvider,
  requestConfig: LlmRequestConfig,
  modelOverride: string | null,
  snippet: string,
): Promise<string | null> {
  const accessToken = await fetchAccessToken(provider);
  const messagesField = requestConfig.messagesField;
  const modelField = requestConfig.modelField;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: TITLE_SYSTEM_PROMPT },
    {
      role: "user",
      content: `Сообщение пользователя:\n"""${snippet}"""\n\nПридумай название (до ${CHAT_TITLE_MAX_WORDS} слов).`,
    },
  ];

  const body: Record<string, unknown> = {
    [modelField]: modelOverride && modelOverride.trim().length > 0 ? modelOverride.trim() : provider.model,
    [messagesField]: messages,
    temperature: CHAT_TITLE_GENERATION_TEMPERATURE,
  };

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
    if (key === "stream") {
      continue;
    }
    if (body[key] === undefined) {
      body[key] = value;
    }
  }

  const completion = await executeLlmCompletion(provider, accessToken, body);
  return cleanGeneratedTitle(completion.answer);
}

export const chatTitleGeneratorService: ChatTitleGeneratorService = {
  async generateTitleForChat({ workspaceId, userId, chatId, firstMessageText }) {
    try {
      const snippet = normalizeSnippet(firstMessageText);
      if (!snippet) {
        return FALLBACK_CHAT_TITLE;
      }

      const { provider, requestConfig, model } = await resolveUnicaChatProvider(workspaceId);
      const title = await requestTitleFromUnicaChat(provider, requestConfig, model, snippet);
      return title ?? FALLBACK_CHAT_TITLE;
    } catch (error) {
      console.warn(
        `[chat-title-generator] failed to generate title for chatId=${chatId} workspaceId=${workspaceId}`,
        error,
      );
      return null;
    }
  },
};
