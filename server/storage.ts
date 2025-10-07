import {
  sites,
  pages,
  searchIndex,
  users,
  personalApiTokens,
  embeddingProviders,
  authProviders,
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

function swallowPgError(error: unknown, allowedCodes: string[]): void {
  if (!isPgError(error)) {
    throw error;
  }

  const code = (error as PgError).code;
  if (!code || !allowedCodes.includes(code)) {
    throw error;
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

export interface IStorage {
  // Sites management
  createSite(site: SiteInsert): Promise<Site>;
  getSite(id: string, ownerId?: string): Promise<Site | undefined>;
  getSiteByPublicId(publicId: string): Promise<Site | undefined>;
  getAllSites(ownerId?: string): Promise<Site[]>;
  updateSite(id: string, updates: Partial<Site>, ownerId?: string): Promise<Site | undefined>;
  deleteSite(id: string, ownerId?: string): Promise<boolean>;
  rotateSiteApiKey(
    siteId: string,
    ownerId?: string,
  ): Promise<{ site: Site; apiKey: string } | undefined>;

  // Pages management
  createPage(page: InsertPage): Promise<Page>;
  getPage(id: string, ownerId?: string): Promise<Page | undefined>;
  getAllPages(ownerId?: string): Promise<Page[]>;
  getPagesByUrl(url: string): Promise<Page[]>;
  getPagesBySiteId(siteId: string, ownerId?: string): Promise<Page[]>;
  updatePage(id: string, updates: Partial<Page>, ownerId?: string): Promise<Page | undefined>;
  deletePage(id: string, ownerId?: string): Promise<boolean>;
  bulkDeletePages(pageIds: string[], ownerId?: string): Promise<{ deletedCount: number; notFoundCount: number }>;
  deletePagesBySiteId(siteId: string, ownerId?: string): Promise<number>;

  // Search index management
  createSearchIndexEntry(entry: InsertSearchIndexEntry): Promise<SearchIndexEntry>;
  deleteSearchIndexByPageId(pageId: string): Promise<number>;
  searchPages(query: string, limit?: number, offset?: number, ownerId?: string): Promise<{ results: Page[]; total: number }>;
  searchPagesByCollection(query: string, siteId: string, limit?: number, offset?: number, ownerId?: string): Promise<{ results: Page[]; total: number }>;

  // Database health diagnostics
  getDatabaseHealthInfo(): Promise<{
    schema_name: string;
    database_name: string;
    pg_trgm_available: boolean;
    unaccent_available: boolean;
    search_vector_columns_exist: boolean;
    relevance_column_exists: boolean;
  }>;

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

  // Auth providers
  getAuthProvider(provider: AuthProviderType): Promise<AuthProvider | undefined>;
  upsertAuthProvider(
    provider: AuthProviderType,
    updates: Partial<AuthProviderInsert>,
  ): Promise<AuthProvider>;

  // Embedding services
  listEmbeddingProviders(): Promise<EmbeddingProvider[]>;
  getEmbeddingProvider(id: string): Promise<EmbeddingProvider | undefined>;
  createEmbeddingProvider(provider: EmbeddingProviderInsert): Promise<EmbeddingProvider>;
  updateEmbeddingProvider(
    id: string,
    updates: Partial<EmbeddingProviderInsert>,
  ): Promise<EmbeddingProvider | undefined>;
  deleteEmbeddingProvider(id: string): Promise<boolean>;
}

function buildWhereClause(conditions: SQL[]): SQL {
  if (conditions.length === 0) {
    return sql`TRUE`;
  }
  return sql.join(conditions, sql` AND `);
}

let embeddingProvidersTableEnsured = false;
let ensuringEmbeddingProvidersTable: Promise<void> | null = null;

let authProvidersTableEnsured = false;
let ensuringAuthProvidersTable: Promise<void> | null = null;

async function ensureEmbeddingProvidersTable(): Promise<void> {
  if (embeddingProvidersTableEnsured) {
    return;
  }

  if (ensuringEmbeddingProvidersTable) {
    await ensuringEmbeddingProvidersTable;
    return;
  }

  ensuringEmbeddingProvidersTable = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "embedding_providers" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
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

async function ensureAuthProvidersTable(): Promise<void> {
  if (authProvidersTableEnsured) {
    return;
  }

  if (ensuringAuthProvidersTable) {
    await ensuringAuthProvidersTable;
    return;
  }

  ensuringAuthProvidersTable = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "auth_providers" (
        "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
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

      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS "personal_api_tokens" (
          "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
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

  async getSite(id: string, ownerId?: string): Promise<Site | undefined> {
    const condition = ownerId
      ? and(eq(sites.id, id), eq(sites.ownerId, ownerId))
      : eq(sites.id, id);
    const [site] = await this.db.select().from(sites).where(condition);
    return site ?? undefined;
  }

  async getSiteByPublicId(publicId: string): Promise<Site | undefined> {
    const [site] = await this.db.select().from(sites).where(eq(sites.publicId, publicId));
    return site ?? undefined;
  }

  async getAllSites(ownerId?: string): Promise<Site[]> {
    let query = this.db.select().from(sites);
    if (ownerId) {
      query = query.where(eq(sites.ownerId, ownerId));
    }
    return await query.orderBy(desc(sites.createdAt));
  }

  async updateSite(id: string, updates: Partial<Site>, ownerId?: string): Promise<Site | undefined> {
    const condition = ownerId
      ? and(eq(sites.id, id), eq(sites.ownerId, ownerId))
      : eq(sites.id, id);
    const [updatedSite] = await this.db
      .update(sites)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(condition)
      .returning();
    return updatedSite ?? undefined;
  }

  async deleteSite(id: string, ownerId?: string): Promise<boolean> {
    const condition = ownerId
      ? and(eq(sites.id, id), eq(sites.ownerId, ownerId))
      : eq(sites.id, id);
    const result = await this.db.delete(sites).where(condition);
    return (result.rowCount ?? 0) > 0;
  }

  async rotateSiteApiKey(
    siteId: string,
    ownerId?: string,
  ): Promise<{ site: Site; apiKey: string } | undefined> {
    const newApiKey = randomBytes(32).toString("hex");
    const condition = ownerId
      ? and(eq(sites.id, siteId), eq(sites.ownerId, ownerId))
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
    const [newPage] = await this.db.insert(pages).values(page).returning();
    return newPage;
  }

  async getPage(id: string, ownerId?: string): Promise<Page | undefined> {
    if (ownerId) {
      const rows = await this.db
        .select({ page: pages })
        .from(pages)
        .innerJoin(sites, eq(pages.siteId, sites.id))
        .where(and(eq(pages.id, id), eq(sites.ownerId, ownerId)));

      return rows[0]?.page;
    }

    const [page] = await this.db.select().from(pages).where(eq(pages.id, id));
    return page ?? undefined;
  }

  async getAllPages(ownerId?: string): Promise<Page[]> {
    if (!ownerId) {
      return await this.db.select().from(pages).orderBy(desc(pages.createdAt));
    }

    const rows: Array<{ page: Page }> = await this.db
      .select({ page: pages })
      .from(pages)
      .innerJoin(sites, eq(pages.siteId, sites.id))
      .where(eq(sites.ownerId, ownerId))
      .orderBy(desc(pages.createdAt));

    return rows.map(({ page }) => page);
  }

  async getPagesByUrl(url: string): Promise<Page[]> {
    return await this.db.select().from(pages).where(eq(pages.url, url));
  }

  async getPagesBySiteId(siteId: string, ownerId?: string): Promise<Page[]> {
    if (ownerId) {
      const site = await this.getSite(siteId, ownerId);
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

  async updatePage(id: string, updates: Partial<Page>, ownerId?: string): Promise<Page | undefined> {
    if (ownerId) {
      const page = await this.getPage(id, ownerId);
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

  async deletePage(id: string, ownerId?: string): Promise<boolean> {
    if (ownerId) {
      const page = await this.getPage(id, ownerId);
      if (!page) {
        return false;
      }
    }

    await this.db.delete(searchIndex).where(eq(searchIndex.pageId, id));
    const result = await this.db.delete(pages).where(eq(pages.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async bulkDeletePages(pageIds: string[], ownerId?: string): Promise<{ deletedCount: number; notFoundCount: number }> {
    if (pageIds.length === 0) {
      return { deletedCount: 0, notFoundCount: 0 };
    }

    let accessibleIds: string[];

    if (ownerId) {
      const rows: Array<{ id: string }> = await this.db
        .select({ id: pages.id })
        .from(pages)
        .innerJoin(sites, eq(pages.siteId, sites.id))
        .where(and(inArray(pages.id, pageIds), eq(sites.ownerId, ownerId)));

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

  async deletePagesBySiteId(siteId: string, ownerId?: string): Promise<number> {
    if (ownerId) {
      const site = await this.getSite(siteId, ownerId);
      if (!site) {
        return 0;
      }
    }

    const result = await this.db.delete(pages).where(eq(pages.siteId, siteId));
    return result.rowCount ?? 0;
  }

  async createSearchIndexEntry(entry: InsertSearchIndexEntry): Promise<SearchIndexEntry> {
    const [newEntry] = await this.db.insert(searchIndex).values(entry).returning();
    return newEntry;
  }

  async deleteSearchIndexByPageId(pageId: string): Promise<number> {
    const result = await this.db.delete(searchIndex).where(eq(searchIndex.pageId, pageId));
    return result.rowCount ?? 0;
  }

  private buildOwnerCondition(ownerId?: string): SQL | undefined {
    if (!ownerId) {
      return undefined;
    }

    return sql`EXISTS (SELECT 1 FROM sites s WHERE s.id = p.site_id AND s.owner_id = ${ownerId})`;
  }

  private async runFullTextSearch(
    query: string,
    limit: number,
    offset: number,
    additionalConditions: SQL[],
    ownerId?: string,
  ): Promise<{ rows: Page[]; total: number }> {
    const tsQuery = sql`plainto_tsquery('english', ${query})`;
    const ownerCondition = this.buildOwnerCondition(ownerId);
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
    ownerId?: string,
  ): Promise<{ results: Page[]; total: number }> {
    const likeCondition = sql`(
      COALESCE(p.title, '') ILIKE '%' || ${query} || '%'
      OR COALESCE(p.content, '') ILIKE '%' || ${query} || '%'
    )`;
    const ownerCondition = this.buildOwnerCondition(ownerId);
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
    ownerId?: string,
  ): Promise<{ results: Page[]; total: number }> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { results: [], total: 0 };
    }

    const { rows, total } = await this.runFullTextSearch(cleanQuery, limit, offset, [], ownerId);
    if (total > 0) {
      return { results: rows, total };
    }

    return await this.runFallbackSearch(cleanQuery, limit, offset, [], ownerId);
  }

  async searchPagesByCollection(
    query: string,
    siteId: string,
    limit: number = 10,
    offset: number = 0,
    ownerId?: string,
  ): Promise<{ results: Page[]; total: number }> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { results: [], total: 0 };
    }

    const additionalConditions = [sql`p.site_id = ${siteId}`];
    const { rows, total } = await this.runFullTextSearch(cleanQuery, limit, offset, additionalConditions, ownerId);
    if (total > 0) {
      return { results: rows, total };
    }

    return await this.runFallbackSearch(cleanQuery, limit, offset, [sql`p.site_id = ${siteId}`], ownerId);
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

  async listEmbeddingProviders(): Promise<EmbeddingProvider[]> {
    await ensureEmbeddingProvidersTable();
    return await this.db.select().from(embeddingProviders).orderBy(desc(embeddingProviders.createdAt));
  }

  async getEmbeddingProvider(id: string): Promise<EmbeddingProvider | undefined> {
    await ensureEmbeddingProvidersTable();
    const [provider] = await this.db.select().from(embeddingProviders).where(eq(embeddingProviders.id, id));
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
  ): Promise<EmbeddingProvider | undefined> {
    await ensureEmbeddingProvidersTable();
    const sanitizedUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ) as Partial<EmbeddingProviderInsert>;

    if (Object.keys(sanitizedUpdates).length === 0) {
      return await this.getEmbeddingProvider(id);
    }

    const [updated] = await this.db
      .update(embeddingProviders)
      .set({ ...sanitizedUpdates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(embeddingProviders.id, id))
      .returning();

    return updated ?? undefined;
  }

  async deleteEmbeddingProvider(id: string): Promise<boolean> {
    await ensureEmbeddingProvidersTable();
    const deleted = await this.db
      .delete(embeddingProviders)
      .where(eq(embeddingProviders.id, id))
      .returning({ id: embeddingProviders.id });

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

      return updatedUser ?? existingByGoogle;
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

      return updatedUser ?? existingByEmail;
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

      return updatedUser ?? existingByYandex;
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

      return updatedUser ?? existingByEmail;
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
        "public_id" = COALESCE("public_id", gen_random_uuid()),
        "public_api_key" = COALESCE("public_api_key", encode(gen_random_bytes(32), 'hex')),
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
      ALTER COLUMN "public_id" SET DEFAULT gen_random_uuid(),
      ALTER COLUMN "public_api_key" SET DEFAULT encode(gen_random_bytes(32), 'hex'),
      ALTER COLUMN "public_api_key_generated_at" SET DEFAULT CURRENT_TIMESTAMP
    `);

    try {
      await db.execute(sql`
        ALTER TABLE "sites"
        ADD CONSTRAINT "sites_public_id_unique" UNIQUE("public_id")
      `);
    } catch (error) {
      swallowPgError(error, ["42710"]);
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

    globalUserAuthSchemaReady = true;
  } catch (error) {
    console.error("[storage] Не удалось обновить схему базы данных", error);
    throw error;
  }
}
