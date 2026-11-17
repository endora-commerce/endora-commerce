# Implementation Plan: Return-case notifications and complaints without a platform order

**Branch**: `feat/180-off-platform-complaints` | **Date**: 2026-11-13 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/180-off-platform-complaints/spec.md` (owner rulings R1–R6 and the clarifications of
2026-11-13)

## Summary

`returns` gains the following in **one merge request** (owner ruling 2026-11-13, spec
*Clarifications*), built in two ordered phases with the branch green at the boundary:

- **phase A — notifications and the authorizer** (US1–US4). A new `returns-notifications` BullMQ
  queue, modelled on `forms-notifications`, sends four new operator-editable e-mails (new case to
  configured shop addresses, confirmation to the customer, comment with *notify customer*, entry
  into an operator-marked status) and records admin bell entries for administrators holding
  `returns:read`. The authorizing administrator is stamped beside `authorizedAt` and back-filled
  from the audit log. Entering `authorized`/`rejected` gets its dedicated effects on **every** path,
  which repairs a defect where the generic and bulk transitions skipped them.
- **phase B — the complaint without a platform order** (US5–US8). A case may have no order
  (`orderId null` ⇒ off-platform, complaints only), with catalog-or-free-text lines, serial numbers,
  purchase data, contact data and a ship-back address as submitted. Customers upload typed,
  private attachments, which `returns` stores itself through `objectStoragePort` and serves from its
  own guarded routes. Clauses are configured per language and channel and stored as accepted. A
  list filter shows off-platform cases, settlement restricts them to repair, replacement and
  *settled outside the platform*, and the customer anonymisation erases the new personal data.
  Case creation becomes the Command `return_case.create`.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: existing only — Fastify (+ `@fastify/multipart`), MikroORM (PostgreSQL),
Zod, BullMQ, ioredis; Next.js 15 (storefront); React 19 (admin). `mod-returns` declares three of
these as peers for the first time (Complexity Tracking); none is new to the workspace
**Storage**: PostgreSQL — two `returns` migrations (one per MR), one new table; attachment bytes in
the deployment's configured object store through `objectStoragePort`
**Testing**: Vitest — module co-located `*.test.ts`, `backend/test/{contract,integration}/returns/`,
storefront SSR component and route-handler tests
**Target Platform**: backend API + worker processes, admin SPA, storefront SSR
**Project Type**: web monorepo (`packages/modules/returns`, `packages/contracts`, `storefront/`)
**Performance Goals**: a submission's response is not slowed by notifications (they are queued);
SC-005 (a no-order complaint in under 4 minutes) is a UX target the designer validates
**Constraints**: e-mails at most once per event (sender `messageId` dedupe); attachments 10 MB per
file, 30 MB per submission, 10 per case; no customer file reachable outside the case's audience;
the no-JavaScript form keeps working
**Scale/Scope**: one module, ~4 new e-mails, 3 settings, 1 table, ~12 routes added or changed

## Constitution Check

*Gate before Phase 0 and re-checked after Phase 1. Constitution: `.specify/memory/constitution.md`.*

| Principle | Verdict | How |
| --- | --- | --- |
| I. Modular (NN) | **Pass** | Everything is owned by `returns`. Cross-module steps go through published ports only: `TransactionalEmailSender`, `customerAccountReadPort`, `adminUserReadPort`, `permissionService`, `adminNotificationRecordPort`, `objectStoragePort`, `catalogProductAvailabilityPort`, and the one port this feature adds to another module, `transactionalEmailStatePort` in `transactional_emails` (D-11, research R-21) — published by its owner, not reached into. No FK to another module's table. The backfill reads the kernel-owned `audit_log_entries`, which is outside `check:module-boundary`'s R1/R2. No new module: the no-order path is a path of the returns form (research R-16). |
| II. API-first | **Pass** | `packages/contracts/src/returns.ts` changes land first in each MR (contracts/). Two removals (`attachmentAssetIds`, the JSON attachment body) are unusable and unsafe today; stated in the changeset as a breaking change, `minor` in 0.x (D-225). |
| III. TDD (NN) | **Pass** | Every FR maps to a test (traceability below); each WP is test-first. |
| IV. YAGNI / deps | **Pass** | No new runtime dependency. No delivery-record table (research R-2), no new port in another module, no settings-store change (R-4). |
| V. TypeScript | **Pass** | — |
| VI. Naming (NN) | **Pass** | Tables/columns snake_case and plural (`return_case_clauses`); settings `returns.*`; e-mail codes snake_case; Command actions dot-namespaced; queue names kebab-case like `forms-notifications`. |
| VII. SEO/perf | **Pass** | Storefront pages stay Server Components, `noindex` (account area); the form posts to a route handler that works without JavaScript (R-13). |
| VIII. English (NN) | **Pass** | Artefacts, code, comments in English; user copy en + pl. |
| IX. UI reuse | **Pass** | Admin: existing list filters (`Select`), chips, saved views, `Badge`, `Alert`, the status configuration screen; the clauses page is built from `ModalDialog`, `ContentLanguageTabs`, `Input`, `Textarea`, `SalesChannelPicker`, `Checkbox`, `ConfirmDialog`, `ResponsiveTable` and `RowActionMenu` (D-10). Storefront: the account form classes, `forms`' attempt-cookie pattern, `AddressForm`'s labelled fields extracted into a shared `AddressFields` (D-18), the `FormErrorSummary` shape. One new storefront leaf, `AttachmentField` — no existing primitive uploads with progress (design review R-2.5). The designer's review (`design-review.md`) is applied in B-9. |
| X. Queue consumers | **Pass** | `returns-notifications` and `returns-maintenance` follow `forms-notifications-worker.ts` / `forms-maintenance-worker.ts` (ids-only jobs, `ctx.worker`, separable entrypoint). |
| XI. Tenancy (NN) | **Pass** | `ReturnCaseAttachment` reclassified `@OrgScoped` with a stamped `organization_id` (a pending upload has no case). A no-order case takes the request's organization and refuses without one — no no-organization path. Workers run in the system scope with a reason, re-reading through scoped reads. Cross-tenant tests for attachments, uploads and file downloads (404 indistinguishable from not-found). Residual: `return_cases.organization_id` stays nullable for legacy rows (research F7); every row this feature writes sets it. |
| XII. Channel scoping (NN) | **Pass** | Settings, clauses and product availability are read for the channel resolved from the request; nothing takes a channel from the body. |
| XIII. Command Bus (NN) | **Pass, with a recorded pre-existing residual** | New sensitive writes are Commands: `return_case.create` (replacing the hand call in the same change), `return_case.attachment.add`, `return_case.erase_personal_data`, `return_case_clause.*` (research R-11). Extended existing writes keep their existing co-transactional audit (status config, settlement). **Transitions stay hand-audited after the flush** — unchanged from today and permitted by the principle's incremental-migration clause, but not "audited by construction"; converting them is a separate change (follow-up below). |
| XIV. Extensibility | **N/A, reasoned** | The new fields drive behaviour (proof rule, settlement restriction, filter, e-mails), so they are core columns, not runtime custom fields (research R-9). |
| XV. Untouched core | **Pass** | All templates, recipients, clauses and toggles are operator-configurable; a deployment needs no overlay for them. |
| XVI. Palette | **Pass** | New admin destination `/returns/clauses` gets the `return-clauses` action (contracts §8); the other changes live on reachable screens. |
| XVII. Toggleable (NN) | **Pass** | New routes via `ctx.routes`, workers via `ctx.worker`, the anonymisation subscriber via `ctx.subscribe` — all gone while `returns` is off. The no-order toggle is a setting evaluated *inside* an active module. `admin_notifications` is `degrades-without` with a presence check before the call. New `dependencies` edges (`admin_users`, `assets_library`, `catalog`) all point at non-deactivatable owners, so no operator control becomes a dead switch. Off-state tests extend `test/integration/returns/off-state.test.ts`. |

**Verdict: PASS.** One gate is not clean in the strict sense: XIII's transition audit remains
hand-written and post-flush — pre-existing, allowed, and recorded here and in research R-11 rather
than carried silently. Re-checked after Phase 1 (data-model, contracts): no change.

## Cross-cutting design (the routed checklists)

| Concern | Design |
| --- | --- |
| Admin permissions (`module-admin-surfaces.md`) | No new code; every new admin route reuses `returns:read` / `returns:write`. |
| Command palette | phase B: `return-clauses` → `/returns/clauses`, `returns:read`, keys in `i18n/{en,pl}.json`. |
| i18n (`module-i18n.md`) | Admin strings in `packages/modules/returns/i18n/{en,pl}.json` (status toggle, authorizer, filter chip, attachment list, clause page, settlement option); bell `titleMessage`/`bodyMessage` keys there, translated on read; error sentences `errors.<CODE>`; e-mail defaults en-US + pl-PL in the template file; storefront copy in `storefront/lib/i18n/messages/core.ts`, where the existing `returns.*` keys live (both locales, `defineMessages`). The backend words customer-facing refusals in the request language. |
| Settings | Three `returns.*` settings, channel-scopable (data-model §4). No secret. |
| Auditing | Research R-11; contracts §5. Free text (comment, note, clause text, contact) never enters an audit payload (D-288). |
| Tenancy | Above (XI); attachments reclassified; workers in system scope with a reason. |
| Cache invalidation | None introduced: no Redis-cached value depends on these tables. Settings reads go through the settings module's own cache and invalidation. |
| Activation | Above (XVII). |
| Migrations (`module-migrations.md`) | Two in the one MR — one per phase, so the branch migrates cleanly at the A/B boundary — owned by `returns`, scaffolded with `migration:new`, registered by `composer:generate` (data-model §1.3, §2.5). |
| Documentation (`module-documentation.md`) | `packages/modules/returns/docs/returns.md`: *Notifications* (phase A), *Complaints without a platform order*, *Attachments*, *Clauses*, *Settling an off-platform case* (phase B); Polish per `docs/docs/contributing/documentation-i18n.md`. |
| Release intent (`release-intent.md`) | One changeset for the MR: `@endora-commerce/contracts` minor, `@endora-commerce/mod-returns` minor and `@endora-commerce/mod-transactional-emails` minor (the new state port), describing both phases and spelling out the breaking removal of `attachmentAssetIds` and the JSON attachment body (old call → new call). The storefront is not a published package. |
| Generated artefacts | `composer:generate` (migrations registry, manifest index) at the end of each phase that adds a migration or changes the manifest; `manifests:generate` + `pnpm install --lockfile-only` whenever `mod-returns`' `package.json` or manifest dependencies change (both phases do). |
| Commercial data (`commercial-data.md`) | No counterparty, price or effort figure in any artefact. |

## Project Structure

### Documentation (this feature)

```text
specs/180-off-platform-complaints/
├── spec.md
├── plan.md                  # this file
├── research.md              # R-1 … R-19, findings F1 … F12
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── admin-api.md
│   ├── customer-api.md
│   └── settings-emails-events.md
├── checklists/requirements.md
└── tasks.md                 # /speckit.tasks — not created by this step
```

### Source code (what each MR touches)

```text
packages/contracts/src/returns.ts                         A, B   schemas, events, error codes

