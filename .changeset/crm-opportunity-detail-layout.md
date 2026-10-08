---
'@endora-commerce/mod-crm': patch
---

The Sales Opportunity screen is laid out anew: a header and, under it, a stage bar and tabs
beside a card of facts. Nothing about the API changes, and no action the screen had is gone.

- **Stage bar.** It names the current status and shows only the statuses the workflow allows a
  move to from it — the Opportunity's own `allowedTransitions` — sorted into **Back** (an earlier
  status in the operator's order, and reopening) and **Forward** (a later status, and every
  closing one). It lists no other status, marks none as completed and counts no stage: the
  workflow is a graph. For a holder of `crm:write` each move is a button that performs the same
  `POST …/transition`, with the same optional reason, as the status buttons it replaces; a
  reader sees the moves as text. `GET /api/v1/admin/crm/workflow` (`crm:read`) is read only to
  order two open statuses; when that read fails every move is still offered, the ones it could
  not place under a plain heading.
- **A "Links" tab** (PL: "Powiązania") now holds *Linked orders* and *Linked quote requests*,
  with the number of linked documents on its label. They are no longer on *Overview*.
- **The selected tab is in the address**: `/crm/opportunities/:id?tab=links|notes|messages|attachments|history`.
  A bare address opens *Overview*, as before. The return address the module hands the Order and
  Quote Request create screens (`?created=…`) opens *Links*.
- **A card of facts** in the right column, from the header down beside the stage bar and the
  tabs — value and deadline, customer and assignee, classification, record — replaces the
  *Details* list of *Overview*. On a narrow screen it comes after the stage bar and before the
  tabs. The value's mode, the
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
