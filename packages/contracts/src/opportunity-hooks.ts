// `crm`'s hookable actions — `specs/193-admin-form-extensions/` FR-111
// (`contracts/hookable-writers.md` §2, issue #2006), on the mechanism of
// `specs/176-command-hooks-outbox/` (`contracts/command-hooks-api.md` §6).
//
// The two Opportunity writes that save the editor's field set: creating one
// and editing one. Editing covers every `crm.opportunity.update` — the admin
// `PATCH`, `opportunityCommandPort.update` and its `setCustomFieldValues`, the
// values-only write the custom-field port runs. The action strings, the phases
// and the data types are a public contract: changing one is a changeset on
// `@endora-commerce/contracts`.
//
// The object type is `crm_opportunity`, the one every `crm.opportunity.*`
// audit entry has always recorded and the Opportunity's history reads back: a
// ref names the Command's object type, and renaming that would cut every
// existing entry off its record.

import { hookableAction } from './command-hooks.js';
import type { OpportunityRecord } from './crm.js';

/**
 * What a `beforeCommit` hook on either action is handed. In memory only, never
 * stored, so it may carry the record: `opportunity` is the **uncommitted**
 * after-state on the Command's transaction, mapped as `opportunityReadPort`
 * maps one (its `updatedAt` is the row's until the commit stamps it).
 */
export interface OpportunityHookData {
  readonly opportunity: OpportunityRecord;
  /**
   * Sorted names of the Opportunity's fields the write set (`create`) or
   * changed (`update`), among `assignedAdminUserId`, `currency`,
   * `customerAccountId`, `description`, `expectedCloseDate`, `manualValue`,
   * `organizationId`, `salesChannelId`, `statusCode`, `tags`, `title` and
   * `valueMode`. `[]` when an edit changed none.
   */
  readonly changedFields: readonly string[];
  /** Sorted keys of the custom fields the write set or changed. */
  readonly changedCustomFields: readonly string[];
}

/** `crm.opportunity.create` — an administrator, a port caller or a document's placement created an Opportunity. */
export type OpportunityCreateHookData = OpportunityHookData;

/** `crm.opportunity.update` — an Opportunity's fields or custom-field values were saved. */
export type OpportunityUpdateHookData = OpportunityHookData;

/**
 * `afterCommit` data: ids and field names only (`specs/conventions/audit-state.md`
 * list 1) — never the title, the description, the value or a custom-field
 * value; a handler re-reads the Opportunity through `opportunityReadPort`. The
 * row is pinned to the Opportunity's Organization, so the handler runs in its
 * scope and can read it.
 */
export type OpportunityOutbox = {
  readonly opportunityId: string;
  readonly organizationId: string;
  readonly changedFields: readonly string[];
  readonly changedCustomFields: readonly string[];
};

/**
 * The refs a hook author registers against (`ctx.commandHooks([{ on: OPPORTUNITY_HOOKABLE_ACTIONS.update, … }])`,
 * with `crm` among the hook module's manifest `dependencies`) and the `crm`
 * manifest lists. Both offer both phases.
 */
export const OPPORTUNITY_HOOKABLE_ACTIONS = {
  create: hookableAction<OpportunityCreateHookData, OpportunityOutbox>('crm.opportunity.create', 'crm_opportunity', [
    'beforeCommit',
    'afterCommit',
  ]),
  update: hookableAction<OpportunityUpdateHookData, OpportunityOutbox>('crm.opportunity.update', 'crm_opportunity', [
    'beforeCommit',
    'afterCommit',
  ]),
} as const;
