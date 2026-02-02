import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";
import { createLogger as createAppLogger } from "./lib/logger";

const viteLogger = createLogger();
const appLogger = createAppLogger("vite");

export function log(message: string, source = "express") {
  // Always duplicate to application logger so it can be persisted to dev.log.
  // This is important for debugging server-side pipelines (e.g., ASR).
  appLogger.info({ source }, message);

  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        // Логируем ошибку, но НЕ убиваем процесс
        // Vite сам покажет ошибку в браузере через HMR overlay
        viteLogger.error(msg, options);
      },
    },
    server: {
      ...(viteConfig.server || {}),
      ...serverOptions,
      fs: {
        ...(viteConfig.server?.fs || {}),
        strict: false,
        allow: [
          ...(viteConfig.server?.fs?.allow || []),
          process.cwd(),
          path.resolve(import.meta.dirname, ".."),
          path.resolve(import.meta.dirname, "..", "client"),
          path.resolve(import.meta.dirname, "..", "client", "src"),
        ],
      },
    },
    appType: "custom",
  });

  // Отладочное логирование запросов Vite (включается через переменную окружения DEBUG_VITE_REQUESTS=1)
  if (process.env.DEBUG_VITE_REQUESTS === "1") {
    app.use((req, res, next) => {
      // Логируем все запросы к файлам для отладки
      if (req.originalUrl.includes('/src/pages/') || req.originalUrl.includes('@fs') || req.originalUrl.includes('KnowledgeBase')) {
        log(`[VITE DEBUG] Request: ${req.method} ${req.originalUrl}`, 'vite');
      }
      next();
    });
  }
  
  app.use(vite.middlewares);
  
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html; charset=utf-8" }).end(page);
    } catch (e) {
      log(`[VITE ERROR] ${(e as Error).message}`, 'vite');
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("*", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
