/**
 * Unit tests for chat-events module with PubSub integration
 * 
 * Phase 4.2: WebSocket масштабирование через Pub/Sub
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  chatEvents,
  emitChatMessage,
  emitBotAction,
  onChatEvent,
  offChatEvent,
  getChatSubscriptionStats,
  cleanupChatSubscriptions,
  type ChatEventPayload,
} from '../../server/chat-events';
import { resetPubSub } from '../../server/realtime';

describe('Chat Events', () => {
  beforeEach(() => {
    cleanupChatSubscriptions();
    resetPubSub();
  });

  afterEach(() => {
    cleanupChatSubscriptions();
    resetPubSub();
  });

  describe('emitChatMessage', () => {
    it('should emit message to local listeners', () => {
      const handler = vi.fn();
      onChatEvent('chat-123', handler);
      
      emitChatMessage('chat-123', { text: 'Hello' });
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        type: 'message',
        message: { text: 'Hello' },
      });
    });

    it('should not emit to listeners of different chats', () => {
      const handler = vi.fn();
      onChatEvent('chat-456', handler);
      
      emitChatMessage('chat-123', { text: 'Hello' });
      
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('emitBotAction', () => {
    it('should emit bot action to local listeners', () => {
      const handler = vi.fn();
      onChatEvent('chat-123', handler);
      
      emitBotAction('chat-123', { actionType: 'thinking' });
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        type: 'bot_action',
        action: { actionType: 'thinking' },
      });
    });
  });

  describe('subscription management', () => {
    it('should track multiple listeners on same chat', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      onChatEvent('chat-123', handler1);
      onChatEvent('chat-123', handler2);
      
      emitChatMessage('chat-123', { text: 'Hello' });
      
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should remove specific listener on offChatEvent', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      onChatEvent('chat-123', handler1);
      onChatEvent('chat-123', handler2);
      
      offChatEvent('chat-123', handler1);
      
      emitChatMessage('chat-123', { text: 'Hello' });
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('getChatSubscriptionStats', () => {
    it('should return stats about active subscriptions', () => {
      const handler = vi.fn();
      onChatEvent('chat-123', handler);
      onChatEvent('chat-456', handler);
      
      const stats = getChatSubscriptionStats();
      
      expect(stats.localChats).toBe(2);
      expect(stats.pubsubProvider).toBe('local');
    });

    it('should return zero when no subscriptions', () => {
      const stats = getChatSubscriptionStats();
      
      expect(stats.localChats).toBe(0);
    });
  });

  describe('cleanupChatSubscriptions', () => {
    it('should remove all subscriptions', () => {
      const handler = vi.fn();
      onChatEvent('chat-123', handler);
      onChatEvent('chat-456', handler);
      
      cleanupChatSubscriptions();
      
      emitChatMessage('chat-123', { text: 'Hello' });
      emitChatMessage('chat-456', { text: 'World' });
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should reset stats to zero', () => {
      const handler = vi.fn();
      onChatEvent('chat-123', handler);
      
      cleanupChatSubscriptions();
      
      const stats = getChatSubscriptionStats();
      expect(stats.localChats).toBe(0);
      expect(stats.remoteSubscriptions).toBe(0);
    });
  });

  describe('mixed message types', () => {
    it('should correctly identify message types', () => {
      const payloads: ChatEventPayload[] = [];
      const handler = (payload: ChatEventPayload) => payloads.push(payload);
      
      onChatEvent('chat-123', handler);
      
      emitChatMessage('chat-123', { text: 'Hello' });
      emitBotAction('chat-123', { actionType: 'thinking' });
      emitChatMessage('chat-123', { text: 'World' });
      
      expect(payloads).toHaveLength(3);
      expect(payloads[0].type).toBe('message');
      expect(payloads[1].type).toBe('bot_action');
      expect(payloads[2].type).toBe('message');
    });
  });
});
