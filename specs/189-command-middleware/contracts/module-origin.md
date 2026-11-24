# Contract: module origin (the trust tier)

D-296.3, D-296.4, D-296.8 and D-296.10. **This document is the single statement of the module
origin type and the trust tier** (owner ruling of 2026-11-23, D-296.10). `specs/188-policy-points/`
and `specs/190-overlay-full-modules/` consume it and do not redefine it (§4). A change to §1, §2,
§3, §5 or §6 is a change to this contract, made here, and cited by the consumers.

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
- `ModuleEntry` also gains `readonly installedPackageName?: string`: the `name` from the installed
  package's own `package.json` (not the dependency key it was installed under, so an alias shows
  its real name). **Only the package loader sets it**; the generated composer and the overlay
  loader leave it absent. It is what a grant is matched against (§5 item 3). Whichever of 188's P1
  and 189's P1 lands first adds it, and the other consumes it.
- `FIRST_PARTY_MODULE_PACKAGES: readonly { moduleId: string; packageName: string }[]` is a
  generated file, `packages/platform/src/packages/first-party-modules.generated.ts`. It is rendered
  by `composer:generate` from the workspace by the rule the CLI's release index uses
  (`packages/cli/src/lib/release-index.ts` `publishablePackages`: every non-private, named
  workspace package), narrowed to packages declaring `endora.type: "module"`. It is imported, not
  restated. `overlay:check` fails on drift, as it does for
  `foreign-write-exemptions.generated.ts`. Lockstep releases (`release-intent.md`) make "this
  release's first-party set" one fact.
- Both loaders compute the value through one function, `moduleOriginOf` (§6), and do not spell the
  mapping themselves.
