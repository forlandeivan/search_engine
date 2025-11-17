import {
  DEFAULT_LLM_REQUEST_CONFIG,
  DEFAULT_LLM_RESPONSE_CONFIG,
  type LlmProvider,
  type LlmRequestConfig,
  type LlmResponseConfig,
} from "@shared/schema";

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
  options?: { stream?: boolean; responseFormat?: RagResponseFormat },
) {
  const requestConfig = mergeLlmRequestConfig(provider);
  const messages: Array<{ role: string; content: string }> = [];

  if (requestConfig.systemPrompt && requestConfig.systemPrompt.trim()) {
    messages.push({ role: "system", content: requestConfig.systemPrompt.trim() });
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

  const effectiveModel = modelOverride && modelOverride.trim().length > 0 ? modelOverride.trim() : provider.model;

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
