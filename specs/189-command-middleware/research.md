# Research: Declared command middleware, and narrowing D-156.4

Every entry gives the decision, the rationale and the alternatives that were rejected. The
evidence was measured on `origin/master` at `ff7efc3e8` unless stated otherwise.

## R-1 Middleware lives inside the Command Bus, not around it

**Decision.** `admit` and `observe` are steps of `CommandBus` itself. They are driven from `run`
(root admission and observation) and from the private `execute` (child admission). The bus takes
them from a sealed `CommandMiddlewareRegistry`, passed as a new `CommandBusOptions.middleware`,
beside `hooks`.
**Rationale.** A child Command reaches `execute` directly: from `ctx.run`, and from a hook's
`run` (`command-bus.ts`, the `run:` member of the context built in `execute`, and
`runBeforeCommitHooks`). Only code inside the bus sees every Command. The hook registry
(`commands/hooks/registry.ts`) already shows the shape: one registry per composed application,
shared by the bus and every `ModuleContext`, sealed by `composeModules`, with presence asked per
call.
**Rejected.** (a) *A sanctioned wrapper type around the public bus.* It still misses children,
which is defect 1. (b) *An `EventBus` subscriber on a "command ran" event.* Events are buffered
and dispatched only on commit, so rollbacks and refusals are invisible, and `admit` cannot be
expressed at all. (c) *Extending command hooks to `'*'`.* Hooks run inside the transaction with
the Command's data and `em`, on actions the **owner** opened. Opening every action to a stranger
would undo 176 R-5.

## R-2 Exactly two phases; no transform

**Decision.** `admit(meta)` passes or refuses. `observe(outcome)` reads. Nothing else is offered.
**Rationale.** #1840 §4 and D-296.1. A transform makes the audit entry and undo state disagree with
what the actor sent, which is the integrity defect Principle XIII exists to prevent. Owner-declared
input changes already have a route: `extensions` and `beforeCommit` hooks.
**Rejected.** *A `transform` or `around` phase.* It is the decoration we are retiring, with a
declaration added.

## R-3 Where root admission runs: before the transaction opens

**Decision.** For the root Command, admission runs in `run`, after `resolveCommandActor()` and
before `events.run(…)` / `forkScopedEm` / `transactional`. For a child, it runs at `execute` entry,
after the existing hook-cycle check and before `assertExtensionsClaimed`. Both call one private
`admit(command, actor, meta, lineage)`.
**Rationale.** The issue says *"at `execute` entry, before `extensions` are checked"*. The intent
is that every Command, children included, is admitted before anything else happens. Admitting the
root before the transaction has the same order relative to the extension check, the capture and
the write. It also does not hold a pooled connection open for up to the admission budget on a
Command that may be refused. A child's admission necessarily runs inside the parent's transaction,
so the budget is capped low (R-8).
**Rejected.** *Root admission inside `execute` as well, for uniformity.* It costs a connection held
for the length of the budget on every admitted root, for no difference in behaviour.

## R-4 `admit` sees metadata only

**Decision.** `CommandAdmissionMeta = { action, objectType, objectId, actor, organizationId,
requestMeta, lineage }`. `actor` is the bus's `CommandActor`. `organizationId` is the ambient
`TenantContext.organizationId` when the mode is `single-org`, and `null` otherwise. `requestMeta` is
`{ requestId, ipAddress, userAgent }`, from the bus's existing `getRequestMeta`. `lineage` is
`{ ancestors, depth, viaHook }`, from the bus's existing private `Lineage`. The object is frozen.
**Rationale.** D-296.2. Every use case #1840 names (rate limit, tenant freeze, actor-kind rule,
maintenance window) is decided on these fields. Data is the owner's private shape, and today it
is published only to hooks on declared actions (176 FR-018). Giving it to a cross-cutting
middleware would make every Command's internal shape a contract. It would also put values in the
hands of code that sees every write.
**Rejected.** (a) *`hookData` when the action is hookable.* It would make admission behave
differently on declared and undeclared actions, and the issue defers widening. (b) *The `em`.* It
invites reads inside a gate that runs on every Command, and writes outside the audit path.

## R-5 Refusal: a typed `HttpError`, codes owned by the contributor

