---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
---

A new module package, `@endora-commerce/mod-crm` (module id `crm`), and the contract surface it
is built against.

**`@endora-commerce/mod-crm`** is new. In this release it is the module's backend and no
screen yet. An instance that installs it gains thirteen `crm_`-prefixed tables and a default
status workflow of six statuses on its next migration run; an instance that does not is
unaffected. What it serves, all under `/api/v1/admin/crm`:

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
  `POST …/propagations/:id/retry` and `…/dismiss` then address.

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
