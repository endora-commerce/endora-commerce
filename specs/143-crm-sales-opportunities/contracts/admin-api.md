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
| `PATCH /opportunities/:id` | `crm:write` | `UpdateOpportunityRequestSchema`, `If-Match` | `{ data: OpportunityDetail }`; 409 `VERSION_CONFLICT`; 400 `VALIDATION_FAILED` for an `If-Match` that is not the version — quoted as the `ETag` gives it, or bare — or `*` (research N-R9) |
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

**Moving a followed Order is a consequence of the workflow, not an act of the caller.** The
transition is gated `crm:write` and nothing more: the Order status a transition asks for was
mapped by somebody holding `crm:configure`, and it is applied whether or not the acting
administrator holds `orders:write` (research N-R3). What does ask for `orders:read` is
deciding *which* Orders follow — §3.

## 3. Links (US1 orders; US8 quote requests)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `POST /opportunities/:id/links` | `crm:write` | `{ documentKind: 'order' \| 'quote_request', documentId: uuid, syncStatus?: boolean }` | 201 `{ data: OpportunityLink }` |
| `PATCH /opportunities/:id/links/:linkId` | `crm:write` | `{ syncStatus: boolean }` | `{ data: OpportunityLink }` |
| `DELETE /opportunities/:id/links/:linkId` | `crm:write` | — | 204 |

`OpportunityLink`: `id`, `documentKind`, `documentId`, `available`, and when available
`number`, `status`, `total`, `currency`; `syncStatus`, `linkSource`, `createdAt`.

**`orders:read` as well as `crm:write`** for `POST` with `documentKind: 'order'` and for
`PATCH` — 403 `FORBIDDEN` without it. And a reader without `orders:read` is shown a linked
Order as `available: false`, with no `number`, `status`, `total` or `currency`, and a
`PropagationOutcome` with `orderNumber: null` (research N-R3).

**`rfqs:handle` as well as `crm:write`** for `POST` with `documentKind: 'quote_request'` — the
one code `quote_requests` declares, and the one its own admin list and detail are read with —
and a reader without it is shown a linked Quote Request as `available: false`, by the same
rule (research N-R13). `DELETE` asks for `crm:write` alone, for either kind.

**`excludedDocuments` follows the same rule**: an entry of kind `order` is returned to a
reader holding `orders:read`, one of kind `quote_request` to a reader holding `rfqs:handle`.
`value` and `computedValue` are the Opportunity's own figures and are not narrowed.

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
`{ data: OpportunityDetail }`. 422 `CRM_ASSIGNEE_INVALID` for an unknown or inactive user,
and for one who cannot reach the Opportunity's Organization (research N-R2) — the same on
create and `PATCH`.

## 6. Notes and messages (US4)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `GET /opportunities/:id/comments?kind=note\|message` | `crm:read` | — | `{ data: OpportunityComment[] }` (oldest first) |
| `POST /opportunities/:id/comments` | `crm:write` | `{ kind, body }` | 201 |
| `PATCH /opportunities/:id/comments/:commentId` | `crm:write` | `{ body }` | 200; 403 not the author; 409 `CRM_MESSAGE_IMMUTABLE` |
| `DELETE /opportunities/:id/comments/:commentId` | `crm:write` | — | 204; same refusals |

`OpportunityComment`: `id`, `kind`, `author { id, name }`, `body`, `references`, `editedAt`,
`createdAt`.

The audit entries of a note or a message carry `commentId`, `kind`, `authorAdminUserId` and
the text's `length` — never the text (research N-R6); §11 therefore returns no `body`.

## 7. Attachments (US5)

| Method · Path | Gate | Request | Response |
| --- | --- | --- | --- |
| `GET /opportunities/:id/attachments` | `crm:read` | — | `{ data: OpportunityAttachment[] }` |
| `POST /opportunities/:id/attachments` | `crm:write` | `{ assetId: uuid }` | 201 |
| `POST /opportunities/:id/attachments/upload` | `crm:write` | multipart, one `file` part (§7a) | 201 |
| `DELETE /opportunities/:id/attachments/:attachmentId` | `crm:write` | — | 204 |

`OpportunityAttachment`: `id`, `assetId`, `fileName`, `mimeType`, `sizeBytes`, `url | null`,
`uploadedBy { id, name }`, `createdAt`. `POST …/attachments { assetId }` stores the link to a
file already in the media library; it is not used by the Admin UI since §7a.

### 7a. Upload (the Attachments tab; research N-D8, N-F1)

`POST /opportunities/:id/attachments/upload` · `crm:write` · `multipart/form-data` with one
`file` part → 201 `{ data: OpportunityAttachment }`.

One request stores the file in the media library as a **private** asset — through
`assetsLibraryPort.upload`, the library's own pipeline, so its allowed types, its size limit as
set at that moment, its content sniffing and its storage backend apply unchanged — and attaches
it with the Command of the row above. No permission of the media library is asked for.

- The Opportunity is checked first: 404 `CRM_OPPORTUNITY_NOT_FOUND` for one missing or outside
  the caller's scope, before a byte is read or stored.
- 400 `VALIDATION_FAILED` — not multipart, or no `file` part.
- 413 `CRM_ATTACHMENT_TOO_LARGE` (`details.maxMb`) — over `OPPORTUNITY_ATTACHMENT_MAX_BYTES`
  (25 MB), the bound on what the route reads into memory.
