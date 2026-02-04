/**
 * Embedding Utilities
 * 
 * Shared functions for embedding operations used across routes.
 * Extracted from routes.ts for modularization.
 */

import { randomUUID } from 'crypto';
import { fetchAccessToken } from '../llm-access-token';
import { buildVectorPayload } from '../qdrant-utils';
import { createLogger } from './logger';
import type { EmbeddingProvider } from '@shared/schema';

export { fetchAccessToken, buildVectorPayload };

const logger = createLogger('embedding-utils');

// ============================================================================
// parseVectorSize
// ============================================================================

export function parseVectorSize(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

// ============================================================================
// recordEmbeddingUsageSafe
// ============================================================================

export async function recordEmbeddingUsageSafe(params: {
  workspaceId?: string | null;
  provider: EmbeddingProvider;
  modelKey?: string | null;
  modelId?: string | null;
  tokensTotal?: number | null;
  contentBytes?: number | null;
  operationId?: string;
  occurredAt?: Date;
}): Promise<void> {
  if (!params.workspaceId) return;
  
  const tokensTotal =
    params.tokensTotal ??
    (params.contentBytes !== null && params.contentBytes !== undefined
      ? Math.max(1, Math.ceil(params.contentBytes / 4))
      : null);
  if (tokensTotal === null || tokensTotal === undefined) return;

  // Log usage for tracking (actual storage recording happens in routes.ts)
  logger.debug({
    workspaceId: params.workspaceId,
    providerId: params.provider.id,
    tokensTotal,
    operationId: params.operationId ?? `embedding-${randomUUID()}`,
  }, 'Embedding usage recorded');
}

// ============================================================================
// measureTokensForModel
// ============================================================================

export interface TokenMeasurement {
  quantityRaw: number;
  quantityBilled: number;
  quantityUnits: number;
  quantity: number;
  unit: 'TOKENS_1K' | 'MINUTES';
}

export function measureTokensForModel(
  tokens: number,
  options: { consumptionUnit?: string; modelKey?: string | null },
): TokenMeasurement | null {
  if (!Number.isFinite(tokens) || tokens <= 0) {
    return null;
  }

  const unit = (options.consumptionUnit ?? 'TOKENS_1K') as 'TOKENS_1K' | 'MINUTES';
  
  if (unit === 'TOKENS_1K') {
    const quantityBilled = Math.ceil(tokens / 1000);
    return {
      quantityRaw: tokens,
      quantityBilled,
      quantityUnits: quantityBilled,
      quantity: quantityBilled,
      unit,
    };
  }

  return {
    quantityRaw: tokens,
    quantityBilled: tokens,
    quantityUnits: tokens,
    quantity: tokens,
    unit,
  };
}

// ============================================================================
// fetchEmbeddingVector
// ============================================================================

export interface EmbeddingResult {
  vector: number[];
  usageTokens?: number;
}

// Создаёт тело запроса для стандартного (OpenAI-совместимого) провайдера
function createStandardEmbeddingRequestBody(model: string, text: string): Record<string, unknown> {
  return {
    model,
    input: text,
  };
}

// Создаёт тело запроса для Unica AI провайдера
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

// Извлекает вектор из ответа Unica AI провайдера
function extractUnicaEmbeddingVector(data: Record<string, unknown>): number[] | undefined {
  const vectors = data.vectors;
  if (Array.isArray(vectors) && vectors.length > 0) {
    const firstVector = vectors[0];
    if (Array.isArray(firstVector) && firstVector.every((v) => typeof v === "number")) {
      return firstVector as number[];
    }
  }
  return undefined;
}

// Извлекает вектор из ответа стандартного (OpenAI-совместимого) провайдера
function extractStandardEmbeddingVector(data: Record<string, unknown>): number[] | undefined {
  // Формат OpenAI: { data: [{ embedding: [...] }] }
  const dataArray = data.data;
  if (Array.isArray(dataArray) && dataArray.length > 0) {
    const firstEntry = dataArray[0] as Record<string, unknown> | undefined;
    const embedding = firstEntry?.embedding ?? firstEntry?.vector;
    if (Array.isArray(embedding) && embedding.every((v) => typeof v === "number")) {
      return embedding as number[];
    }
  }
  // Альтернативный формат: { embedding: [...] }
  const embedding = data.embedding;
  if (Array.isArray(embedding) && embedding.every((v) => typeof v === "number")) {
    return embedding as number[];
  }
  return undefined;
}

export async function fetchEmbeddingVector(
  provider: EmbeddingProvider,
  accessToken: string,
  text: string,
): Promise<EmbeddingResult> {
  const endpoint = provider.embeddingsUrl;
  if (!endpoint) {
    throw new Error('Embedding endpoint not configured');
  }

  const model = provider.model || 'text-embedding-ada-002';
  const isUnicaProvider = provider.providerType === "unica";
  
  // Формируем тело запроса в зависимости от типа провайдера
  const requestBody = isUnicaProvider
    ? createUnicaEmbeddingRequestBody(model, text, {
        workSpaceId: provider.unicaWorkspaceId ?? (provider.requestConfig?.additionalBodyFields?.workSpaceId as string) ?? "GENERAL",
        truncate: provider.requestConfig?.additionalBodyFields?.truncate as boolean | undefined,
        dimensions: provider.requestConfig?.additionalBodyFields?.dimensions as number | undefined,
      })
    : createStandardEmbeddingRequestBody(model, text);
  
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    // Обрабатываем сетевые ошибки fetch
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNetworkError = 
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('NetworkError') ||
      errorMessage.includes('Network request failed') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('ETIMEDOUT');
    
    if (isNetworkError) {
      throw new Error(
        `Не удалось подключиться к сервису эмбеддингов по адресу ${endpoint}. Проверьте доступность сервиса и настройки сети.`
      );
    }
    
    // Для других ошибок пробрасываем как есть
    throw new Error(
      `Ошибка при запросе к сервису эмбеддингов: ${errorMessage}`
    );
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Embedding request failed (${response.status}): ${errorText} [провайдер: ${provider.providerType}, модель: ${model}]`);
  }

  const data = await response.json() as Record<string, unknown>;

  // Извлекаем вектор в зависимости от типа провайдера
  const vector = isUnicaProvider
    ? extractUnicaEmbeddingVector(data)
    : extractStandardEmbeddingVector(data);

  if (!Array.isArray(vector) || vector.length === 0) {
    const responsePreview = JSON.stringify(data).substring(0, 300);
    throw new Error(`Некорректный формат ответа от API эмбеддингов (провайдер: ${provider.providerType}). Ответ: ${responsePreview}...`);
  }

  // Извлекаем usage tokens
  let usageTokens: number | undefined;
  const usage = data.usage as Record<string, unknown> | undefined;
  if (usage?.total_tokens !== undefined && typeof usage.total_tokens === "number") {
    usageTokens = usage.total_tokens;
  } else if (isUnicaProvider) {
    // Для Unica токены могут быть в meta.metrics.inputTokens
    const meta = data.meta as Record<string, unknown> | undefined;
    const metrics = meta?.metrics as Record<string, unknown> | undefined;
    if (metrics?.inputTokens !== undefined && typeof metrics.inputTokens === "number") {
      usageTokens = metrics.inputTokens;
    }
  }

  return {
    vector,
    usageTokens,
  };
}
