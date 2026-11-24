# Tasks: Operator-created quote requests stay drafts until shared with the customer

**Input**: `specs/192-quote-request-draft-share/` — `spec.md`, `plan.md`, `research.md` (R-n),
`data-model.md`, `contracts/admin-api.md`, `contracts/share-hook.md`,
`contracts/notification-matrix-amendment.md`, `quickstart.md`.
**Measured against**: `origin/master` `230f04c30`. Before Phase 2, re-run
`git fetch origin && git log 230f04c30..origin/master --oneline -- packages/modules/quote_requests packages/contracts/src/quote-requests.ts packages/modules/carts/src/backend/services/cart-conversion-service.ts`
and rebase if it prints anything.

**Tests are required** (Constitution III, NN): every block lists its failing tests first.
Module paths below are relative to `packages/modules/quote_requests/` (written `QR/`).
`MOD=@endora-commerce/mod-quote-requests`. `CORE_I18N=packages/modules/_i18n/i18n/{en,pl}.json`
(the bundle the quote screens read through `useTranslation('core')`, where the
`rfq.detail.history.*` keys live — held by `QR/src/backend/history-bundle-coverage.test.ts`).

**Test budget** (AGENTS.md § *Working agreement*, `specs/conventions/backend-test-suite.md`):
run only the files named in each **Verification** line; `pnpm run build:packages` once after a
package edit. Pull requests do not run the contract/integration suites (D-198): the builder runs
the named ones locally against `pnpm run dev:infra:test` and reports which ran.

**Every phase ends green.** Phase 2 makes quotes unshared directly in its tests; the production
switch-over (operator quotes start unshared) happens in Phase 3 together with the share, the
matrix move and the sweep of existing tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: US1 (draft hidden), US2 (share), US3 (default validity)

## Parallelism

**Single stream.** Backend and admin UI live in one package and share `QR/i18n/{en,pl}.json`,
`CORE_I18N` and `QR/src/manifest.ts`; the UI depends on the Phase 3–4 routes. Two builders would
conflict on the bundles and wait on each other. `[P]` marks only intra-phase independence.

---

## Phase 1 — Foundation: contracts, schema, error codes (no behaviour change)

- [ ] T001 [P] Contracts, tests first, in `packages/contracts/src/quote-requests.ts`
  (+ `packages/contracts/src/quote-requests.test.ts`, `packages/contracts/src/quote-request-admin-list.test.ts`):
  `rfqEventTypeSchema` + `'shared'`; `quoteRequestHistoryEntryKindSchema` + `'shared'`;
  `quoteRequestHistoryChangeSchema` + `{ kind: 'validity_days', before: int|null, after: int|null }`;
  `quoteRequestSchema` + admin-only optional `sharedWithCustomer`, `sharedAt`,
  `sharedByAdminUserId`, `shareValidityDays` (doc comment "Admin replies only", as
  `createdByAdminUserId`); `quoteRequestSummarySchema` + optional `sharedWithCustomer`;
  `adminQuoteRequestListQuerySchema` + `sharing: z.enum(['unshared','shared']).optional()`;
  `expiresInDays` → `.nullable().optional()` on `adminCreateQuoteRequestSchema` and
  `adminPatchQuoteRequestSchema`; new `adminQuoteRequestCreateDefaultsSchema`;
  `QuoteRequestRecord.sharedWithCustomer: boolean` (required). Tests: a reply without the new
  keys still parses; `sharing=foo` is refused; `expiresInDays: null` parses on both bodies.
  Shapes: `contracts/admin-api.md` §2–§8.
- [ ] T002 [P] New `packages/contracts/src/quote-request-hooks.ts` (`QuoteRequestShareHookData`,
  `QUOTE_REQUEST_HOOKABLE_ACTIONS.share` = `'quote_request.share'`, `'quote_request'`,
  `['beforeCommit']`), exported from `packages/contracts/src/index.ts` beside
  `organization-hooks`/`project-hooks`; test `packages/contracts/src/quote-request-hooks.test.ts`
  (precedent `packages/contracts/src/project-hooks.test.ts`). Shape: `contracts/share-hook.md` §1.
- [ ] T003 [P] `packages/contracts/src/errors.ts`: `RFQ_ALREADY_SHARED`,
  `RFQ_SHARE_CUSTOMER_UNAVAILABLE`, `RFQ_NOT_SHARED`.
