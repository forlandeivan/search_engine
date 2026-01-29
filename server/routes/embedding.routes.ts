/**
 * Embedding Routes Module
 * 
 * Handles embedding services/providers management:
 * - GET /api/embedding/services - List embedding providers
 * - POST /api/embedding/services - Create embedding provider
 * - PUT /api/embedding/services/:id - Update embedding provider
 * - DELETE /api/embedding/services/:id - Delete embedding provider
 * - POST /api/embedding/services/test-credentials - Test credentials
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { fetchAccessToken } from '../llm-access-token';
import { listModels } from '../model-service';
import { storage } from '../storage';
import type { PublicUser, EmbeddingProvider, PublicEmbeddingProvider } from '@shared/schema';

const logger = createLogger('embedding');

// Create router instance
export const embeddingRouter = Router();

// Debug middleware to log all requests to embedding router
embeddingRouter.use((req, res, next) => {
  logger.info(`[EMBEDDING ROUTER] ${req.method} ${req.url} (originalUrl: ${req.originalUrl})`);
  next();
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

function getRequestWorkspace(req: Request): string | undefined {
  // Check header first (most common from frontend)
  const headerWorkspaceRaw = req.headers["x-workspace-id"];
  const headerWorkspaceId = Array.isArray(headerWorkspaceRaw)
    ? headerWorkspaceRaw[0]
    : typeof headerWorkspaceRaw === "string"
      ? headerWorkspaceRaw.trim()
      : undefined;

  return req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    headerWorkspaceId ||
    req.params.workspaceId ||
    req.query.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /services
 * List embedding providers/services
 */
embeddingRouter.get('/services', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const workspaceId = getRequestWorkspace(req);
  // Получаем полные объекты провайдеров, а не только статус
  const fullProviders = await storage.listEmbeddingProviders(workspaceId);
  
  // Преобразуем в PublicEmbeddingProvider (скрываем authorizationKey)
  const publicProviders: PublicEmbeddingProvider[] = fullProviders.map(provider => {
    const { authorizationKey, ...rest } = provider;
    return {
      ...rest,
      hasAuthorizationKey: typeof authorizationKey === 'string' && authorizationKey.trim().length > 0,
    };
  });
  
  res.json({ providers: publicProviders });
}));

/**
 * POST /services
 * Create embedding provider
 */
embeddingRouter.post('/services', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  try {
    const provider = await storage.createEmbeddingProvider(req.body);
    res.status(201).json({ provider });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid provider data', details: error.issues });
    }
    throw error;
  }
}));

/**
 * PUT /services/:id
 * Update embedding provider
 */
embeddingRouter.put('/services/:id', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const providerId = req.params.id;
  const provider = await storage.updateEmbeddingProvider(providerId, req.body);
  
  if (!provider) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  
  res.json({ provider });
}));

/**
 * DELETE /services/:id
 * Delete embedding provider
 * Проверяет, что нет активных моделей, привязанных к провайдеру
 */
embeddingRouter.delete('/services/:id', asyncHandler(async (req, res) => {
  logger.info(`DELETE /services/:id called with id: ${req.params.id}, url: ${req.url}, originalUrl: ${req.originalUrl}`);
  
  const user = getAuthorizedUser(req, res);
  if (!user) {
    logger.warn('DELETE /services/:id - unauthorized');
    return;
  }

  const providerId = req.params.id;
  logger.info(`DELETE /services/:id - deleting provider: ${providerId}`);
  
  // Проверяем, есть ли активные модели для этого провайдера
  const activeModels = await listModels({ 
    providerId, 
    type: 'EMBEDDINGS',
    includeInactive: false 
  });
  
  if (activeModels.length > 0) {
    return res.status(409).json({ 
      message: 'Невозможно удалить провайдер: существуют активные модели в каталоге',
      details: {
        activeModelsCount: activeModels.length,
        models: activeModels.map(m => ({ key: m.modelKey, name: m.displayName }))
      }
    });
  }
  
  const deleted = await storage.deleteEmbeddingProvider(providerId);
  
  if (!deleted) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  
  res.status(204).send();
}));

/**
 * POST /services/test-credentials
 * Test embedding provider credentials
 */
