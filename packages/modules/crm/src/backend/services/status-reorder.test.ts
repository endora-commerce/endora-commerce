import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { assertCompleteOrder } from './status-reorder.js';

/** Issue #1560 — the one check every batch reorder of the Opportunity statuses makes. */
describe('assertCompleteOrder', () => {
  const current = ['new', 'qualified', 'done', 'lost'];
  const notFound = (code: string) => new HttpError(404, ERROR_CODES.NOT_FOUND, `"${code}" not found.`);

  function refusal(ordered: string[]): HttpError {
    try {
      assertCompleteOrder(current, ordered, notFound);
    } catch (error) {
      if (error instanceof HttpError) return error;
      throw error;
    }
    throw new Error('expected a refusal');
  }

  it('accepts a permutation of every current code', () => {
    expect(() => assertCompleteOrder(current, ['done', 'new', 'lost', 'qualified'], notFound)).not.toThrow();
  });

  it('answers the caller’s 404 for a code that is not configured, before anything else', () => {
    const error = refusal(['new', 'nowhere']);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
  });

  it.each([
    ['a code left out', ['new', 'qualified', 'done']],
    ['a code named twice', ['new', 'qualified', 'done', 'lost', 'done']],
  ])('answers 409 ORDER_STALE for %s', (_case, ordered) => {
    const error = refusal(ordered);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe(ERROR_CODES.ORDER_STALE);
  });
});
