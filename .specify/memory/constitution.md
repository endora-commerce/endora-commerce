<!--
SYNC IMPACT REPORT
==================
Version change: 4.0.1 → 4.0.2
Rationale: PATCH. The 3.10.0 report — the amendment that introduced Principle
XVII — carries a "Deferred items / TODOs" block naming four mechanisms the
principle mandated and describing them as ones that "do NOT yet exist and must
be built by the implementing feature". Feature 073 built all four, verified
against the tree:

  (a) the operator-activation axis — `admin/src/modules/platform/ModuleActivationControl.tsx`,
      on the kernel-served `/platform/modules` screen that belongs to no module;
  (b) the effective-state resolver — `packages/platform/src/kernel/lifecycle/effective-state.ts`,
      read by every gating seam;
  (c) the manifest fields — `ModuleManifestSchema.activation` and the
      `nonDeactivatable` declaration, in `packages/contracts/src/modules.ts`, the
      very file the block's parenthetical says "has none of these today";
  (d) the gating-wrapper CI check — `check:off-state-coverage`, which landed at
      zero violations over all 46 switchable modules, plus `check:entry-presence`
      for the entry points a wrapper cannot reach.

**The 3.10.0 report itself is not edited, and that is the substance of this
amendment.** This document is a stack of Sync Impact Reports, newest first, each
closing with a line saying the previous one follows *unchanged*. A superseded
report records what was true when its amendment was made, and the 3.10.0 block is
correct as exactly that: those four mechanisms genuinely did not exist on the day
Principle XVII was ratified. Editing it would make the stack unreadable as history
and would be a second defect rather than the repair. The stale path it cites —
`backend/src/modules/_lifecycle/`, whose contents are now split between
`packages/platform/src/kernel/lifecycle/` and `backend/src/lifecycle/` — stays with
it for the same reason.

What is corrected is the **annotation above** that report: the sentence a reader
uses to decide whether the block below is live work or history. It said the
deferred mechanisms were "several still in flight". That was true when written and
is now false, and it is the only live claim in the vicinity.

PATCH, not MINOR: Principle XVII's normative text is unchanged, and was read in
full and found accurate — it describes the two orthogonal axes, the effective
state and the fail-closed rule as binding and present, which the tree implements.
No rule moves; nothing compliant becomes non-compliant. A statement of fact about
the tree that had become untrue is corrected, which is 4.0.1's shape exactly.

Why a false sentence here is worth a version at all: Governance says this document
supersedes every other engineering document and wins any conflict until the other
is reconciled, so a claim that contradicts the tree costs more here than anywhere
else. This repository built `check:lock-claims` on precisely that reasoning — a
written claim the manifests contradict is worse than no claim, and it is enforced
by derivation so that it cannot go stale. The constitution is the one document no
such instrument stands over, which makes its statements of fact the ones that have
to be re-read by hand.

Found by feature 100's SC-005 documentation sweep, which was looking for stale
paths and surfaced a completed TODO list instead — the general lesson being that a
population scoped by a string finds stale paths and cannot find stale claims.

Modified principles:
  - (none)

Added sections:
  - (none)

Removed sections:
  - (none)

Templates / artifacts requiring alignment:
  - ✅ .specify/templates/, .github/pull_request_template.md — neither names a
       constitution version nor the deferred mechanisms; verified by grep.
  - ✅ AGENTS.md — Principle XVII's working summary describes both axes as built,
       and the module enable/disable checklist documents the shipped mechanism.

Deferred items / TODOs:
  - (none)

--- The 4.0.1 report follows unchanged.

SYNC IMPACT REPORT
==================
Version change: 4.0.0 → 4.0.1
Rationale: PATCH. Principle XII's sanctioned-accessor clause said the rule was
"enforced by the `no-unscoped-channel-query` lint rule". That sentence was
false, and had been since feature 005: the rule was referenced by **no** ESLint
config in the repository — its own header said so, deferring the wiring to a
task called T062 — and it did not look at a bridge table at all. It flagged
`em.find(Product, …)` in a function with no `salesChannelId` in scope, which is
a different rule about a different thing. Its only live reader was one
`product_feeds` test that loaded the file by path.

