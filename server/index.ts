import "./load-env";
import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import { ensureDatabaseSchema } from "./storage";
import { getAllowedHostnames } from "./cors-cache";
import { isDatabaseConfigured } from "./db";
import fs from "fs";
import path from "path";
import { configureAuth } from "./auth";
import { startSkillExecutionLogRetentionJob } from "./skill-execution-log-retention";
import { startSystemNotificationLogRetentionJob } from "./system-notification-log-retention";
import { startSkillFileIngestionWorker } from "./skill-file-ingestion-jobs";
import { startKnowledgeBaseIndexingWorker } from "./knowledge-base-indexing-jobs";
import { startFileEventOutboxWorker } from "./no-code-file-events-outbox";
import { startBotActionWatchdog } from "./bot-action-watchdog";
import { closePubSub } from "./realtime";
import { cleanupChatSubscriptions } from "./chat-events";
import { closeCache } from "./cache";

const app = express();
app.set("trust proxy", 1);

// Health check endpoint - must be FIRST, before any middleware
// This ensures fast response for deployment health checks
let dbInitialized = false;
app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    dbConfigured: isDatabaseConfigured,
    dbInitialized,
    timestamp: new Date().toISOString()
  });
});

const bodySizeLimitSetting = process.env.BODY_SIZE_LIMIT?.trim() ?? "50mb";

