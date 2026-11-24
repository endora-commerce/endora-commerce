# Implementation Plan: Operator-created quote requests stay drafts until shared with the customer

**Branch**: `feat/192-quote-request-draft-share` | **Date**: 2026-11-24 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/192-quote-request-draft-share/spec.md` (clarified; owner decisions of 2026-11-24). Issue #1901.
**Measured against**: `origin/master` `230f04c30` (release 0.112.0). Upstream drift check at plan
time: `git log origin/master --oneline -- packages/modules/quote_requests packages/contracts/src/quote-requests.ts`
→ newest `4f3baa620` (already in `230f04c30`); nothing newer. Re-run before building (§ *Risks*).

## Summary

An operator's new quote request starts **unshared** (the UI's *Draft*): a boolean on the row,
default `true` = shared, so every existing row and every other creation path stays visible and
only `createOnBehalf` — through one decision function — writes `false`. Every customer read
(list, detail, actions, `customers`' lists, `carts`' quote-to-basket conversion) answers an
unshared quote as one that does not exist; the expiry sweep skips it; no customer notification
is recorded about it. **Share with customer** is a new Command, `quote_request.share`, run
through the Command Bus and declared **hookable** (`beforeCommit`), which is the refusal point
other modules register against (FR-028, using the shipped mechanism of
`specs/176-command-hooks-outbox/`). The share checks priced lines and the customer's
membership, writes the validity date from the days stored on the draft, appends a new `shared`
history event and records the existing `prepared` notification on it — the matrix row moves from
`created` to `shared`. A global setting `quote_requests.default_validity_days` (0) is snapshotted
into new quotes. The Admin UI gets the share action, *Create and share*, a *Draft* badge and
filter, and the "counts from sharing" validity hint. Owner answers of 2026-11-24 (round 3,
`spec.md` § *Clarifications*): an operator draft may hold unpriced lines (FR-013); the customer's
history starts at the share (FR-012); a typed `0` on a draft means no deadline; a blocked account
refuses the share; *Create and share* stops on create warnings.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17 (repo baseline)
**Primary Dependencies**: existing only — Fastify, MikroORM (PostgreSQL), Zod, the platform
Command Bus and command hooks (`@endora-commerce/platform/commands`), React 19 admin with
`@endora-commerce/admin-kit`. **No new dependency.**
**Storage**: PostgreSQL — four columns on `quote_requests`, one value added to
`qre_event_type_check`; one module migration.
**Testing**: Vitest — module co-located unit tests (`packages/modules/quote_requests/src/**/*.test.ts`),
backend contract and integration suites (`backend/test/{contract,integration}/quote_requests/`),
admin component tests (`admin/test/modules/quote_requests/`).
**Target Platform**: backend API + Admin SPA; storefront: one history label (`shared`).
**Project Type**: modular monorepo; one owning module (`quote_requests`), one consumer touched
(`carts`, one check), contracts.
**Performance Goals**: no new query on any hot path except one boolean predicate on the customer
list and the sweep; the share is one row lock + one line read + one account read.
**Constraints**: FR-024 at-most-once share under concurrency (row lock); a refused share writes
nothing (single transaction, hooks inside it).
**Scale/Scope**: ~25 backend files, ~6 admin files, 3 contracts files, 1 migration.

## Constitution Check

*Gate before Phase 0 and re-checked after Phase 1 design — both pass.*

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | Pass | All state and logic in `quote_requests`. Other modules touched only through published surfaces: `carts` reads the new `QuoteRequestRecord.sharedWithCustomer` field of `quoteRequestReadPort`; a future consumer vetoes through the published hookable-action ref. No cross-module internal import. |
| II API-first | Pass | Zod first in `packages/contracts/src/quote-requests.ts` and new `quote-request-hooks.ts`; changes additive or input-widening (`contracts/admin-api.md`). |
| III TDD (NN) | Pass | Every task block starts with failing tests; FR → test map in `tasks.md`. |
| IV YAGNI / deps | Pass | No dependency. No setting for "drafts off" (R-2). Only `beforeCommit` declared (R-4). |
| V / VI / VIII | Pass | TypeScript; `shared`/`unshared` naming avoids the module's existing "draft" (research § Vocabulary); English artefacts. |
| VII SEO | N/A | Storefront gains one label in an SSR page; no rendering change. |
| IX UI reuse | Pass | `Badge`, `Button`, `useConfirmDialog` (already used by `RfqDetail.tsx`), `PageHeader` actions, `MultiSelect` filter from admin-kit; no new primitive. |
| X Queues | Pass | No new worker; the sweep's predicate changes; delivery reuses the notification worker and kick. |
| XI Tenancy (NN) | Pass | `QuoteRequest` stays `@OrgScoped`; the share reads under the caller's scope and `adminCanSeeOrganization`; no no-organization path. |
| XII Channel scoping (NN) | Pass | No channel-scoped read added; the setting is read globally by owner decision. |
| XIII Command Bus (NN) | Pass | The share is a **new** sensitive write, so it is a Command (`quote_request.share`) audited by the bus, with no hand-placed audit call; it is not reversible (it sends e-mail — an irreversible side effect, so no undo). Create/modify/cancel are existing writes of a not-yet-migrated module and keep their existing co-transactional audit (the principle's incremental-migration clause); their changed fields land in the same entries. |
| XIV Custom fields | Pass | No bespoke field for something a custom field could carry: the four columns are workflow state read by business rules. |
| XV Untouched core | Pass | The hook is the overlay-facing seam for a deployment's approval rule. |
| XVI Palette | Pass | No new destination (R-15). |
| XVII Toggleable (NN) | Pass | New routes live in the module's plugin; off-state assertions added (R-15). |

## Project Structure

### Documentation (this feature)

```text
specs/192-quote-request-draft-share/
├── spec.md
├── plan.md                 # this file
├── research.md             # R-1 … R-17 (decisions, rejected alternatives)
├── data-model.md           # columns, invariants, readers, setting, audit
├── quickstart.md           # manual acceptance walk-through
├── contracts/
│   ├── admin-api.md                     # routes, schemas, refusals, error codes
│   ├── share-hook.md                    # quote_request.share hookable action (FR-028)
│   └── notification-matrix-amendment.md # amends 179's matrix row `prepared`
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/contracts/src/
├── quote-requests.ts            # schemas: event type, history kinds, DTO/summary fields,
│                                #   list `sharing`, expiresInDays nullable, create-defaults,
│                                #   QuoteRequestRecord.sharedWithCustomer
├── quote-request-hooks.ts       # NEW: QUOTE_REQUEST_HOOKABLE_ACTIONS.share + hook data
├── errors.ts                    # RFQ_ALREADY_SHARED, RFQ_SHARE_CUSTOMER_UNAVAILABLE, RFQ_NOT_SHARED
└── index.ts                     # barrel export of quote-request-hooks

