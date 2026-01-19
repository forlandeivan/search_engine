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
adminTtsSttRouter.get('/providers', asyncHandler(async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit)) || 100));
    const offset = Math.max(0, parseInt(String(req.query.offset)) || 0);
    
    const providers = await speechProviderService.list();
    
    // Get unique admin IDs
    const adminIds = [...new Set(providers.map(p => p.updatedByAdminId).filter(Boolean))] as string[];
    const admins = await Promise.all(
      adminIds.map(async id => {
        const user = await storage.getUser(id);
        return user ? { id, email: user.email } : null;
      })
    );
    const adminMap = new Map(admins.filter(Boolean).map(admin => [admin!.id, admin!.email]));
    
    // Map backend fields to frontend expected format
    const mappedProviders = providers.map(p => ({
      id: p.id,
      name: p.displayName,
      type: p.providerType,
      direction: p.direction,
      status: p.status,
      isEnabled: p.isEnabled,
      lastUpdatedAt: p.updatedAt,
      lastStatusChangedAt: p.lastStatusChangedAt,
      updatedByAdmin: p.updatedByAdminId ? { id: p.updatedByAdminId, email: adminMap.get(p.updatedByAdminId) || null } : null,
    }));
    
    res.json({ 
      providers: mappedProviders.slice(offset, offset + limit),
      total: providers.length,
      limit,
      offset,
    });
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
    const detail = await speechProviderService.getById(req.params.id);
    if (!detail) {
      return res.status(404).json({ message: 'Provider not found' });
    }
    
    // Get admin info if available
    let adminEmail: string | null = null;
    if (detail.provider.updatedByAdminId) {
      const admin = await storage.getUser(detail.provider.updatedByAdminId);
      adminEmail = admin?.email || null;
    }
    
    // Map backend structure to frontend expected format
    const provider = {
      id: detail.provider.id,
      name: detail.provider.displayName,
      type: detail.provider.providerType,
      direction: detail.provider.direction,
      status: detail.provider.status,
      isEnabled: detail.provider.isEnabled,
      lastUpdatedAt: detail.provider.updatedAt,
      lastStatusChangedAt: detail.provider.lastStatusChangedAt,
      lastValidationAt: detail.provider.lastValidationAt,
      lastErrorCode: detail.provider.lastErrorCode,
      lastErrorMessage: detail.provider.lastErrorMessage,
      updatedByAdmin: detail.provider.updatedByAdminId ? { id: detail.provider.updatedByAdminId, email: adminEmail } : null,
      config: detail.config,
      secrets: detail.secrets,
    };
    
    res.json({ provider });
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
    res.json({ secrets });
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
    const detail = await speechProviderService.update(req.params.id, req.body);
    
    // Get admin info if available
    let adminEmail: string | null = null;
    if (detail.provider.updatedByAdminId) {
      const admin = await storage.getUser(detail.provider.updatedByAdminId);
      adminEmail = admin?.email || null;
    }
    
    // Map backend structure to frontend expected format
    const provider = {
      id: detail.provider.id,
      name: detail.provider.displayName,
      type: detail.provider.providerType,
      direction: detail.provider.direction,
      status: detail.provider.status,
      isEnabled: detail.provider.isEnabled,
      lastUpdatedAt: detail.provider.updatedAt,
      lastStatusChangedAt: detail.provider.lastStatusChangedAt,
      lastValidationAt: detail.provider.lastValidationAt,
      lastErrorCode: detail.provider.lastErrorCode,
      lastErrorMessage: detail.provider.lastErrorMessage,
      updatedByAdmin: detail.provider.updatedByAdminId ? { id: detail.provider.updatedByAdminId, email: adminEmail } : null,
      config: detail.config,
      secrets: detail.secrets,
    };
    
    res.json({ provider });
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
