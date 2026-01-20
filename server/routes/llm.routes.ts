/**
 * LLM Routes Module
 * 
 * Handles LLM providers:
 * - GET /api/llm/providers - List LLM providers
 * - PUT /api/llm/providers/:providerId - Update LLM provider
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { storage } from '../storage';
import { updateLlmProviderSchema, type PublicUser } from '@shared/schema';
import { createExpressionInterpreter } from '../services/expression-interpreter';
import type { MappingExpression } from '@shared/json-import';

const logger = createLogger('llm');

export const llmRouter = Router();

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

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /providers
 * List LLM providers
 */
llmRouter.get('/providers', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

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
    req.query.workspaceId ||
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;

  const providers = await storage.listLlmProviders(workspaceId);

  // Map to public format
  const publicProviders = providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    providerType: provider.providerType,
    model: provider.model,
    isActive: provider.isActive,
  }));

  res.json({ providers: publicProviders });
}));

/**
 * PUT /providers/:providerId
 * Update LLM provider configuration
 */
llmRouter.put('/providers/:providerId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const providerId = req.params.providerId;
  
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
    req.query.workspaceId ||
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;

  const payload = updateLlmProviderSchema.parse(req.body ?? {});
  
  // Trim and sanitize arrays
  const updates: Parameters<typeof storage.updateLlmProvider>[1] = {};
  
  if (payload.model !== undefined) {
    updates.model = payload.model.trim();
  }
  
  if (payload.availableModels !== undefined) {
    updates.availableModels = payload.availableModels.map(m => ({
      label: m.label.trim(),
      value: m.value.trim(),
    }));
  }
  
  if (payload.name !== undefined) updates.name = payload.name;
  if (payload.description !== undefined) updates.description = payload.description;
  if (payload.isActive !== undefined) updates.isActive = payload.isActive;
  if (payload.isGlobal !== undefined) updates.isGlobal = payload.isGlobal;
  if (payload.tokenUrl !== undefined) updates.tokenUrl = payload.tokenUrl;
  if (payload.completionUrl !== undefined) updates.completionUrl = payload.completionUrl;
  if (payload.authorizationKey !== undefined) updates.authorizationKey = payload.authorizationKey;
  if (payload.scope !== undefined) updates.scope = payload.scope;
  if (payload.requestHeaders !== undefined) updates.requestHeaders = payload.requestHeaders;
  if (payload.requestConfig !== undefined) updates.requestConfig = payload.requestConfig;
  if (payload.responseConfig !== undefined) updates.responseConfig = payload.responseConfig;
  
  const provider = await storage.updateLlmProvider(providerId, updates, workspaceId);
  
  if (!provider) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  
  res.json({ provider });
}));

/**
 * POST /test-expression
 * Тестовая генерация LLM для preview маппинга
 */
const testExpressionSchema = z.object({
  workspaceId: z.string().min(1),
  prompt: z.array(z.any()).min(1, "Промпт не может быть пустым"),
  sampleRecord: z.record(z.unknown()),
  temperature: z.number().min(0).max(1).optional(),
});

llmRouter.post('/test-expression', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const body = testExpressionSchema.parse(req.body);
  const { workspaceId, prompt, sampleRecord, temperature } = body;

  // Проверяем доступ к workspace
  const workspace = await storage.getWorkspace(workspaceId);
  if (!workspace) {
    return res.status(404).json({ success: false, error: 'Workspace not found' });
  }

  try {
    // Создаём интерпретатор
    const interpreter = createExpressionInterpreter(workspaceId);

    // Создаём LLM токен для тестирования
    const testToken = {
      type: 'llm' as const,
      value: 'test',
      llmConfig: {
        prompt: prompt as MappingExpression,
        temperature: temperature ?? 0.3,
      },
    };

    // Выполняем генерацию
    const startTime = Date.now();
    const result = await interpreter.evaluate([testToken], sampleRecord);
    const duration = Date.now() - startTime;

    if (result.success) {
      return res.json({
        success: true,
        result: result.value,
        duration,
      });
    } else {
      return res.json({
        success: false,
        error: result.errors?.join("; ") || "Ошибка генерации",
        result: result.value || null,
        duration,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка";
    return res.status(500).json({
      success: false,
      error: message,
    });
  }
}));

// Error handler for this router
llmRouter.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ message: 'Неверные данные', details: err.issues });
  }
  next(err);
});