So the clause has been unenforced for four features in a Constitution that says
it is enforced, and the cost is measurable: 116 raw statements against another
module's tables stand in the tree today, eight of them against the
`sales_channel_*` bridges, one of which copies a product's whole channel
assortment with a raw `INSERT` after its Command has already returned — no
membership audit row for any of it (issue #174).

The rule is deleted rather than wired: wiring it would enforce a *different*
rule (thread a `salesChannelId` parameter) at the cost of a rewrite. The
parenthetical now names the mechanism that does enforce the clause —
`check:module-boundary`'s `sql` predicate (feature 077, D-87), which resolves
every `sales_channel_*` table to its owner out of the DDL and ledgers every raw
reach.

PATCH, not MINOR: no rule moves. A statement of fact about the tree that was
untrue is corrected, and no compliant implementation becomes non-compliant —
the clause it describes is unchanged in substance and in scope.

Modified principles:
  - XII. Sales-Channel Content Scoping — the sanctioned-accessor clause's
    parenthetical, and quality gate #11's matching sentence.

Added sections:
  - (none)

Removed sections:
  - (none)

Templates / artifacts requiring alignment:
  - ✅ AGENTS.md — the `check:module-boundary` inventory row now states the
       second predicate.
  - ✅ eslint-rules/no-unscoped-channel-query.js — deleted, with the
       `product_feeds` test that loaded it by path.
  - ✅ README.md / .github/pull_request_template.md — neither names the rule.

Deferred items / TODOs:
  - The ~116 seeded `sql:` ledger entries drain module by module (D-87 handoff
    steps 8 and 9). Feature 075's SC-002 wording waits on the owner's ruling in
    §5 of specs/077-f3-consequence-rulings/rulings.md.

--- The 4.0.0 report follows unchanged.

SYNC IMPACT REPORT
==================
Version change: 3.11.0 → 4.0.0
Rationale: MAJOR bump. Principle XVII's "One toggle, **in Settings**, declared
by the module" clause named the Settings module's admin surface as the home of
every module's activation control. That put the control that toggles modules
inside a module: switch the Settings admin surface off and no activation
control is reachable, including the one that would switch it back on. The
circle was patched with `nonDeactivatable`, a per-module manifest flag which
nothing on the platform axis read — a declaration about a hazard rather than a
structure without one, which is the shape the modular-packaging programme
(D-32) deliberately rejected elsewhere.

The amendment changes **the surface only**. The clause's three binding
requirements are preserved verbatim: a module exposes **exactly one** activation
control, the control is **declared by the owning module's manifest** rather than
by a shared hand-maintained list, and an operator can **reach it without CLI
access**. So is the clause's own reasoning, which exists to stop activation
being CLI-only and to stop a shared registry of toggles — neither of which a
kernel-served platform screen reintroduces. What changes is that the surface
must belong to **no module**, so the circle does not exist to be patched.

Two consequences are written in rather than left implicit. The "single
exception" (a deactivated module's own control stays visible) becomes
*structural*: the control was never part of the module's own surface, so nothing
of that surface survives deactivation. And the non-deactivatable set may no
longer include a module that is load-bearing only because of **where a screen
lives** — that is a layout problem, fixed by moving the screen — while the
declaration must now be **enforced on the platform axis**, not only rendered in
the Admin UI.

MAJOR, and the earlier reading of this as MINOR was wrong. It rested on "no
principle is removed or redefined in substance", which is true and is not the
test the versioning policy sets. The policy's MAJOR clause has a second limb —
"a change that invalidates prior compliant work" — and this change invalidates
it squarely: an implementation that rendered its activation control on the
Settings admin surface was **compliant with the previous wording** and is
**non-compliant with this one**. That the one such implementation in the tree
(feature 073's) is corrected in the same commit changes who had to do the work,
not whether the rule moved under it.

The distinction matters beyond bookkeeping. Endora Commerce is heading for an
open-source release with third-party modules, and a module author reading
"3.10 → 3.11" is told their activation control still belongs in Settings. The
version number is the only signal such a reader gets before their module stops
being conformant. Calling this MINOR would have made the first external
breakage arrive unannounced.

Not PATCH, a fortiori: this is not a wording clarification; a compliant
implementation has to move the control.

Modified principles:
  - XVII. Operator-Toggleable Modules & Disabled-Means-Absent — the surface
    clause, the operator-activation axis wording, the single-exception clause,
    the non-deactivatable clause and quality gate #16's matching sentence.

Added sections:
  - (none)

Removed sections:
  - (none)

Templates / artifacts requiring alignment:
  - ✅ README.md — point 17 updated to name the platform-owned surface.
  - ✅ .github/pull_request_template.md — gate #16 updated to match.
  - ✅ AGENTS.md — Principle XVII summary and the "Module enable/disable"
       checklist updated. (CLAUDE.md is a pointer and needs no edit.)
  - ✅ .specify/templates/plan-template.md / spec-template.md /
       tasks-template.md — Constitution Check is generic; no edits required.

Deferred items / TODOs:
  - Two amendments remain queued and are deliberately NOT in this change:
    Principle XV's overlay mechanism (belongs with F1) and Principle XVII's
    embedded "10 of 67" measurement (belongs with F5, when the number is
    final).

--- The 3.10.0 report follows unchanged: it introduced Principle XVII and
--- records the mechanisms that principle deferred. All four were delivered
--- by feature 073; see the 4.0.2 report above. The block below is history,
--- not outstanding work, and the paths it cites are the ones of its own day.

SYNC IMPACT REPORT
==================
Version change: 3.9.0 → 3.10.0
Rationale: MINOR bump. A new principle — XVII (Operator-Toggleable Modules &
Disabled-Means-Absent) — is added. The platform is modular by Principle I, and
feature 018 already built the enable/disable machinery (`module_registrations`,
the registry cache, and the `defineModuleRoutes` / `defineModuleWorker` /
`subscribeForModule` / `requireModuleEnabled` gating wrappers). What was missing
was a **second, business-owned axis** on top of it, plus the obligation to gate
and any frontend awareness. The resulting half-adoption is worse than no toggle
at all: only 10 of 67 backend modules route their HTTP surface through the
gating wrapper; the Admin UI sidebar, the command palette and the storefront
resolve nothing from the enabled-set; and enable/disable is CLI-only, with the
admin HTTP write surface explicitly deferred in feature 018. A module switched
off today still shows its sidebar entry, its palette actions and its storefront
blocks, and most of its API keeps answering.

The principle makes the contract binding on **two orthogonal axes** —
**platform availability** (the lifecycle registry; owned by whoever operates the
deployment, changed via CLI) and **operator activation** (a Setting in the
Settings module; owned by the business operator, changed from the Admin UI) —
whose **conjunction** is the effective state every gating seam resolves. The
axes are deliberately NOT collapsed: a platform-level disable → enable cycle
must not silently reactivate a capability the business switched off, and a
Settings write must not override a platform lockout. Beyond that: every module
exposes exactly one manifest-declared activation control; a module that is off
behaves as if it were not installed across business logic, API, Admin UI and
Storefront UI, with its own activation control the single deliberate exception
(its configuration surface included in what disappears); off is non-destructive
and reversible, preserving data *and* configuration; modules the platform cannot
run without declare themselves non-deactivatable in their manifest rather than
being silently special-cased; and dependency conflicts fail closed on and across
both axes. The driving case is an installed integration a client does not want —
e.g. `pim_ergonode` — which an operator must be able to switch off from the
Admin UI so it leaves the sidebar and stops synchronising, with no deployment
change. A new principle is added (not a redefinition or removal), so the
versioning policy mandates a MINOR bump.

Modified principles:
  - (none renamed/redefined)

Added sections:
  - XVII. Operator-Toggleable Modules & Disabled-Means-Absent — new principle.
  - Quality gate #16 (Module enable/disable completeness) in Development
    Workflow; the gate-count sentence moves from fifteen to sixteen.

Removed sections:
  - (none)

Templates / artifacts requiring alignment:
  - ✅ .specify/templates/plan-template.md      — Constitution Check is
       generic; no edits required.
  - ✅ .specify/templates/spec-template.md      — no edits required.
  - ✅ .specify/templates/tasks-template.md     — no edits required.
  - ✅ README.md — added Principle XVII quick-reference note (point 17).
  - ✅ .github/pull_request_template.md — added gate #16 (module
       enable/disable completeness) and refreshed the gate-count sentence.
  - ✅ AGENTS.md — added Principle XVII to the binding-principles summary and
       a "Module enable/disable" section to the new-module checklists.
       (CLAUDE.md is a pointer to AGENTS.md and needs no edit.)

Deferred items / TODOs:
  - Principle XVII mandates mechanisms that do NOT yet exist and must be built
    by the implementing feature: (a) the **operator-activation axis** itself —
    a per-module on/off Setting in the Settings module admin surface, distinct
    from and not mutating the lifecycle registry (the CLI-only path deferred
    in feature 018, `specs/018-module-lifecycle/contracts/admin-http.md` E-2,
    covers only the platform axis); (b) an **effective**-state resolver
    (platform availability AND operator activation) that every gating seam and
    both frontends read, plus a server-exposed effective enabled-set so the
    Admin UI and Storefront can hide a module's surfaces; (c) manifest fields
    for the activation control, its default, and for declaring a module
    non-deactivatable (`ModuleManifestSchema` in
    `packages/contracts/src/modules.ts` has none of these today); and (d) a CI
    check for gating-wrapper coverage. The gating wrappers themselves already
    exist but resolve only the platform axis — `registryCache.isEnabled` in
    `backend/src/modules/_lifecycle/` — so they must be extended to the
    effective state rather than duplicated. The principle also makes their use
    mandatory and names the surfaces that currently ignore module state
    entirely (admin sidebar, command palette, storefront).

  (History) 3.8.0 → 3.9.0 added Principle XVI + quality gate #15 (module
    discoverability in the admin command palette).
  (History) 3.7.0 → 3.8.0 added Principle XV + quality gate #14 (untouched core
    & per-deployment overlay, feature 057-overlay-pattern-multideploy).
  (History) 3.6.0 → 3.7.0 added Principle XIV + quality gate #13
    (entity-agnostic extensibility & runtime custom fields, feature
    055-custom-fields-layer).
  (History) 3.5.0 → 3.6.0 added Principle XIII + quality gate #12
    (uniform write auditing via Command Bus, feature 054-command-bus-audit-undo).
  (History) 3.4.0 → 3.5.0 added Principle XII + quality gate #11
    (sales-channel content scoping, feature 052-scoping-hotfixes).
  (History) 3.3.0 → 3.4.0 expanded Principle XI with the "One tenant
    concept — the Organization" clause (feature 051-personal-organizations).
  (History) 3.2.0 → 3.3.0 added Principle XI + quality gate #10
    (framework tenant guard, feature 050-org-tenant-scoping).
-->

# B2B Platform Constitution

## Core Principles

### I. Modular Architecture (NON-NEGOTIABLE)

The backend MUST be structured as a set of functionally independent **modules**.
Each module MUST own its domain logic, data model, migrations, API routes, and
tests. Modules MUST be maximally isolated so they can be added or removed with
minimal blast radius: cross-module calls MUST go through explicit, documented
module interfaces (services or events), never through direct imports of another
module's internals. A module MUST be removable from the codebase without leaving
dangling references in unrelated modules.

**Rationale**: The product is a multi-tenant B2B platform whose feature set will
grow over time (catalog, quotes, orders, customers, pricing, integrations).
Strict isolation prevents combinatorial coupling, keeps onboarding fast, and
lets us decommission or swap modules without rewriting the platform.

### II. API-First Design

The backend MUST expose all business capabilities through a documented HTTP API
**before** any frontend consumes them. The `storefront` and `admin` frontends
are API clients and MUST NOT reach into the backend in any other way (no shared
DB, no in-process imports). API contracts (request/response shapes, error
envelopes, auth) MUST be defined and reviewable as artifacts — not inferred
from client code. Breaking API changes MUST be versioned.

**Rationale**: Decoupling enables independent deploys, parallel frontend/backend
work, third-party integrations, future mobile clients, and server-side rendering
paths without contorting the backend.

### III. Test-Driven Development (NON-NEGOTIABLE)

TDD is mandatory for backend modules and for non-trivial frontend logic
(validators, data transforms, business-rule hooks). The cycle is:
**Red → Green → Refactor**. Tests MUST be written first, MUST fail for the
right reason, and only then MAY the implementation be written. Every module
MUST ship with: (a) unit tests for domain logic, (b) contract tests for its
public API, (c) integration tests that exercise the real database and the
real module boundary (no mocking the DB). Pure-presentation UI code is exempt
from test-first but MUST still be covered by at least one interaction test
per user story.

**Rationale**: The platform handles orders, pricing, and customer data;
regressions are commercially expensive. TDD is the cheapest insurance and
forces testable design up front.

### IV. YAGNI & Minimal Dependencies

Build only what the current user story requires. Do not add speculative
abstractions, configuration knobs, or "future-proof" layers. On the backend,
prefer the Node.js standard library and the mandated stack (see Technology
Stack); adding a new runtime dependency requires a written justification in
the PR description (what problem, what was rejected, what is the cost).
Frontend dependencies follow the same rule. When in doubt between three
similar lines of code and a premature abstraction, prefer the three lines.

**Rationale**: Dependencies are liabilities — supply-chain risk, upgrade
burden, and cognitive load. A lean stack is a stack a junior engineer can
still reason about in year three.

### V. TypeScript Everywhere

All application code — backend, storefront, admin, shared packages, build
scripts where practical — MUST be authored in TypeScript with `strict` mode
enabled. Runtime input at system boundaries (HTTP request bodies, query
params, form submissions, queue payloads, external API responses) MUST be
validated with **Zod** schemas; the Zod schema is the source of truth and
TS types MUST be inferred from it (`z.infer`), not hand-maintained
separately. Any use of `any` in merged code MUST carry a comment explaining
why `unknown` + a narrowing schema was insufficient.

**Rationale**: One language across the stack shrinks the mental model,
enables shared types/validators across packages, and catches whole classes
of bugs at compile time.

### VI. Naming Conventions (NON-NEGOTIABLE)

Consistent naming MUST be enforced across every layer:

- **Backend modules**: folder names MUST be plural `snake_case`
  (e.g. `offers/`, `fixed_costs/`, `share_links/`). Module identifiers MUST
  match folder names. Exceptions — and the ONLY singular exceptions
  permitted — are `auth` and `example`.
