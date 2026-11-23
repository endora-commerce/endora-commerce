---
description: "Tasks for 189: declared command middleware, and narrowing D-156.4 (D-296)"
---

# Tasks: 189-command-middleware

**Input**: `spec.md` (ruling D-296, with the owner rulings of 2026-11-23: D-296.8 to D-296.10 and
D-296.5/D-296.6 as amended), `plan.md`, `research.md`, `contracts/`.
**Tests**: mandatory (Principle III). In each phase every RED task lands before its GREEN task and
fails for the stated reason first. `[FR-…]` is the trace.

## Format: `[ID] [P?] [Story] Description`

- **[P]** can run in parallel (different files, no dependency on an unfinished task).
- Paths are repository-relative.
- Every merge request branches from `origin/master` in its own worktree
  (`scripts/setup-worktree.sh`). Never `git stash`; never a `pgrep -f` wait loop.

---

## Phase 1: Setup (P1 merge request `feat/189-p1-command-middleware`, release 0.113.0)

- [ ] T001 Check whether `specs/188-policy-points/` has merged `ModuleOrigin`/`MODULE_ORIGINS` into
  `packages/contracts/src/modules.ts`. If it has, consume it, skip T004's type half, and confirm it
  matches `specs/189-command-middleware/contracts/module-origin.md` §1 exactly (`core` /
  `deployment` / `package`; this feature owns the contract, D-296.10). If it has not, land it here
  exactly as §1 states and tell the 188 author.
- [ ] T002 Run `pnpm run build:packages`, then record the baseline for SC-002: write
  `packages/platform/src/commands/middleware/bus-overhead.bench.ts` (10 000 no-op Commands on a
  recording audit port, no middleware) and note the median in the merge-request description.

## Phase 2: Foundational (contracts and shared ordering; blocks every story)

### Contracts first (Principle II)

- [ ] T003 [P] RED: `packages/contracts/src/command-middleware.test.ts`. Cover the declaration
  schema, `commandActionFilterRe` (a full action, a prefix ending in `.`; a bare `organization` matches
  only the action `organization` itself, never `organization.register`; upper case refused), the timeout caps, and
  `assertCommandMiddlewareRules` refusals (duplicate id, cap exceeded, covered filter entry).
  [FR-001, FR-003]
- [ ] T004 GREEN: add `packages/contracts/src/command-middleware.ts` (contract §1). Add
  `commandMiddleware` to `ModuleManifestSchema` and `assertCommandMiddlewareRules` to
  `defineModuleManifest` in `packages/contracts/src/modules.ts`. Refuse an authored `origin` key
  with a message pointing to `contracts/module-origin.md`. Export from
  `packages/contracts/src/index.ts`. [FR-001, FR-003, FR-004]
- [ ] T005 [P] RED, then GREEN: `packages/contracts/src/modules.test.ts` cases, then the changes in
  `modules.ts`: `DivergenceKind` `'command-middleware'` and its detail; `commandMiddlewareOrder` in
  `DeploymentDivergenceDeclarationSchema` (optional, `min(2)`); the `.strict()` comment corrected;
  [FR-031, FR-034]. `GUARD_SEAM_REGISTRATIONS` is **not** added here; it is P2's (T069).
- [ ] T006 [P] RED, then GREEN: add `COMMAND_ADMISSION_TIMEOUT`, `COMMAND_ADMISSION_FAILED` and
  `COMMAND_MIDDLEWARE_REENTRY` to `packages/contracts/src/errors.ts`, and pl and en strings to
  `packages/modules/_i18n/i18n/{en,pl}.json`. The bundle-shape and error-code inventory tests go red
  first. [FR-060]

### Shared ordering

- [ ] T007 RED: `packages/platform/src/commands/ordering.test.ts`, for `orderByModuleGraph`
  (dependency order, intra-module order, tie-break, contradiction, unordered pair, determinism under
  shuffled input). [FR-030, FR-031]
- [ ] T008 GREEN: extract `packages/platform/src/commands/ordering.ts` from
  `packages/platform/src/commands/hooks/ordering.ts`. `orderCommandHooks` keeps its signature and
  its hook-specific errors and delegates. `packages/platform/src/commands/hooks/ordering.test.ts`
  and `registry.test.ts` stay unchanged and green. [FR-030]

**Checkpoint**: `pnpm --filter @endora-commerce/contracts test`, the platform hook tests green,
`pnpm -r run typecheck`.

---

## Phase 3: US1, a deployment refuses Commands it must not run (P1)

**Goal**: `admit` on every matching Command, children included, fail-closed.
**Independent test**: spec US1.

