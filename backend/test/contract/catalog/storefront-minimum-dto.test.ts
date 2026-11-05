import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CatalogProductReadPort } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { searchHitSummary } from '../../../../packages/modules/search/dist/backend/services/search-query.service.js';
import { Product, ProductPackagingUnit } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 155, Phase 5 (T030) — the storefront product DTOs carry the minimums
 * (`specs/155-catalog-order-constraints/contracts/catalog-api.md` §4).
 *
 * `minOrderQuantity` on the detail, the list, a search hit and a comparison's
 * products; `packagingUnits[].minOrderUnits` on the detail. The value is
 * emitted for `simple` / `configurable` products only — a minimum stored on
 * another type (written before D5, or straight into the table) reads `null`.
 * The returnable flag is on none of them.
 */
describe('155 — storefront DTOs carry the minimums [contract]', () => {
  let h: BackendServerHandle;
  const CHANNEL = { 'x-sales-channel': 'pl_retail' };
  const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const SKU_PREFIX = `SFMOQ-${RUN}`;

  const ids: Record<'simple' | 'configurable' | 'bundle' | 'none', string> = {
    simple: '',
    configurable: '',
    bundle: '',
    none: '',
  };
  const slugs: Record<keyof typeof ids, string> = { simple: '', configurable: '', bundle: '', none: '' };
  let unitId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const retail = await em.findOne(SalesChannel, { code: 'pl_retail' });
    expect(retail, 'the harness seeds pl_retail').not.toBeNull();

    const fixtures: Array<{
      key: keyof typeof ids;
      type: 'simple' | 'configurable' | 'bundle';
      minOrderQuantity: number | null;
    }> = [
      { key: 'simple', type: 'simple', minOrderQuantity: 12 },
      { key: 'configurable', type: 'configurable', minOrderQuantity: 5 },
      // Stored on an ineligible type — only a direct write can put it there now.
      { key: 'bundle', type: 'bundle', minOrderQuantity: 9 },
      { key: 'none', type: 'simple', minOrderQuantity: null },
    ];
    for (const f of fixtures) {
      const sku = `${SKU_PREFIX}-${f.key}`;
      const product = em.create(Product, {
        sku,
        slug: sku.toLowerCase(),
        type: f.type,
        status: 'active',
        name: `Storefront minimum ${sku}`,
        description: '',
        visibility: 'public',
        allowedOrganizationIds: [],
        attributeValues: { defaultPrice: 10 },
        minOrderQuantity: f.minOrderQuantity,
        returnable: true,
      });
      await em.persistAndFlush(product);
      ids[f.key] = product.id;
      slugs[f.key] = product.slug;
      await em
        .getConnection()
        .execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [
          retail!.id,
          product.id,
        ]);
    }

    const unit = em.create(ProductPackagingUnit, {
      productId: ids.simple,
      name: `Paleta ${RUN}`,
      baseQuantity: 48,
      minOrderUnits: 3,
    });
    const plainUnit = em.create(ProductPackagingUnit, {
      productId: ids.simple,
      name: `Karton ${RUN}`,
      baseQuantity: 6,
      position: 1,
    });
    await em.persistAndFlush([unit, plainUnit]);
    unitId = unit.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function detail(slug: string): Promise<Record<string, unknown>> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/catalog/products/${slug}`, headers: CHANNEL });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: Record<string, unknown> }).data;
  }

  describe('GET /api/v1/catalog/products/:slug', () => {
    it('carries minOrderQuantity on an eligible product and packagingUnits[].minOrderUnits', async () => {
      const data = await detail(slugs.simple);
      expect(data['minOrderQuantity']).toBe(12);
      const units = data['packagingUnits'] as Array<{ id: string; minOrderUnits?: number | null }>;
      expect(units.find((u) => u.id === unitId)?.minOrderUnits).toBe(3);
      expect(units.find((u) => u.id !== unitId)?.minOrderUnits).toBeNull();
      expect(data).not.toHaveProperty('returnable');
    });

    it('carries it on a configurable product', async () => {
      expect((await detail(slugs.configurable))['minOrderQuantity']).toBe(5);
    });

    it('reads null on a bundle even when a value is stored', async () => {
      expect((await detail(slugs.bundle))['minOrderQuantity']).toBeNull();
    });

    it('reads null on an eligible product without a minimum', async () => {
      expect((await detail(slugs.none))['minOrderQuantity']).toBeNull();
    });
  });

  describe('GET /api/v1/catalog/products (list)', () => {
    it('carries minOrderQuantity on every summary, null for an ineligible type', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?q=${encodeURIComponent(SKU_PREFIX)}&limit=50`,
        headers: CHANNEL,
      });
      expect(res.statusCode).toBe(200);
      const items = (res.json() as { data: Array<{ id: string; minOrderQuantity?: unknown; returnable?: unknown }> })
        .data;
      const byId = new Map(items.map((i) => [i.id, i]));
      expect(byId.get(ids.simple)?.minOrderQuantity).toBe(12);
      expect(byId.get(ids.configurable)?.minOrderQuantity).toBe(5);
      expect(byId.get(ids.bundle)?.minOrderQuantity).toBeNull();
      expect(byId.get(ids.none)?.minOrderQuantity).toBeNull();
      for (const item of items) expect(item).not.toHaveProperty('returnable');
    });
  });

  describe('search hit projection', () => {
    it('carries minOrderQuantity from the hydrated catalogue record, null for an ineligible type', async () => {
      const read = h.container.resolve<CatalogProductReadPort>('catalogProductReadPort');
      const channel = {
        id: '00000000-0000-4000-8000-0000000000c1',
        code: 'pl_retail',
        defaultCurrency: 'PLN',
        defaultLanguage: 'en-US',
      };
      for (const [key, expected] of [
        ['simple', 12],
        ['configurable', 5],
        ['bundle', null],
        ['none', null],
      ] as const) {
        const record = await read.findById(ids[key]);
        expect(record).not.toBeNull();
        const hit = {
          id: record!.id,
          sku: record!.sku,
          type: record!.type,
          slug: record!.slug,
          name: 'hit',
          categorySlugs: [],
          primaryAssetUrl: null,
        };
        const summary = searchHitSummary(record!, hit as never, channel, undefined, undefined);
        expect(summary.minOrderQuantity, key).toBe(expected);
      }
    });
  });

  describe('comparison', () => {
    it("a comparison's products carry minOrderQuantity, null for an ineligible type", async () => {
      const first = await h.app.inject({
        method: 'POST',
        url: '/api/v1/comparisons/me/products',
        headers: { ...CHANNEL, 'content-type': 'application/json' },
        payload: { productId: ids.simple },
      });
      expect(first.statusCode).toBe(200);
      const cookie = first.cookies.find((c) => c.name === 'compare_token');
      expect(cookie).toBeDefined();
      const second = await h.app.inject({
        method: 'POST',
        url: '/api/v1/comparisons/me/products',
        headers: { ...CHANNEL, 'content-type': 'application/json' },
        cookies: { compare_token: cookie!.value },
        payload: { productId: ids.bundle },
      });
      expect(second.statusCode).toBe(200);
      const products = (
        second.json() as { data: { products: Array<{ id: string; minOrderQuantity?: unknown }> } }
      ).data.products;
      const byId = new Map(products.map((p) => [p.id, p]));
      expect(byId.get(ids.simple)?.minOrderQuantity).toBe(12);
      expect(byId.get(ids.bundle)?.minOrderQuantity).toBeNull();
    });
  });
});
