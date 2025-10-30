import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage, ensureDatabaseSchema } from "./storage";
import { getAllowedHostnames } from "./cors-cache";
import fs from "fs";
import path from "path";
import { configureAuth } from "./auth";

const app = express();
app.set("trust proxy", 1);

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

      // SECURITY FIX: Use proper hostname checking instead of vulnerable includes()
      // Allow Replit preview domains with secure hostname parsing
      const isReplitDomain = originHostname === 'replit.dev' || originHostname.endsWith('.replit.dev') ||
                            originHostname === 'replit.app' || originHostname.endsWith('.replit.app');

      // Allow localhost for development
      const isLocalhost = originHostname === 'localhost' || originHostname === '127.0.0.1' || 
                         originHostname === '0.0.0.0';

      if (isReplitDomain) {
        log(`CORS: Allowed Replit domain: ${origin} (hostname: ${originHostname})`);
        return callback(null, true);
      }

      if (isLocalhost) {
        log(`CORS: Allowed localhost for development: ${origin} (hostname: ${originHostname})`);
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

(async () => {
  try {
    await ensureDatabaseSchema();
    log("Проверка схемы базы данных выполнена");
  } catch (error) {
    log(`Не удалось подготовить схему базы данных: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Reset any stuck crawling sites on server startup
  try {
    const sites = await storage.getAllSites();
    const stuckSites = sites.filter(site => site.status === 'crawling');
    for (const site of stuckSites) {
      await storage.updateSite(site.id, { status: 'idle' });
      log(`Reset stuck crawling status for site: ${site.url ?? 'без URL'}`);
    }
  } catch (error) {
    log(`Warning: Failed to reset stuck crawling sites: ${error}`);
  }

  const server = await registerRoutes(app);

  // Add explicit 404 JSON fallback for unknown API paths
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    const errorDetails = err instanceof Error && err.stack ? err.stack : String(err);
    log(`Unhandled error ${status}: ${errorDetails}`);
    if (!res.headersSent) {
      res.status(status).json({ message });
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
      res.sendFile(path.resolve(staticDir, "index.html"));
    });
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