function formatBodySizeLimit(limit: string): string {
  const normalized = limit.trim().toLowerCase();
  const sizeMatch = normalized.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/);

  if (sizeMatch) {
    const value = Number.parseFloat(sizeMatch[1] ?? "0");
    const unit = sizeMatch[2] ?? "b";

    if (!Number.isFinite(value) || value <= 0) {
      return limit;
    }

    switch (unit) {
      case "gb":
        return `${value} ГБ`;
      case "mb":
        return `${value} МБ`;
      case "kb":
        return `${value} КБ`;
      default:
        return `${value} байт`;
    }
  }

  const numeric = Number.parseInt(normalized, 10);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric >= 1024 * 1024 * 1024) {
      return `${(numeric / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
    }
    if (numeric >= 1024 * 1024) {
      return `${(numeric / (1024 * 1024)).toFixed(1)} МБ`;
    }
    if (numeric >= 1024) {
      return `${(numeric / 1024).toFixed(1)} КБ`;
    }
    return `${numeric} байт`;
  }

  return limit;
}

const bodySizeLimitDescription = formatBodySizeLimit(bodySizeLimitSetting);

app.use(express.json({ limit: bodySizeLimitSetting }));
app.use(express.urlencoded({ extended: false, limit: bodySizeLimitSetting }));

// Request logging middleware
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/admin/tariffs')) {
    console.log(`[REQUEST] ${req.method} ${req.url}`, JSON.stringify(req.body));
  }
  next();
});

type PayloadTooLargeError = Error & {
  type?: string;
  status?: number;
  statusCode?: number;
};

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  const payloadError = err as PayloadTooLargeError | undefined;
  if (payloadError && (payloadError.type === "entity.too.large" || payloadError.status === 413 || payloadError.statusCode === 413)) {
    log(`Получен запрос, превышающий лимит тела: ${payloadError.message ?? "entity.too.large"}`);
    if (!res.headersSent) {
      res.status(413).json({
        message: `Размер загружаемого файла превышает допустимый лимит ${bodySizeLimitDescription}. Уменьшите файл или обратитесь к администратору для увеличения лимита.`,
      });
    }
    return;
  }

  next(err);
});


// Dynamic CORS configuration based on database sites with caching
const publicCors = cors({
  origin: (_origin, callback) => {
    callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200,
});

const restrictedCors = cors({
  origin: async (origin, callback) => {
    try {
      // Allow same-origin requests
      if (!origin) {
        return callback(null, true);
      }

      // Parse hostname from origin for secure checking
      let originHostname: string;
      try {
        const originUrl = new URL(origin);
        originHostname = originUrl.hostname;
      } catch (urlError) {
        log(`CORS: Invalid origin URL: ${origin}`);
        return callback(new Error('Invalid origin'));
      }

      // Allow localhost for development
      const isLocalhost = originHostname === 'localhost' || originHostname === '127.0.0.1' || 
                         originHostname === '0.0.0.0';

      if (isLocalhost) {
        // Skip logging for localhost in development to reduce log noise
        return callback(null, true);
      }

      // Get allowed hostnames from cache
      const allowedHostnames = await getAllowedHostnames();

      // Check if origin hostname is allowed
      // Support Tilda subdomains: hostname === 'tilda.ws' || hostname.endsWith('.tilda.ws')
      const isAllowed = allowedHostnames.has(originHostname) || 
                       originHostname === 'tilda.ws' || 
                       originHostname.endsWith('.tilda.ws');

      if (isAllowed) {
        log(`CORS: Allowed configured domain: ${origin} (hostname: ${originHostname})`);
        callback(null, true);
      } else {
        log(`CORS: Blocked unauthorized origin: ${origin} (hostname: ${originHostname})`);
        const corsError = new Error(
          `Запрос отклонён политикой CORS для домена ${originHostname}. ` +
          "Добавьте домен в список сайтов или установите переменную STATIC_ALLOWED_HOSTNAMES",
        );
        (corsError as Error & { status?: number }).status = 403;
        callback(corsError);
      }
    } catch (error) {
      log(`CORS error: ${error}`);
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/public/") || req.path.startsWith("/public/")) {
    publicCors(req, res, next);
    return;
  }

  restrictedCors(req, res, next);
});

void configureAuth(app);

const retentionJob = startSkillExecutionLogRetentionJob();
const notificationRetentionJob = startSystemNotificationLogRetentionJob();
const skillFileIngestionWorker = startSkillFileIngestionWorker();
const knowledgeBaseIndexingWorker = startKnowledgeBaseIndexingWorker();
const fileEventOutboxWorker = startFileEventOutboxWorker();
const botActionWatchdog = startBotActionWatchdog();

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Validate critical environment variables before starting
function validateProductionSecrets(): void {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (!isProduction) {
    return;
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  // Check database connection
  const hasCustomDb = process.env.PG_HOST && process.env.PG_USER && 
                      process.env.PG_PASSWORD && process.env.PG_DATABASE;
  const hasDatabaseUrl = process.env.DATABASE_URL;
  
  if (!hasCustomDb && !hasDatabaseUrl) {
    errors.push('Database not configured: Set DATABASE_URL or PG_* variables');
  }

  // Check session secret
  if (!process.env.SESSION_SECRET) {
    warnings.push('SESSION_SECRET not set - using default (insecure for production)');
  }

  if (errors.length > 0) {
    log('❌ CRITICAL CONFIGURATION ERRORS:');
    errors.forEach(err => log(`  - ${err}`));
    throw new Error(`Missing required configuration: ${errors.join(', ')}`);
  }

  if (warnings.length > 0) {
    log('⚠️  CONFIGURATION WARNINGS:');
    warnings.forEach(warn => log(`  - ${warn}`));
  }
}

(async () => {
  // Validate production configuration
  try {
    validateProductionSecrets();
  } catch (error) {
    log(`Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`);
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  // CRITICAL: Register routes and start server FIRST (before database init)
  // This ensures port 5000 opens immediately for production deployment
  const server = await registerRoutes(app);

  // Add explicit 404 JSON fallback for unknown API paths
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const httpError = err && typeof err === 'object' ? err as { status?: number; statusCode?: number; message?: string; code?: string; details?: unknown } : null;
    const status = httpError?.status ?? httpError?.statusCode ?? 500;
    const message = httpError?.message ?? (err instanceof Error ? err.message : "Internal Server Error");
    const errorCode = typeof httpError?.code === "string" && httpError.code.trim().length > 0 ? httpError.code : undefined;
    const details = httpError?.details !== undefined ? httpError.details : undefined;

    const errorDetails = err instanceof Error && err.stack ? err.stack : String(err);
    log(`Unhandled error ${status}: ${errorDetails}`);
    if (!res.headersSent) {
      res.status(status).json({
        message,
        ...(errorCode ? { errorCode } : {}),
        ...(details !== undefined ? { details } : {}),
      });
    } else {
      res.end();
    }
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    // Production: serve static files with fallback from dist/public to server/public
    const distPublic = path.resolve(import.meta.dirname, "..", "dist", "public");
    const serverPublic = path.resolve(import.meta.dirname, "public");
    
    const staticDir = fs.existsSync(serverPublic) ? serverPublic : 
                     (fs.existsSync(distPublic) ? distPublic : null);
    
    if (!staticDir) {
      throw new Error("No static assets found. Run 'npm run build' to build the client first.");
    }
    
    app.use(express.static(staticDir));

    // Fallback to index.html for client-side routing (exclude API routes)
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.sendFile(path.resolve(staticDir, "index.html"));
    });
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  const listenOptions = {
    port,
    host: "0.0.0.0",
    ...(process.platform !== "win32" ? { reusePort: true } : {}),
  };
  
  // START SERVER IMMEDIATELY - don't wait for database
  server.listen(listenOptions, () => {
    log(`serving on port ${port}`);
  });

  // Initialize database in background (non-blocking with 45s timeout)
  // Server continues running even if database fails to initialize
  Promise.race([
    (async () => {
      try {
        await ensureDatabaseSchema();
        dbInitialized = true;
        log("✅ Проверка схемы базы данных выполнена");
      } catch (error) {
        log(`❌ Не удалось подготовить схему базы данных: ${error instanceof Error ? error.message : String(error)}`);
      }
    })(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Database initialization timeout after 45s')), 45000)
    )
  ]).catch(error => {
    log(`⚠️  Database initialization warning: ${error instanceof Error ? error.message : String(error)}`);
  });

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    log(`${signal} received, shutting down gracefully...`);
    
    const shutdownTimeout = setTimeout(() => {
      log('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 10000);

    try {
      retentionJob?.stop?.();
      notificationRetentionJob?.stop?.();
      skillFileIngestionWorker?.stop?.();
      fileEventOutboxWorker?.stop?.();
      botActionWatchdog?.stop?.();
      // Close HTTP server
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Cleanup chat subscriptions and PubSub
      cleanupChatSubscriptions();
      await closePubSub();

      // Close cache connections
      await closeCache();

      // Close database pool
      const { pool } = await import("./db");
      if (pool && typeof pool.end === 'function') {
        await pool.end();
      }

      clearTimeout(shutdownTimeout);
      log('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      clearTimeout(shutdownTimeout);
      log(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
})();

export default app;
