---
title: Overlay Pattern (Per-Deployment Customization)
---

# Overlay Pattern

The platform is a **multi-deployment** product — one codebase, many client
installations. Per-deployment customization goes through a **per-deployment
overlay layer** resolved deterministically at build/composition time, never by
editing core files or forking (Constitution Principle XV, feature `057`). The
core stays deployment-agnostic and the bare-core build keeps working unchanged.

## How it works

- **Overlay location** — a deployment's own modules live under
  `backend/src/apps/<deployment>/modules/<id>/…`. The active deployment is chosen
  by the `DEPLOYMENT` environment variable at build time; unset (or a deployment
  with no overlay directory) means a bare-core build.
- **An overlay module owns every file it ships.** Nothing in it shadows, replaces
  or extends a file of another module. There is no classification of its contents
  and no rule about what it may put where — it is an ordinary module that happens
  to belong to one client. (This was not always so; see *There used to be file
  shadowing* below.)
- **One id, one owner** — an overlay module id already claimed by core, by a
  workspace module package, by an installed package or by another overlay module
  fails composition, naming every claimant's file.
- **Deterministic resolution** — the resolver (`backend/src/overlay/`) lists the
  module directories under the overlay root with a stable sort. Identical inputs
  produce an identical resolution and an identical **divergence report**, so a
  rebuild never drifts.
- **Divergence report** — every build emits a committed, deterministic record of
  every way the deployment differs from core, in two renderings from one
  derivation: `divergence.generated.ts` for a program and
  `divergence.generated.md` for a human (`divergence.core.generated.*` for bare
  core; per-deployment under `apps/<name>/`). Each entry names what was changed,
  which of the deployment's modules changed it, which module owns what was
  changed, the rung of the [customisation ladder](./customisation-ladder.md) it
  sits on, and the sentence the deployment wrote when it did it. Its predecessor
  recorded one fact — which overlay modules a deployment adds — which survives as
  the report's `overlayModules` field.
- **The deployment's own declaration** — `apps/<name>/divergence.ts`, hand-written
  and reviewed, carrying the three things no walk can produce: the modules this
  deployment does not ship, the wrapping order where two of its overlay modules
  decorate one name, and one sentence per derived divergence. It is reconciled
  against the report **both ways**: a divergence with no sentence fails the
  build, and so does a sentence describing a divergence that is gone.

## What you may override

Every row names a seam. None names a file path, because there is no seam that
takes one.

| Want | Seam |
|------|------|
| Change what a core service does | `ctx.di.decorate('<name>', (inner) => …)` from the deployment's own overlay module — see *Service overrides are decorations* below |
| Add a capability | a client-only overlay module under `backend/src/apps/<deployment>/modules/<id>/`, shipping `backend.ts` and `manifest.ts` |
| Run before or after another module's endpoint; veto it; rewrite its response | `ctx.interceptors` (feature `060`) |
| Vary a behaviour the owner anticipated | a strategy port the owner publishes, registered behind `ctx.di.providePort` and read through `lazyPort` |
| Change configuration | a manifest-declared Setting, and `divergence.ts` to omit a module |
| Add client-specific tables | from a **core** module, read from the overlay through that module's port — an overlay module contributes no schema, see below |
| **Replace a route handler wholesale** | **No seam. Not offered.** See *The one thing there is no seam for* below |

## An overlay module contributes no schema

A per-deployment overlay module contributes registrations, routes, decorations,
interceptors, permissions, i18n bundles and a manifest. It contributes **no
schema**: no `@Entity()` class and no migration.

