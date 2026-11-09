import { describe, expect, it } from 'vitest';
import { opportunityStatusUsageQuery } from './opportunity-status-usage.js';

const ORG_A = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const ORG_B = '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02';

describe('opportunityStatusUsageQuery', () => {
  it('counts every opportunity for a reader who reaches every organization', () => {
    const query = opportunityStatusUsageQuery({ kind: 'all' });
    expect(query?.params).toEqual([]);
    expect(query?.sql).not.toContain('where');
    expect(query?.sql).toContain('group by "status_code"');
  });

  it('confines a reader of one organization to it', () => {
    const query = opportunityStatusUsageQuery({ kind: 'single', organizationId: ORG_A });
    expect(query?.sql).toContain('where "organization_id" = ?');
    expect(query?.params).toEqual([ORG_A]);
  });

  it('confines a reader of a set to the set', () => {
    const query = opportunityStatusUsageQuery({ kind: 'allowed', organizationIds: [ORG_A, ORG_B] });
    expect(query?.sql).toContain('where "organization_id" = any(?::uuid[])');
    expect(query?.params).toEqual([`{"${ORG_A}","${ORG_B}"}`]);
  });

  // Issue #305 — a sales representative reaches every organization nobody else governs.
  it('confines a sales representative to every organization nobody else governs', () => {
    const query = opportunityStatusUsageQuery({ kind: 'excluded', excludedOrganizationIds: ['f1'], assignedOrganizationIds: [] });
    expect(query?.sql).toContain('where ("organization_id" is not null and "organization_id" <> all(?::uuid[]))');
    expect(query?.params).toEqual(['{"f1"}']);
  });

  it('runs no statement for a reader who reaches no organization', () => {
    expect(opportunityStatusUsageQuery({ kind: 'allowed', organizationIds: [] })).toBeNull();
    expect(opportunityStatusUsageQuery({ kind: 'single', organizationId: null })).toBeNull();
  });
});
