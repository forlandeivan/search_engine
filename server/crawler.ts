import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { URL } from 'url';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { JSDOM } from 'jsdom';
import GithubSlugger from 'github-slugger';
import { storage } from './storage';
import { type InsertPage, type ContentChunk, type PageMetadata, type ChunkMedia } from '@shared/schema';

type CheerioRoot = ReturnType<typeof cheerio.load>;
type CheerioCollection = cheerio.Cheerio<any>;

interface CrawlOptions {
  maxDepth: number;
  followExternalLinks: boolean;
  excludePatterns: string[];
  maxChunkSize: number;
  chunkOverlap: boolean;
  chunkOverlapSize: number;
}

interface CrawlResult {
  url: string;
  title?: string;
  content: string;
  plainText?: string;
  metaDescription?: string;
  statusCode: number;
  links: string[];
  metadata: PageMetadata;
  chunks: ContentChunk[];
  structureStats?: {
    headingCount: number;
    listCount: number;
    tableCount: number;
    codeBlockCount: number;
  };
  rawHtml?: string;
  error?: string;
}

export type CrawlLogLevel = 'info' | 'warning' | 'error' | 'debug';

export interface CrawlLogEvent {
  siteId: string;
  level: CrawlLogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export class WebCrawler {
  private crawledUrls = new Set<string>();
  private pendingUrls: { url: string; depth: number }[] = [];
  private currentSiteId: string | null = null;
  private shouldStop = false;
  private activeCrawls = new Map<string, boolean>();
  private logEmitter = new EventEmitter();
  private puppeteer: any | null = null;
  private browser: any | null = null;
  private browserLaunchPromise: Promise<any> | null = null;
  private browserUnavailable = false;
  private browserExecutablePath: string | null = null;
  private proxyCredentials: { username: string; password: string } | null = null;
  private browserProxyConfig: { server: string; credentials: { username: string; password: string } | null } | null = null;
  private readonly defaultMaxChunkSize = 1200;
  private readonly turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  private options: CrawlOptions = {
    maxDepth: 3,
    followExternalLinks: false,
    excludePatterns: [],
    maxChunkSize: this.defaultMaxChunkSize,
    chunkOverlap: false,
    chunkOverlapSize: 0,
  };

  constructor() {
    this.logEmitter.setMaxListeners(0);
    this.turndown.use(gfm);
  }

  private async loadPuppeteer(): Promise<any | null> {
    if (this.puppeteer || this.browserUnavailable) {
      return this.puppeteer;
    }

    try {
      const module = await import('puppeteer');
      this.puppeteer = module?.default ?? module;
      return this.puppeteer;
    } catch (error) {
      this.browserUnavailable = true;
      this.logForCurrentSite('warning', 'Не удалось загрузить Puppeteer, используем fallback на node-fetch', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private resolveExecutablePath(puppeteer: any): string | null {
    if (this.browserExecutablePath !== null) {
      return this.browserExecutablePath;
    }

    const envPath =
      process.env.PUPPETEER_EXECUTABLE_PATH ??
      process.env.CHROMIUM_PATH ??
      process.env.CHROME_PATH ??
      process.env.CHROME_EXECUTABLE_PATH ??
      null;

    if (envPath) {
      this.browserExecutablePath = envPath;
      this.logForCurrentSite('debug', 'Используем Chromium из переменной окружения', {
        executablePath: envPath,
      });
      return envPath;
    }

    if (typeof puppeteer?.executablePath === 'function') {
      try {
        const detectedPath = puppeteer.executablePath();
        if (detectedPath && detectedPath !== 'undefined') {
          this.browserExecutablePath = detectedPath;
          this.logForCurrentSite('debug', 'Puppeteer предоставил путь к Chromium', {
            executablePath: detectedPath,
          });
          return detectedPath;
        }
      } catch (error) {
        this.logForCurrentSite('debug', 'Не удалось определить путь к Chromium через Puppeteer', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.browserExecutablePath = null;
    return null;
  }

  private getLaunchProxySettings(): { server: string; credentials: { username: string; password: string } | null } | null {
    const proxyValue =
      process.env.PUPPETEER_PROXY_SERVER ??
      process.env.PUPPETEER_PROXY ??
      process.env.CHROMIUM_PROXY ??
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy ??
      process.env.ALL_PROXY ??
      process.env.all_proxy ??
      null;

    if (!proxyValue) {
      return null;
    }

    try {
      const parsed = new URL(proxyValue);
      const credentials =
        parsed.username || parsed.password
          ? {
              username: decodeURIComponent(parsed.username),
              password: decodeURIComponent(parsed.password),
            }
          : null;
      const server = `${parsed.protocol}//${parsed.host}`;

      return { server, credentials };
    } catch {
      return { server: proxyValue, credentials: null };
    }
  }

  private async launchBrowser(puppeteer: any): Promise<any> {
    const executablePath = this.resolveExecutablePath(puppeteer);
    const baseProfiles = [
      {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
        ],
        ignoreHTTPSErrors: true,
      },
      {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ignoreHTTPSErrors: true,
      },
    ];

    const proxySettings = this.getLaunchProxySettings();
    if (proxySettings) {
      this.browserProxyConfig = proxySettings;
      this.proxyCredentials = proxySettings.credentials;
      for (const profile of baseProfiles) {
        profile.args = [...profile.args, `--proxy-server=${proxySettings.server}`];
      }
      this.logForCurrentSite('debug', 'Запуск Chromium с прокси-сервером', {
        proxyServer: this.maskProxyValue(proxySettings.server),
        hasCredentials: Boolean(proxySettings.credentials),
      });
    } else {
      this.browserProxyConfig = null;
      this.proxyCredentials = null;
    }

    const launchProfiles: Array<Record<string, unknown>> = [];

    if (executablePath) {
      for (const profile of baseProfiles) {
        launchProfiles.push({ ...profile, executablePath });
      }
    }

    for (const profile of baseProfiles) {
      launchProfiles.push({ ...profile });
    }

    let lastError: unknown = null;
    for (const profile of launchProfiles) {
      try {
        const browser = await puppeteer.launch(profile);
        this.logForCurrentSite('debug', 'Успешно запущен Chromium для краулинга', {
          profile,
        });
        return browser;
      } catch (error) {
        lastError = error;
        this.logForCurrentSite('warning', 'Не удалось запустить Chromium с профилем, пробуем следующий', {
          profile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw lastError;
  }

  private async getBrowser(): Promise<any | null> {
    if (this.browser) {
      return this.browser;
    }

    if (this.browserLaunchPromise) {
      return await this.browserLaunchPromise.catch(() => null);
    }

    const puppeteer = await this.loadPuppeteer();
    if (!puppeteer) {
      return null;
    }

    this.browserLaunchPromise = this.launchBrowser(puppeteer)
      .then(browser => {
        this.browser = browser;
        return browser;
      })
      .catch(error => {
        this.browserUnavailable = true;
        this.logForCurrentSite('warning', 'Не удалось запустить Chromium, используем fallback', {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      })
      .finally(() => {
        this.browserLaunchPromise = null;
      });

    return await this.browserLaunchPromise;
  }

  private async closeBrowser(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (error) {
        this.logForCurrentSite('warning', 'Ошибка при закрытии браузера', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.browser = null;
  }

  onLog(listener: (event: CrawlLogEvent) => void): () => void {
    this.logEmitter.on('log', listener);
    return () => {
      this.logEmitter.off('log', listener);
    };
  }

  private log(siteId: string, level: CrawlLogLevel, message: string, context?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const prefix = `[Crawler][${siteId}]`;
    const args: unknown[] = [`${prefix} ${message}`];

    if (context && Object.keys(context).length > 0) {
      args.push(context);
    }

    switch (level) {
      case 'error':
        console.error(...args);
        break;
      case 'warning':
        console.warn(...args);
        break;
      case 'debug':
        console.debug(...args);
        break;
      default:
        console.log(...args);
        break;
    }

    const event: CrawlLogEvent = {
      siteId,
      level,
      message,
      timestamp,
      context,
    };

    this.logEmitter.emit('log', event);
  }

  private logForCurrentSite(level: CrawlLogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.currentSiteId) {
      return;
    }

    this.log(this.currentSiteId, level, message, context);
  }

  async crawlSite(siteId: string): Promise<void> {
    try {
      // Update site status to crawling
      await storage.updateSite(siteId, { 
        status: 'crawling', 
        error: null 
      });

      const site = await storage.getSite(siteId);
      if (!site) {
        throw new Error(`Site with ID ${siteId} not found`);
      }

      const configuredStartUrls = Array.from(
        new Set(
          (site.startUrls ?? [])
            .map((url) => this.normalizeUrl(url))
            .filter((url) => Boolean(url))
        )
      );

      const fallbackUrls = site.url ? [this.normalizeUrl(site.url)] : [];
      const initialUrls = configuredStartUrls.length > 0 ? configuredStartUrls : fallbackUrls;

      if (initialUrls.length === 0) {
        await storage.updateSite(siteId, {
          status: 'idle',
          error: 'Не заданы стартовые URL для проекта'
        });
        throw new Error(`Site with ID ${siteId} does not have configured start URLs`);
      }

      this.currentSiteId = siteId;
      this.shouldStop = false;
      this.activeCrawls.set(siteId, true);
      this.crawledUrls.clear();
      this.pendingUrls = initialUrls.map((url) => ({ url, depth: 0 }));
      this.options = {
        maxDepth: site.crawlDepth,
        followExternalLinks: site.followExternalLinks,
        excludePatterns: site.excludePatterns,
        maxChunkSize: site.maxChunkSize ?? this.defaultMaxChunkSize,
        chunkOverlap: site.chunkOverlap ?? false,
        chunkOverlapSize: site.chunkOverlapSize ?? 0,
      };

      this.log(siteId, 'info', 'Запуск краулинга проекта', {
        project: site.name ?? site.url,
        startUrls: initialUrls,
        maxDepth: this.options.maxDepth,
        followExternalLinks: this.options.followExternalLinks,
        excludePatterns: this.options.excludePatterns,
        maxChunkSize: this.options.maxChunkSize,
        chunkOverlap: this.options.chunkOverlap,
        chunkOverlapSize: this.options.chunkOverlapSize,
      });

      let totalPages = 0;
      let indexedPages = 0;

      while (this.pendingUrls.length > 0 && !this.shouldStop) {
        // Check if crawl was stopped
        if (!this.activeCrawls.get(siteId) || this.shouldStop) {
          this.log(siteId, 'warning', 'Краулинг остановлен пользователем');
          await storage.updateSite(siteId, {
            status: 'idle',
            error: 'Crawl manually stopped'
          });
          return;
        }

        const { url, depth } = this.pendingUrls.shift()!;

        if (this.shouldSkipUrl(url, depth, siteId)) {
          continue;
        }

        try {
          this.log(siteId, 'info', 'Сканируем страницу', { url, depth });
          const result = await this.crawlPage(url);

          if (result) {
            if (result.error) {
              this.log(siteId, 'warning', 'Страница возвращает ошибку, пропускаем сохранение', {
                url: result.url,
                error: result.error,
              });
              continue;
            }

            totalPages++;

            // Save page to database using normalized URL
            const { extractedAt: _extractedAt, ...metadataWithoutTimestamp } = result.metadata;
            const structuredSignature = JSON.stringify({
              content: result.content,
              metadata: metadataWithoutTimestamp,
              chunks: result.chunks,
            });
            const contentHash = crypto.createHash('md5').update(structuredSignature).digest('hex');
            const existingPages = await storage.getPagesByUrl(result.url);

            if (existingPages.length > 0) {
              // Update existing page
              const existingPage = existingPages[0];
              if (existingPage.contentHash !== contentHash) {
                const structureStats = result.structureStats;
                await storage.updatePage(existingPage.id, {
                  title: result.title,
                  content: result.content,
                  metaDescription: result.metaDescription,
                  metadata: result.metadata,
                  chunks: result.chunks,
                  statusCode: result.statusCode,
                  lastCrawled: new Date(),
                  contentHash
                });
                indexedPages++;
                this.log(siteId, 'info', 'Обновлено содержимое страницы', {
                  url: result.url,
                  statusCode: result.statusCode,
                  stored: 'updated',
                  markdownLength: result.content.length,
                  headings: structureStats?.headingCount,
                  lists: structureStats?.listCount,
                  tables: structureStats?.tableCount,
                  codeBlocks: structureStats?.codeBlockCount,
                });
              } else {
                this.log(siteId, 'debug', 'Страница не изменилась, пропускаем', {
                  url: result.url,
                });
              }
            } else {
              // Create new page - this handles both first crawl and re-crawl scenarios
              const structureStats = result.structureStats;
              const newPage: InsertPage = {
                siteId: this.currentSiteId!,
                url: result.url,
                title: result.title || '',
                content: result.content,
                metaDescription: result.metaDescription,
                metadata: result.metadata,
                chunks: result.chunks,
                statusCode: result.statusCode,
                lastCrawled: new Date(),
                contentHash
              };
              await storage.createPage(newPage);
              indexedPages++;
              this.log(siteId, 'info', 'Проиндексирована новая страница', {
                url: result.url,
                statusCode: result.statusCode,
                stored: 'created',
                markdownLength: result.content.length,
                headings: structureStats?.headingCount,
                lists: structureStats?.listCount,
                tables: structureStats?.tableCount,
                codeBlocks: structureStats?.codeBlockCount,
              });
            }

            // Add discovered links for further crawling
            if (depth < this.options.maxDepth) {
              result.links.forEach(link => {
                this.pendingUrls.push({ url: link, depth: depth + 1 });
              });
              if (result.links.length > 0) {
                this.log(siteId, 'debug', 'Найдены ссылки для дальнейшего сканирования', {
                  sourceUrl: result.url,
                  discoveredLinks: result.links.length,
                });
              }
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.log(siteId, 'error', 'Ошибка при сканировании страницы', {
            url,
            error: errorMessage,
          });
        }

        // Update progress
        const progress = Math.min(100, Math.round((totalPages / Math.max(1, this.pendingUrls.length + totalPages)) * 100));
        await storage.updateSite(siteId, {
          status: 'crawling'
        });
      }

      // Mark as completed
      await storage.updateSite(siteId, {
        status: 'completed',
        lastCrawled: new Date(),
        error: null
      });

      this.log(siteId, 'info', 'Краулинг завершён', {
        totalPages,
        indexedPages,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(siteId, 'error', 'Краулинг завершился с ошибкой', {
        error: errorMessage,
      });
      await storage.updateSite(siteId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    } finally {
      // Always clean up crawl state
      this.activeCrawls.delete(siteId);
      this.shouldStop = false;
      if (this.currentSiteId === siteId) {
        this.currentSiteId = null;
      }
    }
  }

  private normalizeUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      // Remove fragment (hash) to avoid duplicate pages
      parsedUrl.hash = '';
      // Remove trailing slash for consistency, but keep it for root paths
      let normalizedUrl = parsedUrl.toString();
      if (normalizedUrl.endsWith('/') && parsedUrl.pathname !== '/') {
        normalizedUrl = normalizedUrl.slice(0, -1);
      }
      return normalizedUrl;
    } catch {
      return url;
    }
  }

  private async crawlPage(url: string): Promise<CrawlResult | null> {
    const normalizedUrl = this.normalizeUrl(url);

    if (this.crawledUrls.has(normalizedUrl)) {
      this.logForCurrentSite('debug', 'Пропуск дублирующей страницы', {
        originalUrl: url,
        normalizedUrl,
      });
      return null;
    }

    try {
      const { html, statusCode, finalUrl } = await this.fetchPageContent(normalizedUrl);
      const resolvedUrl = this.normalizeUrl(finalUrl || normalizedUrl);

      const originalDom = cheerio.load(html);
      const $ = cheerio.load(html);
      this.cleanDocument($);

      const fallbackTitle =
        this.normalizeText($('title').first().text()) || this.normalizeText($('h1').first().text());
      const canonicalUrl = this.extractCanonicalUrl(originalDom, resolvedUrl);
      const languageAttr = this.normalizeText(originalDom('html').attr('lang')) || undefined;

      const {
        chunks,
        aggregatedText,
        wordCount,
        markdown,
        title: extractedTitle,
        outLinks,
        stats,
      } = await this.parseContentIntoChunks(html, $, resolvedUrl, canonicalUrl, fallbackTitle);

      const title = extractedTitle || fallbackTitle;

      const metaDescription = this.extractMetaDescription($);
      const pageMetadata = this.extractPageMetadata(
        $,
        resolvedUrl,
        aggregatedText,
        chunks,
        wordCount,
        {
          metaDescription,
          linkSourceDom: originalDom,
          canonicalUrl,
          markdown,
          outLinks,
          languageAttr,
          finalUrl,
          structureStats: stats,
          plainText: aggregatedText,
        }
      );

      this.logForCurrentSite('info', 'Структурный контент извлечен', {
        url: resolvedUrl,
        headings: stats.headingCount,
        lists: stats.listCount,
        tables: stats.tableCount,
        codeBlocks: stats.codeBlockCount,
        markdownLength: markdown.length,
      });

      const discoveredLinks = this.extractLinksForCrawl(originalDom, resolvedUrl);

      this.crawledUrls.add(resolvedUrl);

      return {
        url: resolvedUrl,
        title,
        content: markdown,
        plainText: aggregatedText,
        metaDescription,
        statusCode,
        links: discoveredLinks,
        metadata: pageMetadata,
        chunks,
        structureStats: stats,
        rawHtml: html,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logForCurrentSite('error', 'Ошибка загрузки страницы', {
        url,
        error: errorMessage,
      });

      return {
        url: normalizedUrl,
        title: undefined,
        content: '',
        metaDescription: undefined,
        statusCode: 0,
        links: [],
        metadata: {
          description: undefined,
          keywords: undefined,
          author: undefined,
          publishDate: undefined,
          images: [],
          links: [],
          language: undefined,
          extractedAt: new Date().toISOString(),
          totalChunks: 0,
          wordCount: 0,
          estimatedReadingTimeSec: 0,
        },
        chunks: [],
        error: errorMessage,
      };
    }
  }

  public async extractStructuredContentFromHtml(
    rawHtml: string,
    pageUrl: string,
    canonicalUrl?: string,
    fallbackTitle?: string
  ): Promise<{
    chunks: ContentChunk[];
    aggregatedText: string;
    wordCount: number;
    markdown: string;
    title?: string;
    outLinks: string[];
    stats: {
      headingCount: number;
      listCount: number;
      tableCount: number;
      codeBlockCount: number;
    };
  }> {
    const $ = cheerio.load(rawHtml);
    this.cleanDocument($);
    return await this.parseContentIntoChunks(
      rawHtml,
      $,
      this.normalizeUrl(pageUrl),
      canonicalUrl ? this.normalizeUrl(canonicalUrl) : this.normalizeUrl(pageUrl),
      fallbackTitle ?? ''
    );
  }

  public async fetchPageHtml(
    url: string,
    options: { userAgent?: string; headers?: Record<string, string> } = {}
  ): Promise<{ html: string; statusCode: number; finalUrl: string }> {
    return await this.fetchPageContent(url, options);
  }

  private async fetchPageContent(
    url: string,
    options: { userAgent?: string; headers?: Record<string, string> } = {}
  ): Promise<{ html: string; statusCode: number; finalUrl: string }> {
    const browser = await this.getBrowser();

    if (browser) {
      let page: any = null;
      try {
        page = await browser.newPage();
        const userAgent = options.userAgent?.trim() || 'SearchEngine-Crawler/1.0 (+https://example.com/crawler)';
        await page.setUserAgent(userAgent);

        if (options.headers && typeof page.setExtraHTTPHeaders === 'function') {
          const headerEntries = Object.entries(options.headers).filter(([key, value]) =>
            typeof key === 'string' && key.trim().length > 0 && typeof value === 'string'
          );
          if (headerEntries.length > 0) {
            const normalizedHeaders: Record<string, string> = {};
            for (const [key, value] of headerEntries) {
              normalizedHeaders[key] = value;
            }
            await page.setExtraHTTPHeaders(normalizedHeaders);
          }
        }

        if (this.proxyCredentials && typeof page.authenticate === 'function') {
          await page.authenticate(this.proxyCredentials);
        }

        if (typeof page.setRequestInterception === 'function') {
          await page.setRequestInterception(true);
          page.on('request', (request: any) => {
            const resourceType = request.resourceType?.();
            if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
              request.abort();
            } else {
              request.continue();
            }
          });
        }

        const response = await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: 45000,
        });

        if (!response) {
          throw new Error('Страница не ответила на запрос');
        }

        const statusCode = typeof response.status === 'function' ? response.status() : 200;
        const headers = typeof response.headers === 'function' ? response.headers() : {};
        const contentType = headers?.['content-type'] ?? headers?.['Content-Type'];

        if (contentType && !String(contentType).includes('text/html')) {
          throw new Error(`Неподдерживаемый тип контента: ${contentType}`);
        }

        if (typeof response.ok === 'function' && !response.ok()) {
          const statusText = typeof response.statusText === 'function' ? response.statusText() : '';
          throw new Error(`HTTP ${statusCode}: ${statusText}`);
        }

        const html = await page.content();
        const finalUrl = typeof response.url === 'function' ? response.url() : url;

        await page.close();

        this.logForCurrentSite('debug', 'Страница успешно загружена через Chromium', {
          url,
          statusCode,
          finalUrl,
          proxy: this.browserProxyConfig ? this.maskProxyValue(this.browserProxyConfig.server) : undefined,
        });

        return {
          html,
          statusCode,
          finalUrl,
        };
      } catch (error) {
        if (page) {
          try {
            await page.close();
          } catch (closeError) {
            this.logForCurrentSite('debug', 'Не удалось корректно закрыть страницу браузера', {
              error: closeError instanceof Error ? closeError.message : String(closeError),
            });
          }
        }

        this.logForCurrentSite('warning', 'Chromium не смог загрузить страницу, переключаемся на node-fetch', {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
      const proxyUrl = this.getProxyUrlForRequest(url);
      const maskedProxy = proxyUrl ? this.maskProxyValue(proxyUrl) : undefined;
      let proxyAgent: any | null = null;

      if (proxyUrl) {
        proxyAgent = await this.createProxyAgent(proxyUrl, url);
        if (proxyAgent) {
          this.logForCurrentSite('debug', 'Загрузка страницы через node-fetch с использованием прокси', {
            url,
            proxy: maskedProxy,
          });
        } else {
          this.logForCurrentSite('warning', 'Не удалось создать прокси-агент, пробуем загрузить страницу без прокси', {
            url,
            proxy: maskedProxy,
          });
        }
      } else {
        this.logForCurrentSite('debug', 'Загрузка страницы через node-fetch без прокси', {
          url,
        });
      }

      const defaultUserAgent = 'SearchEngine-Crawler/1.0 (+https://example.com/crawler)';
      const providedHeaders = options.headers ?? {};
      const headers: Record<string, string> = {};

      for (const [key, value] of Object.entries(providedHeaders)) {
        if (typeof key === 'string' && key.trim() && typeof value === 'string') {
          headers[key] = value;
        }
      }

      const hasCustomUserAgent = Object.keys(headers).some(
        key => key.toLowerCase() === 'user-agent'
      );

      if (!hasCustomUserAgent) {
        headers['User-Agent'] = options.userAgent?.trim() || defaultUserAgent;
      }

      const fetchOptions: any = {
        headers,
        signal: controller.signal,
      };

      if (proxyAgent) {
        fetchOptions.agent = proxyAgent;
      }

      const response = await fetch(url, fetchOptions);

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/html')) {
        throw new Error(`Неподдерживаемый тип контента: ${contentType ?? 'unknown'}`);
      }

      const html = await response.text();

      this.logForCurrentSite('debug', 'Страница успешно загружена через node-fetch', {
        url,
        statusCode: response.status,
        finalUrl: response.url ?? url,
        proxy: maskedProxy,
      });

      return {
        html,
        statusCode: response.status,
        finalUrl: response.url ?? url,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timeout (30s) - site may be slow or blocking crawlers');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private maskProxyValue(proxyUrl: string): string {
    try {
      const parsed = new URL(proxyUrl);
      if (parsed.username) {
        parsed.username = '***';
      }
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch {
      return proxyUrl;
    }
  }

  private shouldBypassProxy(url: URL): boolean {
    const noProxy = process.env.NO_PROXY ?? process.env.no_proxy;
    if (!noProxy) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');

    return noProxy
      .split(',')
      .map(pattern => pattern.trim())
      .filter(Boolean)
      .some(pattern => {
        if (pattern === '*') {
          return true;
        }

        let hostPattern = pattern;
        let portPattern: string | null = null;

        if (pattern.includes(':')) {
          const [hostPart, portPart] = pattern.split(':');
          hostPattern = hostPart;
          portPattern = portPart;
        }

        if (portPattern && portPattern !== port) {
          return false;
        }

        hostPattern = hostPattern.replace(/^[*.]+/, '').toLowerCase();
        if (!hostPattern) {
          return false;
        }

        if (hostname === hostPattern) {
          return true;
        }

        return hostname.endsWith(`.${hostPattern}`);
      });
  }

  private getProxyUrlForRequest(targetUrl: string): string | null {
    try {
      const parsed = new URL(targetUrl);

      if (this.shouldBypassProxy(parsed)) {
        this.logForCurrentSite('debug', 'URL исключён из прокси согласно NO_PROXY', {
          url: targetUrl,
        });
        return null;
      }

      const protocol = parsed.protocol;
      const httpsProxy = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null;
      const httpProxy = process.env.HTTP_PROXY ?? process.env.http_proxy ?? null;
      const allProxy = process.env.ALL_PROXY ?? process.env.all_proxy ?? null;

      if (protocol === 'https:') {
        return httpsProxy ?? allProxy ?? httpProxy;
      }

      if (protocol === 'http:') {
        return httpProxy ?? allProxy ?? httpsProxy;
      }

      return allProxy ?? httpsProxy ?? httpProxy;
    } catch {
      return null;
    }
  }

  private async createProxyAgent(proxyUrl: string, targetUrl: string): Promise<any | null> {
    try {
      const parsedTarget = new URL(targetUrl);
      if (parsedTarget.protocol === 'http:') {
        const { HttpProxyAgent } = await import('http-proxy-agent');
        return new HttpProxyAgent(proxyUrl);
      }

      const { HttpsProxyAgent } = await import('https-proxy-agent');
      return new HttpsProxyAgent(proxyUrl);
    } catch (error) {
      this.logForCurrentSite('warning', 'Не удалось инициализировать прокси-агент', {
        proxy: this.maskProxyValue(proxyUrl),
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private cleanDocument($: CheerioRoot): void {
    const removalSelectors = [
      'script',
      'style',
      'noscript',
      'template',
      'iframe',
      'canvas',
      'svg',
      'slot',
      '.advertisement',
      '.ads',
      '.ads-banner',
      '.ad-banner',
      '.adsbygoogle',
      '.cookie-banner',
      '.cookie-consent',
      '.cookie-modal',
      '.gdpr-consent',
      '[data-testid="cookie-banner"]',
      '[data-component="cookie-consent"]',
      '[aria-hidden="true"][role="dialog"]',
    ];

    for (const selector of removalSelectors) {
      $(selector).remove();
    }
  }

  private normalizeText(text: string | undefined | null): string {
    if (!text) {
      return '';
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  private getContentRoot($: CheerioRoot): CheerioCollection {
    const selectors = [
      'main',
      'article',
      '[role="main"]',
      '.content',
      '.main-content',
      '#content',
      '.article',
      '.post',
      '.entry-content',
      'body',
    ];

    for (const selector of selectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        const text = this.normalizeText(element.text());
        if (text.length > 100 || selector === 'body') {
          return element;
        }
      }
    }

    return $('body');
  }

  private extractCanonicalUrl($: CheerioRoot, fallbackUrl: string): string {
    const href = this.normalizeText($('link[rel="canonical"]').attr('href'));
    if (href) {
      const resolved = this.resolveUrl(href, fallbackUrl);
      if (resolved) {
        return this.normalizeUrl(resolved);
      }
    }
    return this.normalizeUrl(fallbackUrl);
  }

  private extractWithReadability(
    html: string,
    pageUrl: string
  ): { html: string; title?: string } | null {
    try {
      const dom = new JSDOM(html, { url: pageUrl });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      if (!article?.content) {
        return null;
      }

      const textContent = this.normalizeText(article.textContent ?? '');
      if (textContent.length < 200) {
        return null;
      }

      return {
        html: article.content,
        title: article.title ?? undefined,
      };
    } catch (error) {
      this.logForCurrentSite('debug', 'Readability не смог извлечь контент', {
        url: pageUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private prepareStructuredContent(
    html: string,
    pageUrl: string,
    canonicalUrl: string,
    fallbackTitle: string
  ): {
    chunks: ContentChunk[];
    aggregatedText: string;
    wordCount: number;
    markdown: string;
    outLinks: string[];
    stats: {
      headingCount: number;
      listCount: number;
      tableCount: number;
      codeBlockCount: number;
    };
  } | null {
    const sanitizedHtml = typeof html === 'string' ? html.trim() : '';
    if (!sanitizedHtml) {
      return null;
    }

    const baseUrl = canonicalUrl || pageUrl;
    const dom = new JSDOM(`<!DOCTYPE html><html><body>${sanitizedHtml}</body></html>`, { url: baseUrl });
    const document = dom.window.document;
    const body = document.body;
    if (!body) {
      return null;
    }

    const nodeInterface = document.defaultView?.Node;
    const elementNodeType = nodeInterface?.ELEMENT_NODE ?? 1;

    const slugger = new GithubSlugger();
    const outLinksSet = new Set<string>();

    body.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(anchor => {
      const href = anchor.getAttribute('href');
      if (!href) {
        return;
      }
      const resolved = this.resolveUrl(href, baseUrl);
      if (resolved) {
        anchor.setAttribute('href', resolved);
        outLinksSet.add(resolved);
      } else {
        anchor.removeAttribute('href');
      }
    });

    body.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
      const src = image.getAttribute('src');
      if (!src) {
        return;
      }
      const resolved = this.resolveUrl(src, baseUrl);
      if (resolved) {
        image.setAttribute('src', resolved);
      }
    });

    let headingElements = Array.from(body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    if (headingElements.length === 0) {
      const fallbackHeading = document.createElement('h1');
      fallbackHeading.textContent = fallbackTitle || 'Основной контент';
      const fallbackId = this.slugifyHeading(fallbackHeading.textContent ?? 'section', slugger);
      fallbackHeading.setAttribute('id', fallbackId);
      body.insertBefore(fallbackHeading, body.firstChild);
      headingElements = [fallbackHeading];
    }

    if (headingElements.length === 0) {
      return null;
    }

    const headingCount = headingElements.length;
    const listCount = body.querySelectorAll('ul, ol').length;
    const tableCount = body.querySelectorAll('table').length;
    const preCount = body.querySelectorAll('pre').length;
    const codeCount = body.querySelectorAll('code').length;
    const codeBlockCount = preCount + Math.max(0, codeCount - preCount);

    const headingStack: Array<{ level: number; title: string }> = [];
    const sections: Array<{
      id: string;
      heading: string;
      level: number;
      markdown: string;
      content: string;
      links: string[];
      images: ChunkMedia[];
      sectionPath: string[];
      orderIndex: number;
      sourceUrl: string;
    }> = [];

    headingElements.forEach((headingElement, index) => {
      const level = Number.parseInt(headingElement.tagName.replace(/[^0-9]/g, ''), 10) || 2;
      const headingText = this.normalizeText(headingElement.textContent) || `Раздел ${index + 1}`;

      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }

      const anchorId = this.ensureAnchorId(headingElement, slugger, headingText, index);
      headingElement.setAttribute('id', anchorId);

      const sectionPath = [...headingStack.map(item => item.title), headingText];
      headingStack.push({ level, title: headingText });

      const tempContainer = document.createElement('div');
      let sibling: Node | null = headingElement.nextSibling;
      while (sibling) {
        if (sibling.nodeType === elementNodeType) {
          const tagName = (sibling as Element).tagName.toLowerCase();
          if (/^h[1-6]$/.test(tagName)) {
            const siblingLevel = Number.parseInt(tagName.replace(/[^0-9]/g, ''), 10) || 6;
            if (siblingLevel <= level) {
              break;
            }
          }
        }
        tempContainer.appendChild(sibling.cloneNode(true));
        sibling = sibling.nextSibling;
      }

      const bodyMarkdown = tempContainer.innerHTML ? this.turndown.turndown(tempContainer.innerHTML) : '';
      const headingLine = `${'#'.repeat(Math.min(6, Math.max(1, level)))} ${headingText}`.trim();
      const headingWithAnchor = anchorId ? `${headingLine} {#${anchorId}}` : headingLine;
      const combinedMarkdown = [headingWithAnchor, bodyMarkdown].filter(Boolean).join('\n\n');

      const plainText = this.normalizeText(`${headingText}\n${tempContainer.textContent ?? ''}`);
      const links = this.collectLinksFromElement(tempContainer);
      const images = this.collectImagesFromElement(tempContainer);
      const sourceUrl = this.buildSourceUrl(pageUrl, canonicalUrl, anchorId, headingText, index);

      sections.push({
        id: anchorId,
        heading: headingText,
        level,
        markdown: combinedMarkdown,
        content: plainText,
        links,
        images,
        sectionPath,
        orderIndex: sections.length,
        sourceUrl,
      });
    });

    const chunkSizeLimit = this.options.maxChunkSize ?? this.defaultMaxChunkSize;
    const finalChunks: ContentChunk[] = [];
    let positionCounter = 0;

    for (const section of sections) {
      const baseChunk: ContentChunk = {
        id: section.id,
        heading: section.heading,
        level: section.level,
        content: section.content,
        markdown: section.markdown,
        deepLink: section.sourceUrl,
        metadata: {
          images: section.images.map(image => ({ ...image })),
          links: [...section.links],
          position: positionCounter,
          wordCount: this.countWords(section.content),
          charCount: section.content.length,
          estimatedReadingTimeSec: this.calculateReadingTimeSec(this.countWords(section.content)),
          excerpt: this.buildExcerpt(section.content),
          anchorId: section.id,
          headingLevel: section.level,
          headingText: section.heading,
          sectionPath: [...section.sectionPath],
          orderIndex: section.orderIndex,
          sourceUrl: section.sourceUrl,
          markdown: section.markdown,
        },
      };

      const subdivided = this.subdivideChunksBySize(baseChunk, chunkSizeLimit);
      for (const chunk of subdivided) {
        chunk.deepLink = section.sourceUrl;
        chunk.metadata.position = positionCounter++;
        chunk.metadata.anchorId = section.id;
        chunk.metadata.headingLevel = section.level;
        chunk.metadata.headingText = section.heading;
        chunk.metadata.sectionPath = [...section.sectionPath];
        chunk.metadata.orderIndex = section.orderIndex;
        chunk.metadata.sourceUrl = section.sourceUrl;
        chunk.metadata.markdown = section.markdown;
        if (!chunk.markdown) {
          chunk.markdown = section.markdown;
        }
        finalChunks.push(chunk);
      }
    }

    let aggregatedText = '';
    for (const chunk of finalChunks) {
      const chunkText = this.normalizeText(chunk.content);
      if (!chunkText) {
        chunk.metadata.charRange = [aggregatedText.length, aggregatedText.length];
        continue;
      }

      if (aggregatedText.length > 0) {
        aggregatedText += '\n\n';
      }
      const start = aggregatedText.length;
      aggregatedText += chunkText;
      const end = aggregatedText.length;
      chunk.metadata.charRange = [start, end];
      chunk.metadata.wordCount = this.countWords(chunkText);
      chunk.metadata.charCount = chunkText.length;
      chunk.metadata.estimatedReadingTimeSec = this.calculateReadingTimeSec(chunk.metadata.wordCount);
      chunk.metadata.excerpt = this.buildExcerpt(chunkText);
      chunk.content = chunkText;
    }

    const markdown = sections
      .map(section => section.markdown)
      .filter((entry): entry is string => Boolean(entry))
      .join('\n\n');

    return {
      chunks: finalChunks,
      aggregatedText,
      wordCount: this.countWords(aggregatedText),
      markdown,
      outLinks: Array.from(outLinksSet),
      stats: {
        headingCount,
        listCount,
        tableCount,
        codeBlockCount,
      },
    };
  }

  private ensureAnchorId(
    heading: HTMLElement,
    slugger: GithubSlugger,
    headingText: string,
    index: number
  ): string {
    const existing = this.normalizeText(heading.getAttribute('id')) || this.normalizeText(heading.getAttribute('name'));
    if (existing) {
      return existing
        .trim()
        .replace(/[^\p{L}\p{N}\-_. ]+/gu, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
    }

    const base = headingText || `section-${index + 1}`;
    const slug = slugger.slug(base);
    return slug || `section-${index + 1}`;
  }

  private slugifyHeading(text: string, slugger: GithubSlugger): string {
    const base = text.trim() || 'section';
    const slug = slugger.slug(base);
    return slug || base.toLowerCase().replace(/[^a-z0-9]+/gi, '-');
  }

  private collectLinksFromElement(container: HTMLElement): string[] {
    const links = new Set<string>();
    container.querySelectorAll('a[href]').forEach(anchor => {
      const href = this.normalizeText(anchor.getAttribute('href'));
      if (href) {
        links.add(href);
      }
    });
    return Array.from(links).slice(0, 20);
  }

  private collectImagesFromElement(container: HTMLElement): ChunkMedia[] {
    const images: ChunkMedia[] = [];
    const seen = new Set<string>();
    container.querySelectorAll('img[src]').forEach(image => {
      const src = this.normalizeText(image.getAttribute('src'));
      if (!src || seen.has(src)) {
        return;
      }
      seen.add(src);
      const alt = this.normalizeText(image.getAttribute('alt')) || undefined;
      images.push({ src, alt });
    });
    return images.slice(0, 10);
  }

  private buildSourceUrl(
    pageUrl: string,
    canonicalUrl: string,
    anchorId: string | null,
    headingText: string,
    index: number
  ): string {
    const base = this.normalizeUrl(canonicalUrl || pageUrl);
    if (anchorId) {
      return `${base}#${encodeURIComponent(anchorId)}`;
    }

    if (headingText) {
      const fragment = headingText.split(' ').slice(0, 12).join(' ');
      return `${base}#:~:text=${encodeURIComponent(fragment)}`;
    }

    return `${base}#section-${index + 1}`;
  }

  private async parseContentIntoChunks(
    rawHtml: string,
    sanitizedDom: CheerioRoot,
    pageUrl: string,
    canonicalUrl: string,
    fallbackTitle: string
  ): Promise<{
    chunks: ContentChunk[];
    aggregatedText: string;
    wordCount: number;
    markdown: string;
    title?: string;
    outLinks: string[];
    stats: {
      headingCount: number;
      listCount: number;
      tableCount: number;
      codeBlockCount: number;
    };
  }> {
    const articleFromReadability = this.extractWithReadability(rawHtml, pageUrl);
    if (articleFromReadability && articleFromReadability.html) {
      const prepared = this.prepareStructuredContent(
        articleFromReadability.html,
        pageUrl,
        canonicalUrl,
        articleFromReadability.title ?? fallbackTitle
      );
      if (prepared) {
        return { ...prepared, title: articleFromReadability.title ?? fallbackTitle };
      }
    }

    const contentRoot = this.getContentRoot(sanitizedDom);
    const fallbackHtml = contentRoot.length > 0 ? contentRoot.html() ?? '' : sanitizedDom('body').html() ?? '';
    const preparedFallback = this.prepareStructuredContent(fallbackHtml, pageUrl, canonicalUrl, fallbackTitle);
    if (preparedFallback) {
      return preparedFallback;
    }

    return {
      chunks: [],
      aggregatedText: '',
      wordCount: 0,
      markdown: '',
      outLinks: [],
      stats: {
        headingCount: 0,
        listCount: 0,
        tableCount: 0,
        codeBlockCount: 0,
      },
    };
  }

  private extractMetaDescription($: CheerioRoot): string | undefined {
    return (
      this.normalizeText($('meta[name="description"]').attr('content')) ||
      this.normalizeText($('meta[property="og:description"]').attr('content')) ||
      undefined
    );
  }

  private extractPageMetadata(
    $: CheerioRoot,
    pageUrl: string,
    aggregatedText: string,
    chunks: ContentChunk[],
    wordCount: number,
    options: {
      metaDescription?: string;
      linkSourceDom?: CheerioRoot;
      canonicalUrl?: string;
      markdown?: string;
      outLinks?: string[];
      languageAttr?: string;
      finalUrl?: string;
      plainText?: string;
      structureStats?: {
        headingCount: number;
        listCount: number;
        tableCount: number;
        codeBlockCount: number;
      };
    } = {}
  ): PageMetadata {
    const linksDom = options.linkSourceDom ?? $;
    const metadata: PageMetadata = {
      description: options.metaDescription,
      keywords: this.normalizeText($('meta[name="keywords"]').attr('content')) || undefined,
      author:
        this.normalizeText($('meta[name="author"]').attr('content')) ||
        this.normalizeText($('meta[property="article:author"]').attr('content')) ||
        undefined,
      publishDate:
        this.normalizeText($('meta[property="article:published_time"]').attr('content')) ||
        this.normalizeText($('meta[name="pubdate"]').attr('content')) ||
        this.normalizeText($('time[datetime]').first().attr('datetime')) ||
        undefined,
      images: this.collectPageImages($, pageUrl),
      links: this.collectPageLinks(linksDom, pageUrl),
      language: (this.normalizeText($('html').attr('lang')) || undefined)?.toLowerCase(),
      lang: options.languageAttr?.toLowerCase(),
      canonicalUrl: options.canonicalUrl,
      finalUrl: options.finalUrl,
      fetchedAt: new Date().toISOString(),
      markdown: options.markdown,
      outLinks: options.outLinks,
      plainText: options.plainText ?? aggregatedText,
      structureStats: options.structureStats,
      extractedAt: new Date().toISOString(),
      totalChunks: chunks.length,
      wordCount,
      estimatedReadingTimeSec: this.calculateReadingTimeSec(wordCount),
    };

    return metadata;
  }

  private extractLinksForCrawl($: CheerioRoot, url: string): string[] {
    const links: string[] = [];
    let baseUrl: URL | null = null;

    try {
      baseUrl = new URL(url);
    } catch (error) {
      this.logForCurrentSite('warning', 'Не удалось разобрать базовый URL для ссылок', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    $('a[href]').each((_: any, element: any) => {
      const href = $(element).attr('href');
      if (!href) {
        return;
      }

      try {
        const targetUrl = baseUrl ? new URL(href, baseUrl.toString()) : new URL(href);
        const linkStr = targetUrl.toString();
        const normalizedLink = this.normalizeUrl(linkStr);
        const sameHost = baseUrl ? targetUrl.hostname === baseUrl.hostname : true;

        if ((this.options.followExternalLinks || sameHost) && this.isValidUrl(normalizedLink)) {
          if (!this.crawledUrls.has(normalizedLink)) {
            links.push(normalizedLink);
          }
        }
      } catch (error) {
        this.logForCurrentSite('debug', 'Пропускаем некорректную ссылку', {
          href,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return Array.from(new Set(links));
  }

  private subdivideChunksBySize(chunk: ContentChunk, maxSize: number): ContentChunk[] {
    const overlapEnabled = this.options.chunkOverlap;
    const configuredOverlap = Math.max(0, this.options.chunkOverlapSize ?? 0);
    const maxAllowedOverlap = overlapEnabled ? Math.min(configuredOverlap, maxSize) : 0;

    if (chunk.content.length <= maxSize) {
      return [
        {
          ...chunk,
          metadata: {
            ...chunk.metadata,
            images: chunk.metadata.images.map(image => ({ ...image })),
            links: [...chunk.metadata.links],
            sectionPath: chunk.metadata.sectionPath ? [...chunk.metadata.sectionPath] : undefined,
          },
        },
      ];
    }

    const parts = this.splitTextIntoChunks(chunk.content, maxSize);
    if (parts.length <= 1) {
      return [
        {
          ...chunk,
          metadata: {
            ...chunk.metadata,
            images: chunk.metadata.images.map(image => ({ ...image })),
            links: [...chunk.metadata.links],
            sectionPath: chunk.metadata.sectionPath ? [...chunk.metadata.sectionPath] : undefined,
          },
        },
      ];
    }

    const subdividedChunks: ContentChunk[] = [];
    let previousCombinedContent: string | null = null;

    parts.forEach((text, index) => {
      const baseOverlapSource = previousCombinedContent ?? '';
      const possibleOverlap = Math.min(maxAllowedOverlap, baseOverlapSource.length);
      const availableSpaceForOverlap = Math.max(0, maxSize - text.length);
      const effectiveOverlap = index === 0 ? 0 : Math.min(possibleOverlap, availableSpaceForOverlap);
      const overlapPrefix = effectiveOverlap > 0 ? baseOverlapSource.slice(-effectiveOverlap) : '';
      const combinedContent = `${overlapPrefix}${text}`;
      const wordCount = this.countWords(combinedContent);

      const combinedChunk: ContentChunk = {
        ...chunk,
        id: `${chunk.id}-part-${index + 1}`,
        heading: index === 0 ? chunk.heading : `${chunk.heading} (часть ${index + 1})`,
        content: combinedContent,
        metadata: {
          ...chunk.metadata,
          wordCount,
          charCount: combinedContent.length,
          estimatedReadingTimeSec: this.calculateReadingTimeSec(wordCount),
          excerpt: this.buildExcerpt(combinedContent),
          images: chunk.metadata.images.map(image => ({ ...image })),
          links: [...chunk.metadata.links],
          sectionPath: chunk.metadata.sectionPath ? [...chunk.metadata.sectionPath] : undefined,
        },
      };
      subdividedChunks.push(combinedChunk);
      previousCombinedContent = combinedContent;
    });

    return subdividedChunks;
  }

  private splitTextIntoChunks(text: string, maxSize: number): string[] {
    if (text.length <= maxSize) {
      return [text];
    }

    const normalizedText = text.trim();
    if (normalizedText.length <= maxSize) {
      return [normalizedText];
    }

    const totalLength = normalizedText.length;
    const parts: string[] = [];

    for (let start = 0; start < totalLength; start += maxSize) {
      const end = Math.min(start + maxSize, totalLength);
      parts.push(normalizedText.slice(start, end));
    }

    return parts.filter(Boolean);
  }

  private collectPageImages($: CheerioRoot, pageUrl: string): string[] {
    const images: string[] = [];
    const seen = new Set<string>();

    $('img[src]').each((_: any, element: any) => {
      const src = this.normalizeText($(element).attr('src'));
      if (!src) {
        return;
      }

      const resolved = this.resolveUrl(src, pageUrl);
      if (!resolved || seen.has(resolved)) {
        return;
      }

      seen.add(resolved);
      images.push(resolved);
    });

    return images.slice(0, 10);
  }

  private collectPageLinks($: CheerioRoot, pageUrl: string): string[] {
    const links: string[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_: any, element: any) => {
      const href = this.normalizeText($(element).attr('href'));
      if (!href) {
        return;
      }

      const resolved = this.resolveUrl(href, pageUrl);
      if (!resolved || seen.has(resolved)) {
        return;
      }

      seen.add(resolved);
      links.push(resolved);
    });

    return links.slice(0, 20);
  }

  private resolveUrl(possibleUrl: string, baseUrl: string): string | null {
    try {
      const resolved = new URL(possibleUrl, baseUrl);
      if (!['http:', 'https:'].includes(resolved.protocol)) {
        return null;
      }
      return resolved.toString();
    } catch {
      return null;
    }
  }

  private countWords(text: string): number {
    if (!text) {
      return 0;
    }
    return text.split(/\s+/).filter(Boolean).length;
  }

  private calculateReadingTimeSec(wordCount: number): number {
    if (wordCount <= 0) {
      return 0;
    }
    const wordsPerMinute = 200;
    return Math.max(5, Math.round((wordCount / wordsPerMinute) * 60));
  }

  private buildExcerpt(text: string, maxLength = 280): string {
    if (!text) {
      return '';
    }
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, maxLength).trim()}…`;
  }

  private shouldSkipUrl(url: string, depth: number, siteId: string): boolean {
    const normalizedUrl = this.normalizeUrl(url);
    if (this.crawledUrls.has(normalizedUrl)) {
      this.log(siteId, 'debug', 'URL уже был обработан, пропускаем', { url: normalizedUrl });
      return true;
    }

    if (depth > this.options.maxDepth) {
      this.log(siteId, 'debug', 'Достигнута максимальная глубина', { url: normalizedUrl, depth });
      return true;
    }

    // Check exclude patterns
    for (const pattern of this.options.excludePatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(url)) {
          this.log(siteId, 'debug', 'URL исключён по шаблону', { url: normalizedUrl, pattern });
          return true;
        }
      } catch (e) {
        this.log(siteId, 'warning', 'Некорректное регулярное выражение в исключениях', {
          pattern,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return false;
  }

  private isValidUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      
      // Skip certain file types
      const skipExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.zip', '.rar'];
      if (skipExtensions.some(ext => parsedUrl.pathname.toLowerCase().endsWith(ext))) {
        this.logForCurrentSite('debug', 'Пропуск ссылки из-за расширения файла', {
          url,
          extension: parsedUrl.pathname.split('.').pop(),
        });
        return false;
      }

      // Skip certain protocols
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        this.logForCurrentSite('debug', 'Пропуск ссылки с неподдерживаемым протоколом', {
          url,
          protocol: parsedUrl.protocol,
        });
        return false;
      }

      // Skip URLs that are only different by fragment (already normalized)
      // Skip certain query parameters that indicate non-content pages
      if (parsedUrl.search.includes('print=') || parsedUrl.search.includes('download=')) {
        this.logForCurrentSite('debug', 'Пропуск ссылки с нежелательными параметрами', {
          url,
        });
        return false;
      }

      return true;
    } catch (error) {
      this.logForCurrentSite('warning', 'Не удалось разобрать URL, пропускаем', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async stopCrawl(siteId: string): Promise<void> {
    this.log(siteId, 'warning', 'Инициирована остановка краулинга пользователем');

    // Set stop flags immediately
    if (this.currentSiteId === siteId) {
      this.shouldStop = true;
      this.pendingUrls = [];
    }
    this.activeCrawls.set(siteId, false);
    
    // Update database status
    await storage.updateSite(siteId, { 
      status: 'idle',
      error: 'Crawl manually stopped'
    });
    
    // Clean up if this is the current site
    if (this.currentSiteId === siteId) {
      this.currentSiteId = null;
      this.shouldStop = false;
    }

    this.log(siteId, 'warning', 'Краулинг был принудительно остановлен');
  }

  // Emergency stop all crawls
  async stopAllCrawls(): Promise<void> {
    this.logForCurrentSite('warning', 'Экстренная остановка всех краулингов');
    this.shouldStop = true;
    this.pendingUrls = [];
    this.currentSiteId = null;

    await this.closeBrowser();

    // Stop all active crawls
    for (const siteId of Array.from(this.activeCrawls.keys())) {
      this.activeCrawls.set(siteId, false);
      await storage.updateSite(siteId, {
        status: 'idle',
        error: 'Emergency stop - all crawls terminated'
      });
      this.log(siteId, 'warning', 'Краулинг остановлен в экстренном режиме');
    }

    this.activeCrawls.clear();
    console.log('All crawls stopped');
  }
}

export const crawler = new WebCrawler();