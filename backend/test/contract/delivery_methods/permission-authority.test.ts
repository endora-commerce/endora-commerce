import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser, DeliveryMethod } from '../../helpers/package-entities.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SALES_REPRESENTATIVE_PERMISSIONS } from '../../../src/seeds/seeded-role-permissions.js';

/**
 * `delivery_methods` owns its own authority.
 *
 * The module declared no permission code of its own and enforced
 * `catalog:read` / `catalog:write` on all three of its admin routes. So whoever
 * could edit a product could read the delivery-method configuration and rewrite
 * it — which methods a checkout offers, their surcharge, and which order status
 * a shipment outcome moves an order to — and delete a method outright.
 *
 * Nothing could see it. Both codes are real, declared and enforced, so the
 * permission inventory's two directions (*enforced ⇒ grantable*,
 * *grantable ⇒ enforced*) were clean over the site; D-173's `foreign-gate`
 * sweep passes it deliberately, because `catalog` is `nonDeactivatable` and the
 * availability coupling that sweep asks about can never bite; and
 * `check:action-route-permissions` never looked at all, this module declaring
 * no manifest action. None of them asks whether `catalog:write` is the right
 * authority for deciding how a shop ships, which is a judgement rather than a
 * derivation. That is why the answer is pinned here rather than in a new check.
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

const CATALOG_EDITOR_ID = '00000000-0000-4000-8000-0000000000de';
const DELIVERY_VIEWER_ID = '00000000-0000-4000-8000-0000000000df';
const DELIVERY_EDITOR_ID = '00000000-0000-4000-8000-0000000000e0';
const SEEDED_SALES_REP_ID = '00000000-0000-4000-8000-0000000000e1';

const CATALOG_EDITOR = { cookies: { b2b_session: 'stub-dm-catalog-editor-session' } };
const DELIVERY_VIEWER = { cookies: { b2b_session: 'stub-delivery-methods-viewer-session' } };
const DELIVERY_EDITOR = { cookies: { b2b_session: 'stub-delivery-methods-editor-session' } };
const SEEDED_SALES_REP = { cookies: { b2b_session: 'stub-dm-seeded-sales-rep-session' } };

describe('delivery_methods permission authority', () => {
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
      firstName: 'Delivery',
      lastName: 'Methods',
      adminRoleId,
      status: 'active',
    });
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    // Holds *both* catalogue codes and neither delivery-method code: the role
    // the old gates handed the whole delivery-method surface to.
    const catalogRoleId = await createRole('dm_catalog_editor', 'Catalog editor', [
      'catalog:read',
      'catalog:write',
    ]);
    // The read half of the new pair, alone, so "can read" and "cannot write"
    // are two facts about one role rather than two roles.
    const viewerRoleId = await createRole('dm_methods_viewer', 'Delivery methods viewer', [
      'delivery_methods:read',
    ]);
    const editorRoleId = await createRole('dm_methods_editor', 'Delivery methods editor', [
      'delivery_methods:read',
      'delivery_methods:write',
    ]);
    // The shipped role, verbatim from the seed's own constant.
    const salesRepRoleId = await createRole(
      'dm_seeded_sales_rep',
      'Sales representative',
      SALES_REPRESENTATIVE_PERMISSIONS,
    );

    await createAdmin(CATALOG_EDITOR_ID, 'dm-catalog-editor@example.com', catalogRoleId);
    await createAdmin(DELIVERY_VIEWER_ID, 'dm-methods-viewer@example.com', viewerRoleId);
    await createAdmin(DELIVERY_EDITOR_ID, 'dm-methods-editor@example.com', editorRoleId);
    await createAdmin(SEEDED_SALES_REP_ID, 'dm-seeded-sales-rep@example.com', salesRepRoleId);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedMethod(): Promise<{ id: string; code: string }> {
    const em = h.em();
    const method = em.create(DeliveryMethod, {
      code: `authority_${randomUUID().slice(0, 8)}`,
      name: { 'en-US': 'Authority' },
      cost: '0',
      currency: 'PLN',
      status: 'active',
      adapter: 'in_person_pickup',
    });
    await em.persistAndFlush(method);
    return { id: method.id, code: method.code };
  }

  function expectForbidden(res: { statusCode: number; json: () => unknown }): void {
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  }

  const upsertPayload = {
    name: { 'en-US': 'Rewritten' },
    cost: 9.5,
    currency: 'PLN',
    status: 'inactive' as const,
  };

  it('refuses the configuration read to a role holding catalog:read and not delivery_methods:read', async () => {
    expectForbidden(
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/delivery-methods',
        ...CATALOG_EDITOR,
      }),
    );
  });

  it('refuses the configuration write to a role holding catalog:write and not delivery_methods:write', async () => {
    const { id, code } = await seedMethod();

    expectForbidden(
      await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/delivery-methods/${code}`,
        ...CATALOG_EDITOR,
        payload: upsertPayload,
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/delivery-methods/${id}`,
        ...CATALOG_EDITOR,
      }),
    );

    // And the refusal is total, not merely an error status: the row still says
    // what it said, and is still there.
    const em = h.em();
    em.clear();
    const row = await em.findOne(DeliveryMethod, { id });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('active');
    expect(Number(row!.cost)).toBe(0);
  });

  it('serves the configuration to a role holding delivery_methods:read', async () => {
    await seedMethod();

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/delivery-methods',
      ...DELIVERY_VIEWER,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data.length).toBeGreaterThan(0);
  });

  it('refuses every write to a role holding delivery_methods:read alone', async () => {
    const { id, code } = await seedMethod();

    expectForbidden(
      await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/delivery-methods/${code}`,
        ...DELIVERY_VIEWER,
        payload: upsertPayload,
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/delivery-methods/${id}`,
        ...DELIVERY_VIEWER,
      }),
    );
  });

  it('completes the write for a role holding the delivery_methods pair', async () => {
    // The other half of the authority claim: the new codes are *sufficient*,
    // and not merely newly required on top of the catalogue's.
    const { id, code } = await seedMethod();

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/delivery-methods/${code}`,
      ...DELIVERY_EDITOR,
      payload: upsertPayload,
    });
    expect(put.statusCode).toBe(200);
    const body = put.json() as { data: { cost: { amount: number }; status: string } };
    expect(body.data.cost.amount).toBeCloseTo(9.5);
    expect(body.data.status).toBe('inactive');

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${id}`,
      ...DELIVERY_EDITOR,
    });
    expect(del.statusCode).toBe(204);
  });

  it('refuses the configuration to the seeded sales_representative', async () => {
    // Guard the premise rather than assume it: the case is only about
    // delivery-method access if the seeded list genuinely grants neither code.
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('delivery_methods:read');
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('*');

    expectForbidden(
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/delivery-methods',
        ...SEEDED_SALES_REP,
      }),
    );
  });

  /**
   * `GET /api/v1/admin/order-statuses` is registered by `payment_methods` and
   * read by **two** editors: its own screen and this module's, through
   * `admin/src/modules/delivery_methods/api/delivery-methods-client.ts`. When
   * `payment_methods` took its own codes (MR !1078) it could not move this one
   * outright — the delivery editor still gated on `catalog:read` — so it became
   * `requireAdminAny(['payment_methods:read', 'catalog:read'])` with both
   * members asserted there, precisely so that this merge request has to replace
   * the second one visibly.
   *
   * It is now `delivery_methods:read`, which is the code the delivery editor's
   * own routes enforce. The catalogue member is gone: after this change no
   * catalogue holder opens either editor, so keeping it would have left the
   * shared list readable by a role that can open neither screen it serves.
   */
  it('serves the shared order-status list to the delivery editor’s own read code', async () => {
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
