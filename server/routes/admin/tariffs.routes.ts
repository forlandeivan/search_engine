/**
 * Admin Tariffs Routes
 * 
 * Endpoints:
 * - GET /api/admin/billing/info - Get billing info
 * - GET /api/admin/tariffs - List all tariffs
 * - GET /api/admin/tariffs/:planId - Get tariff details
 * - PUT /api/admin/tariffs/:planId - Update tariff
 * - PUT /api/admin/tariffs/:planId/limits - Update tariff limits
 * - GET /api/admin/tariff-limit-catalog - Get limit catalog
 */

import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import { tariffPlanService } from '../../tariff-plan-service';
import { TARIFF_LIMIT_CATALOG } from '../../tariff-limit-catalog';

const logger = createLogger('admin-tariffs');

export const adminTariffsRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const updateTariffSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /billing/info
 */
adminTariffsRouter.get('/billing/info', asyncHandler(async (_req, res) => {
  res.json({ billingEnabled: false, provider: null });
}));

/**
 * GET /tariffs
 */
adminTariffsRouter.get('/', asyncHandler(async (_req, res) => {
  const tariffs = await tariffPlanService.listAll();
  res.json({ tariffs });
}));

/**
 * GET /tariffs/:planId
 */
adminTariffsRouter.get('/:planId', asyncHandler(async (req, res) => {
  try {
    const tariff = await tariffPlanService.getById(req.params.planId);
    if (!tariff) {
      return res.status(404).json({ message: 'Tariff not found' });
    }
    res.json(tariff);
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return res.status((error as any).status || 500).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PUT /tariffs/:planId
 */
adminTariffsRouter.put('/:planId', asyncHandler(async (req, res) => {
  try {
    const parsed = updateTariffSchema.parse(req.body);
    const tariff = await tariffPlanService.update(req.params.planId, parsed);
    res.json(tariff);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid data', details: error.issues });
    }
    if (error instanceof Error && 'status' in error) {
      return res.status((error as any).status || 500).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * PUT /tariffs/:planId/limits
 */
adminTariffsRouter.put('/:planId/limits', asyncHandler(async (req, res) => {
  try {
    const tariff = await tariffPlanService.updateLimits(req.params.planId, req.body);
    res.json(tariff);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid limits', details: error.issues });
    }
    if (error instanceof Error && 'status' in error) {
      return res.status((error as any).status || 500).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /tariff-limit-catalog
 */
adminTariffsRouter.get('/limit-catalog', asyncHandler(async (_req, res) => {
  res.json(TARIFF_LIMIT_CATALOG);
}));

export default adminTariffsRouter;
