/**
 * File Storage Routes Module
 * 
 * Handles file storage provider operations for workspace users:
 * - GET /api/file-storage/providers - List active file storage providers
 */

import { Router, type Request, type Response } from 'express';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('file-storage');

export const fileStorageRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: Request): PublicUser | null {
  return req.user as PublicUser | null;
}

function getAuthorizedUser(req: Request, res: Response): PublicUser | undefined {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return undefined;
  }
  return user;
}

function getRequestWorkspaceId(req: Request): string | null {
  const headerWorkspaceRaw = req.headers["x-workspace-id"];
  const headerWorkspaceId = Array.isArray(headerWorkspaceRaw)
    ? headerWorkspaceRaw[0]
    : typeof headerWorkspaceRaw === "string"
      ? headerWorkspaceRaw.trim()
      : undefined;

  return headerWorkspaceId ||
    req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId ||
    null;
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /providers
 * List active file storage providers for workspace
 */
fileStorageRouter.get('/providers', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const workspaceId = getRequestWorkspaceId(req);
  
  // Get all active providers
  const result = await storage.listFileStorageProviders({ activeOnly: true });
  
  // Get workspace default provider if workspace is specified
  let workspaceDefaultProvider = null;
  if (workspaceId) {
    const workspace = await storage.getWorkspace(workspaceId);
    if (workspace?.defaultFileStorageProviderId) {
      workspaceDefaultProvider = await storage.getFileStorageProvider(workspace.defaultFileStorageProviderId);
    }
  }

  res.json({
    providers: result.items,
    workspaceDefaultProvider: workspaceDefaultProvider ?? null,
  });
}));

export default fileStorageRouter;
