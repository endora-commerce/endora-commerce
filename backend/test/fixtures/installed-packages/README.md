# Installed-package fixtures for the owner-map checks (feature 080, T034)

Synthetic module packages (the table below lists them), in the shape a
**published** one has: compiled JavaScript behind an `exports` map, no TypeScript
sources — `mod-acme-erp` keeps its `src/` beside `lib/` as documentation, never as
what is installed — and nothing that names this repository. They exist so the red proofs of

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
| `mod-instance-surfaces` | `fixture_instance_surfaces` | The **instance** case (`specs/110-instance-repository/` T101, T102). Ships an admin layer behind `./admin` and a `docs/` page at the package root, so the two artefacts a client's instance generates can be rendered over an installed population instead of over workspace members. Read by `backend/test/unit/scripts/instance-artefact-population.test.ts`. |
| `mod-acme-erp` | `acme_erp` | The worked example of declared extension columns (`specs/178-extensible-columns/quickstart.md`). Ships `src/` beside `lib/` — the TypeScript an author writes, type-checked by `backend/test/unit/fixtures/mod-acme-erp-source.test.ts`, which also installs `lib/` and observes the merge placing its generated step at the head of its block. The integration tests install it into a throwaway instance root (`backend/test/helpers/acme-erp-instance.ts`). |
