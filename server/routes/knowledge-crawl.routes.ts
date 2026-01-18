/**
 * Knowledge Base Crawl Routes Module
 * 
 * Handles web crawling operations for knowledge bases:
 * - POST /api/kb - Create knowledge base with crawl
 * - POST /api/kb/:baseId/crawl - Start/restart crawl for knowledge base
 * - GET /api/kb/:baseId/crawl/active - Get active crawl status
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  KnowledgeBaseError,
  type KnowledgeBaseCrawlConfig,
} from '../knowledge-base';
import { 
  crawlKnowledgeDocumentPage, 
  getKnowledgeBaseCrawlJobStateForBase,
  startKnowledgeBaseCrawl,
} from '../kb-crawler';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('knowledge-crawl');

export const knowledgeCrawlRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: Request): PublicUser | null {
  return (req as Request & { user?: PublicUser }).user ?? null;
}

function getAuthorizedUser(req: Request, res: Response): PublicUser | null {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return null;
  }
  return user;
}

function getRequestWorkspace(req: Request): { id: string; role?: string } {
  const workspaceId = req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: workspaceId, role: req.workspaceRole || req.session?.workspaceRole };
}

function isWorkspaceAdmin(role?: string): boolean {
  return role === 'admin' || role === 'owner';
}

// ============================================================================
// Validation Schemas
// ============================================================================

const crawlSelectorsSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
}).partial();

const crawlAuthSchema = z.object({
  headers: z.record(z.string()).optional(),
}).partial();

const crawlConfigSchema = z.object({
  start_urls: z.array(z.string().url()).min(1, 'Укажите хотя бы один URL для начала обхода'),
  sitemap_url: z.string().url().optional().nullable(),
  allowed_domains: z.array(z.string()).optional(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  max_pages: z.number().int().positive().optional().nullable(),
  max_depth: z.number().int().positive().optional().nullable(),
  rate_limit_rps: z.number().positive().optional().nullable(),
  rate_limit: z.number().positive().optional().nullable(),
  robots_txt: z.boolean().optional(),
  selectors: z.object({
    title: z.string().optional().nullable(),
    content: z.string().optional().nullable(),
  }).optional(),
});

const createKnowledgeBaseWithCrawlSchema = z.object({
  name: z.string().trim().min(1, 'Укажите название базы знаний').max(200, 'Название не должно превышать 200 символов'),
  description: z.string().trim().max(2000).optional(),
  source: z.literal('crawl'),
  crawl_config: crawlConfigSchema,
});

const restartKnowledgeBaseCrawlSchema = z.object({
  crawl_config: crawlConfigSchema,
});

const createCrawledKnowledgeDocumentSchema = z.object({
  url: z.string().trim().min(1, 'Укажите ссылку на страницу').refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Укажите корректный URL страницы'),
  selectors: crawlSelectorsSchema.optional(),
  language: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  auth: crawlAuthSchema.optional(),
});

function parseKnowledgeNodeParentId(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') throw new KnowledgeBaseError('Некорректный идентификатор родителя', 400);
  const trimmed = raw.trim();
  return trimmed || null;
}

function mapCrawlConfig(input: z.infer<typeof crawlConfigSchema>): KnowledgeBaseCrawlConfig {
  const normalizeArray = (value?: string[]) =>
    value?.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

  const startUrls = normalizeArray(input.start_urls) ?? [];

  const rateLimit =
    (typeof input.rate_limit_rps === 'number' && Number.isFinite(input.rate_limit_rps)
      ? input.rate_limit_rps
      : undefined) ??
    (typeof input.rate_limit === 'number' && Number.isFinite(input.rate_limit)
      ? input.rate_limit
      : undefined) ??
    null;

  return {
    startUrls,
    sitemapUrl: input.sitemap_url ?? null,
    allowedDomains: normalizeArray(input.allowed_domains) ?? undefined,
    include: normalizeArray(input.include) ?? undefined,
    exclude: normalizeArray(input.exclude) ?? undefined,
    maxPages: input.max_pages ?? null,
    maxDepth: input.max_depth ?? null,
    rateLimitRps: rateLimit,
    robotsTxt: input.robots_txt ?? true,
    selectors: input.selectors
      ? {
          title: input.selectors.title?.trim() || null,
          content: input.selectors.content?.trim() || null,
        }
      : undefined,
  };
}

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /
 * Create knowledge base with crawl configuration
 */
