# Feature Specification: Declared command middleware, and narrowing D-156.4

**Feature Branch**: `spec/189-command-middleware`
**Created**: 2026-11-23
**Status**: Draft, ruling **D-296** recorded below. The owner settled scope on 2026-11-23 and
answered the three open questions the same day (D-296.8 to D-296.10, and D-296.5/D-296.6 as
amended). This document does not reopen those decisions, and no owner question is open.
**Input**: issues #1840 (declared command middleware: `admit` and `observe` phases on the Command
Bus) and #1841 (narrow D-156.4: stop overlays decorating `commandBus`, `auditLogService`,
`eventBus` and `emFactory`). #1842 (documentation) was absorbed by #1857, which
`specs/190-overlay-full-modules/` delivers.

**Related work** (sibling specifications drafted in parallel; cite by slug):

- `specs/176-command-hooks-outbox/`: the Command Bus hook registry, ordering and outbox that this
  feature sits beside. Its plan's OD-6 ("whether a deployment still needs D-156.4's right to
  decorate `commandBus`") is the question this feature answers.
- `specs/188-policy-points/` (D-295): the second manifest-declared contribution mechanism in the
  same release train. It consumes this feature's module origin and trust tier, and uses the same
  vocabulary for ordering, tie-breaks, time budgets and fail-closed behaviour
  (`contracts/module-origin.md` §4). Its per-package grant for policy participants is a per-point
  permission as `contracts/module-origin.md` §5 defines it (D-296.10).
- `specs/190-overlay-full-modules/` (D-297): it owns the published documentation for this
  mechanism, the customisation-ladder entry, the migration example from a bus wrap to
  `admit` / `observe`, and the constitution XV rewrite around the sentences this feature adds
  (D-296.9).
- `specs/186-aggregate-ports/` (D-293), `specs/187-side-table-extensions/` (D-294) and
  `specs/191-membership-join-requests/` (D-298) do not depend on this feature.

## Vocabulary

- **Command**: a named, audited write run through the Command Bus (Principle XIII). A Command may
  run **child** Commands through `ctx.run`, from its own `run` or from a `beforeCommit` hook.
- **Run**: one call of `CommandBus.run`, which means one root Command, its children, and one
  transaction.
- **Command middleware**: code a module contributes to the Command Bus for **every** Command whose
  action matches the middleware's declared action filter. There are two phases and no others.
- **`admit`**: a middleware phase that runs before a Command does anything. It either lets the
  Command through or refuses it. It never sees the Command's data and never writes.
- **`observe`**: a middleware phase that runs after a run has committed or rolled back. It reads a
  summary of what happened and cannot affect it.
- **Origin**: where the platform found a composed module. `core` is a module of this repository's
  workspace, or a first-party package of the same release installed in an instance. `deployment` is
  a per-deployment overlay module. `package` is any other installed package. The platform derives
  the origin from where the module was found. A module never declares its own origin, and a
  per-point grant in the deployment's divergence declaration never changes it (D-296.10).
- **Per-point grant**: a deployment's permission, in its committed `divergence.ts`, for one
  installed `package` module to use one contribution point that withholds it from `package` by
  default. It is not an origin (`contracts/module-origin.md` §5). Command middleware offers none.
- **Guard seam**: one of the four root-supplied registrations through which Principles XI and XIII
  are enforced: `commandBus`, `auditLogService`, `eventBus`, `emFactory`. The four are a fixed list
  (`GUARD_SEAM_REGISTRATIONS`); adding one is a ruling that amends D-296.
- **Root-supplied registration**: a container name that a composition root registers and no module
  owns. The guard seams are four of them.

## Context

A deployment that needs behaviour on every Command, such as timing and metrics, an extra audit
sink, a rate limit or a tenant-specific admission rule, has one tool today. It wraps the
root-supplied `commandBus` from an overlay module with `ctx.di.decorate('commandBus', …)`. The
overlay exemption in `packages/platform/src/kernel/module-context.ts` allows this
(`ForeignDecorationError` doc block, and the `decorate` implementation near the
`isDeploymentOverlay` check). Measured on `origin/master` at `ff7efc3e8`, the wrap has five
defects:

1. **Children pass it.** `CommandBus.run` hands the root to the private `execute`. Every child that
   `ctx.run` or a hook's `run` starts calls `execute` directly
   (`packages/platform/src/commands/command-bus.ts`, `execute` and `runBeforeCommitHooks`). A wrap
   of the public object never sees a child.
2. **It sits outside the transaction**, so any write it makes is unaudited (XIII).
3. **It ignores activation.** The wrap is applied once during composition. Switching its module
   off does not remove it (XVII).
4. **It can lie.** A wrap that short-circuits, rewrites input or swallows errors leaves audit
   entries and undo state that do not match what happened.
5. **Nothing declares it.** A change to the `Command` shape surprises the deployment at run time,
   after an upgrade.

Command hooks (`specs/176-command-hooks-outbox/`) cover behaviour on actions an owner declares.
They do not cover behaviour across all Commands. Constitution XV says *"an override swaps an
implementation, never a guard seam"*. D-156.4 lets an overlay decorate any container name,
including the guard seams, and only the ruling is enforced.

## Ruling D-296 *(owner decisions of 2026-11-23, recorded by the architect)*

D-296 introduces declared command middleware and **narrows D-156.4**. D-156 is a pre-migration
ruling below the `D-283` floor in `specs/pre-migration-history/README.md`. Its full record stays in
the historical repository, so the narrowing is recorded here. Every in-tree citation of D-156.4
gains *"narrowed by D-296"* in the change that alters the behaviour it describes.

- **D-296.1: a declared command-middleware point.** The Command Bus offers exactly two
  middleware phases, `admit` and `observe`. There is **no transform phase**. Changing a Command's
  input remains the owner's decision, through hooks and `extensions` (176).
- **D-296.2: `admit` sees metadata only.** `admit` receives the action, the object identity, the
  actor, the organisation, the request metadata and the lineage. It never receives the Command's
  data or its entity manager. A later ruling may widen this when a real case needs it.
- **D-296.3: who may contribute.** `core` and `deployment` modules may contribute `admit` and
  `observe`. An installed `package` module may contribute `observe` only. A later ruling may widen
  this when a real case needs it.
- **D-296.4: origin is derived, never declared.** The origin comes from where the loader found the
  module, plus the platform's generated list of the release's first-party packages. It is not a
  field a manifest author writes. It does not touch the decoration exemption: `ModuleEntry.overlay`
  and `ModuleEntry.installedPackage` keep their meaning, and D-156.4's warning against retyping
  `overlay` into an origin enum still holds (`contracts/module-origin.md`).
- **D-296.5: D-156.4 is narrowed in two releases, for the four guard seams only** *(scope amended
  by the owner ruling of 2026-11-23, OQ-3)*.
  - In **0.113.0**, an overlay module that decorates `commandBus`, `auditLogService`, `eventBus` or
    `emFactory` still composes. The composition logs a warning, and the divergence report carries a
    warning finding that names the overlay, the guard seam and the replacement: command middleware
    and command hooks for `commandBus`, and the per-seam text of
    `contracts/guard-seam-narrowing.md` §2 for the other three.
  - In **0.114.0** the same decoration fails composition with `GuardSeamDecorationError`. This is a
    breaking change, and the upgrade note says what to move where.
  - A decoration of any **other** root-supplied registration (`redis`, `orm`, `requireAdmin`, …)
    is not touched by D-296. It is neither warned nor refused, and D-156.4 still governs it.
- **D-296.6: what decoration remains for an overlay.** An overlay may decorate (a) a registration
  of another overlay module of the same deployment, (b) a registration of a workspace module of
  this repository, and (c) a root-supplied registration that is not one of the four guard seams.
  Decorating an installed package's registration stays refused
  (`PackageDecorationNotOfferedError`, D-176 Q3). In an instance core arrives as packages, so the
  route there is declared extension points: hooks, middleware, policy points and ports.
- **D-296.7: revisit** D-296.2 or D-296.3 when a named deployment or package cannot express a
  requirement with metadata-only `admit` or with `observe`. Widening either is an additive change
  made by a later ruling that says it amends D-296.

