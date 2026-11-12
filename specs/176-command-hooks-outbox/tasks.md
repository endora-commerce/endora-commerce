---
description: "Tasks for 176 — registration as one Command, command hooks, transactional outbox"
---

# Tasks: 176-command-hooks-outbox

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`.
**Tests**: mandatory (Principle III). In each phase every RED task lands before its GREEN task and
fails for the stated reason first. `[FR-…]` is the trace.

## Format: `[ID] [P?] [Story] Description`

- **[P]** can run in parallel (different files, no dependency).
- Paths are repository-relative.

---

## Phase 1 — US1: Registration is one Command (P1) — **mergeable alone**

**Precondition**: #987, #990 and #1016 merged. Branch `feat/176-registration-command` off
`origin/master`. *(All three, and 177 (#1034, #1040), 178 and #1044 were on `master` when P1 was
implemented on 2026-11-11; the contract was reconciled with them — see the amendment block at the
top of `contracts/registration-command.md`.)*

### Contracts first

- [x] T001 [US1] Add `CustomerAccountMemberCommandPort` and `CustomerAccountCreateCommand` to
  `packages/contracts/src/customer-accounts.ts` (`contracts/registration-command.md`), plus a
  type-level test showing `Command<CustomerAccountRecord>` is assignable both ways. [FR-002]
  *(The port is `prepareCreate(input)` → `PreparedCustomerAccountCreate.command({ organizationId,
  organizationRoleId })`, with `CustomerAccountCreatePreparation`: the role id is known only inside
  the transaction. The type-level check is in `customer-account-create.command.test.ts`, since
  `@endora-commerce/contracts` depends on no platform code.)*

### Tests (RED)

- [x] T002 [P] [US1] `packages/modules/customer_accounts/src/backend/commands/customer-account-create.command.test.ts`:
  on a real `CommandBus` over a fake ORM, this checks one entry with `customer_account.create`, a
  `409 EMAIL_ALREADY_REGISTERED` from the pre-check and from a simulated unique violation, the state
  keys limited to the #1016 allowlist, and that it runs as a child on the parent's em. [FR-002]
- [x] T003 [P] [US1] `customer_accounts/src/backend/services/customer-account-ports.test.ts`:
  `create()` runs the Command through the bus and writes no hand-written audit call. [FR-004]
- [x] T004 [P] [US1] `organizations/src/backend/commands/register-organization.command.test.ts`:
  the child runs via `ctx.run`; the hash spy is called before `transactional` opens; there is one
  `transactional` call; `organization.registered.v1` and `customer_account.created.v1` are each
  dispatched once after commit and none on a thrown child. [FR-001, FR-002, FR-005, FR-006]
- [x] T005 [P] [US1] `organizations/src/backend/commands/register-organization.audit.test.ts`:
  sentinel test with `expectNoAuditValues` (name, tax id, address, e-mail, a custom-field value)
  and the allowlist. [FR-007] *(The allowlist is the module-wide `ORGANIZATION_AUDIT_KEYS` from
  #1044, not a separate `ORGANIZATIONS_REGISTER_AUDIT_KEYS`; the case moved here from
  `organization-audit-sentinels.test.ts`.)*
- [x] T006 [P] [US1] `organizations/src/backend/services/registration-service.test.ts`: country,
  custom-field and ticket reads run before `commandBus.run`, the ticket is deleted only after
  success, and the service never calls `recordAuditFromContext`. [FR-007, FR-009]
- [x] T007 [US1] `backend/test/integration/organizations/registration-atomic.test.ts`: fault
  injection at the org flush, channel binding, account insert (a racing e-mail), lookup row and token.
  Each fault leaves zero rows across all five tables and no audit entries. A clean run writes one
  entry each for `organization.register` and `customer_account.create` with the same request id.
  [FR-001, FR-003, SC-001] *(Faults are injected by triggers keyed to a marker in the
  Organization's name; the account step raises `unique_violation`.)*
- [x] T008 [P] [US1] `backend/test/contract/organizations/register-unchanged.contract.test.ts`: the
  response shape and the 201/409/422 codes match pre-change fixtures, including
  `409 ORGANIZATION_TAX_ID_EXISTS` via the constraint (race). [FR-008] *(Fixtures recorded as inline
  snapshots against `master` before the change; run in both tax-ID scopes.)*

### Implementation (GREEN)

- [x] T009 [US1] `customer_accounts/src/backend/commands/customer-account-create.command.ts` and an
  async factory that hashes first. Register `providePort('customerAccountMemberCommandPort', …)` in
  `customer_accounts/src/backend/index.ts`. Rewrite `CustomerAccountMemberWritePort.create` to run
  it and delete its `#audit` call for create. [FR-002, FR-004, FR-005]
