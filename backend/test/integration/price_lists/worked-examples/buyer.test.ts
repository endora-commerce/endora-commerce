import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../../helpers/pricing-fixture.js';

/**
 * Feature 160, US2 — organization and customer-group prices
 * (`specs/pricing/worked-examples.md` §10.3, §10.4; FR-014). Under the default
 * precedence, **HY**.
 */
describe('worked examples — buyer prices E2, E3 (US2)', () => {
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

  /** E2: Acme — Screws −10 %, Screws 0200 −20 %. */
  async function e2(): Promise<void> {
    await f.book({
      name: 'L2',
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { category: f.categories.screws, percent: '-10' },
        { product: f.products.P1, percent: '-20' },
      ],
    });
  }

  /** E3: VIP — Screws 0200 −10 %; Acme — Screws 0200 −5 %, Screws −15 %. */
  async function e3(): Promise<{ vip: string }> {
    const vip = await f.book({ name: 'L3', audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-10' }] });
    await f.book({
      name: 'L4',
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P1, percent: '-5' },
        { category: f.categories.screws, percent: '-15' },
      ],
    });
    return { vip: vip.id };
  }

  const acme = () => ({ organization: f.orgs.Acme });

  it('E2.1 — the organization product row beats its category row', async () => {
    await e2();
    expect(await f.price(acme(), f.products.P1)).toMatchObject({ amount: '80.0000', source: 'buyer' });
  });

  it('E2.2 — the category row prices the other screws', async () => {
    await e2();
    expect(await f.amount(acme(), f.products.P2)).toBe('45.0000');
  });

  it('E2.3 — no row matches the bolt: the catalogue price', async () => {
    await e2();
    expect(await f.price(acme(), f.products.P3)).toMatchObject({ amount: '30.0000', source: 'base' });
  });

  it('E2.4 — Beta has no book: the base price', async () => {
    await e2();
    expect(await f.amount({ organization: f.orgs.Beta }, f.products.P1)).toBe('100.0000');
  });

  it('E2.5 — with E1 configured, the percentage is off the catalogue price (96, not 80)', async () => {
    await e2();
    await f.book({
      name: 'L1',
      audience: 'everyone',
      rows: [{ category: f.categories.screws, attribute: ['color', 'red'], fixed: '120' }],
    });
    expect(await f.amount(acme(), f.products.P1)).toBe('96.0000');
  });

  it('E3.1 — the organization product row beats the group product row', async () => {
    await e3();
    expect(await f.amount(acme(), f.products.P1)).toBe('95.0000');
  });

  it('E3.2 — a VIP member without its own book gets the group price', async () => {
    await e3();
    expect(await f.amount({ organization: f.orgs.Beta }, f.products.P1)).toBe('90.0000');
  });

  it('E3.3 — the organization category row on another screw', async () => {
    await e3();
    expect(await f.amount(acme(), f.products.P2)).toBe('42.5000');
  });

  it('E3.4 — the organization category row beats a group product row under HY', async () => {
    const { vip } = await e3();
    await f.system(() =>
      f.books.replaceRows(vip, {
        upsert: [{ selection: { productId: f.products.P2.id }, minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-10' } }],
        delete: [],
      }),
    );
    expect(await f.amount(acme(), f.products.P2)).toBe('42.5000');
  });

  it('E3.5 — Gamma and a guest pay the base price', async () => {
    await e3();
    expect(await f.amount({ organization: f.orgs.Gamma }, f.products.P1)).toBe('100.0000');
    expect(await f.amount('guest', f.products.P1)).toBe('100.0000');
  });

  it('E3.6 — AcmeW inherits Acme’s book through its chain', async () => {
    await e3();
    const line = await f.price({ organization: f.orgs.AcmeW }, f.products.P1);
    expect(line).toMatchObject({ amount: '95.0000', source: 'buyer' });
    expect(line?.explanation).toMatchObject({ tier: 'buyer', cell: 'org.product', precedenceVersion: 1 });
  });
});
