import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DOMPurify from "dompurify";
import { marked } from "marked";

import type { RagChunk } from "@/types/search";

const ASK_STATUS_PENDING = "Готовим ответ…";

interface HybridWeights {
  weight?: number | null;
  limit?: number | null;
}

interface VectorSettings extends HybridWeights {
  collection?: string | null;
  embeddingProviderId?: string | null;
}

export interface KnowledgeBaseAskAiHybridOptions {
  topK?: number | null;
  bm25?: HybridWeights | null;
  vector?: VectorSettings | null;
}

export interface KnowledgeBaseAskAiLlmOptions {
  providerId?: string | null;
  model?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  systemPrompt?: string | null;
  responseFormat?: string | null;
}

export interface UseKnowledgeBaseAskAiOptions {
  knowledgeBaseId: string | null | undefined;
  hybrid?: KnowledgeBaseAskAiHybridOptions | null;
  llm?: KnowledgeBaseAskAiLlmOptions | null;
  baseUrl?: string | null;
  workspaceId?: string | null;
  collection?: string | null;
  embeddingProviderId?: string | null;
}

export interface KnowledgeBaseAskAiState {
  isActive: boolean;
  question: string;
  answerHtml: string;
  statusMessage: string | null;
  showIndicator: boolean;
  error: string | null;
  sources: RagChunk[];
  isStreaming: boolean;
  isDone: boolean;
}

export interface UseKnowledgeBaseAskAiResult {
  state: KnowledgeBaseAskAiState;
  ask: (question: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
  isEnabled: boolean;
  disabledReason: string | null;
}

const INITIAL_STATE: KnowledgeBaseAskAiState = {
  isActive: false,
  question: "",
  answerHtml: "",
  statusMessage: null,
  showIndicator: false,
  error: null,
  sources: [],
  isStreaming: false,
  isDone: false,
};

const clampNumber = (value: number | null, min: number, max: number): number | null => {
  if (value === null) {
    return null;
  }
  if (Number.isNaN(value)) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizeWeight = (value: unknown): number | null => {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }
  return clampNumber(parsed, 0, 1);
};

const normalizeLimit = (value: unknown): number | null => {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }
  const rounded = Math.round(parsed);
  return clampNumber(rounded, 1, 50);
};

const normalizeTopK = (value: unknown): number => {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return 6;
  }
  const rounded = Math.round(parsed);
  return clampNumber(rounded, 1, 20) ?? 6;
};

const normalizeTemperature = (value: unknown): number | null => {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }
  return clampNumber(parsed, 0, 2);
};

const normalizeMaxTokens = (value: unknown): number | null => {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return null;
  }
  const rounded = Math.round(parsed);
  return clampNumber(rounded, 16, 4096);
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
};

