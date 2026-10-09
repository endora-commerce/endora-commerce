// perf-weight: fast — not yet measured on the CI runner; ~20 s on a loaded dev box at the default corpus.
import type { Knex } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * What it costs to hand a buyer **one full page of products that match** —
 * the measurement issue #151 needed and `catalog-list.bench.ts` cannot take.
 *
 * That bench binds its whole corpus to the channel it reads and filters by
 * nothing, so every row the listing fetches is a row it serves. The defect
 * was in the opposite case: channel membership, the audience, the category and
 * the attribute filters were applied to a page **after** it was cut, so a
 * narrow listing answered short or empty pages and a client paid one request
 * per `limit` rows of the table until it had collected a page's worth. Moving
 * the predicates into the statement makes that one request — and makes the
 * statement the place a selective filter is paid for, which is what a plan
 * check is for.
 *
 * ## The corpus
 *
 * `PERF_CORPUS_SIZE` products, newest first:
 *
 *  - the **newest half** is bound to `pl_b2b_vip` only. A `pl_retail` listing
 *    in the default ordering therefore has to pass over half the table before
 *    its first row, which is the worst arrangement the ordering index allows;
 *  - the older half is bound to `pl_retail`;
 *  - every third product sits in one category and every fourth carries
 *    `material = steel`.
 *
 * ## What is measured, per scenario
 *
 *  - **requests** and wall time until a client walking the cursor holds one
 *    page of matching products. One request is the assertion;
 *  - the listing statement's own `explain (analyze, buffers)`: execution time
 *    and shared buffers touched. Buffers are the number to compare across
 *    runs — on a shared box the milliseconds are mostly the neighbours'.
 *
 * ## Reading the numbers
 *
 * `retail` is the worst case by construction: `products_created_at_index` is
 * walked backwards through the half of the table the channel does not carry,
 * one membership probe per row. It is linear in how much of the newest
 * catalogue a channel lacks, and it replaces the same walk done as
 * `rows / limit` HTTP requests. `vip` is the ordinary case — the channel
 * carries what is newest — and should stay within reach of
 * `catalog-list.bench.ts`.
 *
 * Tuning knobs (env):
 *   PERF_CORPUS_SIZE          — products to seed (default 20000)
 *   PERF_FILTERED_PAGE_MS     — per-request budget for every scenario (default 1500)
 *   PERF_EXPLAIN_PLANS        — set to 'true' to print each statement's plan
 *   PERF_RUN                  — set to 'true' to run at all
 */

const corpusSize = Number(process.env['PERF_CORPUS_SIZE'] ?? '20000');
const requestBudgetMs = Number(process.env['PERF_FILTERED_PAGE_MS'] ?? '1500');
const printPlans = process.env['PERF_EXPLAIN_PLANS'] === 'true';
const shouldRun = process.env['PERF_RUN'] === 'true';

const PAGE_LIMIT = 24;
const SKU_PREFIX = 'I151P-';
const CATEGORY_SLUG = 'i151-perf-third';
/** A walk that has not filled a page by then is reported, not waited for. */
const MAX_REQUESTS = 6000;

interface Scenario {
  name: string;
  channel: string;
  query: string;
}

const SCENARIOS: readonly Scenario[] = [
  { name: 'vip, no filter (channel carries the newest half)', channel: 'pl_b2b_vip', query: '' },
  { name: 'retail, no filter (channel lacks the newest half)', channel: 'pl_retail', query: '' },
  {
    name: 'retail, category (every third)',
    channel: 'pl_retail',
    query: `filter%5Bcategory%5D=${CATEGORY_SLUG}`,
  },
  {
    name: 'retail, category and attribute (every twelfth)',
    channel: 'pl_retail',
    query: `filter%5Bcategory%5D=${CATEGORY_SLUG}&filter%5Battr.material%5D=steel`,
  },
];

interface PlanNode {
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
}

