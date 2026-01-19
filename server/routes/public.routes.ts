/**
 * Public Routes Module
 * 
 * Handles public API endpoints that don't require user authentication:
 * - GET /api/public/embed/suggest - Search suggestions for embedded widgets
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { knowledgeRagLimiter } from '../middleware/rate-limit';
import { resolvePublicCollectionRequest } from '../lib/public-collection-context';
import { runKnowledgeBaseRagPipeline } from '../lib/rag-pipeline';
import { sendSseEvent } from '../lib/chat-llm-helpers';
import { HttpError } from '../lib/errors';
import { QdrantConfigurationError } from '../qdrant';
import { tariffPlanService } from '../tariff-plan-service';

// Separate router for tariffs to avoid path conflicts
export const tariffsPublicRouter = Router();

// Validation schemas
const knowledgeSuggestQuerySchema = z.object({
  q: z.string().default(''),
  kb_id: z.string().default(''),
  limit: z.coerce.number().optional(),
});

const knowledgeRagRequestSchema = z.object({
  q: z.string().min(1, 'Запрос не может быть пустым'),
  kb_id: z.string().min(1, 'Необходимо указать базу знаний'),
  stream: z.boolean().optional(),
  limit: z.coerce.number().optional(),
  model: z.string().optional(),
  temperature: z.coerce.number().optional(),
  max_tokens: z.coerce.number().optional(),
});

const logger = createLogger('public');

export const publicRouter = Router();

// Helper function
function createQueryPreview(query: string): string {
  return query.length > 50 ? query.substring(0, 50) + '...' : query;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /search/suggest
 * Search suggestions for knowledge base (legacy public path)
 */
publicRouter.get('/search/suggest', asyncHandler(async (req, res) => {
  const parsed = knowledgeSuggestQuerySchema.safeParse({
    q: typeof req.query.q === 'string' ? req.query.q 
      : typeof req.query.query === 'string' ? req.query.query : '',
    kb_id: typeof req.query.kb_id === 'string' ? req.query.kb_id
      : typeof req.query.kbId === 'string' ? req.query.kbId : '',
    limit: req.query.limit,
  });

  if (!parsed.success) {
    return res.status(400).json({
      error: 'Некорректные параметры запроса',
      details: parsed.error.format(),
    });
  }

  const { q, kb_id, limit } = parsed.data;
  const query = q.trim();
  const knowledgeBaseId = kb_id.trim();
  const limitValue = limit !== undefined ? Math.max(1, Math.min(Number(limit), 10)) : 3;

  const requestStartedAt = performance.now();

  if (!query) {
    return res.status(400).json({ error: 'Укажите поисковый запрос' });
  }

  const base = await storage.getKnowledgeBase(knowledgeBaseId);
  if (!base) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const suggestions = await storage.searchKnowledgeBaseSuggestions(
    knowledgeBaseId,
    query,
    limitValue,
  );
  const duration = performance.now() - requestStartedAt;

  const sections = suggestions.sections.map((entry) => ({
    chunk_id: entry.chunkId,
    doc_id: entry.documentId,
    doc_title: entry.docTitle,
    section_title: entry.sectionTitle,
    snippet: entry.snippet,
    score: entry.score,
    source: entry.source,
    node_id: entry.nodeId ?? null,
    node_slug: entry.nodeSlug ?? null,
  }));

  res.json({
    query,
    kb_id: knowledgeBaseId,
    normalized_query: suggestions.normalizedQuery || query,
    ask_ai: {
      label: 'Спросить AI',
      query: suggestions.normalizedQuery || query,
    },
    sections,
    timings: {
      total_ms: Number(duration.toFixed(2)),
    },
  });
}));

/**
 * GET /tariffs
 * List available tariff plans (public endpoint)
 */
tariffsPublicRouter.get('/', asyncHandler(async (_req, res) => {
  const tariffs = await tariffPlanService.listAll();
  res.json({ tariffs });
}));

/**
 * GET /embed/suggest
 * Get search suggestions for embedded widgets
 */
