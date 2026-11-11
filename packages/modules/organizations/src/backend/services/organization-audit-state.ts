import { isDeepStrictEqual } from 'node:util';
import type { CustomerAccountRecord } from '@endora-commerce/contracts';
import type { Organization } from '../entities/organization.entity.js';

/**
 * What an `organization.*` audit entry may say (issue #470, D-288;
 * `specs/conventions/audit-state.md`, owner ruling O-2).
 *
 * `Organization` is `@GlobalEntity` because it *is* the tenant, but its name,
 * legal name, tax id, address, order-confirmation e-mails, block and rejection
 * reasons and custom-field values are that tenant's values, and the platform
 * audit log is one global table read under `audit_log:read` without
 * Organization reach. So an entry carries **names and structure**: status and
 * VAT codes, the fulfilment-strategy code, and the sorted names of what
 * changed.
 *
 * Organizations has no value store of its own yet (#1031): no history reads an
 * Organization's values back out of the audit log, and the Organization row
 * holds the current ones.
 */

/**
 * Every top-level key an organizations audit state may hold — the
 * `organization.*`, `organization_role.*` and `organization_invitation.*`
 * entries and the `customer_account.admin_*` member writes this module records
 * — plus the keys of a nested `role` snapshot. Anything else is a value until
 * somebody classifies it on purpose: `admin-patch-organization.command.test.ts`
 * and `organization-audit-sentinels.test.ts` hold the recorded states to this
 * list. The writes not covered there (allow lists, sales reps, hierarchy,
 * credit mode, VAT validation, anonymisation, e-mail verification) record ids,
 * codes, booleans, counts and dates, and are listed for completeness.
 */
export const ORGANIZATION_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // Codes from a closed set.
  'status',
  'vatStatus',
  'fulfilmentStrategy',
  'isPersonal',
  'creditInheritanceMode',
  'scope',
  'taxIdScope',
  'kind',
  'provider',
  'outcome',
  'registryLookup',
  // What changed, by name.
  'changedFields',
  'changedCustomFields',
  'customFieldKeys',
  // Booleans: whether a reason, a legal name, a confirmed address was there.
  'hasBlockedReason',
  'hasRejectedReason',
  'hadBlockedReason',
  'hadRejectedReason',
  'hadLegalName',
  'wasDeleted',
  'approvalStamped',
  'appliedAutoFill',
  'emailVerified',
  'twoFactorEnabled',
  'subtreeRollupEnabled',
  // Counts and the optimistic-lock version.
  'version',
  'memberCount',
  'invitationCount',
  'orderConfirmationEmailCount',
  // Dates.
  'approvedAt',
  'blockedAt',
  'rejectedAt',
  'anonymizedAt',
  // Ids of other records: the parent, channels, admin users, accounts, roles,
  // invitations, methods and warehouses; a hierarchy path is a chain of ids.
  'parentId',
  'path',
  'subtreePaths',
  'salesChannelIds',
  'approvedByAdminUserId',
  'adminUserId',
  'customerAccountId',
  'organizationRoleId',
  'invitationId',
  'deletedRoleId',
  'replacementRoleId',
  'reassignedInvitations',
  'paymentMethodIds',
  'deliveryMethodIds',
  'warehouseIds',
  'add',
  'remove',
  // A role snapshot (`role`): its id, its kind and its sorted permission codes.
  'role',
  'id',
  'permissions',
]);

/**
 * The names of the columns in `fields` that hold a value on `record` — what a
 * row that came into being was created with, for its `changedFields`.
 */
export function presentFields<T extends object>(record: T, fields: ReadonlyArray<keyof T & string>): string[] {
  return fields
    .filter((field) => {
      const value = record[field];
      return value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
    })
    .sort();
}

/** The columns an Organization is created with, by an operator or by self-registration. */
export const ORGANIZATION_CREATED_FIELDS = [
  'name',
  'legalName',
  'taxId',
  'registeredAddress',
  'orderConfirmationEmails',
] as const satisfies ReadonlyArray<keyof Organization>;

/**
 * What `organization.delete` records about the row it soft-deletes: codes, the
 * parent's id and the version — never the name, tax id, address, reasons or
 * custom-field values `serializeOrg` answers with.
 */
export function organizationDeletedAuditState(org: Organization): Record<string, unknown> {
  return {
    status: org.status,
    vatStatus: org.vatStatus,
    isPersonal: org.isPersonal,
    parentId: org.parentId ?? null,
    version: org.version,
  };
}

/**
 * A moderation transition's snapshot (`organization.approved|rejected|blocked|unblocked`):
 * the status, its dates and approving admin, the version, and whether a block
 * or rejection reason is set — never the reason.
 */
export function moderationAuditState(org: Organization): Record<string, unknown> {
  return {
    status: org.status,
    approvedAt: org.approvedAt ? org.approvedAt.toISOString() : null,
    approvedByAdminUserId: org.approvedByAdminUserId ?? null,
    blockedAt: org.blockedAt ? org.blockedAt.toISOString() : null,
    hasBlockedReason: hasText(org.blockedReason),
    rejectedAt: org.rejectedAt ? org.rejectedAt.toISOString() : null,
    hasRejectedReason: hasText(org.rejectedReason),
    version: org.version,
  };
}

