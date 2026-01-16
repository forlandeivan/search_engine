/**
 * Admin TTS/STT Routes
 * 
 * Endpoints:
 * - GET /api/admin/tts-stt/providers - List providers
 * - GET /api/admin/tts-stt/providers/:id - Get provider
 * - GET /api/admin/tts-stt/providers/:id/secrets - Get provider secrets
 * - PATCH /api/admin/tts-stt/providers/:id - Update provider
 * - POST /api/admin/tts-stt/providers/:id/test-iam-token - Test IAM token
 * - GET /api/admin/asr-executions - List ASR executions
 * - GET /api/admin/asr-executions/:id - Get execution details
 */

import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import { speechProviderService, SpeechProviderServiceError } from '../../speech-provider-service';

const logger = createLogger('admin-tts-stt');

export const adminTtsSttRouter = Router();

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /providers
 */
adminTtsSttRouter.get('/providers', asyncHandler(async (_req, res) => {
  try {
    const providers = await speechProviderService.list();
    res.json({ providers });
  } catch (error) {
    if (error instanceof SpeechProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /providers/:id
 */
adminTtsSttRouter.get('/providers/:id', asyncHandler(async (req, res) => {
  try {
    const provider = await speechProviderService.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ message: 'Provider not found' });
    }
    res.json(provider);
  } catch (error) {
    if (error instanceof SpeechProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /providers/:id/secrets
 */
adminTtsSttRouter.get('/providers/:id/secrets', asyncHandler(async (req, res) => {
  try {
    const secrets = await speechProviderService.getSecrets(req.params.id);
    res.json(secrets);
  } catch (error) {
    if (error instanceof SpeechProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PATCH /providers/:id
 */
adminTtsSttRouter.patch('/providers/:id', asyncHandler(async (req, res) => {
  try {
    const provider = await speechProviderService.update(req.params.id, req.body);
    res.json(provider);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid provider data', details: error.issues });
    }
    if (error instanceof SpeechProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * POST /providers/:id/test-iam-token
 */
adminTtsSttRouter.post('/providers/:id/test-iam-token', asyncHandler(async (req, res) => {
  try {
    const result = await speechProviderService.testIamToken(req.params.id);
    res.json(result);
  } catch (error) {
    if (error instanceof SpeechProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /asr-executions
 */
adminTtsSttRouter.get('/asr-executions', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize)) || 20));
  const result = await storage.listAsrExecutions({ page, pageSize });
  res.json(result);
}));

/**
 * GET /asr-executions/:id
 */
adminTtsSttRouter.get('/asr-executions/:id', asyncHandler(async (req, res) => {
  const execution = await storage.getAsrExecution(req.params.id);
  if (!execution) {
    return res.status(404).json({ message: 'Execution not found' });
  }
  res.json(execution);
}));

export default adminTtsSttRouter;