- [ ] T010 [P] [US1] RED: `packages/platform/src/commands/middleware/registry.test.ts`. Cover
  register and seal, every composition refusal in contract §5 except ordering, overlap detection,
  the tie-break, stale order entries, `plan()`, and `CommandMiddlewareOriginError` for an `admit`
  of origin `package`. [FR-002, FR-004, FR-031]
- [ ] T011 [US1] GREEN: `packages/platform/src/commands/middleware/{types,errors,registry,filter,budget,origin}.ts`.
  The origin ALS follows `commands/hooks/origin.ts`. The budget races a timer and aborts an
  `AbortController`. [FR-002, FR-004, FR-013]
- [ ] T012 [US1] RED: `packages/platform/src/commands/command-bus.middleware.test.ts`, admission
  half:
  - the root is admitted before `transactional` (spy order);
  - a child is admitted before its `capture`, and so is a hook-started child;
  - admission happens before `assertExtensionsClaimed`;
  - the frozen meta has the exact key set, with no `data` and no `em`;
  - `organizationId` is the organisation for `single-org` and null for the other modes;
  - a refusal leaves no row and no audit entry (recording audit port);
  - the first refusal stops later admits;
  - a refused child caught by the parent leaves the parent's entry intact;
  - timeout and arbitrary-throw mapping, with the log carrying the class and not the message;
  - `module.activation.set` is exempt;
  - re-entry from `admit` is refused.

  [FR-010 – FR-015]
- [ ] T013 [US1] GREEN: in `packages/platform/src/commands/command-bus.ts`, add
  `CommandBusOptions.middleware`, a private `admit()` called from `run` (after
  `resolveCommandActor`, before `events.run`) and from `execute` (after the hook-cycle check), a
  re-entry check at the top of `run`, and the `RunState` run record. Export `CommandRefusedError`,
  the handler types and `currentCommandMiddlewareOrigin` from `packages/platform/src/commands/index.ts`.
  Add `ADMISSION_EXEMPT_ACTIONS` beside the bus. [FR-010 – FR-015]
- [ ] T014 [P] [US1] RED, then GREEN: a new `packages/platform/src/lifecycle/commands/activation.commands.test.ts`
  that asserts `ADMISSION_EXEMPT_ACTIONS` names the action the activation Command uses. [FR-014]
- [ ] T015 [US1] RED: `packages/platform/src/kernel/module-context.test.ts` and
  `packages/platform/src/kernel/compose-modules.test.ts`. `ctx.commandMiddleware` stamps the module
  id, refuses after seal, refuses without a registry, and `composeModules` seals after the hook
  registry and before boot hooks. [FR-002]
- [ ] T016 [US1] GREEN: add the `ctx.commandMiddleware` member to `packages/platform/src/kernel/module-context.ts`.
  In `packages/platform/src/kernel/compose.ts`, add `commandMiddlewareRegistry` and
  `commandMiddleware` options and the seal, and log `kernel.command-middleware` once at boot.
  [FR-002, FR-034]

## Phase 4: US2, a deployment or package observes every Command (P1)

- [ ] T020 [US2] RED: the observation half of `command-bus.middleware.test.ts`:
  - commit, rollback, hook veto, refused root, and a refused child that was caught;
  - names-only `notedFields`, and one entry per attempted Command in attempt order;
  - the caller settles before the observer is called;
  - a throw or timeout is swallowed and logged, and later runs are still observed;
  - a `package` observer gets `{ requestId }` only;
  - re-entry from `observe` is refused and logged;
  - the filter matches any action in the run.

  [FR-020 – FR-022]
- [ ] T021 [US2] GREEN: `CommandMiddlewareRegistry.observe()` (concurrent, budgeted, capped,
  `settled()`), and in `command-bus.ts` the `finally` in `run` that schedules it detached.
  [FR-020 – FR-023]
- [ ] T022 [P] [US2] RED, then GREEN: in-flight cap, drop counter and once-per-minute log in
  `registry.test.ts` with fake timers. [FR-023]
- [ ] T023 [US2] RED, then GREEN: `backend/test/integration/platform/command-middleware-tenant.test.ts`.
  An observer reads under the caller's org context and not a system scope. Run it by hand
  (`TEST_DATABASE_URL`; D-198). [FR-024]

## Phase 5: US3, switching a middleware module off removes it at once (P1)

- [ ] T030 [US3] RED, then GREEN: off-state cases in `command-bus.middleware.test.ts` for `admit`
  and `observe`, with `isPresent` toggled between runs and no re-composition. Add a contract-tree
  case in `backend/test/contract/kernel/command-middleware-off-state.contract.test.ts`, where a
  fixture overlay's `admit` is switched through the effective state over HTTP. [FR-033]

