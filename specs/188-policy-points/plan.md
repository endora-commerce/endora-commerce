# Implementation Plan: Declared policy points, and the organization moderation policy

**Branch**: `spec/188-policy-points` | **Date**: 2026-11-23 | **Spec**: `specs/188-policy-points/spec.md`
**Input**: issues #1839 and #1838, and owner ruling D-295 (below).
**Release**: 0.113.0.

## Summary

Two work packages:

- **WP-A — the mechanism (#1839).** It needs no database work and can start now, before the
  MikroORM 7 switch (#1073).
  - **Owner side.** An owner publishes a `PolicyPointRef` in `@endora-commerce/contracts`. The ref
    holds the schemas, the combiner, the budget and the failure treatment, and for a `commutative`
    point the `combine` function. The owner lists the point in `policyPoints` and binds its default
    participant with `ctx.policyPoint`.
  - **Contributor side.** A contributor declares `policyContributions` in its manifest and registers
    decisions with `ctx.policyParticipants`.
  - **Composition.** `PolicyRegistry` is sealed by `composeModules`. It orders `chain` participants
    by the dependency closure, using the algorithm 176 wrote, now shared. The deployment's
    `policyOrder` is the tie-break.
  - **Evaluation.** Presence is checked per evaluation. Each participant has a budget, and failures
    fail closed or take the point's substitute verdict. A participant cannot write: the Command Bus
    and the EventBus refuse inside its frame.
  - **Visibility.** A plan API and a platform screen, a `policy-participant` divergence kind at rung
    3, and `module:status` blocks.
  - **Test kit.** `@endora-commerce/test-kit/policies`.
  - **Governance.** A Principle XV amendment and the ladder docs.
- **WP-B — the moderation policy (#1838).** It depends on WP-A and on
  `specs/186-aggregate-ports/`. `organizations.moderation` is `commutative`, and the setting becomes
  the default rule. Hold wins, a failure holds, and nothing rejects. The decision is recorded and
  applied by one Command, `organization.moderation.record_evaluation`, which runs 186's approve
  Command as a child with the `automation` actor. The policy is re-evaluated when a `deferred`
  lookup resolves. The reasons are shown, translated, in the admin moderation queue and on the
  organization screen.

There is no new runtime dependency. There is one new table (WP-B). There are no new permissions
and no new settings. Two palette actions are added.

## Ruling D-295

> **D-295 (owner, 2026-11-23) — declared policy points (#1839) and the organization moderation
> policy (#1838).**
>
> 1. **OD-5 is accepted, with one change.** The owner of a point declares its combiner, `chain` or
>    `commutative`. One combiner for all points is rejected.
> 2. **Trust tier.** Core modules and overlay modules (manifest `origin` `core` / `overlay`) may
>    contribute participants. Whether an installed third-party package may contribute is **open**.
>    Until the owner rules, it may not, and composition refuses (OQ-1).
> 3. **Delivery.** Release 0.113.0. #1839 is a non-database track and may start before the
>    MikroORM 7 switch (#1073, 7.2.11). #1838 needs #1821 (`specs/186-aggregate-ports/`).
> 4. **Sibling specifications in parallel**, cited by slug: `specs/186-aggregate-ports/` (D-293),
>    `specs/187-side-table-extensions/` (D-294), `specs/189-command-middleware/` (D-296),
>    `specs/190-overlay-full-modules/` (D-297), `specs/191-membership-join-requests/` (D-298).

The architect's design decisions are research R-1 to R-24. They are proposals reviewed in this
merge request and are **not** part of D-295. OQ-1 to OQ-3 are the questions for the owner.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17, React 19 (admin shell, organizations admin)
**Primary Dependencies**: existing only. Zod, `AsyncLocalStorage`, `Proxy`, Awilix through the kernel.
**Storage**: WP-A none. WP-B one table, `organization_moderation_evaluations` (`data-model.md` §5).
**Testing**: Vitest.
- `packages/contracts/src/*.test.ts`
- `packages/platform/src/kernel/policies/*.test.ts`
- `packages/platform/src/composition/*.test.ts`
- `packages/test-kit/src/policies/*.test.ts`
- `packages/cli/src/lib/divergence.test.ts`
- co-located `packages/modules/organizations/src/**/*.test.ts`
- `backend/test/contract/organizations/`, `backend/test/integration/organizations/`
- `backend/test/contract/kernel/harness-parity.test.ts`
- admin-shell and organizations admin tests (jsdom)

**Target Platform**: backend (API and worker processes), admin SPA
**Project Type**: monorepo: platform package, contracts, test kit, one domain module, admin shell
**Performance Goals**:
- an evaluation with no contributed participant adds less than 5 ms to the post-registration
  reactor;
- the queue's reason read is one query per page.

**Constraints**:
- participants never write (XIII);
- fail-closed by default (D-295);
- deterministic order (XV);
- presence checked live (XVII).

**Scale/Scope**:
- 1 platform mechanism with 2 seams, 1 registry and 1 test-kit subpath;
- 1 point, 1 Command, 1 table, 1 event, 2 admin reads, 2 palette actions, 1 platform screen.

## Constitution Check

*GATE: checked before research and re-checked after the design. Verdict: **PASS**, with one MINOR
amendment to Principle XV, which FR-020 delivers and the owner ratifies in WP-A's merge request.*

| Principle | Verdict | How the design satisfies it |
| --- | --- | --- |
| I. Modular (NN) | Pass | The mechanism is the platform's. The point is `organizations`'. Contributors declare in their own manifest and never import the owner's internals: the ref is in `contracts`. The approve runs through the owner's own Command. |
| II. API-first | Pass | The refs, the schemas, the plan response and the moderation read schemas go into `packages/contracts/` first (contracts/*.md). |
| III. TDD (NN) | Pass | Every FR is traced to a test (§ Requirement → test traceability). `tasks.md` puts the failing tests first in every phase. |
| IV. YAGNI / deps | Pass | No new dependency. Two combiners only. No setting for budgets. No retry worker (OQ-3). No package grants (OQ-1). |
| V. TypeScript | Pass | Typed refs infer `decide`'s signature from the point. |
| VI. Naming (NN) | Pass | Ids, codes and keys follow existing grammars. `check:naming` runs in WP-A and in WP-B. |
| VII. SEO / perf | n/a | No storefront change. |
| VIII. English (NN) | Pass | Artefacts are in English. User-facing strings ship in English and Polish. |
| IX. UI reuse | Pass | The platform screen copies `CommandHooksPage` and uses kit primitives. The queue column and the panel use existing table and panel components. |
| X. Queue consumers | Pass | No new worker. The reactor stays an EventBus subscriber. A future retry worker follows the `rfq-expiry-worker` pattern (R-18). |
| XI. Tenancy (NN) | Pass | `evaluate` requires a TenantContext. The reactor uses `withSystemScope(reason)`. The new table is `@OrgScoped`. Participants constrain by the input's organization id (D-285). There is no no-organization path. |
| XII. Channel scoping (NN) | Pass | The channel is read through the kernel's membership reader, not by a hand-rolled query. |
| XIII. Command Bus (NN) | Pass | The evaluation record and the approval are one Command with a child Command. Participants cannot reach `CommandBus.run`. The audit state is names and codes only (`data-model.md` §7). |
| XIV. Extensibility | Pass | This is a new extension point. Nothing is added as a bespoke column on the core table. |
| XV. Core / overlay | **Amend (MINOR)** | Policy participants are a new member of the bounded overridable surface. They are contract-gated (the ref is published, and the conformance helper fails on drift), deterministic (FR-019), auditable (divergence kind) and refuse silent conflict (unordered `chain` refuses). FR-020 adds "declared policy participants" to XV's list, with a Sync Impact Report, versioned 4.3.0 → 4.4.0. **Coordinate with `specs/189-command-middleware/`**: if 189 amends XV in the same release, the two land as one MINOR bump or two sequential ones, and the second rebases on the first. |
| XVI. Palette | Pass | `_lifecycle` gets `open-policy-points` and `organizations` gets `open-moderation-queue`. |
| XVII. Toggleable (NN) | Pass | Presence is checked per evaluation (R-9) and an off module's participant is skipped. An absent owner's participations are dropped. `organizations` is non-deactivatable, so there is no owner-off state for moderation. The plan screen shows a switched-off participant as switched off. Off-state tests are T029 and T061. |

## Project Structure

### Documentation (this feature)

```text
specs/188-policy-points/
├── spec.md
├── plan.md                      # this file (D-295 recorded above)
├── research.md                  # R-1 … R-24
├── data-model.md
├── contracts/
│   ├── policy-points-api.md     # contracts, platform, composition, test kit
│   ├── organization-moderation-policy.md
│   └── admin-and-introspection.md
├── checklists/requirements.md
└── tasks.md
```

`.specify/scripts/bash/update-agent-context.sh` was **not** run, so the `AGENTS.md` appendix is
untouched. The directory was created by hand, because the feature script would have numbered it 184.

### Source code (touched)

```text
packages/contracts/src/
├── policy-points.ts                 # NEW: refs, declaration schemas, plan schema, grammars
├── modules.ts                       # policyPoints, policyContributions, policyOrder, divergence kind
├── organizations.ts                 # ORGANIZATION_POLICY_POINTS, moderation schemas, admin read schemas
└── errors (ERROR_CODES)             # POLICY_EVALUATION_FAILED
packages/platform/src/
├── kernel/policies/                 # NEW: evaluator, frame, errors, override tracking
├── kernel/module-context.ts         # ctx.policyPoint, ctx.policyParticipants
├── kernel/compose.ts                # seal PolicyRegistry after the command-hook seal
├── kernel/index.ts                  # publish the module-facing names on ./kernel
├── commands/hooks/ordering.ts       # extract orderByModuleDependencies (shared)
├── commands/bus (CommandBus.run)    # refuse inside a participant frame
├── events/ (EventBus.emit)          # refuse inside a participant frame
├── composition/index.ts             # PolicyRegistry, policyPointsFrom, policyContributionsFrom
└── lifecycle/{routes.admin.ts,manifest.ts,commands/status}   # plan API, palette action, module:status
packages/modules/_i18n/              # errors.POLICY_EVALUATION_FAILED (en, pl) + errorCodes
packages/test-kit/src/policies/      # NEW subpath ./policies
packages/cli/src/lib/divergence.ts   # SEAM_CLASSIFICATION, derivation, finding
packages/admin-shell/src/            # PolicyPointsPage, route, AppShell entry
backend/src/composition.ts, backend/test/test-server.ts      # wire the registry in both roots
backend/scripts/check-port-dependencies.ts                   # unowned-policy-point
packages/modules/organizations/
├── src/manifest.ts                  # policyPoints, palette action, setting text
├── src/backend/index.ts             # ctx.policyPoint, two subscriptions, Command wiring
├── src/backend/services/organization-moderation-service.ts   # evaluateModeration
├── src/backend/services/organization-tax-id-validation-service.ts  # resolved event
├── src/backend/commands/record-moderation-evaluation.command.ts    # NEW
├── src/backend/entities/organization-moderation-evaluation.entity.ts  # NEW
├── src/migrations/<scaffolded>      # NEW, via migration:new after #1073
├── src/backend/routes.admin.ts      # list summary, evaluations route
├── src/admin/pages/OrganizationsList.tsx, src/admin/panels/ModerationActionsPanel.tsx
├── i18n/{en,pl}.json
└── docs/organizations.md
docs/docs/architecture/{customisation-ladder.md,kernel.md} (+ pl copies)
.specify/memory/constitution.md      # XV amendment (FR-020)
```

**Structure decision**: the mechanism extends the existing platform `kernel/` and `composition/`
directories. That adds no subpath, and `PUBLISHED_SUBPATHS` stays at five (R-1). The domain change
extends `organizations`. **No new module**: the decision is `organizations`' domain, and the
mechanism is the platform's.

## Requirement → test traceability

| FR | Test (first failing) |
| --- | --- |
| FR-001, FR-002 | `packages/contracts/src/policy-points.test.ts` (definePolicyPoint refusals, manifest prefix and duplicates) |
| FR-003, FR-004 | `packages/platform/src/kernel/policies/registry.test.ts` (undeclared, unregistered, duplicate, dropped when the owner is absent); `check-port-dependencies` fixture test (`unowned-policy-point`) |
| FR-005 | `.../policies/evaluate.test.ts` (frozen input; `CommandBus.run` and `EventBus.emit` refused → `write-attempt`) |
| FR-006 | `.../policies/ordering.test.ts` and `commands/hooks/ordering.test.ts` (shared algorithm unchanged for hooks) |
| FR-007 | `.../policies/override.test.ts`; test-kit conformance test |
| FR-008 | `.../policies/evaluate.test.ts` (permutation of registration order); `test-kit/policies/commutative.test.ts` |
| FR-009, FR-010, FR-011 | `.../policies/evaluate.test.ts` (each failure kind, substitute, fail-closed, `decision-invalid`, `decision-refused`, late result ignored) |
| FR-012 | `.../policies/presence.test.ts` (isPresent flip without re-seal) |
| FR-013 | `.../policies/registry.test.ts` (package participant refused; overlay accepted) |
| FR-014 | `.../policies/evaluate.test.ts` (trace shape) |
| FR-015 | `backend/test/contract/_lifecycle/policy-points-plan.test.ts`; admin-shell page test; palette inventory |
| FR-016 | `packages/cli/src/lib/divergence.test.ts`; regenerated `backend/src/apps/example/divergence.generated.*` with a fixture participant |
| FR-017 | `module:status` unit test in `packages/platform/src/lifecycle/` |
| FR-018 | `packages/test-kit/src/policies/*.test.ts` |
| FR-019 | `.../policies/ordering.test.ts` (same input in shuffled arrival order gives the same order) |
| FR-020, FR-021 | constitution Sync Impact Report present; `check:module-docs` and the docs build |
| FR-022 | `_i18n` error translation coverage (`check:error-translations`) |
| FR-030 … FR-034 | `packages/contracts/src/organizations.moderation-policy.test.ts` (`expectCommutativeCombine`, hold wins, substitute); `organization-moderation-service.test.ts` (default rule mapping, unreadable) |
| FR-035, FR-045 | `backend/test/integration/organizations/moderation-policy.test.ts` (auto and manual parity) |
| FR-036 | same file (deferred → validated re-evaluates; still deferred or not pending: no run); `organization-tax-id-validation-service.test.ts` (event emission conditions) |
| FR-037, FR-038, FR-039 | `record-moderation-evaluation.command.test.ts` (one transaction, child approve, version guard, nothing written when superseded); audit sentinel test (`expectNoAuditValues`) |
| FR-040, FR-041 | `backend/test/contract/organizations/moderation-evaluations.test.ts` (labels in en and pl, code fallback); `OrganizationsList` and `ModerationActionsPanel` tests |
| FR-042, FR-043 | palette and settings-label coverage tests |
| FR-044 | integration test: an organization with no row renders "No automatic evaluation" (null summary) |
| FR-046 | `check:module-docs` |
| FR-050 | `.../policies/evaluate.test.ts` (`chain` inside a request-shaped context with a 300 ms budget) |

## Work packages and merge requests

1. **MR-1, WP-A core.**
   - contracts: refs, manifest fields, divergence kind, error code;
   - platform: registry, evaluator, frame, seams, both roots, shared ordering;
   - test kit;
   - `check:port-dependencies` rule;
   - divergence derivation;
   - plan API, screen and palette;
   - `module:status` blocks;
   - constitution amendment, and ladder and kernel docs in English and Polish.

   Changesets go on `@endora-commerce/contracts`, `@endora-commerce/platform`,
   `@endora-commerce/test-kit`, `@endora-commerce/cli` and `@endora-commerce/admin-shell`
   (`specs/conventions/release-intent.md`).
2. **MR-2, WP-B moderation.** It opens after MR-1 and the 186 approve Command have merged, and after
   #1073 for the migration. It covers:
   - the ref and the moderation schemas;
   - `organizations` wiring, the Command, the entity and the migration;
   - the event and the re-evaluation;
   - the admin reads and the UI;
   - i18n, docs and the palette.

   A changeset goes on `@endora-commerce/contracts` and `@endora-commerce/organizations`.

After either merge request, regenerate and commit, as the AGENTS.md trap requires:

- `composer:generate` and `manifests:generate`;
- `pnpm install --lockfile-only`;
- the divergence artefacts.

## Coordination with sibling specs

- **`specs/186-aggregate-ports/` (D-293).** WP-B needs three things from it:
  1. the approve Command, runnable as a child through `ctx.run`;
  2. the `automation` actor kind;
  3. `organizationCommandPort.approve` running that same Command.

  This spec does **not** call the port facade from inside `organizations` (R-14). If 186 decides
  that approve is reachable only through the port, WP-B falls back to the two-transaction variant,
  and FR-039 has to be re-read.
- **`specs/189-command-middleware/` (D-296).** The vocabulary table is research R-20. Proposed to
  share:
  - `orderByModuleDependencies`;
  - the `<thing>Order` field shape in `divergence.ts` (`.optional()`);
  - one Principle XV amendment window.

  `PolicyParticipantWriteError` is raised from `CommandBus.run` before middleware `admit`, so a
  participant never reaches middleware.
- **`specs/191-membership-join-requests/` (D-298).** It declares
  `organizations.registrationConflict` (`chain`) on the terms of FR-050 and R-21.
- **`specs/187-side-table-extensions/` (D-294).** A rule that reads a side table its module owns is
  the issue's "a rule may read its own module's data". No coupling beyond that.
- **`specs/190-overlay-full-modules/` (D-297).** Overlay modules are accepted contributors.
  Whatever 190 changes about overlay manifests must keep `policyContributions` readable by the
  divergence walk.

## Risks

- **R-a. 186 slips.** WP-B is blocked and WP-A ships alone, which is useful for 191. Mitigation: WP-A
  is independent by construction.
- **R-b. The `?status=` deep link.** `check:action-route-permissions` may not accept a query string
  in `targetRoute`. Mitigation: teach it to match the path part, or route `/organizations/moderation`
  to the filtered list.
- **R-c. Proxy-based read tracking** can be defeated: a participant that spreads `previous` reads
  every key and counts as "read". This is acceptable. The goal is to catch the common silent
  override, and the conformance helper's differential test is the stronger net.
- **R-d. The constitution amendment collides with 189.** Mitigation: coordinate the version bump
  (Constitution Check, XV).
- **R-e. The setting text change.** `check:text-budget` caps the description at 120 characters.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| New runtime dependency | none | — |
| A second manifest field for contributions (`policyContributions`) beside `nonBindingDependencies` | Rule 2 of `assertNonBindingRules` would refuse the common case, and the name space differs (R-2) | Two rule exceptions and a check exception would leave one field meaning two things |
| A new table | Reasons must be shown per organization, with history (R-15) | A core-table column keeps no history. Reading audit back reads a platform-global table |

## Handoff summary (for `endora-commerce-dev`)

- **Order.** Do WP-A (MR-1) first. It is non-database, so it can start now. Then WP-B (MR-2), when
  186's approve Command and `automation` actor exist and #1073 has merged.
- **Read first.**
  - `contracts/policy-points-api.md` §4, the normative semantics;
  - `specs/176-command-hooks-outbox/contracts/command-hooks-api.md`, whose registry, seal and
    ordering you generalise;
  - `specs/conventions/module-composition.md`, `module-activation.md` and `audit-state.md`.
- **Watch.**
  - Extract `orderByModuleDependencies` without changing hook behaviour. `ordering.test.ts` for
    hooks must stay green unchanged.
  - Wire the registry in **both** roots, or `harness-parity` reds.
  - Guard `CommandBus.run` and `EventBus.emit` inside a participant frame.
  - `policyOrder` is `.optional()`.
  - Regenerate the divergence artefacts and commit them.
  - The audit state is codes only, so run the sentinel test.
- **Do not** call `organizationCommandPort` from inside `organizations`. Run the approve Command as
  a child (R-14).
- **Do not** assign a migration number. Use `migration:new` after #1073.
- **Open owner questions** do not block implementation:
  - OQ-1: the default refuses packages;
  - OQ-2: implement as specified;
  - OQ-3: no worker.
