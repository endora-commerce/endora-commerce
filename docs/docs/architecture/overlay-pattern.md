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
| Service | ✅ | Must satisfy the core interface (see below). |
| Route / plugin | ✅ | Same route mechanism as core. |
| Config / manifest | ✅ | |
| Whole new module | ✅ | Registered without editing the core registry. |
| Entity / migration | ❌ | Schema overrides are out of v1 — ship new schema as a client-only overlay module that owns its own tables. |

## Contract-gated service overrides

A core service is overridable only if it exposes a documented interface — a
sibling `*.interface.ts` the core class `implements`. An overlay service imports
that interface via a **relative `.js` path** (overlay files are dynamically
imported at runtime, so a `@core/*` tsconfig alias — which resolves under
tsc/tsx but not `node dist/` — is not used) and `implements` it too, so the
standard `tsc` build fails if the overlay does not satisfy the contract.
Contract drift (core changes the interface, the overlay does not) is therefore a
**build failure**, never a per-deployment runtime surprise (FR-003).

## Fail-closed guards

The build fails — never resolves silently — on:

- **Conflict** — two overlays targeting one core unit (no last-wins).
- **Unknown target** — an overlay whose core file does not exist (stale/typo).
- **Schema override** — an overlay under `entities/`/`migrations/` of a core module.
- **Missing contract** — a service override whose core service has no interface.

## Guards still apply

An override swaps an *implementation*, never a guard seam: overlay code runs
under the same tenant isolation (Principle XI), sales-channel scoping
(Principle XII), and Command-Bus auditing (Principle XIII) as core. Overlay
modules are ordinary lifecycle participants and must register their permissions
and pass the permission-inventory check per deployment.

## Adding an overlay

```bash
# 1. Override a core service (its interface must already exist):
#    backend/src/apps/acme/modules/price_lists/services/pricing-service.ts
#    → export class PricingService implements PricingServiceContract { … }

# 2. Or add a client-only module:
#    backend/src/apps/acme/modules/acme_loyalty/{manifest,plugin,routes.admin}.ts

# 3. Build for the deployment (resolver + manifest run automatically):
DEPLOYMENT=acme pnpm --filter backend run build

# 4. Verify divergence in the emitted manifest and check determinism:
pnpm --filter backend run overlay:check
```

See the feature spec, plan, and quickstart under
`specs/057-overlay-pattern-multideploy/` for the full contract.
