import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  json,
  jsonb,
  customType,
  primaryKey,
  foreignKey,
  uniqueIndex,
  index,
  doublePrecision,
  uuid,
  bigint,
  pgEnum,
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
  email: varchar("email", { length: 255 }).notNull().unique(),
  fullName: varchar("full_name", { length: 255 }).notNull(),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  phone: text("phone").notNull().default(""),
  passwordHash: text("password_hash"),
  role: text("role").$type<UserRole>().notNull().default("user"),
  lastActiveAt: timestamp("last_active_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  isEmailConfirmed: boolean("is_email_confirmed").notNull().default(false),
  emailConfirmedAt: timestamp("email_confirmed_at", { withTimezone: true }),
  status: varchar("status", { length: 64 }).notNull().default("active"),
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

export const emailConfirmationTokens = pgTable("email_confirmation_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  userIdx: index("email_confirmation_tokens_user_idx").on(table.userId),
  activeIdx: index("email_confirmation_tokens_active_idx").on(table.userId, table.expiresAt),
}));

export const systemNotificationLogs = pgTable(
  "system_notification_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    type: varchar("type", { length: 255 }).notNull(),
    toEmail: varchar("to_email", { length: 255 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    bodyPreview: varchar("body_preview", { length: 500 }),
    body: text("body"),
    status: varchar("status", { length: 255 }).notNull().default("queued"),
    errorMessage: text("error_message"),
    smtpResponse: text("smtp_response"),
    correlationId: varchar("correlation_id", { length: 255 }),
    triggeredByUserId: varchar("triggered_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => ({
    createdAtIdx: index("system_notification_logs_created_at_idx").on(table.createdAt),
    toEmailIdx: index("system_notification_logs_to_email_idx").on(table.toEmail),
    typeIdx: index("system_notification_logs_type_idx").on(table.type),
    statusIdx: index("system_notification_logs_status_idx").on(table.status),
  }),
);

export const workspacePlans = ["free", "team"] as const;
export type WorkspacePlan = (typeof workspacePlans)[number];
export const workspacePlanEnum = pgEnum("workspace_plan", workspacePlans);

export const modelTypes = ["LLM", "EMBEDDINGS", "ASR"] as const;
export type ModelType = (typeof modelTypes)[number];
export const modelTypeEnum = pgEnum("model_type", modelTypes);

export const modelConsumptionUnits = ["TOKENS_1K", "MINUTES"] as const;
export type ModelConsumptionUnit = (typeof modelConsumptionUnits)[number];
export const modelConsumptionUnitEnum = pgEnum("model_consumption_unit", modelConsumptionUnits);

export const modelCostLevels = ["FREE", "LOW", "MEDIUM", "HIGH", "VERY_HIGH"] as const;
export type ModelCostLevel = (typeof modelCostLevels)[number];
export const modelCostLevelEnum = pgEnum("model_cost_level", modelCostLevels);

export const models = pgTable(
  "models",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    modelKey: text("model_key").notNull().unique(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    modelType: modelTypeEnum("model_type").notNull(),
    consumptionUnit: modelConsumptionUnitEnum("consumption_unit").notNull(),
    costLevel: modelCostLevelEnum("cost_level").notNull().default("MEDIUM"),
    creditsPerUnit: integer("credits_per_unit").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    providerId: text("provider_id"),
    providerType: text("provider_type"),
    providerModelKey: text("provider_model_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    typeActiveIdx: index("models_type_active_idx").on(table.modelType, table.isActive, table.sortOrder),
    providerUniqueIdx: uniqueIndex("models_provider_unique_idx").on(table.providerId, table.providerModelKey),
  }),
);

export const fileStorageAuthTypes = ["none", "bearer"] as const;
export type FileStorageAuthType = (typeof fileStorageAuthTypes)[number];

export const fileStorageProviders = pgTable(
  "file_storage_providers",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    description: text("description"),
    authType: text("auth_type").$type<FileStorageAuthType>().notNull().default("none"),
    isActive: boolean("is_active").notNull().default(true),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    nameUniqueIdx: uniqueIndex("file_storage_providers_name_idx").on(sql`lower(${table.name})`),
    activeIdx: index("file_storage_providers_active_idx").on(table.isActive, table.updatedAt),
  }),
);

export const fileKinds = ["attachment", "audio", "skill_doc"] as const;
export type FileKind = (typeof fileKinds)[number];
export const fileKindsEnum = pgEnum("file_kind", fileKinds);

export const fileEventStatuses = ["queued", "retrying", "sent", "failed"] as const;
export type FileEventStatus = (typeof fileEventStatuses)[number];
export const fileEventStatusEnum = pgEnum("file_event_status", fileEventStatuses);

export const fileStorageTypes = ["standard_minio", "yandex_object_storage", "external_provider"] as const;
export type FileStorageType = (typeof fileStorageTypes)[number];
export const fileStorageTypeEnum = pgEnum("file_storage_type", fileStorageTypes);

export const fileStatuses = ["uploading", "ready", "failed"] as const;
export type FileStatus = (typeof fileStatuses)[number];
export const fileStatusEnum = pgEnum("file_status", fileStatuses);

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    skillId: varchar("skill_id"),
    chatId: varchar("chat_id"),
    messageId: varchar("message_id"),
    userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: fileKindsEnum("kind").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }),
    storageType: fileStorageTypeEnum("storage_type").notNull(),
    bucket: text("bucket"),
    objectKey: text("object_key"),
    objectVersion: text("object_version"),
    externalUri: text("external_uri"),
    providerId: varchar("provider_id").references(() => fileStorageProviders.id, { onDelete: "set null" }),
    providerFileId: text("provider_file_id"),
    status: fileStatusEnum("status").notNull().default("ready"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceIdx: index("files_workspace_idx").on(table.workspaceId, table.createdAt),
    skillIdx: index("files_skill_idx").on(table.skillId),
    chatIdx: index("files_chat_idx").on(table.chatId),
    messageIdx: index("files_message_idx").on(table.messageId),
  }),
);

