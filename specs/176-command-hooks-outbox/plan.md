# Implementation Plan: Registration as one Command, command hooks, transactional outbox

**Branch**: `spec/176-command-hooks-outbox` (implementation branches per phase, see *Delivery*) |
**Date**: 2026-11-10 | **Spec**: [spec.md](./spec.md)
**Input**: owner rulings OD-7, OD-18, OD-24 (2026-11-10); outbox in scope per the 2026-11-10 brief.

## Summary

Three mechanisms, delivered as separately mergeable phases:

- **P1 — registration as one Command.** `RegistrationService` keeps its validations, then runs a
  single `organization.register` Command. The first account becomes a child
  `customer_account.create` Command from a new `customerAccountMemberCommandPort` (the
  `customerAccountRoleCommandPort` precedent), with the hash computed before the transaction. This
  closes today's partial-write window. No platform change.
- **P2 — `beforeCommit` hooks.** Owners declare hookable actions with typed refs published in
  `@endora-commerce/contracts` and listed in the manifest. Modules register hooks with
  `ctx.commandHooks`. The composer validates and orders them, using the dependency graph and an
  optional deployment tie-break, and refuses unordered or undeclared hooks. The Command Bus runs the
  present hooks after `run`, inside the transaction, with `ctx.run`, typed veto, an extension input
  carrier, noted audit changes and an origin ALS. `organizations` declares four actions.
- **P3 — `afterCommit` outbox.** A kernel table `command_outbox` is written by the bus in the same
  transaction, one row per present handler. A drain worker attached to `_lifecycle` follows the RFQ
  sweep pattern: BullMQ as the clock, `skip locked` claims, leases, backoff, dead-letter and a pinned
  tenant context. The `EventBus` is unchanged.
- **P4 — operator surface and governance.** A read-only execution plan, an outbox list, an audited
  retry, two permissions, a ⌘K action, pl+en strings, the constitution XIII/XV amendment, and the
  ladder and docs.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node ≥ 22.17.
**Primary Dependencies**: existing only — MikroORM 6.6.16, BullMQ (already a platform dependency),
Fastify, Zod, Awilix. **No new runtime dependency.**
**Storage**: PostgreSQL, one new kernel table (`data-model.md`).
**Testing**: Vitest; package-local `*.test.ts` beside subjects (platform, modules);
`backend/test/{contract,integration}` for HTTP and DB; instance acceptance probe.
**Constraints**: hooks run inside an open transaction, so they must make no remote calls
(documented); the outbox payload is limited to audit-state list 1.
**Scale/Scope**: the first hookable actions are the four `organizations` writes. Outbox volume is
the volume of hooked writes.

## Constitution Check

| Principle | Verdict | How |
| --- | --- | --- |
| I Modular (NN) | PASS | The account write stays in `customer_accounts` (child Command through its port). Hooks write only their own tables or run owners' Commands. The outbox is kernel-owned. No cross-module imports. |
| II API-first | PASS | `contracts/command-hooks.ts`, `CustomerAccountMemberCommandPort`, the organization hook refs and the admin API schemas come first. Additive only. |
| III TDD (NN) | PASS | `tasks.md` puts RED tests first in every phase. The FR→test map is in *Test plan*. |
| IV YAGNI | PASS | No dependency. Constants, not settings. No subscriber migration. No new `check-*` script. Four actions only. |
| V/VI/VIII | PASS | Naming per conventions (`command_outbox`, `Migration…Core…`). English only. |
| IX UI reuse | PASS | The screen uses admin-kit tables, tabs and buttons. Designer review is a task. |
| X Queue consumers | PASS | BullMQ clock + atomic claim + idempotency key + separable worker entrypoint (`ctx.worker` on `_lifecycle`). The producer only enqueues the wake job. It may be co-located in `BACKEND_ROLE=all`: **the volume is low (hooked writes only) and the worker stays a separable entrypoint.** |
| XI Tenancy (NN) | PASS | Hooks run on the Command's scoped em. Handlers run pinned to the row's Organization, never the original wider context. One escape-hatch record per non-idle tick. The outbox is global with list-1 data only. |
| XII Channel | N/A | No channel-scoped read. Registration keeps its channel binding on the transaction. |
| XIII Command Bus (NN) | PASS, **with amendment** | Registration and account creation become Commands, and both hand-written audits are removed. Hook writes are named in the owner's single entry. The outbox is written inside the transaction. Amendment (FR-042): a transactional outbox for post-commit delivery is durable event dispatch, not a bespoke command queue. |
| XIV Extensibility | PASS | Custom fields stay rung 0. Hooks are a developer seam, not operator data. |
| XV Overlay | PASS, **with amendment** | Hooks are contract-gated (declared refs). Unknown targets and unordered conflicts fail composition. Order is deterministic. Hooks appear in the divergence report as `command-hook`. They never replace an implementation or a guard. The amendment names declared command hooks in the overridable surface. |
| XVI Palette | PASS | `open-command-hooks` action. |
| XVII Toggleable (NN) | PASS | A hook is skipped per call when its module is absent. A handler's row waits without consuming an attempt. Off-state tests are in P2 and P3. Owners are `nonDeactivatable`. |