- **JavaScript / TypeScript**: variables, functions, and object properties
  MUST use `camelCase` (e.g. `offerId`, `calculateTotal`). Classes and
  types MUST use `PascalCase` (e.g. `OfferService`, `ComponentRoleTime`).
  True constants MAY use `SCREAMING_SNAKE_CASE` (e.g. `MAX_RETRY_COUNT`).
- **Database**: table names MUST be plural `snake_case`
  (e.g. `offers`, `component_role_times`, `share_links`). Columns MUST be
  `snake_case` (e.g. `created_at`, `offer_id`, `default_rate`). Foreign
  keys MUST follow `{referenced_table_singular}_id` (e.g. `offer_id`,
  `user_id`).
- **HTTP API (JSON)**: request/response field names MUST be `camelCase`
  (e.g. `offerId`, `createdAt`, `defaultRate`). URL paths MUST use
  `kebab-case` for multi-word resources (e.g. `/api/fixed-costs`,
  `/api/share-links`).

MikroORM entity-to-column mapping MUST be configured so that `camelCase`
TypeScript fields map to `snake_case` columns automatically; per-field
overrides are allowed but MUST be justified.

**Rationale**: Case mismatches between layers are a recurring source of
bugs (missed fields, silent serialization errors). Aligning naming with
each layer's ecosystem convention removes an entire bug class.

### VII. SEO, Performance & Discoverability

The storefront MUST be built with a framework that supports server-side
rendering or static generation for catalog and product pages (**Next.js**
is the default). It MUST be optimized for **Core Web Vitals** (targets:
LCP < 2.5s, INP < 200ms, CLS < 0.1 at the 75th percentile on a mid-range
mobile device). Product, category, and content pages MUST emit correct
semantic HTML, structured metadata (Open Graph, JSON-LD where applicable),
and server-rendered content usable by search engines and LLM crawlers
(ChatGPT, Claude, Gemini) without JavaScript execution. The admin panel
is exempt from SEO requirements but MUST still meet a usable
time-to-interactive.

**Rationale**: B2B buyers and LLM-driven discovery agents find products
through search. A storefront that is invisible to crawlers or slow on
mobile erodes the platform's primary acquisition channel.

### VIII. Working Language — English (NON-NEGOTIABLE)

The English-only requirement applies to exactly two artifacts:
**(a) inline comments and docstrings inside source files**, and
**(b) every page authored under the `/docs/` Docusaurus site**.
Nothing else is constrained by this principle. Identifiers, file
and folder names, database tables and columns, API field names,
URL path segments, internal log messages, error codes, route
definitions, migration SQL, specs, plans, tasks, research notes,
the root README's body, module READMEs, ADRs, RFCs, governance
documents, commit messages, PR descriptions, and code-review
prose MAY all be authored in any language the team chooses.
(Case style for identifiers is still governed by Principle VI;
this principle says nothing about which natural language they use.)

**In scope (MUST be English)**:

- **Inline code comments and docstrings inside source files** —
  `// …`, `/* … */`, JSDoc/TSDoc blocks (`/** … */`), `<!-- … -->`
  in HTML/JSX, `# …` in shell scripts, and equivalent comment
  syntax in any other source-file format the project introduces.
  This covers every file extension treated as source code by the
  build (`*.ts`, `*.tsx`, `*.cts`, `*.mts`, `*.js`, `*.jsx`,
  `*.cjs`, `*.mjs`, `*.css`, `*.scss`, `*.html`, `*.sh`, and
  equivalents). The rule applies regardless of where the file
  lives — application code, migrations, seeds, scripts, tests,
  and tooling all share the same comment-language rule.
- **The generated project documentation site** — the Docusaurus
  tree rooted at `/docs/`, including every Markdown/MDX file under
  `docs/docs/`, sidebar labels, and authored `src/` content. Every
  page authored for this site MUST be written in English — both
  developer-facing module documentation and Product Owner /
  end-user "Usage" pages. Tooling configuration that lives next to
  the site (`docusaurus.config.js`, `package.json`, build scripts)
  is source code, not authored prose; comments inside it follow
  the source-comment rule, but its identifiers and strings are
  free.

**Out of scope (MAY be in any language)**:

- Source-code identifiers of every kind: variable, function, class,
  type, file, and folder names; database tables, columns, and
  constraint names; API field names; URL path segments. (Case
  conventions are still mandated by Principle VI.)
- String literals of every kind: user-facing copy, log messages,
  error codes, route definitions, migration SQL, seed data,
  fixture content, locale catalogues.
- Specifications (`spec.md`), implementation plans (`plan.md`),
  task lists (`tasks.md`), research notes (`research.md`), data
  models (`data-model.md`), interface contracts (`contracts/`),
  quickstart guides (`quickstart.md`), validation reports.
- The root `README.md` body and every other Markdown file
  **outside the `/docs/` documentation site** (e.g. module
  READMEs, ADRs, RFCs, in-repo design notes).
- The constitution itself and any other governance documents.
- Commit messages, pull-request titles and descriptions,
  code-review comments, issue templates, CI/CD configuration
  labels.
- Foreign-language proper nouns inside any artifact (e.g. *Comarch
  Optima*, *Subiekt GT*, *enova365*, *Symfonia*, regulatory terms
  like *NIP*).

**Rationale for keeping comments in English**: Comments are the
one place inside source code where contributors write free-form
human prose explaining intent. They are read by every reviewer,
every LLM-assisted tool, and every future maintainer who lands in
the file via `git blame` or a stack trace. Keeping them in a
single working language preserves review fluency across a
multilingual contributor base and makes LLM-assisted refactoring
predictable. Identifiers and string literals do not need the same
rule — identifiers are governed by Principle VI's case
conventions and rarely carry untranslated prose, and string
literals are either user-facing (where they MUST be localised) or
operational (where their language has no review impact).

**Rationale for keeping the `/docs/` site in English**: The
`/docs/` Docusaurus site is the project's **public, long-lived
knowledge base**. Unlike specs and plans (which live next to the
work that produced them and decay quickly), the docs site is the
artifact a third-party integrator, an LLM-assisted contributor,
an auditor, or a future maintainer reads months or years after
the team that wrote it has moved on. The same arguments that
justify English comments apply: review fluency across a
multilingual contributor base, LLM-tool fluency, and alignment
with the ecosystem's working language.

**Rationale for keeping every other prose artifact free**:
Documentation, planning, and review prose outside `/docs/` are
read primarily by the team that produced them, not by long-term
external readers. A team whose working language is not English is
better served by writing those artifacts in its own language than
by translating every spec at the cost of nuance and review speed.
The product also remains free to speak whatever customer-facing
languages the business requires.

### IX. UI Reuse & Design-System Consistency

New frontend work MUST reuse the existing UI building blocks before creating
new ones. Both frontends carry a design system: the **Admin UI** primitives
and layouts under `admin/` and the **Storefront UI** primitives and layouts
under `storefront/` (plus any shared UI promoted into `packages/`). When a
story needs a screen, panel, table, form, modal, navigation surface, or any
other view, the author MUST first reach for an existing component or layout
that already covers the pattern and compose the feature from it. A net-new
component or layout MAY be introduced ONLY when reusing the existing ones would
produce a worse user experience, and that **UX justification MUST be stated**
in the feature plan or the PR description — naming the pattern that was
missing, the existing primitives that were evaluated, and why composing them
failed. "It was faster to write fresh" and "I did not know one existed" are
not justifications. A new primitive that earns its place SHOULD be promoted
into the relevant design system (Admin UI, Storefront UI, or shared
`packages/`) so the next story reuses it in turn.

**Rationale**: The platform grows feature by feature across many contributors;
duplicated, slightly divergent components are how a UI rots into visual
inconsistency, double maintenance, and accessibility drift. Reuse-by-default
keeps the visual language coherent, shrinks the bundle, concentrates fixes in
one place, and makes every screen feel like one product. The UX escape hatch
keeps the rule from forcing a worse experience when the existing kit genuinely
does not fit — but it costs one sentence of justification, paid deliberately.

### X. Scalable Queue Consumers

This principle separates the **architectural invariant** (what makes async work
safely scalable) from the **deployment posture** (where the consumer runs). The
invariant is binding; the posture is the default, tuned to volume.

**Architectural invariant (MUST)** — for any asynchronous operation backed by a
queue:

- The queue MUST be a durable, distributed substrate (Redis / BullMQ-class per
  the Technology Stack), not an in-memory list bound to one process.
- Every job MUST be claimed atomically (or otherwise exclusively locked) so that
  running **N ≥ 2 consumer instances never double-processes a job**, and handlers
  MUST be idempotent with respect to redelivery and retries.
- The component that enqueues (an HTTP handler, an event subscriber, a scheduler)
  is the **producer**: it MUST only enqueue and return — it MUST NOT block on, or
  inline-execute, the job inside the request/response path.
- The consumer MUST be implemented as a **separable worker entrypoint** — a
  module that can be started as its own process and scaled to multiple instances
  **without code changes**. Coupling job processing to the API/web server's
  lifecycle (e.g. a `setInterval` sweeper draining the queue inside the request
  process) is PROHIBITED: it cannot scale out, contends with request handling,
  and dies with the API. Such timers are allowed only as a test harness, never as
  the deployed processing path.

**Deployment posture (SHOULD / MAY)** — given the invariant holds:

- Production SHOULD run the consumer as a **separate, independently scalable
  process** whenever the work is long-running, bursty, or volume-sensitive (bulk
  edits, imports/exports, re-indexing, notification fan-out, webhook delivery).
