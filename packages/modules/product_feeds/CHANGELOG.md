# @endora-commerce/mod-product-feeds

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

- 0ab2044: Publish the object store, the availability port and the batched category and
  asset reads `product_feeds` reached through a composition root.

  `@endora-commerce/contracts` gains four exports and one method, all additive:
  - `ObjectStoragePort` (container name `objectStoragePort`, owner
    `assets_library`) with `ObjectStore`, `ObjectStoragePutInput`,
    `ObjectStorageBackendCode` and `AssetByteStream`. A byte store for a module
    that keeps its own objects under its own locator prefix and creates no `Asset`
    row. `getForBackend` is **total** — `legacy` is a URL resolver for pre-013
    rows, not a store, so it is not in the code union and a consumer has no arm to
    probe for.
  - `InventoryAvailabilityPort`, the shape `inventoryAvailabilityPort` has always
    answered. The registration carried no type argument, so there was no name to
    import.
  - `CatalogCategoryReadPort.expandCategoryProductIds(categoryIds)` — the batched,
    live-narrowed, cycle-tolerant subtree walk. It is **not** a batched
    `listProductIdsInSubtree`: that one is structural by contract and is a
    recursive CTE with no cycle guard.
  - `AssetReadPort.resolvePublicUrls(assetIds)` — the stable public URL of each
    live, public asset, and nothing for the rest. Absence is the answer rather
    than an exception, because only the owner can tell a stable URL from an
    expiring signed one.

  Breaking, `@endora-commerce/mod-product-feeds`:
  - `ProductFeedsBridge` is **removed**. The module resolves the four ports above
    itself; a composition contributes nothing to it beyond deployment values.
  - `ProductFeedsModuleOptions.storageAdapters: ArtefactStorageAdapterProvider`
    becomes `objectStorage: ObjectStoragePort`. Pass the container's
    `objectStoragePort` instead of an adapter registry.
  - `ArtefactStorageAdapter` and `ArtefactStorageAdapterProvider` are removed from
    `services/artefact-store.js`; `ArtefactStorageBackend` is now
    `ObjectStorageBackendCode` and `ArtefactStorePort.open` returns a
    `node:stream` `Readable` rather than a `NodeJS.ReadableStream`.

  Breaking, `@endora-commerce/mod-catalog`:
  - `CatalogQueryService.expandCategoryProductIds` is **removed**. The same walk,
    unchanged, is `CatalogCategoryReadService.expandCategoryProductIds`, published
    on `catalogCategoryReadPort`. It is a category read and it now has one home.

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

### Major Changes

- 4c521c0: Four `catch` blocks in this module stop swallowing `ModuleDisabledError`, and
  `DeliveryService.deliver` therefore has a new contract.

  **Breaking — `DeliveryService.deliver(request)`.** It documented "never throws" and
  returned `{ status: 'failed', failureReason: 'internal_error' }` for anything that went
  wrong, including a switched-off `credentials`. Every delivery target's password lives in
  that module (FR-107), so `resolveTarget` goes through `credentialsService`; an operator who
  withdrew the capability was told this module had a defect, and every retry said it again.
  It now re-throws `ModuleDisabledError` and absorbs everything else exactly as before.

      // before — one call site, and it could not tell the two apart
      const outcome = await delivery.deliver(request);
      if (outcome.status === 'failed') retryOrGiveUp(outcome);

      // after — the presence answer is not an outcome
      let outcome;
      try {
        outcome = await delivery.deliver(request);
      } catch (error) {
        rethrowIfModuleDisabled(error); // or let it reach the caller, which is the point
        throw error;
      }
      if (outcome.status === 'failed') retryOrGiveUp(outcome);

  The BullMQ consumer needs no change: the throw is the retry request it already speaks, and
  no attempt row is written for an attempt that never resolved a target.

  `FeedGenerationService.generateNow` and `TaxonomyRefreshService.runCheck` gain the same
  one exception. A presence answer has no honest `FeedRunFailureCode` and no honest
  `FeedTaxonomyCheckReason` — the run did not fail, the platform declined to assemble it —
  so neither is recorded as one any more. The claimed run row is left `running` for
  `FeedRunReaperService`, which already owns exactly that case.

  **New export — `productFeedsSettingsAccess(settings)`** and its
  `ProductFeedsSettingsAccess` type. The module's four typed settings readers, previously an
  object literal inside `productFeedsModule`. They answer the manifest default for a setting
  the boot reconciler has not written yet, and re-throw `ModuleDisabledError`; `settings`
  declares `activation.nonDeactivatable`, so the second half is unreachable today and is
  written now rather than left for whoever withdraws that lock.

  `reconcileSchedulers`' first parameter is renamed `backend` -> `schedulers`, positional and
  therefore not a call-site change.

