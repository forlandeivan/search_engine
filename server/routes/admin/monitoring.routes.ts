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

const logger = createLogger('admin-monitoring');

export const adminMonitoringRouter = Router();

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /guard-blocks
 */
adminMonitoringRouter.get('/guard-blocks', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize)) || 20));
  const result = await storage.listGuardBlocks({ page, pageSize });
  res.json(result);
}));

/**
 * GET /usage/charges
 */
adminMonitoringRouter.get('/usage/charges', asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize)) || 20));
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const result = await storage.listCharges({ page, pageSize, workspaceId });
  res.json(result);
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
