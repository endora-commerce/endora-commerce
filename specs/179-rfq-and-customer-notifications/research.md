# Research: Quote request notification delivery and the storefront notification centre

**Feature**: `specs/179-rfq-and-customer-notifications/` | **Date**: 2026-11-12

Every decision is written as *decision → rationale → alternatives rejected*. Owner rulings Q1–Q8
are in `spec.md` and are not re-argued here.

## What the tree holds today (measured on `origin/master` 30d3b5f36)

| Fact | Where |
| --- | --- |
| Rows are written to `quote_request_notification_events` (`queued`) and nothing reads them | `packages/modules/quote_requests/src/backend/services/rfq-notification-service.ts`; table created by `src/migrations/20260503T141344_quote_requests_workflow.ts` |
| Eight writers: customer submit, re-submit, accept/reject offer (`rfq-service.ts` `notifyInternalSide`), operator approve, cancel, modify, create on behalf (`rfq-admin-service.ts`), expiry (`rfq-expiry-worker.ts`), order completion (`order-completion-reactor.ts`) | same module |
| Only the expiry writes its rows inside the transition's transaction (`enqueue(…, em)`); every other site appends the history entry and the rows **after** `underRowLock` committed, on connections of their own | `services/transition-lock.ts` (header comment), `rfq-service.ts`, `rfq-admin-service.ts` |
| The operator fan-out falls back to **every** administrator when the Organization has no assigned representative | `rfq-service.ts` `notifyInternalSide`, `rfq-expiry-worker.ts` |
| The expiry sweep already refuses to notify an expiry due more than 24 hours before the tick | `rfq-expiry-worker.ts` (`graceMs`); module page *What one tick does* |
| The admin bell has a published co-transactional port, `AdminNotificationRecordPort.recordWithin` | `packages/contracts/src/admin-notifications.ts`; `tasks`' reminder delivery is the precedent (`specs/165-task-management/` SC-004) |
| E-mail goes through `TransactionalEmailSender.send`, which answers `sent | logged | deactivated | no_transport | no_definition` | `packages/contracts/src/transactional-emails.ts` |
| Notifying Organization members by permission: `listByOrganization` × `rolesHolding` | `packages/modules/carts/src/backend/services/cart-approval-emails.ts` `approverRecipients` |
| Organization-wide RFQ visibility is the *Administrator* role until 170 P3 (`#seesOrganization`) | `rfq-service.ts`; `specs/170-organization-roles/research.md` R-30 |
| **PWA already pushes quote changes** to the requester, from five `rfq.*` events, gated by `pwa.push_quote_status_enabled` and the account's `quoteStatusEnabled` preference | `packages/modules/pwa/src/backend/index.ts`, `services/status-push-composer.ts`, `entities/push-notification-preference.entity.ts` (`specs/149-pwa-order-status-push/`) |
| `push_messages` dedupes on `(trigger, source_event_id)` | `packages/modules/pwa/src/migrations/20260625T144228_pwa_init.ts` |
| Backend string resolution of a module key in a language | `AdminI18nTranslatePort.translate(moduleId, key, language, params)`, `packages/contracts/src/admin-i18n.ts` |
| A sales channel carries `storefront_url` | `packages/contracts/src/sales-channels.ts` |
| An absolute admin URL needs `ADMIN_BASE_URL`, owned by `mfa`; `crm` declined to read it a second time | `packages/modules/crm/src/backend/email-templates/event-reminder-defaults.ts` |
| The storefront header's action cluster holds shopping list, quote draft, compare, cart and the account pill | `storefront/components/Header.tsx` |

## R-1 — Who owns the RFQ delivery records: `quote_requests`

**Decision.** The delivery records, the recipient resolution and the delivery worker belong to
`quote_requests`. The new table is `quote_request_notifications`.

