/**
 * `customer_accounts` module contracts — the in-process port surface
 * (feature 075, Phase P).
 *
 * `customer_accounts` is the second-heaviest provider in the tree: 65 import
 * sites across 19 modules, 51 of them on the `CustomerAccount` entity alone.
 * That concentration is what this file answers — one record shape and one read
 * port, so nineteen modules stop each writing their own `em.findOne`.
 *
 * Plain TypeScript rather than Zod: these describe in-process calls, not API
 * boundaries. The module's HTTP shapes live in `customers.ts`, which is a
 * different module's surface over the same rows and stays where it is.
 *
 * Nothing here imports from `backend/src/` (FR-034).
 */

// --- records -----------------------------------------------------------------

export type CustomerAccountRole = 'organization_admin' | 'regular_user';

export type CustomerAccountBlockSource = 'staff' | 'org_owner';

/**
 * A customer account as it crosses a module boundary — a plain shape, never
 * the ORM entity (FR-011).
 *
 * `passwordHash` and `twoFactorSecret` are deliberately absent. Both are read
 * by exactly one module — the owner — and neither has any business travelling:
 * a record that carries them turns every consumer into a place a credential
 * can leak from.
 */
export interface CustomerAccountRecord {
  id: string;
  organizationId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  role: CustomerAccountRole;
  emailVerifiedAt: Date | null;
  /** Whether a confirmed TOTP enrolment exists. The secret itself never travels. */
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  customFieldValues: Record<string, unknown>;
  deletedAt: Date | null;
  customerGroupId: string | null;
  subtreeRollupEnabled: boolean;
  blockedAt: Date | null;
  blockReason: string | null;
  blockSource: CustomerAccountBlockSource | null;
  blockedByAdminUserId: string | null;
  blockedByCustomerAccountId: string | null;
  deletionRequestedByAdminUserId: string | null;
  anonymizedAt: Date | null;
}

/**
 * Which accounts a lookup should consider. Soft-deleted accounts still resolve
 * from historical Orders, Invoices and RFQs, so "include them" is a real and
 * frequently correct answer — sixteen of the measured call sites pass
 * `deletedAt: null` and the rest deliberately do not.
 */
export interface CustomerAccountLookupOptions {
  /** Exclude soft-deleted accounts. Defaults to `false` — the wider read. */
  activeOnly?: boolean;
}

// --- ports -------------------------------------------------------------------

/**
 * Container name: `customerAccountReadPort`. Owner: `customer_accounts`.
 *
 * The union of what the nineteen consuming modules measurably ask for, and no
 * more: identity lookups by id, ids, email and organisation, plus the two
 * counting questions the org-admin invariant is enforced with.
 *
 * When `customer_accounts` is off every method throws `ModuleDisabledError`
 * (503 `MODULE_DISABLED`) at the resolution seam. That is the right answer for
 * a read whose absence would otherwise be indistinguishable from "no such
 * account": a cart approval that cannot identify its buyer must refuse, not
 * proceed anonymously.
 */
export interface CustomerAccountReadPort {
  findById(
    id: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null>;

  findByIds(
    ids: readonly string[],
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord[]>;

  findByEmail(
    email: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null>;

  /**
   * The account, but only if it belongs to that organisation. The two-argument
   * form exists because every admin path that touches a member checks
   * membership first, and doing it in one query is what stops the check being
   * forgotten.
   */
  findInOrganization(
    id: string,
    organizationId: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord | null>;

  /** Members of an organisation, ordered by role then creation date. */
  listByOrganization(
    organizationId: string,
    options?: CustomerAccountLookupOptions,
  ): Promise<CustomerAccountRecord[]>;

  /**
   * How many accounts in the organisation hold the role, optionally ignoring
   * one id and optionally counting only unblocked accounts. This is the shape
   * the "an organisation may not lose its last admin" rule is spelled with, in
   * three modules, three slightly different ways.
   */
  countByOrganizationRole(
    organizationId: string,
    role: CustomerAccountRole,
    options?: {
      excludeCustomerAccountId?: string;
      activeOnly?: boolean;
      notBlocked?: boolean;
    },
  ): Promise<number>;

  /** Every account, for the bulk export adapter. Ordered by email. */
  listAll(): Promise<CustomerAccountRecord[]>;
}

// --- the authenticated-surface ports -----------------------------------------

/** What a caller sets the session cookie from after a successful first factor. */
export interface CustomerLoginResult {
  customerAccount: CustomerAccountRecord;
  /** Value to put into the Set-Cookie header. */
  sessionCookieValue: string;
  sessionExpiresAt: Date;
}

/** Discriminated outcome of the first login step (feature 042). */
export type CustomerLoginOutcome =
  | ({ status: 'authenticated' } & CustomerLoginResult)
  | { status: 'mfaRequired'; challengeId: string }
  | { status: 'mfaSetupRequired'; setupTicket: string };

export interface CustomerLoginInput {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
  salesChannelId?: string | null;
}

/**
 * Container name: `customerAuthService`. Owner: `customer_accounts`.
 *
 * Consumed by `customers` and `organizations`, which own the storefront login,
 * registration and self-service routes over these accounts.
 */
export interface CustomerAuthPort {
  login(input: CustomerLoginInput): Promise<CustomerLoginOutcome>;
  changePassword(
    customerAccountId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
  logout(sessionId: string): Promise<void>;
}

/**
 * Container name: `passwordResetService`. Owner: `customer_accounts`.
 *
 * `requestReset` returns `{ rawToken: null }` for an unknown address on
 * purpose — the caller must not be able to tell an unknown e-mail from a known
 * one.
 */
export interface CustomerPasswordResetPort {
  requestReset(email: string): Promise<{ rawToken: string | null }>;
  confirmReset(rawToken: string, newPassword: string): Promise<void>;
}

/**
 * Container name: `roleService`. Owner: `customer_accounts`.
 *
 * Consumed by `organizations`, which owns the member-management surface. The
 * "an organisation keeps at least one admin" rule lives on this side of the
 * port, not in the caller.
 */
export interface CustomerRolePort {
  listMembers(organizationId: string): Promise<CustomerAccountRecord[]>;
  changeRole(
    organizationId: string,
    targetCustomerAccountId: string,
    newRole: CustomerAccountRole,
  ): Promise<CustomerAccountRecord>;
  removeMember(organizationId: string, targetCustomerAccountId: string): Promise<void>;
}

/** The one-time enrolment payload. The backup codes are shown once and hashed. */
export interface CustomerTotpEnrolmentResult {
  secret: string;
  otpauthUri: string;
  backupCodes: string[];
}

/**
 * Container name: `totpEnrolmentService`. Owner: `customer_accounts`.
 *
 * The customer's own second factor, which is a different thing from the `mfa`
 * module's login orchestration: this port writes the enrolment onto the
 * account row, `mfa` decides whether a login must present one.
 */
export interface CustomerTotpEnrolmentPort {
  enable(customerAccountId: string): Promise<CustomerTotpEnrolmentResult>;
  confirm(customerAccountId: string, code: string): Promise<void>;
  disable(customerAccountId: string, codeOrBackup: string): Promise<void>;
}
