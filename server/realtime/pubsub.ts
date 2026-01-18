/**
 * PubSub abstraction for scaling real-time events across multiple server instances.
 * 
 * Phase 4.2: WebSocket масштабирование через Pub/Sub
 * 
 * Architecture:
 * - LocalPubSub (default) - uses EventEmitter, works in single instance
 * - RedisPubSub - uses Redis, works with multiple instances behind load balancer
 * 
 * Selection is automatic based on REDIS_URL environment variable.
 */

import EventEmitter from 'events';
import { createLogger } from '../lib/logger';

const logger = createLogger('pubsub');

/**
 * Message payload for Pub/Sub
 */
export interface PubSubMessage<T = unknown> {
  /** Channel/topic name */
  channel: string;
  /** Message payload */
  data: T;
  /** Optional metadata */
  meta?: {
    /** Source instance ID */
    instanceId?: string;
    /** Timestamp */
    timestamp?: number;
  };
}

/**
 * Handler function for subscribed messages
 */
export type PubSubHandler<T = unknown> = (message: PubSubMessage<T>) => void;

/**
 * Abstract PubSub provider interface
 */
export interface PubSubProvider {
  /** Provider name for logging */
  readonly name: string;
  
  /**
   * Publish a message to a channel
   * @param channel - Channel name (e.g., "chat:123", "workspace:456")
   * @param data - Message payload
   */
  publish<T>(channel: string, data: T): Promise<void>;
  
  /**
   * Subscribe to a channel or pattern
   * @param pattern - Channel name or pattern (e.g., "chat:*" for all chats)
   * @param handler - Callback function for received messages
   * @returns Unsubscribe function
   */
  subscribe<T>(pattern: string, handler: PubSubHandler<T>): () => void;
  
  /**
   * Subscribe to exact channel (no pattern matching)
   * @param channel - Exact channel name
   * @param handler - Callback function
   * @returns Unsubscribe function
   */
  subscribeExact<T>(channel: string, handler: PubSubHandler<T>): () => void;
  
  /**
   * Check if provider is connected and healthy
   */
  isHealthy(): Promise<boolean>;
  
  /**
   * Close connections and cleanup
   */
  close(): Promise<void>;
}

/**
 * Local PubSub implementation using Node.js EventEmitter.
 * 
 * Works only within a single process - suitable for:
 * - Development environment
 * - Single-instance deployments
 * - Testing
 * 
 * For multi-instance deployments, use RedisPubSub.
 */
export class LocalPubSub implements PubSubProvider {
  readonly name = 'local';
  private readonly emitter: EventEmitter;
  private readonly instanceId: string;
  private closed = false;
  
  constructor() {
    this.emitter = new EventEmitter();
    // Allow unlimited listeners (one per chat/channel)
    this.emitter.setMaxListeners(0);
    // Generate unique instance ID for message origin tracking
    this.instanceId = `local-${process.pid}-${Date.now()}`;
    logger.info({ instanceId: this.instanceId }, 'LocalPubSub initialized');
  }
  
  async publish<T>(channel: string, data: T): Promise<void> {
    if (this.closed) {
      logger.warn({ channel }, 'Attempted to publish on closed LocalPubSub');
      return;
    }
    
    const message: PubSubMessage<T> = {
      channel,
      data,
      meta: {
        instanceId: this.instanceId,
        timestamp: Date.now(),
      },
    };
    
    // Emit to exact channel listeners
    this.emitter.emit(channel, message);
    
    // Emit to pattern listeners (those listening to "*" pattern)
    // Extract the prefix (e.g., "chat" from "chat:123")
    const colonIndex = channel.indexOf(':');
    if (colonIndex > 0) {
      const prefix = channel.substring(0, colonIndex);
      this.emitter.emit(`${prefix}:*`, message);
    }
    
    // Emit to global "*" listeners
    this.emitter.emit('*', message);
    
    logger.debug({ channel, instanceId: this.instanceId }, 'Published message');
  }
  
  subscribe<T>(pattern: string, handler: PubSubHandler<T>): () => void {
    if (this.closed) {
      logger.warn({ pattern }, 'Attempted to subscribe on closed LocalPubSub');
      return () => {};
    }
    
    const wrappedHandler = (message: PubSubMessage<T>) => {
      try {
        handler(message);
      } catch (error) {
        logger.error({ error, pattern, channel: message.channel }, 'Error in pubsub handler');
      }
    };
    
    this.emitter.on(pattern, wrappedHandler);
    logger.debug({ pattern }, 'Subscribed to pattern');
    
    return () => {
      this.emitter.off(pattern, wrappedHandler);
      logger.debug({ pattern }, 'Unsubscribed from pattern');
    };
  }
  
  subscribeExact<T>(channel: string, handler: PubSubHandler<T>): () => void {
    return this.subscribe(channel, handler);
  }
  
  async isHealthy(): Promise<boolean> {
    return !this.closed;
  }
  
  async close(): Promise<void> {
    if (this.closed) return;
    
    this.closed = true;
    this.emitter.removeAllListeners();
    logger.info({ instanceId: this.instanceId }, 'LocalPubSub closed');
  }
}

/**
 * Singleton instance for local pubsub (created lazily)
 */
let localPubSubInstance: LocalPubSub | null = null;

export function getLocalPubSub(): LocalPubSub {
  if (!localPubSubInstance) {
    localPubSubInstance = new LocalPubSub();
  }
  return localPubSubInstance;
}

/**
 * Reset local pubsub instance (for testing)
 */
export function resetLocalPubSub(): void {
  if (localPubSubInstance) {
    localPubSubInstance.close();
    localPubSubInstance = null;
  }
}
