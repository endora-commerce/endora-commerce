/**
 * The "in use" count beside each return status is confined to the
 * organizations its reader reaches.
 *
 * The count is an aggregate over an organization-scoped table, written as SQL
 * the entity filter never sees, so the tenant predicate is part of the
 * statement or the count is over every organization.
 */
import type { OrgConstraint } from '@endora-commerce/platform/tenancy';
import { describe, expect, it } from 'vitest';
import { returnStatusUsageQuery } from './return-status-usage.js';

describe('returnStatusUsageQuery', () => {
  it('counts every return for a reader who reaches every organization', () => {
    const query = returnStatusUsageQuery({ kind: 'all' });
    expect(query?.sql).toContain('from "return_cases"');
    expect(query?.sql).not.toContain('organization_id');
    expect(query?.params).toEqual([]);
  });

  it('counts only the reader\'s organizations for a confined reader', () => {
    const scope: OrgConstraint = { kind: 'set', organizationIds: ['o1', 'o2'] };
    const query = returnStatusUsageQuery(scope);
    expect(query?.sql).toContain('where "organization_id" in (?, ?)');
    expect(query?.params).toEqual(['o1', 'o2']);
  });

  it('confines a single-organization reader to that organization', () => {
    const query = returnStatusUsageQuery({ kind: 'single', organizationId: 'o1' });
    expect(query?.sql).toContain('where "organization_id" in (?)');
    expect(query?.params).toEqual(['o1']);
  });

  it('asks nothing for a reader who reaches no organization', () => {
    expect(returnStatusUsageQuery({ kind: 'set', organizationIds: [] })).toBeNull();
    expect(returnStatusUsageQuery({ kind: 'single', organizationId: null })).toBeNull();
  });
});
