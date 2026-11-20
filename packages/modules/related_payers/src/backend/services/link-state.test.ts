import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { assertLinkablePair, assertNoLiveLinkForPair, assertStateChange } from './link-state.js';

/**
 * FR-010 and FR-013 — the link's state machine and the pair rules, refused with the
 * module's own codes so a caller can tell a taken pair from an impossible one.
 */
const X = '00000000-0000-4000-8000-0000000000b1';
const Y = '00000000-0000-4000-8000-0000000000b2';

function codeOf(fn: () => unknown): { status: number; code: string } | null {
  try {
    fn();
    return null;
  } catch (error) {
    const e = error as { statusCode?: number; code?: string };
    return { status: e.statusCode ?? 0, code: e.code ?? '' };
  }
}

describe('assertStateChange (FR-013)', () => {
  it('active ⇄ inactive in both directions', () => {
    expect(codeOf(() => assertStateChange('active', 'inactive'))).toBeNull();
    expect(codeOf(() => assertStateChange('inactive', 'active'))).toBeNull();
  });

  it('either live state may be revoked', () => {
    expect(codeOf(() => assertStateChange('active', 'revoked'))).toBeNull();
    expect(codeOf(() => assertStateChange('inactive', 'revoked'))).toBeNull();
  });

  it('revoked is terminal: no reactivation, no deactivation, no second revocation', () => {
    for (const to of ['active', 'inactive', 'revoked'] as const) {
      expect(codeOf(() => assertStateChange('revoked', to))).toEqual({ status: 409, code: ERROR_CODES.INVALID_TRANSITION });
    }
  });

  it('a change to the same state is not a change', () => {
    expect(codeOf(() => assertStateChange('active', 'active'))).toEqual({ status: 409, code: ERROR_CODES.INVALID_TRANSITION });
  });
});

describe('assertLinkablePair (FR-010)', () => {
  const company = (id: string) => ({ id, isPersonal: false });

  it('two different company Organizations may be linked', () => {
    expect(codeOf(() => assertLinkablePair(company(X), company(Y)))).toBeNull();
  });

  it('refuses one Organization twice', () => {
    expect(codeOf(() => assertLinkablePair(company(X), company(X)))).toEqual({
      status: 422,
      code: ERROR_CODES.RELATED_PAYER_INVALID_PAIR,
    });
  });

  it('refuses a personal Organization on either side', () => {
    expect(codeOf(() => assertLinkablePair({ id: X, isPersonal: true }, company(Y)))?.code).toBe(
      ERROR_CODES.RELATED_PAYER_INVALID_PAIR,
    );
    expect(codeOf(() => assertLinkablePair(company(X), { id: Y, isPersonal: true }))?.code).toBe(
      ERROR_CODES.RELATED_PAYER_INVALID_PAIR,
    );
  });
});

describe('assertNoLiveLinkForPair (FR-010)', () => {
  it('a pair with only revoked links may be linked again (FR-013)', () => {
    expect(codeOf(() => assertNoLiveLinkForPair([{ state: 'revoked' }, { state: 'revoked' }]))).toBeNull();
  });

  it('a pair with an active or inactive link is taken', () => {
    expect(codeOf(() => assertNoLiveLinkForPair([{ state: 'inactive' }]))).toEqual({
      status: 422,
      code: ERROR_CODES.RELATED_PAYER_LINK_EXISTS,
    });
    expect(codeOf(() => assertNoLiveLinkForPair([{ state: 'revoked' }, { state: 'active' }]))?.code).toBe(
      ERROR_CODES.RELATED_PAYER_LINK_EXISTS,
    );
  });
});
