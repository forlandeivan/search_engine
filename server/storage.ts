import {
  sites,
  pages,
  searchIndex,
  users,
  personalApiTokens,
  embeddingProviders,
  llmProviders,
  authProviders,
  workspaces,
  workspaceMembers,
  workspaceVectorCollections,
  workspaceMemberRoles,
  knowledgeBases,
  knowledgeNodes,
  knowledgeDocuments,
  knowledgeDocumentChunkItems,
  knowledgeDocumentChunkSets,
  type Site,
  type SiteInsert,
  type Page,
  type InsertPage,
  type SearchIndexEntry,
  type InsertSearchIndexEntry,
  type User,
  type PersonalApiToken,
  type InsertUser,
  type EmbeddingProvider,
  type EmbeddingProviderInsert,
  type LlmProvider,
  type LlmProviderInsert,
  type Workspace,
  type WorkspaceMember,
  type AuthProvider,
  type AuthProviderInsert,
  type AuthProviderType,
} from "@shared/schema";
import { db } from "./db";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { randomBytes } from "crypto";

let globalUserAuthSchemaReady = false;

type PgError = Error & { code?: string };

function isPgError(error: unknown): error is PgError {
  return typeof error === "object" && error !== null && "message" in error;
}

type KnowledgeBaseRow = typeof knowledgeBases.$inferSelect;

export type KnowledgeChunkSearchEntry = {
  chunkId: string;
  documentId: string;
  docTitle: string;
  sectionTitle: string | null;
  snippet: string;
  text: string;
  score: number;
  source: "sections" | "content";
};

function swallowPgError(error: unknown, allowedCodes: string[]): void {
  if (!isPgError(error)) {
    throw error;
  }

  const code = (error as PgError).code;
  if (!code || !allowedCodes.includes(code)) {
    throw error;
  }
}

function getRowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
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

export type WorkspaceWithRole = Workspace & { role: WorkspaceMember["role"] };
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
}

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

  // Pages management
  createPage(page: InsertPage): Promise<Page>;
  getPage(id: string, workspaceId?: string): Promise<Page | undefined>;
  getAllPages(workspaceId?: string): Promise<Page[]>;
  getPagesByUrl(url: string): Promise<Page[]>;
  getPagesBySiteId(siteId: string, workspaceId?: string): Promise<Page[]>;
  updatePage(id: string, updates: Partial<Page>, workspaceId?: string): Promise<Page | undefined>;
  deletePage(id: string, workspaceId?: string): Promise<boolean>;
  bulkDeletePages(pageIds: string[], workspaceId?: string): Promise<{ deletedCount: number; notFoundCount: number }>;
  deletePagesBySiteId(siteId: string, workspaceId?: string): Promise<number>;

  // Search index management
  createSearchIndexEntry(entry: InsertSearchIndexEntry): Promise<SearchIndexEntry>;
  deleteSearchIndexByPageId(pageId: string): Promise<number>;
  searchPages(
    query: string,
    limit?: number,
    offset?: number,
    workspaceId?: string,
  ): Promise<{ results: Page[]; total: number }>;
  searchPagesByCollection(
    query: string,
    siteId: string,
    limit?: number,
    offset?: number,
    workspaceId?: string,
  ): Promise<{ results: Page[]; total: number }>;

  // Vector collections ownership
  listWorkspaceCollections(workspaceId: string): Promise<string[]>;
  getCollectionWorkspace(collectionName: string): Promise<string | null>;
  upsertCollectionWorkspace(collectionName: string, workspaceId: string): Promise<void>;
  removeCollectionWorkspace(collectionName: string): Promise<void>;

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
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  getUserByYandexId(yandexId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  upsertUserFromGoogle(payload: GoogleUserUpsertPayload): Promise<User>;
  upsertUserFromYandex(payload: YandexUserUpsertPayload): Promise<User>;
  listUsers(): Promise<User[]>;
  updateUserRole(userId: string, role: User["role"]): Promise<User | undefined>;
  recordUserActivity(userId: string): Promise<User | undefined>;
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
  isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
  ensurePersonalWorkspace(user: User): Promise<Workspace>;
  listUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]>;
  getOrCreateUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]>;
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
}

function buildWhereClause(conditions: SQL[]): SQL {
  if (conditions.length === 0) {
    return sql`TRUE`;
  }
  return sql.join(conditions, sql` AND `);
}

let embeddingProvidersTableEnsured = false;
let ensuringEmbeddingProvidersTable: Promise<void> | null = null;

