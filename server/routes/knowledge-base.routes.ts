/**
 * Knowledge Base Routes Module
 * 
 * Handles knowledge base operations:
 * - GET /api/knowledge/bases - List knowledge bases
 * - POST /api/knowledge/bases - Create knowledge base
 * - DELETE /api/knowledge/bases/:baseId - Delete knowledge base
 * - GET /api/knowledge/bases/:baseId/nodes/:nodeId - Get node detail
 * - POST /api/knowledge/bases/:baseId/folders - Create folder
 * - POST /api/knowledge/bases/:baseId/documents - Create document
 * - PATCH /api/knowledge/bases/:baseId/nodes/:nodeId - Update node
 * - DELETE /api/knowledge/bases/:baseId/nodes/:nodeId - Delete node
 * - GET /api/knowledge/bases/:baseId/indexing/summary - Get indexing summary
 * - POST /api/knowledge/bases/:baseId/index - Start indexing
 */

import { Router, type Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { storage } from '../storage';
import { db } from '../db';
import { knowledgeDocuments } from '@shared/schema';
import { and, eq } from 'drizzle-orm';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeNodeDetail,
  createKnowledgeFolder,
  createKnowledgeDocument,
  bulkCreateDocuments,
  updateKnowledgeNodeParent,
  updateKnowledgeDocument,
  deleteKnowledgeNode,
  getKnowledgeBaseIndexingSummary,
  startKnowledgeBaseIndexing,
  KnowledgeBaseError,
} from '../knowledge-base';
import { knowledgeBaseIndexingPolicyService } from '../knowledge-base-indexing-policy';
import { crawlKnowledgeDocumentPage } from '../kb-crawler';
import {
  previewKnowledgeDocumentChunks,
  createKnowledgeDocumentChunkSet,
} from '../knowledge-chunks';
import type { PublicUser } from '@shared/schema';
import type {
  CreateJsonImportRequest,
  CreateJsonImportResponse,
  GetJsonImportStatusResponse,
} from '@shared/json-import';
import { isMappingConfigV2, migrateMappingConfigV1ToV2 } from '@shared/json-import';
import {
  initJsonImportMultipartUpload,
  uploadJsonImportPart,
  completeJsonImportMultipartUpload,
  abortJsonImportMultipartUpload,
} from '../workspace-storage-service';
import { analyzeJsonStructure } from '../json-import/structure-analyzer';

const logger = createLogger('knowledge-base');

export const knowledgeBaseRouter = Router();

// Multer для загрузки частей файла
const uploadPart = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per part
  },
});

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

function getRequestWorkspace(req: Request): { id: string } {
  // Check header first (most common from frontend)
  const headerWorkspaceRaw = req.headers["x-workspace-id"];
  const headerWorkspaceId = Array.isArray(headerWorkspaceRaw)
    ? headerWorkspaceRaw[0]
    : typeof headerWorkspaceRaw === "string"
      ? headerWorkspaceRaw.trim()
      : undefined;

  const workspaceId = req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    headerWorkspaceId ||
    req.params.workspaceId ||
    req.query.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: String(workspaceId) };
}

// ============================================================================
// Validation Schemas
// ============================================================================

const createKnowledgeBaseSchema = z.object({
  id: z.string().trim().min(1).max(191).optional(),
  name: z.string().trim().min(1, "Укажите название базы знаний").max(200),
  description: z.string().trim().max(2000).optional(),
});

const deleteKnowledgeBaseSchema = z.object({
  confirmation: z.string().trim().min(1, "Введите название базы знаний для подтверждения удаления"),
});

const createFolderSchema = z.object({
  name: z.string().trim().min(1).max(255),
  parentId: z.string().trim().min(1).optional(),
});

const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(255),
  content: z.string().optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
});

const bulkCreateDocumentsSchema = z.object({
  documents: z.array(z.object({
    title: z.string().trim().min(1).max(500),
    content: z.string().max(20_000_000),
    parentId: z.string().uuid().nullable().optional(),
    sourceType: z.enum(['manual', 'import']).optional().default('import'),
    importFileName: z.string().nullable().optional(),
  })).min(1).max(1000),
});

const updateNodeSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  content: z.string().optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(255).optional(),
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
  selectors: z.object({
    title: z.string().trim().min(1).optional(),
    content: z.string().trim().min(1).optional(),
  }).partial().optional(),
  language: z.string().trim().min(1).optional(),
  version: z.string().trim().min(1).optional(),
  auth: z.object({
    headers: z.record(z.string()).optional(),
  }).partial().optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
});

