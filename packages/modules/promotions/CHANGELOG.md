# @endora-commerce/mod-promotions

## 0.7.0

### Minor Changes

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

- 705d398: New package: the Promotions module, the fifth to leave `backend/src/modules/`
  (feature 080, T040b) — and the second to publish a port interface.

  Four subpaths, no root wildcard, every one of them compiled output (D-164):
  - `@endora-commerce/mod-promotions` — the manifest. Isomorphic,
    `@endora-commerce/contracts` its only import, and where the generated manifest index reads
    the module's identity, its `dependencies` (`catalog`, `sales_channels`, `auth`,
    `currencies`, `dictionaries`, `orders`, `organizations`), its three permission codes, its
    two command-palette actions, its one setting and its activation control
    (`promotions.enabled`) from.
  - `@endora-commerce/mod-promotions/backend` — `registerModule(ctx)` and the `entities` array
    the host's ORM registry spreads. **No entity class is exported by name** (D-168):
    `Promotion`, `PromotionRuleEntity`, `PromotionCoupon`, `CouponBatch`, `PromotionUsage` and
    `PromotionUsageCounter` are imported to build that array and nothing else, so
    `import type { PromotionUsage } from '@endora-commerce/mod-promotions/backend'` does not
    compile in a consumer's tree, whoever the consumer is.
  - `@endora-commerce/mod-promotions/migrations` — the `migrations` array the platform's
    package loader reads, plus the three migration classes by name for the host's migration
    registry.
  - `@endora-commerce/mod-promotions/ports` — the type-only port subpath (layout contract R8,
    D-169), publishing `PromotionUsageFinalizer` and the two shapes its signature names,
    `UsageContext` and `FinalizeAppliedPromotion`. The emitted module is `export {};`, which is
    what makes the subpath resolvable for a consumer whose toolchain does not elide the import,
    and what makes it _contract surface_ under D-171. The implementation stays in the package's
    `src/backend/services/` and is reached through the container name `promotionUsageFinalizer`,
    never through this subpath.

  `@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are
  `@endora-commerce/contracts`, the three `@mikro-orm/*` packages and `fastify`: one copy of
  `HttpError`, `GlobalEntity` and `effectiveState` in the host process, resolved by the
  application rather than by this package.

  ## The port, and why it is on `./ports` rather than in `packages/contracts`

  R8's test is not _"is this a real published port"_ — `quote_requests` publishes two real ones
  and both belong in `@endora-commerce/contracts`. The test is _"does this signature stop the
  interface living in `packages/contracts`"_ — and `PromotionUsageFinalizer.finalizeUsage`
  takes the caller's MikroORM `EntityManager`, which `admin` and `storefront` both compile
  `contracts` and so cannot. The `EntityManager` is the **first, required method parameter**,
  never an optional context field: the optional spelling lets a caller hand a transaction to a
  handler that ignores it and receive a silently non-atomic write.

  For a consumer that means one specifier and no other change:

  ```ts
  import type { PromotionUsageFinalizer } from '@endora-commerce/mod-promotions/ports';

  const finalizer = lazyPort<PromotionUsageFinalizer>(ctx, 'promotionUsageFinalizer');
  await finalizer.finalizeUsage(tx, { orderId, currency, ctx: usage, applied });
  ```

  `finalizeUsage` bumps every scope counter with `update … where count < limit` on the caller's
  own transaction, so two carts racing for a coupon's final use cannot both succeed (SC-005),
  and a cap hit throws 409 so the placement rolls back with it.
  `promotion_usages_order_fk` (`promotion_usages.order_id` -> `orders.id`, `on delete restrict`)
  is what says so in the schema. A foreign key needs the **table** and never the owner's class
  (D-169), so that constraint stands across the package boundary untouched, exactly as
  `mod-credit-limits`' does.

  The read half of the promotion seam is **not** here and does not move:
  `PromotionApplyPort.applyToCart` takes a cart snapshot, names no ORM type, and stays published
  by `@endora-commerce/contracts` under the same container name `carts` already resolves.

### Patch Changes

- 5d9bb88: Error-code ownership: Tier B's six already-bundled modules declare the codes they own, and eight
  placeholder sentences leave the platform bundle.

  `manifest.errorCodes` gains seven codes on `@endora-commerce/mod-customer-accounts`
  (`ACCOUNT_BLOCKED`, `CANNOT_DEMOTE_LAST_ADMIN`, `CANNOT_REMOVE_LAST_ADMIN` and the four
  `CUSTOMER_*` record codes), six on `@endora-commerce/mod-catalog` (`BULK_TOO_LARGE`, the three
  `PACKAGING_UNIT_*` codes, `SELECTION_TOO_LARGE`, `SYSTEM_ATTRIBUTE_SET_IMMUTABLE`), three on
  `@endora-commerce/mod-orders` (`CURRENCY_MISMATCH`, `IDEMPOTENCY_KEY_REQUIRED`,
  `IDEMPOTENCY_KEY_REUSED`), two on `@endora-commerce/mod-mfa` (`TWO_FACTOR_REQUIRED`,
  `TWO_FACTOR_REQUIRED_BY_ROLE`), one on `@endora-commerce/mod-newsletter`
  (`ALREADY_SUBSCRIBED`) and one on `@endora-commerce/mod-promotions` (`PROMOTION_INVALID`);
  `@endora-commerce/mod-i18n` drops the same twenty from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 4 of eight;
  D-121 tiers T1 and T2; D-186 §1 and §2 in `specs/080-f4-real-scope/rulings.md`;
  `specs/090-module-owned-error-codes/d129-sweep.md`).

  `@endora-commerce/mod-customer-accounts`, `@endora-commerce/mod-newsletter` and
  `@endora-commerce/mod-promotions` declare an error code for the first time. No wire shape moves:
  `error.code` is unchanged for all twenty.

  **Eight sentences are deleted from `@endora-commerce/mod-i18n`'s bundle, and this is
  operator-visible.** Each was the error code rewritten twice — `"Currency Mismatch."` in `en` and
  `"Błąd: currency mismatch."` in `pl` — which D-186 §2 refuses to carry into a module's own
  bundle, where it would read as that module's answer rather than as an unwritten sentence. Four
  of the eight are replaced by real prose in both languages in the receiving module's own bundle:
  - `errors.SYSTEM_ATTRIBUTE_SET_IMMUTABLE` in `@endora-commerce/mod-catalog`
  - `errors.CANNOT_DEMOTE_LAST_ADMIN` and `errors.CANNOT_REMOVE_LAST_ADMIN` in
    `@endora-commerce/mod-customer-accounts`
  - `errors.CURRENCY_MISMATCH` in `@endora-commerce/mod-orders`

  The other four — `TWO_FACTOR_REQUIRED`, `TWO_FACTOR_REQUIRED_BY_ROLE`, `ALREADY_SUBSCRIBED` and
  `PROMOTION_INVALID` — are codes nothing in the platform raises, so there was no refusal to
  describe and the placeholder is deleted without a replacement. A consumer that reads those keys
  out of `@endora-commerce/mod-i18n`'s bundle directly will no longer find them; nothing in the
  platform produced the codes they belonged to.

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
