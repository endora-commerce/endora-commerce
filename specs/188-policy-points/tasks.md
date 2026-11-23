# Tasks: Declared policy points, and the organization moderation policy

**Input**: `specs/188-policy-points/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`,
`contracts/`).
**Tests**: required. Principle III is non-negotiable, and every FR is traced in `plan.md`. In each
phase the test tasks come first and must fail before their implementation tasks start.
**Merge requests**:
- **MR-1 = WP-A**: Phases 1–6, no database.
- **MR-2 = WP-B**: Phases 7–10. It starts after MR-1, after `specs/186-aggregate-ports/` delivers
  the approve Command (runnable as a child, recording a caller source code), and after #1073 for
  T045.

Format: `- [ ] T### [P?] [US?] description with path`.

Tasks T063 to T070 were added on 2026-11-23 for D-295 items 5 and 8 (package grants, origin tiers,
origin consumed from `specs/189-command-middleware/`). They sit in the phase where they run, so their
numbers are out of sequence on purpose. The automatic retry of `deferred` lookups is not a task here:
it is a separate issue (to be filed, D-295 item 7).

## Phase 1: Setup

- [ ] T001 Create the worktree from `origin/master`, run `scripts/setup-worktree.sh` and
  `pnpm run build:packages`, and confirm a green `pnpm -r run typecheck` baseline before any change.
- [ ] T002 Read `contracts/policy-points-api.md` §4,
  `specs/176-command-hooks-outbox/contracts/command-hooks-api.md`,
  `packages/platform/src/commands/hooks/{registry,ordering}.ts` and `specs/conventions/module-composition.md`.

## Phase 2: Foundational (blocks every story)

- [ ] T003 [P] Write failing tests in `packages/contracts/src/policy-points.test.ts`:
  - `definePolicyPoint` refusals: id grammar, budget bounds, non-object verdict, duplicate or
    malformed codes;
  - `toPolicyPointDeclaration`;
  - `policyReasonLabelKey`.
- [ ] T004 [P] Write failing tests in `packages/contracts/src/modules.policy-fields.test.ts`. The
  test fixes four rules:
  - `defineModuleManifest` refuses a `policyPoints` id not prefixed by the manifest id, duplicate
    `(point, id)` contributions, and self-owned contributions;
  - `policyContributions` coexists with `dependencies` on the same owner;
  - `policyOrder` is optional, and an absent value parses as `undefined`;
  - `DivergenceKind` includes `policy-participant` and `policy-participant-grant`.
- [ ] T063 [P] Write failing tests for `policyParticipantGrants` in the same file
  (`packages/contracts/src/modules.policy-fields.test.ts`), FR-023:
  - absent parses as `undefined`, and the example of `contracts/policy-points-api.md` §9 parses;
  - refused: a malformed point id, a malformed module id, a reason under 20 or over 800 characters,
    an empty array, the same module id twice under one point, an unknown key in an entry;
  - the declaration stays `.strict()`: a misspelt `policyParticipantGrant` is refused by name.
- [ ] T064 [P] Write a failing test in `packages/platform/src/lifecycle/divergence-declaration.test.ts`:
  a malformed grant is refused by `parseDivergenceDeclaration` with the path it was given and the
  issue path `policyParticipantGrants.<pointId>.<index>.<field>`; `emptyDivergenceDeclaration()` is
  unchanged and carries no grant key.
- [ ] T005 Implement `packages/contracts/src/policy-points.ts` and export it from the contracts
  barrel.
- [ ] T006 Extend `packages/contracts/src/modules.ts` with `policyPoints`, `policyContributions`,
  `policyOrder`, the `policy-participant` kind and its detail, and the
  `DivergenceBoundary.notRecorded` entry.
