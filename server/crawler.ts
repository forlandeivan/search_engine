import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { URL } from 'url';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { storage } from './storage';
import { type InsertPage, type ContentChunk, type PageMetadata, type ChunkMedia } from '@shared/schema';

type CheerioRoot = ReturnType<typeof cheerio.load>;
type CheerioCollection = cheerio.Cheerio<any>;

interface CrawlOptions {
  maxDepth: number;
  followExternalLinks: boolean;
  excludePatterns: string[];
  maxChunkSize: number;
}

interface CrawlResult {
  url: string;
  title?: string;
  content: string;
  metaDescription?: string;
  statusCode: number;
  links: string[];
  metadata: PageMetadata;
  chunks: ContentChunk[];
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
  private readonly defaultMaxChunkSize = 1200;
  private options: CrawlOptions = {
    maxDepth: 3,
    followExternalLinks: false,
    excludePatterns: [],
    maxChunkSize: this.defaultMaxChunkSize,
  };

  constructor() {
    this.logEmitter.setMaxListeners(0);
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

  private async launchBrowser(puppeteer: any): Promise<any> {
    const launchProfiles = [
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
      };

      this.log(siteId, 'info', 'Запуск краулинга проекта', {
        project: site.name ?? site.url,
        startUrls: initialUrls,
        maxDepth: this.options.maxDepth,
        followExternalLinks: this.options.followExternalLinks,
        excludePatterns: this.options.excludePatterns,
        maxChunkSize: this.options.maxChunkSize,
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

      const $ = cheerio.load(html);
      this.cleanDocument($);

      const title = this.normalizeText($('title').first().text()) || this.normalizeText($('h1').first().text());
      const contentRoot = this.getContentRoot($);

      const { chunks, aggregatedText, wordCount } = this.parseContentIntoChunks($, contentRoot, resolvedUrl);

      const metaDescription = this.extractMetaDescription($);
      const pageMetadata = this.extractPageMetadata($, resolvedUrl, aggregatedText, chunks, wordCount, metaDescription);

      const discoveredLinks = this.extractLinksForCrawl($, resolvedUrl);

      this.crawledUrls.add(resolvedUrl);

      return {
        url: resolvedUrl,
        title,
        content: aggregatedText,
        metaDescription,
        statusCode,
        links: discoveredLinks,
        metadata: pageMetadata,
        chunks,
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

  private async fetchPageContent(url: string): Promise<{ html: string; statusCode: number; finalUrl: string }> {
    const browser = await this.getBrowser();

    if (browser) {
      let page: any = null;
      try {
        page = await browser.newPage();
        await page.setUserAgent('SearchEngine-Crawler/1.0 (+https://example.com/crawler)');

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
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'SearchEngine-Crawler/1.0 (+https://example.com/crawler)',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('text/html')) {
        throw new Error(`Неподдерживаемый тип контента: ${contentType ?? 'unknown'}`);
      }

      const html = await response.text();

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

  private cleanDocument($: CheerioRoot): void {
    const removalSelectors = [
      'script',
      'style',
      'noscript',
      'iframe',
      'form',
      'input',
      'button',
      'select',
      'textarea',
      'header',
      'footer',
      'nav',
      'aside',
      'svg',
      'canvas',
      '.sidebar',
      '.navigation',
      '.nav',
      '.menu',
      '.advertisement',
      '.ads',
      '.ad',
      '.ad-banner',
      '.breadcrumbs',
      '.cookie',
      '.modal',
      '[role="navigation"]',
      '[aria-hidden="true"]',
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

  private parseContentIntoChunks(
    $: CheerioRoot,
    contentRoot: CheerioCollection,
    pageUrl: string
  ): { chunks: ContentChunk[]; aggregatedText: string; wordCount: number } {
    const headings = contentRoot.find('h2, h3, h4').toArray();
    const chunks: ContentChunk[] = [];
    let positionCounter = 0;

    const pushChunk = (chunk: ContentChunk) => {
      const chunkSizeLimit = this.options.maxChunkSize ?? this.defaultMaxChunkSize;
      const chunkCopies = this.subdivideChunksBySize(chunk, chunkSizeLimit);
      for (const part of chunkCopies) {
        const clonedImages = part.metadata.images.map(image => ({ ...image }));
        const clonedLinks = [...part.metadata.links];
        chunks.push({
          ...part,
          metadata: {
            ...part.metadata,
            images: clonedImages,
            links: clonedLinks,
            position: positionCounter++,
          },
        });
      }
    };

    if (headings.length === 0) {
      const fullText = this.normalizeText(contentRoot.text());
      if (fullText.length > 0) {
        const fallbackHeading = this.normalizeText($('h1').first().text()) || 'Основной контент';
        const html = contentRoot.html() ?? '';
        const fallbackChunk: ContentChunk = {
          id: 'content-section-0',
          heading: fallbackHeading,
          level: 2,
          content: fullText,
          deepLink: pageUrl,
          metadata: {
            images: this.collectChunkImagesFromHtml(html, pageUrl),
            links: this.collectChunkLinksFromHtml(html, pageUrl),
            position: 0,
            wordCount: this.countWords(fullText),
            charCount: fullText.length,
            estimatedReadingTimeSec: this.calculateReadingTimeSec(this.countWords(fullText)),
            excerpt: this.buildExcerpt(fullText),
          },
        };

        pushChunk(fallbackChunk);
      }
    } else {
      headings.forEach((element: any, index: number) => {
        const headingElement = $(element);
        const headingText = this.normalizeText(headingElement.text()) || `Раздел ${index + 1}`;
        const level = parseInt(element.tagName?.replace(/[^0-9]/g, '') ?? '2', 10) || 2;

        const sectionNodes: any[] = [];
        let node = element.next;

        while (node) {
          if (node.type === 'tag') {
            const tagName = node.name?.toLowerCase();
            if (tagName && /^h[1-6]$/.test(tagName)) {
              const nodeLevel = parseInt(tagName.replace(/[^0-9]/g, ''), 10) || 6;
              if (nodeLevel <= level) {
                break;
              }
            }
          }
          sectionNodes.push(node);
          node = node.next;
        }

        const sectionHtml = sectionNodes.map(nodeItem => $.html(nodeItem)).join('');
        const sectionText = this.normalizeText(cheerio.load(sectionHtml).text());

        const chunk: ContentChunk = {
          id: headingElement.attr('id')?.trim() || `heading-${index}`,
          heading: headingText,
          level,
          content: sectionText,
          deepLink: this.buildDeepLink(pageUrl, headingElement, headingText, index),
          metadata: {
            images: this.collectChunkImagesFromHtml(sectionHtml, pageUrl),
            links: this.collectChunkLinksFromHtml(sectionHtml, pageUrl),
            position: 0,
            wordCount: this.countWords(sectionText),
            charCount: sectionText.length,
            estimatedReadingTimeSec: this.calculateReadingTimeSec(this.countWords(sectionText)),
            excerpt: this.buildExcerpt(sectionText),
          },
        };

        pushChunk(chunk);
      });
    }

    const aggregatedText = this.normalizeText(
      chunks
        .map(chunk => `${chunk.heading}\n${chunk.content}`.trim())
        .filter(Boolean)
        .join('\n\n')
    );

    const wordCount = this.countWords(aggregatedText);

    return {
      chunks,
      aggregatedText,
      wordCount,
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
    metaDescription?: string
  ): PageMetadata {
    const metadata: PageMetadata = {
      description: metaDescription,
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
      links: this.collectPageLinks($, pageUrl),
      language: (this.normalizeText($('html').attr('lang')) || undefined)?.toLowerCase(),
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
    if (chunk.content.length <= maxSize) {
      return [
        {
          ...chunk,
          metadata: {
            ...chunk.metadata,
            images: chunk.metadata.images.map(image => ({ ...image })),
            links: [...chunk.metadata.links],
          },
        },
      ];
    }

    const parts = this.splitTextIntoChunks(chunk.content, maxSize);
    if (parts.length <= 1) {
      return [chunk];
    }

    return parts.map((text, index) => {
      const wordCount = this.countWords(text);
      return {
        ...chunk,
        id: `${chunk.id}-part-${index + 1}`,
        heading: index === 0 ? chunk.heading : `${chunk.heading} (часть ${index + 1})`,
        content: text,
        metadata: {
          ...chunk.metadata,
          wordCount,
          charCount: text.length,
          estimatedReadingTimeSec: this.calculateReadingTimeSec(wordCount),
          excerpt: this.buildExcerpt(text),
          images: chunk.metadata.images.map(image => ({ ...image })),
          links: [...chunk.metadata.links],
        },
      };
    });
  }

  private splitTextIntoChunks(text: string, maxSize: number): string[] {
    if (text.length <= maxSize) {
      return [text];
    }

    const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) ?? [];
    const chunks: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      const candidate = `${current} ${sentence}`.trim();
      if (candidate.length > maxSize && current) {
        chunks.push(current.trim());
        current = sentence.trim();
      } else {
        current = candidate;
      }
    }

    if (current) {
      chunks.push(current.trim());
    }

    if (chunks.length === 0) {
      const words = text.split(/\s+/);
      let buffer: string[] = [];
      let bufferLength = 0;
      for (const word of words) {
        if (bufferLength + word.length + 1 > maxSize) {
          chunks.push(buffer.join(' ').trim());
          buffer = [word];
          bufferLength = word.length + 1;
        } else {
          buffer.push(word);
          bufferLength += word.length + 1;
        }
      }
      if (buffer.length > 0) {
        chunks.push(buffer.join(' ').trim());
      }
    }

    return chunks.filter(Boolean);
  }

  private collectChunkImagesFromHtml(html: string, pageUrl: string): ChunkMedia[] {
    const $ = cheerio.load(html);
    const images: ChunkMedia[] = [];
    const seen = new Set<string>();

    $('img[src]').each((_, element) => {
      const src = this.normalizeText($(element).attr('src'));
      if (!src) {
        return;
      }

      const resolved = this.resolveUrl(src, pageUrl);
      if (!resolved || seen.has(resolved)) {
        return;
      }

      seen.add(resolved);
      const alt = this.normalizeText($(element).attr('alt')) || undefined;
      images.push({ src: resolved, alt });
    });

    return images.slice(0, 10);
  }

  private collectChunkLinksFromHtml(html: string, pageUrl: string): string[] {
    const $ = cheerio.load(html);
    const links: string[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, element) => {
      const href = this.normalizeText($(element).attr('href'));
      if (!href) {
        return;
      }

      const resolved = this.resolveUrl(href, pageUrl);
      if (!resolved || seen.has(resolved) || !this.isValidUrl(resolved)) {
        return;
      }

      seen.add(resolved);
      links.push(resolved);
    });

    return links.slice(0, 20);
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

  private buildDeepLink(
    pageUrl: string,
    headingElement: CheerioCollection,
    headingText: string,
    index: number
  ): string {
    const anchorId = this.normalizeText(headingElement.attr('id')) || this.normalizeText(headingElement.attr('name'));
    if (anchorId) {
      return `${pageUrl}#${encodeURIComponent(anchorId)}`;
    }

    if (headingText) {
      const fragment = headingText.split(' ').slice(0, 12).join(' ');
      const encoded = encodeURIComponent(fragment);
      return `${pageUrl}#:~:text=${encoded}`;
    }

    return `${pageUrl}#section-${index}`;
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