import { isDeepStrictEqual } from 'node:util';
import type { CustomerAccount } from '../entities/customer-account.entity.js';

/**
 * What a customer-account audit entry may say (issue #470, D-288;
 * `specs/conventions/audit-state.md`).
 *
 * The platform audit log is one global table read under `audit_log:read`
 * without Organization reach, so an account's entry carries **names and
 * structure**: the names of the fields that changed, codes, booleans, dates and
 * role ids. Its e-mail, names, block reason, custom-field values, its
 * Organization (the tenant anchor) and an organization role's name stay out.
 * A move between Organizations is recorded as `changedFields:
 * ['organizationId', …]`.
 *
 * No history reads an account's values back out of the audit log — the
 * recent-activity feed takes no label from a customer-account entry — so the
 * values are kept nowhere else: the account row holds the current ones.
 */

/**
 * Every top-level key a customer-account audit state may hold. Anything else is
 * a value until somebody classifies it on purpose —
 * `customer-account-audit-sentinels.test.ts` holds every write's recorded
 * state to this list. The writes not covered there (`deletedAt`,
 * `emailVerifiedAt`, `subtreeRollupEnabled`, `customerGroupId`, `via`, the
 * anonymisation's `anonymizedAt` / `customFieldKeys` / `hadBlockReason`) record
 * dates, booleans, codes and a global id, and are listed for completeness.
 */
export const CUSTOMER_ACCOUNT_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // What changed, by name.
  'changedFields',
  'changedCustomFields',
  // The account's organization role, by id; whether the address was confirmed.
  'organizationRoleId',
  'emailVerified',
  // A block: when, by whom (a code), and whether a reason was given.
  'blockedAt',
  'blockSource',
  'hasBlockReason',
  // `customer_account.{change_role,remove_member,promote_organization_admin}`:
  // the member, and the role by id and kind.
  'customerAccountId',
  'role',
  // Dates, booleans, codes and a global id of the other writes.
  'deletedAt',
  'emailVerifiedAt',
  'subtreeRollupEnabled',
  'customerGroupId',
  'via',
  'anonymizedAt',
  'customFieldKeys',
  'hadBlockReason',
]);

const CREATED_FIELDS = ['email', 'firstName', 'lastName', 'organizationId', 'organizationRoleId'] as const;

/**
 * An account that came into being — `customer_account.create`,
 * `.register_standalone`, `.register_social`: the names of the fields it was
 * created with, its role by id and whether its address was confirmed.
 */
export function accountCreatedAuditState(
  account: Pick<CustomerAccount, (typeof CREATED_FIELDS)[number] | 'emailVerifiedAt'>,
): Record<string, unknown> {
  return {
    changedFields: CREATED_FIELDS.filter((key) => account[key] != null && account[key] !== '').sort(),
    organizationRoleId: account.organizationRoleId ?? null,
    emailVerified: account.emailVerifiedAt != null,
  };
}

/** A block's state: when, its source code, and whether a reason was given — never the reason. */
export function blockAuditState(
  account: Pick<CustomerAccount, 'blockedAt' | 'blockSource' | 'blockReason'>,
): Record<string, unknown> {
  return {
    blockedAt: account.blockedAt ? account.blockedAt.toISOString() : null,
    blockSource: account.blockSource ?? null,
    hasBlockReason: account.blockReason != null && account.blockReason !== '',
  };
}

/** The sorted keys whose value differs between two snapshots; `null` and absent are one. */
export function changedKeys(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !isDeepStrictEqual(before[key] ?? null, after[key] ?? null)).sort();
}

/**
 * A move between Organizations — `customer_account.organization_assigned`,
 * `.organization_unassigned`, `.attach_organization`: the role by id on each
 * side, and the names of what changed. Never the Organization ids.
 */
export function organizationMoveAuditState(
  before: { organizationId: string | null; organizationRoleId: string | null },
  after: { organizationId: string | null; organizationRoleId: string | null },
): { stateBefore: Record<string, unknown>; stateAfter: Record<string, unknown> } {
  return {
    stateBefore: { organizationRoleId: before.organizationRoleId },
    stateAfter: { organizationRoleId: after.organizationRoleId, changedFields: changedKeys(before, after) },
  };
}
