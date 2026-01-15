import {
  sites,
  users,
  personalApiTokens,
  embeddingProviders,
  llmProviders,
  authProviders,
  workspaces,
  workspaceMembers,
  workspaceVectorCollections,
  workspaceMemberRoles,
  skills,
  knowledgeBases,
  knowledgeNodes,
  knowledgeDocuments,
  knowledgeDocumentChunkItems,
  knowledgeDocumentChunkSets,
  workspaceEmbedKeys,
  workspaceEmbedKeyDomains,
  knowledgeBaseRagRequests,
  knowledgeBaseSearchSettings,
  tariffPlans,
  knowledgeBaseAskAiRuns,
  unicaChatConfig,
  chatSessions,
  chatCards,
  chatMessages,
  botActions,
  chatAttachments,
  skillFiles,
  skillFileIngestionJobs,
  transcripts,
  transcriptViews,
  canvasDocuments,
  speechProviders,
  speechProviderSecrets,
  fileStorageProviders,
  fileEventOutbox,
  type FileEventOutbox,
  type FileEventOutboxInsert,
  files,
  indexingRules,
  knowledgeBaseIndexingJobs,
  knowledgeBaseIndexingPolicy,
  knowledgeBaseIndexingActions,
  knowledgeDocumentIndexRevisions,
  knowledgeDocumentIndexState,
  knowledgeBaseIndexState,
  type KnowledgeBaseIndexingJob,
  type KnowledgeBaseIndexingJobInsert,
  type KnowledgeBaseIndexingPolicy,
  type KnowledgeBaseIndexingActionRecord,
  type KnowledgeBaseIndexingActionInsert,
  type KnowledgeDocumentIndexRevisionRecord,
  type KnowledgeDocumentIndexRevisionInsert,
  type KnowledgeDocumentIndexStateRecord,
  type KnowledgeDocumentIndexStateInsert,
  type KnowledgeBaseIndexStateRecord,
  type KnowledgeBaseIndexStateInsert,
  type KnowledgeBaseSearchSettingsRow,
  type KnowledgeBaseChunkSearchSettings,
  type KnowledgeBaseRagSearchSettings,
  type KnowledgeBaseAskAiPipelineStepLog,
  type Site,
  type SiteInsert,
  type User,
  type PersonalApiToken,
  type InsertUser,
  type EmbeddingProvider,
  type EmbeddingProviderInsert,
  type LlmProvider,
  type LlmProviderInsert,
  type UnicaChatConfig,
  type UnicaChatConfigInsert,
  type KnowledgeBaseAskAiRun,
  type KnowledgeBaseAskAiRunInsert,
  type Workspace,
  type WorkspaceMember,
  type AuthProvider,
  type AuthProviderInsert,
  type AuthProviderType,
  type AssistantActionType,
  type WorkspaceEmbedKey,
  type WorkspaceEmbedKeyDomain,
  type File,
  type FileInsert,
  type KnowledgeBaseRagRequest,
  type ChatSession,
  type ChatSessionInsert,
  type ChatAttachment,
  type ChatAttachmentInsert,
  type SkillFile,
  type SkillFileInsert,
  type SkillFileIngestionJob,
  type SkillFileIngestionJobInsert,
  type ChatMessage,
  type ChatMessageInsert,
  type ChatCard,
  type ChatCardInsert,
  type Transcript,
  type TranscriptInsert,
  type TranscriptView,
  type TranscriptViewInsert,
  type CanvasDocument,
  type CanvasDocumentInsert,
  type TranscriptStatus,
  type ChatMessageMetadata,
  type SpeechProvider,
  type SpeechProviderInsert,
  type SpeechProviderSecret,
  type FileStorageProvider,
  type FileStorageProviderInsert,
  type WorkspaceMemberRole,
  type BotAction,
  type BotActionStatus,
} from "@shared/schema";
import { DEFAULT_INDEXING_RULES } from "@shared/indexing-rules";
import { GIGACHAT_EMBEDDING_VECTOR_SIZE } from "@shared/constants";
import { db } from "./db";
import { createUnicaChatSkillForWorkspace } from "./skills";
import { and, asc, desc, eq, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { isPgError, swallowPgError } from "./pg-utils";
import { adjustWorkspaceObjectCounters } from "./usage/usage-service";
import { getUsagePeriodForDate } from "./usage/usage-types";
import { workspaceOperationGuard } from "./guards/workspace-operation-guard";
import { tariffPlanService } from "./tariff-plan-service";
import { OperationBlockedError, mapDecisionToPayload } from "./guards/errors";
import type {
  KnowledgeBaseAskAiRunDetail,
  KnowledgeBaseAskAiRunSummary,
  KnowledgeBaseRagConfig,
} from "@shared/knowledge-base";
import { getQdrantClient } from "./qdrant";

let globalUserAuthSchemaReady = false;

type KnowledgeBaseRow = typeof knowledgeBases.$inferSelect;

export type WorkspaceMembershipStatus = "active" | "invited" | "removed" | "blocked";
export type WorkspaceMembership = WorkspaceMember & { status: WorkspaceMembershipStatus };

const WORKSPACE_MEMBERSHIP_CACHE_TTL_MS = Number.parseInt(
  process.env.WORKSPACE_MEMBERSHIP_CACHE_TTL_MS ?? "15000",
  10,
);

export type KnowledgeChunkSearchEntry = {
  chunkId: string;
  documentId: string;
  docTitle: string;
  sectionTitle: string | null;
  snippet: string;
  text: string;
  score: number;
  source: "sections" | "content";
  nodeId: string | null;
  nodeSlug: string | null;
};

function getRowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function parseRowNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class WorkspaceVectorInitError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = "WorkspaceVectorInitError";
  }
}

function sanitizeVectorCollectionName(source: string): string {
  const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 60) : "default";
}

function buildWorkspaceVectorCollectionName(workspaceId: string, providerId: string): string {
  const workspaceSlug = sanitizeVectorCollectionName(workspaceId);
  const providerSlug = sanitizeVectorCollectionName(providerId);
  // Используем proj_skill_files для единообразия с файлами навыков
  return `ws_${workspaceSlug}__proj_skill_files__coll_${providerSlug}`;
}

function parseVectorSizeValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      const parsed = Number.parseInt(trimmed, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
}

function isQdrantNotFoundError(error: unknown): boolean {
  const status = (error as any)?.status ?? (error as any)?.response?.status ?? null;
  return status === 404;
}

function isQdrantAlreadyExistsError(error: unknown): boolean {
  const status = (error as any)?.status ?? (error as any)?.response?.status ?? null;
  return status === 409;
}

function isQdrantRetryableError(error: unknown): boolean {
  const code = (error as any)?.code;
  if (typeof code === "string") {
    const retryableCodes = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"];
    if (retryableCodes.includes(code)) {
      return true;
    }
  }

  const status = (error as any)?.status ?? (error as any)?.response?.status ?? null;
  if (typeof status === "number") {
    return status >= 500 || status === 429 || status === 408;
  }

  return true;
}

function parseRowDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function mapSkillFileIngestionJobRow(row: Record<string, unknown>): SkillFileIngestionJob {
  const jobType = getRowString(row, "job_type") || getRowString(row, "jobType") || "skill_file_ingestion";
  const nextRetryCandidate = (row as any)?.next_retry_at ?? (row as any)?.nextRetryAt;
  const createdAtCandidate = (row as any)?.created_at ?? (row as any)?.createdAt;
  const updatedAtCandidate = (row as any)?.updated_at ?? (row as any)?.updatedAt;

  return {
    id: getRowString(row, "id"),
    jobType,
    workspaceId: getRowString(row, "workspace_id") || getRowString(row, "workspaceId"),
    skillId: getRowString(row, "skill_id") || getRowString(row, "skillId"),
    fileId: getRowString(row, "file_id") || getRowString(row, "fileId"),
    fileVersion: parseRowNumber((row as any)?.file_version ?? (row as any)?.fileVersion ?? 1, 1),
    status: (getRowString(row, "status") as SkillFileIngestionJob["status"]) || "pending",
    attempts: parseRowNumber((row as any)?.attempts ?? 0, 0),
    nextRetryAt: nextRetryCandidate ? parseRowDate(nextRetryCandidate) : null,
    lastError: getRowString(row, "last_error") || getRowString(row, "lastError") || null,
    chunkCount: parseRowNumber((row as any)?.chunk_count ?? (row as any)?.chunkCount ?? null, 0) || null,
    totalChars: parseRowNumber((row as any)?.total_chars ?? (row as any)?.totalChars ?? null, 0) || null,
    totalTokens: parseRowNumber((row as any)?.total_tokens ?? (row as any)?.totalTokens ?? null, 0) || null,
    createdAt: parseRowDate(createdAtCandidate),
    updatedAt: parseRowDate(updatedAtCandidate),
  };
}

function sanitizedChunkTextExpression(source: SQL): SQL {
  return sql`sanitized_chunk_text(${source})`;
}

function buildChunkSearchVectorColumnStatement(ifNotExists: boolean): SQL {
  const headingExpression = sanitizedChunkTextExpression(sql`COALESCE("metadata"->>'heading', '')`);
  const firstSentenceExpression = sanitizedChunkTextExpression(sql`COALESCE("metadata"->>'firstSentence', '')`);
  const chunkTextExpression = sanitizedChunkTextExpression(sql`COALESCE("text", '')`);

  if (ifNotExists) {
    return sql`
      ALTER TABLE "knowledge_document_chunks"
      ADD COLUMN IF NOT EXISTS "text_tsv" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('simple', ${headingExpression}), 'A') ||
          setweight(to_tsvector('russian', ${firstSentenceExpression}), 'B') ||
          setweight(to_tsvector('russian', ${chunkTextExpression}), 'C')
        ) STORED
    `;
  }

  return sql`
    ALTER TABLE "knowledge_document_chunks"
    ADD COLUMN "text_tsv" tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', ${headingExpression}), 'A') ||
        setweight(to_tsvector('russian', ${firstSentenceExpression}), 'B') ||
        setweight(to_tsvector('russian', ${chunkTextExpression}), 'C')
      ) STORED
  `;
}

async function hasSanitizedChunkSearchVector(dbInstance: any): Promise<boolean> {
  const result = await dbInstance.execute(sql`
    SELECT pg_get_expr(d.adbin, d.adrelid) AS expression
    FROM pg_attribute a
    JOIN pg_class c ON a.attrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = 'public'
      AND c.relname = 'knowledge_document_chunks'
      AND a.attname = 'text_tsv'
  `);

  const expression = (result.rows?.[0] as Record<string, unknown> | undefined)?.expression;
  return typeof expression === "string" && expression.includes("regexp_replace(unaccent");
}

async function ensureSanitizedChunkSearchVector(dbInstance: any): Promise<void> {
  const hasSanitizedColumn = await hasSanitizedChunkSearchVector(dbInstance);
  if (!hasSanitizedColumn) {
    await dbInstance.execute(sql`
      ALTER TABLE "knowledge_document_chunks"
      DROP COLUMN IF EXISTS "text_tsv"
    `);
    await dbInstance.execute(buildChunkSearchVectorColumnStatement(false));
    await dbInstance.execute(sql`ANALYZE "knowledge_document_chunks"`);
  } else {
    await dbInstance.execute(buildChunkSearchVectorColumnStatement(true));
  }

  await dbInstance.execute(sql`
    CREATE INDEX IF NOT EXISTS knowledge_document_chunks_text_tsv_idx
    ON "knowledge_document_chunks"
    USING GIN ("text_tsv")
  `);
}

function toIsoTimestamp(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function sanitizeWorkspaceNameCandidate(source: string): string {
  const normalized = source.normalize("NFKC");
  let result = "";

  for (const char of normalized) {
    if (char === "_" || char === "-") {
      result += char;
      continue;
    }

    if (char >= "0" && char <= "9") {
      result += char;
      continue;
    }

    if (char.trim().length === 0) {
      result += " ";
      continue;
    }

    const lower = char.toLocaleLowerCase();
    const upper = char.toLocaleUpperCase();

    if (lower !== upper) {
      result += char;
      continue;
    }

    result += " ";
  }

  return result.trim();
}

async function normalizeKnowledgeBaseWorkspaces(): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE "knowledge_nodes" AS kn
      SET "workspace_id" = kb."workspace_id"
      FROM "knowledge_bases" AS kb
      WHERE kn."base_id" = kb."id"
        AND (kn."workspace_id" IS NULL OR btrim(kn."workspace_id") = '')
    `);
  } catch (error) {
    swallowPgError(error, ["42P01"]);
  }

  try {
    await db.execute(sql`
      UPDATE "knowledge_documents" AS kd
      SET "workspace_id" = kn."workspace_id"
      FROM "knowledge_nodes" AS kn
      WHERE kd."node_id" = kn."id"
        AND (kd."workspace_id" IS NULL OR btrim(kd."workspace_id") = '')
    `);
  } catch (error) {
    swallowPgError(error, ["42P01"]);
  }

  try {
    await db.execute(sql`
      UPDATE "knowledge_document_versions" AS kv
      SET "workspace_id" = kd."workspace_id"
      FROM "knowledge_documents" AS kd
      WHERE kv."document_id" = kd."id"
        AND (kv."workspace_id" IS NULL OR btrim(kv."workspace_id") = '')
    `);
  } catch (error) {
    swallowPgError(error, ["42P01"]);
  }

  try {
    await db.execute(sql`
      DELETE FROM "knowledge_document_versions"
      WHERE "document_id" IN (
        SELECT kd."id"
        FROM "knowledge_documents" AS kd
        LEFT JOIN "knowledge_nodes" AS kn ON kd."node_id" = kn."id"
        LEFT JOIN "knowledge_bases" AS kb ON kd."base_id" = kb."id"
        WHERE kn."id" IS NULL
          OR kb."id" IS NULL
          OR kn."workspace_id" IS NULL
          OR btrim(kn."workspace_id") = ''
          OR kd."workspace_id" IS NULL
          OR btrim(kd."workspace_id") = ''
      )
    `);
  } catch (error) {
    swallowPgError(error, ["42P01"]);
  }

  try {
    await db.execute(sql`
      DELETE FROM "knowledge_documents"
      WHERE "id" IN (
        SELECT kd."id"
        FROM "knowledge_documents" AS kd
        LEFT JOIN "knowledge_nodes" AS kn ON kd."node_id" = kn."id"
        LEFT JOIN "knowledge_bases" AS kb ON kd."base_id" = kb."id"
        WHERE kn."id" IS NULL
          OR kb."id" IS NULL
          OR kn."workspace_id" IS NULL
          OR btrim(kn."workspace_id") = ''
          OR kd."workspace_id" IS NULL
          OR btrim(kd."workspace_id") = ''
      )
    `);
  } catch (error) {
    swallowPgError(error, ["42P01"]);
  }

  try {
    await db.execute(sql`
      DELETE FROM "knowledge_nodes"
      WHERE ("workspace_id" IS NULL OR btrim("workspace_id") = '')
        OR NOT EXISTS (
          SELECT 1
          FROM "knowledge_bases"
          WHERE "knowledge_bases"."id" = "knowledge_nodes"."base_id"
        )
    `);
  } catch (error) {
    swallowPgError(error, ["42P01"]);
  }

  try {
    await db.execute(sql`
      DELETE FROM "knowledge_bases"
      WHERE ("workspace_id" IS NULL OR btrim("workspace_id") = '')
        OR NOT EXISTS (
          SELECT 1
          FROM "workspaces"
          WHERE "workspaces"."id" = "knowledge_bases"."workspace_id"
        )
    `);
  } catch (error) {
    swallowPgError(error, ["42P01"]);
  }
}

let cachedUuidExpression: SQL | null = null;
let ensuringUuidExpression: Promise<SQL> | null = null;
let loggedUuidFallbackWarning = false;
const randomHexExpressionCache = new Map<number, SQL>();
const ensuringRandomHexExpression = new Map<number, Promise<SQL>>();
let loggedRandomHexFallbackWarning = false;
let loggedContentHashFallbackWarning = false;

async function ensureConstraint(
  tableName: string,
  constraintName: string,
  createConstraintSql: SQL,
): Promise<void> {
  const constraintCheck = await db.execute(sql`
    SELECT COUNT(*)::int AS "constraintCount"
    FROM pg_constraint
    WHERE conrelid = ${sql.raw(`'public.${tableName}'::regclass`)}
      AND conname = ${constraintName}
  `);

  const count = Number(constraintCheck.rows[0]?.constraintCount ?? 0);
  if (Number.isFinite(count) && count > 0) {
    return;
  }

  await db.execute(createConstraintSql);
}

async function ensureIndex(indexName: string, createIndexSql: SQL): Promise<void> {
  const indexCheck = await db.execute(sql`
    SELECT COUNT(*)::int AS "indexCount"
    FROM pg_class
    WHERE relname = ${indexName}
      AND relkind = 'i'
  `);

  const count = Number(indexCheck.rows[0]?.indexCount ?? 0);
  if (Number.isFinite(count) && count > 0) {
    return;
  }

  await db.execute(createIndexSql);
}

async function hasGenRandomUuidFunction(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS "functionCount"
    FROM pg_proc
    WHERE proname = 'gen_random_uuid'
  `);
  const count = Number(result.rows[0]?.functionCount ?? 0);
  return Number.isFinite(count) && count > 0;
}

async function ensurePgcryptoExtensionAvailable(): Promise<void> {
  try {
    await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  } catch (error) {
    swallowPgError(error, ["42710", "42501"]);
  }
}

async function hasDigestFunction(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS "functionCount"
    FROM pg_proc
    WHERE proname = 'digest'
  `);
  const count = Number(result.rows[0]?.functionCount ?? 0);
  return Number.isFinite(count) && count > 0;
}

async function backfillChunkContentHashesInApp(): Promise<void> {
  const batchSize = 100;

  while (true) {
    const result = await db.execute(sql`
      SELECT "id", COALESCE("text", '') AS "text"
      FROM "knowledge_document_chunks"
      WHERE "content_hash" IS NULL
      LIMIT ${batchSize}
    `);

    const rows = (result.rows ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      break;
    }

    const updates = rows
      .map((row: Record<string, unknown>) => {
        const id = getRowString(row, "id");
        if (!id) {
          return null;
        }
        const text = getRowString(row, "text");
        const hash = createHash("sha256").update(text, "utf8").digest("hex");
        return { id, hash };
      })
      .filter((entry): entry is { id: string; hash: string } => Boolean(entry));

    if (updates.length === 0) {
      break;
    }

    const values = sql.join(
      updates.map(({ id, hash }: { id: string; hash: string }) => sql`(${id}, ${hash})`),
      sql`, `,
    );

    await db.execute(sql`
      UPDATE "knowledge_document_chunks" AS chunks
      SET "content_hash" = data.hash
      FROM (VALUES ${values}) AS data(id, hash)
      WHERE chunks."id" = data.id
    `);
  }
}

async function getUuidGenerationExpression(): Promise<SQL> {
  if (cachedUuidExpression) {
    return cachedUuidExpression;
  }

  if (ensuringUuidExpression) {
    return ensuringUuidExpression;
  }

  ensuringUuidExpression = (async () => {
    if (await hasGenRandomUuidFunction()) {
      return sql.raw("gen_random_uuid()::text");
    }

    await ensurePgcryptoExtensionAvailable();

    if (await hasGenRandomUuidFunction()) {
      return sql.raw("gen_random_uuid()::text");
    }

    if (!loggedUuidFallbackWarning) {
      console.warn(
        "pgcrypto недоступен или недоступна функция gen_random_uuid(), используем резервную генерацию идентификаторов",
      );
      loggedUuidFallbackWarning = true;
    }

    return sql.raw(
      "(lower(lpad(md5(random()::text || clock_timestamp()::text || random()::text), 32, '0')))",
    );
  })();

  try {
    cachedUuidExpression = await ensuringUuidExpression;
    return cachedUuidExpression;
  } finally {
    ensuringUuidExpression = null;
  }
}

async function hasGenRandomBytesFunction(): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS "functionCount"
    FROM pg_proc
    WHERE proname = 'gen_random_bytes'
  `);
  const count = Number(result.rows[0]?.functionCount ?? 0);
  return Number.isFinite(count) && count > 0;
}

async function getRandomHexExpression(byteLength: number): Promise<SQL> {
  const cached = randomHexExpressionCache.get(byteLength);
  if (cached) {
    return cached;
  }

  const existingPromise = ensuringRandomHexExpression.get(byteLength);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = (async () => {
    if (await hasGenRandomBytesFunction()) {
      return sql.raw(`encode(gen_random_bytes(${byteLength}), 'hex')`);
    }

    await ensurePgcryptoExtensionAvailable();

    if (await hasGenRandomBytesFunction()) {
      return sql.raw(`encode(gen_random_bytes(${byteLength}), 'hex')`);
    }

    if (!loggedRandomHexFallbackWarning) {
      console.warn(
        "pgcrypto недоступен или недоступна функция gen_random_bytes(), используем резервную генерацию hex-строк",
      );
      loggedRandomHexFallbackWarning = true;
    }

    const hexLength = Math.max(2, byteLength * 2);
    const segmentCount = Math.max(1, Math.ceil(hexLength / 32));
    const segments: string[] = [];
    for (let i = 0; i < segmentCount; i++) {
      segments.push(
        `lpad(md5(random()::text || clock_timestamp()::text || ${i + 1}::text || random()::text), 32, '0')`,
      );
    }
    const concatenated = segments.join(" || ");
    const expression = `lower(substring(${concatenated} FROM 1 FOR ${hexLength}))`;
    return sql.raw(expression);
  })();

  ensuringRandomHexExpression.set(byteLength, promise);

  try {
    const expression = await promise;
    randomHexExpressionCache.set(byteLength, expression);
    return expression;
  } finally {
    ensuringRandomHexExpression.delete(byteLength);
  }
}

export interface GoogleUserUpsertPayload {
  googleId: string;
  email: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  emailVerified?: boolean | null;
}

export interface YandexUserUpsertPayload {
  yandexId: string;
  email: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  avatar?: string | null;
  emailVerified?: boolean | null;
}

function normalizeProfileString(value: string | null | undefined): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, " ");
}

function resolveNamesFromProfile(options: {
  emailFallback: string;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): { fullName: string; firstName: string; lastName: string } {
  const providedFullName = normalizeProfileString(options.fullName);
  const providedFirstName = normalizeProfileString(options.firstName);
  const providedLastName = normalizeProfileString(options.lastName);

  let fullName = providedFullName;

  if (!fullName && providedFirstName && providedLastName) {
    fullName = `${providedFirstName} ${providedLastName}`.trim();
  }

  if (!fullName && providedFirstName) {
    fullName = providedFirstName;
  }

  if (!fullName) {
    fullName = options.emailFallback;
  }

  const normalizedFullName = fullName.trim().replace(/\s+/g, " ");
  const fullNameParts = normalizedFullName.split(" ").filter((part) => part.length > 0);

  let firstName = providedFirstName;
  let lastName = providedLastName;

  if (!firstName && fullNameParts.length > 0) {
    firstName = fullNameParts[0];
  }

  if (!firstName) {
    firstName = normalizedFullName;
  }

  if (!lastName) {
    lastName = fullNameParts.slice(1).join(" ").trim();
  }

  return {
    fullName: normalizedFullName,
    firstName: firstName || normalizedFullName,
    lastName,
  };
}

function generatePersonalWorkspaceName(user: User): string {
  const emailPrefix = typeof user.email === "string" ? user.email.split("@")[0] ?? "" : "";
  const cleaned = sanitizeWorkspaceNameCandidate(emailPrefix);
  if (cleaned.length > 0) {
    return cleaned;
  }

  const fallback = user.fullName?.trim();
  if (fallback && fallback.length > 0) {
    return fallback;
  }

  return "Личное пространство";
}

export type WorkspaceWithRole = Workspace & {
  role: WorkspaceMember["role"];
  ownerFullName?: string | null;
  ownerEmail?: string | null;
};

export type WorkspaceUpdatePayload = {
  iconUrl?: string | null;
  iconKey?: string | null;
  storageBucket?: string | null;
};
export interface WorkspaceMemberWithUser {
  member: WorkspaceMember;
  user: User;
}

export interface WorkspaceAdminSummary {
  id: string;
  name: string;
  createdAt: Date;
  usersCount: number;
  managerFullName: string | null;
  tariffPlanId: string | null;
  tariffPlanCode: string | null;
  tariffPlanName: string | null;
  defaultFileStorageProviderId: string | null;
  defaultFileStorageProviderName: string | null;
}

export type KnowledgeBaseAskAiRunRecordInput = {
  workspaceId: string;
  knowledgeBaseId: string;
  prompt: string;
  normalizedQuery: string | null;
  status: "success" | "error";
  errorMessage: string | null;
  topK: number | null;
  bm25Weight: number | null;
  bm25Limit: number | null;
  vectorWeight: number | null;
  vectorLimit: number | null;
  vectorCollection: string | null;
  embeddingProviderId: string | null;
  llmProviderId: string | null;
  llmModel: string | null;
  bm25ResultCount: number | null;
  vectorResultCount: number | null;
  vectorDocumentCount: number | null;
  combinedResultCount: number | null;
  embeddingTokens: number | null;
  llmTokens: number | null;
  totalTokens: number | null;
  retrievalDurationMs: number | null;
  bm25DurationMs: number | null;
  vectorDurationMs: number | null;
  llmDurationMs: number | null;
  totalDurationMs: number | null;
  startedAt: string | null;
  pipelineLog: KnowledgeBaseAskAiPipelineStepLog[];
};

export interface IStorage {
  // Sites management
  createSite(site: SiteInsert): Promise<Site>;
  getSite(id: string, workspaceId?: string): Promise<Site | undefined>;
  getSiteByPublicId(publicId: string): Promise<Site | undefined>;
  getAllSites(workspaceId?: string): Promise<Site[]>;
  updateSite(id: string, updates: Partial<Site>, workspaceId?: string): Promise<Site | undefined>;
  deleteSite(id: string, workspaceId?: string): Promise<boolean>;
  rotateSiteApiKey(
    siteId: string,
    workspaceId?: string,
  ): Promise<{ site: Site; apiKey: string } | undefined>;

  // Vector collections ownership
  listWorkspaceCollections(workspaceId: string): Promise<string[]>;
  getCollectionWorkspace(collectionName: string): Promise<string | null>;
  upsertCollectionWorkspace(collectionName: string, workspaceId: string): Promise<void>;
  removeCollectionWorkspace(collectionName: string): Promise<void>;

  // Workspace embed keys
  getOrCreateWorkspaceEmbedKey(
    workspaceId: string,
    collection: string,
    knowledgeBaseId: string,
  ): Promise<WorkspaceEmbedKey>;
  getWorkspaceEmbedKey(id: string, workspaceId?: string): Promise<WorkspaceEmbedKey | undefined>;
  getWorkspaceEmbedKeyByPublicKey(publicKey: string): Promise<WorkspaceEmbedKey | undefined>;
  listWorkspaceEmbedKeyDomains(
    embedKeyId: string,
    workspaceId?: string,
  ): Promise<WorkspaceEmbedKeyDomain[]>;
  addWorkspaceEmbedKeyDomain(
    embedKeyId: string,
    workspaceId: string,
    domain: string,
  ): Promise<WorkspaceEmbedKeyDomain | undefined>;
  removeWorkspaceEmbedKeyDomain(
    embedKeyId: string,
    domainId: string,
    workspaceId: string,
  ): Promise<boolean>;
  listAllWorkspaceEmbedDomains(): Promise<string[]>;

  // Database health diagnostics
  getDatabaseHealthInfo(): Promise<{
    schema_name: string;
    database_name: string;
    pg_trgm_available: boolean;
    unaccent_available: boolean;
    search_vector_columns_exist: boolean;
    relevance_column_exists: boolean;
  }>;

  // Workspaces administration
  listAllWorkspacesWithStats(): Promise<WorkspaceAdminSummary[]>;

  // User management (reserved for future admin features)
  getUser(id: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByYandexId(yandexId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUserFromGoogle(payload: GoogleUserUpsertPayload): Promise<User>;
  upsertUserFromYandex(payload: YandexUserUpsertPayload): Promise<User>;
  listUsers(): Promise<User[]>;
  updateUserRole(userId: string, role: User["role"]): Promise<User | undefined>;
  recordUserActivity(userId: string): Promise<User | undefined>;
  confirmUserEmail(userId: string): Promise<User | undefined>;
  updateUserProfile(
    userId: string,
    updates: { firstName: string; lastName: string; phone: string; fullName: string },
  ): Promise<User | undefined>;
  updateUserPassword(userId: string, passwordHash: string): Promise<User | undefined>;
  createUserPersonalApiToken(
    userId: string,
    token: { hash: string; lastFour: string },
  ): Promise<PersonalApiToken | undefined>;
  listUserPersonalApiTokens(userId: string): Promise<PersonalApiToken[]>;
  revokeUserPersonalApiToken(userId: string, tokenId: string): Promise<PersonalApiToken | undefined>;
  setUserPersonalApiToken(
    userId: string,
    token: { hash: string | null; lastFour: string | null; generatedAt?: Date | string | null },
  ): Promise<User | undefined>;
  getUserByPersonalApiTokenHash(hash: string): Promise<User | undefined>;

  // Workspaces
  getWorkspace(id: string): Promise<Workspace | undefined>;
  updateWorkspaceIcon(
    workspaceId: string,
    iconUrl: string | null,
    iconKey?: string | null,
  ): Promise<Workspace | undefined>;
  setWorkspaceStorageBucket(workspaceId: string, bucketName: string): Promise<void>;
  isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
  getWorkspaceMember(userId: string, workspaceId: string): Promise<WorkspaceMembership | undefined>;
  ensurePersonalWorkspace(user: User): Promise<Workspace>;
  ensureWorkspaceVectorCollection(workspaceId: string): Promise<string>;
  listUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]>;
  getOrCreateUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]>;
  getWorkspaceKnowledgeBaseCounts(workspaceIds: readonly string[]): Promise<Map<string, number>>;
  addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role?: WorkspaceMember["role"],
  ): Promise<WorkspaceMember | undefined>;
  updateWorkspaceMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceMember["role"],
  ): Promise<WorkspaceMember | undefined>;
  listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberWithUser[]>;
  removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;

  // Auth providers
  getAuthProvider(provider: AuthProviderType): Promise<AuthProvider | undefined>;
  upsertAuthProvider(
    provider: AuthProviderType,
    updates: Partial<AuthProviderInsert>,
  ): Promise<AuthProvider>;

  // Embedding services
  listEmbeddingProviders(workspaceId?: string): Promise<EmbeddingProvider[]>;
  getEmbeddingProvider(id: string, workspaceId?: string): Promise<EmbeddingProvider | undefined>;
  createEmbeddingProvider(provider: EmbeddingProviderInsert): Promise<EmbeddingProvider>;
  updateEmbeddingProvider(
    id: string,
    updates: Partial<EmbeddingProviderInsert>,
    workspaceId?: string,
  ): Promise<EmbeddingProvider | undefined>;
  deleteEmbeddingProvider(id: string, workspaceId?: string): Promise<boolean>;

  // LLM services
  listLlmProviders(workspaceId?: string): Promise<LlmProvider[]>;
  getLlmProvider(id: string, workspaceId?: string): Promise<LlmProvider | undefined>;
  createLlmProvider(provider: LlmProviderInsert): Promise<LlmProvider>;
  updateLlmProvider(
    id: string,
    updates: Partial<LlmProviderInsert>,
    workspaceId?: string,
  ): Promise<LlmProvider | undefined>;
  deleteLlmProvider(id: string, workspaceId?: string): Promise<boolean>;

  // Files
  createFile(file: FileInsert): Promise<File>;
  getFile(id: string, workspaceId?: string): Promise<File | undefined>;
  updateFile(id: string, updates: Partial<FileInsert>): Promise<File | undefined>;

  // File storage providers
  listFileStorageProviders(options?: { limit?: number; offset?: number; activeOnly?: boolean }): Promise<{
    items: FileStorageProvider[];
    total: number;
    limit: number;
    offset: number;
  }>;
  getFileStorageProvider(id: string): Promise<FileStorageProvider | undefined>;
  createFileStorageProvider(provider: FileStorageProviderInsert): Promise<FileStorageProvider>;
  updateFileStorageProvider(
    id: string,
    updates: Partial<FileStorageProviderInsert>,
  ): Promise<FileStorageProvider | undefined>;
  deleteFileStorageProvider(id: string): Promise<boolean>;

  // Unica Chat configuration
  getUnicaChatConfig(): Promise<UnicaChatConfig>;
  updateUnicaChatConfig(
    updates: Partial<
      Pick<UnicaChatConfigInsert, "llmProviderConfigId" | "modelId" | "systemPrompt" | "temperature" | "topP" | "maxTokens">
    >,
  ): Promise<UnicaChatConfig>;

  // Knowledge base RAG telemetry
  recordKnowledgeBaseRagRequest(entry: {
    workspaceId: string;
    knowledgeBaseId: string;
    topK: number | null;
    bm25Weight: number | null;
    bm25Limit: number | null;
    vectorWeight: number | null;
    vectorLimit: number | null;
    embeddingProviderId: string | null;
    collection: string | null;
  }): Promise<void>;
  getLatestKnowledgeBaseRagConfig(
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseRagConfig | null>;
  getKnowledgeBaseSearchSettings(
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseSearchSettingsRow | null>;
  upsertKnowledgeBaseSearchSettings(
    workspaceId: string,
    knowledgeBaseId: string,
    settings: {
      chunkSettings: KnowledgeBaseChunkSearchSettings;
      ragSettings: KnowledgeBaseRagSearchSettings;
    },
  ): Promise<KnowledgeBaseSearchSettingsRow>;
  recordKnowledgeBaseAskAiRun(entry: KnowledgeBaseAskAiRunRecordInput): Promise<void>;
  listKnowledgeBaseAskAiRuns(
    workspaceId: string,
    knowledgeBaseId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{
    items: KnowledgeBaseAskAiRunSummary[];
    hasMore: boolean;
    nextOffset: number | null;
  }>;
  getKnowledgeBaseAskAiRun(
    runId: string,
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseAskAiRunDetail | null>;

  listChatSessions(
    workspaceId: string,
    userId: string,
    searchQuery?: string,
  ): Promise<Array<ChatSession & { skillName: string | null; skillIsSystem: boolean }>>;
  getChatSessionById(
    chatId: string,
  ): Promise<(ChatSession & { skillName: string | null; skillIsSystem: boolean; skillSystemKey: string | null }) | null>;
  createChatSession(values: ChatSessionInsert): Promise<ChatSession>;
  updateChatSession(
    chatId: string,
    updates: Partial<Pick<ChatSessionInsert, "title">>,
  ): Promise<ChatSession | null>;
  touchChatSession(chatId: string): Promise<void>;
  softDeleteChatSession(chatId: string): Promise<boolean>;
  createChatCard(values: ChatCardInsert): Promise<ChatCard>;
  getChatCardById(id: string): Promise<ChatCard | undefined>;
  updateChatCard(
    id: string,
    updates: Partial<Pick<ChatCardInsert, "title" | "previewText" | "transcriptId">>,
  ): Promise<ChatCard | undefined>;
  listChatMessages(chatId: string): Promise<ChatMessage[]>;
  createChatMessage(values: ChatMessageInsert): Promise<ChatMessage>;
  getChatMessage(id: string): Promise<ChatMessage | undefined>;
  countChatMessages(chatId: string): Promise<number>;
  createChatAttachment(values: ChatAttachmentInsert): Promise<ChatAttachment>;
  findChatAttachmentByMessageId(messageId: string): Promise<ChatAttachment | undefined>;
  getChatAttachment(id: string): Promise<ChatAttachment | undefined>;
  createSkillFiles(values: SkillFileInsert[], options?: { createIngestionJobs?: boolean }): Promise<SkillFile[]>;
  updateSkillFileStatus(
    id: string,
    workspaceId: string,
    skillId: string,
    patch: {
      status?: SkillFile["status"];
      errorMessage?: string | null;
      processingStatus?: SkillFile["status"];
      processingErrorMessage?: string | null;
    },
  ): Promise<void>;
  createSkillFileIngestionJob(value: SkillFileIngestionJobInsert): Promise<SkillFileIngestionJob | null>;
  findSkillFileIngestionJobByFile(
    fileId: string,
    fileVersion: number,
  ): Promise<SkillFileIngestionJob | undefined>;
  claimNextSkillFileIngestionJob(now?: Date): Promise<SkillFileIngestionJob | null>;
  markSkillFileIngestionJobDone(
    jobId: string,
    stats?: { chunkCount?: number | null; totalChars?: number | null; totalTokens?: number | null },
  ): Promise<void>;
  rescheduleSkillFileIngestionJob(jobId: string, nextRetryAt: Date, errorMessage?: string | null): Promise<void>;
  failSkillFileIngestionJob(jobId: string, errorMessage?: string | null): Promise<void>;
  listSkillFiles(workspaceId: string, skillId: string): Promise<SkillFile[]>;
  getSkillFile(id: string, workspaceId: string, skillId: string): Promise<SkillFile | undefined>;
  deleteSkillFile(id: string, workspaceId: string, skillId: string): Promise<boolean>;
  listReadySkillFileIds(workspaceId: string, skillId: string): Promise<string[]>;
  hasReadySkillFiles(workspaceId: string, skillId: string): Promise<boolean>;
  updateChatTitleIfEmpty(chatId: string, title: string): Promise<boolean>;
  getWorkspaceDefaultFileStorageProvider(workspaceId: string): Promise<FileStorageProvider | null>;
  setWorkspaceDefaultFileStorageProvider(workspaceId: string, providerId: string | null): Promise<void>;
  createKnowledgeBaseIndexingJob(value: KnowledgeBaseIndexingJobInsert): Promise<KnowledgeBaseIndexingJob | null>;
  findKnowledgeBaseIndexingJobByDocument(
    documentId: string,
    versionId: string,
  ): Promise<KnowledgeBaseIndexingJob | undefined>;
  claimNextKnowledgeBaseIndexingJob(now?: Date): Promise<KnowledgeBaseIndexingJob | null>;
  countKnowledgeBaseIndexingJobs(
    workspaceId: string,
    baseId: string,
    status: "pending" | "processing" | "completed" | "failed" | null,
    options?: { since?: Date | null },
  ): Promise<number>;
  markKnowledgeBaseIndexingJobDone(
    jobId: string,
    stats?: { chunkCount?: number | null; totalChars?: number | null; totalTokens?: number | null },
  ): Promise<void>;
  rescheduleKnowledgeBaseIndexingJob(jobId: string, nextRetryAt: Date, errorMessage?: string | null): Promise<void>;
  failKnowledgeBaseIndexingJob(jobId: string, errorMessage?: string | null): Promise<void>;
  getKnowledgeBaseIndexingPolicy(): Promise<KnowledgeBaseIndexingPolicy | null>;
  updateKnowledgeBaseIndexingPolicy(policy: Partial<KnowledgeBaseIndexingPolicy>): Promise<KnowledgeBaseIndexingPolicy>;

  // Knowledge document indexing revisions
  createKnowledgeDocumentIndexRevision(
    value: KnowledgeDocumentIndexRevisionInsert,
  ): Promise<KnowledgeDocumentIndexRevisionRecord | null>;
  updateKnowledgeDocumentIndexRevision(
    workspaceId: string,
    documentId: string,
    revisionId: string,
    updates: Partial<KnowledgeDocumentIndexRevisionInsert>,
  ): Promise<KnowledgeDocumentIndexRevisionRecord | null>;
  getKnowledgeDocumentIndexRevision(
    workspaceId: string,
    documentId: string,
    revisionId: string,
  ): Promise<KnowledgeDocumentIndexRevisionRecord | null>;
  getLatestKnowledgeDocumentIndexRevision(
    workspaceId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentIndexRevisionRecord | null>;
  switchKnowledgeDocumentRevision(
    workspaceId: string,
    documentId: string,
    revisionId: string,
    chunkSetId: string,
  ): Promise<{ previousRevisionId: string | null }>;

  // Knowledge base indexing state
  upsertKnowledgeDocumentIndexState(
    value: KnowledgeDocumentIndexStateInsert,
  ): Promise<KnowledgeDocumentIndexStateRecord | null>;
  updateKnowledgeDocumentIndexState(
    workspaceId: string,
    baseId: string,
    documentId: string,
    updates: Partial<KnowledgeDocumentIndexStateInsert>,
  ): Promise<KnowledgeDocumentIndexStateRecord | null>;
  getKnowledgeDocumentIndexState(
    workspaceId: string,
    baseId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentIndexStateRecord | null>;
  upsertKnowledgeBaseIndexState(
    value: KnowledgeBaseIndexStateInsert,
  ): Promise<KnowledgeBaseIndexStateRecord | null>;
  updateKnowledgeBaseIndexState(
    workspaceId: string,
    baseId: string,
    updates: Partial<KnowledgeBaseIndexStateInsert>,
  ): Promise<KnowledgeBaseIndexStateRecord | null>;
  getKnowledgeBaseIndexState(
    workspaceId: string,
    baseId: string,
  ): Promise<KnowledgeBaseIndexStateRecord | null>;

  // Knowledge base indexing actions
  createKnowledgeBaseIndexingAction(
    value: KnowledgeBaseIndexingActionInsert,
  ): Promise<KnowledgeBaseIndexingActionRecord | null>;
  updateKnowledgeBaseIndexingAction(
    workspaceId: string,
    baseId: string,
    actionId: string,
    updates: Partial<KnowledgeBaseIndexingActionInsert>,
  ): Promise<KnowledgeBaseIndexingActionRecord | null>;
  getKnowledgeBaseIndexingAction(
    workspaceId: string,
    baseId: string,
    actionId: string,
  ): Promise<KnowledgeBaseIndexingActionRecord | null>;
  getLatestKnowledgeBaseIndexingAction(
    workspaceId: string,
    baseId: string,
  ): Promise<KnowledgeBaseIndexingActionRecord | null>;
}

let usersTableEnsured = false;
let ensuringUsersTable: Promise<void> | null = null;

let embeddingProvidersTableEnsured = false;
let ensuringEmbeddingProvidersTable: Promise<void> | null = null;

let llmProvidersTableEnsured = false;
let ensuringLlmProvidersTable: Promise<void> | null = null;

let authProvidersTableEnsured = false;
let ensuringAuthProvidersTable: Promise<void> | null = null;

let speechProvidersTableEnsured = false;
let ensuringSpeechProvidersTable: Promise<void> | null = null;

let fileStorageProvidersTableEnsured = false;
let ensuringFileStorageProvidersTable: Promise<void> | null = null;

let fileEventOutboxTableEnsured = false;
let ensuringFileEventOutboxTable: Promise<void> | null = null;

let filesTableEnsured = false;
let ensuringFilesTable: Promise<void> | null = null;

let workspacesTableEnsured = false;
let ensuringWorkspacesTable: Promise<void> | null = null;

let workspaceMembersTableEnsured = false;
let ensuringWorkspaceMembersTable: Promise<void> | null = null;

let unicaChatConfigTableEnsured = false;
let ensuringUnicaChatConfigTable: Promise<void> | null = null;
const UNICA_CHAT_CONFIG_ID = "singleton";

let chatSessionsTableEnsured = false;
let ensuringChatSessionsTable: Promise<void> | null = null;
let chatCardsTableEnsured = false;
let ensuringChatCardsTable: Promise<void> | null = null;
let chatMessagesTableEnsured = false;
let ensuringChatMessagesTable: Promise<void> | null = null;
let chatAttachmentsTableEnsured = false;
let ensuringChatAttachmentsTable: Promise<void> | null = null;
let transcriptsTableEnsured = false;
let ensuringTranscriptsTable: Promise<void> | null = null;

let workspaceCollectionsTableEnsured = false;
let ensuringWorkspaceCollectionsTable: Promise<void> | null = null;

let knowledgeBaseRagRequestsTableEnsured = false;
let ensuringKnowledgeBaseRagRequestsTable: Promise<void> | null = null;

let knowledgeBaseSearchSettingsTableEnsured = false;
let ensuringKnowledgeBaseSearchSettingsTable: Promise<void> | null = null;

let knowledgeBaseAskAiRunsTableEnsured = false;
let ensuringKnowledgeBaseAskAiRunsTable: Promise<void> | null = null;

let knowledgeBaseTablesEnsured = false;
let ensuringKnowledgeBaseTables: Promise<void> | null = null;
let knowledgeBasePathUsesLtree: boolean | null = null;

let skillFilesTableEnsured = false;
let ensuringSkillFilesTable: Promise<void> | null = null;
let skillFileIngestionJobsTableEnsured = false;
let ensuringSkillFileIngestionJobsTable: Promise<void> | null = null;

function coerceDatabaseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value > 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "t" || normalized === "true" || normalized === "1";
  }

  return false;
}

async function detectLtreeSupport(): Promise<boolean> {
  try {
    const result = await db.execute(
      sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_type
          WHERE typname = 'ltree'
        ) AS "hasLtree"
      `,
    );

    const row = result.rows?.[0];
    const value = row?.hasLtree ?? row?.hasltree ?? row?.exists ?? row?.count;
    return coerceDatabaseBoolean(value);
  } catch (error) {
    console.warn("[storage] Не удалось определить поддержку расширения ltree", error);
    return false;
  }
}

export function isKnowledgeBasePathLtreeEnabled(): boolean {
  return knowledgeBasePathUsesLtree === true;
}

async function ensureWorkspacesTable(): Promise<void> {
  if (workspacesTableEnsured) {
    return;
  }

  if (ensuringWorkspacesTable) {
    await ensuringWorkspacesTable;
    return;
  }

  ensuringWorkspacesTable = (async () => {
    const uuidExpression = await getUuidGenerationExpression();
    await ensureFileStorageProvidersTable();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workspaces" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "name" text NOT NULL,
        "owner_id" varchar NOT NULL,
        "plan" text NOT NULL DEFAULT 'free',
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "default_file_storage_provider_id" varchar REFERENCES "file_storage_providers"("id") ON DELETE SET NULL
      )
    `);

    await ensureConstraint(
      "workspaces",
      "workspaces_owner_id_fkey",
      sql`
        ALTER TABLE "workspaces"
        ADD CONSTRAINT "workspaces_owner_id_fkey"
        FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
      `,
    );

    workspacesTableEnsured = true;
  })();

  await ensuringWorkspacesTable;
}

async function ensureWorkspaceMembersTable(): Promise<void> {
  if (workspaceMembersTableEnsured) {
    return;
  }

  if (ensuringWorkspaceMembersTable) {
    await ensuringWorkspaceMembersTable;
    return;
  }

  ensuringWorkspaceMembersTable = (async () => {
    await ensureWorkspacesTable();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workspace_members" (
        "workspace_id" varchar NOT NULL,
        "user_id" varchar NOT NULL,
        "role" text NOT NULL DEFAULT 'user',
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT workspace_members_pk PRIMARY KEY ("workspace_id", "user_id")
      )
    `);

    await ensureConstraint(
      "workspace_members",
      "workspace_members_workspace_id_fkey",
      sql`
        ALTER TABLE "workspace_members"
        ADD CONSTRAINT "workspace_members_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "workspace_members",
      "workspace_members_user_id_fkey",
      sql`
        ALTER TABLE "workspace_members"
        ADD CONSTRAINT "workspace_members_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      `,
    );

    workspaceMembersTableEnsured = true;
  })();

  await ensuringWorkspaceMembersTable;
}

