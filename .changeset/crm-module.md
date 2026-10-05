---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
---

A new module package, `@endora-commerce/mod-crm` (module id `crm`), and the contract surface it
is built against.

**`@endora-commerce/mod-crm`** is new: a backend and the Admin UI screens over it. An instance
that installs it gains thirteen `crm_`-prefixed tables and a default status workflow of six
statuses on its next migration run; an instance that does not is unaffected. What it serves,
all under `/api/v1/admin/crm`:

- **the workflow and its configuration** — `GET /workflow`, `POST|PATCH|DELETE /statuses`,
  `PUT /transitions`, `PUT /order-status-mappings`. Every change re-validates the whole
  workflow and a broken rule is refused as 422 `CRM_WORKFLOW_INVALID` naming it in
  `details.rule`;
- **opportunities** — list (search, filters, sorting, cursor paging), create, read, edit with
  `If-Match`, delete. Tenant scope is ambient: an opportunity of an organization the caller
  may not see answers 404 `CRM_OPPORTUNITY_NOT_FOUND`, the same as a missing one;
- **linked orders** — `POST|PATCH|DELETE /opportunities/:id/links`. An order belongs to at
  most one opportunity and to the same organization;
- **transitions** — `POST /opportunities/:id/transition`. An opportunity's move asks every
  linked order that follows it to enter the mapped order status, through the Orders module's
  own `orderTransitionPort`, after the opportunity's change has committed. **A refused order
  change is not an error**: the response is 200, the opportunity has moved, and each order's
  outcome (`applied`, `already_there`, `not_permitted`, `vetoed`, `unknown_status`,
  `not_found`, `failed`) is an element of `propagation`, which
  `POST …/propagations/:id/retry` and `…/dismiss` then address;
- **the board** — `GET /board` (`crm:read`): one column per status in workflow order, each
  with `count`, `valueTotals` per currency, the first `perColumn` opportunities (default 50,
  at most 200) and `hasMore`. It takes the list's filters except `statusCode` and `state`,
  with the list's meaning — `assignedAdminUserId` (`me`, `unassigned` or an administrator's
  id) and a repeated `tagId` (every tag named) included — and applies them to the cards, the
  counts and the totals alike. There is no board-specific write — moving a card is the
  transition endpoint.

- **lookups for its own pickers** — `GET /lookups/organizations`, `/lookups/sales-channels`,
  `/lookups/assignees` (`crm:read`) and `/lookups/contacts` (`crm:write`). The screens'
  Organization, Sales Channel, assignee and contact-person pickers read these instead of the
  admin lists of the modules that own those rows, so a role holding only `crm:read`,
  `crm:write` and `orders:read` can filter and fill in every form; the owners' endpoints and
  their permissions are unchanged. Organizations and contact persons are narrowed to the
  caller's tenant scope, and an answer carries an id and a label only. The currency of a new
  opportunity is chosen from the currencies the active sales channels sell in.

**In the Admin UI** the package exports `./admin` (and `./tailwind.css`), which contributes
six screens and four entries to the shell's "CRM" sidebar section:

- `/crm/opportunities` (`crm:read`) — the list, with search and filters by state, status,
  organization, assignee ("mine", "unassigned" or a chosen person), tags (every tag chosen),
  sales channel and creation date, a column naming who holds each opportunity, and each
  opportunity's tags under its title;
- `/crm/opportunities/new` (`crm:write`) — create an opportunity by hand; an `organizationId`
  query parameter preselects the organization, and the assignee is optional — left empty, the
  default rule chooses — and tags can be set from the start;
- `/crm/opportunities/:id` (`crm:read`) — the status control, which offers exactly the
  transitions the workflow allows; the linked orders, with linking by search, the
  status-following switch and unlinking; and, per linked order, the outcome of each move, with
  *Retry* and *Dismiss* on a refused one. A holder of `crm:write` edits the opportunity in
  place — only the changed fields are sent, under `If-Match`, and a stale version is reported
  with a way to reload rather than retried — and may give a status change a reason; a holder
  of `crm:configure` can delete it, after a confirmation. The *Assignee* section names who
  holds the opportunity and lets a holder of `crm:write` reassign or unassign it in one
  choice; an assignee who has been deactivated is marked *inactive* here, on the list and on
  the board. The *Tags* section shows the opportunity's tags, and a holder of `crm:write`
  ticks and unticks them, each change saved at once;
- `/crm/tags` (`crm:configure`) — the tag list with each tag's usage count: add, rename,
  recolour, and delete after a confirmation naming how many opportunities lose the tag;