let llmProvidersTableEnsured = false;
let ensuringLlmProvidersTable: Promise<void> | null = null;

let authProvidersTableEnsured = false;
let ensuringAuthProvidersTable: Promise<void> | null = null;

let workspacesTableEnsured = false;
let ensuringWorkspacesTable: Promise<void> | null = null;

let workspaceMembersTableEnsured = false;
let ensuringWorkspaceMembersTable: Promise<void> | null = null;

let workspaceCollectionsTableEnsured = false;
let ensuringWorkspaceCollectionsTable: Promise<void> | null = null;

let knowledgeBaseTablesEnsured = false;
let ensuringKnowledgeBaseTables: Promise<void> | null = null;
let knowledgeBasePathUsesLtree: boolean | null = null;

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
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "workspaces" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "name" text NOT NULL,
        "owner_id" varchar NOT NULL,
        "plan" text NOT NULL DEFAULT 'free',
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
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
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
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
      CREATE TABLE IF NOT EXISTS "knowledge_document_chunk_sets" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL,
        "document_id" varchar NOT NULL,
        "version_id" varchar NOT NULL,
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

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_chunk_sets_document_idx ON knowledge_document_chunk_sets("document_id", "created_at" DESC)`,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_chunk_sets_document_latest_idx ON knowledge_document_chunk_sets("document_id", "is_latest")`,
    );

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "knowledge_document_chunks" (
        "id" varchar PRIMARY KEY DEFAULT ${uuidExpression},
        "workspace_id" varchar NOT NULL,
        "chunk_set_id" varchar NOT NULL,
        "document_id" varchar NOT NULL,
        "version_id" varchar NOT NULL,
        "chunk_index" integer NOT NULL,
        "text" text NOT NULL,
        "char_start" integer NOT NULL,
        "char_end" integer NOT NULL,
        "token_count" integer NOT NULL,
        "page_number" integer,
        "section_path" text[],
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "content_hash" text NOT NULL,
        "vector_record_id" text,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

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

    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS knowledge_document_chunks_set_index_idx ON knowledge_document_chunks("chunk_set_id", "chunk_index")`,
    );

    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS knowledge_document_chunks_document_idx ON knowledge_document_chunks("document_id", "chunk_index")`,
    );

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

    await db.execute(sql`
      ALTER TABLE "knowledge_document_chunks"
      ADD COLUMN IF NOT EXISTS "text_tsv" tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('simple', COALESCE("metadata"->>'heading', '')), 'A') ||
          setweight(to_tsvector('russian', COALESCE("metadata"->>'firstSentence', '')), 'B') ||
          setweight(to_tsvector('russian', COALESCE("text", '')), 'C')
        ) STORED
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS knowledge_document_chunks_text_tsv_idx
      ON "knowledge_document_chunks"
      USING GIN ("text_tsv")
    `);

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
  })();

  try {
    await ensuringEmbeddingProvidersTable;
    embeddingProvidersTableEnsured = true;
  } finally {
    ensuringEmbeddingProvidersTable = null;
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
  })();

  try {
    await ensuringLlmProvidersTable;
    llmProvidersTableEnsured = true;
  } finally {
    ensuringLlmProvidersTable = null;
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
        swallowPgError(error, ["42P07", "42710"]);
      }

      try {
        await this.db.execute(sql`
          CREATE INDEX "personal_api_tokens_active_idx"
            ON "personal_api_tokens" ("user_id")
            WHERE "revoked_at" IS NULL
        `);
      } catch (error) {
        swallowPgError(error, ["42P07", "42710"]);
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

  async createPage(page: InsertPage): Promise<Page> {
    const [siteWorkspace] = await this.db
      .select({ workspaceId: sites.workspaceId })
      .from(sites)
      .where(eq(sites.id, page.siteId));

    if (!siteWorkspace) {
      throw new Error(`Не удалось определить рабочее пространство для проекта ${page.siteId}`);
    }

    const [newPage] = await this.db
      .insert(pages)
      .values({ ...page, workspaceId: siteWorkspace.workspaceId })
      .returning();
    return newPage;
  }

  async getPage(id: string, workspaceId?: string): Promise<Page | undefined> {
    const condition = workspaceId
      ? and(eq(pages.id, id), eq(pages.workspaceId, workspaceId))
      : eq(pages.id, id);

    const [page] = await this.db.select().from(pages).where(condition);
    return page ?? undefined;
  }

  async getAllPages(workspaceId?: string): Promise<Page[]> {
    const query = workspaceId
      ? this.db.select().from(pages).where(eq(pages.workspaceId, workspaceId))
      : this.db.select().from(pages);

    return await query.orderBy(desc(pages.createdAt));
  }

  async getPagesByUrl(url: string): Promise<Page[]> {
    return await this.db.select().from(pages).where(eq(pages.url, url));
  }

  async getPagesBySiteId(siteId: string, workspaceId?: string): Promise<Page[]> {
    if (workspaceId) {
      const site = await this.getSite(siteId, workspaceId);
      if (!site) {
        return [];
      }
    }

    return await this.db
      .select()
      .from(pages)
      .where(eq(pages.siteId, siteId))
      .orderBy(desc(pages.lastCrawled));
  }

  async updatePage(id: string, updates: Partial<Page>, workspaceId?: string): Promise<Page | undefined> {
    if (workspaceId) {
      const page = await this.getPage(id, workspaceId);
      if (!page) {
        return undefined;
      }
    }

    const [updatedPage] = await this.db
      .update(pages)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(pages.id, id))
      .returning();
    return updatedPage ?? undefined;
  }

  async deletePage(id: string, workspaceId?: string): Promise<boolean> {
    if (workspaceId) {
      const page = await this.getPage(id, workspaceId);
      if (!page) {
        return false;
      }
    }

    await this.db.delete(searchIndex).where(eq(searchIndex.pageId, id));
    const result = await this.db.delete(pages).where(eq(pages.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async bulkDeletePages(pageIds: string[], workspaceId?: string): Promise<{ deletedCount: number; notFoundCount: number }> {
    if (pageIds.length === 0) {
      return { deletedCount: 0, notFoundCount: 0 };
    }

    let accessibleIds: string[];

    if (workspaceId) {
      const rows: Array<{ id: string }> = await this.db
        .select({ id: pages.id })
        .from(pages)
        .where(and(inArray(pages.id, pageIds), eq(pages.workspaceId, workspaceId)));

      accessibleIds = rows.map((row) => row.id);
    } else {
      const rows: Array<{ id: string }> = await this.db
        .select({ id: pages.id })
        .from(pages)
        .where(inArray(pages.id, pageIds));

      accessibleIds = rows.map((row) => row.id);
    }

    const existingPageIds = new Set<string>(accessibleIds);

    const notFoundCount = pageIds.length - existingPageIds.size;

    if (existingPageIds.size === 0) {
      return { deletedCount: 0, notFoundCount };
    }

    const ids = Array.from(existingPageIds.values());
    await this.db.delete(searchIndex).where(inArray(searchIndex.pageId, ids));
    const deleteResult = await this.db.delete(pages).where(inArray(pages.id, ids));

    return {
      deletedCount: deleteResult.rowCount ?? 0,
      notFoundCount,
    };
  }

  async deletePagesBySiteId(siteId: string, workspaceId?: string): Promise<number> {
    if (workspaceId) {
      const site = await this.getSite(siteId, workspaceId);
      if (!site) {
        return 0;
      }
    }

    const result = await this.db.delete(pages).where(eq(pages.siteId, siteId));
    return result.rowCount ?? 0;
  }

  async createSearchIndexEntry(entry: InsertSearchIndexEntry): Promise<SearchIndexEntry> {
    const [pageWorkspace] = await this.db
      .select({ workspaceId: pages.workspaceId })
      .from(pages)
      .where(eq(pages.id, entry.pageId));

    if (!pageWorkspace) {
      throw new Error(`Не найдена страница ${entry.pageId} для добавления в индекс`);
    }

    const [newEntry] = await this.db
      .insert(searchIndex)
      .values({ ...entry, workspaceId: pageWorkspace.workspaceId })
      .returning();
    return newEntry;
  }

  async deleteSearchIndexByPageId(pageId: string): Promise<number> {
    const result = await this.db.delete(searchIndex).where(eq(searchIndex.pageId, pageId));
    return result.rowCount ?? 0;
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

    await ensureEmbeddingProvidersTable();

    const providerRows = await this.db
      .select({ qdrantConfig: embeddingProviders.qdrantConfig })
      .from(embeddingProviders)
      .where(eq(embeddingProviders.workspaceId, workspaceId));

    for (const { qdrantConfig } of providerRows) {
      const candidate =
        qdrantConfig && typeof qdrantConfig === "object"
          ? (qdrantConfig as Record<string, unknown>).collectionName
          : undefined;

      if (typeof candidate === "string") {
        const normalized = candidate.trim();
        if (normalized.length > 0) {
          collectionNames.add(normalized);
        }
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

  async getKnowledgeBase(baseId: string): Promise<KnowledgeBaseRow | null> {
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
      const normalized = await this.db.execute(sql`SELECT unaccent(${cleanQuery}) AS value`);
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
          unaccent(${cleanQuery})::text AS normalized_query
      )
      SELECT
        chunk.id AS chunk_id,
        chunk.document_id,
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
            websearch_to_tsquery('russian', unaccent(${cleanQuery})) AS ts_query
        ), ranked AS (
          SELECT
            chunk.id AS chunk_id,
            chunk.document_id,
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

      const sectionTitleRaw = rowRecord.section_title;
      const resolvedTitle =
        typeof sectionTitleRaw === "string" && sectionTitleRaw.trim().length > 0
          ? sectionTitleRaw.trim()
          : docTitle;

      const text = getRowString(rowRecord, "text");

      const snippet = text.length > 320 ? `${text.slice(0, 320)}…` : text;
      const score = Number(rowRecord.score ?? 0) || 0;

      combined.set(chunkId, {
        chunkId,
        documentId: String(rowRecord.document_id ?? ""),
        docTitle,
        sectionTitle: resolvedTitle,
        snippet,
        text,
        score,
        source: "sections",
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

      if (!existing || rank > existing.score) {
        combined.set(chunkId, {
          chunkId,
          documentId: String(rowRecord.document_id ?? ""),
          docTitle,
          sectionTitle: resolvedTitle,
          snippet: snippetValue,
          text,
          score: rank,
          source: "content",
        });
      }
    }

    const sections = Array.from(combined.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { normalizedQuery, sections };
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

      return {
        chunkId: row.chunkId,
        documentId: row.documentId,
        docTitle: row.docTitle ?? "",
        sectionTitle,
        text: row.text ?? "",
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

      return {
        chunkId: row.chunkId,
        documentId: row.documentId,
        docTitle: row.docTitle ?? "",
        sectionTitle,
        text: row.text ?? "",
        vectorRecordId: row.vectorRecordId ?? null,
      };
    });
  }

  private buildWorkspaceCondition(workspaceId?: string): SQL | undefined {
    if (!workspaceId) {
      return undefined;
    }

    return sql`p.workspace_id = ${workspaceId}`;
  }

  private async runFullTextSearch(
    query: string,
    limit: number,
    offset: number,
    additionalConditions: SQL[],
    workspaceId?: string,
  ): Promise<{ rows: Page[]; total: number }> {
    const tsQuery = sql`plainto_tsquery('english', ${query})`;
    const ownerCondition = this.buildWorkspaceCondition(workspaceId);
    const conditions = [sql`p.search_vector_combined @@ ${tsQuery}`, ...additionalConditions];
    if (ownerCondition) {
      conditions.push(ownerCondition);
    }
    const whereClause = buildWhereClause(conditions);

    const results = await this.db.execute(sql`
      SELECT p.*, ts_rank(p.search_vector_combined, ${tsQuery}) AS score
      FROM pages p
      WHERE ${whereClause}
      ORDER BY score DESC, p.last_crawled DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await this.db.execute(sql`
      SELECT COUNT(*) as count
      FROM pages p
      WHERE ${whereClause}
    `);

    const total = Number(countResult.rows[0]?.count ?? 0);
    return { rows: results.rows as Page[], total };
  }

  private async runFallbackSearch(
    query: string,
    limit: number,
    offset: number,
    additionalConditions: SQL[],
    workspaceId?: string,
  ): Promise<{ results: Page[]; total: number }> {
    const likeCondition = sql`(
      COALESCE(p.title, '') ILIKE '%' || ${query} || '%'
      OR COALESCE(p.content, '') ILIKE '%' || ${query} || '%'
    )`;
    const ownerCondition = this.buildWorkspaceCondition(workspaceId);
    const conditions = [...additionalConditions, likeCondition];
    if (ownerCondition) {
      conditions.push(ownerCondition);
    }
    const whereClause = buildWhereClause(conditions);

    const results = await this.db.execute(sql`
      SELECT p.*
      FROM pages p
      WHERE ${whereClause}
      ORDER BY p.last_crawled DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await this.db.execute(sql`
      SELECT COUNT(*) as count
      FROM pages p
      WHERE ${whereClause}
    `);

    const total = Number(countResult.rows[0]?.count ?? 0);
    return { results: results.rows as Page[], total };
  }

  async searchPages(
    query: string,
    limit: number = 10,
    offset: number = 0,
    workspaceId?: string,
  ): Promise<{ results: Page[]; total: number }> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { results: [], total: 0 };
    }

    const { rows, total } = await this.runFullTextSearch(cleanQuery, limit, offset, [], workspaceId);
    if (total > 0) {
      return { results: rows, total };
    }

    return await this.runFallbackSearch(cleanQuery, limit, offset, [], workspaceId);
  }

  async searchPagesByCollection(
    query: string,
    siteId: string,
    limit: number = 10,
    offset: number = 0,
    workspaceId?: string,
  ): Promise<{ results: Page[]; total: number }> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { results: [], total: 0 };
    }

    const additionalConditions = [sql`p.site_id = ${siteId}`];
    const { rows, total } = await this.runFullTextSearch(cleanQuery, limit, offset, additionalConditions, workspaceId);
    if (total > 0) {
      return { results: rows, total };
    }

    return await this.runFallbackSearch(cleanQuery, limit, offset, [sql`p.site_id = ${siteId}`], workspaceId);
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
      query = query.where(eq(embeddingProviders.workspaceId, workspaceId));
    }
    return await query.orderBy(desc(embeddingProviders.createdAt));
  }

  async getEmbeddingProvider(id: string, workspaceId?: string): Promise<EmbeddingProvider | undefined> {
    await ensureEmbeddingProvidersTable();
    const condition = workspaceId
      ? and(eq(embeddingProviders.id, id), eq(embeddingProviders.workspaceId, workspaceId))
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
      query = query.where(eq(llmProviders.workspaceId, workspaceId));
    }
    return await query.orderBy(desc(llmProviders.createdAt));
  }

  async getLlmProvider(id: string, workspaceId?: string): Promise<LlmProvider | undefined> {
    await ensureLlmProvidersTable();
    const condition = workspaceId
      ? and(eq(llmProviders.id, id), eq(llmProviders.workspaceId, workspaceId))
      : eq(llmProviders.id, id);
    const [provider] = await this.db.select().from(llmProviders).where(condition);
    return provider ?? undefined;
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

    if (Object.keys(sanitizedUpdates).length === 0) {
      return await this.getLlmProvider(id, workspaceId);
    }

    const condition = workspaceId
      ? and(eq(llmProviders.id, id), eq(llmProviders.workspaceId, workspaceId))
      : eq(llmProviders.id, id);

    const [updated] = await this.db
      .update(llmProviders)
      .set({ ...sanitizedUpdates, updatedAt: sql`CURRENT_TIMESTAMP` })
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

  async getUser(id: string): Promise<User | undefined> {
    await this.ensureUserAuthColumns();
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    return user ?? undefined;
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
    await this.ensurePersonalWorkspace(newUser);
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

  async isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    await ensureWorkspaceMembersTable();
    const [row] = await this.db
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .limit(1);

    return Boolean(row);
  }

  async ensurePersonalWorkspace(user: User): Promise<Workspace> {
    await ensureWorkspaceMembersTable();

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

    const workspaceName = generatePersonalWorkspaceName(user);
    const [workspace] = await this.db
      .insert(workspaces)
      .values({
        name: workspaceName,
        ownerId: user.id,
        plan: "free",
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

    return workspace;
  }

  async listUserWorkspaces(userId: string): Promise<WorkspaceWithRole[]> {
    await ensureWorkspaceMembersTable();
    const rows: Array<{ workspace: Workspace; role: WorkspaceMember["role"] }> = await this.db
      .select({ workspace: workspaces, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, userId))
      .orderBy(desc(workspaces.createdAt));

    return rows.map(({ workspace, role }) => ({ ...workspace, role }));
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

    const [member] = await this.db
      .insert(workspaceMembers)
      .values({ workspaceId, userId, role: normalizedRole })
      .returning();

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
      })
      .from(workspaces)
      .leftJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
      .groupBy(workspaces.id)
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
      };
    });
  }

  async removeWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
    await ensureWorkspaceMembersTable();
    const deleted = await this.db
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
      .returning({ userId: workspaceMembers.userId });

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

    try {
      await db.execute(sql`
        ALTER TABLE "pages"
        ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    try {
      await db.execute(sql`
        ALTER TABLE "pages"
        ADD COLUMN "chunks" jsonb DEFAULT '[]'::jsonb NOT NULL
      `);
    } catch (error) {
      swallowPgError(error, ["42701"]);
    }

    await ensureKnowledgeBaseTables();

    globalUserAuthSchemaReady = true;
  } catch (error) {
    console.error("[storage] Не удалось обновить схему базы данных", error);
    throw error;
  }
}