**Verdict: PASS**, conditional on the owner ratifying the XIII/XV wording (FR-042), which OD-7
already accepted in substance.

## Project Structure

### Documentation (this feature)

```text
specs/176-command-hooks-outbox/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── command-hooks-api.md            # the stable surface 177/178 name
│   ├── organization-hookable-actions.md
│   ├── registration-command.md
│   └── outbox-and-admin-api.md
└── tasks.md
```

### Source code touched

```text
packages/contracts/src/
├── command-hooks.ts                    # NEW: refs, declaration schema, admin API schemas, error codes
├── customer-accounts.ts                # + CustomerAccountMemberCommandPort, CustomerAccountCreateCommand
├── organizations.ts                    # + ORGANIZATION_HOOKABLE_ACTIONS and data types
└── modules.ts                          # + manifest.hookableActions, DivergenceKind 'command-hook',
                                        #   divergence declaration commandHookOrder
packages/platform/src/
├── commands/
│   ├── command.ts                      # + hookData, outboxData, extensions
│   ├── command-bus.ts                  # hook dispatch, audit merge, outbox write, wake
│   ├── hooks/                          # NEW: registry, ordering, origin ALS, errors
│   ├── outbox/                         # NEW: entity, writer, drain, wake queue, retry Command
│   └── index.ts                        # + published symbols (contracts/command-hooks-api.md §2)
├── kernel/module-context.ts, compose.ts  # ctx.commandHooks, seal + validation
├── composition/compose-app.ts          # build registry, pass to bus and composer
├── lifecycle/{backend,manifest,routes.admin}.ts, lifecycle/i18n/{en,pl}.json
├── lifecycle/services/orchestrator.ts  # --hard uninstall purges hook_module rows
└── migrations/<stamp>_core_command_outbox.ts
packages/modules/customer_accounts/src/backend/
├── commands/customer-account-create.command.ts      # NEW
├── services/customer-account-ports.ts               # create() delegates to the Command
└── index.ts                                         # providePort('customerAccountMemberCommandPort')
packages/modules/organizations/src/
├── backend/commands/register-organization.command.ts  # NEW
├── backend/services/registration-service.ts           # thin orchestration
├── backend/commands/{create-organization,admin-patch-organization,set-custom-field-values}.command.ts  # hookData/outboxData/extensions
├── manifest.ts                                        # hookableActions
└── docs/organizations.md (+ pl)
packages/test-kit/src/command-hooks/                   # NEW: expectHookableCommand, recording registry
packages/cli/src/generate/divergence.ts                # 'command-hook' kind
admin-shell (platform screen) + admin i18n
backend/test/test-server.ts                            # same wiring as compose-app (harness parity)
backend/scripts/acceptance/instance-probe.ts           # phase: package hook in an instance
docs/docs/architecture/{command-bus,customisation-ladder}.md (+ pl)
.specify/memory/constitution.md                        # XIII, XV amendment
```

