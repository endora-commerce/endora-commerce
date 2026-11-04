import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type OrganizationPermissionPort } from '@endora-commerce/contracts';
import { QUICK_ORDER_SETTING_CODES } from '@endora-commerce/mod-quick-order';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent, withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { CUSTOMER_COOKIES, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedMemberWithPermissions } from '../../helpers/seed-organization-roles.js';

/**
 * `quick_order` off-state — Constitution XVII item 6.
 *
 * The module's only prior off-state coverage is
 * `backend/test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`,
 * which asserts the palette action goes when the module does. That is feature
 * 091's question; item 6's four are here, and the palette assertion is not
 * repeated.
 *
 * `quick_order` is worth a word on the axes because its surface straddles them:
 * the buyer's own quick-order form and the admin's order-on-behalf screen are
 * separate route groups, registered through the same `ctx.routes` seam, and an
 * operator switching the module off means both. The probes below name one of
 * each so that a gate applied to only one group would fail here.
 *
 *  * **API rejection** — the admin preferences read and the admin build;
 *  * **storefront absence** — the buyer's preferences read and the buyer's
 *    catalogue search behind the quick-order form. A buyer who can still paste
 *    a SKU list into a switched-off module is the failure this refuses;
 *  * **admin absence** — the presence projection both frontends gate on, plus
 *    the `/admin-roles` permission catalogue the harness sweeps unasked;
 *  * **non-editable configuration** — the import row cap, an ordinary setting.
 *    The module's activation control lives in its own manifest entry and is
 *    deliberately not the code written here;
 *  * **restoration** — asserted by the harness after both axes.
 */
describe('quick_order off-state (Constitution XVII)', () => {
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
    await expectModuleAbsent(h, 'quick_order', {
      routes: [
        { url: '/api/v1/admin/quick-order/preferences', cookies: admin },
        {
          method: 'POST',
          url: '/api/v1/admin/quick-order/build',
          cookies: admin,
          payload: {},
        },
        { url: '/api/v1/quick-order/preferences', cookies: customer },
        { url: '/api/v1/quick-order/search?q=widget', cookies: customer },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        code: QUICK_ORDER_SETTING_CODES.IMPORT_MAX_ROWS,
        value: 500,
        cookies: admin,
      },
    });
  });
  /**
   * `specs/170-organization-roles/` WP-06 (T087; FR-007, FR-025, US 8, SC-007)
   * — its permission follow the module's presence. While it is off, on either axis,
   * its codes leave the Organization's permission catalogue and every member's
   * effective set; the stored grants are not touched; switched back on, the
   * member holds exactly what they held before. Presence is read at call time,
   * so no cache has to be dropped for any of it.
   */
  describe('organization permissions follow presence', () => {
    const CODES = ['quick_order.one_click'] as const;
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
        [memberId, TEST_ORGANIZATION_ID, `${memberId.slice(0, 8)}@quick-order-off-state.example`],
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

        await withModuleOff('quick_order', axis, async () => {
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
  /**
   * `specs/170-organization-roles/` WP-15 (T139; OR-10, FR-030b, FR-007) — the
   * import admits `carts.create` or `quote_requests.create`, and an absent
   * module's code grants nothing. With `quote_requests` off, a member whose role
   * holds only `quote_requests.create` holds nothing the import accepts, so it
   * is refused naming `carts.create`; switched back on, the same member is
   * served again with nothing re-granted.
   */
  describe('the import by either target follows quote_requests\' presence', () => {
    const cookie = 'stub-quick-order-off-state-quotes-only';
    const CSV = 'sku,quantity\nEXAMPLE-SIMPLE-001,1';

    function importCsv() {
      return h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/import',
        cookies: { b2b_session: cookie },
        payload: { csv: CSV },
      });
    }

    beforeAll(async () => {
      const id = randomUUID();
      const em = h.em();
      await em.getConnection().execute(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
         values (?, ?, ?, 'x', 'Quotes', 'Only', now(), now())`,
        [id, TEST_ORGANIZATION_ID, `${id.slice(0, 8)}@quick-order-off-state.example`],
      );
      await seedMemberWithPermissions(em, {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: id,
        permissions: ['quote_requests.create'],
      });
      (h.container.cradle as unknown as { organizationRoleCache: { invalidateLocal(id?: string): void } })
        .organizationRoleCache.invalidateLocal(TEST_ORGANIZATION_ID);
      CUSTOMER_COOKIES[cookie] = { customerAccountId: id, organizationId: TEST_ORGANIZATION_ID };
    });

    afterAll(() => {
      delete CUSTOMER_COOKIES[cookie];
    });

    it('refuses the quote-only member while quote_requests is off, naming carts.create, and serves them after', async () => {
      const on = await importCsv();
      expect(on.statusCode, on.body).toBe(200);

      await withModuleOff('quote_requests', 'deactivated', async () => {
        const off = await importCsv();
        expect(off.statusCode, off.body).toBe(403);
        const error = (off.json() as { error: { code: string; details?: { permission?: string } } }).error;
        expect(error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
        expect(error.details?.permission).toBe('carts.create');
      });

      const back = await importCsv();
      expect(back.statusCode, back.body).toBe(200);
    });
  });
});
