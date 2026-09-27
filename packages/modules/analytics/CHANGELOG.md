# @endora-commerce/mod-analytics

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.10.5

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.10.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.10.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

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

- 3c8102e: `analytics` ships its admin surface, on a new `./admin` subpath.

  The package now exports `contributions` from `@endora-commerce/mod-analytics/admin` — one
  route (`/analytics`) and one sidebar entry — as an `AdminContributions` object. The
  component is a dynamic-import factory, so a consumer's bundler splits the screen without
  being asked.

  Three things a consumer has to know:
  - **Every string the dashboard renders moved namespace.** The fourteen `analytics.*` keys
    and `appShell.nav.analytics` were in `@endora-commerce/mod-i18n`'s shared `core` bundle;
    they are now `page.title`, `range.7days`, `nav.analytics.label` and so on in this
    package's own `i18n/`, resolved in the `analytics` scope. Anything reading an old key
    gets a raw key back. The text itself is unchanged in both languages.
  - **The module declares a command-palette action, `open-analytics`.** It had an admin
    screen and a sidebar entry since feature 018 and no ⌘K entry, which Principle XVI says is
    not enough. It gates on `analytics:read`, the code `GET /api/v1/admin/analytics/summary`
    enforces.
  - **The package peers on `@endora-commerce/admin-kit`, `react` and `lucide-react`.** They
    are peers rather than dependencies for the reason `page-builder-core` is: the application
    must resolve exactly one copy, and a provider in one copy against a consumer in the other
    is a `null` context at runtime rather than a type error.

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