- 415 `ASSET_UPLOAD_TYPE_NOT_ALLOWED` — the file's name or its declared type is HTML, XHTML,
  SVG, XML/XSL or JavaScript; either is enough, and nothing is stored (research N-R1). The
  same refusal answers `POST …/attachments { assetId }` for such a file of the library.
- The library's refusals pass through unchanged: 413 `ASSET_UPLOAD_TOO_LARGE`, 415
  `ASSET_UPLOAD_TYPE_NOT_ALLOWED`, 503 `ASSET_STORAGE_UNAVAILABLE`.
- A file stored and then not attached is soft-deleted in the library again.

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

`available: false`, with `label` and `url` `null`, for a target that is gone, that is outside
the reader's tenant scope, **or whose owner's read permission the reader does not hold** —
`orders:read` for an Order, `catalog:read` for a Product (research N-R13, which narrows
R-21's "no catalog permission is asked").

## 10. Board (US7)

`GET /board` · `crm:read` · query: the list filters minus `statusCode`/`state`, plus
`perColumn?` (default 50) → `{ data: { columns: [{ status, count, valueTotals: [{ currency,
total }], items: OpportunitySummary[], hasMore }] } }`. Moving a card is §2's transition
endpoint; there is no board-specific write.

## 10a. Lookups — what the pickers choose from (research N-D4)

| Method · Path | Gate | Query | Response |
| --- | --- | --- | --- |
| `GET /lookups/organizations` | `crm:read` | `q?`, `id?` (uuid — one, by id), `limit?` (default 20, max 50) | `{ data: [{ id, name }] }` — only Organizations in the caller's scope |
| `GET /lookups/sales-channels` | `crm:read` | — | `{ data: [{ id, code, name: Record<lang, string>, active, systemDefault, defaultCurrency, currencies }] }` |
| `GET /lookups/assignees` | `crm:read` | `q?`, `limit?` | `{ data: [{ id, name }] }` — active administrators (the rule of §5) |
| `GET /lookups/contacts` | `crm:write` | `organizationId` (required), `q?`, `limit?` | `{ data: [{ id, name, email }] }` — empty for an Organization out of scope |
| `GET /lookups/quote-requests` | `crm:write` **and** `rfqs:handle` (research N-R13) | `organizationId` (required), `q?`, `limit?` | `{ data: [{ id, number, status }] }` — the Organization's open Quote Requests, plus the one whose number is typed in full; empty for an Organization out of scope; 503 `MODULE_DISABLED` (`details.module: "quote_requests"`) while that module is off (research N-H2) |

Schemas: `OpportunityOrganizationLookupQuerySchema`, `OpportunityAssigneeLookupQuerySchema`,
`OpportunityContactLookupQuerySchema` and the four `…LookupResponseSchema`. The CRM screens'
pickers read these and no admin list of another module; the Order statuses and the Order
search of §3–§4 remain `orders`' own endpoints under `orders:read`. A malformed query is 400.

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

What the range selects, per figure (settled while implementing — research N-F2):

- **`from` / `to` are whole days, UTC, both included** — the convention of §1's `createdFrom` /
  `createdTo`. Months are UTC calendar months. `from` after `to` is 422 `VALIDATION_FAILED`; a
  malformed query is 400.
- **handling-time** — Opportunities whose `closedAt` is in the range (so still closed);
  `averageSeconds` is `closedAt − createdAt`, `null` when nothing closed.
- **time-in-status** — *stays that began in the range*: from a status-history entry to the next
  entry of the same Opportunity, or to now for one that has not ended. One row per `statusCode`
  asked, in the order asked, `{ averageSeconds: null, sampleCount: 0 }` for a status nobody
  entered; with no `statusCode`, every status of the workflow in its order.
- **rep-effectiveness** — Opportunities closed as **won** in the range and assigned to
  somebody, by the calendar month of `closedAt` and the current assignee; ordered by month,
  then `wonCount` descending. `wonValue` is per currency; a currency with no value is omitted.
- **top-opportunities** — ranked by effective value **within each currency**: `limit` is per
  currency (max 100), the answer is ordered by currency and then highest first. `basis`
  chooses `createdAt` (default) or `closedAt`. An Opportunity with no value is not ranked.
- **average-value** — Opportunities **created** in the range that have a value, per currency.
- No figure adds two currencies. Tenant scope is ambient in every statement.

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

`GET /documents/:documentKind/:documentId/opportunity` · `crm:read` **and the read permission
of the document's owner** (`orders:read` for `order`, `rfqs:handle` for `quote_request`;
research N-R13) · `documentKind ∈ order | quote_request` →
`{ data: OpportunitySummary | null }`.

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
`CRM_MESSAGE_IMMUTABLE`, `CRM_TAG_NAME_TAKEN`, `CRM_ATTACHMENT_TOO_LARGE` (§7a).

How a new code is minted — whether it must also become a member of `ERROR_CODES` in
`packages/contracts/src/errors.ts`, and which fixtures record it — is **not** established by
this design: commit `512b68e84` ("record the two minted error codes") is the most recent
worked example and task T038 reads it first.