describe.skipIf(!shouldRun)('catalog list — one full page of matching products (issue #151)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const conn = em.getConnection();
    const retail = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    const vip = await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' });

    // Set-based, because the corpus is the point and a hundred thousand
    // `em.create` calls would be most of the run.
    await conn.execute(
      `insert into products
         (id, sku, slug, type, status, name, description, visibility,
          attribute_values, allowed_organization_ids, created_at, updated_at)
       select gen_random_uuid(),
              ? || lpad(g::text, 7, '0'),
              lower(?) || lpad(g::text, 7, '0'),
              'simple', 'active',
              jsonb_build_object('en-US', 'Perf product ' || g),
              jsonb_build_object('en-US', 'Synthetic product for the filtered-page bench.'),
              'public',
              jsonb_build_object('material', case when g % 4 = 0 then 'steel' else 'plastic' end),
              '[]'::jsonb,
              timestamptz '2031-01-01 00:00:00+00' - make_interval(secs => g),
              now()
         from generate_series(0, ? - 1) as g`,
      [SKU_PREFIX, SKU_PREFIX, corpusSize],
    );
    const ordinal = `substring(sku from ${SKU_PREFIX.length + 1})::int`;
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id)
       select case when ${ordinal} < ? then ?::uuid else ?::uuid end, id
         from products where sku like ?`,
      [Math.floor(corpusSize / 2), vip.id, retail.id, `${SKU_PREFIX}%`],
    );
    const category = await conn.execute<Array<{ id: string }>>(
      `insert into categories (id, slug, name, sort_order, is_active, created_at, updated_at)
       values (gen_random_uuid(), ?, ?::jsonb, 0, true, now(), now())
       returning id`,
      [CATEGORY_SLUG, JSON.stringify({ 'en-US': 'Filtered-page bench' })],
    );
    await conn.execute(
      `insert into product_categories (product_id, category_id)
       select id, ?::uuid from products where sku like ? and ${ordinal} % 3 = 0`,
      [category[0]!.id, `${SKU_PREFIX}%`],
    );
    // What autovacuum would have done on a catalogue this size: without it the
    // planner costs three freshly loaded tables as though they were empty.
    await conn.execute('analyze products');
    await conn.execute('analyze sales_channel_products');
    await conn.execute('analyze product_categories');
  }, 10 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function request(
    scenario: Scenario,
    cursor: string | null,
  ): Promise<{ skus: string[]; hasMore: boolean; cursor: string | null; ms: number }> {
    const url =
      `/api/v1/catalog/products?limit=${PAGE_LIMIT}` +
      (scenario.query === '' ? '' : `&${scenario.query}`) +
      (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`);
    const start = performance.now();
    const res = await h.app.inject({
      method: 'GET',
      url,
      headers: { 'x-sales-channel': scenario.channel },
    });
    const ms = performance.now() - start;
    expect(res.statusCode, url).toBe(200);
    const body = res.json() as {
      data: Array<{ sku: string }>;
      pagination: { cursor: string | null; hasMore: boolean };
    };
    return {
      skus: body.data.map((p) => p.sku),
      hasMore: body.pagination.hasMore,
      cursor: body.pagination.cursor,
      ms,
    };
  }

  /** The listing statement of one request, explained with its own bindings. */
  async function explainFirstPage(
    scenario: Scenario,
  ): Promise<{ executionMs: number; buffers: number } | null> {
    const knex: Knex = h.em().getConnection().getKnex();
    const seen: Array<{ sql: string; bindings: readonly unknown[] }> = [];
    const capture = (query: { sql: string; bindings?: readonly unknown[] }): void => {
      seen.push({ sql: query.sql, bindings: query.bindings ?? [] });
    };
    knex.on('query', capture);
    await request(scenario, null);
    knex.off('query', capture);

    const listing = seen.find(
      (s) => /from "products" as/.test(s.sql) && /order by/.test(s.sql) && /limit/.test(s.sql),
    );
    if (!listing) return null;
    // knex hands back `$1`-style text for a statement it already compiled.
    const result = (await knex.raw(
      `explain (analyze, buffers, format json) ${listing.sql.replace(/\$\d+/g, '?')}`,
      [...listing.bindings] as Knex.RawBinding[],
    )) as { rows: Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Execution Time': number }> }> };
    const plan = result.rows[0]!['QUERY PLAN'][0]!;
    if (printPlans) {
      const text = (await knex.raw(
        `explain (analyze, buffers) ${listing.sql.replace(/\$\d+/g, '?')}`,
        [...listing.bindings] as Knex.RawBinding[],
      )) as { rows: Array<{ 'QUERY PLAN': string }> };
      // eslint-disable-next-line no-console
      console.log(
        `[perf/listing-filtered-page] plan for "${scenario.name}"\n` +
          text.rows.map((row) => row['QUERY PLAN']).join('\n'),
      );
    }
    return {
      executionMs: plan['Execution Time'],
      buffers: (plan.Plan['Shared Hit Blocks'] ?? 0) + (plan.Plan['Shared Read Blocks'] ?? 0),
    };
  }

  it.each(SCENARIOS)('fills a page in one request — $name', async (scenario) => {
    // Warm-up: the first request pays for the plan cache and the pool.
    await request(scenario, null);

    const collected: string[] = [];
    let cursor: string | null = null;
    let requests = 0;
    let emptyPages = 0;
    let slowest = 0;
    const start = performance.now();
    while (collected.length < PAGE_LIMIT && requests < MAX_REQUESTS) {
      const page = await request(scenario, cursor);
      requests += 1;
      slowest = Math.max(slowest, page.ms);
      if (page.skus.length === 0) emptyPages += 1;
      collected.push(...page.skus.filter((sku) => sku.startsWith(SKU_PREFIX)));
      if (!page.hasMore) break;
      cursor = page.cursor;
    }
    const totalMs = performance.now() - start;
    const plan = await explainFirstPage(scenario);

    // eslint-disable-next-line no-console
    console.log(
      `[perf/listing-filtered-page] corpus=${corpusSize} limit=${PAGE_LIMIT} "${scenario.name}" ` +
        `requests=${requests} emptyPages=${emptyPages} collected=${collected.length} ` +
        `total=${totalMs.toFixed(0)}ms slowestRequest=${slowest.toFixed(0)}ms ` +
        (plan
          ? `statement=${plan.executionMs.toFixed(1)}ms buffers=${plan.buffers}`
          : 'statement=not-captured'),
    );

    // What was measured, before how long it took: a full page, from the first
    // request. A short or empty first page is faster than any budget.
    expect(collected.length).toBeGreaterThanOrEqual(PAGE_LIMIT);
    expect(requests, 'a page of matching products costs one request').toBe(1);
    expect(slowest).toBeLessThan(requestBudgetMs);
  }, 20 * 60_000);
});
