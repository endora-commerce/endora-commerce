/**
 * Issue #1096 — every platform subscriber waits out ioredis's handshake before
 * `SUBSCRIBE`. `subscribe-when-ready.test.ts` reproduces the race on a real
 * socket; this file holds the callers to it, so a subscriber that goes back to
 * a bare `subscribe` is red here rather than in a CI log.
 */
import { EventEmitter } from 'node:events';

import type { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { ModuleRegistryCache, STATE_CHANGED_CHANNEL } from '../lifecycle/registry-cache.js';
import {
  SALES_CHANNEL_ACCESS_CHANGED_CHANNEL,
  SalesChannelAccessCache,
} from '../sales-channels/sales-channel-access-cache.js';

/** An ioredis stand-in caught between TCP connect and the ready check. */
class HandshakingSubscriber extends EventEmitter {
  status = 'connect';
  readonly subscribed: string[] = [];
  async subscribe(...channels: string[]): Promise<number> {
    this.subscribed.push(...channels);
    return channels.length;
  }
  finishHandshake(): void {
    this.status = 'ready';
    this.emit('ready');
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('platform subscribers subscribe only after ready (issue #1096)', () => {
  it('ModuleRegistryCache.watch', async () => {
    const subscriber = new HandshakingSubscriber();
    const cache = new ModuleRegistryCache();
    const watching = cache.watch({
      redisSubscriber: subscriber as unknown as Redis,
      em: () => ({ find: async () => [] }) as unknown as EntityManager,
    });
    await settle();
    expect(subscriber.subscribed).toEqual([]);

    subscriber.finishHandshake();
    await watching;
    expect(subscriber.subscribed).toEqual([STATE_CHANGED_CHANNEL]);
  });

  it('SalesChannelAccessCache.watch', async () => {
    const subscriber = new HandshakingSubscriber();
    const cache = new SalesChannelAccessCache({} as Redis, async () => []);
    const watching = cache.watch(subscriber as unknown as Redis);
    await settle();
    expect(subscriber.subscribed).toEqual([]);

    subscriber.finishHandshake();
    await watching;
    expect(subscriber.subscribed).toEqual([SALES_CHANNEL_ACCESS_CHANGED_CHANNEL]);
  });
});
