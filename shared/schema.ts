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
  (table) => [index("idx_workspace_embed_keys_kb").on(table.knowledgeBaseId)],
);

export const authProviders = pgTable(
  "auth_providers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    providerType: text("provider_type").notNull(),
    name: text("name").notNull(),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_auth_providers_workspace").on(table.workspaceId)],
);

export const embeddingProviders = pgTable(
  "embedding_providers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    providerType: text("provider_type").notNull().default("openai"),
    isActive: boolean("is_active").notNull().default(true),
    model: text("model").notNull().default(""),
    embeddingDimension: integer("embedding_dimension"),
    maxInputTokens: integer("max_input_tokens"),
    costPer1mTokens: doublePrecision("cost_per_1m_tokens"),
    authorizationKey: text("authorization_key"),
    baseUrl: text("base_url"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_embedding_providers_workspace").on(table.workspaceId)],
);

export const llmProviders = pgTable(
  "llm_providers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    description: text("description"),
    tokenUrl: text("token_url"),
    completionUrl: text("completion_url"),
    authorizationKey: text("authorization_key"),
    scope: text("scope"),
    model: text("model").notNull(),
    availableModels: jsonb("available_models")
      .$type<Array<{ label: string; value: string }>>()
      .default(sql`'[]'::jsonb`),
    allowSelfSignedCertificate: boolean("allow_self_signed_certificate").default(false),
    requestHeaders: jsonb("request_headers")
      .$type<Record<string, string>>()
      .default(sql`'{}'::jsonb`),
    requestConfig: jsonb("request_config")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    responseConfig: jsonb("response_config")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_llm_providers_workspace").on(table.workspaceId)],
);

// Skills table
export const skills = pgTable(
  "skills",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    systemPrompt: text("system_prompt"),
    modelId: varchar("model_id"),
    llmProviderConfigId: varchar("llm_provider_config_id"),
    collectionName: text("collection_name"),
    isSystem: boolean("is_system").notNull().default(false),
    systemKey: text("system_key"),
    ragMode: text("rag_mode").notNull().default("disabled"),
    ragCollectionIds: text("rag_collection_ids").array().default(sql`'{}'::text[]`),
    ragTopK: integer("rag_top_k").default(3),
    ragMinScore: doublePrecision("rag_min_score").default(0.5),
    ragMaxContextTokens: integer("rag_max_context_tokens").default(4000),
    ragShowSources: boolean("rag_show_sources").default(true),
    ragBm25Weight: doublePrecision("rag_bm25_weight").default(0.5),
    ragBm25Limit: integer("rag_bm25_limit").default(10),
    ragVectorWeight: doublePrecision("rag_vector_weight").default(0.5),
    ragVectorLimit: integer("rag_vector_limit").default(10),
    ragEmbeddingProviderId: varchar("rag_embedding_provider_id"),
    ragLlmTemperature: doublePrecision("rag_llm_temperature").default(0.7),
    ragLlmMaxTokens: integer("rag_llm_max_tokens").default(2000),
    ragLlmResponseFormat: text("rag_llm_response_format").default("text"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_skills_workspace").on(table.workspaceId),
    index("idx_skills_system").on(table.isSystem),
  ],
);

// Knowledge bases
export const knowledgeBases = pgTable(
  "knowledge_bases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_kb_workspace").on(table.workspaceId)],
);

// Knowledge nodes
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
    parentId: varchar("parent_id").references(() => knowledgeNodes.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull(),
    type: text("type").notNull(),
    content: text("content"),
    slug: text("slug").notNull(),
    path: text("path").notNull(),
    sourceType: text("source_type"),
    sourceConfig: jsonb("source_config").$type<Record<string, unknown>>(),
    importFileName: text("import_file_name"),
    position: integer("position"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_knowledge_nodes_base").on(table.baseId),
    index("idx_knowledge_nodes_workspace").on(table.workspaceId),
    index("idx_knowledge_nodes_parent").on(table.parentId),
  ],
);

// Skill ↔ Knowledge base association
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
  },
  (table) => [primaryKey({ columns: [table.skillId, table.knowledgeBaseId] })],
);

