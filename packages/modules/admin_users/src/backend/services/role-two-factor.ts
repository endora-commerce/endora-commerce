import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Issue #349 — a role's `requiresTwoFactor` is enforced by `mfa` at sign-in,
 * and this module hosts the two writes that make it start binding somebody:
 * the role write, and giving an administrator a role.
 */

/** Why the flag cannot be turned on here. */
export type RoleTwoFactorRefusalReason = 'mfa_off' | 'encryption_key_missing';

/**
 * Whether a role write turns the requirement on: from off (or from a role that
 * does not exist yet) to on. Turning it off, leaving it as it is, or not
 * sending it, never counts.
 */
export function turnsTwoFactorOn(before: boolean | null, requested: boolean | undefined): boolean {
  return requested === true && before !== true;
}

/**
 * The refusal a role write earns by turning the requirement on where no second
 * factor can be enrolled.
 *
 * With `mfa` off, sign-in asks for no second factor at all (D-96), so the flag
 * would be a promise nothing keeps — and `mfa` could then not be switched back
 * on without the operator first learning that it binds people. Without an
 * encryption key, `mfa` serves no enrolment route, so every unenrolled holder
 * would be sent to a setup step nothing can complete: a lockout.
 *
 * `details.code` is the token that picks the sentence
 * (`errors.MFA_REQUIRED_FOR_ROLE_TWO_FACTOR.<token>`); `details.reason` carries
 * the same value under the name a client reads.
 */
export function roleTwoFactorRefusal(reason: RoleTwoFactorRefusalReason): HttpError {
  return new HttpError(
    409,
    ERROR_CODES.MFA_REQUIRED_FOR_ROLE_TWO_FACTOR,
    reason === 'mfa_off'
      ? 'This role cannot require two-step verification while two-step verification is switched ' +
          'off. Switch it on first.'
      : 'This role cannot require two-step verification because no second factor can be set up on ' +
          'this instance: MFA_SECRET_ENCRYPTION_KEY is not configured.',
    { code: reason, reason },
  );
}
