# Research: Operator-created quote requests stay drafts until shared

Feature `specs/192-quote-request-draft-share/`, issue #1901. Measured against `origin/master`
`230f04c30` (release 0.112.0). Module paths are relative to `packages/modules/quote_requests/`
unless they start with `packages/` or `backend/`.

Every decision below is *decision → rationale → alternatives rejected*. Owner decisions recorded
in `spec.md` § *Owner decisions* are not re-opened here; where the spec leaves a product call
open, the item says so and names the question it went back with (`OQ-n`, listed in `plan.md`
§ *Open questions for the owner*).

## Vocabulary — "draft" in code is taken

**Decision.** In identifiers, columns, error codes and tests the state is **unshared / shared
with the customer**. "Draft" is used only in user-facing copy (Admin UI badge, filter option,
docs), where the spec uses it.

**Rationale.** This module already uses "draft" for something else: the customer's own request
that is still open to the customer's edits (`src/backend/services/draft-guard.ts`,
`RfqService.patchDraft`, `ERROR_CODES.RFQ_NOT_DRAFT`), and the admin detail uses it for the
unsaved edit buffer (`admin/test/modules/quote_requests/RfqDetail.modify-draft.test.tsx`). A
column called `is_draft` would sit beside `assertDraftOpenForCustomer` and mean the opposite
party's state.

**Rejected.** `is_draft` / `RFQ_NOT_DRAFT`-style names (collision above); `operator_draft`
(still collides in grep and in review conversation).

## R-1 A flag on the row, not a seventh status

**Decision.** `quote_requests.shared_with_customer boolean not null default true`. An unshared
quote keeps the status it has today (`Created from admin`). Visibility to the customer is the
flag; the lifecycle is the status; the two are orthogonal.

**Rationale.**

1. **The status set is a published contract with readers in five modules.**
   `QuoteRequestStatus` / `rfqStatusSchema` (`packages/contracts/src/quote-requests.ts:30-37`,
   `:1028-1034`) is read by `customers` (`src/admin/lib/labels.ts:14`, whose test asserts every
   status has a label), `crm` (`packages/contracts/src/crm.ts:105`), `orders`
   (`domain/quote-commitment.ts`, `domain/quote-request-source.ts`), `organizations` (open counts
   through `OPEN_QUOTE_REQUEST_STATUSES`) and every `QuoteRequestRecord` returned by
   `quoteRequestReadPort`. A new member widens the return of `findById`, `findByIds` and
   `listOpenForOrganizations`, which `specs/conventions/contract-surface.md` (direction `call`)
   forbids without a deprecation cycle.
2. **A cancelled draft must stay invisible.** With a `Draft` status, cancelling moves the quote
   to `Canceled`, which every customer read shows. A second marker would be needed anyway. With
   the flag, `Canceled` + unshared stays hidden with no extra rule.
3. **Default `true` is the safe default for every existing writer.** Legacy rows (FR-002),
   customer submissions and resubmissions (FR-010), *Clone to quote* through
   `RfqCustomerPort.createForCustomer` (spec owner decision), `carts`' conversion, and every test
   fixture that does `em.create(QuoteRequest, …)` keep today's behaviour without being touched.
   Only the one decision point (R-2) writes `false`.
4. **No backfill.** `add column … not null default true` makes every existing row shared in the
   same statement (FR-002, SC-004).

**Rejected.**

- *New status `Draft`* (`Draft → Created from admin` on share): the ripple in (1), the cancelled
  draft in (2), and a state-machine change (`src/backend/entities/quote-request.entity.ts:5-12`)
  that the list filter, saved views (`QuoteRequestListSavedView` stores `status` codes), the
  expiry worker's `EXPIRABLE_STATUSES` and the sales-rep open count would all have to learn.
  The one thing it would give for free — a list filter — costs one query parameter (R-11).
