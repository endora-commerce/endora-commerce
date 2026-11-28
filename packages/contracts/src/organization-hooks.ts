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
 * personal Organization into a company. Hook data is handed in process to
 * `beforeCommit` hooks and never stored; the outbox data
 * (`OrganizationConvertToCompanyOutbox`) stays ids, codes and field names
 * (`specs/conventions/audit-state.md` list 1).
 */
export interface OrganizationConvertToCompanyHookData {
  /**
   * The converted Organization, the after-state on the Command's transaction,
   * as `OrganizationUpdateHookData` carries it (`specs/193-admin-form-extensions/`
   * D-300.26): what the field-rule check projects the conversion's `name`,
   * address and VAT status from.
   */
  readonly organization: OrganizationRecord;
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
 * `organization.merge.start` (`specs/192-organization-merge/` FR-061): a
 * deployment may veto a merge before it starts (`beforeCommit`) or start its
 * own work after it (`afterCommit`, through the outbox). The ids, the source
 * code and — since `specs/193-admin-form-extensions/` D-300.28 — the outcome
 * the start fixes on the survivor (`survivor`), which the platform's
 * field-rule check holds. Hook data stays in process; the outbox data
 * (`OrganizationMergeStartOutbox`) stays ids and codes.
 */
export interface OrganizationMergeStartHookData {
  readonly mergeId: string;
  readonly survivorId: string;
  readonly loserId: string;
  readonly source: string | null;
  /**
   * The survivor's organization field-set values after the operator's choices
   * and the union of both order-confirmation e-mail lists — what the finalize
   * will write — and the keys that change, sorted (D-300.28).
   */
  readonly survivor: {
    readonly after: Readonly<Record<string, unknown>>;
    readonly changed: readonly string[];
  };
}
export type OrganizationMergeStartOutbox = {
  readonly organizationId: string;
  readonly mergeId: string;
  readonly survivorId: string;
  readonly loserId: string;
  readonly source: string | null;
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
  mergeStart: hookableAction<OrganizationMergeStartHookData, OrganizationMergeStartOutbox>(
    'organization.merge.start',
    'organization',
    ['beforeCommit', 'afterCommit'],
  ),
} as const;