- [x] T010 [US1] `organizations/src/backend/commands/register-organization.command.ts` per the
  contract, with the names-only audit state. [FR-001, FR-006, FR-007] *(The state is #1044's,
  unchanged.)*
- [x] T011 [US1] Thin `RegistrationService` (commandBus injected; `lazyPort` for the command port,
  edge declared as `customerAccountMemberWritePort` is) and update `plugin.ts` wiring. Remove
  `recordAuditFromContext`. [FR-001, FR-007, FR-009] *(The call site runs the Command through
  `runOrganizationWrite`, which is 177's T071; `tax-id-write-paths.test.ts`,
  `organization-creation-binds-channel.test.ts` and `gating-graph.test.ts` re-derived.)*
- [x] T012 [US1] Run `check:command-coverage --strict`, `check:port-dependencies`,
  `check:port-catches` and `check:module-boundary`. Add changesets: `contracts` minor,
  `mod-customer-accounts` minor (new port) and `mod-organizations` patch with an upgrade note.
  Update `packages/modules/organizations/docs/organizations.md` plus pl. *(OD-4's names-only
  note was overtaken by #1044; the note says the entry is now bus-written. Also updated:
  `customer_accounts.md` and `architecture/command-bus.md`, EN and PL.)*

**Checkpoint**: P1 merges alone. Spec 177 can rebase its registration changes on it.

---

## Phase 2 — US2: `beforeCommit` command hooks (P1) — after P1 merges

Branch `feat/176-p2-command-hooks`.

### Contracts first

- [ ] T020 [US2] `packages/contracts/src/command-hooks.ts`: `hookableAction`,
  `HookableActionRef`, `HookableActionDeclarationSchema`, `toHookableActionDeclaration`, the error
  code constants, and the `OutboxData` types. In `modules.ts`, add `hookableActions` to
  `ModuleManifestSchema` (refusing duplicates), `'command-hook'` to `DivergenceKind`, and
  `commandHookOrder` to `DeploymentDivergenceDeclarationSchema`. Tests go in
  `command-hooks.test.ts` and `modules.test.ts`. [FR-010, FR-014, FR-026]
- [ ] T021 [US2] `ORGANIZATION_HOOKABLE_ACTIONS` and the data types in `packages/contracts/src/organizations.ts`
  (`contracts/organization-hookable-actions.md`). [FR-024]

### Tests (RED)

- [ ] T022 [P] [US2] `packages/platform/src/commands/hooks/registry.test.ts`: one test per
  composition refusal: undeclared action, phase not offered, duplicate declaration, duplicate
  `(module, id)`, owner not depended on, unordered pair, order contradiction. Each test also checks
  that the message names the modules, the id and the action. [FR-012]
- [ ] T023 [P] [US2] `hooks/ordering.test.ts`: transitive dependency order, intra-module
  registration order, `commandHookOrder` tie-break, determinism (shuffled input gives the same
  order). [FR-013, FR-014]
- [ ] T024 [P] [US2] `packages/platform/src/kernel/module-context.commandhooks.test.ts`: the module
  id is stamped; registration after sealing throws; registration resolves nothing. [FR-011]
- [ ] T025 [US2] `packages/platform/src/commands/command-bus.hooks.test.ts`:
  - the hook sees the same em and actor;
  - a child run through `ctx.run` audits inside the transaction;
  - an `HttpError` veto propagates with no rows and no entries;
  - a non-Http throw gives 500 and a rollback;
  - an absent hook module is skipped;
  - `data` is typed, and a hook sees only its own `extension`;
  - an unclaimed extension key gives 422 before any write;
  - `noteAuditChanges` merges into the single entry;
  - a cycle and depth 9 give `COMMAND_HOOK_CYCLE`;
  - missing `hookData` gives `COMMAND_HOOK_DATA_MISSING`.
  [FR-015 to FR-020, FR-022, FR-023, SC-002]
- [ ] T026 [P] [US2] `hooks/origin.test.ts`: `currentCommandHookOrigin()` is set inside the hook and
  its child Commands, and is undefined outside. [FR-021]
- [ ] T027 [P] [US2] `packages/test-kit/src/command-hooks/expect-hookable-command.test.ts`: the
  helper fails for a Command without `hookData` or `outboxData` for its declared phases. [FR-023]
- [ ] T028 [US2] Organizations Command tests (`create-organization.command.test.ts`,
  `register-organization.command.test.ts`, and the #990 `admin-patch` / `set-custom-field-values`
  tests) call `expectHookableCommand` with the matching ref. `manifest.test.ts` asserts four
  declarations (two if OD-3 falls back). [FR-024]
- [ ] T029 [US2] `backend/test/contract/organizations/organization-hooks.contract.test.ts`: a
  fixture module hooks `organization.create` and `organization.register`. The test checks that the
  hook's row commits with the core row, that a veto answers the fixture's declared code translated
  pl/en, and an **off-state** case where the fixture is deactivated and responses equal those of a
  composition without it. [FR-015, FR-016, FR-017, SC-005]