- For genuinely low-volume work, the worker MAY be co-located in the same
  deployable as the API **provided it stays a separable entrypoint** and the
  co-location is noted with one sentence in the feature plan or PR (mirroring the
  Principle IX escape hatch). This keeps single-VPS deployments (see
  Infrastructure Constraints) simple without forfeiting the ability to split the
  worker out later under load.

A synchronous operation that genuinely does not need a queue is out of scope —
do not introduce a queue speculatively (Principle IV). Once an operation is
asynchronous and queue-backed, the invariant above is binding.

**Rationale**: Scalability is unlocked by three things — a durable distributed
queue, atomic claiming, and idempotent handlers — not by the deployment
topology. Get those right and the work is already safe to run on N instances;
where the consumer process physically runs becomes a dial you turn with load
rather than an architecture you must redo. Pinning processing to the API's
event loop, by contrast, throws the benefit away: it can't scale out, it
contends with request latency, and it dies with the web server. Mandating the
*separable entrypoint* (hard) while leaving *separate process* a volume-tuned
default (soft) keeps the rule honest on a single VPS and aligned with YAGNI,
without ever permitting the in-process-sweeper anti-pattern.

### XI. Systemic Multi-Tenant Isolation (NON-NEGOTIABLE)

Tenant isolation MUST be enforced by a **framework-level guard**, not by per-service
query conditions. Because the platform is multi-tenant (and multi-deployment), an
isolation rule that a single forgotten `where`-clause can defeat is not isolation.
The following are binding for every backend feature that touches tenant-owned data:

- **Ambient context, server-derived.** Every request and every background job MUST run
  under an ambient **TenantContext** carrying the effective scope (a single organization,
  an allowed-organization set for scoped admins, or an explicit all-organizations / system
  marker). The context MUST be derived server-side from the authenticated actor (session
  for customers; role + assignment for admins) and MUST NOT be settable from request body,
  query string, or headers.
- **Data-layer enforcement.** Reads and writes on tenant-owned entities MUST be constrained
  at the data-access layer (an ORM/EM-level filter), so isolation holds **even when a
  service omits an explicit tenant condition**. Route-level `requireAdmin` / `requireCustomer`
  authorization stays in place — the guard is **defense-in-depth**, complementing it, never
  replacing it.
- **Fail-closed.** A query against a tenant-owned entity with **no** ambient context MUST
  raise, never return unscoped rows. Widening scope (system / all-org) MUST be an explicit
  mode, never the absence of a filter.
- **Total classification.** Every persisted entity MUST be classified as
  organization-scoped, customer-account-scoped, transitively-scoped (through a parent
  aggregate), rule-scoped, or platform-global. A CI check MUST fail the build on any
  unclassified entity, so a new entity cannot silently escape the guard.
- **Single audited escape hatch.** Crossing tenants (platform-admin reporting, background
  reconciliation, migrations) MUST go through one greppable, audited escape hatch
  (`withSystemScope` / `withOrgScope`, required non-empty reason). No other means of
  widening scope is permitted; every use MUST be attributable in logs/audit.
- **Cross-tenant tests.** Every new tenant-owned entity or query MUST ship with tests
  proving out-of-scope records are inaccessible, and that an out-of-scope response is
  **indistinguishable from "record does not exist"** (no existence leak via status or
  message).
- **One tenant concept — the Organization.** The Organization is the platform's single
  unit of tenancy. Every **transacting** customer MUST be backed by a non-null Organization:
  a company organization for B2B, or a single-member **personal organization** for an
  individual (B2C) customer. There MUST be **no "no-organization" scoping path** — an
  individual is isolated as their own tenant exactly like a company, so the guard always has
  a concrete organization to scope by and never resolves a null tenant for a valid customer.
  Personal organizations are auto-provisioned, single-member, and excluded from B2B admin
  surfaces; the guard mechanism is unchanged by their existence.

**Rationale**: Roughly 128 hand-written organization `where`-clauses made isolation depend
on developer discipline and left four admin surfaces (credit_limits, invoices, returns,
price_lists) leaking cross-tenant the moment a lower-trust role gained a permission. Moving
enforcement into the data layer converts "remember to scope" into "remember to *un*scope,"
which fails safe — a forgotten context surfaces as a loud error in tests and logs, not a
silent cross-tenant read. It is also a prerequisite for the multi-deployment posture, where
each installation carries a different organization topology and isolation must be structural,
not per-service. The framework guard is introduced by feature `050-org-tenant-scoping`; from
this amendment forward, new features build on it rather than reintroducing manual scoping.
Modeling every customer — including individuals — as an Organization (feature
`051-personal-organizations`) removes the one case the guard could not isolate: B2C customers
who shared a null organization. With a single tenant concept, there is no null-tenant edge to
special-case, and individuals are isolated as first-class tenants.

### XII. Sales-Channel Content Scoping (NON-NEGOTIABLE)

Sales-channel scoping is a **distinct isolation axis** from org tenancy (Principle XI). A single
deployment serves multiple **sales channels**; catalog visibility, related / cross-sell / up-sell
links, promotions and coupons, and pricing are bound to channels through the `sales_channel_*`
membership bridges. Every storefront-facing read and every commercial evaluation MUST be confined
to the request's **resolved sales channel**. The following are binding for every feature that
surfaces channel-scoped content or evaluates channel-bound commercial rules:

- **Always resolve a channel; fail closed.** A channel-scoped read or evaluation MUST resolve a
  concrete channel (explicit header / host map, else the system-default channel) and constrain to
  it. A path MUST NOT skip the filter and return the full cross-channel set when no explicit
  channel is present. A **null / unresolved** channel MUST NOT match a channel-bound record — it
  fails closed, never falls open to "all channels."
- **Sanctioned accessor only.** The `sales_channel_*` membership bridges MUST be read and written
  **only** through the channel-membership service; owning modules MUST NOT query the bridge tables
  directly (enforced by `check:module-boundary`'s `sql` predicate, which resolves every bridge
  table to its owner out of the DDL — feature 077, D-87). Channel membership stays one
  authoritative, auditable path — mirroring how Principle I routes all cross-module access through
  explicit interfaces.
- **Evaluation snapshots carry the channel.** Cart / pricing / promotion evaluation MUST include
  the cart's resolved channel in its snapshot and reject records whose channel binding excludes it.
  Channel eligibility is part of the decision, not an afterthought applied later.
- **Cross-channel tests.** Every channel-scoped read or evaluation MUST ship tests proving
  out-of-channel content does not surface, and that a null / unresolved channel fails closed.
- **Interim manual scoping is bounded.** Until a unified sales-channel resolver exists, channel
  scoping MAY be enforced by explicit per-service predicates — but they MUST fail closed and MUST
  go through the sanctioned accessor. Once the unified resolver lands, features MUST build on it
  rather than reintroducing ad-hoc `if (channelCode)` guards (the same relationship Principle XI
  has with the feature `050` tenant guard).

**Rationale**: The `052-scoping-hotfixes` audit found channel isolation depending on optional,
fail-open predicates. A promotion bound to one channel applied to carts in another — a live
pricing / money bug — because `applyToCart` never checked the channel binding. PDP related /
cross-sell / up-sell products leaked across channels whenever the `x-sales-channel` header was
absent, because the visibility filter ran only `if (channelCode)` and otherwise returned the full
target set. Org tenancy already has a data-layer guard (Principle XI); channel scoping does not
yet, so the discipline MUST be explicit and structural in spirit: **always resolve a channel, fail
closed, and read membership only through the one sanctioned accessor.** Encoding this stops the
next feature from re-opening the same leaks and fixes the contract the future unified resolver
will absorb — the point fixes become calls into that resolver, not rework.

### XIII. Uniform Write Auditing via Command Bus (NON-NEGOTIABLE)

Sensitive writes MUST be audited by a **framework-level command path**, not by hand-placed
audit calls. The platform's audit substrate (`audit_log_entries`, carrying actor, action,
object identity, and before/after state) already models everything auditing and undo need; the
failure mode is discipline, not data — the audit writer was invoked by hand at ~70 scattered
call sites, so coverage was inconsistent, before/after was captured ad-hoc, and no revert path
existed anywhere. The following are binding for every backend feature that performs a
**sensitive mutation** (a create / update / delete of a domain record):

- **Single audited write path.** A sensitive mutation MUST run as a named **Command** through
  the Command Bus, which is the **single, guaranteed writer** of its audit entry. Services in
  migrated modules MUST NOT call the audit writer directly — the bus records audit for them. A
  Command carries a stable dot-namespaced action, the target object type + id, the actor, and
  before/after state.
- **Co-transactional audit + event + write.** The domain write, exactly one audit entry, and
  any domain-event emission MUST commit or roll back as **one unit**: a committed Command
  records exactly one audit entry and dispatches its event exactly once; a rolled-back Command
  records no audit entry and emits no event. Audit MUST be written **inside** the command's
  transaction, never as a separate flush that can orphan.
- **Server-derived actor (composes with XI).** A Command's actor MUST be drawn from the ambient
  TenantContext (admin id, impersonation pair, or system) — **never** from a request body,
  query, or header. The bus MUST run on the scoped EM so the Principle XI tenant guard applies
  to command reads/writes and the audit insert, and MUST fail closed with no ambient context.
  Background / worker Commands cross scope only through the sanctioned `withSystemScope` /
  `withOrgScope` escape hatch.