knowledgeCrawlRouter.post('/', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createKnowledgeBaseWithCrawlSchema.parse(req.body ?? {});
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const summary = await createKnowledgeBase(workspaceId, {
    name: payload.name,
    description: payload.description,
  });

  const config = mapCrawlConfig(payload.crawl_config);
  const job = startKnowledgeBaseCrawl(workspaceId, summary.id, config);

  res.status(201).json({
    kb_id: summary.id,
    job_id: job.jobId,
    knowledge_base: summary,
    job,
  });
}));

/**
 * POST /:baseId/crawl
 * Start or restart crawl for existing knowledge base
 */
knowledgeCrawlRouter.post('/:baseId/crawl', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const payload = restartKnowledgeBaseCrawlSchema.parse(req.body ?? {});
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const bases = await listKnowledgeBases(workspaceId);
  const summary = bases.find((base) => base.id === baseId);
  if (!summary) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const config = mapCrawlConfig(payload.crawl_config);
  const job = startKnowledgeBaseCrawl(workspaceId, baseId, config);

  res.status(201).json({
    kb_id: baseId,
    job_id: job.jobId,
    job,
  });
}));

/**
 * GET /:baseId/crawl/active
 * Get active crawl status for knowledge base
 */
knowledgeCrawlRouter.get('/:baseId/crawl/active', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId, role: workspaceRole } = getRequestWorkspace(req);
  
  if (!isWorkspaceAdmin(workspaceRole)) {
    return res.status(403).json({ error: 'Недостаточно прав' });
  }

  const { active, latest } = getKnowledgeBaseCrawlJobStateForBase(baseId, workspaceId);
  
  if (!active) {
    const lastRun = latest ? { job: latest } : undefined;
    return res.json(lastRun ? { running: false, lastRun } : { running: false });
  }

  const normalizeNumber = (value?: number | null): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

  const progress: {
    percent: number;
    discovered: number;
    fetched: number;
    saved: number;
    errors: number;
    queued?: number;
    extracted?: number;
  } = {
    percent: normalizeNumber(active.percent),
    discovered: normalizeNumber(active.discovered),
    fetched: normalizeNumber(active.fetched),
    saved: normalizeNumber(active.saved),
    errors: normalizeNumber(active.failed),
  };

  if (typeof active.queued === 'number') {
    progress.queued = normalizeNumber(active.queued);
  }

  if (typeof active.extracted === 'number') {
    progress.extracted = normalizeNumber(active.extracted);
  }

  res.json({
    running: true,
    runId: active.jobId,
    progress,
    job: active,
  });
}));

/**
 * POST /:baseId/documents/crawl
 * Crawl a single document page and add to knowledge base
 * Note: This is mounted at /api/knowledge/bases via index.ts
 */
knowledgeCrawlRouter.post('/:baseId/documents/crawl', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const payload = createCrawledKnowledgeDocumentSchema.parse(req.body ?? {});
  const parentId = parseKnowledgeNodeParentId(req.body?.parentId);
  const { id: workspaceId } = getRequestWorkspace(req);

  const selectors = payload.selectors
    ? {
        title: payload.selectors.title?.trim() || null,
        content: payload.selectors.content?.trim() || null,
      }
    : null;
  
  const authHeaders = payload.auth?.headers
    ? Object.fromEntries(
        Object.entries(payload.auth.headers)
          .map(([key, value]) => [key.trim(), value.trim()])
          .filter(([key, value]) => key.length > 0 && value.length > 0),
      )
    : undefined;

  const result = await crawlKnowledgeDocumentPage(workspaceId, baseId, {
    url: payload.url,
    parentId,
    selectors,
    language: payload.language?.trim() || null,
    version: payload.version?.trim() || null,
    auth: authHeaders ? { headers: authHeaders } : null,
  });

  res.status(201).json(result);
}));

// Error handler for this router
knowledgeCrawlRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    const issue = err.issues.at(0);
    const message = issue?.message ?? 'Некорректные данные';
    return res.status(400).json({ error: message });
  }
  if (err instanceof KnowledgeBaseError) {
    return res.status(err.status).json({ error: err.message });
  }
  next(err);
});

export default knowledgeCrawlRouter;
