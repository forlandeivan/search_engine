/**
 * Admin Tariffs Routes
 * 
 * Endpoints:
 * - GET /api/admin/billing/info - Get billing info (via /billing mount)
 * - GET /api/admin/tariffs - List all tariffs
 * - GET /api/admin/tariffs/:planId - Get tariff details
 * - PUT /api/admin/tariffs/:planId - Update tariff
 * - PUT /api/admin/tariffs/:planId/limits - Update tariff limits
 * 
 * Note: /api/admin/tariff-limit-catalog is in index.ts
 */

import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import { tariffPlanService } from '../../tariff-plan-service';
import { TARIFF_LIMIT_CATALOG } from '../../tariff-limit-catalog';
import { db } from '../../db';
import { tariffPlans } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Helper to build limits map
function buildLimitsMap(limits: Array<{ limitKey: string; unit: string; limitValue: number | null; isEnabled: boolean }>) {
  const result: Record<string, { unit: string; value: number | null; isEnabled: boolean }> = {};
  for (const limit of limits) {
    result[limit.limitKey] = {
      unit: limit.unit,
      value: limit.limitValue,
      isEnabled: limit.isEnabled,
    };
  }
  return result;
}

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
  noCodeFlowEnabled: z.boolean().optional(),
  includedCreditsAmount: z.union([z.number(), z.string()]).optional(),
  includedCreditsPeriod: z.string().optional(),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /info
 * Mounted at /billing/info via /billing prefix
 */
adminTariffsRouter.get('/info', asyncHandler(async (_req, res) => {
  res.json({ billingEnabled: false, provider: null });
}));

/**
 * GET /tariffs
 */
adminTariffsRouter.get('/', asyncHandler(async (_req, res) => {
  const plans = await tariffPlanService.getAllPlans();
  const tariffs = await Promise.all(
    plans.map(async (plan) => {
      const limits = await tariffPlanService.getPlanLimits(plan.id);
      return {
        ...plan,
        limits: buildLimitsMap(limits),
      };
    })
  );
  res.json({ tariffs });
}));

/**
 * GET /tariffs/:planId
 */
adminTariffsRouter.get('/:planId', asyncHandler(async (req, res) => {
  try {
    const tariff = await tariffPlanService.getPlanWithLimitsById(req.params.planId);
    if (!tariff) {
      return res.status(404).json({ message: 'Tariff not found' });
    }
    res.json(tariff);
  } catch (error) {
    if (error instanceof Error) {
      const httpError = error as Error & { status?: number };
      if (httpError.status !== undefined) {
        return res.status(httpError.status).json({ message: error.message });
      }
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
    const planId = req.params.planId;
    
    // Check if plan exists
    const existing = await tariffPlanService.getPlanById(planId);
    if (!existing) {
      return res.status(404).json({ message: 'Tariff not found' });
    }
    
    // Update credits/noCodeFlowEnabled if provided (using dedicated method)
    if (parsed.includedCreditsAmount !== undefined || parsed.includedCreditsPeriod !== undefined || parsed.noCodeFlowEnabled !== undefined) {
      // includedCreditsAmount приходит в центах (число)
      const amountCents = parsed.includedCreditsAmount !== undefined 
        ? (typeof parsed.includedCreditsAmount === 'string' 
            ? Math.round(parseFloat(parsed.includedCreditsAmount)) 
            : Math.round(parsed.includedCreditsAmount))
        : undefined;
      await tariffPlanService.updatePlanCredits(planId, {
        amountCents: amountCents ?? undefined,
        period: parsed.includedCreditsPeriod ?? undefined,
        noCodeFlowEnabled: parsed.noCodeFlowEnabled ?? undefined,
      });
    }
    
    // Update other plan fields
    const updates: Partial<typeof tariffPlans.$inferInsert> = {};
    if (parsed.name !== undefined) updates.name = parsed.name;
    if (parsed.description !== undefined) updates.description = parsed.description;
    if (parsed.isActive !== undefined) updates.isActive = parsed.isActive;
    if (parsed.sortOrder !== undefined) updates.sortOrder = parsed.sortOrder;
    updates.updatedAt = new Date();
    
    if (Object.keys(updates).length > 1) { // больше чем только updatedAt
      await db.update(tariffPlans).set(updates).where(eq(tariffPlans.id, planId));
    }
    
    // Return updated plan with limits
    const tariff = await tariffPlanService.getPlanWithLimitsById(planId);
    res.json(tariff);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid data', details: error.issues });
    }
    if (error instanceof Error) {
      const httpError = error as Error & { status?: number };
      if (httpError.status !== undefined) {
        return res.status(httpError.status).json({ message: error.message });
      }
    }
    throw error;
  }
}));

/**
 * PUT /tariffs/:planId/limits
 */
adminTariffsRouter.put('/:planId/limits', asyncHandler(async (req, res) => {
  try {
    const limits = Array.isArray(req.body) ? req.body : [];
    const tariff = await tariffPlanService.upsertPlanLimits(req.params.planId, limits);
    res.json(tariff);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid limits', details: error.issues });
    }
    if (error instanceof Error) {
      const httpError = error as Error & { status?: number };
      if (httpError.status !== undefined) {
        return res.status(httpError.status).json({ message: error.message });
      }
    }
    throw error;
  }
}));

export default adminTariffsRouter;
