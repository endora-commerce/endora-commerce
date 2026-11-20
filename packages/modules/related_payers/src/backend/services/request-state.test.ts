import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { assertRequestDecision, isTerminalRequestState } from './request-state.js';

/** `specs/182-related-payers/` T067 (FR-045) — the request lifecycle and its single decision. */
describe('request state', () => {
  it('pending is the only non-terminal state', () => {
    expect(isTerminalRequestState('pending')).toBe(false);
    for (const s of ['active', 'rejected', 'expired', 'withdrawn'] as const) expect(isTerminalRequestState(s)).toBe(true);
  });

  it.each(['active', 'rejected', 'expired', 'withdrawn'] as const)('pending → %s is allowed at the read version', (to) => {
    expect(() => assertRequestDecision({ state: 'pending', version: 3 }, to, 3)).not.toThrow();
  });

  it.each(['active', 'rejected', 'expired', 'withdrawn'] as const)('a decided request (%s) refuses any second decision with 409', (from) => {
    expect(() => assertRequestDecision({ state: from, version: 4 }, 'active', 4)).toThrow(
      expect.objectContaining({ statusCode: 409, code: ERROR_CODES.RELATED_PAYER_REQUEST_DECIDED }),
    );
  });

  it('a stale version loses the race with the same 409', () => {
    expect(() => assertRequestDecision({ state: 'pending', version: 5 }, 'active', 4)).toThrow(
      expect.objectContaining({ statusCode: 409, code: ERROR_CODES.RELATED_PAYER_REQUEST_DECIDED }),
    );
  });

  it('pending → pending is not a decision', () => {
    expect(() => assertRequestDecision({ state: 'pending', version: 1 }, 'pending' as never, 1)).toThrow();
  });
});
