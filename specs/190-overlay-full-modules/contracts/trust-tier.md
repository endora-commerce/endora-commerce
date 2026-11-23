# Contract — The deployment trust tier, as this feature consumes it (FR-090, FR-091, R-12, OR-5, OR-10)

**One home elsewhere.** The module origin type, its derivation and the tier vocabulary are owned by
`specs/189-command-middleware/contracts/module-origin.md` (owner answer of 2026-11-23, OR-10).
`specs/188-policy-points/` consumes the same contract. This file states only what 190 relies on and
what it must not do. If anything here disagrees with 189's contract, 189's contract wins and this
file is corrected.

## §1 What 190 relies on (189's, not restated)

- `ModuleOrigin = 'core' | 'deployment' | 'package'` in `@endora-commerce/contracts`
  (`src/modules.ts`).
- `ModuleEntry.origin`, set by the loader from where it found the module. The overlay loader
  (`loadOverlayModuleEntries`, `packages/platform/src/overlay/overlay-runtime.ts`) sets
  `'deployment'` beside `overlay: true`. No manifest field feeds it, and a manifest that carries
  `origin` is refused.
- The capabilities per origin: 189 §4 for command middleware, 188 for policy participants, and
  `specs/176-command-hooks-outbox/` for command hooks.

## §2 What 190 must not do

- Define an origin type, a tier type or a derivation function. The earlier draft's `TrustTier` /
  `trustTierOf(ModuleIdClaimOrigin)` in `lifecycle/services/module-origin.ts` is **withdrawn**.
- Confuse module origin with **migration** origin. `MigrationOrigin` (`'core' | 'external' |
  'generated'`, plus `'overlay'` from R-7) is the `./db` subpath's own union. It labels a migration's
  source for the guard, the template identity and `module:status`, and grants nothing. The existing
  `ModuleIdClaimOrigin` (`'core' | 'overlay' | 'package'`) keeps its own meaning (module id claims).
  How it relates to `ModuleOrigin` is 189's decision.
- Add a capability gate of its own. Nothing in 190 branches on origin. Schema, ports and admin are
  offered to every origin under the same guards (D-297).

## §3 Invariants 190 adds and tests

- **FR-091.** An overlay that owns entities, migrations, a `ports.ts` or an admin layer still
  composes with origin `deployment`. Owning schema moves nothing. The test is T083 (`tasks.md`,
  Phase 6), over a fixture overlay with one entity, one migration and an admin layer.
- **Promotion (OR-6).** A module promoted from an overlay to an installed package is found by the
  package loader, so it takes the origin 189 derives for it: `package`, unless it is one of this
  release's first-party module packages. A deployment that promotes a module using `admit`
  middleware loses that capability. The promotion guide (`contracts/docs-pass.md`) says so, citing
  189's table rather than copying it.

## §4 Capability summary, for orientation only

The rows owned by another spec are summaries. When a summary disagrees with its owner, the owner's
text applies.

| Capability | core | deployment (overlay) | package | Owner of the rule |
| --- | --- | --- | --- | --- |
| command hooks on declared hookable actions | yes | yes | yes | `specs/176-command-hooks-outbox/` |
| command middleware `observe` / `admit` | per 189 | per 189 | per 189 | `specs/189-command-middleware/` §4 |
| policy participants | per 188 | per 188 | per 188 | `specs/188-policy-points/` |
| decorate another **core / overlay** module's registration | no | yes, narrowed by #1841 | no | D-156.4 as narrowed by 189 |
| decorate an **installed package's** registration | no | **no** (`PackageDecorationNotOfferedError`) | no | unchanged |
| own schema, ports, admin | yes | **yes** (D-297) | yes | this feature |
