import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PersonalOrganizationPort } from '@endora-commerce/contracts';
import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * `specs/177-tax-id-scope/` T011 (FR-003) — personal provisioning is idempotent
 * by the account link, over the composed ports and the real table.
 *
 * A personal organization has no tax ID from this release on; what finds "the
 * account's own personal organization" is `personal_account_id`. The unassign
 * destination must stay that same organization while the account belongs to a
 * company, and two concurrent provisionings for one account must leave one row
 * — the partial unique index on the link is what refuses the second.
 */
describe('personal organizations — provisioning by the account link', () => {
  let h: BackendServerHandle;

  async function sql<T = unknown>(statement: string, params: unknown[] = []): Promise<T> {
    return h.em().fork().getConnection().execute(statement, params) as Promise<T>;
  }

  async function rowsFor(accountId: string): Promise<Array<{ id: string; tax_id: string | null; is_personal: boolean }>> {
    return sql(
      `select "id", "tax_id", "is_personal" from "organizations" where "personal_account_id" = ?`,
      [accountId],
    );
  }

  /** A customer account in a fresh personal organization, provisioned the way `customer_accounts` does it. */
  async function personalAccount(): Promise<{ accountId: string; organizationId: string }> {
    const api = h.container.resolve<PersonalOrganizationProvisionApi>('personalOrganizationProvisionApi');
    const accountId = randomUUID();
    const em = h.em().fork();
    const organizationId = await em.transactional(async (tx) => {
      const provisioned = await api.provisionFor(tx, {
        customerAccountId: accountId,
        email: `${accountId.slice(0, 8)}@link.example`,
        firstName: 'Link',
        lastName: 'Test',
        salesChannelId: null,
      });
      await tx.execute(
        `insert into "customer_accounts"
           ("id","organization_id","organization_role_id","email","password_hash","first_name","last_name","created_at","updated_at")
         values (?, ?, ?, ?, 'x', 'Link', 'Test', now(), now())`,
        [accountId, provisioned.id, provisioned.administratorRoleId, `${accountId.slice(0, 8)}@link.example`],
      );
      return provisioned.id;
    });
    return { accountId, organizationId };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a provisioned personal organization has no tax ID and links to its account', async () => {
    const { accountId, organizationId } = await personalAccount();
    expect(await rowsFor(accountId)).toEqual([{ id: organizationId, tax_id: null, is_personal: true }]);

    const port = h.container.resolve<PersonalOrganizationPort>('personalOrganizationPort');
    const again = await port.ensureForCustomerAccount(accountId);
    expect(again.id).toBe(organizationId);
    expect(again.taxId).toBeNull();
  });

  it('provisioning twice for one account answers the same organization', async () => {
    const { accountId, organizationId } = await personalAccount();
    const port = h.container.resolve<PersonalOrganizationPort>('personalOrganizationPort');
    const first = await port.provisionPersonalOrganization(accountId);
    const second = await port.provisionPersonalOrganization(accountId);
    expect(first.id).toBe(organizationId);
    expect(second.id).toBe(organizationId);
    expect(await rowsFor(accountId)).toHaveLength(1);
  });

  it('the unassign destination is the account’s own personal organization while it belongs to a company', async () => {
    const { accountId, organizationId } = await personalAccount();
    const companyId = randomUUID();
    await sql(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","is_personal","registered_address","path","created_at","updated_at")
       values (?, 'Link company', ?, 'active', 'vat_payer', false, '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::jsonb, ?, now(), now())`,
      [companyId, `LINK${companyId.replace(/-/g, '').slice(0, 12).toUpperCase()}`, `/${companyId}/`],
    );
    await sql(`update "customer_accounts" set "organization_id" = ?, "organization_role_id" = ? where "id" = ?`, [
      companyId,
      await predefinedRoleIdOf(h.em(), companyId, 'member'),
      accountId,
    ]);

    const port = h.container.resolve<PersonalOrganizationPort>('personalOrganizationPort');
    const destination = await port.provisionPersonalOrganization(accountId);
    expect(destination.id).toBe(organizationId);
    expect(destination.taxId).toBeNull();
    expect(await rowsFor(accountId)).toHaveLength(1);
  });

  it('two concurrent provisionings for one account leave one row', async () => {
    const api = h.container.resolve<PersonalOrganizationProvisionApi>('personalOrganizationProvisionApi');
    const accountId = randomUUID();
    const attempt = () =>
      h
        .em()
        .fork()
        .transactional((tx) =>
          api.provisionFor(tx, {
            customerAccountId: accountId,
            email: `${accountId.slice(0, 8)}@race.example`,
            salesChannelId: null,
          }),
        );

    const outcomes = await Promise.allSettled([attempt(), attempt()]);
    const won = outcomes.filter((o): o is PromiseFulfilledResult<{ id: string; administratorRoleId: string }> => o.status === 'fulfilled');
    expect(won.length).toBeGreaterThanOrEqual(1);
    for (const lost of outcomes.filter((o) => o.status === 'rejected')) {
      // The loser meets the link's unique index, never a second row.
      expect(String((lost as PromiseRejectedResult).reason)).toMatch(/organizations_personal_account_id_unique|duplicate key/);
    }
    const rows = await rowsFor(accountId);
    expect(rows).toHaveLength(1);
    expect(new Set(won.map((o) => o.value.id))).toEqual(new Set([rows[0]!.id]));
  });
});
