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
- A body or a query the Zod schema refuses answers **400 `VALIDATION_FAILED`**; 422 is what
  a service raises for a well-formed request it cannot honour (research N-13 (c)). A child
  resource — a propagation outcome, a link, a comment, an attachment — addressed under an
  Opportunity it does not belong to answers **404 `NOT_FOUND`**; the parent's own absence is
  404 `CRM_OPPORTUNITY_NOT_FOUND`.
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

**Retry and dismiss at the edges** (as built — research N-19, N-R11):

- *Retry* asks the Order for what the Opportunity's status maps to **now** — the usual cause
  of a retry is a corrected mapping — and falls back to what the retired row asked when the
  mapping is gone. It answers 200 with the new `PropagationOutcome`; the old row is
  dismissed.
- *Retry* is refused with **409 `VERSION_CONFLICT`**, and nothing is written, when the
  outcome is already settled (applied, or dismissed), when the Opportunity has since left the
  status the row was written for, or when the Order no longer follows it (status following
  switched off, or the link gone). Which of the three it was is not in the response: the
  envelope answers that code with its own sentence.
- *Dismiss* of an outcome that is not unresolved — already dismissed, or applied — is
  refused with the same 409.
- `:propagationId` under an Opportunity it does not belong to is **404 `NOT_FOUND`**.
- There is no `pending` outcome on the wire. A row left pending for more than a minute — a
  process that stopped between the Opportunity's commit and the Order's answer — is listed
  among `unresolvedPropagations` as `failed`, and a retry consumes it.
- The transition answers once the after-events of `events-and-ports.md` §1.1 have been
  delivered to their subscribers (research N-E19).

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
rule (research N-R13). `DELETE` asks for `crm:write` alone, for either kind. While
`quote_requests` is off the answer is 503 `MODULE_DISABLED` whoever asks: that module's
presence is decided before its code is.

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
| `POST /statuses` | `crm:configure` | `CreateOpportunityStatusRequestSchema` | 201 `{ data: OpportunityWorkflow }` |
| `PATCH /statuses/:code` | `crm:configure` | `UpdateOpportunityStatusRequestSchema` | 200 `{ data: OpportunityWorkflow }` |
| `DELETE /statuses/:code` | `crm:configure` | — | 204 |
| `PUT /transitions` | `crm:configure` | `{ add?: Edge[], remove?: Edge[] }` | 200 `{ data: OpportunityWorkflow }` |
| `PUT /order-status-mappings` | `crm:configure` | `{ mappings: OrderStatusMapping[] }` (replaces the set) | 200 `{ data: OpportunityWorkflow }` |
| `PUT /value-counting-statuses` | `crm:configure` | `{ order: string[], quoteRequest: QuoteRequestStatus[] }` | 202 `{ data: OpportunityWorkflow }` (recalculation enqueued) |

**Every configuration write answers the whole workflow** — the screen redraws from one
response — except `DELETE`, which is 204 (as built — research N-20, N-E4 (d)).

`OpportunityWorkflow`: `statuses [{ code, name, defaultName, kind, isInitial, weight, color,
inUseCount }]`, `transitions [{ fromStatusCode, toStatusCode }]`,
`orderStatusMappings [{ direction, opportunityStatusCode, orderStatusCode, requireAllOrders,
orderStatusKnown }]`, `valueCountingStatuses { order: string[], quoteRequest: string[] }`.

`GET /workflow` is `crm:read`, not `crm:configure`: the list, the board and the detail screen
all need the statuses to render.

Errors: 409 `CRM_STATUS_CODE_TAKEN`, 409 `CRM_STATUS_IN_USE`, 409
`CRM_STATUS_INITIAL_REQUIRED`, 422 `CRM_WORKFLOW_INVALID` (`details.rule` names the broken
invariant).

Refusals as built (research N-20, N-B3, N-R12):

- **404 `NOT_FOUND`** for `PATCH` or `DELETE` of a status code the workflow does not have.
- **409 `CRM_STATUS_IN_USE`** also for a `PATCH` that changes a status's `kind` while any
  Opportunity is in it — `closedAt` / `closedKind` are stamped on those rows. Both it and
  `DELETE` wait for a transition in flight into that status and then count it
  (`data-model.md` § Locking).
