import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../../helpers/pricing-fixture.js';

/**
 * Feature 160, US2 — audience sets of one kind and one effective customer
 * group per buyer (`specs/pricing/worked-examples.md` §10.11; FR-002, FR-010).
 */
describe('worked examples — audience sets (A1, A2, A4)', () => {
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

  it('A1.1–A1.4 — an organization set prices its members and their descendants only', async () => {
    await f.book({ name: 'L8', audience: { organizations: [f.orgs.Acme, f.orgs.Beta] }, rows: [{ product: f.products.P1, percent: '-12' }] });
    expect(await f.amount({ organization: f.orgs.Acme }, f.products.P1)).toBe('88.0000');
    expect(await f.amount({ organization: f.orgs.Beta }, f.products.P1)).toBe('88.0000');
    expect(await f.amount({ organization: f.orgs.AcmeW }, f.products.P1)).toBe('88.0000');
    expect(await f.amount({ organization: f.orgs.Gamma }, f.products.P1)).toBe('100.0000');
  });

  it('two members of one set share a pricing profile, and with it the cache entries', async () => {
    await f.book({ audience: { organizations: [f.orgs.Acme, f.orgs.Beta] }, rows: [{ product: f.products.P1, percent: '-12' }] });
    const profiles = f.pricing.bookPricing.profiles;
    const ask = (orgId: string) =>
      profiles.profileFor({
        channelId: f.channels.CH1.id,
        currencyCode: 'PLN',
        precedenceVersion: 1,
        organizationChain: [orgId],
        effectiveGroupId: f.groups.VIP,
      });
    expect((await ask(f.orgs.Acme.id)).key).toBe((await ask(f.orgs.Beta.id)).key);
    expect((await ask(f.orgs.Gamma.id)).key).not.toBe((await ask(f.orgs.Acme.id)).key);
  });

  it('A2.1 — a VIP member without a group of its own: the organization’s group', async () => {
    await f.book({ name: 'L9', audience: { groups: [f.groups.VIP, f.groups.Gold] }, rows: [{ product: f.products.P2, percent: '-20' }] });
    expect(await f.amount({ organization: f.orgs.Beta }, f.products.P2)).toBe('40.0000');
    expect(await f.amount({ organization: f.orgs.Beta, customerAccountId: f.accounts.betaPlain }, f.products.P2)).toBe(
      '40.0000',
    );
  });

  it('A2.2 — the customer’s own group wins', async () => {
    await f.book({ name: 'L9', audience: { groups: [f.groups.VIP, f.groups.Gold] }, rows: [{ product: f.products.P2, percent: '-20' }] });
    expect(await f.amount({ organization: f.orgs.Gamma, customerAccountId: f.accounts.ola }, f.products.P2)).toBe('40.0000');
    expect(await f.amount({ organization: f.orgs.Gamma }, f.products.P2)).toBe('50.0000');
  });

  it('A2.3 — one effective group: Silver, not Beta’s VIP', async () => {
    await f.book({ name: 'L9', audience: { groups: [f.groups.VIP, f.groups.Gold] }, rows: [{ product: f.products.P2, percent: '-20' }] });
    expect(await f.amount({ organization: f.orgs.Beta, customerAccountId: f.accounts.betaSilver }, f.products.P2)).toBe(
      '50.0000',
    );
  });

  it('A4 — a set mixing organizations and customer groups is refused', async () => {
    await expect(
      f.system(() =>
        f.books.createBook({
          name: 'Mixed',
          type: 'regular',
          currencyCode: 'PLN',
          channelIds: [f.channels.CH1.id],
          audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id, f.groups.VIP] },
          priority: 0,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'PRICE_BOOK_AUDIENCE_KIND' });
  });

  it('a set naming a member that does not exist is refused', async () => {
    await expect(
      f.system(() =>
        f.books.createBook({
          name: 'Ghost',
          type: 'regular',
          currencyCode: 'PLN',
          channelIds: [f.channels.CH1.id],
          audience: { kind: 'customer_groups', memberIds: ['00000000-0000-4000-8000-0000000000aa'] },
          priority: 0,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('a book of a set with no member cannot be activated', async () => {
    await expect(f.book({ audience: { groups: [] }, rows: [{ product: f.products.P2, percent: '-20' }] })).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRICE_BOOK_NOT_APPLICABLE',
    });
  });
});