**Decision.** `CommandRefusedError extends HttpError` with `(code, status = 403, details?)`.
`status` is one of 403, 409, 422, 429 or 503. `details` allows only `retryAfterSeconds` (a positive
integer). The code is declared in the contributing module's `errorCodes` and translated by it
(feature 090). Anything else thrown becomes `COMMAND_ADMISSION_FAILED` (503). A budget overrun
becomes `COMMAND_ADMISSION_TIMEOUT` (503). Both are logged with the middleware label and the error
class only.
**Rationale.** It matches 176 R-9 (a hook vetoes with an `HttpError` carrying its module's code)
and the error-envelope ownership of feature 090. 503 for a broken or slow gate says "the platform
could not decide", which is honest. 403 would tell the caller it is not allowed, which nobody
decided. Failing closed is #1840 §2.
**Rejected.** (a) *Pass on timeout (fail open).* An admission rule that fails open under load is
not a rule. (b) *Let any `HttpError` through as the refusal.* A `ModuleDisabledError` from a port
the middleware calls would then look like the middleware's decision. It is converted to
`COMMAND_ADMISSION_FAILED`, and the log carries the class, `ModuleDisabledError`, which is enough
to diagnose. (c) *The bus validates the code against the module's `errorCodes` at run time.* The bus
would then need manifest data it does not have today. The test-kit conformance helper and the
existing error-code inventory catch an undeclared code in the author's own suite.

## R-6 `observe`: after settle, detached, at most once, capped

**Decision.** `run` collects a `RunRecord` in its existing `RunState`: one entry per attempted
Command, with refusals, the `audited` flag and the noted field names that `runBeforeCommitHooks`
already computes. In a `finally` it schedules `registry.observe(outcome)` with
`void Promise.resolve().then(…)`, so the caller's promise settles first. Observers run
concurrently (`Promise.allSettled`), each raced against its budget. A throw or an overrun is logged
once per occurrence as `command.observe.failed` / `command.observe.timeout`, with the label and the
error class. Each middleware has an in-flight cap (constant `COMMAND_OBSERVE_MAX_IN_FLIGHT`). Beyond
it the call is dropped, and a counter is logged at most once per minute as `command.observe.dropped`.
**Rationale.** #1840 §3: read-only, fire-and-forget, at most once, cannot fail the write. The bus
already detaches the outbox wake the same way (`run`, after commit), so this follows a pattern that
has been reviewed. The cap keeps a slow sink from growing memory without bound. Dropping is within an
at-most-once contract.
**Rejected.** (a) *Awaiting observers.* That couples write latency to a metrics sink. (b) *Running
them sequentially.* One hung observer would delay every other one by its budget. (c) *A durable
queue.* That is the outbox. A durable sink for a declared action is an `afterCommit` hook. A durable
record of every Command already exists: it is `audit_log_entries`, and a deployment that needs
completeness reads that table rather than an observer.

## R-7 What `observe` sees, by origin

**Decision.** The outcome has `{ root: CommandAdmissionMeta, committed, refusal, errorCode,
durationMs, commands: CommandRunEntry[] }`. A `CommandRunEntry` is `{ action, objectType, objectId,
depth, viaHook, refused, audited, notedFields }`, and `notedFields` maps a hook's module to its
sorted field names. `errorCode` is the thrown `HttpError`'s `code`, otherwise `'INTERNAL_ERROR'`.
It is never a message. For an observer of origin `package`, `requestMeta` is reduced to
`{ requestId }` (D-296.3, FR-022).
**Rationale.** Every value here is from `audit-state.md` list 1: ids, codes, booleans, counts and
field names. The audit entry already records IP address and user agent, so `core` and `deployment`
observers learn nothing new from them. An installed third-party package sees every write's actor
ids. It does not need the client's IP address and user agent to measure anything, so withholding
them follows data minimisation at no cost to the stated use cases.
**Rejected.** *Entries only for Commands that matched the observer's filter.* An observer filtered
on `organization.` that cannot see that the root was `quote.convert` cannot attribute its timing.
The filter decides **whether** an observer runs, not what it sees.

## R-8 Time budgets are constants, with a per-declaration value under a cap

**Decision.** In `@endora-commerce/contracts`: `COMMAND_ADMIT_TIMEOUT_DEFAULT_MS = 100`,
`COMMAND_ADMIT_TIMEOUT_MAX_MS = 500`, `COMMAND_OBSERVE_TIMEOUT_DEFAULT_MS = 1000`,
`COMMAND_OBSERVE_TIMEOUT_MAX_MS = 5000`, `COMMAND_OBSERVE_MAX_IN_FLIGHT = 1000`. A declaration may
set `timeoutMs` up to its phase's cap. `admit` receives an `AbortSignal` that fires at its budget.
**Rationale.** A child's admission holds the parent's transaction, and its row locks, for as long
as it runs, so the cap is low. A Redis rate-limit check takes about a millisecond. 176 R-17 kept
the outbox's clock and limits as constants for the same reason: no operator decides them. The
abort signal lets a well-behaved `admit` stop its own I/O. A promise cannot be cancelled otherwise.
**Rejected.** (a) *Settings in the Settings module.* No operator has a reason to change them, a
wrong value becomes a production incident, and the per-declaration value already lets an author
tune within the safe range. (b) *No cap.* An author's `timeoutMs: 30000` would hold every
transaction with a child for thirty seconds.

## R-9 Order: dependencies for `admit`, none for `observe`

**Decision.** `admit` middlewares from different modules are ordered so that a module's middleware runs
after that of every module it transitively depends on. Within a module, registration order applies.
Two modules with no path between them are refused when their filters **can overlap**: either is
`'*'`, or one prefix starts with the other. The remedy is the deployment's
`divergence.ts` `commandMiddlewareOrder: string[]`, a list of module ids where the first runs
first. An entry that contradicts the graph is refused, and so is an entry naming a module that
contributes no `admit`. The ordering function generalises 176's `orderCommandHooks` and is shared
with it rather than copied (`commands/ordering.ts`). `observe` middlewares are not ordered.
They are listed by module id, then registration order.
**Rationale.** #1840 §5: *"by module dependency; ties need an explicit `commandMiddlewareOrder` in
the deployment's `divergence.ts`, mirroring decoration order"*. Admission order is observable: the
first refusal wins, so it decides which code the caller gets and whether a counting middleware
counted. Observation order is not observable, because observers run concurrently and none sees
another. Requiring a tie-break there would refuse safe compositions. That is the 176 P4 ruling for
`afterCommit` handlers, applied here for the same reason. Overlap detection keeps two strangers
with disjoint filters from being forced to know each other.
**Rejected.** (a) *Numeric priorities.* Two strangers choosing numbers is a silent last-wins with
extra steps (176 R-7). (b) *One global order across all modules regardless of overlap.* It refuses
compositions that can never conflict. (c) *An order keyed by action, like `commandHookOrder`.*
Middleware is not attached to an action, and one module-level list is all a tie needs.

## R-10 Gating: `isPresent` per run

**Decision.** The registry takes `isPresent(moduleId)`. Both roots wire it to
`effectiveState.isPresent`, as the hook registry does. `admit` asks per Command, `observe` per run.
An absent middleware is skipped. A run that started while the module was present does not re-ask
for its observation. The observation uses the answer at observation time.
**Rationale.** Principle XVII, and `module-activation.md`'s live-activation rule: presence flows
through the lifecycle pub/sub (`b2b:module:state-changed`) into `effectiveState`, and no restart is
needed. It is the same answer 176 R-10 gave.
**Rejected.** *Filtering at composition.* A switched-off module would keep running until restart,
which is defect 3 of the bus wrap again.

## R-11 Origin: derived by the loaders, never authored

**Decision.** A new `ModuleEntry.origin?: 'core' | 'deployment' | 'package'`. The generated
composer leaves it absent, which means `core`. `loadOverlayModuleEntries` sets `'deployment'`.
`loadPackageModuleEntries` sets `'core'` when the package's `package.json` `name` **and** its
`endora.id` match an entry of the platform's generated `FIRST_PARTY_MODULE_PACKAGES` (the release's
own publishable module packages, derived by the same rule as the CLI's release index,
`packages/cli/src/lib/release-index.ts` `publishablePackages`), and `'package'` otherwise. When the
field is absent, `composeModules` derives it from the existing flags: `overlay` gives `deployment`,
`installedPackage` gives `package`, and neither gives `core`. Only the middleware registry reads it.
The full contract is in `contracts/module-origin.md`.
**Rationale.** The owner's phrase is *"manifest `origin`, 'deployment' tier"*. The codebase has
already ruled twice that a module may not certify itself: `ModuleEntry.overlay`'s doc, the
`ForeignDecorationError` doc block (*"widening it, re-typing it to an origin enum or setting it
from a declaration hands a stranger the audit path"*), and `contracts/modules.ts`'s `errorCodes`
note (*"adding one would be a self-certified exemption issued by the measured party"*). So "origin"
is a fact about the **composed** manifest entry, stamped by the loader from where it found the
module. In an instance, core modules arrive as installed packages
(`installed-packages.ts`, and #1841's own sentence), so without the first-party list every core
module in every instance would lose `admit`. The first module that shipped one would then compose
in this repository and refuse in every instance. Matching the name and the id together defeats an
npm alias (`"@endora-commerce/x": "npm:other@1"` installs a package whose own `name` is `other`).
`overlay` and `installedPackage` are left alone, because D-156.4's doc forbids merging a granting
flag and a refusing flag.
A paid module is not in this workspace (D-265), so it is not on the generated list and its origin
is `package`. The owner confirmed that on 2026-11-23 (D-296.8): it stays so until a **signed**
first-party list exists, which would be a later ruling and a change to this derivation.
**Rejected.** (a) *A manifest field `origin`.* Self-certified. (b) *An npm scope test
(`@endora-commerce/*`).* It is defeated by aliases and by a mirrored private registry, and it is a
string convention rather than a derivation. (c) *`package` for every installed package, including
first-party.* That is the time bomb above. (d) *Retyping `overlay` into the enum.* Explicitly
refused by D-156.4's own text, which D-296 keeps.

## R-12 Declaration in the manifest, code through the context

**Decision.** The manifest field `commandMiddleware` carries `{ id, phase, actions, timeoutMs? }`.
`ctx.commandMiddleware([{ id, phase: 'admit', admit }, { id, phase: 'observe', observe }])`
registers the code. At seal, the registry matches the two by `(moduleId, id)` and refuses any
mismatch (FR-002). Roots derive `commandMiddlewareFrom(manifests)` and hand it to `composeModules`
as data, as they do with `hookableActionsFrom`.
**Rationale.** #1840 §1: the divergence report, the docs and `endora generate` read the
declaration without running code. That is how an installed package's `admit` is reported before
boot (US4 scenario 5). The composer still never reads a manifest (the `compose.ts` rule), because
the root derives the data. Keeping the action filter only in the manifest gives it one home.
**Rejected.** (a) *Declaring in code only.* Tooling cannot see it, the same reason 176 R-6 rejected
it. (b) *Code in the manifest.* A manifest is data, imported by processes that compose nothing
(`module:install`).

## R-13 Re-entry is refused

**Decision.** The bus runs every middleware call inside `runWithCommandMiddlewareOrigin({
moduleId, id, phase })`, an `AsyncLocalStorage` like `commands/hooks/origin.ts`. `CommandBus.run`
throws `COMMAND_MIDDLEWARE_REENTRY` (500) when it finds a middleware origin.
**Rationale.** An `admit` that runs a matching Command is admitted again, without end. An
"observer" that runs a Command is a writer outside its contract. Both would be silent without the
check. ALS inheritance follows the call through awaits, so the guard holds however deep the call
goes.
**Rejected.** *Documenting it only.* It is cheap to enforce, and the failure (an unbounded loop
under load) is expensive.

## R-14 The activation Command is exempt from admission

**Decision.** The platform constant `ADMISSION_EXEMPT_ACTIONS = ['module.activation.set']`
(`lifecycle/commands/activation.commands.ts` owns the action). Those Commands are observed but
never admitted.
**Rationale.** Principle XVII says a module that is off behaves as if never installed, *"its own
activation control excepted"*. An `admit` that refuses everything, whether through a bug or a
wrong rule, must not be able to refuse the Command that switches its own module off. That Command
is the operator's recovery. One action with a reason is a policy fact, not a list that grows. A
unit test asserts that the constant names an action the activation Command actually uses, so it
cannot go stale.
**Rejected.** (a) *A `Command.admission: 'exempt'` flag.* Any module could exempt its own writes.
(b) *No exemption.* The CLI can still disable a module, but an operator on the admin screen would
be locked out by a third party's bug.

## R-15 Narrowing D-156.4: the four guard seams, by list

*Rewritten for the owner ruling of 2026-11-23 (spec OQ-3, D-296.5 and D-296.6 as amended). The
first draft recommended refusing every root-supplied name. The owner chose the alternative.*

**Decision.** The predicate, evaluated in `decorate`'s `apply` for a decorator with
`isDeploymentOverlay`, is: the owner of the name is `undefined` (root-supplied) **and** the name is
one of `GUARD_SEAM_REGISTRATIONS` (`commandBus`, `auditLogService`, `eventBus`, `emFactory`) →
deprecated in 0.113.0, refused in 0.114.0 with `GuardSeamDecorationError`. Every other
root-supplied name stays decoratable by an overlay, with no warning, no finding and no refusal.
Owners that remain decoratable: another overlay module of the same deployment, a workspace module,
and a root for any name outside the four. An installed package's registration stays refused first,
by `PackageDecorationNotOfferedError`. The list lives once, in `@endora-commerce/contracts`, so the
platform and the CLI's divergence derivation (which does not load the platform) read one constant.
Two tests hold the list: one pins its exact content, and one asserts that both composition roots
register each name as root-supplied (spec FR-055).
**Rationale.** The owner's scope ruling and #1841 items 1 and 2 name exactly four seams, the ones
through which Principles XI and XIII are enforced. That is the defect XV's *"never a guard seam"*
describes. The other root plumbing (`redis`, `orm`, `requireAdmin`, …) is not a guard seam: a wrap
of it does not bypass auditing or tenancy, and refusing it would take a capability away from
deployments with no declared replacement for most of those names. A list is unavoidable, because
nothing in the ownership ledger tells a guard seam from other root plumbing. D-100 forbids writing
down a *count* or an *inventory* that `ls` or a derivation can answer, and this list is neither. It
is a ruling's content, and the pinning test is what makes a change to it a deliberate act.
The `owner === undefined` half of the predicate is kept, although the root-registration test makes
it redundant in practice, so that the rule reads as "a root's guard seam" rather than "a string".
The error is named `GuardSeamDecorationError`, not `RootSuppliedDecorationError`: the first draft's
name would claim a scope the ruling does not have.
**Rejected.** (a) *Every root-supplied name, derived from the ownership ledger* (the first draft's
recommendation, from #1841 item 3). Rejected by the owner: it widens the breaking change beyond the
seams the issue names, and item 3 describes what an overlay keeps among *module* registrations, not
a mandate over root plumbing. (b) *Refuse in 0.113.0.* It breaks deployments with no release to
migrate (#1841 alternatives, OD-4). (c) *A `guard: true` flag on the root's registration.* It
would put the rule beside each registration in two roots, where the CLI derivation cannot read it,
and it is still a list, only scattered.

## R-16 The warning: one log line, one non-failing finding

**Decision.** 0.113.0: for an overlay's decoration of one of the four guard seams (R-15),
`decorate` records the decoration as usual and logs `kernel.decoration.deprecated` at `warn` once
per (module, guard seam), with `{ overlay,
registration, replacement, refusedFrom: '0.114.0', ruling: 'D-296' }`. The `kernel.decorations`
boot line gains `deprecated: true` on those entries. The CLI derivation raises a new finding kind,
`deprecated-decoration`. `DivergenceFinding` gains `severity: 'error' | 'warning'`, absent meaning
`'error'`, so every existing finding keeps failing. `check-divergence.ts`, `endora generate` and
`endora check` print warnings under their own heading and exit non-zero only on errors.
0.114.0: the finding's severity becomes `'error'`, and `decorate` throws
`GuardSeamDecorationError` before recording anything.
**Rationale.** `check-divergence.ts` exits 1 on any finding (lines 207–216). A warning that fails
CI is a refusal by another name, and the deprecation rule forbids that. A severity field is the
smallest change, and the default keeps every existing finding's meaning unchanged.
**Rejected.** (a) *A separate `deprecations` section in the report.* It adds a second channel the
reconciliation (`reasons`, `stale-reason`) would have to learn. (b) *Log only.* A client instance's
CI never reads a boot log. The report is the artefact the merge request shows (D-30).

## R-17 Test-kit parity: no in-memory bus to keep in step

**Decision.** `@endora-commerce/test-kit/command-middleware` (a new subpath, mirroring
`./command-hooks`) offers `sealedCommandMiddlewareRegistry(input)`, `recordingCommandMiddleware()`,
`expectCommandMiddleware(manifest, entries, { origin })` and re-exports nothing from
`./composition`. `CommandMiddlewareRegistry.settled()` resolves when no observer is in flight.
`composeTestServer` (`packages/test-kit/src/server/compose-test-server.ts`, where the bus is
constructed) wires the registry exactly as `composeApp` does
(`packages/platform/src/composition/compose-app.ts`, the `new CommandBus(…)` call), and
`backend/test/contract/kernel/harness-parity.test.ts` gains the assertion.
**Rationale.** #1840 §8 asks that *"the in-memory bus in the test kit runs middleware in the same
order"*. The measurement shows the test kit has no in-memory bus. Every test double in the tree
either constructs the real `CommandBus` (`backend/test/helpers/sales-channels-service.ts`
`transactionBoundCommandBus`, the test-kit server) or stubs `run` and runs no Command semantics at
all (for example `packages/modules/crm/src/backend/services/opportunity-service.test.ts`). Parity
therefore comes from putting middleware **inside** the real bus and wiring both roots identically,
which is what the requirement is for.
**Rejected.** *A new in-memory bus.* It would be a second implementation of ordering, gating and
budgets, which is exactly the drift the requirement wants to prevent.

## R-18 No operator surface in this feature

**Decision.** No admin screen, no new permission and no palette action. Visibility comes from the
boot log line `kernel.command-middleware`, the committed divergence report, and `module:*`
introspection through the report.
**Rationale.** YAGNI (IV). The 176 execution-plan screen exists for hooks, whose dead letters need
an operator. Middleware has no state to act on. A middleware module's activation control is the
existing `/platform/modules` screen, and Principle XVI's palette requirement is about modules with an
admin surface, which this adds none of.
**Rejected.** *Adding a `middleware` section to `GET /api/v1/admin/command-hooks`.* It is an additive
contract change with no operator task behind it. Revisit if support asks for it.

## R-19 Constitution and convention text

**Decision.** The merge request that ships the behaviour also changes the text that states it:
`specs/conventions/overlay-modules.md` (the *Decorating across owners* paragraph),
`ForeignDecorationError`'s doc block, the `decorate` comment, `ModuleEntry.overlay`'s doc and the
`decorationOrder` doc comment in `contracts/modules.ts`. The constitution delta in
`contracts/guard-seam-narrowing.md` §6 is applied by this feature's P2 merge request (owner ruling
of 2026-11-23, D-296.9), and `specs/190-overlay-full-modules/` rewrites XV around it. Published
pages (`docs/docs/architecture/*.md`, EN and PL) belong to 190.
**Rationale.** AGENTS.md: *"A rule has one full statement"*. A convention that contradicts the code
for a release is the drift the router exists to prevent. The published docs pass is one coordinated
change in 190, per the owner's split of #1842 into #1857.

## R-20 No new dependency, no schema

**Decision.** Node's `AbortController`, `AsyncLocalStorage` and timers only. No table, no
migration, no entity.
**Rationale.** Principle IV. It also keeps the feature on the non-database track of 0.113.0, ahead
of the MikroORM 7 switch (#1073).

## R-21 A per-point grant is not an origin

*Added for the owner ruling of 2026-11-23 (D-296.10), when 188 gained per-package grants for policy
participants.*

**Decision.** `contracts/module-origin.md` §5 defines a grant once, for every contribution point:
a permission for one installed `package` module at one point, declared by the deployment in its
divergence declaration, naming the package by module id and installed `package.json` name, listed
in the divergence report. A grant never changes `ModuleEntry.origin` or the origin map, never
carries to another point, and applies to `package` modules only. Command middleware reads no grant:
D-296.3 offers none in this release. The owning point (188) names the field and its errors.
**Rationale.** If a grant were expressed as a change of origin ("granted packages are treated as
`deployment`"), one line in `divergence.ts` written for policy participants would also hand the
package `admit`, the unredacted request metadata in `observe`, and every future point's
deployment-tier right. That is the self-widening the origin derivation exists to prevent (R-11). A
per-point permission keeps each widening as narrow as the ruling that allowed it, and keeps origin
a fact about where the module was found. Naming the package by id and name together reuses §2's
alias defence, so a grant cannot be borrowed through an npm alias.
**Rejected.** (a) *A fourth origin value (`granted-package`).* Every point would have to decide
what it means, and a grant meant for one point would leak into the others. (b) *Grants in the
package's own manifest.* Self-certified, the same objection as a manifest `origin` field (R-11).
(c) *A grant table owned by each point with no shared rule.* 188 and a later widening of D-296.3
would then name packages differently, and the alias defence would be optional.
