// perf-weight: heavy — about 2 min locally at the reference volume (2026-10-16, mostly the 250 000-row corpus); not yet timed on the CI runner.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminSearchProvider } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { providerQuery, searchAsPlatform } from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` SC-002 (T053) — a seven-type fan-out at the
 * spec's reference volume answers in under 800 ms at the 95th percentile.
 *
 * Corpus (× `PERF_CORPUS_SIZE`, default 1 — the reference volume): 100 000
 * orders, 20 000 quote requests, 20 000 opportunities, 10 000 organizations,
 * 50 000 customers, 50 000 products, 2 000 categories, written with
 * `generate_series` and then `analyze`d. Three texts, each timed over
 * `PERF_ITERATIONS` full fan-outs through `GET /api/v1/admin/global-search` as
 * the platform administrator with the default configuration:
 *
 *   - an identifier fragment that every numbered type contains (`-1234`
 *     inside order numbers, quote request numbers, opportunity numbers, SKUs);
 *   - a name fragment that names 111 organizations — the organization-name
 *     field then widens Orders, Quote Requests and Opportunities to their
 *     orders through the owners' id lookups;
 *   - a text nothing matches, which is the full scan of every selected column.
 *
 * Then each provider alone, for the no-match text, so the output says which
 * one is the slowest, and `explain (analyze, buffers)` of the order provider's
 * statement — the largest table — for the record (research R-10: trigram
 * indexes are the per-owner follow-up if this ever fails, not this feature).
 *
 * Measured 2026-10-16 on a 16-core Linux dev box, Postgres 16 in Docker, at
 * the reference volume, p95 of the full fan-out: identifier fragment 255 ms,
 * name fragment 291 ms, no match 240 ms — every table a sequential scan
 * bounded by `limit + 1`, no index added. Alone, for the no-match text: orders
 * 196 ms (the slowest; its plan is a seq scan of 100 000 rows, 84 ms of it the
 * scan itself), products 182, quote requests 125, customers 106, opportunities
 * 28, organizations 15, categories 7.
 *
 * Tuning knobs (env):
 *   PERF_CORPUS_SIZE   — multiplier of the reference volume (default 1)
 *   PERF_ITERATIONS    — fan-outs per text (default 20)
 *   PERF_GLOBAL_SEARCH_P95_MS — budget (default 800, SC-002)
 *   PERF_RUN           — set to 'true' to run; otherwise the suite skips.
 */

const scale = Number(process.env['PERF_CORPUS_SIZE'] ?? '1');
const iterations = Number(process.env['PERF_ITERATIONS'] ?? '20');
const budget = Number(process.env['PERF_GLOBAL_SEARCH_P95_MS'] ?? '800');
const shouldRun = process.env['PERF_RUN'] === 'true';
const n = (reference: number) => Math.max(10, Math.round(reference * scale));

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)] ?? 0;
}

