import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
  OrganizationPermissionPort,
  OrganizationRoleReadPort,
} from '@endora-commerce/contracts';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { PersonalOrganizationService } from '../../../../packages/modules/organizations/src/backend/services/personal-organization-service.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';

/**
 * Every path into a personal Organization assigns its *Administrator*
 * (`specs/170-organization-roles/` WP-02b, T117; owner rulings PR-3, PR-11;
 * research R-34; FR-070a).
 *
 * Self-registration, the federated sign-in's account creation,
 * `ensureForCustomerAccount` and the operator's detach each leave the account
 * holding its personal Organization's administrator role. The provisioning seam
 * answers that role's id read on the **caller's** `EntityManager`, because the
 * two creating paths write the Organization and the account in one transaction.
 * An operator's assign to a company lands on the target's predefined role of the
 * kind held; the composite foreign key refuses any role of the previous
 * Organization, so no path can leave one behind.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

interface Cradle {
  customerAccountReadPort: CustomerAccountReadPort;
  customerAccountMemberWritePort: CustomerAccountMemberWritePort;
  organizationPermissionPort: OrganizationPermissionPort;
  organizationRoleReadPort: OrganizationRoleReadPort;
  personalOrganizationProvisionApi: PersonalOrganizationProvisionApi;
  customerSocialLoginPort: {
    autoCreate(email: string, context: { salesChannelId: string | null }): Promise<{ id: string } | null>;
  };
}

describe('a personal Organization is administered by its member', () => {
  let h: BackendServerHandle;
  let cradle: Cradle;

  async function sql<T>(statement: string, params: unknown[] = []): Promise<T[]> {
    return (await h.em().getConnection().execute(statement, params)) as T[];
  }

  async function account(id: string): Promise<{ organization_id: string; organization_role_id: string }> {
    const [row] = await sql<{ organization_id: string; organization_role_id: string }>(
      `select "organization_id","organization_role_id" from "customer_accounts" where "id" = ?`,
      [id],
    );
    return row!;
  }

  async function roleId(organizationId: string, kind: 'administrator' | 'member'): Promise<string> {
    const [row] = await sql<{ id: string }>(
      `select "id" from "organization_roles" where "organization_id" = ? and "kind" = ?`,
      [organizationId, kind],
    );
    return row!.id;
  }

  async function isPersonal(organizationId: string): Promise<boolean> {
    const [row] = await sql<{ is_personal: boolean }>(`select "is_personal" from "organizations" where "id" = ?`, [
      organizationId,
    ]);
    return row!.is_personal;
  }

  /** The account holds its own personal Organization's administrator role, by both answers. */
  async function expectPersonalAdministrator(customerAccountId: string): Promise<void> {
    const row = await account(customerAccountId);
    expect(await isPersonal(row.organization_id)).toBe(true);
    expect(row.organization_role_id).toBe(await roleId(row.organization_id, 'administrator'));
    expect(row.organization_role_id).toBe(
      await cradle.organizationRoleReadPort.predefinedRoleId(row.organization_id, 'administrator'),
    );
    expect(
      await cradle.organizationPermissionPort.isAdministrator({
        customerAccountId,
        organizationId: row.organization_id,
        organizationRoleId: row.organization_role_id,
      }),
    ).toBe(true);
  }

  async function register(): Promise<string> {
    const email = `pa-${randomUUID().slice(0, 8)}@personal-admin.example`;
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password: 'a-very-strong-pass', firstName: 'Per', lastName: 'Sonal', acceptedTermsVersion: 'v1' },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { customerAccount: { id: string } } }).data.customerAccount.id;
  }

  async function insertCompanyAccount(organizationId: string, roleIdValue: string): Promise<string> {
    const id = randomUUID();
    await sql(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name",
          "organization_role_id","created_at","updated_at")
       values (?, ?, ?, 'x', 'Com', 'Pany', ?, now(), now())`,
      [id, organizationId, `${id.slice(0, 8)}@personal-admin.example`, roleIdValue],
    );
    return id;
  }

  async function assignTo(customerAccountId: string, organizationId: string): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${customerAccountId}/organization`,
      cookies: ADMIN,
      payload: { organizationId },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  async function detach(customerAccountId: string): Promise<void> {
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customers/${customerAccountId}/organization`,
      cookies: ADMIN,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    cradle = h.container.cradle as unknown as Cradle;
    await seedOtherTestOrganization(h.em());
    await h.settings.adminService.setValueForAllChannels(
      'customers.allow_registration_without_organization',
      true,
      null,
      { actorAdminUserId: null },
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('self-registration (createStandalone)', async () => {
    const id = await register();
    await expectPersonalAdministrator(id);
  });

  it("the federated sign-in's account creation", async () => {
    const created = await cradle.customerSocialLoginPort.autoCreate(
      `fed-${randomUUID().slice(0, 8)}@personal-admin.example`,
      { salesChannelId: null },
    );
    expect(created).not.toBeNull();
    await expectPersonalAdministrator(created!.id);
  });

  it('ensureForCustomerAccount, when it has to provision', async () => {
    // The repair arm is reached only by an account whose Organization cannot be
    // found; the read port is narrowed to say so, everything else is the real
    // composition.
    const id = await insertCompanyAccount(TEST_ORGANIZATION_ID, await roleId(TEST_ORGANIZATION_ID, 'member'));
    const real = await cradle.customerAccountReadPort.findById(id);
    const service = new PersonalOrganizationService(() => h.em().fork(), {
      read: { ...cradle.customerAccountReadPort, findById: async () => ({ ...real!, organizationId: randomUUID() }) },
      write: cradle.customerAccountMemberWritePort,
    });
    await withSystemScope('test: ensure a personal organization', () => service.ensureForCustomerAccountId(id));
    await expectPersonalAdministrator(id);
  });

  it("the operator's detach to the personal Organization", async () => {
    const id = await insertCompanyAccount(TEST_ORGANIZATION_ID, await roleId(TEST_ORGANIZATION_ID, 'member'));
    await detach(id);
    await expectPersonalAdministrator(id);
  });

  it("answers the administrator role id read inside the caller's own transaction", async () => {
    const customerAccountId = randomUUID();
    let answered: { id: string; administratorRoleId: string } | undefined;
    await withSystemScope('test: provision inside a transaction', () =>
      h.em().fork().transactional(async (em: EntityManager) => {
        answered = await cradle.personalOrganizationProvisionApi.provisionFor(em, {
          customerAccountId,
          email: `tx-${customerAccountId.slice(0, 8)}@personal-admin.example`,
          salesChannelId: null,
        });
        // Not committed yet: only this transaction can see the new row.
        const [row] = (await em.getConnection().execute(
          `select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'administrator'`,
          [answered.id],
          'all',
          em.getTransactionContext(),
        )) as Array<{ id: string }>;
        expect(answered.administratorRoleId).toBe(row!.id);
      }),
    );
    expect(answered!.administratorRoleId).toBe(await roleId(answered!.id, 'administrator'));
  });

  describe("the operator's assign to a company keeps the kind held (PR-11)", () => {
    it('an administrator stays an administrator, and a member stays a member', async () => {
      const admin = await insertCompanyAccount(TEST_ORGANIZATION_ID, await roleId(TEST_ORGANIZATION_ID, 'administrator'));
      const member = await insertCompanyAccount(TEST_ORGANIZATION_ID, await roleId(TEST_ORGANIZATION_ID, 'member'));
      await assignTo(admin, OTHER_TEST_ORGANIZATION_ID);
      await assignTo(member, OTHER_TEST_ORGANIZATION_ID);
      expect((await account(admin)).organization_role_id).toBe(await roleId(OTHER_TEST_ORGANIZATION_ID, 'administrator'));
      expect((await account(member)).organization_role_id).toBe(await roleId(OTHER_TEST_ORGANIZATION_ID, 'member'));
    });

    it('a custom role does not travel: its holder becomes a member', async () => {
      const custom = randomUUID();
      await sql(
        `insert into "organization_roles" ("id","organization_id","kind","name","name_normalized")
         values (?, ?, 'custom', ?, ?)`,
        [custom, TEST_ORGANIZATION_ID, `Travel ${custom.slice(0, 6)}`, `travel ${custom.slice(0, 6)}`],
      );
      const holder = await insertCompanyAccount(TEST_ORGANIZATION_ID, custom);
      await assignTo(holder, OTHER_TEST_ORGANIZATION_ID);
      expect((await account(holder)).organization_role_id).toBe(await roleId(OTHER_TEST_ORGANIZATION_ID, 'member'));
    });

    it("a self-registered individual becomes a member, not the company's administrator (today's outcome)", async () => {
      const id = await register();
      await assignTo(id, OTHER_TEST_ORGANIZATION_ID);
      const row = await account(id);
      expect(row.organization_id).toBe(OTHER_TEST_ORGANIZATION_ID);
      expect(row.organization_role_id).toBe(await roleId(OTHER_TEST_ORGANIZATION_ID, 'member'));
    });
  });
});