- [ ] T004 [P] Amend `specs/179-rfq-and-customer-notifications/contracts/notification-matrix.md`
  §1 row `prepared` as `contracts/notification-matrix-amendment.md` § *Edit to make in 179*
  (document first; code follows in T018).
- [ ] T005 Migration: `pnpm --filter backend run migration:new -- --module quote_requests --name quote_request_sharing`;
  `up`/`down` per `research.md` R-17 (four columns, check on days; `qre_event_type_check`
  re-created with the list of
  `QR/src/migrations/20261021T164808_quote_requests_quote_request_event_carry_skipped.ts` plus
  `'custom-field-carry-skipped'` and `'shared'`); add the class to `QR/src/migrations/index.ts`
  (and correct the class count its comment states); `pnpm --filter backend run composer:generate`,
  commit `backend/src/db/migrations-registry.generated.ts`. Test first:
  `backend/test/integration/quote_requests/quote-request-sharing-migration.test.ts` (new,
  precedent `backend/test/integration/quote_requests/migration.test.ts`): a row inserted before
  `up` reads `shared_with_customer = true` and `null` in the other three (FR-002, SC-004); a
  `shared` event inserts; `share_validity_days = -1` is refused.
- [ ] T006 Entity: `QR/src/backend/entities/quote-request.entity.ts` four properties per
  `data-model.md` §1 (default `true`, all in `[OptionalProps]`, the status doc comment notes the
  orthogonal flag); `QR/src/backend/entities/quote-request-event.entity.ts` union + `'shared'`;
  `toQuoteRequestRecord` (`QR/src/backend/services/quote-request-read-port.ts`) maps the flag;
  fix the record fixtures that stop compiling (`backend/test/integration/quote_requests/expiry-rules.test.ts`,
  `packages/contracts/src/quote-requests.test.ts`). Test: `QR/src/backend/services/quote-request-read-port.test.ts` (new).
- [ ] T007 Error codes: `QR/src/manifest.ts` `errorCodes` + the three minted codes
  (`RFQ_SHARE_CUSTOMER_UNAVAILABLE` tokens `not_member`, `inactive`) and `QUOTE_INCOMPLETE`
  tokens + `share`; re-derive the counts the `errorCodes` doc comment states;
  `errors.<CODE>[.<token>]` sentences in `QR/i18n/en.json` and `QR/i18n/pl.json`; three
  `MINTED_ERROR_CODES` entries in `backend/test/fixtures/error-code-routing/reference-ledgers.ts`
  (owner `quote_requests`, reason citing `specs/192-quote-request-draft-share/`) — the ledgers
  commit `07d6c99b5a` touched for `RFQ_SALES_CHANNEL_NOT_ALLOWED`.

**Verification**: `pnpm run build:packages`;
`pnpm --filter @endora-commerce/contracts exec vitest run src/quote-requests.test.ts src/quote-request-admin-list.test.ts src/quote-request-hooks.test.ts`;
`pnpm --filter @endora-commerce/contracts run typecheck`; `pnpm --filter $MOD run typecheck`;
`pnpm --filter $MOD exec vitest run src/backend/services/quote-request-read-port.test.ts`;
`pnpm --filter backend exec vitest run test/unit/_i18n/error-code-migration-progress.test.ts test/unit/_i18n/platform-error-code-block.test.ts test/unit/kernel/error-code-routing-equality.test.ts test/unit/db/migrations-registry.test.ts test/integration/quote_requests/quote-request-sharing-migration.test.ts`.

---

## Phase 2 — US1 guards: an unshared quote is invisible and silent (P1)

Goal: FR-003…FR-009. `createOnBehalf` is **not** changed here; tests make a quote unshared with
the helper of T008.

- [ ] T008 Test helper `backend/test/helpers/quote-request-share.ts` (new, beside
  `backend/test/helpers/quote-conversion.ts`): `markUnsharedForTest(em, id)` (sets
  `shared_with_customer = false`, `expires_at = null`); `shareQuoteRequestForTest` is added in T027.
