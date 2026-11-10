import { describe, expect, it } from 'vitest';
import { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import { CRM_AUDIT_KEYS, auditSnapshot, opportunityValues, recordValueChange } from './opportunity-audit-state.js';

/**
 * `CRM_AUDIT_KEYS` is the allowlist of `specs/conventions/audit-state.md`
 * (D-288, #470) for CRM: a key a `crm.opportunity.*` audit state may carry.
 * The snapshot is held to it here; every Command's recorded state is held to
 * it by `opportunity-audit-sentinels.test.ts`.
 */

function opportunity(): CrmOpportunity {
  return Object.assign(new CrmOpportunity(), {
    number: 'OPP-000001',
    title: 'Fleet renewal',
    description: 'Ask Anna',
    organizationId: '00000000-0000-4000-8000-0000000000b1',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    salesChannelId: '00000000-0000-4000-8000-0000000000d1',
    statusCode: 'new',
    assignedAdminUserId: '00000000-0000-4000-8000-0000000000a1',
    manualValue: '1200.00',
    currency: 'PLN',
    expectedCloseDate: '2026-12-31',
    customFieldValues: { risk: 'high' },
  });
}

/** Enough of an EntityManager to count the rows `recordValueChange` creates. */
function recordingEm() {
  const created: Array<Record<string, unknown>> = [];
  const em = {
    create: (_entity: unknown, data: Record<string, unknown>) => {
      const row = { id: `row-${created.length + 1}`, ...data };
      created.push(row);
      return row;
    },
  };
  return { em: em as never, created };
}

describe('CRM_AUDIT_KEYS', () => {
  it('holds every key of the audit snapshot', () => {
    expect(Object.keys(auditSnapshot(opportunity())).filter((key) => !CRM_AUDIT_KEYS.has(key))).toEqual([]);
  });

  it('holds none of the values the store keeps instead', () => {
    const values = Object.keys(opportunityValues(opportunity(), ['VIP']));
    expect(values.filter((key) => CRM_AUDIT_KEYS.has(key))).toEqual([]);
    for (const key of ['reason', 'eventName', 'fileName', 'title', 'organizationId', 'customerAccountId']) {
      expect(CRM_AUDIT_KEYS.has(key), key).toBe(false);
    }
  });
});

describe('recordValueChange', () => {
  it('names what changed, sorted, and keeps only that in the row', () => {
    const { em, created } = recordingEm();
    const before = opportunityValues(opportunity(), ['VIP']);
    const changed = Object.assign(opportunity(), {
      title: 'Fleet renewal 2027',
      manualValue: '1300.00',
      customFieldValues: { risk: 'low', seats: 4 },
    });
    const keys = recordValueChange(em, 'opp', { before, after: opportunityValues(changed, ['VIP']) });
    expect(keys).toEqual({
      changedFields: ['manualValue', 'title'],
      changedCustomFields: ['risk', 'seats'],
      valueChangeId: 'row-1',
    });
    expect(created).toEqual([
      {
        id: 'row-1',
        opportunityId: 'opp',
        before: { title: 'Fleet renewal', manualValue: '1200.00', customFieldValues: { risk: 'high', seats: null } },
        after: { title: 'Fleet renewal 2027', manualValue: '1300.00', customFieldValues: { risk: 'low', seats: 4 } },
      },
    ]);
  });

  it('writes nothing and names nothing when no value changed', () => {
    const { em, created } = recordingEm();
    const values = opportunityValues(opportunity());
    expect(recordValueChange(em, 'opp', { before: values, after: { ...values } })).toEqual({});
    expect(created).toEqual([]);
  });

  it('counts every non-empty value of something that only arrived, and stores no side before it', () => {
    const { em, created } = recordingEm();
    const keys = recordValueChange(em, 'opp', {
      before: null,
      after: { title: 'A', description: null, tags: [], customFieldValues: {} },
    });
    expect(keys).toEqual({ changedFields: ['title'], valueChangeId: 'row-1' });
    expect(created[0]).toMatchObject({ before: null, after: { title: 'A' } });
  });

  it('counts every value of something that went, and stores no side after it', () => {
    const { em, created } = recordingEm();
    const keys = recordValueChange(em, 'opp', { before: { fileName: 'offer.pdf' }, after: null });
    expect(keys).toEqual({ changedFields: ['fileName'], valueChangeId: 'row-1' });
    expect(created[0]).toMatchObject({ before: { fileName: 'offer.pdf' }, after: null });
  });
});
