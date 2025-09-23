import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { crawler, type CrawlLogEvent } from "./crawler";
import { insertSiteSchema } from "@shared/schema";
import { z } from "zod";
import { invalidateCorsCache } from "./cors-cache";
import { getQdrantClient, QdrantConfigurationError } from "./qdrant";
import type { QdrantClient, Schemas } from "@qdrant/js-client-rest";

function getErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const causeMessage = error.cause instanceof Error ? error.cause.message : undefined;
    if (causeMessage) {
      return `${error.message}: ${causeMessage}`;
    }
    return error.message;
  }

  return String(error);
}

// Bulk delete schema
const bulkDeletePagesSchema = z.object({
  pageIds: z.array(z.string()).min(1).max(1000)
});

const distanceEnum = z.enum(["Cosine", "Euclid", "Dot", "Manhattan"]);

const sparseVectorSchema = z.object({
  indices: z.array(z.number()),
  values: z.array(z.number()),
});

const pointVectorSchema = z.union([
  z.array(z.number()),
  z.array(z.array(z.number())),
  z.record(z.any()),
  sparseVectorSchema,
]);

const namedVectorSchema = z.object({
  name: z.string(),
  vector: z.array(z.number()),
});

const namedSparseVectorSchema = z.object({
  name: z.string(),
  vector: sparseVectorSchema,
});

const searchVectorSchema = z.union([
  z.array(z.number()),
  namedVectorSchema,
  namedSparseVectorSchema,
]);

const createVectorCollectionSchema = z.object({
  name: z.string().min(1).max(128),
  vectorSize: z.number().int().positive(),
  distance: distanceEnum.default("Cosine"),
  onDiskPayload: z.boolean().optional(),
});

const upsertPointsSchema = z.object({
  wait: z.boolean().optional(),
  ordering: z.enum(["weak", "medium", "strong"]).optional(),
  points: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    vector: pointVectorSchema,
    payload: z.record(z.any()).optional(),
  })).min(1),
});

const searchPointsSchema = z.object({
  vector: searchVectorSchema,
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().min(0).optional(),
  filter: z.unknown().optional(),
  params: z.unknown().optional(),
  withPayload: z.unknown().optional(),
  withVector: z.unknown().optional(),
  scoreThreshold: z.number().optional(),
  shardKey: z.unknown().optional(),
  consistency: z.union([
    z.number().int().positive(),
    z.literal("majority"),
    z.literal("quorum"),
    z.literal("all")
  ]).optional(),
  timeout: z.number().positive().optional(),
});

// Public search API request/response schemas
const publicSearchRequestSchema = z.object({
  query: z.string().min(1),
  hitsPerPage: z.number().int().positive().max(100).default(10),
  page: z.number().int().min(0).default(0),
  facetFilters: z.array(z.string()).optional(),
  attributesToRetrieve: z.array(z.string()).optional(),
});

interface PublicSearchResponse {
  hits: Array<{
    objectID: string;
    url: string;
    title?: string;
    content?: string;
    hierarchy?: {
      lvl0?: string;
      lvl1?: string;
      lvl2?: string;
    };
    excerpt?: string;
    _highlightResult?: {
      title?: { value: string; matchLevel: string };
      content?: { value: string; matchLevel: string };
    };
  }>;
  nbHits: number;
  page: number;
  nbPages: number;
  hitsPerPage: number;
  query: string;
  params: string;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Vector search endpoints
  app.get("/api/vector/collections", async (_req, res) => {
    try {
      const client = getQdrantClient();
      const { collections } = await client.getCollections();

      const detailedCollections = await Promise.all(
        collections.map(async ({ name }) => {
          try {
            const info = await client.getCollection(name);
            const vectorsConfig = info.config?.params?.vectors as
              | { size?: number | null; distance?: string | null }
              | undefined;

            return {
              name,
              status: info.status,
              optimizerStatus: info.optimizer_status,
              pointsCount: info.points_count ?? info.vectors_count ?? 0,
              vectorsCount: info.vectors_count ?? null,
              vectorSize: vectorsConfig?.size ?? null,
              distance: vectorsConfig?.distance ?? null,
              segmentsCount: info.segments_count,
            };
          } catch (error) {
            return {
              name,
              status: "unknown" as const,
              error: error instanceof Error ? error.message : "Не удалось получить сведения о коллекции",
            };
          }
        })
      );

      res.json({ collections: detailedCollections });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error("Ошибка при получении коллекций Qdrant:", error);
      res.status(500).json({
        error: "Не удалось загрузить список коллекций",
        details,
      });
    }
  });

