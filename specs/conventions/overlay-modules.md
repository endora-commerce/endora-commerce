# Overlay modules — per-deployment customization (feature 057)

**Open this before writing or changing anything under `backend/src/apps/<deployment>/`** — an
overlay module, a service decoration, an interceptor, or a deployment's divergence
declaration. One of the bodies `AGENTS.md` routes to; it is the single home for these rules,
so never restate them in `AGENTS.md` or in a tool-specific pointer file.

A **client-only overlay module** lives under `backend/src/apps/<deployment>/modules/<id>/` and
is discovered without editing the shared core registry (`REGISTERED_MANIFESTS` stays
untouched — FR-004). It is an ordinary lifecycle participant, so every checklist `AGENTS.md` routes to
applies, with one difference: its admin permissions must appear on `/admin-roles` and pass
the permission-inventory check **for that deployment** — run the inventory test with
`DEPLOYMENT=<name>` set. Overriding a core **service** is a **decoration**, not a file
shadowing it (feature 072), and there is exactly one way to write one: from the deployment's
own overlay module, `ctx.di.decorate('<registrationName>', (inner) => …)`, which receives the
core implementation and returns one that delegates to it, so core fixes keep flowing.
`backend/src/apps/example/modules/example_overlay/backend.ts` is the worked example.