## Phase 6: US4, composition is deterministic and visible (P2)

- [ ] T040 [US4] RED: origin cases. A new `packages/platform/src/kernel/compose.origin.test.ts`
  covers the fallback from `overlay` and `installedPackage`. A new
  `packages/platform/src/packages/package-runtime.origin.test.ts` covers a first-party name+id
  giving `core`, an alias whose `package.json` name differs giving `package`, and an id match with a
  wrong name giving `package`. A paid-module fixture (a non-workspace package with an
  `@endora-commerce/` name) gives `package` (D-296.8). **Grant case** (D-296.10,
  `contracts/module-origin.md` §5), written by whichever of this P1 and 188's P1 merges second: a
  package granted policy participants in the divergence declaration still has origin `package` in
  the origin map, and an `admit` it declares is still refused with `CommandMiddlewareOriginError`.
  Add a table test for `moduleOriginOf` (`contracts/module-origin.md` §6, all four rows) in
  `packages/platform/src/lifecycle/services/module-origin.test.ts`, and a case that an installed
  first-party package keeps `ModuleIdClaimOrigin` `'package'` (so `deploymentShippedEntries` still
  excludes it) while its `ModuleEntry.origin` is `'core'`. [FR-004]
- [ ] T041 [US4] GREEN: `moduleOriginOf` beside `ModuleIdClaimOrigin` in
  `packages/platform/src/lifecycle/services/module-origin.ts`, with the one-sentence doc addition
  on `ModuleIdClaimOrigin` (§6); `ModuleEntry.origin` in `compose.ts`; `origin: moduleOriginOf('overlay', false)` in
  `packages/platform/src/overlay/overlay-runtime.ts`; the first-party match through
  `moduleOriginOf('package', match)` in `packages/platform/src/packages/package-runtime.ts`; `backend/scripts/generate-composer.ts`
  renders `packages/platform/src/packages/first-party-modules.generated.ts`, imports the
  `publishablePackages` rule and does not restate it, and `overlay:check` covers its drift. Run
  `composer:generate` and commit the output. [FR-004]
- [ ] T042 [US4] RED, then GREEN: in `packages/platform/src/composition/compose-app.ts`, build the
  registry with `isPresent` from `effectiveState`, pass it to `new CommandBus(…)` and to
  `composeModules`, derive `commandMiddlewareFrom(manifests)`, and add `commandMiddlewareOrder` to
  `ComposeAppOptions`. In `backend/src/composition.ts`, pass
  `divergenceDeclaration.commandMiddlewareOrder`. Export `CommandMiddlewareRegistry` and
  `commandMiddlewareFrom` from `packages/platform/src/composition/index.ts`. [FR-031, FR-041]
- [ ] T043 [US4] RED: `packages/cli/test/divergence.test.ts` gains a `command-middleware` entry
  (rung 2, owner `null`, key `command-middleware:<module>:<id>`), no `unclassified-seam` for
  `ctx.commandMiddleware`, and the `stale-middleware-order` and `incomplete-middleware-order`
  findings. [FR-034, FR-031]
- [ ] T044 [US4] GREEN: in `packages/cli/src/lib/divergence.ts`, add `SEAM_CLASSIFICATION`, the
  derivation from overlay manifests, the two findings and the remedies. `endora generate` reports
  an installed package's `admit` declaration as an error before boot (`packages/cli/src/generate/`).
  [FR-004, FR-034]
- [ ] T045 [US4] Add one `observe` middleware to `backend/src/apps/example/modules/example_overlay/`
  (`manifest.ts` declaration plus `backend.ts` registration; it logs the duration of
  `organization.` runs). Add its reason to `backend/src/apps/example/divergence.ts`. Regenerate every
  divergence artefact (`backend/src/overlay/divergence.core.generated.*`,
  `backend/src/apps/{example,acceptance}/divergence.generated.*`) and commit them. [FR-034]

## Phase 7: US7, test-kit parity (P2)

- [ ] T050 [US7] RED: `packages/test-kit/src/command-middleware/index.test.ts` covers the sealed
  registry, the recorder, `settled()`, `expectCommandMiddleware` (mismatch, phase forbidden for
  `package`) and `expectDeclaredRefusal`. [FR-040]
- [ ] T051 [US7] GREEN: `packages/test-kit/src/command-middleware/index.ts`, plus the
  `./command-middleware` export in `packages/test-kit/package.json`. Run `manifests:generate` and
  `pnpm install --lockfile-only`. [FR-040]
