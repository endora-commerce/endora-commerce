# Research: 176 — command hooks and outbox

Each entry: **decision → rationale → alternatives rejected**. Code citations are against
`origin/master` at `2cc56ea9b`.

## Verified current state

| Fact | Evidence |
| --- | --- |
| The bus: one `forkScopedEm` transaction, one `EventBus.run` scope, `execute()` per Command; children through `ctx.run` share em, actor and request meta | `packages/platform/src/commands/command-bus.ts` (`run`, `execute`) |
| Request metadata defaults to the ambient platform scope (#997, merged as #1013) | `command-bus.ts` `CommandBusOptions.getRequestMeta`; `kernel/scope.ts` `currentRequestMeta` |
| Events emitted inside a bus run are buffered and dispatched after commit, dropped on rollback; handler errors are swallowed and logged | `packages/platform/src/events/bus.ts` |
| Registration is not transactional: `persistAndFlush(organization)`, channel binding, `accounts.write.create` (own `emFactory()`, own flush), lookup row flush, token flush, hand audit via `recordAuditFromContext` | `packages/modules/organizations/src/backend/services/registration-service.ts` `registerOrganization` |
| `CustomerAccountMemberWritePort.create` opens its own EM and audits by hand (`#audit`) | `packages/modules/customer_accounts/src/backend/services/customer-account-ports.ts` `create` |
| Precedent for a cross-module **Command factory** run as a child: `customerAccountRoleCommandPort.changeRole` inside `organization_role.delete` | `packages/contracts/src/customer-accounts.ts` (`CustomerAccountRoleCommandPort`, `CustomerAccountRoleChangeCommand`); `organizations/src/backend/commands/organization-role-delete.command.ts` |
| `organization.create` is already a Command; admin PATCH is not (hand audit `organization.admin_patch`) on master | `commands/create-organization.command.ts`; `routes.admin.ts` PATCH `/api/v1/admin/organizations/:id` |
| #990 converts admin PATCH into Command `organization.admin_patch` and adds `organization.set_custom_field_values` | PR #990 files `commands/admin-patch-organization.command.ts`, `commands/set-custom-field-values.command.ts` |
| API interceptors: module-stamped registrations, per-call gating on module enabled state, veto by `HttpError`, other throw → 500 | `packages/platform/src/http/interceptors/types.ts`, `dispatch.ts` |
| Decoration of an installed package's registration is refused (D-176 Q3), exit named: the package *declares* what it offers | `packages/platform/src/kernel/module-context.ts` `PackageDecorationNotOfferedError` |
| The composer may not read manifests; roots pass derived data (`requiredModules`, `decorationOrder`) | `packages/platform/src/kernel/compose.ts` `ComposeModulesOptions` |
| Effective presence is a synchronous in-memory read | `packages/platform/src/kernel/lifecycle/effective-state.ts` `isPresent` |
| Periodic DB-backed work pattern: BullMQ job scheduler as clock, rows read `for update skip locked`, `enterSystemScope` only for a non-idle tick | `packages/modules/quote_requests/src/backend/workers/rfq-expiry-sweep-worker.ts` |
| `bullmq` is already a `@endora-commerce/platform` dependency; the platform owns `core_*` migrations | `packages/platform/package.json`; `packages/platform/src/migrations/` |
| `./commands` is one of the five published barrels | `packages/platform/src/commands/index.ts`; `backend/scripts/check-platform-surface.ts` |
| Anonymous requests carry a system tenant context | `packages/platform/src/kernel/actor-tenant-context.ts` (header comment, l. ~76) |
| The ladder states the bus has "no handler registry and nothing to hook" | `docs/docs/architecture/customisation-ladder.md` rung 1 note |

## R-1 Registration becomes Command `organization.register` with a child `customer_account.create`

**Decision.** A new `makeRegisterOrganizationCommand` in `organizations/src/backend/commands/`. The
first account is created by a child Command built by a new `customer_accounts` port,
`customerAccountMemberCommandPort.create(input)`, run through `ctx.run`.
**Rationale.** `ctx.run` is the existing, tested path for a composite, per-entry-audited, atomic
write (feature 170 R-22). The role-command precedent already crosses exactly this module pair. No
`EntityManager` crosses a contract.
**Rejected.** (a) Pass `{ em }` to `CustomerAccountMemberWritePort.create` (the
`channelMembership` precedent): leaks an EM through a contract the port's own header says must not,
and the audit row would still be hand-written. (b) `em.transactional` inside the service without the
bus: leaves the hand audit (XIII violation) and gives hooks nothing to attach to. (c) Run the org
insert as a child `organization.create`: a registration would then read as two organization entries
in the audit log, and `organization.create` carries operator semantics (`approvedByAdminUserId`).

## R-2 Hash the password before the transaction

**Decision.** `customerAccountMemberCommandPort.create` is `async` and returns the Command after
hashing; the registration service awaits it before `commandBus.run`.
**Rationale.** argon2 is ~50 ms by design; inside the transaction it would hold the new
Organization row and a connection for it, on an anonymous endpoint.
**Rejected.** A synchronous factory hashing inside `run` (the `changeRole` shape): correct but holds
the transaction; acceptable for role changes (no hash), not here.

## R-3 What stays outside the Command

**Decision.** Country dictionary validation, the #987 custom-field validation, the registry ticket
read stay before `commandBus.run`; the tax-id and e-mail checks move **inside** (they read on the
transaction); ticket deletion runs after `run` resolves.
**Rationale.** Nothing slow or remote inside the transaction; the pre-checks that guard writes read
the same snapshot the writes see.

## R-4 Registration audit state follows `audit-state.md` now

**Decision.** `organization.register`'s after-state becomes `{ status, vatStatus, isPersonal,
salesChannelId, registryLookup: { provider, outcome } | null, customFieldKeys, changedFields }`; no
name, tax id, address.
**Rationale.** O-2 rules the Organization record is covered; a new Command is "new code" and
`audit-state.md` §2 excludes unclassified fields. Writing it non-compliant would hand the
organizations #470 batch a regression to fix.
**Rejected.** Keep today's payload for continuity: O-4 only protects *historical rows*, not new
writes.

## R-5 Hooks are a declared seam, not decoration (D-176 Q3)

**Decision.** Hooks are offered to every module kind — core, overlay, installed package — on actions
the owner declares, i.e. the *middle row* of the ladder's "who may" table ("by that module's
invitation").
**Rationale.** D-176 Q3 refuses decoration because the wrapped name is **unpublished** and a wrap
replaces the implementation. A hookable action is the inverse on both counts: it is published (the
manifest declaration plus a typed ref in `@endora-commerce/contracts`, where a change costs a
version bump — the exact exit `PackageDecorationNotOfferedError` names), and a hook can only add to
or refuse the owner's write. The owner's `run`, its invariants, its single audit entry, the tenant
guard and the bus itself stay untouched and unwrappable. That makes it rung-2-shaped (interceptors),
one layer down: a write instead of an endpoint. It does not widen rung 4a and does not amend D-176.
**Rejected.** (a) Lift D-176 Q3 with a `decoratable` list (OD-1 d): still replaces implementations
and is deployment-only, so packages remain excluded. (b) Let `ctx.di.decorate('commandBus')` be the
answer: overlay-only (D-156.4) and lets a stranger see every audited write.

## R-6 Declaration: typed ref in contracts, listed in the manifest

**Decision.** `@endora-commerce/contracts` exports `hookableAction<TData, TOutbox>(action, phases)`
returning a `HookableActionRef`; the owner's constants (`ORGANIZATION_HOOKABLE_ACTIONS`) live in
contracts; the manifest field `hookableActions` lists those refs (via `toHookableActionDeclaration`).
Roots derive `hookableActionsFrom(manifests)` and hand them to the composer as data.
**Rationale.** One constant feeds both the manifest (composition validation) and the hook author's
types; contracts stay platform-free (structural, like `CustomerAccountRoleChangeCommand`); the
composer never reads manifests (compose.ts rule).
**Rejected.** Declare in code at `registerModule` time: invisible to the manifest-level tooling
(divergence report, docs) and to `module:install`. Infer from the action string prefix: a module
would then expose every Command by accident.

## R-7 Ordering from dependencies; unordered refused; deployment tie-break

**Decision.** Within one action and phase, hook modules are ordered so that a module runs after
every module it transitively depends on; hooks of one module keep registration order. Two modules
with no path between them refuse composition (`UnorderedCommandHooksError`) unless the deployment's
`divergence.ts` names them in `commandHookOrder[action]` (OD-1). A declaration contradicting a path
is refused.
**Rationale.** Owner ruling (brief) and the converged pattern in the review §3(e) e2; mirrors
`AmbiguousDecorationError`. Determinism (XV).
**Rejected.** Numeric `order` with lexicographic tie-break (interceptors): two strangers picking
numbers is silent last-wins with extra steps. Registration/load order: accidental.

## R-8 Timing inside the Command

**Decision.** `capture → run → beforeCommit hooks → owner audit entry (with hooks' noted changes)
→ event buffered → outbox rows persisted → commit`.
**Rationale.** Hooks see the owner's write (flushed state available on `ctx.em`); a veto discards
everything including the not-yet-recorded entry; hook changes can be named in the single entry
(178's "one audit entry").
**Rejected.** Hooks before `run` (a "pre" hook): cannot see the created id or row; owners that want
input validation already have interceptors at the endpoint.

## R-9 Veto semantics

**Decision.** Throw `HttpError` with a code the hook module declares in `errorCodes` and translates;
the bus does not catch. Any other throw → rollback → `500`. `ModuleDisabledError` passes through as
503. No platform "refusal" wrapper class is required; `CommandHookRefusal` is offered as a thin
`HttpError` subclass for readability only.
**Rationale.** Same as interceptors and every Command today; error ownership per feature 090.

## R-10 Off-state (XVII)

**Decision.** Per call, `effectiveState.isPresent(hookModule)` decides; absent hooks are skipped;
their extension key then counts as unclaimed (FR-019).
**Rationale.** Live activation (no restart, `module-activation.md`); same as interceptor dispatch.
**Rejected.** Filter at composition: activation is live, so that would keep running a switched-off
module's hook until restart.

## R-11 Extension input carrier

**Decision.** `Command.extensions?: Record<moduleId, unknown>`; the hook gets its own slice,
validates it itself (178 supplies the Zod fragment); unclaimed keys refuse 422.
**Rationale.** 178 needs caller-supplied values in the same transaction (Medusa `additional_data`
precedent). Refusing unclaimed keys prevents silent data loss when the module is off or misspelt.
How HTTP bodies carry `extensions` is 178's contract decision; 176 only provides the carrier.

## R-12 Hook origin exposure

**Decision.** `currentCommandHookOrigin(): { moduleId, hookId, action } | undefined`, from an
`AsyncLocalStorage` set by the dispatcher around each hook (and its children).
**Rationale.** Answers the review's open question ("does the bus need to expose the running
owner?") in the narrow form 178 needs: assert that only module M writes `x_M_*`. The hook context
also carries `module.id` for the hook itself.

## R-13 Outbox, not a durable EventBus

**Decision.** A new kernel table `command_outbox`, one row per (Command execution, present
`afterCommit` handler), written in the Command's transaction; `EventBus` and its subscribers are
unchanged; no subscriber migrates (FR-038).
**Rationale.** Minimal scope; per-handler rows give independent retry/dead-letter and a stable
idempotency key; 46 emit sites and their subscribers keep their semantics.
**Rejected.** (a) Persist every `Command.event` and drain to all subscribers: migrates every
subscriber's semantics (sync-after-commit → async) at once. (b) One row per Command, fan-out at
drain: one failing handler re-runs the others or needs a second state table. (c) BullMQ job per row
as the source of truth: two stores of delivery state; a Redis flush loses work.

## R-14 Which actions are hookable first

**Decision.** `organization.create`, `organization.register`, `organization.admin_patch`,
`organization.set_custom_field_values`. Personal provisioning, set-parent/move, moderation actions
are not declared now.
**Rationale.** These four are what 178 (atomic `x_*` writes on create/register/update) and 177
(its own convert command declares itself) need. Personal provisioning is not a Command yet
(`personal-organization-service.ts` writes with `em.create`), and 177 rewrites it; declaring it is
an additive follow-up. Declaration is a contract, so starting narrow is cheaper than retracting.

## R-15 Outbox data limited to audit-state list 1

**Decision.** Owner `outboxData(result)` returns ids, codes, booleans, counts, dates, field names;
handlers re-read state through owner ports after commit.
**Rationale.** The table is platform-global and readable under a platform permission without
Organization reach, exactly the property that made `audit-state.md` restrict audit rows. Re-reading
also avoids handlers acting on stale snapshots after retries.

## R-16 Tenant context at delivery

**Decision.** One `enterSystemScope('command_outbox: drain', …)` per non-idle tick to claim; each
row's handler then runs in `enterPlatformScope(orgPinnedTenantContext(row.organizationId, reason),
…, { requestMeta: { requestId: row.requestId }, entryPoint: 'worker' })`, or the tick's system scope
when the row has no Organization. The original actor is handed over as data (`causation`), not
re-impersonated.
**Rationale.** Pinning narrows rather than widens (no extra escape-hatch record per row; one per
tick, as the RFQ sweep does). Re-creating the original admin or sales-rep context is unsafe:
permissions and reach may have changed since, and `excluded-set` contexts are not serialisable.
The platform may use `orgPinnedTenantContext` (D-285 restricts modules, not the host).
**Rejected.** Run every handler under system scope: a handler for org A could read org B (XI).

## R-17 Delivery mechanics

**Decision.** Constants, not settings: tick every 10 s; wake job `command_outbox.drain.wake`
deduplicated, enqueued after a commit that wrote rows; batch 50; lease 5 min; max 10 attempts;
backoff `min(30 s · 2^(n-1), 1 h)`; delivered retention 7 days; dead rows kept until retried or
purged (90 days). `ModuleDisabledError`/absent module → leave pending, no attempt consumed.
`PermanentOutboxFailure` → dead at once.
**Rationale.** RFQ precedent ("BullMQ is the clock and nothing more"); worker-gate precedent for
"refused job is left waiting"; constants because nobody has asked to tune them (IV).

## R-18 Where the drain runs

**Decision.** Logic in `packages/platform/src/commands/outbox/`; the BullMQ worker is attached
through `_lifecycle`'s `ModuleContext` (`ctx.worker`) in `packages/platform/src/lifecycle/backend.ts`.
**Rationale.** `_lifecycle` is the platform's resident, `nonDeactivatable` module; `ctx.worker`
gives the shutdown and reconcile path and keeps `check:subscribe-seam` honest. Per-row presence
gating is on the **handler's** module, inside the drain.
**Rejected.** Start a worker directly in `compose-app.ts`: a consumer outside every registry, the
defect `check:subscribe-seam` exists to refuse.

## R-19 No new static check

**Decision.** Rules are enforced at composition (FR-012) and at run time (FR-023), plus a test-kit
helper `expectHookableCommand` each owner uses.
**Rationale.** A `check-*` script brings a ledger and a read size (`check-estate.md`); the
composition refusal already fails every test and boot.

## R-20 Reversible Commands

**Decision.** Owners must not declare a reversible Command's action hookable (documented rule +
the `expectHookableCommand` helper asserts the Command is not reversible where detectable).
**Rationale.** Undo restores the owner's captured state only (XIII undo must not silently clobber).