**There used to be a second way, and it is retired** — a file under
`backend/src/apps/<deployment>/decorations/`, named after the registration it wraps, exporting
`decorate(inner)`. It existed because feature 072 predated D-103: an overlay module was then a
`plugin.ts` over a frozen seven-field context that could not decorate anything, so a
deployment that wanted to wrap a service and did not want to write a module had nowhere else
to go. D-103 made an overlay module an ordinary composed participant with the whole
`ModuleContext`, which left the file seam redundant — and worse than redundant: it was
documented as the general service-override mechanism and wired for exactly **one** hard-coded
registration name, so any other file in that directory was imported, keyed, and discarded
without a warning. Do not reintroduce it; do not look for it in a client tree.
**One thing was genuinely given up with it.** The file imported the owner's
`*.interface.ts`, so `tsc` refused a wrapper that had stopped matching the interface —
feature 057's contract gate. `ctx.di.decorate<T>` asserts `T` at the call site and compares it
to nothing, so the wrapped shape is now declared **structurally** and interface drift is a
runtime surprise rather than a build failure. The cheap way to get the gate back, when a
deployment wants it, is for the owning module to publish its interface on its package's
`./ports` subpath and for the overlay to name it there — a type-only `./ports` reach is not a
boundary reach (D-171).
**Decorating across owners is the deployment's alone** (issue #203):
`ctx.di.decorate` refuses a module that wraps a registration it did not register — including
one a composition root registered, which no module owns — because decoration rewrites what
every consumer of that name resolves, and a core module wrapping `commandBus`,
`auditLogService` or another module's read port is a coupling nothing declares. Ask the owner
for a seam instead (a port, a contribution point, an event). An overlay module is exempt, and
the exemption is structural: `loadOverlayModuleEntries` marks an entry `overlay: true` from
the root it was discovered under, so core cannot assert it.
**An overlay module ships `backend.ts`, not `plugin.ts`** (D-103). It is composed by the
kernel container exactly as a core module is — appended to the core list in the one
`composeModules` call — and uses `ctx.routes` / `ctx.worker` / `ctx.subscribe` /
`ctx.interceptors` / `ctx.di.decorate`. The second path is gone: it could gate no route, and
the one reference overlay module in the tree shipped an ungated one for as long as it existed.
A deployment's modules are **discovered at runtime**, so `composition.generated.ts` and
`manifest-index.generated.ts` are bare core under every value of `DEPLOYMENT` (D-104).
**A deployment's divergence from core is a committed artefact** (feature 107, D-30). Every build
emits `divergence.generated.ts` and `divergence.generated.md` per deployment plus bare core, from
**one** derivation over the deployment's own overlay tree: the kinds `DivergenceKind` lists, each
with the module that wrote it, the module that owns what it names, the rung of the customisation
ladder it sits on and the deployment's own sentence. An overlay's own tables are not among them —
they are its own surface, named under `notRecorded` — while a `defineColumnExtension(…)` it
declares on another module's table is (`column-extension`, owned by the host's module, data ladder
D2; FR-047). Beside them is the hand-written
`backend/src/apps/<deployment>/divergence.ts`, which carries the three things no walk can produce —
the modules the deployment omits, the wrapping order where two of its overlay modules decorate one
name (`decorationOrder`, **checked and never applied**), and one reason per derived divergence. The
two are reconciled **both ways** by `check:divergence`, and both renderings are under
`overlay:check`'s four verdicts. Which seam to reach for and what each costs is
`docs/docs/architecture/customisation-ladder.md`; the rung on every report entry is what makes
arriving repeatedly at a high one measurable rather than anecdotal.
**An overlay module is a full module, and owns its schema** (D-297, retiring D-106 for
overlays; `specs/190-overlay-full-modules/`, owner clauses OR-1 – OR-13, issue #1846). D-106.2
below is unchanged. What D-297 holds every overlay module to:

- **It may own entities and migrations.** `backend.ts` exports `entities` (an array of classes),
  and every class under the module's `entities/` that carries entity metadata must be in it
  (`overlay-entity-unexported`). Each entity takes exactly one tenancy classification and
  decorators from `@mikro-orm/decorators/legacy`. Migrations are the module's `migrations/`
  directory, read **file by file** — no barrel: each runtime unit is named
  `<YYYYMMDDTHHmmss>_<module-segment>_<slug>` and exports exactly one class whose name the
  filename derives, scoped by the module id (`migration-file-shape`). It may declare
  `schemaExtensions` as an installed package does (OR-3). The reader is the platform's
  `overlay/overlay-schema.ts`, the counterpart of `discoverPackageSchema`; the merge is the one
  `db/configured-{entities,migrations}.ts` already do for packages, with migration origin
  `overlay` (R-7).
- **Discovered at runtime, never committed.** Which deployment a process runs as is a fact about
  the process (D-104), so the overlay's schema is read from the deployment root the application
  supplies, and `entities-registry.generated.ts` and `migrations-registry.generated.ts` stay bare
  core under every `DEPLOYMENT`. `composer:generate` **validates** an overlay module's schema —
  classification, `/legacy` imports, filename and class agreement, the scoped name, uniqueness
  beside core — and emits none of it. With `DEPLOYMENT` unset the configuration is byte-identical
  to bare core.
- **No deployment exemption** (OR-4). An overlay migration runs inside the foreign-schema guard
  every installed package's does, with the module's own entities as its owned set and **no**
  exemption entry: R2's first-party ledger does not reach it, and `check:module-boundary` will not
  let an R2 entry excuse one. Its chain is ordered by its manifest's `dependencies` and owned by
  its module id, so `uninstall --hard` reverts it.
- **In both trees** (OR-3). It holds in a client's instance, whose `mikro-orm.config.ts` hands the
  platform `backend/dist`, and in this repository's `backend/src/apps/`, where
  `backend/src/db/configured-*.ts` bind `overlay-roots.ts`' deployment root.
  `apps/example/modules/overlay_notes_fixture/` is the smallest one that owns a table. A backend
  test that needs an overlay table selects the deployment **in-process** and takes that
  deployment's own migration template (`test/helpers/deployment-database.ts`); no suite leg runs
  with `DEPLOYMENT=example` (OR-13).
- **One build, no package in disguise.** Overlay code is compiled by one deployment-level `tsc`
  project (#1848). There is no per-module build, and no `package.json`, `exports` map or build
  configuration under `apps/`. In an instance that project is run by `endora build overlays`
  (the backend member's `build` and `dev`), which also mirrors each module's `i18n/` into
  `backend/dist/apps`. Two refusals hold it, in the build and in every process that resolves
  overlay modules: the layout (`nested-module`, `package-in-disguise` — platform
  `overlay/overlay-layout.ts`, the CLI's twin `build-overlays/layout.ts`, held to agree) and the
  freshness of the compiled tree against its sources (`stale`, `unbuilt`, `orphan` — platform
  `overlay/overlay-freshness.ts`, given `deploymentSourceRoot`).
- **The lifecycle of a module this build ships** (FR-045 – FR-046,
  `specs/190-overlay-full-modules/contracts/overlay-lifecycle.md`), not an installed package's:
  boot converges its registry row, `module:install` applies its pending migrations,
  `module:status <id>` lists them with origin `overlay`, switching it off or a soft uninstall
  keeps its tables and rows, and `uninstall --hard` reverts its chain. A tree that still ships
  the directory converges it back at the next boot and recreates its tables empty at the next
  `migrate`, so remove it by hard-uninstalling first. An overlay module with tables owes the
  off-state proof any switchable module does, and `check:off-state-coverage` counts those of
  every deployment on disk; its proof runs the server on the deployment's own database
  (`test/integration/overlay/overlay-notes-fixture-off-state.test.ts` is the template). This
  repository's `module:uninstall` script still answers for core alone
  (`coreMigrationOwnership()`), so a hard uninstall of an overlay module from that terminal is
  refused; an instance's answers for its overlays.
- **Its admin layer is `admin/index.tsx`** (FR-080 – FR-086, #1855), exporting the
  `contributions` a package's `./admin` layer exports. It lands in its deployment's own registry,
  `admin/src/deployments/<deployment>.generated.ts`, never in the bare-core one; the admin build
  selects one registry from `DEPLOYMENT` (unset is `none`, a missing one refuses the build). The
  admin's type-check owns the layer and the backend's overlay program excludes it. Palette
  coverage, the permission inventory, `check:action-route-permissions` and the bundle-shape test
  judge it per deployment — the checklists of `module-admin-surfaces.md` apply unchanged.
- **Promotion keeps the id.** A module promoted from an overlay to a package keeps its module
  id, so the migration class names a database has already recorded still match.
- **The trust tier is derived, never claimed.** An overlay module's tier is `deployment`, read
  from the `origin` the loader stamps on its module entry from where it discovered the module
  (`specs/189-command-middleware/contracts/module-origin.md`). No manifest field feeds it.

`endora new module --entities` does not scaffold an overlay module's schema yet (#1852); the
entity and the migration are written by hand until it does.

**D-106's stated reason is retired with it, so do not cite it.** That reason was "an overlay
lives in the same repository and the same build as core, so own the table from a core module
and read it through that module's port", and it has no referent in an instance, which depends on
released packages and has no core tree. The older migration-ordering argument stays retired as
well. It was measured false: per `specs/080-f4-real-scope/README.md` §2, adding a leaf module's
migrations leaves the relative order of all 141 existing ones exactly unchanged. The three walks
that refused overlay schema — the composer's, `endora generate`'s and the platform's — are
deleted with the refusal.
**An extension package may ship entities and migrations** (D-106.2, an owner ruling). A
third-party author has no core module, so for a package the same rule would not be a constraint
to design around but a prohibition on the entire extension-package programme, every family of
which persists state. The platform discovers a package's schema at runtime
(`discoverPackageSchema`, `packages/platform/src/packages/package-runtime.ts`) and runs every
package migration under the foreign-schema guard (`packages/platform/src/db/foreign-schema-guard.ts`).
See `docs/docs/architecture/overlay-pattern.md` and
`specs/057-overlay-pattern-multideploy/`.

