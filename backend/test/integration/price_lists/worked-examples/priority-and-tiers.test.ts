import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture, type RowSpec } from '../../../helpers/pricing-fixture.js';

/**
 * Feature 160, US2 — priority between books defining the same cell, quantity
 * tiers and fall-through, surcharges and free lines
 * (`specs/pricing/worked-examples.md` §10.7, §10.8, §10.13; FR-014, FR-045).
 */
describe('worked examples — priority, quantity tiers, U2.1, U4', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const acme = () => ({ organization: f.orgs.Acme });

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
  }, 5 * 60_000);

  afterEach(async () => {
    await f.clearBooks();
    await f.resetBase();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** E3's L4 (L3 is irrelevant to Acme's P1 here). */
  const l4 = (rows: RowSpec[] = [{ product: f.products.P1, percent: '-5' }, { category: f.categories.screws, percent: '-15' }]) =>
    f.book({ name: 'L4', audience: { organizations: [f.orgs.Acme] }, rows });

  it('T1 — a higher-priority book defining the same cell wins, even when higher', async () => {
    await l4();
    await f.book({ name: 'L6', priority: 10, audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, fixed: '97' }] });
    expect(await f.amount(acme(), f.products.P1)).toBe('97.0000');
  });

  it('T2 — equal priority and starting quantity: the lower amount', async () => {
    await l4();
    await f.book({ name: 'L6', priority: 0, audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, fixed: '97' }] });
    expect(await f.amount(acme(), f.products.P1)).toBe('95.0000');
  });

  it('T3 — a better cell beats a higher priority', async () => {
    await l4();
    await f.book({ name: 'L6', priority: 10, audience: { organizations: [f.orgs.Acme] }, rows: [{ category: f.categories.screws, fixed: '97' }] });
    expect(await f.amount(acme(), f.products.P1)).toBe('95.0000');
  });

  it('FR-045 — renaming a book or editing a non-winning row never changes the winner', async () => {
    const winner = await l4();
    const loser = await f.book({ name: 'L6', audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, fixed: '97' }] });
    expect(await f.price(acme(), f.products.P1)).toMatchObject({ amount: '95.0000', priceListId: winner.id });
    await h
      .em()
      .getConnection()
      .execute(`update "price_lists" set "name" = 'AAA renamed', "updated_at" = now() + interval '1 day' where "id" = ?`, [loser.id]);
    expect(await f.price(acme(), f.products.P1)).toMatchObject({ amount: '95.0000', priceListId: winner.id });
    await f.system(() =>
      f.books.replaceRows(loser.id, {
        upsert: [{ id: loser.rowIds[0]!, selection: { productId: f.products.P1.id }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '96' } }],
        delete: [],
      }),
    );
    expect(await f.price(acme(), f.products.P1)).toMatchObject({ amount: '95.0000', priceListId: winner.id });
  });

  describe('§10.8 — quantity tiers (base P1 1–9: 100, 10+: 90)', () => {
    const tieredBase = () =>
      f.setBase(f.products.P1, {
        product: [
          { minQuantity: 1, maxQuantity: 9, amount: '100' },
          { minQuantity: 10, maxQuantity: null, amount: '90' },
        ],
        variants: {},
      });

    it('Q1 — the percentage is off the catalogue price at the line’s quantity', async () => {
      await tieredBase();
      await l4([{ product: f.products.P1, percent: '-5' }]);
      expect(await f.amount(acme(), f.products.P1, { quantity: 10 })).toBe('85.5000');
    });

    it('Q2 — the tier covering the quantity', async () => {
      await tieredBase();
      await l4([
        { product: f.products.P1, percent: '-5', max: 99 },
        { product: f.products.P1, percent: '-8', min: 100 },
      ]);
      const line = await f.price(acme(), f.products.P1, { quantity: 100 });
      expect(line).toMatchObject({ amount: '82.8000', bracketStartQuantity: 100 });
    });

    it('Q3, Q3b — a row that does not cover the quantity falls through to the next', async () => {
      await tieredBase();
      await l4([
        { product: f.products.P1, fixed: '70', min: 100 },
        { category: f.categories.screws, percent: '-15' },
      ]);
      expect(await f.amount(acme(), f.products.P1, { quantity: 50 })).toBe('76.5000');
      expect(await f.amount(acme(), f.products.P1, { quantity: 100 })).toBe('70.0000');
    });
  });

  it('U2.1 — a surcharge on the buyer tier', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '10' }] });
    expect(await f.amount(acme(), f.products.P1)).toBe('110.0000');
  });

  it('U4 — a 100 % discount is a free line, and a valid price', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '-100' }] });
    expect(await f.price(acme(), f.products.P1)).toMatchObject({ amount: '0.0000', source: 'buyer' });
  });
});
