# Implementation Plan: Complaints from guests without a customer account

**Branch**: none of its own. Built in the working tree of `feat/180-off-platform-complaints`, on top of 180's uncommitted work, and split at commit time (owner ruling 2) | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/181-guest-complaints/spec.md` (owner decisions G1–G11)

**Agent context.** `.specify/scripts/bash/update-agent-context.sh` was **not run** for this plan,
and `AGENTS.md` was not edited: its appendix carries 180's uncommitted change in this working tree.
It is regenerated on 181's own branch. The plan declares no new dependency, so the run adds only the
slug to *Recent Changes*. `setup-plan.sh` was not run either, because `.specify/feature.json` still
points at 180. This file was copied from the template by hand.

## Summary

`returns` lets a person **without an account** file a complaint about a product **bought
elsewhere**, on 180's no-order form, after **verifying an e-mail address** by a one-time link. The
case has **no customer account and no organization**: the column `customer_account_id` becomes
nullable, and a database check forbids a guest case that carries an organization. Only unrestricted
admins see guest cases, through the platform's existing tenant filter. The guest follows the case
through a **private tracking link**: a deterministic, purpose-sealed reference derived from the case
id and a version number, so nothing secret is stored and every e-mail can carry the same link. Guest
writes (filing, comments, files) run as Commands with a `by: 'guest'` audit state. Seven guest
e-mail twins carry the tracking link; the verification and the confirmation cannot be switched off.
The daily maintenance sweep erases guest contact data, address and files a configurable time (default
90 days) after the case enters a terminal status. An admin with a new permission erases them on
request. Everything is behind 180's no-order setting and a new per-channel *Complaints from guests*
setting, off by default, and disappears with the module.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17
**Primary Dependencies**: existing only. Fastify (`@fastify/rate-limit` and `@fastify/multipart`
through existing registrations), MikroORM (PostgreSQL), Zod, BullMQ, `node:crypto` (SHA-256 for
session-token and e-mail hashes); the platform's `cursorSeal` (research R-5); Next.js 15
(storefront); React 19 (admin). **No new runtime, dev or workspace dependency.**
**Storage**: PostgreSQL. One `returns` migration (data-model §7) and one new table,
`return_guest_verifications`. Guest file bytes go through `objectStoragePort` under `returns/guest/`.
**Testing**: Vitest. Module co-located `*.test.ts`, `backend/test/integration/returns/guest-*.test.ts`,
`backend/test/contract/returns/`, storefront SSR and route-handler tests under `storefront/test/returns-guest/`.
**Target Platform**: backend API and worker processes, admin SPA, storefront SSR.
**Project Type**: web monorepo (`packages/modules/returns`, `packages/contracts`, `storefront/`).
**Performance Goals**: the verification request does constant work whatever the address (research
R-3), and e-mails are queued. SC-001 (under 6 minutes) is a UX target the designer validates.
**Constraints**:
- no guest case visible to a scoped admin or a customer;
- nothing token-like stored;
- the no-JavaScript form keeps working;
- every guest e-mail carries the current tracking link;
- module off means absent.

**Scale/Scope**: one module; 1 table and 1 migration; 2 settings; 7 e-mail templates; 1 permission;
about 11 backend routes, 2 admin routes and about 13 storefront routes and pages.

## Constitution Check

*Gate before Phase 0, re-checked after Phase 1. Constitution: `.specify/memory/constitution.md`.*

