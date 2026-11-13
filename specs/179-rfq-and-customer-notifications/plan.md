# Implementation Plan: Quote request notification delivery and the storefront notification centre

**Branch**: `spec/179-rfq-and-customer-notifications` (this plan) | **Date**: 2026-11-12 |
**Spec**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md)
**Input**: `specs/179-rfq-and-customer-notifications/spec.md` (issue #238; owner rulings Q1–Q8 of
2026-11-12)

## Summary

`quote_requests` records who should be told about every quote-request change and then never tells
anybody (#238). This feature replaces the write-only table with a delivery record per (history
entry, recipient, channel), written in the change's own transaction, and a BullMQ worker in the
module's existing sweep pattern that delivers each record through the channel's owner: the admin
bell (`admin_notifications`), e-mail (`transactional_emails`, eleven new operator-editable
templates), a **new** customer notification centre on the storefront (new module
`customer_notifications`), and PWA push (`pwa`, through a new port that replaces its own quote-event
subscriptions). Recipients follow the owner's rulings — customer side = requester plus the members
who may open the request; operator side = assignee and assigned representatives holding
`rfqs:handle`, else every administrator holding it — and every outcome is shown on the request's
admin History.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: existing only — Fastify, MikroORM (PostgreSQL), Zod, BullMQ, ioredis;
Next.js 15 (storefront); React 19 (admin)
**Storage**: PostgreSQL — one table replaced in `quote_requests`, one table in the new module
**Testing**: Vitest (module co-located `*.test.ts`, `backend/test/{unit,contract,integration}`),
storefront SSR-only component tests (`renderToString`)
**Target Platform**: backend API + worker processes, admin SPA, storefront SSR
**Project Type**: web (monorepo: `packages/modules/*`, `packages/contracts`, `storefront/`, `admin/`)
**Performance Goals**: SC-001 — a record closed within 2 minutes of its change; an idle worker tick
costs one `exists` query and no scope
**Constraints**: exactly-once for in-app channels, idempotent at-least-once for e-mail and push;
24-hour freshness (Q8); no recipient who cannot open the request
**Scale/Scope**: tens of recipients per change at most; one producer (RFQ) in this feature

## Constitution Check

*Gate before Phase 0 and re-checked after Phase 1 design. Constitution v4.2.0.*

| Principle | Verdict | How |
| --- | --- | --- |
| I. Modular (NN) | **Pass** | Delivery records owned by `quote_requests` (R-1); the centre is its own module (R-2). Every cross-module step is a published port (`adminNotificationRecordPort`, `customerNotificationRecordPort`, `customerPushPort`, `TransactionalEmailSender`, `organizationRoleReadPort`, `customerAccountReadPort`, `permissionService`). No foreign keys across modules. `customer_notifications` is detachable. |
| II. API-first | **Pass** | `packages/contracts/src/customer-notifications.ts` (new), `pwa.ts` (port), `quote-requests.ts` (optional `deliveries`, additive) land first (WP-01). |
| III. TDD (NN) | **Pass** | Every task in `tasks.md` is `[test → impl]`; every FR maps to a test in the traceability table below. |
| IV. YAGNI / deps | **Pass** | No new runtime dependency. No generic notification platform; one producer. No Redis cache for the count (R-15). |
| V. TypeScript | **Pass** | — |
| VI. Naming (NN) | **Pass** | module `customer_notifications`, table `customer_notifications`, `quote_request_notifications`; package `@endora-commerce/mod-customer-notifications`; e-mail codes snake_case. |
| VII. SEO/perf | **Pass** | Server Components and server actions; the page is `noindex` (account area); the count is one indexed query in the layout fetch already made for the cart. |
| VIII. English (NN) | **Pass** | Artefacts, code and comments in English; user copy pl+en. |
| IX. UI reuse | **Pass** | Admin History reuses the existing History list; storefront reuses the account layout, `LocalizedLink`, the header pill and the semantic tokens; no new primitive. |
| X. Queue consumers | **Pass** | Worker follows `rfq-expiry-sweep-worker.ts` (scheduler as clock, table as queue, `skip locked`, idle probe, system scope only when busy) (R-8); retention sweep likewise. |
| XI. Tenancy (NN) | **Pass** | `quote_request_notifications` `@OrgScoped`; `customer_notifications` `@CustomerScoped` with stamped Organization (D-187 pattern). No no-organization path: every customer recipient belongs to the request's Organization. |
| XII. Channel scoping (NN) | **Pass** | Centre list and count filter by the resolved request channel (+ channel-less) (R-14); e-mail uses the request's channel for content, language and link. |
| XIII. Command Bus (NN) | **Pass** | The audited writes are the transitions, unchanged. Delivery records, centre entries and read marks are notification bookkeeping with `command-coverage-ignore` reasons (R-19), the precedent of `rfq-notification-service.ts` and `admin-notification-service.ts`. |
| XIV. Extensibility | **N/A** | No "add a field" requirement. |
| XV. Untouched core | **Pass** | Templates are operator-editable; an overlay can contribute a producer through the public port. |
| XVI. Palette | **Pass** | `customer_notifications` has no admin screen (settings only, shown on the generic Settings screen and `/platform/modules`); `quote_requests`' History is an existing screen already reachable. No new admin route → no new action. |
| XVII. Toggleable (NN) | **Pass** | `customer_notifications.enabled` activation, deactivatable; routes, worker and storefront surfaces gated; producers decide its presence in front of the port and record `skipped_module_off`; `quote_requests` declares `degrades-without` on `admin_notifications`, `customer_notifications`, `pwa`; `pwa` drops its edge to `quote_requests` (R-20). Off-state tests in WP-12. |

