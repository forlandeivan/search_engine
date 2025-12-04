import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  jsonb,
  customType,
  primaryKey,
  foreignKey,
  uniqueIndex,
  index,
  doublePrecision,
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

export const workspaceEmbedKeys = pgTable(
  "workspace_embed_keys",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    knowledgeBaseId: varchar("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    publicKey: text("public_key")
      .notNull()
      .unique()
      .default(sql`encode(gen_random_bytes(32), 'hex')`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceCollectionUnique: uniqueIndex("workspace_embed_keys_workspace_collection_idx").on(
      table.workspaceId,
      table.collection,
    ),
  }),
);

export const workspaceEmbedKeyDomains = pgTable(
  "workspace_embed_key_domains",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    embedKeyId: varchar("embed_key_id")
      .notNull()
      .references(() => workspaceEmbedKeys.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    domainUnique: uniqueIndex("workspace_embed_key_domains_unique_idx").on(
      table.embedKeyId,
      table.domain,
    ),
  }),
);

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

export const knowledgeNodeSourceTypes = ["manual", "import", "crawl"] as const;
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
    sourceConfig: jsonb("source_config")
      .$type<Record<string, unknown> | null>(),
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
    sourceUrl: text("source_url"),
    contentHash: text("content_hash"),
    language: text("language"),
    versionTag: text("version_tag"),
    crawledAt: timestamp("crawled_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
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
    textTsv: tsvector("text_tsv"),
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
    .min(1, "Укажите коллекцию Qdrant")
    .optional(),
  vectorFieldName: z.string().trim().min(1).optional(),
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

export interface LlmModelOption {
  label: string;
  value: string;
}

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

export const embeddingProviders = pgTable("embedding_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  providerType: text("provider_type").$type<EmbeddingProviderType>().notNull().default("gigachat"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  isGlobal: boolean("is_global").notNull().default(false),
  tokenUrl: text("token_url").notNull(),
  embeddingsUrl: text("embeddings_url").notNull(),
  authorizationKey: text("authorization_key").notNull(),
  scope: text("scope").notNull(),
  model: text("model").notNull(),
  maxTokensPerVectorization: integer("max_tokens_per_vectorization"),
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

export const knowledgeBaseRagRequests = pgTable("knowledge_base_rag_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  knowledgeBaseId: varchar("knowledge_base_id")
    .notNull()
    .references(() => knowledgeBases.id, { onDelete: "cascade" }),
  topK: integer("top_k"),
  bm25Weight: doublePrecision("bm25_weight"),
  bm25Limit: integer("bm25_limit"),
  vectorWeight: doublePrecision("vector_weight"),
  vectorLimit: integer("vector_limit"),
  embeddingProviderId: varchar("embedding_provider_id").references(() => embeddingProviders.id, {
    onDelete: "set null",
  }),
  collection: text("collection"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type KnowledgeBaseAskAiPipelineStepLog = {
  key: string;
  title?: string | null;
  status: "success" | "skipped" | "error";
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  error?: string | null;
};

export type KnowledgeBaseChunkSearchSettings = {
  topK?: number | null;
  bm25Weight?: number | null;
  synonyms?: string[];
  includeDrafts?: boolean;
  highlightResults?: boolean;
  filters?: string | null;
};

export type KnowledgeBaseRagSearchSettings = {
  topK?: number | null;
  bm25Weight?: number | null;
  bm25Limit?: number | null;
  vectorWeight?: number | null;
  vectorLimit?: number | null;
  embeddingProviderId?: string | null;
  collection?: string | null;
  llmProviderId?: string | null;
  llmModel?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  systemPrompt?: string | null;
  responseFormat?: "text" | "markdown" | "html" | null;
};

export const knowledgeBaseSearchSettings = pgTable(
  "knowledge_base_search_settings",
  {
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    knowledgeBaseId: varchar("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    chunkSettings: jsonb("chunk_settings").$type<KnowledgeBaseChunkSearchSettings | null>(),
    ragSettings: jsonb("rag_settings").$type<KnowledgeBaseRagSearchSettings | null>(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.knowledgeBaseId] }),
  }),
);

export const speechProviderTypes = ["stt", "tts"] as const;
export type SpeechProviderType = (typeof speechProviderTypes)[number];

export const speechProviderDirections = ["audio_to_text", "text_to_speech"] as const;
export type SpeechProviderDirection = (typeof speechProviderDirections)[number];

export const speechProviderStatuses = ["Disabled", "Enabled", "Error"] as const;
export type SpeechProviderStatus = (typeof speechProviderStatuses)[number];

export const speechProviders = pgTable("speech_providers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  providerType: text("provider_type").$type<SpeechProviderType>().notNull().default("stt"),
  direction: text("direction").$type<SpeechProviderDirection>().notNull().default("audio_to_text"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  status: text("status").$type<SpeechProviderStatus>().notNull().default("Disabled"),
  lastStatusChangedAt: timestamp("last_status_changed_at"),
  lastValidationAt: timestamp("last_validation_at"),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  configJson: jsonb("config_json").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  updatedByAdminId: varchar("updated_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const speechProviderSecrets = pgTable(
  "speech_provider_secrets",
  {
    providerId: text("provider_id")
      .notNull()
      .references(() => speechProviders.id, { onDelete: "cascade" }),
    secretKey: text("secret_key").notNull(),
    secretValue: text("secret_value").notNull().default(""),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.providerId, table.secretKey], name: "speech_provider_secrets_pk" }),
  }),
);

