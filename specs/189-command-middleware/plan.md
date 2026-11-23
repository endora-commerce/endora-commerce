# Implementation Plan: Declared command middleware, and narrowing D-156.4

**Branch**: `spec/189-command-middleware` (implementation branches per phase, see *Delivery*) |
**Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md) | **Ruling**: D-296 (narrows D-156.4)
**Input**: issues #1840 and #1841; owner decisions of 2026-11-23 (recorded as D-296 in the spec).

## Summary

Three merge requests over two releases:

- **P1 (0.113.0): the middleware point.** The work touches `@endora-commerce/contracts`, the
  platform and the test kit.
  - Contracts gain the manifest field `commandMiddleware`, the derived `ModuleOrigin`, the
    error codes, the divergence kind `command-middleware` and the declaration field
    `commandMiddlewareOrder`.
  - The platform gains a `CommandMiddlewareRegistry` under `packages/platform/src/commands/middleware/`.
    It is sealed by `composeModules` and passed to `CommandBus` as `options.middleware`.
  - The bus admits the root before opening the transaction, and each child at `execute` entry.
    After the caller's promise settles it observes the run, detached.
  - A module registers its code with `ctx.commandMiddleware`.
  - The loaders stamp each module's origin.
  - The test kit gains `./command-middleware`, and the two composition roots wire the registry
    identically.
- **P2 (0.113.0): deprecation of root-supplied decoration by overlays.**
  - A structured warning in `decorate`.
  - A `deprecated-decoration` divergence finding with the new `warning` severity, which the checks
    print without failing.
  - Convention and code comments that cite D-296.
  - The constitution sentences, if OQ-2 goes the recommended way.
- **P3 (0.114.0, `breaking change`): refusal.** `RootSuppliedDecorationError`, the finding's
  severity becomes an error, and the decoration tests flip. The upgrade note goes in the changeset.