async function ensureUnicaChatConfigTable(): Promise<void> {
  if (unicaChatConfigTableEnsured) {
    return;
  }

  if (ensuringUnicaChatConfigTable) {
    await ensuringUnicaChatConfigTable;
    return;
  }

  ensuringUnicaChatConfigTable = (async () => {
    await ensureLlmProvidersTable();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "unica_chat_config" (
        "id" varchar PRIMARY KEY DEFAULT 'singleton',
        "llm_provider_config_id" varchar REFERENCES "llm_providers"("id") ON DELETE SET NULL,
        "model_id" text,
        "system_prompt" text NOT NULL DEFAULT '',
        "temperature" double precision NOT NULL DEFAULT 0.7,
        "top_p" double precision NOT NULL DEFAULT 1,
        "max_tokens" integer,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      INSERT INTO "unica_chat_config" ("id", "system_prompt")
      VALUES (${UNICA_CHAT_CONFIG_ID}, '')
      ON CONFLICT ("id") DO NOTHING
    `);

    unicaChatConfigTableEnsured = true;
  })();

  await ensuringUnicaChatConfigTable;
  ensuringUnicaChatConfigTable = null;
}

async function ensureChatSessionsTable(): Promise<void> {
  if (chatSessionsTableEnsured) {
    return;
  }

  if (ensuringChatSessionsTable) {
    await ensuringChatSessionsTable;
    return;
  }

  ensuringChatSessionsTable = (async () => {
    await ensureWorkspacesTable();
    await ensureWorkspaceMembersTable();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "chat_sessions" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "workspace_id" varchar NOT NULL,
        "user_id" varchar NOT NULL,
        "skill_id" varchar NOT NULL,
        "title" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "deleted_at" timestamp
      )
    `);

    await ensureConstraint(
      "chat_sessions",
      "chat_sessions_workspace_id_fkey",
      sql`
        ALTER TABLE "chat_sessions"
        ADD CONSTRAINT "chat_sessions_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "chat_sessions",
      "chat_sessions_user_id_fkey",
      sql`
        ALTER TABLE "chat_sessions"
        ADD CONSTRAINT "chat_sessions_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "chat_sessions",
      "chat_sessions_skill_id_fkey",
      sql`
        ALTER TABLE "chat_sessions"
        ADD CONSTRAINT "chat_sessions_skill_id_fkey"
        FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE
      `,
    );

    await db.execute(sql`
      ALTER TABLE "chat_sessions"
      ADD COLUMN IF NOT EXISTS "current_assistant_action_type" text
    `);
    await db.execute(sql`
      ALTER TABLE "chat_sessions"
      ADD COLUMN IF NOT EXISTS "current_assistant_action_text" text
    `);
    await db.execute(sql`
      ALTER TABLE "chat_sessions"
      ADD COLUMN IF NOT EXISTS "current_assistant_action_trigger_message_id" text
    `);
    await db.execute(sql`
      ALTER TABLE "chat_sessions"
      ADD COLUMN IF NOT EXISTS "current_assistant_action_updated_at" timestamp
    `);

    chatSessionsTableEnsured = true;
  })();

  await ensuringChatSessionsTable;
  ensuringChatSessionsTable = null;
}

async function ensureChatCardsTable(): Promise<void> {
  if (chatCardsTableEnsured) {
    return;
  }

  if (ensuringChatCardsTable) {
    await ensuringChatCardsTable;
    return;
  }

  ensuringChatCardsTable = (async () => {
    await ensureChatSessionsTable();
    await ensureWorkspacesTable();
    await ensureUsersTable();
    await ensureTranscriptsTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "chat_cards" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "workspace_id" varchar NOT NULL,
        "chat_id" varchar NOT NULL,
        "type" text NOT NULL,
        "title" text,
        "preview_text" text,
        "transcript_id" varchar,
        "created_by_user_id" varchar,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "chat_cards",
      "chat_cards_workspace_id_fkey",
      sql`
        ALTER TABLE "chat_cards"
        ADD CONSTRAINT "chat_cards_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "chat_cards",
      "chat_cards_chat_id_fkey",
      sql`
        ALTER TABLE "chat_cards"
        ADD CONSTRAINT "chat_cards_chat_id_fkey"
        FOREIGN KEY ("chat_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "chat_cards",
      "chat_cards_created_by_user_id_fkey",
      sql`
        ALTER TABLE "chat_cards"
        ADD CONSTRAINT "chat_cards_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      `,
    );

    await ensureConstraint(
      "chat_cards",
      "chat_cards_transcript_id_fkey",
      sql`
        ALTER TABLE "chat_cards"
        ADD CONSTRAINT "chat_cards_transcript_id_fkey"
        FOREIGN KEY ("transcript_id") REFERENCES "transcripts"("id") ON DELETE SET NULL
      `,
    );

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "chat_cards_workspace_idx" ON "chat_cards" ("workspace_id", "created_at")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "chat_cards_chat_idx" ON "chat_cards" ("chat_id", "created_at")
    `);

    chatCardsTableEnsured = true;
  })();

  await ensuringChatCardsTable;
  ensuringChatCardsTable = null;
}

async function ensureChatMessagesTable(): Promise<void> {
  if (chatMessagesTableEnsured) {
    return;
  }

  if (ensuringChatMessagesTable) {
    await ensuringChatMessagesTable;
    return;
  }

  ensuringChatMessagesTable = (async () => {
    await ensureChatSessionsTable();
    await ensureChatCardsTable();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "chat_messages" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "chat_id" varchar NOT NULL,
        "message_type" text NOT NULL DEFAULT 'text',
        "role" text NOT NULL,
        "content" text NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      ALTER TABLE "chat_messages"
      ADD COLUMN IF NOT EXISTS "message_type" text NOT NULL DEFAULT 'text'
    `);

    await db.execute(sql`
      ALTER TABLE "chat_messages"
      ADD COLUMN IF NOT EXISTS "card_id" varchar
    `);

    await ensureConstraint(
      "chat_messages",
      "chat_messages_card_id_fkey",
      sql`
        ALTER TABLE "chat_messages"
        ADD CONSTRAINT "chat_messages_card_id_fkey"
        FOREIGN KEY ("card_id") REFERENCES "chat_cards"("id") ON DELETE SET NULL
      `,
    );

    await ensureConstraint(
      "chat_messages",
      "chat_messages_chat_id_fkey",
      sql`
        ALTER TABLE "chat_messages"
        ADD CONSTRAINT "chat_messages_chat_id_fkey"
        FOREIGN KEY ("chat_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE
      `,
    );

    chatMessagesTableEnsured = true;
  })();

  await ensuringChatMessagesTable;
  ensuringChatMessagesTable = null;
}

async function ensureChatAttachmentsTable(): Promise<void> {
  if (chatAttachmentsTableEnsured) {
    return;
  }
  if (ensuringChatAttachmentsTable) {
    await ensuringChatAttachmentsTable;
    return;
  }

  ensuringChatAttachmentsTable = (async () => {
    await ensureChatSessionsTable();
    await ensureWorkspacesTable();
    await ensureUsersTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "chat_attachments" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "workspace_id" varchar NOT NULL,
        "chat_id" varchar NOT NULL,
        "message_id" varchar,
        "uploader_user_id" varchar,
        "filename" text NOT NULL,
        "mime_type" text,
        "size_bytes" bigint,
        "storage_key" text NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "chat_attachments",
      "chat_attachments_workspace_id_fkey",
      sql`
        ALTER TABLE "chat_attachments"
        ADD CONSTRAINT "chat_attachments_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "chat_attachments",
      "chat_attachments_chat_id_fkey",
      sql`
        ALTER TABLE "chat_attachments"
        ADD CONSTRAINT "chat_attachments_chat_id_fkey"
        FOREIGN KEY ("chat_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "chat_attachments",
      "chat_attachments_message_id_fkey",
      sql`
        ALTER TABLE "chat_attachments"
        ADD CONSTRAINT "chat_attachments_message_id_fkey"
        FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL
      `,
    );

    await ensureConstraint(
      "chat_attachments",
      "chat_attachments_uploader_user_id_fkey",
      sql`
        ALTER TABLE "chat_attachments"
        ADD CONSTRAINT "chat_attachments_uploader_user_id_fkey"
        FOREIGN KEY ("uploader_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      `,
    );

    await ensureIndex(
      "chat_attachments_workspace_idx",
      sql`CREATE INDEX IF NOT EXISTS chat_attachments_workspace_idx ON chat_attachments (workspace_id, created_at)`,
    );
    await ensureIndex(
      "chat_attachments_chat_idx",
      sql`CREATE INDEX IF NOT EXISTS chat_attachments_chat_idx ON chat_attachments (chat_id, created_at)`,
    );
    await ensureIndex(
      "chat_attachments_message_idx",
      sql`CREATE INDEX IF NOT EXISTS chat_attachments_message_idx ON chat_attachments (message_id)`,
    );

    chatAttachmentsTableEnsured = true;
  })();

  await ensuringChatAttachmentsTable;
  ensuringChatAttachmentsTable = null;
}

async function ensureSkillFilesTable(): Promise<void> {
  if (skillFilesTableEnsured) {
    return;
  }
  if (ensuringSkillFilesTable) {
    await ensuringSkillFilesTable;
    return;
  }

  ensuringSkillFilesTable = (async () => {
    await ensureWorkspacesTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "skill_files" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id" varchar NOT NULL,
        "skill_id" varchar NOT NULL,
        "storage_key" text NOT NULL,
        "original_name" text NOT NULL,
        "mime_type" text,
        "size_bytes" bigint,
        "version" integer NOT NULL DEFAULT 1,
        "status" text NOT NULL DEFAULT 'uploaded',
        "processing_status" text NOT NULL DEFAULT 'processing',
        "processing_error_message" text,
        "error_message" text,
        "created_by_user_id" varchar,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      ALTER TABLE "skill_files"
      ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1
    `);

    await ensureConstraint(
      "skill_files",
      "skill_files_workspace_id_fkey",
      sql`
        ALTER TABLE "skill_files"
        ADD CONSTRAINT "skill_files_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "skill_files",
      "skill_files_skill_id_fkey",
      sql`
        ALTER TABLE "skill_files"
        ADD CONSTRAINT "skill_files_skill_id_fkey"
        FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "skill_files",
      "skill_files_created_by_user_id_fkey",
      sql`
        ALTER TABLE "skill_files"
        ADD CONSTRAINT "skill_files_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
      `,
    );

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS skill_files_workspace_idx ON "skill_files" ("workspace_id", "created_at")
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS skill_files_skill_idx ON "skill_files" ("skill_id", "created_at")
    `);

    await db.execute(sql`
      ALTER TABLE "skill_files"
      ADD COLUMN IF NOT EXISTS "processing_status" text NOT NULL DEFAULT 'processing'
    `);
    await db.execute(sql`
      ALTER TABLE "skill_files"
      ADD COLUMN IF NOT EXISTS "processing_error_message" text
    `);

    skillFilesTableEnsured = true;
  })();

  await ensuringSkillFilesTable;
  ensuringSkillFilesTable = null;
}

async function ensureSkillFileIngestionJobsTable(): Promise<void> {
  if (skillFileIngestionJobsTableEnsured) {
    return;
  }
  if (ensuringSkillFileIngestionJobsTable) {
    await ensuringSkillFileIngestionJobsTable;
    return;
  }

  ensuringSkillFileIngestionJobsTable = (async () => {
    await ensureSkillFilesTable();
    await ensureWorkspacesTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "skill_file_ingestion_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "job_type" text NOT NULL DEFAULT 'skill_file_ingestion',
        "workspace_id" varchar NOT NULL,
        "skill_id" varchar NOT NULL,
        "file_id" uuid NOT NULL,
        "file_version" integer NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_retry_at" timestamp,
        "last_error" text,
        "chunk_count" integer,
        "total_chars" integer,
        "total_tokens" integer,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "skill_file_ingestion_jobs",
      "skill_file_ingestion_jobs_workspace_id_fkey",
      sql`
        ALTER TABLE "skill_file_ingestion_jobs"
        ADD CONSTRAINT "skill_file_ingestion_jobs_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "skill_file_ingestion_jobs",
      "skill_file_ingestion_jobs_skill_id_fkey",
      sql`
        ALTER TABLE "skill_file_ingestion_jobs"
        ADD CONSTRAINT "skill_file_ingestion_jobs_skill_id_fkey"
        FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "skill_file_ingestion_jobs",
      "skill_file_ingestion_jobs_file_id_fkey",
      sql`
        ALTER TABLE "skill_file_ingestion_jobs"
        ADD CONSTRAINT "skill_file_ingestion_jobs_file_id_fkey"
        FOREIGN KEY ("file_id") REFERENCES "skill_files"("id") ON DELETE CASCADE
      `,
    );

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS skill_file_ingestion_jobs_unique_job_idx
      ON "skill_file_ingestion_jobs" ("job_type", "file_id", "file_version")
    `);

    await ensureIndex(
      "skill_file_ingestion_jobs_workspace_idx",
      sql`CREATE INDEX IF NOT EXISTS skill_file_ingestion_jobs_workspace_idx ON "skill_file_ingestion_jobs" ("workspace_id", "status", "next_retry_at")`,
    );
    await ensureIndex(
      "skill_file_ingestion_jobs_skill_idx",
      sql`CREATE INDEX IF NOT EXISTS skill_file_ingestion_jobs_skill_idx ON "skill_file_ingestion_jobs" ("skill_id", "status", "next_retry_at")`,
    );

    await db.execute(sql`
      ALTER TABLE "skill_file_ingestion_jobs" ADD COLUMN IF NOT EXISTS "chunk_count" integer
    `);
    await db.execute(sql`
      ALTER TABLE "skill_file_ingestion_jobs" ADD COLUMN IF NOT EXISTS "total_chars" integer
    `);
    await db.execute(sql`
      ALTER TABLE "skill_file_ingestion_jobs" ADD COLUMN IF NOT EXISTS "total_tokens" integer
    `);

    skillFileIngestionJobsTableEnsured = true;
  })();

  await ensuringSkillFileIngestionJobsTable;
  ensuringSkillFileIngestionJobsTable = null;
}

let knowledgeBaseIndexingJobsTableEnsured = false;
let ensuringKnowledgeBaseIndexingJobsTable: Promise<void> | null = null;

async function ensureKnowledgeBaseIndexingJobsTable(): Promise<void> {
  if (knowledgeBaseIndexingJobsTableEnsured) {
    return;
  }
  if (ensuringKnowledgeBaseIndexingJobsTable) {
    await ensuringKnowledgeBaseIndexingJobsTable;
    return;
  }

  ensuringKnowledgeBaseIndexingJobsTable = (async () => {
    await ensureKnowledgeBaseTables();
    await ensureWorkspacesTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_base_indexing_jobs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "job_type" text NOT NULL DEFAULT 'knowledge_base_indexing',
        "workspace_id" varchar NOT NULL,
        "base_id" varchar NOT NULL,
        "document_id" varchar NOT NULL,
        "version_id" varchar NOT NULL,
        "status" text NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_retry_at" timestamp,
        "last_error" text,
        "chunk_count" integer,
        "total_chars" integer,
        "total_tokens" integer,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "knowledge_base_indexing_jobs",
      "knowledge_base_indexing_jobs_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_base_indexing_jobs"
        ADD CONSTRAINT "knowledge_base_indexing_jobs_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_base_indexing_jobs",
      "knowledge_base_indexing_jobs_base_id_fkey",
      sql`
        ALTER TABLE "knowledge_base_indexing_jobs"
        ADD CONSTRAINT "knowledge_base_indexing_jobs_base_id_fkey"
        FOREIGN KEY ("base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_base_indexing_jobs",
      "knowledge_base_indexing_jobs_document_id_fkey",
      sql`
        ALTER TABLE "knowledge_base_indexing_jobs"
        ADD CONSTRAINT "knowledge_base_indexing_jobs_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_base_indexing_jobs",
      "knowledge_base_indexing_jobs_version_id_fkey",
      sql`
        ALTER TABLE "knowledge_base_indexing_jobs"
        ADD CONSTRAINT "knowledge_base_indexing_jobs_version_id_fkey"
        FOREIGN KEY ("version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE
      `,
    );

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS knowledge_base_indexing_jobs_unique_job_idx
      ON "knowledge_base_indexing_jobs" ("job_type", "document_id", "version_id")
    `);

    await ensureIndex(
      "knowledge_base_indexing_jobs_workspace_idx",
      sql`CREATE INDEX IF NOT EXISTS knowledge_base_indexing_jobs_workspace_idx ON "knowledge_base_indexing_jobs" ("workspace_id", "status", "next_retry_at")`,
    );
    await ensureIndex(
      "knowledge_base_indexing_jobs_base_idx",
      sql`CREATE INDEX IF NOT EXISTS knowledge_base_indexing_jobs_base_idx ON "knowledge_base_indexing_jobs" ("base_id", "status", "next_retry_at")`,
    );

    knowledgeBaseIndexingJobsTableEnsured = true;
  })();

  await ensuringKnowledgeBaseIndexingJobsTable;
  ensuringKnowledgeBaseIndexingJobsTable = null;
}

let knowledgeBaseIndexingPolicyTableEnsured = false;
let ensuringKnowledgeBaseIndexingPolicyTable: Promise<void> | null = null;

