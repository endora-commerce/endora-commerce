import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertCompleteOrder } from './status-reorder.js';

/** Issue #1560 — the one check every batch reorder of the Opportunity statuses makes. */
describe('assertCompleteOrder', () => {
  const current = ['new', 'qualified', 'done', 'lost'];

  function refusal(ordered: string[]): HttpError {
    try {
      assertCompleteOrder(current, ordered);
    } catch (error) {
      if (error instanceof HttpError) return error;
      throw error;
    }
    throw new Error('expected a refusal');
  }

  it('accepts a permutation of every current code', () => {
    expect(() => assertCompleteOrder(current, ['done', 'new', 'lost', 'qualified'])).not.toThrow();
  });

  it.each([
    ['a code that is not configured — deleted or renamed by somebody else', [...current, 'nowhere']],
    ['a code in place of a configured one', [...current.slice(1), 'nowhere']],
    ['a code left out', ['new', 'qualified', 'done']],
    ['a code named twice', ['new', 'qualified', 'done', 'lost', 'done']],
  ])('answers 409 ORDER_STALE for %s', (_case, ordered) => {
    const error = refusal(ordered);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe(ERROR_CODES.ORDER_STALE);
  });
});
