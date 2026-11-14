/**
 * The organizations an admin reaches are read off the role the admin holds.
 *
 * There is no answer for an admin without a role, and "every organization" is
 * never the answer to a question nobody could answer.
 */
import type { AdminRoleRecord, AdminRoleResolution, AdminTenantScope } from '@endora-commerce/contracts';
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
  const port = createAdminTenantScopePort(
    {
      resolveRole: async () => resolution,
      resolveRoles: async (ids) => new Map(ids.map((id) => [id, resolution])),
    },
    {
      reachOf: reach,
      hasRollupCapability,
      hasRollupCapabilities: async (ids) => new Set((await hasRollupCapability()) ? ids : []),
    },
  );
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

/**
 * Issue #461 — `resolveForAdmins`, the scope of many administrators at once:
 * per id, the scope `resolveForAdmin` answers, from one batched role read and
 * one batched roll-up read, whatever the number of ids.
 */
describe('adminTenantScopePort.resolveForAdmins (issue #461)', () => {
  const RESOLUTIONS: Record<string, AdminRoleResolution> = {
    platform: { role: role('platform_admin') },
    'rep-rollup': { role: role('sales_representative') },
    'rep-flat': { role: role('sales_representative') },
    roleless: { refusal: new Error('no role') },
  };
  const ROLLUP = new Set(['rep-rollup']);

  function batchedPort(rollupDown?: Error) {
    const calls = { resolveRole: 0, resolveRoles: 0, hasRollupCapability: 0, hasRollupCapabilities: 0 };
    const reachOf = vi.fn(async (adminUserId: string) => ({
      excludedOrganizationIds: [`x-${adminUserId}`],
      assignedOrganizationIds: [`a-${adminUserId}`],
      rollup: ROLLUP.has(adminUserId),
    }));
    const port = createAdminTenantScopePort(
      {
        resolveRole: async (id) => {
          calls.resolveRole += 1;
          return RESOLUTIONS[id] ?? { refusal: new Error('nobody') };
        },
        resolveRoles: async (ids) => {
          calls.resolveRoles += 1;
          return new Map(ids.map((id) => [id, RESOLUTIONS[id] ?? { refusal: new Error('nobody') }]));
        },
      },
      {
        reachOf,
        hasRollupCapability: async (id) => {
          calls.hasRollupCapability += 1;
          if (rollupDown) throw rollupDown;
          return ROLLUP.has(id);
        },
        hasRollupCapabilities: async (ids) => {
          calls.hasRollupCapabilities += 1;
          if (rollupDown) throw rollupDown;
          return new Set(ids.filter((id) => ROLLUP.has(id)));
        },
      },
    );
    return { port, calls, reachOf };
  }

  /** A scope as plain data: the loader is compared by what it loads. */
  async function plain(scope: AdminTenantScope | undefined): Promise<unknown> {
    if (scope && 'loadReach' in scope) return { ...scope, loadReach: await scope.loadReach() };
    return scope;
  }

  it('answers, for every id asked, the scope resolveForAdmin answers', async () => {
    const ids = ['platform', 'rep-rollup', 'rep-flat', 'roleless', 'nobody'];
    const { port, calls } = batchedPort();
    const batched = await port.resolveForAdmins([...ids, 'platform']);
    expect(calls).toEqual({ resolveRole: 0, resolveRoles: 1, hasRollupCapability: 0, hasRollupCapabilities: 1 });
    expect([...batched.keys()].sort()).toEqual([...ids].sort());
    const single = batchedPort().port;
    for (const id of ids) {
      const one = await single.resolveForAdmin(id);
      if ('unresolved' in one && one.unresolved) {
        expect(batched.get(id), id).toMatchObject({ allowAll: false, allowedOrganizationIds: [] });
        expect((batched.get(id) as { unresolved?: Error }).unresolved, id).toBeInstanceOf(Error);
      } else {
        expect(await plain(batched.get(id)), id).toEqual(await plain(one));
      }
    }
    expect(batched.get('rep-rollup')).toMatchObject({
      excludedOrganizationsQuery: { params: ['rep-rollup', true] },
    });
    expect(batched.get('rep-flat')).toMatchObject({ excludedOrganizationsQuery: { params: ['rep-flat', false] } });
  });

  it('does not ask the roll-up question when nobody asked is a representative', async () => {
    const { port, calls } = batchedPort();
    await port.resolveForAdmins(['platform', 'roleless']);
    expect(calls.hasRollupCapabilities).toBe(0);
  });

  it('computes no reach while resolving the scopes', async () => {
    const { port, reachOf } = batchedPort();
    await port.resolveForAdmins(['rep-rollup', 'rep-flat']);
    expect(reachOf).not.toHaveBeenCalled();
  });

  it('a failure of the roll-up question answers every representative unresolved, as one call would', async () => {
    const down = new Error('permission read failed');
    const scopes = await batchedPort(down).port.resolveForAdmins(['platform', 'rep-rollup', 'rep-flat']);
    expect(scopes.get('platform')).toEqual({ allowAll: true });
    for (const id of ['rep-rollup', 'rep-flat']) {
      expect(scopes.get(id)).toEqual({ allowAll: false, allowedOrganizationIds: [], unresolved: down });
    }
  });

  it('asks nothing for no ids', async () => {
    const { port, calls } = batchedPort();
    expect((await port.resolveForAdmins([])).size).toBe(0);
    expect(calls).toEqual({ resolveRole: 0, resolveRoles: 0, hasRollupCapability: 0, hasRollupCapabilities: 0 });
  });
});
