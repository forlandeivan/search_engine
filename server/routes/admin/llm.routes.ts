/**
 * Admin LLM Routes
 * 
 * Endpoints:
 * - GET /api/admin/llm-providers - List LLM providers
 * - POST /api/admin/llm-providers - Create LLM provider
 * - PUT /api/admin/llm-providers/:id - Update LLM provider
 * - DELETE /api/admin/llm-providers/:id - Delete LLM provider
 * - GET /api/admin/models - List LLM models
 * - POST /api/admin/models - Create LLM model
 * - PUT /api/admin/models/:id - Update LLM model
 * - POST /api/admin/llm-providers/:id/health-check - Health check
 * - GET /api/admin/llm-debug - Get debug config
 * - POST /api/admin/llm-debug - Set debug config
 * - GET /api/admin/llm-executions - List LLM executions
 * - GET /api/admin/llm-executions/:id - Get execution details
 * - GET /api/admin/embeddings/providers - List embedding providers (для админских форм)
 * - POST /api/admin/embeddings/providers - Create embedding provider
 * - PUT /api/admin/embeddings/providers/:id - Update embedding provider
 * - GET /api/admin/embeddings/providers/:providerId/models - Get provider models
 * 
 * Note: DELETE для embeddings providers находится в /api/embedding/services/:id
 * - GET /api/admin/knowledge-base-indexing-policy
 * - PUT /api/admin/knowledge-base-indexing-policy
 * - PATCH /api/admin/knowledge-base-indexing-policy
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import { listAdminSkillExecutions, getAdminSkillExecutionDetail } from '../../admin-skill-executions';
import { 
  listModels, 
  createModel, 
  updateModel,
  ModelValidationError,
  ModelUnavailableError,
  ModelInactiveError,
} from '../../model-service';
import { 
  getLlmPromptDebugConfig, 
  setLlmPromptDebugEnabled 
} from '../../llm-debug-config';
import { 
  listEmbeddingProvidersWithStatus,
  resolveEmbeddingProviderModels,
} from '../../embedding-provider-registry';
import {
  knowledgeBaseIndexingPolicyService,
  KnowledgeBaseIndexingPolicyError,
  KnowledgeBaseIndexingPolicyDomainError,
} from '../../knowledge-base-indexing-policy';
import {
  knowledgeBaseIndexingPolicySchema,
  updateKnowledgeBaseIndexingPolicySchema,
} from '@shared/knowledge-base-indexing-policy';
import type { PublicUser, LlmProviderInsert, UpdateLlmProvider } from '@shared/schema';
import { updateLlmProviderSchema } from '@shared/schema';

const logger = createLogger('admin-llm');

export const adminLlmRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

const adminLlmExecutionStatusSchema = z.enum(["pending", "running", "success", "error", "timeout", "cancelled"]);
const adminLlmExecutionsQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  workspaceId: z.string().uuid().optional(),
  skillId: z.string().uuid().optional(),
  userId: z.string().optional(),
  status: adminLlmExecutionStatusSchema.optional(),
  hasError: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function parseDate(value?: string) {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function getSessionUser(req: Request): PublicUser | null {
  return (req as Request & { user?: PublicUser }).user ?? null;
}

function getRequestWorkspace(req: Request): { id: string } | null {
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
  return workspaceId ? { id: String(workspaceId) } : null;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /llm-providers
 * List all LLM providers (admin view)
 */
adminLlmRouter.get('/llm-providers', asyncHandler(async (_req, res) => {
  const providers = await storage.listLlmProviders();
  res.json({ providers });
}));

/**
 * POST /llm-providers
 * Create new LLM provider
 */
adminLlmRouter.post('/llm-providers', asyncHandler(async (req, res) => {
  try {
    const provider = await storage.createLlmProvider(req.body as LlmProviderInsert);
    res.status(201).json({ provider });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid provider data', details: error.issues });
    }
    throw error;
  }
}));

/**
 * PUT /llm-providers/:id
 * Update LLM provider
 */
adminLlmRouter.put('/llm-providers/:id', asyncHandler(async (req, res) => {
  const providerId = req.params.id;
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
  if (payload.requestConfig !== undefined) updates.requestConfig = payload.requestConfig as any;
  if (payload.responseConfig !== undefined) updates.responseConfig = payload.responseConfig as any;
  
  const provider = await storage.updateLlmProvider(providerId, updates);
  
  if (!provider) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  
  res.json({ provider });
}));

/**
 * DELETE /llm-providers/:id
 * Delete LLM provider
 * Проверяет, что нет активных моделей, привязанных к провайдеру
 */
adminLlmRouter.delete('/llm-providers/:id', asyncHandler(async (req, res) => {
  const providerId = req.params.id;
  
  // Проверяем, есть ли активные модели для этого провайдера
  const activeModels = await listModels({ 
    providerId, 
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
  
  const deleted = await storage.deleteLlmProvider(providerId);
  
  if (!deleted) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  
  res.status(204).send();
}));

/**
 * GET /models
 */
adminLlmRouter.get('/models', asyncHandler(async (_req, res) => {
  const models = await listModels();
  res.json({ models });
}));

/**
 * POST /models
 */
adminLlmRouter.post('/models', asyncHandler(async (req, res) => {
  try {
    const model = await createModel(req.body);
    res.status(201).json(model);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid model data', details: error.issues });
    }
    if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
      return res.status(error.status || 400).json({ message: error.message, code: error.code });
    }
    throw error;
  }
}));

/**
 * PUT /models/:id
 */
