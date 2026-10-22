// perf-weight: heavy — a 50 000-product catalogue and 1 000 organizations; minutes of fixture.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CustomerGroup, Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { ensureBaseBookSql } from '../../helpers/price-book-sql.js';
import { findAttributeExtensionByKey } from '../../helpers/seed-catalog.js';
import type { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';

/**
 * Feature 160, SC-005 (`contracts/price-surface.md` §5, research R7) — a
 * price-sorted first page returns within 150 ms p95 on a 50 000-product
 * catalogue with 1 000 organizations of which half have their own books, and a
 * price change is reflected in the sorted listing within 60 seconds.
 *
 * Fixture (`PERF_SURFACE_PRODUCTS`, default 50 000): products in 200 categories
 * with a choice attribute (red/blue), a PLN base price each; 1 000 organizations
 * in 20 customer groups; 500 of them with a book of their own — 300 with 200
 * product rows, 150 with a category percentage, 50 with an all-products
 * percentage; 20 customer-group books (a category percentage each); one
 * everyone book on the channel (a red-in-category fixed price).
 *
 * Scenarios, each over `PERF_ITERATIONS` runs (default 50), the LRU off (the
 * harness sets the TTL to 0), on ready surfaces; no request may write the
 * surface (`contracts/price-surface.md` §3 — the worker builds, a request never
 * waits on a build), which every scenario asserts:
 *   - first page of 50, ascending and descending, for a guest, a group-only
 *     buyer and a buyer of each organization-book kind — asserted ≤ 150 ms p95;
 *   - a price-range page for the same buyers — asserted ≤ 150 ms p95;
 *   - a profile-miss page (a category-restricted request on a stale surface) —
 *     recorded, not asserted;
 *   - a single-book change until the sort shows it (mark stale, worker rebuild,
 *     first page) — asserted ≤ 60 s;
 *   - the build time of one profile and the size of `price_profile_prices` —
 *     recorded; above 10 M rows the profile-factor task of research R7 is due.
 *
 * PERF_RUN=true to run.
 *
 * **Measured 2026-10-22, two runs, after the non-blocking surface** (owner
 * decision: a request never waits on a build; one developer machine, local
 * PostgreSQL, the default fixture, 50 iterations). No request wrote the surface
 * in either run. First and range pages p95 (asc / desc / range), run 1 | run 2:
 * guest 3.9 / 3.8 / 3.9 | 4.0 / 4.0 / 3.6 ms; group-only 7.2 / 8.1 / 6.0 |
 * 7.1 / 7.0 / 6.9 ms; organization product rows 83.9 / 8.0 / 102.4 | 14.4 /
 * 7.1 / 24.1 ms; organization category % 110.1 / 7.7 / 7.5 | 80.9 / 8.8 /
 * 7.8 ms; organization all-products % 6.3 / 6.3 / 5.4 | 7.2 / 7.0 / 7.4 ms.
 * A never-built first page answers in 26–40 | 9–13 ms without building; the
 * worker builds the five profiles in 53.5 | 60.0 s; a guest page while stale
 * (previous surface) 5.5 | 5.6 ms p95; a single-book change visible after
 * 56.9 | 42.0 s (budget 60 s); a profile-miss page of 250 products, live, 55 |
 * 144 ms; 101 205 rows, 24 MB. Before the coverage check of `PriceSurface` the
 * all-products descending page was 2 401.9 ms p95, and before this change a
 * request met a never-built or stale profile by building it, up to 61.2 s.
 */

const productCount = Number(process.env['PERF_SURFACE_PRODUCTS'] ?? '50000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '50');
const pageBudget = Number(process.env['PERF_SURFACE_P95_MS'] ?? '150');
const refreshBudget = Number(process.env['PERF_SURFACE_REFRESH_MS'] ?? '60000');
const shouldRun = process.env['PERF_RUN'] === 'true';

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

describe.skipIf(!shouldRun)('price surface — SC-005', () => {
  let h: BackendServerHandle;
  let pricing: PricingService;
  let channel: { id: string; defaultCurrency: string };
  const buyers: Record<string, { organization?: { id: string; customerGroupId: string | null } }> = {};
  const results: string[] = [];
  let categoryIds: string[] = [];

  const sql = <T = Record<string, unknown>>(statement: string, params: unknown[] = []) =>
    h.em().getConnection().execute<T[]>(statement, params);

  async function book(input: {
    audience: 'everyone' | { organizations: string[] } | { groups: string[] };
    rowsSql: string;
    rowsParams: unknown[];
  }): Promise<string> {
    const id = randomUUID();
    const kind = input.audience === 'everyone' ? 'everyone' : 'organizations' in input.audience ? 'organizations' : 'customer_groups';
    await sql(
      `insert into "price_lists" ("id", "code", "name", "currency_code", "is_default", "priority", "type", "status",
                                  "application_rule", "audience_kind", "is_system", "modified_at", "created_at", "updated_at")
       values (?, ?, ?, 'PLN', false, 0, 'regular', 'active', null, ?, false, now(), now(), now())`,
      [id, `bench-${id}`, `bench ${id.slice(0, 8)}`, kind],
    );
    if (input.audience !== 'everyone') {
      const column = 'organizations' in input.audience ? 'organization_id' : 'customer_group_id';
      const members = 'organizations' in input.audience ? input.audience.organizations : input.audience.groups;
      await sql(
        `insert into "price_list_audience_members" ("id", "price_list_id", "${column}")
         select gen_random_uuid(), ?, unnest(?::uuid[])`,
        [id, `{${members.join(',')}}`],
      );
    }
    await sql(`insert into "sales_channel_price_lists" ("sales_channel_id", "price_list_id") values (?, ?)`, [channel.id, id]);
    await sql(input.rowsSql.replaceAll('$BOOK', `'${id}'::uuid`), input.rowsParams);
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    pricing = (h.container as unknown as { resolve<T>(n: string): T }).resolve<{ handle: { pricingEngine: PricingService } }>(
      'priceLists',
    ).handle.pricingEngine;
    const retail = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    channel = { id: retail.id, defaultCurrency: retail.defaultCurrency };
    const stamp = Date.now();

    // Categories and products.
    categoryIds = Array.from({ length: 200 }, () => randomUUID());
    await sql(
      `insert into "categories" ("id", "name", "slug", "created_at", "updated_at")
       select c, '{"en-US":"bench"}'::jsonb, 'bench-' || ? || '-' || ordinality, now(), now()
         from unnest(?::uuid[]) with ordinality c`,
      [stamp, `{${categoryIds.join(',')}}`],
    );
    await sql(
      `insert into "products" ("id", "sku", "slug", "type", "status", "name", "description", "visibility", "attribute_values", "created_at", "updated_at")
       select gen_random_uuid(), 'SURF-' || ? || '-' || g, 'surf-' || ? || '-' || g, 'simple', 'active',
              '{"en-US":"x"}'::jsonb, '{"en-US":"x"}'::jsonb, 'public',
              jsonb_build_object('color', case when g % 2 = 0 then 'red' else 'blue' end), now(), now()
         from generate_series(1, ?) g`,
      [stamp, stamp, productCount],
    );
    const productIds = (await sql<{ id: string }>(`select "id" from "products" where "sku" like ? order by "sku"`, [`SURF-${stamp}-%`])).map(
      (r) => r.id,
    );
    await sql(
      `insert into "product_categories" ("product_id", "category_id")
       select p.id, (?::uuid[])[1 + (p.n % 200)]
         from (select unnest(?::uuid[]) as id, generate_series(0, ? - 1) as n) p`,
      [`{${categoryIds.join(',')}}`, `{${productIds.join(',')}}`, productIds.length],
    );
    const baseBook = await ensureBaseBookSql(h.em());
    await sql(
      `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "min_quantity", "price_type", "amount", "created_at", "updated_at")
       select gen_random_uuid(), ?, p, 1, 'fixed', (10 + random() * 990)::numeric(14,4), now(), now() from unnest(?::uuid[]) p`,
      [baseBook, `{${productIds.join(',')}}`],
    );
    const color = await findAttributeExtensionByKey(h.em(), 'color');
    if (color) {
      color.isPriceRule = true;
      await h.em().flush();
    }

    // Buyers.
    const em = h.em();
    const groups = Array.from({ length: 20 }, (_, i) => em.create(CustomerGroup, { code: `bench-g-${stamp}-${i}`, name: `G${i}` }));
    await em.persistAndFlush(groups);
    const orgs = Array.from({ length: 1000 }, (_, i) =>
      em.create(Organization, {
        name: `Bench org ${stamp} ${i}`,
        taxId: `BENCH${stamp}${i}`,
        vatStatus: 'vat_payer',
        status: 'active',
        customerGroupId: groups[i % 20]!.id,
        registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      }),
    );
    await em.persistAndFlush(orgs);

    // Books: one everyone, 20 group, 300 product-row, 150 category-%, 50 all-%.
    await book({
      audience: 'everyone',
      rowsSql: `insert into "price_list_matrix_entries" ("id", "price_list_id", "category_id", "attribute_key", "attribute_value", "min_quantity", "price_type", "amount", "created_at", "updated_at")
                values (gen_random_uuid(), $BOOK, ?, 'color', 'red', 1, 'fixed', 77, now(), now())`,
      rowsParams: [categoryIds[0]],
    });
    for (let g = 0; g < 20; g += 1) {
      await book({
        audience: { groups: [groups[g]!.id] },
        rowsSql: `insert into "price_list_matrix_entries" ("id", "price_list_id", "category_id", "min_quantity", "price_type", "percent", "created_at", "updated_at")
                  values (gen_random_uuid(), $BOOK, ?, 1, 'percent', -7, now(), now())`,
        rowsParams: [categoryIds[g + 1]],
      });
    }
    for (let i = 0; i < 300; i += 1) {
      const start = (i * 137) % (productIds.length - 200);
      await book({
        audience: { organizations: [orgs[i]!.id] },
        rowsSql: `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "min_quantity", "price_type", "amount", "created_at", "updated_at")
                  select gen_random_uuid(), $BOOK, p, 1, 'fixed', (5 + random() * 500)::numeric(14,4), now(), now() from unnest(?::uuid[]) p`,
        rowsParams: [`{${productIds.slice(start, start + 200).join(',')}}`],
      });
    }
    for (let i = 300; i < 450; i += 1) {
      await book({
        audience: { organizations: [orgs[i]!.id] },
        rowsSql: `insert into "price_list_matrix_entries" ("id", "price_list_id", "category_id", "min_quantity", "price_type", "percent", "created_at", "updated_at")
                  values (gen_random_uuid(), $BOOK, ?, 1, 'percent', -12, now(), now())`,
        rowsParams: [categoryIds[i % 200]],
      });
    }
    for (let i = 450; i < 500; i += 1) {
      await book({
        audience: { organizations: [orgs[i]!.id] },
        rowsSql: `insert into "price_list_matrix_entries" ("id", "price_list_id", "min_quantity", "price_type", "percent", "created_at", "updated_at")
                  values (gen_random_uuid(), $BOOK, 1, 'percent', -3, now(), now())`,
        rowsParams: [],
      });
    }
    await sql(`analyze`);

    const ref = (o: (typeof orgs)[number]) => ({ id: o.id, customerGroupId: o.customerGroupId ?? null });
    buyers['guest'] = {};
    buyers['group-only'] = { organization: ref(orgs[700]!) };
    buyers['org product rows'] = { organization: ref(orgs[0]!) };
    buyers['org category %'] = { organization: ref(orgs[300]!) };
    buyers['org all-products %'] = { organization: ref(orgs[450]!) };
  }, 60 * 60_000);

  afterAll(async () => {
    // eslint-disable-next-line no-console
    console.log(['', 'SC-005 price-surface bench', ...results].join('\n'));
    await teardownBackendServer(h);
  });

  /** Every surface write statement issued while `run` executes (a request must issue none). */
  let surfaceWrites = 0;
  let counting = false;
  const countWrites = (q: { sql: string }) => {
    if (counting && /^\s*(insert into|delete from|update) "price_profile_prices"/i.test(q.sql)) surfaceWrites += 1;
  };

  const order = (buyer: string, direction: 'asc' | 'desc', extra: Record<string, unknown> = {}) =>
    pricing.orderByUnitPrice({
      context: { salesChannel: channel, ...buyers[buyer] },
      direction,
      after: null,
      limit: 50,
      ...extra,
    });

  it('a request never builds: a never-built profile answers at once, and the worker builds (recorded)', async () => {
    h.em().getConnection().getKnex().on('query', countWrites);
    for (const buyer of Object.keys(buyers)) {
      counting = true;
      const start = performance.now();
      await order(buyer, 'asc');
      counting = false;
      results.push(`never-built first page ${buyer}: ${(performance.now() - start).toFixed(0)} ms (no build)`);
    }
    expect(surfaceWrites, 'surface writes issued by a request').toBe(0);
    const start = performance.now();
    const built = await pricing.priceSurface.rebuildStale();
    results.push(`worker build of ${built} profiles: ${((performance.now() - start) / 1000).toFixed(1)} s`);
    const [{ rows, size }] = (await sql<{ rows: string; size: string }>(
      `select count(*)::text as rows, pg_size_pretty(pg_total_relation_size('price_profile_prices')) as size from "price_profile_prices"`,
    )) as [{ rows: string; size: string }];
    results.push(`price_profile_prices: ${rows} rows, ${size} (profiles built: ${Object.keys(buyers).length})`);
    expect(Number(rows)).toBeLessThan(10_000_000);
  }, 60 * 60_000);

  it('first page and range page p95 ≤ 150 ms, every buyer kind', async () => {
    const misses: string[] = [];
    for (const buyer of Object.keys(buyers)) {
      for (const [label, run] of [
        ['asc', () => order(buyer, 'asc')],
        ['desc', () => order(buyer, 'desc')],
        ['range', () => order(buyer, 'asc', { amountRange: { min: '100', max: '400' } })],
      ] as const) {
        for (let i = 0; i < 5; i += 1) await run();
        const samples: number[] = [];
        counting = true;
        for (let i = 0; i < iterations; i += 1) {
          const start = performance.now();
          const chunk = await run();
          samples.push(performance.now() - start);
          expect(chunk.rows.length).toBe(50);
        }
        counting = false;
        const value = p95(samples);
        results.push(`p95 ${buyer} ${label}: ${value.toFixed(1)} ms`);
        if (value > pageBudget) misses.push(`${buyer} ${label} ${value.toFixed(1)} ms`);
      }
    }
    expect(misses, `pages over ${pageBudget} ms p95`).toEqual([]);
    expect(surfaceWrites, 'surface writes issued by a request').toBe(0);
  }, 60 * 60_000);

  it('a profile-miss page restricted to a category (recorded)', async () => {
    const restricted = (
      await sql<{ product_id: string }>(`select "product_id" from "product_categories" where "category_id" = ?`, [categoryIds[5]])
    ).map((r) => r.product_id);
    // Every buyer profile as if never built (the everyone surface stays).
    await sql(`update "price_profiles" set "state" = 'building', "serving_generation" = 0 where jsonb_array_length("book_vector") > 0`);
    counting = true;
    const start = performance.now();
    await order('org category %', 'asc', { restrictToProductIds: restricted });
    counting = false;
    results.push(`profile-miss page (${restricted.length} products, live): ${(performance.now() - start).toFixed(0)} ms`);
    expect(surfaceWrites, 'surface writes issued by a request').toBe(0);
    await pricing.priceSurface.rebuildStale();
  }, 60 * 60_000);

  it('a single-book change reaches the sorted listing within 60 s', async () => {
    const start = performance.now();
    // The write: one product of the everyone book's reach repriced to the floor.
    const [{ id: target }] = (await sql<{ id: string }>(`select "product_id" as id from "product_categories" where "category_id" = ? limit 1`, [
      categoryIds[0],
    ])) as [{ id: string }];
    await book({
      audience: 'everyone',
      rowsSql: `insert into "price_list_matrix_entries" ("id", "price_list_id", "product_id", "min_quantity", "price_type", "amount", "created_at", "updated_at")
                values (gen_random_uuid(), $BOOK, ?, 1, 'fixed', 0.01, now(), now())`,
      rowsParams: [target],
    });
    await pricing.priceSurface.markStale();
    // During the rebuild a request is served the previous surface, at once.
    counting = true;
    const during: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t = performance.now();
      await order('guest', 'asc');
      during.push(performance.now() - t);
    }
    counting = false;
    results.push(`p95 guest asc while stale (previous surface): ${p95(during).toFixed(1)} ms`);
    expect(p95(during)).toBeLessThanOrEqual(pageBudget);
    expect(surfaceWrites, 'surface writes issued by a request').toBe(0);
    const rebuilt = await pricing.priceSurface.rebuildStale();
    const first = await order('guest', 'asc');
    const elapsed = performance.now() - start;
    results.push(`single-book refresh → visible (worker rebuild of ${rebuilt} profiles): ${(elapsed / 1000).toFixed(1)} s`);
    expect(first.rows[0]).toMatchObject({ productId: target, amount: '0.0100' });
    expect(elapsed).toBeLessThanOrEqual(refreshBudget);
  }, 60 * 60_000);
});