const knowledgeDocumentChunkConfigSchema = z
  .object({
    maxTokens: z.number().int().min(50).max(4_000).optional(),
    maxChars: z.number().int().min(200).max(20_000).optional(),
    overlapTokens: z.number().int().min(0).max(4_000).optional(),
    overlapChars: z.number().int().min(0).max(20_000).optional(),
    splitByPages: z.boolean().optional(),
    respectHeadings: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.maxTokens && !value.maxChars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxTokens"],
        message: "Укажите ограничение по токенам или символам",
      });
    }

    if (value.overlapTokens && value.maxTokens && value.overlapTokens >= value.maxTokens) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overlapTokens"],
        message: "Перехлёст по токенам должен быть меньше лимита",
      });
    }

    if (value.overlapChars && value.maxChars && value.overlapChars >= value.maxChars) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overlapChars"],
        message: "Перехлёст по символам должен быть меньше лимита",
      });
    }
  });

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /bases
 * List knowledge bases for workspace
 */
knowledgeBaseRouter.get('/bases', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const bases = await listKnowledgeBases(workspaceId);
  // Возвращаем просто массив, как ожидает фронтенд
  res.json(bases);
}));

/**
 * POST /bases
 * Create knowledge base
 */
knowledgeBaseRouter.post('/bases', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createKnowledgeBaseSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const base = await createKnowledgeBase(workspaceId, {
    id: payload.id,
    name: payload.name,
    description: payload.description,
  });
  
  res.status(201).json(base);
}));

/**
 * DELETE /bases/:baseId
 * Delete knowledge base
 */
knowledgeBaseRouter.delete('/bases/:baseId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const baseId = req.params.baseId;
  
  let payload;
  try {
    payload = deleteKnowledgeBaseSchema.parse(req.body ?? {});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ 
        message: error.errors[0]?.message ?? "Неверные данные запроса",
      });
    }
    throw error;
  }
  
  await deleteKnowledgeBase(workspaceId, baseId, payload);
  res.status(204).send();
}));

/**
 * GET /bases/:baseId/nodes/:nodeId
 * Get node detail
 */
knowledgeBaseRouter.get('/bases/:baseId/nodes/:nodeId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const baseId = req.params.baseId;
  
  // Проверяем существует ли база и к какому workspace она принадлежит
  const baseCheck = await storage.getKnowledgeBase(baseId);
  logger.info({ 
    baseId, 
    workspaceId,
    baseExists: !!baseCheck,
    baseWorkspaceId: baseCheck?.workspaceId,
    matches: baseCheck?.workspaceId === workspaceId
  }, 'Getting node detail - base check');
  
  const node = await getKnowledgeNodeDetail(baseId, req.params.nodeId, workspaceId);
  
  if (!node) {
    return res.status(404).json({ message: 'Узел не найден' });
  }
  
  res.json({ node });
}));

/**
 * POST /bases/:baseId/folders
 * Create folder
 */
knowledgeBaseRouter.post('/bases/:baseId/folders', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createFolderSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const folder = await createKnowledgeFolder(workspaceId, req.params.baseId, {
    name: payload.name,
    parentId: payload.parentId,
  });
  
  res.status(201).json({ folder });
}));

/**
 * POST /bases/:baseId/documents
 * Create document
 */
knowledgeBaseRouter.post('/bases/:baseId/documents', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = createDocumentSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const document = await createKnowledgeDocument(req.params.baseId, workspaceId, {
    title: payload.title,
    content: payload.content,
    parentId: payload.parentId,
  });
  
  res.status(201).json({ document });
}));

/**
 * POST /bases/:baseId/documents/bulk
 * Bulk create documents in existing knowledge base
 */
knowledgeBaseRouter.post('/bases/:baseId/documents/bulk', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const payload = bulkCreateDocumentsSchema.parse(req.body);
  const { id: workspaceId } = getRequestWorkspace(req);
  const { baseId } = req.params;

  const result = await bulkCreateDocuments(workspaceId, baseId, payload.documents);

  res.status(201).json({
    success: true,
    created: result.created,
    failed: result.failed,
    errors: result.errors,
  });
}));

/**
 * POST /bases/:baseId/documents/crawl
 * Crawl a single document page and add to knowledge base
 */