- 5253b3e: Four promise-form `catch`es stop swallowing `ModuleDisabledError`. Each is a call that
  answered "there is nothing here" for a capability the operator had switched off, and each
  therefore has a new contract for its caller.

  **Breaking — `OrderConfirmationService.resolveAdditional(organizationId, salesChannelId)`.**
  It documented "invalid or empty entries are dropped, never fatal" and returned `[]` for any
  failure of the organisation read, which goes through `organizationDetailsPort`. It now
  rejects with `ModuleDisabledError` when `organizations` is absent and still returns `[]` for
  every other failure.

      // before — an order confirmed with the buyer as its only recipient
      const extra = await confirmation.resolveAdditional(orgId, channelId);

      // after — the caller decides, because it can now tell the two apart
      let extra: string[];
      try {
        extra = await confirmation.resolveAdditional(orgId, channelId);
      } catch (error) {
        rethrowIfModuleDisabled(error);
        throw error;
      }

  **Breaking — `resolveEmbedderConfig(settings, channelId, credentials)`.** It returned the
  empty config, which every caller reads as "LLM search is not configured", for an absent
  `credentials` module as well as for an unset reference. It now rejects with
  `ModuleDisabledError` for the first and still returns the empty config for the second.

  **Breaking — `LlmProviderFactory.capability()` and `.resolve()`.** `capability()` reported
  `not_configured` and `resolve()` threw `AssistantNotConfigured` when `credentials` was
  absent, sending the operator to configure a credential that was already configured. Both now
  let `ModuleDisabledError` through.

  **Breaking — `DeliveryConfigService.remove(productFeedId)`.** The credential cleanup after
  the configuration delete absorbed everything. It now rejects with `ModuleDisabledError` when
  `credentials` is absent — the configuration row is gone and its secret is not, and a retry
  cannot reach the secret because the code that named it went with the row. A credential that
  is merely already gone is still tolerated.

  `@endora-commerce/mod-pim-pimcore` is a rename with no API surface: one file-scoped `worker`
  binding becomes `deliveryWorker`.

### Minor Changes

- 61e4ff5: The Product Feeds module is now a package. `@endora-commerce/mod-product-feeds`
  publishes `.` (the manifest), `./backend` (`registerModule`, `entities`, and the
  `ProductFeedsBridge` / `ProductFeedsCradle` interfaces) and `./migrations` (the
  seven migration classes plus the ordered `migrations` array).

  It is also the first package to ship a **non-TypeScript runtime asset**: the four
  bundled Google Merchant and Meta taxonomy files. `tsc` compiles `.ts` and copies
  nothing else, so the package's `build` script is `tsc` followed by
  `scripts/copy-package-assets.mjs`, which mirrors every ruled-in asset under the
  package's `rootDir` into its `outDir` and refuses a build whose emitted tree does
  not hold them. Nothing in the module's own sources changed for it:
  `TaxonomyReconcilerService` still finds its data relative to `import.meta.url`,
  which now resolves inside `dist`.

  Consumers taking an entity class must take it from the `entities` array on
  `./backend`, by name — the platform composes the published artefact, so a
  filesystem path into this package's source is a second copy of the class.

