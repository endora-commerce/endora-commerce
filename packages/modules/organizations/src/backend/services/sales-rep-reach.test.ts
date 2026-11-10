import { describe, expect, it } from 'vitest';
import { reachFromAggregate } from './sales-rep-reach.js';

/**
 * Issue #955 — the reach statement answers each list as one aggregate
 * (`string_agg(id, ',')`), one row for the whole reach rather than one row per
 * organization. Which organization lands in which list is the SQL's and is
 * held against `canSeeOrganization` by the integration property
 * (`test/integration/organizations/sales-rep-reach-property.test.ts`); this is
 * the reading back.
 */
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('reachFromAggregate', () => {
  it('splits both lists', () => {
    expect(reachFromAggregate({ excluded: `${id(1)},${id(2)}`, assigned: id(3) }, true)).toEqual({
      excludedOrganizationIds: [id(1), id(2)],
      assignedOrganizationIds: [id(3)],
      rollup: true,
    });
  });

  it('an empty aggregate is SQL null and reads as an empty list — nobody else governs anything', () => {
    expect(reachFromAggregate({ excluded: null, assigned: null }, false)).toEqual({
      excludedOrganizationIds: [],
      assignedOrganizationIds: [],
      rollup: false,
    });
  });

  it('no row at all reads as the same empty answer', () => {
    expect(reachFromAggregate(undefined, false)).toEqual({ excludedOrganizationIds: [], assignedOrganizationIds: [], rollup: false });
  });
});