export const llmProviders = pgTable("llm_providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  name: text("name").notNull(),
  providerType: text("provider_type").$type<LlmProviderType>().notNull().default("gigachat"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  isGlobal: boolean("is_global").notNull().default(false),
  tokenUrl: text("token_url").notNull(),
  completionUrl: text("completion_url").notNull(),
  authorizationKey: text("authorization_key").notNull(),
  scope: text("scope").notNull(),
  model: text("model").notNull(),
  availableModels: jsonb("available_models")
    .$type<LlmModelOption[] | null>()
    .default(sql`'[]'::jsonb`),
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

export const unicaChatConfig = pgTable("unica_chat_config", {
  id: varchar("id").primaryKey().default("singleton"),
  llmProviderConfigId: varchar("llm_provider_config_id").references(() => llmProviders.id, {
    onDelete: "set null",
  }),
  modelId: text("model_id"),
  systemPrompt: text("system_prompt").notNull().default(""),
  temperature: doublePrecision("temperature").notNull().default(0.7),
  topP: doublePrecision("top_p").notNull().default(1),
  maxTokens: integer("max_tokens"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const skills = pgTable(
  "skills",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name"),
    description: text("description"),
    systemPrompt: text("system_prompt"),
    modelId: varchar("model_id"),
    llmProviderConfigId: varchar("llm_provider_config_id")
      .references(() => llmProviders.id, { onDelete: "set null" }),
    collectionName: text("collection_name")
      .references(() => workspaceVectorCollections.collectionName, { onDelete: "set null" }),
    isSystem: boolean("is_system").notNull().default(false),
    systemKey: text("system_key"),
    ragMode: text("rag_mode").notNull().default("all_collections"),
    ragCollectionIds: jsonb("rag_collection_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    ragTopK: integer("rag_top_k").notNull().default(5),
    ragMinScore: doublePrecision("rag_min_score").notNull().default(0.7),
    ragMaxContextTokens: integer("rag_max_context_tokens").default(3000),
    ragShowSources: boolean("rag_show_sources").notNull().default(true),
    ragBm25Weight: doublePrecision("rag_bm25_weight"),
    ragBm25Limit: integer("rag_bm25_limit"),
    ragVectorWeight: doublePrecision("rag_vector_weight"),
    ragVectorLimit: integer("rag_vector_limit"),
    ragEmbeddingProviderId: varchar("rag_embedding_provider_id").references(() => embeddingProviders.id, {
      onDelete: "set null",
    }),
    ragLlmTemperature: doublePrecision("rag_llm_temperature"),
    ragLlmMaxTokens: integer("rag_llm_max_tokens"),
    ragLlmResponseFormat: text("rag_llm_response_format"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceIdx: index("skills_workspace_idx").on(table.workspaceId),
    llmProviderConfigIdx: index("skills_llm_provider_config_idx").on(table.llmProviderConfigId),
    collectionIdx: index("skills_collection_name_idx").on(table.collectionName),
    workspaceSystemKeyUnique: uniqueIndex("skills_workspace_system_key_unique_idx").on(
      table.workspaceId,
      table.systemKey,
    ),
  }),
);

// Action scopes, targets, placements and modes
export const actionScopes = ["system", "workspace"] as const;
export type ActionScope = (typeof actionScopes)[number];

export const actionTargets = ["transcript", "message", "selection", "conversation"] as const;
export type ActionTarget = (typeof actionTargets)[number];

export const actionPlacements = ["canvas", "chat_message", "chat_toolbar"] as const;
export type ActionPlacement = (typeof actionPlacements)[number];

export const actionInputTypes = ["full_transcript", "full_text", "selection", "message_text"] as const;
export type ActionInputType = (typeof actionInputTypes)[number];

export const actionOutputModes = ["replace_text", "new_version", "new_message", "document"] as const;
export type ActionOutputMode = (typeof actionOutputModes)[number];

export const actions = pgTable(
  "actions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    scope: text("scope").$type<ActionScope>().notNull().default("workspace"),
    workspaceId: varchar("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    description: text("description"),
    target: text("target").$type<ActionTarget>().notNull(),
    placements: text("placements").array().notNull().default(sql`'{}'::text[]`),
    promptTemplate: text("prompt_template").notNull(),
    inputType: text("input_type").$type<ActionInputType>().notNull().default("full_text"),
    outputMode: text("output_mode").$type<ActionOutputMode>().notNull().default("replace_text"),
    llmConfigId: varchar("llm_config_id").references(() => llmProviders.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceIdx: index("actions_workspace_idx").on(table.workspaceId),
    scopeIdx: index("actions_scope_idx").on(table.scope),
  }),
);

export const skillActions = pgTable(
  "skill_actions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    skillId: varchar("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    actionId: varchar("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    enabledPlacements: text("enabled_placements").array().notNull().default(sql`'{}'::text[]`),
    labelOverride: text("label_override"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    skillIdx: index("skill_actions_skill_idx").on(table.skillId),
    actionIdx: index("skill_actions_action_idx").on(table.actionId),
    skillActionUnique: uniqueIndex("skill_actions_skill_action_unique_idx").on(table.skillId, table.actionId),
  }),
);

export const chatMessageRoles = ["user", "assistant", "system"] as const;
export type ChatMessageRole = (typeof chatMessageRoles)[number];

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    skillId: varchar("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    workspaceUserIdx: index("chat_sessions_workspace_user_idx").on(
      table.workspaceId,
      table.userId,
      table.createdAt,
    ),
  }),
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role").$type<ChatMessageRole>().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<ChatMessageMetadata>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    chatIdx: index("chat_messages_chat_idx").on(table.chatId, table.createdAt),
  }),
);

