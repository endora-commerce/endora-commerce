import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Feature 075, Phase C — the `customers` customer-side cut fails closed.
 *
 * Nineteen import sites became port resolutions in the customer-side cut and
 * seventeen more in the module-side one, and the point of the exercise is not
 * the specifier: it is that a read whose owner is absent now **refuses**
 * where it used to answer. `em.find(CustomerAccount, …)` cheerfully returned
 * rows from a table that is still there; `customerAccountAdminSearchPort.search()`
 * answers 503 `MODULE_DISABLED`.
 *
 * Three edges are probed rather than all of them, one per owner this cut
 * introduced or widened, and each on a route where that owner is the only new
 * one reached:
 *
 *  - **`customer_accounts`** — the admin customer list, which was a
 *    `findAndCount` on that module's entity and is now one port call.
 *  - **`organizations`** — the customer detail's organisation name. An unnamed
 *    organisation is the reply an operator would misread: "this customer
 *    belongs to nobody" is a plausible answer and the wrong one.
 *  - **`addresses`** — the org-shared half of the address panel, which used to
 *    be an `em.find(Address, …)` over that module's table.
 *  - **`carts`** — the customer-detail cart panel. This module used to build a
 *    **second** `CartQueryService` from an import of that module's directory,
 *    so the panel queried the cart tables whether `carts` was there or not.
 *  - **`orders`** — the customer-detail order history. It used to read a
 *    late-bound accessor typed `Pick<OrderListService, 'list'>`, behind a
 *    presence probe that answered an empty page. The probe could not fire —
 *    `orders` has never had an activation control — so the empty page was a
 *    degrade nobody could reach, and the platform axis got a `null` accessor
 *    and a bare `Error` instead of the envelope.
 *
 * All three providers declare themselves `nonDeactivatable`, so the operator
 * axis has no off state for any of them; the platform axis is the one a
 * deployment that does not ship the module reaches, and it is the one driven
 * here. `withModuleOff` asserts the flip took before the body observes anything
 * (issue #141), and restores in its own `finally`. Every case carries a
 * positive control, because an always-broken route reads as a successful
 * absence without one.
 */
describe('customers — the cut edges fail closed (feature 075, Phase C)', () => {
  let h: BackendServerHandle;
  let customerId: string;

  type Reply = { statusCode: number; json: () => unknown };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const org = em.create(Organization, {
      name: 'Cut Edges Co',
      taxId: `PL075K${Date.now().toString().slice(-9)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Zamknięta 2',
        city: 'Warszawa',
        postalCode: '00-010',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    // Org-bound on purpose: the organisation name and the org-shared address
    // book are only reached for a customer that has one.
    const customer = em.create(CustomerAccount, {
      email: `cut-edges-${Date.now()}@example.test`,
      passwordHash: 'x'.repeat(60),
      firstName: 'Cut',
      lastName: 'Edges',
      organizationId: org.id,
    });
    await em.persistAndFlush(customer);
    customerId = customer.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const get = (url: string): Promise<Reply> =>
    h.app.inject({
      method: 'GET',
      url,
      cookies: { b2b_session: 'stub-admin-session' },
    }) as unknown as Promise<Reply>;

  const errorCode = (res: Reply): string | undefined =>
    (res.json() as { error?: { code?: string } }).error?.code;

  it('refuses the admin customer list while `customer_accounts` is unavailable', async () => {
    const before = await get('/api/v1/admin/customers?pageSize=1');
    expect(before.statusCode).toBe(200);

    await withModuleOff('customer_accounts', 'platform-unavailable', async () => {
      const res = await get('/api/v1/admin/customers?pageSize=1');
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await get('/api/v1/admin/customers?pageSize=1');
    expect(restored.statusCode).toBe(200);
  });

  it('refuses the customer detail while `organizations` is unavailable', async () => {
    const before = await get(`/api/v1/admin/customers/${customerId}`);
    expect(before.statusCode).toBe(200);

    await withModuleOff('organizations', 'platform-unavailable', async () => {
      const res = await get(`/api/v1/admin/customers/${customerId}`);
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await get(`/api/v1/admin/customers/${customerId}`);
    expect(restored.statusCode).toBe(200);
  });

  /**
   * Feature 080, T048 (D-169) — the customer-detail **header**, not the orders
   * panel below it.
   *
   * The detail response carries `salesChannelIds`: the channels this buyer has
   * ordered on. Until T048 that was `em.find(Order, {
   * placedByCustomerAccountId }, { fields: ['salesChannelId'] })` written
   * inside `customers`, so the header went on answering out of an `orders` the
   * platform was not serving — and answering *correctly*, which is what made it
   * invisible. It is `orderReadPort.salesChannelIdsForCustomer` now, so the
   * whole detail refuses rather than half of it quietly staying true.
   */
  it('refuses the customer detail while `orders` is unavailable', async () => {
    const before = await get(`/api/v1/admin/customers/${customerId}`);
    expect(before.statusCode).toBe(200);

    await withModuleOff('orders', 'platform-unavailable', async () => {
      const res = await get(`/api/v1/admin/customers/${customerId}`);
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await get(`/api/v1/admin/customers/${customerId}`);
    expect(restored.statusCode).toBe(200);
  });

  it('refuses the cart panel while `carts` is unavailable', async () => {
    const before = await get(`/api/v1/admin/customers/${customerId}/carts`);
    expect(before.statusCode).toBe(200);

    await withModuleOff('carts', 'platform-unavailable', async () => {
      const res = await get(`/api/v1/admin/customers/${customerId}/carts`);
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await get(`/api/v1/admin/customers/${customerId}/carts`);
    expect(restored.statusCode).toBe(200);
  });

  it('refuses the order-history panel while `orders` is unavailable', async () => {
    const before = await get(`/api/v1/admin/customers/${customerId}/orders`);
    expect(before.statusCode).toBe(200);

    await withModuleOff('orders', 'platform-unavailable', async () => {
      const res = await get(`/api/v1/admin/customers/${customerId}/orders`);
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await get(`/api/v1/admin/customers/${customerId}/orders`);
    expect(restored.statusCode).toBe(200);
  });

  /**
   * The **self-service** half of the same edge, and the reason it is here.
   *
   * `customers` reads `orderListPort` from two routes, and only the admin one
   * was probed above. The other was covered — asserting the *opposite* answer —
   * in `test/integration/_lifecycle/non-binding-degradation.integration.test.ts`,
   * under the `degrades-without` declaration the commit that added this file
   * withdrew. Deleting that case without landing this one would take the
   * buyer-facing route's absence coverage with it, which is the surface the
   * declaration was written about in the first place.
   *
   * A fixed customer session rather than the account created above: the route
   * answers for whoever is signed in, and the stub cookie is the seam the rest
   * of the suite uses for that.
   */
  it('refuses the self-service order history while `orders` is unavailable', async () => {
    const asCustomer = (): Promise<Reply> =>
      h.app.inject({
        method: 'GET',
        url: '/api/v1/me/customer/orders',
        cookies: { b2b_session: 'stub-customer-session' },
      }) as unknown as Promise<Reply>;

    const before = await asCustomer();
    expect(before.statusCode).toBe(200);

    await withModuleOff('orders', 'platform-unavailable', async () => {
      const res = await asCustomer();
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await asCustomer();
    expect(restored.statusCode).toBe(200);
  });

  it('refuses the org-shared address panel while `addresses` is unavailable', async () => {
    const before = await get(`/api/v1/admin/customers/${customerId}/addresses`);
    expect(before.statusCode).toBe(200);

    await withModuleOff('addresses', 'platform-unavailable', async () => {
      const res = await get(`/api/v1/admin/customers/${customerId}/addresses`);
      expect(res.statusCode).toBe(503);
      expect(errorCode(res)).toBe('MODULE_DISABLED');
    });

    const restored = await get(`/api/v1/admin/customers/${customerId}/addresses`);
    expect(restored.statusCode).toBe(200);
  });
});
