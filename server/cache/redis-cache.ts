/**
 * Redis Cache Implementation
 * 
 * Phase 4.1: Redis cache backend for multi-instance deployments
 */

import Redis, { type RedisOptions } from 'ioredis';
import { createLogger } from '../lib/logger';
import type { CacheProvider } from './cache-manager';

const logger = createLogger('cache:redis');

/**
 * Redis cache provider
 * 
 * Suitable for multi-instance deployments.
 * Data is shared between all instances via Redis.
 */
export class RedisCache implements CacheProvider {
  readonly name = 'redis';
  
  private readonly client: Redis;
  private readonly keyPrefix: string;

  constructor(redisUrl: string, options?: { keyPrefix?: string; connectTimeout?: number }) {
    this.keyPrefix = options?.keyPrefix ?? 'cache:';

    const redisOptions: RedisOptions = {
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      connectTimeout: options?.connectTimeout ?? 5000,
      lazyConnect: true,
    };

    this.client = new Redis(redisUrl, redisOptions);

    this.client.on('connect', () => {
      logger.info('Redis cache connecting');
    });

    this.client.on('ready', () => {
      logger.info('Redis cache ready');
    });

    this.client.on('error', (err) => {
      logger.error({ err }, 'Redis cache error');
    });

    this.client.on('close', () => {
      logger.warn('Redis cache connection closed');
    });

    // Connect immediately
    this.client.connect().catch((err) => {
      logger.error({ err }, 'Failed to connect Redis cache');
    });
  }

  private getKey(key: string): string {
    return `${this.keyPrefix}${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const fullKey = this.getKey(key);
      const value = await this.client.get(fullKey);
      
      if (value === null) {
        return null;
      }

      try {
        return JSON.parse(value) as T;
      } catch (parseError) {
        logger.warn({ key, error: parseError }, 'Failed to parse cached value');
        // If not JSON, try to return as string (backward compatibility)
        return value as unknown as T;
      }
    } catch (error) {
      logger.error({ key, error }, 'Redis cache get error');
      return null; // Fail gracefully - return null on error
    }
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    try {
      const fullKey = this.getKey(key);
      const serialized = JSON.stringify(value);
      
      if (ttl !== undefined) {
        // Convert ms to seconds for Redis
        const ttlSeconds = Math.max(1, Math.floor(ttl / 1000));
        await this.client.setex(fullKey, ttlSeconds, serialized);
      } else {
        await this.client.set(fullKey, serialized);
      }
    } catch (error) {
      logger.error({ key, error }, 'Redis cache set error');
      // Don't throw - caching failures should not break the app
    }
  }

  async del(key: string): Promise<void> {
    try {
      const fullKey = this.getKey(key);
      await this.client.del(fullKey);
    } catch (error) {
      logger.error({ key, error }, 'Redis cache del error');
    }
  }

  async clear(): Promise<void> {
    try {
      // Clear all keys with our prefix
      const keys = await this.client.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      logger.info({ count: keys.length }, 'Redis cache cleared');
    } catch (error) {
      logger.error({ error }, 'Redis cache clear error');
    }
  }

  /**
   * Close Redis connection gracefully
   */
  async close(): Promise<void> {
    await this.client.quit();
    logger.info('Redis cache connection closed');
  }

  /**
   * Check if Redis is connected and ready
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.ping();
      return this.client.status === 'ready';
    } catch {
      return false;
    }
  }
}
