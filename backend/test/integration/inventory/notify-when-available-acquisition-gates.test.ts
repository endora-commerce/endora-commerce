import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { Product } from '../../helpers/package-entities.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Asking to be told when a product returns is an acquisition (issue #227,
 * issue #259, Constitution XI and XII).
 *
 * A subscription names a product, is stored against it, and is answered later
 * by an e-mail that names it — so a product a caller may not see is a product
 * they may not subscribe to. Both axes were unenforced here while every other
 * acquisition seam applied both: `CartService.addItem`,
 * `ComparisonService.addProduct`, `ShoppingListService.addItem` and
 * `quick_order`'s SKU lookup all ask `isProductVisibleTo` and then
 * `outOfRequestChannel`, and all four answer a refusal with the 404 an absent
 * product gets.
 *
 * ## Every case is a pair, on the same channel and the same request shape
 *
 * The failure mode a gate like this actually has is not "it lets the wrong
 * product through" — it is "it refuses everything", one wrong argument away
 * from narrowing against a channel nobody is on or an organisation nobody is
 * in. `channel-assortment-fixture.ts` says so for the channel axis and the same
 * reasoning covers the audience axis, so each case below has a half that must
 * be refused and a half that must go through.
 *
 * The byte-for-byte indistinguishability of the refusals themselves is
 * `test/contract/inventory/notify-when-available-indistinguishable-refusal.test.ts`;
 * this file is about which caller gets which answer.
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const STOREFRONT_URL = '/api/v1/storefront/inventory/notify-when-available';

interface Probe {
  channelCode: string;
  /** Public, published on the probe channel. */
  soldHereId: string;
  /** Public, published on a second channel only. */
  notSoldHereId: string;
  /** On the probe channel, allow-listed to the signed-in buyer's organisation. */
  ownOrganizationId: string;
  /** On the probe channel, allow-listed to an organisation nobody here is in. */
  otherOrganizationId: string;
  /** On the probe channel, `logged_in_only`. */
  loggedInOnlyId: string;
}