knowledgeBaseRouter.post('/bases/:baseId/documents/crawl', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const payload = createCrawledKnowledgeDocumentSchema.parse(req.body);
  const parentId = payload.parentId ?? null;
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

/**
 * POST /bases/:baseId/documents/:nodeId/chunks/preview
 * Preview document chunks with given config
 */
knowledgeBaseRouter.post('/bases/:baseId/documents/:nodeId/chunks/preview', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId, nodeId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const config = knowledgeDocumentChunkConfigSchema.parse(req.body?.config ?? {});
  
  const preview = await previewKnowledgeDocumentChunks(baseId, nodeId, workspaceId, config);
  
  res.json(preview);
}));

/**
 * POST /bases/:baseId/documents/:nodeId/chunks
 * Create document chunks with given config
 */
knowledgeBaseRouter.post('/bases/:baseId/documents/:nodeId/chunks', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId, nodeId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const config = knowledgeDocumentChunkConfigSchema.parse(req.body?.config ?? {});
  
  const chunkSet = await createKnowledgeDocumentChunkSet(baseId, nodeId, workspaceId, config);
  
  res.json(chunkSet);
}));

/**
 * PATCH /bases/:baseId/nodes/:nodeId
 * Update node
 */
knowledgeBaseRouter.patch('/bases/:baseId/nodes/:nodeId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId, nodeId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  // Check base exists and belongs to workspace
  const baseCheck = await storage.getKnowledgeBase(baseId);
  logger.info({ 
    baseId, 
    nodeId,
    workspaceId,
    baseExists: !!baseCheck,
    baseWorkspaceId: baseCheck?.workspaceId,
    matches: baseCheck?.workspaceId === workspaceId
  }, 'Updating node - base check');
  
  if (!baseCheck || baseCheck.workspaceId !== workspaceId) {
    return res.status(404).json({ message: 'База знаний не найдена' });
  }

  const parsed = updateNodeSchema.parse(req.body ?? {});

  const hasParentChange = parsed.parentId !== undefined;
  const hasDocumentUpdate =
    typeof parsed.title === "string" ||
    typeof parsed.name === "string" ||
    typeof parsed.content === "string";

  if (hasParentChange) {
    await updateKnowledgeNodeParent(
      baseId,
      nodeId,
      { parentId: parsed.parentId ?? null },
      workspaceId,
    );
  }

  if (!hasDocumentUpdate) {
    const node = await getKnowledgeNodeDetail(baseId, nodeId, workspaceId);
    return res.json({ node });
  }

  const payload: { title: string; content?: string } = {
    title: parsed.title ?? parsed.name ?? "",
    content: parsed.content,
  };

  if (!payload.title) {
    return res.status(400).json({ message: 'Укажите название документа' });
  }

  const node = await updateKnowledgeDocument(
    baseId,
    nodeId,
    workspaceId,
    payload,
    user.id,
  );

  res.json({ node });
}));

/**
 * PATCH /bases/:baseId/documents/:nodeId
 * Update document (alias for /nodes/:nodeId)
 */
knowledgeBaseRouter.patch('/bases/:baseId/documents/:nodeId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId, nodeId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  // Check base exists and belongs to workspace
  const baseCheck = await storage.getKnowledgeBase(baseId);
  logger.info({ 
    baseId, 
    nodeId,
    workspaceId,
    baseExists: !!baseCheck,
    baseWorkspaceId: baseCheck?.workspaceId,
    matches: baseCheck?.workspaceId === workspaceId
  }, 'Updating document - base check');
  
  if (!baseCheck || baseCheck.workspaceId !== workspaceId) {
    return res.status(404).json({ message: 'База знаний не найдена' });
  }

  const parsed = updateNodeSchema.parse(req.body);
  
  // Map updateNodeSchema to UpdateKnowledgeDocumentPayload
  const payload: { title: string; content?: string } = {
    title: parsed.title ?? parsed.name ?? '',
    content: parsed.content,
  };
  
  if (!payload.title) {
    return res.status(400).json({ message: 'Укажите название документа' });
  }
  
  const node = await updateKnowledgeDocument(
    baseId,
    nodeId,
    workspaceId,
    payload,
    user.id
  );
  
  res.json(node);
}));

/**
 * DELETE /bases/:baseId/nodes/:nodeId
 * Delete node
 */