- [ ] T065 Add `PolicyParticipantGrantSchema` and `policyParticipantGrants` (`.optional()`) to
  `DeploymentDivergenceDeclarationSchema`, and the `policy-participant-grant` kind and detail
  (`data-model.md` §1.4, §2). Rewrite the `.strict()` comment to count the fields. In
  `backend/src/apps/example/divergence.ts` write `policyOrder: {}` and `policyParticipantGrants: {}`
  out, each with its comment, and correct the doc block's list of fields. T063 and T064 go green.
- [ ] T066 Consume module origin from `specs/189-command-middleware/` `contracts/module-origin.md`.
  If 189 has merged, import `MODULE_ORIGINS` / `ModuleOrigin` and read the origin map
  `composeModules` resolves. If it has not, land that contract's §1 and §2 **as written there**
  (type, `ModuleEntry.origin`, loader stamping, the fallback rule), with its own tests first, and
  extend §2's hand-off to `PolicyRegistry.seal`. Do not redefine anything in it.
- [ ] T007 Add `POLICY_EVALUATION_FAILED` to `ERROR_CODES`. Declare it in
  `packages/modules/_i18n/src/manifest.ts` `errorCodes`, and translate
  `errors.POLICY_EVALUATION_FAILED` in `packages/modules/_i18n/i18n/{en,pl}.json`.
- [ ] T008 Extract `orderByModuleDependencies` from
  `packages/platform/src/commands/hooks/ordering.ts` into
  `packages/platform/src/composition/module-order.ts`. Keep `orderCommandHooks` as a thin caller.
  `ordering.test.ts` must stay green **unchanged**. Add `module-order.test.ts` for the generic
  error hooks.

## Phase 3: User Story 1 — the mechanism (P1) 🎯 MVP of WP-A

**Goal**: an owner declares a point and contributors take part safely.
**Independent test**: fixture points (one `chain`, one `commutative`) composed from fixture modules.

- [ ] T009 [P] [US1] Failing tests in `packages/platform/src/kernel/policies/registry.test.ts`. The
  seal must refuse:
  - an undeclared point, a duplicate point, and a point missing from the manifest;
  - an undeclared participant, an unregistered participant, and a duplicate participant;
  - an override on a `commutative` point, and a `policyOrder` entry for a `commutative` point.

  It must accept an overlay participant, and it must drop a participation whose point no composed
  manifest declares. Plan items carry `origin` and `granted` (FR-026).
- [ ] T067 [P] [US1] Failing tests in `.../policies/grants.test.ts` (FR-013, FR-023 to FR-025):
  - an ungranted `package` participant refuses with `PackagePolicyParticipantNotGrantedError`, whose
    message names the module, the point, `policyParticipantGrants` and `divergence.ts`;
  - a grant admits every participant that package declares for the point;
  - a package granted on point A and contributing to point B refuses for B;
  - each `InvalidPolicyParticipantGrantError` cause: `unknown-point` (including a point whose owner
    is not composed), `unknown-module`, `not-a-package` (a core module, a deployment module, and an
    installed first-party package whose origin is `core`), `unused`;
  - origin is read from the origin map only: an `installedPackage: true` entry with origin `core`
    needs no grant, and an entry with no `origin` falls back by 189's rule;
  - the plan shows a granted participant with origin `package` and `granted: true`.
- [ ] T068 [P] [US1] Failing test in `packages/platform/src/kernel/module-context.test.ts`: a package
  granted for a point still refuses `ctx.di.decorate` with `ForeignDecorationError` (FR-025). If
  189's middleware registry is in the tree, add the same assertion for an `admit` registration.
- [ ] T010 [P] [US1] Failing tests in `.../policies/ordering.test.ts`:
  - `chain` with the default first;
  - origin tiers: core, then package, then deployment, with no dependency between them and no
    `policyOrder` entry (US1-3);
  - dependency order within a tier;
  - an unordered pair within a tier refused, naming both modules and the point;
  - `policyOrder` tie-break within a tier;
  - a `policyOrder` entry naming modules of two tiers refused, and a dependency path against the
    tier order refused (`PolicyOrderContradictionError`);
  - contradiction refused;
  - registration order within one module;
  - shuffled arrival order gives an identical order (FR-019).