packages/modules/quote_requests/
├── src/manifest.ts              # setting, errorCodes (+ QUOTE_INCOMPLETE token `share`), hookableActions
├── src/migrations/<stamp>_quote_requests_quote_request_sharing.ts   # NEW (scaffolded) + index.ts
├── src/backend/entities/quote-request.entity.ts        # four properties
├── src/backend/entities/quote-request-event.entity.ts  # 'shared'
├── src/backend/services/operator-quote-sharing.ts      # NEW: operatorQuoteStartsUnshared(), applyShare(), shareRefusals
├── src/backend/commands/share-command.ts               # NEW: makeShareQuoteRequestCommand
├── src/backend/services/rfq-admin-service.ts           # createOnBehalf, modify, cancel, listAll, share()
├── src/backend/services/rfq-service.ts                 # findVisibleForCustomer, #listSummaries, serializeFull
├── src/backend/services/rfq-expiry-worker.ts           # dueRequests predicate
├── src/backend/services/quote-request-read-port.ts     # record field
├── src/backend/services/customer-projection.ts         # customer history from the `shared` event on (FR-012)
├── src/backend/services/notifications/notification-matrix.ts (+ .test.ts)
├── src/backend/services/history/history-projection.ts, history-diff.ts
├── src/backend/commands/document-template-commands.ts  # send refuses unshared
├── src/backend/routes.admin.ts                         # POST /:id/share, GET /create-defaults
├── src/backend/index.ts                                # setting reader, deps wiring
├── src/admin/pages/{RfqDetail,RfqCreatePage,RfqList,RfqHistory}.tsx
├── src/admin/validity.ts, src/admin/lib/labels.ts
├── i18n/{en,pl}.json
└── docs/quote_requests.md

