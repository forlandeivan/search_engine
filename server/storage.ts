import {
  sites,
  pages,
  searchIndex,
  type Site,
  type InsertSite,
  type Page,
  type InsertPage,
  type SearchIndexEntry,
  type InsertSearchIndexEntry,
  type User,
  type InsertUser,
} from "@shared/schema";
import { db } from "./db";
import {
  desc,
  eq,
  inArray,
  sql,
  type SQL,
} from "drizzle-orm";

export interface IStorage {
  // Sites management
  createSite(site: InsertSite): Promise<Site>;
  getSite(id: string): Promise<Site | undefined>;
  getAllSites(): Promise<Site[]>;
  updateSite(id: string, updates: Partial<Site>): Promise<Site | undefined>;
  deleteSite(id: string): Promise<boolean>;

  // Pages management
  createPage(page: InsertPage): Promise<Page>;
  getPage(id: string): Promise<Page | undefined>;
  getAllPages(): Promise<Page[]>;
  getPagesByUrl(url: string): Promise<Page[]>;
  getPagesBySiteId(siteId: string): Promise<Page[]>;
  updatePage(id: string, updates: Partial<Page>): Promise<Page | undefined>;
  deletePage(id: string): Promise<boolean>;
  bulkDeletePages(pageIds: string[]): Promise<{ deletedCount: number; notFoundCount: number }>;
  deletePagesBySiteId(siteId: string): Promise<number>;

  // Search index management
  createSearchIndexEntry(entry: InsertSearchIndexEntry): Promise<SearchIndexEntry>;
  deleteSearchIndexByPageId(pageId: string): Promise<number>;
  searchPages(query: string, limit?: number, offset?: number): Promise<{ results: Page[]; total: number }>;
  searchPagesByCollection(query: string, siteId: string, limit?: number, offset?: number): Promise<{ results: Page[]; total: number }>;

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
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

function buildWhereClause(conditions: SQL[]): SQL {
  if (conditions.length === 0) {
    return sql`TRUE`;
  }
  return sql.join(conditions, sql` AND `);
}

export class DatabaseStorage implements IStorage {
  private db = db;

  async createSite(site: InsertSite): Promise<Site> {
    const [newSite] = await this.db.insert(sites).values(site).returning();
    return newSite;
  }

  async getSite(id: string): Promise<Site | undefined> {
    const [site] = await this.db.select().from(sites).where(eq(sites.id, id));
    return site ?? undefined;
  }

  async getAllSites(): Promise<Site[]> {
    return await this.db.select().from(sites).orderBy(desc(sites.createdAt));
  }

  async updateSite(id: string, updates: Partial<Site>): Promise<Site | undefined> {
    const [updatedSite] = await this.db
      .update(sites)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(sites.id, id))
      .returning();
    return updatedSite ?? undefined;
  }

  async deleteSite(id: string): Promise<boolean> {
    const result = await this.db.delete(sites).where(eq(sites.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async createPage(page: InsertPage): Promise<Page> {
    const [newPage] = await this.db.insert(pages).values(page).returning();
    return newPage;
  }

  async getPage(id: string): Promise<Page | undefined> {
    const [page] = await this.db.select().from(pages).where(eq(pages.id, id));
    return page ?? undefined;
  }

  async getAllPages(): Promise<Page[]> {
    return await this.db.select().from(pages).orderBy(desc(pages.createdAt));
  }

  async getPagesByUrl(url: string): Promise<Page[]> {
    return await this.db.select().from(pages).where(eq(pages.url, url));
  }

  async getPagesBySiteId(siteId: string): Promise<Page[]> {
    return await this.db
      .select()
      .from(pages)
      .where(eq(pages.siteId, siteId))
      .orderBy(desc(pages.lastCrawled));
  }

  async updatePage(id: string, updates: Partial<Page>): Promise<Page | undefined> {
    const [updatedPage] = await this.db
      .update(pages)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(pages.id, id))
      .returning();
    return updatedPage ?? undefined;
  }

  async deletePage(id: string): Promise<boolean> {
    const result = await this.db.delete(pages).where(eq(pages.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async bulkDeletePages(pageIds: string[]): Promise<{ deletedCount: number; notFoundCount: number }> {
    if (pageIds.length === 0) {
      return { deletedCount: 0, notFoundCount: 0 };
    }

    const existingPages: Array<{ id: string }> = await this.db
      .select({ id: pages.id })
      .from(pages)
      .where(inArray(pages.id, pageIds));

    const existingPageIds = new Set<string>(existingPages.map((page) => page.id));
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

  async deletePagesBySiteId(siteId: string): Promise<number> {
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

  private async runFullTextSearch(query: string, limit: number, offset: number, additionalConditions: SQL[]): Promise<{ rows: Page[]; total: number }> {
    const tsQuery = sql`plainto_tsquery('english', ${query})`;
    const conditions = [sql`p.search_vector_combined @@ ${tsQuery}`, ...additionalConditions];
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

  private async runFallbackSearch(query: string, limit: number, offset: number, additionalConditions: SQL[]): Promise<{ results: Page[]; total: number }> {
    const likeCondition = sql`(
      COALESCE(p.title, '') ILIKE '%' || ${query} || '%'
      OR COALESCE(p.content, '') ILIKE '%' || ${query} || '%'
    )`;
    const conditions = [...additionalConditions, likeCondition];
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

  async searchPages(query: string, limit: number = 10, offset: number = 0): Promise<{ results: Page[]; total: number }> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { results: [], total: 0 };
    }

    const { rows, total } = await this.runFullTextSearch(cleanQuery, limit, offset, []);
    if (total > 0) {
      return { results: rows, total };
    }

    return await this.runFallbackSearch(cleanQuery, limit, offset, []);
  }

  async searchPagesByCollection(query: string, siteId: string, limit: number = 10, offset: number = 0): Promise<{ results: Page[]; total: number }> {
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      return { results: [], total: 0 };
    }

    const additionalConditions = [sql`p.site_id = ${siteId}`];
    const { rows, total } = await this.runFullTextSearch(cleanQuery, limit, offset, additionalConditions);
    if (total > 0) {
      return { results: rows, total };
    }

    return await this.runFallbackSearch(cleanQuery, limit, offset, [sql`p.site_id = ${siteId}`]);
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

  async getUser(_id: string): Promise<User | undefined> {
    return undefined;
  }

  async getUserByUsername(_username: string): Promise<User | undefined> {
    return undefined;
  }

  async createUser(_user: InsertUser): Promise<User> {
    throw new Error("User management is not implemented");
  }
}

export const storage = new DatabaseStorage();
