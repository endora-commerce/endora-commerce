# @endora-commerce/mod-price-lists

## 0.109.0

### Minor Changes

- f148418: The storefront probes that take a bare product id follow product data scopes per sales channel and language.

  - **Behaviour change for API clients — price and stock probes:** `GET /api/v1/storefront/products/:id/resolved-price`, `GET /api/v1/storefront/pricing/display-mode/:productId`, `GET /api/v1/storefront/inventory/stock/:id` and both notify-when-available routes (`POST /api/v1/storefront/inventory/notify-when-available`, `POST /api/v1/catalog/products/:id/notify-when-available`) answer only about a product available at the request's channel and language to the caller now. A product that is switched off there, outside its publication window, sold on another channel or outside the channel's audience rule gets each route's existing `404`, the same body an id nobody sells gets; a notify-when-available request for such a product can no longer reach `409 PRODUCT_UNMANAGED_STOCK` or `422 PRODUCT_IN_STOCK`.
  - **Composition:** `price_lists`' plugin options and `inventory`'s plugin options take `catalogAvailability` (`catalogProductAvailabilityPort`), required; `AvailabilityNotificationService` takes it in place of the sales-channel membership port, and `SubscribeInput` gains `languageTag`.
  - **Caching:** `markPersonalisedPricing` now marks every response for an authenticated caller `private, no-store`, not only one naming an organisation; `GET /api/v1/catalog/filters` and `GET /api/v1/catalog/categories` call it, since their counts and tree follow the caller's audience. Anonymous responses stay unstamped.
  - **Product page:** an archived product answers `410` only where it would be available with the archive taken away; otherwise (switched off in that channel or language, outside its window) it answers the absent product's `404`.
  - **Buyer seams name their channel:** `CreateForCustomerOptions.salesChannelId` (and the draft-edit and resubmit options) carry the channel the buyer's route resolved; quick order's pasted-SKU lookup takes it too; the basket asks availability at its own channel. The audience-only answer remains only for callers outside a request.
  - **Helpers:** `@endora-commerce/contracts` exports `toScopeChannel`, `scopeLanguageOf` and `firstLanguageTag`. `BundleService.validateConfiguration` requires its availability filter.

