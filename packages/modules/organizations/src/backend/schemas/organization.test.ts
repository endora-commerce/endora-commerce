import { describe, expect, it } from 'vitest';
import { taxIdSchema } from './organization.js';

/**
 * `specs/177-tax-id-scope/` review finding 5 — the admin boundary's tax ID is
 * normalised and then held to what `organizations.tax_id` (`varchar(32)`) and
 * every other entry point accept, 8 to 32 characters; a 64-character value
 * reached the database and answered 500.
 */
describe('taxIdSchema (admin boundary)', () => {
  it.each([
    [' pl 526-025-09-95 ', 'PL5260250995'],
    ['DE123456789', 'DE123456789'],
  ])('normalises %j to %j', (typed, stored) => {
    expect(taxIdSchema.parse(typed)).toBe(stored);
  });

  it.each(['--------', '1234567', '1'.repeat(33), `${'1'.repeat(40)}--`])('refuses %j', (typed) => {
    expect(taxIdSchema.safeParse(typed).success).toBe(false);
  });
});