// Chat sessions
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  (table) => [
    index("idx_chat_sessions_workspace").on(table.workspaceId),
    index("idx_chat_sessions_user").on(table.userId),
    index("idx_chat_sessions_skill").on(table.skillId),
  ],
);

// Chat messages
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_chat_messages_chat").on(table.chatId)],
);

// Transcripts
export const transcripts = pgTable(
  "transcripts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    sourceFileId: varchar("source_file_id"),
    status: text("status").notNull().default("processing"),
    title: text("title"),
    previewText: text("preview_text"),
    fullText: text("full_text"),
    lastEditedByUserId: varchar("last_edited_by_user_id"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    index("idx_transcripts_workspace").on(table.workspaceId),
    index("idx_transcripts_chat").on(table.chatId),
    index("idx_transcripts_status").on(table.status),
  ],
);

// Speech providers
export const speechProviders = pgTable("speech_providers", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  providerType: text("provider_type").notNull().default("stt"),
  direction: text("direction").notNull().default("audio_to_text"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  status: text("status").notNull().default("Disabled"),
  lastStatusChangedAt: timestamp("last_status_changed_at"),
  lastValidationAt: timestamp("last_validation_at"),
  lastErrorCode: text("last_error_code"),
  lastErrorMessage: text("last_error_message"),
  configJson: jsonb("config_json")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  updatedByAdminId: varchar("updated_by_admin_id").references(() => users.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Speech provider secrets
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
  (table) => [primaryKey({ columns: [table.providerId, table.secretKey] })],
);

// Actions (workspace skill library)
export const actionTargets = ["transcript", "message", "selection", "conversation"] as const;
export const actionPlacements = ["canvas", "chat", "toolbar"] as const;
export const actionInputTypes = ["full_text", "selection"] as const;
export const actionOutputModes = ["replace_text", "new_message", "new_version", "document"] as const;

export const actions = pgTable(
  "actions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    scope: text("scope").notNull().default("workspace"),
    workspaceId: varchar("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    label: text("label").notNull(),
    description: text("description"),
    target: text("target").notNull(),
    placements: text("placements").array().notNull().default(sql`'{}'::text[]`),
    promptTemplate: text("prompt_template").notNull(),
    inputType: text("input_type").notNull().default("full_text"),
    outputMode: text("output_mode").notNull().default("replace_text"),
    llmConfigId: varchar("llm_config_id"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_actions_workspace").on(table.workspaceId)],
);

// Skill ↔ Actions association
export const skillActions = pgTable(
  "skill_actions",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
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
  (table) => [index("idx_skill_actions_skill").on(table.skillId)],
);

// Knowledge base RAG requests
export const knowledgeBaseRagRequests = pgTable(
  "knowledge_base_rag_requests",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    knowledgeBaseId: varchar("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    result: text("result"),
    embedding: doublePrecision("embedding").array(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_kb_rag_requests_kb").on(table.knowledgeBaseId)],
);

// Knowledge base search settings
export const knowledgeBaseSearchSettings = pgTable(
  "knowledge_base_search_settings",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    knowledgeBaseId: varchar("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    enableBm25: boolean("enable_bm25").default(true),
    enableVector: boolean("enable_vector").default(true),
    bm25Weight: doublePrecision("bm25_weight").default(0.5),
    vectorWeight: doublePrecision("vector_weight").default(0.5),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [
    uniqueIndex("idx_kb_search_settings_kb").on(table.knowledgeBaseId),
  ],
);

// Knowledge base ask AI runs
export const knowledgeBaseAskAiRuns = pgTable(
  "knowledge_base_ask_ai_runs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    knowledgeBaseId: varchar("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    answer: text("answer"),
    sources: jsonb("sources")
      .$type<Array<Record<string, unknown>>>()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_kb_ask_ai_runs_kb").on(table.knowledgeBaseId)],
);

// Knowledge document chunk sets
export const knowledgeDocumentChunkSets = pgTable(
  "knowledge_document_chunk_sets",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    knowledgeBaseId: varchar("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    documentPath: text("document_path").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_kb_document_chunk_sets_kb").on(table.knowledgeBaseId)],
);

// Knowledge document chunk items
export const knowledgeDocumentChunkItems = pgTable(
  "knowledge_document_chunk_items",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    chunkSetId: varchar("chunk_set_id")
      .notNull()
      .references(() => knowledgeDocumentChunkSets.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => [index("idx_kb_document_chunk_items_chunk_set").on(table.chunkSetId)],
);

// Unica chat config
export const unicaChatConfig = pgTable("unica_chat_config", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workspaceId: varchar("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  apiKey: text("api_key").notNull(),
  workspaceIdConfig: text("workspace_id_config"),
  embeddingProvider: text("embedding_provider").default("gigachat"),
  llmProvider: text("llm_provider").default("gigachat-max"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Schemas and types

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastActiveAt: true,
  personalApiTokenHash: true,
  personalApiTokenLastFour: true,
  personalApiTokenGeneratedAt: true,
});

export const upsertAuthProviderSchema = z.object({
  providerType: z.enum(["google", "yandex"]),
  configuration: z.record(z.string()).optional(),
});

export const insertEmbeddingProviderSchema = createInsertSchema(embeddingProviders)
  .omit({
    id: true,
    workspaceId: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    name: z.string().trim().min(1, "Укажите название сервиса").max(200, "Слишком длинное название"),
    description: z
      .string()
      .trim()
      .max(1000, "Описание слишком длинное")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    providerType: z.enum(["openai", "cohere", "huggingface"]).default("openai"),
    model: z.string().trim().min(1, "Укажите модель"),
    embeddingDimension: z.number().int().positive().optional(),
    maxInputTokens: z.number().int().positive().optional(),
    costPer1mTokens: z.number().positive().optional(),
    authorizationKey: z.string().trim().min(1, "Укажите ключ авторизации"),
    baseUrl: z.string().url("Некорректный URL").optional(),
  });

export const updateEmbeddingProviderSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название сервиса").max(200, "Слишком длинное название").optional(),
    description: z
      .string()
      .trim()
      .max(1000, "Описание слишком длинное")
      .optional()
      .transform((value) => (value && value.length > 0 ? value : undefined)),
    providerType: z.enum(["openai", "cohere", "huggingface"]).optional(),
    model: z.string().trim().min(1, "Укажите модель").optional(),
    embeddingDimension: z.number().int().positive().optional(),
    maxInputTokens: z.number().int().positive().optional(),
    costPer1mTokens: z.number().positive().optional(),
    authorizationKey: z.string().trim().min(1, "Укажите ключ авторизации").optional(),
    baseUrl: z.string().url("Некорректный URL").optional(),
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
    requestConfig: z.any().optional(),
    responseConfig: z.any().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Нет данных для обновления",
  });

export const llmProviderTypes = ["gigachat", "openai", "huggingface"] as const;
export type LlmProviderType = (typeof llmProviderTypes)[number];

interface LlmRequestConfig {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

interface LlmResponseConfig {
  response_format?: string;
  [key: string]: unknown;
}

const DEFAULT_LLM_REQUEST_CONFIG: LlmRequestConfig = {
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 2000,
};

const DEFAULT_LLM_RESPONSE_CONFIG: LlmResponseConfig = {
  response_format: "text",
};

// Types for UI/database

export type User = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
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

export type LlmModelOption = {
  label: string;
  value: string;
};

export type Skill = typeof skills.$inferSelect;
export type SkillInsert = typeof skills.$inferInsert;
export type KnowledgeBase = typeof knowledgeBases.$inferSelect;
export type KnowledgeBaseInsert = typeof knowledgeBases.$inferInsert;
export type KnowledgeNode = typeof knowledgeNodes.$inferSelect;
export type KnowledgeNodeInsert = typeof knowledgeNodes.$inferInsert;

export type SkillRagMode = (typeof skillRagModes)[number];

export const skillRagModes = ["disabled", "knowledge_base", "hybrid"] as const;
