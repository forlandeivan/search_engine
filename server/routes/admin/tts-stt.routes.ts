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
import { sql } from 'drizzle-orm';
import { storage } from '../../storage';
import { speechProviders } from '../../../shared/schema';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import { speechProviderService, SpeechProviderServiceError } from '../../speech-provider-service';
import { normalizeUnicaApiBaseUrl } from '../../unica-asr-service';

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
    const adminId = (req as any).user?.id ?? null;
    const detail = await speechProviderService.update(req.params.id, req.body, adminId);
    
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

// ============================================================================
// ASR Providers Management
// ============================================================================

/**
 * GET /asr-providers
 * List all ASR providers (STT providers)
 */
adminTtsSttRouter.get('/asr-providers', asyncHandler(async (req, res) => {
  try {
    const providers = await speechProviderService.list();
    
    // Filter only STT providers (ASR)
    const asrProviders = providers.filter(p => p.providerType === 'stt');
    
    // Get unique admin IDs
    const adminIds = [...new Set(asrProviders.map(p => p.updatedByAdminId).filter(Boolean))] as string[];
    const admins = await Promise.all(
      adminIds.map(async id => {
        const user = await storage.getUser(id);
        return user ? { id, email: user.email } : null;
      })
    );
    const adminMap = new Map(admins.filter(Boolean).map(admin => [admin!.id, admin!.email]));
    
    // Get full provider details including config
    const detailedProviders = await Promise.all(
      asrProviders.map(async (p) => {
        const detail = await speechProviderService.getById(p.id);
        return {
          id: p.id,
          displayName: detail.provider.displayName,
          providerType: detail.provider.providerType,
          asrProviderType: detail.provider.asrProviderType || 'yandex',
          isEnabled: p.isEnabled,
          isDefaultAsr: detail.provider.isDefaultAsr ?? false,
          status: p.status,
          config: detail.config,
          createdAt: detail.provider.createdAt,
          updatedAt: p.updatedAt,
          updatedByAdmin: p.updatedByAdminId ? { id: p.updatedByAdminId, email: adminMap.get(p.updatedByAdminId) || null } : null,
        };
      })
    );
    
    res.json({ providers: detailedProviders });
  } catch (error) {
    if (error instanceof SpeechProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /asr-providers/:id
 * Get specific ASR provider details
 */
adminTtsSttRouter.get('/asr-providers/:id', asyncHandler(async (req, res) => {
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
    
    res.json({
      id: detail.provider.id,
      displayName: detail.provider.displayName,
      asrProviderType: detail.provider.asrProviderType || 'yandex',
      isEnabled: detail.provider.isEnabled,
      status: detail.provider.status,
      config: detail.config,
      secrets: detail.secrets,
      createdAt: detail.provider.createdAt,
      updatedAt: detail.provider.updatedAt,
      updatedByAdmin: detail.provider.updatedByAdminId ? { id: detail.provider.updatedByAdminId, email: adminEmail } : null,
    });
  } catch (error) {
    if (error instanceof SpeechProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * POST /asr-providers
 * Create new Unica ASR provider
 */
const createUnicaAsrProviderSchema = z.object({
  displayName: z.string().min(1, 'Укажите название'),
  config: z.object({
    baseUrl: z.string().url('Некорректный Base URL'),
    workspaceId: z.string().min(1, 'Укажите Workspace ID'),
    pollingIntervalMs: z.number().min(1000).max(60000).optional(),
    timeoutMs: z.number().min(60000).max(7200000).optional(),
    fileStorageProviderId: z.string().min(1).optional(),
  }),
});

adminTtsSttRouter.post('/asr-providers', asyncHandler(async (req, res) => {
  const validation = createUnicaAsrProviderSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: validation.error.errors,
    });
  }

  const { displayName, config } = validation.data;

  try {
    const provider = await speechProviderService.createUnicaProvider(displayName, config);
    
    return res.status(201).json({
      id: provider.id,
      displayName: provider.displayName,
      asrProviderType: 'unica',
      message: 'Provider created successfully',
    });
  } catch (error) {
    logger.error({ error }, 'Failed to create Unica ASR provider');
    return res.status(500).json({
      error: 'Failed to create provider',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * PATCH /asr-providers/:id
 * Update ASR provider
 */
const updateAsrProviderSchema = z.object({
  displayName: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
  isDefaultAsr: z.boolean().optional(),
  config: z.object({
    baseUrl: z.string().url().optional(),
    workspaceId: z.string().min(1).optional(),
    pollingIntervalMs: z.number().min(1000).max(60000).optional(),
    timeoutMs: z.number().min(60000).max(7200000).optional(),
    fileStorageProviderId: z.string().min(1).nullable().optional(),
  }).optional(),
});

adminTtsSttRouter.patch('/asr-providers/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const adminId = (req as any).user?.id ?? null;

  // Check provider exists
  const existing = await speechProviderService.getById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const validation = updateAsrProviderSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: 'Validation error',
      details: validation.error.errors,
    });
  }

  try {
    // Prepare update payload
    const updatePayload: any = {};
    
    if (validation.data.isEnabled !== undefined) {
      updatePayload.isEnabled = validation.data.isEnabled;
    }
    
    // Handle isDefaultAsr toggle - ensure only one default at a time
    if (validation.data.isDefaultAsr !== undefined) {
      if (validation.data.isDefaultAsr === true) {
        // Unset all other defaults first
        await storage.db
          .update(speechProviders)
          .set({ isDefaultAsr: false })
          .where(sql`asr_provider_type IS NOT NULL`);
      }

      // Set current provider default flag explicitly (SpeechProviderService.update ignores unknown fields)
      await storage.updateSpeechProvider(id, { isDefaultAsr: validation.data.isDefaultAsr });
    }
    
    if (validation.data.config) {
      // Merge with existing config
      updatePayload.config = {
        ...existing.config,
        ...validation.data.config,
      };

      // If client explicitly clears optional fields with null, remove them from config JSON.
      if (updatePayload.config.fileStorageProviderId === null) {
        delete updatePayload.config.fileStorageProviderId;
      }
    }
    
    if (validation.data.displayName) {
      // Update displayName through storage
      await storage.updateSpeechProvider(id, {
        displayName: validation.data.displayName,
      });
    }
    
    const updated = await speechProviderService.update(id, updatePayload, adminId);
    
    return res.json({
      id: updated.provider.id,
      displayName: updated.provider.displayName,
      isEnabled: updated.provider.isEnabled,
      isDefaultAsr: updated.provider.isDefaultAsr,
      message: 'Provider updated successfully',
    });
  } catch (error) {
    logger.error({ error, providerId: id }, 'Failed to update ASR provider');
    return res.status(500).json({
      error: 'Failed to update provider',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * DELETE /asr-providers/:id
 * Delete ASR provider (with usage check)
 */
adminTtsSttRouter.delete('/asr-providers/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  const existing = await speechProviderService.getById(id);
  if (!existing) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  // Check if provider is used by any skills
  const skillsUsingProvider = await storage.db.query.skills.findMany({
    where: (skills, { eq }) => eq(skills.asrProviderId, id),
  });

  if (skillsUsingProvider.length > 0) {
    return res.status(400).json({
      error: 'Provider is used by skills',
      message: `Провайдер используется в ${skillsUsingProvider.length} навыке(ах). Сначала измените настройки навыков.`,
      skillIds: skillsUsingProvider.map(s => s.id),
    });
  }

  try {
    await storage.deleteSpeechProvider(id);
    return res.json({ message: 'Provider deleted successfully' });
  } catch (error) {
    logger.error({ error, providerId: id }, 'Failed to delete ASR provider');
    return res.status(500).json({
      error: 'Failed to delete provider',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}));

/**
 * POST /asr-providers/test
 * Test Unica ASR connection
 */
adminTtsSttRouter.post('/asr-providers/test', asyncHandler(async (req, res) => {
  const { config } = req.body;

  const validation = z.object({
    baseUrl: z.string().url(),
    workspaceId: z.string().min(1),
  }).safeParse(config);

  if (!validation.success) {
    return res.status(400).json({
      error: 'Invalid config',
      details: validation.error.errors,
    });
  }

  try {
    // Simple health check - try to get status of non-existent task
    // Expect 404, which confirms API is working
    const apiBaseUrl = normalizeUnicaApiBaseUrl(config.baseUrl);
    const testUrl = `${apiBaseUrl}/asr/SpeechRecognition/recognition-task/test-connection?workSpaceId=${config.workspaceId}`;
    
    const response = await fetch(testUrl, { method: 'GET' });
    
    // 404 - API works, task not found (expected)
    // 200 - also ok
    // 5xx - server problem
    if (response.status === 404 || response.ok) {
      return res.json({
        success: true,
        message: 'Connection successful',
      });
    } else if (response.status >= 500) {
      return res.json({
        success: false,
        message: `Server error: ${response.status}`,
      });
    } else {
      return res.json({
        success: true,
        message: `API responded with status ${response.status}`,
      });
    }
  } catch (error) {
    logger.error({ error, config }, 'ASR provider connection test failed');
    return res.json({
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    });
  }
}));

export default adminTtsSttRouter;
