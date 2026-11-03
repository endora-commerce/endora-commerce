import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationPermissionPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';

/**
 * `shopping_lists` off-state — Constitution XVII item 6.
 *
 * This module is almost entirely a **storefront** module: every route it owns
 * is a signed-in buyer's, so "API rejection" and "storefront absence" are the
 * same assertion made at the same place, and the probes below carry a customer
 * session because a buyer's is the only session those routes accept.
 *
 * The gate they are held to is the route **registration** seam, not a per
 * handler check — `ctx.routes` wraps the registration in an `onRequest` hook,
 * which runs before `requireCustomer` — so the refusal is a property of every
 * route the module owns, including ones added later. That is what makes three
 * probes enough for a surface of fourteen routes.
 *
 * Item 6's four surfaces:
 *
 *  * **API rejection / storefront absence** — the list feed, the default list
 *    and a write, so the read and write halves are both covered;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **restoration** — asserted by the harness after both axes. Off is
 *    non-destructive: the manifest's own description promises that every list,
 *    its items and its sharing state stay, and the restored probes are what
 *    holds the routes to it;
 *  * **non-editable configuration** has no subject. The manifest declares one
 *    setting, `shopping_lists.enabled`, and it is the module's activation
 *    control — the single exception item 6 names. The harness is given no
 *    `settingWrite` rather than one that would drive the switch that has to
 *    keep working.
 *
 * The manifest declares no palette action, so there is nothing for the action
 * registry to withdraw.
 */
describe('shopping_lists off-state (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const customer = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, on both axes, and restored after', async () => {
    await expectModuleAbsent(h, 'shopping_lists', {
      routes: [
        { url: '/api/v1/shopping-lists', cookies: customer },
        { url: '/api/v1/shopping-lists/default', cookies: customer },
        {
          method: 'POST',
          url: '/api/v1/shopping-lists',
          cookies: customer,
          payload: { name: 'Off-state probe' },
        },
      ],
      adminPresence: { cookies: admin },
    });
  });
  /**
   * `specs/170-organization-roles/` WP-06 (T087; FR-007, FR-025, US 8, SC-007)
   * — US 8 — its two permissions follow the module's presence. While it is off, on either axis,
   * its codes leave the Organization's permission catalogue and every member's
   * effective set; the stored grants are not touched; switched back on, the
   * member holds exactly what they held before. Presence is read at call time,
   * so no cache has to be dropped for any of it.
   */
  describe('organization permissions follow presence', () => {
    const CODES = ['shopping_lists.create', 'shopping_lists.convert'] as const;
    const ORG_ADMIN = { b2b_session: 'stub-customer-session' };
    let memberId: string;
    let roleId: string;

    const port = (): OrganizationPermissionPort =>
      (h.container.cradle as unknown as { organizationPermissionPort: OrganizationPermissionPort })
        .organizationPermissionPort;
    const subject = () => ({ customerAccountId: memberId, organizationId: TEST_ORGANIZATION_ID });

    async function catalogueCodes(): Promise<string[]> {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/organizations/mine/permission-catalogue',
        cookies: ORG_ADMIN,
      });
      expect(res.statusCode, res.body).toBe(200);
      const groups = (res.json() as { data: { groups: Array<{ permissions: Array<{ code: string }> }> } }).data.groups;
      return groups.flatMap((g) => g.permissions.map((p) => p.code));
    }

    async function storedGrants(): Promise<string[]> {
      const [row] = (await h.em().getConnection().execute(
        `select "permissions" from "organization_roles" where "id" = ?`,
        [roleId],
      )) as Array<{ permissions: string[] }>;
      return [...row!.permissions].sort();
    }

    async function expectPresent(): Promise<void> {
      const catalogue = await catalogueCodes();
      const effective = (await port().effective(subject())).permissions;
      for (const code of CODES) {
        expect(catalogue).toContain(code);
        expect(effective).toContain(code);
        expect(await port().can(subject(), code)).toBe(true);
      }
    }

    beforeAll(async () => {
      memberId = randomUUID();
      const em = h.em();
      await em.getConnection().execute(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
         values (?, ?, ?, 'x', 'Off', 'State', now(), now())`,
        [memberId, TEST_ORGANIZATION_ID, `${memberId.slice(0, 8)}@shopping-lists-off-state.example`],
      );
      roleId = await seedMemberWithPermissions(em, {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: memberId,
        permissions: CODES,
      });
      // The fixture writes the role with SQL, past the role cache's drop; this
      // process has read the Organization's roles already, so drop its entry.
      (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } })
        .organizationRoleCache.invalidateLocal(TEST_ORGANIZATION_ID);
    });

    it.each(['deactivated', 'platform-unavailable'] as const satisfies readonly OffStateAxis[])(
      'leave the catalogue and the effective set while off (%s), grants kept, and come back',
      async (axis) => {
        await expectPresent();
        const before = await storedGrants();

        await withModuleOff('shopping_lists', axis, async () => {
          const catalogue = await catalogueCodes();
          const effective = (await port().effective(subject())).permissions;
          for (const code of CODES) {
            expect(catalogue).not.toContain(code);
            expect(effective).not.toContain(code);
            expect(await port().can(subject(), code)).toBe(false);
          }
          expect(await storedGrants()).toEqual(before);
        });

        await expectPresent();
        expect(await storedGrants()).toEqual(before);
      },
    );
  });
});
