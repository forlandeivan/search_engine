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
import { listModels, syncModelsWithEmbeddingProvider } from '../model-service';
import { storage } from '../storage';
import type { PublicUser, EmbeddingProvider, PublicEmbeddingProvider, EmbeddingProviderType } from '@shared/schema';
import { embeddingProviderTypes } from '@shared/schema';

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
  
  // Преобразуем в PublicEmbeddingProvider (скрываем authorizationKey и гарантируем наличие availableModels)
  const publicProviders: PublicEmbeddingProvider[] = fullProviders.map(provider => {
    const { authorizationKey, availableModels, ...rest } = provider;
    return {
      ...rest,
      availableModels: Array.isArray(availableModels) ? availableModels : [],
      hasAuthorizationKey: typeof authorizationKey === 'string' && authorizationKey.trim().length > 0,
    };
  });
  
  res.json({ providers: publicProviders });
}));

/**
 * POST /services/test-credentials
 * Test embedding provider credentials
 * NOTE: This must be before /services/:id routes to avoid route conflicts
 */
embeddingRouter.post('/services/test-credentials', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const testSchema = z.object({
    providerType: z.enum(embeddingProviderTypes).default("gigachat"),
    tokenUrl: z.string().trim().url("Некорректный URL для получения токена").or(z.literal("")),
    embeddingsUrl: z.string().trim().url("Некорректный URL сервиса эмбеддингов"),
    authorizationKey: z.string().trim().min(1, "Укажите Authorization key"),
    scope: z.string().trim().min(1, "Укажите OAuth scope").or(z.literal("")),
    model: z.string().trim().min(1, "Укажите модель эмбеддингов"),
    allowSelfSignedCertificate: z.boolean().default(false),
    requestHeaders: z.record(z.string(), z.string()).default({}),
    workSpaceId: z.string().trim().optional(),
    truncate: z.boolean().optional(),
    dimensions: z.number().int().positive().optional(),
    testText: z.string().trim().min(1, "Введите текст для тестирования").max(1000, "Текст слишком длинный").optional(),
  }).refine(
    (data) => {
      if (data.providerType === "unica") {
        return true;
      }
      return data.tokenUrl && data.tokenUrl.trim().length > 0;
    },
    { message: "Укажите URL для получения токена", path: ["tokenUrl"] }
  ).refine(
    (data) => {
      if (data.providerType === "unica") {
        return true;
      }
      return data.scope && data.scope.trim().length > 0;
    },
    { message: "Укажите OAuth scope", path: ["scope"] }
  );

  const payload = testSchema.parse(req.body);
  const embeddingText = payload.testText?.trim() || "привет!";

  const steps: Array<{
    stage: string;
    status: 'success' | 'error';
    detail?: string;
  }> = [];

  try {
    // Step 1: Fetch access token
    let accessToken: string;

    if (payload.providerType === "unica") {
      accessToken = payload.authorizationKey;
      steps.push({
        stage: "token-request",
        status: "success",
        detail: "API-ключ используется напрямую (без OAuth)",
      });
      steps.push({
        stage: "token-received",
        status: "success",
        detail: "OAuth не требуется для Unica AI",
      });
    } else {
      steps.push({ stage: "token-request", status: "success" });
      const provider: EmbeddingProvider = {
        id: "test",
        name: "Test Provider",
        providerType: payload.providerType as EmbeddingProviderType,
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

      try {
        accessToken = await fetchAccessToken(provider);
        steps.push({ stage: "token-received", status: "success" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        steps.push({ stage: "token-received", status: "error", detail: message });
        return res.status(400).json({
          message: "Не удалось получить токен доступа",
          steps,
        });
      }
    }

    // Step 2: Test embedding request
    steps.push({ stage: "embedding-request", status: "success" });
    const embeddingHeaders = new Headers();
    embeddingHeaders.set("Content-Type", "application/json");
    embeddingHeaders.set("Accept", "application/json");

    for (const [key, value] of Object.entries(payload.requestHeaders)) {
      embeddingHeaders.set(key, value);
    }

    if (!embeddingHeaders.has("Authorization")) {
      embeddingHeaders.set("Authorization", `Bearer ${accessToken}`);
    }

    const embeddingBody =
      payload.providerType === "unica"
        ? {
            input: [embeddingText],
            model: payload.model,
          }
        : {
            model: payload.model,
            input: [embeddingText],
            encoding_format: "float",
          };

    const embeddingResponse = await fetch(payload.embeddingsUrl, {
      method: "POST",
      headers: embeddingHeaders,
      body: JSON.stringify(embeddingBody),
      ...(payload.allowSelfSignedCertificate ? { agent: undefined } : {}),
    });

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text();
      steps.push({
        stage: "embedding-response",
        status: "error",
        detail: `HTTP ${embeddingResponse.status}: ${errorText}`,
      });
      return res.status(400).json({
        message: "Сервис эмбеддингов вернул ошибку",
        steps,
      });
    }

    const embeddingData = (await embeddingResponse.json()) as {
      data?: Array<{ embedding: number[]; index?: number }>;
      usage?: { total_tokens?: number };
    };

    if (!embeddingData.data || embeddingData.data.length === 0) {
      steps.push({
        stage: "embedding-response",
        status: "error",
        detail: "Пустой массив data в ответе",
      });
      return res.status(400).json({
        message: "Сервис эмбеддингов вернул пустой результат",
        steps,
      });
    }

    const firstEmbedding = embeddingData.data[0].embedding;
    const vectorSize = firstEmbedding.length;
    const vectorPreview = firstEmbedding.slice(0, 10);
    const usageTokens = embeddingData.usage?.total_tokens;

    steps.push({
      stage: "embedding-response",
      status: "success",
      detail: `Получен вектор размерностью ${vectorSize}`,
    });

    res.json({
      message: "Авторизация подтверждена, эмбеддинги успешно получены",
      steps,
      testText: embeddingText,
      vectorSize,
      vectorPreview,
      usageTokens,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[embedding test] Unexpected error: ${message}`);
    steps.push({
      stage: "embedding-request",
      status: "error",
      detail: message,
    });
    res.status(500).json({
      message: "Ошибка при проверке credentials",
      steps,
    });
  }
}));

/**
 * GET /services/:id/key
 * Get authorization key for embedding provider (only for admins)
 * NOTE: This must be before other /services/:id routes to avoid route conflicts
 */
embeddingRouter.get('/services/:id/key', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  // Проверка прав администратора
  if (user.role !== 'admin') {
    return res.status(403).json({ message: 'Недостаточно прав для просмотра ключей' });
  }

  const providerId = req.params.id;
  const provider = await storage.getEmbeddingProvider(providerId);
  
  if (!provider) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  
  res.json({ authorizationKey: provider.authorizationKey || '' });
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
    
    // Sync models with catalog
    await syncModelsWithEmbeddingProvider(provider);
    
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
  
  // Sync models with catalog
  await syncModelsWithEmbeddingProvider(provider);
  
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
