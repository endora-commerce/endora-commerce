import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  PRICING_GENERATION_CHANNEL,
  PricingGeneration,
  type PricingGenerationSubscriber,
} from './pricing-generation.js';

/**
 * D-287 P0 — the pricing cache is per process, and a price write used to clear
 * only the writer's. Every other API and worker replica went on serving the old
 * price for up to the 60 s TTL (`specs/pricing/read-paths-and-performance.md`
 * §2.4). A bump now clears this process's LRU and is announced on one Redis
 * channel, which every process subscribes to and answers by clearing its own.
 */

class FakeBus {
  readonly listeners: Array<(channel: string, message: string) => void> = [];
  readonly published: Array<{ channel: string; message: string }> = [];
  async publish(channel: string, message: string): Promise<number> {
    this.published.push({ channel, message });
    for (const listener of this.listeners) listener(channel, message);
    return this.listeners.length;
  }
  subscriber(): PricingGenerationSubscriber & { subscribed: string[] } {
    const subscribed: string[] = [];
    return {
      subscribed,
      subscribe: async (channel: string) => {
        subscribed.push(channel);
        return 1;
      },
      on: (_event: 'message', listener: (channel: string, message: string) => void) => {
        this.listeners.push(listener);
      },
      status: 'ready',
      once: () => undefined,
      removeListener: () => undefined,
    };
  }
}

describe('PricingGeneration — cross-replica pricing cache invalidation', () => {
  it('clears this process and every other subscribed process on a bump', async () => {
    const bus = new FakeBus();
    const writerCache = { invalidateAll: vi.fn() };
    const replicaCache = { invalidateAll: vi.fn() };
    const writer = new PricingGeneration(writerCache, bus);
    const replica = new PricingGeneration(replicaCache, bus);
    await writer.start(bus.subscriber());
    const replicaSubscriber = bus.subscriber();
    await replica.start(replicaSubscriber);

    await writer.bump();

    expect(replicaSubscriber.subscribed).toEqual([PRICING_GENERATION_CHANNEL]);
    expect(bus.published.map((p) => p.channel)).toEqual([PRICING_GENERATION_CHANNEL]);
    expect(replicaCache.invalidateAll).toHaveBeenCalledTimes(1);
    // The writer clears itself once, locally — its own announcement coming
    // back over the channel is not a second clear.
    expect(writerCache.invalidateAll).toHaveBeenCalledTimes(1);
  });

  it('ignores messages on other channels', async () => {
    const bus = new FakeBus();
    const cache = { invalidateAll: vi.fn() };
    const generation = new PricingGeneration(cache, bus);
    await generation.start(bus.subscriber());
    await bus.publish('b2b:custom_fields:definitions-changed', '{}');
    expect(cache.invalidateAll).not.toHaveBeenCalled();
  });

  it('treats an unreadable message as a bump rather than dropping it', () => {
    const cache = { invalidateAll: vi.fn() };
    const generation = new PricingGeneration(cache);
    generation.handleMessage('not json');
    expect(cache.invalidateAll).toHaveBeenCalledTimes(1);
  });

  it('still clears locally when publishing fails, and does not throw', async () => {
    const cache = { invalidateAll: vi.fn() };
    const generation = new PricingGeneration(cache, {
      publish: async () => {
        throw new Error('redis down');
      },
    });
    await expect(generation.bump()).resolves.toBeUndefined();
    expect(cache.invalidateAll).toHaveBeenCalledTimes(1);
  });

  it('arms the subscriber once', async () => {
    const bus = new FakeBus();
    const generation = new PricingGeneration({ invalidateAll: vi.fn() }, bus);
    const subscriber = bus.subscriber();
    await generation.start(subscriber);
    await generation.start(subscriber);
    expect(subscriber.subscribed).toEqual([PRICING_GENERATION_CHANNEL]);
  });

  it('subscribes only once the subscriber connection is ready (issue #1096)', async () => {
    // ioredis caught between TCP connect and its ready check: a SUBSCRIBE sent
    // now can put the socket into subscriber mode before the check's INFO.
    const subscriber = Object.assign(new EventEmitter(), {
      status: 'connect',
      subscribed: [] as string[],
      async subscribe(channel: string) {
        subscriber.subscribed.push(channel);
        return 1;
      },
    });
    const generation = new PricingGeneration({ invalidateAll: vi.fn() });
    const starting = generation.start(subscriber);
    await new Promise((resolve) => setImmediate(resolve));
    expect(subscriber.subscribed).toEqual([]);

    subscriber.status = 'ready';
    subscriber.emit('ready');
    await starting;
    expect(subscriber.subscribed).toEqual([PRICING_GENERATION_CHANNEL]);
  });
});