- [ ] T009 [P] [US1] Failing tests `backend/test/integration/quote_requests/unshared-visibility.test.ts`
  (new): an admin-created quote made unshared; as the customer, as the Organization
  *Administrator*, as a roll-up login: `GET /api/v1/quote-requests` omits it;
  `GET|PATCH /api/v1/quote-requests/:id`, `POST …/accept-revision`, `…/reject-revision`,
  `…/convert-to-order`, `…/resubmit` and `POST /api/v1/cart/from-quote-request/:id` answer `404`
  with the body a random uuid gets, and the row's `version` is unchanged; `customers`' self list
  (`packages/modules/customers/src/backend/routes.self.ts:242`) and admin customer-detail list
  (`routes.admin.ts:547`, OQ-4) omit it; a customer submission and an order's *Clone to quote*
  stay visible at once (FR-010). Covers FR-003, FR-004, FR-010, SC-001.
- [ ] T010 [P] [US1] Failing unit case in `QR/src/backend/services/customer-projection.test.ts`:
  `shared` is dropped from a customer reply (admin-only, R-5); every other event is kept (OQ-1
  built as today).
- [ ] T011 [US1] `QR/src/backend/services/rfq-service.ts`: `findVisibleForCustomer` → `404` for
  `!sharedWithCustomer` (same message); `#listSummaries` `where` + `sharedWithCustomer: true`;
  `QR/src/backend/services/customer-projection.ts` `ADMIN_ONLY_EVENT_TYPES` + `'shared'`.
- [ ] T012 [US1] `packages/modules/carts/src/backend/services/cart-conversion-service.ts`
  `createCartFromQuoteRequest`: an unshared quote → the existing `404 quote_request_not_found`;
  case in `backend/test/contract/carts/cart-conversions.contract.test.ts` (no cart written).
- [ ] T013 [US1] Notifications suppressed while unshared. Tests first in
  `backend/test/integration/quote_requests/unshared-notifications.test.ts` (new): `modify`
  (lines, prices, groups, note, days, custom fields) and admin `cancel` of an unshared quote
  record zero `quote_request_notifications` rows, and each records its history event and audit
  row (FR-005, FR-008); then `RfqAdminService.modify` skips `record({ change: 'revised' })` and
  `cancel` skips `record({ change: 'canceled' })` when `!rfq.sharedWithCustomer`
  (`QR/src/backend/services/rfq-admin-service.ts` :1042, :797).
- [ ] T014 [US1] Validity days on an unshared quote (R-10): `modify` writes `shareValidityDays`
  (number as given, `null` clears, absent keeps), leaves `expiresAt`, and puts
  `validityDays: { before, after }` on the `modified` payload; on a shared quote
  `expiresInDays: null` → `422 VALIDATION_FAILED` (`issue: 'not_clearable_once_shared'`); the
  `validity_days` change projected in `QR/src/backend/services/history/history-diff.ts` /
  `history-projection.ts`; `rfq.detail.history.change.validity_days` in `CORE_I18N`. Tests:
  `QR/src/backend/services/history/history-diff.test.ts`, `QR/src/backend/history-bundle-coverage.test.ts`,
  row values in `unshared-notifications.test.ts`.
- [ ] T015 [US1] Sweep: `QR/src/backend/services/rfq-expiry-worker.ts` `dueRequests` adds
  `and q."shared_with_customer"` (shared by the batch select and the locked re-check). Test in
  `backend/test/integration/quote_requests/expiry-sweep.test.ts`: an unshared quote inactive past
  `expiry_days` stays `Created from admin` (FR-006).
- [ ] T016 [US1] PDF: `quote_request.send_document`
  (`QR/src/backend/commands/document-template-commands.ts:143`) refuses unshared with `409
  RFQ_NOT_SHARED` before rendering; tests in `backend/test/contract/quote_requests/pdf-send.test.ts`
  (refused, nothing sent) and `backend/test/contract/quote_requests/pdf-export.test.ts`
  (export still allowed) — FR-007.
- [ ] T017 [US1] Admin read model: `serializeFull` adds the four keys on the admin path only;
  `RfqAdminService.listAll` adds `sharedWithCustomer` per row and the `sharing` filter;
  `QR/src/backend/routes.admin.ts` passes the parsed query. Tests:
  `backend/test/contract/quote_requests/quote-request-response-schema.contract.test.ts` (a customer
  reply carries none of the four keys, `sharedByAdminUserId` included),
  `backend/test/contract/quote_requests/admin-list-paging.test.ts` (`sharing=unshared|shared`
  totals; FR-009).

