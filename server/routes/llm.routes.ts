/**
 * LLM Routes Module
 * 
 * Handles LLM providers:
 * - GET /api/llm/providers - List LLM providers
 */

import { Router, type Request, type Response } from 'express';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { storage } from '../storage';
import type { PublicUser } from '@shared/schema';

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
