import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedScopedValues } from '../../helpers/scoped-values.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 — T054 (US3). Four-corner matrix integration test.
 *
 * Seeds a product, writes one channel+language override per corner of
 * (`pl_b2b_vip`, `pl_retail`) × (`pl-PL`, `en-US`) for the system Name
 * attribute, then re-fetches every corner via the admin resolver-aware
 * endpoint (`GET /admin/products/:id?channelId&languageCode`) and
 * asserts every corner returns its dedicated value with no cross-talk.
 *
 * **Adapted from the original spec:** the spec called for `GET /products/:slug`
 * (public read) reads. The storefront-side resolver swap-in is tracked
 * by the deferred T026 / T061 polish; until those land the public read
 * still pickLang's the baseline JSONB and would ignore per-product overrides.
 * The admin endpoint is the canonical resolver consumer today and exercises
 * the same code path (the shared `@endora-commerce/contracts` resolver) — so this test
 * still pins the four-corner guarantee end-to-end. Once T026 / T061 ship,
 * the assertions below can be replicated against the public read.
 */
describe('US3 — four-corner matrix (channel × language) overrides', () => {
  let h: BackendServerHandle;
  let productId: string;
  let retailChannelId: string;
  let vipChannelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `4CORNER-${Date.now()}`,
        type: 'simple',
        name: 'Baseline EN',
        description: 'Description EN',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode).toBe(201);
    productId = (created.json() as { data: { id: string } }).data.id;

    const conn = h.em().getConnection();
    const rows = await conn.execute<Array<{ id: string; code: string }>>(
      `select id, code from sales_channels where code in ('pl_retail', 'pl_b2b_vip')`,
      [],
      'all',
    );
    retailChannelId = rows.find((r) => r.code === 'pl_retail')!.id;
    vipChannelId = rows.find((r) => r.code === 'pl_b2b_vip')!.id;
    // Admin product-create auto-binds to the system-default channel (feature
    // 053: now pl_retail), so the pl_retail row may already exist — upsert.
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?)
       on conflict do nothing`,
      [retailChannelId, productId, vipChannelId, productId],
    );
    await conn.execute(
      `update sales_channels set languages = '["pl-PL","en-US"]'::jsonb where id in (?, ?)`,
      [retailChannelId, vipChannelId],
    );

    // Feature 172 (T043) — the four corners seeded as stored (the 163 value-overrides PATCH is retired).
    await seedScopedValues(h.em().fork(), productId, [
      { field: 'name', scope: { level: 'channel_language', channelId: vipChannelId, languageCode: 'pl-PL' }, value: 'VIP-PL' },
      { field: 'name', scope: { level: 'channel_language', channelId: vipChannelId, languageCode: 'en-US' }, value: 'VIP-EN' },
      { field: 'name', scope: { level: 'channel_language', channelId: retailChannelId, languageCode: 'pl-PL' }, value: 'RETAIL-PL' },
      { field: 'name', scope: { level: 'channel_language', channelId: retailChannelId, languageCode: 'en-US' }, value: 'RETAIL-EN' },
    ]);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('each (channel, language) corner returns its dedicated value with no cross-talk', async () => {
    const corners: Array<{ channelId: string; lang: string; expected: string; source: string }> = [
      { channelId: vipChannelId,    lang: 'pl-PL', expected: 'VIP-PL',    source: 'set' },
      { channelId: vipChannelId,    lang: 'en-US', expected: 'VIP-EN',    source: 'set' },
      { channelId: retailChannelId, lang: 'pl-PL', expected: 'RETAIL-PL', source: 'set' },
      { channelId: retailChannelId, lang: 'en-US', expected: 'RETAIL-EN', source: 'set' },
    ];

    for (const c of corners) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/products/${productId}?channelId=${c.channelId}&languageCode=${c.lang}`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(res.statusCode, `corner (${c.channelId}, ${c.lang})`).toBe(200);
      const body = res.json() as {
        data: { resolved?: { name: unknown; sources: Record<string, string> } };
      };
      expect(body.data.resolved, `resolved block present for (${c.channelId}, ${c.lang})`).toBeDefined();
      expect(body.data.resolved!.name).toBe(c.expected);
      expect(body.data.resolved!.sources['name']).toBe(c.source);
    }
  });

  it('Global / no-channel context falls back to the baseline (no override leakage across the channel boundary)', async () => {
    // languageCode=en-US WITHOUT channelId — no channel-scoped override is
    // applicable; the resolver returns the baseline EN slot.
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}?languageCode=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { resolved?: { name: unknown; sources: Record<string, string> } };
    };
    expect(body.data.resolved!.name).toBe('Baseline EN');
    expect(body.data.resolved!.sources['name']).toBe('set');
  });
});
