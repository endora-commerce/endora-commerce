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
| `backend/src/modules/<id>/` | A domain module: `entities/`, `services/`, `routes.ts`, `manifest.ts`, `plugin.ts`, `migrations/`, `i18n/`, optional `actions/`, `workers/` |
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
  operator activation (a manifest-declared Setting in the Settings module, business-owned,
  Admin UI). Neither overwrites the other. A module that is off behaves as if never
  installed — business logic, API, Admin UI and Storefront — its own activation control
  being the one exception. Off is non-destructive and reversible; non-deactivatable modules
  declare that in their manifest; dependencies fail closed. See the checklist below.

## Required checklists for a new backend module

### Admin permissions

Every module with routes gated by `requireAdmin(...)` **must** register its permission codes
so they appear on `/admin-roles` and pass the CI inventory.

1. **`manifest.ts`** — `permissions: [{ code, label, module? }]` for every code this module owns.
2. **`registered-manifests.ts`** — register the manifest once.
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
| **Operator activation** | a Setting in the `settings` module | business operator | Admin UI | does this client want this capability? |

Effective presence = **both true**. Gate on the effective state, fail closed if either is off.
An activation write must not touch the registry, and a platform disable → enable cycle must
preserve the operator's activation choice.

The gating wrappers exist in `backend/src/modules/_lifecycle/` (`defineModuleRoutes`,
`defineModuleWorker`, `subscribeForModule`, `requireModuleEnabled`) but today resolve only
the platform axis via `registryCache.isEnabled` — extend them to the effective state rather
than adding a parallel check. Only 10 of 67 modules use them at all, so assume the module you
are touching does not.

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
   reason. Never hard-code an exception list in the admin app.
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
`DEPLOYMENT=<name>` set. Overriding a core **service** requires the core service to expose a
`*.interface.ts`; the overlay `implements` it through the `@core/*` alias so `tsc` is the
contract gate. Never override a core entity or migration (schema overrides are out of v1) —
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

