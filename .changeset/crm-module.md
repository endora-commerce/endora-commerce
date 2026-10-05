---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
---

A new module package, `@endora-commerce/mod-crm` (module id `crm`), and the contract surface it
is built against.

**`@endora-commerce/mod-crm`** is new. In this release it is the module's foundation and no
screen yet: its schema (thirteen `crm_`-prefixed tables and a default status workflow of six
statuses, created by one migration), its activation control `crm.enabled` (on by default,
switchable on `/platform/modules`), the permission `crm:read`, and one endpoint,
`GET /api/v1/admin/crm/workflow`. An instance that installs it gains the tables on its next
migration run; an instance that does not is unaffected.

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
  `[[product:<uuid>]]` / `[[order:<uuid>]]` reference grammar.

**`AdminNavSectionNameSchema` has a new member, `'crm'`.** The Admin UI shell declares a "CRM"
sidebar section, placed after *Sales*, that renders only while a module contributes a visible
entry to it. Additive for a module declaring navigation. A consumer that switches exhaustively
over `AdminNavSectionName` gets a compile error until it handles the new member — which is why
this is a `minor` in a `0.x` series rather than a `patch`.
