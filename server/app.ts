import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import { storage, ensureDatabaseSchema } from "./storage";
import { getAllowedHostnames } from "./cors-cache";
import fs from "fs";
import path from "path";
import { configureAuth } from "./auth";

export const app = express();
app.set("trust proxy", 1);

const bodySizeLimitSetting = process.env.BODY_SIZE_LIMIT?.trim() ?? "50mb";

function formatBodySizeLimit(limit: string): string {
  const normalized = limit.trim().toLowerCase();
  const m = normalized.match(/^(\d+(?:\.\d+)?)(b|kb|mb|gb)?$/);
  if (m) {
    const v = Number.parseFloat(m[1] ?? "0");
    const u = m[2] ?? "b";
    if (!Number.isFinite(v) || v <= 0) return limit;
    switch (u) { case "gb": return `${v} ГБ`; case "mb": return `${v} МБ`; case "kb": return `${v} КБ`; default: return `${v} байт`; }
  }
  const n = Number.parseInt(normalized, 10);
  if (Number.isFinite(n) && n > 0) {
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} ГБ`;
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} КБ`;
    return `${n} байт`;
  }
  return limit;
}
const bodySizeLimitDescription = formatBodySizeLimit(bodySizeLimitSetting);

let initialized = false;
let initPromise: Promise<void> | null = null;

/** Инициализация приложения ОДИН раз (важно для serverless) */
export async function initApp(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    app.use(express.json({ limit: bodySizeLimitSetting }));
    app.use(express.urlencoded({ extended: false, limit: bodySizeLimitSetting }));

    type PayloadTooLargeError = Error & { type?: string; status?: number; statusCode?: number };
    app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
      const e = err as PayloadTooLargeError | undefined;
      if (e && (e.type === "entity.too.large" || e.status === 413 || e.statusCode === 413)) {
        log(`Получен запрос, превышающий лимит тела: ${e.message ?? "entity.too.large"}`);
        if (!res.headersSent) res.status(413).json({ message: `Размер загружаемого файла превышает допустимый лимит ${bodySizeLimitDescription}.` });
        return;
      }
      next(err);
    });

    // CORS
    const publicCors = cors({ origin: (_o, cb) => cb(null, true), credentials: true, optionsSuccessStatus: 200 });
    const restrictedCors = cors({
      origin: async (origin, cb) => {
        try {
          if (!origin) return cb(null, true);
          let host = "";
          try { host = new URL(origin).hostname; } catch { log(`CORS: invalid origin ${origin}`); return cb(new Error("Invalid origin")); }
          const isReplit = host === "replit.dev" || host.endsWith(".replit.dev") || host === "replit.app" || host.endsWith(".replit.app");
          const isLocal = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
          if (isReplit || isLocal) return cb(null, true);
          const allowed = await getAllowedHostnames();
          const ok = allowed.has(host) || host === "tilda.ws" || host.endsWith(".tilda.ws");
          if (ok) cb(null, true);
          else {
            const err = new Error(`Запрос отклонён политикой CORS для домена ${host}`) as Error & { status?: number };
            err.status = 403; cb(err);
          }
        } catch (e) { cb(e instanceof Error ? e : new Error(String(e))); }
      },
      credentials: true, optionsSuccessStatus: 200
    });

    app.use((req, res, next) => {
      if (req.path.startsWith("/api/public/") || req.path.startsWith("/public/")) return publicCors(req, res, next);
      return restrictedCors(req, res, next);
    });

    await configureAuth(app);

    // Логирование ответа API
    app.use((req, res, next) => {
      const start = Date.now(); const path = req.path;
      let bodyOut: Record<string, any> | undefined;
      const orig = res.json;
      res.json = function (b, ...args) { bodyOut = b; return orig.apply(res, [b, ...args]); };
      res.on("finish", () => {
        if (!path.startsWith("/api")) return;
        let line = `${req.method} ${path} ${res.statusCode} in ${Date.now() - start}ms`;
        if (bodyOut) line += ` :: ${JSON.stringify(bodyOut)}`;
        if (line.length > 80) line = line.slice(0, 79) + "…";
        log(line);
      });
      next();
    });

    // Роуты
    const server = await registerRoutes(app);

    // Health
    app.get("/health", (_req, res) => res.json({ ok: true, env: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown" }));

    // 404 для неизвестных API
    app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found" }));

    // Глобальный обработчик ошибок
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      const details = err instanceof Error && err.stack ? err.stack : String(err);
      log(`Unhandled error ${status}: ${details}`);
      if (!res.headersSent) res.status(status).json({ message }); else res.end();
    });

    // Dev: Vite; Prod: статика
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      const distPublic = path.resolve(import.meta.dirname, "..", "dist", "public");
      const serverPublic = path.resolve(import.meta.dirname, "public");
      const staticDir = fs.existsSync(serverPublic) ? serverPublic : (fs.existsSync(distPublic) ? distPublic : null);
      if (!staticDir) throw new Error("No static assets found. Run 'npm run build' to build the client first.");
      app.use(express.static(staticDir));
      app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.resolve(staticDir, "index.html")));
    }

    // Инициализация БД в фоне
    Promise.race([
      (async () => {
        try { await ensureDatabaseSchema(); log("Проверка схемы базы данных выполнена"); }
        catch (e) { log(`Не удалось подготовить схему базы данных: ${e instanceof Error ? e.message : String(e)}`); }
        try {
          const sites = await storage.getAllSites();
          const stuck = sites.filter(s => s.status === "crawling");
          for (const s of stuck) await storage.updateSite(s.id, { status: "idle" });
        } catch (e) { log(`Warning: Failed to reset stuck crawling sites: ${e}`); }
      })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("Database initialization timeout")), 30000))
    ]).catch(e => log(`Database initialization warning: ${e instanceof Error ? e.message : String(e)}`));

    initialized = true;
  })();

  return initPromise;
}

export default app;
