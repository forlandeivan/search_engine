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
  primaryKey,
  foreignKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Custom type for PostgreSQL tsvector
const tsvector = customType<{ data: unknown; driverData: unknown }>({
  dataType() {
    return 'tsvector';
  },
});

const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return "ltree";
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
  yandexId: text("yandex_id").unique(),
  yandexAvatar: text("yandex_avatar").notNull().default(""),
  yandexEmailVerified: boolean("yandex_email_verified").notNull().default(false),
});

export const workspacePlans = ["free", "team"] as const;
export type WorkspacePlan = (typeof workspacePlans)[number];

export const workspaces = pgTable("workspaces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ownerId: varchar("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan").$type<WorkspacePlan>().notNull().default("free"),
  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const workspaceMemberRoles = ["owner", "manager", "user"] as const;
export type WorkspaceMemberRole = (typeof workspaceMemberRoles)[number];

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceMemberRole>().notNull().default("user"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
  }),
);

export const workspaceVectorCollections = pgTable("workspace_vector_collections", {
  collectionName: text("collection_name").primaryKey(),
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
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

export const authProviders = pgTable("auth_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").$type<AuthProviderType>().notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(false),
  clientId: text("client_id").notNull().default(""),
  clientSecret: text("client_secret").notNull().default(""),
  callbackUrl: text("callback_url").notNull().default("/api/auth/google/callback"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeBaseNodeTypes = ["folder", "document"] as const;
export type KnowledgeBaseNodeType = (typeof knowledgeBaseNodeTypes)[number];

export const knowledgeNodeSourceTypes = ["manual", "import"] as const;
export type KnowledgeNodeSourceType = (typeof knowledgeNodeSourceTypes)[number];

export const knowledgeBases = pgTable("knowledge_bases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("База знаний"),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const knowledgeNodes = pgTable(
  "knowledge_nodes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    baseId: varchar("base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    parentId: varchar("parent_id"),
    title: text("title").notNull().default("Без названия"),
    type: text("type").$type<KnowledgeBaseNodeType>().notNull().default("document"),
    content: text("content"),
    slug: text("slug").notNull().default(""),
    path: ltree("path").notNull(),
    sourceType: text("source_type")
      .$type<KnowledgeNodeSourceType>()
      .notNull()
      .default("manual"),
    importFileName: text("import_file_name"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    parentReference: foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "knowledge_nodes_parent_id_fkey",
    }).onDelete("cascade"),
    baseSlugUnique: uniqueIndex("knowledge_nodes_base_slug_idx").on(
      table.baseId,
      table.slug,
    ),
  }),
);

export const knowledgeDocumentStatuses = ["draft", "published", "archived"] as const;
export type KnowledgeDocumentStatus = (typeof knowledgeDocumentStatuses)[number];

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    baseId: varchar("base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    nodeId: varchar("node_id")
      .notNull()
      .references(() => knowledgeNodes.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<KnowledgeDocumentStatus>()
      .notNull()
      .default("draft"),
    currentVersionId: varchar("current_version_id"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    nodeUnique: uniqueIndex("knowledge_documents_node_id_key").on(table.nodeId),
  }),
);

export const knowledgeDocumentVersions = pgTable(
  "knowledge_document_versions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    documentId: varchar("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    authorId: varchar("author_id").references(() => users.id, { onDelete: "set null" }),
    contentJson: jsonb("content_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    contentText: text("content_text").notNull().default(""),
    hash: text("hash"),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    documentVersionUnique: uniqueIndex(
      "knowledge_document_versions_document_version_idx",
    ).on(table.documentId, table.versionNo),
  }),
);

export const knowledgeDocumentChunkSets = pgTable(
  "knowledge_document_chunk_sets",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: varchar("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: varchar("version_id")
      .notNull()
      .references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    documentHash: text("document_hash"),
    maxTokens: integer("max_tokens"),
    maxChars: integer("max_chars"),
    overlapTokens: integer("overlap_tokens"),
    overlapChars: integer("overlap_chars"),
    splitByPages: boolean("split_by_pages").notNull().default(false),
    respectHeadings: boolean("respect_headings").notNull().default(true),
    chunkCount: integer("chunk_count").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    totalChars: integer("total_chars").notNull().default(0),
    isLatest: boolean("is_latest").notNull().default(true),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    documentLatestIndex: index("knowledge_document_chunk_sets_document_latest_idx").on(
      table.documentId,
      table.isLatest,
    ),
    documentCreatedIndex: index("knowledge_document_chunk_sets_document_idx").on(
      table.documentId,
      table.createdAt,
    ),
  }),
);