- *A nullable `shared_at` alone as the flag* (`null` = unshared): every legacy and customer row
  would need a backfilled timestamp that never meant "shared by an operator", and an
  `em.create(QuoteRequest, …)` fixture would default to invisible — the unsafe direction for
  hundreds of existing tests. `shared_at` stays, as a fact about the share, not as the flag.

## R-2 One decision point for "does a new operator quote start unshared"

**Decision.** `src/backend/services/operator-quote-sharing.ts` exports
`operatorQuoteStartsUnshared(): boolean`, returning `true`. `RfqAdminService.createOnBehalf`
is its only caller and the only writer of `sharedWithCustomer: false`.

**Rationale.** FR-001 and the owner decision: always on now, a setting later "without reworking
the feature". When a setting arrives, this function reads it (it becomes `async` and takes the
setting reader), and the `false` branch of `createOnBehalf` calls the same
`applyShare(em, rfq, actor, now)` helper the share Command uses (R-4), inside the create
transaction. That later branch is deliberately not written now (Principle IV): with the
function hard-coded to `true` it would be dead code with no test able to reach it.

**Rejected.** A setting now (owner: no setting); a check spread across the route and the
service (two places to change later).

## R-3 Every customer read hides unshared quotes — inside this module, plus one field for `carts`

**Decision.**

1. `RfqService.findVisibleForCustomer` (`src/backend/services/rfq-service.ts:1444`) answers
   `404 NOT_FOUND` for an unshared quote, with the same message as a missing one. Every customer
   detail and action goes through it: `getForCustomer` (:524), `patchDraft` (:743), `resubmit`
   (:963), `respondToRevision` (:1135, accept and reject), `convertToOrder` (:1284). FR-003,
   FR-004.
