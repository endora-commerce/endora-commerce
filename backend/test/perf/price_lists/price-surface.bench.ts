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
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import type { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import type { PriceBookService } from '../../../../packages/modules/price_lists/src/backend/services/price-book-service.js';
import type { PriceBookWritePort } from '@endora-commerce/contracts';

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
 * And, since the owner ruling of 2026-10-23 (targeted refresh,
 * `contracts/price-surface.md` §4, research R17), on at least 200 built
 * profiles — 120 product-row, 50 category-%, 20 all-products-% and 10
 * group-only organizations, beside the five above and the everyone profile —
 * with every change made through the audited write path:
 *   - the whole build of those profiles — recorded;
 *   - write → visible in the sort for an everyone book row, an organization
 *     book row, a base price through `priceBookWritePort` and a
 *     `product.updated.v1`, with how many profiles were marked, refreshed and
 *     left untouched — asserted ≤ 60 s each (SC-005);
 *   - a PIM-like import (`PERF_SURFACE_IMPORT_PRODUCTS`, default 3 000: a
 *     `product.updated.v1` and a base price per product, in bursts of
 *     `PERF_SURFACE_IMPORT_BURST`, default 500, two seconds apart) while the
 *     worker runs beside it and probe writes measure write → visible —
 *     asserted ≤ 60 s for every probe;
 *   - a full rebuild of every profile — recorded (the input to P3).
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
 *
 * **Measured 2026-10-23, after the targeted refresh** (same machine, idle, the
 * default fixture, 50 iterations; run 4 of the day, after the coverage-check
 * fix below). First / range pages p95 (asc / desc / range): guest 4.1 / 3.2 /
 * 3.8 ms; group-only 5.9 / 6.8 / 27.4 ms; organization product rows 6.7 / 6.1
 * / 15.0 ms; organization category % 7.7 / 6.9 / 16.8 ms; organization
 * all-products % 6.8 / 5.6 / 6.2 ms; every first five pages ≤ 149 ms. The
 * worker builds the five profiles in 23.2 s (a buyer profile resolves only the
 * products its own books select); a single-book change through `markStale`
 * (every profile rebuilt) is visible after 21.0 s; a profile-miss page 56 ms.
 * At 202 built profiles (1 131 693 rows, 269 MB): their whole build 241.3 s;
 * write → visible 0.43 s for an everyone row and 0.43 s for a base price (31
 * profiles marked and refreshed, 171 untouched), 0.20 s for an organization
 * row (1 marked, 201 untouched), 0.49 s for a `product.updated.v1`; the import
 * of 3 000 products took 436.8 s (6.9 products/s, marking included) with 206
 * worker passes beside it, and its 29 probes were visible after p95 0.50 s,
 * max 0.55 s; a full rebuild of the 202 profiles 274.7 s. Before the
 * coverage-check fix the first page of the all-products buyer took 428 s and
 * then 47 s (`price-surface-plans.test.ts`); earlier runs hid it because a
 * slower whole build left autovacuum time to analyse the table.
 */

const productCount = Number(process.env['PERF_SURFACE_PRODUCTS'] ?? '50000');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '50');
const pageBudget = Number(process.env['PERF_SURFACE_P95_MS'] ?? '150');
const refreshBudget = Number(process.env['PERF_SURFACE_REFRESH_MS'] ?? '60000');
/** Products the PIM-like import of the targeted-refresh scenario writes. */
const importProducts = Number(process.env['PERF_SURFACE_IMPORT_PRODUCTS'] ?? '3000');
const importBurst = Number(process.env['PERF_SURFACE_IMPORT_BURST'] ?? '500');
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
  let productIdsAll: string[] = [];
  let everyoneBookId = '';
  let orgRefs: Array<{ id: string; customerGroupId: string | null }> = [];
  const orgBooks: string[] = [];

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
      `insert into "price_lists" ("id", "name", "currency_code", "priority", "type", "status",
                                  "audience_kind", "is_system", "ever_activated", "created_at", "updated_at")
       values (?, ?, 'PLN', 0, 'regular', 'active', ?, false, true, now(), now())`,
      [id, `bench ${id.slice(0, 8)}`, kind],
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
    everyoneBookId = await book({
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
      orgBooks[i] = await book({
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
    orgRefs = orgs.map(ref);
    productIdsAll = productIds;
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
        const warmStart = performance.now();
        for (let i = 0; i < 5; i += 1) await run();
        const warm = performance.now() - warmStart;
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
        results.push(
          `p95 ${buyer} ${label}: ${value.toFixed(1)} ms (max ${Math.max(...samples).toFixed(1)} ms; 5 warm-up pages ${warm.toFixed(0)} ms)`,
        );
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

  // ---- Targeted refresh at scale (owner ruling 2026-10-23) ---------------------
  //
  // At least 200 built profiles on the same fixture, and every change made
  // through the audited write path, so the marks are the ones production
  // writes: each scenario times write → visible in the sort (the marking, the
  // worker pass, the page), against SC-005's 60 s.

  const container = () => h.container as unknown as { resolve<T>(n: string): T };
  const books = () => container().resolve<{ handle: { priceBookService: PriceBookService } }>('priceLists').handle.priceBookService;
  const writePort = () => container().resolve<PriceBookWritePort>('priceBookWritePort');
  const system = <T>(work: () => Promise<T>) => withSystemScope('price-surface bench', work);
  const basePrice = (amount: string) => ({ byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount }], variants: {} } } });
  const viewerOf = (organization?: { id: string; customerGroupId: string | null }) => ({
    salesChannel: channel,
    ...(organization ? { organization } : {}),
  });
  const firstOf = (organization?: { id: string; customerGroupId: string | null }) =>
    pricing.orderByUnitPrice({ context: viewerOf(organization), direction: 'asc', after: null, limit: 50 });
  /** Profiles that have work, whole or per product. */
  const pendingProfiles = async () =>
    Number(
      (
        (await sql<{ n: string }>(
          `select count(*)::text as n from "price_profiles" f
            where f."state" = 'building' or f."stale"
               or exists (select 1 from "price_profile_stale_products" m where m."profile_id" = f."id")`,
        )) as [{ n: string }]
      )[0].n,
    );

  /** The 200-profile viewers: 120 product-row, 50 category-%, 20 all-% organizations and 10 group-only ones. */
  const scaleViewers = () => [
    ...orgRefs.slice(0, 120),
    ...orgRefs.slice(300, 350),
    ...orgRefs.slice(450, 470),
    ...orgRefs.slice(510, 520),
  ];

  it('at least 200 built profiles: the whole build (recorded)', async () => {
    for (const organization of scaleViewers()) {
      await pricing.orderByUnitPrice({ context: viewerOf(organization), direction: 'asc', after: null, limit: 1 });
    }
    const start = performance.now();
    const built = await pricing.priceSurface.rebuildStale();
    const [{ n }] = (await sql<{ n: string }>(`select count(*)::text as n from "price_profiles" where "state" = 'ready'`)) as [{ n: string }];
    const [{ rows, size }] = (await sql<{ rows: string; size: string }>(
      `select count(*)::text as rows, pg_size_pretty(pg_total_relation_size('price_profile_prices')) as size from "price_profile_prices"`,
    )) as [{ rows: string; size: string }];
    results.push(
      `200-profile fixture: ${built} profiles built in ${((performance.now() - start) / 1000).toFixed(1)} s; ` +
        `${n} profiles ready; price_profile_prices ${rows} rows, ${size}`,
    );
    expect(Number(n)).toBeGreaterThanOrEqual(200);
    expect(await pendingProfiles()).toBe(0);
  }, 60 * 60_000);

  /** Write, then run the worker's pass and read the page until `visible` holds; answers the seconds and what was done. */
  async function writeToVisible(
    label: string,
    write: () => Promise<void>,
    visible: () => Promise<boolean>,
  ): Promise<number> {
    const before = await sql<{ id: string; serving_generation: number; revision: number }>(
      `select "id", "serving_generation", "revision" from "price_profiles"`,
    );
    const start = performance.now();
    await write();
    const marked = await pendingProfiles();
    let passes = 0;
    while (!(await visible())) {
      await pricing.priceSurface.rebuildStale();
      passes += 1;
      if (passes > 20) throw new Error(`${label}: not visible after 20 passes`);
    }
    // The pass the visibility check did not need still runs, so nothing is left behind.
    await pricing.priceSurface.rebuildStale();
    const elapsed = (performance.now() - start) / 1000;
    const after = new Map(
      (
        await sql<{ id: string; serving_generation: number; revision: number }>(
          `select "id", "serving_generation", "revision" from "price_profiles"`,
        )
      ).map((r) => [r.id, r]),
    );
    let whole = 0;
    let refreshed = 0;
    for (const row of before) {
      const now = after.get(row.id);
      if (!now) continue;
      if (Number(now.serving_generation) !== Number(row.serving_generation)) whole += 1;
      else if (Number(now.revision) !== Number(row.revision)) refreshed += 1;
    }
    results.push(
      `${label}: write → visible ${elapsed.toFixed(2)} s (${marked} profiles marked; ${whole} rebuilt whole, ${refreshed} refreshed, ` +
        `${before.length - whole - refreshed} untouched)`,
    );
    expect(await pendingProfiles()).toBe(0);
    return elapsed;
  }

  it('targeted refresh on 200+ profiles: each kind of write is visible within 60 s, and only the profiles it concerns move', async () => {
    const samples: number[] = [];
    // An everyone book's row (a product outside the everyone book's category).
    const [{ id: target }] = (await sql<{ id: string }>(
      `select "product_id" as id from "product_categories" where "category_id" = ? limit 1`,
      [categoryIds[7]],
    )) as [{ id: string }];
    samples.push(
      await writeToVisible(
        'everyone book row (1 product)',
        () =>
          system(async () => {
            await books().replaceRows(everyoneBookId, {
              upsert: [{ selection: { productId: target }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '0.0050' } }],
              delete: [],
            });
          }),
        async () => (await firstOf()).rows[0]?.productId === target,
      ),
    );
    // An organization book's row: only that organization's profile.
    const buyer = orgRefs[5]!;
    const [{ id: own }] = (await sql<{ id: string }>(
      `select "product_id" as id from "price_list_matrix_entries" where "price_list_id" = ? limit 1`,
      [orgBooks[5]],
    )) as [{ id: string }];
    samples.push(
      await writeToVisible(
        'organization book row (1 product)',
        () =>
          system(async () => {
            await books().replaceRows(orgBooks[5]!, {
              upsert: [{ selection: { productId: own }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '0.0040' } }],
              delete: [],
            });
          }),
        async () => (await firstOf(buyer)).rows[0]?.productId === own,
      ),
    );
    // A base price through the PIM port.
    const probe = productIdsAll[3]!;
    samples.push(
      await writeToVisible(
        'base price via priceBookWritePort (1 product)',
        () =>
          system(async () => {
            await writePort().replaceBasePrices(probe, basePrice('0.0030'));
          }),
        async () => (await firstOf()).rows[0]?.productId === probe,
      ),
    );
    // A catalogue product event.
    samples.push(
      await writeToVisible(
        'product.updated.v1 (1 product)',
        async () => {
          await h.eventBus.run(async () => {
            h.eventBus.emit('product.updated.v1' as never, {
              eventId: `bench-${Date.now()}`,
              occurredAt: new Date().toISOString(),
              productId: probe,
              changedFields: ['attributeValues'],
            } as never);
          });
        },
        async () => (await firstOf()).rows[0]?.productId === probe,
      ),
    );
    results.push(`targeted write → visible, max over the four kinds: ${Math.max(...samples).toFixed(2)} s (budget ${refreshBudget / 1000} s)`);
    expect(Math.max(...samples) * 1000).toBeLessThanOrEqual(refreshBudget);
  }, 60 * 60_000);

  it('a PIM-like bulk import running while freshness is measured: every probe is visible within 60 s', async () => {
    // The worker, as a loop beside the import (production runs it in the worker process).
    let importing = true;
    let passes = 0;
    const worker = (async () => {
      while (importing) {
        if ((await pricing.priceSurface.rebuildStale()) === 0) await new Promise((resolve) => setTimeout(resolve, 50));
        passes += 1;
      }
    })();
    // The import: bursts of product updates and base prices, one product at a time, as a PIM sync writes them.
    const probe = productIdsAll[11]!;
    const pool = productIdsAll.filter((id) => id !== probe);
    let written = 0;
    const importStart = performance.now();
    const importer = (async () => {
      for (let burst = 0; written < importProducts; burst += 1) {
        for (let i = 0; i < importBurst && written < importProducts; i += 1) {
          const productId = pool[(burst * importBurst + i * 7919) % pool.length]!;
          await h.eventBus.run(async () => {
            h.eventBus.emit('product.updated.v1' as never, {
              eventId: `bench-import-${written}`,
              occurredAt: new Date().toISOString(),
              productId,
              changedFields: ['name', 'attributeValues'],
            } as never);
          });
          await system(() => writePort().replaceBasePrices(productId, basePrice((10 + ((written * 37) % 990)).toFixed(4))));
          written += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    })();
    // Probes: a base price far below every other, until the import ends.
    const freshness: number[] = [];
    for (let k = 0; ; k += 1) {
      const amount = (0.0029 - k * 0.0001).toFixed(4);
      if (Number(amount) <= 0) break;
      const start = performance.now();
      await system(() => writePort().replaceBasePrices(probe, basePrice(amount)));
      for (;;) {
        const top = (await firstOf()).rows[0];
        if (top?.productId === probe && top.amount === amount) break;
        if (performance.now() - start > 5 * refreshBudget) throw new Error(`probe ${amount} not visible after ${5 * refreshBudget} ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      freshness.push(performance.now() - start);
      const done = await Promise.race([importer.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000))]);
      if (done) break;
    }
    await importer;
    const importSeconds = (performance.now() - importStart) / 1000;
    importing = false;
    await worker;
    await pricing.priceSurface.rebuildStale();
    results.push(
      `PIM-like import: ${written} products (a product.updated.v1 and a base price each, bursts of ${importBurst}) in ` +
        `${importSeconds.toFixed(1)} s (${(written / importSeconds).toFixed(1)} products/s); ${passes} worker passes; ` +
        `${freshness.length} probes write → visible p95 ${(p95(freshness) / 1000).toFixed(2)} s, max ${(Math.max(...freshness) / 1000).toFixed(2)} s ` +
        `(budget ${refreshBudget / 1000} s)`,
    );
    expect(await pendingProfiles()).toBe(0);
    expect(Math.max(...freshness)).toBeLessThanOrEqual(refreshBudget);
  }, 60 * 60_000);

  it('a full rebuild of every profile (recorded — the input to P3’s precedence flow)', async () => {
    await pricing.priceSurface.markStale();
    const start = performance.now();
    const built = await pricing.priceSurface.rebuildStale();
    results.push(`full rebuild of ${built} profiles: ${((performance.now() - start) / 1000).toFixed(1)} s`);
  }, 60 * 60_000);
});
