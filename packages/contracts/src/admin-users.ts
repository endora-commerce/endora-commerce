/**
 * `admin_users` module contracts — the in-process port surface (feature 075,
 * Phase P).
 *
 * Eleven inbound sites, and they split cleanly in two: seven read the
 * `AdminUser` entity to put a name beside an id — `admin_roles` resolving a
 * user's role, `quote_requests` listing the admins a notification goes to,
 * `catalog` attributing a bulk operation, `organizations` rendering the
 * sales-rep picker — and the rest reach two services.
 *
 * Plain TypeScript rather than Zod: these describe in-process calls.
 */

/**
 * An admin user as it crosses a module boundary — a plain shape, never the ORM
 * entity (FR-011).
 *
 * `passwordHash` is absent, as it is from `CustomerAccountRecord` and for the
 * same reason: exactly one module reads it, and a record that carried it would
 * turn every consumer into a place a credential can leak from.
 */
export interface AdminUserRecord {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  adminRoleId: string | null;
  status: 'active' | 'inactive';
  /** Whether a confirmed TOTP enrolment exists. The secret itself never travels. */
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  /** Admin-UI language override, or `null` to follow the platform default. */
  preferredLanguage: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Which admins a lookup should consider. */
export interface AdminUserLookupOptions {
  /** Exclude soft-deleted admins. Defaults to `false` — the wider read. */
  activeOnly?: boolean;
}

/**
 * Container name: `adminUserReadPort`. Owner: `admin_users`.
 *
 * `listAll` is the notification fan-out: when an organisation has no assigned
 * sales rep, a quote request notifies every admin. It is the one read here
 * that is not a lookup by id, and it stays because the alternative — a
 * consumer paging the table itself — is the same query in a module that does
 * not own it.
 *
 * When `admin_users` is off every method fails closed. The module is
 * non-deactivatable in practice — a platform with no admin identity has no
 * admin surface — but the gate is registered anyway, for the reason `auth`
 * gives for its own.
 */
export interface AdminUserReadPort {
  findById(id: string, options?: AdminUserLookupOptions): Promise<AdminUserRecord | null>;
  findByIds(
    ids: readonly string[],
    options?: AdminUserLookupOptions,
  ): Promise<AdminUserRecord[]>;
  findByEmail(email: string, options?: AdminUserLookupOptions): Promise<AdminUserRecord | null>;
  /** Every admin, ordered by email. */
  listAll(options?: AdminUserLookupOptions): Promise<AdminUserRecord[]>;
  /** Admins holding a given role — the guard against deleting a role in use. */
  listByRoleId(adminRoleId: string): Promise<AdminUserRecord[]>;
}

/**
 * Container name: `adminUserPreferencePort`. Owner: `admin_users`.
 *
 * `_i18n` writes the admin's language choice and reads nothing else off the
 * row. One method, because that is the whole of the demand.
 */
export interface AdminUserPreferencePort {
  setPreferredLanguage(id: string, preferredLanguage: string | null): Promise<AdminUserRecord>;
}

/**
 * Container name: `adminPasswordVerificationPort`. Owner: `admin_users`.
 *
 * Does the stored credential of this admin match the password presented? One
 * method, because that is the whole of the demand: `mfa`'s step-up
 * re-verification asks it before it disables a second factor, and a boolean is
 * the entire answer.
 *
 * It is a port rather than a field on {@link AdminUserRecord} because the hash
 * must not travel — the record says so, and this method is what makes that
 * survivable. Until feature 080's T052 a composition root read
 * `admin_users`' `passwordHash` off the entity and compared it with the
 * platform hasher itself, so the one file in the tree that owns neither the
 * column nor the hashing held both.
 *
 * `false` for an unknown id as well — an admin nobody can find has no password
 * to match. It is a lookup by id and nothing else: whether the caller may
 * authenticate as that admin at all is the session layer's question, asked
 * before this one, and answering it twice in two places is how the two come to
 * disagree.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `admin_users` has an off state at all is its
 * manifest's `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface AdminPasswordVerificationPort {
  verifyPassword(adminUserId: string, password: string): Promise<boolean>;
}

export interface ImpersonationStartInput {
  adminUserId: string;
  /** Raw admin session cookie value — must be preserved as the shadow. */
  adminSessionCookieValue: string;
  customerAccountId: string;
  /**
   * Feature 040 — optional: standalone (org-less) customers have no
   * organisation. When provided it scopes the target lookup; when omitted the
   * target is found by id alone.
   */
  organizationId?: string | null;
  reason?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Who is being impersonated, as the one consumer renders them.
 *
 * Four fields, not a `CustomerAccountRecord`. `customers` reads exactly
 * `id`, `email`, `firstName` and `lastName` off this and returns them in the
 * response body; publishing the whole account here would have meant
 * `admin_users` importing `customer_accounts`' mapper to build a shape nobody
 * asked for — a new cross-module edge, added by the merge request whose job is
 * to remove them.
 */
export interface ImpersonatedCustomerIdentity {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface ImpersonationStartResult {
  impersonationSessionId: string;
  impersonationCookieValue: string;
  impersonationExpiresAt: Date;
  adminShadowSessionCookieValue: string;
  impersonatedCustomerAccount: ImpersonatedCustomerIdentity;
}

export interface ImpersonationEndInput {
  impersonationSessionCookieValue: string;
  adminShadowCookieValue: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface ImpersonationEndResult {
  adminSessionCookieValue: string;
  adminSessionExpiresAt: Date;
}

/**
 * Container name: `impersonationPort`. Owner: `admin_users`.
 *
 * (It said `impersonationService` until issue #192. Nothing registers that
 * name — a consumer copying it out of here got
 * `[kernel] 'impersonationService' is not registered in this composition` on
 * first call, and no `tsc` error before it.)
 *
 * `customers` hosts the "view as this customer" control, so the surface and
 * the machinery sit in different modules by design.
 *
 * `impersonatedCustomerAccount` is the four-field identity the caller renders,
 * not the account entity and not `CustomerAccountRecord` — see its own note.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so nothing
 * half-executes. Whether `admin_users` has an off state at all is its manifest's
 * `activation` to say, not this line's: a module declaring
 * `nonDeactivatable` never enters one.
 */
export interface ImpersonationPort {
  start(input: ImpersonationStartInput): Promise<ImpersonationStartResult>;
  end(input: ImpersonationEndInput): Promise<ImpersonationEndResult>;
}