export const fileEventOutbox = pgTable(
  "file_event_outbox",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    eventId: uuid("event_id").notNull(),
    action: text("action").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").notNull(),
    skillId: uuid("skill_id"),
    chatId: uuid("chat_id"),
    userId: varchar("user_id"),
    messageId: varchar("message_id"),
    targetUrl: text("target_url").notNull(),
    authType: text("auth_type").$type<NoCodeAuthType>().notNull().default("none"),
    bearerToken: text("bearer_token"),
    payload: jsonb("payload").notNull(),
    status: fileEventStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    eventIdx: uniqueIndex("file_event_outbox_event_idx").on(table.eventId),
    dedupIdx: uniqueIndex("file_event_outbox_dedup_idx").on(table.fileId, table.action),
    statusIdx: index("file_event_outbox_status_idx").on(table.status, table.nextAttemptAt, table.createdAt),
  }),
);

// TODO(usage): workspace_usage_month will become the single usage aggregate keyed by workspace_id + period_code (see docs/workspace-usage-foundation.md)
export const workspaces = pgTable("workspaces", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  ownerId: varchar("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: workspacePlanEnum("plan").$type<WorkspacePlan>().notNull().default("free"),
  tariffPlanId: varchar("tariff_plan_id")
    .references(() => tariffPlans.id),
  settings: jsonb("settings")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  iconUrl: text("icon_url").default(""),
  iconKey: varchar("icon_key", { length: 255 }),
  storageBucket: varchar("storage_bucket", { length: 255 }),
  qdrantCollectionsCount: integer("qdrant_collections_count").notNull().default(0),
  qdrantPointsCount: bigint("qdrant_points_count", { mode: "bigint" }).notNull().default(0n),
  qdrantStorageBytes: bigint("qdrant_storage_bytes", { mode: "bigint" }).notNull().default(0n),
  defaultFileStorageProviderId: varchar("default_file_storage_provider_id").references(() => fileStorageProviders.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const workspaceMemberRoles = ["owner", "manager", "user"] as const;
export type WorkspaceMemberRole = (typeof workspaceMemberRoles)[number];
export const workspaceMemberRoleEnum = pgEnum("workspace_member_role", workspaceMemberRoles);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceMemberRoleEnum("role").$type<WorkspaceMemberRole>().notNull().default("user"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspaceId, table.userId] }),
  }),
);

export const workspaceUsageMonth = pgTable(
  "workspace_usage_month",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    periodCode: varchar("period_code", { length: 7 }).notNull(),
    llmTokensTotal: bigint("llm_tokens_total", { mode: "bigint" }).notNull().default(0n),
    embeddingsTokensTotal: bigint("embeddings_tokens_total", { mode: "bigint" }).notNull().default(0n),
    asrMinutesTotal: doublePrecision("asr_minutes_total").notNull().default(0),
    storageBytesTotal: bigint("storage_bytes_total", { mode: "bigint" }).notNull().default(0n),
    skillsCount: integer("skills_count").notNull().default(0),
    actionsCount: integer("actions_count").notNull().default(0),
    knowledgeBasesCount: integer("knowledge_bases_count").notNull().default(0),
    membersCount: integer("members_count").notNull().default(0),
    extraMetrics: jsonb("extra_metrics")
      .$type<{ metric: string; value: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isClosed: boolean("is_closed").notNull().default(false),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    uniqueWorkspacePeriod: uniqueIndex("workspace_usage_month_workspace_period_idx").on(
      table.workspaceId,
      table.periodCode,
    ),
  }),
);

export const workspaceLlmUsageLedger = pgTable(
  "workspace_llm_usage_ledger",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    periodCode: varchar("period_code", { length: 7 }).notNull(),
    executionId: varchar("execution_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelId: varchar("model_id").references(() => models.id, { onDelete: "set null" }),
    tokensTotal: integer("tokens_total").notNull().default(0),
    tokensPrompt: integer("tokens_prompt"),
    tokensCompletion: integer("tokens_completion"),
    appliedCreditsPerUnit: integer("applied_credits_per_unit").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    uniqueExecution: uniqueIndex("workspace_llm_usage_ledger_execution_idx").on(
      table.workspaceId,
      table.executionId,
    ),
    periodIdx: index("workspace_llm_usage_ledger_period_idx").on(table.workspaceId, table.periodCode),
    occurredIdx: index("workspace_llm_usage_ledger_occurred_idx").on(table.workspaceId, table.occurredAt),
    modelIdx: index("workspace_llm_usage_ledger_model_idx").on(
      table.workspaceId,
      table.periodCode,
      table.provider,
      table.model,
    ),
    modelIdIdx: index("workspace_llm_usage_ledger_model_id_idx").on(
      table.workspaceId,
      table.periodCode,
      table.modelId,
    ),
  }),
);

