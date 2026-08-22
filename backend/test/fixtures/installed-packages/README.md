# Installed-package fixtures for the owner-map checks (feature 080, T034)

Four synthetic module packages, in the shape a **published** one has: compiled
JavaScript behind an `exports` map, no TypeScript sources, and nothing that names
this repository. They exist so the red proofs of

- `backend/scripts/check-entity-tenant-classification.ts`,
- `backend/scripts/check-module-boundary.ts`,
- `backend/scripts/check-port-dependencies.ts`

enter at the **top** of the package half of the analysis (issue #130): a
directory tree on disk, enumerated by `scanNodeModulesRoots`, subpath-resolved by
Node's own resolver, imported, and read for entity metadata — the same path
`package-runtime.ts` walks at boot.

`backend/test/unit/scripts/package-declarations.test.ts` copies whichever of them
a case needs into a throwaway `node_modules` directory **inside the repository**,
because that is what makes two things true at once: Node resolves the
`exports` subpaths (the root has to be called `node_modules`), and
`@mikro-orm/core` resolves out of the host, which is how a real package receives
its optional peer.

The built output is called `lib/`, not `dist/`: `dist/` is in `.gitignore`, and a
fixture that is not committed is a red proof nobody else can run.

| Package | Module id | What it is for |
| --- | --- | --- |
| `mod-widgets` | `fixture_widgets` | The ordinary case. One persisted entity with **no** tenant-scope decorator, one `create table` in a migration, one `ctx.di.providePort` and one plain `ctx.di.register`. |
| `mod-admin-only` | `fixture_admin_only` | Publishes neither `./backend` nor `./migrations`. Readable and empty — an attribution, not a silence. |
| `mod-schema-without-entities` | `fixture_schema_only` | Ships `./migrations` and a `./backend` that declares no `entities`. Unreadable: its tables would be in no map and its persisted classes in no classification. |
| `mod-bundled` | `fixture_bundled` | Exports a `registerModule` its own source does not name. Unreadable for the container-name half only. |
