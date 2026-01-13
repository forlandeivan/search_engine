import { randomUUID } from "crypto";
import fetch, { Headers, type Response as FetchResponse } from "node-fetch";
import type { LlmProvider } from "@shared/schema";
import {
  buildLlmRequestBody,
  mergeLlmResponseConfig,
  type LlmContextRecord,
  type RagResponseFormat,
} from "./search/utils";
import {
  applyTlsPreferences,
  parseJson,
  sanitizeHeadersForLog,
  type ApiRequestLog,
  type NodeFetchOptions,
} from "./http-utils";
import { fetchAccessToken, clearProviderAccessTokenCache, type OAuthProviderConfig } from "./llm-access-token";

function parseEnvPositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

const USE_MOCK_LLM = process.env.MOCK_LLM_RESPONSES === "1";
const LLM_COMPLETION_MAX_ATTEMPTS = parseEnvPositiveInt(process.env.LLM_COMPLETION_MAX_ATTEMPTS, 3);
const LLM_COMPLETION_RETRY_DELAY_MS = parseEnvPositiveInt(process.env.LLM_COMPLETION_RETRY_DELAY_MS, 1500);

if (USE_MOCK_LLM) {
  console.warn("[llm] MOCK_LLM_RESPONSES enabled: using mock completions");
}

export interface LlmCompletionResult {
  answer: string;
  usageTokens?: number | null;
  rawResponse: unknown;
  request: ApiRequestLog;
}

export type LlmStreamEvent = {
  event: string;
  data: {
    text?: string;
    chunk?: unknown;
  };
};

export type LlmCompletionPromise = Promise<LlmCompletionResult> & {
  streamIterator?: AsyncIterable<LlmStreamEvent>;
};

type AsyncIteratorResolver<T> = {
  resolve: (value: IteratorResult<T>) => void;
  reject: (reason?: unknown) => void;
};

export type AsyncStreamController<T> = {
  iterator: AsyncIterableIterator<T>;
  push: (value: T) => void;
  finish: () => void;
  fail: (error: unknown) => void;
};

export function createAsyncStreamController<T>(): AsyncStreamController<T> {
  const queue: T[] = [];
  const pending: AsyncIteratorResolver<T>[] = [];
  let done = false;
  let failed: unknown = null;

  const iterator: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    next() {
      if (failed) {
        const error = failed;
        failed = null;
        return Promise.reject(error);
      }

      if (queue.length > 0) {
        const value = queue.shift()!;
        return Promise.resolve({ value, done: false });
      }

      if (done) {
        return Promise.resolve({ value: undefined as never, done: true });
      }

      return new Promise<IteratorResult<T>>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
  };

  const flushQueue = () => {
    while (queue.length > 0 && pending.length > 0) {
      const waiter = pending.shift()!;
      const value = queue.shift()!;
      waiter.resolve({ value, done: false });
    }
  };

  return {
    iterator,
    push(value: T) {
      if (done || failed) {
        return;
      }
      if (pending.length > 0) {
        const waiter = pending.shift()!;
        waiter.resolve({ value, done: false });
        return;
      }
      queue.push(value);
    },
    finish() {
      if (done || failed) {
        return;
      }
      done = true;
      flushQueue();
      while (pending.length > 0) {
        const waiter = pending.shift()!;
        waiter.resolve({ value: undefined as never, done: true });
      }
    },
    fail(error: unknown) {
      if (failed || done) {
        return;
      }
      failed = error ?? new Error("Stream failed");
      while (pending.length > 0) {
        const waiter = pending.shift()!;
        waiter.reject(failed);
      }
    },
  };
}

