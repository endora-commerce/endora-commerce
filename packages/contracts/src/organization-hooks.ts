// `organizations`' hookable actions — `specs/176-command-hooks-outbox/` FR-024,
// `contracts/organization-hookable-actions.md`.
//
// The six Organization writes an instance may take part in through a command
// hook (`organization.convert_to_company` and `organization.tax_id.change`
// since issue #1057). The action strings, the phases and the data types are a public
// contract: changing one is a changeset on `@endora-commerce/contracts`.

import { hookableAction } from './command-hooks.js';
import type { OrganizationRecord, OrganizationStatus, VatStatus } from './organizations.js';

/**
 * `organization.create` — an operator creates an Organization. `organization`
 * reflects the **uncommitted** row on the Command's transaction.
 */
export interface OrganizationCreateHookData {
  readonly organization: OrganizationRecord;
  /** The channels the create bound, sorted and deduplicated. */
  readonly salesChannelIds: readonly string[];
}

/** `organization.register` — a business registers on the storefront. */
export interface OrganizationRegisterHookData {
  readonly organization: OrganizationRecord;
  /** The first account, created by the child `customer_account.create`. */
  readonly customerAccountId: string;
  /** The request's resolved channel; `null` when the system default was bound. */
  readonly salesChannelId: string | null;
  /** The registry lookup's outcome code, when the registration carried a matched lookup. */
  readonly registryLookupOutcome: string | null;
}

/**
 * `organization.admin_patch` and `organization.set_custom_field_values` — an
 * existing Organization changed. `organization` is the after-state.
 */
export interface OrganizationUpdateHookData {
  readonly organization: OrganizationRecord;
  /** Sorted names of the columns whose value changed. */
  readonly changedFields: readonly string[];
  /** Sorted keys of the custom fields whose value changed. */
  readonly changedCustomFields: readonly string[];
}

/**
 * `organization.convert_to_company` (issue #1057) — an operator turned a
 * personal Organization into a company. **Ids, codes and field names only**
 * (`specs/conventions/audit-state.md` list 1): never the tax ID, the name or the
 * address the conversion wrote.
 */
export interface OrganizationConvertToCompanyHookData {
  readonly organizationId: string;
  /** The status the conversion kept. */
  readonly status: OrganizationStatus;
  /** The company's VAT classification, as converted. */
  readonly vatStatus: VatStatus;
  /** Sorted names of the columns whose value changed. */
  readonly changedFields: readonly string[];
  /** `true` when the Organization had never been approved and the conversion stamped it. */
  readonly approvalStamped: boolean;
}

/**
 * `organization.tax_id.change` (issue #1057) — an operator corrected a
 * company's tax ID in place. **Never the old or the new tax ID**; a correction
 * to the same value (after normalisation) is handed `changedFields: []` and
 * `vatValidationReset: false`, and nothing was written.
 */
export interface OrganizationTaxIdChangeHookData {
  readonly organizationId: string;
  /** `['taxId']`, or `[]` for the same value. */
  readonly changedFields: readonly string[];
  /** `true` when the VAT validation summary was reset to never-validated. */
  readonly vatValidationReset: boolean;
}

/** `afterCommit` data: ids and codes only (audit-state list 1). Delivered in P3. */
export type OrganizationCreateOutbox = { readonly organizationId: string; readonly status: string };
export type OrganizationRegisterOutbox = {
  readonly organizationId: string;
  readonly customerAccountId: string;
  readonly status: string;
};
export type OrganizationUpdateOutbox = {
  readonly organizationId: string;
  readonly changedFields: readonly string[];
  readonly changedCustomFields: readonly string[];
};
export type OrganizationConvertToCompanyOutbox = {
  readonly organizationId: string;
  readonly status: string;
  readonly changedFields: readonly string[];
};
export type OrganizationTaxIdChangeOutbox = {
  readonly organizationId: string;
  readonly changedFields: readonly string[];
};

/**
 * The refs a hook author registers against (`ctx.commandHooks([{ on: ORG.create, … }])`)
 * and the `organizations` manifest lists. All six offer both phases; the
 * `afterCommit` delivery is the transactional outbox (P3).
 */
export const ORGANIZATION_HOOKABLE_ACTIONS = {
  create: hookableAction<OrganizationCreateHookData, OrganizationCreateOutbox>(
    'organization.create',
    'organization',
    ['beforeCommit', 'afterCommit'],
  ),
  register: hookableAction<OrganizationRegisterHookData, OrganizationRegisterOutbox>(
    'organization.register',
    'organization',
    ['beforeCommit', 'afterCommit'],
  ),
  adminPatch: hookableAction<OrganizationUpdateHookData, OrganizationUpdateOutbox>(
    'organization.admin_patch',
    'organization',
    ['beforeCommit', 'afterCommit'],
  ),
  setCustomFieldValues: hookableAction<OrganizationUpdateHookData, OrganizationUpdateOutbox>(
    'organization.set_custom_field_values',
    'organization',
    ['beforeCommit', 'afterCommit'],
  ),
  convertToCompany: hookableAction<OrganizationConvertToCompanyHookData, OrganizationConvertToCompanyOutbox>(
    'organization.convert_to_company',
    'organization',
    ['beforeCommit', 'afterCommit'],
  ),
  changeTaxId: hookableAction<OrganizationTaxIdChangeHookData, OrganizationTaxIdChangeOutbox>(
    'organization.tax_id.change',
    'organization',
    ['beforeCommit', 'afterCommit'],
  ),
} as const;
