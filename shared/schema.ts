import { sql, relations } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  doublePrecision,
  customType,
} from "drizzle-orm/pg-core";
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

// Users table for platform authentication
export const userRoles = ["admin", "user"] as const;
export type UserRole = (typeof userRoles)[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  phone: text("phone").notNull().default(""),
  passwordHash: text("password_hash"),
  role: text("role").$type<UserRole>().notNull().default("user"),
  lastActiveAt: timestamp("last_active_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  personalApiTokenHash: text("personal_api_token_hash"),
  personalApiTokenLastFour: text("personal_api_token_last_four"),
  personalApiTokenGeneratedAt: timestamp("personal_api_token_generated_at"),
  googleId: text("google_id").unique(),
  googleAvatar: text("google_avatar").notNull().default(""),
  googleEmailVerified: boolean("google_email_verified").notNull().default(false),
});

export const personalApiTokens = pgTable("personal_api_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  lastFour: text("last_four").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  revokedAt: timestamp("revoked_at"),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  role: true,
  createdAt: true,
  updatedAt: true,
  lastActiveAt: true,
  personalApiTokenHash: true,
  personalApiTokenLastFour: true,
  personalApiTokenGeneratedAt: true,
  googleAvatar: true,
  googleEmailVerified: true,
});

export const embeddingProviderTypes = ["gigachat", "custom"] as const;
export type EmbeddingProviderType = (typeof embeddingProviderTypes)[number];

export const embeddingRequestConfigSchema = z
  .object({
    inputField: z.string().trim().min(1, "Укажите ключ поля с текстом"),
    modelField: z.string().trim().min(1, "Укажите ключ модели").default("model"),
    batchField: z.string().trim().min(1).optional(),
    additionalBodyFields: z
      .record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.any()), z.record(z.any())]))
      .default({}),
  })
  .default({ inputField: "input", modelField: "model", additionalBodyFields: {} });

export const embeddingResponseConfigSchema = z
  .object({
    vectorPath: z
      .string()
      .trim()
      .min(1, "Укажите JSON-путь до вектора в ответе"),
    idPath: z.string().trim().min(1).optional(),
    usageTokensPath: z.string().trim().min(1).optional(),
    rawVectorType: z.enum(["float32", "float64"]).default("float32"),
  })
  .default({ vectorPath: "data[0].embedding", rawVectorType: "float32" });

export const qdrantIntegrationConfigSchema = z.object({
  collectionName: z
    .string()
    .trim()
    .min(1, "Укажите коллекцию Qdrant"),
  vectorFieldName: z.string().trim().min(1).default("vector"),
  payloadFields: z.record(z.string()).default({}),
  vectorSize: z
    .union([z.number().int().positive(), z.string().trim().min(1)])
    .optional(),
  upsertMode: z
    .union([z.enum(["replace", "append"]), z.string().trim().min(1)])
    .default("replace"),
});

export type EmbeddingRequestConfig = z.infer<typeof embeddingRequestConfigSchema>;
export type EmbeddingResponseConfig = z.infer<typeof embeddingResponseConfigSchema>;
export type QdrantIntegrationConfig = z.infer<typeof qdrantIntegrationConfigSchema>;

export const DEFAULT_EMBEDDING_REQUEST_CONFIG: EmbeddingRequestConfig = {
  inputField: "input",
  modelField: "model",
  additionalBodyFields: {
    encoding_format: "float",
  },
};

export const DEFAULT_EMBEDDING_RESPONSE_CONFIG: EmbeddingResponseConfig = {
  vectorPath: "data[0].embedding",
  usageTokensPath: "usage.total_tokens",
  rawVectorType: "float32",
};

export const DEFAULT_QDRANT_CONFIG: QdrantIntegrationConfig = {
  collectionName: "auto",
  vectorFieldName: "vector",
  payloadFields: {},
  upsertMode: "replace",
};

export const registerUserSchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .min(1, "Введите имя")
      .max(200, "Слишком длинное имя"),
    email: z.string().trim().email("Некорректный email"),
    password: z
      .string()
      .min(8, "Минимальная длина пароля 8 символов")
      .max(100, "Слишком длинный пароль"),
  })
  .strict();