export const transcriptStatuses = ["processing", "ready", "failed"] as const;
export type TranscriptStatus = (typeof transcriptStatuses)[number];

export type ChatMessageMetadata = {
  transcriptId?: string;
  transcriptStatus?: TranscriptStatus;
  [key: string]: unknown;
};

export const transcripts = pgTable(
  "transcripts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    sourceFileId: varchar("source_file_id"),
    status: text("status").$type<TranscriptStatus>().notNull().default("processing"),
    title: text("title"),
    previewText: text("preview_text"),
    fullText: text("full_text"),
    lastEditedByUserId: varchar("last_edited_by_user_id"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceIdx: index("transcripts_workspace_idx").on(table.workspaceId),
    chatIdx: index("transcripts_chat_idx").on(table.chatId),
    statusIdx: index("transcripts_status_idx").on(table.status),
  }),
);

export const skillRagModes = ["all_collections", "selected_collections"] as const;
export type SkillRagMode = (typeof skillRagModes)[number];

export const skillKnowledgeBases = pgTable(
  "skill_knowledge_bases",
  {
    skillId: varchar("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    knowledgeBaseId: varchar("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.skillId, table.knowledgeBaseId] }),
    workspaceIdx: index("skill_knowledge_bases_workspace_idx").on(table.workspaceId),
    knowledgeBaseIdx: index("skill_knowledge_bases_knowledge_base_idx").on(table.knowledgeBaseId),
  }),
);