**Rationale.** Who must be told about a quote request, and what each of them was sent, is quote
domain data: the recipient rule is the request's visibility rule (R-3), and the operator reads the
result on the request's own History (FR-070). The channels it delivers through are owned elsewhere
and reached through their published ports. This is the same split `tasks` uses for its reminder
deliveries (`task_reminder_deliveries` owned by `tasks`, bell through `admin_notifications`' port).

**Rejected.**
- *A generic platform notification-delivery module that every producer writes to.* One producer
  today; the recipient and History semantics are per domain; it would be a new module with a
  second, cross-domain table — YAGNI.
- *Build on the 176 command outbox* (`specs/176-command-hooks-outbox/`, in flight in #1060). The
  outbox delivers `afterCommit` handlers of Commands at least once; it does not model recipients ×
  channels, per-channel skip reasons, a freshness window or a History view, and the RFQ transitions
  are not all Commands (the expiry sweep, the order reactor). Coupling this feature to an
  unreleased platform mechanism would also serialise two independent features. Recorded as a
  *possible later convergence*, not a dependency.

## R-2 — Who owns the customer notification centre: a new module, `customer_notifications`

**Decision.** A new module `customer_notifications` (package `@endora-commerce/mod-customer-notifications`)
owns the entries, their storefront API and their retention, and publishes
`customerNotificationRecordPort` (`record`, `recordWithin`) for producers. `quote_requests` is the
first producer; orders and returns are follow-ups.

**Rationale.** The centre is a cross-module capability with a different audience, tenancy and
surface from the admin bell: entries are addressed to a customer account inside one Organization
(Principle XI), read through the storefront under the request's sales channel (XII), and switched
on and off by the operator independently of any producer (XVII). Domain ownership — "what a buyer
is told in their account" — justifies a module; `admin_notifications` is its structural twin and
the port shape is copied from it on purpose (`record` / `recordWithin`), so producers learn one
pattern.

**Rejected.**
- *Extend `admin_notifications`* with a customer audience. Its entity is `@GlobalEntity`, its
  surface and permission model are the admin's, and one switch would turn off both bells. Mixing a
  tenant-scoped audience into a global table is exactly what Principle XI's guard exists to
  prevent.
- *Put it in `customer_accounts`.* It would make the account module a dependency hub for every
  producer and give it a feed, a worker and a storefront page that are not about accounts.
- *Put it in `pwa`.* Push is one channel of the centre, not its owner; a shop without the PWA
  module still wants the centre.

## R-3 — Customer-side recipients are the people who may open the request

**Decision.** Customer side = the requester ∪ every member of the request's Organization whose role
is in `orgWideViewerRoleIds(organizationId)`, filtered to active, unblocked, non-anonymised accounts.
`orgWideViewerRoleIds` is **one** function in `quote_requests`, used by both the storefront
visibility check (`#seesOrganization`) and the recipient resolution. Today it answers the
Organization's predefined *Administrator* role (`organizationRoleReadPort.predefinedRoleId`); when
170 P3 lands it answers `organizationPermissionPort.rolesHolding(org, 'quote_requests.approve')`,
and both callers move together.

**Rationale.** Q3 says "members with the quote permission". The only quote permission declared
today is `quote_requests.create`, and holding it does **not** let a member open somebody else's
request (`rfq-service.ts` answers `404`). E-mailing such a member a request number, a status and a
link that 404s discloses the request (Principle XI's intent, and the `carts` approver rule's
model). The permission that will express org-wide visibility is P3's `quote_requests.approve`.
Writing the rule once keeps recipients and visibility from drifting when P3 changes it.

**Rejected.** *Holders of `quote_requests.create`* (the literal reading): discloses requests to
members who cannot open them. *Requester only*: contradicts Q3.

## R-4 — Which changes notify whom; the actor rule

**Decision.** The matrix is `contracts/notification-matrix.md`, one row per change. A "status
change" is the status the buyer sees, so an operator's offer on a pending request counts (the
buyer's status becomes *Awaiting your response*); the buyer's edits of their own pending request do
not. *Completed* notifies nobody. The **actor** of a customer-side change gets the e-mail (a
confirmation of a commercial step) and no centre entry and no push (they are looking at the
result); the rule is applied when the records are written, so nothing is written for the actor's
in-app or push channels.

**Rationale.** Q1 is about status changes "of a quote request", and the most important one for a
buyer — "your offer is ready" — happens without the stored status moving (`awaitingCustomerRevisionAcceptance`
is set on a `Pending` request). The PWA layer already treats it as a quote change (`revised`).
Confirming one's own acceptance by e-mail is the B2B norm and is what Q1 literally asks; a centre
entry telling a buyer what they just did is noise.

**Rejected.** *Stored-status changes only*: drops the offer notification. *Notify nobody about
their own action*: contradicts Q1 for the requester and leaves no written confirmation.

## R-5 — Operator-side recipients

**Decision.** Operator side = `{ request.assignedAdminUserId } ∪ organization's assigned
representatives`, each kept only when the administrator is active and their effective permissions
include `rfqs:handle` (as `requireAdmin` judges it, wildcard included); if the set is empty, every
active administrator holding `rfqs:handle` (Q6). Resolved through `adminUserReadPort.listAll` /
`findByIds` and `permissionService.listPermissions`.

**Rationale.** The assignee is the operator who last acted on the request and is the most likely
handler; adding them costs nothing and the set is de-duplicated. A representative who cannot open
the request (no `rfqs:handle`) must not be told, the same disclosure argument as R-3.

**Rejected.** *Organization assignments only* (today's code): ignores the assignee. *A new
"admins holding code X" port method in `admin_roles`*: administrator counts are small; one
`listPermissions` per candidate is adequate and adds no published surface. Revisit if an instance
has hundreds of administrators.

## R-6 — Records commit with the change

**Decision.** Every writer moves the history entry it notifies from and `enqueue` **inside** the
transaction `underRowLock` opens, passing the lock's `EntityManager` as `within` to
`RfqEventService.append` and `RfqNotificationService.enqueue` (both already accept it). The
order-completion reactor wraps its status write, its history entry and its records in one
`em.transactional`. After commit, each writer kicks the delivery queue (R-8).

**Rationale.** `transition-lock.ts` says history and notification rows are written after the lock
because "services on connections of their own … would wait on it forever"; the deadlock is a
property of *separate connections*, not of the rows, and disappears when the same `EntityManager`
writes them. The expiry worker already does exactly this. Atomicity is what lets FR-001 be true and
lets the worker be the only reader.

**Rejected.** *Keep writing after commit and let a sweep find history entries without records*:
needs a second derivation of the matrix from history, and a crash still loses the window between
the two commits.

## R-7 — The record's shape

**Decision.** `quote_request_notifications` (data-model §1): one row per (source history entry,
recipient kind, recipient id, channel), unique on that tuple; `status` ∈ `pending`, `sent`,
`skipped_stale`, `skipped_module_off`, `skipped_deactivated`, `skipped_no_transport`,
`skipped_logged`, `skipped_no_recipient`, `skipped_preference`, `skipped_no_subscription`,
`failed`, guarded by a check constraint; `attempts`, `next_attempt_at`, `last_error`, `closed_at`.
Channels: `admin_in_app`, `admin_email`, `customer_email`, `customer_in_app`, `customer_push`.
`@OrgScoped`, with `organization_id` stamped from the request.

**Rationale.** The scope's `skipped_<reason>` naming keeps one column the History screen and an
operator's SQL can read; the check constraint keeps the vocabulary closed. The recipient kind
replaces the old two nullable columns and their "exactly one" invariant. Organization scoping is
the request's own (Principle XI); the worker reads in the system scope, as the expiry sweep does.

**Rejected.** *`status` + separate `skip_reason`*: two columns with a state where they disagree.
*Keep the old table and add columns*: the owner ruled a redesign without compatibility.

## R-8 — The worker: kick + sweep, bounded, one record per transaction

**Decision.** `workers/rfq-notification-delivery-worker.ts`, a BullMQ queue
`quote_requests.notifications.deliver` with (a) a Job Scheduler every 60 s and (b) a `kick` job
added after each commit (deduplicated by a fixed job id while one is waiting). A tick: probe
`hasDeliverable()` outside any scope (an idle tick enters no scope and writes no
`tenant.escape_hatch` row), then in the system scope claim up to 200 rows `where status = 'pending'
and next_attempt_at <= now() order by created_at for update skip locked`, each in its own
transaction: stale check (source history entry older than 24 h → `skipped_stale`), presence check
of the channel's owner (→ `skipped_module_off`), deliver, close. Backoff after a failed attempt:
1 min, 5 min, 30 min, 2 h; the fifth failure closes `failed`. Registered through `ctx.worker` so
`quote_requests` off stops it (`specs/conventions/module-activation.md` item 2).

**Rationale.** Principle X and the module's own `rfq-expiry-sweep-worker.ts` pattern, unchanged:
BullMQ is the clock, the table is the queue, `skip locked` lets several processes share it, a
flushed Redis loses a tick and never a record. The kick makes SC-001's two minutes comfortable
without a tight schedule. 24 h sits well inside the backoff ladder (≈ 2 h 36 min total).

**Rejected.** *One BullMQ job per record*: Redis would become the source of truth for delivery and
a flush would lose records. *`setInterval` in the API process*: Principle X.

## R-9 — Delivery guarantees per channel

**Decision.** `admin_in_app` and `customer_in_app` are written with `recordWithin` on the record's
transaction and are **exactly once**. `customer_email` / `admin_email` are **at least once with an
idempotency key**: `messageId = quote_request_notification:<record id>`, so a retry after a crash
between the transport's acceptance and the commit is suppressed by the transport's message-id
check (D-59). `customer_push` is enqueued through the PWA port with `sourceEventId = <record id>`,
which `push_messages_trigger_event_uniq` makes idempotent.

**Rationale.** It is the strongest guarantee each owner's existing seam can give, with no new
mechanism.

## R-10 — E-mail templates

**Decision.** Eleven `transactionalEmails` manifest entries in `quote_requests`, one per change ×
side (`contracts/notification-matrix.md` §3), each with default subject and content in English and
Polish pushed through `emailDefaultsPort` from the module's boot hook, as `quote_request_pdf` is.
Customer e-mails: language = the request's channel default language (`en-US` fallback), link =
`<channel.storefront_url>/quote-requests/<id>` when the channel has a storefront URL (the storefront
applies its locale-path rule on arrival, `specs/167-storefront-locale-path/`), otherwise no link.
Operator e-mails: language = the administrator's preferred language (English fallback); no link
(OQ-1). The approval e-mail carries no attachment (Q2).

**Rationale.** "One manifest entry per transition, EN+PL" was the architect's scope; it gives the
operator a switch per message (FR-024) and copy that can say exactly what happened ("approved by
us" and "accepted by your colleague" are different sentences). The language and link rules are the
ones `carts`, `orders` and `returns` already use.

**Rejected.** *One template per side with a `status` variable*: one switch would turn off every
quote e-mail, and conditional copy in the page builder is fragile.

## R-11 — The admin bell entry

**Decision.** `audience: 'admin_user'`, `kind: 'quote_requests.<change>'`, `subjectType:
'quote_request'`, title `Quote request <number> was submitted` (and siblings) with `titleMessage`
`{ scope: 'quote_requests', key: 'notifications.<change>.title', params: { number } }`, `linkPath:
'/quote-requests/<id>'`. No body; the Organization's name is not in the entry.

**Rationale.** The `tasks` and `crm` rule: a bell is read outside the record's visibility, so it
names the record by number only. Translatable by key (`specs/conventions/module-i18n.md`, the
"reader is plural or reads later" case).

## R-12 — Push follows the delivery records; PWA stops listening to quote events

**Decision.** `pwa` publishes a new port, `customerPushPort` (§2 of
`contracts/delivery-and-ports.md`): `push({ customerAccountId, organizationId, salesChannelId,
category: 'quote', title, body, url, sourceKey })` → `'enqueued' | 'skipped:switched_off' |
'skipped:customer_preference' | 'skipped:no_account' | 'skipped:no_subscription'`. It applies the
same gates the status-push composer applies today (push on, category on, account live, preference
on), renders nothing itself (the caller hands the sentence), and calls
`PushMessageService.createAndEnqueue` with trigger `quote_request` and `sourceEventId = sourceKey`.
In the same change, `pwa` drops its five `rfq.*` subscriptions and the quote branch of the
composer, and its `degrades-without quote_requests` edge (it no longer reads quotes);
`quote_requests` declares `degrades-without pwa` for `customerPushPort`.

**Rationale.** Q3 and Q1 define recipients and transitions for **every** customer channel; leaving
push on its own event subscription would keep a second recipient rule (requester only) and a second
trigger list, and the History could not say what was pushed. The per-type preference the owner
named already exists (`quoteStatusEnabled`); the port reuses it rather than adding a second one.
The direction of the edge flips cleanly: no cycle is introduced.

**Rejected.** *Keep the event-driven push and extend it to Q3's recipients*: duplicates R-3 inside
`pwa`. *Push from the centre* (`customer_notifications` emits `recorded`, `pwa` pushes): a
non-durable post-commit event, no record of the outcome on the request, and it makes the centre's
presence a precondition for push. Worth revisiting when orders and returns join the centre — see
*Follow-ups* in `plan.md`.

## R-13 — The centre's language: key, params and an English sentence; translated on read

**Decision.** An entry stores `titleMessage` / `bodyMessage` (`{ scope, key, params }`, params
strings and numbers only) beside the English `title` / `body`. The storefront API translates on read
with `adminI18nService.translate(scope, key, requestLanguage, params)`, answering the English
sentence when the key does not resolve or the producer is absent, and ships `kind` beside it.

**Rationale.** `specs/conventions/module-i18n.md`: the entry is read later, possibly in another
language, so the writer cannot translate; but the HTTP response **can** resolve its reader's
language, so the backend translates there and ships the code too — a third-party storefront with no
vocabulary still renders a sentence. The admin bell's message shape is reused so producers write one
shape for both.

**Rejected.** *Translate at record time in the channel language*: wrong for a buyer who switches
language. *Ship only keys to the storefront*: the storefront catalogue would have to hold every
producer's notification copy, and a third-party consumer would render codes.

## R-14 — Channel scoping and producer presence in the centre

**Decision.** List and count filter `sales_channel_id = <resolved request channel> or
sales_channel_id is null`, and `source_module in <effectively present modules>`.

**Rationale.** Principle XII: a buyer on store B does not see store A's request (its link may not
resolve on B). XVII: an entry produced by a module that is off would link to a surface that is not
there; hiding it is "as if never installed", and it reappears when the module returns.

## R-15 — Storefront delivery: Server Components, server actions, no new cache

**Decision.** `/account/notifications` is a Server Component page reading
`GET /api/v1/storefront/notifications` with the buyer's session. An entry opens through a `GET`
route handler, `/account/notifications/<id>/open`, which marks it read and answers `303` to its
link (R-24 (a)); *Mark as read* (entries without a link) and *Mark all as read* are server actions.
Every write revalidates the root layout (`revalidatePath('/', 'layout')`) so the count re-renders
in the same response. The unread count is fetched server-side in `app/layout.tsx` next to the cart
count, only for a signed-in buyer and only when the module is present, and passed to `Header` for
the account pill and to the mobile account entries. Responses are `private, no-store`. No Redis
cache for the count, and no polling.

**Rationale.** Constitution VII and the repository's storefront rules (Server Components first, the
client boundary low). The count query is one indexed `count(*)` on `(customer_account_id, read_at)`
with a partial index on unread rows; a cache would need the lifecycle pub/sub invalidation pattern
for a value that changes exactly when the same process writes it — complexity with no measured
need.

**Rejected.** *A client island polling the count*: an extra request per page and a layout shift;
*a Redis cache*: above.

## R-16 — Retention

**Decision.** Setting `customer_notifications.retention_days` (number, default 90, platform-wide,
validated 7–730), and a daily BullMQ scheduler deleting entries older than it in batches of 1000.
`quote_request_notifications` rows are not swept: they live as long as the request (History).

**Rationale.** Configuration belongs in the Settings module; a buyer's centre is a recent record, and
90 days spans a typical quote cycle plus its order. Deletion, not archiving: there is no screen for
archived entries.

## R-17 — Header bell

Decided in `spec.md` § *Header bell decision*: no bell; unread indicator on the account entry.

## R-18 — Tenancy

**Decision.** `quote_request_notifications` is `@OrgScoped` (organization of the request).
`customer_notifications` is `@CustomerScoped` with a stamped `organization_id` and a check that both
ids are present — the `PushNotificationPreference` pattern (D-187), so the customer filter's
allowed-set arm still grants a representative assigned to the buyer's Organization. Workers run
under `enterSystemScope` with explicit predicates, only on non-idle ticks.

## R-19 — Auditing

**Decision.** Delivery records, centre entries and read marks are notification bookkeeping, not
audited domain writes: each write site carries `command-coverage-ignore` with that reason, as
`rfq-notification-service.ts` and `admin-notification-service.ts` already do. The audited write is
the transition that caused them, which already runs through the Command Bus / the request's own
audit trail. The retention setting is changed through the Settings module's own Command.

## R-20 — Activation and dependency edges

| Module | Edge | Kind | Off behaviour |
| --- | --- | --- | --- |
| `quote_requests` → `admin_notifications` | `adminNotificationRecordPort` | `degrades-without` | bell records `skipped_module_off` |
| `quote_requests` → `customer_notifications` | `customerNotificationRecordPort` | `degrades-without` | centre records `skipped_module_off` |
| `quote_requests` → `pwa` | `customerPushPort` | `degrades-without` | push records `skipped_module_off` |
| `quote_requests` → `transactional_emails` | sender | `dependencies` (exists) | per-template switch → `skipped_deactivated` |
| `pwa` → `quote_requests` | `quoteRequestReadPort` | **removed** | — |
| `customer_notifications` | `_i18n`, `auth`, `settings`, `customer_accounts` | `dependencies` | — |

Presence is decided in front of each port (`effectiveState.isPresent`), never by catching the
refusal (D-60), as `tasks`' notifier does. `customer_notifications` declares its activation setting
`customer_notifications.enabled` (default on) and is deactivatable.

## R-21 — Dropping the old table

**Decision.** One `quote_requests` migration drops `quote_request_notification_events` and creates
`quote_request_notifications`; `down()` reverses it. No backfill: the owner ruled no compatibility,
and the backlog is undeliverable by Q8 anyway.

## R-22 — Interaction with `specs/170-organization-roles/` P3

P3 adds the status *Awaiting internal approval* and its transitions. Each new transition is a row to
add to `contracts/notification-matrix.md`, and `orgWideViewerRoleIds` switches to
`quote_requests.approve` there. This feature makes both one-line changes for P3 and blocks nothing.

## R-23 — Dependencies

No new runtime dependency. BullMQ, MikroORM, Zod, the e-mail and push transports already exist.

## R-24 — Rulings on the designer review's open decisions (2026-11-12)

The designer review of PR #1071 agreed with "no header bell" and left four decisions to the
architect. All four are ruled here; none needs the owner.

**(a) How an entry opens — a `GET` open route with `303`.** Rationale: the row must behave as a
link (new tab, middle-click, copy link, Fitts' full-width surface), which a server-action button
cannot. Marking read is idempotent, touches only the caller's own entry, and is a no-op under
impersonation, so a `GET` with this side effect is safe: a forged link can at worst mark one of the
victim's own notifications read. Prefetch is off (`prefetch={false}`) and `/account*` is already
excluded from speculation rules, so nothing marks an entry the buyer did not open. Rejected: a
server-action `<button>` in a `<form>` — gives up link behaviour for no safety gain.

**(b) SC-006 — three interactions, plus a summary line on `/account`.** The pill keeps one
destination (the account overview); the overview shows "You have N unread notifications" linking to
the page, and the account navigation lists *Notifications* second. Rejected: pointing the pill at
the notifications page while something is unread — one control with two destinations, which breaks
the buyer's model of the pill.

**(c) The 768–876 px gap — fixed inside this feature** (WP-09a). The header switches to its desktop
rows at 877 px while the tab bar and the drawer hide from 768 px (`md`), so tablet widths have no
account entry at all. FR-051 requires the indicator at every width and cannot be met without it.
Aligning the two mobile breakpoints to 877 px is a small, contained change (one CSS breakpoint and
two components) whose consequence — tablets get the bottom tab bar — is the intended mobile layout
for a width that already renders the mobile header. It ships in its own MR ahead of WP-09, so it
can be reviewed and reverted on its own; filing it as a separate issue would leave FR-051 blocked
on work outside the plan.

**(d) Badge cap — `9+`.** The badge sits on a 32 px avatar, where `99+` covers the initials; the
exact count travels in the visually hidden text. The cart's `99+` stays as it is: a different
control with a 44 px target.

**Not applied from the review** (its "could" items): grouping rows into *Today* / *Earlier*, and an
empty-state sentence about per-channel scoping. Both are deferred, not rejected on merit: with one
producer and a 20-row page the list is short, and the channel sentence would explain a rule most
buyers never meet (one channel per Organization is the common case). Revisit with the bell
triggers in spec.md.
