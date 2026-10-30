# Endora Commerce (b2b-platform) — Agent Instructions

Last updated: 2026-10-29

**This file is the single source of truth for every AI coding agent working in this
repository, and since 2026-09-11 it is a *router*.** It holds what an agent needs before its
first tool call, whatever it was sent to do — the stack, the repo map, the commands, the binding
principles, the traps that make a green result meaningless — and a table saying which document
to open for the thing you are actually about to do. `CLAUDE.md` and
`.cursor/rules/specify-rules.mdc` are thin pointers to it; tools with no import mechanism read it
directly and open a routed document themselves.

**Relocation is not duplication.** A rule has **one** full statement. This file may carry the
*operation* — a command to run, a thing not to do — and route to the document that carries the
measurement, the alternatives rejected and the failure it was written from. It must never carry
a second full statement of a rule that lives elsewhere, and a routed document must never push
its rule back up here. `backend/test/unit/docs/agents-router.test.ts` holds the structure: one
home, one pointer, every pointer resolving, no routed subject re-appearing here as a heading,
and a ceiling on this file's body — extract to a routed document rather than raise it.

## Stack

- **`backend/`** — TypeScript 5.x strict on Node.js ≥ 22.17. Fastify, MikroORM (PostgreSQL),
  Zod, ioredis, BullMQ, Meilisearch, `nodemailer`, `pdfmake`. The kernel, the HTTP layer, the
  in-process `EventBus`, the Command Bus, TenantContext, the module lifecycle and the
  cross-cutting migrations are **not** in `backend/src` — they are `@endora-commerce/platform`.
  What `backend/src` keeps is the application: the composition roots, the generated registries,
  the manifest-registry binding, and one entry point per `module:*` command.
- **`admin/`** — React 19 + Vite + react-router-dom 7 + `lucide-react` + Tailwind 4 +
  Radix/shadcn primitives; `@puckeditor/core` for the CMS/e-mail builders; `@dnd-kit` for
  drag-drop; charts through the `<EChart>` wrapper
  (`admin/src/components/charts/echart.tsx`). The router and every host screen are
  `@endora-commerce/admin-shell`; the design system is `@endora-commerce/admin-kit`.
- **`storefront/`** — Next.js 15 App Router + React 19 + Tailwind v4, Server Components and
  server actions.
- **`packages/`** — **do not write the list down** (D-100): `ls packages` answers it, and
  `pnpm-workspace.yaml` says which globs reach it. `@endora-commerce/contracts` holds the Zod
  schemas that are the source of truth for every API shape; **`packages/platform`** is the host
  package (feature 080), whose `exports` map declares a subpath per source directory while only
  **five** of them are barrels a module may name — `check:platform-surface` reports the rest as
  `host-internal-subpath`.
- Every package resolves at its own `./dist` (D-164), so **`pnpm run build:packages` is a
  precondition for running anything** — tests, `dev`, both frontend builds — while `tsc` stays
  on source through `tsconfig.base.json`'s `paths`. Edit a package, build that package, restart
  the loop; the routed *Building the packages* document carries why.

## Repo map

| Path | Contents |
| --- | --- |
| `packages/modules/<id>/` | **Every** domain module — `backend/src/modules/` holds nothing but a `README.md`, so a specifier pointing into it resolves to nothing. Layout: `src/manifest.ts`, `src/backend/` (composition in `index.ts`, plus `entities/`, `services/`, `routes.ts`, optional `plugin.ts`, `actions/`, `workers/`), `src/migrations/`, optional `src/ports/`, optional `src/admin/`. **`i18n/` and `docs/` sit at the *package root* beside `src/`, not under it.** There is **no `test/` directory**: tests sit beside their subjects as `*.test.ts`, and that is normative (`specs/106-module-owned-tests/contracts/module-test-ownership.md` §2) |
| `backend/src/apps/<deployment>/modules/<id>/` | Per-deployment overlay modules (feature 057) |
| `backend/test/{unit,contract,integration,perf}/` | Backend tests, mirroring module names |
| `specs/NNN-slug/` | Feature artifacts: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `tasks.md` |
| `specs/conventions/` | The bodies this file routes to — see *Where the rest of it lives* |
| `specs/*.md`, `specs/b2b-platform-*-ui/` | Standing non-feature documents that outlive any one feature; `deferred-defects.md` states the precedent in its own opening lines |
| `.specify/memory/constitution.md` | Binding principles — read before designing anything |
| `docs/` | Docusaurus site (end-user and engineer documentation, **English + Polish** user-facing; manual i18n workflow in `docs/docs/contributing/documentation-i18n.md`) |

## Commands