- [ ] T030 [US2] `backend/scripts/acceptance/instance-probe.ts`: a new phase `command-hook`. An
  installed-package fixture hooks `organization.create`, and the probe asserts that it ran and that
  a veto works. [FR-025]
- [ ] T031 [P] [US2] `packages/cli` divergence tests: a hook registration is reported as
  `command-hook:<module>:<action>#<id>`. [FR-026]

### Implementation (GREEN)

- [ ] T032 [US2] `packages/platform/src/commands/hooks/` (registry, ordering, origin ALS, errors).
  Extend `Command` with `hookData`, `outboxData` and `extensions`, and add dispatch to
  `CommandBus.execute` per `contracts/command-hooks-api.md` §4. Export the symbols from
  `commands/index.ts` and update `published-surface.test.ts`. [FR-011 to FR-023]
- [ ] T033 [US2] `ctx.commandHooks` in `kernel/module-context.ts`, and registry sealing in
  `kernel/compose.ts` (new option `commandHooks` with `hookableActions`, `moduleDependencies` and
  `commandHookOrder` as data). Wire `composition/compose-app.ts` and `backend/test/test-server.ts`
  identically, and keep `harness-parity.test.ts` green. [FR-011 to FR-014]
- [ ] T034 [US2] Root derivation helpers `hookableActionsFrom(manifests)` and
  `moduleDependencyClosureFrom(manifests)`, beside `requiredModulesFrom`. [FR-012, FR-013]
- [ ] T035 [US2] `organizations`: list the refs in `manifest.ts` `hookableActions`, and add
  `hookData` / `outboxData` / `extensions` pass-through to the four Commands. [FR-024]
- [ ] T036 [US2] `packages/test-kit/src/command-hooks/` (`expectHookableCommand` and a recording
  hook fixture), plus `_lifecycle` error codes and pl/en translations for the three new codes.
  [FR-016, FR-019, FR-022, FR-023]
- [ ] T037 [US2] `packages/cli/src/generate/divergence.ts` `command-hook` kind. Regenerate the
  divergence artefacts, and `GET /api/v1/admin/command-hooks` in `lifecycle/routes.admin.ts` with
  its contract test `backend/test/contract/platform/command-hooks-plan.contract.test.ts` (RED first
  within this task). [FR-026, FR-040]
- [ ] T038 [US2] Changesets (contracts, platform, mod-organizations, test-kit, cli: minor). Docs:
  the `command-bus.md` hooks section, the ladder seam with the stale note removed, the
  `organizations.md` hookable-actions table, all EN+PL with the translation cache. [FR-043]

**Checkpoint**: spec 178 can build on P2.

---

## Phase 3 — US3: `afterCommit` via the outbox (P2) — after P2 merges

Branch `feat/176-p3-command-outbox`.

### Tests (RED)

- [ ] T040 [US3] `packages/platform/src/commands/command-bus.outbox.test.ts`: one row per present
  handler, written on the transaction em, and none on rollback. An absent handler module gets no row.
  The row's data passes a list-1 guard, so a string longer than a code or a nested object is refused.
  [FR-030, FR-031]
- [ ] T041 [P] [US3] `packages/platform/src/commands/outbox/drain.test.ts` (fake clock, fake
  store):
  - the backoff schedule;
  - a row goes dead after 10 attempts;
  - `PermanentOutboxFailure` dead-letters at once;
  - the error text is never stored;
  - an absent module leaves the row pending with its attempt restored;
  - an unregistered handler gives `hook-unregistered`;
  - delivered rows are purged after 7 days;
  - an expired lease is reclaimed.
  [FR-035, FR-036, FR-037]
- [ ] T042 [P] [US3] `outbox/drain-worker.test.ts`: the scheduler upsert is idempotent, the wake job
  is deduplicated and enqueued only after a commit that wrote rows, a Redis failure on wake is
  swallowed, and an idle tick enters no scope. [FR-033]
- [ ] T043 [US3] `backend/test/integration/platform/outbox-drain-concurrency.test.ts`: two drains
  over 200 rows deliver every row with no concurrent double handling (an assert inside the handler).
  A simulated crash after commit loses nothing. [FR-032, SC-003, SC-004]
- [ ] T044 [US3] `backend/test/integration/platform/outbox-tenant-context.test.ts`: the handler for
  an `organization.register` row runs with `single-org` mode on the row's Organization. A Command the
  handler runs records the original request id. The causation carries the recorded actor. [FR-034]
- [ ] T045 [P] [US3] `packages/platform/src/lifecycle/services/orchestrator.test.ts`: `--hard`
  uninstall deletes the module's outbox rows, and a soft uninstall keeps them. [FR-036]
