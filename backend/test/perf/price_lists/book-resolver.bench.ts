// perf-weight: fast — a 2 000-product fixture; seconds locally.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization, Product, type ProductRow } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { ensureBaseBookSql, seedPriceBookSql } from '../../helpers/price-book-sql.js';
import type { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';

/**
 * Feature 160 (SC-004) — what the price-book resolver costs a listing page,
 * replacing `matrix-resolver.bench.ts` (feature 148) with the same 60 ms p95
 * budget. Fixture: `PERF_BOOK_PRODUCTS` products (default 2 000) with a base
 * price; one organization book for the viewer with 0, 100 and 5 000 rows (the
 * 5 000 price other products, so the row prefetch is what keeps them out).
 * `resolveListingPrices` for a 50-product page, `PERF_ITERATIONS` runs (default
 * 50), the LRU off. PERF_RUN=true to run.
 */
const productCount = Number(process.env['PERF_BOOK_PRODUCTS'] ?? '2000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '50');
const listingBudget = Number(process.env['PERF_BOOK_LISTING_P95_MS'] ?? '60');
const shouldRun = process.env['PERF_RUN'] === 'true';

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

describe.skipIf(!shouldRun)('price books — listing cost', () => {
  let h: BackendServerHandle;
  let pricing: PricingService;
  let channel: { id: string; defaultCurrency: string };
  let organization: { id: string };
  let page: ProductRow[];
  let ids: string[];

  beforeAll(async () => {
    h = await setupBackendServer();
    pricing = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{ handle: { pricingEngine: PricingService } }>(
      'priceLists',
    ).handle.pricingEngine;
    const em = h.em();
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    channel = { id: retail.id, defaultCurrency: retail.defaultCurrency };
    const stamp = Date.now();
    await em.getConnection().execute(
      `insert into products (id, sku, slug, type, status, name, description, visibility, attribute_values, created_at, updated_at)
       select gen_random_uuid(), 'BKB-' || ? || '-' || g, 'bkb-' || ? || '-' || g, 'simple', 'active',
              '{"en-US":"x"}'::jsonb, '{"en-US":"x"}'::jsonb, 'public', '{}'::jsonb, now(), now()
         from generate_series(1, ?) g`,
      [stamp, stamp, productCount],
    );
    ids = (await em.getConnection().execute<Array<{ id: string }>>(`select id from products where sku like ?`, [`BKB-${stamp}-%`])).map(
      (r) => r.id,
    );
    const base = await ensureBaseBookSql(em);
    await em.getConnection().execute(
      `insert into price_list_matrix_entries (id, price_list_id, product_id, min_quantity, price_type, amount, created_at, updated_at)
       select gen_random_uuid(), ?, p, 1, 'fixed', (10 + random() * 90)::numeric(14,4), now(), now() from unnest(?::uuid[]) p`,
      [base, `{${ids.join(',')}}`],
    );
    const org = em.create(Organization, {
      name: `Book bench ${stamp}`,
      taxId: `BKB${stamp}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    organization = { id: org.id };
    page = await em.find(Product, { id: { $in: ids.slice(0, 50) } });
  }, 10 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function time(label: string): Promise<number> {
    const work = () =>
      pricing.resolveListingPrices({ products: page, context: { organization, salesChannel: channel } });
    for (let i = 0; i < 5; i += 1) await work();
    const samples: number[] = [];
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      await work();
      samples.push(performance.now() - start);
    }
    const value = p95(samples);
    // eslint-disable-next-line no-console
    console.log(`[perf/book-resolver] ${label} p95=${value.toFixed(1)}ms budget=${listingBudget}ms`);
    return value;
  }

  it('a 50-product page with 0, 100 and 5 000 rows on the buyer’s book', async () => {
    expect(await time('no book')).toBeLessThanOrEqual(listingBudget);
    const small = await seedPriceBookSql(h.em(), {
      name: `bench ${randomUUID().slice(0, 6)}`,
      audience: { organizations: [organization.id] },
      rows: ids.slice(0, 100).map((productId) => ({ productId, percent: '-5' })),
    });
    expect(await time('100 rows')).toBeLessThanOrEqual(listingBudget);
    await h.em().getConnection().execute(`delete from price_lists where id = ?`, [small]);
    await seedPriceBookSql(h.em(), {
      name: `bench ${randomUUID().slice(0, 6)}`,
      audience: { organizations: [organization.id] },
      rows: ids.slice(-1950).map((productId) => ({ productId, fixed: '9' })),
    });
    expect(await time('1 950 rows on other products')).toBeLessThanOrEqual(listingBudget);
  }, 10 * 60_000);
});
