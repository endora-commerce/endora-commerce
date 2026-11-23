# Research — Overlay modules as full modules (190, D-297)

Every entry is **decision → rationale → alternatives rejected**. Evidence is `origin/master` at
`ff7efc3e8`. R-1 is the owner's; R-2 – R-16 are the architect's choices under D-297 and reopen no
owner clause.

## R-1 — One concept: the overlay module becomes a full module (owner, OR-1)

**Decision.** No "local instance package". The overlay module gains schema, ports and admin.

**Rationale.** An overlay is already an ordinary composed participant (D-103) with the whole
`ModuleContext`, a manifest, lifecycle, permissions and i18n. What it lacks is three discoveries
(schema, admin, port types) and a build — all four are additive to the existing loader.

**Rejected.** *Local instance packages beside overlays* — two concepts for one author, a migration of
every existing overlay, a package build per module, and no capability overlays cannot get.

## R-2 — Build output: mirrored out of tree, `backend/dist/apps` in both trees

**Decision.** One deployment-level project compiles `apps/**/*.ts` (admin layers excluded). In an
instance: `backend/tsconfig.apps.json` with `rootDir: "../apps"`, `outDir: "dist/apps"`,
`experimentalDecorators` (and whatever decorator options #1866 leaves in the instance backend),
`erasableSyntaxOnly`, `paths: {}` so the program resolves the installed packages' `dist` types. Every
compiled process of an instance takes `backend/dist` as its deployment root — the same relation this
repository already has (`backend/src/apps` → `backend/dist/apps`, deployment root `backend/src`
under `tsx`, `backend/dist` compiled). The instance root is passed as the **deployment source root**
(R-9).

**Rationale.** One layout and one pairing rule in both trees; `resolveOverlayUnit`'s `.js`-first
resolution is used as built; editors and the test kit never see emitted files inside the source
tree; the image already copies the whole tree and runs `build:backend`
(`packages/cli/src/new-instance/deploy.ts`, backend Dockerfile), so the compiled overlays ship by
construction.

**Rejected.**
- *Build-less entities with `defineEntity`* (owner rejected): ~10 platform changes and two entity
  idioms for good.
- *In-place emit (`.js` beside `.ts` under `apps/`)*: the `.js`-first loader then prefers a stale
  emitted file over an edited source in exactly the edit loop; it needs gitignore patterns inside a
  tree the client edits; go-to-definition lands in emitted code; and this repository would keep a
  second pairing rule.
- *Per-module builds or tsup*: that is a package (OR-2), and tsup is a new dependency.
- *Emitting to `<root>/dist/apps`*: a third root no process has today; `backend/dist` is already the
  compiled backend's root and the admin image does not read it.

## R-3 — The build driver and runtime assets: `endora build overlays`

**Decision.** A CLI subcommand, no new dependency: (1) runs the layout refusals of R-15; (2) spawns
the instance's **own** `typescript` (`tsc -p backend/tsconfig.apps.json`, `--watch` passed through);
(3) mirrors runtime assets (`i18n/*.json` and every file the runtime-asset classification marks
runtime) into the output, re-mirroring on change in watch mode (`fs.watch`, recursive). The
classification moves from `backend/scripts/lib/runtime-assets.ts` into `packages/cli/src/lib/` and
this repository's `copy-runtime-assets.ts` imports it — one rule, two readers. Instance scripts:
`build: "tsc -p tsconfig.json && endora build overlays"`, `dev` runs `endora build overlays --watch`
beside the existing `tsc --watch` and `node --watch`.

**Rationale.** `tsc` does not copy unimported files, and the `_i18n` reconciler takes
`dirname(filePath)` of the manifest and **logs and skips** a missing bundle directory — so a
`tsc`-only build renders every overlay palette label as a raw key with nothing failing
(`specs/conventions/module-migrations.md`, the `manifestPath` paragraph).

**Rejected.**
- *`tsc` alone*: the silent raw-key failure above.
- *Importing the bundles from the manifest so `tsc` copies them*: an import that exists only to steer
  a compiler, which the next reader deletes.
- *Reading i18n from the source directory*: a second resolution rule for one module, and an image
  that copied only `dist` would lose the bundles silently.

## R-4 — Overlay schema is discovered at runtime; committed registries stay bare core

**Decision.** In both trees overlay entities and migrations enter the ORM configuration and the
migration order at runtime, as an installed package's do. `entities-registry.generated.ts`,
`migrations-registry.generated.ts` and `manifest-index.generated.ts` stay bare core under every
`DEPLOYMENT` (D-104). `composer:generate` stops refusing overlay schema and **validates** it (scoped
class names, filename/class agreement, one classification decorator, `/legacy` decorator imports)
while emitting none of it.

**Rationale.** Which deployment a process runs as is a fact about the process (D-104's predicate);
an artefact that varies with `DEPLOYMENT` is always stale for some deployment and so detects nothing
(#120). Runtime discovery is also the only path an instance has.

**Rejected.** *Baking overlay schema into the committed registries* — environment-dependent
artefacts, and a second path that an instance cannot take.

## R-5 — Overlay migrations: a directory read, one class per file

**Decision.** Read every runtime unit in `migrations/` (`.js` in a compiled tree, `.ts` under
`tsx`/`vitest`; `.d.ts`, `.map` and test files skipped). Each must export exactly one class whose name
equals the name derived from the filename (`naming-convention.md` §1–§2 recognisers). Entries are
`{ moduleId, cls, origin: 'overlay' }`.

**Rationale.** The author's unit of work is a file (`endora new migration` writes one); a barrel is a
second hand-maintained list, and a forgotten entry is a migration that silently never runs — "an
unregistered migration does not run" is this repository's oldest migration trap.

**Rejected.** *A `migrations/index.ts` barrel* (the package shape): fine for a published artefact
whose build generates nothing, wrong for a directory an author edits. *Taking every exported class*:
a helper class would become a migration.

## R-6 — Overlay entities: the `entities` export, with an unexported-class refusal

**Decision.** `backend.ts` exports `entities` (owner). Discovery additionally imports every runtime
unit under the module's `entities/` and refuses (`overlay-entity-unexported`) when a class carrying
MikroORM entity metadata is not in `entities`.

**Rationale.** The export keeps one entity idiom with packages (`entityClassesFrom` reads the same
name). The refusal closes the silent case — a class with no registration fails at its first query,
far from the cause. `entities/` is conventional, so classes elsewhere are the author's explicit
choice and are trusted to the export.

**Rejected.** *A directory walk instead of the export*: two idioms with packages. *The export alone*:
silent omission.

## R-7 — `MigrationOrigin` gains `'overlay'`

**Decision.** `MigrationOrigin = 'core' | 'external' | 'generated' | 'overlay'`; the guard wraps every
origin that is neither `core` nor `generated`. Error messages name the overlay as
`overlay apps/<deployment>/modules/<id>` where a package's say its npm name.

**Rationale.** Three readers need to tell the two apart: the test template identity floors its digest
per origin (`backend/test/template-identity.ts`), the foreign-schema error must name a directory, not
a package, and `module:status` shows where a module came from. A promoted module (OR-6) moves from
`overlay` to `external` with its class names unchanged — nothing persisted records the origin.

**Rejected.** *Reusing `'external'`*: a stranger's package and the deployment's own module become
indistinguishable in every diagnostic. **Cost**: a union widening on the published `./db` subpath —
a `minor` changeset; `../paid-modules` was checked and switches on no `MigrationOrigin`.

## R-8 — Admin: a per-deployment registry, selected at admin build time

**Decision.** The renderer in `packages/cli/src/lib/admin-artefacts.ts` takes overlay admin layers as
a second population and renders, per deployment, `admin/src/deployments/<deployment>.generated.ts`
(entries import `apps/<deployment>/modules/<id>/admin/index.js` by relative path) plus a bare
`admin/src/deployments/none.generated.ts`. `main.tsx` (wiring) concatenates
`MODULE_ADMIN_CONTRIBUTIONS` with `DEPLOYMENT_ADMIN_CONTRIBUTIONS` imported from one alias; the
admin's `vite.config.ts` (wiring) resolves the alias from `DEPLOYMENT` and refuses a named deployment
whose file is missing. In this repository the per-deployment files are **committed** and verified for
every deployment on disk by `overlay:check` (the issue #120 precedent for `divergence.generated.*`);
in an instance `endora generate` renders them uncommitted (R3.1). The Tailwind enumeration adds an
`@source` per overlay admin layer **of every deployment on disk** — environment-independent, and
scanning more sources only adds utilities. The admin `tsconfig.json` includes the overlay admin
layers; Vite's `resolve.dedupe` pins `react`, `react-dom`, the kit and the shell to the admin's copies.

**Rationale.** Vite is a static build, so the module set must be a file (R3.2); a deployment's screens
must not ship in another deployment's bundle (SC-004); the bare-core registry keeps its meaning.
Presence is still decided at render by `isSurfaceVisible`, so a bundle built for a deployment whose
backend does not compose the module hides it (fail closed).

**Rejected.** *One registry with every deployment, filtered at runtime* — ships client A's code to
client B. *A `DEPLOYMENT`-dependent single committed registry* — #120. *A separate admin app per
instance* — breaks the shared shell and design system (Principle IX).

## R-9 — Freshness guard: per-file mtime pairing at overlay resolution

**Decision.** When a process resolves overlay modules from a compiled root and was handed the source
root, it pairs every source file of every overlay module (`*.ts`/`*.tsx`, admin layers excluded, test
files excluded) with its emitted `.js` through the mirrored layout and refuses on `stale` (source
strictly newer), `unbuilt` (no emitted file, including a whole module directory) or `orphan` (emitted
unit with no source). The refusal is an `OverlayBuildError` printed through `exitOnRefusal`. No source
root → one `info` line, no refusal.

**Rationale.** `emitted-freshness.ts`' rule: compare the file the run read, fail safe in the
direction that asks for a no-op rebuild, never a false green. Pairing only the entry units would miss
an edited `services/x.ts` behind a fresh `backend.js`.

**Rejected.** *Content hashes* — `tsc` emits no `sourcesContent` here; *warn-only* — a stale overlay
is the wrong code running; *checking only in `dev`* — the image is where a forgotten build ships.

## R-10 — Classification refusal at `configuredEntitiesFrom`

**Decision.** After the merge and beside `assertTransitiveParentsResolve`, compare the entity set
with `tenantClassifications()` by class identity: none or more than one classification is refused,
naming class and contributing module (core registry, package name, or overlay directory). Embeddables
and abstract bases are excluded by MikroORM's metadata storage (v7 API — hence OR-8).

**Rationale.** This is the last instant before the ORM exists, where every decorator has run and no
query can have been issued — the reasoning `configured-entities.ts` already gives for the transitive
check. It covers what static checks cannot see: compiled packages and every instance.

**Rejected.** *Static checks only* (the defect). *A MikroORM `afterDiscovered` hook* — later, ties the
refusal to an ORM lifecycle event, and `migrate` would reach it after connecting.

## R-11 — Overlay ports: type-only `ports.ts` within one deployment

**Decision.** The port's types live in the owner overlay's `ports.ts`; a sibling overlay module of the
same deployment may `import type` exactly that file and must declare the owner in `dependencies`.
Resolution stays `lazyPort<T>(ctx, '<literal>')`. One analysis in `packages/cli/src/lib/` with two
readers: `check:module-boundary` (this repository, which already treats `apps/` directories as module
identities) and `endora generate` (instance, exit 1 after writing its report).

**Rationale.** An instance cannot add types to `@endora-commerce/contracts`; D-171 already makes a
type-only `./ports` reach a non-boundary reach for packages, and this is the same rule with a path
instead of a subpath. Promotion (OR-6) turns the path into the package's `./ports` subpath.

**Rejected.** *Events only* — no synchronous read. *Value imports* — evaluate another module's code
outside its gate. *Cross-deployment imports* — the other deployment is not composed.

## R-12 — Trust tier is a derivation of `origin`, and schema does not move it

**Decision.** `trustTierOf(origin)`: `core` → `core`, `overlay` → `deployment`, `package` → `package`,
read off `RegisteredManifestEntry.origin` / `ModuleEntry.overlay` — both set at construction from the
root a module was found under, never declared by the module. `specs/189-command-middleware/` owns what
each tier may do; if it already defines this function, 190 consumes it (one home).

**Rationale.** The decoration exemption already rests on this property (`overlay: true` "from the
root, never from the module"); every new tier rule must rest on the same fact.

**Rejected.** *A manifest `trust` field* — a module asserting its own privilege.

## R-13 — Lifecycle: overlays stay deployment-shipped

**Decision.** An overlay with tables stays in `deploymentShippedEntries` (boot-converged registration
and boot settings reconcile). Its migrations run in the global linear log at `migrate` and at
`module:install`; `module:install --all` repairs a boot-converged row (`bootConvergedAt`); hard
uninstall reverts via ownership (FR-036).

**Rationale.** It is exactly how a core module in this repository behaves, and "the lifecycle must not
differ by origin" (#1851) means overlay ≡ core-shipped, not overlay ≡ installed package: a package's
settings have one author (`install`), an overlay's have two (boot and install) today, and moving it
would leave a fresh instance's overlay with no activation Setting until someone ran `install`.

**Rejected.** *Treat a schema-owning overlay as a package* (install-only) — a regression for every
overlay without schema and a split by capability. *A tombstone that stops boot from re-converging a
hard-uninstalled overlay* — a lifecycle rule core does not have; the documented removal order covers
it (spec, Edge Cases).

## R-14 — `erasableSyntaxOnly` stays on after the build

**Decision.** Kept permanently for overlay code.

**Rationale.** #1847 lands before the build, while overlays are still stripped; afterwards it costs a
string-literal union instead of an `enum` and keeps an overlay promotable to a package without a
syntax rewrite, and keeps the rule identical in both trees. Decorators are unaffected by the flag.

**Rejected.** *Drop it once compiled* — an instance on an older wiring (not yet upgraded) would accept
an `enum` that its stripping loader then crashes on.

## R-15 — Layout: flat modules, nested-module and package-in-disguise refusals

**Decision.** One walk (platform `overlay/`, mirrored in the CLI as today's two walks are) replaces
`assertOverlayModulesShipNoSchema` with `assertOverlayLayout`: `nested-module`, `package-in-disguise`
(FR-002, FR-003). Splitting is done with sibling modules and `dependencies`.

**Rationale.** A nested module is a module boundary no manifest graph sees — lifecycle, activation and
migration order key on module ids. A `package.json` under `apps/` is the start of a package the
platform will never discover as one.

**Rejected.** *Nesting* — two notions of "module". *Silently ignoring the files* — the author believes
they mean something.

## R-16 — Divergence: overlay tables are not divergences; reaching into a host is

**Decision.** An overlay's own tables join `DivergenceBoundary.notRecorded` (own surface, like routes).
A new kind `column-extension` (rung: data ladder D2) records an overlay's `x_*` declaration on another
module's host; the side-table kind is `specs/187-side-table-extensions/`'s to define, and 190 renders
it if 187 defines one (coordination point C-2 in `plan.md`).

**Rationale.** The report records acting on another module's surface; a column on `organizations` is
exactly that and needs the deployment's sentence.

**Rejected.** *Recording every overlay table* — noise that trains readers to skip the report.
