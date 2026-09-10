// perf-weight: fast — 6852 ms on the CI runner (pipeline 13444, 2026-09-09) at the default 5000-product corpus.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PriceList } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { UNIT_PRICE_AMOUNT_INDEX } from '../../../../packages/modules/price_lists/src/migrations/20260821T135907_price_lists_unit_price_amount_index.js';
import {
  buildUnitPriceMergeQuery,
  type UnitPriceStream,
} from '../../../../packages/modules/price_lists/src/backend/services/unit-price-ordering.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * The **cost** side of feature 086's three findings, measured rather than
 * asserted (`test/unit/price_lists/unit-price-ordering.test.ts` pins the shape).
 *
 * Each of the three is measured against its own counter-formulation on the same
 * corpus in the same session, so the number in the plan is a comparison and not
 * a claim:
 *
 *  1. the exclusion as a scalar subquery with `limit 1`, against the same
 *     exclusion written `not exists`;
 *  2. a fully shadowed stream with the amount watermark, against the same
 *     stream without it;
 *  3. the whole merge with the default planner and no session settings.
 *
 * It also prints the size of the partial index, which is the feature's entire
 * storage cost.
 *
 * Skipped unless `PERF_RUN=true`, like every other bench here. Sized by
 * `PERF_CORPUS_SIZE` — the design's own figures were taken on 50 000 products
 * and 300 price lists in a throwaway database; this runs the same shapes over a
 * corpus a test database can hold, and prints both so the comparison is legible
 * at whatever size it was run.
 */

const corpusSize = Number(process.env['PERF_CORPUS_SIZE'] ?? '5000');
const pageSize = Number(process.env['PERF_PAGE_SIZE'] ?? '50');
const shouldRun = process.env['PERF_RUN'] === 'true';

const CHANNEL_LIST = '00000000-0000-4000-8000-0000000986f1';
const ORG_LIST = '00000000-0000-4000-8000-0000000986f2';

interface PlanRow {
  'QUERY PLAN': string;
}

