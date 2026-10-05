/**
 * The organizations an admin reaches are read off the role the admin holds.
 *
 * There is no answer for an admin without a role, and "every organization" is
 * never the answer to a question nobody could answer.
 */
import type { AdminRoleRecord, AdminRoleResolution } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { createAdminTenantScopePort } from './admin-tenant-scope.js';

function role(code: string): AdminRoleRecord {
  return {
    id: 'r1',
    code,
    name: code,
    permissions: [],
    requiresTwoFactor: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function portOver(resolution: AdminRoleResolution, assigned: string[] = []) {
  return createAdminTenantScopePort(
    { resolveRole: async () => resolution },
    { listAssignedOrganizationIds: async () => assigned },
  );
}

describe('adminTenantScopePort', () => {
  it('gives an admin holding an unconfined role every organization', async () => {
    const scope = await portOver({ role: role('platform_admin') }).resolveForAdmin('a1');
    expect(scope).toEqual({ allowAll: true });
  });

  it('confines a sales representative to the organizations assigned to them', async () => {
    const scope = await portOver({ role: role('sales_representative') }, ['o1', 'o2']).resolveForAdmin('a1');
    expect(scope).toEqual({ allowAll: false, allowedOrganizationIds: ['o1', 'o2'] });
  });

  it('gives a sales representative with no assignment nothing', async () => {
    const scope = await portOver({ role: role('sales_representative') }).resolveForAdmin('a1');
    expect(scope).toEqual({ allowAll: false, allowedOrganizationIds: [] });
  });

  it('gives an admin without a role no organization, and carries the refusal', async () => {
    const refusal = new Error('no role');
    const scope = await portOver({ refusal }, ['o1']).resolveForAdmin('a1');

    expect(scope).toEqual({ allowAll: false, allowedOrganizationIds: [], unresolved: refusal });
  });
});
