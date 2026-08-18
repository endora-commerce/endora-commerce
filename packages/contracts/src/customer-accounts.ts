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
 * different module's surface over the same rows and stays where it is — with
 * one exception, the customer-group admin surface, whose Zod schemas arrived
 * here with the entity in feature 076 (D-79) because this module serves those
 * three routes itself.
 *
 * Nothing here imports from `backend/src/` (FR-034).
 */

import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

// --- customer groups ---------------------------------------------------------
//
// Feature 076, D-79 — the segmentation bucket a customer belongs to. It used to
// live in `price-lists.ts` because `price_lists` owned the table; a price list
// refers to a group by id, which is a reference rather than ownership, and the
// one real foreign key into `customer_groups` is
// `customer_accounts.customer_group_id`.

export const customerGroupSchema = z.object({
  id: uuidSchema,
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type CustomerGroup = z.infer<typeof customerGroupSchema>;

export const upsertCustomerGroupRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
});

/** A segmentation bucket as a module outside `customer_accounts` sees it. */
export interface CustomerGroupRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Container name: `customerGroupReadPort`. Owner: `customer_accounts`.
 *
 * The container name is unchanged by the relocation (D-81): it is what
 * `check-port-dependencies.ts` compares, and keeping it means `pwa` did not
 * have to be edited at all. `price_lists` reads it for the pricing rule-target
 * picker and the rule-target validation; `pwa` for the push audience builder;
 * `customers` for the group name on the admin customer list.
 *
 * This module is non-deactivatable, so the gate the port registration applies
 * cannot be reached — as it could not under the previous owner, which is also
 * non-deactivatable. The registration is a `providePort` anyway, for the reason
 * its siblings give.
 */
export interface CustomerGroupReadPort {
  findById(id: string): Promise<CustomerGroupRecord | null>;
  findByIds(ids: readonly string[]): Promise<CustomerGroupRecord[]>;
  /** Every group, ordered by code. */
  listAll(): Promise<CustomerGroupRecord[]>;
}

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

  /**
   * Substring search over the e-mail address, ordered by e-mail, capped at
   * `limit`. An empty `query` returns the first `limit` accounts.
   *
   * Published after Phase P because `pwa`'s push Rule Builder is the one
   * measured consumer that asks this question, and `listAll` is not the same
   * answer: a picker that loads every account to keep 200 of them is a
   * full-table read wearing a port.
   */
  searchByEmail(query: string, limit: number): Promise<CustomerAccountRecord[]>;

  /**
   * Ids of accounts whose e-mail, first name or last name contains `query`,
   * case-insensitively. An empty `query` returns no ids.
   *
   * Published after Phase P, as the twin of
   * `OrganizationDetailsPort.searchIdsByName` and for the same consumer: the
   * admin orders list resolves the people a search term names, then constrains
   * orders to them. It is deliberately **not** {@link searchByEmail}, which
   * matches the address alone — an operator typing a surname into the orders
   * search expects the surname to match, and it does today.
   *
   * Ids only, and uncapped, because the caller feeds them straight into an
   * `$in` over its own table and a cap would silently drop orders rather than
   * accounts.
   */
  searchIdsByName(query: string): Promise<string[]>;

  /** Every account, for the bulk export adapter. Ordered by email. */
  listAll(): Promise<CustomerAccountRecord[]>;
}

/**
 * A new account, as the module that owns the membership asks for one.
 *
 * The **plain** password crosses, not a hash: `passwordHash` is deliberately
 * absent from {@link CustomerAccountRecord} for the same reason, and a caller
 * that hashes is a caller that has to be told which algorithm the owner uses
 * and be trusted to keep using it. Hashing belongs on the owner's side of the
 * port, and moving it there removed the last three `hashPassword` imports from
 * `organizations`.
 */