packages/modules/returns/
├── src/manifest.ts                                       A, B   settings, e-mails, deps, palette, error codes
├── src/migrations/<ts>_returns_authorizer_status_notifications.ts      A
├── src/migrations/<ts>_returns_off_platform_complaints.ts              B
├── src/backend/
│   ├── index.ts                                          A, B   composition: queues, ports, subscriber
│   ├── routes.admin.ts                                   A, B   comment refine, statuses, clauses, file
│   ├── routes.customer.ts                                B      form-config, uploads, attachments, file
│   ├── routes.uploads.ts                                 B      multipart child context (crm precedent)
│   ├── entities/return-case.entity.ts                    A, B
│   ├── entities/return-case-item.entity.ts               B
│   ├── entities/return-case-attachment.entity.ts         B      → @OrgScoped
│   ├── entities/return-status.entity.ts                  A
│   ├── entities/return-case-clause.entity.ts             B      new
│   ├── email-templates/transactional-defaults.ts         A      four defaults en-US + pl-PL
│   ├── services/return-transition-service.ts             A      status effects (R-7), enqueue
│   ├── services/return-authorization-service.ts          A      delegates to the status effects
│   ├── services/return-comment-service.ts                A      enqueue on notify
│   ├── services/return-case-service.ts                   A, B   enqueue (A); Command + no-order (B)
│   ├── services/return-list-service.ts                   A, B   authorizer names (A); origin filter (B)
│   ├── services/return-export-service.ts                 A, B
│   ├── services/return-settlement-service.ts             B      off-platform branch, settled_outside
│   ├── services/return-attachment-service.ts             B      object store, claim, serve
│   ├── services/return-clause-service.ts                 B      new
│   ├── services/return-erasure-service.ts                B      new
│   ├── services/notifications/                           A      dispatch, recipients, messages, health
│   ├── domain/case-reference.ts                          A      derived reference (R-20)
│   ├── services/return-clause-service.ts (clausesFor)    B      D-1 selection, shared by form-config and create
│   ├── workers/returns-notifications-worker.ts           A      new
│   └── workers/returns-maintenance-worker.ts             B      new
├── src/admin/pages/ReturnDetail.tsx                      A, B
├── src/admin/pages/ReturnsList.tsx                       A, B
├── src/admin/pages/ReturnStatusesConfigPage.tsx          A
├── src/admin/pages/ReturnClausesPage.tsx                 B      new
├── src/admin/components/ResolutionRadioGroup.tsx         B
├── i18n/{en,pl}.json                                     A, B
└── docs/returns.md                                       A, B

