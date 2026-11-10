/**
 * The organizations an admin reaches are read off the role the admin holds.
 *
 * There is no answer for an admin without a role, and "every organization" is
 * never the answer to a question nobody could answer.
 */
import type { AdminRoleRecord, AdminRoleResolution } from '@endora-commerce/contracts';
import { describe, expect, it, vi } from 'vitest';
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

const QUERY = (rollup: boolean) => ({
  sql: 'select x from "organizations_reach_excluded"(?::uuid, ?::boolean) as x',
  params: ['a1', rollup],
});

function portOver(
  resolution: AdminRoleResolution,
  assigned: string[] = [],
  excluded: string[] = [],
  reachOf?: () => Promise<{ excludedOrganizationIds: string[]; assignedOrganizationIds: string[]; rollup: boolean }>,
  hasRollupCapability: () => Promise<boolean> = async () => true,
) {
  const reach = vi.fn(
    reachOf ?? (async () => ({ excludedOrganizationIds: excluded, assignedOrganizationIds: assigned, rollup: true })),
  );
  const port = createAdminTenantScopePort({ resolveRole: async () => resolution }, { reachOf: reach, hasRollupCapability });
  return { port, reach };
}

describe('adminTenantScopePort', () => {
  it('gives an admin holding an unconfined role every organization', async () => {
    const scope = await portOver({ role: role('platform_admin') }).port.resolveForAdmin('a1');
    expect(scope).toEqual({ allowAll: true });
  });

  // Issue #305 — one reach rule: every organization but those governed by
  // somebody else, described by its complement. Issue #955 Phase 2 (owner
  // ruling of 2026-11-10): the scope carries what the filter renders — the
  // owner's live SELECT, with the roll-up flag — and a loader for the lists,
  // which resolving the scope does not call.
  it('gives a sales representative the excluding scope without computing the reach', async () => {
    const { port, reach } = portOver({ role: role('sales_representative') }, ['o1', 'o2'], ['f1']);
    const scope = await port.resolveForAdmin('a1');
    expect(scope).toEqual({
      allowAll: false,
      reach: 'excluding',
      excludedOrganizationsQuery: QUERY(true),
      loadReach: expect.any(Function),
    });
    expect(reach).not.toHaveBeenCalled();
  });

  it('carries the roll-up flag the permission answers', async () => {
    const { port } = portOver({ role: role('sales_representative') }, [], [], undefined, async () => false);
    const scope = await port.resolveForAdmin('a1');
    expect(scope).toMatchObject({ excludedOrganizationsQuery: QUERY(false) });
  });

  it('loads the lists on demand, once per scope', async () => {
    const { port, reach } = portOver({ role: role('sales_representative') }, ['o1'], ['f1']);
    const scope = (await port.resolveForAdmin('a1')) as { loadReach: () => Promise<unknown> };
    expect(await scope.loadReach()).toEqual({ excludedOrganizationIds: ['f1'], assignedOrganizationIds: ['o1'] });
    await scope.loadReach();
    expect(reach).toHaveBeenCalledTimes(1);
  });

  // Ruling Q1 on PR #954: a reach that cannot be computed is refused, never
  // widened. The lists are lazy now, so the refusal is the loader's: every
  // helper that awaits it throws.
  it('a failure of the reach rejects the loader', async () => {
    const down = new Error('connection lost');
    const { port } = portOver({ role: role('sales_representative') }, [], [], async () => {
      throw down;
    });
    const scope = (await port.resolveForAdmin('a1')) as { loadReach: () => Promise<unknown> };
    await expect(scope.loadReach()).rejects.toBe(down);
  });

  it('a failure of the roll-up question answers unresolved, holding no organization', async () => {
    const down = new Error('permission read failed');
    const { port } = portOver({ role: role('sales_representative') }, [], [], undefined, async () => {
      throw down;
    });
    expect(await port.resolveForAdmin('a1')).toEqual({ allowAll: false, allowedOrganizationIds: [], unresolved: down });
  });

  it('gives an admin without a role no organization, and carries the refusal', async () => {
    const refusal = new Error('no role');
    const scope = await portOver({ refusal }, ['o1']).port.resolveForAdmin('a1');

    expect(scope).toEqual({ allowAll: false, allowedOrganizationIds: [], unresolved: refusal });
  });
});
