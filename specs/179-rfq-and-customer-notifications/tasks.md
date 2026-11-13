# Tasks: Quote request notification delivery and the storefront notification centre

**Input**: [spec.md](./spec.md), [plan.md](./plan.md) (WP-01 … WP-12, phases 1–4),
[research.md](./research.md) (R-1 … R-23), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

**Tests are mandatory** (constitution III, NN): within every work package the failing-test task
comes first and is shown red in the MR description before the implementation task turns it green.
Contract and integration files do not run on merge requests (D-198): run them locally against
`pnpm run dev:infra:test` with `pnpm --filter backend exec vitest run <paths>` and paste the output.

## Format

`- [ ] T### [P?] [WP-nn] [USn?] Description — paths`

- **[P]** — parallel with other [P] tasks of the same WP (disjoint files).
- Abbreviations: `qr` = `packages/modules/quote_requests`, `cn` =
  `packages/modules/customer_notifications`, `pwa` = `packages/modules/pwa`, `contracts` =
  `packages/contracts/src`, `sf` = `storefront`.

## Standing obligations of every WP (not repeated)

- `pnpm run build:packages` after editing a package; typecheck + lint of every workspace touched;
  targeted tests; `pnpm --filter '!backend' run test` when a package other than `backend` changed.
- Before finishing, grep `backend/test/**` for every deleted path (AGENTS.md traps).
- Re-record a read size only if a check refuses it (`specs/conventions/check-estate.md`).
- A changeset per published package changed (`specs/conventions/release-intent.md`).
- Branch per WP off `origin/master`, `git commit -s`, PR to `master`.

---

## Phase 1 — Delivery core (US1, US2, US5)

### WP-01 Contracts (blocks everything)

- [x] T001 [P] [WP-01] Test: `customerNotificationListResponseSchema`, `customerNotificationSchema`, unread-count schema parse/strict cases — `contracts/customer-notifications.test.ts`
- [x] T002 [P] [WP-01] Test: `quoteRequestDeliverySchema` and an entry with and without `deliveries` — `contracts/quote-requests.test.ts`
- [x] T003 [WP-01] Impl: `contracts/customer-notifications.ts` (port types + schemas, `contracts/delivery-and-ports.md` §1, storefront API §2), `CustomerPushPort` types in `contracts/pwa.ts` (§2), `quoteRequestDeliverySchema` + optional `deliveries` in `contracts/quote-requests.ts` (§4); export from the barrel; changeset `@endora-commerce/contracts` minor

### WP-02 Table redesign (`qr`)

- [x] T010 [WP-02] Test: migration up creates `quote_request_notifications` with every constraint of data-model §1 and drops `quote_request_notification_events`; down reverses — `backend/test/integration/quote_requests/notifications-migration.test.ts`
- [x] T011 [WP-02] Test: `notification-matrix.ts` equals the table of `contracts/notification-matrix.md` §1 (rows, channels, actor rule, completed = none) — `qr/src/backend/services/notifications/notification-matrix.test.ts`
- [x] T012 [WP-02] Impl: scaffold the migration with `pnpm --filter backend run migration:new` in `qr`; entity `quote-request-notification.entity.ts` (`@OrgScoped`); delete `quote-request-notification-event.entity.ts`; `notification-matrix.ts`; rewrite `rfq-notification-service.ts` as `record(within, { change, sourceEvent, rfq, actor })` writing one row per matrix cell (no non-transactional path); `composer:generate`
- [x] T013 [WP-02] Grep `backend/test/**` and `packages/**` for `quote_request_notification_events` / `QuoteRequestNotificationEvent` and update every reference (docs excepted, WP-11)
  - *WP-02 as built (for WP-03/WP-04):* `record` resolves sides through an injected
    `NotificationRecipientResolver`; until WP-03 it is `notifications/assignment-recipients.ts`,
    the pre-179 rule unchanged (requester; assigned representatives, else every administrator).
    The writers still call `record(em, …)` after `underRowLock` commits, on the request's own
    EntityManager — WP-04 moves each call inside the lock. `RECORDED_CHANNELS` holds
    `customer_in_app` (WP-08) and `customer_push` (WP-10) back; their matrix cells stand. The order
    completion reactor no longer has a notification service (completed = none).

