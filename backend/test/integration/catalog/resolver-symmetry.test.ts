import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveAttribute, type OverrideRow, type ResolverContext } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 022 — T055 (US3). Resolver cross-engine symmetry.
 *
 * The backend admin endpoint and the admin SPA's effective-preview
 * panel both import `resolveAttribute` from `@b2b/contracts`. The
 * structural guarantee (single TS module, two consumers) is enforced
 * at build time; this integration test pins the runtime guarantee:
 * for every contract-matrix scenario, the value returned by
 * `GET /admin/products/:id?channelId&languageCode` (path A) is byte-for-byte
 * equal to the value the pure resolver produces (path B) when fed the
 * same `(baseline, overrides, scope, ctx)`. Any drift between the two
 * paths fails the test, which is the SC-004 invariant.
 *
 * **Adapted from the original spec:** the spec compares the admin path to
 * `GET /products/:slug` (public read). The storefront-side resolver swap-in
 * is tracked by the deferred T026/T061 polish; until those land the public
 * read still pickLang's the baseline JSONB. The pure resolver in
 * `@b2b/contracts` is the canonical source of truth for both consumers, so
 * pinning admin === pure-resolver covers the symmetry invariant the spec
 * cares about (admin SPA imports the same module). Re-target to the public
 * route once T060 / T061 / T026 ship.
 */
