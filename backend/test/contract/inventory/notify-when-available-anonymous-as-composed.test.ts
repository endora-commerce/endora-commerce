import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AvailabilityNotification, Product } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Issue #87 — with `anonymousAsComposed`, the harness resolves a request with no
 * customer the way the composed application does, so the anonymous path of a
 * route is reachable from a route test.
 *
 * By default `test-server.ts`'s `customerContextResolver` and
 * `customerAccountIdResolver` answer the shared test customer for an anonymous
 * request. `availability-notification-attribution.test.ts` records the cost: the
 * storefront notify route reaches its guest branch through
 * `resolveCustomerContext` *throwing*, the default resolver never throws, so an
 * anonymous subscribe through the route writes a row owned by `TEST_CUSTOMER_ID`
 * and that file has to assert the ownerless half one layer in, on the service.
 *
 * This file sets the opt-in and asserts the same outcome at the route — the
 * row owned by nobody, as production writes it — and that a signed-in buyer is
 * still resolved as one, so the opt-in narrows the substitution to the
 * anonymous actor and nothing else.
 */
describe('the notify-when-available guest path, with the anonymous actor resolved as composed', () => {
  let h: BackendServerHandle;
  let productId: string;

  beforeAll(async () => {
    h = await setupBackendServer({ anonymousAsComposed: true });
    const em = h.em();
    // Out of stock by construction — no `stock_levels` row at all — so the
    // subscribe is not refused with `PRODUCT_IN_STOCK` whatever other files do
    // to the seed catalogue's stock.
    const stamp = Date.now();
    const product = em.create(Product, {
      sku: `ANON-NOTIFY-${stamp}`,
      slug: `anon-notify-${stamp}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Anonymous notify probe product' },
      description: { 'en-US': 'Out of stock, so the notify-me path is reachable.' },
      visibility: 'public',
      attributeValues: { defaultPrice: 10 },
    });
    await em.persistAndFlush(product);
    productId = product.id;

    // `subscribe` narrows against the request's channel (issue #259), so the
    // product is bound to the default channel the way production binds it.
    const systemDefault = await em.findOneOrFail(SalesChannel, { systemDefault: true });
    await em
      .getConnection()
      .execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?,?) ` +
          `on conflict (sales_channel_id, product_id) do nothing`,
        [systemDefault.id, productId],
      );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const subscribe = async (cookies: Record<string, string>): Promise<AvailabilityNotification> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/inventory/notify-when-available',
      cookies,
      payload: { productId, email: `anon-as-composed-${Date.now()}@example.com` },
    });
    expect(res.statusCode, res.body).toBe(202);
    const { subscriptionId } = (res.json() as { data: { subscriptionId: string } }).data;
    h.em().clear();
    return h.em().findOneOrFail(AvailabilityNotification, { id: subscriptionId });
  };

  it('writes an anonymous subscription owned by nobody, as production does', async () => {
    const row = await subscribe({});

    // `forceUndefined` reads a `NULL` back as `undefined`; normalised so the
    // matcher cannot pass on either value.
    expect(row.customerAccountId ?? null).toBeNull();
    expect(row.organizationId ?? null).toBeNull();
  });

  it('still resolves a signed-in buyer as that buyer', async () => {
    const row = await subscribe({ b2b_session: 'stub-customer-session' });

    expect(row.customerAccountId).toBe(TEST_CUSTOMER_ID);
    expect(row.organizationId).toBe(TEST_ORGANIZATION_ID);
  });
});
