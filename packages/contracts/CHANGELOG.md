# @endora-commerce/contracts

## 0.109.0

### Minor Changes

- e64ed74: **BREAKING — a `POST /api/v1/admin/quote-requests` that omits `salesChannelId`, for an Organization not assigned to the channel the admin request resolves to (the system default, or `X-Sales-Channel`), now answers `422 RFQ_SALES_CHANNEL_NOT_ALLOWED` where it answered `201`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. The server is the sole enforcer of the channel (owner decision 2026-10-29 "A"): the channel the request lands on, named or not, must be one of the Organization's active channels. A caller with no request scope — a worker, a CLI script, an in-process call to `RfqAdminService.createOnBehalf` — has no resolved channel and must name `salesChannelId`; without it the call is refused with the same code (`details.code: 'no_channel'`).

  An operator names the sales channel a quote request is created on for a customer. `adminCreateQuoteRequestSchema` gains an optional `salesChannelId`; `POST /api/v1/admin/quote-requests` stores the request on that channel, snapshots its line names in the channel's default language, and reports `PRODUCT_UNAVAILABLE_IN_SCOPE` warnings for that channel, refusing — before anything is written — a channel that is not one of the Organization's active channels (read through the kernel's `SalesChannelMembershipPort.listChannelsForEntity`; `RfqAdminServiceDeps` gains `channelMembership`) with the new `422 RFQ_SALES_CHANNEL_NOT_ALLOWED`. Absent, the request is raised where the admin request resolves (the system default, or `X-Sales-Channel`) — and that channel is checked the same way, as above. The _Create quote request_ screen offers the customer's organization's active channels — preselecting the only one, else requiring a choice —, prefills agreed prices on the chosen channel (`PricePrefillRequest.salesChannelId`), and, when the answer warns, lists the unavailable products before leaving the screen. Until a channel is settled it neither prefills prices nor sends anything: a failed or refused read says so (`rfqCreate.channelsLoadError`) with a retry, inactive while it runs.

- 50338a6: The admin assistant can archive and restore products (product data scopes).

  - **New assistant tools** `catalog.archive_product` and `catalog.restore_product` (`catalog:write`), with the parameter schemas `ArchiveProductsParamsSchema` and `RestoreProductsParamsSchema`. Like every assistant change they are planned first and run only after the operator confirms. Each product runs the same audited Archive / Restore as the admin screens, recorded in the audit log under the confirming admin. More than 50 products run as the bulk Archive / Restore in the background, which can be undone from its operation page.
  - `catalog.set_product_status` still only switches products on or off. Its description now tells the assistant that it does not archive or restore, and names the new tools.
  - **Behaviour change — assistant search:** `catalog.search_products` now includes archived products and returns `archived` beside `status`, so an archived product can be found to restore it.
  - **prompt_actions documentation:** the tool catalogue lists every catalog tool, the two new ones included, and says that archiving is not a status.

- 0e33ca9: Blog posts get a main image, a public list endpoint and a _Latest posts_ page-builder block.

  - `@endora-commerce/mod-blog` adds `blog_posts.main_image_asset_id` (migration `20261023T063013_blog_post_main_image`, nullable, foreign key to the asset library), editable in the post editor through the asset library picker. Deleting an asset a post uses as its main image is refused like any other referenced asset (reference kind `blog_post_main_image`).
  - `GET /api/v1/blog/posts?limit=&categorySlug=` returns the newest published posts of the request's sales channel as post cards (`limit` 1–24, default 6; an unknown category returns `[]`; a channel with the blog disabled returns `[]`). Cards carry the primary category's name for a chip.
  - `@endora-commerce/contracts`: `blogPostsListQuerySchema`, `blogPostsListResponseSchema`, `BLOG_POSTS_LIST_MAX_LIMIT`, `BLOG_POSTS_LIST_DEFAULT_LIMIT`; `mainImageAssetId` on `blogPostSummarySchema` (required, nullable) and on the create and patch request schemas (optional); optional `primaryCategoryName` on `blogPostCardSchema`; `blog_post_main_image` in `assetReferenceKindSchema`.
  - `blog.LatestPosts` (declared by `@endora-commerce/mod-blog`, rendered by `@endora-commerce/cms-components` as `LatestPosts` with the `CmsBlogPostCard` type): the newest posts as a carousel or a grid, optionally from one category, with a header and a read-more label. It is resolved on the server through the block-data seam, renders nothing for customers when there are no posts, and disappears from the editor and the storefront when the blog module is off.

- 22604fa: Attachments per sales channel and language, packaging-unit names per language (product data scopes, FR-078, FR-079).

  - **Attachments:** create and update (`POST` / `PATCH /api/v1/admin/catalog/products/:productId/attachments…`) accept `nameTranslations` and `descriptionTranslations` (language → text; `''` removes a language) and `hiddenInChannels` (replaces the set). A newly hidden channel the product is not a member of is refused with `422 SCOPE_INVALID`; clearing is always allowed. The admin DTO carries all three. The product page leaves out an attachment hidden in the request's channel and serves its name and description in the request's language, else the global ones.
  - **Packaging units:** create and update accept `nameTranslations` (the admin schemas stay strict). The admin DTO and `CatalogPackagingUnitRecord` carry it. The product page's `packagingUnits[].name` is the name in the request's language, else the global name.
  - **Basket snapshot:** a basket line ordered by a packaging unit stores the unit's name in the basket's language (`effectivePackagingUnitName`) and keeps it after a rename; the order line copies it. A buyer's quote-request line (create and draft edit) appends the unit's name in the request's language on its channel, else the global name, and keeps it; a line naming its unit by name and base quantity is still matched on the global name.
  - **Auditing:** these writes run the existing Commands `product_attachment.create` / `.update` and `packaging_unit.create` / `.update`, one audit entry per request. The route-level `attachment.create`, `attachment.update` and `product_packaging_unit` rows are no longer written beside them. The projections carry `productId`, the translations and `hiddenInChannels`; re-sending `before` without `productId` restores the row. They emit `product.updated.v1` with `changedFields: ['attachments']` / `['packagingUnits']`; a request that changes nothing writes and emits nothing. EN/PL audit labels added.
  - **Scope overview:** lists `attachments:hidden` per channel and `attachments:name`, `attachments:description`, `packagingUnits:name` per language.
  - **Contracts:** `ATTACHMENT_DESCRIPTION_TRANSLATION_MAX`.
  - **Migration** `catalog` `attachment_packaging_translations`: columns `product_attachments.name_translations`, `.description_translations`, `product_packaging_units.name_translations`, table `product_attachment_channel_hidden`. No backfill.

- 0e33ca9: The page editor's preview of a product listing shows the same line under each product name as the storefront, and the option says what each line is.

  - `@endora-commerce/contracts` exports `productSummaryText(description)` and `PRODUCT_SUMMARY_MAX_LENGTH`, moved from `@endora-commerce/mod-catalog`, which re-exports them from the same module path. The rule is unchanged.
  - `@endora-commerce/mod-cms`' admin preview maps a product's description to its card `summary` through it (`mapAdminProductToCmsSummary`), in the language its name is picked in. The summary line, and a Showcase card's default line, were always empty in the editor.
  - `catalog.ProductGrid` and `catalog.ProductSlider` label `cardTextLine` **Text under the product name**, with **Card style default (SKU; summary on Showcase)**, **Short description (from the product description)**, **SKU** and **None**, in English and Polish. The stored values are unchanged.

- 9ff8307: The product gallery per sales channel and its alt text per language (product data scopes, FR-076, FR-077).

  - **New admin routes:** `GET` / `PUT /api/v1/admin/catalog/products/:productId/gallery/channel-roles` (`catalog:read` / `catalog:write`) read and set a channel's own holder of `base_image`, `small_image` and `thumbnail` — keyed `baseImage`, `smallImage` and `thumbnail` in `roles` (`null` = use the global holder). `PATCH …/gallery/:itemId` accepts `altText` (language → text; `''` removes a language) and `hiddenInChannels` (replaces the set). These writes run as the Command `product.media.update` — one audit entry per request whose `before` restores the item — and emit `product.updated.v1` with `changedFields: ['media']`. A channel the product is not a member of is refused with `422 SCOPE_INVALID`; clearing an override there is always allowed. The route-level `gallery.update` audit row is no longer written beside the Command's.
  - **Admin DTO:** gallery items carry `altText` and `hiddenInChannels`.
  - **Storefront reads:** the product page's `gallery`, the listing card's image (also for related products and grouped / bundle children) and the OG image follow the request's channel: a hidden image is never served there, also not through its legacy `product_assets` twin, and a role resolves to its channel holder. `gallery[].altText` is the product's alt text at the request's language, else the asset's.
  - **Contracts:** `translationAt`, `applyTranslationPatch`, `translationMapPatchSchema`, `effectivePackagingUnitName`, `galleryChannelRolesSchema`, `putGalleryChannelRolesRequestSchema`, `GALLERY_ALT_TEXT_MAX`, `SCOPED_CHANNELS_MAX`; `sameLanguage` now lives in `scoped-translations.ts` and is re-exported unchanged.
  - **Scope overview:** lists `media:roles` and `media:hidden` per channel, `media:altText` per language, and `seo:<field>` overrides at L, C and C × L (none while `seo` is off).
  - **Migration** `catalog` `product_media_scopes`: tables `gallery_item_channel_labels`, `gallery_item_channel_hidden`, column `gallery_items.alt_text`. No backfill.

- 0e33ca9: Products carry a short plain-text summary, and the product listing blocks gain a showcase card for marketing pages.

  - `@endora-commerce/mod-catalog` derives `summary` from the product description already on the row — markup stripped, entities decoded, at most 160 characters cut at a word boundary with `…`, in the request language with the same channel override as the product page — and returns it on the storefront product list and product reads; `null` when there is no description. No extra query per product. `@endora-commerce/contracts` adds the optional `summary` to `productSummarySchema`.
  - `catalog.ProductGrid` and `catalog.ProductSlider` (rendered by `@endora-commerce/cms-components`, declared by `@endora-commerce/mod-catalog`) keep every option and default they had and add a header (heading, lead, button), `cardVariant` (`default` or `showcase`), a card link label `ctaLabel` and a `footerButton`. The slider takes the Carousel's options; a stored slider keeps its look through `productSliderFromLegacy` (arrows over the edges, dots below, pixel gap). The new texts are translatable, and the field labels ship in English and Polish.
  - `CmsProductCardView` accepts `variant: 'showcase'`: image on a neutral backdrop, name, summary and a "more" link labelled by `ctaLabel`, without price or SKU. `CmsProductSummary` gains the optional `summary`; `PRODUCT_CARD_VARIANTS` and the shared listing fields are exported from `components/catalog/product-listing-parts`.

- 07f3764: Minimum order quantity and "returnable" per sales channel (product data scopes, FR-100).

  - **Behaviour change:** a product's channel override of its minimum order quantity or its returnable flag (`product_channel_scopes`, written through `PATCH /api/v1/admin/catalog/products/:id/scopes`) now applies in that channel. Adding to the basket (single, batch and quick-order build), the basket view, submitting a basket for approval, the checkout preview, placement, the admin order preview, quote requests (create, draft edit, resubmit, the operator's per-line warning) and the buyer's quick-order import judge the minimum of the basket's, order's or request's channel; a channel minimum of 1 means no minimum there. Placement stamps `order_items.returnable_at_purchase` from the order channel's flag, so returns follow it. Without an override nothing changes.
  - **Storefront read model:** `minOrderQuantity` on the product detail and listing summaries is the request channel's value.
  - **Contracts:** new `withChannelOrderRules(records, rules)` puts the rules of `catalogProductAvailabilityPort.effectiveOrderRules` into a set of product records for one seam; `CatalogProductRecord.minOrderQuantity` / `returnable` keep meaning the global values.

- 0e33ca9: Brand tokens for page-builder content: one set of colours, colour schemes, fonts, a type scale, button sizes, spacing and layout widths that every block reads, set globally and optionally overridden per sales channel.

  - `@endora-commerce/contracts` exports the token shape and its rules: `cmsBrandTokensSchema` / `CmsBrandTokens`, `DEFAULT_BRAND_TOKENS`, `BRAND_TYPE_TOKENS`, `BRAND_SPACE_TOKENS`, `BRAND_SCHEMES`, `brandFontSourceSchema` (system, library asset or `https:` stylesheet), the contrast helpers `assessBrandContrast`, `contrastRatio`, `relativeLuminance`, `CONTRAST_REQUIRED_BODY` / `CONTRAST_REQUIRED_LARGE`, and the HTTP shapes `putCmsBrandTokensRequestSchema`, `putCmsBrandTokensResponseSchema`, `cmsBrandTokensAdminReadSchema`, `cmsBrandTokensStorefrontResponseSchema`. `CMS_STOREFRONT_CACHE_TAGS.brand` (`cms:brand`) is the storefront cache tag a save revalidates.
  - `@endora-commerce/mod-cms` stores the tokens in a new `cms_brand_tokens` table (migration `20261022T163218_cms_brand_tokens`), serves `GET`/`PUT /api/v1/admin/cms/brand-tokens` (read with `cms.read`, write with the new permission `cms.brand`; optimistic version check, audited, a stale write is `409`) and `GET /api/v1/storefront/cms/brand-tokens` (answers on a closed sales channel too). The page-builder descriptor carries the effective `brandTokens` and accepts `?salesChannelId=`. The Admin UI adds a _Brand_ screen at `/cms/brand` with live preview and contrast warnings (saving is never blocked by them), reachable from the content navigation and the command palette (`open-cms-brand`); the page editor's preview applies the page's channel tokens.
  - `@endora-commerce/cms-components` exports `brandTokensToCss` (also at `@endora-commerce/cms-components/brand/brand-css`), which renders the tokens as `--cmsb-*` custom properties plus font links. Every block style that reads a `--cmsb-*` variable keeps the previous literal as its fallback, so a storefront that never emits the variables renders exactly as before.
  - `@endora-commerce/page-builder-core` re-exports the token types from its barrel and the values from the new `@endora-commerce/page-builder-core/brand-tokens` subpath. Colour fields may store a brand role as `token:<role>`: `BRAND_COLOR_ROLES`, `brandColorRole`, `brandColorFallback` and `resolveColorValue` (`token:primary` → `var(--cmsb-color-primary, <default>)`); the palette context gains an opt-in `brandRoles` flag, and `backgroundToStyle` resolves tokens.
  - `@endora-commerce/page-builder-admin`: `PageBuilderColorPaletteProvider` takes an optional `brandColors`; when set, the palette lists the brand colours first and a pick stores the role token. Leave it unset where content is rendered without the brand stylesheet, such as e-mail.
  - `@endora-commerce/mod-settings` lists the `cms-brand` cache namespace on the cache screen; `@endora-commerce/mod-i18n` adds the `pageBuilder.colorPalette.*` labels (English and Polish).

- 0e33ca9: CMS pages get a breadcrumb parent, breadcrumb display options and a sharing image.

  - `@endora-commerce/mod-cms` adds four columns to `cms_pages` (migration `20261023T052237_cms_page_tree_and_share`): `parent_page_id` (self-reference, cleared when the parent is deleted), `breadcrumbs_visible` (default `true`), `breadcrumbs_scheme` (`light`, `muted` or `dark`, default `light`) and `share_image_asset_id`. The parent only shapes the breadcrumb trail; it never changes the page's URL. A parent that would create a cycle, or a tree deeper than eight levels, is refused with `422` (`CMS_PAGE_PARENT_CYCLE` for a cycle) and nothing is written or audited. Saving a page invalidates the cached pages below it.
  - The storefront page read returns `breadcrumbs: { visible, scheme, trail }` (each crumb's `slug` is `null` when the ancestor is not published on the request's sales channel), `share: { imageUrl }` (the page's own public image, else the new per-channel setting `cms.default_share_image_asset_id`) and `languages` (the page's languages that carry content). A page that sets nothing keeps today's trail and look.
  - The page editor adds a _Breadcrumbs_ card (parent page, visibility, scheme) and a _Sharing_ card (image from the asset library). Deleting an asset used as a sharing image is refused like any other referenced asset.
  - `@endora-commerce/contracts`: `cmsBreadcrumbsSchemeSchema` / `CmsBreadcrumbsScheme`; `parentPageId` on the admin page summary; `breadcrumbsVisible`, `breadcrumbsScheme` and `shareImageAssetId` on the page detail (all required in responses, optional on create and patch); `breadcrumbs`, `share` and `languages` on `cmsResolvedPageSchema`; `parentPageId` on `CmsPageRecord`; the error code `CMS_PAGE_PARENT_CYCLE`. Code that constructs these response objects or a `CmsPageRecord` must supply the new fields.

- ea892d5: Exports `ATTACHMENT_NAME_MAX` and `PACKAGING_UNIT_NAME_MAX` (both 160), the longest attachment name and packaging-unit name, global or per language, so a form can bound its inputs by the same number the schemas enforce.
- 678fed1: **BREAKING — `ProductDetail` gains a required field, `paths`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. Code that builds a `ProductDetail` literal (a test fixture, an overlay serving the product page) must add `paths` — `{ canonical, alternates }` from `productPagePathsSchema`; a reader is unaffected.

  `productDetailSchema` gains the required `paths` field (`productPagePathsSchema`, exported from `product-url-keys`): the product page's canonical path and its alternate-language paths, built by the backend with `productPath()`. `CatalogProductUrlKeyReadPort` is now registered as `catalogProductUrlKeyReadPort` by `catalog`. A consumer that constructs a `ProductDetail` literal must add `paths`.

- dcbd154: **BREAKING — `CatalogBulkImportPort` gains a required method, `exportScopedStatuses()`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. An implementer of the port (an overlay replacing catalog's import / export) must add it; it answers the products' scoped statuses as `ScopedStatusExport`. Callers are unaffected.

  `ProductImportRow.scopedStatus` (`ScopedStatusCell[]`), `ScopedStatusExport`, `scopedStatusColumn()` / `parseScopedStatusColumn()` for the products file's `status@<channel code>[/<language>]` columns, and `CatalogBulkImportPort.exportScopedStatuses()` — an implementer of that port must add the method. `CatalogProductScopeWritePort` is now registered as `catalogProductScopeWritePort` by `catalog`.

- a76d6ee: **BREAKING — `seoMetaOverrideSchema.locale` is `string | null`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. An override saved for a whole sales channel has no language, so a reader that typed `locale` as `string` must handle `null`; `channelId` is new and nullable beside it.

  `upsertSeoMetaOverrideRequestSchema.locale` is optional and the schema gains `channelId`; new `seoMetaScopeQuerySchema` (`locale?`, `channelId?`) for the meta GET and DELETE; `seoMetaOverrideSchema` has a nullable `locale` and a nullable `channelId`. `SeoProductMetaPort` is registered as `seoProductMetaPort` by `seo`. A caller that reads `seoMetaOverrideSchema['locale']` as a string must handle `null` (a sales channel override).

- 22604fa: **BREAKING — `CatalogGalleryPort.listForProducts` and `CatalogGalleryPort.baseImageUrls` gain a required second parameter, `channelId: string | null`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. A caller passes the sales channel it serves, or `null` for the previous, global answer: `listForProducts(ids)` → `listForProducts(ids, channelId)`, `baseImageUrls(ids)` → `baseImageUrls(ids, channelId)`. An implementer of the port (an overlay replacing catalog's gallery) adds the parameter and leaves out the items hidden in that channel; with `null` it answers as before.

  A gallery image hidden in a sales channel no longer reaches that channel's product feeds or comparisons (product data scopes).

  - **Contracts:** `CatalogGalleryPort.listForProducts(productIds, channelId)` and `CatalogGalleryPort.baseImageUrls(productIds, channelId)` take the channel the caller serves; `null` keeps the global answer.
  - **catalog:** `listForProducts` leaves out the items hidden in the channel. `baseImageUrls` answers the channel's own `base_image` holder, else the global one, and `null` when that holder is hidden there. Each is still one statement per batch.
  - **product_feeds:** a feed's images are read in the feed's channel.
  - **comparisons:** the base-image column is read in the viewer's resolved channel.

- 9a38360: **BREAKING — `cartViewLineSchema.productSlug` is `string | null | undefined`.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range. A basket line whose product is unavailable carries `productSlug: null`, so a reader that typed it as `string | undefined` must handle `null` (render the line without a product link); `productSku` is new beside it.

  Product data scopes reach the basket view and the two external API seams that did not follow them yet.

  - **Basket view:** a line whose product is no longer available at the basket's sales channel and language keeps its `productName` and `productSku`, reads `unavailable: true` (`unavailableReason: 'not_purchasable'`), and has `productSlug: null`, so the storefront shows it without a link to a product page that answers `404` there. Placing the order still refuses it. `cartViewLineSchema` types `productSlug` as nullable and gains `productSku`.
  - **External order intake** (`POST /api/v1/external/orders`): after the existing per-line checks, every line's product must be available at the key's sales channel (its default language) to the calling key's Organization — not switched off there, inside its publication window, admitted by the channel's audience rule. A product that is not answers what a product hidden from the bound Organization already answered: `404 PRODUCT_NOT_FOUND`, no name, nothing placed. An unknown or unpublished SKU keeps its per-line `422 VALIDATION_FAILED` (`SKU_NOT_IN_ASSORTMENT`), which takes precedence. The availability rule decides the status, so the SKU read no longer drops a product that is off globally: one that is on in the key's channel is orderable, one that is off there answers the `404`. `OrderApiIntakeService` takes `catalogAvailability`, and `place` takes the caller's `audience`.
  - **External bulk prices** (`POST /api/v1/external/catalog/prices`): a product not available to the calling key's Organization at the key's channel gets no price and reads `sku_not_in_assortment` — before, a product restricted away from that Organization was priced. `resolveBulkPrices` takes the caller's `audience`; the external catalogue namespace is mounted only with `catalog`'s own availability port.

- 0e33ca9: The dark scheme's decorative backdrop can be given as a URL, `cms.Tabs` can keep its tab bar in one scrolling line, and a `cms.Column` can distribute its blocks vertically and reorder them per breakpoint.

  Nothing changes for a page that does not use them: the default markup and look are the ones the blocks had.

  - **Backdrop by URL.** The brand tokens' schemes gain an optional `decorativeUrl`, validated by the new `brandMediaUrlSchema` and `BRAND_MEDIA_URL_RE` in `@endora-commerce/contracts`. It accepts an `https:` URL, or a path starting with `/`, of up to 2048 characters, with no quotes, parentheses, backslashes, angle brackets or whitespace. The library asset (`decorativeAssetId`) wins when both are set. `brandTokensToCss` takes a new `mediaUrl` option, which rebases a `/path` (the storefront and the admin pass their API origin). It checks the stored value again and writes it as an escaped CSS string. The brand screen has a **Decorative backdrop URL** field under the dark scheme's asset picker. `@endora-commerce/page-builder-core/brand-tokens` re-exports `BRAND_MEDIA_URL_RE`.
  - **Scrolling tab bar.** `cms.Tabs` gains `barOverflow: 'wrap' | 'scroll'`. Unset, it wraps as before. `scroll` adds `cmsc-pb-tabs--scroll` and keeps the bar in one line that scrolls sideways inside the block, with scroll snapping and no page overflow. The roles and the keyboard model are unchanged. A tab chosen with the pointer is scrolled into the bar's view. The tab focus ring (`.cmsc-pb-tabs__tab:focus-visible`), lost in an earlier stylesheet edit, is restored.
  - **Column distribution.** `cms.Column` gains `distribute`: `'start'` (the default), `'center'`, `'end'`, `'space-between'` or `'last-to-bottom'`. It is written as `data-pb-distribute`. The column's published block slot now carries the class `cmsc-pb-column-stack`.
  - **Block order per breakpoint.** `withHideOn` offers `stackOrder`: `'auto'`, `'first'`, `'1'`–`'6'` or `'last'`, one value per breakpoint, on the Responsive tab. The field appears only when the block's parent is in the new `BLOCK_ORDER_PARENTS` export (`['cms.Column']`), through a `resolveFields` it now adds to every wrapped block, so no block's static fields change. The value is written on the wrapper as `data-pb-order` and `--pb-order(-md|-lg)`, and the stylesheet reads it as the CSS `order`. Only the visual order changes: the DOM and focus order stay the stored order. `STACK_ORDER_VALUES` and the `StackOrder` type are exported.

  The `cms`, `catalog`, `blog` and `newsletter` bundles carry the English and Polish labels.

- 0e33ca9: An inline icon can have its own size and vertical offset, and a Section's or a Section group's image background and decorative backdrop can have a size, a repeat and a position.

  Nothing changes for content that does not use them: an icon with no size or offset is drawn at 1 em on the line as before, and a background with none of the new values renders the same markup and look.

  - **Inline icon size and offset.** The `inlineIcon` node of `InlineRichText` accepts optional `size` (`'0.5em'`–`'3em'` or `'8px'`–`'200px'`, `isInlineIconSize`) and `offset` (em of the text, −1 to 1, `isInlineIconOffset`), each also as `null`. `InlineRich` draws the icon at that size and moves it with `vertical-align`; `inlineIconPresentation` is exported for editors that draw it. `inlineIconNode` writes them as `data-cms-icon-size` / `data-cms-icon-offset`, the same through the DOM-free serializer and TipTap's, and reads them back. The icon dialog of the inline rich-text field sets both, edits a selected icon (**Edit icon**), and is translated through the page builder's field text.
  - **Background size, repeat and position.** `sectionBackgroundSchema` gains `size` and `repeat` for an image (`'cover' | 'contain' | 'auto' | {px} | {percent}` and `'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y'`), and `decorativeSize`, `decorativeRepeat` and `decorativePosition` for the decorative backdrop; `BACKGROUND_SIZE_KEYWORDS`, `BACKGROUND_REPEATS` and `backgroundSizeToCss` are exported. An image with a natural or fixed size or a repeat is painted as a CSS background (`.cmsc-section__tile`, with the mobile image below 768 px); `contain` keeps the picture. The backdrop's values are written on the section or the group's paint layer. The Section background field offers them, with `cover`, no repeat and the top position as the defaults.

  `@endora-commerce/mod-i18n` adds the English and Polish `pageBuilder.fieldText.section.*` and `pageBuilder.fieldText.inlineIcon.*` labels; the `cms` module's documentation describes both.

- 0e33ca9: A rich-text "read more" can place its summary and open upwards, an accordion gains look options, both open and close with an animation, and a highlighted phrase can take any brand colour or hex.

  Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

  - **Read more position and reveal above.** The rich-text `readMore` node gains `chevronPosition` (`'start' | 'center' | 'end'`, `'start'` by default) and `revealAbove` (`false` by default). They add `cmsc-read-more--center` / `--end` and `cmsc-read-more--reveal-above` to the `<details>`, the same through the DOM-free serializer and TipTap's, and are parsed back from them. The sanitiser is unchanged. Reveal above shows the open passage's content above its summary through CSS order only: the summary stays the first child and the one control. The rich-text toolbar gains **Read more position** and **Show the revealed text above the summary**.
  - **Animated open and close.** A read-more passage animates its `::details-content` height and an accordion panel its height and opacity, only without reduced motion and only where the browser supports `interpolate-size` (instant elsewhere). An accordion animates only after hydration (`data-animate`), so a panel open by default does not animate on page load. Every accordion panel stays in the server HTML, `hidden` while closed.
  - **Accordion look.** `cms.Accordion` gains `icon` (`'plus' | 'chevron'`), `itemStyle` (`'plain' | 'boxed'`), `dividers` (`'none' | 'between' | 'all'`, for plain items) and `titlePadding` / `titlePaddingPx` (a spacing token or Custom px per breakpoint, on the Responsive tab). Each is unset by default and writes nothing then.
  - **Emphasis colour.** The inline rich-text `emphasis` mark accepts an optional `color` (`#rrggbb` or `token:<role>`, `null` as unset) in `inlineRichTextSchema`. It renders `data-cms-em-color` and an inline `color` on the variant's span, in `InlineRich` and through both TipTap serializers. A colour outside that grammar renders today's span. The rich-text sanitiser keeps `data-cms-em-color` on a `<span>` with a colour value only. The inline toolbar gains **Highlight colour** (brand colours, a hex, **Remove colour**). The translation codec carries the mark unchanged.
  - **Labels.** The new toolbar and dialog labels are page-builder field text (`pageBuilder.fieldText.emphasisColor.*`, `pageBuilder.fieldText.readMore.*`), and the accordion fields are labelled in English and Polish.

- 0e33ca9: A new `cms.SectionGroup` block holds a run of Sections and paints one background behind all of them, so the decorative backdrop no longer shows a seam at every Section boundary.

  - `@endora-commerce/contracts`: `sectionGroupSettingsSchema` and `SectionGroupSettings` describe the group's props: `anchor`, `scheme` (default `inherit`), `background`, and `spaceTop` / `spaceBottom` per breakpoint (default `none`).
  - `@endora-commerce/page-builder-core`:
    - `ROOT_ONLY_TYPES` now lists `cms.SectionGroup` beside `cms.Section`.
    - `shouldRevertPuckAction` lets a Section into a group's `content` slot and reverts anything else dropped there. The new exports are `SECTION_GROUP_TYPE`, `SECTION_GROUP_CHILD_TYPES` and `isSectionGroupContentZone`.
    - A move out of a slot zone now reads the moved block's type from its parent's slot prop.
    - `collectAnchors` lists a top-level group's anchor and the anchors of the Sections in it.
  - `@endora-commerce/cms-components`:
    - `cms.SectionGroup` (`SectionGroup`, `SECTION_GROUP_RESPONSIVE_FIELDS`, `SECTION_GROUP_SLOT_ALLOW`) is a top-level block whose slot accepts only `cms.Section`. Its fields are Colour scheme, Background (with the decorative backdrop), Anchor, and Space above / Space below on the Responsive tab.
    - It renders through the new `SectionGroupFrame`: a `.cmsc-section-group` wrapper with one `.cmsc-section-group__paint` layer across the window behind all its Sections.
    - A Section in a group renders as a top-level Section (`data-in-group`). It inherits the group's scheme unless it sets its own. While the group paints, a Section with no background of its own and no other scheme is transparent (`data-transparent`).
    - The first Section of a group can overlap the block before the group.
    - An empty group drops its own spacing, as an empty Section does.
    - The hero's lead-image lookup sees through a first group.
    - Every other slot (Section, Column, Slide, tab and accordion panels) refuses the group.
  - `@endora-commerce/mod-cms`:
    - The manifest declares `cms.SectionGroup` in the `layout` palette, with English and Polish labels.
    - The anchor guard counts a top-level group's anchor and its Sections' anchors.
    - A section preset inserted while a block inside a grouped Section is selected goes into that group.

- 0e33ca9: `cms.Section` can overlap the section before it, and an empty Section no longer leaves a blank band.

  - `@endora-commerce/contracts`: `sectionSettingsSchema` gains an optional `overlap`, a spacing token or a pixel value per breakpoint (`Responsive<SpaceValue>`). Unset means no overlap.
  - `@endora-commerce/page-builder-core`: `createSectionSpaceField` takes an optional `defaultValue` (`SectionSpaceFieldOptions`). It is the value shown, inherited and seeded until one is set. It stays `'l'` unless given; the overlap uses `'none'`.
  - `@endora-commerce/cms-components`: `cms.Section` gains the **Overlap with the previous section** field on the Responsive tab. When an overlap is set, the section carries `data-overlap` and `--cmsc-section-overlap(-md|-lg)`. The stylesheet then pulls its content frame up by that amount, above the previous section's background (`z-index: 1`). The section's own background stays in place, and the page's first block is never pulled. The editor canvas does not move the content. Instead, a hatched band shows the overlap of the previewed breakpoint.
  - A published Section whose blocks all render nothing loses its padding, minimum height and pull-up. Examples are a news list with no posts, or blocks hidden at that breakpoint. A CSS `:has()` rule decides this, so the markup of a non-empty Section is unchanged. A Section with an image or video background keeps its size. Browsers without `:has()` keep the padding, as before.
  - `@endora-commerce/mod-cms` lists `overlap` among the Section's `responsiveFields`. The field has English and Polish labels.

- 0e33ca9: A new Page Builder block, `cms.Section`, carries the section settings and a slot for any other blocks: a colour scheme (`inherit`, `light`, `muted`, `dark`), a width (`contained`, `wide`, `full`, `viewport`, `bleed`, `custom`), spacing above and below per breakpoint (a brand space token or pixels), a background (colour, gradient, image or video per breakpoint, overlay, decorative backdrop), a content position per breakpoint, an entrance reveal and an anchor id for in-page links. The settings are the Section's own props — `anchor`, `scheme`, `background`, `width`, `contentWidth` (offered with a `full`, `viewport` or `bleed` width: the content frame — page container, wide, to the edges or custom — inside a background of that extent, so a full-screen band can hold contained content without the viewport's full height), `customMaxWidthPx` (one px value, offered with the custom width or content width), `reveal`, and per breakpoint `spaceTop`, `spaceBottom` and `contentPosition`, which the editor shows on its Responsive tab and edits per breakpoint through its scope switcher. A Section stands only at the top level of a page: every slot refuses it, the editor reverts a drop into one, and a Section stored nested renders its children without the section wrapper. No other block carries section settings.

  - `@endora-commerce/contracts`: `sectionSettingsSchema` / `SectionSettings`, `SECTION_CONTENT_WIDTHS` / `sectionContentWidthSchema`, `sectionBackgroundSchema`, `sectionOverlaySchema`, `sectionAnchorSchema`, `SECTION_ANCHOR_RE`, `RESERVED_ANCHORS` (ids the storefront layout already uses), and the error codes `CMS_DUPLICATE_ANCHOR` and `CMS_RESERVED_ANCHOR`.
  - `@endora-commerce/page-builder-core`: the Section's custom editor fields `createSectionBackgroundField` (with `isSectionBackgroundField`, by which a host gives it an asset picker), `createSectionSpaceField` (a responsive field), `createSectionAnchorField` and `createSectionRevealField`, `isTopLevelParent`, the section value types and option lists, and the depth context that decides "top level": `useSectionContext()` (`{ depth, topLevel }`), `BlockDepthContext` and `EmbeddedBlockDepth` (wrap an embedded document so its blocks count from the embed's level). `withHideOn` provides that context; its markup is unchanged. `collectAnchors(data)` lists the anchors of a document's top-level Sections for the in-page link kind. The editor guard `shouldRevertPuckAction` also reverts an insert or a move of a root-only block (`ROOT_ONLY_TYPES`, today `cms.Section`) into any zone but the page's own list; `isRootZone` is exported beside it. The editor outline now lists blocks inside array-item slots.
  - `@endora-commerce/cms-components`: the `Section` block (`cms.Section`) and `SECTION_SLOT_DISALLOW`, the `SectionFrame` renderer it draws through, `useSectionAnchor()` (the anchor of the Section a block stands in) and `useBreakpointVideo`. The slots of `cms.Column`, `cms.Slide` and the Tabs and Accordion panels refuse `cms.Section`. A `viewport`-wide section is at least the viewport tall.
  - `@endora-commerce/mod-cms` declares `cms.Section` in the `layout` palette section, and refuses a save of a page, reusable block or template whose top-level Section anchors or heading anchors repeat (`422 CMS_DUPLICATE_ANCHOR`) or use a reserved id (`422 CMS_RESERVED_ANCHOR`), with the anchor in `details.anchor`; nothing is written or audited.

- 0e33ca9: Shared prop shapes for page-builder blocks, with one renderer and one editor field each, so every block links, shows buttons, images and short formatted text the same way.

  - `@endora-commerce/contracts` exports the shapes as Zod schemas and types: `linkValueSchema` / `LinkValue` (URL, page, product, category, file or a section anchor on the same page; `javascript:` and protocol-relative URLs refused), `buttonSpecSchema` / `ButtonSpec` (label, link, style, fill, size, icon and per-breakpoint values), `responsiveImageSchema` / `ResponsiveImage` (desktop and mobile source, alt text, aspect ratio per breakpoint, fit, focal point), `inlineRichTextSchema` / `InlineRichText` (bold, italic, link, line break and the `gradient` / `accent` / `muted` emphasis), `colorValueSchema` (hex or `token:<role>`), `responsiveSchema(inner)` / `Responsive<T>`, and the space, scheme and width enums. The zod-free helpers (`normalizeAnchor`, `isSafeLinkUrl`, `isAspectToken`, `plainTextToInlineRichText`, `inlineRichTextToPlain`, the regular expressions and token lists) are also importable from `@endora-commerce/contracts/page-builder-values` without bundling Zod.
  - `@endora-commerce/page-builder-core` re-exports these types and helpers from its barrel.
  - `@endora-commerce/cms-components` exports the renderers: `ButtonView`, `Picture` (art-directed `<picture>`, lazy unless `priority`), `InlineRich` / `countInlineRichWords`, `resolveLinkHref`, `colorValueToCss` / `iconColorProps`, and the inline rich-text editor field `createInlineRichTextField` with `InlineRichTextEditor`, `inlineRichTextExtensions` and the `emphasisMark` TipTap mark. Button styles are the new `cmsc-btn` classes in the shipped stylesheet.
  - `@endora-commerce/page-builder-admin` exports the editor fields: `createLinkField` / `LinkFieldControl` / `LINK_KINDS`, `createButtonListField` (up to six buttons, optionally per breakpoint), `createButtonSpecField`, `DEFAULT_BUTTON_SPEC`, `createResponsiveImageField` / `ResponsiveImageControl`, `createFileAssetField` and `listPageBuilderLinkPages`. `createButtonLinkSlugField`, the previous slug-only link picker, is exported from here as well and keeps the stored value it always wrote.
  - `@endora-commerce/mod-i18n` adds the `pageBuilder.linkField.*` and `pageBuilder.imageField.*` labels (English and Polish).

- 0e33ca9: The tab size can differ per breakpoint, carousel arrows can be drawn arrows, inline rich text can hold an icon, and rich-text headings follow the brand type scale.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Tab size per breakpoint.** `cms.Tabs` gains `tabSize` (`'s' | 'm' | 'l'`, or one per breakpoint), a top-level prop on the Responsive tab, listed in the block's `responsiveFields`. It replaces the `size` key of `tabStyle` in the editor. A size stored in `tabStyle.size` still applies, and the editor's `resolveData` moves it to `tabSize` (`tabSizeMoved`). The phone's size writes the existing `cmsc-pb-tabs--size-s|l` class; a larger breakpoint whose size differs adds `cmsc-pb-tabs--size-md-*` or `cmsc-pb-tabs--size-lg-*`.
  - **Arrow icon.** `controls.arrowIcon` (`'chevron' | 'arrow'`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, and the `CarouselShell` prop `arrowIcon`. `arrow` draws the icon catalog's arrows as inline SVG hidden from assistive technology; the chevron glyphs stay the default.
  - **Inline icon.** `InlineRichText` accepts an `inlineIcon` node (`{type: 'inlineIcon', attrs: {name}}`, the name matching `INLINE_ICON_NAME_RE`), an icon of the page builder's catalog. `InlineRich` renders it as `1em` inline SVG with `aria-hidden`; an unknown name renders nothing. `inlineRichTextToPlain` drops it. The inline rich-text field gains an **Insert icon** button. `inlineIconNode` (in `rich-content-shared`) serializes it as an empty `span.cmsc-inline-icon[data-cms-icon]`, the same through the DOM-free serializer and TipTap's. Page translation carries it as one atomic tag.
  - **Rich-text headings follow the type scale.** For each heading level `h1`–`h6` whose type style is set, `brandTokensToCss` writes one rule giving the headings inside rich text (`cms.RichContent` and the blocks' rich bodies) that level's size, line height, weight and letter spacing. With no brand tokens it writes nothing.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels. The `blocks.tabs.fields.tabStyle.fields.size` keys are replaced by `blocks.tabs.fields.tabSize`.

- bdef54c: The product editor's SEO tab ends with a new admin zone, `product.editor.seo.after` (props: the product id). `seo` contributes the link to its meta-tag editor there, shown while `seo` is on and the admin holds `catalog:write`; `catalog` no longer names `seo`. The tab's former "Page title (preview)" input, which saved nothing, is gone.
- 1b4f2b7: A product's storefront page follows its availability at once. `catalog` now drops the storefront's cached product-page reads of a product — tagged by its id, slug, URL keys and former keys — after `product.updated.v1`, `product.archived.v1` and a product's `sales_channels.membership_changed`, and its keys after `product.deleted.v1`, through the storefront revalidate endpoint it already uses for categories (`STOREFRONT_BASE_URL` + `REVALIDATE_SECRET`; a no-op without them). Any `product.updated.v1` counts — a gallery, attachment, packaging-unit or name change drops the product's page as well, since the event does not say which writes change availability. A short trailing debounce (150 ms, at most 1 s) gathers a bulk operation into one call, chunked at 200 tags; past 500 pending products the shared `catalog:product` tag is dropped once instead; one call is in flight at a time. `product.deleted.v1` now carries `formerUrlKeys`, the redirect keys the deletion removed, so a deleted product's pages are dropped by key too (the shared tag only when its keys cannot be read). Best-effort: a failed key read or call is logged and never fails the write. Next keeps only a `200` in its Data Cache, so a product switched off, archived or moved out of a channel used to go on showing until the storefront restarted. The tag vocabulary is `CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS` (`product`, `productKey(key)`, `maxLength`), shared by both sides.
- d560d58: Product data scopes per sales channel and language: the availability rule, the admin shapes, URL keys and the ports, all additive.

  - **New module `product-scopes`** (re-exported from the package root): the one rule of effective availability — `isProductEffectivelyAvailable(input)` (not deleted or archived, a member of the channel, the language offered by the channel, effectively `active` there, inside the publication window, admitted by the effective audience rule) with its parts `effectiveStatus`, `isOn`, `effectiveWindow`, `isInsideWindow` (inclusive at both ends, to the millisecond), `effectiveAudience` (a channel override replaces the whole rule) and `effectiveOrderRules`; `pairsTurningOn(before, after, channels)`, the (channel, language) pairs a status write turns on; `resolveScopeLanguage(channel, tag)`, which picks the content language of a request from the channel's own languages. Constants and records: `PRODUCT_SCOPE_STATUSES`, `productScopeStatusSchema`, `PublicationWindow`, `AudienceRule`, `ProductChannelScopeRecord`, `ProductChannelLanguageScopeRecord`, `ProductGlobalScopeFields`, `ScopeChannel`, `ScopeSnapshot`.
  - **Admin shapes:** `productScopesResponseSchema` (its `data.organizations` names, as `{ id, name }`, the organizations the channel audience rules name), `patchProductScopesRequestSchema` / `patchProductScopesResponseSchema` (absent = untouched, `null` = use inherited), `scopeWarningSchema`, `scopeMissingValueSchema` (`'name' | 'urlKey' | 'attribute:<key>'`), `scopeInvalidDetailsSchema`, `scopeIncompleteDetailsSchema`, `scopeOverviewResponseSchema`, `attributeScopeChangePreviewResponseSchema`, `SCOPE_COMPLETENESS_GATE_MODES`.
  - **New module `product-url-keys`:** `productPath({ key, languageCode, channelDefaultLanguage })` — `/p/<key>`, plus `?lang=<L>` outside the channel's default language; the one place a product URL is composed — `productSlugSchema`, `productUrlKeysResponseSchema`, `putProductUrlKeysRequestSchema`, `productKeyResolutionSchema` (a PUT's `languageKeys`, `channelKeys` and `confirmTakeover` are each capped at 64 entries), `urlKeyTakenDetailsSchema`, `urlKeyRedirectTakeoverRequiredDetailsSchema`, `urlRedirectNotFoundDetailsSchema`, `urlKeyWriteOutcomeSchema`, `ProductUrlKeyWrite`.
  - **New port types:** `CatalogProductAvailabilityPort` (container name `catalogProductAvailabilityPort`), `CatalogProductScopeWritePort` (`catalogProductScopeWritePort`) and `CatalogProductUrlKeyReadPort` (`catalogProductUrlKeyReadPort`), owner `catalog`; `SeoProductMetaPort` (`seoProductMetaPort`), owner `seo`, with `SeoProductMetaValues`, `SeoProductMetaField`, `SeoProductMetaSource`. `catalog` provides `catalogProductAvailabilityPort`; the others are not provided yet.
  - **New error codes in `ERROR_CODES`:** `SCOPE_INVALID`, `SCOPE_INCOMPLETE`, `URL_KEY_TAKEN`, `URL_KEY_REDIRECT_TAKEOVER_REQUIRED`, `URL_REDIRECT_NOT_FOUND`.
  - **Bulk product update:** `fields.scopedStatus` (`{ channelId, languageCode | null, value: 'active' | 'inactive' | 'inherit' }`) is accepted and counts as a field; combined with `fields.status` it is refused on the `scopedStatus` path. Result reasons gain `scope_invalid` and `completeness_gate`.
  - **`CatalogProductRecord`** gains optional `publishFrom` and `publishUntil` (the global publication window); they stay optional, so record literals built without them keep compiling.
  - **`updateProductRequestSchema`** accepts optional, nullable `publishFrom` / `publishUntil` (ISO instants).
  - **`resolveScopeLanguage`** ignores a quality parameter carried with the tag (`de;q=0.9`).
  - **`CatalogQuickSearchParams`** gains optional `languageCode` (the request's language tag; absent = the channel default).
  - **`ProductAvailabilityScope.languageCode`** is `string | null` — `null` asks at the channel's default language.
  - **Quote requests:** `ADMIN_QUOTE_REQUEST_WARNING_CODES` (`PRODUCT_UNAVAILABLE_IN_SCOPE`), `adminQuoteRequestWarningSchema`, `AdminQuoteRequestWarning`.
  - **`CatalogSellableProductQuery.scope`** (optional `{ channelId, languageTag }`) and **`ResolvedSearchChannel.languages`** (optional).

- dd6deb2: **BREAKING — the product status is `active` | `inactive`, and archiving is its own action.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range.

  - **`productStatusSchema`** narrows from `draft | active | inactive` to `active | inactive`, and so do `ProductStatus`, `PRODUCT_SCOPE_STATUSES` / `productScopeStatusSchema` and the bulk `fields.scopedStatus.value` (still with `inherit`). `draft` is removed with no alias: send `'inactive'` where you sent `'draft'`.
  - **`coerceProductStatusWrite` and `productStatusWriteSchema` are removed.** Use `productStatusSchema`. The legacy `archived` write alias is gone with them: `status: 'archived'` is refused like `draft`, with `400 VALIDATION_FAILED`, on `POST` / `PATCH /api/v1/admin/catalog/products`, on the bulk update, on `POST …/products/resolve-ids` and on the API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku`.
  - **`inactive` no longer archives.** It is plain off at every scope; a status write neither sets nor clears `archivedAt`, and setting `active` never restores an archived product. To archive, call `POST /api/v1/admin/catalog/products/:id/archive` (and `…/restore` to bring it back), both behind `catalog:write`, or the bulk update with `fields: { archived: true }` (`false` restores) as the only field of the request. Each is an audited `product.archive` / `product.restore` Command; repeating one answers `200` and changes nothing.
  - **`product.archived.v1`** now means "archived by the Archive action", not "status moved to `inactive`": it is sent after `product.updated.v1` with `changedFields: ['archivedAt']`. Restore sends `product.updated.v1` with `['archivedAt']` only. A bulk-operation undo now announces every product it reverts (`product.updated.v1` with the restored fields, and `product.archived.v1` where it re-archives).
  - **Admin product list:** `counts.draft` → `counts.archived` (`counts` is `{ all, active, inactive, archived }`, the first three over products that are not archived); the `status=archived` filter → `archived=only` (`archived=exclude|include|only`, default `exclude`; `includeArchived=1` still means `include`); `status=draft`, `status=archived` or any unknown status answers `400 VALIDATION_FAILED`. `resolveProductIdsRequestSchema` gains the same `archived` mode (`productArchivedModeSchema`), whose default stays "include".
  - **New and duplicated products are `inactive`** (and a duplicate is never archived), where they used to be `draft`.
  - **`pairsTurningOn`** compares the effective status only: setting an archived product `active` turns its pairs on, and a Restore turns nothing on.
  - **`SetProductStatusParamsSchema`** (the assistant's `catalog.set_product_status`) and **`quickOrderSearchResultSchema.status`** take `active | inactive`; the assistant's status tool switches products on or off and never archives.
  - **Migration `product_status_drop_draft` (catalog).** Every product that is `inactive` at the upgrade stays archived — it keeps its `archived_at`, or gets its `updated_at` when it had none — and **needs an explicit Restore**: setting it `active` alone leaves it archived. `draft` becomes `inactive` in `products` and in both scope tables without archiving anything. The status column now refuses any other value (`products_status_check`) and defaults to `inactive`. Product-feed criteria stored with `status = draft` are not rewritten; they match nothing, as before.
  - **`errors.PRODUCT_ARCHIVED`** reads "Product is archived." / "Produkt jest zarchiwizowany.".

- 3f697a3: The assistant's product mutation tools take at most `PROMPT_PRODUCT_IDS_MAX` (10 000, the bulk product route's cap) product ids: `AssignProductsToCategoryParamsSchema`, `RemoveProductsFromCategoryParamsSchema`, `SetProductStatusParamsSchema`, `SetProductsVisibilityParamsSchema`, `ArchiveProductsParamsSchema` and `RestoreProductsParamsSchema` refuse a longer `productIds`. `PROMPT_PRODUCT_IDS_MAX` is exported. Catalog's tools treat a repeated id as one product, so its preview no longer answers 404 and it is written once; a per-product failure reported to the assistant names only an `HttpError`'s message, `failed` otherwise.
- df0a90e: A buyer's quote line is judged at the request's scope language, as a basket line is. `CreateForCustomerOptions` gains `languageTag` — the request's first `Accept-Language` tag, resolved against the channel's own languages — and `RfqService.createForCustomer`, `patchDraft` and `resubmit` ask `catalogProductAvailabilityPort` and snapshot line and unit names at it; absent, at the channel's default language. `language` is now a message language only: it used to decide the scope too, so a buyer asking in a language the message bundles do not carry (`de-DE` answered in Polish) was quoted a product switched off in that language. The customer quote routes, the basket's conversion to a quote request (`CartConversionService.convertToQuoteRequest`'s options gain `languageTag`) and the buyer's quick-order build to a quote request (`QuickOrderBuildOptions.languageTag`) pass the tag.
- 3ccf23b: An art-directed image, or a section background, can keep its mobile art up to the desktop breakpoint.

  - `@endora-commerce/contracts`: `responsiveImageSchema` and `sectionBackgroundSchema` gain an optional `desktopFrom: 'tablet' | 'desktop'` (`DESKTOP_FROM_TIERS`, `DesktopFromTier` in `page-builder-values`). Unset means `tablet`, the 768 px switch, as before.
  - `@endora-commerce/page-builder-core` re-exports `DESKTOP_FROM_TIERS` and `DesktopFromTier`. The section background field offers **Mobile image or video shown on** once a mobile image or video is set; the default stores nothing.
  - `@endora-commerce/page-builder-admin`: the responsive image field offers **Mobile image shown on** once a mobile image is set.
  - `@endora-commerce/cms-components`: `Picture` writes `(max-width: 1023.98px)` on the mobile `<source>` for `desktopFrom: 'desktop'` (new export `pictureMobileMedia`). A section background's tiled image and video pair carry `data-desktop-from="desktop"` on `.cmsc-section__media`, and `useBreakpointVideo` takes an optional third argument, `{ mobileMedia }`, the query under which the mobile video plays.
  - `@endora-commerce/mod-i18n` carries the English and Polish copy.

- 3ccf23b: `cms.Section` takes its width per breakpoint, and a custom width may be wider than the page container.

  - `@endora-commerce/contracts`: `sectionSettingsSchema.width` is `responsiveSchema(sectionWidthSchema)` (a single width still parses as it is). `SECTION_OUTSET_PX_MAX` (400, the Column's background outset limit) is exported from `page-builder-values`. A consumer reading `SectionSettings['width']` now gets `Responsive<SectionWidth>`.
  - `@endora-commerce/page-builder-core` re-exports `SECTION_OUTSET_PX_MAX`.
  - `@endora-commerce/cms-components`: the Section's **Width** moves to the Responsive tab. When the breakpoints agree, the markup is unchanged (`data-width="<width>"`); when they differ, the section carries `data-width="tiered"` and each tier's box and frame as `--cmsc-section-box-*` / `--cmsc-section-frame-*` (`-md`, `-lg`). A custom width wider than the page container now widens the section, centred, up to the viewport less the gutters; it used to be capped at the container.
  - `@endora-commerce/mod-cms` lists `width` among the Section's `responsiveFields`, with English and Polish labels.

- 3ccf23b: A CMS page can include its parent page's path in its address, for nested URLs such as `/services/consulting/workshops`.

  - `@endora-commerce/mod-cms` adds `parent_path_in_url` to `cms_pages` (migration `20261027T165458_cms_page_parent_path_in_url`, `boolean not null default false`). Off, a page keeps its flat `/<slug>`, so no stored page changes address. On, the page is served at its parent's public path, a `/` and its slug; the parent's own path follows the same rule. The path is computed on read for each sales channel from the slug that channel serves a page under, so renaming or moving a parent moves the nested pages below it; their old path stops answering.
  - `GET /api/v1/cms/pages/by-slug?slug=` takes the whole path. A nested page's own slug still resolves; its answer's `path` is the canonical address, and the storefront answers that request with a permanent (308) redirect. A parent the channel does not serve leaves the page at its own slug in that channel.
  - A save that would give two pages of one sales channel the same address — the page saved or a nested page below it — is refused with `409 CMS_SLUG_CONFLICT` (details `{ path }`), and nothing is written or audited. `parentPathInUrl` is part of the `cms_page.update` audit entry.
  - Page Builder links of kind `page` are rendered at the target's path in the request's channel. Breadcrumb links, the canonical link, `og:url` and the sitemap use the path. A write that moves a nested page's path drops every cached page answer, because other pages link to it.
  - The page editor adds _Include the parent page's path in the address_ under the parent picker, and its _Public address_ shows the resulting path.
  - `@endora-commerce/contracts`: `parentPathInUrl` on the admin page summary and detail (required in responses) and on create and patch (optional); optional `path` on `cmsResolvedPageSchema`, on each breadcrumb crumb and on `cmsPageIndexEntrySchema`; `cmsPagePublicPaths`, `CMS_PAGE_PATH_MAX_LEVELS` and `CmsPagePathNode`; optional `addressesMoved` on the page `CmsContentChange`. Code that constructs an admin page summary or detail must supply `parentPathInUrl`.

- 3ccf23b: Buttons inside blocks take the Button block's look options, and an icon-only button can be a pill.

  - `ButtonSpec` (`buttonSpecSchema`) gains optional `transparentOutline`, `borderColor` and `iconOnlyShape` (`'circle' | 'pill'`). A button saved before parses and renders as it did.
  - A hero's, a card's, a panel's, a header's or a listing's button renders them through the same `ButtonView` path as `cms.Button`, whose own block-level look options are unchanged and win over the spec's. `cms.Button` gains `iconOnlyShape`.
  - A pill is `cmsc-btn--icon-pill`, 1.15 times its height.
  - `createButtonSpecField` takes `look: false` (used for `cms.Button`); `BUTTON_LOOK_FIELDS` is exported, its labels translated once in the `core` bundle (`pageBuilder.sharedFields.button*`).

- 3ccf23b: Brand settings: a type and spacing scale for tablets and small desktops.

  The brand tokens take an optional `tierScale` with a `tablet` and a `smallDesktop` factor (0.5–2). `brandTokensToCss` then rebinds every type size and spacing step from 768 to 1023 px to the mobile value times the tablet factor, and from 1024 to 1279 px to the desktop value times the small-desktop factor. The gutters and the container are not scaled, nor are sizes a block sets in its own pixels.

  Without factors (or with 1) the CSS output is byte for byte what it was, and a stored set without `tierScale` parses as before. The **Brand** screen offers both factors in its Layout card, empty meaning 1, with English and Polish labels.

- 3ccf23b: Brand settings: desktop sizes that grow with the window, and button heights in the tier scale.

  All optional; a stored set without them parses as before and `brandTokensToCss` writes the same CSS byte for byte.

  - `tierScale.fluidDesktop` with `tierScale.fluidUntilPx` (else `layout.containerMaxPx`): from 1280 px, each desktop type size and spacing step is `clamp(<px × factor>px, <px × 100 / end>vw, <px>px)`, rising from the small-desktop factor to the full size. Needs a small-desktop factor below 1.
  - `tierScale.buttons: true` scales `--cmsb-btn-h-s|m|l` in the tablet, small-desktop and fluid blocks; icon-only and pill buttons follow.
  - The **Brand** screen's Layout card offers each one (empty or off stores nothing), with English and Polish labels.

- 3ccf23b: A CMS page can show its breadcrumb trail over its first section instead of in a band above it.

  - `@endora-commerce/mod-cms` adds `breadcrumbs_overlay` to `cms_pages` (migration `20261028T090524_cms_page_breadcrumbs_overlay`, `boolean not null default false`), so every stored page keeps its band. It is part of the `cms_page.update` audit entry, and the storefront read answers `breadcrumbs.overlay: true` only when it is on.
  - The page editor's Breadcrumbs card adds _Show the breadcrumbs over the first section_, with English and Polish labels. The storefront then draws the trail in a zero-height layer over the first section, in the brand container, painting no band, so nothing below moves down; the scheme still sets its colours. The first section's top padding is the editor's to set.
  - `@endora-commerce/contracts`: `breadcrumbsOverlay` on the admin page detail (required in responses) and on create and patch (optional); optional `overlay` on `cmsResolvedPageSchema.breadcrumbs`. Code that constructs an admin page detail must supply `breadcrumbsOverlay`.

- 774d23e: A CMS page can have its own name, slug and description in each of its languages.

  - `@endora-commerce/mod-cms` adds `translations` to `cms_pages` (migration `20261029T131218_cms_page_translations`, `jsonb not null default '{}'`): `{ "<lang>": { "name", "slug", "description" } }`. The page's own `name`, `slug` and `description` stay the default; a blank or absent field inherits it, so every stored page reads as before. An override counts only while the page has its language — removing a language keeps its overrides stored but unused. A create or patch naming a language the page does not have is refused with `400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`. `translations` is part of the `cms_page.update` audit entry, and the admin page list's search also matches it.
  - Each language is served at its own slug, and a nested page at its ancestors' slugs in that language. `GET /api/v1/cms/pages/by-slug` finds the page by its address in the requested language, then the channel's default, then any other language, then the page's own slug, and serves it in the requested language. The answer's `path` is the page's address in the served language, so a visitor who switches language is sent to the page's slug in the new one. The storefront answers a permanent (308) redirect when the address asked for differs.
  - An address is unique within one sales channel and one language: a save that would give a page, or a nested page below it, a language address another page already has is refused with `409 CMS_SLUG_CONFLICT` (details `{ path, language }`), and nothing is written or audited. One slug in two languages of two pages is allowed. Every language slug is checked against the reserved first segments.
  - A URL in a language other than the channel's default carries `?lang=<language>`, as a product URL does. The resolved page answers `url` (its canonical) and `alternates` (one `{ language, url }` per language it is served in), and its `name`, breadcrumb names and links, and Page Builder `page` links are in the served language. The storefront passes `?lang=` on as the CMS page's language, declares the alternates as `hreflang` links, marks the content with its language, and lists every language's URL in the sitemap. The CMS-backed home page `/` is unchanged.
  - The page editor adds a _Language version_ card: the name, slug, description and meta fields of the language the canvas shows, each empty field showing the inherited value, with the address in that language. Meta fields are now read and saved for every language: before, the editor read them from `en-US` whatever the page's languages and saved only the active language's, which removed the other languages' meta on the server.
  - `@endora-commerce/contracts`: `translations` on the admin page summary and detail (required in responses) and on create and patch (optional, replaced whole); `cmsPageTranslationSchema`, `cmsPageTranslationsSchema`, `cmsLocalizedPage` and `cmsPageUrl`; optional `url` and `alternates` on `cmsResolvedPageSchema` and `cmsPageIndexEntrySchema`. Code that constructs an admin page summary or detail must supply `translations`.

- 4cb0a7d: Product data scopes — checkpoint C/E/Q review fixes.

  - **Platform:** new `withSystemScopeActingFor(adminUserId, reason, fn)` in `@endora-commerce/platform/tenancy` — a worker's system scope acting for the admin who queued the work, so its Commands are audited with that admin.
  - **Catalog — audit:** a queued bulk Archive / Restore and a queued bulk scoped-status edit audit each product with the admin who requested the operation (it was a null actor). The API-key upsert `PUT /api/v1/catalog/products/by-sku/:sku` of an existing product is now the audited `product.update` Command, its entry naming the key (`apiKeyId` in the after-state); it is still never checked by the completeness gate.
  - **Catalog — Archive / Restore** lock the product row, so a concurrent single and bulk Archive transition the product once: one audit entry, one `product.archived.v1`.
  - **Catalog:** a composition that cannot build the completeness gate logs one warning instead of running unchecked silently.
  - **SEO:** the cached sitemaps are marked stale on a change of the global status, archive, visibility or organization list, and on `product.archived.v1`, as they already were on the scoped values and URL keys.
  - **Behaviour change for API clients (contracts, SEO):** an override's `ogImageUrl` must be an `http(s)` URL or a path starting with a single `/` (`ogImageUrlSchema`); `javascript:`, `data:` and other schemes are refused with `400 VALIDATION_FAILED`. The read shape accepts any stored string.
  - **Contracts:** `effectiveOrderRules` and `effectiveKeys` are documented as applying no availability — a buyer-facing caller filters with `filterAvailable` first.

- 0e33ca9: The shop's identity gains a logo and social profiles, for the storefront's `Organization` structured data.

  - `@endora-commerce/mod-settings` registers `shop.logo_asset_id` (an asset id, `''` while unset) and `shop.social_profiles` (a list of URLs, `[]` by default). Social profile URLs must be `https:`; anything else is refused with `422 VALIDATION_FAILED` and nothing is stored. The shop-info read resolves the logo to its public URL (a missing or non-public asset reads as `null`) and returns only `https:` profiles. No existing default changes.
  - **`@endora-commerce/mod-settings` now declares a dependency on `assets_library`** to resolve the logo. Both modules are non-deactivatable, so no installation changes, but a deployment that composes `settings` without `assets_library` now fails the module dependency check.
  - `@endora-commerce/contracts`: `ShopInfoSchema` gains `logoUrl` (`string | null`) and `socialProfiles` (`string[]`), both required in the response.

- f148418: The storefront probes that take a bare product id follow product data scopes per sales channel and language.

  - **Behaviour change for API clients — price and stock probes:** `GET /api/v1/storefront/products/:id/resolved-price`, `GET /api/v1/storefront/pricing/display-mode/:productId`, `GET /api/v1/storefront/inventory/stock/:id` and both notify-when-available routes (`POST /api/v1/storefront/inventory/notify-when-available`, `POST /api/v1/catalog/products/:id/notify-when-available`) answer only about a product available at the request's channel and language to the caller now. A product that is switched off there, outside its publication window, sold on another channel or outside the channel's audience rule gets each route's existing `404`, the same body an id nobody sells gets; a notify-when-available request for such a product can no longer reach `409 PRODUCT_UNMANAGED_STOCK` or `422 PRODUCT_IN_STOCK`.
  - **Composition:** `price_lists`' plugin options and `inventory`'s plugin options take `catalogAvailability` (`catalogProductAvailabilityPort`), required; `AvailabilityNotificationService` takes it in place of the sales-channel membership port, and `SubscribeInput` gains `languageTag`.
  - **Caching:** `markPersonalisedPricing` now marks every response for an authenticated caller `private, no-store`, not only one naming an organisation; `GET /api/v1/catalog/filters` and `GET /api/v1/catalog/categories` call it, since their counts and tree follow the caller's audience. Anonymous responses stay unstamped.
  - **Product page:** an archived product answers `410` only where it would be available with the archive taken away; otherwise (switched off in that channel or language, outside its window) it answers the absent product's `404`.
  - **Buyer seams name their channel:** `CreateForCustomerOptions.salesChannelId` (and the draft-edit and resubmit options) carry the channel the buyer's route resolved; quick order's pasted-SKU lookup takes it too; the basket asks availability at its own channel. The audience-only answer remains only for callers outside a request.
  - **Helpers:** `@endora-commerce/contracts` exports `toScopeChannel`, `scopeLanguageOf` and `firstLanguageTag`. `BundleService.validateConfiguration` requires its availability filter.

- 8ef189b: Per-administrator Admin UI preferences (feature 164).

  - **New `admin-preferences` exports.** `ADMIN_PREFERENCE_KEYS` — the closed set `sidebarPins`, `sidebarCollapsedGroups`, `sidebarRailMode`, `listPageSizes`; the write schemas `adminPreferencesPatchSchema` (strict: an unknown preference, a wrong shape, a duplicate or a value beyond a bound is refused) and `adminPreferencesLegacyImportSchema`; the tolerant read schema `adminPreferencesSchema`, `adminPreferencesResponseSchema` and `ADMIN_PREFERENCES_DEFAULTS`; the bounds `ADMIN_SIDEBAR_PINS_MAX` (200), `ADMIN_SIDEBAR_COLLAPSED_GROUPS_MAX` (32) and `ADMIN_LIST_PAGE_SIZES_MAX` (128); `ADMIN_PINNED_GROUP_KEY` (`'pinned'`, deliberately not an `AdminNavSectionName`).
  - **`ADMIN_LIST_PAGE_SIZE_OPTIONS`** (`[5, 10, 20, 50, 100, 500]`) and `ADMIN_LIST_PAGE_SIZE_DEFAULT` (20) now live here, so the server validates a page size against the same array the Admin UI offers. `@endora-commerce/admin-kit`'s `PAGE_SIZE_OPTIONS` is this array, re-exported.
  - **`adminMeResponseSchema` gains `preferences`** — the signed-in admin's own document, or `null` when the server could not read it. A consumer that ignores the field is unaffected; a consumer that parses `/admin/me` with the schema now requires the key.

- 4bc5c7f: Asset references can now say who may see them (`specs/166-asset-reference-visibility/`).

  - `AssetReferenceDescriptor.findReferences(assetIds)` returns `AssetReferenceHit[]`: an `AssetReference` plus the `assetId` it points at. A descriptor that still returns plain `AssetReference[]` compiles and is answered correctly, but the registry then asks it one asset at a time wherever it must attribute a batch — tag your hits.
  - New optional, readonly data property `AssetReferenceDescriptor.readerRestriction` (`AssetReferenceReaderRestriction`): `visibleEntityIds(entityIds)`, `assetIdsWithHiddenReferences()` and `allReferencedAssetIds()`. Absent, the references never hide an asset; present, a library reader who may see none of the records using an asset does not see the asset.
  - `AssetReadPort` gains the **required** method `visibleToCaller(assetIds)`: which of the ids the ambient caller may see in the asset library (missing, hidden and non-uuid ids are all absent). A test double or an alternative implementation of the whole port must add it; one that picks methods (`Pick<AssetReadPort, …>`) is unaffected.

- eba4fd8: A quote's validity date now binds order placement, not only the conversion into a basket (issue #167). A basket line filled by `convert-to-order` names its quote (`CartItemRecord.quoteRequestId`, column `cart_items.quote_request_id`, backfilled from the basket's `source_quote_request_id`), and placement refuses every line still priced at its agreement with `410 QUOTE_VALIDITY_ENDED` once that quote's `expiresAt` has passed (`details.code: 'lapsed'`), once it no longer applies — re-opened, cancelled, expired or gone (`'withdrawn'`) — or while `quote_requests` is off and nothing can confirm the prices (`'unavailable'`, fail-closed; this used to place the basket at the agreed prices). The order-total preview answers the same verdict as `quoteCommitmentRefusal` (`quoteCommitmentRefusalSchema` in `@endora-commerce/contracts`), `null` when nothing is refused. `QUOTE_VALIDITY_ENDED` declares the three reasons as refusal tokens, with sentences in English and Polish.
- 61fc321: The storefront language is part of the URL path (`/pl/p/wiertarka`, `/en/p/drill`, issue #396).

  **Upgrade note for operators: existing sales channels keep their addresses.** The migration
  `Migration20261029T152922CoreSalesChannelsPrefixDefaultLanguage` adds the per-channel setting
  _Prefix the default language in URLs_ and switches it **off** on every channel that exists when it
  runs, so default-language URLs stay unprefixed; channels created later start **on**. To adopt
  prefixes for the default language too, switch _Prefix the default language in URLs_ on in
  _Sales channels_ → the channel. Other languages are prefixed either way: a former
  `/p/<key>?lang=<L>` link answers a permanent redirect to `/<prefix>/p/<key>`. A CMS page whose slug
  starts with a channel language prefix can no longer be saved.

  `@endora-commerce/contracts`:

  - New: `channelUrlLanguages`, `channelUrlLanguageAliases`, `storefrontPagePath`,
    `storefrontPagePathFor`, `storefrontDefaultPath`, `channelUrlLanguageSchema`,
    `channelUrlLanguageAliasSchema`, `URL_LANGUAGE_PREFIX_PATTERN`, types `ChannelUrlFacts`,
    `ChannelUrlLanguage`, `ChannelUrlLanguageAlias`; `productDefaultPath(key)`.
  - **`productPath` takes the channel's URL facts and never appends `?lang=`:**
    `productPath({ key, languageCode, channelDefaultLanguage })` (`/p/drill?lang=en-US`) becomes
    `productPath({ key, languageCode, channel })` (`/en/p/drill`), where `channel` is any
    `{ languages, defaultLanguage, prefixDefaultLanguage }` — the cached channel satisfies it.
  - `productKeyResolutionSchema`'s `redirect` requires `permanent` (`false` for a key of another
    channel language, answered 307); `productPagePathsSchema` requires `xDefault`.
  - Sales channel shapes carry `prefixDefaultLanguage` (create defaults to `true`); the public
    channel read answers `prefixDefaultLanguage`, `urlLanguages` and `urlLanguageAliases`.
  - `cmsPageUrl` (163 R24) takes the channel's URL facts and composes the prefixed path:
    `cmsPageUrl({ path, languageCode, channelDefaultLanguage })` (`/about-us?lang=en-US`) becomes
    `cmsPageUrl({ path, languageCode, channel })` (`/en/about-us`). The resolved CMS page's `url` and
    `alternates`, and the storefront page index, therefore carry each language's own slug under its
    prefix.
  - `CmsPageRecord` gains optional `languages` and `translations` (the `seo` sitemap lists each
    language at its own slug); `cmsPageSummarySchema` gains an optional
    `shadowedByLanguagePrefix` (any of the page's slugs, per-language ones included).

  Emitters (catalog, seo sitemap, product feeds, organizations, customers, newsletter, comparisons,
  mfa, invoices) compose prefixed storefront URLs; the product feed `link` uses the product's key in
  the feed language; the invoice e-mail links the storefront order page; the admin password reset
  links `/password-reset/confirm`. `cms-components` localizes block links through the render
  context's `localizePath`.

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

- ecdd2f7: A **Contact form** Page Builder block (`cms.ContactForm`) that e-mails a visitor's message to the shop and stores nothing.

  - **Block:** a fixed field set the server knows — name (shown by default), e-mail and message (always), phone, company, subject and a select with editor-defined options (on request), a required privacy consent and an optional marketing consent, both with inline rich labels. Per field: show, label, placeholder, required, and its width with two columns. Layout and look are presets: one or two columns, field look `boxed` / `underline` / `pill` from the colour scheme, label above or visually hidden, the submit button through the existing button look (no link) with its alignment, and editable "sent", "not accepted" and "unavailable" messages. Posts to the storefront's `/forms/contact` and works without JavaScript; with JavaScript it checks itself and shows the outcome inline. Unset words read the page language's defaults through the new optional `contactFormText` render-context entry.
  - **`ButtonView`:** an additive `type="submit"` rendering (a `<button type="submit">` with the same classes) and `disabled`; every existing rendering is unchanged.
  - **Endpoint:** `POST /api/v1/storefront/cms/contact-form` (public, rate limited to 10 submissions per client address in 10 minutes, honeypot field `website`) sends one e-mail per recipient through the platform mailer, Reply-To the visitor, written in the channel's default language, with a fixed subject and no `meta`, so nothing typed reaches the delivery record. Answers `400 VALIDATION_FAILED`, `409 CMS_CONTACT_FORM_UNAVAILABLE` (new error code: no recipients on the channel), `429`, `500`, and `503` with `cms` off.
  - **Setting:** `cms.contact_form_recipients` (`string_list`, per sales channel, group "Contact form", at most 10 valid addresses, refused otherwise), with the palette action `open-contact-form-settings`. `cms` now depends on `email` and `_i18n` (both non-deactivatable).
  - **Contracts:** `contactFormSubmissionSchema`, `contactFormSubmissionResponseSchema`, `contactFormEmailSchema`, `CONTACT_FORM_LIMITS`, `CONTACT_FORM_MAX_RECIPIENTS` and `ERROR_CODES.CMS_CONTACT_FORM_UNAVAILABLE`.

- ecdd2f7: `EmailMailerSendInput` gains an optional `replyTo`. The SMTP driver sends it as the `Reply-To` header and the console driver logs it beside the recipient; the recording mailer passes it to the transport and does not write it to the delivery record. Absent, every message is sent exactly as before.
- b7baf8a: Admin order creation, one-click buy and the external order intake no longer empty and close the
  customer's active basket (issue #169). They place the order from a separate **working basket**
  written from the request's lines, through the same `placeOrder`; the customer's basket — one
  filled from an accepted quote request included — is left exactly as it was, whether the order is
  placed or refused.

  - **`@endora-commerce/contracts`** — `CartWritePort.addItems`' option `replaceExisting` is
    replaced by `workingBasket`. Old: `addItems(actor, lines, { onLineError: 'throw', replaceExisting: true })`
    emptied the active basket and wrote the lines into it. New:
    `addItems(actor, lines, { onLineError: 'throw', workingBasket: true })` writes them into a new
    cart in status `working` and returns it; the active basket is not touched. Pass the returned
    `cart.id` as `OrderPlacementPort.placeOrder`'s new option `workingBasketId` to place from it.
    `cartStatusSchema` gains `'working'`.
  - **`@endora-commerce/mod-carts`** — migration `cart_status_working` widens `carts_status_check`
    to `working`. `CartPlacementApplyPort` gains `readWorkingForPlacement(em, ctx & { cartId })` and
    `discardWorkingBasket({ cartId, customerAccountId })`; an implementation of the port has to
    provide both. A working basket ends `completed` with `completed_order_id` set, or is deleted
    when the placement is refused; it is never listed (admin carts list, organization carts list,
    the customer's carts panel) and never swept.
  - **`@endora-commerce/mod-orders`** — `OrderService.placeOrder` accepts `workingBasketId`; admin
    order creation and the external intake place from a working basket.
  - **`@endora-commerce/mod-quick-order`** — one-click buy places from a working basket.

- 56e237d: A product feed publishes a sub-cent unit price as the exact price of a pack instead of rounding it (issue #430).

  - **Behaviour change.** A price with a third or fourth significant decimal place (0.0125) was written rounded to two (0.01), against a product page showing 0,0125 zł. It is now published as the price of N units — N the smallest of 10, 100, 1 000, 10 000 that makes it exact (0.0125 → 100 at 1.25; a gross feed publishes the gross of that pack's net) — with N in the template's pack fields. A template with no `pack_quantity` field leaves the item out with the run issue `sub_cent_price_without_pack_field`; a price needing a pack above 10 000 with `sub_cent_price_beyond_pack_limit`. A price with two decimal places is published byte for byte as before.
  - **`feedFieldSourceKindSchema`** (contracts) gains `pack_quantity`, `pack_unit_pricing_measure` and `pack_unit_pricing_base_measure`; **`feedRunIssueReasonSchema`** gains `sub_cent_price_without_pack_field` and `sub_cent_price_beyond_pack_limit`.
  - **The predefined Google Merchant Center template** binds them to `g:multipack`, `g:unit_pricing_measure` and `g:unit_pricing_base_measure`, after `g:sale_price`; migration `Migration20261025T145041ProductFeedsGoogleTemplatePackFields` adds them to an installed template.
  - **Resolver SPI**: `FeedItemPrice.taxRatePercent: number | null` (required) and `ResolveFeedItemInput.templateFields` (optional, the whole template when `fields` is one field). New `feedPackQuantity` / `MAX_FEED_PACK_QUANTITY` in `services/feed-pack.ts`.

- d50b874: A discount that is real but rounds to no cent is no longer shown as 0,00 (issue #430).

  - **`DocumentValue`** (contracts): a `money` value may carry `belowMinorUnit: true`. `formatDocumentValue` prints it as `DOCUMENT_BELOW_MINOR_UNIT_TEXT` ("—"), and `sumDocumentValues` keeps the mark while the sum is zero.
  - **Quote document** (quote_requests): `lineDiscount` and `discountTotal` carry the mark when a line has a unit discount but its rounded line discount is 0.00, so the PDF prints "—"; the amount stays 0, so list value − discount = net.
  - **Admin quote screen** (quote_requests): the _Difference_ column keeps a difference of unit prices at four places (`referenceDifference(...).amount`) and shows its significant places (`RfqNumberFormat.signedUnitAmount`), instead of rounding it to 0.00.

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

- c73366c: `ModuleActionSchema` gains an optional `keywordsKey` and `emailVariableDescriptorSchema` an optional `sampleValueKey` (issue #560). Both are translation keys relative to the declaring module's namespace, the same form as `labelKey`, so a manifest keeps its `keywords` and `sampleValue` in English and carries the other languages' words in its own `i18n/<lang>.json`. A `keywordsKey` bundle value is a comma-separated list; the new `parseBundleKeywords(value)` export reads it. `AdminActionView.keywords` — the `GET /api/v1/admin/admin-actions` row — is now the manifest's `keywords` followed by the words the action's `keywordsKey` resolves to in the requested language, de-duplicated. A manifest that declares neither field parses and behaves exactly as before.
- b25d8be: A blog post's related products are shown as product cards priced for the viewer (issue #590).

  - **`@endora-commerce/contracts`** — `productListQuerySchema` gains an optional `ids`
    (`productListIdsSchema`: a comma-separated list of distinct uuids, at most
    `PRODUCT_LIST_MAX_IDS` = 24). `blogResolvedPostSchema` gains an optional `relatedProductIds`:
    the post's related products by id, in the editor's order, with no price. Additive; a payload
    without either still parses.
  - **Deprecated, removed in a later minor:** `blogProductCardSchema`, the `BlogProductCard` type and
    `blogResolvedPostSchema.relatedProducts`. No shipped composition ever filled them, and their
    `price` could not be a correct one: the post payload is cached per channel and language for
    every visitor. Read `relatedProductIds` and fetch the products from
    `GET /api/v1/catalog/products?ids=…` as the viewer instead.
  - **`@endora-commerce/mod-catalog`** — `GET /api/v1/catalog/products?ids=<id>,<id>` restricts the
    listing to the named products: the subset the viewer may see, priced like any listing card for
    that viewer, in the listing's order, always from PostgreSQL. More than 24 ids or a value that is
    not a uuid is `400 VALIDATION_FAILED`.
  - **`@endora-commerce/mod-blog`** — the storefront post payload carries `relatedProductIds`.
    `BlogStorefrontDeps.resolveProductCard` is deprecated: nothing reads what it produces any more,
    and it is removed in a later minor.

- 1fd4822: The audit-log row type inferred from `auditLogEntrySchema` is now `AuditLogEntryResponse`, in line with the package's `…Response` suffix for API shapes. `@endora-commerce/platform/kernel` publishes `AuditLogEntry` as the MikroORM entity of an `audit_logs` row, so a consumer importing both packages met two different declarations under one name (issue #84).

  **Deprecation:** `AuditLogEntry` is still exported from `@endora-commerce/contracts` as a `@deprecated` alias of `AuditLogEntryResponse`, and is removed in the next minor release. Replace `import type { AuditLogEntry } from '@endora-commerce/contracts'` with `import type { AuditLogEntryResponse } from '@endora-commerce/contracts'`; the shape is unchanged. `auditLogEntrySchema` keeps its name.

- 0f5bcde: The new-organization notification is no longer Polish on every installation.

  - `@endora-commerce/contracts` exports `supportedLanguageOf(tag)`: the shipped language
    (`'en'` or `'pl'`) a BCP-47 tag such as a sales channel's `defaultLanguage` is written in,
    `LANGUAGE_FALLBACK` for any other.
  - `mod-organizations`: the admin bell entry recorded when an organization registers carries an
    English `title`/`body` and a `titleMessage`/`bodyMessage` key, so each administrator reads it
    in their own language (a Polish administrator sees the same text as before). The fallback
    e-mail sent when no `new_org_registration` template is defined, and the `statusLabel`
    variable passed to that template, are written in the system-default sales channel's
    language from the module's bundle, English when the bundle cannot answer. On a channel whose
    default language is Polish the e-mail is unchanged. New bundle keys:
    `notifications.newRegistration.*`. `OrgRegistrationNotifier` takes two optional
    dependencies, `translate` and `resolveLanguage`.

- c72a83e: A bulk operation's log trail is readable in each administrator's language.

  - `@endora-commerce/contracts`: `bulkOperationLogEntrySchema` gains an optional `messageKey`
    (`{ key, params? }`, a key in `catalog`'s bundle and the values that fill it) beside
    `message`, which stays the finished English sentence.
  - `mod-catalog`: new log entries store `messageKey` and an English `message` where they stored
    a Polish sentence; the bulk-operations detail screen draws the key in the reader's language
    and falls back to `message` — so entries written before this release still show as they
    did. A Polish reader sees the same sentences as before. New bundle keys:
    `bulkOperations.log.*`.

- ed85493: `adminNotificationRecordPort` gains `recordWithin(em, input)`, a co-transactional twin of `record`: the bell entry is created and persisted on the **caller's** EntityManager, with no fork and no flush, so it commits or rolls back with the caller's transaction (`specs/165-task-management/` SC-004 — a Task reminder's delivery row and its bell entry are one write, which makes the bell exactly once). It refuses what `record` refuses, before anything is persisted; the recipient's older entries are pruned by their next `record`. `record(input)` is unchanged.

  `AdminNotificationRecordPort` now takes a type parameter, `AdminNotificationRecordPort<EM = unknown>`, the caller's MikroORM `EntityManager` (the contracts hold no `@mikro-orm` import). Existing consumers that only call `record` compile unchanged; a test double typed as the port must add `recordWithin`.

- 3174251: The cart-view schemas describe what the cart routes answer (issue #128).

  Parsing real replies of `GET /api/v1/cart`, `GET /api/v1/cart?view=mini` and the line mutations (`POST`/`PATCH`/`DELETE /api/v1/cart/items…`) with the published schemas failed on every one of them. Nothing on the wire changed; the schemas were widened to it, and no schema was narrowed — every value that parsed before parses now.

  - **`cartFullPayloadSchema`** — `createdAt`, `updatedAt` and `lastActivityAt` are `string | null`: the empty basket (no basket yet, `id: null`) answers `null` for all three.
  - **`cartViewLineSchema`** — `productName` is `string | null`: the line-mutation replies do not resolve product names and answer `null`. `productThumbnailUrl` is optional: no cart route has ever answered it.
  - **`cartMiniPayloadSchema`** — `status`, `approvalStatus`, `grandTotal` and `primaryCta` are optional: the mini view has never answered them (it skips the coupon and promotion work on purpose). It now declares the **`subtotal`** it does answer (optional, so older values still parse).
  - **`cartMiniLineSchema`** — declares the **`variantId`** every mini line carries; `productName` and `productThumbnailUrl` are optional, because the mini view does not answer them.

  Upgrading: the inferred types `CartFullPayload`, `CartViewLine`, `CartMiniPayload` and `CartMiniLine` change accordingly. Code that read one of the fields above as always present was reading `null` or `undefined` at run time already; the compiler now says so. Read `grandTotal`, `status` or `primaryCta` from the full view, not the mini one.

- 55864a1: Task management (`specs/165-task-management/`). **Breaking** for consumers of the Tasks shapes — a minor in the `0.x` series.

  - **Statuses are codes of a configurable workflow.** `TASK_STATUSES`, `taskStatusSchema`, `TaskStatus` and `TASK_CLOSED_STATUSES` are removed. Use `taskStatusCodeSchema` (any snake_case code), `TASK_DEFAULT_STATUS_CODES` (the four seeded codes), `TASK_STATUS_CATEGORIES` / `taskStatusCategorySchema` (`open`, `done`, `cancelled`) and `TASK_CLOSED_STATUS_CATEGORIES` / `isClosedTaskStatusCategory`. Before: `TASK_CLOSED_STATUSES.includes(task.status)`; after: `task.closed` on `TaskSummary`, or `record.closed` on `TaskRecord`.
  - **A Task has a list of assignees.** `TaskSummary.assignee` becomes `assignees: TaskAssignee[]`; `TaskSummary.status` becomes `{code, name, color, category}` with `closed: boolean` beside it. `TaskRecord.assignedAdminUserId` becomes `assigneeIds: string[]`, and `TaskRecord` gains `statusCategory`, `statusName`, `statusDefaultName`, `statusColor`, `closed`, `dueAt`, `draft`, `private` and `updatedAt`. `NewContextTask.assignedAdminUserId` becomes `assigneeIds`, and it gains `sourceKey` (≤ 100 characters; a key already present in the context is not created again) and `contextGroupId`; `NewContextTaskSchema` validates it.
  - **Events.** `tasks.task.assigned.v1` (`TaskAssignedEvent`, `TASKS_EVENTS.ASSIGNED`) is replaced by `tasks.task.assignees_changed.v1` (`TaskAssigneesChangedEvent {taskId, added, removed}`, `TASKS_EVENTS.ASSIGNEES_CHANGED`). `TaskCreatedEvent.assignedAdminUserId` becomes `assigneeIds`; `TaskStatusChangedEvent.from`/`to` are codes and it gains `toCategory`.
  - `TaskContextDescriptor` gains an optional `existingContexts(ids)`, asked only under the system actor by the Tasks maintenance pass; a contributor without it is never cleaned up.
  - New request and response schemas for the Tasks admin API: list sorting and filters (`TaskListQuerySchema` — with `cardValues` for a board lane's further cards —, `MyTasksQuerySchema`, `TaskBoardQuerySchema`), `TaskStatusChangeBodySchema`, comments, attachments, record links, reminders, lookups, workflow statuses and transitions, priorities, tags, board card fields, the time zone and the daily digest, with the limits `TASK_ASSIGNEES_MAX`, `TASK_TAGS_MAX`, `TASK_HIERARCHY_DEPTH_MAX`, `TASK_STATUS_REASSIGN_MAX`, `TASK_ATTACHMENT_MAX_BYTES`, `TASK_REMINDER_GRACE_MS` and `TASK_REMINDERS_MAX`. `UpdateTaskBodySchema` no longer accepts `status`: a status change goes through `POST /tasks/:id/status`. `TASKS_ERROR_CODES` gains seventeen codes.
  - The shared reference grammar gains `opportunity` and `project`: `RECORD_REFERENCE_TYPES` and `RECORD_DOCUMENT_KINDS` (now `order`, `quote_request`, `task`, `opportunity`, `project`). A text holding `[[opportunity:<uuid>]]` or `[[project:<uuid>]]` now extracts them; a consumer with an exhaustive map over the types needs two entries.
  - `OpportunityReadPort` and `ProjectReadPort` gain `findByIds(ids)` and `search({q, limit})` (with `OpportunitySearchQuery`, `ProjectSearchQuery` and a limit of 20). An implementation of either port must add both.
  - `supportedEntityTypeSchema` gains `'task'`; `assetReferenceKindSchema` gains `'task_attachment'` (a file attached to a Task, named when the asset library refuses to delete it).
  - `ERROR_CODES` gains `TASK_PRIORITY_UNKNOWN`, `TASK_TAG_UNKNOWN`, `TASK_TAG_NAME_TAKEN`, `TASK_ATTACHMENT_REFUSED`, `TASK_WORKFLOW_INVALID`, `TASK_STATUS_IN_USE_TOO_MANY`, `TASK_VIEW_NAME_TAKEN`, `TASK_PARENT_CYCLE`, `TASK_HIERARCHY_TOO_DEEP`, `TASK_LINK_INVALID`, `TASK_REMINDER_INVALID`, `TASK_PRIVATE_ASSIGNEE` and `TASK_ALREADY_PUBLISHED`.
  - `createTaskSavedViewRequestSchema` and `updateTaskSavedViewRequestSchema` in `saved-list-views.ts`.
  - Admin preferences gain `listViewModes`: `{[listId]: 'list' | 'board'}`, merged per list, `null` forgetting a list; the read side falls back to `{}`. `ADMIN_LIST_VIEW_MODES`, `adminListViewModeSchema`, `ADMIN_LIST_VIEW_MODES_MAX`.
  - `TaskAssigneeLookupQuerySchema` gains `contextType` and `contextId`, both or neither (#506).

- 11b0eb8: The contract surface of the new `tasks` and `projects` modules, one shared reference grammar,
  and a new sidebar section.

  **`@endora-commerce/contracts`** gains, exported from the package root:

  - `tasks.ts` — the Tasks admin API schemas (`TaskListQuerySchema`, `CreateTaskBodySchema`,
    `UpdateTaskBodySchema`, `TaskSummarySchema`, `TaskDetailSchema`, `TaskContextSchema` and their
    siblings, with inferred types), `TASKS_EVENTS` and the event payload types, `TASKS_ERROR_CODES`,
    and the interfaces another module uses: `TaskReadPort`, `TaskWritePort`,
    `TaskContextRegistryPort` with `TaskContextDescriptor`;
  - `projects.ts` — the Projects admin API schemas (`ProjectListQuerySchema`,
    `CreateProjectBodySchema`, `CloseProjectBodySchema`, `ProjectTemplateBodySchema`,
    `ProjectAnalyticsQuerySchema`, `ProjectDetailSchema` and their siblings), `PROJECTS_EVENTS` and
    the event payload types, `PROJECTS_ERROR_CODES`, and `ProjectReadPort`,
    `ProjectStageGuardRegistryPort` with `ProjectStageGuard`;
  - `record-references.ts` — the `[[<type>:<uuid>]]` reference grammar under neutral names
    (`recordReferenceTypeSchema`, `formatRecordReferenceToken`, `extractRecordReferenceTokens`,
    `splitRecordReferenceText`, `mentionedAdminUserIds`, `RecordReferenceSchema`), the `@@` lookup
    answer `RecordDocumentLookupResponseSchema`, and the shared `RecordHistoryPageSchema`;
  - `record-rich-text.ts` — the formatted-text grammar (`parseRecordRichText`,
    `formatRecordRichText`, `recordRichTextToPlain`, `isSafeRecordRichHref`).

  `ERROR_CODES` gains the codes the two modules raise — `TASK_NOT_FOUND`, `TASK_CONTEXT_INVALID`,
  `TASK_ASSIGNEE_INVALID` and the `PROJECT_*` codes of `PROJECTS_ERROR_CODES`.

  **`AdminZoneNameSchema` has a new member, `'task.detail.after'`**, with its props
  `TaskDetailZoneProps { taskId }` in `AdminZonePropsMap` — the zone a Task's screen mounts after its
  content. A consumer that switches exhaustively over `AdminZoneName` gets a compile error until it
  handles the new member.

  **The reference grammar reads five types where it read three**: `quote_request` and `task` join
  `product`, `order` and `admin_user`. Every CRM name — `opportunityReferenceTypeSchema`,
  `formatOpportunityReferenceToken`, `extractOpportunityReferenceTokens`,
  `splitOpportunityReferenceText`, `OpportunityReferenceSchema`, `parseOpportunityRichText` and the
  rest of `crm.ts` §9 and `crm-rich-text.ts` — is still exported, now as an alias of the shared
  one. A text stored before reads as it did. A consumer that switches exhaustively over
  `OpportunityReferenceType`, or indexes a `Record` by it, gets a compile error until it handles
  the two new members.

  **`assetReferenceKindSchema` has a new member, `'project_attachment'`** — a file a Project
  uses, which the media library then refuses to delete. A consumer that switches exhaustively over
  `AssetReferenceKind` gets a compile error until it handles the new member.

  **`AdminNavSectionNameSchema` has a new member, `'work'`**, and `@endora-commerce/admin-shell`
  declares the section after _CRM_, labelled "Projects & tasks" / "Projekty i zadania"
  (`appShell.section.work` in `@endora-commerce/mod-i18n`). It renders only while a module
  contributes a visible entry to it. A consumer that switches exhaustively over
  `AdminNavSectionName` gets a compile error until it handles the new member.

- b8b6eed: An Opportunity's texts follow the reference standard shared with Projects: `@@` is one document
  list — Orders · Quote requests · Tasks — and a Quote Request or a Task can be referred to in the
  description, a note or a message. The Opportunity's screens are drawn with the admin kit's
  collaboration components, and the screen ends with a zone other modules can fill.

  **`@endora-commerce/mod-crm`**:

  - **`@@` opens the document list**, where it searched the Organization's Orders alone. _Insert
    document_ replaces _Insert order_. Orders and Quote Requests are the Opportunity's
    Organization's (on the create form, the Organization chosen there); Tasks are any the reader
    may see. Each group is offered only to a holder of `orders:read`, `rfqs:handle` or `tasks:read`
    respectively, and only while its module is on; a role holding none of the three keeps `@@` as
    typed.
  - **`[[quote_request:<uuid>]]` and `[[task:<uuid>]]` are stored and resolved** like the other
    three types: `references` names a Quote Request by its number (`/quote-requests/<id>`) and a
    Task by its number (`/tasks/<id>`), and answers `available: false` without a label for a reader
    without `rfqs:handle` / `tasks:read`, for a Task its context hides, for a target that is gone,
    and while Quote Requests / Tasks are switched off. Texts stored before are unchanged byte for
    byte, and read as they did.
  - New route `GET /api/v1/admin/crm/lookups/documents?opportunityId=…&q=…` (`crm:write`; or
    `organizationId=…` before the Opportunity exists) answering `RecordDocumentLookupResponse`, at
    most ten documents per group — the shape Projects serves at `GET /projects/lookups/documents`.
  - New migration `crm_opportunity_reference_documents`: the `crm_opportunity_references`
    target-type check admits `quote_request` and `task`. Its `down` deletes the rows of those two
    types first; the texts keep their tokens.
  - A new `degrades-without` edge on `tasks` (`taskReadPort`): with Tasks off or absent, Task
    references read as unavailable and Tasks are not offered after `@@`. Tasks stays switchable
    while CRM is on.
  - Notes, messages, references, attachments, the change history and the list pager are drawn with
    the `@endora-commerce/admin-kit/components` collaboration components; apart from `@@` above,
    what these screens show and do is unchanged. The package no longer declares `@tiptap/react` or
    `@tiptap/starter-kit` — the editor is the kit's. A chip's token attribute is now
    `data-reference-token` (was `data-crm-token`), and an Order chip's `data-order-reference` (was
    `data-crm-order-reference`); a chip copied from the earlier editor still pastes as a chip.
  - The Opportunity's screen mounts the `opportunity.detail.after` zone once, after the card
    holding its tabs, handing over the Opportunity's id and nothing else. With nobody contributing
    — no module, one that is switched off, or a person without the contribution's permission — the
    screen is unchanged. CRM names no contributor; the first is the Projects module's _Project_
    panel.

  **`@endora-commerce/contracts`**:

  - `OpportunityDocumentLookupQuerySchema` (`opportunityId?`, `organizationId?`, `q?`) and its type,
    the query of the new route; the answer is `RecordDocumentLookupResponseSchema`.
  - `AdminZoneNameSchema` gains `'opportunity.detail.after'`, with its props
    `OpportunityDetailZoneProps { opportunityId }` in `AdminZonePropsMap`. A consumer that switches
    exhaustively over `AdminZoneName` gets a compile error until it handles the new member.

- 2aa2c9b: _Project_ is a record type of Custom Fields: an operator defines fields on Projects on
  `/custom-fields` as on Opportunities, and the Projects module validates, stores and shows them.

  **`@endora-commerce/mod-custom-fields`**:

  - New entity type `project` (_Project_ / _Projekt_), owned by the `projects` module: offered on
    the entity-types listing, and its definitions created, changed or deleted, only while Projects
    is on — while it is off the type is absent and a definition write answers 409
    `CUSTOM_FIELD_HOST_MANAGED`, as for the other owned types. Definitions and stored values are
    kept and served again when Projects is back.
  - A Project definition may be marked as a list filter; no carry targets.
  - The values live in `projects.custom_field_values`; the definition-change guards and the
    list-filter condition read that column.

  **`@endora-commerce/contracts`**:

  - `supportedEntityTypeSchema` gains `'project'`. A consumer that switches exhaustively over
    `SupportedEntityType`, or holds a `Record<SupportedEntityType, …>`, gets a compile error until
    it handles the new member.

- 883d192: TOTP enrolment shows a QR code, and a second-factor code admits exactly one sign-in (`specs/166-mfa-totp-hardening/`).

  - `mfaSetupResponseSchema` gains `qrSvg`: every setup answer — `POST /api/v1/account/mfa/setup`, `POST /api/v1/admin/account/mfa/setup` and the set-up ticket's `begin` — carries the QR code of `otpauthUri` as an SVG document, drawn on the server. Render it as an image (a `data:image/svg+xml` URI), not as HTML. The Admin UI's Account security shows it beside the manual key.
  - `@endora-commerce/mod-mfa` gains the peer `uqr` (MIT, no dependencies); an instance's `backend` declares it.
  - The TOTP replay guard and the recovery-code spend are each one conditional `UPDATE`: the same valid code sent on several sign-in challenges at once used to be accepted by each of them, and is now accepted once. No migration.

- 5114576: An invoice's `paidTotal` deducts every refund made before it was issued, each once: what `payments` recorded, plus the issued refunds of the order's settled returns that never pass through `payments` — a credit-limit top-up, and a money refund of an order not paid through a gateway — and an order an operator marked `refunded` counts as refunded everything received — its total with nothing captured, what was captured otherwise — taken as the larger of the recorded refunds and what was received, never their sum. An order refunded in full that way is not invoiced (`422 INVOICE_ORDER_REFUNDED`). `@endora-commerce/mod-returns` publishes the new `returnRefundReadPort` (`ReturnRefundReadPort`, `OrderReturnRefund` in `@endora-commerce/contracts`), which `@endora-commerce/mod-invoices` reads as a `degrades-without` dependency.

  `InvoiceDetail.amountDue` is now `max(0, grossTotal − paidTotal)` and never negative, and the new required `InvoiceDetail.overpayment` is `max(0, paidTotal − grossTotal)`. The invoice PDF's totals block prints it as _Nadpłata_ (`showOverpayment`, `labelOverpayment`), the admin invoice screen as _Overpayment_, and `{{var invoice.overpayment}}` is a new merge field. A consumer that built an `InvoiceDetail` by hand adds the field.

- 8f7c38e: A reporting time zone: the setting `analytics.reporting_time_zone` (_Reporting time zone_, in the
  _Analytics_ section of the settings screen) is the calendar reports count days in — a range of days
  runs from midnight of its first day to midnight after its last, in that zone. Default `UTC`. It
  belongs to `@endora-commerce/mod-analytics` rather than to a reporting module, so that any report
  can read it: Projects analytics does, CRM is to follow. Other modules read it through the gated
  port `reportingTimeZonePort` and count in `UTC` while Analytics is switched off. A write of a zone
  the runtime does not know is refused with `422` `VALIDATION_FAILED`. `@endora-commerce/contracts`
  exports the code as `ANALYTICS_REPORTING_TIME_ZONE_SETTING`, the port as `ReportingTimeZonePort`
  and the check as `isIanaTimeZone`. `mod-analytics` now declares `settings` as a dependency and
  `zod` as a peer.

### Patch Changes

- d2acc82: `adminAttributeResponseSchema.numericKind` accepts `null`: the admin attribute route answers `numericKind: null` for an attribute that is not a slider, which the schema used to refuse. `AdminAttributeResponse['numericKind']` is now `'number' | 'price' | null | undefined`.
- 22604fa: The admin attribute response carries `channelScoped` and `languageScoped` (create, update, read and list), so the attribute editor shows the stored scope flags. `adminAttributeResponseSchema` declares both.
- 5038a3a: Multi-factor sign-in is now called **two-step verification** (Polish: **weryfikacja dwuetapowa**) in every user-facing string, replacing "two-factor authentication", "uwierzytelnianie dwuskładnikowe" and bare "2FA". Identifiers, permission codes (`mfa:reset`, `mfa:manage`), setting keys (`mfa.admin.totp_enforced` and its siblings) and error codes are unchanged.

  - `@endora-commerce/mod-mfa`: the four TOTP setting names (now "Admin UI — allow two-step verification", "Admin UI — enforce two-step verification", "Storefront — allow two-step verification", "Storefront — enforce two-step verification"; the `MFA_DEACTIVATION_BLOCKED` sentence quotes the new name), the English and Polish error sentences, permission labels, the Admin UI account-security screen, the manifest's module, setting and permission descriptions, and the federated sign-in refusal sentence. The `open-security` palette action also matches "two-step verification" / "weryfikacja dwuetapowa"; "two-factor", "2fa" and "dwuskładnikowe" still match.
  - `@endora-commerce/mod-i18n`: `adminRoles.field.requires2fa`, `adminUsers.column.twoFactor` and `organizations.detail.twoFactor`.
  - `@endora-commerce/mod-customers`: the reset actions on the customer list and detail screens.
  - `@endora-commerce/admin-kit`: the sentence shown when an administrator's password sign-in needs a second-step setup.
  - `@endora-commerce/contracts`: the validation message of the MFA disable request body.
  - `@endora-commerce/mod-admin-users`, `mod-admin-roles`, `mod-auth`, `mod-customer-accounts`: module documentation pages.

- df95f59: `ModuleErrorCodeDeclarationSchema`'s documentation now states that a code raised with a computed `details.code` must declare its `tokens`, and that `tokens: []` is a declaration — the raise's `details` never carries a `code` — rather than an absence. The schema itself is unchanged.

## 0.108.0

### Minor Changes

- 0bd5a2b: Minimum order quantities and a per-product returnable flag, as shapes, codes and one shared rule.

  - **New module `order-minimums`** (re-exported from the package root): `evaluateOrderMinimums(lines, rules)` — the one implementation of the rule (a pieces minimum per product, a units minimum per packaging unit, both judged on the product's total over every line and variant; a unit total is summed and compared exactly, so lines of 7, 1, 1 and 1 pieces on a 10-piece unit make one unit) — with its record types `OrderMinimumLine`, `OrderMinimumProduct`, `OrderMinimumPackagingUnit`, `OrderMinimumRules`, `OrderMinimumViolation`, `OrderMinimumBelowViolation`; `minimumRefusal(...)`, which builds the 422 envelope from minimum violations; `ORDER_MINIMUM_MAX` (`1_000_000`), `isValidOrderMinimum(value)` and `isOrderMinimumEligibleType(type)` (`simple` and `configurable` only).
  - **New `pickLocalized(field, language)`** — a per-language JSONB value (a product's `name`) in one language, falling back to the same primary language, then `en-US`, `en` and the first non-empty value. Every minimum refusal names its product with it, in `request.responseLanguage()`.
  - **New `toCartDroppedLines(skipped)`** (with `ShoppingListDroppedLine`) — a shopping-list conversion's skipped items as the carts bridge's `droppedLines`: `below_minimum` with its `minimum`, everything else `not_purchasable`. A composition root calls it instead of carrying its own copy.
  - **New bounds:** `ADMIN_ORDER_MAX_ITEMS` (`200`, admin order create/preview and the external order API) and `QUICK_ORDER_BUILD_MAX_ITEMS` (`200`, quick-order build).
  - **New error codes in `ERROR_CODES`:** `PRODUCT_BELOW_MINIMUM_QUANTITY`, `PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY`, `PACKAGING_UNIT_MISMATCH`, `RETURN_LINE_NOT_RETURNABLE`.
  - **Additive response fields (behaviour change for API clients — new fields appear):** catalogue storefront and admin product shapes `minOrderQuantity`, admin `returnable`, packaging unit `minOrderUnits`; comparison item `minOrderQuantity`; cart line `minOrderQuantity` and `belowMinimum`; cart dropped-line reason `below_minimum` with `minimum`; checkout preview-total `belowMinimumLines[]`; admin order preview message code `BELOW_MINIMUM_QUANTITY` with `minimum`; quick-order import reason `below_minimum`, row `warning`, `minimum`/`productTotal`, summary `warningCount`, build `rejected[]` (with `packagingUnitName`); shopping-list skip reason `below_minimum` with `minimum`; quote line `packagingUnitId` and admin `minimumWarning`; returns line `returnable` and `notReturnableReason`, return case item `returnableAtPurchase` (optional, nullable), response reason `no_returnable_lines`. Request schemas gain the optional `minOrderQuantity`, `returnable` and `minOrderUnits` (bounded by `ORDER_MINIMUM_MAX`) and the quote line's `packagingUnitId`.
  - **`returnableLineSchema.returnable` is required.** A producer or a test fixture of `GET /api/v1/orders/:orderId/returnable` lines must now set it.
  - **Port and record changes — implementers must add the members:** `CatalogProductReadPort.listPackagingUnitsByProductIds(productIds)` (typed stubs of the port must implement it; like every method of the port it applies no visibility policy, so callers pass only vetted ids); `CatalogProductRecord.minOrderQuantity` and `.returnable`; `CatalogPackagingUnitRecord.minOrderUnits`; `CartWritePort.addItems(actor, lines, { onLineError, onBelowMinimum?, replaceExisting?, language? })` with `CartBatchLineInput` and `CartBatchLineOutcome` (a `failed` outcome's `error` carries the refusal's `details` when it had any; `onBelowMinimum: 'throw'` refuses the whole batch before anything is written; `replaceExisting` makes the batch the customer's whole basket, cleared only once the batch has passed); an optional `options.language` on `CartWritePort.addItem` and `OrderPlacementPort.placeOrder`, and `CreateForCustomerOptions.language`; `CartItemRecord.quoteSeededQuantity` and `isQuoteSeededLineExempt(cart, item)`; `OrderReturnContextLine.returnableAtPurchase` (`boolean | null`, required); `CreateForCustomerOptions.minimums` (`'enforce' | 'warn'`) and the quote-request line's `packagingUnitId`. New port type `OrderQuoteSourcePort` (container name `orderQuoteSourcePort`, owner `orders`) with `QuoteSourceBasketLine`.

- 20af5d5: Shared shapes for filtering admin lists on custom fields, and the code that refuses a filter a list does not offer.

  **For a consumer of the contracts.**

  - `customFieldFilterSchema` (type `CustomFieldFilter`) is one custom field's filter: `contains`,
    `in`, `is`, `min`/`max` (decimal strings) and `from`/`to` (calendar dates), strict. Which
    operators apply is the field's value type to say: the admin lists refuse any other with 400
    `VALIDATION_FAILED`, and only the CRM board ignores it.
  - `customFieldFiltersSchema` (type `CustomFieldFilters`) is a request's filters keyed by
    definition key, with the key grammar of a definition (so `__proto__`, dotted or prefixed keys
    are refused) and two caps: at most `CUSTOM_FIELD_FILTERS_MAX_KEYS` (10) keys and at most
    `CUSTOM_FIELD_FILTERS_MAX_IN_VALUES` (100) `in` values summed over every key.
  - `customFieldFiltersQueryParamSchema` reads that record from a `customFieldFilters` query
    parameter holding JSON of at most 8000 characters. It is idempotent: an already-parsed object
    is validated rather than refused, and a repeated parameter is refused.
  - `customFieldDefinitionSchema` and `CustomFieldDefinitionRecord` carry `listFilter: boolean`;
    the create and update requests accept it optionally (absent on create is `false`, absent on
    update leaves it unchanged). `customFieldEntityTypeInfoSchema` carries `listFilter`, saying
    whether definitions of that type may be marked as list filters. `CUSTOM_FIELD_DEFINITION_ERROR_CODES`
    gains `list_filter_unsupported`.
  - `customFieldListFilterFieldSchema` and `customFieldListFilterFieldsResponseSchema` describe the
    fields an admin list offers as filters: key, value type, labels and options only.
  - `CustomFieldListFilterPort`, `CustomFieldListFilterCondition`,
    `CustomFieldFilterUnavailableFailure` and the guard `isCustomFieldFilterUnavailableFailure` are
    the in-process seam the `custom_fields` module publishes for these lists.
  - `CUSTOM_FIELD_FILTER_OPERATORS` names the operators each value type applies, and
    `assertCustomFieldFilterOperators` throws the `ZodError` naming every operator of a filter that
    does not apply to its field, at `[key, operator]`. `customFieldFilterUnavailable(keys)` builds
    the failure `isCustomFieldFilterUnavailableFailure` narrows. `assertCustomFieldFilterRanges`
    throws the `ZodError` naming an inverted range (a minimum above its maximum, a start after its end).
  - `ERROR_CODES` gains `CUSTOM_FIELD_OPTION_IN_USE` (`details: { value, label }`),
    `CUSTOM_FIELD_VALUE_TYPE_LOCKED` and `CUSTOM_FIELD_STORED_VALUES_EXIST` (`details: { key }`).
  - `updateCustomFieldOptionSchema` (type `UpdateCustomFieldOptionRequest`) is the body of an option
    patch: `label`, `labelDefault`, `isDefault` and `sortOrder`, each optional and without a default,
    and never `value`. `customFieldOptionSchema.partial()` is not a patch shape: it fills an absent
    member with its create default.
  - `calendarDateSchema` and `isCalendarDate` (a `YYYY-MM-DD` day the calendar has) are published
    from the shared primitives; the CRM schemas use the same one.
  - `adminOrdersListQuerySchema` accepts `customFieldFilters`.
  - `ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE`: an admin list was asked to filter on a custom
    field it does not offer; its `details` are `{ key, keys }`.

  **Same shape, one object.** CRM's `OpportunityFieldFilterSchema` is now
  `customFieldFilterSchema` itself; what it accepts is unchanged, and the board's
  `OpportunityFieldFiltersSchema` keeps its own 20-field cap.

- cf7a9c0: CRM free text gains a formatted-text grammar, and an Order reference says more than its number.

  - **New exports (`crm-rich-text`)**: `parseOpportunityRichText(text)` reads a description, a comment body or an Event description into blocks — paragraphs, bulleted and numbered lists, bold (`**…**`), italic (`_…_`, never inside a word), strikethrough (`~~…~~`), links (`[label](https://…)`, `http`/`https`/`mailto` only) and the existing `[[type:id]]` reference tokens; `formatOpportunityRichText(blocks)` writes them back; `opportunityRichTextToPlain(text)` drops the formatting for a plain-text surface; `isSafeOpportunityRichHref(href)`. Types `OpportunityRichBlock`, `OpportunityRichInline`, `OpportunityRichMark`. Stored text is still a string: plain text written before reads as the paragraphs it was, so nothing needs migrating.
  - **`OpportunityReferenceSchema`** gains an optional `order` (`OpportunityReferenceOrderSchema`: `status`, `total`, `currency`, `placedAt`, `customerName`), present on an available Order reference only. Consumers that rebuild the object field by field keep working; one that compares references with strict equality sees the new key.

- c8aa175: Named, ordered line groups for quote requests and orders.

  - **New module `line-groups`** (re-exported from the package root): `LINE_GROUP_LIMITS` (50 groups, names 1–120 characters), `lineGroupKeySchema`, `lineGroupNameSchema`, `lineGroupSchema` (`{ id, name, position }`), `lineGroupInputSchema` / `newLineGroupInputSchema`, `refineLineGrouping(ctx, body)` (unique keys and ids, every line's `groupKey` declared, at most 50 groups, `groups` only with `items`), and the one display ordering `arrangeLineGroups(groups, lines, options)` with `flattenSections`.
  - **Quote requests.** `adminPatchQuoteRequestSchema` and `adminCreateQuoteRequestSchema` accept `groups` and a per-line `groupKey`; both are now refined objects (`.superRefine`), so `.extend()`/`.omit()` on them is no longer available. `quoteRequestItemSchema` gains `groupId` (default `null`) and `position` (default `0`), `quoteRequestSchema` gains `itemGroups` (default `[]`) and answers `items` in display order. `quoteRequestHistoryChangeSchema` gains `group_added`, `group_removed`, `group_renamed`, `line_group` and `line_order`; `rfqDiffEntrySchema` gains `{ kind: 'grouping' }`, and its line entries an optional `groupName` (`null` = ungrouped) naming the group of a product that sits on several lines; `quoteRequestHistoryLineRefSchema` gains the same optional `groupName`. `adminPatchQuoteRequestLineSchema` gains an optional `splitFromId` — the stored line a new line was split off. `QuoteRequestLineRecord` gains optional `position` and `group`. `quoteRequestDocumentDataSchema` gains `groups` (default `[]`) and per line `groupId` / `position` (defaulted).
  - **Orders.** `orderItemSchema` gains `groupId` and `position`, `orderSchema` gains `itemGroups` (all defaulted). `adminCreateOrderRequestSchema` accepts `groups` and a per-line `groupKey` through the new `adminCreateOrderLineSchema`; `adminOrderPreviewRequestSchema` is unchanged, so a `groupKey` sent to the preview is stripped.
  - **Carts.** `CartWritePort.addItems` options gain `keepRepeatedLines` (with `replaceExisting` only): every line stays a line of its own, priced at its own quantity, and the basket reads back in the batch's order.
  - Because the new reply keys are defaulted, their **inferred output types are required**: code that builds a `QuoteRequest`, `QuoteRequestItem`, `Order`, `OrderItem` or `QuoteRequestDocumentData` object literal must now supply them (`itemGroups: []`, `groupId: null`, `position: 0`, `groups: []`).

- 1284428: `adminOrderPreviewLineSchema` gains an optional `taxRate` (a fraction, e.g. `0.23`): the rate a priced preview line is taxed at, from the same authority as the preview's `summary.taxTotal`. Absent on an unavailable line. The admin create-order screen sums a line group's VAT from it (feature 159).
- 1df7a5e: The Line items table prints a document's groups.

  - **Contracts.** `DocumentCollectionDeclaration` gains an optional `sections(data)` answering `DocumentItemSection[]` (`{ key, kind: 'group' | 'ungrouped', label, itemIndexes, summary }`, with `documentItemSectionSchema` and `DOCUMENT_UNGROUPED_SECTION_KEY`); `isValidSectionPartition(sections, itemCount)` checks one. `itemsTableGroupingSchema` is now a union of `{ by: 'sections', otherItemsLabel, showItemCount }`, `{ by: 'none' }` and the existing field shape (with `by: 'field'` optional) — `itemsTableSectionsGroupingSchema`, `itemsTableNoGroupingSchema`, `itemsTableFieldGroupingSchema`; `itemsTableGroupingMode(raw)` reads a stored value. `documentCollectionDetailSchema` gains `sampleSections` (default `[]`). `documentSectionTexts(language)` answers the default _Other items_ heading and the plural item count in English and Polish.
  - **Changed meaning of a stored `grouping: null`.** It meant _No grouping_; it now means **the document's groups**, which is also what an absent setting means. A document with no group prints exactly as before (the flat definition is unchanged), so this changes nothing until a document has groups — then every template, including those saved before this release, prints them without being edited. A table that must stay flat whatever the document says stores `{ by: 'none' }` (_No grouping_ in the editor).
  - **Document templates.** In that mode, a document holding a group prints per section a heading row (the group's name, the item count when enabled), its rows and one subtotal row per totals row of the table over the section's totals, then _Other items_ and the document's totals. The renderer reads `sections()` once per collection per render; a host that throws, or answers a partition that does not cover its lines, is logged and the table prints flat. Route 2 serves `sampleSections`; the editor's _Grouping_ field offers _Document's groups_, _By field_ and _No grouping_, the _Other items_ heading and _Show item count_, and the canvas draws the sample's groups.
  - **Quote requests.** The quote's `lines` collection declares its sections (`quoteLineSections`), each with the quote's totals rule over its own lines; the editor's sample quote has two groups and an ungrouped line.

- 14bcf1d: Pricing model v2 (feature 160, D-287 P1): price books replace the Application-rule price lists. **Breaking in the 0.x sense — every removal below has a replacement named beside it.**

  - **New** — `price-books.ts`: the book (`PriceBook`, `PriceBookSummary`, `priceBookCreateSchema`, `priceBookPatchSchema`, `priceBookDuplicateSchema`), its rows (`PriceBookRow`, `priceBookRowInputSchema`, the batch and dry-run shapes), base prices, the explanation with ranked candidates, the target pickers, the precedence read, and `PriceSource` / `priceSourceSchema`.
  - **Removed: the Application rule.** `ApplicationRule`, `applicationRuleSchema`, the rule-node types, `ruleCriterionTypeSchema`, `PriceListResolutionContext`, `PriceListRuleEvaluation` and `evaluateApplicationRule`. Old: a list's `applicationRule` decided who it priced. New: a book's audience set (`audience: { kind: 'everyone' | 'customer_groups' | 'organizations', memberIds }`) and channel set (`channelIds`).
  - **Removed: the old list, bracket and matrix shapes.** `priceListEngineSchema`, `create/patchPriceListEngineRequestSchema`, `priceListBracketSchema`, `replaceBracketsRequestSchema`, `productAssignmentSchema`, `replaceProductsRequestSchema`, the `bulkAddPriceListProducts*` schemas, `priceListIdParamsSchema`, every `priceMatrix*` schema and type, `PRICE_MATRIX_MAX_ENTRIES_PER_LIST`, `PriceBracketInput` and `PriceListBracketSummary`. Old: `PUT …/price-lists-engine/:id/products/:productId/brackets` with `{ PLN: [brackets] }`. New: `PUT /api/v1/admin/price-books/:id/rows` with `priceBookRowInputSchema` rows (`{ selection, minQuantity, maxQuantity, price: { type: 'fixed' | 'percent' | 'amount', … } }`), and base prices through `PUT /api/v1/admin/price-books/base-prices/:productId`.
  - **Removed: `PriceListAdminPort`** (`priceListAdminPort`), **replaced by `PriceBookWritePort`** (`priceBookWritePort`, owner `price_lists`, fails closed while it is absent). Old → new: `getById(priceListId)` → none (a base book is addressed by its currency); `listProducts(priceListId)` → `basePrices(productId)` (`byCurrency[code].product`, and `.variants`); `addProduct(priceListId, productId)` → none (books have no roster — writing the tiers is enough); `replaceBrackets(priceListId, productId, bracketsByCurrency)` → `replaceProductBaseTiers(productId, tiersByCurrency)` (variant rows kept; amounts are decimal strings) or `replaceBasePrices(productId, { byCurrency })` (product and variant rows); `summarizeBracketsForProduct(productId)` → `booksPricingProduct(productId, variantId?)` (`PriceBookSummary[]`, each with `matches[]`). Both writes are the admin base-price command, refused for its reasons. `productBasePricesSchema` / `ProductBasePrices` describe what `basePrices` answers.
  - **Reshaped: `PriceListRecord` / `PriceListReadPort`.** The record drops `code`, `isDefault`, `applicationRule` and `modifiedAt`, renames `currency` to `currencyCode`, gains `audienceKind`, and `type` is `'regular' | 'sale'` (was `'base' | 'sale'`). The port drops `findByCode` (books have no code) and gains `listForOrganization({ organizationChain, customerGroupId })` (the books that apply to an organization, with `reason` and `depth`).
  - **Reshaped: `ListingPrice`.** The `source: 'product'` arm — the product's own `defaultPrice` — is removed: a product has no price of its own. Old: `switch (price.source) { case 'price_list': …; case 'product': …; case 'none': … }`. New: `'price_list'` and `'none'` only; the `price_list` arm carries `priceSource`, `compareAtAmount`, `variesByVariant` and `maxAmount`.
  - **Reshaped line and engine results.** `LinePriceResult`, `ListingPriceDetail` and the resolved-price shapes carry the price source (`base | catalogue | buyer | sale`, plus `agreed` on a cart line), the compare-at price of a charged sale and, when `pricing.show_list_price` is on, the list price.
  - **Catalogue:** `ProductVariant.priceOverride`, `CatalogProductVariantRecord.priceOverride` and `createVariantRequestSchema.priceOverride` are removed. Old: `POST …/variants` with `priceOverride: 49.99`. New: a variant row of the base book (`PUT /api/v1/admin/price-books/base-prices/:productId`). `PRICE_FIELDS_REFUSED_ON_PRODUCTS` and `PRICE_FIELDS_REFUSED_ON_VARIANTS` name what a write refuses.
  - **Error codes:** `PRICE_SET_IN_PRICE_BOOKS` (catalogue writes naming an old price field), and the price-book codes `PRICE_BOOK_CHANNEL_CURRENCY`, `PRICE_BOOK_AUDIENCE_KIND`, `PRICE_BOOK_IMMUTABLE_FIELD`, `PRICE_BOOK_NOT_APPLICABLE`, `PRICE_BOOK_ROW_OVERLAP`, `PRICE_BOOK_ROW_SHAPE`, `PRICE_BOOK_ROW_TARGET`, `PRICE_BOOK_ROW_LIMIT`, `PRICE_BOOK_STALE`, `PRECEDENCE_CHANGE_UNAVAILABLE`.
  - `ChannelMemberEntityTypeSchema` gains `'price-list'` (a book's channel set is a registered sales-channel bridge).

- 789f917: A product feed pinned to a price book publishes the book's prices only while the book applies to an anonymous buyer on the feed's channel (feature 160, FR-029, owner ruling 2026-10-23).

  - **`@endora-commerce/contracts`.** New `pinnedPriceBookUnpublishableReasonSchema` (`not_found`, `currency_mismatch`, `not_active`, `outside_schedule`, `not_on_channel`, `audience_restricted`) and the `PinnedPriceBookPublishability` type. `productFeedSchema` gains `pinnedPriceBookWarning` (the reason, or `null`).
  - **`@endora-commerce/mod-price-lists`.** `pricingService.namedListPrices` answers nothing unless the book is `active` or `scheduled` inside its schedule window, bound to the feed's channel with the channel offering its currency (a base book is channel-independent) and for everyone; before, it ignored status, dates, channel and audience. New `pricingService.namedListPublishability({ priceListId, currencyCode, salesChannelId })` says whether, and why not. The catalogue price a pinned book's percentage and amount rows are taken off is now the channel's catalogue price **without** that book (an everyone book was taken off its own result).
  - **`@endora-commerce/mod-product-feeds`.** `FeedPricingPort` requires `namedListPublishability`; the admin feed list and detail rows carry `pinnedPriceBookWarning`, and the feed page shows it as a warning (English and Polish). What a run of such a feed does is `160-pinned-feed-withdrawal.md`'s.

- d231c48: A product feed whose pinned price book does not apply at generation time withdraws its published file (feature 160, FR-029, owner ruling 2026-10-23).

  - **`@endora-commerce/contracts`.** `feedRunStatusSchema` gains `withdrawn`. `productFeedRunSummarySchema` (and so a feed's `lastRun` and every run) gains `withdrawalReason`: on a `withdrawn` run, one of `pinnedPriceBookUnpublishableReasonSchema`'s reasons; `null` otherwise. A consumer that switches exhaustively on the run status has one more case. `feedRunFailureCodeSchema` drops `price_list_unavailable`, which nothing ever raised: a run whose pinned book does not apply is a withdrawal, not a failure.
  - **`@endora-commerce/mod-product-feeds`.** A run of a feed pinned to a book that does not apply ends `withdrawn` with the reason, before the catalogue is walked: it produces no file, clears the feed's published file, and the public feed URL then answers exactly as for a feed that has never been generated (`404`, the one not-available body). It is not a failed run, so no failed-run notification is sent; the earlier file is detached, not deleted, and is purged by the usual artefact retention. When the book applies again, the next run publishes as usual. A failed run (a configuration error, the skip threshold, storage) still keeps the last good file serving, as before. New column `product_feed_runs.withdrawal_reason` (migration `20261023T195611_product_feeds_run_withdrawal_reason`). `FeedGenerationService` requires a `pinnedPriceBookPublishability` dependency. The admin shows the outcome as _Withdrawn_ on the run badge, the run page and the feed page (English and Polish); the warning for a pinned book that no longer exists no longer points at a Settings control that does not exist.

- e47b84b: The four price-matrix error codes are gone (feature 160): `ERROR_CODES.PRICE_MATRIX_ENTRY_NOT_FOUND`, `PRICE_MATRIX_ENTRY_OVERLAP`, `PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE` and `PRICE_MATRIX_ENTRY_LIMIT` are no longer exported or declared by `price_lists`, and their sentences and the unused `priceMatrix.*` admin strings are removed from both bundles. Nothing has raised them since the matrix entries became price-book rows: a row is refused with `PRICE_BOOK_ROW_SHAPE`, `PRICE_BOOK_ROW_OVERLAP`, `PRICE_BOOK_ROW_TARGET` or `PRICE_BOOK_ROW_LIMIT`.
- 9434cbc: `resolvedPriceEngineSchema` describes what `GET /api/v1/storefront/products/:id/resolved-price` answers (feature 160, FR-018).

  - **`@endora-commerce/contracts`.** Amounts are decimal strings (`{ amount: '199.0000', currency: 'PLN' }`), as the route has always sent them — the schema declared numbers. An unpriced product has `baseListId`, `basePrice` and `quantityBracket` all `null` (they were declared non-null); the three are `null` together or set together.
  - **`@endora-commerce/mod-price-lists`.** The route answers `baseListId: null` for an unpriced product instead of an empty string.

- 87ac085: A price is rounded to two places the same way everywhere: half-up on its decimal digits.

  - **`@endora-commerce/contracts`.** New `roundAmountHalfUp(value: string | number): string` — an amount at two places, half-up on its decimal digits (half away from zero when negative). A number is read as the shortest decimal that round-trips it.
  - **`@endora-commerce/mod-carts`.** The basket line stores the resolver's four-place amount through `roundAmountHalfUp`, and the placement drift check (`storedPriceDiffers`) compares with it. `Number(amount).toFixed(2)` rounded the binary double, so a 9.0450 price was stored and charged as 9.04 while the card showed 9.05, and 1.0050 as 1.00 against 1.01.
  - **`@endora-commerce/mod-orders`.** The admin order preview rounds its line prices the same way.
  - **`@endora-commerce/mod-quote-requests`.** A quote line's stored reference price is rounded the same way.
  - **`@endora-commerce/mod-product-feeds`.** Feed prices (`123.45 PLN`) are rounded the same way.

- 87f673d: A gross price is computed on decimals and rounded half-up, the same way everywhere.

  - **`@endora-commerce/contracts`.** New `grossAmountHalfUp(net: string | number, ratePercent: string | number): string` — `net × (1 + rate / 100)` at two places, half-up on the exact decimal product, beside `roundAmountHalfUp`. A number is read as the shortest decimal that round-trips it.
  - **`@endora-commerce/mod-product-feeds`.** A gross feed (the default presentation) computes its price with it. It rounded the binary double, so 29.50 at 23 % was published as 36.28 instead of 36.29, 4.30 at 5 % as 4.51 instead of 4.52, and 31.50 at 23 % as 38.74 instead of 38.75.

- ad341ed: `decimalText(value)` is exported: a string trimmed, or a number as the shortest decimal that round-trips it (an exponent form read as an integer or at twelve places). `roundAmountHalfUp` and `grossAmountHalfUp` read their arguments through it instead of each carrying a copy, and `grossAmountHalfUp` takes an optional third argument, `'percent'` (the default) or `'fraction'`, so a rate such as `0.23` is read as written rather than shifted by hand. The storefront's gross derivation uses it and drops its own decimal-point shifting.
- 301a69f: An admin read of a product's variants (feature 161, Checkpoint 5 review).

  - **`GET /api/v1/admin/catalog/products/:productId/variants`** (`catalog:read`): every variant of the product by SKU, serialized as the variant writes answer them (`id`, `parentProductId`, `sku`, `variantAttributeValues`, `stockLevel`, `createdAt`, `updatedAt`), whatever the product's status, sales channels or audience; an unknown or deleted product is `404`. `CatalogAdminService.listVariants(productId)` is new. The storefront's `GET /api/v1/catalog/products/:id`, which answers an inactive product `410` and an out-of-channel one `404`, is unchanged.
  - **Contracts:** `adminProductVariantSchema`, `adminProductVariantsResponseSchema` and their types.
  - **The price-book grid** expands a product line through this read (the action is absent without `catalog:read`).

- 1377dc8: Response schemas the price-book editor's client parses (feature 161, T045), additive — the routes already answered these shapes.

  - **`priceBookRowsResponseSchema`** (`PriceBookRowsResponse`): `GET /api/v1/admin/price-books/:id/rows` — `{ data: PriceBookRow[], meta: { page, pageSize, totalCount } }`.
  - **Picker answers** of `GET /api/v1/admin/price-books/targets/*`, each `{ data: { items } }`: `priceBookTargetOrganizationsResponseSchema` (`{ id, name, taxId }`), `priceBookTargetCustomerGroupsResponseSchema` (`{ id, code, name }`), `priceBookTargetCategoriesResponseSchema` (`{ id, slug, name: Record<language, string>, parentCategoryId, sortOrder }`), `priceBookTargetAttributesResponseSchema` (`{ key, label, valueType, options: { value, label }[] }`), `priceBookTargetSalesChannelsResponseSchema` (`{ id, code, name: Record<language, string>, currencies, defaultCurrency }`) and `priceBookTargetCurrenciesResponseSchema` (`{ code, exposedByChannels }`), with their item schemas (`priceBookTarget<Kind>Schema`) and types (`PriceBookTarget<Kind>`).

- af57b55: The price-book editor's API gaps (feature 161, G11–G17), additive on the wire; two are new required members for code that builds these types itself.

  - **Writable for the caller (G11).** `priceBookSchema` and `priceBookSummarySchema` gain `writable: boolean`; `priceBookListResponseSchema.meta` gains `creatableAudienceKinds: PriceBookAudienceKind[]`; `productBasePricesSchema` gains `writable: boolean` (also on `PriceBookWritePort.basePrices` answers, always `true` there). A producer of `PriceBook`, `PriceBookSummary` or `ProductBasePrices` objects must now set the field. Old: `{ ...book }`. New: `{ ...book, writable }`.
  - **Book lines (G15).** New `priceBookLinesQuerySchema` (`kind`, `search`, `page`, `pageSize` ≤ `PRICE_BOOK_LINES_MAX_PAGE_SIZE` = 500), `priceBookLineSchema`, `priceBookVariantLineSchema`, `priceBookLinesResponseSchema` (`meta.totalLines`) for `GET /api/v1/admin/price-books/:id/lines`.
  - **`CatalogProductReadPort.pageProductsByAdminName(query)` (G15)** — new **required** method (`CatalogAdminNamePageQuery`: `membership` (`CatalogProductMembership`, a `{ sql, params }` subquery), `search?`, `language`, `offset`, `limit`, `withTotal?` → `{ ids, total: number | null }`). A hand-written implementation or test double of the port must add it. Old: an object literal with the port's previous methods. New: add `pageProductsByAdminName: async () => ({ ids: [], total: 0 })` (or a real one).
  - **Admin name fold (G15).** `foldAdminName(text)`, `adminNameLanguage(tag)` and `ADMIN_NAME_LANGUAGES` (`admin-name.ts`): the case and accent fold catalog's stored admin name keys are built with, for code that orders by the same rule.
  - **Named runner-ups (G16).** `priceBookExplanationCandidateSchema` gains `bookName: string` and `labels: PriceBookRowLabels`. `priceBookRowLabelsSchema` is now declared before the explanation schemas (same export).
  - **List price on the catalogue DTOs (G14) and on search suggestions (G19).** `searchSuggestItemSchema` gains optional `listPrice: { amount, currency }`.
  - **List price on the catalogue DTOs (G14).** `productResolvedPriceSchema` (and so `ProductSummary.resolvedPrice`) gains optional `listPrice: { amount, currency }` — the catalogue price beside a lower buyer price while `pricing.show_list_price` is on.
  - **Decimal helpers (G17).** `parseUnits`, `formatUnits`, `parseSignedUnits`, `parseSignedPercentHundredths`, `applySignedPercent`, `applyAmountAdjustment`, `normaliseAmount` and `compareDecimal` are exported from the barrel (`price-book-decimal.ts`): the integer, half-up, four-place arithmetic the resolver prices with, for previews that round as the server does.

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

- 0d0a1c6: Shared shapes for carrying custom-field values between Quote Requests, Orders and Sales Opportunities, and the code that refuses a carry that cannot work.

  **For a consumer of the contracts.**

  - `customFieldCarryToSchema` is the list of entity types a definition's values carry to: at most
    `CUSTOM_FIELD_CARRY_MAX_TARGETS` (2) entries, no duplicates.
  - `customFieldDefinitionSchema` carries `carryTo` (required on the wire);
    `createCustomFieldDefinitionSchema` defaults it to `[]`; `updateCustomFieldDefinitionSchema`
    takes it optionally, and an absent `carryTo` leaves the stored one unchanged.
  - **Required member — type-level change for hand-built fakes.** `CustomFieldDefinitionRecord`
    gains `carryTo: SupportedEntityType[]`, and `CustomFieldEntityTypeInfo` gains `carryTargets`
    (parsed with a default of `[]`): the entity types a definition of that type may carry to.
    A hand-built record or entity-type value now needs the member.
  - `assessCustomFieldCarry(source, target)` is the one compatibility rule of a carry pair: it
    returns every `CustomFieldCarryIncompatibility` — `target_missing`, `value_type_mismatch` (no
    widening), `options_missing` (the source option values the target lacks) and
    `audience_mismatch` (an internal value into a customer-visible field) — in that order, `[]`
    meaning compatible. Pure; safe in the browser.
  - `CustomFieldCarryPort` (`plan`) answers which values carry into a target bag, as a
    `CustomFieldCarryPlan` of `values`, `carried` keys and `skipped` keys, each a
    `CustomFieldCarrySkip` with a `customFieldCarrySkipReasonSchema` reason (`target_missing`,
    `value_type_mismatch`, `audience_mismatch`, `value_invalid`). A skip also carries an optional
    `label` (`customFieldCarrySkipLabelSchema`: `labelDefault` and a per-locale `labels` map), the
    source field's label when the value was skipped; a skip stored without one still parses.
    `customFieldCarrySkipRecord(skip)` makes the plain copy a record stores.
  - `CustomFieldCarryReceiverPort` (`receiveCarriedValues`, answering a `CustomFieldCarryReceipt`)
    is how a Sales Opportunity's values are pushed to the Order or Quote Request created from it.
  - `orderCommentSystemNoteSchema` (type `OrderCommentSystemNote`) is an author-less system note
    in an Order's comments naming the custom-field values not carried into it;
    `orderCommentSchema` gains an optional, nullable `systemNote` (admin replies only).
  - `rfqEventTypeSchema` gains `custom-field-carry-skipped`; `quoteRequestHistoryEntryKindSchema`
    gains `custom_field_carry_skipped`, whose entries carry `customFieldCarry` (the source
    Opportunity and the skipped keys). Admin replies only.
  - `CUSTOM_FIELD_DEFINITION_ERROR_CODES` gains `carry_incompatible`, so
    `isCustomFieldDefinitionFailure` recognises a refused carry option.
  - `ERROR_CODES.CUSTOM_FIELD_CARRY_INCOMPATIBLE` — 422 when a definition's carry option is turned
    on towards a target that cannot take its values; `details.code` names why (`target_missing`,
    `value_type_mismatch`, `options_missing`, `audience_mismatch`, `pair_unsupported`,
    `target_unavailable`).

- 61a1188: A reorder reports the lines that no longer have a price (issue #166).

  - **Behaviour change — reorder.** `POST /api/v1/orders/:id/reorder` and the admin reorder seed every line at the price the buyer may order it at now, and leave out a line nothing prices for this buyer (or that is sold on request only), reporting it in `unavailableItems` with `reason: 'no_price'` beside the discontinued products. Such a line used to be seeded at the old order's price without being reported, and placement then refused the basket.
  - **`CartSeedOptions.dropUnorderable`** (contracts): `CartWritePort.replaceItemsForCustomer` leaves out the seed lines that have no orderable price and names them in the answer's new optional `unorderable` (`CartSeedUnorderableLine[]`: `productId`, `variantId`, `reason: 'unpriced' | 'quote_only'`). Ignored for an agreed seed. Absent, behaviour is unchanged.
  - **`CartService.repriceLinesForCustomer`** (carts) now answers the lines it could not price, by cart item id, with the reason; it still prices them all in one batched call.

- 56b075d: The _Place order_ action on an approved Quote Request in the Admin UI works. It posted to the storefront's `POST /api/v1/quote-requests/:id/convert-to-order`, which is customer-only: an administrator's session answered `401`, which the Admin UI reads as an expired session, so the operator was signed out — and an accepted call would have seeded the administrator's own basket.

  `@endora-commerce/mod-quote-requests` adds `POST /api/v1/admin/quote-requests/:id/prepare-customer-basket`, behind the module's `rfqs:handle` permission and the sales-representative scope of the other admin actions. It puts the approved request's lines into the basket of the customer who owns the request, at the agreed unit prices — replacing what that basket held, exactly as the customer's own conversion does and under the same rules — and records `quote_request.prepare_customer_basket` in the audit log. The customer completes the order at checkout. `@endora-commerce/contracts` exports its response schema, `adminPrepareCustomerBasketResponseSchema` (`cartId`, `customerAccountId`, `itemCount`).

  The Admin UI button calls it after a confirmation that names the replaced basket, and is labelled _Prepare the customer's basket_ (`@endora-commerce/mod-i18n`, English and Polish).

- 53e88c7: New `admin-feedback` contract (issue #379): `AdminFeedbackRequestSchema` (what the Admin UI sends to its instance), `AdminFeedbackRelayPayloadSchema` (what the instance relays — the words plus the platform release, the Admin UI and API addresses and the sending administrator), `adminFeedbackPhoneSchema`, `ADMIN_FEEDBACK_MESSAGE_MAX_LENGTH`, `ADMIN_FEEDBACK_ERROR_CODES`, `ADMIN_FEEDBACK_SETTING_CODES` and `ADMIN_FEEDBACK_DEFAULT_RELAY_URL` (the commerce.endora.software relay, with its trailing slash). `ERROR_CODES` gains `ADMIN_FEEDBACK_NOT_CONFIGURED` and `ADMIN_FEEDBACK_DELIVERY_FAILED`.
- 359ee2b: `CatalogProductReadPort` answers products the way pricing resolves them, without building a record of each (issue #416).

  - **New, required on every implementation of the port:** `listPricingRefs()` and `findPricingRefsByIds(ids)`, answering `CatalogProductPricingRef` (`{ id, attributeValues }`, exported from `@endora-commerce/contracts`). `listPricingRefs()` answers the products `listAll()` answers, ordered by id; `findPricingRefsByIds(ids)` answers the ones `findByIds(ids)` answers. Soft-deleted and inactive products are included in both. An implementation outside this repository has to add both methods. It can map `listAll()` and `findByIds()` to `{ id, attributeValues }`.
  - `@endora-commerce/mod-catalog` answers each with one statement and no entity hydration. The price surface's worker reads the catalogue at the start of every whole build. On a 50 000-product catalogue, `listAll()` took 3.8 s for that, most of it hydrating `Product` entities whose fields the build does not use.

- 8f0fd0e: A typed money amount with more than two decimal places is refused with `400 AMOUNT_PRECISION_EXCEEDED`, never rounded (issue #417, owner ruling of 2026-10-24).

  - `@endora-commerce/contracts`: new `money-input` module — `twoDecimalAmount(schema)` for a number schema, `twoDecimalAmountString(schema)` for a decimal string, `addAmountPrecisionIssue(ctx, path)` for a `superRefine` that decides per field, `hasAtMostTwoDecimals(value)`, `isAmountPrecisionIssue(issue)` and the `AMOUNT_PRECISION_EXCEEDED` constant; new `ERROR_CODES.AMOUNT_PRECISION_EXCEEDED`.
  - `@endora-commerce/platform`: the error envelope answers `400 AMOUNT_PRECISION_EXCEEDED` when every failed issue of a request is the precision issue, whether the route validated through the type provider or parsed the body itself; a request failing anything else as well stays `VALIDATION_FAILED`, the precision issue listed among its details.
  - `@endora-commerce/mod-i18n`: declares the code in the platform block, with its sentence in English and Polish.

- cc98507: Exact decimal money arithmetic for every amount computed from a price (issue #417).

  - **New module `money-decimal`** (re-exported from the package root), the sibling of `price-book-decimal`: every value is read as the decimal it is written as (`decimalText`), carried as an integer with a scale, and rounded **half-up** (half away from zero for a negative amount) only where asked.
    - `roundHalfUp(value, places = 2)` — `roundAmountHalfUp` at any number of places (4 for a unit price).
    - `decimalSum(...values)`, `decimalDifference(a, b)`, `decimalProduct(a, b)` — exact and unrounded; `compareDecimals(a, b)` for signed decimals of any scale.
    - `moneySum(values, places = 2)`, `moneyDifference(a, b, places = 2)` — rounded once, at the end.
    - `lineAmountHalfUp(unitPrice, quantity)`, `percentOfHalfUp(amount, percent)`, `quotientHalfUp(dividend, divisor, places = 2)`, and `wholeMultiples(amount, step)` — how many whole steps fit in an amount (`Math.floor(0.3 / 0.1)` is 2).
    - `taxAmountHalfUp(net, rate, unit)`, `taxAmountExact(net, rate, unit)`, `grossFromNetHalfUp(net, rate, unit)` (a negative net allowed) and `netFromGrossHalfUp(gross, rate, unit)` — `unit` is `'fraction'` (`0.23`) or `'percent'` (`23`) and is required.
  - Replaces `Number#toFixed(2)` and `Math.round(x * 100) / 100` on doubles, which round the binary value: 29.50 × 1.23 is the double 36.28499…, so the binary rounding gave 36.28 where half-up gives 36.29.

- ced7b20: One VAT method, shared by every document an order produces (issue #417, owner ruling of 2026-10-24; art. 106e ust. 1 pkt 13–14 of the Polish VAT Act).

  - **`vatByRate(lines, unit)`** — per rate, the VAT on the sum of the nets at that rate, rounded half-up once; gross = net + VAT; totals are the sums of the rows. It also answers each line's informational share of its rate's VAT, so line grosses add up to the total.
  - **`allocateHalfUp(total, parts, places = 2)`** — a total shared over parts, each rounded half-up and the difference handed back cent by cent.
  - **`netForGrossAtRate(gross, rate, unit)`** — the net a gross came from under that rule (what a correction credits net), with `exact: false` and the VAT as the remainder for a gross the rule cannot produce.

- f3598cd: A correction credits an order-level discount the way the invoice charged it (issue #417, review of PR #423). `CorrectiveInvoiceLine` gains an optional `discount` (`@endora-commerce/contracts`): the part of the order's discount the line's refund carries. The goods are credited at `amount + discount` at their VAT rate, and the discount comes back on a negative 0 % line mirroring the invoice's own discount line, so the correction totals the refund and credits the goods' VAT as charged: a full return of 100.00 net at 23 % with a 50.00 discount credits 123.00 of goods (23.00 VAT) and −50.00 of discount, 73.00 in all, where it credited 73.00 of goods with 13.65 VAT. Earlier corrections' discount lines stay out of the goods' cumulative nets.
- 6177c81: An opportunity's `manualValue` (`CreateOpportunityRequestSchema` and the schemas that share its decimal-amount shape) refuses more than two decimal places with the platform's one precision code, `400 AMOUNT_PRECISION_EXCEEDED` (issue #417), rather than a `VALIDATION_FAILED` of its own. A value that is not a non-negative decimal at all is still `VALIDATION_FAILED`.
- c8b20f6: An order refunded in full before it is invoiced is not invoiced (issue #417, owner ruling of 2026-10-24): there is no sale left to document. When the refunds of its captured payments equal what was captured and cover the whole order total, issuing a VAT invoice answers `422 INVOICE_ORDER_REFUNDED` and draws no number; the automatic issuance on an order status skips the order and logs the reason instead of failing. An order refunded in part is invoiced as before, with what was kept as paid. `ERROR_CODES` gains `INVOICE_ORDER_REFUNDED` (`@endora-commerce/contracts`), declared by `invoices` with an English and a Polish sentence.
- 29180cd: `vatByRate`'s per-line `gross` is the line's own rounding, `round(net × (1 + rate))`, instead of the line's allocated share of its rate's VAT (owner ruling of 2026-10-24, issue #417): 29.50 at 23 % shows 36.29 even beside another 23 % line. The rows' VAT and the totals are unchanged, so a document's line grosses may add up to a cent more or less than its total. `allocateHalfUp` stays for exact shares of a refund.
- 52884d6: `OrderReturnContext.productsPaidTotal` takes the order-level discount off: subtotal + tax total − discount total, which is what the products were charged (issue #417, review of PR #423). An order of 100.00 net + 23.00 VAT with a 50.00 discount and 10.00 delivery charged 83.00, of which 73.00 for the products; a full return used to read 123.00. `OrderReturnContext` gains `discountTotal` (`@endora-commerce/contracts`), the stored discount a return credits back in part.
- 0071cd7: Orders take VAT per rate on the sum of the nets at that rate, rounded half-up once (owner ruling of 2026-10-24, issue #417; `vatByRate`), in placement, the checkout preview and the admin preview. This replaces the sum of every line's exact tax across all rates rounded once: 29.50 at 23 % with 4.30 at 5 % now carries 7.01 VAT and a total of 40.81 — the figure the invoice carries — where it carried 7.00 and 40.80. The paid amount, the proforma, the credit reservation and the order total are that one figure. A line's stored `lineTotal` is its net plus its share of its rate's VAT, so the line totals add up to the products' gross; `orderLineMoney` is removed and `orderTotalsMoney` answers each line's amounts under `lines`.

  `OrderReturnContextPort` answers `paidLineAmount` under the same method over the whole order — what the order line and the invoice charged (9.05 × 3 at 8 % is 29.32, not 29.31) — `paidUnitAmount` as that over the quantity, and two new fields on `OrderReturnContextLine` (`@endora-commerce/contracts`): `unitNetPrice` and `taxRate`, so a return prices a returned quantity under the same method.

- 3e949eb: Orders record the VAT method they were placed under, and report what an order charged from what it stored (issue #417, review of PR #423, owner ruling of 2026-10-24).

  - New nullable column `orders.vat_method` (migration `Migration20261024T145147OrdersVatMethod`, no backfill): placement writes `per_rate`; `null` is an order placed before 0.108.0, whose totals followed the rule of their day.
  - A new order line's stored `lineTotal` is the line's own rounding of its gross, `round(net × (1 + rate))`; the order's VAT and total are still per rate on the net sums, so the line totals may differ from the total by a cent.
  - `OrderReturnContextPort` no longer recomputes what was paid: `paidLineAmount` is the stored `lineTotal`, `paidUnitAmount` that over the quantity, and `OrderReturnContext` (`@endora-commerce/contracts`) gains `vatMethod` and `productsPaidTotal` (stored subtotal + tax total). `paidAmounts` is removed.

- 403ccc1: Promotions sum and scale amounts exactly everywhere (issue #417, review of PR #423): the cart subtotal and a line-scoped base (`linesSubtotal`) are exact sums — 10 % of 0.01 + 2.34 is 0.24, not 0.23 — `spend_x_percent_off` multiplies its steps by the percentage exactly (3 × 0.15 % of 10.00 is 0.05, not 0.04), and the free-unit actions sum unit prices exactly (`unitsTotal`). The dead `cartSubtotal` helper is removed.

  A promotion's typed money amounts refuse more than two decimal places with `400 AMOUNT_PRECISION_EXCEEDED` (`@endora-commerce/contracts`): the action `amount` and `spendStep`, the legacy `value` of an `amount_off` promotion (a percentage is left alone) and `minCartSubtotal`.

- 2b8bd26: The quote request list's `totalAtCustomerPrice` and `totalAtAgreedPrice` are exact sums (issue #417, review of PR #423): 3 × 9.05 was published as `27.150000000000002`, now `27.15`. A typed `desiredUnitPrice` (`createQuoteRequestLineSchema`) and `agreedUnitPrice` (`adminCreateQuoteRequestLineSchema`, `adminPatchQuoteRequestLineSchema`) with more than two decimal places is refused with `400 AMOUNT_PRECISION_EXCEEDED` (`@endora-commerce/contracts`).
- ec14b96: More typed money fields refuse more than two decimal places with `400 AMOUNT_PRECISION_EXCEEDED` (issue #417, owner ruling of 2026-10-24), instead of being rounded: `deliveryMethodUpsertSchema.cost`, `paymentMethodUpsertSchema.additionalPrice`, `returnDeliveryMethodCreateSchema.returnCost` and `returnDeliveryMethodUpdateSchema.returnCost`, `settlementRequestSchema.lines[].approvedRefundAmount`, `adminOrderRefundRequestSchema.amount`, `grantCreditLimitRequestSchema.grantedAmount` and `adjustCreditLimitRequestSchema.grantedAmount`, and an ERP integration's decimal strings in `erpSaleDocumentUpsertInputSchema` (`netTotal`, `taxTotal`, `grossTotal`, `paidTotal`).
- a4cd906: A correction that cannot be made never follows money that moved (issue #417, review of PR #423).

  - `CorrectiveInvoicePort` gains `validateCorrection(input)` (`@endora-commerce/contracts`): it refuses, writing nothing, what `createCorrection` would refuse for the same input. `invoices` implements both from one preparation step.
  - The returns settlement builds its correction once and validates it **before** the refund or the credit top-up; a refusal leaves the case in `received` with nothing moved. With `invoices` switched off, a settlement asking for a correction is refused before the credit, where it used to credit first and refuse after.
  - A cancelled correction no longer counts against the cap or the cumulative nets of later corrections.

- 5bddd11: Batched pricing ports, one customer-group rule, and the price split on catalogue summaries (D-287 P0).

  - **New `LinePricesPort`** (container `pricingService`): `resolveLinePrices({ lines, context })` prices many `LinePriceRequest`s (`{ key, product, variantId?, quantity }`) for one buyer in one call and answers a `Map<key, LinePriceResult | null>` identical, key by key, to one `resolveLinePrice` per line. `OrgLinePricePort` is unchanged; a caller that needs both names `OrgLinePricePort & LinePricesPort`.
  - **New `ListingPriceDetailPort`** (container `pricingService`): `resolveListingPriceDetails(input)` answers, per product, a `ListingPriceDetail` — the listing chain's `price` (`ListingPrice`) plus `basePrice`, `salePrice` and `displayMode` from the same resolution. `ListingPricePort`'s input is now the named type `ListingPriceInput`.
  - **New `PricingBuyerContext`** documents the one rule: effective group = the explicit `customerGroupId` ?? the customer account's own group ?? the organisation's. `customerAccountId?: string | null` is added to the contexts of `ListingPricePort`, `LinePricePort` and `ListingPriceViewerContext`.
  - **`ProductAudience.customerAccountId?`** — the signed-in customer account; not a visibility input.
  - **`ProductSummary.resolvedPrice?`** (`productResolvedPriceSchema`: `basePrice`, `salePrice`, `displayMode`, nullable, optional) — inherited by `ProductDetail` and `SearchSuggestItem`.

- a8919dc: A unit price keeps up to four decimal places, unrounded, from the price book to the invoice line; only the line value is rounded (owner ruling of 2026-10-25).

  - `@endora-commerce/contracts`: new `unitPriceHalfUp(value)` (a unit price at its four places, as `numeric(14,4)` stores it), `unitPriceFractionDigits(value)` and `unitPriceDisplayText(value)` (the one display rule: two places when places three and four are zero, otherwise the significant places, up to four), `grossUnitPriceHalfUp(net, rate, unit?)` (a displayed gross unit price: two places for a two-place net, four for a sub-cent one) and `UNIT_PRICE_PLACES`. In `money-input`: `fourDecimalUnitPrice(schema)`, `fourDecimalUnitPriceString(schema)`, `hasAtMostFourDecimals(value)`, `isUnitPricePrecisionIssue(issue)` and the `UNIT_PRICE_PRECISION_EXCEEDED` constant; new `ERROR_CODES.UNIT_PRICE_PRECISION_EXCEEDED`. A quote's `desiredUnitPrice` (`createQuoteRequestLineSchema`) and `agreedUnitPrice` (`adminCreateQuoteRequestLineSchema`, `adminPatchQuoteRequestLineSchema`) now accept four places; a fifth is refused with the new code. Typed money amounts keep `twoDecimalAmount`. A `money` document value (`documentValueSchema`, `DocumentValue`) takes an optional `unitPrice: true`, and `formatDocumentValue` shows such a value with its significant places, up to four, never fewer than the format's `decimals`.
  - `@endora-commerce/platform`: the error envelope answers `400 UNIT_PRICE_PRECISION_EXCEEDED` when every failed issue of a request is the unit-price precision issue; a request refused for an amount and a unit price at once stays `VALIDATION_FAILED`.
  - `@endora-commerce/mod-i18n`: declares `UNIT_PRICE_PRECISION_EXCEEDED` in the platform block, with its sentence in English and Polish.

### Patch Changes

- 6f1e0ec: Custom-field carry review fixes.

  - **`@endora-commerce/contracts`** — every string of `customFieldCarrySkipLabelSchema` is at most 200 characters (`CUSTOM_FIELD_CARRY_SKIP_LABEL_MAX`, new export); a longer `labelDefault` or per-locale label is refused.
  - **`@endora-commerce/mod-custom-fields`** — the carry port cuts a skip's label snapshot to that limit, since a definition's per-locale labels are not capped, so every skip it plans parses.
  - **`@endora-commerce/mod-quote-requests`** — the Opportunity → Quote Request carry takes the request's row `for update` and plans over the bag it re-reads under the lock, so an administrator's concurrent edit is never overwritten. A carry that fills a field still raises the request's `version`.

- eda7da8: Storefront product reads show a product's per-sales-channel value overrides.

  - **Behaviour change for API clients — channel overrides are now visible on the storefront.** `GET /api/v1/catalog/products/:idOrSlug` (name, description, `seo`, `structuredDataJsonLd`, `attributeValues`, `visibleAttributes`, grouped children and bundle options) and every `GET /api/v1/catalog/products` card name now return the override written in the product scope editor for the request's sales channel and language. The resolver's override slots are walked over the storefront's own baseline language order — the `Accept-Language` language, the channel's default language, `en-US`, `en`, the first stored language — taking the (channel, language) override at each language until the baseline has text for one, so an override never replaces baseline text of an earlier language in that order; the channel-only slot is asked last. Product-link tiles (in the product page's `links` and `GET /api/v1/catalog/products/:idOrSlug/links`) show overrides too, walked over their own pick, which has no channel-default leg. Channel-scoped user attributes return their channel override. A product without an override for that channel answers exactly as before.
  - Override rows are read for the request's sales channel only, once per read section, never per card.
  - **Search result cards show the same name.** Every card of the Meilisearch-served listing (`GET /api/v1/catalog/products?q=…` and `GET /api/v1/search/suggest`) now shows the name the catalogue's listing card shows for the request's sales channel and language, rather than the baseline text. The indexed name is still what the index ranks and sorts by. The request channel's override rows are read once per results page.
  - `@endora-commerce/contracts` exports the slot choice both modules share (`overrideLanguages`, `channelOverrideFor`, `effectiveSystemText`, `StorefrontOverrideContext`) and the resolver's `isNonEmpty` presence test the walk reuses, and `CatalogProductReadPort.listValueOverridesByProductIds` takes an optional `{ channelId }` that narrows the read to one sales channel's rows. Existing callers and implementations are unaffected.

- 2effab9: An ERP sale document's `netTotal`, `taxTotal`, `grossTotal` and `paidTotal` are trimmed before the decimal grammar (issue #417, review of PR #423): an integration that sends surrounding whitespace keeps working, and the trimmed value is what is stored.
- 0f09369: The money-input grammar (issue #417, review of PR #423): trailing zeros are not significant — an ERP integration's `"123.4500"` is a valid 123.45 — and only a significant digit beyond the second place is refused with `AMOUNT_PRECISION_EXCEEDED`. A string that is not a decimal at all (`""`, `"abc"`, `"1e3"`, `"+5.00"`, `"1 234,56"`) is refused with a format issue under `VALIDATION_FAILED`, never with the precision code. `twoDecimalAmountString(schema, { pattern, message })` takes the format to check first; an opportunity's `manualValue` uses it, so a malformed value carries its one format issue and no precision issue on top.
- 8a2fc1b: `settlementRequestSchema` refuses a settlement that names one return case line twice (`400 VALIDATION_FAILED`, issue `duplicate_line` on the repeated `returnCaseItemId`), before anything moves (issue #417, review of PR #423).

## 0.107.0

### Minor Changes

- fcf4d09: New shapes for selecting many products at once in the admin, and named codes for the admin order preview.

  **For a consumer of the contracts.**

  - `ADMIN_PRODUCT_SELECTION_MAX` (`200`) is the most products one admin selection may carry. The
    admin product browser stops at it, and every request that submits such a selection in one call
    uses it as its upper bound.
  - Bulk add to a price list: `bulkAddPriceListProductsRequestSchema` (`{ productIds }`, 1 to
    `ADMIN_PRODUCT_SELECTION_MAX` uuids), `bulkAddPriceListProductsResultSchema`
    (`{ added, unchanged, failed: [{ productId, reason }] }`),
    `bulkAddPriceListProductFailureReasonSchema` (`'product_not_found'`),
    `bulkAddPriceListProductsResponseSchema` (the result under `data`), and
    `priceListIdParamsSchema` (`{ id }`) for the price-list routes, each with its inferred type.
    They describe `POST /api/v1/admin/price-lists-engine/:id/products/bulk-add`, which adds the
    products to the list in one audited write and reports a product already on the list as
    `unchanged`, so sending the same request again is safe.
  - Admin order preview: `adminOrderPreviewMessageCodeSchema`, its type
    `AdminOrderPreviewMessageCode`, and `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE` name the four
    reasons a preview line can be unavailable, in the order they are decided: `PRODUCT_NOT_FOUND`,
    `PRODUCT_NOT_VISIBLE_TO_CUSTOMER`, `PRODUCT_NOT_IN_SALES_CHANNEL`, `QUOTE_ONLY`. A line carries
    at most one message, the first that applies. The two middle codes are new answers of the
    preview.

  **Nothing changes on the wire for existing fields.** `adminOrderPreviewResponseSchema`'s
  `messages[].code` is still a plain string, not narrowed to the new enum, so a client built
  against this version keeps parsing an answer that carries a code it does not know yet — map an
  unknown code to a generic "unavailable" reason rather than failing.

  The documentation of `isProductVisibleTo` now records why the admin order preview may report
  visibility and sales-channel assortment as two distinct codes while every buyer-facing answer
  keeps a single "product not found".

- 70bb5e5: New quote-request shapes for reference prices, a readable history and a per-customer price negotiation lock. The new shapes and fields are additive, and existing callers and structural stubs compile unchanged — with **one behaviour change**: the customer create and draft-edit schemas now cap `items`.

  - **Behaviour change — at most 200 items.** `createQuoteRequestSchema` and `patchQuoteRequestSchema` accept at most 200 `items`; a longer list, which validated before, now fails validation (the API answers `400`). A caller that sends more than 200 lines must split the request. Their strictness is unchanged — an unknown key in the create body is still stripped.

  - **Quote request items** (`quoteRequestItemSchema`) gain optional `referencePrice` (`{ amount, currency, capturedAt } | null`), `customerProposedUnitPrice`, `packagingUnitName` and `packagingUnitBaseQuantity`. `referencePrice` and `customerProposedUnitPrice` are sent in admin replies only; `quoteRequestSchema` likewise gains an admin-only optional `salesChannelId`.
  - **History**: `QUOTE_REQUEST_HISTORY_EVENT_WINDOW` (`100`, how many of the most recent events a history is built from), `quoteRequestHistorySchema` (`{ entries, truncated }`), `quoteRequestHistoryEntrySchema`, `quoteRequestHistoryEntryKindSchema`, `quoteRequestHistoryChangeSchema`, `quoteRequestHistoryActorSchema`, `quoteRequestHistoryLineRefSchema` and their types, for `GET /api/v1/admin/quote-requests/:id/history`.
  - **Price negotiation**: `quoteRequestOrgNegotiationSchema`, `setQuoteRequestOrgNegotiationSchema`, `quoteRequestNegotiationOverrideSchema` (`'inherit' | 'allowed' | 'not_allowed'`), `quoteRequestAccountNegotiationSchema`, `setQuoteRequestAccountNegotiationSchema` and `storefrontQuoteRequestNegotiationSchema`, with their types. The two `set*` admin bodies are strict.
  - **Error code** `RFQ_PRICE_PROPOSAL_NOT_ALLOWED` in `ERROR_CODES`.
  - **`QuoteRequestLineRecord`** gains optional `referenceUnitPrice` and `referenceCurrency` (decimal string and ISO code, both `null` when no reference is stored). Export readers of `quoteRequestReadPort.listItems` should read a cart-converted line's price from `referenceUnitPrice`: those lines now carry `desiredUnitPrice = null`.
  - **`RfqCustomerPort.createForCustomer`** takes an optional third argument, `CreateForCustomerOptions` (`{ lineReferencePrices? }`): server-side reference prices index-aligned with `input.items`, for in-process callers that hold a snapshot the buyer could not have forged. Two-argument callers and implementations stay valid.
  - **`BuyerLinePricePort`** with `BuyerLinePriceQuery`, `BuyerLinePriceLine` and `BuyerLinePriceAnswer`: the net unit price a buyer would pay for many lines on a given sales channel. A new port, so `LinePricePort` and its stubs are unchanged.

- 76f9757: Price matrix contracts and a product read for attribute selections.

  - `price-lists`: `priceMatrixEntryInputSchema`, `priceMatrixEntryPatchSchema`,
    `priceMatrixListQuerySchema`, `priceMatrixEntrySchema`, `priceMatrixListResponseSchema`,
    `priceMatrixEntryResponseSchema`, `priceMatrixAttributeTargetSchema`, the price, selection-kind
    and inactive-reason enums, `priceMatrixSelectionKind()`, `priceMatrixEntryShapeIssues()` and
    `PRICE_MATRIX_MAX_ENTRIES_PER_LIST` (5 000), with their types.
  - `ERROR_CODES` gains `PRICE_MATRIX_ENTRY_NOT_FOUND`, `PRICE_MATRIX_ENTRY_OVERLAP`,
    `PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE` and `PRICE_MATRIX_ENTRY_LIMIT`.
  - `CatalogProductReadPort` gains `listProductIdsByAttributeValue({ key, value, match })`
    (`CatalogAttributeValueQuery`, `match: 'scalar' | 'array' | 'boolean'`). This is a new required
    member: a hand-written implementation or test stub of the port must add it.

- 05d0650: Additive contract surface for order and quote status push notifications.

  - `PWA_SETTING_CODES.PUSH_ORDER_STATUS_ENABLED` (`pwa.push_order_status_enabled`) and
    `PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED` (`pwa.push_quote_status_enabled`).
  - `PwaPublicConfigSchema` gains the required booleans `orderStatusPushEnabled` and
    `quoteStatusPushEnabled` — the effective values for the request's channel.
    `PwaAdminConfigSchema` gains the same two fields (raw values for the scope) and
    `UpdatePwaConfigRequestSchema` accepts both as optional booleans.
  - New `PushPreferencesSchema` / `PushPreferences` (`{ orderStatus, quoteStatus }`) and
    `UpdatePushPreferencesRequestSchema` / `UpdatePushPreferencesRequest` (strict, at least one
    field) for `GET`/`PUT /api/v1/storefront/pwa/preferences`.
  - `OrderReadPort.findStatusDefinition(code)` returning the new `OrderStatusDefinitionRecord`
    (`{ code, name, defaultName }`) or `null`. A test double that implements `OrderReadPort` in
    full must add the method.
  - `QuoteRequestRecord.salesChannelId: string | null` — the channel the request was raised on.

- bf9881f: New `admin-search` exports for admin global search, and two optional criteria on the customer admin search.

  - Schemas: `AdminSearchEntityTypeSchema`, `AdminSearchFieldCodeSchema`, `AdminSearchLabelKeySchema`,
    `AdminSearchQuerySchema`, `AdminSearchHitSchema`, `AdminSearchTargetRouteSchema`,
    `AdminSearchGroupSchema`, `AdminSearchResultSchema`, `AdminSearchResponseSchema`,
    `AdminSearchCapabilitySchema`, `AdminSearchCapabilityQuerySchema`,
    `AdminSearchConfigurationViewSchema`, `UpdateAdminSearchConfigurationRequestSchema`,
    `AdminSearchStoredConfigurationSchema` and their inferred types, plus
    `ADMIN_SEARCH_DEFAULT_STORED_CONFIGURATION` and the limits `ADMIN_SEARCH_MAX_FIELDS`,
    `ADMIN_SEARCH_MAX_ENTITY_TYPES`, `ADMIN_SEARCH_MAX_QUERY_LENGTH`, `ADMIN_SEARCH_MAX_LIMIT`.
  - Provider contract: `AdminSearchProvider`, `AdminSearchFieldDescriptor`, `AdminSearchProviderQuery`,
    `AdminSearchProviderHit`, `AdminSearchProviderResult`, `AdminSearchAbortSignal` and
    `AdminSearchProviderRegistryPort` (container name `adminSearchProviderRegistry`, owner
    `admin_search`). A module makes its records findable by pushing a provider into that registry from a
    contribution-only boot hook.
  - `CustomerAccountAdminSearchCriteria` gains `qFields?: ('email' | 'name')[]` — match `q` only against
    those fields, literally, most relevant first — and `excludeDeleted?: boolean` — leave out deleted and
    anonymized accounts. Both are optional; a caller that sets neither gets exactly what it got before.

- 8397b0f: LLM configurations can now reach DeepSeek and any OpenAI-compatible endpoint. The `llm` credential type gains the provider `openai_compatible` ("OpenAI-compatible (custom endpoint)"), whose Base URL is required; every `llm` provider's Base URL is validated on save as an absolute `http://` or `https://` URL through the new optional `FieldDefinition.format: 'url'`, and the credential form renders such a field as a URL input. `createLlmAdapter` honours the Base URL for `openai`, `deepseek` (default `https://api.deepseek.com`) and `openai_compatible`, and throws `LlmConfigurationError` for a missing or invalid one. `LlmProviderSchema` in `@endora-commerce/contracts` is the one provider list (`PromptActionsProviderSchema` is now its alias), and the AI assistant accepts DeepSeek and OpenAI-compatible configurations where it used to report them as not configured.
- 8397b0f: Page Builder translation. A **Translate** action in the Page Builder toolbar translates the canvas of the language tab being edited — or only the selected component or text — with the LLM configured in Settings → Page Builder (`cms.page_builder.translation.enabled`, `…llm_credentials`, `…max_source_characters`; off by default), behind the new permission `cms.translate`, through `GET /api/v1/admin/cms/page-builder/translation` and `POST /api/v1/admin/cms/page-builder/translate`. The result is an unsaved change with _Restore previous content_; every request that sent text is audited as `cms.page_builder.translate`.

  For block authors: `BlockDefinition` gains an optional `translatable: [{ path, format? }]` (`format` `plain` | `tiptap` | `html`, paths like `items[].title`) naming the props that are prose; it is served on the Page Builder descriptor. A block without it is never sent to a model. Every CMS-context block of `cms` and `catalog` declares it. `PageBuilderHeaderActions` gains an optional `extraActions` slot, and the blog post and category editors pass the editor what the action needs.

- dd939be: Document templates — the shapes of `specs/152-compare-pdf-template/`.

  **New in `@endora-commerce/contracts`** (`document-templates.ts`):

  - The template content envelope and its limits: `documentTemplateContentSchema`
    (`{ schemaVersion: 1, languages: { <lang>: <tree> } }`), `documentTemplateTreeSchema`,
    `documentRootPropsSchema`, `DOCUMENT_TEMPLATE_LIMITS`, `GENERIC_DOCUMENT_PAGE_DEFAULTS`,
    `documentContentByteSize`, `CORE_BLOCK_NAMES`, `documentTypeCodeSchema`, `mergeFieldKeyRe`.
  - The host seams: `DocumentTypeRegistration<TData, TPrepared>` (blocks, `coreBlocks`, `selection`,
    `languages`, `variables`/`resolveVariables`, `defaultContent`, `renderBuiltIn`, `pageDefaults`,
    `suggestOrientation`, `prepareRender`, `sampleData`), `DocumentBlockRenderer`,
    `DocumentTypeRegistryPort` (container name `documentTypeRegistry`), `DocumentRenderPort`
    (`documentRenderPort`) with `DocumentRenderInput` / `DocumentRenderResult`.
  - The admin API DTOs of `/api/v1/admin/document-templates`, and six error codes in `ERROR_CODES`:
    `DOCUMENT_TEMPLATE_NOT_FOUND`, `DOCUMENT_TYPE_NOT_AVAILABLE`, `DOCUMENT_TEMPLATE_INVALID`,
    `DOCUMENT_TEMPLATE_IS_DEFAULT`, `DOCUMENT_TEMPLATE_NOT_SELECTABLE`, `DOCUMENT_RENDER_FAILED`.
  - `comparisonDocumentDataSchema` / `ComparisonDocumentData` and `invoiceDocumentDataSchema` /
    `InvoiceDocumentData` — what `comparisons` and `invoices` hand the render port.

  **Widened enums** (additive): `pageBuilderContextSchema` gains `'document'`, and
  `AdminBlockContributionSchema.context` gains `'document'` — a module contributes the canvas
  renderer of its document blocks with `context: 'document'`.

- d571d8c: Line collections, the Line items table and the quote request PDF (`specs/153-quote-request-pdf-template/`).

  **New** (`document-templates.ts`, `document-values.ts`, re-exported from the package root):

  - Typed document values and the functions shared by the PDF renderer and the editor canvas:
    `DocumentValue`, `documentValueSchema`, `documentValueHasValue`, `formatDocumentValue`,
    `evaluateDocumentCondition` (`DocumentCondition`: `always`, `never`, `has_value`,
    `any_has_value`, over a scope of items, one item or the totals), `sumDocumentValues`,
    `resolveDocumentAlign`, `documentFieldPathRe`, `isReservedFieldPath`, `DOCUMENT_POSITION_FIELD`.
  - `DocumentCollectionDeclaration`, `DocumentFieldDefinition`, `DocumentItem`; the optional
    `collections` member of `DocumentTypeRegistration`; `COLLECTION_BLOCK_NAMES`,
    `ITEMS_TABLE_BLOCK_NAME`, `ITEMS_TABLE_LIMITS` and `itemsTablePropsSchema` (the stored settings of
    `document_templates.ItemsTable`).
  - `documentTypeDetailSchema` gains `collections` (defaults to `[]`).
  - **`DocumentRenderPort` gains a required `listChoices({ documentType, salesChannelId })`**
    answering `DocumentTemplateChoices` (`documentTemplateChoicesSchema`). An implementation of the
    port outside `document_templates` must add it; callers are unaffected.
  - Quote requests: `QUOTE_REQUEST_DOCUMENT_TYPE`, `QUOTE_REQUEST_PDF_LIMITS`,
    `quoteRequestDocumentDataSchema`, `quoteRequestDocumentChoicesSchema`,
    `setQuoteRequestDocumentTemplateSchema`, `quoteRequestPdfQuerySchema`,
    `quoteRequestPdfSendRequestSchema`, `quoteRequestPdfSendResultSchema`; `quoteRequestSchema` gains
    the optional admin-only `documentTemplateId`; `rfqEventTypeSchema` gains `'pdf-sent'` and the
    history entry kind `'pdf_sent'` with an optional `delivery`.
  - Error codes `QUOTE_REQUEST_PDF_TOO_LARGE`, `QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE`,
    `QUOTE_REQUEST_PDF_SEND_FAILED`.

- 34f97ae: `CartCustomerContext.salesChannelId` is now **required** (`specs/154-sales-channel-access/`, User
  Story 6). A customer holds one active basket per sales channel, so every caller of
  `CartReadPort` and `CartWritePort` names the channel whose basket it means — the channel of its
  own request, or the channel an operator-created order names.

  Before: `cartWritePort.getOrCreateForCustomer({ customerAccountId, organizationId })`.
  After: `cartWritePort.getOrCreateForCustomer({ customerAccountId, organizationId, salesChannelId })`.

- f61fea3: `storefrontCrawlerFilesSchema` gains an optional `anonymousAccess` boolean: `false` on a sales
  channel closed to anonymous visitors, whose `robots.txt` then disallows everything and whose
  `llms.txt` lists nothing. Optional so that an answer from an earlier backend, which never sends
  it, still parses; read its absence as `true`.
- afaa86a: Admin shapes for an Organization's sales channels and for creating an Organization
  (`specs/154-sales-channel-access/`).

  - `OrganizationSalesChannelsResponseSchema` — `GET`/`PUT /api/v1/admin/organizations/:id/sales-channels`:
    the assigned channel ids and every channel option, each `OrganizationSalesChannelOptionSchema`
    (`SalesChannelOptionSchema` plus `systemDefault`).
  - `OrganizationSalesChannelsUpdateBodySchema` — `{ salesChannelIds }`, 1 to 100 distinct uuids.
  - `OrganizationSalesChannelOptionsResponseSchema` — `GET /api/v1/admin/organizations/sales-channel-options`.
  - `AdminOrganizationCreateBodySchema` — `POST /api/v1/admin/organizations`: the organization part of
    `registerOrganizationRequestSchema` plus `status` (`active` by default, or `pending_verification`)
    and `salesChannelIds` (at least one). `AdminOrganizationCreateRequest` is the body before defaults.

- 248a9df: Sales-channel access shapes (`specs/154-sales-channel-access/`).

  - `SalesChannelSummarySchema` / `SalesChannelDetailSchema` gain a required `anonymousAccess`;
    `SalesChannelCreateBodySchema` accepts it (default `true`) and `SalesChannelUpdateBodySchema`
    accepts it optionally. `SalesChannelCreateRequest` is the body a client sends before defaults
    apply.
  - `PublicSalesChannelSchema` gains `anonymousAccess`.
  - New `SalesChannelAccessResponseSchema` for `GET /api/v1/storefront/sales-channel/access`.
  - `ERROR_CODES` gains `SALES_CHANNEL_SIGN_IN_REQUIRED`, `SALES_CHANNEL_NOT_PERMITTED` and
    `ORDER_SALES_CHANNEL_MISMATCH`.
  - `CartCustomerContext` gains an optional `salesChannelId`.

- cb098b7: The permalink rule for library assets, the request shapes for setting a permalink and restoring a previous file version, and seven new error codes.

  **For a consumer of the contracts.**

  - `validateAssetPermalink(value)` — the one permalink rule the server and the admin form share.
    It answers `{ ok: true }` or `{ ok: false, reason }`, the reason being the first broken rule
    of, in this order: `empty`; `too_long` (more than `ASSET_PERMALINK_MAX_LENGTH`, `200`,
    characters); `invalid_characters` (anything outside letters, digits, `-`, `_`, `.` and `/`);
    `invalid_segment` (a leading or trailing `/`, `//`, or a `.` or `..` part); `uuid_shaped`
    (the whole value has the shape of an asset id, in either case). A value such as
    `<uuid>.pdf` is accepted. The reason union is exported as `AssetPermalinkInvalidReason`.
  - `isAssetIdShaped(segment)` — true for a UUID in either case; it is how a file URL decides
    whether its path names an asset id or a permalink.
  - `assetPreviousVersionSchema` (`AssetPreviousVersion`) — the one kept previous version of an
    asset's file: `filename`, `mimeType`, `sizeBytes`, `contentVersion`, `replacedAt`,
    `replacedBy` (`{ id, displayName }` or `null`) and `restorableUntil`.
  - `setAssetPermalinkRequestSchema` (`SetAssetPermalinkRequest`) — `{ permalink, confirmReuse? }`.
    The schema only bounds the length of `permalink`; its shape is judged by
    `validateAssetPermalink`. `confirmReuse: true` acknowledges taking a permalink whose last
    holder was a different asset.
  - `restorePreviousAssetVersionRequestSchema` (`RestorePreviousAssetVersionRequest`) —
    `{ expectedContentVersion, expectedPreviousContentVersion }`, both required and non-empty, so
    a restore always names the file it replaces and the file it brings back.
  - Seven `ERROR_CODES` members, all owned by the assets library: `ASSET_REPLACE_KIND_MISMATCH`,
    `ASSET_LEGACY_CANNOT_REPLACE`, `ASSET_REPLACE_CONFLICT`, `ASSET_NO_PREVIOUS_VERSION`,
    `ASSET_PERMALINK_TAKEN`, `ASSET_PERMALINK_PREVIOUSLY_USED` and `ASSET_PERMALINK_INVALID`
    (whose `details.code` carries the validator's reason).

  **New members on existing shapes — additive for a reader, required for anyone constructing one.**

  - `assetSummarySchema` (and so `AssetSummary`, `AssetDetail` and every response carrying them)
    gains four required members: `fileUrl` (the stable, unversioned file URL, the same across
    replaces), `permalink` (string or `null`), `permalinkUrl` (the absolute permalink URL, or
    `null`) and `contentVersion` (the identity of the bytes the asset currently holds).
  - `AssetRecord` gains `contentVersion: string` and `permalink: string | null`.

  - `AssetDetail` gains `retentionDays` (a whole number, at least 1): the retention, in days, the sweep applies — how long a replaced file stays restorable.
  - `AssetDetail` gains `replaceable` (boolean): whether the file can be replaced in place — false for a legacy row and for a row with no storage key.
  - New `folderPermalinkCountResponseSchema` (`{ data: { permalinkedAssets } }`) for the folder delete confirmation's count.

  A client that only reads these shapes needs no change. Code that builds an `AssetSummary`,
  `AssetDetail` or `AssetRecord` by hand — a test fixture, a mock, an optimistic list update — must
  add the new members. The `url` and `storageUrl` members keep their shape (a string), but their
  values now carry `?v=<contentVersion>` for public assets — see the
  `@endora-commerce/mod-assets-library` changeset of this release for which values change and why.

  The routes that use the request schemas arrive with the assets library release that ships them.

- 3d5a203: A product sold on request only is refused by the cart whether or not a price list holds it. `CartService.addItem` read the display mode off the resolved list price, so a product no price list prices — priced from the catalogue attribute — resolved nothing, the `CART_PRODUCT_QUOTE_ONLY` guard was skipped, and `POST /api/v1/cart/items` added the line with `200`. It now answers `400 CART_PRODUCT_QUOTE_ONLY` for it too.

  `@endora-commerce/contracts` publishes `ProductDisplayModePort` — `resolveDisplayMode({ productId, organizationId, salesChannelId, customerKind })` — and `@endora-commerce/mod-price-lists` provides it as `productDisplayModePort`, over the same Product → Category → Organization → Settings chain its storefront display-mode route answers with. `CartService` takes it as a new required constructor argument, after `channelMembership`; the module's own composition wires it.

- 5865c59: The API description is available to administrators with the `platform.api_description.read` permission and to API keys with the `platform.api_description.read` scope.

  **`@endora-commerce/platform`.**

  - New permission `platform.api_description.read` (_Read the API description_), declared by `_lifecycle`'s manifest with English and Polish labels. The platform administrator grants it through an admin role.
  - `GET /api/v1/_openapi.json` and `GET /api/v1/_docs` now answer only an administrator holding the code or an API key whose scopes include it. Anybody else is answered `401 UNAUTHORIZED` (no administrator session or key, a customer session included) or `403 FORBIDDEN` (an administrator or a key without the code). Both stay outside the sales-channel access rule (`salesChannelAccess: 'open'`). Responses carry `Cache-Control: private, no-store`.
  - New admin route `GET /api/v1/admin/api-description`, gated on the same code, serving the same document to the Admin UI.
  - `buildServer` no longer mounts the two routes. It decorates the root instance with `apiDescription(): OpenAPIV3_1.Document` (built on first call, as before), and `_lifecycle` mounts the routes where `auth`'s `requireAdmin` port is available. A composition that mounts no `_lifecycle` serves no API description; one that called `buildServer` and read `/api/v1/_openapi.json` in-process reads `app.apiDescription()` instead, or sends credentials. `registerOpenApiRoutes` is removed; it was reachable only through the host-internal `./http/openapi` subpath.
  - The reference page loads `swagger-ui-dist@5.33.3` from jsDelivr with Subresource Integrity on both files (`swagger-ui.css` `sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW`, `swagger-ui-bundle.js` `sha384-h00llMzD1afyNow1pDmnZKlHsUZgp9KE9HXLFXF2CvbwsBY0+WBO4f75SfGwvM4K`) and `crossorigin="anonymous"`; it used to load an unpinned version.
  - A command-palette action, _API description_, targets `/api-description` and requires the new code.

  **`@endora-commerce/contracts`.** `apiKeyScopeSchema` gains `'platform.api_description.read'`, so an administrator who holds the code can issue an API key that reads the API description.

  **`@endora-commerce/admin-shell`.** New kernel-served screen `/api-description` (_System → API description_, gated on `platform.api_description.read`): the document's title, version and endpoint count, a JSON download, and a link that opens the interactive reference on the API's own address in a new tab, carrying the administrator session.

  **`@endora-commerce/mod-i18n`.** The screen's strings and its navigation label in English and Polish (`platform.apiDescription.*`, `appShell.nav.platformApiDescription`).

  **`@endora-commerce/mod-api-keys`.** The module page lists the new scope.

- e9a92b9: Saved views on the admin product list (#289).

  - The Product list's toolbar carries the admin kit's saved-views control: a selector of the admin's own views and every shared view, _Save view_ and _Delete view_. A view is named, private or shared, and stores the list's status tab, type chip and search text — only the ones not at their default. The Stock, Category and Channel chips are not saved. Loading a view replaces status, type and search, returns Stock to _All_, goes back to the first page and clears the row selection; a status or type the list no longer offers loads as _All_, and keys the list does not know are ignored. Any admin who can open the Product list (`catalog:read`) can use it.
  - Four new routes, gated by `catalog:read`: `GET` and `POST /api/v1/admin/catalog/products/list-views`, `PATCH` and `DELETE /api/v1/admin/catalog/products/list-views/{id}`. A view stores the list's filters only (`sort` and `visibleColumns` in a request body are ignored). `GET` returns the caller's own views and every shared view, ordered by name; every item carries `ownedByCaller` and `canModify`. Another admin's private view answers `404`; a shared view is modified or deleted only by its owner or a platform admin (any role except `sales_representative`), `403` otherwise. All four routes answer `401 UNAUTHORIZED` when no admin session resolves.
  - A `PATCH` that changes nothing — an empty body, or every value as already stored — writes nothing and logs nothing; it answers `200` with the current view. It is still refused (`403`/`404`) to a caller who may not modify the view.
  - `PATCH` and `DELETE` answer an `id` that is not a UUID with the same `404 NOT_FOUND` as a view that does not exist.
  - Names are trimmed, 1–160 characters, without control or format characters. One admin cannot hold two views on the product list whose names differ only by letter case or surrounding spaces: `POST`, and a `PATCH` that changes the name, answer `409 PRODUCT_SAVED_VIEW_NAME_TAKEN` with a translated message (English and Polish). The rule binds the view's owner.
  - New table `product_list_saved_views`, created by the migration `Migration20261014T170531CatalogProductListSavedViews`, with a unique index on the owner and the lower-cased name.
  - When a platform admin changes or deletes another admin's view, the `catalog` module logs one `info` record (`event: 'saved_view.updated' | 'saved_view.deleted'`, `list`, `viewId`, `ownerAdminUserId`, `actorAdminUserId`).

  `@endora-commerce/contracts` gains the `ERROR_CODES.PRODUCT_SAVED_VIEW_NAME_TAKEN` member.

- d76291d: Storefront catalogue reads can be priced in the currency the shopper selected. `GET /api/v1/catalog/products`, `GET /api/v1/catalog/products/:idOrSlug` and `GET /api/v1/catalog/products/:idOrSlug/links` accept `?currency=` (an ISO 4217 code, any case). The listing price, the price ordering, the price-range filter, the link tiles and the Meilisearch-served listing are all resolved in that currency when the request's sales channel lists it in its `currencies`, and in the channel's `defaultCurrency` otherwise. A malformed code answers `400 VALIDATION_FAILED`. Without the parameter, every read asks the pricing engine exactly what it asked before.

  `@endora-commerce/contracts` exports the pieces both modules use: `listingCurrencyQuerySchema` (the parameter), `resolveListingCurrency(requested, channel)` (requested if the channel offers it, else its default) and `listingPriceChannelContext(channel, currency)` (the `salesChannel` and `currencyCode` half of a `ListingPriceViewerContext`, with the default currency left implicit). `SearchQueryContext` gains an optional `currency`.

  `@endora-commerce/mod-price-lists`: a listing priced in a currency other than the channel's default no longer falls back to the Product's own `defaultPrice` / `price` attribute. That attribute has no currency of its own and was entered in the default one, so the fallback would have quoted, for example, 100 PLN as 100 EUR; such a product now has no listing price in that currency (`source: 'none'`). In the default currency nothing changes.

- ecd23de: `importExportEntitySchema` (and so `importExportEntitiesResponseSchema`) gains two required
  booleans, `canExport` and `canImport`: whether the caller may export and import the entity.
  `GET /api/v1/admin/import-export/entities` lists an entity only when one of them is true. An
  entity whose import is supported but not permitted keeps its `importHeader` and carries
  `canImport: false`; `importHeader: null` still means the import does not exist.
- 3acae57: Behaviour change for API clients of the order list's saved views (`/api/v1/admin/orders/list-views`).

  - Names are stored trimmed. One admin can no longer hold two saved views on the order list whose names differ only by letter case or surrounding spaces: `POST`, and a `PATCH` that changes a view's name, answer `409 ORDER_SAVED_VIEW_NAME_TAKEN` with a translated message (English and Polish). The rule binds the view's owner — a platform admin renaming a colleague's shared view is refused when the colleague already uses that name. Duplicates saved before this release are kept, and a `PATCH` that does not change the name is never refused for one.
  - Every item returned by `GET`, `POST` and `PATCH` carries two booleans computed for the caller: `ownedByCaller`, and `canModify` (the caller owns the view, or the view is shared and the caller is a platform admin).
  - A `PATCH` that changes nothing — an empty body, or every value as already stored — writes nothing and logs nothing; it answers `200` with the current view. It is still refused (`403`/`404`) to a caller who may not modify the view.
  - `PATCH` and `DELETE /api/v1/admin/orders/list-views/{id}` answer an `id` that is not a UUID with the same `404 NOT_FOUND` as a view that does not exist, instead of `500`.
  - All four routes answer `401 UNAUTHORIZED` when no admin session resolves, instead of acting under an empty owner id.
  - Who counts as a platform admin for saved views is now read from the request's tenant context (`mode === 'all'`: any role except `sales_representative`), as on the product and quote request lists. It fails closed: an admin whose reach cannot be resolved — no admin tenant scope composed, or no resolvable role — is no longer treated as a platform admin, so `canModify` is `false` on other admins' shared views and modifying or deleting one answers `403`.
  - When a platform admin changes or deletes another admin's view, the `orders` module logs one `info` record (`event: 'saved_view.updated' | 'saved_view.deleted'`, `list`, `viewId`, `ownerAdminUserId`, `actorAdminUserId`).

  `@endora-commerce/contracts` gains the `ERROR_CODES.ORDER_SAVED_VIEW_NAME_TAKEN` member.

- b96321c: Saved views on the admin Quote Request list (#290).

  - The Quote Request list's toolbar carries the admin kit's saved-views control beside the column picker: a selector of the admin's own views and every shared view, _Save view_ and _Delete view_. A view is named, private or shared, and stores the list's visibility scope, organization, status selection, search text, sort and visible columns. Loading a view replaces all six and goes back to the first page; a status or column the list no longer offers is dropped, an empty column selection loads the default columns, an unknown sort loads _Newest_, and a view without a scope loads the viewer's default (_All_ for a platform admin, _My organizations_ otherwise). Any admin who can open the Quote Request list (`rfqs:handle`) can use it.
  - Loading a view never widens what the loader sees: the list request that follows is the loader's own, narrowed to the organizations they reach, and a saved `scope: 'mine'` means the loader's assignments. A view stores an organization by id only, and the list never shows the name of an organization the loader cannot see — a captured organization outside their scope shows as an id prefix and an empty list.
  - Four new routes, gated by `rfqs:handle` and by the module's presence: `GET` and `POST /api/v1/admin/quote-requests/list-views`, `PATCH` and `DELETE /api/v1/admin/quote-requests/list-views/{id}`. A view stores the list's filters, and optionally its sort (`{ field, dir }`) and visible columns; `null` for either means the list's default. `GET` returns the caller's own views and every shared view, ordered by name; every item carries `ownedByCaller` and `canModify`. Another admin's private view answers `404`; a shared view is modified or deleted only by its owner or a platform admin (any role except `sales_representative`), `403` otherwise. All four routes answer `401 UNAUTHORIZED` when no admin session resolves.
  - A `PATCH` that changes nothing — an empty body, or every value as already stored — writes nothing and logs nothing; it answers `200` with the current view. It is still refused (`403`/`404`) to a caller who may not modify the view.
  - `PATCH` and `DELETE` answer an `id` that is not a UUID with the same `404 NOT_FOUND` as a view that does not exist.
  - While `quote_requests` is switched off, all four routes answer `503 MODULE_DISABLED` exactly as the Quote Request list does; saved views are kept and are served again once the module is back.
  - Names are trimmed, 1–160 characters, without control or format characters. One admin cannot hold two views on the quote request list whose names differ only by letter case or surrounding spaces: `POST`, and a `PATCH` that changes the name, answer `409 RFQ_SAVED_VIEW_NAME_TAKEN` with a translated message (English and Polish). The rule binds the view's owner.
  - New table `quote_request_list_saved_views`, created by the migration `Migration20261014T173236QuoteRequestsQuoteRequestListSavedViews`, with a unique index on the owner and the lower-cased name.
  - When a platform admin changes or deletes another admin's view, the `quote_requests` module logs one `info` record (`event: 'saved_view.updated' | 'saved_view.deleted'`, `list`, `viewId`, `ownerAdminUserId`, `actorAdminUserId`).

  `@endora-commerce/contracts` gains the `ERROR_CODES.RFQ_SAVED_VIEW_NAME_TAKEN` member.

- 9d8f8c5: New `saved-list-views` exports — the one wire shape and write rule shared by the order, product and quote-request saved-view endpoints: `savedListViewSchema` (with `savedListViewListResponseSchema`, `savedListViewResponseSchema`, `savedListViewDeleteResponseSchema`), `savedListViewNameSchema`, `savedListViewSortSchema`, `savedListViewFiltersSchema`, `savedListViewColumnsSchema`, `createProductSavedViewRequestSchema` / `updateProductSavedViewRequestSchema` (filters only; `sort` and `visibleColumns` are stripped), `createQuoteRequestSavedViewRequestSchema` / `updateQuoteRequestSavedViewRequestSchema`, the constants `SAVED_LIST_VIEW_NAME_MAX` (160), `SAVED_LIST_VIEW_FILTERS_MAX_BYTES` (8192), `SAVED_LIST_VIEW_COLUMNS_MAX` (64) and `SAVED_LIST_VIEW_TOKEN_MAX` (64), and the helpers `hasForbiddenNameCharacters` and `savedListViewNameKey` (trim, then case-insensitive and independent of the host locale — the key two names are compared by for uniqueness).

  `orderSavedViewSchema` gains two required booleans, `ownedByCaller` and `canModify`; its `sort` stays required and non-null. A reader parsing a reply gains the fields; code that builds an `OrderSavedView` by hand must now supply them.

  `createOrderSavedViewRequestSchema` and `updateOrderSavedViewRequestSchema` keep their names but tighten what they accept. An order saved-view name is now trimmed before its 1–160 character limit is applied, so a whitespace-only name is refused, and it may not contain control or format characters (`\p{Cc}`, `\p{Cf}` — NUL, bidi overrides, zero-width characters). `filters` is limited to 8192 UTF-8 bytes of its JSON, `visibleColumns` to 64 entries of at most 64 characters each, and `sort.field` to 64 characters (it may no longer be empty). A body breaking any of these fails validation.

### Patch Changes

- edac0be: `POST /api/v1/admin/orders` now honours the sales channel the operator chose for the order.

  - A `salesChannelId` that names no sales channel is refused with `404 NOT_FOUND` before anything is written; the customer's basket is left as it was. It used to be accepted and the order was placed on the system-default channel.
  - The ordered products are checked against the assortment of the order's channel rather than the channel the admin request itself resolved (the system default, unless a channel header is sent). A product the chosen channel sells is now accepted even when the default channel does not sell it, and a product the chosen channel does not sell is refused with `404 PRODUCT_NOT_FOUND` even when the default channel sells it.

  `CartWritePort.addItem` accepts an optional `salesChannelId` in its input: the channel whose assortment decides whether the product may be added. Without it the request's resolved channel decides, as before. Buyer-facing cart, shopping-list and quick-order paths do not pass it and behave exactly as before.

- fe48d6d: Administrators hand out only the permissions their own role holds. A holder of the wildcard `*` is unaffected.

  - `PUT /api/v1/admin/admin-roles/:code` refuses a role holding a permission the actor lacks, and refuses to change a role that already holds one, with `403 ADMIN_ROLE_GRANT_EXCEEDED` (`details.permissions` names the missing codes). A role the platform or a module seeds — `platform_admin` included, with its `requiresTwoFactor` flag — is changed only by a holder of `*`; anybody else is answered `409 ADMIN_ROLE_PROTECTED` with `details.code: 'modify'`.
  - `POST` and `PATCH /api/v1/admin/admin-users` assign a role only if the actor holds every permission it grants (`403 ADMIN_ROLE_GRANT_EXCEEDED`). An account whose role holds a permission the actor lacks is not edited, given a password, deactivated or deleted by them: `403 ADMIN_USER_OUTRANKS_ACTOR`.
  - `POST /api/v1/admin/api-keys` issues a key only with scopes the issuing administrator's role holds: `403 API_KEY_SCOPE_NOT_HELD`, with the missing scopes in `details.scopes`. `api_keys` now declares `admin_roles` as a dependency.

  `AdminRolePort.upsertByCode(input, options?)` takes an optional `{ grantor: { permissions } }`. Pass it for a write made on an administrator's behalf; leave it out for a platform write — a module seeding its roles, an upgrade step, the bootstrap command — which is not held to the ceiling. `@endora-commerce/contracts` exports `permissionsNotHeld(requested, held)` and `ADMIN_PERMISSION_WILDCARD`, and three new `ERROR_CODES` members.

- 4f9daef: `POST /api/v1/analytics/events` now stores, and forwards to GA4, the identity the server resolved
  for the request rather than the one the event body names: `customerAccountId` and
  `organizationId` come from the signed-in customer (none for any other caller), and
  `salesChannelId` is the request's resolved sales channel. The three body fields on
  `ingestAnalyticsEventSchema` are still accepted, so existing senders keep validating, but they are
  ignored and marked `@deprecated`.

  The route also carries its own rate limit, `ANALYTICS_INGEST_RATE_LIMIT` (60 batches per minute
  per client IP), on top of the host's global ceiling. `AnalyticsIngestService.ingest` takes a
  required `context` (`IngestContext`) carrying the resolved channel and identity.

- 7d2d00f: Two new members of `ERROR_CODES`: `CART_PRODUCT_UNPRICED` (a product with no price cannot be
  added to a cart) and `CART_PRICE_CHANGED` (an order placement refused because a cart line's stored
  price is no longer current; `details.lines` names the lines).
- 1525d86: Customer sign-in, the customer second factor and password-reset requests are now limited per
  account, the way administrator sign-in already was.

  - `@endora-commerce/platform/kernel` publishes `AuthenticationAttemptThrottle`, the attempt
    counter administrator sign-in used, with the profile types an owner of accounts builds one
    over (`AttemptThrottleProfile`, `AttemptPolicy`, `AttemptCounterStore`, `ThrottledAttempt`,
    `ThrottledCheckResult`, `ThrottledCredentialState`) and `ADDRESS_POLICY`, `ACCOUNT_POLICY`,
    `ABANDONED_AFTER_SECONDS`, `DEFAULT_STORE_DEADLINE_MS`, `addressOrigin`. `admin_users`' own
    throttle is now a profile over it; its keys, cookie values, codes and audit rows are unchanged.
  - `@endora-commerce/contracts` adds `CustomerAuthenticationThrottlePort` (container name
    `customerAuthenticationThrottlePort`, owner `customer_accounts`) with
    `CustomerAuthenticationAttempt`, `CustomerAuthenticationCheckResult`,
    `CustomerAuthenticationOrigin` and `CustomerAuthenticationFactor`; the error codes
    `CUSTOMER_AUTHENTICATION_THROTTLED` (429, with `Retry-After`) and
    `CUSTOMER_AUTHENTICATION_UNAVAILABLE` (503); the cookie name
    `CUSTOMER_KNOWN_DEVICE_COOKIE_NAME` (`b2b_customer_device`) and its lifetime. Optional
    additions: `CustomerLoginInput.knownDevice`, `CustomerLoginResult.knownDevice`, and a second
    `context` argument on `CustomerPasswordResetPort.requestReset`.
  - `customer_accounts` counts wrong passwords per folded e-mail address (50 in 30 minutes from a
    device the account has not signed in on, 10 from a known one), and password-reset requests per
    address (5 an hour). There is no per-address counter: the storefront signs shoppers in from its
    own server. A completed sign-in sets the signed `b2b_customer_device` cookie, and an attempt
    carrying it is held to that device's own budget. Asking for a new reset link retires the
    earlier unused ones.
  - `mfa` checks customer second-factor codes inside the customer throttle (20 in 30 minutes,
    10 from a known device) and sets the customer known-device cookie when a customer sign-in
    completes there.
  - `organizations` reads and sets the customer known-device cookie on
    `POST /api/v1/auth/customer/login` and reads it on `POST /api/v1/auth/password-reset/request`.

- 0472475: Two changes that keep a stored protection from being dropped as a side effect of another change.

  - **`mfa` is not switched off while administrators are required to use a second factor.** `POST /api/v1/admin/modules/mfa/activation` with `{ active: false }` answers `409 MFA_DEACTIVATION_BLOCKED` (`details.setting: 'mfa.admin.totp_enforced'`) while that setting is on, and changes nothing. Turn the requirement off first; the switch-off then goes through as before, and switching `mfa` back on is never refused. `mfa` publishes the answer as `mfaDeactivationGuardPort` (`MfaDeactivationGuardPort` in `@endora-commerce/contracts`).
  - **A stored credential secret is not carried over to a changed endpoint.** `PUT /api/v1/admin/credentials/:code` that changes a field saying where the record's secrets are sent — an LLM `baseUrl`, an SMTP `host` — answers `422 CREDENTIAL_SECRET_REENTRY_REQUIRED` (`details.fields` lists the secret keys) unless every stored secret is re-entered in the same request. The admin form marks those secret fields as soon as the endpoint is edited. `FieldDefinition` gains an optional `endpoint` flag (defaulting to `true` for `format: 'url'` fields) and `@endora-commerce/contracts` exports `isCredentialEndpointField`; a module registering its own configuration type gets the rule for its URL fields without a change, and declares `endpoint: true` on a host field that is not a URL.

- dd9ab59: Campaign e-mails can carry open and click tracking, switched on by an operator. When it is on
  and a campaign is sent, each recipient's message gets an invisible 1×1 image and its absolute
  `http(s)` links are routed through the click redirect, each with a signed token bound to the recipient's send record, a link id
  (`link-1`, `link-2`, … in document order) and the link's destination. `mailto:`, `tel:`, in-page
  anchors, relative links and the module's own unsubscribe and confirmation links are left as they
  are; the plain-text part is sent unchanged. The per-campaign opened and clicked counts and the
  per-link clicks reflect what recipients do while tracking is on.

  The two public trackers take their token in the query string, because a signed token is longer
  than the router's 100-character path-parameter limit and the path form was answered `414`
  before reaching the handler:

  - `GET /api/v1/newsletter/o/:token.gif` is now `GET /api/v1/newsletter/open.gif?token=<token>`
  - `GET /api/v1/newsletter/c/:token?u=<url>` is now `GET /api/v1/newsletter/click?token=<token>&u=<url>`

  The click redirect still leads only to the destination its token binds, sends a mismatching
  destination to the storefront home page and answers an invalid or missing token `410`.

  Two new settings in the Newsletter group, `newsletter.tracking.opens_enabled` and
  `newsletter.tracking.clicks_enabled`, switch the two kinds of tracking independently. Both
  default to off, so an instance sends campaigns untracked until an operator switches them on; they
  can be set per sales channel, and are labelled in English and Polish on the
  Settings screen. A campaign with `trackingEnabled: false` is sent without either. Automation
  e-mails are not tracked. `NEWSLETTER_SETTING_CODES` in `@endora-commerce/contracts` gains
  `TRACKING_OPENS_ENABLED` and `TRACKING_CLICKS_ENABLED`.

- 30c61d9: New constant `MFA_CHALLENGE_COOKIE_NAME` (`'b2b_mfa_challenge'`): the storefront's pending second-step cookie, now set both by the storefront's password sign-in and by the backend when a federated sign-in hands over to the second step.

## 0.106.0

### Minor Changes

- fc23f9e: An operator can add rules to a sales channel's `robots.txt`: **Settings → SEO → Custom robots.txt instructions**.

  The text is appended to the rules the storefront generates itself — after them, separated by one
  blank line — for all sales channels or per channel. The generated rules (the closed address
  families and the `Sitemap:` line) are unchanged and cannot be edited or removed from the Settings
  screen. With no text, `robots.txt` is byte for byte what it was. Resetting the setting removes the
  text. A saved change is served within about two minutes.

  The text is served as written: every character is kept, in order. Two things about line breaks
  are made uniform — every line break is served as a line feed (`LF`), whether it was saved as `LF`,
  `CRLF` or `CR`, and the file ends with exactly one — and one byte order mark (`U+FEFF`) at the
  very start of the text is not served, because a crawler does not recognise the line it is
  attached to. Nothing in the text is validated.

  The generated lines cannot be changed, but their effect on one crawler can: a group written for a
  crawler by name replaces the `*` group for that crawler. Repeat the generated rules in such a
  group if they should still apply to it. Indexing does not depend on it — the pages those rules
  close declare `noindex` themselves.

  **`robots.txt` does not take pages out of search results.** It controls what a crawler may fetch.
  To keep a storefront out of search use _Default robots_ = `NOINDEX`, and do not add `Disallow: /`
  on top of it: a crawler that may not fetch a page never reads its `noindex`. The setting's
  description says so, in English and in Polish.

  A text may be at most **64 KiB** (65 536 bytes of UTF-8). A larger one is refused when saved, with
  `400` `SEO_CRAWLER_TEXT_TOO_LARGE` and a message naming the limit, and the stored text is kept.

  **`/robots.txt` on the reference storefront is no longer a build-time file.** It is rendered per
  request, for the request's sales channel:

  - `200` with the generated rules and the channel's text; `Content-Type: text/plain; charset=utf-8`,
    `Cache-Control: public, max-age=60`, `Vary: X-Sales-Channel`, `X-Endora-Crawler-Files: 1`. Before,
    the file was prerendered and sent with `Cache-Control: public, max-age=0, must-revalidate` and
    `Content-Type: text/plain`;
  - the generated rules alone while the `seo` module is switched off, and against a backend that
    does not have this feature;
  - **`503` with `Retry-After: 120`** when the channel's text cannot be read and the storefront
    process has never read it — rather than a file that silently omits the operator's rules. A
    process that has read the text once goes on serving that version for as long as the backend
    cannot be reached. A storefront started while its backend is down therefore answers
    `robots.txt` with `503` until the backend is back; pages are unaffected;
  - `GET /robots.txt?part=system` answers the generated rules alone, without the route asking the
    backend, and is sent with `Cache-Control: no-store`.

  **If a reverse proxy or a CDN stands in front of a storefront that serves more than one sales
  channel**, check two things, because the file now differs per channel and the channel is named by
  the `X-Sales-Channel` request header: the proxy must set that header itself, per host, and not
  pass through a value a visitor sent; and a shared cache that ignores `Vary` on such a header must
  include it in its cache key or not cache `/robots.txt`. In nginx that is one line in the
  storefront's `location` block — `proxy_set_header X-Sales-Channel "<this host's channel code>";`
  for a multi-channel deployment, or `proxy_set_header X-Sales-Channel "";` to drop the header on a
  single-channel one, which is otherwise unaffected. The `nginx.example.conf` an instance was
  scaffolded with does not carry the line; this repository's `deploy/nginx.example.conf` now shows
  both, commented.

  The origin in the `Sitemap:` line is still `NEXT_PUBLIC_SITE_URL` as inlined at build time.

  What is new, by package:

  - `@endora-commerce/mod-seo` declares the multi-line setting `seo.robots_txt_custom` (default
    empty) with its name and description in `en` and `pl`; serves the public, channel-resolved
    `GET /api/v1/storefront/seo/crawler-files`
    (`{ "data": { "index", "follow", "robotsTxtCustom", "llmsTxtAdditional", "shop": { "name" } } }`,
    `Cache-Control: no-store`, `503` `MODULE_DISABLED` while the module is off, and `500` — never
    an empty text — when a stored value cannot be served); and declares the error code
    `SEO_CRAWLER_TEXT_TOO_LARGE`. `llmsTxtAdditional` is always `""` in this release.
  - `@endora-commerce/contracts` exports `storefrontCrawlerFilesSchema`,
    `storefrontCrawlerFilesResponseSchema`, the types `StorefrontCrawlerFiles` and
    `StorefrontCrawlerFilesResponse`, `composeCrawlerFile(base, extra)` (the join described above),
    `CRAWLER_TEXT_MAX_BYTES` and `ERROR_CODES.SEO_CRAWLER_TEXT_TOO_LARGE`. The schemas drop members
    they do not know.
  - `@endora-commerce/contracts` and `@endora-commerce/mod-settings`: `SettingWriteValidationInput`
    gains **`proposedValue`** — the value a settings write proposes, beside the per-channel
    projection it already carried. An all-channels write reaches no channel that has a value of its
    own, so on an instance where every channel has one the proposed value was in no channel's
    projection, and a validator whose rule is about the value itself could not see it. A module that
    contributes a `SettingWriteValidator` needs no change; code that _constructs_ a
    `SettingWriteValidationInput` (a test calling a validator directly) must now supply the member.
  - `@endora-commerce/cli`: the storefront that `endora new storefront` writes serves `robots.txt`
    as described above.

  **An existing storefront is not changed by upgrading, and until it is updated it ignores the
  setting**: its `robots.txt` stays the file it was built with, and the Settings screen shows a text
  nothing serves. To take the feature, apply these changes from the reference storefront to the
  storefront project, keeping any edits of your own:

  - **delete** `app/robots.ts`. It must go, and nothing will tell you if it has not: with both it
    and `app/robots.txt/route.ts` present, Next builds without a warning, goes on serving the old
    build-time file and never reaches the new route. The build's route list shows which one won —
    `○ /robots.txt` is the old file, `ƒ /robots.txt` is the new route;
  - **add** `app/robots.txt/route.ts` — the route;
  - **add** `lib/seo/robots-txt.ts` — what the route answers, and when it answers `503`;
  - **add** `lib/seo/robots-system-rules.ts` — the generated rules, moved out of `app/robots.ts`
    unchanged. **If you edited the `disallow` list in your `app/robots.ts`, carry your edits into
    `ROBOTS_SYSTEM_RULES` here**;
  - **replace** `lib/seo/crawler-policy.ts` with the new version. It now reads the crawler files as
    well as the default robots policy, and gives up a backend read that a frozen process left
    hanging instead of waiting on it for ever. If the project does not have this file yet, it has
    not taken the _Default robots_ feature either — add the file, and see that release's notes for
    `middleware.ts` and `app/layout.tsx`;
  - **edit** `app/reserved-segments.ts`: add `'robots.txt'` to `RESERVED_TOP_LEVEL_SEGMENTS`, and add
    the same entry to the deployment's `cms.reserved_slug_segments` setting if you maintain one;
  - in `test/seo/route-declarations.test.ts`, if you copied it, replace the import of
    `'../../app/robots'` with `ROBOTS_SYSTEM_RULES` and `robotsSitemapUrl` from
    `'../../lib/seo/robots-system-rules'`, as the reference's version does.

  `lib/seo/robots-txt.ts` imports `composeCrawlerFile` from `@endora-commerce/contracts/seo`, so
  **the storefront project needs `@endora-commerce/contracts` at this release or later** — unlike
  the _Default robots_ files, which needed no upgrade. `middleware.ts` and `app/layout.tsx` do not
  change in this release. Then rebuild the storefront;
  `curl -sI https://<your shop>/robots.txt | grep -i x-endora-crawler-files` shows the header once
  the new route is serving.

  The reference storefront's tests for these files (`test/seo/robots-system-rules.test.ts` with its
  fixture `test/seo/__fixtures__/robots-before.txt`, `test/seo/robots-txt-route.test.ts` and the
  additions to `test/seo/crawler-policy.test.ts`) are optional to copy. The fixture is the
  reference's own generated rules with `http://localhost:3000` as the origin; a project that edited
  its list edits the fixture to match.

- 4be4642: The storefront serves an `llms.txt` per sales channel, and an operator can add to it: **Settings → SEO → Additional llms.txt content**.

  **For an operator.** `/llms.txt` is a plain-text file that tells AI assistants what a shop is and
  where its public pages are. The storefront now serves one for each sales channel: a part it
  generates — the shop's name, links to the home page, the catalog, search, the blog and the contact
  page, and the sitemap — followed by the text you save in the new setting. The setting is empty by
  default, takes a value for all sales channels and a value per channel like any other, and holds at
  most 64 KiB, the limit of the `robots.txt` instructions. A saved change is served within about two
  minutes. The addresses in the generated part use the storefront's one public origin
  (`NEXT_PUBLIC_SITE_URL`, fixed when the storefront is built), as the sitemap does: a storefront
  that serves several sales channels names that origin in every channel's file, with each
  channel's own shop name.

  Two things to know before relying on it:

  - **A sales channel whose _Default robots_ is `NOINDEX` has no `llms.txt`.** The storefront answers
    `/llms.txt` with "not found" there, whatever the setting holds: a shop that asks search engines
    to stay away does not invite AI assistants in. The text is kept and is served again when the
    channel allows indexing. `robots.txt` is unaffected — it stays open on such a channel, as before.
  - **Switching the `seo` module off withdraws the file**, with the _Default robots_ policy and the
    custom `robots.txt` instructions. The module's description and its activation setting now say so.

  Below the field there is a preview, the same as the one beside _Custom robots.txt instructions_:
  one block that is the file, your lines marked inside it, under a heading that reads _llms.txt as
  served now_ or _llms.txt after saving_. On a `NOINDEX` channel it says _llms.txt is not served_,
  with the reason, in place of the block. The messages for a storefront that cannot be reached, has
  no address configured or did not confirm that it serves the file are the ones the `robots.txt`
  preview shows, and the request the backend makes for it is bound the same way — one `GET
<origin>/llms.txt?part=base`, no redirect followed, three seconds, 512 KiB, `text/plain` only,
  nothing of the administrator's request in it. As before, private and loopback addresses are not
  refused, and this preview tells a holder of `settings:read` slightly more about a configured
  address than the `robots.txt` one does: a `404` without the storefront's header is reported as
  "did not confirm that it serves llms.txt" rather than as "could not be reached", so an address
  where some HTTP server answers can be told from one where nothing does.

  No migration, no new environment variable, no new permission.

  The `seo` bundles also gain the name of the settings group and the name and description of the
  _SEO enabled_ setting, in English and Polish (`settingGroups.seo.name`,
  `settingLabels.seo.enabled.*`).

  **`robots.txt` no longer depends on _Default robots_ being readable.** A _Default robots_ value
  that is not one of the four choices — which takes a row written around the settings API — made
  `GET /api/v1/storefront/seo/crawler-files` answer `500`, so a storefront that had just started
  answered that channel's `robots.txt` with `503`, although the file has never depended on that
  setting. The endpoint now answers, and names what it could not read (below). Such a channel keeps
  its `robots.txt`; its `llms.txt`, which does depend on the setting, answers `503` until the value
  is repaired by saving _Default robots_ again. A storefront that has not been updated benefits
  too: its `robots.txt` is served as well.

  **In `@endora-commerce/contracts`.**

  - `storefrontCrawlerFilesSchema` gains an optional member, **`unreadable`**: the names of the
    members the backend could not read from what is stored — `CRAWLER_FILES_UNREADABLE_POLICY`
    (`'policy'`: `index` and `follow` are then both `false` and mean "not known") and
    `CRAWLER_FILES_UNREADABLE_LLMS_TXT` (`'llmsTxtAdditional'`: that member is then `''` and means
    "not known"). It is absent when everything was read. **Additive**: a consumer that does not read
    it is unaffected unless it reads `index`, `follow` or `llmsTxtAdditional` from this endpoint, in
    which case it should treat a named member as unknown rather than as its value. Unreadable
    `robots.txt` instructions still fail the whole answer with `500`.
  - `llmsTxtAdditional` now carries the channel's saved text; it was always `''`.
  - `GET /api/v1/admin/seo/crawler-files/preview?file=llms` now answers; it answered `400`. The
    `not-served` state means the storefront answered `404` **with** the `X-Endora-Crawler-Files`
    header — no file for that channel; a `404` without the header is `storefront-outdated`, with no
    `base`.

  **For a custom storefront.** To be previewed, `/llms.txt?part=base` answers the generated part
  alone, as `text/plain`, with `X-Endora-Crawler-Files: 1`; a channel with no file answers `404` with
  the same header. Answer `503` rather than a file while `unreadable` names `policy` or
  `llmsTxtAdditional`.

  **In `@endora-commerce/cli`.** The storefront that `endora new storefront` writes serves
  `/llms.txt` as described above.

  **An existing storefront is not changed by upgrading, and until it is updated it has no
  `llms.txt`**: the Settings screen shows the text, the preview says that the storefront did not
  confirm that it serves the file, and nothing serves it. To take the feature, apply these changes
  from the reference storefront to the storefront project, keeping any edits of your own. They
  assume the project has already taken the _Default robots_ and _Custom robots.txt instructions_
  changes that the other entries of this release describe — `lib/seo/crawler-policy.ts`, `lib/seo/robots-txt.ts`,
  `lib/seo/robots-system-rules.ts`, `lib/seo/robots-directive.ts` and `app/robots.txt/route.ts`
  exist, and `app/robots.ts` is deleted. If not, apply those entries first.

  - **add** `app/llms.txt/route.ts` — the route;
  - **add** `lib/seo/llms-txt.ts` — what the route answers, and when it answers `404` and `503`;
  - **add** `lib/seo/llms-txt-base.ts` — the generated part. It lists `SITEMAP_STATIC_ROUTES` from
    your `app/sitemap.ts`; **if you changed that list, give each of your routes a title in
    `LLMS_TXT_PAGE_TITLES`**, and name in `LLMS_TXT_CONDITIONAL_PAGES` any of them that can answer
    "not found";
  - **add** `lib/seo/llms-txt-pages.ts` — whether a conditional page is served right now (today:
    the blog), remembered per channel by the cache `lib/seo/crawler-policy.ts` exports;
  - **add** `lib/seo/crawler-file-response.ts` — the headers and the temporary failure the two files
    share;
  - **replace** `lib/seo/robots-txt.ts` and `lib/seo/crawler-policy.ts` with the new versions. The
    first now takes its headers from `crawler-file-response.ts`; the second reads `unreadable` and exports the channel cache the page question uses;
  - **edit** `lib/seo/robots-directive.ts`: `isDocumentPath` must answer `false` for `/llms.txt`, as
    the reference's version does. **Do not skip this one**: without it the storefront still serves
    the file, but while the backend is unreachable it answers `/llms.txt` with the outage page
    instead of the last version it knew;
  - **edit** `app/reserved-segments.ts`: add `'llms.txt'` to `RESERVED_TOP_LEVEL_SEGMENTS`, and add
    the same entry to the deployment's `cms.reserved_slug_segments` setting if you maintain one;
  - **make sure there is no `public/llms.txt`.** A file there is served instead of the route — for
    every channel, with no operator text, and on a channel set to `NOINDEX` — and neither the build
    nor the server says so. `curl -sI https://<your shop>/llms.txt | grep -i x-endora-crawler-files`
    shows the header when the route is the one answering.

  `middleware.ts` and `app/layout.tsx` do not change in this release. The new files import
  `composeCrawlerFile` from `@endora-commerce/contracts/seo`, so the storefront project needs
  `@endora-commerce/contracts` at this release — as the custom `robots.txt` instructions, another
  entry of this release, already require. Then
  rebuild the storefront — the build's route list shows `ƒ /llms.txt`.

  The reference storefront's tests for these files (`test/seo/llms-txt-base.test.ts`,
  `test/seo/llms-txt-route.test.ts`, and the additions to `test/seo/crawler-policy.test.ts`,
  `test/seo/robots-txt-route.test.ts`, `test/seo/middleware-robots.test.ts` and
  `test/seo/middleware-effect.test.ts`) are optional to copy.

- 9dd3b81: A `string` setting can be declared multi-line, and the Settings screen then edits it in a multi-line field that keeps line breaks exactly.

  **For a module author.** Add `multiline: true` to the setting's entry in the module's settings
  manifest:

  ```ts
  defineModuleSettingsManifest({
    moduleCode: 'your_module',
    settings: [
      {
        code: 'your_module.footer_note',
        name: 'Footer note',
        valueType: 'string',
        defaultValue: '',
        multiline: true,
      },
    ],
  });
  ```

  Nothing else changes: the value is still a `string`, is read through `SettingsService.get` as
  before, and resolves per sales channel like every other setting. What is typed is what is stored —
  line breaks, blank lines, indentation and a trailing line break included.

  `SettingManifestEntrySchema` accepts `multiline` only on `valueType: 'string'` and not together with
  `enumOptions`; any other combination fails when the manifest is parsed, with the issue on
  `multiline`. The flag is presentation, kept in step with the manifest by `ManifestReconciler` on
  every boot in both directions, so adding or removing it later is not a breaking change and never
  touches a stored value. `SettingDtoSchema` gains an optional `multiline: boolean`, which
  `GET /api/v1/admin/settings` and `GET /api/v1/admin/settings/:code` now always send — read it if
  your module renders its own editor for a setting.

  **For an operator upgrading.** This release carries one platform migration,
  `Migration20261011T135250CoreSettingsMultiline`, which adds `settings.multiline boolean not null
default false`. It rewrites no row and needs no backfill. It is one of the platform's own
  migrations, so an instance receives it with `@endora-commerce/platform` and `pnpm run upgrade
<version>` applies it with the release's other migrations. Every existing setting stays single-line,
  so the Settings screen looks and behaves exactly as it did until a module you install declares the
  flag.

  Take the migration back only together with the packages. `down` drops the column and loses nothing
  but the flag, which the next boot of a release that has it would restore — but this release's code
  expects the column: over a database without it, a new setting cannot be registered and a declared
  `multiline` cannot be stored, and the instance fails at boot. Reverting the migration is safe as
  part of downgrading `@endora-commerce/platform` and `@endora-commerce/mod-settings` to the previous
  version, and not on its own.

  The Settings screen also names the multi-line field after the setting for assistive technology, and
  the line under it that previews the default and current value shows one shortened line for such a
  setting rather than the whole text.

- be99bb5: The Settings screen previews the `robots.txt` a sales channel's storefront serves, and a module can now contribute beside a setting it declared.

  **For an operator.** Below **Settings → SEO → Custom robots.txt instructions** there is now a
  preview of the file the selected sales channel's storefront serves, as **one block that is the
  file**: the lines the storefront generates, labelled read-only, then a blank line, then your own
  lines, marked with a bar and a label. With nothing unsaved the heading reads _robots.txt as served
  now_. As you type, the block follows the field and the heading becomes _robots.txt after saving_ —
  the file the storefront will serve once you save; until then it keeps serving the previous version.
  Under **All channels** you pick the channel to preview, and the preview names the channels that
  have a value of their own and are therefore not affected. On a channel whose _Default robots_ is
  `NOINDEX` it says that `robots.txt` stays open on purpose, and warns when your text forbids every
  crawler to fetch anything. An administrator who may read settings but not change them sees it too,
  and one who may not list sales channels is shown the system default channel. Nothing the storefront
  serves changes when you preview.

  The setting's description above the field is shorter: the preview now shows what the description
  used to explain.

  The generated rules are not copied into the backend or the Admin UI: each time, the backend asks
  the channel's storefront for them. So **the storefront must be reachable from the backend at the
  address the channel is configured with** — the channel's **Storefront URL** setting, else
  `STOREFRONT_BASE_URL`. When it is not, the preview says so and shows your text on its own; saving is
  never blocked. The three messages and what to do about each:

  - _The storefront could not be reached_ — no answer within three seconds, a refused connection,
    an error, a redirect, or an answer that is not a plain-text file. Check that the storefront runs
    and that the configured address is the one it answers at itself. The server log line
    `seo: the crawler-file preview could not show the storefront’s part` carries the reason.
  - _This sales channel has no storefront address configured_ — set **Storefront URL** for the
    channel, or `STOREFRONT_BASE_URL`.
  - _This storefront did not confirm that it supports custom instructions_ — it answered without the
    `X-Endora-Crawler-Files` header. Usually the storefront was scaffolded from a release before these
    settings existed: it serves only its generated rules and ignores both the custom instructions and
    _Default robots_. A proxy that strips the header, or a storefront updated only in part, looks the
    same. A matching notice now appears on the _Default robots_ row, so a shop is not believed to be
    out of search while its storefront may be ignoring the setting. Update the storefront's files as
    the notes of the release that introduced those settings list, and check that the header arrives.

  What the backend sends is one request per preview: `GET <origin>/robots.txt?part=system`, to the
  origin of the configured address only, with the channel's code in `X-Sales-Channel`. It follows no
  redirect, waits at most three seconds, reads at most 512 KiB, accepts only `text/plain`, sends no
  cookie or credentials, and stores nothing. A path or query in the configured address is not used.
  Private and loopback addresses are **not** refused, because an instance's own storefront is
  routinely reached at one; who may point a channel at an address is whoever holds `settings:write`,
  as before.

  No migration, no new setting, no new environment variable, no new permission.

  **For a module author: `settings.setting.after`.** `AdminZoneNameSchema` has a new member, mounted
  by the Settings screen once per setting row, below the field. Contribute to it to show what a
  setting you declared amounts to — a preview, a consequence, a warning:

  ```ts
  import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

  export const contributions: AdminContributions = {
    zones: [
      zoneComponent('settings.setting.after', () => import('./zones/FooterNotePreview.js'), {
        match: { settingCode: 'your_module.footer_note' },
        requiredPermission: 'settings:read',
      }),
    ],
  };
  ```

  The component receives `SettingsSettingAfterZoneProps`: `settingCode`, `ownerModule`,
  `channelCode` (the sales channel being edited, or `null` for the all-channels value), `draftText`
  (the text in the field **now**, saved or not, for a `string` setting; `null` for every other value
  type) and `dirty`. Narrow with `match` on `settingCode` or `ownerModule` — an unmatched
  contribution's chunk is never fetched. The props go one way: a contribution cannot change the
  value or hold up the row's save, and it should say in words when what it shows is not saved yet.
  The zone is not mounted for a `secret` setting, so a contribution never receives a secret's draft.
  A contribution vanishes with its module, and a failing one does not take the row with it.

  **If you render `SettingRowEditor` yourself.** `@endora-commerce/mod-settings`' row editor now
  mounts a zone, so it must be rendered under `AdminContributionsProvider` and the session
  providers, as every host screen that mounts a zone is. The Admin UI already does; a test that
  renders the row or `SettingsPage` on its own needs the providers around it.

  **In `@endora-commerce/contracts`.** New: `adminCrawlerFilePreviewQuerySchema`,
  `adminCrawlerFilePreviewResponseSchema`, `adminCrawlerFilePreviewSchema`,
  `adminCrawlerFilePreviewStateSchema`, `adminCrawlerFileSchema`, their inferred types, and
  `CRAWLER_FILES_CAPABILITY_HEADER` (`X-Endora-Crawler-Files`) — the response header by which a
  storefront says it serves crawler files the current way. A custom storefront that implements
  `?part=system` should send it; without it the preview treats the storefront as outdated. The
  endpoint is `GET /api/v1/admin/seo/crawler-files/preview?file=robots&salesChannelCode=<code>`,
  gated by `settings:read`. `salesChannelCode` is optional and means the system default channel; the
  answer names the channel it is about. `file=llms` is declared in the schema and answers `400` until
  `llms.txt` is served.

  `@endora-commerce/mod-seo` now declares `lucide-react` as an optional peer dependency, as the other
  module packages with an admin surface do; an application that has the Admin UI already has it.

  **In `@endora-commerce/cli`: `check:channel-resolution` no longer reports a header that is sent.**
  The rule's first signal flags every `x-sales-channel` string literal, because a module must not
  read that header from a request — the resolver does. A module that makes a request of its own to
  another server and names the sales channel in it was reported as well. The key of an object literal
  under a `headers:` property — `fetch(url, { headers: { 'X-Sales-Channel': channel.code } })` — is
  now exempt, as a CORS policy's `allowedHeaders` array already was. What stays reported: an
  element access on a headers object, a `.get(...)` argument, the name held in a constant, a
  computed key, a destructuring declaration, and a destructuring _assignment_
  (`({ headers: { 'x-sales-channel': code } } = request)`, also as the variable of a `for…of` or
  `for…in`), which has the exempted shape and is refused by its position.

- ddc9382: A sales channel's storefront can be taken out of search engines with one setting: **Settings → SEO → Default robots**.

  The setting offers `INDEX, FOLLOW` (the default), `NOINDEX, FOLLOW`, `INDEX, NOFOLLOW` and
  `NOINDEX, NOFOLLOW`, for all sales channels or per channel. For a channel whose value restricts
  something, the storefront adds the directive to what it serves for that channel: an
  `X-Robots-Tag` header on pages (not-found pages and the offline page included), on
  `/sitemap.xml`, on `/_next/image` and on the files under `public/`, and one extra
  `<meta name="robots">` in the `<head>` of the pages it renders for a request. Not-found pages
  and the statically built `/offline` page carry the header without the extra element — both
  already declare `noindex, nofollow` themselves — and redirects declared in `next.config.js`
  and the files under `/_next/static` carry neither. It only adds restrictions — a page that
  declares `noindex` for itself keeps its own tag — and `robots.txt` is not changed. With the
  default nothing is added. A saved change is in force on the storefront within a minute or two.

  **Switching the `seo` module off withdraws the directive**, so a channel set to `NOINDEX` becomes
  indexable again until the module is switched back on. The stored value is kept.

  What is new, by package:

  - `@endora-commerce/mod-seo` declares the setting `seo.default_robots`, serves the public,
    channel-resolved `GET /api/v1/storefront/seo/robots-policy` (`{ "data": { "index", "follow" } }`,
    `Cache-Control: no-store`, `503` `MODULE_DISABLED` while the module is off, and `500` — never
    a permissive answer — when the stored value is not one of the four choices), and declares two
    command-palette actions: `open-seo` (`catalog:write`) and `open-search-engine-robots`, which
    opens the Settings screen for holders of `settings:read`.
  - `@endora-commerce/contracts` exports `storefrontRobotsPolicySchema`,
    `storefrontRobotsPolicyResponseSchema` and the types `StorefrontRobotsPolicy` and
    `StorefrontRobotsPolicyResponse`. The schema drops members it does not know, so a later
    release can add one without an older consumer refusing the answer.
  - `@endora-commerce/cli`: the storefront that `endora new storefront` writes reads the policy
    and applies it. Its middleware now runs for every path except `/_next/static` (it used to skip
    public files, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` and `/_next/image`); for
    those paths it only adds the header. Measured on the reference storefront, that costs a public
    file about one millisecond. A storefront that already knows a channel's policy never waits
    more than a fraction of a second for a refresh; only the first read after a start is waited
    for, up to two seconds, once.

  **An existing storefront is not changed by upgrading, and until it is updated it ignores the
  setting.** `endora new storefront` copies the reference once and the project owns it afterwards.
  With an upgraded backend and an older storefront the Settings screen shows _Default robots_ and
  nothing acts on it — a channel set to `NOINDEX` stays indexable. To take the feature, copy these
  four files from the reference storefront into the storefront project, keeping any edits of your
  own. They import nothing from a package that an earlier storefront does not already have, so
  **no dependency has to be upgraded for them to build and run**:

  - `lib/seo/crawler-policy.ts` — new: reads the policy, caches it for a minute per channel, and
    keeps the last value it read while the backend cannot be reached;
  - `lib/seo/robots-directive.ts` — new: what the policy puts on a response;
  - `middleware.ts` — changed: the policy read, the response header, the request header for the
    layout, and the widened `config.matcher`;
  - `app/layout.tsx` — changed: renders the extra `<meta name="robots">` in both documents it
    returns. Do not move the directive into the layout's `metadata` export: a page's own `robots`
    replaces a layout's there, so it would be dropped on every page that declares one.

  Then rebuild the storefront. `curl -sI https://<your shop>/ | grep -i x-robots-tag` shows the
  header once a restricting value is saved.

  The reference storefront's tests for these files (`test/seo/crawler-policy.test.ts`,
  `robots-directive.test.ts`, `middleware-robots.test.ts`, `middleware-effect.test.ts`,
  `layout-robots.test.ts`, `layout-outage-render.test.tsx` and
  `test/conformance/robots-directive.spec.ts`) are optional to copy. One of them,
  `crawler-policy.test.ts`, compares the storefront's own check of the answer with the published
  schema and therefore needs `@endora-commerce/contracts` at this release or later in the
  storefront project; nothing else does.

  Two limits are stated in the module's documentation: files the backend serves (product images
  and other uploaded media) carry no `X-Robots-Tag`, and a storefront that starts while its backend
  is unreachable serves pages without the default directive until its first successful read.

## 0.105.0

### Minor Changes

- 1190180: The Admin UI says which Endora Commerce release it is talking to, and the health payload stops
  saying `0.0.0`.

  **A version badge in the admin header.** Under the wordmark in the sidebar, `AppShell` renders
  the release the API runs — `v0.104.0` — in the kit's `Badge`. It is read from a new endpoint,
  `GET /api/v1/admin/platform-info`, which any signed-in admin may call and which answers
  `{ "version": string | null }` (`PlatformInfoSchema` / `PlatformInfo`, new exports of
  `@endora-commerce/contracts`). With the sidebar collapsed the release moves into the logo's
  tooltip. While the number is loading, when the read fails — an API older than this release
  answers 404 — or when the platform cannot tell, the badge is not rendered at all; there is no
  placeholder. An instance needs no change: upgrade the packages and the badge appears.

  **`GET /api/v1/_health` reports the real release.** Its `version` was
  `process.env.npm_package_version ?? '0.0.0'`: the _host application's_ manifest version, which is
  `0.0.0` in every scaffolded instance, and a variable no package manager sets when a container
  starts the server with `node dist/index.js`. Every deployment therefore reported `0.0.0`. It is
  now the version of the `@endora-commerce/platform` package the process loaded, and `unknown` if
  that cannot be read. If you compared this field against `0.0.0`, or set `npm_package_version` to
  steer it, neither works any more.

  `npm_package_version` is no longer a declared platform environment input
  (`PLATFORM_ENVIRONMENT_INPUTS`), since nothing reads it.

  One key joins the `core` bundle in English and Polish — `appShell.brand.versionLabel`, the
  sentence a screen reader and the tooltip are given — and `@endora-commerce/admin-kit`'s
  `theme.css` gains `.b2b-sidebar__brand-row`, `.b2b-sidebar__brand-row--versioned` and
  `.b2b-sidebar__brand-version`; the sidebar header is 14px taller while a release is shown. A
  theme override that styles `.b2b-sidebar__brand`'s bottom border should move it to
  `.b2b-sidebar__brand-row`, which owns the divider now.

- a65b215: An administrator changing their own password has to supply the current one.

  **Breaking for API clients of `PATCH /api/v1/admin/me`.** The route used to store whatever
  `password` it was sent: a signed-in session was the only proof asked for, so anybody holding one —
  an unattended browser, a copied cookie — could replace the password and keep the account. A
  request that carries `password` must now carry `currentPassword` as well:

  ```jsonc
  // before
  { "password": "<new password>" }
  // now
  { "password": "<new password>", "currentPassword": "<current password>" }
  ```

  - `password` without `currentPassword` is refused with `400 VALIDATION_FAILED`, the issue naming
    the `currentPassword` field.
  - A wrong `currentPassword` is refused with `403 CURRENT_PASSWORD_INVALID`. It is 403 and not the
    401 the buyer-side change-password route answers with, because the Admin UI treats every 401 as
    an expired session and signs the administrator out.
  - A refused request changes nothing: a first or last name sent in the same request is not applied
    either.
  - A request without `password` is unchanged — first and last name stay editable without any
    password, and a `currentPassword` sent alone is ignored.

  The current password is checked with the same hash verification sign-in uses. Nothing else about a
  password change moves: the administrator's sessions and second factor are left as they were.

  `updateAdminUserSelfRequestSchema` in `@endora-commerce/contracts` gains the optional
  `currentPassword` field and the rule that ties it to `password`; `UpdateAdminUserSelfRequest` gains
  the field. `AdminUserService` in `@endora-commerce/mod-admin-users` gains `updateSelf(id, input)`,
  which the route calls, and `AdminUserService.update` no longer accepts `password` — it was the
  unverified write, and the route was its only caller.

  The other ways to set an administrator's password are untouched: creating an account,
  `POST /api/v1/admin/admin-users/:id/password` (a peer reset, gated by `admin_users:manage`) and the
  `admin_users create` command.

  **Admin UI.** The profile screen has a "Current password" field above "New password". It is asked
  for only when a new password is typed, and a wrong one is reported on the field itself, not in
  the page banner.

  **Sentences.** `errors.CURRENT_PASSWORD_INVALID` in the `core` bundle reads "The current password
  is incorrect." / "Obecne hasło jest nieprawidłowe." instead of the placeholders "Current Password
  Invalid." / "Błąd: current password invalid." — the buyer-side change-password route answers with
  the same code, so its message changes too. Three keys join the bundle in English and Polish:
  `profile.field.currentPassword`, `profile.field.currentPasswordHelp` and
  `profile.error.currentPasswordRequired`.

- 9260c36: An administrator's sessions are revoked when the credential behind them is withdrawn.

  Three writes used to leave every session of the account answering:

  - **Changing your own password** (`PATCH /api/v1/admin/me`) replaced the hash and nothing else, so
    a browser signed in elsewhere — the one the password was being changed because of — stayed
    signed in for up to thirty days. It now revokes **every other session of the account**: the
    sign-ins on other browsers and devices and the impersonation sessions the administrator started.
    The session the request was made from is kept, no new cookie is issued, and the profile screen
    stays open. A refused change (wrong or missing `currentPassword`) and a name-only edit revoke
    nothing.
  - **Deactivating an administrator** (`PATCH /api/v1/admin/admin-users/:id` with
    `status: 'inactive'`) and **deleting one** (`DELETE /api/v1/admin/admin-users/:id`) now revoke
    every session of the account. A permission check already refused an inactive account, but a
    route gated on the session alone — `GET` and `PATCH /api/v1/admin/me` among them — kept
    answering it, and reactivating the account brought the old sessions back.

  A peer reset (`POST /api/v1/admin/admin-users/:id/password`) already revoked every session and is
  unchanged. API keys are not sessions and are not touched; neither is the account's second factor.

  **A revoked session could come back.** `SessionService.destroyAllForAdmin` and
  `destroyAllForCustomer` cleared the Redis cache entries and then deleted the rows, so a request from
  a session being revoked could read the row in between and cache it again — after which it answered
  from the cache until its thirty-day expiry. Rows are deleted first now, and `loadSession` looks for
  the row again after filling the cache and takes the entry back out when it is gone.

  **Logins begun with the old password are withdrawn.** A pending second-factor challenge or setup
  ticket issued after the old password verified could still be completed after a password change, a
  peer reset, a deactivation or a delete. `MfaLoginPort` gains a required method,
  `invalidatePending(subject)` (**breaking for implementers**), which `mfa` implements with a
  per-subject generation counter in its challenge store, and `AdminUserService` calls it wherever it
  revokes sessions. `AdminUserService`'s constructor takes the lazily resolved MFA port as an optional
  fifth argument.

  **Write first, revoke second.** The self-service change, the peer reset, deactivation and deletion
  now persist the new state and then revoke, where the peer reset used to revoke first: a sign-in with
  the old password between the two steps kept a session nothing revoked. A refusal from the session
  port therefore surfaces as the request's error with the new password already in force.

  **Audit.** A self-service password change is now recorded as `admin_user.change_password` with
  `via: 'self_service'` — the action a peer reset already records with `via: 'peer_reset'` — where it
  used to be an `admin_user.update` indistinguishable from a rename. The entry carries neither the
  password nor its hash. A request that changes the name as well records an `admin_user.update`
  entry beside it; a password-only request no longer records one.

  **A session of an account that is not active is refused, revoked or not.** Revocation is a step
  each write has to remember, so the admin guard no longer relies on it: `requireAdmin` and
  `requireAdminAny` answer `401 UNAUTHORIZED` to a session whose administrator account is
  deactivated, deleted or gone. **This changes a status code:** a permission-gated route used to
  answer such a session `403 FORBIDDEN`, and a route with no permission code answered it in full. An
  active account that lacks the permission is still answered 403. The extra account read is made
  only on a route with no permission code and after a refused permission check, so a granted
  permission costs what it did. While `admin_roles` or `admin_users` is absent from the deployment the
  check is not made — it has nobody to ask — so `GET /api/v1/admin/module-presence` keeps answering in
  that state as before.

  **A new password equal to the current one is refused** on `PATCH /api/v1/admin/me` with
  `400 NEW_PASSWORD_UNCHANGED` ("The new password is the same as the current one. Choose a different
  password." / "Nowe hasło jest takie samo jak obecne. Wybierz inne hasło."). It would have reported
  a change, and signed the other sessions out, without changing the credential. The check runs after
  the current password is verified. The buyer-side change-password route and the peer reset do not
  make this check: the peer does not know the target's password, and comparing would tell them.

  **Log redaction.** The request logger censored `*.password`, `*.passwordHash` and `*.secret` but not
  `*.currentPassword` or `*.newPassword`, the two other names a password travels under in a request
  body. Both are on the list now, which `buildServer` and `createLogger` share instead of each
  carrying its own copy.

  **API — two breaking changes, named first.**

  - `AdminPermissionChecker` in `@endora-commerce/platform` gains a required method,
    `isActiveAdministrator(adminUserId): Promise<boolean>`; `PermissionService` in
    `@endora-commerce/mod-admin-roles` implements it. A hand-written checker passed to
    `createRequireAdmin` / `createRequireAdminAny` has to add it.
  - `AdminAuthService.changePassword` in `@endora-commerce/mod-admin-users` is **removed**, and the
    class's constructor loses its fourth argument (the audit port). The method had no caller,
    answered a wrong current password with 401 and revoked nothing; `AdminUserService.updateSelf` is
    the one implementation.
  - `AuthSessionPort.destroyAllForAdmin` in `@endora-commerce/contracts` takes an optional second
    argument, `{ exceptSessionId }` (`AuthDestroyAllForAdminOptions`), which spares that one session
    when it is one of the administrator's own; `SessionService.destroyAllForAdmin` in
    `@endora-commerce/mod-auth` implements it. A port implementation that ignores the argument still
    type-checks but revokes the calling session too.
  - `AdminUserService.updateSelf` takes an optional third argument, `{ sessionCookieValue }`, from
    which it works out which session to keep.
  - `ERROR_CODES.NEW_PASSWORD_UNCHANGED` joins `@endora-commerce/contracts`, owned by `admin_users`.

  A refused password change is not written to the audit log, as a failed sign-in is not.

  **Admin UI.** After a password change the profile screen says that the other sessions were signed
  out (`profile.info.passwordChanged`, English and Polish) instead of "Profile updated."

- 0184be5: An e-mail that was only written to the server log is no longer reported as sent. On an instance
  with no `SMTP_URL` the console mailer logs the message and used to answer `{ status: 'sent' }`,
  and the transactional e-mail service answered a constant `sent` of its own, so every module that
  records or reports a delivery recorded one that did not happen.

  **Breaking for a consumer of the two port types — three unions gain a member:**

  - `EmailMailerSendOutcome` gains `{ status: 'logged' }`. The console mailer answers it instead of
    `sent`; the SMTP mailer and `InMemoryMailer` still answer `sent`.
  - `TransactionalSendOutcome` gains `{ status: 'logged' }`, and `TransactionalEmailSender.send`
    passes the transport's `logged` on. A transport's `suppressed` (an already accepted message id)
    is still answered as `sent`, as before.
  - `emailDeliveryStatusSchema` / `EmailDeliveryStatus` gain `'logged'`, and
    `invoiceEmailNotSentReasonSchema` / `InvoiceEmailNotSentReason` gain `'logged'`.

  What to do: code with an exhaustive `switch` over one of these unions, or that passes
  `outcome.status` into a closed union of its own, stops compiling until it handles `logged`; code
  that reads `outcome.reason` after `outcome.status !== 'sent'` must narrow to
  `outcome.status === 'suppressed'` first, because `logged` carries no reason. Code that compares
  with `=== 'sent'` keeps compiling and now treats a logged message as not sent. `logged` is not a
  failure and there is nothing to retry: the same call would log the message again. An own
  implementation of `EmailMailerPort` or `TransactionalEmailSender` needs no change.

  What changes on an instance without a mail server:

  - `email_deliveries` rows are written with `status = 'logged'` instead of `'sent'`. The column is
    a plain `varchar(16)`, so there is no migration; rows written earlier keep `sent`.
  - The order, return, payment-status, shipment and invoice e-mail results answer
    `{ sent: false, reason: 'logged' }`, each with its usual "was not sent" log line. Issuing an
    invoice or re-sending its e-mail from the Admin UI says the e-mail was not sent because no mail
    server is configured, in English and Polish (`invoices.emailNotSent.logged`).
  - A CRM Event reminder is recorded as delivered to the bell alone — or as undeliverable when the
    bell is unavailable too — instead of "bell and e-mail".
  - `POST /api/v1/organizations/register` answers `emailVerificationSent: false` when the
    verification e-mail went through the in-code builder and was only logged.

  No setting, permission or migration changes.

- 560f2e3: More credential changes withdraw the sessions and pending sign-ins obtained before them.

  - **`admin_users create` run again for an existing account** replaces the password, so it now
    ends every session of that account and withdraws its pending second-factor challenges and
    setup tickets, through the same path as a peer reset. The write is audited as
    `admin_user.change_password` with `via: 'cli'` and no acting administrator. Creating a new
    account is unchanged.
  - **Removing a second factor.** Disabling your own two-factor authentication
    (`POST /api/v1/admin/account/mfa/disable`, `POST /api/v1/account/mfa/disable`) ends every other
    session of the account and keeps the one the request was made from. An administrator's reset of
    a customer's second factor (`POST /api/v1/admin/customers/:customerId/mfa/reset`, and the bulk
    route for each account it actually resets) ends every session of that customer. Both withdraw
    the account's pending challenges and setup tickets. Enrolling a factor ends no session, and a
    disable or reset that removes nothing ends none either.
  - **Customer password change** (`POST /api/v1/me/customer/change-password`,
    `POST /api/v1/me/password`) ends every other session of the account and keeps the calling one.
    **Redeeming a reset token** (`POST /api/v1/auth/password-reset/confirm`) ends all of them. Both
    mark every other outstanding reset token of the account as consumed and withdraw its pending
    second-factor challenges and setup tickets.

  In every case the new state is persisted first and the sessions are revoked after it.

  Port changes, all additive: `AuthSessionPort.destroyAllForCustomer` takes an optional
  `{ exceptSessionId }` (`AuthDestroyAllForCustomerOptions`), mirroring `destroyAllForAdmin`;
  `CustomerAuthPort.changePassword` takes an optional fourth argument
  `{ sessionCookieValue }` (`CustomerChangePasswordContext`) naming the session to keep — a caller
  that omits it keeps none. No port member was removed or changed incompatibly.

  Not ports, but changed for anyone constructing these classes directly: `PasswordResetService`'s
  constructor takes the session port as its second argument (the audit port moved to third), and
  `MfaEnrolmentService.disable` returns whether a factor was removed.

- 60cfd18: The tabs of an Opportunity say how much is behind them. _Notes_ and _Attachments_ show their number
  of items, as _Links_ already did; _Events_ keeps the number of Events that have not ended yet; and
  _Messages_ shows how many messages the signed-in administrator has not read. A tab with nothing
  behind it shows no number. Each number is read aloud with what it counts — "Notes, items: 3",
  "Events, upcoming: 2", "Messages, unread: 1" — and follows a change made on its own tab without a
  reload of the page.

  Unread messages are counted per administrator: a message somebody else wrote after the point you
  have read up to. Opening the _Messages_ tab reads them, for a holder of `crm:read` alone as well,
  and one administrator's reading changes nothing for another. Reading is not a change to the
  Opportunity and leaves nothing in its change history.

  `OpportunityDetail` (`GET /api/v1/admin/crm/opportunities/:id`, and every answer that carries the
  Opportunity) gains three members: `noteCount`, `attachmentCount` and `unreadMessageCount`. One new
  route, `POST /api/v1/admin/crm/opportunities/:id/messages/read` with `{ throughMessageId }`, gated
  `crm:read`, answers `{ unreadMessageCount }`. `upcomingEventCount` is unchanged.

  One migration, `20261009T163307_crm_opportunity_message_reads`, creates
  `crm_opportunity_message_reads` and `crm_message_read_baselines`. It records the instant it ran, and
  messages written before it are unread for nobody — so an upgrade does not hand every administrator
  every existing conversation to catch up on. No new permission and no new Setting.

- 31a2c0b: A custom field declares who reads its values, and customer-facing order and quote-request replies
  stop naming administrators. **Three breaking changes**, all described below.

  **Every custom-field definition has an `audience`: `customer` or `internal`.** Until now a
  definition had none, and whatever an administrator stored on an order or a quote request was
  answered to the customer (`GET /api/v1/orders`, `GET /api/v1/orders/:id`, the replies to placing
  and cancelling an order, `GET /api/v1/quote-requests/:id`) and to integrations
  (`/api/v1/external/orders`) as `customFieldValues`. An operator who modelled an internal note, a
  credit assessment or a risk flag as an order custom field was showing it to the buyer.

  - `internal` values are answered on admin routes only. `customer` values are also answered on
    the non-admin replies above. A stored value whose definition no longer exists is treated as
    internal. Admin replies are unchanged and carry every stored value.
  - **Existing definitions keep today's behaviour.** The migration
    `Migration20261010T090000CustomFieldsDefinitionAudience` adds
    `custom_field_definitions.audience` and sets every existing row to `customer`, so upgrading
    hides nothing. Review your definitions after upgrading and move to `internal` whatever was
    never meant to be shown.
  - **Breaking: a new definition is `internal` unless it says otherwise.**
    `POST /api/v1/admin/custom-fields/definitions` without `audience` used to create a field whose
    values the customer could read; it now creates one they cannot. Send `"audience": "customer"`
    to keep the old behaviour. `PATCH …/definitions/:id` accepts `audience` and leaves it alone
    when the key is absent. The same patch no longer resets a definition's `config` to `{}` when
    the body does not name it (`updateCustomFieldDefinitionSchema` carried the create default).
  - The definition screen (Custom Fields) shows the choice with an explanation, defaulting to
    internal, and lets the audience of an existing field be changed. Six keys join the module's
    `en` and `pl` bundles under `customFields.audience.*`.

  In `@endora-commerce/contracts`: new `customFieldAudienceSchema` / `CustomFieldAudience`;
  `customFieldDefinitionSchema` and `CustomFieldDefinitionRecord` gain a required `audience`;
  `createCustomFieldDefinitionSchema` defaults it to `internal`, so the inferred
  `CreateCustomFieldDefinitionRequest` — the input of `CustomFieldDefinitionApplyApi.applyCreate` —
  now requires it; and `CustomFieldValuePort` gains
  `projectForCustomer(entityType, bag)`, which returns only the keys a non-administrator may read.
  An implementation of that port must add the method. A host module that answers custom-field
  values to a non-administrator calls it in its serialiser; `mod-orders` and `mod-quote-requests`
  do. `mod-catalog` creates product attributes with `audience: 'customer'`; the audience is not
  consulted for product attributes, whose storefront visibility stays with the catalog's own flags.

  **Breaking: buyer-facing and external order replies no longer carry
  `placedOnBehalfByAdminUserId`.** It was the UUID of the administrator who placed the order for
  the customer, answered to the customer and to API-key callers. Those replies now carry
  `placedOnBehalf: boolean` instead. Admin order replies carry both. In `orderSchema`,
  `placedOnBehalf` is a new required key and `placedOnBehalfByAdminUserId` becomes optional
  (present on admin replies only). Replace `order.placedOnBehalfByAdminUserId !== null` with
  `order.placedOnBehalf` in a storefront or an integration; the reference storefront did not read
  the field.

  **Breaking: customer-facing replies carry no administrator identifier at all.** The same rule,
  applied to the other places it was broken:

  - Quote-request replies to a customer (`GET /api/v1/quote-requests/:id` and the replies to
    creating, patching, resubmitting a quote and to accepting or rejecting a revision) no longer
    carry `createdByAdminUserId` and `assignedAdminUserId`, and their `events[]` no longer carry
    `actorAdminUserId` (it was already always `null` there; the key is now absent).
    `actorRoleLabel` still says who acted.
  - Order-comment replies to a customer (`GET` and `POST /api/v1/orders/:id/comments`) no longer
    carry `authorAdminUserId`. A comment whose `authorCustomerAccountId` is `null` was written by
    staff.

  Admin replies are unchanged. In `quoteRequestSchema`, `quoteRequestEventSchema` and
  `orderCommentSchema` those four keys become optional (present on admin replies only). No boolean
  replaces them: the reference storefront declared the fields and read none of them.

  **Re-creating a deleted field.** Deleting a definition keeps its stored values. A
  `POST …/definitions` with `audience: "customer"` for a key that still has stored values is now
  refused with `409 CUSTOM_FIELD_DEFINITION_INVALID`, because it would answer those old values to
  customers at once. Create the field as `internal`, then change its audience. Product attributes
  (created through the catalog) are not affected.

  The definitions cache no longer stores a list that was read before an invalidation and arrived
  after it. A change of audience still takes up to 5 seconds to reach an API process that missed
  the invalidation message; the docs page says so.

  In `mod-orders`, `serializeOrder` is replaced by `serializeOrderForAdmin` and
  `serializeOrderForCustomer` (internal to the module).

- 266cd38: The adapter of a delivery method is chosen on `/delivery-methods`. The screen only displayed it:
  a method created there was sent without one, the API took the method's code as the adapter, and a
  code no module had registered gave a row that saved without a word and that
  `GET /api/v1/delivery-methods` never offered at checkout.

  - **`GET /api/v1/admin/delivery-methods/adapters`** (gated `delivery_methods:read`) answers
    `{ data: [{ key, ownerModule }] }` — every registered shipping adapter whose module is switched
    on. `@endora-commerce/contracts` exports its shape as `deliveryMethodAdapterOptionSchema` /
    `DeliveryMethodAdapterOption`.
  - **Every row of `GET /api/v1/admin/delivery-methods`, and the body `PUT` answers with, carries
    `availability: { ownerModule, available, ownerPresence }`** — the same three fields payment
    methods already report. `available: false` is a method checkout does not offer.
    `@endora-commerce/contracts` exports `deliveryMethodAvailabilitySchema` and
    `deliveryMethodAdminListItemSchema` with their types. `deliveryMethodAdminSchema` is unchanged.
  - The form has a required **Adapter** select, listing the bundled adapters by name and a carrier
    module's by key. A row checkout cannot offer is marked _Not offered at checkout_ with the reason,
    and is repaired by opening it and choosing a registered adapter. Nothing is rewritten or deleted
    automatically.

  Two changes to `PUT /api/v1/admin/delivery-methods/:code`:

  - **Changing the adapter of a method that shipments reference answers 409.** A shipment records
    its delivery method and not the adapter that opened it, so the method's adapter is the only
    record of which carrier holds those parcels. Set the method `inactive` and create another for the
    other adapter. While the `shipments` module is switched off the change is refused as well, as a
    delete already is. A body that omits `adapter`, or repeats the one the row has, is unaffected.
  - **An `adapter` the row already carries is accepted even when it is not registered**, so a method
    whose carrier module is gone can still be re-priced or deactivated by a client that sends the
    whole row back. Changing a method _to_ an unregistered adapter still answers 400.

  A body that omits `adapter` on creation still takes the method's code as the adapter. Send it
  explicitly, and read `availability.available` in the response.

- 8ca54eb: Delivery and payment methods are offered per sales channel, and the choice is enforced.

  The admin API already stored a channel assignment for each method, but nothing read it: the
  storefront listed every active method on every channel, the two admin screens offered no way to
  choose channels, and an order could be placed with any active method.

  **The rule.** An assignment is a restriction. A method assigned to one or more sales channels is
  offered in exactly those; a method assigned to **no** channel is offered in every channel. That
  differs from products on purpose — methods exist without an assignment as a matter of course (a
  module that ships its own method seeds it with none, and so does demo data), so "none" cannot mean
  "nowhere".

  **Upgrade note for an instance with more than one sales channel: review every method.** The new
  **Sales channels** column on `/delivery-methods` and `/payment-methods` shows where each one stands.

  - **Created in the admin so far** — assigned to the **default channel only** (the screens offered
    nothing else), and so gone from the other channels' checkouts until changed.
  - **Seeded by a gateway or carrier module under an earlier release, on an instance that had already
    been started** — also assigned to the **default channel only**: that release's seed bound the
    method to the default channel whenever it existed. They do not appear on other channels until an
    operator widens them.
  - **Seeded by a module from this release on** — assigned to **no channel**, and so offered on every
    channel, whenever the module is installed. The same holds for methods a module seeded under an
    earlier release during the instance's first setup, before its first start, and for demo data.

  Open each method and choose its channels, or untick all of them to offer it everywhere. No data is
  migrated: a method bound to the default channel by an earlier seed cannot be told apart from one an
  operator restricted on purpose, so none is widened automatically. An instance with a single sales
  channel is unaffected.

  **For authors of a gateway or carrier module.** `bindToDefaultChannel` is removed from
  `DeliveryMethodSeedApi` and `PaymentMethodSeedApi` (`@endora-commerce/mod-delivery-methods/ports`,
  `@endora-commerce/mod-payment-methods/ports`, and the seeders their `./install` subpaths create).
  An install hook that called it after `ensureMethodForAdapter` must delete the call, and needs no
  replacement: the seeded method is offered on every channel until an operator restricts it. Two
  things follow for a module that still calls it. Its **source** no longer compiles against this
  release. And a **build published earlier** does not fail at compile time at all: the seeder object
  simply has no such method, so the module's install hook throws a `TypeError` the first time it
  creates its method — on a new instance, or on any instance where the method's row does not exist
  yet. An instance that already has the row is unaffected, because the hook only calls the bind for a
  row it has just created. Such modules must therefore be re-released for this version. A module that must seed a method restricted to particular channels has
  no seam for that at install; restrict it in the admin.

  **Permissions.** Choosing a method's sales channels is part of configuring the method:
  `delivery_methods:write` / `payment_methods:write` is sufficient to assign, replace and clear them,
  and `sales_channels:write` is not required. The form reads its options from a route of the method
  module itself, `GET /api/v1/admin/{delivery,payment}-methods/sales-channels`, gated on that
  module's `:read` code, so an administrator who configures methods and does not administer sales
  channels can use the field.

  **A storefront must name the channel when it reads the two catalogues.** The reference storefront
  read `GET /api/v1/delivery-methods` and `GET /api/v1/payment-methods` with no `X-Sales-Channel`
  header; it forwards the header now, on the checkout and on the buyer's preferences page. A
  storefront created by an earlier release has the same omission in `lib/api/methods.ts`
  (`listDeliveryMethods` and `listPaymentMethods` take the request context as a required argument
  now) and, until it is changed, is answered with the default channel's methods on every channel;
  the steps are in _Upgrading an instance_.

  What changed, by package:

  - **`mod-delivery-methods`, `mod-payment-methods`** — `GET /api/v1/delivery-methods` and
    `GET /api/v1/payment-methods` list only the methods offered in the sales channel the request
    resolved. Both admin screens gain a **Sales channels** field in the form and a column in the
    list. `salesChannelIds` on `PUT /api/v1/admin/{delivery,payment}-methods/:code` now has three
    meanings: **omitted** leaves the assignment unchanged on an update and assigns a new method to
    the default channel (unchanged behaviour); **`[]`** removes every assignment, offering the method
    in every channel (it used to be ignored); a non-empty list replaces the assignment (unchanged).
    An id that names no sales channel is now refused with `400 VALIDATION_FAILED` and a
    `salesChannelIds` field error, before anything is written; it used to answer `500`. Channel
    changes made through these routes are audited with the acting administrator.
    The modules' sales-channel bridges are registered with `emptyMeansEveryChannel: true`.
  - **`mod-orders`** — placing an order and previewing its total refuse a delivery or payment method
    not offered in the order's sales channel: `400 VALIDATION_FAILED` with
    `details.code` `delivery_method_not_in_sales_channel` / `payment_method_not_in_sales_channel`.
    This covers `POST /api/v1/orders`, `POST /api/v1/orders/preview-total`, one-click buy, admin
    order creation and its preview, and the API-key order intake; the last three refuse before the
    customer's basket is touched. The admin order-creation form narrows its method lists to the
    chosen channel.
  - **`contracts`** — new `SalesChannelOptionSchema` / `SalesChannelOption`, the shape of the two
    channel-options routes. `DeliveryMethodReadPort` and `PaymentMethodReadPort` gain
    `isAvailableInChannel(id, salesChannelId): Promise<boolean>`. An implementation of either port
    outside this repository must add it.
  - **`platform`** — a sales-channel bridge registration may declare `emptyMeansEveryChannel`, and
    `SalesChannelMembershipPort` gains two methods that read it:
    `filterEntityIdsAvailableInChannel(channelId, entityType, entityIds)` — the ids bound to the
    channel, plus, for a declaring type only, the ids bound to none — and
    `clearChannelsForEntity(entityType, entityId, options?)`, refused with
    `ENTITY_WOULD_HAVE_ZERO_CHANNELS` for a type that does not declare it. Products keep the
    at-least-one-channel rule. An implementation of the port outside this repository must add both.
  - **`admin-kit`** — new `MethodSalesChannelsField`, `MethodSalesChannelsCell`,
    `useSalesChannelOptions(path, enabled)` and `salesChannelIdsToSubmit` on
    `@endora-commerce/admin-kit/components`.
  - **`mod-i18n`** — the `methodSalesChannels.*` strings of the `core` bundle, in English and Polish.
  - **`mod-quick-order`** — one-click buy is not offered when the buyer's default delivery or payment
    method is not offered in the sales channel of the request:
    `GET /api/v1/quick-order/one-click/eligibility` answers `{ enabled: false, reason: "missing_defaults" }`
    there, and `POST /api/v1/quick-order/one-click` refuses with `one_click_unavailable` without
    touching the basket.

- be5b3ce: `DELETE /api/v1/storefront/pwa/subscriptions` removes a push subscription only for the party
  that created it.

  The route took `{ endpoint }` and deleted the matching row for any caller. It now deletes it
  only for a caller that holds the subscription:

  - the request carries the subscription's own keys, `{ endpoint, keys: { p256dh, auth } }` — the
    object the browser sent when it subscribed, compared in constant time. This is enough whoever
    is or is not signed in, so a signed-out browser can still remove its own subscription;
  - or the subscription belongs to a customer account and the request carries that customer's
    session, which needs no keys.

  The answer is `204` in every case, as it already was for an unknown endpoint, so it does not say
  whether an endpoint is registered.

  `POST /api/v1/storefront/pwa/subscriptions` updates an endpoint that is already registered only
  for that same party.

  The route upserted on `endpoint`: any caller could send new keys for a registered endpoint and
  the row took them, together with the caller's account or none. An existing row is now updated
  only on the same proof — the row's current keys in the request, or the owning customer's
  session. So:

  - the same browser subscribing again with unchanged keys is `200` with the same `id`, as before;
  - a signed-in customer subscribing a device with its keys takes the row — an anonymous one, or
    one another customer subscribed on that browser — and the account and organisation move
    together (`200`). This answered `409` or `500` before, because the lookup ran in the
    customer's tenant scope and did not see the row;
  - a signed-out browser subscribing again with its keys detaches the row from the account, the
    organisation going with it (`200`), as before;
  - new keys for an endpoint a customer owns are accepted from that customer's session (`200`);
  - anything else — keys that are not the row's, without the owner's session — is answered `201`
    with a fresh `id`, exactly like a first subscribe, and writes nothing. That includes an
    anonymous browser whose keys changed for the same endpoint: it is not re-keyed, and the stale
    row goes when the push service reports it gone.

  The answer to a refused request is the answer to a first subscribe for one request. A caller
  that repeats it is answered `201` again, where a row of its own would answer `200`.

  **Breaking for a custom storefront client**: an unsubscribe that sends the endpoint alone, with
  no session of the owning customer, is now a no-op. Send the keys from `PushSubscription.toJSON()` with it. The bundled
  storefront's `unsubscribeFromPush()` does so already; an instance that copied
  `storefront/lib/api/pwa.ts` should take the same change.

  The lookup by `endpoint`, and nothing else, runs under a system tenant scope in both routes;
  ownership is then checked explicitly.

  `PushSubscriptionDeleteSchema` (`@endora-commerce/contracts`) gains the optional `keys` object,
  and `PushSubscriptionService.revoke` takes a second argument naming the caller's session
  account and the presented keys.

- 602e5ba: Six more events are delivered to webhooks: three product events, two quote-request events and the
  credit-limit adjustment.

  They were emitted on the in-process event bus and delivered to nobody. Each is now offered on the
  Webhooks screen, accepted by the API and delivered, while the module that owns it is present:

  | Event                      | Owner            | Payload, beside `eventId` and `occurredAt`                      |
  | -------------------------- | ---------------- | --------------------------------------------------------------- |
  | `product.created.v1`       | `catalog`        | `productId`, `sku`                                              |
  | `product.updated.v1`       | `catalog`        | `productId`, `changedFields` (field names only)                 |
  | `product.archived.v1`      | `catalog`        | `productId`                                                     |
  | `rfq.created.v1`           | `quote_requests` | `rfqId`, `organizationId`                                       |
  | `rfq.expired.v1`           | `quote_requests` | `rfqId`, `organizationId`                                       |
  | `credit_limit.adjusted.v1` | `credit_limits`  | `organizationId`, `amount` (the granted limit after the change) |

  **The owning module offers its own events.** `catalog`, `quote_requests` and `credit_limits` push
  their event names into `webhooks`' `webhookEventRegistry` from a boot hook and declare the edge as
  `contributes-to` — the mechanism `crm` already uses. `webhooks` names none of them, and its two
  built-in types are unchanged. With `quote_requests` or `credit_limits` switched off, their types are
  not offered and a new subscription to them is refused; stored subscriptions are kept and receive
  nothing until the module is back.

  **Who receives them.** Product events carry no `organizationId`, so they reach platform-wide
  subscriptions only. Quote-request and credit-limit events reach platform-wide subscriptions and the
  subscriptions bound to that Organization, never one bound to another.

  **The payloads are published contracts.** `@endora-commerce/contracts` exports a strict schema for
  each — `CATALOG_WEBHOOK_EVENT_SCHEMAS`, `QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS`,
  `CREDIT_LIMIT_WEBHOOK_EVENT_SCHEMAS` — with the matching `*_WEBHOOK_EVENT_TYPES` and
  `*_WEBHOOK_EVENTS` constants and one `…EventV1Schema` and type per event.

  Three changes of behaviour in the owning modules:

  - **`catalog` now emits `product.archived.v1` when a product's status moves to `inactive`.** The
    event was emitted only by a deprecated method nothing called, so no path an administrator, an
    import or a PIM synchronisation takes ever announced it. It is emitted once per transition, after
    the `product.updated.v1` of the same write, on every update path. A subscriber on the in-process
    bus — the search indexer removes the product from the index on it — now receives it. The
    archiving write waits for the subscribers of both events before it returns, so a reactivation
    that follows at once cannot be undone by a removal still on its way; on the unaudited update
    path (the API-key upsert, a bulk edit) that makes an archiving write as slow as its subscribers,
    where it used to return without waiting.
  - **`rfq.expired.v1` carries `organizationId`.** Without it the event could reach no subscription
    bound to an Organization. An additive field.
  - **`CreditLimitService` constructed without a Command Bus emits `credit_limit.adjusted.v1` after
    its transaction has committed**, not from inside it, so an adjustment whose commit fails is not
    announced. The composed module always has a Command Bus and was not affected.

  **A contributed event type is delivered only while its owner is present.** `webhooks` asked for
  its own presence before delivering and not for the contributing module's, so an event carrying the
  name of a switched-off module was still delivered to the subscriptions stored for it. The bridge
  now asks per event, for every contributed type — the `crm` ones included. The two built-in order
  events are unaffected.

  Not delivered, and documented as such: a product being deleted (`product.deleted.v1` stays
  in-process), and a product being reactivated (there is no un-archive event; it shows as `status` in
  `changedFields`). `rfq.expired.v1` is sent only by the quote-request expiry sweep, so it occurs
  only on an instance where that sweep runs.

  **Volume.** Nothing is batched: a bulk edit, an import or a PIM synchronisation writes products one
  by one, so a subscription to `product.updated.v1` receives one delivery per product written. An
  event type no subscription names enqueues nothing.

- 8ee69de: The Webhooks screen offers only event types that are delivered, and the API refuses the rest.

  The subscription form offered thirteen event types while the backend delivered two of them,
  `order.created.v1` and `order.status_changed.v1`. A subscription to any of the other eleven was
  saved without complaint and never received anything, and the API accepted any non-empty string, a
  misspelled name included.

  **Breaking for API clients.** `POST /api/v1/admin/webhooks` and
  `PATCH /api/v1/admin/webhooks/:id` now answer `422` with the new error code
  `WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE` when `eventTypes` names an event type that is neither built in
  nor contributed by a module that is switched on; `error.details.eventTypes` carries the refused
  names. A client that sent other strings must send only the names the screen offers: the two above,
  plus the answer of `GET /api/v1/admin/webhooks/event-types`. The request schema's shape is
  unchanged.

  **Subscriptions that already exist are untouched.** There is no migration. A stored subscription
  that carries a name nothing delivers is still listed, can still be paused, renamed, re-pointed and
  deleted, and may keep that name through an `eventTypes` update — only a name a write _adds_ is
  checked. The screen marks such names as not delivered. They receive nothing, as they did before.

  `@endora-commerce/contracts` exports the list both sides now read:
  `WEBHOOK_BUILT_IN_EVENT_TYPES`, the `WebhookBuiltInEventType` type,
  `deliverableWebhookEventTypes(contributed)` and `ERROR_CODES.WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`.
  The backend subscribes its delivery bridge from the constant and the form offers from it, so the
  two cannot drift apart again. A module that wants its events delivered contributes them through
  `webhookEventRegistry`, as before.

  No event type is delivered that was not delivered before, and none stopped being delivered.

### Patch Changes

- 18ae962: Repeated wrong passwords and wrong second-factor codes for an administrator account are now
  throttled. Until now the only limit in front of `POST /api/v1/auth/admin/login` was the global
  ceiling of 1000 requests a minute per address, so a password could be tried a thousand times a
  minute; and the second step's budget of five codes belonged to one challenge, so a new challenge —
  one more password request — bought five more codes.

  **What changes for a caller.** After five wrong attempts from one address on one account, or twenty
  on one account from all addresses together, the attempt is answered
  `429 ADMIN_AUTHENTICATION_THROTTLED` with a `Retry-After` header and
  `error.details.retryAfterSeconds`. The delay is one minute, then doubles with each further wrong
  attempt up to fifteen minutes; the count is cleared by a successful attempt and otherwise forgotten
  thirty minutes after the first wrong one. A correct password or code is refused too while a delay
  is running — it is not checked — and an e-mail address that belongs to no administrator is throttled
  identically. Nothing is locked permanently. An IPv6 client is counted by its /64.

  At most five attempts from one address (twenty for one account) are checked at the same time; one
  beyond that is answered 429 with `Retry-After: 1`, unchecked, and nothing is counted for it.

  It applies to `POST /api/v1/auth/admin/login`, the current password on `PATCH /api/v1/admin/me`,
  `POST /api/v1/auth/admin/mfa/verify`,
  `POST /api/v1/admin/account/mfa/disable` (password or code) and
  `POST /api/v1/admin/account/mfa/recovery-codes/regenerate`. Passwords and codes are counted
  separately. The customer routes are unchanged.

  **Known devices.** A completed administrator sign-in sets a new cookie, `b2b_admin_device`: signed
  with the server's cookie secret, `httpOnly`, 90 days. It is not a session and grants nothing. An
  attempt that carries it is counted against that device's own budget of five and not against the
  account-wide twenty, so wrong passwords sent by somebody else cannot keep an administrator out of a
  device they have signed in on before. It stops being honoured when the account's password changes,
  and is not honoured while the account is deactivated; a second-factor reset does not revoke it.
  Only a password sign-in sets it, so an account that signs in only through Google or Microsoft never
  has a known device. A device the account has never been signed in on can still be
  delayed by somebody who knows the e-mail address and sends twenty wrong passwords from four or more
  addresses.

  **For an operator.**

  - `pnpm run cli admin_users unlock --email=<e>`, from the root of an instance
    (`node dist/cli.js admin_users unlock --email=<e>` in a production image), clears every count for
    one account. Its first line of output names the Redis it acted on (host, port, database index).
  - Behind a reverse proxy, set `TRUSTED_PROXY_HOPS` or `TRUSTED_PROXY_ADDRESSES`: without it every
    client shares the proxy's address.
  - Each delay that starts for an existing account writes one audit row,
    `admin_user.authentication_throttled`, with the factor, the scope (`address`, `account` or
    `device`) and the delay. Refused attempts write nothing.
  - When Redis does not answer within three seconds the attempt is refused with
    `503 ADMIN_AUTHENTICATION_UNAVAILABLE`.

  **In `@endora-commerce/contracts`.** New: `AdminAuthenticationThrottlePort` (container name
  `adminAuthenticationThrottlePort`, owned by `admin_users`) with `verify` and `issueKnownDevice`;
  `AdminAuthenticationAttempt`, `AdminAuthenticationOrigin`, `AdminAuthenticationCheckResult` and
  `AdminAuthenticationFactor`; `ADMIN_KNOWN_DEVICE_COOKIE_NAME` and
  `ADMIN_KNOWN_DEVICE_MAX_AGE_SECONDS`; and the error codes `ADMIN_AUTHENTICATION_THROTTLED` and
  `ADMIN_AUTHENTICATION_UNAVAILABLE`. A route that verifies an administrator credential adopts the
  throttle with one call:

  ```ts
  const ok = await throttle.verify(
    { factor: 'password', account: admin.email, ip: request.ip, knownDevice },
    async () => ({ ok: await verifyPassword(admin.passwordHash, typed), adminUserId: admin.id }),
  );
  ```

  `AdminPasswordVerificationPort.verifyPassword` takes an optional third argument,
  `context?: AdminAuthenticationOrigin`, and now rejects with the 429 or the 503 above instead of
  always resolving to a boolean.

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

- 8d4440f: The configured admin idle-logout window now applies to every administrator, not only to those whose
  role includes `settings:read`. The Admin UI learned the window by requesting
  `GET /api/v1/admin/settings/admin.idle_logout_minutes`, which requires `settings:read`: an
  administrator with a narrower role was answered 403 on every sign-in and was signed out after the
  built-in 60 minutes whatever the operator had configured.

  `GET /api/v1/admin/me` now carries the window as `idleLogoutMinutes` (`number | null`), described
  by the new `adminMeResponseSchema` in `@endora-commerce/contracts`, and the Admin UI reads it from
  there — it no longer calls the settings endpoint for it. `AdminMe` in `@endora-commerce/admin-kit`
  gains the matching optional field. The field is additive; the Admin UI keeps its 60-minute default
  when the field is absent (a backend older than this release) or `null` (the setting could not be
  resolved).

  The permission gate on the settings admin API is unchanged. No setting or permission changes.

- 6b2ba06: The order contract declares every key the order routes answer.

  `orderSchema` is a non-strict object, so it parsed an order reply while silently dropping the keys it did not know — and the routes have been answering three of those:

  - **`customFieldValues`** on every order reply (buyer-facing, admin and `/api/v1/external/orders`). `orderSchema` now declares it as `customFieldValuesSchema.default({})`: a reply that carries it keeps it, and a value without the key still parses and reads `{}`.
  - **`organization`** and **`customer`** on `GET /api/v1/admin/orders/:id` only. They are declared by the new **`adminOrderDetailSchema`** (type `AdminOrderDetail`), which extends `orderSchema`; both are `null` when the record can no longer be read. No other order reply carries them, and `orderSchema` deliberately does not declare them.

  Nothing on the wire changed and no schema was narrowed: every value that parsed before parses now.

  One thing to check when upgrading — the inferred **type** `Order` gains a required `customFieldValues: Record<string, unknown>`, because that is what the routes answer. Code that _reads_ an `Order` is unaffected; code that _constructs_ a value of that type by hand (a fixture, a mock) has to add `customFieldValues: {}`, or build it with `orderSchema.parse(...)`, which fills the default in.

- 335750c: A storefront order is recorded on the sales channel the request was made on.

  `POST /api/v1/orders` took the order's channel from the optional `salesChannelId` body field and
  fell back to the system-default channel, ignoring the channel the request itself resolved. A
  request that named its channel with `X-Sales-Channel`, as every other storefront request does, was
  therefore recorded on the default channel. The route now places the order on the channel the
  request resolved (`X-Sales-Channel`, `?salesChannel=`, the host map, else the system default).

  **The body field no longer chooses the channel.** Omitted, or equal to the resolved channel's id
  (in either letter case), the request is accepted as before. Naming a different channel — another
  one, one that does not exist, or one that is switched off — is refused with
  `422 VALIDATION_FAILED` and `details.code = "order_sales_channel_mismatch"`
  (`requestedSalesChannelId`, `resolvedSalesChannelId`), before anything is written. A client that
  sends `salesChannelId` should stop sending it and name its channel in `X-Sales-Channel`.

  **What changes on an instance with more than one sales channel.** New orders placed on a
  non-default channel's storefront record that channel instead of the default one, and everything
  read from an order's channel follows:

  - at placement: the minimum order value (`orders.min_order_value`), the candidate warehouses and
    the channel's fulfilment settings, the order-number prefix and suffix, and the extra
    confirmation recipients (`orders.confirmation_recipients`);
  - afterwards: the seller details and the number sequence of the order's invoices, the language and
    channel of its order, payment and shipment e-mails, whether it may be reordered
    (`orders.reorder_enabled`), and where it appears in the admin order list, per-channel reports and
    the channel's attribution count.

  Existing orders are not rewritten.

  **What changes on an instance with one sales channel.** One setting. A storefront order used to
  reach the minimum-order-value check with no channel at all, and a setting read with no channel
  answers its platform-wide value. It now arrives with the default channel's id, so a minimum order
  value (`orders.min_order_value`) set **for the default channel** — rather than for all channels —
  is enforced at checkout where it was not before. An instance that set it platform-wide, or not at
  all, sees no change. (The warehouses, the fulfilment settings and the order numbering were already
  read for the default channel on such an order.)

  **For authors of payment and shipping adapters.** `validateUseOnStorefront` (and `validateUseOnAdmin`
  for an impersonated checkout) now receives the order's channel id in `salesChannelId` on a
  storefront placement, where it received `null`. An adapter that treated `null` as "no channel
  configuration applies" will be asked about the real channel.

  **What is not reconciled, and is unchanged.** A basket is still created on the system-default
  channel whatever channel the buyer is shopping, and three things are still answered for the
  basket's channel rather than for the order's:

  - **assortment** — a product is checked against the channel of the request that added it to the
    basket, not against the order's channel, so an order can be recorded on a channel that does not
    sell one of its products;
  - **line prices** — resolved for the basket's channel;
  - **promotions** — evaluated for the basket's channel, at checkout exactly as in the cart, so a
    promotion restricted to a non-default channel does not yet apply to an order placed there.

  Until this change the order was recorded on the default channel too, so the three agreed with it;
  they can now differ from the order's channel on a multi-channel instance.

  **What this is not.** It makes an order's channel the request's channel; it does not bind a buyer
  to a channel. `X-Sales-Channel` and `?salesChannel=` are sent by whoever makes the request, and nothing restricts
  which channels a customer or an Organization may order on.

  Unchanged: admin order creation records the channel the operator chose, the API-key order intake
  records the key's bound channel, and one-click buy already used the resolved channel on the
  backend.

## 0.104.0

### Minor Changes

- dbf6778: An entry on the Admin UI's notification bell can be shown in each reader's language. Additive:
  a module that records entries as before is unaffected, and so is a consumer that reads only
  `title` and `body`.

  **`@endora-commerce/contracts`.** New type `AdminNotificationMessage` —
  `{ scope: string; key: string; params?: Record<string, string | number> }`, the bundle
  namespace (a module id, or `core`), a key in that bundle and what fills its `{name}`
  placeholders. `RecordAdminNotificationInput` gains two optional members, `titleMessage` and
  `bodyMessage`; `title` stays required and is the English sentence shown when the message
  cannot be resolved. `AdminNotificationRecord` gains the same two as optional members, so an
  existing implementation of `AdminNotificationRecordPort` — a test double included — still
  satisfies it.

  ```ts
  await adminNotifications.record({
    audience: 'admin_user',
    targetAdminUserId,
    kind: 'my_module.thing.done',
    title: `Thing ${number} is done`,
    titleMessage: { scope: 'my_module', key: 'notifications.done.title', params: { number } },
  });
  ```

  **`@endora-commerce/mod-admin-notifications`.** A migration,
  `Migration20261007T194748AdminNotificationsMessageKeys`, adds two nullable `jsonb` columns to
  `admin_notifications` — `title_message` and `body_message`; nothing is backfilled and existing
  rows read `null`. `adminNotificationRecordPort.record` stores a message and answers it, and
  **refuses** one it could not draw: a scope that is not a bundle namespace, an empty key or one
  longer than 255 characters, a param that is not a string or a finite number, and a
  `bodyMessage` without a `body`. `GET /api/v1/admin/notifications` answers `titleMessage` and
  `bodyMessage` on every item, `null` when the entry has none.

  **`@endora-commerce/admin-shell`.** `NotificationBell` resolves `titleMessage` and
  `bodyMessage` through the loaded translation bundles — the reader's language, then English —
  and shows the recorded `title` / `body` when the entry carries no message, when no bundle
  holds the key (the recording module is switched off or not installed), or when the template
  names a placeholder the entry has no param for. A raw key is never shown, and a param is drawn
  as text.

- 2d39d97: A product attribute carries a new flag, **`isPriceRule`** — whether the attribute may be used as a
  price-building rule in a Price List. It is the pricing sibling of `isPromoRule` and travels the
  same way: `false` by default, set on create, hot-toggled through
  `PATCH /api/v1/admin/catalog/attributes/:key`, and shown as a column and a checkbox on the admin
  Attributes screen.

  - **`@endora-commerce/contracts`** — `createAttributeRequestSchema` and
    `updateAttributeRequestSchema` accept an optional `isPriceRule`;
    `adminAttributeResponseSchema` and `CatalogAttributeView` always carry it; `CatalogAttributeFlag`
    and `CatalogAdminAttributeFlag` gain `'isPriceRule'`, so
    `catalogAttributeReadPort.listByFlag('isPriceRule')` answers the attributes a price rule may name.
    **If you build a `CatalogAttributeView` yourself** — a test double of `CatalogAttributeReadPort`
    is the usual case — add `isPriceRule: false`; the field is required, which is why this is a
    minor in a `0.x` series.
  - **`@endora-commerce/mod-catalog`** — a migration adds `product_attributes.is_price_rule`
    (`boolean not null default false`), and `GET /api/v1/admin/catalog/attributes/by-flag` accepts
    `flag=isPriceRule`.
  - **`@endora-commerce/demo-composition`** — `createAttributeFixture` accepts `isPriceRule`.

  Nothing prices from the flag yet: a Price List's application rule still matches on sales channel,
  customer group, organization, category and currency only. This release records the flag and
  publishes it for the price-rule work to consume.

- fcf6daa: A category can carry content for its storefront page, authored in the Page Builder.

  - **`@endora-commerce/mod-catalog`** — new nullable `categories.content` column (migration
    `Migration20261008T092714CatalogCategoryContent`; run your instance's migrations) holding one
    Page Builder document per language. New routes: `GET` / `PUT
/api/v1/admin/catalog/categories/:id/content` (`catalog:read` / `catalog:write`) and the
    storefront read `GET /api/v1/catalog/categories/:id/content`. New admin screen
    `/catalog/categories/:id/content`, reached from a **Content** action on the category tree. A save
    runs the `category.content.update` command and emits `category.content.updated.v1`, which flushes
    the storefront's `catalog:categories` cache tag and — unlike `category.updated.v1` — does not
    re-index the category's products. The category list, the category tree and
    `CatalogCategoryRecord` are unchanged and do not carry the content.
  - **`@endora-commerce/contracts`** — new `categoryContentEnvelopeSchema`,
    `putCategoryContentRequestSchema`, `adminCategoryContentSchema`, `categoryPageContentSchema`,
    their inferred types and `CATEGORY_CONTENT_MAX_BYTES` (1 MiB). New admin zone
    `category.content.editor` with `CategoryContentEditorZoneProps`
    (`{ categoryId, language, data, onChange }`): the catalog owns the document and mounts the zone,
    and a module that owns a Page Builder contributes the editor. `assetReferenceKindSchema` gains
    `'category_content'`: a library asset embedded in a category's content cannot be deleted while
    the content references it.
  - **`@endora-commerce/mod-cms`** — contributes its Page Builder to `category.content.editor`
    (gated on `cms.read`). With the CMS module off the catalog's **Content** action is not offered;
    stored content is kept.

  A storefront has to render it to show it: read `getCategoryPageContent(node.id, ctx)` beside the
  listing and render the result through the Page Builder render boundary, as the reference
  storefront's `/c/[slug]` page and `components/CategoryContent.tsx` do.

- 85793d6: A basket can say which accepted quote request it was seeded from.

  - `CartRecord.sourceQuoteRequestId: string | null` — new and **required**. **Breaking for
    anything that builds a `CartRecord` or implements `CartReadPort` / `CartWritePort` itself**
    (a test double, an alternative cart): add the field, `null` when the basket came from no
    quote request. Consumers that only read a `CartRecord` are unaffected.
  - `CartWritePort.replaceItemsForCustomer(ctx, lines, options?)` — a third, optional argument,
    `CartSeedOptions { sourceQuoteRequestId?: string | null }`. Existing two-argument calls
    compile and behave as before, with one thing to know: the mark is **replaced on every call**,
    so a seed that passes no option clears what an earlier one set.

  The value is a claim, not a fact: `carts` records what its caller said, and `orders` re-reads
  the quote request through `QuoteRequestReadPort` before an order may carry it.

- d5ab69f: An operator chooses which fields a card on the Opportunity board shows, and the board is
  filtered by the fields its cards show. Additive: an instance nobody configures shows the card
  it showed before.

  **`@endora-commerce/mod-crm`.** A new Setting, `crm.board_card_fields` — a JSON array of field
  references, platform-wide, defaulting to the card as it was (`builtin:number`,
  `builtin:organization`, `builtin:value`, `builtin:assignee`, `builtin:tags`). It is edited in
  the new _Board card_ section of **CRM → Workflow**, which the board links to for a holder of
  `crm:configure`. A field is `builtin:<key>` or `custom:<definition key>`; a custom field
  whose definition is deleted drops out of the cards, the filters and the section without an
  error. At most six fields are shown, the title besides.

  - `GET /api/v1/admin/crm/board/card-fields` (`crm:read`) answers `{ fields, available,
maxFields }`; `PUT` on the same path (`crm:configure`) takes `{ fields: string[] }` and
    answers the same.
  - `GET /api/v1/admin/crm/board` answers `cardFields` beside `columns`, and every card carries
    `cardValues` — the values of the chosen fields a summary does not already hold, keyed by
    reference, and of no other field.
  - `GET /api/v1/admin/crm/board` and `GET /api/v1/admin/crm/opportunities` accept
    `fieldFilters`, a URL-encoded JSON object of operators per field reference (`contains`,
    `in`, `is`, `min`, `max`, `from`, `to`). A reference that is not on the card is ignored. The
    list also accepts `cardValues=true`.
  - The board's filters are now carried in its address (`/crm/board?assignee=me&f.custom:lead_source.in=referral`),
    so a filtered board can be reloaded and shared.

  The module now resolves two more ports, both of owners it already depends on:
  `customFieldDefinitionReadPort` (`custom_fields`) and `settingsAdminService` (`settings`).

  **`@endora-commerce/contracts`.** New exports: `OPPORTUNITY_BOARD_CARD_MAX_FIELDS`,
  `OPPORTUNITY_BOARD_BUILTIN_FIELD_KEYS`, `OPPORTUNITY_BOARD_DEFAULT_CARD_FIELDS`,
  `opportunityBoardFieldRefSchema`, `opportunityBoardFieldKindSchema`,
  `OpportunityBoardCardFieldSchema`, `SetOpportunityBoardCardFieldsRequestSchema`,
  `OpportunityBoardCardConfigSchema` (and its response envelope), `OpportunityFieldFilterSchema`,
  `OpportunityFieldFiltersSchema` and their inferred types. `OpportunityBoardSchema` gains the
  required member `cardFields`; `OpportunitySummarySchema` gains the optional `cardValues`;
  `OpportunityListQuerySchema` and `OpportunityBoardQuerySchema` gain the optional `fieldFilters`
  (parsed from its JSON text) and the list query the optional `cardValues`.

- 32775d5: The contract surface of the new CRM module, and the small additions its neighbours needed. All
  additive; the notes say where an exhaustive `switch` gains a case. Nothing a released version
  exported changes shape.

  **CRM (`crm.ts`, exported from the package root).** The request and response schemas of the
  CRM admin API with their inferred types — opportunities, the workflow and its mappings, links,
  propagation outcomes, the board, tags, comments, attachments, history, references, lookups,
  the five analytics reads and `OpportunityOfDocumentResponseSchema`; `CRM_EVENTS` and
  `opportunityStatusEventName(kind, { from, to })` with the event payload types; the strict
  webhook payload schemas `OpportunityCreatedEventV1Schema`,
  `OpportunityStatusChangedEventV1Schema`, `OpportunityClosedEventV1Schema` with
  `CRM_WEBHOOK_EVENT_TYPES` and `CRM_WEBHOOK_EVENT_SCHEMAS`; the ports `OpportunityReadPort`
  (with `OpportunityRecord`), `OpportunityTransitionPort` (with `OpportunityTransitionOutcome`)
  and `OpportunityTransitionGuardRegistryPort` (with `OpportunityTransitionGuard` and
  `OpportunityTransitionVetoError`); the reference grammar —
  `formatOpportunityReferenceToken`, `extractOpportunityReferenceTokens`,
  `splitOpportunityReferenceText`, `mentionedAdminUserIds` — over three reference types,
  `product`, `order` and `admin_user`; the mention lookup schemas
  (`OpportunityMentionLookupQuerySchema`, `OpportunityMentionOptionSchema`,
  `OpportunityMentionLookupResponseSchema`); and `OPPORTUNITY_ATTACHMENT_MAX_BYTES`. A history
  entry (`OpportunityHistoryEntrySchema`) carries `references` for the description it shows, and
  the history response (`OpportunityHistoryResponseSchema`, `OpportunityHistoryResponse`) carries
  `truncated` beside `pagination`.

  **`ERROR_CODES`** gains fifteen members, all prefixed `CRM_`: `CRM_OPPORTUNITY_NOT_FOUND`,
  `CRM_INVALID_TRANSITION`, `CRM_TRANSITION_VETOED`, `CRM_TRANSITION_CONFLICT`,
  `CRM_DOCUMENT_NOT_FOUND`, `CRM_DOCUMENT_ALREADY_LINKED`, `CRM_LINK_ORGANIZATION_MISMATCH`,
  `CRM_STATUS_CODE_TAKEN`, `CRM_STATUS_IN_USE`, `CRM_STATUS_INITIAL_REQUIRED`,
  `CRM_WORKFLOW_INVALID`, `CRM_ASSIGNEE_INVALID`, `CRM_TAG_NAME_TAKEN`,
  `CRM_MESSAGE_IMMUTABLE` and `CRM_ATTACHMENT_TOO_LARGE`. A consumer that switches exhaustively
  over `ErrorCode` gets a compile error until it handles them.

  **New members of existing unions** — each a compile error for an exhaustive `switch` or a
  `Record` over the union, which is why this is a `minor`:

  - `AdminNavSectionNameSchema`: `'crm'`.
  - `AdminZoneNameSchema` / `AdminZonePropsMap`: `'order.detail.after'`
    (`OrderDetailZoneProps`) and `'quote_request.detail.after'` (`QuoteRequestDetailZoneProps
{ quoteRequestId }`).
  - `supportedEntityTypeSchema`: `'opportunity'`.
  - `assetReferenceKindSchema`: `'crm_opportunity_attachment'`.

  **For the neighbours.**

  - `OriginReferenceSchema` / `OriginReference` (`{ type, id }`: a lower-case identifier of at
    most 64 characters and a UUID, strict), optional as `origin` on
    `adminCreateOrderRequestSchema` and `adminCreateQuoteRequestSchema`; the event payload types
    `OrderCreatedEventPayload` and `RfqCreatedByAdminEventPayload`, and the name
    `RFQ_CREATED_BY_ADMIN_EVENT`. A request without `origin` validates as before.
  - `WebhookEventDescriptor` and `WebhookEventRegistryPort`, the contribution seam of
    `@endora-commerce/mod-webhooks`.
  - `QUOTE_REQUEST_STATUS_VALUES` is exported.

- f02494f: The contract for Events on a Sales Opportunity and for the CRM Calendar. Additive throughout.
  The routes that serve it and the screens that draw it are `@endora-commerce/mod-crm`'s, and
  the port method is answered by `@endora-commerce/mod-auth`; each has a changeset of its own in
  this release.

  **`@endora-commerce/contracts` — `crm`.** The request and response shapes of five routes
  (`GET`/`POST /opportunities/:id/events`, `PATCH`/`DELETE …/events/:eventId`,
  `GET /calendar/events`):

  - `CreateOpportunityEventRequestSchema` and `UpdateOpportunityEventRequestSchema` — a name of
    1 to 200 characters, an optional description of 5 000 at most, `allDay`, `startsAt` and
    `endsAt` as ISO 8601 instants with an offset, the IANA `timeZone` the times were chosen in,
    and an optional `remindAt`. The schema refuses what needs neither a clock nor zone data: an
    end that is not after the start, and a span over `OPPORTUNITY_EVENT_MAX_SPAN_HOURS` (25).
    The update is the same members, all optional, and strict.
  - **Every instant of these shapes** — `startsAt`, `endsAt`, `remindAt`, and `from` and `to` of
    `CalendarEventsQuerySchema` — must lie in `0001-01-03T00:00:00Z` … `9999-12-30T00:00:00Z`, the
    end excluded. A four-digit year as written is not enough: an offset carries
    `9999-12-31T22:00:00-14:00` into the year 10000, which PostgreSQL refuses. Outside the range
    the schema refuses, so the routes answer 400.
  - `OpportunityEventSchema` — the stored Event, with `allDayDate` computed by the server and a
    `reminder` of `{ at, state, handledAt, channels }` or `null`.
    `opportunityEventReminderStateSchema` names the seven states and
    `opportunityEventReminderChannelSchema` the two channels; `channels` is non-empty exactly
    when the state is `sent`.
  - `opportunityEventRuleSchema` — the five reasons a well-formed Event is refused with 422
    `VALIDATION_FAILED` (`details.rule`).
  - `CalendarEventsQuerySchema` (`from`, `to`, an optional `scope` of `mine` or `all`; a range
    of `CALENDAR_EVENTS_MAX_RANGE_DAYS`, 45, at most), `CalendarEventSchema` — what a calendar
    draws, without the description — `CalendarEventsMetaSchema` and
    `CalendarEventsResponseSchema`; `CALENDAR_EVENTS_MAX_RESULTS` (500).
  - `OpportunityDetailSchema` gains `upcomingEventCount`, a non-negative integer.

  **`@endora-commerce/contracts` — `auth`.** `AuthSessionReadPort` gains
  `lastSeenByAdminUser(adminUserIds, since)` and the type `AuthAdminLastSeen`, the twin of
  `lastSeenByCustomerAccount`. **An implementer or a test double of this port outside the
  repository must add the method to keep compiling.**

  **`@endora-commerce/contracts` and `@endora-commerce/admin-kit`.** `CalendarDays` joins the
  admin icon allowlist: `KnownIconNameSchema` gains the name and `resolveIcon` maps it to the
  lucide component, the pair a declared icon needs in one change.

- 7af6470: The Dictionary's Languages tab lists every ISO 639-1 language, each with the countries that use it.

  - **183 languages are seeded, inactive.** `mod-dictionaries` ships a static catalogue — code,
    English name, native name, text direction and ISO 3166-1 country codes — and its boot reconciler
    inserts the rows that are missing, so an existing installation receives them on its first boot
    after the upgrade. No migration and no new dependency. `en-US` and `pl-PL` stay the only active
    languages: the storefront registry, `GET /api/v1/i18n/config`, the catalogue's translation chains
    and the product feeds read the _active_ set and are unchanged. An operator activates a language on
    its row to start using it.
  - **Seeding never overwrites.** A language row that exists is left exactly as it is — label, sort
    order and activation included. A seeded row that is deleted returns on the next boot; leave it
    inactive instead. A language is linked only to countries the dictionary holds, never as the
    country's primary language, and a country added later is linked on the next boot.
  - **`LanguageSeedPort` gains `ensureSeeded(rows: readonly LanguageSeedRow[]): Promise<number>`**,
    and `@endora-commerce/contracts` exports `LanguageSeedRow`. It inserts every row whose `code` is
    missing with `is_active = false` and returns how many it inserted. An implementation of the port
    outside `mod-languages` has to add the method; a caller of `backfillNativeLabels` changes nothing.
  - **Admin.** The Countries column shows country-code chips instead of a count; the list is searchable
    by country, filterable by status and paged; translation completeness is requested for active
    languages only, and the translations panel offers active languages only (the backend already
    refused a label in an inactive one). `GET /api/v1/admin/dictionary/languages` builds its answer in
    two statements instead of one per language.
  - **A code that used to be unknown is now inactive.** A write naming a catalogue language that has
    not been activated — `de` on a sales channel, say — answers `409 DICTIONARY_ENTRY_INACTIVE` where
    it answered `409 DICTIONARY_ENTRY_NOT_FOUND`.
  - `mod-orders`: the order-status screen asks the dictionary for its full page of languages, so an
    active language cannot fall outside the first hundred rows.

### Patch Changes

- 5e2ade8: Saving content in the Admin UI now reaches the storefront on the next request. Until now a saved CMS
  page, block, template or hook — and an edited megamenu — appeared only after the storefront's own
  60-second cache window, and the **Cache** screen could not shorten that: it cleared Redis, which the
  save had already done, and never told the storefront.

  - **`@endora-commerce/contracts`** exports the cache-tag vocabulary both sides must spell alike:
    `CMS_STOREFRONT_CACHE_TAGS`, `MEGAMENU_STOREFRONT_CACHE_TAG`, the event name
    `CMS_CONTENT_CHANGED_EVENT` (`cms.content_changed.v1`) and its payload type `CmsContentChange`.
    The tag strings are the ones the storefront already used, with one addition: the published-page
    index (the sitemap's source) is tagged `cms:page-index` instead of `cms:page`.
  - **`@endora-commerce/mod-cms`** publishes `cms.content_changed.v1` on the EventBus after every page,
    block, template and hook write has committed, and answers it by posting the matching tags to the
    storefront's `/api/revalidate`. A block save now also drops the cached hooks that inline that
    block, which it did not before.
  - **`@endora-commerce/mod-megamenu`** revalidates the `megamenu` tag on every menu write, and
    subscribes to `cms.content_changed.v1` so a saved block or page drops the menus that embed or link
    to it.
  - **`@endora-commerce/mod-blog`** drops its cache when a category is created and when a tag is
    renamed without a code change; both used to leave the old listing in place for five minutes.
  - **`@endora-commerce/mod-settings`** — clearing the `cms` or `megamenu` namespace on the Cache
    screen, or with `settings cache-clear`, now revalidates the storefront's copy too.

  Nothing to configure beyond what an instance already sets: revalidation runs when
  `STOREFRONT_BASE_URL` and `REVALIDATE_SECRET` are present on the backend and the same secret is on
  the storefront, is skipped otherwise, and never fails a save when the storefront cannot be reached.

  **An existing storefront tree** keeps working — its tags are the same strings — with one exception
  worth taking: change the tag on its `getCmsPageIndex` fetch from `cms:page` to
  `CMS_STOREFRONT_CACHE_TAGS.pageIndex`, or a newly published page reaches `sitemap.xml` only when the
  60-second window runs out.

## 0.103.1

## 0.103.0

### Minor Changes

- d0e76fd: A module's `./admin` layer may contribute editor renderers for its own Page Builder blocks: `AdminContributions` gains an optional `blocks` array of `AdminBlockContribution` (`{ name, context: 'cms' | 'email', component }`), with `AdminBlockContributionSchema` for the data half. New `EmailBlockRendererRegistryPort<R>` and `EmailBlockRendererRegistrationResult` describe the container name `emailBlockRendererRegistry`, which `email` owns and a module registers its e-mail block renderers into from `ctx.onBoot`. Additive: a contribution set without `blocks` is unchanged.
- 08192f0: **An administrator always holds a role, and one without a role is refused.** An administrator's
  permissions and the organizations they reach are both read off the role the account holds. An
  account with no role used to be treated as reaching every organization; it now reaches none and is
  refused by name.

  **After upgrading, an administrator account that has no role is refused until it is given one.**
  Accounts are deliberately not given a role by the upgrade — any default would grant access nobody
  chose. The instance logs a warning at every boot naming how many accounts are affected. To repair
  one:
  - from the Admin UI, on the Users screen, choose a role for the account; or
  - from the command line, which is the way when no administrator can sign in:
    `pnpm run admin:create -- --email=<their e-mail> --password-stdin --first-name=<f> --last-name=<l> [--role=<code>]`.
    The command updates the existing account, sets the password it is given and assigns
    `platform_admin` unless `--role` names another role.

  What an operator sees for such an account: every permission-gated admin route answers 403
  `ADMIN_ROLE_REQUIRED`, and so does the first read of organization data on any other route. The
  account can still sign in, read `GET /api/v1/admin/me` (which answers `role: null`) and sign out.

  **Every instance has the platform-administrator role.** `platform_admin` — shown as _Platform
  administrator_ / _Administrator platformy_ — holds every permission. Installing
  `@endora-commerce/mod-admin-roles` creates it and every boot ensures it exists with full access, on
  an instance with or without demo data. It cannot be deleted (409 `ADMIN_ROLE_PROTECTED`), whether
  or not anybody holds it, and withdrawing the demo data no longer removes it. The role code is
  unchanged; an operator's own rename of the role is kept.

  **The admin surface no longer produces an account without a role.**
  - `POST /api/v1/admin/admin-users` requires `adminRoleId`; without one it answers 400
    `ADMIN_USER_ROLE_REQUIRED`. A client that created accounts and assigned the role afterwards must
    send the role with the create.
  - `PATCH /api/v1/admin/admin-users/:id` with `adminRoleId: null` answers 400
    `ADMIN_USER_ROLE_REQUIRED`. A role is changed for another, never cleared.
  - The Users screen requires a role when creating an account and offers no "unassigned" choice for
    an account that has one.

  For code that consumes the packages:
  - `ERROR_CODES` gains `ADMIN_ROLE_REQUIRED` (declared by `admin_roles`) and
    `ADMIN_USER_ROLE_REQUIRED` (declared by `admin_users`), each with an `en` and a `pl` sentence.
  - `PermissionReadPort` (container name `permissionService`) gains
    `resolveRole(adminUserId): Promise<AdminRoleResolution>`, which answers `{ role }` or
    `{ refusal }`. An implementation of the port must add it.
  - `hasPermission` on that service **throws** the 403 `ADMIN_ROLE_REQUIRED` refusal for an active
    administrator with no role, where it used to answer `false`. An unknown or inactive
    administrator is still `false`.
  - `AdminTenantScope`'s confined member gains an optional `unresolved: Error`.
    `adminTenantScopePort.resolveForAdmin` no longer answers `{ allowAll: true }` for an id that
    names no live administrator or for an administrator with no role: it answers
    `{ allowAll: false, allowedOrganizationIds: [], unresolved }`, and the platform's tenant guard
    raises `unresolved` on the first tenant-scoped read.
  - `@endora-commerce/mod-admin-roles` exports an `installHook`.

- 9eb7ed9: Two read methods, one optional response field and one partial-response schema, for order transitions that record what they owe.
  - `InventoryStockReadPort.unreleasedAllocationsForOrderItems(orderItemIds)` answers the stock allocations still held for the given order items, as `{ orderItemId, warehouseId, quantity }`.
  - `CreditLimitReadPort.activeReservationsForOrders(orderIds)` answers the credit reservations still active for the given orders, as `{ orderId, amount, currency }`, with `amount` the decimal string the reservation stores.
  - `orderSchema` gains an optional `pendingEffects` array (`orderPendingEffectSchema`, type `OrderPendingEffect`; the closed set of effects is `ORDER_TRANSITION_EFFECTS`). It is carried by the admin order responses only, and only while a stock or credit release of the order is outstanding.
  - `orderCommittedWritePartialSchema` and `orderCommittedWritePartialResponseSchema` (types `OrderCommittedWritePartial`, `OrderCommittedWritePartialResponse`) describe what `POST /api/v1/admin/orders/:id/status`, `POST /api/v1/admin/orders/:id/payment-status` and `POST /api/v1/orders/:id/cancel` answer when the change committed but the order could not be read back for the response: `{ data: { id, businessId, status, paymentStatus }, meta: { partial: true } }`. **A client of those three routes should check `meta?.partial` before treating `data` as an order** — the partial body does not parse with `orderSchema`.

  Nothing existing changes shape, so a caller of either port and a consumer of the order response need no change.

  **If you implement `InventoryStockReadPort` or `CreditLimitReadPort` yourself** — a test double, or an alternative owner of the port — this is a compile break: add the new method. An implementation with nothing to report answers `[]`.

### Patch Changes

- f052b7f: **Tenant isolation fix for scaffolded instances — upgrade.** Every instance scaffolded from the
  published packages up to and including 0.102.0 is affected. In such an instance requests were not
  confined to the organization of the customer or API key making them, and an admin's scope was not
  resolved from the admin's role: every request ran in the platform's system tenant scope, and
  audit entries written through the Command Bus did not record the acting admin. The fix is to
  upgrade; nothing in the instance has to be edited.

  **Upgrade all `@endora-commerce/*` packages together.** The platform reads the admin's scope
  from a port `@endora-commerce/mod-organizations` registers from this version on. With the
  platform upgraded and that package left behind, every admin — a platform administrator included —
  is confined to no organization and organization-scoped screens are empty; the platform logs a
  warning at boot naming `adminTenantScopePort` when that is the case.

  `composeApp` used to leave the actor → tenant-context mapping to its caller and fall back to a
  system context when none was supplied, which is what an instance's entry point does. The mapping
  is the platform's own now and every composition gets it:
  - a customer is confined to its organization, widened to that organization's subtree only for an
    account with roll-up enabled;
  - an admin gets the scope its role resolves to — every organization, or the organizations
    assigned to a sales representative;
  - an API key bound to an organization is confined to that organization and its service account;
  - system scope remains for a request that identifies nobody (anonymous traffic, an unbound API
    key) and for work with no request at all.

  It fails closed. A composition that does not register the ports the mapping reads confines
  rather than widens: a customer stays on its own organization and an admin reaches no
  organization. The same holds for an admin while `organizations`, `admin_users` or `admin_roles`
  is absent: the admin holds no organization, routes over global data keep answering, and a route
  that reads organization data answers 503 `MODULE_DISABLED` naming the absent module.

  A browser may hold an admin session and a customer session at once — an operator who is also
  signed in to the storefront, and every request made while impersonating a customer. The route
  decides which of the two a request runs as: an admin route runs in the admin's scope and a
  storefront route in the customer's, whichever cookies are present. Admin screens are therefore
  unaffected by a customer session in the same browser.

  For a host that composes the platform itself:
  - `ComposeAppOptions.buildTenantContext` is still accepted and should normally be omitted. A
    supplied mapping is now refused, and the request fails, when it answers a customer or an API
    key bound to an organization with a `system` or `all` context, or an admin with a `system`
    context.
  - `@endora-commerce/mod-organizations` registers a new port, `adminTenantScopePort`
    (`AdminTenantScopePort` and `AdminTenantScope` in `@endora-commerce/contracts`):
    `resolveForAdmin(adminUserId)` answers `{ allowAll: true }` or
    `{ allowAll: false, allowedOrganizationIds }`. The platform reads it by container name; a
    composition that replaces `organizations` should register its own.

- 2b339d3: `addressSnapshotSchema.phone` is now `string | null | undefined`; it was `string | undefined`. An
  order has always answered `phone: null` in `deliveryAddress` and `billingAddress` when the source
  address carries no phone number, so every order response with such an address was refused by the
  published `orderSchema` — a consumer parsing `GET /api/v1/orders/:id`, the order lists, the admin
  order detail or the external order routes with it got a `ZodError` on a correct response. Nothing
  on the wire changes; the schema now accepts what the API sends. The inferred `AddressSnapshot` and
  `Order` types widen with it, so TypeScript code that passed `order.deliveryAddress.phone` where a
  `string | undefined` is required has to handle `null`. `companyName` and `taxId` are unchanged.

## 0.102.0

## 0.101.1

## 0.101.0

## 0.100.2

## 0.100.1

## 0.17.0

### Minor Changes

- 0af8db8: `@endora-commerce/contracts` no longer exports the Comarch XL module's schemas; the module publishes its own

  **If you import any `comarchXl*`/`ComarchXl*` or `xl*`/`Xl*` symbol, `COMARCH_XL_SETTING_CODES`,
  `COMARCH_XL_READ_PERMISSION`, `COMARCH_XL_MANAGE_PERMISSION` or `XL_CONTRACT_VERSION` from
  `@endora-commerce/contracts` or from its `./comarch-xl` subpath, this release removes it.** One
  hundred and thirty-nine exports go: the admin API shapes (connection, connection test, identity,
  warehouse, price-list and status mappings, sync jobs, worker heartbeats, imported offers), the XL
  wire schemas and snapshots, the seven overlay extension ports (`ComarchXlSellabilityPort` and its
  siblings), the setting codes, the two permission codes, and every type inferred beside them.
  They are now on the module's own `./contracts` subpath:

  ```diff
  - import { COMARCH_XL_SETTING_CODES, type ComarchXlSellabilityPort } from '@endora-commerce/contracts';
  + import { COMARCH_XL_SETTING_CODES, type ComarchXlSellabilityPort } from '@endora-commerce/mod-comarch-xl/contracts';
  ```

  A deployment overlay that decorates one of the module's ports imports the port's type from there.
  One symbol that sat in the same file stays where it was imported from: `ContractorCreditLimitPort`,
  the published name of `credit_limits`' `creditLimitService` registration, is `credit_limits`' own
  port and is now declared beside its other contract types. Nothing else in
  `@endora-commerce/contracts` changes: the ERP connector family's shared vocabulary
  (`erp-connector`) and the vendor-neutral imported-invoice seam stay in the free contracts.

  `@endora-commerce/mod-comarch-xl`'s half of this change — the `./contracts` export and the module
  owning its ten error codes as `comarchXlErrorCodes` — is released from the paid repository, which
  the module has moved to.

- 7b1f09e: `@endora-commerce/contracts` no longer exports the Infakt connector's schemas; the connector publishes its own

  **If you import any `infakt*`/`Infakt*` symbol or an `INFAKT_*` constant from
  `@endora-commerce/contracts` or from its `./infakt` subpath, this release removes it.** Thirty-three
  exports go: the environment and setting codes, the permission and credential codes, the delivery
  messages, the API hosts and paths, the service-line, webhook-event and connection request and
  response shapes, `InfaktHttpPort`, and every type inferred beside them. They are now on the
  module's own `./contracts` subpath:

  ```diff
  - import { INFAKT_SETTING_CODES, infaktConnectionDtoSchema } from '@endora-commerce/contracts';
  + import { INFAKT_SETTING_CODES, infaktConnectionDtoSchema } from '@endora-commerce/mod-infakt/contracts';
  ```

  Nothing else in `@endora-commerce/contracts` changes; the invoice ledger's own vendor-neutral
  contract stays where it is.

  `@endora-commerce/mod-infakt` gains the `./contracts` export. It already declared `zod` as a peer
  dependency, so installing it pulls in nothing new.

  `@endora-commerce/mod-infakt` also owns its two error codes now: the root export gains
  `infaktErrorCodes`, declared with `defineModuleErrorCodes`, and the webhook's raise site uses it
  instead of `ERROR_CODES.INFAKT_WEBHOOK_UNAUTHORIZED`. The codes' values on the wire do not change.

  The `mod-infakt` half of this change is released from the paid-modules repository, which the module left for
  (feature 134); this repository no longer versions `@endora-commerce/mod-infakt`.

- 8418b7d: `invoiceIssuedEventSchema`, `invoiceCorrectedEventSchema`, `InvoiceIssuedEvent` and `InvoiceCorrectedEvent` are declared in the invoices contract

  The payload schemas of `invoice.issued.v1` and `invoice.corrected.v1` belong to the module that raises those events, so they moved from `@endora-commerce/contracts/ksef` to `@endora-commerce/contracts/invoices`. The shapes are unchanged.

  An import from the package root (`@endora-commerce/contracts`) keeps working. An import from the subpath has to change:

  ```ts
  // before
  import { invoiceIssuedEventSchema } from '@endora-commerce/contracts/ksef';
  // after
  import { invoiceIssuedEventSchema } from '@endora-commerce/contracts/invoices';
  ```

  `minor` rather than `patch` because the `./ksef` subpath no longer exports the four names.

- a12d4bf: Add the contributed invoice PDF block contract: `InvoicePdfBlockRegistration`, `InvoicePdfBlockRegistryPort`, `InvoiceTemplateBlockDescription` and `InvoiceTemplateBlockField`

  A module that declares an invoice template block now renders, describes and enriches it itself, by registering an `InvoicePdfBlockRegistration` into `invoices`' `invoicePdfBlockRegistry` from its composition root:

  ```ts
  lazyPort<InvoicePdfBlockRegistryPort>(ctx, 'invoicePdfBlockRegistry').register({
    name: 'acme.InvoiceStamp', // `<moduleId>.<LocalName>`, as your manifest declares it
    moduleId: 'acme',
    describe: () => ({ label: 'Stamp', fields: {} }),
    resolve: (invoiceId) => loadStampData(invoiceId), // optional, read once per render
    render: ({ props, invoice, locale, resolved }) => ({ text: '…' }), // one pdfmake content node
  });
  ```

  `InvoicePdfBlockRegistration.printsKsefReferenceNumber?: boolean` says the block prints the invoice's KSeF number itself. While such a block is present and placed, `invoices` leaves out its own header row for the number, so the number is printed exactly once.

  Additive only; nothing existing changes shape. `minor` because it is new published surface.

- 6738f35: The ERP attachment download seam is now `invoices`' own, and the imported document's source system is open

  **If you implement or import `ComarchXlSaleDocumentAttachmentPort` or `COMARCH_XL_SALE_DOCUMENT_ATTACHMENT_PORT`, this release removes them.** The interface moves, unchanged in shape, to `InvoiceAttachmentFetchPort`, and a connector no longer publishes it under a container name of its own; it registers it into `invoices`' `invoiceAttachmentFetchRegistry` (`INVOICE_ATTACHMENT_FETCH_REGISTRY`) under the source system it imports from:

  ```diff
  - import type { ComarchXlSaleDocumentAttachmentPort } from '@endora-commerce/contracts';
  - ctx.di.providePort('comarchXlSaleDocumentAttachmentPort', …);
  + import type { InvoiceAttachmentFetchRegistryPort } from '@endora-commerce/contracts';
  + ctx.onBoot(() => {
  +   lazyPort<InvoiceAttachmentFetchRegistryPort>(ctx, 'invoiceAttachmentFetchRegistry').register({
  +     system: 'my_erp',        // the value your import writes into externalDocumentRef.system
  +     moduleId: 'my_erp',      // your module id; its effective presence is read on every download
  +     provider: { ensureAttachmentBytes: (input) => … },
  +   });
  + });
  ```

  New exports: `InvoiceAttachmentFetchPort`, `InvoiceAttachmentFetchRegistration`, `InvoiceAttachmentFetchRegistryPort` and `INVOICE_ATTACHMENT_FETCH_REGISTRY`.

  **`externalDocumentRefSchema.system` is a non-empty string (at most 64 characters) instead of `z.literal('comarch_xl')`.** Every value that parsed before still parses; code that narrowed on the literal type now sees `string`.

  **`ErpSaleDocumentAttachmentContext` gains a required `system: string`** — the imported document's `externalDocumentRef.system`. An implementation of `ErpSaleDocumentWritePort.resolveAttachmentContext` outside `@endora-commerce/mod-invoices` has to return it.

- 9ef7f4b: An ERP-imported sale document is identified by `(system, externalId)`, and the import contract names no vendor

  **If you call `ErpSaleDocumentWritePort.upsertImportedDocument`, rename three fields.** The source system's own document id, document number and attachment id lose their `xl` prefix:

  ```diff
    externalDocumentRef: {
      system: 'my_erp',
  -   xlSaleDocumentId: doc.id,
  -   xlDocumentNumber: doc.number,
  +   externalId: doc.id,
  +   externalNumber: doc.number,
      documentKind: 'invoice',
    },
    attachments: doc.attachments.map((a) => ({
  -   xlAttachmentId: a.id,
  +   externalAttachmentId: a.id,
      fileName: a.fileName,
    })),
  ```

  **`externalDocumentRefSchema.externalId` is required and non-empty** (at most 128 characters); `xlSaleDocumentId` accepted an empty string. A reference that carries only `xlSaleDocumentId` no longer parses.

  **`ErpSaleDocumentAttachmentContext`** — what `resolveAttachmentContext` answers — carries `externalId` and `externalAttachmentId` in place of `xlSaleDocumentId` and `xlAttachmentId`.

  The pair is the identity: the same `externalId` from another `system` is another document. The Comarch XL vendor schemas in `comarch-xl.ts` keep their `xl*` names, which describe Comarch XL's own API.

- 1b3fb93: `@endora-commerce/contracts` no longer exports the KSeF module's schemas; the module publishes its own

  **If you import any `ksef*`/`Ksef*` symbol, `KSEF_SETTING_CODES`, `KSEF_ENVIRONMENTS` or another
  `KSEF_*` constant from `@endora-commerce/contracts` or from its `./ksef` subpath, this release
  removes it.** Forty-four exports go: the environment, credential and submission vocabularies, the
  credential, connection-test and submission request and response shapes, the submit job payload,
  the setting codes, and every type inferred beside them. They are now on the module's own
  `./contracts` subpath:

  ```diff
  - import { KSEF_SETTING_CODES, ksefSubmissionDtoSchema } from '@endora-commerce/contracts';
  + import { KSEF_SETTING_CODES, ksefSubmissionDtoSchema } from '@endora-commerce/mod-ksef/contracts';
  ```

  Nothing else in `@endora-commerce/contracts` changes. The KSeF state the free tier records —
  `ksefReferenceNumber` and `ksefProcessedAt` on the invoice, and `invoice_ledger`'s KSeF routing —
  stays in the free contracts, and `invoice.issued.v1` / `invoice.corrected.v1` stay in the invoices
  contract.

  `@endora-commerce/mod-ksef` gains the `./contracts` export. It already declared `zod` as a peer
  dependency, so installing it pulls in nothing new.

  `@endora-commerce/mod-ksef` also owns its seven error codes now: the root export gains
  `ksefErrorCodes`, declared with `defineModuleErrorCodes`, and every raise site in the module uses it
  instead of `ERROR_CODES.KSEF_*`. The codes' values on the wire do not change.

  The `mod-ksef` half of this change is released from the paid-modules repository, which the module left for
  (feature 134); this repository no longer versions `@endora-commerce/mod-ksef`.

## 0.16.0

### Minor Changes

- 8a88460: `@endora-commerce/contracts` no longer exports the Ergonode PIM connector's schemas; the connector publishes its own

  **If you import any `ergonode*`/`Ergonode*` symbol, `PIM_ERGONODE_SETTING_CODES` or
  `PimErgonodeSettingCode` from `@endora-commerce/contracts`, this release removes it.** Eighty-nine
  exports go: the source vocabulary, the import run and issue shapes, the mapping-decision
  vocabulary, the setting codes, the connection and connection-test shapes, the run list and detail
  shapes, the attribute-mapping, price-binding, category-mapping and field-protection request and
  view shapes, and every type inferred beside them. They are now on the module's own `./contracts`
  subpath:

  ```diff
  - import { ergonodeConnectionSchema, PIM_ERGONODE_SETTING_CODES } from '@endora-commerce/contracts';
  + import { ergonodeConnectionSchema, PIM_ERGONODE_SETTING_CODES } from '@endora-commerce/mod-pim-ergonode/contracts';
  ```

  Nothing else in `@endora-commerce/contracts` changes. The two catalogue schemas the Ergonode shapes
  compose — `apiAttributeTypeSchema` and `productLinkKindSchema` — stay where they are, and the
  module now imports them from there.

  **`ERROR_CODES` also loses its thirteen `PIM_ERGONODE_*` members**, because the enumeration is the
  vocabulary of the codes this repository's own modules declare and the Ergonode connector is no longer
  one of them: `PIM_ERGONODE_NOT_CONFIGURED`, `PIM_ERGONODE_CONNECTION_EXISTS`,
  `PIM_ERGONODE_SCHEDULE_INVALID`, `PIM_ERGONODE_TREE_REQUIRED`,
  `PIM_ERGONODE_IMPORT_ALREADY_RUNNING`, `PIM_ERGONODE_CONNECTION_DISABLED`,
  `PIM_ERGONODE_TYPE_INCOMPATIBLE`, `PIM_ERGONODE_TARGET_ATTRIBUTE_NOT_FOUND`,
  `PIM_ERGONODE_TARGET_ALREADY_MAPPED`, `PIM_ERGONODE_CURRENCY_INACTIVE`,
  `PIM_ERGONODE_ATTRIBUTE_NOT_PRICE_TYPE`, `PIM_ERGONODE_BINDING_EXISTS` and
  `PIM_ERGONODE_FIELD_PATH_INVALID`. The strings on the wire are unchanged; code that compared against
  them takes `pimErgonodeErrorCodes` from `@endora-commerce/mod-pim-ergonode` instead.
  `PRICE_LIST_NOT_FOUND`, which the connector raises and `price_lists` owns, stays.

  `@endora-commerce/mod-pim-ergonode` itself is no longer released from this repository: it leaves for
  the paid-modules repository in the same change, and its next version — with the `./contracts`
  export and a root `pimErgonodeErrorCodes`, declared with `defineModuleErrorCodes` — is cut there.
  It already declared `zod` as a peer dependency, so installing it pulls in nothing new.

## 0.15.0

### Minor Changes

- 43f445d: `@endora-commerce/contracts` no longer exports the Akeneo PIM connector's schemas; the connector publishes its own

  **If you import any `akeneo*`/`Akeneo*` symbol, `PIM_AKENEO_SETTING_CODES` or `PimAkeneoSettingCode`
  from `@endora-commerce/contracts`, this release removes it.** Sixty-three exports go: the setting
  codes, the connection, bootstrap and probe shapes, the full-delivery and live-record HMAC envelopes,
  the import run and issue shapes, the lookup query and page shapes, the field-protection request and
  product view, and every type inferred beside them. They are now on the module's own `./contracts`
  subpath:

  ```diff
  - import { akeneoConnectionDtoSchema, PIM_AKENEO_SETTING_CODES } from '@endora-commerce/contracts';
  + import { akeneoConnectionDtoSchema, PIM_AKENEO_SETTING_CODES } from '@endora-commerce/mod-pim-akeneo/contracts';
  ```

  **`ERROR_CODES` also loses its seven `PIM_AKENEO_*` members**, because the enumeration is the
  vocabulary of the codes this repository's own modules declare and the Akeneo connector is no longer
  one of them: `PIM_AKENEO_NOT_CONFIGURED`, `PIM_AKENEO_CONNECTION_DISABLED`,
  `PIM_AKENEO_BOOTSTRAP_INCOMPLETE`, `PIM_AKENEO_DELIVERY_ID_CONFLICT`, `PIM_AKENEO_CHANNEL_REQUIRED`,
  `PIM_AKENEO_SECRET_REQUIRED` and `PIM_AKENEO_FIELD_KEY_INVALID`. The strings on the wire are
  unchanged; code that compared against them takes `pimAkeneoErrorCodes` from
  `@endora-commerce/mod-pim-akeneo` instead.

  Nothing else in `@endora-commerce/contracts` changes. The two catalogue schemas the Akeneo shapes
  compose — `apiAttributeTypeSchema` and `productLinkKindSchema` — stay where they are, and the
  module now imports them from there.

  `@endora-commerce/mod-pim-akeneo` itself is no longer released from this repository, from this
  change on; its next version — with the `./contracts` export and a root `pimAkeneoErrorCodes`,
  declared with `defineModuleErrorCodes` — is cut from the repository that now holds its source.
  It already declared `zod` as a peer dependency, so installing it pulls in nothing new.

- 07f1e8c: `@endora-commerce/contracts` no longer exports the Pimcore PIM connector's schemas; the connector publishes its own

  **If you import any `pimcore*`/`Pimcore*` symbol, `PIM_PIMCORE_SETTING_CODES` or
  `PimPimcoreSettingCode` from `@endora-commerce/contracts`, this release removes it.** A hundred and
  sixty-two exports go: the source vocabulary, the import run and issue shapes, the mapping-decision
  vocabulary, the connection, bootstrap and probe shapes, the complete-record and full-delivery HMAC
  envelopes, the lookup query and page shapes, the admin mapping, price-binding and field-protection
  request and view shapes, the setting codes, and every type inferred beside them. They are now on
  the module's own `./contracts` subpath:

  ```diff
  - import { pimcoreConnectionDtoSchema, PIM_PIMCORE_SETTING_CODES } from '@endora-commerce/contracts';
  + import { pimcoreConnectionDtoSchema, PIM_PIMCORE_SETTING_CODES } from '@endora-commerce/mod-pim-pimcore/contracts';
  ```

  **`ERROR_CODES` also loses its seventeen `PIM_PIMCORE_*` members**, because the enumeration is the
  vocabulary of the codes this repository's own modules declare and the Pimcore connector is no longer
  one of them: `PIM_PIMCORE_ALLOWLIST_INVALID`, `PIM_PIMCORE_ATTRIBUTE_NOT_PRICE_TYPE`,
  `PIM_PIMCORE_BINDING_EXISTS`, `PIM_PIMCORE_BOOTSTRAP_INCOMPLETE`, `PIM_PIMCORE_CONNECTION_DISABLED`,
  `PIM_PIMCORE_CONNECTION_EXISTS`, `PIM_PIMCORE_CURRENCY_INACTIVE`, `PIM_PIMCORE_FIELD_PATH_INVALID`,
  `PIM_PIMCORE_IMPORT_ALREADY_RUNNING`, `PIM_PIMCORE_NOT_CONFIGURED`, `PIM_PIMCORE_OTHER_PIM_ENABLED`,
  `PIM_PIMCORE_PRODUCT_FOLDER_REQUIRED`, `PIM_PIMCORE_PUSH_AUTH_REJECTED`, `PIM_PIMCORE_ROOT_REQUIRED`,
  `PIM_PIMCORE_TARGET_ALREADY_MAPPED`, `PIM_PIMCORE_TARGET_ATTRIBUTE_NOT_FOUND` and
  `PIM_PIMCORE_TYPE_INCOMPATIBLE`. The strings on the wire are unchanged; code that compared against
  them takes `pimPimcoreErrorCodes` from `@endora-commerce/mod-pim-pimcore` instead.

  Nothing else in `@endora-commerce/contracts` changes. The two catalogue schemas the Pimcore shapes
  compose — `apiAttributeTypeSchema` and `productLinkKindSchema` — stay where they are, and the
  module now imports them from there.

  `@endora-commerce/mod-pim-pimcore` itself is no longer released from this repository: it leaves for
  the paid-modules repository in the same change, and its next version — with the `./contracts`
  export and a root `pimPimcoreErrorCodes`, declared with `defineModuleErrorCodes` — is cut there.
  It already declared `zod` as a peer dependency, so installing it pulls in nothing new.

- 7392332: `@endora-commerce/contracts` no longer exports the UnoPim PIM connector's schemas; the connector publishes its own

  **If you import any `unopim*`/`Unopim*` symbol, `PIM_UNOPIM_SETTING_CODES`, `PimUnopimSettingCode`
  or the `PIM_UNOPIM_{READ,WRITE}_PERMISSION` constants from `@endora-commerce/contracts`, this
  release removes it.** One hundred and five exports go: the permission and setting codes, the
  connection, mapping, price-binding and field-protection request and response shapes, the import run
  and issue shapes, the webhook event, and every type inferred beside them. They are now on the
  module's own `./contracts` subpath:

  ```diff
  - import { unopimConnectionSchema, PIM_UNOPIM_SETTING_CODES } from '@endora-commerce/contracts';
  + import { unopimConnectionSchema, PIM_UNOPIM_SETTING_CODES } from '@endora-commerce/mod-pim-unopim/contracts';
  ```

  Nothing else in `@endora-commerce/contracts` changes. The catalogue and PIM-connector schemas the
  UnoPim shapes compose — `apiAttributeTypeSchema`, `productLinkKindSchema`, `pimFieldPathSchema` and
  the `pimImport*` schemas — stay where they are, and the module now imports them from there.

  **`ERROR_CODES` also loses its twelve `PIM_UNOPIM_*` members**, because the enumeration is the
  vocabulary of the codes this repository's own modules declare and the UnoPim connector is no longer
  one of them: `PIM_UNOPIM_NOT_CONFIGURED`, `PIM_UNOPIM_CONNECTION_EXISTS`,
  `PIM_UNOPIM_SCHEDULE_INVALID`, `PIM_UNOPIM_IMPORT_ALREADY_RUNNING`,
  `PIM_UNOPIM_CONNECTION_DISABLED`, `PIM_UNOPIM_TYPE_INCOMPATIBLE`,
  `PIM_UNOPIM_TARGET_ATTRIBUTE_NOT_FOUND`, `PIM_UNOPIM_TARGET_ALREADY_MAPPED`,
  `PIM_UNOPIM_CURRENCY_INACTIVE`, `PIM_UNOPIM_ATTRIBUTE_NOT_PRICE_TYPE`,
  `PIM_UNOPIM_BINDING_EXISTS` and `PIM_UNOPIM_FIELD_PATH_INVALID`. The strings on the wire are
  unchanged; code that compared against them takes `pimUnopimErrorCodes` from
  `@endora-commerce/mod-pim-unopim` instead.

  `@endora-commerce/mod-pim-unopim` itself is no longer released from this repository: it leaves for
  the paid-modules repository in the same change, and its next version — with the `./contracts`
  export and a root `pimUnopimErrorCodes`, declared with `defineModuleErrorCodes` — is cut there.
  It already declared `zod` as a peer dependency, so installing it pulls in nothing new.

### Patch Changes

- b9c6686: Adds `apiAttributeTypeOf(valueType, displayAsSlider)`, exported beside `attributeValueTypeSchema` and `apiAttributeTypeSchema`: the one definition of how a stored attribute value type and its slider flag project onto the API attribute type. A slider flag on `number` or `price` answers `slider` and is ignored elsewhere; `string`, `boolean` and `date` answer `input`; `enum` and `select` answer `select`. Nothing existing changes.
- f89d305: Add the `payment_method.list.integrations` admin zone so separately installed payment gateways can contribute their own configuration cards. Remove the five extracted gateways' breadcrumb and shared translation records from the free packages.
- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

## 0.14.0

### Minor Changes

- d5778af: `@endora-commerce/contracts` no longer exports DHL Parcel's schemas; a carrier integration publishes its own

  **If you import any `dhlParcel*` or `DhlParcel*` symbol from `@endora-commerce/contracts`, this
  release removes it.** Twenty-two exports go — `dhlParcelModeSchema`,
  `dhlParcelAdapterKeySchema`, `dhlParcelLabelTypeSchema`, `dhlParcelConfigSchema`,
  `dhlParcelConfigUpdateSchema`, `dhlParcelPickupPointSchema`,
  `dhlParcelPickupPointListSchema`, `dhlParcelPickupPointQuerySchema`,
  `dhlParcelShipmentDocumentSchema`, `dhlParcelCourierBookingRequestSchema`,
  `dhlParcelConnectionCheckSchema` and each inferred type beside them. They are now on
  `@endora-commerce/mod-dhl-parcel`'s own `./contracts` subpath:

  ```diff
  - import { dhlParcelConfigSchema, type DhlParcelAdapterKey } from '@endora-commerce/contracts';
  + import { dhlParcelConfigSchema, type DhlParcelAdapterKey } from '@endora-commerce/mod-dhl-parcel/contracts';
  ```

  **Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
  package. A schema describing DHL24's SOAP API is only usable by an instance that installs the DHL
  Parcel module, so shipping it here asked every consumer to carry per-vendor contract for an
  integration most of them will never run — and, once a carrier module is published from somewhere
  else, put the schema and the code it describes under two owners. The module now carries both.
  This is the same move `@endora-commerce/mod-inpost` made one release earlier, and DHL Parcel is
  the last carrier it applies to.

  `minor` rather than `major`: no package in this repository leaves `0.x` before the move to public
  npmjs, and in a `0.x` series a minor already takes every caret dependent out of range, which is
  the whole consumer-facing meaning of a break.

  **Nothing else in the estate changes shape.** The `./contracts` subpath is not new — it arrived
  with `@endora-commerce/mod-inpost` — and it is rendered from a `src/contracts/` directory, so it
  appears only on a package that has one.

  **No changeset names `@endora-commerce/mod-dhl-parcel`, and that is deliberate.** This merge
  request deletes that package from this repository; the module is published from the repository
  that now holds its source, and a changeset for a package this branch deletes has nothing to
  version.

  **And none names `@endora-commerce/mod-delivery-methods` either**, which it did when
  `mod-inpost` left: that release was the one where its shipped page stopped linking a departing
  sibling, and the page already names carrier modules without linking one. Checked rather than
  assumed — no `.md` shipped by any package links a DHL page.

- e267293: `@endora-commerce/contracts` no longer exports the five payment gateways' schemas; a gateway integration publishes its own

  **If you import any `stripe*`/`Stripe*`, `tpay*`/`Tpay*`, `payu*`/`Payu*`, `autopay*`/`Autopay*`
  or `paypal*`/`Paypal*` symbol from `@endora-commerce/contracts`, this release removes it.** One
  hundred and thirty exports go, across five vendors — 23 for Stripe, 31 for TPay, 33 for PayU, 20
  for Autopay and 23 for PayPal. Each vendor's config, config-update, method-rule, method-update,
  method-list, mode and display-mode schemas, its saved-card and BLIK-alias shapes where it has
  them, its storefront config and its pay/create/capture request and response shapes, together with
  every type inferred beside them. They are now on each module's own `./contracts` subpath:

  ```diff
  - import { stripeConfigSchema, stripeMethodListSchema } from '@endora-commerce/contracts';
  + import { stripeConfigSchema, stripeMethodListSchema } from '@endora-commerce/mod-stripe/contracts';
  ```

  **Two removals are worth calling out by name, because neither reads as a gateway symbol.**
  `countryCodeSchema` — the unprefixed ISO-3166-1 alpha-2 schema — was declared in `stripe.ts` and
  reached the barrel from there, so it leaves with Stripe and is now
  `@endora-commerce/mod-stripe/contracts`' export. Nothing in this repository imported it outside
  that file, but its name says nothing about Stripe, so a consumer that found it on the barrel has
  no way of guessing where it went without this paragraph. `AUTOPAY_GATEWAY_ID_BY_METHOD`, the
  method-to-GatewayID map, moves with Autopay for the same reason it existed: it is Autopay's wire
  vocabulary, not the platform's.

  **Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
  package. A schema describing Stripe's or PayU's API is only usable by an instance that installs
  that gateway, so shipping it here asked every consumer to carry per-vendor contract for
  integrations most of them will never run — and, once a gateway module is published from somewhere
  else, put the schema and the code it describes under two owners. Each module now carries both.
  This is the same split `@endora-commerce/mod-inpost`, `@endora-commerce/mod-dhl-parcel` and
  `@endora-commerce/mod-wfirma` took before them; these five are the fourth through eighth packages
  to use the `./contracts` subpath, and the first payment family to.

  The five gateway packages are a **minor** because each gains a published subpath — `./contracts`,
  rendered into its `exports` map by `manifests:generate` — which is additive and nothing else about
  them changes. `@endora-commerce/contracts` is a minor rather than a `major`: no package in this
  repository leaves `0.x` before the move to public npmjs, and in a `0.x` series a minor already
  takes every caret dependent out of range, which is the whole consumer-facing meaning of a break.

  **One duplication is created deliberately and is not solved here.** A published
  `@endora-commerce/contracts` older than this release still exports all 130 symbols, so an
  instance holding both it and a new gateway package resolves two copies of the same Zod schemas
  until a new `contracts` is cut. They are structurally identical and neither is compared against
  the other by identity anywhere, so the duplication is latent; it ends with the next `contracts`
  release, exactly as it does for the three packages that took this split before.

- d6bfea0: `@endora-commerce/contracts` no longer exports InPost's schemas; a carrier integration publishes its own

  **If you import any `inpost*` symbol from `@endora-commerce/contracts`, this release removes it.**
  Twenty-one exports go — `inpostConfigSchema`, `inpostConfigUpdateSchema`,
  `inpostGeowidgetConfigSchema`, `inpostLockerShippingAdapterDataSchema`, `inpostModeSchema`,
  `inpostAdapterKeySchema`, `inpostSendingMethodSchema`, `inpostParcelTemplateSchema`,
  `inpostLabelSizeSchema`, `inpostLabelErrorCodeSchema`, `normalizePolishMobilePhone` and each
  inferred type beside them. They are now on `@endora-commerce/mod-inpost`'s own `./contracts`
  subpath:

  ```diff
  - import { inpostConfigSchema, normalizePolishMobilePhone } from '@endora-commerce/contracts';
  + import { inpostConfigSchema, normalizePolishMobilePhone } from '@endora-commerce/mod-inpost/contracts';
  ```

  **Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
  package. A schema describing InPost's ShipX API is only usable by an instance that installs the
  InPost module, so shipping it here asked every consumer to carry ~5 300 lines of per-vendor
  contract for integrations most of them will never run — and, once a carrier module is published
  from somewhere else, put the schema and the code it describes under two owners. The module now
  carries both.

  `minor` rather than `major`: no package in this repository leaves `0.x` before the move to public
  npmjs, and in a `0.x` series a minor already takes every caret dependent out of range, which is
  the whole consumer-facing meaning of a break.

  **A new published subpath, `./contracts`, exists on module packages from this release.** It is
  rendered from a `src/contracts/` directory and appears only on a package that has one; nothing
  else in the estate changes shape. `@endora-commerce/mod-inpost` is the first to use it.

  `@endora-commerce/mod-delivery-methods` is a documentation patch, and the reason is the same
  split: its page linked a sibling carrier's page, which is a broken link in every instance that
  does not install that carrier. It now names carrier modules without linking one.

- b3b4286: `@endora-commerce/contracts` no longer exports wFirma's schemas or its two error codes

  **If you import any `wfirma*` or `WFIRMA_*` symbol from `@endora-commerce/contracts`, this
  release removes it.** Twenty-six exports go — `WFIRMA_SETTING_CODES`, `WFIRMA_READ_PERMISSION`,
  `WFIRMA_WRITE_PERMISSION`, `WFIRMA_INSTANCE_CREDENTIAL_CODE`, `WFIRMA_DELIVERY_MESSAGES`,
  `WFIRMA_HOST`, the eight `WFIRMA_*_PATH` endpoint constants, `WFIRMA_WEBHOOK_EVENT_IDS`,
  `wfirmaWebhookEventIdSchema`, `wfirmaWebhookEventDescriptorSchema`, `wfirmaConnectionDtoSchema`,
  `wfirmaConnectionUpsertBodySchema`, `wfirmaConnectionTestResponseSchema`, `WfirmaHttpPort` and
  each inferred type beside them. They are now on `@endora-commerce/mod-wfirma`'s own
  `./contracts` subpath:

  ```diff
  - import { wfirmaConnectionDtoSchema, WFIRMA_HOST } from '@endora-commerce/contracts';
  + import { wfirmaConnectionDtoSchema, WFIRMA_HOST } from '@endora-commerce/mod-wfirma/contracts';
  ```

  **And `ERROR_CODES` loses two members**, `WFIRMA_CONNECTION_FAILED` and
  `WFIRMA_WEBHOOK_NOT_FOUND`. That half is not tidying and has a rule behind it: an `ERROR_CODES`
  member that no installed manifest declares routes nowhere, so an operator reads the raising
  code's own English instead of a translated sentence — `check:error-translations`'
  `undeclared-enum-member`, which is what a code whose only declarant has left looks like. The two
  codes are declared by `@endora-commerce/mod-wfirma`'s manifest and translated in its own
  `i18n/` bundles, which is where they now live in full.

  **Why, and why it is not an accident of tidying.** `@endora-commerce/contracts` is a free
  package. A schema describing wFirma's REST API is only usable by an instance that installs the
  wFirma module, so shipping it here asked every consumer to carry per-vendor contract for an
  integration most of them will never run — and, once a vendor module is published from somewhere
  else, put the schema and the code it describes under two owners. The module now carries both.
  This is the same split `@endora-commerce/mod-inpost` and `@endora-commerce/mod-dhl-parcel` took
  in the `0.10` line; `@endora-commerce/mod-wfirma` is the third package to use the `./contracts`
  subpath and the first outside the carrier family.

  `minor` rather than `major`: no package in this repository leaves `0.x` before the move to
  public npmjs, and in a `0.x` series a minor already takes every caret dependent out of range,
  which is the whole consumer-facing meaning of a break.

  `@endora-commerce/mod-invoice-ledger` is a patch and nothing it publishes changes behaviour: a
  doc comment on `InvoiceLedgerDeliveryAttempt.remoteVendorNumber` named one vendor for a field
  every vendor writes, and its registry test stated a two-member vendor family whose second member
  was a module this repository no longer holds. Both now say what they mean without naming a
  vendor, which is D-256's rule for this module read one comment further than D-256 reached.

### Patch Changes

- 8a05249: `@endora-commerce/mod-invoice-ledger` no longer recognises a ledger vendor's sentences; it applies a shape floor

  **If you write a ledger adapter against `InvoiceLedgerDeliveryPort`, the text you pass to
  `markFailed` is now stored as you wrote it, provided it looks like a sentence.** Until this
  release the ledger imported two vendors' error vocabularies and stored `last_error`
  verbatim only when your text was one of those vendors' sentences — anything else, including
  every sentence your own adapter authored, became _"The ledger vendor returned an unreadable
  error."_ The floor is now vendor-independent and refuses four shapes over the trimmed input:
  - it contains `<` or `>`;
  - it contains a control character — a newline, a carriage return, a tab, or any of C0, DEL, C1;
  - its first character is `{` or `[`;
  - it is longer than 500 characters.

  Any of those yields `INVOICE_LEDGER_UNREADABLE_VENDOR_ERROR`. **Nothing is truncated** — a
  refusal is whole, because half a sentence is prose nobody wrote and can cut a leaked token in
  two. Whitespace-only input is refused as before, and `null` and `''` are returned unchanged.

  **What this means for an adapter you maintain.** Map the vendor's HTTP outcome onto your own
  operator sentence before you call `markFailed`, and assert in your own package that every
  sentence you can produce clears the four clauses above. Do not hand the ledger a response body,
  a header dump or an exception's `stack`: it will be stored as `unreadable` and the operator
  loses the detail. If your sentence composes text the vendor wrote — a field name, a validation
  message — bound that composition yourself; the 500 is a backstop, not a budget.

  **Why.** `@endora-commerce/mod-invoice-ledger` is the general-purpose half of this family: it
  persists a delivery and knows nothing about any one accounting vendor. It was nevertheless
  importing `WFIRMA_DELIVERY_MESSAGES` and `INFAKT_DELIVERY_MESSAGES` to re-recognise sentences the
  two adapters had already mapped — one vocabulary with two owners, and a vendor-agnostic package
  carrying two specific integrations' error text. The vendor that authors a sentence now owns both
  the vocabulary and the mapping; the ledger, which is the component that persists, keeps a floor
  and no vocabulary. A registry contributed by the vendors was considered and refused: on the read
  path a deactivated vendor's historical rows would re-read as _unreadable_, and on the write path
  the caller **is** the vendor, so the ledger would be asking a registry the vendor populated
  whether the vendor's sentence is one of the vendor's sentences.

  **`@endora-commerce/mod-wfirma` is no longer named here, and the release it was promised is
  not this repository's to make.** Feature 134's wave 4 took that package out of this workspace
  between this changeset being written and this release going out, so `changeset version` can no
  longer honour an intent for it — `check:release-intent`'s `unversionable-changeset`, which is
  the finding that exists because a changeset naming a non-member exits 0 from `changeset status`
  and is byte-identical to a clean branch. The behaviour below is real and unreleased; whoever
  cuts `@endora-commerce/mod-wfirma` next, from the repository that now holds its source, owes it
  a `minor` and this paragraph as its body.

  **`formatWfirmaValidationError` now bounds its own composed tail, and exports the bound.** The composed sentence is `wFirma rejected the invoice.` followed
  by the field messages lifted out of wFirma's own JSON or XML body, which was unbounded. A field
  message carrying markup or a control character is now dropped whole; a composition whose tail
  exceeds `WFIRMA_VALIDATION_TAIL_MAX_LENGTH` (300, newly exported from
  `./backend`'s `wfirma-rest-client`) falls back to the bare sentence. The vendor sentence is
  never truncated and never exceeds the ledger's floor.

  **`@endora-commerce/contracts`: a comment, and nothing else.** The doc-blocks on
  `INFAKT_DELIVERY_MESSAGES` and, at the time, `WFIRMA_DELIVERY_MESSAGES` said _"Operator
  sentences the … worker and ledger mapper share"_, which is the design this release overturns.
  The wFirma half of that sentence has since left this package altogether — the sibling changeset
  in this same release removes it — so what this `patch` still describes is the Infakt doc-block.
  No exported value, type or schema changes for it; the bump is `patch` because a `.d.ts` comment
  is part of what the package emits and nothing more than that moved.

  **No changeset names `@endora-commerce/mod-infakt`.** Its only change is a co-located
  `*.test.ts`, and `src/**/*.test.ts` is excluded from that package's `tsconfig.json` and
  `tsconfig.build.json` alike — so the package emits exactly what it emitted before, and there is
  nothing to version.

## 0.13.0

### Minor Changes

- b413e2d: Connector family membership is declared in each module's own manifest and derived by the
  platform, replacing three hand-maintained arrays and the three boolean flags that
  duplicated them.

  ## Breaking: three manifest fields are removed

  _(Declared `minor` rather than `major` per **D-225**: no package leaves `0.x` before the
  move to public npmjs. In a `0.x` series the two carry the identical consumer-facing
  contract — `^0.9.0` excludes `0.10.0` exactly as it excludes `1.0.0` — so `minor` already
  forces the explicit opt-in that is what "breaking" means to a caller. The break is
  described below, which is where it belongs.)_

  `pimConnector`, `invoiceLedger` and `erpConnector` are gone from `ModuleManifestSchema`,
  along with `PIM_CONNECTOR_MODULES`, `INVOICE_LEDGER_MODULES` and `ERP_CONNECTOR_MODULES`.
  A module that declared one replaces it with a single additive line:

  ```ts
  capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],   // 'pim-connector'
  ```

  A capability's **owner** declares it mutually exclusive and mints the refusal code:

  ```ts
  exclusiveCapabilities: [
    { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
  ],
  ```

  The declaration carries membership only, creates no lifecycle edge, and requires no
  dependency on the owner's package — a key is a string literal, on the same terms as an
  error code. That is the point of the change: a connector installed from npm, and a
  per-deployment overlay module, can now join a family, which an array inside
  `@endora-commerce/contracts` could never let them do without editing a file they do not
  own.

  ## Breaking behaviour on upgrade: three PIM connectors become inactive

  **Read this before upgrading if you run Akeneo, Ergonode or Pimcore.**

  `pim_akeneo`, `pim_ergonode` and `pim_pimcore` shipped activated by default. They now ship
  **deactivated**, as every member of a mutually exclusive capability must
  (owner ruling, 2026-09-15).
  - **If you chose explicitly** — you switched the connector on or off on
    `/platform/modules` at any point — a settings row records that choice and **nothing
    changes for you**. The new default applies only where no override exists.
  - **If you never chose**, those three connectors were running on the shipped default and
    will be **off** after this upgrade. Switch the one you use back on at
    `/platform/modules`; the choice is recorded and survives every later upgrade.

  Nothing is deleted. Connections, identity maps, field protections and run history are
  preserved exactly as they were, and come back when the connector is switched on — the
  reversal is two clicks and no data is touched. **No migration writes an activation row**:
  changing a shipped default must not rewrite an operator's recorded choice, and the two
  migration-shaped alternatives were considered and rejected — materialising the effective
  value for everyone would persist three simultaneous exclusive claims attributed to an
  operator who made none, and materialising it only where a connection exists would put a
  read across four connectors' tables inside another module's migration and would pick one
  arbitrarily wherever several qualified.

  **Why the default had to move rather than being tolerated.** Exclusivity is enforced when a
  module is _activated_, so it guards the transition and not the state a deployment starts
  in. Three connectors shipping activated were therefore all active from the first boot, with
  no transition to refuse and nothing to report it — and the one connector that consulted the
  registry was refused activation out of the box, naming a connector the operator had never
  configured. A member of an exclusive capability declaring `default: true` is now refused
  when the platform derives the family, because the activation resolver returns booleans and
  carries no provenance: nothing downstream can tell a recorded choice from a shipped
  default, so a member that ships activated holds a claim nobody made.

  ## Also in this change
  - Exclusivity is **one** seam per family — a single `pre` interceptor on
    `POST /api/v1/admin/modules/:id/activation`, registered by the capability's owner over
    the derived family. It previously lived on one member with that member's id hard-coded,
    which is why only 1 of the 12 ordered pairs of the four PIM connectors was refused; all
    12 are now.
  - Exclusion resolves **effective** module presence — platform availability _and_ operator
    activation. A connector a deployment never installed no longer holds a claim.
  - `pim_akeneo` no longer refuses a connection save because another connector has a
    connection; that path validates its own module's activation and nothing else. The
    refusal an operator meets is the activation one, with the same code and the same
    `{ activeModuleId }` detail.
  - `PimErgonodeConnectorActivityPort` is removed from `@endora-commerce/contracts`: it
    existed so one connector could ask another about its connections, and has no caller.
  - Two keys never exclude each other. One ERP connector, one PIM connector and one
    invoice-ledger vendor may run together, which was always true and is now asserted.

## 0.12.0

### Minor Changes

- 4915024: Comarch ERP XL integration (feature 119): shared ERP connector layer and Comarch XL adapter.

  **`@endora-commerce/contracts`** adds `erp-connector.ts` and `comarch-xl.ts` (admin and wire
  schemas), `erpConnector` on `ModuleManifestSchema`, and `COMARCH_XL_*` / `ERP_CONNECTOR_*`
  error codes.

  **`@endora-commerce/mod-erp-connector`** is a new non-deactivatable infra package: mutual
  exclusion registry (`erpConnectorRegistryPort`), activation lock entity, and shared job/run
  vocabulary. Subpaths: `.`, `./backend`, `./migrations`.

  **`@endora-commerce/mod-comarch-xl`** is a new switchable connector package: OpenAPI v0.1.0
  REST client, identity mapping, BullMQ detect/sync pipeline, domain apply services, admin UI,
  and documented overlay ports. Subpaths: `.`, `./backend`, `./migrations`, `./admin`. Ships
  `i18n/` and operator documentation under `docs/`.

  **`@endora-commerce/mod-invoices`** extends the module with `erpSaleDocumentWritePort`,
  ERP-imported sale document entities, B2B customer routes, and attachment handling for XL
  sale documents.

  **`@endora-commerce/mod-inventory`** extends `inventoryStockImportPort` for Comarch XL stock
  apply wiring (warehouse snapshot import).

  **`@endora-commerce/mod-catalog`** honours `createProduct` request `status` instead of
  always defaulting new products to `draft`.

  Activation is gated by `comarch_xl.enabled` (default off). Only one `erpConnector: true`
  module may be operator-active at a time.

- 6b2ed26: `QuoteRequestReadPort` gains `findByBusinessId(businessId)`, answering the quote carrying a
  human-facing business id or `null`.

  It exists because `comarch_xl` needs it: an ERP offer names the quote it answers by the
  reference a person read off the document, never by the uuid. The connector had been reading
  `quote_requests` with a raw `select`, which crosses the module boundary without any
  specifier naming it and keeps returning rows after an operator has switched
  `quote_requests` off. Consumers resolve it through the container name
  `quoteRequestReadPort`, as they do the other three methods.

- 55fc950: wFirma invoice-ledger adapter (`specs/131-wfirma-integration/`): a second vendor on the
  existing ledger, with no schema of its own.

  **`@endora-commerce/mod-wfirma`** is a new switchable module package — connection screen and
  credential type, synchronous VAT copy, corrections, paid alignment, webhook ingress and a
  BullMQ delivery worker, plus KSeF delegation when the ledger's routing setting says `vendor`.
  Subpaths: `.`, `./backend`, `./admin`, `./tailwind.css`. Ships `i18n/` (`en`, `pl`) and its
  operator documentation under `docs/`. Activation is `wfirma.activation`, default off; while
  off it performs no wFirma HTTP, its screens and palette entry are gone and the webhook
  answers 503.

  **`@endora-commerce/contracts`** adds `wfirma.ts` (admin and wire schemas, `WfirmaHttpPort`,
  the two `WFIRMA_*` error codes) and extends `invoice-ledger.ts`: `wfirma` joins
  `INVOICE_LEDGER_MODULES`, and `InvoiceLedgerDeliveryPort.markAwaitingRemote` /
  `markSucceeded` take an optional `remoteVendorNumber`, which `LedgerDeliveryRecord` and
  `InvoiceLedgerDeliveryAttempt` now carry. Both port changes are additive — an existing
  implementation keeps compiling and an existing caller keeps its behaviour.

  **`@endora-commerce/mod-invoice-ledger`** implements those two fields: the vendor's own
  document number is recorded on the succeeding attempt and projected onto the record, and
  `markAwaitingRemote` may now also stamp the remote document id and the document map, which a
  vendor that assigns a number before the document is final needs.

  This changeset is written by the reviewer, not by the branch's author: the branch carried
  none, and `check:release-intent --since` refuses it on two counts —
  `manifest-changed-beyond-version` for the new package's manifest and
  `unattributed-package-change` relaying `changeset status`' own exit 1.

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

## 0.11.0

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

## 0.10.0

### Minor Changes

- 5bfefe0: `invoice_ledger_deliveries` and `invoice_ledger_document_maps` carry their own
  `organization_id` and are `@OrgScoped()`. They were
  `@TransitivelyScoped('Invoice', 'invoiceId')`, copied from `KsefSubmission` —
  and `ksef` declares `invoices` in its manifest `dependencies` while
  `invoice_ledger` is `nonDeactivatable` and may not, so an instance installing
  the locked set without `invoices` loaded both classes with no `Invoice`
  registered and the tenancy reconciliation refused its boot before a single
  migration ran.

  `InvoiceLedgerEnqueueInput` gains a required `organizationId`, resolved by the
  caller through `invoiceCopyHostPort` and frozen on the row beside the
  credential, the environment, the numbering mode and the KSeF routing that were
  already frozen there. One migration adds the column, backfills it through
  `invoices` and `orders` behind a `to_regclass` guard, and foreign-keys it to
  `organizations`. There is still no foreign key to `invoices`.

## 0.9.0

### Minor Changes

- 471defd: A scaffolded instance's `.env.example` declares everything that instance reads,
  and the `.env` beside it is the file a client actually edits.

  `endora new instance` wrote a `.env.example` carrying the **five build inputs**
  and nothing else, while the platform declared 23 runtime inputs and nine module
  packages declared nineteen more. The instance acceptance criterion had been
  reporting the gap in its own output for weeks — _"supplied `DATABASE_URL`,
  `REDIS_URL`, `SESSION_COOKIE_SECRET`, `PUBLIC_API_BASE_URL`, `NODE_ENV` to the
  instance's own processes; its `.env.example` declares none of them, so a client
  who fills in the file the command wrote has nothing to put them in"_.

  The file is now derived, never listed: the **resolved platform's**
  `PLATFORM_ENVIRONMENT_INPUTS`, unioned with the `env` of every module manifest
  the run installed, scoped to the members it wrote, each entry carrying that
  declaration's own `describes` and its `requirement` sentence rather than a
  rewrite. A different `--module` set is a different file with nothing edited.

  Three further changes make the file reach the process that needs it.
  - **A `.env` is written**, holding the secrets the run generated
    (`cli-product.md` R2.5d — the `generable && secret` class, four of them over
    the default module set) and a **commented-out** placeholder for every other
    declared input. Commented, because Node's `--env-file` reads `NAME=` as the
    empty string and the platform's `??` fallbacks treat that as a value: a file
    of blanks turned twenty *unset*s into twenty empty strings and the acceptance
    run's health route answered 503 over a search engine that was running. A
    `.env` the operator placed there first is merged into, never rewritten.
  - **Every `node` script the backend member declares carries
    `--env-file-if-exists=../.env`.** Without it the file was inert: the root
    scripts are `pnpm -C backend run …`, so a `.env` at the root of the tree was
    read by nothing and a client who filled it in still could not start.
  - The next-steps block no longer says `cp .env.example .env`, which would now
    overwrite the generated secrets with empty strings.

  New in `@endora-commerce/contracts`: `unionEnvironmentInputs`, the join over
  several authors' declarations, first author wins. New in
  `@endora-commerce/cli`: `instanceEnvironmentInputs`, `declaredEnvironmentInputs`,
  `generableEnvironmentInputs`, `backendScripts`, and `parseEnvFile` /
  `renderEnvValue` / `writeEnvFile` re-exported from the package root.
  `ModuleCandidate` gains `env`, `PlanInput` gains `declared`, `existingEnv` and
  `generated`, `DeployInput` gains `declared`, and `loadModuleCandidates` returns
  `{ candidates, platformEnv }` instead of the map alone — all four are breaking
  for a caller that constructs one of those shapes, and `major` is refused in a
  `0.x` series (D-225).

- c1d281f: `ModuleManifestSchema` gains `env?: EnvironmentInput[]` — the environment inputs a
  module owns, declared beside `permissions`, `actions`, `errorCodes` and
  `cliCommands`, so the same tree walk carries them into the generated manifest index.

  This is the only way a module's requirements can reach a client. A module package
  ships `dist`, `i18n` and `docs`; `.env.example` is a file in the platform's own
  repository, so a client who installs thirty modules and copies the example gets a
  file that does not mention what those modules read.

  `defineModuleManifest` now throws on an entry whose `owner` is not
  `{ kind: 'module', moduleId: <this module> }`. A module declares only what it
  **owns**: its read of a platform-owned name — `NODE_ENV`, `STOREFRONT_BASE_URL`,
  `REVALIDATE_SECRET` and the rest — is satisfied by the platform's own declaration,
  and declaring it again would be one fact with thirty homes.

  The field is optional and additive: a manifest that declares nothing is unchanged.

- 52c2bfd: `SearchReindexPort` is published: the container name `searchReindexPort`, owned
  by `search`, with the `Container name:` doc block its consumers read.

  It had a registration and no contract, which was invisible while the only
  consumer was a composition root — `check:port-shape`'s population is a module's
  own resolutions, and a root's read is outside it. `catalog` resolves the name
  directly since `specs/117-instance-bring-up/` Phase 6, and the check reported
  it on the first run.

### Patch Changes

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

## 0.8.0

### Minor Changes

- 5394b8f: Add Akeneo PIM transport error codes and `PimErgonodeConnectorActivityPort`.

  `ERROR_CODES` gains `PIM_AKENEO_NOT_CONFIGURED`, `PIM_AKENEO_CONNECTION_DISABLED`,
  `PIM_AKENEO_BOOTSTRAP_INCOMPLETE`, `PIM_AKENEO_DELIVERY_ID_CONFLICT`,
  `PIM_AKENEO_CHANNEL_REQUIRED`, `PIM_AKENEO_SECRET_REQUIRED`, and the shared
  `PIM_CONNECTOR_ALREADY_ACTIVE` used when enabling Akeneo while another PIM
  connector is already on.

  `PimErgonodeConnectorActivityPort` is the gated read Akeneo uses for that
  check (`pimErgonodeConnectorActivityPort`). Additive; existing Ergonode codes
  are unchanged.

- 0c9a799: Add Akeneo HMAC lookup item schemas for every collection in `lookups.md`.

  `akeneoLookupPageSchema` plus attribute-set, category, sales-channel, language
  and price-list item shapes join the existing attribute and product-link-kind
  schemas. Additive.

- e20276c: Add Akeneo field-protection DTOs and `PIM_AKENEO_FIELD_KEY_INVALID`.

  `akeneoFieldProtectionSchema`, the declarative replace request, and
  `akeneoProductProtectionsSchema` (connection flag, identity, protected set)
  are the catalogue editor surface. Additive.

- 9f7591b: Add Akeneo admin run list and detail envelopes.

  `akeneoImportRunListQuerySchema`, `akeneoImportRunListResponseSchema` and
  the expanded `akeneoImportRunDetailSchema` (counters plus `issuesTruncated`)
  are the source of truth for `GET /api/v1/admin/pim-akeneo/runs`. Additive.

- 142fcdd: `AssetReadPort` gains `openAssetBytes(assetId)`, and `assets_library` answers it.

  ```ts
  // new, on the existing `assetReadPort` container name
  openAssetBytes(assetId: string): Promise<AssetBytes | null>;

  // new exported type
  interface AssetBytes { bytes: Uint8Array; mimeType: string }
  ```

  The bytes of one live asset, buffered, with the MIME type they were stored under. It is the
  question a composition root was answering for `invoices` — embedding the operator's logo in
  an invoice PDF, which needs an inline `data:` URI because pdfmake resolves an `image:` by
  fetching it, and fetching `/assets/file/<id>` from the process that is serving the request
  deadlocks for a public asset and 403s for a private one.

  **Absence is the answer, not an exception**, exactly as `resolvePublicUrls` states it. An id
  that names no row, a soft-deleted one, a row on the `legacy` backend (a URL this library can
  resolve and an object it cannot open) and a configured store that would not stream are all
  `null`. The caller cannot tell "this asset is not there" from "the bucket did not answer",
  so it is not the caller's decision to make.

  **Here rather than on `AssetsLibraryPort`, and rather than left at the caller over
  `ObjectStoragePort`.** It is a read, and a consumer that wants a logo must not thereby
  acquire `upload`, `patchAsset` and `softDelete` — which is the argument `ObjectStoragePort`'s
  own doc block makes in the other direction. A caller that opened the store itself would carry
  three facts about this module's storage layout instead: that `legacy` has no `open`, that the
  locator falls back to `storageUrl` when the column is empty, and that the stream has to be
  drained.

  `Uint8Array` and not `Buffer`, for the reason `AssetByteStream` gives: this package is
  compiled by `@endora-commerce/admin-kit` with `types: ["vite/client"]`, so the `Buffer` global
  is not in scope. `Buffer` satisfies the shape, so a Node caller passes one through unchanged.

  **`minor` rather than `major`**, on this interface's own precedent: `resolvePublicUrls` was
  added to it three days ago as a minor, and the reasoning holds here — the port's consumers are
  callers, and its one implementer is the package that ships it, in the same release.

- 4eeb5cd: `cms` publishes `CmsBlockReadPort`, and `megamenu` resolves its own cross-module targets.

  **New on `@endora-commerce/contracts`:** `CmsBlockReadPort`, `CmsBlockRecord` and
  `CmsLocalizedBlockRecord`. Two methods, which is the whole of the demand.
  `findById(id)` answers _does this block exist_ and carries `active` on the record
  rather than filtering on it, because the two callers disagree about a deactivated
  block on purpose. `findLocalizedById(id, language)` answers _what does it render as
  here_ and is the reason the port exists: the per-language envelope —
  `content.languages[<code>]`, a legacy `schema_version` riding along, an absent key
  meaning "nothing authored" — is `cms`' storage layout, and a consumer that had to
  know it would be reading the column with extra steps. `null` covers all three
  absences, because a caller inlining a block has the same thing to do in each.

  **New on `@endora-commerce/mod-cms`:** the port is registered as `cmsBlockReadPort`
  with `ctx.di.providePort`, so it fails closed with 503 `MODULE_DISABLED` when an
  operator switches the CMS off. Nothing else changed in this package.

  **Removed from `@endora-commerce/mod-megamenu/backend`: `TargetValidatorDeps` and
  `StorefrontDeps`.** Both existed so a composition root could write eight closures
  against them — `select 1 from categories | cms_pages | cms_blocks | assets`, plus
  the storefront URL shapes — and this module's own barrel argued they had to stay in
  a root until one of the three owners grew an existence-check port. All three have:
  `catalogCategoryReadPort`, `cmsPageReadPort` and `assetReadPort` came out of feature
  075, and `cmsBlockReadPort` above is the one that was still missing. The module now
  resolves those four plus `assetsLibraryPort` with `lazyPort` and declares the edges
  in its manifest, where `catalog` joins `cms`, `assets_library`, `languages`,
  `sales_channels`, `auth` and `dictionaries`.

  **If you contributed `megamenuValidatorDeps` or `megamenuStorefrontDeps`**, delete
  both contributions: the container names are read by nobody and registering them now
  does nothing. There is no replacement to write, and the interfaces are deleted
  rather than relocated — what replaces them is module-private and holds no closure.
  Make sure the composition registers the five ports, which it does by composing
  `catalog`, `cms` and `assets_library`.

  Two behaviours were divergent between the reference deployment and the test harness
  and are now single-valued, both settling on the deployment's answer: a category
  target resolves to `/c/<slug>` (the harness built `/catalog/<slug>`, which the
  reference storefront serves from nowhere), and a deactivated or soft-deleted
  category drops its menu item and its children (the harness narrowed on neither).
  A CMS page target is deliberately _not_ narrowed on status or `active`, which is
  what both roots did.

- 9eb0cb6: `ModuleDemoManifest` gains an optional `package` field — the demo-data escape hatch of
  `specs/113-module-owned-demo-data/contracts/module-demo-data-layer.md` §6.

  It is a package **name as a string** and must never be written as an `import` specifier
  anywhere in the module's sources. That is measured rather than stylistic: a module
  package's `package.json` is generated, and `peerNamesOf` records every specifier
  `namedSpecifiers` yields with **no filter on kind** — a walk that recognises
  `dynamic-import` — so a literal `await import('@endora-commerce/mod-<id>-demo')` becomes a
  _required_ peer and pnpm installs the demo package for every client, which is the opposite
  of what the field is for.

  ```diff
   const demo: ModuleDemoManifest<ModuleContext> = {
     summary: 'A demo catalogue of 200 products.',
  +  package: '@endora-commerce/mod-catalog-demo',
     seed: async (context) => (await import('./backend/demo/seed.js')).seedDemo(context),
     reset: async (context) => (await import('./backend/demo/reset.js')).resetDemo(context),
   };
  ```

  **The runner half is not built yet.** `@endora-commerce/platform`'s demo runner does not
  resolve the name — §6.3's three answers (loads / not installed / fails to load) and §6.4's
  probe-before-import are a separate change — so declaring it today records an intent and
  changes no behaviour. Do not take the hatch until the runner answers all three ways.

- ca43192: `EnvironmentInput` gains a required `addressOf`, and the CLI stops guessing which of a
  storefront's variables names a backend from the shape of the value.

  **Why.** Two programs ask _"which of these variables names the backend"_ — `endora new
storefront`, whose next step tells an author to point them at theirs, and that command's
  acceptance criterion, which does the pointing. Both answered it by reading
  `storefront/.env.example` for a value that looked like an absolute `http(s)` URL. That is
  right only while such a file declares no address but the backend's, and the reference
  storefront now declares its **own** public origin (`NEXT_PUBLIC_SITE_URL`) there — so the
  old predicate would have told a client, in a file they own outright and nobody revisits,
  that the shop's canonical origin "names the backend this storefront talks to".

  `addressOf` is a declaration of what a value **is**: which member of the instance it is
  the address of, or `null` where it is the address of none.

  **If you ship a declaration** — an application's `environment-inputs.mjs`, or the
  platform's — every entry needs the field. It is required rather than optional on purpose:
  an optional one is forgotten exactly once, by whoever adds the next address, in silence.
  Zod refuses a declaration without it at `loadTreeDeclaration`, so the failure is a
  sentence naming the entry rather than a variable that quietly stops being configured.

  ```diff
   {
     name: 'NEXT_PUBLIC_API_BASE_URL',
     requirement: { kind: 'required' },
     secret: false,
     generable: false,
     owner: { kind: 'application', application: 'storefront' },
     consumers: ['storefront'],
  +  addressOf: 'backend',
   },
  ```

  `null` is an answer and not an absence. A third party's address is `null` —
  `DATABASE_URL` and `REDIS_URL` are addresses, of a database and a cache, and neither is a
  member of the instance — and so is a value naming _several_ origins, `CORS_ALLOWED_ORIGINS`
  being the worked example: "the address of" is singular.

  **`@endora-commerce/contracts`** adds `addressVariablesFor(inputs, member)`, the one
  derivation both consumers take.

  **`@endora-commerce/cli`** replaces `backendAddressVariables(envExampleText)` with
  `addressVariables(declared, member)`, over a loaded declaration rather than over
  `.env.example` text. `backendAddressVariablesOf(dir)` keeps its name and its meaning and
  is now **async**, because it loads that directory's own declaration; there is a
  `storefrontAddressVariablesOf(dir)` beside it. `envExampleDeclarations` and
  `envExampleDeclarationsOf` are unchanged — the file is still the storefront's worked
  example of its _values_.

  ```diff
  -const names = backendAddressVariables(readFileSync('.env.example', 'utf8'));
  -const names = backendAddressVariablesOf(storefrontDir);
  +const names = await backendAddressVariablesOf(storefrontDir);
  ```

  `STOREFRONT_DOMAIN` also becomes a per-instance build input in
  `@endora-commerce/cli/lib/instance-build-inputs.js`, supplying the storefront build's
  `NEXT_PUBLIC_SITE_URL`. A pipeline rendered from that declaration gains one
  `--build-arg`; one that does not pass it builds a storefront whose canonicals, sitemap and
  `robots.txt` name `http://localhost:3000`.

  **`@endora-commerce/platform`** only annotates its own twenty-one declared inputs; no
  exported behaviour changes.

- fd7db00: Added the environment-input declaration, and the four-tier input resolution every
  scaffolding command now shares.

  **`@endora-commerce/contracts`** publishes the shape:
  `EnvironmentInput`, `EnvironmentInputSchema`, `EnvironmentInputsSchema`,
  `EnvironmentConsumer` / `ENVIRONMENT_CONSUMERS`, `EnvironmentRequirement`,
  `EnvironmentInputOwner`, `LocalizedSentence`, and three predicates —
  `isReadByAnyOf`, `scopeToMembers` and `isRequiredGiven`. One entry per environment
  variable a running platform reads: what it configures, in both shipped languages;
  whether it is `required`, `requiredWhen` another input holds a value, or `optional`
  with a sentence saying **what is lost**; whether it is a secret; whether a command
  may generate it; who owns it; and which trees read it.

  There is deliberately **no `default` field**. A declaration that could carry one
  would become another home for an invented value, which is what the provenance line
  below exists to make impossible.

  **`@endora-commerce/platform`** declares the 21 inputs the host and the platform
  read, on a new `./env` subpath:

  ```ts
  import { PLATFORM_ENVIRONMENT_INPUTS } from '@endora-commerce/platform/env';
  ```

  The subpath is host-internal — declared, resolvable by a CLI and by the host, and
  nameable by no module. A module declares its **own** inputs in its manifest, and the
  shape it does so in is `@endora-commerce/contracts`'.

  **`@endora-commerce/cli`** resolves those inputs, in one fixed order that is not
  configurable: an explicit `--<input>` flag, then a `.env` already placed in the
  target directory, then an interactive prompt, then a refusal. `endora new
storefront` takes it first, and writes the answers into the copy's own `.env`.

  Three properties are contract rather than behaviour:
  - **the tool invents no value.** Every run prints one provenance line —
    `[inputs] resolved: total=5 flags=5 env-file=0 prompted=0 generated=0 defaulted=0`
    — whose `defaulted` count is the _residue_ of the four tiers rather than a counter
    nothing increments, so a value from outside them shows up in the arithmetic
    instead of disappearing;
  - **no command blocks on a question nobody can answer.** A prompt is issued only
    when stdin and stdout are both TTYs, `--non-interactive` and `--dry-run` are
    absent and no CI marker is set. Otherwise a missing required input is exit `1`
    naming **every** missing input and the flag that supplies each, in one refusal;
  - **the one class of value a command may generate is a cryptographic secret** whose
    declaration marks it `generable` — written into the target's `.env` where the
    operator can read it, named in the provenance line, and printed nowhere.

  **If you call `runNewStorefront` directly**, it now resolves inputs and will refuse
  a run that has none and cannot ask:

  ```diff
  -await runNewStorefront({ dir: target, cwd });
  +await runNewStorefront({
  +  dir: target,
  +  cwd,
  +  inputs: { NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com', /* … */ },
  +});
  ```

  `MissingInputsError` is the refusal; `DeclarationLoadError` is a tree whose
  declaration could not be read, which is exit `2` rather than `1`. A target
  directory holding nothing but a `.env` is now accepted, which is what makes the
  second tier reachable for that command.

- e83be80: Added the `ledger.section.tabs` admin zone so invoice-ledger deliveries, routing, and vendor adapter connection screens share one Sales row.

  `@endora-commerce/contracts` gains the enum member and empty `LedgerSectionTabsZoneProps`. `invoice_ledger` contributes Deliveries and Routing and keeps a single sidebar entry. `infakt` drops its sidebar row and contributes the Infakt tab, hidden when the adapter is off.

- db1ec0b: A module can declare its demo data in `manifest.ts`, and the platform can run it.

  **`@endora-commerce/contracts`** gains one optional field on `ModuleManifest`,
  `demo`, plus `ModuleDemoManifest`, `ModuleDemoContext`, `DemoSeedResult`,
  `DemoResetResult`, `DemoEntityCount`, `DemoCredential`,
  `ModuleDemoManifestSchema` and `ModuleDemoDeclarationSchema`. Three states, and
  they are `docs`': an object — this module ships demo rows for its own tables;
  `false` — it has nothing to demonstrate, deliberately; **absent** — nobody has
  decided. Write the body behind a relative `await import()`, in `cliCommands`'
  shape, so a manifest every composing process loads does not pull a service graph
  with it:

  ```ts
  const demo: ModuleDemoManifest<ModuleContext> = {
    summary: 'A demo warehouse and stock for the seeded products.',
    seed: async (context) => (await import('./backend/demo/seed.js')).seedDemo(context),
    reset: async (context) => (await import('./backend/demo/reset.js')).resetDemo(context),
  };
  ```

  `defineModuleManifest` refuses a malformed one, and the two `demo.after` entries
  that cannot mean anything: the declaring module itself, and the same id twice.
  `after` is **advisory** — `permissions[].requires`' shape under D-175. It puts no
  module in `dependencies`, creates no lifecycle edge and changes no migration
  order, which is what lets `megamenu`'s demo order itself after `catalog`'s
  without declaring a dependency it does not have.

  **`@endora-commerce/platform`** gains `src/demo/` — the production guard
  (relocated from `backend/src/seeds/dev-seed-guard.ts`, which is now a re-export
  shim), the scope reasons, the plan, the runner and the report. It is reached by
  the host CLI and by nothing else; it is deliberately **not** on the
  `./composition` subpath, whose 27 symbols are D-160.14's ruled set.
  `sortComponentsTopologically` and `orderModulesByDependencies` join
  `stronglyConnectedComponents` on `lifecycle/services/dep-graph.ts`, so the demo
  order and the migration order are one walk rather than two that can disagree.

  Nothing else changes: no module declares demo data yet, `seed:dev` still runs,
  and no package gains a dependency.

- f7147b0: Removed the module licence tier: `ModuleLicenseTierSchema`, the `ModuleLicenseTier` type, the
  optional `license` field on a module manifest, and the required `license` field on
  `ModuleListItem`.

  It was reserved for edition-gating and was read by nothing. D-194 removed the tier
  meta-packages it existed for, and the field survived them: no gate consulted it, no route
  branched on it, the `/platform/modules` screen never rendered it, and `module:status` never
  printed a column for it. The only two references outside its own declaration were the
  orchestrator lines copying it from the manifest onto the list item — a value carried the
  length of the system so that nobody could look at it.

  **If you declared it in a manifest**, delete the line. A Zod object is non-strict, so a
  manifest that still declares one is not refused; the key is dropped on parse. There is no
  replacement, and there is no entitlement axis to move it to — the manifest's one presence
  declaration is `activation`, which is the operator's runtime control and was always a
  different question (Constitution XVII).

  ```diff
   export const manifest = defineModuleManifest({
     id: 'my_module',
     name: 'My Module',
     version: '1.0.0',
     dependencies: [],
  -  license: 'pro',
     activation: { settingCode: 'my_module.enabled', default: true },
   });
  ```

  **If you read `ModuleListItem.license`**, the field is gone from
  `GET /api/v1/admin/modules` and from `ModuleLifecycleOrchestrator.status()`. Nothing
  replaces it. A consumer that rendered it was rendering `null` for every module in this
  repository, no manifest having ever declared a tier.

  ```diff
  -import type { ModuleLicenseTier } from '@endora-commerce/contracts';
  -const tier: ModuleLicenseTier | null = item.license;
  ```

- 72013ed: Published `OrganizationTaxProfilePort`, and moved the error envelope's assembly into the
  platform.

  **`@endora-commerce/contracts` gains `OrganizationTaxProfilePort`.** It described the
  `organizationTaxProfilePort` container name and was declared by
  `@endora-commerce/mod-organizations/backend`, so a consumer resolving that port had to name
  the provider's own package to spell the type — which is the reach a port exists to remove,
  and which `@endora-commerce/platform` may not write at all. The declaration is unchanged
  member for member.

  ```diff
  -import type { OrganizationTaxProfilePort } from '@endora-commerce/mod-organizations/backend';
  +import type { OrganizationTaxProfilePort } from '@endora-commerce/contracts';

   const taxProfile = lazyPort<OrganizationTaxProfilePort>(ctx, 'organizationTaxProfilePort');
  ```

  **`@endora-commerce/mod-organizations/backend` no longer exports it**, and that is the
  breaking half. A re-export was written and withdrawn: a barrel re-exporting a name whose
  source is another package makes _"does this barrel carry an entity class by name"_ unknown
  rather than false, which D-168 may not be wrong about, and two spellings for one type is the
  shape this repository removes rather than adds. Change the specifier; the type is
  unchanged.

  **`@endora-commerce/platform/composition` gains `composeErrorEnvelopeOptions` and loses
  `createRequestLanguageResolver`.** The two callbacks a composition root passes to
  `registerErrorEnvelope` — the language ladder and the translation lookup — were assembled
  by each root itself, identically, in twenty lines apiece. They are one function now, and
  what a root supplies is only what a root knows: its own resolved error-code routing table
  and the two container names the callbacks read.

  ```diff
  -errorEnvelope: {
  -  errorTranslationTargets: routing.targets,
  -  resolvePreferredLanguage: createRequestLanguageResolver({
  -    adminPreferredLanguage: async (id) =>
  -      (await adminUserReadPort().findById(id))?.preferredLanguage ?? null,
  -  }),
  -  translateErrorMessage: async ({ moduleId, key, language, originalMessage, params }) => {
  -    const t = await i18n().translate(moduleId, key, language, params);
  -    return t === `${moduleId}.${key}` ? originalMessage : t;
  -  },
  -},
  +errorEnvelope: composeErrorEnvelopeOptions({
  +  errorTranslationTargets: routing.targets,
  +  adminUserReadPort: () => identityPorts().adminUserReadPort,
  +  translate: () => cradle().adminI18nService,
  +}),
  ```

  `createRequestLanguageResolver` is off the barrel because no composition root constructs it
  any more; the ladder it builds is unchanged and is now built inside the assembly. If you
  called it directly, call `composeErrorEnvelopeOptions` instead. Both are on `./composition`,
  which is host-internal — no module may name it — so this affects a host and never a module.

- 5ba2e97: `request.actor` is declared by the platform, and `Actor` no longer carries the session.

  **`@endora-commerce/mod-auth` — breaking, two ways.**

  `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey` are no
  longer exported from `@endora-commerce/mod-auth/backend`. Import them from
  `@endora-commerce/contracts` instead:

  ```ts
  // before
  import type { Actor, ActorAdmin } from '@endora-commerce/mod-auth/backend';

  // after
  import type { Actor, ActorAdmin } from '@endora-commerce/contracts';
  ```

  And the `declare module 'fastify'` block that adds `actor` and `adminActor` to
  `FastifyRequest` is no longer in this package. If you imported from
  `@endora-commerce/mod-auth/backend` only to make `request.actor` compile — a
  type-only import whose real job was to put the ambient declaration in your
  program — the import to write now is a normal one you probably already have:

  ```ts
  // before — erased at build time, and load-bearing anyway
  import type { Actor } from '@endora-commerce/mod-auth/backend';

  // after — any import from this subpath carries the declaration
  import { HttpError } from '@endora-commerce/platform/http';
  ```

  **`ActorCustomer.session` and `ActorAdmin.session` are gone.** They were the
  `Session` ORM entity, written onto every authenticated request. If you read one,
  resolve `authSessionPort` or `authSessionReadPort` from the container: both are
  declared in `@endora-commerce/contracts` and both answer with `AuthSessionRecord`,
  a plain shape rather than an entity. Nothing else about the actor changed — the
  same four kinds, the same fields, resolved by the same `onRequest` hook.

  **`@endora-commerce/contracts`** gains `Actor` and its four members, at
  `./actor.js` and on the root barrel. It imports neither Fastify nor the ORM.

  **`@endora-commerce/platform`** gains the Fastify augmentation on its existing
  `./http` subpath — no new subpath and no new export, because the file declares
  the two request properties and exports no symbol. Any import from
  `@endora-commerce/platform/http` brings it.

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

- 089d2d4: Expose `remoteDocumentId` on the invoice-ledger delivery list item so invoice admin can show a historical vendor document id from a ledger read after the vendor adapter is switched off.

## 0.7.0

### Major Changes

- 0a08996: Removed `CustomerTotpEnrolmentPort` and `CustomerTotpEnrolmentResult`.

  The `totpEnrolmentService` port they described has no provider any more:
  `customer_accounts` no longer registers it, and the three routes that resolved it —
  `POST /api/v1/me/two-factor/{enable,confirm,disable}` — are gone. They could never
  succeed. `enable` wrote a 682-character `secret|<10 sha256 hashes>` string into
  `customer_accounts.two_factor_secret`, a `varchar(64)`, on which PostgreSQL raises
  `22001` rather than truncating, so the route answered 500 for every customer from the day
  it was written; `confirm` and `disable` refused with 400 and 409 for the same reason, an
  enrolment never being storable.

  **If you named either type**, there is no replacement port and no replacement HTTP path.
  Customer two-factor authentication is the `mfa` module's, over `/api/v1/account/mfa/*` —
  setup, confirm, disable, status and recovery codes — with the secret encrypted at rest,
  a replay guard and single-use recovery-code rows.

  ```diff
  -import type { CustomerTotpEnrolmentPort } from '@endora-commerce/contracts';
  -const totp = lazyPort<CustomerTotpEnrolmentPort>(ctx, 'totpEnrolmentService');
  -await totp.enable(customerAccountId);
  +// No port. Direct the caller at the `mfa` module's own self-service routes:
  +// POST /api/v1/account/mfa/setup, /confirm, /disable.
  ```

  `customer_accounts.two_factor_secret` and `admin_users.two_factor_secret` are dropped with
  them. `two_factor_confirmed_at` stays on both tables, so `CustomerAccountRecord`,
  `AdminUserRecord` and every response carrying `twoFactorEnabled` are unchanged.

- cebad9c: Admin zones are usable: a props contract at both ends, `match`, and a `./zones` renderer.

  **Breaking, `@endora-commerce/contracts`.** `AdminZoneNameSchema` no longer carries
  `order.detail.tabs`, `delivery_method.row.actions`, `payment_method.row.actions` or
  `product.editor.sidebar.after`. All four were rendered by no host and contributed to by
  no module — measured — and the new `check:admin-zones` reports a member nothing renders
  as `unrendered-zone` with no ledger to record it in. The three members that replace them
  are the three places a host actually mounts:

  ```diff
  -AdminZoneNameSchema.parse('product.editor.sidebar.after')
  +AdminZoneNameSchema.parse('product.editor.details.before')
  +AdminZoneNameSchema.parse('product.editor.pricing.before')
  +AdminZoneNameSchema.parse('product.editor.field.after')
  ```

  **If you named one of the four removed members**, there is no drop-in replacement: a zone
  name is a place, and each of the four described a place that either does not exist
  (`product.editor.sidebar.after` — the product editor has no right-hand sidebar) or has no
  mount yet. The batch that renders your place adds the member with the mount, in one merge
  request; that is the rule the removals establish.

  New in `@endora-commerce/contracts`:
  - `AdminZonePropsMap`, `AdminZoneProps<Z>` and the props interfaces
    `ProductEditorZoneProps` / `ProductEditorFieldZoneProps`. The map is declared as
    `Record<AdminZoneName, object>`, so a zone member without a props type is a compile
    error in the package itself.
  - `match` on `AdminZoneContributionSchema` —
    `Record<string, string | readonly string[]>`, optional. The renderer includes a
    contribution when every key agrees with the mount's props, and it decides that
    **before** `React.lazy`, so a contributor that serves two of a zone's mounts is not
    downloaded on the rest.

  New in `@endora-commerce/admin-kit`:
  - A `./zones` subpath — `AdminContributionsProvider`, `useAdminZone(name, props)`,
    `<AdminZone name props />`, `ZoneErrorBoundary`, and the pure
    `selectZoneContributions` / `matchesZoneProps`. Presence, permission and `match` are
    filtered at enumeration, so an operator's activation flip needs no rebuild; each
    contribution gets its own error boundary and `Suspense`.
  - `zoneComponent(zone, load, options?)` and `AdminZoneComponent<Z>` on
    `./contributions` — the contributor's end of the props map, which is what constrains a
    module's default export to the zone it names.

  ```ts
  // host
  <AdminZone name="product.editor.field.after"
             props={{ productId, fieldPath: 'name', languageCodes: LOCALES }} />

  // contributor, in src/admin/index.ts
  zoneComponent('product.editor.field.after', () => import('./FieldProtection.js'), {
    weight: 10,
    requiredPermission: 'catalog:write',
  })
  ```

  `./zones` is a separate subpath from `./contributions` on purpose: the second is
  data-only and is what a module's declaration file imports, and one subpath would let a
  declaration file import a component.

- 4ed4b84: `cms-pages.ts` is removed. The barrel no longer exports `cmsPageSchema`, `CmsPage`,
  `cmsPagePathSchema`, `upsertCmsPageRequestSchema`, `UpsertCmsPageRequest` or
  `updateCmsPageRequestSchema`.

  **What those shapes were.** The pre-014 CMS page projection: a page addressed by a single
  globally unique `path`, with `title` and `body` as multilingual string maps. Feature 014
  replaced it with the page-builder page — addressed by a **per-channel** slug, with its content
  in a page-builder tree — and left the old shapes in place with one consumer each.

  **Why they go now.** Neither consumer worked. The storefront's `getCmsPage` fetched
  `GET /api/v1/cms/pages/{path}`, an endpoint no commit in this repository has ever registered, so
  every URL it served resolved to a 404 the caller could not tell from an empty CMS; and the admin
  screen typed against `CmsPage` posted `{ path, title, body }` to a route that parses
  `createCmsPageRequestSchema`, which requires `name`, `slug`, `salesChannelIds` and `languages`.
  The columns behind the shapes are still written and are still `@deprecated`: `path` is
  `` `${slug}-${id.slice(0, 8)}` ``, `title` is a copy of `name` or `meta.title`, and `body` is `''`
  for every page in every language. So an endpoint faithful to the old shape would address pages by
  a URL no operator chose and return an empty document.

  **What to use instead.** `cmsPageSummarySchema` / `CmsPageSummary` and `cmsPageDetailSchema` /
  `CmsPageDetail` for the admin surface, `createCmsPageRequestSchema` and `patchCmsPageRequestSchema`
  to write one, and `cmsResolvedPageSchema` / `CmsResolvedPage` for the storefront — the last is what
  `GET /api/v1/cms/pages/by-slug` returns, with the language already resolved server-side and
  embedded blocks and templates inlined.

  **Two names survive the file and are not part of the break.** `cmsPageStatusSchema` and
  `CmsPageStatus` were declared in _both_ files, identically
  (`'draft' | 'published' | 'archived'`), and `cms-pages.js`' star export won the collision — which
  is why `cms.ts` is re-exported by name rather than with a star. `cms.ts`' pair is now named on
  that list, so both keep resolving, with the same shape, from the same barrel.

- 11fc9f3: Renamed from `@b2b/contracts` to `@endora-commerce/contracts`. Nothing else about the
  package changed — same exports, same schemas, same `dist` layout.

  Update the dependency and every specifier:

  ```diff
  -"@b2b/contracts": "workspace:*"
  +"@endora-commerce/contracts": "workspace:*"
  ```

  ```diff
  -import { productTypeSchema } from '@b2b/contracts';
  -import { cmsContentEnvelopeSchema } from '@b2b/contracts/cms';
  +import { productTypeSchema } from '@endora-commerce/contracts';
  +import { cmsContentEnvelopeSchema } from '@endora-commerce/contracts/cms';
  ```

  `@endora-commerce` is the commerce platform's own npm scope; `@endora` is reserved for
  the company's other packages.

- f66ce9b: `@endora-commerce/contracts` now ships compiled JavaScript and declarations. `main`, `types` and
  every `exports` subpath resolve under `./dist`; `files` is `["dist"]`.

  **What changes for you.** The package no longer hands you TypeScript. Before, resolving
  `@endora-commerce/contracts` gave you `src/index.ts` and you compiled it yourself — which is why a
  consumer needed `transpilePackages`, a `ts-node`/`tsx` loader, or a bundler plugin to use
  it at all. Now it gives you `dist/index.js` with `dist/index.d.ts` beside it, so remove
  that configuration. Nothing about the exported symbols moved: `productTypeSchema`,
  `PERMISSION_CATALOGUE` and every other export keeps its name, its shape and its
  `z.infer` type aliases, which are emitted as written rather than expanded.

  **One specifier stops resolving.** A subpath written with a `.js` extension —

  ```ts
  import type { CmsFieldDescriptor } from '@endora-commerce/contracts/cms.js'; // was: src/cms.ts
  ```

  — went through the old `"./*": "./src/*.ts"` map, where `tsc` substituted the extension.
  The new map is `"./*": "./dist/*.js"`, under which the same specifier asks for
  `dist/cms.js.js` and fails at **runtime only** — a type-check cannot see it. Drop the
  extension:

  ```ts
  import type { CmsFieldDescriptor } from '@endora-commerce/contracts/cms';
  ```

  Every extensionless subpath is unaffected.

  **Every subpath carries a `types` condition.** Without one a consumer on
  `moduleResolution: "Bundler"` falls back to `main` for types while resolving `dist` for
  the runtime — it compiles, it runs, and the two answers come from different files.

- 2f04481: `CustomerAccountRecord.organizationId` is `string` — never `null` (D-178).

  `customer_accounts.organization_id` is `NOT NULL` in the database, an individual
  customer is backed by a single-member personal Organization, and there is no
  "no-organization" scoping path. Every branch a consumer wrote for the absent case
  is dead:

  ```diff
  -const org = account.organizationId === null ? null : await orgs.findById(account.organizationId);
  +const org = await orgs.findById(account.organizationId);
  ```

  Take care with the _other_ `organizationId: string | null` fields — a cart's, a
  `ProductAudience`'s — which stay nullable and mean "an anonymous visitor with no
  account". Only the account's own tenant became total.

  Two port changes travel with it.

  `CustomerAccountLifecycleWritePort.setOrganization` no longer accepts `null`, and
  `detachToPersonalOrganization` is the operation the `null` used to express:

  ```diff
  -await accounts.setOrganization(customerAccountId, null, { actorAdminUserId });
  +const personal = await personalOrganizations.provisionPersonalOrganization(customerAccountId);
  +await accounts.detachToPersonalOrganization(customerAccountId, personal.id, { actorAdminUserId });
  ```

  It records the same audit verb (`customer_account.organization_unassigned`) and
  runs the same authority and org-administrator-depletion guards; what changes is
  that the customer ends up in their own tenant rather than in none.

  `PersonalOrganizationPort` gains `provisionPersonalOrganization(customerAccountId)`
  — the account's **own** personal Organization, whatever it currently belongs to,
  provisioned if it has never existed, and no membership written. It is not
  `ensureForCustomerAccount`, which answers with the account's _current_
  Organization when it has one and would hand a company member their company back.

- ee02c59: The per-deployment declaration is `divergence`, and it is an object (D-205).

  `ReducedDeploymentDeclarationSchema` and its `ReducedDeploymentDeclaration` type
  are gone. The entry survives as `OmittedModuleSchema` / `OmittedModule`,
  unchanged in substance — a `moduleId` and a 20–800 character `reason` — and it
  now sits inside `DeploymentDivergenceDeclarationSchema`, which is what a
  deployment's `backend/src/apps/<deployment>/divergence.ts` exports as
  `divergence`.

  Before:

  ```ts
  import type { ReducedDeploymentDeclaration } from '@endora-commerce/contracts';

  export const reducedDeployment: ReadonlyArray<ReducedDeploymentDeclaration> = [
    { moduleId: 'blog', reason: '…' },
  ];
  ```

  After:

  ```ts
  import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

  export const divergence: DeploymentDivergenceDeclaration = {
    omittedModules: [{ moduleId: 'blog', reason: '…' }],
    decorationOrder: {},
    reasons: {},
  };
  ```

  The file is renamed with the export, because _reduced_ encodes a direction two
  of the three new contents do not have: `decorationOrder` declares the wrapping
  order for a registration more than one of a deployment's overlay modules
  decorates, and `reasons` carries one sentence per divergence the platform
  derives, keyed by the derived entry's own key. Both parse today and are read by
  nothing yet — they are supplied and checked by later phases of
  `specs/107-override-report-and-ladder/`.

  Three details a consumer will meet:
  - Every field defaults to empty, so a declaration that leaves one out means
    "none of these" — the reading an absent file already gets.
  - The object is **strict**: a fourth field, or a misspelled one, is refused
    rather than stripped, because a stripped field reads as "this deployment
    declares nothing" for a file whose author wrote a declaration.
  - `@endora-commerce/platform`'s D-101 boot refusal is unchanged in behaviour and
    changed in wording: it names `divergence.ts` and the `omittedModules` inside
    it. `ReducedDeploymentError` keeps its name — all three of its findings are
    about a module set that is genuinely reduced.

- f2fa9ea: Removed `pimcoreInboundEventStatusSchema` and its inferred type
  `PimcoreInboundEventStatus`.

  They described the status column of `pimcore_inbound_events`, the id-only push inbox
  that `pim_pimcore`'s complete-record delivery migration retired: that table became
  `pimcore_delivered_records`, whose statuses are `PimcoreDeliveredRecordStatus` — a
  different set (`applying`, `applied`, `withdrawn`, `retired_legacy`, `superseded`) with
  only `pending`, `failed` and `duplicate` in common. The schema had no reader left
  anywhere in this repository, in either its value or its type spelling:

  ```
  grep -rn --exclude-dir=node_modules --exclude-dir=dist \
    'pimcoreInboundEventStatusSchema\|PimcoreInboundEventStatus' .
  ```

  returned the two declarations and nothing else.

  There is no drop-in replacement to point at: the successor vocabulary is
  `PimcoreDeliveredRecordStatus`, declared beside the `PimcoreDeliveredRecord` entity in
  `@endora-commerce/mod-pim-pimcore` and published on none of that package's subpaths
  today, and its members are not interchangeable with these — re-map rather than
  re-point. Its neighbour `pimcoreInboundEventTypeSchema` is unaffected and still
  published: that one is the _action_ vocabulary and is still read here.

- 30a5475: Cut the unreachable half of the Pimcore run-outcome vocabulary.

  **Removed from `@endora-commerce/contracts`**, all breaking by removal and none of
  them consumed by anything in this repository:
  - `pimcoreImportFailureCodeSchema` loses `delivery_protocol_error`, `apply_failed`
    and `other_pim_enabled`; it is now `['worker_lost', 'internal_error',
'superseded']`. `PimcoreImportFailureCode` narrows with it.
  - `pimcoreImportSkipReasonSchema` and `PimcoreImportSkipReason` are gone
    entirely.
  - `pimcoreImportRunSchema` (and therefore `PimcoreImportRunDto` and
    `PimcoreImportRunDetailDto`) loses its `skipReason` field.

  Nothing wrote any of them. Each removed failure code was structurally unreachable
  rather than merely unimplemented: a delivery protocol fault is refused to the
  sender as an HTTP status before the Command that would create a run commits, so
  there is no run to stamp; an apply fault is isolated to its record and rolls the
  run up as `completed_with_issues` with no failure code at all (FR-105, FR-108),
  so a run-wide `apply_failed` contradicted the requirement above it; and
  `other_pim_enabled` is a skip reason, which by its own definition means the run
  never started and therefore cannot also be why a started run stopped. The skip
  reasons are the pull-era refusal path retired with FR-005, FR-007 and FR-008 —
  `PimcoreImportRun.skipReason` was written nowhere and `run.status` was never
  `'skipped'`.

  `'skipped'` **stays** in `pimcoreImportRunStatusSchema`: it costs nothing and is
  the natural status if a skip path is ever added. `internal_error` stays too — it
  is the notifier's defensive default over a nullable column, which is the one
  member of the three with a live reader.

  **A consumer reading a run DTO needs no change**: a narrowed response union is
  the safe direction, and the removed members were never emitted. A consumer that
  _wrote_ one of these codes into a `PimcoreImportFailureCode`-typed value has no
  replacement and should not have compiled — no such consumer exists.

  `@endora-commerce/mod-pim-pimcore` drops `PimcoreImportRun.skipReason`, the run
  DTO field, the two admin screens' skip-reason rendering and the nine now-dead
  `runs.failureCode.*` / `runs.skipReason.*` labels in both shipped languages. The
  `skip_reason` column is left on `pimcore_import_runs`, unwritten; no migration.

  See `specs/092-pimcore-pim-sync/research.md` §18.3 and `data-model.md` §7.

- aab5273: **Removed: the storefront theme catalogue.** `STOREFRONT_THEME_CODES`,
  `StorefrontThemeCodeSchema`, `StorefrontThemeCode`, `DEFAULT_STOREFRONT_THEME_CODE`
  and `isStorefrontThemeCode` no longer exist. Nothing on the wire changed:
  `PublicSalesChannelSchema.themeCode` is the same `z.string().nullable()`, and the
  create/update schemas still validate `^[a-z][a-z0-9_-]*$` — they never used the
  enum.

  **Why.** A storefront theme is a token set, and a token set can be published by
  anyone: an ordinary npm package with a CSS file and an `endora: { themes: [...] }`
  block. No set this package can compile is the whole set, so the list here was
  always the list of _our_ themes wearing the platform's name. The question moved
  from "is this one of our themes" to "does this storefront have this theme", and
  only a storefront instance can answer it — from the theme packages it has
  installed and the token blocks its own stylesheet declares.

  **What to do instead, per symbol.**
  - `isStorefrontThemeCode` — ask _your_ storefront, not this package. The
    reference instance generates a registry at build time and asks that:
    `storefront/lib/theme/instance-themes.ts`, over
    `storefront/lib/theme/themes.generated.ts`. Copy that shape; do not
    reintroduce a hand-written list, and in particular **do not** substitute an
    open predicate over the code regex — that makes every well-formed string a
    known theme, which deletes the unknown-code fallback and renders a typo'd
    channel unbranded.
  - `DEFAULT_STOREFRONT_THEME_CODE` — an instance constant now. It is your
    storefront's choice, not the platform's, and it must be a member of your own
    registry.
  - `StorefrontThemeCode` — `string`. The closed union is unrecoverable: no
    compiler can close a set a stranger extends after the compile. Replace the
    import with `string`, and replace the guarantee with a build check over your
    **emitted** stylesheet (`storefront/scripts/check-themes.mjs` is the reference
    one).
  - `StorefrontThemeCodeSchema` — no replacement. Validate the shape, which is
    what the sales-channel write schemas in this package already do; do not
    validate membership server-side, or the field stops working for exactly the
    deployments it exists for.
  - `STOREFRONT_THEME_CODES` — no replacement. An admin surface should render a
    free-text control: it is in a different deployment from the storefront, so any
    list it shows is advisory, and the storefront already answers a wrong value
    correctly.

  Background: `specs/102-storefront-theme-discovery/`, owner ruling D-199.
  `contracts/theme-package.md` is what a theme author reads.

### Minor Changes

- 73d0887: Publish `MfaEnrolmentStatePort`, and make `twoFactorEnabled` the live enrolment.

  `activeSubjectIds(subjectType: MfaSubjectType, subjectIds: readonly string[]):
Promise<string[]>` answers which of the given subjects hold an active second
  factor, on the `mfaEnrolmentStatePort` container. Batched rather than per row,
  because every caller is a list surface; the answer is plain ids, because
  `MfaEnrolment` carries the encrypted TOTP secret and no consumer has business
  holding it.

  New surface on `mfa` — nothing is removed there. A consumer resolves it with
  `lazyPort<MfaEnrolmentStatePort>(ctx, 'mfaEnrolmentStatePort')` and declares the
  edge; both consumers in this repository declare it `degrades-without`, because
  `mfa` is deactivatable and a locked consumer binding it would make the operator's
  MFA switch a dead one.

  **Two mappers gained a required parameter, and that is a breaking change to a
  call, not to a wire shape.** `toAdminUserRecord(admin, twoFactorEnabled)` and
  `toCustomerAccountRecord(account, twoFactorEnabled)` no longer derive the field
  themselves; each package also exports a batching helper
  (`toAdminUserRecords` / `toCustomerAccountRecords`, plus
  `toOneCustomerAccountRecord`) that takes the reader and does one `mfa` read per
  response. The parameter has no default deliberately: it replaces a derivation
  that was silently wrong, and a default would let the next call site reintroduce
  it. Two service constructors take the reader as a new argument —
  `CustomerAccountReadService(emFactory, twoFactorEnrolments)` and
  `AdminUserReadService(emFactory, twoFactorEnrolments)`, with the same addition on
  `CustomerAccountMemberWriteService`, `CustomerAccountLifecycleWriteService` and
  `CustomerAccountAdminSearchService`.

  `twoFactorEnabled: boolean` is unchanged on every response and on both published
  records; what changed is where the value comes from. It was
  `Boolean(x.twoFactorConfirmedAt)` — a column with no writer on either identity
  table, whose last non-null writer was the superseded customer TOTP path deleted
  on 2026-08-25 — so the field was a provably constant `false`. `/admin-users`
  reported no second factor for an administrator who had enrolled an hour earlier,
  and `GET /api/v1/me/customer` told a buyer their own account was unprotected
  while it was not.

  `two_factor_confirmed_at` is now read by nothing on either table. Dropping the
  two columns is a separate migration and is not in this change.

- 93a300c: Publish the admin contribution declarations, and the package a module's admin
  layer is written against.

  **`@endora-commerce/contracts`** gains `admin-contributions.ts`, re-exported
  from the barrel. It is additive and breaks nothing:
  - `AdminRouteDeclarationSchema`, `AdminNavDeclarationSchema` and
    `AdminZoneContributionSchema` — the data half of what a module package's
    `./admin` layer exports, so a generator, a check or a server can enumerate a
    contribution without evaluating any of the module's UI code.
  - `AdminNavSectionNameSchema` — the closed set of sidebar sections a module may
    join, derived from the twelve `admin/src/components/AppShell.tsx` already
    declares. A module may not invent a section: an invented section is a heading
    nobody else can join.
  - `AdminZoneNameSchema` — the closed, hierarchical set of places in one
    module's screen where another module's contribution may appear. The four
    opening members are exactly the places measured module additions reached into
    by editing another module's file.
  - `PermissionRequirementSchema` — a permission code, or a set any one of which
    suffices; the shape `admin/src/lib/surface-visibility.ts` already defines,
    published so a module package declares it without reaching into the admin for
    the type.
  - `AdminContributions`, `AdminRouteDeclaration`, `AdminZoneContribution` and
    `AdminComponentFactory` — the interfaces that carry the dynamic-import
    factory, which is the only function-valued field a contribution has. It is a
    TypeScript type rather than a Zod schema deliberately: a function value
    carries nothing to validate beyond its arity, and a `z.function()` here would
    tell a reader it had been checked.

  **`@endora-commerce/admin-kit`** is new, private, and publishes one subpath:

  ```ts
  import {
    AdminNavSectionNameSchema,
    type AdminContributions,
  } from '@endora-commerce/admin-kit/contributions';
  ```

  Every export is the identical binding rather than a copy —
  `@endora-commerce/contracts` is a peer dependency, so a consumer resolves one
  copy and a schema compared across the seam is the same object.

  The four design-system subpaths the feature derives (`./ui`, `./components`,
  `./lib`, `./i18n`) are **not** in this release. The package's README records the
  measurement: a `tsc`-emitted façade re-exporting `admin/src` is TS6059 —
  verified on a two-file probe — and dropping `rootDir` to make it compile emits a
  second copy of every component into the kit's `dist`, which is a duplicated
  module-scope value in a tree full of React context. Publishing them takes the
  shape feature 080 used for the platform relocation: the implementations move
  into the package and `admin/src` keeps re-export shims at their old paths.

- b2552d5: Published the three data-fetching pickers, and the Organization picker's row shape.

  `@endora-commerce/admin-kit/components` gains `SalesChannelPicker`, `CmsBlockPicker`,
  `CmsPagePicker`, `OrganizationPicker`, `OrganizationPickerMulti`,
  `OrganizationStatusBadge` and `useOrganizationsQuery`. Each of them was previously
  unreachable from a package: it lived in the admin application and imported another
  module's admin API client, so publishing it would have put module code in the kit.

  **A kit component gets its data by building the request itself**, from the published
  `apiClient` and the owner's schema in `@endora-commerce/contracts`. Five kit components
  already did that before this release (`CustomerPicker`, `AdminUserPicker`,
  `CustomerGroupPicker`, `CategorySelect`, `useCountriesQuery`); the rule was simply never
  written down. An HTTP path plus a schema out of a package the kit already depends on is
  not module knowledge — a module's _code_ is, and that is what these seven files no longer
  name.

  **If you render one of these,** nothing changes: every prop is the same, and
  `admin/src` keeps a re-export shim at each old path. **If you test one,** the seam moved:
  mock `@endora-commerce/admin-kit/lib`'s `apiClient`, not the module client.

  ```diff
  -vi.mock('@/modules/organizations/api/organizations-picker-client', () => ({
  -  organizationsPickerClient: { list: listSpy },
  -}));
  +vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  +  ...(await vi.importActual('@endora-commerce/admin-kit/lib')),
  +  apiClient: { get: getSpy, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  +}));
  ```

  `@endora-commerce/contracts` gains `organizationPickerListItemSchema` /
  `OrganizationPickerListItem` and `organizationPickerPageSchema` /
  `OrganizationPickerPage` — the picker's projection over
  `GET /api/v1/admin/organizations`, which now crosses a package boundary and so belongs
  here under Principle II. **There is no `OrganizationStatusPickerFilter`**: its four
  members are exactly `organizationStatusSchema`'s, measured, so the picker takes the
  published `OrganizationStatus` rather than acquiring a second name for one set.

  ```diff
  -import type { OrganizationStatusPickerFilter } from '@/modules/organizations/api/organizations-picker-client';
  +import type { OrganizationStatus } from '@endora-commerce/contracts';
  ```

  `admin/src/modules/organizations/api/organizations-picker-client.ts` is deleted; it
  existed only to serve this picker and nothing else imported it.

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

- 543151a: `catalog` and `orders` ship their admin screens, and one icon name joins the allowlist.

  **`@endora-commerce/mod-catalog` gains an `./admin` subpath and `@endora-commerce/mod-orders`
  gains routes and nav on the one it had.** `catalog`'s new entry point exports `contributions`
  with eight `routes` and six `nav` declarations — the product roster and editor, the category
  tree, the attribute and attribute-set registries, the attachment types and the two
  bulk-operation screens. `orders`' entry point exported `contributions` with a `zones` array and
  nothing else since P4d; it now declares four routes and three nav entries beside it. A consumer
  that composes either package's `./admin` gets those screens without editing an application file.

  **`@endora-commerce/mod-catalog` declares three new manifest actions**: `open-products`,
  `open-categories` and `open-attributes`, each with the destination, permission code and keywords
  the admin's hand-written palette row carried, and with the labels and descriptions those rows
  rendered. `@endora-commerce/mod-orders`' manifest is unchanged — its palette row duplicated the
  `open-orders` action it had declared all along.

  **`@endora-commerce/contracts` adds `'ClipboardCheck'` to `KnownIconNameSchema`** and
  `@endora-commerce/admin-kit` adds the matching entry to `resolveIcon`'s map. A module
  declaration names its icon rather than importing it, and `orders`' three sidebar rows render
  that glyph.

  **Breaking for a consumer that imports these two modules' screens from the admin application.**
  Twenty-seven files moved out of `admin/src/modules/{catalog,orders}/` and four re-export shims
  were deleted with them:
  - `admin/src/modules/catalog/components/ProductPicker` — import `ProductPicker` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/Section` — import `Section` from `@endora-commerce/admin-kit/ui`.
  - `admin/src/modules/orders/StatusTransitionGraph` — import `StatusTransitionGraph` from
    `@endora-commerce/admin-kit/components`.
  - `admin/src/modules/orders/orderStatusColor` — `ORDER_STATUS_COLOR_PRESETS` and
    `ORDER_STATUS_DEFAULT_COLOR` are `@endora-commerce/contracts`'; `readableTextColor` and
    `statusBadgeStyle` (which that file also re-exported as `orderStatusBadgeStyle`) are
    `@endora-commerce/admin-kit/lib`'s.

  **`@endora-commerce/mod-i18n` drops fifteen keys** — nine `appShell.nav.*`, four
  `appShell.palette.sub.*`, `appShell.nav.quickOrder` and `appShell.crumb.detail` — from the
  shared bundle in both shipped languages, nothing rendering them any more. Their replacements are
  module-relative keys in `@endora-commerce/mod-catalog`'s and `@endora-commerce/mod-orders`' own
  bundles.

  **One route tightens.** `/orders/new` was declared by the admin application and therefore
  ungated, while the sidebar row that advertised it carried `orders:write`; the route is
  `@endora-commerce/mod-orders`' own now and takes that code. A read-only operator who could
  previously open an order-entry form whose save would refuse now meets the admin's not-found
  treatment instead.

- e5ae42c: `mfa`, `carts`, `audit_logs`, `admin_users` and `admin_roles` ship their admin surfaces, on a
  new `./admin` subpath each.

  Each of the five now exports `contributions` from `@endora-commerce/mod-<id>/admin` as an
  `AdminContributions` object — six routes and three sidebar entries between them. Every
  component is a dynamic-import factory, so a consumer's bundler emits one chunk per screen.

  Six things a consumer has to know:
  - **`@endora-commerce/mod-admin-roles/admin` declares a sidebar entry and no route.** The
    `/admin-roles` screen is served by `GET /api/v1/admin/admin-roles` in `admin_users`, so
    `@endora-commerce/mod-admin-users/admin` declares that route alongside its own
    `/admin-users`, while `admin_roles` declares the sidebar entry and the palette action that
    advertise it. All three arrays of `AdminContributions` are optional and a nav-only
    contribution is supported; a consumer rendering the registry needs both packages for the
    roles screen to be both reachable and advertised.
  - **Three sidebar labels moved namespace.** `appShell.nav.users`, `appShell.nav.roles` and
    `appShell.nav.auditLog` were in `@endora-commerce/mod-i18n`'s shared `core` bundle; they
    are now `nav.adminUsers.label`, `nav.adminRoles.label` and `nav.auditLog.label` in each
    package's own `i18n/`, resolved in the module's own scope. Anything reading an old key gets
    a raw key back. The text is unchanged in both languages, and the screens' own keys did not
    move.
  - **`@endora-commerce/mod-admin-users` and `@endora-commerce/mod-audit-logs` ship an `i18n/`
    directory for the first time**, and their manifests declare `i18n.bundlesDir` accordingly.
    A consumer that mirrored `files` by hand needs the new directory.
  - **Three packages declare `actions` for the first time**: `open-admin-users`,
    `open-admin-roles` and `open-audit-log`. They are ⌘K palette entries, resolved by the
    server against the effective enabled-set, and they pay three of the fifteen remaining
    entries in this repository's Principle XVI debt. `mfa` and `carts` still declare none —
    neither contributes a sidebar entry, which is that debt's population.
  - **`@endora-commerce/contracts` adds `ShieldCheck` to `KnownIconNameSchema`**, and
    `@endora-commerce/admin-kit`'s `resolveIcon` maps it. Additive: no existing name changes,
    and a consumer validating an icon name against the old enum keeps working. It is needed
    because a nav entry declares its glyph **by name**, so keeping the one the sidebar already
    drew meant adding the name rather than substituting one already on the list.
  - **All five packages now peer on `@endora-commerce/admin-kit`, `react` and, where a screen
    routes, `react-router-dom` and `lucide-react`.** They are peers rather than dependencies
    for the reason `page-builder-core` is: the application must resolve exactly one copy, and a
    provider in one copy against a consumer in the other is a `null` context at runtime rather
    than a type error.

- f11ccdb: `customers`, `organizations` and `sales_channels` ship their admin screens, and two icon names
  join the allowlist.

  **Three packages' `./admin` subpath gains `routes` and `nav`, and two of them gain the subpath
  itself.** `@endora-commerce/mod-sales-channels/admin` already exported `contributions` with a
  `zones` array and nothing else; it now declares its screens there too. `@endora-commerce/mod-customers`
  and `@endora-commerce/mod-organizations` had no `./admin` subpath at all and now declare one.
  Eight routes and six sidebar entries between them, at the paths and codes the hand-written host
  registrations carried. The exported symbol is the same one every other module package uses —
  `contributions`, an `AdminContributions` object, and nothing else — so a consumer already
  reading `sales_channels`' zones needs no edit.
  - `@endora-commerce/mod-customers` — **new `./admin` subpath**, exporting `contributions`.
    `/customers` (the landing route), `/customers/online` and `/customers/:id`, all on
    `customers:read`, which is the code every `GET` behind them enforces; the detail screen keeps
    gating its block, unblock, impersonate, delete and restore controls on `customers:manage`
    inside itself. Two sidebar rows, in the `customers` section at weights 100 and 200. The detail
    screen is reached from the roster and has no row of its own. `CustomerDetail` renders the
    `customer.detail.after` zone, which is unchanged.
  - `@endora-commerce/mod-organizations` — **new `./admin` subpath**, exporting `contributions`.
    `/organizations` and `/organizations/:id`, both on the **any-of pair**
    `['customers:read', 'customers:manage']`, which is what
    `requireAdminAny(['customers:read', 'customers:manage'])` enforces on every organization
    endpoint. `AdminNavDeclaration.requiredPermission` and `AdminRouteDeclaration.requiredPermission`
    both take a `PermissionRequirement`, so the pair is declared rather than collapsed: naming only
    the read code hides the screen from a role holding just `customers:manage`. One sidebar row, in
    the `customers` section at weight 300. `OrganizationDetail` renders the
    `organization.detail.after` zone — four modules contribute there — and that is unchanged.
  - `@endora-commerce/mod-sales-channels` — `/sales-channels` and `/sales-channels/:code` on
    `sales_channels:read`, and `/sales-channels/new` on `sales_channels:write`. **That last one is a
    behaviour change for a consumer rendering these routes**: the create form is a screen whose only
    purpose is a write, `POST /api/v1/admin/sales-channels` enforces `sales_channels:write`, and the
    module's own `new-sales-channel` palette action already advertised that code. It was ungated
    while the route was the admin application's, so an operator holding only `sales_channels:read`
    could open a form whose save then refused; the roster's _+ New channel_ button is gated on the
    same code in this release, so the dead end is closed at both ends. `credentials` ships the
    identical split for `/credentials/new`. One sidebar row, in the `channels` section at weight 100.
    `SalesChannelEditPage` renders the `sales_channel.editor.after` zone, which is unchanged.

  **`@endora-commerce/contracts` — two members join `KnownIconNameSchema`: `Building2` and
  `Store`.** They are the glyphs the admin application drew for `/organizations` and
  `/sales-channels` by hand. A contribution names its icon rather than importing it, so a name that
  is not on the allowlist degrades to the fallback; adding them is what keeps the two rows looking
  as they did. Widening an enum is additive for a consumer validating against it and breaking for
  one exhaustively switching over `KnownIconName` — there is no such consumer in this repository.

  **`@endora-commerce/admin-kit` — `resolveIcon` answers for both new names.** `ICON_MAP` gains
  `Building2` and `Store`; the function's signature is unchanged and every existing name resolves
  exactly as before.

  **`@endora-commerce/mod-customers`, `@endora-commerce/mod-organizations` and
  `@endora-commerce/mod-sales-channels` ship new i18n keys, and `@endora-commerce/mod-i18n` loses
  six.** `nav.customers.label`, `nav.customersOnline.label`, `nav.organizations.label`,
  `nav.salesChannels.label` and the two new actions' `label`/`description` pairs are in the three
  modules' own `i18n/{en,pl}.json`; `appShell.nav.customers`, `appShell.nav.customersOnline`,
  `appShell.nav.organizations`, `appShell.nav.salesChannels`,
  `appShell.palette.sub.customerAccounts` and `appShell.palette.sub.storefrontChannels` are removed
  from the shared bundle in both shipped languages, nothing rendering them any more. **A consumer
  resolving one of those six keys out of the `core` namespace will get a raw key**; each has a
  module-namespaced replacement above.

  **`organizations` and `sales_channels` declare a new palette action each.**
  `open-organizations` (`/organizations`, `customers:read`) and `open-sales-channels`
  (`/sales-channels`, `sales_channels:read`) replace hand-written rows in the admin's own palette
  table — copies the server was never asked about, which went on advertising the screens whatever
  the effective enabled-set said. One narrowing comes with `open-organizations`:
  `ModuleActionSchema.requiredPermission` is a single string, so it names `customers:read` and a
  role holding only `customers:manage` loses the palette entry while keeping the sidebar one.

- 21dac4f: `dictionaries`, `settings` and `credentials` ship their admin surfaces, and a module can
  publish a React component to another module for the first time.

  **New `./admin` subpath on four packages.** `@endora-commerce/mod-dictionaries`,
  `@endora-commerce/mod-settings` and `@endora-commerce/mod-credentials` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`,
  and nothing else. `@endora-commerce/mod-pwa` already exported one and it grows a `routes`
  entry. Nine routes and ten nav entries in total, all at the paths and codes the
  hand-written host registrations carried:
  - `mod-dictionaries` — `/dictionary`, `/dictionaries/audit` and `/admin/dictionaries/audit`,
    all `dictionary.write`; sidebar rows for `/dictionary` and `/admin/dictionaries/audit`.
  - `mod-settings` — `/settings` and `/settings/groups` on `settings:read`, `/settings/cache`
    on `settings:write`; a sidebar row for each.
  - `mod-credentials` — `/credentials` on `credentials:read` and `/credentials/new` on
    `credentials:write`; one sidebar row.
  - `mod-pwa` — `/settings/pwa` on `pwa:read`, beside the sidebar row it has declared since
    the previous wave. `PwaPage`, `PushAudienceRuleBuilder` and the `pwa` admin API client
    moved into this package from `mod-settings`' directory, where they had been since before
    either was a package.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **New `./admin-ui` subpath on `@endora-commerce/mod-credentials`, and it is a new kind of
  subpath.** It exports `ConfigurationPreviewModal` and its `ConfigurationPreviewModalProps` —
  a read-only view of one credential configuration with every secret masked, taking
  `{ open, configuration, onClose }`. This is the first package in the repository to publish a
  React component to another package rather than to the admin application, and three things
  about it are contract rather than convenience:
  - **It is not the kit.** A component whose rendering is generic over its data belongs in
    `@endora-commerce/admin-kit`; this one calls `useTranslation('credentials')`, so every
    string it shows is the owner's vocabulary and the kit refuses it.
  - **A consumer gates presence itself.** `credentials` carries an operator activation
    control, and a statically imported component is filtered by nothing — so the consumer
    wraps the render in `useSurfaceVisibility()({ module: 'credentials' })`. With the module
    switched off the caller must render nothing rather than a modal over an API that answers 503.
  - **`@endora-commerce/mod-credentials` becomes a peer dependency of
    `@endora-commerce/mod-settings`.** The reach survives into emitted JavaScript, so a
    consumer that bundles `mod-settings`' admin layer has to resolve the owner.

  **`@endora-commerce/admin-kit`:** `toAbsoluteAssetUrl` now trims its argument and returns a
  protocol-relative URL (`//cdn.example.com/x.png`) unchanged. It previously prefixed such a
  URL with the API origin, producing `https://api.example.com//cdn.example.com/x.png`, which
  loads nothing. Existing callers passing an absolute, `data:`, `blob:` or host-relative URL
  are unaffected. `resolveIcon` answers for two more names, `Languages` and `Eraser`.

  **`@endora-commerce/contracts`:** `KnownIconNameSchema` gains `'Languages'` and `'Eraser'`.
  Additive — no previously valid icon name is rejected.

  **`@endora-commerce/mod-i18n`:** ten `appShell.*` keys are **removed** from the shared
  bundle — `appShell.nav.{cache,credentials,dictionary,dictionaryAudit,settingGroups,settings}`
  and `appShell.palette.sub.{credentials,dictionary,dictionaryAudit,platformConfiguration}`.
  Their replacements are `nav.*.label` keys in the three modules' own bundles, resolved in each
  module's own namespace. **A consumer rendering one of those ten keys by hand will render the
  raw key**; there is no compatibility alias, because a key with one consumer in two bundles is
  the duplication this feature removes.

  **Both shipped languages, everywhere.** Every new key — the six `nav.*.label`s,
  `mod-settings`' `editor.credentialRef.preview` and `mod-dictionaries`' four
  `actions.openDictionary*` strings — ships in `en` and `pl`.

  **`mod-dictionaries` declares two command-palette actions**, `open-dictionary` and
  `open-dictionary-audit`, both on `dictionary.write`. They replace hand-written rows in the
  admin's own palette table, so what an operator sees is unchanged; what changes is that the
  server now filters them against the effective enabled-set, which the hand-written rows were
  never asked about.

  **Build.** `./admin` resolves at `dist/admin/index.js` and `./admin-ui` at
  `dist/admin-ui/index.js`, both emitted by each package's `tsconfig.ui.json`. A checkout that
  has not run `pnpm run build:packages` cannot resolve either. All four packages' `build` and
  `typecheck` scripts now run two `tsc` invocations, and `@endora-commerce/admin-kit`, `react`,
  `react-router-dom` and `lucide-react` become peer dependencies where a screen names them.

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

- a28c796: `invoices`, `ksef` and `quote_requests` ship their admin surfaces, and the first zone whose
  host is a module package.

  **New `./admin` subpath on three packages.** `@endora-commerce/mod-invoices`,
  `@endora-commerce/mod-ksef` and `@endora-commerce/mod-quote-requests` each export
  `contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and
  nothing else. Eight routes and three sidebar entries between them, all at the paths and codes
  the hand-written host registrations carried:
  - `mod-invoices` — `/invoices` (the landing route), `/invoices/templates`,
    `/invoices/templates/:id` and `/invoices/:id`, all on `invoices:read`, which is the code
    every `GET` behind those four screens enforces; each screen keeps gating its own writes on
    `invoices:write` inside itself. One sidebar row, in the `sales` section at weight 500. The
    two template screens deliberately have no row: they are reached through
    `InvoiceSectionTabs`, which this package already owned.
  - `mod-ksef` — `/ksef` on `ksef:read`. One sidebar row, `sales`, weight 600. Its glyph is
    `Receipt` rather than the `ReceiptText` the host table rendered by hand, because
    `KnownIconNameSchema` does not carry the second and `Receipt` is what this module's
    `open-ksef` palette action has always named.
  - `mod-quote-requests` — `/quote-requests` (the landing route), `/quote-requests/new` and
    `/quote-requests/:id`, all on `rfqs:handle`, which is the module's only code and the one
    its admin routes build a single guard from. One sidebar row, `sales`, weight 400.

  Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
  screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

  **`@endora-commerce/contracts` gains one zone member and its props.**
  `AdminZoneNameSchema` carries `'invoice.detail.after'` and `AdminZonePropsMap` maps it to the
  new exported interface `InvoiceDetailZoneProps { invoiceId: string; kind: InvoiceKind;
ksefReferenceNumber: string | null }`. Additive: no existing member, props type or export
  changes. A host mounts it with

  ```tsx
  <AdminZone name="invoice.detail.after" props={{ invoiceId, kind, ksefReferenceNumber }} />
  ```

  and a contributor declares
  `zoneComponent('invoice.detail.after', () => import('./MyPanel.js'), { weight, requiredPermission })`,
  whose module's default export is constrained to `ComponentType<InvoiceDetailZoneProps>`.

  **`@endora-commerce/mod-ksef` publishes the first contribution into another package's screen.**
  `InvoiceKsefPanel` is a zone component now — same rendering, same `ksef:read` gate, same
  proforma guard — and `@endora-commerce/mod-invoices` renders the place rather than importing
  the panel. Neither package names the other in any specifier. It is a zone and not a published
  component because the panel's signature is three values in and nothing out; and it carries no
  `match`, because the place has a single host and a single mount, and `match` has no negation to
  write "not a proforma" with.

  **`@endora-commerce/mod-i18n` loses four keys nothing renders any more** —
  `appShell.nav.invoices`, `appShell.nav.ksef`, `appShell.nav.quoteRequests` and
  `appShell.palette.sub.customerRfqs`. Each module's sidebar label is module-relative now
  (`nav.invoices.label`, `nav.ksef.label`, `nav.quoteRequests.label`) and ships in that module's
  own `i18n/` bundle in both shipped languages.

- 727cbf5: A module can declare the Page Builder blocks it owns.

  `BlockDefinitionSchema` / `BlockDefinition` and `BlockCategorySchema` /
  `BlockCategory` are new, beside `cmsPageBuilderDescriptorSchema` in `cms.ts`.
  `ModuleManifestSchema` gains two optional arrays, `blocks` and `blockCategories`,
  beside `permissions`, `actions` and `errorCodes`:

  ```ts
  export const manifest = defineModuleManifest({
    id: 'catalog',
    // …
    blocks: [
      {
        name: 'catalog.ProductGrid', // persisted — see below
        labelKey: 'blocks.productGrid.label', // module-relative, never 'catalog.blocks.…'
        category: 'catalog',
        contexts: ['cms'],
        fields: { columns: { type: 'number' } },
        defaultProps: { columns: 4 },
        responsiveFields: ['columns'],
        previewIcon: 'LayoutGrid',
        weight: 10,
      },
    ],
    blockCategories: [
      { key: 'catalog', titleKey: 'blocks.category.catalog', contexts: ['cms'], weight: 40 },
    ],
  });
  ```

  **`name` is persisted and permanent.** It is written into the `type` position of
  a Puck node in a `jsonb` column and is the only link between a stored node and
  the module that can render it. `blockNameRe` —
  `/^[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*$/` — is exported as the one authored copy
  of that grammar, and `blockCategoryKeyRe` as the category key's. **There is no
  `ownerModule` field**: the owner is the segment before the `.`, so ownership is
  stated once rather than twice.

  **`defineModuleManifest` refuses three things**, each naming the module: a `name`
  whose owner segment is not the declaring module's own `id`; an empty `contexts`;
  and a `category` the same manifest does not declare in `blockCategories` for at
  least one of the block's contexts. A malformed name is refused before the owner
  comparison, because a name with no separator has no segment to compare. Nothing
  about a _second_ manifest is decided here — a duplicate name across two modules
  is composition's question, as it is for `errorCodes`.

  `cmsPageBuilderDescriptorSchema` is extended **additively**: each component entry
  may now carry `labelKey`, `descriptionKey`, `category`, `defaultProps`,
  `responsiveFields` and `weight`, and the descriptor may carry `categories`. All
  of them are optional and `name` deliberately keeps no grammar, so a consumer
  reading only the five fields that were there before is unaffected and the
  response is unchanged until a module declares a block.

  This is vocabulary only. No module declares a block yet, the registry is not
  populated from these declarations yet, and no stored content is touched — the
  migration that namespaces the 74 names already in the database is a later
  change, and until it lands nothing may write a namespaced name into a document.

- f66359f: Page Builder block names are namespaced. **Every renderer map is re-keyed.**

  `defaultPageBuilderConfig` and `defaultEmailBuilderConfig` stop being `Config` objects
  keyed by bare names (`Row`, `EmailHeading`) and become renderer maps keyed by the
  persisted, namespaced name (`cms.Row`, `transactional_emails.EmailHeading`). The
  `categories` block is **deleted** from both: a palette section is declared by the module
  whose blocks occupy it and is served, merged across the effectively present modules, by
  `GET /api/v1/admin/cms/page-builder/config`.

  ```diff
  -import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
  -const row = defaultPageBuilderConfig.components?.Row;
  -const layout = defaultPageBuilderConfig.categories?.layout;
  +import { defaultPageBuilderConfig, buildPaletteCategories } from '…';
  +const row = defaultPageBuilderConfig.components?.['cms.Row'];
  +// Sections come from the descriptor, merged per (key, context):
  +const layout = buildPaletteCategories(descriptor.components, descriptor.categories, 'cms', {
  +  title: (section) => t(section.ownerModule, section.titleKey),
  +  renderable: new Set(Object.keys(config.components ?? {})),
  +});
  ```

  `@endora-commerce/email-components` additionally re-keys `EMAIL_SAFE_COMPONENT_NAMES`,
  `EMAIL_COMPONENT_REQUIRED_VARIABLES` and `EMAIL_ORDER_LABELED_FIELDS`, and its 28 renderer
  `case` labels in `render-email-html` / `render-email-text`. `emailContexts` is gone: every
  entry now declares `contexts: ['email']`, and the newsletter palette is served by the
  `email → newsletter` admission rather than by a widened declaration.

  `@endora-commerce/page-builder-core` gains two things and breaks nothing:
  - `buildPaletteCategories(blocks, sections, context, options)` — the one implementation of
    "which sections does the palette for this context have, and what is in them". It applies
    `contextAdmits` to blocks **and** to sections, which is what keeps the newsletter palette
    sectioned rather than 28 entries in Puck's _Other_ drawer.
  - a `./migration` subpath exporting `FROZEN_BLOCK_RENAMES`, its inverse, the structural
    walk (`renameBlockNames`, `countBlockNames`, `mapBlockNames`) and the SQL builders the
    five rename migrations use. **It is not a runtime path** — the map is a frozen historical
    constant, not an alias table, and the difference is only real while nothing resolves
    through it.

  `@endora-commerce/contracts` extends `cmsPageBuilderDescriptorSchema.categories` additively
  with `ownerModule`: the module whose declaration won the merge, derived and never declared.

- 81726cf: `defineModuleManifest` refuses two more block declarations.

  **Rule 2 is now per context.** A block's `category` must be declared by the same
  manifest for **every** one of the block's `contexts`, not for at least one of
  them:

  ```ts
  // Accepted before this release, refused now:
  blocks: [{ name: 'catalog.ProductGrid', category: 'catalog', contexts: ['cms', 'email'], … }],
  blockCategories: [{ key: 'catalog', titleKey: '…', contexts: ['cms'] }],
  //                                                            ^ 'email' is missing

  // The fix is one word, because one entry may list every context it serves:
  blockCategories: [{ key: 'catalog', titleKey: '…', contexts: ['cms', 'email'] }],
  ```

  Under the old reading that manifest was legal and `catalog.ProductGrid` was
  uninsertable in the e-mail palette with **no error anywhere** — the section it
  names does not exist there, and a palette renders no section for a category
  nothing declares. The message names the first context that is missing.

  **Rule 4 is new**: no two of one manifest's `blockCategories` entries may cover
  the same `(key, context)` pair. A section is one record — `titleKey`, `weight`
  and `visible` resolve together, never field by field — so a manifest that states
  one twice has stated a presentation for nobody to reconcile. Two entries under
  one key are still legal when their `contexts` are disjoint, which is how one
  module declares `layout` in the CMS palette and `layout` in the e-mail one.

  Note that a duplicate `(key, context)` across **two** modules is the opposite: it
  is normal, expected and merges. `contracts/block-definition.md` §1.1 of
  `specs/096-page-builder-block-ownership/` is normative for that merge, and the
  doc blocks on `assertBlockRules` and `BlockCategorySchema` cite it rather than
  restating it.

  The bump is a minor rather than a major because the surface it tightens —
  `blocks` and `blockCategories` on `ModuleManifestSchema` — was added in the
  immediately preceding minor and has no consumer outside this repository yet. If
  you are reading this having already shipped a manifest that declares blocks,
  treat it as breaking and check your `contexts` lists.

- 1ba52e1: `sales_channels.theme_code` is read. It had not been, since 2026-04-30.

  **`@endora-commerce/mod-sales-channels`** registers `GET
/api/v1/storefront/sales-channel`, the public read `PublicSalesChannelSchema`
  has described since feature `005-sales-channels` and that no route implemented.
  It answers `{ data: PublicSalesChannel }` for the channel the resolver picked
  for the request — code, display name, language and currency scopes, `themeCode`,
  `logoUrl` — and drops `id`, `active`, `systemDefault` and `version`. The channel
  comes from `getResolvedChannel()`, so the endpoint re-resolves nothing and
  writes no query of its own. `logoUrl` is `null`, as it is on the admin detail
  shape; resolving an asset id to a URL is a separate change.

  **`@endora-commerce/contracts`** adds, to `sales-channels.ts`:
  - `PublicSalesChannelResponseSchema` / `PublicSalesChannelResponse` — the
    envelope of the route above.
  - `STOREFRONT_THEME_CODES`, `StorefrontThemeCodeSchema`, `StorefrontThemeCode`,
    `DEFAULT_STOREFRONT_THEME_CODE` and `isStorefrontThemeCode` — the storefront
    themes that exist (`industria`, `nordic`). The admin's channel form renders a
    list from this instead of a free-text box, because a free-text box could store
    a code nothing implements, which is what it had been doing.

  Nothing is removed and no existing shape changes. **`SalesChannelCreateBodySchema`
  and `SalesChannelEditBodySchema` still validate `themeCode` against the
  `^[a-z][a-z0-9_-]*$` regex and not against the new enum**, deliberately: a
  deployment that forks the storefront owns its own theme codes, and a backend that
  refused them would make the field unusable for exactly those deployments. A code
  this storefront does not implement renders in the default theme and is reported
  in the storefront's log; it is never guessed at and never silently rewritten.

- 86359f8: Publish `CmsBlockSeedPort` — the idempotent seeding seam for a predefined CMS
  block, on the `cmsBlockSeedPort` container, owned by `cms`.

  `ensureSeededBlock(block: CmsSeededBlock)` inserts the block where no block
  carries its code, then binds it to every sales channel it is not already bound
  to. Both halves are idempotent, so a re-run inserts nothing and binds nothing —
  which is what lets a module call it on every boot and lets an operator's edit of
  the seeded text survive every restart. `CmsSeededBlock` is published with it and
  carries `code`, `name`, `languages` and a `CmsContentEnvelope`: the block's text
  is the asking module's business, its storage is the CMS's, and the descriptor
  deliberately carries no channel list, block id or version.

  It exists because a module that ships a predefined block had no seam to ask for
  one and wrote `cms_blocks` and `cms_block_sales_channels` directly instead. Two
  did.

  Additive: no existing export changed shape.

  Calling it before the first request — which is where a boot seed runs — needs a
  presence decision first, `effectiveState.isPresent('cms')`, because the port is
  gated and a gate's "no" at route registration stops the next start rather than
  one request. The interface's own doc block states that, and states what an
  absent `cms` costs (nothing that the first boot after it returns does not
  recover).

- b0df9c1: A shop can tell crawlers its CMS pages exist, and an operator is told where a page will live.

  **`@endora-commerce/contracts`** gains four names, all additive:
  - `cmsPageIndexEntrySchema` / `CmsPageIndexEntry` and `cmsPageIndexResponseSchema` /
    `CmsPageIndexResponse` — `{ pages: [{ slug, updatedAt }] }`, the shape of
    `GET /api/v1/cms/pages/by-channel`. `slug` is the **per-channel** slug from
    `cms_page_sales_channels`, never `cms_pages.slug`: the address is per channel
    (Constitution XII) and the page row's own column is one value shared by all of them.
  - `cmsReservedSegmentsResponseSchema` / `CmsReservedSegmentsResponse` — the deployment's
    reserved first path segments, normalised.
  - `firstSlugSegment(slug)` — the first path segment of a CMS page slug, lowercased.
    `cmsSlugRe` permits `/`, so `pomoc/dostawa` is one page and its first segment is `pomoc`.
    It is published because **two** programs ask that question and must agree: the backend
    refusing a save, and the page editor warning while an operator types.
  - `ERROR_CODES.CMS_SLUG_RESERVED`.

  **`@endora-commerce/mod-cms`** gains two endpoints, a Setting and a refusal:

  ```
  GET /api/v1/cms/pages/by-channel            # storefront, channel-scoped, published-only
  GET /api/v1/admin/cms/pages/reserved-segments   # admin, `cms.read`
  ```

  The first is what a sitemap is built from. Until now the reference storefront advertised **no
  CMS URL to any crawler at all** — its `SITEMAP_DYNAMIC_ROUTES` named the route _pattern_, which
  is a declaration for the indexability check's reconciliation and says nothing about the rows
  behind it. Both routes are registered inside the module's existing `ctx.routes` seam, so both
  answer `503 MODULE_DISABLED` while `cms` is switched off and the storefront's sitemap then
  advertises no CMS URL and still serves.

  The Setting is `cms.reserved_slug_segments` — `valueType: 'json'`, `defaultValue: []`, in the
  existing `cms` group. A CMS page is served at the storefront root, `/{slug}`, so a page slugged
  `cart` saves, publishes and is never shown: a root catch-all is Next's lowest-priority match and
  the storefront's own `/cart` wins. **Nothing in this change creates that precedence**; what it
  removes is the silence. `CmsPageService.create` and `.patch` refuse a slug whose first segment
  the deployment reserves, with `409 CMS_SLUG_RESERVED` carrying `details.segment`, and the page
  editor reads the same value and warns inline while the operator types. A patch that writes no
  slug is not refused, so a page whose slug predates the reserved set stays editable.

  **The default is empty and that is not a gap.** The set is a fact about a _storefront's route
  table_; a headless backend serves storefronts it did not build, so a list shipped inside `cms`
  would be a derived fact about a consumer written into the owner. The reference storefront
  publishes its own as `RESERVED_TOP_LEVEL_SEGMENTS` in `storefront/app/reserved-segments.ts`,
  reconciled against its route tree in both directions by `check:storefront-indexability`; a
  deployment copies its value from there.

  Nothing is removed and no existing shape changes.

- a80e2bb: Publish `CreditLimitReadPort` — the membership read on `credit_limits`' surface,
  on the `creditLimitReadPort` container.

  `organizationsWithLimit(organizationIds: readonly string[]): Promise<string[]>`
  answers which of the given organisations hold a credit-limit row, in no
  particular order. The caller supplies an ancestor chain and decides which hit is
  nearest.

  New surface only — nothing is removed and no existing call changes. Consumers on
  an older version keep compiling; a consumer that wants the port resolves it with
  `lazyPort<CreditLimitReadPort>(ctx, 'creditLimitReadPort')` and declares the edge
  in its manifest.

  Two properties of the implementation are contract rather than detail, and both
  are stated on the interface. The read crosses organisation scope deliberately —
  the holder is by definition an ancestor outside the caller's tenant filter, so a
  provider that let `@OrgScoped` narrow it would answer the empty set for every
  descendant. And the answer is plain ids: a `CreditLimit` handed across this seam
  would be a managed entity the consumer could mutate and flush outside the
  transaction that loaded it.

  It replaces a raw `select "organization_id" from "credit_limits" where
"organization_id" in (…)` that `organizations` ran against this module's table
  (feature 077, D-87). That statement named no import specifier, so the boundary it
  crossed compiled and returned rows whatever state this module was in; the port is
  gated, so an absent owner now refuses instead of reporting an empty chain, which
  downstream reads as "no limit applies".

- d23bce2: `CustomFieldDefinitionReadPort` gains `getById(id)`, the committed-state read of a single
  custom-field definition:

  ```ts
  getById(id: string): Promise<CustomFieldDefinitionWithOptions | null>;
  ```

  Consumers resolving the port under the container name `customFieldDefinitionReadPort` need no
  change; the method is additive for them. It is the read `custom_fields`' **transactional apply
  seam** used to answer, which was wrong twice over: an apply seam exists to take the caller's
  `EntityManager`, and a read handed one is a write seam re-opened to serve a read; and the seam
  returned the owner's two managed ORM entities, typed at the call site as records. `getById`
  returns the published records.

  `minor` rather than `major` because the only party that has to change is the port's **provider**,
  and a port in this package has exactly one — the module that publishes it. If you implement
  `CustomFieldDefinitionReadPort` yourself, add the method: it takes a definition id and answers
  `null` when there is no such definition.

- 7e71642: Added the deployment divergence report's shape, and gave `decorationOrder` a supply.

  **`@endora-commerce/contracts`** exports `DivergenceReport`, `DivergenceEntry`,
  `DivergenceKind`, `DivergenceDetail`, `DivergenceBoundary` and `DivergenceKey` — the shape of
  the committed record of how one deployment's tree differs from core. Nine kinds, one per seam a
  deployment can use, each entry naming what was changed, the module that changed it, the module
  that owns what was changed, the rung of the customisation ladder it sits on, and the
  deployment's own sentence.

  Two fields are nullable on purpose and a consumer has to handle both. `entry.rung` is `null`
  for `registration`, `worker` and `omission`: the ladder ranks ways of changing what _core_ does,
  and those three are a module contributing its own surface or a declaration. `detail.depth` is
  `null` on every `decoration` in a committed report, because depth is a fact about a composition
  rather than about a tree — the runtime half of the report fills it in.

  **`@endora-commerce/platform`**: `ComposeModulesOptions.decorationOrder` is read by both of
  this repository's composition roots for the first time. Nothing about the field's type or its
  semantics changed — it is still _checked, never applied_ — but a composition that passes it now
  gets the assertion it always described, and `AmbiguousDecorationError`'s message changes with
  it: it names the deployment's own declaration file and the field, and suggests the order
  composition would apply, instead of telling its reader that there is no way to declare one.

  `ForeignDecorationError`, `PackageDecorationNotOfferedError` and `DuplicateRegistrationError`
  each gained the rung they refused and the nearest lower rung that works, by mechanism. **If you
  assert on any of these four messages, they have moved.** `error.name` and the constructor
  arguments are unchanged.

  **`@endora-commerce/cli`**: one estate row, `check:divergence`, classified `repository-only` —
  a rule's subject there is a deployment, and a module package is not one.

- cb44af0: Publish two credential-verification ports, so a caller can ask "is this the
  right password for this subject" without holding the hash.

  New exports:
  - `AdminPasswordVerificationPort` — container name `adminPasswordVerificationPort`,
    owner `admin_users`. `verifyPassword(adminUserId, password): Promise<boolean>`.
  - `CustomerPasswordVerificationPort` — container name
    `customerPasswordVerificationPort`, owner `customer_accounts`.
    `verifyPassword(customerAccountId, password): Promise<boolean>`.

  Both answer `false` for an unknown id rather than throwing, and both are a
  lookup by id alone: whether the caller may act as that subject at all is the
  session layer's question, asked before this one.

  Additive — nothing existing changes shape. `AdminUserRecord` and
  `CustomerAccountRecord` still carry no `passwordHash`, and that is what these
  ports exist to keep true: the previous caller (a composition root) read the
  column off the ORM entity and ran the comparison itself.

  `CustomerPasswordVerificationPort` is deliberately neither
  `CustomerAuthPort.login` (which mints a session and runs the login side
  effects) nor `CustomerPasswordStatePort.passwordSetAt` (which takes no secret).

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

- cd013dd: `CatalogGalleryPort` gains two batch reads, and `CatalogGalleryBatchItem` is
  exported beside it.

  `listForProducts(productIds)` answers the gallery of a **batch** of products —
  `{ productId, assetId, position }` per item, ordered by product and then by the
  operator's position — in one statement. `list(productId)` remains for the single
  product; it verifies the product exists and runs two further queries, so a page
  of 500 products costs 1500 round-trips through it against one here. It carries
  no labels and no timestamps deliberately: the callers that walk a page read
  neither, and fetching them costs a second statement per batch.

  `baseImageUrls(productIds)` answers `Map<string, string | null>` — the
  `base_image` url of each product, with **no** fallback to `thumbnail` or to the
  first gallery item. The map holds one entry per requested id, so a caller can
  index it without re-checking membership.

  Both treat an id that resolves to nothing as **data**: no row comes back and
  nothing throws, because a caller holding an id whose product has since been
  removed is asking about the batch it has. `baseImageUrls` therefore answers
  `null` for all three of "no `base_image` label", "no such product" and "the
  asset row behind the label is gone"; the three are not distinguished, as a
  caller that renders a placeholder reads one branch either way.

  Additive for a **caller** — an existing `list` / `create` / `delete` / `reorder`
  call is unchanged. An **implementer** of `CatalogGalleryPort` (a test double, an
  alternative provider) must add the two methods: D-97.3 forbids optional methods
  on a published port, since `lazyPort`'s proxy answers every property with a
  function and feature detection through it is impossible by construction.

- 3c8102e: `LineChart` joins the admin icon allowlist.

  `KnownIconNameSchema` gains `'LineChart'` and `resolveIcon` maps it to the lucide component
  of that name — the pair AGENTS.md's command-palette checklist requires in one merge request,
  because a name on the allowlist with no entry in the map renders the generic `Sparkles`
  fallback.

  It is added rather than substituted because a module's sidebar entry now declares its icon
  by name (`AdminNavDeclarationSchema.icon` is this same enum). `analytics`' entry was a
  direct `lucide-react` import in `admin/src/components/AppShell.tsx`; picking a name already
  on the list would have changed the glyph an operator sees, which is a visible regression
  bought for nothing.

- dc5c19d: Publish `ModuleLifecycleParticipant` — a third lifecycle export a module's
  `manifest.ts` may declare, beside `installHook` and `uninstallHook`, carried on
  `ModuleManifestExports.lifecycleParticipant`.

  An install hook fires for **its own** module. A participant fires for **every**
  module: `onModuleInstalled(event)` runs on any module's install, after that
  module's settings are reconciled and before its own install hook, and
  `onModuleHardUninstalled(event)` runs on any module's `uninstall --hard` and
  never on a soft one. It is for a module whose table is a projection of what the
  manifest set declares — the platform's own two are the translation bundles and
  the command-palette actions — and it exists because such a module could reach
  the lifecycle no other way: the orchestrator also serves the `module:*` CLI, and
  a platform command composes no container, so a port could not be resolved.

  `ModuleInstalledEvent` carries `{ moduleId, manifest, modulePath, em, log }` and
  `ModuleHardUninstalledEvent` carries `{ moduleId, manifest, em, log }` — with
  `manifest` nullable on the second, for a registration row whose module the
  instance no longer has. Write through the supplied `em`; a participant that
  forks its own commits beside the operation rather than inside it. Both methods
  are required, deliberately: feature detection through an optional method is what
  D-97.3 refuses on a published port, and a participant with nothing to do on one
  edge writes an empty body, which a reader can see.

  Additive: no existing export changed shape, and a `manifest.ts` that declares no
  participant is unaffected.

- c94c52d: `api_keys`, `webhooks` and `comparisons` ship their admin surfaces, on a new `./admin` subpath
  each; `KnownIconNameSchema` gains two members and the kit's icon map the glyphs behind them.

  Each of the three module packages now exports `contributions` from
  `@endora-commerce/mod-<id>/admin` as an `AdminContributions` object whose every component is a
  dynamic-import factory, so a consumer's bundler emits one chunk per screen and none of it is
  downloaded by an operator who cannot reach it. The routes are unchanged — `/api-keys`,
  `/webhooks`, `/comparisons` and `/comparisons/:id` — and each package contributes a sidebar
  entry as well.

  Five things a consumer has to know:
  - **The subpath is a new `exports` entry, so it needs a build.** `./admin` resolves at
    `dist/admin/index.js`, emitted by each package's new `tsconfig.ui.json`. A checkout that has
    not run `pnpm run build:packages` cannot resolve it.
  - **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of all
    three, and `react-router-dom` of `comparisons`.** They were backend-only packages before
    this. The kit is where every screen's design-system import now resolves, and React is peered
    rather than depended on so the application resolves one copy.
  - **Every route carries a `requiredPermission`, and the admin enforces it.**
    `integrations:manage` for `/api-keys` and `/webhooks`, `comparisons:read` for both comparison
    routes — in each case the code the screen's own API enforces. A host `<Route>` was ungated,
    so a consumer who deep-links one of these paths for an operator without the code now gets the
    admin's not-found treatment where the screen used to render and its API answered 403.
  - **`KnownIconNameSchema` gains `Webhook` and `Scale`.** A nav entry and a palette action name
    their icon; both glyphs were `lucide-react` imports inside the admin's own `AppShell.tsx`
    until this change, so keeping the sidebar looking the same meant adding the names rather than
    substituting two already on the allowlist. `@endora-commerce/admin-kit`'s `resolveIcon` maps
    both. Widening a `z.enum` is additive for a producer and narrowing for a consumer that
    exhaustively switches on `KnownIconName`; nothing in this repository does.
  - **Each of the three declares its first command-palette action** — `open-api-keys`,
    `open-webhooks` and `open-comparisons` — with both labels in the package's own `i18n/` bundle.
    A consumer resolving palette entries from the manifests will see one more per module.

  Nothing is removed and no existing export changes shape, so a consumer of any of the three
  `./backend`, `./migrations` or root subpaths is unaffected.

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

- fc34995: `pwa` ships an admin surface that is a sidebar entry and nothing else.

  `@endora-commerce/mod-pwa/admin` is a new subpath exporting `contributions` — an
  `AdminContributions` object with **one `nav` entry and no `routes`**. That combination is
  legal and was, until now, unexercised: the type's own documentation says _"a module shipping
  only a nav entry pointing at a host route is legal"_, and every conversion before this one
  moved a route. The entry advertises `/settings/pwa`, labelled `nav.pwa.label` in this
  package's own `i18n/{en,pl}.json` rather than in the shared bundle, in section `system` at
  weight 1400, gated on `pwa:read`.

  Two things a consumer has to know:
  - **The screen at that path is not in this package.** `PwaPage` lives in the admin
    application, under a directory `settings` owns, so the route is still declared by the host.
    A consumer that renders the registry's nav without the admin's own route table will show an
    entry pointing at a path it does not serve. That resolves when `settings` ships its own
    admin layer.
  - **`Smartphone` joins the icon allowlist.** `KnownIconNameSchema` gains the name and the
    kit's `resolveIcon` maps it to the lucide component of that name — the pair AGENTS.md's
    command-palette checklist requires in one merge request, because a name on the allowlist
    with no entry in the map renders the generic `Sparkles` fallback. It is added rather than
    substituted so the sidebar keeps the glyph it already drew.

- 1050b9a: Publish `ModuleCliCommand` — a fourth export a module's `manifest.ts` may
  declare, beside `installHook`, `uninstallHook` and `lifecycleParticipant`,
  carried on `ModuleManifestExports.cliCommands`.

  A module's operator command is now a **declaration the host runs**, never a
  script that bootstraps the host. That is one-to-one with Magento 2, where a
  module ships a command class plus a declaration under `CommandListInterface` and
  `bin/magento` bootstraps the application and constructs the command with its
  dependencies injected. It is what a packaged module needs: a file under
  `node_modules` can name no specifier that resolves to the instance's
  composition root, so a package could otherwise ship no operator command at all.

  ```ts
  // <module>/manifest.ts
  export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
    {
      name: 'reindex',
      summary: "Rebuild every sales channel's index.",
      help: 'usage: search reindex',
      run: async (context) => (await import('./cli/reindex.js')).reindex(context),
    },
  ];
  ```

  `ModuleCliCommandContext<Ctx>` carries `{ ctx, argv, out, err }`. `ctx` is the
  module's own `ModuleContext`, generic for the same reason `EntityManager` is
  generic on the lifecycle hooks — this package does not import kernel types — and
  a handler resolves from it exactly as `backend.ts` does. `out` and `err` are
  injected rather than reached for, so a command is drivable from a test without
  capturing the process's streams. `run` returns the exit code; it is required to
  return one, because a command that means "1" and returns nothing is
  indistinguishable from one that succeeded.

  `name` must match `MODULE_CLI_COMMAND_NAME_RE` (lowercase, hyphen-separated),
  which is also exported: a command is addressed as `<module id> <command name>`,
  so a name the grammar cannot express is unreachable and the host refuses it
  rather than advertising it. `help` is an optional **data** property, answered by
  the host before it composes — a tool has to be able to say what it does before
  it can do it, and one of the shipped commands has that as a ruled condition
  rather than a nicety. An optional data property is outside what D-97.3 refuses,
  which is about optional **methods** on a published port.

  The field is spelled `cliCommands`, not `commands`, so it cannot be read as a
  Command Bus Command: `commands/` is already a module's directory of audited
  domain writes. A CLI command that performs one runs it, resolved from `ctx`.

  Additive: no existing export changed shape, `ModuleManifestExports` gained a
  third optional generic parameter defaulting to `unknown`, and a `manifest.ts`
  that declares no command is unaffected.

- 32cc6e4: A module can declare where its documentation lives, and the tooling can find it.

  `@endora-commerce/contracts` gains `ModuleDocsManifestSchema`,
  `ModuleDocsDeclarationSchema` and an optional `docs` field on `ModuleManifestSchema`.
  Its shape is `i18n`'s and it is located the same way — a directory at the **package
  root**, in the package's `files` list, with **no `exports` subpath**, found by joining
  `docs.dir` to `dirname(manifestPath)`. The anchor is the platform's, so nothing in a
  module names a package, a repository root or a build directory in order to find its own
  pages.

  ```ts
  export const manifest = defineModuleManifest({
    id: 'inpost',
    i18n: { bundlesDir: 'i18n' },
    docs: { dir: 'docs' }, // ships pages
    // docs: false,          // ships none, deliberately
  });
  ```

  **`false` and absent are not the same state**, and consumers must not collapse them:
  absent is a module nobody has decided about, `false` is a decision. A universal
  obligation over a population where some members legitimately owe nothing is repaired by
  empty files whose only effect is to make a check pass, which is why the decision has a
  spelling of its own.

  `@endora-commerce/cli` gains `lib/module-docs.js`: `resolveDocsLayout` (the Docusaurus
  site, from the workspace member declaring a configuration), `collectDocPages`,
  `parseFrontMatter`, `attributeDocs` and `moduleOfSlug`. It is the one derivation behind
  both the generated documentation navigation and the check that refuses its population
  defects — a second derivation of one population is two answers waiting to disagree, which
  is the state it replaces: three hand-maintained lists described the modules this platform
  composes and all three disagreed with it and with each other.

  No existing symbol changed, and a manifest that declares no `docs` is unaffected.

- 63be98c: A module can declare the error codes it owns, and a branded type keeps a typo out of a raise site

  Feature 090 (`specs/090-module-owned-error-codes/`), Phase 1 of D-182. Nothing routes
  differently yet — the prefix chain in `@endora-commerce/mod-i18n` is untouched and is still
  what the composition roots inject.

  **`@endora-commerce/contracts`**
  - `ModuleManifest` gains `errorCodes?: { code: string; tokens?: string[] }[]` — the codes a
    module owns. The sentence for each still lives in the module's own
    `i18n/<language>.json` under `errors.<CODE>`; there is deliberately no `message` field,
    because the raising code's own English already exists and can interpolate.
    `defineModuleManifest` refuses four things, naming the module and the code: a code that is
    not SCREAMING*SNAKE_CASE, the same code twice in one manifest, a refusal token that does not
    match `^[a-z]a-z0-9*]\*$`, and the same token twice under one code.
  - New: `defineModuleErrorCodes(['ACME_SYNC_REJECTED'])` returns each code as a branded
    `ModuleErrorCode`. This is the authoring shape for a module's own codes, and it is
    mandatory rather than a convenience — a bare string literal is assignable to neither
    `ErrorCode` nor `ModuleErrorCode`, so a typo at a raise site is a compile error. It does
    **not** make a typo in an `error.code === '…'` comparison an error; that is unchanged and
    measured.
  - New: `errorCodeRe`, `errorCodeTokenRe`, `ModuleErrorCodeDeclarationSchema`.
  - `errorEnvelopeSchema.error.code` relaxes from `z.enum(Object.values(ERROR_CODES))` to a
    regex over the same grammar, so a module-declared code validates. `ERROR_CODES` and
    `ErrorCode` are unchanged and stay closed. `ErrorEnvelope['error']['code']` is now
    `ErrorCode | ModuleErrorCode`: every value valid before is valid after, in both directions.

  **`@endora-commerce/platform`**
  - `HttpError`'s `code` parameter and field widen from `ErrorCode` to
    `ErrorCode | ModuleErrorCode`. Purely a relaxation; no call site changes.

  **`@endora-commerce/mod-i18n`**
  - New: `buildErrorTranslationTargets(manifests)`, which derives the routing map from the
    modules' own declarations, and `describeErrorCodeCollisions`. Two modules declaring one
    code routes it to **neither** and names every claimant with the file that declares it —
    there is no tie-break by origin, order or id, because each of those renders one raiser's
    condition under the other's sentence with no symptom anyone can detect. Exported but not
    yet wired: the composition roots still inject `ERROR_TRANSLATION_KEYS`.
  - `ErrorTranslationTarget['key']` widens from `errors.${ErrorCode}` to `errors.${string}`.

- 9ce0b40: Publish `ModuleRecentActivity` — a fifth export a module's `manifest.ts` may
  declare, beside `installHook`, `uninstallHook`, `lifecycleParticipant` and
  `cliCommands`, carried on `ModuleManifestExports.recentActivity`.

  A module **declares** that its activity is eligible for the admin home
  dashboard's Recent Activity card; the operator **decides** whether it appears,
  and the default is that it does. That is Constitution XVII's two-axis shape
  applied to a narrower object: a module author cannot put entries on somebody's
  home screen by fiat, and an operator cannot be surprised by a card they did not
  configure.

  ```ts
  // <module>/manifest.ts
  export const recentActivity = defineModuleRecentActivity({
    entries: [{ action: 'product.create', icon: 'Plus', labelKey: 'activity.verb.product.create' }],
  });
  ```

  `action` is the `audit_log_entries.action` token, matched against the exported
  `auditActionRe`. `icon` comes from the existing `KnownIconNameSchema`, so the
  Admin SPA maps it through the one icon map it already has and a package cannot
  name a component the app does not bundle. `labelKey` is **relative to the
  declaring module's i18n namespace**, exactly as a command-palette action's
  `labelKey` is, which is what lets a third-party package's verb render in the
  operator's language from the package's own bundle.

  The operator's half needs no declaration and takes none. Three new functions
  derive it:
  - `recentActivityVisibilitySettingCode(moduleId)` → `<moduleId>.recent_activity_visible`,
    throwing `RecentActivitySettingCodeInvalid` for a module id that cannot carry
    a setting code (a platform-internal, underscore-prefixed one). Derived rather
    than declared because the ruling fixes the default, so there is nothing left
    for a declaration to carry — and a declared code would be one more place a
    module could disagree with the platform about its own name.
  - `settingsManifestWithRecentActivity(manifest, recentActivity)` merges that
    Setting into the module's own settings manifest, `hidden: true` and defaulting
    to `true`. One derivation, two callers — the boot reconcile and the lifecycle
    orchestrator's `install`, which is a package's only settings author.
  - `defineModuleRecentActivity` is the identity-with-validation helper, the twin
    of `defineModuleManifest`.

  `KnownIconNameSchema` gains six names — `Edit`, `Archive`, `Box`, `Truck`,
  `CircleDollarSign`, `Activity` — the icons the dashboard's renderings used while
  they were a hand-maintained table in the Admin SPA.

  Additive: no existing export changed shape, and a `manifest.ts` that declares no
  recent-activity eligibility is unaffected.

- 07b2715: `ModuleNonBindingDependencySchema.kind` gains a third member,
  `'refuses-without'` — a module declaring that a cross-module read has no
  fallback, without binding the owner's lifecycle.

  The two existing kinds cover "an inert push" (`contributes-to`) and "I keep
  working with less" (`degrades-without`). There was no spelling for "this
  operation stops", and the two arrays that carried that meaning —
  `dependencies` and `acknowledgedDependencies` — both bind: an operator may not
  switch the owner off while the dependent is present. A dependent that is itself
  `activation.nonDeactivatable` therefore turned the _owner's_ activation control
  into a control that does nothing when flipped.

  ```ts
  nonBindingDependencies: [
    {
      moduleId: 'payments',
      name: 'orderPlacementPaymentApplyPort',
      kind: 'refuses-without',
      whenAbsent: 'checkout cannot take an order, because no payment method is available',
      reason: 'The placement seam has no fallback; binding would leave payments.enabled inert.',
    },
  ];
  ```

  `whenAbsent` is **required** for the new kind and `defineModuleManifest` throws
  without it: the deactivation-consequence ledger classifies such an edge
  `fails-closed`, which is what an undeclared gated port already classifies as, so
  the sentence is the whole of what the declaration adds. It is what the operator's
  confirmation dialog renders in place of a translated default.

  Additive: `'contributes-to'` and `'degrades-without'` are unchanged, no existing
  field changed shape, and `defineModuleManifest` refuses nothing today that it
  accepted before. Consumers exhausting `ModuleNonBindingDependency['kind']` in a
  `switch` or a mapped type gain a case; a `Record<kind, …>` over it stops
  type-checking until the third key is added.

- 9b2a43e: Added the `order.entry.tabs` admin zone, and `<RouteTabsZone>` — the renderer that makes a
  zone a tab strip.

  `@endora-commerce/contracts` gains the enum member `'order.entry.tabs'` and the props type
  `OrderEntryTabsZoneProps`, which is empty: the contributions _are_ the tabs, so the mount has
  no identifier to pass. `AdminZonePropsMap` gains the matching entry, so a host writing
  `<RouteTabsZone name="order.entry.tabs" props={{}} />` is type-checked against it exactly as
  an `<AdminZone>` mount is.

  `@endora-commerce/admin-kit` gains two exports:
  - `RouteTabsZone` on `./zones` — `{ name, props, className? }`. It renders the strip chrome
    and delegates the contributions to `<AdminZone>`, so the lazy-component cache, the
    per-contributor error boundary and the `weight` ordering are unchanged. **It renders
    nothing at all when fewer than two contributions survive presence and permission**: one tab
    is not a choice. The floor is a constant rather than a prop, deliberately — two is a
    property of tab strips, and a `minimum` prop would let a caller ask for the thing the rule
    refuses.
  - `RouteTabLink` on `./ui` — `{ to, label }`, the tab a contribution renders. It decides its
    own selected state, because in a contributed strip no component sees the whole set. That
    costs `RouteTabs`' _longest-wins_ tie-break: two contributed tabs whose paths are prefixes
    of one another would both read as selected. `RouteTabs` itself is unchanged and is still
    the primitive to use whenever one component knows every tab.

  `@endora-commerce/mod-orders` gains an `./admin` subpath — its first — contributing the
  _Standard order_ tab at weight 100. `@endora-commerce/mod-quick-order` gains the _Quick
  order_ tab at weight 200. Both are gated on `orders:write`, which is the code their routes
  enforce. Each label now ships in its own module's bundle
  (`orderEntry.tab.standard`, `orderEntry.tab.quick`) instead of the shared `core` one.

  **If you were rendering `OrderEntryTabs` from the admin application**, it is gone. It knew
  both module ids and both routes and belonged to neither module; mount the zone instead:

  ```diff
  -import { OrderEntryTabs } from '@/components/OrderEntryTabs';
  -<OrderEntryTabs />
  +import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
  +<RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />
  ```

- c4703f9: `OrderReadPort` gains `salesChannelIdsForCustomer(customerAccountId)`, the distinct sales
  channels one customer has ordered on:

  ```ts
  salesChannelIdsForCustomer(customerAccountId: string): Promise<string[]>;
  ```

  The ids come back already distinct, most recently ordered-on first, and a customer with no
  orders answers `[]`. Consumers resolving the port under the container name `orderReadPort`
  need no change; the method is additive for them.

  It is the read the admin customer-detail header used to answer with `em.find(Order, {
placedByCustomerAccountId }, { fields: ['salesChannelId'] })` from inside the `customers`
  module — a plain read of another module's table, so it becomes a **read-port method** and not
  an `EntityManager`-taking apply port: handing a read a transaction handle re-opens a write seam
  to serve it. It is deliberately not `OrderListPort.list` with a `placedByCustomerAccountId`,
  which is paginated: the channels that read yields are the channels on one page, and a detail
  header that silently narrowed with the page size would be a different fact under the same
  label.

  `minor` rather than `major` because the only party that has to change is the port's
  **provider**, and a port in this package has exactly one — the module that publishes it. If you
  implement `OrderReadPort` yourself, add the method: it takes a customer account id and answers
  the distinct channel ids of that customer's orders, newest first.

- 49164fb: `OrderRecord` gains `shippingAdapterData?: Record<string, unknown> | null`, and
  `orderReadPort` projects it.

  The adapter-specific shipping envelope captured at placement (feature 068). Opaque on the
  record on purpose: only the delivery method's own `ShippingAdapter` knows its shape, and
  the reader that needs it is that same adapter reading back what it wrote. It is published
  so a carrier module can read the order it is shipping over `OrderReadPort` instead of
  importing `orders`' entity.

  Additive: no existing field moves and no caller has to change.

- 284276b: `receivePaymentRequestSchema` and `operatorProviderDetailsSchema` are new, and they bound what an
  **operator** may write into `payments.provider_details`:

  ```ts
  export const operatorProviderDetailsSchema: z.ZodType<
    Record<string, string | number | boolean | null>
  >;
  export const receivePaymentRequestSchema: z.ZodType<ReceivePaymentRequest>;
  ```

  `receivePaymentRequestSchema` is `receivePaymentSchema` with `providerDetails` narrowed from
  `z.record(z.string(), z.unknown())` to that flat scalar map — at most 50 entries, keys up to 64
  characters, string values up to 1000. It is the body of `POST /api/v1/payments/receive`, whose
  `providerDetails` was persisted verbatim into a JSON column that
  `GET /api/v1/admin/orders/:id/payments` echoes back in full: any document, of any depth and any
  size, chosen by the caller rather than by the schema.

  A flat map rather than a named field set because the column has several authors — the key
  vocabulary belongs to whichever adapter wrote the row — so enumerating keys here would claim an
  ownership this route does not have. What it refuses is the part that makes an unbounded bag
  dangerous.

  `receivePaymentSchema` and `ReceivePayment` are **unchanged**. If you build a `ReceivePayment` in
  code — every gateway integration does, with its own nested provider shapes — nothing about your
  call changes. The bound applies to the HTTP body only, and `ReceivePaymentRequest` is assignable
  to `ReceivePayment`, so a handler typed on the latter needs no edit.

  `minor`: both exports are additive and no existing symbol changed shape.

- d59f846: `ERROR_CODES` gains `PAYMENT_NOT_DUE`, `PAYMENT_ORDER_CLOSED` and
  `PAYMENT_ADAPTER_UNAVAILABLE`, the three codes `@endora-commerce/mod-payments`
  declares for the buyer's payment-retry refusals.

  Additive: no existing member changes and no consumer breaks. A consumer that
  switches exhaustively over `ErrorCode` gains three members to handle.

- 566f233: Add PayPal payment gateway contracts (feature 086): config (incl. webhook URL for admin), method rules, storefront config, and inline create/capture response schemas.
- 0ec3f95: A permission declares what it depends on, and a catalogue row says who owns it.

  **`@endora-commerce/contracts`.** `modulePermissionDeclarationSchema` gains an
  optional `requires: string[]` — the codes a role holding this one also needs
  before the surface it opens is whole. It is advisory: no guard reads it, no role
  upsert is refused, and it is **not** a lifecycle edge, so declaring it does not
  put the named code's owner into your module's `dependencies` and does not stand
  in the way of an operator switching that owner off.

  ```ts
  // packages/modules/<id>/src/manifest.ts
  permissions: [
    { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
  ],
  ```

  `permissionCatalogueEntrySchema` — the row `GET /api/v1/admin/permissions`
  returns, and the return type of `PermissionCataloguePort.listAssignable()` —
  gains `owners: string[]` (required) and `requires?: string[]`. `owners` is the
  set of modules whose presence keeps the code grantable, and it is **not** the
  existing `module` field, which is a display grouping: `_lifecycle` files its
  codes under `module: 'module_lifecycle'`, which is no module id, and a shared
  code such as `integrations:manage` has two owners and one grouping.

  Readers need no change — the two fields are additive on the wire. **If you
  construct a `PermissionCatalogueEntry`** (a test double, a second implementation
  of `PermissionCataloguePort`), add `owners`:

  ```ts
  // before
  const row: PermissionCatalogueEntry = { code: 'blog.read', module: 'blog', label: 'View' };
  // after
  const row: PermissionCatalogueEntry = {
    code: 'blog.read',
    module: 'blog',
    label: 'View',
    owners: ['blog'],
  };
  ```

  New export `missingPermissionRequirements(granted, catalogue)`: the codes a role
  holding `granted` is advised to add, over the catalogue rows the platform
  already merged. It skips a requirement naming a code the given rows do not
  offer, and advises a `'*'` role nothing. It exists so that the role editor and
  the permission inventory read one function rather than two.

  **`@endora-commerce/mod-admin-roles`.** `PermissionCatalogueService` puts
  `owners` and `requires` on every row it merges, unions `requires` across every
  declarer of a shared code, and gains `listRequirementsByCode()`.

  **`@endora-commerce/mod-admin-users`.** The role editor renders the shortfall for
  the codes currently ticked, with a one-click add, and shows a row's owner set
  wherever it says something the display grouping does not.

  **`@endora-commerce/mod-quote-requests`.** Declares `rfqs:handle` with
  `requires: ['price_lists:read']` — the RFQ create screen prefills a price from a
  `price_lists` route, so a role holding only `rfqs:handle` falls back to manual
  entry.

  **`@endora-commerce/mod-i18n`.** Six `adminRoles.*` keys for the above, in both
  shipped languages.

- 28c7f22: `pimcoreImportFailureCodeSchema` gains a sixth member, `superseded`.

  A Pimcore full delivery is a complete snapshot, so when one arrives while another full
  delivery is still applying, the arriving one takes the connection's apply claim and the
  incumbent stops where it is (owner ruling, 2026-09-01). Until now that takeover was
  silent: the superseded run stayed `running` for ever, and nothing on the runs screen
  distinguished it from a run that was simply still going.

  `superseded` is the code that run now carries. It is the one member of the enum that is
  **not a fault** — the delivery did not break, the sender replaced it — so a consumer that
  maps failure codes onto an error presentation should give this one a neutral tone:

  ```ts
  const tone: Record<PimcoreImportFailureCode, 'danger' | 'neutral'> = {
    delivery_protocol_error: 'danger',
    apply_failed: 'danger',
    worker_lost: 'danger',
    internal_error: 'danger',
    other_pim_enabled: 'danger',
    superseded: 'neutral',
  };
  ```

  A `minor` rather than a `patch`, and which direction breaks is the point: a consumer
  _producing_ a `PimcoreImportFailureCode` is unaffected, while a consumer _exhausting_ one
  — a `Record<PimcoreImportFailureCode, …>`, or a `switch` with no `default` — stops
  compiling until it names the new member. That is the intended failure: rendering a code
  the operator cannot read is what this member exists to prevent.

  The value is also the i18n key suffix. `@endora-commerce/mod-pim-pimcore` ships
  `runs.failureCode.superseded` in `en` and `pl`; a consumer with a bundle of its own needs
  the same key.

- 31975ca: `KnownIconNameSchema` gains `'PlugZap'`, with the matching entry in the kit's
  `resolveIcon` map. A module declaring a sidebar entry or a palette action names its icon as a
  string rather than importing the component, so a glyph the allowlist does not carry cannot be
  declared at all.

  `@endora-commerce/contracts` also publishes the Pimcore connector's own surface — the
  `Pimcore*` DTOs, the delivered-record envelope, `PIM_PIMCORE_SETTING_CODES` and seventeen
  `PIM_PIMCORE_*` members of `ERROR_CODES` — and three catalogue shapes the connector's ports
  need.

  No existing export changes shape.

- e1465e0: These three packages stop being `"private": true` and can be published.

  They are the set a scaffolded storefront resolves (D-195), derived rather than chosen:
  `storefront/package.json` declares exactly these three `@endora-commerce/*` ranges, and their
  closure over `dependencies` and `peerDependencies` adds nothing.

  Each now declares `repository` — a consumer's path back to the code, and npm's prerequisite for
  provenance — and `publishConfig.access: "public"`, which is a property of the package rather than
  of the registry it happens to reach. **No `publishConfig.registry` in any of them**: the registry
  is CI configuration and the client's `.npmrc`, so moving from the private rehearsal to npmjs is
  one variable rather than three manifest edits.

  Nothing about the packages' own API changes in this release. What changes is that there is one:
  a consumer can install them by version instead of by tarball path.

  Two consequences worth knowing before the first `changeset version` run. `page-builder-core` and
  `cms-components` are in the `linked` group with `email-components` and `page-builder-admin`
  (D-108), and at `0.0.0` a `workspace:^` peer range is out of range after any bump — so those two
  will have their `version` fields advanced while staying private and unpublished. That is correct
  and needs no repair. And the private registry's version history is independent of npmjs': a
  version published privately is not thereby taken on the public registry, and
  `changeset publish` replays no history — it publishes the current version of each package or
  nothing.

- a47dcc8: Three additions, all for the same reason: a composition root may no longer be the place a
  module's rule lives.

  **`CustomerRollupScopePort`** (container name `customerRollupScopePort`, owner
  `customer_accounts`) — whether a customer login widens from single-org to its
  organization's subtree, and the widened id set when it does.

  ```ts
  const rollup = await customerRollupScopePort.resolveSubtreeIds(
    customerAccountId,
    organizationId,
    (id) => organizationTree.subtreeIds(id),
  );
  ```

  The traversal arrives as an argument rather than being resolved inside the owner: the caller
  already holds it, and `organizations` publishes no contract for it.

  **`SettingsManifestCollectionPort`** and **`SettingsManifestSource`** (container name
  `settingsManifestCollectionPort`, owner `settings`) — how a module registry becomes the
  boot-time reconcile's list of settings manifests: the settings module first, each module
  code once. The registry stays the caller's argument, because which modules a deployment
  ships is a composition-root input.

  **`FeedDeliveryError`** — moved here from `product_feeds`' delivery SPI, beside
  `feedDeliveryFailureReasonSchema`, the closed reason set it carries. It is re-exported from
  its old location, so no import breaks.

  It moved because a delivery adapter is a **contribution** and its author is not always the
  module: `DeliveryService` classifies a transport refusal with `instanceof FeedDeliveryError`,
  so a thrower that reached the class through a second copy of the module's sources would have
  had every declared refusal silently reclassified as a retryable `internal_error`. This
  package is resolved once, so the comparison holds.

- 456ffa7: A listing that a viewer's organization scope emptied now says so.

  `@endora-commerce/contracts` adds `SCOPE_NOTICE_CODES`, `scopeNoticeCodeSchema`,
  `ScopeNoticeCode`, `scopeNoticeMetaSchema`, `ScopeNoticeEnvelope` and `scopeNoticeOf`.
  The last is the reader both sides share: `meta.scopeNotice` on any successful response,
  absent when there is nothing to say.

  ```ts
  import { scopeNoticeOf } from '@endora-commerce/contracts';

  const res = await apiClient.get<ListResult>('/api/v1/admin/comparisons');
  const notice = scopeNoticeOf(res); // 'ORGANIZATION_ATTRIBUTION_PENDING' | null
  ```

  `@endora-commerce/platform` adds `TenantScopeNotices` and
  `noteOrganizationAttributionRefusal` to `./tenancy`, an optional `notices` field on
  `TenantContext`, and a `preSerialization` hook inside `registerRequestScopeHook` that puts
  the code on the envelope. **This changes what every route registered behind that hook
  answers**: a successful object body gains `meta.scopeNotice` when the `customerAccount`
  filter refused a whole table during that request. Error bodies, arrays, buffers and string
  bodies are untouched, and a viewer whose reach is not restricted never sees the key,
  because only an `allowed-set` context carries a sink for the filter to write to.

  Nothing to do to adopt it: no route sets a flag, and the notice stops being emitted for a
  table on the day that table gains an `organization_id`, because the same filter arm starts
  granting instead of refusing.

  `@endora-commerce/mod-i18n` adds the two operator-facing sentences to the `core` bundle in
  `en` and `pl`: `scopeNotice.organizationAttributionPending.title` and `.body`.

- 49164fb: `StartShipmentResult` lets an adapter name the carrier reference it just obtained.

  `{ kind: 'pending' }` and `{ kind: 'generated' }` both accept `externalReference?: string | null`
  and `providerDetails?: Record<string, unknown>`, and `ShipmentService.createShipment` applies
  them on the **open create transaction** — a forked EntityManager inside an adapter cannot see
  the uncommitted row, so an adapter that wrote there wrote nothing.

  `OrderCreatedContext` gains `shippingAdapterData`, `deliveryPhone` and `customerEmail`, all
  from the in-transaction order snapshot, for the same reason: an adapter must not re-fetch the
  order to validate a checkout that has not committed.

  `ShippingAdapter.shouldAutoCreateOnPaid?()` is new and optional: when it answers true,
  `shipments` opens a shipment on `payment.received.v1`. Absent or false for every built-in
  offline adapter, so nothing changes for an adapter that does not implement it.

  **Not a breaking change for an existing adapter**: a `{ kind: 'generated', trackingNumber }`
  result still deposits that tracking number, which is what `@endora-commerce/mod-dhl-parcel`'s
  two adapters return. `externalReference` wins where both are named.

- 49164fb: `shipments` publishes `shipmentReadPort`, and `@endora-commerce/contracts` gains
  `ShipmentReadPort` and `ShipmentRecord`.

  ```ts
  interface ShipmentReadPort {
    findById(id: string): Promise<ShipmentRecord | null>;
    findByExternalReference(reference: string): Promise<ShipmentRecord | null>;
  }
  ```

  For a carrier module, which asks about a shipment twice and could previously only do it
  by loading `shipments`' entity: when an inbound webhook names only the carrier's own id,
  and when an admin asks for the label of an attempt. `findByExternalReference` is not a
  duplicate of `findById` — a carrier that signs nothing and names only its own id has to be
  correlated, and until the first `receive_shipment` lands, `externalReference` is where the
  adapter put that id.

  Resolve it as `lazyPort<ShipmentReadPort>(ctx, 'shipmentReadPort')` with `shipments` in
  your manifest `dependencies`. Nothing is removed; `shipmentService` and `shipmentUsagePort`
  are unchanged.

- bbf9258: Three admin zone members for the order detail, and both of its carriers become contributors.

  `@endora-commerce/contracts` — `AdminZoneNameSchema` gains `order.detail.payment`,
  `order.shipment.row.actions` and `order.shipments.tab.actions`, each with its
  `AdminZonePropsMap` entry: `OrderDetailZoneProps { orderId }`,
  `OrderShipmentRowZoneProps { orderId, shipmentId, deliveryMethodCode, providerCode, status }`
  and `OrderShipmentsActionsZoneProps { orderId, deliveryMethodCode, latestShipmentId,
latestStatus }`. Added members and added interfaces, so nothing a consumer writes today
  stops compiling; a host that renders one of the three needs the props exactly as declared,
  because `match` compares against them by key and a key the props do not carry never agrees.

  `@endora-commerce/mod-payments` gains an `./admin` subpath — its first — exporting one
  contribution to `order.detail.payment` at `payments:read`. The panel it loads is
  `admin/src/modules/orders/OrderPaymentsTab.tsx`, which `orders` used to own and render
  behind a hard-coded `{ module: 'payments' }` visibility gate.

  `@endora-commerce/mod-inpost` adds a second zone contribution, to
  `order.shipment.row.actions` at `inpost:manage`, narrowed by
  `match: { providerCode: 'inpost', status: 'success' }` — the branch `orders` used to write
  in its own JSX, and the first `match` in this repository.

  `@endora-commerce/mod-dhl-parcel` adds **two** contributions to
  `order.shipments.tab.actions`: the label and the handover protocol at `dhl_parcel:read`,
  the courier booking at `dhl_parcel:write`, matched on the module's two delivery-method
  codes. **This is a behaviour change and it is the point**: the three buttons those
  contributions replace carried no permission gate at all, while the routes behind them have
  always enforced those two codes. An operator without them was shown three buttons that
  answered 403; they are absent now. Six `shipmentActions.*` strings join this package's own
  `i18n/` bundle in both shipped languages, and the five `orderDetail.shipments.actions.*`
  keys they replace leave `_i18n`'s — no module but this one read them.

- e3a6a02: Order and filter a product listing by the viewer's own price.

  `productListQuerySchema` accepts two further orderings — `price` (cheapest
  first) and `-price` — and two optional bounds, `minPrice` and `maxPrice`, on the
  viewer's own resolved unit price. A minimum above a maximum is refused by the
  schema rather than answered with an empty page. The sort union is exported on
  its own as `productListSortSchema` / `ProductListSort`, with an `isPriceSort`
  narrowing, so a consumer no longer has to spell the four members inline.

  The listing response gains `capabilities: { priceOrdering }`, which says whether
  this page may be ordered by price for this viewer at all — a non-public sales
  channel publishes no prices, and `pricing.unauthenticated_display_mode = none`
  hides them until login. A storefront should gate its price controls on that flag
  rather than guessing.

  `ListingPriceOrderPort` is published beside `ListingPricePort` on the
  `pricingService` container: the catalogue in resolved-unit-price order, one
  chunk at a time, for one viewer. Two new error codes,
  `PRICE_ORDERING_UNAVAILABLE` and `PRICE_RANGE_INVALID`.

  All additive: an existing request that omits the new fields behaves as it did,
  and no existing enum member or field changed shape.

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

- 04cba90: Close D-129's sweep: the platform error-code block is 21 codes with a reason each, and a gate
  that says so.

  **`@endora-commerce/contracts`** — `errorCodeTokenRe`'s doc block said the envelope "falls back
  to `errors.<CODE>`" when a token key is missing. It does not, and it never did:
  `localizeErrorEnvelope` composes one key — `errors.<CODE>.<token>` when the raise carries a
  `details.code`, `errors.<CODE>` when it does not — asks for it once and never re-asks. The
  correction matters to anyone declaring `tokens`, because it decides whether a code whose every
  raise is tokened needs its base sentence at all. It does, but for the check rather than for the
  operator (D-190). No shape changes; this is the published `.d.ts` telling the truth.

  **`@endora-commerce/mod-i18n`** — the same 21 declarations, regrouped by the ground that put each
  one there, with the block's doc comment rewritten to read as the platform block's home rather
  than as what a migration left behind. Nothing a consumer resolves moves: the codes, their
  `tokens` and every `errors.*` key in the bundle are unchanged.

  D-129's sweep is now complete — 79 codes moved into 20 modules over seven merge requests, 21
  stayed. Each of the 21 is annotated with its D-121 tier and the sentence that argues it, and
  `_i18n`'s declarations are held equal to those annotations in both directions, with the
  annotations' own membership held against the frozen chain capture plus the re-homing and minting
  ledgers. A twenty-second code cannot reach the platform block by nobody deciding.

- c53fef3: **`WorkerLogger` is gone; the type is `PlatformLogger`.** One structured-logger shape had
  three exported names, and two of them were the same word.

  `@endora-commerce/platform/kernel` no longer exports `WorkerLogger`. The identical interface —
  `info(obj, msg)` / `warn(obj, msg)` / `error(obj, msg)` — is exported as `PlatformLogger`,
  from the file that documents and produces it. It is the type of `ModuleContext.log`, of
  `DefineModuleWorkerOptions.logger`, and of every `log` a module is handed or holds.

  ```ts
  // before
  import type { WorkerLogger } from '@endora-commerce/platform/kernel';
  class RefundHandler {
    constructor(private readonly log: WorkerLogger) {}
  }

  // after
  import type { PlatformLogger } from '@endora-commerce/platform/kernel';
  class RefundHandler {
    constructor(private readonly log: PlatformLogger) {}
  }
  ```

  The rename is the whole migration: the shape is byte-identical, so nothing but the imported
  name changes. A `type WorkerLogger = PlatformLogger` shim in your own code compiles, but it
  re-creates the second name this release exists to remove.

  Also removed: `ModuleLifecycleLogger` from `kernel/module-context.ts`, an alias of the same
  interface that no barrel published — a module could not name it, only meet it by hovering
  `ctx.log`. Nothing importable is lost.

  **Why it was a defect and not untidiness.** `@endora-commerce/contracts` exports a
  `ModuleLifecycleLogger` of its own, and it is a _different_ shape: the install/uninstall hook
  logger, `info(msg: string)`, one argument. The platform's alias claimed the same name for the
  two-argument shape. An author who read the published contracts package — the package whose job
  is to be the published shape — and wrote `ctx.log.info('…')` got `TS2554: Expected 2
arguments, but got 1`, with two names resolving and both of them ours.

  `@endora-commerce/contracts` keeps `ModuleLifecycleLogger` unchanged. Its name was the accurate
  one: it is the logger of `ModuleLifecycleContext` and of the two lifecycle-participant events,
  all called by the orchestrator, which tags the module id so the hook author writes plain
  messages. Its doc block now says what it is not.

- 13e12bd: `PimConnectorRegistryPort` names its container binding

  The interface carried no `Container name:` line, so nothing tied it to the
  `pimConnectorRegistryPort` registration `@endora-commerce/mod-pim-connector` makes. That
  name is the whole of the promise the port makes: `lazyPort<T>` is `new Proxy({} as T, …)`,
  so `T` is asserted and compared to nothing that is registered, and a consumer copying the
  owner's class registration instead would compile and receive the service with no
  `MODULE_DISABLED` gate on it. Documentation only — no type, no member and no runtime
  behaviour changes.

- 7f02d62: `CartReadPort`'s doc block no longer says the port has no consumer.

  No exported symbol changes. The block asserted that `orders`' basket read could
  not be served by this port and that the boundary question behind it was open;
  feature 080's T048 settles it by splitting the seam in two, so the sentence a
  consumer reads in their editor was describing a state of the tree that no longer
  exists. `orders`' storefront total preview is the consumer, named in the block.

  The transactional half — the basket read that belongs with the completion order
  placement performs — is `CartPlacementApplyPort`, and it is deliberately not in
  this package: both of its methods take a MikroORM `EntityManager`, which
  `packages/contracts` may not name because `admin` and `storefront` both compile
  it (FR-034). It lives on its owner's own `ports/` surface.

- 2c8635b: Fix UnoPim media downloads: a stored media path now resolves to `<baseUrl>/storage/<path>`, the address Laravel's public disk actually serves, instead of `<baseUrl>/media/<path>`, which answered 404 for every file. An absolute `http://` media address is also left as-is rather than being appended to the base URL.

  Allow local development instances to fetch UnoPim media over HTTP when the development-only environment override is enabled.

  Import UnoPim attribute and option labels per locale, split comma-separated multiselect values, and map boolean source values onto the auto-created yes/no options. `CatalogProductWritePort` now exposes `patchAttributeOption` so a later import can refresh option labels.

  The UnoPim import-run detail now includes the recorded per-record issues so the operator can see why a run finished with issues.

  Import now reads UnoPim 3 `GET /configurable-products` in addition to `GET /products`, and maps `super_attributes` / `variants` onto Endora configurable products. Previously only the simple-product list was walked, so configurable parents were created as simple products.