```bash
pnpm run build:packages                  # FIRST, after any install and after editing a package
pnpm -r run typecheck                    # or: pnpm --filter <app> run typecheck
pnpm -r run lint
pnpm --filter backend run test:unit:fast # FAST: test/unit minus its service-dependent
                                         # files, plus backend/src's co-located tests —
                                         # no Postgres, no Redis, no Meilisearch
pnpm --filter backend exec vitest run <path>   # targeted run — prefer this while iterating
pnpm --filter backend run test           # COMPLETE: unit + contract + integration, needs
                                         # all three services; ~50 min at 6 workers with
                                         # TEST_DATABASE_URL on `pnpm run dev:infra:test`
pnpm --filter '!backend' run test        # every OTHER workspace member's suite — the
                                         # packages included; nothing above reaches them
pnpm run dev                             # full dev stack; pnpm run dev:infra for docker services
pnpm run setup                           # db:fresh THEN module:install --all: the
                                         # only sequence that runs every installHook.
                                         # db:fresh alone leaves a boot-first database,
                                         # whose hooks `install` then reports as done
pnpm run check:naming && pnpm run check:language
```

**Standing a `git worktree` up: one command, and never a symlinked `node_modules`**
(issue #255).

```bash
git worktree add ../wt-<slug> -b <branch> origin/master
bash ../wt-<slug>/scripts/setup-worktree.sh          # pnpm install --frozen-lockfile, ~4 s
```

Branch off `origin/master`, never the local `master`, which goes stale in the main checkout. A
`node_modules` pointed at another checkout executes that checkout's code while `tsc` compiles
this one's; `pnpm ls` cannot see it, so **do not use it to check this**. `setup-worktree.sh
--link` exists only for a worktree on a different filesystem from the pnpm store. The routed
*Which backend test command to use* document carries the measurement.

## Binding principles

Full text in `.specify/memory/constitution.md` — this is the working summary, not a
replacement. Non-negotiable ones are marked **(NN)**.

- **I. Modular architecture (NN)** — a module owns its entities, services, routes,
  migrations, i18n and tests. Cross-module interaction goes through exported services or the
  `EventBus`; never import another module's internals. Design every module so it can be
  detached.
- **II. API-first** — define the shape as a Zod schema in `packages/contracts/` first;
  breaking changes are versioned.
- **III. TDD (NN)** — failing test first, then implementation. Every functional requirement
  traces to a test.
- **IV. YAGNI & minimal dependencies** — the default answer is "no new dependency"; a new
  runtime dependency needs written justification in the feature plan's Complexity Tracking
  section.
- **V. TypeScript everywhere** / **VI. Naming conventions (NN)** / **VIII. English-only
  working language (NN)** — code, comments, identifiers, specs, docs and commit messages.
- **VII. SEO, performance & discoverability** — storefront pages stay SSR/SSG-capable.
- **IX. UI reuse** — reuse the admin design system and existing primitives before adding new
  ones.
- **X. Scalable queue consumers** — long-running or repeatable work follows the existing
  BullMQ worker pattern (e.g. `quote_requests/rfq-expiry-worker.ts`).
- **XI. Multi-tenant isolation (NN)** — the Organization is the one tenant concept; every
  transacting customer has one (B2C gets a personal org). Tenant-scoped entities pass through
  the global-filter guard in the platform's `tenancy/` (`@endora-commerce/platform/tenancy`).
  A design with a "no-organization" path is invalid.
- **XII. Sales-channel content scoping (NN)** — channel-scoped reads go through the resolved
  request channel and the sanctioned bridge accessors, not hand-rolled queries.
- **XIII. Uniform write auditing via Command Bus (NN)** — admin/domain writes run through
  `CommandBus.run` so auditing and undo stay uniform.
- **XIV. Entity-agnostic extensibility** — runtime custom fields instead of bespoke columns
  where the requirement is "add a field".
- **XV. Untouched core & per-deployment overlay** — a deployment customises through an overlay
  module, never by editing core.
- **XVI. Module discoverability in the command palette** — every module with an admin surface
  is reachable under ⌘K / CTRL+K; sidebar-only is not enough.
- **XVII. Operator-toggleable modules (NN)** — presence is the conjunction of **two
  orthogonal axes**, platform availability (deployment-owned, CLI) and operator activation
  (business-owned, on the kernel-served `/platform/modules` screen); neither overwrites the
  other. A module that is off behaves as if never installed — business logic, API, Admin UI and
  Storefront — its own activation control excepted. Off is non-destructive and reversible;
  non-deactivatable modules declare that in their manifest; dependencies fail closed.

The last three carry checklists you must follow. They are in the table below, not here.

## Where the rest of it lives

Each row is a body of rules with exactly **one** home and exactly **one** pointer — this one.
Open the document when the *When* column describes what you are about to do; do not work from a
memory of it. A citation written elsewhere in the tree as `AGENTS.md § <name>` resolves through
the *Subject* column, which keeps the section names this file used to carry.

| When | Subject | Read |
| --- | --- | --- |
| Composing a module — registering services, publishing or resolving a port, declaring a lifecycle edge, wiring routes/workers/subscribers, writing an install hook | Composition | `specs/conventions/module-composition.md` |
| Adding or changing an admin permission code, a `requireAdmin(...)` gate, a command-palette action or an AppShell nav entry | Admin permissions, Command palette | `specs/conventions/module-admin-surfaces.md` |
| Gating anything on a module's presence — routes, workers, subscribers, timers, boot hooks, cross-module calls, admin or storefront surfaces — or writing an off-state test | Module enable/disable | `specs/conventions/module-activation.md` |
| Writing a migration, adding an `@Entity()` class, or wondering which number to use (there is none) | Migrations | `specs/conventions/module-migrations.md` |
| Writing or moving a module's documentation page | Documentation | `specs/conventions/module-documentation.md` |
| Shipping any user-facing string, or deciding whether the backend or the consumer translates it | i18n | `specs/conventions/module-i18n.md` |
| Adding or changing a `check-*` script, re-recording a read size, or meeting a check's obligations | Static checks and their escape hatches | `specs/conventions/check-estate.md` |
| A check has reported against you, or you want to know whether a rule has an instrument | The full inventory | `specs/conventions/check-inventory.md` |
| Changing anything a package publishes, or cutting a release | Release intent — changesets | `specs/conventions/release-intent.md` |
| Judging whether something may be published, or reviewing a file, a changeset body or a commit message against the disclosure gate | Commercial data | `specs/conventions/commercial-data.md` |
| Writing or changing anything under `backend/src/apps/<deployment>/` | Overlay modules | `specs/conventions/overlay-modules.md` |
| Changing how a price is stored, resolved, displayed, sorted, indexed or cached, or specifying anything that touches price lists | Pricing | `specs/conventions/pricing.md` |
| Touching a package's build configuration, or a type-check and a test run disagreeing about a file | Building the packages | `specs/conventions/building-packages.md` |
| Running or changing anything in `backend/test/`, or a suite result needing to mean something | Which backend test command to use | `specs/conventions/backend-test-suite.md` |

Do not add an index file inside `specs/conventions/` — `ls` answers what is there (D-100).
Deeper architectural explanation, the published third-party-facing kind, is the Docusaurus
site's: `docs/docs/architecture/kernel.md`, `migrations.md`, `permissions.md`,
`overlay-pattern.md` and `customisation-ladder.md`. The documents above are the operational
layer and cite them; they do not replace them.

## The traps that make a green result meaningless

Every one of these has already produced an answer that looked right and was not. They are here
rather than in a routed document because each catches an agent who was not trying to do the
thing it is about.

- **A merge-request pipeline does not create `test:backend`.** Owner ruling **D-198**
  (2026-09-03) took the `merge_request_event` clause off every rung of `.backend-test-rules`, so
  the contract and integration suites do not run before a merge — they run on `master`,
  afterwards, for whoever runs next. `only_allow_merge_if_pipeline_succeeds` is not the lever.
  D-198 is a suspension, and the condition for restoring the clause is written beside it.
- **Deleting a file? Grep `backend/test/**` for it before you finish, and do not trust
  `test:unit:fast`.** It skips the contract and integration trees entirely — where a test that
  *spawns* a deleted script, or imports a deleted module's path, fails with
  `ERR_MODULE_NOT_FOUND` rather than with anything a type-check or a `check-*` script can see.
  Tests have sat red across 29 and 50 merges this way.
- **A ledger derived *about* the files you changed is not a file you changed.**
  `test/unit/kernel/module-removal.test.ts` holds a two-way residue ledger, so moving a module
  reds it the moment that module's last reference goes — and a batch runs its targeted tests
  over the paths it *touched*, which never include that file, because moving a module does not
  edit it. **The batch that frees an entry is structurally the batch that cannot see it go
  stale.** So after a change that moves or deletes anything, ask what is **derived** from its
  location, not only what **names** it, and re-derive that in the same merge request.
- **Changing how many files the tree holds moves a recorded read size**, whether or not you went
  anywhere near the check estate — and inside the band that is **left alone**: the release pull
  request re-records drift, not yours. Re-record only an entry the band refuses or one your change
  means to move; then re-measure, never compute from a delta, never widen a band, and read the
  routed *Static checks and their escape hatches* document **first** — three traps there have each
  put a number into the shared record that no clean tree can reproduce.
- **A generated artefact left stale is a silent defect, not a crash.** `composer:generate` and
  `manifests:generate` write the registries the platform composes from; an unregistered
  migration simply does not run, and an unrendered package manifest fails
  `pnpm install --frozen-lockfile`, which is the *first* thing every CI job does. Regenerate and
  commit in the same merge request, and run `pnpm install --lockfile-only` beside
  `manifests:generate`.

## Working agreement

- **Verify before reporting done**: `typecheck` + `lint` + the targeted tests for what you
  touched. Report failures with their output; never hide them. **"What you touched" includes
  the packages**, not only `backend`, `admin` and `storefront`: a package's failure that is not
  a type error is reachable only through `pnpm --filter '!backend' run test`.
- **Read before writing** — the module you are changing, the closest prior feature's spec
  directory, the relevant contracts, and the routed document for what you are about to do.
  **After the cut line (D-247), the closest prior feature directory may be one you cannot
  open**: pre-migration `specs/NNN-slug/` stays in the private historical repository and reaches
  you only as a citation. Leave such a citation in place, as provenance; a change is judged
  against `specs/conventions/` and the constitution, both of which travel.
- **Commits**: never add `Co-Authored-By: Claude` or any other AI/LLM trailer. Deliver through a
  merge request from a branch — never commit straight to `master`.
- **Do not touch**: generated files, another module's migrations, or the auto-generated
  appendix at the bottom of this file.

Specs written before 2026-07-31 refer to the routed module checklists as "the CLAUDE.md
new-module rules" — the same rules; they have moved twice since.

## Feature workflow (speckit)

New features follow the speckit flow: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks`
→ `/speckit.implement`, producing `specs/NNN-slug/`. `/speckit.plan` regenerates the appendix
at the bottom of this file through `.specify/scripts/bash/update-agent-context.sh`, which is
pinned to write into this file only.

**A feature number is not unique, so cite the slug.** Nothing refuses a collision, and how many
there are is not written here (D-100) — derive it:

```bash
ls -d specs/[0-9]* | sed 's|specs/||; s/-.*//' | sort | uniq -d
```

A bare *"feature 075"* therefore addresses two directories, and so does every number that
command prints. Write `specs/075-cross-module-decoupling-sweep/` where the reference has to
survive a reader who was not in the conversation, and keep the bare number only for prose that
names the slug nearby. **This is a rule about citing, not about numbering**: do not renumber
existing directories, but do avoid a **new** collision on a number that active work is citing.

## Subagents

Role-specialised subagents are defined **once per tool**, with identical roles — Claude Code in
`.claude/agents/*.md`, Cursor in `.cursor/agents/*.md`, Codex in `.codex/agents/*.toml`
(`ls -d .claude/agents .cursor/agents .codex/agents`; do not write the count down). Their
prompts stay short on purpose — repository conventions live in this file and the documents it
routes to, not in the agent files.

| Agent | Use for |
| --- | --- |
| `endora-commerce-architect` | Designing features: specs, plans, module boundaries, data models |
| `endora-commerce-dev` | Implementing plans and fixing bugs, with tests |
| `endora-commerce-designer` | Designing and auditing UI: commerce surfaces (cart, checkout, PDP, PLP), admin screens, UX/accessibility reviews |
| `endora-commerce-product-owner` | Verifying business ↔ implementation consistency, spec/task audits, `docs/` |

## UX laws

`.claude/skills/ux-laws/SKILL.md` is the **single source of truth** for the UX rules applied to
every UI change — the Laws of UX (<https://lawsofux.com/>) rewritten as actionable frontend
rules, plus the WCAG 2.2 AA floor, the repo's design tokens and primitives, and the required
component states. Unlike the subagent prompts it is **not duplicated per tool**: the Cursor
agent reads that path directly, and where a tool insists on finding a skill under its own root
the answer is a **relative symlink** to this path (so it resolves inside a `git worktree`),
never a copy — `.agents/skills/ux-laws/SKILL.md` is one. Update it in place.

---

<!-- Everything below is appended automatically by speckit's update-agent-context.sh.
     It records only what § Stack does not: one item per feature that declared a new
     runtime, dev or workspace dependency, and the three most recent feature slugs. -->

## Active Technologies
- Baseline stack: see § Stack above.
- 072-module-kernel-di: One new runtime dependency: `awilix`
- 143-crm-sales-opportunities: one new runtime dependency: `@dnd-kit/core`, see Complexity Tracking
- 147-saved-views: `axe-core` added as an `admin` devDependency (test-only)
- 151-page-builder-translate: one new workspace library package `@endora-commerce/llm-client` (code moved from `prompt_actions`)

## Project Structure

See "Repo map" above.

## Recent Changes
- 166-asset-reference-visibility
- 167-storefront-locale-path
- 165-task-management
