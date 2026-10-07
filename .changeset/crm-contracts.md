---
'@endora-commerce/contracts': minor
---

The contract surface of the new CRM module, and the small additions its neighbours needed. All
additive; the notes say where an exhaustive `switch` gains a case. Nothing a released version
exported changes shape.

**CRM (`crm.ts`, exported from the package root).** The request and response schemas of the
CRM admin API with their inferred types — opportunities, the workflow and its mappings, links,
propagation outcomes, the board, tags, comments, attachments, history, references, lookups,
the five analytics reads and `OpportunityOfDocumentResponseSchema`; `CRM_EVENTS` and
`opportunityStatusEventName(kind, { from, to })` with the event payload types; the strict
webhook payload schemas `OpportunityCreatedEventV1Schema`,
`OpportunityStatusChangedEventV1Schema`, `OpportunityClosedEventV1Schema` with
`CRM_WEBHOOK_EVENT_TYPES` and `CRM_WEBHOOK_EVENT_SCHEMAS`; the ports `OpportunityReadPort`
(with `OpportunityRecord`), `OpportunityTransitionPort` (with `OpportunityTransitionOutcome`)
and `OpportunityTransitionGuardRegistryPort` (with `OpportunityTransitionGuard` and
`OpportunityTransitionVetoError`); the reference grammar —
`formatOpportunityReferenceToken`, `extractOpportunityReferenceTokens`,
`splitOpportunityReferenceText`, `mentionedAdminUserIds` — over three reference types,
`product`, `order` and `admin_user`; the mention lookup schemas
(`OpportunityMentionLookupQuerySchema`, `OpportunityMentionOptionSchema`,
`OpportunityMentionLookupResponseSchema`); and `OPPORTUNITY_ATTACHMENT_MAX_BYTES`. A history
entry (`OpportunityHistoryEntrySchema`) carries `references` for the description it shows.

**`ERROR_CODES`** gains fifteen members, all prefixed `CRM_`: `CRM_OPPORTUNITY_NOT_FOUND`,
`CRM_INVALID_TRANSITION`, `CRM_TRANSITION_VETOED`, `CRM_TRANSITION_CONFLICT`,
`CRM_DOCUMENT_NOT_FOUND`, `CRM_DOCUMENT_ALREADY_LINKED`, `CRM_LINK_ORGANIZATION_MISMATCH`,
`CRM_STATUS_CODE_TAKEN`, `CRM_STATUS_IN_USE`, `CRM_STATUS_INITIAL_REQUIRED`,
`CRM_WORKFLOW_INVALID`, `CRM_ASSIGNEE_INVALID`, `CRM_TAG_NAME_TAKEN`,
`CRM_MESSAGE_IMMUTABLE` and `CRM_ATTACHMENT_TOO_LARGE`. A consumer that switches exhaustively
over `ErrorCode` gets a compile error until it handles them.

**New members of existing unions** — each a compile error for an exhaustive `switch` or a
`Record` over the union, which is why this is a `minor`:

- `AdminNavSectionNameSchema`: `'crm'`.
- `AdminZoneNameSchema` / `AdminZonePropsMap`: `'order.detail.after'`
  (`OrderDetailZoneProps`) and `'quote_request.detail.after'` (`QuoteRequestDetailZoneProps
  { quoteRequestId }`).
- `supportedEntityTypeSchema`: `'opportunity'`.
- `assetReferenceKindSchema`: `'crm_opportunity_attachment'`.

**For the neighbours.**

- `OriginReferenceSchema` / `OriginReference` (`{ type, id }`: a lower-case identifier of at
  most 64 characters and a UUID, strict), optional as `origin` on
  `adminCreateOrderRequestSchema` and `adminCreateQuoteRequestSchema`; the event payload types
  `OrderCreatedEventPayload` and `RfqCreatedByAdminEventPayload`, and the name
  `RFQ_CREATED_BY_ADMIN_EVENT`. A request without `origin` validates as before.
- `WebhookEventDescriptor` and `WebhookEventRegistryPort`, the contribution seam of
  `@endora-commerce/mod-webhooks`.
- `QUOTE_REQUEST_STATUS_VALUES` is exported.
