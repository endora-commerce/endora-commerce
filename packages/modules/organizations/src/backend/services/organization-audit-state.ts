import { isDeepStrictEqual } from 'node:util';
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
 * Every top-level key an `organization.admin_patch` or
 * `organization.set_custom_field_values` audit state may hold. Anything else
 * is a value until somebody classifies it on purpose —
 * `admin-patch-organization.command.test.ts` holds the recorded state to this
 * list.
 */
export const ORGANIZATION_AUDIT_KEYS: ReadonlySet<string> = new Set([
  // Codes from a closed set.
  'status',
  'vatStatus',
  'fulfilmentStrategy',
  // What changed, by name.
  'changedFields',
  'changedCustomFields',
]);

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
