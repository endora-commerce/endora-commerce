import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160 (FR-009, data-model §1) — exactly one base book per currency,
 * channel-independent. Replaces `system-price-list-singleton.test.ts` (issue
 * #50's one-system-list rule), whose singleton the per-currency base books
 * superseded.
 *
 * - A base-price write creates its currency's base book on first use and
 *   reuses it after; the platform default currency's book keeps the id the old
 *   `Default` list had (`…d51b`).
 * - The database refuses a second system book in one currency.
 * - A base book is bound to no channel and prices on every channel that offers
 *   its currency.
 */
const DEFAULT_BOOK_ID = '00000000-0000-4000-8000-00000000d51b';

describe('price_lists — one base book per currency (feature 160)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const sql = <T = Record<string, unknown>>(statement: string, params: unknown[] = []) =>
    h.em().getConnection().execute<T[]>(statement, params);

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('the platform default currency’s base book exists after a base-price write and keeps the …d51b id', async () => {
    const [channel] = await sql<{ default_currency: string }>(
      `select "default_currency" from "sales_channels" where "system_default" = true`,
    );
    const books = await sql<{ id: string; currency_code: string; type: string; audience_kind: string; status: string }>(
      `select "id", "currency_code", "type", "audience_kind", "status" from "price_lists"
        where "is_system" = true and "currency_code" = ?`,
      [channel!.default_currency],
    );
    expect(books).toHaveLength(1);
    expect(books[0]!.id).toBe(DEFAULT_BOOK_ID);
    expect(books[0]).toMatchObject({ audience_kind: 'everyone', status: 'active' });
  });

  it('a write in another currency creates that currency’s base book once, and reuses it', async () => {
    await f.setBase(f.products.P2, { product: [{ minQuantity: 1, maxQuantity: null, amount: '12.5' }], variants: {} }, 'EUR');
    await f.setBase(f.products.P3, { product: [{ minQuantity: 1, maxQuantity: null, amount: '7' }], variants: {} }, 'EUR');
    const eur = await sql<{ id: string }>(`select "id" from "price_lists" where "is_system" = true and "currency_code" = 'EUR'`);
    expect(eur).toHaveLength(1);
    expect(eur[0]!.id).not.toBe(DEFAULT_BOOK_ID);
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH3 })).toBe('12.5000');
    expect(await f.amount('guest', f.products.P3, { channel: f.channels.CH2, currency: 'EUR' })).toBe('7.0000');
  });

  it('the database refuses a second system book in one currency', async () => {
    await expect(
      sql(
        `insert into "price_lists" ("id", "name", "currency_code", "priority", "type", "status",
                                    "audience_kind", "is_system", "created_at", "updated_at")
         values (gen_random_uuid(), 'Second', 'PLN', 0, 'regular', 'active', 'everyone', true, now(), now())`,
      ),
    ).rejects.toThrow(/price_lists_system_currency_unique/);
  });

  it('a base book is bound to no channel, and prices on every channel offering its currency', async () => {
    const bound = await sql(
      `select 1 from "sales_channel_price_lists" b join "price_lists" l on l."id" = b."price_list_id" where l."is_system" = true`,
    );
    expect(bound).toHaveLength(0);
    for (const channel of [f.channels.CH1, f.channels.CH2]) {
      expect(await f.amount('guest', f.products.P1, { channel })).toBe('100.0000');
    }
  });

  it('a base-price write replaces only that product’s rows in that currency', async () => {
    await f.setBase(f.products.P1, { product: [{ minQuantity: 1, maxQuantity: null, amount: '101' }], variants: {} });
    expect(await f.amount('guest', f.products.P1)).toBe('101.0000');
    expect(await f.amount('guest', f.products.P2)).toBe('50.0000');
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH3 })).toBe('12.5000');
  });
});
