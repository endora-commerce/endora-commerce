import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  createMinimumProduct,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides, setNameOverride } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';

/**
 * Feature 163, Phase 8 (T058, FR-017 b, D6) — the Postgres listing searches and
 * sorts by the Name a card shows at (channel, language): the channel override
 * where one applies. The name ordering pages by the keyset (effective name, id)
 * without gaps or repeats, across a page boundary an override moved a product
 * over.
 */

const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — listing over effective names [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let channelId = '';
  const products: MinimumProductFixture[] = [];
  /** The order the effective names put the products in. */
  let expected: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
    // Baseline names sort A..E; the override renames C to "Zeta …" (last) and
    // E to "0 Aardvark …" (first) on this channel only. The leading digit sorts
    // first under any collation: "Len Aardvark" would sort after "Len A " in a
    // byte-order (C) collation, where the space precedes every letter, and
    // before it in a linguistic one, which ignores the space.
    for (const letter of ['A', 'B', 'C', 'D', 'E']) {
      products.push(
        await createMinimumProduct(em, {
          sku: `S163-LEN-${letter}-${RUN}`,
          nameEn: `Len ${letter} ${RUN}`,
          namePl: `Len ${letter} ${RUN}`,
          channelIds: [channelId],
        }),
      );
    }
    await setNameOverride(em, products[2]!.id, channelId, null, `Len Zeta ${RUN}`);
    await setNameOverride(em, products[4]!.id, channelId, null, `Len 0 Aardvark ${RUN}`);
    expected = [products[4]!, products[0]!, products[1]!, products[3]!, products[2]!].map((p) => p.id);
  });

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), products.map((p) => p.id));
    await teardownBackendServer(h);
  });

  it('pages sort=name by the effective name with no gaps or repeats', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-LEN-`)}&sort=name&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: CHANNEL,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as {
        data: Array<{ id: string; name: string }>;
        pagination: { cursor: string | null; hasMore: boolean };
      };
      seen.push(...body.data.map((p) => p.id).filter((id) => expected.includes(id)));
      if (!body.pagination.hasMore) break;
      cursor = body.pagination.cursor;
    }
    expect(seen).toEqual(expected);
  });

  it('shows and finds the overridden name', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(`Aardvark ${RUN}`)}&limit=10`,
      headers: CHANNEL,
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: Array<{ id: string; name: string }> }).data;
    expect(data.map((p) => p.id)).toEqual([products[4]!.id]);
    expect(data[0]!.name).toBe(`Len 0 Aardvark ${RUN}`);
  });

  /**
   * Final QA Q-M1 (FR-017 b) — `filter[attr.<key>]` and the filter-option counts read
   * the **effective** attribute value at the request's channel: a channel-scoped
   * attribute overridden on `pl_b2b_vip` is filtered and counted by the override there,
   * and by the baseline on `pl_retail`.
   */
  describe('attribute filters and facet counts over effective values', () => {
    const ADMIN = { b2b_session: 'stub-admin-session' };
    const attributeKey = `s163_len_finish_${RUN}`;
    const filtered: MinimumProductFixture[] = [];

    beforeAll(async () => {
      const em = h.em();
      const vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
      const attr = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/attributes',
        payload: {
          key: attributeKey,
          label: { 'en-US': 'Finish', 'pl-PL': 'Wykończenie' },
          type: 'input',
          isSearchable: false,
          isFilterable: true,
          isVariantAxis: false,
          isVisibleOnProductPage: true,
          scopable: true,
        },
        cookies: ADMIN,
      });
      expect(attr.statusCode, attr.body).toBe(201);
      for (const label of ['F1', 'F2']) {
        filtered.push(
          await createMinimumProduct(em, {
            sku: `S163-LEN-${label}-${RUN}`,
            nameEn: `Len ${label} ${RUN}`,
            namePl: `Len ${label} ${RUN}`,
            channelIds: [channelId, vipId],
          }),
        );
      }
      // The baseline goes straight onto the rows: the create route refuses a value for
      // an attribute outside the product's attribute set, which is not the subject here.
      await em
        .getConnection()
        .execute(`update products set attribute_values = jsonb_build_object(?::text, 'Matte') where id in (?, ?)`, [
          attributeKey,
          filtered[0]!.id,
          filtered[1]!.id,
        ]);
      // Feature 170 (T043) — seeded as stored (the 163 value-overrides PATCH is retired).
      await seedScopedValues(h.em().fork(), filtered[1]!.id, [
        { field: `attribute:${attributeKey}`, scope: { level: 'channel', channelId: vipId }, value: 'Gloss' },
      ]);
    });

    afterAll(async () => {
      if (!h) return;
      await clearValueOverrides(h.em(), filtered.map((p) => p.id));
      // The attribute stays (a product references it), but stops being a filter.
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/catalog/attributes/${attributeKey}`,
        payload: { isFilterable: false },
        cookies: ADMIN,
      });
    });

    const filter = async (channel: string, value: string): Promise<string[]> => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${encodeURIComponent(`S163-LEN-F`)}&limit=50&${encodeURIComponent(`filter[attr.${attributeKey}]`)}=${value}`,
        headers: { 'x-sales-channel': channel },
      });
      expect(res.statusCode, res.body).toBe(200);
      const ids = (res.json() as { data: Array<{ id: string }> }).data.map((p) => p.id);
      return filtered.filter((p) => ids.includes(p.id)).map((p) => p.id);
    };

    const counts = async (channel: string): Promise<Record<string, number>> => {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: { 'x-sales-channel': channel } });
      expect(res.statusCode, res.body).toBe(200);
      const def = (
        res.json() as { data: Array<{ attributeKey: string; options?: Array<{ value: string; count: number }> }> }
      ).data.find((d) => d.attributeKey === attributeKey);
      return Object.fromEntries((def?.options ?? []).map((o) => [o.value, o.count]));
    };

    it('filters by the override on the overriding channel and by the baseline elsewhere', async () => {
      const [f1, f2] = filtered.map((p) => p.id);
      expect(await filter('pl_b2b_vip', 'Gloss')).toEqual([f2]);
      expect(await filter('pl_b2b_vip', 'Matte')).toEqual([f1]);
      expect(await filter('pl_retail', 'Gloss')).toEqual([]);
      expect(await filter('pl_retail', 'Matte')).toEqual([f1, f2]);
    });

    it('counts the filter options over the same effective values', async () => {
      expect(await counts('pl_b2b_vip')).toEqual({ Matte: 1, Gloss: 1 });
      expect(await counts('pl_retail')).toEqual({ Matte: 2 });
    });
  });
});
