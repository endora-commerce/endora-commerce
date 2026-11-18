# Tasks: Return-case notifications and complaints without a platform order

**Input**: [spec.md](./spec.md), [plan.md](./plan.md) (WP A-1 … A-7, B-1 … B-10),
[research.md](./research.md) (F1 … F12, R-1 … R-19), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

**One merge request** (owner ruling 2026-11-13). Phases run in order: Setup → phase A (A-1 … A-7) →
**A/B boundary gate** → phase B (B-1 … B-10) → final verification. The branch is green at the
boundary.

**Design review folded in** (owner rulings on `design-review.md` D-1 … D-18, 2026-11-13; plan §
*Design review rulings*). To keep every earlier ID stable, the tasks this added are numbered
**T104 and up** and placed **inside the WP they belong to**. Execution order is the order of the
lines in this file, not the numeric order of the IDs.

**Tests are mandatory** (Constitution III, NN). Within every work package the test task comes first
and is run **red** before its implementation task turns it green. Contract and integration files do
not run on merge requests (D-198): run them locally against `pnpm run dev:infra:test` with
`pnpm --filter backend exec vitest run <paths>` and paste the output in the MR description.

## Format

`- [ ] T### [P?] [USn?] Description — paths`

- **[P]** — may run in parallel with the other [P] tasks **of the same WP**: disjoint files, and no
  dependency on an unfinished task of that WP. A task without [P] is sequential.
- **[USn]** — the spec's user story; Setup, cross-cutting and verification tasks carry none.
- Abbreviations: `rt` = `packages/modules/returns`, `ct` = `packages/contracts/src`,
  `it` = `backend/test/integration/returns`, `ctt` = `backend/test/contract/returns`,
  `adm` = `admin/test/modules/returns`, `sf` = `storefront`.

## Standing obligations of every WP (not repeated per task)

- `pnpm run build:packages` after editing `ct` or `rt`, before any test run.
- Typecheck + lint of each workspace touched; the targeted tests of the WP.
- Free text (comment body, note, clause text, contact data) never enters an audit payload or a log
  line (D-288).
- Any file deleted or renamed: grep `backend/test/**` and `packages/**` for it before the WP ends
  (AGENTS.md trap).
- Re-record a read size only if a check refuses it (`specs/conventions/check-estate.md`).

---

## Phase 1 — Setup

