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
  // Sites
  async createSite(site: InsertSite): Promise<Site> {
    const [newSite] = await db
      .insert(sites)
      .values(site as any)
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

  // Public search by collection (siteId) with Full-Text Search and fuzzy matching
  async searchPagesByCollection(query: string, siteId: string, limit: number = 10, offset: number = 0): Promise<{ results: Page[], total: number }> {
    const searchQuery = query.trim();

    if (searchQuery.length === 0) {
      return { results: [], total: 0 };
    }

    // Prepare the search query for FTS (plainto_tsquery handles multiple words automatically)
    const tsQuery = sql`plainto_tsquery('english', ${searchQuery})`;

    // Get results with FTS ranking and fuzzy matching fallback
    const results = await db
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
    const [{ count }] = await db
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
      const extensionsResult = await db.execute(sql`
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
        searchResults = await db.execute(sql`
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
        searchResults = await db.execute(sql`
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
        countResult = await db.execute(sql`
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
        countResult = await db.execute(sql`
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
      // Get database schema and name info
      const schemaResult = await db.execute(sql`
        SELECT
          current_schema() as schema_name,
          current_database() as database_name
      `);
      const schemaInfo = schemaResult.rows[0] as { schema_name: string; database_name: string };

      // Check for PostgreSQL extensions
      const extensionsResult = await db.execute(sql`
        SELECT
          extname,
          extversion
        FROM pg_extension
        WHERE extname IN ('pg_trgm', 'unaccent', 'pgcrypto')
      `);

      const extensions = extensionsResult.rows as Array<{ extname: string; extversion: string }>;
      const pg_trgm_available = extensions.some(ext => ext.extname === 'pg_trgm');
      const unaccent_available = extensions.some(ext => ext.extname === 'unaccent');

      // Check for search vector columns in pages table
      const columnsResult = await db.execute(sql`
        SELECT
          column_name,
          data_type
        FROM information_schema.columns
        WHERE table_name = 'pages'
        AND column_name LIKE 'search_vector_%'
      `);

      const searchVectorColumns = columnsResult.rows as Array<{ column_name: string; data_type: string }>;
      const search_vector_columns_exist = searchVectorColumns.length >= 3 &&
        searchVectorColumns.every(col => col.data_type === 'tsvector');

      // Check for relevance column in search_index table
      const relevanceResult = await db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'search_index'
        AND column_name = 'relevance'
      `);

      const relevance_column_exists = relevanceResult.rows.length > 0;

      return {
        schema_name: schemaInfo.schema_name || 'unknown',
        database_name: schemaInfo.database_name || 'unknown',
        pg_trgm_available,
        unaccent_available,
        search_vector_columns_exist,
        relevance_column_exists,
      };
    } catch (error) {
      console.error("Database health check error:", error);
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