- `composeModules` resolves each entry's origin as `entry.origin ?? (entry.overlay ? 'deployment'
  : entry.installedPackage ? 'package' : 'core')`. It hands the map to the seal of each contribution
  registry that reads origin, and to nothing else: the command-middleware registry's `seal` (this
  feature) and `PolicyRegistry.seal` (`specs/188-policy-points/`). Both receive the same map; neither
  derives origin itself.

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
| Per-point grant | §5, in the deployment's `divergence.ts` | none: D-296.3 is not grantable | `policyParticipantGrants`, per (point, package); ungranted → `PackagePolicyParticipantNotGrantedError`, malformed or stale → `InvalidPolicyParticipantGrantError` |
| Ordering | transitive manifest `dependencies`; registration order within a module | `admit` only | `chain` combiner only, in origin tiers `core`, then `package`, then `deployment` (the deployment outermost), and by dependencies within a tier |
| Tie-break | `<point>Order` in the deployment's `divergence.ts`, first runs first | `commandMiddlewareOrder: string[]` | `policyOrder: Record<pointId, string[]>`, within a tier; a mixed-tier entry is refused |
| Unordered pair | composition refusal naming both modules and the remedy | `UnorderedCommandMiddlewareError` | `UnorderedPolicyParticipantsError`; contradiction `PolicyOrderContradictionError` |
| Activation | `isPresent(moduleId)` asked per call; absent is skipped | per run | per evaluation |
| Time budget | platform default plus optional `timeoutMs` under a cap | `admit` 100/500 ms, `observe` 1000/5000 ms | per point, `budgetMs`: default 500 ms, bounds 1 to 10 000 ms, per participant, with an abort signal |
| Failure | fail closed unless the owner declares otherwise | `admit` always fails closed | owner-declared, default `fail-closed` |
| Report | divergence kind per mechanism, rung from `SEAM_CLASSIFICATION` | `command-middleware`, rung 2 | `policy-participant` and `policy-participant-grant`, both rung 3 |

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
   its installed `package.json` `name`, both of which must match the composed entry
   (`ModuleEntry.id` and `ModuleEntry.installedPackageName`, §2). An npm alias
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

## 6. `ModuleOrigin` and the discovery types it is not

The platform already has a type with almost the same values: `ModuleIdClaimOrigin = 'core' |
'overlay' | 'package'` (`packages/platform/src/lifecycle/services/module-origin.ts`, re-exported by
`lifecycle/services/module-id-claims.ts` and `lifecycle/index.ts`, carried by
`RegisteredManifestEntry.origin` in `lifecycle/manifest-registry.ts` and by
`ShippedModuleEntry.origin` in `lifecycle/services/presence-load.ts`). It answers a different
question, and **both types survive, unmerged**.

| | `ModuleIdClaimOrigin` | `ModuleOrigin` |
| --- | --- | --- |
| Question | which discovery produced the entry | how far the platform trusts the module |
| Values | `core` / `overlay` / `package` | `core` / `deployment` / `package` |
| Readers | the module-id collision refusal, `deploymentShippedEntries` (first-boot `module_registrations` insert and the boot settings reconcile) | contribution points: the command-middleware registry, 188's policy registry, divergence and boot-log output that shows a tier |
| A first-party module package installed in an instance | `package`: it was found by the package scan and is installed by `module:install`, which runs its migrations | `core`: it is on `FIRST_PARTY_MODULE_PACKAGES` (§2) |

The last row is why neither can be an alias of the other. If `ModuleOrigin` were
`ModuleIdClaimOrigin`, every first-party module in an instance would be `package` and lose `admit`
(R-11 (c)). If `ModuleIdClaimOrigin` followed the trust tier, `deploymentShippedEntries` would
converge a first-party package at boot, and `module:install` would then answer `already-installed`
about a package whose migrations never ran, which is the defect that function's doc block exists
to prevent.

**The mapping is one-way and has one spelling.** `packages/platform/src/lifecycle/services/module-origin.ts`
gains, beside `ModuleIdClaimOrigin`:

```ts
/** The trust tier of a module found by `discovery` (specs/189-command-middleware/contracts/module-origin.md §6). */
export function moduleOriginOf(
  discovery: ModuleIdClaimOrigin,
  firstPartyPackage: boolean,
): ModuleOrigin;
```

| `discovery` | `firstPartyPackage` | `ModuleOrigin` |
| --- | --- | --- |
| `core` | ignored | `core` |
| `overlay` | ignored | `deployment` |
| `package` | `true` (name and id match §2's list) | `core` |
| `package` | `false` | `package` |

The overlay loader and the package loader stamp `ModuleEntry.origin` through it, and the §2
fallback in `composeModules` is the same table read off `overlay` / `installedPackage`. Nothing maps
the other way: no trust tier is ever turned back into a discovery answer.

**Which spelling survives.** `ModuleOrigin` is the published word for the tier, in contracts.
`ModuleIdClaimOrigin` keeps its name and its `'overlay'` value. Renaming a published type of
`@endora-commerce/platform/lifecycle` to make the two look alike would be a breaking change that
buys nothing, and making them look alike is the confusion this section removes. Its doc comment
gains one sentence: *"This is discovery provenance, not a trust tier; for the tier see
`ModuleOrigin` (D-296.10)."* The same holds for `MigrationOrigin` (`packages/platform/src/db/migration-order.ts`),
which is a migration's provenance and keeps its own values, including the `'overlay'` value
`specs/190-overlay-full-modules/` adds.

**What decides an overlay's origin.** Only the discovery. A module the overlay loader found is
`deployment` whatever it ships: schema, migrations, entities, ports or an admin layer. Owning a
table does not raise or lower its tier, and no manifest field can change it (§3). This is the
derivation `specs/190-overlay-full-modules/` T083 tests (*"an overlay owning schema still composes
as `deployment`"*). The same module's `ModuleIdClaimOrigin` stays `overlay`, so it is part of
`deploymentShippedEntries`; how a schema-owning overlay's migrations run is 190's lifecycle
contract, not this one.

