# Contract — CLI for overlay schema, ports and admin (FR-055 – FR-059, #1852 and the CLI halves of #1854 / #1855)

`--entities` / `endora new migration` wait for #1866 and schema discovery; `--ports` (#1854) and
`--admin` / `--action` (#1855) may land before.

## §1 `endora new module` in an instance

Lifted refusals in `packages/cli/src/new-module/overlay.ts` (`refuseWhatAnOverlayCannotBe`):

| Flag | Emits (in `apps/<deployment>/modules/<id>/`) |
| --- | --- |
| `--entities [--tenant-scope org-scoped\|customer-scoped\|global]` (the scaffolder's existing `TenantScope`) | `entities/<name>.entity.ts` with decorators from `@mikro-orm/decorators/legacy` and exactly one tenancy decorator (default `org-scoped`); `entities` export in `backend.ts`; a first migration via §2 |
| `--ports` | `ports.ts` with a port interface and a `ctx.di.providePort` call in `backend.ts` |
| `--admin <section>` (an `AdminNavSectionName`) | `admin/index.tsx` exporting `contributions` (landing route, sidebar entry in that section) |
| `--action <id>=<route>` (the existing syntax) | manifest `actions` entry, `labelKey` / `descriptionKey` in both bundles, `requiredPermission` = the module's gating permission |

Still refused: `--dir`, `--scope` (an overlay is not a package), `--worker`, `--subscriber` (one call
on the context, as today). Next steps printed include `pnpm run build` and `pnpm run generate`.

## §2 `endora new migration <moduleId> --name <slug>`

- Resolves the deployment as `new module` does (`.env` `DEPLOYMENT`, else the only `apps/*`).
- Refuses an id that is not an overlay module of that deployment (an installed package's migrations
  are its author's).
- Writes `migrations/<YYYYMMDDTHHmmss>_<module-segment>_<slug>.ts`, UTC stamp clamped above
  `BASELINE_THROUGH`, class `Migration<STAMP><PascalCaseTail>` beginning with the module segment,
  extending `Migration` from `@mikro-orm/migrations`, with empty `up()` / `down()`.
- The naming code is one implementation shared with this repository's
  `backend/scripts/new-migration.ts` (moved into `packages/cli/src/lib/`), which gains
  `--module <overlay-id>` writing into `backend/src/apps/<deployment>/modules/<id>/migrations/`
  (FR-057).

## §3 Test-kit entity index

`packages/cli/src/lib/entity-index-artefact.ts`' population gains the overlay entities of the selected
deployment (read from sources: decorator syntax nodes, as for packages' sources).

## §4 `endora generate` additions

- Overlay boundary analysis (`overlay-ports.md` §3) — exit 1 after writing its report.
- Deployment admin registries and Tailwind sources (`overlay-admin-layer.md`).
- Palette coverage per deployment (`overlay-admin-layer.md` §4) — exit 1 after writing.
- The `overlaySchemaFiles` refusal is gone (`overlay-schema-discovery.md` §4).

## §5 Tests

CLI unit per flag (emitted files, refusal of the still-refused flags), migration naming parity with
`new-migration.ts` over a table of stamps and slugs, acceptance: scaffold → build → setup → route.
