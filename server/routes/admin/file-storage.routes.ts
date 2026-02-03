/**
 * Admin File Storage Routes
 * 
 * Endpoints:
 * - GET /api/admin/file-storage/providers - List providers
 * - GET /api/admin/file-storage/providers/:id - Get provider
 * - POST /api/admin/file-storage/providers - Create provider
 * - PATCH /api/admin/file-storage/providers/:id - Update provider
 * - DELETE /api/admin/file-storage/providers/:id - Delete provider
 * - POST /api/admin/file-storage/providers/:id/test - Test provider connection
 */

import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import {
  fileStorageProviderService,
  FileStorageProviderServiceError,
  normalizeFileProviderConfig,
  defaultProviderConfig,
} from '../../file-storage-provider-service';
import {
  createFileStorageProviderClient,
  ProviderUploadError,
} from '../../file-storage-provider-client';
import type { FileStorageProvider } from '@shared/schema';

const logger = createLogger('admin-file-storage');

/**
 * Map file storage provider to public response format
 */
function mapFileStorageProvider(provider: FileStorageProvider) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl ?? null,
    description: provider.description ?? null,
    authType: provider.authType ?? null,
    isActive: provider.isActive,
    config: provider.config ?? {},
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export const adminFileStorageRouter = Router();

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /providers
 */
adminFileStorageRouter.get('/providers', asyncHandler(async (_req, res) => {
  const providers = await fileStorageProviderService.list();
  res.json({ providers: providers.map(mapFileStorageProvider) });
}));

/**
 * GET /providers/:id
 */
adminFileStorageRouter.get('/providers/:id', asyncHandler(async (req, res) => {
  try {
    const provider = await fileStorageProviderService.getById(req.params.id);
    if (!provider) {
      return res.status(404).json({ message: 'Provider not found' });
    }
    res.json({ provider: mapFileStorageProvider(provider) });
  } catch (error) {
    if (error instanceof FileStorageProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * POST /providers
 */
adminFileStorageRouter.post('/providers', asyncHandler(async (req, res) => {
  try {
    const provider = await fileStorageProviderService.create(req.body);
    res.status(201).json({ provider: mapFileStorageProvider(provider) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid provider data', details: error.issues });
    }
    if (error instanceof FileStorageProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PATCH /providers/:id
 */
adminFileStorageRouter.patch('/providers/:id', asyncHandler(async (req, res) => {
  try {
    const provider = await fileStorageProviderService.update(req.params.id, req.body);
    res.json({ provider: mapFileStorageProvider(provider) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid provider data', details: error.issues });
    }
    if (error instanceof FileStorageProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * DELETE /providers/:id
 */
adminFileStorageRouter.delete('/providers/:id', asyncHandler(async (req, res) => {
  try {
    await fileStorageProviderService.delete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof FileStorageProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * POST /providers/:id/test
 * Test provider connection by uploading a small test file
 */
adminFileStorageRouter.post('/providers/:id/test', asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const providerId = req.params.id;
  const bearerToken = typeof req.body.bearerToken === 'string' ? req.body.bearerToken.trim() : null;

  logger.info({ providerId }, '[FILE-PROVIDER-TEST] Starting connection test');

  try {
    // Get provider
    const provider = await fileStorageProviderService.getById(providerId);
    if (!provider) {
      return res.status(404).json({ 
        success: false, 
        message: 'Провайдер не найден',
        code: 'PROVIDER_NOT_FOUND',
      });
    }

    // Check if bearer token is required but not provided
    if (provider.authType === 'bearer' && !bearerToken) {
      return res.status(400).json({
        success: false,
        message: 'Для этого провайдера требуется Bearer токен. Укажите токен в поле "bearerToken".',
        code: 'BEARER_TOKEN_REQUIRED',
      });
    }

    // Create test file content
    const testId = randomUUID();
    const testFileName = `health-check-${testId}.txt`;
    const testContent = `Health check test file\nProvider: ${provider.name}\nTimestamp: ${new Date().toISOString()}\nTest ID: ${testId}`;
    const testBuffer = Buffer.from(testContent, 'utf-8');

    logger.info({
      providerId,
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      authType: provider.authType,
      testFileName,
      testSize: testBuffer.length,
    }, '[FILE-PROVIDER-TEST] Uploading test file');

    // Create client and upload
    const providerConfig = normalizeFileProviderConfig(provider.config ?? defaultProviderConfig);
    const client = createFileStorageProviderClient({
      baseUrl: provider.baseUrl,
      authType: provider.authType as 'none' | 'bearer',
      config: providerConfig,
    });

    const result = await client.uploadFile({
      workspaceId: 'health-check',
      workspaceName: 'health-check',
      skillId: null,
      skillName: null,
      chatId: null,
      userId: null,
      messageId: null,
      bucket: providerConfig.bucket ?? null,
      fileNameOriginal: testFileName,
      fileName: testFileName,
      mimeType: 'text/plain',
      sizeBytes: testBuffer.length,
      data: testBuffer,
      bearerToken: bearerToken,
      objectKeyHint: testFileName,
    });

    const elapsed = Date.now() - startTime;
    logger.info({
      providerId,
      providerName: provider.name,
      providerFileId: result.providerFileId,
      downloadUrl: result.downloadUrl,
      elapsed,
    }, '[FILE-PROVIDER-TEST] ✅ Test successful');

    return res.json({
      success: true,
      message: 'Подключение успешно! Тестовый файл загружен.',
      providerFileId: result.providerFileId,
      downloadUrl: result.downloadUrl ?? null,
      elapsed,
      testFileName,
    });
  } catch (error) {
    const elapsed = Date.now() - startTime;
    
    if (error instanceof ProviderUploadError) {
      logger.error({
        providerId,
        status: error.status,
        code: error.code,
        message: error.message,
        details: error.details,
        elapsed,
      }, '[FILE-PROVIDER-TEST] ❌ Test failed');

      return res.status(error.status).json({
        success: false,
        message: error.message,
        code: error.code,
        details: error.details,
        elapsed,
      });
    }

    if (error instanceof FileStorageProviderServiceError) {
      logger.error({
        providerId,
        status: error.status,
        message: error.message,
        elapsed,
      }, '[FILE-PROVIDER-TEST] ❌ Provider service error');

      return res.status(error.status).json({
        success: false,
        message: error.message,
        code: 'PROVIDER_SERVICE_ERROR',
        elapsed,
      });
    }

    const errorObj = error as { message?: string };
    logger.error({
      providerId,
      error: errorObj?.message ?? String(error),
      elapsed,
    }, '[FILE-PROVIDER-TEST] ❌ Unexpected error');

    throw error;
  }
}));

export default adminFileStorageRouter;
