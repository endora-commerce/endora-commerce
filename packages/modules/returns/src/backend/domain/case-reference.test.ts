import { describe, expect, it } from 'vitest';
import { caseReference, derivedReferencePrefix } from './case-reference.js';

/**
 * `specs/180-off-platform-complaints/` T104 (D-4, FR-A44, research R-20): every case
 * has a readable reference — its RMA number once assigned, until then `#` plus the
 * first eight hex characters of its id, upper-cased and without hyphens.
 */
describe('caseReference', () => {
  const id = '3f9a21c0-7b1e-4d2a-9c3b-0123456789ab';

  it('answers the RMA number when the case has one', () => {
    expect(caseReference({ id, rmaNumber: 'RMA-1042' })).toBe('RMA-1042');
  });

  it('derives #XXXXXXXX from the id while there is no RMA number', () => {
    expect(caseReference({ id, rmaNumber: null })).toBe('#3F9A21C0');
    expect(caseReference({ id })).toBe('#3F9A21C0');
    expect(caseReference({ id, rmaNumber: '' })).toBe('#3F9A21C0');
  });

  it('drops the hyphens before taking eight characters', () => {
    expect(caseReference({ id: '0000abcd-ef01-4000-8000-000000000000' })).toBe('#0000ABCD');
    expect(caseReference({ id: '0000abc-d-ef01' })).toBe('#0000ABCD');
  });

  it('is pure and stable', () => {
    const rc = { id, rmaNumber: null };
    expect(caseReference(rc)).toBe(caseReference(rc));
    expect(rc).toEqual({ id, rmaNumber: null });
  });
});

describe('derivedReferencePrefix', () => {
  it('reads the eight hex characters out of #XXXXXXXX, with or without the #', () => {
    expect(derivedReferencePrefix('#3F9A21C0')).toBe('3f9a21c0');
    expect(derivedReferencePrefix(' 3f9a21c0 ')).toBe('3f9a21c0');
  });

  it('answers null for anything else', () => {
    expect(derivedReferencePrefix('RMA-1042')).toBeNull();
    expect(derivedReferencePrefix('#3F9A21C')).toBeNull();
    expect(derivedReferencePrefix('#3F9A21C0X')).toBeNull();
    expect(derivedReferencePrefix('3f9a21g0')).toBeNull();
  });
});
