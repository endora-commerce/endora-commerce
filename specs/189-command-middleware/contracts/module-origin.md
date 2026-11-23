# Contract: module origin (the trust tier)

D-296.3 and D-296.4. This is the vocabulary `specs/188-policy-points/` and
`specs/190-overlay-full-modules/` share with this feature (§4).

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
  origin is `package` (spec OQ-1).

## 4. Shared vocabulary for the 0.113.0 contribution mechanisms

The two manifest-declared contribution points of this release train use these words with these
meanings. Whichever of 188 or 189 merges first lands §1 and §2. The other one rebases onto it and
does not redefine them.

| Concept | Word | Command middleware (189) | Policy points (188) |
| --- | --- | --- | --- |
| Trust tier | `origin`: `core` / `deployment` / `package` | `admit`: core + deployment; `observe`: all | participants per 188 (expected: core + deployment) |
| Ordering | transitive manifest `dependencies`; registration order within a module | `admit` only | `chain` combiner only |
| Tie-break | `<point>Order` in the deployment's `divergence.ts`, first runs first | `commandMiddlewareOrder: string[]` | per 188 |
| Unordered pair | composition refusal naming both modules and the remedy | `UnorderedCommandMiddlewareError` | per 188 |
| Activation | `isPresent(moduleId)` asked per call; absent is skipped | per run | per evaluation |
| Time budget | platform default plus optional `timeoutMs` under a cap | `admit` 100/500 ms, `observe` 1000/5000 ms | per 188 |
| Failure | fail closed unless the owner declares otherwise | `admit` always fails closed | owner-declared, default `fail-closed` |
| Report | divergence kind per mechanism, rung from `SEAM_CLASSIFICATION` | `command-middleware`, rung 2 | per 188 |