embeddingRouter.post('/services/test-credentials', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const testSchema = z.object({
    tokenUrl: z.string().trim().url("Некорректный URL для получения токена"),
    embeddingsUrl: z.string().trim().url("Некорректный URL сервиса эмбеддингов"),
    authorizationKey: z.string().trim().min(1, "Укажите Authorization key"),
    scope: z.string().trim().min(1, "Укажите OAuth scope"),
    model: z.string().trim().min(1, "Укажите модель эмбеддингов"),
    allowSelfSignedCertificate: z.boolean().default(false),
    requestHeaders: z.record(z.string()).default({}),
  });

  const payload = testSchema.parse(req.body);
  const TEST_EMBEDDING_TEXT = "привет!";

  const steps: Array<{
    stage: string;
    status: 'success' | 'error';
    detail?: string;
  }> = [];

  try {
    // Step 1: Fetch access token
    steps.push({ stage: 'token-request', status: 'success' });
    const provider: EmbeddingProvider = {
      id: 'test',
      name: 'Test Provider',
      providerType: 'custom',
      tokenUrl: payload.tokenUrl,
      embeddingsUrl: payload.embeddingsUrl,
      authorizationKey: payload.authorizationKey,
      scope: payload.scope,
      model: payload.model,
      allowSelfSignedCertificate: payload.allowSelfSignedCertificate,
      requestHeaders: payload.requestHeaders,
      isActive: true,
      workspaceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let accessToken: string;
    try {
      accessToken = await fetchAccessToken(provider);
      steps.push({ stage: 'token-received', status: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ stage: 'token-received', status: 'error', detail: message });
      return res.status(400).json({
        message: 'Не удалось получить токен доступа',
        steps,
      });
    }

    // Step 2: Test embedding request
    steps.push({ stage: 'embedding-request', status: 'success' });
    const embeddingHeaders = new Headers();
    embeddingHeaders.set("Content-Type", "application/json");
    embeddingHeaders.set("Accept", "application/json");

    for (const [key, value] of Object.entries(payload.requestHeaders)) {
      embeddingHeaders.set(key, value);
    }

    if (!embeddingHeaders.has("Authorization")) {
      embeddingHeaders.set("Authorization", `Bearer ${accessToken}`);
    }

    const embeddingBody = {
      model: payload.model,
      input: [TEST_EMBEDDING_TEXT],
      encoding_format: "float",
    };

    try {
      const fetchOptions: RequestInit = {
        method: "POST",
        headers: embeddingHeaders,
        body: JSON.stringify(embeddingBody),
      };

      if (payload.allowSelfSignedCertificate) {
        (fetchOptions as any).agent = undefined; // For Node.js fetch
      }

      const embeddingResponse = await fetch(payload.embeddingsUrl, fetchOptions);
      const rawBody = await embeddingResponse.text();
      const parsedBody = JSON.parse(rawBody);

      if (!embeddingResponse.ok) {
        let message = `Сервис вернул статус ${embeddingResponse.status}`;
        if (parsedBody && typeof parsedBody === "object") {
          const body = parsedBody as Record<string, unknown>;
          if (typeof body.error_description === "string") {
            message = body.error_description;
          } else if (typeof body.message === "string") {
            message = body.message;
          }
        }
        steps.push({ stage: 'embedding-received', status: 'error', detail: message });
        return res.status(400).json({
          message: 'Не удалось получить вектор эмбеддингов',
          steps,
        });
      }

      const data = parsedBody.data;
      if (!Array.isArray(data) || data.length === 0) {
        steps.push({ stage: 'embedding-received', status: 'error', detail: 'Сервис не вернул данные' });
        return res.status(400).json({
          message: 'Сервис эмбеддингов не вернул данные',
          steps,
        });
      }

      const firstEntry = data[0];
      const entryRecord = firstEntry as Record<string, unknown>;
      const vector = entryRecord.embedding ?? entryRecord.vector;
      
      if (!Array.isArray(vector) || vector.length === 0) {
        steps.push({ stage: 'embedding-received', status: 'error', detail: 'Сервис не вернул числовой вектор' });
        return res.status(400).json({
          message: 'Сервис эмбеддингов не вернул числовой вектор',
          steps,
        });
      }

      steps.push({
        stage: 'embedding-received',
        status: 'success',
        detail: `Получен вектор размерностью ${vector.length}`,
      });

      res.json({
        message: 'Авторизация подтверждена',
        steps,
        vectorSize: vector.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({ stage: 'embedding-received', status: 'error', detail: message });
      return res.status(400).json({
        message: 'Не удалось получить вектор эмбеддингов',
        steps,
      });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: 'Некорректные данные',
        details: error.issues,
      });
    }
    throw error;
  }
}));
