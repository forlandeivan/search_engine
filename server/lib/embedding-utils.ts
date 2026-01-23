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
  
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        input: text,
        model,
      }),
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
    throw new Error(`Embedding request failed: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    data?: Array<{ embedding?: number[] }>;
    usage?: { total_tokens?: number };
  };

  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Invalid embedding response format');
  }

  return {
    vector: embedding,
    usageTokens: data?.usage?.total_tokens,
  };
}