### WP-03 Recipients (`qr`)

- [ ] T020 [P] [WP-03] [US2] Test: customer side — requester; *Administrator* member included; *Member* holding `quote_requests.create` excluded; blocked, deleted, anonymised excluded; requester who is also administrator counted once; personal Organization = requester only — `qr/src/backend/services/notifications/recipients.test.ts`
- [ ] T021 [P] [WP-03] [US1] Test: operator side — assignee ∪ assigned representatives; one without `rfqs:handle` dropped; inactive dropped; empty → every active admin holding `rfqs:handle` (wildcard role included), none without it — same file
- [ ] T022 [WP-03] Test: `#seesOrganization` and the recipient rule both call `orgWideViewerRoleIds` (one spy, two callers) — `qr/src/backend/services/rfq-scope-visibility.test.ts`
- [ ] T023 [WP-03] Impl: `recipients.ts` (`customerSide`, `operatorSide`, `orgWideViewerRoleIds` via `organizationRoleReadPort.predefinedRoleId(org, 'administrator')`), `rfq-service.ts` `#seesOrganization` re-pointed; wire `organizationRoleReadPort`, `customerAccountReadPort.listByOrganization`, `permissionService` in `qr/src/backend/index.ts`

### WP-04 Recording inside the transaction (`qr`)

- [ ] T030 [WP-04] [US1] [US2] Test, one case per writer (submit, re-submit, accept offer, reject offer, operator approve, cancel, modify, create on behalf, expiry, order completion): the change, its source history entry and its records commit together; a failure injected after the records rolls back all three; completion writes no record — `backend/test/integration/quote_requests/notification-recording.test.ts`
- [ ] T031 [WP-04] Test: a kick is added after commit; a failing `queue.add` logs and the transition still answers 200 — `qr/src/backend/services/notifications/kick.test.ts`
- [ ] T032 [WP-04] Impl: in `rfq-service.ts` (`createForCustomer`, `resubmit`, `respondToRevision`), `rfq-admin-service.ts` (`approve`, `cancel`, `modify`, `createOnBehalf`) move the notifying `eventService.append(…, em)` and `notificationService.record(em, …)` inside the `underRowLock` change; `order-completion-reactor.ts` wraps status + history + records in `em.transactional`; `rfq-expiry-worker.ts` switches to `record`; update the header comment of `transition-lock.ts`; remove `notifyInternalSide`; add the kick

### WP-05 Worker, e-mail and bell (`qr`)

- [ ] T040 [P] [WP-05] Test: delivery-service — stale (>24 h) closes `skipped_stale` without calling an adapter; owner absent closes `skipped_module_off`; `ModuleDisabledError` from a port closes `skipped_module_off`; other error → attempt+1 with the 1 m/5 m/30 m/2 h ladder; fifth failure → `failed` with truncated error; closed record untouched — `qr/src/backend/services/notifications/delivery-service.test.ts`
- [ ] T041 [P] [WP-05] [US1] Test: `admin_in_app` adapter calls `recordWithin` on the record's EM with the contract §2 shape (number-only title, `titleMessage`, link `/quote-requests/<id>`); re-checks `rfqs:handle` — `channel-adapters.test.ts`
- [ ] T042 [P] [WP-05] [US2] Test: e-mail adapters — code per change, `messageId = quote_request_notification:<id>`, customer language = channel default (`en-US` fallback), operator language = preferred (English fallback), `quote.url` from `storefront_url` or empty, no attachment on approval, outcome mapping of matrix §4, no address → `skipped_no_recipient` — `channel-adapters.test.ts`
- [ ] T043 [P] [WP-05] Test: eleven definitions × en/pl defaults exist, every declared variable is used by both languages' content, subjects non-empty — `qr/src/backend/email-templates/quote-notification-defaults.test.ts`
- [ ] T044 [WP-05] Test: worker tick — idle probe outside scope enters no scope; busy tick enters the system scope once; two concurrent ticks never claim one record; registered through `ctx.worker` (off → no processing) — `qr/src/backend/workers/rfq-notification-delivery-worker.test.ts` + integration case in `backend/test/integration/quote_requests/notification-delivery.test.ts`
- [ ] T045 [WP-05] Test (integration): crash between a transport's acceptance and the commit → the retry is suppressed by `messageId`, one e-mail total — `notification-delivery.test.ts`
- [ ] T046 [WP-05] Impl: `delivery-service.ts`, `channel-adapters.ts` (three adapters of this phase), `rfq-notification-delivery-worker.ts`, scheduler + kick queue in `qr/src/backend/index.ts`; `email-templates/quote-notification-defaults.ts` pushed via `emailDefaultsPort` in the boot hook; eleven `transactionalEmails` entries and the `degrades-without admin_notifications` edge in `qr/src/manifest.ts`; `notifications.<change>.title` keys in `qr/i18n/{en,pl}.json`

