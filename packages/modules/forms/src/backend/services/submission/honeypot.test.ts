import { describe, expect, it } from 'vitest';
import { isHoneypotHit } from './honeypot.js';

/**
 * `specs/170-forms-module/` T047 — the honeypot (FR-040, research R-15): a person never sees the
 * `hp_extra` input, so any value in it is a bot's, and the submission is answered as accepted with
 * nothing stored, sent or published.
 */
describe('isHoneypotHit', () => {
  it('is not hit when the field is absent or empty', () => {
    expect(isHoneypotHit({})).toBe(false);
    expect(isHoneypotHit({ hp: '' })).toBe(false);
  });

  it('is not hit by whitespace an autofill left behind', () => {
    expect(isHoneypotHit({ hp: '   ' })).toBe(false);
  });

  it('is hit by any text', () => {
    expect(isHoneypotHit({ hp: 'https://spam.example' })).toBe(true);
    expect(isHoneypotHit({ hp: 'x' })).toBe(true);
  });
});
