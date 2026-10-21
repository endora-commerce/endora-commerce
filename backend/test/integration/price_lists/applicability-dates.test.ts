import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-011, FR-047) — a book applies from `starts_at` and stops at
 * `ends_at`, evaluated at the request: no status sweep runs in between (the
 * harness never starts the sweeper), so the status a book carries is not what
 * decides the price.
 */
describe('price books — dates at read time', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T = Record<string, unknown>>(statement: string, params: unknown[] = []) =>
    h.em().getConnection().execute<T[]>(statement, params);
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a book scheduled to start applies from its start instant, with no sweep', async () => {
    const book = await f.book({
      audience: 'everyone',
      startsAt: new Date(Date.now() + 1500),
      rows: [{ product: f.products.P2, fixed: '48' }],
    });
    const [{ status }] = (await sql<{ status: string }>(`select "status" from "price_lists" where "id" = ?`, [book.id])) as [
      { status: string },
    ];
    expect(status).toBe('scheduled');
    expect(await f.amount('guest', f.products.P2)).toBe('50.0000');
    await pause(2000);
    expect(await f.amount('guest', f.products.P2)).toBe('48.0000');
    const [after] = await sql<{ status: string }>(`select "status" from "price_lists" where "id" = ?`, [book.id]);
    expect(after!.status).toBe('scheduled');
  });

  it('an active book stops at its end instant, with no sweep', async () => {
    const book = await f.book({
      audience: 'everyone',
      endsAt: new Date(Date.now() + 1500),
      rows: [{ product: f.products.P2, fixed: '48' }],
    });
    expect(await f.amount('guest', f.products.P2)).toBe('48.0000');
    await pause(2000);
    expect(await f.amount('guest', f.products.P2)).toBe('50.0000');
    const [after] = await sql<{ status: string }>(`select "status" from "price_lists" where "id" = ?`, [book.id]);
    expect(after!.status).toBe('active');
  });

  it('a draft or an expired book never applies, whatever its dates', async () => {
    const book = await f.book({ audience: 'everyone', rows: [{ product: f.products.P2, fixed: '48' }] });
    await sql(`update "price_lists" set "status" = 'expired' where "id" = ?`, [book.id]);
    expect(await f.amount('guest', f.products.P2)).toBe('50.0000');
    await sql(`update "price_lists" set "status" = 'draft' where "id" = ?`, [book.id]);
    expect(await f.amount('guest', f.products.P2)).toBe('50.0000');
  });
});