- [ ] T011 [P] [US1] Failing tests in `.../policies/evaluate.test.ts`:
  - input parsed and frozen;
  - `chain` passes `previous`;
  - `commutative` decision invariant under registration order, with a granted package participant
    among the participants (research R-25); every trace entry carries its `origin`;
  - each failure kind (`threw`, `timeout` with a late result ignored and a late rejection
    swallowed, `invalid-verdict` including an undeclared reason code);
  - substitute verdict attribution;
  - fail-closed `PolicyEvaluationError('participant-failed')` raised after all participants settle;
  - `decision-invalid` and `decision-refused`;
  - trace shape;
  - a missing TenantContext refused;
  - `chain` inside a request-shaped context with a 300 ms budget (FR-050).
- [ ] T012 [P] [US1] Failing tests in `.../policies/purity.test.ts`. `CommandBus.run` and
  `EventBus.emit` inside a participant throw `PolicyParticipantWriteError`. The participant is
  traced `write-attempt`. `currentPolicyParticipant()` is set inside the frame and unset outside it.
- [ ] T013 [P] [US1] Failing tests in `.../policies/override.test.ts`:
  - an undeclared `chain` participant that never reads `previous` is flagged `observedOverride`;
  - one warning is logged per participant;
  - a declared override is not flagged.
- [ ] T014 [P] [US1] Failing tests in `packages/platform/src/kernel/module-context.policies.test.ts`.
  `ctx.policyPoint` and `ctx.policyParticipants` stamp the module id, refuse after seal, and resolve
  nothing during registration.
- [ ] T015 [US1] Implement `packages/platform/src/kernel/policies/{errors,frame,evaluate,registry,grants}.ts`.
  The registry follows `CommandHookRegistry`'s seal-then-freeze shape, runs the checks in the order
  of `contracts/policy-points-api.md` §3, and calls `orderByModuleDependencies` once per origin
  tier. `grants.ts` is the only reader of `policyParticipantGrants` (FR-025). T067 and T068 go
  green.
- [ ] T016 [US1] Add the participant frame guard to `CommandBus.run` (`packages/platform/src/commands/`)
  and to `EventBus.emit` (`packages/platform/src/events/`).
- [ ] T017 [US1] Add `policyPoint` and `policyParticipants` to `ModuleContext`
  (`packages/platform/src/kernel/module-context.ts`), with the `policyRegistry` option. Publish the
  module-facing names on `packages/platform/src/kernel/index.ts`. Add `PolicyRegistry`,
  `policyPointsFrom` and `policyContributionsFrom` to `packages/platform/src/composition/index.ts`.
- [ ] T018 [US1] Seal the registry in `packages/platform/src/kernel/compose.ts`, after the
  command-hook seal and before boot hooks, passing the origin map the composer resolves (T066).
  Log `kernel.policies` once, with `origin` and `granted` per participant; assert it in
  `compose-modules.test.ts` first.
- [ ] T019 [US1] Wire `policyRegistry` and `policies` in `backend/src/composition.ts` and
  `backend/test/test-server.ts`. Pass `policyOrder` and `policyParticipantGrants` from the
  deployment declaration (`loadDivergenceDeclaration()`), as `decorationOrder` is passed. Run
  `pnpm --filter backend exec vitest run test/contract/kernel/harness-parity.test.ts`.
- [ ] T020 [US1] Teach `backend/scripts/check-port-dependencies.ts` the `unowned-policy-point`
  finding, with a fixture test, and document it in `specs/conventions/check-inventory.md` if the
  inventory lists findings.
- [ ] T021 [US1] Run `pnpm --filter backend run check:platform-surface`. `PUBLISHED_SUBPATHS` must
  stay at five, and `backend/test/unit/kernel/published-surface.test.ts` must list the new
  `./kernel` names.

## Phase 4: User Story 6 — the conformance kit (P2, scheduled here because Phases 7–9 test with it)

