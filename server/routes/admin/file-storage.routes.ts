/**
 * Admin File Storage Routes
 * 
 * Endpoints:
 * - GET /api/admin/file-storage/providers - List providers
 * - GET /api/admin/file-storage/providers/:id - Get provider
 * - POST /api/admin/file-storage/providers - Create provider
 * - PATCH /api/admin/file-storage/providers/:id - Update provider
 * - DELETE /api/admin/file-storage/providers/:id - Delete provider
 */

import { Router } from 'express';
import { z } from 'zod';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import {
  fileStorageProviderService,
  FileStorageProviderServiceError,
} from '../../file-storage-provider-service';
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
    res.json(mapFileStorageProvider(provider));
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
    res.status(201).json(mapFileStorageProvider(provider));
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
    res.json(mapFileStorageProvider(provider));
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

export default adminFileStorageRouter;