export const knowledgeBaseAskAiRuns = pgTable("knowledge_base_ask_ai_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  knowledgeBaseId: varchar("knowledge_base_id")
    .notNull()
    .references(() => knowledgeBases.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  normalizedQuery: text("normalized_query"),
  status: text("status").notNull().default("success"),
  errorMessage: text("error_message"),
  topK: integer("top_k"),
  bm25Weight: doublePrecision("bm25_weight"),
  bm25Limit: integer("bm25_limit"),
  vectorWeight: doublePrecision("vector_weight"),
  vectorLimit: integer("vector_limit"),
  vectorCollection: text("vector_collection"),
  embeddingProviderId: varchar("embedding_provider_id").references(() => embeddingProviders.id, {
    onDelete: "set null",
  }),
  llmProviderId: varchar("llm_provider_id").references(() => llmProviders.id, {
    onDelete: "set null",
  }),
  llmModel: text("llm_model"),
  bm25ResultCount: integer("bm25_result_count"),
  vectorResultCount: integer("vector_result_count"),
  vectorDocumentCount: integer("vector_document_count"),
  combinedResultCount: integer("combined_result_count"),
  embeddingTokens: integer("embedding_tokens"),
  llmTokens: integer("llm_tokens"),
  totalTokens: integer("total_tokens"),
  retrievalDurationMs: doublePrecision("retrieval_duration_ms"),
  bm25DurationMs: doublePrecision("bm25_duration_ms"),
  vectorDurationMs: doublePrecision("vector_duration_ms"),
  llmDurationMs: doublePrecision("llm_duration_ms"),
  totalDurationMs: doublePrecision("total_duration_ms"),
  startedAt: timestamp("started_at"),
  pipelineLog: jsonb("pipeline_log").$type<KnowledgeBaseAskAiPipelineStepLog[] | null>(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Relations
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
    maxTokensPerVectorization: z
      .number({ invalid_type_error: "Введите максимальное количество токенов" })
      .int("Значение должно быть целым")
      .positive("Значение должно быть больше нуля")
      .max(100000, "Значение слишком большое")
      .optional(),
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
    maxTokensPerVectorization: z
      .number({ invalid_type_error: "Введите максимальное количество токенов" })
      .int("Значение должно быть целым")
      .positive("Значение должно быть больше нуля")
      .max(100000, "Значение слишком большое")
      .nullable()
      .optional(),
    requestHeaders: z.record(z.string()).optional(),
    qdrantConfig: z.record(z.any()).optional(),
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
    availableModels: z
      .array(
        z.object({
          label: z.string().trim().min(1, "Введите название модели"),
          value: z.string().trim().min(1, "Введите идентификатор модели"),
        }),
      )
      .max(50, "Слишком много моделей")
      .optional()
      .transform((models) =>
        models
          ? models
              .map((model) => ({
                label: model.label.trim(),
                value: model.value.trim(),
              }))
              .filter((model) => model.label.length > 0 && model.value.length > 0)
          : undefined,
      ),
    allowSelfSignedCertificate: z.boolean().default(false),
    requestHeaders: z.record(z.string()).default({}),
    requestConfig: z
      .any()
      .optional()
      .transform((value) => {
        const config =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};

        return {
          ...DEFAULT_LLM_REQUEST_CONFIG,
          ...config,
        } as LlmRequestConfig;
      }),
    responseConfig: z
      .any()
      .optional()
      .transform((value) => {
        const config =
          value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};

        return {
          ...DEFAULT_LLM_RESPONSE_CONFIG,
          ...config,
        } as LlmResponseConfig;
      }),
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
    availableModels: z
      .array(
        z.object({
          label: z.string().trim().min(1, "Введите название модели"),
          value: z.string().trim().min(1, "Введите идентификатор модели"),
        }),
      )
      .max(50, "Слишком много моделей")
      .optional()
      .transform((models) =>
        models
          ? models
              .map((model) => ({
                label: model.label.trim(),
                value: model.value.trim(),
              }))
              .filter((model) => model.label.length > 0 && model.value.length > 0)
          : undefined,
      ),
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
export type InsertUser = z.infer<typeof insertUserSchema>;
export type WorkspaceEmbedKey = typeof workspaceEmbedKeys.$inferSelect;
export type WorkspaceEmbedKeyInsert = typeof workspaceEmbedKeys.$inferInsert;
export type WorkspaceEmbedKeyDomain = typeof workspaceEmbedKeyDomains.$inferSelect;
export type WorkspaceEmbedKeyDomainInsert = typeof workspaceEmbedKeyDomains.$inferInsert;
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
export type SpeechProvider = typeof speechProviders.$inferSelect;
export type SpeechProviderInsert = typeof speechProviders.$inferInsert;
export type SpeechProviderSecret = typeof speechProviderSecrets.$inferSelect;
export type LlmProvider = typeof llmProviders.$inferSelect;
export type LlmProviderInsert = typeof llmProviders.$inferInsert;
export type UnicaChatConfig = typeof unicaChatConfig.$inferSelect;
export type UnicaChatConfigInsert = typeof unicaChatConfig.$inferInsert;
export type InsertLlmProvider = z.infer<typeof insertLlmProviderSchema>;
export type UpdateLlmProvider = z.infer<typeof updateLlmProviderSchema>;
export type PublicLlmProvider = Omit<LlmProvider, "authorizationKey" | "availableModels"> & {
  hasAuthorizationKey: boolean;
  availableModels: LlmModelOption[];
};
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatSessionInsert = typeof chatSessions.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChatMessageInsert = typeof chatMessages.$inferInsert;
export type Transcript = typeof transcripts.$inferSelect;
export type TranscriptInsert = typeof transcripts.$inferInsert;
export type KnowledgeBaseRagRequest = typeof knowledgeBaseRagRequests.$inferSelect;
export type KnowledgeBaseRagRequestInsert = typeof knowledgeBaseRagRequests.$inferInsert;
export type KnowledgeBaseSearchSettingsRow = typeof knowledgeBaseSearchSettings.$inferSelect;
export type KnowledgeBaseSearchSettingsInsert = typeof knowledgeBaseSearchSettings.$inferInsert;
export type KnowledgeBaseAskAiRun = typeof knowledgeBaseAskAiRuns.$inferSelect;
export type KnowledgeBaseAskAiRunInsert = typeof knowledgeBaseAskAiRuns.$inferInsert;
export type KnowledgeDocumentChunkSet = typeof knowledgeDocumentChunkSets.$inferSelect;
export type KnowledgeDocumentChunkSetInsert = typeof knowledgeDocumentChunkSets.$inferInsert;
export type KnowledgeDocumentChunkItem = typeof knowledgeDocumentChunkItems.$inferSelect;
export type KnowledgeDocumentChunkItemInsert = typeof knowledgeDocumentChunkItems.$inferInsert;
export type Action = typeof actions.$inferSelect;
export type ActionInsert = typeof actions.$inferInsert;
export type SkillAction = typeof skillActions.$inferSelect;
export type SkillActionInsert = typeof skillActions.$inferInsert;
