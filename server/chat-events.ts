/**
 * Chat events system with Pub/Sub support for multi-instance deployments.
 * 
 * Phase 4.2: WebSocket масштабирование через Pub/Sub
 * 
 * Architecture:
 * - Local listeners are still supported via EventEmitter for backward compatibility
 * - When Redis is configured (REDIS_URL), events are also published to Redis
 * - Remote events from Redis are forwarded to local listeners
 * 
 * This allows:
 * - Single instance: works exactly as before (local EventEmitter)
 * - Multi-instance: events are shared across all instances via Redis
 */

import EventEmitter from "events";
import { pubsub, getChatChannel, type PubSubMessage } from "./realtime";
import { createLogger } from "./lib/logger";

const logger = createLogger('chat-events');

export type ChatEventPayload = {
  type: "message" | "bot_action";
  // При передачах наружу сериализуем сами, поэтому допускаем любые поля.
  message?: unknown;
  action?: unknown;
};

/**
 * Internal event emitter for local delivery.
 * This is used to deliver events to local SSE connections.
 */
class ChatEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
}

export const chatEvents = new ChatEvents();

/**
 * Track which chats have remote subscriptions to avoid duplicate subscriptions
 */
const remoteSubscriptions = new Map<string, () => void>();

/**
 * Emit a chat message event.
 * 
 * This publishes to:
 * 1. Local EventEmitter (for SSE connections on this instance)
 * 2. PubSub (Redis if configured, for other instances)
 * 
 * @param chatId - Chat session ID
 * @param message - Message payload
 */
export function emitChatMessage(chatId: string, message: unknown): void {
  const payload: ChatEventPayload = { type: "message", message };
  
  // Emit locally for this instance's SSE connections
  chatEvents.emit(chatId, payload);
  
  // Publish to PubSub for other instances (async, don't wait)
  pubsub.publish(getChatChannel(chatId), payload).catch((error) => {
    logger.error({ error, chatId }, 'Failed to publish chat message to PubSub');
  });
}

/**
 * Emit a bot action event.
 * 
 * @param chatId - Chat session ID
 * @param action - Bot action payload
 */
export function emitBotAction(chatId: string, action: unknown): void {
  const payload: ChatEventPayload = { type: "bot_action", action };
  
  // Emit locally
  chatEvents.emit(chatId, payload);
  
  // Publish to PubSub
  pubsub.publish(getChatChannel(chatId), payload).catch((error) => {
    logger.error({ error, chatId }, 'Failed to publish bot action to PubSub');
  });
}

/**
 * Subscribe to chat events.
 * 
 * For multi-instance support:
 * - Subscribes to local EventEmitter
 * - Also subscribes to PubSub for remote events
 * 
 * @param chatId - Chat session ID
 * @param listener - Callback for events
 */
export function onChatEvent(chatId: string, listener: (payload: ChatEventPayload) => void): void {
  // Subscribe to local events
  chatEvents.on(chatId, listener);
  
  // Subscribe to remote events via PubSub (if not already subscribed)
  if (!remoteSubscriptions.has(chatId)) {
    const channel = getChatChannel(chatId);
    
    const unsubscribe = pubsub.subscribeExact<ChatEventPayload>(channel, (msg: PubSubMessage<ChatEventPayload>) => {
      // Forward remote events to local listeners
      // Note: This may cause duplicate delivery if the event originated from this instance.
      // To avoid this, we check the instanceId in the message metadata.
      const isFromThisInstance = msg.meta?.instanceId?.startsWith(`local-${process.pid}`);
      
      if (!isFromThisInstance) {
        // Only forward events from other instances
        chatEvents.emit(chatId, msg.data);
        logger.debug({ chatId, from: msg.meta?.instanceId }, 'Forwarded remote chat event');
      }
    });
    
    remoteSubscriptions.set(chatId, unsubscribe);
    logger.debug({ chatId }, 'Subscribed to remote chat events');
  }
}

/**
 * Unsubscribe from chat events.
 * 
 * @param chatId - Chat session ID
 * @param listener - The listener to remove
 */
export function offChatEvent(chatId: string, listener: (payload: ChatEventPayload) => void): void {
  chatEvents.off(chatId, listener);
  
  // Check if there are any remaining listeners for this chat
  const remainingListeners = chatEvents.listenerCount(chatId);
  
  if (remainingListeners === 0) {
    // Unsubscribe from remote events
    const unsubscribe = remoteSubscriptions.get(chatId);
    if (unsubscribe) {
      unsubscribe();
      remoteSubscriptions.delete(chatId);
      logger.debug({ chatId }, 'Unsubscribed from remote chat events');
    }
  }
}

/**
 * Get the number of active chat subscriptions.
 * Useful for monitoring and debugging.
 */
export function getChatSubscriptionStats(): { 
  localChats: number; 
  remoteSubscriptions: number;
  pubsubProvider: string;
} {
  // Count unique chats with local listeners
  const localChats = chatEvents.eventNames().length;
  
  return {
    localChats,
    remoteSubscriptions: remoteSubscriptions.size,
    pubsubProvider: pubsub.name,
  };
}

/**
 * Cleanup all subscriptions (for graceful shutdown)
 */
export function cleanupChatSubscriptions(): void {
  // Remove all local listeners
  chatEvents.removeAllListeners();
  
  // Unsubscribe from all remote subscriptions
  for (const [chatId, unsubscribe] of remoteSubscriptions) {
    unsubscribe();
    logger.debug({ chatId }, 'Cleaned up remote subscription');
  }
  remoteSubscriptions.clear();
  
  logger.info('All chat subscriptions cleaned up');
}