### Owner rulings of 2026-11-23 on the open questions

The owner answered this specification's three questions and one cross-specification question on
2026-11-23. They are part of D-296.

- **D-296.8: paid modules are `package`** *(OQ-1, as recommended)*. A paid module installed in an
  instance has origin `package` and contributes `observe` only, like every other non-workspace
  package. This holds until a **signed** first-party list exists. That list is a later ruling that
  amends D-296, and until it exists nothing (an npm scope, a commercial relationship, a manifest
  field) makes a package `core`.
- **D-296.9: who changes constitution XIII and XV** *(OQ-2, as recommended)*. This feature's P2
  merge request adds the sentences in `contracts/guard-seam-narrowing.md` §6 to XIII and XV, so the
  constitution never lags the code. `specs/190-overlay-full-modules/` then rewrites XV around them.
- **D-296.5 and D-296.6 amended: scope of the 0.114.0 refusal** *(OQ-3, the alternative, not the
  recommendation)*. The refusal covers only the four guard seams, as #1841 items 1 and 2 name them
  and as the owner's scope ruling put it. The recommended "every root-supplied name" reading of
  #1841 item 3 is rejected. D-296.5 and D-296.6 above are written as amended. Because the four are
  a list and not a derivation, the list is pinned by a test, and the composition roots are tested
  to register each of them (FR-055).