- [ ] T052 [US7] RED, then GREEN: in `packages/test-kit/src/server/compose-test-server.ts`, wire
  the registry exactly as `composeApp` does. Add the assertion to
  `backend/test/contract/kernel/harness-parity.test.ts` and run it by hand (D-198). [FR-041]

## Phase 8: P1 polish

- [ ] T055 Run `bus-overhead.bench.ts` with no middleware and with one synchronous `admit` and one
  `observe`. Report SC-002 and SC-003 in the merge request. [FR-035]
- [ ] T056 Confirm that `command-bus.test.ts`, `command-bus.hooks.test.ts`,
  `command-bus.outbox.test.ts` and `command-bus-request-meta.test.ts` are unchanged in the diff and
  green. [FR-035]
- [ ] T057 Update `backend/test/unit/kernel/published-surface.test.ts` expected sets
  (`./commands`, `./composition`, `./kernel`).
- [ ] T058 Write changesets for `contracts`, `platform`, `test-kit` and `cli` (minor; consumer-facing
  text; the `.strict()` note on `commandMiddlewareOrder` and older platforms). [FR-061]
- [ ] T059 Hand `contracts/command-middleware-api.md` and `contracts/module-origin.md` to the
  `specs/190-overlay-full-modules/` author for #1857. [FR-062]
- [ ] T060 Verify: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, the
  targeted tests, `pnpm --filter '!backend' run test`, `pnpm --filter backend run test:unit:fast`,
  the kernel contract and integration suites by hand, `pnpm run check:naming && pnpm run check:language`,
  `pnpm --filter backend run overlay:check`, and `check:divergence`.

---

## Phase 9: US5, one release of warning (P2 merge request `feat/189-p2-guard-seam-deprecation`, 0.113.0)

**Precondition**: P1 merged. **Scope**: the four guard seams only (D-296.5 as amended). Every
other root-supplied name keeps its D-156.4 behaviour, and the tests below hold that from both sides.

- [ ] T068 [US5] RED: `packages/contracts/src/modules.test.ts` pins `GUARD_SEAM_REGISTRATIONS` to
  exactly `['commandBus', 'auditLogService', 'eventBus', 'emFactory']`, asserts
  `isGuardSeamRegistration('redis') === false`, and asserts that `guardSeamReplacementFor` returns a
  non-empty text for each of the four. The test's comment states that changing the list is a ruling
  that amends D-296. [FR-055]
- [ ] T069 [US5] GREEN: `GUARD_SEAM_REGISTRATIONS`, `GuardSeamRegistration`,
  `isGuardSeamRegistration` and `guardSeamReplacementFor` in `packages/contracts/src/modules.ts`
  (contract `guard-seam-narrowing.md` §1 and §2), exported from `packages/contracts/src/index.ts`.
  Then RED, then GREEN: add to `backend/test/contract/kernel/harness-parity.test.ts`, which already
  compares the two roots, an assertion that `composeApp`
  (`packages/platform/src/composition/compose-app.ts`) and the test-kit server
  (`packages/test-kit/src/server/compose-test-server.ts`) each register all four names as
  root-supplied (`ownerOf(name) === undefined`). It sits on the contract tree because the platform
  package cannot import the test kit, so run it by hand (D-198). [FR-055]
- [ ] T070 [US5] RED: in `packages/platform/src/kernel/decoration-drain.test.ts` and
  `module-context.test.ts`:
  - an overlay decorating each guard seam composes, keeps the wrap, and logs
    `kernel.decoration.deprecated` exactly once per (module, guard seam), with the
    `guardSeamReplacementFor` text;
  - an overlay decorating `redis` composes, keeps the wrap and logs **nothing**, and its
    `kernel.decorations` entry has no `deprecated` flag;
  - an overlay decorating another overlay module's registration, or a workspace module's, logs
    nothing;
  - a package owner is still refused first.

  [FR-050, FR-053]
- [ ] T071 [US5] GREEN: step 4 of `contracts/guard-seam-narrowing.md` §1 in `decorate`
  (`module-context.ts`), with the predicate
  `isDeploymentOverlay && ownerOf(name) === undefined && isGuardSeamRegistration(name)`, and
  `deprecated: true` on the ledger entry and the `kernel.decorations` line (`compose.ts`). [FR-050]
- [ ] T072 [US5] RED: `packages/cli/test/divergence.test.ts` gains a `deprecated-decoration`
  finding of `severity: 'warning'` for an overlay's decoration of a guard seam, and **no** finding
  for an overlay's decoration of `redis`. Every existing finding has no severity, which reads as an
  error. `backend/test/unit/scripts/check-divergence.test.ts` exits 0 with warnings only and 1 with
  any error. [FR-051, FR-053]