| Principle | Verdict | How |
| --- | --- | --- |
| I. Modular (NN) | **Pass** | Everything is owned by `returns`. It uses ports already declared (`adminTenantScopePort`, `customerAccountReadPort`, `TransactionalEmailSender`, `objectStoragePort`, catalog availability). The honeypot rule is re-implemented locally rather than importing `forms` (research R-8). No FK and no read of another module's table, including in the migration (research R-2). |
| II. API-first | **Pass** | `packages/contracts/src/returns.ts` lands first (contracts/). The only widening, `customerAccountId` becoming nullable, is a `minor` in 0.x (D-225). |
| III. TDD (NN) | **Pass** | Every FR traces to a test (*Traceability* below). Each WP is test-first. |
| IV. YAGNI / deps | **Pass** | No new dependency. It reuses 180's form, uploads, settlement, notifications queue and maintenance worker, and the platform's seal and rate limiter. No new port and no new worker. |
| V. TypeScript | **Pass** | `customerAccountId: string \| null` is propagated by the compiler. That is the point of G-2. |
| VI. Naming (NN) | **Pass** | `return_guest_verifications`, `returns.guest_*` settings, `return_guest_*` e-mail codes, dot-namespaced Commands, `returns:erase_personal_data`. |
| VII. SEO/perf | **Pass** | Guest pages are Server Components with `noindex` and `Referrer-Policy: no-referrer`. The form posts to route handlers that work without JavaScript. |
| VIII. English (NN) | **Pass** | All artefacts are in English; user copy is in English and Polish. |
| IX. UI reuse | **Pass** | Storefront: 180's `OffPlatformLines`, `LineSlots`, `AttachmentField`, `ClauseList`, `ProductField`, the account form classes, the attempt cookie and the error summary shape; no new primitive. Admin: `Select`, `Badge`, `RowActionMenu`, `ConfirmDialog`. The designer reviews the guest entry, verification and tracking pages before G-8 (handoff). |
| X. Queue consumers | **Pass** | New jobs ride `returns-notifications` and `returns-maintenance`, which are existing workers with ids-only jobs. |
| XI. Tenancy (NN) | **Pass: review recorded in research R-1** | `ReturnCase` stays `@OrgScoped`. A guest case has neither an account nor an organization (a database check forbids an organization), so only `all`/`system` can read it. Anonymous traffic runs in system mode, so every guest and tracking query goes through one home, `GuestCaseAccess`, keyed by the session or the opened token. The new verification table is `@GlobalEntity`. Cross-tenant tests are listed in R-1. Residual (180's, unchanged): legacy customer cases with an account and no organization (R-2). |
| XII. Channel scoping (NN) | **Pass** | Settings, clauses, product availability and the session's channel all come from the resolved request channel. A session is valid only on its channel. |
| XIII. Command Bus (NN) | **Pass** | New sensitive writes are Commands: guest filing (`return_case.create`), guest comment, guest file, link reissue, guest erasure (research R-6). Verification and session rows are not case writes and are `command-coverage-ignore` with a reason. 180's transition residual is unchanged and not widened. |
| XIV. Extensibility | **N/A, reasoned** | The new columns drive behaviour (visibility, erasure, link validity). They are not "add a field". |
| XV. Untouched core | **Pass** | Templates, retention and the toggle are operator configuration. No overlay is needed. |
| XVI. Palette | **Pass** | No new admin destination. `returns-list` already reaches the list, where the guest filter lives. |
| XVII. Toggleable (NN) | **Pass** | New routes go through `ctx.routes`, jobs through the existing `ctx.worker`s, and storefront pages sit behind `requireModulePresent('returns')`. The guest setting is evaluated after the module gate and requires 180's setting (it fails closed). Erasure postponed while the module is off is disclosed. It is not an exception, because a worker for an absent module would break the principle (research R-9). `off-state.test.ts` is extended. |

**Verdict: PASS.** Re-checked after Phase 1 (data-model, contracts), with no change. The three questions raised were ruled by the owner on 2026-11-16 (below).

## Owner rulings (2026-11-16)

Recorded in spec § *Clarifications*.

| # | Question | Ruling |
| --- | --- | --- |
| 1 | May `returns` use the platform's `cursorSeal` for the tracking and verification links? | **Yes.** `packages/platform/src/composition/cursor-seal.ts`' header paragraph is amended. That edit is a task, and its release intent is an empty changeset (comment only). Rotating `SESSION_COOKIE_SECRET` voids every guest link; *Send a new tracking link* is the remedy (research R-5). |
| 2 | Where is 181 built? | **Now, in the same working tree, on top of the uncommitted 180** (`feat/180-off-platform-complaints`). No new branch. 180's state is saved at `.git/f180-snapshot-2026-11-16`. The work is split at commit time into two MRs: 180 first, 181 stacked. `update-agent-context.sh` stays deferred to commit time. Supersedes research R-14's recommendation. |
| 3 | What does "closed" mean? | **Entered a terminal status.** `closed_at` is written from now on (research R-9). |

## Cross-cutting design (the routed checklists)

| Concern | Design |
| --- | --- |
| Admin permissions (`module-admin-surfaces.md`) | New code `returns:erase_personal_data` (`requires: ['returns:read']`): manifest entry, `requireAdmin` literal, `adminRoles.permission.*` labels in English and Polish, a `hasPermission` check on the action, and the permission-inventory contract test. |
| Command palette | No new action (XVI row above). |
| i18n (`module-i18n.md`) | Admin strings go in `packages/modules/returns/i18n/{en,pl}.json`: guest badge, origin options, detail labels, two actions, confirm copy, permission label, error sentences `errors.<CODE>`, the *(guest)* suffix for the shop e-mail. E-mail defaults are `en-US` + `pl-PL` in `transactional-defaults.ts`. Storefront copy goes in `storefront/lib/i18n/messages/core.ts` under `returns.guest.*`. |
| Settings | Two `returns.*` settings (data-model §5). No secret. |
| Auditing (`audit-state.md`) | Research R-6. Names and counts only. No contact value, e-mail, comment body or token ever enters audit state (FR-073). |
| Tenancy | Research R-1 (above). |
| Cache invalidation | None introduced. No Redis-cached value depends on these rows. Settings reads use the settings module's own cache. |
| Activation | Research R-12 (above). |
| Migrations (`module-migrations.md`) | One `returns` migration, `returns_guest_complaints`, scaffolded with `migration:new` and registered with `composer:generate` (data-model §7). No other module's migration. |
| Documentation (`module-documentation.md`) | `packages/modules/returns/docs/returns.md`: a new section *Complaints from guests* (verification, tracking link, retention and erasure, who sees guest cases, key-rotation note, module-off postponement, anonymisation not matching guest cases), plus additions to *Notifications* (twins), *Attachments* and *In the audit log*. Polish per `docs/docs/contributing/documentation-i18n.md`. |
| Release intent (`release-intent.md`) | One changeset: `@endora-commerce/contracts` minor (guest schemas, nullable `customerAccountId`), `@endora-commerce/mod-returns` minor. Plus the `cursor-seal.ts` doc paragraph (ruling 1), a comment-only change whose release intent is an **empty changeset** (`pnpm changeset --empty`, `specs/conventions/release-intent.md`). |
| Generated artefacts | `composer:generate` after the migration and the manifest changes; `manifests:generate` + `pnpm install --lockfile-only` if `mod-returns`' `package.json` changes (not expected). |
| Commercial data (`commercial-data.md`) | No counterparty, price or effort figure in any artefact. |

## Project Structure

### Documentation (this feature)

```text
specs/181-guest-complaints/
├── spec.md
├── plan.md                  # this file
├── research.md              # F1…F18, R-1…R-14
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── guest-api.md
│   ├── admin-api.md
│   └── settings-emails-events.md
├── checklists/requirements.md
├── design-review.md         # written by the designer in task T061, before G-8
└── tasks.md                 # T001–T087, five hand-off batches
```

### Source code

```text
packages/contracts/src/returns.ts                         guest schemas, nullable customerAccountId, origin, events, errors

packages/modules/returns/
├── src/manifest.ts                                       settings, 7 e-mails, permission, error codes
├── src/migrations/<ts>_returns_guest_complaints.ts       new
├── src/backend/
│   ├── index.ts                                          compose GuestCaseAccess, guest services, cursorSeal (typed locally)
│   ├── routes.guest.ts                                   new: G1–G10
│   ├── routes.admin.ts                                   origin, search, reissue, erase
│   ├── entities/return-case.entity.ts                    customerAccountId nullable; guest columns
│   ├── entities/return-case-comment.entity.ts            authorGuest
│   ├── entities/return-case-attachment.entity.ts         guestSessionId, uploadedByGuest
│   ├── entities/return-guest-verification.entity.ts      new, @GlobalEntity
│   ├── services/guest/guest-case-access.ts               new: the only guest/tracking query home (R-1)
│   ├── services/guest/guest-verification-service.ts      new: request, redeem, leave, throttles (R-3, R-4, R-8)
│   ├── services/guest/guest-tracking-link.ts             new: seal/open, validity (R-5)
│   ├── services/guest/guest-erasure.ts                   new: Command return_case.guest_data.erase (R-9)
│   ├── services/guest/honeypot.ts                        new (local, R-8)
│   ├── services/guest/guest-availability.ts              new: effective setting (no-order ∧ guest, request channel)
│   ├── services/notifications/customer-message.ts        new: customerMessageFor (R-7)
│   ├── services/return-case-service.ts                   guest filing branch; mapDetail guest fields
│   ├── services/return-attachment-service.ts             session-owned uploads; guest storage prefix
│   ├── services/return-comment-service.ts                guest comment Command; authorKind guest
│   ├── services/return-transition-service.ts             write closed_at on terminal entry
│   ├── services/return-list-service.ts                   origin values, e-mail search, guest label
│   ├── services/return-export-service.ts                 guest column
│   ├── services/return-case-scope.ts                     type widening only
│   ├── services/return-email-notifier.ts                 authorized/rejected via customerMessageFor
│   ├── services/notifications/dispatch.ts                customerMessageFor; guest_verification, guest_link_reissued jobs
│   ├── services/notifications/admin-bell.ts              allowAll filter for guest cases
│   ├── email-templates/transactional-defaults.ts         7 defaults en-US + pl-PL
│   └── workers/returns-maintenance-worker.ts             retention erasure + verification purge steps
├── src/admin/pages/ReturnsList.tsx                       origin options, guest badge
├── src/admin/pages/ReturnDetail.tsx                      guest card lines, two actions, guest comment label
├── i18n/{en,pl}.json
└── docs/returns.md

packages/platform/src/composition/cursor-seal.ts          header paragraph only (ruling 1, accepted)

storefront/
├── app/returns/guest/**                                  entry, request, sent, verify, new, uploads, submit, submitted, leave, layout
├── app/returns/track/[token]/**                          page, comments, attachments, files, layout
├── app/(account)/returns/new/page.tsx                    signed-out redirect to /returns/guest when enabled
├── app/(account)/returns/page.tsx                        same for the list entry
├── lib/api/returns-guest.ts                              guest API client (cookie / header forwarding)
├── lib/session.ts                                        b2b_returns_guest cookie helpers
├── components/returns/*                                  guest mode props on the reused leaves (no new primitive)
└── lib/i18n/messages/core.ts                             returns.guest.*

backend/test/integration/returns/guest-*.test.ts          see traceability
backend/test/contract/returns/guest-*.test.ts
storefront/test/returns-guest/*.test.ts(x)
```

**Structure decision.** Extend `returns`, with no new module (research R-12). The storefront follows
180's route-handler pattern (research R-13).

## Delivery and sequencing

**One merge request**, built in this order. The branch is green at the end of G-2 and at the end of
the MR.

| WP | Content | Tests first |
| --- | --- | --- |
| G-1 | Contracts: guest schemas (G1–G10), widened summary/detail, origin enum, event `guest`, error codes | contract tests for shapes, `.strict()` refusal of account/org/order fields |
| G-2 | Migration + entities; `customerAccountId: string \| null` propagated through every service and admin page (compile-driven); `closed_at` written on terminal entry. **Phase boundary: green.** | migration test: checks refuse a guest-with-org and a malformed guest row; existing rows pass; `down` refuses with guest rows. Regression: the whole `test/integration/returns/` suite unchanged |
| G-3 | Guest identity: verification request (uniform answer, supersession, throttles, honeypot), the `guest_verification` job and template, redeem (scanner-safe POST), session lookup, leave; the `cursorSeal` wiring | unit: seal purposes do not cross; throttle counts. Integration `guest-verification.test.ts`: identical answers for account / no account / throttled / honeypot; link one-time, 60 min, superseded; 410 for each invalid shape; session channel-bound |
| G-4 | Guest filing: session-owned uploads, `return_case.create` guest branch, idempotency, limits; notifications: `customerMessageFor`, `return_guest_submitted`, the shop e-mail's guest name, bell `allowAll` narrowing | `guest-submit.test.ts` (both columns null, verified e-mail, proof rule, clauses, foreign upload refused, key replay per session); `guest-notifications.test.ts` (confirmation always sent even with `return_submitted` off; shop e-mail names guest only; bell skips a sales rep) |
| G-5 | Tracking: `GuestCaseAccess`, read, comment Command, file add and download, read-only when closed, link validity (90 days, erasure, version); reissue route + `return_guest_link_reissued`; guest twins for comment, status, authorized, rejected | `guest-tracking.test.ts` (token A cannot reach B; expired/replaced/erased/garbage → identical 404; internal comments absent; closed → `case_terminal`); `guest-emails.test.ts` (every guest e-mail carries the current link; none after erasure) |
| G-6 | Admin: origin filter, e-mail search, guest label, export, detail fields, the two actions, permission, i18n | `guest-admin-visibility.test.ts` (**Principle XI matrix**, research R-1); `list-and-bulk.test.ts` extended; permission-inventory contract test; admin component tests |
| G-7 | Erasure: retention setting (clamped), sweep step, verification purge, manual erase; anonymisation non-match | `guest-erasure.test.ts` (due/not due, clamp, comments kept, files deleted, audit names only, idempotent, module-off postponement then catch-up); `erasure.test.ts` extended (account anonymisation leaves a guest case with the same e-mail) |
| G-8 | Storefront, after the designer's review of the new pages: entry choice and signed-out redirects, verification pages, guest form in guest mode, submit and uploads handlers, success page, tracking page and handlers, cookie helpers, headers (`noindex`, `no-referrer`) | SSR and route-handler tests in `storefront/test/returns-guest/`: no-JS post, attempt cookie, uniform *sent* page, GET verify does not redeem, route precedence over `(account)/returns/[id]`, not-found while the module is off |
| G-9 | Manifest wrap-up, docs (English and Polish), changeset(s), generated artefacts, off-state, final verification | `off-state.test.ts` extended (every guest route 404, no job enqueued, storefront pages not found); `check:*`; `pnpm --filter '!backend' run test` |

### Migrations foreseen

| Owner | Purpose | Depends on |
| --- | --- | --- |
| `returns` | `returns_guest_complaints`: nullable `customer_account_id` + guest columns, checks and indexes on `return_cases`; `author_guest` on comments; guest ownership on attachments; `return_guest_verifications` | 180's `returns_off_platform_complaints` |

There is no other module's migration. The timestamp comes from `migration:new`.

## Requirement → test traceability

| FR | Test (under `backend/test/integration/returns/` unless stated) |
| --- | --- |
| FR-001, FR-002 | `guest-availability.test.ts`: off by default; on but no-order off → disabled; per channel; existing cases still tracked |
| FR-010, FR-011 | storefront `returns-guest/entry.test.tsx` (choice, `next` keeps path+query, redirect only when enabled); `track-page.test.tsx` (`noindex`) |
| FR-020–FR-026 | `guest-verification.test.ts`; maintenance unit test for the 7-day purge |
| FR-030–FR-036 | `guest-submit.test.ts`; storefront `submit-route.test.ts`, `submitted-page.test.tsx` |
| FR-040–FR-046 | `guest-tracking.test.ts`, `guest-emails.test.ts`, `guest-link-reissue.test.ts`; seal unit tests |
| FR-050–FR-052 | `guest-notifications.test.ts` |
| FR-060–FR-064 | `guest-admin-visibility.test.ts`, `list-and-bulk.test.ts`, `guest-settlement.test.ts` |
| FR-070–FR-075 | `guest-erasure.test.ts`, `erasure.test.ts`, `status-graph` unit test (no exit from terminal) |
| FR-080 | `off-state.test.ts`; storefront `returns-guest/off-state.test.tsx` |
| FR-090 | `i18n:hardcoded`, `check:bundle-pairing`, storefront `defineMessages` compile |
| FR-091 | `audit.test.ts` extended: each guest Command once, `by: 'guest'`, no values |
| FR-092 | permission-inventory contract test; admin `ReturnDetail` test (actions gated) |
| FR-093 | docs pairing check (`module-documentation.md`) |

## What the plan changed in the spec

Recorded in spec § *Clarifications* (session 2026-11-16, accepted with the rulings):

1. **Origin filter** (FR-061): `off_platform` (*bought elsewhere*, both kinds) stays as a fifth
   option beside the spec's four, so 180's saved views keep their meaning (research R-10).
2. **Retention range** (FR-070) is enforced by clamping at read. The settings store validates no
   range (research R-9).
3. **"Closes"** means "enters a terminal status". FR-074 holds by the graph invariant that terminal
   statuses have no exit (research R-9).
4. **Opening a verification link does not redeem it**: the page asks for one click (*Continue*), so
   mail scanners cannot consume it (research R-3).
5. **Per-client-address throttling answers 429.** It names no address, so it does not conflict with
   FR-021's identical answer per address (research R-8).

## Follow-ups (outside this feature, recorded)

- Path A (guest case against a platform order), guest returns, manual *attach to customer*,
  guest-specific clauses, a *resend my links* self-service (spec *Out of scope*).
- 180's: reconcile legacy null-organization customer cases, then `not null` (research R-2).
- 180's: convert `ReturnTransitionService.apply` to a Command (Principle XIII residual).

## Complexity Tracking

No violation to justify. **No new runtime dependency.** Nothing enters `mod-returns`' `package.json`.
The platform's `cursorSeal` is a container registration that already exists (ruling 1), not a
dependency.

## Handoff to `endora-commerce-dev`

Implement in the **current working tree**, on top of 180's uncommitted work (ruling 2). Use no new
branch, and never `git stash` (the stash list is shared by every worktree). Follow `tasks.md` in WP
order G-1 → G-9, test-first, using the hand-off batches named at its top. The split into the 180 MR
and the stacked 181 MR happens at commit time against `.git/f180-snapshot-2026-11-16`.
- **G-2 is the risky step.** Make `customerAccountId` nullable and let the compiler find every
  assumption (62 references in `returns` services, plus the admin pages). End G-2 green, with the
  existing returns suite unchanged, before any guest behaviour exists.
- **R-1's static rule is part of the definition of done.** Guest and tracking routes reach case rows
  only through `GuestCaseAccess`. Add the test that pins it.
- **The designer** reviews the guest entry, the verification pages, the guest form's locked e-mail,
  the success page and the tracking page before G-8.
- **At the end:**
  - `pnpm run build:packages`, `typecheck`, `lint`;
  - the targeted tests in quickstart.md;
  - `pnpm --filter '!backend' run test`;
  - `composer:generate`, with the regenerated artefacts committed;
  - a grep of `backend/test/**` for anything renamed;
  - `update-agent-context.sh` (deferred from this step).