- **D-296.10: who owns the origin type and the trust tier** *(cross-specification, 188/189/190)*.
  This feature owns them, in `contracts/module-origin.md`. `specs/188-policy-points/` and
  `specs/190-overlay-full-modules/` consume that contract and do not redefine it. When 188 lets a
  deployment grant an installed package the right to contribute policy participants (owner ruling
  of the same day, 188's row), that grant is a **per-point permission** and **does not change the
  package's origin or trust tier** (`contracts/module-origin.md` §5). It does not give the package
  `admit`, does not lift the `package` observer redaction (FR-022) and does not change decoration.

## User Scenarios & Testing *(mandatory)*

### User Story 1: A deployment refuses Commands it must not run (Priority: P1)

An operator's deployment freezes writes for an organisation under a legal hold, or limits how often
one API key may write. The deployment's overlay module contributes an `admit` middleware for the
matching actions. Every matching Command, including a child run inside a bigger write, asks it
first. A refused Command writes nothing and leaves no audit entry. The caller gets the deployment's
own translated error.

**Why this priority**: an admission rule is the main reason deployments wrap `commandBus` today,
and the wrap misses child Commands. Without this story, 0.114.0's refusal leaves those deployments
with nothing.

**Independent Test**: compose a fixture overlay with an `admit` that refuses `organization.`
actions for one organisation id. Run a parent Command whose child is `organization.admin_patch`.
The parent rolls back, no audit row exists for either Command, and the response carries the
fixture's code.

**Acceptance Scenarios**:

1. **Given** an `admit` middleware for `'*'` that refuses actor kind `api_key`, **When** an API-key
   request runs any Command, **Then** the request is refused with the middleware module's code, no
   row is written and no audit entry is recorded.
2. **Given** an `admit` for `organization.` that passes the root `quote.convert` but refuses its
   child `organization.admin_patch`, **When** the run executes, **Then** the child is refused before
   its `capture`. The parent sees the refusal as a thrown error and rolls back unless it catches the
   error, as with any child failure.
3. **Given** an `admit` that does not settle within its time budget, **When** a matching Command
   runs, **Then** the Command is refused with `COMMAND_ADMISSION_TIMEOUT` (fail closed) and nothing
   is written.
4. **Given** an `admit` that throws something other than a `CommandRefusedError`, **When** a
   matching Command runs, **Then** the Command is refused with `COMMAND_ADMISSION_FAILED`. The log
   names the middleware and the error class, and never the error's message.
5. **Given** an `admit` that refuses every action, **When** an operator switches the middleware's
   module off on `/platform/modules`, **Then** the activation Command `module.activation.set` is
   not subject to admission, so the operator can always recover.

---

### User Story 2: A deployment or package observes every Command (Priority: P1)

A deployment sends timing and outcome metrics for every write to its monitoring. An installed
analytics package records which actions ran. Each contributes an `observe` middleware. It receives,
after the run, the root's metadata, every Command the run executed, whether the run committed, its
error code and its duration. It cannot slow, fail or change the write.

**Why this priority**: metrics and an extra audit sink are the other common reason for a bus wrap.
`observe` is also the only phase an installed package gets (D-296.3).

**Independent Test**: register a recording `observe` for `'*'`. Run one committing and one rolling
back Command with a child. The recorder sees two outcomes with the right `committed`, error code,
child list and names-only noted fields. An `observe` that throws or never settles leaves both
callers' results unchanged.

**Acceptance Scenarios**:

1. **Given** an `observe` for `'*'`, **When** a run commits, **Then** after the commit the observer
   receives `committed: true`, the duration, and one entry per executed Command (root and children)
   with action, object identity, depth, whether it was audited and the field names its hooks noted.
   It receives no values.
2. **Given** the same observer, **When** a run rolls back because a hook vetoed, **Then** it
   receives `committed: false` and the veto's error code.
3. **Given** an `observe` that throws, or that does not settle within its budget, **When** a run
   commits, **Then** the caller already has its result. The failure is logged once with the
   middleware's label, and later runs still reach the observer.
4. **Given** an `observe` contributed by an installed package, **When** it receives an outcome,
   **Then** the request metadata carries the request id and **no** IP address and no user agent.
5. **Given** a root that `admit` refused, **When** observers run, **Then** they receive
   `committed: false` and a `refusal` naming the refusing middleware and its code.

---

### User Story 3: Switching a middleware module off removes it at once (Priority: P1)

An operator switches off the module that contributes a middleware. The next Command no longer runs
it. Switching the module on again restores it. No restart is needed.

**Why this priority**: Principle XVII is non-negotiable. A decorated bus breaks it today.

**Independent Test**: with an `admit` that refuses everything, switch its module off through the
effective state and run a Command. It succeeds. Switch the module back on and the Command is
refused. Repeat for `observe`.

**Acceptance Scenarios**:

1. **Given** a middleware whose module is switched off, **When** any Command runs, **Then** the
   middleware does not run.
2. **Given** a module switched off while one of its observers is in flight, **When** the observer
   settles, **Then** nothing is lost or retried. Observation is at most once.

---

### User Story 4: Composition is deterministic and visible (Priority: P2)

A deployment composes two `admit` middlewares from modules that do not depend on each other, and
their action filters overlap. Composition refuses and names both, unless the deployment states the
order in `divergence.ts`. The divergence report lists every middleware the deployment contributes.
An installed package that declares an `admit` stops composition with an error that names the
package and the ruling.

**Why this priority**: Principle XV requires deterministic resolution and auditable divergence. The
deprecation in US5 depends on the report.

**Independent Test**: fixture compositions for each refusal. A deployment fixture whose
`divergence.generated.md` lists a `command-middleware` entry with its phase and filter.

**Acceptance Scenarios**:

1. **Given** two overlapping `admit` middlewares in modules without a dependency path, **When** the
   platform composes, **Then** it refuses with both labels and the remedy
   (`commandMiddlewareOrder` in `divergence.ts`).
2. **Given** the same two, with `commandMiddlewareOrder: ['a', 'b']`, **When** a Command runs,
   **Then** `a`'s `admit` runs before `b`'s.
3. **Given** module `b` depends on module `a`, **When** both contribute `admit`, **Then** `a` runs
   first, and an order entry that says otherwise is refused.
4. **Given** a manifest declaring a middleware the module never registers, or a registration with no
   declaration, **When** the platform composes, **Then** it refuses and names the module and id.
5. **Given** an installed package that declares `phase: 'admit'`, **When** an instance composes,
   **Then** it refuses with `CommandMiddlewareOriginError`, and `endora generate` reports the same
   problem before boot.

---

### User Story 5: Deployments get one release of warning before guard-seam decoration stops (Priority: P2)

A deployment upgrades to 0.113.0 with an overlay that wraps `commandBus`. It still boots. The log
says, once at boot, that this decoration is deprecated, will be refused in 0.114.0, and what to use
instead. Its divergence report carries the same message as a warning finding, and the deployment's
CI stays green.

**Why this priority**: the deprecation rule forbids refusing without a migration release (#1841
alternatives, OD-4).

**Independent Test**: a fixture overlay decorating each of the four guard seams and one other
root-supplied name (`redis`). The composition succeeds, one structured warning is logged per
(module, guard seam) and none for `redis`, and `check:divergence` prints a warning finding per
guard-seam decoration and exits 0.

**Acceptance Scenarios**:

1. **Given** an overlay decorating `commandBus` on 0.113.0, **When** the platform composes, **Then**
   it logs `kernel.decoration.deprecated` naming the overlay, `commandBus`, the replacement
   (command middleware, command hooks) and the release that refuses it.
2. **Given** an overlay decorating `redis`, a root-supplied name that is not a guard seam, **When**
   the platform composes, **Then** the wrap is applied, no warning is logged and the divergence
   report carries no `deprecated-decoration` finding for it.
3. **Given** an overlay decorating another overlay module's registration, or a workspace core
   module's registration, **When** the platform composes, **Then** no warning is logged.

---

### User Story 6: In 0.114.0 the guard-seam decoration is refused (Priority: P3)

The same deployment upgrades to 0.114.0 without moving its wrap. Composition refuses with
`GuardSeamDecorationError`, which names the overlay, the guard seam and the replacement. The
upgrade note in the release says how to move a metrics wrap to `observe` and a rate-limit wrap to
`admit`.

**Why this priority**: it is the following release's work. It is specified now so the warning text
in US5 can promise it.

**Independent Test**: the US5 fixture now fails composition with the named error for each guard
seam, and its `redis` decoration alone still composes. The decoration tests that previously
asserted an overlay may wrap `commandBus` now assert the refusal.

**Acceptance Scenarios**:

1. **Given** an overlay decorating any of the four guard seams, **When** the platform composes on
   0.114.0, **Then** it refuses before any boot hook runs and leaves the container unwrapped.
2. **Given** the 0.114.0 divergence report for the same tree, **Then** the finding is an error and
   `check:divergence` exits 1.
3. **Given** an overlay decorating `redis` and nothing else root-supplied, **When** the platform
   composes on 0.114.0, **Then** it composes with the wrap applied, as on 0.112.x.

---

### User Story 7: Module authors test middleware with the platform's own semantics (Priority: P2)

A module author writes a unit test for their middleware on the real Command Bus, with the
platform's ordering, gating, budgets and refusals. The test does not boot the platform. The test
server the backend suites use wires middleware exactly as production does.

**Why this priority**: a test double that skips child Commands would reproduce defect 1 in every
contributor's suite.

**Independent Test**: `sealedCommandMiddlewareRegistry` plus `new CommandBus(…, { middleware })`
runs a recorded `admit` for a child Command. `harness-parity.test.ts` asserts that both composition
roots pass the same registry wiring.

**Acceptance Scenarios**:

1. **Given** a sealed test registry with one `admit` and one `observe`, **When** a test runs a
   Command with a child, **Then** the `admit` sees both and the observer sees one outcome, after
   `await registry.settled()`.
2. **Given** `expectCommandMiddleware(manifest, entries)`, **When** a declaration and a registration
   disagree, or an origin-forbidden phase is declared, **Then** the helper fails with the same
   message composition would raise.

### Edge Cases

- **Bulk Commands.** A run with 10 000 children asks each matching `admit` 10 000 times, inside the
  transaction. `meta.lineage.depth` lets a middleware act on the root only, and the contract
  recommends that for rate limiting.
- **`admit` re-entering the bus.** An `admit` or `observe` that calls `CommandBus.run` is refused
  with `COMMAND_MIDDLEWARE_REENTRY` (500). Otherwise a middleware matching its own Command could
  loop, and an "observer" could write.
- **A refused child that the parent catches.** The child wrote nothing and recorded nothing. The
  parent continues, and its own entry is recorded as usual.
- **A run without tenant context.** The bus throws `MissingTenantContextError` before admission, as
  it does today. No middleware runs.
- **Hook cycle.** The existing hook-cycle check (176 FR-022) still runs first for a hook-induced
  child. It is a programming error, not an admission question.
- **Reversible undo.** An undo runs as a Command and is admitted like any other.
- **Platform recovery path.** `module.activation.set` is exempt from `admit` (US1 scenario 5). It is
  still observed.
- **Many slow observers.** In-flight `observe` calls per middleware are capped. Beyond the cap a
  call is dropped and counted. Observation is at most once, so dropping is within the contract.
- **Unknown action prefixes.** A filter prefix that matches no Command action anywhere is not an
  error, because actions appear as modules are added. The divergence report shows the filter as
  written.
- **A root-supplied name added in a later release.** It stays decoratable by an overlay, like every
  root-supplied name outside the four (D-296.6 (c)). If it is a guard seam, adding it to
  `GUARD_SEAM_REGISTRATIONS` is a ruling that amends D-296, and the pinning test makes that change
  visible (FR-055).
- **A guard seam renamed at the root.** The root-registration test (FR-055) fails, so the list
  cannot silently name a registration that no longer exists.
- **A package granted policy participants by the deployment.** Its origin stays `package`. An
  `admit` it declares is still refused by `CommandMiddlewareOriginError`, and its `observe` still
  gets the request id only (D-296.10).

## Requirements *(mandatory)*

### Declaration and registration

- **FR-001**: A module manifest MUST be able to declare `commandMiddleware`: a list of
  `{ id, phase: 'admit' | 'observe', actions: '*' | string[], timeoutMs? }`. Each element of a
  string list MUST be a full action or a prefix ending in `.`. `id` is kebab-case and unique within
  the module.
- **FR-002**: A module MUST register the code for each declared middleware through its module
  context, with the same id and phase. Composition MUST refuse a declaration without a
  registration, a registration without a declaration, a phase mismatch, and one id used twice in a
  module.
- **FR-003**: `timeoutMs` MUST NOT exceed the platform maximum for its phase. The default applies
  when it is absent.
- **FR-004**: The platform MUST derive each composed module's origin (`core`, `deployment`,
  `package`) from where its loader found it. Composition MUST refuse an `admit` declared by a
  `package` module. A manifest MUST NOT be able to set or influence its own origin. A per-point
  grant in the deployment's divergence declaration (`contracts/module-origin.md` §5) MUST NOT change
  a module's derived origin, and command middleware MUST NOT read any grant.

