import { isDeepStrictEqual } from 'node:util';
import {
  ERROR_CODES,
  ORGANIZATION_MERGE_FIELD_CODES,
  type OrganizationMergeFieldCode,
  type RecordMergeChoice,
  type RecordMergeFieldDifference,
  type RecordMergeNotice,
} from '@endora-commerce/contracts';
import type { Organization } from '../entities/organization.entity.js';

/**
 * The Organization host's own merge rules (`specs/192-organization-merge/`
 * FR-020 – FR-023, FR-030 – FR-032, D-299), as pure functions of the two rows.
 * The preview asks them on a read and the start Command asks them again on the
 * two rows it locked, so the start can never accept what the preview refused.
 */

/** The columns the rules read. The entity satisfies it. */
export type MergeableOrganization = Pick<
  Organization,
  | 'id'
  | 'name'
  | 'status'
  | 'isPersonal'
  | 'path'
  | 'vatStatus'
  | 'registeredAddress'
  | 'orderConfirmationEmails'
  | 'customFieldValues'
> & {
  legalName?: string | null | undefined;
  taxId?: string | null | undefined;
  customerGroupId?: string | null | undefined;
  creditInheritanceMode?: Organization['creditInheritanceMode'] | undefined;
  fulfilmentStrategy?: Organization['fulfilmentStrategy'] | undefined;
  fulfilmentStrategyWarehouseOrder?: string[] | null | undefined;
  parentId?: string | null | undefined;
  deletedAt?: Date | null | undefined;
  mergedIntoOrganizationId?: string | null | undefined;
};

/** The root of an Organization's tree, read from its materialised path. */
export function rootIdOf(organization: Pick<MergeableOrganization, 'id' | 'path'>): string {
  return organization.path.split('/').filter(Boolean)[0] ?? organization.id;
}

/**
 * Every host refusal, in the contract's order (`contracts/organization-merge.md`
 * §3). The first two are terminal — nothing else is asked about a pair that is
 * not one — and the rest accumulate. Reach (step 2) is the route's: it answers
 * `404` before this runs, indistinguishable from absence.
 */
export function organizationMergeRefusals(
  survivor: MergeableOrganization | null,
  loser: MergeableOrganization | null,
  ids: { readonly survivorId: string; readonly loserId: string },
): RecordMergeNotice[] {
  if (ids.survivorId === ids.loserId) {
    return [{ code: ERROR_CODES.RECORD_MERGE_SAME_RECORD }];
  }
  const unavailable = (record: 'survivor' | 'loser', reason: string): RecordMergeNotice => ({
    code: ERROR_CODES.RECORD_MERGE_RECORD_UNAVAILABLE,
    details: { record, reason },
  });
  if (survivor === null) return [unavailable('survivor', 'missing')];
  if (loser === null) return [unavailable('loser', 'missing')];
  if (survivor.mergedIntoOrganizationId) return [unavailable('survivor', 'merged')];
  if (loser.mergedIntoOrganizationId) return [unavailable('loser', 'merged')];
  if (survivor.deletedAt) return [unavailable('survivor', 'deleted')];
  if (loser.deletedAt) return [unavailable('loser', 'deleted')];
  if (survivor.status === 'rejected') return [unavailable('survivor', 'rejected')];

  const refusals: RecordMergeNotice[] = [];
  if (survivor.isPersonal || loser.isPersonal) {
    refusals.push({
      code: ERROR_CODES.ORGANIZATION_MERGE_PERSONAL,
      details: { record: survivor.isPersonal ? 'survivor' : 'loser' },
    });
  }
  if (survivor.path.includes(`/${loser.id}/`)) {
    refusals.push({ code: ERROR_CODES.ORGANIZATION_MERGE_TREE_INVALID, details: { code: 'ancestor' } });
  } else {
    const bothRoots = !survivor.parentId && !loser.parentId;
    if (!bothRoots && rootIdOf(survivor) !== rootIdOf(loser)) {
      refusals.push({ code: ERROR_CODES.ORGANIZATION_MERGE_TREE_INVALID, details: { code: 'different_trees' } });
    }
  }
  return refusals;
}

