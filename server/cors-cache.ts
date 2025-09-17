import { storage } from "./storage";
import { log } from "./vite";

// CORS hostname cache with TTL
interface HostnameCache {
  hostnames: Set<string>;
  timestamp: number;
}

let corsCache: HostnameCache | null = null;
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// Function to refresh the CORS hostname cache
export async function refreshCorsCache(): Promise<Set<string>> {
  try {
    const sites = await storage.getAllSites();
    const hostnames = new Set<string>();
    
    // Add Tilda domains
    hostnames.add('tilda.ws');
    
    // Process database sites and extract hostnames
    for (const site of sites) {
      try {
        const url = new URL(site.url);
        hostnames.add(url.hostname);
      } catch (urlError) {
        log(`CORS cache: Invalid URL in database: ${site.url} - ${urlError}`);
        // Skip invalid URLs instead of breaking the entire cache
      }
    }
    
    // Update cache
    corsCache = {
      hostnames,
      timestamp: Date.now()
    };
    
    log(`CORS cache refreshed with ${hostnames.size} hostnames: [${Array.from(hostnames).join(', ')}]`);
    return hostnames;
  } catch (error) {
    log(`CORS cache refresh error: ${error}`);
    // Return empty set on error to fail safely
    return new Set();
  }
}

// Function to invalidate CORS cache (exported for use in routes)
export function invalidateCorsCache(): void {
  if (corsCache) {
    log(`CORS cache invalidated (was: ${corsCache.hostnames.size} hostnames)`);
    corsCache = null;
  }
}

// Function to get current allowed hostnames (with cache)
export async function getAllowedHostnames(): Promise<Set<string>> {
  const now = Date.now();
  
  // Check if cache is valid
  if (corsCache && (now - corsCache.timestamp) < CACHE_TTL_MS) {
    return corsCache.hostnames;
  }
  
  // Cache is stale or doesn't exist, refresh it
  return await refreshCorsCache();
}