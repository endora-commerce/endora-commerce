import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser, Warehouse } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SALES_REPRESENTATIVE_PERMISSIONS } from '@endora-commerce/mod-admin-roles/backend';

/**
 * `inventory` owns its own authority.
 *
 * The module declared no permission code and gated **all 21** of its admin
 * routes on two codes belonging to two other modules: nine reads on
 * `orders:read` and twelve writes on `catalog:write`. So whoever could edit a
 * product description could create, rename and delete a warehouse, rewrite a
 * stock count, run a CSV import across every product's stock, and bind or
 * unbind a warehouse from a sales channel — which decides what that channel can
 * sell. And whoever could read orders could enumerate every warehouse and the
 * address on it.
 *
 * Neither code names the data being touched, which is the discriminator
 * `specs/080-f4-real-scope/payments-permission-ownership.md` §7.2 sets. That
 * sweep classified `inventory` as *"writing stock and reading orders"* and left
 * it; the classification was made per **module** and authority is exercised per
 * **route**, which is `specs/first-deployment-window.md` §2's correction. None
 * of the 21 routes reads or writes a product, a price or an order. The one
 * place this module genuinely touches another's table is the roster's
 * `products` join inside `StockLevelService` — a boundary *reach*, ledgered as
 * one, and not an authority question.
 *
 * Nothing could see it. Both codes are real, declared and enforced, so the
 * permission inventory's two directions (*enforced ⇒ grantable*,
 * *grantable ⇒ enforced*) were clean over every site; D-173's `foreign-gate`
 * sweep passes both deliberately, because `catalog` and `orders` are
 * `nonDeactivatable` and the availability coupling that sweep asks about can
 * never bite. `check:action-route-permissions` is the one check that *did* look
 * here, this module declaring the `open-inventory` action — and it agreed,
 * because the action correctly named `orders:read`, the code the route then
 * enforced. That is the check working as designed: it compares an action to its
 * route, which is a derivation, and has no opinion about whether the route's
 * code is the right authority, which is a judgement. So the answer is pinned
 * here rather than in a new check.
 *
 * **Two negatives, not one**, because the module borrowed two codes on two
 * halves of one surface: an orders reader and a catalogue editor. Both are
 * roles that reached this module before and must not now. The viewer and the
 * editor then show the pair is *sufficient* and not merely newly required.
 *
 * The roles are created straight onto the entity rather than through
 * `PUT /api/v1/admin/admin-roles/:code`, deliberately: that route refuses a
 * code no manifest declares, so before the repair this file would have gone red
 * in `beforeAll` on the grantability guard and never reached the assertions the
 * defect is about. Grantability is not left unasserted — it is exactly what
 * `test/contract/admin_users/permission-inventory.test.ts` sweeps.
 *
 * Every refusal asserts the envelope, not merely a non-200: a 403 and a 500 are
 * different results, and a test that accepts either passes on a crash.
 */

const ORDERS_READER_ID = '00000000-0000-4000-8000-0000000000ea';
const CATALOG_EDITOR_ID = '00000000-0000-4000-8000-0000000000eb';
const INVENTORY_VIEWER_ID = '00000000-0000-4000-8000-0000000000ec';
const INVENTORY_EDITOR_ID = '00000000-0000-4000-8000-0000000000ed';
const SEEDED_SALES_REP_ID = '00000000-0000-4000-8000-0000000000ee';

const ORDERS_READER = { cookies: { b2b_session: 'stub-inventory-orders-reader-session' } };
const CATALOG_EDITOR = { cookies: { b2b_session: 'stub-inventory-catalog-editor-session' } };
const INVENTORY_VIEWER = { cookies: { b2b_session: 'stub-inventory-viewer-session' } };
const INVENTORY_EDITOR = { cookies: { b2b_session: 'stub-inventory-editor-session' } };
const SEEDED_SALES_REP = { cookies: { b2b_session: 'stub-inventory-seeded-sales-rep-session' } };

