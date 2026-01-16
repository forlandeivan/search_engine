/**
 * Public Routes Module
 * 
 * Handles public API endpoints that don't require user authentication:
 * - GET /api/public/embed/suggest - Search suggestions for embedded widgets
 */

import { Router } from 'express';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { resolvePublicCollectionRequest } from '../lib/public-collection-context';

const logger = createLogger('public');

export const publicRouter = Router();

// ============================================================================
// Routes
// ============================================================================

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

export default publicRouter;