Published documentation, the ladder entry and the bus-wrap migration example are delivered by
`specs/190-overlay-full-modules/` (#1857). No table, migration or entity is involved, so this is
the non-database track and may start before the MikroORM 7 switch (#1073).

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17.
**Primary Dependencies**: existing only. Node's `AbortController`, `AsyncLocalStorage` and timers;
Zod; Awilix. **No new runtime dependency.**
**Storage**: none. No table, no migration.
**Testing**: Vitest. Package-local `*.test.ts` beside their subjects (`packages/platform`,
`packages/contracts`, `packages/cli`, `packages/test-kit`). `backend/test/contract/kernel/harness-parity.test.ts`
covers root parity. `backend/test/integration/kernel/decoration.test.ts` covers the narrowing.
**Target Platform**: the backend process (all `BACKEND_ROLE`s) and the instance CLI.
**Project Type**: platform library and CLI change.
**Performance Goals**: SC-002 (no more than 2 % with no middleware) and SC-003 (median below
0.2 ms with one synchronous `admit` and one `observe`). Measured by a new micro-benchmark in
`packages/platform/src/commands/middleware/bus-overhead.bench.ts`, run by hand and reported in
the P1 merge request. It is not a CI gate.
**Constraints**:
- A child's `admit` runs inside an open transaction, so its budget is capped at 500 ms.
- `observe` must never be awaited by a writer.
- The no-middleware path must allocate nothing new.
**Scale/Scope**: every Command in the platform passes the new code path. With no middleware
composed, which is every deployment until one opts in, it is one empty-array check per Command.

## Constitution Check

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | PASS | A middleware module contributes through its own context and manifest. It imports no other module. The registry is Command Bus infrastructure in `packages/platform/src/commands/`, beside `hooks/`. |
| II API-first | PASS | `contracts/command-middleware-api.md`: schemas and constants go into `packages/contracts/src/command-middleware.ts` and `modules.ts` first. Additive in 0.113.0. The 0.114.0 refusal is a versioned break (minor in `0.x`, D-225), with an upgrade note. |
| III TDD (NN) | PASS | `tasks.md` puts a RED test before every GREEN task. The FR→test map is below. |
| IV YAGNI | PASS | No dependency, no schema, no Settings, no operator screen (research R-18). Two phases only. No new `check-*` script: a severity field on the existing divergence findings. |
| V/VI/VIII | PASS | Names follow 176's pattern (`CommandMiddlewareRegistry`, `commandMiddlewareOrder`). English only. |
| IX UI reuse | N/A | No UI. |
| X Queue consumers | N/A | No queue. `observe` is in-process and at most once. Durable delivery stays the outbox (176 P3). |
| XI Tenancy (NN) | PASS | `admit` runs in the caller's ambient context, before any read. `meta.organizationId` comes from it, not from input. `observe` runs in the run's ambient context without widening (FR-024). No `em` is handed out. The narrowing makes `emFactory` undecoratable. |
| XII Channel | N/A | No channel-scoped read. |
| XIII Command Bus (NN) | PASS, **with amendment** | Middleware runs inside the bus, so children are covered. A refused Command records nothing, because nothing ran. An observer cannot change a write. Re-entry is refused. The audit writer and the guard seams stop being decoratable in 0.114.0. The wording is in `contracts/guard-seam-narrowing.md` §6 (OQ-2). |
| XIV Extensibility | PASS | Not a custom-field question. Middleware is a developer seam. |
| XV Overlay | PASS, **with amendment** | Declared, contract-gated (manifest declaration plus a typed registration, both checked at composition). Deterministic order with a deployment tie-break. Unordered conflicts fail composition. Recorded in the divergence report as `command-middleware`. **The narrowing brings the code into line with XV's "never a guard seam"**, which D-156.4 contradicted. Amendment text in §6. |
| XVI Palette | N/A | No admin surface is added. A middleware module's activation is the existing `/platform/modules` screen. |
| XVII Toggleable (NN) | PASS | `isPresent` is asked per Command (`admit`) and per run (`observe`). Off-state tests exist for both. The activation Command is exempt from `admit`, so a faulty rule cannot lock the operator out of the switch that removes it (R-14). |

**Verdict: PASS**, on condition that the owner ratifies the XIII/XV wording (OQ-2). D-296 already
accepts it in substance.

## Project Structure

### Documentation (this feature)

```text
specs/189-command-middleware/
├── spec.md                              # ruling D-296, stories, FRs, owner questions
├── plan.md                              # this file
├── research.md                          # R-1 … R-20
├── contracts/
│   ├── command-middleware-api.md        # the stable surface 190 documents
│   ├── module-origin.md                 # derived trust tier; vocabulary shared with 188/190
│   └── guard-seam-narrowing.md          # D-156.4 → D-296: warning, refusal, text, constitution delta
└── tasks.md
```

There is no `data-model.md`: the feature persists nothing. The in-memory shapes (declaration,
registration, admission metadata, run outcome) are contracts and are defined in
`contracts/command-middleware-api.md`.

### Source code touched

```text
packages/contracts/src/
├── command-middleware.ts               # NEW: declaration schema, phases, budgets, filter regex
├── modules.ts                          # + manifest.commandMiddleware, ModuleOrigin, origin-key refusal,
│                                       #   GUARD_SEAM_REGISTRATIONS + decorationReplacementFor,
│                                       #   DivergenceKind 'command-middleware', commandMiddlewareOrder
├── errors.ts (ERROR_CODES)             # + COMMAND_ADMISSION_TIMEOUT / _FAILED, COMMAND_MIDDLEWARE_REENTRY
└── index.ts                            # exports
packages/platform/src/
├── commands/
│   ├── command-bus.ts                  # options.middleware; root admit in run; child admit in execute;
│   │                                   #   RunState → run record; detached observe
│   ├── ordering.ts                     # NEW: orderByModuleGraph (176's orderCommandHooks delegates)
│   ├── hooks/ordering.ts               # delegates; behaviour and errors unchanged
│   ├── middleware/                     # NEW: registry, types, errors, origin ALS, budget, filter
│   └── index.ts                        # + CommandRefusedError, handler types, currentCommandMiddlewareOrigin
├── kernel/
│   ├── module-context.ts               # + ctx.commandMiddleware; decorate: P2 warning, P3 refusal
│   └── compose.ts                      # ModuleEntry.origin; seal the middleware registry; origin map
├── overlay/overlay-runtime.ts          # origin: 'deployment'
├── packages/package-runtime.ts         # origin: 'core' | 'package' via first-party match
├── packages/first-party-modules.generated.ts   # NEW, generated by composer:generate
├── composition/compose-app.ts          # build registry; pass to bus and composer; commandMiddlewareOrder
└── composition/index.ts                # + CommandMiddlewareRegistry, commandMiddlewareFrom
packages/modules/_i18n/i18n/{en,pl}.json   # the three error codes, beside COMMAND_EXTENSION_UNCLAIMED
packages/cli/src/lib/divergence.ts      # SEAM_CLASSIFICATION, kind, findings, severity
packages/cli/src/generate/, check/      # print warnings, exit on errors only; package admit report
packages/test-kit/src/command-middleware/index.ts   # NEW subpath
packages/test-kit/src/server/compose-test-server.ts # same wiring as composeApp
packages/test-kit/package.json          # exports ./command-middleware
backend/scripts/generate-composer.ts    # render first-party-modules.generated.ts
backend/scripts/check-divergence.ts     # severity-aware exit
backend/src/overlay/divergence-loader.ts (pass-through), backend/src/composition.ts (commandMiddlewareOrder)
backend/test/contract/kernel/harness-parity.test.ts
backend/src/apps/example/                # P1: an `observe` example in example_overlay (+ divergence reasons)
specs/conventions/overlay-modules.md     # P2/P3 text
.specify/memory/constitution.md          # OQ-2
```

**Structure decision**: extend the platform's `commands/` (beside `hooks/` and `outbox/`), the
kernel composer and the CLI derivation. No new module. Middleware is Command Bus infrastructure,
exactly as the hook registry is (176's structure decision).

## Design decisions (reasoning in research.md)

| # | Decision | Research |
| --- | --- | --- |
| 1 | Middleware runs inside the bus, from a sealed registry | R-1 |
| 2 | `admit` and `observe` only; no transform | R-2 |
| 3 | Root admitted before the transaction opens; children at `execute` entry | R-3 |
| 4 | `admit` sees metadata only | R-4 |
| 5 | `CommandRefusedError`; anything else and timeouts fail closed as 503 | R-5 |
| 6 | `observe` detached, concurrent, at most once, capped | R-6 |
| 7 | Outcome is list-1 only; IP address and user agent withheld from `package` observers | R-7 |
| 8 | Budgets are constants with a capped per-declaration value; `AbortSignal` | R-8 |
| 9 | Order by dependency graph for overlapping `admit`; tie-break `commandMiddlewareOrder`; `observe` unordered | R-9 |
| 10 | `isPresent` per Command or run | R-10 |
| 11 | Origin derived by the loaders plus the generated first-party list; never authored | R-11 |
| 12 | Declaration in the manifest, code through `ctx.commandMiddleware` | R-12 |
| 13 | Re-entry refused through an origin ALS | R-13 |
| 14 | `module.activation.set` exempt from `admit` | R-14 |
| 15 | Narrowing covers every root-supplied name; four named seams get specific replacements | R-15 |
| 16 | Warning = log line + non-failing finding (`severity`) | R-16 |
| 17 | Test-kit parity through the real bus and identical root wiring | R-17 |
| 18 | No operator surface | R-18 |
| 19 | Convention and comment text changes ship with the behaviour; published docs are 190's | R-19 |

## Cross-cutting concerns

- **Admin permissions**: none added. No route, no screen (R-18). A middleware module that has an
  admin surface of its own registers its permissions under the usual rules
  (`module-admin-surfaces.md`).
- **Command palette**: none added (XVI applies to modules with an admin surface. This feature adds
  none).
- **i18n**: the three platform codes in `packages/modules/_i18n/i18n/{en,pl}.json` beside `COMMAND_EXTENSION_UNCLAIMED`, where 176's codes are translated. A contributor translates its own refusal codes (feature 090).
- **Settings**: none. Budgets are constants (R-8). No secret is involved.
- **Audit**: unchanged path. A refused Command records nothing. Middleware cannot write: it has no
  `em`, and re-entry is refused.
- **Tenant scoping**: see the XI row above.
- **Redis cache invalidation**: no new cache. Presence reaches `effectiveState` through the existing
  lifecycle pub/sub (`b2b:module:state-changed`), and the registry asks it per call.
- **Activation (XVII)**: per-call skip, with off-state tests for `admit` and `observe` (T020, T030).
- **Generated artefacts**: `first-party-modules.generated.ts` (new) and the divergence artefacts of
  `apps/example` and `apps/acceptance` when their overlays change. Regenerate them and commit in the
  same merge request (AGENTS.md trap).

## Test plan (FR → test)

| FR | Test (file, kind) |
| --- | --- |
| FR-001, 003 | `packages/contracts/src/command-middleware.test.ts`: schema, filter regex, caps, duplicate ids |
| FR-002 | `packages/platform/src/commands/middleware/registry.test.ts`: one case per composition refusal |
| FR-004 | new `packages/platform/src/kernel/compose.origin.test.ts` (fallback derivation); `packages/platform/src/packages/package-runtime.origin.test.ts` (first-party match, alias case); `registry.test.ts` (`CommandMiddlewareOriginError`); `packages/contracts/src/modules.test.ts` (manifest `origin` key refused) |
| FR-010 | `packages/platform/src/commands/command-bus.middleware.test.ts`: root before `transactional` (spy order), child before `capture`, hook-started child, before `assertExtensionsClaimed` |
| FR-011 | `command-bus.middleware.test.ts`: frozen meta, exact key set, no `data`/`em`, `organizationId` per tenant mode |
| FR-012 | `command-bus.middleware.test.ts`: refusal → no row, no audit (recording audit port), first refusal stops later admits |
| FR-013 | `command-bus.middleware.test.ts`: fake timers → `COMMAND_ADMISSION_TIMEOUT`, signal aborted; arbitrary throw → `COMMAND_ADMISSION_FAILED`, log carries class not message |
| FR-014 | `command-bus.middleware.test.ts` with `module.activation.set`; a new `packages/platform/src/lifecycle/commands/activation.commands.test.ts` asserts the constant names its action |
| FR-015 | `command-bus.middleware.test.ts`: `run` inside `admit` and inside `observe` → `COMMAND_MIDDLEWARE_REENTRY` |
| FR-020, 021 | `command-bus.middleware.test.ts`: commit, rollback, veto, refused root, refused-and-caught child; caller settles before observer; throw/timeout swallowed and logged |
| FR-022 | `command-bus.middleware.test.ts`: `package` observer has `{ requestId }` only |
| FR-023 | `packages/platform/src/commands/middleware/registry.test.ts`: cap, drop counter, once-per-minute log |
| FR-024 | `backend/test/integration/platform/command-middleware-tenant.test.ts`: observer reads under the caller's context, not system |
| FR-030 – 032 | `packages/platform/src/commands/ordering.test.ts` (shared function); `registry.test.ts` (overlap detection, tie-break, contradiction, stale entry); `packages/platform/src/commands/hooks/ordering.test.ts` unchanged and green |
| FR-033 | `command-bus.middleware.test.ts`: off-state for `admit` and `observe`, toggled between runs |
| FR-034 | `packages/cli/test/divergence.test.ts`: `command-middleware` entry, rung 2, no `unclassified-seam`; boot-log case in `packages/platform/src/kernel/compose-modules.test.ts` |
| FR-035 | existing `command-bus.test.ts`, `command-bus.hooks.test.ts`, `command-bus.outbox.test.ts`, `command-bus-request-meta.test.ts` untouched and green; benchmark for SC-002 |
| FR-040 | `packages/test-kit/src/command-middleware/index.test.ts` |
| FR-041 | `backend/test/contract/kernel/harness-parity.test.ts`: new assertion |
| FR-050 | `packages/platform/src/kernel/decoration-drain.test.ts`, `module-context.test.ts`: warning once per (module, name), wrap still applied, no warning for overlay/workspace owners |
| FR-051 | `packages/cli/test/divergence.test.ts`: `deprecated-decoration` warning; `backend/test/unit/scripts/check-divergence.test.ts`: exit 0 with warnings only |
| FR-052 | P3 flips of the FR-050/051 tests; `backend/test/integration/kernel/decoration.test.ts` |
| FR-053 | `module-context.test.ts`: overlay → overlay and overlay → workspace still allowed; package owner still refused |
| FR-054, 062 | review tasks; `pnpm run check:language` |
| FR-060 | `backend/test/unit/i18n/*` bundle-shape tests over the lifecycle bundle |
| FR-061 | `pnpm changeset:status`; `check:release-intent` |

## Generated artefacts, changesets, documentation

- `composer:generate` renders `first-party-modules.generated.ts`. Regenerate the divergence
  artefacts (`backend/src/overlay/divergence.core.generated.*`, `apps/example`, `apps/acceptance`).
  The boundary text changes, and P1 adds an `observe` to `example_overlay`. Run
  `manifests:generate` and `pnpm install --lockfile-only` if a package manifest changes: the
  test kit gains an `exports` entry.
- `published-surface.test.ts` expected sets for `./commands`, `./composition` and `./kernel`.
- Changesets (lockstep, minor in `0.x`; `release-intent.md`):
  - P1: `@endora-commerce/contracts` (manifest field, origin type, error codes, divergence kind and
    field); `platform` (`ctx.commandMiddleware`, `CommandBusOptions.middleware`,
    `CommandRefusedError`, registry, origin); `test-kit` (`./command-middleware`); `cli` (divergence
    kind, package-`admit` report).
  - P2: `platform` and `cli`: the deprecation and the finding severity, with the replacement table
    and *"refused from 0.114.0"*.
  - P3: `platform` and `cli`, labelled `breaking change`, with the upgrade note in
    `contracts/guard-seam-narrowing.md` §7.
- Documentation: `specs/190-overlay-full-modules/` (#1857). This feature's P2 changes only
  `specs/conventions/overlay-modules.md` and code comments (FR-054).
- Read sizes: adding files may move recorded read sizes. Inside the band, leave them alone
  (`check-estate.md`).

## Complexity Tracking

No new runtime dependency. No constitution violation needs justifying. The XIII/XV amendment is a
MINOR wording change, flagged for owner ratification (OQ-2).

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A generated first-party module list in the platform | in an instance, core arrives as packages; without it no core module could ever ship `admit` | npm-scope test is defeated by aliases; "every package is `package`" is a time bomb (R-11) |
| A `severity` on divergence findings | a warning that fails CI is a refusal (R-16) | log-only warnings never reach an instance's CI |

## Delivery and sequencing

| Phase | Merge request | Release | Depends on | Blocks |
| --- | --- | --- | --- | --- |
| P1 middleware point | `feat/189-p1-command-middleware` | 0.113.0 | — (coordinate `ModuleOrigin` with 188, `contracts/module-origin.md` §4) | P2; 190's middleware docs |
| P2 deprecation warning | `feat/189-p2-guard-seam-deprecation` | 0.113.0 | P1 merged (the warning names a replacement that must exist) | P3; 190's ladder text |
| P3 refusal | `feat/189-p3-guard-seam-refusal` | 0.114.0 | 0.113.0 published; 190's ladder/upgrade page merged | — |

Each merge request branches from `origin/master` after its predecessor merges. Do not stack them
(stacked-PR trap). P3 is held until the release after 0.113.0 is cut. Label it `breaking change`.

## Open decisions (owner questions; recommendations in spec.md)

- **OQ-1**: paid modules' origin. Recommendation: `package` (observe only) for now.
- **OQ-2**: who applies the constitution delta. Recommendation: P2 of this feature, so the
  constitution never lags the code. 190 rewrites XV around it.
- **OQ-3**: whether the 0.114.0 refusal covers every root-supplied name (recommended, per #1841
  item 3) or only the four guard seams.

## Risks

- **Sibling vocabulary drift (188, 190).** All three define "origin" or "trust tier". Mitigation:
  `contracts/module-origin.md` §4 names the first to merge as the owner, and the orchestrator
  should pass that section to the 188 and 190 authors.
- **Hidden root-supplied decorations in client instances.** We cannot see them. Mitigation: the
  0.113.0 warning and finding, and the upgrade note.
- **`harness-parity.test.ts` is large (110 kB) and on the contract tree.** It does not run on pull
  requests (D-198). Run it by hand for P1, with `TEST_DATABASE_URL`.
- **The integration decoration test sits on a tree `test:unit:fast` skips.** Grep
  `backend/test/**` for every flipped assertion in P3 (AGENTS.md trap).
- **Transaction hold from child admission.** It is bounded by the 500 ms cap. A middleware that
  does I/O on every child of a bulk Command should act on `lineage.depth === 0` only, and the
  contract and 190's docs say so.
- **The ordering refactor touches 176's hook ordering.** Mitigation: 176's tests stay byte-identical
  and green, and the hook errors stay hook-specific.
- **`DeploymentDivergenceDeclarationSchema` is `.strict()`.** A deployment that writes
  `commandMiddlewareOrder` and then runs an older platform is refused, which is correct. Say so in
  the P1 changeset.

## Handoff summary for `endora-commerce-dev`

Implement in three merge requests, P1 → P2 → P3, each off `origin/master` and TDD per `tasks.md`.

**P1** is self-contained:
- contracts first (`contracts/command-middleware-api.md` §1, §6, §7 and `contracts/module-origin.md`
  §1);
- then `commands/middleware/` and the shared `commands/ordering.ts`, with 176's hook ordering
  delegating and its tests untouched;
- then the bus integration: root admit in `run` before `events.run`, child admit in `execute` after
  the hook-cycle check, and detached observe after settle;
- then `ctx.commandMiddleware`, the origin stamping in both loaders plus the generated first-party
  list, the seal in `composeModules`, and the wiring in `composeApp` and the test-kit server;
- last, the test-kit subpath and the CLI divergence kind.

Before starting P1, check whether `specs/188-policy-points/` has already landed `ModuleOrigin`. If
it has, consume it.

**P2** adds the warning in `decorate` (step 4 of `contracts/guard-seam-narrowing.md` §1), the
finding severity and the `deprecated-decoration` finding. It updates the text listed in §5 and,
on OQ-2's recommended answer, the constitution delta in §6.

**P3** waits for 0.113.0 to publish and for 190's ladder page to merge. It flips the warning to
`RootSuppliedDecorationError`, flips the listed tests, and rewrites the A8 reason sentence.

Verify each merge request with:
- `pnpm run build:packages`, `pnpm -r run typecheck` and `pnpm -r run lint`;
- the targeted tests, and `pnpm --filter '!backend' run test` (the platform, contracts, CLI and
  test kit live there);
- the contract and integration suites for `kernel`, by hand, because pull requests do not run them
  (D-198).

Do not run `update-agent-context.sh`.
