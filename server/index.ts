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

const isVercel = !!process.env.VERCEL;

// ---------- body size limit ----------
const bodySizeLimitSetting = process.env.BODY_SIZE_LIMIT?.trim() ?? "50mb";

function formatBodySizeLimit(limit: string): string {
  const normalized = limit.trim().toLowerCase();
  const sizeMatch = normalized.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/);

  if (sizeMatch) {
    const value = Number.parseFloat(sizeMatch[1] ?? "0");
    const unit = sizeMatch[2] ?? "b";
    if (!Number.isFinite(value) || value <= 0) return limit;

    switch (unit) {
      case "gb": return `${value} ГБ`;
      case "mb": return `${value} МБ`;
      case "kb": return `${value} КБ`;
      default:   return `${value} байт`;
    }
  }

  const numeric = Number.parseInt(normalized, 10);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric >= 1024 * 1024 * 1024) return `${(numeric / (1024 * 1024 * 1024)).toFixed(1)} ГБ`;
    if (numeric >= 1024 * 1024)        return `${(numeric / (1024 * 1024)).toFixed(1)} МБ`;
    if (numeric >= 1024)               return `${(numeric / 1024).toFixed(1)} КБ`;
    return `${numeric} байт`;
  }
  return limit;
}
const bodySizeLimitDescription = formatBodySizeLimit(bodySizeLimitSetting);

app.use(express.json({ limit: bodySizeLimitSetting }));
app.use(express.urlencoded({ extended: false, limit: bodySizeLimitSetting }));

type PayloadTooLargeError = Error & { type?: string; status?: number; statusCode?: number };

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

// ---------- CORS ----------
const publicCors = cors({
  origin: (_origin, callback) => callback(null, true),
  credentials: true,
  optionsSuccessStatus: 200,
});

const restrictedCors = cors({
  origin: async (origin, callback) => {
    try {
      if (!origin) return callback(null, true);

      let originHostname: string;
      try {
        const originUrl = new URL(origin);
        originHostname = originUrl.hostname;
      } catch {
        log(`CORS: Invalid origin URL: ${origin}`);
        return callback(new Error("Invalid origin"));
      }

      const isReplitDomain =
        originHostname === "replit.dev" || originHostname.endsWith(".replit.dev") ||
        originHostname === "replit.app" || originHostname.endsWith(".replit.app");

      const isLocalhost =
        originHostname === "localhost" || originHostname === "127.0.0.1" || originHostname === "0.0.0.0";

      if (isReplitDomain || isLocalhost) {
        log(`CORS: Allowed dev domain: ${origin} (hostname: ${originHostname})`);
        return callback(null, true);
      }

      const allowedHostnames = await getAllowedHostnames();
      const isAllowed =
        allowedHostnames.has(originHostname) ||
        originHostname === "tilda.ws" ||
        originHostname.endsWith(".tilda.ws");

      if (isAllowed) {
        log(`CORS: Allowed configured domain: ${origin} (hostname: ${originHostname})`);
        return callback(null, true);
      }

      log(`CORS: Blocked unauthorized origin: ${origin} (hostname: ${originHostname})`);
      const corsError = new Error(
        `Запрос отклонён политикой CORS для домена ${originHostname}. ` +
          "Добавьте домен в список сайтов или установите переменную STATIC_ALLOWED_HOSTNAMES"
      );
      (corsError as Error & { status?: number }).status = 403;
      return callback(corsError);
    } catch (error) {
      log(`CORS error: ${error}`);
      return callback(error instanceof Error ? error : new Error(String(error)));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/public/") || req.path.startsWith("/public/")) {
    return publicCors(req, res, next);
  }
  return restrictedCors(req, res, next);
});

// ---------- request logging ----------
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json.bind(res);
  (res as any).json = (bodyJson: any, ...args: any[]) => {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson, ...args);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      if (logLine.length > 80) logLine = logLine.slice(0, 79) + "…";
      log(logLine);
    }
  });

  next();
});

// ---------- one-time bootstrap ----------
let bootstrapped = false;
let nodeServer: ReturnType<Awaited<ReturnType<typeof registerRoutes>>["listen"]> | null = null;

async function bootstrap() {
  if (bootstrapped) return;
  await configureAuth(app);

  // Регистрируем маршруты (возвращается http.Server)
  const server = await registerRoutes(app);

  // 404 JSON для неизвестных API-путей
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API endpoint not found" });
  });

  // глобальный обработчик ошибок
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    const errorDetails = err instanceof Error && err.stack ? err.stack : String(err);
    log(`Unhandled error ${status}: ${errorDetails}`);
    if (!res.headersSent) res.status(status).json({ message });
    else res.end();
  });

  // Витэ и статика — ТОЛЬКО вне Vercel
  if (!isVercel) {
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      const distPublic = path.resolve(import.meta.dirname, "..", "dist", "public");
      const serverPublic = path.resolve(import.meta.dirname, "public");
      const staticDir = fs.existsSync(serverPublic)
        ? serverPublic
        : (fs.existsSync(distPublic) ? distPublic : null);

      if (!staticDir) {
        throw new Error("No static assets found. Run 'npm run build' to build the client first.");
      }
      app.use(express.static(staticDir));
      app.get(/^(?!\/api).*/, (_req, res) => {
        res.sendFile(path.resolve(staticDir, "index.html"));
      });
    }
  }

  // Прод / Replit: поднимаем порт. На Vercel — НИКОГДА не слушаем порт.
  if (!isVercel) {
    const port = parseInt(process.env.PORT || "5000", 10);
    server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
      log(`serving on port ${port}`);
    });
    nodeServer = server;

    // Инициализация БД в фоне (только вне Vercel, чтобы не греть ламбды)
    Promise.race([
      (async () => {
        try {
          await ensureDatabaseSchema();
          log("Проверка схемы базы данных выполнена");
        } catch (error) {
          log(`Не удалось подготовить схему базы данных: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          const sites = await storage.getAllSites();
          const stuckSites = sites.filter(site => site.status === "crawling");
          for (const site of stuckSites) {
            await storage.updateSite(site.id, { status: "idle" });
            log(`Reset stuck crawling status for site: ${site.url ?? "без URL"}`);
          }
        } catch (error) {
          log(`Warning: Failed to reset stuck crawling sites: ${error}`);
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Database initialization timeout")), 30000))
    ]).catch(error => {
      log(`Database initialization warning: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  bootstrapped = true;
}

// ---- экспорт для Vercel serverless ----
export async function getServer() {
  await bootstrap();
  return app;
}

// default-экспорт — хэндлер (Express совместим с (req,res))
export default async (req: any, res: any) => {
  await bootstrap();
  return (app as any)(req, res);
};
