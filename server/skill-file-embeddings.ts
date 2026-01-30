import fetch, { Headers, type Response } from "node-fetch";
import { EmbeddingProvider } from "@shared/schema";
import { fetchAccessToken } from "./llm-access-token";
import { applyTlsPreferences, type NodeFetchOptions } from "./http-utils";
import type { SkillFileChunk } from "./skill-file-chunking";

type EmbeddingVectorResult = { vector: number[]; usageTokens?: number | null };

const EMBEDDING_MAX_RETRIES = 3;
const EMBEDDING_RETRY_DELAY_MS = 200;
const EMBEDDING_BATCH_SIZE = 8;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createEmbeddingRequestBody(model: string, sampleText: string): Record<string, unknown> {
  return {
    model,
    input: sampleText,
  };
}

function createUnicaEmbeddingRequestBody(
  model: string,
  input: string | string[],
  options?: {
    workSpaceId?: string;
    truncate?: boolean;
    dimensions?: number;
  },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    workSpaceId: options?.workSpaceId ?? "GENERAL",
    model,
    input: Array.isArray(input) ? input : [input],
  };

  if (options?.truncate !== undefined) {
    body.truncate = options.truncate;
  }

  if (options?.dimensions !== undefined && options.dimensions > 0) {
    body.dimensions = options.dimensions;
  }

  return body;
}

function ensureNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const numbers: number[] = [];
  for (const item of value) {
    const n = typeof item === "string" ? parseFloat(item) : item;
    if (typeof n === "number" && !isNaN(n)) {
      numbers.push(n);
    }
  }

  return numbers.length > 0 ? numbers : undefined;
}

class EmbeddingError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = "EmbeddingError";
  }
}

async function callEmbedding(
  provider: EmbeddingProvider,
  accessToken: string,
  text: string,
): Promise<EmbeddingVectorResult> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    headers.set(key, value);
  }

  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const body =
    provider.providerType === "unica"
      ? createUnicaEmbeddingRequestBody(provider.model, text, {
          workSpaceId: provider.requestConfig?.additionalBodyFields?.workSpaceId as string,
          truncate: provider.requestConfig?.additionalBodyFields?.truncate as boolean,
          dimensions: provider.requestConfig?.additionalBodyFields?.dimensions as number,
        })
      : createEmbeddingRequestBody(provider.model, text);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= EMBEDDING_MAX_RETRIES; attempt++) {
    let response: Response | null = null;
    try {
      const requestOptions = applyTlsPreferences<NodeFetchOptions>(
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        provider.allowSelfSignedCertificate,
      );
      response = await fetch(provider.embeddingsUrl, requestOptions);
    } catch (error) {
      lastError = new EmbeddingError(
        "Сервис эмбеддингов временно недоступен. Попробуйте позже.",
        true,
      );
      if (attempt < EMBEDDING_MAX_RETRIES) {
        await sleep(EMBEDDING_RETRY_DELAY_MS * attempt);
        continue;
      }
      throw lastError;
    }

    if (!response) {
      lastError = new EmbeddingError(
        "Сервис эмбеддингов временно недоступен. Попробуйте позже.",
        true,
      );
      if (attempt < EMBEDDING_MAX_RETRIES) {
        await sleep(EMBEDDING_RETRY_DELAY_MS * attempt);
        continue;
      }
      throw lastError;
    }

    const raw = await response.text();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      const status = response.status;
      const retryable = status >= 500 || status === 429 || status === 408;
      const message =
        typeof parsed?.error_description === "string"
          ? parsed.error_description
          : typeof parsed?.message === "string"
          ? parsed.message
          : status >= 500
          ? "Сервис эмбеддингов временно недоступен. Попробуйте позже."
          : "Не удалось обработать документ: выбранная модель эмбеддингов недоступна. Проверьте настройки в админке.";

      if (retryable && attempt < EMBEDDING_MAX_RETRIES) {
        await sleep(EMBEDDING_RETRY_DELAY_MS * attempt);
        continue;
      }

      throw new EmbeddingError(message, retryable);
    }

    if (provider.providerType === "unica") {
      const vectors = (parsed as any)?.vectors;
      if (!Array.isArray(vectors) || vectors.length === 0) {
        throw new EmbeddingError("Сервис Unica AI не вернул векторы", false);
      }

      const vector = ensureNumberArray(vectors[0]);
      if (!vector) {
        throw new EmbeddingError("Сервис Unica AI вернул пустой вектор", false);
      }

      const meta = (parsed as any)?.meta;
      const metrics = meta?.metrics;
      const usageTokens = typeof metrics?.inputTokens === "number" ? metrics.inputTokens : null;

      return {
        vector,
        usageTokens,
      };
    }

    const data = parsed?.data;
    if (!Array.isArray(data) || data.length === 0) {
      throw new EmbeddingError("Сервис эмбеддингов вернул пустой ответ", false);
    }

    const vectorCandidate = data[0]?.embedding ?? data[0]?.vector;
    if (!Array.isArray(vectorCandidate) || vectorCandidate.length === 0) {
      throw new EmbeddingError("Сервис эмбеддингов вернул пустой вектор", false);
    }

    const usage = parsed && typeof parsed.usage === "object" && parsed.usage !== null
      ? (parsed.usage as Record<string, unknown>)
      : null;
    const totalTokens =
      typeof usage?.total_tokens === "number"
        ? usage.total_tokens
        : typeof usage?.input_tokens === "number"
          ? usage.input_tokens
          : null;

    return {
      vector: vectorCandidate as number[],
      usageTokens: totalTokens,
    };
  }

  throw lastError ?? new EmbeddingError("Не удалось получить эмбеддинг", true);
}

export async function embedSkillFileChunks(params: {
  provider: EmbeddingProvider;
  chunks: SkillFileChunk[];
}): Promise<Array<{ chunkId: string; vector: number[]; usageTokens?: number | null }>> {
  const { provider, chunks } = params;
  const accessToken = await fetchAccessToken(provider);
  const results: Array<{ chunkId: string; vector: number[]; usageTokens?: number | null }> = [];

  for (let index = 0; index < chunks.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(index, index + EMBEDDING_BATCH_SIZE);
    for (const chunk of batch) {
      try {
        const embedding = await callEmbedding(provider, accessToken, chunk.text);
        results.push({ chunkId: chunk.id, vector: embedding.vector, usageTokens: embedding.usageTokens ?? null });
      } catch (error) {
        if (error instanceof EmbeddingError) {
          throw error;
        }
        throw new EmbeddingError("Не удалось получить эмбеддинги для документа", true);
      }
    }
  }

  return results;
}

export { EmbeddingError, EMBEDDING_BATCH_SIZE };

export async function embedTextWithProvider(provider: EmbeddingProvider, text: string): Promise<EmbeddingVectorResult> {
  const accessToken = await fetchAccessToken(provider);
  return callEmbedding(provider, accessToken, text);
}