### Admission

- **FR-010**: For every Command whose action matches, including children started by a Command or by
  a hook, the bus MUST call each present `admit` middleware in composed order before the
  `extensions` check, before `capture` and before any write. The root's admission MUST complete
  before the run's transaction is opened.
- **FR-011**: `admit` MUST receive only metadata: action, object type, object id, the actor (kind
  and ids), the organisation id of a single-organisation context (otherwise null), request metadata
  (request id, IP address, user agent) and lineage (ancestor actions, depth, whether a hook started
  it). It MUST NOT receive the Command's data, its result or an entity manager.
- **FR-012**: `admit` MUST either complete or throw `CommandRefusedError` with a code that the
  contributing module declares in its `errorCodes` and translates in pl and en. The first refusal
  stops admission. The refused Command MUST write nothing and record no audit entry.
- **FR-013**: An `admit` that does not settle within its budget MUST refuse the Command with
  `COMMAND_ADMISSION_TIMEOUT` (503). An `admit` that throws anything else MUST refuse it with
  `COMMAND_ADMISSION_FAILED` (503). Each MUST log the middleware label and error class, never a
  message or a value. The `admit` MUST receive an abort signal that fires when its budget expires.
- **FR-014**: The platform's activation Command (`module.activation.set`) MUST NOT be subject to
  `admit`.
