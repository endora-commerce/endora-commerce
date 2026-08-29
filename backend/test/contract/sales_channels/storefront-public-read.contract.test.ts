import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PublicSalesChannelResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * `GET /api/v1/storefront/sales-channel` — feature `005-sales-channels`,
 * prose contract section C.1.
 *
 * The schema for this endpoint shipped on 2026-04-30 and the route did not.
 * Measured on 2026-08-29: the path was named twice in the repository, in
 * `PublicSalesChannelSchema`'s own doc block and in the 005 prose contract, and
 * in no route registration at all — so the storefront had no way of learning
 * anything about the channel the backend had resolved for the request,
 * `themeCode` included.
 *
 * The assertions below are about the two properties the storefront depends on:
 * the body validates against the published schema, and the channel it describes
 * is the one the **resolver** picked rather than one the route re-derived.
 */
describe('storefront public sales-channel read', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    const em = h.em();
    for (const c of await em.find(SalesChannel, { systemDefault: false })) {
      em.remove(c);
    }
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  });

  async function createChannel(code: string, themeCode: string | null): Promise<void> {
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code,
      name: { 'en-US': code },
      active: true,
      systemDefault: false,
      defaultLanguage: 'en-US',
      defaultCurrency: 'PLN',
      languages: ['en-US'],
      currencies: ['PLN'],
      themeCode,
    });
    em.persist(channel);
    await em.flush();
    await h.salesChannels.cache.invalidateAll();
  }

  it('answers the system-default channel when no signal names one', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/sales-channel',
    });
    expect(r.statusCode).toBe(200);
    const parsed = PublicSalesChannelResponseSchema.safeParse(r.json());
    expect(parsed.success).toBe(true);
    expect(parsed.data?.data.code).toBe('default');
  });

  it('drops the admin-only fields', async () => {
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/sales-channel',
    });
    const body = (r.json() as { data: Record<string, unknown> }).data;
    for (const field of ['id', 'active', 'systemDefault', 'version']) {
      expect(Object.keys(body)).not.toContain(field);
    }
  });

  it('carries the resolved channel themeCode, per channel', async () => {
    await createChannel('theme-a-channel', 'industria');
    await createChannel('theme-b-channel', 'nordic');

    const a = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/sales-channel',
      headers: { 'x-sales-channel': 'theme-a-channel' },
    });
    const b = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/sales-channel',
      headers: { 'x-sales-channel': 'theme-b-channel' },
    });

    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((a.json() as { data: { themeCode: string | null } }).data.themeCode).toBe(
      'industria',
    );
    expect((b.json() as { data: { themeCode: string | null } }).data.themeCode).toBe(
      'nordic',
    );
  });

  it('reports null rather than an empty string for a channel with no theme', async () => {
    await createChannel('untheme-channel', null);
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/sales-channel',
      headers: { 'x-sales-channel': 'untheme-channel' },
    });
    expect((r.json() as { data: { themeCode: string | null } }).data.themeCode).toBeNull();
  });

  it('refuses an unknown channel instead of falling back to the default', async () => {
    // The resolver's own rule (FR-014): a *named* channel that does not exist
    // is a refusal, not a fallback. Asserted here because the storefront reads
    // this route on the critical path of every page and answers `null` to
    // anything that is not a 200 — so a route that silently answered the
    // default for a mistyped host mapping would present one channel's brand
    // under another channel's hostname with nothing reporting it.
    const r = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/sales-channel',
      headers: { 'x-sales-channel': 'no-such-channel' },
    });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
  });
});
