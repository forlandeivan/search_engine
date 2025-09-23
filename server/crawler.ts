import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { URL } from 'url';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { storage } from './storage';
import { type Site, type InsertPage } from '@shared/schema';

interface CrawlOptions {
  maxDepth: number;
  followExternalLinks: boolean;
  excludePatterns: string[];
}

interface CrawlResult {
  url: string;
  title?: string;
  content: string;
  metaDescription?: string;
  statusCode: number;
  links: string[];
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
  private options: CrawlOptions = {
    maxDepth: 3,
    followExternalLinks: false,
    excludePatterns: []
  };

  constructor() {
    this.logEmitter.setMaxListeners(0);
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

      if (!site.url) {
        await storage.updateSite(siteId, {
          status: 'idle',
          error: 'URL не задан для проекта'
        });
        throw new Error(`Site with ID ${siteId} does not have a configured URL`);
      }

      this.currentSiteId = siteId;
      this.shouldStop = false;
      this.activeCrawls.set(siteId, true);
      this.crawledUrls.clear();
      this.pendingUrls = [{ url: site.url, depth: 0 }];
      this.options = {
        maxDepth: site.crawlDepth,
        followExternalLinks: site.followExternalLinks,
        excludePatterns: site.excludePatterns
      };

      this.log(siteId, 'info', 'Запуск краулинга проекта', {
        url: site.url,
        maxDepth: this.options.maxDepth,
        followExternalLinks: this.options.followExternalLinks,
        excludePatterns: this.options.excludePatterns,
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
            totalPages++;
            
            // Save page to database using normalized URL
            const contentHash = crypto.createHash('md5').update(result.content).digest('hex');
            const existingPages = await storage.getPagesByUrl(result.url);
            
            if (existingPages.length > 0) {
              // Update existing page
              const existingPage = existingPages[0];
              if (existingPage.contentHash !== contentHash) {
                await storage.updatePage(existingPage.id, {
                  title: result.title,
                  content: result.content,
                  metaDescription: result.metaDescription,
                  statusCode: result.statusCode,
                  lastCrawled: new Date(),
                  contentHash
                });
                indexedPages++;
                this.log(siteId, 'info', 'Обновлено содержимое страницы', {
                  url: result.url,
                  statusCode: result.statusCode,
                });
              } else {
                this.log(siteId, 'debug', 'Страница не изменилась, пропускаем', {
                  url: result.url,
                });
              }
            } else {
              // Create new page - this handles both first crawl and re-crawl scenarios
              const newPage: InsertPage = {
                siteId: this.currentSiteId!,
                url: result.url,
                title: result.title || '',
                content: result.content,
                metaDescription: result.metaDescription,
                statusCode: result.statusCode,
                lastCrawled: new Date(),
                contentHash
              };
              await storage.createPage(newPage);
              indexedPages++;
              this.log(siteId, 'info', 'Проиндексирована новая страница', {
                url: result.url,
                statusCode: result.statusCode,
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
    try {
      // Normalize URL to remove fragments and trailing slashes
      const normalizedUrl = this.normalizeUrl(url);
      
      // Check if we already crawled this page (without fragment)
      if (this.crawledUrls.has(normalizedUrl)) {
        this.logForCurrentSite('debug', 'Пропуск дублирующей страницы', {
          originalUrl: url,
          normalizedUrl,
        });
        return null;
      }
      
      // Add timeout to prevent hanging on slow sites
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(normalizedUrl, {
        headers: {
          'User-Agent': 'SearchEngine-Crawler/1.0 (+https://example.com/crawler)'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/html')) {
        return null; // Skip non-HTML content
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove script and style elements
      $('script, style, nav, footer, .sidebar, #sidebar').remove();

      // Extract title
      const title = $('title').text().trim() || $('h1').first().text().trim();

      // Extract meta description
      const metaDescription = $('meta[name="description"]').attr('content')?.trim() || 
                            $('meta[property="og:description"]').attr('content')?.trim();

      // Extract main content
      let content = '';
      const contentSelectors = ['main', 'article', '.content', '.main-content', 'body'];
      
      for (const selector of contentSelectors) {
        const element = $(selector).first();
        if (element.length > 0) {
          // Remove navigation, ads, and other non-content elements
          element.find('nav, .navigation, .nav, .ad, .advertisement, .sidebar, .widget').remove();
          content = element.text().replace(/\s+/g, ' ').trim();
          if (content.length > 100) {
            break;
          }
        }
      }

      // Fallback to body content if no main content found
      if (!content) {
        content = $('body').text().replace(/\s+/g, ' ').trim();
      }

      // Extract links for further crawling
      const links: string[] = [];
      const baseUrl = new URL(url);
      
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          try {
            const linkUrl = new URL(href, normalizedUrl);
            const linkStr = linkUrl.toString();
            const normalizedLinkStr = this.normalizeUrl(linkStr);
            
            // Filter links based on options
            if (this.options.followExternalLinks || linkUrl.hostname === baseUrl.hostname) {
              if (!this.crawledUrls.has(normalizedLinkStr) && this.isValidUrl(normalizedLinkStr)) {
                links.push(normalizedLinkStr);
              }
            }
          } catch (e) {
            // Invalid URL, skip
          }
        }
      });

      // Mark normalized URL as crawled to prevent duplicates
      this.crawledUrls.add(normalizedUrl);

      return {
        url: normalizedUrl, // Use normalized URL for storage
        title,
        content,
        metaDescription,
        statusCode: response.status,
        links: Array.from(new Set(links)) // Remove duplicates
      };

    } catch (error) {
      let errorMessage = 'Unknown error';
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timeout (30s) - site may be slow or blocking crawlers';
        } else {
          errorMessage = error.message;
        }
      }
      
      this.logForCurrentSite('error', 'Ошибка загрузки страницы', {
        url,
        error: errorMessage,
      });
      return {
        url,
        content: '',
        statusCode: 0,
        links: [],
        error: errorMessage
      };
    }
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