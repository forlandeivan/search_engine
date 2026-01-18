/**
 * Embedding Routes Module
 * 
 * Handles embedding services/providers management:
 * - GET /api/embedding/services - List embedding providers
 */

import { Router, type Request, type Response } from 'express';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { listEmbeddingProvidersWithStatus } from '../embedding-provider-registry';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('embedding');

// Create router instance
export const embeddingRouter = Router();

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
  const providers = await listEmbeddingProvidersWithStatus(workspaceId);
  res.json({ providers });
}));