knowledgeBaseRouter.delete('/bases/:baseId/nodes/:nodeId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId, nodeId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  // Check base exists and belongs to workspace
  const baseCheck = await storage.getKnowledgeBase(baseId);
  logger.info({ 
    baseId, 
    nodeId,
    workspaceId,
    baseExists: !!baseCheck,
    baseWorkspaceId: baseCheck?.workspaceId,
    matches: baseCheck?.workspaceId === workspaceId
  }, 'Deleting node - base check');
  
  if (!baseCheck || baseCheck.workspaceId !== workspaceId) {
    return res.status(404).json({ message: 'База знаний не найдена' });
  }
  
  const result = await deleteKnowledgeNode(baseId, nodeId, workspaceId);
  res.status(200).json(result);
}));

/**
 * GET /bases/:baseId/indexing/summary
 * Get indexing summary
 */
knowledgeBaseRouter.get('/bases/:baseId/indexing/summary', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  try {
    const { id: workspaceId } = getRequestWorkspace(req);
    const baseId = req.params.baseId;
    
    // Проверяем существует ли база и к какому workspace она принадлежит
    const baseCheck = await storage.getKnowledgeBase(baseId);
    logger.info({ 
      baseId, 
      workspaceId,
      baseExists: !!baseCheck,
      baseWorkspaceId: baseCheck?.workspaceId,
      matches: baseCheck?.workspaceId === workspaceId
    }, 'Getting indexing summary - base check');
    
    const summary = await getKnowledgeBaseIndexingSummary(baseId, workspaceId);
    res.json(summary);
  } catch (error) {
    const baseCheck = await storage.getKnowledgeBase(req.params.baseId).catch(() => null);
    logger.error({ 
      error: error instanceof Error ? error.message : String(error),
      baseId: req.params.baseId, 
      workspaceId: req.headers["x-workspace-id"],
      baseExists: !!baseCheck,
      baseWorkspaceId: baseCheck?.workspaceId,
    }, 'Error getting indexing summary');
    throw error;
  }
}));

/**
 * POST /bases/:baseId/index
 * Start indexing
 */
knowledgeBaseRouter.post('/bases/:baseId/index', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  
  // Поддержка старого формата (mode в query) и нового (mode в body)
  const mode = (req.body.mode ?? req.query.mode === "changed" ? "changed" : "full") as "full" | "changed";
  const config = req.body.config;
  
  const result = await startKnowledgeBaseIndexing(
    req.params.baseId,
    workspaceId,
    mode,
    user.id,
    config,
  );
  res.json(result);
}));

/**
 * GET /bases/:baseId/indexing-policy
 * Get indexing policy for knowledge base
 */
knowledgeBaseRouter.get('/bases/:baseId/indexing-policy', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);

  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  // Получаем глобальную политику (пока политика глобальная)
  const policy = await knowledgeBaseIndexingPolicyService.get();
  
  if (!policy) {
    return res.json({
      policy: null,
      hasCustomPolicy: false,
    });
  }

  res.json({
    policy: {
      embeddingsProvider: policy.embeddingsProvider,
      embeddingsModel: policy.embeddingsModel,
      chunkSize: policy.chunkSize,
      chunkOverlap: policy.chunkOverlap,
      defaultSchema: Array.isArray(policy.defaultSchema) ? policy.defaultSchema : [],
      policyHash: policy.policyHash ?? null,
      updatedAt: policy.updatedAt?.toISOString() ?? new Date().toISOString(),
    },
    hasCustomPolicy: true, // Пока всегда true, если политика существует
  });
}));

/**
 * GET /bases/:baseId/metadata-keys
 * Get unique metadata keys from documents in knowledge base
 */
knowledgeBaseRouter.get('/bases/:baseId/metadata-keys', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);

  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  // Получаем все документы базы знаний с метаданными
  const documents = await db
    .select({
      metadata: knowledgeDocuments.metadata,
    })
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.baseId, baseId),
        eq(knowledgeDocuments.workspaceId, workspaceId),
      ),
    )
    .limit(1000); // Ограничиваем для производительности

  // Собираем уникальные ключи из метаданных
  const metadataKeys = new Set<string>();
  
  for (const doc of documents) {
    if (doc.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)) {
      const metadata = doc.metadata as Record<string, unknown>;
      for (const key of Object.keys(metadata)) {
        metadataKeys.add(key);
      }
    }
  }

  res.json(Array.from(metadataKeys).sort());
}));

/**
 * GET /bases/:baseId/rag/config/latest
 * Get latest RAG configuration for knowledge base
 */
