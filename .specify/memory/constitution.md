<!--
SYNC IMPACT REPORT
==================
Version change: 3.6.0 → 3.7.0
Rationale: MINOR bump. A new principle — XIV (Entity-Agnostic Extensibility &
Runtime Custom Fields) — is added, codifying the architectural stance from the
055-custom-fields-layer feature. A capability spanning multiple host entity
types MUST be built as an entity-agnostic core whose host-specific behavior
lives behind documented extension points, and a generic layer that generalizes
an existing entity-specific mechanism (e.g. `product_attributes`) MUST leave
that mechanism the untouched source of truth (reuse the design, not the code;
any convergence is an adapter, not a rewrite). Runtime extension of core
entities MUST be data (a definition row), never a schema migration or code
deploy, with per-write validation and host-inherited tenant scope; the host
owns persistence + audit while the generic layer owns definitions + validation.
The principle prevents the observed rot where `product_attributes` accreted
catalog-only flags until it was no longer reusable. A new principle is added
(not a redefinition or removal), so the versioning policy mandates a MINOR bump.

Modified principles:
  - (none renamed/redefined)

Added sections:
  - XIV. Entity-Agnostic Extensibility & Runtime Custom Fields — new principle.
  - Quality gate #13 (Entity-agnostic extensibility) in Development Workflow.

Removed sections:
  - (none)

Templates / artifacts requiring alignment:
  - ✅ .specify/templates/plan-template.md      — Constitution Check is
       generic; no edits required.
  - ✅ .specify/templates/spec-template.md      — no edits required.
  - ✅ .specify/templates/tasks-template.md     — no edits required.
  - ✅ README.md — added Principle XIV quick-reference note (point 14) and
       extended the PR-gates paragraph.
  - ✅ .github/pull_request_template.md — added gate #13 (entity-agnostic
       extensibility) and refreshed the gate-count comment.

Deferred items / TODOs:
  - Principle XIV composes with the existing guards rather than introducing a
    new migration: values are host columns (tenant scope XI holds for free),
    definition writes are Commands (auditing XIII holds by construction), host
    interaction is via service/interface (modularity I holds). Product stays on
    `product_attributes` as its source of truth; a generic bridge, if ever
    built, is an adapter (out of the initial custom-fields scope).

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
  directly (enforced by the `no-unscoped-channel-query` lint rule). Channel membership stays one
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

Every change MUST pass the following gates before merge:

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
    channel-membership service (`no-unscoped-channel-query` must pass), or a channel-scoped path
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

**Version**: 3.7.0 | **Ratified**: 2026-04-23 | **Last Amended**: 2026-07-18
