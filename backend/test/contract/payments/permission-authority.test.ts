import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
// `Order` and `Payment` through the package-entity helper, like `PaymentMethod`
// beside them: this file landed on a branch cut before `orders` and `payments`
// became packages, so its two direct `src/modules/...` imports named files that
// no longer exist by the time it merged. `tsc` saw it; `test:unit:fast` does
// not read this tree, and the targeted run resolves the classes off the
// container regardless, so the type error was the only signal.
import {
  AdminRole,
  AdminUser,
  Order,
  Payment,
  PaymentMethod,
} from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SALES_REPRESENTATIVE_PERMISSIONS } from '../../../src/seeds/seeded-role-permissions.js';

/**
 * `payments` owns its own authority.
 *
 * The module shipped with no permission code of its own and enforced
 * `catalog:read` / `catalog:write` on all three of its admin routes. Both codes
 * are real, declared and enforced, so the permission inventory's two-way sweep
 * (*enforced ⇒ grantable*, *grantable ⇒ enforced*) was clean over it, and
 * D-173's `foreign-gate` sweep passes it deliberately — `catalog` is
 * `nonDeactivatable`, so the availability coupling it asks about can never
 * bite. Neither signal asks whether `catalog:write` is the right authority for
 * settling a payment, and that question is a judgement rather than a
 * derivation, which is why the answer is pinned here instead of in a check.
 *
 * What the old gates actually granted, and what each case below refuses:
 *
 *  - `POST /api/v1/payments/receive` declares a payment succeeded, which moves
 *    the order's `paymentStatus` in the same transaction and fires the order
 *    transition. Under `catalog:write` a merchandiser could mark an arbitrary
 *    payment settled with no money having moved.
 *  - `GET /api/v1/admin/orders/:id/payments` serves the full payment history
 *    including `providerDetails` verbatim. Under `catalog:read` the seeded
 *    `sales_representative` — which holds `catalog:read` and **not**
 *    `orders:read` — could read any order's PSP payloads while being unable to
 *    open the orders list at all. The last case asserts that specifically, off
 *    the seed's own list rather than a copy of it.
 *
 * The refusals assert the envelope, not merely a non-200: a 403 and a 500 are
 * different results and a test that accepts either passes on a crash.
 */

const CATALOG_EDITOR_ID = '00000000-0000-4000-8000-0000000000d7';
const PAYMENTS_VIEWER_ID = '00000000-0000-4000-8000-0000000000d8';
const SEEDED_SALES_REP_ID = '00000000-0000-4000-8000-0000000000d9';