**Goal**: contributors and owners test against the owner's real ref.

- [ ] T022 [P] [US6] Failing tests in `packages/test-kit/src/policies/conformance.test.ts`. They
  cover:
  - the with and without decisions;
  - a fail on an invalid decision, a budget overrun, a write attempt and an undeclared code;
  - a fail on an undeclared override, caught by the differential `previous`;
  - a fail on a missing en or pl label when bundles are given;
  - a red result when the fixture ref's combine changes.
- [ ] T023 [P] [US6] Failing tests in `packages/test-kit/src/policies/commutative.test.ts`: every
  permutation for six or fewer outcomes, 50 seeded shuffles above that, and a non-commutative
  combine detected.
- [ ] T024 [US6] Implement `packages/test-kit/src/policies/index.ts`: `evaluatePolicyPointForTest`,
  `expectPolicyParticipantConformance`, `expectCommutativeCombine` and `sealedPolicyRegistry`. Add
  the `./policies` export to `packages/test-kit/package.json`.

## Phase 5: User Story 5 — visibility (P2)

**Goal**: every participant can be listed by an operator and by an upgrader.

- [ ] T025 [P] [US5] Failing contract test in
  `backend/test/contract/_lifecycle/policy-points-plan.test.ts`:
  - the `platform.modules.read` gate gives 403 without the permission;
  - the response matches the schema, with sorted points and items, `chain` positions, live
    `moduleEnabled`, `origin` and `granted`.
- [ ] T026 [P] [US5] Failing tests in `packages/cli/src/lib/divergence.test.ts`:
  - `policyParticipants` is classified at rung 3, and `policyPoint` as not-a-seam;
  - an overlay participation yields the documented key and detail;
  - an unknown point yields `unowned-policy-point`.
- [ ] T069 [P] [US5] Failing tests for grants in the same file
  (`packages/cli/src/lib/divergence.test.ts`), FR-016:
  - a grant yields `policy-participant-grant:<moduleId>:<pointId>` at rung 3, owner the point's
    owner, with the grant's inline reason, and never reads `reasons`;
  - a `reasons` key for a grant key is the existing stale-reason finding;
  - a grant for a point no manifest declares is `unowned-policy-point`, and a grant naming a core or
    overlay module of the tree is `policy-grant-not-a-package`, both through `check:divergence`;
  - `runtimeOnly` names "a granted package's policy participants".
- [ ] T027 [P] [US5] Failing test for `module:status`: the policy blocks in the text form and in
  `--json`, and the module-granularity `chain` position or `unordered with`.
- [ ] T028 [US5] Implement `PolicyPointPlanResponseSchema` (contracts), `PolicyRegistry.plan()`, and
  `registerPolicyPointAdminRoutes` in `packages/platform/src/lifecycle/routes.admin.ts`.
- [ ] T029 [US5] Off-state test (XVII) in `backend/test/contract/_lifecycle/policy-points-off-state.test.ts`:
  - deactivate a fixture contributor;
  - its participant is skipped in evaluation and shown `moduleEnabled: false` on the plan;
  - reactivate it and it takes part again with no restart;
  - an absent (never composed) owner's participation is dropped at boot without error;
  - a granted package switched off is skipped and shown `moduleEnabled: false`; its grant stays
    valid and the next composition does not refuse.
- [ ] T030 [US5] Implement the divergence derivation in `packages/cli/src/lib/divergence.ts` and
  `backend/scripts/generate-divergence.ts`, grants included, and the two grant findings in
  `backend/scripts/check-divergence.ts`. Add a fixture participant to `backend/src/apps/example/` if
  the example deployment is the derivation's fixture. Regenerate and commit
  `divergence.*.generated.{ts,md}`. T069 goes green.
- [ ] T031 [US5] Add the `module:status` blocks in `packages/platform/src/lifecycle/` (the
  `runStatusCommand` renderer).
