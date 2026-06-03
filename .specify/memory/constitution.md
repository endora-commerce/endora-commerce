<!--
SYNC IMPACT REPORT
==================
Version change: 3.1.0 → 3.2.0
Rationale: MINOR bump. A new principle (X. Scalable Queue Consumers)
is added, and a corresponding ninth quality gate is introduced in
the Development Workflow section. No existing principle is removed,
narrowed, or redefined; the new rule applies to new and ongoing
work going forward, so the versioning policy mandates a MINOR (not
MAJOR) bump. Pre-existing in-process queue drains predate the rule
and are tracked as compliance-review follow-ups rather than treated
as retroactively invalidated.

Modified principles:
  - (none renamed or redefined)

Added sections:
  - X. Scalable Queue Consumers — new principle. Any asynchronous
    operation backed by a queue MUST be processed by a dedicated
    consumer process that is deployable and horizontally scalable
    independently of the API server; the API process MUST only
    enqueue, never drain. Jobs MUST be claimed atomically and
    handlers MUST be idempotent so N≥2 consumer instances never
    double-process. In-process sweepers/timers are not a permitted
    production processing path.
  - Development Workflow & Quality Gates — new gate #9 ("Async queue
    consumers") enforcing Principle X at review time.

Removed sections:
  - (none)

Templates / artifacts requiring alignment:
  - ✅ .specify/templates/plan-template.md      — references Constitution
       Check generically; no edits required.
  - ✅ .specify/templates/spec-template.md      — no edits required.
  - ✅ .specify/templates/tasks-template.md     — no edits required.
  - ✅ README.md — principle quick-reference list extended with
       item 10 (scalable queue consumers); quality-gate sentence updated.
  - ✅ .github/pull_request_template.md — new gate #9 checkbox added;
       header comment updated from "eight" to "nine" gates.

Deferred items / TODOs:
  - Existing in-process queue drains predate Principle X and are now
    non-compliant: the catalog bulk-operation sweeper
    (catalog/plugin.ts `setInterval` + `onEnqueued` kick draining the
    `bulk_operations` table), and the analogous price-lists status
    sweeper, RFQ-expiry worker, and cart-abandonment sweep. These MUST
    be migrated to separate, independently scalable consumer processes
    (or have a documented single-instance exemption recorded) and are
    tracked via the quarterly compliance review — not a blocker for
    this amendment.
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

Any asynchronous operation that relies on a queue MUST be processed by a
dedicated **consumer process** that is deployable and scalable independently of
the API server. The component that enqueues work (an HTTP handler, an event
subscriber, a scheduler) is the **producer**: it MUST only enqueue and return —
it MUST NOT also drain or execute the job inside the API/web process. Queue
processing MUST run as a separate worker entrypoint — its own process, started
by its own command, independently restartable and independently scalable —
backed by the mandated queue substrate (Redis / BullMQ-class per the Technology
Stack).

Consumers MUST be safe to run as **N ≥ 2 concurrent instances**: every job MUST
be claimed atomically (or otherwise exclusively locked) so horizontal scaling
never double-processes a job, and handlers MUST be idempotent with respect to
redelivery and retries. Long-running or bursty asynchronous work — bulk edits,
imports/exports, re-indexing, notification fan-out, webhook delivery — MUST flow
through this path so it can be scaled out and isolated from request latency.

In-process timers or sweepers that drain a queue inside the API process (e.g. a
`setInterval` loop in the web server) are NOT a permitted production processing
path for queue-backed asynchronous work: they couple processing to the API's
lifecycle, cannot be scaled horizontally, and contend with request handling.
They MAY be used only as a test harness or as an explicitly documented,
single-instance development convenience — never as the deployed consumer. A
synchronous operation that genuinely does not need a queue is out of scope for
this principle (do not introduce a queue speculatively — see Principle IV); but
once an operation is asynchronous and queue-backed, this principle is binding.

**Rationale**: Asynchronous work exists precisely because it is too slow, too
bursty, or too failure-prone to run inline. Pinning that work to the API process
throws away the main benefit — the ability to add consumer instances when the
backlog grows, to fail and retry in isolation, and to keep p95 request latency
flat under load. A separate, horizontally scalable consumer is the difference
between a queue that absorbs a 50k-product bulk edit and one that takes the
storefront down with it. Atomic claiming and idempotency are the non-negotiable
cost of safely running more than one consumer.

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
   asynchronous operation whose jobs are drained inside the API/web process
   (e.g. an in-process `setInterval` sweeper) instead of a separate,
   independently scalable consumer process, or whose handlers are not safe to
   run across N ≥ 2 consumer instances (atomic claim + idempotent) (Principle X).

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

**Version**: 3.2.0 | **Ratified**: 2026-04-23 | **Last Amended**: 2026-06-03
