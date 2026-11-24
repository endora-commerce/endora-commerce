# Contract — Overlay schema discovery (FR-030 – FR-039, R-4 – R-7)

Waits for #1866 (MikroORM 7.2.11, legacy decorators), #1848 (build) and #1849 (classification
refusal). Lands as **one** merge request with the deletion of every schema refusal (FR-037).

## §1 Reading an overlay's schema

`overlaySchemaContributionsUnder(root, ids)` (platform `overlay/overlay-schema.ts`, rewritten), per
overlay id, in id order:

1. `backend.{js,ts}` (`resolveOverlayUnit`) — `entities`: absent → `[]`; not an array → refuse
   `entities-not-array`; a non-constructor entry → refuse `entity-not-class` (the package reader's
   rules, `entityClassesFrom`). `schemaExtensions`: as the package reader, then V9 – V11 with the
   overlay context (§5).
2. `migrations/` — every runtime unit (`.js` compiled, `.ts` under `tsx`/`vitest`; skip `.d.ts`,
   `.map`, `*.test.*`), sorted. Each must export exactly one class; its name must equal the class
   name derived from the filename by the `naming-convention.md` §1–§2 recognisers. Otherwise refuse
   `migration-file-shape`, naming the file and what it found. Entry:
   `{ moduleId: id, cls, origin: 'overlay' }`.
3. `entities/` — import every runtime unit; each exported class that MikroORM's metadata storage knows
   as an entity and that is not in `entities` → refuse `overlay-entity-unexported`.
4. Manifest — `dependencies`, `activation.nonDeactivatable`, `version`.

## §2 Merging

- `configuredEntitiesFrom({ coreEntities, env, deploymentRoot })` =
  `PLATFORM_ENTITIES ∪ coreEntities ∪ packages' entities ∪ overlays' entities`, then
  `assertTransitiveParentsResolve` and the classification refusal (`entity-classification-refusal.md`).
- `discoverConfiguredMigrations(sources, env, deploymentRoot)` passes overlay contributions to
  `configuredMigrationsFrom` beside `packages`; the merge treats them identically except for the
  origin and the exemption list.
- **Guard (OR-4).** Every overlay migration is wrapped by `guardExternalMigration` with
  `moduleId = id`, `packageName = source label`, `entities = the overlay's entities`,
  `exemptions = []` (never filtered from `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS`), and the same
  reverse-edge context; `entitiesByModule` gains the overlays.
- **Order.** Overlay ids join `moduleDependencies` with their manifest `dependencies`; their chains
  land at their topological position (feature 081). Baseline membership is by identity, so an overlay
  migration never joins the frozen prefix.
- **Ownership.** `migrationOwnershipOf(entries, [...core ids, ...package ids, ...overlay ids])`.
- `DEPLOYMENT` unset or no overlay root → the result is byte-identical to today's.

## §3 The deployment root reaches every schema reader (FR-035)

| Reader | Today | After |
| --- | --- | --- |
| `backend/src/db/configured-entities.ts` (binding) | registry + packages | + overlay root from `overlay-roots.ts` |
| `backend/src/db/configured-migrations.ts` (binding) | registry + packages | + overlay root |
| instance `backend/src/mikro-orm.config.ts` (wiring) | `configuredEntitiesFrom({ coreEntities: [] })` | `+ deploymentRoot` (`backend/dist`) |
| instance `backend/src/migrate.ts` (wiring) | `refuseOverlaySchema(...)` then migrate | the refusal line is deleted; config carries the root |

## §4 Deleted in the same change (FR-037)

- `packages/platform/src/overlay/overlay-schema.ts`: `overlaySchemaFilesUnder`,
  `assertOverlayModulesShipNoSchema`, `refuseOverlaySchema` (the file's name is reused for §1);
  their call in `overlayModuleIdsUnder` (replaced by `assertOverlayLayout`).
- `packages/cli/src/generate/divergence.ts`: `overlaySchemaFiles` and its caller in
  `generate/index.ts`.
- `packages/cli/src/new-module/overlay.ts`: the `--entities` / `--tenant-scope` refusal **text** is
  corrected here (it may no longer claim the platform refuses); the flags themselves are lifted by
  #1852 (`overlay-cli.md` §1, FR-055).
- `backend/scripts/generate-composer.ts`: the `file.startsWith('apps/')` refusal branches for an
  entity, a migration and `schemaExtensions`; replaced by validation that emits nothing (R-4).
- Tests asserting the refusals (`overlay-schema.test.ts`, the CLI's generate tests,
  `default-composition-overlay.test.ts` cases) are rewritten to assert acceptance — **grep
  `backend/test/**` and every package's tests for `OverlaySchemaError` and "contributes no schema"
  before finishing** (AGENTS.md trap: deleted symbols fail only the suites `test:unit:fast` skips).

## §5 `x_*` columns from overlays (#1853)

`validateDeclarationContext(declarations, { hosts, packageModuleId: id, dependencyClosure:
closure over the composed graph (core ∪ packages ∪ overlays), source })`. Everything downstream —
generated step at the head of the overlay's block, ledger rows under the overlay id, verifier,
`module:schema-extensions`, orphan marking on uninstall — is unchanged. This repository's composer
keeps refusing `schemaExtensions` from **workspace module packages** (first-party modules own tables
or side tables) and accepts it from overlays (OR-3).

## §6 Tests

- Platform unit over temp trees: each refusal of §1; merge with/without overlay root; guard wraps
  overlay migrations with no exemptions (a foreign write is refused even when a first-party exemption
  names the same table).
- Integration (here, `DEPLOYMENT` set in-process): fixture overlay entity + migration applied in
  dependency order; ownership covers it; template digest includes it (FR-039).
- Instance acceptance: the fixture overlay's table exists after `setup`.