- [ ] T032 [P] [US5] Admin shell: build `PolicyPointsPage.tsx` and `policy-points-api.ts` in
  `packages/admin-shell/src/modules/platform/`, the route in `App.tsx`, and the AppShell entry in
  `components/AppShell.tsx`, with a jsdom test covering the loading, empty, error, switched-off
  and observed-override states, and the origin badge with the "Granted by the deployment" label.
- [ ] T033 [P] [US5] Add the `_lifecycle` palette action `open-policy-points` in
  `packages/platform/src/lifecycle/manifest.ts`, and translate its keys and the screen's labels in
  English and Polish in `_lifecycle`'s bundles. Then run the permission inventory and the palette
  checks.

## Phase 6: WP-A polish (MR-1)

- [ ] T034 Amend `.specify/memory/constitution.md` Principle XV, adding declared policy
  participants to the bounded overridable surface (FR-020), with a third-party package admitted only
  by a per-point grant in the deployment's declaration. Include the Sync Impact Report and the
  version bump. Rebase on 189's XIII and XV sentences (owner answer 9: 189 adds them, 190 rewrites
  XV around them). Update dependent templates if their text names the surface.
- [ ] T035 [P] Add *Rung 3b — a declared policy point* to `docs/docs/architecture/customisation-ladder.md`,
  and add a *Policy points* section to `docs/docs/architecture/kernel.md`, both in English and
  Polish (`docs/docs/contributing/documentation-i18n.md`). Both explain the origin tiers and the
  package grant, with the §9 example and the stale-grant refusal. Add a short pointer in
  `specs/conventions/module-composition.md`, which is the one home for composing a module.
- [ ] T036 Add changesets for contracts, platform, test-kit, cli and admin-shell
  (`specs/conventions/release-intent.md`).
- [ ] T037 Regenerate the artefacts: `composer:generate`, `manifests:generate` and
  `pnpm install --lockfile-only`. Run the gate: `pnpm -r run typecheck`, `pnpm -r run lint`,
  `pnpm --filter backend run test:unit:fast`, `pnpm --filter '!backend' run test`,
  `check:naming`, `check:language`, `check:port-dependencies`, `check:port-catches`,
  `check:kernel-boundary`, `check:module-boundary`, and the targeted contract tests. Grep
  `backend/test/**` for every moved path (the AGENTS.md trap).

## Phase 7: User Story 2 — unchanged default moderation (P1) 🎯 MVP of WP-B

**Goal**: with no contributed rule, outcomes are identical to the previous release.

- [ ] T038 [P] [US2] Failing tests in `packages/contracts/src/organizations.moderation-policy.test.ts`:
  - schemas, and no `reject` value;
  - `combine` (hold wins, reasons of the winners, `codeOwner` for substitutes);
  - `expectCommutativeCombine` over the sample sets.
- [ ] T039 [P] [US2] Failing tests in
  `packages/modules/organizations/src/backend/services/organization-moderation-service.test.ts`.
  The default rule maps `auto` to `mode_auto`, `manual` to `mode_manual`, and an unreadable setting
  to `default_unreadable`. The reactor skips missing organizations and organizations that are not
  pending.
- [ ] T040 [P] [US2] Failing tests in
  `packages/modules/organizations/src/backend/commands/record-moderation-evaluation.command.test.ts`:
  - one transaction;
  - the child approve on `approve`, and no approve on `hold`;
  - FR-039 nothing written when the status or version changed;
  - the audit state keys a subset of `ORGANIZATIONS_AUDIT_KEYS`;
  - the sentinel test with `expectNoAuditValues`.
- [ ] T041 [P] [US2] Failing integration test in
  `backend/test/integration/organizations/moderation-policy.test.ts`:
  - parity for `auto` (approved by the `system` actor with source `organizations.moderation`,
    approval mail, `status_changed`) and for `manual` (pending);
  - one evaluation row each;
  - no rejection under any configuration.