### WP-06 History deliveries (`qr`, admin)

- [ ] T050 [WP-06] [US5] Test (contract): admin history entries carry `deliveries` (recipient display name, channel, status, attempts, last error, closedAt) grouped by `eventIds`; customer `GET /api/v1/quote-requests/:id` carries none — `backend/test/contract/quote_requests/history-deliveries.test.ts`
- [ ] T051 [WP-06] [US5] Test: `RfqHistory.tsx` renders a delivery list under an entry with a status label and the error behind a disclosure for `failed` — `qr/src/admin/pages/RfqHistory.test.tsx`
- [ ] T052 [WP-06] Impl: history projection reads records by `source_event_id`, resolves display names in one batched read per side; admin screen; `rfq.detail.history.delivery.*` keys (en, pl) in the `core` bundle

---

## Phase 2 — Customer notification centre (US3)

### WP-07 Module `customer_notifications` (`cn`)

- [x] T060 [WP-07] Test: port — `recordWithin` persists on the caller's EM without flush; refuses absolute / protocol-relative links, `bodyMessage` without `body`, non-scalar params; `record` with an existing `(sourceModule, sourceKey)` answers the existing entry — `cn/src/backend/services/customer-notification-port.test.ts`
- [x] T061 [WP-07] Test: list/count/read/read-all — own entries only; channel = resolved channel or null; producer absent hidden; keyset paging stable; translated in the request language with English fallback; impersonation writes nothing; `404` for another account's id — `cn/src/backend/services/customer-notification-service.test.ts` + `backend/test/contract/customer_notifications/storefront-api.test.ts`
- [x] T062 [WP-07] Test: retention sweep deletes entries older than the setting in batches; deletes entries of deleted/anonymised accounts; idle tick enters no scope — `cn/src/backend/workers/retention-sweep-worker.test.ts`
- [x] T063 [WP-07] Test: module off → routes `503 MODULE_DISABLED`, worker idle, port gate closed — `backend/test/integration/customer_notifications/off-state.test.ts`
- [x] T064 [WP-07] Impl: package scaffold (`package.json` `@endora-commerce/mod-customer-notifications`, tsconfigs, README, LICENSE, CHANGELOG), `manifest.ts` (activation, settings of data-model §3, dependencies `_i18n`, `auth`, `settings`, `customer_accounts`, `i18n`, `docs`), entity, init migration via `migration:new`, service, port provided with `ctx.di.providePort('customerNotificationRecordPort', …)`, `routes.storefront.ts` via `ctx.routes`, retention worker via `ctx.worker`, `i18n/{en,pl}.json` (settings group), `docs/customer-notifications.md` (en; pl in WP-11); add the `Container name: \`customerNotificationRecordPort\`` marker to the port's doc block in `contracts/customer-notifications.ts` (WP-01 left it out: `check:port-shape` refuses a name nothing registers)
- [x] T065 [WP-07] Generated artefacts: `pnpm --filter backend run composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`; commit all; changeset (initial)

### WP-08 `customer_in_app` channel (`qr`)

- [ ] T070 [WP-08] [US3] Test: adapter calls `customerNotificationRecordPort.recordWithin` on the record's EM with `sourceModule 'quote_requests'`, `sourceKey <record id>`, the request's channel, `kind quote_requests.<change>`, `titleMessage customerNotifications.<change>.title`, link `/quote-requests/<id>`; centre absent → `skipped_module_off`; the matrix now writes `customer_in_app` rows — `channel-adapters.test.ts`, `notification-matrix.test.ts`
- [ ] T071 [WP-08] Impl: adapter; `degrades-without customer_notifications` edge; `customerNotifications.<change>.title` keys en/pl in `qr/i18n`

