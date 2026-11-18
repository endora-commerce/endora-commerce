import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errors.js';

/**
 * `specs/181-guest-complaints/` T003 (settings-emails-events.md §4): the guest
 * complaint error codes are catalogued, each spelt as its own value, and the
 * catalogue holds no value twice. A code joins with its first raise site
 * (`check:error-translations` P7): `RETURN_TRACKING_LINK_INVALID`,
 * `RETURN_GUEST_LIMIT_REACHED` and `RETURN_GUEST_DATA_ERASED` joined with the
 * guest filing and tracking routes that raise them (G-4, G-5).
 */
describe('ERROR_CODES — guest complaints (181)', () => {
  it.each([
    'RETURN_GUEST_COMPLAINTS_DISABLED',
    'RETURN_GUEST_SESSION_REQUIRED',
    'RETURN_GUEST_LINK_INVALID',
    'RETURN_TRACKING_LINK_INVALID',
    'RETURN_GUEST_LIMIT_REACHED',
    'RETURN_GUEST_DATA_ERASED',
  ])('declares %s', (code) => {
    expect((ERROR_CODES as Record<string, string>)[code]).toBe(code);
  });

  it('holds every value once, spelt as its key', () => {
    const entries = Object.entries(ERROR_CODES);
    for (const [key, value] of entries) expect(value).toBe(key);
    expect(new Set(Object.values(ERROR_CODES)).size).toBe(entries.length);
  });
});
