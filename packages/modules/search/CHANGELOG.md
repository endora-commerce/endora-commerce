# @endora-commerce/mod-search

## 0.109.0

### Minor Changes

- 62b9a1c: Search, the sitemap and product feeds follow product data scopes per sales channel and language.

  - **Search:** a channel index carries every member that is on in at least one channel language; each document gains `liveLanguages`, `publishFromMs`, `publishUntilMs` and the channel-effective `visibility` and `allowedOrganizationIds` (all filterable). A query filters on the request language, the publication window at query time and the caller's audience, so a page is cut from available hits only; hydration asks `catalog` again for every hit. On the first reindex-scheduler tick after the upgrade (about a minute after start) the worker process makes those fields filterable (and `localizedNames` searchable) on every existing channel index without a reindex, changing a setting only where it is missing, so queries keep using the index; documents indexed before the upgrade are served as before. **Upgrade step:** run one reindex per sales channel (the `search_reindex` bulk operation or the reindex CLI) so the window and per-language filters are exact. `SearchIndexerOptions` requires `availability`; `SearchQueryService` takes the availability port as its sixth argument.
  - **Sitemap:** lists a product when it is available in the channel to an anonymous visitor at generation time — on in a channel language, inside its publication window, admitted by the channel's audience rule — with one URL per live language (`?lang=<code>` outside the channel's default). A product off globally but on in the channel is listed; one switched off in the channel is not.
  - **Product feeds:** the eligibility floor is effective availability at the feed's channel and language for an anonymous reader (scoped status, publication window, channel audience) instead of the global status; the selection preview counts the same set.
  - **Search, effective names:** documents carry `localizedNames.<language>` — the Name shown at the channel in each live language (channel overrides applied) — and a query searches `localizedNames.<request language>` beside the fields it always searched. Should an index still lack `localizedNames` as a searchable field, the query is asked again without that restriction, so search keeps working.

  **Release note — after upgrading:** run one `search_reindex` per sales channel. Until then the window, per-language and effective-name parts of search are approximate (documents indexed before the upgrade are served as before). The storefront listing's name sort now follows the effective name shown in the request's channel and language instead of the product slug, so its order changes for products whose name and slug sort differently; name-sort cursors issued before the upgrade start the list again.

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

### Patch Changes

- 473ef09: Storefront links on the basket, the search results, comparisons and the quick-order type-ahead use the product's effective URL key at the request's sales channel and language (product data scopes), as the product page and the catalogue listing already did.

  - **Behaviour change for API clients:** `productSlug` of a basket line and of an up-sell candidate, `slug` of a Meilisearch result card, of a comparison column and of a quick-order search hit is the channel × language key, else the language key, else the global key. A product with its own key in a language used to be linked by its global key, which answers 404 in that language when `seo` is off. A basket line whose product is unavailable still has `productSlug: null`.
  - **Also:** a Meilisearch result card and a comparison column report the request channel's `minOrderQuantity`.
  - `search` and `comparisons` resolve `catalogProductUrlKeyReadPort`; `catalog` is already a dependency of both.

- bec2e83: Polish error messages are Polish sentences. 137 `errors.*` entries in these modules' `i18n/pl.json`
  bundles were placeholders — the word "Błąd:" followed by the error code lowercased, for example
  "Błąd: product not found." — and a request with `Accept-Language: pl` received them verbatim as
  `error.message`. Each is now a sentence in Polish, for example "Nie znaleziono produktu."

  Error codes, HTTP statuses and the English sentences are unchanged; a client matching on the code
  sees no difference.

