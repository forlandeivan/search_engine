import {
  DEFAULT_LLM_REQUEST_CONFIG,
  DEFAULT_LLM_RESPONSE_CONFIG,
  type LlmProvider,
  type LlmRequestConfig,
  type LlmResponseConfig,
} from "@shared/schema";
import type { ChatConversationMessage } from "../chat-service";

export type RagResponseFormat = "text" | "markdown" | "html";

export type LlmContextRecord = {
  index: number;
  score?: number | null;
  payload: Record<string, unknown> | null;
};

export function mergeLlmRequestConfig(provider: LlmProvider): LlmRequestConfig {
  const config =
    provider.requestConfig && typeof provider.requestConfig === "object"
      ? (provider.requestConfig as Partial<LlmRequestConfig>)
      : undefined;

  return {
    ...DEFAULT_LLM_REQUEST_CONFIG,
    ...(config ?? {}),
  };
}

export function mergeLlmResponseConfig(provider: LlmProvider): LlmResponseConfig {
  const config =
    provider.responseConfig && typeof provider.responseConfig === "object"
      ? (provider.responseConfig as Partial<LlmResponseConfig>)
      : undefined;

  return {
    ...DEFAULT_LLM_RESPONSE_CONFIG,
    ...(config ?? {}),
  };
}

export function stringifyPayloadForContext(payload: Record<string, unknown> | null): string {
  if (!payload || Object.keys(payload).length === 0) {
    return "Нет данных";
  }

  try {
    // Извлекаем текст чанка для LLM-friendly формата
    // Приоритет: text > snippet > chunk.text > chunk.snippet > JSON fallback
    const chunk = payload.chunk as Record<string, unknown> | undefined;
    const document = payload.document as Record<string, unknown> | undefined;
    
    // Получаем текст
    const text = 
      (typeof payload.text === 'string' && payload.text) ||
      (typeof payload.snippet === 'string' && payload.snippet) ||
      (chunk && typeof chunk.text === 'string' && chunk.text) ||
      (chunk && typeof chunk.snippet === 'string' && chunk.snippet);
    
    if (text) {
      // Формируем читаемый контекст
      const title = 
        (document && typeof document.title === 'string' && document.title) ||
        (chunk && typeof chunk.sectionTitle === 'string' && chunk.sectionTitle) ||
        null;
      
      if (title) {
        return `[${title}]\n${text}`;
      }
      return text;
    }
    
    // Fallback на JSON если текст не найден
    const serialized = JSON.stringify(payload, null, 2);
    return serialized.length > 4000 ? `${serialized.slice(0, 4000)}…` : serialized;
  } catch {
    return String(payload);
  }
}