### WP-09a Tablet breakpoint alignment (`sf`) — own MR, before WP-09

- [x] T078 [WP-09a] [US3] Test (SSR/CSS): the tab bar and the drawer trigger render at widths below 877 px and the desktop header rows from 877 px — the class/breakpoint assertions at 767, 768, 876 and 877 px; `--m-tabbar-h` set below 877 px — `sf/test/HeaderBreakpoint.test.tsx` (extended)
- [x] T079 [WP-09a] Impl: align `.m-tabbar` (and the body spacer it drives) and `MegamenuMobileDrawer`'s `md:hidden` to `min-[877px]`; check sticky bars that read `--m-tabbar-h` (PDP, checkout); screenshot 800 px before/after in the MR (done without the dev stack: a Chromium computed-style probe of the compiled CSS at 767/768/800/876/877 px before and after, recorded in the MR; no page screenshot)

### WP-09 Storefront (`sf`)

- [x] T080 [P] [WP-09] [US3] Test (SSR): notifications page — unread label text + semibold row; read row; link rows point at `/account/notifications/<id>/open` with `prefetch={false}`; link-less rows render a *Mark as read* form, not a link; `<time dateTime>` relative under 7 days, absolute after; always-rendered `role="status"`; *Mark all as read* only when unread > 0, disabled with the reason under impersonation; empty state (icon, copy, action only with `quote_requests` + Organization); `?markError=1` error with retry; `Pagination` in cursor mode with "Show older"; push-management footer link; module off → `notFound()` — `sf/test/account/notifications-page.test.tsx`
- [x] T081 [P] [WP-09] [US3] Test (SSR): account pill reuses `.icon-btn__count`, shows `9+` above nine, carries visually hidden "Unread notifications: {count}" after the visible name, initials `aria-hidden`, no `aria-label` on the link, no live region; nothing for 0, a guest, the module absent, or the minimal checkout header; tab bar account tab reuses `.m-tabbar__badge` plus hidden text; drawer footer shows "Notifications (n)" row — `sf/test/header-unread-indicator.test.tsx`
- [x] T082 [P] [WP-09] Test: open route — marks read then `303` to the localised link; still redirects when marking fails; link-less or unknown id → the page; server actions `markRead` / `markAllRead` call `revalidatePath('/', 'layout')` and redirect with `?markError=1` on failure — `sf/test/account/notifications-open-route.test.ts`, `notifications-actions.test.ts`
- [x] T083 [P] [WP-09] Test (SSR): account sidebar lists *Notifications* second with "(n)" when unread > 0; overview summary line when unread > 0; neither when the module is absent — `sf/test/account/account-nav-notifications.test.tsx`
- [x] T084 [WP-09] Impl: `sf/lib/api/customer-notifications.ts`; `app/(account)/account/notifications/{page.tsx,actions.ts,[id]/open/route.ts}`; `app/(account)/layout.tsx` nav entry; `app/(account)/account/page.tsx` summary line; unread count in `app/layout.tsx`; `Header.tsx` `UserPill`, `MobileTabBar.tsx`, `MegamenuMobileDrawer.tsx`; copy in `lib/i18n/messages/account.ts` and `chrome.ts`, en-US + pl-PL; existing badge classes only
- [x] T085 [WP-09] Run the ux-laws §7 checklist over the page and the indicator, check the badge's contrast in light and in `:root.is-dark` (≥ 3:1 component, ≥ 4.5:1 text) and the Polish labels at 360 px, and record the results in the MR
  - *WP-09 as built:* the centre's API has no read of one entry, so the open route finds the
    entry's `linkPath` in the list, starting at the page cursor the row carries (`?cursor=`, the
    allow-listed name) and reading at most five pages of 50; the target is always the stored link,
    re-checked as storefront-relative. The drawer row is covered by a jsdom file beside T081's
    (`sf/test/header-unread-indicator.drawer.test.tsx`), the focus move by
    `sf/test/account/notifications-focus.test.tsx`. The tab bar's account badge is also left out
    on `/checkout` (the tab bar is not part of `HeaderSwitch`). `Pagination` gained an optional
    `label`. T085 results are in the MR description; the dark-scope component contrast of the
    reused badge classes against `--surface` (2.8:1) is reported there, not changed here.

