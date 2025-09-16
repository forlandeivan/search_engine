import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { URL } from 'url';
import crypto from 'crypto';
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

export class WebCrawler {
  private crawledUrls = new Set<string>();
  private pendingUrls: { url: string; depth: number }[] = [];
  private currentSiteId: string | null = null;
  private options: CrawlOptions = {
    maxDepth: 3,
    followExternalLinks: false,
    excludePatterns: []
  };

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

      this.currentSiteId = siteId;
      this.crawledUrls.clear();
      this.pendingUrls = [{ url: site.url, depth: 0 }];
      this.options = {
        maxDepth: site.crawlDepth,
        followExternalLinks: site.followExternalLinks,
        excludePatterns: site.excludePatterns
      };

      let totalPages = 0;
      let indexedPages = 0;

      while (this.pendingUrls.length > 0) {
        const { url, depth } = this.pendingUrls.shift()!;
        
        if (this.shouldSkipUrl(url, depth)) {
          continue;
        }

        try {
          console.log(`Crawling: ${url} (depth: ${depth})`);
          const result = await this.crawlPage(url);
          
          if (result) {
            totalPages++;
            
            // Save page to database
            const contentHash = crypto.createHash('md5').update(result.content).digest('hex');
            const existingPages = await storage.getPagesByUrl(url);
            
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
                console.log(`Updated page: ${url}`);
              }
            } else {
              // Create new page
              const newPage: InsertPage = {
                siteId: this.currentSiteId!,
                url: url,
                title: result.title || '',
                content: result.content,
                metaDescription: result.metaDescription,
                statusCode: result.statusCode,
                lastCrawled: new Date(),
                contentHash
              };
              await storage.createPage(newPage);
              indexedPages++;
              console.log(`Indexed new page: ${url}`);
            }

            // Add discovered links for further crawling
            if (depth < this.options.maxDepth) {
              result.links.forEach(link => {
                this.pendingUrls.push({ url: link, depth: depth + 1 });
              });
            }
          }
        } catch (error) {
          console.error(`Error crawling ${url}:`, error);
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

      console.log(`Crawl completed for site ${siteId}. Total pages: ${totalPages}, Indexed: ${indexedPages}`);

    } catch (error) {
      console.error(`Crawl failed for site ${siteId}:`, error);
      await storage.updateSite(siteId, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private async crawlPage(url: string): Promise<CrawlResult | null> {
    try {
      const response = await fetch(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'SearchEngine-Crawler/1.0 (+https://example.com/crawler)'
        }
      });

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
            const linkUrl = new URL(href, url);
            const linkStr = linkUrl.toString();
            
            // Filter links based on options
            if (this.options.followExternalLinks || linkUrl.hostname === baseUrl.hostname) {
              if (!this.crawledUrls.has(linkStr) && this.isValidUrl(linkStr)) {
                links.push(linkStr);
              }
            }
          } catch (e) {
            // Invalid URL, skip
          }
        }
      });

      this.crawledUrls.add(url);

      return {
        url,
        title,
        content,
        metaDescription,
        statusCode: response.status,
        links: [...new Set(links)] // Remove duplicates
      };

    } catch (error) {
      console.error(`Error crawling page ${url}:`, error);
      return {
        url,
        content: '',
        statusCode: 0,
        links: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private shouldSkipUrl(url: string, depth: number): boolean {
    if (this.crawledUrls.has(url)) {
      return true;
    }

    if (depth > this.options.maxDepth) {
      return true;
    }

    // Check exclude patterns
    for (const pattern of this.options.excludePatterns) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(url)) {
          return true;
        }
      } catch (e) {
        console.warn(`Invalid regex pattern: ${pattern}`);
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
        return false;
      }

      // Skip certain protocols
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return false;
      }

      // Skip fragments and certain query parameters
      if (parsedUrl.hash.includes('#comment') || parsedUrl.search.includes('print=')) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  async stopCrawl(siteId: string): Promise<void> {
    await storage.updateSite(siteId, { status: 'idle' });
    this.pendingUrls = [];
    console.log(`Crawl stopped for site ${siteId}`);
  }
}

export const crawler = new WebCrawler();