async function ensureKnowledgeBaseIndexingPolicyTable(): Promise<void> {
  if (knowledgeBaseIndexingPolicyTableEnsured) {
    return;
  }
  if (ensuringKnowledgeBaseIndexingPolicyTable) {
    await ensuringKnowledgeBaseIndexingPolicyTable;
    return;
  }

  ensuringKnowledgeBaseIndexingPolicyTable = (async () => {
    await ensureUsersTable();

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "knowledge_base_indexing_policy" (
          "id" varchar PRIMARY KEY DEFAULT 'kb_indexing_policy_singleton',
          "embeddings_provider" varchar(255) NOT NULL,
          "embeddings_model" varchar(255) NOT NULL,
          "chunk_size" integer NOT NULL,
          "chunk_overlap" integer NOT NULL,
          "default_schema" jsonb NOT NULL DEFAULT '[]'::jsonb,
          "policy_hash" text,
          "updated_by_admin_id" varchar,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await db.execute(sql`
        ALTER TABLE "knowledge_base_indexing_policy"
        ADD COLUMN IF NOT EXISTS "policy_hash" text
      `);

    await ensureConstraint(
      "knowledge_base_indexing_policy",
      "knowledge_base_indexing_policy_updated_by_admin_id_fkey",
      sql`
        ALTER TABLE "knowledge_base_indexing_policy"
        ADD CONSTRAINT "knowledge_base_indexing_policy_updated_by_admin_id_fkey"
        FOREIGN KEY ("updated_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL
      `,
    );

    knowledgeBaseIndexingPolicyTableEnsured = true;
  })();

    await ensuringKnowledgeBaseIndexingPolicyTable;
    ensuringKnowledgeBaseIndexingPolicyTable = null;
  }

  let knowledgeDocumentIndexStateTableEnsured = false;
  let ensuringKnowledgeDocumentIndexStateTable: Promise<void> | null = null;

  let knowledgeDocumentIndexRevisionsTableEnsured = false;
  let ensuringKnowledgeDocumentIndexRevisionsTable: Promise<void> | null = null;

  async function ensureKnowledgeDocumentIndexRevisionsTable(): Promise<void> {
    if (knowledgeDocumentIndexRevisionsTableEnsured) {
      return;
    }
    if (ensuringKnowledgeDocumentIndexRevisionsTable) {
      await ensuringKnowledgeDocumentIndexRevisionsTable;
      return;
    }

    ensuringKnowledgeDocumentIndexRevisionsTable = (async () => {
      await ensureKnowledgeBaseTables();
      await ensureWorkspacesTable();

      const uuidExpression = await getUuidGenerationExpression();

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "knowledge_document_index_revisions" (
          "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
          "workspace_id" varchar NOT NULL,
          "base_id" varchar NOT NULL,
          "document_id" varchar NOT NULL,
          "version_id" varchar,
          "chunk_set_id" varchar,
          "policy_hash" text,
          "status" text NOT NULL DEFAULT 'processing',
          "error" text,
          "started_at" timestamp,
          "finished_at" timestamp,
          "chunk_count" integer NOT NULL DEFAULT 0,
          "total_tokens" integer NOT NULL DEFAULT 0,
          "total_chars" integer NOT NULL DEFAULT 0,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await ensureConstraint(
        "knowledge_document_index_revisions",
        "knowledge_document_index_revisions_workspace_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_revisions"
          ADD CONSTRAINT "knowledge_document_index_revisions_workspace_id_fkey"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
        `,
      );

      await ensureConstraint(
        "knowledge_document_index_revisions",
        "knowledge_document_index_revisions_base_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_revisions"
          ADD CONSTRAINT "knowledge_document_index_revisions_base_id_fkey"
          FOREIGN KEY ("base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE
        `,
      );

      await ensureConstraint(
        "knowledge_document_index_revisions",
        "knowledge_document_index_revisions_document_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_revisions"
          ADD CONSTRAINT "knowledge_document_index_revisions_document_id_fkey"
          FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
        `,
      );

      await ensureConstraint(
        "knowledge_document_index_revisions",
        "knowledge_document_index_revisions_version_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_revisions"
          ADD CONSTRAINT "knowledge_document_index_revisions_version_id_fkey"
          FOREIGN KEY ("version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE SET NULL
        `,
      );

      await ensureConstraint(
        "knowledge_document_index_revisions",
        "knowledge_document_index_revisions_chunk_set_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_revisions"
          ADD CONSTRAINT "knowledge_document_index_revisions_chunk_set_id_fkey"
          FOREIGN KEY ("chunk_set_id") REFERENCES "knowledge_document_chunk_sets"("id") ON DELETE SET NULL
        `,
      );

      await ensureIndex(
        "knowledge_document_index_revisions_document_idx",
        sql`CREATE INDEX IF NOT EXISTS knowledge_document_index_revisions_document_idx ON "knowledge_document_index_revisions" ("document_id", "created_at" DESC)`,
      );
      await ensureIndex(
        "knowledge_document_index_revisions_workspace_base_status_idx",
        sql`CREATE INDEX IF NOT EXISTS knowledge_document_index_revisions_workspace_base_status_idx ON "knowledge_document_index_revisions" ("workspace_id", "base_id", "status")`,
      );

      knowledgeDocumentIndexRevisionsTableEnsured = true;
    })();

    await ensuringKnowledgeDocumentIndexRevisionsTable;
    ensuringKnowledgeDocumentIndexRevisionsTable = null;
  }

  async function ensureKnowledgeDocumentIndexStateTable(): Promise<void> {
    if (knowledgeDocumentIndexStateTableEnsured) {
      return;
    }
    if (ensuringKnowledgeDocumentIndexStateTable) {
      await ensuringKnowledgeDocumentIndexStateTable;
      return;
    }

    ensuringKnowledgeDocumentIndexStateTable = (async () => {
      await ensureKnowledgeBaseTables();
      await ensureWorkspacesTable();

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "knowledge_document_index_state" (
          "workspace_id" varchar NOT NULL,
          "base_id" varchar NOT NULL,
          "document_id" varchar NOT NULL,
          "indexed_version_id" varchar,
          "chunk_set_id" varchar,
          "policy_hash" text,
          "status" text NOT NULL DEFAULT 'not_indexed',
          "error" text,
          "indexed_at" timestamp,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("workspace_id", "base_id", "document_id")
        )
      `);

      await ensureConstraint(
        "knowledge_document_index_state",
        "knowledge_document_index_state_workspace_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_state"
          ADD CONSTRAINT "knowledge_document_index_state_workspace_id_fkey"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
        `,
      );

      await ensureConstraint(
        "knowledge_document_index_state",
        "knowledge_document_index_state_base_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_state"
          ADD CONSTRAINT "knowledge_document_index_state_base_id_fkey"
          FOREIGN KEY ("base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE
        `,
      );

      await ensureConstraint(
        "knowledge_document_index_state",
        "knowledge_document_index_state_document_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_state"
          ADD CONSTRAINT "knowledge_document_index_state_document_id_fkey"
          FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
        `,
      );

      await ensureConstraint(
        "knowledge_document_index_state",
        "knowledge_document_index_state_indexed_version_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_state"
          ADD CONSTRAINT "knowledge_document_index_state_indexed_version_id_fkey"
          FOREIGN KEY ("indexed_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE SET NULL
        `,
      );

      await ensureConstraint(
        "knowledge_document_index_state",
        "knowledge_document_index_state_chunk_set_id_fkey",
        sql`
          ALTER TABLE "knowledge_document_index_state"
          ADD CONSTRAINT "knowledge_document_index_state_chunk_set_id_fkey"
          FOREIGN KEY ("chunk_set_id") REFERENCES "knowledge_document_chunk_sets"("id") ON DELETE SET NULL
        `,
      );

      await ensureIndex(
        "knowledge_document_index_state_base_status_idx",
        sql`CREATE INDEX IF NOT EXISTS knowledge_document_index_state_base_status_idx ON "knowledge_document_index_state" ("base_id", "status")`,
      );
      await ensureIndex(
        "knowledge_document_index_state_workspace_base_idx",
        sql`CREATE INDEX IF NOT EXISTS knowledge_document_index_state_workspace_base_idx ON "knowledge_document_index_state" ("workspace_id", "base_id")`,
      );
      await ensureIndex(
        "knowledge_document_index_state_document_idx",
        sql`CREATE INDEX IF NOT EXISTS knowledge_document_index_state_document_idx ON "knowledge_document_index_state" ("document_id")`,
      );

      knowledgeDocumentIndexStateTableEnsured = true;
    })();

    await ensuringKnowledgeDocumentIndexStateTable;
    ensuringKnowledgeDocumentIndexStateTable = null;
  }

  let knowledgeBaseIndexStateTableEnsured = false;
  let ensuringKnowledgeBaseIndexStateTable: Promise<void> | null = null;

  async function ensureKnowledgeBaseIndexStateTable(): Promise<void> {
    if (knowledgeBaseIndexStateTableEnsured) {
      return;
    }
    if (ensuringKnowledgeBaseIndexStateTable) {
      await ensuringKnowledgeBaseIndexStateTable;
      return;
    }

    ensuringKnowledgeBaseIndexStateTable = (async () => {
      await ensureKnowledgeBaseTables();
      await ensureWorkspacesTable();

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "knowledge_base_index_state" (
          "workspace_id" varchar NOT NULL,
          "base_id" varchar NOT NULL,
          "status" text NOT NULL DEFAULT 'not_indexed',
          "total_documents" integer NOT NULL DEFAULT 0,
          "outdated_documents" integer NOT NULL DEFAULT 0,
          "indexing_documents" integer NOT NULL DEFAULT 0,
          "error_documents" integer NOT NULL DEFAULT 0,
          "up_to_date_documents" integer NOT NULL DEFAULT 0,
          "policy_hash" text,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("workspace_id", "base_id")
        )
      `);

      await ensureConstraint(
        "knowledge_base_index_state",
        "knowledge_base_index_state_workspace_id_fkey",
        sql`
          ALTER TABLE "knowledge_base_index_state"
          ADD CONSTRAINT "knowledge_base_index_state_workspace_id_fkey"
          FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
        `,
      );

      await ensureConstraint(
        "knowledge_base_index_state",
        "knowledge_base_index_state_base_id_fkey",
        sql`
          ALTER TABLE "knowledge_base_index_state"
          ADD CONSTRAINT "knowledge_base_index_state_base_id_fkey"
          FOREIGN KEY ("base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE
        `,
      );

      await ensureIndex(
        "knowledge_base_index_state_status_idx",
        sql`CREATE INDEX IF NOT EXISTS knowledge_base_index_state_status_idx ON "knowledge_base_index_state" ("workspace_id", "status")`,
      );

      knowledgeBaseIndexStateTableEnsured = true;
    })();

    await ensuringKnowledgeBaseIndexStateTable;
    ensuringKnowledgeBaseIndexStateTable = null;
  }

  let knowledgeBaseIndexingActionsTableEnsured = false;
let ensuringKnowledgeBaseIndexingActionsTable: Promise<void> | null = null;

async function ensureKnowledgeBaseIndexingActionsTable(): Promise<void> {
  if (knowledgeBaseIndexingActionsTableEnsured) {
    return;
  }
  if (ensuringKnowledgeBaseIndexingActionsTable) {
    await ensuringKnowledgeBaseIndexingActionsTable;
    return;
  }

  ensuringKnowledgeBaseIndexingActionsTable = (async () => {
    await ensureKnowledgeBaseTables();
    await ensureWorkspacesTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_base_indexing_actions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id" varchar NOT NULL,
        "base_id" varchar NOT NULL,
        "action_id" text NOT NULL,
        "status" text NOT NULL DEFAULT 'processing',
        "stage" text NOT NULL,
        "display_text" text,
        "payload" jsonb DEFAULT '{}'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "knowledge_base_indexing_actions",
      "knowledge_base_indexing_actions_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_base_indexing_actions"
        ADD CONSTRAINT "knowledge_base_indexing_actions_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_base_indexing_actions",
      "knowledge_base_indexing_actions_base_id_fkey",
      sql`
        ALTER TABLE "knowledge_base_indexing_actions"
        ADD CONSTRAINT "knowledge_base_indexing_actions_base_id_fkey"
        FOREIGN KEY ("base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE
      `,
    );

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS knowledge_base_indexing_actions_unique_idx
      ON "knowledge_base_indexing_actions" ("workspace_id", "base_id", "action_id")
    `);

    await ensureIndex(
      "knowledge_base_indexing_actions_base_idx",
      sql`CREATE INDEX IF NOT EXISTS knowledge_base_indexing_actions_base_idx ON "knowledge_base_indexing_actions" ("workspace_id", "base_id", "updated_at")`,
    );
    await ensureIndex(
      "knowledge_base_indexing_actions_status_idx",
      sql`CREATE INDEX IF NOT EXISTS knowledge_base_indexing_actions_status_idx ON "knowledge_base_indexing_actions" ("workspace_id", "base_id", "status")`,
    );

    knowledgeBaseIndexingActionsTableEnsured = true;
  })();

  await ensuringKnowledgeBaseIndexingActionsTable;
  ensuringKnowledgeBaseIndexingActionsTable = null;
}

async function ensureTranscriptsTable(): Promise<void> {
  if (transcriptsTableEnsured) {
    return;
  }

  if (ensuringTranscriptsTable) {
    await ensuringTranscriptsTable;
    return;
  }

  ensuringTranscriptsTable = (async () => {
    await ensureChatSessionsTable();
    await ensureWorkspacesTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "transcripts" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "workspace_id" varchar NOT NULL,
        "chat_id" varchar NOT NULL,
        "source_file_id" varchar,
        "status" text NOT NULL DEFAULT 'processing',
        "title" text,
        "preview_text" text,
        "full_text" text,
        "last_edited_by_user_id" varchar,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "transcripts",
      "transcripts_workspace_id_fkey",
      sql`
        ALTER TABLE "transcripts"
        ADD CONSTRAINT "transcripts_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "transcripts",
      "transcripts_chat_id_fkey",
      sql`
        ALTER TABLE "transcripts"
        ADD CONSTRAINT "transcripts_chat_id_fkey"
        FOREIGN KEY ("chat_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE
      `,
    );

    await db.execute(sql`CREATE INDEX IF NOT EXISTS "transcripts_workspace_idx" ON "transcripts" ("workspace_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "transcripts_chat_idx" ON "transcripts" ("chat_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "transcripts_status_idx" ON "transcripts" ("status")`);
    await db.execute(
      sql`ALTER TABLE "transcripts" ADD COLUMN IF NOT EXISTS "last_edited_by_user_id" varchar`,
    );
    await db.execute(
      sql`ALTER TABLE "transcripts" ADD COLUMN IF NOT EXISTS "default_view_id" varchar`,
    );
    await db.execute(
      sql`ALTER TABLE "transcripts" ADD COLUMN IF NOT EXISTS "default_view_action_id" varchar`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "transcripts_default_view_idx" ON "transcripts" ("default_view_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "transcripts_default_view_action_idx" ON "transcripts" ("default_view_action_id")`,
    );

    transcriptsTableEnsured = true;
  })();

  await ensuringTranscriptsTable;
  ensuringTranscriptsTable = null;
}

let transcriptViewsEnsured = false;
let ensuringTranscriptViewsTable: Promise<void> | null = null;

let botActionsEnsured = false;
let ensuringBotActionsTable: Promise<void> | null = null;

let canvasDocumentsEnsured = false;
let ensuringCanvasDocumentsTable: Promise<void> | null = null;

async function ensureTranscriptViewsTable(): Promise<void> {
  if (transcriptViewsEnsured) {
    return;
  }
  if (ensuringTranscriptViewsTable) {
    await ensuringTranscriptViewsTable;
    return;
  }

  ensuringTranscriptViewsTable = (async () => {
    const uuidExpression = await getUuidGenerationExpression();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "transcript_views" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "transcript_id" varchar NOT NULL REFERENCES "transcripts"("id") ON DELETE CASCADE,
        "action_id" varchar,
        "label" text NOT NULL,
        "content" text NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "transcript_views_transcript_idx" ON "transcript_views" ("transcript_id")`,
    );

    transcriptViewsEnsured = true;
  })();

  await ensuringTranscriptViewsTable;
  ensuringTranscriptViewsTable = null;
}

async function ensureBotActionsTable(): Promise<void> {
  if (botActionsEnsured) {
    return;
  }
  if (ensuringBotActionsTable) {
    await ensuringBotActionsTable;
    return;
  }

  ensuringBotActionsTable = (async () => {
    await ensureWorkspacesTable();
    await ensureChatSessionsTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "bot_actions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id" varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        "chat_id" varchar NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        "action_id" text NOT NULL,
        "action_type" text NOT NULL,
        "status" text NOT NULL DEFAULT 'processing',
        "display_text" text,
        "payload" jsonb DEFAULT '{}'::jsonb,
        "started_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(
      sql`
        CREATE UNIQUE INDEX IF NOT EXISTS "bot_actions_action_unique_idx"
        ON "bot_actions" ("workspace_id", "chat_id", "action_id")
      `,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "bot_actions_chat_idx" ON "bot_actions" ("workspace_id", "chat_id", "updated_at")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS "bot_actions_status_idx" ON "bot_actions" ("workspace_id", "chat_id", "status")`,
    );

    botActionsEnsured = true;
  })();

  await ensuringBotActionsTable;
  ensuringBotActionsTable = null;
}

function mapBotAction(record: any): BotAction {
  return {
    workspaceId: record.workspaceId ?? record.workspace_id,
    chatId: record.chatId ?? record.chat_id,
    actionId: record.actionId ?? record.action_id,
    actionType: record.actionType ?? record.action_type,
    status: (record.status ?? "processing") as BotActionStatus,
    displayText: record.displayText ?? record.display_text ?? null,
    payload: record.payload ?? null,
    createdAt: record.startedAt
      ? new Date(record.startedAt).toISOString()
      : record.started_at
        ? new Date(record.started_at).toISOString()
        : null,
    updatedAt: record.updatedAt
      ? new Date(record.updatedAt).toISOString()
      : record.updated_at
        ? new Date(record.updated_at).toISOString()
        : null,
  };
}

async function ensureCanvasDocumentsTable(): Promise<void> {
  if (canvasDocumentsEnsured) {
    return;
  }
  if (ensuringCanvasDocumentsTable) {
    await ensuringCanvasDocumentsTable;
    return;
  }

  ensuringCanvasDocumentsTable = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "canvas_documents" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id" varchar NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        "chat_id" varchar NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        "transcript_id" varchar REFERENCES transcripts(id) ON DELETE CASCADE,
        "skill_id" varchar REFERENCES skills(id) ON DELETE SET NULL,
        "action_id" varchar REFERENCES actions(id) ON DELETE SET NULL,
        "type" text NOT NULL DEFAULT 'derived',
        "title" text NOT NULL,
        "content" text NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_by_user_id" varchar REFERENCES users(id) ON DELETE SET NULL,
        "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
        "deleted_at" timestamp
      );
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "canvas_documents_workspace_idx" ON "canvas_documents" ("workspace_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "canvas_documents_chat_idx" ON "canvas_documents" ("chat_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "canvas_documents_transcript_idx" ON "canvas_documents" ("transcript_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "canvas_documents_skill_idx" ON "canvas_documents" ("skill_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "canvas_documents_action_idx" ON "canvas_documents" ("action_id")`);
    canvasDocumentsEnsured = true;
  })();

  await ensuringCanvasDocumentsTable;
  ensuringCanvasDocumentsTable = null;
}

async function ensureChatTables(): Promise<void> {
  await ensureChatSessionsTable();
  await ensureChatMessagesTable();
  await ensureChatAttachmentsTable();
  await ensureTranscriptsTable();
  await ensureTranscriptViewsTable();
  await ensureBotActionsTable();
}

export async function ensureKnowledgeBaseTables(): Promise<void> {
  if (knowledgeBaseTablesEnsured) {
    return;
  }

  if (ensuringKnowledgeBaseTables) {
    await ensuringKnowledgeBaseTables;
    return;
  }

  ensuringKnowledgeBaseTables = (async () => {
    await ensureWorkspacesTable();

    const uuidExpression = await getUuidGenerationExpression();

    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS ltree`);
    } catch (error) {
      swallowPgError(error, ["42710", "42501"]);
    }

    knowledgeBasePathUsesLtree = await detectLtreeSupport();

    if (!knowledgeBasePathUsesLtree) {
      console.warn(
        "[storage] Расширение ltree недоступно. Используем текстовые пути для базы знаний",
      );
    }

    const pathColumnType = knowledgeBasePathUsesLtree ? sql.raw("ltree") : sql.raw("text");

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_bases" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL,
        "name" text NOT NULL DEFAULT 'База знаний',
        "description" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      ALTER TABLE "knowledge_bases"
      ADD COLUMN IF NOT EXISTS "workspace_id" varchar
    `);

    await db.execute(sql`
      UPDATE "knowledge_bases"
      SET "workspace_id" = NULLIF("workspace_id", '')
      WHERE "workspace_id" IS NOT NULL AND btrim("workspace_id") = ''
    `);

    await db.execute(sql`
      UPDATE "knowledge_bases" AS kb
      SET "workspace_id" = inferred.workspace_id
      FROM (
        SELECT kn."base_id" AS base_id, MAX(kn."workspace_id") AS workspace_id
        FROM "knowledge_nodes" AS kn
        WHERE kn."workspace_id" IS NOT NULL AND btrim(kn."workspace_id") <> ''
        GROUP BY kn."base_id"
      ) AS inferred
      WHERE kb."id" = inferred.base_id
        AND (kb."workspace_id" IS NULL OR btrim(kb."workspace_id") = '')
    `);

    await db.execute(sql`
      UPDATE "knowledge_bases" AS kb
      SET "workspace_id" = inferred.workspace_id
      FROM (
        SELECT kd."base_id" AS base_id, MAX(kd."workspace_id") AS workspace_id
        FROM "knowledge_documents" AS kd
        WHERE kd."workspace_id" IS NOT NULL AND btrim(kd."workspace_id") <> ''
        GROUP BY kd."base_id"
      ) AS inferred
      WHERE kb."id" = inferred.base_id
        AND (kb."workspace_id" IS NULL OR btrim(kb."workspace_id") = '')
    `);

    await db.execute(sql`
      WITH fallback AS (
        SELECT "id"
        FROM "workspaces"
        ORDER BY "created_at"
        LIMIT 1
      )
      UPDATE "knowledge_bases" AS kb
      SET "workspace_id" = fallback."id"
      FROM fallback
      WHERE (kb."workspace_id" IS NULL OR btrim(kb."workspace_id") = '')
        AND fallback."id" IS NOT NULL
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "knowledge_bases"
        ALTER COLUMN "workspace_id" SET NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["42704", "23502"]);
    }

    await ensureConstraint(
      "knowledge_bases",
      "knowledge_bases_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_bases"
        ADD CONSTRAINT "knowledge_bases_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_bases_workspace_idx ON knowledge_bases("workspace_id")`,
    );

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_nodes" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "base_id" varchar NOT NULL,
        "workspace_id" varchar NOT NULL,
        "parent_id" varchar,
        "title" text NOT NULL DEFAULT 'Без названия',
        "type" text NOT NULL DEFAULT 'document',
        "content" text,
        "slug" text NOT NULL DEFAULT '',
        "path" ${pathColumnType},
        "position" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      ALTER TABLE "knowledge_nodes"
      ADD COLUMN IF NOT EXISTS "workspace_id" varchar
    `);

    await db.execute(sql`
      UPDATE "knowledge_nodes" AS kn
      SET "workspace_id" = kb."workspace_id"
      FROM "knowledge_bases" AS kb
      WHERE kn."base_id" = kb."id"
        AND (kn."workspace_id" IS NULL OR btrim(kn."workspace_id") = '')
    `);

    await normalizeKnowledgeBaseWorkspaces();

    try {
      await db.execute(sql`
        ALTER TABLE "knowledge_nodes"
        ALTER COLUMN "workspace_id" SET NOT NULL
      `);
    } catch (error) {
      if (isPgError(error) && error.code === "23502") {
        console.warn(
          "[storage] Обнаружены узлы базы знаний без workspace_id, выполняем очистку и повторяем установку NOT NULL",
        );
        await normalizeKnowledgeBaseWorkspaces();
        await db.execute(sql`
          ALTER TABLE "knowledge_nodes"
          ALTER COLUMN "workspace_id" SET NOT NULL
        `);
      } else {
        swallowPgError(error, ["42704"]);
      }
    }

    await db.execute(sql`
      ALTER TABLE "knowledge_nodes"
      ADD COLUMN IF NOT EXISTS "source_type" text DEFAULT 'manual'
    `);

    await db.execute(sql`
      ALTER TABLE "knowledge_nodes"
      ADD COLUMN IF NOT EXISTS "slug" text DEFAULT ''
    `);

    await db.execute(sql`
      UPDATE "knowledge_nodes"
      SET "slug" = "id"
      WHERE ("slug" IS NULL OR trim("slug") = '')
        AND "id" IS NOT NULL
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "knowledge_nodes"
        ALTER COLUMN "slug" SET NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["23502", "42704"]);
    }

    await db.execute(sql`
      ALTER TABLE "knowledge_nodes"
      ALTER COLUMN "slug" SET DEFAULT ''
    `);

    await db.execute(
      sql`
        ALTER TABLE "knowledge_nodes"
        ADD COLUMN IF NOT EXISTS "path" ${pathColumnType}
      `,
    );

    await db.execute(sql`
      UPDATE "knowledge_nodes"
      SET "source_type" = 'manual'
      WHERE "source_type" IS NULL OR TRIM("source_type") = ''
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "knowledge_nodes"
        ALTER COLUMN "source_type" SET NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["42704"]);
    }

    await db.execute(sql`
      ALTER TABLE "knowledge_nodes"
      ALTER COLUMN "source_type" SET DEFAULT 'manual'
    `);

    await db.execute(sql`
      ALTER TABLE "knowledge_nodes"
      ADD COLUMN IF NOT EXISTS "import_file_name" text
    `);

    if (knowledgeBasePathUsesLtree) {
      await db.execute(sql`
        WITH RECURSIVE normalized_nodes AS (
          SELECT
            kn."id",
            kn."parent_id",
            kn."base_id",
            CASE
              WHEN coalesce(nullif(kn."slug", ''), '') <> '' THEN kn."slug"
              ELSE replace(kn."id", '-', '_')
            END AS raw_segment
          FROM "knowledge_nodes" AS kn
        ),
        processed_nodes AS (
          SELECT
            cleaned."id",
            cleaned."parent_id",
            cleaned."base_id",
            CASE
              WHEN cleaned.segment_value = '' THEN CONCAT('node_', substring(replace(cleaned."id", '-', '_') FROM 1 FOR 24))
              WHEN cleaned.segment_value ~ '^[a-z]' THEN cleaned.segment_value
              ELSE CONCAT('n_', cleaned.segment_value)
            END AS segment
          FROM (
            SELECT
              nn."id",
              nn."parent_id",
              nn."base_id",
              regexp_replace(
                regexp_replace(lower(nn.raw_segment), '[^a-z0-9_]+', '_', 'g'),
                '^_+|_+$',
                '',
                'g'
              ) AS segment_value
            FROM normalized_nodes AS nn
          ) AS cleaned
        ),
        computed_paths AS (
          SELECT
            pn."id",
            pn."parent_id",
            pn."base_id",
            text2ltree(pn.segment) AS computed_path
          FROM processed_nodes AS pn
          WHERE pn."parent_id" IS NULL

          UNION ALL

          SELECT
            child."id",
            child."parent_id",
            child."base_id",
            parent.computed_path || text2ltree(child.segment) AS computed_path
          FROM processed_nodes AS child
          JOIN computed_paths AS parent ON child."parent_id" = parent."id"
        )
        UPDATE "knowledge_nodes" AS kn
        SET "path" = cp.computed_path
        FROM computed_paths AS cp
        WHERE kn."id" = cp."id"
          AND (kn."path" IS NULL OR nlevel(kn."path") = 0)
      `);

      await db.execute(sql`
        UPDATE "knowledge_nodes"
        SET "path" = text2ltree(
            CASE
              WHEN coalesce(nullif("slug", ''), '') <> '' THEN
                CASE
                  WHEN regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g') ~ '^[a-z]' 
                    THEN regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g')
                  ELSE 'n_' || regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g')
                END
              ELSE 'node_' || substring(replace("id", '-', '_') FROM 1 FOR 24)
            END
          )
        WHERE "path" IS NULL
      `);
    } else {
      await db.execute(sql`
        WITH RECURSIVE normalized_nodes AS (
          SELECT
            kn."id",
            kn."parent_id",
            kn."base_id",
            CASE
              WHEN coalesce(nullif(kn."slug", ''), '') <> '' THEN kn."slug"
              ELSE replace(kn."id", '-', '_')
            END AS raw_segment
          FROM "knowledge_nodes" AS kn
        ),
        processed_nodes AS (
          SELECT
            cleaned."id",
            cleaned."parent_id",
            cleaned."base_id",
            CASE
              WHEN cleaned.segment_value = '' THEN CONCAT('node_', substring(replace(cleaned."id", '-', '_') FROM 1 FOR 24))
              WHEN cleaned.segment_value ~ '^[a-z]' THEN cleaned.segment_value
              ELSE CONCAT('n_', cleaned.segment_value)
            END AS segment
          FROM (
            SELECT
              nn."id",
              nn."parent_id",
              nn."base_id",
              regexp_replace(
                regexp_replace(lower(nn.raw_segment), '[^a-z0-9_]+', '_', 'g'),
                '^_+|_+$',
                '',
                'g'
              ) AS segment_value
            FROM normalized_nodes AS nn
          ) AS cleaned
        ),
        computed_paths AS (
          SELECT
            pn."id",
            pn."parent_id",
            pn."base_id",
            pn.segment AS computed_path
          FROM processed_nodes AS pn
          WHERE pn."parent_id" IS NULL

          UNION ALL

          SELECT
            child."id",
            child."parent_id",
            child."base_id",
            parent.computed_path || '.' || child.segment AS computed_path
          FROM processed_nodes AS child
          JOIN computed_paths AS parent ON child."parent_id" = parent."id"
        )
        UPDATE "knowledge_nodes" AS kn
        SET "path" = cp.computed_path
        FROM computed_paths AS cp
        WHERE kn."id" = cp."id"
          AND (kn."path" IS NULL OR btrim(kn."path") = '')
      `);

      await db.execute(sql`
        UPDATE "knowledge_nodes"
        SET "path" = CASE
            WHEN coalesce(nullif("slug", ''), '') <> '' THEN
              CASE
                WHEN regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g') ~ '^[a-z]' 
                  THEN regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g')
                ELSE 'n_' || regexp_replace(lower("slug"), '[^a-z0-9_]+', '_', 'g')
              END
            ELSE 'node_' || substring(replace("id", '-', '_') FROM 1 FOR 24)
          END
        WHERE "path" IS NULL OR btrim("path") = ''
      `);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "knowledge_nodes"
        ALTER COLUMN "path" SET NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["42704", "23502"]);
    }

    await ensureConstraint(
      "knowledge_nodes",
      "knowledge_nodes_base_id_fkey",
      sql`
        ALTER TABLE "knowledge_nodes"
        ADD CONSTRAINT "knowledge_nodes_base_id_fkey"
        FOREIGN KEY ("base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_nodes",
      "knowledge_nodes_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_nodes"
        ADD CONSTRAINT "knowledge_nodes_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_nodes",
      "knowledge_nodes_parent_id_fkey",
      sql`
        ALTER TABLE "knowledge_nodes"
        ADD CONSTRAINT "knowledge_nodes_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_nodes",
      "knowledge_nodes_type_check",
      sql`
        ALTER TABLE "knowledge_nodes"
        ADD CONSTRAINT "knowledge_nodes_type_check"
        CHECK ("type" IN ('folder', 'document'))
      `,
    );

    await ensureConstraint(
      "knowledge_nodes",
      "knowledge_nodes_slug_not_empty",
      sql`
        ALTER TABLE "knowledge_nodes"
        ADD CONSTRAINT "knowledge_nodes_slug_not_empty"
        CHECK (trim("slug") <> '')
      `,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_nodes_base_parent_idx ON knowledge_nodes("base_id", "parent_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_nodes_parent_idx ON knowledge_nodes("parent_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_nodes_workspace_idx ON knowledge_nodes("workspace_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_nodes_workspace_parent_idx ON knowledge_nodes("workspace_id", "parent_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_nodes_base_parent_position_idx ON knowledge_nodes("base_id", "parent_id", "position")`,
    );
    if (knowledgeBasePathUsesLtree) {
      try {
        await db.execute(
          sql`CREATE INDEX IF NOT EXISTS knowledge_nodes_path_gist ON knowledge_nodes USING GIST("path")`,
        );
      } catch (error) {
        swallowPgError(error, ["42704", "42P07"]);
      }
    } else {
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS knowledge_nodes_path_idx ON knowledge_nodes("path")`,
      );
    }

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_documents" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "base_id" varchar NOT NULL,
        "workspace_id" varchar NOT NULL,
        "node_id" varchar NOT NULL,
        "status" text NOT NULL DEFAULT 'draft',
        "current_version_id" varchar,
        "current_revision_id" varchar,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      ALTER TABLE "knowledge_documents"
      ADD COLUMN IF NOT EXISTS "current_revision_id" varchar
    `);

    await ensureConstraint(
      "knowledge_documents",
      "knowledge_documents_base_id_fkey",
      sql`
        ALTER TABLE "knowledge_documents"
        ADD CONSTRAINT "knowledge_documents_base_id_fkey"
        FOREIGN KEY ("base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_documents",
      "knowledge_documents_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_documents"
        ADD CONSTRAINT "knowledge_documents_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_documents",
      "knowledge_documents_node_id_fkey",
      sql`
        ALTER TABLE "knowledge_documents"
        ADD CONSTRAINT "knowledge_documents_node_id_fkey"
        FOREIGN KEY ("node_id") REFERENCES "knowledge_nodes"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_documents",
      "knowledge_documents_status_check",
      sql`
        ALTER TABLE "knowledge_documents"
        ADD CONSTRAINT "knowledge_documents_status_check"
        CHECK ("status" IN ('draft', 'published', 'archived'))
      `,
    );

    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_documents_node_id_key ON knowledge_documents("node_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_documents_workspace_idx ON knowledge_documents("workspace_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_documents_base_idx ON knowledge_documents("base_id")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_documents_current_revision_idx ON knowledge_documents("current_revision_id")`,
    );

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_document_versions" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "document_id" varchar NOT NULL,
        "workspace_id" varchar NOT NULL,
        "version_no" integer NOT NULL,
        "author_id" varchar,
        "content_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "content_text" text NOT NULL DEFAULT '',
        "hash" text,
        "word_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "knowledge_document_versions",
      "knowledge_document_versions_document_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_versions"
        ADD CONSTRAINT "knowledge_document_versions_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_versions",
      "knowledge_document_versions_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_versions"
        ADD CONSTRAINT "knowledge_document_versions_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_versions",
      "knowledge_document_versions_author_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_versions"
        ADD CONSTRAINT "knowledge_document_versions_author_id_fkey"
        FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL
      `,
    );

    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_versions_document_version_idx ON knowledge_document_versions("document_id", "version_no")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_versions_document_created_idx ON knowledge_document_versions("document_id", "created_at" DESC)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_versions_workspace_idx ON knowledge_document_versions("workspace_id")`,
    );

    await ensureConstraint(
      "knowledge_documents",
      "knowledge_documents_current_version_fkey",
      sql`
        ALTER TABLE "knowledge_documents"
        ADD CONSTRAINT "knowledge_documents_current_version_fkey"
        FOREIGN KEY ("current_version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE SET NULL
      `,
    );

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_document_index_revisions" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL,
        "base_id" varchar NOT NULL,
        "document_id" varchar NOT NULL,
        "version_id" varchar,
        "chunk_set_id" varchar,
        "policy_hash" text,
        "status" text NOT NULL DEFAULT 'processing',
        "error" text,
        "started_at" timestamp,
        "finished_at" timestamp,
        "chunk_count" integer NOT NULL DEFAULT 0,
        "total_tokens" integer NOT NULL DEFAULT 0,
        "total_chars" integer NOT NULL DEFAULT 0,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "knowledge_document_index_revisions",
      "knowledge_document_index_revisions_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_index_revisions"
        ADD CONSTRAINT "knowledge_document_index_revisions_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_index_revisions",
      "knowledge_document_index_revisions_base_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_index_revisions"
        ADD CONSTRAINT "knowledge_document_index_revisions_base_id_fkey"
        FOREIGN KEY ("base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_index_revisions",
      "knowledge_document_index_revisions_document_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_index_revisions"
        ADD CONSTRAINT "knowledge_document_index_revisions_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_index_revisions",
      "knowledge_document_index_revisions_version_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_index_revisions"
        ADD CONSTRAINT "knowledge_document_index_revisions_version_id_fkey"
        FOREIGN KEY ("version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE SET NULL
      `,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_index_revisions_document_idx ON knowledge_document_index_revisions("document_id", "created_at" DESC)`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_index_revisions_workspace_base_status_idx ON knowledge_document_index_revisions("workspace_id", "base_id", "status")`,
    );

    await ensureConstraint(
      "knowledge_documents",
      "knowledge_documents_current_revision_fkey",
      sql`
        ALTER TABLE "knowledge_documents"
        ADD CONSTRAINT "knowledge_documents_current_revision_fkey"
        FOREIGN KEY ("current_revision_id") REFERENCES "knowledge_document_index_revisions"("id") ON DELETE SET NULL
      `,
    );

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_document_chunk_sets" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL,
        "document_id" varchar NOT NULL,
        "version_id" varchar NOT NULL,
        "revision_id" varchar,
        "document_hash" text,
        "max_tokens" integer,
        "max_chars" integer,
        "overlap_tokens" integer,
        "overlap_chars" integer,
        "split_by_pages" boolean NOT NULL DEFAULT false,
        "respect_headings" boolean NOT NULL DEFAULT true,
        "chunk_count" integer NOT NULL DEFAULT 0,
        "total_tokens" integer NOT NULL DEFAULT 0,
        "total_chars" integer NOT NULL DEFAULT 0,
        "is_latest" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      ALTER TABLE "knowledge_document_chunk_sets"
      ADD COLUMN IF NOT EXISTS "revision_id" varchar
    `);

    await ensureConstraint(
      "knowledge_document_chunk_sets",
      "knowledge_document_chunk_sets_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunk_sets"
        ADD CONSTRAINT "knowledge_document_chunk_sets_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_chunk_sets",
      "knowledge_document_chunk_sets_document_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunk_sets"
        ADD CONSTRAINT "knowledge_document_chunk_sets_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_chunk_sets",
      "knowledge_document_chunk_sets_version_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunk_sets"
        ADD CONSTRAINT "knowledge_document_chunk_sets_version_id_fkey"
        FOREIGN KEY ("version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_chunk_sets",
      "knowledge_document_chunk_sets_revision_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunk_sets"
        ADD CONSTRAINT "knowledge_document_chunk_sets_revision_id_fkey"
        FOREIGN KEY ("revision_id") REFERENCES "knowledge_document_index_revisions"("id") ON DELETE SET NULL
      `,
    );

    await ensureConstraint(
      "knowledge_document_index_revisions",
      "knowledge_document_index_revisions_chunk_set_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_index_revisions"
        ADD CONSTRAINT "knowledge_document_index_revisions_chunk_set_id_fkey"
        FOREIGN KEY ("chunk_set_id") REFERENCES "knowledge_document_chunk_sets"("id") ON DELETE SET NULL
      `,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_chunk_sets_document_idx ON knowledge_document_chunk_sets("document_id", "created_at" DESC)`,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_chunk_sets_document_latest_idx ON knowledge_document_chunk_sets("document_id", "is_latest")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_chunk_sets_document_revision_idx ON knowledge_document_chunk_sets("document_id", "revision_id")`,
    );

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_document_chunks" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL,
        "chunk_set_id" varchar NOT NULL,
        "document_id" varchar NOT NULL,
        "version_id" varchar NOT NULL,
        "revision_id" varchar,
        "chunk_index" integer NOT NULL,
        "text" text NOT NULL,
        "char_start" integer NOT NULL,
        "char_end" integer NOT NULL,
        "token_count" integer NOT NULL,
        "page_number" integer,
        "section_path" text[],
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "content_hash" text NOT NULL,
        "chunk_ordinal" integer,
        "vector_id" text,
        "vector_record_id" text,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(
      sql`ALTER TABLE "knowledge_document_chunks" ADD COLUMN IF NOT EXISTS "revision_id" varchar`,
    );
    await db.execute(
      sql`ALTER TABLE "knowledge_document_chunks" ADD COLUMN IF NOT EXISTS "chunk_ordinal" integer`,
    );
    await db.execute(
      sql`ALTER TABLE "knowledge_document_chunks" ADD COLUMN IF NOT EXISTS "vector_id" text`,
    );

    await ensureConstraint(
      "knowledge_document_chunks",
      "knowledge_document_chunks_workspace_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunks"
        ADD CONSTRAINT "knowledge_document_chunks_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_chunks",
      "knowledge_document_chunks_chunk_set_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunks"
        ADD CONSTRAINT "knowledge_document_chunks_chunk_set_id_fkey"
        FOREIGN KEY ("chunk_set_id") REFERENCES "knowledge_document_chunk_sets"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_chunks",
      "knowledge_document_chunks_document_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunks"
        ADD CONSTRAINT "knowledge_document_chunks_document_id_fkey"
        FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_chunks",
      "knowledge_document_chunks_version_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunks"
        ADD CONSTRAINT "knowledge_document_chunks_version_id_fkey"
        FOREIGN KEY ("version_id") REFERENCES "knowledge_document_versions"("id") ON DELETE CASCADE
      `,
    );

    await ensureConstraint(
      "knowledge_document_chunks",
      "knowledge_document_chunks_revision_id_fkey",
      sql`
        ALTER TABLE "knowledge_document_chunks"
        ADD CONSTRAINT "knowledge_document_chunks_revision_id_fkey"
        FOREIGN KEY ("revision_id") REFERENCES "knowledge_document_index_revisions"("id") ON DELETE SET NULL
      `,
    );

    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_chunks_set_index_idx ON knowledge_document_chunks("chunk_set_id", "chunk_index")`,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_chunks_document_idx ON knowledge_document_chunks("document_id", "chunk_index")`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_chunks_vector_id_idx ON knowledge_document_chunks("vector_id")`,
    );
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_chunks_revision_hash_ordinal_idx ON knowledge_document_chunks("document_id", "revision_id", "content_hash", "chunk_ordinal")`,
    );
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_chunks_document_revision_idx ON knowledge_document_chunks("document_id", "revision_id")`,
    );


    await ensurePgcryptoExtensionAvailable();

    await db.execute(
      sql`ALTER TABLE "knowledge_document_chunks" ADD COLUMN IF NOT EXISTS "content_hash" text`,
    );

    let hashesUpdatedWithDigest = false;
    if (await hasDigestFunction()) {
      try {
        await db.execute(
          sql`
            UPDATE "knowledge_document_chunks"
            SET "content_hash" = encode(digest(COALESCE("text", ''), 'sha256'), 'hex')
            WHERE "content_hash" IS NULL
          `,
        );
        hashesUpdatedWithDigest = true;
      } catch (error) {
        if (!isPgError(error) || !["42883", "42501"].includes(error.code ?? "")) {
          throw error;
        }
      }
    }

    if (!hashesUpdatedWithDigest) {
      if (!loggedContentHashFallbackWarning) {
        console.warn(
          "pgcrypto недоступен, вычисляем content_hash в приложении",
        );
        loggedContentHashFallbackWarning = true;
      }
      await backfillChunkContentHashesInApp();
    }

    let shouldRetrySetNotNull = false;
    try {
      await db.execute(
        sql`ALTER TABLE "knowledge_document_chunks" ALTER COLUMN "content_hash" SET NOT NULL`,
      );
    } catch (error) {
      if (isPgError(error) && error.code === "23502") {
        await backfillChunkContentHashesInApp();
        shouldRetrySetNotNull = true;
      } else {
        swallowPgError(error, ["42704", "42703"]);
      }
    }

    if (shouldRetrySetNotNull) {
      await db.execute(
        sql`ALTER TABLE "knowledge_document_chunks" ALTER COLUMN "content_hash" SET NOT NULL`,
      );
    }

    await db.execute(
      sql`ALTER TABLE "knowledge_document_chunks" ADD COLUMN IF NOT EXISTS "vector_record_id" text`,
    );

    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    } catch (error) {
      swallowPgError(error, ["42710", "0A000"]);
    }

    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
    } catch (error) {
      swallowPgError(error, ["42710", "0A000"]);
    }

    try {
      await db.execute(sql`CREATE OR REPLACE FUNCTION sanitized_chunk_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(
           regexp_replace(
             unaccent(COALESCE($1, '')),
             E'[-_]+',
             ' ',
             'g'
           ),
           '[^[:alnum:]\s]+',
           ' ',
           'g'
         );