export const workspaceEmbeddingUsageLedger = pgTable(
  "workspace_embedding_usage_ledger",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    periodCode: varchar("period_code", { length: 7 }).notNull(),
    operationId: varchar("operation_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    modelId: varchar("model_id").references(() => models.id, { onDelete: "set null" }),
    tokensTotal: integer("tokens_total").notNull().default(0),
    contentBytes: bigint("content_bytes", { mode: "bigint" }),
    appliedCreditsPerUnit: integer("applied_credits_per_unit").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    uniqueOperation: uniqueIndex("workspace_embedding_usage_ledger_operation_idx").on(
      table.workspaceId,
      table.operationId,
    ),
    periodIdx: index("workspace_embedding_usage_ledger_period_idx").on(table.workspaceId, table.periodCode),
    occurredIdx: index("workspace_embedding_usage_ledger_occurred_idx").on(table.workspaceId, table.occurredAt),
    modelIdx: index("workspace_embedding_usage_ledger_model_idx").on(
      table.workspaceId,
      table.periodCode,
      table.provider,
      table.model,
    ),
    modelIdIdx: index("workspace_embedding_usage_ledger_model_id_idx").on(
      table.workspaceId,
      table.periodCode,
      table.modelId,
    ),
  }),
);

export const workspaceAsrUsageLedger = pgTable(
  "workspace_asr_usage_ledger",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    periodCode: varchar("period_code", { length: 7 }).notNull(),
    asrJobId: varchar("asr_job_id").notNull(),
    provider: text("provider"),
    model: text("model"),
    modelId: varchar("model_id").references(() => models.id, { onDelete: "set null" }),
    durationSeconds: integer("duration_seconds").notNull(),
    appliedCreditsPerUnit: integer("applied_credits_per_unit").notNull().default(0),
    creditsCharged: integer("credits_charged").notNull().default(0),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    uniqueJob: uniqueIndex("workspace_asr_usage_ledger_job_idx").on(table.workspaceId, table.asrJobId),
    periodIdx: index("workspace_asr_usage_ledger_period_idx").on(table.workspaceId, table.periodCode),
    occurredIdx: index("workspace_asr_usage_ledger_occurred_idx").on(table.workspaceId, table.occurredAt),
    providerModelIdx: index("workspace_asr_usage_ledger_provider_model_idx").on(
      table.workspaceId,
      table.periodCode,
      table.provider,
      table.model,
    ),
    modelIdIdx: index("workspace_asr_usage_ledger_model_id_idx").on(
      table.workspaceId,
      table.periodCode,
      table.modelId,
    ),
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

export const smtpSettings = pgTable("smtp_settings", {
  id: varchar("id").primaryKey().default("smtp_singleton"),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull(),
  useTls: boolean("use_tls").notNull().default(false),
  useSsl: boolean("use_ssl").notNull().default(false),
  username: varchar("username", { length: 255 }),
  password: varchar("password", { length: 255 }),
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  updatedByAdminId: varchar("updated_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export type SmtpSettings = typeof smtpSettings.$inferSelect;
export type SmtpSettingsInsert = typeof smtpSettings.$inferInsert;

export const indexingRules = pgTable("indexing_rules", {
  id: varchar("id").primaryKey().default("indexing_rules_singleton"),
  embeddingsProvider: varchar("embeddings_provider", { length: 255 }).notNull(),
  embeddingsModel: varchar("embeddings_model", { length: 255 }).notNull(),
  chunkSize: integer("chunk_size").notNull(),
  chunkOverlap: integer("chunk_overlap").notNull(),
  topK: integer("top_k").notNull(),
  relevanceThreshold: doublePrecision("relevance_threshold").notNull(),
  citationsEnabled: boolean("citations_enabled").notNull().default(false),
  updatedByAdminId: varchar("updated_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export type IndexingRules = typeof indexingRules.$inferSelect;
export type IndexingRulesInsert = typeof indexingRules.$inferInsert;

export const knowledgeBaseIndexingPolicy = pgTable("knowledge_base_indexing_policy", {
  id: varchar("id").primaryKey().default("kb_indexing_policy_singleton"),
  embeddingsProvider: varchar("embeddings_provider", { length: 255 }).notNull(),
  embeddingsModel: varchar("embeddings_model", { length: 255 }).notNull(),
  chunkSize: integer("chunk_size").notNull(),
  chunkOverlap: integer("chunk_overlap").notNull(),
  useHtmlContent: boolean("use_html_content").notNull().default(true),
  defaultSchema: jsonb("default_schema").notNull().default(sql`'[]'::jsonb`),
  updatedByAdminId: varchar("updated_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export type KnowledgeBaseIndexingPolicy = typeof knowledgeBaseIndexingPolicy.$inferSelect;
export type KnowledgeBaseIndexingPolicyInsert = typeof knowledgeBaseIndexingPolicy.$inferInsert;

export const knowledgeBaseIndexingJobStatuses = ["pending", "processing", "completed", "failed"] as const;
export type KnowledgeBaseIndexingJobStatus = (typeof knowledgeBaseIndexingJobStatuses)[number];

export const knowledgeBaseIndexingJobs = pgTable(
  "knowledge_base_indexing_jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobType: text("job_type").notNull().default("knowledge_base_indexing"),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    baseId: varchar("base_id")
      .notNull()
      .references(() => knowledgeBases.id, { onDelete: "cascade" }),
    documentId: varchar("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    versionId: varchar("version_id")
      .notNull()
      .references(() => knowledgeDocumentVersions.id, { onDelete: "cascade" }),
    status: text("status").$type<KnowledgeBaseIndexingJobStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastError: text("last_error"),
    chunkCount: integer("chunk_count"),
    totalChars: integer("total_chars"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    uniqueJobIdx: uniqueIndex("knowledge_base_indexing_jobs_unique_job_idx").on(
      table.jobType,
      table.documentId,
      table.versionId,
    ),
    workspaceIdx: index("knowledge_base_indexing_jobs_workspace_idx").on(
      table.workspaceId,
      table.status,
      table.nextRetryAt,
    ),
    baseIdx: index("knowledge_base_indexing_jobs_base_idx").on(table.baseId, table.status, table.nextRetryAt),
  }),
);
export type KnowledgeBaseIndexingJob = typeof knowledgeBaseIndexingJobs.$inferSelect;
export type KnowledgeBaseIndexingJobInsert = typeof knowledgeBaseIndexingJobs.$inferInsert;

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

export const knowledgeNodeTypeEnum = pgEnum("knowledge_node_type", ["folder", "document"]);
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
    type: knowledgeNodeTypeEnum("type").$type<KnowledgeBaseNodeType>().notNull().default("document"),
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
  isEmailConfirmed: true,
  emailConfirmedAt: true,
  status: true,
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

export const llmProviderTypes = ["gigachat", "custom", "aitunnel", "unica"] as const;
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
      .max(255, "Full name is too long")
      .optional()
      .default(""),
    email: z
      .string()
      .trim()
      .max(255, "Email is too long")
      .email("Invalid email format"),
    password: z
      .string()
      .min(8, "Password is too short")
      .max(100, "Password is too long")
      .refine((value) => /[A-Za-z]/.test(value) && /[0-9]/.test(value), {
        message: "Invalid password format",
      }),
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
    executionMode: text("execution_mode").$type<SkillExecutionMode>().notNull().default("standard"),
    mode: text("mode").$type<SkillMode>().notNull().default("rag"),
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
    noCodeEndpointUrl: text("no_code_endpoint_url"),
    noCodeFileEventsUrl: text("no_code_file_events_url"),
    noCodeFileStorageProviderId: varchar("no_code_file_storage_provider_id").references(() => fileStorageProviders.id, {
      onDelete: "set null",
    }),
    noCodeAuthType: text("no_code_auth_type").$type<NoCodeAuthType>().notNull().default("none"),
    noCodeBearerToken: text("no_code_bearer_token"),
    noCodeCallbackTokenHash: text("no_code_callback_token_hash"),
    noCodeCallbackTokenLastFour: text("no_code_callback_token_last_four"),
    noCodeCallbackTokenRotatedAt: timestamp("no_code_callback_token_rotated_at"),
    noCodeCallbackKey: text("no_code_callback_key"),
    contextInputLimit: integer("context_input_limit"),
    transcriptionFlowMode: text("transcription_flow_mode")
      .$type<SkillTranscriptionFlowMode>()
      .notNull()
      .default("standard"),
    onTranscriptionMode: text("on_transcription_mode")
      .$type<SkillTranscriptionMode>()
      .notNull()
      .default("raw_only"),
    onTranscriptionAutoActionId: varchar("on_transcription_auto_action_id"),
    status: text("status").$type<SkillStatus>().notNull().default("active"),
    icon: text("icon"),
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
    noCodeCallbackKeyUnique: uniqueIndex("skills_no_code_callback_key_idx").on(table.noCodeCallbackKey),
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
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    enabledPlacements: text("enabled_placements").array().notNull().default(sql`'{}'::text[]`),
    labelOverride: text("label_override"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceIdx: index("skill_actions_workspace_idx").on(table.workspaceId),
    skillIdx: index("skill_actions_skill_idx").on(table.skillId),
    actionIdx: index("skill_actions_action_idx").on(table.actionId),
    skillActionUnique: uniqueIndex("skill_actions_skill_action_unique_idx").on(table.skillId, table.actionId),
  }),
);

export const chatMessageRoles = ["user", "assistant", "system"] as const;
export type ChatMessageRole = (typeof chatMessageRoles)[number];
export const chatMessageTypes = ["text", "file", "card"] as const;
export type ChatMessageType = (typeof chatMessageTypes)[number];

export const chatStatuses = ["active", "archived"] as const;
export type ChatStatus = (typeof chatStatuses)[number];

export const assistantActionTypes = ["ANALYZING", "TRANSCRIBING", "TYPING"] as const;
export type AssistantActionType = (typeof assistantActionTypes)[number];

export const botActionTypes = ["transcribe_audio", "summarize", "generate_image", "process_file"] as const;
export type BotActionType = (typeof botActionTypes)[number];

export const botActionStatuses = ["processing", "done", "error"] as const;
export type BotActionStatus = (typeof botActionStatuses)[number];

// Telegram-style событие активности бота. actionType допускает string, чтобы не падать на новых типах.
export type BotAction = {
  workspaceId: string;
  chatId: string;
  actionId: string;
  actionType: BotActionType | string;
  status: BotActionStatus;
  displayText?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export const botActionSchema = z.object({
  workspaceId: z.string().min(1),
  chatId: z.string().min(1),
  actionId: z.string().min(1),
  actionType: z.string().min(1), // допускаем произвольный тип, фронт обрабатывает через displayText/fallback
  status: z.enum(botActionStatuses),
  displayText: z.string().nullable().optional(),
  payload: z.record(z.any()).nullable().optional(),
  createdAt: z.string().datetime().nullable().optional(),
  updatedAt: z.string().datetime().nullable().optional(),
});

export const botActions = pgTable(
  "bot_actions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    actionId: text("action_id").notNull(),
    actionType: text("action_type").notNull(),
    status: text("status").$type<BotActionStatus>().notNull().default("processing"),
    displayText: text("display_text"),
    payload: jsonb("payload").$type<Record<string, unknown> | null>().default(sql`'{}'::jsonb`),
    startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    chatIdx: index("bot_actions_chat_idx").on(table.workspaceId, table.chatId, table.updatedAt),
    statusIdx: index("bot_actions_status_idx").on(table.workspaceId, table.chatId, table.status),
    uniqueAction: uniqueIndex("bot_actions_action_unique_idx").on(
      table.workspaceId,
      table.chatId,
      table.actionId,
    ),
  }),
);
export type BotActionRecord = typeof botActions.$inferSelect;

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
    status: text("status").$type<ChatStatus>().notNull().default("active"),
    currentAssistantActionType: text("current_assistant_action_type").$type<AssistantActionType | null>(),
    currentAssistantActionText: text("current_assistant_action_text"),
    currentAssistantActionTriggerMessageId: text("current_assistant_action_trigger_message_id"),
    currentAssistantActionUpdatedAt: timestamp("current_assistant_action_updated_at"),
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

export const chatCardTypes = ["transcript"] as const;
export type ChatCardType = (typeof chatCardTypes)[number];

export const chatCards = pgTable(
  "chat_cards",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    type: text("type").$type<ChatCardType>().notNull(),
    title: text("title"),
    previewText: text("preview_text"),
    transcriptId: varchar("transcript_id"),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceIdx: index("chat_cards_workspace_idx").on(table.workspaceId, table.createdAt),
    chatIdx: index("chat_cards_chat_idx").on(table.chatId, table.createdAt),
  }),
);
export type ChatCard = typeof chatCards.$inferSelect;
export type ChatCardInsert = typeof chatCards.$inferInsert;

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    cardId: varchar("card_id").references(() => chatCards.id, { onDelete: "set null" }),
    messageType: text("message_type").$type<ChatMessageType>().notNull().default("text"),
    role: text("role").$type<ChatMessageRole>().notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<ChatMessageMetadata>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    chatIdx: index("chat_messages_chat_idx").on(table.chatId, table.createdAt),
  }),
);

export const transcriptStatuses = ["processing", "postprocessing", "ready", "failed", "auto_action_failed"] as const;
export type TranscriptStatus = (typeof transcriptStatuses)[number];

export type ChatMessageMetadata = {
  transcriptId?: string;
  transcriptStatus?: TranscriptStatus;
  file?: {
    attachmentId?: string;
    filename?: string;
    mimeType?: string | null;
    sizeBytes?: number | null;
    storageKey?: string;
    uploadedByUserId?: string | null;
  };
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
    defaultViewId: varchar("default_view_id"),
    defaultViewActionId: varchar("default_view_action_id"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceIdx: index("transcripts_workspace_idx").on(table.workspaceId),
    chatIdx: index("transcripts_chat_idx").on(table.chatId),
    statusIdx: index("transcripts_status_idx").on(table.status),
    defaultViewIdx: index("transcripts_default_view_idx").on(table.defaultViewId),
    defaultViewActionIdx: index("transcripts_default_view_action_idx").on(table.defaultViewActionId),
  }),
);

export const transcriptViews = pgTable(
  "transcript_views",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    transcriptId: varchar("transcript_id")
      .notNull()
      .references(() => transcripts.id, { onDelete: "cascade" }),
    actionId: varchar("action_id"),
    label: text("label").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    transcriptIdx: index("transcript_views_transcript_idx").on(table.transcriptId),
  }),
);

