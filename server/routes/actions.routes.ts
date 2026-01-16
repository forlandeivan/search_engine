/**
 * Actions Routes Module
 * 
 * Handles system actions operations:
 * - GET /api/actions/available - List available system actions
 */

import { Router, type Response } from 'express';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import { actionsRepository } from '../actions';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('actions');

export const actionsRouter = Router();

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

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /available
 * List available system actions for preview before creating skill
 */
actionsRouter.get('/available', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const systemActions = await actionsRepository.listSystemActions();
  res.json({ actions: systemActions });
}));

export default actionsRouter;
