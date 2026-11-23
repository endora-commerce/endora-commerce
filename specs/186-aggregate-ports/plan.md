# Implementation Plan: Aggregate ports — one write port per core aggregate

**Branch**: `spec/186-aggregate-ports` | **Date**: 2026-11-23 | **Spec**: `specs/186-aggregate-ports/spec.md`
**Input**: Feature specification from `specs/186-aggregate-ports/spec.md`; ruling D-293.

**Agent context**: `.specify/scripts/bash/update-agent-context.sh` was deliberately **not** run — six
specs (186–191) are being written in parallel and would collide on the `AGENTS.md` appendix. The
feature adds no dependency, so the appendix would gain only a *Recent Changes* line; the orchestrator
adds it once, when the specs merge.

## Summary

Publish one write port per extensible aggregate (`<aggregate>CommandPort`, nine of them plus
`catalogAttributeCommandPort`) whose methods are the owner's Commands — the same Command factory the
admin route runs — with the ambient actor, a shared options type (`extensions`, `expectedVersion`,
`source`) and documented owner-off behaviour. Where the admin path is hand-audited or unaudited today
(Organization moderation and restrictions, most CustomerAccount, Order and QuoteRequest writes), convert
it to a Command first, keeping its audit action. Deprecate the superseded narrow ports in 0.113.0 with a
machine-readable marker and remove them in 0.114.0. Write the port-per-aggregate rule and the published
contract surface (kinds × tiers × directions) as conventions and published docs, and extend
`check:release-intent` with a compile-probe comparison against the previous release tag, plus a
`check:port-shape` signal holding every extensible host to its named port.

## Technical Context

**Language/Version**: TypeScript 5.9 strict, Node.js ≥ 22.17
**Primary Dependencies**: none new. The TypeScript compiler API used by the comparison is already a
devDependency of `backend` and `packages/cli` (`typescript ^5.9.3`).
**Storage**: PostgreSQL — no schema change, no migration (`data-model.md`).
**Testing**: Vitest — co-located module tests (`packages/modules/<id>/src/**/*.test.ts`), backend
contract and integration suites (`backend/test/{contract,integration}/<module>/`), script unit tests
(`backend/test/unit/release/`, `backend/test/unit/scripts/`).
**Target Platform**: the backend and its published packages (`@endora-commerce/contracts`, the eight
owner module packages, `@endora-commerce/cli`).
**Project Type**: monorepo — published contracts, module packages, CI checks, docs.
**Performance Goals**: no regression on admin routes (the Command conversion adds one audit insert where
there already was one); records gaining `customFieldValues` read a column already on the row.
**Constraints**: implementations after #1866 (MikroORM 7, entity freeze); zero removed or narrowed
surface in 0.113.0; Organization first.
**Scale/Scope**: ~130 port methods over 10 ports; ~30 Command conversions; ~20 deprecated port methods.

## Constitution Check

*Gate before Phase 0; re-checked after Phase 1 (below).*

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | PASS | Ports are contract types in `@endora-commerce/contracts`; owners implement and `providePort`; consumers `lazyPort` + manifest edge. The `customers` and `organizations` admin routes call `customerAccountCommandPort` rather than another module's services. |
| II API-first | PASS | Shapes defined in contracts first (Phase A tasks before any implementation); no HTTP change; breaking changes of the published TypeScript surface are governed by OD-4 and the new comparison. |
| III TDD (NN) | PASS | Every story starts with a failing parity / worker / off-state test; each FR maps to a test in `tasks.md`. |
| IV YAGNI & deps | PASS | No new dependency; no new framework — one options type, one marker grammar, one check family. Operations without a server-side caller are left out (R-9). |
| V TypeScript | PASS | — |
| VI Naming (NN) | PASS | `<aggregate>CommandPort`; Command factories `make<Op>Command`; files kebab-case. |
| VII SEO | N/A | No storefront change. |
| VIII English (NN) | PASS | All artefacts English; user-facing docs EN + PL. |
| IX UI reuse | N/A | No UI. |
| X Queue consumers | PASS | No new worker; ports are callable from existing workers under `withSystemScope`. |
| XI Tenancy (NN) | PASS | Ambient tenant context required (fail closed); workers widen only through `withSystemScope` / `enterSystemScope` (D-285); no no-organization path. |
| XII Channel scoping (NN) | PASS | Product scoped values keep the catalog's channel accessors; Organization sales channels write through `sales_channels`' own seam. |
| XIII Command Bus (NN) | PASS — central | One Command per operation, shared with the admin route; hand audits removed in the same change as each conversion (no double audit); actor server-derived; audit state names-only (`audit-state.md`), `source` a code. |
| XIV Extensibility | PASS | `setCustomFieldValues` keeps "host owns the write, caller validates through `CustomFieldValuePort`". |
| XV Overlay | PASS | Ports are rung 3 for overlays; the surface list is the documented interface overlays compile against (`specs/190-overlay-full-modules/`). |
| XVI Palette | N/A | No admin surface added. |
| XVII Toggleable (NN) | PASS | Four deactivatable owners fail closed at the gate; non-deactivatable owners documented as such; consumers declare edges (`check:port-dependencies`). |

