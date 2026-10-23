import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { settlePriceSurface } from '../../helpers/price-surface.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (`contracts/price-surface.md` §2–§4) — the surface's own reads
 * are index probes **whatever the statistics**. Measured 2026-10-23 on the
 * SC-005 fixture: `price_profile_prices` analysed while empty (the bench's
 * `analyze` before the first build, and a fresh install's), then filled by a
 * build; the coverage check of an all-products buyer surface was planned as a
 * nested-loop anti join filtering every buyer row per everyone row — 428 s
 * for 50 000 × 50 000 rows, on the first page that buyer asked for.
 *
 * A first repair — a scalar `limit 1` probe per everyone row — still took
 * 47 s there: with no statistics the planner served the probe from the
 * ordering index `(profile, generation, amount, product)`, a range scan of the
 * whole buyer surface per probe. So:
 *
 * - the coverage check reads each surface's product ids by itself (one index
 *   range each) and compares them in memory — no statement joins two
 *   surfaces' rows, so no plan can make it quadratic;
 * - a whole build that writes a large share of `price_profile_prices` (or the
 *   first into a table with no statistics) analyses it inside its own
 *   transaction, so the statistics arrive with the rows they describe and the
 *   page statements' probes are planned on them.
 *
 * This file runs the statements against tables whose statistics say "empty"
 * and asserts, on `EXPLAIN (ANALYZE, FORMAT JSON)`, that no join over
 * `price_profile_prices` or `price_profile_stale_products` filters on a
 * product or profile it could have looked up, that the rows read stay
 * proportional to the rows probed, and that a build left statistics behind.
 */
describe('price surface — its statements probe by index on unanalysed tables', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);

  type PlanNode = {
    'Node Type': string;
    'Relation Name'?: string;
    'Join Filter'?: string;
    Filter?: string;
    'Actual Rows'?: number;
    'Actual Loops'?: number;
    Plans?: PlanNode[];
  };
  const nodes = (node: PlanNode, out: PlanNode[] = []): PlanNode[] => {
    out.push(node);
    for (const child of node.Plans ?? []) nodes(child, out);
    return out;
  };
  const SURFACE = new Set(['price_profile_prices', 'price_profile_stale_products']);

  /** Every statement `run` issues that matches `pattern`, with its parameters. */
  async function captured(pattern: RegExp, run: () => Promise<unknown>): Promise<Array<{ sql: string; params: unknown[] }>> {
    const conn = h.em().getConnection() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = conn.execute.bind(conn);
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    conn.execute = (...args: unknown[]) => {
      if (pattern.test(String(args[0]))) seen.push({ sql: String(args[0]), params: (args[1] as unknown[]) ?? [] });
      return original(...args);
    };
    try {
      await run();
    } finally {
      conn.execute = original;
    }
    return seen;
  }

  async function expectProbes(statement: { sql: string; params: unknown[] }, label: string, probedRows: number): Promise<void> {
    const [explained] = (await sql<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>(
      `explain (analyze, format json) ${statement.sql}`,
      statement.params,
    )) as [{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }];
    const all = nodes(explained['QUERY PLAN'][0]!.Plan);
    for (const node of all) {
      const joinsSurface = (node.Plans ?? []).some((child) => nodes(child).some((n) => SURFACE.has(n['Relation Name'] ?? '')));
      if (joinsSurface && node['Join Filter']) {
        expect(node['Join Filter'], `${label}: a join filtering surface rows (${node['Node Type']})`).not.toMatch(/product_id|profile_id/);
      }
    }
    const read = all
      .filter((n) => SURFACE.has(n['Relation Name'] ?? ''))
      .reduce((sum, n) => sum + (n['Actual Rows'] ?? 0) * (n['Actual Loops'] ?? 1), 0);
    // A probe reads the probed row and one indexed row for it; a filtering join reads the product.
    expect(read, `${label}: surface rows read`).toBeLessThanOrEqual(2 * probedRows + 2);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    // Acme's book holds an all-products percentage: its surface covers the everyone one.
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-2' }, { product: f.products.P2, fixed: '40' }] });
    // Statistics that say "nearly empty", and no autovacuum to correct them under the test.
    await sql(`delete from "price_profiles" where "sales_channel_id" = any(?::uuid[])`, [
      `{${Object.values(f.channels).map((c) => c.id).join(',')}}`,
    ]);
    for (const table of ['price_profile_prices', 'price_profile_stale_products', 'price_profiles']) {
      await sql(`alter table "${table}" set (autovacuum_enabled = false)`);
      await sql(`analyze "${table}"`);
    }
    for (const organization of [undefined, f.orgs.Acme]) {
      await f.pricing.orderByUnitPrice({
        context: { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, ...(organization ? { organization } : {}) },
        direction: 'asc',
        after: null,
        limit: 1,
      });
    }
    await settlePriceSurface(h);
  }, 5 * 60_000);

  afterAll(async () => {
    for (const table of ['price_profile_prices', 'price_profile_stale_products', 'price_profiles']) {
      await sql(`alter table "${table}" reset (autovacuum_enabled)`);
    }
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  const everyoneRows = async () =>
    Number(
      (
        (await sql<{ n: number }>(
          `select count(*)::int as n from "price_profile_prices" p join "price_profiles" f on f."id" = p."profile_id"
            where f."sales_channel_id" = ? and jsonb_array_length(f."book_vector") = 0`,
          [f.channels.CH1.id],
        )) as [{ n: number }]
      )[0].n,
    );

  it('a whole build into a table with no statistics leaves statistics behind', async () => {
    const [{ reltuples }] = (await sql<{ reltuples: number }>(
      `select "reltuples"::float8 as "reltuples" from "pg_class" where "relname" = 'price_profile_prices'`,
    )) as [{ reltuples: number }];
    expect(reltuples, 'price_profile_prices analysed by the build').toBeGreaterThan(0);
  });

  it('the coverage check of a buyer surface holding every product joins no two surfaces', async () => {
    const statements = await captured(/"price_profile_prices"/, () =>
      f.pricing.orderByUnitPrice({
        context: { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' }, organization: f.orgs.Acme },
        direction: 'desc',
        after: null,
        limit: 2,
      }),
    );
    expect(statements.length, 'the page read the surface').toBeGreaterThan(0);
    // Every statement of the page: no join filtering surface rows, rows read in proportion.
    for (const statement of statements) await expectProbes(statement, 'page', await everyoneRows());
    // The coverage reads name one surface each.
    const coverage = statements.filter((st) => /as "coverage"/.test(st.sql));
    expect(coverage.length, 'the coverage check ran').toBe(2);
    for (const st of coverage) expect(st.sql.match(/"price_profile_prices"/g)?.length, st.sql).toBe(1);
  });

  it('the marking’s read of the rows the buyer surfaces hold, and the worker’s read of its work', async () => {
    const held = await captured(/from "price_profile_prices" pp/, () =>
      f.setBase(f.products.P1, { product: [{ minQuantity: 1, maxQuantity: null, amount: '101' }], variants: {} }),
    );
    expect(held.length, 'the held-rows read ran').toBeGreaterThan(0);
    await expectProbes(held[0]!, 'held rows', 2);
    const due = await captured(/from "price_profiles" f\s+where f\."state" = 'building'/, () => settlePriceSurface(h));
    expect(due.length, 'the pass read its work').toBeGreaterThan(0);
    await expectProbes(due[0]!, 'due work', 10);
  });
});
