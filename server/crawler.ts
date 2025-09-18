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
  private shouldStop = false;
  private activeCrawls = new Map<string, boolean>();
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
      this.shouldStop = false;
      this.activeCrawls.set(siteId, true);
      this.crawledUrls.clear();
      this.pendingUrls = [{ url: site.url, depth: 0 }];
      this.options = {
        maxDepth: site.crawlDepth,
        followExternalLinks: site.followExternalLinks,
        excludePatterns: site.excludePatterns
      };

      let totalPages = 0;
      let indexedPages = 0;

      while (this.pendingUrls.length > 0 && !this.shouldStop) {
        // Check if crawl was stopped
        if (!this.activeCrawls.get(siteId)) {
          console.log(`Crawl was stopped for site ${siteId}`);
          break;
        }

        const { url, depth } = this.pendingUrls.shift()!;
        
        if (this.shouldSkipUrl(url, depth)) {
          continue;
        }

        try {
          console.log(`Crawling: ${url} (depth: ${depth})`);
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
                console.log(`Updated page: ${result.url}`);
              } else {
                console.log(`Page unchanged, skipping: ${result.url}`);
              }
            } else {
              // Create new page
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
              console.log(`Indexed new page: ${result.url}`);
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
      // Remove trailing slash for consistency
      const normalizedUrl = parsedUrl.toString();
      return normalizedUrl.endsWith('/') ? normalizedUrl.slice(0, -1) : normalizedUrl;
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
        console.log(`Skipping duplicate page (fragment removed): ${url} -> ${normalizedUrl}`);
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
      
      console.error(`Error crawling page ${url}:`, errorMessage);
      return {
        url,
        content: '',
        statusCode: 0,
        links: [],
        error: errorMessage
      };
    }
  }

  private shouldSkipUrl(url: string, depth: number): boolean {
    const normalizedUrl = this.normalizeUrl(url);
    if (this.crawledUrls.has(normalizedUrl)) {
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

      // Skip URLs that are only different by fragment (already normalized)
      // Skip certain query parameters that indicate non-content pages
      if (parsedUrl.search.includes('print=') || parsedUrl.search.includes('download=')) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  async stopCrawl(siteId: string): Promise<void> {
    console.log(`Stopping crawl for site ${siteId}`);
    
    // Set stop flags immediately
    this.shouldStop = true;
    this.activeCrawls.set(siteId, false);
    
    // Clear pending URLs
    this.pendingUrls = [];
    
    // Update database status
    await storage.updateSite(siteId, { 
      status: 'idle',
      error: 'Crawl manually stopped'
    });
    
    // Clean up if this is the current site
    if (this.currentSiteId === siteId) {
      this.currentSiteId = null;
    }
    
    console.log(`Crawl forcefully stopped for site ${siteId}`);
  }

  // Emergency stop all crawls
  async stopAllCrawls(): Promise<void> {
    console.log('Emergency stop: stopping all active crawls');
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
    }
    
    this.activeCrawls.clear();
    console.log('All crawls stopped');
  }
}

export const crawler = new WebCrawler();