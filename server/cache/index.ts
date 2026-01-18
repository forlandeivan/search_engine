/**
 * Cache Provider Selection and Export
 * 
 * Phase 4.1: Automatically selects cache backend based on REDIS_URL
 */

import { MemoryCache } from './memory-cache';
import { RedisCache } from './redis-cache';
import { createLogger } from '../lib/logger';
import type { CacheProvider } from './cache-manager';

const logger = createLogger('cache');

let cacheProvider: CacheProvider | null = null;

/**
 * Get the configured cache provider
 * 
 * Returns RedisCache if REDIS_URL is set, otherwise MemoryCache.
 * Initializes on first call (singleton pattern).
 */
export function getCache(): CacheProvider {
  if (cacheProvider) {
    return cacheProvider;
  }

  const redisUrl = process.env.REDIS_URL?.trim();

  if (redisUrl && redisUrl.length > 0) {
    logger.info('Using Redis cache backend');
    cacheProvider = new RedisCache(redisUrl);
  } else {
    logger.info('Using in-memory cache backend');
    cacheProvider = new MemoryCache();
  }

  return cacheProvider;
}

/**
 * Close cache connections gracefully (for Redis)
 * Should be called during application shutdown
 */
export async function closeCache(): Promise<void> {
  if (cacheProvider && 'close' in cacheProvider && typeof cacheProvider.close === 'function') {
    await (cacheProvider as RedisCache).close();
  }
  cacheProvider = null;
}

// Re-export types and implementations
export type { CacheProvider } from './cache-manager';
export { MemoryCache } from './memory-cache';
export { RedisCache } from './redis-cache';
export { cacheKeys } from './cache-manager';

// Default export for convenience
export default getCache();