---

## Phase 3 — Push (US4) — one MR

### WP-10 `customerPushPort` and the `customer_push` channel (`pwa`, `qr`)

- [ ] T090 [WP-10] [US4] Test: port — gate order (channel → push on + quote category on → account live → preference → subscription → enqueue); each `skipped:*`; repeated `sourceKey` writes nothing and answers `enqueued` — `pwa/src/backend/services/customer-push-port.test.ts`
- [ ] T091 [WP-10] [US4] Test: `pwa` subscribes to no `rfq.*` event; the composer has no quote branch; the `quoteRequestReadPort` edge is gone — `pwa/src/backend/cross-module-ports.test.ts`, `status-push-composer.test.ts`
- [ ] T092 [WP-10] [US4] Test: `customer_push` adapter renders the sentence in the channel language and maps each outcome (`contracts/delivery-and-ports.md` §3); matrix writes `customer_push` rows; requester and an *Administrator* member both pushed, actor not — `qr/.../channel-adapters.test.ts`, integration `notification-delivery.test.ts`
- [ ] T093 [WP-10] Impl: `pwa/src/backend/services/customer-push-port.ts`, provided as `customerPushPort`; remove quote branch, `QUOTE_STATUS_EVENTS`, the five subscriptions and the edge; update `pwa.push_quote_status_enabled` description; `qr` adapter and `degrades-without pwa` edge; changesets `mod-pwa` minor, `mod-quote-requests`; add the `Container name: \`customerPushPort\`` marker to `CustomerPushPort`'s doc block in `contracts/pwa.ts` (left out in WP-01 for the same reason)

---

## Phase 4 — Close

### WP-11 Documentation and release

- [ ] T100 [P] [WP-11] `qr/docs/quote_requests.md`: rewrite *Notifications* (matrix in prose, recipients, channels, 24 h, History), *What one tick does* expiry wording; Polish page per `docs/docs/contributing/documentation-i18n.md`
- [ ] T101 [P] [WP-11] `cn/docs/customer-notifications.md` en + pl (what buyers see, retention, activation)
- [ ] T102 [P] [WP-11] `pwa/docs/pwa.md` quote push paragraph en + pl
- [ ] T103 [WP-11] Upgrade note (changeset body): old table dropped, rows discarded, eleven new e-mails switched on by default; run `check:module-docs`

- [ ] T104 [WP-11] Follow-up note (not in this feature; owner ruling OQ-1 = A, 2026-11-12): once #185 promotes `ADMIN_BASE_URL`, add the admin link (`quote.adminUrl`) to `quote_request_operator_submitted` and `quote_request_operator_resubmitted`, and the equivalent links to the `crm` and `tasks` e-mails. Record this in the #185 issue and in the changeset's upgrade note

### WP-12 Off-state and end-to-end

- [ ] T110 [WP-12] Integration: walk the full matrix (every change × side × channel) against a seeded Organization with requester, *Administrator* member, *Member*, assigned rep, admin without `rfqs:handle` — `backend/test/integration/quote_requests/notification-matrix-e2e.test.ts`
- [ ] T111 [WP-12] Integration: each receiving module off in turn (`admin_notifications`, `customer_notifications`, `pwa`) → its channel `skipped_module_off`, the others `sent`, no transition fails (SC-007); `quote_requests` off → worker idle, records stay pending, resume on, stale after 24 h
- [ ] T112 [WP-12] Walk `quickstart.md` on `pnpm run dev` and record the result in the MR

## Dependencies

WP-01 → WP-02 → WP-03 → WP-04 → WP-05 → (WP-08 after WP-07) → WP-10 → WP-11/WP-12.
WP-06 after WP-02; WP-07 after WP-01; WP-09a any time; WP-09 after WP-07 and WP-09a. Parallel lanes: {WP-03…WP-05},
{WP-06}, {WP-09a}, {WP-07, WP-09}.
