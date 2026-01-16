/**
 * Generative Search Module
 * 
 * Functions for generative search with LLM completion and streaming.
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { createLogger } from './logger';
import { getRequestWorkspace, WorkspaceContextError } from '../auth';
import { resolvePublicCollectionRequest, normalizeResponseFormat } from './public-collection-context';
import { fetchAccessToken } from '../llm-access-token';
import { fetchLlmCompletion } from '../llm-client';
import { mergeLlmRequestConfig, buildLlmRequestBody, type LlmContextRecord } from '../search/utils';
import { sanitizeLlmModelOptions } from '../llm-utils';
import { applyTlsPreferences, parseJson, type NodeFetchOptions } from '../http-utils';
import type { LlmProvider, EmbeddingProvider, Site, LlmModelOption } from '@shared/schema';
import type { RagResponseFormat } from './public-collection-context';

const logger = createLogger('generative-search');

// ============================================================================
// Types
// ============================================================================

export type EmbeddingVectorResult = {
  vector: number[];
  usageTokens?: number;
};

export type GenerativeContextEntry = {
  id: string | number | null;
  payload: unknown;
  score: number | null;
  shard_key?: unknown;
  order_value?: unknown;
};

export type GigachatStreamOptions = {
  req: Request;
  res: Response;
  provider: LlmProvider;
  accessToken: string;
  query: string;
  context: LlmContextRecord[];
  sanitizedResults: GenerativeContextEntry[];
  embeddingResult: EmbeddingVectorResult;
  embeddingProvider: EmbeddingProvider;
  selectedModelValue?: string | null;
  selectedModelMeta: LlmModelOption | null;
  limit: number;
  contextLimit: number;
  responseFormat?: RagResponseFormat;
  includeContextInResponse: boolean;
  includeQueryVectorInResponse: boolean;
  collectionName: string;
};

export type GenerativeWorkspaceContext = {
  workspaceId: string;
  site?: Site | null;
  isPublic: boolean;
};

// ============================================================================
// Helper Functions
// ============================================================================

function sendSseEvent(res: Response, eventName: string, data?: unknown) {
  const body = typeof data === 'string' || data === undefined ? data ?? '' : JSON.stringify(data);
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${body}\n\n`);
}

function extractTextDeltaFromChunk(chunk: unknown): string | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const c = chunk as Record<string, unknown>;
  
  const choices = c.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  
  const choice = choices[0] as Record<string, unknown>;
  const delta = choice.delta as Record<string, unknown> | undefined;
  
  if (delta && typeof delta.content === 'string') {
    return delta.content;
  }
  
  return null;
}

function extractUsageTokensFromChunk(chunk: unknown): number | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const c = chunk as Record<string, unknown>;
  
  const usage = c.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage.total_tokens === 'number') {
    return usage.total_tokens;
  }
  
  return null;
}

// ============================================================================
// Resolve Generative Workspace
// ============================================================================

export async function resolveGenerativeWorkspace(
  req: Request,
  res: Response,
): Promise<GenerativeWorkspaceContext | null> {
  const bodySource: Record<string, unknown> =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body) 
      ? { ...(req.body as Record<string, unknown>) } 
      : {};

  const headerKey = req.headers['x-api-key'];
  const apiKey = pickFirstString(
    Array.isArray(headerKey) ? headerKey[0] : headerKey,
    bodySource.apiKey,
    req.query.apiKey,
    req.query.apikey,
  );

  if (!apiKey) {
    try {
      const { id: workspaceId } = getRequestWorkspace(req);
      return { workspaceId, site: null, isPublic: false };
    } catch (err) {
      if (err instanceof WorkspaceContextError) {
        res.status(401).json({ error: 'Требуется авторизация' });
        return null;
      }
      throw err;
    }
  }

  const publicContext = await resolvePublicCollectionRequest(req, res);
  if (!publicContext) {
    return null;
  }

  return { workspaceId: publicContext.workspaceId, site: publicContext.site ?? null, isPublic: true };
}

function pickFirstString(...candidates: Array<unknown>): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
}

// ============================================================================
// Stream Gigachat Completion
// ============================================================================

export async function streamGigachatCompletion(options: GigachatStreamOptions): Promise<void> {
  const {
    req,
    res,
    provider,
    accessToken,
    query,
    context,
    sanitizedResults,
    embeddingResult,
    embeddingProvider,
    selectedModelValue,
    selectedModelMeta,
    limit,
    contextLimit,
    responseFormat,
    includeContextInResponse,
    includeQueryVectorInResponse,
    collectionName,
  } = options;

  const streamHeaders = new Headers();
  streamHeaders.set('Content-Type', 'application/json');
  streamHeaders.set('Accept', 'text/event-stream');

  if (!streamHeaders.has('RqUID')) {
    streamHeaders.set('RqUID', randomUUID());
  }

  for (const [key, value] of Object.entries(provider.requestHeaders ?? {})) {
    streamHeaders.set(key, value);
  }

  if (!streamHeaders.has('Authorization')) {
    streamHeaders.set('Authorization', `Bearer ${accessToken}`);
  }

  const requestBody = buildLlmRequestBody(provider, query, context, selectedModelValue ?? undefined, {
    stream: true,
    responseFormat,
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const flushHeaders = (res as Response & { flushHeaders?: () => void }).flushHeaders;
  if (typeof flushHeaders === 'function') {
    flushHeaders.call(res);
  }

  const abortController = new AbortController();
  req.on('close', () => {
    abortController.abort();
  });

  const metadataPayload: Record<string, unknown> = {
    usage: { embeddingTokens: embeddingResult.usageTokens ?? null },
    provider: {
      id: provider.id,
      name: provider.name,
      model: selectedModelValue ?? provider.model,
      modelLabel: selectedModelMeta?.label ?? selectedModelValue ?? provider.model,
    },
    embeddingProvider: {
      id: embeddingProvider.id,
      name: embeddingProvider.name,
    },
    limit,
    contextLimit,
    format: responseFormat ?? 'text',
    collection: collectionName,
  };

  if (includeContextInResponse) {
    metadataPayload.context = sanitizedResults;
  }

  if (includeQueryVectorInResponse) {
    metadataPayload.queryVector = embeddingResult.vector;
    metadataPayload.vectorLength = embeddingResult.vector.length;
  }

  sendSseEvent(res, 'status', { stage: 'thinking', message: 'Думаю…' });
  sendSseEvent(res, 'status', { stage: 'retrieving', message: 'Ищу источники…' });

  const streamedContextEntries = sanitizedResults.map((entry) => ({
    id: entry.id ?? null,
    score: typeof entry.score === 'number' ? entry.score : null,
    payload: entry.payload ?? null,
    shard_key: entry.shard_key ?? null,
    order_value: entry.order_value ?? null,
  }));

  streamedContextEntries.slice(0, contextLimit).forEach((contextEntry, index) => {
    sendSseEvent(res, 'source', { index: index + 1, context: contextEntry });
  });

  let completionResponse: globalThis.Response;

  try {
    const requestOptions = applyTlsPreferences<NodeFetchOptions>(
      {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      },
      provider.allowSelfSignedCertificate,
    );

    completionResponse = await fetch(provider.completionUrl, requestOptions as RequestInit);
  } catch (err) {
    if (abortController.signal.aborted) {
      return;
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    sendSseEvent(res, 'error', {
      message: `Не удалось выполнить запрос к LLM: ${errorMessage}`,
    });
    res.end();
    return;
  }

  if (!completionResponse.ok) {
    const rawBody = await completionResponse.text();
    let message = `LLM вернул статус ${completionResponse.status}`;

    const parsedBody = parseJson(rawBody);
    if (parsedBody && typeof parsedBody === 'object') {
      const body = parsedBody as Record<string, unknown>;
      if (typeof body.error_description === 'string') {
        message = body.error_description;
      } else if (typeof body.message === 'string') {
        message = body.message;
      }
    } else if (typeof parsedBody === 'string' && parsedBody.trim()) {
      message = parsedBody.trim();
    }

    sendSseEvent(res, 'error', { message: `Ошибка на этапе генерации ответа: ${message}` });
    res.end();
    return;
  }

  if (!completionResponse.body) {
    sendSseEvent(res, 'error', {
      message: 'LLM не вернул поток данных',
    });
    res.end();
    return;
  }

  sendSseEvent(res, 'status', { stage: 'answering', message: 'Формулирую ответ…' });

  const decoder = new TextDecoder();
  let buffer = '';
  let aggregatedAnswer = '';
  let llmUsageTokens: number | null = null;

  try {
    for await (const chunk of completionResponse.body as unknown as AsyncIterable<Uint8Array>) {
      if (abortController.signal.aborted) {
        return;
      }

      buffer += decoder.decode(chunk, { stream: true });

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex >= 0) {
        const rawEvent = buffer.slice(0, boundaryIndex).replace(/\r/g, '');
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf('\n\n');

        if (!rawEvent.trim()) {
          continue;
        }

        const lines = rawEvent.split('\n');
        let eventName = 'message';
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }

        const dataPayload = dataLines.join('\n');
        if (!dataPayload) {
          continue;
        }

        if (dataPayload === '[DONE]') {
          sendSseEvent(res, 'status', { stage: 'done', message: 'Готово' });
          sendSseEvent(res, 'done', {
            answer: aggregatedAnswer,
            usage: {
              embeddingTokens: embeddingResult.usageTokens ?? null,
              llmTokens: llmUsageTokens,
            },
            sourcesCount: streamedContextEntries.slice(0, contextLimit).length,
            metadata: metadataPayload,
            provider: metadataPayload.provider ?? null,
            embeddingProvider: metadataPayload.embeddingProvider ?? null,
            collection: collectionName,
            format: responseFormat ?? 'text',
          });
          res.end();
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(dataPayload);
        } catch {
          continue;
        }

        const delta = extractTextDeltaFromChunk(parsed);
        if (delta) {
          aggregatedAnswer += delta;
          const normalizedEventName = eventName === 'message' ? 'delta' : eventName;
          sendSseEvent(res, normalizedEventName === 'delta' ? 'delta' : normalizedEventName, { text: delta });
        }

        const maybeUsage = extractUsageTokensFromChunk(parsed);
        if (typeof maybeUsage === 'number') {
          llmUsageTokens = maybeUsage;
        }
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      return;
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    sendSseEvent(res, 'error', {
      message: `Ошибка при чтении потока LLM: ${errorMessage}`,
    });
    res.end();
    return;
  }

  sendSseEvent(res, 'status', { stage: 'done', message: 'Готово' });
  sendSseEvent(res, 'done', {
    answer: aggregatedAnswer,
    usage: {
      embeddingTokens: embeddingResult.usageTokens ?? null,
      llmTokens: llmUsageTokens,
    },
    sourcesCount: streamedContextEntries.slice(0, contextLimit).length,
    metadata: metadataPayload,
    provider: metadataPayload.provider ?? null,
    embeddingProvider: metadataPayload.embeddingProvider ?? null,
    collection: collectionName,
    format: responseFormat ?? 'text',
  });
  res.end();
}

// Re-export utilities needed by the endpoint
export { normalizeResponseFormat, mergeLlmRequestConfig, sanitizeLlmModelOptions, fetchAccessToken, fetchLlmCompletion };
export type { LlmContextRecord, LlmModelOption, RagResponseFormat };