describe('US3 — resolver symmetry (admin endpoint ↔ @b2b/contracts pure resolver)', () => {
  let h: BackendServerHandle;
  let productId: string;
  let retailChannelId: string;
  let vipChannelId: string;
  const primaryLanguage = 'en-US';

  beforeAll(async () => {
    h = await setupBackendServer();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `SYM-${Date.now()}`,
        type: 'simple',
        name: { 'pl-PL': 'Baseline PL', 'en-US': 'Baseline EN' },
        description: { 'pl-PL': 'Opis PL', 'en-US': 'Description EN' },
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
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id) values (?,?), (?,?)`,
      [retailChannelId, productId, vipChannelId, productId],
    );
    await conn.execute(
      `update sales_channels set languages = '["pl-PL","en-US"]'::jsonb where id in (?, ?)`,
      [retailChannelId, vipChannelId],
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // Each scenario covers a row in `contracts/resolver.contract.md` §5 that's
  // expressible against the system `name` attribute (channel + language
  // scoped, baseline = `products.name`).
  const baseline = { 'pl-PL': 'Baseline PL', 'en-US': 'Baseline EN' };

  const scenarios: Array<{
    title: string;
    matrixRow: number;
    overrides: Array<{ channel: 'vip' | 'retail'; lang: string | null; v: string }>;
    ctx: { channel: 'vip' | 'retail' | null; lang: string | null };
    expectedValue: string;
    expectedSource: string;
  }> = [
    {
      title: 'row 6 — (channel+language) hit overrides everything',
      matrixRow: 6,
      overrides: [{ channel: 'vip', lang: 'en-US', v: 'CL-en' }],
      ctx: { channel: 'vip', lang: 'en-US' },
      expectedValue: 'CL-en',
      expectedSource: 'channel+language',
    },
    // Row 7 (channel-only override on a channel+language scoped attribute)
    // cannot be written through the admin PATCH because the validator
    // rejects `languageCode=null` against a language-scoped attribute
    // (data-model §3.3 — `attribute_missing_language`). The row is
    // covered by the unit test in `packages/contracts/.../*.test.ts`
    // and exercised here via a direct SQL insert further below.
    {
      title: 'row 8 — no overrides; falls back to global+language',
      matrixRow: 8,
      overrides: [],
      ctx: { channel: 'vip', lang: 'en-US' },
      expectedValue: 'Baseline EN',
      expectedSource: 'global+language',
    },
    {
      title: 'row 9 — requested language missing on baseline; primary fallback (source=global)',
      matrixRow: 9,
      overrides: [],
      ctx: { channel: 'vip', lang: 'de-DE' },
      expectedValue: 'Baseline EN', // primary admin language is en-US (test setup)
      expectedSource: 'global',
    },
    {
      // Adapted from row 10: ctx `(null, 'en-US')` — channel-less but with
      // a specific language. The same orphan-tolerance property applies
      // (channel-scoped overrides MUST be ignored without a channel ctx).
      // Asserts source='global+language' since the baseline EN slot is the
      // matched fallback.
      title: 'row 10 (adapted) — null channel ctx ignores channel-scoped overrides',
      matrixRow: 10,
      overrides: [{ channel: 'vip', lang: 'en-US', v: 'CL-en (ignored)' }],
      ctx: { channel: null, lang: 'en-US' },
      expectedValue: 'Baseline EN',
      expectedSource: 'global+language',
    },
  ];

  it('row 7 (direct SQL insert) — channel-only override (lang=null) wins over baseline (orphan-tolerance)', async () => {
    // Wipe previous state.
    await h.em().getConnection().execute(
      `delete from product_value_overrides where product_id = ?`,
      [productId],
    );
    // Insert directly — the admin PATCH validator rejects channel-only
    // overrides for system Name (language-scoped). This row therefore
    // simulates an orphan written when the attribute's scope flags were
    // different, exactly as the resolver matrix anticipates.
    await h.em().getConnection().execute(
      `insert into product_value_overrides
       (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, 'name', ?, NULL, ?::jsonb, now(), now())`,
      [productId, vipChannelId, JSON.stringify({ v: 'C-only' })],
    );

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}?channelId=${vipChannelId}&languageCode=en-US`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { resolved?: { name: unknown; sources: Record<string, string> } };
    };
    expect(body.data.resolved!.name).toBe('C-only');
    expect(body.data.resolved!.sources['name']).toBe('channel');

    // Symmetry — pure resolver yields the same.
    const pure = resolveAttribute({
      attributeKey: 'name',
      baseline,
      overrides: [
        { attributeKey: 'name', channelId: vipChannelId, languageCode: null, value: { v: 'C-only' } },
      ],
      scope: { channelScoped: true, languageScoped: true },
      ctx: { channelId: vipChannelId, languageCode: 'en-US', primaryLanguage },
    });
    expect(pure.value).toBe(body.data.resolved!.name);
    expect(pure.source).toBe(body.data.resolved!.sources['name']);
  });

  for (const sc of scenarios) {
    it(`${sc.title} (admin path === @b2b/contracts pure resolver)`, async () => {
      // Reset every override on the product before each scenario.
      await h.em().getConnection().execute(
        `delete from product_value_overrides where product_id = ?`,
        [productId],
      );

      // Seed scenario-specific overrides via the admin PATCH endpoint so
      // we exercise the same write path the admin SPA uses.
      if (sc.overrides.length > 0) {
        const patch = await h.app.inject({
          method: 'PATCH',
          url: `/api/v1/admin/catalog/products/${productId}/value-overrides`,
          payload: {
            upserts: sc.overrides.map((o) => ({
              attributeKey: 'name',
              channelId: o.channel === 'vip' ? vipChannelId : retailChannelId,
              languageCode: o.lang,
              value: { v: o.v },
            })),
            deletes: [],
          },
          cookies: { b2b_session: 'stub-admin-session' },
        });
        // Row 10's override carries a language so it satisfies the
        // attribute_missing_language check for system Name (T,T).
        expect(patch.statusCode, `PATCH ${sc.title}`).toBe(200);
      }

      // Path A — admin endpoint.
      const ctxChannelId =
        sc.ctx.channel === 'vip'
          ? vipChannelId
          : sc.ctx.channel === 'retail'
          ? retailChannelId
          : null;
      const qs = new URLSearchParams();
      if (ctxChannelId !== null) qs.set('channelId', ctxChannelId);
      if (sc.ctx.lang !== null) qs.set('languageCode', sc.ctx.lang);
      const adminRes = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/catalog/products/${productId}?${qs.toString()}`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
      expect(adminRes.statusCode).toBe(200);
      const adminBody = adminRes.json() as {
        data: { resolved?: { name: unknown; sources: Record<string, string> } };
      };
      const adminName = adminBody.data.resolved!.name;
      const adminSource = adminBody.data.resolved!.sources['name'];

      // Path B — pure resolver from `@b2b/contracts`.
      const overrides: OverrideRow[] = sc.overrides.map((o) => ({
        attributeKey: 'name',
        channelId: o.channel === 'vip' ? vipChannelId : retailChannelId,
        languageCode: o.lang,
        value: { v: o.v },
      }));
      const ctx: ResolverContext = {
        channelId: ctxChannelId,
        languageCode: sc.ctx.lang,
        primaryLanguage,
      };
      const pure = resolveAttribute({
        attributeKey: 'name',
        baseline,
        overrides,
        scope: { channelScoped: true, languageScoped: true },
        ctx,
      });

      // Sanity — both paths agree with the scenario's expected value.
      expect(adminName, `admin matrix row ${sc.matrixRow}`).toBe(sc.expectedValue);
      expect(adminSource).toBe(sc.expectedSource);
      // Symmetry — admin path equals pure-resolver path byte-for-byte.
      expect(pure.value).toBe(adminName);
      expect(pure.source).toBe(adminSource);
    });
  }
});
