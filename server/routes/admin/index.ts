/**
 * Admin Routes Module
 * 
 * Aggregates all admin sub-routes into a single router.
 * All routes require admin authentication (requireAdmin middleware).
 * 
 * Sub-modules:
 * - users.routes.ts - User management
 * - workspaces.routes.ts - Workspace management
 * - auth-providers.routes.ts - OAuth providers config
 * - settings.routes.ts - System settings (SMTP, indexing, etc.)
 * - tariffs.routes.ts - Tariff plans management
 * - llm.routes.ts - LLM models and providers
 * - file-storage.routes.ts - File storage providers
 * - tts-stt.routes.ts - Speech providers
 * - monitoring.routes.ts - System monitoring
 */

import { Router } from 'express';
import { createLogger } from '../../lib/logger';

// Import sub-routers
import { adminUsersRouter } from './users.routes';
import { adminWorkspacesRouter } from './workspaces.routes';
import { adminAuthProvidersRouter } from './auth-providers.routes';
import { adminSettingsRouter } from './settings.routes';
import { adminTariffsRouter } from './tariffs.routes';
import { adminLlmRouter } from './llm.routes';
import { adminFileStorageRouter } from './file-storage.routes';
import { adminTtsSttRouter } from './tts-stt.routes';
import { adminMonitoringRouter } from './monitoring.routes';

const logger = createLogger('admin');

export const adminRouter = Router();

// Register all admin sub-routes
// Note: requireAdmin middleware should be applied at the parent level

// Users management
adminRouter.use('/users', adminUsersRouter);

// Workspaces management
adminRouter.use('/workspaces', adminWorkspacesRouter);

// Auth providers (OAuth)
adminRouter.use('/auth/providers', adminAuthProvidersRouter);

// System settings
adminRouter.use('/settings', adminSettingsRouter);
// Also mount directly for backward compatibility
adminRouter.use('/', adminSettingsRouter); // /indexing-rules, /unica-chat

// Tariffs and billing
adminRouter.use('/tariffs', adminTariffsRouter);
adminRouter.use('/billing', adminTariffsRouter); // /billing/info

// LLM and embeddings
adminRouter.use('/', adminLlmRouter); // /models, /llm-*, /embeddings/*, /knowledge-base-indexing-policy

// File storage providers
adminRouter.use('/file-storage', adminFileStorageRouter);

// TTS/STT providers
adminRouter.use('/tts-stt', adminTtsSttRouter);
adminRouter.use('/', adminTtsSttRouter); // /asr-executions (for backward compatibility)

// Monitoring
adminRouter.use('/', adminMonitoringRouter); // /guard-blocks, /usage/charges, /system-notifications

logger.info('Admin router initialized with sub-modules');

export default adminRouter;
