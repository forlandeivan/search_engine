/**
 * Vector Routes Module
 * 
 * Handles Qdrant vector collection operations:
 * - GET /api/vector/collections - List collections
 * - GET /api/vector/collections/:name - Get collection info
 * - GET /api/vector/collections/:name/points - Get points
 * - POST /api/vector/collections/:name/scroll - Scroll points
 * - POST /api/vector/collections - Create collection
 * - DELETE /api/vector/collections/:name - Delete collection
 * - POST /api/vector/collections/:name/points - Upsert points
 * - POST /api/vector/collections/:name/search/text - Text search
 * - POST /api/vector/collections/:name/search/generative - Generative search
 * - POST /api/vector/collections/:name/search - Vector search
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import {
  getQdrantClient,
  QdrantConfigurationError,
  extractQdrantApiError,
} from '../qdrant';
import { workspaceOperationGuard } from '../guards/workspace-operation-guard';
import { buildEmbeddingsOperationContext } from '../guards/helpers';
import { mapDecisionToPayload } from '../guards/errors';
import { OperationBlockedError } from '../guards/errors';
import { adjustWorkspaceQdrantUsage } from '../usage/usage-service';
import {
  parseVectorSize,
  fetchAccessToken,
  fetchEmbeddingVector,
  recordEmbeddingUsageSafe,
  measureTokensForModel,
  buildVectorPayload,
} from '../lib/embedding-utils';
import { getVectorizationJob } from '../lib/vectorization-jobs';
import { HttpError } from '../lib/errors';
import {
  resolveGenerativeWorkspace,
  streamGigachatCompletion,
  normalizeResponseFormat,
  mergeLlmRequestConfig,
  sanitizeLlmModelOptions,
  fetchLlmCompletion,
  type LlmContextRecord,
  type RagResponseFormat,
  type GenerativeContextEntry,
} from '../lib/generative-search';
import type { Schemas } from '@qdrant/js-client-rest';
import type { PublicUser, LlmProvider } from '@shared/schema';

const logger = createLogger('vector');

export const vectorRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getAuthorizedUser(req: any, res: Response): PublicUser | null {
  const user = req.user as PublicUser | undefined;
  if (!user) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return null;
  }
  return user;
}

function getSessionUser(req: any): PublicUser | null {
  return req.user as PublicUser | null;
}

function getRequestWorkspace(req: any): { id: string } {
  const workspaceId = req.workspaceId ||
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: workspaceId };
}

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// ============================================================================
// Validation Schemas
// ============================================================================

const qdrantCollectionsResponseSchema = z
  .object({
    collections: z.array(z.object({ name: z.string().min(1) })).optional(),
  })
  .strict();

const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  vectorSize: z.number().int().positive(),
  distance: z.enum(['Cosine', 'Euclid', 'Dot']).default('Cosine'),
});

const sparseVectorSchema = z.object({
  indices: z.array(z.number().int()),
  values: z.array(z.number()),
});

const pointVectorSchema = z.union([
  z.array(z.number()),
  z.array(z.array(z.number())),
  z.record(z.any()),
  sparseVectorSchema,
]);

const upsertPointsSchema = z.object({
  wait: z.boolean().optional(),
  ordering: z.enum(['weak', 'medium', 'strong']).optional(),
  points: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    vector: pointVectorSchema,
    payload: z.record(z.any()).optional(),
  })).min(1),
});

const namedVectorSchema = z.object({
  name: z.string(),
  vector: z.array(z.number()),
});

const namedSparseVectorSchema = z.object({
  name: z.string(),
  vector: sparseVectorSchema,
});

const searchVectorSchema = z.union([
  z.array(z.number()),
  namedVectorSchema,
  namedSparseVectorSchema,
]);

const searchPointsSchema = z.object({
  vector: searchVectorSchema,
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().min(0).optional(),
  filter: z.unknown().optional(),
  params: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  scoreThreshold: z.number().optional(),
  shardKey: z.unknown().optional(),
  consistency: z.union([
    z.number().int().positive(),
    z.literal('majority'),
    z.literal('quorum'),
    z.literal('all'),
  ]).optional(),
  timeout: z.number().positive().optional(),
});

const textSearchPointsSchema = z.object({
  query: z.string().trim().min(1, 'Введите поисковый запрос'),
  embeddingProviderId: z.string().trim().min(1, 'Укажите сервис эмбеддингов'),
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().min(0).optional(),
  filter: z.unknown().optional(),
  params: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  scoreThreshold: z.number().optional(),
  shardKey: z.unknown().optional(),
  consistency: z.union([
    z.number().int().positive(),
    z.literal('majority'),
    z.literal('quorum'),
    z.literal('all'),
  ]).optional(),
  timeout: z.number().positive().optional(),
});

const generativeSearchPointsSchema = textSearchPointsSchema.extend({
  llmProviderId: z.string().trim().min(1, 'Укажите провайдера LLM'),
  llmModel: z.string().trim().min(1, 'Укажите модель LLM').optional(),
  contextLimit: z.number().int().positive().max(50).optional(),
  responseFormat: z.string().optional(),
  includeContext: z.boolean().optional(),
  includeQueryVector: z.boolean().optional(),
  llmTemperature: z.coerce.number().min(0).max(2).optional(),
  llmMaxTokens: z.coerce.number().int().min(16).max(4_096).optional(),
  llmSystemPrompt: z.string().optional(),
  llmResponseFormat: z.string().optional(),
});

const fetchKnowledgeVectorRecordsSchema = z.object({
  collectionName: z.string().trim().min(1, 'Укажите коллекцию'),
  recordIds: z
    .array(z.union([z.string().trim().min(1), z.number()]))
    .min(1, 'Передайте хотя бы один идентификатор')
    .max(256, 'За один запрос можно получить не более 256 записей'),
  includeVector: z.boolean().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /collections
 * List all collections accessible to workspace
 */