knowledgeBaseRouter.get('/bases/:baseId/rag/config/latest', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const config = await storage.getLatestKnowledgeBaseRagConfig(workspaceId, baseId);
  res.json({
    config: config ?? {
      workspaceId,
      knowledgeBaseId: baseId,
      topK: null,
      bm25: null,
      vector: null,
      recordedAt: null,
    },
  });
}));

/**
 * GET /bases/:baseId/ask-ai/runs
 * List Ask AI runs for knowledge base
 */
knowledgeBaseRouter.get('/bases/:baseId/ask-ai/runs', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const offsetParam = typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined;

  const result = await storage.listKnowledgeBaseAskAiRuns(workspaceId, baseId, {
    limit: Number.isFinite(limitParam) ? Number(limitParam) : undefined,
    offset: Number.isFinite(offsetParam) ? Number(offsetParam) : undefined,
  });

  res.json({
    items: result.items,
    hasMore: result.hasMore,
    nextOffset: result.nextOffset,
  });
}));

/**
 * GET /bases/:baseId/ask-ai/runs/:runId
 * Get Ask AI run detail
 */
knowledgeBaseRouter.get('/bases/:baseId/ask-ai/runs/:runId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId, runId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  
  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const run = await storage.getKnowledgeBaseAskAiRun(runId, workspaceId, baseId);
  if (!run) {
    return res.status(404).json({ error: 'Запуск не найден' });
  }

  res.json(run);
}));

/**
 * POST /json-import/upload/init
 * Initialize multipart upload for JSON/JSONL file
 */
const initUploadSchema = z.object({
  fileName: z.string().min(1, "Укажите имя файла"),
  fileSize: z.number().int().positive("Размер файла должен быть положительным"),
  contentType: z.string().default("application/json"),
});

knowledgeBaseRouter.post('/json-import/upload/init', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const payload = initUploadSchema.parse(req.body);

  try {
    const result = await initJsonImportMultipartUpload(
      workspaceId,
      payload.fileName,
      payload.fileSize,
      payload.contentType,
    );

    // Не возвращаем presigned URLs - клиент будет загружать через бэкенд
    res.json({
      uploadId: result.uploadId,
      fileKey: result.fileKey,
      partSize: result.partSize,
      totalParts: result.totalParts,
    });
  } catch (error) {
    logger.error('Failed to init multipart upload', { error, workspaceId, fileName: payload.fileName });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Не удалось инициализировать загрузку файла' 
    });
  }
}));

/**
 * POST /json-import/upload/part
 * Upload a single part of multipart upload
 */
knowledgeBaseRouter.post('/json-import/upload/part', uploadPart.single('part'), asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const uploadId = req.body.uploadId as string;
  const fileKey = req.body.fileKey as string;
  const partNumber = Number(req.body.partNumber);

  if (!uploadId || !fileKey || !partNumber || partNumber < 1) {
    return res.status(400).json({ error: 'Необходимы uploadId, fileKey и partNumber' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Необходима часть файла в теле запроса' });
  }

  try {
    const etag = await uploadJsonImportPart(
      workspaceId,
      fileKey,
      uploadId,
      partNumber,
      req.file.buffer,
    );

    res.json({
      partNumber,
      etag,
    });
  } catch (error) {
    logger.error('Failed to upload part', { error, workspaceId, uploadId, partNumber });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Не удалось загрузить часть файла' 
    });
  }
}));

/**
 * POST /json-import/upload/complete
 * Complete multipart upload
 */
const completeUploadSchema = z.object({
  uploadId: z.string().min(1, "Укажите uploadId"),
  fileKey: z.string().min(1, "Укажите fileKey"),
  parts: z.array(z.object({
    partNumber: z.number().int().positive(),
    etag: z.string().min(1),
  })).min(1, "Укажите хотя бы одну часть"),
});

knowledgeBaseRouter.post('/json-import/upload/complete', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const payload = completeUploadSchema.parse(req.body);

  try {
    const result = await completeJsonImportMultipartUpload(
      workspaceId,
      payload.fileKey,
      payload.uploadId,
      payload.parts,
    );

    res.json({
      fileKey: result.fileKey,
      fileSize: result.fileSize,
    });
  } catch (error) {
    logger.error('Failed to complete multipart upload', { error, workspaceId, uploadId: payload.uploadId });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Не удалось завершить загрузку файла' 
    });
  }
}));

