import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { seedBulkProductsSql, seedEmptyBookSql, seedProductTiersSql } from '../../helpers/price-book-bulk.js';

/**
 * Feature 161, G15 (Checkpoint 2b follow-up) — the lines read fetches the rows
 * of the ~100 product lines on its page, and that read must cost the page, not
 * the book, **whatever the statistics**. Right after a bulk import (no
 * `ANALYZE`, no visibility map) the planner estimated a 125 000-row book at 86
 * rows and filtered every row of it with only `price_list_id` as the index
 * condition: 27–40 ms instead of 0.5 ms.
 *
 * So the page's product rows are read through a `LATERAL` per id (fenced, so it
 * is not flattened into a join): each probe is an index lookup on
 * `(price_list_id, product_id)`. This test captures the statement the read
 * issues on a never-analysed book and runs `EXPLAIN (ANALYZE,
 * FORMAT JSON)` on it: every scan of `price_list_matrix_entries` must have an
 * index condition naming `product_id` and read at most a few hundred rows.
 *
 * The book is 3 000 lines × 4 tiers (12 000 rows): twelve times the 1 000-row
 * ceiling, so a plan that filters the book instead of probing it still fails,
 * and seeded in seconds rather than the half-minute 30 000 lines cost. The
 * 50 000-line scale is `backend/test/perf/price_lists/book-lines-page.bench.ts`'s.
 */
describe('price-book lines — the page-rows read is an index lookup on unanalysed data (161 G15)', () => {
  let h: BackendServerHandle;
  let api: ApiClient;
  let book: string;

  type PlanNode = { 'Node Type': string; 'Relation Name'?: string; 'Index Cond'?: string; 'Actual Rows'?: number; 'Actual Loops'?: number; Plans?: PlanNode[] };
  const scans = (node: PlanNode, out: PlanNode[] = []): PlanNode[] => {
    if (node['Relation Name'] === 'price_list_matrix_entries') out.push(node);
    for (const child of node.Plans ?? []) scans(child, out);
    return out;
  };
  const bitmapChildren = (node: PlanNode, out: PlanNode[] = []): PlanNode[] => {
    if (node['Node Type'] === 'Bitmap Index Scan') out.push(node);
    for (const child of node.Plans ?? []) bitmapChildren(child, out);
    return out;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    api = priceBookApi(h);
    const em = h.em();
    for (const table of ['products', 'price_list_matrix_entries', 'price_list_product_lines']) {
      await em.getConnection().execute(`alter table "${table}" set (autovacuum_enabled = false)`);
    }
    const products = await seedBulkProductsSql(em, { count: 3_000, namePrefix: 'Rows plan', skuPrefix: 'G15R' });
    book = await seedEmptyBookSql(em, 'G15 rows plan');
    await seedProductTiersSql(em, book, products, 4);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reads the page’s rows by (price_list_id, product_id), not by filtering the book', async () => {
    const conn = h.em().getConnection() as unknown as { execute: (...args: unknown[]) => Promise<unknown> };
    const original = conn.execute.bind(conn);
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    conn.execute = (...args: unknown[]) => {
      seen.push({ sql: String(args[0]), params: (args[1] as unknown[]) ?? [] });
      return original(...args);
    };
    try {
      const res = await api.get(`/api/v1/admin/price-books/${book}/lines?lang=en&pageSize=100&page=15`);
      expect(res.status, res.raw).toBe(200);
    } finally {
      conn.execute = original;
    }
    const read = seen.find(({ sql }) => /from "price_list_matrix_entries"/.test(sql) && /order by e\."min_quantity"/.test(sql));
    expect(read, 'the page-rows read was issued').toBeDefined();
    const explained = (await h.em().getConnection().execute(`explain (analyze, format json) ${read!.sql}`, read!.params)) as Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>;
    const plan = explained[0]!['QUERY PLAN'][0]!.Plan;
    const onRows = scans(plan);
    expect(onRows.length).toBeGreaterThan(0);
    for (const node of onRows) {
      const cond = node['Index Cond'] ?? bitmapChildren(node).map((b) => b['Index Cond'] ?? '').join(' ');
      expect(cond, JSON.stringify(node).slice(0, 400)).toMatch(/product_id/);
    }
    const rowsRead = (node: PlanNode): number => (node['Actual Rows'] ?? 0) * (node['Actual Loops'] ?? 1);
    for (const node of [...onRows, ...onRows.flatMap((n) => bitmapChildren(n))]) {
      expect(rowsRead(node), `${node['Node Type']} read ${rowsRead(node)} rows`).toBeLessThanOrEqual(1000);
    }
  });
});