**Cross-cutting concerns (architect checklist)**: admin permissions — none added (no route); ports check
no permission by design (R-7). Command palette — none (no admin surface). i18n — no new user-facing
string unless a conversion introduces a new error code, which then needs `en` + `pl` per
`module-i18n.md` and `check:error-translations`. Settings — none. Auditing — the subject of the feature.
Tenant scoping — above. Redis / cache invalidation — the side effects a route performs after its write
move into the Command's event / after-commit path (R-3, FR-013) so the port triggers the same lifecycle
pub/sub invalidation; every parity test asserts it where the route had one.

## Project Structure

### Documentation (this feature)

```text
specs/186-aggregate-ports/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
├── checklists/requirements.md
└── contracts/
    ├── aggregate-port-convention.md      # → specs/conventions/module-composition.md item 2a
    ├── published-surface.md              # → specs/conventions/published-surface.md + docs
    ├── release-intent-surface.md         # the check:release-intent comparison
    ├── organization-command-port.md      # US1
    ├── customer-account-command-port.md  # US3
    ├── order-command-port.md             # US4, US11
    ├── quote-request-command-port.md     # US5
    ├── catalog-product-command-port.md   # US6 (+ catalogAttributeCommandPort)
    ├── project-command-port.md           # US7
    ├── catalog-category-command-port.md  # US8
    ├── opportunity-command-port.md       # US9
    └── task-command-port.md              # US10
```

### Source code touched (by implementation, not by this spec)

```text
packages/contracts/src/
├── aggregate-ports.ts                    # new: AggregateCommandOptions, CustomFieldMerge
├── custom-fields.ts                      # CUSTOM_FIELD_HOST_BINDINGS.aggregatePort
├── organizations.ts, customer-accounts.ts, orders.ts, quote-requests.ts,
│   catalog.ts, product-scopes.ts, crm.ts, projects.ts, tasks.ts   # ports, records, @deprecated
packages/modules/{organizations,customer_accounts,orders,quote_requests,catalog,crm,projects,tasks}/
├── src/backend/commands/                 # Command factories (new for conversions)
├── src/backend/services/*-command-port.ts# port implementations
├── src/backend/index.ts                  # providePort registrations
├── src/backend/routes*.ts                # routes call the shared factories
└── docs/<module>.md                      # "Server-side writes" section
packages/modules/customers/src/backend/   # admin customer routes call customerAccountCommandPort
packages/modules/inventory/src/backend/   # threshold admin stops auditing the category write
packages/cli/src/rules/published-surface.ts  # new analysis (one analysis, two hosts)
packages/cli/src/rules/port-shape.ts      # aggregate-port signal
packages/cli/src/check/estate.ts          # verdict for the comparison
backend/scripts/check-release-intent.ts   # hosts the comparison; new finding kinds
backend/scripts/check-port-shape.ts       # aggregate-port ledger (drains per story)
backend/test/helpers/aggregate-port-parity.ts  # shared parity assertion
backend/test/helpers/check-read-sizes.ts  # recorded read size for the comparison
backend/test/{contract,integration}/<module>/*-command-port*.test.ts
backend/test/unit/release/published-surface.test.ts
specs/conventions/{module-composition,published-surface,release-intent,check-inventory,custom-field-writes}.md
AGENTS.md                                 # one router row for published-surface.md
docs/docs/architecture/{published-surface,customisation-ladder,kernel}.md (+ PL)
docs/docs/upgrading-an-instance.md (+ PL)  # 0.113.0 deprecations, 0.114.0 removals
.changeset/*.md
.github/workflows/quality.yml              # full history for the comparison
```

