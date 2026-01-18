/**
 * Models Routes Module
 * 
 * Handles public models catalog:
 * - GET /api/models - List models by type
 */

import { Router, type Request, type Response } from 'express';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { listModels } from '../model-service';
import type { PublicUser } from '@shared/schema';
import type { ModelType } from '../model-service';

const logger = createLogger('models');

export const modelsRouter = Router();

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
 * GET /
 * List models by type
 */
modelsRouter.get('/', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const type = typeof req.query.type === 'string' ? req.query.type.toUpperCase() : undefined;
  const validTypes: ModelType[] = ['LLM', 'EMBEDDINGS', 'ASR'];
  const modelType = type && validTypes.includes(type as ModelType) ? (type as ModelType) : undefined;

  const providerId = typeof req.query.providerId === 'string' ? req.query.providerId : undefined;
  const providerType = typeof req.query.providerType === 'string' ? req.query.providerType : undefined;

  const models = await listModels({
    includeInactive: false,
    type: modelType,
    providerId: providerId ?? null,
    providerType: providerType ?? null,
  });

  // Map to public format
  const publicModels = models.map(model => ({
    id: model.id,
    key: model.modelKey,
    displayName: model.displayName,
    description: model.description,
    modelType: model.modelType,
    consumptionUnit: model.consumptionUnit,
    costLevel: model.costLevel,
    providerId: model.providerId,
    providerType: model.providerType,
    providerModelKey: model.providerModelKey,
  }));

  res.json({ models: publicModels });
}));
