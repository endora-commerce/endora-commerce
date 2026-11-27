import { describe, expect, it } from 'vitest';
import { withoutCallerSource } from './history-fields.js';

/**
 * `specs/186-aggregate-ports/` R-21.7 — an `opportunityCommandPort` caller's
 * `source` code is recorded on every entry it writes; the Change history tab
 * shows it as nothing, except on the creation, where `source` is the
 * Opportunity's origin.
 */
describe('withoutCallerSource', () => {
  it('drops a caller’s source from an edit, leaving the rest', () => {
    expect(
      withoutCallerSource({
        action: 'crm.opportunity.update',
        before: { valueChangeId: 'a' },
        after: { valueChangeId: 'b', source: 'erp.sync' },
      }),
    ).toEqual({ action: 'crm.opportunity.update', before: { valueChangeId: 'a' }, after: { valueChangeId: 'b' } });
  });

  it('keeps the creation’s source, which is the origin', () => {
    const entry = { action: 'crm.opportunity.create', before: null, after: { number: 'OPP-1', source: 'manual' } };
    expect(withoutCallerSource(entry)).toBe(entry);
  });

  it('leaves a state without one, and a missing state, untouched', () => {
    expect(withoutCallerSource({ action: 'crm.opportunity.delete', before: { number: 'OPP-1' }, after: null })).toEqual({
      action: 'crm.opportunity.delete',
      before: { number: 'OPP-1' },
      after: null,
    });
  });
});