This page used to say the opposite ("ship new schema as a client-only overlay
module that owns its own tables"), and the generator has refused it the whole
time.

**The reason is not migration ordering.** This page used to give one — that the
registry's execution order is "only meaningful over a fixed set", so a set that
varies per deployment has no single correct order to commit. That argument was
measured and is false: adding a leaf module's migrations leaves the relative
order of every existing migration exactly unchanged, because a leaf contributes
dependency edges only out of itself. It is retired (ruling D-106,
`specs/080-f4-real-scope/README.md` §2); do not repeat it.

The real reason is smaller and holds regardless: **an overlay lives in the same
repository and the same build as core**, so the remedy is always available and
costs nothing but a directory. A deployment that wants client-specific tables
ships them from a core module and reads them from the overlay module through that
module's port — the overlay module keeps everything else: its own services, its
routes, its decorations and its permissions. Allowing overlay schema would add a
second schema-owning mechanism and buy no capability, and that is not worth its
weight.

**An extension package is the opposite case.** A third-party package author has
no core module to ship a table from, so the same rule would not be a constraint
to design around but a prohibition on the whole extension-package programme,
every family of which persists state. D-106 therefore allows a package its own
entities and migrations. That mechanism is not built yet — today the only schema
a running platform executes is core's — so nothing on this page changes for a
deployment.

## Service overrides are decorations

A client override of a service **wraps** the core implementation and delegates to
it. It does not shadow a file and it does not subclass core.

That is a correctness property, not a style preference. Replacing a service means
the deployment stops receiving core fixes to the overridden methods the day the
override is written — whatever core does to that method next lands in a class the
deployment no longer instantiates, and nobody finds out until the behaviour
diverges in production. A wrapper keeps core in the call path, so a core fix
arrives *and* the client behaviour survives it.

A decoration is written from the deployment's **own overlay module**, in its
`registerModule`, and there is no other way to write one:

```ts
// backend/src/apps/acme/modules/acme_pricing/backend.ts
export function registerModule(ctx: ModuleContext): void {
  ctx.di.decorate<DecoratedPricing>('pricingService', (inner) => wrap(inner));
}
```

It names the **registration**, not a file, so core moving a file breaks nothing
and a deployment can override a second service without a core edit of any kind.

Where two modules decorate the same registration, the wrapping order must be
declared — composition fails rather than picking by package load order — and
every applied decoration appears in the composer's override report.

### There used to be a second mechanism, and it is retired

Until 2026-08 a deployment could also drop a file under
`backend/src/apps/<deployment>/decorations/`, named after the registration it
wrapped and exporting `decorate(inner)`. If you are reading a client tree that
still has one, or a document that still describes one, this is why it is gone
and why you should not reinvent it.

It existed because feature 072 predated ruling D-103. An overlay module was then
a `plugin.ts` over a frozen seven-field context: it could not reach the
container, so it could not decorate anything, and a deployment that wanted to
wrap a service had nowhere else to go. D-103 made an overlay module an ordinary
composed participant with a full `ModuleContext` — `ctx.di.decorate` included —
which left the file seam with no capability of its own.

It was also, as shipped, a documented capability that silently did nothing for
every registration but one. The loader read *every* file in that directory and
keyed a map by the registration name derived from each filename; the single
consumer looked up one hard-coded key and threw the rest of the map away. A
deployment adding `decorations/command-bus.ts` got no wrap, no warning and no
error. Extending it meant a core edit per registration — exactly the coupling the
overlay pattern exists to remove.

**One thing was genuinely given up.** The file imported the owner's
`*.interface.ts`, so `tsc` held the wrapper to that interface and refused it the
moment the interface changed — feature 057's contract gate. `ctx.di.decorate<T>`
asserts `T` at the call site and compares it to nothing, so the wrapped shape is
declared **structurally** and interface drift surfaces at runtime instead of at
build time. When a deployment wants the gate back, the way to get it is for the
owning module to publish its interface on its package's `./ports` subpath and
for the overlay to name it there: a type-only `./ports` reach is not a module
boundary reach (D-171), and a published type's shape changes cost a major
version.

### Decorating across owners is the deployment's, and only the deployment's

`ctx.di.decorate` refuses a module that wraps a registration it did not
register. The reason is that decoration rewrites what *every* consumer of that
name resolves: a core module allowed to wrap `commandBus` observes every audited
write in the platform, one wrapping `auditLogService` changes what the audit
records, and one wrapping another module's read port sits between a consumer and
its owner with nothing declared anywhere. A module that needs different
behaviour from another module asks it for a seam — a port, a contribution point,
an event — which is a coupling the manifest declares and the checks can see.
A name a composition root registered is refused on the same rule: no module owns
it, so no module may wrap it.

An overlay module is the one exemption, because it is a different act. A
deployment wrapping core is the customisation seam this page describes; core
wrapping core is a coupling nothing declares. The exemption is not a claim a
module makes about itself — the generated composer marks an entry `overlay: true`
from the root the module was discovered under,
`backend/src/apps/<deployment>/modules/`, so core has no way to assert it and
`overlay:check` fails on a hand-edited artefact.

**The exemption stops at an installed extension package** (D-176). An overlay may
wrap anything core or another of the deployment's own modules registers, and it
may not wrap a registration a package installed from `node_modules` owns —
`PackageDecorationNotOfferedError`, refused at composition, naming the overlay,
the package and the registration. The reason is that there is nothing to write
the wrap *against*: a package's `exports` map publishes `registerModule`, its
entities, its migrations and `./ports`, and the container names it registers
internally are published by none of them, so the name may change in a patch
release. The `*.interface.ts` gate the retired file seam carried did not transfer
either — for a package the compiler would be holding the deployment to a
`dist/*.d.ts` written by someone the deployment does not employ. The message says
*not offered yet* rather than *forbidden*, and names the exit: a package
declaring which of its registrations are decoratable, `./ports` being the natural
home, where changing the shape costs a major version bump. Until then, ask the
package's author for a port, an event, or use an interceptor around its routes.

Decorations are **applied after every module has registered**, not at the call
(D-176). Which array a module was composed from therefore has no bearing on what
it can wrap, and a decoration of a name nothing registers means exactly that
rather than "not yet". Order within the drain is call order, which is why one
module decorating a name twice is unambiguous and two modules decorating it are
not.

Before feature 072 a service override shadowed
`modules/<id>/services/<name>.ts` and replaced the core class. That is retired
too, and completely: a `services/` file under an overlay module is now just one
of that module's own files, because an overlay module owns everything it ships.

## There used to be file shadowing, and it is retired

Until 2026-09 this page described a second mechanism: an overlay file at the
same module-relative path as a core file *shadowed* it, with a taxonomy of
overridable kinds (`route`, `config`), two rejected ones (`schema`, `other`),
a conflict policy and three build-time refusals. If you are reading a client
tree, an older spec or a document that still describes one, this is why it is
gone and why you should not reinvent it.

**Nothing that ran was given up**, and that is measured rather than asserted.
`git log -S` over the whole history of `backend/src/overlay/` finds exactly one
loader for a shadowed file ever written — `loadOverlayServiceClasses`, for
`service` — and feature 072 deleted it deliberately, replacing it with
`ctx.di.decorate` for the reason the section above gives. `route` and `config`
never had a loader at all: the resolver's `overrides` output had exactly one
consumer in the history of the tree, the divergence report's generator (then the
override-manifest generator), which serialised it into an audit artefact. So a route override never changed what a
running platform served, on any deployment, in any tree state.

