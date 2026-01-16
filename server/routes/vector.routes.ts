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

import { Router } from 'express';
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
import { buildEmbeddingsOperationContext, mapDecisionToPayload } from '../guards/helpers';
import { OperationBlockedError } from '../guards/errors';
import { adjustWorkspaceQdrantUsage } from '../usage/usage-service';
import type { Schemas } from '@qdrant/js-client-rest';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('vector');

export const vectorRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

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
 * Vector search
 */
vectorRouter.post('/collections/:name/search', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const vector = req.body?.vector;
  if (!Array.isArray(vector)) {
    return res.status(400).json({ error: 'Vector is required' });
  }

  const limit = typeof req.body?.limit === 'number' ? Math.min(Math.max(1, req.body.limit), 100) : 10;
  const filter = req.body?.filter;
  const scoreThreshold = req.body?.scoreThreshold;

  try {
    const client = getQdrantClient();
    const result = await client.search(req.params.name, {
      vector,
      limit,
      filter,
      score_threshold: scoreThreshold,
      with_payload: true,
    });

    res.json({ results: result });
  } catch (error) {
    if (error instanceof QdrantConfigurationError) {
      return res.status(503).json({
        error: 'Qdrant not configured',
        details: error.message,
      });
    }

    logger.error({ error, collection: req.params.name }, 'Error searching');
    res.status(500).json({
      error: 'Failed to search',
      details: getErrorDetails(error),
    });
  }
}));

/**
 * POST /collections/:name/search/text
 * Text search (requires embedding)
 */
vectorRouter.post('/collections/:name/search/text', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Text is required' });
  }

  // Note: This is a placeholder. In real implementation, you'd call embedding service first.
  res.status(501).json({ error: 'Text search requires embedding service integration' });
}));

/**
 * POST /collections/:name/search/generative
 * Generative search (RAG)
 */
vectorRouter.post('/collections/:name/search/generative', asyncHandler(async (req, res) => {
  const { id: workspaceId } = getRequestWorkspace(req);
  const ownerWorkspaceId = await storage.getCollectionWorkspace(req.params.name);

  if (!ownerWorkspaceId || ownerWorkspaceId !== workspaceId) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const query = req.body?.query;
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // Note: This is a placeholder. In real implementation, you'd integrate with LLM.
  res.status(501).json({ error: 'Generative search requires LLM integration' });
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

export default vectorRouter;