export const chatAttachments = pgTable(
  "chat_attachments",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()::text`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
  chatId: varchar("chat_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  messageId: varchar("message_id").references(() => chatMessages.id, { onDelete: "set null" }),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
  uploaderUserId: varchar("uploader_user_id").references(() => users.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    workspaceIdx: index("chat_attachments_workspace_idx").on(table.workspaceId, table.createdAt),
    chatIdx: index("chat_attachments_chat_idx").on(table.chatId, table.createdAt),
    messageIdx: index("chat_attachments_message_idx").on(table.messageId),
    fileIdx: index("chat_attachments_file_idx").on(table.fileId),
  }),
);

export type ChatAttachment = typeof chatAttachments.$inferSelect;
export type ChatAttachmentInsert = typeof chatAttachments.$inferInsert;

export const skillFileStatuses = ["uploaded", "processing", "ready", "error"] as const;
export type SkillFileStatus = (typeof skillFileStatuses)[number];

export const skillFiles = pgTable(
  "skill_files",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    skillId: varchar("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    version: integer("version").notNull().default(1),
    status: text("status").$type<SkillFileStatus>().notNull().default("uploaded"),
    processingStatus: text("processing_status").$type<SkillFileStatus>().notNull().default("processing"),
    processingErrorMessage: text("processing_error_message"),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    workspaceIdx: index("skill_files_workspace_idx").on(table.workspaceId, table.createdAt),
    skillIdx: index("skill_files_skill_idx").on(table.skillId, table.createdAt),
  }),
);

export type SkillFile = typeof skillFiles.$inferSelect;
export type SkillFileInsert = typeof skillFiles.$inferInsert;

export const skillFileIngestionJobStatuses = ["pending", "running", "done", "error"] as const;
export type SkillFileIngestionJobStatus = (typeof skillFileIngestionJobStatuses)[number];

export const skillFileIngestionJobs = pgTable(
  "skill_file_ingestion_jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    jobType: text("job_type").notNull().default("skill_file_ingestion"),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    skillId: varchar("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => skillFiles.id, { onDelete: "cascade" }),
    fileVersion: integer("file_version").notNull(),
    status: text("status").$type<SkillFileIngestionJobStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at"),
    lastError: text("last_error"),
    chunkCount: integer("chunk_count"),
    totalChars: integer("total_chars"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    uniqueJob: uniqueIndex("skill_file_ingestion_jobs_unique_job_idx").on(
      table.jobType,
      table.fileId,
      table.fileVersion,
    ),
    workspaceIdx: index("skill_file_ingestion_jobs_workspace_idx").on(
      table.workspaceId,
      table.status,
      table.nextRetryAt,
    ),
    skillIdx: index("skill_file_ingestion_jobs_skill_idx").on(table.skillId, table.status, table.nextRetryAt),
  }),
);

export type SkillFileIngestionJob = typeof skillFileIngestionJobs.$inferSelect;
export type SkillFileIngestionJobInsert = typeof skillFileIngestionJobs.$inferInsert;

export const canvasDocumentTypes = ["source", "derived", "summary", "cleaned", "custom"] as const;
export type CanvasDocumentType = (typeof canvasDocumentTypes)[number];

export const canvasDocuments = pgTable(
  "canvas_documents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    chatId: varchar("chat_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    transcriptId: varchar("transcript_id").references(() => transcripts.id, { onDelete: "cascade" }),
    skillId: varchar("skill_id").references(() => skills.id, { onDelete: "set null" }),
    actionId: varchar("action_id").references(() => actions.id, { onDelete: "set null" }),
    type: text("type").$type<CanvasDocumentType>().notNull().default("derived"),
    title: text("title").notNull(),
    content: text("content").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdByUserId: varchar("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => ({
    workspaceIdx: index("canvas_documents_workspace_idx").on(table.workspaceId),
    chatIdx: index("canvas_documents_chat_idx").on(table.chatId),
    transcriptIdx: index("canvas_documents_transcript_idx").on(table.transcriptId),
    skillIdx: index("canvas_documents_skill_idx").on(table.skillId),
    actionIdx: index("canvas_documents_action_idx").on(table.actionId),
  }),
);

export const skillRagModes = ["all_collections", "selected_collections"] as const;
export type SkillRagMode = (typeof skillRagModes)[number];
export const skillTranscriptionModes = ["raw_only", "auto_action"] as const;
export type SkillTranscriptionMode = (typeof skillTranscriptionModes)[number];
export const skillTranscriptionFlowModes = ["standard", "no_code"] as const;
export type SkillTranscriptionFlowMode = (typeof skillTranscriptionFlowModes)[number];
export const skillExecutionModes = ["standard", "no_code"] as const;
export type SkillExecutionMode = (typeof skillExecutionModes)[number];
export const noCodeAuthTypes = ["none", "bearer"] as const;
export type NoCodeAuthType = (typeof noCodeAuthTypes)[number];
export const skillModes = ["rag", "llm"] as const;
export type SkillMode = (typeof skillModes)[number];

export const skillStatuses = ["active", "archived"] as const;
export type SkillStatus = (typeof skillStatuses)[number];

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
    scope: z.string().trim().min(1, "Укажите OAuth scope").or(z.literal("")),
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
    isGlobal: z.boolean().optional(),
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
    scope: z.string().trim().min(1, "Укажите OAuth scope").or(z.literal("")).optional(),
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
    tokenUrl: z.string().trim().optional().or(z.literal("")),
    completionUrl: z
      .string()
      .trim()
      .url("Некорректный URL сервиса LLM"),
    authorizationKey: z.string().trim().optional().or(z.literal("")),
    scope: z.string().trim().optional().or(z.literal("")),
    model: z.string().trim().optional().or(z.literal("")),
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
  })
  .refine(
    (data) => {
      // Для unica провайдера эти поля не обязательны
      if (data.providerType === "unica") {
        return true;
      }
      // Для других провайдеров проверяем обязательные поля
      if (!data.tokenUrl || data.tokenUrl.trim().length === 0) {
        return false;
      }
      try {
        new URL(data.tokenUrl);
      } catch {
        return false;
      }
      if (!data.authorizationKey || data.authorizationKey.trim().length === 0) {
        return false;
      }
      if (data.providerType !== "aitunnel" && (!data.scope || data.scope.trim().length === 0)) {
        return false;
      }
      if (!data.model || data.model.trim().length === 0) {
        return false;
      }
      return true;
    },
    {
      message: "Заполните все обязательные поля",
      path: ["tokenUrl"], // Указываем первое проблемное поле
    },
  )
  .refine(
    (data) => {
      if (data.providerType === "unica") {
        return true;
      }
      if (data.tokenUrl && data.tokenUrl.trim().length > 0) {
        try {
          new URL(data.tokenUrl);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: "Некорректный URL для получения Access Token",
      path: ["tokenUrl"],
    },
  )
  .refine(
    (data) => {
      if (data.providerType === "unica") {
        return true;
      }
      if (!data.authorizationKey || data.authorizationKey.trim().length === 0) {
        return false;
      }
      return true;
    },
    {
      message: "Укажите Authorization key",
      path: ["authorizationKey"],
    },
  )
  .refine(
    (data) => {
      if (data.providerType === "unica" || data.providerType === "aitunnel") {
        return true;
      }
      if (!data.scope || data.scope.trim().length === 0) {
        return false;
      }
      return true;
    },
    {
      message: "Укажите OAuth scope",
      path: ["scope"],
    },
  )
  .refine(
    (data) => {
      if (data.providerType === "unica") {
        return true;
      }
      if (!data.model || data.model.trim().length === 0) {
        return false;
      }
      return true;
    },
    {
      message: "Укажите модель",
      path: ["model"],
    },
  );

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
    isGlobal: z.boolean().optional(),
    tokenUrl: z.string().trim().optional().or(z.literal("")),
    completionUrl: z
      .string()
      .trim()
      .url("Некорректный URL сервиса LLM")
      .optional(),
    authorizationKey: z.string().trim().optional().or(z.literal("")),
    scope: z.string().trim().optional().or(z.literal("")),
    model: z.string().trim().optional().or(z.literal("")),
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
  })
  .refine(
    (data) => {
      // Для unica провайдера tokenUrl может быть пустым
      if (data.providerType === "unica") {
        return true;
      }
      // Если tokenUrl не передан в обновлении, это нормально (обновляются другие поля)
      if (data.tokenUrl === undefined) {
        return true;
      }
      // Если tokenUrl передан как пустая строка, разрешаем (может быть обновление unica без providerType)
      if (data.tokenUrl.trim().length === 0) {
        return true;
      }
      // Если tokenUrl передан и не пустой, проверяем валидность URL
      try {
        new URL(data.tokenUrl);
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Некорректный URL для получения Access Token",
      path: ["tokenUrl"],
    },
  )
  .refine(
    (data) => {
      // Для unica провайдера model может быть пустым
      if (data.providerType === "unica") {
        return true;
      }
      // Если model не передан в обновлении, это нормально (обновляются другие поля)
      if (data.model === undefined) {
        return true;
      }
      // Если model передан как пустая строка, разрешаем (может быть обновление unica без providerType)
      if (data.model.trim().length === 0) {
        return true;
      }
      return true;
    },
    {
      message: "Укажите модель",
      path: ["model"],
    },
  )
  .refine(
    (data) => {
      // Для unica провайдера authorizationKey может быть пустым
      if (data.providerType === "unica") {
        return true;
      }
      // Если authorizationKey не передан в обновлении, это нормально (обновляются другие поля)
      if (data.authorizationKey === undefined) {
        return true;
      }
      // Если authorizationKey передан как пустая строка для не-unica провайдера, это ошибка
      if (data.authorizationKey.trim().length === 0) {
        return false;
      }
      return true;
    },
    {
      message: "Укажите Authorization key",
      path: ["authorizationKey"],
    },
  );

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

// Skill execution log tables
export const skillExecutions = pgTable(
  "skill_executions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: varchar("workspace_id").notNull(),
    userId: varchar("user_id"),
    skillId: varchar("skill_id").notNull(),
    chatId: varchar("chat_id"),
    userMessageId: varchar("user_message_id"),
    source: text("source").notNull(),
    status: text("status").notNull(),
    hasStepErrors: boolean("has_step_errors").notNull().default(false),
    startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    finishedAt: timestamp("finished_at"),
    metadata: jsonb("metadata"),
  },
  (table) => ({
    startedAtIdx: index("skill_executions_started_at_idx").on(table.startedAt),
    workspaceIdx: index("skill_executions_workspace_idx").on(table.workspaceId, table.startedAt),
    skillIdx: index("skill_executions_skill_idx").on(table.skillId, table.startedAt),
    chatIdx: index("skill_executions_chat_idx").on(table.chatId),
    userIdx: index("skill_executions_user_idx").on(table.userId),
  }),
);

export const skillExecutionSteps = pgTable(
  "skill_execution_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => skillExecutions.id, { onDelete: "cascade" }),
    order: integer("order").notNull(),
    type: text("type").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    finishedAt: timestamp("finished_at"),
    inputPayload: jsonb("input_payload"),
    outputPayload: jsonb("output_payload"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    diagnosticInfo: text("diagnostic_info"),
  },
  (table) => ({
    executionIdx: index("skill_execution_steps_execution_idx").on(table.executionId, table.order),
  }),
);

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
export type EmailConfirmationToken = typeof emailConfirmationTokens.$inferSelect;
export type EmailConfirmationTokenInsert = typeof emailConfirmationTokens.$inferInsert;
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
export type Model = typeof models.$inferSelect;
export type ModelInsert = typeof models.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceInsert = typeof workspaces.$inferInsert;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type WorkspaceMemberInsert = typeof workspaceMembers.$inferInsert;
export type FileStorageProvider = typeof fileStorageProviders.$inferSelect;
export type FileStorageProviderInsert = typeof fileStorageProviders.$inferInsert;
export type File = typeof files.$inferSelect;
export type FileInsert = typeof files.$inferInsert;
export type FileEventOutbox = typeof fileEventOutbox.$inferSelect;
export type FileEventOutboxInsert = typeof fileEventOutbox.$inferInsert;
export type WorkspaceUsageMonth = typeof workspaceUsageMonth.$inferSelect;
export type WorkspaceUsageMonthInsert = typeof workspaceUsageMonth.$inferInsert;
export type WorkspaceLlmUsageLedger = typeof workspaceLlmUsageLedger.$inferSelect;
export type WorkspaceLlmUsageLedgerInsert = typeof workspaceLlmUsageLedger.$inferInsert;
export type WorkspaceEmbeddingUsageLedger = typeof workspaceEmbeddingUsageLedger.$inferSelect;
export type WorkspaceEmbeddingUsageLedgerInsert = typeof workspaceEmbeddingUsageLedger.$inferInsert;
export type WorkspaceVectorCollection = typeof workspaceVectorCollections.$inferSelect;
export type AuthProvider = typeof authProviders.$inferSelect;
export type AuthProviderInsert = typeof authProviders.$inferInsert;
export type SystemNotificationLog = typeof systemNotificationLogs.$inferSelect;
export type SystemNotificationLogInsert = typeof systemNotificationLogs.$inferInsert;
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
  recommendedModels?: LlmModelOption[];
};
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatSessionInsert = typeof chatSessions.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type ChatMessageInsert = typeof chatMessages.$inferInsert;
export type Transcript = typeof transcripts.$inferSelect;
export type TranscriptInsert = typeof transcripts.$inferInsert;
export type TranscriptView = typeof transcriptViews.$inferSelect;
export type TranscriptViewInsert = typeof transcriptViews.$inferInsert;
export type CanvasDocument = typeof canvasDocuments.$inferSelect;
export type CanvasDocumentInsert = typeof canvasDocuments.$inferInsert;
export const sessions = pgTable("session", {
  sid: varchar("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6, withTimezone: false }).notNull(),
});
export type SessionRow = typeof sessions.$inferSelect;
export const asrExecutions = pgTable(
  "asr_executions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    workspaceId: uuid("workspace_id"),
    skillId: uuid("skill_id"),
    chatId: uuid("chat_id"),
    userMessageId: uuid("user_message_id"),
    transcriptMessageId: uuid("transcript_message_id"),
    transcriptId: uuid("transcript_id"),
    provider: text("provider"),
    mode: text("mode"),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    language: text("language"),
    fileName: text("file_name"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }),
    durationMs: bigint("duration_ms", { mode: "bigint" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    pipelineEvents: jsonb("pipeline_events").$type<unknown[]>(),
  },
  (table) => ({
    createdAtIdx: index("asr_executions_created_at_idx").on(table.createdAt),
    workspaceIdx: index("asr_executions_workspace_idx").on(table.workspaceId, table.createdAt),
    statusIdx: index("asr_executions_status_idx").on(table.status, table.createdAt),
  }),
);

export type AsrExecution = typeof asrExecutions.$inferSelect;
export type AsrExecutionInsert = typeof asrExecutions.$inferInsert;
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

export const guardBlockEvents = pgTable(
  "guard_block_events",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    operationType: text("operation_type").notNull(),
    resourceType: text("resource_type").notNull(),
    reasonCode: text("reason_code").notNull(),
    message: text("message").notNull(),
    upgradeAvailable: boolean("upgrade_available").notNull().default(false),
    limitKey: text("limit_key"),
    limitCurrent: doublePrecision("limit_current"),
    limitValue: doublePrecision("limit_value"),
    limitUnit: text("limit_unit"),
    expectedCost: jsonb("expected_cost"),
    usageSnapshot: jsonb("usage_snapshot"),
    meta: jsonb("meta"),
    requestId: text("request_id"),
    actorType: text("actor_type"),
  actorId: text("actor_id"),
  isSoft: boolean("is_soft").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    workspaceIdx: index("guard_block_events_workspace_idx").on(table.workspaceId, table.createdAt),
    createdIdx: index("guard_block_events_created_idx").on(table.createdAt),
  }),
);

export type GuardBlockEvent = typeof guardBlockEvents.$inferSelect;
export type GuardBlockEventInsert = typeof guardBlockEvents.$inferInsert;

export const tariffPlans = pgTable("tariff_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  shortDescription: text("short_description"),
  sortOrder: integer("sort_order").notNull().default(0),
  includedCreditsAmount: integer("included_credits_amount").notNull().default(0),
  includedCreditsPeriod: text("included_credits_period").notNull().default("monthly"),
  noCodeFlowEnabled: boolean("no_code_flow_enabled").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const tariffLimits = pgTable(
  "tariff_limits",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    planId: varchar("plan_id")
      .notNull()
      .references(() => tariffPlans.id, { onDelete: "cascade" }),
    limitKey: text("limit_key").notNull(),
    unit: text("unit").notNull(),
    limitValue: doublePrecision("limit_value"),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    planIdx: index("tariff_limits_plan_idx").on(table.planId),
    planKeyIdx: index("tariff_limits_plan_key_idx").on(table.planId, table.limitKey),
    planKeyUnique: uniqueIndex("tariff_limits_plan_key_unique").on(table.planId, table.limitKey),
  }),
);

export type TariffPlan = typeof tariffPlans.$inferSelect;
export type TariffPlanInsert = typeof tariffPlans.$inferInsert;
export type TariffLimit = typeof tariffLimits.$inferSelect;
export type TariffLimitInsert = typeof tariffLimits.$inferInsert;

export const workspaceCreditAccounts = pgTable("workspace_credit_accounts", {
  workspaceId: varchar("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  currentBalance: bigint("current_balance", { mode: "number" }).notNull().default(0),
  nextTopUpAt: timestamp("next_top_up_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceCreditLedger = pgTable(
  "workspace_credit_ledger",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    workspaceId: varchar("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    amountDelta: bigint("amount_delta", { mode: "number" }).notNull(),
    entryType: text("entry_type").notNull(),
    creditType: text("credit_type").notNull().default("subscription"),
    reason: text("reason"),
    sourceRef: text("source_ref").notNull(),
    planId: varchar("plan_id"),
    planCode: text("plan_code"),
    subscriptionId: text("subscription_id"),
    period: text("period"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    actorUserId: varchar("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sourceUnique: uniqueIndex("workspace_credit_ledger_source_uq").on(table.workspaceId, table.entryType, table.sourceRef),
    workspaceIdx: index("workspace_credit_ledger_workspace_idx").on(table.workspaceId, table.occurredAt),
  }),
);

export type WorkspaceCreditAccount = typeof workspaceCreditAccounts.$inferSelect;
export type WorkspaceCreditAccountInsert = typeof workspaceCreditAccounts.$inferInsert;
export type WorkspaceCreditLedgerEntry = typeof workspaceCreditLedger.$inferSelect;
export type WorkspaceCreditLedgerInsert = typeof workspaceCreditLedger.$inferInsert;
