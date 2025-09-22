import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, doublePrecision, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Shared search settings configuration for tuning fuzzy search weights and thresholds
export interface SearchSettings {
  fts: {
    titleBoost: number;
    contentBoost: number;
  };
  similarity: {
    titleThreshold: number;
    contentThreshold: number;
    titleWeight: number;
    contentWeight: number;
  };
  wordSimilarity: {
    titleThreshold: number;
    contentThreshold: number;
    titleWeight: number;
    contentWeight: number;
  };
  ilike: {
    titleBoost: number;
    contentBoost: number;
  };
  collectionSearch: {
    similarityTitleThreshold: number;
    similarityContentThreshold: number;
    ftsMatchBonus: number;
    similarityWeight: number;
  };
  fallback: {
    ftsTitleBoost: number;
    ftsContentBoost: number;
    ilikeTitleBoost: number;
    ilikeContentBoost: number;
  };
}

export const defaultSearchSettings: SearchSettings = {
  fts: {
    titleBoost: 15,
    contentBoost: 8,
  },
  similarity: {
    titleThreshold: 0.02,
    contentThreshold: 0.015,
    titleWeight: 10,
    contentWeight: 5,
  },
  wordSimilarity: {
    titleThreshold: 0.15,
    contentThreshold: 0.1,
    titleWeight: 8,
    contentWeight: 4,
  },
  ilike: {
    titleBoost: 5,
    contentBoost: 2.5,
  },
  collectionSearch: {
    similarityTitleThreshold: 0.2,
    similarityContentThreshold: 0.1,
    ftsMatchBonus: 0.5,
    similarityWeight: 0.3,
  },
  fallback: {
    ftsTitleBoost: 10,
    ftsContentBoost: 5,
    ilikeTitleBoost: 3,
    ilikeContentBoost: 1.5,
  },
};

export const searchSettingsSchema = z.object({
  fts: z.object({
    titleBoost: z.number(),
    contentBoost: z.number(),
  }),
  similarity: z.object({
    titleThreshold: z.number(),
    contentThreshold: z.number(),
    titleWeight: z.number(),
    contentWeight: z.number(),
  }),
  wordSimilarity: z.object({
    titleThreshold: z.number(),
    contentThreshold: z.number(),
    titleWeight: z.number(),
    contentWeight: z.number(),
  }),
  ilike: z.object({
    titleBoost: z.number(),
    contentBoost: z.number(),
  }),
  collectionSearch: z.object({
    similarityTitleThreshold: z.number(),
    similarityContentThreshold: z.number(),
    ftsMatchBonus: z.number(),
    similarityWeight: z.number(),
  }),
  fallback: z.object({
    ftsTitleBoost: z.number(),
    ftsContentBoost: z.number(),
    ilikeTitleBoost: z.number(),
    ilikeContentBoost: z.number(),
  }),
});

// Custom type for PostgreSQL tsvector
const tsvector = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'tsvector';
  },
});

// Sites table for storing crawl configurations
export const sites = pgTable("sites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().default("Новый проект"),
  description: text("description"),
  url: text("url").unique(),
  crawlDepth: integer("crawl_depth").notNull().default(3),
  followExternalLinks: boolean("follow_external_links").notNull().default(false),
  crawlFrequency: text("crawl_frequency").notNull().default("daily"), // "manual" | "hourly" | "daily" | "weekly"
  excludePatterns: jsonb("exclude_patterns").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("idle"), // "idle" | "crawling" | "completed" | "failed"
  lastCrawled: timestamp("last_crawled"),
  nextCrawl: timestamp("next_crawl"),
  error: text("error"),
  searchSettings: jsonb("search_settings").$type<SearchSettings>().notNull().default(sql`${JSON.stringify(defaultSearchSettings)}::jsonb`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Pages table for storing crawled page content
export const pages = pgTable("pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  siteId: varchar("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  url: text("url").notNull().unique(),
  title: text("title"),
  content: text("content"), // Extracted text content
  metaDescription: text("meta_description"),
  statusCode: integer("status_code"),
  lastCrawled: timestamp("last_crawled").notNull(),
  contentHash: text("content_hash"), // For detecting content changes
  // Full-Text Search vectors with weights (A=highest, D=lowest)
  searchVectorTitle: tsvector("search_vector_title"), // tsvector for title (weight A)
  searchVectorContent: tsvector("search_vector_content"), // tsvector for content+meta (weight C+B)
  searchVectorCombined: tsvector("search_vector_combined"), // combined tsvector with weights
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Search index for fast text search
export const searchIndex = pgTable("search_index", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pageId: varchar("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  term: text("term").notNull(),
  frequency: integer("frequency").notNull().default(1),
  position: integer("position").notNull(),
  relevance: doublePrecision("relevance"), // Add missing relevance column
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Relations
export const sitesRelations = relations(sites, ({ many }) => ({
  pages: many(pages),
}));

export const pagesRelations = relations(pages, ({ one, many }) => ({
  site: one(sites, {
    fields: [pages.siteId],
    references: [sites.id],
  }),
  searchIndex: many(searchIndex),
}));

export const searchIndexRelations = relations(searchIndex, ({ one }) => ({
  page: one(pages, {
    fields: [searchIndex.pageId],
    references: [pages.id],
  }),
}));

// Zod schemas for validation
export const insertSiteSchema = createInsertSchema(sites).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  status: true,
  lastCrawled: true,
  nextCrawl: true,
  error: true,
}).extend({
  searchSettings: searchSettingsSchema.optional(),
});

export const insertPageSchema = createInsertSchema(pages).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSearchIndexSchema = createInsertSchema(searchIndex).omit({
  id: true,
  createdAt: true,
});

// Types
export type Site = typeof sites.$inferSelect;
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type Page = typeof pages.$inferSelect;
export type InsertPage = z.infer<typeof insertPageSchema>;
export type SearchIndexEntry = typeof searchIndex.$inferSelect;
export type InsertSearchIndexEntry = z.infer<typeof insertSearchIndexSchema>;

// Keep existing user types for potential future admin features
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
