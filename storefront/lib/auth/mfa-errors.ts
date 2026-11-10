import { defineUrlErrors } from '../url-errors';

/**
 * The two-step verification refusals a page can name (issue #745), shared by
 * `/account/security` and the sign-in pages. **A code travels, never a
 * sentence** — see `lib/url-errors.ts`.
 */
export const MFA_API_ERROR_KEYS = {
  MFA_INVALID_CODE: 'auth.mfa.error.MFA_INVALID_CODE',
  MFA_INVALID_CHALLENGE: 'auth.mfa.error.MFA_INVALID_CHALLENGE',
  MFA_TOO_MANY_ATTEMPTS: 'auth.mfa.error.MFA_TOO_MANY_ATTEMPTS',
  MFA_WRONG_SURFACE: 'auth.mfa.error.MFA_WRONG_SURFACE',
  MFA_ALREADY_ENROLLED: 'auth.mfa.error.MFA_ALREADY_ENROLLED',
  MFA_NO_PENDING_ENROLMENT: 'auth.mfa.error.MFA_NO_PENDING_ENROLMENT',
  MFA_NO_ACTIVE_ENROLMENT: 'auth.mfa.error.MFA_NO_ACTIVE_ENROLMENT',
  MFA_NOT_ENABLED: 'auth.mfa.error.MFA_NOT_ENABLED',
  MFA_REAUTH_REQUIRED: 'auth.mfa.error.MFA_REAUTH_REQUIRED',
  MFA_SOCIAL_LAST_CREDENTIAL: 'auth.mfa.error.MFA_SOCIAL_LAST_CREDENTIAL',
  MFA_LAST_FACTOR_REQUIRED: 'auth.mfa.error.MFA_LAST_FACTOR_REQUIRED',
} as const;

/** `/account/security?error=<code>`. */
export const SECURITY_ERRORS = defineUrlErrors({
  api: MFA_API_ERROR_KEYS,
  own: { FAILED: 'auth.security.failed' },
  generic: 'FAILED',
});
