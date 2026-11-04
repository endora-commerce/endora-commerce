import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrganizationPermissionPort } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * The member's role travels on the actor (`specs/170-organization-roles/`
 * WP-02b, T043; research R-15; FR-081).
 *
 * `customerOrgResolver` is the read `auth`'s request hook already makes once
 * per request; it answers `organizationRoleId` beside `organizationId`, and the
 * hook stamps it on `request.actor`. Because the account row is read fresh on
 * every request — assignments are never cached (R-15, R-16) — the request after
 * a role change is judged by the new role, on every process, with no
 * announcement to wait for.
 */

type CustomerOrgResolver = (customerAccountId: string) => Promise<{
  organizationId: string | null;
  active: boolean;
  organizationRoleId: string;
} | null>;

interface RoleCommandPort {
  changeRole(input: { organizationId: string; customerAccountId: string; roleId: string }): Parameters<CommandBus['run']>[0];
}

describe('the actor carries the organization role', () => {
  let h: BackendServerHandle;
  let resolver: CustomerOrgResolver;
  let port: OrganizationPermissionPort;
  let account: string;
  let adminRoleId: string;
  let memberRoleId: string;

  async function roleId(kind: 'administrator' | 'member'): Promise<string> {
    const [row] = (await h.em().getConnection().execute(
      `select "id" from "organization_roles" where "organization_id" = ? and "kind" = ?`,
      [TEST_ORGANIZATION_ID, kind],
    )) as Array<{ id: string }>;
    return row!.id;
  }

  async function changeRole(to: string): Promise<void> {
    const cradle = h.container.cradle as unknown as {
      commandBus: CommandBus;
      customerAccountRoleCommandPort: RoleCommandPort;
    };
    await withSystemScope('test: change a member role', () =>
      cradle.commandBus.run(
        cradle.customerAccountRoleCommandPort.changeRole({
          organizationId: TEST_ORGANIZATION_ID,
          customerAccountId: account,
          roleId: to,
        }),
      ),
    );
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const cradle = h.container.cradle as unknown as {
      customerOrgResolver: CustomerOrgResolver;
      organizationPermissionPort: OrganizationPermissionPort;
    };
    resolver = cradle.customerOrgResolver;
    port = cradle.organizationPermissionPort;
    adminRoleId = await roleId('administrator');
    memberRoleId = await roleId('member');
    account = randomUUID();
    await h.em().getConnection().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Actor', 'Role', now(), now())`,
      [account, TEST_ORGANIZATION_ID, `${account.slice(0, 8)}@actor-role.example`],
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it("answers the account's role id beside its Organization (R-15)", async () => {
    expect(await resolver(account)).toEqual({
      organizationId: TEST_ORGANIZATION_ID,
      active: true,
      organizationRoleId: memberRoleId,
    });
  });

  it('judges the next request by the new role, with no cache drop and no announcement (FR-081)', async () => {
    const subjectOf = async () => {
      const answer = await resolver(account);
      return {
        customerAccountId: account,
        organizationId: answer!.organizationId!,
        organizationRoleId: answer!.organizationRoleId,
      };
    };
    // Warm this process's role cache: the roles themselves are cached, the assignment is not.
    expect(await port.isAdministrator(await subjectOf())).toBe(false);

    await changeRole(adminRoleId);
    expect((await resolver(account))?.organizationRoleId).toBe(adminRoleId);
    expect(await port.isAdministrator(await subjectOf())).toBe(true);

    await changeRole(memberRoleId);
    expect(await port.isAdministrator(await subjectOf())).toBe(false);
  });

  it("falls back to the account's own role id for a subject that carries none", async () => {
    await changeRole(adminRoleId);
    expect(
      await port.isAdministrator({ customerAccountId: account, organizationId: TEST_ORGANIZATION_ID }),
    ).toBe(true);
    await changeRole(memberRoleId);
    expect(
      await port.isAdministrator({ customerAccountId: account, organizationId: TEST_ORGANIZATION_ID }),
    ).toBe(false);
  });
});
