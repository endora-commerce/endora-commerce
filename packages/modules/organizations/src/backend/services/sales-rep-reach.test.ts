import { describe, expect, it } from 'vitest';
import { decideSalesRepReach } from './sales-rep-reach.js';

/**
 * Issue #305 — the decision half of `SalesRepAssignmentService.reachOf`.
 *
 * The statement hands back every organization carrying an assignment (and
 * whether the representative is on it), plus, under roll-up, every node below
 * one of them. This decides, per node, which representative governs it — the
 * nearest ancestor-or-self carrying an assignment — and so whether it is the
 * representative's own (`assignedOrganizationIds`) or somebody else's
 * (`excludedOrganizationIds`). An organization in neither list is unassigned
 * and in reach of every representative.
 */
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1); // R's
const AC = id(2); // unassigned child of A
const RS = id(3); // S's child of A (override)
const SS = id(4); // S's
const SC = id(5); // unassigned child of S
const SR = id(6); // R's child of S (override)
const AB = id(7); // R's and S's

const governors = [
  { organizationId: A, path: `/${A}/`, mine: true },
  { organizationId: RS, path: `/${A}/${RS}/`, mine: false },
  { organizationId: SS, path: `/${SS}/`, mine: false },
  { organizationId: SR, path: `/${SS}/${SR}/`, mine: true },
  { organizationId: AB, path: `/${AB}/`, mine: true },
];
const descendants = [
  { id: AC, path: `/${A}/${AC}/` },
  { id: RS, path: `/${A}/${RS}/` },
  { id: SC, path: `/${SS}/${SC}/` },
  { id: SR, path: `/${SS}/${SR}/` },
];

describe('decideSalesRepReach', () => {
  it('flat: a node is governed by its own assignment rows only', () => {
    const reach = decideSalesRepReach({ rollup: false, governors, descendants: [] });
    expect([...reach.excludedOrganizationIds].sort()).toEqual([RS, SS].sort());
    expect([...reach.assignedOrganizationIds].sort()).toEqual([A, SR, AB].sort());
  });

  it('roll-up: the nearest governing node decides, the override included', () => {
    const reach = decideSalesRepReach({ rollup: true, governors, descendants });
    expect([...reach.excludedOrganizationIds].sort()).toEqual([RS, SS, SC].sort());
    expect([...reach.assignedOrganizationIds].sort()).toEqual([A, AC, SR, AB].sort());
  });

  it('nobody assigned anywhere: an empty answer, which means every organization is in reach', () => {
    expect(decideSalesRepReach({ rollup: true, governors: [], descendants: [] })).toEqual({
      excludedOrganizationIds: [],
      assignedOrganizationIds: [],
    });
  });

  it('roll-up: a governing node whose stored path cannot be read governs itself and whatever names it', () => {
    // Its descendants are found by the segment their own paths carry, so they
    // arrive as descendants with readable paths that name it.
    const child = id(8);
    const reach = decideSalesRepReach({
      rollup: true,
      governors: [{ organizationId: SS, path: '', mine: false }],
      descendants: [{ id: child, path: `/${SS}/${child}/` }],
    });
    expect([...reach.excludedOrganizationIds].sort()).toEqual([SS, child].sort());
  });

  it('a descendant whose own path cannot be read is decided by its own rows only', () => {
    const broken = id(9);
    const reach = decideSalesRepReach({
      rollup: true,
      governors: [{ organizationId: SS, path: `/${SS}/`, mine: false }],
      descendants: [{ id: broken, path: `/${SS}/%/${broken}/` }],
    });
    expect(reach.excludedOrganizationIds).toEqual([SS]);
  });
});