/**
 * POST /json-import/upload/abort
 * Abort multipart upload
 */
const abortUploadSchema = z.object({
  uploadId: z.string().min(1, "Укажите uploadId"),
  fileKey: z.string().min(1, "Укажите fileKey"),
});

knowledgeBaseRouter.post('/json-import/upload/abort', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const payload = abortUploadSchema.parse(req.body);

  try {
    await abortJsonImportMultipartUpload(
      workspaceId,
      payload.fileKey,
      payload.uploadId,
    );

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to abort multipart upload', { error, workspaceId, uploadId: payload.uploadId });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Не удалось отменить загрузку файла' 
    });
  }
}));

/**
 * POST /bases/:baseId/json-import
 * Create JSON/JSONL import job
 */
// Схема для v1 (старый формат)
const mappingConfigV1Schema = z.object({
  fields: z.array(z.object({
    sourcePath: z.string(),
    role: z.enum(["id", "title", "content", "content_html", "content_md", "metadata", "skip"]),
    priority: z.number().optional(),
  })),
  contentJoinSeparator: z.string().optional(),
  titleFallback: z.enum(["first_line", "content_excerpt", "filename"]).optional(),
  deduplication: z.object({
    mode: z.enum(["skip", "allow_all"]),
  }).optional(),
});

// Схема для v2 (новый формат)
const mappingConfigV2Schema = z.object({
  version: z.literal(2),
  id: z.object({
    expression: z.array(z.any()),
  }).optional(),
  title: z.object({
    expression: z.array(z.any()),
  }),
  content: z.object({
    expression: z.array(z.any()),
    required: z.boolean().optional(),
  }),
  contentHtml: z.object({
    expression: z.array(z.any()),
  }).optional(),
  contentMd: z.object({
    expression: z.array(z.any()),
  }).optional(),
  metadata: z.array(z.object({
    key: z.string(),
    expression: z.array(z.any()),
  })),
  contentJoinSeparator: z.string().optional(),
  titleFallback: z.enum(["first_line", "content_excerpt", "filename"]).optional(),
});

// Union schema для обоих форматов
const mappingConfigSchema = z.union([mappingConfigV1Schema, mappingConfigV2Schema]);

const createJsonImportSchema = z.object({
  fileKey: z.string().min(1, "Укажите ключ файла"),
  fileName: z.string().min(1, "Укажите имя файла"),
  fileSize: z.number().int().positive("Размер файла должен быть положительным"),
  mappingConfig: mappingConfigSchema,
  hierarchyConfig: z.object({
    mode: z.enum(["flat", "grouped"]),
    groupByField: z.string().optional(),
    emptyValueStrategy: z.enum(["folder_uncategorized", "root", "skip"]).optional(),
    uncategorizedFolderName: z.string().optional(),
    rootFolderName: z.string().optional(),
    baseParentId: z.string().uuid().nullable().optional(), // базовый parentId для импорта
  }),
  parentId: z.string().uuid().nullable().optional(), // устаревшее поле, используется для обратной совместимости
});

knowledgeBaseRouter.post('/bases/:baseId/json-import', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { baseId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);

  const base = await storage.getKnowledgeBase(baseId);
  if (!base || base.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const payload = createJsonImportSchema.parse(req.body);

  // Определяем формат файла по расширению
  const fileFormat = payload.fileName.toLowerCase().endsWith('.jsonl') ? 'jsonl' : 'json';

  // Если передан parentId из старого формата запроса, добавляем его в hierarchyConfig
  const hierarchyConfig = payload.hierarchyConfig as Record<string, unknown>;
  if (payload.parentId !== undefined) {
    hierarchyConfig.baseParentId = payload.parentId;
  }

  // Нормализация конфига маппинга к v2 (если v1 - мигрируем)
  const rawMappingConfig = payload.mappingConfig as Record<string, unknown>;
  let normalizedMappingConfig: Record<string, unknown>;
  
  if (isMappingConfigV2(rawMappingConfig as any)) {
    // Уже v2 - используем как есть
    normalizedMappingConfig = rawMappingConfig;
  } else {
    // v1 - мигрируем в v2
    const v2Config = migrateMappingConfigV1ToV2(rawMappingConfig as any);
    normalizedMappingConfig = v2Config as Record<string, unknown>;
  }

  const job = await storage.createJsonImportJob({
    workspaceId,
    baseId,
    status: 'pending',
    mappingConfig: normalizedMappingConfig,
    hierarchyConfig: hierarchyConfig,
    sourceFileKey: payload.fileKey,
    sourceFileName: payload.fileName,
    sourceFileSize: payload.fileSize,
    sourceFileFormat: fileFormat,
  });

  if (!job) {
    return res.status(500).json({ error: 'Не удалось создать задачу импорта' });
  }

  const response: CreateJsonImportResponse = {
    jobId: job.id,
    status: 'pending',
  };

  res.status(201).json(response);
}));

