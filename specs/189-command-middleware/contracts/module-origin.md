# Contract: module origin (the trust tier)

D-296.3, D-296.4, D-296.8 and D-296.10. **This document is the single statement of the module
origin type and the trust tier** (owner ruling of 2026-11-23, D-296.10). `specs/188-policy-points/`
and `specs/190-overlay-full-modules/` consume it and do not redefine it (§4). A change to §1, §2,
§3 or §5 is a change to this contract, made here, and cited by the consumers.

## 1. The type

```ts
// @endora-commerce/contracts, src/modules.ts
export const MODULE_ORIGINS = ['core', 'deployment', 'package'] as const;
export type ModuleOrigin = (typeof MODULE_ORIGINS)[number];
```

| Origin | Which modules | Found by |
| --- | --- | --- |
| `core` | a workspace module of this repository, composed through the generated composer; **or**, in an instance, an installed package that is one of this release's first-party module packages | the generated composer; `loadPackageModuleEntries` with the first-party match (§2) |
| `deployment` | a per-deployment overlay module under `<root>/apps/<deployment>/modules/<id>/` | `loadOverlayModuleEntries` (`packages/platform/src/overlay/overlay-runtime.ts`) |
| `package` | every other installed package | `loadPackageModuleEntries` (`packages/platform/src/packages/package-runtime.ts`) |

## 2. Derivation, and where it lives

- `ModuleEntry` (`packages/platform/src/kernel/compose.ts`) gains
  `readonly origin?: ModuleOrigin`, documented as *set by the loader from where it found the
  module, never by the module*.
- The overlay loader sets `origin: 'deployment'` beside its existing `overlay: true`.
- The package loader sets `origin: 'core'` when **both** the installed package's own
  `package.json` `name` and its `endora.id` equal one entry of
  `FIRST_PARTY_MODULE_PACKAGES`. Otherwise it sets `origin: 'package'`. It keeps
  `installedPackage: true` in both cases.
- `FIRST_PARTY_MODULE_PACKAGES: readonly { moduleId: string; packageName: string }[]` is a
  generated file, `packages/platform/src/packages/first-party-modules.generated.ts`. It is rendered
  by `composer:generate` from the workspace by the rule the CLI's release index uses
  (`packages/cli/src/lib/release-index.ts` `publishablePackages`: every non-private, named
  workspace package), narrowed to packages declaring `endora.type: "module"`. It is imported, not
  restated. `overlay:check` fails on drift, as it does for
  `foreign-write-exemptions.generated.ts`. Lockstep releases (`release-intent.md`) make "this
  release's first-party set" one fact.
