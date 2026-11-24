# Contract — The deployment trust tier, as this feature consumes it (FR-090, FR-091, R-12, OR-5, OR-10)

**One home elsewhere.** The module origin type, its derivation and the tier vocabulary are owned by
`specs/189-command-middleware/contracts/module-origin.md` (owner answer of 2026-11-23, OR-10).
`specs/188-policy-points/` consumes the same contract. This file states only what 190 relies on and
what it must not do. If anything here disagrees with 189's contract, 189's contract wins and this
file is corrected.

## §1 What 190 relies on (189's §1 – §6, cited, not restated)

- **The tier** (189 §1): `ModuleOrigin = 'core' | 'deployment' | 'package'` in
  `@endora-commerce/contracts` (`src/modules.ts`). These three words are the only ones 190's
  documents use for the tier. An overlay's tier is `deployment`, never "overlay".
- **The derivation** (189 §2, §6): `ModuleEntry.origin` is stamped by the loader through the one
  mapping function `moduleOriginOf(discovery: ModuleIdClaimOrigin, firstPartyPackage: boolean)`
  in `packages/platform/src/lifecycle/services/module-origin.ts`. The overlay loader
  (`loadOverlayModuleEntries`) gets `'deployment'` from discovery `overlay`. No manifest field feeds
  it (189 §3), and a manifest that carries `origin` is refused.
- **Discovery provenance is a different type** (189 §6). `ModuleIdClaimOrigin = 'core' | 'overlay' |
  'package'` survives unmerged and keeps its `'overlay'` value. It answers "which discovery found
  the entry" for the module-id collision refusal and `deploymentShippedEntries`. An overlay that
  owns schema therefore stays `overlay` there, so it stays deployment-shipped
  (`contracts/overlay-lifecycle.md` §1), and is `deployment` as a tier.
- **Grants are permissions, not origin** (189 §5). A per-point grant in the deployment's
  `divergence.ts` (188's `policyParticipantGrants`) lets one installed `package` take part in one
  point. Its origin stays `package` everywhere. A grant naming an overlay (`deployment`) module is
  refused as misdirected, so a 190 overlay never needs one.
- **Capabilities per origin**: 189 §4 for command middleware, 188 for policy participants, and
  `specs/176-command-hooks-outbox/` for command hooks.

## §2 What 190 must not do

- Define an origin type, a tier type or a derivation function. The earlier draft's `TrustTier` /
  `trustTierOf(ModuleIdClaimOrigin)` in `lifecycle/services/module-origin.ts` is **withdrawn**.
- Confuse the tier with a provenance type. `MigrationOrigin` (`'core' | 'external' |
  'generated'`, plus `'overlay'` from R-7) is a migration's provenance, as 189 §6 states. It labels
  a migration's source for the guard, the template identity and `module:status`, and grants
  nothing. `ModuleIdClaimOrigin` is a module's discovery provenance (§1). Neither is mapped back
  from `ModuleOrigin`.
- Add a capability gate of its own. Nothing in 190 branches on origin. Schema, ports and admin are
  offered to every origin under the same guards (D-297).

## §3 Invariants 190 adds and tests

- **FR-091.** An overlay that owns entities, migrations, a `ports.ts` or an admin layer still
  composes with origin `deployment`. Owning schema moves nothing. The test is T083 (`tasks.md`,
  Phase 6), over a fixture overlay with one entity, one migration and an admin layer.
- **Promotion (OR-6).** A module promoted from an overlay to an installed package is found by the
  package loader (discovery `package`), so `moduleOriginOf` gives it `package`, unless it is one of
  this release's first-party module packages. A deployment that promotes a module using `admit`
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
| decorate another **core / overlay** module's registration | no | yes, except the four guard seams (below) | no | D-156.4 as narrowed by 189 |
| decorate an **installed package's** registration | no | **no** (`PackageDecorationNotOfferedError`) | no | unchanged |
| own schema, ports, admin | yes | **yes** (D-297) | yes | this feature |

**Guard-seam narrowing (189, #1841).** 0.113.0 warns and 0.114.0 refuses decoration of **only** the
four guard seams in `GUARD_SEAM_REGISTRATIONS` (`commandBus`, `auditLogService`, `eventBus`,
`emFactory`). Every other root-supplied registration name stays decoratable by an overlay, as do
other overlay and core modules' registrations.