- **No double-audit; no silent regression.** Converting a write to a Command MUST remove its
  prior hand-written audit call **in the same change**. A CI coverage check MUST flag a
  sensitive mutation that neither runs through a registered Command nor records an audit entry,
  and MUST flag a write that both runs a Command and still audits by hand.
- **Opt-in reversibility, safe undo.** A Command MAY declare itself reversible by capturing
  per-record pre-state; **only** reversible Commands expose an operator-facing undo. Undo MUST
  restore the captured pre-state, be **all-or-nothing per record with a conflict report** (never
  a silent clobber of a record changed since the operation), be idempotent-safe on
  re-invocation, and be **itself an audited action linked** to the operation it reverses.
  Irreversible side effects (emails sent, payment captured, cascade deletes) MUST NOT be offered
  undo.
- **Thin layer.** The Command Bus MUST wrap existing services and the existing audit + event
  infrastructure — **no CQRS, no separate read model, no bespoke command queue, no speculative
  redo** (Principle IV). Reversible bulk operations reuse the durable queue path (Principle X);
  large undos run through the separable worker entrypoint, never inline.
- **Incremental migration is bounded.** Rollout is module by module, starting with the
  highest-regret writes (bulk operations, catalog, pricing, credit limits). An un-migrated
  module MAY retain hand-written audit calls, but each such write MUST still audit; the coverage
  check runs report-only until a module is migrated, then build-breaking for that module. From
  this amendment forward, **new** sensitive writes MUST be expressed as Commands rather than
  reintroducing hand-placed audit calls (the same relationship Principle XI has with the feature
  `050` tenant guard and Principle XII with the channel accessor).

**Rationale**: About 70 hand-written audit calls made auditability depend on developer memory —
some mutations audited, some did not; before/after was captured inconsistently; and nothing
could be undone, so a wrong bulk edit across hundreds of products (the platform's highest-regret
write) had no recovery path. Routing sensitive writes through a Command converts "remember to
audit" into "audited by construction," exactly as Principle XI converted "remember to scope"
into a structural guard. Because the Command owns the write, the audit entry, and the domain
event within one transaction, the three can no longer disagree — a rolled-back write cannot leak
an orphan audit row or a phantom event, and a committed one cannot silently skip either. The
same before/after capture that makes auditing uniform is precisely what undo needs, so
reversibility falls out of the audit discipline rather than being a separate mechanism. The bus
is deliberately thin (Principle IV): it reuses the existing audit writer, the transactional
event bus, and the tenant-scoped EM, adding no new dependency. It is introduced by feature
`054-command-bus-audit-undo`; from this amendment forward, new features build on it rather than
reintroducing scattered audit calls.

### XIV. Entity-Agnostic Extensibility & Runtime Custom Fields

A capability that spans multiple host entity types MUST be built as an **entity-agnostic core**
whose host-specific behavior lives behind documented extension points — never absorbed into the
core; and a generic layer that generalizes an existing entity-specific mechanism MUST leave that
mechanism the untouched source of truth for its own entity. The following are binding for every
feature that adds a cross-cutting / generic capability or extends core entities with
runtime-defined data:

- **Generic core stays entity-agnostic.** A module providing a cross-cutting capability over
  several host entity types MUST NOT embed any host-specific concern (a catalog flag like
  variant-axis or filter-position, an order status, a channel rule) in its core schema or logic.
  Host-specific behavior is exposed **only** through a documented extension point — an opaque
  config the host module interprets, or a host-registered adapter — that the generic core stores
  but never reads for meaning. A CI / review check MUST confirm the generic core carries no
  entity-specific capability identifier.
- **Generalize the design, not the code.** When a new generic layer generalizes an existing
  entity-specific system (e.g. `product_attributes`), that system MUST remain the untouched
  **source of truth** for its own entity. The generic layer MUST NOT migrate, duplicate, or break
  it; reuse its **design** (typed definitions, per-locale labels with default fallback, option
  lists for select types), not its code. Any later convergence is an **adapter**, not a rewrite.
- **Runtime extension is data, not DDL.** Where operators must add fields to core entities at
  deployment time, adding / editing / removing a field MUST be a **data** change (a definition
  row), never a schema migration or code deploy. Extension values MUST be validated on every write
  against their definition, MUST reject **per field** on violation (wrong type, missing required,
  unknown option, out of range), and MUST **inherit the host record's tenant scope** (Principle XI)
  by construction — never widening visibility. Definition / option mutations are themselves
  sensitive writes and run through the Command Bus (Principle XIII).
- **Host owns its data; the generic layer owns definitions + validation.** The generic layer MUST
  NOT write into host tables or audit host writes: the host persists its own record and (per
  Principle XIII) audits its own write, calling the generic layer only to validate incoming values
  and to read definitions. This keeps module boundaries intact (Principle I) and prevents
  double-auditing (Principle XIII).
- **Extensibility is not a mandate to over-configure.** Principle IV still governs *whether* a
  given field is a first-class column or a runtime custom field; this principle governs *how* a
  runtime-defined field behaves once that choice is made. Do not make everything runtime-configurable
  to avoid a migration you should simply write.

**Rationale**: The platform's entity set grows and clients need to extend core entities
(Organization, Order, Customer, Category, QuoteRequest) at deployment time without a code change.
The failure mode this principle prevents is already visible in the codebase: `product_attributes`
began as a clean typed-definition registry and accreted catalog-only flags (`isVariantAxis`,
`isPromoRule`, `filterPosition`, `isVisibleOnProductPage`, `channelScoped`) until it was no longer
reusable as a generic mechanism. The next generic capability that reaches for it must either inherit
that entanglement or build fresh — and the temptation is to bolt the *next* entity's specifics onto
whatever generic core exists first, repeating the rot. Codifying "generic cores stay entity-agnostic,
host specifics live behind extension points, generalizing never breaks the system it generalizes, and
runtime extension is validated tenant-scoped data" keeps cross-cutting capabilities from decaying into
god-modules and keeps the specific systems they generalize stable. It composes with the existing
guards rather than adding a new mechanism: values are host columns, so tenant isolation (XI) holds for
free; definition writes are Commands, so auditing (XIII) holds by construction; host interaction is via
service / interface, so modularity (I) holds. Introduced by feature `055-custom-fields-layer`.

### XV. Untouched Core & Per-Deployment Overlay

The platform is a **multi-deployment** product — one codebase, many client installations. A
per-deployment customization MUST be delivered through a **per-deployment overlay location**
whose files shadow or extend their core equivalents, resolved deterministically at
build/composition time — **never** by editing a file under the core modules tree and never by
forking. The following are binding for every feature that customizes a deployment or ships a
capability meant to be per-deployment overridable:

- **Untouched, deployment-agnostic core.** Core modules MUST contain no client-specific logic,
  and the **bare-core build** (no overlay) MUST keep working unchanged. Client-specific behavior
  MUST live in the overlay, not in a core edit or a fork. A change that puts a deployment's
  specifics into core, or that forks a core file to customize it, is prohibited — the overlay is
  the one sanctioned customization seam (the same "one authoritative path" discipline Principle I
  applies to cross-module calls).
- **Deterministic, build-time resolution.** Overrides MUST resolve at **build/composition time**,
  not at runtime: an overlay unit shadows its core equivalent by convention and every consumer
  resolves to the overlay implementation for that deployment. Resolution MUST be **deterministic**
  — identical inputs (core + a given overlay) MUST produce identical resolution and an identical
  override manifest, with no timestamps, machine paths, or ordering nondeterminism.
- **Contract-gated overrides; drift fails the build.** A core unit that may be overridden MUST
  expose a **documented interface**, and an overlay replacing it MUST satisfy that interface,
  **checked at build time**. A mismatch MUST fail the build — there is no silent divergence, and
  contract drift (core changes the interface, the overlay does not) surfaces as a build failure,
  never a per-deployment runtime surprise.
- **No silent conflict; unknown targets fail closed.** Two overlays targeting the **same** core
  unit MUST NOT resolve by silent last-wins — the build MUST fail (or apply one **documented,
  explicit** precedence rule). An overlay whose target core unit does not exist (a stale or
  mistyped target) MUST fail the build, never be silently ignored.
- **Auditable divergence.** Every build MUST emit an **override manifest** enumerating each active
  override and the core unit it targets, so a reviewer or operator can see exactly how a deployment
  diverges from core. The manifest is a committed, deterministic build artifact (mirroring the
  generated module index), not a runtime lookup.
- **Overlays are ordinary participants, under the same guards.** An overlay MUST be able to add a
  client-only module (routes, permissions, lifecycle participation) **without** editing the shared
  core module registry or shared composition root. Overlay modules are ordinary module-lifecycle
  participants (install / uninstall / reconcile), MUST register their permissions and pass the
  permission-inventory check **per deployment**, and MUST run under the same tenant-isolation guard
  (Principle XI), sales-channel scoping (Principle XII), and Command-Bus auditing (Principle XIII)
  as core — an override swaps an **implementation**, never a guard seam.
- **Bounded overridable surface (YAGNI).** The overridable surface is **services, routes, config,
  and whole new modules**; schema / entity / migration overrides of existing core units are **out
  of scope** until a deployment actually demands them (a deployment needing new schema ships it as a
  client-only overlay module that owns its own tables). Resolution MUST be a build/composition-time
  concern on the **existing toolchain** — no new runtime dependency (Principle IV).