storefront/
├── app/(account)/returns/new/page.tsx                    B      path choice, no-order form, clauses, files
├── app/(account)/returns/[id]/page.tsx                   B      off-platform block, attachments, add file
├── app/returns/submit/route.ts                           B      new (forms/submit precedent)
├── app/returns/uploads/route.ts                          B      new (JS upload)
├── app/returns/[id]/attachments/route.ts                 B      new (add file, no JS)
├── app/returns/[id]/attachments/[attachmentId]/route.ts  B      new (download proxy)
├── app/(account)/returns/page.tsx                        B      reference, product label, purchase date
├── components/returns/                                   B      OffPlatformLines, AttachmentField, ClauseList
├── components/account/AddressFields.tsx                  B      extracted from AddressForm (D-18)
├── components/account/AddressForm.tsx                    B      uses AddressFields
├── lib/api/returns.ts, lib/returns/{returnForm,attachments}.ts   B
└── lib/i18n/messages/core.ts                             B

packages/contracts/src/transactional-emails.ts            B      TransactionalEmailStatePort (D-11)
packages/modules/transactional_emails/src/backend/
├── services/transactional-email-state.ts                 B      new
└── index.ts                                              B      providePort

backend/test/integration/returns/                         A, B   notifications, authorizer, off-platform,
                                                                 attachments, clauses, erasure, off-state
