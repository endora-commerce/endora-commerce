import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import { SalesRepAssignmentService } from './sales-rep-assignment-service.js';
import type { OrganizationTreeService } from './organization-tree-service.js';

/**
 * Issue #305, architect ruling on PR #954 (Q1) — a governing organization
 * whose stored tree path cannot be read is resolved by the one-id rule, and
 * the request that hits that fallback says so: one `warn`, naming the
 * organization, so the data defect is found rather than silently tolerated.
 */
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BROKEN = id(1);
const FINE = id(2);
const REP = id(9);

/**
 * The reach statement's one row (issue #955): both lists as aggregates, and the
 * governing organizations whose own path cannot be read — which the SQL finds;
 * the integration property holds that half against a real unreadable path.
 */
function serviceOver(row: { excluded: string | null; assigned: string | null; unreadable: string | null }) {
  const em = { execute: vi.fn(async () => [row]) } as unknown as EntityManager;
  const warn = vi.fn();
  const service = new SalesRepAssignmentService(() => em, undefined, {
    treeService: {} as OrganizationTreeService,
    hasRollupCapability: async () => true,
    warn,
  });
  return { service, warn };
}

describe('SalesRepAssignmentService.reachOf — an unreadable governing path', () => {
  it('warns once per call, naming the organization, and still answers by the one-id rule', async () => {
    const { service, warn } = serviceOver({ excluded: `${BROKEN},${FINE}`, assigned: null, unreadable: BROKEN });
    const reach = await service.reachOf(REP);
    expect([...reach.excludedOrganizationIds].sort()).toEqual([BROKEN, FINE].sort());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toEqual({ organizationIds: [BROKEN] });
  });

  it('says nothing when every governing path is readable', async () => {
    const { service, warn } = serviceOver({ excluded: null, assigned: FINE, unreadable: null });
    await service.reachOf(REP);
    expect(warn).not.toHaveBeenCalled();
  });
});
