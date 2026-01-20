/**
 * Admin Settings Routes
 * 
 * Endpoints:
 * - GET /api/admin/settings/smtp - Get SMTP settings
 * - PUT /api/admin/settings/smtp - Update SMTP settings
 * - POST /api/admin/settings/smtp/test - Test SMTP settings
 * - GET /api/admin/indexing-rules - Get indexing rules
 * - PUT /api/admin/indexing-rules - Update indexing rules
 * - PATCH /api/admin/indexing-rules - Partial update indexing rules
 * - GET/PUT /api/admin/unica-chat - Unica chat settings
 */

import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import { smtpSettingsService, SmtpSettingsError } from '../../smtp-settings';
import { smtpTestService } from '../../smtp-test-service';
import { indexingRulesService, IndexingRulesError } from '../../indexing-rules';

const logger = createLogger('admin-settings');

export const adminSettingsRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const smtpSettingsSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim(),
  password: z.string(),
  fromEmail: z.string().email(),
  fromName: z.string().trim().optional(),
});

const smtpTestSchema = z.object({
  recipientEmail: z.string().email(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /settings/smtp
 */
adminSettingsRouter.get('/smtp', asyncHandler(async (_req, res) => {
  try {
    const settings = await smtpSettingsService.getSettings();
    res.json({
      ...settings,
      password: settings?.password ? '********' : '',
    });
  } catch (error) {
    if (error instanceof SmtpSettingsError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PUT /settings/smtp
 */
adminSettingsRouter.put('/smtp', asyncHandler(async (req, res) => {
  try {
    const parsed = smtpSettingsSchema.parse(req.body);
    await smtpSettingsService.set(parsed);
    res.json({ message: 'SMTP settings updated successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid settings', details: error.issues });
    }
    if (error instanceof SmtpSettingsError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * POST /settings/smtp/test
 */
adminSettingsRouter.post('/smtp/test', asyncHandler(async (req, res) => {
  try {
    const parsed = smtpTestSchema.parse(req.body);
    await smtpTestService.sendTestEmail(parsed.recipientEmail);
    res.json({ message: 'Test email sent successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid request', details: error.issues });
    }
    if (error instanceof SmtpSettingsError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /indexing-rules
 */
adminSettingsRouter.get('/indexing-rules', asyncHandler(async (_req, res) => {
  try {
    const rules = await indexingRulesService.getIndexingRules();
    res.json(rules);
  } catch (error) {
    if (error instanceof IndexingRulesError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PUT /indexing-rules
 */
adminSettingsRouter.put('/indexing-rules', asyncHandler(async (req, res) => {
  try {
    // Получаем adminId из req.user (должен быть установлен middleware аутентификации)
    const adminId = (req as any).user?.id ?? null;
    const rules = await indexingRulesService.updateIndexingRules(req.body, adminId);
    res.json(rules);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid rules', details: error.issues });
    }
    if (error instanceof IndexingRulesError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PATCH /indexing-rules
 */
adminSettingsRouter.patch('/indexing-rules', asyncHandler(async (req, res) => {
  try {
    // Получаем adminId из req.user (должен быть установлен middleware аутентификации)
    const adminId = (req as any).user?.id ?? null;
    const rules = await indexingRulesService.updateIndexingRules(req.body, adminId);
    res.json(rules);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid rules', details: error.issues });
    }
    if (error instanceof IndexingRulesError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /unica-chat
 */
adminSettingsRouter.get('/unica-chat', asyncHandler(async (_req, res) => {
  const config = await storage.getUnicaChatConfig();
  res.json({ config });
}));

/**
 * PUT /unica-chat
 */
adminSettingsRouter.put('/unica-chat', asyncHandler(async (req, res) => {
  try {
    const config = await storage.setUnicaChatConfig(req.body);
    res.json({ config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid config', details: error.issues });
    }
    throw error;
  }
}));

export default adminSettingsRouter;