- 1a88646: English error messages are English sentences. 137 `errors.*` entries in these modules'
  `i18n/en.json` bundles were the error code in Title Case with a full stop, for example
  "Product Not Found." or "Asset Legacy Locator Cannot Harden.", and a request in English received
  them verbatim as `error.message`. Each is now a sentence in sentence case, for example
  "Product not found." or "This file cannot be made private because it is stored at an address the
  platform did not issue. Upload it again first."

  Two Polish sentences were corrected to match what the code refuses: `CANNOT_MODIFY_SYSTEM_DEFAULT`
  (`mod-sales-channels`) now says the default sales channel can be neither deactivated nor deleted,
  and `MEGAMENU_TARGET_OUT_OF_SCOPE` (`mod-megamenu`) now names a page as well as a category.

  Error codes and HTTP statuses are unchanged; a client matching on the code sees no difference. A
  client that matched on the English message text must match the new sentences.

- Updated dependencies [5d192d3]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [e64ed74]
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
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0

## 0.108.0

### Minor Changes

- 0bd5a2b: **Behaviour change for API clients — additive field.** Comparison items and search hit summaries carry `minOrderQuantity`, read from the catalogue record (never from the search index): the product's minimum order quantity for `simple` and `configurable` products, `null` otherwise or when none is set. Storefronts can start a quantity input at the minimum.
- 14bcf1d: Every consumer prices on price books (feature 160, D-287 P1), through the one batched resolution chain.

  - **carts** — `cart_items.price_source` (migration `…_carts_cart_items_price_source`) records which tier priced a line (`agreed | base | catalogue | buyer | sale`). `CartLinePricing.orderablePrices` drops the product's own price step, passes the variant, and stores the source.
  - **orders** — `order_items.price_source` (migration `…_orders_order_items_price_source`) is copied from the cart line at placement. The admin order preview and the external order intake price through `resolveLinePrices` instead of one `resolveLinePrice` per line; a line no price book prices is refused, with no `defaultPrice` fallback.
  - **organizations** — the effective price lists of an organization are its effective **price books**: `PriceListReadPort.listForOrganization({ organizationChain, customerGroupId })` answers the books whose audience holds the organization, an ancestor or its group, each with `reason` and `depth`. Old: `listActive()` plus `evaluateApplicationRule` per list. New: one `listForOrganization` call.
  - **product_feeds** — a feed pinned to a price book publishes that book's rows over the channel's catalogue price (`namedListPrices` takes the feed's `salesChannelId`); a product the book does not price is absent.
  - **search** — hits and suggestions price through the batched listing resolution; suggestions pass the request currency.
  - **quote_requests** — reference prices are resolved in the request's currency; the RFQ create prefill and the reference probe call `POST /api/v1/admin/price-books/resolve` instead of `GET /api/v1/admin/products/:id/resolved-price`.

- 74faecb: The Meilisearch-backed listing and the typeahead carry the list price (feature 161, G19), as the catalogue cards do (G14).

  - **Search listing.** `GET /api/v1/catalog/products` served by search: each hit's `resolvedPrice` gains `listPrice: { amount, currency }` when the pricing engine answers one (`pricing.show_list_price` on and the channel's everyone price above the buyer's). Old: `resolvedPrice: { basePrice, salePrice, displayMode }`. New: the same plus the optional `listPrice`.
  - **Suggestions.** `GET /api/v1/search/suggest`: a priced suggestion item gains the same optional `listPrice` beside `basePrice`, `salePrice` and `priceDisplayMode`.

- d2d3d9a: Search and typeahead pricing are batched and honour the customer's own group (D-287 P0).

  - **Typeahead.** `createSuggestionPricingEnricher` prices all hits in one `resolveListingPriceDetails` call (it was one `resolveEngine` per hit). `SuggestionPriceResolverPort` is now `ListingPriceDetailPort`. A suggestion's `basePrice` is now the listing chain's, so a product priced only by its own price attribute shows it; a pricing refusal degrades the whole popup to plain summaries (a switched-off `price_lists` is still re-thrown). The suggest route passes the customer account, and `SuggestionPricingEnricher`'s context gains `customerAccountId`.
  - **Search results** (Meilisearch path) price through `resolveListingPriceDetails` and carry `ProductSummary.resolvedPrice`, like the Postgres path; `searchHitSummary` takes an optional sixth `detail` argument. `SearchModuleOptions['listingPrices']` is typed `ListingPriceDetailPort`.

### Patch Changes

- 8d62ff8: Documentation only (feature 160, FR-048): the module pages describe how prices are determined with price books.

  - `price_lists` ships three pages instead of one: _Price books_ (what a book is, base prices, the four resolution steps, the default precedence, variants, where prices appear, the demo's worked examples, permissions, known limitations and a migration note), _The price-book editor_ (every admin screen) and _Pricing for developers_ (data model, resolver, the batched read path, caching, the price surface, the admin and storefront API, the ports and the conversion from the old model).
  - The pages of `catalog`, `carts`, `orders`, `organizations`, `product_feeds`, `quick_order`, `quote_requests` and `search` describe their prices as resolved from price books, with no product-owned price and no fallback. No code changes.

- eda7da8: Storefront product reads show a product's per-sales-channel value overrides.

  - **Behaviour change for API clients — channel overrides are now visible on the storefront.** `GET /api/v1/catalog/products/:idOrSlug` (name, description, `seo`, `structuredDataJsonLd`, `attributeValues`, `visibleAttributes`, grouped children and bundle options) and every `GET /api/v1/catalog/products` card name now return the override written in the product scope editor for the request's sales channel and language. The resolver's override slots are walked over the storefront's own baseline language order — the `Accept-Language` language, the channel's default language, `en-US`, `en`, the first stored language — taking the (channel, language) override at each language until the baseline has text for one, so an override never replaces baseline text of an earlier language in that order; the channel-only slot is asked last. Product-link tiles (in the product page's `links` and `GET /api/v1/catalog/products/:idOrSlug/links`) show overrides too, walked over their own pick, which has no channel-default leg. Channel-scoped user attributes return their channel override. A product without an override for that channel answers exactly as before.
  - Override rows are read for the request's sales channel only, once per read section, never per card.
  - **Search result cards show the same name.** Every card of the Meilisearch-served listing (`GET /api/v1/catalog/products?q=…` and `GET /api/v1/search/suggest`) now shows the name the catalogue's listing card shows for the request's sales channel and language, rather than the baseline text. The indexed name is still what the index ranks and sorts by. The request channel's override rows are read once per results page.
  - `@endora-commerce/contracts` exports the slot choice both modules share (`overrideLanguages`, `channelOverrideFor`, `effectiveSystemText`, `StorefrontOverrideContext`) and the resolver's `isNonEmpty` presence test the walk reuses, and `CatalogProductReadPort.listValueOverridesByProductIds` takes an optional `{ channelId }` that narrows the read to one sales channel's rows. Existing callers and implementations are unaffected.

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
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
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
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
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0

## 0.107.0

### Patch Changes

- 305b31e: A newly created product is searchable as soon as it is created, without a first edit. `search` reindexed a product only on `product.created.v1` / `product.updated.v1`, and `catalog` binds a new product to the default sales channel after `product.created.v1` has been dispatched — so the created event met a product with no channel, indexed it nowhere, and the product appeared only once something edited it. `search` now also reindexes a product on `sales_channels.membership_changed`, which the binding emits once the membership exists; the same subscription keeps the per-channel indexes in step when a product is later added to or removed from a channel. Other member types (CMS pages, blog posts, …) are ignored, and the subscription is gated like the others, so it does nothing while `search` is switched off.
- d76291d: Storefront catalogue reads can be priced in the currency the shopper selected. `GET /api/v1/catalog/products`, `GET /api/v1/catalog/products/:idOrSlug` and `GET /api/v1/catalog/products/:idOrSlug/links` accept `?currency=` (an ISO 4217 code, any case). The listing price, the price ordering, the price-range filter, the link tiles and the Meilisearch-served listing are all resolved in that currency when the request's sales channel lists it in its `currencies`, and in the channel's `defaultCurrency` otherwise. A malformed code answers `400 VALIDATION_FAILED`. Without the parameter, every read asks the pricing engine exactly what it asked before.

  `@endora-commerce/contracts` exports the pieces both modules use: `listingCurrencyQuerySchema` (the parameter), `resolveListingCurrency(requested, channel)` (requested if the channel offers it, else its default) and `listingPriceChannelContext(channel, currency)` (the `salesChannel` and `currencyCode` half of a `ListingPriceViewerContext`, with the default currency left implicit). `SearchQueryContext` gains an optional `currency`.

  `@endora-commerce/mod-price-lists`: a listing priced in a currency other than the channel's default no longer falls back to the Product's own `defaultPrice` / `price` attribute. That attribute has no currency of its own and was entered in the default one, so the fallback would have quoted, for example, 100 PLN as 100 EUR; such a product now has no listing price in that currency (`source: 'none'`). In the default currency nothing changes.

- Updated dependencies [fcf4d09]
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
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
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
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
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

## 0.105.0

### Patch Changes

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
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

## 0.104.0

### Patch Changes

- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- 1c9e6f3: `POST /api/v1/admin/search/reindex` answers `503 SEARCH_BACKEND_UNAVAILABLE` in the error envelope
  when Meilisearch is unreachable or refuses the request (a rejected API key, for example), with the
  client's own message. It used to answer an untyped `500 INTERNAL`, while the storefront's suggest
  route already gave a buyer the typed refusal for the same condition. A failure that is not the
  search engine's is still a 500.
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
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
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.10.7

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.10.6

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/platform@0.13.3

## 0.10.5

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/platform@0.13.2

## 0.10.4

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
  - @endora-commerce/platform@0.13.1

## 0.10.3

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0

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
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0

## 0.9.0

### Minor Changes

- 10a17f0: The liveness and readiness probe is the platform's, and `@endora-commerce/mod-health-checks` is gone.

  `GET /api/v1/_health` is now registered by `@endora-commerce/platform` itself: `composeApp`
  puts `healthRoutePlugin({ orm, redis })` at the head of the module plugins it returns, and
  `composeTestServer` does the same, so an instance serves the probe because it is an Endora
  instance rather than because a module the scaffolder happened to select is installed. It was
  not: `endora new instance` writes the closure over the modules declaring
  `activation.nonDeactivatable`, `health_checks` declared no activation block at all, and no
  manifest named it as a dependency — so a scaffolded instance answered 404 on the route
  `deploy/compose.prod.yml` healthchecks, its API container never became healthy, and its
  storefront, which waits on `service_healthy`, never started. Moving the route also closes the
  withdrawal: `assertDeactivatable` returns early for a module with no activation block, so
  `module:uninstall health_checks` was accepted and an operator could take the liveness endpoint
  off a running instance with one command. Owner ruling D-229.

  **What a consumer has to do.** Nothing, if the instance composes through `composeApp` or
  `composeTestServer` — the route arrives with the platform. Remove
  `@endora-commerce/mod-health-checks` from the instance manifest; it no longer resolves. The
  route, its path, its payload and its status codes are unchanged.

  `@endora-commerce/platform/composition` gains `healthRoutePlugin`, `registerHealthRoutes`,
  `platformHealthProbes`, `healthResponseSchema`, `HealthDeps`, `HealthProbeSources` and
  `HealthResponse`. No new subpath: `./http` is untouched, because no module names any of this.

  `MEILISEARCH_URL` and `npm_package_version` are declared by the platform now, with the
  sentences the dissolved manifest carried. `@endora-commerce/mod-search` therefore stops
  declaring `MEILISEARCH_URL` — one variable may not carry two descriptions, and a module may not
  describe a platform input — while continuing to read it and to declare
  `MEILISEARCH_API_KEY`. **An operator-visible consequence:** the surviving declaration is
  `optional`, where `search`'s was `required`. Both readers have always defaulted to
  `http://localhost:7700`, so the requirement was aspirational, but a prompt built from these
  declarations will no longer insist on the value.

- 02838b7: Nine modules now declare the environment inputs they own, in `manifest.env`, so a
  client who installs them can be told what to put in their `.env`. Each declaration
  carries an English and a Polish sentence, a requirement, and — for an `optional`
  one — what is lost without it.

  `health_checks` was the tenth until D-229 dissolved it into the platform; its two
  declarations went with it, and `search`'s `MEILISEARCH_URL` went with them,
  because the platform now declares that name and a module may not describe a
  platform input a second time.

  Nothing changes at runtime: no module reads a new variable and none changes how it
  reads an existing one. What changes is that the requirement is now on the wire, in
  the manifest the platform already carries, and reaches a consumer through the
  package's own `exports` map.

  Every module here declares only what it **owns**. The seven platform-owned names
  these modules read — `NODE_ENV`, `BACKEND_ROLE`, `STOREFRONT_BASE_URL`,
  `PUBLIC_API_BASE_URL`, `BACKEND_PUBLIC_URL`, `REVALIDATE_SECRET` and
  `SETTINGS_SECRET_ENCRYPTION_KEY` — are declared by `@endora-commerce/platform` and
  are deliberately not repeated here.

### Patch Changes

- 52c2bfd: `SearchReindexPort` is published: the container name `searchReindexPort`, owned
  by `search`, with the `Container name:` doc block its consumers read.

  It had a registration and no contract, which was invisible while the only
  consumer was a composition root — `check:port-shape`'s population is a module's
  own resolutions, and a root's read is outside it. `catalog` resolves the name
  directly since `specs/117-instance-bring-up/` Phase 6, and the check reported
  it on the first run.

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

## 0.8.0

### Minor Changes

- 8f4eea1: The indexer now waits for a Meilisearch task long enough to survive a busy queue, and it
  notices a task that failed.

  Nine of `SearchIndexer`'s twelve task waits passed no `timeout`, taking the `meilisearch`
  client's default of **5000 ms**. That number is the wrong order of magnitude for what is
  being waited on: a task wait is `the queue ahead of this task` + `this task's own work`,
  and Meilisearch's task queue is global to the instance. Measured against Meilisearch 1.x,
  a **one-document** write into an empty index expired the 5000 ms wait after 5006 ms with
  twelve document batches enqueued ahead of it — and then settled `succeeded` 10540 ms
  later. Nothing about that task was slow. A full reindex of a real catalogue, or any
  reindex against a Meilisearch shared with other work, hit the same wall as
  `MeilisearchTaskTimeOutError` thrown out of `reindexChannel`.

  **The second half is the one to read.** `waitForTask` does **not** throw for a task that
  failed — it resolves, carrying `status: 'failed'` and Meilisearch's own `error`. All
  twelve waits discarded that value, so a refused document batch and an applied one were the
  same thing to the caller: `reindexChannel` reported a document count for an index
  Meilisearch had written nothing into. The old code therefore failed loudly on the benign
  case and silently on the malignant one.

  **New setting.** `search.index_task_timeout_seconds`, default `120`, platform-wide. Raise
  it for a large catalogue or a shared Meilisearch instance. It is re-read per wait, so it
  takes effect without a restart. Its default is exported as
  `DEFAULT_INDEX_TASK_TIMEOUT_SECONDS` from the manifest and
  `DEFAULT_INDEX_TASK_TIMEOUT_MS` from the indexer.

  **What a consumer will now see.** Two new exported error classes, and the distinction
  between them is the point — they have opposite remedies:

  ```ts
  import {
    SearchIndexTaskFailed, // Meilisearch refused the write; `.meilisearchCode` says why
    SearchIndexTaskStillRunning, // the wait expired; the task was NOT cancelled and may yet succeed
  } from '@endora-commerce/mod-search/backend';
  ```

  `SearchIndexTaskStillRunning` replaces the `MeilisearchTaskTimeOutError` that used to
  escape, and its message names the setting to raise. `SearchIndexTaskFailed` is new
  behaviour rather than a rename: **an indexing failure that was previously silent now
  throws.** If you call `reindexAllChannels`, `reindexChannel`, `upsertProduct`,
  `deleteProduct` or `refreshAttributeSettings` directly, expect to see genuine Meilisearch
  refusals you were not seeing before. The module's own event subscribers are unchanged —
  they log and continue, as they already did.

  `SearchIndexerOptions` gains one **optional** field, `resolveTaskTimeoutMs?: () => Promise<number>`;
  omitted, it answers the manifest default, so existing construction sites keep compiling and
  behave identically.

### Patch Changes

- fe63714: Documentation only: the reindex page named `seed:dev`, the script feature 113
  replaced with `endora demo seed`. No exported symbol, route, service or
  migration changes, and the module's compiled output is byte-identical — but
  `docs/` ships in this package's `files`, so what a consumer receives does
  change.
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
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Major Changes

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

- ad62954: Fourteen more modules become workspace packages (feature 080, T040b batch three):
  `autopay`, `comparisons`, `credentials`, `dictionaries`, `google_tag_manager`,
  `ksef`, `meta_ads`, `paypal`, `payu`, `quick_order`, `search`, `stripe`, `taxes`
  and `tpay`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes — exactly as the twenty-nine
  packages before them.

  **For a consumer of `@endora-commerce/mod-ksef`, one export is new and
  load-bearing.** `KsefUnavailableError` is now published by name on `./backend`:

  ```ts
  import { KsefUnavailableError } from '@endora-commerce/mod-ksef/backend';
  ```

  Anything implementing `KsefApiClientPort` — an overlay's client, a test double,
  a second gateway — must throw **that** class for an outage.
  `classifySubmissionError` decides "retry" from `instanceof`, so a caller holding
  a constructor of its own, or the class from a relative import into this
  package's source, gets its outage classified as `UNEXPECTED`: the submission is
  parked for an operator instead of queued for the sweep, silently. There is no
  behaviour change for a caller that already throws the module's own class.

  Nothing else in any of the fourteen changed shape. The move is a relocation:
  same entities, same migrations, same class names, same tables. The committed
  migration registry's `(moduleId, className)` declaration sequence and its
  computed execution sequence are byte-identical to the merge base — 158 entries,
  `declaration=2db29d89…`, `execution=c794685f…` — because packaging changes no
  manifest `dependencies` and the order is a function of those.

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

- 9a18f41: `search` declares the eight error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied verbatim from the
  frozen capture, and is asserted equal to it in both directions.

  All eight already carry a written sentence in both `en` and `pl` in this
  package's own `i18n/` bundles, and those eight are exactly the `errors.*` keys
  those bundles hold — none is an `UNTRANSLATED_ERROR_CODES` entry — so no
  sentence moves and none is added.

  Six of the eight — `LIMIT_OUT_OF_RANGE`, `PHRASE_REQUIRED`, `PHRASE_TOO_LONG`,
  `QUERY_TOO_LONG`, `QUERY_TOO_SHORT`, `RESULT_COUNT_INVALID` — carry no `SEARCH_`
  prefix and read as generic request-validation codes. They are this module's:
  `routes.public.ts` hand-parses the suggest query precisely so a bad `q` or
  `limit` refuses with one of them instead of the generic `VALIDATION_FAILED`.
  Nothing else in the repository raises any of the six.

  No `tokens`: all seven raise sites of these eight codes were read across
  `packages` and `backend/src`, and none passes a `details.code` discriminator —
  the six that pass a fourth argument at all pass the Zod-style
  `Array<{path, issue}>`, which the envelope ignores by construction.

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
