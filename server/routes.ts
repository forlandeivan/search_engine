import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { crawler } from "./crawler";
import { insertSiteSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
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
      res.json(updatedSite);
    } catch (error) {
      console.error("Error updating site:", error);
      res.status(500).json({ error: "Failed to update site" });
    }
  });

  app.delete("/api/sites/:id", async (req, res) => {
    try {
      const success = await storage.deleteSite(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Site not found" });
      }
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

  app.post("/api/sites/:id/stop-crawl", async (req, res) => {
    try {
      await crawler.stopCrawl(req.params.id);
      res.json({ message: "Crawling stopped", siteId: req.params.id });
    } catch (error) {
      console.error("Error stopping crawl:", error);
      res.status(500).json({ error: "Failed to stop crawling" });
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
      const query = req.query.q as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const offset = (page - 1) * limit;

      if (!query || query.trim().length === 0) {
        return res.json({ results: [], total: 0, page, limit });
      }

      const { results, total } = await storage.searchPages(query, limit, offset);
      
      res.json({
        results,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      });
    } catch (error) {
      console.error("Error performing search:", error);
      res.status(500).json({ error: "Failed to perform search" });
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

  const httpServer = createServer(app);

  return httpServer;
}
