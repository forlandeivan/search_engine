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
import { eq, ilike, sql, desc, asc, or } from "drizzle-orm";

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
  searchPagesByCollection(query: string, siteId: string, limit?: number, offset?: number): Promise<{ results: Page[], total: number }>;

  // Database health diagnostics
  getDatabaseHealthInfo(): Promise<{
    schema_name: string;
    database_name: string;
    pg_trgm_available: boolean;
    unaccent_available: boolean;
    search_vector_columns_exist: boolean;
    relevance_column_exists: boolean;
  }>;

  // Keep user methods for future admin features
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
}

export class DatabaseStorage implements IStorage {
  // Inject db instance for testing purposes
  private db = db;

  // Sites
  async createSite(site: InsertSite): Promise<Site> {
    const [newSite] = await this.db
      .insert(sites)
      .values(site as any)
      .returning();
    return newSite;
  }

  async getSite(id: string): Promise<Site | undefined> {
    const [site] = await this.db.select().from(sites).where(eq(sites.id, id));
    return site || undefined;
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
    return updatedSite || undefined;
  }

  async deleteSite(id: string): Promise<boolean> {
    const result = await this.db.delete(sites).where(eq(sites.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Pages
  async createPage(page: InsertPage): Promise<Page> {
    const [newPage] = await this.db
      .insert(pages)
      .values(page)
      .returning();
    return newPage;
  }

  async getPage(id: string): Promise<Page | undefined> {
    const [page] = await this.db.select().from(pages).where(eq(pages.id, id));
    return page || undefined;
  }

  async getAllPages(): Promise<Page[]> {
    return await this.db.select().from(pages).orderBy(desc(pages.createdAt));
  }

  async getPagesByUrl(url: string): Promise<Page[]> {
    return await this.db.select().from(pages).where(eq(pages.url, url));
  }

  async getPagesBySiteId(siteId: string): Promise<Page[]> {
    return await this.db.select().from(pages)
      .where(eq(pages.siteId, siteId))
      .orderBy(desc(pages.lastCrawled));
  }

  async updatePage(id: string, updates: Partial<Page>): Promise<Page | undefined> {
    const [updatedPage] = await this.db
      .update(pages)
      .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(pages.id, id))
      .returning();
    return updatedPage || undefined;
  }

  async deletePage(id: string): Promise<boolean> {
    const result = await this.db.delete(pages).where(eq(pages.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async deletePagesBySiteId(siteId: string): Promise<number> {
    const result = await this.db.delete(pages).where(eq(pages.siteId, siteId));
    return result.rowCount ?? 0;
  }

  // Search index
  async createSearchIndexEntry(entry: InsertSearchIndexEntry): Promise<SearchIndexEntry> {
    const [newEntry] = await this.db
      .insert(searchIndex)
      .values(entry)
      .returning();
    return newEntry;
  }

  async deleteSearchIndexByPageId(pageId: string): Promise<number> {
    const result = await this.db.delete(searchIndex).where(eq(searchIndex.pageId, pageId));
    return result.rowCount ?? 0;
  }

  // Public search by collection (siteId) with Full-Text Search and fuzzy matching
  async searchPagesByCollection(query: string, siteId: string, limit: number = 10, offset: number = 0): Promise<{ results: Page[], total: number }> {
    const searchQuery = query.trim();

    if (searchQuery.length === 0) {
      return { results: [], total: 0 };
    }

    // Prepare the search query for FTS (plainto_tsquery handles multiple words automatically)
    const tsQuery = sql`plainto_tsquery('english', ${searchQuery})`;

    // Get results with FTS ranking and fuzzy matching fallback
    const results = await this.db
      .select()
      .from(pages)
      .where(
        sql`${pages.siteId} = ${siteId} AND (
          ${pages.searchVectorCombined} @@ ${tsQuery} OR
          similarity(COALESCE(${pages.title}, ''), ${searchQuery}) > 0.2 OR
          similarity(COALESCE(${pages.content}, ''), ${searchQuery}) > 0.1
        )`
      )
      .orderBy(
        sql`(
          COALESCE(ts_rank_cd(${pages.searchVectorCombined}, ${tsQuery}), 0) +
          CASE
            WHEN ${pages.searchVectorCombined} @@ ${tsQuery} THEN 0.5
            ELSE GREATEST(
              similarity(COALESCE(${pages.title}, ''), ${searchQuery}),
              similarity(COALESCE(${pages.content}, ''), ${searchQuery})
            ) * 0.3
          END
        ) DESC`,
        sql`${pages.lastCrawled} DESC`
      )
      .limit(limit)
      .offset(offset);

    // Get total count using the same conditions
    const [{ count }] = await this.db
      .select({ count: sql`COUNT(*)`.mapWith(Number) })
      .from(pages)
      .where(
        sql`${pages.siteId} = ${siteId} AND (
          ${pages.searchVectorCombined} @@ ${tsQuery} OR
          similarity(COALESCE(${pages.title}, ''), ${searchQuery}) > 0.2 OR
          similarity(COALESCE(${pages.content}, ''), ${searchQuery}) > 0.1
        )`
      );

    return { results, total: count };
  }

  // Generate search variations for common typos
  private generateSearchVariations(query: string): string[] {
    const variations = [query];
    const cleanQuery = query.toLowerCase().trim();

    // Common Russian typo patterns
    const typoMappings = [
      // Missing letters
      ['мониторинг', 'маниторинг'],
      ['тестирование', 'тистирование'],
      ['разработка', 'разробка'],
      ['администрирование', 'админстрирование'],
      ['конфигурация', 'конфигурация'],
      // Swapped letters
      ['система', 'сситема'],
      ['процесс', 'процеcс'],
      // Extra letters
      ['сервер', 'серввер'],
    ];

    // Check if query matches any known typos and add correct version
    for (const [correct, typo] of typoMappings) {
      if (cleanQuery.includes(typo)) {
        variations.push(query.replace(typo, correct));
      }
      if (cleanQuery.includes(correct)) {
        variations.push(query.replace(correct, typo));
      }
    }

    return [...new Set(variations)]; // Remove duplicates
  }

  async searchPages(query: string, limit: number = 10, offset: number = 0): Promise<{ results: any[], total: number }> {
    try {
      console.log(`🔍 Starting search for query: "${query}", limit: ${limit}, offset: ${offset}`);

      // Clean and prepare the search query
      const cleanQuery = query.trim().toLowerCase();

      // Generate search variations for better typo handling
      const searchVariations = this.generateSearchVariations(cleanQuery);

      // Check database extensions
      console.log(`🔧 Checking database extensions...`);
      const extensionsResult = await this.db.execute(sql`
        SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')
      `);
      console.log(`📦 Available extensions:`, extensionsResult.rows.map(r => r.extname));

      // Check if pg_trgm is available for similarity search
      const hasPgTrgm = extensionsResult.rows.some(row => row.extname === 'pg_trgm');
      console.log(`🔍 pg_trgm available: ${hasPgTrgm}`);

      console.log(`🚀 Executing search query...`);

      let searchResults;
      if (hasPgTrgm) {
        // Build OR conditions for all search variations
        const variationConditions = searchVariations.map((variation, index) => {
          return sql`
            -- Variation ${index + 1}: "${variation}"
            (p.search_vector_title @@ plainto_tsquery('english', ${variation})
            OR p.search_vector_content @@ plainto_tsquery('english', ${variation})
            OR similarity(COALESCE(p.title, ''), ${variation}) > 0.15
            OR similarity(COALESCE(p.content, ''), ${variation}) > 0.08
            OR COALESCE(p.title, '') ILIKE '%' || ${variation} || '%'
            OR COALESCE(p.content, '') ILIKE '%' || ${variation} || '%')
          `;
        });

        // Use similarity search if pg_trgm is available
        searchResults = await this.db.execute(sql`
          WITH search_results AS (
            SELECT
              p.*,
              s.url as site_url,
              -- Calculate best scores across all variations
              GREATEST(${sql.join(searchVariations.map(v => sql`
                CASE
                  WHEN p.search_vector_title @@ plainto_tsquery('english', ${v}) THEN
                    ts_rank(p.search_vector_title, plainto_tsquery('english', ${v})) * 2
                  ELSE 0
                END`), sql` , `)}) as title_score,
              GREATEST(${sql.join(searchVariations.map(v => sql`
                CASE
                  WHEN p.search_vector_content @@ plainto_tsquery('english', ${v}) THEN
                    ts_rank(p.search_vector_content, plainto_tsquery('english', ${v}))
                  ELSE 0
                END`), sql` , `)}) as content_score,
              -- Similarity scores (fuzzy matching) - take best match
              GREATEST(${sql.join(searchVariations.map(v => sql`similarity(COALESCE(p.title, ''), ${v})`), sql` , `)}) as title_similarity,
              GREATEST(${sql.join(searchVariations.map(v => sql`similarity(COALESCE(p.content, ''), ${v})`), sql` , `)}) as content_similarity
            FROM pages p
            JOIN sites s ON p.site_id = s.id
            WHERE
              ${sql.join(variationConditions, sql` OR `)}
          )
          SELECT
            *,
            (title_score + content_score + title_similarity + content_similarity) as final_score
          FROM search_results
          ORDER BY final_score DESC, last_crawled DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      } else {
        // Fallback to full-text search only + ILIKE for basic fuzzy matching
        const variationConditions = searchVariations.map((variation, index) => {
          return sql`
            -- Variation ${index + 1}: "${variation}"
            (p.search_vector_title @@ plainto_tsquery('english', ${variation})
            OR p.search_vector_content @@ plainto_tsquery('english', ${variation})
            OR COALESCE(p.title, '') ILIKE '%' || ${variation} || '%'
            OR COALESCE(p.content, '') ILIKE '%' || ${variation} || '%')
          `;
        });
        searchResults = await this.db.execute(sql`
          WITH search_results AS (
            SELECT
              p.*,
              s.url as site_url,
              -- Full-text search scores
              CASE
                WHEN p.search_vector_title @@ plainto_tsquery('english', ${query}) THEN
                  ts_rank(p.search_vector_title, plainto_tsquery('english', ${query})) * 2
                ELSE 0
              END as title_score,
              CASE
                WHEN p.search_vector_content @@ plainto_tsquery('english', ${query}) THEN
                  ts_rank(p.search_vector_content, plainto_tsquery('english', ${query}))
                ELSE 0
              END as content_score,
              -- Basic fuzzy matching with ILIKE
              CASE
                WHEN COALESCE(p.title, '') ILIKE '%' || ${query} || '%' THEN 0.5
                ELSE 0
              END as title_similarity,
              CASE
                WHEN COALESCE(p.content, '') ILIKE '%' || ${query} || '%' THEN 0.3
                ELSE 0
              END as content_similarity
            FROM pages p
            JOIN sites s ON p.site_id = s.id
            WHERE
              ${sql.join(variationConditions, sql` OR `)}
          )
          SELECT
            *,
            (title_score + content_score + title_similarity + content_similarity) as final_score
          FROM search_results
          ORDER BY final_score DESC, last_crawled DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      }

      console.log(`✅ Search query executed, got ${searchResults.rows.length} results`);

      // Get total count for pagination
      console.log(`📊 Getting total count...`);
      let countResult;
      if (hasPgTrgm) {
        const variationConditions = searchVariations.map((variation) => {
          return sql`
            (p.search_vector_title @@ plainto_tsquery('english', ${variation})
            OR p.search_vector_content @@ plainto_tsquery('english', ${variation})
            OR similarity(COALESCE(p.title, ''), ${variation}) > 0.15
            OR similarity(COALESCE(p.content, ''), ${variation}) > 0.08
            OR COALESCE(p.title, '') ILIKE '%' || ${variation} || '%'
            OR COALESCE(p.content, '') ILIKE '%' || ${variation} || '%')
          `;
        });
        countResult = await this.db.execute(sql`
          SELECT COUNT(*) as count
          FROM pages p
          WHERE
            ${sql.join(variationConditions, sql` OR `)}
        `);
      } else {
        const variationConditions = searchVariations.map((variation) => {
          return sql`
            (p.search_vector_title @@ plainto_tsquery('english', ${variation})
            OR p.search_vector_content @@ plainto_tsquery('english', ${variation})
            OR COALESCE(p.title, '') ILIKE '%' || ${variation} || '%'
            OR COALESCE(p.content, '') ILIKE '%' || ${variation} || '%')
          `;
        });
        countResult = await this.db.execute(sql`
          SELECT COUNT(*) as count
          FROM pages p
          WHERE
            ${sql.join(variationConditions, sql` OR `)}
        `);
      }

      const total = parseInt(countResult.rows[0]?.count || '0');
      console.log(`✅ Found ${searchResults.rows.length} results out of ${total} total matches`);

      return {
        results: searchResults.rows,
        total
      };
    } catch (error) {
      console.error('❌ Search error:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Stack trace:', error.stack);
      throw error;
    }
  }

  // Database health diagnostics
  async getDatabaseHealthInfo() {
    try {
      // Check and create pg_trgm extension
      let pg_trgm_available = false;
      try {
        await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
        const trgmCheck = await this.db.execute(sql`
          SELECT EXISTS(
            SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
          ) as available
        `);
        pg_trgm_available = trgmCheck.rows[0]?.available || false;
      } catch (trgmError) {
        console.warn('pg_trgm extension not available:', trgmError);
      }

      // Check and create unaccent extension
      let unaccent_available = false;
      try {
        await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS unaccent`);
        const unaccentCheck = await this.db.execute(sql`
          SELECT EXISTS(
            SELECT 1 FROM pg_extension WHERE extname = 'unaccent'
          ) as available
        `);
        unaccent_available = unaccentCheck.rows[0]?.available || false;
      } catch (unaccentError) {
        console.warn('unaccent extension not available:', unaccentError);
      }

      // Check if search vector columns exist
      const searchVectorCheck = await this.db.execute(sql`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'pages' AND column_name = 'search_vector'
        ) as exists
      `);

      // Check if relevance column exists
      const relevanceCheck = await this.db.execute(sql`
        SELECT EXISTS(
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'pages' AND column_name = 'relevance'
        ) as exists
      `);

      return {
        schema_name: 'public',
        database_name: 'neondb',
        pg_trgm_available,
        unaccent_available,
        search_vector_columns_exist: searchVectorCheck.rows[0]?.exists || false,
        relevance_column_exists: relevanceCheck.rows[0]?.exists || false,
      };
    } catch (error) {
      console.error('Database health check failed:', error);
      throw error;
    }
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