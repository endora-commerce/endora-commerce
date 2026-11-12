// `organizations`' hookable actions — `specs/176-command-hooks-outbox/` FR-024,
// `contracts/organization-hookable-actions.md`.
//
// The four Organization writes an instance may take part in through a command
// hook. The action strings, the phases and the data types are a public
// contract: changing one is a changeset on `@endora-commerce/contracts`.

import { hookableAction } from './command-hooks.js';
import type { OrganizationRecord } from './organizations.js';

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

/**
 * The refs a hook author registers against (`ctx.commandHooks([{ on: ORG.create, … }])`)
 * and the `organizations` manifest lists. All four offer both phases; the
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
} as const;
