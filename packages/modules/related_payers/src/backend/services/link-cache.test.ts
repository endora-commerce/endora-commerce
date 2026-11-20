import { describe, expect, it } from 'vitest';
import { RELATED_PAYERS_LINKS_CHANGED_CHANNEL, RelatedPayerLinkCache, RELATED_PAYERS_LINK_CACHE_TTL_MS } from './link-cache.js';

/**
 * Research R-9 — the per-process cache of a buyer's links, dropped on every link
 * Command's commit (and fanned out over Redis), on an organization status change, and
 * by a TTL when pub/sub is unhealthy.
 */
const X = '00000000-0000-4000-8000-0000000000b1';
const Z = '00000000-0000-4000-8000-0000000000b3';

function loaderCounting() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    load: async () => {
      calls += 1;
      return [{ linkId: `l${calls}` }];
    },
  };
}

describe('RelatedPayerLinkCache', () => {
  it('serves a hit without reloading, per buyer', async () => {
    const cache = new RelatedPayerLinkCache<{ linkId: string }>();
    const l = loaderCounting();
    await cache.get(X, l.load);
    expect(await cache.get(X, l.load)).toEqual([{ linkId: 'l1' }]);
    expect(l.calls).toBe(1);
  });

  it('drops the buyer locally and publishes the drop on commit', async () => {
    const published: Array<[string, string]> = [];
    const publisher = { publish: async (channel: string, message: string) => void published.push([channel, message]) };
    const cache = new RelatedPayerLinkCache<{ linkId: string }>(publisher as never);
    const l = loaderCounting();
    await cache.get(X, l.load);
    await cache.publishDrop(X);
    await cache.get(X, l.load);
    expect(l.calls).toBe(2);
    expect(published).toEqual([[RELATED_PAYERS_LINKS_CHANGED_CHANNEL, JSON.stringify({ buyerOrganizationId: X })]]);
  });

  it('a drop announced by another process empties that buyer only', async () => {
    const cache = new RelatedPayerLinkCache<{ linkId: string }>();
    const x = loaderCounting();
    const z = loaderCounting();
    await cache.get(X, x.load);
    await cache.get(Z, z.load);
    cache.handleMessage(JSON.stringify({ buyerOrganizationId: X }));
    await cache.get(X, x.load);
    await cache.get(Z, z.load);
    expect([x.calls, z.calls]).toEqual([2, 1]);
  });

  it('an organization status change drops everything — it may be a payer in any entry', async () => {
    const cache = new RelatedPayerLinkCache<{ linkId: string }>();
    const x = loaderCounting();
    await cache.get(X, x.load);
    cache.onOrganizationStatusChanged();
    await cache.get(X, x.load);
    expect(x.calls).toBe(2);
  });

  it('expires after the TTL — the degraded bound when pub/sub is down', async () => {
    let now = 0;
    const cache = new RelatedPayerLinkCache<{ linkId: string }>(undefined, () => now);
    const x = loaderCounting();
    await cache.get(X, x.load);
    now = RELATED_PAYERS_LINK_CACHE_TTL_MS - 1;
    await cache.get(X, x.load);
    expect(x.calls).toBe(1);
    now = RELATED_PAYERS_LINK_CACHE_TTL_MS;
    await cache.get(X, x.load);
    expect(x.calls).toBe(2);
  });

  it('a load racing a drop is answered but not stored', async () => {
    const cache = new RelatedPayerLinkCache<{ linkId: string }>();
    let calls = 0;
    await cache.get(X, async () => {
      calls += 1;
      cache.drop(X);
      return [{ linkId: 'stale' }];
    });
    await cache.get(X, async () => {
      calls += 1;
      return [{ linkId: 'fresh' }];
    });
    expect(calls).toBe(2);
  });

  it('a malformed message drops everything rather than nothing', async () => {
    const cache = new RelatedPayerLinkCache<{ linkId: string }>();
    const x = loaderCounting();
    await cache.get(X, x.load);
    cache.handleMessage('not json');
    await cache.get(X, x.load);
    expect(x.calls).toBe(2);
  });
});

describe('RelatedPayerLinkCache — the subscription is armed on first read, once', () => {
  it('subscribes the shared connection lazily', async () => {
    const subscribed: string[] = [];
    const connection = {
      status: 'ready',
      subscribe: async (channel: string) => void subscribed.push(channel),
      on: () => connection,
    };
    const cache = new RelatedPayerLinkCache<{ linkId: string }>(undefined, () => 0, () => connection as never);
    expect(subscribed).toEqual([]);
    await cache.get(X, async () => []);
    await cache.get(Z, async () => []);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(subscribed).toEqual([RELATED_PAYERS_LINKS_CHANGED_CHANNEL]);
  });
});