packages/modules/carts/src/backend/services/cart-conversion-service.ts   # one check
storefront/lib/account/labels.tsx, storefront/lib/i18n/messages/account.ts  # `shared` history label (en, pl)
packages/modules/_i18n/i18n/{en,pl}.json                                 # rfq.detail.history.entry.shared / change.validity_days
specs/179-rfq-and-customer-notifications/contracts/notification-matrix.md  # row amended
backend/test/fixtures/error-code-routing/reference-ledgers.ts             # MINTED_ERROR_CODES
backend/src/db/migrations-registry.generated.ts                           # composer:generate
.changeset/192-quote-request-sharing.md
```

**Structure Decision**: extend `quote_requests` in place (Principle I: it owns the quote
lifecycle and its visibility); no new module or package.

## Delivery order

Every phase ends green; no phase leaves a quote visible that should not be, or a red suite.

1. **Foundation** (Phase 1): contracts, migration, entity, error codes, the 179 matrix amendment
   document. Default `true` — nothing behaves differently.
2. **US1 guards** (Phase 2): every customer read filter, the `carts` check, the sweep, the
   notification suppression in `modify`/`cancel`, the PDF send refusal, the admin read model and
   the validity-days handling of `modify`. Tests make a quote unshared **directly** (column
   update after an admin create), because `createOnBehalf` still creates shared quotes.
3. **US2 share + switch-over** (Phase 3): the share Command, its hook declaration and route,
   the matrix move, **and in the same phase** `createOnBehalf` starting unshared without the
   creation-time `prepared`, plus the sweep of existing tests that assumed a live operator quote.
   The matrix move and the flip are coupled: `assertSourceEvent` refuses a `prepared` record on a
   `created` event once the row says `shared`.
4. **US3 + regression guards** (Phase 4): the setting, create-defaults, the default snapshot,
   FR-011 guards, off-state. **Review checkpoint A (backend).**
5. **Admin UI** (Phases 5, 6). **Review checkpoint B (admin UI).**
6. **Docs, generated artefacts, changeset** (Phase 7).

## Test strategy

Failing test first in every block. Pure logic (decision function, refusal ordering, validity
arithmetic, matrix, projection filters) as co-located unit tests in the module; routes and
shapes as backend contract tests; transactions, locks, notification records, the sweep and
the hook veto as backend integration tests; screens as admin component tests. PRs do not run
the contract/integration suites (D-198): every phase's **Verification** line names the files to
run by hand, and the builder reports which ran.

## Checks the merge request must pass

`pnpm run build:packages`; `pnpm --filter @endora-commerce/contracts run typecheck`;
`pnpm --filter @endora-commerce/mod-quote-requests run typecheck`;
`pnpm --filter @endora-commerce/mod-carts run typecheck`; `pnpm --filter admin run typecheck`;
`pnpm --filter backend run typecheck`; `pnpm --filter storefront run typecheck`; lint for the same filters;
`pnpm run check:naming && pnpm run check:language`; the generated registries clean after
`pnpm --filter backend run composer:generate`; `pnpm changeset:status`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Existing tests create a quote through `POST /api/v1/admin/quote-requests` (or `createOnBehalf`) and then read it as the customer or count `prepared` records — they turn red. | The switch-over (T026) and the sweep (T027, exact grep, shared helper `shareQuoteRequestForTest`) are in the same phase and push; Phase 2 tests make quotes unshared directly, so no phase ends red. |
| A customer read path is missed (FR-003 leak). | Integration test enumerates every customer route + `carts` conversion + `customers` self list with one draft and asserts `404`/absence (SC-001). |
| Upstream drift in `rfq-admin-service.ts` / `rfq-service.ts` (large, frequently edited files). | Re-run the drift command before Phase 2; rebase early; the measured SHA is recorded above. |
| Hook dispatch semantics change in the platform. | Contract test with a test-only veto hook pins the behaviour this module relies on. |
| A future "drafts off" setting shares at create without running the hooks. | Recorded in `contracts/share-hook.md` §3 and R-2 as a decision that setting's spec must make. |

## Owner answers and the one open question

Answered 2026-11-24 (`spec.md` § *Clarifications*, round 3), folded into the phases:

| Question | Answer | Where |
| --- | --- | --- |
| OQ-1 pre-share history for the customer | hidden; history starts at the share (FR-012) | R-14; T010, T011, T019 |
| OQ-2 `0` days typed on a draft | no deadline (FR-032) | R-10; T014, T022, T026, T028 |
| OQ-3 blocked account | refuses the share, token `blocked` (FR-027) | R-9; T007, T019, T022 |
| OQ-4 `customers`' admin tab | drafts hidden (FR-003) | R-3; T009 |
| OQ-5 unpriced lines on an operator draft | allowed on create and save; share still refused (FR-013) | R-19; T001, T026, T042, T043 |
| OQ-7 *Create and share* with create warnings | stops, keeps the draft, shows the warnings (FR-020) | R-7; T042, T043 |
| OQ-8 quick-order operator build | unchanged (FR-001) | R-18 |
| Contract | `QuoteRequestRecord.sharedWithCustomer` required; `quote_request.share` frozen, `beforeCommit` only | R-3, R-4 |

Still open — **OQ-6**: a draft created long ago and shared today sorts by `createdAt` on the
customer's list. Built: today's order, from one function `customerListOrder()` (R-20). Gated:
T055.

## Complexity Tracking

No violations; nothing to justify. No new runtime, dev or workspace dependency.

## Handoff to `endora-commerce-dev`

Build from `tasks.md` in phase order, single stream (§ *Parallelism* in `tasks.md`). Read
`research.md` R-3, R-4, R-6 before Phase 3; `contracts/admin-api.md` is the shape authority.
Do not start Phase 5 (admin UI) before Phases 3–4 answer as the contract says. Report the
Verification commands actually run per phase.