// Sites table for storing crawl configurations
export const sites = pgTable("sites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().default("Новый проект"),
  url: text("url").notNull().unique(),
  startUrls: jsonb("start_urls").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  crawlDepth: integer("crawl_depth").notNull().default(3),
  maxChunkSize: integer("max_chunk_size").notNull().default(1200),
  chunkOverlap: boolean("chunk_overlap").notNull().default(false),
  chunkOverlapSize: integer("chunk_overlap_size").notNull().default(0),
  followExternalLinks: boolean("follow_external_links").notNull().default(false),
  crawlFrequency: text("crawl_frequency").notNull().default("manual"), // "manual" | "hourly" | "daily" | "weekly"
  excludePatterns: jsonb("exclude_patterns").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("idle"), // "idle" | "crawling" | "completed" | "failed"
  lastCrawled: timestamp("last_crawled"),
  nextCrawl: timestamp("next_crawl"),
  error: text("error"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  ownerId: varchar("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  publicId: varchar("public_id")
    .notNull()
    .unique()
    .default(sql`gen_random_uuid()`),
  publicApiKey: text("public_api_key")
    .notNull()
    .default(sql`encode(gen_random_bytes(32), 'hex')`),
  publicApiKeyGeneratedAt: timestamp("public_api_key_generated_at")
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
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

export const embeddingProviders = pgTable("embedding_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  providerType: text("provider_type").$type<EmbeddingProviderType>().notNull().default("gigachat"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  tokenUrl: text("token_url").notNull(),
  embeddingsUrl: text("embeddings_url").notNull(),
  authorizationKey: text("authorization_key").notNull(),
  scope: text("scope").notNull(),
  model: text("model").notNull(),
  allowSelfSignedCertificate: boolean("allow_self_signed_certificate").notNull().default(false),
  requestHeaders: jsonb("request_headers").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  requestConfig: jsonb("request_config").$type<EmbeddingRequestConfig>().notNull().default(sql`'{}'::jsonb`),
  responseConfig: jsonb("response_config").$type<EmbeddingResponseConfig>().notNull().default(sql`'{}'::jsonb`),
  qdrantConfig: jsonb("qdrant_config").$type<QdrantIntegrationConfig>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
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
    ownerId: true,
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
    chunkOverlap: z.boolean().default(false),
    chunkOverlapSize: z
      .number()
      .int("Перехлест должен быть целым числом")
      .min(0, "Перехлест не может быть отрицательным")
      .max(4000, "Максимальный перехлест 4000 символов")
      .default(0),
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

export const insertEmbeddingProviderSchema = createInsertSchema(embeddingProviders)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    name: z.string().trim().min(1, "Укажите название сервиса").max(200, "Слишком длинное название"),
    providerType: z.enum(embeddingProviderTypes).default("gigachat"),
    isActive: z.boolean().default(true),
    description: z
      .string()
      .trim()
      .max(1000, "Описание слишком длинное")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    tokenUrl: z
      .string()
      .trim()
      .url("Некорректный URL для получения Access Token"),
    embeddingsUrl: z
      .string()
      .trim()
      .url("Некорректный URL сервиса эмбеддингов"),
    authorizationKey: z.string().trim().min(1, "Укажите Authorization key"),
    scope: z.string().trim().min(1, "Укажите OAuth scope"),
    model: z.string().trim().min(1, "Укажите модель"),
    allowSelfSignedCertificate: z.boolean().default(false),
    requestHeaders: z.record(z.string()).default({}),
    requestConfig: z
      .any()
      .optional()
      .transform(() => ({ ...DEFAULT_EMBEDDING_REQUEST_CONFIG } as EmbeddingRequestConfig)),
    responseConfig: z
      .any()
      .optional()
      .transform(() => ({ ...DEFAULT_EMBEDDING_RESPONSE_CONFIG } as EmbeddingResponseConfig)),
    qdrantConfig: z
      .any()
      .optional()
      .transform(() => ({ ...DEFAULT_QDRANT_CONFIG } as QdrantIntegrationConfig)),
  });

export const updateEmbeddingProviderSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название сервиса").max(200, "Слишком длинное название").optional(),
    providerType: z.enum(embeddingProviderTypes).optional(),
    description: z
      .string()
      .trim()
      .max(1000, "Описание слишком длинное")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    isActive: z.boolean().optional(),
    tokenUrl: z
      .string()
      .trim()
      .url("Некорректный URL для получения Access Token")
      .optional(),
    embeddingsUrl: z
      .string()
      .trim()
      .url("Некорректный URL сервиса эмбеддингов")
      .optional(),
    authorizationKey: z.string().trim().min(1, "Укажите Authorization key").optional(),
    scope: z.string().trim().min(1, "Укажите OAuth scope").optional(),
    model: z.string().trim().min(1, "Укажите модель").optional(),
    allowSelfSignedCertificate: z.boolean().optional(),
    requestHeaders: z.record(z.string()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Нет данных для обновления",
  });

// Types
export type Site = typeof sites.$inferSelect;
export type InsertSite = z.infer<typeof insertSiteSchema>;
export type SiteInsert = typeof sites.$inferInsert;
export type Page = typeof pages.$inferSelect;
export type InsertPage = z.infer<typeof insertPageSchema>;
export type SearchIndexEntry = typeof searchIndex.$inferSelect;
export type InsertSearchIndexEntry = z.infer<typeof insertSearchIndexSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PublicUser = Omit<
  User,
  "passwordHash" | "personalApiTokenHash" | "personalApiTokenLastFour"
> & {
  hasPersonalApiToken: boolean;
  personalApiTokenLastFour: string | null;
};
export type PersonalApiToken = typeof personalApiTokens.$inferSelect;
export type InsertPersonalApiToken = typeof personalApiTokens.$inferInsert;
export type PublicPersonalApiToken = Omit<PersonalApiToken, "tokenHash" | "userId">;
export type EmbeddingProvider = typeof embeddingProviders.$inferSelect;
export type EmbeddingProviderInsert = typeof embeddingProviders.$inferInsert;
export type InsertEmbeddingProvider = z.infer<typeof insertEmbeddingProviderSchema>;
export type UpdateEmbeddingProvider = z.infer<typeof updateEmbeddingProviderSchema>;
export type PublicEmbeddingProvider = Omit<EmbeddingProvider, "authorizationKey"> & {
  hasAuthorizationKey: boolean;
};
