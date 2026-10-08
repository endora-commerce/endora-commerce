import { describe, expect, it } from 'vitest';
import { formatOpportunityNumber } from './opportunity-number.js';

describe('formatOpportunityNumber', () => {
  it('prefixes and zero-pads the sequence value to six digits', () => {
    expect(formatOpportunityNumber(123)).toBe('OPP-000123');
    expect(formatOpportunityNumber(1)).toBe('OPP-000001');
  });

  it('accepts the sequence value as the string the driver returns', () => {
    expect(formatOpportunityNumber('42')).toBe('OPP-000042');
  });

  it('does not truncate a value longer than the padding', () => {
    expect(formatOpportunityNumber(1234567)).toBe('OPP-1234567');
  });

  it('refuses a value that is not a positive integer', () => {
    expect(() => formatOpportunityNumber(0)).toThrow();
    expect(() => formatOpportunityNumber('abc')).toThrow();
  });
});