function getValueByJsonPath(source: unknown, path: string): unknown {
  if (!path || typeof path !== "string") {
    return undefined;
  }

  const normalized = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  let current: unknown = source;

  for (const segment of normalized) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (typeof current !== "object") {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

const MOCK_STREAM_DELAY_MS = 25;
const MOCK_STREAM_CHUNK_SIZE = 32;

function extractLastUserMessage(body: Record<string, unknown>): string | null {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (
      entry &&
      typeof entry === "object" &&
      (entry as { role?: unknown }).role === "user" &&
      typeof (entry as { content?: unknown }).content === "string"
    ) {
      return (entry as { content: string }).content.trim();
    }
  }
  return null;
}

async function delay(ms: number) {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function chunkText(text: string, chunkSize: number): string[] {
  if (chunkSize <= 0) {
    return [text];
  }
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

function createMockLlmCompletion(
  provider: LlmProvider,
  body: Record<string, unknown>,
  wantsStream: boolean,
): LlmCompletionPromise {
  const prompt = extractLastUserMessage(body);
  const answer =
    prompt && prompt.length > 0
      ? `Это тестовый ответ на запрос "${prompt}".\n\n(Ответ сгенерирован в mock-режиме без обращения к внешнему LLM.)`
      : "Тестовый ответ от mock-LLM. Уточните вопрос, и я сгенерирую заглушку.";

  const requestLog: ApiRequestLog = {
    url: provider.completionUrl,
    headers: {},
    body,
  };

  if (!wantsStream) {
    const result: LlmCompletionResult = {
      answer,
      usageTokens: answer.length,
      rawResponse: { mock: true },
      request: requestLog,
    };
    return Promise.resolve(result);
  }

  const controller = createAsyncStreamController<LlmStreamEvent>();
  const streamPromise = (async () => {
    for (const chunk of chunkText(answer, MOCK_STREAM_CHUNK_SIZE)) {
      controller.push({ event: "delta", data: { text: chunk } });
      await delay(MOCK_STREAM_DELAY_MS);
    }
    controller.finish();
    return {
      answer,
      usageTokens: answer.length,
      rawResponse: { mock: true },
      request: requestLog,
    };
  })();

  return Object.assign(streamPromise, { streamIterator: controller.iterator });
}

type ExecuteOptions = {
  stream?: boolean;
  responseFormat?: RagResponseFormat;
  onBeforeRequest?: (details: ApiRequestLog) => void;
};

async function executeAitunnelCompletion(
  provider: LlmProvider,
  accessToken: string,
  rawBody: Record<string, unknown>,
  options?: ExecuteOptions,
): Promise<LlmCompletionResult> {
  const wantsStream = options?.stream === true || rawBody.stream === true;

  const body: Record<string, unknown> = {
    ...rawBody,
    stream: wantsStream,
  };

  if (!body.model && provider.model) {
    body.model = provider.model;
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", wantsStream ? "text/event-stream" : "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    headers.set(key, value);
  }

  options?.onBeforeRequest?.({
    url: provider.completionUrl,
    headers: sanitizeHeadersForLog(headers),
    body,
  });

  if (wantsStream) {
    const streamController = createAsyncStreamController<LlmStreamEvent>();
    const streamPromise = (async () => {
      let response: FetchResponse;
      try {
        const requestOptions = applyTlsPreferences<NodeFetchOptions>(
          { method: "POST", headers, body: JSON.stringify(body) },
          provider.allowSelfSignedCertificate,
        );
        response = await fetchWithRetries(provider.completionUrl, requestOptions, {
          providerId: provider.id,
          maxAttempts: LLM_COMPLETION_MAX_ATTEMPTS,
          retryDelayMs: LLM_COMPLETION_RETRY_DELAY_MS,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        streamController.fail(error);
        throw new Error(`Не удалось выполнить запрос к AITunnel: ${message}`);
      }

      const rawEvents: Array<{ event: string; data: unknown }> = [];
      const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      const text = await response.text();
      streamController.fail(new Error(text || `AITunnel вернул ошибку ${response.status}`));
      throw new Error(text || `AITunnel вернул ошибку ${response.status}`);
    }

    if (!contentType.toLowerCase().includes("text/event-stream")) {
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        // ignore
      }

      let fallbackAnswer: string | null = null;
      let usageTokens: number | null = null;

      if (parsed && typeof parsed === "object") {
        const choices = (parsed as Record<string, unknown>).choices;
        const firstChoice = Array.isArray(choices) && choices.length > 0 ? choices[0] : null;
        const message =
          firstChoice && typeof firstChoice === "object" ? (firstChoice as Record<string, unknown>).message : null;
        if (message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string") {
          fallbackAnswer = (message as Record<string, unknown>).content as string;
        }
        const usage = (parsed as Record<string, unknown>).usage;
        if (usage && typeof usage === "object") {
          const total = (usage as Record<string, unknown>).total_tokens;
          if (typeof total === "number" && Number.isFinite(total)) {
            usageTokens = total as number;
          } else if (typeof total === "string" && total.trim().length > 0) {
            const parsedTotal = Number.parseFloat(total);
            if (!Number.isNaN(parsedTotal)) {
              usageTokens = parsedTotal;
            }
          }
        }
        if (!fallbackAnswer && typeof (parsed as Record<string, unknown>).message === "string") {
          fallbackAnswer = (parsed as Record<string, unknown>).message as string;
        }
      }

      if (!fallbackAnswer && text && text.trim().length > 0) {
        fallbackAnswer = text.trim();
      }

      if (!fallbackAnswer) {
        const err = new Error("AITunnel не вернул поток событий");
        streamController.fail(err);
        throw err;
      }

      const chunks = chunkText(fallbackAnswer, Math.max(24, Math.min(96, Math.floor(fallbackAnswer.length / 8) || 64)));
      for (const chunk of chunks) {
        streamController.push({ event: "delta", data: { text: chunk } });
        if (chunks.length > 1) {
          await delay(10);
        }
      }
      streamController.finish();

      return {
        answer: fallbackAnswer,
        usageTokens,
        rawResponse: parsed ?? text,
        request: {
          url: provider.completionUrl,
          headers: sanitizeHeadersForLog(headers),
          body,
        },
      };
    }

      const responseBody = response.body;
      if (!responseBody) {
        const err = new Error("Не удалось получить поток AITunnel");
        streamController.fail(err);
        throw err;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let aggregatedAnswer = "";
      let usageTokens: number | null = null;
      let finishReason: string | null = null;

      const handlePayload = (payload: string) => {
        rawEvents.push({ event: "data", data: payload });
        if (payload === "[DONE]") {
          return;
        }
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{
              delta?: { content?: string; tool_calls?: unknown };
              finish_reason?: string | null;
            }>;
            usage?: { total_tokens?: number };
          };
          const choice = json.choices?.[0];
          if (choice?.delta?.content) {
            const text = choice.delta.content;
            aggregatedAnswer += text;
            streamController.push({ event: "delta", data: { text } });
          }
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const totalTokens = json.usage?.total_tokens as unknown;
          if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
            usageTokens = totalTokens;
          } else if (typeof totalTokens === "string" && totalTokens.trim().length > 0) {
            const parsedTotal = Number.parseFloat(totalTokens);
            if (!Number.isNaN(parsedTotal)) {
              usageTokens = parsedTotal;
            }
          }
        } catch {
          // fallback: push raw text
          aggregatedAnswer += payload;
          streamController.push({ event: "delta", data: { text: payload } });
        }
      };

      try {
        const bodyAny = responseBody as unknown as {
          getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
          [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer>;
        };

        const processChunk = (chunk: Uint8Array | Buffer) => {
          buffer += decoder.decode(chunk, { stream: true });
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const segment = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const trimmed = segment.trim();
            if (trimmed.startsWith("data:")) {
              const payload = trimmed.replace(/^data:\s*/, "");
              handlePayload(payload);
            }
          }
        };

        if (typeof bodyAny?.getReader === "function") {
          const reader = bodyAny.getReader();
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            processChunk(chunk.value);
          }
        } else if (typeof bodyAny?.[Symbol.asyncIterator] === "function") {
          for await (const chunk of responseBody as AsyncIterable<Uint8Array | Buffer>) {
            processChunk(chunk);
          }
        } else {
          throw new Error("Поток ответа AITunnel имеет неподдерживаемый формат");
        }
      } catch (error) {
        streamController.fail(error);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Ошибка чтения SSE от AITunnel: ${message}`);
      }

      streamController.finish();

      return {
        answer: aggregatedAnswer,
        usageTokens,
        rawResponse: rawEvents,
        request: {
          url: provider.completionUrl,
          headers: sanitizeHeadersForLog(headers),
          body,
        },
      };
    })();

    return Object.assign(streamPromise, { streamIterator: streamController.iterator }) as LlmCompletionPromise;
  }

  // Non-streaming branch
  let completionResponse: FetchResponse;
  try {
    const requestOptions = applyTlsPreferences<NodeFetchOptions>(
      {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      },
      provider.allowSelfSignedCertificate,
    );

    completionResponse = await fetchWithRetries(provider.completionUrl, requestOptions, {
      providerId: provider.id,
      maxAttempts: LLM_COMPLETION_MAX_ATTEMPTS,
      retryDelayMs: LLM_COMPLETION_RETRY_DELAY_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось выполнить запрос к AITunnel: ${message}`);
  }

  const rawBodyText = await completionResponse.text();
  const parsedBody = parseJson(rawBodyText);

  if (!completionResponse.ok) {
    let message = `AITunnel вернул ошибку ${completionResponse.status}`;
    if (parsedBody && typeof parsedBody === "object") {
      const err = (parsedBody as Record<string, unknown>).error;
      if (err && typeof err === "object" && typeof (err as Record<string, unknown>).message === "string") {
        message = (err as Record<string, unknown>).message as string;
      } else if (typeof (parsedBody as Record<string, unknown>).message === "string") {
        message = (parsedBody as Record<string, unknown>).message as string;
      }
    }
    throw new Error(message);
  }

  if (!parsedBody || typeof parsedBody !== "object") {
    throw new Error("Некорректный ответ AITunnel");
  }

  const choices = (parsedBody as Record<string, unknown>).choices;
  const firstChoice = Array.isArray(choices) && choices.length > 0 ? choices[0] : null;
  const message = firstChoice && typeof firstChoice === "object" ? (firstChoice as Record<string, unknown>).message : null;
  const content =
    message && typeof message === "object" && typeof (message as Record<string, unknown>).content === "string"
      ? ((message as Record<string, unknown>).content as string)
      : null;

  if (!content) {
    throw new Error("AITunnel не вернул текст ответа");
  }

  let usageTokens: number | null = null;
  const usage = (parsedBody as Record<string, unknown>).usage;
  if (usage && typeof usage === "object") {
    const total = (usage as Record<string, unknown>).total_tokens;
    if (typeof total === "number" && Number.isFinite(total)) {
      usageTokens = total;
    }
  }

  return {
    answer: content.trim(),
    usageTokens,
    rawResponse: parsedBody,
    request: {
      url: provider.completionUrl,
      headers: sanitizeHeadersForLog(headers),
      body,
    },
  };
}

async function executeUnicaCompletion(
  provider: LlmProvider,
  accessToken: string,
  rawBody: Record<string, unknown>,
  options?: ExecuteOptions,
): Promise<LlmCompletionResult> {
  // Unica AI всегда использует стриминг
  const wantsStream = true;

  const body: Record<string, unknown> = { ...rawBody };

  // Формируем endpoint для стриминга
  let streamUrl = provider.completionUrl;
  if (!streamUrl.endsWith("/stream")) {
    streamUrl = streamUrl.endsWith("/") ? `${streamUrl}stream` : `${streamUrl}/stream`;
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");

  // Для Unica AI аутентификация не требуется
  // accessToken будет пустой строкой, так как у провайдера нет tokenUrl

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    headers.set(key, value);
  }

  options?.onBeforeRequest?.({
    url: streamUrl,
    headers: sanitizeHeadersForLog(headers),
    body,
  });

  const streamController = createAsyncStreamController<LlmStreamEvent>();
  const streamPromise = (async () => {
    let response: FetchResponse;
    try {
      const requestOptions = applyTlsPreferences<NodeFetchOptions>(
        { method: "POST", headers, body: JSON.stringify(body) },
        provider.allowSelfSignedCertificate,
      );
      response = await fetchWithRetries(streamUrl, requestOptions, {
        providerId: provider.id,
        maxAttempts: LLM_COMPLETION_MAX_ATTEMPTS,
        retryDelayMs: LLM_COMPLETION_RETRY_DELAY_MS,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      streamController.fail(error);
      throw new Error(`Не удалось выполнить запрос к Unica AI: ${message}`);
    }

    const rawEvents: Array<{ event: string; data: unknown }> = [];
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      const text = await response.text();
      streamController.fail(new Error(text || `Unica AI вернул ошибку ${response.status}`));
      throw new Error(text || `Unica AI вернул ошибку ${response.status}`);
    }

    if (!contentType.toLowerCase().includes("text/event-stream")) {
      const text = await response.text();
      streamController.fail(new Error("Unica AI не вернул поток событий"));
      throw new Error("Unica AI не вернул поток событий");
    }

    const responseBody = response.body;
    if (!responseBody) {
      const err = new Error("Не удалось получить поток Unica AI");
      streamController.fail(err);
      throw err;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let aggregatedAnswer = "";
    let usageTokens: number | null = null;
    let currentEventName: string | null = null;

    const handleSseEvent = (eventName: string, payload: string) => {
      if (!payload || payload.trim().length === 0) {
        return;
      }

      rawEvents.push({ event: eventName, data: payload });

      try {
        const json = JSON.parse(payload) as Record<string, unknown>;

        if (eventName === "token") {
          // Формат: {"index":0,"delta":"текст","model":"имя"}
          const delta = typeof json.delta === "string" ? json.delta : "";
          if (delta) {
            aggregatedAnswer += delta;
            streamController.push({ event: "delta", data: { text: delta } });
          }
        } else if (eventName === "warning") {
          // Формат: {"message":"текст"}
          const message = typeof json.message === "string" ? json.message : String(json.message || "");
          console.warn(`[unica-ai] warning: ${message}`);
        } else if (eventName === "done") {
          // Формат: {"model":"имя","done":true,"done_reason":"stop|length","metrics":{...}}
          const metrics = json.metrics as Record<string, unknown> | undefined;
          if (metrics) {
            const promptEvalCount = typeof metrics.prompt_eval_count === "number" ? metrics.prompt_eval_count : 0;
            const evalCount = typeof metrics.eval_count === "number" ? metrics.eval_count : 0;
            usageTokens = promptEvalCount + evalCount;
          }
        }
      } catch (parseError) {
        // Если не JSON, игнорируем
        console.warn(`[unica-ai] failed to parse SSE payload for event ${eventName}:`, parseError);
      }
    };

    try {
      const bodyAny = responseBody as unknown as {
        getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
        [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer>;
      };

      const processChunk = (chunk: Uint8Array | Buffer) => {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
          const segment = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const trimmed = segment.trim();
          if (!trimmed) {
            continue;
          }

          const lines = trimmed.split("\n");
          currentEventName = null;
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEventName = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              dataLines.push(line.slice(5).trim());
            }
          }

          if (dataLines.length > 0) {
            const payload = dataLines.join("\n");
            const eventName = currentEventName || "message";
            handleSseEvent(eventName, payload);
          }
        }
      };

      if (typeof bodyAny?.getReader === "function") {
        const reader = bodyAny.getReader();
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          processChunk(chunk.value);
        }
      } else if (typeof bodyAny?.[Symbol.asyncIterator] === "function") {
        for await (const chunk of responseBody as AsyncIterable<Uint8Array | Buffer>) {
          processChunk(chunk);
        }
      } else {
        throw new Error("Поток ответа Unica AI имеет неподдерживаемый формат");
      }
    } catch (error) {
      streamController.fail(error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Ошибка чтения SSE от Unica AI: ${message}`);
    }

    streamController.finish();

    return {
      answer: aggregatedAnswer,
      usageTokens,
      rawResponse: rawEvents,
      request: {
        url: streamUrl,
        headers: sanitizeHeadersForLog(headers),
        body,
      },
    };
  })();

  return Object.assign(streamPromise, { streamIterator: streamController.iterator }) as LlmCompletionPromise;
}

export function executeLlmCompletion(
  provider: LlmProvider,
  accessToken: string,
  rawBody: Record<string, unknown>,
  options?: ExecuteOptions,
): LlmCompletionPromise {
  if (provider.providerType === "aitunnel") {
    return executeAitunnelCompletion(provider, accessToken, rawBody, options) as LlmCompletionPromise;
  }

  if (provider.providerType === "unica") {
    return executeUnicaCompletion(provider, accessToken, rawBody, options) as LlmCompletionPromise;
  }

  const body: Record<string, unknown> = { ...rawBody };
  if (options?.stream === true) {
    body.stream = true;
  }

  const wantsStream = body.stream === true;

  if (USE_MOCK_LLM) {
    console.info(
      `[llm] provider=${provider.id} stream=${wantsStream ? "yes" : "no"} mock response`,
    );
    return createMockLlmCompletion(provider, body, wantsStream);
  }

  const llmHeaders = new Headers();
  llmHeaders.set("Content-Type", "application/json");
  llmHeaders.set("Accept", wantsStream ? "text/event-stream, application/json" : "application/json");

  if (!llmHeaders.has("RqUID")) {
    llmHeaders.set("RqUID", randomUUID());
  }

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    llmHeaders.set(key, value);
  }

  if (!llmHeaders.has("Authorization") && accessToken.trim().length > 0) {
    llmHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const streamController = wantsStream ? createAsyncStreamController<LlmStreamEvent>() : null;

  console.info(
    `[llm] provider=${provider.id} stream=${wantsStream ? "yes" : "no"} request started`,
  );

  const completionPromise = (async () => {
    let completionResponse: FetchResponse;

    try {
      const requestOptions = applyTlsPreferences<NodeFetchOptions>(
        {
          method: "POST",
          headers: llmHeaders,
          body: JSON.stringify(body),
        },
        provider.allowSelfSignedCertificate,
      );

      options?.onBeforeRequest?.({
        url: provider.completionUrl,
        headers: sanitizeHeadersForLog(llmHeaders),
        body,
      });

      completionResponse = await fetchWithRetries(provider.completionUrl, requestOptions, {
        providerId: provider.id,
        maxAttempts: LLM_COMPLETION_MAX_ATTEMPTS,
        retryDelayMs: LLM_COMPLETION_RETRY_DELAY_MS,
      });
      console.info(
        `[llm] provider=${provider.id} response status=${completionResponse.status} content-type=${completionResponse.headers.get(
          "content-type",
        ) ?? "unknown"}`,
      );
    } catch (error) {
      streamController?.fail(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Не удалось выполнить запрос к LLM: ${errorMessage}`);
    }

    if (!completionResponse.ok) {
      const rawBodyText = await completionResponse.text();
      const parsedBody = parseJson(rawBodyText);

      let message = `LLM вернул ошибку ${completionResponse.status}`;

      if (parsedBody && typeof parsedBody === "object") {
        const bodyRecord = parsedBody as Record<string, unknown>;
        if (typeof bodyRecord.error_description === "string") {
          message = bodyRecord.error_description;
        } else if (typeof bodyRecord.message === "string") {
          message = bodyRecord.message;
        }
      } else if (typeof parsedBody === "string" && parsedBody.trim()) {
        message = parsedBody.trim();
      }

      // Проверяем, является ли ошибка связанной с истекшим токеном
      const isTokenExpiredError =
        completionResponse.status === 401 ||
        completionResponse.status === 403 ||
        (typeof message === "string" &&
          (message.toLowerCase().includes("token has expired") ||
            message.toLowerCase().includes("token expired") ||
            message.toLowerCase().includes("invalid token") ||
            message.toLowerCase().includes("unauthorized")));

      if (isTokenExpiredError && provider.providerType !== "aitunnel") {
        // Очищаем кеш токена для принудительного обновления
        clearProviderAccessTokenCache(provider);
        console.warn(
          `[llm] provider=${provider.id} token expired error detected, cache cleared. Status: ${completionResponse.status}, Message: ${message}`,
        );
      }

      streamController?.fail(new Error(message));
      throw new Error(message);
    }

    if (wantsStream) {
      const contentType = completionResponse.headers.get("Content-Type") ?? "";

      if (!contentType.toLowerCase().includes("text/event-stream")) {
        streamController?.fail(new Error("LLM не вернул поток событий"));
        throw new Error("LLM не вернул поток событий");
      }

      const responseBody = completionResponse.body;
      if (!responseBody) {
        streamController?.fail(new Error("Не удалось получить поток LLM"));
        throw new Error("Не удалось получить поток LLM");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let aggregatedAnswer = "";
      let usageTokens: number | null = null;
      const rawEvents: Array<{ event: string; data: unknown }> = [];
      let streamCompleted = false;
      let currentEventName: string | null = null;

      const handleSseEvent = (eventName: string, payload: string) => {
        rawEvents.push({ event: eventName, data: payload });

        const normalizedEvent = eventName || "message";

        if (payload === "[DONE]") {
          streamCompleted = true;
          return;
        }

        if (normalizedEvent === "delta" || normalizedEvent === "message") {
          let text = "";

          if (payload) {
            try {
              const parsed = JSON.parse(payload);
              if (typeof parsed?.text === "string") {
                text = parsed.text;
              } else if (
                Array.isArray(parsed?.choices) &&
                parsed.choices[0]?.delta &&
                typeof parsed.choices[0].delta?.content === "string"
              ) {
                text = parsed.choices[0].delta.content;
              } else if (typeof parsed?.delta?.text === "string") {
                text = parsed.delta.text;
              } else if (typeof parsed?.choices?.[0]?.text === "string") {
                text = parsed.choices[0].text;
              }
            } catch {
              text = payload;
            }
          }

          aggregatedAnswer += text;
          streamController?.push({ event: "delta", data: { text } });
        } else if (normalizedEvent === "usage") {
          try {
            const parsedUsage = JSON.parse(payload);
            const total = parsedUsage?.total_tokens ?? parsedUsage?.usage?.total_tokens;
            if (typeof total === "number" && Number.isFinite(total)) {
              usageTokens = total;
            }
          } catch {
            // ignore malformed usage payloads
          }
        } else if (normalizedEvent === "done") {
          streamCompleted = true;
        } else {
          streamController?.push({
            event: normalizedEvent,
            data: payload ? JSON.parse(payload) : {},
          });
        }
      };

      const flushBuffer = () => {
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith(":")) {
            continue;
          }
          const trimmed = line.trimEnd();
          if (trimmed.length === 0) {
            currentEventName = null;
            continue;
          }
          if (trimmed.startsWith("event:")) {
            currentEventName = trimmed.slice(6).trim() || null;
            continue;
          }
          if (trimmed.startsWith("data:")) {
            const payload = trimmed.slice(5).trim();
            handleSseEvent(currentEventName ?? "message", payload);
            continue;
          }
        }
      };

      const processChunk = (chunkValue?: Uint8Array | Buffer | null) => {
        if (!chunkValue) {
          return;
        }
        buffer += decoder.decode(chunkValue, { stream: true });
        flushBuffer();
      };

      try {
        console.info(`[llm] provider=${provider.id} SSE stream started`);
        const bodyAny = responseBody as unknown as {
          getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
          [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array | Buffer>;
        };

        if (typeof bodyAny?.getReader === "function") {
          const reader = bodyAny.getReader();
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) {
              break;
            }
            processChunk(chunk.value);
          }
        } else if (typeof bodyAny?.[Symbol.asyncIterator] === "function") {
          for await (const chunk of (responseBody as unknown as AsyncIterable<Uint8Array | Buffer>)) {
            processChunk(chunk);
          }
        } else {
          throw new Error("Поток ответа LLM имеет неподдерживаемый формат");
        }
      } catch (error) {
        streamController?.fail(error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Ошибка чтения SSE от LLM: ${errorMessage}`);
      }

      if (!aggregatedAnswer) {
        streamController?.finish();
        throw new Error("LLM не вернул ответ");
      }

      streamController?.finish();
      console.info(`[llm] provider=${provider.id} SSE stream completed`);
      return {
        answer: aggregatedAnswer,
        usageTokens,
        rawResponse: rawEvents,
        request: {
          url: provider.completionUrl,
          headers: sanitizeHeadersForLog(llmHeaders),
          body,
        },
      };
    }

    const rawBodyText = await completionResponse.text();
    const parsedBody = parseJson(rawBodyText);

    const responseConfig = mergeLlmResponseConfig(provider);
    const messageValue = getValueByJsonPath(parsedBody, responseConfig.messagePath);

    let answer: string | null = null;
    if (typeof messageValue === "string") {
      answer = messageValue.trim();
    } else if (Array.isArray(messageValue)) {
      answer = messageValue
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
            return (item as Record<string, unknown>).text as string;
          }
          return "";
        })
        .filter((part) => part.trim().length > 0)
        .join("\n")
        .trim();
    } else if (
      messageValue &&
      typeof messageValue === "object" &&
      typeof (messageValue as Record<string, unknown>).content === "string"
    ) {
      answer = ((messageValue as Record<string, unknown>).content as string).trim();
    }

    if (!answer) {
      throw new Error("LLM не вернул ответ");
    }

    let usageTokens: number | null = null;
    if (responseConfig.usageTokensPath) {
      const usageValue = getValueByJsonPath(parsedBody, responseConfig.usageTokensPath);
      if (typeof usageValue === "number" && Number.isFinite(usageValue)) {
        usageTokens = usageValue;
      } else if (typeof usageValue === "string" && usageValue.trim()) {
        const parsedNumber = Number.parseFloat(usageValue);
        if (!Number.isNaN(parsedNumber)) {
          usageTokens = parsedNumber;
        }
      }
    }

    streamController?.finish();
    console.info(`[llm] provider=${provider.id} sync completion ready`);

    return {
      answer,
      usageTokens,
      rawResponse: parsedBody,
      request: {
        url: provider.completionUrl,
        headers: sanitizeHeadersForLog(llmHeaders),
        body,
      },
    };
  })();

  return Object.assign(completionPromise, {
    streamIterator: streamController?.iterator,
  });
}

/**
 * Проверяет, является ли ошибка связанной с истекшим токеном
 */
function isTokenExpiredError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return (
    (typeof errorMessage === "string" &&
      (errorMessage.toLowerCase().includes("token has expired") ||
        errorMessage.toLowerCase().includes("token expired") ||
        errorMessage.toLowerCase().includes("invalid token") ||
        errorMessage.toLowerCase().includes("unauthorized") ||
        errorMessage.toLowerCase().includes("401") ||
        errorMessage.toLowerCase().includes("403"))) ||
    (error instanceof Error && "status" in error && ((error as any).status === 401 || (error as any).status === 403))
  );
}

/**
 * Выполняет LLM completion с автоматическим обновлением токена при ошибках аутентификации
 * Используется для не-стриминговых запросов
 */
export async function executeLlmCompletionWithTokenRefresh(
  provider: LlmProvider,
  accessToken: string,
  requestBody: Record<string, unknown>,
  options?: ExecuteOptions,
): Promise<LlmCompletionResult> {
  try {
    return await executeLlmCompletion(provider, accessToken, requestBody, options);
  } catch (error) {
    // Если токен истек и это не AITunnel, пытаемся обновить токен и повторить запрос
    if (isTokenExpiredError(error) && provider.providerType !== "aitunnel" && options?.stream !== true) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(
        `[llm] provider=${provider.id} token expired, attempting to refresh and retry. Error: ${errorMessage}`,
      );

      // Очищаем кеш токена
      clearProviderAccessTokenCache(provider);

      // Получаем новый токен
      const newAccessToken = await fetchAccessToken(provider);

      // Повторяем запрос с новым токеном
      return executeLlmCompletion(provider, newAccessToken, requestBody, options);
    }

    // Если это не ошибка токена или это стриминг, пробрасываем ошибку дальше
    throw error;
  }
}

export function fetchLlmCompletion(
  provider: LlmProvider,
  accessToken: string,
  query: string,
  context: LlmContextRecord[],
  modelOverride?: string,
  options?: ExecuteOptions,
) {
  const requestBody = buildLlmRequestBody(provider, query, context, modelOverride, {
    stream: options?.stream === true ? true : undefined,
  });

  const completionPromise = executeLlmCompletion(provider, accessToken, requestBody, options);

  // Оборачиваем в async функцию для обработки ошибок токена
  const wrappedPromise = (async () => {
    try {
      return await completionPromise;
    } catch (error) {
      // Если токен истек и это не AITunnel, пытаемся обновить токен и повторить запрос
      // НЕ делаем retry для стриминга, так как стриминг уже начался
      if (isTokenExpiredError(error) && provider.providerType !== "aitunnel" && options?.stream !== true) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(
          `[llm] provider=${provider.id} token expired, attempting to refresh and retry. Error: ${errorMessage}`,
        );

        // Очищаем кеш токена
        clearProviderAccessTokenCache(provider);

        // Получаем новый токен
        const newAccessToken = await fetchAccessToken(provider);

        // Повторяем запрос с новым токеном
        return executeLlmCompletion(provider, newAccessToken, requestBody, options);
      }

      // Если это не ошибка токена или это стриминг, пробрасываем ошибку дальше
      throw error;
    }
  })();

  // Сохраняем streamIterator из оригинального promise, если он есть
  if (completionPromise.streamIterator) {
    (wrappedPromise as any).streamIterator = completionPromise.streamIterator;
  }

  return wrappedPromise as LlmCompletionPromise;
}

type RetryOptions = {
  providerId: string;
  maxAttempts: number;
  retryDelayMs: number;
};

async function fetchWithRetries(
  url: string,
  options: NodeFetchOptions,
  retryOptions: RetryOptions,
): Promise<FetchResponse> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= retryOptions.maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (shouldRetryResponse(response) && attempt < retryOptions.maxAttempts) {
        const delayMs = computeRetryDelayMs(response, retryOptions.retryDelayMs);
        console.warn(
          `[llm] provider=${retryOptions.providerId} status=${response.status} attempt=${attempt}/${retryOptions.maxAttempts} retrying in ${delayMs}ms`,
        );
        await delay(delayMs);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retryOptions.maxAttempts) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[llm] provider=${retryOptions.providerId} fetch attempt ${attempt}/${retryOptions.maxAttempts} failed: ${message}`,
      );
      await delay(retryOptions.retryDelayMs);
    }
  }

  throw lastError ?? new Error("LLM request failed after retries");
}

function shouldRetryResponse(response: FetchResponse): boolean {
  return response.status === 429 || response.status === 503;
}

function computeRetryDelayMs(response: FetchResponse, fallback: number): number {
  const retryHeader = response.headers?.get?.("retry-after");
  if (retryHeader) {
    const seconds = Number(retryHeader);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.max(fallback, seconds * 1000);
    }
    const dateMs = Date.parse(retryHeader);
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) {
        return Math.max(fallback, diff);
      }
    }
  }
  return fallback;
}