describe.skipIf(!shouldRun)('admin global search — seven-type fan-out at the reference volume (SC-002)', () => {
  let h: BackendServerHandle;
  const stamp = String(Date.now()).slice(-7);
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    const db = h.em().getConnection();
    const orgs = n(10_000);
    const org = (expr: string) => `md5('gsb-org-${stamp}-' || ((${expr}) % ${orgs} + 1))::uuid`;
    const customers = n(50_000);
    const customer = (expr: string) => `md5('gsb-cus-${stamp}-' || ((${expr}) % ${customers} + 1))::uuid`;

    await db.execute(
      `insert into organizations (id, name, name_search, tax_id, status, vat_status, registered_address, created_at, updated_at)
       select md5('gsb-org-${stamp}-' || g)::uuid, 'Bench Org ' || g, 'bench org ' || g, 'BT${stamp}' || g, 'active',
              'vat_payer', '{"street":"x","city":"Kraków","postalCode":"30-001","country":"PL"}'::jsonb, now(), now()
         from generate_series(1, ${orgs}) g`,
    );
    await db.execute(
      `insert into customer_accounts (id, organization_id, email, password_hash, first_name, last_name, created_at, updated_at)
       select md5('gsb-cus-${stamp}-' || g)::uuid, ${org('g')}, 'bench' || g || '-${stamp}@example.com', 'x', 'Bench',
              'Customer ' || g, now(), now()
         from generate_series(1, ${customers}) g`,
    );
    await db.execute(
      `insert into orders (id, business_id, organization_id, placed_by_customer_account_id, sales_channel_id, status,
                           payment_status, delivery_address, billing_address, delivery_method_id, delivery_method_snapshot,
                           payment_method_id, payment_method_snapshot, subtotal, tax_total, delivery_total, total, currency,
                           placed_at, created_at, updated_at)
       select gen_random_uuid(), 'ZB${stamp}-' || g, ${org('g')}, ${customer('g')}, '00000000-0000-4000-8000-0000000000c1',
              'new', 'awaiting_payment',
              '{"recipientName":"B","street":"x","city":"Kraków","postalCode":"30-001","country":"PL"}'::jsonb,
              '{"recipientName":"B","street":"x","city":"Kraków","postalCode":"30-001","country":"PL","companyName":"Bench Co","taxId":"PL1"}'::jsonb,
              '${SEED_DELIVERY_METHOD_ID}', '{"code":"p","name":"P","cost":0}'::jsonb,
              '${SEED_PAYMENT_METHOD_ID}', '{"code":"b","name":"B","kind":"bank_transfer"}'::jsonb,
              10, 2.3, 0, 12.3, 'PLN', now(), now(), now() - (g || ' seconds')::interval
         from generate_series(1, ${n(100_000)}) g`,
    );
    await db.execute(
      `insert into quote_requests (id, business_id, organization_id, customer_account_id, status, created_at, updated_at)
       select gen_random_uuid(), 'QB${stamp}-' || g, ${org('g')}, ${customer('g')}, 'Pending', now(), now()
         from generate_series(1, ${n(20_000)}) g`,
    );
    await db.execute(
      `insert into crm_opportunities (id, number, title, organization_id, status_code, currency, created_at, updated_at)
       select gen_random_uuid(), 'OB${stamp}-' || g, 'Bench deal ' || g, ${org('g')}, 'new', 'PLN', now(), now()
         from generate_series(1, ${n(20_000)}) g`,
    );
    await db.execute(
      `insert into products (id, sku, slug, type, status, name, description, visibility, attribute_values, created_at, updated_at)
       select gen_random_uuid(), 'PB${stamp}-' || g, 'pb-${stamp}-' || g, 'simple', 'active',
              'Bench product ' || g, '',
              'public', '{}'::jsonb, now(), now()
         from generate_series(1, ${n(50_000)}) g`,
    );
    await db.execute(
      `insert into categories (id, name, slug, created_at, updated_at)
       select gen_random_uuid(), jsonb_build_object('en-US', 'Bench category ' || g), 'cb-${stamp}-' || g, now(), now()
         from generate_series(1, ${n(2_000)}) g`,
    );
    await db.execute(
      'analyze organizations, customer_accounts, orders, quote_requests, crm_opportunities, products, categories',
    );
  }, 15 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function fanOut(q: string): Promise<{ groups: number; failed: number }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/global-search?q=${encodeURIComponent(q)}&language=en`,
      cookies: admin,
    });
    expect(res.statusCode).toBe(200);
    const groups = (res.json() as { data: { groups: Array<{ status: string }> } }).data.groups;
    return { groups: groups.length, failed: groups.filter((g) => g.status !== 'ok').length };
  }

  it.each([
    ['identifier fragment', '-1234'],
    ['name fragment', 'Bench Org 12'],
    ['no match', 'zq-nothing-xw'],
  ])('a fan-out for an %s answers within the budget', async (label, text) => {
    for (let i = 0; i < 3; i += 1) await fanOut(text);
    const samples: number[] = [];
    let last = { groups: 0, failed: 0 };
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      last = await fanOut(text);
      samples.push(performance.now() - start);
    }
    const value = p95(samples);
    // eslint-disable-next-line no-console
    console.log(
      `[perf/global-search] ${label} scale=${scale} iterations=${iterations} groups=${last.groups} ` +
        `unavailable=${last.failed} p95=${value.toFixed(1)}ms budget=${budget}ms`,
    );
    expect(last.failed).toBe(0);
    expect(value).toBeLessThan(budget);
  });

  it('reports each provider alone and the order statement plan', async () => {
    const providers = (h.container.resolve('adminSearchProviderRegistry') as { all(): AdminSearchProvider[] }).all();
    for (const provider of providers) {
      const fields = provider.fields.filter((f) => f.defaultSelected).map((f) => f.code);
      const samples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const start = performance.now();
        await searchAsPlatform(provider, providerQuery('zq-nothing-xw', fields));
        samples.push(performance.now() - start);
      }
      // eslint-disable-next-line no-console
      console.log(`[perf/global-search] provider ${provider.entityType} no-match p95=${p95(samples).toFixed(1)}ms`);
    }
    const plan = (await h
      .em()
      .getConnection()
      .execute(
        `explain (analyze, buffers) select "id" from "orders" where ("business_id" ilike ?)
          order by case when lower("business_id") = lower(?) then 0 when "business_id" ilike ? then 1 else 2 end,
                   "updated_at" desc, "id" asc limit 6`,
        ['%zq-nothing-xw%', 'zq-nothing-xw', 'zq-nothing-xw%'],
      )) as Array<Record<string, string>>;
    // eslint-disable-next-line no-console
    console.log(`[perf/global-search] orders plan:\n${plan.map((row) => Object.values(row)[0]).join('\n')}`);
  });
});
