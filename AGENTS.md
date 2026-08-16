# Endora Commerce (b2b-platform) — Agent Instructions

Last updated: 2026-08-10

**This file is the single source of truth for every AI coding agent working in this
repository.** `CLAUDE.md` and `.cursor/rules/specify-rules.mdc` are thin pointers to it —
put shared knowledge here, never in a pointer. Cursor, Codex, Amp and other AGENTS.md-aware
tools read this file directly; Claude Code reaches it through the `@AGENTS.md` import in
`CLAUDE.md`.

## Stack

- **`backend/`** — TypeScript 5.x strict on Node.js ≥ 22.17. Fastify, MikroORM (PostgreSQL),
  Zod, ioredis, BullMQ, Meilisearch, `nodemailer`, `pdfmake`. Cross-cutting infrastructure:
  in-process `EventBus` (`src/events/bus.ts`), Command Bus (`src/commands/`), TenantContext
  (`src/tenancy/`), module lifecycle (`src/modules/_lifecycle/`), i18n (`src/modules/_i18n/`).
- **`admin/`** — React 19 + Vite + react-router-dom 7 + `@b2b/api-client` + `lucide-react` +
  Tailwind 4 + Radix/shadcn primitives; `@measured/puck` for the CMS/e-mail builders;
  `@dnd-kit` for drag-drop; charts through the `<EChart>` wrapper
  (`admin/src/components/charts/echart.tsx`).
- **`storefront/`** — Next.js 15 App Router + React 19 + Tailwind v4, Server Components and
  server actions.
- **`packages/`** — `contracts` (Zod schemas: the source of truth for every API shape),
  `api-client`, `cms-components`, `email-components`.

**A new runtime dependency needs written justification** in the feature plan's Complexity
Tracking section (Constitution IV). The default answer is "no new dependency" — reuse what
is already in the stack.

## Repo map

| Path | Contents |
| --- | --- |
| `backend/src/modules/<id>/` | A domain module: `backend.ts` (composition), `entities/`, `services/`, `routes.ts`, `manifest.ts`, `migrations/`, `i18n/`, optional `plugin.ts`, `actions/`, `workers/` |
| `backend/src/apps/<deployment>/modules/<id>/` | Per-deployment overlay modules (feature 057) |
| `backend/test/{unit,contract,integration,perf}/` | Backend tests, mirroring module names |
| `specs/NNN-slug/` | Feature artifacts: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `tasks.md` |
| `.specify/memory/constitution.md` | Binding principles — read before designing anything |
| `docs/` | Docusaurus site (end-user and engineer documentation, English only) |

## Commands

```bash
pnpm -r run typecheck                    # or: pnpm --filter <app> run typecheck
pnpm -r run lint
pnpm --filter backend run test           # vitest run; :unit / :contract / :integration variants
pnpm --filter backend exec vitest run <path>   # targeted run — prefer this while iterating
pnpm run dev                             # full dev stack; pnpm run dev:infra for docker services
pnpm --filter backend run db:fresh       # rebuild the schema from migrations
pnpm run check:naming && pnpm run check:language
```

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
  the global-filter guard in `backend/src/tenancy/`. A design with a "no-organization" path
  is invalid.
- **XII. Sales-channel content scoping (NN)** — channel-scoped reads go through the resolved
  request channel and the sanctioned bridge accessors, not hand-rolled queries.
- **XIII. Uniform write auditing via Command Bus (NN)** — admin/domain writes run through
  `CommandBus.run` so auditing and undo stay uniform.
- **XIV. Entity-agnostic extensibility** — runtime custom fields instead of bespoke columns
  where the requirement is "add a field".
- **XV. Untouched core & per-deployment overlay** — see "Overlay modules" below.
- **XVI. Module discoverability in the command palette** — see the checklist below.
- **XVII. Operator-toggleable modules (NN)** — presence is the conjunction of **two
  orthogonal axes**: platform availability (lifecycle registry, deployment-owned, CLI) and
  operator activation (a manifest-declared Setting, flipped on the kernel-served
  `/platform/modules` screen — a surface no module owns — business-owned, Admin UI). Neither
  overwrites the other. A module that is off behaves as if never
  installed — business logic, API, Admin UI and Storefront — its own activation control
  being the one exception. Off is non-destructive and reversible; non-deactivatable modules
  declare that in their manifest; dependencies fail closed. See the checklist below.