/** Is a value "empty" for the fill-gaps rule: absent, null, a blank string or an empty list/object. */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** One offered field's value, as the preview shows it and the finalize applies it. */
export function fieldValue(organization: MergeableOrganization, code: OrganizationMergeFieldCode): unknown {
  switch (code) {
    case 'name':
      return organization.name;
    case 'legalName':
      return organization.legalName ?? null;
    case 'taxId':
      return organization.taxId ?? null;
    case 'vatStatus':
      return organization.vatStatus;
    case 'registeredAddress':
      return { ...organization.registeredAddress };
    case 'customerGroupId':
      return organization.customerGroupId ?? null;
    case 'creditInheritanceMode':
      return organization.creditInheritanceMode ?? null;
    case 'fulfilmentStrategy':
      return {
        strategy: organization.fulfilmentStrategy ?? null,
        warehouseOrder: organization.fulfilmentStrategyWarehouseOrder ?? null,
      };
  }
}

function isEmptyField(code: OrganizationMergeFieldCode, value: unknown): boolean {
  if (code === 'fulfilmentStrategy') return (value as { strategy: unknown }).strategy === null;
  return isEmptyValue(value);
}

/**
 * The offered fields whose values differ (FR-030). The survivor's wins by
 * default; a survivor field that is empty takes the loser's. Status,
 * moderation stamps and the tree position are never offered (FR-032), and the
 * order confirmation e-mails are always the union, so neither appears.
 */
export function fieldDifferences(
  survivor: MergeableOrganization,
  loser: MergeableOrganization,
): RecordMergeFieldDifference[] {
  const out: RecordMergeFieldDifference[] = [];
  for (const code of ORGANIZATION_MERGE_FIELD_CODES) {
    const s = fieldValue(survivor, code);
    const l = fieldValue(loser, code);
    if (isDeepStrictEqual(s, l)) continue;
    out.push({ code, survivor: s, loser: l, default: isEmptyField(code, s) && !isEmptyField(code, l) ? 'loser' : 'survivor' });
  }
  return out;
}

/** The field choices the finalize applies: the operator's, else each field's default. */
export function effectiveFieldChoices(
  survivor: MergeableOrganization,
  loser: MergeableOrganization,
  chosen: Readonly<Partial<Record<string, RecordMergeChoice>>>,
): Partial<Record<OrganizationMergeFieldCode, RecordMergeChoice>> {
  const out: Partial<Record<OrganizationMergeFieldCode, RecordMergeChoice>> = {};
  for (const difference of fieldDifferences(survivor, loser)) {
    const code = difference.code as OrganizationMergeFieldCode;
    out[code] = chosen[code] ?? difference.default;
  }
  return out;
}

/** The custom-field keys whose values differ, with the same default rule (FR-031). */
export function customFieldDifferences(
  survivor: MergeableOrganization,
  loser: MergeableOrganization,
): { key: string; survivor: unknown; loser: unknown; default: RecordMergeChoice }[] {
  const keys = [...new Set([...Object.keys(survivor.customFieldValues ?? {}), ...Object.keys(loser.customFieldValues ?? {})])].sort();
  const out: { key: string; survivor: unknown; loser: unknown; default: RecordMergeChoice }[] = [];
  for (const key of keys) {
    const s = survivor.customFieldValues?.[key];
    const l = loser.customFieldValues?.[key];
    if (isDeepStrictEqual(s ?? null, l ?? null)) continue;
    out.push({ key, survivor: s ?? null, loser: l ?? null, default: isEmptyValue(s) && !isEmptyValue(l) ? 'loser' : 'survivor' });
  }
  return out;
}

/**
 * The survivor's custom-field bag after the merge (FR-031): per key the
 * survivor's value, an empty survivor value filled from the loser, and the
 * loser's where the operator chose it. Values are taken whole — a multi-valued
 * field is never combined.
 */
export function resolvedCustomFieldValues(
  survivor: MergeableOrganization,
  loser: MergeableOrganization,
  chosen: Readonly<Record<string, RecordMergeChoice>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(survivor.customFieldValues ?? {}) };
  for (const difference of customFieldDifferences(survivor, loser)) {
    const choice = chosen[difference.key] ?? difference.default;
    if (choice === 'loser') out[difference.key] = difference.loser;
  }
  return out;
}
