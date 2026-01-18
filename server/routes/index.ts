import type { Express } from 'express';
import { createServer, type Server } from 'http';
import { createLogger } from '../lib/logger';

// Import route modules
import { authRouter, configureAuthRouter } from './auth.routes';
import { userRouter } from './user.routes';
import { workspaceRouter } from './workspace.routes';
import { adminRouter } from './admin';
import { vectorRouter } from './vector.routes';
import { noCodeRouter } from './no-code.routes';
import { chatRouter } from './chat.routes';
import { skillRouter } from './skill.routes';
import { knowledgeBaseRouter } from './knowledge-base.routes';
import { healthRouter } from './health.routes';
import { publicRouter } from './public.routes';
import { jobsRouter } from './jobs.routes';
import { canvasRouter } from './canvas.routes';
import { cardsRouter } from './cards.routes';
import { actionsRouter } from './actions.routes';
import { webhookRouter } from './webhook.routes';
import { embedRouter } from './embed.routes';
import { transcribeRouter } from './transcribe.routes';
import { knowledgeIndexingRouter } from './knowledge-indexing.routes';
import { knowledgeCrawlRouter } from './knowledge-crawl.routes';
import { metricsRouter } from './metrics.routes';
import { metricsMiddleware } from '../monitoring/middleware';
import { openapiRouter } from './openapi.routes';
import { embeddingRouter } from './embedding.routes';
import { modelsRouter } from './models.routes';
import { llmRouter } from './llm.routes';
import { fileStorageRouter } from './file-storage.routes';
import { generalApiLimiter } from '../middleware/rate-limit';

const routerLogger = createLogger('router');

/**
 * Register all route modules with the Express application
 * 
 * Migration Strategy:
 * 1. Create new route modules in server/routes/
 * 2. Export router from each module
 * 3. Import and register here
 * 4. Remove corresponding routes from routes.ts
 * 5. Test thoroughly before proceeding to next module
 * 
 * Migration Progress:
 * - [x] auth.routes.ts - Authentication routes
 * - [x] user.routes.ts - User profile and tokens
 * - [ ] workspace.routes.ts - Workspace management
 * - [ ] chat.routes.ts - Chat sessions and messages
 * - [ ] skill.routes.ts - Skills management
 * - [ ] knowledge-base.routes.ts - Knowledge bases
 * - [ ] admin.routes.ts - Admin endpoints
 * - [ ] vector.routes.ts - Vector collections
 * - [ ] embedding.routes.ts - Embedding services
 * - [ ] llm.routes.ts - LLM providers
 * - [ ] public.routes.ts - Public API (no auth)
 * - [ ] no-code.routes.ts - No-code callbacks
 */