**Rationale**: The product is confirmed multi-deployment, but modules are wired by a
hand-maintained static registry plus manual composition, and there is no overlay directory or
override-resolution layer. The only way to customize a client installation was therefore to **edit
core files or fork** — which does not scale across many deployments and re-creates the divergent-
fork problem (every installation drifts, merges become painful, the shared core destabilizes).
Codifying "untouched deployment-agnostic core + deterministic build-time overlay resolution +
contract-gated overrides + auditable divergence" converts per-client customization from an
ad-hoc core edit into a **structural, deterministic, reviewable** layer — the same move Principle
XI made for tenant scoping, XII for channel scoping, and XIII for write auditing (turn
"remember not to touch core" into a guarded seam that fails closed). Making overrides contract-
gated means core can evolve without silently breaking a deployment: drift is caught at build time.
The layer is deliberately additive and thin — it composes with the module lifecycle and the
existing guards rather than replacing them (an override runs under the same tenant / channel /
audit guards as the code it replaces), reuses the existing filesystem-scan + codegen pattern, and
adds no runtime dependency. The bounded v1 surface (services / routes / config / new modules,
schema deferred) keeps the mechanism minimal until a real deployment need justifies more.
Introduced by feature `057-overlay-pattern-multideploy`.

### XVI. Module Discoverability in the Admin Command Palette

A module that ships an admin surface MUST make itself **discoverable through the admin command
palette** (⌘K / CTRL+K), declared in its **own manifest** — never only through the sidebar and
never by an operator having to know the URL. The following are binding for every module with at
least one admin route:

- **Every admin module declares palette entries.** The module manifest MUST declare an
  `actions:` entry for its **primary landing surface** (its "open X" navigation entry) plus the
  **few highest-value operator actions** for that module — the things an operator does often
  enough to want a keystroke (e.g. "New credential configuration", "Import products"). Palette
  entries are declared **by the module that owns them**, so adding a module never means editing a
  shared, hand-maintained palette list — the same registry discipline Principle I applies to module
  wiring and Principle XV to overlay registration.
- **Curated, not exhaustive.** This is a discovery surface, not a sitemap. A module MUST NOT
  enumerate every route it owns; declare the landing surface and the operator actions that earn
  their place. Principle IV governs the count — when in doubt, fewer.
- **Permission-gated.** Every entry MUST carry the permission code that gates the surface it
  routes to, so the palette shows an operator only what they may actually reach. An ungated entry
  that navigates into a `requireAdmin(...)` surface is a defect: it advertises a capability the
  operator does not have and turns discovery into a 403.
- **Labels resolve in every supported language.** Entry labels and descriptions MUST come from the
  module's **own translation bundle** (Principle VIII's scope), MUST resolve in **every supported
  admin language**, and MUST be covered by an automated check. A palette entry rendering a raw
  translation key is a defect, not a cosmetic issue — and because bundle installation is
  load-and-skip-on-error, a malformed bundle fails **silently**, so the check MUST verify the real
  on-disk bundles rather than trusting that boot logged nothing.
- **Entries point at live routes.** Every `targetRoute` MUST resolve to a real admin route. A
  module MUST NOT ship an entry for a route that does not exist, nor leave an entry behind when its
  route is removed — a dead palette entry is worse than no entry.

**Rationale**: Module surfaces are useless if operators cannot find them, and this platform has
many modules. The command palette is the one authoritative discovery mechanism, and the mechanism
already exists — manifest-declared actions, a boot-time reconciler, a `module_actions` table, and a
permission filter (feature `020-admin-search-actions`). What was missing was the *obligation* to use
it, so discoverability drifted per module: `credentials` shipped with no palette presence at all,
and `google_analytics` / `newsletter` declared correct actions whose labels rendered as raw keys
because their translation bundles were the wrong shape and failed to install with only a log line.
Both failures are invisible to every existing gate — the routes work, the types check, the tests
pass — which is exactly the kind of drift a constitutional principle exists to stop. Making the
palette contract binding costs a module roughly ten lines of manifest and four translation keys,
and it composes with the guards already in place rather than adding a mechanism: entries carry the
same permission codes `requireAdmin` enforces, labels live in the same per-module bundles Principle
VIII governs, and overlay modules (Principle XV) declare their entries the same way core modules
do. Introduced after the `credentials` / `google_analytics` / `newsletter` palette regressions.

### XVII. Operator-Toggleable Modules & Disabled-Means-Absent (NON-NEGOTIABLE)

Principle I makes modules detachable in the codebase; this principle makes them detachable **at
runtime, by a business operator, without a deploy**. Every module MUST be switchable on and off from
a platform-owned admin surface, and a module that is off MUST behave as though it were **never
installed** —
across business logic, the API, the Admin UI and the Storefront UI alike. The following are binding
for every module:

- **Two orthogonal axes, one effective state.** Whether a module is present is decided by **two
  independent states with different owners**, and they MUST NOT be collapsed into one:
  - **Platform availability** — the module lifecycle registry's installed / enabled state (feature
    `018`, `module_registrations`). Owned by whoever operates the **deployment**, changed through
    the lifecycle path (CLI / deployment tooling). It answers *"is this module's code installed,
    migrated and wired in this deployment?"*
  - **Operator activation** — the module's own on/off Setting, stored in the platform's settings
    store and flipped from a platform-owned admin surface. Owned by the **business operator**,
    changed from the Admin UI. It answers *"does this client want to use this capability?"*

  A module is **effectively present only when both are true**. Every gating seam — routes, workers,
  subscribers, interceptors, cross-module calls, Admin UI, Storefront — MUST resolve this
  **effective** state, never one axis alone, and MUST fail closed when either axis is off or
  unresolved.
- **Neither axis overwrites the other.** Toggling activation MUST NOT mutate the lifecycle registry,
  and a lifecycle disable → enable cycle (maintenance, incident, redeploy, upgrade) MUST **preserve
  the operator's activation choice** rather than silently switching the capability back on. An
  operator who deactivated a module MUST find it still deactivated after platform-level work; a
  platform operator who disabled a module MUST NOT have that decision undone by a Settings write.
- **One toggle, on a surface no module owns, declared by the module.** Every module MUST expose
  exactly **one** activation control, rendered on a **platform-owned admin surface** — one served
  by the kernel and belonging to no module (today: the platform modules screen). It MUST NOT be
  hosted by any module's own admin surface: a module that owns the surface where activation is
  flipped can be switched off and take the control that would switch it back on with it, and the
  resulting circle can only be patched with a flag rather than removed. The control MUST be
  declared by the owning module (its manifest), never by adding a row to a shared hand-maintained
  list — the same registry discipline Principle XVI applies to palette entries and Principle XV to
  overlay registration. An operator MUST be able to reach it without CLI access. Overlay modules
  (Principle XV) declare their control exactly as core modules do. Flipping it is a sensitive write
  (Principle XIII: a Command, audited, actor from the ambient TenantContext) and MUST take effect in
  **every running process** — API instances and separable workers (Principle X) — without a
  redeploy.
- **The two axes read differently to an operator.** The Admin UI MUST NOT present a
  platform-unavailable module as merely "switched off". A module that is **installed but
  deactivated** shows an actionable control the operator can switch back on. A module that is
  **not available at platform level** MUST either not appear at all (never installed in this
  deployment) or appear as **blocked with the reason stated** — never as a control that looks
  actionable and silently fails.
- **Off means absent on all four surfaces.** A module that is not effectively present MUST NOT be
  observable as an installed capability:
  - **Business logic** — its services, event subscribers, queue consumers, scheduled jobs, API
    interceptors and command handlers MUST NOT run. A cross-module caller MUST receive the explicit
    module-disabled error, never a silently degraded or half-executed call.
  - **API** — every route the module owns MUST reject with the platform's documented
    module-disabled response. Gating MUST happen at the **route-registration seam** (the module
    route wrapper), so it holds for every route the module owns, including ones added later — never
    as a per-handler condition an author can forget.
  - **Admin UI** — no sidebar entry, no command-palette action (Principle XVI), no dashboard widget,
    no tab, no nav link, and no settings group of its own.
  - **Storefront UI** — no rendered blocks, sections, nav entries, or any other element the module
    contributes.
  Absence MUST be **resolved from the effective state at runtime** — both frontends read the
  effective enabled-set from the server and hide accordingly. Hard-coding a module's surfaces as
  conditionally-present in the frontends is not compliance.
- **The single exception: its own activation control.** The **only** thing that MAY remain visible
  for a deactivated module is its own on/off control on the platform-owned surface, so an operator
  can turn it back on. Because that surface belongs to no module, the exception is **structural**
  rather than a carve-out an implementation has to remember: nothing of the module's own surface
  survives its deactivation. A module that is off but leaves anything else visible — one sidebar link, one palette action,
  one storefront block, one configurable field — violates this principle. In particular, a
  deactivated module's **own configuration surface MUST NOT be editable**; only its activation is.
- **Off is not uninstall: non-destructive and reversible.** Deactivating MUST NOT drop tables,
  delete rows, remove translation bundles, unregister permissions, revert migrations, or discard the
  module's configuration; that is what hard uninstall is for. Reactivating MUST restore the module's
  full surface with its data and settings intact, with no manual repair step.
