/**
 * Admin Auth Providers Routes
 * 
 * Endpoints:
 * - GET /api/admin/auth/providers/google - Get Google OAuth config
 * - PUT /api/admin/auth/providers/google - Update Google OAuth config
 * - GET /api/admin/auth/providers/yandex - Get Yandex OAuth config
 * - PUT /api/admin/auth/providers/yandex - Update Yandex OAuth config
 */

import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';

const logger = createLogger('admin-auth-providers');

export const adminAuthProvidersRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const googleOAuthConfigSchema = z.object({
  clientId: z.string().trim().min(1, 'Client ID is required'),
  clientSecret: z.string().trim().min(1, 'Client Secret is required'),
  enabled: z.boolean().optional(),
});

const yandexOAuthConfigSchema = z.object({
  clientId: z.string().trim().min(1, 'Client ID is required'),
  clientSecret: z.string().trim().min(1, 'Client Secret is required'),
  enabled: z.boolean().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /auth/providers/google
 */
adminAuthProvidersRouter.get('/google', asyncHandler(async (_req, res) => {
  const config = await storage.getOAuthConfig('google');
  res.json({
    provider: 'google',
    enabled: config?.enabled ?? false,
    clientId: config?.clientId ?? '',
    hasClientSecret: Boolean(config?.clientSecret),
  });
}));

/**
 * PUT /auth/providers/google
 */
adminAuthProvidersRouter.put('/google', asyncHandler(async (req, res) => {
  try {
    const parsed = googleOAuthConfigSchema.parse(req.body);
    await storage.setOAuthConfig('google', {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      enabled: parsed.enabled ?? true,
    });
    
    res.json({
      provider: 'google',
      enabled: parsed.enabled ?? true,
      clientId: parsed.clientId,
      hasClientSecret: true,
      message: 'Google OAuth configuration updated. Server restart may be required.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid configuration', details: error.issues });
    }
    throw error;
  }
}));

/**
 * GET /auth/providers/yandex
 */
adminAuthProvidersRouter.get('/yandex', asyncHandler(async (_req, res) => {
  const config = await storage.getOAuthConfig('yandex');
  res.json({
    provider: 'yandex',
    enabled: config?.enabled ?? false,
    clientId: config?.clientId ?? '',
    hasClientSecret: Boolean(config?.clientSecret),
  });
}));

/**
 * PUT /auth/providers/yandex
 */
adminAuthProvidersRouter.put('/yandex', asyncHandler(async (req, res) => {
  try {
    const parsed = yandexOAuthConfigSchema.parse(req.body);
    await storage.setOAuthConfig('yandex', {
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      enabled: parsed.enabled ?? true,
    });
    
    res.json({
      provider: 'yandex',
      enabled: parsed.enabled ?? true,
      clientId: parsed.clientId,
      hasClientSecret: true,
      message: 'Yandex OAuth configuration updated. Server restart may be required.',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid configuration', details: error.issues });
    }
    throw error;
  }
}));

export default adminAuthProvidersRouter;