function hasText(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== '';
}

/** The member columns the admin member writes are compared on, to name what changed. */
type MemberSnapshot = Pick<
  CustomerAccountRecord,
  'email' | 'firstName' | 'lastName' | 'organizationRoleId' | 'subtreeRollupEnabled' | 'twoFactorEnabled'
> & { emailVerifiedAt: Date | null };

/**
 * A member as a `customer_account.admin_*` entry records it: its role by id
 * and its flags. Never its e-mail, names or Organization (the tenant anchor).
 */
export function memberAuditState(member: MemberSnapshot): Record<string, unknown> {
  return {
    organizationRoleId: member.organizationRoleId,
    subtreeRollupEnabled: member.subtreeRollupEnabled ?? false,
    emailVerified: member.emailVerifiedAt != null,
    twoFactorEnabled: member.twoFactorEnabled ?? false,
  };
}

/**
 * `customer_account.admin_create`: the names of the fields the member was
 * created with, its role by id, whether the address is confirmed, and the
 * custom-field keys stored.
 */
export function memberCreatedAuditState(
  member: MemberSnapshot & { organizationId: string },
  customFieldKeys: readonly string[],
): Record<string, unknown> {
  return {
    changedFields: presentFields(member, ['email', 'firstName', 'lastName', 'organizationId', 'organizationRoleId']),
    organizationRoleId: member.organizationRoleId,
    emailVerified: member.emailVerifiedAt != null,
    changedCustomFields: [...customFieldKeys].sort(),
  };
}

/**
 * `customer_account.admin_profile_update` / `.admin_rollup_change`: the
 * member's snapshot on both sides and, after, the sorted names of what
 * changed — `email`, `firstName`, `lastName` by name only.
 */
export function memberUpdatedAuditState(
  before: MemberSnapshot,
  after: MemberSnapshot,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const compared = (m: MemberSnapshot) => ({
    email: m.email,
    firstName: m.firstName,
    lastName: m.lastName,
    ...memberAuditState(m),
  });
  return {
    before: memberAuditState(before),
    after: { ...memberAuditState(after), changedFields: changedKeys(compared(before), compared(after)) },
  };
}

/** The columns `organization.admin_patch` may set, compared to name what changed. */
type PatchableField =
  | 'name'
  | 'vatStatus'
  | 'status'
  | 'orderConfirmationEmails'
  | 'fulfilmentStrategy'
  | 'fulfilmentStrategyWarehouseOrder';

type PatchableValues = Record<PatchableField, unknown>;

/**
 * The sorted keys whose value differs between two records — a key added,
 * removed or changed; `null` and absent are one. Names what a write changed
 * among an Organization's columns (`changedFields`) or in its custom-field bag
 * (`changedCustomFields`).
 */
export function changedKeys(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !isDeepStrictEqual(before[key] ?? null, after[key] ?? null)).sort();
}

/**
 * What `organization.admin_patch` reads off the Organization before it writes:
 * a copy of the patchable columns and of the custom-field bag, so the after
 * state can name what changed. It is never recorded itself.
 */
export interface OrganizationPatchBaseline {
  readonly values: PatchableValues;
  readonly customFieldValues: Readonly<Record<string, unknown>>;
  readonly codes: Record<string, unknown>;
}

function patchableValues(org: Organization): PatchableValues {
  return {
    name: org.name,
    vatStatus: org.vatStatus,
    status: org.status,
    orderConfirmationEmails: [...(org.orderConfirmationEmails ?? [])],
    fulfilmentStrategy: org.fulfilmentStrategy ?? null,
    fulfilmentStrategyWarehouseOrder: org.fulfilmentStrategyWarehouseOrder
      ? [...org.fulfilmentStrategyWarehouseOrder]
      : null,
  };
}

function codes(org: Organization): Record<string, unknown> {
  return {
    status: org.status,
    vatStatus: org.vatStatus,
    fulfilmentStrategy: org.fulfilmentStrategy ?? null,
  };
}

export function organizationPatchBaseline(org: Organization): OrganizationPatchBaseline {
  return {
    values: patchableValues(org),
    customFieldValues: { ...(org.customFieldValues ?? {}) },
    codes: codes(org),
  };
}

/**
 * The audit state of `organization.admin_patch`: the codes before and after,
 * and after the write the sorted names of the columns (`changedFields`) and
 * custom fields (`changedCustomFields`) whose value differs. Never a value.
 */
export function organizationPatchAuditState(
  baseline: OrganizationPatchBaseline,
  org: Organization,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  return {
    before: { ...baseline.codes },
    after: {
      ...codes(org),
      changedFields: changedKeys(baseline.values, patchableValues(org)),
      changedCustomFields: changedKeys(baseline.customFieldValues, org.customFieldValues ?? {}),
    },
  };
}