adminLlmRouter.put('/models/:id', asyncHandler(async (req, res) => {
  try {
    const model = await updateModel(req.params.id, req.body);
    res.json(model);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid model data', details: error.issues });
    }
    if (error instanceof ModelValidationError || error instanceof ModelUnavailableError || error instanceof ModelInactiveError) {
      return res.status(error.status || 400).json({ message: error.message, code: error.code });
    }
    throw error;
  }
}));

// NOTE: POST /llm-providers/:id/health-check remains in routes.ts
// because it uses checkLlmProviderHealth which is defined locally there

/**
 * GET /llm-debug
 */
adminLlmRouter.get('/llm-debug', asyncHandler(async (_req, res) => {
  res.json(getLlmPromptDebugConfig());
}));

/**
 * POST /llm-debug
 */
adminLlmRouter.post('/llm-debug', asyncHandler(async (req, res) => {
  try {
    const enabled = typeof req.body?.enabled === 'boolean' ? req.body.enabled : false;
    setLlmPromptDebugEnabled(enabled);
    res.json(getLlmPromptDebugConfig());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid config', details: error.issues });
    }
    throw error;
  }
}));

/**
 * GET /llm-executions
 */
adminLlmRouter.get('/llm-executions', asyncHandler(async (req, res) => {
  const query = adminLlmExecutionsQuerySchema.parse(req.query);
  const result = await listAdminSkillExecutions({
    from: parseDate(query.from),
    to: parseDate(query.to),
    workspaceId: query.workspaceId,
    skillId: query.skillId,
    userId: query.userId,
    status: query.status,
    hasError: query.hasError,
    page: query.page,
    pageSize: query.pageSize,
  });
  res.json(result);
}));

/**
 * GET /llm-executions/:id
 */
adminLlmRouter.get('/llm-executions/:id', asyncHandler(async (req, res) => {
  const execution = await getAdminSkillExecutionDetail(req.params.id);
  if (!execution) {
    return res.status(404).json({ message: 'Execution not found' });
  }
  res.json(execution);
}));

/**
 * GET /embeddings/providers
 */
adminLlmRouter.get('/embeddings/providers', asyncHandler(async (_req, res) => {
  const providers = await listEmbeddingProvidersWithStatus();
  res.json({ providers });
}));

/**
 * POST /embeddings/providers
 * Create embedding provider
 */
adminLlmRouter.post('/embeddings/providers', asyncHandler(async (req, res) => {
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
 * PUT /embeddings/providers/:id
 * Update embedding provider
 */
adminLlmRouter.put('/embeddings/providers/:id', asyncHandler(async (req, res) => {
  const providerId = req.params.id;
  const provider = await storage.updateEmbeddingProvider(providerId, req.body);
  
  if (!provider) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  
  res.json({ provider });
}));

/**
 * DELETE /embeddings/providers/:id
 * Delete embedding provider
 * УДАЛЕНО: теперь используется /api/embedding/services/:id в embedding.routes.ts
 * Оставлен комментарий для истории.
 */
// adminLlmRouter.delete('/embeddings/providers/:id', ...) - УДАЛЕНО
// Используйте DELETE /api/embedding/services/:id вместо этого

/**
 * GET /embeddings/providers/:providerId/models
 */
adminLlmRouter.get('/embeddings/providers/:providerId/models', asyncHandler(async (req, res) => {
  const modelsInfo = await resolveEmbeddingProviderModels(req.params.providerId);
  if (!modelsInfo) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  res.json(modelsInfo);
}));

/**
 * GET /knowledge-base-indexing-policy
 */
adminLlmRouter.get('/knowledge-base-indexing-policy', asyncHandler(async (_req, res) => {
  const policy = await knowledgeBaseIndexingPolicyService.get();
  res.json(policy);
}));

/**
 * PUT /knowledge-base-indexing-policy
 */
adminLlmRouter.put('/knowledge-base-indexing-policy', asyncHandler(async (req, res) => {
  try {
    const parsed = knowledgeBaseIndexingPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid knowledge base indexing policy',
        code: 'KNOWLEDGE_BASE_INDEXING_POLICY_INVALID',
        details: parsed.error.format(),
      });
    }

    const admin = getSessionUser(req);
    if (!admin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const workspace = getRequestWorkspace(req);
    const updated = await knowledgeBaseIndexingPolicyService.update(parsed.data, admin.id, workspace?.id);
    res.json(updated);
  } catch (error) {
    if (error instanceof KnowledgeBaseIndexingPolicyDomainError) {
      return res.status(error.status || 400).json({
        message: error.message,
        code: error.code,
        field: error.field ?? 'embeddings_provider',
      });
    }
    if (error instanceof KnowledgeBaseIndexingPolicyError) {
      return res.status(error.status || 400).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PATCH /knowledge-base-indexing-policy
 */
adminLlmRouter.patch('/knowledge-base-indexing-policy', asyncHandler(async (req, res) => {
  try {
    const parsed = updateKnowledgeBaseIndexingPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Invalid knowledge base indexing policy update',
        code: 'KNOWLEDGE_BASE_INDEXING_POLICY_INVALID',
        details: parsed.error.format(),
      });
    }

    const admin = getSessionUser(req);
    if (!admin) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const workspace = getRequestWorkspace(req);
    const updated = await knowledgeBaseIndexingPolicyService.update(parsed.data, admin.id, workspace?.id);
    res.json(updated);
  } catch (error) {
    if (error instanceof KnowledgeBaseIndexingPolicyDomainError) {
      return res.status(error.status || 400).json({
        message: error.message,
        code: error.code,
        field: error.field ?? 'embeddings_provider',
      });
    }
    if (error instanceof KnowledgeBaseIndexingPolicyError) {
      return res.status(error.status || 400).json({ message: error.message });
    }
    throw error;
  }
}));

export default adminLlmRouter;
