import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { CatalogProductReadPort, CustomerAccountReadPort } from '@endora-commerce/contracts';
import { AvailabilityNotification, Product } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { AvailabilityNotificationService } from '../../../../packages/modules/inventory/src/backend/services/availability-notification-service.js';

/**
 * A back-in-stock subscription written through the storefront carries the
 * organisation of the account that owns it — feature 087 Group B, ruling D-187.
 *
 * ## Why this is asserted at the route rather than on the service
 *
 * `availability_notifications_organization_attribution_chk` refuses an owned
 * row with no organisation, and
 * `test/integration/tenancy/customer-scoped-organization-completeness.test.ts`
 * proves the refusal behaviourally for every class that carries the column. So
 * the question left over is not *"does the database refuse it"* — it is
 * *"does the one write path in this module produce a row the database accepts,
 * and does it produce the **right** organisation"*. Both storefront routes
 * derive the account from the session and never from the body, so entering at
 * the route is what makes the answer about the production path.
 *
 * ## The anonymous half is the other direction, and it is not a formality
 *
 * FR-011 requires an ownerless row to be representable, and this table is where
 * that matters most: `an_recipient_check` exists precisely so a browser with
 * nobody signed in can ask to be told when a product returns. A constraint that
 * had been written as an equivalence — or a stamp that reached for the request's
 * ambient organisation — would refuse that subscription outright, which is a
 * customer-facing regression the `CHECK` alone cannot report.
 */
describe('an availability notification carries the organisation of the account that owns it', () => {
  let h: BackendServerHandle;
  let productId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    // A product of this file's own, with **no** `stock_levels` row at all:
    // `subscribe` refuses with 422 `PRODUCT_IN_STOCK` when cumulative on-hand is
    // above zero, and the seed catalogue's products carry stock that other files
    // in the run move. `sum(on_hand)` over no row is `null`, which the service
    // reads as zero — the state a "notify me when it is back" dialog is for.
    const stamp = Date.now();
    const product = em.create(Product, {
      sku: `ATTRIB-NOTIFY-${stamp}`,
      slug: `attrib-notify-${stamp}`,
      type: 'simple',
      status: 'active',
      name: { 'en-US': 'Attribution probe product' },
      description: { 'en-US': 'Out of stock, so the notify-me path is reachable.' },
      visibility: 'public',
      attributeValues: { defaultPrice: 10 },
    });
    await em.persistAndFlush(product);
    productId = product.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const rowOf = async (subscriptionId: string): Promise<AvailabilityNotification> => {
    h.em().clear();
    return h.em().findOneOrFail(AvailabilityNotification, { id: subscriptionId });
  };

  it('stamps the signed-in buyer’s organisation on the storefront subscribe', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/inventory/notify-when-available',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        productId,
        email: 'attribution-owned@example.com',
      },
    });
    expect(res.statusCode).toBe(202);
    const { subscriptionId } = (res.json() as { data: { subscriptionId: string } }).data;

    const row = await rowOf(subscriptionId);
    expect(row.customerAccountId).toBe(TEST_CUSTOMER_ID);
    // Derived from the **account**, through `customerAccountReadPort`, and not
    // from the request's ambient context: that is what lets the same service
    // serve a storefront call and any later caller that names an account
    // without one.
    expect(row.organizationId).toBe(TEST_ORGANIZATION_ID);
  });

  it('stamps the buyer’s organisation on the backward-compatible customer route', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/catalog/products/${productId}/notify-when-available`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });
    expect(res.statusCode).toBe(202);
    const { subscriptionId } = (res.json() as { data: { subscriptionId: string } }).data;

    const row = await rowOf(subscriptionId);
    expect(row.customerAccountId).toBe(TEST_CUSTOMER_ID);
    expect(row.organizationId).toBe(TEST_ORGANIZATION_ID);
  });

  it('leaves an anonymous subscription owned by nobody, and does not invent an organisation', async () => {
    // **This one enters one layer in, and the reason is a property of the
    // harness rather than a preference.** The storefront route reaches its
    // anonymous branch through `resolveCustomerContext` *throwing*, and the
    // harness's resolver never throws: `test-server.ts`'s `customerResolver`
    // returns `TEST_CUSTOMER_ID` for a request with no customer actor, by a
    // deliberate divergence documented in its own comment. So an injected
    // request with no cookie writes an **owned** row here, and no assertion
    // over this route could tell the two apart. The service is where the two
    // columns are decided, so the service is where the ownerless half is
    // asserted — built from the container's own ports, exactly as
    // `test/integration/inventory/availability-worker.test.ts` builds the
    // worker, so it resolves the gates the composed module resolves.
    const cradle = h.container.cradle as never as {
      catalogProductReadPort: CatalogProductReadPort;
      customerAccountReadPort: CustomerAccountReadPort;
    };
    const service = new AvailabilityNotificationService(
      h.em,
      cradle.catalogProductReadPort,
      cradle.customerAccountReadPort,
    );

    const row = await service.subscribe({
      productId,
      email: `attribution-anonymous-${Date.now()}@example.com`,
      customerAccountId: null,
    });

    // FR-011, both halves. MikroORM's `forceUndefined` reads a `NULL` back as
    // `undefined`, so both columns are normalised before the comparison rather
    // than asserted with a matcher that would pass on either value.
    expect(row.customerAccountId ?? null).toBeNull();
    expect(row.organizationId ?? null).toBeNull();

    // And the database kept it: `availability_notifications_organization_attribution_chk`
    // is an implication, so an ownerless row needs no organisation, and
    // `an_recipient_check` is satisfied by the e-mail address alone.
    const persisted = await rowOf(row.id);
    expect(persisted.organizationId ?? null).toBeNull();
  });
});