- **Non-deactivatable modules are declared, never special-cased.** A module the platform cannot
  function without MUST declare itself non-deactivatable **in its own manifest**, and its control
  MUST render as **locked with a stated reason** — never silently absent, and never
  present-but-ignored. The set MUST be minimal and justified: a module belongs in it only if
  switching it off would leave the platform unable to authenticate an operator, resolve tenancy, or
  switch anything back on (authentication, admin identity, the permission catalogue and tenancy —
  the modules whose absence makes the platform unusable rather than reduced). The set MUST NOT
  include a module that is only load-bearing because of **where a screen lives**; that is a layout
  problem, and it is fixed by moving the screen. The declaration MUST also be enforced on the
  platform axis, not only in the Admin UI — a declaration nothing checks reads as done. Hard-coding
  an exception list in the admin app instead of declaring it per module is prohibited.
- **Dependencies fail closed.** Switching off a module that effectively-present modules depend on
  (per manifest `dependencies`, transitively) MUST be **refused with the blocking dependents
  named**, and switching one on whose dependencies are off MUST be refused or require an explicit,
  confirmed cascade. The platform MUST NOT come to rest in a state where a present module depends on
  an absent one. This holds on both axes and across them — an activated module whose platform
  availability is gone is absent, not half-working.
- **No implicit fall-open on either axis.** A gating seam MUST resolve both states explicitly. A
  module with no registration row MUST be reconciled to an **explicit** platform state at boot, and
  a module with no stored activation value MUST resolve to its **manifest-declared default**, rather
  than either being treated as on by the absence of a record. "On" is always something the platform
  asserted, never something it assumed.
- **Structural coverage, CI-enforced, with tests.** Every module MUST route its HTTP surface, its
  queue consumers and its event subscriptions through the platform's module-gating wrappers; a CI
  check MUST fail the build for a module that ships routes, workers or subscribers which bypass
  them. Every module MUST ship an **off-state test** proving its API rejects, its admin surface is
  absent, its configuration is not editable and its storefront contribution is absent while it is
  off — and that switching it back on restores all of them. Coverage MUST include the
  **deactivated-while-platform-available** case specifically, since that is the axis an operator
  actually drives.

**Rationale**: A modular platform whose modules cannot actually be turned off is modular only on
paper. The driving case is an integration a client simply does not want: the Ergonode PIM module
(`pim_ergonode`) is installed, migrated and wired, but this client does not use Ergonode. They must
be able to switch it off from the Admin UI and have it *gone* — out of the sidebar, its
synchronisation not running, its API not answering — without anyone touching a deployment. Today the
only way to remove a capability is to not deploy the code, which contradicts the
one-codebase-many-deployments posture Principle XV establishes.

**Why two axes rather than one.** "Installed in this deployment" and "wanted by this client" are
different questions, with different owners and different lifetimes, and collapsing them into a
single flag breaks both. If the Settings toggle were merely a view over the lifecycle registry, then
every platform-level disable → enable cycle — maintenance, an incident, an upgrade, a redeploy —
would silently reactivate a capability the business had deliberately switched off, and the operator
would discover it by finding Ergonode syncing again. Conversely a business-level write would be able
to override a platform operator's deliberate lockout. Two states, one **effective** result computed
as their conjunction, keeps each decision owned by the person who made it and makes the composition
fail closed: whichever axis says "off" wins, and neither erases the other's intent. It also gives
the Admin UI something honest to render — "installed but switched off, here is the switch" is a
different message from "not available in this deployment," and conflating them produces a control
that looks actionable and silently does nothing.

The machinery for the platform axis already exists: feature `018-module-lifecycle` built
`module_registrations`, the registry cache, and the `defineModuleRoutes` / `defineModuleWorker` /
`subscribeForModule` / `requireModuleEnabled` wrappers. What it did not build was the operator axis,
an obligation to gate, or any frontend awareness — and the half-adopted result is *worse than no
toggle*: only 10 of 67 backend modules gate their routes, the sidebar, the command palette and the
storefront resolve nothing from the enabled-set, and enable/disable is CLI-only because the admin
write surface was explicitly deferred. A module switched off therefore reads as off while its
sidebar entry, its palette actions and its storefront blocks keep working and most of its API keeps
answering. That is precisely the drift a constitutional principle exists to stop, and it is a
correctness and security concern, not a cosmetic one: a surface an operator believes they switched
off is a surface nobody is watching, and a synchronisation nobody believes is running is a
synchronisation nobody is auditing. The four-surface rule names every place the illusion currently
leaks, and resolving it from the effective state converts "the module is off somewhere" into "the
module is gone."

The carve-outs keep the rule from being a foot-gun: without declared non-deactivatable modules an
operator can switch off authentication or tenancy and lose the platform, and without fail-closed
dependency handling switching off one module silently breaks its dependents. The related hazard —
switching off the module that *hosts* the controls and losing the way back — is not on that list,
because it is answered by structure instead: the control renders on a surface no module owns, so
there is no circle for a declaration to patch. Off stays
non-destructive — data *and* configuration survive — so the toggle is a safe, reversible business
decision rather than a data-loss risk; hard uninstall remains the destructive path. The principle
composes with the guards already in place instead of adding a mechanism: the activation write is a
Command (Principle XIII), workers pause through the separable entrypoint (Principle X), palette
entries vanish through the same manifest declarations (Principle XVI), and overlay modules
participate identically (Principle XV).

## Technology Stack

The following stack is mandated. Substitutions require amending this
constitution.

| Concern                 | Required                     | Conditional Fallback                            |
|-------------------------|------------------------------|-------------------------------------------------|
| Language                | TypeScript (strict)          | —                                               |
| Backend runtime         | Node.js, minimal libraries   | —                                               |
| ORM                     | MikroORM                     | —                                               |
| Primary database        | PostgreSQL                   | —                                               |
| Cache                   | Redis                        | —                                               |
| Queue                   | Redis (BullMQ-class)         | RabbitMQ — only if Redis is demonstrably        |
|                         |                              | insufficient (documented, benchmark-backed)     |
| Search engine           | Meilisearch                  | OpenSearch — only if Meilisearch cannot meet    |
|                         |                              | a stated business requirement (documented)      |
| Form/input validation   | Zod                          | —                                               |
| Storefront framework    | Next.js                      | Another SSR/SSG-capable framework may be        |
|                         |                              | chosen only with equivalent SEO guarantees      |
|                         |                              | (documented per Principle VII)                  |
| Admin framework         | React (SPA or Next.js)       | —                                               |

**Fallback discipline**: choosing a fallback is an amendment-worthy decision.
It requires a short written record (1–2 paragraphs) in the relevant feature
plan explaining the unmet requirement, the measurement that established the
gap, and the operational cost accepted.

## Monorepo Structure & Application Boundaries

The repository MUST be organized as a **monorepo** and MUST be split into
three top-level applications plus shared packages:

- `backend/` — Node.js + TypeScript API server, owner of all modules,
  migrations, and business logic.
- `storefront/` — Next.js customer-facing website (catalog, search, quote
  requests, checkout).
- `admin/` — Admin dashboard for internal operators.
- `packages/` (or equivalent) — shared TypeScript packages (e.g. Zod schemas
  shared across applications, API client types, UI primitives). Cross-cutting
  code MUST live here rather than being duplicated.

The three applications MUST be independently buildable, testable, and
deployable. No application MAY import another application's internals;
sharing happens only through `packages/` and through the HTTP API.

## Documentation Requirements

Two documentation artifacts are mandated for the project to be considered
shippable:

1. **`README.md`** at the repository root. It MUST contain everything a
   newcomer needs to run the project in **development** and **production**
   environments. It MUST include, at minimum: prerequisites, install steps,
   environment variables, how to run each application, how to run the test
   suite, how to run migrations, and a **Hardware & System Requirements**
   section listing both **minimum** and **recommended** specs for
   development and production on a single VPS. The README MUST be updated
   in the same PR as:
   - the addition of any new backend module,
   - any change that alters how the project is started in development or
     production (new service, new env var, new migration step, new external
     dependency),
   - the addition of any new runtime technology or library that changes
     system requirements.

2. **Project Documentation Site** — a generated, browsable documentation
   site readable by **both** a programmer (enough detail to extend a
   module) **and** a Product Owner / end user (enough clarity to
   understand how to use a module and the system overall). The site MUST
   be buildable from the repository and MUST be kept in sync with module
   changes. Authoring approach (Markdown in-repo, Docusaurus, Nextra,
   etc.) is a plan-level decision; the mandate is the artifact, not the
   tool.

The Project Documentation Site MUST be authored in English per Principle VIII.
The README MAY be authored in any language; only its inline comments inside
fenced code blocks fall under the source-comment rule.

## Performance & Scale Targets

The platform is sized for the following workload and MUST be designed to
meet it without architectural rewrites:

- **Catalog volume**: up to the order of hundreds of thousands of products
  including variants.
- **Quote requests (RFQ)**: on the order of hundreds of inquiries per month.
- **Orders**: on the order of tens of orders per day and hundreds per
  month.
- **Storefront latency**: meet Core Web Vitals "Good" thresholds
  (see Principle VII).
- **Search**: product search queries MUST return in < 200 ms p95 for typical
  catalog sizes; full re-index MUST fit within an off-hours maintenance
  window.

Any proposed design that cannot demonstrably meet these targets MUST be
flagged in the Constitution Check of the relevant plan.

## Infrastructure Constraints

The solution MUST be runnable on a **single VPS** that satisfies the
minimum system requirements of every mandated technology (PostgreSQL,
Redis, Meilisearch, Node.js runtimes for three apps). The published
minimum/recommended requirements in the README MUST stay accurate: when a
new library or runtime is introduced that changes baseline memory, CPU,
or disk expectations, the README MUST be updated in the same PR.

