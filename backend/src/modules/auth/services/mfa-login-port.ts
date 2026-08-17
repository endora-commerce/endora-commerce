/**
 * MFA login port (feature 042).
 *
 * The shape is `auth`'s and the implementation is `mfa`'s — that direction is
 * deliberate, and it is what lets the two login services in `customer_accounts`
 * and `admin_users` depend on the contract without depending on the `mfa`
 * module (R-03).
 *
 * The declarations themselves moved to `@b2b/contracts` in feature 075's
 * Phase P, so the eleven consumers can name a package instead of this file.
 * This module re-exports them for the length of Phase P, which cuts no
 * consumer; delete the re-export when the last of them has been rewired.
 */
export type {
  MfaSubjectRef,
  MfaLoginContext,
  MfaLoginDecision,
  MfaLoginPort,
} from '@b2b/contracts';