- [ ] T042 [US2] Add `ORGANIZATION_POLICY_POINTS.moderation` and the moderation schemas to
  `packages/contracts/src/organizations.ts`.
- [ ] T043 [US2] Declare `policyPoints` in `packages/modules/organizations/src/manifest.ts`.
  Rewrite `settingLabels.organizations.moderation.mode.*` in English and Polish within the text
  budget (FR-043).
- [ ] T044 [US2] Create `OrganizationModerationEvaluation` in
  `packages/modules/organizations/src/backend/entities/organization-moderation-evaluation.entity.ts`
  (`@OrgScoped`, `data-model.md` §5). Register it where the module registers entities.
- [ ] T045 [US2] Create the migration with `pnpm --filter backend run migration:new` in
  `packages/modules/organizations/src/migrations/`, **after #1073 has merged**, following
  `specs/conventions/module-migrations.md`. Run `composer:generate`.
- [ ] T046 [US2] Create `record-moderation-evaluation.command.ts`. It runs 186's approve Command as
  a child with `source: 'organizations.moderation'` (`contracts/organization-moderation-policy.md`
  §4).
- [ ] T047 [US2] Replace `handleNewlyRegistered` with `evaluateModeration(orgId, trigger)` in
  `organization-moderation-service.ts`. In `index.ts`, wire `ctx.policyPoint`, drop the
  `resolveModerationMode` argument, and run the reactor under
  `withSystemScope('organizations: evaluate the moderation policy', …)`.
- [ ] T048 [US2] Translate `organizations.moderation.reason.{mode_auto,mode_manual,default_unreadable,participant_failed}`
  in `packages/modules/organizations/i18n/{en,pl}.json`.

## Phase 8: User Story 3 — contributed rules, reasons in the queue (P1)

**Goal**: a deployment rule holds or approves, and the operator sees why.

- [ ] T049 [P] [US3] Failing integration tests in `moderation-policy.test.ts`, using a fixture
  overlay contributor:
  - `validated` lookup approved with the contributor's code in the audit entry;
  - `failed` lookup held;
  - approve plus hold gives hold;
  - a throwing rule and a timed-out rule both hold with `participant_failed`;
  - under `manual`, all contributed approves still hold (D-295 item 6).
- [ ] T070 [P] [US3] Failing contract test in
  `backend/test/contract/organizations/moderation-package-grant.test.ts`, with a fixture module
  composed with origin `package` that holds when the e-mail domain is on its list:
  - without a grant for `organizations.moderation`, composition refuses and names the field;
  - with the grant, a listed domain is held and the queue shows the package's translated reason;
  - its `approve` does not override the default rule's `mode_manual` hold, nor another rule's hold;
  - a throwing package rule holds with `participant_failed` naming the package.
- [ ] T050 [P] [US3] Failing contract test in
  `backend/test/contract/organizations/moderation-evaluations.test.ts`:
  - the list summary only for pending organizations;
  - labels in `en` and `pl` request languages;
  - code fallback when a label is missing;
  - `GET /:id/moderation-evaluations` gated by `customers:read` and organization reach (out of
    reach gives 404);
  - "No automatic evaluation" for an organization with no row (FR-044).
- [ ] T051 [P] [US3] Failing jsdom tests for `OrganizationsList.tsx` and `ModerationActionsPanel.tsx`
  in the organizations admin tests:
  - `?status=` deep link;
  - the *Waiting because* column with the "+n" overflow and its tooltip;
  - the panel's verdict, reasons, failed and skipped rules, trigger and history;
  - every enum label through `defineEnumLabels`.
- [ ] T052 [US3] Add the read schemas to `packages/contracts/src/organizations.ts`. Implement the
  summary and the evaluations route in `packages/modules/organizations/src/backend/routes.admin.ts`,
  with labels through `adminI18nService` (`policyReasonLabelKey`).
