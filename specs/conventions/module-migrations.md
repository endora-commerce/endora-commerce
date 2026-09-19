# Migrations (feature 065)

**Open this before writing a migration, adding an `@Entity()` class, or touching execution
order** — and before assuming there is a number to pick, because there is not. One of the
bodies `AGENTS.md` routes to; it is the single home for these rules, so never restate them in
`AGENTS.md` or in a tool-specific pointer file.

There is **no repo-wide sequential migration number**. Never write "the next free `NNN_*`
number", never pick a number, never edit an execution list.

1. **Scaffold it** — `pnpm --filter backend run migration:new -- --module <id> --name <slug>`.
   The file lands in the module's own `migrations/` directory, **resolved** rather than
   spelled: `--module core` is the **platform's** own `migrations/` directory — the twelve
   cross-cutting migrations moved there with `specs/110-instance-repository/` T116, beside
   the `./migrations` barrel that publishes them — and a module package's is the directory
   its own `exports` map publishes as `./migrations`. This step read
   *"`backend/src/modules/<id>/migrations/`"* while the scaffolder rejected all 67 module
   ids with `Valid ids are: core.`, because that is where the tool looked and F4 had emptied
   it. The path is not written into the tool at either end: the scaffolder resolves the
   platform by its own `endora.type: "platform"` declaration and refuses a checkout that
   has none, because a fallback to the old directory would write a migration the generator
   no longer walks — and an unregistered migration does not run. The file is named
   `<YYYYMMDDTHHmmss>_<module-segment>_<slug>.ts` with a UTC timestamp. The class name is derived mechanically from the filename
   (`Migration<STAMP><PascalCaseTail>`); it is the name persisted in `mikro_orm_migrations`,
   so never rename an applied class. **The tail must begin with the owning module's
   segment** (`orders` → `Migration…Orders…`, `_i18n` → `Migration…I18n…`, core →
   `Migration…Core…`) — that is what makes a class name unique across every module the
   platform can compose, including one installed from a package. `orderMigrations` refuses a
   violation as `unscoped-name` and `check:naming` refuses one in the core tree.
2. **Register it** — run `pnpm --filter backend run composer:generate` and commit
   **`backend/src/db/migrations-registry.generated.ts`** alongside the migration. The
   registry is generated from a filesystem walk (feature 071, F2) and replaced the
   hand-ordered `migrationsList` in `mikro-orm.config.ts`; never edit it by hand. An
   unregistered migration does not run; `test/unit/db/migrations-registry.test.ts` and
   `overlay:check` both fail the build for a stale artefact.
3. **Do not order by hand, and do not order by timestamp.** Declaration order in the
   registry has no effect — and there is nothing to reorder, since regenerating restores it.
   Execution order is computed by `@endora-commerce/platform/db`'s `migration-order.ts`
   (feature 081): a frozen
   historical prefix, then **module by module** in a topological order of the manifest
   `dependencies` graph, each module's migrations contiguous and ascending by timestamp. So a
   **timestamp orders a module's own migrations and nothing else** — two modules may legally
   share one, and moving a stamp cannot change a cross-module position. If `db:fresh` fails on
   ordering, the answer is always the manifest `dependencies` of the module that owns the
   referencing table. The 45-day correction horizon, the dependency-inversion edges and the
   `unresolvable-order` failure are gone; a dependency **cycle** is now a reported diagnostic
   rather than a boot failure — because the graph is the primary ordering and a manifest can
   arrive from an installed package, so a throw would let one stranger's declaration stop a
   shop's own schema from migrating. It has **three readers and three reactions**, and the
   split is the point: red in `test/unit/db/module-graph.test.ts` for a cycle in this
   repository, logged at `warn` at boot for one on a running platform, and **refused by the
   `_lifecycle` orchestrator** for one that is about to arrive — `install` walks the installed
   set plus the arriving module with `findModuleCycles` and refuses with `manifest-cycle`
   (exit `65`) when a component holds it. Only the arriving module's component is refused; a
   loop between two already-installed modules blocks nobody else's install.
4. **Cross-module FK ⇒ declare the dependency.** A new foreign key to another module's table
   requires that module in your manifest's `dependencies` (transitively), or
   `pnpm --filter backend exec vitest run test/unit/db/fk-dependency-drift.test.ts` fails.
