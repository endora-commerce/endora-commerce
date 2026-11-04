import { describe, expect, it } from 'vitest';
import type { CustomerAccountRecord } from '@endora-commerce/contracts';
import type { ImportExportPorts } from '../adapter.js';
import { customersAdapter } from './customers.adapter.js';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ROLE = '00000000-0000-4000-8000-0000000170b2';

function account(): CustomerAccountRecord {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: ORG,
    email: 'ada@example.test',
    firstName: 'Ada',
    lastName: 'Lovelace',
    organizationRoleId: ROLE,
    emailVerifiedAt: new Date('2026-11-01T10:00:00.000Z'),
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    customFieldValues: {},
    deletedAt: null,
  } as CustomerAccountRecord;
}

/**
 * `specs/170-organization-roles/` WP-12 — the legacy two-value `role` is gone
 * from the account record, so the export names the role the account holds by
 * its id, in the column's place.
 */
describe('customers export', () => {
  const ports = {
    customerAccounts: { listAll: async () => [account()] },
    organizations: { findByIds: async () => [{ id: ORG, name: 'Acme' }] },
  } as unknown as ImportExportPorts;

  it('names the held organization role by id, where the legacy role column was', async () => {
    const adapter = customersAdapter(ports);
    expect(adapter.exportHeader).toEqual([
      'email',
      'organization_name',
      'first_name',
      'last_name',
      'organization_role_id',
      'email_verified_at',
      'last_login_at',
    ]);
    expect(await adapter.exportRows()).toEqual([
      ['ada@example.test', 'Acme', 'Ada', 'Lovelace', ROLE, '2026-11-01T10:00:00.000Z', ''],
    ]);
  });
});