export const knowledgeDocumentChunkItems = pgTable(
  "knowledge_document_chunks",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    chunkSetId: varchar("chunk_set_id")
      .notNull()
      .references(() => knowledgeDocumentChunkSets.id, { onDelete: "cascade" }),
    documentId: varchar("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: varchar("version_id")
      .notNull()
      .references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    tokenCount: integer("token_count").notNull(),
    pageNumber: integer("page_number"),
    sectionPath: text("section_path").array(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    contentHash: text("content_hash").notNull(),
    vectorRecordId: text("vector_record_id"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    chunkSetIndex: uniqueIndex("knowledge_document_chunks_set_index_idx").on(
      table.chunkSetId,
      table.chunkIndex,
    ),
    documentIndex: index("knowledge_document_chunks_document_idx").on(
      table.documentId,
      table.chunkIndex,
    ),
  }),
);

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
  yandexAvatar: true,
  yandexEmailVerified: true,
});

export const embeddingProviderTypes = ["gigachat", "custom"] as const;
export type EmbeddingProviderType = (typeof embeddingProviderTypes)[number];

export const llmProviderTypes = ["gigachat", "custom"] as const;
export type LlmProviderType = (typeof llmProviderTypes)[number];

export const authProviderTypes = ["google", "yandex"] as const;
export type AuthProviderType = (typeof authProviderTypes)[number];

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
export type LlmRequestConfig = z.infer<typeof llmRequestConfigSchema>;
export type LlmResponseConfig = z.infer<typeof llmResponseConfigSchema>;

export const llmRequestConfigSchema = z
  .object({
    modelField: z.string().trim().min(1, "Укажите ключ модели").default("model"),
    messagesField: z.string().trim().min(1, "Укажите ключ массива сообщений").default("messages"),
    systemPrompt: z
      .string()
      .trim()
      .max(4000, "Слишком длинный системный промпт")
      .optional()
      .nullable(),
    temperature: z.number().min(0).max(2).default(0.2),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
    presencePenalty: z.number().min(-2).max(2).optional(),
    frequencyPenalty: z.number().min(-2).max(2).optional(),
    additionalBodyFields: z
      .record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.any()), z.record(z.any())]))
      .default({}),
  })
  .default({ messagesField: "messages", modelField: "model", temperature: 0.2, additionalBodyFields: {} });

export const llmResponseConfigSchema = z
  .object({
    messagePath: z
      .string()
      .trim()
      .min(1, "Укажите JSON-путь до текста ответа"),
    usageTokensPath: z.string().trim().min(1).optional(),
  })
  .default({ messagePath: "choices[0].message.content" });

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

export const DEFAULT_LLM_REQUEST_CONFIG = {
  modelField: "model",
  messagesField: "messages",
  temperature: 0.2,
  systemPrompt:
    "Ты — помощник для базы знаний. Отвечай на вопросы пользователя на основе предоставленных фрагментов контента. Если в фрагментах нет ответа, честно сообщи об этом.",
  maxTokens: 1024,
  additionalBodyFields: {
    stream: false,
  },
} as const satisfies z.infer<typeof llmRequestConfigSchema>;

export const DEFAULT_LLM_RESPONSE_CONFIG = {
  messagePath: "choices[0].message.content",
  usageTokensPath: "usage.total_tokens",
} as const satisfies z.infer<typeof llmResponseConfigSchema>;

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
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
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
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
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
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
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
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const llmProviders = pgTable("llm_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  name: text("name").notNull(),
  providerType: text("provider_type").$type<LlmProviderType>().notNull().default("gigachat"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  tokenUrl: text("token_url").notNull(),
  completionUrl: text("completion_url").notNull(),
  authorizationKey: text("authorization_key").notNull(),
  scope: text("scope").notNull(),
  model: text("model").notNull(),
  allowSelfSignedCertificate: boolean("allow_self_signed_certificate").notNull().default(false),
  requestHeaders: jsonb("request_headers").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  requestConfig: jsonb("request_config").$type<LlmRequestConfig>().notNull().default(sql`'{}'::jsonb`),
  responseConfig: jsonb("response_config").$type<LlmResponseConfig>().notNull().default(sql`'{}'::jsonb`),
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
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
    workspaceId: true,
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
  workspaceId: true,
});

export const insertSearchIndexSchema = createInsertSchema(searchIndex).omit({
  id: true,
  createdAt: true,
  workspaceId: true,
});

export const insertEmbeddingProviderSchema = createInsertSchema(embeddingProviders)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    workspaceId: true,
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

