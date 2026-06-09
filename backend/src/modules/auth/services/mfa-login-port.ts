/**
 * MFA login port (feature 042).
 *
 * The interface lives in the core `auth` module so the per-surface login
 * services (`customer_accounts`, `admin_users`) depend only on core — never on
 * the `mfa` module's internals. The `mfa` module implements this port and is
 * injected at composition time; when it is absent the login services skip the
 * second factor entirely (password-only fallback, FR-033).
 */

export interface MfaSubjectRef {
  subjectType: 'customer' | 'admin';
  subjectId: string;
}

export interface MfaLoginContext {
  /** Resolved storefront channel id, or null for admin / channel-less reads. */
  salesChannelId: string | null;
  /** The customer's organization id (null for admin or org-less customers). */
  organizationId?: string | null;
}

/**
 * Decision returned after the first factor (password / provider) succeeds:
 *   - `proceed`   — no active 2FA and not enforced → issue the session now;
 *   - `challenge` — an active enrolment exists → require the second step;
 *   - `setup`     — 2FA is enforced for this scope but the subject has not
 *                   enrolled → route into mandatory setup before access.
 */
export type MfaLoginDecision =
  | { kind: 'proceed' }
  | { kind: 'challenge'; challengeId: string }
  | { kind: 'setup'; setupTicket: string };

export interface MfaLoginPort {
  beginLogin(
    subject: MfaSubjectRef,
    ctx: MfaLoginContext,
  ): Promise<MfaLoginDecision>;
  /** Whether the subject currently has an active TOTP enrolment. */
  isTwoFactorActive(subject: MfaSubjectRef): Promise<boolean>;
}
