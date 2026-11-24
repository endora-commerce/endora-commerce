# Data model — Overlay modules as full modules (190, D-297)

**No platform table changes.** `module_registrations`, `mikro_orm_migrations` and `schema_extensions`
keep their columns; overlay modules write rows into them under their own module id, exactly as
packages do. The tables an overlay creates are the deployment's own and are not modelled here. What
this feature adds are **in-process shapes** (types in `@endora-commerce/platform` and the CLI) and
**generated artefacts**.

## 1. `OverlaySchemaContribution` (platform, `overlay/overlay-schema.ts` — rewritten)

The overlay counterpart of `PackageSchemaContribution`
(`packages/platform/src/packages/package-runtime.ts`). Same field names where the meaning is the same,
so `configuredMigrationsFrom` merges both through one code path.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `string` | overlay directory name = manifest id; checked by the id-claim rule |
| `source` | `string` | `overlay apps/<deployment>/modules/<id>` — what diagnostics print where a package's print `packageName` |
| `version` | `string` | manifest `version` (generated schema-extension step name input) |
| `migrationsDirectory` | `string \| null` | the resolved `migrations/` directory, for the test template digest |
| `migrations` | `readonly MigrationRegistryEntry[]` | `origin: 'overlay'` (R-7) |
| `entities` | `readonly EntityClassLike[]` | `backend.ts`' `entities` export (R-6) |
| `dependencies` | `readonly string[]` | manifest `dependencies` |
| `nonDeactivatable` | `boolean` | manifest `activation.nonDeactivatable` |
| `schemaExtensions` | `readonly ColumnExtension[]` | validated V9 – V11 with the overlay context (FR-065) |

Function: `overlaySchemaContributionsUnder(root: string | null, ids: readonly string[],
options?): Promise<OverlaySchemaContribution[]>`; `null` root → `[]` (bare core unchanged).

## 2. Type widenings (published surface — changesets required)

| Type | Package / subpath | Change | Changeset |
| --- | --- | --- | --- |
| `MigrationOrigin` | `@endora-commerce/platform/db` | `+ 'overlay'` | platform `minor` |
| `MigrationRegistryEntry.origin` | platform `packages/` (host-internal) | `+ 'overlay'` | with the above |
| `ForeignSchemaGuardContext.packageName` | platform `db/` | unchanged name; for an overlay it carries the `source` label (no rename — a rename buys nothing) | none |
| `EntityConfigurationInputs` | `@endora-commerce/platform/db` | `+ deploymentRoot?: string` | platform `minor` |
| `CoreMigrationSources` / `discoverConfiguredMigrations` | `@endora-commerce/platform/db` | `+ deploymentRoot?: string` | with the above |
| `ComposeAppOptions` | `@endora-commerce/platform/composition` | `+ deploymentSourceRoot?: string` | platform `minor` |
| `DivergenceKind`, `DivergenceDetail` | `@endora-commerce/contracts` | `+ 'column-extension'` | contracts `minor` |

`../paid-modules` was searched for exhaustive use of `MigrationOrigin` and `DivergenceKind`: none.

## 3. Refusals (error classes, platform `overlay/`)

| Class | Verdicts / codes | Raised by |
| --- | --- | --- |
| `OverlayLayoutError` | `nested-module`, `package-in-disguise` | `assertOverlayLayout` inside `overlayModuleIdsUnder`; `endora build overlays` |
| `OverlayBuildError` | `stale`, `unbuilt`, `orphan` | freshness guard (R-9) at overlay resolution |
| `OverlaySchemaError` (kept name, new meaning) | `migration-file-shape` (none / two / name mismatch), `overlay-entity-unexported`, `entities-not-array`, `entity-not-class` | `overlaySchemaContributionsUnder` |
| `UnclassifiedEntityError` (platform `tenancy/`) | `unclassified`, `multiply-classified` | `configuredEntitiesFrom` (R-10) |

All four are printed by `exitOnRefusal` as a sentence and exit 1 (today it recognises only
`OverlaySchemaError`; it learns the class family).

## 4. Generated artefacts

| Artefact | Tree | Committed? | Population | Renderer |
| --- | --- | --- | --- | --- |
| `admin/src/modules.generated.ts` | both | here yes, instance no | packages with an admin layer (unchanged, bare core) | `emitAdminRegistry` |
| `admin/src/deployments/<deployment>.generated.ts` | both | here yes (every deployment on disk), instance no | overlay modules of that deployment with `admin/index.tsx` | `emitDeploymentAdminRegistry` (new, same file) |
| `admin/src/deployments/none.generated.ts` | both | as above | empty array | same |
| `admin/src/tailwind.generated.css` | both | as today | + one `@source` per overlay admin layer of every deployment on disk | `emitTailwindRegistry` |
| test-kit entity index (`entity-index-artefact.ts`) | instance | no | + overlay entities | existing renderer |
| `apps/<deployment>/divergence.generated.{ts,md}` | both | as today | + `column-extension` entries; own tables in `notRecorded` | divergence derivation |

`DEPLOYMENT_ADMIN_CONTRIBUTIONS: readonly AdminRegistryEntry[]` — the same entry shape as
`MODULE_ADMIN_CONTRIBUTIONS`, so `AdminRoot` takes the concatenation unchanged.

## 5. The freshness pairing

For a deployment root `R` (compiled) and source root `S`, an overlay source file
`S/apps/<d>/modules/<id>/<p>.ts` pairs with `R/apps/<d>/modules/<id>/<p>.js`, and a
deployment-level `S/apps/<d>/<f>.ts` (`divergence.ts`, `divergence.generated.ts`) with
`R/apps/<d>/<f>.js`.

| Source | Emitted | Verdict |
| --- | --- | --- |
| present | present, `mtime(src) <= mtime(out)` | `fresh` |
| present | present, `mtime(src) > mtime(out)` | `stale` |
| present | absent | `unbuilt` |
| absent | present (`.js` unit, not an asset) | `orphan` |

Excluded from pairing: `admin/**`, `*.test.ts`, `*.d.ts`, runtime assets (re-copied by every build run,
never judged by the guard).

## 6. Trust tier (consumed, OR-10)

No type here. The module origin `ModuleOrigin = 'core' | 'deployment' | 'package'` and
`ModuleEntry.origin` (stamped through `moduleOriginOf`) are
`specs/189-command-middleware/contracts/module-origin.md`'s, and an overlay composes with
`'deployment'`. `ModuleIdClaimOrigin` keeps `'overlay'` (discovery provenance, 189 §6). The earlier `TrustTier` / `trustTierOf` is withdrawn
(`contracts/trust-tier.md` §2). `MigrationOrigin` + `'overlay'` (§2, R-7) is a different union: it
labels a migration's source and grants nothing.

## 7. Overlay module identity across promotion

| Fact | As overlay | As package | Changes? |
| --- | --- | --- | --- |
| module id | directory name | `endora.id` | no (OR-6) |
| migration class names | `Migration<STAMP><Segment>…` | same | no |
| `mikro_orm_migrations` rows | class names | same | no |
| registry `origin` | `overlay` | `package` | yes — not persisted |
| tier | deployment | package | yes — fewer capabilities as a package |
| port types | `apps/…/ports.ts` | `./ports` subpath | import specifier changes |
