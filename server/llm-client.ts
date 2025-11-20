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

type ExecuteOptions = {
  stream?: boolean;
  responseFormat?: RagResponseFormat;
  onBeforeRequest?: (details: ApiRequestLog) => void;
};

export function executeLlmCompletion(
  provider: LlmProvider,
  accessToken: string,
  rawBody: Record<string, unknown>,
  options?: ExecuteOptions,
): LlmCompletionPromise {
  const body: Record<string, unknown> = { ...rawBody };
  if (options?.stream === true) {
    body.stream = true;
  }

  const wantsStream = body.stream === true;
  const llmHeaders = new Headers();
  llmHeaders.set("Content-Type", "application/json");
  llmHeaders.set("Accept", wantsStream ? "text/event-stream, application/json" : "application/json");

  if (!llmHeaders.has("RqUID")) {
    llmHeaders.set("RqUID", randomUUID());
  }

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    llmHeaders.set(key, value);
  }

  if (!llmHeaders.has("Authorization")) {
    llmHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const streamController = wantsStream ? createAsyncStreamController<LlmStreamEvent>() : null;

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

      completionResponse = await fetch(provider.completionUrl, requestOptions);
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

      streamController?.fail(new Error(message));
      throw new Error(message);
    }

    if (wantsStream) {
      const contentType = completionResponse.headers.get("Content-Type") ?? "";

      if (!contentType.toLowerCase().includes("text/event-stream")) {
        streamController?.fail(new Error("LLM не вернул поток данных"));
        throw new Error("LLM не вернул поток данных");
      }

      const reader = completionResponse.body?.getReader();
      if (!reader) {
        streamController?.fail(new Error("Не удалось прочитать поток LLM"));
        throw new Error("Не удалось прочитать поток LLM");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let aggregatedAnswer = "";
      let usageTokens: number | null = null;
      const rawEvents: Array<{ event: string; data: unknown }> = [];
      let streamCompleted = false;

      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            break;
          }

          buffer += decoder.decode(chunk.value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) {
              continue;
            }

            if (trimmed.startsWith("event:")) {
              const eventName = trimmed.slice(6).trim();
              const dataLine = lines.shift();
              const payload =
                dataLine && dataLine.startsWith("data:") ? dataLine.slice(5).trim() : "";

              rawEvents.push({ event: eventName, data: payload });

              if (eventName === "delta") {
                const delta = payload ? JSON.parse(payload) : null;
                const text = delta?.text ?? "";
                aggregatedAnswer += typeof text === "string" ? text : "";
                streamController?.push({ event: "delta", data: { text } });
              } else if (eventName === "usage") {
                try {
                  const parsedUsage = JSON.parse(payload);
                  const total = parsedUsage?.total_tokens;
                  if (typeof total === "number" && Number.isFinite(total)) {
                    usageTokens = total;
                  }
                } catch {
                  // ignore
                }
              } else if (eventName === "done") {
                streamCompleted = true;
              } else {
                streamController?.push({ event: eventName, data: payload ? JSON.parse(payload) : {} });
              }
            }
          }
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
  return executeLlmCompletion(provider, accessToken, requestBody, options);
}
