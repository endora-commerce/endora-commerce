import { describe, expect, it } from 'vitest';
import { isHoneypotHit } from './honeypot.js';

/**
 * `specs/181-guest-complaints/` T016 (research R-8): the guest forms' honeypot
 * `hp`, judged by `forms`' rule, re-implemented here (Principle I) — a value is a
 * hit, whitespace alone is not.
 */
describe('isHoneypotHit', () => {
  it('is not hit when the field is absent or empty', () => {
    expect(isHoneypotHit({})).toBe(false);
    expect(isHoneypotHit({ hp: undefined })).toBe(false);
    expect(isHoneypotHit({ hp: '' })).toBe(false);
  });

  it('is not hit by whitespace alone, which autofill may leave', () => {
    expect(isHoneypotHit({ hp: ' ' })).toBe(false);
    expect(isHoneypotHit({ hp: '\t \n' })).toBe(false);
  });

  it('is hit by any other value', () => {
    expect(isHoneypotHit({ hp: 'x' })).toBe(true);
    expect(isHoneypotHit({ hp: ' https://spam.example ' })).toBe(true);
  });
});