publicRouter.get('/embed/suggest', asyncHandler(async (req, res) => {
  const publicContext = await resolvePublicCollectionRequest(req, res);
  if (!publicContext) {
    return;
  }

  if (!publicContext.embedKey || !publicContext.knowledgeBaseId) {
    return res.status(403).json({ error: 'Публичный ключ не поддерживает подсказки по базе знаний' });
  }

  const queryParam =
    typeof req.query.q === 'string'
      ? req.query.q
      : typeof req.query.query === 'string'
        ? req.query.query
        : '';
  const query = queryParam.trim();

  if (!query) {
    return res.status(400).json({ error: 'Укажите поисковый запрос' });
  }

  const requestedKbId =
    typeof req.query.kb_id === 'string'
      ? req.query.kb_id.trim()
      : typeof req.query.kbId === 'string'
        ? req.query.kbId.trim()
        : '';

  if (requestedKbId && requestedKbId !== publicContext.knowledgeBaseId) {
    return res.status(403).json({ error: 'Доступ к указанной базе знаний запрещён' });
  }

  const limitCandidate = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined;
  const limitValue = Number.isFinite(limitCandidate) ? Math.max(1, Math.min(10, Number(limitCandidate))) : 3;

  const knowledgeBaseId = publicContext.knowledgeBaseId;
  const base = await storage.getKnowledgeBase(knowledgeBaseId);

  if (!base) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const startedAt = performance.now();
  const suggestions = await storage.searchKnowledgeBaseSuggestions(knowledgeBaseId, query, limitValue);
  const duration = performance.now() - startedAt;

  const sections = suggestions.sections.map((entry) => ({
    chunk_id: entry.chunkId,
    doc_id: entry.documentId,
    doc_title: entry.docTitle,
    section_title: entry.sectionTitle,
    snippet: entry.snippet,
    score: entry.score,
    source: entry.source,
    node_id: entry.nodeId ?? null,
    node_slug: entry.nodeSlug ?? null,
  }));

  res.json({
    query,
    kb_id: knowledgeBaseId,
    normalized_query: suggestions.normalizedQuery || query,
    ask_ai: {
      label: 'Спросить AI',
      query: suggestions.normalizedQuery || query,
    },
    sections,
    timings: {
      total_ms: Number(duration.toFixed(2)),
    },
  });
}));

/**
 * POST /rag/answer
 * RAG (Retrieval-Augmented Generation) endpoint for knowledge base Q&A
 */
publicRouter.post('/rag/answer', knowledgeRagLimiter, asyncHandler(async (req, res) => {
  const parsed = knowledgeRagRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Некорректные параметры RAG-запроса',
      details: parsed.error.format(),
    });
  }

  const body = parsed.data;
  const acceptHeader = typeof req.headers.accept === 'string' ? req.headers.accept : '';
  const wantsStream = Boolean(
    body.stream === true || acceptHeader.toLowerCase().includes('text/event-stream'),
  );

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const flusher = (res as Response & { flushHeaders?: () => void }).flushHeaders;
    if (typeof flusher === 'function') {
      flusher.call(res);
    }

    try {
      await runKnowledgeBaseRagPipeline({
        req,
        body,
        stream: {
          onEvent: (eventName, payload) => {
            sendSseEvent(res, eventName, payload);
          },
        },
      });
      res.end();
    } catch (error) {
      if (error instanceof HttpError) {
        sendSseEvent(res, 'error', { message: error.message, details: error.details ?? null });
        res.end();
        return;
      }

      if (error instanceof QdrantConfigurationError) {
        sendSseEvent(res, 'error', { message: 'Qdrant не настроен', details: error.message });
        res.end();
        return;
      }

      console.error('Ошибка RAG-поиска по базе знаний (SSE):', error);
      sendSseEvent(res, 'error', { message: 'Не удалось получить ответ от LLM' });
      res.end();
    }

    return;
  }

  const result = await runKnowledgeBaseRagPipeline({ req, body });
  res.json({
    query: result.response.query,
    kb_id: result.response.knowledgeBaseId,
    normalized_query: result.response.normalizedQuery,
    answer: result.response.answer,
    citations: result.response.citations,
    chunks: result.response.chunks,
    usage: result.response.usage,
    timings: result.response.timings,
    debug: result.response.debug,
  });
}));

export default publicRouter;
