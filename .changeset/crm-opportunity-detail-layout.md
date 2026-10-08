---
'@endora-commerce/mod-crm': patch
---

The Sales Opportunity screen is laid out anew: a header, a stage bar, tabs beside a column of
facts. Nothing about the API changes, and no action the screen had is gone.

- **Stage bar.** Every status of the workflow is listed in the operator's order — open statuses
  first, closing ones after — with the current one marked and "Stage n of N" counted over the
  open statuses. A status the workflow allows from the current one is a button (for a holder of
  `crm:write`) and performs the same `POST …/transition`, with the same optional reason, as the
  status buttons it replaces; every other status is text. The bar never shows a status as
  completed. It reads `GET /api/v1/admin/crm/workflow` (`crm:read`) and falls back to the current
  status and its allowed moves when that read fails.
- **A "Links" tab** (PL: "Powiązania") now holds *Linked orders* and *Linked quote requests*,
  with the number of linked documents on its label. They are no longer on *Overview*.
- **The selected tab is in the address**: `/crm/opportunities/:id?tab=links|notes|messages|attachments|history`.
  A bare address opens *Overview*, as before. The return address the module hands the Order and
  Quote Request create screens (`?created=…`) opens *Links*.
- **A column of facts** on the right of every tab — value and deadline, customer and assignee,
  classification, record — replaces the *Details* list of *Overview*. The value's mode, the
  assignee and the tags are still changed in place; everything else through **Edit**, which moved
  to the header.
- What became of the linked Orders after a status change is shown under the stage bar on every
  tab.
- Bundle keys: `opportunity.stage.*`, `opportunity.facts.*`, `opportunity.tabs.links`,
  `opportunity.tabs.label`, `opportunity.field.number`, `opportunity.field.closed` and
  `opportunity.description.empty*` are new in English and Polish; `opportunity.detail.subtitle`,
  `opportunity.status.current` and `opportunity.status.moveTo` are removed.

For an overlay that mounts this module's components: `components/StatusControl` is replaced by
`components/StageBar` (same props), and `OpportunityTabProps` gains `orderStatuses`, `editing`
and `onEditingChange`. Neither is part of the package's `exports`.