**Verdict: PASS, no violations.** Re-checked after Phase 1 design (data-model, contracts): no change.

## Cross-cutting design (the routed checklists)

| Concern | Design |
| --- | --- |
| Admin permissions (`module-admin-surfaces.md`) | No new admin code. History deliveries ride `rfqs:handle`. The centre has no admin route. |
| Command palette | No new admin destination (above). |
| i18n (`module-i18n.md`) | Bell titles: `quote_requests/i18n/{en,pl}.json` `notifications.<change>.title`. Centre and push titles: same bundle, `customerNotifications.<change>.title`. Translated on read for the centre (R-13); push rendered in the channel language at delivery; e-mail defaults pl+en; storefront copy in `storefront/lib/i18n/messages/{account,chrome}.ts`; admin History labels in the `core` bundle (`rfq.detail.history.delivery.*`). `check:bundle-pairing` holds for the new module (ships both). |
| Settings | `customer_notifications.enabled`, `customer_notifications.retention_days` (data-model §3). No secrets. |
| Auditing | R-19. |
| Tenancy | R-18. |
| Cache invalidation | None introduced. No Redis-cached value depends on these tables (R-15). |
| Activation | R-20; `module-activation.md` items 1–3 via `ctx.routes`, `ctx.worker`, `ctx.di.providePort`. |
| Migrations (`module-migrations.md`) | Two, by owner (data-model). Scaffolded with `migration:new`; `composer:generate` registers them. |
| Documentation (`module-documentation.md`) | `quote_requests/docs/quote_requests.md` *Notifications* rewritten; `customer_notifications/docs/customer-notifications.md` new; `pwa/docs/pwa.md` quote-push paragraph; Polish per `docs/docs/contributing/documentation-i18n.md`. |
| Release intent (`release-intent.md`) | Changesets: `@endora-commerce/contracts` minor; `mod-quote-requests` minor (table replaced, eleven e-mails, new behaviour); `mod-pwa` minor (port added, quote subscriptions removed); `mod-customer-notifications` initial; `mod-admin-notifications` none. Upgrade note: the old table is dropped and its rows discarded (no deployment holds deliverable rows: Q8). |
| Generated artefacts | `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` in WP-07's MR (new package). |

## Project Structure

### Documentation (this feature)

```text
specs/179-rfq-and-customer-notifications/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── notification-matrix.md
│   ├── delivery-and-ports.md
│   └── customer-notifications-storefront-api.md
├── checklists/requirements.md
└── tasks.md
```

### Source code (repository root)

