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
  defaultSearchSettings,
  type SearchSettings
} from "@shared/schema";
import { db } from "./db";
import {
  eq,
  ilike,
  sql,
  desc,
  asc,
  or,
  inArray,
  type SQL
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
  private modernSitesSchemaDetected: boolean | null = null;
  private siteColumns: Set<string> | null = null;

  private async getSiteColumns(): Promise<Set<string>> {
    if (this.siteColumns) {
      return this.siteColumns;
    }

    try {
      const result = await this.db.execute(sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'sites'
          AND table_schema = 'public'
      `);

      this.siteColumns = new Set(
        (result.rows as Array<{ column_name?: string; columnName?: string }>).
          map((row) => row.column_name ?? row.columnName ?? "")
      );
    } catch (error) {
      console.error("Failed to fetch sites table columns:", error);
      this.siteColumns = new Set();
    }

    return this.siteColumns;
  }

  private async hasModernSitesSchema(): Promise<boolean> {
    if (this.modernSitesSchemaDetected !== null) {
      return this.modernSitesSchemaDetected;
    }

    const columns = await this.getSiteColumns();
    this.modernSitesSchemaDetected = columns.has('search_settings') && columns.has('name');

    return this.modernSitesSchemaDetected;
  }

  private parseDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    const parsed = new Date(value as string);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private parseJsonArray<T>(value: unknown, fallback: T): T {
    if (Array.isArray(value)) {
      return value as T;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      try {
        return JSON.parse(value) as T;
      } catch (error) {
        console.warn('Failed to parse JSON array column:', error);
      }
    }

    if (value && typeof value === 'object') {
      return value as T;
    }

    return fallback;
  }

  private parseSearchSettings(value: unknown): SearchSettings {
    if (!value) {
      return this.cloneSearchSettings();
    }

    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as SearchSettings;
      } catch (error) {
        console.warn('Failed to parse search settings JSON:', error);
        return this.cloneSearchSettings();
      }
    }

    if (typeof value === 'object') {
      return this.cloneSearchSettings(value as SearchSettings);
    }

    return this.cloneSearchSettings();
  }

  private mapLegacySiteRow(row: Record<string, any>): Site {
    const name = typeof row.name === 'string' && row.name.trim() !== ''
      ? row.name
      : (typeof row.url === 'string' && row.url.trim() !== '' ? row.url : 'Новый проект');

    const searchSettings = this.parseSearchSettings(row.search_settings ?? row.searchSettings);
    const excludePatterns = this.parseJsonArray<string[]>(row.exclude_patterns ?? row.excludePatterns, []);

    const mapped: Partial<Site> & { id: string } = {
      id: String(row.id),
      name,
      description: row.description ?? null,
      url: row.url ?? null,
      crawlDepth: typeof row.crawl_depth === 'number' ? row.crawl_depth : row.crawlDepth ?? 3,
      followExternalLinks: typeof row.follow_external_links === 'boolean'
        ? row.follow_external_links
        : Boolean(row.followExternalLinks),
      crawlFrequency: row.crawl_frequency ?? row.crawlFrequency ?? 'daily',
      excludePatterns,
      status: row.status ?? 'idle',
      lastCrawled: this.parseDate(row.last_crawled ?? row.lastCrawled) ?? undefined,
      nextCrawl: this.parseDate(row.next_crawl ?? row.nextCrawl) ?? undefined,
      error: row.error ?? null,
      searchSettings,
      createdAt: this.parseDate(row.created_at ?? row.createdAt) ?? new Date(),
      updatedAt: this.parseDate(row.updated_at ?? row.updatedAt) ?? new Date(),
    };

    return this.mapSiteWithSettings(mapped);
  }

  private cloneSearchSettings(settings?: SearchSettings | null): SearchSettings {
    return JSON.parse(JSON.stringify(settings ?? defaultSearchSettings)) as SearchSettings;
  }

  private mapSiteWithSettings(site: Partial<Site> & { id: string }): Site {
    return {
      ...(site as Site),
      searchSettings: this.cloneSearchSettings(site.searchSettings),
    };
  }

  private async fetchLegacySiteById(id: string): Promise<Site | undefined> {
    const result = await this.db.execute(sql`
      SELECT *
      FROM "sites"
      WHERE "id" = ${id}
      LIMIT 1
    `);

    const [row] = result.rows as Array<Record<string, any>>;
    if (!row) {
      return undefined;
    }

    return this.mapLegacySiteRow(row);
  }

  private async fetchLegacySites(): Promise<Site[]> {
    const result = await this.db.execute(sql`
      SELECT *
      FROM "sites"
      ORDER BY "created_at" DESC
    `);

    return (result.rows as Array<Record<string, any>>).map(row => this.mapLegacySiteRow(row));
  }

  // Sites
  async createSite(site: InsertSite): Promise<Site> {
    const siteData = site as InsertSite & Partial<Site>;
    const searchSettings = this.cloneSearchSettings(siteData.searchSettings);

    if (await this.hasModernSitesSchema()) {
      const [newSite] = await this.db
        .insert(sites)
        .values({
          ...site,
          searchSettings,
        } as any)
        .returning();

      return this.mapSiteWithSettings(newSite);
    }

    const columns = await this.getSiteColumns();
    const insertColumns: SQL[] = [];
    const insertValues: SQL[] = [];

    if (columns.has('name')) {
      insertColumns.push(sql`"name"`);
      insertValues.push(sql`${siteData.name ?? 'Новый проект'}`);
    }
    if (columns.has('description')) {
      insertColumns.push(sql`"description"`);
      insertValues.push(sql`${siteData.description ?? null}`);
    }
    if (columns.has('url')) {
      insertColumns.push(sql`"url"`);
      insertValues.push(sql`${siteData.url ?? null}`);
    }
    if (columns.has('crawl_depth')) {
      insertColumns.push(sql`"crawl_depth"`);
      insertValues.push(sql`${siteData.crawlDepth ?? 3}`);
    }
    if (columns.has('follow_external_links')) {
      insertColumns.push(sql`"follow_external_links"`);
      insertValues.push(sql`${siteData.followExternalLinks ?? false}`);
    }
    if (columns.has('crawl_frequency')) {
      insertColumns.push(sql`"crawl_frequency"`);
      insertValues.push(sql`${siteData.crawlFrequency ?? 'daily'}`);
    }
    if (columns.has('exclude_patterns')) {
      insertColumns.push(sql`"exclude_patterns"`);
      insertValues.push(sql`${JSON.stringify(siteData.excludePatterns ?? [])}::jsonb`);
    }
    if (columns.has('search_settings')) {
      insertColumns.push(sql`"search_settings"`);
      insertValues.push(sql`${JSON.stringify(searchSettings)}::jsonb`);
    }
    if (columns.has('status')) {
      insertColumns.push(sql`"status"`);
      insertValues.push(sql`${siteData.status ?? 'idle'}`);
    }
    if (columns.has('last_crawled')) {
      insertColumns.push(sql`"last_crawled"`);
      insertValues.push(sql`${siteData.lastCrawled ?? null}`);
    }
    if (columns.has('next_crawl')) {
      insertColumns.push(sql`"next_crawl"`);
      insertValues.push(sql`${siteData.nextCrawl ?? null}`);
    }
    if (columns.has('error')) {
      insertColumns.push(sql`"error"`);
      insertValues.push(sql`${siteData.error ?? null}`);
    }

    if (insertColumns.length === 0) {
      throw new Error('Unable to insert site: no compatible columns found');
    }

    const result = await this.db.execute(sql`
      INSERT INTO "sites" (${sql.join(insertColumns, sql`, `)})
      VALUES (${sql.join(insertValues, sql`, `)})
      RETURNING *
    `);

    const [newSite] = result.rows as Array<Record<string, any>>;
    return this.mapLegacySiteRow({ ...newSite, search_settings: newSite?.search_settings ?? searchSettings });
  }

  async getSite(id: string): Promise<Site | undefined> {
    if (await this.hasModernSitesSchema()) {
      const [site] = await this.db.select().from(sites).where(eq(sites.id, id));
      return site ? this.mapSiteWithSettings(site) : undefined;
    }

    return this.fetchLegacySiteById(id);
  }

  async getAllSites(): Promise<Site[]> {
    if (await this.hasModernSitesSchema()) {
      const allSites = await this.db.select().from(sites).orderBy(desc(sites.createdAt));
      return (allSites as Site[]).map((site: Site) => this.mapSiteWithSettings(site));
    }

    return this.fetchLegacySites();
  }

  async updateSite(id: string, updates: Partial<Site>): Promise<Site | undefined> {
    if (await this.hasModernSitesSchema()) {
      const [updatedSite] = await this.db
        .update(sites)
        .set({ ...updates, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(sites.id, id))
        .returning();
      return updatedSite ? this.mapSiteWithSettings(updatedSite) : undefined;
    }

    const columns = await this.getSiteColumns();
    const { searchSettings: _ignored, ...legacyUpdates } = updates;
    const setFragments = [] as SQL[];

    if (legacyUpdates.name !== undefined && columns.has('name')) {
      setFragments.push(sql`"name" = ${legacyUpdates.name}`);
    }
    if (legacyUpdates.description !== undefined && columns.has('description')) {
      setFragments.push(sql`"description" = ${legacyUpdates.description}`);
    }
    if (legacyUpdates.url !== undefined && columns.has('url')) {
      setFragments.push(sql`"url" = ${legacyUpdates.url}`);
    }
    if (legacyUpdates.crawlDepth !== undefined && columns.has('crawl_depth')) {
      setFragments.push(sql`"crawl_depth" = ${legacyUpdates.crawlDepth}`);
    }
    if (legacyUpdates.followExternalLinks !== undefined && columns.has('follow_external_links')) {
      setFragments.push(sql`"follow_external_links" = ${legacyUpdates.followExternalLinks}`);
    }
    if (legacyUpdates.crawlFrequency !== undefined && columns.has('crawl_frequency')) {
      setFragments.push(sql`"crawl_frequency" = ${legacyUpdates.crawlFrequency}`);
    }
    if (legacyUpdates.excludePatterns !== undefined && columns.has('exclude_patterns')) {
      setFragments.push(sql`"exclude_patterns" = ${sql`${JSON.stringify(legacyUpdates.excludePatterns)}::jsonb`}`);
    }
    if (legacyUpdates.status !== undefined && columns.has('status')) {
      setFragments.push(sql`"status" = ${legacyUpdates.status}`);
    }
    if (legacyUpdates.lastCrawled !== undefined && columns.has('last_crawled')) {
      setFragments.push(sql`"last_crawled" = ${legacyUpdates.lastCrawled}`);
    }
    if (legacyUpdates.nextCrawl !== undefined && columns.has('next_crawl')) {
      setFragments.push(sql`"next_crawl" = ${legacyUpdates.nextCrawl}`);
    }
    if (legacyUpdates.error !== undefined && columns.has('error')) {
      setFragments.push(sql`"error" = ${legacyUpdates.error}`);
    }

    if (setFragments.length === 0) {
      return this.fetchLegacySiteById(id);
    }

    setFragments.push(sql`"updated_at" = CURRENT_TIMESTAMP`);

    const result = await this.db.execute(sql`
      UPDATE "sites"
      SET ${sql.join(setFragments, sql`, `)}
      WHERE "id" = ${id}
      RETURNING
        "id",
        "name",
        "description",
        "url",
        "crawl_depth" AS "crawlDepth",
        "follow_external_links" AS "followExternalLinks",
        "crawl_frequency" AS "crawlFrequency",
        "exclude_patterns" AS "excludePatterns",
        "status",
        "last_crawled" AS "lastCrawled",
        "next_crawl" AS "nextCrawl",
        "error",
        "created_at" AS "createdAt",
        "updated_at" AS "updatedAt"
    `);

    const [updatedSite] = result.rows as Array<Partial<Site> & { id: string }>;
    return updatedSite ? this.mapSiteWithSettings(updatedSite) : undefined;
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

  async bulkDeletePages(pageIds: string[]): Promise<{ deletedCount: number; notFoundCount: number }> {
    if (pageIds.length === 0) {
      return { deletedCount: 0, notFoundCount: 0 };
    }

    try {
      // First, get existing pages to count not found
      const existingPages: Array<{ id: string }> = await this.db
        .select({ id: pages.id })
        .from(pages)
        .where(inArray(pages.id, pageIds));

      const existingPageIds = new Set<string>(existingPages.map(p => p.id));
      const notFoundCount = pageIds.length - existingPageIds.size;

      // Delete pages and related search index entries in a transaction
      if (existingPageIds.size > 0) {
        const pageIdsArray: string[] = Array.from(existingPageIds);
        
        // Delete search index entries first (foreign key dependency)
        await this.db.delete(searchIndex).where(inArray(searchIndex.pageId, pageIdsArray));
        
        // Then delete pages
        const result = await this.db.delete(pages).where(inArray(pages.id, pageIdsArray));
        const deletedCount = result.rowCount ?? 0;
        
        console.log(`🗑️ Bulk deleted ${deletedCount} pages and their search index entries`);
        
        return { 
          deletedCount,
          notFoundCount 
        };
      }

      return { deletedCount: 0, notFoundCount };
    } catch (error) {
      console.error('Error in bulkDeletePages:', error);
      throw error;
    }
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

    const siteRecord = await this.getSite(siteId);
    const searchSettings: SearchSettings = siteRecord?.searchSettings ?? defaultSearchSettings;
    const collectionSettings = searchSettings.collectionSearch;

    // Prepare the search query for FTS (plainto_tsquery handles multiple words automatically)
    const tsQuery = sql`plainto_tsquery('english', ${searchQuery})`;

    // Get results with FTS ranking and fuzzy matching fallback
    const results = await this.db
      .select()
      .from(pages)
      .where(
        sql`${pages.siteId} = ${siteId} AND (
          ${pages.searchVectorCombined} @@ ${tsQuery} OR
          similarity(COALESCE(${pages.title}, ''), ${searchQuery}) > ${collectionSettings.similarityTitleThreshold} OR
          similarity(COALESCE(${pages.content}, ''), ${searchQuery}) > ${collectionSettings.similarityContentThreshold}
        )`
      )
      .orderBy(
        sql`(
          COALESCE(ts_rank_cd(${pages.searchVectorCombined}, ${tsQuery}), 0) +
          CASE
            WHEN ${pages.searchVectorCombined} @@ ${tsQuery} THEN ${collectionSettings.ftsMatchBonus}
            ELSE GREATEST(
              similarity(COALESCE(${pages.title}, ''), ${searchQuery}),
              similarity(COALESCE(${pages.content}, ''), ${searchQuery})
            ) * ${collectionSettings.similarityWeight}
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
          similarity(COALESCE(${pages.title}, ''), ${searchQuery}) > ${collectionSettings.similarityTitleThreshold} OR
          similarity(COALESCE(${pages.content}, ''), ${searchQuery}) > ${collectionSettings.similarityContentThreshold}
        )`
      );

    return { results, total: count };
  }

  // Generate search variations for common typos
  private generateSearchVariations(query: string): string[] {
    const variations = [query];
    const cleanQuery = query.toLowerCase().trim();

    // Common Russian typo patterns (сильно расширенный список для "мониторинг")
    const typoMappings = [
      // Специально для "мониторинг" - все возможные варианты опечаток
      ['мониторинг', 'мониторигн'],
      ['мониторинг', 'мониторингь'],
      ['мониторинг', 'мониторинк'],
      ['мониторинг', 'мониторигн'],
      ['мониторинг', 'манитаринг'],
      ['мониторинг', 'мониторнг'],
      ['мониторинг', 'монитринг'],
      ['мониторинг', 'маниторинг'],
      ['мониторинг', 'мониторинь'],
      ['мониторинг', 'мониторен'],
      ['мониторинг', 'мониторен'],
      ['мониторинг', 'монедоринг'],
      ['мониторинг', 'мониториг'],
      ['мониторинг', 'мониторин'],
      ['мониторинг', 'мониторгн'],
      ['мониторинг', 'мониторигнг'],
      
      // Другие общие опечатки
      ['тестирование', 'тистирование'],
      ['тестирование', 'тестрование'],
      ['разработка', 'разробка'],
      ['администрирование', 'админстрирование'],
      ['конфигурация', 'конфигурция'],
      ['документация', 'докуметация'],
      ['программирование', 'програмирование'],
      
      // Swapped letters
      ['система', 'сситема'],
      ['процесс', 'процеcс'],
      ['сервис', 'серсив'],
      ['сервер', 'серевр'],
      
      // Extra letters
      ['сервер', 'серввер'],
      ['процесс', 'проццесс'],
      
      // Common keyboard layout mistakes (eng -> rus)
      ['monitoring', 'мониторинг'],
      ['server', 'сервер'],
      ['service', 'сервис'],
      ['test', 'тест'],
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

    // Generate phonetic variations for common Russian sounds
    const phoneticMappings = [
      // о/а confusion
      ['мониторинг', 'манитаринг'],
      ['мониторинг', 'мониторанг'],
      // и/е confusion  
      ['мониторинг', 'монеторенг'],
      ['мониторинг', 'мониторенг'],
      // т/д confusion
      ['мониторинг', 'монидоринг'],
      // г/к confusion
      ['мониторинг', 'мониторинк'],
      // н/м confusion
      ['мониторинг', 'мониторимг'],
    ];

    for (const [original, phonetic] of phoneticMappings) {
      if (cleanQuery.includes(original)) {
        variations.push(query.replace(original, phonetic));
      }
    }

    // Add character-level variations for Russian typos
    if (cleanQuery.length > 4) {
      // Missing one character variations
      for (let i = 0; i < cleanQuery.length; i++) {
        const variation = cleanQuery.slice(0, i) + cleanQuery.slice(i + 1);
        if (variation.length > 3) {
          variations.push(variation);
        }
      }
      
      // Swapped adjacent characters
      for (let i = 0; i < cleanQuery.length - 1; i++) {
        const chars = cleanQuery.split('');
        [chars[i], chars[i + 1]] = [chars[i + 1], chars[i]];
        variations.push(chars.join(''));
      }
    }

    // Add partial words (for incomplete typing)
    if (cleanQuery.length > 3) {
      // Add shortened versions
      variations.push(cleanQuery.substring(0, Math.floor(cleanQuery.length * 0.7)));
      variations.push(cleanQuery.substring(0, Math.floor(cleanQuery.length * 0.8)));
      variations.push(cleanQuery.substring(0, Math.floor(cleanQuery.length * 0.9)));
    }

    return Array.from(new Set(variations)); // Remove duplicates
  }

  async searchPages(query: string, limit: number = 10, offset: number = 0): Promise<{ results: any[], total: number }> {
    try {
      console.log(`🔍 Starting search for query: "${query}", limit: ${limit}, offset: ${offset}`);

      // Clean and prepare the search query
      const cleanQuery = query.trim().toLowerCase();

      // Generate search variations for better typo handling
      const searchVariations = this.generateSearchVariations(cleanQuery);
      console.log(`🔍 Search variations:`, searchVariations);

      // Check database extensions
      console.log(`🔧 Checking database extensions...`);
      const extensionsResult = await this.db.execute(sql`
        SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'unaccent')
      `);
      const extensionRows = extensionsResult.rows as Array<{ extname: string }>;
      console.log(`📦 Available extensions:`, extensionRows.map(r => r.extname));

      // Check if pg_trgm is available for similarity search
      const hasPgTrgm = extensionRows.some(row => row.extname === 'pg_trgm');
      console.log(`🔍 pg_trgm available: ${hasPgTrgm}`);

      console.log(`🚀 Executing search query...`);

      let searchResults;
      if (hasPgTrgm) {
        const titleFtsBoost = sql`COALESCE((s.search_settings->'fts'->>'titleBoost')::float, ${defaultSearchSettings.fts.titleBoost})`;
        const contentFtsBoost = sql`COALESCE((s.search_settings->'fts'->>'contentBoost')::float, ${defaultSearchSettings.fts.contentBoost})`;
        const titleSimilarityThreshold = sql`COALESCE((s.search_settings->'similarity'->>'titleThreshold')::float, ${defaultSearchSettings.similarity.titleThreshold})`;
        const contentSimilarityThreshold = sql`COALESCE((s.search_settings->'similarity'->>'contentThreshold')::float, ${defaultSearchSettings.similarity.contentThreshold})`;
        const titleSimilarityWeight = sql`COALESCE((s.search_settings->'similarity'->>'titleWeight')::float, ${defaultSearchSettings.similarity.titleWeight})`;
        const contentSimilarityWeight = sql`COALESCE((s.search_settings->'similarity'->>'contentWeight')::float, ${defaultSearchSettings.similarity.contentWeight})`;
        const titleIlikeBoost = sql`COALESCE((s.search_settings->'ilike'->>'titleBoost')::float, ${defaultSearchSettings.ilike.titleBoost})`;
        const contentIlikeBoost = sql`COALESCE((s.search_settings->'ilike'->>'contentBoost')::float, ${defaultSearchSettings.ilike.contentBoost})`;
        const titleWordThreshold = sql`COALESCE((s.search_settings->'wordSimilarity'->>'titleThreshold')::float, ${defaultSearchSettings.wordSimilarity.titleThreshold})`;
        const contentWordThreshold = sql`COALESCE((s.search_settings->'wordSimilarity'->>'contentThreshold')::float, ${defaultSearchSettings.wordSimilarity.contentThreshold})`;
        const titleWordWeight = sql`COALESCE((s.search_settings->'wordSimilarity'->>'titleWeight')::float, ${defaultSearchSettings.wordSimilarity.titleWeight})`;
        const contentWordWeight = sql`COALESCE((s.search_settings->'wordSimilarity'->>'contentWeight')::float, ${defaultSearchSettings.wordSimilarity.contentWeight})`;

        // Enhanced search with multiple similarity algorithms and very low thresholds for Russian typos
        searchResults = await this.db.execute(sql`
          WITH search_results AS (
            SELECT
              p.*,
              s.url as site_url,
              -- Full-text search scores (высший приоритет)
              GREATEST(${sql.join(searchVariations.map(v => sql`
                CASE
                  WHEN p.search_vector_title @@ plainto_tsquery('english', ${v}) THEN
                    ts_rank(p.search_vector_title, plainto_tsquery('english', ${v})) * ${titleFtsBoost}
                  ELSE 0
                END`), sql` , `)}) as title_fts_score,
              GREATEST(${sql.join(searchVariations.map(v => sql`
                CASE
                  WHEN p.search_vector_content @@ plainto_tsquery('english', ${v}) THEN
                    ts_rank(p.search_vector_content, plainto_tsquery('english', ${v})) * ${contentFtsBoost}
                  ELSE 0
                END`), sql` , `)}) as content_fts_score,

              -- Similarity scores (очень низкие пороги для русских опечаток)
              GREATEST(${sql.join(searchVariations.map(v => sql`similarity(COALESCE(p.title, ''), ${v})`), sql` , `)}) as title_similarity,
              GREATEST(${sql.join(searchVariations.map(v => sql`similarity(COALESCE(p.content, ''), ${v})`), sql` , `)}) as content_similarity,

              -- Exact substring match (ILIKE) - дополнительные баллы за точные совпадения
              GREATEST(${sql.join(searchVariations.map(v => sql`
                CASE
                  WHEN COALESCE(p.title, '') ILIKE '%' || ${v} || '%' THEN ${titleIlikeBoost}
                  ELSE 0
                END`), sql` , `)}) as title_ilike_score,
              GREATEST(${sql.join(searchVariations.map(v => sql`
                CASE
                  WHEN COALESCE(p.content, '') ILIKE '%' || ${v} || '%' THEN ${contentIlikeBoost}
                  ELSE 0
                END`), sql` , `)}) as content_ilike_score,

              -- Word distance (for typos) - очень низкие пороги для русских опечаток
              GREATEST(${sql.join(searchVariations.map(v => sql`
                CASE
                  WHEN word_similarity(COALESCE(p.title, ''), ${v}) > ${titleWordThreshold} THEN
                    word_similarity(COALESCE(p.title, ''), ${v}) * ${titleWordWeight}
                  ELSE 0
                END`), sql` , `)}) as title_word_score,
              GREATEST(${sql.join(searchVariations.map(v => sql`
                CASE
                  WHEN word_similarity(COALESCE(p.content, ''), ${v}) > ${contentWordThreshold} THEN
                    word_similarity(COALESCE(p.content, ''), ${v}) * ${contentWordWeight}
                  ELSE 0
                END`), sql` , `)}) as content_word_score
            FROM pages p
            JOIN sites s ON p.site_id = s.id
            WHERE
              -- Множественные условия поиска с очень низкими порогами для русских опечаток
              ${sql.join(searchVariations.map(variation => sql`(
                -- FTS поиск
                p.search_vector_title @@ plainto_tsquery('english', ${variation})
                OR p.search_vector_content @@ plainto_tsquery('english', ${variation})
                -- Similarity поиск с очень низкими порогами (0.02 для русских опечаток)
                OR similarity(COALESCE(p.title, ''), ${variation}) > ${titleSimilarityThreshold}
                OR similarity(COALESCE(p.content, ''), ${variation}) > ${contentSimilarityThreshold}
                -- Word similarity для опечаток (снижено до 0.15 и 0.1)
                OR word_similarity(COALESCE(p.title, ''), ${variation}) > ${titleWordThreshold}
                OR word_similarity(COALESCE(p.content, ''), ${variation}) > ${contentWordThreshold}
                -- ILIKE для частичных совпадений
                OR COALESCE(p.title, '') ILIKE '%' || ${variation} || '%'
                OR COALESCE(p.content, '') ILIKE '%' || ${variation} || '%'
              )`), sql` OR `)}
          )
          SELECT
            *,
            -- Взвешенная финальная оценка с повышенными приоритетами для точных совпадений
            (
              title_fts_score + content_fts_score +
              (title_similarity * ${titleSimilarityWeight}) + (content_similarity * ${contentSimilarityWeight}) +
              title_ilike_score + content_ilike_score +
              title_word_score + content_word_score
            ) as final_score
          FROM search_results
          WHERE 
            -- Исключаем только совсем слабые результаты (снижены пороги)
            (title_fts_score > 0 OR content_fts_score > 0 OR 
             title_similarity > 0.02 OR content_similarity > 0.015 OR
             title_word_score > 0 OR content_word_score > 0 OR
             title_ilike_score > 0 OR content_ilike_score > 0)
          ORDER BY final_score DESC, last_crawled DESC
          LIMIT ${limit} OFFSET ${offset}
        `);
      } else {
        // Fallback без pg_trgm - только FTS и ILIKE
        const fallbackTitleFtsBoost = sql`COALESCE((s.search_settings->'fallback'->>'ftsTitleBoost')::float, ${defaultSearchSettings.fallback.ftsTitleBoost})`;
        const fallbackContentFtsBoost = sql`COALESCE((s.search_settings->'fallback'->>'ftsContentBoost')::float, ${defaultSearchSettings.fallback.ftsContentBoost})`;
        const fallbackTitleIlikeBoost = sql`COALESCE((s.search_settings->'fallback'->>'ilikeTitleBoost')::float, ${defaultSearchSettings.fallback.ilikeTitleBoost})`;
        const fallbackContentIlikeBoost = sql`COALESCE((s.search_settings->'fallback'->>'ilikeContentBoost')::float, ${defaultSearchSettings.fallback.ilikeContentBoost})`;

        const variationConditions = searchVariations.map((variation) => {
          return sql`
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
            GREATEST(${sql.join(searchVariations.map(v => sql`
              CASE
                WHEN p.search_vector_title @@ plainto_tsquery('english', ${v}) THEN
                  ts_rank(p.search_vector_title, plainto_tsquery('english', ${v})) * ${fallbackTitleFtsBoost}
                ELSE 0
              END`), sql` , `)}) as title_score,
            GREATEST(${sql.join(searchVariations.map(v => sql`
              CASE
                WHEN p.search_vector_content @@ plainto_tsquery('english', ${v}) THEN
                  ts_rank(p.search_vector_content, plainto_tsquery('english', ${v})) * ${fallbackContentFtsBoost}
                ELSE 0
              END`), sql` , `)}) as content_score,
            GREATEST(${sql.join(searchVariations.map(v => sql`
              CASE
                WHEN COALESCE(p.title, '') ILIKE '%' || ${v} || '%' THEN ${fallbackTitleIlikeBoost}
                ELSE 0
              END`), sql` , `)}) as title_ilike,
            GREATEST(${sql.join(searchVariations.map(v => sql`
              CASE
                WHEN COALESCE(p.content, '') ILIKE '%' || ${v} || '%' THEN ${fallbackContentIlikeBoost}
                ELSE 0
              END`), sql` , `)}) as content_ilike
          FROM pages p
          JOIN sites s ON p.site_id = s.id
          WHERE
              ${sql.join(variationConditions, sql` OR `)}
          )
          SELECT
            *,
            (title_score + content_score + title_ilike + content_ilike) as final_score
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
        const titleSimilarityThreshold = sql`COALESCE((s.search_settings->'similarity'->>'titleThreshold')::float, ${defaultSearchSettings.similarity.titleThreshold})`;
        const contentSimilarityThreshold = sql`COALESCE((s.search_settings->'similarity'->>'contentThreshold')::float, ${defaultSearchSettings.similarity.contentThreshold})`;
        const titleWordThreshold = sql`COALESCE((s.search_settings->'wordSimilarity'->>'titleThreshold')::float, ${defaultSearchSettings.wordSimilarity.titleThreshold})`;
        const contentWordThreshold = sql`COALESCE((s.search_settings->'wordSimilarity'->>'contentThreshold')::float, ${defaultSearchSettings.wordSimilarity.contentThreshold})`;

        countResult = await this.db.execute(sql`
          SELECT COUNT(*) as count
          FROM pages p
          JOIN sites s ON p.site_id = s.id
          WHERE
            ${sql.join(searchVariations.map(variation => sql`(
              p.search_vector_title @@ plainto_tsquery('english', ${variation})
              OR p.search_vector_content @@ plainto_tsquery('english', ${variation})
              OR similarity(COALESCE(p.title, ''), ${variation}) > ${titleSimilarityThreshold}
              OR similarity(COALESCE(p.content, ''), ${variation}) > ${contentSimilarityThreshold}
              OR word_similarity(COALESCE(p.title, ''), ${variation}) > ${titleWordThreshold}
              OR word_similarity(COALESCE(p.content, ''), ${variation}) > ${contentWordThreshold}
              OR COALESCE(p.title, '') ILIKE '%' || ${variation} || '%'
              OR COALESCE(p.content, '') ILIKE '%' || ${variation} || '%'
            )`), sql` OR `)}
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

      const total = parseInt(String(countResult.rows[0]?.count || '0'));
      console.log(`✅ Found ${searchResults.rows.length} results out of ${total} total matches`);

      return {
        results: searchResults.rows,
        total
      };
    } catch (error) {
      console.error('❌ Search error:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
      console.error('❌ Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
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
        pg_trgm_available = Boolean(trgmCheck.rows[0]?.available) || false;
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
        unaccent_available = Boolean(unaccentCheck.rows[0]?.available) || false;
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
        search_vector_columns_exist: Boolean(searchVectorCheck.rows[0]?.exists) || false,
        relevance_column_exists: Boolean(relevanceCheck.rows[0]?.exists) || false,
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