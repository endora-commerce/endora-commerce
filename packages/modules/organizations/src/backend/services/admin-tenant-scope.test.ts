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

function portOver(
  resolution: AdminRoleResolution,
  assigned: string[] = [],
  excluded: string[] = [],
  reachOf?: () => Promise<{ excludedOrganizationIds: string[]; assignedOrganizationIds: string[] }>,
) {
  return createAdminTenantScopePort(
    { resolveRole: async () => resolution },
    { reachOf: reachOf ?? (async () => ({ excludedOrganizationIds: excluded, assignedOrganizationIds: assigned })) },
  );
}

describe('adminTenantScopePort', () => {
  it('gives an admin holding an unconfined role every organization', async () => {
    const scope = await portOver({ role: role('platform_admin') }).resolveForAdmin('a1');
    expect(scope).toEqual({ allowAll: true });
  });

  // Issue #305 — one reach rule: every organization but those governed by
  // somebody else, described by its complement.
  it('gives a sales representative every organization but those governed by somebody else', async () => {
    const scope = await portOver({ role: role('sales_representative') }, ['o1', 'o2'], ['f1']).resolveForAdmin('a1');
    expect(scope).toEqual({
      allowAll: false,
      reach: 'excluding',
      excludedOrganizationIds: ['f1'],
      assignedOrganizationIds: ['o1', 'o2'],
    });
  });

  it('gives a sales representative with no assignment every organization nobody else governs', async () => {
    const scope = await portOver({ role: role('sales_representative') }, [], ['f1']).resolveForAdmin('a1');
    expect(scope).toEqual({
      allowAll: false,
      reach: 'excluding',
      excludedOrganizationIds: ['f1'],
      assignedOrganizationIds: [],
    });
  });

  it('does not swallow a failure of the reach', async () => {
    const down = new Error('connection lost');
    await expect(
      portOver({ role: role('sales_representative') }, [], [], async () => {
        throw down;
      }).resolveForAdmin('a1'),
    ).rejects.toBe(down);
  });

  it('gives an admin without a role no organization, and carries the refusal', async () => {
    const refusal = new Error('no role');
    const scope = await portOver({ refusal }, ['o1']).resolveForAdmin('a1');

    expect(scope).toEqual({ allowAll: false, allowedOrganizationIds: [], unresolved: refusal });
  });
});
