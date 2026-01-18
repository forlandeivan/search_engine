/**
 * Realtime event system for multi-instance deployments.
 * 
 * Phase 4.2: WebSocket масштабирование через Pub/Sub
 * 
 * Automatic provider selection:
 * - If REDIS_URL is set → RedisPubSub (for multi-instance deployments)
 * - Otherwise → LocalPubSub (for single instance / development)
 * 
 * Usage:
 * ```typescript
 * import { pubsub } from './realtime';
 * 
 * // Publish event
 * await pubsub.publish('chat:123', { type: 'message', content: 'Hello' });
 * 
 * // Subscribe to events
 * const unsubscribe = pubsub.subscribe('chat:123', (message) => {
 *   console.log('Received:', message.data);
 * });
 * 
 * // Later: unsubscribe
 * unsubscribe();
 * ```
 */

import { createLogger } from '../lib/logger';
import { 
  type PubSubProvider, 
  type PubSubMessage, 
  type PubSubHandler,
  LocalPubSub,
  getLocalPubSub,
} from './pubsub';
import { createRedisPubSub, RedisPubSub } from './redis-pubsub';

const logger = createLogger('realtime');

// Re-export types for convenience
export type { PubSubProvider, PubSubMessage, PubSubHandler };
export { LocalPubSub } from './pubsub';
export { RedisPubSub } from './redis-pubsub';

/**
 * Singleton PubSub instance
 */
let pubsubInstance: PubSubProvider | null = null;

/**
 * Initialize or get the PubSub provider.
 * 
 * Provider selection:
 * 1. If REDIS_URL is set → RedisPubSub
 * 2. Otherwise → LocalPubSub
 * 
 * The provider is created lazily on first access.
 */
export function getPubSub(): PubSubProvider {
  if (pubsubInstance) {
    return pubsubInstance;
  }
  
  // Try to create Redis PubSub if REDIS_URL is available
  const redisUrl = process.env.REDIS_URL;
  
  if (redisUrl) {
    try {
      const redisPubSub = createRedisPubSub(redisUrl);
      if (redisPubSub) {
        pubsubInstance = redisPubSub;
        logger.info({ provider: 'redis' }, 'Using RedisPubSub for realtime events');
        return pubsubInstance;
      }
    } catch (error) {
      logger.error({ error }, 'Failed to create RedisPubSub, falling back to LocalPubSub');
    }
  }
  
  // Fall back to local pubsub
  pubsubInstance = getLocalPubSub();
  logger.info({ provider: 'local' }, 'Using LocalPubSub for realtime events (single instance only)');
  
  return pubsubInstance;
}

/**
 * Get the current PubSub provider without creating one
 */
export function getCurrentPubSub(): PubSubProvider | null {
  return pubsubInstance;
}

/**
 * Check if Redis PubSub is being used
 */
export function isUsingRedis(): boolean {
  return pubsubInstance?.name === 'redis';
}

/**
 * Check if PubSub system is healthy
 */
export async function isPubSubHealthy(): Promise<boolean> {
  const provider = getCurrentPubSub();
  if (!provider) {
    return false;
  }
  return provider.isHealthy();
}

/**
 * Get PubSub provider info for health checks
 */
export async function getPubSubHealth(): Promise<{
  provider: string;
  healthy: boolean;
  stats?: { channels: number; patterns: number };
}> {
  const provider = getCurrentPubSub();
  
  if (!provider) {
    return {
      provider: 'none',
      healthy: false,
    };
  }
  
  const healthy = await provider.isHealthy();
  const result: {
    provider: string;
    healthy: boolean;
    stats?: { channels: number; patterns: number };
  } = {
    provider: provider.name,
    healthy,
  };
  
  // Add Redis-specific stats
  if (provider instanceof RedisPubSub) {
    result.stats = provider.getStats();
  }
  
  return result;
}

/**
 * Shutdown PubSub system gracefully
 */
export async function closePubSub(): Promise<void> {
  if (pubsubInstance) {
    await pubsubInstance.close();
    pubsubInstance = null;
    logger.info('PubSub system closed');
  }
}

/**
 * Reset PubSub instance (for testing)
 */
export function resetPubSub(): void {
  if (pubsubInstance) {
    pubsubInstance.close();
    pubsubInstance = null;
  }
}

/**
 * Convenience export: default pubsub instance (lazily initialized)
 */
export const pubsub = {
  /**
   * Publish a message to a channel
   */
  publish: async <T>(channel: string, data: T): Promise<void> => {
    return getPubSub().publish(channel, data);
  },
  
  /**
   * Subscribe to a channel or pattern
   */
  subscribe: <T>(pattern: string, handler: PubSubHandler<T>): (() => void) => {
    return getPubSub().subscribe(pattern, handler);
  },
  
  /**
   * Subscribe to exact channel (no pattern matching)
   */
  subscribeExact: <T>(channel: string, handler: PubSubHandler<T>): (() => void) => {
    return getPubSub().subscribeExact(channel, handler);
  },
  
  /**
   * Check if pubsub is healthy
   */
  isHealthy: async (): Promise<boolean> => {
    return isPubSubHealthy();
  },
  
  /**
   * Get provider name
   */
  get name(): string {
    return getCurrentPubSub()?.name ?? 'uninitialized';
  },
};

// ============================================================================
// Chat-specific helpers for integration with chat-events.ts
// ============================================================================

/**
 * Channel name for chat events
 */
export function getChatChannel(chatId: string): string {
  return `chat:${chatId}`;
}

/**
 * Channel name for workspace-wide events
 */
export function getWorkspaceChannel(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

/**
 * Publish a chat message event
 */
export async function publishChatMessage(chatId: string, message: unknown): Promise<void> {
  const channel = getChatChannel(chatId);
  return pubsub.publish(channel, {
    type: 'message',
    message,
  });
}

/**
 * Publish a bot action event
 */
export async function publishBotAction(chatId: string, action: unknown): Promise<void> {
  const channel = getChatChannel(chatId);
  return pubsub.publish(channel, {
    type: 'bot_action',
    action,
  });
}

/**
 * Subscribe to chat events (messages and bot actions)
 */
export function subscribeToChatEvents(
  chatId: string,
  handler: (payload: { type: 'message' | 'bot_action'; message?: unknown; action?: unknown }) => void
): () => void {
  const channel = getChatChannel(chatId);
  return pubsub.subscribeExact(channel, (msg) => {
    handler(msg.data as { type: 'message' | 'bot_action'; message?: unknown; action?: unknown });
  });
}

/**
 * Subscribe to all chat events in a workspace
 */
export function subscribeToWorkspaceChats(
  workspaceId: string,
  handler: (chatId: string, payload: { type: 'message' | 'bot_action'; message?: unknown; action?: unknown }) => void
): () => void {
  // Subscribe to pattern like "chat:*" won't work for workspace filtering
  // We'd need workspace-specific channels or message filtering
  // For now, this is a placeholder - actual implementation would need workspace context in messages
  const channel = getWorkspaceChannel(workspaceId);
  return pubsub.subscribe(channel, (msg) => {
    const data = msg.data as { chatId: string; type: 'message' | 'bot_action'; message?: unknown; action?: unknown };
    handler(data.chatId, data);
  });
}
