// `customer_accounts`' hookable actions — `specs/193-admin-form-extensions/`
// FR-110 (`contracts/hookable-writers.md` §1, D-300), on the mechanism of
// `specs/176-command-hooks-outbox/` (`contracts/command-hooks-api.md` §6).
//
// The three customer-account writes an instance may take part in through a
// command hook: the account's creation, its profile edit and its custom-field
// edit. The action strings, the phases and the data types are a public
// contract, additive only: changing one is a changeset on
// `@endora-commerce/contracts`.
//
// `customer_account.create` also runs as the child Command of a registration
// (`organization.register`). A hook sees those runs too, with no `extensions`.

import { hookableAction } from './command-hooks.js';
import type { CustomerAccountRecord } from './customer-accounts.js';

/**
 * `customer_account.create` — an account was created. `customerAccount`
 * reflects the **uncommitted** row on the Command's transaction. Held in
 * memory and never stored, so it carries values.
 */
export interface CustomerAccountCreateHookData {
  readonly customerAccount: CustomerAccountRecord;
}

/**
 * `customer_account.update_profile` and `customer.custom_fields.update` — an
 * existing account changed. `customerAccount` is the after-state.
 */
export interface CustomerAccountUpdateHookData {
  readonly customerAccount: CustomerAccountRecord;
  /** Sorted names of the profile fields whose value changed; `[]` for a custom-field edit. */
  readonly changedFields: readonly string[];
  /** Sorted keys of the custom fields whose value changed; `[]` for a profile edit. */
  readonly changedCustomFields: readonly string[];
}

/**
 * `afterCommit` data: ids and field names only (`specs/conventions/audit-state.md`
 * list 1). `organizationId` also pins the handler's scope to the account's
 * Organization. `changedFields` names the fields a creation wrote, or the
 * profile fields an edit changed; `changedCustomFields` the keys of the custom
 * fields whose value a custom-field edit changed, `[]` for the other two
 * actions — as `organizations`' update outbox does.
 */
export type CustomerAccountOutbox = {
  readonly customerAccountId: string;
  readonly organizationId: string | null;
  readonly changedFields: readonly string[];
  readonly changedCustomFields: readonly string[];
};

/**
 * The refs a hook author registers against (`ctx.commandHooks([{ on: ACCOUNTS.updateProfile, … }])`,
 * with `customer_accounts` among the hook module's manifest `dependencies`) and
 * the `customer_accounts` manifest lists. All three offer both phases.
 */
export const CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS = {
  create: hookableAction<CustomerAccountCreateHookData, CustomerAccountOutbox>('customer_account.create', 'customer_account', [
    'beforeCommit',
    'afterCommit',
  ]),
  updateProfile: hookableAction<CustomerAccountUpdateHookData, CustomerAccountOutbox>(
    'customer_account.update_profile',
    'customer_account',
    ['beforeCommit', 'afterCommit'],
  ),
  customFieldsUpdate: hookableAction<CustomerAccountUpdateHookData, CustomerAccountOutbox>(
    'customer.custom_fields.update',
    'customer_account',
    ['beforeCommit', 'afterCommit'],
  ),
} as const;