export function buildLlmRequestBody(
  provider: LlmProvider,
  query: string,
  context: LlmContextRecord[],
  modelOverride?: string,
  options?: { 
    stream?: boolean; 
    responseFormat?: RagResponseFormat;
    conversationHistory?: ChatConversationMessage[];
  },
) {
  const requestConfig = mergeLlmRequestConfig(provider);
  const effectiveModel = modelOverride && modelOverride.trim().length > 0 ? modelOverride.trim() : provider.model;

  // Для провайдера Unica AI используется специальный формат {prompt, system}
  if (provider.providerType === "unica") {
    const systemParts: string[] = [];

    if (requestConfig.systemPrompt && requestConfig.systemPrompt.trim()) {
      systemParts.push(requestConfig.systemPrompt.trim());
    }

    const contextText = context
      .map(({ index, score, payload }) => {
        const scoreText = typeof score === "number" ? ` (score: ${score.toFixed(4)})` : "";
        return `Источник ${index}${scoreText}:\n${stringifyPayloadForContext(payload)}`;
      })
      .join("\n\n");

    const responseFormat = options?.responseFormat ?? "text";
    let formatInstruction = "Ответ верни в виде обычного текста.";

    if (responseFormat === "markdown") {
      formatInstruction =
        "Используй Markdown-разметку (заголовки, списки, ссылки) для структурирования ответа. Не добавляй внешний CSS.";
    } else if (responseFormat === "html") {
      formatInstruction =
        "Верни ответ в виде чистого HTML без внешних стилей. Используй семантичные теги <p>, <ul>, <li>, <strong>, <a>.";
    }

    if (context.length > 0) {
      systemParts.push(
        `Контекст:\n${contextText}\n\nСформируй понятный ответ на русском языке, опираясь только на предоставленный контекст. Если ответ не найден, сообщи об этом. Не придумывай фактов. ${formatInstruction}`,
      );
    } else {
      systemParts.push("Контекст отсутствует. Если ответ не найден, честно сообщи об этом.");
    }

    const system = systemParts.length > 0 ? systemParts.join("\n\n") : "You are a helpful assistant. Answer concisely and factually.";
    
    // Для Unica провайдера история добавляется в prompt, а не в system
    // Формат: история диалога + текущий вопрос
    const conversationHistory = options?.conversationHistory ?? [];
    const promptParts: string[] = [];
    
    if (conversationHistory.length > 0) {
      const historyText = conversationHistory
        .map((msg) => {
          const roleLabel = msg.role === "assistant" ? "Ассистент" : "Пользователь";
          return `${roleLabel}: ${msg.content}`;
        })
        .join("\n\n");
      promptParts.push(`История диалога:\n${historyText}`);
    }
    
    promptParts.push(`Вопрос: ${query}`);
    const prompt = promptParts.join("\n\n");

    const body: Record<string, unknown> = {
      model: effectiveModel,
      system,
      prompt,
    };

    // Добавляем workspace_id из additionalBodyFields
    const additionalFields = requestConfig.additionalBodyFields ?? {};
    if (typeof additionalFields.workspace_id === "string") {
      body.workspace_id = additionalFields.workspace_id;
    }

    // Добавляем параметры
    if (requestConfig.temperature !== undefined) {
      body.temperature = requestConfig.temperature;
    }
    if (requestConfig.topP !== undefined) {
      body.top_p = requestConfig.topP;
    }
    if (requestConfig.maxTokens !== undefined) {
      body.max_tokens = requestConfig.maxTokens;
    }

    // Добавляем дополнительные поля (format, think, top_k, seed, repeat_penalty)
    for (const [key, value] of Object.entries(additionalFields)) {
      if (key !== "workspace_id" && body[key] === undefined) {
        body[key] = value;
      }
    }

    return body;
  }

  // Стандартный формат для других провайдеров
  const messages: Array<{ role: string; content: string }> = [];

  if (requestConfig.systemPrompt && requestConfig.systemPrompt.trim()) {
    messages.push({ role: "system", content: requestConfig.systemPrompt.trim() });
  }

  // Добавляем историю диалога перед текущим запросом (если есть)
  const conversationHistory = options?.conversationHistory ?? [];
  for (const msg of conversationHistory) {
    messages.push({
      role: msg.role,
      content: msg.content ?? "",
    });
  }

  const contextText = context
    .map(({ index, score, payload }) => {
      const scoreText = typeof score === "number" ? ` (score: ${score.toFixed(4)})` : "";
      return `Источник ${index}${scoreText}:\n${stringifyPayloadForContext(payload)}`;
    })
    .join("\n\n");

  const responseFormat = options?.responseFormat ?? "text";
  let formatInstruction = "Ответ верни в виде обычного текста.";

  if (responseFormat === "markdown") {
    formatInstruction =
      "Используй Markdown-разметку (заголовки, списки, ссылки) для структурирования ответа. Не добавляй внешний CSS.";
  } else if (responseFormat === "html") {
    formatInstruction =
      "Верни ответ в виде чистого HTML без внешних стилей. Используй семантичные теги <p>, <ul>, <li>, <strong>, <a>.";
  }

  const userParts = [
    `Вопрос: ${query}`,
    context.length > 0
      ? `Контекст:\n${contextText}`
      : "Контекст отсутствует. Если ответ не найден, честно сообщи об этом.",
    `Сформируй понятный ответ на русском языке, опираясь только на предоставленный контекст. Если ответ не найден, сообщи об этом. Не придумывай фактов. ${formatInstruction}`.trim(),
  ];

  messages.push({ role: "user", content: userParts.join("\n\n") });

  const body: Record<string, unknown> = {
    [requestConfig.modelField]: effectiveModel,
    [requestConfig.messagesField]: messages,
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
  const { stream: configuredStream, ...otherAdditionalFields } = additionalFields as {
    stream?: unknown;
    [key: string]: unknown;
  };

  for (const [key, value] of Object.entries(otherAdditionalFields)) {
    if (body[key] === undefined) {
      body[key] = value;
    }
  }

  if (options?.stream !== undefined) {
    body.stream = options.stream;
  } else if (configuredStream !== undefined) {
    body.stream = configuredStream;
  } else if (provider.providerType === "gigachat") {
    body.stream = true;
  }

  return body;
}