Containerization (e.g. Docker / Docker Compose for development) is
RECOMMENDED as the default local-environment contract; production
deployment technique is an operational choice, not a constitutional one.

## Development Workflow & Quality Gates

Every change MUST pass the following sixteen gates before merge:

1. **Constitution Check** — the `/speckit.plan` Constitution Check block
   MUST be completed and MUST show no unjustified violations.
2. **Tests** — all new backend modules MUST include unit, contract, and
   integration tests (Principle III). The full test suite MUST pass in CI.
3. **Type check & lint** — `tsc --noEmit` and the project linter MUST pass
   with zero errors in every affected app/package.
4. **Naming conventions** — reviewers MUST reject any PR that violates
   Principle VI.
5. **Working language** — reviewers MUST reject any PR that introduces
   non-English **comments inside source files** or non-English **prose
   on a `/docs/` Docusaurus page**, in violation of Principle VIII.
   Identifiers, string literals, specs, plans, READMEs, commit
   messages, and code-review prose are not constrained by this gate.
6. **Docs sync** — if a module is added or an infrastructure-relevant
   change is made, the PR MUST update `README.md` and the documentation
   site in the same commit range.
7. **Dependency justification** — any new runtime dependency MUST carry a
   one-paragraph rationale in the PR description (Principle IV).
8. **UI reuse** — reviewers MUST reject any net-new frontend component or
   layout that duplicates an existing Admin UI / Storefront UI primitive
   without a stated UX justification (Principle IX).
9. **Async queue consumers** — reviewers MUST reject any queue-backed
   asynchronous operation that violates Principle X's invariant: jobs MUST use a
   durable queue with atomic claim + idempotent handlers (safe at N ≥ 2
   instances), the producer MUST NOT inline-execute the job, and the consumer
   MUST be a separable worker entrypoint — never a `setInterval` sweeper draining
   the queue inside the API process. Running the worker as a separate process is
   the production default; co-locating low-volume work is allowed only with a
   one-sentence justification (Principle X).
10. **Multi-tenant isolation** — reviewers MUST reject any change that violates
    Principle XI: a new tenant-owned entity that is not classified and covered by the
    framework guard + cross-tenant tests; a query path that reaches tenant-owned data
    outside the ambient TenantContext filter; a fail-open on missing context; or any
    cross-tenant access that does not go through the audited `withSystemScope` /
    `withOrgScope` escape hatch. The tenant context MUST be server-derived, never taken
    from request body/query/headers.
11. **Sales-channel scoping** — reviewers MUST reject any change that violates Principle XII:
    a channel-scoped read or commercial evaluation that returns the full cross-channel set when
    no explicit channel is present (fail-open), a null / unresolved channel that matches a
    channel-bound record, a module that queries a `sales_channel_*` bridge directly instead of the
    channel-membership service (`check:module-boundary` must pass, and its `sql:` ledger must not
    grow), or a channel-scoped path
    that ships without cross-channel tests (out-of-channel content hidden + null-channel fails
    closed).
12. **Uniform write auditing** — reviewers MUST reject any change that violates Principle XIII:
    a sensitive mutation in a migrated module that hand-writes an audit call instead of running
    through the Command Bus; a converted write that double-audits (Command **and** a manual audit
    call for the same action); a Command whose actor is taken from the request rather than the
    ambient TenantContext; an audit / event / write that is not co-transactional (an orphan audit
    row or event on rollback, or a missing/duplicate entry on commit); or a reversible operation
    whose undo can partially clobber a record changed since (undo MUST be all-or-nothing per
    record with a conflict report, idempotent-safe, and itself audited). The command coverage
    check MUST pass for migrated modules.
13. **Entity-agnostic extensibility** — reviewers MUST reject any change that violates Principle
    XIV: a cross-cutting / generic core that embeds an entity-specific concern instead of exposing
    it through a documented host extension point; a generalization that migrates, duplicates, or
    breaks the entity-specific system it generalizes (rather than leaving it the source of truth,
    converging later via an adapter); a runtime-extensible field mechanism that requires a schema
    migration or code deploy to add a field, skips per-write validation against the definition, or
    lets extension values widen past the host record's tenant scope; or a generic layer that writes
    into / audits host tables instead of letting the host own persistence + audit. Definition /
    option mutations MUST run through the Command Bus (Principle XIII).
14. **Per-deployment overlay customization** — reviewers MUST reject any change that violates
    Principle XV: a client-specific behavior added by editing a file under the core modules tree or
    by forking core instead of through the per-deployment overlay location; a core edit that makes a
    core module deployment-specific or breaks the bare-core build; an override that resolves at
    runtime or nondeterministically instead of at build/composition time with an identical override
    manifest for identical inputs; a service override that is not gated by a documented core
    interface checked at build time (contract drift MUST fail the build); two overlays targeting one
    core unit resolving by silent last-wins, or a stale/unknown override target that is silently
    ignored rather than failing the build; a build that ships without emitting the override manifest;
    an overlay module added by editing the shared core registry, or one that skips permission
    registration / the per-deployment permission-inventory check, or that bypasses the tenant (XI),
    channel (XII), or Command-Bus (XIII) guards; or a schema / entity / migration override of an
    existing core unit (out of scope) rather than a client-only overlay module owning its own tables.
15. **Command-palette discoverability** — reviewers MUST reject any change that violates Principle
    XVI: a module that ships an admin surface but declares no palette entry in its own manifest (or
    is reachable only from the sidebar); a palette entry added to a shared hand-maintained list
    instead of the owning module's manifest; an entry that omits the permission code gating the
    surface it routes to; an entry whose label or description does not resolve in every supported
    admin language, or whose module translation bundle is not covered by the automated on-disk
    bundle check; or an entry pointing at a route that does not exist (including one left behind
    when its route was removed). Exhaustive route dumps are a violation too — declare the landing
    surface plus the operator actions that earn a keystroke (Principle IV).
16. **Module enable/disable completeness** — reviewers MUST reject any change that violates
    Principle XVII: a gating seam that resolves only one of the two axes (platform availability from
    the lifecycle registry, operator activation from the module's declared control) instead of the effective
    conjunction, or that fails open when either is off or unresolved; an activation write that
    mutates the lifecycle registry, or a lifecycle disable → enable cycle that discards the
    operator's activation choice (neither axis may overwrite the other); a module that ships without
    exactly one activation control on the platform-owned admin surface, whose control is hosted by
    a module's own admin surface, or whose control is registered in a shared hand-maintained list
    instead of the owning module's manifest; an activation transition
    that is not an audited Command (Principle XIII) taking effect across API and worker processes
    without a redeploy; an Admin UI that renders a platform-unavailable module as merely "switched
    off" rather than absent or blocked-with-a-reason; a module that is off yet remains observable on
    any of the four surfaces — running services / subscribers / consumers / interceptors, an
    answering route, an Admin UI sidebar entry, palette action, widget or settings group, an editable
    configuration surface, or a Storefront element — with its own activation control the single
    permitted exception; a frontend that hard-codes a module's surfaces instead of resolving the
    effective enabled-set from the server; an off path that destroys data, configuration, bundles,
    permissions or schema (that is hard uninstall) or that cannot be reversed by switching back on;
    a non-deactivatable module hard-coded in the admin app rather than declared in its manifest with
    a stated reason, or declared without justification; an operation that leaves a present module
    depending on an absent one (blocking dependents MUST be named and the operation refused, and
    switching on against absent dependencies MUST be refused or an explicit confirmed cascade); a
    gating seam that treats a missing registration row or a missing activation value as "on" instead
    of resolving an explicit state / the manifest default; or a module whose routes, workers or event
    subscriptions bypass the platform's gating wrappers, or that ships without an off-state test
    covering API rejection, admin absence, non-editable configuration, storefront absence and
    restoration — including the deactivated-while-platform-available case.

Code review MUST explicitly verify each of the above. "LGTM" without
evidence of checking the gates is not an approval.

## Governance

This constitution supersedes all other engineering practices, style
guides, and informal conventions in this repository. Where another
document conflicts with this constitution, the constitution wins until
the conflicting document is reconciled.

**Amendment procedure**:

1. Open a PR modifying `.specify/memory/constitution.md` with the proposed
   change, a rationale, and a Sync Impact Report.
2. Identify and update every dependent template (`plan-template.md`,
   `spec-template.md`, `tasks-template.md`, command files) in the same PR.
3. Update the version number per the versioning policy below.
4. Amendments require approval from the project's code owners; changes
   that affect external-facing behavior (API shape, infra minimums)
   additionally require Product Owner sign-off.

**Versioning policy** (semantic versioning applied to governance):

- **MAJOR** — backward-incompatible removal or redefinition of a principle
  or governance rule, or a change that invalidates prior compliant work.
- **MINOR** — a new principle or section is added, or existing guidance is
  materially expanded.
- **PATCH** — wording clarifications, typo fixes, non-semantic refinements.

**Compliance review**: at least once per quarter, a maintainer MUST audit
a random sample of merged PRs for constitution compliance and file
corrective issues for any drift.

**Runtime guidance**: day-to-day engineering guidance that does not rise
to constitutional weight lives in `README.md` and the generated project
documentation site.

**Version**: 4.0.2 | **Ratified**: 2026-04-23 | **Last Amended**: 2026-09-03