4a. **And so does any other cross-module table reference — plus, for a *write*, a
   declaration is not enough** (feature 097). Item 4's rule is a rule about **DDL**, because
   its instrument reads `create table`, `alter table` and `references "…"` and no DML
   statement at all; until this landed, an `insert`, `update`, `delete` or `select` in a
   migration naming another module's table was judged by nothing in the repository. 76 such
   accesses stood in 28 migration files, 4 of them undeclared and 37 of them writes.
   `check:module-boundary` now judges them, under two rules with two ledgers:
   **R1** is item 4 with its predicate widened from `references` to every statement
   `sqlTableAccesses` recognises, and **R2** is that a migration owned by `A` may not
   **write** a table owned by `B` *whether or not R1 holds* — a declaration is an
   ordering-and-presence fact and a write is an ownership fact, so seeding, reseeding and
   correcting a module's rows is that module's own migration's job. Kernel-owned tables are
   outside both, derived from the owner map and never from a table list: the kernel cannot
   appear in a `dependencies` array. The three seams a write's repair takes are the owner's
   own migration, the writing module's `installHook` (idempotent by contract, and it re-runs
   after a soft-uninstall → install cycle) and the owner's port at boot. **A seed of your own
   reference rows into the owner's table takes the second**, and how it is written is
   `module-composition.md` item 9a's, not this document's — a hook has no container, so the
   choice there is the owner's published install surface and not raw SQL (ruled 2026-09-17,
   `specs/134-paid-module-extraction/contracts/foreign-write-repair.md`). Do **not** answer an
   R1 finding with a manifest line where your module is `nonDeactivatable` and the owner is
   switchable: that makes the owner's activation control a dead switch (`module-composition.md`
   item 4a), and it is the case that produced the feature.
   `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` is normative.
5. **Renaming an applied migration class costs a database rebuild.** Since feature 072 there
   is no frozen name map and nothing in the repository forbids the rename — but
   `mikro_orm_migrations` stores the **class name**, so every database that already ran the
   migration under its old name will see the new name as pending and try to re-apply it.
   Rename only when moving a migration between groups is genuinely required (as feature 072
   T020 did), and ship the rename with a note telling every developer to rebuild the **dev**
   database: `pnpm --filter backend run db:reset`. The test suite needs nothing, since issue
   #289: its migration template is named after a digest of the migration set, so a renamed
   class is a different set and the next invocation builds its own template rather than
   re-applying anything into yours.
6. **Never scaffold a migration stamped at or before `BASELINE_THROUGH`**
   (`20260801T000000`, `@endora-commerce/platform/db`). Everything the committed core
   registry contributed at or before it is the **frozen historical prefix**: its order is
   history — the pre-065 block contradicts the manifest graph in 37 places, and recomputing it
   produces an order a fresh database cannot apply — so a migration landing there is ordered
   by that history instead of by its module's `dependencies`. The block is closed and is never
   drained. `migration:new` clamps the stamp for you; do not hand-write one below the
   watermark. **The watermark is a generation-time rule and no longer a runtime membership
   test** (`specs/110-instance-repository/contracts/instance-migration-order.md` R1.2):
   membership is an **identity** — the class name is on `BASELINE_MIGRATIONS`, the ordered
   list `@endora-commerce/platform` publishes on its host-internal `./migrations` subpath,
   generated by `composer:generate` from what the committed core registry contributes at or
   below the watermark. It used to take the entry's `origin` as well, which answers *"did
   this come out of our build"* rather than *"is this one of the migrations whose order is
   history"*: the two are the same question only while every module is compiled in, and the
   moment the modules are installed packages — which is every instance — the prefix falls
   from 112 entries to 11, 181 of 182 positions move, and six migrations land before the
   migration that creates a table they touch. A name is not a claim an arriving package can
   make, so a package's back-dated stamp still cannot join.

**Entities are registered the same way.** `backend/src/db/entities-registry.generated.ts`
comes out of the same command and the same walk: add the `@Entity()` class under the
module's `entities/`, run `composer:generate`, commit the artefact. An **overlay** module
contributes to neither — it can ship no migration (D-106), so the generator refuses an entity
or a migration under `backend/src/apps/` rather than emitting schema nothing creates.

**A module that has become a workspace package contributes to all four artefacts, with a
bare specifier** (feature 080, T041a; D-149). Until then the generator had no notion of one:
every walk was rooted at `backend/src`, `MODULE_MIGRATION_RE` was anchored at
`^modules/<id>/migrations/`, and `specifierFromDb` emitted a relative path and nothing else —
so the first module to move would have left the migration registry, which is the one artefact
where an absence is invisible. Four things about how it works now, because each is a rule an
author can trip over:

- **A package is discovered by its own `endora: { type: 'module', id }` block**, over the
  members `pnpm-workspace.yaml` globs, and by nothing else. `packages/modules` appears in no
  check and in no generator (D-100), so **the glob and the move belong in one merge request**:
  a package no glob reaches is not a member, is not discovered, and drops out of every
  artefact silently.
- **An *installed* package contributes nothing** (D-119/D-155). It is discovered at runtime;
  baking it into a committed artefact registers it twice, and `overlay:check`'s `foreign`
  verdict refuses it by **real path**.
- **The specifier is derived from the package's own `exports` map** — the most specific
  declared subpath whose target covers the file, where a target named `index.*` covers its
  directory. Nothing spells `./backend` or `./migrations` anywhere in the tree; a package that
  names its layers differently is followed. A file **no** declared subpath covers is
  **refused**, because a committed registry importing it would get
  `ERR_PACKAGE_PATH_NOT_EXPORTED` and skipping it is how a migration goes missing without a
  word. Wildcard subpaths (`"./i18n/*"`) are outside the rule.
- **A packaged migration is attributed to `endora.id`, never to a path segment** (D-142) — a
  hard uninstall reverts exactly the migrations registered under the module being removed.

