/**
 * Admin LLM Routes
 * 
 * Endpoints:
 * - GET /api/admin/models - List LLM models
 * - POST /api/admin/models - Create LLM model
 * - PUT /api/admin/models/:id - Update LLM model
 * - POST /api/admin/llm-providers/:id/health-check - Health check
 * - GET /api/admin/llm-debug - Get debug config
 * - POST /api/admin/llm-debug - Set debug config
 * - GET /api/admin/llm-executions - List LLM executions
 * - GET /api/admin/llm-executions/:id - Get execution details
 * - GET /api/admin/embeddings/providers - List embedding providers
 * - GET /api/admin/embeddings/providers/:providerId/models - Get provider models
 * - GET /api/admin/knowledge-base-indexing-policy
 * - PUT /api/admin/knowledge-base-indexing-policy
 * - PATCH /api/admin/knowledge-base-indexing-policy
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
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
import type { PublicUser } from '@shared/schema';

const logger = createLogger('admin-llm');

export const adminLlmRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: Request): PublicUser | null {
  return (req as Request & { user?: PublicUser }).user ?? null;
}

function getRequestWorkspace(req: Request): { id: string } | null {
  const workspaceId = req.workspaceId ||
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  return workspaceId ? { id: workspaceId } : null;
}

// ============================================================================
// Routes
// ============================================================================

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
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize)) || 20));
  const result = await storage.listLlmExecutions({ page, pageSize });
  res.json(result);
}));

/**
 * GET /llm-executions/:id
 */
adminLlmRouter.get('/llm-executions/:id', asyncHandler(async (req, res) => {
  const execution = await storage.getLlmExecution(req.params.id);
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
 * GET /embeddings/providers/:providerId/models
 */
adminLlmRouter.get('/embeddings/providers/:providerId/models', asyncHandler(async (req, res) => {
  const models = await resolveEmbeddingProviderModels(req.params.providerId);
  if (!models) {
    return res.status(404).json({ message: 'Provider not found' });
  }
  res.json({ models });
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
