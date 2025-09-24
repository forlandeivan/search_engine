import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, doublePrecision, customType } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Custom type for PostgreSQL tsvector
const tsvector = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'tsvector';
  },
});

export interface ChunkMedia {
  src: string;
  alt?: string;
}

export interface ContentChunk {
  id: string;
  heading: string;
  level: number;
  content: string;
  deepLink: string;
  metadata: {
    images: ChunkMedia[];
    links: string[];
    position: number;
    wordCount: number;
    charCount: number;
    estimatedReadingTimeSec: number;
    excerpt: string;
  };
}

export interface PageMetadata {
  description?: string;
  keywords?: string;
  author?: string;
  publishDate?: string;
  images?: string[];
  links?: string[];
  language?: string;
  extractedAt: string;
  totalChunks: number;
  wordCount: number;
  estimatedReadingTimeSec: number;
}

// Sites table for storing crawl configurations
export const sites = pgTable("sites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().default("Новый проект"),
  url: text("url").notNull().unique(),
  startUrls: jsonb("start_urls").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  crawlDepth: integer("crawl_depth").notNull().default(3),
  maxChunkSize: integer("max_chunk_size").notNull().default(1200),
  followExternalLinks: boolean("follow_external_links").notNull().default(false),
  crawlFrequency: text("crawl_frequency").notNull().default("manual"), // "manual" | "hourly" | "daily" | "weekly"
  excludePatterns: jsonb("exclude_patterns").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("idle"), // "idle" | "crawling" | "completed" | "failed"
  lastCrawled: timestamp("last_crawled"),
  nextCrawl: timestamp("next_crawl"),
  error: text("error"),
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
  metadata: jsonb("metadata").$type<PageMetadata>().default(sql`'{}'::jsonb`).notNull(),
  chunks: jsonb("chunks").$type<ContentChunk[]>().default(sql`'[]'::jsonb`).notNull(),
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
export const insertSiteSchema = createInsertSchema(sites)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    status: true,
    lastCrawled: true,
    nextCrawl: true,
    error: true,
  })
  .extend({
    name: z.string().trim().min(1, "Название проекта обязательно").max(200, "Слишком длинное название"),
    url: z.string().trim().url("Некорректный URL"),
    startUrls: z
      .array(z.string().trim().url("Некорректный URL"))
      .min(1, "Укажите хотя бы один URL"),
    crawlDepth: z.number().int().min(1, "Минимальная глубина 1").max(10, "Слишком большая глубина"),
    maxChunkSize: z
      .number()
      .int("Размер чанка должен быть целым числом")
      .min(200, "Минимальный размер чанка 200 символов")
      .max(8000, "Максимальный размер чанка 8000 символов"),
    crawlFrequency: z
      .string()
      .trim()
      .optional()
      .transform((value) => value ?? "manual"),
    followExternalLinks: z.boolean().optional(),
    excludePatterns: z.array(z.string()).optional(),
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
