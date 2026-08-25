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

- **Overlay location** — a deployment's overrides live under
  `backend/src/apps/<deployment>/modules/<id>/…`, mirroring the core module tree
  at `backend/src/modules/<id>/…`. The active deployment is chosen by the
  `DEPLOYMENT` environment variable at build time; unset (or a deployment with no
  overlay directory) means a bare-core build.
- **Shadowing rule** — an overlay file at the same module-relative path as a core
  file *shadows* it. A file under a module id that does not exist in core is a
  brand-new **client-only module** (additive).
- **Deterministic resolution** — the resolver (`backend/src/overlay/`) walks core
  + the overlay root with a stable sort and emits a resolved unit set. Identical
  inputs produce an identical resolution and an identical **override manifest**,
  so a rebuild never drifts.
- **Override manifest** — every build emits a committed, deterministic artifact
  (`override-manifest.core.generated.ts` for bare core; per-deployment under
  `apps/<name>/`) listing every override and every new module, so a reviewer can
  see exactly how a deployment diverges from core.

## What you may override (v1)

| Kind | Overridable? | Notes |
|------|--------------|-------|
| Service | ✅ | By **decoration**, not by shadowing a file — see below. |
| Route / plugin | ✅ | Same route mechanism as core. |
| Config / manifest | ✅ | |
| Whole new module | ✅ (no schema — see below) | Registered without editing the core registry. Ships `backend.ts`, never `plugin.ts`. |
| Entity / migration | ❌ | An overlay module contributes no schema — see below. Ship new schema from a **core** module. |

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

A decoration lives in `backend/src/apps/<deployment>/decorations/`, one file per
registration it wraps, exporting `decorate`:

```ts
// backend/src/apps/acme/decorations/pricing-service.ts → decorates `pricingService`
export function decorate(inner: PricingServiceContract): PricingServiceContract {
  return new AcmePricingService(inner);
}
```

The file is named after the **registration**, not after the core file's path, so
core moving a file breaks nothing. `tsc` remains the contract gate: the
decoration is written against the core interface (`*.interface.ts`) and stops
being assignable the moment that interface changes, so contract drift is a build
failure rather than a per-deployment runtime surprise.

Where two modules decorate the same registration, the wrapping order must be
declared — composition fails rather than picking by package load order — and
every applied decoration appears in the composer's override report.

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
release. The `*.interface.ts` gate this page describes above does not transfer
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
`modules/<id>/services/<name>.ts` and replaced the core class. A `services/`
file under an overlay is now an **unknown override target**, which is what it
is: a file the platform would never load.

## Fail-closed guards

The build fails — never resolves silently — on:

- **Conflict** — two overlays targeting one core unit (no last-wins).
- **Unknown target** — an overlay whose core file does not exist (stale/typo).
- **Schema override** — an overlay under `entities/`/`migrations/` of a core module.
- **Ambiguous decoration** — two modules decorating one registration with no declared order.
- **Foreign decoration** — a core module decorating a registration it does not own.
- **Package decoration** — an overlay decorating a registration an installed
  extension package owns; not offered yet, and the refusal says so.

## Guards still apply

An override swaps an *implementation*, never a guard seam: overlay code runs
under the same tenant isolation (Principle XI), sales-channel scoping
(Principle XII), and Command-Bus auditing (Principle XIII) as core. Overlay
modules are ordinary lifecycle participants and must register their permissions
and pass the permission-inventory check per deployment.

## Adding an overlay

```bash
# 1. Override a core service by decorating it (its interface must already exist):
#    backend/src/apps/acme/decorations/pricing-service.ts
#    → export function decorate(inner: PricingServiceContract) { … }

# 2. Or add a client-only module:
#    backend/src/apps/acme/modules/acme_loyalty/{manifest,plugin,routes.admin}.ts

# 3. Build for the deployment (resolver + manifest run automatically):
DEPLOYMENT=acme pnpm --filter backend run build

# 4. Verify divergence in the emitted manifest and check determinism:
pnpm --filter backend run overlay:check
```

See the feature spec, plan, and quickstart under
`specs/057-overlay-pattern-multideploy/` for the full contract.