**Structure decision**: extend `organizations`, `customer_accounts` and the platform. No new module.
The outbox and hook registry are Command Bus infrastructure, so they belong in `commands/`. Their
operator surface belongs to `_lifecycle`, the platform's resident admin module.

## Design decisions (reasoning in research.md)

| # | Decision | Research |
| --- | --- | --- |
| 1 | `organization.register` parent + `customer_account.create` child via `ctx.run` | R-1 |
| 2 | Hash before the transaction (async command factory) | R-2 |
| 3 | Slow or non-writing validation stays outside the Command | R-3 |
| 4 | Registration audit state follows `audit-state.md` from day one | R-4 |
| 5 | Hooks are a declared seam (middle row), compatible with D-176 Q3 | R-5 |
| 6 | Typed ref in contracts → manifest → root-derived data → composer | R-6 |
| 7 | Order from dependencies; unordered refused; deployment tie-break | R-7 |
| 8 | `run → hooks → audit → event → outbox → commit` | R-8 |
| 9 | Veto = `HttpError` with the hook module's code | R-9 |
| 10 | Per-call presence skip | R-10 |
| 11 | `extensions` carrier; unclaimed key refused | R-11 |
| 12 | `currentCommandHookOrigin()` | R-12 |
| 13 | Outbox per handler; `EventBus` untouched | R-13 |
| 14 | Four `organizations` actions first | R-14 |
| 15 | Outbox data = list 1 | R-15 |
| 16 | Handler pinned to the row's Organization; causation as data | R-16 |
| 17 | Constants for the clock, retries and retention | R-17 |
| 18 | Drain attached via `_lifecycle`'s `ctx.worker` | R-18 |
| 19 | No new static check; test-kit helper instead | R-19 |
| 20 | No hookable reversible Commands | R-20 |

## Cross-cutting concerns

- **Admin permissions**: `platform.command_outbox.read` and `platform.command_outbox.manage` in the
  `_lifecycle` manifest, with labels in pl+en (`module-admin-surfaces.md`). The execution plan reuses
  `platform.modules.read`.
- **Command palette**: `open-command-hooks`, gated on `platform.modules.read`.
- **i18n**: screen strings, permission labels, the action label, and `errors.COMMAND_EXTENSION_UNCLAIMED`
  / `COMMAND_HOOK_CYCLE` / `COMMAND_HOOK_DATA_MISSING` / `COMMAND_OUTBOX_NOT_DEAD` in pl+en. Hook
  authors translate their own veto codes.
- **Settings**: none. The intervals and limits are constants (R-17), and there are no secrets.
- **Audit**: everything goes through the Command Bus, including `command_outbox.retry`.
- **Tenant scoping**: see the XI row of the Constitution Check.
- **Redis cache invalidation**: no new cache. Presence already flows through the lifecycle pub/sub
  (`b2b:module:state-changed`) into `effectiveState`, which the registry reads per call. The wake
  job is a queue, not a cache.
- **Activation (XVII)**: per-call skip for hooks. For handlers, rows wait. An off-state test exists
  for each.

## Test plan (FR → test)