- **FR-015**: Calling `CommandBus.run` from inside an `admit` or `observe` MUST be refused with
  `COMMAND_MIDDLEWARE_REENTRY`.

### Observation

- **FR-020**: After a run commits or rolls back, or its root is refused, the bus MUST call each
  present `observe` middleware whose filter matches any action the run attempted. The call carries
  the root's metadata, `committed`, the refusal (middleware label and code) when there was one, the
  error code when the run failed, the duration, and one entry per attempted Command: action, object
  identity, depth, whether a hook started it, whether it was refused, whether it was audited, and
  the field names that hooks noted (names only).
- **FR-021**: `observe` MUST run after the caller's promise has settled, MUST NOT be awaited by it,
  and MUST NOT change its result or error. A throw or an exceeded budget MUST be logged with the
  middleware label and swallowed. Delivery is at most once, and there is no retry.
- **FR-022**: For an `observe` from a `package` module, the request metadata MUST carry the request
  id only.
- **FR-023**: In-flight `observe` calls MUST be capped per middleware. A call beyond the cap MUST
  be dropped and counted, and the count logged at most once per minute.
- **FR-024**: `observe` MUST run in the run's ambient tenant context. The platform MUST NOT widen
  that context for it.

### Order, gating, visibility

- **FR-030**: The order in which a run runs `admit` middlewares from different modules MUST follow
  the transitive manifest dependency graph: a module's middleware runs after that of every module it
  depends on. Within one module, registration order applies.
