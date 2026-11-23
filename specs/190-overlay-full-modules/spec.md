# Feature Specification: Overlay modules as full modules — schema, build, ports and admin

**Feature Branch**: `spec/190-overlay-full-modules`
**Created**: 2026-11-23
**Status**: Draft — ruling **D-297** recorded below (owner decisions of 2026-11-23, and the owner's
answers of the same day to OQ-190-1 – OQ-190-3 and to two cross-spec questions, OR-9 – OR-13); no
question open; implementation not started
**Input**: Umbrella issue #1858 and its children #1846 – #1857 (closed #1842 merged into #1857).
Owner decisions of 2026-11-23, binding and not reopened here (see *Owner rulings*).

**Related** (parallel, cite by slug): `specs/186-aggregate-ports/` (D-293),
`specs/187-side-table-extensions/` (D-294 — side tables, origin-agnostic, covers overlays from the
start), `specs/188-policy-points/` (D-295), `specs/189-command-middleware/` (D-296 — `admit` /
`observe` middleware, the D-156.4 narrowing of #1841), `specs/191-membership-join-requests/`
(D-298). Prior art: `specs/057-overlay-pattern-multideploy/`, `specs/107-override-report-and-ladder/`,
`specs/110-instance-repository/`, `specs/124-instance-customisation-gap/`,
`specs/176-command-hooks-outbox/`, `specs/178-extensible-columns/` (D-291). Pre-migration
citations (`specs/080-f4-real-scope/`, D-103 … D-106) are left in place as provenance.

## Context

Measured on `origin/master` at `ff7efc3e8`:

- An **instance** (a separate repository depending on pinned release packages) customises the
  platform through per-deployment overlay modules under `apps/<deployment>/modules/<id>/`. Such a
  module may ship routes, registrations, decorations, interceptors, command hooks, permissions,
  Settings and i18n bundles — and **no schema**, no published port, no admin screen and no palette
  action (D-106; `specs/conventions/overlay-modules.md`).
- The schema refusal is written three times and must agree: the platform's
  `packages/platform/src/overlay/overlay-schema.ts` (`assertOverlayModulesShipNoSchema`, called from
  `overlayModuleIdsUnder` in `overlay-runtime.ts`, plus `refuseOverlaySchema` for `migrate`), the
  CLI's `overlaySchemaFiles` in `packages/cli/src/generate/divergence.ts`, and this repository's
  `backend/scripts/generate-composer.ts` (`collectEntities`, the migration walk anchored by
  `MODULE_MIGRATION_RE`, the `schemaExtensions` refusal).
- Entities and migrations are discovered only from installed packages
  (`discoverPackageSchema` in `packages/platform/src/packages/package-runtime.ts`), merged by
  `configuredEntitiesFrom` (`db/configured-entities.ts`) and `configuredMigrationsFrom`
  (`db/configured-migrations.ts`), where every non-core migration passes `guardExternalMigration`.
- An instance's overlay code is **not compiled and not type-checked**: Node strips its types at
  load (`resolveOverlayUnit` already resolves `.js` before `.ts`), the instance backend's
  `tsconfig.json` includes only `src` (`packages/cli/src/new-instance/template.ts`, the
  `backend/tsconfig.json` file entry), and the instance README warns that an `enum` crashes at boot
  with no check reporting it. Type stripping excludes decorators, so the entity idiom every
  package uses cannot be written in an overlay at all.
- `endora new module` in an instance refuses `--entities`, `--tenant-scope`, `--admin`,
  `--action` and `--ports` (`packages/cli/src/new-module/overlay.ts`, `refuseWhatAnOverlayCannotBe`).
- The admin contribution registry is generated only from packages that declare `./admin`
  (`packages/cli/src/lib/admin-artefacts.ts`), and the palette-coverage test states that "overlay
  modules discovered at runtime are outside it" (`specs/conventions/module-admin-surfaces.md`).
- `ctx.di.providePort` already works from an overlay
  (`backend/src/apps/example/modules/ledger_vendor_fixture/ports.ts`), but no overlay module can
  depend on another's port **type** in a sanctioned way.
- Tenant classification (Principle XI) is enforced only by static source-text checks
  (`packages/cli/src/rules/entity-tenant-classification.ts`,
  `backend/scripts/check-entity-tenant-classification.ts`); at boot `configuredEntitiesFrom` checks
  only that transitive parents resolve (`assertTransitiveParentsResolve`). An entity outside the
  checked tree boots unclassified.

The only way an instance gets a table of its own today is a `pnpm pack` tarball of a module package.
D-106's stated reason — "an overlay lives in the same repository and the same build as core, so own
the table from a core module" — has no referent in an instance, which has no core tree.

## Owner rulings *(binding — 2026-11-23, recorded as D-297; not reopened by this feature)*

- **OR-1** — An overlay module is a **full module**: it may own entities and migrations, publish a
  port, ship admin screens and palette actions. There is **no** second "local instance package"
  mechanism (OD-12 changed).
- **OR-2** — Overlay code gets a **build**: one deployment-level `tsc` project, not build-less
  `defineEntity` entities. No per-module builds, no `package.json`, no `exports` map under `apps/`.
- **OR-3** — It holds in an instance **and** in this repository's `backend/src/apps/`.
- **OR-4** — Overlay migrations face the **full foreign-schema guard**, with no deployment exemption.
- **OR-5** — Trust tier **"deployment"**, derived from the manifest entry's `origin`: an overlay may
  contribute `admit` command middleware (`specs/189-command-middleware/`), policy participants
  (`specs/188-policy-points/`) and command hooks (`specs/176-command-hooks-outbox/`). Decorating a
  registration an installed package owns stays refused.
- **OR-6** — A module **promoted** from an overlay to a package keeps its module id, so recorded
  migration class names still match.
- **OR-7** — Entity idiom: MikroORM 7 legacy decorators from `@mikro-orm/decorators/legacy`
  (#1073 → #1866, 7.2.11), with a check that entity decorators are imported only from `/legacy`.
- **OR-8** — Sequencing: #1847, #1848, #1854 and #1855 may start before the MikroORM 7 switch
  (#1866); #1849, #1850, #1852 and #1853 wait for it.

The owner's answers of 2026-11-23 to this feature's open questions and to two questions shared with
its siblings are D-297 clauses too:

- **OR-9** — *Who changes constitution XIII and XV.* `specs/189-command-middleware/` lands the
  sentences that make command middleware constitutional (its `contracts/guard-seam-narrowing.md` §6,
  the XIII sentence included) in its own merge request. This feature then rewrites XV **around**
  them: it keeps them verbatim and does not touch XIII (`contracts/constitution-xv-amendment.md`).
- **OR-10** — *Who owns the origin type and the trust tier.* `specs/189-command-middleware/`
  (`contracts/module-origin.md`). This feature and `specs/188-policy-points/` consume it. 190
  defines no origin type, no tier type and no derivation function (FR-090).
- **OR-11** — *Release placement* (closes OQ-190-1). #1848 and #1855 are `breaking change` and
  **stay in 0.113.0**, which is a breaking release anyway because of MikroORM 7 (#1866). Each ships
  an upgrade note (FR-018). The lead applies the GitHub labels.
- **OR-12** — *Demo* (closes OQ-190-2). The public demo stays **bare core**. The reference overlay
  is exercised by tests and the instance acceptance fixture only (FR-096).
- **OR-13** — *Nightly leg* (closes OQ-190-3). **No** extra `backend-suite.yml` leg with
  `DEPLOYMENT=example`. Tests that need overlay tables set the deployment in-process and get their
  own template (FR-040).

## Clarifications

### Session 2026-11-23 (owner answers to the open questions)

- Q: Do #1848 and #1855 count as breaking, and in which release? → A: Breaking; 0.113.0 (OR-11).
- Q: Does the public demo run with `DEPLOYMENT=example`? → A: No, bare core (OR-12).
- Q: Does `backend-suite.yml` gain a `DEPLOYMENT=example` leg? → A: No (OR-13).
- Q: Who edits constitution XIII and XV? → A: 189 adds its sentences; 190 rewrites XV around them
  (OR-9).
- Q: Who owns the origin type and the trust tier? → A: 189 (OR-10).

### Session 2026-11-23 (architect; owner decisions above taken the same day)

- Q: Are overlay entities and migrations baked into the committed registries
  (`entities-registry.generated.ts`, `migrations-registry.generated.ts`)? → A: **No.** They are
  discovered at runtime, in both trees, exactly as an installed package's are; the committed
  registries stay bare core under every value of `DEPLOYMENT` (D-104). `composer:generate` stops
  refusing overlay schema and validates it instead (research R-4).
- Q: Where does an instance's overlay build emit? → A: Mirrored out of tree, the layout this
  repository already uses (`backend/src/apps` → `backend/dist/apps`): an instance compiles
  `<root>/apps/**` to `backend/dist/apps/**`, and every compiled process receives
  `backend/dist` as its deployment root (research R-2).
- Q: How does a static admin build get a deployment's screens without leaking another deployment's?
  → A: One registry artefact **per deployment**, selected at admin build time by `DEPLOYMENT`;
  the bare-core registry is unchanged (research R-8).
- Q: Which overlay files are fixed by name? → A: Three entry points (`manifest.ts`, `backend.ts`,
  `i18n/`) plus three discovered locations that are fixed once a module uses the capability
  (`migrations/`, `admin/index.tsx`, `ports.ts`); everything else is convention
  (`contracts/overlay-module-layout.md`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — An instance author ships an overlay module that owns a table (Priority: P1)

An instance developer writes `apps/acme/modules/acme_loyalty/` with an organization-scoped entity
`LoyaltyAccount`, exports it from `backend.ts`, scaffolds a migration with
`pnpm exec endora new migration acme_loyalty --name create-loyalty-accounts`, runs
`pnpm run setup`, and the table exists, the module composes, its routes read and write rows, and
another organization's rows are invisible.

**Why this priority**: it is the capability the umbrella exists for; without it the only route to an
instance-owned table is a tarball package.

**Independent Test**: a fixture instance (the acceptance fixture of `specs/110-instance-repository/`)
with one overlay module owning one entity and one migration: `setup` succeeds, `module:status`
lists the applied migration under the module, a cross-tenant read returns "not found".

**Acceptance Scenarios**:

1. **Given** an overlay module exporting `entities` from `backend.ts` and holding one migration in
   `migrations/`, **When** `pnpm run migrate` runs, **Then** the migration is applied in the
   module's topological position and recorded under its class name.
2. **Given** the same module, **When** its migration writes a table another module owns,
   **Then** `migrate` refuses with the foreign-schema error naming the overlay module, the
   migration and the table, and nothing is committed.
3. **Given** an overlay entity carrying no tenancy classification, **When** any process starts,
   **Then** it refuses before opening a connection, naming the entity and its module.
4. **Given** an entity class under the module's `entities/` that `backend.ts` does not export,
   **When** discovery runs, **Then** it refuses, naming the class and the file.

---

### User Story 2 — Overlay code is compiled and type-checked (Priority: P1)

The instance's `build`, `dev` and `setup` compile every overlay module with one `tsc` project and
type-check it against the installed packages' declarations. A type error, an `enum`, or a compiled
file older than its source is reported before anything boots.

**Why this priority**: decorated entities need a build (OR-2), and an unchecked overlay turns every
platform upgrade into a run-time surprise.

**Independent Test**: in the fixture instance, introduce (a) a type error, (b) an `enum`, (c) an
edit after the last build; each is reported by the named command with the file, and (c) is refused
at boot naming both files.

**Acceptance Scenarios**:

1. **Given** an overlay source with a type error, **When** `pnpm run build` (or `setup`) runs,
   **Then** it exits non-zero naming the file and line.
2. **Given** an overlay source using `enum`, **When** the type-check runs, **Then** it is reported
   under `erasableSyntaxOnly`.
3. **Given** a source edited after the last build, **When** the API, the worker, `migrate` or a
   `module:*` command starts, **Then** it refuses, naming the source and the stale compiled file
   and the command that rebuilds.
4. **Given** a `package.json`, an `exports` map or a per-module `tsconfig*.json` under `apps/`,
   **When** the build or any process runs, **Then** it refuses, naming the file.

---

### User Story 3 — An overlay module has an admin screen and a palette action (Priority: P2)

The overlay ships `admin/index.tsx` exporting its contributions (a landing route, a sidebar entry)
and declares a palette action in its manifest. After `endora generate` and the admin build the
screen is reachable under ⌘K, permission-gated, labelled in Polish and English, and absent while the
module is off.

**Why this priority**: Principle XVI makes palette reachability mandatory for any module with an
admin surface; without it an overlay with data has no operator surface.

**Independent Test**: the reference overlay in `backend/src/apps/example` (US8) built with
`DEPLOYMENT=example`: its landing route renders, the palette lists its action for a role holding the
code and hides it otherwise, and per-deployment palette coverage passes.

**Acceptance Scenarios**:

1. **Given** an overlay with `admin/index.tsx`, **When** the admin is built for that deployment,
   **Then** its contributions are in the bundle; built for another deployment or for bare core,
   **Then** they are not.
2. **Given** the module is switched off, **When** an operator opens the admin, **Then** no sidebar
   entry, route or palette action of the module is visible (Principle XVII).
3. **Given** an overlay contributing a landing route and no palette action, **When** coverage runs
   for that deployment, **Then** it fails with `module-without-action`.

---

### User Story 4 — One overlay module depends on another's port (Priority: P2)

`acme_reports` depends on `acme_loyalty` and resolves its port through `lazyPort`, typed by a
`import type` from `apps/acme/modules/acme_loyalty/ports.ts`. Switching `acme_loyalty` off while
`acme_reports` is on is refused naming the dependent.

**Why this priority**: an instance's customisation is rarely one module; splitting into modules with
dependencies is the layout rule (no nesting), and it needs a typed synchronous seam.

**Independent Test**: two fixture overlay modules; a type import of `ports.ts` passes the boundary
analysis, a value import or an import of any other file is reported; dependency fail-closed holds on
both axes.

**Acceptance Scenarios**:

1. **Given** a type-only import of another overlay module's `ports.ts` in the same deployment with
   the dependency declared, **Then** the boundary analysis passes.
2. **Given** the same import without the dependency, or a value import, or an import of
   `services/x.ts`, **Then** it is reported, naming both modules and the file.
3. **Given** `acme_reports` effectively present, **When** an operator switches `acme_loyalty` off,
   **Then** the switch is refused naming `acme_reports`.

---

### User Story 5 — Overlay tables follow the ordinary module lifecycle (Priority: P2)

`module:install` applies an overlay's pending migrations, `module:status` reports them, soft
uninstall and deactivation keep the tables and rows, `module:uninstall --hard --force` reverts the
module's migrations and drops its tables, and the divergence report records what the module adds to
other modules' tables.

**Independent Test**: lifecycle integration test over a fixture overlay with one table: install →
status → disable (rows intact, routes 503) → enable (rows back) → hard uninstall (table gone).

**Acceptance Scenarios**:

1. **Given** a boot-converged overlay module (registered at first boot), **When**
   `module:install --all` runs, **Then** its pending migrations apply and its install hook runs
   (the repair path of `bootConvergedAt`).
2. **Given** the module is deactivated, **Then** its routes answer `MODULE_DISABLED`, its workers do
   not run, its tables and rows are untouched (off-state test).
3. **Given** `module:uninstall acme_loyalty --hard --force`, **Then** every migration the module owns
   is reverted in reverse order and its registry row is deleted.

---

### User Story 6 — An overlay declares `x_*` columns on an extensible host (Priority: P3)

`acme_erp` declares `defineColumnExtension({ host: 'organizations', module: 'acme_erp', … })` in its
`backend.ts` `schemaExtensions` export; after `migrate`, `organizations.x_acme_erp_*` exists, is
ledgered, verified at boot and listed by `module:schema-extensions`, exactly as for a package.

**Independent Test**: the `specs/178-extensible-columns/` suite's package fixtures re-run with the
declaring module as an overlay.

**Acceptance Scenarios**:

1. **Given** an overlay declaration satisfying V9 – V11, **Then** the generated step runs at the head
   of the overlay's block and the ledger rows carry the overlay's module id.
2. **Given** the overlay is hard-uninstalled, **Then** its columns stay, marked `orphaned`.

---

### User Story 7 — No process boots with an unclassified entity (Priority: P2)

Whatever its origin — core, workspace package, installed package or overlay — an entity class in the
ORM configuration without a tenancy classification stops every process before a connection opens.

**Independent Test**: a fixture package and a fixture overlay each registering one undecorated
entity class; both refuse, naming class and module.

---

### User Story 8 — A reference overlay in this repository (Priority: P3)

`backend/src/apps/example` gains `example_erp_keys`: a side table on `organizations` holding a unique
external ERP key (declared per `specs/187-side-table-extensions/`), filled by a `beforeCommit` hook
on `organization.create`, read through `include: ['extensions.example_erp_keys']`, a published
port, an admin screen and a palette action, with off-state and uninstall tests. It is both the
regression net for this feature in this repository and the worked example for instance authors.

---

### User Story 9 — An overlay is promoted to a package (Priority: P3)

A deployment moves `acme_loyalty` from `apps/acme/modules/` into a module package and installs it.
Because the id is unchanged, the database records no pending migration and no lost one.

**Acceptance Scenarios**:

1. **Given** a database migrated with the overlay, **When** the same module arrives as an installed
   package with the same id and migration classes, **Then** `migrate` applies nothing and
   `module:status` shows the module installed with origin `package`.

### Edge Cases

- **A database migrated as deployment A, run as deployment B.** A's overlay migrations stay recorded
  and A's tables stay in place, unmapped; B composes without them. A B overlay table colliding with
  an A table fails at `create table`, loudly. A database belongs to one deployment; the docs say so.
- **Hard uninstall while the directory is still shipped.** The registry row is deleted and the tables
  dropped; the next boot converges the module back (it is deployment-shipped, like a core module in
  this repository) and the next `migrate` recreates its tables empty. The documented removal order is
  hard-uninstall, then ship the tree without the directory (or omit the module in `divergence.ts`).
- **A compiled tree whose sources are absent** (an image that copied only `dist`). The freshness guard
  has no source to compare and says so in one log line; it never refuses for that reason.
- **An overlay module directory with sources and no compiled counterpart** (added after the last
  build): refused as `unbuilt`, never silently absent.
- **A compiled unit whose source was deleted** (`tsc` does not remove outputs): refused as `orphan`.
- **A nested `manifest.ts` inside a module** (an attempt to nest modules): refused as
  `nested-module`; the remedy is a sibling module with a dependency.
- **An overlay entity on a table already mapped by another module's entity**: refused by MikroORM's
  duplicate-table check before any query (`specs/178-extensible-columns/` context), and by the
  foreign-schema guard at `migrate`.
- **An overlay migration class whose name does not begin with the module segment**: refused by
  `orderMigrations` as `unscoped-name`, as for every origin.
- **An overlay migration stamped at or below `BASELINE_THROUGH`**: ordered by its module, never joins
  the frozen prefix (membership is by identity, R1.2); `endora new migration` clamps the stamp.
- **Two deployments in one instance, each with a module of the same id**: legal — only one deployment
  is composed per process; id claims are checked within the composed set.

## Requirements *(mandatory)*

### Functional Requirements

**A. Ruling and layout**

- **FR-001**: An overlay module MAY own entities and migrations, declare `x_<moduleId>_*` columns,
  declare side tables (`specs/187-side-table-extensions/`), publish a port, and ship admin
  contributions and palette actions — in an instance and in this repository's `backend/src/apps/`.
- **FR-002**: An overlay module MUST be discovered only at
  `apps/<deployment>/modules/<id>/` (flat); a `manifest.{ts,js}` anywhere below a module's root MUST
  be refused as `nested-module`.
- **FR-003**: A `package.json`, a file declaring an `exports` map, or a build or test configuration
  (`tsconfig*.json`, `tsup.config.*`, `vite.config.*`, `vitest.config.*`) inside an overlay module
  directory MUST be refused as `package-in-disguise`, naming the file, by the build and by every
  process that resolves overlay modules.
- **FR-004**: The fixed entry points are `manifest.ts`, `backend.ts` and `i18n/`; `migrations/`,
  `admin/index.tsx` and `ports.ts` are fixed once the module uses that capability; every other path
  is the module's own (`contracts/overlay-module-layout.md`).
- **FR-005**: D-106 MUST be recorded as retired for overlays; D-106.2 (packages may ship schema) is
  unchanged.

**B. Type-check and build**

- **FR-010**: Overlay code MUST be type-checked with `erasableSyntaxOnly: true` against the installed
  packages' published declarations — in an instance by a project the template writes, in this
  repository by a program that holds `backend/src/apps/**`.
- **FR-011**: The instance's `setup`, `build` and a new `typecheck` script MUST run that check.
- **FR-012**: Overlay code MUST be compiled by exactly one deployment-level `tsc` project emitting
  the mirrored layout `apps/**` → `backend/dist/apps/**`, with `experimentalDecorators` on; no
  per-module build MUST exist. No new runtime dependency.
- **FR-013**: The build MUST also place every overlay module's runtime assets (`i18n/*.json` and any
  file the runtime-asset classification marks runtime) beside the compiled units.
- **FR-014**: `dev` MUST rebuild overlay code on change (`tsc --watch`) and re-place assets on change.
- **FR-015**: Every process that resolves overlay modules from a compiled tree, given the source
  root, MUST compare every source file of every overlay module with its compiled counterpart and
  refuse on `stale` (source strictly newer), `unbuilt` (no counterpart) or `orphan` (counterpart
  with no source), naming both paths and the rebuild command. With no source root it MUST log once
  that the comparison was not made.
- **FR-016**: Compiled processes of an instance MUST receive `backend/dist` as their deployment root
  and `<instance root>` as the deployment source root; the CLI's tree readers keep reading sources.
- **FR-017**: `endora upgrade` MUST rewrite the affected wiring files of an existing instance and
  add the overlay project, so an instance with overlay modules keeps booting after the upgrade.
- **FR-018**: The changesets of #1848 (overlay build, FR-012 – FR-017) and #1855 (admin layer,
  FR-080 – FR-084) MUST ship in **0.113.0** as `breaking change` (OR-11). Each changeset body MUST
  carry an upgrade note that the 0.113.0 section of `docs/docs/upgrading-an-instance.md` (EN and PL)
  can take over unchanged. The note names the wiring files `endora upgrade` rewrites, the new
  `build` / `dev` / `typecheck` scripts, and, for #1855, the admin image's `DEPLOYMENT` build
  argument. It also says what to do with a wiring file the instance hand-edited: the upgrade reports
  it and does not overwrite it, so the operator re-applies the edit to the new rendering.

**C. Classification at boot**

- **FR-020**: `configuredEntitiesFrom` MUST refuse, before returning, when any entity class it
  registers carries no tenancy classification (`@OrgScoped`, `@CustomerScoped`, `@GlobalEntity`,
  `@TransitivelyScoped`, `@RuleScoped`) or carries more than one, naming each class and the module
  that contributed it; it applies to every origin.
- **FR-021**: Embeddables and abstract bases are not entities for FR-020, as MikroORM's own metadata
  says, never by a name list.
- **FR-022**: Entity decorators in overlay code MUST come only from `@mikro-orm/decorators/legacy`;
  the check #1866 introduces MUST include overlay sources in both trees.

**D. Schema discovery**

- **FR-030**: An overlay module's `backend.ts` MAY export `entities` (an array of classes) and
  `schemaExtensions`, read with the package reader's rules (refuse a non-array, refuse a non-class).
- **FR-031**: An overlay module's `migrations/` directory MUST be read file by file (no barrel): each
  runtime unit exports exactly one migration class whose name is the one its filename derives
  (`Migration<STAMP><PascalCaseTail>`); a file with none, with two, or with a mismatched name MUST
  be refused.
- **FR-032**: Every class exported from a file under the module's `entities/` that carries entity
  metadata MUST appear in `entities`, or discovery refuses with `overlay-entity-unexported`.
- **FR-033**: Overlay entities and migrations MUST be merged with origin `overlay` into the ORM
  entity set and the migration order by the same merge as packages; dependencies come from the
  overlay's manifest.
- **FR-034**: Every overlay migration MUST run inside `guardExternalMigration` with the overlay's own
  entities as its owned set and **no** exemption entries (OR-4).
- **FR-035**: `migrate`, `configuredEntitiesFrom` and `discoverConfiguredMigrations` MUST receive the
  deployment root; with `DEPLOYMENT` unset or no overlay root they behave exactly as today.
- **FR-036**: Migration ownership MUST cover every overlay module id, so `uninstall --hard` can
  enumerate an overlay's chain.
- **FR-037**: The schema refusals — `overlay-schema.ts` (both functions), the CLI's
  `overlaySchemaFiles`, and the generator's overlay branches in `generate-composer.ts` — MUST be
  deleted in the same change that lands FR-030 – FR-036.
- **FR-038**: The committed core registries MUST stay bare core under every value of `DEPLOYMENT`;
  `composer:generate` MUST validate overlay schema (naming, scoped class names, classification) and
  emit none of it.
- **FR-039**: The test harness's migration-template identity MUST include overlay migrations of the
  deployment under test as their own origin.
- **FR-040**: Backend tests that need overlay tables MUST set `DEPLOYMENT` in-process and run on
  their own migration template (FR-039). They MUST be few and grouped. No `backend-suite.yml` leg
  with `DEPLOYMENT=example` is added (OR-13).

**E. Lifecycle**

- **FR-045**: `module:install` MUST apply an overlay's pending migrations; `module:status` MUST list
  them per module; `module:uninstall --hard` MUST revert them; soft uninstall and deactivation MUST
  leave tables and rows untouched.
- **FR-046**: An overlay with tables MUST ship an off-state test (Principle XVII) and an uninstall
  test; the off-state coverage check MUST count overlay modules.
- **FR-047**: Overlay `x_*` columns and overlay side-table declarations on another module's host MUST
  appear in the deployment's divergence report as divergences owned by the host's module; an
  overlay's own tables are its own surface and are listed under `notRecorded`.

**F. CLI**

- **FR-055**: `endora new module --entities [--tenant-scope <scope>]` in an instance MUST scaffold an
  overlay entity with exactly one tenancy decorator, its `entities` export and a first migration.
- **FR-056**: `endora new migration <moduleId> --name <slug>` MUST write a correctly named,
  module-scoped migration into the overlay module's `migrations/`, stamp clamped above
  `BASELINE_THROUGH`, refusing an id that is not an overlay module of the selected deployment.
- **FR-057**: This repository's `migration:new --module <id>` MUST accept an overlay module id and
  write into `backend/src/apps/<deployment>/modules/<id>/migrations/`, using the same naming code.
- **FR-058**: The test-kit entity index MUST include overlay entities.
- **FR-059**: `--admin`, `--action` and `--ports` MUST be lifted for overlays and scaffold the fixed
  files of FR-004.

**G. `x_*` columns**

- **FR-065**: Overlay `schemaExtensions` MUST be validated by the same rules V9 – V11 with an overlay
  context (module id = overlay id, dependency closure over the composed graph), and flow through the
  same generator, ledger, verifier and `module:schema-extensions` output.
- **FR-066**: Uninstalling the declaring overlay MUST keep its columns marked `orphaned`, as for a
  package.

**H. Ports and dependencies**

- **FR-070**: An overlay module MAY publish its port's types in its own `ports.ts`; another overlay
  module **of the same deployment** MAY import that file **type-only**, provided it declares the
  owner in `dependencies`.
- **FR-071**: Any other import between overlay modules (value import, another file, another
  deployment) MUST be reported by the boundary analysis — `check:module-boundary` here, `endora
  generate` in an instance — from one shared analysis.
- **FR-072**: Manifest `dependencies` between overlay modules MUST behave as between any modules:
  composition, migration order, dependency fail-closed on both activation axes, install refusal of a
  missing dependency.

**I. Admin layer**

- **FR-080**: An overlay module's `admin/index.tsx` exporting `contributions` MUST be included in a
  **per-deployment** admin registry; the bare-core registry is unchanged.
- **FR-081**: The admin build MUST select the registry of the deployment it is built for
  (`DEPLOYMENT`), refuse a named deployment with no registry, and include none for bare core.
- **FR-082**: The admin stylesheet enumeration MUST scan every overlay admin layer on disk.
- **FR-083**: The admin type-check MUST include overlay admin layers; the backend overlay project
  MUST exclude them.
- **FR-084**: Overlay admin code MUST resolve the same single copies of `react`, `react-dom`,
  `@endora-commerce/admin-kit` and `@endora-commerce/admin-shell` as the admin project.
- **FR-085**: Palette coverage (landing, sidebar, `module-without-action`) MUST run per deployment —
  in this repository over every deployment on disk, in an instance inside `endora generate`.
- **FR-086**: The permission inventory, action-route permissions and bundle-shape checks MUST cover
  overlay admin layers per deployment.

**J. Trust tier** *(consumed from `specs/189-command-middleware/contracts/module-origin.md`, OR-10)*

- **FR-090**: An overlay module MUST compose with module origin `deployment` exactly as 189's
  contract derives it, from the root the loader found the module under and never from a manifest
  field, through 189's `moduleOriginOf` (discovery `overlay` → `deployment`). This feature MUST NOT
  define a second origin type, tier type or derivation function, and MUST keep `ModuleOrigin` (tier)
  and `ModuleIdClaimOrigin` (discovery, still `overlay`) apart as 189 §6 does.
- **FR-091**: An overlay that owns schema, a port or admin surfaces MUST still compose with origin
  `deployment`. Nothing in this feature widens what an installed package may do.

**K. Reference overlay**

- **FR-095**: `backend/src/apps/example/modules/example_erp_keys/` MUST exist as US8 describes, with
  off-state, uninstall, cross-tenant and promotion-name tests, and `composer:generate` /
  `overlay:check` green for every deployment.
- **FR-096**: The public demo MUST stay bare core: no demo build or deployment configuration sets
  `DEPLOYMENT=example` (OR-12).

**L. Documentation and constitution**

- **FR-100**: Constitution XV MUST receive a MINOR amendment (`contracts/constitution-xv-amendment.md`),
  written around the XV sentences `specs/189-command-middleware/` lands first and keeping them
  verbatim. This feature MUST NOT edit XIII (OR-9).
- **FR-101**: `specs/conventions/overlay-modules.md` MUST replace the D-106 paragraph with D-297,
  gain the *Overlay module layout* section, and drop the stale `services/` sentence.
- **FR-102**: `module-migrations.md`, `module-admin-surfaces.md` and the published pages
  (`overlay-pattern`, `customisation-ladder`, `schema-extensions`, `migrations`,
  `create-your-first-module`) MUST be updated in English and Polish; the data ladder's *Who* column
  for D1/D2 gains "a deployment overlay".
- **FR-103**: The same documentation pass MUST cover command middleware (from closed #1842): the
  ladder lists `admit` / `observe` beside command hooks, marks decoration of the four guard seams
  (`GUARD_SEAM_REGISTRATIONS`: `commandBus`, `auditLogService`, `eventBus`, `emFactory`) deprecated
  in 0.113.0 and refused in 0.114.0 per #1841, states that every other root-supplied name stays
  decoratable, and gives a migration example from a bus wrap (metrics, rate limit) to `observe` / `admit`.
- **FR-104**: Each implementation change MUST update, in the same merge request, the convention
  sentence it falsifies; FR-102's published pages may follow in the docs pass.

### Key Entities

- **Overlay module** — a module discovered under a deployment's overlay root; identity = its
  directory name = manifest id; module origin `deployment` (189's `ModuleOrigin`, OR-10); migration
  origin `overlay` (R-7).
- **Overlay schema contribution** — the overlay counterpart of `PackageSchemaContribution`: entities,
  migrations, schema extensions, dependencies, source label (`data-model.md` §1).
- **Deployment admin registry** — one generated artefact per deployment listing its overlay admin
  contributions (`data-model.md` §4).
- **Overlay build freshness verdict** — `fresh | stale | unbuilt | orphan` per overlay file pair.

## Success Criteria *(mandatory)*

- **SC-001**: In the fixture instance, an overlay module with one entity and one migration goes from
  `endora new module --entities` to a working cross-tenant-safe route with `setup` and no hand edit
  outside the module directory.
- **SC-002**: Every one of the refusals in FR-002, FR-003, FR-015, FR-020, FR-031, FR-032 and FR-034
  has a red test that provokes it and a green test that does not.
- **SC-003**: `rg` finds no implementation of an "overlay contributes no schema" refusal in
  `packages/` or `backend/scripts` after FR-037 lands.
- **SC-004**: An instance built for deployment A contains no module code of deployment B (asserted by
  a bundle-content test over two fixture deployments).
- **SC-005**: Boot cost of the freshness guard ≤ 30 ms for a deployment with 20 overlay modules
  (stat calls only, measured in the fixture).
- **SC-006**: A promoted module (US9) migrates to "nothing pending" on a database migrated as an
  overlay.

## Assumptions

- `specs/187-side-table-extensions/` lands the side-table declaration origin-agnostically (#1834)
  and the extension-attribute read (#1835) is owned by a sibling spec; US8 consumes both as
  published.
- `specs/189-command-middleware/` owns the module origin type, its derivation, the capability matrix
  and the D-156.4 narrowing (OR-10). It lands its XIII / XV sentences before WP11 (OR-9). This
  feature consumes all of it and supplies none of it.
- #1866 (MikroORM 7.2.11, legacy decorators) merges before Phase 2 of `plan.md`.
- The instance acceptance fixture of `specs/110-instance-repository/` remains the instrument for
  instance-side behaviour.

## Decisions *(D-297 — owner decisions of 2026-11-23, plus the architect's design choices)*

**D-297** — *Overlay modules are full modules.* It retires D-106 **for overlays** (D-106.2 stands):
an overlay module may own schema, ports and admin surfaces, in an instance and in this repository,
under the same guards as a package and with no deployment exemption; it is compiled by one
deployment-level build; its tier is "deployment", derived from origin; a promoted module keeps its
id. OR-1 – OR-13 above are its owner clauses. OR-1 – OR-8 are the owner decisions of 2026-11-23.
OR-9 – OR-13 are the owner's answers of the same day to OQ-190-1 – OQ-190-3 and to the cross-spec
questions on the constitution and the origin type. The architect's design choices under it are
R-1 – R-16 in `research.md`; none reopens an owner clause.

### Open questions for the owner

None open. The three questions were closed by the owner on 2026-11-23:

- **OQ-190-1 (release placement)** — closed → **OR-11**: #1848 and #1855 are `breaking change` and
  stay in 0.113.0, with upgrade notes (FR-018).
- **OQ-190-2 (demo)** — closed as recommended → **OR-12**: the demo stays bare core (FR-096).
- **OQ-190-3 (nightly leg)** — closed as recommended → **OR-13**: no extra `backend-suite.yml` leg;
  the tests set the deployment in-process on their own template (FR-040).