**Structure decision**: no new module. Each aggregate's owner already owns the entity, the Commands and
the read port (Principle I: ownership by domain); a central "ports" module would own nothing.

## Sequencing

| Step | Before #1866 merges | After #1866 merges |
| --- | --- | --- |
| A | Foundational contracts (`aggregate-ports.ts`, `aggregatePort` field), conventions, surface doc, parity helper | — |
| B | US2: the comparison and the port-shape signal (pure tooling) | — |
| C | Port **interfaces** and `@deprecated` JSDoc for every story (types only, no implementation) — may merge early so siblings compile against them | Implementations, conversions, route moves, story by story |
| D | — | US12 on the 0.114.0 branch |

Story order after #1866: **US1 Organization** (`approve` first — `specs/188-policy-points/` waits on it;
`specs/191-membership-join-requests/` on the port), then US3, US4, US5, US6, US7 in parallel where
owners differ, then US8–US10, then US11. US11 may slip to 0.114.0 or later without affecting the rest
(additive).

**Siblings**: `specs/187-side-table-extensions/` adds read-port `include` host by host — independent of
these write ports, touching the same contracts files (merge-order care only).
`specs/189-command-middleware/` reads `CommandActor` in `meta` — Q-1's answer must reach it.
`specs/190-overlay-full-modules/` consumes the deprecation grammar.
`specs/191-membership-join-requests/` deprecates the CustomerAccount membership methods in the same
release.

## Risks

1. **Conversion scope is larger than the issues assume** (R-2): about thirty writes are hand-audited
   or unaudited. Mitigation: conversions are mechanical (wrap the transactional body, keep before/after
   and action), one module per story, parity tests first; placement (US11) isolated.
2. **Side effects outside the write** — a route that invalidates a cache, reindexes or e-mails after
   `commandBus.run` returns would leave the port silent. Mitigation: T001–T010 inventory them; parity
   tests assert each.
3. **Paid modules** (the separate repository) use eight superseded ports: `catalogProductWritePort`,
   `catalogProductScopeWritePort`, `catalogCategoryWritePort` (catalogue integrations),
   `orderTransitionPort`, `orderPaymentStatusApplyPort`, `orderPlacementPort`,
   `customerAccountLifecycleWritePort` and `customerAccountMemberWritePort`. They must migrate between
   0.113.0 and 0.114.0 — one release. Mitigation: deprecations land with delegating implementations and
   upgrade notes; the paid modules' migration is a tracked follow-up in that repository after 0.113.0
   publishes.
4. **Entity freeze** — implementation work queued behind #1866. Mitigation: types-first merges (step C).
5. **Shallow CI clone** makes the comparison unable to find the base tag. Mitigation: exit 2 by design;
   T-task gives the job full history.
6. **Comparison false negatives**: overloads compare the last signature; dependency type changes are
   invisible by design. Stated in the rule header and the published doc.

## Complexity Tracking

No constitution violation and no new runtime or dev dependency. Nothing to justify.

## Constitution Check — post-design

Re-checked after `research.md`, `data-model.md` and `contracts/`: unchanged, all PASS / N/A. The one
design point that touches a NON-NEGOTIABLE principle in a new way — moving Organization moderation's
audit from after the commit into the Command (XIII) — strengthens it.

## Handoff summary (for `endora-commerce-dev`)

- Read: this plan, `research.md` R-2/R-3/R-4/R-10/R-12, `data-model.md` § *Port disposition*, the
  contract of the story you take, `specs/conventions/module-composition.md`, `audit-state.md`,
  `module-activation.md`, `custom-field-writes.md`, `check-estate.md`, `release-intent.md`.
- Order: Phase 1–2, US2, then US1 after #1866 (`approve` first), then the rest by priority.
- Per operation: failing parity test → Command factory (convert if needed, keep the action, remove the
  hand audit) → route uses it → port method → narrow port delegates + `@deprecated` → docs → changeset.
- Do not: add a dependency, add a migration, add an actor parameter, resolve a port into a singleton,
  wrap a port call in a bare `catch`, deprecate and remove in the same release.
- Open: Q-1 (actor kind), Q-2 (sanctioned breaks) — build R-4's `system` + `source` and leave R-13's
  ledger unbuilt until answered.
