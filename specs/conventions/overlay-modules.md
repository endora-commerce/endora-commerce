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
`backend/src/apps/example/modules/example_overlay/backend.ts` is the worked example. A
`services/` file under an overlay is an **unknown override target** and fails the build.

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
**one** derivation over the deployment's own overlay tree: nine kinds, each with the module that
wrote it, the module that owns what it names, the rung of the customisation ladder it sits on and
the deployment's own sentence. Beside them is the hand-written
`backend/src/apps/<deployment>/divergence.ts`, which carries the three things no walk can produce —
the modules the deployment omits, the wrapping order where two of its overlay modules decorate one
name (`decorationOrder`, **checked and never applied**), and one reason per derived divergence. The
two are reconciled **both ways** by `check:divergence`, and both renderings are under
`overlay:check`'s four verdicts. Which seam to reach for and what each costs is
`docs/docs/architecture/customisation-ladder.md`; the rung on every report entry is what makes
arriving repeatedly at a high one measurable rather than anecdotal.
**An overlay module contributes no schema — today** (D-106, narrowing D-105). **D-297 retires
D-106 for overlays** (`specs/190-overlay-full-modules/`, owner clauses OR-1 – OR-6, issue #1846);
D-106.2 below is unchanged. The ruling is accepted and the code does not implement it yet, so
the refusal described at the end of this paragraph is still the behaviour, and stays this
paragraph's subject until overlay schema discovery (#1850, WP6 of that plan) removes the
refusal and rewrites the paragraph in the same merge request. Until then, design against D-297
and build against the refusal. What D-297 holds every design to:

- **An overlay module is a full module.** It may own entities and migrations, declare
  `x_<moduleId>_*` columns and side tables, publish a port, and ship admin screens and
  command-palette actions. There is no second "local instance package" mechanism beside it.
- **In both trees.** It holds in a client's instance and in this repository's
  `backend/src/apps/` alike.
- **No deployment exemption.** An overlay module's migrations take the full foreign-schema
  guard every installed package's migrations take; being the deployment's own buys nothing.
- **One build, no package in disguise.** Overlay code is compiled by one deployment-level `tsc`
  project (#1848). There is no per-module build, and no `package.json`, `exports` map or build
  configuration under `apps/`. In an instance that project is run by `endora build overlays`
  (the backend member's `build` and `dev`), which also mirrors each module's `i18n/` into
  `backend/dist/apps`. Two refusals hold it, in the build and in every process that resolves
  overlay modules: the layout (`nested-module`, `package-in-disguise` — platform
  `overlay/overlay-layout.ts`, the CLI's twin `build-overlays/layout.ts`, held to agree) and the
  freshness of the compiled tree against its sources (`stale`, `unbuilt`, `orphan` — platform
  `overlay/overlay-freshness.ts`, given `deploymentSourceRoot`).
- **Promotion keeps the id.** A module promoted from an overlay to a package keeps its module
  id, so the migration class names a database has already recorded still match.
- **The trust tier is derived, never claimed.** An overlay module's tier is `deployment`, read
  from the `origin` the loader stamps on its module entry from where it discovered the module
  (`specs/189-command-middleware/contracts/module-origin.md`). No manifest field feeds it.

**D-106's stated reason is retired with it, so do not cite it.** That reason was "an overlay
lives in the same repository and the same build as core, so own the table from a core module
and read it through that module's port", and it has no referent in an instance, which depends on
released packages and has no core tree. The older migration-ordering argument stays retired as
well. It was measured false: per `specs/080-f4-real-scope/README.md` §2, adding a leaf module's
migrations leaves the relative order of all 141 existing ones exactly unchanged. **Where the
refusal lives today.** In this repository it is `generate-composer.ts`'s (the same rule
`module-migrations.md` states). In a client's instance it is `endora generate`'s
(`packages/cli/src/generate/divergence.ts`' `overlaySchemaFiles`). **And the platform refuses it
again wherever overlay modules are resolved** (`packages/platform/src/overlay/overlay-schema.ts`,
called from `overlayModuleIdsUnder`), so the API, the worker, the operator CLI and the
`module:*` commands stop before composing or opening anything. The two walks are written twice,
because the CLI reads an instance without loading the platform, and they must agree. A bare
`migrate` reaches neither, because its configuration is handed no deployment root. Until #1850
lands, a deployment's table ships from a module of this tree here, and from an installed module
package in an instance.
**An extension package may ship entities and migrations** (D-106.2, an owner ruling). A
third-party author has no core module, so for a package the same rule would not be a constraint
to design around but a prohibition on the entire extension-package programme, every family of
which persists state. The platform discovers a package's schema at runtime
(`discoverPackageSchema`, `packages/platform/src/packages/package-runtime.ts`) and runs every
package migration under the foreign-schema guard (`packages/platform/src/db/foreign-schema-guard.ts`).
See `docs/docs/architecture/overlay-pattern.md` and
`specs/057-overlay-pattern-multideploy/`.

