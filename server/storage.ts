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
  type InsertUser 
} from "@shared/schema";
import { db } from "./db";
import { eq, ilike, sql, desc, asc } from "drizzle-orm";

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
  deletePagesBySiteId(siteId: string): Promise<number>;
  
  // Search index management
  createSearchIndexEntry(entry: InsertSearchIndexEntry): Promise<SearchIndexEntry>;
  deleteSearchIndexByPageId(pageId: string): Promise<number>;
  searchPages(query: string, limit?: number, offset?: number): Promise<{ results: Page[], total: number }>;
  
  // Keep user methods for future admin features  
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export class DatabaseStorage implements IStorage {
  // Sites
  async createSite(site: InsertSite): Promise<Site> {
    const [newSite] = await db
      .insert(sites)
      .values([site])
      .returning();
    return newSite;
  }

  async getSite(id: string): Promise<Site | undefined> {
    const [site] = await db.select().from(sites).where(eq(sites.id, id));
    return site || undefined;
  }

  async getAllSites(): Promise<Site[]> {
    return await db.select().from(sites).orderBy(desc(sites.createdAt));
  }

  async updateSite(id: string, updates: Partial<Site>): Promise<Site | undefined> {
    const [updatedSite] = await db
      .update(sites)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(sites.id, id))
      .returning();
    return updatedSite || undefined;
  }

  async deleteSite(id: string): Promise<boolean> {
    const result = await db.delete(sites).where(eq(sites.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Pages
  async createPage(page: InsertPage): Promise<Page> {
    const [newPage] = await db
      .insert(pages)
      .values(page)
      .returning();
    return newPage;
  }

  async getPage(id: string): Promise<Page | undefined> {
    const [page] = await db.select().from(pages).where(eq(pages.id, id));
    return page || undefined;
  }

  async getAllPages(): Promise<Page[]> {
    return await db.select().from(pages).orderBy(desc(pages.createdAt));
  }

  async getPagesByUrl(url: string): Promise<Page[]> {
    return await db.select().from(pages).where(eq(pages.url, url));
  }

  async getPagesBySiteId(siteId: string): Promise<Page[]> {
    return await db.select().from(pages)
      .where(eq(pages.siteId, siteId))
      .orderBy(desc(pages.lastCrawled));
  }

  async updatePage(id: string, updates: Partial<Page>): Promise<Page | undefined> {
    const [updatedPage] = await db
      .update(pages)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(pages.id, id))
      .returning();
    return updatedPage || undefined;
  }

  async deletePage(id: string): Promise<boolean> {
    const result = await db.delete(pages).where(eq(pages.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async deletePagesBySiteId(siteId: string): Promise<number> {
    const result = await db.delete(pages).where(eq(pages.siteId, siteId));
    return result.rowCount ?? 0;
  }

  // Search index
  async createSearchIndexEntry(entry: InsertSearchIndexEntry): Promise<SearchIndexEntry> {
    const [newEntry] = await db
      .insert(searchIndex)
      .values(entry)
      .returning();
    return newEntry;
  }

  async deleteSearchIndexByPageId(pageId: string): Promise<number> {
    const result = await db.delete(searchIndex).where(eq(searchIndex.pageId, pageId));
    return result.rowCount ?? 0;
  }

  // Public search by collection (siteId)
  async searchPagesByCollection(query: string, siteId: string, limit: number = 10, offset: number = 0): Promise<{ results: Page[], total: number }> {
    const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);
    
    if (searchTerms.length === 0) {
      return { results: [], total: 0 };
    }

    // Build search conditions for title and content within specific site
    const searchConditions = searchTerms.map(term => 
      sql`(LOWER(${pages.title}) LIKE ${`%${term}%`} OR LOWER(${pages.content}) LIKE ${`%${term}%`})`
    );

    const whereClause = searchConditions.reduce((acc, condition, index) => 
      index === 0 ? sql`${condition} AND ${pages.siteId} = ${siteId}` : sql`${acc} AND ${condition}`
    );

    // Get results with pagination
    const results = await db
      .select()
      .from(pages)
      .where(whereClause)
      .orderBy(desc(pages.lastCrawled))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql`COUNT(*)`.mapWith(Number) })
      .from(pages)
      .where(whereClause);

    return { results, total: count };
  }

  async searchPages(query: string, limit: number = 10, offset: number = 0): Promise<{ results: Page[], total: number }> {
    const searchTerms = query.toLowerCase().split(' ').filter(term => term.length > 0);
    
    if (searchTerms.length === 0) {
      return { results: [], total: 0 };
    }

    // Build search conditions for title and content
    const searchConditions = searchTerms.map(term => 
      sql`(LOWER(${pages.title}) LIKE ${`%${term}%`} OR LOWER(${pages.content}) LIKE ${`%${term}%`})`
    );

    const whereClause = searchConditions.reduce((acc, condition, index) => 
      index === 0 ? condition : sql`${acc} AND ${condition}`
    );

    // Get results with pagination
    const results = await db
      .select()
      .from(pages)
      .where(whereClause)
      .orderBy(desc(pages.lastCrawled))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [{ count }] = await db
      .select({ count: sql`COUNT(*)`.mapWith(Number) })
      .from(pages)
      .where(whereClause);

    return { results, total: count };
  }

  // Users (for future admin features)
  async getUser(id: string): Promise<User | undefined> {
    // Not implemented yet - would use users table
    return undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return undefined; // Not implemented yet
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    throw new Error("User creation not implemented yet");
  }
}

export const storage = new DatabaseStorage();
