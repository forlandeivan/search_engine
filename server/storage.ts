import {
  sites,
  pages,
  searchIndex,
  users,
  embeddingProviders,
  type Site,
  type SiteInsert,
  type Page,
  type InsertPage,
  type SearchIndexEntry,
  type InsertSearchIndexEntry,
  type User,
  type InsertUser,
  type EmbeddingProvider,
  type EmbeddingProviderInsert,
} from "@shared/schema";
import { db } from "./db";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

export interface IStorage {
  // Sites management
  createSite(site: SiteInsert): Promise<Site>;
  getSite(id: string, ownerId?: string): Promise<Site | undefined>;
  getAllSites(ownerId?: string): Promise<Site[]>;
  updateSite(id: string, updates: Partial<Site>, ownerId?: string): Promise<Site | undefined>;
  deleteSite(id: string, ownerId?: string): Promise<boolean>;

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
  createUser(user: InsertUser): Promise<User>;
  listUsers(): Promise<User[]>;
  updateUserRole(userId: string, role: User["role"]): Promise<User | undefined>;
  recordUserActivity(userId: string): Promise<User | undefined>;

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

export class DatabaseStorage implements IStorage {
  private db = db;
  private userAuthColumnsEnsured = false;
  private ensuringUserAuthColumns: Promise<void> | null = null;

  private async ensureUserAuthColumns(): Promise<void> {
    if (this.userAuthColumnsEnsured) {
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
          await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text`);
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

      await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "full_name" text`);
      await this.db.execute(sql`UPDATE "users" SET "full_name" = COALESCE("full_name", 'Новый пользователь')`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "full_name" SET NOT NULL`);

      await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user'`);
      await this.db.execute(sql`UPDATE "users" SET "role" = COALESCE("role", 'user')`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL`);

      await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
      await this.db.execute(sql`UPDATE "users" SET "last_active_at" = COALESCE("last_active_at", "updated_at", CURRENT_TIMESTAMP)`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "last_active_at" SET NOT NULL`);

      await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
      await this.db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
      await this.db.execute(sql`
        UPDATE "users"
        SET
          "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
          "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
      `);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL`);
      await this.db.execute(sql`ALTER TABLE "users" ALTER COLUMN "updated_at" SET NOT NULL`);

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
    return await this.db.select().from(embeddingProviders).orderBy(desc(embeddingProviders.createdAt));
  }

  async getEmbeddingProvider(id: string): Promise<EmbeddingProvider | undefined> {
    const [provider] = await this.db.select().from(embeddingProviders).where(eq(embeddingProviders.id, id));
    return provider ?? undefined;
  }

  async createEmbeddingProvider(provider: EmbeddingProviderInsert): Promise<EmbeddingProvider> {
    const [created] = await this.db.insert(embeddingProviders).values(provider).returning();
    return created;
  }

  async updateEmbeddingProvider(
    id: string,
    updates: Partial<EmbeddingProviderInsert>,
  ): Promise<EmbeddingProvider | undefined> {
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

  async createUser(user: InsertUser): Promise<User> {
    await this.ensureUserAuthColumns();
    const [newUser] = await this.db.insert(users).values(user).returning();
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
        await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email" text`);
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
    await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "full_name" text`);
    await db.execute(sql`UPDATE "users" SET "full_name" = COALESCE("full_name", 'Новый пользователь')`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "full_name" SET NOT NULL`);

    await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user'`);
    await db.execute(sql`UPDATE "users" SET "role" = COALESCE("role", 'user')`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "role" SET NOT NULL`);

    await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
    await db.execute(sql`UPDATE "users" SET "last_active_at" = COALESCE("last_active_at", "updated_at", CURRENT_TIMESTAMP)`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "last_active_at" SET NOT NULL`);

    await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
    await db.execute(sql`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP`);
    await db.execute(sql`
      UPDATE "users"
      SET
        "created_at" = COALESCE("created_at", CURRENT_TIMESTAMP),
        "updated_at" = COALESCE("updated_at", CURRENT_TIMESTAMP)
    `);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "created_at" SET NOT NULL`);
    await db.execute(sql`ALTER TABLE "users" ALTER COLUMN "updated_at" SET NOT NULL`);

    await db.execute(sql`ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "owner_id" varchar`);

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

    await db.execute(sql`
      ALTER TABLE "sites"
      ADD CONSTRAINT IF NOT EXISTS "sites_owner_id_users_id_fk"
      FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE cascade
    `);
    await db.execute(sql`ALTER TABLE "sites" ALTER COLUMN "owner_id" SET NOT NULL`);

    await db.execute(sql`
      ALTER TABLE "sites"
      ADD COLUMN IF NOT EXISTS "name" text DEFAULT 'Новый проект'
    `);

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

    await db.execute(sql`
      ALTER TABLE "sites"
      ADD COLUMN IF NOT EXISTS "start_urls" jsonb DEFAULT '[]'::jsonb
    `);

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

    await db.execute(sql`
      ALTER TABLE "sites"
      ADD COLUMN IF NOT EXISTS "max_chunk_size" integer DEFAULT 1200
    `);

    await db.execute(sql`
      UPDATE "sites"
      SET "max_chunk_size" = COALESCE("max_chunk_size", 1200)
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "max_chunk_size" SET NOT NULL,
      ALTER COLUMN "max_chunk_size" SET DEFAULT 1200
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ADD COLUMN IF NOT EXISTS "chunk_overlap" boolean DEFAULT FALSE
    `);

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
        "request_headers" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "request_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "response_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "qdrant_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "embedding_providers_active_idx"
        ON "embedding_providers" ("is_active")
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS "embedding_providers_provider_type_idx"
        ON "embedding_providers" ("provider_type")
    `);

    await db.execute(sql`
      UPDATE "sites"
      SET "chunk_overlap" = COALESCE("chunk_overlap", FALSE)
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "chunk_overlap" SET NOT NULL,
      ALTER COLUMN "chunk_overlap" SET DEFAULT FALSE
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ADD COLUMN IF NOT EXISTS "chunk_overlap_size" integer DEFAULT 0
    `);

    await db.execute(sql`
      UPDATE "sites"
      SET "chunk_overlap_size" = COALESCE("chunk_overlap_size", 0)
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "chunk_overlap_size" SET NOT NULL,
      ALTER COLUMN "chunk_overlap_size" SET DEFAULT 0
    `);

    await db.execute(sql`
      ALTER TABLE "sites"
      ALTER COLUMN "crawl_frequency" SET DEFAULT 'manual'
    `);

    await db.execute(sql`
      UPDATE "sites"
      SET "crawl_frequency" = COALESCE(NULLIF("crawl_frequency", ''), 'manual')
    `);

    await db.execute(sql`
      ALTER TABLE "pages"
      ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
    `);

    await db.execute(sql`
      ALTER TABLE "pages"
      ADD COLUMN IF NOT EXISTS "chunks" jsonb DEFAULT '[]'::jsonb NOT NULL
    `);
  } catch (error) {
    console.error("[storage] Не удалось обновить схему базы данных", error);
    throw error;
  }
}
