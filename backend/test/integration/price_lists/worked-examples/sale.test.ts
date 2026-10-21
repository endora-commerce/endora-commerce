import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../../helpers/pricing-fixture.js';

/**
 * Feature 160, US4 — a sale is charged only when strictly lower than the
 * buyer's own price, which is then the compare-at price
 * (`specs/pricing/worked-examples.md` §10.6, §10.13; FR-015, FR-046).
 */
describe('worked examples — sales (US4)', () => {
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

  async function e3(): Promise<void> {
    await f.book({ name: 'L3', audience: { groups: [f.groups.VIP] }, rows: [{ product: f.products.P1, percent: '-10' }] });
    await f.book({
      name: 'L4',
      audience: { organizations: [f.orgs.Acme] },
      rows: [
        { product: f.products.P1, percent: '-5' },
        { category: f.categories.screws, percent: '-15' },
      ],
    });
  }
  const l5 = (rows = [{ percent: '-10' }]) => f.book({ name: 'L5', type: 'sale', audience: 'everyone', rows });

  it('S1.1 — a lower sale is charged, the buyer price is the compare-at', async () => {
    await e3();
    await l5();
    expect(await f.price({ organization: f.orgs.Acme }, f.products.P1)).toMatchObject({
      amount: '90.0000',
      source: 'sale',
      isSale: true,
      compareAt: '95.0000',
    });
  });

  it('S1.2 — an equal sale is not a sale', async () => {
    await e3();
    await l5();
    const line = await f.price({ organization: f.orgs.Beta }, f.products.P1);
    expect(line).toMatchObject({ amount: '90.0000', source: 'buyer', isSale: false });
    expect(line?.compareAt ?? null).toBeNull();
  });

  it('S1.3 — a guest gets the sale under the base price', async () => {
    await e3();
    await l5();
    expect(await f.price('guest', f.products.P1)).toMatchObject({ amount: '90.0000', source: 'sale', compareAt: '100.0000' });
  });

  it('S2 — a sale above the contract price is not charged', async () => {
    await e3();
    await l5([{ product: f.products.P1, fixed: '98' } as never]);
    expect(await f.price({ organization: f.orgs.Acme }, f.products.P1)).toMatchObject({ amount: '95.0000', source: 'buyer' });
  });

  it('U2.2 — a sale under a surcharged buyer price', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme] }, rows: [{ product: f.products.P1, percent: '10' }] });
    await l5();
    expect(await f.price({ organization: f.orgs.Acme }, f.products.P1)).toMatchObject({
      amount: '90.0000',
      source: 'sale',
      compareAt: '110.0000',
    });
  });
});