## Required checklists for a new backend module

### Composition — `backend.ts` (feature 072)

**A module is composed by the kernel container, not by a composition root.** All 65 core
modules export `registerModule(ctx: ModuleContext): void` from `backend/src/modules/<id>/backend.ts`;
`backend/src/composition.ts` and `backend/test/test-server.ts` compose that list and pass
deployment inputs, nothing more. Never construct a module's services in either root, and
never add a "module options" object for something the module can read itself.

1. **Own services** — `ctx.di.register({ name: ctx.asFunction(…).singleton() })`. The key is
   claimed: a second writer gets `DuplicateRegistrationError`.
2. **Ports you own** — `ctx.di.providePort('<name>', …)` for anything another module resolves.
   It wraps the registration in a transient gate on the module's effective state, so a caller
   gets the 503 `MODULE_DISABLED` envelope instead of a half-executed operation (Principle XVII).
3. **Reading someone else's port** — `lazyPort<T>(ctx, 'literalPortName')`. **Never resolve a
   port into a singleton**: Awilix strict mode refuses the capture, and it is right to — a
   captured gate keeps answering after its owner is switched off. The name must be a **string
   literal**, or `check-port-dependencies.ts` cannot see the edge (a `port(ctx, name)` helper
   once hid fourteen resolutions, several registered by nobody, while the check read clean).
4. **Declare the edge** — resolving a port owned by `X` puts `X` in your manifest
   `dependencies`. That is what makes the edge real to the lifecycle, the migration order and
   an operator switching `X` off. The port check fails the build without it.
5. **Routes, workers, subscribers** — `ctx.routes` / `ctx.worker` / `ctx.subscribe`. These
   already apply the gating wrappers; do not call `defineModuleRoutes` and friends by hand.
6. **Settings your module owns** — read them through `settingsReadPort` inside the module.
   A knob a root resolves on the module's behalf is a knob that drifts between the two roots,
   and repeatedly did.
7. **Never wrap a port call in a bare `catch`** — it swallows `ModuleDisabledError` and turns
   fail-closed into fail-open. Where a degrade genuinely belongs, put it inside the owner's
   implementation and express it in the return type
   (`allowedIdsFor(): Promise<string[] | null>` is the worked example). Where a **narrow**
   tolerance is genuinely correct — a per-item import failure, a compensating cleanup — keep
   the `catch` and make `rethrowIfModuleDisabled(error)` its first line, with a comment saying
   why the tolerance is right; "defensive" is not a reason. Enforced by
   `pnpm --filter backend run check:port-catches`, which also refuses a *conditional*
   re-throw: `ModuleDisabledError` is an `HttpError`, so a status-code test lets it through by
   accident rather than by decision.