export function registerRouteModules(app: Express): void {
  routerLogger.info('Registering route modules');
  
  // Add metrics middleware (should be early in the chain)
  app.use(metricsMiddleware);
  routerLogger.info('Registered: metrics middleware');
  
  // Apply general API rate limiting to all /api routes (except health and metrics)
  app.use('/api', (req, res, next) => {
    // Skip rate limiting for health checks and metrics
    if (req.path.startsWith('/health') || req.path.startsWith('/metrics')) {
      return next();
    }
    return generalApiLimiter(req, res, next);
  });
  routerLogger.info('Registered: general API rate limiting');
  
  // Configure auth router with OAuth settings from app
  configureAuthRouter(app);
  
  // Auth routes (no auth required for most endpoints)
  app.use('/api/auth', authRouter);
  routerLogger.info('Registered: /api/auth');
  
  // User routes (requires auth - applied after requireAuth middleware in routes.ts)
  app.use('/api/users', userRouter);
  routerLogger.info('Registered: /api/users');
  
  // Workspace routes
  app.use('/api/workspaces', workspaceRouter);
  routerLogger.info('Registered: /api/workspaces');
  
  // Admin routes
  app.use('/api/admin', adminRouter);
  routerLogger.info('Registered: /api/admin');
  
  // Vector routes (Qdrant operations)
  app.use('/api/vector', vectorRouter);
  routerLogger.info('Registered: /api/vector');
  
  // Vector routes also handles /api/knowledge/documents/vector-records
  app.use('/api/knowledge', vectorRouter);
  routerLogger.info('Registered: /api/knowledge (vector-records)');
  
  // No-code callback routes (external integrations)
  app.use('/api/no-code', noCodeRouter);
  routerLogger.info('Registered: /api/no-code');

  // Chat routes
  app.use('/api/chat', chatRouter);
  routerLogger.info('Registered: /api/chat');

  // Skill routes
  app.use('/api/skills', skillRouter);
  routerLogger.info('Registered: /api/skills');

  // Knowledge base routes (must be registered BEFORE knowledgeCrawlRouter to handle /bases)
  app.use('/api/knowledge', knowledgeBaseRouter);
  routerLogger.info('Registered: /api/knowledge');

  // Health check routes
  app.use('/api/health', healthRouter);
  routerLogger.info('Registered: /api/health');

  // Prometheus metrics endpoint
  app.use('/metrics', metricsRouter);
  app.use('/api/metrics', metricsRouter);
  routerLogger.info('Registered: /metrics, /api/metrics');

  // OpenAPI documentation
  app.use('/api/docs', openapiRouter);
  routerLogger.info('Registered: /api/docs (OpenAPI/Swagger)');

  // Public routes (no auth required)
  app.use('/api/public', publicRouter);
  app.use('/public', publicRouter);  // Legacy path without /api prefix
  routerLogger.info('Registered: /api/public, /public');

  // Jobs routes (crawling, indexing background tasks)
  app.use('/api/jobs', jobsRouter);
  routerLogger.info('Registered: /api/jobs');

  // Canvas documents routes
  app.use('/api', canvasRouter);
  routerLogger.info('Registered: /api (canvas-documents)');

  // Cards routes
  app.use('/api/cards', cardsRouter);
  routerLogger.info('Registered: /api/cards');

  // Actions routes
  app.use('/api/actions', actionsRouter);
  routerLogger.info('Registered: /api/actions');

  // Webhook routes
  app.use('/api/webhook', webhookRouter);
  routerLogger.info('Registered: /api/webhook');

  // Embed keys routes (public widget integration)
  app.use('/api/embed', embedRouter);
  routerLogger.info('Registered: /api/embed');

  // Embedding services routes
  app.use('/api/embedding', embeddingRouter);
  routerLogger.info('Registered: /api/embedding');

  // Models routes (public models catalog)
  app.use('/api/models', modelsRouter);
  routerLogger.info('Registered: /api/models');

  // LLM providers routes
  app.use('/api/llm', llmRouter);
  routerLogger.info('Registered: /api/llm');

  // File storage providers routes
  app.use('/api/file-storage', fileStorageRouter);
  routerLogger.info('Registered: /api/file-storage');

  // Transcribe routes (speech-to-text operations)
  app.use('/api/chat/transcribe', transcribeRouter);
  routerLogger.info('Registered: /api/chat/transcribe');

  // Knowledge indexing routes (indexing actions)
  app.use('/api/knowledge', knowledgeIndexingRouter);
  routerLogger.info('Registered: /api/knowledge (indexing)');

  // Knowledge crawl routes
  app.use('/api/kb', knowledgeCrawlRouter);
  routerLogger.info('Registered: /api/kb (crawl)');
  
  // NOTE: knowledgeCrawlRouter is NOT registered on /api/knowledge/bases
  // to avoid intercepting /api/knowledge/bases GET requests handled by knowledgeBaseRouter
  
  // Route modules will be registered here as they are migrated
  // Example:
  // app.use('/api/workspaces', workspaceRoutes);
  // app.use('/api/chats', chatRoutes);
  // etc.
  
  routerLogger.info('Route modules registered');
}

/**
 * Create HTTP server with all routes registered
 * This is a wrapper that combines the new modular routes with legacy routes.ts
 */
export async function createAppServer(app: Express): Promise<Server> {
  const server = createServer(app);
  
  // Register modular routes first
  registerRouteModules(app);
  
  // Legacy routes from routes.ts are still registered in the main file
  // They will be gradually migrated to modules
  
  return server;
}
