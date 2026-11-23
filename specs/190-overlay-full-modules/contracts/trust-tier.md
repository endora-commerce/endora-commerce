# Contract — The deployment trust tier (FR-090, FR-091, R-12, OR-5)

## §1 Derivation (this feature's half)

```ts
// packages/platform/src/lifecycle/services/module-origin.ts
export type TrustTier = 'core' | 'deployment' | 'package';
export function trustTierOf(origin: ModuleIdClaimOrigin): TrustTier; // core→core, overlay→deployment, package→package
```

The input is the `origin` set where an entry is **constructed** (`RegisteredManifestEntry.origin`;
`ModuleEntry.overlay` / `installedPackage`), from the root the module was discovered under. No manifest
field feeds it. If `specs/189-command-middleware/` lands the same function first, this feature imports
it and adds nothing (one home).

## §2 What the tier grants (consumed, not defined here)

| Capability | core | deployment (overlay) | package | Owner of the rule |
| --- | --- | --- | --- | --- |
| command hooks on declared hookable actions | yes | yes | yes | `specs/176-command-hooks-outbox/` |
| command middleware `observe` | yes | yes | yes | `specs/189-command-middleware/` |
| command middleware `admit` | yes | yes | no | `specs/189-command-middleware/` |
| policy participants | yes | yes | per 188 | `specs/188-policy-points/` |
| decorate another **core / overlay** module's registration | no | yes, narrowed by #1841 | no | D-156.4 as narrowed by 189 |
| decorate an **installed package's** registration | no | **no** (`PackageDecorationNotOfferedError`) | no | unchanged |
| own schema, ports, admin | yes | **yes** (D-297) | yes | this feature |

## §3 Invariants

- Owning schema does not change an overlay's tier (FR-091).
- A promoted module (OR-6) takes the `package` tier — a deployment that promotes a module using
  `admit` middleware loses that capability; the promotion guide says so.