/**
 * POST /json-import/preview
 * Preview JSON/JSONL file structure
 */
const previewJsonImportSchema = z.object({
  fileKey: z.string().min(1, "Укажите ключ файла"),
  sampleSize: z.number().int().min(10).max(1000).optional(),
});

knowledgeBaseRouter.post('/json-import/preview', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { id: workspaceId } = getRequestWorkspace(req);
  const payload = previewJsonImportSchema.parse(req.body);

  try {
    const analysis = await analyzeJsonStructure(workspaceId, payload.fileKey, {
      sampleSize: payload.sampleSize ?? 100,
    });

    res.json(analysis);
  } catch (error) {
    logger.error('[json-import-preview] Ошибка анализа структуры', {
      workspaceId,
      fileKey: payload.fileKey,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof Error) {
      if (error.message.includes("File not found")) {
        res.status(404).json({
          error: "Файл не найден",
          code: "FILE_NOT_FOUND",
        });
        return;
      }
      if (error.message.includes("Неизвестный формат")) {
        res.status(400).json({
          error: error.message,
          code: "INVALID_FORMAT",
        });
        return;
      }
      if (error.message.includes("парсинга") || error.message.includes("parse")) {
        res.status(400).json({
          error: error.message,
          code: "PARSE_ERROR",
        });
        return;
      }
    }

    res.status(500).json({
      error: "Не удалось проанализировать файл",
      code: "UNKNOWN_ERROR",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}));

/**
 * GET /json-import/:jobId
 * Get JSON import job status
 */
knowledgeBaseRouter.get('/json-import/:jobId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { jobId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);

  const job = await storage.getJsonImportJob(jobId, workspaceId);
  if (!job) {
    return res.status(404).json({ error: 'Задача импорта не найдена' });
  }

  const base = await storage.getKnowledgeBase(job.baseId);
  if (!base) {
    return res.status(404).json({ error: 'База знаний не найдена' });
  }

  const totalRecords = job.totalRecords || 0;
  const percent = totalRecords > 0
    ? Math.round((job.processedRecords / totalRecords) * 100)
    : 0;

  const durationSeconds = job.finishedAt && job.startedAt
    ? Math.round((job.finishedAt.getTime() - job.startedAt.getTime()) / 1000)
    : null;

  const recentErrors = Array.isArray(job.errorLog)
    ? (job.errorLog as unknown[]).slice(-10) as GetJsonImportStatusResponse['recentErrors']
    : [];

  const response: GetJsonImportStatusResponse = {
    jobId: job.id,
    baseId: job.baseId,
    baseName: base.name,
    status: job.status,
    progress: {
      totalRecords,
      processedRecords: job.processedRecords,
      createdDocuments: job.createdDocuments,
      skippedRecords: job.skippedRecords,
      errorRecords: job.errorRecords,
      percent,
    },
    timing: {
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      durationSeconds,
    },
    recentErrors,
    hasMoreErrors: (job.errorLog as unknown[]).length > 10,
  };

  res.json(response);
}));

/**
 * GET /json-import/:jobId/errors
 * Get JSON import errors with pagination
 */
