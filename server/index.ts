import express, { type Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { storage } from "./storage";
import { getAllowedHostnames } from "./cors-cache";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));


// Dynamic CORS configuration based on database sites with caching
app.use(cors({
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
        callback(new Error('Not allowed by CORS'));
      }
    } catch (error) {
      log(`CORS error: ${error}`);
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200
}));

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
  // Reset any stuck crawling sites on server startup
  try {
    const sites = await storage.getAllSites();
    const stuckSites = sites.filter(site => site.status === 'crawling');
    for (const site of stuckSites) {
      await storage.updateSite(site.id, { status: 'idle' });
      log(`Reset stuck crawling status for site: ${site.url}`);
    }
  } catch (error) {
    log(`Warning: Failed to reset stuck crawling sites: ${error}`);
  }

  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
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
    
    // Fallback to index.html for client-side routing
    app.use("*", (_req, res) => {
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