export const insertLlmProviderSchema = createInsertSchema(llmProviders)
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
    workspaceId: true,
  })
  .extend({
    name: z.string().trim().min(1, "Укажите название сервиса").max(200, "Слишком длинное название"),
    providerType: z.enum(llmProviderTypes).default("gigachat"),
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
    completionUrl: z
      .string()
      .trim()
      .url("Некорректный URL сервиса LLM"),
    authorizationKey: z.string().trim().min(1, "Укажите Authorization key"),
    scope: z.string().trim().min(1, "Укажите OAuth scope"),
    model: z.string().trim().min(1, "Укажите модель"),
    allowSelfSignedCertificate: z.boolean().default(false),
    requestHeaders: z.record(z.string()).default({}),
    requestConfig: z
      .any()
      .optional()
      .transform(() => ({ ...DEFAULT_LLM_REQUEST_CONFIG } as LlmRequestConfig)),
    responseConfig: z
      .any()
      .optional()
      .transform(() => ({ ...DEFAULT_LLM_RESPONSE_CONFIG } as LlmResponseConfig)),
  });

export const updateLlmProviderSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название сервиса").max(200, "Слишком длинное название").optional(),
    providerType: z.enum(llmProviderTypes).optional(),
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
    completionUrl: z
      .string()
      .trim()
      .url("Некорректный URL сервиса LLM")
      .optional(),
    authorizationKey: z.string().trim().min(1, "Укажите Authorization key").optional(),
    scope: z.string().trim().min(1, "Укажите OAuth scope").optional(),
    model: z.string().trim().min(1, "Укажите модель").optional(),
    allowSelfSignedCertificate: z.boolean().optional(),
    requestHeaders: z.record(z.string()).optional(),
    requestConfig: z.record(z.any()).optional(),
    responseConfig: z.record(z.any()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Нет данных для обновления",
  });

const callbackUrlSchema = z
  .string()
  .trim()
  .min(1, "Укажите Callback URL")
  .max(500, "Слишком длинный Callback URL")
  .refine(
    (value) => {
      if (value.startsWith("/")) {
        return true;
      }

      try {
        void new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Укажите абсолютный URL или путь, начинающийся с /" },
  );

export const upsertAuthProviderSchema = z
  .object({
    provider: z.enum(authProviderTypes),
    clientId: z
      .string()
      .trim()
      .min(1, "Укажите Client ID")
      .max(200, "Слишком длинный Client ID"),
    clientSecret: z
      .string()
      .trim()
      .max(200, "Слишком длинный Client Secret")
      .optional(),
    callbackUrl: callbackUrlSchema,
    isEnabled: z.boolean(),
  })
  .strict();

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
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceInsert = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceMemberInsert = typeof workspaceMembers.$inferInsert;
export type WorkspaceVectorCollection = typeof workspaceVectorCollections.$inferSelect;
export type AuthProvider = typeof authProviders.$inferSelect;
export type AuthProviderInsert = typeof authProviders.$inferInsert;
export type EmbeddingProvider = typeof embeddingProviders.$inferSelect;
export type EmbeddingProviderInsert = typeof embeddingProviders.$inferInsert;
export type InsertEmbeddingProvider = z.infer<typeof insertEmbeddingProviderSchema>;
export type UpdateEmbeddingProvider = z.infer<typeof updateEmbeddingProviderSchema>;
export type UpsertAuthProvider = z.infer<typeof upsertAuthProviderSchema>;
export type PublicEmbeddingProvider = Omit<EmbeddingProvider, "authorizationKey"> & {
  hasAuthorizationKey: boolean;
};
export type LlmProvider = typeof llmProviders.$inferSelect;
export type LlmProviderInsert = typeof llmProviders.$inferInsert;
export type InsertLlmProvider = z.infer<typeof insertLlmProviderSchema>;
export type UpdateLlmProvider = z.infer<typeof updateLlmProviderSchema>;
export type PublicLlmProvider = Omit<LlmProvider, "authorizationKey"> & {
  hasAuthorizationKey: boolean;
};
export type KnowledgeDocumentChunkSet = typeof knowledgeDocumentChunkSets.$inferSelect;
export type KnowledgeDocumentChunkSetInsert = typeof knowledgeDocumentChunkSets.$inferInsert;
export type KnowledgeDocumentChunkItem = typeof knowledgeDocumentChunkItems.$inferSelect;
export type KnowledgeDocumentChunkItemInsert = typeof knowledgeDocumentChunkItems.$inferInsert;
