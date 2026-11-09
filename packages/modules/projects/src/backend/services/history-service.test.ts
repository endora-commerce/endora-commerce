import { describe, expect, it } from 'vitest';
import { orgReachOf } from '../domain/visibility-rule.js';
import {
  auditedTexts,
  decodeHistoryCursor,
  encodeHistoryCursor,
  valueChangeIdOf,
  visibleAuditState,
  withinReach,
  withValueChange,
} from './history-service.js';

/**
 * The pure halves of a Project's history (FR-028, FR-036): which audited keys
 * hold a text whose tokens are resolved, the custom-field values a reader
 * without `custom_fields:read` is not served, and the opaque cursor.
 */
describe('project history helpers', () => {
  it('serves custom-field values only to a reader who may read them; the rest of the state is untouched', () => {
    const state = { title: 'A', customFieldValues: { budget: 100 } };
    expect(visibleAuditState(state, true)).toBe(state);
    expect(visibleAuditState(state, false)).toEqual({ title: 'A' });
    expect(visibleAuditState({ title: 'A' }, false)).toEqual({ title: 'A' });
    expect(visibleAuditState(null, false)).toBeNull();
    expect(visibleAuditState(['x'], false)).toEqual(['x']);
    // Which custom fields changed is theirs too (T144 F4).
    expect(visibleAuditState({ title: 'A', changedCustomFields: ['budget'] }, false)).toEqual({ title: 'A' });
    expect(visibleAuditState({ changedCustomFields: ['budget'] }, true)).toEqual({ changedCustomFields: ['budget'] });
  });

  it('serves no Organization out of the reader’s reach, nor the record of a link that named one (T144 F4)', () => {
    const A = '00000000-0000-4000-8000-00000000000a';
    const B = '00000000-0000-4000-8000-00000000000b';
    const R = '00000000-0000-4000-8000-0000000000r1'.replace('r1', 'c1');
    const reachA = orgReachOf({ kind: 'allowed', organizationIds: [A] });
    expect(withinReach({ title: 'x', organizationIds: [A, B] }, reachA)).toEqual({ title: 'x', organizationIds: [A] });
    expect(withinReach({ organizationId: B }, reachA)).toEqual({ organizationId: null });
    expect(withinReach({ organizationId: A }, reachA)).toEqual({ organizationId: A });
    expect(withinReach({ linkId: R, recordKind: 'order', recordId: R, organizationId: B }, reachA)).toEqual({
      linkId: R,
      recordKind: 'order',
      recordId: null,
      organizationId: null,
    });
    const all = orgReachOf({ kind: 'all' });
    const state = { organizationIds: [A, B] };
    expect(withinReach(state, all)).toBe(state);
    expect(withinReach(null, reachA)).toBeNull();
  });

  it('reads the description of a state as its text, and nothing else', () => {
    expect(auditedTexts({ description: 'See [[task:00000000-0000-4000-8000-000000000001]]', title: 'x' })).toEqual([
      'See [[task:00000000-0000-4000-8000-000000000001]]',
    ]);
    expect(auditedTexts({ descriptionLength: 3 })).toEqual([]);
    expect(auditedTexts(null)).toEqual([]);
  });

  it('round-trips its own cursor and refuses one it did not issue — 400', () => {
    expect(decodeHistoryCursor(encodeHistoryCursor(150))).toBe(150);
    expect(decodeHistoryCursor(undefined)).toBe(0);
    expect(() => decodeHistoryCursor('not-ours')).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => decodeHistoryCursor(encodeHistoryCursor(-1))).toThrow();
  });

  it('reads the value-change id an audited state points at, and only a uuid (T145)', () => {
    const id = '00000000-0000-4000-8000-0000000000c1';
    expect(valueChangeIdOf({ changedFields: ['value'], valueChangeId: id })).toBe(id);
    expect(valueChangeIdOf({ valueChangeId: 'not-a-uuid' })).toBeNull();
    expect(valueChangeIdOf({ title: 'A' })).toBeNull();
    expect(valueChangeIdOf(null)).toBeNull();
  });

  it('puts the stored values in place of the names the audit trail keeps (T145)', () => {
    const change = {
      before: { valueAmount: '1.00', valueCurrency: 'PLN', customFieldValues: { budget: null } },
      after: { valueAmount: '2.00', valueCurrency: 'PLN', customFieldValues: { budget: 5 } },
    };
    const id = '00000000-0000-4000-8000-0000000000c1';
    expect(
      withValueChange(
        { before: { title: 'A' }, after: { title: 'A', changedFields: ['value'], changedCustomFields: ['budget'], valueChangeId: id } },
        change,
      ),
    ).toEqual({
      before: { title: 'A', valueAmount: '1.00', valueCurrency: 'PLN', customFieldValues: { budget: null } },
      after: { title: 'A', valueAmount: '2.00', valueCurrency: 'PLN', customFieldValues: { budget: 5 } },
    });
    // A create has no state before: the values join the state after only.
    expect(
      withValueChange({ before: null, after: { title: 'A', changedFields: ['value'], valueChangeId: id } }, {
        before: null,
        after: { valueAmount: '2.00', valueCurrency: 'PLN' },
      }),
    ).toEqual({ before: null, after: { title: 'A', valueAmount: '2.00', valueCurrency: 'PLN' } });
    // No stored change: the names stay, the pointer goes.
    expect(withValueChange({ before: null, after: { changedFields: ['value'], valueChangeId: id } }, null)).toEqual({
      before: null,
      after: { changedFields: ['value'] },
    });
  });
});
