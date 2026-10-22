import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';
import { priceListChannelBridge } from '../../helpers/orders-neighbour-ports.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';
import { CUSTOMER_COOKIES } from '../../helpers/test-actors.js';

/**
 * Issue #124, the price half — an absent `price_lists` must refuse, not price
 * the line from the catalogue's legacy `defaultPrice` attribute.
 *
 * The two answers a buyer surface has to keep apart:
 *
 *  - the owner answered and **nothing applies** — `resolveLinePrice` → `null`,
 *    a legitimate answer the caller renders as "no price";
 *  - the owner is **absent** — the port gate throws, and the surface says so
 *    with the 503 `MODULE_DISABLED` envelope.
 *
 * A catalogue attribute standing in for either is a figure no price list
 * supports, on a cart line the buyer is about to pay for.
 *
 * **Absence here is the platform axis** (feature 074). `price_lists` is core
 * now — B2B is contract pricing, and the silent fallback this file exists to
 * refuse is precisely why — so no operator can produce this state and
 * `effectiveState` forces a core module's operator axis to `true` whatever the
 * activation map holds. A deployment that never installs the module still can,
 * which is the state the follow-up on Q6 closes and the one these cases drive.
 * Left seeded as a deactivation they would have gone on passing while
 * `price_lists` was present the whole time.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const SALES_CHANNEL_HEADER = { 'x-sales-channel': 'pl_retail' };

describe('price_lists — an absent owner refuses to price a cart line [integration]', () => {
  let h: BackendServerHandle;

  const addItem = async (): Promise<
    Awaited<ReturnType<BackendServerHandle['app']['inject']>>
  > =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { ...SALES_CHANNEL_HEADER, 'content-type': 'application/json' },
      cookies: CUSTOMER,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 1 },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterEach(() => {
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('refuses to add a cart line while `price_lists` is absent', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'price_lists'));

    const res = await addItem();

    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
  });

  it('refuses to re-price a cart that already has lines while `price_lists` is absent', async () => {
    // The cart read re-prices every line, so it is the same question as adding
    // one: the platform either has a price list to answer with or it says so.
    //
    // A basket of its own: the buyer's basket on this channel is shared with
    // every other file of the run, and a re-price another file cached for it
    // would answer this read without asking `price_lists` at all.
    const retail = await h.em().findOneOrFail(SalesChannel, { code: SALES_CHANNEL_HEADER['x-sales-channel'] });
    await h.cartService()!.clearForCustomer({
      ...CUSTOMER_COOKIES[CUSTOMER.b2b_session]!,
      salesChannelId: retail.id,
    });
    expect((await addItem()).statusCode).toBe(200);

    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'price_lists'));
    // On the channel the line was added on: a basket belongs to its channel
    // (`specs/154-sales-channel-access/`), and another channel's is empty.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/cart',
      headers: SALES_CHANNEL_HEADER,
      cookies: CUSTOMER,
    });

    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
  });

  it('refuses the PIM price write port while `price_lists` is absent (FR-049)', async () => {
    // `providePort` gates the resolution: a caller resolves the port per use,
    // so the refusal comes before anything executes.
    const resolvePort = () =>
      (h.container as unknown as { resolve<T>(name: string): T }).resolve<{
        replaceProductBaseTiers(productId: string, tiers: Record<string, unknown[]>): Promise<unknown>;
      }>('priceBookWritePort');
    const count = () =>
      h
        .em()
        .getConnection()
        .execute<Array<{ n: string }>>(`select count(*) as "n" from "price_list_matrix_entries" where "product_id" = ?`, [
          SEED_PRODUCT_101_ID,
        ]);
    const before = await count();
    registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== 'price_lists'));

    let refusal: unknown;
    try {
      await resolvePort().replaceProductBaseTiers(SEED_PRODUCT_101_ID, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: '1.0000' }],
      });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toMatchObject({ code: 'MODULE_DISABLED' });

    registryCache.__setEnabledForTesting(ALL_IDS);
    expect(await count()).toEqual(before);
  });

  it('adds the line again once `price_lists` is back', async () => {
    const res = await addItem();

    expect(res.statusCode).toBe(200);
  });

  /**
   * Feature 148 — a price matrix entry that selects by attribute asks `catalog`
   * which attributes carry *Price list rules*. With no attribute read port the
   * engine refuses the line; it never treats "cannot ask" as "no attribute is
   * eligible", which would price the line as though the entry did not exist.
   */
  it('refuses a line a price-book attribute row could price when the attribute read port is absent', async () => {
    const em = h.em();
    // An everyone book of the channel with one attribute row: a resolution of
    // any product on it has to ask which attributes select prices.
    const bookId = await seedPriceBookSql(em, { name: 'Attribute book', audience: 'everyone', rows: [] });
    await em.getConnection().execute(
      `insert into "price_list_matrix_entries"
         ("id", "price_list_id", "attribute_key", "attribute_value", "min_quantity", "price_type", "percent", "created_at", "updated_at")
       values (gen_random_uuid(), ?, 'material', 'steel', 1, 'percent', -10, now(), now())`,
      [bookId],
    );
    try {
      const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
      const product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
      // `neighbourReadPorts` without an attribute read is the unwired port.
      const pricing = new PricingService(h.em, undefined, neighbourReadPorts(h.em), undefined, {
        channelBridge: priceListChannelBridge(),
      });
      await expect(
        pricing.resolveLinePrice({
          product,
          context: {
            quantity: 1,
            organization: null,
            salesChannel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
          },
        }),
      ).rejects.toThrow(/catalogAttributeRead/);
    } finally {
      await h.em().getConnection().execute(`delete from "price_lists" where "id" = ?`, [bookId]);
    }
  });
});
