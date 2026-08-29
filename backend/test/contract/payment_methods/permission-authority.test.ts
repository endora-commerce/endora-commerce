import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser, PaymentMethod } from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SALES_REPRESENTATIVE_PERMISSIONS } from '../../../src/seeds/seeded-role-permissions.js';

/**
 * `payment_methods` owns its own authority.
 *
 * The module declared no permission code of its own and enforced
 * `catalog:read` / `catalog:write` on all six of its admin routes. So whoever
 * could edit a product could read the payment-method configuration and rewrite
 * it — which methods checkout offers, their surcharge, and which order status
 * each payment outcome moves an order to.
 *
 * Nothing could see it. Both codes are real, declared and enforced, so the
 * permission inventory's two directions (*enforced ⇒ grantable*,
 * *grantable ⇒ enforced*) were clean over the site;
 * `check:action-route-permissions` compared the palette action's declared code
 * to the gate on its own `targetRoute` and found them in perfect agreement,
 * because both said `catalog:read`; and D-173's `foreign-gate` sweep passes the
 * site deliberately — `catalog` is `nonDeactivatable`, so the availability
 * coupling that sweep asks about can never bite. None of them asks whether
 * `catalog:write` is the right authority for deciding how a shop takes money,
 * which is a judgement rather than a derivation. That is why the answer is
 * pinned here rather than in a new check.
 *
 * The four roles are created straight onto the entity rather than through
 * `PUT /api/v1/admin/admin-roles/:code`, deliberately: that route refuses a
 * code no manifest declares, so before the repair this file would have gone red
 * in `beforeAll` on the grantability guard and never reached the assertions the
 * defect is about. Grantability is not left unasserted — it is exactly what
 * `test/contract/admin_users/permission-inventory.test.ts` sweeps, in both
 * directions.
 *
 * Every refusal asserts the envelope, not merely a non-200: a 403 and a 500 are
 * different results, and a test that accepts either passes on a crash.
 */

const CATALOG_EDITOR_ID = '00000000-0000-4000-8000-0000000000da';
const METHODS_VIEWER_ID = '00000000-0000-4000-8000-0000000000db';
const METHODS_EDITOR_ID = '00000000-0000-4000-8000-0000000000dc';
const SEEDED_SALES_REP_ID = '00000000-0000-4000-8000-0000000000dd';
/**
 * The delivery-method editor's read code is the second member of the shared
 * `/admin/order-statuses` gate, so this file needs a role holding it — and its
 * own, for the reason every other role here is its own: an id shared with
 * `test/contract/delivery_methods/permission-authority.test.ts` would make each
 * file's fixtures depend on whether the other had booted first.
 */
const DELIVERY_VIEWER_ID = '00000000-0000-4000-8000-0000000000e2';

const CATALOG_EDITOR = { cookies: { b2b_session: 'stub-pm-catalog-editor-session' } };
const METHODS_VIEWER = { cookies: { b2b_session: 'stub-payment-methods-viewer-session' } };
const METHODS_EDITOR = { cookies: { b2b_session: 'stub-payment-methods-editor-session' } };
const SEEDED_SALES_REP = { cookies: { b2b_session: 'stub-pm-seeded-sales-rep-session' } };
const DELIVERY_VIEWER = { cookies: { b2b_session: 'stub-pm-delivery-viewer-session' } };

