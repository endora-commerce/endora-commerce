# Endora Commerce (b2b-platform) — Agent Instructions

Last updated: 2026-09-11

**This file is the single source of truth for every AI coding agent working in this
repository, and since 2026-09-11 it is a *router*.** What is below is what an agent needs
before its first tool call, whatever it was sent to do: the stack, the repo map, the commands,
the binding principles, the traps that make a green result meaningless — and a table saying
which document to open for the thing you are actually about to do. `CLAUDE.md` and
`.cursor/rules/specify-rules.mdc` are thin pointers to this file; Cursor, Codex, Amp and other
AGENTS.md-aware tools read it directly and open a routed document themselves, having no import
mechanism — the one real cost of this shape, accepted by the owner — while Claude Code reaches
this file through `CLAUDE.md`'s `@AGENTS.md` import.

**Relocation is not duplication, and the distinction is the whole design.** This file used to
say *"put shared knowledge here, never in a pointer"*, and it still means it — that rule was
written about **two statements of one rule drifting apart**, which is what happened to
`CLAUDE.md`, this file and `.cursor/rules/specify-rules.mdc` before 2026-07-31. A router moves a
rule to exactly one home and points at it once; it does not restate it. So: a rule has **one**
full statement. This file may carry the *operation* — a command to run, a thing not to do — and
route to the document that carries the measurement, the alternatives rejected and the failure it
was written from. What it must never carry is a second full statement of a rule that lives
elsewhere, and what a routed document must never do is push its rule back up here. Do not read
this restructuring as a licence to start copying rules into pointers.
`backend/test/unit/docs/agents-router.test.ts` holds the structure: one home, one pointer, every
pointer resolving, no routed subject re-appearing here as a heading, and a ceiling on this file.
The ceiling is the part that matters — a one-off tidy-up drifts back within a month, and the
measurement that motivated this one was 1936 lines and roughly 60 000 tokens of which two
sections were 64%, both of them reference consulted while doing a specific thing rather than
read start to finish, loaded into every session and every subagent a dozen times a day before
anybody did anything.

## Stack

- **`backend/`** — TypeScript 5.x strict on Node.js ≥ 22.17. Fastify, MikroORM (PostgreSQL),
  Zod, ioredis, BullMQ, Meilisearch, `nodemailer`, `pdfmake`. The kernel, the HTTP layer, the
  in-process `EventBus`, the Command Bus, TenantContext, the module lifecycle and the
  cross-cutting migrations are **not** in `backend/src` — they are `@endora-commerce/platform`.
  What `backend/src` keeps is the application: the composition roots, the generated registries,
  the manifest-registry binding, and one entry point per `module:*` command.
- **`admin/`** — React 19 + Vite + react-router-dom 7 + `lucide-react` + Tailwind 4 +
  Radix/shadcn primitives; `@measured/puck` for the CMS/e-mail builders; `@dnd-kit` for
  drag-drop; charts through the `<EChart>` wrapper
  (`admin/src/components/charts/echart.tsx`). The router and every host screen are
  `@endora-commerce/admin-shell`; the design system is `@endora-commerce/admin-kit`.
- **`storefront/`** — Next.js 15 App Router + React 19 + Tailwind v4, Server Components and
  server actions.
- **`packages/`** — **do not write the list down** (D-100). This row named a five-package set
  for months; one of those five, `api-client`, D-202 has since deleted, and several others had
  joined unnamed. `ls packages` answers it, and `pnpm-workspace.yaml` says which globs reach it.
  Three facts about that population are worth knowing because nothing else states them:
  `@endora-commerce/contracts` holds the Zod schemas that are the source of truth for every API
  shape; **`packages/platform`** is the host package (feature 080), whose `exports` map declares
  a subpath per source directory while only **five** of them are barrels a module may name —
  `check:platform-surface` reports the rest as `host-internal-subpath`; and
  **`packages/modules/<id>/`** is where **every** domain module lives, `backend/src/modules/`
  holding nothing but a `README.md`, so a specifier pointing into it resolves to nothing.
- Every package builds a real `dist` and resolves there through its own `exports` map (D-164),
  so **`pnpm run build:packages` is a precondition for running anything** — tests, `dev`, both
  frontend builds. `tsc` is the exception and stays on source through `tsconfig.base.json`'s
  `paths`. A stale `dist` therefore means the type-check and the test run are reading different
  files: edit a package, build that package, restart the loop.

**A new runtime dependency needs written justification** in the feature plan's Complexity
Tracking section (Constitution IV). The default answer is "no new dependency" — reuse what is
already in the stack.

## Repo map

| Path | Contents |
| --- | --- |
| `packages/modules/<id>/` | A domain module: `src/manifest.ts`, `src/backend/` (composition in `index.ts`, plus `entities/`, `services/`, `routes.ts`, optional `plugin.ts`, `actions/`, `workers/`), `src/migrations/`, optional `src/ports/`, optional `src/admin/`. **`i18n/` and `docs/` sit at the *package root* beside `src/`, not under it** — `bundlesDir` and `docs.dir` are joined to `dirname(manifestPath)`, which for a bare specifier is the directory holding the `package.json`. There is **no `test/` directory**: the tests sit beside their subjects as `*.test.ts` — `find packages/modules -path '*/src/*' -name '*.test.ts'` counts them and `ls -d packages/modules/*/test` answering nothing is the other half of the claim — and that is normative rather than incidental (`specs/106-module-owned-tests/contracts/module-test-ownership.md` §2) |
| `backend/src/apps/<deployment>/modules/<id>/` | Per-deployment overlay modules (feature 057) |
| `backend/test/{unit,contract,integration,perf}/` | Backend tests, mirroring module names |
| `specs/NNN-slug/` | Feature artifacts: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `tasks.md` |
| `specs/conventions/` | The bodies this file routes to — see *Where the rest of it lives* |
| `specs/*.md`, `specs/b2b-platform-*-ui/` | Standing non-feature documents that outlive any one feature; `deferred-defects.md` states the precedent in its own opening lines |
| `.specify/memory/constitution.md` | Binding principles — read before designing anything |
| `docs/` | Docusaurus site (end-user and engineer documentation, English only) |

## Commands

```bash
pnpm run build:packages                  # FIRST, after any install: every package
                                         # under packages/ resolves at ./dist
pnpm -r run typecheck                    # or: pnpm --filter <app> run typecheck
pnpm -r run lint
pnpm --filter backend run test:unit:fast # FAST: test/unit minus its service-dependent
                                         # files, plus the co-located src unit tests —
                                         # no Postgres, no Redis, no Meilisearch
pnpm --filter backend exec vitest run <path>   # targeted run — prefer this while iterating
pnpm --filter backend run test           # COMPLETE (~1 h): unit + contract + integration,
                                         # needs all three services running
pnpm --filter '!backend' run test        # every OTHER workspace member's suite — the
                                         # packages included; nothing above reaches them
pnpm run dev                             # full dev stack; pnpm run dev:infra for docker services
pnpm --filter backend run db:fresh       # rebuild the schema from migrations
pnpm run check:naming && pnpm run check:language
```

**Standing a `git worktree` up: one command, and never a symlinked `node_modules`**
(issue #255).

```bash
git worktree add ../wt-<slug> -b <branch> origin/master
bash ../wt-<slug>/scripts/setup-worktree.sh          # pnpm install --frozen-lockfile, ~4 s
```

Branch off `origin/master`, not `master`: the local ref goes stale in the main checkout, and
three branches once sat ninety commits behind because of it. Every `@endora-commerce/*`
specifier resolves through one **relative** symlink, so pointing a workspace's `node_modules` at
another checkout makes this run execute that checkout's code while `tsc`, protected by `paths`,
compiles this one's — one run type-checking one branch and executing another, which is worse
than either being wrong. `pnpm ls` answers from the manifest's `link:` declaration and never
looks at the symlink, so **do not use it to check this**. `setup-worktree.sh --link` exists only
for a worktree on a different filesystem from the pnpm store.

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
- **IV. YAGNI & minimal dependencies** — see the Stack note above.
- **V. TypeScript everywhere** / **VI. Naming conventions (NN)** / **VIII. English-only
  working language (NN)**.
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
  orthogonal axes**: platform availability (lifecycle registry, deployment-owned, CLI) and
  operator activation (a manifest-declared Setting, flipped on the kernel-served
  `/platform/modules` screen — a surface no module owns — business-owned, Admin UI). Neither
  overwrites the other. A module that is off behaves as if never installed — business logic,
  API, Admin UI and Storefront — its own activation control being the one exception. Off is
  non-destructive and reversible; non-deactivatable modules declare that in their manifest;
  dependencies fail closed.

The last three carry checklists you must follow. They are in the table below, not here.

## Where the rest of it lives

Each row is a body of rules with exactly **one** home and exactly **one** pointer — this one.
Open the document when the *When* column describes what you are about to do; do not work from a
memory of it, and do not copy any of it back into this file. A citation written elsewhere in the
tree as `AGENTS.md § <name>` resolves through the *Subject* column, which keeps the section
names this file used to carry.

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
| Writing or changing anything under `backend/src/apps/<deployment>/` | Overlay modules | `specs/conventions/overlay-modules.md` |
| Touching a package's build configuration, or a type-check and a test run disagreeing about a file | Building the packages | `specs/conventions/building-packages.md` |
| Running or changing anything in `backend/test/`, or a suite result needing to mean something | Which backend test command to use | `specs/conventions/backend-test-suite.md` |

There is deliberately no index file inside `specs/conventions/` — `ls` answers what is there,
and a second enumeration is the thing that goes stale (D-100). Deeper architectural
explanation, the published third-party-facing kind, is the Docusaurus site's rather than these
documents': `docs/docs/architecture/kernel.md`, `migrations.md`, `permissions.md`,
`overlay-pattern.md` and `customisation-ladder.md`. The documents above are the operational
layer and cite them; they do not replace them.

## The traps that make a green result meaningless

Every one of these has already produced an answer that looked right and was not. They are here
rather than in a routed document because each catches an agent who was not trying to do the
thing it is about.

- **A merge-request pipeline does not create `test:backend`.** Owner ruling **D-198**
  (2026-09-03) took the `merge_request_event` clause off every rung of `.backend-test-rules`, so
  the contract and integration suites do not run before a merge — they run on `master`,
  afterwards, for whoever runs next. `only_allow_merge_if_pipeline_succeeds` is not the lever
  and turning it on would have caught none of the three reds of 2026-09-04. D-198 calls itself a
  suspension rather than a design and the condition for restoring the clause is written beside
  it.
- **Deleting a file? Grep `backend/test/**` for it before you finish, and do not trust
  `test:unit:fast`.** That command is the one everybody runs locally and it skips the contract
  and integration trees entirely — where a test that *spawns* a deleted script, or imports a
  deleted module's path, fails with `ERR_MODULE_NOT_FOUND` rather than with anything a
  type-check or a `check-*` script can see. Measured three times on 2026-08-24: a contract test
  red across **29** merges, an integration test red across **50** while reporting a live product
  defect nobody read, and a suite deleted along with the two scripts it existed to exercise.
- **A ledger derived *about* the files you changed is not a file you changed.**
  `test/unit/kernel/module-removal.test.ts` holds a two-way residue ledger, so moving a module
  reds it the moment that module's last reference goes — and a batch runs its targeted tests
  over the paths it *touched*, which never include that file, because moving a module does not
  edit it. **The batch that frees an entry is structurally the batch that cannot see it go
  stale.** So after a change that moves or deletes anything, ask what is **derived** from its
  location, not only what **names** it, and re-derive that in the same merge request.
- **Changing how many files the tree holds moves a recorded read size**, whether or not you went
  anywhere near the check estate. Re-measure; never compute from a delta and never widen a band,
  and read the routed *Static checks and their escape hatches* document § *Measuring a read size*
  **first** — three traps there have each put a number into the shared record that no clean tree
  can reproduce, and none of them announces itself. (A path is written here once, in the routing
  table, and nowhere else: that is what stops a moved document leaving a wrong address behind.)
- **A generated artefact left stale is a silent defect, not a crash.** `composer:generate` and
  `manifests:generate` write the registries the platform composes from; an unregistered
  migration simply does not run, and an unrendered package manifest fails
  `pnpm install --frozen-lockfile`, which is the *first* thing every CI job does. Regenerate and
  commit in the same merge request, and run `pnpm install --lockfile-only` beside
  `manifests:generate`.

## Working agreement

- **Verify before reporting done**: `typecheck` + `lint` + the targeted tests for what you
  touched. Report failures with their output; never hide them. **"What you touched" includes
  the packages**: `backend`, `admin` and `storefront` are the three names that come to mind and
  they are not the population — `pnpm --filter '!backend' run test` is what runs the rest, and a
  package's failure that is not a type error is reachable by nothing else an author is told to
  run.
- **Read before writing** — the module you are changing, the closest prior feature's spec
  directory, the relevant contracts, and the routed document for what you are about to do.
- **English only** in code, comments, identifiers, specs, docs and commit messages
  (Principle VIII).
- **Commits**: never add `Co-Authored-By: Claude` or any other AI/LLM trailer. Branch off
  `origin/master` and deliver through a merge request — never commit straight to `master`.
- **Do not touch**: generated files, another module's migrations, or the auto-generated
  appendix at the bottom of this file.

Specs written before 2026-07-31 refer to the routed module checklists as "the CLAUDE.md
new-module rules" — the same rules; they have moved twice since.

## Feature workflow (speckit)

New features follow the speckit flow: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks`
→ `/speckit.implement`, producing `specs/NNN-slug/`.

**A feature number is not unique, so cite the slug.** A payment gateway and a platform feature
have landed on the same number many times over, and nothing refuses it. **How many, and which,
is not written here** — that sentence named ten and listed ten while the tree held eleven, a
count of a derived fact written down in the paragraph warning about exactly that (D-100).
Derive it instead:

```bash
ls -d specs/[0-9]* | sed 's|specs/||; s/-.*//' | sort | uniq -d
```

A bare *"feature 075"* therefore addresses two directories, and so does every number that
command prints. Context resolves today's citations; nothing guarantees the next one. Write
`specs/075-cross-module-decoupling-sweep/` where the reference has to survive a reader who was
not in the conversation, and keep the bare number only for prose that names the slug nearby.

**This is a rule about citing, not about numbering**, and deliberately so. Renumbering would
break every reference that currently resolves by context, to buy a uniqueness nothing depends
on. What *is* worth avoiding is a **new** collision on a number that active work is citing,
which makes those citations ambiguous from their first day. `/speckit.plan` regenerates the
appendix at the bottom of this file through `.specify/scripts/bash/update-agent-context.sh`,
which is pinned to write into this file only (see the repo-local override near the top of that
script) — that is what keeps `CLAUDE.md`, `.cursor/rules/specify-rules.mdc` and this file from
drifting apart again.

## Subagents

Role-specialised subagents are defined **once per tool**, with identical roles — Claude Code in
`.claude/agents/*.md`, Cursor in `.cursor/agents/*.md`, Codex in `.codex/agents/*.toml`. **How
many tools that is is not written here**: this sentence read *"defined twice"* until the Codex
set landed, which is a count of a derived fact going stale in the paragraph that has to stay
true as tools are added (D-100). `ls -d .claude/agents .cursor/agents .codex/agents` answers it.
Their prompts stay short on purpose — repository conventions live in this file and the documents
it routes to, not in the agent files.

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
agent reads that path directly, and where a tool insists on finding a skill under its own root the
answer is a **relative symlink** to this path, never a copy — `.agents/skills/ux-laws/SKILL.md` is
one. Relative, so it travels with the checkout and resolves inside a `git worktree` rather than
pointing at whichever tree it was created from; the same property issue #255 depends on for
`node_modules`. Update it in place; never fork a second copy.

---

<!-- Everything below is appended automatically by speckit's update-agent-context.sh.
     Treat it as an append-only log; prune it when it stops being useful. -->

## Active Technologies
- TypeScript 5.x (strict) on Node.js LTS ≥ 22.17; Fastify + MikroORM + Zod + ioredis + BullMQ (existing); no new runtime deps. (068-inpost-shipping)
- PostgreSQL via MikroORM — orders.shipping_adapter_data JSONB; Settings for inpost.* credentials. (068-inpost-shipping)
- TypeScript 5.x `strict`, Node.js ≥ 22.17 (backend + admin), ESM. (067-product-feed)
- PostgreSQL for feed configuration, taxonomy reference data, run history and issue records; (067-product-feed)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime (068-ergonode-pim-sync)
- PostgreSQL — 10 new tables owned by `pim_ergonode`, 1 new column on `catalog.categories` (068-ergonode-pim-sync)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 (admin); Next.js 15 App Router + React 19 (storefront). **No new runtime dependency** (Constitution IV, FR-062) (073-lifecycle-gating-completion)
- PostgreSQL. No new table. One new column-free path: activation values live in the existing `settings` rows (`global_value` / `default_value`); platform availability stays in `module_registrations` (073-lifecycle-gating-completion)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ. **One new runtime dependency: `awilix`** — see Complexity Tracking (072-module-kernel-di)
- PostgreSQL. No schema change of its own. Three entity relocations follow D-32: `audit_logs`' service and entity, the settings store, and the `sales_channels` resolution machinery move into the kernel package (072-module-kernel-di)
- TypeScript 5.x strict on Node.js ≥ 22.17 for Endora; PHP 8.2+ Symfony bundles for Akeneo PIM Community/Enterprise (self-hosted) + Existing Fastify, MikroORM, Zod, ioredis, BullMQ, React 19 and platform ports; Akeneo packages use the PIM’s Symfony/Composer stack and Storage events / Batch jobs; **no new runtime npm dependency** (094-akeneo-pim-sync)
- PostgreSQL for connection, delivery, delivered-record inbox, source/media links, protection, run and issue state; Redis/BullMQ for asynchronous apply and stale-run recovery; Akeneo-side outbox table in the PIM database (094-akeneo-pim-sync)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime (089-unopim-pim-sync)
- PostgreSQL — ~12 tables owned by `pim_unopim`, 0–2 small tables owned by `pim_connector` (089-unopim-pim-sync)
- TypeScript 5.x strict on Node.js >= 22.17 for Endora; PHP 8.2+ package code in the sibling `pim-integrations` workspace + Existing Fastify, MikroORM, Zod, ioredis, BullMQ, React 19 and platform ports; PHP uses the existing Pimcore/Symfony/Composer stack; **no new runtime dependency** (089-pimcore-pim-sync)
- PostgreSQL for connection, delivery, complete-record inbox, source/media links, protection, run and issue state; Redis/BullMQ for durable asynchronous apply and stale-run recovery (089-pimcore-pim-sync)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM; React 19 admin + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ, existing `CredentialsPort` — **no new runtime dependency** (feat/119-infakt-integration)
- PostgreSQL tables owned by `invoice_ledger` (lock, client maps, document maps, deliveries, webhook receipts). Credentials rows in the existing credentials module. No Infakt id column on `invoices`. (feat/119-infakt-integration)

- TypeScript 5.x strict on Node.js ≥ 22.17; Fastify + MikroORM (PostgreSQL) + Zod + ioredis + BullMQ + Meilisearch (backend)
- React 19 + Vite + react-router-dom 7 + Tailwind 4 (admin); Next.js 15 App Router + React 19 + Tailwind v4 (storefront)
- PostgreSQL via MikroORM, module-scoped timestamped migrations (feature 065)

## Project Structure

See "Repo map" above.

## Recent Changes
- feat/119-infakt-integration: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM; React 19 admin + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ, existing `CredentialsPort` — **no new runtime dependency**
- 094-akeneo-pim-sync: Added TypeScript 5.x strict on Node.js ≥ 22.17 for Endora; PHP 8.2+ Symfony bundles for Akeneo PIM Community/Enterprise (self-hosted) + Existing Fastify, MikroORM, Zod, ioredis, BullMQ, React 19 and platform ports; Akeneo packages use the PIM’s Symfony/Composer stack and Storage events / Batch jobs; **no new runtime npm dependency**
- 089-unopim-pim-sync: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime
- 089-pimcore-pim-sync: Added TypeScript 5.x strict on Node.js >= 22.17 for Endora; PHP 8.2+ package code in the sibling `pim-integrations` workspace + Existing Fastify, MikroORM, Zod, ioredis, BullMQ, React 19 and platform ports; PHP uses the existing Pimcore/Symfony/Composer stack; **no new runtime dependency**
