import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../../helpers/pricing-fixture.js';

/**
 * Feature 160, US1 — base prices for every product and variant
 * (`specs/pricing/worked-examples.md` §10.1, §10.8, §10.12, §10.14; FR-009,
 * FR-012, FR-018). A buyer to whom no book applies pays the base price of the
 * product or variant in each currency; nothing else is a price.
 */
describe('worked examples — base prices (US1)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

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

  it('E1.2, E1.3 with no book — a guest pays the base price', async () => {
    expect(await f.amount('guest', f.products.P1)).toBe('100.0000');
    expect(await f.amount('guest', f.products.P2)).toBe('50.0000');
    expect(await f.amount('guest', f.products.P3)).toBe('30.0000');
    const line = await f.price('guest', f.products.P2);
    expect(line).toMatchObject({ source: 'base', isSale: false, currency: 'PLN' });
  });

  it('a buyer to whom no book applies pays the base price too', async () => {
    expect(await f.amount({ organization: f.orgs.Gamma }, f.products.P1)).toBe('100.0000');
    expect(await f.amount({ organization: f.orgs.Acme }, f.products.P1)).toBe('100.0000');
  });

  it('V1 — a variant with no row of its own inherits its product’s base', async () => {
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5b })).toBe('80.0000');
  });

  it('V2 — a variant base row as a percentage of the product’s base', async () => {
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5r })).toBe('88.0000');
  });

  it('V7 — a variant base row as an amount adjustment', async () => {
    await f.setBase(f.products.P5, {
      product: [{ minQuantity: 1, maxQuantity: null, amount: '80' }],
      variants: { [f.variants.P5b]: { type: 'amount', amount: '7' } },
    });
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5b })).toBe('87.0000');
  });

  it('base tiers by quantity (§10.8 base)', async () => {
    await f.setBase(f.products.P1, {
      product: [
        { minQuantity: 1, maxQuantity: 9, amount: '100' },
        { minQuantity: 10, maxQuantity: null, amount: '90' },
      ],
      variants: {},
    });
    expect(await f.amount('guest', f.products.P1, { quantity: 9 })).toBe('100.0000');
    const ten = await f.price('guest', f.products.P1, { quantity: 10 });
    expect(ten).toMatchObject({ amount: '90.0000', bracketStartQuantity: 10, source: 'base' });
  });

  it('K1.3 — no base row in the currency asked for: unpriced, never converted', async () => {
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH2, currency: 'EUR' })).toBeNull();
  });

  it('a base price applies on every channel offering its currency (channel-independent)', async () => {
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH2 })).toBe('50.0000');
  });

  it('FR-018 — a product with only the legacy defaultPrice attribute is unpriced', async () => {
    expect(await f.amount('guest', f.products.P4)).toBeNull();
  });

  it('Q4 — a percentage whose reference is missing is skipped: unpriced (quote path)', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ category: f.categories.screws, percent: '-15' }] });
    expect(await f.amount({ organization: f.orgs.Acme }, f.products.P4)).toBeNull();
    // The same row prices a screw that has a base.
    expect(await f.amount({ organization: f.orgs.Acme }, f.products.P2)).toBe('42.5000');
  });

  it('a currency the channel does not offer prices nothing, base included', async () => {
    expect(await f.amount('guest', f.products.P2, { channel: f.channels.CH3, currency: 'PLN' })).toBeNull();
  });
});