**Verification**: `pnpm run build:packages`; `pnpm --filter $MOD run typecheck && pnpm --filter @endora-commerce/mod-carts run typecheck`;
`pnpm --filter $MOD exec vitest run src/backend/services/customer-projection.test.ts src/backend/services/history/history-diff.test.ts src/backend/services/history/history-projection.test.ts src/backend/history-bundle-coverage.test.ts`;
`pnpm --filter backend exec vitest run test/integration/quote_requests/unshared-visibility.test.ts test/integration/quote_requests/unshared-notifications.test.ts test/integration/quote_requests/expiry-sweep.test.ts test/contract/quote_requests/pdf-send.test.ts test/contract/quote_requests/pdf-export.test.ts test/contract/quote_requests/quote-request-response-schema.contract.test.ts test/contract/quote_requests/admin-list-paging.test.ts test/contract/carts/cart-conversions.contract.test.ts`.

---

## Phase 3 — US2 share, and the switch-over (P1)

Goal: FR-001, FR-020…FR-028. T018 and T026 land in **one commit** (the matrix move and the
flip are coupled — R-5); T027 in the same push.

- [ ] T018 [US2] Matrix (T004 done): `QR/src/backend/services/notifications/notification-matrix.ts`
  `prepared: row('shared', null, [C, C, C, null, null])` and the `CONTRACT` table of
  `notification-matrix.test.ts`.
- [ ] T019 [P] [US2] Failing tests `backend/test/integration/quote_requests/share.test.ts` (new).
  The bus forks its own transaction, so rows **commit**: clean up by id in `afterEach`
  (precedents `backend/test/integration/quote_requests/expiry-sweep.test.ts`,
  `backend/test/integration/platform/outbox-drain-concurrency.test.ts`). Cases: share → `200`,
  `sharedWithCustomer`, `sharedAt`, `sharedByAdminUserId`, `version + 1`, one `shared` event
  (admin actor, current `revisionId`), one audit row `quote_request.share`, three `prepared`
  records on the `shared` event, delivered once by the worker (FR-021…FR-023, SC-002); the
  customer then lists it and can accept, and (second quote) reject it; `expiresAt` = share moment
  + days, `null` without days (FR-032). Refusals leave the row unshared with zero records:
  unpriced line → `409 QUOTE_INCOMPLETE`, `details.code = 'share'`, line named (FR-026); account
  moved to another Organization → `RFQ_SHARE_CUSTOMER_UNAVAILABLE`/`not_member`; deleted →
  `inactive` (FR-027); cancelled draft → `RFQ_NOT_QUOTED`; already shared, a legacy operator
  quote, a customer submission → `RFQ_ALREADY_SHARED` (FR-025); stale `If-Match` →
  `VERSION_CONFLICT`; a sales representative not assigned to the Organization → `404`.
  Concurrency: two shares through two forked EntityManagers with `Promise.all` → one `200`, one
  `409 RFQ_ALREADY_SHARED`, three records in total (FR-024).