```text
packages/contracts/src/
├── customer-notifications.ts          # new: port types + storefront Zod schemas
├── pwa.ts                             # + CustomerPushPort
└── quote-requests.ts                  # + quoteRequestDeliverySchema, optional entry.deliveries

packages/modules/quote_requests/
├── src/manifest.ts                    # + 11 transactionalEmails, + 3 degrades-without edges
├── src/migrations/<ts>_quote_requests_notifications_redesign.ts
├── src/backend/entities/quote-request-notification.entity.ts      # replaces …-notification-event.entity.ts
├── src/backend/services/notifications/
│   ├── notification-matrix.ts         # contracts/notification-matrix.md as data
│   ├── recipients.ts                  # R-3, R-5; orgWideViewerRoleIds shared with rfq-service
│   ├── delivery-service.ts            # claim, stale, presence, deliver, close
│   └── channel-adapters.ts            # admin_in_app, admin_email, customer_email, customer_in_app, customer_push
├── src/backend/services/rfq-notification-service.ts   # rewritten: record(within, change, …)
├── src/backend/email-templates/quote-notification-defaults.ts      # 11 × {en,pl}
├── src/backend/workers/rfq-notification-delivery-worker.ts
├── src/admin/pages/RfqHistory.tsx     # deliveries under entries
├── i18n/{en,pl}.json                  # notifications.*, customerNotifications.*
└── docs/quote_requests.md

packages/modules/customer_notifications/          # new module
├── package.json, tsconfig*.json, README.md, LICENSE, CHANGELOG.md
├── i18n/{en,pl}.json
├── docs/customer-notifications.md
└── src/
    ├── manifest.ts
    ├── migrations/<ts>_customer_notifications_init.ts, index.ts
    └── backend/
        ├── index.ts                   # composition: port, routes, retention worker
        ├── entities/customer-notification.entity.ts
        ├── services/customer-notification-service.ts
        ├── services/customer-notification-port.ts
        ├── routes.storefront.ts
        └── workers/retention-sweep-worker.ts

packages/modules/pwa/src/backend/
├── services/customer-push-port.ts     # new
├── services/status-push-composer.ts   # quote branch removed
└── index.ts                           # rfq.* subscriptions removed; port provided

storefront/
├── lib/api/customer-notifications.ts
├── app/(account)/account/notifications/{page.tsx,actions.ts,[id]/open/route.ts}
├── app/(account)/layout.tsx           # Notifications nav entry
├── app/(account)/account/page.tsx     # unread summary line
├── app/globals.css                    # tab bar breakpoint → 877 px (WP-09a)
├── app/layout.tsx                     # unread count beside cart count
├── components/Header.tsx              # UserPill indicator
├── components/mobile/MobileTabBar.tsx, components/Megamenu/MegamenuMobileDrawer.tsx
└── lib/i18n/messages/{account,chrome}.ts
```

**Structure decision**: extend `quote_requests` and `pwa`; one new module, justified by domain
ownership (research R-2), not by size.

## Delivery phases and work packages

Each WP is one merge request to `master` unless noted. Phases are independently shippable: Phase 1
alone closes #238's operator and e-mail halves.

| Phase | WP | Scope | Depends on |
| --- | --- | --- | --- |
| **1 — Delivery core** (US1, US2, US5) | WP-01 | contracts: port types, storefront schemas, `deliveries` | — |
| | WP-02 | `quote_requests` table redesign: migration, entity, old entity deleted, `rfq-notification-service` rewritten to the matrix | WP-01 |
| | WP-03 | recipients (R-3, R-5) and `orgWideViewerRoleIds` shared with `#seesOrganization` | WP-02 |
| | WP-04 | recording moved into each writer's transaction (R-6) + kick | WP-03 |
| | WP-05 | worker + `admin_in_app`, `admin_email`, `customer_email` adapters; 11 e-mail definitions with en/pl defaults; bell copy | WP-04 |
| | WP-06 | History `deliveries` (route + admin screen) | WP-02 |
| **2 — Centre** (US3) | WP-07 | `customer_notifications` module (entity, migration, port, routes, retention, settings, i18n, docs, generated artefacts) | WP-01 |
| | WP-08 | `customer_in_app` channel in `quote_requests` | WP-05, WP-07 |
| | WP-09a | tablet breakpoint alignment: tab bar and drawer switch at 877 px (research R-24 (c)) | — |
| | WP-09 | storefront page, open route, actions, indicator, account nav + summary, copy | WP-07, WP-09a |
| **3 — Push** (US4) | WP-10 | `pwa` `customerPushPort`, removal of `rfq.*` subscriptions and the quote branch, `customer_push` channel in `quote_requests` — **one MR**, so no window pushes twice or never | WP-05 |
| **4 — Close** | WP-11 | documentation en+pl, changesets, upgrade note | all |
| | WP-12 | off-state and end-to-end matrix tests (integration) | all |

WP-06, WP-07, WP-09a and WP-09 can run in parallel with WP-03 – WP-05. At most three agents at once.

## Requirement → test traceability