- **FR-031**: Two `admit` middlewares from modules with no dependency path, whose filters can
  match a common action, MUST refuse composition unless the deployment's `divergence.ts` declares
  `commandMiddlewareOrder` naming both. An order entry that contradicts the graph MUST be refused.
- **FR-032**: `observe` middlewares MUST NOT require an order. They are called in a deterministic
  order (module id, then registration order), and none can observe another.
- **FR-033**: Each middleware MUST be skipped on a run where its module is not present on the
  effective state, asked on every run.
- **FR-034**: The divergence report MUST record each overlay module's middleware as kind
  `command-middleware`, with phase, id and filter. The boot log MUST list the composed middlewares
  once, with module, id, phase, origin and position.
- **FR-035**: With no middleware composed, the bus MUST behave exactly as it does on
  `origin/master`, and the existing command-bus, hook and outbox tests MUST pass unchanged.

### Test kit parity

- **FR-040**: `@endora-commerce/test-kit` MUST offer a sealed registry builder, a recording
  middleware, a way to wait for in-flight observers, and a conformance helper that applies
  composition's own declaration and origin rules. All of them MUST run on the real `CommandBus`.
- **FR-041**: The test-kit server and `composeApp` MUST wire the middleware registry identically,
  and `harness-parity.test.ts` MUST assert it.

### Narrowing D-156.4

- **FR-050** *(0.113.0)*: When an overlay module decorates one of the four guard seams
  (`commandBus`, `auditLogService`, `eventBus`, `emFactory`), composition MUST succeed and MUST log
  one structured warning per (module, guard seam). The warning names the overlay, the guard seam,
  the replacement and the release that refuses the decoration.
- **FR-051** *(0.113.0)*: The divergence derivation MUST raise a `deprecated-decoration` finding of
  **warning** severity for each such decoration, with the same content. Divergence checks MUST
  report warnings and MUST NOT fail on them.
- **FR-052** *(0.114.0)*: The same decoration MUST fail composition with `GuardSeamDecorationError`
  before any wrap is applied. The finding's severity MUST become **error**.
- **FR-053**: An overlay MUST still be able to decorate registrations of its own deployment's other
  overlay modules, of this repository's workspace modules, and every root-supplied registration
  that is not a guard seam, with no warning, no finding and no refusal in either release.
  Decorating an installed package's registration stays refused.
- **FR-055**: The guard seams MUST be stated once, as `GUARD_SEAM_REGISTRATIONS` in
  `@endora-commerce/contracts`, read by both the platform and the CLI derivation. A test MUST pin
  its exact content, and a test MUST assert that both composition roots (`composeApp` and the
  test-kit server) register each of the four as a root-supplied name.
- **FR-054**: Every in-tree statement of D-156.4 (code comments, `specs/conventions/overlay-modules.md`,
  the contracts doc comment on `decorationOrder`) MUST be updated, in the change that alters the
  behaviour, to state the narrowing and cite D-296.

### Cross-cutting

- **FR-060**: The platform error codes `COMMAND_ADMISSION_TIMEOUT`, `COMMAND_ADMISSION_FAILED` and
  `COMMAND_MIDDLEWARE_REENTRY` MUST be declared and translated in pl and en.
