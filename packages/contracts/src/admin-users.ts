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
 * `passwordHash` and `twoFactorSecret` are absent, as they are from
 * `CustomerAccountRecord` and for the same reason: exactly one module reads
 * either, and a record that carried them would turn every consumer into a
 * place a credential can leak from.
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
 * Container name: `impersonationService`. Owner: `admin_users`.
 *
 * `customers` hosts the "view as this customer" control, so the surface and
 * the machinery sit in different modules by design.
 *
 * `impersonatedCustomerAccount` is the four-field identity the caller renders,
 * not the account entity and not `CustomerAccountRecord` — see its own note.
 */
export interface ImpersonationPort {
  start(input: ImpersonationStartInput): Promise<ImpersonationStartResult>;
  end(input: ImpersonationEndInput): Promise<ImpersonationEndResult>;
}
