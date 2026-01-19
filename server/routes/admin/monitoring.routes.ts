/**
 * Admin Monitoring Routes
 * 
 * Endpoints:
 * - GET /api/admin/guard-blocks - Get guard blocks
 * - GET /api/admin/usage/charges - Get usage charges
 * - GET /api/admin/system-notifications/logs - Get notification logs
 * - GET /api/admin/system-notifications/logs/:id - Get log details
 */

import { Router } from 'express';
import { z } from 'zod';
import { storage } from '../../storage';
import { createLogger } from '../../lib/logger';
import { asyncHandler } from '../../middleware/async-handler';
import { centsToCredits } from '@shared/credits';

const logger = createLogger('admin-monitoring');

export const adminMonitoringRouter = Router();

// ============================================================================
// Routes
// ============================================================================

const usageChargesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  workspaceId: z.string().optional(),
});

type ChargeMetadata = {
  operationId?: string | null;
  modelId?: string | null;
  modelKey?: string | null;
  modelName?: string | null;
  modelType?: string | null;
  consumptionUnit?: string | null;
  unit?: string | null;
  quantityUnits?: number | null;
  quantityRaw?: number | null;
  appliedCreditsPerUnitCents?: number | null;
  appliedCreditsPerUnit?: number | null;
  creditsChargedCents?: number | null;
  creditsCharged?: number | null;
};

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toChargeMetadata(value: unknown): ChargeMetadata {
  if (!value || typeof value !== "object") return {};
  return value as ChargeMetadata;
}

function resolveAppliedCreditsPerUnit(metadata: ChargeMetadata): number | null {
  const cents = asNumber(metadata.appliedCreditsPerUnitCents);
  if (cents !== null) {
    return centsToCredits(cents);
  }

  const legacy = asNumber(metadata.appliedCreditsPerUnit);
  return legacy !== null ? legacy : null;
}

function resolveCreditsCharged(metadata: ChargeMetadata, amountDelta: number | null): number {
  const cents = asNumber(metadata.creditsChargedCents);
  if (cents !== null) {
    return centsToCredits(cents);
  }

  const legacy = asNumber(metadata.creditsCharged);
  if (legacy !== null) {
    return legacy;
  }

  const fallbackCents = amountDelta !== null ? Math.max(0, -amountDelta) : 0;
  return centsToCredits(fallbackCents);
}

function mapUsageChargeEntry(entry: {
  id: string;
  sourceRef?: string | null;
  workspaceId: string;
  occurredAt: Date | string;
  amountDelta?: number | null;
  metadata?: unknown;
}) {
  const metadata = toChargeMetadata(entry.metadata);
  const modelId = asString(metadata.modelId);
  const modelKey = asString(metadata.modelKey);
  const modelName = asString(metadata.modelName);
  const modelType = asString(metadata.modelType);
  const consumptionUnit = asString(metadata.consumptionUnit) ?? asString(metadata.unit);
  const model =
    modelId || modelKey || modelName || modelType || consumptionUnit
      ? {
          id: modelId,
          key: modelKey,
          displayName: modelName,
          modelType,
          consumptionUnit,
        }
      : null;

  const amountDelta = asNumber(entry.amountDelta);
  const occurredAt =
    entry.occurredAt instanceof Date
      ? entry.occurredAt.toISOString()
      : new Date(entry.occurredAt).toISOString();

  return {
    id: entry.id,
    operationId: asString(metadata.operationId) ?? (entry.sourceRef ?? null),
    workspaceId: entry.workspaceId,
    occurredAt,
    model,
    unit: consumptionUnit,
    quantityUnits: asNumber(metadata.quantityUnits),
    quantityRaw: asNumber(metadata.quantityRaw),
    appliedCreditsPerUnit: resolveAppliedCreditsPerUnit(metadata),
    creditsCharged: resolveCreditsCharged(metadata, amountDelta),
  };
}

/**
 * GET /guard-blocks
 */
adminMonitoringRouter.get('/guard-blocks', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize)) || 20));
  const result = await storage.listGuardBlocks({ page, pageSize });
  res.json({ 
    items: result.blocks, 
    totalCount: result.total, 
    page: result.page, 
    pageSize: result.pageSize 
  });
}));

/**
 * GET /usage/charges
 */
adminMonitoringRouter.get('/usage/charges', asyncHandler(async (req, res) => {
  const query = usageChargesQuerySchema.parse(req.query);
  const limit = query.limit ?? query.pageSize ?? 20;
  const rawOffset = query.offset ?? (query.page ? (query.page - 1) * limit : 0);
  const page = Math.floor(rawOffset / limit) + 1;
  const offset = (page - 1) * limit;
  const workspaceId = query.workspaceId?.trim() || undefined;
  const result = await storage.listCharges({ page, pageSize: limit, workspaceId, entryType: "usage_charge" });

  res.json({
    items: result.charges.map(mapUsageChargeEntry),
    total: result.total,
    limit,
    offset,
  });
}));

/**
 * GET /system-notifications/logs
 */
adminMonitoringRouter.get('/system-notifications/logs', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize)) || 20));
  const result = await storage.listSystemNotificationLogs({ page, pageSize });
  res.json(result);
}));

/**
 * GET /system-notifications/logs/:id
 */
adminMonitoringRouter.get('/system-notifications/logs/:id', asyncHandler(async (req, res) => {
  const log = await storage.getSystemNotificationLog(req.params.id);
  if (!log) {
    return res.status(404).json({ message: 'Log not found' });
  }
  res.json(log);
}));

export default adminMonitoringRouter;