describe.skipIf(!shouldRun)('price-ordered listing — query plans', () => {
  let h: BackendServerHandle;
  let channelId = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    for (const [id, code, rule] of [
      [CHANNEL_LIST, 'perf-086-channel', { kind: 'all' as const }],
      [
        ORG_LIST,
        'perf-086-org',
        { kind: 'criterion' as const, type: 'organization' as const, values: [TEST_ORGANIZATION_ID] },
      ],
    ] as const) {
      em.create(PriceList, {
        id,
        code,
        name: code,
        currency: 'PLN',
        isDefault: false,
        priority: 0,
        type: 'base',
        status: 'active',
        startsAt: null,
        endsAt: null,
        applicationRule: rule as PriceList['applicationRule'],
        isSystem: false,
        modifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    }
    await em.flush();

    // Products, in bulk. `generate_series` rather than the ORM: the corpus is
    // the measurement's input, not part of what is being measured.
    const conn = em.getConnection();
    await conn.execute(
      `insert into products (id, sku, slug, type, status, name, description, visibility,
                             allowed_organization_ids, attribute_values, created_at, updated_at)
       select gen_random_uuid(), 'PERF086-' || i, 'perf086-' || i, 'simple', 'active',
              jsonb_build_object('en-US', 'Perf ' || i), jsonb_build_object('en-US', 'Perf ' || i),
              'public', '[]'::jsonb, '{}'::jsonb, now() - (i || ' seconds')::interval, now()
         from generate_series(1, ?) as i`,
      [corpusSize],
    );
    await conn.execute(
      `insert into sales_channel_products (sales_channel_id, product_id)
       select ?, id from products where sku like 'PERF086-%'`,
      [channelId],
    );
    // The channel list prices the whole assortment; the organisation list
    // prices it too, and outranks it — the "one negotiated list per customer,
    // covering everything" shape, which is the one the owner has seen twice and
    // the one that shadows the branch below it completely.
    for (const [listId, offset] of [
      [CHANNEL_LIST, 1000],
      [ORG_LIST, 0],
    ] as const) {
      await conn.execute(
        `insert into price_list_products (price_list_id, product_id)
         select ?, id from products where sku like 'PERF086-%'`,
        [listId],
      );
      await conn.execute(
        `insert into price_list_price_brackets
           (price_list_id, product_id, currency_code, min_quantity, max_quantity, amount, created_at, updated_at)
         select ?, id, 'PLN', 1, null,
                ? + (('x' || substr(md5(id::text), 1, 6))::bit(24)::int % 100000) / 100.0, now(), now()
           from products where sku like 'PERF086-%'`,
        [listId, offset],
      );
      // A second and third quantity tier on 40% of the assignments, so the
      // partial index is genuinely partial and the `min_quantity = 1` predicate
      // is doing work.
      await conn.execute(
        `insert into price_list_price_brackets
           (price_list_id, product_id, currency_code, min_quantity, max_quantity, amount, created_at, updated_at)
         select ?, product_id, 'PLN', 10, null, amount * 0.9, now(), now()
           from price_list_price_brackets
          where price_list_id = ? and min_quantity = 1
            and ('x' || substr(md5(product_id::text), 1, 4))::bit(16)::int % 10 < 4`,
        [listId, listId],
      );
    }
    // `vacuum` sets the visibility map, which is what lets an index-only scan
    // report `Heap Fetches: 0` — the covering half of the covering index. A
    // freshly bulk-loaded table has no visibility map at all, so without this
    // the plan below reads as though the index were not covering.
    await conn.execute(`vacuum analyze price_list_price_brackets`);
    await conn.execute(`vacuum analyze products`);
  }, 20 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function explain(sql: string, params: unknown[]): Promise<string> {
    const rows = await h
      .em()
      .execute<PlanRow[]>(`explain (analyze, buffers, costs off) ${sql}`, params);
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  }

  function planTimeMs(plan: string): number {
    const match = /Execution Time: ([\d.]+) ms/.exec(plan);
    return match ? Number(match[1]) : Number.NaN;
  }

  /** The root node's buffer count — how much of the relation the plan touched. */
  function topBuffers(plan: string): number {
    const match = /Buffers: shared hit=(\d+)/.exec(plan);
    return match ? Number(match[1]) : Number.NaN;
  }

  const streams: UnitPriceStream[] = [
    { priceListId: ORG_LIST, isSale: false, productIds: null },
    { priceListId: CHANNEL_LIST, isSale: false, productIds: null },
  ];

  it('reports the storage cost of the partial index', async () => {
    const rows = await h.em().execute<Array<{ size: string; table: string; rows: string }>>(
      `select pg_size_pretty(pg_relation_size(?::regclass)) as size,
              pg_size_pretty(pg_relation_size('price_list_price_brackets')) as table,
              (select count(*)::text from price_list_price_brackets) as rows`,
      [UNIT_PRICE_AMOUNT_INDEX],
    );
    // eslint-disable-next-line no-console
    console.log(
      `[086/index] ${UNIT_PRICE_AMOUNT_INDEX} = ${rows[0]?.size} over a ${rows[0]?.table} table, ` +
        `${rows[0]?.rows} bracket rows (${corpusSize} products)`,
    );
    expect(rows[0]?.size).toBeTruthy();
  });

  it('finding 1 — a scalar subquery with its own limit, against `not exists`', async () => {
    // The mechanism, stated exactly: `not exists` is a sublink the planner may
    // pull up into a **hash anti-join**, and a hash anti-join has to finish
    // before one row can leave it. The scalar form with its own `limit 1`
    // cannot be pulled up, so the branch stays an index-only scan in amount
    // order and stops as soon as the page is full.
    //
    // The difference is therefore about **how much of the branch is read**, and
    // it shows on a partially shadowed branch — the ordinary case, where the
    // branch does contribute rows. On a *fully* shadowed branch the scalar form
    // probes every row and the anti-join does not, which is precisely what
    // finding 2's watermark exists to prevent; both scenarios are measured
    // below so the two mechanisms are not confused for one.
    //
    // Buffers are asserted, not milliseconds. The shape is scale-independent;
    // the clock is not, and a bench that asserted it would fail on somebody
    // else's laptop.
    const half = await h
      .em()
      .execute<Array<{ id: string }>>(
        `select id::text as id from products where sku like 'PERF086-%' order by sku limit ?`,
        [Math.floor(corpusSize / 2)],
      );
    const partiallyShadowed: UnitPriceStream[] = [
      { priceListId: ORG_LIST, isSale: false, productIds: half.map((r) => r.id) },
      { priceListId: CHANNEL_LIST, isSale: false, productIds: null },
    ];

    const lead = buildUnitPriceMergeQuery({
      streams: [streams[0]!],
      currencyCode: 'PLN',
      direction: 'asc',
      after: null,
      perStreamLimit: pageSize,
      watermark: null,
    });
    const leadRows = await h.em().execute<Array<{ amount: string }>>(lead.sql, lead.params);
    const watermark = leadRows[leadRows.length - 1]!.amount;

    const scenarios = [
      ['partially shadowed, unbounded', partiallyShadowed, null],
      ['fully shadowed, watermarked', streams, watermark],
    ] as const;

    for (const [label, scenarioStreams, mark] of scenarios) {
      const built = buildUnitPriceMergeQuery({
        streams: scenarioStreams,
        currencyCode: 'PLN',
        direction: 'asc',
        after: null,
        perStreamLimit: pageSize,
        watermark: mark,
        skipStreams: 1,
      });
      const antiJoinSql = built.sql.replace(
        /\(select 1 from "price_list_price_brackets" (x\d+)\s+where ([\s\S]*?)\s+limit 1\) is null/g,
        (_m, alias: string, where: string) =>
          `not exists (select 1 from "price_list_price_brackets" ${alias} where ${where})`,
      );
      expect(antiJoinSql).toContain('not exists');
      // Warm both, then measure: a first execution times the buffer cache.
      await explain(built.sql, built.params);
      await explain(antiJoinSql, built.params);
      const scalar = await explain(built.sql, built.params);
      const pulled = await explain(antiJoinSql, built.params);
      // eslint-disable-next-line no-console
      console.log(
        `[086/finding-1/${label}] scalar+limit=${planTimeMs(scalar).toFixed(2)}ms/${topBuffers(scalar)}buf ` +
          `not-exists=${planTimeMs(pulled).toFixed(2)}ms/${topBuffers(pulled)}buf\n` +
          `--- scalar ---\n${scalar}\n--- not exists ---\n${pulled}`,
      );
      // **What is asserted, and what is only recorded.**
      //
      // Asserted: the scalar form streams the branch out of the partial index in
      // amount order, in every scenario, and never materialises it. That is the
      // structural property, and it holds at every size.
      //
      // Recorded, not asserted: whether the planner *does* pull the sublink up
      // here. It is a cost decision, and at the size a test database holds it
      // frequently does not — measured on a 5 000-product corpus, the two forms
      // planned identically on a partially shadowed branch (230 buffers each),
      // and on a fully shadowed unbounded branch the anti-join was the cheaper
      // of the two (4.8 ms / 117 buffers against 22.0 ms / 10 057, because the
      // scalar form probes every excluded row while the anti-join hashes the
      // relation once). The design's 208 ms against 0.69 ms was measured on
      // 1 686 986 bracket rows, where materialising the branch is the rout and
      // hashing it is not free.
      //
      // So the reason to write the exclusion this way is the one that does not
      // depend on the planner agreeing: a scan that stops when the page is full
      // cannot be asked to read the whole relation first. And the fully-shadowed
      // case — the one where the scalar form's per-row probe is the expensive
      // half — is exactly what the watermark below removes, which is why the two
      // mechanisms are a pair rather than alternatives.
      expect(scalar, label).toContain('Index Only Scan');
      expect(scalar, label).not.toContain('Hash Anti Join');
      expect(scalar, label).not.toMatch(/Sort Method: external/);
    }
  });

  it('finding 2 — the watermark, against the same fully shadowed stream without it', async () => {
    // The organisation list prices everything, so the channel branch below it
    // yields nothing at all and discovers that by scanning. First read the
    // watermark the leading stream defines, exactly as the service does.
    const lead = buildUnitPriceMergeQuery({
      streams: [streams[0]!],
      currencyCode: 'PLN',
      direction: 'asc',
      after: null,
      perStreamLimit: pageSize,
      watermark: null,
    });
    const leadRows = await h
      .em()
      .execute<Array<{ amount: string }>>(lead.sql, lead.params);
    const watermark = leadRows[leadRows.length - 1]!.amount;

    const bounded = buildUnitPriceMergeQuery({
      streams,
      currencyCode: 'PLN',
      direction: 'asc',
      after: null,
      perStreamLimit: pageSize,
      watermark,
      skipStreams: 1,
    });
    const unbounded = buildUnitPriceMergeQuery({
      streams,
      currencyCode: 'PLN',
      direction: 'asc',
      after: null,
      perStreamLimit: pageSize,
      watermark: null,
      skipStreams: 1,
    });
    const withWatermark = await explain(bounded.sql, bounded.params);
    const without = await explain(unbounded.sql, unbounded.params);
    // eslint-disable-next-line no-console
    console.log(
      `[086/finding-2] watermark=${planTimeMs(withWatermark).toFixed(2)}ms ` +
        `unbounded=${planTimeMs(without).toFixed(2)}ms (watermark=${watermark})\n` +
        `--- bounded ---\n${withWatermark}\n--- unbounded ---\n${without}`,
    );
    expect(planTimeMs(withWatermark)).toBeLessThanOrEqual(planTimeMs(without));
  });

  it('finding 3 — the default planner chooses the streaming plan, with no session setting', async () => {
    const lead = buildUnitPriceMergeQuery({
      streams: [streams[0]!],
      currencyCode: 'PLN',
      direction: 'asc',
      after: null,
      perStreamLimit: pageSize,
      watermark: null,
    });
    const leadPlan = await explain(lead.sql, lead.params);
    // eslint-disable-next-line no-console
    console.log(`[086/finding-3] leading stream ${planTimeMs(leadPlan).toFixed(2)}ms\n${leadPlan}`);
    // The whole point: an index-only scan of the partial index, in amount
    // order, with no sort of the relation and no heap fetch per row.
    expect(leadPlan).toContain(UNIT_PRICE_AMOUNT_INDEX);
    expect(leadPlan).toContain('Index Only Scan');
    // The covering half: `product_id` is the index's fourth column, so the scan
    // needs no heap row at all (data-model.md's `Heap Fetches: 0`).
    expect(leadPlan).toContain('Heap Fetches: 0');
    expect(leadPlan).not.toContain('external merge');
    expect(leadPlan).not.toMatch(/Sort Method: (external|quicksort).*Disk/);
  });

  it('reads under 8× the page size in source rows for the first page', async () => {
    // SC-004 / FR-019, at whatever corpus this run was given.
    const before = performance.now();
    const chunk = await h.pricingService.orderByUnitPrice({
      context: {
        salesChannel: { id: channelId, defaultCurrency: 'PLN' },
        organization: { id: TEST_ORGANIZATION_ID },
      },
      direction: 'asc',
      after: null,
      limit: pageSize,
    });
    const ms = performance.now() - before;
    // eslint-disable-next-line no-console
    console.log(
      `[086/page] first page of ${pageSize} over ${corpusSize} products: ` +
        `${chunk.rows.length} rows, ${chunk.sourceRowsRead} source rows, ${ms.toFixed(2)}ms`,
    );
    expect(chunk.rows).toHaveLength(pageSize);
    expect(chunk.sourceRowsRead).toBeLessThan(8 * pageSize);
  });

  it('costs a full price-ordered HTTP page under the listing budget', async () => {
    const url = `/api/v1/catalog/products?limit=${pageSize}&sort=price`;
    const headers = { 'x-sales-channel': 'pl_retail' };
    for (let i = 0; i < 3; i += 1) await h.app.inject({ method: 'GET', url, headers });
    const samples: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      const res = await h.app.inject({ method: 'GET', url, headers });
      samples.push(performance.now() - start);
      expect(res.statusCode).toBe(200);
    }
    samples.sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(
      `[086/http] page=${pageSize} corpus=${corpusSize} ` +
        `p50=${samples[5]!.toFixed(1)}ms p95=${samples[9]!.toFixed(1)}ms`,
    );
    expect(samples[5]!).toBeLessThan(2000);
  });
});