  app.get("/api/vector/collections/:name", async (req, res) => {
    try {
      const client = getQdrantClient();
      const info = await client.getCollection(req.params.name);
      res.json({
        name: req.params.name,
        status: info.status,
        optimizerStatus: info.optimizer_status,
        pointsCount: info.points_count ?? info.vectors_count ?? 0,
        vectorsCount: info.vectors_count ?? null,
        segmentsCount: info.segments_count,
        config: info.config,
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error(`Ошибка при получении коллекции ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось получить информацию о коллекции",
        details,
      });
    }
  });

  app.post("/api/vector/collections", async (req, res) => {
    try {
      const body = createVectorCollectionSchema.parse(req.body);
      const client = getQdrantClient();

      const { name, vectorSize, distance, onDiskPayload } = body;
      const result = await client.createCollection(name, {
        vectors: {
          size: vectorSize,
          distance,
        },
        on_disk_payload: onDiskPayload,
      });

      const info = await client.getCollection(name);

      res.status(201).json({
        operation: result,
        collection: {
          name,
          status: info.status,
          optimizerStatus: info.optimizer_status,
          pointsCount: info.points_count ?? info.vectors_count ?? 0,
          vectorsCount: info.vectors_count ?? null,
          vectorSize,
          distance,
          segmentsCount: info.segments_count,
        },
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные параметры коллекции",
          details: error.errors,
        });
      }

      console.error("Ошибка при создании коллекции Qdrant:", error);
      res.status(500).json({
        error: "Не удалось создать коллекцию",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.delete("/api/vector/collections/:name", async (req, res) => {
    try {
      const client = getQdrantClient();
      await client.deleteCollection(req.params.name);

      res.json({
        message: "Коллекция удалена",
        name: req.params.name,
      });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      const details = getErrorDetails(error);
      console.error(`Ошибка при удалении коллекции ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось удалить коллекцию",
        details,
      });
    }
  });

  app.post("/api/vector/collections/:name/points", async (req, res) => {
    try {
      const body = upsertPointsSchema.parse(req.body);
      const client = getQdrantClient();

      const upsertPayload: Parameters<QdrantClient["upsert"]>[1] = {
        wait: body.wait,
        ordering: body.ordering,
        points: body.points as Schemas["PointStruct"][],
      };

      const result = await client.upsert(req.params.name, upsertPayload);

      res.status(202).json(result);
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные данные точек",
          details: error.errors,
        });
      }

      console.error(`Ошибка при загрузке точек в коллекцию ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось загрузить данные в коллекцию",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post("/api/vector/collections/:name/search", async (req, res) => {
    try {
      const body = searchPointsSchema.parse(req.body);
      const client = getQdrantClient();

      const searchPayload = {
        vector: body.vector as Schemas["NamedVectorStruct"],
        limit: body.limit,
      } as Parameters<QdrantClient["search"]>[1];

      if (body.offset !== undefined) {
        searchPayload.offset = body.offset;
      }

      if (body.filter !== undefined) {
        searchPayload.filter = body.filter as Parameters<QdrantClient["search"]>[1]["filter"];
      }

      if (body.params !== undefined) {
        searchPayload.params = body.params as Parameters<QdrantClient["search"]>[1]["params"];
      }

      if (body.withPayload !== undefined) {
        searchPayload.with_payload = body.withPayload as Parameters<QdrantClient["search"]>[1]["with_payload"];
      }

      if (body.withVector !== undefined) {
        searchPayload.with_vector = body.withVector as Parameters<QdrantClient["search"]>[1]["with_vector"];
      }

      if (body.scoreThreshold !== undefined) {
        searchPayload.score_threshold = body.scoreThreshold;
      }

      if (body.shardKey !== undefined) {
        searchPayload.shard_key = body.shardKey as Parameters<QdrantClient["search"]>[1]["shard_key"];
      }

      if (body.consistency !== undefined) {
        searchPayload.consistency = body.consistency;
      }

      if (body.timeout !== undefined) {
        searchPayload.timeout = body.timeout;
      }

      const results = await client.search(req.params.name, searchPayload);

      res.json({ results });
    } catch (error) {
      if (error instanceof QdrantConfigurationError) {
        return res.status(503).json({
          error: "Qdrant не настроен",
          details: error.message,
        });
      }

      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Некорректные параметры поиска",
          details: error.errors,
        });
      }

      console.error(`Ошибка при поиске в коллекции ${req.params.name}:`, error);
      res.status(500).json({
        error: "Не удалось выполнить поиск",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Sites management
  app.get("/api/sites", async (req, res) => {
    try {
      const sites = await storage.getAllSites();
      res.json(sites);
    } catch (error) {
      console.error("Error fetching sites:", error);
      res.status(500).json({ error: "Failed to fetch sites" });
    }
  });

  app.post("/api/sites", async (req, res) => {
    try {
      const validatedData = insertSiteSchema.parse(req.body);
      const newSite = await storage.createSite(validatedData);

      // Invalidate CORS cache since a new site was added
      invalidateCorsCache();
      console.log(`CORS cache invalidated after creating site: ${newSite.url ?? 'без URL'}`);
      
      res.status(201).json(newSite);
    } catch (error) {
      console.error("Error creating site:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid input", details: error.errors });
      } else {
        res.status(500).json({ error: "Failed to create site" });
      }
    }
  });

  // Extended sites with pages count - must come before /api/sites/:id
  app.get("/api/sites/extended", async (req, res) => {
    try {
      const sites = await storage.getAllSites();
      const sitesWithStats = await Promise.all(
        sites.map(async (site) => {
          const pages = await storage.getPagesBySiteId(site.id);
          return {
            ...site,
            pagesFound: pages.length,
            pagesIndexed: pages.length, // For now, all found pages are indexed
          };
        })
      );

      res.json(sitesWithStats);
    } catch (error) {
      console.error("Error fetching sites with stats:", error);
      res.status(500).json({ error: "Failed to fetch sites with statistics" });
    }
  });

  app.get("/api/sites/:id", async (req, res) => {
    try {
      const site = await storage.getSite(req.params.id);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }
      res.json(site);
    } catch (error) {
      console.error("Error fetching site:", error);
      res.status(500).json({ error: "Failed to fetch site" });
    }
  });

  app.put("/api/sites/:id", async (req, res) => {
    try {
      const updates = req.body;
      const updatedSite = await storage.updateSite(req.params.id, updates);
      if (!updatedSite) {
        return res.status(404).json({ error: "Site not found" });
      }

      // Invalidate CORS cache since site was updated (URL might have changed)
      invalidateCorsCache();
      console.log(`CORS cache invalidated after updating site: ${updatedSite.url ?? 'без URL'}`);
      
      res.json(updatedSite);
    } catch (error) {
      console.error("Error updating site:", error);
      res.status(500).json({ error: "Failed to update site" });
    }
  });

  app.delete("/api/sites/:id", async (req, res) => {
    try {
      // Get site info before deletion for logging
      const siteToDelete = await storage.getSite(req.params.id);
      const success = await storage.deleteSite(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Site not found" });
      }
      
      // Invalidate CORS cache since a site was deleted
      invalidateCorsCache();
      console.log(`CORS cache invalidated after deleting site: ${siteToDelete?.url || req.params.id}`);
      
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting site:", error);
      res.status(500).json({ error: "Failed to delete site" });
    }
  });

  // Crawling operations
  app.post("/api/sites/:id/crawl", async (req, res) => {
    try {
      const site = await storage.getSite(req.params.id);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      if (!site.url) {
        return res.status(400).json({ error: "Site URL is not configured" });
      }

      // Start crawling in background
      crawler.crawlSite(req.params.id).catch(error => {
        console.error(`Background crawl failed for site ${req.params.id}:`, error);
      });

      res.json({ message: "Crawling started", siteId: req.params.id });
    } catch (error) {
      console.error("Error starting crawl:", error);
      res.status(500).json({ error: "Failed to start crawling" });
    }
  });

  // Re-crawl existing site to find new pages
  app.post("/api/sites/:id/recrawl", async (req, res) => {
    try {
      const site = await storage.getSite(req.params.id);
      if (!site) {
        return res.status(404).json({ error: "Site not found" });
      }

      if (!site.url) {
        return res.status(400).json({ error: "Site URL is not configured" });
      }

      // Check if site is already being crawled
      if (site.status === 'crawling') {
        return res.status(400).json({ error: "Site is already being crawled" });
      }

      // Get current page count before recrawling for logging
      const existingPages = await storage.getPagesBySiteId(req.params.id);
      console.log(`Starting recrawl for site ${site.url ?? 'без URL'} - currently has ${existingPages.length} pages`);

      // Start re-crawling in background (uses same logic as regular crawl)
      // The crawler already handles duplicates by checking existing URLs
      crawler.crawlSite(req.params.id).catch(error => {
        console.error(`Background re-crawl failed for site ${req.params.id}:`, error);
      });

      res.json({ 
        message: "Re-crawling started", 
        siteId: req.params.id,
        existingPages: existingPages.length
      });
    } catch (error) {
      console.error("Error starting re-crawl:", error);
      res.status(500).json({ error: "Failed to start re-crawling" });
    }
  });

  app.post("/api/sites/:id/stop-crawl", async (req, res) => {
    try {
      await crawler.stopCrawl(req.params.id);
      res.json({ message: "Crawling stopped", siteId: req.params.id });
    } catch (error) {
      console.error("Error stopping crawl:", error);
      res.status(500).json({ error: "Failed to stop crawling" });
    }
  });

  // Emergency stop all crawls - simple database solution
  app.post("/api/emergency/stop-all-crawls", async (req, res) => {
    try {
      // Basic security check
      const adminToken = req.headers['x-admin-token'];
      if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
        console.warn(`Unauthorized emergency stop attempt from ${req.ip}`);
        return res.status(401).json({ error: "Unauthorized - admin token required" });
      }

      // Log the emergency action
      console.log(`Emergency stop initiated by admin from ${req.ip}`);
      
      // Simple but effective: directly reset all crawling statuses in database
      const sites = await storage.getAllSites();
      const stuckSites = sites.filter(site => site.status === 'crawling');
      
      for (const site of stuckSites) {
        await storage.updateSite(site.id, { 
          status: 'idle',
          error: 'Emergency stop - crawl terminated by admin'
        });
        console.log(`Emergency stopped crawling for site: ${site.url}`);
      }
      
      res.json({ 
        message: "All crawls stopped", 
        stoppedCount: stuckSites.length,
        stoppedSites: stuckSites.map(s => s.url),
        timestamp: new Date().toISOString() 
      });
    } catch (error) {
      console.error("Error stopping all crawls:", error);
      res.status(500).json({ error: "Failed to stop all crawls" });
    }
  });

  // Pages management
  app.get("/api/sites/:id/pages", async (req, res) => {
    try {
      const pages = await storage.getPagesBySiteId(req.params.id);
      res.json(pages);
    } catch (error) {
      console.error("Error fetching pages:", error);
      res.status(500).json({ error: "Failed to fetch pages" });
    }
  });

  // Search API
  app.get("/api/search", async (req, res) => {
    try {
      console.log("🔍 Search API called");
      console.log("📨 Raw query params:", req.query);
      console.log("📨 Request URL:", req.url);
      console.log("📨 User-Agent:", req.get('User-Agent'));
      
      const query = req.query.q as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;
      const siteId = typeof req.query.siteId === "string" ? req.query.siteId.trim() : undefined;

      console.log("📊 Parsed parameters:", { 
        query: query, 
        queryLength: query?.length,
        queryBytes: Buffer.byteLength(query || '', 'utf8'),
        page, 
        limit, 
        offset 
      });

      if (!query || query.trim().length === 0) {
        console.log("❌ Empty query provided");
        return res.json({ results: [], total: 0, page, limit });
      }

      // Decode the query if it's URL encoded
      let decodedQuery = query;
      try {
        decodedQuery = decodeURIComponent(query);
        console.log("✅ Decoded query:", decodedQuery);
      } catch (decodeError) {
        console.log("⚠️ Query decode failed, using original:", query);
        decodedQuery = query;
      }

      console.log("🚀 Calling storage.searchPages with query:", decodedQuery);
      let results;
      let total;

      if (siteId) {
        console.log("📁 Filtering search by site:", siteId);
        ({ results, total } = await storage.searchPagesByCollection(decodedQuery, siteId, limit, offset));
      } else {
        ({ results, total } = await storage.searchPages(decodedQuery, limit, offset));
      }
      console.log("✅ Search completed:", { 
        resultsCount: results.length, 
        total,
        sampleResults: results.slice(0, 2).map(r => ({ title: r.title, url: r.url }))
      });
      
      const response = {
        results,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      };
      
      console.log("📤 Sending response with", results.length, "results");
      res.json(response);
    } catch (error) {
      console.error("❌ Error performing search:", error);
      console.error("❌ Error type:", typeof error);
      console.error("❌ Error message:", error instanceof Error ? error.message : 'Unknown error');
      console.error("❌ Stack trace:", error instanceof Error ? error.stack : 'No stack trace');
      res.status(500).json({ 
        error: "Failed to perform search", 
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Webhook endpoint for automated crawling (e.g., from Tilda)
  app.post("/api/webhook/crawl", async (req, res) => {
    try {
      const { url, secret } = req.body;
      
      // Basic security - in production, validate secret token
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      // Find site by URL
      const sites = await storage.getAllSites();
      const site = sites.find(s => s.url === url);
      
      if (!site) {
        return res.status(404).json({ error: "Site not found for URL" });
      }

      // Start crawling in background
      crawler.crawlSite(site.id).catch(error => {
        console.error(`Webhook crawl failed for site ${site.id}:`, error);
      });

      res.json({ 
        message: "Crawling started via webhook", 
        siteId: site.id,
        url: site.url
      });
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).json({ error: "Failed to process webhook" });
    }
  });

  // Get all pages
  app.get("/api/pages", async (req, res) => {
    try {
      const allPages = await storage.getAllPages();
      res.json(allPages);
    } catch (error) {
      console.error('Error fetching pages:', error);
      res.status(500).json({ error: 'Failed to fetch pages' });
    }
  });

  // Bulk delete pages
  app.delete("/api/pages/bulk-delete", async (req, res) => {
    try {
      const validatedData = bulkDeletePagesSchema.parse(req.body);
      const { pageIds } = validatedData;
      
      console.log(`🗑️ Bulk delete requested for ${pageIds.length} pages`);
      
      const deleteResults = await storage.bulkDeletePages(pageIds);
      
      console.log(`✅ Bulk delete completed: ${deleteResults.deletedCount} pages deleted`);
      
      res.json({ 
        message: "Pages deleted successfully",
        deletedCount: deleteResults.deletedCount,
        notFoundCount: deleteResults.notFoundCount,
        requestedCount: pageIds.length
      });
    } catch (error) {
      console.error("❌ Error in bulk delete:", error);
      if (error instanceof z.ZodError) {
        res.status(400).json({ error: "Invalid input", details: error.errors });
      } else {
        res.status(500).json({ 
          error: "Failed to delete pages", 
          details: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });

  // Statistics endpoint
  app.get("/api/stats", async (req, res) => {
    try {
      const sites = await storage.getAllSites();
      const totalSites = sites.length;
      const activeCrawls = sites.filter(s => s.status === 'crawling').length;
      const completedCrawls = sites.filter(s => s.status === 'completed').length;
      const failedCrawls = sites.filter(s => s.status === 'failed').length;
      
      let totalPages = 0;
      for (const site of sites) {
        const pages = await storage.getPagesBySiteId(site.id);
        totalPages += pages.length;
      }

      res.json({
        sites: {
          total: totalSites,
          crawling: activeCrawls,
          completed: completedCrawls,
          failed: failedCrawls
        },
        pages: {
          total: totalPages
        }
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
      res.status(500).json({ error: "Failed to fetch statistics" });
    }
  });


  // Health check endpoint for database diagnostics
  app.get("/api/health/db", async (req, res) => {
    try {
      console.log("🔍 Database health check requested");
      
      // Get database connection info (masked for security)
      const dbUrl = process.env.DATABASE_URL || 'not_set';
      const maskedUrl = dbUrl.replace(/:[^:]*@/, ':***@');
      
      // Check database connectivity and schema
      const dbInfo = await storage.getDatabaseHealthInfo();
      
      const healthInfo = {
        database: {
          url_masked: maskedUrl,
          connected: true,
          ...dbInfo
        },
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'unknown'
      };
      
      console.log("✅ Database health check:", JSON.stringify(healthInfo, null, 2));
      res.json(healthInfo);
    } catch (error) {
      console.error("❌ Database health check failed:", error);
      res.status(500).json({ 
        error: "Database health check failed",
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  });

  const httpServer = createServer(app);

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws/crawler-logs",
  });

  type LogClient = {
    ws: WebSocket;
    siteId?: string | null;
  };

  const clients = new Set<LogClient>();

  wss.on("connection", (ws, req) => {
    let siteId: string | null | undefined;

    try {
      const host = req.headers.host ?? "localhost";
      const url = new URL(req.url ?? "", `http://${host}`);
      siteId = url.searchParams.get("siteId");
    } catch (error) {
      console.warn("Crawler logs websocket: invalid connection attempt", error);
      ws.close(1008, "Invalid connection");
      return;
    }

    const client: LogClient = {
      ws,
      siteId,
    };
    clients.add(client);

    ws.send(
      JSON.stringify({
        type: "connected",
        siteId: siteId ?? null,
        timestamp: new Date().toISOString(),
      }),
    );

    ws.on("close", () => {
      clients.delete(client);
    });

    ws.on("error", () => {
      clients.delete(client);
    });
  });

  const broadcastLog = (event: CrawlLogEvent) => {
    const payload = JSON.stringify({ type: "log", data: event });

    for (const client of clients) {
      const shouldReceive = !client.siteId || client.siteId === event.siteId;
      if (!shouldReceive) {
        continue;
      }

      if (client.ws.readyState !== WebSocket.OPEN) {
        clients.delete(client);
        continue;
      }

      try {
        client.ws.send(payload);
      } catch (error) {
        console.warn("Failed to send crawler log to client", error);
        client.ws.terminate();
        clients.delete(client);
      }
    }
  };

  crawler.onLog(broadcastLog);

  return httpServer;
}