| FR | Test (file) |
| --- | --- |
| FR-001, FR-002, FR-003, FR-007 | `quote_requests/src/backend/services/notifications/notification-matrix.test.ts` (matrix = contract table); `backend/test/integration/quote_requests/notification-recording.test.ts` (one per writer: rows commit with the change, roll back with it) |
| FR-004 | `recipients.test.ts` (requester, *Administrator* member, *Member* excluded, blocked/anonymised excluded, de-dup) |
| FR-005, FR-006 | `recipients.test.ts` (assignee ∪ reps, `rfqs:handle` filter, fallback) |
| FR-008 | migration test in `backend/test/integration/quote_requests/notifications-migration.test.ts` |
| FR-010 – FR-016 | `delivery-service.test.ts` (stale, presence, backoff ladder, failure cap, closing), `rfq-notification-delivery-worker.test.ts` (idle probe, scope only when busy, `skip locked` sharing — integration) |
| FR-013, FR-014 | `channel-adapters.test.ts` (recordWithin on the record's EM; `messageId` / `sourceKey` = record id); crash-between-send-and-commit case in the integration test |
| FR-020 – FR-024 | `quote-notification-defaults.test.ts` (11 codes × en/pl, variables resolve), `channel-adapters.test.ts` (language, link, no attachment, outcome mapping) |
| FR-030 | `channel-adapters.test.ts` (bell input shape, number-only sentence, link) |
| FR-040 – FR-048 | `customer_notifications/src/backend/**/*.test.ts` (port validation, idempotency, list/count scoping, translation on read, impersonation no-op, retention), `backend/test/contract/customer_notifications/storefront-api.test.ts`, off-state test |
| FR-050 – FR-052 | `storefront/test/account/notifications-page.test.tsx`, `notifications-open-route.test.ts`, `notifications-actions.test.ts`, `account-nav-notifications.test.tsx`, `storefront/test/header-unread-indicator.test.tsx` (SSR markup, hidden-text accessible name, no colour-only state, `9+`), `HeaderBreakpoint.test.tsx` (767/768/876/877 px), typecheck of `defineMessages` |
| FR-060, FR-061 | `pwa/src/backend/services/customer-push-port.test.ts` (gate order, outcomes, idempotency), `pwa/src/backend/cross-module-ports.test.ts` (no `rfq.*` subscription remains) |
| FR-070, FR-071 | `backend/test/contract/quote_requests/history-deliveries.test.ts`, customer projection test asserting no `deliveries` |
| FR-080 | `check:module-docs` + review |

## Conflicts with in-flight work

- **`specs/176-command-hooks-outbox/` (#1060, P3 in flight).** No file overlap (it touches
  `packages/platform` commands/outbox only; this feature does not). Conceptual overlap: two
  at-least-once delivery mechanisms. Kept separate on purpose (research R-1); convergence, if ever,
  is a later decision once both exist.
- **`specs/170-organization-roles/` P3.** Adds *Awaiting internal approval* and switches RFQ
  visibility to `quote_requests.approve`. This feature makes both a one-line change
  (`notification-matrix.ts` row, `orgWideViewerRoleIds`), research R-22. Whoever lands second adds
  the matrix rows.
- **`specs/149-pwa-order-status-push/` behaviour in `pwa`.** WP-10 removes its quote half; its order
  half is untouched. The `pwa` docs page and the setting description of
  `pwa.push_quote_status_enabled` ("the customer who requested a quote") must be updated to "the
  people told about the quote" in the same MR.
- **`specs/178-extensible-columns/`** edited `20260503T141344_quote_requests_workflow.ts` (R-A7,
  R-A8). This feature does **not** edit that file; the drop of the old table is a new migration.
- **Open PRs** (#1060–#1070, #1053) touch none of `quote_requests`, `pwa`, `admin_notifications`,
  the storefront header or account pages (checked 2026-11-12). `packages/modules/organizations`
  is read through ports only.

## Follow-ups (not in this feature)

1. Orders and returns as producers of the centre (and whether order pushes then move onto the same
   port, retiring `pwa`'s `order.status_changed.v1` subscription).
2. **Committed next step (owner, 2026-11-12):** issue #185 promotes `ADMIN_BASE_URL` to the platform; then the RFQ operator e-mails (`quote_request_operator_submitted`, `…_resubmitted`) gain a link to the request, as do the `crm` and `tasks` e-mails (tasks T104).
3. Mark a request's centre entries read when the buyer opens the request page.
4. Revisit the header bell when notifications become frequent (spec *Header bell decision*).

## Complexity Tracking

No constitution violations. **No new runtime dependency.** One new module, justified in research
R-2 by domain ownership.

## Handoff to `endora-commerce-dev`

- Build in phase order; WP-10 must be a single MR. Read `contracts/notification-matrix.md` before
  touching any writer: it is the only definition of who is told.
- Recording moves **into** `underRowLock`'s transaction with `within` (R-6). Do not keep any
  post-commit `enqueue`; the kick is the only post-commit step and it must never fail a transition.
- Presence is decided in front of every port (`effectiveState.isPresent`), never by catching.
- `orgWideViewerRoleIds` is shared with `#seesOrganization` — one function, two callers.
- No migration numbers: `pnpm --filter backend run migration:new` in the owning module; run
  `composer:generate`, `manifests:generate` and `pnpm install --lockfile-only` with the new module.
- Verify each WP with typecheck, lint, targeted tests **and** `pnpm --filter '!backend' run test`
  for the packages touched; integration tests need the services (`backend-test-suite.md`).
- Do not run `update-agent-context.sh` (batched later).