$$`);
    } catch (error) {
      swallowPgError(error, ["42704"]);
    }

    await ensureSanitizedChunkSearchVector(db);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS knowledge_document_chunks_heading_trgm_idx
      ON "knowledge_document_chunks"
      USING GIN (("metadata"->>'heading') gin_trgm_ops)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS knowledge_nodes_title_trgm_idx
      ON "knowledge_nodes"
      USING GIN ("title" gin_trgm_ops)
    `);

    knowledgeBaseTablesEnsured = true;
  })();

  await ensuringKnowledgeBaseTables;
}

async function ensureWorkspaceVectorCollectionsTable(): Promise<void> {
  if (workspaceCollectionsTableEnsured) {
    return;
  }

  if (ensuringWorkspaceCollectionsTable) {
    await ensuringWorkspaceCollectionsTable;
    return;
  }

  ensuringWorkspaceCollectionsTable = (async () => {
    await ensureWorkspacesTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workspace_vector_collections" (
        "collection_name" text PRIMARY KEY,
        "workspace_id" varchar NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await ensureConstraint(
      "workspace_vector_collections",
      "workspace_vector_collections_workspace_id_fkey",
      sql`
        ALTER TABLE "workspace_vector_collections"
        ADD CONSTRAINT "workspace_vector_collections_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    try {
      await db.execute(sql`
        ALTER TABLE "workspace_vector_collections"
        ADD COLUMN "created_at" timestamp DEFAULT CURRENT_TIMESTAMP
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`
        UPDATE "workspace_vector_collections"
        SET "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP)
      `);
      await db.execute(sql`
        ALTER TABLE "workspace_vector_collections"
        ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP
      `);
      await db.execute(sql`
        ALTER TABLE "workspace_vector_collections"
        ALTER COLUMN "created_at" SET NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["42703", "23502"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "workspace_vector_collections"
        ADD COLUMN "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`
        UPDATE "workspace_vector_collections"
        SET "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
      `);
      await db.execute(sql`
        ALTER TABLE "workspace_vector_collections"
        ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP
      `);
      await db.execute(sql`
        ALTER TABLE "workspace_vector_collections"
        ALTER COLUMN "updated_at" SET NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["42703", "23502"]);
    }

    try {
      await db.execute(sql`
        CREATE INDEX "workspace_vector_collections_workspace_id_idx"
          ON "workspace_vector_collections" ("workspace_id")
      `);
    } catch (error) {
      swallowPgError(error, ["42P07", "42710"]);
    }
  })();

  try {
    await ensuringWorkspaceCollectionsTable;
    workspaceCollectionsTableEnsured = true;
  } finally {
    ensuringWorkspaceCollectionsTable = null;
  }
}

async function ensureEmbeddingProvidersTable(): Promise<void> {
  if (embeddingProvidersTableEnsured) {
    return;
  }

  if (ensuringEmbeddingProvidersTable) {
    await ensuringEmbeddingProvidersTable;
    return;
  }

  ensuringEmbeddingProvidersTable = (async () => {
    await ensureWorkspacesTable();
    await ensureWorkspaceMembersTable();
    const uuidExpression = await getUuidGenerationExpression();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "embedding_providers" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "name" text NOT NULL,
        "provider_type" text NOT NULL DEFAULT 'gigachat',
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "token_url" text NOT NULL,
        "embeddings_url" text NOT NULL,
        "authorization_key" text NOT NULL DEFAULT '',
        "scope" text NOT NULL,
        "model" text NOT NULL,
        "allow_self_signed_certificate" boolean NOT NULL DEFAULT FALSE,
        "request_headers" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "request_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "response_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "qdrant_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "workspace_id" varchar NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "embedding_providers"
        ADD COLUMN "authorization_key" text DEFAULT ''
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "embedding_providers"
      SET "authorization_key" = COALESCE("authorization_key", '')
    `);

    await db.execute(sql`
      ALTER TABLE "embedding_providers"
      ALTER COLUMN "authorization_key" SET DEFAULT ''
    `);

    await db.execute(sql`
      ALTER TABLE "embedding_providers"
      ALTER COLUMN "authorization_key" SET NOT NULL
    `);

    await db.execute(sql`
      ALTER TABLE "embedding_providers"
      DROP COLUMN IF EXISTS "client_id"
    `);

    await db.execute(sql`
      ALTER TABLE "embedding_providers"
      DROP COLUMN IF EXISTS "client_secret"
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "embedding_providers"
        ADD COLUMN "max_tokens_per_vectorization" integer
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "embedding_providers"
        ADD COLUMN "allow_self_signed_certificate" boolean DEFAULT FALSE
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "embedding_providers"
      SET "allow_self_signed_certificate" = COALESCE("allow_self_signed_certificate", FALSE)
    `);

    await db.execute(sql`
      ALTER TABLE "embedding_providers"
      ALTER COLUMN "allow_self_signed_certificate" SET DEFAULT FALSE
    `);

    await db.execute(sql`
      ALTER TABLE "embedding_providers"
      ALTER COLUMN "allow_self_signed_certificate" SET NOT NULL
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "embedding_providers"
        ADD COLUMN "workspace_id" varchar
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await ensureConstraint(
      "embedding_providers",
      "embedding_providers_workspace_id_fkey",
      sql`
        ALTER TABLE "embedding_providers"
        ADD CONSTRAINT "embedding_providers_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    try {
      await db.execute(sql`
        ALTER TABLE "embedding_providers"
        ALTER COLUMN "workspace_id" SET NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["23502"]);
    }

    try {
      await db.execute(sql`
        CREATE INDEX "embedding_providers_active_idx"
          ON "embedding_providers" ("is_active")
      `);
    } catch (error) {
      swallowPgError(error, ["42P07", "42710"]);
    }

    try {
      await db.execute(sql`
        CREATE INDEX "embedding_providers_provider_type_idx"
          ON "embedding_providers" ("provider_type")
      `);
    } catch (error) {
      swallowPgError(error, ["42P07", "42710"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "embedding_providers"
        ADD COLUMN "is_global" boolean NOT NULL DEFAULT false
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }
  })();

  try {
    await ensuringEmbeddingProvidersTable;
    embeddingProvidersTableEnsured = true;
  } finally {
    ensuringEmbeddingProvidersTable = null;
  }
}

async function ensureKnowledgeBaseRagRequestsTable(): Promise<void> {
  if (knowledgeBaseRagRequestsTableEnsured) {
    return;
  }

  if (ensuringKnowledgeBaseRagRequestsTable) {
    await ensuringKnowledgeBaseRagRequestsTable;
    return;
  }

  ensuringKnowledgeBaseRagRequestsTable = (async () => {
    await ensureWorkspacesTable();
    await ensureWorkspaceVectorCollectionsTable();
    await ensureKnowledgeBaseTables();
    await ensureEmbeddingProvidersTable();

    const uuidExpression = await getUuidGenerationExpression();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_base_rag_requests" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
        "top_k" integer,
        "bm25_weight" double precision,
        "bm25_limit" integer,
        "vector_weight" double precision,
        "vector_limit" integer,
        "embedding_provider_id" varchar REFERENCES "embedding_providers"("id") ON DELETE SET NULL,
        "collection" text,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS knowledge_base_rag_requests_workspace_base_created_idx
          ON "knowledge_base_rag_requests" ("workspace_id", "knowledge_base_id", "created_at")
      `);
    } catch (error) {
      swallowPgError(error, ["42710", "42P07"]);
    }
  })();

  try {
    await ensuringKnowledgeBaseRagRequestsTable;
    knowledgeBaseRagRequestsTableEnsured = true;
  } finally {
    ensuringKnowledgeBaseRagRequestsTable = null;
  }
}

async function ensureKnowledgeBaseAskAiRunsTable(): Promise<void> {
  if (knowledgeBaseAskAiRunsTableEnsured) {
    return;
  }

  if (ensuringKnowledgeBaseAskAiRunsTable) {
    await ensuringKnowledgeBaseAskAiRunsTable;
    return;
  }

  ensuringKnowledgeBaseAskAiRunsTable = (async () => {
    await ensureWorkspacesTable();
    await ensureKnowledgeBaseTables();
    await ensureEmbeddingProvidersTable();
    await ensureLlmProvidersTable();

    const uuidExpression = await getUuidGenerationExpression();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_base_ask_ai_runs" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
        "prompt" text NOT NULL,
        "normalized_query" text,
        "status" text NOT NULL DEFAULT 'success',
        "error_message" text,
        "top_k" integer,
        "bm25_weight" double precision,
        "bm25_limit" integer,
        "vector_weight" double precision,
        "vector_limit" integer,
        "vector_collection" text,
        "embedding_provider_id" varchar REFERENCES "embedding_providers"("id") ON DELETE SET NULL,
        "llm_provider_id" varchar REFERENCES "llm_providers"("id") ON DELETE SET NULL,
        "llm_model" text,
        "bm25_result_count" integer,
        "vector_result_count" integer,
        "vector_document_count" integer,
        "combined_result_count" integer,
        "embedding_tokens" integer,
        "llm_tokens" integer,
        "total_tokens" integer,
        "retrieval_duration_ms" double precision,
        "bm25_duration_ms" double precision,
        "vector_duration_ms" double precision,
        "llm_duration_ms" double precision,
        "total_duration_ms" double precision,
        "started_at" timestamp,
        "pipeline_log" jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS knowledge_base_ask_ai_runs_workspace_base_created_idx
          ON "knowledge_base_ask_ai_runs" ("workspace_id", "knowledge_base_id", "created_at")
      `);
    } catch (error) {
      swallowPgError(error, ["42710", "42P07"]);
    }
  })();

  try {
    await ensuringKnowledgeBaseAskAiRunsTable;
    knowledgeBaseAskAiRunsTableEnsured = true;
  } finally {
    ensuringKnowledgeBaseAskAiRunsTable = null;
  }
}

async function ensureKnowledgeBaseSearchSettingsTable(): Promise<void> {
  if (knowledgeBaseSearchSettingsTableEnsured) {
    return;
  }

  if (ensuringKnowledgeBaseSearchSettingsTable) {
    await ensuringKnowledgeBaseSearchSettingsTable;
    return;
  }

  ensuringKnowledgeBaseSearchSettingsTable = (async () => {
    await ensureWorkspacesTable();
    await ensureKnowledgeBaseTables();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_base_search_settings" (
        "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
        "chunk_settings" jsonb,
        "rag_settings" jsonb,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT knowledge_base_search_settings_pk PRIMARY KEY ("workspace_id", "knowledge_base_id")
      )
    `);
  })();

  try {
    await ensuringKnowledgeBaseSearchSettingsTable;
    knowledgeBaseSearchSettingsTableEnsured = true;
  } finally {
    ensuringKnowledgeBaseSearchSettingsTable = null;
  }
}

async function ensureLlmProvidersTable(): Promise<void> {
  if (llmProvidersTableEnsured) {
    return;
  }

  if (ensuringLlmProvidersTable) {
    await ensuringLlmProvidersTable;
    return;
  }

  ensuringLlmProvidersTable = (async () => {
    await ensureWorkspacesTable();
    await ensureWorkspaceMembersTable();
    const uuidExpression = await getUuidGenerationExpression();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "llm_providers" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "name" text NOT NULL,
        "provider_type" text NOT NULL DEFAULT 'gigachat',
        "description" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "token_url" text NOT NULL,
        "completion_url" text NOT NULL,
        "authorization_key" text NOT NULL DEFAULT '',
        "scope" text NOT NULL,
        "model" text NOT NULL,
        "allow_self_signed_certificate" boolean NOT NULL DEFAULT FALSE,
        "request_headers" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "request_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "response_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "workspace_id" varchar NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "llm_providers"
        ADD COLUMN "authorization_key" text DEFAULT ''
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "llm_providers"
      SET "authorization_key" = COALESCE("authorization_key", '')
    `);

    await db.execute(sql`
      ALTER TABLE "llm_providers"
      ALTER COLUMN "authorization_key" SET DEFAULT ''
    `);

    await db.execute(sql`
      ALTER TABLE "llm_providers"
      ALTER COLUMN "authorization_key" SET NOT NULL
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "llm_providers"
        ADD COLUMN "allow_self_signed_certificate" boolean DEFAULT FALSE
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "llm_providers"
      SET "allow_self_signed_certificate" = COALESCE("allow_self_signed_certificate", FALSE)
    `);

    await db.execute(sql`
      ALTER TABLE "llm_providers"
      ALTER COLUMN "allow_self_signed_certificate" SET DEFAULT FALSE
    `);

    await db.execute(sql`
      ALTER TABLE "llm_providers"
      ALTER COLUMN "allow_self_signed_certificate" SET NOT NULL
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "llm_providers"
        ADD COLUMN "available_models" jsonb
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "llm_providers"
      SET "available_models" = COALESCE("available_models", '[]'::jsonb)
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "llm_providers"
        ALTER COLUMN "available_models" SET DEFAULT '[]'::jsonb
      `);
    } catch (error) {
      swallowPgError(error, ["42704"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "llm_providers"
        ADD COLUMN "workspace_id" varchar
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await ensureConstraint(
      "llm_providers",
      "llm_providers_workspace_id_fkey",
      sql`
        ALTER TABLE "llm_providers"
        ADD CONSTRAINT "llm_providers_workspace_id_fkey"
        FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
      `,
    );

    try {
      await db.execute(sql`
        ALTER TABLE "llm_providers"
        ALTER COLUMN "workspace_id" SET NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["23502"]);
    }

    try {
      await db.execute(sql`
        CREATE INDEX "llm_providers_active_idx"
          ON "llm_providers" ("is_active")
      `);
    } catch (error) {
      swallowPgError(error, ["42P07", "42710"]);
    }

    try {
      await db.execute(sql`
        CREATE INDEX "llm_providers_provider_type_idx"
          ON "llm_providers" ("provider_type")
      `);
    } catch (error) {
      swallowPgError(error, ["42P07", "42710"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "llm_providers"
        ADD COLUMN "is_global" boolean NOT NULL DEFAULT false
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }
  })();

  try {
    await ensuringLlmProvidersTable;
    llmProvidersTableEnsured = true;
  } finally {
    ensuringLlmProvidersTable = null;
  }
}

async function ensureUsersTable(): Promise<void> {
  if (usersTableEnsured) {
    return;
  }

  if (ensuringUsersTable) {
    await ensuringUsersTable;
    return;
  }

  ensuringUsersTable = (async () => {
    await db.execute(sql`SELECT 1 FROM "users" LIMIT 1`);
  })();

  try {
    await ensuringUsersTable;
    usersTableEnsured = true;
  } finally {
    ensuringUsersTable = null;
  }
}

async function ensureSpeechProvidersTables(): Promise<void> {
  if (speechProvidersTableEnsured) {
    return;
  }

  if (ensuringSpeechProvidersTable) {
    await ensuringSpeechProvidersTable;
    return;
  }

  ensuringSpeechProvidersTable = (async () => {
    await ensureUsersTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "speech_providers" (
        "id" text PRIMARY KEY,
        "display_name" text NOT NULL,
        "provider_type" text NOT NULL DEFAULT 'stt',
        "direction" text NOT NULL DEFAULT 'audio_to_text',
        "is_enabled" boolean NOT NULL DEFAULT FALSE,
        "status" text NOT NULL DEFAULT 'Disabled',
        "last_status_changed_at" timestamp,
        "last_validation_at" timestamp,
        "last_error_code" text,
        "last_error_message" text,
        "config_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_built_in" boolean NOT NULL DEFAULT FALSE,
        "updated_by_admin_id" varchar REFERENCES "users"("id"),
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "speech_provider_secrets" (
        "provider_id" text NOT NULL REFERENCES "speech_providers"("id") ON DELETE CASCADE,
        "secret_key" text NOT NULL,
        "secret_value" text NOT NULL DEFAULT '',
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT speech_provider_secrets_pk PRIMARY KEY ("provider_id", "secret_key")
      )
    `);

    await db.execute(sql`
      INSERT INTO "speech_providers" (
        "id",
        "display_name",
        "provider_type",
        "direction",
        "is_enabled",
        "status",
        "config_json",
        "is_built_in",
        "created_at",
        "updated_at"
      )
      SELECT
        'yandex_speechkit',
        'Yandex SpeechKit',
        'stt',
        'audio_to_text',
        FALSE,
        'Disabled',
        '{}'::jsonb,
        TRUE,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM "speech_providers" WHERE "id" = 'yandex_speechkit'
      )
    `);
  })();

  try {
    await ensuringSpeechProvidersTable;
    speechProvidersTableEnsured = true;
  } finally {
    ensuringSpeechProvidersTable = null;
  }
}

async function ensureFileStorageProvidersTable(): Promise<void> {
  if (fileStorageProvidersTableEnsured) {
    return;
  }

  if (ensuringFileStorageProvidersTable) {
    await ensuringFileStorageProvidersTable;
    return;
  }

  ensuringFileStorageProvidersTable = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "file_storage_providers" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "base_url" text NOT NULL,
        "description" text,
        "auth_type" text NOT NULL DEFAULT 'none',
        "is_active" boolean NOT NULL DEFAULT TRUE,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT file_storage_providers_auth_type_chk CHECK ("auth_type" IN ('none', 'bearer'))
      )
    `);

    // migrate existing tables missing config column
    await db.execute(sql`
      ALTER TABLE "file_storage_providers"
      ADD COLUMN IF NOT EXISTS "config" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS file_storage_providers_name_idx
      ON "file_storage_providers" (lower(name))
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS file_storage_providers_active_idx
      ON "file_storage_providers" (is_active, updated_at DESC)
    `);
  })();

  try {
    await ensuringFileStorageProvidersTable;
    fileStorageProvidersTableEnsured = true;
  } finally {
    ensuringFileStorageProvidersTable = null;
  }
}

async function ensureFilesTable(): Promise<void> {
  if (filesTableEnsured) {
    return;
  }

  if (ensuringFilesTable) {
    await ensuringFilesTable;
    return;
  }

  ensuringFilesTable = (async () => {
    await ensureWorkspacesTable();
    await ensureUsersTable();
    await ensureFileStorageProvidersTable();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "files" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "skill_id" varchar,
        "chat_id" varchar,
        "message_id" varchar,
        "user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
        "kind" file_kind NOT NULL,
        "name" text NOT NULL,
        "mime_type" text,
        "size_bytes" bigint,
        "storage_type" file_storage_type NOT NULL,
        "bucket" text,
        "object_key" text,
        "object_version" text,
        "external_uri" text,
        "provider_id" varchar REFERENCES "file_storage_providers"("id") ON DELETE SET NULL,
        "provider_file_id" text,
        "status" file_status NOT NULL DEFAULT 'ready',
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS files_workspace_idx ON "files" ("workspace_id", "created_at" DESC)
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS files_skill_idx ON "files" ("skill_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS files_chat_idx ON "files" ("chat_id")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS files_message_idx ON "files" ("message_id")`);
  })();

  try {
    await ensuringFilesTable;
    filesTableEnsured = true;
  } finally {
    ensuringFilesTable = null;
  }
}

