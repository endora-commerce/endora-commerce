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
**An overlay module contributes no schema** (D-106, narrowing D-105): a per-deployment overlay
module under `backend/src/apps/` contributes registrations, routes, decorations, interceptors,
permissions, i18n bundles and a manifest, and **no `@Entity()` class and no migration**. The
reason is **not** migration ordering. That argument — "the order is only meaningful over a fixed
set" — was measured false (`specs/080-f4-real-scope/README.md` §2: adding a leaf module's
migrations leaves the relative order of all 141 existing ones exactly unchanged) and is retired;
do not cite it and do not repeat it to an overlay author. The reason is that **an overlay lives
in the same repository and the same build as core**, so the remedy is always available and costs
nothing but a directory: own the table from a core module and read it from the overlay through
that module's port. A second schema-owning mechanism that buys no capability is not worth its
weight. The generator refuses both (`generate-composer.ts`), which is the same rule
`module-migrations.md` states.
**An extension package is the opposite case and may ship entities and migrations** (D-106.2, an
owner ruling). A third-party author has no core module, so for a package the same rule would not
be a constraint to design around but a prohibition on the entire extension-package programme,
every family of which persists state. The mechanism that lets it is Wave 3 of
`specs/080-f4-real-scope/tasks.md`; until it lands, the only schema a running platform executes
is core's. See `docs/docs/architecture/overlay-pattern.md` and
`specs/057-overlay-pattern-multideploy/`.