| FR | Test (file, kind) |
| --- | --- |
| FR-001, 003 | `backend/test/integration/organizations/registration-atomic.test.ts`: fault injection per step, zero residue |
| FR-002, 004 | `customer_accounts/.../customer-account-create.command.test.ts` (unit, real bus); `.../customer-account-ports.test.ts` (port delegates, no hand audit) |
| FR-005 | `register-organization.command.test.ts`: hash called before `transactional` (spy order) |
| FR-006 | `register-organization.command.test.ts`: events once on commit, none on rollback |
| FR-007 | `register-organization.audit.test.ts`: `expectNoAuditValues` sentinel, plus a key allowlist |
| FR-008 | existing `backend/test/contract/organizations/*register*` suites stay green, plus a race test for `409` |
| FR-009 | `registration-service.test.ts`: validations before `run`; ticket deletion after commit only |
| FR-010, 011 | `packages/contracts/src/command-hooks.test.ts`; `platform/src/kernel/module-context.commandhooks.test.ts` |
| FR-012 | `platform/src/commands/hooks/registry.test.ts`: one case per refusal |
| FR-013, 014 | `hooks/ordering.test.ts`: dependency order, intra-module order, `commandHookOrder`, contradiction |
| FR-015, 016 | `command-bus.hooks.test.ts`: same em and actor, child via `ctx.run`, veto status and code, non-Http → 500, rollback |
| FR-017 | `command-bus.hooks.test.ts` off-state case; `backend/test/contract/organizations/create-hook-off-state.contract.test.ts` |
| FR-018, 019 | `command-bus.hooks.test.ts`: data typed, own slice only, unclaimed → 422 before writes |
| FR-020 | `command-bus.hooks.test.ts`: `extensions.<m>.changedFields` merged into the single entry |
| FR-021 | `hooks/origin.test.ts`: set during the hook and its children, unset after |
| FR-022 | `command-bus.hooks.test.ts`: cycle, depth 9 |
| FR-023 | `command-bus.hooks.test.ts`: missing `hookData` → 500 |
| FR-024 | per Command: `expectHookableCommand` in each organizations Command test; `manifest.test.ts` declares four |
| FR-025 | `backend/scripts/acceptance/instance-probe.ts` phase `command-hook` |
| FR-026 | `packages/cli` divergence tests; `GET /api/v1/admin/command-hooks` contract test |
| FR-030, 031 | `command-bus.outbox.test.ts`: one row per present handler, none on rollback, list-1 guard |
| FR-032 | `backend/test/integration/platform/outbox-drain-concurrency.test.ts`: two drains, no double handling |
| FR-033 | `outbox/drain-worker.test.ts`: scheduler upsert idempotent, wake dedup, idle tick enters no scope |
| FR-034 | `backend/test/integration/platform/outbox-tenant-context.test.ts`: pinned org, request id on the handler's Command audit |
| FR-035 | `outbox/drain.test.ts`: backoff schedule, dead after 10, permanent failure, error text not stored |
| FR-036 | `outbox/drain.test.ts`: absent module waits with the attempt restored; unregistered → dead; orchestrator `--hard` purge test |
| FR-037 | `outbox/drain.test.ts`: retention purge |
| FR-038 | `events/bus.test.ts` unchanged; `harness-parity.test.ts` |
| FR-040, 041 | `backend/test/contract/platform/command-outbox-admin.contract.test.ts`; admin screen test; palette and permission inventory checks |
| FR-042, 043 | docs/constitution review tasks; `check:language`; docs i18n cache |

## Generated artefacts, changesets, documentation

- `composer:generate` (new core migration) and `manifests:generate` plus
  `pnpm install --lockfile-only` if package manifests change. Regenerate the divergence artefacts
  for `apps/example` and `apps/acceptance` if hooks are added there.
- Changesets: `@endora-commerce/contracts` (minor: hook refs, manifest field, port), `platform`
  (minor: bus members, barrel symbols, `ctx.commandHooks`, migration), `mod-customer-accounts`
  (minor: new port), `mod-organizations` (patch for P1: registration transactional and audit state
  names-only, called out for upgraders; minor for P2: hookable actions), `test-kit` (minor), `cli`
  (minor: divergence kind).
