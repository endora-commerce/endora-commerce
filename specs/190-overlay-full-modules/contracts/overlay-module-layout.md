# Contract — Overlay module layout (FR-002 – FR-004, R-15)

Normative for the loader, the CLI scaffolder and the documentation section *Overlay module layout*
that `specs/conventions/overlay-modules.md` gains (FR-101). Paths are an instance's; in this
repository prefix `backend/src/`.

## §1 Where a module is

```text
apps/<deployment>/
├── divergence.ts                 # the deployment's declaration (hand-written)
├── divergence.generated.{ts,md}  # derived report
└── modules/
    ├── <id>/                     # one module; <id> = manifest id
    └── <id>/
```

- Modules are **flat** under `modules/`. A directory is a module iff it is a direct child of
  `modules/` (hidden directories excluded — `listOverlayModuleDirs`, unchanged).
- **No nesting.** A `manifest.ts` or `manifest.js` anywhere below `<id>/` other than `<id>/manifest.*`
  is refused: `nested-module`, naming the file and the remedy ("make it a sibling module and declare
  the dependency").
- **Not a package.** Refused inside `<id>/`, as `package-in-disguise`: `package.json`, any
  `tsconfig*.json`, `tsup.config.*`, `vite.config.*`, `vitest.config.*`. The overlay build's one
  project lives outside `apps/` (`backend/tsconfig.apps.json`).

## §2 Fixed names

| Path | Fixed because | Required |
| --- | --- | --- |
| `manifest.ts` | the loader identifies the module by it | yes |
| `backend.ts` | the loader composes `registerModule`, reads `entities`, `schemaExtensions` | no (a module with no server half) |
| `i18n/en.json`, `i18n/pl.json` | `manifest.i18n.bundlesDir` convention; both shipped languages | when the module has any label |
| `migrations/` | schema discovery reads it file by file | when the module owns schema |
| `admin/index.tsx` | the deployment admin registry imports it | when the module has an admin surface |
| `ports.ts` | the only file a sibling overlay module may `import type` | when the module publishes port types |

## §3 Conventional names (the module's own; nothing reads them by name)

`entities/` (but see `overlay-schema-discovery.md` §2 — classes there must be exported), `services/`,
`workers/`, `routes.ts`, `commands/`, `hooks/`, `admin/**` below `index.tsx`. A `services/` file is
just one of the module's files (the convention's older "unknown override target" sentence is stale
and is removed, FR-101).

## §4 Splitting a module

When one overlay module grows two concerns, write two modules and a dependency:
`acme_loyalty` (tables, port) and `acme_loyalty_reports` (`dependencies: ['acme_loyalty']`,
`import type … from '../acme_loyalty/ports.js'`). The dependency is what the lifecycle, the migration
order and the activation axis see; a nested directory is what none of them see.

## §5 Promotion to a package

Moving `<id>/` into a module package keeps the id (OR-6). Mapping: `manifest.ts` → package root
export; `backend.ts` → `./backend`; `migrations/*` → `./migrations` array (same classes);
`ports.ts` → `./ports`; `admin/index.tsx` → `./admin`; `i18n/` → package `i18n/`. Consumers' type
imports switch from the path to the subpath.
