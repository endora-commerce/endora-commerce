import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type PriceBookWritePort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';

/**
 * Feature 160, FR-049 (owner ruling 2026-10-22; `contracts/price-book-write-port.md`) — the
 * in-process port that replaces the removed `priceListAdminPort` for the PIM connectors' price
 * import. It writes through the admin API's own base-price command, so what it writes is what
 * every surface charges, it is refused for the admin API's reasons, and it tells the caches after
 * the commit.
 */
describe('price_lists — priceBookWritePort (FR-049)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let port: PriceBookWritePort;
  const sql = <T>(statement: string, params: unknown[] = []) => h.em().getConnection().execute<T[]>(statement, params);
  const tiers = (...t: Array<[number, number | null, string]>) =>
    t.map(([minQuantity, maxQuantity, amount]) => ({ minQuantity, maxQuantity, amount }));

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    port = (h.container as unknown as { resolve<T>(name: string): T }).resolve<PriceBookWritePort>('priceBookWritePort');
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
    await f.resetBase();
    await sql(`delete from "price_lists" where "is_system" = true and "currency_code" = 'CHF'`);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a product written through the port is charged its tiers, by the batch and the single resolution alike', async () => {
    const answer = await f.system(() => port.replaceProductBaseTiers(f.products.P1.id, { PLN: tiers([1, 9, '100.0000'], [10, null, '90.0000']) }));
    expect(answer.byCurrency['PLN']!.product).toEqual(tiers([1, 9, '100.0000'], [10, null, '90.0000']));
    expect((await port.basePrices(f.products.P1.id)).byCurrency['PLN']!.product).toEqual(answer.byCurrency['PLN']!.product);

    const context = { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } };
    const batch = await f.pricing.resolveLinePrices({
      lines: [
        { key: 'q1', product: f.products.P1, quantity: 1 },
        { key: 'q10', product: f.products.P1, quantity: 10 },
      ],
      context,
    });
    expect(batch.get('q1')).toMatchObject({ amount: '100.0000', isSale: false });
    expect(batch.get('q10')).toMatchObject({ amount: '90.0000' });
    for (const [key, quantity] of [['q1', 1], ['q10', 10]] as const) {
      const single = await f.pricing.resolveLinePrice({ product: f.products.P1, context: { ...context, quantity } });
      expect(single, key).toEqual(batch.get(key));
    }
  });

  it('tells the caches once per write, after the commit', async () => {
    const generation = (h.container as unknown as { resolve<T>(name: string): T }).resolve<{
      handle: { pricingGeneration: { invalidateAll(): void | Promise<void> } };
    }>('priceLists').handle.pricingGeneration;
    const original = generation.invalidateAll.bind(generation);
    const seen: string[] = [];
    generation.invalidateAll = async () => {
      // Read on a connection of its own: the write must already be committed.
      const [row] = await h
        .orm.em.fork()
        .getConnection()
        .execute<Array<{ amount: string }>>(
          `select e."amount" from "price_list_matrix_entries" e join "price_lists" b on b."id" = e."price_list_id" and b."is_system"
            where e."product_id" = ? and e."variant_id" is null and b."currency_code" = 'PLN' and e."min_quantity" = 1`,
          [f.products.P2.id],
        );
      seen.push(Number(row?.amount).toFixed(2));
      return original();
    };
    try {
      await f.system(() => port.replaceProductBaseTiers(f.products.P2.id, { PLN: tiers([1, null, '61.0000']) }));
    } finally {
      generation.invalidateAll = original;
    }
    expect(seen).toEqual(['61.00']);
  });

  it('refuses what the admin API refuses, and writes nothing', async () => {
    const before = await port.basePrices(f.products.P1.id);
    await expect(
      f.system(() => port.replaceProductBaseTiers(f.products.P1.id, { PLN: tiers([1, 5, '10.0000'], [3, null, '9.0000']) })),
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.VALIDATION_FAILED });
    await expect(
      f.system(() => port.replaceProductBaseTiers(f.products.P1.id, { PLN: tiers([1, null, '-1.0000']) })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      f.system(() => port.replaceProductBaseTiers('00000000-0000-4000-8000-0000000fffff', { PLN: tiers([1, null, '1.0000']) })),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(await port.basePrices(f.products.P1.id)).toEqual(before);
  });

  it('keeps the variants’ base rows when it replaces the product tiers, and refuses to orphan an adjustment', async () => {
    await f.system(() => port.replaceProductBaseTiers(f.products.P5.id, { PLN: tiers([1, null, '200.0000']) }));
    const prices = await port.basePrices(f.products.P5.id);
    expect(prices.byCurrency['PLN']!.variants[f.variants.P5r]).toEqual({ type: 'percent', percent: '10.00' });
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5r })).toBe('220.0000');
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5b })).toBe('200.0000');
    // P5r's +10 % needs the product's own base price in PLN.
    await expect(
      f.system(() => port.replaceProductBaseTiers(f.products.P5.id, { PLN: [] })),
    ).rejects.toMatchObject({ statusCode: 400, code: ERROR_CODES.VALIDATION_FAILED });
    expect((await port.basePrices(f.products.P5.id)).byCurrency['PLN']!.product).toEqual(tiers([1, null, '200.0000']));
  });

  it('replaceBasePrices is the admin base-price write: product and variant rows together', async () => {
    const answer = await f.system(() =>
      port.replaceBasePrices(f.products.P5.id, { byCurrency: { PLN: { product: tiers([1, null, '70.0000']), variants: {} } } }),
    );
    expect(answer.byCurrency['PLN']!.variants[f.variants.P5r]).toBeNull();
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5r })).toBe('70.0000');
  });

  it('a currency with no base book gets one, in the same command, as the admin write does', async () => {
    expect(await sql(`select 1 from "price_lists" where "is_system" and "currency_code" = 'CHF'`)).toEqual([]);
    const answer = await f.system(() => port.replaceProductBaseTiers(f.products.P3.id, { chf: tiers([1, null, '12.0000']) }));
    expect(answer.byCurrency['CHF']!.product).toEqual(tiers([1, null, '12.0000']));
    expect(await sql(`select 1 from "price_lists" where "is_system" and "currency_code" = 'CHF'`)).toHaveLength(1);
  });

  it('lists the books pricing a product directly — the admin product-editor list (G1)', async () => {
    const book = await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '77' }] });
    const listed = await port.booksPricingProduct(f.products.P1.id);
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/price-books?productId=${f.products.P1.id}&pageSize=100`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const admin = (res.json() as { data: unknown[] }).data;
    expect(listed).toEqual(admin);
    expect(listed.map((b) => b.id)).toContain(book.id);
  });
});
