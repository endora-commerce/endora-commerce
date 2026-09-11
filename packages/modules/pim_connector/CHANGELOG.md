# @endora-commerce/mod-pim-connector

## 0.7.0

### Major Changes

- effb4e5: Stop republishing `@endora-commerce/contracts` symbols out of the two PIM packages.

  **Removed from `@endora-commerce/mod-pim-connector/backend`:**
  `canonicalisePimFieldPath` and `isValidPimFieldPath`, together with the
  `src/backend/services/field-path.ts` file that re-exported them. Both are, and
  have always been, `@endora-commerce/contracts`' own exports — the canonical
  implementation is `packages/contracts/src/pim-field-path.ts`, beside
  `pimFieldPathSchema` — and the module package added nothing but a second
  spelling of them.

  ```diff
  -import { canonicalisePimFieldPath } from '@endora-commerce/mod-pim-connector/backend';
  +import { canonicalisePimFieldPath } from '@endora-commerce/contracts';
  ```

  Nothing in this repository took either name from the module package:
  `pim_unopim`'s field-protection service and the unit test both already import
  them from `@endora-commerce/contracts` directly.

  **`@endora-commerce/mod-pim-unopim`** drops `export type
{ UnopimPassportStatus };` from `src/backend/services/unopim-client.port.ts`.
  That file is internal — the `./backend` barrel republishes only
  `UnoPimClientPort` from it — so no published surface changes; the type was
  imported for the sole purpose of being re-exported and no consumer named it
  there. `UnopimPassportStatus` is unchanged in `@endora-commerce/contracts`.

  Both removals exist because a bare re-export is what the D-168 entity-surface
  analysis cannot follow: it reported `unresolvable-reexport` for each package,
  which is _"whether this barrel publishes an entity class by name is unknown"_
  rather than _"it does not"_. Neither re-export was load-bearing, so the answer
  is now known.

### Patch Changes

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- 2c8635b: Fix UnoPim media downloads: a stored media path now resolves to `<baseUrl>/storage/<path>`, the address Laravel's public disk actually serves, instead of `<baseUrl>/media/<path>`, which answered 404 for every file. An absolute `http://` media address is also left as-is rather than being appended to the base URL.

  Allow local development instances to fetch UnoPim media over HTTP when the development-only environment override is enabled.

  Import UnoPim attribute and option labels per locale, split comma-separated multiselect values, and map boolean source values onto the auto-created yes/no options. `CatalogProductWritePort` now exposes `patchAttributeOption` so a later import can refresh option labels.

  The UnoPim import-run detail now includes the recorded per-record issues so the operator can see why a run finished with issues.

  Import now reads UnoPim 3 `GET /configurable-products` in addition to `GET /products`, and maps `super_attributes` / `variants` onto Endora configurable products. Previously only the simple-product list was walked, so configurable parents were created as simple products.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [b2552d5]
- Updated dependencies [cebad9c]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/platform@0.7.0
