import { describe, expect, it } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import { roleTwoFactorRefusal, turnsTwoFactorOn } from './role-two-factor.js';

/**
 * Issue #349 — a role's `requiresTwoFactor` is enforced by `mfa` at sign-in, so
 * it may only be turned on where `mfa` can meet it: present, and able to enrol
 * a factor (its encryption key configured). Turning it off is never refused.
 */
describe('turnsTwoFactorOn', () => {
  it('is true only for a change from off to on', () => {
    expect(turnsTwoFactorOn(false, true)).toBe(true);
    expect(turnsTwoFactorOn(null, true)).toBe(true);
    expect(turnsTwoFactorOn(true, true)).toBe(false);
    expect(turnsTwoFactorOn(false, false)).toBe(false);
    expect(turnsTwoFactorOn(true, false)).toBe(false);
    expect(turnsTwoFactorOn(false, undefined)).toBe(false);
  });
});

describe('roleTwoFactorRefusal', () => {
  it('refuses with 409 MFA_REQUIRED_FOR_ROLE_TWO_FACTOR while mfa is off', () => {
    const refusal = roleTwoFactorRefusal('mfa_off');
    expect(refusal).toBeInstanceOf(HttpError);
    expect(refusal.statusCode).toBe(409);
    expect(refusal.code).toBe('MFA_REQUIRED_FOR_ROLE_TWO_FACTOR');
    expect(refusal.details).toEqual({ code: 'mfa_off', reason: 'mfa_off' });
  });

  it('says why when the encryption key is missing', () => {
    const refusal = roleTwoFactorRefusal('encryption_key_missing');
    expect(refusal.details).toEqual({
      code: 'encryption_key_missing',
      reason: 'encryption_key_missing',
    });
  });
});