export interface CustomerAccountCreateInput {
  organizationId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: CustomerAccountRole;
  /**
   * Whether the address is already confirmed. Accepting an invitation implies
   * it — the invitation was delivered to that address; self-registration and
   * the admin direct-create do not.
   */
  emailVerified?: boolean;
}

/** Absent fields are left unchanged. */
export interface CustomerAccountProfilePatch {
  /**
   * Lower-cased by the owner. Changing it clears `emailVerifiedAt`: the new
   * address has not been confirmed, and leaving the old confirmation standing
   * would let an admin verify an address by editing it.
   */
  email?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Container name: `customerAccountMemberWritePort`. Owner: `customer_accounts`.
 *
 * The member lifecycle `organizations` runs over accounts in its
 * organisations, published because that module ran it by creating and mutating
 * this module's entity directly (feature 075, Phase C). It is the union of
 * what that module measurably does and no more: three creation paths
 * (self-registration, invitation accept, admin direct-create) collapse into
 * one `create`, and the four field writes are one method each.
 *
 * **Every method is one unit of work on this module's table only** (D-78 rule
 * 1). No `EntityManager` crosses, and none needs to: each caller's remaining
 * writes are its own tables, flushed on its own side. Where that splits a
 * flush the caller used to share — the invitation accept wrote the account and
 * consumed the invitation together — the caller orders the two so the
 * recoverable half fails first, and says so at the call site.
 *
 * **Each method audits its own write**, in the same unit of work, exactly as
 * `roleService` and `addresses`' `addressService` do. The caller's own audit
 * row is a different fact — "an operator edited this member on the
 * organisation panel" rather than "this account's e-mail changed" — and both
 * are kept, which is what the role endpoint has always recorded.
 *
 * `changeRole` is **not** here: {@link CustomerRolePort} already owns it, with
 * the "an organisation keeps at least one admin" guard.
 * {@link CustomerAccountMemberWritePort.promoteToOrganizationAdmin} is a
 * different question — the break-glass path an operator reaches *because* an
 * organisation has no admin left — and it is named rather than expressed as an
 * unguarded `setRole`, which is a footgun beside a guarded one.
 *
 * When `customer_accounts` is off every method fails closed. The module is
 * non-deactivatable, so that gate cannot be reached today; it is registered
 * through `providePort` anyway, for the reason its seven siblings give.
 */
export interface CustomerAccountMemberWritePort {
  /**
   * Creates the account. Throws HTTP 409 `EMAIL_ALREADY_REGISTERED` when the
   * address is taken — the check is inside the write, so a caller that races
   * its own pre-check still gets the right code rather than a constraint
   * violation.
   */
  create(input: CustomerAccountCreateInput): Promise<CustomerAccountRecord>;

  /**
   * Throws HTTP 404 `NOT_FOUND` when no live account has that id, and HTTP 409
   * `EMAIL_ALREADY_REGISTERED` when the new address belongs to another one.
   */
  updateProfile(
    customerAccountId: string,
    patch: CustomerAccountProfilePatch,
  ): Promise<CustomerAccountRecord>;

  /** Feature 056 — the customer-side subtree roll-up capability. */
  setSubtreeRollup(
    customerAccountId: string,
    enabled: boolean,
  ): Promise<CustomerAccountRecord>;

  /** The break-glass promotion. Idempotent on an account that already holds it. */
  promoteToOrganizationAdmin(customerAccountId: string): Promise<CustomerAccountRecord>;

  /**
   * Stamps `emailVerifiedAt`, idempotently — a second call keeps the first
   * timestamp, so a retried verification does not move it.
   */
  markEmailVerified(customerAccountId: string, verifiedAt: Date): Promise<CustomerAccountRecord>;

  /**
   * Feature 051 — binds an org-less account to the organisation just
   * provisioned for it. Throws HTTP 404 `NOT_FOUND` when no account has that
   * id.
   */
  attachToOrganization(
    customerAccountId: string,
    organizationId: string,
  ): Promise<CustomerAccountRecord>;
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
