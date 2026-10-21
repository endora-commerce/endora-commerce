import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../../helpers/pricing-fixture.js';

/**
 * Feature 160, US5 — variant prices (`specs/pricing/worked-examples.md` §10.14;
 * FR-016, FR-017, FR-024, FR-031). P5 *Screws 0500* is a configurable product
 * in Screws whose variants carry the colour (P5r red, P5b blue); base P5 80,
 * P5r +10 %.
 */
describe('worked examples — variant prices (US5)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  const red = () => ({ variantId: f.variants.P5r });
  const blue = () => ({ variantId: f.variants.P5b });
  const acme = () => ({ organization: f.orgs.Acme });

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

  it('V3, V3b — an attribute row matches through the variant’s axis value', async () => {
    await f.book({ audience: 'everyone', rows: [{ category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' }] });
    expect(await f.price('guest', f.products.P5, red())).toMatchObject({ amount: '120.0000', source: 'catalogue' });
    expect(await f.amount('guest', f.products.P5, blue())).toBe('80.0000');
  });

  it('V4, V4b — a product percentage keeps the variant difference', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P5, percent: '-5' }] });
    expect(await f.amount(acme(), f.products.P5, red())).toBe('83.6000');
    expect(await f.amount(acme(), f.products.P5, blue())).toBe('76.0000');
  });

  it('V5 — a variant row beats the product row of the same audience', async () => {
    await f.book({
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P5, percent: '-5' },
        { product: f.products.P5, variant: f.variants.P5r, fixed: '85' },
      ],
    });
    expect(await f.price(acme(), f.products.P5, red())).toMatchObject({ amount: '85.0000', explanation: { cell: 'org.variant' } });
  });

  it('V6 — a fixed product price flattens the variants', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P5, fixed: '70' }] });
    expect(await f.amount(acme(), f.products.P5, red())).toBe('70.0000');
    expect(await f.amount(acme(), f.products.P5, blue())).toBe('70.0000');
  });

  it('V8 — a listing card is "from" the lowest variant price, with the highest beside it', async () => {
    const listing = await f.pricing.resolveListingPrices({
      products: [f.products.P5, f.products.P1],
      context: { salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } },
    });
    expect(listing.get(f.products.P5.id)).toMatchObject({
      source: 'price_list',
      amount: '80.0000',
      maxAmount: '88.0000',
      variesByVariant: true,
    });
    const simple = listing.get(f.products.P1.id)!;
    expect(simple).toMatchObject({ amount: '100.0000' });
    expect(simple.source === 'price_list' && simple.variesByVariant).toBeFalsy();
  });

  it('V8 — variants priced alike are not "from"', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P5, fixed: '70' }] });
    const listing = await f.pricing.resolveListingPrices({
      products: [f.products.P5],
      context: { organization: f.orgs.Acme, salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } },
    });
    const card = listing.get(f.products.P5.id)!;
    expect(card).toMatchObject({ amount: '70.0000' });
    expect(card.source === 'price_list' && card.variesByVariant).toBeFalsy();
  });

  it('V9 — a line is charged its variant’s price', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P5, percent: '-5' }] });
    const lines = await f.pricing.resolveLinePrices({
      lines: [
        { key: 'red', product: f.products.P5, variantId: f.variants.P5r, quantity: 3 },
        { key: 'blue', product: f.products.P5, variantId: f.variants.P5b, quantity: 3 },
      ],
      context: { organization: f.orgs.Acme, salesChannel: { id: f.channels.CH1.id, defaultCurrency: 'PLN' } },
    });
    expect(lines.get('red')).toMatchObject({ amount: '83.6000' });
    expect(lines.get('blue')).toMatchObject({ amount: '76.0000' });
  });

  it('listTierStarts names the starts of the rows and base tiers that can apply', async () => {
    await f.setBase(f.products.P1, {
      product: [
        { minQuantity: 1, maxQuantity: 9, amount: '100' },
        { minQuantity: 10, maxQuantity: null, amount: '90' },
      ],
      variants: {},
    });
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '-8', min: 100 }] });
    await f.book({ audience: 'everyone', rows: [{ category: f.categories.screws, percent: '-1', min: 50 }] });
    expect(await f.pricing.listTierStarts(f.products.P1.id, 'PLN')).toEqual([1, 10, 50, 100]);
    await f.resetBase();
  });
});
