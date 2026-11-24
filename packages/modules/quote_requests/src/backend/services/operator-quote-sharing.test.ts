import { describe, expect, it } from 'vitest';
import { normaliseShareValidityDays } from './operator-quote-sharing.js';

describe('normaliseShareValidityDays (research R-10, FR-032)', () => {
  it('0 and null are no deadline; a positive number is kept', () => {
    expect(normaliseShareValidityDays(null)).toBeNull();
    expect(normaliseShareValidityDays(0)).toBeNull();
    expect(normaliseShareValidityDays(30)).toBe(30);
  });
});
