import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Feature 053 — FR-008: channel activation/deactivation invalidates the resolver
 * cache through the existing lifecycle pub/sub, so a deactivated channel goes
 * offline on every surface within the cache TTL.
 *
 * Because all storefront modules now read the single resolved channel from the
 * resolver's LRU+Redis cache, one invalidation covers every surface — there is
 * no per-module cache to drop separately. This test drives the invariant end to
 * end: warm the cache by serving the channel, deactivate it (which emits
 * `sales_channels.lifecycle_changed` → the cache invalidator drops the entry),
 * then observe the next request re-resolve from Postgres and refuse it.
 */
describe('sales-channel cache coherence on deactivation (feature 053 / FR-008)', () => {
  let h: BackendServerHandle;
  const CODE = 'coherence-053';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const ch = em.create(SalesChannel, {
      code: CODE,
      name: { en: 'Coherence 053' },
      defaultLanguage: 'en-US',
      defaultCurrency: 'PLN',
      languages: ['en-US'],
      currencies: ['PLN'],
      isPublic: true,
      active: true,
      systemDefault: false,
      version: 1,
    });
    await em.persistAndFlush(ch);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function request(): Promise<{ status: number; echo: string; body: unknown }> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?limit=1',
      headers: { 'x-sales-channel': CODE },
    });
    const echo = res.headers['x-sales-channel'];
    return {
      status: res.statusCode,
      echo: String(Array.isArray(echo) ? (echo[0] ?? '') : (echo ?? '')),
      body: res.json(),
    };
  }

  it('serves an active channel, then refuses it after deactivation invalidates the cache', async () => {
    // Warm the resolver cache — the channel resolves and is served.
    const before = await request();
    expect(before.status).toBe(200);
    expect(before.echo).toBe(CODE);

    // Deactivate → emits sales_channels.lifecycle_changed → invalidator drops the
    // cached entry across LRU + Redis.
    await h.salesChannels.salesChannelsService.deactivate(CODE);
    // EventBus.emit dispatches fire-and-forget outside a run() scope; flush the
    // microtask so the invalidation has completed before the next request.
    await new Promise((resolve) => setImmediate(resolve));

    // Next request re-resolves from Postgres and refuses the now-inactive channel
    // with the uniform envelope — no stale cached "active" served.
    const after = await request();
    expect(after.status).toBe(400);
    expect((after.body as { error?: { code?: string } }).error?.code).toBe(
      'INACTIVE_SALES_CHANNEL',
    );
  });
});