vectorRouter.get('/collections', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const allowedCollections = await storage.listWorkspaceCollections(workspaceId);

  if (allowedCollections.length === 0) {
    return res.json({ collections: [] });
  }

  const allowedSet = new Set(allowedCollections);

  try {
    const client = getQdrantClient();
    const collectionsResponse = await client.getCollections();
    const parsedCollections = qdrantCollectionsResponseSchema.safeParse(collectionsResponse);

    if (!parsedCollections.success) {
      logger.warn({ error: parsedCollections.error.flatten() }, 'Unexpected Qdrant response format');
    }

    const collections = parsedCollections.success
      ? parsedCollections.data.collections ?? []
      : [];

    const detailedCollections = await Promise.all(
      collections.map(async ({ name }) => {
        if (!allowedSet.has(name)) return null;

        try {
          const info = await client.getCollection(name);
          const vectorsConfig = info.config?.params?.vectors as
            | { size?: number | null; distance?: string | null }
            | undefined;

          return {
            name,
            status: info.status,
            optimizerStatus: info.optimizer_status,
            pointsCount: info.points_count ?? info.vectors_count ?? 0,
            vectorsCount: info.vectors_count ?? null,
            vectorSize: vectorsConfig?.size ?? null,
            distance: vectorsConfig?.distance ?? null,
            segmentsCount: info.segments_count,
          };
        } catch (error) {
          return {
            name,
            status: 'unknown' as const,
            error: error instanceof Error ? error.message : 'Failed to get collection info',
          };
        }
      })
    );

    const existingCollections = detailedCollections.filter(
      (c): c is NonNullable<typeof c> => c !== null
    );
    const existingNames = new Set(existingCollections.map((c) => c.name));
    const missingCollections = allowedCollections
      .filter((name) => !existingNames.has(name))
      .map((name) => ({
        name,
        status: 'unknown' as const,
        optimizerStatus: 'unknown' as const,
        pointsCount: 0,
        vectorsCount: null,
        vectorSize: null,
        distance: null,
        segmentsCount: null,
        error: 'Collection not found in Qdrant',
      }));

    res.json({ collections: [...existingCollections, ...missingCollections] });
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant not configured',
        details: error.message,
      });
    }

    const qdrantError = extractQdrantApiError(error);
    if (qdrantError) {
      logger.error({ error }, 'Qdrant error getting collections');
      return res.status(qdrantError.status).json({
        error: 'Failed to load collections',
        details: qdrantError.message,
      });
    }

    logger.error({ error }, 'Error getting collections');
    res.status(500).json({
      error: 'Failed to load collections',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * GET /collections/:name
 * Get collection info
 */
vectorRouter.get('/collections/:name', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  try {
    const client = getQdrantClient();
    const info = await client.getCollection(req.params.name);
    const vectorsConfig = info.config?.params?.vectors as
      | { size?: number | null; distance?: string | null }
      | undefined;

    res.json({
      name: req.params.name,
      status: info.status,
      optimizerStatus: info.optimizer_status,
      pointsCount: info.points_count ?? info.vectors_count ?? 0,
      vectorsCount: info.vectors_count ?? null,
      segmentsCount: info.segments_count,
      vectorSize: vectorsConfig?.size ?? null,
      distance: vectorsConfig?.distance ?? null,
      config: info.config,
    });
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant not configured',
        details: error.message,
      });
    }

    logger.error({ error, collection: req.params.name }, 'Error getting collection');
    res.status(500).json({
      error: 'Failed to get collection info',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * GET /collections/:name/points
 * Get points from collection
 */
vectorRouter.get('/collections/:name/points', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const limitParam = typeof req.query.limit === 'string' ? req.query.limit.trim() : undefined;
  const limitNumber = limitParam ? parseInt(limitParam, 10) : NaN;
  const limit = Number.isFinite(limitNumber) && limitNumber > 0 ? Math.min(limitNumber, 100) : 20;

  const offsetParam = typeof req.query.offset === 'string' ? req.query.offset.trim() : undefined;
  let offset: string | number | undefined;
  if (offsetParam) {
    if (/^-?\d+$/.test(offsetParam)) {
      offset = parseInt(offsetParam, 10);
    } else {
      offset = offsetParam;
    }
  }

  try {
    const client = getQdrantClient();
    const result = await client.scroll(req.params.name, {
      limit,
      offset,
      with_payload: true,
      with_vector: false,
    });

    res.json({
      points: result.points,
      nextOffset: result.next_page_offset ?? null,
    });
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant not configured',
        details: error.message,
      });
    }

    logger.error({ error, collection: req.params.name }, 'Error getting points');
    res.status(500).json({
      error: 'Failed to get points',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * POST /collections/:name/scroll
 * Scroll through points
 */
vectorRouter.post('/collections/:name/scroll', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const limit = typeof req.body?.limit === 'number' ? Math.min(Math.max(1, req.body.limit), 100) : 20;
  const offset = req.body?.offset;
  const filter = req.body?.filter;

  try {
    const client = getQdrantClient();
    const result = await client.scroll(req.params.name, {
      limit,
      offset,
      filter,
      with_payload: true,
      with_vector: false,
    });

    res.json({
      points: result.points,
      nextOffset: result.next_page_offset ?? null,
    });
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant not configured',
        details: error.message,
      });
    }

    logger.error({ error, collection: req.params.name }, 'Error scrolling points');
    res.status(500).json({
      error: 'Failed to scroll points',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * POST /collections
 * Create new collection
 */
vectorRouter.post('/collections', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);

  try {
    const parsed = createCollectionSchema.parse(req.body);
    const client = getQdrantClient();

    await client.createCollection(parsed.name, {
      vectors: {
        size: parsed.vectorSize,
        distance: parsed.distance,
      },
    });

    await storage.createWorkspaceCollection(workspaceId, parsed.name);

    res.status(201).json({
      name: parsed.name,
      vectorSize: parsed.vectorSize,
      distance: parsed.distance,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid data', details: error.issues });
    }
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant not configured',
        details: error.message,
      });
    }

    logger.error({ error }, 'Error creating collection');
    res.status(500).json({
      error: 'Failed to create collection',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * DELETE /collections/:name
 * Delete collection
 */
vectorRouter.delete('/collections/:name', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  try {
    const client = getQdrantClient();
    await client.deleteCollection(req.params.name);
    await storage.deleteWorkspaceCollection(workspaceId, req.params.name);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant not configured',
        details: error.message,
      });
    }

    logger.error({ error, collection: req.params.name }, 'Error deleting collection');
    res.status(500).json({
      error: 'Failed to delete collection',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * POST /collections/:name/points
 * Upsert points to collection (with guard and usage tracking)
 */
vectorRouter.post('/collections/:name/points', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Коллекция не найдена' });
  }

  try {
    const body = upsertPointsSchema.parse(req.body);
    const client = getQdrantClient();

    // Check operation guard
    const expectedPoints = Array.isArray(body.points) ? body.points.length : 0;
    const decision = await workspaceOperationGuard.check(
      buildEmbeddingsOperationContext({
        workspaceId,
        providerId: null,
        model: null,
        scenario: 'document_vectorization',
        objects: expectedPoints > 0 ? expectedPoints : undefined,
        collection: req.params.name,
      }),
    );
    
    if (!decision.allowed) {
      throw new OperationBlockedError(
        mapDecisionToPayload(decision, {
          workspaceId,
          operationType: 'EMBEDDINGS',
        }),
      );
    }

    const upsertPayload: Parameters<typeof client.upsert>[1] = {
      wait: body.wait,
      ordering: body.ordering,
      points: body.points as Schemas['PointStruct'][],
    };

    const result = await client.upsert(req.params.name, upsertPayload);
    
    // Track usage
    const pointsDelta = Array.isArray(body.points) ? body.points.length : 0;
    if (pointsDelta > 0) {
      await adjustWorkspaceQdrantUsage(workspaceId, { pointsCount: pointsDelta });
    }

    res.status(202).json(result);
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant не настроен',
        details: error.message,
      });
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Некорректные данные точек',
        details: error.errors,
      });
    }
    
    if (error instanceof OperationBlockedError) {
      return res.status(error.status).json(error.toJSON());
    }

    const qdrantError = extractQdrantApiError(error);
    if (qdrantError) {
      logger.error({ error, collection: req.params.name }, 'Qdrant error upserting points');
      return res.status(qdrantError.status).json({
        error: qdrantError.message,
        details: qdrantError.details,
      });
    }

    logger.error({ error, collection: req.params.name }, 'Error upserting points');
    res.status(500).json({
      error: 'Не удалось загрузить данные в коллекцию',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * POST /collections/:name/search
 * Vector search (full implementation with all options)
 */
vectorRouter.post('/collections/:name/search', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Коллекция не найдена' });
  }

  try {
    const body = searchPointsSchema.parse(req.body);
    const client = getQdrantClient();

    const searchPayload = {
      vector: body.vector as Schemas['NamedVectorStruct'],
      limit: body.limit,
    } as Parameters<typeof client.search>[1];

    if (body.offset !== undefined) {
      searchPayload.offset = body.offset;
    }

    if (body.filter !== undefined) {
      searchPayload.filter = body.filter as Parameters<typeof client.search>[1]['filter'];
    }

    if (body.params !== undefined) {
      searchPayload.params = body.params as Parameters<typeof client.search>[1]['params'];
    }

    if (body.withPayload !== undefined) {
      searchPayload.with_payload = body.withPayload as Parameters<typeof client.search>[1]['with_payload'];
    }

    if (body.withVector !== undefined) {
      searchPayload.with_vector = body.withVector as Parameters<typeof client.search>[1]['with_vector'];
    }

    if (body.scoreThreshold !== undefined) {
      searchPayload.score_threshold = body.scoreThreshold;
    }

    if (body.shardKey !== undefined) {
      searchPayload.shard_key = body.shardKey as Parameters<typeof client.search>[1]['shard_key'];
    }

    if (body.consistency !== undefined) {
      searchPayload.consistency = body.consistency;
    }

    if (body.timeout !== undefined) {
      searchPayload.timeout = body.timeout;
    }

    const results = await client.search(req.params.name, searchPayload);
    res.json({ results });
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant не настроен',
        details: error.message,
      });
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Некорректные параметры поиска',
        details: error.errors,
      });
    }

    const qdrantError = extractQdrantApiError(error);
    if (qdrantError) {
      logger.error({ error, collection: req.params.name }, 'Qdrant error searching');
      return res.status(qdrantError.status).json({
        error: qdrantError.message,
        details: qdrantError.details,
      });
    }

    logger.error({ error, collection: req.params.name }, 'Error searching');
    res.status(500).json({
      error: 'Не удалось выполнить поиск',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * POST /collections/:name/search/text
 * Text search with embedding (full implementation)
 */
vectorRouter.post('/collections/:name/search/text', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Коллекция не найдена' });
  }

  try {
    const body = textSearchPointsSchema.parse(req.body);
    const provider = await storage.getEmbeddingProvider(body.embeddingProviderId, workspaceId);

    if (!provider) {
      return res.status(404).json({ error: 'Сервис эмбеддингов не найден' });
    }

    if (!provider.isActive) {
      throw new HttpError(400, 'Выбранный сервис эмбеддингов отключён');
    }

    const client = getQdrantClient();
    const collectionInfo = await client.getCollection(req.params.name);
    const vectorsConfig = collectionInfo.config?.params?.vectors as
      | { size?: number | null; distance?: string | null }
      | undefined;

    const collectionVectorSize = vectorsConfig?.size ?? null;
    const providerVectorSize = parseVectorSize(provider.qdrantConfig?.vectorSize);

    if (
      collectionVectorSize &&
      providerVectorSize &&
      Number(collectionVectorSize) !== Number(providerVectorSize)
    ) {
      throw new HttpError(
        400,
        `Размер вектора коллекции (${collectionVectorSize}) не совпадает с настройкой сервиса (${providerVectorSize}).`,
      );
    }

    const accessToken = await fetchAccessToken(provider);
    const embeddingResult = await fetchEmbeddingVector(provider, accessToken, body.query);

    if (collectionVectorSize && embeddingResult.vector.length !== collectionVectorSize) {
      throw new HttpError(
        400,
        `Сервис эмбеддингов вернул вектор длиной ${embeddingResult.vector.length}, ожидалось ${collectionVectorSize}.`,
      );
    }

    const embeddingTokensForUsage =
      embeddingResult.usageTokens ?? Math.max(1, Math.ceil(Buffer.byteLength(body.query, 'utf8') / 4));
    const embeddingUsageMeasurement = measureTokensForModel(embeddingTokensForUsage, {
      consumptionUnit: 'TOKENS_1K',
      modelKey: provider.model ?? null,
    });

    await recordEmbeddingUsageSafe({
      workspaceId,
      provider,
      modelKey: provider.model ?? null,
      tokensTotal: embeddingUsageMeasurement?.quantityRaw ?? embeddingTokensForUsage,
      contentBytes: Buffer.byteLength(body.query, 'utf8'),
      operationId: `collection-search-${crypto.randomUUID()}`,
    });

    const searchPayload: Parameters<typeof client.search>[1] = {
      vector: buildVectorPayload(
        embeddingResult.vector,
        provider.qdrantConfig?.vectorFieldName,
      ),
      limit: body.limit,
    };

    if (body.offset !== undefined) searchPayload.offset = body.offset;
    if (body.filter !== undefined) searchPayload.filter = body.filter as any;
    if (body.params !== undefined) searchPayload.params = body.params as any;
    if (body.withPayload !== undefined) searchPayload.with_payload = body.withPayload as any;
    if (body.withVector !== undefined) searchPayload.with_vector = body.withVector as any;
    if (body.scoreThreshold !== undefined) searchPayload.score_threshold = body.scoreThreshold;
    if (body.shardKey !== undefined) searchPayload.shard_key = body.shardKey as any;
    if (body.consistency !== undefined) searchPayload.consistency = body.consistency;
    if (body.timeout !== undefined) searchPayload.timeout = body.timeout;

    const results = await client.search(req.params.name, searchPayload);

    res.json({
      results,
      queryVector: embeddingResult.vector,
      vectorLength: embeddingResult.vector.length,
      usageTokens: embeddingResult.usageTokens ?? null,
      provider: {
        id: provider.id,
        name: provider.name,
      },
    });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({
        error: error.message,
        details: error.details,
      });
    }

    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant не настроен',
        details: error.message,
      });
    }

    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Некорректные параметры поиска',
        details: error.errors,
      });
    }

    const qdrantError = extractQdrantApiError(error);
    if (qdrantError) {
      logger.error({ error, collection: req.params.name }, 'Qdrant error in text search');
      return res.status(qdrantError.status).json({
        error: qdrantError.message,
        details: qdrantError.details,
      });
    }

    logger.error({ error, collection: req.params.name }, 'Error in text search');
    res.status(500).json({
      error: 'Не удалось выполнить текстовый поиск',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * POST /collections/:name/search/generative
 * Generative search with embedding + LLM (full implementation)
 */
vectorRouter.post('/collections/:name/search/generative', asyncHandler(async (req, res) => {
  const workspaceContext = await resolveGenerativeWorkspace(req, res);
  if (!workspaceContext) {
    return;
  }

  const { workspaceId } = workspaceContext;
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Коллекция не найдена' });
  }

  const payloadSource: Record<string, unknown> =
    req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? { ...(req.body as Record<string, unknown>) }
      : {};

  delete payloadSource.apiKey;
  delete payloadSource.publicId;
  delete payloadSource.sitePublicId;
  delete payloadSource.workspaceId;
  delete payloadSource.workspace_id;

  const body = generativeSearchPointsSchema.parse(payloadSource);
  const responseFormatCandidate = normalizeResponseFormat(body.responseFormat);
  if (responseFormatCandidate === null) {
    return res.status(400).json({
      error: 'Некорректный формат ответа',
      details: 'Поддерживаются значения text, md/markdown или html',
    });
  }

  const responseFormat: RagResponseFormat = responseFormatCandidate ?? 'text';
  const includeContextInResponse = body.includeContext ?? true;
  const includeQueryVectorInResponse = body.includeQueryVector ?? true;
  const llmResponseFormatCandidate = normalizeResponseFormat(body.llmResponseFormat);
  if (llmResponseFormatCandidate === null) {
    return res.status(400).json({
      error: 'Неверный формат ответа LLM',
      details: 'Допустимые варианты формата: text, md/markdown или html',
    });
  }
  const llmResponseFormatNormalized = llmResponseFormatCandidate ?? responseFormat;
  
  const embeddingProvider = await storage.getEmbeddingProvider(body.embeddingProviderId, workspaceId);
  if (!embeddingProvider) {
    return res.status(404).json({ error: 'Сервис эмбеддингов не найден' });
  }
  if (!embeddingProvider.isActive) {
    throw new HttpError(400, 'Выбранный сервис эмбеддингов отключён');
  }

  const llmProvider = await storage.getLlmProvider(body.llmProviderId, workspaceId);
  if (!llmProvider) {
    return res.status(404).json({ error: 'Провайдер LLM не найден' });
  }
  if (!llmProvider.isActive) {
    throw new HttpError(400, 'Выбранный провайдер LLM отключён');
  }

  const llmRequestConfig = mergeLlmRequestConfig(llmProvider);
  if (body.llmSystemPrompt !== undefined) {
    llmRequestConfig.systemPrompt = body.llmSystemPrompt || undefined;
  }
  if (body.llmTemperature !== undefined) {
    llmRequestConfig.temperature = body.llmTemperature;
  }
  if (body.llmMaxTokens !== undefined) {
    llmRequestConfig.maxTokens = body.llmMaxTokens;
  }

  const configuredLlmProvider: LlmProvider = {
    ...llmProvider,
    requestConfig: llmRequestConfig,
  };

  const sanitizedModels = sanitizeLlmModelOptions(configuredLlmProvider.availableModels);
  const requestedModel = typeof body.llmModel === 'string' ? body.llmModel.trim() : '';
  const normalizedModelFromList =
    sanitizedModels.find((model) => model.value === requestedModel)?.value ??
    sanitizedModels.find((model) => model.label === requestedModel)?.value ??
    null;
  const selectedModelValue =
    (normalizedModelFromList && normalizedModelFromList.trim().length > 0
      ? normalizedModelFromList.trim()
      : undefined) ??
    (requestedModel.length > 0 ? requestedModel : undefined) ??
    configuredLlmProvider.model;
  const selectedModelMeta =
    sanitizedModels.find((model) => model.value === selectedModelValue) ?? null;

  const client = getQdrantClient();
  const collectionInfo = await client.getCollection(req.params.name);
  const vectorsConfig = collectionInfo.config?.params?.vectors as
    | { size?: number | null; distance?: string | null }
    | undefined;

  const collectionVectorSize = vectorsConfig?.size ?? null;
  const providerVectorSize = parseVectorSize(embeddingProvider.qdrantConfig?.vectorSize);

  if (
    collectionVectorSize &&
    providerVectorSize &&
    Number(collectionVectorSize) !== Number(providerVectorSize)
  ) {
    throw new HttpError(
      400,
      `Размер вектора коллекции (${collectionVectorSize}) не совпадает с настройкой сервиса (${providerVectorSize}).`,
    );
  }

  const embeddingAccessToken = await fetchAccessToken(embeddingProvider);
  const embeddingResult = await fetchEmbeddingVector(embeddingProvider, embeddingAccessToken, body.query);

  if (collectionVectorSize && embeddingResult.vector.length !== collectionVectorSize) {
    throw new HttpError(
      400,
      `Сервис эмбеддингов вернул вектор длиной ${embeddingResult.vector.length}, ожидалось ${collectionVectorSize}.`,
    );
  }

  const embeddingTokensForUsage =
    embeddingResult.usageTokens ?? Math.max(1, Math.ceil(Buffer.byteLength(body.query, 'utf8') / 4));
  const embeddingUsageMeasurement = measureTokensForModel(embeddingTokensForUsage, {
    consumptionUnit: 'TOKENS_1K',
    modelKey: selectedModelValue ?? embeddingProvider.model ?? null,
  });

  await recordEmbeddingUsageSafe({
    workspaceId,
    provider: embeddingProvider,
    modelKey: selectedModelValue ?? embeddingProvider.model ?? null,
    tokensTotal: embeddingUsageMeasurement?.quantityRaw ?? embeddingTokensForUsage,
    contentBytes: Buffer.byteLength(body.query, 'utf8'),
    operationId: `collection-search-${crypto.randomUUID()}`,
  });

  const searchPayload: Parameters<typeof client.search>[1] = {
    vector: buildVectorPayload(embeddingResult.vector, embeddingProvider.qdrantConfig?.vectorFieldName),
    limit: body.limit,
  };

  if (body.offset !== undefined) searchPayload.offset = body.offset;
  if (body.filter !== undefined) searchPayload.filter = body.filter as any;
  if (body.params !== undefined) searchPayload.params = body.params as any;
  searchPayload.with_payload = (body.withPayload ?? true) as any;
  if (body.withVector !== undefined) searchPayload.with_vector = body.withVector as any;
  if (body.scoreThreshold !== undefined) searchPayload.score_threshold = body.scoreThreshold;
  if (body.shardKey !== undefined) searchPayload.shard_key = body.shardKey as any;
  if (body.consistency !== undefined) searchPayload.consistency = body.consistency;
  if (body.timeout !== undefined) searchPayload.timeout = body.timeout;

  const results = await client.search(req.params.name, searchPayload);

  const sanitizedResults: GenerativeContextEntry[] = results.map((result) => ({
    id: result.id,
    payload: result.payload ?? null,
    score: result.score ?? null,
    shard_key: result.shard_key ?? null,
    order_value: result.order_value ?? null,
  }));

  const desiredContext = body.contextLimit ?? sanitizedResults.length;
  const contextLimit = Math.max(0, Math.min(desiredContext, sanitizedResults.length));
  const contextRecords: LlmContextRecord[] = sanitizedResults.slice(0, contextLimit).map((entry, index) => {
    const basePayload = entry.payload;
    let contextPayload: Record<string, unknown> | null = null;

    if (basePayload && typeof basePayload === 'object' && !Array.isArray(basePayload)) {
      contextPayload = { ...(basePayload as Record<string, unknown>) };
    } else if (basePayload !== null && basePayload !== undefined) {
      contextPayload = { value: basePayload };
    }

    return {
      index: index + 1,
      score: typeof entry.score === 'number' ? entry.score : null,
      payload: contextPayload,
    } satisfies LlmContextRecord;
  });

  const llmAccessToken = await fetchAccessToken(configuredLlmProvider);
  const acceptHeader = typeof req.headers.accept === 'string' ? req.headers.accept : '';
  const wantsStreamingResponse =
    configuredLlmProvider.providerType === 'gigachat' && acceptHeader.toLowerCase().includes('text/event-stream');

  if (wantsStreamingResponse) {
    await streamGigachatCompletion({
      req,
      res,
      provider: configuredLlmProvider,
      accessToken: llmAccessToken,
      query: body.query,
      context: contextRecords,
      sanitizedResults,
      embeddingResult,
      embeddingProvider,
      selectedModelValue,
      selectedModelMeta,
      limit: body.limit,
      contextLimit,
      responseFormat: llmResponseFormatNormalized,
      includeContextInResponse,
      includeQueryVectorInResponse,
      collectionName: typeof req.params.name === 'string' ? req.params.name : '',
    });
    return;
  }

  const completion = await fetchLlmCompletion(
    configuredLlmProvider,
    llmAccessToken,
    body.query,
    contextRecords,
    selectedModelValue,
    { responseFormat: llmResponseFormatNormalized },
  );

  const responsePayload: Record<string, unknown> = {
    answer: completion.answer,
    format: responseFormat,
    usage: {
      embeddingTokens: embeddingResult.usageTokens ?? null,
      llmTokens: completion.usageTokens ?? null,
    },
    provider: {
      id: llmProvider.id,
      name: llmProvider.name,
      model: selectedModelValue,
      modelLabel: selectedModelMeta?.label ?? selectedModelValue,
    },
    embeddingProvider: {
      id: embeddingProvider.id,
      name: embeddingProvider.name,
    },
  };

  if (includeContextInResponse) {
    responsePayload.context = sanitizedResults;
  }

  if (includeQueryVectorInResponse) {
    responsePayload.queryVector = embeddingResult.vector;
    responsePayload.vectorLength = embeddingResult.vector.length;
  }

  res.json(responsePayload);
}));

/**
 * POST /documents/vector-records
 * Fetch vector records by IDs from a collection
 * Note: This is mounted at /api/knowledge via index.ts
 */
vectorRouter.post('/documents/vector-records', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);

  const body = fetchKnowledgeVectorRecordsSchema.parse(req.body);

  const ownerWorkspaceId = await storage.getCollectionWorkspace(body.collectionName);
  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Коллекция не найдена' });
  }

  const ids = body.recordIds.map((value) => {
    if (typeof value === 'number') return value;
    const trimmed = value.trim();
    if (/^-?\d+$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
    return trimmed;
  });

  try {
    const client = getQdrantClient();
    const includeVector = body.includeVector ?? true;

    const result = await client.retrieve(body.collectionName, {
      ids: ids as Array<string | number>,
      with_payload: true,
      with_vector: includeVector,
    });

    const records = result.map((point) => ({
      id: point.id ?? null,
      payload: point.payload ?? null,
      vector: point.vector ?? null,
      shardKey: (point as { shard_key?: string | number }).shard_key ?? null,
      version: (point as { version?: number }).version ?? null,
    }));

    res.json({ records });
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant не настроен',
        details: error.message,
      });
    }

    const qdrantError = extractQdrantApiError(error);
    if (qdrantError) {
      logger.error({ error, collection: body.collectionName }, 'Qdrant error fetching vector records');
      return res.status(qdrantError.status).json({
        error: qdrantError.message,
        details: qdrantError.details,
      });
    }

    logger.error({ error }, 'Error fetching vector records');
    res.status(500).json({
      error: 'Не удалось получить записи',
      details: getErrorDetails(error),
    });
  }
}));

// ============================================================================
// Knowledge Document Vectorization Jobs
// ============================================================================

/**
 * GET /documents/vectorize/jobs/:jobId
 * Get vectorization job status
 * Note: This is mounted at /api/knowledge, so full path is /api/knowledge/documents/vectorize/jobs/:jobId
 */
vectorRouter.get('/documents/vectorize/jobs/:jobId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { jobId } = req.params;
  if (!jobId || !jobId.trim()) {
    return res.status(400).json({ error: 'Некорректный идентификатор задачи' });
  }

  const { id: workspaceId } = getRequestWorkspace(req);
  const job = getVectorizationJob(jobId);

  if (!job || job.workspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Задача не найдена' });
  }

  const { workspaceId: _workspaceId, ...publicJob } = job;
  res.json({ job: publicJob });
}));

export default vectorRouter;