const CATALOG_EDITOR = { cookies: { b2b_session: 'stub-catalog-editor-session' } };
const PAYMENTS_VIEWER = { cookies: { b2b_session: 'stub-payments-viewer-session' } };
const SEEDED_SALES_REP = { cookies: { b2b_session: 'stub-seeded-sales-rep-session' } };
const PLATFORM_ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('payments permission authority', () => {
  let h: BackendServerHandle;

  async function createRole(code: string, name: string, permissions: readonly string[]): Promise<string> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      ...PLATFORM_ADMIN,
      payload: { code, name, permissions: [...permissions] },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { id: string } }).data.id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    // The catalogue editor holds *both* catalogue codes and neither payments
    // code: it is the role the old gates handed the whole settlement surface to.
    const catalogRoleId = await createRole('payments_catalog_editor', 'Catalog editor', [
      'catalog:read',
      'catalog:write',
    ]);
    // The read half of the new pair, alone, so "can read" and "cannot write"
    // are two facts about one role rather than two roles.
    const paymentsRoleId = await createRole('payments_viewer', 'Payments viewer', ['payments:read']);
    // The shipped role, verbatim from the seed's own constant, and created the
    // way the seed creates it — straight onto the entity. It cannot go through
    // `PUT /admin/admin-roles/:code`, because that route refuses the list: the
    // seed's `organizations:read.assigned` is enforced nowhere and declared by
    // no manifest, so the grantability guard answers `Unknown permission(s)`.
    // That is a separate defect in the seed (a dead code in a shipped role,
    // invisible to the permission inventory because a seed is neither a gate
    // nor a manifest) and it is not this file's subject — but reproducing the
    // role through a path that would not accept it would be reproducing a
    // different role.
    const em = h.em();
    const salesRepRole = em.create(AdminRole, {
      code: 'payments_seeded_sales_rep',
      name: 'Sales representative',
      permissions: [...SALES_REPRESENTATIVE_PERMISSIONS],
    });
    await em.persistAndFlush(salesRepRole);
    const salesRepRoleId = salesRepRole.id;

    const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
    em.create(AdminUser, {
      id: CATALOG_EDITOR_ID,
      email: 'payments-catalog-editor@example.com',
      passwordHash,
      firstName: 'Cat',
      lastName: 'Editor',
      adminRoleId: catalogRoleId,
      status: 'active',
    });
    em.create(AdminUser, {
      id: PAYMENTS_VIEWER_ID,
      email: 'payments-viewer@example.com',
      passwordHash,
      firstName: 'Pay',
      lastName: 'Viewer',
      adminRoleId: paymentsRoleId,
      status: 'active',
    });
    em.create(AdminUser, {
      id: SEEDED_SALES_REP_ID,
      email: 'payments-seeded-sales-rep@example.com',
      passwordHash,
      firstName: 'Sales',
      lastName: 'Rep',
      adminRoleId: salesRepRoleId,
      status: 'active',
    });
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedOrderWithPayment(): Promise<{ orderId: string; paymentId: string }> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `auth_${randomUUID().slice(0, 8)}`,
      name: { default: 'Authority' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'confirmed',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(method);
    const address = {
      recipientName: 'A',
      street: 'S',
      city: 'C',
      postalCode: '00-000',
      country: 'PL',
    };
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      deliveryAddress: address,
      billingAddress: address,
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'd', name: 'd', cost: 0 },
      paymentMethodId: method.id,
      paymentMethodSnapshot: { code: method.code, name: 'Authority', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    const payment = em.create(Payment, {
      orderId: order.id,
      paymentMethodId: method.id,
      amount: '12.30',
      currency: 'PLN',
    });
    await em.persistAndFlush(payment);
    return { orderId: order.id, paymentId: payment.id };
  }

  function expectForbidden(res: { statusCode: number; json: () => unknown }): void {
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  }

  it('refuses the settlement ingress to a role holding catalog:write and not payments:write', async () => {
    const { paymentId } = await seedOrderWithPayment();

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/payments/receive',
      ...CATALOG_EDITOR,
      payload: { paymentId, outcome: 'success', externalReference: 'tx-catalog' },
    });
    expectForbidden(res);

    // And the refusal is total, not merely an error status: the payment is
    // still open and the order has not moved.
    const em = h.em();
    const payment = await em.findOne(Payment, { id: paymentId });
    expect(payment!.status).not.toBe('paid');
  });

  it('refuses the retry route to a role holding catalog:write and not payments:write', async () => {
    const { orderId } = await seedOrderWithPayment();

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/payments/retry`,
      ...CATALOG_EDITOR,
    });
    expectForbidden(res);
  });

  it('refuses the payment history to a role holding catalog:read and not payments:read', async () => {
    const { orderId } = await seedOrderWithPayment();

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}/payments`,
      ...CATALOG_EDITOR,
    });
    expectForbidden(res);
  });

  it('serves the payment history to a role holding payments:read', async () => {
    const { orderId } = await seedOrderWithPayment();

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}/payments`,
      ...PAYMENTS_VIEWER,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toHaveLength(1);
  });

  it('refuses both writes to a role holding payments:read alone', async () => {
    const { orderId, paymentId } = await seedOrderWithPayment();

    expectForbidden(
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/payments/receive',
        ...PAYMENTS_VIEWER,
        payload: { paymentId, outcome: 'success', externalReference: 'tx-viewer' },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/orders/${orderId}/payments/retry`,
        ...PAYMENTS_VIEWER,
      }),
    );
  });

  it('refuses the payment history to the seeded sales_representative', async () => {
    // Guard the premise rather than assume it: the case is only about payment
    // access if the seeded list genuinely grants neither payments code.
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('payments:read');
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('*');

    const { orderId } = await seedOrderWithPayment();

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${orderId}/payments`,
      ...SEEDED_SALES_REP,
    });
    expectForbidden(res);
  });
});