- [ ] T073 [US5] GREEN: `DivergenceFinding.severity`, the new kind and remedy in
  `packages/cli/src/lib/divergence.ts`; the severity-aware exit and summary in
  `backend/scripts/check-divergence.ts` and in `endora generate` / `endora check`
  (`packages/cli/src/generate/`, `packages/cli/src/check/`). [FR-051]
- [ ] T074 [US5] Update the text in `contracts/guard-seam-narrowing.md` §5, 0.113.0 column:
  - `ForeignDecorationError` doc and the `decorate` comment (`module-context.ts`);
  - `ModuleEntry.overlay` doc (`compose.ts`);
  - the `decorationOrder` doc (`packages/contracts/src/modules.ts`);
  - the `foreign-order-member` remedy;
  - `specs/conventions/overlay-modules.md`.

  Every changed citation reads "D-156.4, narrowed by D-296", and says that the narrowing covers
  the four guard seams only. [FR-054]
- [ ] T075 [US5] Apply `contracts/guard-seam-narrowing.md` §6 to `.specify/memory/constitution.md`
  (owner ruling D-296.9): a MINOR amendment, with the version line and Sync Impact Report per its
  Governance section. If 188's XV amendment has already landed, rebase onto it and take the next
  MINOR version. Tell the 190 author the text has landed, so 190 rewrites XV around it. [FR-054]
- [ ] T076 Write changesets for `platform` and `cli` (minor; deprecation, replacement table,
  "refused from 0.114.0"). Then run the verification set from T060. [FR-061]

---

## Phase 10: US6, refusal (P3 merge request `feat/189-p3-guard-seam-refusal`, 0.114.0, `breaking change`)

**Precondition**: 0.113.0 published, and 190's ladder and upgrade page merged.

- [ ] T080 [US6] RED: flip the P2 guard-seam cases in `decoration-drain.test.ts` and
  `module-context.test.ts` (including the `client.di.decorate('commandBus', …)` case and its comment
  block) to expect `GuardSeamDecorationError` with the container left unwrapped. Flip the
  guard-seam case in `packages/cli/test/divergence.test.ts` to severity `error`. Leave the `redis`
  cases from T070 and T072 unchanged: they must stay green. Grep `backend/test/**` for `decorate(`
  over each of the four names, flip `backend/test/integration/kernel/decoration.test.ts` where it
  wraps one, add one integration case that an overlay wrap of a non-guard root name still composes,
  and run that suite by hand. [FR-052, FR-053]
- [ ] T081 [US6] GREEN: add `GuardSeamDecorationError` to `module-context.ts` and to
  `alreadyNamesTheModule` in `compose.ts`. Set the finding severity to `error`. [FR-052]
- [ ] T082 [US6] Update the 0.114.0 column of `contracts/guard-seam-narrowing.md` §5. Rewrite the A8
  sentence in `backend/acceptance/instance-expected-state.json` that calls the `commandBus` family
  a target the fixture "could take". [FR-054]
- [ ] T083 Write a changeset labelled `breaking change` for `platform` and `cli`, with the body from
  `contracts/guard-seam-narrowing.md` §7. Label the pull request `breaking change`. Then run the
  verification set from T060. [FR-061]

---

## Dependencies and execution order

- Phase 2 blocks everything. T003, T005 and T006 run in parallel. T007/T008 run in parallel with
  them.
- US1 (Phase 3) blocks US2, US3 and US4's wiring task T042. US2 and US3 can proceed in parallel
  after T013. US4's T040/T041 (origin) can run in parallel with US1 after Phase 2. US7 needs T042.
- P2 (US5) needs P1 merged. Within P2, T068/T069 come first: T070 to T073 read the list. P3 (US6)
  needs 0.113.0 published and 190's ladder page.
- T040's grant case needs 188's per-package grant field in `DeploymentDivergenceDeclarationSchema`.
  It is written by whichever of 188's P1 and this P1 merges second.

## Parallel examples

- After Phase 2: T010 (registry tests) ∥ T040 (origin tests) ∥ T043 (CLI divergence tests).
- After T013: T020 (observe tests) ∥ T030 (off-state) ∥ T014 (exempt action).

## Implementation strategy

MVP is US1 + US2 + US3 (Phases 1–5): the bus point with gating, which is what a deployment needs
before 0.114.0 takes the wrap away. US4 and US7 complete the P1 merge request. They are required
for it, because composition determinism and harness parity are not optional (XV, FR-041). US5 and
US6 follow as separate merge requests in their own releases.
