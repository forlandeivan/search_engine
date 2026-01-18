/**
 * Redis PubSub implementation for multi-instance deployments.
 * 
 * Phase 4.2: WebSocket масштабирование через Pub/Sub
 * 
 * Features:
 * - Pattern subscriptions (e.g., "chat:*" for all chats)
 * - Automatic reconnection
 * - Health monitoring
 * - JSON serialization
 * 
 * Requirements:
 * - REDIS_URL environment variable must be set
 * - Redis server must support Pub/Sub (any Redis version)
 */

import Redis, { type RedisOptions } from 'ioredis';
import { createLogger } from '../lib/logger';
import type { PubSubProvider, PubSubMessage, PubSubHandler } from './pubsub';

const logger = createLogger('redis-pubsub');

/**
 * Redis connection options
 */
interface RedisConnectionOptions {
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url: string;
  /** Connection timeout in ms (default: 5000) */
  connectTimeout?: number;
  /** Max reconnection attempts (default: 10) */
  maxRetriesPerRequest?: number;
  /** Key prefix for all pubsub channels (default: "pubsub:") */
  keyPrefix?: string;
}

/**
 * Redis PubSub implementation.
 * 
 * Uses two Redis connections:
 * - Publisher: for publishing messages
 * - Subscriber: for receiving messages (dedicated connection required by Redis)
 * 
 * This allows the application to scale horizontally - messages published on one
 * instance are received by all other instances.
 */
export class RedisPubSub implements PubSubProvider {
  readonly name = 'redis';
  
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly keyPrefix: string;
  private readonly instanceId: string;
  private readonly subscriptions = new Map<string, Set<PubSubHandler>>();
  private readonly patternSubscriptions = new Map<string, Set<PubSubHandler>>();
  private closed = false;
  private connected = false;
  
  constructor(options: RedisConnectionOptions) {
    this.keyPrefix = options.keyPrefix ?? 'pubsub:';
    this.instanceId = `redis-${process.pid}-${Date.now()}`;
    
    const redisOptions: RedisOptions = {
      connectTimeout: options.connectTimeout ?? 5000,
      maxRetriesPerRequest: options.maxRetriesPerRequest ?? 10,
      retryStrategy: (times: number) => {
        if (times > 10) {
          logger.error({ times }, 'Redis max retries exceeded');
          return null; // Stop retrying
        }
        const delay = Math.min(times * 100, 3000);
        logger.warn({ times, delay }, 'Redis reconnecting');
        return delay;
      },
      lazyConnect: false,
    };
    
    // Create publisher connection
    this.publisher = new Redis(options.url, redisOptions);
    this.setupConnectionHandlers(this.publisher, 'publisher');
    
    // Create subscriber connection (separate connection required for subscriptions)
    this.subscriber = new Redis(options.url, redisOptions);
    this.setupConnectionHandlers(this.subscriber, 'subscriber');
    
    // Setup message handlers
    this.setupMessageHandlers();
    
    logger.info({ 
      instanceId: this.instanceId,
      keyPrefix: this.keyPrefix,
    }, 'RedisPubSub initialized');
  }
  
  private setupConnectionHandlers(client: Redis, role: string): void {
    client.on('connect', () => {
      this.connected = true;
      logger.info({ role }, 'Redis connected');
    });
    
    client.on('ready', () => {
      logger.info({ role }, 'Redis ready');
    });
    
    client.on('error', (error) => {
      logger.error({ role, error: error.message }, 'Redis error');
    });
    
    client.on('close', () => {
      this.connected = false;
      logger.warn({ role }, 'Redis connection closed');
    });
    
    client.on('reconnecting', () => {
      logger.info({ role }, 'Redis reconnecting');
    });
  }
  