- **FR-061**: Changesets MUST describe the new manifest field, context member, bus option and test-kit
  subpath (0.113.0, minor), the deprecation (0.113.0, minor, with upgrade note), and the refusal
  (0.114.0, minor, labelled `breaking change`, with upgrade note).
- **FR-062**: Published documentation (EN and PL), the customisation-ladder entry and the migration
  example are delivered by `specs/190-overlay-full-modules/` (#1857). This feature MUST hand 190 the
  contract text it documents (`contracts/command-middleware-api.md`,
  `contracts/guard-seam-narrowing.md`).

### Key Entities

- **Command middleware declaration**: a manifest entry with id, phase, action filter and optional
  time budget. It is owned by the contributing module.
- **Command middleware registration**: the code behind a declaration, keyed by module and id.
- **Admission metadata**: what `admit` sees (FR-011).
- **Run outcome**: what `observe` sees (FR-020).
- **Module origin**: the derived trust tier of a composed module (FR-004). Its single statement is
  `contracts/module-origin.md`, which 188 and 190 consume (D-296.10).

No persistent entity. This feature adds no table and no migration.

## Success Criteria *(mandatory)*

- **SC-001**: An admission rule that today needs a `commandBus` wrap also refuses child Commands.
  Measured by a fixture run where a child is refused, with no row and no audit entry for it.
- **SC-002**: With no middleware composed, the existing Command Bus suites pass unchanged, and a run
  of 10 000 no-op Commands takes no more than 2 % longer than on `origin/master`.
- **SC-003**: With one synchronous `admit` and one `observe`, the median added latency per Command
  is under 0.2 ms in the same benchmark.
- **SC-004**: Switching a middleware's module off takes effect on the next Command with no restart,
  in 100 % of the off-state tests.
- **SC-005**: Every decoration of a guard seam by an overlay in the repository's fixtures and
  deployments produces exactly one warning on 0.113.0, and one composition refusal on 0.114.0.
  Every decoration of another root-supplied name produces neither, in both releases.
- **SC-006**: Zero overlays in `backend/src/apps/` decorate a guard seam when 0.114.0 is cut. This
  is verified by the committed divergence artefacts.

## Assumptions

- No overlay in this repository decorates a guard seam or any other root-supplied name today.
  `example_overlay` decorates `pricingService` and `acceptance_overlay` decorates its own
  registration. Measured with a grep over `backend/src/apps/` at `ff7efc3e8`, and unchanged at
  `babfae111` (0.112.0). The warning therefore lands on fixtures and on client instances only.
- Paid modules from `../paid-modules` are not in this workspace (D-265), so they have origin
  `package` and get `observe` only until a signed first-party list exists (D-296.8).
- Time budgets are platform constants plus an optional per-declaration value under the cap. They are
  not operator Settings. No secret is involved.
- 0.113.0 is the non-database track and may start before the MikroORM 7 switch (#1073). This feature
  changes no entity and no migration.

## Owner questions *(all closed on 2026-11-23)*

- **OQ-1: Paid first-party modules.** Closed by **D-296.8**: no. A paid module is `package` and
  gets `observe` only until a signed first-party list exists. This was the recommendation.
- **OQ-2: Who edits constitution XV and XIII.** Closed by **D-296.9**: this feature's P2 adds the
  sentences in `contracts/guard-seam-narrowing.md` §6, and `specs/190-overlay-full-modules/`
  rewrites XV around them. This was the recommendation.
- **OQ-3: Scope of the 0.114.0 refusal.** Closed by the amendment of **D-296.5 and D-296.6**: the
  four guard seams only, per the owner's scope ruling and #1841 items 1 and 2. This was the
  alternative, not the recommendation, and the requirements, stories, contracts, research (R-15),
  plan and tasks are redesigned for it.
- **Cross-specification: owner of the origin type and trust tier.** Closed by **D-296.10**: this
  feature, in `contracts/module-origin.md`. 188 and 190 consume it. A per-package grant of policy
  participants (188) is a per-point permission and changes neither origin nor trust tier.