**And it had stopped even classifying.** The scan indexed core from
`backend/src/modules`, which has held no module since the packaging sweep
finished on 2026-08-28. With that index empty every overlay directory
short-circuited to "a brand-new module claiming this id" before a single file
was looked at, so all three refusals below were unreachable — including the one
whose whole job was to stop a deployment shipping a migration it would never
run. A dead fail-closed guard is worse than no guard: the author who trusts it
gets silence.

Retired with it: **Conflict** (two overlays targeting one core unit),
**Unknown target** (an overlay file whose core equivalent does not exist) and
**Schema override** (an overlay file under a core module's `entities/` or
`migrations/`). The schema rule itself is *not* retired — an overlay module
still contributes no schema, and `generate-composer.ts` is what refuses it,
which is the only place that can say the table would never be created.

**Why it was not repaired instead.** Shadowing a file inside a published package
is not a coherent operation. The platform composes a module through
`@endora-commerce/mod-<id>/backend`, whose `exports` map points at `dist`, so
making one overlay file replace one of those would mean intercepting Node's
resolution for a single file of a single package — reintroducing that package's
*source* into a graph that already holds its build output. Two rules refuse the
shapes that would take: D-164, which is why a module package ships `dist` at
all, and `check:singleton-identity`, whose whole subject is that evaluating one
package twice duplicates its module-scope values **silently**. Doing it at the
specifier level instead — re-pointing the package at the deployment's copy —
avoids the double evaluation and replaces the whole module, which is forking a
module rather than overriding one, and is the thing Principle XV exists to
prevent.