- 0a816a0: Display mode `none` now withholds every amount on the server (issue #491). Until now it hid prices
  in the storefront only: the API still sent the price, the base, the sale, the list price and every
  tier — a buyer's own included — so a shop configured to show prices only after sign-in
  (`pricing.unauthenticated_display_mode = none`) disclosed them to anyone reading the network tab.

  - **`@endora-commerce/mod-price-lists`.** Where the viewer's display mode resolves to `none`,
    `resolveListingPriceDetails` answers `price: { source: 'none' }`, `basePrice` and `salePrice`
    `null`, no `listPrice` and every `tiers` entry `null`; `resolveListingPrices` answers the `none`
    arm; `resolveEngine` names no book, bracket, sale, source or compare-at. `displayMode: 'none'`
    stays, so the storefront still renders "price on request". The catalogue listing, product page,
    home cards, search hits and suggestions, comparisons, product links and
    `GET /api/v1/storefront/products/:id/resolved-price` therefore send no amount. A line
    (`resolveLinePrices`) keeps its amount beside the mode — it is the charging path, which the cart,
    the admin order preview and order intake refuse as quote-only.
  - **Price sort and range.** A product whose own display-mode step (its override, else its
    category's) is `none` is left out of the price surface: a price-sorted listing shows it after the
    priced products, in both directions, and a price range leaves it out. This replaces spec 086's
    clarification 2, under which such a product kept its position in the order. A product or
    category display-mode override now marks the products it concerns for the surface worker, so the
    order follows it at the worker's turnaround, like a price change. `PriceListService` gains
    `anyProductStepWithholds()`; `BookPricingDeps` gains the optional `anyProductStepWithholds`.
  - **`@endora-commerce/contracts`.** New `displayModeWithholdsAmounts(mode)`, the one statement of
    the rule for a consumer that publishes a line amount. The documentation of
    `productResolvedPriceSchema`, `resolvedPriceEngineSchema`, `ListingPrice`, `ListingPriceDetail`
    and `LinePriceResult` says what each carries under `none`; no shape changes.
  - **`@endora-commerce/mod-catalog`.** The external catalogue API (`/api/v1/external/catalog/*`)
    withholds a bound key's price, tier ladder and bulk price for a product whose display mode is
    `none` for the bound Organization: `price: null` with `priceUnavailable: true`, no `priceTiers`
    rung, and `reason: 'price_unavailable'` in a bulk answer.

  **Behaviour change for API consumers.** A client that read amounts under `displayMode: 'none'` —
  none should have — now reads `null`. Product feeds are unchanged: a feed publishes deliberately.

### Patch Changes

- 9b3e7f0: The megamenu becomes the storefront's navigation bar (`specs/168-megamenu-navigation-bar/`, issue #522).

  **Breaking** (owner ruling: no backward compatibility for stored menus or the megamenu wire contract):

  - A top-level item is a **tab** and must carry a `presentation` — `link`, `dropdown`, `mega` or `catalog` — and may carry an `alignment` (`start`, `end`); no other item may carry either. `PUT /api/v1/admin/megamenu/menus/:id/items` refuses a tab without one, a tab of kind `asset`, `cms-block-embed` or `category-tree` (`400 MEGAMENU_KIND_NOT_ALLOWED_AS_TAB`), a `link` tab with children or of kind `group` (`400 MEGAMENU_LINK_TAB_INVALID`), and an `external-link`, `button` or `group` with no label (`400 MEGAMENU_LABEL_REQUIRED`).
  - `ResolvedMenuItem.id` and `parentId` are strings, not uuids: a category a `category-tree` expands to has the id `<tree item id>:<category id>`. Tabs carry `presentation` and `alignment`. A `category-tree` never appears in a resolved tree.
  - The migration `20261029T162855_megamenu_navigation_bar` adds `presentation`, `alignment` and `audience` to `megamenu_items` and makes every stored top-level item a start-aligned `mega` tab; nothing else is converted. The Redis prefix moves to `megamenu:v2:`.
  - The storefront header renders the menu's tabs and nothing else: the hard-coded _Wszystkie kategorie_ trigger and Quick Order button are gone, and so is the mobile drawer's Quick Order promo. A deployment that wants them configures them as tabs; the demo menu does.

  Added:

  - `@endora-commerce/contracts`: item kinds `group` (a heading; a column of a `mega` panel) and `category-tree` (`{ rootCategoryId, depth: 1–3 }`); `megamenuPresentationSchema`, `megamenuAlignmentSchema`, `megamenuAudienceSchema`, `MEGAMENU_TAB_KINDS`, `MEGAMENU_LABEL_INHERITING_KINDS`; `CmsPageReadPort.findStorefrontLinks`; `effectiveCustomerGroupId`, moved from `@endora-commerce/mod-price-lists`, which re-exports it.
  - `@endora-commerce/mod-megamenu`: a `category-tree` expands to the catalogue's live categories on every resolution, from one catalogue read; an empty label on a category link, page link or tree inherits the target's name; a page link follows the page's name, slug and parent path per language. Every item has an audience — everyone, guests, signed-in customers, or customers whose effective customer group is one of the chosen ones — and the storefront API answers each visitor only their items, with `Cache-Control: private, no-store` for an identified caller. Every write runs as a Command with one audit entry (`megamenu.*`), and the module joins the Command Bus coverage check. New dependencies on `customer_accounts` and `organizations`, both non-deactivatable. The editor shows a tab's presentation and alignment, offers the kinds a level allows, sets audiences with customer groups, configures category trees, and marks hidden items in the tree.
  - `@endora-commerce/mod-megamenu`: a tab with a link of its own and a panel can follow its link on click (`clickNavigates`, migration `20261029T190956_megamenu_tab_click_navigates`); the storefront renders it as its link plus a separate toggle for the panel. The `catalog` presentation is named _Panel with side list_ in the editor, and its _All in …_ link appears only for a category.
  - `@endora-commerce/mod-cms`: `findStorefrontLinks(ids, { salesChannelId, language, channelDefaultLanguage })` on the page read port — a page's localised name and its URL in the channel's tree for that language.
  - `@endora-commerce/mod-settings`: the cache flush names `megamenu:v2:*`.
  - `@endora-commerce/mod-catalog`: the demo categories carry Polish names.
  - `@endora-commerce/demo-composition`: the demo menu is a _Wszystkie kategorie_ catalogue tab over the demo category tree, and a Quick Order button at the end of the bar.

- f261ed3: The sales channel's `isPublic` flag is retired in favour of the pricing display-mode chain
  (issue #492; closes #467). The flag was documented as anonymous-price visibility, but every read of
  it withheld prices from **everyone** on the channel, signed-in buyers included, beside a chain that
  already says "prices after sign-in" per channel: `pricing.unauthenticated_display_mode = none`.

  **Behaviour change.** Signed-in buyers on a channel that had `isPublic = false` now see prices
  according to the display-mode chain (their organization's override, else the channel's
  `pricing.default_display_mode`), where they used to see none — on the catalogue listing, the product
  page, product links, search, comparisons, and the price sort and range, which are no longer refused
  to them. Anonymous visitors on such a channel still see no prices: the migration below carries that
  half of the flag over. A channel that had `isPublic = false` **and** its own value for
  `pricing.unauthenticated_display_mode` keeps that value, so its anonymous visitors now see prices if
  that value is a priced mode. A new channel, the boot-time default channel included, no longer starts
  with prices hidden from everyone; it follows the chain like any other.

  The display-mode chain itself is unchanged (owner ruling of 2026-10-28): a product or category
  override takes precedence over the channel's `pricing.unauthenticated_display_mode`, also for
  anonymous visitors, so a product overridden to `gross_only` shows its price to guests on a channel
  whose guest mode is `none`. An organization override still applies to signed-in buyers only.

  - **`@endora-commerce/platform`.** New migration `Migration20261028T173317CoreSalesChannelsRetireIsPublic`
    (core): every channel with `is_public = false` and no value of its own for
    `pricing.unauthenticated_display_mode` gets `"none"` as its per-channel value, then
    `sales_channels.is_public` is dropped. It refuses — rather than migrating into showing prices — a
    database that has a non-public channel but no registered `pricing.unauthenticated_display_mode`
    setting; start the platform once on the previous release, so the settings reconciler registers
    it, and migrate again. Because the column is dropped, stop processes running the previous release
    before migrating. `SalesChannel.isPublic` and `CachedChannel.isPublic` are removed;
    `SALES_CHANNELS_CACHE_KEY_PREFIX` moves from `sales-channels:v3:` to `sales-channels:v4:`, so no
    process reads an entry cached in the other shape. The default-channel reconciler no longer sets
    the flag.
  - **`@endora-commerce/contracts`.** `ResolvedSearchChannel.isPublic` is removed — drop it from the
    context you hand `SearchQueryPort`. No public HTTP shape carried the flag, so no response changes
    shape. The `SALES_CHANNEL_AUDIT_ACTIONS` documentation now says who writes each row: the identity
    Commands (with `stateBefore` / `stateAfter` snapshots) since #484.
  - **`@endora-commerce/mod-catalog`.** `CatalogResolvedChannel.isPublic` and the `isPublic` field of
    `ProductLinkService`'s storefront context are removed. The catalogue no longer skips pricing on
    a channel: prices follow the viewer's display mode (a viewer whose mode is `none` gets the
    withheld answer, `resolvedPrice.displayMode: 'none'`, where the channel used to answer
    `resolvedPrice: null`). The price controls are refused only where the page's display mode is
    `none`; the reason "This sales channel does not publish prices…" is gone.
  - **`@endora-commerce/mod-search`.** The service's `ResolvedSearchChannel.isPublic` is removed, and
    hits are always resolved for the viewer.
  - **`@endora-commerce/mod-comparisons`.** A comparison is priced for the viewer on every channel.
  - **`@endora-commerce/mod-sales-channels`.** The channel form's _Open to anonymous visitors_ hint
    gains a second line pointing to the guest display mode, with a link to _Pricing settings_
    (`identity.anonymousAccess.pricesHint`, `identity.anonymousAccess.pricesLink`, English and
    Polish). New channels are no longer written with the flag.
  - **`@endora-commerce/mod-price-lists`, `@endora-commerce/mod-i18n`.** _Pricing settings_ states,
    under the two default modes, that a channel's own value wins over them and that a product or
    category override takes precedence over both, for anonymous visitors too
    (`priceLists.displayModes.settings.precedenceHint`).
  - **`@endora-commerce/demo-composition`.** The `pl_b2b_vip` channel is created without the flag and
    a new step, _the VIP channel hides prices until sign-in_, sets its
    `pricing.unauthenticated_display_mode` to `none`; its signed-in buyers see prices. `pl_retail`
    publishes prices to everyone, as before.
  - **`@endora-commerce/mod-settings`, `@endora-commerce/cli`.** Comments only: the cache-clear
    namespace names the new key prefix, and the channel-resolution rule no longer cites the flag.

- c99b4cd: The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- 70092cf: The price book grid's per-rule cell reasons moved from the `errors.reason.*` bundle keys to `grid.reason.*`, because `errors.*` is reserved for the error envelope's sentences. A deployment that overrides those strings in its own bundle renames the keys.
- Updated dependencies [42b1038]
- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0

## 0.108.0

### Minor Changes

- 789f917: A product feed pinned to a price book publishes the book's prices only while the book applies to an anonymous buyer on the feed's channel (feature 160, FR-029, owner ruling 2026-10-23).

  - **`@endora-commerce/contracts`.** New `pinnedPriceBookUnpublishableReasonSchema` (`not_found`, `currency_mismatch`, `not_active`, `outside_schedule`, `not_on_channel`, `audience_restricted`) and the `PinnedPriceBookPublishability` type. `productFeedSchema` gains `pinnedPriceBookWarning` (the reason, or `null`).
  - **`@endora-commerce/mod-price-lists`.** `pricingService.namedListPrices` answers nothing unless the book is `active` or `scheduled` inside its schedule window, bound to the feed's channel with the channel offering its currency (a base book is channel-independent) and for everyone; before, it ignored status, dates, channel and audience. New `pricingService.namedListPublishability({ priceListId, currencyCode, salesChannelId })` says whether, and why not. The catalogue price a pinned book's percentage and amount rows are taken off is now the channel's catalogue price **without** that book (an everyone book was taken off its own result).
  - **`@endora-commerce/mod-product-feeds`.** `FeedPricingPort` requires `namedListPublishability`; the admin feed list and detail rows carry `pinnedPriceBookWarning`, and the feed page shows it as a warning (English and Polish). What a run of such a feed does is `160-pinned-feed-withdrawal.md`'s.

- 14bcf1d: Pricing model v2 (feature 160, D-287 P1): price books replace the Application-rule price lists, in one release with no compatibility phase.

  - **Model.** A price book fixes one currency, a set of sales channels (each offering it), an audience set of one kind (everyone, customer groups or organizations), a type (regular or sale), a schedule read at resolution time and a priority. Its rows select a variant, a product, a category ∩ attribute, a category, an attribute or everything, in quantity tiers, at a fixed price, a signed percentage or an amount adjustment. Base prices — product and variant rows — live in one system base book per currency.
  - **Resolution.** Three tiers: the catalogue price (base, overridden by the channel's everyone books), the buyer price (organization and customer-group rows ranked by the versioned precedence, HY by default; percentages off the catalogue price), and a sale charged only when lower, the buyer price shown as compare-at. Every consumer reads it through the batched entry points; price sort and range read a materialised price surface rebuilt by the `price_lists.surface` worker (a request never builds; the order may lag a change by the worker's turnaround, a price never).
  - **Removed routes and their replacements.** `/api/v1/admin/price-lists-engine/…` (lists, brackets, rosters, matrix entries, activation, sweep) → `/api/v1/admin/price-books/…` (`GET`/`POST /price-books`, `GET`/`PATCH`/`DELETE /price-books/:id`, `POST /price-books/:id/activate|draftify|duplicate`, `GET`/`PUT /price-books/:id/rows`, `PUT /price-books/base-prices/:productId`). `/api/v1/admin/pricing/rule-targets/…` → `/api/v1/admin/price-books/targets/…`. `GET /api/v1/admin/products/:id/resolved-price` → `POST /api/v1/admin/price-books/resolve` (with the explanation). `GET /api/v1/admin/products/:id/price-lists` → `GET /api/v1/admin/price-books?productId=`. The display-mode routes are unchanged.
  - **Removed in-process surface.** `priceListAdminPort` — replaced by `priceBookWritePort` (`basePrices`, `replaceProductBaseTiers`, `replaceBasePrices`, `booksPricingProduct`; the method mapping is in the `@endora-commerce/contracts` note), whose writes are the admin base-price command (`PUT /price-books/base-prices/:productId`): one audited command, the base books' version moved, the caches told after the commit, a missing currency's base book created as the admin write does; `DefaultPriceListMigrator` and `DEFAULT_PRICE_LIST_ID` on `./backend` (the demo's prices are `seedDemoPriceBooks` / `withdrawDemoPriceBooks`; base books are created by the migrations). The `PriceListProduct` and `PriceListPriceBracket` entities are gone.
  - **Changed constructors.** `PricingService(emFactory, resolveOrgChain?, targetReads?, customerAccountRead?, { channelBridge, bookCache?, profileMemo?, requestSurfaceRebuild?, showListPrice? })` — the legacy `cache` parameter and the `model: 'legacy' | 'books'` option are removed, and a composition must pass the `price-list` channel bridge. `PriceListService(emFactory, pricingCache?, targetReads?)` holds the display-mode chain only — `create`, `patch`, `activate`, brackets, rosters and matrix entries are gone.
  - **Migrations.** `20261021T165239_price_lists_price_books_expand` (books, audience and channel sets, evolved rows, precedence v1 = HY, the price surface), `…_price_books_version`, `…_price_surface_generations`, and `20261022T111815_price_lists_price_books_conversion`: every Default-list bracket becomes a row of its currency's base book (a base row already written wins); every non-system list of the old model is deleted with its roster, brackets, rule and matrix entries (one a product feed is pinned to is retired instead: an empty, expired, channel-less book for everyone, renamed "… (removed by the 0.108.0 upgrade)"); `price_list_products`, `price_list_price_brackets`, `price_list_items`, `price_list_assignments`, `price_lists.application_rule|code|is_default|modified_at` and the matrix entries' `organization_id|currency_code|discount_percent` are dropped; type `base` becomes `regular`. Its `down` gives the old storage back empty.
  - **Admin.** The price-list roster, the list detail with its rule builder, bracket grid and matrix, and the product editor's _Linked price lists_ zone are deleted with the API they edited; the price-book editor ships in the same release (P2). The sidebar entry _Price books_ and the palette action open the book list (`/price-lists`).
  - **Demo.** The demo seeds base prices for every demo product and the books of the owner's scenarios E1–E3 (E3's active, E1's and E2's drafts); `demo reset` withdraws them and `demo seed` brings them back.

- 715ddcf: The price surface is refreshed per trigger instead of rebuilt whole (feature 160, `contracts/price-surface.md` §4, owner ruling 2026-10-23).

  - **Marks.** A pricing write marks, after its commit, only what it moved: a (profile, product) mark in the new table `price_profile_stale_products` (migration `20261023T152351_price_lists_price_surface_targeted_marks`, which also adds `price_profiles.revision`), or the whole profile `stale` when every product of it is concerned. A book change marks the products its rows select in the profiles containing the book; a row batch the products of its rows; a base price the product in every profile of its currency; a `product.*` event the product, a `category.updated.v1` the products of the subtree and an `attribute.updated.v1` the products its rows select; a sales-channel event every profile of the channel. A buyer profile is marked for a product only when one of its books can select it or its surface holds a row for it. Display-mode writes and a name-only book patch mark nothing; a deleted book's buyer profiles are dropped.
  - **Worker.** A pass reads its work in one statement, builds never-built and stale profiles whole and re-resolves only the marked products of the others, replacing their rows of the served generation in one transaction; everyone profiles go before buyer profiles, and a pass clears only the marks it read. A buyer profile's whole build resolves only the products its own books can select.
  - **API.** `PricingGeneration.bump(change?)` and `invalidateAll(change?)` take a `SurfaceChange` (`services/surface-change.ts`); without one every profile is marked stale, as before. `PriceSurface.markChanged(change)` is new; `markStale()` keeps marking every profile. The pricing cache is still cleared whole on every bump.

- 20d563e: `PriceListService.resolveDisplayModes` is removed: nothing called it since the price-book engine split the display-mode chain. Call `resolveProductDisplayModes({ productIds })` for the product and category steps, and `resolvePageDisplayMode({ organizationId, salesChannelId, customerKind })` once for every product the first left undecided — the two halves the engine composes.
- c781cd6: The product editor's base-price panel (feature 161, US3; FR-019–FR-021) in `product.editor.pricing.after`, replacing the Phase 3 shell.

  - One line per currency a sales channel offers: the price from 1 and further tiers (each starting above the one before; windows chained on save), and per variant _inherits_ / own price / signed percentage / signed amount, with a labelled preview rounded by the contracts' decimal helpers; a notice when the product has no base price and cannot be ordered, and per currency without one.
  - Its own _Save prices_: one `PUT /api/v1/admin/price-books/base-prices/:productId` of the changed currencies, with progress, no double submit and a live announcement; refused values marked on their fields; the unsaved-changes prompt on leaving the page and the product editor's other tabs. Read-only when `writable` is false.
  - Below it, read-only, the books that price the product directly (`GET …/price-books?productId=`), with audience and price, linked to the book and to _Why this price?_.

- a9c72e8: CSV export and import of a price book (feature 161, US9; FR-018, FR-038–FR-042), under _CSV file_ in the book's price grid.

  - **Export to CSV** (every reader): the book's rows for the grid's current filter, read 1 000 at a time, in the fixed price-book format — UTF-8 with a BOM, `;`, the header and kinds in the admin language, a decimal comma for a Polish administrator. The file is named `<book>-<date>-<en|pl>.csv`; more than 5 000 rows become numbered files of at most 5 000 rows each.
  - **Import from CSV…** (only on a book the caller may change, and only while the grid holds no unsaved edits): a file of at most 5 MB and 5 000 rows. Either `;` or `,` works, as do a decimal comma or point, UTF-8 with or without a BOM, and Windows-1250, chosen by the administrator when the bytes are not UTF-8. Headers and kinds are read in English or Polish. Merge or replace. Local refusals and the server's `dryRun` refusals are listed with file line, column and reason, and the refused rows can be downloaded with a `reason` column. The preview lists changed (old → new), added and, in replace mode, removed rows. Nothing is written until _Import_, which is offered only for a preview with changes and no refused row; it sends the same batch once against the preview's version, and a book saved since is refused with a new preview offered.
  - New pure codec `src/admin/lib/price-book-csv.ts`; `readDecimalText` exported from `src/admin/lib/price-cell.ts`. Strings under `grid.csv.*` and `import.*`, English and Polish.

- fdd86e3: Duplicating a price book and explaining a price (feature 161, US4 and US5; FR-022–FR-024).

  - **Duplicate** on a book's header (`price_lists:write`, not on a base book): a dialog pre-filled with "… (copy)", the source's channels, currency and audience and a multiplier of 1; a chosen channel that does not sell in a changed currency is flagged before anything is sent; percentages are copied unchanged; `POST …/:id/duplicate`, then the draft copy opens. The source is never written.
  - **`/price-lists/explain`** — the price explainer: sales channel, currency, buyer (guest, organization from the scope-filtered targets, or customer with `customers:read`) and lines (product, variant, quantity); per line the price, its source, the cell in words, the book and the row (linked into the grid), the reference price, the precedence version and the runner-ups by name; a sale with the regular price it beat; an unpriced line with a link to set a base price. Pre-filled from `productId`, `variantId`, `organizationId` and `bookId` (the book's channel, currency and only organization).
  - **Entry points:** _Explain a price_ on a book's header, _Why this price?_ in a grid cell's detail and the product's base-price panel, and _Explain a price for this organization_ in the organization detail's zone.
  - The book's price grid opens on `?tab=prices&search=…`, so a link can land on a row's line.

- af57b55: The admin price-book API gains what the editor needs (feature 161, G11, G12, G15, G16, G18).

  - **`writable` (G11)** on `GET /api/v1/admin/price-books/:id`, on every line of `GET /api/v1/admin/price-books` and on `GET …/base-prices?productId=`, and `meta.creatableAudienceKinds` on the list — the server's scope rule, so the browser never re-derives it. `PriceBookService.basePrices(productId, scope?)` takes the caller's scope (default: every book).
  - **`GET …/targets/organizations?ids=a,b` (G12)** labels stored organization members (≤ 1 000 ids), scope-filtered like the search: an out-of-scope or unknown id is absent, never an error. `ids` with `search` is `400`.
  - **`GET /api/v1/admin/price-books/:id/lines` (G15)** — the book paged by whole line (a selection with every row, a product with its variant lines), general to specific and by label; `kind` and `search` filters; `meta.totalLines`. Product lines are ordered and searched by `catalogProductReadPort.pageProductsByAdminName` (see the product-lines note).
  - **Named runner-ups (G16)** — `POST …/resolve` candidates carry `bookName` and `labels`; `BookExplanation.candidates[]` carries `bookName`.
  - **Batch validation scoped to the batch (G18)** — `PUT …/:id/rows` (and its dry run) reads the stored rows of the selections and ids the batch names and the book's row count, not the whole book; replace mode still reads every row. The 5 000-row cap (`PRICE_BOOK_MAX_ROWS`) applies to non-base books only: a base book accepts batches past 5 000 rows (owner ruling, 2026-10-22). The per-batch cap is unchanged. `planBatch` takes `storedRowCount`; `touchedSelections` is new.
  - **Decimal helpers (G17)** — `matrix-decimal.ts` re-exports the eight price-book helpers from `@endora-commerce/contracts` instead of defining them.

- 615a5c9: The price-book editor's admin surfaces (feature 161, Phase 3; FR-029, `specs/161-price-book-editor/research.md` R3).

  - **Routes.** `/price-lists` (the book list, `price_lists:read`, the module's landing again), `/price-lists/new` (`price_lists:write`), `/price-lists/explain` (`price_lists:read`) and `/price-lists/:id` (`price_lists:read`) join `/price-lists/display-modes`, which is no longer the index route. The four new screens are shells with their titles; the next phases fill them.
  - **Navigation.** The _Pricing_ sidebar entry opens `/price-lists` (was `/price-lists/display-modes`) and reads _Price books_ in English (was _Price lists_); Polish is unchanged (_Cenniki_).
  - **Palette.** `open-price-lists` targets `/price-lists` (was `/price-lists/display-modes`), described _Find, create and edit price books_; new `new-price-book` → `/price-lists/new` (`price_lists:write`) and `open-price-explainer` → `/price-lists/explain` (`price_lists:read`).
  - **Zone.** The product editor's `product.editor.pricing.after` gets this module's base-price panel (`price_lists:read`), a shell for now.
  - **Admin library** (`src/admin/lib/`, not exported): the API client over every editor endpoint, parsing each answer with the contracts' schemas; the price-cell parser and formatter (fixed, signed percentage, signed amount, liberal input); the cell and source labels, with `cells.*` and `sources.*` keys in both bundles.

- ef1318e: The price-book grid (feature 161, US2; FR-006–FR-017, FR-036, FR-037) on `/price-lists/:id?tab=prices`; the book page now has _Settings_ and _Prices_ tabs (`?tab=prices` opens the prices).

  - One line per selection, general to specific, one column per quantity tier; each price's kind in words and an icon, a percentage with its reference (_of base_ on a catalogue book, _of catalogue price_ otherwise); an empty cell says what it inherits from the line's lower tier, a variant cell what its product line gives, or that the line does not price the quantity.
  - Pages of 50, 100 or 200 **lines** from `GET …/lines`, with the total and page numbers; search and line kind sent to the server; edits kept across pages.
  - Lines added through the product browser (many at once, none twice among the loaded lines) and through category, attribute-value and category ∩ attribute-value pickers (eligible attributes only); a product line expands to its catalogue variants.
  - Typing and pasting read prices liberally (decimal comma, spaces, currency, Unicode minus); refused text stays in its cell with the reason; bulk changes (set percentage, set adjustment, multiply fixed prices, clear) are one undo step; a cell detail sets a quantity window outside the columns or clears the cell.
  - One batch per save against the opened version, with progress and a live announcement; tier windows are re-chained so a new tier ends the one below; every refused cell is marked; a stale book is reloaded with the edits kept to re-apply or discard; a save past 5 000 rows on a non-base book is refused before it is sent; leaving with unsaved prices asks first.
  - Admin library: `book-edit-state.ts` (cells, windows, the batch, error mapping, rebase), `bulk.ts`, `grid-labels.ts`; the API client gains `productVariants(productId)`.

- 004c513: The price-book editor's first screens (feature 161, US1; FR-001–FR-005).

  - **`/price-lists` — the book list.** Filters by name, type, status, currency, sales channel, audience kind and member, all kept in the URL; columns for type, status, currency, channels, audience, priority and price rows; _applies to no one_ and _applies nowhere_ flags; base books marked _Base prices — PLN_; a delete (confirmed, naming the book and its row count) only on books the caller may change and never on a base book; loading, empty, filtered-empty and error states.
  - **`/price-lists/new` — the create flow.** Five steps (name and type, currency, sales channels, audience, schedule and priority); only channels selling in the currency are offered and the others are named with the reason; only the audience kinds the caller may create; members picked through the scope-filtered targets; the book is created as a draft and opened. A refusal returns to the step that owns the field.
  - **`/price-lists/:id` — the header.** Name, channels (dormant bindings explained), members, schedule and priority edited and saved against the book's version (`409 PRICE_BOOK_STALE` keeps the edits and offers a reload); currency and, once active, audience kind read-only; activate and move to draft, a refused activation naming what is missing with a way to the field; delete; history link to the audit log; read-only for a caller who may not change the book; the not-found page for an unknown or hidden book.
  - The package now declares `react-router-dom` (`^7`, optional peer) for its admin layer.

- c9b9d27: _Pricing settings_ is reachable, and read-only for a reader (feature 161, Checkpoint 10 rulings; Principle XVI, FR-028).

  - New palette action `open-pricing-settings` → `/price-lists/display-modes` (`price_lists:read`), labelled "Pricing settings" / "Ustawienia cenowe". The price-book list's header links the page too.
  - Old: every display-mode control showed for an operator holding only `price_lists:read`, and the server refused the write. This covered the page's default-mode selects, each override's mode select, _Remove_ and _Add override_, and the override row in the organization and category zones. New: these controls render only with `price_lists:write`; a reader sees each value as text. An override's mode select is now labelled "Mode for {name}".

- 4d07648: _Pricing settings_ (feature 161, US6 and US7; FR-025, FR-026). `/price-lists/display-modes` keeps its address and its display-mode sections and gains two:

  - **Storefront prices** — _Show list price beside the buyer's price_ reads and writes `GET`/`PUT /api/v1/admin/price-books/settings/show-list-price` (`{ value }`, audited), off by default. The switch is offered only with `price_lists:write`; a reader sees _On_ or _Off_ with no control. The save is announced in a live region and cannot be sent twice; a refused save keeps the stored value.
  - **Price precedence** (`#precedence`), read-only from `GET …/precedence`: the active preset by name (or _Custom order_), the version, the twelve buyer cells in the order in force with an example each, which of a category line and an attribute value line wins, the nearest-organization-first depth when it is in force, and that changing it arrives later. The grid's _See the price precedence_ link lands on this section, scrolled to and focused.

  New strings under `settings.*` in the module's bundle, English and Polish.

- 74faecb: The price-book lines read meets 150 ms p95 at 50 000 lines (feature 161, G15 redesign, `specs/161-price-book-editor/research.md` R14).

  - **`price_list_product_lines`** (migration `20261022T182527_price_lists_product_lines`, entity `PriceListProductLine`): one row per product line of a book, backfilled from `price_list_matrix_entries` and kept equal to its `distinct price_list_id, product_id` by every write of this module in the same transaction (batch, base prices, duplicate, demo); both foreign keys cascade; a catalogue variant delete that leaves a line without rows is reconciled on `product.updated.v1`. `PriceBookService.reconcileProductLines(productId)` is new. Code that writes `price_list_matrix_entries` past the service must keep the table in step.
  - **`GET /api/v1/admin/price-books/:id/lines`** — same shape; it now reads a visibility-only header, counts product lines from the new table, and pages and searches product lines through `catalogProductReadPort.pageProductsByAdminName` with the book's membership subquery (`priceBookMembership`), in the admin language (`en`, `pl`; others `en`). Attribute and category lines order by `foldAdminName` bytewise rather than `localeCompare`, so accented names sort with their base letter. `PriceBookReads` needs `pageProductsByAdminName` (was `pageProductIdsByName`) on its catalogue port.

- 49d82dd: Which picked products already have a line in a price book, in one request (feature 161, Checkpoint 5 review).

  - **`GET /api/v1/admin/price-books/:id/product-lines?productIds=a,b`** (`price_lists:read`, the book's visibility): answers `{ data: { productIds } }`, the named products with a line in the book (a row of the product or of one of its variants), read from `price_list_product_lines`. At most 200 ids (`PRICE_BOOK_PRODUCT_LINES_MAX_IDS`); none, a non-uuid or more is `400`; an out-of-scope book `404`. `PriceBookReads.productLines(bookId, productIds, scope)` is new.
  - **Contracts:** `priceBookProductLinesQuerySchema`, `priceBookProductLinesResponseSchema` and their types.
  - **The grid** asks it before adding products from the browser: a product already in the book is not added again (its stored price is never overwritten) and is offered to be opened where it is.

- 72f9cec: A refused price-book row names the rule it broke (feature 161, Checkpoint 11 ruling 2; `specs/conventions/module-i18n.md`: the backend returns codes, the consumer translates them).

  - **Contracts:** `priceBookRowErrorSchema` gains an optional `reason`, one of the new `PRICE_BOOK_ROW_ERROR_REASONS` (`priceBookRowErrorReasonSchema`, `PriceBookRowErrorReason`). The values are:
    - `row_invalid`, `selection_combined`, `max_below_min`, `fixed_on_all`, `variant_needs_product`, `base_book_kind`, `base_product_fixed`;
    - `product_unknown`, `variant_unknown`, `variant_other_product`, `category_unknown`;
    - `attribute_not_selectable`, `attribute_value_unknown`, `attribute_value_boolean`;
    - `row_not_in_book`, `rows_overlap`, `book_row_limit`.

    `priceBookRowShapeIssues` returns each issue's `reason`. The change is additive: `code`, `field` and `message` are unchanged.

  - **`PUT /api/v1/admin/price-books/:id/rows`** (and its `?dryRun=true` preview) sets `reason` on every row error. Old: the attribute refusal was one `PRICE_BOOK_ROW_TARGET` whose English message told the cases apart. New: three reasons. An unknown variant id is now `variant_unknown`; a variant of another product is `variant_other_product`.
  - **Admin:** the grid's cell reasons (`errors.reason.*`) and the CSV preview's refusals (`import.reason.*`) translate the rule in English and Polish; the preview no longer quotes the server's English. The display-mode override row's help line and its two errors are in the module's bundle (Checkpoint 11 ruling 3). The import preview notes when refused lines were not compared.

- 4d49029: The pricing cache is invalidated after commit and across processes (D-287 P0).

  - **Invalidate after commit.** Every audited `PriceListService` write (and `patch`) now clears the pricing cache once `CommandBus.run` has returned, i.e. after the transaction committed — it used to clear it inside the command's `run` callback, so a read racing the write could re-cache the pre-write price for the whole 60 s TTL. A write that changed nothing clears nothing. `PricingCache` gains a `generation` counter and `set(key, value, generation?)`: an answer whose resolution began before an invalidation is returned to its caller but not stored.
  - **Cross-replica invalidation.** New `PricingGeneration` (`services/pricing-generation.ts`): a bump clears this process's LRU and publishes on the Redis channel `b2b:price_lists:pricing-generation`; every process subscribes on boot (through the composition's shared `redisSubscriber`) and clears its own LRU. Publishing is best-effort; a lost message degrades to the 60 s TTL, the previous behaviour. The module now resolves `redis` and `redisSubscriber` from the container; `priceListsModule` takes an optional `pricingGenerationPublisher`, and its handle exposes `pricingGeneration`.
  - **The status sweeper invalidates.** `PriceListStatusWorker` takes the cache as a second constructor argument and clears it after a sweep that activated or expired at least one list (an idle tick clears nothing). The test-only `POST /api/v1/admin/price-lists-engine/internal/sweep` route now runs the module's own worker instance; `PricingRoutesDeps` gains `statusWorker`.

- 5bddd11: Batched resolution entry points and one customer-group rule (D-287 P0).

  - **`PricingServiceContract` gains `resolveLinePrices(input: LinePricesInput)`** — many lines, each at its own quantity, in a number of statements that does not grow with the lines (9 lines: 12 statements against 112 for the per-line loop; 45 lines: still 12). It answers exactly what one `resolveLinePrice` per line answers. **An overlay that decorates `resolveLinePrice` must decorate `resolveLinePrices` too** — the cart, the placement price check, quote reference prices and the external catalogue API now price through it.
  - **`PricingServiceContract` gains `resolveListingPriceDetails(input)`** — `resolveListingPrices` plus `basePrice` / `salePrice` / `displayMode` from the same resolution.
  - **The customer's own group on every path.** Every entry point accepts `customerAccountId`; the engine reads the account (once per call) and prices on `customerGroupId ?? account's group ?? organization's group` (`effectiveCustomerGroupId`, `services/customer-group-rule.ts`). An account that does not belong to the named organization is ignored. `PricingService` takes `customer_accounts`' read port as a fifth constructor argument; a resolution that names an account without it refuses. `GET /api/v1/storefront/products/:id/resolved-price` now prices a signed-in customer on their own group — a behaviour change for a customer whose group differs from their organization's.
  - **`BuyerLinePriceService`** prices each chunk of lines with one `resolveLinePrices` call (it was one sequential `resolveLinePrice` per line); its `pricingService` dependency is now `Pick<PricingServiceContract, 'resolveLinePrices'>`.

### Patch Changes

- 337fb65: The upgrade to price books no longer stops on a product feed pinned to an old-model price list.

  - **`@endora-commerce/mod-price-lists`.** The conversion migration deletes the old-model lists one at a time. A list another table still refers to (on 0.107.0, a product feed pinned to it) is **retired** instead of deleted: it keeps its id, loses its rows, audience, channel bindings and dates, becomes `expired` and for everyone, and is renamed "… (removed by the 0.108.0 upgrade)". Before, the conversion failed on the feed's foreign key and the whole upgrade rolled back.
  - **`@endora-commerce/mod-product-feeds`.** New migration `20261023T234605_product_feeds_price_list_fk_dropped` drops `product_feeds_price_list_fk`: a price book a feed is pinned to can now be deleted. The feed then warns `not_found` and its next run withdraws its published file; a new pin is still checked against the price books when it is written. After the upgrade a feed pinned to a retired list warns `not_active`, and its next run withdraws its file until it is pinned to a price book that applies, or unpinned, through the product feeds API (`PATCH …/product-feeds/:id`, `priceListId`).

- 256e488: The `price_lists` manifest describes price books (feature 160): the module description reads _Price books — base, catalogue, buyer and sale prices per currency, sales channel and audience — and price display modes._, and the permissions _View price books and display modes_ (`price_lists:read`) and _Edit price books, base prices and display modes_ (`price_lists:write`), in English and Polish. They named brackets, pricing rules and a rule-based engine the module no longer has.
- e47b84b: The four price-matrix error codes are gone (feature 160): `ERROR_CODES.PRICE_MATRIX_ENTRY_NOT_FOUND`, `PRICE_MATRIX_ENTRY_OVERLAP`, `PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE` and `PRICE_MATRIX_ENTRY_LIMIT` are no longer exported or declared by `price_lists`, and their sentences and the unused `priceMatrix.*` admin strings are removed from both bundles. Nothing has raised them since the matrix entries became price-book rows: a row is refused with `PRICE_BOOK_ROW_SHAPE`, `PRICE_BOOK_ROW_OVERLAP`, `PRICE_BOOK_ROW_TARGET` or `PRICE_BOOK_ROW_LIMIT`.
- b583f89: The price surface's coverage check (whether a buyer surface holds every product of the everyone surface, which lets an all-products buyer's sorted page skip the everyone stream) probes each everyone row by primary key with a scalar `limit 1` sub-select instead of a `not exists`. On a `price_profile_prices` analysed while empty — a fresh install's, before autovacuum catches up — the `not exists` was planned as a nested-loop anti join filtering every buyer row per everyone row, and the first price-sorted page of an all-products buyer took 428 s on a 50 000-product catalogue; the probe takes about 0.2 s whatever the statistics.

  Follow-up in the same release: the probe still took 47 s there, because with no statistics the planner served it from the ordering index (a range scan of the buyer surface per probe). The coverage check now reads each surface's product ids by itself and compares them in memory, and a whole build that writes a large share of `price_profile_prices`, or the first rows of a table with no statistics, analyses the table inside its own transaction, so the statistics are visible together with the rows.

- 8d62ff8: Documentation only (feature 160, FR-048): the module pages describe how prices are determined with price books.

  - `price_lists` ships three pages instead of one: _Price books_ (what a book is, base prices, the four resolution steps, the default precedence, variants, where prices appear, the demo's worked examples, permissions, known limitations and a migration note), _The price-book editor_ (every admin screen) and _Pricing for developers_ (data model, resolver, the batched read path, caching, the price surface, the admin and storefront API, the ports and the conversion from the old model).
  - The pages of `catalog`, `carts`, `orders`, `organizations`, `product_feeds`, `quick_order`, `quote_requests` and `search` describe their prices as resolved from price books, with no product-owned price and no fallback. No code changes.

- e358ccb: Documentation only (feature 160): the module pages follow the targeted refresh of the price surface and the pinned-feed rules of 2026-10-23.

  - `price_lists` — _Pricing for developers_ describes the two kinds of mark (a (profile, product) mark in `price_profile_stale_products`, a whole-profile mark), what each write marks, the worker's pass, `namedListPublishability` and the reference a pinned book's percentages are taken off, and the unpriced shape of `resolved-price`; _Price books_ says how soon a price change shows in a price-sorted listing — within a minute for a targeted change, within five minutes at about 200 profiles for a catalogue-wide one (SC-005, owner ruling 2026-10-24) — and that a list a feed was pinned to is retired, not deleted, by the upgrade. The demo is loaded with `demo seed`, not `demo reset`.
  - `product_feeds` — a pinned price book publishes only while it is active or scheduled within its dates, on the feed's channel and for everyone; the feed page warns otherwise, and a run ends `withdrawn` and withdraws the published file (not a failure: no notification, no delivery; the old file stays downloadable from its run). A feed is pinned through the admin API (issue #414).
  - `catalog` — product, category and attribute events mark on the price surface the products they concern. No code changes.

- 6865b14: Pricing strings (feature 160): the product editor's _Pricing_ tab label is translated (`productEditor.tab.pricing`, _Ceny_ in Polish); `price_lists`' Polish hint names the attribute flag _Reguły cennika_, as the catalogue's attribute screen does; a comment on the cart read's pricing chain no longer describes a product price of its own.
- 9434cbc: `resolvedPriceEngineSchema` describes what `GET /api/v1/storefront/products/:id/resolved-price` answers (feature 160, FR-018).

  - **`@endora-commerce/contracts`.** Amounts are decimal strings (`{ amount: '199.0000', currency: 'PLN' }`), as the route has always sent them — the schema declared numbers. An unpriced product has `baseListId`, `basePrice` and `quantityBracket` all `null` (they were declared non-null); the three are `null` together or set together.
  - **`@endora-commerce/mod-price-lists`.** The route answers `baseListId: null` for an unpriced product instead of an empty string.

- df3b5c2: Every array `price_lists` binds to a statement now goes through one helper that quotes and escapes each element.

  The price surface built the text array of an attribute change by hand and escaped `"` but not `\`, so an attribute key holding a backslash was read as another key (its rows marked nothing), and one ending in a backslash made the literal malformed, so the marking failed and fell back to marking every profile stale — a full rebuild. The uuid, numeric and text arrays of the module (the engine, the surface, its marking, the book reads and writes, the representative scope and the list-read port) are now built by `pgArray`, which double-quotes every element, escapes `\` and `"`, and writes `null` as `NULL`; the three private copies of `uuidArray` and two of the text-array helper are gone.

- f3bab60: The upgrade to price books no longer stops on an old price list coded like a base book.

  The conversion migration `20261022T111815_price_lists_price_books_conversion` inserted each new currency's base book with the code `base-<currency>` before it removed the old lists, so an existing list coded `base-eur` (for example) failed the whole upgrade on `price_lists_code_unique`. The base book's code is now derived from its own new id; the column is dropped later in the same migration, so nothing reads it.

- badca15: A cached price no longer carries another viewer's display mode.

  The price-book engine's cache is keyed by the pricing profile, which a guest and an organization with no buyer book share, while the display mode's organization and settings steps differ between them: whichever asked first decided the net/gross mode the other was shown for up to 60 seconds. The cache now holds only what the profile decides — the price, and the product and category steps of the display-mode chain — and the organization → settings tail is applied per request. The price surface's worker, which resolves a buyer profile with a guest viewer, no longer reads or writes the cache at all.

  `BookPricingDeps.displayModes` is replaced by `productDisplayModes` (the product and category steps) and `viewerDisplayMode` (the tail); the cache's value type is the new `CachedBookLine`. `PriceListService.resolveProductDisplayModes` is new; `resolveDisplayModes` answers as before.

- 7f33967: The price explainer no longer identifies a price book outside a sales representative's scope.

  `POST /api/v1/admin/price-books/resolve` named every candidate book — id, name, row and its labels — including books a representative may not see, such as a parent organization's book met through the organization chain or a book shared with an organization outside their scope (FR-034 requires those to answer as missing books). For such a caller, a winning book outside their scope now answers `bookId`, `bookName` and `rowId` as `null` while the price, `tier`, `cell` and `reference` stay what the buyer is charged, and runner-ups from such books are left out of `candidates`. The explainer screen shows _A price book outside your scope_ in place of the book. A platform administrator sees every book as before. New `PriceBookReads.visibleBookIds(ids, scope)`.

- 2974ffa: A price-book write that commits while a price is being resolved no longer leaves the pre-write price cached for a minute.

  `BookPricing.resolve` read the pricing cache's generation after the channel, the precedence and the pricing profile, so a write that committed and invalidated in between (a book moved to draft, say) was stored under the new generation with the profile read before it, and served until the 60-second TTL ran out. The generation is now read before the first statement, as `PricingCache` requires.

- e3aef9b: Marking the price surface after a write that touches several price books reads the price profiles and each book's channel set once, rather than once per book (and the channel set once per before/after state). The profiles are read again only after a deleted book's profiles have been dropped.
- a71bc5a: Changing a price book's dates now re-decides its status.

  `PATCH /api/v1/admin/price-books/:id` with `startsAt` or `endsAt` on an `active` or `scheduled` book sets its status as activation does: `expired` once its end has passed, `scheduled` before its start, `active` otherwise. An active book moved to a future start used to stay `active`; the status sweep only starts `scheduled` books, so when the book began to price nothing marked the price surface and price sorting never took it in. A draft and an expired book keep their status.

- 86050a0: A sales representative can no longer widen a price book's audience beyond their own organizations.

  - `PATCH /api/v1/admin/price-books/:id` now asks what create and duplicate ask: a representative may give a book only an organization audience, so patching their own draft to everyone or to customer groups answers `403`.
  - An organization book naming no organization named none outside a representative's scope, so it was visible and writable to every representative. It now answers to a representative exactly as a missing book (`404`, absent from lists and counts), and a representative cannot create, duplicate or patch a book to an organization audience naming no one (`400 PRICE_BOOK_AUDIENCE_KIND`). A platform administrator is unaffected.

- c092719: The price-book engine's cached line (`CachedBookLine`, internal to the package) no longer stores the currency: the pricing profile it is keyed by carries the currency, so an answer reads the request's own. No answer changes.
- 26ad8db: The price explanation (`POST /api/v1/admin/price-books/resolve`) cuts the runner-ups to ten **after** leaving out the books outside the caller's scope. The cut used to happen first, in the resolver, so a sales representative lost one visible runner-up for every hidden book ranked above it; the answer is now exactly what it would be had the hidden books not existed. `BookExplanation.candidates` (internal to the package) carries every ranked candidate when the resolver is asked to explain, which only that route does.
- bf6e980: The price-book engine reads the viewer's tail of the display-mode chain (the organization override, then the `pricing.*` display-mode settings) once per pricing generation and viewer rather than on every resolve, so a warm resolve whose lines are all cached issues no display-mode statements. Every write the tail reads now bumps the pricing generation: an organization override (as before), `PriceListService.setSettingsDisplayMode` (it did not), and a settings write of `pricing.default_display_mode` or `pricing.unauthenticated_display_mode` through the settings module, which `price_lists` now hears as `settings.value_changed`. `ViewerModeKey` and the engine option `viewerModeMemo` are new.
- d99d6c1: Only the admin price explainer (`POST /api/v1/admin/price-books/resolve`) lists every ranked runner-up of a line, and it resolves past the answer cache to do so; every other resolution — listings, carts, the price-surface build — keeps at most ten runner-ups, as before review 2, so the shared answer cache no longer holds an unbounded runner-up list per line. The explainer still cuts its list to ten after leaving out the books outside the caller's scope.
- 0ef7316: The catalogue and pricing documentation now state what a price-sorted walk guarantees: every product whose price does not change during the walk is met exactly once, including when the price order goes missing midway; a product repriced meanwhile may be met twice or not at all, as with any cursor over a live price. They no longer claim that nothing is ever repeated or lost, and they say that a page may be short or empty and still have more after it.
- 5f7cbdf: The viewer display-mode memo is cleared once per pricing-generation bump, by the module that owns it; `BookPricing.invalidateAll()` no longer clears it a second time and now drops only the engine's own precedence memo. The generation in `ViewerModeKey` still keeps a tail read during a write from being served after it.
- 8026d81: Base-price writes keep the rows they do not change (feature 161, Checkpoint 6 review). `PUT /api/v1/admin/price-books/base-prices/:productId` (and `PriceBookWritePort.replaceBasePrices` / `replaceProductBaseTiers`) used to delete every row of the currency and insert the new set, so a tier nobody edited was rewritten with a new id; now a row whose variant, window, kind and value are unchanged keeps its id and values, only differing rows are deleted or inserted, and the base book's version moves only when something changed. The admin panel shows a lowest tier above 1 as stored (with a "not orderable below" notice) and a variant's own quantity tiers read-only, sending both back exactly. `price_lists:write` now advises `catalog:read` (`requires`, D-175): the product browser and the variant read need it.
- 301a69f: An admin read of a product's variants (feature 161, Checkpoint 5 review).

  - **`GET /api/v1/admin/catalog/products/:productId/variants`** (`catalog:read`): every variant of the product by SKU, serialized as the variant writes answer them (`id`, `parentProductId`, `sku`, `variantAttributeValues`, `stockLevel`, `createdAt`, `updatedAt`), whatever the product's status, sales channels or audience; an unknown or deleted product is `404`. `CatalogAdminService.listVariants(productId)` is new. The storefront's `GET /api/v1/catalog/products/:id`, which answers an inactive product `410` and an out-of-channel one `404`, is unchanged.
  - **Contracts:** `adminProductVariantSchema`, `adminProductVariantsResponseSchema` and their types.
  - **The price-book grid** expands a product line through this read (the action is absent without `catalog:read`).

- ae25fed: The display-mode page names category and product overrides in the admin language. `GET /api/v1/admin/price-books/targets/categories` and `GET /api/v1/admin/catalog/products` answer `name` as a map keyed by language tag; the page rendered the map itself, which failed for either scope. It now picks the name as the other admin surfaces do (the admin language's tag, then `en-US`, then any, then the slug or SKU), in the table and in the _Add override_ dialog.
- 29626f4: A large paste in the price grid, and a save of many lines, stay fast (feature 161, T099; FR-036).

  - Old: each cell of a pasted or filled group copied every pending edit, and the save read every edit once per line. Both were quadratic: 5 000 cells took about 4 s.
  - New: the grid applies a group in one pass (`editCells` in `src/admin/lib/book-edit-state.ts`), and the save and the cell views group the edits by line once per change. Measured on the development machine, 5 000 cells take about 90 ms.

- ce572ca: A price book's _Duplicate_ is offered only on a book the caller may change (feature 161, US8; FR-027, A3.3). Old: any operator holding `price_lists:write` saw _Duplicate_ on every non-base book, including an everyone or customer-group book a sales representative may only read. New: it needs the book's `writable` as well, like every other edit control on the page.
- 4d919e6: Every editor screen states its loading and its failures (feature 161, T096; FR-032).

  - The create flow's currency step shows a loading state and, when the currencies cannot be loaded, says so with _Try again_. Old: the step was empty, without saying why.
  - On _Pricing settings_, the list-price setting's load failure offers _Try again_ instead of asking for a page reload.

- 8e4f87a: A whole rebuild of the price surface is about three times faster (issue #416), so a catalogue-wide change shows in the price-sorted order sooner.

  - **What is faster.** A catalogue-wide change used to take about 4.5 minutes to show in the price sort. It now takes under 1.5 minutes, measured on 202 built profiles of the 50 000-product SC-005 fixture: 275.64 s → 84.84 s for an all-products row, and 273.47 s → 83.23 s for a sales-channel identity event. A catalogue-wide change is an all-products or attribute-only row on an everyone or base book, a sales-channel identity or lifecycle event, or a change to more than 10 000 products. Targeted changes and the prices on cards are unchanged.
  - **How.** A build reads the catalogue through `catalogProductReadPort.listPricingRefs()`, one statement with no entity hydration, at its own start, so it always prices the catalogue as it is. It resolves the next batch of products while it writes the previous one, and reads a buyer's comparison rows beside the resolution. The surface's resolution skips the display-mode chain, which the surface does not store.
  - **A product deleted during a rebuild costs a retry, not the job.** A build that meets a product deleted after it read the catalogue rolls back and runs again on a fresh read. Only if its products vanish under three attempts in a row does the pass fail, swapping nothing and keeping every mark; no later profile of that pass is built, so no buyer is ever compared with an everyone surface that failed. The queue's own retry then runs the job again. Before this, the first such error failed the pass.
  - **A failed `price_lists.surface` job no longer blocks the queue.** Every request uses one fixed job id, and BullMQ refuses an id it still holds. Failed jobs used to be kept, so a job that failed for good silently swallowed every later request until it was evicted. A failed job is now removed, and the worker logs each failure at `error`.
  - **Unchanged.** Every surface row is still computed by the resolver the cards use. A build still writes the next generation beside the served one and swaps it in in one transaction. A failed build swaps nothing, and a failed write fails it at once. A whole-profile mark that lands while a build no pass asked for is reading the catalogue is no longer cleared by that build.
  - `BookPricing.resolveProfileListing` is new. It is the listing resolution of a fixed profile without the display mode, and `resolveListing` answers as before.

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [291ec86]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [e1b173f]
- Updated dependencies [ef1318e]
- Updated dependencies [f42bbaf]
- Updated dependencies [c781cd6]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [172597c]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [53e88c7]
- Updated dependencies [8e10ba1]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [3a9dc6e]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [4a05f32]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/admin-kit@0.108.0

## 0.107.0

### Minor Changes

- cad6a6e: Add many products to a price list in one request.

  **New route: `POST /api/v1/admin/price-lists-engine/:id/products/bulk-add`**, gated by
  `price_lists:write`.

  - Body: `{ productIds: uuid[] }` with 1 to 200 ids (`bulkAddPriceListProductsRequestSchema` from
    `@endora-commerce/contracts`). Duplicates are collapsed, the first occurrence kept.
  - Answer `200 { data: { added, unchanged, failed } }` (`bulkAddPriceListProductsResponseSchema`).
    An id already on the list is `unchanged` and its brackets are left exactly as they were; an id
    the catalogue does not hold as a live product (unknown or soft-deleted) is
    `failed: [{ productId, reason: 'product_not_found' }]`; every other product is `added`, in
    request order, whatever its status or type. Nothing is ever removed.
  - Refusals write nothing: `403 FORBIDDEN` for the system Default price list (its roster is seeded
    from each product's default price) and for a caller without `price_lists:write`,
    `404 NOT_FOUND` for an unknown or deleted price list, `400 VALIDATION_FAILED` for an invalid
    body (not an object, no ids, more than 200, a non-uuid id). Two requests racing to add the same
    new product: one adds it; the other may answer `409 VERSION_CONFLICT` (or report it
    `unchanged`), and retrying reports the product `unchanged`.
  - One request is one Command, `price_list.products_add`, and writes **one** audit entry whose
    after-state holds counts only — `{ name, added, unchanged, failed }`, never the id list — and
    **no** entry when nothing was added, so a retry of an accepted request is silent.
  - The manifest's `recentActivity` declares `price_list.products_add`, so the dashboard's recent
    activity shows a bulk add as "added products to price list" / "dodał(a) produkty do cennika";
    the module's own bundle gains `activity.verb.price_list.products_add` in English and Polish.

  `PriceListService.addProducts(priceListId, productIds, auditCtx?)` is the service method behind
  it. The single-product `POST …/products` and the replacing `PUT …/products` are unchanged.

  **Admin screen.** On a price list's _Products & brackets_ tab, **Add** now opens the shared product
  browser over the whole catalogue: it opens on _All_, every status and type can be ticked, products
  already on the list are shown as _Already on this price list_ and cannot be ticked, and one confirm
  sends one bulk-add request. A refused or lost request keeps the browser open with the selection, a
  message naming the cause where the answer gives one (the Default list or a missing permission, a
  price list deleted meanwhile, an invalid request, a concurrent change) and a **Retry** that
  re-sends the same products; an accepted one closes it, reloads the roster, opens the first added
  product's bracket editor and names any product that could not be added with the reason. The
  roster now resolves product names for a list of any size (`batch-by-id`, 500 ids per request, at
  most two in flight, shared by every roster change while names are still loading) instead of
  reading the catalogue's newest 20, and the bracket editor opens for every roster product — one
  whose name is unknown shows its id prefix rather than staying on _Loading product…_. **Add** is
  disabled, with a hint, for an operator without `price_lists:write`, and stays disabled on the
  system Default list. The single-product picker drawer is removed.

- 70bb5e5: New `buyerLinePricePort` (container name; type `BuyerLinePricePort` in `@endora-commerce/contracts`): `resolveForBuyer({ buyer, salesChannelId, currencyCode?, lines })` answers, per line, the net unit price a buyer would pay on a normal order on that sales channel now — the account's customer group before the organization's, quantity brackets and active sale prices included. `salesChannelId: null` is the system default channel; a product that does not exist answers `price: null`; an unknown channel throws `400 VALIDATION_FAILED`. Lines are resolved in bounded chunks. The port carries no authority check — the caller passes a buyer it has already authorised — but a `customerAccountId` named together with an `organizationId` it does not belong to throws `400 VALIDATION_FAILED`.

  The admin probe `GET /api/v1/admin/products/:id/resolved-price` is served by the same implementation and accepts a new `salesChannelId` query parameter (absent = system default channel; an unknown or malformed id is `400 VALIDATION_FAILED`, without echoing the id).

- 70bb5e5: **The admin probe `GET /api/v1/admin/products/:id/resolved-price` now checks the buyer before pricing.** An `organizationId` or `customerAccountId` that does not exist — and, for a sales representative, one outside the organizations they may see — answers `404` with one shared body. It used to be answered with the anonymous price. A customer account that is not a member of the named `organizationId` is `400 VALIDATION_FAILED`. A request naming neither is still the anonymous price, and a platform administrator still reaches every organization.
- 76f9757: Price lists gain a **price matrix**: one entry prices a selection of products for an optional organization and a quantity window, at a fixed unit price or a percentage discount.

  - **Selections**: one product (with an organization), a category, an attribute value, a category
    and an attribute value, or every product. Attribute selections accept only attributes flagged
    _Price list rules_ (`isPriceRule`) whose values are a single choice, multiple choices or yes/no
    and that are neither per-language nor per-channel; clearing the flag deactivates the entries
    without a pricing error.
  - **Resolution**: list selection, the Base/Sale partitions and fall-through are unchanged. Inside
    the picked list, the list's own bracket and its entries compete — organization-specific first
    (nearest organization in the inheritance chain first), then product > category ∩ attribute >
    attribute > category > all products, then the higher starting quantity, the lower price and the
    entry id. A percentage is taken off the list's own bracket, else the system Default list's,
    rounded half-up to four decimals; without a reference it is skipped.
  - **Every surface agrees**: `resolveLinePrice`, `resolveListingPrices`, the storefront price sort
    and filter (`orderByUnitPrice`, `pricedProductIds`), the quantity-tier ladder
    (`listBracketMinQuantities`) and the admin resolved-price probe, which now answers
    `resolvedPrice.matrixEntryId`. `namedListPrices` (pinned feeds) still reads brackets only.
    `PricingLineResult` gains an optional `matrixEntryId`; the published `LinePricePort`,
    `LinePriceResult` and `BuyerLinePriceAnswer` are unchanged.
  - **Admin API** behind the existing `price_lists:read` / `price_lists:write`:
    `GET|POST /api/v1/admin/price-lists-engine/:id/matrix`,
    `GET|PATCH|DELETE /api/v1/admin/price-lists-engine/:id/matrix/:entryId` and
    `GET /api/v1/admin/pricing/rule-targets/attributes`. Writes are audited as
    `price_list.matrix_entry_create|update|delete` (declared for Recent activity), tenant-scoped,
    limited to 5 000 entries per list, and refuse overlaps. Duplicating a list copies its matrix.
  - **Admin UI**: a _Price matrix_ tab on the price-list editor (`?tab=matrix`), English and Polish.
  - **Schema**: one migration creates `price_list_matrix_entries`.
  - **Composition**: `PriceListTargetReads` gains a required `catalogAttributeRead`
    (`CatalogAttributeReadPort`); the module resolves it as `catalogAttributeReadPort`. A deployment
    constructing `PriceListService` or `PricingService` by hand must pass it.

- 3d5a203: A product sold on request only is refused by the cart whether or not a price list holds it. `CartService.addItem` read the display mode off the resolved list price, so a product no price list prices — priced from the catalogue attribute — resolved nothing, the `CART_PRODUCT_QUOTE_ONLY` guard was skipped, and `POST /api/v1/cart/items` added the line with `200`. It now answers `400 CART_PRODUCT_QUOTE_ONLY` for it too.

  `@endora-commerce/contracts` publishes `ProductDisplayModePort` — `resolveDisplayMode({ productId, organizationId, salesChannelId, customerKind })` — and `@endora-commerce/mod-price-lists` provides it as `productDisplayModePort`, over the same Product → Category → Organization → Settings chain its storefront display-mode route answers with. `CartService` takes it as a new required constructor argument, after `channelMembership`; the module's own composition wires it.

### Patch Changes

- d76291d: Storefront catalogue reads can be priced in the currency the shopper selected. `GET /api/v1/catalog/products`, `GET /api/v1/catalog/products/:idOrSlug` and `GET /api/v1/catalog/products/:idOrSlug/links` accept `?currency=` (an ISO 4217 code, any case). The listing price, the price ordering, the price-range filter, the link tiles and the Meilisearch-served listing are all resolved in that currency when the request's sales channel lists it in its `currencies`, and in the channel's `defaultCurrency` otherwise. A malformed code answers `400 VALIDATION_FAILED`. Without the parameter, every read asks the pricing engine exactly what it asked before.

  `@endora-commerce/contracts` exports the pieces both modules use: `listingCurrencyQuerySchema` (the parameter), `resolveListingCurrency(requested, channel)` (requested if the channel offers it, else its default) and `listingPriceChannelContext(channel, currency)` (the `salesChannel` and `currencyCode` half of a `ListingPriceViewerContext`, with the default currency left implicit). `SearchQueryContext` gains an optional `currency`.

  `@endora-commerce/mod-price-lists`: a listing priced in a currency other than the channel's default no longer falls back to the Product's own `defaultPrice` / `price` attribute. That attribute has no currency of its own and was entered in the default one, so the fallback would have quoted, for example, 100 PLN as 100 EUR; such a product now has no listing price in that currency (`source: 'none'`). In the default currency nothing changes.

- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [248a9df]
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/platform@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/platform@0.106.0
  - @endora-commerce/admin-kit@0.106.0

## 0.105.0

### Patch Changes

- 3383720: Two refusals of a cart line have an error code of their own instead of `VALIDATION_FAILED`, and a
  sentence in English and Polish. **A client that matches on `VALIDATION_FAILED` for these two cases
  now sees the specific code**; the HTTP status of each is unchanged.

  - `CART_PRODUCT_QUOTE_ONLY` (`400`) — the product's price is withheld from this buyer (the resolved
    price display mode is `none`), so it is quoted rather than added to a cart. It was
    `400 VALIDATION_FAILED` with the identifier `product_quote_only` as its message, which is what
    the buyer read, in every language. `details.productId` names the product. Besides
    `POST /api/v1/cart/items`, every flow that fills a cart line by line can answer it: quick order,
    one-click buy, a shopping list added to the cart, an order created in the admin and an order
    taken in through the API.
  - `CART_QUANTITY_INVALID` (`422`) — the quantity is below the minimum a cart line may hold. It was
    `422 VALIDATION_FAILED` with the English message `Quantity must be > 0.`, held by no bundle.
    `details.minimum` and `details.quantity` carry the values, and both sentences name the minimum.
    No HTTP route reaches it — every request schema in front of the cart already refuses such a
    quantity as a malformed request, which is still `400 VALIDATION_FAILED` — so it is what a module
    calling the cart write port (`CartWritePort.addItem`) in-process is answered.

  `@endora-commerce/contracts` gains the two members of `ERROR_CODES`. The `price_lists` documentation
  page, which names the first refusal, names the new code. No setting or permission changes.

- 34fe84f: A scheduled tick that finds nothing to do no longer writes a `tenant.escape_hatch` audit row. Four
  repeating jobs entered a system scope on every tick, and each entry is one row in
  `audit_log_entries` because ticks are further apart than the audit writer's ten-second aggregation
  window: the order follow-up sweep and the CRM event reminders (every 60 seconds, 1,440 rows a day
  each), the product feed stale-claim reaper and the price list status sweep (every 5 minutes, 288 a
  day each) — on an instance where none of them did anything.

  Each now asks first whether a pass would do anything, with a statement that runs outside any scope
  and returns one boolean and nothing else, and enters the system scope only when the answer is yes.
  A tick with work is recorded exactly as before. A question that fails counts as yes, so a failing
  probe can cost an audit row and never save one. Every probe goes through one helper,
  `anyRowExists` (`services/scheduled-work-probe.ts`, an identical file in each of the four modules),
  which builds the `select exists(…)` itself and returns a boolean, so a probe has no select list to
  widen. In `mod-orders`, `mod-crm` and `mod-product-feeds` the probe and the pass read the same
  statement of each condition, so the question cannot become narrower than the work. The rule is written down in
  `docs/docs/architecture/tenant-scoping.md` § _A scheduled tick with nothing to do enters no scope_.

  Not changed: the rows a process writes while it starts (`boot: …`), and the search reindex timer,
  which reads a setting before it can know whether it has work.

  For code that builds these consumers itself — inside 0.x, and nothing in the published surface of
  `@endora-commerce/platform` moves:

  - `mod-orders`: `TransitionEffectSweepDeps.effects` also needs `hasSweepWork`; new
    `OrderTransitionEffectService.hasSweepWork()` and `runTransitionEffectSweepTick()`.
  - `mod-crm`: `startEventReminders()` also takes `isPresent` and `hasWork`; new
    `EventReminderService.hasSweepWork()` and `runEventReminderJob()`.
  - `mod-product-feeds`: `createFeedReaperWorker(redis, hasWork, processor)` takes the question as its
    second argument; new `FeedRunReaperService.hasClaimedRuns()`, `runFeedReaperJob()` and
    `runFeedRunReaperTick()`.
  - `mod-price-lists`: new `PriceListStatusWorker.hasDueTransitions()` and `statusSweepTick()`.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0

## 0.104.0

### Patch Changes

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- 489a0b6: Documentation: migrations are now named by the file that actually ships. The pages cited
  migrations by a retired numbering (`024_settings_init.ts`, "migration 102", `080_returns_init.ts`
  and others), which matches no file in any package. Each reference now gives the real
  timestamped filename, such as `20260611T140346_catalog_product_value_overrides_init.ts`, and
  says which module owns it where that is a different module. The organizations page also no
  longer claims that the `suspended` → `blocked` migration writes an audit-log entry: it writes
  an explanatory `blocked_reason` on each remapped row.
- 489a0b6: Documentation: the price-list engine migration notes now match the migration. It does not strip
  the legacy `attributeValues.defaultPrice` / `price` keys and writes no report file; the
  structured report comes from `DefaultPriceListMigrator`, the service that performs the same
  backfill on demand.
- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- 54c7417: Documentation comments only: the demo-data notes in these modules now point at `@endora-commerce/demo-composition`, where the cross-module demo wiring they describe lives, instead of a file path in the platform repository's host. No behaviour or export changes.
- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.10.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.10.7

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/platform@0.13.3

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

- 6c8d958: Two tables are created by the packages that own them: `api_keys` and `customer_groups`
  (`specs/120-migration-closure-bridge-ownership/` Phase 3, FR-014 and the owner's ruling of
  2026-09-12).

  Both were created by whichever module needed them first rather than by the one that owns them. That
  is normally harmless — 27 such creations stay where they are, because a consumer who omits the
  creating module gets an empty table and nothing worse — and these two were not, because each also
  produced a reference from outside the referencing module's dependency closure: a fresh database
  could not be migrated by a member set that omitted the creator.

  **They move between two already-applied migration bodies, and that is the whole design.** The
  ordinary repair — take the statement out and re-add it in a new migration — is right for a
  _reference_, which can only move later in the computed order. It is wrong for a _creation_: a new
  migration runs after the entire frozen historical prefix, and both tables are referenced by
  migrations inside it, so the creation would have landed after its own consumers and broken a fresh
  database. Each creation therefore moves into the frozen body that carries the **earliest** reference
  to it, so no position in between is affected.

  **No class is renamed.** `mikro_orm_migrations` persists the class name and holds no checksum
  (measured on `@mikro-orm/migrations@6.6.13`), so neither edited body is re-offered to a database
  that has applied it, and nothing is pending anywhere from this change.

  **`create table if not exists`, and it is load-bearing rather than defensive.** A database that
  applied the _donating_ migration and has not yet reached the _receiving_ one — anything a release or
  more behind — already has the table while the receiving migration is pending. A verbatim creation
  fails there; the guarded one is a no-op. Both spellings were measured against a fully migrated
  database: guarded skips, unguarded raises `relation already exists`.

  **`@endora-commerce/mod-api-keys`** — `Migration20260724T173916ApiKeysDistributorBinding` now creates
  `api_keys` and its `key_hash` index, above its own `alter table`, and drops the table in `down()`.
  Its position already preceded both frozen references — its own `alter`, and `orders`' foreign key.

  **`@endora-commerce/mod-webhooks`** — `Migration20260425T091359WebhooksUs7Init` no longer creates
  `api_keys`. The two modules were one surface until the US7 split and the creation stayed behind;
  this package names `api_keys` in no statement of its own. A consumer installing `mod-webhooks`
  without `mod-api-keys` no longer receives the table, which is the point: it is not this package's.

  **`@endora-commerce/mod-customer-accounts`** — `Migration20260611T140403CustomerAccountsLifecycle`
  now creates `customer_groups`, above the foreign key it already had to it, and drops the table in
  `down()`. This package's `CustomerGroup` entity has always owned the table.

  **`@endora-commerce/mod-price-lists`** — `Migration20260426T075235PriceListsPricingInit` no longer
  creates `customer_groups`. Tiered pricing needed customer groups first and created them where it
  needed them; nothing in this package references the table — `price_list_assignments.customer_group_id`
  is a nullable column with an index and no foreign key.

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

- b13810a: Both manifests declare `demo: false`.

  It records a decision rather than adding a capability: neither module has demo data of its own.
  The demo shop's megamenu mirrors another module's demo category tree and binds to the demo sales
  channels, and the demo's prices are a backfill over another module's demo products into this
  module's default list. Each is more than one module's rows in one step, so each belongs to the
  instance's own demo composition and to no module.

  **If you read `manifest.demo`**, these two now answer `false` where they answered `undefined`.
  The two are deliberately different states: `false` is a decision that the module owes nothing,
  `undefined` is a module nobody has looked at yet.

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

- 43e1968: `price_lists`, `quick_order`, `inventory` and `pim_ergonode` ship their admin screens, and
  four icon names join the allowlist.

  **Four packages' `./admin` subpath gains `routes` and `nav`.** All four already exported
  `contributions` from `@endora-commerce/mod-<id>/admin` with a `zones` array and nothing else;
  each now declares its screens there too, at the paths and codes the hand-written host
  registrations carried. Sixteen routes and nine sidebar entries between them. The exported
  symbol is unchanged — `contributions`, an `AdminContributions` object, and nothing else — so a
  consumer already reading the zones needs no edit; what is new is that the same object now
  answers for the screens.
  - `@endora-commerce/mod-price-lists` — `/price-lists` (the landing route),
    `/price-lists/display-modes` and `/price-lists/:id`, all on `price_lists:read`, which is the
    code the module's single `readGate` enforces on every `GET` behind them; each screen keeps
    gating its own saves on `price_lists:write` inside itself. One sidebar row, in the `pricing`
    section at weight 100. The display-mode screen is reached from a button on the roster and the
    detail screen from the roster itself, so neither has a row of its own.
  - `@endora-commerce/mod-quick-order` — `/orders/quick-order` on `orders:write`, the code both
    `POST`s behind the screen enforce; there is no `quick_order:*` permission in the platform at
    all. **No sidebar row**, which is the host table's own decision kept: quick order is the
    other way of getting lines into one order, reached from the `order.entry.tabs` strip this
    package already contributes into.
  - `@endora-commerce/mod-inventory` — seven routes: `/inventory` (the landing route),
    `/inventory/low-stock`, `/inventory/notifications`, `/warehouses`, `/warehouses/new` and
    `/warehouses/:id` on `inventory:read`, and `/inventory/import` on `inventory:write`, the
    code its `POST` enforces. Five sidebar rows in the `inventory` section at weights 100 to 500,
    the order the host table had. Both of this module's admin surface directories moved: the
    warehouse screens and their client are here too, the sidebar having always attributed
    `/warehouses` to this module.
  - `@endora-commerce/mod-pim-ergonode` — `/pim-ergonode` (the landing route),
    `/pim-ergonode/attribute-mappings`, `/pim-ergonode/category-mappings`, `/pim-ergonode/runs`
    and `/pim-ergonode/runs/:runId`, all on `pim_ergonode:read`. One sidebar row, `catalog`,
    weight 250 — between `@endora-commerce/mod-assets-library`'s 200 and
    `@endora-commerce/mod-pim-pimcore`'s 300, which is the placement both of those packages'
    declarations already describe. Its admin client moved with the screens and is now
    `src/admin/api/ergonode-client.ts` beside the protections client P4b split out.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains four `KnownIconNameSchema` members** — `Warehouse`,
  `TrendingDown`, `Bell` and `PackageOpen`. Additive: no existing member changes, and
  `KnownIconName` widens rather than narrowing, so no consumer that names an icon today stops
  compiling. They are the four glyphs `inventory`'s sidebar rows carried, which the host imported
  from `lucide-react` by hand; a contribution names its icon rather than importing it, so without
  them four rows would have had to degrade to names already on the allowlist.

  **`@endora-commerce/admin-kit` maps the same four names** in `resolveIcon`. A caller passing one
  of them now gets the matching `lucide-react` component instead of the `Sparkles` fallback.

  **`@endora-commerce/mod-price-lists` declares its first palette action**, `open-price-lists`,
  targeting `/price-lists` on `price_lists:read`. It replaces a hand-written row in the admin
  shell and carries that row's destination, code and keywords, so an operator's ⌘K answer is
  unchanged; what changes is that the advertisement is now resolved from the manifest against the
  effective enabled-set. `@endora-commerce/mod-inventory` declares no new action: its
  hand-written row was a second copy of `open-inventory` and is simply gone.

  **`@endora-commerce/mod-i18n` loses thirteen keys** — the eight `appShell.nav.*` labels the
  four modules' sidebar rows rendered, two `appShell.palette.sub.*` subtitles, and
  `appShell.crumb.importRun` — in both shipped languages. Each moved into the owning module's own
  bundle under a module-relative key (`nav.priceLists.label`, `nav.stockOverview.label`,
  `nav.warehouses.label`, `nav.lowStock.label`, `nav.notifyWhenAvailable.label`,
  `nav.importStock.label`, `nav.pimErgonode.label`), or was retired with the hand-written
  breadcrumb rule that was its only reader. A consumer resolving one of those keys out of the
  shared bundle gets nothing; resolve it in the owning module's namespace instead.

- eeb6a47: Four zone members for the category editor, the product editor and the sales-channel editor.

  `@endora-commerce/contracts` adds four members to `AdminZoneNameSchema`, each with its
  entry in `AdminZonePropsMap`:

  | Member                         | Props                                       | Rendered by                                           |
  | ------------------------------ | ------------------------------------------- | ----------------------------------------------------- |
  | `category.editor.after`        | `CategoryEditorZoneProps { categoryId }`    | the category editor's form, after its save/cancel row |
  | `product.editor.pricing.after` | `ProductEditorZoneProps` (reused)           | the end of the product editor's Pricing tab           |
  | `product.editor.channels`      | `ProductEditorZoneProps` (reused)           | the body of the product editor's Channels tab         |
  | `sales_channel.editor.after`   | `SalesChannelEditorZoneProps { channelId }` | below the sales-channel editor's identity form        |

  `CategoryEditorZoneProps` and `SalesChannelEditorZoneProps` are new exported interfaces.
  `ProductEditorZoneProps` is reused for the two product members rather than aliased: a props
  type is the shape the mount carries, and two places in one editor that both carry a product
  id carry the same shape.

  ```tsx
  import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';

  // A tab whose body is a zone shows its button by counting the zone, never by
  // naming the module that fills it.
  const contributions = useAdminZone('product.editor.channels', { productId });
  // …
  <AdminZone name="product.editor.channels" props={{ productId }} />;
  ```

  `@endora-commerce/mod-price-lists` gains an `./admin` subpath declaring two zone
  contributions — `category.editor.after` and `product.editor.pricing.after`, both at
  `price_lists:read` — and takes `DisplayModeOverrideRow` and `LinkedPriceListsPanel` with it.

  **`DisplayModeOverrideRow` loses its `label` and `inheritHint` props**, and that is a copy
  change an operator will see. A host cannot hand its own wording to a contributor it does not
  know, so the control renders `priceLists.displayMode.rowLabel` in every place it appears.
  Two screens read different words than before: the category editor, which passed `catalog`'s
  `categories.priceDisplayMode.label` / `.help` (both keys are removed from `catalog`'s
  bundle — hence its `patch`), and the product editor's Pricing tab, which passed this
  module's own `priceLists.linked.displayModeLabel` / `.displayModeHint`. Those two `core`
  keys are now read by nothing; they are left in place because the same props are still passed
  by `organizations`' detail screen, whose conversion is a separate merge request.

  `@endora-commerce/mod-sales-channels` gains an `./admin` subpath declaring one contribution,
  `product.editor.channels` at `sales_channels:read`, and takes `EntityChannelMembership` with
  it. Its four calls are rebuilt from the published `apiClient` rather than moving
  `sales-channels-client`, so the package reaches nothing in the admin application.

  `@endora-commerce/mod-inventory` gains an `./admin` subpath declaring one contribution,
  `sales_channel.editor.after` at `inventory:read`, and takes the panel formerly at
  `admin/src/modules/warehouses/ChannelMembershipPanel.tsx`. Its own
  `isVisible({ module: 'inventory', requiredPermission: 'inventory:read' })` gate is gone —
  the zone renderer applies presence and that code before the chunk is fetched — while the
  `inventory:write` half stays, because a contribution declares one code and the panel offers
  a read view and write actions behind two.

  No contribution declares a `match`: each names a member exactly one host mounts, and `match`
  narrows the mounts of one place.

- efa4111: Six more modules become workspace packages (feature 080, T040b batch five):
  `admin_actions`, `admin_roles`, `admin_users`, `megamenu`, `organizations` and
  `price_lists`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the fifty-three packages before them.

  **`@endora-commerce/mod-organizations` publishes a `./ports` subpath.** It is
  type-only: `tsc` emits `export {};`, and it is where a consumer names
  `PersonalOrganizationProvisionApi` and `PersonalOrganizationProvisionInput`
  instead of reaching into the owner's directory.

  ```ts
  import type { PersonalOrganizationProvisionApi } from '@endora-commerce/mod-organizations/ports';
  ```

  The implementation stays behind the container name
  `personalOrganizationProvisionPort`, resolved with `lazyPort`, so the gate that
  answers 503 `MODULE_DISABLED` when `organizations` is switched off is still the
  registration and not a call anyone has to remember to write.

  **Three packages publish a runtime binding by name, beside the `entities`
  array.** D-168 keeps entity classes off `./backend`; these are not entities, and
  each is exported because a host program must hold the _same_ copy the platform
  composed rather than a second one evaluated from source (D-160.6.1):
  - `@endora-commerce/mod-admin-roles/backend` — `PermissionCatalogueService`,
    `listAssignablePermissionCodes`, and the inventory scanner
    (`ConstantResolver`, `defaultScanRoots`, `scanEnforcedPermissionCodes`,
    `scanEnforcedPermissionGates`). The acceptance instance probe and
    `check:action-route-permissions` read them.
  - `@endora-commerce/mod-price-lists/backend` — `DefaultPriceListMigrator`,
    `DEFAULT_PRICE_LIST_ID` and `PriceListService`. The development catalog seed
    runs the migrator; a second copy would `em.create` a `PriceList` class the ORM
    never registered, which fails at the first insert rather than at load.

  **Nothing about a module's behaviour changed.** No manifest `dependencies` array
  moved, so the migration order is the same function of the same inputs: the
  committed registry's `(moduleId, className)` declaration sequence and its
  computed execution sequence are byte-identical to the merge base over all 164
  entries.

- 184fa9f: Two detail-screen zone members, four contributors, and the end of two live component
  duplications.

  `@endora-commerce/contracts` adds two members to `AdminZoneNameSchema`, each with its entry
  in `AdminZonePropsMap`:

  | Member                      | Props                                            | Rendered by                                         |
  | --------------------------- | ------------------------------------------------ | --------------------------------------------------- |
  | `organization.detail.after` | `OrganizationDetailZoneProps { organizationId }` | the end of the organization detail screen, **once** |
  | `customer.detail.after`     | `CustomerDetailZoneProps { customerId }`         | the end of the customer detail screen, **once**     |

  `OrganizationDetailZoneProps` and `CustomerDetailZoneProps` are new exported interfaces. The
  second is not an alias of the first: the prop is named for the entity the mount carries, and
  the two members are two places.

  **One mount per screen is a rule, not a layout choice.** Neither member carries a prop that
  could tell two mounts apart, so a second mount of either renders every contribution twice
  and nothing in the renderer can distinguish them.

  `@endora-commerce/mod-quick-order` gains an `./admin` subpath — its first — with two zone
  contributions and `DefaultPreferencesPanel`, which moves into the package. The panel's two
  preference calls are rebuilt from the published `apiClient`; `quick-order-client.ts` stays in
  the admin application, where the on-behalf-of screen still uses it.

  ```tsx
  // Both contributions declare `orders:write`, which is the code every admin
  // route this module owns enforces. There is no `quick_order:*` permission.
  zoneComponent('organization.detail.after', () => import('./zones/OrganizationDefaults.js'), {
    weight: 300,
    requiredPermission: 'orders:write',
  });
  ```

  `@endora-commerce/mod-carts` gains its first zone contribution and a new route,
  `GET /api/v1/admin/organizations/:id/cart-approval-policy`, gated on `customers:manage` and
  answering `cartApprovalPolicyResponseSchema` — the same code and the same shape as the
  `PATCH` that has been there since feature 027. `CartApprovalService` gains `getPolicyByAdmin`.
  The contribution reads its own initial state through that route instead of taking the
  `initialRequiresCartApproval` prop the old panel took, because a zone's props cannot carry a
  value only one of four contributors wants.

  That panel had been imported by nothing, and the copy it rendered was in no bundle under any
  spelling — `t('carts.policy.title')` under the `carts` namespace resolves to
  `bundle['carts']['carts.policy.title']`, which never existed. Ten `policy.*` keys are added to
  this package's own bundle in both shipped languages, and the capability reaches an operator
  for the first time.

  `@endora-commerce/mod-price-lists` and `@endora-commerce/mod-sales-channels` each gain a
  second contribution over a component they already ship, and each loses its duplicate:
  `DisplayModeOverrideRow` and `EntityChannelMembership` existed twice in the tree for the
  length of the previous release, because the organization detail screen still imported the
  `admin/src` copy. Both copies are gone and nothing imports them.

  **Operator-visible copy change.** The organization detail's pricing card is now
  `price_lists`' own: the screen used to pass `organizations.detail.pricingLabel` and
  `organizations.detail.pricingHint` into a control it does not own and wrap it in a card
  titled `organizations.detail.pricingCard`. A host cannot hand copy to a contributor it does
  not know, so the control renders `priceLists.displayMode.rowLabel` and its own hint, and all
  three host keys are removed from the `core` bundle in both languages. Two further `core` keys
  go with them — `priceLists.linked.displayModeLabel` and `priceLists.linked.displayModeHint`,
  which the previous release left unread.

  No contribution declares a `match`, and each says why in its own file: `match` narrows the
  mounts of one place, and each of these members has one host and one mount. Every zone test
  asserts it absent.

### Patch Changes

- 3786732: Error-code ownership: the rest of Tier A is declared by the modules that own its nouns.

  `manifest.errorCodes` gains six codes on `@endora-commerce/mod-prompt-actions`
  (`ASSISTANT_*`, `PROMPT_*`), five on `@endora-commerce/mod-custom-fields` (`CUSTOM_FIELD_*`),
  two on `@endora-commerce/mod-customers` (`CUSTOMER_ADDRESS_NOT_FOUND`,
  `REGISTRATION_REQUIRES_ORGANIZATION`), two on `@endora-commerce/mod-shopping-lists`
  (`SHOPPING_LIST_*`), one on `@endora-commerce/mod-price-lists` (`PRICE_LIST_NOT_FOUND`) and one
  on `@endora-commerce/mod-transactional-emails` (`TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE`);
  `@endora-commerce/mod-i18n` drops the same seventeen from its own declaration, which is what
  decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 3 of eight;
  D-121 tiers T1 and T2; `specs/090-module-owned-error-codes/d129-sweep.md`).

  For a consumer this changes which bundle answers for those codes. No wire shape moves —
  `error.code` is unchanged — and no sentence is relocated: none of the seventeen had a
  translation in `en` or `pl` in any bundle. Writing one of those sentences is now a change to the
  owning module's own `i18n/{en,pl}.json` rather than to the platform's.

  `@endora-commerce/mod-shopping-lists` gains an `i18n` bundle it never had, declared as
  `i18n: { bundlesDir: 'i18n' }` and shipped in `files`. It holds the two `SHOPPING_LIST_*`
  sentences in both languages, which is an operator- and buyer-visible improvement: a Polish
  reader refused a delete of the default or the last shopping list now reads Polish prose instead
  of the English the raise site carries.

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
