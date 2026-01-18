/**
 * Chat LLM Helper Functions
 * 
 * Shared utilities for LLM chat operations including:
 * - SSE event streaming
 * - Preflight credits checking
 * - Price calculations
 * - No-code flow error handling
 */

import type { Response } from 'express';
import { ChatServiceError } from '../chat-service';
import { assertSufficientWorkspaceCredits, InsufficientCreditsError } from '../credits-precheck';
import { IdempotencyKeyReusedError } from '../idempotent-charge-service';
import { estimateLlmPreflight } from '../preflight-estimator';
import { calculatePriceForUsage } from '../price-calculator';
import type { LlmStreamEvent } from '../llm-client';
import type { UsageMeasurement } from '../consumption-meter';
import type { Model, ModelConsumptionUnit } from '@shared/schema';

// ============================================================================
// Types
// ============================================================================

export type NoCodeFlowFailureReason = 'NOT_CONFIGURED' | 'DELIVERY_FAILED';

export interface ModelInfoForUsage {
  id?: string | null;
  modelKey?: string | null;
  consumptionUnit?: string;
  creditsPerUnit?: number | null;
  displayName?: string | null;
  modelType?: string;
}

// Re-export for convenience
export type { UsageMeasurement } from '../consumption-meter';

// ============================================================================
// Constants
// ============================================================================

export const NO_CODE_FLOW_MESSAGES: Record<NoCodeFlowFailureReason, string> = {
  NOT_CONFIGURED: 'Навык работает в режиме no-code, но endpoint не настроен',
  DELIVERY_FAILED: 'Не удалось отправить событие в no-code обработчик',
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Creates a ChatServiceError for no-code flow failures
 */
export function createNoCodeFlowError(reason: NoCodeFlowFailureReason): ChatServiceError {
  const code = reason === 'NOT_CONFIGURED' ? 'NO_CODE_UNAVAILABLE' : 'NO_CODE_FAILED';
  return new ChatServiceError(NO_CODE_FLOW_MESSAGES[reason], 503, code, { reason });
}

/**
 * Sends an SSE (Server-Sent Events) event to the response stream
 */
export function sendSseEvent(res: Response, eventName: string, data?: unknown): void {
  const body = typeof data === 'string' || data === undefined ? data ?? '' : JSON.stringify(data);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${body}\n\n`);
}

/**
 * Calculates price snapshot for usage tracking
 */
export function calculatePriceSnapshot(
  modelInfo: ModelInfoForUsage | null | undefined,
  measurement: UsageMeasurement | null,
): ReturnType<typeof calculatePriceForUsage> | null {
  if (!modelInfo || !measurement || !modelInfo.consumptionUnit) return null;
  
  // Validate consumptionUnit is a valid ModelConsumptionUnit
  if (modelInfo.consumptionUnit !== "TOKENS_1K" && modelInfo.consumptionUnit !== "MINUTES") {
    return null;
  }
  
  try {
    const model: Pick<Model, "consumptionUnit" | "creditsPerUnit"> = {
      consumptionUnit: modelInfo.consumptionUnit as ModelConsumptionUnit,
      creditsPerUnit: modelInfo.creditsPerUnit ?? 0,
    };
    const price = calculatePriceForUsage(model, measurement);
    return price;
  } catch (error) {
    console.warn(`[pricing] failed to calculate price for model ${modelInfo.modelKey ?? modelInfo.id ?? 'unknown'}`, error);
    return null;
  }
}

/**
 * Handles preflight error responses
 * Returns true if error was handled, false otherwise
 */
export function handlePreflightError(res: Response, error: unknown): boolean {
  if (error instanceof InsufficientCreditsError) {
    res.status(error.status).json({
      errorCode: error.code,
      message: error.message,
      details: error.details,
    });
    return true;
  }
  if (error instanceof IdempotencyKeyReusedError) {
    res.status(error.status).json({
      errorCode: error.code,
      message: error.message,
      details: error.details,
    });
    return true;
  }
  return false;
}

/**
 * Ensures workspace has sufficient credits for LLM request
 */
export async function ensureCreditsForLlmPreflight(
  workspaceId: string | null,
  modelInfo: ModelInfoForUsage | null,
  promptTokens: number,
  maxOutputTokens: number | null | undefined,
): Promise<void> {
  if (!workspaceId || !modelInfo || !modelInfo.consumptionUnit) return;
  
  // Validate consumptionUnit is a valid ModelConsumptionUnit
  if (modelInfo.consumptionUnit !== "TOKENS_1K" && modelInfo.consumptionUnit !== "MINUTES") {
    return;
  }
  
  const model: Pick<Model, "consumptionUnit" | "creditsPerUnit"> = {
    consumptionUnit: modelInfo.consumptionUnit as ModelConsumptionUnit,
    creditsPerUnit: modelInfo.creditsPerUnit ?? 0,
  };
  const estimate = estimateLlmPreflight(model, { promptTokens, maxOutputTokens });
  await assertSufficientWorkspaceCredits(workspaceId, estimate.estimatedCreditsCents, {
    modelId: modelInfo.id ?? null,
    modelKey: modelInfo.modelKey ?? null,
    unit: estimate.unit,
    estimatedUnits: estimate.estimatedUnits,
  });
}

/**
 * Forwards LLM stream events to SSE emitter
 */
export function forwardLlmStreamEvents(
  iterator: AsyncIterable<LlmStreamEvent>,
  emit: (eventName: string, payload?: unknown) => void,
): Promise<void> {
  return (async () => {
    const startTime = Date.now();
    let chunkCount = 0;
    let lastChunkTime = startTime;
    let firstChunkTime: number | null = null;

    for await (const entry of iterator) {
      chunkCount++;
      const currentTime = Date.now();
      
      if (firstChunkTime === null) {
        firstChunkTime = currentTime;
        const timeToFirstChunk = currentTime - startTime;
        console.log(`[RAG STREAM] First chunk received after ${timeToFirstChunk}ms`);
      }
      
      const timeSinceLastChunk = currentTime - lastChunkTime;
      lastChunkTime = currentTime;
      
      console.log(`[RAG STREAM] Chunk #${chunkCount} (Δ${timeSinceLastChunk}ms):`, 
        JSON.stringify(entry.data).slice(0, 100));
      
      const eventName = entry.event || 'delta';
      emit(eventName, entry.data);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`[RAG STREAM] Stream completed: ${chunkCount} chunks in ${totalTime}ms`);
  })();
}

/**
 * Sanitizes headers for logging (redacts sensitive values)
 */
export function sanitizeHeadersForLog(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (['authorization', 'cookie', 'x-api-key'].includes(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = value;
    }
  });
  return result;
}

/**
 * Resolves operation ID from request headers
 */
export function resolveOperationId(req: any): string | null {
  const headerKey =
    typeof req.headers['idempotency-key'] === 'string'
      ? req.headers['idempotency-key']
      : typeof req.headers['Idempotency-Key'] === 'string'
        ? req.headers['Idempotency-Key']
        : typeof req.headers['x-operation-id'] === 'string'
          ? req.headers['x-operation-id']
          : null;
  return headerKey && headerKey.trim().length > 0 ? headerKey.trim() : null;
}

/**
 * Gets error details for logging
 */
export function getErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