- `/crm/workflow` (`crm:configure`) — statuses and their kinds, the transition graph, the
  order status each opportunity status sets, and — the reverse direction — the opportunity
  status each order status leads to, with "only when every linked order is there" per row
  (on by default when the target closes the opportunity) and a marker on a mapping whose
  order status no longer exists;
- `/crm/board` (`crm:read`) — the opportunities as cards in a column per status, on the
  `KanbanBoard` primitive of `@endora-commerce/admin-kit`. A holder of `crm:write` moves a
  card by dragging it (mouse, touch, keyboard) or from the card's "Move to…" menu, which
  lists exactly the statuses the workflow allows; a refused move puts the card back with the
  server's reason, and a linked order that did not follow is reported on the card and above
  the board. It shares its filters with the list — the assignee and tag filters included.

Three command-palette actions — `open-opportunities`, `new-opportunity` and
`open-opportunity-board` — open the list, the create screen and the board.
The admin layer's peers — `@endora-commerce/admin-kit`, `react`, `react-router-dom` and
`lucide-react` — are optional, so a backend-only installation is not asked for them.

Its activation control is `crm.enabled` (on by default, switchable on `/platform/modules`).
Its permissions are `crm:read`, `crm:write` and `crm:configure`; no role receives one
automatically. It contributes a counter to `salesChannelAttributionRegistry`, so a sales
channel an opportunity is attributed to refuses deletion by name.

Business logic registers on a status change X → Y through two seams. The events
`crm.opportunity.status.from_<x>_to_<y>.before`, `…from_<x>.before`,
`crm.opportunity.status_changed.v1`, `…from_<x>_to_<y>.after`, `…to_<y>.after` and
`crm.opportunity.closed.v1` observe; a guard pushed into the container name
`opportunityTransitionGuardRegistry` from a contribution-only boot hook may refuse, by
throwing `OpportunityTransitionVetoError`, and its sentence is the 409
`CRM_TRANSITION_VETOED` message. A contributor declares
`nonBindingDependencies: [{ moduleId: 'crm', name: 'opportunityTransitionGuardRegistry', kind: 'contributes-to' }]`.

**`@endora-commerce/contracts`** gains the module's whole contract, exported from the package
root:

- the request and response schemas of the CRM admin API — `OpportunityListQuerySchema`,
  `CreateOpportunityRequestSchema`, `UpdateOpportunityRequestSchema`,
  `TransitionOpportunityRequestSchema`, `OpportunitySummarySchema`, `OpportunityDetailSchema`,
  `OpportunityWorkflowSchema` and their siblings, with the inferred types;
- `opportunityStatusEventName(kind, { from, to })` and `CRM_EVENTS`, the names of the events the
  module emits, with their payload types (`OpportunityStatusEvent` and the lifecycle events);
- the ports another module may use — `OpportunityReadPort`, `OpportunityTransitionPort` with
  `OpportunityTransitionOutcome`, and `OpportunityTransitionGuardRegistryPort` with
  `OpportunityTransitionGuard` and `OpportunityTransitionVetoError`;
- `formatOpportunityReferenceToken` and `extractOpportunityReferenceTokens`, the
  `[[product:<uuid>]]` / `[[order:<uuid>]]` reference grammar;
- eleven new members of `ERROR_CODES`, all prefixed `CRM_`: `CRM_OPPORTUNITY_NOT_FOUND`,
  `CRM_INVALID_TRANSITION`, `CRM_TRANSITION_VETOED`, `CRM_TRANSITION_CONFLICT`,
  `CRM_DOCUMENT_NOT_FOUND`, `CRM_DOCUMENT_ALREADY_LINKED`, `CRM_LINK_ORGANIZATION_MISMATCH`,
  `CRM_STATUS_CODE_TAKEN`, `CRM_STATUS_IN_USE`, `CRM_STATUS_INITIAL_REQUIRED` and
  `CRM_WORKFLOW_INVALID`. Additive; a consumer that switches exhaustively over `ErrorCode`
  gets a compile error until it handles them.

Of the three ports, `OpportunityTransitionGuardRegistryPort` is registered in this release
(container name `opportunityTransitionGuardRegistry`, owner `crm`). `OpportunityReadPort` and
`OpportunityTransitionPort` are types only until a later release registers them.

**`AdminNavSectionNameSchema` has a new member, `'crm'`.** The Admin UI shell declares a "CRM"
sidebar section, placed after *Sales*, that renders only while a module contributes a visible
entry to it. Additive for a module declaring navigation. A consumer that switches exhaustively
over `AdminNavSectionName` gets a compile error until it handles the new member — which is why
this is a `minor` in a `0.x` series rather than a `patch`.