const getString = (source: Record<string, unknown>, key: string): string | null => {
  const value = source[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
};

const getNumber = (source: Record<string, unknown>, key: string): number | null => {
  const value = source[key];
  const parsed = parseNumber(value);
  return parsed === null ? null : parsed;
};

const normalizeResponseFormat = (value: unknown): "text" | "markdown" | "html" | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "html") {
    return "html";
  }
  if (normalized === "markdown" || normalized === "md") {
    return "markdown";
  }
  if (normalized === "text" || normalized === "plain") {
    return "text";
  }
  return null;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const toHtml = (answer: string, format: "text" | "markdown" | "html" | null): string => {
  const trimmed = answer.trim();
  if (!trimmed) {
    return "";
  }

  if (format === "html") {
    return DOMPurify.sanitize(trimmed, { USE_PROFILES: { html: true } });
  }

  if (format === "markdown") {
    const parsedMarkdown = marked.parse(trimmed, { async: false }) as string;
    return DOMPurify.sanitize(parsedMarkdown, { USE_PROFILES: { html: true } });
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph.replace(/\n/g, " ").trim())}</p>`)
    .join("");
  return DOMPurify.sanitize(paragraphs, { USE_PROFILES: { html: true } });
};

const normalizeChunk = (entry: unknown, fallbackIndex: number): RagChunk | null => {
  const record = toRecord(entry);
  if (!record) {
    return null;
  }

  const chunkId =
    getString(record, "chunk_id") ??
    getString(record, "chunkId") ??
    getString(record, "id") ??
    `chunk-${fallbackIndex + 1}`;
  const docId = getString(record, "doc_id") ?? getString(record, "docId") ?? null;
  const docTitle = getString(record, "doc_title") ?? getString(record, "docTitle") ?? null;
  const sectionTitle =
    getString(record, "section_title") ??
    getString(record, "sectionTitle") ??
    null;
  const snippet = getString(record, "snippet") ?? getString(record, "excerpt") ?? "";
  const text = getString(record, "text") ?? null;
  const score = getNumber(record, "score") ?? 0;
  const scoresRecord = toRecord(record.scores ?? null);
  const bm25Score = scoresRecord ? getNumber(scoresRecord, "bm25") ?? null : null;
  const vectorScore = scoresRecord ? getNumber(scoresRecord, "vector") ?? null : null;
  const nodeId = getString(record, "node_id") ?? getString(record, "nodeId") ?? null;
  const nodeSlug = getString(record, "node_slug") ?? getString(record, "nodeSlug") ?? null;

  return {
    chunk_id: chunkId,
    doc_id: docId ?? chunkId,
    doc_title: docTitle ?? docId ?? chunkId,
    section_title: sectionTitle,
    snippet,
    text: text ?? undefined,
    score,
    scores:
      bm25Score !== null || vectorScore !== null
        ? {
            bm25: bm25Score ?? undefined,
            vector: vectorScore ?? undefined,
          }
        : undefined,
    node_id: nodeId ?? undefined,
    node_slug: nodeSlug ?? undefined,
  };
};

const mapCitations = (value: unknown): RagChunk[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  const result: RagChunk[] = [];
  value.forEach((entry, index) => {
    const chunk = normalizeChunk(entry, index);
    if (chunk) {
      result.push(chunk);
    }
  });
  return result;
};

const buildEndpoint = (baseUrl: string): string => {
  const defaultEndpoint = "/api/public/collections/search/rag";
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return defaultEndpoint;
  }

  const normalized = trimmed.replace(/\/+$/, "");
  const lowerNormalized = normalized.toLowerCase();
  const knownPatterns = [
    /\/(?:api\/)?public\/collections\/search\/rag(?:\b|\/|\?|#)/,
    /\/(?:api\/)?public\/(?:rag|collections\/rag)\/answer(?:\b|\/|\?|#)/,
  ];
  if (knownPatterns.some((pattern) => pattern.test(lowerNormalized))) {
    return normalized;
  }

  const hasApiSuffix = /\/api(?:\b|\/|\?|#)/.test(`${lowerNormalized}/`);
  const pathToAppend = hasApiSuffix ? defaultEndpoint.replace(/^\/api/, "") : defaultEndpoint;
  return `${normalized}${pathToAppend}`;
};

const extractErrorMessage = async (response: Response): Promise<string> => {
  const rawText = await response.text();
  const trimmed = rawText.trim();
  if (!trimmed) {
    return `Не удалось получить ответ (код ${response.status})`;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: string; message?: string; details?: string };
      const parts: string[] = [];
      if (parsed.error) {
        parts.push(parsed.error);
      }
      if (parsed.message) {
        parts.push(parsed.message);
      }
      if (parsed.details) {
        parts.push(parsed.details);
      }
      if (parts.length > 0) {
        return parts.join(" — ");
      }
    } catch {
      return `Не удалось получить ответ (код ${response.status})`;
    }
  }

  if (trimmed.startsWith("<")) {
    return response.statusText || `Не удалось получить ответ (код ${response.status})`;
  }

  return trimmed;
};

export function useKnowledgeBaseAskAi(options: UseKnowledgeBaseAskAiOptions): UseKnowledgeBaseAskAiResult {
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<KnowledgeBaseAskAiState>(INITIAL_STATE);

  const normalized = useMemo(() => {
    const baseId = typeof options.knowledgeBaseId === "string" ? options.knowledgeBaseId.trim() : "";
    const hybrid = options.hybrid ?? null;
    const explicitCollection =
      typeof options.collection === "string" ? options.collection.trim() : "";
    const bm25Weight = normalizeWeight(hybrid?.bm25?.weight ?? null);
    const bm25Limit = normalizeLimit(hybrid?.bm25?.limit ?? null);
    const vectorWeight = normalizeWeight(hybrid?.vector?.weight ?? null);
    const vectorLimit = normalizeLimit(hybrid?.vector?.limit ?? null);
    const vectorCollection =
      typeof hybrid?.vector?.collection === "string" ? hybrid.vector.collection.trim() : "";
    const vectorEmbeddingProviderId =
      typeof hybrid?.vector?.embeddingProviderId === "string"
        ? hybrid.vector.embeddingProviderId.trim()
        : "";
    const explicitEmbeddingProviderId =
      typeof options.embeddingProviderId === "string"
        ? options.embeddingProviderId.trim()
        : "";
    const embeddingProviderId = vectorEmbeddingProviderId || explicitEmbeddingProviderId;
    const collectionName = vectorCollection || explicitCollection;

    const topK = normalizeTopK(hybrid?.topK ?? null);

    const llmProviderId =
      typeof options.llm?.providerId === "string" ? options.llm.providerId.trim() : "";
    const llmModel = typeof options.llm?.model === "string" ? options.llm.model.trim() : "";
    const temperature = normalizeTemperature(options.llm?.temperature ?? null);
    const maxTokens = normalizeMaxTokens(options.llm?.maxTokens ?? null);
    const systemPrompt =
      typeof options.llm?.systemPrompt === "string" ? options.llm.systemPrompt : "";
    const responseFormat = normalizeResponseFormat(options.llm?.responseFormat ?? null);
    const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : "";
    const workspaceId = typeof options.workspaceId === "string" ? options.workspaceId.trim() : "";

    let disabledReason: string | null = null;
    if (!baseId) {
      disabledReason = "Выберите базу знаний для Ask AI.";
    } else if (!llmProviderId) {
      disabledReason = "Настройте провайдера LLM для Ask AI.";
    } else if (vectorWeight !== null && vectorWeight > 0) {
      if (!collectionName) {
        disabledReason = "Укажите коллекцию для векторного поиска.";
      } else if (!embeddingProviderId) {
        disabledReason = "Укажите сервис эмбеддингов для Ask AI.";
      }
    }

    return {
      baseId,
      workspaceId,
      topK,
      bm25Weight,
      bm25Limit,
      vectorWeight,
      vectorLimit,
      collection: collectionName,
      embeddingProviderId,
      llmProviderId,
      llmModel,
      temperature,
      maxTokens,
      systemPrompt,
      responseFormat,
      disabledReason,
      endpoint: buildEndpoint(baseUrl ?? ""),
    };
  }, [
    options.baseUrl,
    options.collection,
    options.embeddingProviderId,
    options.hybrid,
    options.llm,
    options.knowledgeBaseId,
    options.workspaceId,
  ]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question) {
        return;
      }
      if (normalized.disabledReason) {
        setState((prev) => ({
          ...prev,
          error: normalized.disabledReason,
          statusMessage: null,
          showIndicator: false,
          isStreaming: false,
          isDone: true,
        }));
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({
        isActive: true,
        question,
        answerHtml: "",
        statusMessage: ASK_STATUS_PENDING,
        showIndicator: true,
        error: null,
        sources: [],
        isStreaming: true,
        isDone: false,
      });

      const isLegacyEndpoint = /\/public\/rag\/answer(?:\b|\/|\?|#)/.test(normalized.endpoint);

      const bm25Payload: Record<string, unknown> = {};
      const vectorPayload: Record<string, unknown> = {};

      if (normalized.bm25Weight !== null) {
        bm25Payload.weight = normalized.bm25Weight;
      }
      if (normalized.bm25Limit !== null) {
        bm25Payload.limit = normalized.bm25Limit;
      }
      if (normalized.vectorWeight !== null) {
        vectorPayload.weight = normalized.vectorWeight;
      }
      if (normalized.vectorLimit !== null) {
        vectorPayload.limit = normalized.vectorLimit;
      }
      if (normalized.collection) {
        vectorPayload.collection = normalized.collection;
      }
      let payload: Record<string, unknown>;

      if (isLegacyEndpoint) {
        const llmPayload: Record<string, unknown> = { provider: normalized.llmProviderId };

        if (normalized.llmModel) {
          llmPayload.model = normalized.llmModel;
        }
        if (normalized.temperature !== null) {
          llmPayload.temperature = normalized.temperature;
        }
        if (normalized.maxTokens !== null) {
          llmPayload.max_tokens = normalized.maxTokens;
        }
        if (normalized.systemPrompt && normalized.systemPrompt.trim()) {
          llmPayload.system_prompt = normalized.systemPrompt;
        }
        if (normalized.responseFormat) {
          llmPayload.response_format = normalized.responseFormat;
        }

        const legacyVectorPayload: Record<string, unknown> = { ...vectorPayload };
        if (normalized.embeddingProviderId) {
          legacyVectorPayload.embedding_provider_id = normalized.embeddingProviderId;
        }

        payload = {
          q: question,
          kb_id: normalized.baseId,
          top_k: normalized.topK,
          hybrid: {
            bm25: bm25Payload,
            vector: legacyVectorPayload,
          },
          llm: llmPayload,
        };
      } else {
        payload = {
          query: question,
          hybrid: {
            bm25: bm25Payload,
            vector: vectorPayload,
          },
        };

        if (normalized.embeddingProviderId) {
          vectorPayload.embeddingProviderId = normalized.embeddingProviderId;
        }

        if (normalized.baseId) {
          payload.kbId = normalized.baseId;
        }
        if (normalized.workspaceId) {
          payload.workspace_id = normalized.workspaceId;
        }
        if (normalized.collection) {
          payload.collection = normalized.collection;
        }

        if (typeof normalized.topK === "number") {
          payload.topK = normalized.topK;
        }

        if (normalized.embeddingProviderId) {
          payload.embeddingProviderId = normalized.embeddingProviderId;
        }

        if (normalized.llmProviderId) {
          payload.llmProviderId = normalized.llmProviderId;
        }

        if (normalized.llmModel) {
          payload.llmModel = normalized.llmModel;
        }
        if (normalized.temperature !== null) {
          payload.llmTemperature = normalized.temperature;
        }
        if (normalized.maxTokens !== null) {
          payload.llmMaxTokens = normalized.maxTokens;
        }
        if (normalized.systemPrompt && normalized.systemPrompt.trim()) {
          payload.llmSystemPrompt = normalized.systemPrompt;
        }
        if (normalized.responseFormat) {
          payload.llmResponseFormat = normalized.responseFormat;
          payload.responseFormat = normalized.responseFormat;
        }
      }

      try {
        const response = await fetch(normalized.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream, application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(await extractErrorMessage(response));
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("text/event-stream")) {
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("Не удалось прочитать поток ответа.");
          }

          const decoder = new TextDecoder("utf-8");
          let buffer = "";
          let aggregatedAnswer = "";
          let typedAnswer = "";
          let typingQueue = "";
          let typingTimer: ReturnType<typeof setInterval> | null = null;
          let currentFormat = normalized.responseFormat ?? "text";
          let citations: RagChunk[] = [];
          let statusMessage: string | null = ASK_STATUS_PENDING;
          let completed = false;

          const stopTypingTimer = () => {
            if (typingTimer !== null) {
              clearInterval(typingTimer);
              typingTimer = null;
            }
          };

          const flushTypingQueue = () => {
            stopTypingTimer();
            if (typingQueue) {
              typedAnswer += typingQueue;
              typingQueue = "";
            }
          };

          const pushUpdate = () => {
            setState((prev) => ({
              ...prev,
              answerHtml: toHtml(typedAnswer, currentFormat),
              sources: citations,
              statusMessage,
              showIndicator: true,
              isStreaming: true,
              error: null,
            }));
          };

          const startTypingTimer = () => {
            if (typingTimer !== null) {
              return;
            }
            typingTimer = setInterval(() => {
              if (!typingQueue) {
                stopTypingTimer();
                return;
              }
              const nextChar = typingQueue.slice(0, 1);
              typingQueue = typingQueue.slice(1);
              typedAnswer += nextChar;
              pushUpdate();
            }, 18);
          };

          const applyRecord = (recordValue: unknown) => {
            const record = toRecord(recordValue);
            if (!record) {
              return;
            }

            if (typeof record.status === "string" && record.status.trim()) {
              statusMessage = record.status.trim();
            } else if (typeof record.message === "string" && record.message.trim()) {
              statusMessage = record.message.trim();
            }

            if (Array.isArray(record.citations)) {
              citations = mapCitations(record.citations);
            }

            const maybeFormat = normalizeResponseFormat(record.format ?? record.response_format ?? null);
            if (maybeFormat) {
              currentFormat = maybeFormat;
            }

            const delta =
              typeof record.delta === "string"
                ? record.delta
                : typeof record.text === "string"
                  ? record.text
                  : typeof record.answer === "string"
                    ? record.answer
                    : "";

            if (delta) {
              aggregatedAnswer += delta;
              typingQueue += delta;
              startTypingTimer();
            }

            if (typeof record.completed === "boolean" && record.completed) {
              completed = true;
            }
          };

          pushUpdate();

          let streamingError: unknown = null;
          try {
            while (!completed) {
              const { value, done } = await reader.read();
              if (done) {
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              let boundaryIndex = buffer.indexOf("\n\n");

              while (boundaryIndex !== -1) {
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
                    dataLines.push(line.slice(5));
                  }
                }

                const dataPayload = dataLines.join("\n").trim();
                if (!dataPayload) {
                  continue;
                }

                if (dataPayload === "[DONE]") {
                  completed = true;
                  break;
                }

                if (eventName === "error") {
                  let message = dataPayload;
                  if (dataPayload.startsWith("{") || dataPayload.startsWith("[")) {
                    try {
                      const parsed = JSON.parse(dataPayload) as { message?: string; error?: string };
                      message = parsed.message || parsed.error || message;
                    } catch {
                      // ignore
                    }
                  }
                  throw new Error(message || "Ошибка при выполнении запроса");
                }

                let parsedPayload: unknown = dataPayload;
                if (dataPayload.startsWith("{") || dataPayload.startsWith("[")) {
                  try {
                    parsedPayload = JSON.parse(dataPayload);
                  } catch {
                    parsedPayload = dataPayload;
                  }
                }

                if (eventName === "metadata") {
                  applyRecord(parsedPayload);
                  pushUpdate();
                  continue;
                }

                if (eventName === "complete") {
                  applyRecord(parsedPayload);
                  completed = true;
                  break;
                }

                if (typeof parsedPayload === "string") {
                  aggregatedAnswer += parsedPayload;
                  typingQueue += parsedPayload;
                  startTypingTimer();
                } else {
                  applyRecord(parsedPayload);
                }

                pushUpdate();
              }
            }
          } catch (error) {
            streamingError = error;
          } finally {
            flushTypingQueue();

            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
          }

          if (streamingError) {
            throw streamingError;
          }

          setState((prev) => ({
            ...prev,
            answerHtml: toHtml(typedAnswer || aggregatedAnswer, currentFormat),
            sources: citations,
            statusMessage: null,
            showIndicator: false,
            error: null,
            isStreaming: false,
            isDone: true,
          }));
        } else {
          const payloadBody = (await response.json()) as {
            answer?: string;
            format?: string;
            response_format?: string;
            citations?: unknown;
          };
          const finalFormat =
            normalizeResponseFormat(payloadBody.format ?? payloadBody.response_format ?? null) ??
            normalized.responseFormat ??
            "text";
          const citations = mapCitations(payloadBody.citations ?? null);
          const answer = typeof payloadBody.answer === "string" ? payloadBody.answer : "";

          setState((prev) => ({
            ...prev,
            answerHtml: toHtml(answer, finalFormat),
            sources: citations,
            statusMessage: null,
            showIndicator: false,
            error: null,
            isStreaming: false,
            isDone: true,
          }));
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          setState((prev) => ({
            ...prev,
            statusMessage: "Запрос остановлен.",
            showIndicator: false,
            isStreaming: false,
            error: null,
            isDone: true,
          }));
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setState((prev) => ({
          ...prev,
          statusMessage: null,
          showIndicator: false,
          isStreaming: false,
          error: message || "Не удалось получить ответ.",
          isDone: true,
        }));
      } finally {
        abortRef.current = null;
      }
    },
    [normalized],
  );

  const stop = useCallback(() => {
    if (!abortRef.current) {
      return;
    }
    abortRef.current.abort();
    abortRef.current = null;
    setState((prev) => ({
      ...prev,
      statusMessage: "Запрос остановлен.",
      showIndicator: false,
      isStreaming: false,
      error: null,
      isDone: true,
    }));
  }, []);

  return useMemo(
    () => ({
      state,
      ask,
      stop,
      reset,
      isEnabled: !normalized.disabledReason,
      disabledReason: normalized.disabledReason,
    }),
    [ask, normalized.disabledReason, reset, state, stop],
  );
}
