/**
 * Admin Settings Routes
 * 
 * Endpoints:
 * - GET /api/admin/settings/smtp - Get SMTP settings
 * - PUT /api/admin/settings/smtp - Update SMTP settings
 * - POST /api/admin/settings/smtp/test - Test SMTP settings
 * - GET /api/admin/settings/maintenance - Get maintenance mode settings
 * - PUT /api/admin/settings/maintenance - Update maintenance mode settings
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
import { maintenanceModeSettingsService, MaintenanceModeSettingsError } from '../../maintenance-mode-settings';
import { maintenanceModeAuditLogService } from '../../maintenance-mode-audit-log-service';

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

const maintenanceAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  type: z.string().trim().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
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
 * GET /settings/maintenance
 */
adminSettingsRouter.get('/maintenance', asyncHandler(async (_req, res) => {
  try {
    const settings = await maintenanceModeSettingsService.getSettings();
    res.json(settings);
  } catch (error) {
    if (error instanceof MaintenanceModeSettingsError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PUT /settings/maintenance
 */
adminSettingsRouter.put('/maintenance', asyncHandler(async (req, res) => {
  try {
    const adminId = (req as any).user?.id ?? null;
    const settings = await maintenanceModeSettingsService.updateSettings({ ...req.body, updatedByAdminId: adminId });
    res.json(settings);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid settings', details: error.issues });
    }
    if (error instanceof MaintenanceModeSettingsError) {
      return res.status(error.status).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /settings/maintenance/audit
 */
adminSettingsRouter.get('/maintenance/audit', asyncHandler(async (req, res) => {
  try {
    const query = maintenanceAuditQuerySchema.parse(req.query);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const dateFrom = query.dateFrom ? new Date(query.dateFrom) : undefined;
    const dateTo = query.dateTo ? new Date(query.dateTo) : undefined;
    if (query.dateFrom && dateFrom && Number.isNaN(dateFrom.getTime())) {
      return res.status(400).json({ message: "Invalid dateFrom" });
    }
    if (query.dateTo && dateTo && Number.isNaN(dateTo.getTime())) {
      return res.status(400).json({ message: "Invalid dateTo" });
    }
    const eventType = query.type?.trim() || undefined;

    const result = await maintenanceModeAuditLogService.list({
      page,
      pageSize,
      eventType: eventType as any,
      dateFrom,
      dateTo,
    });

    const items = result.items.map((entry) => ({
      id: entry.id,
      eventType: entry.eventType,
      actorAdminId: entry.actorAdminId,
      occurredAt: entry.occurredAt instanceof Date ? entry.occurredAt.toISOString() : new Date(entry.occurredAt).toISOString(),
      payload: entry.payload ?? {},
    }));

    res.json({
      items,
      page,
      pageSize,
      totalItems: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid query', details: error.issues });
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