export interface LlmProviderHealthCheckResult {
  available: boolean;
  error?: string;
  responseTimeMs?: number;
}

/**
 * Проверяет доступность LLM провайдера, отправляя минимальный тестовый запрос
 */
export async function checkLlmProviderHealth(
  provider: LlmProvider,
  timeoutMs: number = 10000,
): Promise<LlmProviderHealthCheckResult> {
  const startTime = Date.now();

  try {
    // Получаем access token для провайдеров, которые его требуют
    let accessToken: string = "";
    if (provider.providerType !== "aitunnel" && provider.providerType !== "unica") {
      try {
        accessToken = await fetchAccessToken(provider);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          available: false,
          error: `Не удалось получить токен доступа: ${errorMessage}`,
          responseTimeMs: Date.now() - startTime,
        };
      }
    } else if (provider.providerType === "aitunnel") {
      accessToken = provider.authorizationKey.trim();
      if (!accessToken) {
        return {
          available: false,
          error: "API ключ не настроен",
          responseTimeMs: Date.now() - startTime,
        };
      }
    }

    // Формируем минимальный тестовый запрос в зависимости от типа провайдера
    let testUrl: string;
    let testBody: Record<string, unknown>;
    let testHeaders: Headers;

    if (provider.providerType === "unica") {
      // Unica AI использует потоковый endpoint
      testUrl = provider.completionUrl;
      if (!testUrl.endsWith("/stream")) {
        testUrl = testUrl.endsWith("/") ? `${testUrl}stream` : `${testUrl}/stream`;
      }

      const requestConfig = provider.requestConfig as Record<string, unknown> | undefined;
      const additionalBodyFields = (requestConfig?.additionalBodyFields as Record<string, unknown> | undefined) ?? {};
      const workspaceId = typeof additionalBodyFields.workspace_id === "string" ? additionalBodyFields.workspace_id : "";

      if (!workspaceId) {
        return {
          available: false,
          error: "workspace_id не настроен в additionalBodyFields",
          responseTimeMs: Date.now() - startTime,
        };
      }

      testBody = {
        workspace_id: workspaceId,
        model: provider.model,
        prompt: "test",
        system: "You are a helpful assistant.",
        temperature: 0.3,
        top_p: 100,
      };

      testHeaders = new Headers();
      testHeaders.set("Content-Type", "application/json");
      testHeaders.set("Accept", "text/event-stream");

      for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
        testHeaders.set(key, value);
      }
    } else if (provider.providerType === "aitunnel") {
      testUrl = provider.completionUrl;
      testBody = {
        model: provider.model,
        messages: [{ role: "user", content: "test" }],
        stream: false,
        max_tokens: 10,
      };

      testHeaders = new Headers();
      testHeaders.set("Content-Type", "application/json");
      testHeaders.set("Accept", "application/json");
      testHeaders.set("Authorization", `Bearer ${accessToken}`);

      for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
        testHeaders.set(key, value);
      }
    } else {
      // gigachat и custom провайдеры
      testUrl = provider.completionUrl;
      testBody = {
        model: provider.model,
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      };

      testHeaders = new Headers();
      testHeaders.set("Content-Type", "application/json");
      testHeaders.set("Accept", "application/json");
      if (accessToken.trim().length > 0) {
        testHeaders.set("Authorization", `Bearer ${accessToken}`);
      }

      if (!testHeaders.has("RqUID")) {
        testHeaders.set("RqUID", randomUUID());
      }

      for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
        testHeaders.set(key, value);
      }
    }

    // Отправляем тестовый запрос с таймаутом
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const requestOptions = applyTlsPreferences<NodeFetchOptions>(
        {
          method: "POST",
          headers: testHeaders,
          body: JSON.stringify(testBody),
          signal: controller.signal,
        },
        provider.allowSelfSignedCertificate,
      );

      const response = await fetch(testUrl, requestOptions);
      clearTimeout(timeoutId);

      const responseTimeMs = Date.now() - startTime;

      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        let errorMessage = `Провайдер вернул ошибку ${response.status}`;
        
        try {
          const parsed = JSON.parse(responseText) as Record<string, unknown>;
          if (typeof parsed.error_description === "string") {
            errorMessage = parsed.error_description;
          } else if (typeof parsed.message === "string") {
            errorMessage = parsed.message;
          }
        } catch {
          if (responseText.trim().length > 0) {
            errorMessage = responseText.trim();
          }
        }

        return {
          available: false,
          error: errorMessage,
          responseTimeMs,
        };
      }

      // Для потоковых ответов (unica) проверяем, что получили SSE
      if (provider.providerType === "unica") {
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("text/event-stream")) {
          return {
            available: false,
            error: "Провайдер не вернул поток событий (SSE)",
            responseTimeMs,
          };
        }
        // Для health check достаточно проверить, что поток начался
        // Читаем первые байты, чтобы убедиться, что соединение работает
        try {
          if (response.body) {
            const reader = (response.body as any).getReader?.();
            if (reader) {
              const chunk = await Promise.race([
                reader.read(),
                new Promise<{ done: boolean }>((resolve) => {
                  setTimeout(() => resolve({ done: true }), 1000);
                }),
              ]);
              if (!chunk.done) {
                reader.cancel().catch(() => {
                  // Игнорируем ошибки при отмене
                });
              }
            } else {
              // Если нет getReader, просто отменяем body
              (response.body as any).cancel?.();
            }
          }
        } catch {
          // Если не удалось прочитать поток, это не критично для health check
          // Главное - проверили content-type
        }
      } else {
        // Для не-потоковых ответов проверяем, что получили валидный JSON
        try {
          await response.json();
        } catch {
          return {
            available: false,
            error: "Провайдер вернул невалидный JSON",
            responseTimeMs,
          };
        }
      }

      return {
        available: true,
        responseTimeMs,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const responseTimeMs = Date.now() - startTime;

      if (error instanceof Error && error.name === "AbortError") {
        return {
          available: false,
          error: `Таймаут запроса (${timeoutMs}ms)`,
          responseTimeMs,
        };
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (!provider.allowSelfSignedCertificate && errorMessage.toLowerCase().includes("self-signed certificate")) {
        return {
          available: false,
          error: "Сервер не доверяет сертификату. Разрешите самоподписанные сертификаты в настройках провайдера.",
          responseTimeMs,
        };
      }

      return {
        available: false,
        error: `Не удалось выполнить запрос: ${errorMessage}`,
        responseTimeMs,
      };
    }
  } catch (error) {
    const responseTimeMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      error: errorMessage,
      responseTimeMs,
    };
  }
}