- [ ] T053 [US3] Implement the admin UI in `src/admin/pages/OrganizationsList.tsx`,
  `src/admin/panels/ModerationActionsPanel.tsx` and `src/admin/lib/labels.ts`. Add the
  `moderation.policy.*` keys in English and Polish.
- [ ] T054 [US3] Add the palette action `open-moderation-queue` to the organizations manifest, with
  its keys in English and Polish. Resolve R-b: if `check:action-route-permissions` refuses the
  query, match the path part in the check.
- [ ] T055 [US3] Write a contributor conformance example as a test in the fixture overlay
  (`expectPolicyParticipantConformance` with the module's bundles). It is the worked example the
  docs cite.

## Phase 9: User Story 4 — re-evaluation after a deferred lookup resolves (P2)

- [ ] T056 [P] [US4] Failing tests in `organization-tax-id-validation-service.test.ts`. The event
  is emitted only when the previous outcome was `deferred`, the new one is anything else, and the
  organization is pending.
- [ ] T057 [P] [US4] Failing integration test: register with a stub answering `deferred` and a rule
  holding unless `validated`, retry with `validated`, and check that the second evaluation has
  trigger `registry_lookup_resolved` and approves. Add the not-pending and still-deferred negative
  cases.
- [ ] T058 [US4] Emit `organization.tax_id_validation.resolved.v1` from
  `organization-tax-id-validation-service.ts` and add it to `OrganizationEventBus`'s map.
- [ ] T059 [US4] Add `ctx.subscribe('organization.tax_id_validation.resolved.v1', …)` in
  `packages/modules/organizations/src/backend/index.ts`. It calls the same reactor with trigger
  `registry_lookup_resolved`.

## Phase 10: WP-B polish (MR-2)

- [ ] T060 [P] Document the moderation policy in `packages/modules/organizations/docs/organizations.md`
  § *Commercial party and moderation*: the default rule, hold wins, no reject, writing a rule as a
  hold condition (`manual` never approves, D-295 item 6), the worked example from T055, how a
  deployment grants a third-party package's rule, and reasons in the queue. Write it in English and
  Polish.
- [ ] T061 Off-state test (XVII) for moderation in `moderation-policy.test.ts`. With the fixture
  contributor switched off, its rule is skipped and listed in `skipped`, and the remaining rules
  decide. Switched back on, the rule takes part again.
- [ ] T062 Add a changeset for contracts and organizations. Regenerate the artefacts and run the
  T037 gate. Also run `check:text-budget`, `i18n:hardcoded`, the permission inventory and
  `check:error-translations`.

## Dependencies & execution order

- Phase 1 → Phase 2 → Phase 3 (US1). T066 needs `specs/189-command-middleware/`'s origin
  contract, merged or landed here as written there.
- Phase 4 (US6) and Phase 5 (US5) follow Phase 3, and can run in parallel with each other.
- Phase 6 closes MR-1.
- MR-2 runs Phase 7 (US2) → Phase 8 (US3) → Phase 9 (US4) → Phase 10. It needs MR-1 merged and
  186's approve Command. T045 needs #1073.
- Within a phase, `[P]` test tasks run in parallel. Implementation tasks follow their tests.

## Parallel examples

- Phase 2: T003, T004, T063 and T064 together. Then T005 → T006 → T065, and T066.
- US1: T009, T010, T011, T012, T013, T014, T067 and T068 together (separate test files, T068 an
  addition to an existing one). Then T015 → T016 → T017 → T018 → T019.
- US5: T025, T026, T027 and T069 together. T032 and T033 can run alongside T028–T031.
- US3: T049, T050, T051 and T070 together. Then T052 → T053 → T054.

## Implementation strategy

1. **MVP of WP-A** is US1. It is enough for `specs/191-membership-join-requests/` to start
   declaring its `chain` point.
2. US6 and US5 then complete MR-1, because the issue's definition includes visibility and the test
   kit.
3. **MVP of WP-B** is US2, which gives parity with no rules. US3 then delivers the business value,
   and US4 removes the manual work after a provider outage.