async function ensureFileEventOutboxTable(): Promise<void> {
  if (fileEventOutboxTableEnsured) {
    return;
  }

  if (ensuringFileEventOutboxTable) {
    await ensuringFileEventOutboxTable;
    return;
  }

  ensuringFileEventOutboxTable = (async () => {
    await ensureFilesTable();

    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_event_status') THEN
          CREATE TYPE file_event_status AS ENUM ('queued', 'retrying', 'sent', 'failed');
        END IF;
      END
      $$;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "file_event_outbox" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id" uuid NOT NULL UNIQUE,
        "action" text NOT NULL,
        "file_id" uuid NOT NULL REFERENCES "files"("id") ON DELETE CASCADE,
        "workspace_id" uuid NOT NULL,
        "skill_id" uuid,
        "chat_id" uuid,
        "user_id" varchar,
        "message_id" varchar,
        "target_url" text NOT NULL,
        "auth_type" text NOT NULL DEFAULT 'none',
        "bearer_token" text,
        "payload" jsonb NOT NULL,
        "status" file_event_status NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz,
        "last_error" text,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("file_id", "action")
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS file_event_outbox_status_idx
      ON "file_event_outbox"(status, next_attempt_at NULLS FIRST, created_at)
    `);
  })();

  try {
    await ensuringFileEventOutboxTable;
    fileEventOutboxTableEnsured = true;
  } finally {
    ensuringFileEventOutboxTable = null;
  }
}

async function ensureAuthProvidersTable(): Promise<void> {
  if (authProvidersTableEnsured) {
    return;
  }

  if (ensuringAuthProvidersTable) {
    await ensuringAuthProvidersTable;
    return;
  }

  ensuringAuthProvidersTable = (async () => {
    const uuidExpression = await getUuidGenerationExpression();
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "auth_providers" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "provider" text NOT NULL UNIQUE,
        "is_enabled" boolean NOT NULL DEFAULT FALSE,
        "client_id" text NOT NULL DEFAULT '',
        "client_secret" text NOT NULL DEFAULT '',
        "callback_url" text NOT NULL DEFAULT '/api/auth/google/callback',
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    try {
      await db.execute(sql`
        CREATE INDEX IF NOT EXISTS "auth_providers_provider_idx"
          ON "auth_providers" ("provider")
      `);
    } catch (error) {
      swallowPgError(error, ["42P07"]);
    }
  })();

  try {
    await ensuringAuthProvidersTable;
    authProvidersTableEnsured = true;
  } finally {
    ensuringAuthProvidersTable = null;
  }
}

export class DatabaseStorage implements IStorage {
  private db = db;
  private userAuthColumnsEnsured = false;
  private workspaceMembershipCache = new Map<
    string,
    { value: WorkspaceMembership | null; expiresAt: number }
  >();
  private ensuringUserAuthColumns: Promise<void> | null = null;

  private async ensureUserAuthColumns(): Promise<void> {
    if (this.userAuthColumnsEnsured || globalUserAuthSchemaReady) {
      this.userAuthColumnsEnsured = true;
      return;
    }

    if (this.ensuringUserAuthColumns) {
      return this.ensuringUserAuthColumns;
    }

    this.ensuringUserAuthColumns = (async () => {
      const emailColumnCheck = await this.db.execute(sql`
        SELECT COUNT(*)::int AS "emailColumnCount"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'email'
      `);
      const emailColumnCount = Number(emailColumnCheck.rows[0]?.emailColumnCount ?? 0);

      if (emailColumnCount === 0) {
        const usernameColumnCheck = await this.db.execute(sql`
          SELECT COUNT(*)::int AS "usernameColumnCount"
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'users'
            AND column_name = 'username'
        `);
        const usernameColumnCount = Number(usernameColumnCheck.rows[0]?.usernameColumnCount ?? 0);

        if (usernameColumnCount > 0) {
          await this.db.execute(sql`ALTER TABLE "users" RENAME COLUMN "username" TO "email"`);
        } else {
          try {
            await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "email" text`);
          } catch (error) {
            swallowPgError(error, ["42701"]);
          }
        }
      }

      const passwordColumnCheck = await this.db.execute(sql`
        SELECT COUNT(*)::int AS "passwordColumnCount"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'password'
      `);
      const passwordColumnCount = Number(passwordColumnCheck.rows[0]?.passwordColumnCount ?? 0);

      if (passwordColumnCount > 0) {
        await this.db.execute(sql`ALTER TABLE "users" RENAME COLUMN "password" TO "password_hash"`);
      }

      await this.db.execute(sql`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_unique"`);

      const emailUniqueConstraintCheck = await this.db.execute(sql`
        SELECT COUNT(*)::int AS "emailUniqueConstraintCount"
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND conname = 'users_email_unique'
      `);
      const emailUniqueConstraintCount = Number(
        emailUniqueConstraintCheck.rows[0]?.emailUniqueConstraintCount ?? 0
      );

      if (emailUniqueConstraintCount === 0) {
        await this.db.execute(sql`ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email")`);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "full_name" text`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }
      await this.db.execute(sql`UPDATE "users" SET "full_name" = COALESCE("full_name", 'Новый пользователь')`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "full_name" SET NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "first_name" text DEFAULT ''`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "last_name" text DEFAULT ''`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "phone" text DEFAULT ''`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "personal_api_token_hash" text`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "personal_api_token_last_four" text`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "personal_api_token_generated_at" timestamp`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "google_id" text`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "google_avatar" text DEFAULT ''`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      await this.db.execute(sql`UPDATE "users" SET "google_avatar" = COALESCE("google_avatar", '')`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "google_avatar" SET DEFAULT ''`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "google_avatar" SET NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "google_email_verified" boolean DEFAULT FALSE`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      await this.db.execute(
        sql`UPDATE "users" SET "google_email_verified" = COALESCE("google_email_verified", FALSE)`
      );
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "google_email_verified" SET DEFAULT FALSE`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "google_email_verified" SET NOT NULL`);

      const googleIdUniqueConstraintCheck = await this.db.execute(sql`
        SELECT COUNT(*)::int AS "googleIdUniqueConstraintCount"
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND conname = 'users_google_id_unique'
      `);
      const googleIdUniqueConstraintCount = Number(
        googleIdUniqueConstraintCheck.rows[0]?.googleIdUniqueConstraintCount ?? 0
      );

      if (googleIdUniqueConstraintCount === 0) {
        await this.db.execute(
          sql`ALTER TABLE "users" ADD CONSTRAINT "users_google_id_unique" UNIQUE ("google_id")`
        );
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "yandex_id" text`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "yandex_avatar" text DEFAULT ''`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      await this.db.execute(sql`UPDATE "users" SET "yandex_avatar" = COALESCE("yandex_avatar", '')`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "yandex_avatar" SET DEFAULT ''`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "yandex_avatar" SET NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "yandex_email_verified" boolean DEFAULT FALSE`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      await this.db.execute(
        sql`UPDATE "users" SET "yandex_email_verified" = COALESCE("yandex_email_verified", FALSE)`
      );
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "yandex_email_verified" SET DEFAULT FALSE`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "yandex_email_verified" SET NOT NULL`);

      const yandexIdUniqueConstraintCheck = await this.db.execute(sql`
        SELECT COUNT(*)::int AS "yandexIdUniqueConstraintCount"
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
          AND conname = 'users_yandex_id_unique'
      `);
      const yandexIdUniqueConstraintCount = Number(
        yandexIdUniqueConstraintCheck.rows[0]?.yandexIdUniqueConstraintCount ?? 0
      );

      if (yandexIdUniqueConstraintCount === 0) {
        await this.db.execute(
          sql`ALTER TABLE "users" ADD CONSTRAINT "users_yandex_id_unique" UNIQUE ("yandex_id")`
        );
      }

      await this.db.execute(sql`
        UPDATE "users"
        SET
          "first_name" = CASE
            WHEN COALESCE(NULLIF(btrim("first_name"), ''), '') <> '' THEN btrim("first_name")
            WHEN position(' ' in "full_name") > 0 THEN split_part("full_name", ' ', 1)
            ELSE "full_name"
          END,
          "last_name" = CASE
            WHEN COALESCE(NULLIF(btrim("last_name"), ''), '') <> '' THEN btrim("last_name")
            WHEN position(' ' in "full_name") > 0 THEN btrim(substring("full_name" from position(' ' in "full_name") + 1))
            ELSE ''
          END,
          "phone" = COALESCE("phone", '')
      `);

      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "first_name" SET DEFAULT ''`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "first_name" SET NOT NULL`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "last_name" SET DEFAULT ''`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "last_name" SET NOT NULL`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "phone" SET DEFAULT ''`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user'`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }
      await this.db.execute(sql`UPDATE "users" SET "role" = COALESCE("role", 'user')`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }
      await this.db.execute(sql`UPDATE "users" SET "last_active_at" = COALESCE("last_active_at", "updated_at", CURRENT_TIMESTAMP)`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "last_active_at" SET NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "created_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }
      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }
      await this.db.execute(sql`
        UPDATE "users"
        SET
          "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
          "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
      `);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "updated_at" SET NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "is_email_confirmed" boolean DEFAULT FALSE`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }
      await this.db.execute(sql`UPDATE "users" SET "is_email_confirmed" = COALESCE("is_email_confirmed", FALSE)`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "is_email_confirmed" SET DEFAULT FALSE`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "is_email_confirmed" SET NOT NULL`);

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "email_confirmed_at" timestamp with time zone`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }

      try {
        await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN "status" varchar(64) DEFAULT 'active'`);
      } catch (error) {
        swallowPgError(error, ["42701"]);
      }
      await this.db.execute(sql`UPDATE "users" SET "status" = COALESCE("status", 'active')`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "status" SET NOT NULL`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active'`);

      const uuidExpression = await getUuidGenerationExpression();
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS "personal_api_tokens" (
          "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
          "user_id" varchar NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "token_hash" text NOT NULL,
          "last_four" text NOT NULL,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "revoked_at" timestamp
        )
      `);

      try {
        await this.db.execute(sql`
          CREATE INDEX "personal_api_tokens_user_id_idx"
            ON "personal_api_tokens" ("user_id")
        `);
      } catch (error) {
        swallowPgError(error, ["42P07", "42710", "23505"]);
      }

      try {
        await this.db.execute(sql`
          CREATE INDEX "personal_api_tokens_active_idx"
            ON "personal_api_tokens" ("user_id")
            WHERE "revoked_at" IS NULL
        `);
      } catch (error) {
        swallowPgError(error, ["42P07", "42710", "23505"]);
      }

      try {
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "tariff_plans" (
            "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
            "code" text NOT NULL UNIQUE,
            "name" text NOT NULL,
            "description" text,
            "short_description" text,
            "sort_order" integer NOT NULL DEFAULT 0,
            "included_credits_amount" integer NOT NULL DEFAULT 0,
            "included_credits_period" text NOT NULL DEFAULT 'monthly',
            "no_code_flow_enabled" boolean NOT NULL DEFAULT false,
            "is_active" boolean NOT NULL DEFAULT true,
            "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch (error) {
        swallowPgError(error, ["42P07", "42710"]);
      }

      try {
        await this.db.execute(sql`
          ALTER TABLE "tariff_plans"
          ADD COLUMN IF NOT EXISTS "no_code_flow_enabled" boolean NOT NULL DEFAULT false
        `);
      } catch (error) {
        swallowPgError(error, ["42P07", "42710"]);
      }

      try {
        await this.db.execute(sql`
          CREATE TABLE IF NOT EXISTS "tariff_limits" (
            "id" varchar PRIMARY KEY DEFAULT gen_random_uuid()::text,
            "plan_id" varchar NOT NULL REFERENCES "tariff_plans"("id") ON DELETE CASCADE,
            "limit_key" text NOT NULL,
            "unit" text NOT NULL,
            "limit_value" double precision,
            "is_enabled" boolean NOT NULL DEFAULT true,
            "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updated_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
          )
        `);
      } catch (error) {
        swallowPgError(error, ["42P07", "42710"]);
      }

      try {
        await this.db.execute(sql`
          CREATE INDEX "tariff_limits_plan_idx"
            ON "tariff_limits" ("plan_id")
        `);
        await this.db.execute(sql`
          CREATE INDEX "tariff_limits_plan_key_idx"
            ON "tariff_limits" ("plan_id", "limit_key")
        `);
      } catch (error) {
        swallowPgError(error, ["42P07", "42710", "23505"]);
      }

      try {
        await this.db.execute(sql`
          INSERT INTO "tariff_plans" ("code", "name", "description", "is_active")
          VALUES ('FREE', 'Бесплатный план', 'Бесплатный тарифный план', true)
          ON CONFLICT ("code") DO NOTHING
        `);
      } catch (error) {
        swallowPgError(error, ["23505"]);
      }

      globalUserAuthSchemaReady = true;
      this.userAuthColumnsEnsured = true;
    })();

    try {
      await this.ensuringUserAuthColumns;
    } finally {
      this.ensuringUserAuthColumns = null;
    }
  }

  private buildAskAiRunSummary(row: KnowledgeBaseAskAiRun): KnowledgeBaseAskAiRunSummary {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      knowledgeBaseId: row.knowledgeBaseId,
      prompt: row.prompt,
      normalizedQuery: row.normalizedQuery ?? null,
      status: (row.status as "success" | "error") ?? "success",
      errorMessage: row.errorMessage ?? null,
      createdAt: toIsoTimestamp(row.createdAt) ?? new Date().toISOString(),
      startedAt: toIsoTimestamp(row.startedAt),
      topK: row.topK ?? null,
      bm25Weight: row.bm25Weight ?? null,
      bm25Limit: row.bm25Limit ?? null,
      vectorWeight: row.vectorWeight ?? null,
      vectorLimit: row.vectorLimit ?? null,
      vectorCollection: row.vectorCollection ?? null,
      embeddingProviderId: row.embeddingProviderId ?? null,
      llmProviderId: row.llmProviderId ?? null,
      llmModel: row.llmModel ?? null,
      bm25ResultCount: row.bm25ResultCount ?? null,
      vectorResultCount: row.vectorResultCount ?? null,
      vectorDocumentCount: row.vectorDocumentCount ?? null,
      combinedResultCount: row.combinedResultCount ?? null,
      embeddingTokens: row.embeddingTokens ?? null,
      llmTokens: row.llmTokens ?? null,
      totalTokens: row.totalTokens ?? null,
      retrievalDurationMs: row.retrievalDurationMs ?? null,
      bm25DurationMs: row.bm25DurationMs ?? null,
      vectorDurationMs: row.vectorDurationMs ?? null,
      llmDurationMs: row.llmDurationMs ?? null,
      totalDurationMs: row.totalDurationMs ?? null,
    };
  }

  private buildAskAiRunDetail(row: KnowledgeBaseAskAiRun): KnowledgeBaseAskAiRunDetail {
    const summary = this.buildAskAiRunSummary(row);
    const pipeline = Array.isArray(row.pipelineLog)
      ? (row.pipelineLog as KnowledgeBaseAskAiPipelineStepLog[])
      : [];

    return { ...summary, pipelineLog: pipeline };
  }

  async createSite(site: SiteInsert): Promise<Site> {
    const [newSite] = await this.db.insert(sites).values(site).returning();
    return newSite;
  }

  async getSite(id: string, workspaceId?: string): Promise<Site | undefined> {
    const condition = workspaceId
      ? and(eq(sites.id, id), eq(sites.workspaceId, workspaceId))
      : eq(sites.id, id);
    const [site] = await this.db.select().from(sites).where(condition);
    return site ?? undefined;
  }

  async getSiteByPublicId(publicId: string): Promise<Site | undefined> {
    const [site] = await this.db.select().from(sites).where(eq(sites.publicId, publicId));
    return site ?? undefined;
  }

  async getSiteByPublicApiKey(apiKey: string): Promise<Site | undefined> {
    const normalized = apiKey.trim();
    if (!normalized) {
      return undefined;
    }

    const [site] = await this.db
      .select()
      .from(sites)
      .where(eq(sites.publicApiKey, normalized))
      .limit(1);
    return site ?? undefined;
  }

  async getAllSites(workspaceId?: string): Promise<Site[]> {
    let query = this.db.select().from(sites);
    if (workspaceId) {
      query = query.where(eq(sites.workspaceId, workspaceId));
    }
    return await query.orderBy(desc(sites.createdAt));
  }

  async updateSite(id: string, updates: Partial<Site>, workspaceId?: string): Promise<Site | undefined> {
    const condition = workspaceId
      ? and(eq(sites.id, id), eq(sites.workspaceId, workspaceId))
      : eq(sites.id, id);
    const [updatedSite] = await this.db
      .update(sites)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(condition)
      .returning();
    return updatedSite ?? undefined;
  }

  async deleteSite(id: string, workspaceId?: string): Promise<boolean> {
    const condition = workspaceId
      ? and(eq(sites.id, id), eq(sites.workspaceId, workspaceId))
      : eq(sites.id, id);
    const result = await this.db.delete(sites).where(condition);
    return (result.rowCount ?? 0) > 0;
  }

  async rotateSiteApiKey(
    siteId: string,
    workspaceId?: string,
  ): Promise<{ site: Site; apiKey: string } | undefined> {
    const newApiKey = randomBytes(32).toString("hex");
    const condition = workspaceId
      ? and(eq(sites.id, siteId), eq(sites.workspaceId, workspaceId))
      : eq(sites.id, siteId);

    const [updatedSite] = await this.db
      .update(sites)
      .set({
        publicApiKey: newApiKey,
        publicApiKeyGeneratedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(condition)
      .returning();

    if (!updatedSite) {
      return undefined;
    }

    return { site: updatedSite, apiKey: newApiKey };
  }

  async listWorkspaceCollections(workspaceId: string): Promise<string[]> {
    await ensureWorkspaceVectorCollectionsTable();

    const rows = await this.db
      .select({ collectionName: workspaceVectorCollections.collectionName })
      .from(workspaceVectorCollections)
      .where(eq(workspaceVectorCollections.workspaceId, workspaceId));

    const collectionNames = new Set<string>();

    for (const row of rows) {
      const normalized = row.collectionName?.trim();
      if (normalized && normalized.length > 0) {
        collectionNames.add(normalized);
      }
    }

    const sanitizeCollectionName = (source: string): string => {
      const normalized = source.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
      return normalized.length > 0 ? normalized.slice(0, 60) : "default";
    };

    const buildWorkspaceScopedCollectionName = (workspace: string, project: string, collection: string): string => {
      const workspaceSlug = sanitizeCollectionName(workspace);
      const projectSlug = sanitizeCollectionName(project);
      const collectionSlug = sanitizeCollectionName(collection);
      return `ws_${workspaceSlug}__proj_${projectSlug}__coll_${collectionSlug}`;
    };

    const buildSkillFileCollectionName = (workspace: string, providerId: string): string => {
      return buildWorkspaceScopedCollectionName(workspace, "skill_files", providerId || "skill_files");
    };

    await ensureEmbeddingProvidersTable();

    const providerRows = await this.db
      .select({ id: embeddingProviders.id, qdrantConfig: embeddingProviders.qdrantConfig })
      .from(embeddingProviders)
      .where(eq(embeddingProviders.workspaceId, workspaceId));

    for (const { qdrantConfig } of providerRows) {
      const candidate =
        qdrantConfig && typeof qdrantConfig === "object"
          ? (qdrantConfig as Record<string, unknown>).collectionName
          : undefined;

      if (typeof candidate === "string") {
        const normalized = candidate.trim();
        if (normalized.length > 0 && normalized.toLowerCase() !== "auto") {
          collectionNames.add(normalized);
        }
      }
    }

    for (const { id } of providerRows) {
      if (id) {
        collectionNames.add(buildSkillFileCollectionName(workspaceId, id));
      }
    }

    return Array.from(collectionNames);
  }

  async getCollectionWorkspace(collectionName: string): Promise<string | null> {
    const normalized = collectionName.trim();
    if (!normalized) {
      return null;
    }

    await ensureWorkspaceVectorCollectionsTable();

    const [row] = await this.db
      .select({ workspaceId: workspaceVectorCollections.workspaceId })
      .from(workspaceVectorCollections)
      .where(eq(workspaceVectorCollections.collectionName, normalized));

    if (row?.workspaceId) {
      return row.workspaceId;
    }

    await ensureEmbeddingProvidersTable();

    const [fallback] = await this.db
      .select({
        workspaceId: embeddingProviders.workspaceId,
        storedCollectionName: sql<string | null>`NULLIF(btrim(${embeddingProviders.qdrantConfig} ->> 'collectionName'), '')`,
      })
      .from(embeddingProviders)
      .where(sql`btrim(${embeddingProviders.qdrantConfig} ->> 'collectionName') = ${normalized}`)
      .limit(1);

    const fallbackWorkspaceId = fallback?.storedCollectionName ? fallback.workspaceId : null;

    if (!fallbackWorkspaceId) {
      return null;
    }

    try {
      await this.db
        .insert(workspaceVectorCollections)
        .values({ collectionName: normalized, workspaceId: fallbackWorkspaceId })
        .onConflictDoNothing();
    } catch (error) {
      swallowPgError(error, ["23505"]);
    }

    return fallbackWorkspaceId;
  }

  async upsertCollectionWorkspace(collectionName: string, workspaceId: string): Promise<void> {
    await ensureWorkspaceVectorCollectionsTable();

    await this.db
      .insert(workspaceVectorCollections)
      .values({ collectionName, workspaceId })
      .onConflictDoUpdate({
        target: workspaceVectorCollections.collectionName,
        set: { workspaceId, updatedAt: sql`CURRENT_TIMESTAMP` },
      });
  }

  async removeCollectionWorkspace(collectionName: string): Promise<void> {
    await ensureWorkspaceVectorCollectionsTable();

    await this.db
      .delete(workspaceVectorCollections)
      .where(eq(workspaceVectorCollections.collectionName, collectionName));
  }

  async getOrCreateWorkspaceEmbedKey(
    workspaceId: string,
    collection: string,
    knowledgeBaseId: string,
  ): Promise<WorkspaceEmbedKey> {
    const trimmedCollection = collection.trim();

    const [existing] = await this.db
      .select()
      .from(workspaceEmbedKeys)
      .where(
        and(
          eq(workspaceEmbedKeys.workspaceId, workspaceId),
          eq(workspaceEmbedKeys.collection, trimmedCollection),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.knowledgeBaseId !== knowledgeBaseId) {
        const [updated] = await this.db
          .update(workspaceEmbedKeys)
          .set({ knowledgeBaseId, updatedAt: sql`CURRENT_TIMESTAMP` })
          .where(eq(workspaceEmbedKeys.id, existing.id))
          .returning();

        return updated ?? existing;
      }

      return existing;
    }

    const [created] = await this.db
      .insert(workspaceEmbedKeys)
      .values({
        workspaceId,
        collection: trimmedCollection,
        knowledgeBaseId,
      })
      .returning();

    if (!created) {
      throw new Error("Не удалось создать публичный ключ для коллекции");
    }

    return created;
  }

  async getWorkspaceEmbedKey(id: string, workspaceId?: string): Promise<WorkspaceEmbedKey | undefined> {
    const condition = workspaceId
      ? and(eq(workspaceEmbedKeys.id, id), eq(workspaceEmbedKeys.workspaceId, workspaceId))
      : eq(workspaceEmbedKeys.id, id);

    const [entry] = await this.db.select().from(workspaceEmbedKeys).where(condition).limit(1);
    return entry ?? undefined;
  }

  async getWorkspaceEmbedKeyByPublicKey(publicKey: string): Promise<WorkspaceEmbedKey | undefined> {
    const normalized = publicKey.trim();
    if (!normalized) {
      return undefined;
    }

    const [entry] = await this.db
      .select()
      .from(workspaceEmbedKeys)
      .where(eq(workspaceEmbedKeys.publicKey, normalized))
      .limit(1);

    return entry ?? undefined;
  }

  async listWorkspaceEmbedKeyDomains(
    embedKeyId: string,
    workspaceId?: string,
  ): Promise<WorkspaceEmbedKeyDomain[]> {
    const conditions: SQL[] = [eq(workspaceEmbedKeyDomains.embedKeyId, embedKeyId)];

    if (workspaceId) {
      conditions.push(eq(workspaceEmbedKeyDomains.workspaceId, workspaceId));
    }

    return await this.db
      .select()
      .from(workspaceEmbedKeyDomains)
      .where(and(...conditions));
  }

  async addWorkspaceEmbedKeyDomain(
    embedKeyId: string,
    workspaceId: string,
    domain: string,
  ): Promise<WorkspaceEmbedKeyDomain | undefined> {
    const normalized = domain.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    const [existing] = await this.db
      .select()
      .from(workspaceEmbedKeyDomains)
      .where(
        and(
          eq(workspaceEmbedKeyDomains.embedKeyId, embedKeyId),
          eq(workspaceEmbedKeyDomains.domain, normalized),
        ),
      )
      .limit(1);

    if (existing) {
      return existing;
    }

    try {
      const [created] = await this.db
        .insert(workspaceEmbedKeyDomains)
        .values({
          embedKeyId,
          workspaceId,
          domain: normalized,
        })
        .returning();

      return created ?? undefined;
    } catch (error) {
      swallowPgError(error, ["23505"]);
      const [created] = await this.db
        .select()
        .from(workspaceEmbedKeyDomains)
        .where(
          and(
            eq(workspaceEmbedKeyDomains.embedKeyId, embedKeyId),
            eq(workspaceEmbedKeyDomains.domain, normalized),
          ),
        )
        .limit(1);

      return created ?? undefined;
    }
  }

  async removeWorkspaceEmbedKeyDomain(
    embedKeyId: string,
    domainId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const result = await this.db
      .delete(workspaceEmbedKeyDomains)
      .where(
        and(
          eq(workspaceEmbedKeyDomains.id, domainId),
          eq(workspaceEmbedKeyDomains.embedKeyId, embedKeyId),
          eq(workspaceEmbedKeyDomains.workspaceId, workspaceId),
        ),
      );

    return (result.rowCount ?? 0) > 0;
  }

  async listAllWorkspaceEmbedDomains(): Promise<string[]> {
    const result = await this.db.execute(sql`
      SELECT DISTINCT lower("domain") AS domain
      FROM "workspace_embed_key_domains"
    `);

    const domains = new Set<string>();
    for (const row of result.rows) {
      const value = getRowString(row, "domain");
      if (value) {
        domains.add(value);
      }
    }

    return Array.from(domains);
  }

  async getKnowledgeBase(baseId: string): Promise<KnowledgeBaseRow | null> {
    const uuidExpression = await getUuidGenerationExpression();
    const randomHex32Expression = await getRandomHexExpression(32);

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "workspace_embed_keys" (
          "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
          "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
          "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
          "collection" text NOT NULL,
          "public_key" text NOT NULL UNIQUE DEFAULT ${randomHex32Expression},
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      swallowPgError(error, ["42P07"]);
    }

    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "workspace_embed_key_domains" (
          "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
          "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
          "embed_key_id" varchar NOT NULL REFERENCES "workspace_embed_keys"("id") ON DELETE CASCADE,
          "domain" text NOT NULL,
          "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      swallowPgError(error, ["42P07"]);
    }

    try {
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS workspace_embed_keys_workspace_collection_idx
          ON "workspace_embed_keys" ("workspace_id", "collection")
      `);
    } catch (error) {
      swallowPgError(error, ["42P07", "42710"]);
    }

    try {
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS workspace_embed_key_domains_unique_idx
          ON "workspace_embed_key_domains" ("embed_key_id", "domain")
      `);
    } catch (error) {
      swallowPgError(error, ["42P07", "42710"]);
    }

    try {
      await db.execute(sql`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS workspace_embed_key_domains_domain_idx
          ON "workspace_embed_key_domains" (lower("domain"))
      `);
    } catch (error) {
      swallowPgError(error, ["42P07", "42710", "55006"]);
    }

    await ensureKnowledgeBaseTables();

    const [row] = await this.db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, baseId))
      .limit(1);

    return row ?? null;
  }

  private resolveSectionTitle(
    metadata: Record<string, unknown> | null,
    sectionPath: string[] | null | undefined,
    fallback: string,
  ): string | null {
    const heading =
      typeof metadata?.heading === "string" && metadata.heading.trim().length > 0
        ? metadata.heading.trim()
        : typeof metadata?.Heading === "string" && metadata.Heading.trim().length > 0
          ? metadata.Heading.trim()
          : null;

    if (heading) {
      return heading;
    }

    if (sectionPath && sectionPath.length > 0) {
      const candidate = sectionPath[sectionPath.length - 1];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    if (fallback.trim().length > 0) {
      return fallback.trim();
    }

    return null;
  }

  async searchKnowledgeBaseSuggestions(
    baseId: string,
    query: string,
    limit: number,
  ): Promise<{ normalizedQuery: string; sections: KnowledgeChunkSearchEntry[] }> {
    await ensureKnowledgeBaseTables();

    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { normalizedQuery: "", sections: [] };
    }

    let normalizedQuery = cleanQuery;
    try {
      const normalized = await this.db.execute(sql`SELECT sanitized_chunk_text(${cleanQuery}) AS value`);
      const candidate = normalized.rows?.[0]?.value;
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        normalizedQuery = candidate.trim();
      }
    } catch (error) {
      console.warn("[storage] Не удалось нормализовать запрос через unaccent", error);
    }

    const effectiveLimit = Math.max(1, Math.min(limit, 10));

    const sectionsResult = await this.db.execute(sql`
      WITH search_input AS (
        SELECT
          ${cleanQuery}::text AS raw_query,
          sanitized_chunk_text(${cleanQuery})::text AS normalized_query
      )
      SELECT
        chunk.id AS chunk_id,
        chunk.document_id,
        node.id AS node_id,
        node.slug AS node_slug,
        node.title AS doc_title,
        COALESCE(chunk.metadata->>'heading', (chunk.section_path[array_length(chunk.section_path, 1)])) AS section_title,
        chunk.text,
        GREATEST(
          similarity(unaccent(COALESCE(chunk.metadata->>'heading', '')), search_input.normalized_query),
          similarity(unaccent(node.title), search_input.normalized_query)
        ) AS score
      FROM knowledge_document_chunks AS chunk
      INNER JOIN knowledge_document_chunk_sets AS chunk_set
        ON chunk_set.id = chunk.chunk_set_id AND chunk_set.is_latest = TRUE
      INNER JOIN knowledge_documents AS doc ON doc.id = chunk.document_id
      INNER JOIN knowledge_nodes AS node ON node.id = doc.node_id
      CROSS JOIN search_input
      WHERE doc.base_id = ${baseId}
        AND (
          unaccent(COALESCE(chunk.metadata->>'heading', '')) ILIKE search_input.normalized_query || '%'
          OR unaccent(node.title) ILIKE search_input.normalized_query || '%'
          OR similarity(unaccent(COALESCE(chunk.metadata->>'heading', '')), search_input.normalized_query) > 0.25
          OR similarity(unaccent(node.title), search_input.normalized_query) > 0.25
        )
      ORDER BY score DESC
      LIMIT ${effectiveLimit}
    `);

    let contentRows: Array<Record<string, unknown>> = [];
    try {
      const contentResult = await this.db.execute(sql`
        WITH search_input AS (
          SELECT
            ${cleanQuery}::text AS raw_query,
            websearch_to_tsquery('russian', sanitized_chunk_text(${cleanQuery})) AS ts_query
        ), ranked AS (
          SELECT
            chunk.id AS chunk_id,
            chunk.document_id,
            node.id AS node_id,
            node.slug AS node_slug,
            node.title AS doc_title,
            COALESCE(chunk.metadata->>'heading', (chunk.section_path[array_length(chunk.section_path, 1)])) AS section_title,
            chunk.text,
            ts_rank(chunk.text_tsv, search_input.ts_query) AS rank
          FROM knowledge_document_chunks AS chunk
          INNER JOIN knowledge_document_chunk_sets AS chunk_set
            ON chunk_set.id = chunk.chunk_set_id AND chunk_set.is_latest = TRUE
          INNER JOIN knowledge_documents AS doc ON doc.id = chunk.document_id
          INNER JOIN knowledge_nodes AS node ON node.id = doc.node_id
          CROSS JOIN search_input
          WHERE doc.base_id = ${baseId}
            AND search_input.ts_query IS NOT NULL
            AND chunk.text_tsv @@ search_input.ts_query
          ORDER BY rank DESC
          LIMIT ${effectiveLimit}
        )
        SELECT
          ranked.chunk_id,
          ranked.document_id,
          ranked.node_id,
          ranked.node_slug,
          ranked.doc_title,
          ranked.section_title,
          ranked.text,
          ranked.rank,
          ts_headline('russian', ranked.text, search_input.ts_query, 'MaxFragments=2, MinWords=5, MaxWords=20') AS snippet
        FROM ranked
        CROSS JOIN search_input
        ORDER BY ranked.rank DESC
      `);
      contentRows = (contentResult.rows ?? []) as Array<Record<string, unknown>>;
    } catch (error) {
      console.warn("[storage] Не удалось выполнить полнотекстовый поиск по чанкам базы знаний", error);
    }

    const combined = new Map<string, KnowledgeChunkSearchEntry>();

    for (const row of sectionsResult.rows ?? []) {
      const rowRecord = row as Record<string, unknown>;
      const chunkId = getRowString(rowRecord, "chunk_id").trim();
      if (!chunkId) {
        continue;
      }

      const docTitle = getRowString(rowRecord, "doc_title");
      const nodeIdValue = getRowString(rowRecord, "node_id");
      const nodeSlugValue = getRowString(rowRecord, "node_slug");
      const documentIdValue = getRowString(rowRecord, "document_id");

      const sectionTitleRaw = rowRecord.section_title;
      const resolvedTitle =
        typeof sectionTitleRaw === "string" && sectionTitleRaw.trim().length > 0
          ? sectionTitleRaw.trim()
          : docTitle;

      const text = getRowString(rowRecord, "text");

      const snippet = text.length > 320 ? `${text.slice(0, 320)}…` : text;
      const score = Number(rowRecord.score ?? 0) || 0;
      const documentId = documentIdValue.trim().length > 0 ? documentIdValue.trim() : documentIdValue;
      const nodeId = nodeIdValue.length > 0 ? nodeIdValue : null;
      const nodeSlug = nodeSlugValue.length > 0 ? nodeSlugValue : null;

      combined.set(chunkId, {
        chunkId,
        documentId,
        docTitle,
        sectionTitle: resolvedTitle,
        snippet,
        text,
        score,
        source: "sections",
        nodeId,
        nodeSlug,
      });
    }

    for (const row of contentRows) {
      const rowRecord = row as Record<string, unknown>;
      const chunkId = getRowString(rowRecord, "chunk_id").trim();
      if (!chunkId) {
        continue;
      }

      const docTitle = getRowString(rowRecord, "doc_title");
      const text = getRowString(rowRecord, "text");
      const nodeIdValue = getRowString(rowRecord, "node_id");
      const nodeSlugValue = getRowString(rowRecord, "node_slug");
      const documentIdValue = getRowString(rowRecord, "document_id");

      const snippetValue = (() => {
        const snippet = getRowString(rowRecord, "snippet");
        if (snippet) {
          return snippet;
        }

        return text.length > 320
          ? `${text.slice(0, 320)}…`
          : text;
      })();

      const sectionTitleRaw = rowRecord.section_title;
      const resolvedTitle =
        typeof sectionTitleRaw === "string" && sectionTitleRaw.trim().length > 0
          ? sectionTitleRaw.trim()
          : docTitle;

      const rank = Number(rowRecord.rank ?? 0) || 0;
      const existing = combined.get(chunkId);
      const documentId = documentIdValue.trim().length > 0 ? documentIdValue.trim() : documentIdValue;
      const nodeId = nodeIdValue.length > 0 ? nodeIdValue : null;
      const nodeSlug = nodeSlugValue.length > 0 ? nodeSlugValue : null;

      if (!existing || rank > existing.score) {
        combined.set(chunkId, {
          chunkId,
          documentId,
          docTitle,
          sectionTitle: resolvedTitle,
          snippet: snippetValue,
          text,
          score: rank,
          source: "content",
          nodeId: nodeId ?? existing?.nodeId ?? null,
          nodeSlug: nodeSlug ?? existing?.nodeSlug ?? null,
        });
      }
    }

    const sections = Array.from(combined.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { normalizedQuery, sections };
  }

  async recordKnowledgeBaseRagRequest(entry: {
    workspaceId: string;
    knowledgeBaseId: string;
    topK: number | null;
    bm25Weight: number | null;
    bm25Limit: number | null;
    vectorWeight: number | null;
    vectorLimit: number | null;
    embeddingProviderId: string | null;
    collection: string | null;
  }): Promise<void> {
    await ensureKnowledgeBaseRagRequestsTable();

    const sanitizedCollection = entry.collection?.trim() ?? null;

    await this.db.insert(knowledgeBaseRagRequests).values({
      workspaceId: entry.workspaceId,
      knowledgeBaseId: entry.knowledgeBaseId,
      topK: entry.topK ?? null,
      bm25Weight: entry.bm25Weight ?? null,
      bm25Limit: entry.bm25Limit ?? null,
      vectorWeight: entry.vectorWeight ?? null,
      vectorLimit: entry.vectorLimit ?? null,
      embeddingProviderId: entry.embeddingProviderId ?? null,
      collection: sanitizedCollection && sanitizedCollection.length > 0 ? sanitizedCollection : null,
    });
  }

  async recordKnowledgeBaseAskAiRun(entry: KnowledgeBaseAskAiRunRecordInput): Promise<void> {
    await ensureKnowledgeBaseAskAiRunsTable();

    const sanitizedCollection = entry.vectorCollection?.trim() ?? null;
    const startedAt = entry.startedAt ? toIsoTimestamp(entry.startedAt) : null;
    const startedAtDate = startedAt ? new Date(startedAt) : null;

    await this.db.insert(knowledgeBaseAskAiRuns).values({
      workspaceId: entry.workspaceId,
      knowledgeBaseId: entry.knowledgeBaseId,
      prompt: entry.prompt,
      normalizedQuery: entry.normalizedQuery ?? null,
      status: entry.status,
      errorMessage: entry.errorMessage ?? null,
      topK: entry.topK ?? null,
      bm25Weight: entry.bm25Weight ?? null,
      bm25Limit: entry.bm25Limit ?? null,
      vectorWeight: entry.vectorWeight ?? null,
      vectorLimit: entry.vectorLimit ?? null,
      vectorCollection: sanitizedCollection && sanitizedCollection.length > 0 ? sanitizedCollection : null,
      embeddingProviderId: entry.embeddingProviderId ?? null,
      llmProviderId: entry.llmProviderId ?? null,
      llmModel: entry.llmModel ?? null,
      bm25ResultCount: entry.bm25ResultCount ?? null,
      vectorResultCount: entry.vectorResultCount ?? null,
      vectorDocumentCount: entry.vectorDocumentCount ?? null,
      combinedResultCount: entry.combinedResultCount ?? null,
      embeddingTokens: entry.embeddingTokens ?? null,
      llmTokens: entry.llmTokens ?? null,
      totalTokens: entry.totalTokens ?? null,
      retrievalDurationMs: entry.retrievalDurationMs ?? null,
      bm25DurationMs: entry.bm25DurationMs ?? null,
      vectorDurationMs: entry.vectorDurationMs ?? null,
      llmDurationMs: entry.llmDurationMs ?? null,
      totalDurationMs: entry.totalDurationMs ?? null,
      startedAt: startedAtDate,
      pipelineLog: entry.pipelineLog && entry.pipelineLog.length > 0 ? entry.pipelineLog : null,
    });
  }

  async listKnowledgeBaseAskAiRuns(
    workspaceId: string,
    knowledgeBaseId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ items: KnowledgeBaseAskAiRunSummary[]; hasMore: boolean; nextOffset: number | null }> {
    await ensureKnowledgeBaseAskAiRunsTable();

    const limit = Math.max(1, Math.min(options?.limit ?? 20, 100));
    const offset = Math.max(0, options?.offset ?? 0);

    const rows = (await this.db
      .select()
      .from(knowledgeBaseAskAiRuns)
      .where(
        and(
          eq(knowledgeBaseAskAiRuns.workspaceId, workspaceId),
          eq(knowledgeBaseAskAiRuns.knowledgeBaseId, knowledgeBaseId),
        ),
      )
      .orderBy(desc(knowledgeBaseAskAiRuns.createdAt), desc(knowledgeBaseAskAiRuns.id))
      .limit(limit + 1)
      .offset(offset)) as KnowledgeBaseAskAiRun[];

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => this.buildAskAiRunSummary(row));

    return {
      items,
      hasMore,
      nextOffset: hasMore ? offset + limit : null,
    };
  }

  async getKnowledgeBaseAskAiRun(
    runId: string,
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseAskAiRunDetail | null> {
    await ensureKnowledgeBaseAskAiRunsTable();

    const [row] = (await this.db
      .select()
      .from(knowledgeBaseAskAiRuns)
      .where(
        and(
          eq(knowledgeBaseAskAiRuns.id, runId),
          eq(knowledgeBaseAskAiRuns.workspaceId, workspaceId),
          eq(knowledgeBaseAskAiRuns.knowledgeBaseId, knowledgeBaseId),
        ),
      )
      .limit(1)) as KnowledgeBaseAskAiRun[];

    if (!row) {
      return null;
    }

    return this.buildAskAiRunDetail(row);
  }

  async getLatestKnowledgeBaseRagConfig(
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseRagConfig | null> {
    await ensureKnowledgeBaseRagRequestsTable();

    const [latest] = await this.db
      .select()
      .from(knowledgeBaseRagRequests)
      .where(
        and(
          eq(knowledgeBaseRagRequests.workspaceId, workspaceId),
          eq(knowledgeBaseRagRequests.knowledgeBaseId, knowledgeBaseId),
        ),
      )
      .orderBy(desc(knowledgeBaseRagRequests.createdAt))
      .limit(1);

    let collection: string | null = latest?.collection ?? null;

    if (!collection) {
      const [embedKey] = await this.db
        .select({ collection: workspaceEmbedKeys.collection })
        .from(workspaceEmbedKeys)
        .where(
          and(
            eq(workspaceEmbedKeys.workspaceId, workspaceId),
            eq(workspaceEmbedKeys.knowledgeBaseId, knowledgeBaseId),
          ),
        )
        .orderBy(desc(workspaceEmbedKeys.createdAt))
        .limit(1);

      if (embedKey?.collection) {
        collection = embedKey.collection;
      }
    }

    if (!latest && !collection) {
      return {
        workspaceId,
        knowledgeBaseId,
        topK: null,
        bm25: null,
        vector: null,
        recordedAt: null,
      };
    }

    const recordedAt = (() => {
      const value = latest?.createdAt;
      if (!value) {
        return null;
      }

      if (value instanceof Date) {
        return value.toISOString();
      }

      try {
        const parsed = new Date(value as string);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
      } catch {
        return null;
      }
    })();

    const bm25Config =
      latest && (latest.bm25Weight !== null || latest.bm25Limit !== null)
        ? {
            weight: latest.bm25Weight ?? null,
            limit: latest.bm25Limit ?? null,
          }
        : null;

    const vectorConfig =
      latest &&
      (latest.vectorWeight !== null ||
        latest.vectorLimit !== null ||
        latest.embeddingProviderId !== null ||
        (collection && collection.length > 0))
        ? {
            weight: latest.vectorWeight ?? null,
            limit: latest.vectorLimit ?? null,
            embeddingProviderId: latest.embeddingProviderId ?? null,
            collection: collection ?? null,
          }
        : collection
          ? {
              weight: null,
              limit: null,
              embeddingProviderId: null,
              collection,
            }
          : null;

    return {
      workspaceId,
      knowledgeBaseId,
      topK: latest?.topK ?? null,
      bm25: bm25Config,
      vector: vectorConfig,
      recordedAt,
    };
  }

  async getKnowledgeBaseSearchSettings(
    workspaceId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseSearchSettingsRow | null> {
    await ensureKnowledgeBaseSearchSettingsTable();

    const [record] = await this.db
      .select()
      .from(knowledgeBaseSearchSettings)
      .where(
        and(
          eq(knowledgeBaseSearchSettings.workspaceId, workspaceId),
          eq(knowledgeBaseSearchSettings.knowledgeBaseId, knowledgeBaseId),
        ),
      )
      .limit(1);

    return record ?? null;
  }

  async upsertKnowledgeBaseSearchSettings(
    workspaceId: string,
    knowledgeBaseId: string,
    settings: {
      chunkSettings: KnowledgeBaseChunkSearchSettings;
      ragSettings: KnowledgeBaseRagSearchSettings;
    },
  ): Promise<KnowledgeBaseSearchSettingsRow> {
    await ensureKnowledgeBaseSearchSettingsTable();

    const chunkPayload = settings.chunkSettings ?? null;
    const ragPayload = settings.ragSettings ?? null;

    const [record] = await this.db
      .insert(knowledgeBaseSearchSettings)
      .values({
        workspaceId,
        knowledgeBaseId,
        chunkSettings: chunkPayload,
        ragSettings: ragPayload,
      })
      .onConflictDoUpdate({
        target: [
          knowledgeBaseSearchSettings.workspaceId,
          knowledgeBaseSearchSettings.knowledgeBaseId,
        ],
        set: {
          chunkSettings: chunkPayload,
          ragSettings: ragPayload,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();

    if (!record) {
      throw new Error("Не удалось сохранить настройки поиска базы знаний");
    }

    return record;
  }

  async getKnowledgeChunksByIds(
    baseId: string,
    chunkIds: string[],
  ): Promise<Array<{
    chunkId: string;
    documentId: string;
    docTitle: string;
    sectionTitle: string | null;
    text: string;
    nodeId: string | null;
    nodeSlug: string | null;
  }>> {
    if (chunkIds.length === 0) {
      return [];
    }

    await ensureKnowledgeBaseTables();

    const rows = await this.db
      .select({
        chunkId: knowledgeDocumentChunkItems.id,
        documentId: knowledgeDocumentChunkItems.documentId,
        text: knowledgeDocumentChunkItems.text,
        metadata: knowledgeDocumentChunkItems.metadata,
        sectionPath: knowledgeDocumentChunkItems.sectionPath,
        docTitle: knowledgeNodes.title,
        nodeId: knowledgeNodes.id,
        nodeSlug: knowledgeNodes.slug,
      })
      .from(knowledgeDocumentChunkItems)
      .innerJoin(
        knowledgeDocumentChunkSets,
        and(
          eq(knowledgeDocumentChunkSets.id, knowledgeDocumentChunkItems.chunkSetId),
          eq(knowledgeDocumentChunkSets.isLatest, true),
        ),
      )
      .innerJoin(
        knowledgeDocuments,
        eq(knowledgeDocuments.id, knowledgeDocumentChunkItems.documentId),
      )
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, knowledgeDocuments.nodeId))
      .where(
        and(
          eq(knowledgeDocuments.baseId, baseId),
          inArray(knowledgeDocumentChunkItems.id, chunkIds),
        ),
      );

    return rows.map((row: typeof rows[number]) => {
      const metadata = row.metadata as Record<string, unknown> | null;
      const sectionTitle = this.resolveSectionTitle(metadata ?? null, row.sectionPath, row.docTitle ?? "");
      const nodeIdValue = typeof row.nodeId === "string" ? row.nodeId.trim() : "";
      const nodeId = nodeIdValue.length > 0 ? nodeIdValue : null;
      const nodeSlugValue = typeof row.nodeSlug === "string" ? row.nodeSlug.trim() : "";
      const nodeSlug = nodeSlugValue.length > 0 ? nodeSlugValue : null;

      return {
        chunkId: row.chunkId,
        documentId: row.documentId,
        docTitle: row.docTitle ?? "",
        sectionTitle,
        text: row.text ?? "",
        nodeId,
        nodeSlug,
      };
    });
  }

  async getKnowledgeChunksByVectorRecords(
    baseId: string,
    recordIds: string[],
  ): Promise<Array<{
    chunkId: string;
    documentId: string;
    docTitle: string;
    sectionTitle: string | null;
    text: string;
    vectorRecordId: string | null;
    nodeId: string | null;
    nodeSlug: string | null;
  }>> {
    if (recordIds.length === 0) {
      return [];
    }

    await ensureKnowledgeBaseTables();

    const rows = await this.db
      .select({
        chunkId: knowledgeDocumentChunkItems.id,
        documentId: knowledgeDocumentChunkItems.documentId,
        text: knowledgeDocumentChunkItems.text,
        metadata: knowledgeDocumentChunkItems.metadata,
        sectionPath: knowledgeDocumentChunkItems.sectionPath,
        docTitle: knowledgeNodes.title,
        vectorRecordId: knowledgeDocumentChunkItems.vectorRecordId,
        nodeId: knowledgeNodes.id,
        nodeSlug: knowledgeNodes.slug,
      })
      .from(knowledgeDocumentChunkItems)
      .innerJoin(
        knowledgeDocumentChunkSets,
        and(
          eq(knowledgeDocumentChunkSets.id, knowledgeDocumentChunkItems.chunkSetId),
          eq(knowledgeDocumentChunkSets.isLatest, true),
        ),
      )
      .innerJoin(
        knowledgeDocuments,
        eq(knowledgeDocuments.id, knowledgeDocumentChunkItems.documentId),
      )
      .innerJoin(knowledgeNodes, eq(knowledgeNodes.id, knowledgeDocuments.nodeId))
      .where(
        and(
          eq(knowledgeDocuments.baseId, baseId),
          inArray(knowledgeDocumentChunkItems.vectorRecordId, recordIds),
        ),
      );

    return rows.map((row: typeof rows[number]) => {
      const metadata = row.metadata as Record<string, unknown> | null;
      const sectionTitle = this.resolveSectionTitle(metadata ?? null, row.sectionPath, row.docTitle ?? "");
      const nodeIdValue = typeof row.nodeId === "string" ? row.nodeId.trim() : "";
      const nodeId = nodeIdValue.length > 0 ? nodeIdValue : null;
      const nodeSlugValue = typeof row.nodeSlug === "string" ? row.nodeSlug.trim() : "";
      const nodeSlug = nodeSlugValue.length > 0 ? nodeSlugValue : null;

      return {
        chunkId: row.chunkId,
        documentId: row.documentId,
        docTitle: row.docTitle ?? "",
        sectionTitle,
        text: row.text ?? "",
        vectorRecordId: row.vectorRecordId ?? null,
        nodeId,
        nodeSlug,
      };
    });
  }

  async getDatabaseHealthInfo() {
    let pg_trgm_available = false;
    let unaccent_available = false;

    try {
      await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
      const trgmCheck = await this.db.execute(sql`
        SELECT EXISTS(
          SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
        ) as available
      `);
      pg_trgm_available = Boolean(trgmCheck.rows[0]?.available) || false;
    } catch (error) {
      console.warn('pg_trgm extension not available:', error);
    }

    try {
      await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
      const unaccentCheck = await this.db.execute(sql`
        SELECT EXISTS(
          SELECT 1 FROM pg_extension WHERE extname = 'unaccent'
        ) as available
      `);
      unaccent_available = Boolean(unaccentCheck.rows[0]?.available) || false;
    } catch (error) {
      console.warn('unaccent extension not available:', error);
    }

    const searchVectorCheck = await this.db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'pages' AND column_name = 'search_vector_combined'
      ) as exists
    `);

    const relevanceCheck = await this.db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'search_index' AND column_name = 'relevance'
      ) as exists
    `);

    return {
      schema_name: 'public',
      database_name: 'neondb',
      pg_trgm_available,
      unaccent_available,
      search_vector_columns_exist: Boolean(searchVectorCheck.rows[0]?.exists) || false,
      relevance_column_exists: Boolean(relevanceCheck.rows[0]?.exists) || false,
    };
  }

  async listEmbeddingProviders(workspaceId?: string): Promise<EmbeddingProvider[]> {
    await ensureEmbeddingProvidersTable();
    let query = this.db.select().from(embeddingProviders);
    if (workspaceId) {
      query = query.where(
        or(
          eq(embeddingProviders.workspaceId, workspaceId),
          eq(embeddingProviders.isGlobal, true)
        )
      );
    }
    return await query.orderBy(desc(embeddingProviders.createdAt));
  }

  async getEmbeddingProvider(id: string, workspaceId?: string): Promise<EmbeddingProvider | undefined> {
    await ensureEmbeddingProvidersTable();
    const condition = workspaceId
      ? and(
          eq(embeddingProviders.id, id),
          or(eq(embeddingProviders.workspaceId, workspaceId), eq(embeddingProviders.isGlobal, true)),
        )
      : eq(embeddingProviders.id, id);
    const [provider] = await this.db.select().from(embeddingProviders).where(condition);
    return provider ?? undefined;
  }

  async createEmbeddingProvider(provider: EmbeddingProviderInsert): Promise<EmbeddingProvider> {
    await ensureEmbeddingProvidersTable();
    const [created] = await this.db.insert(embeddingProviders).values(provider).returning();
    return created;
  }

  async updateEmbeddingProvider(
    id: string,
    updates: Partial<EmbeddingProviderInsert>,
    workspaceId?: string,
  ): Promise<EmbeddingProvider | undefined> {
    await ensureEmbeddingProvidersTable();
    const sanitizedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ) as Partial<EmbeddingProviderInsert>;

    if (Object.keys(sanitizedUpdates).length === 0) {
      return await this.getEmbeddingProvider(id, workspaceId);
    }

    const condition = workspaceId
      ? and(eq(embeddingProviders.id, id), eq(embeddingProviders.workspaceId, workspaceId))
      : eq(embeddingProviders.id, id);

    const [updated] = await this.db
      .update(embeddingProviders)
      .set({ ...sanitizedUpdates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(condition)
      .returning();

    return updated ?? undefined;
  }

  async deleteEmbeddingProvider(id: string, workspaceId?: string): Promise<boolean> {
    await ensureEmbeddingProvidersTable();
    const condition = workspaceId
      ? and(eq(embeddingProviders.id, id), eq(embeddingProviders.workspaceId, workspaceId))
      : eq(embeddingProviders.id, id);
    const deleted = await this.db
      .delete(embeddingProviders)
      .where(condition)
      .returning({ id: embeddingProviders.id });

    return deleted.length > 0;
  }

  async listLlmProviders(workspaceId?: string): Promise<LlmProvider[]> {
    await ensureLlmProvidersTable();
    let query = this.db.select().from(llmProviders);
    if (workspaceId) {
      query = query.where(
        or(
          eq(llmProviders.workspaceId, workspaceId),
          eq(llmProviders.isGlobal, true)
        )
      );
    }
    return await query.orderBy(desc(llmProviders.createdAt));
  }

  async getLlmProvider(id: string, workspaceId?: string): Promise<LlmProvider | undefined> {
    await ensureLlmProvidersTable();
    const withWorkspace = workspaceId
      ? await this.db
          .select()
          .from(llmProviders)
          .where(
            and(
              eq(llmProviders.id, id),
              or(eq(llmProviders.workspaceId, workspaceId), eq(llmProviders.isGlobal, true)),
            ),
          )
          .limit(1)
      : [];

    if (withWorkspace.length > 0) {
      return withWorkspace[0] ?? undefined;
    }

    // Fallback: попробуем найти провайдера по id без учёта workspace (например, если id выбран из глобального каталога)
    const [any] = await this.db.select().from(llmProviders).where(eq(llmProviders.id, id)).limit(1);
    return any ?? undefined;
  }

  async createLlmProvider(provider: LlmProviderInsert): Promise<LlmProvider> {
    await ensureLlmProvidersTable();
    const [created] = await this.db.insert(llmProviders).values(provider).returning();
    return created;
  }

  async updateLlmProvider(
    id: string,
    updates: Partial<LlmProviderInsert>,
    workspaceId?: string,
  ): Promise<LlmProvider | undefined> {
    await ensureLlmProvidersTable();
    const sanitizedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ) as Partial<LlmProviderInsert>;

    const jsonFields = new Set<keyof LlmProviderInsert>([
      "availableModels",
      "requestHeaders",
      "requestConfig",
      "responseConfig",
    ]);

    const normalizedUpdates = Object.fromEntries(
      Object.entries(sanitizedUpdates).map(([key, value]) => {
        if (jsonFields.has(key as keyof LlmProviderInsert)) {
          const fallback = key === "availableModels" ? [] : {};
          const payload = value ?? fallback;
          return [key, sql`${JSON.stringify(payload)}::jsonb`];
        }

        return [key, value];
      }),
    ) as Partial<LlmProviderInsert>;

    if (Object.keys(normalizedUpdates).length === 0) {
      return await this.getLlmProvider(id, workspaceId);
    }

    const condition = workspaceId
      ? and(eq(llmProviders.id, id), eq(llmProviders.workspaceId, workspaceId))
      : eq(llmProviders.id, id);

    const [updated] = await this.db
      .update(llmProviders)
      .set({ ...normalizedUpdates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(condition)
      .returning();

    return updated ?? undefined;
  }

  async deleteLlmProvider(id: string, workspaceId?: string): Promise<boolean> {
    await ensureLlmProvidersTable();
    const condition = workspaceId
      ? and(eq(llmProviders.id, id), eq(llmProviders.workspaceId, workspaceId))
      : eq(llmProviders.id, id);
    const deleted = await this.db
      .delete(llmProviders)
      .where(condition)
      .returning({ id: llmProviders.id });

    return deleted.length > 0;
  }

  async listSpeechProviders(): Promise<SpeechProvider[]> {
    await ensureSpeechProvidersTables();
    return await this.db.select().from(speechProviders).orderBy(asc(speechProviders.id));
  }

  async getSpeechProvider(id: string): Promise<SpeechProvider | undefined> {
    await ensureSpeechProvidersTables();
    const [provider] = await this.db
      .select()
      .from(speechProviders)
      .where(eq(speechProviders.id, id))
      .limit(1);
    return provider ?? undefined;
  }

  async updateSpeechProvider(
    id: string,
    updates: Partial<SpeechProviderInsert>,
  ): Promise<SpeechProvider | undefined> {
    await ensureSpeechProvidersTables();
    const sanitizedEntries = Object.entries(updates ?? {}).filter(([, value]) => value !== undefined);
    if (sanitizedEntries.length === 0) {
      return await this.getSpeechProvider(id);
    }

    const normalized = Object.fromEntries(
      sanitizedEntries.map(([key, value]) => {
        if (key === "configJson") {
          const payload = value ?? {};
          return [key, sql`${JSON.stringify(payload)}::jsonb`];
        }
        return [key, value];
      }),
    ) as Partial<SpeechProviderInsert>;

    const [updated] = await this.db
      .update(speechProviders)
      .set({ ...normalized, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(speechProviders.id, id))
      .returning();

    return updated ?? undefined;
  }

  async getSpeechProviderSecrets(providerId: string): Promise<SpeechProviderSecret[]> {
    await ensureSpeechProvidersTables();
    return await this.db
      .select()
      .from(speechProviderSecrets)
      .where(eq(speechProviderSecrets.providerId, providerId));
  }

  async upsertSpeechProviderSecret(providerId: string, secretKey: string, secretValue: string): Promise<void> {
    await ensureSpeechProvidersTables();
    const trimmedValue = secretValue ?? "";
    await this.db
      .insert(speechProviderSecrets)
      .values({ providerId, secretKey, secretValue: trimmedValue })
      .onConflictDoUpdate({
        target: [speechProviderSecrets.providerId, speechProviderSecrets.secretKey],
        set: { secretValue: trimmedValue, updatedAt: sql`CURRENT_TIMESTAMP` },
      });
  }

  async deleteSpeechProviderSecret(providerId: string, secretKey: string): Promise<void> {
    await ensureSpeechProvidersTables();
    await this.db
      .delete(speechProviderSecrets)
      .where(and(eq(speechProviderSecrets.providerId, providerId), eq(speechProviderSecrets.secretKey, secretKey)));
  }

  async createFile(file: FileInsert): Promise<File> {
    await ensureFilesTable();
    const [created] = await this.db.insert(files).values(file).returning();
    if (!created) {
      throw new Error("Failed to create file record");
    }
    return created;
  }

  async getFile(id: string, workspaceId?: string): Promise<File | undefined> {
    await ensureFilesTable();
    const condition = workspaceId
      ? and(eq(files.id, id), eq(files.workspaceId, workspaceId))
      : eq(files.id, id);
    const [row] = await this.db.select().from(files).where(condition).limit(1);
    return row ?? undefined;
  }

  async updateFile(id: string, updates: Partial<FileInsert>): Promise<File | undefined> {
    await ensureFilesTable();
    const sanitized = Object.fromEntries(
      Object.entries(updates ?? {}).filter(([, value]) => value !== undefined),
    ) as Partial<FileInsert>;
    if (Object.keys(sanitized).length === 0) {
      return await this.getFile(id);
    }
    const [updated] = await this.db
      .update(files)
      .set({ ...sanitized, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(files.id, id))
      .returning();
    return updated ?? undefined;
  }

  async enqueueFileEvent(event: FileEventOutboxInsert): Promise<FileEventOutbox> {
    await ensureFileEventOutboxTable();
    const [created] = await this.db
      .insert(fileEventOutbox)
      .values(event)
      .onConflictDoNothing({
        target: [fileEventOutbox.fileId, fileEventOutbox.action],
      })
      .returning();
    if (created) return created as FileEventOutbox;
    const rows = await this.db
      .select()
      .from(fileEventOutbox)
      .where(and(eq(fileEventOutbox.fileId, event.fileId), eq(fileEventOutbox.action, event.action)))
      .limit(1);
    if (!rows[0]) {
      throw new Error("Failed to enqueue file event");
    }
    return rows[0] as FileEventOutbox;
  }

  async claimNextFileEventOutbox(now: Date = new Date()): Promise<FileEventOutbox | null> {
    await ensureFileEventOutboxTable();
    const result = await this.db.execute(sql`
      UPDATE "file_event_outbox" AS jobs
      SET
        "status" = 'retrying',
        "attempts" = jobs."attempts" + 1,
        "updated_at" = ${now}
      WHERE jobs."id" = (
        SELECT id
        FROM "file_event_outbox"
        WHERE "status" IN ('queued','retrying')
          AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
        ORDER BY "next_attempt_at" NULLS FIRST, "created_at"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
    const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
    return row ? (row as unknown as FileEventOutbox) : null;
  }

  async markFileEventSent(id: string): Promise<void> {
    await ensureFileEventOutboxTable();
    const now = new Date();
    await this.db
      .update(fileEventOutbox)
      .set({ status: "sent", nextAttemptAt: null, lastError: null, updatedAt: now })
      .where(eq(fileEventOutbox.id, id));
  }

  async rescheduleFileEvent(id: string, nextAttemptAt: Date, error?: string | null): Promise<void> {
    await ensureFileEventOutboxTable();
    const now = new Date();
    await this.db
      .update(fileEventOutbox)
      .set({
        status: "retrying",
        nextAttemptAt,
        lastError: error ?? null,
        updatedAt: now,
      })
      .where(eq(fileEventOutbox.id, id));
  }

  async failFileEvent(id: string, error?: string | null): Promise<void> {
    await ensureFileEventOutboxTable();
    const now = new Date();
    await this.db
      .update(fileEventOutbox)
      .set({
        status: "failed",
        nextAttemptAt: null,
        lastError: error ?? null,
        updatedAt: now,
      })
      .where(eq(fileEventOutbox.id, id));
  }

  async listFileStorageProviders(options: {
    limit?: number;
    offset?: number;
    activeOnly?: boolean;
  } = {}): Promise<{ items: FileStorageProvider[]; total: number; limit: number; offset: number }> {
    await ensureFileStorageProvidersTable();
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const whereClause = options.activeOnly ? eq(fileStorageProviders.isActive, true) : undefined;

    const [countRow] = await this.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(fileStorageProviders)
      .where(whereClause ?? sql`true`);

    const items = await this.db
      .select()
      .from(fileStorageProviders)
      .where(whereClause ?? sql`true`)
      .orderBy(desc(fileStorageProviders.updatedAt))
      .limit(limit)
      .offset(offset);

    return {
      items,
      total: Number(countRow?.count ?? 0),
      limit,
      offset,
    };
  }

  async getFileStorageProvider(id: string): Promise<FileStorageProvider | undefined> {
    await ensureFileStorageProvidersTable();
    const [provider] = await this.db
      .select()
      .from(fileStorageProviders)
      .where(eq(fileStorageProviders.id, id))
      .limit(1);
    return provider ?? undefined;
  }

  async createFileStorageProvider(provider: FileStorageProviderInsert): Promise<FileStorageProvider> {
    await ensureFileStorageProvidersTable();
    const [created] = await this.db
      .insert(fileStorageProviders)
      .values(provider)
      .returning();
    return created;
  }

  async updateFileStorageProvider(
    id: string,
    updates: Partial<FileStorageProviderInsert>,
  ): Promise<FileStorageProvider | undefined> {
    await ensureFileStorageProvidersTable();
    const sanitizedEntries = Object.entries(updates ?? {}).filter(([, value]) => value !== undefined);
    if (sanitizedEntries.length === 0) {
      return await this.getFileStorageProvider(id);
    }

    const [updated] = await this.db
      .update(fileStorageProviders)
      .set({
        ...Object.fromEntries(sanitizedEntries),
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(fileStorageProviders.id, id))
      .returning();

    return updated ?? undefined;
  }

  async deleteFileStorageProvider(id: string): Promise<boolean> {
    await ensureFileStorageProvidersTable();
    const deleted = await this.db.delete(fileStorageProviders).where(eq(fileStorageProviders.id, id)).returning({
      id: fileStorageProviders.id,
    });
    return deleted.length > 0;
  }

  async getWorkspaceDefaultFileStorageProvider(workspaceId: string): Promise<FileStorageProvider | null> {
    await ensureWorkspacesTable();
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace?.defaultFileStorageProviderId) {
      return null;
    }
    const provider = await this.getFileStorageProvider(workspace.defaultFileStorageProviderId);
    return provider ?? null;
  }

  async setWorkspaceDefaultFileStorageProvider(workspaceId: string, providerId: string | null): Promise<void> {
    await ensureWorkspacesTable();
    await this.db
      .update(workspaces)
      .set({
        defaultFileStorageProviderId: providerId ?? null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(workspaces.id, workspaceId));
  }

  private buildWorkspaceMembershipCacheKey(userId: string, workspaceId: string): string {
    return `${userId}::${workspaceId}`;
  }

  private normalizeWorkspaceMembership(member: WorkspaceMember | null | undefined): WorkspaceMembership | null {
    if (!member) {
      return null;
    }
    // Статусов в таблице пока нет — считаем активным по умолчанию.
    return { ...member, status: "active" };
  }

  async getWorkspaceMembership(userId: string, workspaceId: string): Promise<WorkspaceMembership | null> {
    const cacheKey = this.buildWorkspaceMembershipCacheKey(userId, workspaceId);
    const now = Date.now();
    const cached = this.workspaceMembershipCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    try {
      await ensureWorkspaceMembersTable();
      const [member] = await this.db
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)))
        .limit(1);

      const normalized = this.normalizeWorkspaceMembership(member);
      this.workspaceMembershipCache.set(cacheKey, {
        value: normalized,
        expiresAt: now + WORKSPACE_MEMBERSHIP_CACHE_TTL_MS,
      });
      return normalized;
    } catch (error) {
      console.warn(
        `[storage] Failed to fetch workspace membership for user=${userId} workspace=${workspaceId}:`,
        error,
      );
      return null;
    }
  }

  async getWorkspaceMember(userId: string, workspaceId: string): Promise<WorkspaceMembership | undefined> {
    const membership = await this.getWorkspaceMembership(userId, workspaceId);
    return membership ?? undefined;
  }

  invalidateWorkspaceMembershipCache(userId?: string, workspaceId?: string): void {
    if (!userId && !workspaceId) {
      this.workspaceMembershipCache.clear();
      return;
    }

    for (const key of this.workspaceMembershipCache.keys()) {
      const [uid, wid] = key.split("::");
      if ((userId ? uid === userId : true) && (workspaceId ? wid === workspaceId : true)) {
        this.workspaceMembershipCache.delete(key);
      }
    }
  }

  async listChatSessions(
    workspaceId: string,
    userId: string,
    searchQuery?: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<Array<ChatSession & { skillName: string | null; skillIsSystem: boolean }>> {
    await ensureChatTables();

    let condition = and(
      eq(chatSessions.workspaceId, workspaceId),
      eq(chatSessions.userId, userId),
      isNull(chatSessions.deletedAt),
    );

    if (!options.includeArchived) {
      condition = and(condition, eq(chatSessions.status, "active"));
    }

    const trimmedQuery = searchQuery?.trim();
    if (trimmedQuery) {
      condition = and(condition, ilike(chatSessions.title, `%${trimmedQuery}%`));
    }

    const rows = await this.db
      .select({
        chat: chatSessions,
        skillName: skills.name,
        skillIsSystem: skills.isSystem,
        skillStatus: skills.status,
        skillSystemKey: skills.systemKey,
      })
      .from(chatSessions)
      .innerJoin(skills, eq(chatSessions.skillId, skills.id))
      .where(condition)
      .orderBy(desc(chatSessions.updatedAt));

    return rows.map(
      ({
        chat,
        skillName,
        skillIsSystem,
        skillSystemKey,
        skillStatus,
      }: {
        chat: ChatSession;
        skillName: string | null;
        skillIsSystem: boolean | null;
        skillStatus: string | null;
        skillSystemKey: string | null;
      }) => ({
        ...chat,
        skillName: skillName ?? null,
        skillIsSystem: Boolean(skillIsSystem),
        skillStatus: skillStatus ?? null,
        skillSystemKey: skillSystemKey ?? null,
      }),
    );
  }

  async getChatSessionById(
    chatId: string,
  ): Promise<(
    ChatSession & { skillName: string | null; skillIsSystem: boolean; skillSystemKey: string | null; skillStatus: string | null }
  ) | null> {
    await ensureChatTables();
    const rows = await this.db
      .select({
        chat: chatSessions,
        skillName: skills.name,
        skillIsSystem: skills.isSystem,
        skillStatus: skills.status,
        skillSystemKey: skills.systemKey,
      })
      .from(chatSessions)
      .innerJoin(skills, eq(chatSessions.skillId, skills.id))
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)));

    if (rows.length === 0) {
      return null;
    }

    const { chat, skillName, skillIsSystem, skillSystemKey, skillStatus } = rows[0];
    return {
      ...chat,
      skillName: skillName ?? null,
      skillIsSystem: Boolean(skillIsSystem),
      skillStatus: skillStatus ?? null,
      skillSystemKey: skillSystemKey ?? null,
    };
  }

  async createChatSession(values: ChatSessionInsert): Promise<ChatSession> {
    await ensureChatTables();
    const [created] = await this.db.insert(chatSessions).values(values).returning();
    return created;
  }

  async updateChatSession(
    chatId: string,
    updates: Partial<
      Pick<
        ChatSessionInsert,
        | "title"
        | "currentAssistantActionType"
        | "currentAssistantActionText"
        | "currentAssistantActionTriggerMessageId"
        | "currentAssistantActionUpdatedAt"
      >
    >,
  ): Promise<ChatSession | null> {
    await ensureChatTables();
    if (!updates || Object.keys(updates).length === 0) {
      const current = await this.getChatSessionById(chatId);
      return current ?? null;
    }

    const [updated] = await this.db
      .update(chatSessions)
      .set({
        ...updates,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)))
      .returning();

    return updated ?? null;
  }

  async setChatAssistantAction(chatId: string, action: {
    type: AssistantActionType | null;
    text: string | null;
    triggerMessageId: string | null;
    updatedAt: Date | null;
  }): Promise<ChatSession | null> {
    await ensureChatTables();
    const [updated] = await this.db
      .update(chatSessions)
      .set({
        currentAssistantActionType: action.type,
        currentAssistantActionText: action.text,
        currentAssistantActionTriggerMessageId: action.triggerMessageId,
        currentAssistantActionUpdatedAt: action.updatedAt,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)))
      .returning();

    return updated ?? null;
  }

  async upsertBotActionState(values: {
    workspaceId: string;
    chatId: string;
    actionId: string;
    actionType: string;
    status: BotActionStatus;
    displayText?: string | null;
    payload?: Record<string, unknown> | null;
    // Optional: only update these fields if provided (for partial updates)
    updateOnly?: {
      status?: boolean;
      displayText?: boolean;
      payload?: boolean;
    };
  }): Promise<BotAction | null> {
    await ensureBotActionsTable();
    const now = sql`CURRENT_TIMESTAMP`;

    const payloadValue =
      values.payload && Object.keys(values.payload).length > 0 ? values.payload : null;

    const updateSet: Record<string, unknown> = {
      actionType: values.actionType,
      updatedAt: now,
    };

    // Only update status if explicitly allowed or if it's a new record
    if (!values.updateOnly || values.updateOnly.status !== false) {
      updateSet.status = values.status;
    }

    // Only update payload if explicitly allowed or if it's a new record
    if (!values.updateOnly || values.updateOnly.payload !== false) {
      updateSet.payload = payloadValue;
    }

    // Only update displayText if explicitly provided
    if (values.displayText !== undefined) {
      if (!values.updateOnly || values.updateOnly.displayText !== false) {
        updateSet.displayText = values.displayText ?? null;
      }
    }

    const insertValues: Record<string, unknown> = {
      workspaceId: values.workspaceId,
      chatId: values.chatId,
      actionId: values.actionId,
      actionType: values.actionType,
      status: values.status,
      payload: payloadValue,
      displayText: values.displayText ?? null,
    };

    const [inserted] = await this.db
      .insert(botActions)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [botActions.workspaceId, botActions.chatId, botActions.actionId],
        set: updateSet,
      })
      .returning();

    if (!inserted) {
      return null;
    }

    return mapBotAction(inserted);
  }

  async getBotActionByActionId(options: {
    workspaceId: string;
    chatId: string;
    actionId: string;
  }): Promise<BotAction | null> {
    await ensureBotActionsTable();
    const [row] = await this.db
      .select()
      .from(botActions)
      .where(
        and(
          eq(botActions.workspaceId, options.workspaceId),
          eq(botActions.chatId, options.chatId),
          eq(botActions.actionId, options.actionId),
        ),
      )
      .limit(1);

    return row ? mapBotAction(row) : null;
  }

  async listBotActionsByChat(options: {
    workspaceId: string;
    chatId: string;
    status?: BotActionStatus | null;
    limit?: number | null;
  }): Promise<BotAction[]> {
    await ensureBotActionsTable();
    const conditions: any[] = [
      eq(botActions.workspaceId, options.workspaceId),
      eq(botActions.chatId, options.chatId),
    ];
    if (options.status) {
      conditions.push(eq(botActions.status, options.status));
    }

    const query = this.db
      .select()
      .from(botActions)
      .where(and(...conditions))
      .orderBy(desc(botActions.updatedAt));

    if (options.limit && options.limit > 0) {
      (query as any).limit(options.limit);
    }

    const rows = await query;
    return rows.map(mapBotAction);
  }

  async expireStuckBotActions(cutoffDate: Date): Promise<BotAction[]> {
    await ensureBotActionsTable();
    const rows = await this.db
      .update(botActions)
      .set({
        status: "error",
        payload: sql`
          COALESCE(payload, '{}'::jsonb) || '{"reason": "timeout"}'::jsonb
        `,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(botActions.status, "processing"), lt(botActions.updatedAt, cutoffDate)))
      .returning();

    return rows.map(mapBotAction);
  }

  async touchChatSession(chatId: string): Promise<void> {
    await this.db
      .update(chatSessions)
      .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(chatSessions.id, chatId));
  }

  async softDeleteChatSession(chatId: string): Promise<boolean> {
    const result = await this.db
      .update(chatSessions)
      .set({
        deletedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(chatSessions.id, chatId), isNull(chatSessions.deletedAt)))
      .returning({ id: chatSessions.id });

    return result.length > 0;
  }

  async createChatCard(values: ChatCardInsert): Promise<ChatCard> {
    await ensureChatTables();
    const [created] = await this.db.insert(chatCards).values(values).returning();
    return created;
  }

  async getChatCardById(id: string): Promise<ChatCard | undefined> {
    await ensureChatTables();
    const [card] = await this.db.select().from(chatCards).where(eq(chatCards.id, id)).limit(1);
    return card ?? undefined;
  }

  async updateChatCard(
    id: string,
    updates: Partial<Pick<ChatCardInsert, "title" | "previewText" | "transcriptId">>,
  ): Promise<ChatCard | undefined> {
    if (!updates || Object.keys(updates).length === 0) {
      return await this.getChatCardById(id);
    }

    await ensureChatTables();
    const [updated] = await this.db.update(chatCards).set(updates).where(eq(chatCards.id, id)).returning();
    return updated ?? undefined;
  }

  async listChatMessages(chatId: string): Promise<ChatMessage[]> {
    await ensureChatTables();
    return await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(asc(chatMessages.createdAt));
  }

  async createChatMessage(values: ChatMessageInsert): Promise<ChatMessage> {
    await ensureChatTables();
    const [created] = await this.db
      .insert(chatMessages)
      .values({
        messageType: (values as any).messageType ?? "text",
        ...values,
      })
      .returning();
    return created;
  }

  async getChatMessage(id: string): Promise<ChatMessage | undefined> {
    await ensureChatTables();
    const [message] = await this.db.select().from(chatMessages).where(eq(chatMessages.id, id)).limit(1);
    return message ?? undefined;
  }

  async createChatAttachment(values: ChatAttachmentInsert): Promise<ChatAttachment> {
    await ensureChatTables();
    const [created] = await this.db.insert(chatAttachments).values(values).returning();
    return created;
  }

  async findChatAttachmentByMessageId(messageId: string): Promise<ChatAttachment | undefined> {
    await ensureChatTables();
    const rows = await this.db.select().from(chatAttachments).where(eq(chatAttachments.messageId, messageId)).limit(1);
    return rows[0];
  }

  async getChatAttachment(id: string): Promise<ChatAttachment | undefined> {
    await ensureChatTables();
    const rows = await this.db.select().from(chatAttachments).where(eq(chatAttachments.id, id)).limit(1);
    return rows[0];
  }

  async createSkillFiles(
    values: SkillFileInsert[],
    options?: { createIngestionJobs?: boolean },
  ): Promise<SkillFile[]> {
    await ensureSkillFilesTable();
    if (!values || values.length === 0) {
      return [];
    }

    if (options?.createIngestionJobs) {
      await ensureSkillFileIngestionJobsTable();
    }

    const inserted = await this.db.transaction(async (tx: typeof db) => {
      const normalizedValues = values.map((entry) => ({
        ...entry,
        version: entry.version ?? 1,
        processingStatus: (entry as any)?.processingStatus ?? "processing",
        processingErrorMessage: (entry as any)?.processingErrorMessage ?? null,
      }));
      const createdFiles = await tx.insert(skillFiles).values(normalizedValues).returning();

      if (options?.createIngestionJobs && createdFiles.length > 0) {
        const jobs = createdFiles.map((file) => ({
          jobType: "skill_file_ingestion" as const,
          workspaceId: file.workspaceId,
          skillId: file.skillId,
          fileId: file.id,
          fileVersion: file.version ?? 1,
          status: "pending" as const,
        }));

        await tx
          .insert(skillFileIngestionJobs)
          .values(jobs)
          .onConflictDoNothing({
            target: [
              skillFileIngestionJobs.jobType,
              skillFileIngestionJobs.fileId,
              skillFileIngestionJobs.fileVersion,
            ],
          });
      }

      return createdFiles;
    });
    return inserted;
  }

  async updateSkillFileStatus(
    id: string,
    workspaceId: string,
    skillId: string,
    patch: {
      status?: SkillFile["status"];
      errorMessage?: string | null;
      processingStatus?: SkillFile["status"];
      processingErrorMessage?: string | null;
    },
  ): Promise<void> {
    await ensureSkillFilesTable();
    const normalizedPatch: Partial<SkillFileInsert> = {};
    if (patch.status) {
      normalizedPatch.status = patch.status;
    }
    if (patch.errorMessage !== undefined) {
      normalizedPatch.errorMessage = patch.errorMessage;
    }
    if (patch.processingStatus) {
      (normalizedPatch as any).processingStatus = patch.processingStatus;
    }
    if (patch.processingErrorMessage !== undefined) {
      (normalizedPatch as any).processingErrorMessage = patch.processingErrorMessage;
    }
    if (Object.keys(normalizedPatch).length === 0) {
      return;
    }
    await this.db
      .update(skillFiles)
      .set(normalizedPatch)
      .where(and(eq(skillFiles.id, id), eq(skillFiles.workspaceId, workspaceId), eq(skillFiles.skillId, skillId)));
  }

  async createSkillFileIngestionJob(
    value: SkillFileIngestionJobInsert,
  ): Promise<SkillFileIngestionJob | null> {
    await ensureSkillFileIngestionJobsTable();
    const normalized: SkillFileIngestionJobInsert = {
      jobType: value.jobType ?? "skill_file_ingestion",
      workspaceId: value.workspaceId,
      skillId: value.skillId,
      fileId: value.fileId,
      fileVersion: value.fileVersion ?? 1,
      status: value.status ?? "pending",
      attempts: value.attempts ?? 0,
      nextRetryAt: value.nextRetryAt ?? null,
      lastError: value.lastError ?? null,
    };

    const [created] = await this.db
      .insert(skillFileIngestionJobs)
      .values(normalized)
      .onConflictDoNothing({
        target: [
          skillFileIngestionJobs.jobType,
          skillFileIngestionJobs.fileId,
          skillFileIngestionJobs.fileVersion,
        ],
      })
      .returning();

    if (created) {
      return created;
    }

    const [existing] = await this.db
      .select()
      .from(skillFileIngestionJobs)
      .where(
        and(
          eq(skillFileIngestionJobs.jobType, normalized.jobType ?? "skill_file_ingestion"),
          eq(skillFileIngestionJobs.fileId, normalized.fileId),
          eq(skillFileIngestionJobs.fileVersion, normalized.fileVersion ?? 1),
        ),
      )
      .limit(1);

    return existing ?? null;
  }

  async findSkillFileIngestionJobByFile(
    fileId: string,
    fileVersion: number,
  ): Promise<SkillFileIngestionJob | undefined> {
    await ensureSkillFileIngestionJobsTable();
    const rows = await this.db
      .select()
      .from(skillFileIngestionJobs)
      .where(
        and(
          eq(skillFileIngestionJobs.fileId, fileId),
          eq(skillFileIngestionJobs.fileVersion, fileVersion),
          eq(skillFileIngestionJobs.jobType, "skill_file_ingestion"),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async claimNextSkillFileIngestionJob(now: Date = new Date()): Promise<SkillFileIngestionJob | null> {
    await ensureSkillFileIngestionJobsTable();
    const result = await this.db.execute(sql`
      UPDATE "skill_file_ingestion_jobs" AS jobs
      SET
        "status" = 'running',
        "attempts" = jobs."attempts" + 1,
        "updated_at" = ${now}
      WHERE jobs."id" = (
        SELECT id
        FROM "skill_file_ingestion_jobs"
        WHERE "status" = 'pending'
          AND ("next_retry_at" IS NULL OR "next_retry_at" <= ${now})
          AND "job_type" = 'skill_file_ingestion'
        ORDER BY "created_at"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);

    const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
    return row ? mapSkillFileIngestionJobRow(row) : null;
  }

  async markSkillFileIngestionJobDone(
    jobId: string,
    stats?: { chunkCount?: number | null; totalChars?: number | null; totalTokens?: number | null },
  ): Promise<void> {
    await ensureSkillFileIngestionJobsTable();
    const now = new Date();
    await this.db
      .update(skillFileIngestionJobs)
      .set({
        status: "done",
        nextRetryAt: null,
        lastError: null,
        chunkCount: stats?.chunkCount ?? null,
        totalChars: stats?.totalChars ?? null,
        totalTokens: stats?.totalTokens ?? null,
        updatedAt: now,
      })
      .where(eq(skillFileIngestionJobs.id, jobId));
  }

  async rescheduleSkillFileIngestionJob(
    jobId: string,
    nextRetryAt: Date,
    errorMessage?: string | null,
  ): Promise<void> {
    await ensureSkillFileIngestionJobsTable();
    const now = new Date();
    await this.db
      .update(skillFileIngestionJobs)
      .set({
        status: "pending",
        nextRetryAt,
        lastError: errorMessage?.trim() || null,
        updatedAt: now,
      })
      .where(eq(skillFileIngestionJobs.id, jobId));
  }

  async failSkillFileIngestionJob(jobId: string, errorMessage?: string | null): Promise<void> {
    await ensureSkillFileIngestionJobsTable();
    const now = new Date();
    await this.db
      .update(skillFileIngestionJobs)
      .set({
        status: "error",
        nextRetryAt: null,
        lastError: errorMessage?.trim() || null,
        updatedAt: now,
      })
      .where(eq(skillFileIngestionJobs.id, jobId));
  }

  async createKnowledgeBaseIndexingJob(
    value: KnowledgeBaseIndexingJobInsert,
  ): Promise<KnowledgeBaseIndexingJob | null> {
    await ensureKnowledgeBaseIndexingJobsTable();
    const normalized: KnowledgeBaseIndexingJobInsert = {
      jobType: value.jobType ?? "knowledge_base_indexing",
      workspaceId: value.workspaceId,
      baseId: value.baseId,
      documentId: value.documentId,
      versionId: value.versionId,
      status: value.status ?? "pending",
      attempts: value.attempts ?? 0,
      nextRetryAt: value.nextRetryAt ?? null,
      lastError: value.lastError ?? null,
      chunkCount: value.chunkCount ?? null,
      totalChars: value.totalChars ?? null,
      totalTokens: value.totalTokens ?? null,
    };

    const [created] = await this.db
      .insert(knowledgeBaseIndexingJobs)
      .values(normalized)
      .onConflictDoNothing({
        target: [
          knowledgeBaseIndexingJobs.jobType,
          knowledgeBaseIndexingJobs.documentId,
          knowledgeBaseIndexingJobs.versionId,
        ],
      })
      .returning();

    if (created) {
      // Логирование в dev.log отключено
      // try {
      //   const fs = await import("fs");
      //   const path = await import("path");
      //   const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
      //   const timestamp = new Date().toISOString();
      //   const logLine = `[${timestamp}] [knowledge_base_indexing] createKnowledgeBaseIndexingJob: created job id=${created.id} documentId=${normalized.documentId} versionId=${normalized.versionId} status=${created.status}\n`;
      //   fs.appendFileSync(logFile, logLine, "utf-8");
      // } catch {
      //   // Игнорируем ошибки
      // }
      return created;
    }

    const [existing] = await this.db
      .select()
      .from(knowledgeBaseIndexingJobs)
      .where(
        and(
          eq(knowledgeBaseIndexingJobs.jobType, normalized.jobType ?? "knowledge_base_indexing"),
          eq(knowledgeBaseIndexingJobs.documentId, normalized.documentId),
          eq(knowledgeBaseIndexingJobs.versionId, normalized.versionId),
        ),
      )
      .limit(1);

    if (existing) {
      // Если job существует и он failed, сбрасываем его в pending для повторной попытки
      if (existing.status === "failed") {
        const [updated] = await this.db
          .update(knowledgeBaseIndexingJobs)
          .set({
            status: "pending",
            attempts: 0,
            nextRetryAt: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(knowledgeBaseIndexingJobs.id, existing.id))
          .returning();
        
        if (updated) {
          // Логирование в dev.log отключено
          // try {
          //   const fs = await import("fs");
          //   const path = await import("path");
          //   const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
          //   const timestamp = new Date().toISOString();
          //   const logLine = `[${timestamp}] [knowledge_base_indexing] createKnowledgeBaseIndexingJob: reset failed job id=${existing.id} documentId=${normalized.documentId} versionId=${normalized.versionId} from failed to pending\n`;
          //   fs.appendFileSync(logFile, logLine, "utf-8");
          // } catch {
          //   // Игнорируем ошибки
          // }
          return updated;
        }
      } else {
        // Логирование в dev.log отключено
        // try {
        //   const fs = await import("fs");
        //   const path = await import("path");
        //   const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
        //   const timestamp = new Date().toISOString();
        //   const logLine = `[${timestamp}] [knowledge_base_indexing] createKnowledgeBaseIndexingJob: job already exists id=${existing.id} documentId=${normalized.documentId} versionId=${normalized.versionId} status=${existing.status}\n`;
        //   fs.appendFileSync(logFile, logLine, "utf-8");
        // } catch {
        //   // Игнорируем ошибки
        // }
      }
    }

    return existing ?? null;
  }

  async findKnowledgeBaseIndexingJobByDocument(
    documentId: string,
    versionId: string,
  ): Promise<KnowledgeBaseIndexingJob | undefined> {
    await ensureKnowledgeBaseIndexingJobsTable();
    const rows = await this.db
      .select()
      .from(knowledgeBaseIndexingJobs)
      .where(
        and(
          eq(knowledgeBaseIndexingJobs.documentId, documentId),
          eq(knowledgeBaseIndexingJobs.versionId, versionId),
          eq(knowledgeBaseIndexingJobs.jobType, "knowledge_base_indexing"),
        ),
      )
      .limit(1);
    return rows[0];
  }

  async claimNextKnowledgeBaseIndexingJob(now: Date = new Date()): Promise<KnowledgeBaseIndexingJob | null> {
    await ensureKnowledgeBaseIndexingJobsTable();
    const result = await this.db.execute(sql`
      UPDATE "knowledge_base_indexing_jobs" AS jobs
      SET
        "status" = 'processing',
        "attempts" = jobs."attempts" + 1,
        "updated_at" = ${now}
      WHERE jobs."id" = (
        SELECT id
        FROM "knowledge_base_indexing_jobs"
        WHERE "status" = 'pending'
          AND ("next_retry_at" IS NULL OR "next_retry_at" <= ${now})
          AND "job_type" = 'knowledge_base_indexing'
        ORDER BY "created_at"
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);

    const row = (result.rows ?? [])[0] as Record<string, unknown> | undefined;
    if (!row) {
      // Логирование в dev.log отключено
      const rowsCount = result.rows?.length ?? 0;
      // console.log(`[knowledge_base_indexing] claimNextKnowledgeBaseIndexingJob: no rows returned, result.rows.length=${rowsCount}`);
      // try {
      //   const fs = await import("fs");
      //   const path = await import("path");
      //   const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
      //   const timestamp = new Date().toISOString();
      //   const logLine = `[${timestamp}] [knowledge_base_indexing] claimNextKnowledgeBaseIndexingJob: no rows returned, result.rows.length=${rowsCount}\n`;
      //   fs.appendFileSync(logFile, logLine, "utf-8");
      // } catch {
      //   // Игнорируем ошибки
      // }
      return null;
    }
    
    const jobId = String(row.id ?? "unknown");
    const jobStatus = String(row.status ?? "unknown");
    console.log(`[knowledge_base_indexing] claimNextKnowledgeBaseIndexingJob: found job id=${jobId} status=${jobStatus}`);
    // Логирование в dev.log отключено
    // try {
    //   const fs = await import("fs");
    //   const path = await import("path");
    //   const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
    //   const timestamp = new Date().toISOString();
    //   const logLine = `[${timestamp}] [knowledge_base_indexing] claimNextKnowledgeBaseIndexingJob: found job id=${jobId} status=${jobStatus}\n`;
    //   fs.appendFileSync(logFile, logLine, "utf-8");
    // } catch {
    //   // Игнорируем ошибки
    // }

    return {
      id: String(row.id),
      jobType: String(row.job_type ?? "knowledge_base_indexing"),
      workspaceId: String(row.workspace_id),
      baseId: String(row.base_id),
      documentId: String(row.document_id),
      versionId: String(row.version_id),
      status: String(row.status ?? "pending") as KnowledgeBaseIndexingJob["status"],
      attempts: Number(row.attempts ?? 0),
      nextRetryAt: row.next_retry_at ? new Date(String(row.next_retry_at)) : null,
      lastError: row.last_error ? String(row.last_error) : null,
      chunkCount: row.chunk_count ? Number(row.chunk_count) : null,
      totalChars: row.total_chars ? Number(row.total_chars) : null,
      totalTokens: row.total_tokens ? Number(row.total_tokens) : null,
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
    };
  }

  async markKnowledgeBaseIndexingJobDone(
    jobId: string,
    stats?: { chunkCount?: number | null; totalChars?: number | null; totalTokens?: number | null },
  ): Promise<void> {
    await ensureKnowledgeBaseIndexingJobsTable();
    const now = new Date();
    const result = await this.db
      .update(knowledgeBaseIndexingJobs)
      .set({
        status: "completed",
        nextRetryAt: null,
        lastError: null,
        chunkCount: stats?.chunkCount ?? null,
        totalChars: stats?.totalChars ?? null,
        totalTokens: stats?.totalTokens ?? null,
        updatedAt: now,
      })
      .where(eq(knowledgeBaseIndexingJobs.id, jobId))
      .returning();
    
    // Логируем завершение job'а
    if (result && result.length > 0) {
      const updated = result[0];
      // Логирование в dev.log отключено
      // try {
      //   const fs = await import("fs");
      //   const path = await import("path");
      //   const logFile = path.resolve(import.meta.dirname, "..", "dev.log");
      //   const timestamp = new Date().toISOString();
      //   const logLine = `[${timestamp}] [knowledge_base_indexing] markKnowledgeBaseIndexingJobDone: job id=${jobId} documentId=${updated.documentId} versionId=${updated.versionId} status=${updated.status} chunks=${stats?.chunkCount ?? 0}\n`;
      //   fs.appendFileSync(logFile, logLine, "utf-8");
      // } catch {
      //   // Игнорируем ошибки
      // }
    }
  }

  async rescheduleKnowledgeBaseIndexingJob(
    jobId: string,
    nextRetryAt: Date,
    errorMessage?: string | null,
  ): Promise<void> {
    await ensureKnowledgeBaseIndexingJobsTable();
    const now = new Date();
    await this.db
      .update(knowledgeBaseIndexingJobs)
      .set({
        status: "pending",
        nextRetryAt,
        lastError: errorMessage?.trim() || null,
        updatedAt: now,
      })
      .where(eq(knowledgeBaseIndexingJobs.id, jobId));
  }

  async failKnowledgeBaseIndexingJob(jobId: string, errorMessage?: string | null): Promise<void> {
    await ensureKnowledgeBaseIndexingJobsTable();
    const now = new Date();
    await this.db
      .update(knowledgeBaseIndexingJobs)
      .set({
        status: "failed",
        nextRetryAt: null,
        lastError: errorMessage?.trim() || null,
        updatedAt: now,
      })
      .where(eq(knowledgeBaseIndexingJobs.id, jobId));
  }

  async countKnowledgeBaseIndexingJobs(
    workspaceId: string,
    baseId: string,
    status: "pending" | "processing" | "completed" | "failed" | null,
    options: { since?: Date | null } = {},
  ): Promise<number> {
    await ensureKnowledgeBaseIndexingJobsTable();
    const conditions = [
      eq(knowledgeBaseIndexingJobs.workspaceId, workspaceId),
      eq(knowledgeBaseIndexingJobs.baseId, baseId),
      eq(knowledgeBaseIndexingJobs.jobType, "knowledge_base_indexing"),
    ];
    if (options.since) {
      conditions.push(sql`${knowledgeBaseIndexingJobs.createdAt} >= ${options.since}`);
    }
    if (status !== null) {
      conditions.push(eq(knowledgeBaseIndexingJobs.status, status));
    }
    const [result] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(knowledgeBaseIndexingJobs)
      .where(and(...conditions));
    return Number(result?.count ?? 0);
  }

  async getKnowledgeBaseIndexingPolicy(): Promise<KnowledgeBaseIndexingPolicy | null> {
    await ensureKnowledgeBaseIndexingPolicyTable();
    const [row] = await this.db
      .select()
      .from(knowledgeBaseIndexingPolicy)
      .where(eq(knowledgeBaseIndexingPolicy.id, "kb_indexing_policy_singleton"))
      .limit(1);
    return row ?? null;
  }

  async updateKnowledgeBaseIndexingPolicy(
    policy: Partial<KnowledgeBaseIndexingPolicy>,
  ): Promise<KnowledgeBaseIndexingPolicy> {
    await ensureKnowledgeBaseIndexingPolicyTable();
    const [updated] = await this.db
      .insert(knowledgeBaseIndexingPolicy)
      .values({
        id: "kb_indexing_policy_singleton",
        embeddingsProvider: policy.embeddingsProvider ?? "",
        embeddingsModel: policy.embeddingsModel ?? "",
        chunkSize: policy.chunkSize ?? 800,
        chunkOverlap: policy.chunkOverlap ?? 200,
        defaultSchema: policy.defaultSchema ?? ([] as unknown as Record<string, unknown>),
        policyHash: policy.policyHash ?? null,
        updatedByAdminId: policy.updatedByAdminId ?? null,
        createdAt: policy.createdAt ?? new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: knowledgeBaseIndexingPolicy.id,
        set: {
          embeddingsProvider: sql`EXCLUDED.embeddings_provider`,
          embeddingsModel: sql`EXCLUDED.embeddings_model`,
          chunkSize: sql`EXCLUDED.chunk_size`,
          chunkOverlap: sql`EXCLUDED.chunk_overlap`,
          defaultSchema: sql`EXCLUDED.default_schema`,
          policyHash: sql`EXCLUDED.policy_hash`,
          updatedByAdminId: sql`EXCLUDED.updated_by_admin_id`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning();
    return updated;
  }

  async createKnowledgeDocumentIndexRevision(
    value: KnowledgeDocumentIndexRevisionInsert,
  ): Promise<KnowledgeDocumentIndexRevisionRecord | null> {
    try {
      await ensureKnowledgeDocumentIndexRevisionsTable();
      const now = new Date();
      const [created] = await this.db
        .insert(knowledgeDocumentIndexRevisions)
        .values({
          ...value,
          createdAt: value.createdAt ?? now,
          updatedAt: now,
        })
        .returning();
      return created ?? null;
    } catch (error) {
      console.error(
        `[createKnowledgeDocumentIndexRevision] Failed to create revision:`,
        error,
      );
      throw error;
    }
  }

  async updateKnowledgeDocumentIndexRevision(
    workspaceId: string,
    documentId: string,
    revisionId: string,
    updates: Partial<KnowledgeDocumentIndexRevisionInsert>,
  ): Promise<KnowledgeDocumentIndexRevisionRecord | null> {
    try {
      await ensureKnowledgeDocumentIndexRevisionsTable();
      const now = new Date();
      const [updated] = await this.db
        .update(knowledgeDocumentIndexRevisions)
        .set({
          ...updates,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeDocumentIndexRevisions.workspaceId, workspaceId),
            eq(knowledgeDocumentIndexRevisions.documentId, documentId),
            eq(knowledgeDocumentIndexRevisions.id, revisionId),
          ),
        )
        .returning();
      return updated ?? null;
    } catch (error) {
      console.error(
        `[updateKnowledgeDocumentIndexRevision] Failed to update revision:`,
        error,
      );
      throw error;
    }
  }

  async getKnowledgeDocumentIndexRevision(
    workspaceId: string,
    documentId: string,
    revisionId: string,
  ): Promise<KnowledgeDocumentIndexRevisionRecord | null> {
    await ensureKnowledgeDocumentIndexRevisionsTable();
    const [row] = await this.db
      .select()
      .from(knowledgeDocumentIndexRevisions)
      .where(
        and(
          eq(knowledgeDocumentIndexRevisions.workspaceId, workspaceId),
          eq(knowledgeDocumentIndexRevisions.documentId, documentId),
          eq(knowledgeDocumentIndexRevisions.id, revisionId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async getLatestKnowledgeDocumentIndexRevision(
    workspaceId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentIndexRevisionRecord | null> {
    await ensureKnowledgeDocumentIndexRevisionsTable();
    const [row] = await this.db
      .select()
      .from(knowledgeDocumentIndexRevisions)
      .where(
        and(
          eq(knowledgeDocumentIndexRevisions.workspaceId, workspaceId),
          eq(knowledgeDocumentIndexRevisions.documentId, documentId),
        ),
      )
      .orderBy(desc(knowledgeDocumentIndexRevisions.createdAt))
      .limit(1);
    return row ?? null;
  }

  async switchKnowledgeDocumentRevision(
    workspaceId: string,
    documentId: string,
    revisionId: string,
    chunkSetId: string,
  ): Promise<{ previousRevisionId: string | null }> {
    await ensureKnowledgeBaseTables();
    const now = new Date();

    return this.db.transaction(async (tx) => {
      const [docRow] = await tx
        .select({ currentRevisionId: knowledgeDocuments.currentRevisionId })
        .from(knowledgeDocuments)
        .where(
          and(
            eq(knowledgeDocuments.id, documentId),
            eq(knowledgeDocuments.workspaceId, workspaceId),
          ),
        )
        .limit(1);

      await tx
        .update(knowledgeDocuments)
        .set({
          currentRevisionId: revisionId,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeDocuments.id, documentId),
            eq(knowledgeDocuments.workspaceId, workspaceId),
          ),
        );

      await tx
        .update(knowledgeDocumentChunkSets)
        .set({ isLatest: false, updatedAt: now })
        .where(
          and(
            eq(knowledgeDocumentChunkSets.documentId, documentId),
            eq(knowledgeDocumentChunkSets.workspaceId, workspaceId),
            ne(knowledgeDocumentChunkSets.id, chunkSetId),
          ),
        );

      await tx
        .update(knowledgeDocumentChunkSets)
        .set({ isLatest: true, updatedAt: now })
        .where(
          and(
            eq(knowledgeDocumentChunkSets.id, chunkSetId),
            eq(knowledgeDocumentChunkSets.workspaceId, workspaceId),
          ),
        );

      return { previousRevisionId: docRow?.currentRevisionId ?? null };
    });
  }

  async upsertKnowledgeDocumentIndexState(
    value: KnowledgeDocumentIndexStateInsert,
  ): Promise<KnowledgeDocumentIndexStateRecord | null> {
    try {
      await ensureKnowledgeDocumentIndexStateTable();
      const now = new Date();
      const [updated] = await this.db
        .insert(knowledgeDocumentIndexState)
        .values({
          ...value,
          createdAt: value.createdAt ?? now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            knowledgeDocumentIndexState.workspaceId,
            knowledgeDocumentIndexState.baseId,
            knowledgeDocumentIndexState.documentId,
          ],
          set: {
            indexedVersionId: sql`EXCLUDED.indexed_version_id`,
            chunkSetId: sql`EXCLUDED.chunk_set_id`,
            policyHash: sql`EXCLUDED.policy_hash`,
            status: sql`EXCLUDED.status`,
            error: sql`EXCLUDED.error`,
            indexedAt: sql`EXCLUDED.indexed_at`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .returning();
      return updated ?? null;
    } catch (error) {
      console.error(`[upsertKnowledgeDocumentIndexState] Failed to upsert document state:`, error);
      throw error;
    }
  }

  async updateKnowledgeDocumentIndexState(
    workspaceId: string,
    baseId: string,
    documentId: string,
    updates: Partial<KnowledgeDocumentIndexStateInsert>,
  ): Promise<KnowledgeDocumentIndexStateRecord | null> {
    try {
      await ensureKnowledgeDocumentIndexStateTable();
      const now = new Date();
      const [updated] = await this.db
        .update(knowledgeDocumentIndexState)
        .set({
          ...updates,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeDocumentIndexState.workspaceId, workspaceId),
            eq(knowledgeDocumentIndexState.baseId, baseId),
            eq(knowledgeDocumentIndexState.documentId, documentId),
          ),
        )
        .returning();
      return updated ?? null;
    } catch (error) {
      console.error(`[updateKnowledgeDocumentIndexState] Failed to update document state:`, error);
      throw error;
    }
  }

  async getKnowledgeDocumentIndexState(
    workspaceId: string,
    baseId: string,
    documentId: string,
  ): Promise<KnowledgeDocumentIndexStateRecord | null> {
    await ensureKnowledgeDocumentIndexStateTable();
    const [row] = await this.db
      .select()
      .from(knowledgeDocumentIndexState)
      .where(
        and(
          eq(knowledgeDocumentIndexState.workspaceId, workspaceId),
          eq(knowledgeDocumentIndexState.baseId, baseId),
          eq(knowledgeDocumentIndexState.documentId, documentId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async upsertKnowledgeBaseIndexState(
    value: KnowledgeBaseIndexStateInsert,
  ): Promise<KnowledgeBaseIndexStateRecord | null> {
    try {
      await ensureKnowledgeBaseIndexStateTable();
      const now = new Date();
      const [updated] = await this.db
        .insert(knowledgeBaseIndexState)
        .values({
          ...value,
          createdAt: value.createdAt ?? now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [knowledgeBaseIndexState.workspaceId, knowledgeBaseIndexState.baseId],
          set: {
            status: sql`EXCLUDED.status`,
            totalDocuments: sql`EXCLUDED.total_documents`,
            outdatedDocuments: sql`EXCLUDED.outdated_documents`,
            indexingDocuments: sql`EXCLUDED.indexing_documents`,
            errorDocuments: sql`EXCLUDED.error_documents`,
            upToDateDocuments: sql`EXCLUDED.up_to_date_documents`,
            policyHash: sql`EXCLUDED.policy_hash`,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .returning();
      return updated ?? null;
    } catch (error) {
      console.error(`[upsertKnowledgeBaseIndexState] Failed to upsert base state:`, error);
      throw error;
    }
  }

  async updateKnowledgeBaseIndexState(
    workspaceId: string,
    baseId: string,
    updates: Partial<KnowledgeBaseIndexStateInsert>,
  ): Promise<KnowledgeBaseIndexStateRecord | null> {
    try {
      await ensureKnowledgeBaseIndexStateTable();
      const now = new Date();
      const [updated] = await this.db
        .update(knowledgeBaseIndexState)
        .set({
          ...updates,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeBaseIndexState.workspaceId, workspaceId),
            eq(knowledgeBaseIndexState.baseId, baseId),
          ),
        )
        .returning();
      return updated ?? null;
    } catch (error) {
      console.error(`[updateKnowledgeBaseIndexState] Failed to update base state:`, error);
      throw error;
    }
  }

  async getKnowledgeBaseIndexState(
    workspaceId: string,
    baseId: string,
  ): Promise<KnowledgeBaseIndexStateRecord | null> {
    await ensureKnowledgeBaseIndexStateTable();
    const [row] = await this.db
      .select()
      .from(knowledgeBaseIndexState)
      .where(
        and(
          eq(knowledgeBaseIndexState.workspaceId, workspaceId),
          eq(knowledgeBaseIndexState.baseId, baseId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createKnowledgeBaseIndexingAction(
    value: KnowledgeBaseIndexingActionInsert,
  ): Promise<KnowledgeBaseIndexingActionRecord | null> {
    try {
      await ensureKnowledgeBaseIndexingActionsTable();
      const [created] = await this.db
        .insert(knowledgeBaseIndexingActions)
        .values(value)
        .onConflictDoNothing({
          target: [
            knowledgeBaseIndexingActions.workspaceId,
            knowledgeBaseIndexingActions.baseId,
            knowledgeBaseIndexingActions.actionId,
          ],
        })
        .returning();
      return created ?? null;
    } catch (error) {
      console.error(`[createKnowledgeBaseIndexingAction] Failed to create action:`, error);
      throw error;
    }
  }

  async updateKnowledgeBaseIndexingAction(
    workspaceId: string,
    baseId: string,
    actionId: string,
    updates: Partial<KnowledgeBaseIndexingActionInsert>,
  ): Promise<KnowledgeBaseIndexingActionRecord | null> {
    try {
      await ensureKnowledgeBaseIndexingActionsTable();
      const now = new Date();
      const [updated] = await this.db
        .update(knowledgeBaseIndexingActions)
        .set({
          ...updates,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeBaseIndexingActions.workspaceId, workspaceId),
            eq(knowledgeBaseIndexingActions.baseId, baseId),
            eq(knowledgeBaseIndexingActions.actionId, actionId),
          ),
        )
        .returning();
      return updated ?? null;
    } catch (error) {
      console.error(`[updateKnowledgeBaseIndexingAction] Failed to update action for baseId: ${baseId}, workspaceId: ${workspaceId}, actionId: ${actionId}:`, error);
      throw error;
    }
  }

  async getKnowledgeBaseIndexingAction(
    workspaceId: string,
    baseId: string,
    actionId: string,
  ): Promise<KnowledgeBaseIndexingActionRecord | null> {
    await ensureKnowledgeBaseIndexingActionsTable();
    const [row] = await this.db
      .select()
      .from(knowledgeBaseIndexingActions)
      .where(
        and(
          eq(knowledgeBaseIndexingActions.workspaceId, workspaceId),
          eq(knowledgeBaseIndexingActions.baseId, baseId),
          eq(knowledgeBaseIndexingActions.actionId, actionId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async getLatestKnowledgeBaseIndexingAction(
    workspaceId: string,
    baseId: string,
  ): Promise<KnowledgeBaseIndexingActionRecord | null> {
    await ensureKnowledgeBaseIndexingActionsTable();
    const [row] = await this.db
      .select()
      .from(knowledgeBaseIndexingActions)
      .where(
        and(
          eq(knowledgeBaseIndexingActions.workspaceId, workspaceId),
          eq(knowledgeBaseIndexingActions.baseId, baseId),
        ),
      )
      .orderBy(desc(knowledgeBaseIndexingActions.updatedAt))
      .limit(1);
    return row ?? null;
  }

  async listSkillFiles(workspaceId: string, skillId: string): Promise<SkillFile[]> {
    await ensureSkillFilesTable();
    const rows = await this.db
      .select()
      .from(skillFiles)
      .where(and(eq(skillFiles.workspaceId, workspaceId), eq(skillFiles.skillId, skillId)))
      .orderBy(desc(skillFiles.createdAt));
    return rows;
  }

  async getSkillFile(id: string, workspaceId: string, skillId: string): Promise<SkillFile | undefined> {
    await ensureSkillFilesTable();
    const rows = await this.db
      .select()
      .from(skillFiles)
      .where(and(eq(skillFiles.id, id), eq(skillFiles.workspaceId, workspaceId), eq(skillFiles.skillId, skillId)))
      .limit(1);
    return rows[0];
  }

  async deleteSkillFile(id: string, workspaceId: string, skillId: string): Promise<boolean> {
    await ensureSkillFilesTable();
    const result = await this.db
      .delete(skillFiles)
      .where(and(eq(skillFiles.id, id), eq(skillFiles.workspaceId, workspaceId), eq(skillFiles.skillId, skillId)))
      .returning({ id: skillFiles.id });
    return result.length > 0;
  }

  async listReadySkillFileIds(workspaceId: string, skillId: string): Promise<string[]> {
    await ensureSkillFilesTable();
    const rows = await this.db
      .select({ id: skillFiles.id })
      .from(skillFiles)
      .where(
        and(
          eq(skillFiles.workspaceId, workspaceId),
          eq(skillFiles.skillId, skillId),
          eq(skillFiles.processingStatus, "ready"),
        ),
      );
    return rows.map((entry) => entry.id);
  }

  async hasReadySkillFiles(workspaceId: string, skillId: string): Promise<boolean> {
    await ensureSkillFilesTable();
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(skillFiles)
      .where(
        and(
          eq(skillFiles.workspaceId, workspaceId),
          eq(skillFiles.skillId, skillId),
          eq(skillFiles.processingStatus, "ready"),
        ),
      )
      .limit(1);
    return Number(result[0]?.count ?? 0) > 0;
  }

  async countChatMessages(chatId: string): Promise<number> {
    await ensureChatTables();
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId));
    return Number(result[0]?.count ?? 0);
  }

  async updateChatMessage(
    id: string,
    updates: Partial<Pick<ChatMessageInsert, "content" | "metadata">>,
  ): Promise<ChatMessage | undefined> {
    if (!updates || Object.keys(updates).length === 0) {
      return await this.getChatMessage(id);
    }

    await ensureChatTables();
    const [updated] = await this.db
      .update(chatMessages)
      .set({
        ...updates,
      })
      .where(eq(chatMessages.id, id))
      .returning();

    return updated ?? undefined;
  }

  async findChatMessageByTranscriptId(transcriptId: string): Promise<ChatMessage | undefined> {
    await ensureChatTables();
    const [message] = await this.db
      .select()
      .from(chatMessages)
      .where(eq(sql`"metadata"->>'transcriptId'`, transcriptId))
      .limit(1);
    return message ?? undefined;
  }

  async findChatMessageByResultId(chatId: string, resultId: string): Promise<ChatMessage | undefined> {
    await ensureChatTables();
    const [message] = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(eq(chatMessages.chatId, chatId), eq(sql`"metadata"->>'resultId'`, resultId)),
      )
      .limit(1);
    return message ?? undefined;
  }

  async findChatMessageByStreamId(chatId: string, streamId: string): Promise<ChatMessage | undefined> {
    await ensureChatTables();
    const [message] = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(eq(chatMessages.chatId, chatId), eq(sql`"metadata"->>'streamId'`, streamId)),
      )
      .limit(1);
    return message ?? undefined;
  }

  async clearChatAssistantAction(chatId: string): Promise<ChatSession | undefined> {
    await ensureChatTables();
    const [updated] = await this.db
      .update(chatSessions)
      .set({
        currentAssistantActionType: null,
        currentAssistantActionText: null,
        currentAssistantActionTriggerMessageId: null,
        currentAssistantActionUpdatedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(chatSessions.id, chatId))
      .returning();
    return updated ?? undefined;
  }

  async getTranscriptBySourceFileId(sourceFileId: string): Promise<Transcript | undefined> {
    await ensureChatTables();
    const [found] = await this.db
      .select()
      .from(transcripts)
      .where(eq(transcripts.sourceFileId, sourceFileId))
      .limit(1);
    return found ?? undefined;
  }

  async getTranscriptById(id: string): Promise<Transcript | undefined> {
    await ensureChatTables();
    const [found] = await this.db.select().from(transcripts).where(eq(transcripts.id, id)).limit(1);
    return found ?? undefined;
  }

  async listTranscriptViews(transcriptId: string): Promise<TranscriptView[]> {
    await ensureTranscriptViewsTable();
    return await this.db
      .select()
      .from(transcriptViews)
      .where(eq(transcriptViews.transcriptId, transcriptId))
      .orderBy(transcriptViews.createdAt);
  }

  async createTranscriptView(values: TranscriptViewInsert): Promise<TranscriptView> {
    await ensureTranscriptViewsTable();
    const [created] = await this.db.insert(transcriptViews).values(values).returning();
    return created;
  }

  async listCanvasDocumentsByChat(chatId: string): Promise<CanvasDocument[]> {
    await ensureCanvasDocumentsTable();
    return await this.db
      .select()
      .from(canvasDocuments)
      .where(and(eq(canvasDocuments.chatId, chatId), isNull(canvasDocuments.deletedAt)))
      .orderBy(desc(canvasDocuments.createdAt));
  }

  async listCanvasDocumentsByTranscript(transcriptId: string): Promise<CanvasDocument[]> {
    await ensureCanvasDocumentsTable();
    return await this.db
      .select()
      .from(canvasDocuments)
      .where(
        and(
          eq(canvasDocuments.transcriptId, transcriptId),
          isNull(canvasDocuments.deletedAt),
        ),
      )
      .orderBy(desc(canvasDocuments.createdAt));
  }

  async getCanvasDocument(id: string): Promise<CanvasDocument | undefined> {
    await ensureCanvasDocumentsTable();
    const [found] = await this.db
      .select()
      .from(canvasDocuments)
      .where(eq(canvasDocuments.id, id))
      .limit(1);
    return found ?? undefined;
  }

  async createCanvasDocument(values: CanvasDocumentInsert): Promise<CanvasDocument> {
    await ensureCanvasDocumentsTable();
    const [created] = await this.db.insert(canvasDocuments).values(values).returning();
    return created;
  }

  async updateCanvasDocument(
    id: string,
    updates: Partial<Pick<CanvasDocumentInsert, "title" | "content" | "isDefault">>,
  ): Promise<CanvasDocument | undefined> {
    if (!updates || Object.keys(updates).length === 0) {
      return await this.getCanvasDocument(id);
    }

    await ensureCanvasDocumentsTable();
    const [updated] = await this.db
      .update(canvasDocuments)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(canvasDocuments.id, id))
      .returning();
    return updated ?? undefined;
  }

  async softDeleteCanvasDocument(id: string): Promise<boolean> {
    await ensureCanvasDocumentsTable();
    const result = await this.db
      .update(canvasDocuments)
      .set({ deletedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(canvasDocuments.id, id));
    return result.rowCount > 0;
  }

  async setDefaultCanvasDocument(chatId: string, documentId: string): Promise<void> {
    await ensureCanvasDocumentsTable();
    await this.db
      .update(canvasDocuments)
      .set({ isDefault: false, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(canvasDocuments.chatId, chatId));
    await this.db
      .update(canvasDocuments)
      .set({ isDefault: true, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(canvasDocuments.id, documentId));
  }

  async duplicateCanvasDocument(id: string, titleOverride?: string): Promise<CanvasDocument | undefined> {
    await ensureCanvasDocumentsTable();
    const source = await this.getCanvasDocument(id);
    if (!source || source.deletedAt) {
      return undefined;
    }
    const nextTitle =
      (titleOverride && titleOverride.trim()) ||
      `${source.title}${source.title.includes("копия") ? "" : " (копия)"}`;
    const insert: CanvasDocumentInsert = {
      workspaceId: source.workspaceId,
      chatId: source.chatId,
      transcriptId: source.transcriptId ?? undefined,
      skillId: source.skillId ?? undefined,
      actionId: source.actionId ?? undefined,
      type: source.type,
      title: nextTitle,
      content: source.content,
      isDefault: false,
      createdByUserId: source.createdByUserId ?? undefined,
    };
    const created = await this.createCanvasDocument(insert);
    return created;
  }

  async updateTranscript(
    id: string,
    updates: Partial<
      Pick<
        TranscriptInsert,
        | "status"
        | "title"
        | "previewText"
        | "fullText"
        | "lastEditedByUserId"
        | "defaultViewActionId"
        | "defaultViewId"
      >
    >,
  ): Promise<Transcript | undefined> {
    if (!updates || Object.keys(updates).length === 0) {
      const [current] = await this.db.select().from(transcripts).where(eq(transcripts.id, id)).limit(1);
      return current ?? undefined;
    }

    await ensureChatTables();
    const [updated] = await this.db
      .update(transcripts)
      .set({
        ...updates,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(transcripts.id, id))
      .returning();

    return updated ?? undefined;
  }

  async createTranscript(values: TranscriptInsert): Promise<Transcript> {
    await ensureChatTables();
    const [created] = await this.db.insert(transcripts).values(values).returning();
    return created;
  }

  async updateChatTitleIfEmpty(chatId: string, title: string): Promise<boolean> {
    await ensureChatTables();
    const updated = await this.db
      .update(chatSessions)
      .set({ title })
      .where(and(eq(chatSessions.id, chatId), eq(chatSessions.title, "")))
      .returning({ id: chatSessions.id });
    return updated.length > 0;
  }

  async getUnicaChatConfig(): Promise<UnicaChatConfig> {
    await ensureUnicaChatConfigTable();
    const [config] = await this.db.select().from(unicaChatConfig).limit(1);
    if (config) {
      return config;
    }

    const [inserted] = await this.db
      .insert(unicaChatConfig)
      .values({ id: UNICA_CHAT_CONFIG_ID, systemPrompt: "" })
      .returning();

    return inserted;
  }

  async updateUnicaChatConfig(
    updates: Partial<
      Pick<UnicaChatConfigInsert, "llmProviderConfigId" | "modelId" | "systemPrompt" | "temperature" | "topP" | "maxTokens">
    >,
  ): Promise<UnicaChatConfig> {
    await ensureUnicaChatConfigTable();

    const sanitized = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ) as Partial<UnicaChatConfigInsert>;

    if (Object.keys(sanitized).length === 0) {
      return await this.getUnicaChatConfig();
    }

    const [updated] = await this.db
      .update(unicaChatConfig)
      .set({ ...sanitized, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(unicaChatConfig.id, UNICA_CHAT_CONFIG_ID))
      .returning();

    if (updated) {
      return updated;
    }

    const [inserted] = await this.db
      .insert(unicaChatConfig)
      .values({ id: UNICA_CHAT_CONFIG_ID, ...sanitized })
      .returning();

    return inserted;
  }

  async getUser(id: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user ?? undefined;
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.getUser(id);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const [user] = await this.db.select().from(users).where(eq(users.email, email));
    return user ?? undefined;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const trimmedId = googleId.trim();
    if (!trimmedId) {
      return undefined;
    }

    const [user] = await this.db.select().from(users).where(eq(users.googleId, trimmedId));
    return user ?? undefined;
  }

  async getUserByYandexId(yandexId: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const trimmedId = yandexId.trim();
    if (!trimmedId) {
      return undefined;
    }

    const [user] = await this.db.select().from(users).where(eq(users.yandexId, trimmedId));
    return user ?? undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    await this.ensureUserAuthColumns();
    const [newUser] = await this.db.insert(users).values(user).returning();
    if (!newUser) {
      throw new Error("Не удалось создать пользователя");
    }
    try {
      await this.ensurePersonalWorkspace(newUser);
    } catch (workspaceError) {
      // Логируем ошибку создания workspace, но не прерываем процесс
      // Пользователь уже создан, и это важнее для регистрации
      console.error("[storage] user created but workspace creation failed", {
        userId: newUser.id,
        email: newUser.email,
        error: workspaceError instanceof Error ? workspaceError.message : String(workspaceError),
        stack: workspaceError instanceof Error ? workspaceError.stack : undefined,
        note: "User will be created, but workspace creation will be retried later or user can use resend-confirmation",
      });
      // Пробрасываем ошибку дальше, чтобы endpoint мог обработать её
      // и продолжить процесс отправки письма
      throw workspaceError;
    }
    return newUser;
  }

  async upsertUserFromGoogle(payload: GoogleUserUpsertPayload): Promise<User> {
    await this.ensureUserAuthColumns();

    const googleId = normalizeProfileString(payload.googleId);
    if (!googleId) {
      throw new Error("Отсутствует идентификатор Google");
    }

    const email = normalizeProfileString(payload.email).toLowerCase();
    if (!email) {
      throw new Error("Отсутствует email Google-профиля");
    }

    const avatar = normalizeProfileString(payload.avatar);
    const { fullName, firstName, lastName } = resolveNamesFromProfile({
      emailFallback: email,
      fullName: payload.fullName,
      firstName: payload.firstName,
      lastName: payload.lastName,
    });

    const requestedEmailVerified = payload.emailVerified;

    const [existingByGoogle] = await this.db.select().from(users).where(eq(users.googleId, googleId));
    if (existingByGoogle) {
      const googleEmailVerified =
        requestedEmailVerified === undefined || requestedEmailVerified === null
          ? existingByGoogle.googleEmailVerified
          : Boolean(requestedEmailVerified);

      const [updatedUser] = await this.db
        .update(users)
        .set({
          email,
          fullName: fullName || existingByGoogle.fullName,
          firstName: firstName || existingByGoogle.firstName,
          lastName: lastName || existingByGoogle.lastName,
          googleId,
          googleAvatar: avatar || existingByGoogle.googleAvatar || "",
          googleEmailVerified,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(users.id, existingByGoogle.id))
        .returning();

      const resolved = updatedUser ?? existingByGoogle;
      await this.ensurePersonalWorkspace(resolved);
      return resolved;
    }

    const [existingByEmail] = await this.db.select().from(users).where(eq(users.email, email));
    if (existingByEmail) {
      const googleEmailVerified =
        requestedEmailVerified === undefined || requestedEmailVerified === null
          ? existingByEmail.googleEmailVerified
          : Boolean(requestedEmailVerified);

      const [updatedUser] = await this.db
        .update(users)
        .set({
          googleId,
          googleAvatar: avatar || existingByEmail.googleAvatar || "",
          googleEmailVerified,
          fullName: fullName || existingByEmail.fullName,
          firstName: firstName || existingByEmail.firstName,
          lastName: lastName || existingByEmail.lastName,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(users.id, existingByEmail.id))
        .returning();

      const resolved = updatedUser ?? existingByEmail;
      await this.ensurePersonalWorkspace(resolved);
      return resolved;
    }

    const [newUser] = await this.db
      .insert(users)
      .values({
        email,
        fullName,
        firstName,
        lastName,
        phone: "",
        passwordHash: null,
        googleId,
        googleAvatar: avatar,
        googleEmailVerified: Boolean(requestedEmailVerified),
      })
      .returning();

    if (!newUser) {
      throw new Error("Не удалось создать пользователя по данным Google");
    }

    await this.ensurePersonalWorkspace(newUser);
    return newUser;
  }

  async upsertUserFromYandex(payload: YandexUserUpsertPayload): Promise<User> {
    await this.ensureUserAuthColumns();

    const yandexId = normalizeProfileString(payload.yandexId);
    if (!yandexId) {
      throw new Error("Отсутствует идентификатор Yandex");
    }

    const email = normalizeProfileString(payload.email).toLowerCase();
    if (!email) {
      throw new Error("Отсутствует email Yandex-профиля");
    }

    const avatar = normalizeProfileString(payload.avatar);
    const { fullName, firstName, lastName } = resolveNamesFromProfile({
      emailFallback: email,
      fullName: payload.fullName,
      firstName: payload.firstName,
      lastName: payload.lastName,
    });

    const requestedEmailVerified = payload.emailVerified;

    const [existingByYandex] = await this.db.select().from(users).where(eq(users.yandexId, yandexId));
    if (existingByYandex) {
      const yandexEmailVerified =
        requestedEmailVerified === undefined || requestedEmailVerified === null
          ? existingByYandex.yandexEmailVerified
          : Boolean(requestedEmailVerified);

      const [updatedUser] = await this.db
        .update(users)
        .set({
          email,
          fullName: fullName || existingByYandex.fullName,
          firstName: firstName || existingByYandex.firstName,
          lastName: lastName || existingByYandex.lastName,
          yandexId,
          yandexAvatar: avatar || existingByYandex.yandexAvatar || "",
          yandexEmailVerified,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(users.id, existingByYandex.id))
        .returning();

      const resolved = updatedUser ?? existingByYandex;
      await this.ensurePersonalWorkspace(resolved);
      return resolved;
    }

    const [existingByEmail] = await this.db.select().from(users).where(eq(users.email, email));
    if (existingByEmail) {
      const yandexEmailVerified =
        requestedEmailVerified === undefined || requestedEmailVerified === null
          ? existingByEmail.yandexEmailVerified
          : Boolean(requestedEmailVerified);

      const [updatedUser] = await this.db
        .update(users)
        .set({
          yandexId,
          yandexAvatar: avatar || existingByEmail.yandexAvatar || "",
          yandexEmailVerified,
          fullName: fullName || existingByEmail.fullName,
          firstName: firstName || existingByEmail.firstName,
          lastName: lastName || existingByEmail.lastName,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(users.id, existingByEmail.id))
        .returning();

      const resolved = updatedUser ?? existingByEmail;
      await this.ensurePersonalWorkspace(resolved);
      return resolved;
    }

    const [newUser] = await this.db
      .insert(users)
      .values({
        email,
        fullName,
        firstName,
        lastName,
        phone: "",
        passwordHash: null,
        yandexId,
        yandexAvatar: avatar,
        yandexEmailVerified: Boolean(requestedEmailVerified),
      })
      .returning();

    if (!newUser) {
      throw new Error("Не удалось создать пользователя по данным Yandex");
    }

    await this.ensurePersonalWorkspace(newUser);
    return newUser;
  }

  async listUsers(): Promise<User[]> {
    await this.ensureUserAuthColumns();
    return await this.db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUserRole(userId: string, role: User["role"]): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const [updatedUser] = await this.db
      .update(users)
      .set({ role, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  }

  async recordUserActivity(userId: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const [updatedUser] = await this.db
      .update(users)
      .set({
        lastActiveAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, userId))
      .returning();
    if (updatedUser) {
      await this.ensurePersonalWorkspace(updatedUser);
    }
    return updatedUser ?? undefined;
  }

  async confirmUserEmail(userId: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const [updatedUser] = await this.db
      .update(users)
      .set({
        isEmailConfirmed: true,
        status: "active",
        emailConfirmedAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  }

  async updateUserProfile(
    userId: string,
    updates: { firstName: string; lastName: string; phone: string; fullName: string },
  ): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const [updatedUser] = await this.db
      .update(users)
      .set({
        firstName: updates.firstName,
        lastName: updates.lastName,
        phone: updates.phone,
        fullName: updates.fullName,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  }

  async getWorkspace(id: string): Promise<Workspace | undefined> {
    await ensureWorkspacesTable();
    const [workspace] = await this.db.select().from(workspaces).where(eq(workspaces.id, id));
    return workspace ?? undefined;
  }

  async updateWorkspaceIcon(
    workspaceId: string,
    iconUrl: string | null,
    iconKey: string | null = null,
  ): Promise<Workspace | undefined> {
    await ensureWorkspacesTable();
    const [updated] = await this.db
      .update(workspaces)
      .set({ iconUrl, iconKey, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    return updated ?? undefined;
  }

  async setWorkspaceStorageBucket(workspaceId: string, bucketName: string): Promise<void> {
    await ensureWorkspacesTable();
    await this.db
      .update(workspaces)
      .set({ storageBucket: bucketName, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }

  async isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    await ensureWorkspaceMembersTable();
    const [row] = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    return Boolean(row);
  }

  private async resolveWorkspaceEmbeddingProviderForVectors(workspaceId: string): Promise<EmbeddingProvider> {
    await ensureEmbeddingProvidersTable();

    let providerId: string | null = null;
    try {
      const [rules] = await this.db.select().from(indexingRules).limit(1);
      const candidate = rules?.embeddingsProvider;
      if (candidate && typeof candidate === "string" && candidate.trim()) {
        providerId = candidate.trim();
      }
    } catch {
      providerId = null;
    }

    if (!providerId && DEFAULT_INDEXING_RULES.embeddingsProvider) {
      providerId = DEFAULT_INDEXING_RULES.embeddingsProvider;
    }

    let provider: EmbeddingProvider | undefined;
    if (providerId) {
      provider = await this.getEmbeddingProvider(providerId, workspaceId);
    }

    if (!provider) {
      const providers = await this.listEmbeddingProviders(workspaceId);
      provider = providers.find((entry) => entry.isActive) ?? providers[0];
    }

    if (!provider) {
      throw new WorkspaceVectorInitError(
        "Для рабочего пространства не настроен сервис эмбеддингов. Укажите провайдера в админке.",
        false,
      );
    }

    return provider;
  }

  private resolveWorkspaceVectorSize(provider: EmbeddingProvider): number {
    const configured = parseVectorSizeValue((provider as any)?.qdrantConfig?.vectorSize);
    if (configured) {
      return configured;
    }

    if (provider.providerType === "gigachat") {
      return GIGACHAT_EMBEDDING_VECTOR_SIZE;
    }

    if (provider.providerType === "openai") {
      return 1536;
    }

    throw new WorkspaceVectorInitError(
      "Не удалось определить размер вектора для коллекции. Укажите vectorSize в настройках сервиса эмбеддингов.",
      false,
    );
  }

  async ensureWorkspaceVectorCollection(workspaceId: string): Promise<string> {
    if (!workspaceId || workspaceId.trim().length === 0) {
      throw new WorkspaceVectorInitError("Не указан workspaceId для инициализации коллекции", false);
    }

    await ensureWorkspacesTable();
    const workspace = await this.getWorkspace(workspaceId);
    if (!workspace) {
      throw new WorkspaceVectorInitError("Рабочее пространство не найдено", false);
    }

    const isTestEnv = process.env.NODE_ENV === "test";
    const enforceBootstrap = process.env.ENFORCE_WORKSPACE_VECTOR_BOOTSTRAP === "true";
    const allowSoftFail = isTestEnv && !enforceBootstrap;

    if (!process.env.QDRANT_URL && !allowSoftFail) {
      throw new WorkspaceVectorInitError("Переменная окружения QDRANT_URL не задана", false);
    }

    let provider: EmbeddingProvider;
    try {
      provider = await this.resolveWorkspaceEmbeddingProviderForVectors(workspaceId);
    } catch (error) {
      if (allowSoftFail) {
        console.warn(
          "[WORKSPACES] Пропускаю инициализацию векторной коллекции в тестовом окружении: провайдер не настроен",
        );
        const fallbackCollection = buildWorkspaceVectorCollectionName(workspaceId, "default");
        await this.upsertCollectionWorkspace(fallbackCollection, workspaceId);
        return fallbackCollection;
      }
      throw error;
    }

    const collectionName = buildWorkspaceVectorCollectionName(workspaceId, provider.id);
    let client;
    try {
      client = getQdrantClient();
    } catch (error) {
      if (allowSoftFail) {
        console.warn(
          "[WORKSPACES] Пропускаю инициализацию векторной коллекции в тестовом окружении: клиент Qdrant недоступен",
          error instanceof Error ? error.message : error,
        );
        await this.upsertCollectionWorkspace(collectionName, workspaceId);
        return collectionName;
      }
      throw new WorkspaceVectorInitError(
        "Не удалось подготовить векторное хранилище для workspace: Qdrant недоступен",
        true,
      );
    }

    let collectionExists = false;
    try {
      await client.getCollection(collectionName);
      collectionExists = true;
    } catch (error) {
      if (!isQdrantNotFoundError(error)) {
        if (allowSoftFail) {
          console.warn(
            "[WORKSPACES] Пропускаю проверку векторной коллекции в тестовом окружении",
            error instanceof Error ? error.message : error,
          );
          await this.upsertCollectionWorkspace(collectionName, workspaceId);
          return collectionName;
        }
        throw new WorkspaceVectorInitError(
          "Не удалось проверить наличие векторной коллекции workspace",
          isQdrantRetryableError(error),
        );
      }
    }

    if (!collectionExists) {
      const vectorSize = this.resolveWorkspaceVectorSize(provider);
      try {
        await client.createCollection(collectionName, {
          vectors: { size: vectorSize, distance: "Cosine" },
        });
      } catch (error) {
        if (!isQdrantAlreadyExistsError(error)) {
          if (allowSoftFail) {
            console.warn(
              "[WORKSPACES] Пропускаю создание векторной коллекции в тестовом окружении",
              error instanceof Error ? error.message : error,
            );
          } else {
            throw new WorkspaceVectorInitError(
              "Не удалось создать векторное хранилище для workspace. Проверьте доступность векторной БД.",
              isQdrantRetryableError(error),
            );
          }
        }
      }
    }

    await this.upsertCollectionWorkspace(collectionName, workspaceId);
    return collectionName;
  }

  async ensurePersonalWorkspace(user: User): Promise<Workspace> {
    await ensureWorkspaceMembersTable();

    const freePlan = await tariffPlanService.getPlanByCode("FREE");
    if (!freePlan) {
      throw new Error(
        "[workspaces] Тариф FREE не найден. Выполните seed тарифов (npm run seed:tariffs или node server/tariff-seed.ts) до создания рабочих пространств.",
      );
    }

    const existing = await this.db
      .select({ workspace: workspaces })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.role, "owner")))
      .orderBy(desc(workspaces.createdAt))
      .limit(1);

    if (existing[0]?.workspace) {
      return existing[0].workspace;
    }

    const ownedWorkspaces = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.ownerId, user.id))
      .orderBy(asc(workspaces.createdAt));

    if (ownedWorkspaces.length > 0) {
      for (const workspace of ownedWorkspaces) {
        await this.db
          .insert(workspaceMembers)
          .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
          .onConflictDoUpdate({
            target: [workspaceMembers.workspaceId, workspaceMembers.userId],
            set: { role: "owner", updatedAt: sql`CURRENT_TIMESTAMP` },
          });
      }

      return ownedWorkspaces[0];
    }

    const workspaceName = generatePersonalWorkspaceName(user);
    const [workspace] = await this.db
      .insert(workspaces)
      .values({
        name: workspaceName,
        ownerId: user.id,
        plan: "free",
        tariffPlanId: freePlan.id,
      })
      .returning();

    if (!workspace) {
      throw new Error("Не удалось создать рабочее пространство");
    }

    const [member] = await this.db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
      .returning();

    if (!member) {
      throw new Error("Не удалось сохранить участника рабочего пространства");
    }

    try {
      await this.ensureWorkspaceVectorCollection(workspace.id);
    } catch (error) {
      console.error("[WORKSPACES] Failed to ensure vector collection for workspace", {
        workspaceId: workspace.id,
        error: error instanceof Error ? error.message : error,
      });
      if (error instanceof WorkspaceVectorInitError) {
        throw error;
      }
      throw new WorkspaceVectorInitError(
        "Не удалось подготовить векторное хранилище для рабочего пространства",
        true,
      );
    }

    try {
      await createUnicaChatSkillForWorkspace(workspace.id);
    } catch (error) {
      console.error(`[WORKSPACES] Failed to create Unica Chat skill for workspace ${workspace.id}`, error);
    }

    return workspace;
  }

  async listUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]> {
    await ensureWorkspaceMembersTable();
    const rows: Array<{
      workspace: Workspace;
      role: WorkspaceMember["role"];
      ownerFullName: string | null;
      ownerEmail: string | null;
    }> = await this.db
      .select({
        workspace: workspaces,
        role: workspaceMembers.role,
        ownerFullName: users.fullName,
        ownerEmail: users.email,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .leftJoin(users, eq(users.id, workspaces.ownerId))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(desc(workspaces.createdAt));

    return rows.map(({ workspace, role, ownerFullName, ownerEmail }) => ({
      ...workspace,
      role,
      ownerFullName: ownerFullName ?? null,
      ownerEmail: ownerEmail ?? null,
    }));
  }

  async getOrCreateUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]> {
    let memberships = await this.listUserWorkspaces(userId);
    if (memberships.length > 0) {
      return memberships;
    }

    const fullUser = await this.getUser(userId);
    if (!fullUser) {
      return memberships;
    }

    await this.ensurePersonalWorkspace(fullUser);
    memberships = await this.listUserWorkspaces(userId);

    return memberships;
  }

  async getWorkspaceKnowledgeBaseCounts(workspaceIds: readonly string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();

    if (!workspaceIds || workspaceIds.length === 0) {
      return result;
    }

    await ensureKnowledgeBaseTables();

    const workspaceList = [...workspaceIds];

    const rows = await this.db
      .select({
        workspaceId: knowledgeBases.workspaceId,
        count: sql<number>`COUNT(${knowledgeBases.id})`,
      })
      .from(knowledgeBases)
      .where(inArray(knowledgeBases.workspaceId, workspaceList))
      .groupBy(knowledgeBases.workspaceId);

    for (const row of rows) {
      result.set(row.workspaceId, Number(row.count ?? 0));
    }

    return result;
  }

  async addWorkspaceMember(
    workspaceId: string,
    userId: string,
    role: WorkspaceMember["role"] = "user",
  ): Promise<WorkspaceMember | undefined> {
    await ensureWorkspaceMembersTable();
    const normalizedRole = workspaceMemberRoles.includes(role) ? role : "user";

    const [existing] = await this.db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    if (existing) {
      return existing;
    }

    const decision = await workspaceOperationGuard.check({
      workspaceId,
      operationType: "INVITE_WORKSPACE_MEMBER",
      expectedCost: { objects: 1 },
      meta: { objects: { entityType: "member" } },
    });
    if (!decision.allowed) {
      throw new OperationBlockedError(
        mapDecisionToPayload(decision, {
          workspaceId,
          operationType: "INVITE_WORKSPACE_MEMBER",
          meta: { objects: { entityType: "member" } },
        }),
      );
    }

    const [member] = await this.db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: normalizedRole })
      .returning();

    this.invalidateWorkspaceMembershipCache(userId, workspaceId);
    if (member) {
      const period = getUsagePeriodForDate(member.createdAt ?? new Date());
      await adjustWorkspaceObjectCounters(workspaceId, { membersDelta: 1 }, period);
    }
    return member ?? undefined;
  }

  async updateWorkspaceMemberRole(
    workspaceId: string,
    userId: string,
    role: WorkspaceMember["role"],
  ): Promise<WorkspaceMember | undefined> {
    await ensureWorkspaceMembersTable();
    const normalizedRole = workspaceMemberRoles.includes(role) ? role : "user";

    const [updated] = await this.db
      .update(workspaceMembers)
      .set({ role: normalizedRole, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .returning();

    this.invalidateWorkspaceMembershipCache(userId, workspaceId);
    return updated ?? undefined;
  }

  async listWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberWithUser[]> {
    await ensureWorkspaceMembersTable();
    const rows: Array<{ member: WorkspaceMember; user: User }> = await this.db
      .select({ member: workspaceMembers, user: users })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(desc(workspaceMembers.createdAt));

    return rows.map((row) => ({ member: row.member, user: row.user }));
  }

  async listAllWorkspacesWithStats(): Promise<WorkspaceAdminSummary[]> {
    await ensureWorkspacesTable();
    await ensureWorkspaceMembersTable();
    await this.ensureUserAuthColumns();

    const workspaceRows = await this.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        createdAt: workspaces.createdAt,
        usersCount: sql<number>`COUNT(${workspaceMembers.userId})`,
        tariffPlanId: workspaces.tariffPlanId,
        tariffPlanCode: tariffPlans.code,
        tariffPlanName: tariffPlans.name,
        defaultFileStorageProviderId: workspaces.defaultFileStorageProviderId,
        defaultFileStorageProviderName: fileStorageProviders.name,
      })
      .from(workspaces)
      .leftJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .leftJoin(tariffPlans, eq(tariffPlans.id, workspaces.tariffPlanId))
      .leftJoin(fileStorageProviders, eq(fileStorageProviders.id, workspaces.defaultFileStorageProviderId))
      .groupBy(workspaces.id, tariffPlans.id, fileStorageProviders.id)
      .orderBy(desc(workspaces.createdAt));

    type WorkspaceRow = (typeof workspaceRows)[number];

    const managerRows = await this.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        fullName: users.fullName,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(inArray(workspaceMembers.role, ["manager", "owner"]))
      .orderBy(workspaceMembers.workspaceId, workspaceMembers.createdAt);

    const managerByWorkspace = new Map<
      string,
      { fullName: string | null; role: WorkspaceMember["role"] }
    >();
    for (const row of managerRows) {
      const current = managerByWorkspace.get(row.workspaceId);
      if (!current || current.role !== "manager") {
        managerByWorkspace.set(row.workspaceId, {
          fullName: row.fullName ?? null,
          role: row.role,
        });
      }
    }

    return workspaceRows.map((row: WorkspaceRow): WorkspaceAdminSummary => {
      const manager = managerByWorkspace.get(row.id);
      return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        usersCount: Number(row.usersCount ?? 0),
        managerFullName: manager?.fullName ?? null,
        tariffPlanId: row.tariffPlanId ?? null,
        tariffPlanCode: row.tariffPlanCode ?? null,
        tariffPlanName: row.tariffPlanName ?? null,
        defaultFileStorageProviderId: row.defaultFileStorageProviderId ?? null,
        defaultFileStorageProviderName: row.defaultFileStorageProviderName ?? null,
      };
    });
  }

  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    await ensureWorkspaceMembersTable();
    const deleted = await this.db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .returning({ userId: workspaceMembers.userId });

    if (deleted.length > 0) {
      this.invalidateWorkspaceMembershipCache(userId, workspaceId);
      const period = getUsagePeriodForDate(new Date());
      await adjustWorkspaceObjectCounters(workspaceId, { membersDelta: -1 }, period);
    }
    return deleted.length > 0;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const [updatedUser] = await this.db
      .update(users)
      .set({ passwordHash, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  }

  async createUserPersonalApiToken(
    userId: string,
    token: { hash: string; lastFour: string },
  ): Promise<PersonalApiToken | undefined> {
    await this.ensureUserAuthColumns();
    const [createdToken] = await this.db
      .insert(personalApiTokens)
      .values({
        userId,
        tokenHash: token.hash,
        lastFour: token.lastFour,
      })
      .returning();
    return createdToken ?? undefined;
  }

  async listUserPersonalApiTokens(userId: string): Promise<PersonalApiToken[]> {
    await this.ensureUserAuthColumns();
    return await this.db
      .select()
      .from(personalApiTokens)
      .where(eq(personalApiTokens.userId, userId))
      .orderBy(desc(personalApiTokens.createdAt));
  }

  async revokeUserPersonalApiToken(
    userId: string,
    tokenId: string,
  ): Promise<PersonalApiToken | undefined> {
    await this.ensureUserAuthColumns();
    const [updatedToken] = await this.db
      .update(personalApiTokens)
      .set({ revokedAt: sql`CURRENT_TIMESTAMP` })
      .where(
        and(
          eq(personalApiTokens.id, tokenId),
          eq(personalApiTokens.userId, userId),
          isNull(personalApiTokens.revokedAt),
        ),
      )
      .returning();
    return updatedToken ?? undefined;
  }

  async setUserPersonalApiToken(
    userId: string,
    token: { hash: string | null; lastFour: string | null; generatedAt?: Date | string | null },
  ): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const generatedAtValue =
      token.generatedAt === undefined
        ? token.hash
          ? sql`CURRENT_TIMESTAMP`
          : null
        : token.generatedAt === null
          ? null
          : new Date(token.generatedAt);

    const [updatedUser] = await this.db
      .update(users)
      .set({
        personalApiTokenHash: token.hash ?? null,
        personalApiTokenLastFour: token.lastFour ?? null,
        personalApiTokenGeneratedAt: generatedAtValue,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(users.id, userId))
      .returning();
    return updatedUser ?? undefined;
  }

  async getUserByPersonalApiTokenHash(hash: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();

    const [result] = await this.db
      .select({ user: users })
      .from(personalApiTokens)
      .innerJoin(users, eq(personalApiTokens.userId, users.id))
      .where(and(eq(personalApiTokens.tokenHash, hash), isNull(personalApiTokens.revokedAt)))
      .orderBy(desc(personalApiTokens.createdAt))
      .limit(1);

    return result?.user ?? undefined;
  }

  async getAuthProvider(provider: AuthProviderType): Promise<AuthProvider | undefined> {
    await ensureAuthProvidersTable();

    const [existing] = await this.db
      .select()
      .from(authProviders)
      .where(eq(authProviders.provider, provider))
      .limit(1);

    return existing ?? undefined;
  }

  async upsertAuthProvider(
    provider: AuthProviderType,
    updates: Partial<AuthProviderInsert>,
  ): Promise<AuthProvider> {
    await ensureAuthProvidersTable();

    const normalizedProvider = provider;
    const defaultCallbackUrl = `/api/auth/${normalizedProvider}/callback`;
    const [existing] = await this.db
      .select()
      .from(authProviders)
      .where(eq(authProviders.provider, normalizedProvider))
      .limit(1);

    const trimmedClientId = updates.clientId?.trim();
    const trimmedClientSecret = updates.clientSecret?.trim();
    const trimmedCallbackUrl = updates.callbackUrl?.trim();

    if (existing) {
      const updatePayload: Partial<AuthProviderInsert> = {};

      if (updates.isEnabled !== undefined) {
        updatePayload.isEnabled = updates.isEnabled;
      }

      if (trimmedClientId !== undefined) {
        updatePayload.clientId = trimmedClientId;
      }

      if (trimmedClientSecret !== undefined) {
        updatePayload.clientSecret = trimmedClientSecret;
      }

      if (trimmedCallbackUrl !== undefined) {
        updatePayload.callbackUrl = trimmedCallbackUrl;
      }

      updatePayload.updatedAt = new Date();

      const [updated] = await this.db
        .update(authProviders)
        .set(updatePayload)
        .where(eq(authProviders.provider, normalizedProvider))
        .returning();

      return updated ?? existing;
    }

    const insertPayload: AuthProviderInsert = {
      provider: normalizedProvider,
      isEnabled: updates.isEnabled ?? false,
      clientId: trimmedClientId ?? "",
      clientSecret: trimmedClientSecret ?? "",
      callbackUrl: trimmedCallbackUrl ?? defaultCallbackUrl,
    };

    const [created] = await this.db.insert(authProviders).values(insertPayload).returning();

    if (!created) {
      throw new Error("Не удалось сохранить настройки провайдера аутентификации");
    }

    return created;
  }

}

export const storage = new DatabaseStorage();

export async function ensureDatabaseSchema(): Promise<void> {
  try {
    const uuidExpression = await getUuidGenerationExpression();
    const randomHex32Expression = await getRandomHexExpression(32);
    // Обновление схемы таблицы пользователей для поддержки авторизации по email
    const emailColumnCheck = await db.execute(sql`
      SELECT COUNT(*)::int AS "emailColumnCount"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'email'
    `);
    const emailColumnCount = Number(emailColumnCheck.rows[0]?.emailColumnCount ?? 0);

    if (emailColumnCount === 0) {
      const usernameColumnCheck = await db.execute(sql`
        SELECT COUNT(*)::int AS "usernameColumnCount"
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'username'
      `);
      const usernameColumnCount = Number(usernameColumnCheck.rows[0]?.usernameColumnCount ?? 0);

      if (usernameColumnCount > 0) {
        await db.execute(sql`ALTER TABLE "users" RENAME COLUMN "username" TO "email"`);
      } else {
        try {
          await db.execute(sql`ALTER TABLE "users" ADD COLUMN "email" text`);
        } catch (error) {
          swallowPgError(error, ["42701"]);
        }
      }
    }

    const passwordColumnCheck = await db.execute(sql`
      SELECT COUNT(*)::int AS "passwordColumnCount"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'password'
    `);
    const passwordColumnCount = Number(passwordColumnCheck.rows[0]?.passwordColumnCount ?? 0);

    if (passwordColumnCount > 0) {
      await db.execute(sql`ALTER TABLE "users" RENAME COLUMN "password" TO "password_hash"`);
    }

    await db.execute(sql`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_unique"`);

    const emailUniqueConstraintCheck = await db.execute(sql`
      SELECT COUNT(*)::int AS "emailUniqueConstraintCount"
      FROM pg_constraint
      WHERE conrelid = 'public.users'::regclass
        AND conname = 'users_email_unique'
    `);
    const emailUniqueConstraintCount = Number(
      emailUniqueConstraintCheck.rows[0]?.emailUniqueConstraintCount ?? 0
    );

    if (emailUniqueConstraintCount === 0) {
      await db.execute(sql`ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE ("email")`);
    }
    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "full_name" text`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }
    await db.execute(sql`UPDATE "users" SET "full_name" = COALESCE("full_name", 'Новый пользователь')`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "full_name" SET NOT NULL`);

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user'`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }
    await db.execute(sql`UPDATE "users" SET "role" = COALESCE("role", 'user')`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL`);

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "last_active_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }
    await db.execute(sql`UPDATE "users" SET "last_active_at" = COALESCE("last_active_at", "updated_at", CURRENT_TIMESTAMP)`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "last_active_at" SET NOT NULL`);

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "created_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }
    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }
    await db.execute(sql`
      UPDATE "users"
      SET
        "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
        "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
    `);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "updated_at" SET NOT NULL`);

    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`);

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "google_id" text`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "google_avatar" text DEFAULT ''`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`UPDATE "users" SET "google_avatar" = COALESCE("google_avatar", '')`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "google_avatar" SET DEFAULT ''`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "google_avatar" SET NOT NULL`);

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "google_email_verified" boolean DEFAULT FALSE`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(
      sql`UPDATE "users" SET "google_email_verified" = COALESCE("google_email_verified", FALSE)`
    );
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "google_email_verified" SET DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "google_email_verified" SET NOT NULL`);

    const googleIdUniqueConstraintCheck = await db.execute(sql`
      SELECT COUNT(*)::int AS "googleIdUniqueConstraintCount"
      FROM pg_constraint
      WHERE conrelid = 'public.users'::regclass
        AND conname = 'users_google_id_unique'
    `);
    const googleIdUniqueConstraintCount = Number(
      googleIdUniqueConstraintCheck.rows[0]?.googleIdUniqueConstraintCount ?? 0
    );

    if (googleIdUniqueConstraintCount === 0) {
      await db.execute(sql`ALTER TABLE "users" ADD CONSTRAINT "users_google_id_unique" UNIQUE ("google_id")`);
    }

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "yandex_id" text`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "yandex_avatar" text DEFAULT ''`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`UPDATE "users" SET "yandex_avatar" = COALESCE("yandex_avatar", '')`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "yandex_avatar" SET DEFAULT ''`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "yandex_avatar" SET NOT NULL`);

    try {
      await db.execute(sql`ALTER TABLE "users" ADD COLUMN "yandex_email_verified" boolean DEFAULT FALSE`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(
      sql`UPDATE "users" SET "yandex_email_verified" = COALESCE("yandex_email_verified", FALSE)`
    );
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "yandex_email_verified" SET DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "yandex_email_verified" SET NOT NULL`);

    const yandexIdUniqueConstraintCheck = await db.execute(sql`
      SELECT COUNT(*)::int AS "yandexIdUniqueConstraintCount"
      FROM pg_constraint
      WHERE conrelid = 'public.users'::regclass
        AND conname = 'users_yandex_id_unique'
    `);
    const yandexIdUniqueConstraintCount = Number(
      yandexIdUniqueConstraintCheck.rows[0]?.yandexIdUniqueConstraintCount ?? 0
    );

    if (yandexIdUniqueConstraintCount === 0) {
      await db.execute(sql`ALTER TABLE "users" ADD CONSTRAINT "users_yandex_id_unique" UNIQUE ("yandex_id")`);
    }

    try {
      await db.execute(sql`ALTER TABLE "sites" ADD COLUMN "owner_id" varchar`);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    const upsertUser = await db.execute(sql`
      WITH upsert_user AS (
        INSERT INTO "users" ("email", "full_name", "password_hash")
        VALUES (
          'forlandeivan@gmail.com',
          'Иван Фролов',
          '$2b$12$fYPpL/EqGB.IykWRGbSN3uYJQYNmD4fj7UncIr6zV2zMCemnbj6kC'
        )
        ON CONFLICT ("email") DO UPDATE SET
          "full_name" = EXCLUDED."full_name",
          "password_hash" = EXCLUDED."password_hash",
          "updated_at" = CURRENT_TIMESTAMP
        RETURNING id
      )
      SELECT id FROM upsert_user
    `);

    const upsertedUserId = upsertUser.rows[0]?.id as string | undefined;

    if (upsertedUserId) {
      await db.execute(sql`
        UPDATE "sites"
        SET "owner_id" = ${upsertedUserId}
        WHERE "owner_id" IS NULL
      `);
    }

    await db.execute(sql`
      UPDATE "users"
      SET "role" = 'admin'
      WHERE "email" = 'forlandeivan@gmail.com'
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD CONSTRAINT "sites_owner_id_users_id_fk"
        FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade
      `);
    } catch (error) {
      swallowPgError(error, ["42710"]);
    }
    await db.execute(sql`ALTER TABLE "sites" ALTER COLUMN "owner_id" SET NOT NULL`);

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "name" text DEFAULT 'Новый проект'
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "sites"
      SET "name" = COALESCE(NULLIF("name", ''), CASE
        WHEN "url" IS NOT NULL AND "url" <> '' THEN 'Проект ' || split_part("url", '://', 2)
        ELSE 'Новый проект'
      END)
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "name" SET NOT NULL,
      ALTER COLUMN "name" SET DEFAULT 'Новый проект'
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "start_urls" jsonb DEFAULT '[]'::jsonb
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "sites"
      SET "start_urls" = CASE
        WHEN jsonb_typeof("start_urls") = 'array' AND jsonb_array_length("start_urls") > 0 THEN "start_urls"
        WHEN "url" IS NOT NULL AND "url" <> '' THEN jsonb_build_array("url")
        ELSE '[]'::jsonb
      END
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "start_urls" SET NOT NULL,
      ALTER COLUMN "start_urls" SET DEFAULT '[]'::jsonb
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "max_chunk_size" integer DEFAULT 1200
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "sites"
      SET "max_chunk_size" = COALESCE("max_chunk_size", 1200)
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "max_chunk_size" SET NOT NULL,
      ALTER COLUMN "max_chunk_size" SET DEFAULT 1200
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "chunk_overlap" boolean DEFAULT FALSE
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "workspace_id" varchar
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "owner_id" varchar
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await ensureEmbeddingProvidersTable();

    await db.execute(sql`
      UPDATE "sites"
      SET "chunk_overlap" = COALESCE("chunk_overlap", FALSE)
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "chunk_overlap" SET NOT NULL,
      ALTER COLUMN "chunk_overlap" SET DEFAULT FALSE
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "chunk_overlap_size" integer DEFAULT 0
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "sites"
      SET "chunk_overlap_size" = COALESCE("chunk_overlap_size", 0)
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "chunk_overlap_size" SET NOT NULL,
      ALTER COLUMN "chunk_overlap_size" SET DEFAULT 0
    `);

    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    } catch (error) {
      swallowPgError(error, ["42710", "42501"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "public_id" varchar
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "public_api_key" text
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD COLUMN "public_api_key_generated_at" timestamp
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await db.execute(sql`
      UPDATE "sites"
      SET
        "public_id" = COALESCE("public_id", (${uuidExpression})::text),
        "public_api_key" = COALESCE("public_api_key", ${randomHex32Expression}),
        "public_api_key_generated_at" = COALESCE("public_api_key_generated_at", CURRENT_TIMESTAMP)
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "public_id" SET NOT NULL,
      ALTER COLUMN "public_api_key" SET NOT NULL,
      ALTER COLUMN "public_api_key_generated_at" SET NOT NULL
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "public_id" SET DEFAULT ${uuidExpression},
      ALTER COLUMN "public_api_key" SET DEFAULT ${randomHex32Expression},
      ALTER COLUMN "public_api_key_generated_at" SET DEFAULT CURRENT_TIMESTAMP
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD CONSTRAINT "sites_public_id_unique" UNIQUE("public_id")
      `);
    } catch (error) {
      swallowPgError(error, ["42710", "42P07"]);
    }

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "crawl_frequency" SET DEFAULT 'manual'
    `);

    await db.execute(sql`
      UPDATE "sites"
      SET "crawl_frequency" = COALESCE(NULLIF("crawl_frequency", ''), 'manual')
    `);

    await ensureWorkspaceVectorCollectionsTable();
    await ensureKnowledgeBaseTables();

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "skills" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "name" text,
        "description" text,
        "system_prompt" text,
        "model_id" varchar,
        "llm_provider_config_id" varchar REFERENCES "llm_providers"("id") ON DELETE SET NULL,
        "collection_name" text REFERENCES "workspace_vector_collections"("collection_name") ON DELETE SET NULL,
        "rag_mode" text NOT NULL DEFAULT 'all_collections',
        "rag_collection_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "rag_top_k" integer NOT NULL DEFAULT 5,
        "rag_min_score" double precision NOT NULL DEFAULT 0.7,
        "rag_max_context_tokens" integer DEFAULT 3000,
        "rag_show_sources" boolean NOT NULL DEFAULT true,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "skill_knowledge_bases" (
        "skill_id" varchar NOT NULL REFERENCES "skills"("id") ON DELETE CASCADE,
        "knowledge_base_id" varchar NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
        "workspace_id" varchar NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT skill_knowledge_bases_pk PRIMARY KEY ("skill_id", "knowledge_base_id")
      )
    `);

    await db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS skills_workspace_idx
        ON "skills" ("workspace_id")
    `);

    await db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS skills_llm_provider_config_idx
        ON "skills" ("llm_provider_config_id")
    `);

    await db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS skills_collection_name_idx
        ON "skills" ("collection_name")
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_mode" text NOT NULL DEFAULT 'all_collections'
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_collection_ids" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_top_k" integer NOT NULL DEFAULT 5
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_min_score" double precision NOT NULL DEFAULT 0.7
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_max_context_tokens" integer DEFAULT 3000
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_show_sources" boolean NOT NULL DEFAULT true
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "is_system" boolean NOT NULL DEFAULT false
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "system_key" text
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "execution_mode" text NOT NULL DEFAULT 'standard'
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_bm25_weight" double precision
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_bm25_limit" integer
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_vector_weight" double precision
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_vector_limit" integer
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_embedding_provider_id" varchar
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_llm_temperature" double precision
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_llm_max_tokens" integer
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "rag_llm_response_format" text
    `);

    await db.execute(sql`
      ALTER TABLE "skills"
      ADD COLUMN IF NOT EXISTS "icon" text
    `);

    try {
      await db.execute(sql`
        CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS skills_workspace_system_key_unique_idx
        ON "skills" ("workspace_id", "system_key")
      `);
    } catch (error) {
      swallowPgError(error, ["42710", "42P07"]);
    }

    await db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS skill_knowledge_bases_workspace_idx
        ON "skill_knowledge_bases" ("workspace_id")
    `);

    await db.execute(sql`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS skill_knowledge_bases_knowledge_base_idx
        ON "skill_knowledge_bases" ("knowledge_base_id")
    `);

    globalUserAuthSchemaReady = true;
  } catch (error) {
    console.error("[storage] Не удалось обновить схему базы данных", error);
    throw error;
  }
}