  private setupMessageHandlers(): void {
    // Handle regular channel messages
    this.subscriber.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message, false);
    });
    
    // Handle pattern subscription messages
    this.subscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
      this.handleMessage(channel, message, true, pattern);
    });
  }
  
  private handleMessage(channel: string, rawMessage: string, isPattern: boolean, pattern?: string): void {
    try {
      // Remove key prefix from channel name for handler
      const originalChannel = channel.startsWith(this.keyPrefix) 
        ? channel.substring(this.keyPrefix.length)
        : channel;
      
      const parsedData = JSON.parse(rawMessage) as PubSubMessage;
      const message: PubSubMessage = {
        ...parsedData,
        channel: originalChannel,
      };
      
      // Get handlers for this channel/pattern
      const handlers = isPattern && pattern
        ? this.patternSubscriptions.get(pattern)
        : this.subscriptions.get(channel);
      
      if (handlers && handlers.size > 0) {
        for (const handler of handlers) {
          try {
            handler(message);
          } catch (error) {
            logger.error({ 
              error, 
              channel: originalChannel,
              pattern,
            }, 'Error in pubsub handler');
          }
        }
      }
      
      logger.debug({ 
        channel: originalChannel,
        isPattern,
        pattern,
        handlersCount: handlers?.size ?? 0,
      }, 'Processed message');
    } catch (error) {
      logger.error({ 
        error, 
        channel,
        rawMessage: rawMessage.substring(0, 100),
      }, 'Failed to parse pubsub message');
    }
  }
  
  async publish<T>(channel: string, data: T): Promise<void> {
    if (this.closed) {
      logger.warn({ channel }, 'Attempted to publish on closed RedisPubSub');
      return;
    }
    
    const prefixedChannel = `${this.keyPrefix}${channel}`;
    const message: PubSubMessage<T> = {
      channel,
      data,
      meta: {
        instanceId: this.instanceId,
        timestamp: Date.now(),
      },
    };
    
    try {
      await this.publisher.publish(prefixedChannel, JSON.stringify(message));
      logger.debug({ channel, prefixedChannel }, 'Published message to Redis');
    } catch (error) {
      logger.error({ error, channel }, 'Failed to publish message to Redis');
      throw error;
    }
  }
  
  subscribe<T>(pattern: string, handler: PubSubHandler<T>): () => void {
    if (this.closed) {
      logger.warn({ pattern }, 'Attempted to subscribe on closed RedisPubSub');
      return () => {};
    }
    
    const prefixedPattern = `${this.keyPrefix}${pattern}`;
    
    // Check if this is a pattern subscription (contains *)
    if (pattern.includes('*')) {
      return this.subscribePattern(prefixedPattern, pattern, handler);
    }
    
    return this.subscribeExact(pattern, handler);
  }
  
  private subscribePattern<T>(prefixedPattern: string, originalPattern: string, handler: PubSubHandler<T>): () => void {
    // Track handlers for this pattern
    if (!this.patternSubscriptions.has(prefixedPattern)) {
      this.patternSubscriptions.set(prefixedPattern, new Set());
      
      // Subscribe to pattern in Redis
      this.subscriber.psubscribe(prefixedPattern).catch((error) => {
        logger.error({ error, pattern: originalPattern }, 'Failed to psubscribe');
      });
      
      logger.debug({ pattern: originalPattern, prefixedPattern }, 'Subscribed to pattern');
    }
    
    this.patternSubscriptions.get(prefixedPattern)!.add(handler as PubSubHandler);
    
    return () => {
      const handlers = this.patternSubscriptions.get(prefixedPattern);
      if (handlers) {
        handlers.delete(handler as PubSubHandler);
        
        // If no more handlers, unsubscribe from pattern
        if (handlers.size === 0) {
          this.patternSubscriptions.delete(prefixedPattern);
          this.subscriber.punsubscribe(prefixedPattern).catch((error) => {
            logger.error({ error, pattern: originalPattern }, 'Failed to punsubscribe');
          });
          logger.debug({ pattern: originalPattern }, 'Unsubscribed from pattern');
        }
      }
    };
  }
  
  subscribeExact<T>(channel: string, handler: PubSubHandler<T>): () => void {
    if (this.closed) {
      logger.warn({ channel }, 'Attempted to subscribe on closed RedisPubSub');
      return () => {};
    }
    
    const prefixedChannel = `${this.keyPrefix}${channel}`;
    
    // Track handlers for this channel
    if (!this.subscriptions.has(prefixedChannel)) {
      this.subscriptions.set(prefixedChannel, new Set());
      
      // Subscribe to channel in Redis
      this.subscriber.subscribe(prefixedChannel).catch((error) => {
        logger.error({ error, channel }, 'Failed to subscribe');
      });
      
      logger.debug({ channel, prefixedChannel }, 'Subscribed to channel');
    }
    
    this.subscriptions.get(prefixedChannel)!.add(handler as PubSubHandler);
    
    return () => {
      const handlers = this.subscriptions.get(prefixedChannel);
      if (handlers) {
        handlers.delete(handler as PubSubHandler);
        
        // If no more handlers, unsubscribe from channel
        if (handlers.size === 0) {
          this.subscriptions.delete(prefixedChannel);
          this.subscriber.unsubscribe(prefixedChannel).catch((error) => {
            logger.error({ error, channel }, 'Failed to unsubscribe');
          });
          logger.debug({ channel }, 'Unsubscribed from channel');
        }
      }
    };
  }
  
  async isHealthy(): Promise<boolean> {
    if (this.closed) return false;
    
    try {
      const result = await this.publisher.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error({ error }, 'Redis health check failed');
      return false;
    }
  }
  
  async close(): Promise<void> {
    if (this.closed) return;
    
    this.closed = true;
    
    // Clear all subscriptions
    this.subscriptions.clear();
    this.patternSubscriptions.clear();
    
    // Close connections
    await Promise.all([
      this.publisher.quit().catch((e) => logger.error({ error: e }, 'Publisher quit error')),
      this.subscriber.quit().catch((e) => logger.error({ error: e }, 'Subscriber quit error')),
    ]);
    
    logger.info({ instanceId: this.instanceId }, 'RedisPubSub closed');
  }
  
  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.connected && !this.closed;
  }
  
  /**
   * Get statistics about current subscriptions
   */
  getStats(): { channels: number; patterns: number } {
    return {
      channels: this.subscriptions.size,
      patterns: this.patternSubscriptions.size,
    };
  }
}

/**
 * Create RedisPubSub instance from REDIS_URL environment variable
 */
export function createRedisPubSub(url?: string): RedisPubSub | null {
  const redisUrl = url ?? process.env.REDIS_URL;
  
  if (!redisUrl) {
    logger.info('REDIS_URL not set, RedisPubSub not available');
    return null;
  }
  
  try {
    return new RedisPubSub({ url: redisUrl });
  } catch (error) {
    logger.error({ error }, 'Failed to create RedisPubSub');
    return null;
  }
}
