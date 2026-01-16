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
  
  // No-code callback routes (external integrations)
  app.use('/api/no-code', noCodeRouter);
  routerLogger.info('Registered: /api/no-code');

  // Chat routes
  app.use('/api/chat', chatRouter);
  routerLogger.info('Registered: /api/chat');

  // Skill routes
  app.use('/api/skills', skillRouter);
  routerLogger.info('Registered: /api/skills');

  // Knowledge base routes
  app.use('/api/knowledge', knowledgeBaseRouter);
  routerLogger.info('Registered: /api/knowledge');
  
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