describe('notify-when-available applies the audience and the channel gate every acquisition seam applies', () => {
  let h: BackendServerHandle;
  let probe: Probe;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;

    // No `stock_levels` row for any of them: `subscribe` refuses with 422
    // `PRODUCT_IN_STOCK` above zero on hand, and zero is the state this dialog
    // exists for.
    const make = async (
      label: string,
      extra: Record<string, unknown> = {},
    ): Promise<string> => {
      const product = em.create(Product, {
        sku: `NOTIFY-GATE-${label}-${stamp}`,
        slug: `notify-gate-${label}-${stamp}`,
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Notify gate probe ${label}` },
        description: { 'en-US': 'Out of stock, so the notify-me path is reachable.' },
        visibility: 'public',
        attributeValues: { defaultPrice: 10 },
        ...extra,
      });
      await em.persistAndFlush(product);
      return product.id;
    };

    const soldHereId = await make('sold-here');
    const notSoldHereId = await make('sold-elsewhere');
    const ownOrganizationId = await make('own-org', {
      allowedOrganizationIds: [TEST_ORGANIZATION_ID],
    });
    const otherOrganizationId = await make('other-org', {
      allowedOrganizationIds: [OTHER_TEST_ORGANIZATION_ID],
    });
    const loggedInOnlyId = await make('logged-in-only', { visibility: 'logged_in_only' });

    const code = `notify-gate-${randomUUID().slice(0, 8)}`;
    const channel = em.create(SalesChannel, {
      code,
      name: { 'en-US': `Notify gate probe ${code}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    const elsewhere = em.create(SalesChannel, {
      code: `${code}-elsewhere`,
      name: { 'en-US': `Notify gate elsewhere ${code}` },
      languages: ['en-US'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      isPublic: true,
    });
    await em.persistAndFlush([channel, elsewhere]);

    const onProbe = [soldHereId, ownOrganizationId, otherOrganizationId, loggedInOnlyId];
    await em
      .getConnection()
      .execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values ` +
          onProbe.map(() => '(?,?)').join(', ') +
          `, (?,?) on conflict (sales_channel_id, product_id) do nothing`,
        [...onProbe.flatMap((id) => [channel.id, id]), elsewhere.id, notSoldHereId],
      );

    probe = {
      channelCode: code,
      soldHereId,
      notSoldHereId,
      ownOrganizationId,
      otherOrganizationId,
      loggedInOnlyId,
    };
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  let mailbox = 0;
  const nextEmail = (): string => `notify-gate-${(mailbox += 1)}@example.com`;

  async function subscribeAnonymously(
    productId: string,
  ): Promise<{ statusCode: number; code: string | undefined }> {
    const res = await h.app.inject({
      method: 'POST',
      url: STOREFRONT_URL,
      headers: { 'x-sales-channel': probe.channelCode },
      payload: { productId, email: nextEmail() },
    });
    return { statusCode: res.statusCode, code: (res.json() as { error?: { code?: string } }).error?.code };
  }

  async function subscribeAsBuyer(
    productId: string,
  ): Promise<{ statusCode: number; code: string | undefined }> {
    const res = await h.app.inject({
      method: 'POST',
      url: STOREFRONT_URL,
      cookies: BUYER,
      headers: { 'x-sales-channel': probe.channelCode },
      payload: { productId, email: nextEmail() },
    });
    return { statusCode: res.statusCode, code: (res.json() as { error?: { code?: string } }).error?.code };
  }

  async function subscribeOnLegacyRoute(
    productId: string,
  ): Promise<{ statusCode: number; code: string | undefined }> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/catalog/products/${productId}/notify-when-available`,
      cookies: BUYER,
      headers: { 'x-sales-channel': probe.channelCode },
      payload: {},
    });
    return { statusCode: res.statusCode, code: (res.json() as { error?: { code?: string } }).error?.code };
  }

  describe('the channel axis', () => {
    it('refuses a product the request channel does not publish', async () => {
      const { statusCode, code } = await subscribeAnonymously(probe.notSoldHereId);
      expect(statusCode).toBe(404);
      expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });

    it('still accepts a product the same channel does publish', async () => {
      const { statusCode } = await subscribeAnonymously(probe.soldHereId);
      expect(statusCode).toBe(202);
    });

    it('accepts the withheld product on the channel that does publish it', async () => {
      // The half that proves the refusal above is about the bridge row and not
      // about the product: same product, same caller, a channel that sells it.
      const res = await h.app.inject({
        method: 'POST',
        url: STOREFRONT_URL,
        headers: { 'x-sales-channel': `${probe.channelCode}-elsewhere` },
        payload: { productId: probe.notSoldHereId, email: nextEmail() },
      });
      expect(res.statusCode).toBe(202);
    });
  });

  describe('the audience axis', () => {
    it('refuses an allow-listed product to an anonymous caller', async () => {
      const { statusCode, code } = await subscribeAnonymously(probe.ownOrganizationId);
      expect(statusCode).toBe(404);
      expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });

    it('refuses a product allow-listed to another organisation to a signed-in buyer', async () => {
      const { statusCode, code } = await subscribeAsBuyer(probe.otherOrganizationId);
      expect(statusCode).toBe(404);
      expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });

    it('accepts the product allow-listed to the buyer’s own organisation', async () => {
      const { statusCode } = await subscribeAsBuyer(probe.ownOrganizationId);
      expect(statusCode).toBe(202);
    });

    it('refuses a logged_in_only product anonymously and accepts it for the buyer', async () => {
      const anonymous = await subscribeAnonymously(probe.loggedInOnlyId);
      expect(anonymous.statusCode).toBe(404);
      expect(anonymous.code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);

      const buyer = await subscribeAsBuyer(probe.loggedInOnlyId);
      expect(buyer.statusCode).toBe(202);
    });
  });

  describe('the backward-compatible customer route, which reaches the same service', () => {
    it('refuses a product allow-listed to another organisation', async () => {
      const { statusCode, code } = await subscribeOnLegacyRoute(probe.otherOrganizationId);
      expect(statusCode).toBe(404);
      expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });

    it('refuses a product the request channel does not publish', async () => {
      const { statusCode, code } = await subscribeOnLegacyRoute(probe.notSoldHereId);
      expect(statusCode).toBe(404);
      expect(code).toBe(ERROR_CODES.PRODUCT_NOT_FOUND);
    });

    it('still registers the buyer for a product they may have', async () => {
      const { statusCode } = await subscribeOnLegacyRoute(probe.soldHereId);
      expect(statusCode).toBe(202);
    });
  });
});
