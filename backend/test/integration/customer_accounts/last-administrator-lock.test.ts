import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CustomerRolePort } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The last-administrator guard is race-free (`specs/170-organization-roles/`
 * WP-02b, T041; research R-29; `contracts/commands-audit-events.md` §3).
 *
 * `customer_account.change_role` and `customer_account.remove_member` lock the
 * Organization's active administrators (`select … for update`) inside their own
 * transaction before counting, so two concurrent demotions — or a demotion and a
 * removal — of an Organization's two administrators cannot both pass: the second
 * waits for the first to commit, then counts again and refuses.
 */

interface RoleCommandPort {
  changeRole(input: { organizationId: string; customerAccountId: string; roleId: string }): Parameters<CommandBus['run']>[0];
}

describe('two administrators stepping down at once', () => {
  let h: BackendServerHandle;
  let bus: CommandBus;
  let port: RoleCommandPort;
  let members: CustomerRolePort;

  async function sql<T>(statement: string, params: unknown[] = []): Promise<T[]> {
    return (await h.em().getConnection().execute(statement, params)) as T[];
  }

  async function organizationWithTwoAdministrators(): Promise<{
    organizationId: string;
    admins: [string, string];
    memberRoleId: string;
  }> {
    const organizationId = randomUUID();
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","created_at","updated_at")
       values (?, 'Two admins', ?, 'active', 'vat_payer', '{}'::jsonb, ?, now(), now())`,
      [organizationId, `lock-${organizationId.slice(0, 13)}`, `/${organizationId}/`],
    );
    const admins: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const id = randomUUID();
      await sql(
        `insert into "customer_accounts"
           ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id","created_at","updated_at")
         values (?, ?, ?, 'x', 'Ad', 'Min',
                 (select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'administrator'),
                 now(), now())`,
        [id, organizationId, `${id.slice(0, 8)}@last-admin-lock.example`, organizationId],
      );
      admins.push(id);
    }
    const [member] = await sql<{ id: string }>(
      `select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'member'`,
      [organizationId],
    );
    return { organizationId, admins: admins as [string, string], memberRoleId: member!.id };
  }

  async function activeAdministrators(organizationId: string): Promise<number> {
    const [row] = await sql<{ n: string }>(
      `select count(*)::text as n from "customer_accounts" a
         join "organization_roles" r on r."id" = a."organization_role_id"
        where a."organization_id" = ? and r."kind" = 'administrator'
          and a."deleted_at" is null and a."blocked_at" is null`,
      [organizationId],
    );
    return Number(row!.n);
  }

  function run(command: Parameters<CommandBus['run']>[0]): Promise<unknown> {
    return withSystemScope('test: concurrent last-administrator guard', () => bus.run(command));
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const cradle = h.container.cradle as unknown as {
      commandBus: CommandBus;
      customerAccountRoleCommandPort: RoleCommandPort;
      customerRolePort: CustomerRolePort;
    };
    bus = cradle.commandBus;
    port = cradle.customerAccountRoleCommandPort;
    members = cradle.customerRolePort;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lets exactly one of two concurrent demotions pass', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { organizationId, admins, memberRoleId } = await organizationWithTwoAdministrators();
      const outcomes = await Promise.allSettled(
        admins.map((customerAccountId) =>
          run(port.changeRole({ organizationId, customerAccountId, roleId: memberRoleId })),
        ),
      );
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      const [refused] = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
      expect(refused!.reason).toMatchObject({ statusCode: 409, code: ERROR_CODES.CANNOT_DEMOTE_LAST_ADMIN });
      expect(await activeAdministrators(organizationId)).toBe(1);
    }
  });

  it('lets exactly one of a concurrent demotion and removal pass', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { organizationId, admins, memberRoleId } = await organizationWithTwoAdministrators();
      const outcomes = await Promise.allSettled([
        run(port.changeRole({ organizationId, customerAccountId: admins[0], roleId: memberRoleId })),
        withSystemScope('test: concurrent removal', () => members.removeMember(organizationId, admins[1])),
      ]);
      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
      expect(await activeAdministrators(organizationId)).toBe(1);
    }
  });
});