- 4013a8b: `promotions`, `payment_methods`, `customer_accounts` and `product_feeds` ship their admin
  surfaces, on a new `./admin` subpath each; `KnownIconNameSchema` gains one member and the kit's
  icon map the glyph behind it.

  Each of the four module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. Seventeen routes and eight sidebar entries move,
  and not one of the routes changes its path: `/promotions`, `/promotions/new`, `/promotions/:id`,
  `/promotions/:id/stats` and `/promotion-rules`; `/payment-methods`; `/customer-groups`; and the
  ten `/product-feeds*` paths.

  Six things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react`, `lucide-react` and `react-router-dom` become peer
    dependencies of all four.** They were backend-only packages before this. The kit is where
    every screen's design-system import now resolves, and React is peered rather than depended on
    so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.** `promotions:read`
    for all five promotion routes, `payment_methods:read`, `customer_groups:read` and
    `product_feeds:read` — in each case the code the screen's own API enforces on its entry
    handler. A host `<Route>` was ungated, so a consumer who deep-links one of these paths for an
    operator without the code now gets the admin's not-found treatment where the screen used to
    render and its API answered 403. The write codes each of these modules also owns
    (`promotions:write`, `promotions:delete`, `payment_methods:write`, `customer_groups:write`,
    `product_feeds:write`) gate controls **inside** a screen and are unchanged.
  - **`KnownIconNameSchema` gains `PercentDiamond`.** A nav entry names its icon, and both of
    `promotions`' sidebar rows drew that glyph as a `lucide-react` import inside the admin's own
    `AppShell.tsx` until this change — so keeping the sidebar looking the same meant adding the
    name rather than substituting one already on the allowlist.
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Widening a `z.enum` is additive for a
    producer and narrowing for a consumer that exhaustively switches on `KnownIconName`; nothing
    in this repository does. The other three modules needed nothing — `CreditCard`, `Users` and
    `Rss` are already on the list, each added by an earlier palette action of that same module.
  - **`@endora-commerce/mod-product-feeds` gains two sales-channel reads of its own.**
    `feedSalesChannelReads.list()` and `.getByCode()` on the module's admin client build
    `GET /api/v1/admin/sales-channels` requests from the published `apiClient` and the contract's
    own `SalesChannelListResponse` / `SalesChannelDetail`. The create form used to import
    `sales_channels`' admin client for the same two calls; duplicating one HTTP call is
    deliberate, because the only place two modules could share it is the admin kit and the kit
    holds no module knowledge.
  - **`product_feeds`' download anchors now read the API origin from
    `@endora-commerce/admin-kit`'s `apiBaseUrl`.** They read `import.meta.env.VITE_API_BASE_URL`
    directly before, with a `''` fallback — same-origin, which in a dev tree is the Vite server
    and has no API behind it. The kit's fallback is `http://localhost:3001`. Whenever the
    variable is set the two are identical, so this is a repair to the unset case and not a change
    to any configured one.

  Each of the four modules' nav labels move out of the shared `_i18n` bundle into the package's
  own `i18n/`, under module-relative keys (`nav.promotions.label`, `nav.promotionRules.label`,
  `nav.paymentMethods.label`, `nav.customerGroups.label`, `nav.productFeeds.label`). One shared
  key is deliberately kept: `appShell.nav.paymentMethods` is still the parent crumb of five
  breadcrumb trails the admin holds for the payment-gateway settings screens.

  Nothing is removed and no existing export changes shape, so a consumer of any of the four
  `./backend`, `./migrations`, `./ports` or root subpaths is unaffected.

- 7af67c0: Declared as `peerDependencies` the packages these seven already publish types from (D-181).

  Each of them emits a `.d.ts` that imports a specifier its manifest declared only as a
  `devDependency`, which a consumer's install does not resolve. The consequence is silent:
  the type becomes `any`, and under `skipLibCheck: true` — what `tsc --init` writes — there
  is **no diagnostic at all**. Measured on `@endora-commerce/mod-catalog` with
  `@endora-commerce/mod-custom-fields` not installed: the exported
  `CatalogCradle.customFieldDefinitionService` typed as `any`, clean compile; with it
  installed, the correct `CustomFieldDefinitionApplyApi` and a refused assignment.

  Eleven peers, in two shapes:
  - **A published port interface of another module package** — `mod-catalog` →
    `mod-custom-fields`, `mod-customer-accounts` → `mod-organizations`, `mod-orders` →
    `mod-carts` / `mod-credit-limits` / `mod-inventory` / `mod-invoices` / `mod-promotions`,
    `mod-payments` → `mod-orders`. All are `import type … from '<pkg>/ports'` and all appear
    in the emitted declarations, so a consumer type-checking the package resolves them.
  - **A `@types/*` companion whose library reaches the declarations** — `@types/pdfmake`
    for `mod-invoices` and `mod-comparisons` (`pdfmake/interfaces.js` has no types without
    it), `@types/ssh2-sftp-client` for `mod-product-feeds`.

  **If you install one of these packages**, its peers are now install-time requirements
  rather than something your own tree happened to provide. `@types/nodemailer` and
  `@types/web-push` are deliberately _not_ among them: their libraries are imported inside
  function bodies and reach no published signature. Neither is `@types/react` or any other
  types package that contributes global declarations — those exist once in a program by
  construction, and forcing our copy is a conflict you could not fix.

  `minor` rather than `major`: nothing here changes an exported symbol or a call, and the
  requirement is one a consumer that type-checks these packages already had to satisfy for
  the types to mean anything. It is more than a patch because a resolver that was silently
  succeeding will now report an unmet peer.

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