backend/test/contract/returns/                            A, B
```

**Structure decision**: extend `returns`; no new module (research R-16). Storefront follows the
`forms` route-handler precedent.

## Delivery and sequencing

**One merge request** (owner ruling 2026-11-13). The work packages run in the order below: all of
phase A, then all of phase B. At the A/B boundary the branch is green — typecheck, lint, the
module's tests and the targeted integration tests pass, and migration A has run — so phase B
starts from a known-good state. The phases are an ordering, not separate deliveries.

### Phase A — notifications and the authorizer (first)

| WP | Content | Tests first |
| --- | --- | --- |
| A-1 | Contracts: comment refine, status `notifyCustomerOnEntry`, authorizer and `reference` on detail/rows/export, `notification-health` | contract tests for the refusal codes and shapes |
| A-2 | Migration A + entities (authorizer column, status flag, backfill) | migration test: backfill fills from a seeded `return.status_changed` entry, leaves unknown `null`, is idempotent |
| A-3 | Status effects in the transition service (R-7.3): RMA, `authorizedAt`, `authorizedBy`, dedicated e-mail on every path into `authorized`/`rejected` | integration: `/transition` and `/bulk-transition` into `authorized` stamp all three and send one e-mail |
| A-4 | `returns-notifications` queue, processor, recipients (R-2, R-3, R-4), four templates (R-5) | unit: processor with stub ports (dedupe ids, invalid recipient skipped, ≤10, bell only for `returns:read`, admin_notifications absent); integration: submit → jobs |
| A-5 | Producers: case created, comment notify, status entered; no status e-mail for `authorized`/`rejected`, for a customer's own transition (D-13) or on filing (D-2) | integration: one e-mail per transition; nothing for old comments; nothing on marking a status; nothing on the customer's cancel; only the confirmation on filing |
| A-6 | Admin UI: status toggle (disabled on the two; hint on the initial status), the recipients alert (D-7), comment box labelled and internal by default with the notify rule (D-16, D-17), translated card titles (D-17), authorizer on detail, list column, the reference as link text (D-4), export | admin component tests; `i18n:hardcoded` clean |
| A-7 | Manifest (settings, e-mails, `admin_users` dep, `admin_notifications` non-binding), docs for phase A, generated artefacts, off-state test, phase-boundary verification | `off-state.test.ts` extended; `check:*` |

### Phase B — the complaint without a platform order (after A)

| WP | Content | Tests first |
| --- | --- | --- |
| B-1 | Contracts (customer + admin), events, error codes | contract tests |
| B-2 | Migration B + entities (nullable order, line fields, attachment reclassification, clauses) | migration test incl. `organization_id` backfill; tenancy classification check |
| B-3 | `return_case.create` as a Command (both paths), the no-order branch (R-9, R-10, R-17), idempotency (R-18), event → `case_submitted` | the R-10 table, row by row; Principle XI cross-tenant tests |
| B-4 | Uploads and attachments (R-12): routes, magic-byte check, claim, serve, limits | refusals; another customer / signed out → 404; admin read; claim of a foreign upload refused |
| B-5 | Clauses (R-14): entity with `appliesTo`/`mode`/link, `clausesFor` (D-1), Commands, admin page (D-10 primitives), palette action, `form-config` (with `confirmationEmailEnabled`, `today` — R-21), the state port in `transactional_emails`, acceptance check | stale revision refused; stored text survives an edit; no `must_accept` clause on a consumer withdrawal; `inform_only` stored without a tick |
| B-6 | Settlement (R-19), from authorization until closed (D-5) | `refund`/`credit`/corrective refused on off-platform; `settled_outside` needs a note, works from `authorized`; refused on order cases |
| B-7 | List filter (no URL sync, D-6), saved views, export, detail blocks incl. erasure date (D-8), customer-list fields (D-3) | admin tests |
| B-8 | Erasure and maintenance (R-15) | event erases; reconciliation catches a missed one; expired uploads swept |
| B-9 | Storefront, applying `design-review.md`: path choice, no-order form, prefill with extracted `AddressFields` (D-18), attachment field, clause list (modes, link), route handlers incl. the over-30 MB outcome (D-9), error on no selected line (D-15), login redirect keeping the query (D-14), success panel (FR-B37, D-11), customer list (D-3, D-4), case page | SSR + route-handler tests; no-JS post; attempt cookie |
| B-10 | Manifest (settings, deps, palette, error codes), docs for phase B, the one changeset, generated artefacts, off-state, final verification | `off-state.test.ts`; `check:*`; designer review (`design-review.md`) applied in B-9 |

### Migrations foreseen (both in the one MR)

| Phase | Owner | Purpose | Depends on |
| --- | --- | --- | --- |
| A | `returns` | `return_cases.authorized_by_admin_user_id` + backfill from `audit_log_entries`; `return_statuses.notify_customer_on_entry` | the kernel audit table (platform, always earlier) |
| B | `returns` | nullable `order_id`, purchase/contact/address/clauses/note/submission-key/erasure columns and checks; nullable line order/product + `serial_number`; attachment reclassification (+ `organization_id` backfill); `return_case_clauses` | migration A |

No other module's migration. Numbers/timestamps come from `migration:new`.

## Requirement → test traceability

| FR | Test (file under `backend/test/integration/returns/` unless stated) |
| --- | --- |
| FR-A01, A02, A05 | `notifications.test.ts` (extended): recipients per channel, invalid skipped, ≤10 |
| FR-A03, A04 | `notifications-bell.test.ts`: `returns:read` holders only; `admin_notifications` off |
| FR-A10, A11 | `notifications.test.ts`: confirmation to the filer; deactivated template |
| FR-A20–A22 | `comments.test.ts` (extended) + contract test for `notify_requires_customer_visible` |
| FR-A30–A33 | `status-notifications.test.ts`: one e-mail per transition; none on marking; none for the two |
| FR-A40–A43 | `authorize-rma.test.ts` (extended: every path); `authorizer-backfill.test.ts` (migration) |
| FR-A44 | `case-reference.test.ts` (unit); `list-and-bulk.test.ts` (reference, search); `notifications.test.ts` (in e-mails) |
| FR-A50, A51 | processor unit tests (`services/notifications/*.test.ts`): failure contained, messageId dedupe |
| FR-A52 | `audit.test.ts` (extended): status flag write audited |
| FR-B01, B02 | `off-platform-toggle.test.ts` |
| FR-B10–B15 | `off-platform-submit.test.ts` (+ cross-tenant), `submit-case.test.ts` regression |
| FR-B16, B17 | `off-platform-submit.test.ts` (snapshot, account untouched) |
| FR-B20–B24 | `attachments-upload.test.ts`, `attachments-access.test.ts` |
| FR-B30–B32 | `clauses.test.ts` |
| FR-B33, B33a | `off-platform-settlement.test.ts` |
| FR-B34–B36 | `list-and-bulk.test.ts` (extended), `off-platform-detail.test.ts` |
| FR-B37 | storefront `returns-case-page.test.tsx` (success panel, conditional e-mail sentence) |
| FR-B40 | `off-platform-submit.test.ts` (jobs enqueued) |
| FR-B41 | `i18n:hardcoded`, `check:bundle-pairing`, storefront `defineMessages` compile |
| FR-B42 | `audit.test.ts` (extended): `return_case.create` once, no hand-written duplicate |
| FR-B43 | `erasure.test.ts` |

## What the plan changed in the spec

Recorded in the spec's *Clarifications* so the two agree:

1. **The *Authorized by* column is not sortable** (US4, FR-A41) — the name is `admin_users`' data
   and cannot be ordered in the returns query (research R-8).
2. **A 30 MB total per submission** (FR-B20) — the bound of the storefront route handler that makes
   the form work without JavaScript (research R-13).
3. **Recipients are validated at send, not at save** (FR-A01) — the settings store validates no
   list item, as `orders.confirmation_recipients` shows (research R-4).

The plan also repairs a defect the spec's FR-A40 exposed (research F3): entering `authorized` or
`rejected` through the generic or bulk transition had none of the authorization's effects.

## Design review rulings (2026-11-13) — where each lands

| Finding | Ruling | Lands in |
| --- | --- | --- |
| D-1 | clause `appliesTo` + `mode` (`must_accept` \| `inform_only`); never gates a consumer withdrawal | FR-B30/B31; research R-14 (`clausesFor`); data-model §2.4; admin-api B5; customer-api C1/C3; WP B-5 |
| D-2 | filing is not an entry into the initial status | FR-A31; research R-7; admin-api A2; WP A-5, A-6 |
| D-3 | `productLabel`, `lineCount`, `purchaseDate` on the summary | FR-B36; research R-23; admin-api B1; WP B-7, B-9 |
| D-4 | derived reference `#XXXXXXXX` until an RMA number exists | FR-A44; research R-20; admin-api A3; e-mail variable `caseReference`; WP A-1, A-4, A-6, B-9 |
| D-5 | `settled_outside` from authorization until closed | FR-B33a; research R-19 (settlement-only entry into `resolved`); admin-api B4; WP B-6 |
| D-6 | no URL sync of list filters | FR-B35; admin-api B1; WP B-7 |
| D-7 | recipients alert on the statuses page | US1 s2; research R-22; admin-api A5; WP A-6 |
| D-8 | `personalDataErasedAt` (date) | FR-B43; research R-23; admin-api B2; WP B-7 |
| D-9 | no-JS over-30 MB: 303 back with `error=too_large`, copy in en/pl | research R-13; WP B-9 |
| D-10 | clauses-page primitives named | Constitution IX row above; research R-14; WP B-5 |
| D-11 | `confirmationEmailEnabled` in `form-config` — **needs a new read port in `transactional_emails`** | FR-B37; research R-21; settings-emails-events §6; WP B-5 |
| D-12 | `today` in `form-config` | FR-B13; research R-21; customer-api C1; WP B-5, B-9 |
| D-13 | no status e-mail for the customer's own transition | FR-A31; research R-7; WP A-5 |
| D-14 … D-18 | login redirect keeps query; error on no line; comments internal by default; labelled comment box + i18n titles; extracted `AddressFields` | WP A-6 (D-16, D-17), WP B-9 (D-14, D-15, D-18) |
| — | clause may carry a link to a full terms page | FR-B30/B31; research R-14; data-model §2.4 |
| — | no processing-time promise on the success panel | FR-B37; WP B-9 |

## Follow-ups (outside this feature, recorded)

- Convert `ReturnTransitionService.apply` to a Command (Principle XIII residual above).
- `return_cases.organization_id` `not null` once legacy rows are reconciled (Principle XI residual).
- A `format`/`maxItems` constraint for `string_list` settings in the settings store (R-4).
- Feed returns into the customer notification centre and push of
  `specs/179-rfq-and-customer-notifications/` (spec Assumptions).

## Complexity Tracking

No violation to justify. **No new runtime dependency for the platform.** `mod-returns`' own
`package.json` gains three **peer** (and matching dev) dependencies it did not declare before, each
already declared by sibling modules and the backend at the same ranges: `bullmq` ^5 and `ioredis` ^5
(phase A, as `mod-forms`), `@fastify/multipart` ^10 (phase B, as `mod-crm`, `mod-projects`, `mod-tasks`,
`mod-pwa`, `mod-assets-library`). Nothing new enters the lockfile's resolved set.

## Handoff to `endora-commerce-dev`

Implement the whole feature as **one merge request** on `feat/180-off-platform-complaints` in
`/Users/alandolina/Sites/wt-180`, following `tasks.md` in order, test-first.

- **Phase A first** (WP A-1 → A-7). Its brief is research R-2 … R-8 and contracts/admin-api.md
  § *phase A*; `forms`' notification worker is the code model. End phase A with the
  phase-boundary verification task, and do not start phase B until the branch is green.
- **Then phase B** (WP B-1 → B-10), on the same branch. Its brief is research R-9 … R-19 and
  contracts/customer-api.md. The storefront form (B-9) applies the designer's
  `design-review.md`.
- **At both phase ends and at the end of the MR:** `pnpm run build:packages`, `typecheck`, `lint`,
  the targeted tests in quickstart.md, `pnpm --filter '!backend' run test`, regenerated artefacts,
  and a grep of `backend/test/**` for anything moved or removed.
