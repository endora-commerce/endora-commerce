# Contract: CRM admin HTTP API

**Feature**: `specs/143-crm-sales-opportunities/` · normative for
`packages/contracts/src/crm.ts` (the Zod schemas, written first — Principle II) and
`packages/modules/crm/src/backend/routes*.ts`.

- Base path `/api/v1/admin/crm`. Admin session only; there is **no** storefront or customer
  route in this feature.
- JSON field names are camelCase; paths are kebab-case (Principle VI).
- Every route is registered inside `ctx.routes(…)`, so the module gate applies at the
  registration seam: with `crm` off every path below answers 503 `MODULE_DISABLED`.
- Every route carries `preHandler: requireAdmin('<code>')` with the literal code in the
  *Gate* column.
- Envelope: `{ data }` for one resource, `{ data: [...], pagination }` for a list, the
  platform error envelope otherwise.
- Tenant scope is ambient. A resource of an Organization the caller may not see answers
  **404 `CRM_OPPORTUNITY_NOT_FOUND`**, the same as a missing one.
- Schema names below are the exports of `packages/contracts/src/crm.ts`.

## 1. Opportunities (US1; fields extended by US3, US6, US8)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `GET /opportunities` | `crm:read` | query `OpportunityListQuerySchema` | `{ data: OpportunitySummary[], pagination }` |
| `POST /opportunities` | `crm:write` | `CreateOpportunityRequestSchema` | 201 `{ data: OpportunityDetail }` |
| `GET /opportunities/:id` | `crm:read` | — | `{ data: OpportunityDetail }`, `ETag: "<version>"` |
| `PATCH /opportunities/:id` | `crm:write` | `UpdateOpportunityRequestSchema`, `If-Match` | `{ data: OpportunityDetail }`; 409 `VERSION_CONFLICT` |
| `DELETE /opportunities/:id` | `crm:configure` | — | 204 |

`OpportunityListQuerySchema`: `q?` (title, number, organization name), `statusCode?[]`,
`state?` (`open|won|lost`), `organizationId?`, `assignedAdminUserId?` (uuid | `me` |
`unassigned`), `salesChannelId?`, `tagId?[]` (AND), `createdFrom?`, `createdTo?`, `sort?`
(`createdAt|updatedAt|value|expectedCloseDate|number`), `order?` (`asc|desc`), `cursor?`,
`limit?` (default 50, max 200).

`CreateOpportunityRequestSchema`: `title` (1…200), `organizationId` (uuid), `currency`
(ISO 4217), `description?`, `customerAccountId?`, `salesChannelId?`, `assignedAdminUserId?`
(`null` = explicitly unassigned; absent = apply the default rule, US3), `valueMode?`
(default `manual`), `manualValue?` (decimal string ≥ 0), `expectedCloseDate?`
(`YYYY-MM-DD`), `tagIds?[]`.

`UpdateOpportunityRequestSchema`: every create field except `organizationId` and `currency`,
all optional. The Organization and the currency of an Opportunity are immutable.

`OpportunitySummary`: `id`, `number`, `title`, `organization { id, name }`, `status { code,
name, color, kind }`, `assignee { id, name, active } | null`, `value`, `valueMode`,
`currency`, `salesChannelId`, `expectedCloseDate`, `tags [{ id, name, color }]`, `closedAt`,
`closedKind`, `createdAt`, `updatedAt`.

`OpportunityDetail` = summary + `description`, `references` (§9), `customerAccount { id, name,
email } | null`, `manualValue`, `computedValue`, `excludedDocuments [{ kind, id, reason }]`,
`source`, `version`, `allowedTransitions [{ code, name, color, kind }]`,
`links: OpportunityLink[]`, `unresolvedPropagations: PropagationOutcome[]`.

## 2. Transition (US1)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `POST /opportunities/:id/transition` | `crm:write` | `TransitionOpportunityRequestSchema` | `{ data: OpportunityTransitionResult }` |
| `POST /opportunities/:id/propagations/:propagationId/retry` | `crm:write` | — | `{ data: PropagationOutcome }` |
| `POST /opportunities/:id/propagations/:propagationId/dismiss` | `crm:write` | — | 204 |

`TransitionOpportunityRequestSchema`: `to` (status code), `reason?` (≤ 2000).

`OpportunityTransitionResult`: `opportunity: OpportunityDetail`, `from`, `to`,
`propagation: PropagationOutcome[]`.

`PropagationOutcome`: `id`, `orderId`, `orderNumber | null`, `direction`,
`orderStatusCode`, `outcome` (`applied | already_there | not_found | unknown_status |
not_permitted | vetoed | failed | skipped`), `detail | null`, `createdAt`.

