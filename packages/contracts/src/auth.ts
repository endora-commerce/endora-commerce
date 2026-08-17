/**
 * `auth` module contracts — the in-process port surface (feature 075, Phase P).
 *
 * `auth` publishes no HTTP shape of its own worth a Zod schema: it owns the
 * session table, the session cookie names and the seam the `mfa` module plugs
 * into. What every other module needs from it is behaviour, so this file is
 * plain TypeScript interfaces, following `PaymentAdapter` in
 * `payment-methods.ts` and `DictionaryValidator` in `dictionary.ts`.
 *
 * Nothing here imports from `backend/src/` (FR-034).
 *
 * **Not here on purpose:** `hashPassword` / `verifyPassword`. They are pure
 * functions over their argument, so a gated port answering 503
 * `MODULE_DISABLED` to "hash this string" would be a bug, not a degrade
 * (FR-013, R-09). They relocated to `backend/src/kernel/crypto/password-hasher.ts`.
 */

// --- session cookie names ----------------------------------------------------

/**
 * The storefront session cookie. Published here because it is a **constant**,
 * not behaviour: five modules set or clear it, and switching `auth` off does
 * not change its spelling. `auth/plugin.ts` re-exports these two so its own
 * default-argument reads keep working.
 */
export const SESSION_COOKIE_NAME = 'b2b_session';

/** The admin session cookie. Same reasoning as {@link SESSION_COOKIE_NAME}. */
export const ADMIN_SESSION_COOKIE_NAME = 'b2b_admin_session';

// --- ports -------------------------------------------------------------------

export type AuthSessionKind = 'customer' | 'admin' | 'impersonation';

/**
 * A session row as it crosses the module boundary — a plain shape, never the
 * `Session` ORM entity (FR-011). `tokenHash` is deliberately absent: no
 * consumer reads it and it is the one field that must not travel.
 */
export interface AuthSessionRecord {
  id: string;
  kind: AuthSessionKind;
  customerAccountId: string | null;
  adminUserId: string | null;
  impersonatorAdminUserId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuthCreateSessionInput {
  kind: AuthSessionKind;
  customerAccountId?: string;
  adminUserId?: string;
  impersonatorAdminUserId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/** What a caller needs to set the cookie: the value, its expiry, and the row. */
export interface AuthSessionCookiePayload {
  cookieValue: string;
  expiresAt: Date;
  session: AuthSessionRecord;
}

export interface AuthResolvedSession {
  session: AuthSessionRecord;
  kind: AuthSessionKind;
}

/**
 * Container name: `authSessionPort`. Owner: `auth`.
 *
 * When `auth` is off every method throws `ModuleDisabledError` (503
 * `MODULE_DISABLED`) at the resolution seam — which is the correct answer: a
 * platform that cannot mint or validate a session must refuse the login rather
 * than issue one nothing can check.
 */
export interface AuthSessionPort {
  createSession(input: AuthCreateSessionInput): Promise<AuthSessionCookiePayload>;
  loadSession(cookieValue: string): Promise<AuthResolvedSession | null>;
  destroySession(sessionId: string): Promise<void>;
  destroyAllForCustomer(customerAccountId: string): Promise<void>;
  touchLastSeen(sessionId: string): Promise<void>;
  /** Customer-account ids seen inside the window. Feature 040's "online" view. */
  listRecentlyActiveCustomers(windowMinutes: number): Promise<string[]>;
}

/** One customer's most recent session activity. */
export interface AuthCustomerLastSeen {
  customerAccountId: string;
  lastSeenAt: Date;
}

/**
 * Container name: `authSessionReadPort`. Owner: `auth`.
 *
 * The read model over the session table for the one module that *reports* on
 * sessions rather than managing them: `customers`' online-customers view reads
 * `Session` directly today to work out when each account was last active.
 *
 * The surface is that single question and nothing more — publishing the table
 * would be publishing nothing (contracts/port-publication.md §1.1).
 *
 * When `auth` is off the call fails closed, which is right: an "online now"
 * view assembled from no session data would be a list of everybody, at an
 * invented timestamp.
 */
export interface AuthSessionReadPort {
  /**
   * The newest `lastSeenAt` per customer account, restricted to the given
   * accounts and to activity at or after `since`. Accounts with no matching
   * session are absent from the result rather than present with a null.
   */
  lastSeenByCustomerAccount(
    customerAccountIds: readonly string[],
    since: Date,
  ): Promise<AuthCustomerLastSeen[]>;
}

// --- the MFA seam ------------------------------------------------------------
//
// Direction note (R-03): `auth` *declares* this shape and `mfa` *implements*
// it. Publishing it here keeps that direction — the two login services in
// `customer_accounts` and `admin_users` depend on the contract, never on the
// `mfa` module.

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

/**
 * Container name: `mfaLoginPort`. Owner: `mfa` (the shape is `auth`'s).
 *
 * When `mfa` is absent the login services skip the second factor entirely —
 * the password-only fallback of feature 042 FR-033. That is a declared
 * `nonBindingDependencies` degrade, not a fail-closed edge, and it must stay
 * one.
 */
export interface MfaLoginPort {
  beginLogin(subject: MfaSubjectRef, ctx: MfaLoginContext): Promise<MfaLoginDecision>;
  /** Whether the subject currently has an active TOTP enrolment. */
  isTwoFactorActive(subject: MfaSubjectRef): Promise<boolean>;
}
