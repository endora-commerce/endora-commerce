# Research: Declared policy points, and the organization moderation policy

Every entry gives the decision, its rationale, and the alternatives rejected with the reason.
Paths are real as of `origin/master` at `ff7efc3e8` (2026-11-23).

## Grounding — what exists today

- **Moderation** is a single switch. `organizations.moderation.mode` (`auto` / `manual`) is
  declared in `packages/modules/organizations/src/manifest.ts`.
  `OrganizationModerationService.handleNewlyRegistered` (in
  `packages/modules/organizations/src/backend/services/organization-moderation-service.ts`)
  approves the organization in `auto` and does nothing in `manual`. It degrades to manual when the
  setting cannot be read. The service runs from a `ctx.subscribe('organization.registered.v1', …)`
  in `packages/modules/organizations/src/backend/index.ts`.
  - Transitions are **not** Commands yet: `transition()` writes, then calls
    `auditLogService.record` after the commit. `specs/186-aggregate-ports/` (#1821) turns approve,
    reject, block and unblock into Commands behind `organizationCommandPort`.
- **The registry lookup outcome** is stamped on `Organization.vatValidationOutcome`
  (`'validated' | 'failed' | 'deferred' | 'unverified'`). Two code paths stamp it:
  - registration, through `persistLookupRow` in `register-organization.command.ts`;
  - the administrator's re-validation, through `OrganizationTaxIdValidationService.trigger`,
    reached by `POST /api/v1/admin/organizations/:id/vat-validations` and by the admin
    create/patch with `validateTaxId`.

  No worker retries a `deferred` lookup.
- **The closest prior mechanism** is the command hooks of `specs/176-command-hooks-outbox/`
  (`contracts/command-hooks-api.md`):
  - the owner declares `hookableActions`;
  - contributors call `ctx.commandHooks`;
  - `CommandHookRegistry` (`packages/platform/src/commands/hooks/registry.ts`) is sealed by
    `composeModules`;
  - the order comes from `orderCommandHooks` (`.../hooks/ordering.ts`), with
    `commandHookOrder` in `divergence.ts` as the tie-break;
  - presence is checked per call;
  - there is a divergence kind `command-hook` at rung 2, a read-only plan at
    `GET /api/v1/admin/command-hooks`, a screen at `/platform/command-hooks`, and
    `@endora-commerce/test-kit/command-hooks`.
- **Contribution edges** (`nonBindingDependencies` kind `contributes-to`,
  `packages/contracts/src/modules.ts`) name a **container registration**. Rule 2 of
  `assertNonBindingRules` refuses such an edge when the same manifest names the target module in
  `dependencies`. `packages/platform/src/kernel/contribution-sinks.ts` drops a declared
  contribution whose registry the composition does not hold.
- **Origin.** `RegisteredManifestEntry.origin` is `'core' | 'overlay' | 'package'`
  (`packages/platform/src/lifecycle/manifest-registry.ts`). `ModuleContextOptions` carries
  `overlay` (it grants) and `installedPackageModuleIds` (it refuses) as two separate facts
  (`packages/platform/src/kernel/module-context.ts`).
- **Divergence derivation.** It lives in `packages/cli/src/lib/divergence.ts`
  (`SEAM_CLASSIFICATION`) and in `backend/scripts/generate-divergence.ts`. The kinds and the
  detail union are in `packages/contracts/src/modules.ts`.
- **Translating another module's labels from the backend** has a precedent: organization
  permission labels go through `adminI18nService.translate(moduleId, key, language)`
  (`moduleTranslate` in `organizations/src/backend/index.ts`).

## R-1 Where the mechanism lives

**Decision.** The code is split by what it does:

| Part | Where it goes |
| --- | --- |
| Pure parts: the point reference, the declaration schemas, the plan response schema | `@endora-commerce/contracts` (`packages/contracts/src/policy-points.ts`), platform-free |
| Runtime: the evaluator, the participant frame, the errors | `packages/platform/src/kernel/policies/`, published through the existing `./kernel` barrel |
| The registry, which a root builds and seals | `./composition` |
| The test helpers | `@endora-commerce/test-kit/policies` |

**Rationale.** The owner-side and contributor-side seams are `ModuleContext` members, and
`ModuleContext` is `./kernel`'s. Keeping the runtime under `kernel/` adds no subpath, so
`PUBLISHED_SUBPATHS` stays at five (`packages/cli/src/lib/platform-surface.ts`).

**Rejected.**

- *A new `packages/platform/src/policies/` directory.* The `exports` map would declare a subpath
  for it, and that subpath is host-internal unless a ruling publishes a sixth barrel. Modules need
  its types.
- *A `_policies` module.* The platform may not import a module (D-52/D-53), and the composer has
  to seal the registry before boot hooks run.

## R-2 How a contributor declares a participation — `policyContributions`, not `nonBindingDependencies`

**Decision.** A new manifest field on the contributor:

```text
policyContributions: [{ point, id, reasonCodes, overrides?, reason }]
```

Code supplies the decision through `ctx.policyParticipants([...])`. The two must match one to one.

The edge has the semantics of `contributes-to`:

- it does not bind the operator;
- it does not order install or migration;
- when the owner is absent from the composition it is dropped, not raised.

That is the meaning of the issue's "declared `contributes-to` edge". It is spelled as its own
field for three reasons:

1. **Rule 2 would refuse the common case.** Most modules that would moderate organizations
   already declare `organizations` in `dependencies`. A `contributes-to` entry targeting
   `organizations` beside it is refused ("one edge, one claim"). A policy contribution names a
   *point*, not a claim about the bind, so the two do not compete.
2. **The name space is different.** `ModuleNonBindingDependency.name` is a container registration.
   `check:port-dependencies` would report a point id as `unowned-name`.
3. **The manifest is the static truth.** The participant id and reason codes sit in it, so three
   readers work without walking an AST or composing: the divergence report, `module:status`, and
   label coverage. Reason codes declared there are also the closed set that
   `specs/conventions/audit-state.md` list 1 requires for a code in audit state.

**Rejected.**

- *Reusing `nonBindingDependencies` with a point id as `name`.* This hits the three reasons above,
  and needs exceptions in two rules and one check.
- *Requiring the owner in `dependencies`,* as hooks do (`HookOwnerNotDependedOnError`). That binds
  a switchable owner's off switch to every contributor. The issue asked for a non-binding edge.
- *Code-only registration.* It is invisible to every static reader.

`specs/189-command-middleware/` declares `commandMiddleware: [{ id, phase, actions }]` on the
contributor in the same way (see R-20).

## R-3 How an owner declares a point — manifest, contract reference, and one context call

**Decision.** The owner declares the point in three places:

- **In contracts.** `definePolicyPoint({ id, combiner, input, verdict, decision, combine?,
  budgetMs?, onParticipantFailure?, defaultReasonCodes })` returns a `PolicyPointRef`. The owner
  publishes it from `@endora-commerce/contracts`, as `hookableAction` refs are published.
- **In the manifest.** `policyPoints: [toPolicyPointDeclaration(ref)]`.
- **In code.** `ctx.policyPoint(ref, { default, validate? })` returns the `PolicyEvaluator` the
  owner calls.

The combiner function, the schemas, the budget and the failure treatment are therefore part of the
**published contract**. Only the default participant (which reads the owner's settings) and the
owner's invariant check stay in the module.

**Rationale.**

- Principle XV asks for contract-gated overrides. The combination rule *is* the contract a
  contributor relies on ("hold wins").
- The conformance helper (FR-018) can only run the owner's real semantics across a core upgrade if
  they are importable without composing the owner.
- The functions are pure, which `contracts` already allows (`hookableAction`,
  `defineModuleManifest`).

**Rejected.**

- *`combine` in the owner's module code.* A contributor's test would then have to compose the
  owner, or copy its rule, and that copy is exactly what goes stale at upgrade.
- *A declarative combiner enum (`any-hold-wins`, `first-refusal`, …).* That is a small language,
  and the first point it does not cover forces a new enum value through the platform (Principle IV).

## R-4 Ordering `chain` participants

**Decision.** The ordering algorithm of `orderCommandHooks` is generalised into one
`orderByModuleDependencies(subject, registrations, closure, tieBreak)`, which hooks and policies
share. `specs/189-command-middleware/` is invited to share it too.

The rules:

- A module's participants run after those of every module it transitively depends on.
- Pairs with no dependency path are ranked by an **optional** `policyOrder[pointId]` in the
  deployment's `divergence.ts` ("first runs first"). Without a ranking they refuse composition with
  `UnorderedPolicyParticipantsError`, naming both modules and the point.
- A ranking that contradicts the graph refuses with `PolicyOrderContradictionError`.
- The default participant is always innermost.
- `policyOrder` is `.optional()`, not `.default({})`. 176's amendment 2 explains why: a defaulted
  field would break every instance's typed `divergence.ts`.

**Rationale.**

- The issue says "two participants with no defined order refuse composition". A deployment ranking
  *is* a defined order.
- Without one, two independent overlay or instance modules could only be ordered by making one
  depend on the other. 176 rejected that for hooks in OD-1.
- One algorithm for three mechanisms means one definition of "ordered".

**Rejected.**

- *Strict refusal with no tie-break.* It forces artificial dependencies.
- *Making `policyOrder` authoritative.* That gives two orderings of one thing, as 176 R-7 put it.
- *Ordering by registration sequence.* It is not deterministic across compositions (FR-019).

## R-5 Detecting `policy-override` in a `chain`

**Decision.** Detection works in three layers:

1. **A declared override.** `overrides: true` on the manifest entry is the honest spelling for a
   participant that replaces rather than refines. It appears in the static divergence detail.
2. **Runtime.** The platform hands the participant `previous` wrapped in a read-tracking `Proxy`.
   (The verdict schema of a `chain` point must be a `z.object`, so the verdict is always an object.)
   The registry counts evaluations and reads per participant. An undeclared participant with
   evaluations and zero reads is flagged `observedOverride` on the plan API. The first time, the
   platform logs one `kernel.policy-override` warning.
3. **CI.** The conformance helper runs each case with two different valid `previous` verdicts. A
   participant whose verdict never reads `previous` fails the helper unless it declared the override.

**Rationale.** "Did it read `previous`" is a runtime fact. A static walk cannot answer it soundly.
A declaration alone is unchecked. The helper makes the question part of the contributor's own
suite.

**Rejected.**

- *An AST analysis.* It is unsound: destructuring, helpers and aliasing defeat it.
- *Refusing overrides.* "Always refuse in this deployment" is a legitimate rule. It only has to be
  visible.

## R-6 Commutativity

**Decision.** The registry evaluates `commutative` participants concurrently. It hands `combine`
the outcomes sorted by `(moduleId, participantId)`, so the trace is deterministic. Commutativity
itself cannot be proven, so it is tested: the owner calls `expectCommutativeCombine(ref, samples)`
from the test kit, which asserts the same decision over every permutation (for six or fewer
outcomes per sample) or over 50 seeded shuffles (for more).

**Rejected.**

- *A built-in monoid catalogue.* The same small language as R-3.
- *Shuffling at runtime to "prove" order independence.* That is non-deterministic in production
  and contradicts FR-019.

## R-7 Participants decide and never write

**Decision.**

- A participant receives `(input, previous?, ctx)`. `ctx` holds `{ module, signal, log }` and
  nothing that writes: no `em`, no `run`.
- The input is parsed by the point's schema, then deep-frozen.
- Each participant runs inside an `AsyncLocalStorage` frame. While the frame is active,
  `CommandBus.run` and `EventBus.emit` throw `PolicyParticipantWriteError`. The error names the
  module, the participant and the point.
- `currentPolicyParticipant()` is exported beside `currentCommandHookOrigin()`.

**Rationale.** These are the two sanctioned write paths (Principle XIII), so guarding them catches
every audited write and every event. A raw `em.flush()` on the participant's own entity manager is
already a XIII violation, and the review and `check:*` estate treat it as one.

**Rejected.**

- *A read-only entity manager.* MikroORM has no reliable read-only fork, and intercepting `flush` is
  fragile across the MikroORM 7 switch (#1073).
- *Trust alone.* It leaves no signal.

## R-8 Time budget and failure treatment

**Decision.**

- `budgetMs` is declared per point and applies per participant. The default is 500 ms, the bounds
  are 1 to 10 000 ms, and `definePolicyPoint` refuses anything outside them.
- The platform races each participant against its budget, passes an `AbortSignal`, ignores a late
  result, and attaches a handler so that a late rejection is logged once and never becomes an
  unhandled rejection.
- Failure kinds are `threw`, `timeout`, `invalid-verdict` and `write-attempt`.
- `onParticipantFailure(failure) => verdict` substitutes a verdict, which is attributed to the
  failing participant and recorded in the trace.
- Without a substitute, the point is **fail-closed**. `evaluate` rejects with
  `PolicyEvaluationError`, which carries the trace, and nothing is applied. The same error is raised
  when the owner's `validate` refuses the final decision.
- One error code, `POLICY_EVALUATION_FAILED` (500), is declared by `_i18n`, the platform vocabulary
  owner as in 176 amendment 1, and translated in English and Polish under `errors.*`.

**Rationale.** D-295 gives fail-closed as the default. A substitute is how an owner states a safer
answer than refusing, such as "hold" for moderation. A substitute that passes `previous` through is
how an owner of a `chain` point chooses fail-open on purpose, in writing.

**Rejected.**

- *A per-evaluation total budget.* It makes one slow participant starve the others in a
  `commutative` point.
- *Fail-open by default.* It contradicts D-295.
- *A third `skip` treatment.* It is expressible as a substitute.

## R-9 Presence (Principle XVII)

**Decision.**

- A participant whose module is not `isPresent` is skipped **per evaluation** and traced as
  `skipped-absent`. This is the same choice as 176 R-10: the plan keeps the participant, so an
  operator switching a module needs no restart.
- When the owner is off, its code does not run, so nothing evaluates.
- When the owner is not composed at all, a declared participation is **dropped** at seal. This
  follows the precedent of `contribution-sinks.ts`: a push nobody observes.
- `ctx.policyParticipants` itself is a registration in the composition. It is not a boot hook, so
  `check:entry-presence` has nothing to see.

## R-10 Tenant context

**Decision.**

- `evaluate` requires an ambient `TenantContext`. Without one it throws
  `MissingTenantContextError`, as `CommandBus.run` does.
- Participants inherit the caller's context. The platform never widens it.
- The moderation reactor runs under `withSystemScope('organizations: evaluate the moderation
  policy', …)`, because the organization under evaluation is not in any operator's reach yet.
- A participant that reads its own tenant-scoped rows constrains them by the `organizationId` in
  its input (D-285 item 2).

## R-11 Reason codes and their labels

**Decision.**

- A verdict schema may carry a top-level `reasonCode: string`. When it does, the platform checks the
  code against the participant's declared `reasonCodes`, or against the point's
  `defaultReasonCodes` for the default participant and for substitutes. A code outside that set is
  `invalid-verdict`.
- The code grammar is `^[a-z][a-z0-9_]*$`.
- A reason's label key is `<pointId>.reason.<code>` in the **emitting** module's bundle. For
  example `organizations.moderation.reason.mode_manual` in `organizations/i18n/{en,pl}.json`, and
  `organizations.moderation.reason.vies_inactive` in the contributor's own bundle.
- The admin API resolves the label in the request's language through `adminI18nService`, and ships
  the code beside it. This is `specs/conventions/module-i18n.md` case 1: the backend can resolve
  the reader's language. `adminI18nService` answers `moduleId.key` for a missing key, and the API
  turns that into the bare code (FR-041).

**Rejected.**

- *Labels in `organizations`' bundle for every contributor.* Core would then edit itself for each
  deployment, which Principle XV forbids.
- *Consumer-side translation in the admin SPA.* The SPA loads bundles per module namespace, and a
  contributor's namespace is not the screen's. The organization-permission precedent already solved
  this on the backend.

## R-12 Trust tier (D-295, OQ-1 open)

**Decision.** A participation from a module in `installedPackageModuleIds` refuses composition with
`PackagePolicyParticipantNotOfferedError(moduleId, pointId)`. Core and overlay participants are
accepted. The check uses the composer's set, not the `overlay` flag, for the reason
`module-context.ts` gives: one fact grants and the other refuses, and they must not merge.

**Options for OQ-1.**

- **A. Never.** This is the current default, and it is the simplest.
- **B. Owner opt-in per point** (`acceptsPackages: true` on the ref). Trust becomes the owner's
  judgement. A package author still cannot be stopped by the instance.
- **C. An instance-owned grant per (package, point)** in the instance's `divergence.ts`. Trust sits
  with the party that installed the package, keyed as D-156.1–D-156.9 require for any future grant.

**Recommendation.** A for 0.113.0, and C only when a real package needs it. C is additive: it is
one optional field, and the refusal tells the reader where to add it.

## R-13 Visibility, and the rung

**Decision.**

- **Plan API and screen.** `GET /api/v1/admin/policy-points` is registered by `_lifecycle` beside
  the command-hook plan, behind `platform.modules.read`. It returns `PolicyPointPlanResponse`.
- **Admin shell.** It gets a `/platform/policy-points` screen beside `/platform/command-hooks`, an
  AppShell entry, and a `_lifecycle` palette action `open-policy-points`.
- **Divergence report.** The kind `policy-participant` sits at **rung 3**, with the key
  `policy-participant:<module>:<pointId>#<participantId>` and the detail
  `{ point, combiner, participantId, position: null, override: 'declared' | null }`. `position` is
  `null` in the committed artefact, as decoration `depth` is: it depends on core contributors that
  the overlay walk does not see. The runtime plan fills it in.
- **Seam classification.** `SEAM_CLASSIFICATION` gains `policyParticipants` (divergence, rung 3) and
  `policyPoint` (not-a-seam: a module declaring its own point).
- **`module:status <id>`** prints `policyPoints` and `policyContributions` from the manifest. It
  composes nothing (D-157.2), so the positions it prints are at module granularity, from
  `dependencies` and `policyOrder`.

**Why rung 3.** `docs/docs/architecture/customisation-ladder.md` § *Rung 3* says that a deployment
cannot supply a strategy, and it sends the reader to "ask the owner for a port". A policy point is
what that request produces: the owner publishes a decision, and a deployment takes part in it.
Rung 2 is "run before or after what the owner serves". A participant does not run around the write.
It decides what the write will be.

## R-14 The moderation decision path

**Decision.**

1. The reactor builds the input from current state: the organization, its first channel binding,
   its lookup outcome, and the first account's e-mail domain through `customerAccountReadPort`. It
   notes the organization's `version`.
2. It calls `moderationPolicy.evaluate(input)` **outside any transaction**.
3. It runs **one** Command, `organization.moderation.record_evaluation`, with the automation actor.
   The Command re-reads the organization and **returns without writing** unless it is still
   `pending_verification` at the noted `version` (FR-039). Otherwise it inserts the evaluation row
   and, on `approve`, runs the approve Command of `specs/186-aggregate-ports/` as a child through
   `ctx.run`. That is the same Command `organizationCommandPort.approve` runs.
4. On `PolicyEvaluationError`, which cannot happen for this point because it declares a substitute,
   it records nothing and logs. The organization stays pending.

**Rationale.**

- One transaction means the approval and the record of why it happened commit together.
- Evaluating outside the transaction means a rule that calls an ERP within its 5 s budget holds no
  database transaction open.
- The child Command is the one write path that 186 makes the port and the admin route share. The
  hooks and audit of 176 therefore see one approval, whoever triggered it.

**Rejected.**

- *Calling `organizationCommandPort.approve` through the port after recording the evaluation.* That
  is two transactions, so a version clash between them leaves a recorded `approve` that never
  happened. The port's gate is also a gate on the module's own presence, which is meaningless
  inside the module. **This reads the brief's "through `organizationCommandPort.approve`" as "the
  same Command"; see the Handoff in `plan.md`.**
- *Evaluating inside the Command.* It holds a transaction open for up to n × 5 s.

## R-15 Storing the evaluation

**Decision.** A new `@OrgScoped` table, `organization_moderation_evaluations`, owned by
`organizations`. It follows the precedent of `organization_tax_id_validations`. It has one row per
evaluation that was applied. See `data-model.md` §5.

**Rejected.**

- *A `jsonb` column on `organizations`.* It is a core-table change, it keeps no history, and it is
  read by every organization query.
- *Reading reasons back from `audit_log_entries`.* That is a platform-global table, and
  `audit-state.md` §3 sends a history to a store the module owns.

## R-16 Re-evaluation trigger

**Decision.** `OrganizationTaxIdValidationService.trigger` emits
`organization.tax_id_validation.resolved.v1` `{ eventId, occurredAt, organizationId, outcome }`
after its flush, when three conditions hold:

- the organization's previous `vatValidationOutcome` was `deferred`;
- the new outcome is anything else;
- the organization is `pending_verification`.

A `ctx.subscribe` on that event runs the same reactor with trigger `registry_lookup_resolved`.

**Rejected.**

- *A direct call from the validation service into the moderation service.* It couples two services
  and bypasses the gated subscriber seam.
- *A polling worker.* That is OQ-3, and it is a different feature.

## R-17 `manual` and approving rules (OQ-2)

**Reading.** The default rule maps `manual` to `hold`, and hold wins. So under `manual` no
contributed rule can approve. A deployment that wants "approve automatically unless …" sets `auto`
and writes **hold** rules. A contributed `approve` is then "no objection, for this reason", and its
code is recorded in the audit entry.

**Rationale.** This keeps the operator's `manual` meaning exactly "a person decides every
registration". The issue's own alternative analysis criticises "approvals outside the setting the
operator sees".

**Option B (not chosen).** A third mode, `rules`. In it the default abstains, and approval needs at
least one contributed `approve` and no `hold`. This adds a verdict value (`abstain`) to the default
rule only, and a setting value. **Recommendation: A** (as specified). B can be added later without
breaking anything.

## R-18 Automatic retry of deferred lookups (OQ-3)

Today only an administrator retries a lookup. FR-036 re-evaluates on any retry that resolves, so a
retry worker can be added later with no change here. The recommendation is a separate issue: a
BullMQ worker after the `quote_requests/rfq-expiry-worker.ts` pattern (Principle X), with backoff,
limited to registration-origin `deferred` rows of pending organizations.

## R-19 The default rule when the setting is unreadable

**Decision.** The default rule holds with `default_unreadable`. Today the same case silently
degrades to manual. The outcome is the same, but now the operator sees the reason.

## R-20 Vocabulary alignment with `specs/176-command-hooks-outbox/` and `specs/189-command-middleware/`

| Concern | 176 command hooks | 188 policy points | 189 command middleware (issue #1840) |
| --- | --- | --- | --- |
| Owner declares | `hookableActions` | `policyPoints` | — (the bus is the owner) |
| Contributor declares (manifest) | — | `policyContributions` | `commandMiddleware` |
| Contributor registers (code) | `ctx.commandHooks([...])` | `ctx.policyParticipants([...])` | (189 decides) |
| Order | dependency closure + `commandHookOrder` | dependency closure + `policyOrder` | dependency closure + `commandMiddlewareOrder` |
| Order algorithm | `orderCommandHooks` | shared `orderByModuleDependencies` | proposed to share it |
| Presence | `isPresent` per call | `isPresent` per evaluation | `isPresent` per run |
| Budget / failure | — | per participant, fail-closed default | per middleware, `admit` fails closed |
| Divergence kind / rung | `command-hook` / 2 | `policy-participant` / 3 | (189 decides) |
| Plan API | `/api/v1/admin/command-hooks` | `/api/v1/admin/policy-points` | (189 decides) |
| Test kit | `./command-hooks` | `./policies` | (189 decides) |
| Packages may contribute | yes | **no** (OQ-1) | `observe` only |

The two words to keep apart: a hook *runs inside* a write; a participant *decides*. 189's `admit`
is close to a participant, but it is a pass-or-throw gate on every Command, with no verdict to
combine and no owner. It stays a separate mechanism.

## R-21 Fit for the registration conflict point (`specs/191-membership-join-requests/`)

The mechanism supports the following, which is everything 191 needs from it:

- a `chain` point, `organizations.registrationConflict`;
- a verdict of `{ policy: 'refuse' | 'join-request', reasonCode }`;
- a default from `organizations.registration_conflict_policy`;
- evaluation inside the registration request, **before** `organization.register` runs, under the
  request's tenant context;
- a budget small enough for a request, for example 300 ms;
- an `onParticipantFailure` that 191 chooses, for example `previous` (keep what the inner rule
  decided) or `refuse`.

Participants cannot write there, so a join request is still created only by 191's own Command. 191
owns the input, the verdicts, the default, the budget and the failure treatment.

## R-22 Caching and cross-process state

There are no new Redis keys and no pub/sub channel:

- The plan is fixed at composition.
- Presence is read from the effective state, which every process keeps fresh from
  `b2b:module:state-changed`.
- The moderation setting is read per evaluation through `settingsReadPort`, which keeps its own
  invalidation.
- The `observedOverride` counters are per process, and the plan API says so.

## R-23 Delivery and dependencies

The work splits into two packages:

- **WP-A (#1839) — no database.** It covers contracts, platform, the test kit, the divergence
  report, the plan screen, the constitution amendment and the ladder docs. Per D-295 it can start
  before the MikroORM 7 switch (#1073, 7.2.11).
- **WP-B (#1838).** It needs WP-A and `specs/186-aggregate-ports/`'s approve Command plus the
  `automation` actor (#1821). Its one migration is scaffolded with `migration:new` after #1073 has
  merged, so that it is not written against the outgoing ORM. Release 0.113.0.

## R-24 Dependencies

**Decision.** No new runtime dependency is needed: Zod, `AsyncLocalStorage` and `Proxy` are already
available.