- `composeModules` resolves each entry's origin as `entry.origin ?? (entry.overlay ? 'deployment'
  : entry.installedPackage ? 'package' : 'core')`. It hands the map to the middleware registry's
  `seal` and to nothing else.

## 3. What origin does not do

- **It does not touch decoration.** `ModuleEntry.overlay` still grants the decoration exemption,
  as narrowed by D-296.5/6. `ModuleEntry.installedPackage` still withholds decoration of a
  package's registrations (D-176 Q3). Neither is derived from `origin`, and `origin` is not derived
  from them except as the fallback above. The `ForeignDecorationError` doc block's rule stands: a
  granting flag and a refusing flag are not merged into one enum.
- **It is not a manifest field.** `ModuleManifestSchema` does not gain `origin`. Where the phrase
  "manifest origin" is used (#1846, #1858), it means the origin of the **composed** manifest entry,
  as stamped by the loader. A manifest that carries an `origin` key is refused by
  `defineModuleManifest` with a message pointing here. Otherwise a reader might believe it does
  something.
- **It does not identify paid modules.** A paid package is not in this workspace (D-265), so its
  origin is `package`, and under D-296.3 it contributes `observe` only. Owner ruling of 2026-11-23
  (D-296.8): this holds until a **signed** first-party list exists. That list, and any change to
  §2's derivation that it brings, is a later ruling that amends D-296. Neither the npm scope nor a
  commercial relationship makes a package `core`.
- **It is not changed by a grant.** A per-point grant in the deployment's divergence declaration
  (§5) permits one contribution point for one package. The package's origin stays `package`, and
  every other point treats it as `package`.

## 4. Shared vocabulary for the 0.113.0 contribution mechanisms

The two manifest-declared contribution points of this release train use these words with these
meanings. This contract owns them (D-296.10). Whichever of 188 or 189 reaches implementation first
lands §1 and §2 in code **exactly as written here**. The other one rebases onto that code and does
not redefine it. 190 documents them as written here.

| Concept | Word | Command middleware (189) | Policy points (188) |
| --- | --- | --- | --- |
| Trust tier | `origin`: `core` / `deployment` / `package` | `admit`: core + deployment; `observe`: all | participants: core + deployment; a `package` only with a per-package grant (§5) |
| Per-point grant | §5, in the deployment's `divergence.ts` | none: D-296.3 is not grantable | per 188 (owner ruling of 2026-11-23, 188 row 5) |
| Ordering | transitive manifest `dependencies`; registration order within a module | `admit` only | `chain` combiner only |
| Tie-break | `<point>Order` in the deployment's `divergence.ts`, first runs first | `commandMiddlewareOrder: string[]` | per 188 |
| Unordered pair | composition refusal naming both modules and the remedy | `UnorderedCommandMiddlewareError` | per 188 |
| Activation | `isPresent(moduleId)` asked per call; absent is skipped | per run | per evaluation |
| Time budget | platform default plus optional `timeoutMs` under a cap | `admit` 100/500 ms, `observe` 1000/5000 ms | per 188 |
| Failure | fail closed unless the owner declares otherwise | `admit` always fails closed | owner-declared, default `fail-closed` |
| Report | divergence kind per mechanism, rung from `SEAM_CLASSIFICATION` | `command-middleware`, rung 2 | per 188 |

The values of the type are `core`, `deployment` and `package`. A consumer that shows origin (an API
field, a screen, a log line, a report column) uses these three words. It does not use `overlay`
for `deployment`, and it does not drop `package` because a point refuses it today.

## 5. Per-point grants: permission, not trust

A contribution point may let the deployment grant an installed `package` module a right that the
point withholds from `package` by default. The first such point is 188's policy participants
(owner ruling of 2026-11-23, 188 row 5). The grant lives in the deployment's committed divergence
declaration (`backend/src/apps/<deployment>/divergence.ts`, schema
`DeploymentDivergenceDeclarationSchema` in `packages/contracts/src/modules.ts`, parsed by
`packages/platform/src/lifecycle/divergence-declaration.ts`, loaded by
`backend/src/overlay/divergence-loader.ts`). The owning point's specification names the field and
its refusal errors. This contract states what a grant **is**, for every point:

1. **A grant is a per-point permission. It is not an origin and not a trust tier.** It changes the
   answer of exactly one point for exactly one package. The package's `origin` stays `package` in
   `ModuleEntry.origin`, in the origin map `composeModules` hands to registries, in boot log lines,
   in the divergence report and in any API that shows origin. No code derives an origin, or a right
   at another point, from a grant.
2. **A grant does not carry over.** A grant for policy participants does not let the package
   declare an `admit` middleware (D-296.3 stays a composition refusal, `CommandMiddlewareOriginError`),
   does not lift the request-metadata redaction a `package` observer gets (FR-022), and does not
   let anyone decorate the package's registrations or let the package decorate anyone's
   (`PackageDecorationNotOfferedError`, `ForeignDecorationError`). A point that wants grants says so
   in its own specification, and its grant is separate from every other point's.
3. **A grant names the package the way §2 names a first-party package**: by its module id **and**
   its installed `package.json` `name`, both of which must match the composed entry. An npm alias
   therefore cannot borrow another package's grant.
4. **A grant applies to `package` only.** A grant that names a module whose derived origin is
   `core` or `deployment` grants nothing and is refused at composition as misdirected, so that a
   declaration never suggests that a core or overlay module needed one. A grant naming a module that
   is not composed is reported as stale, like a stale order entry.
5. **A grant is visible.** The divergence report lists each grant with the package, the point and
   the deployment's reason. A package with no grant at a point that requires one still refuses
   composition, naming the package and the field that would grant it.
6. **The deployment owns the grant.** A module, an installed package or its manifest cannot grant
   itself anything (§3, *it is not a manifest field*). An instance with no deployment declaration
   grants nothing.

Command middleware has no grant in this release (D-296.3, D-296.7). If a later ruling widens
D-296.3 by grant rather than by origin, it uses this section unchanged.