- **`details.rule`** of 422 `CRM_WORKFLOW_INVALID` is one of eight values, the same eight
  the manifest declares as that code's tokens: `exactly_one_initial`,
  `initial_must_be_open`, `won_status_required`, `lost_status_required`,
  `transition_unknown_status`, `mapping_unknown_status`, `mapping_duplicate`,
  `mapping_duplicate_order_status`. The rule is also in `details.code`, which is what
  selects one sentence per rule in the bundles (research N-13 (b)).
- `PATCH` with `isInitial: true` moves the start flag from the status that had it.
- `requireAllOrders` is stored `false` on an `opportunity_to_order` mapping whatever the
  request says.
- **An Order status code is not validated on write**, in a mapping or in the counting set:
  nothing `orders` publishes answers "is this an Order status code" (research N-8).
  `orderStatusKnown` on read is evidence from what the Orders port has already answered,
  not validation — it is `true` for a code nobody has asked for yet (research N-B1) — and
  `unknown_status` as a propagation outcome is where an unknown code shows first. A Quote Request status outside the platform's six is 400.
- The counting sets are stored sorted and de-duplicated.

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
| `POST /opportunities/:id/attachments` | `crm:write` **and** `assets.read` (research N-I5) | `{ assetId: uuid }` | 201; 403 `FORBIDDEN` without either |
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
accompanied by `references: [{ type: 'product' | 'order' | 'admin_user', id, available,
label | null, url | null }]`. Token grammar: `[[product:<uuid>]]`, `[[order:<uuid>]]`,
`[[admin_user:<uuid>]]`.

**A person (User Story 18; research N-M1).** `admin_user` is a user of the Admin UI, under the
name the platform has for one. `label` is the person's current name and `url` is always
`null`. `available: false` for an id that names nobody, a removed administrator or a
deactivated one. A person's name is not narrowed by a permission: it is what every CRM screen
already shows of an author or an assignee.

**What a person types is not part of this contract.** `@`, `@@`, `@@@` are the composer's way
of producing a token (`contracts/admin-surfaces.md`); nothing but the token is sent or stored,
and a client that writes tokens itself needs none of it.