Refusals — nothing is written: 422 `VALIDATION_FAILED` (unknown status), 409
`CRM_INVALID_TRANSITION` (no edge), 409 `CRM_TRANSITION_VETOED` (a guard; `message` is the
guard's reason), 409 `CRM_TRANSITION_CONFLICT` (moved concurrently). `to` equal to the current
status answers 200 with an empty `propagation`.

**A refused Order change is not an HTTP error.** The Opportunity moved; the response is 200
and the refusal is an element of `propagation` with `outcome` and `detail` (FR-022).

## 3. Links (US1 orders; US8 quote requests)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `POST /opportunities/:id/links` | `crm:write` | `{ documentKind: 'order' \| 'quote_request', documentId: uuid, syncStatus?: boolean }` | 201 `{ data: OpportunityLink }` |
| `PATCH /opportunities/:id/links/:linkId` | `crm:write` | `{ syncStatus: boolean }` | `{ data: OpportunityLink }` |
| `DELETE /opportunities/:id/links/:linkId` | `crm:write` | — | 204 |

`OpportunityLink`: `id`, `documentKind`, `documentId`, `available`, and when available
`number`, `status`, `total`, `currency`; `syncStatus`, `linkSource`, `createdAt`.

Errors: 404 `CRM_DOCUMENT_NOT_FOUND` (missing or out of the caller's scope), 409
`CRM_DOCUMENT_ALREADY_LINKED` (`details.opportunityId` only if the caller may see that
Opportunity), 422 `CRM_LINK_ORGANIZATION_MISMATCH`, 503 `MODULE_DISABLED` for
`quote_request` while `quote_requests` is off.

## 4. Workflow configuration (US1; mappings reverse direction US2; counting US8)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `GET /workflow` | `crm:read` | — | `{ data: OpportunityWorkflow }` |
| `POST /statuses` | `crm:configure` | `CreateOpportunityStatusRequestSchema` | 201 |
| `PATCH /statuses/:code` | `crm:configure` | `UpdateOpportunityStatusRequestSchema` | 200 |
| `DELETE /statuses/:code` | `crm:configure` | — | 204 |
| `PUT /transitions` | `crm:configure` | `{ add?: Edge[], remove?: Edge[] }` | 200 `{ data: OpportunityWorkflow }` |
| `PUT /order-status-mappings` | `crm:configure` | `{ mappings: OrderStatusMapping[] }` (replaces the set) | 200 |
| `PUT /value-counting-statuses` | `crm:configure` | `{ order: string[], quoteRequest: QuoteRequestStatus[] }` | 202 (recalculation enqueued) |

`OpportunityWorkflow`: `statuses [{ code, name, defaultName, kind, isInitial, weight, color,
inUseCount }]`, `transitions [{ fromStatusCode, toStatusCode }]`,
`orderStatusMappings [{ direction, opportunityStatusCode, orderStatusCode, requireAllOrders,
orderStatusKnown }]`, `valueCountingStatuses { order: string[], quoteRequest: string[] }`.

`GET /workflow` is `crm:read`, not `crm:configure`: the list, the board and the detail screen
all need the statuses to render.

Errors: 409 `CRM_STATUS_CODE_TAKEN`, 409 `CRM_STATUS_IN_USE`, 409
`CRM_STATUS_INITIAL_REQUIRED`, 422 `CRM_WORKFLOW_INVALID` (`details.rule` names the broken
invariant).

Order statuses offered in the mapping and counting pickers are fetched by the admin screen
from the Orders API it already has (`GET /api/v1/admin/orders/statuses`, `orders`' gate) — CRM
does not proxy them.

## 5. Assignment (US3)

`POST /opportunities/:id/assign` · `crm:write` · `{ adminUserId: uuid | null }` →
`{ data: OpportunityDetail }`. 422 `CRM_ASSIGNEE_INVALID` for an unknown or inactive user.

## 6. Notes and messages (US4)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `GET /opportunities/:id/comments?kind=note\|message` | `crm:read` | — | `{ data: OpportunityComment[] }` (oldest first) |
| `POST /opportunities/:id/comments` | `crm:write` | `{ kind, body }` | 201 |
| `PATCH /opportunities/:id/comments/:commentId` | `crm:write` | `{ body }` | 200; 403 not the author; 409 `CRM_MESSAGE_IMMUTABLE` |
| `DELETE /opportunities/:id/comments/:commentId` | `crm:write` | — | 204; same refusals |

`OpportunityComment`: `id`, `kind`, `author { id, name }`, `body`, `references`, `editedAt`,
`createdAt`.

## 7. Attachments (US5)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `GET /opportunities/:id/attachments` | `crm:read` | — | `{ data: OpportunityAttachment[] }` |
| `POST /opportunities/:id/attachments` | `crm:write` | `{ assetId: uuid }` | 201 |
| `DELETE /opportunities/:id/attachments/:attachmentId` | `crm:write` | — | 204 |

`OpportunityAttachment`: `id`, `assetId`, `fileName`, `mimeType`, `sizeBytes`, `url | null`,
`uploadedBy { id, name }`, `createdAt`. The bytes are uploaded to the media library by the
admin first; this API stores the link only.

## 8. Tags (US6)

| Method · Path | Gate | Request |
| --- | --- | --- |
| `GET /tags` | `crm:read` | — → `{ data: [{ id, name, color, usageCount }] }` |
| `POST /tags` | `crm:configure` | `{ name, color? }` |
| `PATCH /tags/:id` | `crm:configure` | `{ name?, color? }` |
| `DELETE /tags/:id` | `crm:configure` | — |
| `PUT /opportunities/:id/tags` | `crm:write` | `{ tagIds: uuid[] }` (replaces the set) |

409 `CRM_TAG_NAME_TAKEN`.

## 9. References (US12)

Not an endpoint: every response field carrying free text (`description`, a comment `body`) is
accompanied by `references: [{ type: 'product' | 'order', id, available, label | null,
url | null }]`. Token grammar: `[[product:<uuid>]]`, `[[order:<uuid>]]`.

## 10. Board (US7)

`GET /board` · `crm:read` · query: the list filters minus `statusCode`/`state`, plus
`perColumn?` (default 50) → `{ data: { columns: [{ status, count, valueTotals: [{ currency,
total }], items: OpportunitySummary[], hasMore }] } }`. Moving a card is §2's transition
endpoint; there is no board-specific write.

## 11. History (US11)

`GET /opportunities/:id/history?limit&cursor` · `crm:read` →
`{ data: [{ id, actedAt, action, actor { kind, id | null, name | null }, before, after }],
pagination }`, newest first.

## 12. Analytics (US13)

All `crm:analytics`, all take `from`, `to` (ISO dates) and optional `salesChannelId`,
`assignedAdminUserId`.

| Path | Extra query | Data |
| --- | --- | --- |
| `GET /analytics/handling-time` | — | `{ averageSeconds, closedCount, byOutcome { won, lost } }` |
| `GET /analytics/time-in-status` | `statusCode[]` | `[{ statusCode, averageSeconds, sampleCount }]` |
| `GET /analytics/rep-effectiveness` | — | `[{ month, adminUser { id, name }, wonCount, wonValue [{ currency, total }] }]` |
| `GET /analytics/top-opportunities` | `limit` (default 10), `basis` (`created\|closed`) | `OpportunitySummary[]` |
| `GET /analytics/average-value` | — | `[{ currency, average, count }]` |

## 12a. Custom field values (US15)

No new endpoint. `CreateOpportunityRequestSchema` and `UpdateOpportunityRequestSchema` gain an
optional `customFieldValues: Record<string, unknown>` (the platform's `customFieldValuesSchema`
envelope), and `OpportunityDetail` gains `customFieldValues` — the projected bag. A value that
breaks its definition answers **422 `CUSTOM_FIELD_VALUE_INVALID`** with one issue per field
(`{ path: <field key>, issue }`); that code is owned by the custom-fields capability and is
not declared by `crm`. Absent on a PATCH means "leave the values as they are".

The host type is `opportunity`. Its definitions are managed on the existing custom-fields
admin API and screen, which offers the type only while `crm` is effectively present.

## 12b. The Opportunity of a document (US17)

`GET /documents/:documentKind/:documentId/opportunity` · `crm:read` ·
`documentKind ∈ order | quote_request` → `{ data: OpportunitySummary | null }`.

`null` — the document exists, is visible to the caller and is linked to no Opportunity.
404 `CRM_DOCUMENT_NOT_FOUND` — the document is missing or outside the caller's scope (the two
are indistinguishable). 422 for an unknown kind. 503 `MODULE_DISABLED` for `quote_request`
while `quote_requests` is off. Linking from the panel uses §3's endpoint and the list of §1
filtered by `organizationId` and `state=open`; nothing else is added.

## 13. Error codes owned by `crm`

Declared in the manifest's `errorCodes`, sentences under `errors.<CODE>` in
`packages/modules/crm/i18n/{en,pl}.json`:

`CRM_OPPORTUNITY_NOT_FOUND`, `CRM_INVALID_TRANSITION`, `CRM_TRANSITION_VETOED`,
`CRM_TRANSITION_CONFLICT`, `CRM_DOCUMENT_NOT_FOUND`, `CRM_DOCUMENT_ALREADY_LINKED`,
`CRM_LINK_ORGANIZATION_MISMATCH`, `CRM_STATUS_CODE_TAKEN`, `CRM_STATUS_IN_USE`,
`CRM_STATUS_INITIAL_REQUIRED`, `CRM_WORKFLOW_INVALID`, `CRM_ASSIGNEE_INVALID`,
`CRM_MESSAGE_IMMUTABLE`, `CRM_TAG_NAME_TAKEN`.

How a new code is minted — whether it must also become a member of `ERROR_CODES` in
`packages/contracts/src/errors.ts`, and which fixtures record it — is **not** established by
this design: commit `512b68e84` ("record the two minted error codes") is the most recent
worked example and task T038 reads it first.