knowledgeBaseRouter.get('/json-import/:jobId/errors', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { jobId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);

  const job = await storage.getJsonImportJob(jobId, workspaceId);
  if (!job) {
    return res.status(404).json({ error: 'Задача импорта не найдена' });
  }

  const offset = Number.parseInt(req.query.offset as string, 10) || 0;
  const limit = Math.min(Number.parseInt(req.query.limit as string, 10) || 100, 1000);
  const errorType = req.query.errorType as string | undefined;

  // Получаем все ошибки из error_log
  const errorLog = Array.isArray(job.errorLog) ? (job.errorLog as unknown[]) : [];
  
  // Фильтруем по типу ошибки, если указан
  let filteredErrors = errorLog;
  if (errorType) {
    filteredErrors = errorLog.filter((err: unknown) => {
      if (err && typeof err === "object" && "errorType" in err) {
        return (err as { errorType: string }).errorType === errorType;
      }
      return false;
    });
  }

  // Применяем пагинацию
  const paginatedErrors = filteredErrors.slice(offset, offset + limit);

  // Подсчитываем статистику по типам ошибок
  const summary = {
    parseErrors: 0,
    validationErrors: 0,
    mappingErrors: 0,
    duplicates: 0,
    databaseErrors: 0,
    unknownErrors: 0,
  };

  for (const err of errorLog) {
    if (err && typeof err === "object" && "errorType" in err) {
      const errorType = (err as { errorType: string }).errorType;
      switch (errorType) {
        case "parse_error":
          summary.parseErrors++;
          break;
        case "validation_error":
          summary.validationErrors++;
          break;
        case "mapping_error":
          summary.mappingErrors++;
          break;
        case "duplicate":
          summary.duplicates++;
          break;
        case "database_error":
          summary.databaseErrors++;
          break;
        default:
          summary.unknownErrors++;
      }
    }
  }

  res.json({
    errors: paginatedErrors,
    total: filteredErrors.length,
    summary,
  });
}));

/**
 * GET /json-import/:jobId/errors/export
 * Export JSON import errors to CSV or JSON
 */
knowledgeBaseRouter.get('/json-import/:jobId/errors/export', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { jobId } = req.params;
  const { id: workspaceId } = getRequestWorkspace(req);
  const format = (req.query.format as string) || "json";

  const job = await storage.getJsonImportJob(jobId, workspaceId);
  if (!job) {
    return res.status(404).json({ error: 'Задача импорта не найдена' });
  }

  const errorLog = Array.isArray(job.errorLog) ? (job.errorLog as unknown[]) : [];

  if (format === "csv") {
    // Генерируем CSV
    const headers = ["Строка", "Индекс", "Тип ошибки", "Сообщение", "Поле", "Превью"];
    const rows = errorLog.map((err: unknown) => {
      if (err && typeof err === "object") {
        const e = err as {
          lineNumber?: number;
          recordIndex?: number;
          errorType?: string;
          message?: string;
          field?: string;
          rawPreview?: string;
        };
        return [
          e.lineNumber?.toString() || "",
          e.recordIndex?.toString() || "",
          e.errorType || "",
          (e.message || "").replace(/"/g, '""'),
          e.field || "",
          (e.rawPreview || "").replace(/"/g, '""'),
        ];
      }
      return ["", "", "", "", "", ""];
    });

    const csvContent = [
      headers.map((h) => `"${h}"`).join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="json-import-errors-${jobId.slice(0, 8)}.csv"`,
    );
    res.send(csvContent);
  } else {
    // JSON формат
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="json-import-errors-${jobId.slice(0, 8)}.json"`,
    );
    res.json({
      jobId,
      fileName: job.sourceFileName,
      exportedAt: new Date().toISOString(),
      errors: errorLog,
      summary: {
        total: errorLog.length,
        parseErrors: errorLog.filter((e: unknown) => e && typeof e === "object" && "errorType" in e && (e as { errorType: string }).errorType === "parse_error").length,
        validationErrors: errorLog.filter((e: unknown) => e && typeof e === "object" && "errorType" in e && (e as { errorType: string }).errorType === "validation_error").length,
        mappingErrors: errorLog.filter((e: unknown) => e && typeof e === "object" && "errorType" in e && (e as { errorType: string }).errorType === "mapping_error").length,
        duplicates: errorLog.filter((e: unknown) => e && typeof e === "object" && "errorType" in e && (e as { errorType: string }).errorType === "duplicate").length,
        databaseErrors: errorLog.filter((e: unknown) => e && typeof e === "object" && "errorType" in e && (e as { errorType: string }).errorType === "database_error").length,
        unknownErrors: errorLog.filter((e: unknown) => e && typeof e === "object" && "errorType" in e && !["parse_error", "validation_error", "mapping_error", "duplicate", "database_error"].includes((e as { errorType: string }).errorType)).length,
      },
    });
  }
}));

// Error handler for this router
knowledgeBaseRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: 'Некорректные данные', details: err.issues });
  }
  if (err instanceof KnowledgeBaseError) {
    return res.status(err.status).json({ message: err.message });
  }
  next(err);
});

export default knowledgeBaseRouter;
