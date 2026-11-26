---
'@endora-commerce/mod-crm': minor
---

**`opportunityCommandPort` — server-side writes on an opportunity** (issue #1827). Another module, an overlay or an integration worker creates, edits, assigns, tags, links, comments on, moves and deletes an opportunity, and sets its custom-field values alone, through the published port, with the ambient actor (the system actor under `withSystemScope`) and an optional `source` code recorded in the audit entry. Each method runs the same Command, through the same code, as the admin endpoint for that operation, so the audit entry, the events, the guards and the notices are the same. A transition answers a refusal — a guard's veto included — as a value. A note or message needs an administrator as its author, so a worker writes one under `withSystemScopeActingFor`. With `crm` off, resolving the port answers `503 MODULE_DISABLED`; a consumer declares `crm` in `dependencies` or as a `refuses-without` `nonBindingDependencies` edge.

`opportunityReadPort` records now carry `customFieldValues`.

**Deprecated:** `opportunityTransitionPort` (removed in 0.114.0) now delegates to `opportunityCommandPort.transition` and no longer reads the `actor` you pass: the entry, the status history and the status events name the ambient actor, and the cause is `manual` under an administrator, `system` under none. Replace `applyStatus({ opportunityId, to, actor, reason })` with `transition(opportunityId, { to, reason }, { source })`.

The opportunity's change history no longer shows a port caller's `source` code as a change of the *Source* field; the audit log keeps it.
