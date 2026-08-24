import type { ImportExportAdapter, ImportExportPorts } from '../adapter.js';

/**
 * Customer accounts: export only.
 *
 * Importing customer accounts safely requires a password-handling story
 * (random secret + forced reset email) that doesn't belong in a CSV
 * upload UI. Operators that need to provision accounts in bulk should
 * use the API + the password-reset flow.
 *
 * Feature 075 / D-74 — two owners, because the sheet names an account's
 * organisation: the entity is offered only while both modules are effectively
 * present, and `organizations` being off removes this one export rather than
 * breaking the centre.
 */
export function customersAdapter(ports: ImportExportPorts): ImportExportAdapter {
  return {
    name: 'customers',
    owners: ['customer_accounts', 'organizations'],
    exportHeader: [
      'email',
      'organization_name',
      'first_name',
      'last_name',
      'role',
      'email_verified_at',
      'last_login_at',
    ] as const,

    async exportRows(): Promise<string[][]> {
      const accounts = await ports.customerAccounts.listAll();
      if (accounts.length === 0) return [];
      const orgIds = Array.from(
        new Set(
          accounts
            .map((a) => a.organizationId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      );
      const orgs = orgIds.length > 0 ? await ports.organizations.findByIds(orgIds) : [];
      const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));
      return accounts.map((a) => [
        a.email,
        a.organizationId ? (orgNameById.get(a.organizationId) ?? '') : '',
        a.firstName,
        a.lastName,
        a.role,
        a.emailVerifiedAt?.toISOString() ?? '',
        a.lastLoginAt?.toISOString() ?? '',
      ]);
    },
  };
}
