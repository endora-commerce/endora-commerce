# Feature Specification: Declared policy points, and the organization moderation policy

**Feature Branch**: `spec/188-policy-points`
**Created**: 2026-11-23
**Status**: Draft
**Ruling**: D-295 (owner, 2026-11-23), extended by the owner's answers of 2026-11-23 as items 5 to 8,
which close OQ-1 to OQ-3. All are recorded in `plan.md` § *Ruling D-295*.
**Input**: Issue #1839 (declared policy points, e2) and issue #1838 (organization moderation policy).
The owner accepted OD-5 with one change on 2026-11-23: the owner of a point declares its combiner.
Sibling specifications written in parallel, cited by slug: `specs/186-aggregate-ports/` (D-293),
`specs/187-side-table-extensions/` (D-294), `specs/189-command-middleware/` (D-296),
`specs/190-overlay-full-modules/` (D-297), `specs/191-membership-join-requests/` (D-298).

## Context

Core modules make some business decisions in code that a deployment cannot change. For example:
is a new organization approved automatically? What happens when a registration uses a tax ID that
already exists? Today such a decision is either hard-coded or a setting with a fixed list of values.

This feature adds one platform mechanism and its first user:

- **A declared policy point** (#1839). The module that owns a decision declares it as a named
  point. Other modules can contribute **participants** to the point. A participant decides. It
  never writes.
- **The organization moderation policy** (#1838). It is the first point, and it is
  `commutative`. The moderation setting becomes the point's default rule.

The second point, the registration conflict policy (`chain`), is specified in
`specs/191-membership-join-requests/`. This specification defines the mechanism so that this
second point fits it (FR-050).

Some words used below:

- **Owner**: the module that declares a policy point.
- **Participant**: one decision function that a module contributes to a point.
- **Default participant**: the owner's participant. Every point has exactly one.
- **Combiner**: how the participants' verdicts become one decision.
  - `chain` runs the participants in a fixed order. Each one receives the input and the
    previous verdict.
  - `commutative` evaluates the participants independently. The owner's rule then combines
    their verdicts, and the order does not matter.
- **Contributor**: a module that contributes at least one participant.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A module author declares a decision point that other modules take part in safely (Priority: P1)

A core module author has a decision that deployments need to change. The author declares it as a
policy point and chooses its combiner. Then a deployment's overlay module contributes a
participant without editing core. The platform makes sure of five things:

- a participant cannot write;
- a participant cannot take longer than the point allows;
- a participant cannot return a verdict outside the allowed set;
- a switched-off module's participant takes no part;
- two `chain` participants with no defined order do not compose silently.

**Why this priority**: Every other story is built on this mechanism.

**Independent Test**: Declare a fixture point once with each combiner. Contribute participants
from fixture modules. Then evaluate the point under the conditions listed in the scenarios below.

**Acceptance Scenarios**:

1. **Given** a `chain` point with a default and two contributed participants, where module B
   depends on module A, **When** the point is evaluated, **Then** the default runs first, then A
   receiving the default's verdict, then B receiving A's verdict. The decision is B's verdict.
2. **Given** a `chain` point and two contributing modules of the same origin that no dependency
   path orders, **When** the platform composes, **Then** composition refuses and names both modules
   and the point. **And Given** the deployment's declaration ranks the two modules for that point,
   **Then** composition succeeds in the declared order.
3. **Given** a `chain` point with participants from a core module, from a granted third-party
   package and from a deployment overlay module, none of which depends on another, **When** the
   point is evaluated, **Then** the default runs first, then the core participant, then the
   package's, then the deployment's. The deployment always has the last word.
4. **Given** a `commutative` point with three participants, **When** it is evaluated with the
   participants registered in any order, **Then** the decision is the same.
5. **Given** a participant that throws, exceeds its time budget, or returns a verdict that fails
   the point's schema or uses a reason code it did not declare, **When** the point is evaluated,
   **Then** that participant is treated as the point declares: either the point's substitute
   verdict, or, by default, the evaluation refuses and nothing is applied.
6. **Given** a participant that tries to run a Command or emit an event while it decides, **When**
   the point is evaluated, **Then** the attempt is refused and the participant is treated as
   failed.
7. **Given** the contributing module is switched off, **When** the point is evaluated, **Then**
   the participant is skipped. **When** the module is switched back on, **Then** it takes part
   again, with no restart.
8. **Given** the combined decision violates the owner's own invariants, **When** the point is
   evaluated, **Then** the decision is refused and not applied.
9. **Given** a `chain` participant that never reads the previous verdict and has not declared
   itself an override, **When** the point is evaluated, **Then** the participant is reported as
   `policy-override`.
10. **Given** an installed third-party package contributes a participant to a point, and the
    deployment's committed divergence declaration does not grant that package for that point,
    **When** the platform composes, **Then** composition refuses. The refusal names the package,
    the point and the declaration field that would grant it (D-295 item 5).
11. **Given** the declaration grants that package for that point, with a reason, **When** the
    platform composes, **Then** the package's participants for that point take part like any other.
    **And Given** the same package also contributes to a second point it is not granted for, **Then**
    composition refuses for the second point.
12. **Given** a grant that names a point no composed module declares, a module the composition does
    not hold, a module that is not a third-party package, or a package that contributes nothing to
    that point, **When** the platform composes, **Then** composition refuses and names the grant
    entry.
13. **Given** a granted package, **When** anything other than that point's participation asks for
    the package's trust tier (decoration, command middleware, another point), **Then** the package is
    treated exactly as an ungranted package.

---

### User Story 2 - Moderation behaves exactly as today when nobody contributes a rule (Priority: P1)

An operator upgrades. No module contributes a moderation rule. New registrations are moderated
exactly as before: with the setting on `auto` they are approved, and with `manual` they wait.
Nothing has to be migrated.

**Why this priority**: The policy must not change behaviour in a store that did not ask for it.

**Independent Test**: Register an organization with the setting on `auto` and again on `manual`.
Compare each status, the e-mails sent and the audit entries with the pre-release behaviour.

**Acceptance Scenarios**:

1. **Given** the moderation setting is `auto` and there is no contributed rule, **When** a
   business registers, **Then** it is approved by the system, with the moderation policy recorded
   as the source of the approval, and receives the approval e-mail.
2. **Given** the setting is `manual`, **When** a business registers, **Then** it stays
   `pending_verification`. The queue shows the reason "Manual moderation is on".
3. **Given** the setting cannot be read, **When** a business registers, **Then** it is held with
   a reason saying the default rule could not be read. Today this case degrades to manual.

---

### User Story 3 - A deployment adds its own moderation rule and the operator sees why an organization waits (Priority: P1)

A deployment wants new businesses approved automatically, but held when the tax ID was not
confirmed by the registry or the country is outside the markets it serves. Its overlay module
contributes two hold rules. The operator sets moderation to `auto`. The admin moderation queue
says, in the operator's language, why each held organization waits.

**Why this priority**: This is the business value of #1838.

**Independent Test**: An overlay fixture contributes a rule that holds unless the registry lookup
outcome is `validated`. Register one business with a validated lookup and one with a failed lookup.

**Acceptance Scenarios**:

1. **Given** the setting is `auto` and a contributed rule holds when the lookup outcome is not
   `validated`, **When** a business registers with a `validated` lookup, **Then** it is approved.
   The audit entry names the reason codes of every rule that approved.
2. **Given** the same configuration, **When** a business registers with a `failed` lookup, **Then**
   it stays pending. The queue and the organization screen show the rule's translated reason.
3. **Given** two contributed rules, one approving and one holding, **When** a business registers,
   **Then** it is held. Hold wins.
4. **Given** a contributed rule throws or exceeds its time budget, **When** a business registers,
   **Then** it is held. The reason says which rule failed.
5. **Given** any combination of rules, **When** a business registers, **Then** it is never
   rejected automatically. Rejection stays an operator decision.
6. **Given** the setting is `manual`, **When** every contributed rule approves, **Then** the
   organization is still held, because the default rule holds and hold wins. There is no third
   mode (D-295 item 6).
7. **Given** the module contributing a rule is switched off, **When** a business registers,
   **Then** that rule is skipped. The organization is decided by the remaining rules.
8. **Given** an operator approves or rejects the organization while its evaluation is running,
   **When** the evaluation finishes, **Then** its result is not applied. The operator's decision
   stands.

---

### User Story 4 - A held organization is reconsidered when a deferred registry lookup resolves (Priority: P2)

A business registered while the registry was unavailable, so its lookup is `deferred`. The rules
held it. Later an administrator retries the lookup and it resolves. The organization is evaluated
again, with the resolved outcome as its input, while it is still pending. An automatic retry of
`deferred` lookups is not part of this feature: it is a separate issue (to be filed, D-295 item 7).
Because the re-evaluation reacts to any retry that resolves, that issue needs no change here.

**Why this priority**: Without it, a provider outage turns automatic approval into manual work.

**Independent Test**: Register with a stubbed provider that answers `deferred`. Retry the
validation with a provider that answers `validated`. Observe a second evaluation and the approval.

**Acceptance Scenarios**:

1. **Given** an organization pending with lookup outcome `deferred`, **When** a retry records
   `validated`, `failed` or `unverified`, **Then** the moderation policy is evaluated again, with
   the trigger "registry lookup resolved".
2. **Given** an organization that is no longer pending, **When** a retry resolves, **Then** no
   evaluation runs.
3. **Given** a retry that is still `deferred`, **When** it is recorded, **Then** no evaluation
   runs.

---

### User Story 5 - An upgrader and an operator can see every participant (Priority: P2)

Before an upgrade, the person who maintains a deployment needs to know which core decisions the
deployment changes. An operator needs to know which rules decide moderation.

**Why this priority**: A seam nobody can list is invisible to upgrades. That is what #1839
replaces.

**Independent Test**: Compose with an overlay participant. Read the divergence report, the
platform screen and `module:status`.

**Acceptance Scenarios**:

1. **Given** an overlay module contributes a participant, **When** the divergence report is
   generated, **Then** it lists the participant with its point and combiner.
2. **Given** the deployment's declaration grants a third-party package for a point, **When** the
   divergence report is generated, **Then** it lists the grant with the package, the point and the
   declared reason. **When** the platform screen is opened, **Then** each of that package's
   participants shows its origin `package` and that it takes part by a grant.
3. **Given** any composition, **When** an operator with platform read permission opens the policy
   points screen (also reachable from the command palette), **Then** it lists every point and
   every participant. A `chain` participant shows its position. Every participant shows its origin,
   whether its module is present now, its reason codes, and whether it has been seen overriding.
4. **Given** a module, **When** `module:status <id>` is run, **Then** it shows the points the
   module declares and the points it contributes to.

---

### User Story 6 - A contributor ships tests that keep holding across core upgrades (Priority: P2)

A contributing module tests its participant against the owner's real combiner and schemas. A
core upgrade that changes either one turns the contributor's tests red. It never becomes a
production surprise.

**Why this priority**: This is the contract-gated half of Principle XV.

**Independent Test**: Run the conformance helper over a fixture participant. Then change the
fixture point's combiner and watch the helper fail.

**Acceptance Scenarios**:

1. **Given** a participant and its test cases, **When** the conformance helper runs, **Then** it
   evaluates the point with and without the participant. It asserts that each decision is valid
   under the owner's schema, invariants and combiner.
2. **Given** a `chain` participant that ignores the previous verdict without declaring it,
   **When** the helper runs, **Then** it fails and names `policy-override`.
3. **Given** a participant that declares a reason code with no English or Polish label, **When**
   the helper runs with the module's bundles, **Then** it fails and names the key.
4. **Given** an owner's `commutative` combiner, **When** the owner's own test runs the
   commutativity helper over sample verdicts, **Then** every permutation yields the same decision.

### Edge Cases

- **Owner not installed.** An instance that does not compose the point's owner drops the
  participation without an error at boot. A participation that names a point no module in the
  tree declares is a CI finding.
- **Owner switched off.** The owner's code does not run, so the point is not evaluated. Its
  participants have nothing to do. The moderation owner, `organizations`, cannot be switched off.
- **The same participant id twice** in one module and point, or two modules declaring one point
  id: composition refuses.
- **A participation declared in the manifest and not registered in code**, or registered and not
  declared: composition refuses.
- **A late result after the time budget** is ignored. A late failure is swallowed and logged once.
  The verdict substituted at the deadline stands.
- **A participant that reads other organizations' data.** Moderation runs under a system scope.
  A participant must constrain by the organization id it was given (D-285).
- **Organizations registered before the release** have no evaluation. The queue shows "No
  automatic evaluation" for them. No backfill runs.
- **An organization registered with no lookup** (the lookup is switched off), and validated later
  by an administrator: there was no `deferred` outcome to resolve, so no re-evaluation runs
  (FR-036).
- **The process stops between the registration commit and the evaluation.** The organization
  stays pending, which is the fail-safe outcome. An operator decides it as today.
- **A reason label is missing.** The admin shows the code, never a missing-key placeholder.
- **A granted package is uninstalled** but its grant stays in the declaration. The next boot refuses,
  naming the grant, until the entry is removed. A stale grant is refused for the reason a stale
  omission is: it is how a deployment would silently re-admit a different package later.
- **A granted package is switched off.** Its participants are skipped, like any switched-off
  module's. The grant stays valid.
- **An installed first-party module package** (origin `core` by `specs/189-command-middleware/`
  `contracts/module-origin.md`) needs no grant. A grant naming it is refused as not a third-party
  package.

## Requirements *(mandatory)*

### Functional Requirements — the mechanism (#1839)

- **FR-001**: A module MUST be able to declare a policy point. The declaration holds:
  - an id namespaced by the declaring module's id;
  - an input schema, a participant verdict schema and a decision schema;
  - a combiner, `chain` or `commutative`;
  - a default participant, with the reason codes it may emit;
  - a per-participant time budget;
  - a failure treatment.
- **FR-002**: Only the module whose id prefixes a point id may declare that point. Two
  declarations of one point id MUST refuse composition.
- **FR-003**: A contributor MUST declare each participation in its manifest (the point, a
  participant id, the reason codes it may emit, and for `chain` whether it is a declared override).
  It MUST supply the decision function in code. Declaration and registration MUST match one to
  one, otherwise composition refuses.
- **FR-004**: A participation for a point that no composed module declares MUST be dropped
  silently at composition. A participation naming a point that no manifest in the tree declares
  MUST be reported by CI.
- **FR-005**: A participant MUST receive the validated input, made immutable, and return a
  verdict. While a participant runs, any attempt to run a Command or emit an event MUST be refused,
  and the participant counts as failed.
- **FR-006**: For `chain`, the default participant MUST run first. Each contributed participant
  receives the input and the previous verdict. Contributed participants MUST run in origin tiers:
  `core` first, then `package`, then `deployment`. Within a tier the order MUST follow transitive
  manifest `dependencies`: a module runs after every module it depends on. Two contributing modules
  of one tier with no dependency path MUST refuse composition, naming both, unless the deployment's
  declaration ranks them for that point. A ranking that contradicts a dependency path, or that
  names modules of different tiers, MUST refuse composition, and so MUST a dependency path that
  contradicts the tier order. One module's participants keep their registration order.
- **FR-007**: A `chain` participant that returns a verdict without reading the previous one, and
  has not declared itself an override, MUST be reported as `policy-override`. The report appears on
  the platform screen and once in the log, and the conformance helper fails on it.
- **FR-008**: For `commutative`, every present participant MUST be evaluated independently, and
  the verdicts combined by the owner's declared rule. The decision MUST NOT depend on the order of
  registration or evaluation.
- **FR-009**: Every verdict MUST be validated against the point's verdict schema. Where the verdict
  carries a reason code, the code MUST be validated against the codes its participant declared. An
  invalid verdict is a participant failure.
- **FR-010**: A participant failure (it throws, exceeds the budget, or returns an invalid verdict)
  MUST be handled as the point declares: either a substitute verdict, attributed to the failing
  participant, or, by default, fail-closed. Fail-closed means the evaluation refuses and nothing is
  applied.
- **FR-011**: The owner MUST validate the final decision against the decision schema and its own
  invariants. A refused decision MUST NOT be applied.
- **FR-012**: A participant whose module is not effectively present MUST be skipped at each
  evaluation. Switching the module on or off MUST NOT need a restart.
- **FR-013**: Participants from modules of origin `core` and `deployment` MUST be accepted. A
  participant from a module of origin `package` MUST refuse composition unless the deployment's
  committed divergence declaration grants that package for that point (D-295 item 5). Origin is the
  one `specs/189-command-middleware/` `contracts/module-origin.md` defines; this feature consumes it.
- **FR-014**: An evaluation MUST return a trace with one entry per participant: decided, skipped
  as absent, or failed (and how), with its verdict and duration. The owner records what it needs
  from the trace.
- **FR-015**: A read-only platform screen and its API MUST list every declared point (owner,
  combiner, budget, failure treatment) and every participant. For each participant they show the
  module, the id, its position for `chain`, the reason codes, the declared override, whether its
  module is present now, and any observed override. The screen MUST be reachable from the command
  palette and from the platform navigation, under the existing platform read permission.
- **FR-016**: The deployment divergence report MUST list each participant contributed by an
  overlay module, with its point, combiner and participant id. It MUST also list each grant from the
  declaration, with the package, the point and the grant's reason.
- **FR-017**: `module:status` MUST show the points a module declares and the points it
  contributes to.
- **FR-018**: The test kit MUST offer a conformance helper. It runs a point with and without a
  participant, using the owner's published schemas, combiner and failure treatment. It asserts that
  the decisions are valid, that the participant stays within its budget, that it does not write,
  and that any override is declared. Given the module's bundles, it also asserts that every
  declared reason code has an English and a Polish label. The test kit MUST also offer a
  commutativity helper for owners.
- **FR-019**: Identical compositions MUST produce identical participant orders and identical
  reports (Principle XV).
- **FR-020**: The constitution's Principle XV bounded overridable surface MUST name declared policy
  participants. This is a MINOR amendment, ratified by the owner in the merge request that ships
  the mechanism.
- **FR-021**: The customisation ladder and the kernel guide MUST document policy points, in
  English and Polish where the page is published in both.
- **FR-022**: An evaluation refused by the mechanism that reaches an HTTP caller MUST answer with
  one platform error code, translated in English and Polish.
- **FR-023**: A grant MUST name one policy point, the package by its module id **and** its installed
  package name, and a reason in prose, in the deployment's committed divergence declaration. Both
  names MUST match the composed module, so an npm alias cannot borrow another package's grant. A grant covers every participant that module
  declares for that point and nothing else.
- **FR-024**: Composition MUST refuse a grant that names a point no composed module declares, a
  module the composition does not hold, a module whose origin is not `package`, a module whose
  installed package name differs from the grant's, or a package that declares no participation for
  that point. The refusal MUST name the point, the module and the
  declaration field.
- **FR-025**: A grant MUST NOT change the package's origin, and MUST NOT be read by anything except
  the composition of that point's participants. Decoration, command middleware (including its
  observer redaction) and every other point MUST treat a granted package exactly as an ungranted
  one (`specs/189-command-middleware/` `contracts/module-origin.md` §5).
- **FR-026**: The plan API, the platform screen and the boot log MUST show each participant's origin,
  and for a `package` participant that it takes part by a grant.

### Functional Requirements — the organization moderation policy (#1838)

- **FR-030**: `organizations` MUST declare the point `organizations.moderation` with combiner
  `commutative`. A participant verdict is `approve` or `hold` with one reason code. No `reject`
  verdict exists.
- **FR-031**: A rule MUST receive the following input:
  - the new organization's id and whether it is personal;
  - its country;
  - its tax ID;
  - its registration sales channel;
  - the registry lookup outcome and provider recorded for it;
  - the e-mail domain of its first account;
  - the trigger of the evaluation.

  A rule may read its own module's data.
- **FR-032**: The moderation setting MUST become the default rule: `auto` approves and `manual`
  holds. If the setting cannot be read, the rule holds with its own reason code.
- **FR-033**: Any `hold` MUST win over every `approve`. A held decision carries the reasons of
  every holding rule. An approved decision carries the reasons of every approving rule.
- **FR-034**: A rule that fails MUST count as `hold`, with a reason naming the failed rule. The
  per-rule budget is 5 seconds.
- **FR-035**: The policy MUST be evaluated after a self-registration commits, for an organization
  in `pending_verification`, exactly where the moderation reactor runs today.
- **FR-036**: The policy MUST be evaluated again when the organization is still pending and its
  registry lookup outcome changes from `deferred` to `validated`, `failed` or `unverified`.
- **FR-037**: An `approve` decision MUST approve the organization through the Organization
  aggregate's approve Command (`specs/186-aggregate-ports/`). The actor is the `system` actor of the
  system scope the evaluation runs under, with the source code `organizations.moderation` recorded
  (D-293.6). The approval and the evaluation record MUST commit together. The audit entries MUST carry the
  verdict, the reason codes, the failed and skipped participants, and the trigger, as codes and
  ids, never values. The approval e-mail is sent as today.
- **FR-038**: A `hold` decision MUST leave the organization pending, record the evaluation with its
  reasons, and be audited.
- **FR-039**: If the organization's status or version changed between the start of the evaluation
  and its recording, the result MUST NOT be applied, and nothing is written.
- **FR-040**: The admin moderation queue (the organization list filtered to pending) MUST show
  the latest evaluation's reasons as translated labels. The organization screen MUST show the
  latest evaluations:
  - the verdict;
  - the reasons;
  - the failed and skipped rules;
  - the trigger and the time.
- **FR-041**: Each reason label MUST live in the bundle of the module that emitted the code, under
  `<pointId>.reason.<code>`, in English and Polish. The API serves the label in the reader's
  language together with the code. A missing label shows the code.
- **FR-042**: The command palette MUST offer an action that opens the moderation queue, under the
  permission the list already enforces.
- **FR-043**: The moderation setting's label and description MUST say that it is the default rule,
  in English and Polish.
- **FR-044**: No data migration MUST run for existing organizations. An organization with no
  evaluation shows "No automatic evaluation".
- **FR-045**: With no contributed rule, moderation outcomes, e-mails and status events MUST be the
  same as before the release.
- **FR-046**: The organizations documentation page MUST describe the policy, how to write a rule,
  the consequence of D-295 item 6 (`manual` never approves) and how a deployment grants a
  third-party package's rule, with a worked example, in English and Polish.

### Functional Requirements — fit for the second point

- **FR-050**: The mechanism MUST support a `chain` point that is evaluated synchronously inside a
  request, before the owner runs its Command, with a budget suited to a request. The registration
  conflict point of `specs/191-membership-join-requests/` declares itself on these terms. That
  specification owns its input, verdicts, default rule and failure treatment.

### Key Entities

- **Policy point**: a named decision owned by one module, with schemas, a combiner, a default
  participant, a budget and a failure treatment.
- **Participant**: a contributed decision function, declared in the contributor's manifest, with a
  closed set of reason codes.
- **Participant grant**: an entry in the deployment's divergence declaration that admits one
  third-party package's participants to one point, with a reason. It is the deployment's judgement;
  the package cannot write it.
- **Evaluation trace**: per-participant outcome of one evaluation. It is not stored by the
  platform.
- **Moderation evaluation** (owned by `organizations`): one row per evaluation of one
  organization. It holds the trigger, the decision, the reasons, the failed and skipped
  participants, and the time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A deployment adds a moderation rule with zero edited files under core module
  directories.
- **SC-002**: With no contributed rule, the moderation test suite of the previous release passes
  unchanged, apart from the assertions on the new evaluation record.
- **SC-003**: In the moderation queue, every held organization registered after the release shows
  at least one reason, in the operator's language.
- **SC-004**: Every participant of a composition appears on the platform screen. Every
  overlay-contributed participant and every grant appears in the divergence report.
- **SC-007**: No third-party package's participant takes part in any composition without a grant
  entry for that package and that point.
- **SC-005**: No contributed rule, under any failure, produces an automatic rejection or an
  unaudited write.
- **SC-006**: A change to the owner's combiner or schemas fails a contributor's conformance tests
  in CI.

## Assumptions

- `specs/186-aggregate-ports/` delivers the approve Command as a Command that can run as a child of
  another of this module's Commands, and that records a caller source code (#1821). There is no
  `automation` actor kind: the actor is `system` with a source code. WP-B waits for it.
- `specs/189-command-middleware/` defines module origin (`core` / `deployment` / `package`) and its
  derivation in `contracts/module-origin.md`. Whichever of 188 and 189 merges first lands that
  contract's §1 and §2 as written there.
- The registry lookup retry that exists today is the administrator's validation trigger. No
  automatic retry is added here: it is a separate issue (to be filed, D-295 item 7).
- Rules write their reasons as codes. Free text is never a reason.
- A deployment that wants automatic approval with exceptions sets the mode to `auto` and writes
  hold rules (D-295 item 6).

## Owner questions

All three are closed by the owner's answers of 2026-11-23, recorded as D-295 items 5 to 7 in
`plan.md` § *Ruling D-295*. There is no open owner question.

- **OQ-1** *(closed: D-295 item 5, CHANGED from the recommendation)*: An installed third-party
  package may contribute participants now, per package and per point, only where the deployment's
  committed divergence declaration grants it. An ungranted package still refuses composition. The
  grant is listed in the divergence report. See FR-013, FR-023 to FR-026 and `research.md` R-12.
- **OQ-2** *(closed: D-295 item 6, as recommended)*: Under `manual`, no contributed rule can approve.
  Automatic approval with exceptions is `auto` plus hold rules. There is no third mode. See
  `research.md` R-17.
- **OQ-3** *(closed: D-295 item 7)*: Automatic retry of `deferred` lookups is a separate issue (to be
  filed). This feature adds no worker. See `research.md` R-18.