**A module package's own `package.json` is generated too, and it is the one generated artefact that
is also install-affecting** (feature 080, T041). `pnpm --filter backend run manifests:generate`
renders it from the layer inventory — peers from the bare specifiers the module's sources actually
import, `exports` from which layers exist, the `endora` block from the module's `manifest.ts` — and
`manifests:check` fails on drift. Everything about it is **derived**: `google_analytics` gets
`bullmq` and `ioredis` because it runs a real worker and `quote_requests` gets neither because its
"worker" is a plain sweep, and that difference falls out of the walk rather than out of an author
remembering. Node's built-ins are excluded by asking `isBuiltin`, not by a list, and the package's
own name by reading specifiers as literal AST nodes — a text scan reports every package as depending
on itself, measured.

**Two fields that look like boilerplate and are derived like everything else here.** `license` is
the workspace root's `license`, or the module's own override — `export const packageLicense = '…'`
beside its `src/manifest.ts`, read as a literal AST node and **refused** when it is computed,
because falling back would fall back to the *permissive* value and the silent answer would be a
licence grant nobody wrote. The owner's ruling of 2026-09-06 is the model: open core `MIT`, a paid
package `SEE LICENSE IN LICENSE.md`, the split by **package**, entitlement contractual. Which
modules are paid is a product decision nobody has taken, so the generator renders the mechanism and
never a guess. And `peerDependenciesMeta` marks a peer **optional** when every non-test reach into
it came from a UI layer (FR-022), which is the answer to the question the field's own header used to
say was vacuous: measured on `master`, 56 of 70 packages required `vitest`, 55 the admin kit and 54
`react`, with no `peerDependenciesMeta` anywhere, so a backend-only instance installed a test
runner, React, a router and a charting library. `src/admin/` and `src/admin-ui/` are the only layers
a consumer can decline to resolve; `src/backend/`, `src/migrations/`, `src/ports/` and the root
manifest are on every consumer's path. A name **only a test file** reaches is not a peer at all —
every module package's `tsconfig.json` excludes the test spellings from the program its
`tsconfig.build.json` emits, so nothing a test imports survives into anything published — and it
stays a `devDependency`, which is what `vitest` and `@fastify/type-provider-zod` now are.

**It also writes one file that is not a package's: `admin/package.json`'s dependency on the module
packages the admin composes** (feature 091). The admin contribution registry names each
contributing module by a **bare** specifier, and pnpm links a workspace member into `node_modules`
only for a package that declares it — so a module that ships `src/admin/` and is not a dependency
of the admin is a registry entry the bundler cannot resolve. The reconciliation is deliberately
narrow: a module package this run found, or a dependency carrying a `workspace:` range naming no
current member (a package that has *gone*). A third-party package from a registry carries a semver
range and is never touched, whatever it is called, and every other key of that file — the React,
Radix and Tailwind ranges, which are a human's with Constitution IV's justification behind them —
keeps its value and its position. The alternative, a refusal telling the author to `pnpm add`, was
rejected for re-creating the thing feature 091 removes: a shared file every module author edits by
hand. **The ranges a module package peers on come from the applications, plural**, for the same
reason — `react` and `lucide-react` are declared by `admin` and by no other member — and which
workspace members are applications is derived from the shape of their `pnpm-workspace.yaml` entry
(a literal names one deployable, a glob enumerates a library family), never from a list.

**Run `pnpm install --lockfile-only` in the same breath and commit `pnpm-lock.yaml`.** A generated
manifest changes what a workspace declares, so `pnpm-lock.yaml` goes stale the moment the render
differs — and `pnpm install --frozen-lockfile` is the **first** thing every CI job does, so the
whole pipeline dies in `quality` before a single check runs. That is not hypothetical: it is how
`master` went red on 2026-08-24, from three lines of lockfile left behind after the generator
correctly dropped a `zod` the package imports nowhere. The pairing is the same one
`composer:generate` has with its four artefacts; this one is newer and easier to forget, because a
hand-written manifest never needed it — whoever edited one was already running an install.

**And `manifest-index.generated.ts` carries each entry's real `manifestPath`.**
`registered-manifests.ts` used to compute it as `<modules root>/<id>/manifest.ts`, a
convention nothing verified, and every consumer takes `dirname` of it to reach the module's
own directory — the `_i18n` boot reconciler joins `bundlesDir` to it and **logs and skips** a
directory that is not there. A packaged module would therefore have loaded no bundle and
rendered every command-palette entry as its raw i18n key, with no error anywhere. The
generator emits the location it walked (`src/manifest-locations.ts` resolves it against
the index's own `import.meta.url`, so it follows a `dist` run and a moved index alike), and
both halves **refuse** rather than substitute: a specifier reaching no file throws at the
first import of the index, and an entry with no path throws in `coreManifestEntries`.

Full guide: `docs/docs/architecture/migrations.md`. Contracts:
`specs/081-per-module-migration-order/contracts/ordering-algorithm.md` (normative for the
order) and `migration-identity.md` (naming and uniqueness);
`specs/065-manifest-aware-migrations/contracts/naming-convention.md` §1–§2 (still the only
filename and class-name recognizers) and `fk-dependency-check.md`. The `065` ordering contract
is superseded.