8. **One registration pass, one boot phase (D-45).** A root calls `composeModules(MODULES, …)`
   once and `runBootHooks()` once, immediately before it builds the Fastify app — so **a boot
   hook may resolve anything**, whichever module registered it. Registration itself resolves
   nothing (`compose.ts`'s `registering` guard), which is what makes its order meaningless.
   The one ordering rule left is for the **root**: a contribution over a name a module
   defaults goes in the single slot between `composeModules(MODULES, …)` and `runBootHooks()`
   — earlier and the module's default overwrites it, later and a boot hook has already read
   that default.
9. **Install-time work goes in `manifest.ts`, never in the context.** `ctx.onBoot` is the
   only lifecycle hook a `ModuleContext` carries; `ctx.onInstall` / `ctx.onUninstall` were
   deleted (D-46) because `module:install` composes nothing, so a hook the container
   collected could never fire. Export `installHook` / `uninstallHook` from the module's
   `manifest.ts` — the composer generator wires them. Their contract, in full: the hook is
   **idempotent by contract** (it re-runs after a failed install and after a
   soft-uninstall → install cycle); a **failing install hook aborts the install** and reverts
   that run's migrations; a **failing uninstall hook removes nothing**; **`ctx.hard`**
   discriminates soft from destructive uninstall, so cleanup sits behind
   `if (!ctx.hard) return;`; **neither hook fires on activation or deactivation** — that is
   the other axis (Principle XVII) and no hook may be added to it; and the hook context is
   `{ em, redis, log, module }` (`+ hard`), which cannot carry services.
10. **CI** — `pnpm --filter backend run check:port-dependencies`, `check:port-catches`,
   `check:kernel-boundary`, `check:container-imports`, and
   `pnpm --filter backend exec vitest run test/contract/kernel/harness-parity.test.ts`
   (drift between the two composition roots, as an explicit draining ledger).

Full guide, including the contribution-point rules and the request scope:
`docs/docs/architecture/kernel.md`.

### Admin permissions

Every module with routes gated by `requireAdmin(...)` **must** register its permission codes
so they appear on `/admin-roles` and pass the CI inventory.

1. **`manifest.ts`** — `permissions: [{ code, label, module? }]` for every code this module owns.
2. **`registered-manifests.ts`** — **generated** (feature 072): a module that ships a
   lifecycle-shape `manifest.ts` is picked up by the tree walk. Run
   `pnpm --filter backend run composer:generate` and commit the result; never edit the file.
3. **Routes** — `requireAdmin('…')` literals must match manifest `code` values exactly.
4. **i18n** — `adminRoles.permission.<code>` in `_i18n/i18n/en.json` and `pl.json`.
5. **AppShell** — `requiredPermission` on nav entries where applicable.
6. **CI** — `pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts`
   before opening the MR.

Do not duplicate shared codes from core `PERMISSION_CATALOGUE`
(`packages/contracts/src/admin.ts`). Contract:
`specs/026-admin-roles-permissions/contracts/module-manifest-permissions.md`.

### Command palette (Principle XVI)

Every module with an admin surface **must** be discoverable under ⌘K / CTRL+K. Sidebar-only
is not enough.

1. **`manifest.ts`** — `actions: [{ id, labelKey, descriptionKey, icon, targetRoute,
   requiredPermission, keywords, weight }]` for the module's landing surface plus its few
   highest-value operator actions. Curate — this is a discovery surface, not a route dump.
2. **`requiredPermission`** — the code gating the target surface, so the palette never
   advertises a 403.
3. **i18n** — `labelKey` / `descriptionKey` are **relative to the module namespace**
   (`actions.openX.label`, not `<module>.actions.openX.label`) and live in the module's own
   `i18n/en.json` + `pl.json`. Those files must be a **flat** `{"a.b.c": "text"}` map — a
   nested object fails `TranslationBundleEntriesSchema`, the boot reconciler only logs and
   skips it, and the palette silently renders raw keys.
4. **`icon`** — must be in `KnownIconNameSchema` (`packages/contracts/src/admin-actions.ts`);
   adding a name there requires the matching entry in
   `admin/src/lib/admin-actions/icon-map.ts` in the same MR.
5. **`targetRoute`** — a real admin route (no query string; the route regex rejects one).
   Deep-link actions need an actual route, e.g. `/credentials/new`.
6. **CI** — `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`
   verifies that every registered module's on-disk bundles load and that every manifest action
   key resolves in every shipped language.

### Module enable/disable (Principle XVII)

A module's presence is the **conjunction of two orthogonal axes** — do not conflate them:

| Axis | Stored in | Owned by | Changed via | Answers |
| --- | --- | --- | --- | --- |
| **Platform availability** | lifecycle registry (`module_registrations`) | deployment operator | CLI / deployment tooling | is this module installed and wired here? |
| **Operator activation** | a manifest-declared Setting in the settings store | business operator | Admin UI, on `/platform/modules` | does this client want this capability? |

Effective presence = **both true**. Gate on the effective state, fail closed if either is off.
An activation write must not touch the registry, and a platform disable → enable cycle must
preserve the operator's activation choice.

The gating wrappers exist in `backend/src/kernel/lifecycle/` (`defineModuleRoutes`,
`defineModuleWorker`, `subscribeForModule`, `requireModuleEnabled`) — extend them to the
effective state rather than adding a parallel check. They live in the kernel, alongside the
registry cache, the activation resolver and the effective-state combiner, because the kernel
applies them to every module it composes and may not import from `src/modules/` (D-37).
`_lifecycle` keeps the operator-facing half: the manifest, the permissions, the routes, the
Commands, the orchestrator and the `module:*` CLI scripts.

**You almost never call those wrappers yourself.** All 65 core modules are composed through
the kernel container (feature 072), and `ctx.routes` / `ctx.worker` / `ctx.subscribe` apply
the wrappers for you — see the composition checklist above. Call them directly only where
there is no `ModuleContext`: a CLI entry point, or an overlay module under
`backend/src/apps/<deployment>/modules/`, which is still composed through the feature-057
`overlayModule` factory. Four core modules (`newsletter`, `product_feeds`, `pim_ergonode`,
`ksef`) still wrap a second time inside their `plugin.ts`; that is conversion residue, not a
pattern to copy.

1. **Routes** — wrap the module's route registration in `defineModuleRoutes('<id>', …)` so
   gating holds at the registration seam for every route the module owns, including later
   ones. Never gate per handler.
2. **Workers and subscribers** — register BullMQ workers through `defineModuleWorker` and
   EventBus subscriptions through `subscribeForModule`, so both stop when the module is off.
3. **Cross-module calls** — service entry points reachable from another module call
   `requireModuleEnabled('<id>')`, so a caller gets the explicit 503 envelope
   (`ERROR_CODES.MODULE_DISABLED`) instead of a half-executed operation.
4. **Manifest** — declare the module's activation control and its default, and, if the
   platform genuinely cannot run without the module, declare it non-deactivatable with a
   reason. The lifecycle orchestrator refuses to disable a module that declares it, with no
   `--force`, so the declaration bites on both axes. Never hard-code an exception list in the
   admin app, and never declare it because a screen happens to live in the module — the
   activation controls render on `/platform/modules`, which belongs to no module (D-36).
5. **Admin and Storefront** — a module that is off contributes no sidebar entry, palette
   action, widget, tab, settings group or editable configuration, and no storefront element.
   Both frontends resolve this from the server's effective enabled-set; do not hard-code the
   surfaces. A platform-unavailable module renders as absent or blocked-with-a-reason, never
   as merely "switched off".
6. **Tests** — ship an off-state test proving API rejection, admin absence, non-editable
   configuration and storefront absence while off, plus full restoration — and cover the
   deactivated-while-platform-available case specifically.

Switching a module off is **not** uninstalling: it drops no data, configuration, bundles,
permissions or schema.

### Migrations (feature 065)

There is **no repo-wide sequential migration number**. Never write "the next free `NNN_*`
number", never pick a number, never edit an execution list.

1. **Scaffold it** — `pnpm --filter backend run migration:new -- --module <id> --name <slug>`.
   The file lands in `backend/src/modules/<id>/migrations/` (or `backend/src/db/migrations/`
   for `--module core`), named `<YYYYMMDDTHHmmss>_<module-segment>_<slug>.ts` with a UTC
   timestamp. The class name is derived mechanically from the filename
   (`Migration<STAMP><PascalCaseTail>`); it is the name persisted in `mikro_orm_migrations`,
   so never rename an applied class.
2. **Register it** — paste the two printed lines (import + `migration('<id>', Class)`) into
   the module's group in **`backend/src/db/migrations-registry.ts`**. This registry replaced
   the hand-ordered `migrationsList` in `mikro-orm.config.ts`. An unregistered migration does
   not run; `test/unit/db/migrations-registry.test.ts` fails the build for it.
3. **Do not order by hand.** Declaration order in the registry has no effect. Execution order
   is computed by `backend/src/db/migration-order.ts` from the timestamps, corrected by the
   module-manifest dependency graph (45-day horizon). If `db:fresh` fails on ordering, bump
   the timestamp or fix the manifest `dependencies` — never move a registry line.
4. **Cross-module FK ⇒ declare the dependency.** A new foreign key to another module's table
   requires that module in your manifest's `dependencies` (transitively), or
   `pnpm --filter backend exec vitest run test/unit/db/fk-dependency-drift.test.ts` fails.
5. **Renaming an applied migration class costs a database rebuild.** Since feature 072 there
   is no frozen name map and nothing in the repository forbids the rename — but
   `mikro_orm_migrations` stores the **class name**, so every database that already ran the
   migration under its old name will see the new name as pending and try to re-apply it.
   Rename only when moving a migration between groups is genuinely required (as feature 072
   T020 did), and ship the rename with a note telling every developer to rebuild:
   `DATABASE_URL=…/b2b_test pnpm --filter backend run db:fresh` plus
   `pnpm --filter backend run db:reset` for the dev database.
6. **Never scaffold a migration stamped at or before `UNCORRECTED_THROUGH`**
   (`20260801T000000`, `backend/src/db/migration-order.ts`). Everything at or before it is
   the pre-065 block: it is emitted in plain chronological order and is **not**
   dependency-corrected, so a migration landing there silently loses the ordering its
   manifest `dependencies` are supposed to buy it. `migration:new` clamps the stamp for you;
   do not hand-write one below the watermark.

Full guide: `docs/docs/architecture/migrations.md`; contracts under
`specs/065-manifest-aware-migrations/contracts/`.

### i18n

All user-facing strings ship in **both `en` and `pl`**; a static CI check rejects hard-coded
literals (`pnpm --filter backend run i18n:hardcoded`).

## Static checks and their escape hatches

Both run in CI as GitLab's `quality:static` job — full tree, every MR and every push to
`master`. They need only bash, grep, perl and POSIX awk (no `pnpm install`), so keep them
free of gawk-isms and of anything that assumes a node toolchain. Neither script may pass on
an empty file list; both exit 2 when `git` is missing rather than reporting a vacuous green.

`pnpm run check:language` (Principle VIII) scans source-code **comments** and `docs/docs/**`
pages for Polish. It ignores cited terms — anything inside backticks, `"quotes"`, a fenced
code block, or (in docs) markdown emphasis — because an English comment routinely has to
quote a Polish UI label, currency rendering or expected test string. **If it flags you, cite
the term rather than translating it.** Two deliberate carve-outs exist:

- Polish proper nouns with no English form (state institutions, official registries, the
  Polish names of shipped features) live in the `proper_nouns` list in
  `scripts/check-language.sh`. Keep it short — a UI label is a citation, not a proper noun.
- An intrinsically bilingual page opts out with `check-language: allow-non-english` plus a
  reason, in its YAML front matter. Currently only the EN→PL glossary
  (`docs/docs/contributing/translations.md`) qualifies.

`pnpm run check:naming` (Principle VI) checks backend module folder shape, migration
identifiers, Zod contract keys and route segments. Module folders are plural snake_case;
`_`-prefixed infra modules (`_i18n`, `_lifecycle`), singular named surfaces and vendor/
protocol proper nouns are allow-listed in `scripts/check-naming.sh`. A `z.object()` field
that must stay snake_case because it is **persisted verbatim** (a JSONB envelope with a SQL
column default, an external vendor's wire format) is marked with `naming:allow-snake-case`
plus a reason in a comment directly above the field — see `cmsContentEnvelopeSchema` in
`packages/contracts/src/cms.ts`. Do not use it to skip a genuine API-shape fix.

## Overlay modules (per-deployment customization, feature 057)

A **client-only overlay module** lives under `backend/src/apps/<deployment>/modules/<id>/` and
is discovered without editing the shared core registry (`REGISTERED_MANIFESTS` stays
untouched — FR-004). It is an ordinary lifecycle participant, so every checklist above
applies, with one difference: its admin permissions must appear on `/admin-roles` and pass
the permission-inventory check **for that deployment** — run the inventory test with
`DEPLOYMENT=<name>` set. Overriding a core **service** is a **decoration**, not a file
shadowing it (feature 072): a file under `backend/src/apps/<deployment>/decorations/`, named
after the registration it wraps, exporting `decorate(inner)` — it receives the core
implementation and returns one that delegates to it, so core fixes keep flowing. `tsc` is the
contract gate: the decoration is written against the core service's `*.interface.ts` and
stops being assignable when that interface changes. A `services/` file under an overlay is
now an **unknown override target** and fails the build.
Never override a core entity or migration (schema overrides are out of v1) —
ship new schema as tables owned by the overlay module. See
`docs/docs/architecture/overlay-pattern.md` and `specs/057-overlay-pattern-multideploy/`.

## Working agreement

- **Verify before reporting done**: `typecheck` + `lint` + the targeted tests for what you
  touched. Report failures with their output; never hide them.
- **Read before writing** — the module you are changing, the closest prior feature's spec
  directory, and the relevant contracts.
- **English only** in code, comments, identifiers, specs, docs and commit messages
  (Principle VIII).
- **Commits**: never add `Co-Authored-By: Claude` or any other AI/LLM trailer. Branch off
  `master` and deliver through a merge request — never commit straight to `master`.
- **Do not touch**: generated files, another module's migrations, or the auto-generated
  appendix at the bottom of this file.

Specs written before 2026-07-31 refer to the checklists above as "the CLAUDE.md new-module
rules" — same rules, they simply moved here.

## Feature workflow (speckit)

New features follow the speckit flow: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks`
→ `/speckit.implement`, producing `specs/NNN-slug/`. `/speckit.plan` regenerates the appendix
below through `.specify/scripts/bash/update-agent-context.sh`, which is pinned to write into
this file only (see the repo-local override near the top of that script) — that is what keeps
`CLAUDE.md`, `.cursor/rules/specify-rules.mdc` and this file from drifting apart again.

## Subagents

Role-specialised subagents are defined twice, once per tool, with identical roles:
`.claude/agents/*.md` (Claude Code) and `.cursor/agents/*.md` (Cursor). Their prompts stay
short on purpose — repository conventions live here, not in the agent files.

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
agent reads that path directly. Update it in place; never fork a second copy.

---

<!-- Everything below is appended automatically by speckit's update-agent-context.sh.
     Treat it as an append-only log; prune it when it stops being useful. -->

## Active Technologies
- TypeScript 5.x `strict`, Node.js ≥ 22.17 (backend + admin), ESM. (067-product-feed)
- PostgreSQL for feed configuration, taxonomy reference data, run history and issue records; (067-product-feed)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime (068-ergonode-pim-sync)
- PostgreSQL — 10 new tables owned by `pim_ergonode`, 1 new column on `catalog.categories` (068-ergonode-pim-sync)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 (admin); Next.js 15 App Router + React 19 (storefront). **No new runtime dependency** (Constitution IV, FR-062) (073-lifecycle-gating-completion)
- PostgreSQL. No new table. One new column-free path: activation values live in the existing `settings` rows (`global_value` / `default_value`); platform availability stays in `module_registrations` (073-lifecycle-gating-completion)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ. **One new runtime dependency: `awilix`** — see Complexity Tracking (072-module-kernel-di)
- PostgreSQL. No schema change of its own. Three entity relocations follow D-32: `audit_logs`' service and entity, the settings store, and the `sales_channels` resolution machinery move into the kernel package (072-module-kernel-di)

- TypeScript 5.x strict on Node.js ≥ 22.17; Fastify + MikroORM (PostgreSQL) + Zod + ioredis + BullMQ + Meilisearch (backend)
- React 19 + Vite + react-router-dom 7 + Tailwind 4 (admin); Next.js 15 App Router + React 19 + Tailwind v4 (storefront)
- PostgreSQL via MikroORM, module-scoped timestamped migrations (feature 065)

## Project Structure

See "Repo map" above.

## Recent Changes
- 072-module-kernel-di: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ. **One new runtime dependency: `awilix`** — see Complexity Tracking
- 073-lifecycle-gating-completion: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 (admin); Next.js 15 App Router + React 19 (storefront). **No new runtime dependency** (Constitution IV, FR-062)
- 068-ergonode-pim-sync: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime

