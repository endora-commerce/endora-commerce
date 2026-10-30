import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T043 — `GET /catalog/products` with a filter over a non-filterable attribute
 * must return `400 FILTER_NOT_ALLOWED` (catalog.contract.md, FR-005).
 *
 * This is the storefront read surface; no auth is required.
 */

describe('GET /api/v1/catalog/products — filter validation', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 400 FILTER_NOT_ALLOWED when filtering on a non-filterable attribute', async () => {
    // An attribute exists in the system but has isFilterable=false.
    // The contract forbids the endpoint from silently ignoring the filter.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?filter%5Battr.internal_sku_notes%5D=foo',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.FILTER_NOT_ALLOWED);
  });

  it('returns 200 with { data, pagination } shape on a plain list call', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/products' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; pagination: { hasMore: boolean; limit: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.limit).toBeGreaterThan(0);
  });
});

/**
 * Feature 163 (T070, research R-16, FR-027) — every product summary carries
 * `summary`: the product's own description as plain text in the request
 * language, at most 160 characters, cut at a word boundary; `null` when there
 * is no description. It is derived from the description column the list read
 * already loads, so it costs no query per product.
 */
describe('GET /api/v1/catalog/products — the derived summary (feature 163)', () => {
  let h: BackendServerHandle;
  const CHANNEL = { 'x-sales-channel': 'pl_retail' };
  const RUN = `pb163_${randomUUID().slice(0, 8)}`;
  const SKU_PREFIX = `PB163SUM-${RUN}`;
  const LONG_EN =
    '<p>The <strong>modular</strong> shelving system adapts to any room &amp; grows with your collection. ' +
    'Every panel is made from certified wood, finished by hand and delivered flat with tools included.</p>';
  const SHORT_PL = '<p>Krótki <em>opis</em> po polsku.</p>';
  const slugs: Record<'described' | 'empty', string> = { described: '', empty: '' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    for (const [key, description] of [
      ['described', { 'en-US': LONG_EN, 'pl-PL': SHORT_PL }],
      ['empty', { 'en-US': '' }],
    ] as const) {
      const sku = `${SKU_PREFIX}-${key}`;
      const product = em.create(Product, {
        sku,
        slug: sku.toLowerCase().replace(/_/g, '-'),
        type: 'simple',
        status: 'active',
        name: `Summary ${key}`,
        description: { ...description },
        visibility: 'public',
        allowedOrganizationIds: [],
        attributeValues: { defaultPrice: 10 },
        returnable: true,
      });
      await em.persistAndFlush(product);
      slugs[key] = product.slug;
      await em
        .getConnection()
        .execute('insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)', [
          retail.id,
          product.id,
        ]);
    }
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    await connection.execute(
      'delete from sales_channel_products where product_id in (select id from products where sku like ?)',
      [`${SKU_PREFIX}%`],
    );
    await connection.execute('delete from products where sku like ?', [`${SKU_PREFIX}%`]);
    await teardownBackendServer(h);
  });

  async function listed(language: string): Promise<Map<string, { summary?: string | null }>> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(SKU_PREFIX)}&limit=50`,
      headers: { ...CHANNEL, 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: Array<{ slug: string; summary?: string | null }> }).data;
    return new Map(items.map((item) => [item.slug, item]));
  }

  it('is plain text of at most 160 characters, cut at a word boundary', async () => {
    const summary = (await listed('en-US')).get(slugs.described)?.summary;
    expect(typeof summary).toBe('string');
    expect(summary!.length).toBeLessThanOrEqual(160);
    expect(summary).not.toMatch(/[<>]|&amp;/);
    expect(summary!.startsWith('The modular shelving system adapts to any room & grows')).toBe(true);
    // Cut between words, marked with an ellipsis.
    expect(summary!.endsWith('…')).toBe(true);
    const body = summary!.slice(0, -1);
    expect(LONG_EN.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')).toContain(`${body} `);
  });

  it('is in the request language', async () => {
    expect((await listed('pl-PL')).get(slugs.described)?.summary).toBe('Krótki opis po polsku.');
  });

  it('is null for a product without a description', async () => {
    expect((await listed('en-US')).get(slugs.empty)?.summary).toBeNull();
  });

  it('is on the product read as well', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${slugs.described}`,
      headers: { ...CHANNEL, 'accept-language': 'pl-PL' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { summary?: string | null } }).data.summary).toBe('Krótki opis po polsku.');
  });
});