describe('inventory permission authority', () => {
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
      firstName: 'Inventory',
      lastName: 'Authority',
      adminRoleId,
      status: 'active',
    });
    await em.flush();
  }

  beforeAll(async () => {
    h = await setupBackendServer();

    // The read half's old gate. `orders:read` opened every warehouse and its
    // address to anybody who could look at an order.
    const ordersRoleId = await createRole('inventory_orders_reader', 'Orders reader', [
      'orders:read',
    ]);
    // The write half's old gate, plus the catalogue read, which is the whole of
    // what a merchandiser holds.
    const catalogRoleId = await createRole('inventory_catalog_editor', 'Catalog editor', [
      'catalog:read',
      'catalog:write',
    ]);
    const viewerRoleId = await createRole('inventory_viewer', 'Inventory viewer', [
      'inventory:read',
    ]);
    const editorRoleId = await createRole('inventory_editor', 'Inventory editor', [
      'inventory:read',
      'inventory:write',
    ]);
    // The shipped role, verbatim from the seed's own constant.
    const salesRepRoleId = await createRole(
      'inventory_seeded_sales_rep',
      'Sales representative',
      SALES_REPRESENTATIVE_PERMISSIONS,
    );

    await createAdmin(ORDERS_READER_ID, 'inventory-orders-reader@example.com', ordersRoleId);
    await createAdmin(CATALOG_EDITOR_ID, 'inventory-catalog-editor@example.com', catalogRoleId);
    await createAdmin(INVENTORY_VIEWER_ID, 'inventory-viewer@example.com', viewerRoleId);
    await createAdmin(INVENTORY_EDITOR_ID, 'inventory-editor@example.com', editorRoleId);
    await createAdmin(
      SEEDED_SALES_REP_ID,
      'inventory-seeded-sales-rep@example.com',
      salesRepRoleId,
    );
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** A warehouse of this file's own; never the seeded default one. */
  async function seedWarehouse(): Promise<{ id: string; code: string }> {
    const em = h.em();
    const code = `auth_${randomUUID().slice(0, 8)}`;
    const warehouse = em.create(Warehouse, { name: 'Authority warehouse', code, active: true });
    await em.persistAndFlush(warehouse);
    return { id: warehouse.id, code };
  }

  async function seedChannel(): Promise<string> {
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: `auth-ch-${randomUUID().slice(0, 8)}`,
      name: { pl: 'Authority', en: 'Authority' },
      languages: ['pl'],
      defaultLanguage: 'pl',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
    });
    await em.persistAndFlush(channel);
    return channel.id;
  }

  function expectForbidden(res: { statusCode: number; json: () => unknown }): void {
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  }

  it('refuses the warehouse and stock reads to a role holding orders:read', async () => {
    await seedWarehouse();

    // A warehouse is a physical location with an address; enumerating them was
    // never a fact about orders.
    expectForbidden(
      await h.app.inject({ method: 'GET', url: '/api/v1/admin/warehouses', ...ORDERS_READER }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/inventory/levels',
        ...ORDERS_READER,
      }),
    );
    expectForbidden(
      await h.app.inject({ method: 'GET', url: '/api/v1/admin/inventory', ...ORDERS_READER }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/inventory/low-stock',
        ...ORDERS_READER,
      }),
    );
  });

  it('refuses warehouse CRUD to a role holding catalog:write', async () => {
    const { id } = await seedWarehouse();

    expectForbidden(
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/warehouses',
        ...CATALOG_EDITOR,
        payload: { name: 'Smuggled', code: `smuggled_${randomUUID().slice(0, 8)}` },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/warehouses/${id}`,
        ...CATALOG_EDITOR,
        payload: { name: 'Renamed' },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/warehouses/${id}`,
        ...CATALOG_EDITOR,
      }),
    );

    // And the refusal is total, not merely an error status.
    const em = h.em();
    em.clear();
    const row = await em.findOne(Warehouse, { id });
    expect(row).not.toBeNull();
    expect(row!.name).toBe('Authority warehouse');
  });

  it('refuses channel↔warehouse assignment to a role holding catalog:write', async () => {
    // Fulfilment routing: which stock a channel may sell. It is neither
    // catalogue data nor a sales-channel definition.
    const { id: warehouseId } = await seedWarehouse();
    const channelId = await seedChannel();

    expectForbidden(
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/sales-channels/${channelId}/warehouses`,
        ...CATALOG_EDITOR,
        payload: { warehouseId },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/sales-channels/${channelId}/warehouses/${randomUUID()}`,
        ...CATALOG_EDITOR,
      }),
    );
  });

  it('refuses stock writes, thresholds and the CSV import to a role holding catalog:write', async () => {
    expectForbidden(
      await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/inventory/thresholds',
        ...CATALOG_EDITOR,
        payload: { global: { high: 10, medium: 5, low: 1 } },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/inventory/import',
        ...CATALOG_EDITOR,
        payload: { csv: 'sku,onHand\n', warehouseId: randomUUID() },
      }),
    );
  });

  it('serves the reads to a role holding inventory:read', async () => {
    await seedWarehouse();

    const warehouses = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/warehouses',
      ...INVENTORY_VIEWER,
    });
    expect(warehouses.statusCode).toBe(200);
    expect((warehouses.json() as { items: unknown[] }).items.length).toBeGreaterThan(0);

    const kpis = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/inventory',
      ...INVENTORY_VIEWER,
    });
    expect(kpis.statusCode).toBe(200);
  });

  it('refuses every write to a role holding inventory:read alone', async () => {
    const { id } = await seedWarehouse();

    expectForbidden(
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/warehouses/${id}`,
        ...INVENTORY_VIEWER,
        payload: { name: 'Renamed' },
      }),
    );
    expectForbidden(
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/warehouses/${id}`,
        ...INVENTORY_VIEWER,
      }),
    );
  });

  it('completes warehouse CRUD for a role holding the inventory pair', async () => {
    // The other half of the authority claim: the new codes are *sufficient*,
    // and not merely newly required on top of the two borrowed ones.
    const code = `pair_${randomUUID().slice(0, 8)}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/warehouses',
      ...INVENTORY_EDITOR,
      payload: { name: 'Pair warehouse', code },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;

    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/warehouses/${id}`,
      ...INVENTORY_EDITOR,
      payload: { name: 'Renamed by the pair' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { data: { name: string } }).data.name).toBe('Renamed by the pair');

    const removed = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/warehouses/${id}`,
      ...INVENTORY_EDITOR,
    });
    expect(removed.statusCode).toBe(204);
  });

  it('binds and unbinds a warehouse for a role holding the inventory pair', async () => {
    const { id: firstWarehouse } = await seedWarehouse();
    const { id: secondWarehouse } = await seedWarehouse();
    const channelId = await seedChannel();

    const first = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/sales-channels/${channelId}/warehouses`,
      ...INVENTORY_EDITOR,
      payload: { warehouseId: firstWarehouse },
    });
    expect(first.statusCode).toBe(201);

    // Two, because `unassign` refuses to leave a channel with none — a rule of
    // the service, not of the gate, and the assertion is about the gate.
    const second = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/sales-channels/${channelId}/warehouses`,
      ...INVENTORY_EDITOR,
      payload: { warehouseId: secondWarehouse },
    });
    expect(second.statusCode).toBe(201);
    const assignmentId = (second.json() as { data: { id: string } }).data.id;

    const unassigned = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/sales-channels/${channelId}/warehouses/${assignmentId}`,
      ...INVENTORY_EDITOR,
    });
    expect(unassigned.statusCode).toBe(204);
  });

  /**
   * The shipped role, and it **is** red-before evidence here rather than a
   * standing assertion: `sales_representative` holds `catalog:read` and
   * nothing else this module used, so it never reached the write half — but it
   * does not hold `orders:read` either, so it never reached the read half. What
   * this pins is the direction the repair could have got wrong: `inventory:read`
   * is a new capability and must not have been granted by way of a code the
   * seeded role already carries.
   */
  it('refuses the inventory surface to the seeded sales_representative', async () => {
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('inventory:read');
    expect(SALES_REPRESENTATIVE_PERMISSIONS).not.toContain('*');

    expectForbidden(
      await h.app.inject({ method: 'GET', url: '/api/v1/admin/warehouses', ...SEEDED_SALES_REP }),
    );
  });

  /**
   * The readers that are not this admin surface.
   *
   * Every other module reads stock through `inventoryStockReadPort` and
   * reserves it through `inventoryReservationApplyPort`, in process — placement
   * and the storefront figure among them — not through these routes. So moving
   * 21 HTTP gates cannot degrade an order, a cart or a product page, and this
   * asserts the premise rather than leaving it as a claim in a commit message:
   * the storefront display-mode read answers for a caller holding no admin
   * permission at all.
   */
  it('leaves the storefront read reachable, which holds no admin permission', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/inventory/display-mode',
    });
    expect(res.statusCode).toBe(200);
  });
});