describe('payment_methods permission authority', () => {
  let h: BackendServerHandle;

  async function createRole(
    code: string,
    name: string,
    permissions: readonly string[],
  ): Promise<string> {
    const em = h.em();
    const role = em.create(AdminRole, { code, name, permissions: [...permissions] });
    await em.persistAndFlush(role);
    return role.id;
  }

  async function createAdmin(id: string, email: string, adminRoleId: string): Promise<void> {
    const em = h.em();
    em.create(AdminUser, {
      id,
      email,
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Payment',
      lastName: 'Methods',
      adminRoleId,
      status: 'active',
    });
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    // Holds *both* catalogue codes and neither payment-method code: the role
    // the old gates handed the whole payment-method surface to.
    const catalogRoleId = await createRole('pm_catalog_editor', 'Catalog editor', [
      'catalog:read',
      'catalog:write',
    ]);
    // The read half of the new pair, alone, so "can read" and "cannot write"
    // are two facts about one role rather than two roles.
    const viewerRoleId = await createRole('pm_methods_viewer', 'Payment methods viewer', [
      'payment_methods:read',
    ]);
    const editorRoleId = await createRole('pm_methods_editor', 'Payment methods editor', [
      'payment_methods:read',
      'payment_methods:write',
    ]);
    // The shipped role, verbatim from the seed's own constant.
    const salesRepRoleId = await createRole(
      'pm_seeded_sales_rep',
      'Sales representative',
      SALES_REPRESENTATIVE_PERMISSIONS,
    );

    await createAdmin(CATALOG_EDITOR_ID, 'pm-catalog-editor@example.com', catalogRoleId);
    await createAdmin(METHODS_VIEWER_ID, 'pm-methods-viewer@example.com', viewerRoleId);
    await createAdmin(METHODS_EDITOR_ID, 'pm-methods-editor@example.com', editorRoleId);
    // The other member of the shared order-status gate.
    const deliveryViewerRoleId = await createRole(
      'pm_delivery_methods_viewer',
      'Delivery methods viewer',
      ['delivery_methods:read'],
    );

    await createAdmin(SEEDED_SALES_REP_ID, 'pm-seeded-sales-rep@example.com', salesRepRoleId);
    await createAdmin(DELIVERY_VIEWER_ID, 'pm-delivery-viewer@example.com', deliveryViewerRoleId);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedMethod(): Promise<{ id: string; code: string }> {
    const em = h.em();
    const method = em.create(PaymentMethod, {
      code: `authority_${randomUUID().slice(0, 8)}`,
      name: { default: 'Authority' },
      kind: 'bank_transfer',
      adapter: 'bank_transfer',
      status: 'active',
      statusOnPending: 'new',
      statusOnSuccess: 'paid',
      statusOnFailure: 'cancelled',
    });
    await em.persistAndFlush(method);
    return { id: method.id, code: method.code };
  }

  function expectForbidden(res: { statusCode: number; json: () => unknown }): void {
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  }

  const upsertPayload = {
    name: { default: 'Rewritten' },
    kind: 'bank_transfer',
    adapter: 'bank_transfer',
    additionalPrice: 9.5,
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'cancelled',
  };

  it('refuses the configuration read to a role holding catalog:read and not payment_methods:read', async () => {
    expectForbidden(
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/payment-methods',
        ...CATALOG_EDITOR,
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/payment-methods/adapters',
        ...CATALOG_EDITOR,
      }),
    );
  });

  it('refuses the configuration write to a role holding catalog:write and not payment_methods:write', async () => {
    const { id, code } = await seedMethod();

    expectForbidden(
      await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/payment-methods/${code}`,
        ...CATALOG_EDITOR,
        payload: upsertPayload,
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/payment-methods/${id}/status`,
        ...CATALOG_EDITOR,
        payload: { status: 'inactive' },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/payment-methods/${id}`,
        ...CATALOG_EDITOR,
      }),
    );

    // And the refusal is total, not merely an error status: the row still says
    // what it said, and is still there.
    const em = h.em();
    em.clear();
    const row = await em.findOne(PaymentMethod, { id });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(Number(row!.additionalPrice)).toBe(0);
  });

  it('serves the configuration to a role holding payment_methods:read', async () => {
    await seedMethod();

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/payment-methods',
      ...METHODS_VIEWER,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);

    const adapters = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/payment-methods/adapters',
      ...METHODS_VIEWER,
    });
    expect(adapters.statusCode).toBe(200);
  });

  it('refuses every write to a role holding payment_methods:read alone', async () => {
    const { id, code } = await seedMethod();

    expectForbidden(
      await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/payment-methods/${code}`,
        ...METHODS_VIEWER,
        payload: upsertPayload,
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/payment-methods/${id}/status`,
        ...METHODS_VIEWER,
        payload: { status: 'inactive' },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/payment-methods/${id}`,
        ...METHODS_VIEWER,
      }),
    );
  });

  it('completes the write for a role holding the payment_methods pair', async () => {
    // The other half of the authority claim: the new codes are *sufficient*,
    // and not merely newly required on top of the catalogue's.
    const { id, code } = await seedMethod();

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/payment-methods/${code}`,
      ...METHODS_EDITOR,
      payload: upsertPayload,
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { data: { additionalPrice: number } }).data.additionalPrice).toBeCloseTo(
      9.5,
    );

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/payment-methods/${id}/status`,
      ...METHODS_EDITOR,
      payload: { status: 'inactive' },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { data: { status: string } }).data.status).toBe('inactive');
  });

  it('refuses the configuration to the seeded sales_representative', async () => {
    // Guard the premise rather than assume it: the case is only about
    // payment-method access if the seeded list genuinely grants neither code.
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('payment_methods:read');
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('*');

    expectForbidden(
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/payment-methods',
        ...SEEDED_SALES_REP,
      }),
    );
  });

  /**
   * `GET /api/v1/admin/order-statuses` is the one route of the six that is
   * **not** gated on `payment_methods:read` alone, and the reason is a fact
   * about the tree the design note did not have: the route is registered here
   * but read by two editors. `admin/src/modules/delivery_methods/api/
   * delivery-methods-client.ts` fetches it for the delivery-method status
   * selectors. Gating this read on `payment_methods:read` alone would take the
   * delivery-method status selectors down for every role that can open that
   * screen and not this one.
   *
   * So it is an any-of, and both members are asserted here: whichever editor an
   * operator is allowed to open, the shared status list opens with it. The
   * second member was `catalog:read` while `delivery_methods` still borrowed
   * the catalogue's authority, and it was asserted so that the merge request
   * giving that module its own pair had to replace it visibly. It has: the
   * member is now `delivery_methods:read`, and the catalogue case below is the
   * other half of the same assertion — no catalogue holder reaches the shared
   * list, because no catalogue holder opens either editor.
   */
  it('serves the shared order-status list to either editor’s read code', async () => {
    const viaMethods = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/order-statuses',
      ...METHODS_VIEWER,
    });
    expect(viaMethods.statusCode).toBe(200);

    const viaDelivery = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/order-statuses',
      ...DELIVERY_VIEWER,
    });
    expect(viaDelivery.statusCode).toBe(200);
  });

  it('refuses the shared order-status list to a catalogue editor', async () => {
    expectForbidden(
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/order-statuses',
        ...CATALOG_EDITOR,
      }),
    );
  });
});
