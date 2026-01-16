/**
 * Transcribe Routes Module
 * 
 * Handles speech-to-text transcription operations:
 * - GET /api/chat/transcribe/operations/:operationId - Get transcription operation status
 * - GET /api/chat/transcribe/status - Check transcription service health
 * 
 * Note: POST /api/chat/transcribe/complete/:operationId remains in routes.ts
 * due to complex dependencies (skill actions, canvas documents, chat messages)
 */

import { Router, type Response } from 'express';
import { createLogger } from '../lib/logger';
import { asyncHandler } from '../middleware/async-handler';
import {
  yandexSttService,
  yandexSttAsyncService,
  YandexSttAsyncError,
} from '../yandex-speechkit';
import type { PublicUser } from '@shared/schema';

const logger = createLogger('transcribe');

export const transcribeRouter = Router();

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
 * GET /operations/:operationId
 * Get transcription operation status
 */
transcribeRouter.get('/operations/:operationId', asyncHandler(async (req, res) => {
  const user = getAuthorizedUser(req, res);
  if (!user) return;

  const { operationId } = req.params;
  if (!operationId || !operationId.trim()) {
    return res.status(400).json({ message: 'ID операции не предоставлен' });
  }

  try {
    const status = await yandexSttAsyncService.getOperationStatus(user.id, operationId);
    res.json(status);
  } catch (error) {
    logger.error({ userId: user.id, operationId, error }, 'Error getting transcribe operation status');
    
    if (error instanceof YandexSttAsyncError) {
      return res.status(error.status).json({ message: error.message, code: error.code });
    }
    throw error;
  }
}));

/**
 * GET /status
 * Check transcription service health
 */
transcribeRouter.get('/status', asyncHandler(async (_req, res) => {
  const health = await yandexSttService.checkHealth();
  res.json(health);
}));

export default transcribeRouter;