`available: false`, with `label` and `url` `null`, for a target that is gone, that is outside
the reader's tenant scope, **or whose owner's read permission the reader does not hold** —
`orders:read` for an Order, `catalog:read` for a Product (research N-R13, which narrows
R-21's "no catalog permission is asked").

## 10. Board (US7)

`GET /board` · `crm:read` · query: the list filters minus `statusCode`/`state`, plus
`perColumn?` (default 50, max 200) → `{ data: { columns: [{ status, count, valueTotals: [{ currency,
total }], items: OpportunitySummary[], hasMore }] } }`. Moving a card is §2's transition
endpoint; there is no board-specific write.

## 10a. Lookups — what the pickers choose from (research N-D4)

| Method · Path | Gate | Query | Response |
| --- | --- | --- | --- |
| `GET /lookups/organizations` | `crm:read` | `q?`, `id?` (uuid — one, by id), `limit?` (default 20, max 50) | `{ data: [{ id, name }] }` — only Organizations in the caller's scope |
| `GET /lookups/sales-channels` | `crm:read` | — | `{ data: [{ id, code, name: Record<lang, string>, active, systemDefault, defaultCurrency, currencies }] }` |
| `GET /lookups/assignees` | `crm:read` | `q?`, `limit?` | `{ data: [{ id, name }] }` — active administrators (the rule of §5) |
| `GET /lookups/contacts` | `crm:write` | `organizationId` (required), `q?`, `limit?` | `{ data: [{ id, name, email }] }` — empty for an Organization out of scope |
| `GET /lookups/mentionable` | `crm:write` | `q?`, `organizationId?` (uuid), `limit?` | `{ data: [{ id, name }] }` — active administrators holding `crm:read`; with `organizationId`, only those who may reach it, and empty when the caller may not (User Story 18; research N-M3) |
| `GET /lookups/quote-requests` | `crm:write` **and** `rfqs:handle` (research N-R13) | `organizationId` (required), `q?`, `limit?` | `{ data: [{ id, number, status }] }` — the Organization's open Quote Requests, plus the one whose number is typed in full; empty for an Organization out of scope; 503 `MODULE_DISABLED` (`details.module: "quote_requests"`) while that module is off (research N-H2) |

Schemas: `OpportunityOrganizationLookupQuerySchema`, `OpportunityAssigneeLookupQuerySchema`,
`OpportunityContactLookupQuerySchema`, `OpportunityMentionLookupQuerySchema` and the five
`…LookupResponseSchema`. The CRM screens'
pickers read these and no admin list of another module; the Order statuses and the Order
search of §3–§4 remain `orders`' own endpoints under `orders:read`. A malformed query is 400.

## 11. History (US11)

`GET /opportunities/:id/history?limit&cursor` · `crm:read` →
`{ data: [{ id, actedAt, action, actor { kind, id | null, name | null }, before, after,
references }], pagination, truncated }`, newest first. The history reaches back 499 entries;
`truncated` is `true` on the last page it can serve when the Opportunity has earlier entries,
and `false` on every other page — `pagination.hasMore` keeps its one meaning, that `cursor`
asks for a next page (research N-M9). `references` is §9's list for the `description`
of `before` and of `after` together — empty for an entry that carries none — resolved for the
reader when the history is read; `before` and `after` are returned as audited (User Story 18;
research N-M6).

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
while `quote_requests` is off — decided before the caller's `rfqs:handle` is asked, so it is
the answer whoever asks. Linking from the panel uses §3's endpoint and the list of §1
filtered by `organizationId` and `state=open`; nothing else is added.

## 12c. Board card fields and field filters (US19)

**What a card can show.** A field is named by a reference: `builtin:<key>` or
`custom:<definition key>`. The built-in keys are `number`, `organization`, `contact`,
`assignee`, `value`, `salesChannel`, `tags`, `expectedCloseDate`, `source`, `createdAt`,
`updatedAt`, `closedAt`, `linkedOrders` and `linkedQuoteRequests` (the last only while
`quote_requests` is present). A custom field is offered while its definition exists for the
`opportunity` host type. The title is always shown and is not a field.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/v1/admin/crm/board/card-fields` | `crm:read` | `{ data: { fields, available, maxFields } }` — `fields` is the stored choice resolved, in order; `available` is everything that can be chosen; `maxFields` is 6 |
| PUT | `/api/v1/admin/crm/board/card-fields` | `crm:configure` | Body `{ fields: string[] }` — references, in order. 422 `VALIDATION_FAILED` for a reference that is not offered; 400 `VALIDATION_FAILED` for a body that is not of this shape, a duplicate and more than `maxFields` included. Answers the configuration as it stands afterwards |

Each entry of `fields` / `available` is `{ ref, source: 'builtin' | 'custom', key, kind,
label, labelDefault, options }`. `kind` is what the field is to a renderer and to a filter:
`text`, `number`, `money`, `boolean`, `date`, `select`, `multiselect`, `organization`,
`assignee`, `salesChannel`, `tags`, `contact`. For a custom field `label` is its per-language
labels and `labelDefault` the fallback; for a built-in field both are empty and the Admin UI
names it from its own bundle (`board.field.<key>`). `options` is the choices of a `select` /
`multiselect` field, each `{ value, label, labelDefault }`.

**Storage.** One Setting, `crm.board_card_fields` — a JSON array of references, platform-wide.
The default is `["builtin:number", "builtin:organization", "builtin:value",
"builtin:assignee", "builtin:tags"]`, which is the card as it was before this story. The read
is forgiving, because the generic Settings screen can store anything there: a value that is
not an array is the default; an entry that is not an offered reference, or repeats one, is
skipped; entries past the sixth are not shown.

**The board answers the choice with the cards.** `GET /board` gains `cardFields` — the same
resolved list as `fields` above — and each card (an Opportunity summary) gains `cardValues`:
an object keyed by reference, holding the value of every chosen field **the summary does not
already carry**, and nothing else. `organization`, `assignee`, `value`, `tags`, `number`,
`expectedCloseDate`, `createdAt`, `updatedAt` and `closedAt` are the summary's own members and
are not repeated. The others: `builtin:contact` → the contact person's name or `null`;
`builtin:salesChannel` → the Sales Channel's name, one text in the reader's language, or
`null`; `builtin:source` → `manual` |
`order` | `quote_request`; `builtin:linkedOrders` / `builtin:linkedQuoteRequests` → a count;
`custom:<key>` → the stored value as `custom_fields` validated it, or `null`. A field that is
not chosen has no key. `GET /opportunities?cardValues=true` answers the same member, so a
lane continued from the list keeps its cards whole; without the parameter the list is
unchanged.

**Field filters.** Both `GET /board` and `GET /opportunities` accept `fieldFilters`: a
URL-encoded JSON object keyed by reference, each value an object of operators —

| Kind | Operators | Meaning |
|---|---|---|
| `text` | `contains` | case-insensitive substring |
| `number`, `money` | `min`, `max` (decimal strings) | inclusive bounds; `money` is the effective value, whatever the currency |
| `boolean` | `is` | `true`: the value is true; `false`: it is false or was never set |
| `date` | `from`, `to` (`YYYY-MM-DD`) | inclusive of both days; an instant (`updatedAt`, `closedAt`) by UTC day |
| `select` | `in` | the value is one of those named |
| `multiselect` | `in` | at least one of those named is chosen |
| `contact` | `in` | the contact person is one of the customer accounts named |

`organization`, `assignee`, `salesChannel`, `tags`, `builtin:createdAt` and `builtin:number`
have no entry here: they are §1's `organizationId`, `assignedAdminUserId`, `salesChannelId`,
`tagId`, `createdFrom` / `createdTo` and `q` (which matches the number), which the board had
before and keeps whatever the card shows. The `text` row is a custom text field's.

Filters combine with AND, with each other and with §1's. **A reference that is not among the
card's fields when the request is served is ignored**, and so is an operator that does not
belong to the field's kind — an address saved before the configuration changed still opens.
What is refused, 400 `VALIDATION_FAILED`, is a parameter that is not JSON or not of this
shape. The filters only ever narrow the tenant-scoped read: they are conditions on the
Opportunity's own row.

## 13. Error codes owned by `crm`

Declared in the manifest's `errorCodes`, sentences under `errors.<CODE>` in
`packages/modules/crm/i18n/{en,pl}.json`:

`CRM_OPPORTUNITY_NOT_FOUND`, `CRM_INVALID_TRANSITION`, `CRM_TRANSITION_VETOED`,
`CRM_TRANSITION_CONFLICT`, `CRM_DOCUMENT_NOT_FOUND`, `CRM_DOCUMENT_ALREADY_LINKED`,
`CRM_LINK_ORGANIZATION_MISMATCH`, `CRM_STATUS_CODE_TAKEN`, `CRM_STATUS_IN_USE`,
`CRM_STATUS_INITIAL_REQUIRED`, `CRM_WORKFLOW_INVALID`, `CRM_ASSIGNEE_INVALID`,
`CRM_MESSAGE_IMMUTABLE`, `CRM_TAG_NAME_TAKEN`, `CRM_ATTACHMENT_TOO_LARGE` (§7a).

Fifteen codes; the same fifteen are the manifest's `errorCodes` and members of `ERROR_CODES`.

**How a code is minted** (established while implementing — research N-13; this paragraph
first said the design did not establish it): a code raised by a module of this repository
joins `ERROR_CODES` in `packages/contracts/src/errors.ts`
(`foreign-module-changes.md` A7), is declared in the manifest's `errorCodes` by the change
that adds its first raise site, and carries a sentence under `errors.<CODE>` in both
bundles. Two ledgers then account for it: `MINTED_ERROR_CODES` in
`backend/test/fixtures/error-code-routing/reference-ledgers.ts` (one entry per code,
`to: 'crm'`) and the `MIGRATED_MODULES` roster of
`backend/test/unit/_i18n/error-code-migration-progress.test.ts`.

Three facts about the envelope a caller meets: it **replaces** a declared code's `message`
with the bundle sentence, filling `{placeholders}` from the scalar members of `details` — so
`CRM_TRANSITION_VETOED` raises with `details.reason` and its sentence is `{reason}` alone,
which is what makes "`message` is the guard's reason" true in both languages; `details.code`
is the envelope's refusal token and selects `errors.<CODE>.<token>` (only
`CRM_WORKFLOW_INVALID` uses one); and codes this module raises but does not own keep their
owner's sentence — `VALIDATION_FAILED`, `VERSION_CONFLICT`, `NOT_FOUND`, `FORBIDDEN`,
`MODULE_DISABLED`, `CUSTOM_FIELD_VALUE_INVALID`, `ASSET_UPLOAD_TYPE_NOT_ALLOWED`,
`ASSET_UPLOAD_TOO_LARGE`, `ASSET_STORAGE_UNAVAILABLE`.