- [X] T001 Confirm the branch `feat/180-off-platform-complaints` is based on current `origin/master`; run `pnpm run build:packages` and `pnpm --filter @endora-commerce/mod-returns run test` to record a green baseline — repository root
- [X] T002 Add `bullmq` ^5 and `ioredis` ^5 to `peerDependencies` and the matching versions to `devDependencies` (copy `packages/modules/forms/package.json`'s); then `pnpm run manifests:generate` and `pnpm install --lockfile-only`, and commit the lockfile — `rt/package.json`, `pnpm-lock.yaml`

---

## Phase A — Notifications and the authorizer (US1–US4)

### WP A-1 — Contracts (blocks phase A)

- [X] T003 [US3] Test: `adminAddCommentRequestSchema` refuses `notifyCustomer: true` with `isCustomerVisible: false` with detail code `notify_requires_customer_visible`; accepts the other three combinations — `ct/returns.test.ts`
- [X] T004 [US3] Test: `returnStatusSchema` requires `notifyCustomerOnEntry`; the create and patch status bodies accept it as optional — `ct/returns.test.ts`
- [X] T005 [US4] Test: `returnCaseDetailSchema` carries `authorizedAt` and `authorizedBy: { adminUserId | null, name | null } | null`; `adminReturnRowSchema` carries `authorizedBy`; `returnCaseSummarySchema` carries `reference` (FR-A44); `returnNotificationHealthSchema` parses (D-7); `adminReturnsSortSchema` is unchanged — `ct/returns.test.ts`
- [X] T006 Impl: the changes of contracts/admin-api.md §A1–§A3 and §A5 — `ct/returns.ts`
- [X] T104 [P] [US4] Test (D-4, FR-A44): `caseReference` answers the RMA number when set, otherwise `#` plus the first eight hex characters of the id, upper-cased and without hyphens; it is pure and stable — `rt/src/backend/domain/case-reference.test.ts`
- [X] T105 [US4] Impl: `caseReference(rc)` — `rt/src/backend/domain/case-reference.ts`

### WP A-2 — Migration A and entities

- [X] T007 [US4] Test: migration A adds `return_cases.authorized_by_admin_user_id` and `return_statuses.notify_customer_on_entry` (default `false`). The backfill fills the column from the newest `return.status_changed` audit entry with `state_after.statusCode = 'authorized'` and a non-null actor; it leaves a case with no such entry `null`; it leaves an already-filled value untouched; a second run changes nothing. `down` drops both columns — `it/authorizer-backfill.test.ts`
- [X] T008 Impl: scaffold with `pnpm --filter backend run migration:new` in `rt`, using the SQL of data-model §1.3; then run `pnpm --filter backend run composer:generate` and commit the registry — `rt/src/migrations/<ts>_returns_authorizer_status_notifications.ts`, `backend/src/db/migrations-registry.generated.ts`
- [X] T009 [P] Impl: `authorizedByAdminUserId` on the entity (optional props) — `rt/src/backend/entities/return-case.entity.ts`
- [X] T010 [P] Impl: `notifyCustomerOnEntry` on the entity — `rt/src/backend/entities/return-status.entity.ts`

### WP A-3 — Status effects on every path (research R-7.3, repairs F3)

- [X] T011 [US4] Test: `POST …/:id/transition` and `POST …/bulk-transition` into `authorized` each assign an RMA number, `authorizedAt` and `authorizedByAdminUserId` (the acting admin), and send exactly one `return_authorized` e-mail. Into `rejected`, each sends one `return_rejected` e-mail. `POST …/:id/authorize` behaves as before and also stamps the authorizer — `it/authorize-rma.test.ts` (extend)
- [X] T012 [US4] Impl: move the "entering `authorized`" mutation (RMA, `authorizedAt`, `authorizedByAdminUserId` from the actor) and the dedicated authorized/rejected e-mail into `ReturnTransitionService.apply` as the effect of the target status. `authorize()`/`reject()` keep their signatures and delegate to it. Keep the existing best-effort containment of the e-mail (`notifySafely`) — `rt/src/backend/services/return-transition-service.ts`, `rt/src/backend/services/return-authorization-service.ts`, `rt/src/backend/plugin.ts`
- [X] T013 [US4] Impl: the status write refuses `notifyCustomerOnEntry: true` on `authorized` or `rejected` (`VALIDATION_FAILED`, detail `dedicated_email_status`) and persists the flag otherwise, inside its existing audited transaction; plus a test case for the refusal — `rt/src/backend/services/return-status-graph-service.ts`, `it/status-notifications.test.ts`

### WP A-4 — The notification pipeline (research R-2 … R-5)

- [X] T014 [P] [US1] Test: a recipient resolver for `returns.new_case_recipients` — trims, lower-cases and de-duplicates; keeps the first 10; skips non-addresses and reports each as `invalid_recipient`; takes the channel value over the global one — `rt/src/backend/services/notifications/recipients.test.ts`
- [X] T015 [P] [US1] Test: bell recipients — active admins whose effective permissions include `returns:read` (wildcard included) and nobody else. The title/body carry `titleMessage`/`bodyMessage` (scope `returns`) and name no customer or organization. With `admin_notifications` absent the port is not called and the outcome is `not_present` — `rt/src/backend/services/notifications/admin-bell.test.ts`
- [X] T016 [P] [US1] [US2] [US3] Test: the dispatch builds each of the four e-mails with the variables of contracts/settings-emails-events.md §2 — `caseReference` in every one, the derived `#XXXXXXXX` on an unauthorized case (FR-A44) — and the `messageId`s of research R-2, sends in the channel language, and reports every non-sent outcome with its reason without throwing. A transport failure is rethrown after the other messages were tried. A retry with recorded progress records no second bell entry and resends no completed message — `rt/src/backend/services/notifications/dispatch.test.ts`
- [X] T017 [P] [US1] [US2] [US3] Test: four transactional defaults exist in `en-US` and `pl-PL` with the declared variables only; every subject names `{{var caseReference}}`; no default promises a processing time — `rt/src/backend/email-templates/transactional-defaults.test.ts`
- [X] T018 Impl: recipient resolver, bell recipients, dispatch, message builders; URLs from the container's `storefrontBaseUrl` and `configuredAdminBaseUrl()` — `rt/src/backend/services/notifications/{recipients,admin-bell,dispatch,messages}.ts`
- [X] T019 Impl: the four defaults (`RETURN_NEW_CASE_DEFAULT`, `RETURN_SUBMITTED_DEFAULT`, `RETURN_COMMENT_ADDED_DEFAULT`, `RETURN_STATUS_ENTERED_DEFAULT`) — `rt/src/backend/email-templates/transactional-defaults.ts`
- [X] T020 Test: the `returns-notifications` processor runs each job kind in the system scope with a reason, refuses with `ModuleDisabledError` while `returns` is off, and does nothing for a case or comment that no longer exists — `rt/src/backend/workers/returns-notifications-worker.test.ts`
- [X] T021 Impl: queue `returns-notifications` (jobs `case_submitted`, `comment_notify`, `status_entered`; five attempts, exponential backoff from 10 s), producer built on first use, consumer through `ctx.worker`. Compose it in `index.ts` exactly as `forms` composes its notifications (`moduleQueueRedis`, `processRunsWorkers`) — `rt/src/backend/workers/returns-notifications-worker.ts`, `rt/src/backend/index.ts`

### WP A-5 — Producers (US1, US2, US3)

- [X] T022 [P] [US1] [US2] Test: filing a case (return and complaint) enqueues one `case_submitted` after commit; a refused filing enqueues nothing. End to end with the processor driven directly: one shop e-mail per valid recipient, one confirmation to the filer (not the order's placer), bell entries for `returns:read` holders only. With `admin_notifications` off the case and the e-mails still happen. A deactivated template sends nothing and logs `deactivated` — `it/notifications.test.ts` (extend), `it/notifications-bell.test.ts`
- [X] T023 [P] [US3] Test: a customer-visible comment with notify enqueues one `comment_notify` and yields one e-mail with the body; a comment without notify enqueues nothing; an internal comment with notify is refused 422 by the route; comments stored before the release are never sent — `it/comments.test.ts` (extend), `ctt/comment-notify.contract.test.ts`
- [X] T024 [P] [US3] Test: entering a marked status yields one `return_status_entered` e-mail when an admin or the system (shipment) moved the case, and **none** when the customer moved it themselves (cancel, D-13). Filing a case with the initial status marked yields only the confirmation, no status e-mail (D-2). Entering `authorized`/`rejected` yields only the dedicated e-mail. Marking a status sends nothing for cases already in it — `it/status-notifications.test.ts`
- [X] T025 Impl: enqueue `case_submitted` after `createCase`'s transaction returns — `rt/src/backend/services/return-case-service.ts`
- [X] T026 Impl: enqueue `comment_notify` in `addByAdmin` when notify is set, and replace the "nothing sends on it" comment with the decision — `rt/src/backend/services/return-comment-service.ts`
- [X] T027 Impl: enqueue `status_entered` after the flush in `apply` when the target is marked, is not `authorized`/`rejected`, and the actor is not a customer (D-13). Filing never goes through `apply`, which keeps D-2 structural — `rt/src/backend/services/return-transition-service.ts`

### WP A-6 — Admin UI (US3, US4)

- [X] T028 [P] [US3] Test: the status configuration screen shows the *notify the customer on entry* toggle.
  - It is disabled with the reason beside it on *Authorized* and *Rejected*.
  - It is editable on the initial status, with the hint "Not sent when a case is filed; the confirmation e-mail covers that" (D-2).
  - The line "Turning this on doesn't e-mail cases already in that status" is shown.
  - The recipients alert (D-7) shows the channels from `notification-health`, links to `/settings?group=returns`, and is absent when every channel has a recipient.

  — `adm/ReturnStatusesConfigPage.notify.test.tsx`
- [X] T029 [P] [US3] Test: on the case detail the new comment defaults to **internal** (D-16); the textarea has a visible label (D-17); *notify customer* is disabled and cleared while *internal* is chosen, with its hint; re-checking *visible* does not re-check *notify*; a comment posted with notify shows "E-mail requested" — `adm/ReturnDetail.commentNotify.test.tsx`
- [X] T106 [P] [US1] Test (D-7): `GET /api/v1/admin/returns/notification-health` reports `global: true` with an empty global list and every channel whose effective value holds no valid address; `returns:read` required — `it/notification-health.test.ts`
- [X] T107 [US1] Impl: notification-health service (reusing T018's recipient resolver) and admin route — `rt/src/backend/services/notifications/health.ts`, `rt/src/backend/routes.admin.ts`
- [X] T030 [P] [US4] Test: the detail shows *Authorized by <name>* with the time, *former administrator* for a missing user, *unknown* for `null` — `adm/ReturnDetail.authorizer.test.tsx`
- [X] T031 [P] [US4] Test: the list offers an *Authorized by* column that is not sortable, and uses the case `reference` as the row's link text, never `—` (D-4) — `adm/ReturnsList.authorizer.test.tsx`
- [X] T032 [US4] Test: the detail and the list rows resolve names in one batched `adminUserReadPort.findByIds` per page. Rows and detail carry `reference`. `q=#XXXXXXXX` (and without `#`) finds the case by its derived reference. The CSV export carries `reference` and `authorizedBy` in the export language — `it/list-and-bulk.test.ts` (extend)
- [X] T033 [US4] Impl: `reference` on summary and detail (via `caseReference`); authorizer on the detail mapping, list rows and export; the `q` match on the derived reference — `rt/src/backend/services/return-case-service.ts`, `rt/src/backend/services/return-list-service.ts`, `rt/src/backend/services/return-export-service.ts`
- [X] T034 [US3] [US4] Impl in the admin UI:
  - status toggle with its closed states and initial-status hint (D-2);
  - the recipients `Alert` (D-7);
  - the comment form: default internal (D-16), visible `Label` with the kit's `Textarea`/`Checkbox` (D-17), the notify rule, the "E-mail requested" marker;
  - card titles, `authorKind` and the kind badge translated (D-17);
  - authorizer and reference on detail and list; the page title uses the reference when there is no RMA number.

  — `rt/src/admin/pages/ReturnStatusesConfigPage.tsx`, `rt/src/admin/pages/ReturnDetail.tsx`, `rt/src/admin/pages/ReturnsList.tsx`, `rt/src/admin/api/returns-client.ts`
- [X] T035 Impl: en + pl keys for every new admin string, the strings D-17 moves out of `ReturnDetail.tsx`/`ReturnStatusesConfigPage.tsx`, and the bell `titleMessage`/`bodyMessage` templates. Run `pnpm --filter backend run i18n:hardcoded` (lower the baseline numbers the moved strings free, never raise) and `check:bundle-pairing` — `rt/i18n/en.json`, `rt/i18n/pl.json`

### WP A-7 — Manifest, docs, presence, phase-A gate

- [X] T036 [US1] Test: the manifest declares `returns.new_case_recipients` (`string_list`, `[]`); the four `transactionalEmails` with their variables; `admin_users` in `dependencies`; and `admin_notifications` as `degrades-without` with its `whenAbsent` sentence — `rt/src/manifest.test.ts`
- [X] T037 Impl: manifest changes (contracts/settings-emails-events.md §1, §2, §6) with settings labels in `rt/i18n/{en,pl}.json`; then `pnpm --filter backend run composer:generate`, `pnpm run manifests:generate`, `pnpm install --lockfile-only` — `rt/src/manifest.ts`, generated artefacts
- [X] T038 Test: with `returns` off, no `returns-notifications` job is consumed or produced, and the status and comment routes answer as absent; restoring the module restores them — `it/off-state.test.ts` (extend)
- [X] T039 [P] Docs (EN): section *Notifications* (shop e-mail and recipients, confirmation, comment notify, status e-mails, bell) and *Who authorized a case* — `rt/docs/returns.md`
- [X] T040 [P] Docs (PL): the same two sections, per `docs/docs/contributing/documentation-i18n.md` — `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/returns.md`
- [X] T041 **A/B boundary gate**: `pnpm run build:packages`; `pnpm -r run typecheck`; `pnpm -r run lint`; `pnpm --filter @endora-commerce/mod-returns run test`; `pnpm --filter @endora-commerce/contracts run test`; the phase-A integration and contract tests (quickstart.md § phase A) against `dev:infra:test`; `check:command-coverage`, `check:port-dependencies`, `check:port-catches`, `check:off-state-coverage`, `check:queue-names`, `check:subscribe-seam`, `check:module-boundary`, `check:module-docs`, `check:docs-translations`, `pnpm run check:naming && pnpm run check:language`. Do not start phase B until all pass — repository root

---

## Phase B — The complaint without a platform order (US5–US8)

### WP B-1 — Contracts and peer dependency

- [X] T042 Add `@fastify/multipart` ^10 to `peerDependencies` and the matching `devDependencies` (as `packages/modules/crm/package.json`); `pnpm run manifests:generate`; `pnpm install --lockfile-only` — `rt/package.json`, `pnpm-lock.yaml`
- [X] T043 [US5] Test: the create request is the union of contracts/customer-api.md §C3. The order branch is unchanged except for `serialNumber`, `attachments`, `shownClauses`, `acceptedClauses`, `submissionKey`. The no-order branch requires `kind: 'complaint'`, `purchase.date`, `contact`, `returnAddress`, and per line exactly one of `productId`/`modelName` plus a non-empty `description`. `attachmentAssetIds` is refused as an unknown key — `ct/returns.test.ts`
- [X] T044 [US6] [US7] Test: `returnFormConfigSchema` with `confirmationEmailEnabled`, `today` and clauses carrying `mode` and `linkUrl` (D-1, D-11, D-12); the upload response; `returnAttachmentSchema` (typed, no `assetId`); the clause schemas and requests with `appliesTo`, `mode` and an https-only `linkUrl` — `ct/returns.test.ts`
- [X] T045 [US8] Test: `resolutionTypeSchema` includes `settled_outside`; `settlementRequestSchema.resolutionNote`; summary `orderId` nullable + `offPlatform`, `productLabel`, `lineCount`, `purchaseDate` (D-3); list query `origin`; detail blocks of contracts/admin-api.md §B2 with `personalDataErasedAt` (D-8) and shown clauses with `mode`/`linkUrl`; `RETURN_CASE_CREATED_EVENT` and its strict schema; `ReturnStatusEvent.orderId` nullable — `ct/returns.test.ts`
- [X] T046 Impl: everything of contracts/admin-api.md §B1–§B5, customer-api.md §C1–§C6 and settings-emails-events.md §3; remove `attachmentAssetIds` and the asset-shaped `addReturnAttachmentRequestSchema`, then grep `backend/test/**`, `storefront/**`, `admin/**` and `packages/**` for both names and update every reference — `ct/returns.ts`

### WP B-2 — Migration B and entities

- [X] T047 [US5] Test: migration B applies every change of data-model §2.1–§2.4, including the clause columns `applies_to`, `mode` and `link_url` and their checks (D-1). The checks refuse an order-less `return`, an order-less case without `purchase_date`, and `settled_outside` on an order case or without a note. The unique `(customer_account_id, submission_key)` holds. Existing attachments get `organization_id` from their case. `down` reverses on a database without off-platform rows and refuses with one — `it/off-platform-migration.test.ts`
- [X] T048 Impl: scaffold with `migration:new` in `rt` per data-model §2.5; `composer:generate` — `rt/src/migrations/<ts>_returns_off_platform_complaints.ts`, `backend/src/db/migrations-registry.generated.ts`
- [X] T049 [P] Impl: case entity fields (`orderId` nullable, purchase, contact, return address, accepted clauses, note, submission key, erasure stamp, `settled_outside`) — `rt/src/backend/entities/return-case.entity.ts`
- [X] T050 [P] Impl: line entity (`orderItemId`, `productId` nullable; `serialNumber`) — `rt/src/backend/entities/return-case-item.entity.ts`
- [X] T051 [P] Impl: attachment entity reclassified `@OrgScoped` with the new columns — `rt/src/backend/entities/return-case-attachment.entity.ts`
- [X] T052 [P] Impl: new `ReturnCaseClause` entity (`@GlobalEntity`, with `appliesTo`, `mode`, `linkUrl`), registered in the module's entity list — `rt/src/backend/entities/return-case-clause.entity.ts`, `rt/src/backend/index.ts`
- [X] T053 Test: cross-tenant — a pending upload and an attachment of organization X are invisible under organization Y's context (not-found, indistinguishable); the entity classification check passes — `it/attachments-tenancy.test.ts`

### WP B-3 — Filing: the Command and the no-order branch (US5)

- [X] T054 [US5] Test, the R-10 table row by row: an off-platform case has no order context read on detail; settlement prefill takes the no-order branch; a transition emits `orderId: null`; export leaves `orderId` empty; the order-id search does not match it; eligibility and withdrawal code is not reached — `it/off-platform-detail.test.ts`
- [X] T055 [US5] Test: with `returns.off_platform_complaints_enabled` off for the channel the no-order post answers 403 `RETURN_OFF_PLATFORM_DISABLED`; with it on, the case is created. The value is read for the request-resolved channel, never a body field — `it/off-platform-toggle.test.ts`
- [X] T056 [US5] Test: a no-order complaint with one catalog line and one free-text line with a serial number is created with:
  - `orderId null` and the caller's organization and request channel;
  - the channel `defaultCurrency`, and all amounts 0;
  - the name snapshot;
  - purchase, contact and address stored as sent, with the account and address book untouched.

  Refusals:
  - a future purchase date → `purchase_date_in_future`;
  - a product not available on the channel → `unknown_product`;
  - neither product nor model → `product_or_model_required`;
  - an inactive or non-complaint reason → `unknown_reason`;
  - kind `return` → refused;
  - a member without `returns.create` → refused as today.

  Cross-tenant: another organization's member cannot read the case — `it/off-platform-submit.test.ts`
- [X] T057 [US5] Test: the same `submissionKey` twice yields one case, a 200 with the same body, and one `case_submitted` job — `it/off-platform-submit.test.ts`
- [X] T058 [US5] Test: `return_case.create` writes exactly one audit entry for an order case and for a no-order case, with the names-only `stateAfter` of contracts/settings-emails-events.md §5, and no hand-written duplicate. A rolled-back filing writes none and emits no event — `it/audit.test.ts` (extend)
- [X] T059 [US5] Impl: `createCase` as Command `return_case.create` (both branches); remove the `recordAuditFromContext` call in the same change. Add the no-order branch (research R-9, R-10), the product check through `catalogProductAvailabilityPort` with the name snapshot (R-17), and the submission key (R-18). Emit `return_case.created.v1` from the Command; existing order-path tests stay green — `rt/src/backend/services/return-case-service.ts`
- [X] T060 [US5] Impl: subscribe to `return_case.created.v1` to enqueue `case_submitted`, replacing the post-transaction enqueue of T025 (`ctx.subscribe`) — `rt/src/backend/index.ts`, `rt/src/backend/services/return-case-service.ts`
- [X] T061 [US5] Impl: the no-order branches of `mapDetail`, the transition event and export (the R-10 table) — `rt/src/backend/services/return-case-service.ts`, `rt/src/backend/services/return-transition-service.ts`, `rt/src/backend/events/return-status-events.ts`, `rt/src/backend/services/return-export-service.ts`
- [X] T062 [US5] Impl: the create route takes the union body; it resolves the organization, channel, settings and `returns.create` gate as today — `rt/src/backend/routes.customer.ts`

### WP B-4 — Uploads and attachments (US6)

- [X] T063 [P] [US6] Test: content sniffing — JPEG, PNG, WebP, PDF accepted by magic bytes; a PDF declared as `image/png` stored as PDF; an HTML file declared as an image refused `type_not_accepted` — `rt/src/backend/services/attachment-sniff.test.ts`
- [X] T064 [US6] Test: `POST /api/v1/returns/uploads` stores a pending upload (row + private object under `returns/<org>/<id>`, 24 h expiry). Over 10 MB answers 413 `too_large`; no file answers 400; a member without `returns.create` is refused. `POST /api/v1/returns/:id/attachments` (multipart) adds to an open case filed by the caller; it refuses on a terminal case, on another member's case, and beyond 10 per case. It runs Command `return_case.attachment.add` — `it/attachments-upload.test.ts`
- [X] T065 [US6] Test: claiming at creation — own pending uploads are attached and their expiry cleared. Another customer's, an expired or an already-claimed upload → `unknown_upload`. More than 30 MB together → `submission_too_large`. With `returns.proof_of_purchase_required` on, a no-order complaint without a `proof_of_purchase` attachment → `RETURN_PROOF_OF_PURCHASE_REQUIRED`, while an order case is unaffected — `it/attachments-upload.test.ts`
- [X] T066 [P] [US6] Test: file access. The filer and a member holding `returns.view_organization` get the bytes with `nosniff`, `attachment` disposition and `private, no-store`. Another customer, a signed-out caller and a mismatched case/attachment pair get 404. An admin with `returns:read` gets it; an admin without gets 403. Legacy `asset_id` rows are neither listed nor served — `it/attachments-access.test.ts`
- [X] T067 [US6] Impl: sniffing and the attachment service (store through `objectStoragePort.getActive()`, read and delete through `getForBackend`, claim, list, stream) — `rt/src/backend/services/attachment-sniff.ts`, `rt/src/backend/services/return-attachment-service.ts`
- [X] T068 [US6] Impl: multipart routes in a child context of their own (as `crm`'s `routes.attachment-upload.ts`), plus the customer and admin file routes — `rt/src/backend/routes.uploads.ts`, `rt/src/backend/routes.customer.ts`, `rt/src/backend/routes.admin.ts`, `rt/src/backend/index.ts`
- [X] T069 [US6] Impl: claim and proof rule inside `return_case.create`; attachments on the detail (customer and admin) — `rt/src/backend/services/return-case-service.ts`

### WP B-5 — Clauses (US7)

- [X] T108 [P] [US7] Test (D-1): `clausesFor({ channel, kind, orderId, customer })` returns the active clauses of the channel (and the channel-less ones) whose `appliesTo` matches the kind, ordered by weight. For a submission that `isConsumerWithdrawal` classifies as a consumer's withdrawal it returns **no** `must_accept` clause and keeps the `inform_only` ones. It returns nothing for a kind no clause applies to — `rt/src/backend/services/return-clause-service.test.ts`
- [X] T109 [P] [US2] Test (D-11): `transactionalEmailStatePort.isActive(code)` answers `true` for an active e-mail, `false` for a deactivated one and for an unknown code — `packages/modules/transactional_emails/src/backend/services/transactional-email-state.test.ts`
- [X] T110 [US2] Impl: `TransactionalEmailStatePort` in contracts, its service in `transactional_emails`, and `ctx.di.providePort('transactionalEmailStatePort', …)` — `ct/transactional-emails.ts`, `packages/modules/transactional_emails/src/backend/services/transactional-email-state.ts`, `packages/modules/transactional_emails/src/backend/index.ts`
- [X] T070 [US7] Test: clause CRUD.
  - Commands are audited without the text or URL.
  - A label or text missing the default language → `default_language_required`.
  - A non-https `linkUrl` is refused.
  - Defaults are `appliesTo: 'both'` and `mode: 'must_accept'`.
  - `revision` increments on an edit of label, text, link, `appliesTo` or `mode`, and not on a weight edit.
  - `returns:read` reads; `returns:write` writes.

  — `it/clauses.test.ts`
- [X] T071 [US7] Test: acceptance on order and no-order submissions alike:
  - a missing `must_accept` tick → `clause_not_accepted`;
  - a stale revision in `shownClauses` → `clauses_changed`;
  - an extra id → `clauses_changed`;
  - a complaint-only clause is not expected on a return;
  - a consumer withdrawal with a returns `must_accept` clause configured submits **without** any acceptance (D-1);
  - an `inform_only` clause is stored with `mode` and no tick;
  - with no clause configured the form posts as before.

  The stored copy (every clause shown, with `mode`, text and `linkUrl` as shown) is in the submission language with fallback, and survives an edit and a delete of the clause; `clausesAcceptedAt` is set — `it/clauses.test.ts`
- [X] T072 [P] [US7] Test: `GET /api/v1/returns/form-config?kind=&orderId=` answers:
  - the channel's toggles;
  - `confirmationEmailEnabled` following the `return_submitted` e-mail's active flag (D-11);
  - `today` in `returns.time_zone`, distinct from the server's UTC date near midnight (D-12);
  - the clauses of `clausesFor` in the request language;
  - the limits.

  An unreadable `orderId` answers 404 — `ctt/form-config.contract.test.ts`
- [X] T073 [US7] Impl: clause service with `clausesFor` and the Commands, the admin routes, `form-config` (resolving `transactionalEmailStatePort` and the time zone), and the acceptance check in `return_case.create` using the same `clausesFor` — `rt/src/backend/services/return-clause-service.ts`, `rt/src/backend/routes.admin.ts`, `rt/src/backend/routes.customer.ts`, `rt/src/backend/services/return-case-service.ts`
- [X] T074 [P] [US7] Test (D-10): the clauses page.
  - It lists in a `ResponsiveTable` with columns label, channel, applies to, mode, active, revision and updated, with a "Missing: pl" marker.
  - It creates and edits in a `ModalDialog` with `ContentLanguageTabs` (label `Input`, text `Textarea` with counter, link URL), `SalesChannelPicker`, applies-to, mode, active `Checkbox` and weight.
  - The default-language error switches tab and focuses the field.
  - Editing an active clause warns that a new revision will be created.
  - Delete goes through a `ConfirmDialog`.
  - The empty state is shown.

  — `adm/ReturnClausesPage.test.tsx`
- [X] T075 [US7] Impl: `ReturnClausesPage`, its route in the admin entry, and the API client — `rt/src/admin/pages/ReturnClausesPage.tsx`, `rt/src/admin/index.ts`, `rt/src/admin/api/returns-client.ts`

### WP B-6 — Settlement of an off-platform case (US8)

- [X] T076 [US8] Test:
  - On an off-platform case in `received`, the prefill offers `replacement`, `repair` and `settled_outside` (default `repair`). `refund`, `credit` and `createCorrectiveInvoice: true` → `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`.
  - **D-5:** on an off-platform case still in `authorized`, the prefill is served and offers only `settled_outside`. Settling it with a note moves the case to `resolved` with the default graph (which has no `authorized → resolved` edge). The before-guards, events and audit run.
  - A plain `/transition` from `authorized` to `resolved` is still refused, for both case kinds.
  - On an unauthorized, settled or terminal case, `settled_outside` → 409.
  - `settled_outside` without a note → `resolution_note_required`. With a note it settles, reaches no payment/invoice/credit port, writes no refund row, and audits `hasNote` without the text.
  - On an order case, `settled_outside` → `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`.

  — `it/off-platform-settlement.test.ts`
- [X] T077 [US8] Impl: the no-order branch of the settlement service, and the settlement-only `viaOutsideSettlement` option of `ReturnTransitionService.apply` (research R-19), usable by that one call site only — `rt/src/backend/services/return-settlement-service.ts`, `rt/src/backend/services/return-transition-service.ts`
- [X] T078 [P] [US8] Test: the settlement card renders for an off-platform case from `authorized` on (D-5) with the options the prefill gives. It explains why refunds are absent; hides the payment method, the amounts and the corrective-invoice box; requires the note for `settled_outside`, with the error under the field and focus moved there; and shows the note on the Case card after settling — `adm/ReturnDetail.offPlatformSettlement.test.tsx`
- [X] T079 [US8] Impl: settlement card reachability, resolution options from the prefill, note field — `rt/src/admin/components/ResolutionRadioGroup.tsx`, `rt/src/admin/pages/ReturnDetail.tsx`

### WP B-7 — List, saved views, export, admin detail (US8)

- [X] T080 [US8] Test:
  - `origin=off_platform` lists exactly the order-less cases and excludes a case against an ERP-imported order; `origin=platform` lists the rest.
  - The export carries `offPlatform`.
  - Every summary row carries `productLabel` (the first line's name), `lineCount`, and `purchaseDate` (null on order cases) (D-3), read in one query per page.
  - The detail carries `personalDataErasedAt` (D-8).

  — `it/list-and-bulk.test.ts` (extend)
- [X] T081 [P] [US8] Test: the list marks off-platform rows with text and icon, not colour alone, and shows `—` with "Not applicable" in the refund cell. The origin filter shows a chip, is saved and restored by a saved view, and is **not** written to the URL (D-6) — `adm/ReturnsList.offPlatform.test.tsx`
- [X] T082 [P] [US8] Test: the detail of an off-platform case shows the purchase, contact, address, attachments (with open links) and the shown clauses with their mode and link, and no order link. After erasure it shows "erased on {date}" in the contact and attachments cards (D-8) — `adm/ReturnDetail.offPlatform.test.tsx`
- [X] T083 [US8] Impl: the `origin` filter in the list service and the saved-view filter set; `offPlatform` in the export; `productLabel`/`lineCount`/`purchaseDate` on the summary; `personalDataErasedAt` on the detail — `rt/src/backend/services/return-list-service.ts`, `rt/src/backend/services/return-list-view-service.ts`, `rt/src/backend/services/return-export-service.ts`, `rt/src/backend/services/return-case-service.ts`
- [X] T084 [US8] Impl: list marking and filter; detail blocks — `rt/src/admin/pages/ReturnsList.tsx`, `rt/src/admin/pages/ReturnDetail.tsx`

### WP B-8 — Erasure and maintenance (FR-B43)

- [X] T085 Test: `customer_account.anonymized.v1` runs `return_case.erase_personal_data`:
  - On the account's cases, `contact` and `returnAddress` are nulled and `personal_data_erased_at` is set.
  - Their attachments' objects and rows are deleted, and so are the account's pending uploads.
  - Lines, purchase data and comments stay.
  - The audit entry carries counts and field names only.

  The maintenance sweep:
  - erases the cases of an account anonymised while `returns` was off;
  - deletes expired unclaimed uploads (object first, then row);
  - is idempotent.

  — `it/erasure.test.ts`
- [X] T086 Impl: erasure service and Command; subscriber through `ctx.subscribe`; `returns-maintenance` repeatable job (daily) through `ctx.worker`, modelled on `forms-maintenance-worker.ts` — `rt/src/backend/services/return-erasure-service.ts`, `rt/src/backend/workers/returns-maintenance-worker.ts`, `rt/src/backend/index.ts`

### WP B-9 — Storefront (US5, US6, US7)

- [X] T087 [US5] **Apply `design-review.md`**: read `specs/180-off-platform-complaints/design-review.md` (written by `endora-commerce-designer`; do not edit it) together with the owner's rulings on it (spec *Clarifications*, session "design review"; plan § *Design review rulings*). Build T088–T094 and T111–T114 to Part 2 of the review where the rulings do not override it. The rulings win on: D-1 `inform_only` (not `inform`), no origin scope; D-2 (initial status not disabled); D-6 (no URL sync); clause links allowed; no processing-time sentence. Raise any other conflict with the architect — `specs/180-off-platform-complaints/design-review.md`
  - *2026-11-14, owner ruling — reversal of deviation 6.1:* the no-order form's product field is the design review's combobox after all (`sf/components/returns/ProductField.tsx`, used by `OffPlatformLines`): it searches `GET /api/v1/search/suggest` for the request channel with `SearchAutocomplete`'s keyboard model, sets a hidden `lines.N.productId` on a choice and clears it when the text is edited, and stays a plain model-name field without JavaScript. An `unknown_product` refusal comes back on that line, its name kept as a typed model. Tests: `sf/test/account/returns-product-field.test.tsx`, plus additions to `returns-submit-route.test.ts` and `returns-off-platform.test.tsx`. Deviations 6.2 (one prefilled address) and 6.3 (per-field 30 MB budget) stand.
- [X] T111 [P] [US5] Test (D-18): `AddressFields` renders labelled, server-renderable inputs (street, postcode, city, country, company, phone) with `autoComplete`, `aria-invalid`/`aria-describedby` on error, and a field prefix; `AddressForm` renders the same markup as before through it — `sf/test/account/address-fields.test.tsx`
- [X] T112 [US5] Impl (D-18): extract `AddressFields` from `AddressForm` and use it there; do **not** reuse checkout's `NewAddressFields` — `sf/components/account/AddressFields.tsx`, `sf/components/account/AddressForm.tsx`
- [X] T088 [P] [US5] Test: the no-order path and its form.
  - The new-case page offers "Bought it somewhere else? File a complaint without an order" only while `offPlatformComplaintsEnabled`; `?origin=elsewhere` falls back to step 1 when it is off.
  - The no-order form renders without JavaScript with numbered fieldsets:
    - a product field (combobox with JS, `modelName` without), quantity, reason (preselected when only one applies), description, serial number;
    - the purchase date with `max={today}` (D-12) and the purchase number;
    - contact and address prefilled from `getMe` and the organization's delivery addresses through `AddressFields`, with the line "changes apply to this complaint only";
    - the clause section with `must_accept` checkboxes (never pre-ticked), `inform_only` text without a checkbox, and the optional "full terms" link opening in a new tab (D-1, owner ruling).
  - It is `noindex`.
  - **D-14:** a signed-out visit redirects to `/login?next=` with the full path **and query**.

  — `sf/test/account/returns-off-platform.test.tsx`
- [X] T089 [P] [US5] [US6] Test: `POST /returns/submit`:
  - uploads each file part, then creates the case with the upload ids, `shownClauses`/`acceptedClauses` and the submission key, and answers 303 to `/returns/{id}?submitted=1`;
  - on a refusal, answers 303 back with the typed answers (no files) in a path-scoped, short-lived attempt cookie, and keeps the already-accepted upload ids;
  - **D-15:** a post with no selected or filled line is a refusal with an error-summary entry, on both the order and the no-order path, never a silent redirect;
  - **D-9:** a body over 30 MB is refused before reading, with a 303 to the form carrying `error=too_large` and no cookie;
  - forwards the session, never a channel or organization field.

  — `sf/test/account/returns-submit-route.test.ts`
- [X] T090 [P] [US6] Test: `POST /returns/uploads` (JS path) and `POST /returns/[id]/attachments` (no-JS add) forward one file with the session; `GET /returns/[id]/attachments/[attachmentId]` streams the backend response and passes 404 through — `sf/test/account/returns-attachment-routes.test.ts`
- [X] T091 [P] [US6] [US7] Test: the attachment field and the case page.
  - **Attachment field:** shows type by control, limits, budget, progress (JS) and the refusal copy. It never uses `capture`, and lists explicit MIME types.
  - **D-9:** the over-30 MB error summary renders the exact en/pl copy of research R-13.
  - **Case page:**
    - the title is the RMA number, else "Complaint {reference}" (D-4);
    - attachments are listed with download links and an *Add attachment* form;
    - the off-platform block replaces an order reference;
    - no refund column for off-platform cases;
    - the shown clauses are in `<details>`.
  - **Success panel (FR-B37) after `?submitted=1`:**
    - names the reference;
    - says "A confirmation is on its way to {email}" **only** when `confirmationEmailEnabled` (D-11);
    - contains no processing-time sentence.

  — `sf/test/account/returns-case-page.test.tsx`
- [X] T113 [P] [US5] Test (D-3, D-4): the customer's returns list uses `reference` as the link text (never `—`), shows `productLabel` with "+N more" from `lineCount`, the purchase date and "Bought elsewhere" for off-platform rows, and `—` with "Not applicable" in the refund cell for them — `sf/test/account/returns-list.test.tsx`
- [X] T114 [P] [US6] Test: the pure attachment helpers — per-file and total limits, MIME check, byte formatting, the "3 of 10 files · 12.4 of 30 MB" budget — `sf/test/account/returns-attachments-lib.test.ts`
- [X] T092 [US5] [US6] [US7] Impl: route handlers on the `storefront/app/forms/submit/route.ts` pattern, including the D-9 and D-15 outcomes — `sf/app/returns/submit/route.ts`, `sf/app/returns/uploads/route.ts`, `sf/app/returns/[id]/attachments/route.ts`, `sf/app/returns/[id]/attachments/[attachmentId]/route.ts`
- [X] T093 [US5] [US6] [US7] Impl: pages and components per design-review Part 2 (R-1 … R-3) as overridden by the rulings: the entry point, the no-order form, the error summary, the success panel, the case page, the customer list, the login redirect (D-14). Limit and budget logic go in pure functions — `sf/app/(account)/returns/page.tsx`, `sf/app/(account)/returns/new/page.tsx`, `sf/app/(account)/returns/[id]/page.tsx`, `sf/components/returns/{OffPlatformLines,AttachmentField,ClauseList}.tsx`, `sf/lib/api/returns.ts`, `sf/lib/returns/{returnForm,attachments}.ts`- [X] T094 [US5] Impl: en + pl storefront messages for every new string; `pnpm --filter backend run i18n:hardcoded` clean for the storefront ledger — `sf/lib/i18n/messages/core.ts`

### WP B-10 — Manifest, docs, release, presence

- [X] T095 Test: the manifest declares the two boolean settings, `assets_library` and `catalog` in `dependencies`, the `return-clauses` palette action (`returns:read`), and the five error codes. Every `errors.<CODE>` has en and pl sentences — `rt/src/manifest.test.ts` (extend)
- [X] T096 Impl: manifest (contracts/settings-emails-events.md §1, §4, §6, §8), keys in `rt/i18n/{en,pl}.json` (settings labels, palette action, error sentences, admin strings of B-5 … B-7); then `composer:generate`, `pnpm run manifests:generate`, `pnpm install --lockfile-only` — `rt/src/manifest.ts`, `rt/i18n/en.json`, `rt/i18n/pl.json`, generated artefacts
- [X] T097 Test: with `returns` off, the new customer routes, the file routes, the clause admin routes, both workers and the anonymisation subscriber are absent; the storefront hides the form. Restoring the module restores them, and the erasure reconciliation then catches up — `it/off-state.test.ts` (extend)
- [X] T098 [P] Docs (EN): sections *Complaints without a platform order*, *Attachments*, *Clauses*, *Settling an off-platform case*, and the new settings — `rt/docs/returns.md`
- [X] T099 [P] Docs (PL): the same sections — `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/returns.md`
- [X] T100 Changeset (one for the MR): `@endora-commerce/contracts` minor, `@endora-commerce/mod-returns` minor and `@endora-commerce/mod-transactional-emails` minor (the new `transactionalEmailStatePort`). The body covers both phases and states the removal of `attachmentAssetIds` and of the JSON `{ assetId }` attachment body: the old call, the new call (upload, then `attachments: [{ uploadId }]`; multipart on `/:id/attachments`), and why (unusable, unchecked). Add an upgrade note for legacy `asset_id` rows. Run `check:release-intent` — `.changeset/180-returns-notifications-off-platform-complaints.md`

---

## Final phase — Verification

- [X] T101 Grep `backend/test/**`, `admin/**`, `storefront/**` and `packages/**` for every removed or renamed name: `attachmentAssetIds`, `addReturnAttachmentRequestSchema`'s asset shape, the asset-shaped `returnAttachmentSchema`, and any moved file of `rt`. Also re-derive anything derived from a moved file's location (AGENTS.md trap 3) — repository root
- [X] T102 Run the check estate relevant to the change and fix every finding:
  - `pnpm run check:naming && pnpm run check:language`;
  - `i18n:hardcoded`, `check:bundle-pairing`, `check:error-translations`;
  - `check:command-coverage`, `check:module-boundary`, `check:port-dependencies`, `check:port-catches`, `check:off-state-coverage`, `check:queue-names`, `check:subscribe-seam`;
  - `check:action-route-permissions`, `check:admin-surface`, `check:module-docs`, `check:docs-translations`, `check:release-intent`, `check:test-ownership`, `check:rsc-discipline`, `check:storefront-indexability`.

  Confirm the generated artefacts are fresh (`composer:generate` and `manifests:generate` leave no diff; `pnpm install --frozen-lockfile` passes) — repository root
- [ ] T103 Final verification:
  - `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`;
  - `pnpm --filter backend run test:unit:fast`;
  - every integration and contract file named in this list, run locally against `dev:infra:test`;
  - `pnpm --filter '!backend' run test`, which covers `contracts`, `mod-returns`, `mod-transactional-emails`, admin and storefront;
  - the quickstart.md walkthrough (both phases) on `pnpm run dev`.

  Paste the outputs into the MR description — repository root

---

## Dependencies

- **Setup (T001–T002)** → phase A.
- **Phase A:** A-1 (T003–T006) blocks A-2 … A-6. A-2 blocks A-3, A-5 and A-6. A-4 blocks A-5. A-7's gate (T041) blocks all of phase B.
- **Phase B:**
  - B-1 (T042–T046) and B-2 (T047–T053) block everything after them.
  - B-3 blocks B-4's claim (T065, T069), B-5's acceptance (T071, T073) and B-6.
  - B-4 and B-5 can proceed in parallel once B-3's Command exists.
  - B-7 needs B-3 and B-4 (detail blocks).
  - B-8 needs B-2 and B-4.
  - B-5's `form-config` (T073) needs T110 (the state port).
  - B-9 needs B-1 … B-5 (the API it calls). T087 (design review) precedes T088–T094 and T111–T114, and T112 (`AddressFields`) precedes T093.
  - B-10 follows B-1 … B-9.
- **Final phase** follows B-10.
- **User stories:** US1 and US2 share the pipeline (A-4, A-5); US3 shares it and A-6; US4 is A-2, A-3, A-6. US5 is the base of US6, US7 and US8 (the case without an order must exist first).

## Parallel opportunities

| WP | Parallel tasks | Why they don't collide |
| --- | --- | --- |
| A-1 | T104 beside T003–T005 | T003–T005 share `ct/returns.test.ts`, so they are sequential (not [P]); T104 is `case-reference.test.ts` |
| A-2 | T009, T010 | two entity files |
| A-4 | T014, T015, T016, T017 | four new test files |
| A-5 | T022, T023, T024 | separate integration files (T022's two files are its own) |
| A-6 | T028, T029, T030, T031, T106 | four new admin test files and one integration file |
| A-7 | T039, T040 | EN and PL doc files |
| B-1 | — | T043–T045 share `ct/returns.test.ts`, so they are sequential |
| B-2 | T049, T050, T051, T052 | four entity files (T052 also registers the entity in `index.ts`, which no other [P] task of B-2 touches) |
| B-4 | T063, T066 (and T064 → T065 in sequence beside them) | `attachment-sniff.test.ts` and `attachments-access.test.ts` are disjoint; T064 and T065 share `attachments-upload.test.ts` |
| B-5 | T108, T109, T072, T074 (and T070 → T071 in sequence beside them) | a `returns` unit file, a `transactional_emails` unit file, a contract file and an admin file are disjoint; T070 and T071 share `clauses.test.ts` |
| B-6/B-7 | T078, T081, T082 | three admin test files |
| B-9 | T111, T088, T089, T090, T091, T113, T114 | seven storefront test files |
| B-10 | T098, T099 | EN and PL doc files |

Across WPs, once T046 and T053 are done, B-4 (attachments) and B-5 (clauses) are independent
streams; both touch `return-case-service.ts` only in their last implementation task (T069, T073),
which must therefore be done one after the other.

## Implementation strategy

1. **Phase A is the first increment** (US1–US4, all P1/P2): at T041 the branch carries working
   notifications and the authorizer, verified and green, even though it ships only with phase B.
2. **Phase B** builds US5 (the no-order case) first (B-1 … B-3). US6 and US7 (attachments,
   clauses) follow in parallel, then US8 (settlement, list) and erasure. The storefront is last,
   after the design review.
3. One changeset, one MR, opened once T103 is complete.

## Requirement → task traceability

| FR | Test task(s) | Impl task(s) |
| --- | --- | --- |
| FR-A01 (and US1 s2, D-7) | T014, T022, T106, T028 | T018, T037, T107, T034 |
| FR-A02, FR-A05 | T016, T017, T022 | T018, T019, T025 |
| FR-A03, FR-A04 | T015, T022 | T018, T037 |
| FR-A10, FR-A11 | T016, T017, T022 | T018, T019, T025 |
| FR-A20 | T016, T023 | T026 |
| FR-A21 (and D-16, D-17) | T003, T023, T029 | T006, T034, T035 |
| FR-A22 | T023 | T026 |
| FR-A30 | T004, T013, T028 | T006, T010, T013, T034 |
| FR-A31 (incl. D-2, D-13) | T024, T028 | T027, T034 |
| FR-A32 | T011, T024 | T012, T027 |
| FR-A33 | T024 | T027 |
| FR-A40 | T011 | T012 |
| FR-A41 | T005, T030, T031, T032 | T006, T033, T034 |
| FR-A42 | T030, T032 | T033 |
| FR-A43 | T007 | T008 |
| FR-A44 | T005, T104, T016, T017, T031, T032, T091, T113 | T006, T105, T018, T019, T033, T034, T093 |
| FR-A50, FR-A51 | T016, T020 | T018, T021 |
| FR-A52 | T013 (audited status write) | T013, T037 |
| FR-B01, FR-B02 | T055, T088, T097 | T059, T062, T093, T096 |
| FR-B10, FR-B11 | T043, T047, T056 | T046, T048, T059 |
| FR-B12, FR-B13, FR-B14 (incl. D-12) | T043, T056, T072, T088 | T059, T073, T093 |
| FR-B15 | T054, T056 | T059, T061 |
| FR-B16, FR-B17 (incl. D-18) | T056, T082, T088, T091, T111 | T059, T084, T093, T112 |
| FR-B20 (incl. D-9) | T063, T064, T065, T089, T090, T091, T114 | T067, T068, T092, T093 |
| FR-B21 | T065 | T069 |
| FR-B22 | T066, T053 | T067, T068 |
| FR-B23 | T066, T082, T091 | T069, T084, T093 |
| FR-B24 | T043, T065 | T046, T069 |
| FR-B30 (incl. D-1, D-10, link) | T044, T070, T071, T072, T074, T108, T088 | T046, T073, T075, T093 |
| FR-B31, FR-B32 | T071 | T073 |
| FR-B33, FR-B33a (incl. D-5) | T045, T076, T078 | T077, T079 |
| FR-B34, FR-B35 (incl. D-6) | T080, T081 | T083, T084 |
| FR-B36 (incl. D-3) | T045, T080, T091, T113 | T046, T083, T093 |
| FR-B37 (incl. D-11) | T044, T072, T091, T109 | T046, T073, T093, T110 |
| FR-B40 | T057 (one `case_submitted` job per no-order filing), T022 (end to end) | T060 |
| FR-B41 | T035, T094, T095, T102 | T035, T094, T096 |
| FR-B42 | T058, T076 | T059, T077 |
| FR-B43 (incl. D-8) | T085, T080, T082 | T086, T083, T084 |
| D-14, D-15 (implementation fixes) | T088, T089 | T092, T093 |
