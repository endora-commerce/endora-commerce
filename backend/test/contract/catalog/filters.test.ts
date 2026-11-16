import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T046 — `GET /catalog/filters` returns only attributes where `isFilterable=true`.
 * Non-filterable ProductAttributes must never appear in the filter panel (FR-005).
 */

interface FilterDef {
  attributeKey: string;
  label: string;
  valueType: 'string' | 'number' | 'boolean' | 'enum' | 'date';
  options?: { value: string; label: string; count: number }[];
  range?: { min: number; max: number };
}

describe('GET /api/v1/catalog/filters — filterable attributes only', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();

  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns the filterable attribute definitions', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: { 'x-sales-channel': 'pl_retail' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: FilterDef[] };
    expect(Array.isArray(body.data)).toBe(true);
    // Seed data (T093) provisions 10 filterable attributes.
    expect(body.data.length).toBeGreaterThan(0);
    for (const f of body.data) {
      expect(typeof f.attributeKey).toBe('string');
      expect(typeof f.label).toBe('string');
      expect(['string', 'number', 'boolean', 'enum', 'date']).toContain(f.valueType);
    }
  });

  it('excludes an attribute toggled to isFilterable=false', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: { 'x-sales-channel': 'pl_retail' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: FilterDef[] };
    const keys = body.data.map((f) => f.attributeKey);
    // Seed data includes an attribute `internal_sku_notes` that is searchable but not filterable.
    expect(keys).not.toContain('internal_sku_notes');
  });

  /**
   * Issue #1326 — `?q=` counts over the products the text query matches. The
   * Postgres arm is pinned here (the index's arm hands this same service the
   * ids it matched — `test/unit/catalog/public-filters-query.test.ts`).
   */
  describe('narrowed by a text query', () => {
    const HEADERS = { 'x-sales-channel': 'pl_retail' };
    let originalBackend: string | undefined;

    beforeAll(() => {
      originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
      process.env['CATALOG_SEARCH_BACKEND'] = 'postgres';
    });

    afterAll(() => {
      if (originalBackend === undefined) delete process.env['CATALOG_SEARCH_BACKEND'];
      else process.env['CATALOG_SEARCH_BACKEND'] = originalBackend;
    });

    it('offers no facet at all for a query nothing matches', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/filters?q=${encodeURIComponent('łożysko-zzz-no-such-product')}`,
        headers: HEADERS,
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: FilterDef[] }).data).toEqual([]);
    });

    it('counts no option above the number of products the query lists', async () => {
      const all = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/products?limit=1', headers: HEADERS });
      const sku = (all.json() as { data: { sku: string }[] }).data[0]?.sku;
      expect(sku, 'the seed lists no product').toBeDefined();

      const listed = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?limit=200&q=${encodeURIComponent(sku!)}`,
        headers: HEADERS,
      });
      const matched = (listed.json() as { data: unknown[] }).data.length;
      expect(matched).toBeGreaterThan(0);

      const narrowed = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/filters?q=${encodeURIComponent(sku!)}`,
        headers: HEADERS,
      });
      expect(narrowed.statusCode).toBe(200);
      const unfiltered = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/filters', headers: HEADERS });

      const counts = (body: string): Map<string, number> =>
        new Map(
          (JSON.parse(body) as { data: FilterDef[] }).data.flatMap((f) =>
            (f.options ?? []).map((o) => [`${f.attributeKey}=${o.value}`, o.count] as const),
          ),
        );
      const narrowedCounts = counts(narrowed.body);
      const unfilteredCounts = counts(unfiltered.body);
      for (const [option, count] of narrowedCounts) {
        expect(count, option).toBeLessThanOrEqual(matched);
        expect(count, option).toBeLessThanOrEqual(unfilteredCounts.get(option) ?? 0);
      }
      const total = (m: Map<string, number>): number => [...m.values()].reduce((a, b) => a + b, 0);
      expect(total(narrowedCounts), 'the counts were taken over the whole catalogue').toBeLessThan(
        total(unfilteredCounts),
      );
    });
  });
});
