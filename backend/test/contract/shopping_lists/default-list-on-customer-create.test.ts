import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationPermissionPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { ShoppingList, type ShoppingListRow } from '../../helpers/package-entities.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Eager default-list provisioning — creating an org-attached customer (here via
 * the admin direct-member-create endpoint) emits `customer_account.created.v1`,
 * which the shopping_lists module consumes to create the customer's "Default"
 * list immediately, before any storefront read lazily provisions it.
 */
describe('Default shopping list — eager provisioning on customer create', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('provisions a Default list when an admin creates a customer', async () => {
    // WP-03 of `specs/170-organization-roles/`: the body names a role id, not the legacy enum.
    const memberRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/members`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: 'eager-default-list@example.com',
        password: 'stub-password-change-me-1234',
        firstName: 'Eager',
        lastName: 'Provision',
        roleId: memberRoleId,
      },
    });
    expect(res.statusCode).toBe(201);
    const customerId = (res.json() as { data: { id: string } }).data.id;

    // The event handler runs fire-and-forget (no ambient bus scope around the
    // request), so poll briefly for the provisioned list.
    let list: ShoppingListRow | null = null;
    for (let attempt = 0; attempt < 40 && !list; attempt += 1) {
      list = await withSystemScope('test poll', () =>
        h.em().findOne(ShoppingList, {
          customerAccountId: customerId,
          organizationId: TEST_ORGANIZATION_ID,
        }),
      );
      if (!list) await new Promise((resolve) => setTimeout(resolve, 25));
    }

    expect(list).not.toBeNull();
    expect(list?.name).toBe('Default');
    expect(list?.isDefault).toBe(true);
  });

  /**
   * `specs/170-organization-roles/` WP-06 (T086; FR-047) — `shopping_lists.create`
   * gates the buyer's own writes, not the platform's provisioning: an account
   * created into a role without it still gets its Default list, as before. The
   * Organization is a fresh one whose *Member* role has had both shopping-list
   * codes removed by its administrator (offered, then not granted — R-17), so
   * no other file's members are touched.
   */
  it('provisions the Default list for a member whose role lacks shopping_lists.create', async () => {
    const em = h.em();
    const organizationId = randomUUID();
    await em.getConnection().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","created_at","updated_at")
       values (?, 'Lists without create', ?, 'active', 'vat_payer', '{}'::jsonb, ?, now(), now())`,
      [organizationId, `lists-${organizationId.slice(0, 13)}`, `/${organizationId}/`],
    );
    const memberRoleId = await predefinedRoleIdOf(em, organizationId, 'member');
    await em.getConnection().execute(
      `update "organization_roles"
          set "permissions" = array_remove(array_remove("permissions", 'shopping_lists.create'), 'shopping_lists.convert'),
              "member_defaults_offered" = array(select distinct unnest("member_defaults_offered" || array['shopping_lists.create','shopping_lists.convert']::text[]))
        where "id" = ?`,
      [memberRoleId],
    );

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organizationId}/members`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: `no-list-create-${organizationId.slice(0, 8)}@example.com`,
        password: 'stub-password-change-me-1234',
        firstName: 'Without',
        lastName: 'Create',
        roleId: memberRoleId,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const customerId = (res.json() as { data: { id: string } }).data.id;

    // The precondition, asked of the port rather than assumed from the SQL.
    const permissions = (h.container.cradle as unknown as { organizationPermissionPort: OrganizationPermissionPort })
      .organizationPermissionPort;
    expect(await permissions.can({ customerAccountId: customerId, organizationId }, 'shopping_lists.create')).toBe(false);

    let list: ShoppingListRow | null = null;
    for (let attempt = 0; attempt < 40 && !list; attempt += 1) {
      list = await withSystemScope('test poll', () =>
        h.em().findOne(ShoppingList, { customerAccountId: customerId, organizationId }),
      );
      if (!list) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(list?.name).toBe('Default');
    expect(list?.isDefault).toBe(true);
  });
});