The ruling is D-201, and the analysis is
`specs/103-overlay-shadowing-retirement/`.

## The one thing there is no seam for

**There is no way to replace a route handler wholesale.** `ctx.interceptors`
runs after the route's own `preHandler` guards and after schema validation: a
pre-interceptor may veto by throwing a registered `HttpError` and may replace
the validated body, and a post-interceptor may replace the payload, but neither
can substitute the handler.

That is not a regression the retirement introduced — route shadowing never
replaced a handler either. It is stated here rather than implied, in the idiom
`PackageDecorationNotOfferedError` already uses: not offered, naming the exit.
The honest sequence for a deployment that needs one is to decorate the service
the handler calls, which is where the behaviour usually is, or to ask the owning
module for a port. If a real deployment turns up needing more, that is a feature
with a real requirement behind it, and it should not be justified by a mechanism
that never worked.

## Fail-closed guards

Every guard on this list can be provoked. The build fails — never resolves
silently — on:

- **Module id collision** — an overlay module claiming an id already held by
  core, a workspace module package, an installed package or another overlay
  module. The refusal names every claimant's file.
- **Overlay schema** — an `@Entity()` class or a migration under
  `backend/src/apps/`, refused by `generate-composer.ts` (D-106).
- **Missing manifest** — an overlay module directory carrying no
  `manifest.js`/`manifest.ts`. The refusal names both candidates.
- **Unregisterable backend** — an overlay module whose `backend.js`/`backend.ts`
  exports no `registerModule`. (A directory with *no* backend entry point is
  skipped, deliberately: a deployment may ship a module with no server half.)
- **Ambiguous decoration** — two modules decorating one registration with no declared order.
- **Foreign decoration** — a core module decorating a registration it does not own.
- **Package decoration** — an overlay decorating a registration an installed
  extension package owns; not offered yet, and the refusal says so.

## Guards still apply

A decoration wraps an *implementation*, never a guard seam: overlay code runs
under the same tenant isolation (Principle XI), sales-channel scoping
(Principle XII), and Command-Bus auditing (Principle XIII) as core. Overlay
modules are ordinary lifecycle participants and must register their permissions
and pass the permission-inventory check per deployment.

## Adding an overlay

```bash
# 1. Add the deployment's overlay module (it ships backend.ts, never plugin.ts):
#    backend/src/apps/acme/modules/acme_loyalty/{manifest,backend}.ts

# 2. Override a core service from its registerModule, by registration name:
#    ctx.di.decorate('pricingService', (inner) => wrap(inner))

# 3. Say why, in the deployment's own declaration:
#    backend/src/apps/acme/divergence.ts, `reasons`, keyed by the derived entry's
#    own key — `decoration:acme_loyalty:pricingService`

# 4. Render the deployment's divergence report and commit both renderings:
DEPLOYMENT=acme pnpm --filter backend run overlay:divergence

# 5. Check that every divergence is derived, owned and explained, and that the
#    committed artefacts are what this tree produces:
pnpm --filter backend run check:divergence
pnpm --filter backend run overlay:check
```

**Which seam to reach for, and what each costs**, is the
[customisation ladder](./customisation-ladder.md). Read it before writing any of
the above: rung 3 is not available to a deployment wanting to substitute an
implementation, and that page says so rather than sending you to a mechanism that
will refuse you.

See `specs/057-overlay-pattern-multideploy/` for the original feature,
`specs/107-override-report-and-ladder/contracts/divergence-report.md` for the
current report contract and `.../deployment-declaration.md` for the declaration's.
Both supersede `specs/103-overlay-shadowing-retirement/contracts/override-manifest-v2.md`
§1–§2, which in turn superseded feature 057's override-manifest and
overlay-resolution contracts.