- [ ] T046 [P] [US3] `backend/test/integration/platform/migration-command-outbox.test.ts`: the table,
  constraints and partial indexes exist after `db:fresh`. [FR-030]

### Implementation (GREEN)

- [ ] T047 [US3] Scaffold the migration with
  `pnpm --filter backend run migration:new -- --module core --name command_outbox`
  (`data-model.md` §1). Add the entity `commands/outbox/command-outbox-entry.entity.ts`
  (`@GlobalEntity()`) registered with the kernel entities, then run `composer:generate` and commit the
  registry. [FR-030]
- [ ] T048 [US3] The outbox writer in `CommandBus.execute` (after the audit entry), and the post-commit
  wake through an injected `OutboxWakePort`. The bus option is constructed in `compose-app.ts` and
  `test-server.ts`. [FR-030, FR-031, FR-033]
- [ ] T049 [US3] Drain, claim, deliver and backoff in `commands/outbox/`. The worker and scheduler
  are attached in `lifecycle/backend.ts` through `ctx.worker`, built only where `processRunsWorkers`
  holds and a queue connection is available (`rfq-expiry-sweep-worker.ts` shape). Add the tenant
  pinning with `enterPlatformScope`. [FR-032 to FR-037]
- [ ] T050 [US3] The orchestrator `--hard` purge, and `PermanentOutboxFailure` export with a
  published-surface update. [FR-035, FR-036]
- [ ] T051 [US3] Verify the `EventBus` is untouched: `git diff` shows no change in `events/`, and
  `events/bus.test.ts` is green. Changesets (platform minor). Add the outbox section to
  `command-bus.md` (EN+PL). [FR-038, FR-043]

---

## Phase 4 — US4: Operator surface and governance (P3)

May be folded into Phase 3's MR (OD-2).

### Tests (RED)

- [ ] T060 [US4] `backend/test/contract/platform/command-outbox-admin.contract.test.ts`:
  - the list is filtered by status and keyset-paginated, and never returns `data`;
  - the list answers 403 without `platform.command_outbox.read`;
  - a retry moves a dead row to pending and writes a `command_outbox.retry` audit entry;
  - a retry answers 403 without `.manage`, 404 for an unknown id and `409 COMMAND_OUTBOX_NOT_DEAD`
    for a row that is not dead.
  [FR-040]
- [ ] T061 [P] [US4] Admin screen test (admin-shell): both tabs render in pl and en, the retry
  button is hidden without the permission, and the empty, loading and error states are covered. A
  palette test checks that `open-command-hooks` reaches the screen. [FR-041]
- [ ] T062 [P] [US4] Permission inventory and palette checks pass for `_lifecycle`
  (`check:permissions` / the `module-admin-surfaces.md` instruments). [FR-041]

### Implementation (GREEN)

- [ ] T063 [US4] Contracts (response schemas in `command-hooks.ts`), the routes in
  `lifecycle/routes.admin.ts`, and the `command_outbox.retry` Command. [FR-040]
- [ ] T064 [US4] Add the permissions and the palette action to `lifecycle/manifest.ts`, and the i18n
  keys to `lifecycle/i18n/{en,pl}.json` and the admin bundle. [FR-041]
- [ ] T065 [US4] The admin screen in admin-shell, built from admin-kit primitives. Get it reviewed
  by `endora-commerce-designer` (UX laws, WCAG 2.2 AA). [FR-041]
- [ ] T066 [US4] Constitution amendment (XIII outbox wording, XV surface list), with the version and
  date bumped in `.specify/memory/constitution.md` and flagged in the MR for owner ratification.
  Update `kernel.md` (the contribution seam row). [FR-042, FR-043]

---

## Polish (every phase)

- [ ] T070 Run `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`,
  `pnpm --filter '!backend' run test`, the targeted backend contract and integration suites (D-198:
  not run on MR pipelines), `check:naming` and `check:language`.
- [ ] T071 Grep `backend/test/**` for every moved or deleted path. Re-derive ledgers derived from
  file locations (`module-removal.test.ts`). Re-record a read size only if its band refuses it.
- [ ] T072 Run `manifests:generate` and `pnpm install --lockfile-only` if any package manifest
  changes.

## Dependencies and execution order

- P1 needs #987, #990 and #1016 merged. P2 needs P1, P3 needs P2, and P4 needs P3 (or merges with it).
- Within a phase, contracts come first, then RED tests (the `[P]` ones in parallel), then GREEN,
  then polish.
- Each phase is its own MR off `origin/master`. Never stack them.

## FR coverage index

| FR | Tasks |
| --- | --- |
| 001–009 | T001–T012 |
| 010–026 | T020–T038 |
| 030–038 | T040–T051 |
| 040–043 | T037, T038, T051, T060–T066 |
