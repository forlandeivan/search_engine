/**
 * Cards Routes Module
 * 
 * Handles card operations:
 * - GET /api/cards/:cardId - Get card by ID
 */

import { Router, type Response } from 'express';
import { storage } from '../storage';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { getCardById } from '../card-service';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('cards');

export const cardsRouter = Router();

// ============================================================================
// Helper Functions
// ============================================================================

function getSessionUser(req: any): PublicUser | null {
  return req.user as PublicUser | null;
}

function getAuthorizedUser(req: any, res: Response): PublicUser | null {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: 'Требуется авторизация' });
    return null;
  }
  return user;
}

function pickFirstString(...values: unknown[]): string | undefined {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return undefined;
}

function getRequestWorkspace(req: any): { id: string } {
  const workspaceId = req.workspaceId ||
    req.workspaceContext?.workspaceId ||
    req.params.workspaceId ||
    req.session?.workspaceId ||
    req.session?.activeWorkspaceId;
  if (!workspaceId) {
    throw new Error('Workspace not found in request');
  }
  return { id: workspaceId };
}

function resolveWorkspaceIdForRequest(req: any, explicitId: string | null | undefined): string {
  if (explicitId && explicitId.trim().length > 0) {
    return explicitId.trim();
  }
  return getRequestWorkspace(req).id;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /:cardId
 * Get card by ID
 */
cardsRouter.get('/:cardId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const workspaceCandidate = pickFirstString(req.query.workspaceId, req.query.workspace_id);
  const workspaceId = resolveWorkspaceIdForRequest(req, workspaceCandidate);
  
  const isMember = await storage.isWorkspaceMember(workspaceId, user.id);
  if (!isMember) {
    return res.status(403).json({ message: 'Нет доступа к этому workspace' });
  }

  const card = await getCardById(req.params.cardId, workspaceId);
  if (!card) {
    return res.status(404).json({ message: 'Карточка не найдена' });
  }

  res.json({ card });
}));

// Error handler for this router
cardsRouter.use((err: Error, req: any, res: Response, next: any) => {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message });
  }
  next(err);
});

export default cardsRouter;
