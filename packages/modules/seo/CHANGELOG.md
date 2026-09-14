# @endora-commerce/mod-seo

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

### Patch Changes

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Minor Changes

- 196fbfa: Six modules ship their admin surfaces, and the delivery-methods list becomes a zone its
  carriers contribute to.

  **New `./admin` subpath on six packages.** `@endora-commerce/mod-seo`,
  `mod-taxes`, `mod-credit-limits`, `mod-delivery-methods`, `mod-megamenu` and `mod-returns`
  each export `contributions` — an `AdminContributions` object — from
  `@endora-commerce/mod-<id>/admin`. Every component is a dynamic-import factory, so a
  consumer's bundler emits one chunk per screen. The routes are unchanged: `/seo`, `/taxes`,
  `/credit-limits`, `/delivery-methods`, `/megamenu` plus `/megamenu/:id`, and `/returns`
  plus its four sub-screens.

  Three things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit` and `react` become peer dependencies of all six.** The kit
    is where every screen's design-system import resolves, and `react` is peered rather than
    depended on so the application resolves one copy.
  - **Each package now ships an `i18n/` bundle carrying its own `nav.*.label`.** The sidebar
    label is module-relative — `nav.seo.label`, `nav.taxes.label`, `nav.creditLimits.label`,
    `nav.deliveryMethods.label`, `nav.megamenu.label`, `nav.returns.label` — resolved in the
    module's own namespace instead of the shared `core` one.

  **New in `@endora-commerce/contracts`:**
  - `AdminZoneNameSchema` gains `'delivery_method.list.integrations'`, the first member whose
    host is not the product editor, with `DeliveryMethodIntegrationsZoneProps` (empty: the
    host renders one card per shipping integration and has no identifier to name one by) and
    its `AdminZonePropsMap` entry.
  - `KnownIconNameSchema` gains `'Newspaper'`, which `megamenu`'s sidebar entry names now
    that it declares its own row rather than importing the glyph.

  **New in `@endora-commerce/admin-kit`:** `DeliveryMethodIntegrationsZoneProps` is re-exported
  from `./contributions`, and `resolveIcon('Newspaper')` answers.

  **`mod-dhl-parcel` and `mod-inpost` each gain a zone contribution**, on the `./admin`
  subpath they already had:

  ```ts
  zoneComponent(
    'delivery_method.list.integrations',
    () => import('./zones/DeliveryMethodIntegrationCard.js'),
    {
      weight: 100,
      requiredPermission: 'dhl_parcel:read',
    },
  );
  ```

  `delivery_methods` used to render both cards itself, with each carrier's title, description,
  route and permission code written into its own file. A third carrier now needs no edit to a
  file its author does not own, and the presence gate, the permission gate and the ordering are
  the zone renderer's.

  Nothing is removed and no existing export changes shape, so a consumer of any package's
  `./backend`, `./migrations` or root subpath is unaffected.

- 3ad96d8: Ten new packages: the first **batch** of modules to leave `backend/src/modules/`
  (feature 080, T040b). Five moved one at a time before them; these ten move together, and
  the properties below are the same ten times over.

  **One changeset, not ten, and that is a judgement rather than a shortcut.** A changeset is
  written for the consumer of a package, and for a package that did not exist a moment ago
  there is no upgrader to instruct — every one of the ten says the same thing, _"this package
  now exists, here are its subpaths, and here is what it deliberately does not export"_. Ten
  files carrying one rationale would be nine copies of a derived fact. What genuinely differs
  per package is its layer inventory, and that is the table below.

  Every subpath is compiled output (D-164); none has a root wildcard; each package's `.` is
  its `manifest.ts`, where the generated manifest index reads the module's identity, its
  `dependencies`, its permission codes, its command-palette actions, its settings and its
  activation control.

  | Package                                | Subpaths                         | Entities                          | Migrations | Ships          |
  | -------------------------------------- | -------------------------------- | --------------------------------- | ---------- | -------------- |
  | `@endora-commerce/mod-health-checks`   | `.`, `./backend`                 | —                                 | —          | `dist`         |
  | `@endora-commerce/mod-audit-logs`      | `.`, `./backend`                 | —                                 | —          | `dist`         |
  | `@endora-commerce/mod-addresses`       | `.`, `./backend`                 | `Address`                         | —          | `dist`         |
  | `@endora-commerce/mod-currencies`      | `.`, `./backend`                 | `Currency`                        | —          | `dist`         |
  | `@endora-commerce/mod-languages`       | `.`, `./backend`, `./migrations` | `Language`                        | 1          | `dist`         |
  | `@endora-commerce/mod-seo`             | `.`, `./backend`, `./migrations` | `SeoMetaOverride`, `SitemapCache` | 1          | `dist`         |
  | `@endora-commerce/mod-analytics`       | `.`, `./backend`, `./migrations` | `AnalyticsEvent`                  | 1          | `dist`         |
  | `@endora-commerce/mod-import-export`   | `.`, `./backend`                 | —                                 | —          | `dist`, `i18n` |
  | `@endora-commerce/mod-shipments`       | `.`, `./backend`, `./migrations` | `Shipment`                        | 2          | `dist`         |
  | `@endora-commerce/mod-payment-methods` | `.`, `./backend`, `./migrations` | `PaymentMethod`                   | 2          | `dist`, `i18n` |

  **`./backend` publishes `registerModule(ctx)` and an `entities` array, and no entity class by
  name** (D-168). The classes in that column are imported to build the array and are exported
  under no name, so `import type { PaymentMethod } from '@endora-commerce/mod-payment-methods/backend'`
  does not compile in a consumer's tree, whoever the consumer is. A foreign key still works —
  `shipments.order_id -> orders.id` is between two column names and needs the table, never the
  owner's class.

  **Three of the ten own no table, and say so with an empty array rather than by omission.**
  `health-checks`, `audit-logs` and `import-export` export `entities: readonly never[] = []`.
  The distinction is not cosmetic: the platform's package loader answers a _missing_ export with
  `[]`, so "this module has no table" and "somebody forgot the array" would otherwise arrive as
  one silence, whose only symptom is a query against a table nobody created.

  **`./migrations` publishes a `migrations` array plus each class by name.** The asymmetry with
  `./backend` is deliberate — `mikro_orm_migrations` persists the class name, so it is a string
  every already-migrated database holds, while an entity class name is contract to nobody.

  **Two behavioural removals, both in `./backend`, both affecting no caller in this repository.**
  `@endora-commerce/mod-currencies/backend` no longer re-exports `CURRENCY_CHANGED_EVENT` and
  `@endora-commerce/mod-languages/backend` no longer re-exports `LANGUAGE_CHANGED_EVENT`. Both
  constants live in `@endora-commerce/contracts` and have since feature 075's Phase P; the
  re-exports were that phase's compatibility shim, kept for consumers that turned out not to
  exist. Import them from `@endora-commerce/contracts`, which is where the one and only
  `dictionaries` consumer already reads them.

  ```ts
  // before — from the module barrel
  import { CURRENCY_CHANGED_EVENT } from '@endora-commerce/mod-currencies/backend';
  // after — from the contracts package, where the constant is declared
  import { CURRENCY_CHANGED_EVENT } from '@endora-commerce/contracts';
  ```

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
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
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
- Updated dependencies [214cbdb]
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
- Updated dependencies [e7bbadc]
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
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/platform@0.7.0
