/**
 * Cache Provider Interface
 * 
 * Phase 4.1: Внедрение кэширования (in-memory + Redis опционально)
 * 
 * Unified abstraction for caching that supports both in-memory and Redis backends.
 * Automatically selects the appropriate implementation based on REDIS_URL.
 */

export interface CacheProvider {
  /**
   * Get value from cache by key
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set value in cache with optional TTL
   * @param key - Cache key
   * @param value - Value to cache (must be serializable)
   * @param ttl - Time to live in milliseconds (optional, defaults to provider default)
   */
  set(key: string, value: unknown, ttl?: number): Promise<void>;

  /**
   * Delete value from cache by key
   * @param key - Cache key
   */
  del(key: string): Promise<void>;

  /**
   * Clear all cached values
   */
  clear(): Promise<void>;

  /**
   * Get cache provider name (for monitoring/logging)
   */
  readonly name: string;
}

/**
 * Cache key builders for common data types
 */
export const cacheKeys = {
  workspaceSettings: (workspaceId: string) => `ws:${workspaceId}:settings`,
  userWorkspaces: (userId: string) => `user:${userId}:workspaces`,
  llmProviders: (workspaceId?: string) => workspaceId ? `llm:providers:ws:${workspaceId}` : `llm:providers:global`,
  modelsCatalog: (opts?: { type?: string; providerId?: string | null; providerType?: string | null }) => {
    const parts = ['models:catalog'];
    if (opts?.type) parts.push(`type:${opts.type}`);
    if (opts?.providerId) parts.push(`pid:${opts.providerId}`);
    if (opts?.providerType) parts.push(`pt:${opts.providerType}`);
    return parts.join(':');
  },
  skill: (workspaceId: string, skillId: string) => `skill:${workspaceId}:${skillId}`,
  corsHostnames: () => `cors:hostnames`,
} as const;
