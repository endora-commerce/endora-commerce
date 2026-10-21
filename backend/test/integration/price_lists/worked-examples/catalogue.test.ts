import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../../helpers/pricing-fixture.js';

/**
 * Feature 160, US3 — channel catalogue prices for everyone
 * (`specs/pricing/worked-examples.md` §10.2, §10.5, §10.9, §10.10, §10.13;
 * FR-008, FR-013). The catalogue price is the base unless a regular book for
 * everyone on the channel prices the line, most specific selection first; buyer
 * percentages are taken off it.
 */
describe('worked examples — catalogue prices E1, C∩, F2, F4, C2, U1, U3 (US3)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;

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

  const guestPrices = async () => [
    await f.amount('guest', f.products.P1),
    await f.amount('guest', f.products.P2),
    await f.amount('guest', f.products.P3),
  ];

  it('E1.1–E1.4 — red in Screws costs 120 for everyone; nothing else moves', async () => {
    const l1 = await f.book({ name: 'L1', audience: 'everyone', rows: [{ category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' }] });
    expect(await f.price('guest', f.products.P1)).toMatchObject({ amount: '120.0000', source: 'catalogue', priceListId: l1.id });
    expect(await f.price('guest', f.products.P2)).toMatchObject({ amount: '50.0000', source: 'base' });
    expect(await f.price('guest', f.products.P3)).toMatchObject({ amount: '30.0000', source: 'base' });
    expect(await f.price({ organization: f.orgs.Acme }, f.products.P1)).toMatchObject({ amount: '120.0000', source: 'catalogue' });
  });

  it('C∩0 — category ∩ attribute prices the red screws only', async () => {
    await f.book({ audience: 'everyone', rows: [{ category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' }] });
    expect(await guestPrices()).toEqual(['120.0000', '50.0000', '30.0000']);
  });

  it('C∩1 — an attribute row alone also reprices the red bolt', async () => {
    await f.book({ audience: 'everyone', rows: [{ attribute: ['color', 'red'], fixed: '120' }] });
    expect(await guestPrices()).toEqual(['120.0000', '50.0000', '120.0000']);
  });

  it('C∩2 — a category row alone also reprices the blue screw', async () => {
    await f.book({ audience: 'everyone', rows: [{ category: f.categories.screws, fixed: '120' }] });
    expect(await guestPrices()).toEqual(['120.0000', '120.0000', '30.0000']);
  });

  it('C∩3 — a product row is right today and misses tomorrow’s red screw', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '120' }] });
    expect(await guestPrices()).toEqual(['120.0000', '50.0000', '30.0000']);
  });

  it('F2 — an organization blanket is off the channel’s catalogue price', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P1, fixed: '90' }] });
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ percent: '-3' }] });
    expect(await f.amount({ organization: f.orgs.Acme }, f.products.P1)).toBe('87.3000');
  });

  it('F4 — an organization category percentage is off the catalogue price', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P2, fixed: '48' }] });
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ category: f.categories.screws, percent: '-15' }] });
    expect(await f.amount({ organization: f.orgs.Acme }, f.products.P2)).toBe('40.8000');
  });

  it('C2 — category before attribute in the catalogue tier', async () => {
    await f.book({
      audience: 'everyone',
      rows: [
        { category: f.categories.screws, fixed: '110' },
        { attribute: ['color', 'red'], fixed: '125' },
      ],
    });
    expect(await f.amount('guest', f.products.P1)).toBe('110.0000');
  });

  it('U1.1–U1.3 — a surcharge for everyone on an attribute value', async () => {
    await f.book({ audience: 'everyone', rows: [{ attribute: ['color', 'red'], percent: '20' }] });
    expect(await guestPrices()).toEqual(['120.0000', '50.0000', '36.0000']);
  });

  it('U3.1 — an amount adjustment', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P2, amount: '-5' }] });
    expect(await f.amount('guest', f.products.P2)).toBe('45.0000');
  });

  it('U3.2 — an adjustment below zero does not price: the base stands', async () => {
    await f.book({ audience: 'everyone', rows: [{ product: f.products.P2, amount: '-60' }] });
    expect(await f.price('guest', f.products.P2)).toMatchObject({ amount: '50.0000', source: 'base' });
  });

  it('a draft everyone book prices nothing', async () => {
    await f.book({ audience: 'everyone', activate: false, rows: [{ product: f.products.P2, fixed: '1' }] });
    expect(await f.amount('guest', f.products.P2)).toBe('50.0000');
  });
});