2. `RfqService.#listSummaries` (:483) adds `sharedWithCustomer: true` to its `where`. It serves
   the storefront list (own, Organization *Administrator*, roll-up subtree — the tenant filter
   decides the org set, this predicate is independent of it) and `RfqCustomerPort.listForCustomer`
   (`customers`' self route `routes.self.ts:242` and admin route `routes.admin.ts:547`).
3. `QuoteRequestRecord` (the `quoteRequestReadPort` row) gains `sharedWithCustomer: boolean`, and
   `carts`' `CartConversionService.createCartFromQuoteRequest`
   (`packages/modules/carts/src/backend/services/cart-conversion-service.ts:213`) answers its
   existing `404 quote_request_not_found` for an unshared quote. That route
   (`POST /api/v1/cart/from-quote-request/:id`, `carts/src/backend/routes.ts:955`) is a customer
   path that reads the quote through the port and checks only ownership — **without this check a
   customer who knows a draft's id can copy its lines into a basket and read the dropped lines'
   names**, which FR-004 ("convert") forbids.

**Rationale.** The read port is the operator-side row read (`crm`, `projects`, `organizations`,
`comarch_xl`, the future veto hook all need to see drafts), so it must keep answering them; the
customer-side filter belongs to the customer-side reads. `carts` is the only customer path
outside this module that resolves a quote by id; `orders`' placement re-read
(`domain/quote-commitment.ts`) only honours `Approved`/`Completed`, which an unshared quote can
never reach (customer acceptance is refused by (1); admin `approve` requires `Pending`,
`rfq-admin-service.ts:646`).

Adding a field to a port record type is compatible (`contract-surface.md`, direction `read`:
fields may be added). It is required, not optional, so a consumer cannot mistake "absent" for
"shared".

**Rejected.**

- *Hide drafts in `quoteRequestReadPort.findById`*: breaks every operator-side consumer.
- *A second port method `findVisibleToCustomer`*: a new published method for one caller, and it
  would still need the customer context `carts` already checks.
- *Hide drafts with a tenant/global filter*: the platform's filters are tenant scoping
  (Principle XI), not business visibility; admin reads go through the same filter.

**Consequence the owner should see (OQ-4).** `customers`' admin customer-detail tab lists a
buyer's quotes through the same `listForCustomer`, so it stops listing that buyer's drafts.
The spec's FR-003 names "the `customers` module's lists" literally; the operator still finds
drafts on the quote desk, filterable by customer.

## R-4 Share is one Command, `quote_request.share`, declared hookable — the refusal point of FR-028

**Decision.** `POST /api/v1/admin/quote-requests/:id/share` runs `makeShareQuoteRequestCommand`
(`src/backend/commands/share-command.ts`) through `CommandBus.run`. The Command:

1. reads the row `for update` (`em.findOne(QuoteRequest, { id }, { lockMode: PESSIMISTIC_WRITE })`)
   on the Command's transaction; refuses `404` when the actor may not see its organisation
   (`adminCanSeeOrganization`, as `document-template-commands.ts` `findVisible`);
2. refuses `409 RFQ_ALREADY_SHARED` when the row is already shared (R-6);
3. refuses `409 RFQ_NOT_QUOTED` when the status is not `Created from admin` (a cancelled or
   expired draft cannot be shared — same code and sentence `modify` answers for a non-editable
   quote);
4. checks `If-Match` against `version` when the caller sent it (`VERSION_CONFLICT`, as `modify`);
5. refuses unpriced lines (R-8) and an unavailable customer (R-9);
6. applies the share (`applyShare`): `sharedWithCustomer = true`, `sharedAt = now`,
   `sharedByAdminUserId`, `expiresAt` from the stored days (R-10), `version += 1`; appends the
   `shared` history event; records the `prepared` notification on that event (R-5) — all on the
   Command's `em`;
7. returns `{ result, before, after }` with `audit-state.md` list-1 state only
   (`sharedWithCustomer`, `expiresAt`, `version`).

The bus then runs every present `beforeCommit` hook of `quote_request.share`; a hook vetoes by
throwing an `HttpError` with its own module's code and sentence, and the bus rolls back the whole
Command — row, event, notification records — so the quote stays unshared and nobody is told
(FR-028, US2 #6). After `commandBus.run` resolves (committed), the service kicks notification
delivery (`notificationKick`), as `modify` does after its transaction.

The ref is published as `QUOTE_REQUEST_HOOKABLE_ACTIONS.share` in a new
`packages/contracts/src/quote-request-hooks.ts`, listed in the manifest's `hookableActions`
through `toHookableActionDeclaration`, with phase **`beforeCommit` only**.

**Rationale.**

- `specs/176-command-hooks-outbox/` already ships exactly "another module refuses a write with a
  readable reason": FR-016 there — a `beforeCommit` hook vetoes by throwing an `HttpError` whose
  code its own module declares, and the caller gets that status, code and details unchanged
  (`packages/platform/src/commands/command-bus.ts:32-38`). A future consumer (the spec's example: "an
  approval still pending") only has to register
  `ctx.commandHooks([{ id: 'approval-gate', on: QUOTE_REQUEST_HOOKABLE_ACTIONS.share, phase: 'beforeCommit', handler }])`
  and declare `quote_requests` in its `dependencies`.
- Principle XIII: the share is an audited domain write, so it belongs on the Command Bus
  regardless; the module already has Commands (`quote_request.set_document_template`,
  `quote_request.send_document`).
- Hooks run *after* `run` and see the row already shared (uncommitted) — the hook data carries
  ids, and a hook that wants the lines reads `quoteRequestReadPort.listItems` (lines are not
  changed by a share).
- `phases` is additive-only (`contract-surface.md`), so `afterCommit` can be added the day a
  consumer needs it; declaring it now would publish outbox data nobody reads.

**Rejected.**

- *A bespoke registry in `quote_requests`* (`quoteRequestShareGuards` port, each guard returning
  `{ refused, reason }`): a second mechanism for what 176 already does, with its own ordering,
  presence and i18n rules to design and test.
- *A declared policy point* (`specs/188-policy-points/`): semantically the closest fit (a
  participant decides, never writes), but it is `Status: Draft` and no platform code exists
  (`git grep PolicyPoint packages/platform/src` is empty). If 188 ships, the share can add a
  policy point beside the hook; the hook's action id stays (frozen identity).
- *Share as a plain service method with `recordAuditFromContext`* (how `modify` audits): no hook
  dispatch, so no FR-028.

## R-5 The `prepared` notification moves from the `created` event to a new `shared` event

**Decision.** New history event type `shared` (entity union, `rfqEventTypeSchema`,
`qre_event_type_check`), new history entry kind `shared` (`quoteRequestHistoryEntryKindSchema`).
`NOTIFICATION_MATRIX.prepared` becomes `row('shared', null, [C, C, C, null, null])`;
`createOnBehalf` stops recording `prepared`. `modify` (`rfq-admin-service.ts:1042`, `revised`)
and `cancel` (`:797`, `canceled`) skip `notificationService.record` while the quote is unshared.
The e-mail definition `quote_request_customer_prepared` and its editable text are unchanged
(FR-022). The amendment to `specs/179-rfq-and-customer-notifications/contracts/notification-matrix.md`
§1 is in `contracts/notification-matrix-amendment.md`, and that document changes first, then the
matrix and its test together (the test's header says so).

`shared` is **admin-only** in the customer projection (`ADMIN_ONLY_EVENT_TYPES`,
`src/backend/services/customer-projection.ts`), so the storefront needs no new label.

**Rationale.** `RfqNotificationService.record` asserts the source event's type against the
matrix row (`assertSourceEvent`, `rfq-notification-service.ts:131`), and the History pairs
deliveries with the event that caused them (`history-deliveries.ts`). The share has to be its
own history entry anyway (FR-023: who and when), so the notification announces that entry.
Existing `prepared` records point at `created` events and stay valid: the matrix is read at
recording time, not at delivery or history time.

**Rejected.** *Keep `prepared` on `created` and record it at share time against the old
`created` event*: the History would show the deliveries under the creation, weeks before they
happened, and FR-023's "the share, with the actor and the moment, and the deliveries" would be
two entries apart. *A new matrix change `shared`*: a new e-mail definition and template for the
same message, against the owner decision "the existing *quote prepared* notification".

## R-6 A second share answers `409 RFQ_ALREADY_SHARED`

**Decision.** Repeated or concurrent shares serialise on the row lock (R-4 step 1); the one that
reads the row already shared throws `409 RFQ_ALREADY_SHARED` (minted, this module's). Nothing is
written and no hook runs. The admin UI treats it as "someone already shared it": it refetches and
shows the shared state with an info notice, not an error.

**Rationale.** FR-024 (once, never notify twice). A `skipAudit` no-op answering `200` was the
first idea, but the bus runs `beforeCommit` hooks even when `run` skips its audit
(`command-bus.ts:166-170`), so a "no-op" share would still invoke every veto hook against an
already shared quote. Throwing inside `run` is the only way to stop before the hooks.

**Rejected.** *Idempotent `200` via `skipAudit`* (hooks still run); *idempotent `200` by
checking before `commandBus.run`* (a concurrent second call that waited on the lock would then
still enter the hooks); *a unique index* (nothing to make unique).

## R-7 "Create and share" is two requests from the create screen

**Decision.** The create screen's **Create and share** button sends
`POST /api/v1/admin/quote-requests` and then, with the returned `version` as `If-Match`,
`POST /api/v1/admin/quote-requests/:id/share`. On a share refusal it navigates to the new
draft's detail and shows the refusal there (FR-020: "saved as a draft and the refusal shown").
**[NEEDS CLARIFICATION] OQ-7 — create warnings.** When the create answer carries `warnings`
(feature 163 — a line not available to the customer on the channel), the spec's literal "created
and shared in one step" shares anyway. Built default, the literal reading: the share runs, and
the warnings are carried to the shared quote's detail and shown there. Recommended to the owner
instead: stop before the share and show the warnings with **Share with customer** / **Open
draft**, so the operator sees them before the customer does. Either is one branch in
`RfqCreatePage.tsx`.

**Rationale.** FR-020 requires the create to survive a refused share, which rules out one
transaction (a veto would roll the create back). Two requests reuse both existing endpoints,
keep one refusal shape, and a lost second request leaves exactly the state FR-020 describes.

**Rejected.** *`share: true` in the create body*: a `201` that has to embed a share refusal (a
mixed outcome no other admin route answers), two transactions inside one route anyway, and the
hook would run inside the create route's error handling.

## R-8 Unpriced lines refuse a share with `QUOTE_INCOMPLETE`, token `share`, naming the lines

**Decision.** Before applying the share, the Command reads the lines in display order
(`loadArrangedQuoteLines`) and, when `hasUnpricedLine` (`src/backend/services/agreed-price.ts`)
holds, throws `409 QUOTE_INCOMPLETE` with
`details: { code: 'share', lines: [{ id, position, productName, variantLabel, groupName }] }`.
The manifest's `errorCodes` entry gains the token `share`
(`errors.QUOTE_INCOMPLETE.share`, pl + en); the admin UI lists the named lines under the sentence.

**Rationale.** The module already has the rule "a line with no agreed price is not a price"
(`agreed-price.ts`) and its code, raised on accept, approve and convert. Sharing is a fourth
point of the same rule; a token gives it its own sentence (`error-envelope.ts` `refusalToken`
reads `details.code`) without minting a code.

**Rejected.** *A new code `RFQ_SHARE_UNPRICED`* (a second code for the same rule); *the generic
sentence without lines* (FR-026 requires naming them).

## R-9 Customer unavailable: `409 RFQ_SHARE_CUSTOMER_UNAVAILABLE`

**Decision.** The Command reads `customerAccounts.findById(quote.customerAccountId)` (no
`activeOnly`, so a deleted account still answers) and refuses with minted
`409 RFQ_SHARE_CUSTOMER_UNAVAILABLE`, tokens:

- `not_member` — no record, or `record.organizationId !== quote.organizationId` (the account
  moved to another Organization);
- `inactive` — `deletedAt` or `anonymizedAt` is set. This is the platform's own meaning of
  "active" (`activeOnly` is `deletedAt: null`,
  `packages/modules/customer_accounts/src/backend/services/customer-account-ports.ts:125`).

**[NEEDS CLARIFICATION] OQ-3.** Whether a **blocked** account (`blockedAt` set — it cannot sign
in) is "inactive" for FR-027 is not said by the spec. Built default, the literal reading above:
a blocked account is **not** refused. If the owner says yes, `blockedAt` joins the `inactive`
token in one predicate (`customerUnavailability` in `operator-quote-sharing.ts`) and one test
case is switched on (T051).

**Rationale.** FR-027. Membership is the account's `organizationId` (one Organization per
account, `CustomerAccountRecord.organizationId`).

**Rejected.** *`404`*: the quote exists and the operator can see it; the refusal is about its
customer. *Reusing `FORBIDDEN`*: not an authorisation failure. *`findInOrganization(…, {
activeOnly: true })` alone*: one `null` for "deleted" and "moved", so the message could not say
which.

## R-10 Validity: days are stored on the draft, the date is written at share

**Decision.**

- New column `share_validity_days integer null check (>= 0)`. While unshared, `expiresAt` stays
  `null`; at share, `expiresAt = sharedAt + days × 86 400 000 ms` when days is not `null`, else
  `null` (FR-032). After the share the column is kept as the record of what was applied; a
  revision's *Valid for N days* writes `expiresAt` from the revision moment, as today (edge case).
- `createOnBehalf`: body `expiresInDays` absent → the default setting (R-12) snapshotted into
  the column (setting `0` → `null`, i.e. no deadline, FR-030); a number → that number; `null` →
  `null` (no deadline: the operator cleared the field — FR-031 "unless the operator changes
  it"). FR-033: snapshot at create, so changing the default later moves no existing quote.
- `modify` on an unshared quote: `expiresInDays` number → column; `null` → column `null`;
  absent → unchanged; `expiresAt` untouched. The history records it as a new change kind
  `validity_days { before, after }` on the `modified` event (FR-008), since the existing
  `validity` kind is date-typed.
- `modify` on a shared quote: unchanged behaviour; `expiresInDays: null` is refused
  `422 VALIDATION_FAILED` (clearing a shared deadline is not a feature of this spec).
- Contracts: `adminCreateQuoteRequestSchema.expiresInDays` and
  `adminPatchQuoteRequestSchema.expiresInDays` widen to `.nullable().optional()` (write
  direction: accepted values widen — compatible).

**[NEEDS CLARIFICATION] OQ-2 — `0` days typed on a draft.** Today `expiresInDays: 0` stores
"expires now". FR-032 read literally gives *share moment + 0 days*: a quote lapsed the moment the
customer receives it, while the setting's `0` means "no deadline". Built default, the literal
reading: a typed `0` is stored as `0` and produces `expiresAt = sharedAt`; only `null` (a cleared
field) and an absent value with a `0` setting mean "no deadline". If the owner rules that a typed
`0` means "no deadline" on a draft, one line in `normaliseShareValidityDays` changes.

**Rejected.** *Store `expiresAt` at create and shift it at share*: the arithmetic would depend on
the draft's age; *compute the default at share time*: violates FR-033 (a later default change
would move drafts created before it).

## R-11 Admin list: an admin-only flag on the summary and a `sharing` filter

**Decision.** `quoteRequestSummarySchema` gains `sharedWithCustomer: z.boolean().optional()`
(admin list only, like `amount`); `adminQuoteRequestListQuerySchema` gains
`sharing: z.enum(['unshared', 'shared']).optional()`; `RfqAdminService.listAll` turns it into a
`where` on the column. The list shows a *Draft* badge beside the status; the filter is offered
with the status filter and stored by saved views (their `filters` is an open record —
`quote-request-list-view-service.ts`; the list page decides the keys).

**Rejected.** *Folding the flag into the status filter* (`status=Draft` as a pseudo-status):
saved views store status codes from `rfqStatusSchema`, and a pseudo-code would leak into the
published vocabulary.

## R-12 One global setting, served to the create screen under `rfqs:handle`

**Decision.** Setting `quote_requests.default_validity_days` (`valueType: 'number'`, default
`0`, group `quote_requests`), declared in `src/manifest.ts` beside `expiry_days`, labelled through
`settingLabels.quote_requests.default_validity_days.{name,description}` (pl + en). It is read
without a channel (`setting(code, schema, 0)` in `src/backend/index.ts`), i.e. one global value
(owner decision). The create screen reads it from a new
`GET /api/v1/admin/quote-requests/create-defaults` → `{ data: { validityDays: number | null } }`
(`null` when the setting is `0`), gated `requireAdmin('rfqs:handle')`.

**Rationale.** `GET /api/v1/admin/settings/:code` requires `settings:read`; an operator with only
`rfqs:handle` would be refused and silently lose the prefill — the exact defect
`packages/admin-shell/src/components/IdleLogout.tsx:12-16` records. The server applies the
default itself when the body omits `expiresInDays` (R-10), so an API client gets FR-031 without
the endpoint.

**Rejected.** *Reading `/admin/settings/:code` from the create screen* (permission above);
*a per-channel setting* (owner: one global value).

## R-13 PDF of an unshared quote: preview and download yes, send no

**Decision.** `quote_request.send_document` (`src/backend/commands/document-template-commands.ts:143`)
refuses an unshared quote with minted `409 RFQ_NOT_SHARED` before rendering or sending. The
admin hides *Send PDF to customer* while the quote is unshared and the PDF dialog's send mode
is never offered for it. Export (preview/download) is unchanged. FR-007.

## R-14 What the customer sees of the drafting period — [NEEDS CLARIFICATION] OQ-1

**Built default: as today.** The customer reply carries every customer-visible event of the
quote, including the `modified` events the operator recorded while it was unshared, with their
diffs (`customerEventsOf`, `customer-projection.ts`); only the new `shared` event is admin-only
(R-5). The revision comparison block is unchanged: it diffs the current revision against the
last one the customer saw (`0` for a new operator quote), i.e. "everything is new".

**Why it is a question.** The first thing a customer reads on a shared quote is then every edit
the sales representative made while drafting. No FR asks to hide them, so hiding them is a
product call. Recommended to the owner: hide `modified` events dated before `sharedAt` from the
customer reply (one predicate in `customerEventsOf`; task T050 is written and gated on the
answer).

## R-15 Permissions, palette, off-state

- **Permission.** Share and create-defaults are gated `rfqs:handle`, the code every admin quote
  route uses (`routes.admin.ts`; spec assumption). No new code, so no change to the core
  `PERMISSION_CATALOGUE` or `specs/conventions/module-admin-surfaces.md` obligations.
- **Command palette (XVI).** No new destination: the create screen and the list are already
  palette targets. Nothing to add.
- **Off state (XVII).** The new routes are mounted by this module's plugin with the others, so a
  switched-off module answers them as never installed; the setting is this module's; the
  hookable action is this module's declaration, so a hook on it is inert when `quote_requests` is
  off (the registry asks presence per call). One off-state assertion per new route in
  `backend/test/integration/quote_requests/off-state.test.ts`.

## R-16 Same product on several lines (FR-011)

**Decision.** No production change; regression guards only. Pairing already tolerates it:
`pairLines` (`src/backend/services/line-carry-over.ts:70-96`) pairs each stored line with at
most one incoming line, and `createOnBehalf`/`modify` write one row per body line. The share
writes no line. Tests: create a draft with one product on two lines at two prices, modify it,
share it, read it as the customer, accept it, and assert two lines with their own prices
throughout; a revision after the share keeps them apart.

## R-17 Migration

One module migration, scaffolded with
`pnpm --filter backend run migration:new -- --module quote_requests --name quote_request_sharing`:

- `alter table "quote_requests" add column "shared_with_customer" boolean not null default true,
  add column "shared_at" timestamptz null, add column "shared_by_admin_user_id" uuid null,
  add column "share_validity_days" integer null`, plus
  `check ("share_validity_days" is null or "share_validity_days" >= 0)`;
- `qre_event_type_check` re-created with `'shared'` appended (pattern of
  `20261021T164808_quote_requests_quote_request_event_carry_skipped.ts`);
- no index: the customer list already filters by `customer_account_id` (indexed) and the
  tenant filter; the sweep's predicate gains a boolean on rows it already scans.
- `down()`: drop the four columns, restore the previous check (fails while a `shared` event row
  exists — as narrowing any check must).

No foreign key on `shared_by_admin_user_id` (as `created_by_admin_user_id` and
`assigned_admin_user_id`: plain uuids, `admin_users` is another module's table).

## R-18 Operator paths that do not open the create screen — [NEEDS CLARIFICATION] OQ-8

`RfqCustomerPort.createForCustomer` is called with `minimums: 'warn'` — an operator writing
through the buyer's path — by two admin surfaces: an order's *Clone to quote*
(`packages/modules/orders/src/backend/services/order-clone-to-quote-service.ts:105`, which the
spec keeps unchanged) and the **operator's quick-order build**
(`packages/modules/quick_order/src/backend/services/quick-order-build-service.ts:193`,
`options.actor === 'operator'`), which the spec does not mention. FR-001 says "whatever screen
opens the create screen"; the quick-order build does not open it. **Built default: unchanged**
— the quick-order operator build stays visible to the customer at once, like *Clone to quote*.
If the owner wants it to start unshared, `CreateForCustomerOptions` gains an in-process option
(compatible: a new optional field) that only those callers pass, and the decision function of
R-2 is asked there too.