- [ ] T020 [P] [US2] Failing hook test `backend/test/integration/quote_requests/share-hook-veto.test.ts`
  (new) at **service level**, as `backend/test/integration/newsletter/hookable-actions.test.ts`
  wires it: a `CommandBus` with `sealedCommandHookRegistry` (`@endora-commerce/test-kit/command-hooks`)
  holding a test hook module on `QUOTE_REQUEST_HOOKABLE_ACTIONS.share`; veto with
  `CommandHookRefusal(409, 'TEST_VETO', …)` → `RfqAdminService.share` rejects with that error,
  row unshared, no `shared` event, no audit row, no notification record (FR-028, US2 #6); a
  passing hook receives `QuoteRequestShareHookData` with the written `expiresAt`; the hook
  module switched off → skipped. (The HTTP passthrough of a hook's `HttpError` is the
  platform's, pinned by `packages/platform/src/commands/command-bus.hooks.test.ts`.)
- [ ] T021 [P] [US2] Contract test `backend/test/contract/quote_requests/share-routes.contract.test.ts`
  (new): `200` body parses with `quoteRequestSchema`; each refusal's status, code and `details`
  shape as `contracts/admin-api.md` §1; `401`/`403` without `rfqs:handle`; unknown body keys → `422`.
- [ ] T022 [US2] `QR/src/backend/services/operator-quote-sharing.ts` (new):
  `operatorQuoteStartsUnshared()` (R-2); `normaliseShareValidityDays` (R-10, literal `0`);
  `unpricedLinesRefusal` (display order via `loadArrangedQuoteLines`, `hasUnpricedLine`);
  `customerUnavailability` (R-9: `findById`, org mismatch → `not_member`,
  `deletedAt`/`anonymizedAt` → `inactive`); `applyShare(em, rfq, actor, now)` (row fields,
  `shared` event through `RfqEventService.append(…, em)`, `prepared` through
  `RfqNotificationService.record(em, …)`). Unit tests `QR/src/backend/services/operator-quote-sharing.test.ts`
  (new). History: `shared` entry projected in `history-projection.ts` with its deliveries;
  `rfq.detail.history.entry.shared` in `CORE_I18N`; `history-projection.test.ts`,
  `history-bundle-coverage.test.ts`.
- [ ] T023 [US2] `QR/src/backend/commands/share-command.ts` (new):
  `makeShareQuoteRequestCommand({ quoteRequestId, expectedVersion }, deps)` — check order of
  `contracts/admin-api.md` §1 inside `run`; row read with `LockMode.PESSIMISTIC_WRITE`;
  visibility via `adminCanSeeOrganization` (as `findVisible` in `document-template-commands.ts`);
  `hookData`, `before`, `after` per `data-model.md` §5; no `capture`/reversibility (sends e-mail).
- [ ] T024 [US2] Declare the action in `QR/src/manifest.ts`
  (`hookableActions: [QUOTE_REQUEST_HOOKABLE_ACTIONS.share].map(toHookableActionDeclaration)`);
  test `QR/src/backend/manifest-hookable-actions.test.ts` (new; precedent
  `packages/modules/projects/src/backend/manifest.test.ts` from the projects hookable-actions
  merge `eccfc8dd6`).
- [ ] T025 [US2] `RfqAdminService.share(ctx, id, expectedVersion)` runs the Command on
  `commandBus` (new `RfqAdminServiceDeps.commandBus`, wired in `QR/src/backend/index.ts` as the
  document service gets it), kicks delivery **after** `run` resolves, answers
  `serializeFull(…, true)`; route `POST /api/v1/admin/quote-requests/:id/share` in
  `QR/src/backend/routes.admin.ts` (`guard`, strict empty body, `If-Match` read as `PATCH /:id` does).
- [ ] T026 [US1] Switch-over in `RfqAdminService.createOnBehalf`: `sharedWithCustomer` from
  `operatorQuoteStartsUnshared()`; `shareValidityDays` from the body (`normaliseShareValidityDays`;
  absent → `null` until T030); **no** `expiresAt`; **no** `prepared` record and no kick; still
  `created` + automatic note + `rfq.created_by_admin.v1`; audit `stateAfter` +
  `sharedWithCustomer`, `shareValidityDays`. Rewrite
  `backend/test/integration/quote_requests/created-from-admin.test.ts` to "created unshared,
  nothing recorded for the customer; visible and notified after the share" (FR-001, FR-005).
  Same commit as T018.
- [ ] T027 Existing-test sweep: add `shareQuoteRequestForTest(app | service, id)` to
  `backend/test/helpers/quote-request-share.ts`; then
  `git grep -ln "admin/quote-requests'\|createOnBehalf" -- backend/test 'packages/modules/*/src/**/*.test.ts'`
  and, in every hit that later acts as a customer or counts customer notifications, insert the
  share. Check first: `backend/test/integration/quote_requests/{admin-create-origin,notification-recording,notification-matrix-e2e,notification-delivery,history,conversion,unpriced-acceptance,expiry-rules,expiry-sweep,visibility}.test.ts`,
  `backend/test/contract/quote_requests/{customer-routes,admin-routes,expiry-enforcement,convert}.test.ts`,
  `backend/test/integration/orders/place-order-from-quote-request.test.ts`. Fix the tests, not
  the behaviour.

**Verification**: `pnpm run build:packages`; `pnpm --filter $MOD run typecheck`;
`pnpm --filter $MOD exec vitest run`;
`pnpm --filter backend exec vitest run test/integration/quote_requests test/contract/quote_requests test/contract/carts/cart-conversions.contract.test.ts test/integration/orders/place-order-from-quote-request.test.ts`
(the one full-directory run of this feature — it is the switch-over).

---

## Phase 4 — US3 default validity, regression guards (P2)

- [ ] T028 [P] [US3] Failing tests `backend/test/integration/quote_requests/default-validity.test.ts`
  (new, committing harness as T019): default 30 → create without `expiresInDays` stores 30,
  share at T → `expiresAt = T + 30 d` however long unshared (US3 #1); default 0 → no date
  (US3 #2); explicit 7 → 7, other quotes unchanged (US3 #3); default changed after create → the
  quote keeps its snapshot (FR-033); `expiresInDays: null` → no date; past the date: accept →
  `410 RFQ_EXPIRED`, convert → `410 QUOTE_VALIDITY_ENDED` (FR-034 unchanged).
- [ ] T029 [US3] Setting `quote_requests.default_validity_days` in `QR/src/manifest.ts`
  (`QUOTE_REQUESTS_SETTING_CODES`, `valueType: 'number'`, default `0`, group `quote_requests`);
  `settingLabels.quote_requests.default_validity_days.{name,description}` in `QR/i18n/{en,pl}.json`.
- [ ] T030 [US3] `resolveDefaultValidityDays` in `QR/src/backend/index.ts`
  (`setting(code, z.number().int().nonnegative(), 0)`, no channel) injected into
  `RfqAdminService`; `createOnBehalf` snapshots it when `expiresInDays` is absent (`0` → `null`).
- [ ] T031 [US3] `GET /api/v1/admin/quote-requests/create-defaults` in `QR/src/backend/routes.admin.ts`,
  registered before `/:id`, `guard`, answering `adminQuoteRequestCreateDefaultsSchema`; cases in
  `backend/test/contract/quote_requests/share-routes.contract.test.ts` (shape, `0` → `null`,
  permission).
- [ ] T032 [P] FR-011 guard `backend/test/integration/quote_requests/same-product-lines.test.ts`
  (new): one product on two lines at two prices → create, modify, share, customer read, accept:
  two lines with their own prices throughout; a revision after the share (lines re-sent without
  ids) keeps them separate (`pairLines`, R-16).
- [ ] T033 Off state (`specs/conventions/module-activation.md` item 6) in
  `backend/test/integration/quote_requests/off-state.test.ts`: `POST …/:id/share` and
  `GET …/create-defaults` answer the module-disabled response while off and work again after
  re-activation; the new setting is not editable while off.

**Verification**: `pnpm run build:packages`; `pnpm --filter $MOD run typecheck`;
`pnpm --filter backend exec vitest run test/integration/quote_requests/default-validity.test.ts test/integration/quote_requests/same-product-lines.test.ts test/integration/quote_requests/off-state.test.ts test/contract/quote_requests/share-routes.contract.test.ts test/unit/_i18n/setting-labels-issue-902.test.ts`;
`pnpm --filter backend run lint`.

### Review checkpoint A — backend

QA, code-quality and security review **in parallel**, each on a model other than the author's,
on the Phase 1–4 diff. Security focus: every customer read path including `carts`, `404` parity
with a missing quote, the hook veto rolling everything back, the share under concurrency,
sales-representative scoping on both new routes. Findings fixed before Phase 5.

---

## Phase 5 — Admin UI: detail, list, history (US1, US2, US3)

New screen strings go in `QR/i18n/{en,pl}.json` read through `useTranslation('quote_requests')`
(as `tPdf`/`tGroups` already do); `pnpm --filter backend run i18n:hardcoded` stays green.

- [ ] T034 [P] [US2] Failing tests `admin/test/modules/quote_requests/RfqDetail.share.test.tsx`
  (new): unshared → *Draft* badge beside the status and a **Share with customer** header action;
  the confirm dialog (`useConfirmDialog`) names the customer and the validity the share will
  write; success refetches and shows the shared state without the action (US2 #3);
  `QUOTE_INCOMPLETE`/`share` lists the named lines; `RFQ_SHARE_CUSTOMER_UNAVAILABLE` shows its
  token sentence; a hook's own code shows the envelope's message; `RFQ_ALREADY_SHARED` refetches
  with an info notice; *Send PDF to customer* absent while unshared, export present (FR-007).
- [ ] T035 [US2] `QR/src/admin/pages/RfqDetail.tsx`: badge, header action, confirm, refusal
  rendering, PDF-send gating; notices through `QR/src/admin/pages/rfq-page-notice.ts`.
- [ ] T036 [P] [US3] Failing cases in `admin/test/modules/quote_requests/RfqDetail.validity.test.tsx`:
  unshared shows the days and "counts from sharing", no date; editing days sends a number or
  `null` when cleared; shared unchanged (date, lapsed).
- [ ] T037 [US3] `QR/src/admin/validity.ts` (unshared branch: "N days from sharing") and the
  validity block of `RfqDetail.tsx`; clearing means `null` only while unshared.
- [ ] T038 [P] [US1] Failing tests `admin/test/modules/quote_requests/RfqList.sharing-filter.test.tsx`
  (new): *Draft* badge on unshared rows; *Draft / Shared* filter sends `sharing=…`; a saved view
  stores and restores it; *Clear filters* clears it (FR-009).
- [ ] T039 [US1] `QR/src/admin/pages/RfqList.tsx`: badge in the status cell, filter (same
  control family as the status filter), URL param, saved-view `filters.sharing`; option labels
  through `defineEnumLabels` in `QR/src/admin/lib/labels.ts` (+ `labels.test.ts`).
- [ ] T040 [P] [US2] `QR/src/admin/pages/RfqHistory.tsx`: `shared` entry with its deliveries,
  `validity_days` change; cases in `admin/test/modules/quote_requests/RfqHistory.deliveries.test.tsx`
  and `RfqDetail.history.test.tsx`.

**Verification**: `pnpm run build:packages`; `pnpm --filter $MOD run typecheck && pnpm --filter admin run typecheck`;
`pnpm --filter admin exec vitest run test/modules/quote_requests/RfqDetail.share.test.tsx test/modules/quote_requests/RfqDetail.validity.test.tsx test/modules/quote_requests/RfqList.sharing-filter.test.tsx test/modules/quote_requests/RfqHistory.deliveries.test.tsx test/modules/quote_requests/RfqDetail.history.test.tsx test/modules/quote_requests/RfqDetail.header-actions.test.tsx`;
`pnpm --filter $MOD exec vitest run src/admin`; `pnpm --filter backend run i18n:hardcoded`.

---

## Phase 6 — Admin UI: create screen (US2, US3)

- [ ] T041 [P] [US3] Failing tests `admin/test/modules/quote_requests/RfqCreatePage.share.test.tsx`
  (new): validity prefilled from `GET …/create-defaults` (`null` → empty) with "counted from
  sharing"; clearing sends `expiresInDays: null`; untouched sends the prefilled number; a failed
  defaults request leaves the field empty and the screen usable.
- [ ] T042 [P] [US2] Same file: **Save as draft** lands on the draft; **Create and share**
  creates, then shares with `If-Match` = the returned `version`, and lands on the shared quote;
  share refused → lands on the draft with the refusal shown (FR-020, US2 #7); create `warnings`
  → shares and carries the warnings to the detail (OQ-7 literal); both actions disabled while
  busy.
- [ ] T043 [US2][US3] `QR/src/admin/pages/RfqCreatePage.tsx`: defaults fetch, prefill and hint,
  two actions, the create → share sequence, refusal and warnings carried to `RfqDetail.tsx`
  through navigation state (`rfq-page-notice.ts`); `openedWith.returnTo` (CRM opener) kept for
  both actions after they succeed.
- [ ] T044 [P] Regression: `admin/test/modules/quote_requests/RfqCreatePage.{origin,groups,sales-channel,product-browser,catalog-permission}.test.tsx`
  stay green.

**Verification**: `pnpm --filter admin run typecheck`;
`pnpm --filter admin exec vitest run test/modules/quote_requests/RfqCreatePage.share.test.tsx test/modules/quote_requests/RfqCreatePage.origin.test.tsx test/modules/quote_requests/RfqCreatePage.groups.test.tsx test/modules/quote_requests/RfqCreatePage.sales-channel.test.tsx test/modules/quote_requests/RfqCreatePage.product-browser.test.tsx test/modules/quote_requests/RfqCreatePage.catalog-permission.test.tsx`;
`pnpm --filter admin run lint`; `pnpm --filter backend run i18n:hardcoded`.

### Review checkpoint B — admin UI

`endora-commerce-designer` audit against `.claude/skills/ux-laws/SKILL.md` (confirmation of an
irreversible action, hierarchy of *Save as draft* vs *Create and share*, loading/empty/error
states, WCAG 2.2 AA), with QA and code-quality review in parallel on the Phase 5–6 diff.

---

## Phase 7 — Docs, generated artefacts, release intent

- [ ] T045 [P] `QR/docs/quote_requests.md`: drafts and sharing (who sees what, refusals,
  *Create and share*, PDF), the default-validity setting, the hookable action (`quote_request.share`,
  `QUOTE_REQUEST_HOOKABLE_ACTIONS.share`, route, hook data — format of
  `packages/modules/projects/docs/projects.md`'s command-hook table), `shared` as the source of
  *quote prepared*. Polish mirror `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/quote_requests.md`
  and its pin `docs/translation-cache/pl/packages--modules--quote_requests--docs--quote_requests.md.json`
  (`docs/docs/contributing/documentation-i18n.md`; `specs/conventions/module-documentation.md`).
- [ ] T046 [P] `docs/docs/module-reference/quote-requests.md` and
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/quote-requests.md`
  (+ `docs/translation-cache/pl/generated:module-reference--quote-requests.json` if the generator
  rewrites it).
- [ ] T047 `.changeset/192-quote-request-sharing.md` for `@endora-commerce/contracts`,
  `@endora-commerce/mod-quote-requests`, `@endora-commerce/mod-carts`
  (`specs/conventions/release-intent.md`; disclosure per `specs/conventions/commercial-data.md`).
- [ ] T048 Generated artefacts clean: `pnpm --filter backend run composer:generate`,
  `pnpm --filter backend run manifests:generate` and `pnpm install --lockfile-only` if either
  changed anything; `pnpm run check:naming && pnpm run check:language`.
- [ ] T049 Walk `quickstart.md` 1–10 on a local stack; record the result in the MR description.

**Verification**: `pnpm changeset:status`; `pnpm run check:naming && pnpm run check:language`;
`git status --porcelain` empty after the generators.

---

## Gated on owner answers (not built until answered; each is one predicate)

- [ ] T050 [OQ-1] If the owner rules "hide the drafting history": `customerEventsOf` drops
  `modified` events dated before `sharedAt`; case in `QR/src/backend/services/customer-projection.test.ts`
  and in `unshared-visibility.test.ts` after a share.
- [ ] T051 [OQ-3] If a blocked account is "inactive": `customerUnavailability` adds `blockedAt`
  to `inactive`; case in `share.test.ts`.
- [ ] T052 [OQ-7] If *Create and share* must stop on warnings: `RfqCreatePage.tsx` shows the
  warnings with **Share with customer** / **Open draft** instead of sharing; case in
  `RfqCreatePage.share.test.tsx`.
- [ ] T053 [OQ-2] If a typed `0` means "no deadline" on a draft: `normaliseShareValidityDays`
  maps `0` → `null`; cases in `operator-quote-sharing.test.ts` and `default-validity.test.ts`.

---

## FR → test map

| FR | Tests |
| --- | --- |
| FR-001 | T026 (`created-from-admin.test.ts`), T022 (decision function), T042 (CRM opener keeps the flow) |
| FR-002 / SC-004 | T005 |
| FR-003 / SC-001 | T009, T012 |
| FR-004 | T009, T012 |
| FR-005 | T013, T026 |
| FR-006 | T015 |
| FR-007 | T016, T034 |
| FR-008 | T013, T014 |
| FR-009 | T017, T038 |
| FR-010 | T009 |
| FR-011 | T032 |
| FR-020 | T025, T021, T042 |
| FR-021 / FR-022 / FR-023 / SC-002 | T019, T022, T040 |
| FR-024 | T019 (concurrency) |
| FR-025 | T019 |
| FR-026 | T019, T022, T034 |
| FR-027 | T019, T022 |
| FR-028 | T020 |
| FR-030 … FR-033 / SC-003 | T028, T041 |
| FR-034 | T028 |

## Dependencies

Phase 1 → 2 → 3 → 4 → checkpoint A → 5 → 6 → checkpoint B → 7. T018 needs T004 and lands with
T026. T027 in the same push as T026. T043 needs T025 and T031. Gated tasks wait for the owner.

## Implementation strategy

MVP = Phases 1–3 (drafts hidden and shareable through the API, existing suites green), then
Phase 4, then the UI. Do not ship Phase 3 without the UI in the same release: until Phase 5 an
operator has no button to share, and every new operator quote would be stuck unshared.
