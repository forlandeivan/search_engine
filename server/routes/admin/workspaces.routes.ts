/**
 * Admin Workspaces Routes
 * 
 * Endpoints:
 * - GET /api/admin/workspaces - List all workspaces
 * - GET /api/admin/workspaces/:workspaceId/default-file-storage-provider
 * - PUT /api/admin/workspaces/:workspaceId/default-file-storage-provider
 * - GET /api/admin/workspaces/:workspaceId/plan - Get workspace plan
 * - PUT /api/admin/workspaces/:workspaceId/plan - Set workspace plan
 * - POST /api/admin/workspaces/:workspaceId/credits/adjust - Adjust credits
 * - GET /api/admin/workspaces/:workspaceId/credits/adjustments/recent
 */

import { Router, type Request } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import {
  fileStorageProviderService,
  FileStorageProviderServiceError,
} from '../../file-storage-provider-service';
import { workspacePlanService, PlanDowngradeNotAllowedError } from '../../workspace-plan-service';
import { 
  applyManualCreditAdjustment, 
  getRecentManualAdjustments,
  getWorkspaceCreditAccount 
} from '../../credits-service';
import type { FileStorageProvider, PublicUser } from '@shared/schema';

const logger = createLogger('admin-workspaces');

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

export const adminWorkspacesRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const workspaceDefaultProviderSchema = z.object({
  providerId: z.string().trim().min(1).nullable().optional(),
});

const setWorkspacePlanSchema = z.object({
  tariffPlanId: z.string().trim().min(1),
});

const adjustCreditsSchema = z.object({
  amount: z.number(),
  reason: z.string().trim().min(1).max(500),
});

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /workspaces
 * List all workspaces with stats
 */
adminWorkspacesRouter.get('/', asyncHandler(async (_req, res) => {
  const workspaces = await storage.listAllWorkspacesWithStats();
  res.json({
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      usersCount: workspace.usersCount,
      managerFullName: workspace.managerFullName,
      createdAt: workspace.createdAt,
      tariffPlanId: workspace.tariffPlanId,
      tariffPlanCode: workspace.tariffPlanCode,
      tariffPlanName: workspace.tariffPlanName,
      defaultFileStorageProviderId: workspace.defaultFileStorageProviderId,
      defaultFileStorageProviderName: workspace.defaultFileStorageProviderName,
    })),
  });
}));

/**
 * GET /workspaces/:workspaceId/default-file-storage-provider
 */
adminWorkspacesRouter.get('/:workspaceId/default-file-storage-provider', asyncHandler(async (req, res) => {
  try {
    const provider = await fileStorageProviderService.getWorkspaceDefault(req.params.workspaceId);
    res.json({ provider: provider ? mapFileStorageProvider(provider) : null });
  } catch (error) {
    if (error instanceof FileStorageProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    logger.error({ error }, 'get workspace default failed');
    res.status(500).json({ message: 'Internal server error' });
  }
}));

/**
 * PUT /workspaces/:workspaceId/default-file-storage-provider
 */
adminWorkspacesRouter.put('/:workspaceId/default-file-storage-provider', asyncHandler(async (req, res) => {
  try {
    const parsed = workspaceDefaultProviderSchema.parse(req.body ?? {});
    const providerId = parsed.providerId ?? null;
    const provider = await fileStorageProviderService.setWorkspaceDefault(req.params.workspaceId, providerId);
    res.json({ provider: provider ? mapFileStorageProvider(provider) : null });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: error.issues?.[0]?.message ?? 'Invalid payload', details: error.issues });
    }
    if (error instanceof FileStorageProviderServiceError) {
      return res.status(error.status).json({ message: error.message });
    }
    logger.error({ error }, 'set workspace default failed');
    res.status(500).json({ message: 'Internal server error' });
  }
}));

/**
 * GET /workspaces/:workspaceId/plan
 */
adminWorkspacesRouter.get('/:workspaceId/plan', asyncHandler(async (req, res) => {
  try {
    const plan = await workspacePlanService.getWorkspacePlan(req.params.workspaceId);
    res.json(plan);
  } catch (error) {
    if (error instanceof PlanDowngradeNotAllowedError) {
      return res.status(400).json({ 
        message: error.message,
        code: error.code,
        violations: error.violations,
      });
    }
    throw error;
  }
}));

/**
 * PUT /workspaces/:workspaceId/plan
 */
adminWorkspacesRouter.put('/:workspaceId/plan', asyncHandler(async (req, res) => {
  try {
    const parsed = setWorkspacePlanSchema.parse(req.body);
    const result = await workspacePlanService.setWorkspacePlan(req.params.workspaceId, parsed.tariffPlanId);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid payload', details: error.issues });
    }
    if (error instanceof PlanDowngradeNotAllowedError) {
      return res.status(400).json({ 
        message: error.message,
        code: error.code,
        violations: error.violations,
      });
    }
    throw error;
  }
}));

/**
 * POST /workspaces/:workspaceId/credits/adjust
 */
adminWorkspacesRouter.post('/:workspaceId/credits/adjust', asyncHandler(async (req, res) => {
  try {
    const parsed = adjustCreditsSchema.parse(req.body);
    const adminId = (req as Request & { user?: PublicUser }).user?.id ?? null;
    const result = await applyManualCreditAdjustment({
      workspaceId: req.params.workspaceId,
      amountDelta: parsed.amount,
      reason: parsed.reason,
      actorUserId: adminId ?? null,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Invalid payload', details: error.issues });
    }
    if (error instanceof Error && 'status' in error) {
      return res.status((error as any).status || 500).json({ message: error.message });
    }
    throw error;
  }
}));

/**
 * GET /workspaces/:workspaceId/credits/adjustments/recent
 */
adminWorkspacesRouter.get('/:workspaceId/credits/adjustments/recent', asyncHandler(async (req, res) => {
  try {
    const adjustments = await getRecentManualAdjustments(req.params.workspaceId);
    res.json({ adjustments });
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return res.status((error as any).status || 500).json({ message: error.message });
    }
    throw error;
  }
}));

export default adminWorkspacesRouter;