- `published-surface.test.ts` expected set for `./commands` and `./kernel`.
- Docs EN+PL: `command-bus.md`, `customisation-ladder.md` (a new seam between rungs 2 and 3, *"run
  inside the owner's write"*, and the stale "nothing to hook" note removed), `organizations.md`
  (hookable actions table), `kernel.md` § contribution seams (one row).
- Read sizes: moving file counts may move recorded read sizes. Follow `check-estate.md`: re-record
  only what the band refuses.

## Complexity Tracking

No new runtime dependency. No constitution violation needs justifying. The two amendments (XIII
wording, XV surface list) are FR-042 and are flagged for owner ratification.

## Delivery and sequencing

| Phase | Merge request | Depends on | Blocks |
| --- | --- | --- | --- |
| P1 registration Command | `feat/176-p1-registration-command` | **#987, #990 and #1016 merged** (all three rewrite the files P1 rewrites) | 177's registration changes; P2 |
| P2 beforeCommit hooks | `feat/176-p2-command-hooks` | P1 | 178 |
| P3 outbox | `feat/176-p3-command-outbox` | P2 | — |
| P4 operator surface and docs | `feat/176-p4-hooks-operator-surface` (may fold into P3) | P3 | — |

Each MR branches from `origin/master` after its predecessor merges. Do not stack them (stacked-PR
trap).

## Open decisions (recommendations; not asked of the owner by this agent)

- **OD-1 — the remedy for two unordered hook modules.** (a) Refuse only, so the remedy is a manifest
  dependency. (b) Also accept the deployment's `divergence.ts` `commandHookOrder`.
  **Recommendation: (b).** Two independent instance packages must not be forced to depend on each
  other. The deployment owns that order, and the file is already the home of `decorationOrder`.
- **OD-2 — operator screen in 176 or later.** **Recommendation: in 176 (P4).** A dead-letter queue
  with no screen is silent loss. The surface is read-mostly.
- **OD-3 — #990 ordering.** If #990 has not merged when P2 starts, P2 declares only `create` and
  `register`, and the two update actions follow in the MR after #990. **Recommendation: merge #990
  first.** It already converts the admin PATCH to a Command, and duplicating that here would
  conflict.
- **OD-4 — the registration audit payload goes names-only in P1.** It is a behaviour change visible
  in the audit screen. **Recommendation: yes** (O-2 and `audit-state.md` §2 already require it for
  new code). It needs an upgrade note in the changeset.
  *Overtaken (2026-11-11):* #1044 shipped the names-only payload before P1. P1 keeps it as it is;
  its changeset notes only that the entry is now written by the bus, so it carries the request id.
- **OD-5 — handler context.** The handler runs as `system` pinned to the Organization, with the
  original actor passed as data rather than restored. **Recommendation: yes** (R-16). Restoring a
  past admin's or sales rep's reach is unsafe.
- **OD-6 — whether a deployment still needs D-156.4's right to decorate `commandBus`** (review open
  question). **Recommendation: leave it unchanged in 176.** Revisit when a deployment has moved to
  hooks.

## Risks

- **Merge conflicts in `registration-service.ts`.** #987, #990 and 177 all edit it. P1 waits for
  #987 and #990, and 177 rebases on P1.
- **Audit allowlists (#470 series).** P1's `customer_account.create` Command must adopt #1016's
  payload. No organizations #470 PR exists yet, so P1 becomes the first names-only Organization
  Command. Coordinate with whoever opens it.
- **178 depends on hooks reading uncommitted state.** Owner read ports open their own EM and will not
  see the new row inside a hook. Hooks must use `ctx.data` and `ctx.em`. Contract §5 states this;
  178 must design its accessor on `ctx.em`.
- **Hooks lengthen transactions.** A slow hook holds row locks. The documented rule (no remote calls
  in `beforeCommit`) is the only guard.
- **Registration now holds one transaction across about seven statements.** This is acceptable, and
  the hash is outside.
- **`harness-parity.test.ts`.** The test server must wire the registry identically, or the two roots
  drift.

## Handoff summary for `endora-commerce-dev`

Implement in four MRs, P1 → P4, each off `origin/master`, TDD per `tasks.md`. P1 is self-contained:
the registration Command, the account-create Command and port, removal of both hand audits, and
names-only audit state. Start it only after #987, #990 and #1016 are merged. P2 builds the hook
registry and bus dispatch exactly as `contracts/command-hooks-api.md` specifies. Those names are
consumed by specs 177 and 178, so do not rename them without updating both. P3 adds the kernel
`command_outbox` table (scaffold it, never number it), the drain on `_lifecycle`'s `ctx.worker` and
the RFQ sweep shape. P4 adds the admin surface, permissions, palette, i18n, docs, the ladder and the
constitution amendment. Verify each MR with `build:packages`, `typecheck`, `lint`, the targeted
tests, `pnpm --filter '!backend' run test`, and the contract and integration suites for
organizations and platform, which do not run on MR pipelines (D-198).
