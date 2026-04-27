<!--
SYNC IMPACT REPORT
==================
Version change: 1.1.1 → 2.0.0
Rationale: MAJOR bump. Principle VIII is materially redefined: the
English-only requirement now applies ONLY to source code (identifiers,
inline string literals that are not user-facing) and inline code comments.
Documentation artifacts — specs, plans, tasks, research notes,
data-model, contracts, quickstart, README, the docs site, governance
documents, commit messages, PR titles + descriptions, code-review
comments, issue templates, CI labels — MAY now be authored in any
language the team chooses. Past compliant work (everything authored in
English) remains compliant; the redefinition only loosens the rule, but
the principle's normative scope is substantively narrower than v1.1.1,
hence MAJOR.

Modified principles:
  - VIII. Working Language — English (NON-NEGOTIABLE)
        scope shrunk from "every engineering artifact" to "code +
        code comments". Sub-sections rewritten; cross-reference to
        Principle VII (multilingual storefront) preserved.

Added sections:
  - (none)

Removed sections:
  - (none)

Templates / artifacts requiring alignment:
  - ✅ .specify/templates/plan-template.md      — references Constitution
       Check generically; no edits required.
  - ✅ .specify/templates/spec-template.md      — no edits required.
  - ✅ .specify/templates/tasks-template.md     — no edits required.
  - ⚠ scripts/check-language.sh — currently encodes the v1.1.1 broader
       scope (scans every file outside the i18n exception paths). With
       the v2.0.0 scope it MUST limit its scan to source-code files
       (.ts, .tsx, .js, .jsx, .css, .html, etc.) and SHOULD NOT scan
       Markdown, YAML, JSON, SQL, plain text, or commit messages. Flagged
       as a follow-up commit.
  - ⚠ README.md "Constitution quick reference" line for Principle VIII
       — the current wording reflects v1.1.1's "every engineering
       artifact" framing and SHOULD be updated to the new scope
       ("code + code comments"). Flagged as a follow-up commit.
  - ⚠ .github/pull_request_template.md gate #5 — the wording "code,
       comments, commit messages, and PR description are English"
       SHOULD be narrowed to "code and code comments are English".
       Flagged as a follow-up commit.

Deferred items / TODOs:
  - TODO(SCRIPT_RESCOPE): Update `scripts/check-language.sh` to scan
    only source-code file extensions and to drop the commit-message
    walker.
  - TODO(README_RESCOPE): Update README's Principle VIII line.
  - TODO(PR_TEMPLATE_RESCOPE): Update gate #5 in
    .github/pull_request_template.md.
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

The English-only requirement applies to **source code and inline code
comments**. Everything else — documentation, planning artifacts, governance
documents, commit messages, code-review comments — MAY be authored in any
language the team chooses.

**In scope (MUST be English)**:

- All in-code identifiers: variable, function, class, type, file, and folder
  names; database tables, columns, and constraint names; API field names
  and URL path segments.
- Inline code comments and docstrings inside source files
  (`*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.cjs`, `*.mjs`, `*.css`, `*.html`,
  shell scripts, and equivalents).
- Inline string literals that are NOT user-facing (e.g. internal log
  messages, error codes, route definitions, migration SQL).

**Out of scope (MAY be in any language)**:

- Specifications (`spec.md`), implementation plans (`plan.md`), task lists
  (`tasks.md`), research notes (`research.md`), data models (`data-model.md`),
  interface contracts (`contracts/`), quickstart guides (`quickstart.md`),
  validation reports.
- The root `README.md`, every other Markdown file, and the generated
  project documentation site.
- The constitution itself and any other governance documents.
- Commit messages, pull-request titles and descriptions, code-review
  comments, issue templates, CI/CD configuration labels.
- All localized end-customer content — storefront copy, admin UI labels,
  notification emails, CMS pages, locale-specific seed fixtures simulating
  customer content. This category is also governed by the localization
  mechanism required by Principle VII; translation keys and message
  identifiers used by that mechanism MUST still be English (because they
  are code identifiers).
- Foreign-language proper nouns inside any artifact (e.g. *Comarch Optima*,
  *Subiekt GT*, *enova365*, *Symfonia*, regulatory terms like *NIP*).

**Rationale for keeping code in English**: Source code is the single
artifact every contributor, every code reviewer, every linter, every
LLM-assisted tool, and every stack trace touches. English is the working
language of the entire ecosystem the platform depends on (Node.js,
MikroORM, PostgreSQL, Meilisearch documentation; GitHub; LLM tooling;
error messages from the runtime). Keeping identifiers and inline comments
in one language preserves grep-ability, code-review fluency, and
LLM-assisted refactoring across a team that spans multiple human
languages.

**Rationale for loosening the prose scope**: Documentation, planning, and
review prose are read primarily by people, not tooling. A team whose
working language is not English is better served by writing planning
artifacts in their own language than by translating every spec into
English at the cost of nuance and review speed. The product also remains
free to speak whatever customer-facing languages the business requires.

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

Both artifacts MUST be authored in English per Principle VIII.

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
   non-English artifacts, identifiers, comments, or commit messages in
   violation of Principle VIII, aside from the scope exceptions listed
   in that principle.
6. **Docs sync** — if a module is added or an infrastructure-relevant
   change is made, the PR MUST update `README.md` and the documentation
   site in the same commit range.
7. **Dependency justification** — any new runtime dependency MUST carry a
   one-paragraph rationale in the PR description (Principle IV).

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

**Version**: 2.0.0 | **Ratified**: 2026-04-23 | **Last Amended**: 2026-04-26
