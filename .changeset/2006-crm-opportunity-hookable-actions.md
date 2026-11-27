---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-crm': minor
---

**CRM declares two hookable actions** (`specs/193-admin-form-extensions/` FR-111, issue #2006), so a deployment's overlay module or an installed package can take part in creating or editing an Opportunity through a command hook: `crm.opportunity.create` and `crm.opportunity.update`, each for both phases (`beforeCommit` inside the write's transaction, with a veto that rolls it back; `afterCommit` through the platform's outbox). `crm.opportunity.update` is every edit — the admin `PATCH`, `opportunityCommandPort.update` and `opportunityCommandPort.setCustomFieldValues`. Neither Command is reversible. The object type is `crm_opportunity`, the one their audit entries have always recorded.

`@endora-commerce/contracts` exports the refs as `OPPORTUNITY_HOOKABLE_ACTIONS` (`create`, `update`) and their data types `OpportunityHookData` (with the aliases `OpportunityCreateHookData` and `OpportunityUpdateHookData`) and `OpportunityOutbox`. A `beforeCommit` hook is handed `opportunity`, the uncommitted after-state as an `OpportunityRecord`, with `changedFields` and `changedCustomFields`, the sorted names of what the write set or changed. An outbox row carries `opportunityId`, `organizationId`, `changedFields` and `changedCustomFields` only, and is pinned to the Opportunity's Organization.

`opportunityCommandPort.create`, `.update` and `.setCustomFieldValues` now forward `options.extensions` to the Command: the bus hands a key to the hook module that claims it and refuses an unclaimed one with `422 COMMAND_EXTENSION_UNCLAIMED`, as before, now after the method's own reads and before anything is written. The port's other methods run Commands no module can hook and still refuse any `extensions` key before they read anything.

An edit whose custom-field values changed underneath it between validation and the row lock is still validated again and retried; the attempt that found them changed now rolls back before any hook runs, so hooks and outbox rows see only the write that happened. The Opportunity created for a placed document answers `already-linked` only for the document link's own unique index; any other unique violation, a hook's write included, now fails the creation instead of cancelling it silently. That Opportunity's create hook sees its computed value before the recalculation that follows the commit.

A hook module registers against these refs and lists `crm` in its manifest `dependencies`. Nothing changes for a deployment that registers no hook.
