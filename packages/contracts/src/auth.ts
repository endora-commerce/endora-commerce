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
 *
 * Whether `auth` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface AuthSessionPort {
  createSession(input: AuthCreateSessionInput): Promise<AuthSessionCookiePayload>;
  loadSession(cookieValue: string): Promise<AuthResolvedSession | null>;
  destroySession(sessionId: string): Promise<void>;
  destroyAllForCustomer(customerAccountId: string): Promise<void>;
  /**
   * Revoke every session an admin user holds — the ones they signed in with
   * and the impersonations they started. Called when their password is set by
   * somebody other than the current session, so a credential the reset was
   * meant to withdraw cannot outlive it (issue #252).
   */
  destroyAllForAdmin(adminUserId: string): Promise<void>;
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
 *
 * Whether `auth` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
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
 * One question: *what does the second factor say about this login?* Asked by
 * `admin_users` and `customer_accounts`, each after the password has verified.
 *
 * **The registration is gated and it throws.** `mfa` publishes this name with
 * `ctx.di.providePort`, so resolving it while the module is not effectively
 * present raises `ModuleDisabledError`. This port performs no degrade of its
 * own, and no caller may catch that error.
 *
 * **The consumer answers for absence, by not resolving** (D-96). Both login
 * services probe `effectiveState.isPresent('mfa')` and pass `undefined` into
 * the `if (mfaPort)` branch they already have, which issues the session on the
 * password alone — the password-only fallback of feature 042 FR-033, and what
 * Constitution XVII means by "a module that is off behaves as if never
 * installed". Each consumer declares the edge in its manifest as
 * `nonBindingDependencies: [{ moduleId: 'mfa', kind: 'degrades-without' }]`,
 * whose `whenAbsent` sentence is what the operator reads before flipping the
 * switch and what the off-state test is held to.
 *
 * This doc block used to describe the degrade as something the port would
 * perform. It never could, and the tree did the opposite: every admin and
 * customer login answered 503 while `mfa` was switched off.
 */
export interface MfaLoginPort {
  beginLogin(subject: MfaSubjectRef, ctx: MfaLoginContext): Promise<MfaLoginDecision>;
}
