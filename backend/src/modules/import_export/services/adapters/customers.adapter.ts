import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerAccount } from '../../../customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../../organizations/entities/organization.entity.js';
import type { ImportExportAdapter } from '../adapter.js';

/**
 * Customer accounts: export only.
 *
 * Importing customer accounts safely requires a password-handling story
 * (random secret + forced reset email) that doesn't belong in a CSV
 * upload UI. Operators that need to provision accounts in bulk should
 * use the API + the password-reset flow.
 */
export const customersAdapter: ImportExportAdapter = {
  name: 'customers',
  exportHeader: [
    'email',
    'organization_name',
    'first_name',
    'last_name',
    'role',
    'email_verified_at',
    'last_login_at',
  ] as const,

  async exportRows(em: EntityManager): Promise<string[][]> {
    const accounts = await em.find(CustomerAccount, {});
    if (accounts.length === 0) return [];
    const orgIds = Array.from(new Set(accounts.map((a) => a.organizationId)));
    const orgs = await em.find(Organization, { id: { $in: orgIds } });
    const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));
    return accounts.map((a) => [
      a.email,
      orgNameById.get(a.organizationId) ?? '',
      a.firstName,
      a.lastName,
      a.role,
      a.emailVerifiedAt?.toISOString() ?? '',
      a.lastLoginAt?.toISOString() ?? '',
    ]);
  },
};
