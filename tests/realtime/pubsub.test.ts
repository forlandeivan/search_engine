/**
 * Unit tests for PubSub module
 * 
 * Phase 4.2: WebSocket масштабирование через Pub/Sub
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  LocalPubSub, 
  getLocalPubSub, 
  resetLocalPubSub,
  type PubSubMessage,
  type PubSubHandler,
} from '../../server/realtime/pubsub';

describe('LocalPubSub', () => {
  let pubsub: LocalPubSub;

  beforeEach(() => {
    pubsub = new LocalPubSub();
  });

  afterEach(async () => {
    await pubsub.close();
  });

  describe('publish/subscribe', () => {
    it('should deliver message to exact channel subscriber', async () => {
      const handler = vi.fn();
      pubsub.subscribeExact('chat:123', handler);
      
      await pubsub.publish('chat:123', { text: 'Hello' });
      
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'chat:123',
          data: { text: 'Hello' },
          meta: expect.objectContaining({
            instanceId: expect.any(String),
            timestamp: expect.any(Number),
          }),
        })
      );
    });

    it('should not deliver message to different channel subscriber', async () => {
      const handler = vi.fn();
      pubsub.subscribeExact('chat:123', handler);
      
      await pubsub.publish('chat:456', { text: 'Hello' });
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should deliver message to pattern subscriber', async () => {
      const handler = vi.fn();
      pubsub.subscribe('chat:*', handler);
      
      await pubsub.publish('chat:123', { text: 'Hello' });
      await pubsub.publish('chat:456', { text: 'World' });
      
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should deliver message to global pattern subscriber', async () => {
      const handler = vi.fn();
      pubsub.subscribe('*', handler);
      
      await pubsub.publish('chat:123', { text: 'Hello' });
      await pubsub.publish('workspace:456', { type: 'update' });
      
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should deliver to multiple subscribers on same channel', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      pubsub.subscribeExact('chat:123', handler1);
      pubsub.subscribeExact('chat:123', handler2);
      
      await pubsub.publish('chat:123', { text: 'Hello' });
      
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('unsubscribe', () => {
    it('should stop receiving messages after unsubscribe', async () => {
      const handler = vi.fn();
      const unsubscribe = pubsub.subscribeExact('chat:123', handler);
      
      await pubsub.publish('chat:123', { text: 'First' });
      expect(handler).toHaveBeenCalledTimes(1);
      
      unsubscribe();
      
      await pubsub.publish('chat:123', { text: 'Second' });
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('should only unsubscribe the specific handler', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      const unsubscribe1 = pubsub.subscribeExact('chat:123', handler1);
      pubsub.subscribeExact('chat:123', handler2);
      
      unsubscribe1();
      
      await pubsub.publish('chat:123', { text: 'Hello' });
      
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  describe('health check', () => {
    it('should report healthy when not closed', async () => {
      expect(await pubsub.isHealthy()).toBe(true);
    });

    it('should report unhealthy after close', async () => {
      await pubsub.close();
      expect(await pubsub.isHealthy()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should catch and log errors in handlers', async () => {
      const handler = vi.fn().mockImplementation(() => {
        throw new Error('Test error');
      });
      
      pubsub.subscribeExact('chat:123', handler);
      
      // Should not throw
      await pubsub.publish('chat:123', { text: 'Hello' });
      
      expect(handler).toHaveBeenCalled();
    });

    it('should not publish after close', async () => {
      const handler = vi.fn();
      pubsub.subscribeExact('chat:123', handler);
      
      await pubsub.close();
      await pubsub.publish('chat:123', { text: 'Hello' });
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not subscribe after close', async () => {
      await pubsub.close();
      
      const handler = vi.fn();
      const unsubscribe = pubsub.subscribeExact('chat:123', handler);
      
      // Should return a no-op function
      expect(typeof unsubscribe).toBe('function');
      
      // Calling it should not throw
      unsubscribe();
    });
  });
});

describe('getLocalPubSub (singleton)', () => {
  afterEach(() => {
    resetLocalPubSub();
  });

  it('should return the same instance on multiple calls', () => {
    const instance1 = getLocalPubSub();
    const instance2 = getLocalPubSub();
    
    expect(instance1).toBe(instance2);
  });

  it('should create new instance after reset', () => {
    const instance1 = getLocalPubSub();
    resetLocalPubSub();
    const instance2 = getLocalPubSub();
    
    expect(instance1).not.toBe(instance2);
  });
});

describe('Message metadata', () => {
  let pubsub: LocalPubSub;

  beforeEach(() => {
    pubsub = new LocalPubSub();
  });

  afterEach(async () => {
    await pubsub.close();
  });

  it('should include instance ID in messages', async () => {
    const handler = vi.fn();
    pubsub.subscribeExact('test', handler);
    
    await pubsub.publish('test', { data: 1 });
    
    const message = handler.mock.calls[0][0] as PubSubMessage;
    expect(message.meta?.instanceId).toMatch(/^local-\d+-\d+$/);
  });

  it('should include timestamp in messages', async () => {
    const handler = vi.fn();
    pubsub.subscribeExact('test', handler);
    
    const before = Date.now();
    await pubsub.publish('test', { data: 1 });
    const after = Date.now();
    
    const message = handler.mock.calls[0][0] as PubSubMessage;
    expect(message.meta?.timestamp).toBeGreaterThanOrEqual(before);
    expect(message.meta?.timestamp).toBeLessThanOrEqual(after);
  });
});
