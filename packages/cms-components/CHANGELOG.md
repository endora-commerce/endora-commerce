# @endora-commerce/cms-components

## 0.109.0

### Minor Changes

- 0e33ca9: Blog posts get a main image, a public list endpoint and a _Latest posts_ page-builder block.

  - `@endora-commerce/mod-blog` adds `blog_posts.main_image_asset_id` (migration `20261023T063013_blog_post_main_image`, nullable, foreign key to the asset library), editable in the post editor through the asset library picker. Deleting an asset a post uses as its main image is refused like any other referenced asset (reference kind `blog_post_main_image`).
  - `GET /api/v1/blog/posts?limit=&categorySlug=` returns the newest published posts of the request's sales channel as post cards (`limit` 1–24, default 6; an unknown category returns `[]`; a channel with the blog disabled returns `[]`). Cards carry the primary category's name for a chip.
  - `@endora-commerce/contracts`: `blogPostsListQuerySchema`, `blogPostsListResponseSchema`, `BLOG_POSTS_LIST_MAX_LIMIT`, `BLOG_POSTS_LIST_DEFAULT_LIMIT`; `mainImageAssetId` on `blogPostSummarySchema` (required, nullable) and on the create and patch request schemas (optional); optional `primaryCategoryName` on `blogPostCardSchema`; `blog_post_main_image` in `assetReferenceKindSchema`.
  - `blog.LatestPosts` (declared by `@endora-commerce/mod-blog`, rendered by `@endora-commerce/cms-components` as `LatestPosts` with the `CmsBlogPostCard` type): the newest posts as a carousel or a grid, optionally from one category, with a header and a read-more label. It is resolved on the server through the block-data seam, renders nothing for customers when there are no posts, and disappears from the editor and the storefront when the blog module is off.

- 0e33ca9: The page editor's preview of a product listing shows the same line under each product name as the storefront, and the option says what each line is.

  - `@endora-commerce/contracts` exports `productSummaryText(description)` and `PRODUCT_SUMMARY_MAX_LENGTH`, moved from `@endora-commerce/mod-catalog`, which re-exports them from the same module path. The rule is unchanged.
  - `@endora-commerce/mod-cms`' admin preview maps a product's description to its card `summary` through it (`mapAdminProductToCmsSummary`), in the language its name is picked in. The summary line, and a Showcase card's default line, were always empty in the editor.
  - `catalog.ProductGrid` and `catalog.ProductSlider` label `cardTextLine` **Text under the product name**, with **Card style default (SKU; summary on Showcase)**, **Short description (from the product description)**, **SKU** and **None**, in English and Polish. The stored values are unchanged.

- 0e33ca9: Products carry a short plain-text summary, and the product listing blocks gain a showcase card for marketing pages.

  - `@endora-commerce/mod-catalog` derives `summary` from the product description already on the row — markup stripped, entities decoded, at most 160 characters cut at a word boundary with `…`, in the request language with the same channel override as the product page — and returns it on the storefront product list and product reads; `null` when there is no description. No extra query per product. `@endora-commerce/contracts` adds the optional `summary` to `productSummarySchema`.
  - `catalog.ProductGrid` and `catalog.ProductSlider` (rendered by `@endora-commerce/cms-components`, declared by `@endora-commerce/mod-catalog`) keep every option and default they had and add a header (heading, lead, button), `cardVariant` (`default` or `showcase`), a card link label `ctaLabel` and a `footerButton`. The slider takes the Carousel's options; a stored slider keeps its look through `productSliderFromLegacy` (arrows over the edges, dots below, pixel gap). The new texts are translatable, and the field labels ship in English and Polish.
  - `CmsProductCardView` accepts `variant: 'showcase'`: image on a neutral backdrop, name, summary and a "more" link labelled by `ctaLabel`, without price or SKU. `CmsProductSummary` gains the optional `summary`; `PRODUCT_CARD_VARIANTS` and the shared listing fields are exported from `components/catalog/product-listing-parts`.

- 0e33ca9: Brand tokens for page-builder content: one set of colours, colour schemes, fonts, a type scale, button sizes, spacing and layout widths that every block reads, set globally and optionally overridden per sales channel.

  - `@endora-commerce/contracts` exports the token shape and its rules: `cmsBrandTokensSchema` / `CmsBrandTokens`, `DEFAULT_BRAND_TOKENS`, `BRAND_TYPE_TOKENS`, `BRAND_SPACE_TOKENS`, `BRAND_SCHEMES`, `brandFontSourceSchema` (system, library asset or `https:` stylesheet), the contrast helpers `assessBrandContrast`, `contrastRatio`, `relativeLuminance`, `CONTRAST_REQUIRED_BODY` / `CONTRAST_REQUIRED_LARGE`, and the HTTP shapes `putCmsBrandTokensRequestSchema`, `putCmsBrandTokensResponseSchema`, `cmsBrandTokensAdminReadSchema`, `cmsBrandTokensStorefrontResponseSchema`. `CMS_STOREFRONT_CACHE_TAGS.brand` (`cms:brand`) is the storefront cache tag a save revalidates.
  - `@endora-commerce/mod-cms` stores the tokens in a new `cms_brand_tokens` table (migration `20261022T163218_cms_brand_tokens`), serves `GET`/`PUT /api/v1/admin/cms/brand-tokens` (read with `cms.read`, write with the new permission `cms.brand`; optimistic version check, audited, a stale write is `409`) and `GET /api/v1/storefront/cms/brand-tokens` (answers on a closed sales channel too). The page-builder descriptor carries the effective `brandTokens` and accepts `?salesChannelId=`. The Admin UI adds a _Brand_ screen at `/cms/brand` with live preview and contrast warnings (saving is never blocked by them), reachable from the content navigation and the command palette (`open-cms-brand`); the page editor's preview applies the page's channel tokens.
  - `@endora-commerce/cms-components` exports `brandTokensToCss` (also at `@endora-commerce/cms-components/brand/brand-css`), which renders the tokens as `--cmsb-*` custom properties plus font links. Every block style that reads a `--cmsb-*` variable keeps the previous literal as its fallback, so a storefront that never emits the variables renders exactly as before.
  - `@endora-commerce/page-builder-core` re-exports the token types from its barrel and the values from the new `@endora-commerce/page-builder-core/brand-tokens` subpath. Colour fields may store a brand role as `token:<role>`: `BRAND_COLOR_ROLES`, `brandColorRole`, `brandColorFallback` and `resolveColorValue` (`token:primary` → `var(--cmsb-color-primary, <default>)`); the palette context gains an opt-in `brandRoles` flag, and `backgroundToStyle` resolves tokens.
  - `@endora-commerce/page-builder-admin`: `PageBuilderColorPaletteProvider` takes an optional `brandColors`; when set, the palette lists the brand colours first and a pick stores the role token. Leave it unset where content is rendered without the brand stylesheet, such as e-mail.
  - `@endora-commerce/mod-settings` lists the `cms-brand` cache namespace on the cache screen; `@endora-commerce/mod-i18n` adds the `pageBuilder.colorPalette.*` labels (English and Polish).

- 0e33ca9: `cms.ContentSlider` becomes the _Carousel_, with four item blocks, and **`cms.ImageSlider` is removed.**

  The Carousel keeps every option it had and adds a header (heading, lead, button), slides per view per breakpoint (1–8, fractions show the next slide), a gap token or custom pixels, a `fade` effect, controls placement (`overlay`, `below`, `header`), bleed to the viewport edge, an autoplay that is off by default, pauses on hover and focus and never runs under reduced motion. A stored slider maps through `contentSliderFromLegacy`: its arrows stay over the edges and its dots below, exactly as before. Its slides accept the new item blocks `cms.CarouselImage`, `cms.CarouselSplit` (media beside text and up to two buttons), `cms.LinkTile` and `cms.DownloadTile` (one download link with a file-type badge; renders nothing for customers when its asset is gone).

  `CarouselShell` (`@endora-commerce/cms-components/components/carousel/CarouselShell`) is rewritten for accessibility and layout stability: a named `region`, slides as numbered groups, arrows as named buttons with `aria-controls`, dots with `aria-current`, controls hidden when everything fits, and slide widths in CSS so server and client render the same markup. Its props are a superset of the old ones (`effect`, `controlsPlacement`, `bleed`, `header`, `label`, `labels`, responsive `slidesPerView` and `gap`); `CarouselSlides` is new. The carousel's accessible names follow the page language through `CmsRenderProvider`'s new `carouselLabels`. `@endora-commerce/page-builder-core` exports `CAROUSEL_SLIDE_TYPES` (from `./editor` and `./editor/puck-guards`), which lets the item blocks into a carousel's slides; `@endora-commerce/page-builder-admin` exports `createFileAssetField` for the download tile.

  **Breaking — `cms.ImageSlider` is gone.** The block is no longer declared or rendered, and these exports of `@endora-commerce/cms-components` are removed: `ImageSlider`, `imageSliderTitleStyle`, the `components/image-slider-item` subpath (`normalizeImageSliderItem`, `syncImageSliderItemImage`) and the types `ImageSliderProps`, `ImageSliderItem` and `ImageSliderTitlePlacement`. A page that still stores a `cms.ImageSlider` node keeps that node untouched in storage, but the storefront renders nothing for it (the rest of the page renders as before). To rebuild one, add a Carousel and one `cms.CarouselImage` per slide — every image-slider item option has a counterpart, and `carouselImageFromImageSliderItem(item)` performs the mapping for code that converts stored content:

  ```ts
  // before
  { type: 'cms.ImageSlider', props: { items: [item, …], slidesPerView, showArrows, … } }
  // after
  { type: 'cms.ContentSlider', props: { slides: items.map((item) => ({ type: 'cms.CarouselImage', props: { id: newId(), ...carouselImageFromImageSliderItem(item) } })), … } }
  ```

- 0e33ca9: The Carousel gains arrow placement per breakpoint, an arrow look, a grid layout and a category filter; carousel images gain a caption scrim, link tiles a ratio per breakpoint, and `cms.Tabs` a tab bar look.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Arrow placement per breakpoint.** `controlsPlacement` (`'below' | 'header' | 'overlay'`, or one per breakpoint) is a top-level, responsive prop on the Responsive tab of the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`. It replaces the `placement` key inside `controls`. A placement stored there is still honoured, and the editor's `resolveData` moves it to `controlsPlacement` (`carouselPlacementMoved` in `carousel/carousel-parts`). For a stored slider, `contentSliderFromLegacy` now also writes `controlsPlacement`. `CarouselShell`'s `controlsPlacement` prop accepts a responsive value. Each placement in use is rendered once, and the stylesheet removes it where it does not apply (`cmsc-pb-carousel__controls--off-sm|md|lg`).
  - **Arrow look.** `controls.arrowVariant` (`default | outline | solid`), `arrowShape` (`round | square`), `arrowSize` (`s | m | l`, 32/36/44 px) and `arrowColor` (a brand token or a hex). They map to the `CarouselShell` props of the same names, rendered as root classes and `--pb-arrow-color`.
  - **Grid layout.** On the Carousel, `layout: 'carousel' | 'grid'` and `columns` (1–6, responsive). `CarouselShell` takes `layout` and `columns`: the grid is a list of items in `--pb-cols(-md|-lg)` columns, with no controls and no autoplay. In the editor, the action bar has no page navigation for a grid.
  - **Filter.** The Carousel's `filter` prop is `{show, allLabel, tags: [{tag, label}]}`. Every item block and `cms.Slide` take `tags` (comma-separated keys), written as `data-pb-tags`. The new `carousel/carousel-filter` module exports `parseItemTags`, `itemTagsAttribute`, `ITEM_TAGS_FIELD`, `carouselFilterFromProps` and `CarouselFilterBar`, and `CarouselShell` takes a `filter` prop. The bar is a `toolbar` of `aria-pressed` buttons with a single tab stop and a polite count. Filtering hides items in the browser only, so every item stays in the server HTML. `filter.allLabel` and `filter.tags[].label` are declared translatable. `CmsCarouselLabelText` gains `filter`, `filterAll` and `filterCount`.
  - **Caption scrim.** `cms.CarouselImage` gains `captionScrim: {kind: 'none' | 'gradient' | 'solid', strength}`, for captions placed over the image.
  - **Link tile ratio.** `cms.LinkTile.ratio` may differ per breakpoint, and is listed in the block's `responsiveFields`.
  - **Tab bar look.** `cms.Tabs` gains `tabStyle: {size, barBackground, barBorderColor, activeBackground, activeColor, inactiveBackground, inactiveColor}`. The colours are written as `--cmsc-tabs-*` custom properties, which fall back to today's colours. A bar background or border draws the bar, as a capsule around pills. On a narrow screen the tabs still wrap.
  - **`BoxStyled`** takes an `attributes` prop for `data-*` attributes.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels. The `controls.fields.placement` keys are replaced by `controlsPlacement`.

- 0e33ca9: The catalogue-only block-data seam is generalised to every block that reads server data, so `blog.LatestPosts` resolves on the server through the same path as the catalogue blocks.

  New names, in `@endora-commerce/cms-components/utils/block-data`: `BlockDataRequest` (now also `{ kind: 'blog-posts', … }`), `BlockData`, `BlockDataSource` (gains the optional `fetchBlogPosts` and `isModulePresent`; a request whose owning module is absent is skipped and never asked), `blockDataOwnerOf`, `blockDataRequestOf`, `blockDataKey`, `collectBlockDataRequests`, `resolveBlockData`, `BLOCK_DATA_CONCURRENCY`, `blogPostsDataRequest`. The hook is `useBlockData` in `@endora-commerce/cms-components/hooks/use-block-data`, the context reader `useProvidedBlockData` in `@endora-commerce/cms-components/components/catalog-preview-context`, and `CatalogPreviewApi` gains the optional `fetchBlogPosts`.

  **Deprecated, still working:** `@endora-commerce/cms-components/utils/catalog-block-data` re-exports the new names under the old ones (`CatalogBlockDataRequest`, `CatalogBlockData`, `CatalogBlockDataSource`, `catalogBlockDataRequestOf`, `catalogBlockDataKey`, `collectCatalogBlockDataRequests`, `resolveCatalogBlockData`, `CATALOG_BLOCK_DATA_CONCURRENCY`, and the unchanged request builders), so a storefront that imports it keeps compiling. Move to `utils/block-data`; the subpath will be removed in a later release.

  **Breaking — removed without a shim:**

  - `@endora-commerce/cms-components/hooks/use-catalog-block-data` (`useCatalogBlockData`, `CatalogBlockDataState`): import `useBlockData` / `BlockDataState` from `@endora-commerce/cms-components/hooks/use-block-data` (same call shape).
  - From `components/catalog-preview-context`: `useProvidedCatalogBlockData()` → `useProvidedBlockData()`, and the type re-exports `CatalogBlockData`, `CatalogBlockDataRequest`, `CatalogBlockDataSource` → `BlockData`, `BlockDataRequest`, `BlockDataSource`.

  The `CatalogBlockData` value type widens to include blog post cards; a consumer that narrows it by request kind is unaffected.

- 0e33ca9: Restrained motion for page-builder sections, off by default. A `cms.Section` can fade up as it scrolls into view, and `cms.Hero` and `cms.Statement` can reveal their statement word by word (`reveal: { effect: 'none' | 'fade-up' | 'words', desktopOnly }`). `cms.LinkTile` and `cms.CarouselSplit` gain an optional `hoverZoom` on their image. Nothing moves under `prefers-reduced-motion`, in the editor canvas or without `IntersectionObserver`, and content already on screen when the page loads is shown as is, so the largest paint is never delayed.

  `@endora-commerce/cms-components` exports `useReveal`, `RevealValue`, `splitWords`, `countWords`, `splitHtmlWords` and `WORD_CLASS`; `InlineRich` accepts `wordStart`. `@endora-commerce/mod-cms` adds the field labels in English and Polish.

- 0e33ca9: New page-builder blocks for marketing pages, and ready-made sections in the editor.

  - `cms.MediaText` — rows of image or video beside a heading, rich text and buttons, with the split ratio, side, mobile order and vertical alignment per row.
  - `cms.BackgroundPanel` — content over a full-width, art-directed background image with an icon, heading, text and buttons; minimum height per breakpoint.
  - `cms.CtaCard` — a call-to-action card with an optional image side and decorative backdrop.
  - `cms.Statement` — a large statement heading and body, optionally full-bleed when it carries an image.
  - `cms.LinkList` — up to 50 rows of a title, a description and a button, with dividers.

  Each is exported from `@endora-commerce/cms-components` (`MediaText`, `BackgroundPanel`, `CtaCard`, `Statement`, `LinkList`, with their props types). `@endora-commerce/mod-cms` declares them, their translatable fields and their English and Polish labels.

  The page editor of `@endora-commerce/mod-cms` adds a _Ready-made sections_ group above the block list: a hero, media with text, a call-to-action card, a downloads carousel, a feature grid and a statement, each one `cms.Section` holding its block, inserted after the selected block's top-level Section (or at the end of the page). The preset trees are `SECTION_PRESETS` in `@endora-commerce/cms-components/editor/section-presets`.

- 0e33ca9: `cms.Heading`, `cms.Button`, `cms.Hero`, `cms.FeatureList`, `cms.Stats` and `cms.Testimonial` are reshaped onto the shared block props and brand tokens. Every option they had is kept; the new ones are added beside it.

  **Stored content keeps rendering as before.** Each reshaped block maps a document saved in its old shape at render time and again, once, when the editor opens it: `headingFromLegacy`, `buttonFromLegacy`, `heroFromLegacy`, `featureListFromLegacy`, `statsFromLegacy` and `testimonialFromLegacy` are exported from `@endora-commerce/cms-components`. No migration rewrites stored pages, and the translation declarations keep the old paths, so an unopened page stays translatable.

  - `cms.Heading`: `text` is `InlineRichText` (a stored string is read as text), `level` h1–h6 or `p`, a `size` from the brand type scale or a custom size per breakpoint, `align`, a colour token, and an advanced group for font, weight, style and line height. Text is edited on the canvas again, through `INLINE_RICH_TEXT_FIELD_TRANSFORMS` (`@endora-commerce/cms-components/editor/inline-rich-text-canvas`), which the host passes to Puck's `fieldTransforms`.
  - `cms.Button`: one `button: ButtonSpec` (style, fill and size per breakpoint, icon) plus `align`.
  - `cms.Hero`: eyebrow, rich title, subheading, statement and body, up to six buttons, image or video media (background or above the content, per breakpoint), overlay, minimum height, gaps and social proof. Only the hero that leads the page — its first top-level block, or the first block of a first top-level `cms.Section` — loads its image eagerly with high fetch priority.
  - `cms.FeatureList`, `cms.Stats`, `cms.Testimonial`: rich item bodies, custom gap and size values, an avatar as a `ResponsiveImage`; columns are CSS custom properties per breakpoint instead of a client-side breakpoint switch.
  - `@endora-commerce/page-builder-admin`: `createButtonListField({ responsive })` stores per-breakpoint style and fill.

  Behaviour changes to note:

  - A stored video hero no longer autoplays unconditionally: videos start only when on screen, never under reduced motion, and use `preload="none"` with the poster.
  - A stored heading's `fontWeight` and `lineHeight` now apply even without a custom `fontSize` (they were ignored before).
  - A stored URL button whose URL is unsafe (`javascript:` or protocol-relative) renders without a link.
  - The exported props types `HeadingProps`, `ButtonProps`, `HeroProps`, `FeatureListProps`, `StatsProps` and `TestimonialProps` changed shape. Fields of the old shape remain as optional members (marked `@deprecated` where a new field replaces them); code that reads them may need a change — for example `HeadingProps.text` is now `InlineRichText | string`, read it with `inlineRichTextToPlain(text)`.

- 0e33ca9: `cms.Tabs` and `cms.Accordion` panels hold blocks, and the rich-text block gains anchors, a check list, a read-more toggle and button-styled links.

  **Tabs and Accordion — panel content moved to `items[].panel`.** Each item's panel is now a slot of blocks at `items[].panel` (any block except `cms.Column`, `cms.Tabs` and `cms.Accordion`) instead of the HTML string at `items[].content`. Stored content is not rewritten: an item that still holds `items[].content` renders that HTML, sanitised as before, and the editor moves it into the slot as one `cms.RichContent` block the first time the page is opened (`tabsFromLegacy`, `accordionFromLegacy`). The translation declaration keeps `items[].content`, so unopened pages stay translatable; blocks in a panel translate through their own declarations. Code that writes page documents should write `items: [{ title, panel: [{ type: 'cms.RichContent', props: { id, … } }] }]` rather than `items: [{ title, content: '<p>…</p>' }]`; the exported `TabItem` and `AccordionItem` types now extend `PanelItem`.

  Both blocks are now fully accessible: unique ids per instance, `aria-controls`, every panel rendered on the server (hidden ones with `hidden`), arrow, Home and End keys on the tab list with roving focus. `cms.Tabs` adds `effect: 'none' | 'fade'`; `cms.Accordion`'s `defaultOpen` also accepts a list of indexes. The page-builder outline in `@endora-commerce/page-builder-core` lists blocks inside a panel.

  **Rich text** (`cms.RichContent` and the TipTap extensions in `@endora-commerce/cms-components`): headings may carry an anchor (`id`, normalised to the section-anchor pattern) and be visually hidden; bullet lists may be check lists; a read-more block renders as `<details class="cmsc-read-more"><summary>`; a link may render as a button (`cmsc-btn` style and fill); and text may carry the `emphasisMark`. New exports: `emphasisMark`, `readMoreNode`, `readMoreSummaryNode`, `readMoreContent`, `richContentAttributes`, `BUTTON_LINK_VARIANTS`. The sanitiser now keeps `details`, `summary` and `open`, and an `id` on `h1`–`h6` only when it matches the anchor pattern; everything it dropped before it still drops. No new TipTap package is required.

  **Rich text renders on the server.** `htmlFromTiptap` (and `resolveRichContentHtml`, `coerceRichContentProps`, every block's rich body) no longer goes through TipTap's `generateHTML`, which needs a DOM and returned `''` on the server: a DOM-free serializer walks the same schema and node and mark `renderHTML` specs, so a body stored only as TipTap JSON is in the server HTML and hydrates without a mismatch. The output passes through the same sanitiser; a colour stays in the notation it was stored in (a browser's DOM used to rewrite it as `rgb()`). `cms.RichContent` now takes its text, heading, link and quote colours from the section's colour scheme and its body size, line height and heading font from the brand tokens, each with its previous literal as the fallback (`.cmsc-pb-rich-content`); the body text of the new blocks uses the brand body font and a heading inside a rich body the brand heading font (with no brand tokens both inherit the page's font, as before); an image inside a rich body never grows wider than its column; and the `cms.Tabs` tab list wraps instead of running past a narrow screen.

- 0e33ca9: A newsletter signup block that subscribes through the platform's own newsletter module.

  - `newsletter.Signup` is declared by `@endora-commerce/mod-newsletter` (category _Forms_, English and Polish labels, 14 translatable texts) and rendered by `@endora-commerce/cms-components` (exported as `Signup`, with `NEWSLETTER_SUBSCRIBE_PATH` and `NEWSLETTER_SIGNUP_MAX_TOPICS`). It has a heading, text, e-mail label and placeholder, button label, up to 12 topics mapped to newsletter tag codes (optionally required), a consent text, a layout and translatable outcome messages. The form posts to the storefront path `/newsletter/subscribe`, works without JavaScript (the outcome is read back from the page URL, and the visitor lands back on the anchor of the `cms.Section` the block stands in) and, with JavaScript, submits in place and keeps the typed address. Subscriptions are recorded with `source: 'cms-block'`, the consent time and the chosen tags. The block disappears from the editor and the storefront when the newsletter module is off.
  - **A storefront must provide the `/newsletter/subscribe` route handler** for the block to work; the reference storefront ships one. To show the outcome without JavaScript, pass `location` (`{ path, query }`) to `CmsRenderProvider`; blocks read it with the new `useCmsRenderLocation()`.
  - `cms.NewsletterSignup` is kept unchanged for forms that post to an external newsletter service, and is relabelled **"External newsletter form"** in the block list. It adds an optional consent checkbox (`showConsent`, off by default, with an inline rich-text `consentLabel`); stored forms render as before.

- 0e33ca9: An accordion's title weight can differ per breakpoint, and the space below an open panel and after an open item can be set.

  Nothing changes for content that does not use them: the default markup and look are the ones the block had.

  - **Title weight per breakpoint.** `cms.Accordion`'s `titleWeight` accepts a value per breakpoint as well as one weight, on the Responsive tab. A single stored weight renders as before (an inline weight on every title). Weights that differ write `--cmsc-acc-title-weight` / `-md` / `-lg` on the root with the class `cmsc-pb-accordion--title-weight`; a breakpoint without a weight of its own keeps the usual weight.
  - **Space below an open panel.** `panelPaddingBottom` / `panelPaddingBottomPx`: a spacing token or a Custom px per breakpoint for the space under an open panel's content (12 px when unset). It opens and closes with the panel.
  - **Space after an open item.** `openItemGap` / `openItemGapPx`: a spacing token or a Custom px per breakpoint, used instead of the item gap after an item whose panel is open (a breakpoint left unset uses the item gap). It follows the panel's animation.
  - **Labels.** The new fields are labelled in English and Polish.

- 0e33ca9: Alignment, gaps and text weights are set per breakpoint, beside each other on the Responsive tab, in every block that has them.

  Nothing changes for a stored page: a value stored as one alignment, one gap or one weight applies at every width and renders as before.

  - **Alignment** of `cms.Icons`, `cms.Social`, `cms.LogoStrip`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, `cms.Hero` and `cms.Tabs` is per breakpoint and reads **Left / Center / Right** (the tabs' third is **Stretch**). Alignments that differ write `data-align-md` / `data-align-lg` (and the classes the stylesheet reads); one alignment keeps today's markup.
  - **Gaps** of `cms.Social`, `cms.LogoStrip`, `catalog.ProductGrid` and `catalog.CategoryGrid` are a spacing step or **Custom gap (px)**, per breakpoint. A gap stored as a number reads as Custom with that number (`numericGapAsCustom`, carried by `resolveData`); gaps that differ go on `cmsc-pb-gap-tiers`. The grids' **Equal items height** is per breakpoint too, next to the columns and the view.
  - **Weights** — every block heading's, the feature list's and the hero's title weight and the media-and-text item title weight — are per breakpoint, right after the size. Weights that differ wrap the text in one `cmsc-pb-item-weight` span (`responsiveWeightProps`, `WeightSpan`); one weight stays the inline `font-weight`.
  - The registry's and the manifests' `responsiveFields` list the new responsive props.

- 0e33ca9: The dark scheme's decorative backdrop can be given as a URL, `cms.Tabs` can keep its tab bar in one scrolling line, and a `cms.Column` can distribute its blocks vertically and reorder them per breakpoint.

  Nothing changes for a page that does not use them: the default markup and look are the ones the blocks had.

  - **Backdrop by URL.** The brand tokens' schemes gain an optional `decorativeUrl`, validated by the new `brandMediaUrlSchema` and `BRAND_MEDIA_URL_RE` in `@endora-commerce/contracts`. It accepts an `https:` URL, or a path starting with `/`, of up to 2048 characters, with no quotes, parentheses, backslashes, angle brackets or whitespace. The library asset (`decorativeAssetId`) wins when both are set. `brandTokensToCss` takes a new `mediaUrl` option, which rebases a `/path` (the storefront and the admin pass their API origin). It checks the stored value again and writes it as an escaped CSS string. The brand screen has a **Decorative backdrop URL** field under the dark scheme's asset picker. `@endora-commerce/page-builder-core/brand-tokens` re-exports `BRAND_MEDIA_URL_RE`.
  - **Scrolling tab bar.** `cms.Tabs` gains `barOverflow: 'wrap' | 'scroll'`. Unset, it wraps as before. `scroll` adds `cmsc-pb-tabs--scroll` and keeps the bar in one line that scrolls sideways inside the block, with scroll snapping and no page overflow. The roles and the keyboard model are unchanged. A tab chosen with the pointer is scrolled into the bar's view. The tab focus ring (`.cmsc-pb-tabs__tab:focus-visible`), lost in an earlier stylesheet edit, is restored.
  - **Column distribution.** `cms.Column` gains `distribute`: `'start'` (the default), `'center'`, `'end'`, `'space-between'` or `'last-to-bottom'`. It is written as `data-pb-distribute`. The column's published block slot now carries the class `cmsc-pb-column-stack`.
  - **Block order per breakpoint.** `withHideOn` offers `stackOrder`: `'auto'`, `'first'`, `'1'`–`'6'` or `'last'`, one value per breakpoint, on the Responsive tab. The field appears only when the block's parent is in the new `BLOCK_ORDER_PARENTS` export (`['cms.Column']`), through a `resolveFields` it now adds to every wrapped block, so no block's static fields change. The value is written on the wrapper as `data-pb-order` and `--pb-order(-md|-lg)`, and the stylesheet reads it as the CSS `order`. Only the visual order changes: the DOM and focus order stay the stored order. `STACK_ORDER_VALUES` and the `StackOrder` type are exported.

  The `cms`, `catalog`, `blog` and `newsletter` bundles carry the English and Polish labels.

- 0e33ca9: Product cards in listings can take an image box colour and a divider, a rich-text "read more" can open with a bare chevron, and buttons can span the full width per breakpoint.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Card image box and divider.** `catalog.ProductGrid` and `catalog.ProductSlider` gain `cardImageBackground` (a brand colour token or a hex value), `cardDivider` (`'none' | 'line'`) and `cardDividerColor`, which is shown only for a line. A colour is written as the image box's inline background. A line adds `cmsc-pb-product-card--divider`, a 1 px bottom border in the chosen colour or the neutral border colour; a showcase card also gets 16 px of padding above the line.
  - **Read more as a chevron.** The rich-text `readMore` node gains `summaryStyle` (`'text' | 'chevron'`, `'text'` by default). `chevron` adds the class `cmsc-read-more--chevron` to the `<details>`, the same through the DOM-free serializer and TipTap's, and is parsed back from it. The sanitiser is unchanged. The stylesheet turns the summary into a 44 px chevron control: its text stays as the accessible name, out of view. The rich-text toolbar gains **Read more as a chevron**.
  - **Full-width buttons per breakpoint.** `cms.Button` gains `fullWidth` (`'auto' | 'full'`, or one per breakpoint), a top-level prop on the Responsive tab. `cms.Hero`, `cms.MediaText`, `cms.CtaCard`, `cms.BackgroundPanel` and `cms.CarouselSplit` gain the block-level `buttonsFullWidth`, which stacks their buttons at the full width; `ButtonSpec` is unchanged. Both are listed in `responsiveFields`. The phone's width writes `cmsc-btn--full` on a button or `cmsc-btn-list--full` on a list; a larger breakpoint whose width differs adds a `--md-*` or `--lg-*` class.

  The `cms` and `catalog` bundles carry the English and Polish field labels.

- 0e33ca9: Carousels can stop at their ends instead of wrapping around, carousel image captions and link tile texts can change colour on hover, and a responsive value saved without a mobile value now applies from the breakpoint that has one.

  Nothing changes for a block that does not use the new options: no option is in any `defaultProps`, and the default markup and look are the ones the blocks had.

  - **Carousel ends.** `loop` (`boolean`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. Unset or `true` keeps today's wrap-around: the previous arrow on the first page goes to the last page, and the next arrow on the last page back to the first. With `false`, `CarouselShell` stops at the first and last page. The arrow at an end gets the native `disabled` attribute and keeps its name, so a screen reader announces it as unavailable. On the first page the previous arrow is already disabled in the server HTML. The arrows follow the scroll position. An arrow disabled while it has focus passes the focus to the other arrow. Autoplay stops on the last page.
  - **Disabled arrow look.** `controls.disabledArrowLook` (`'dim' | 'outline-light' | 'color'`) and `controls.disabledArrowColor` (a brand colour token or a hex value). `dim` is the default (`opacity: 0.4`). The other two looks set the root class `cmsc-pb-carousel--arrow-off-light` or `--arrow-off-color` (with `--pb-arrow-off-color`), and only a carousel that does not loop gets one.
  - **Hover colours.** `cms.CarouselImage.captionHoverColor` and `cms.LinkTile.titleHoverColor` / `labelHoverColor` take a brand colour token or a hex value. The colour applies on hover and on keyboard focus, with a 0.2 s colour transition, or none under reduced motion. Only an item given a colour gets the class (`cmsc-pb-carousel-image--hover-caption`, `cmsc-pb-link-tile--hover-title`, `--hover-label`) and the custom property.
  - **Responsive values without `base`.** `isResponsiveProp` now also accepts an object that holds only `tablet` and/or `desktop`. `normalizeResponsive` gives such a value the caller's fallback as its base, so the breakpoints below the first one with a value render as unset. Before, the whole value was read as unset. The editor's scoped field readers, `ResponsiveRatioControl` and the hand-rolled readers in `cms.Button`, block alignment and `cms.FeatureList` read it the same way. An object with any other key is still a plain value.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.

- 0e33ca9: The Carousel's filter bar gains an underlined-tabs style and an alignment, the controls below a carousel gain an alignment per breakpoint and the next arrow a style of its own, and carousel images and link tiles gain a text size and font, with a label style for link tiles.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Filter bar style and alignment.** The Carousel's `filter` gains `style: 'pills' | 'underline'` and `align: 'start' | 'center' | 'end'`. `carouselFilterFromProps` passes both through, `CarouselFilterBar` takes `variant` and `align`, and the new `filterBarClassName` writes `cmsc-pb-carousel__filter--underline` and `--align-center|end`. Both looks are the same `toolbar` of `aria-pressed` buttons with a single tab stop.
  - **Controls alignment.** `controlsAlign` (`'center' | 'start' | 'end' | 'between' | 'split'`, or one per breakpoint) is a top-level, responsive prop on the Responsive tab of the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. `CarouselShell` takes `controlsAlign` and writes root classes `cmsc-pb-carousel--ctl-<value>` and `--ctl-md|lg-<value>` only where the value changes. `split` puts the previous and next arrows at the two ends of the row with the dots centred between them. The DOM order of the controls does not change.
  - **The next arrow's own style.** `controls.nextArrowVariant` (`'same' | 'default' | 'outline' | 'solid'`) maps to `CarouselShell`'s `nextArrowVariant`, a root class `cmsc-pb-carousel--next-arrow-<variant>`. Both arrows keep their markup; shape, size and colour stay shared.
  - **Carousel caption typography.** `cms.CarouselImage` gains `captionSize` and `captionSizePx` (a type token or Custom px, per breakpoint, on the Responsive tab) and `captionFont` (`'default' | 'heading' | 'body'`). A chosen size or font wraps the caption's text in `cmsc-pb-carousel-image__caption-text`.
  - **Link tile typography and label style.** `cms.LinkTile` gains `titleSize`/`titleSizePx`/`titleFont`, `labelSize`/`labelSizePx`/`labelFont` and `labelStyle` (`'link' | 'button' | 'none'`). A button label is a `span` carrying the primary button's classes (`cmsc-pb-link-tile__button`) inside the tile's single link.
  - **Shared helper.** The new `components/item-text` module exports `ItemText`, `itemFontField` and `itemFontFamily`.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.

- 0e33ca9: A `cms.Column` can span rows of its Row's grid and start at a given column or row track, per breakpoint.

  Nothing changes for a page that does not use it: an unplaced column keeps its markup byte for byte, and its Row keeps its layout.

  - **Fields.** `cms.Column` gains three fields on the Responsive tab, all unset by default:
    - `rowSpan` (**Height in rows**, 1–4);
    - `columnStart` (**Start at column**, `'auto'` or `'1'`–`'12'`);
    - `rowStart` (**Start at row**, `'auto'` or `'1'`–`'4'`).
  - **Markup.** A placed column's published cell writes `data-pb-place` and `--pb-col-start(-md|-lg)`, `--pb-row-start(-md|-lg)` and `--pb-row-span(-md|-lg)` beside its span variables. A missing breakpoint takes the one below it. A start that would run past the twelfth track at that breakpoint's width is moved left so the column fits.
  - **Stylesheet.** The stylesheet places the cell per breakpoint. A Row holding a placed column packs its grid densely (`grid-auto-flow: row dense`, through `:has()`), so a column given only a start column takes the first free row of that track.
  - **Example.** A side column with an item at its bottom next to two tall columns on desktop can stack in the stored order on a phone without duplicating content.
  - **Visual only.** The DOM, reading and focus order stay the stored order. The editor canvas keeps the stored order and the span only. `cms.Row` is unchanged.

  The `cms` bundle carries the English and Polish labels.

- 0e33ca9: A `cms.Column` can take another place in its Row per breakpoint, `cms.MediaText` item titles take a size and a weight, the carousel's filter bar can stay in one scrolling line, and a video's mobile version can have its own poster.

  Nothing changes for a page that does not use them: the default markup and look are the ones the blocks had.

  - **Column order per breakpoint.** `cms.Column` gains `stackOrder`, labelled **Order in the row**: `'auto'`, `'first'`, `'1'`–`'6'` or `'last'`, one value per breakpoint, on the Responsive tab. It is the vocabulary a block in a column already has. The published column cell writes it as `data-pb-order` and `--pb-order(-md|-lg)`, which the existing order rule reads as the CSS `order` of the Row's grid item. Only the visual order changes: the DOM, reading and focus order stay the stored order. The editor canvas keeps the stored order. `cms.Row` is unchanged. `@endora-commerce/page-builder-core` exports `createStackOrderField(label)` and `stackOrderAttributes(value)`, which `withHideOn` now uses too.
  - **Item titles in media and text.** `cms.MediaText` gains `featureTitleSize` (Default, a type-scale size or Custom px, per breakpoint), `featureTitleSizePx` and `featureTitleWeight` (Default or 300–800), applied to the item titles of every row. Unset, the titles keep their 16 px semibold look and markup. A choice wraps the title text in `span.cmsc-pb-media-text__feature-title-text`.
  - **Scrolling filter bar.** The carousel's `filter` gains `overflow: 'wrap' | 'scroll'`. Unset, the bar wraps as before. `scroll` adds `cmsc-pb-carousel__filter--scroll`: one line that scrolls sideways inside the block, with scroll snapping and no page overflow. The toolbar, its pressed state and its keys are unchanged. A button pressed with the pointer is scrolled into the bar's view.
  - **Mobile poster.** `cms.Video` (file source) and the video media of `cms.Hero` and `cms.MediaText` (and `cms.CarouselSplit`, which shares it) gain `mobilePosterAssetId` and `mobilePosterUrl`. The library image wins over the URL, and a relative URL is made absolute against the media origin. The mobile video takes it. One video with its own mobile poster renders the same file once per breakpoint, each with `preload="none"`. The admin's hero and media-and-text controls and the video's fields offer a library picker and a URL input.

  The `cms` bundle carries the English and Polish labels.

- 0e33ca9: More layout and typography choices on existing page-builder blocks; with none of them chosen, every block renders as before.

  - `cms.Hero` gains `order`, a list of its elements (eyebrow, title, subheading, statement, text, buttons, social proof) rendered in that order, with the unlisted ones following in the default order, and `mediaWidth: 'content' | 'viewport'`, which lets image or video media reach the window's edges while the texts stay in the hero. Buttons or the social proof placed before another element keep a 20 px space below them.
  - `cms.Accordion` gains `titleLevel` (`none`, `h2`–`h6`: the trigger button inside that heading) and `titleSize` / `titleSizePx` (a type-scale token or Custom px, per breakpoint). Unset, the triggers are bare buttons with today's title.
  - `cms.Text`, `cms.Statement` and `cms.RichContent` gain `textMaxWidth` / `textMaxWidthPx`: a narrow, medium or wide measure or a Custom px per breakpoint, which follows the text's alignment. Unset, the text spans its column.
  - `catalog.ProductGrid` and `catalog.ProductSlider` gain `cardTextLine` (`default`, `summary`, `sku`, `none`), the one line under each card's name; `default` keeps the card style's own (the SKU, or the summary on the showcase card). `CmsProductCardView` accepts `textLine`.
  - The dark scheme's decorative backdrop is documented and tested as an animated SVG: each Section paints its own copy, and reduced motion is the SVG's own media query.

  `@endora-commerce/mod-cms` and `@endora-commerce/mod-catalog` add the field labels in English and Polish; in the page editor, a list whose item is a single choice is summarised by that choice's translated label.

- 0e33ca9: `cms.Hero`'s overlay shows only the settings its type uses, and the order of the hero's elements and the space after each are one list.

  - **Overlay.** Labelled **Overlay (darkens the background media)**; with **Type: None** it shows nothing else, **Solid** adds the strength and **Gradient** the direction and the strength (`resolveFields`, one field object per type so the editor keeps its focus). The stored `overlay` is unchanged.
  - **Type, not Kind.** The media select of `cms.Hero` and `cms.MediaText` and the overlay select of `cms.Hero` and `cms.Image` are labelled **Type** (**Media type**), in English and Polish.
  - **Elements: order and spacing.** An item of `order` takes `space` (a spacing token, `custom` with `spacePx`, or `default`) and `spacePx`: the space below its element, written as `spaceAfter` wrote it. `spaceAfter` leaves the panel and is deprecated: a stored list is still read for an element whose item has no space, so a stored page renders as it did, and the editor's `resolveData` carries it into `order` once — the full effective order, so nothing moves. `@endora-commerce/cms-components` exports `heroElementSpaces(order, spaceAfter)` and `carrySpaceAfterIntoOrder(props)`; `HeroOrderItem` is the item's type.

  The `cms` bundle carries the English and Polish labels; the `spaceAfter` labels are gone.

- 0e33ca9: An inline icon can have its own size and vertical offset, and a Section's or a Section group's image background and decorative backdrop can have a size, a repeat and a position.

  Nothing changes for content that does not use them: an icon with no size or offset is drawn at 1 em on the line as before, and a background with none of the new values renders the same markup and look.

  - **Inline icon size and offset.** The `inlineIcon` node of `InlineRichText` accepts optional `size` (`'0.5em'`–`'3em'` or `'8px'`–`'200px'`, `isInlineIconSize`) and `offset` (em of the text, −1 to 1, `isInlineIconOffset`), each also as `null`. `InlineRich` draws the icon at that size and moves it with `vertical-align`; `inlineIconPresentation` is exported for editors that draw it. `inlineIconNode` writes them as `data-cms-icon-size` / `data-cms-icon-offset`, the same through the DOM-free serializer and TipTap's, and reads them back. The icon dialog of the inline rich-text field sets both, edits a selected icon (**Edit icon**), and is translated through the page builder's field text.
  - **Background size, repeat and position.** `sectionBackgroundSchema` gains `size` and `repeat` for an image (`'cover' | 'contain' | 'auto' | {px} | {percent}` and `'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y'`), and `decorativeSize`, `decorativeRepeat` and `decorativePosition` for the decorative backdrop; `BACKGROUND_SIZE_KEYWORDS`, `BACKGROUND_REPEATS` and `backgroundSizeToCss` are exported. An image with a natural or fixed size or a repeat is painted as a CSS background (`.cmsc-section__tile`, with the mobile image below 768 px); `contain` keeps the picture. The backdrop's values are written on the section or the group's paint layer. The Section background field offers them, with `cover`, no repeat and the top position as the defaults.

  `@endora-commerce/mod-i18n` adds the English and Polish `pageBuilder.fieldText.section.*` and `pageBuilder.fieldText.inlineIcon.*` labels; the `cms` module's documentation describes both.

- 0e33ca9: The latest-posts block gains options for its post cards, its header lead and its header button.

  Nothing changes for content that does not use them: the default markup and look are the ones the block had.

  - **Card look.** `blog.LatestPosts` offers a card background (`cardBackground`, a hex or brand colour), card corners (`cardRadius`), card padding and text padding (`cardPadding` / `cardTextPadding`, a spacing step or Custom px, per breakpoint), the image ratio per breakpoint (`imageRatio`, any aspect token or a custom `w:h`; 2:1 by default), zoom on hover (`hoverZoom`), the category chip style (`chipStyle`: filled, outline or hidden), the card title size and weight per breakpoint (`cardTitleSize`, `cardTitleSizePx`, `cardTitleWeight`), and the read-more link's icon (arrow or plus), alignment (start or end) and weight.
  - **Header.** The lead takes a size per breakpoint and a colour (`leadSize`, `leadSizePx`, `leadColor`). The header button can sit below the lead (as before), at the end of the header or after the posts, per breakpoint (`headerButtonPlacement`), and can span the full width per breakpoint (`headerButtonFullWidth`).
  - **Markup.** The options are written as classes and custom properties on the block root (`cmsc-pb-latest-posts--*`, `--cmsc-post-*`); a button placed after the posts renders in `.cmsc-pb-latest-posts__action` after the carousel or grid. The shared carousel header (`carouselHeaderNode`, `CarouselHeaderBlock`) takes optional options for this; other blocks call it as before.
  - **Editor.** The new fields carry English and Polish labels; the responsive ones are on the Responsive tab.

- 0e33ca9: The image, icon, logo strip, announcement bar and map marker links are the shared link: a page, product, category, file, a section of the page or a URL, with **Open in new tab**.

  A URL stored before (`href`, with the image's and the icon's `linkTarget`) reads as a link of kind `url` with the same target — a logo's as a new tab, as it always opened — and a safe one renders as before; an unsafe one renders no link (see the safe-URL change).

  - `cms.Image`, `cms.Icons`, `cms.AnnouncementBar` and each `cms.LogoStrip` item gain `link` (`LinkValue`); `cms.Map`'s `markers[].link` takes a string or a `LinkValue`, and the marker's popup links its label. The blocks' `resolveData` carries a stored URL into `link` when the block is opened in the editor.
  - `@endora-commerce/cms-components` exports `blockLink`, `blockLinkTarget` and `carriedBlockLink`, the reading these blocks share.
  - The admin gives each of them the link field with its pickers. A link's **Open in new tab** shows once the link leads somewhere (or already opens a new tab).
  - A map marker is listed by its label or its position, up to 50 markers.

- 0e33ca9: Media frames take a corner radius option, block texts and surfaces follow a section's colour scheme, and a row inside a section with a content width is no longer inset twice.

  With no scheme and no new option chosen, the blocks look as they did.

  - **Media corners.** `cms.LinkTile` and `cms.CarouselImage` gain `mediaCornerRadius` (**Image corners**), and `cms.Video` gains it as **Frame corners**. The values are `none | small | medium | large` (0, 4, 8 or 16 px), and the default is `medium`. The block writes the value as `--pb-media-radius`. The stylesheet reads it on the tile's media, the carousel image, the video file frame and the embed's iframe, with today's 8 px as the fallback, and a chosen value also replaces the embed frame's `rounded-lg`. The box's own `cornerRadius` on `cms.Video` is unchanged and still applies to the box only. The new helper module `utils/media-radius` exports `DEFAULT_MEDIA_CORNER_RADIUS`, `mediaRadiusPx` and `mediaRadiusVars`.
  - **Scheme text.** These texts read `--cmsb-fg-muted`, with today's neutral as the fallback: `.cmsc-pb-feature-list__desc`, the product card's SKU and stock, the category count and the carousel image placeholder. An active underline tab reads `--cmsb-fg`. On the dark scheme they now meet AA contrast.
  - **Scheme surfaces.** Inside `[data-cmsb-scheme]`:
    - `--cmsc-media-bg` is `transparent`, so the light backdrop behind a link tile's or a carousel image's picture gives way to the section's background.
    - `--cmsc-surface-tint` is a translucent ink: dark on the light schemes, light on the dark one. It paints empty media placeholders, category chips and the boxed tab.
    - A bordered product card takes `--cmsb-bg` and `--cmsb-border`.
    - An active pill tab inverts the scheme's colours.
  - **Rows in a content frame.** The rule that puts a nested `in_flow` row of an edge-to-edge (`bleed`) section into the page container now applies only when the section has no `contentWidth`. With a content width, the section's frame already holds the content, so the row's columns line up with the other blocks.

  The `cms` bundle carries the English and Polish labels of the new fields.

- 0e33ca9: A video's posters, and a self-hosted video's files, follow a source the editor chooses: the asset library or URLs.

  Nothing changes for a stored page: with no source chosen, a library video or image wins over a URL, as before.

  - **Hero poster source.** The video media of `cms.Hero` gains `posterSource: 'library' | 'url'` and `posterUrl`. With the URL source the URLs win and the library images are the fallback; a URL is made absolute against the media origin, as `mobilePosterUrl` is. The admin's hero media control has a **Poster source** select that governs both posters: the library shows **Poster image** and **Mobile poster image**, the URL shows **Poster URL** and **Mobile poster URL**. A stored media with no source shows the one its values imply (a URL set and no library image is the URL source).
  - **Video file and poster sources.** `cms.Video` gains `fileSource` and `posterSource` (`'library' | 'url'`, file source only) and `posterUrl`. An embed shows only **Video URL** and **Provider**; a file shows the fields of its chosen sources only (`resolveFields`). Its `resolveData` records, for a file stored with no source, the source its values imply — which renders what it rendered.
  - `@endora-commerce/cms-components` exports `impliedMediaSource(stored, urls, assetIds)` and `pickBySource(source, fromLibrary, fromUrl)`, the rule both blocks use.

  The `cms` bundle carries the English and Polish labels.

- 0e33ca9: Mobile videos by URL, spacing after any hero element, a gap below the tab bar and stable element ids for tabs, accordions and sign-up forms. With none of the new options chosen, every block renders as before.

  - A mobile video may be given by URL as well as from the asset library: `cms.Video` (file source) gains `mobileUrl`, the `cms.Hero` video media gains `mobileVideoUrl` (the URL source's mobile video; each kind falls back to the other), and the `cms.MediaText` / `cms.CarouselSplit` video media gains `videoSource: 'library' | 'url'`, `videoUrl`, `mobileVideoAssetId` and `mobileVideoUrl`. A distinct mobile video renders a breakpoint pair, of which the stylesheet shows one; an autoplaying one is still muted, started only on screen and never under reduced motion. An autoplaying media-and-text video now carries `data-autoplay`.
  - `cms.Hero` gains `spaceAfter`, a list of `{element, space, spacePx}`: the space below any element, a spacing token or Custom px, in either spacing mode. Unlisted elements keep `gaps`, or today's spacing without it.
  - `cms.Tabs` gains `panelGap` / `panelGapPx` (a spacing token or Custom px, per breakpoint) for the space between the tab bar and the panel; unset, today's 12 px. A panel in columns is a `cms.Row` inside the panel.
  - `cms.Tabs`, `cms.Accordion`, `cms.NewsletterSignup` and `newsletter.Signup` build their element ids from the block's id, with `useId()` only as the fallback, so the ids hydrate whatever is rendered above the page.

  `@endora-commerce/mod-cms` adds the field labels in English and Polish and the admin controls for the new video sources; in the page editor, a list that names its summary field (`metadata.pageBuilder.summaryField`) is summarised by that choice's translated label.

- 0e33ca9: A rich-text "read more" can place its summary and open upwards, an accordion gains look options, both open and close with an animation, and a highlighted phrase can take any brand colour or hex.

  Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

  - **Read more position and reveal above.** The rich-text `readMore` node gains `chevronPosition` (`'start' | 'center' | 'end'`, `'start'` by default) and `revealAbove` (`false` by default). They add `cmsc-read-more--center` / `--end` and `cmsc-read-more--reveal-above` to the `<details>`, the same through the DOM-free serializer and TipTap's, and are parsed back from them. The sanitiser is unchanged. Reveal above shows the open passage's content above its summary through CSS order only: the summary stays the first child and the one control. The rich-text toolbar gains **Read more position** and **Show the revealed text above the summary**.
  - **Animated open and close.** A read-more passage animates its `::details-content` height and an accordion panel its height and opacity, only without reduced motion and only where the browser supports `interpolate-size` (instant elsewhere). An accordion animates only after hydration (`data-animate`), so a panel open by default does not animate on page load. Every accordion panel stays in the server HTML, `hidden` while closed.
  - **Accordion look.** `cms.Accordion` gains `icon` (`'plus' | 'chevron'`), `itemStyle` (`'plain' | 'boxed'`), `dividers` (`'none' | 'between' | 'all'`, for plain items) and `titlePadding` / `titlePaddingPx` (a spacing token or Custom px per breakpoint, on the Responsive tab). Each is unset by default and writes nothing then.
  - **Emphasis colour.** The inline rich-text `emphasis` mark accepts an optional `color` (`#rrggbb` or `token:<role>`, `null` as unset) in `inlineRichTextSchema`. It renders `data-cms-em-color` and an inline `color` on the variant's span, in `InlineRich` and through both TipTap serializers. A colour outside that grammar renders today's span. The rich-text sanitiser keeps `data-cms-em-color` on a `<span>` with a colour value only. The inline toolbar gains **Highlight colour** (brand colours, a hex, **Remove colour**). The translation codec carries the mark unchanged.
  - **Labels.** The new toolbar and dialog labels are page-builder field text (`pageBuilder.fieldText.emphasisColor.*`, `pageBuilder.fieldText.readMore.*`), and the accordion fields are labelled in English and Polish.

- 0e33ca9: A "read more" passage revealed above its summary now animates. A link tile's title and label take a resting colour. An accordion gains a title colour, a divider under the title and an icon size.

  Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

  - **Reveal above animates.** Revealed above, the `<details>` is a flex column, so its `::details-content` kept its content height and the passage opened in one frame. Inside the existing animation block (no reduced motion, `interpolate-size` and `::details-content` supported) the stylesheet now sets `min-block-size: 0` on it.
  - **Resting tile colours.** `cms.LinkTile` gains `titleColor` and `labelColor` (`#rrggbb` or `token:<role>`), the colours of the title and of the text-link label at rest. A label shown as a button keeps the button's colours. A hover colour (`titleHoverColor`, `labelHoverColor`) still wins on hover and keyboard focus. Unset, the tile's markup is unchanged.
  - **Accordion title colour, divider position, icon size.** `cms.Accordion` gains `titleColor` (the trigger's colour; the icon follows it), `dividerPosition` (`'item' | 'title'`, for plain items; under the title, an item's line sits between its title and its panel) and `iconSize` (`'s' | 'm' | 'l' | 'custom'`, 16 / 20 / 24 px) with `iconSizePx`. Each is unset by default and writes nothing then.
  - **Labels.** The new fields are labelled in English and Polish.

- 0e33ca9: The rich text's image dialog picks an image from the asset library where the host provides a picker, and its width row lays out properly.

  - `@endora-commerce/page-builder-core` exports `PageBuilderImagePickerProvider`, `useImagePicker()` and the types `PageBuilderImagePicker`, `PageBuilderImagePickerProps` and `PickedImage` (`{ url, alt? }`): a host's image picker for controls that cannot import the admin. Without a provider `useImagePicker()` answers `null`.
  - The image dialog of `RichContentEditorField` (`@endora-commerce/cms-components`), used by every rich text in the page and e-mail builders, offers **Image source: Asset library / URL** when a picker is provided: the library first for a new image, the URL for an existing one. The chosen image's address is inserted, and its alternative text when the field is empty. Without a picker only the URL, as before. The stored image node does not change.
  - The **Width** number takes the row and its unit select a fixed 76 px; they no longer fight over one width.
  - `@endora-commerce/page-builder-admin` provides the asset library as that picker inside `PageBuilderColorPaletteProvider`, and exports `AdminImagePicker` and `pickedImageFromAsset(asset, language)`: the asset's stable `fileUrl`, made absolute, and its alternative text in the admin's language first.
  - `@endora-commerce/mod-i18n` carries the dialog's new copy (`pageBuilder.fieldText.richImage.*`) in English and Polish.

- 0e33ca9: A URL in the image, icon, logo strip, announcement bar and map marker links, and in the social links, passes the same safe-URL rule as every other link of the page builder: it starts with `https://`, `http://`, `mailto:`, `tel:` or `/`.

  - Any other URL — `javascript:`, `data:`, `vbscript:`, a protocol-relative `//host`, a relative path without a leading `/`, a bare `#fragment` — renders no link: the image, icon, logo, text or marker label stays, unlinked. A social link keeps its icon and name, with the `#` it already had when no address was set.
  - This holds for a URL stored before these blocks took the shared link (`href`) and for a link of kind `url` alike. A safe URL renders as before.
  - `blockLinkTarget` now resolves every kind, a URL included, through `resolveLinkHref`.

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

- 0e33ca9: A block's settings are shown where they apply and in one order — content, layout, look, spacing, visibility — and new blocks follow the section's colours.

  Nothing stored changes; the defaults below apply to newly inserted blocks only.

  - **Sliders** (`withoutUnusedCarouselFields`): the autoplay interval only with autoplay on; the arrows' look only while the arrows show; the disabled-arrow look (and its colour, for **Color**) only on a carousel that stops at its ends; the controls' placement and alignment only while arrows or dots show. The `controls` field is a cached copy, so the input keeps its focus.
  - **Shown where they apply**: a carousel image's caption look with a caption; a CTA card's image side with an image; a row's **Vertical position** with a minimum height; an accordion's **Divider position** where its items have lines; **Muted** only for a video file that does not autoplay (an autoplaying file is always muted); the social icon colour only with **Use brand colors** off (now before it).
  - **Order**: the media-and-text layout after the footnote; the link tile's image, title, link label and link first; the CTA card's look after its content; the stats' metrics before the image; the feature list's image next to the features; the background panel's text side after the buttons; a carousel image's link after its caption; the video's accessible title under its sources; the image and its alt text together on the General tab; the latest posts' number and category on the Data tab, the category picked from the blog's categories (`createBlogCategorySlugField`, still storing the slug).
  - **Item open at first** (`cms.Accordion`) and **Tab shown at first** (`cms.Tabs`) are chosen among the items (`createItemIndexField`), storing the index they always stored.
  - **Media and text** and the **carousel split slide** take a **Poster source** (asset library or URL) for both posters, with `posterUrl`; unset, the library image wins as before.
  - **Sources**: every image and video source offers the asset library first, and a new image starts on it; an image stored with no source and a URL keeps its URL source.
  - **New blocks**: a text has no colour of its own, icons and social links take `currentColor`, an announcement bar the brand's primary colours, so they read on a dark section.
  - Wording: the hero overlay's directions as the image's ("Darker at the bottom"…), the product card's **Button label**, **Card style** and plain words for its optional sizes, a custom maximum width's one range (160–2000 px), the video's maximum width "% of the available width".

- 0e33ca9: Shared prop shapes for page-builder blocks, with one renderer and one editor field each, so every block links, shows buttons, images and short formatted text the same way.

  - `@endora-commerce/contracts` exports the shapes as Zod schemas and types: `linkValueSchema` / `LinkValue` (URL, page, product, category, file or a section anchor on the same page; `javascript:` and protocol-relative URLs refused), `buttonSpecSchema` / `ButtonSpec` (label, link, style, fill, size, icon and per-breakpoint values), `responsiveImageSchema` / `ResponsiveImage` (desktop and mobile source, alt text, aspect ratio per breakpoint, fit, focal point), `inlineRichTextSchema` / `InlineRichText` (bold, italic, link, line break and the `gradient` / `accent` / `muted` emphasis), `colorValueSchema` (hex or `token:<role>`), `responsiveSchema(inner)` / `Responsive<T>`, and the space, scheme and width enums. The zod-free helpers (`normalizeAnchor`, `isSafeLinkUrl`, `isAspectToken`, `plainTextToInlineRichText`, `inlineRichTextToPlain`, the regular expressions and token lists) are also importable from `@endora-commerce/contracts/page-builder-values` without bundling Zod.
  - `@endora-commerce/page-builder-core` re-exports these types and helpers from its barrel.
  - `@endora-commerce/cms-components` exports the renderers: `ButtonView`, `Picture` (art-directed `<picture>`, lazy unless `priority`), `InlineRich` / `countInlineRichWords`, `resolveLinkHref`, `colorValueToCss` / `iconColorProps`, and the inline rich-text editor field `createInlineRichTextField` with `InlineRichTextEditor`, `inlineRichTextExtensions` and the `emphasisMark` TipTap mark. Button styles are the new `cmsc-btn` classes in the shipped stylesheet.
  - `@endora-commerce/page-builder-admin` exports the editor fields: `createLinkField` / `LinkFieldControl` / `LINK_KINDS`, `createButtonListField` (up to six buttons, optionally per breakpoint), `createButtonSpecField`, `DEFAULT_BUTTON_SPEC`, `createResponsiveImageField` / `ResponsiveImageControl`, `createFileAssetField` and `listPageBuilderLinkPages`. `createButtonLinkSlugField`, the previous slug-only link picker, is exported from here as well and keeps the stored value it always wrote.
  - `@endora-commerce/mod-i18n` adds the `pageBuilder.linkField.*` and `pageBuilder.imageField.*` labels (English and Polish).

- 0e33ca9: The page builder's settings panel speaks one language: one switch for every on/off setting, and every label translated — the settings every block shares translated once.

  Nothing stored changes: a switch stores the same `true` / `false` the Yes/No choices stored.

  - `@endora-commerce/page-builder-core` exports `createToggleField({ label, defaultValue?, metadata? })` — a `role="switch"` button inside its label, operable by pointer and keyboard, showing the block's default while the prop is unset; with the responsive metadata it edits the breakpoint the Responsive tab selects — and `ToggleSwitch` for a custom control's own on/off setting. Every Yes/No radio of the bundled blocks, the row's "Clip content", a video's autoplay, muted, loop and controls, a carousel's loop, autoplay and equal heights, its arrows and dots (now **Show arrows** / **Show dots**), the border's **Show border**, the section reveal's desktop-only, a media-and-text video's autoplay and a link's **Open in new tab** are switches.
  - Shared fields carry their key: `withSharedFieldLabel(key, field)`, `sharedFieldLabel(field)` and `PAGE_BUILDER_SHARED_FIELD_KEYS` (editor name, Hide on, order in the column, box spacing, border, background, rounded corners, shadow, colour, typography, minimum height). The admin translates such a field from the `core` bundle's `pageBuilder.sharedFields.<key>` after the block's own key and before the English; a block that relabels a shared field keeps its own key. `applyPageBuilderTranslations` takes the shared resolver as a fifth argument, and translates the options a custom field carries.
  - The words inside the page builder's controls — spacing, border (a border side now labels its **Width (px)**, **Style** and **Color**), the per-breakpoint hints, the editor's name, the background control and the asset picker — come from the `core` bundle in English and Polish.
  - `withHideOn` puts **Hide on** back when a block's own `resolveFields` returns a field set without it (the heading, row, table and map had lost it).
  - Every bundled block's field and option labels resolve in Polish; the block keys are in the declaring module's bundle (`cms`, `catalog`, `blog`, `newsletter`), the shared ones in `core`. Labels use US spelling (**Color scheme**, **Center**), one wording (**Email**, **Alt text**, **Minimum height**, "Custom … (px)", **Rounded corners**), and side choices read **Left / Right**.

- 0e33ca9: Tabs can colour a tab under the pointer, and the panel change can visibly animate as a crossfade or a slide.

  Nothing changes for a tab block that does not use them: with no hover colour and the instant panel change, the markup and look are the ones the block had.

  - **Hover look.** `cms.Tabs` `tabStyle` gains `hoverBackground` and `hoverColor` (a brand token or a hex). Once one is set, the block writes `--cmsc-tabs-hover-bg` / `--cmsc-tabs-hover-fg` and the class `cmsc-pb-tabs--hover`. On pointer devices a tab that is not selected takes those colours under the pointer, with a 200 ms colour transition that is dropped under reduced motion.
  - **Panel change.** `effect` gains `slide` beside `none` (the default) and `fade`. `fade` is now a crossfade: the outgoing panel fades out over the incoming one, and the panels' height animates from one to the other. `slide` adds a short sideways shift in the direction of travel. With an animated effect the panels sit in a `.cmsc-pb-tabs__panels` box. Every panel stays in the server HTML. While the outgoing panel is still shown it is `inert` and `aria-hidden`, and it is `hidden` again after 300 ms. The tab roles, ids and keyboard model are unchanged. Under reduced motion the change is instant.
  - **Removed rule.** The stylesheet no longer has the load-time `.cmsc-pb-tabs--fade .cmsc-pb-tabs__panel:not([hidden])` fade-in or its `cmsc-pb-tabs-fade` keyframes. The crossfade above replaces them.

  The `cms` bundle carries the English and Polish labels for the hover colours and the slide.

- 0e33ca9: The tab size can differ per breakpoint, carousel arrows can be drawn arrows, inline rich text can hold an icon, and rich-text headings follow the brand type scale.

  Nothing changes for a block that does not use them: the default markup and look are the ones the blocks had.

  - **Tab size per breakpoint.** `cms.Tabs` gains `tabSize` (`'s' | 'm' | 'l'`, or one per breakpoint), a top-level prop on the Responsive tab, listed in the block's `responsiveFields`. It replaces the `size` key of `tabStyle` in the editor. A size stored in `tabStyle.size` still applies, and the editor's `resolveData` moves it to `tabSize` (`tabSizeMoved`). The phone's size writes the existing `cmsc-pb-tabs--size-s|l` class; a larger breakpoint whose size differs adds `cmsc-pb-tabs--size-md-*` or `cmsc-pb-tabs--size-lg-*`.
  - **Arrow icon.** `controls.arrowIcon` (`'chevron' | 'arrow'`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, and the `CarouselShell` prop `arrowIcon`. `arrow` draws the icon catalog's arrows as inline SVG hidden from assistive technology; the chevron glyphs stay the default.
  - **Inline icon.** `InlineRichText` accepts an `inlineIcon` node (`{type: 'inlineIcon', attrs: {name}}`, the name matching `INLINE_ICON_NAME_RE`), an icon of the page builder's catalog. `InlineRich` renders it as `1em` inline SVG with `aria-hidden`; an unknown name renders nothing. `inlineRichTextToPlain` drops it. The inline rich-text field gains an **Insert icon** button. `inlineIconNode` (in `rich-content-shared`) serializes it as an empty `span.cmsc-inline-icon[data-cms-icon]`, the same through the DOM-free serializer and TipTap's. Page translation carries it as one atomic tag.
  - **Rich-text headings follow the type scale.** For each heading level `h1`–`h6` whose type style is set, `brandTokensToCss` writes one rule giving the headings inside rich text (`cms.RichContent` and the blocks' rich bodies) that level's size, line height, weight and letter spacing. With no brand tokens it writes nothing.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels. The `blocks.tabs.fields.tabStyle.fields.size` keys are replaced by `blocks.tabs.fields.tabSize`.

- 0e33ca9: Block headings and item texts gain a weight, block headings and the hero title gain a maximum width per breakpoint, the controls below a carousel can line up with its first slide, and carousels and product cards now use the brand body font.

  Nothing changes for a block that does not use them: no option is in any `defaultProps`, and the default markup and look are the ones the blocks had.

  - **Brand body font on carousels and product cards.** `.cmsc-pb-carousel` and `.cmsc-pb-product-card` join the zero-specificity group that sets `font-family: var(--cmsb-font-body, inherit)`. The filter bar, the header lead, the controls and the card texts used to keep the storefront's font next to brand-font headings. With no brand font set they inherit the page's font, as before.
  - **Text weight.** `headingWeight` (`'default' | 300 | 400 | 500 | 600 | 700 | 800`) on every block whose heading is a `BlockHeading` with a size: `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`, `cms.LinkList`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, and the carousel header of `cms.ContentSlider`, `catalog.ProductGrid`, `catalog.ProductSlider` and `blog.LatestPosts`. `cms.Hero` gains `titleWeight`, and `cms.FeatureList` gains `titleWeight` for its item titles. Item texts gain `cms.CarouselImage.captionWeight` and `cms.LinkTile.titleWeight`/`labelWeight`, as a property of the `ItemText` span. The product listings gain `cardTitleWeight`, which becomes `CmsProductCardView`'s new `nameWeight`. The new `textWeightField` and `textWeightCss` helpers are in `components/typography`.
  - **Heading measure.** `headingMaxWidth`/`headingMaxWidthPx` (a named measure or Custom px, per breakpoint, on the Responsive tab and in `responsiveFields`) on the same blocks except `cms.Statement`, whose `textMaxWidth` already holds its heading. `cms.Hero` gains `titleMaxWidth`/`titleMaxWidthPx`. `BlockHeading` takes `weight`, `maxWidth`, `maxWidthPx` and `align`. A held heading in a centred block stays centred (`data-align`). `section-parts` exports `blockHeadingStyleFields`, `blockHeadingStyle` and `isUnusedHeadingMaxWidthPx`.
  - **Controls aligned to the first slide.** `controlsAlignTo` (`'container' | 'slide'`) on the Carousel, `catalog.ProductSlider` and `blog.LatestPosts`, hidden for a grid. It maps to `CarouselShell`'s `controlsAlignTo` and the root class `cmsc-pb-carousel--ctl-to-slide`. The rows below the track then take one slide's width, so with a bleeding track the controls end where the first slide ends.

  The `cms`, `catalog` and `blog` bundles carry the English and Polish field labels.

- 0e33ca9: A link tile's title and label weight, and a carousel image's caption weight, can differ per breakpoint.

  Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

  - **Weight per breakpoint.** `cms.LinkTile`'s `titleWeight` and `labelWeight` and `cms.CarouselImage`'s `captionWeight` accept a value per breakpoint as well as one weight, on the Responsive tab. A single stored weight renders as before (an inline weight on the text). Weights that differ write `--pb-item-weight` / `-md` / `-lg` on the text with the class `cmsc-pb-item-weight`; a breakpoint without a weight of its own keeps the usual weight.
  - **Editor.** The three fields move to the responsive group of each block's field list; their labels and options are unchanged.

- 0e33ca9: A link tile's resting title and label colours can differ per breakpoint. An accordion gains the space above an open panel, the space between items and a title weight.

  Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

  - **Colour per breakpoint field.** `@endora-commerce/page-builder-core` exports `createResponsiveColorField` (with `writeResponsiveColor` and the `ResponsiveColorProp` type): the colour control on the Responsive tab, editing the breakpoint the tab's scope selects. A breakpoint set first is stored without a base, a value with only its base is stored as a single colour, and clearing the last colour stores nothing.
  - **Resting tile colours per breakpoint.** `cms.LinkTile`'s `titleColor` and `labelColor` accept a value per breakpoint as well as one colour. A single stored colour renders as before. Each breakpoint with a colour of its own writes `--pb-title-color-md` / `-lg` (and the label's) with a class that applies it from 768 / 1024 px up; a breakpoint below the first one with a colour keeps the tile's own colour. A hover colour still wins on hover and keyboard focus.
  - **Accordion spacing.** `cms.Accordion` gains `panelGap` / `panelGapPx` (the space between a title, or its line, and its open panel) and `itemGap` / `itemGapPx` (the space between items), each a spacing token or a Custom px per breakpoint. A breakpoint left unset keeps today's spacing; the panel's space opens and closes with it.
  - **Accordion title weight.** `cms.Accordion` gains `titleWeight` (`default` or 300–800), set on every title.
  - **Labels.** The new fields are labelled in English and Polish.

- 0e33ca9: `cms.Video` plays a self-hosted file, `cms.Image` gains art direction, an aspect ratio per breakpoint, an overlay and a caption, and images in rich text take a size, an alignment and an inline mode. Every existing option keeps its meaning, and content saved before renders as it did.

  **`cms.Video`.** A new `source` (`embed`, today's, or `file`) adds a self-hosted video: `videoAssetId` (or a direct file URL in `url`), an optional `mobileVideoAssetId` shown below the tablet width, and a `posterAssetId`. A file loads nothing until it plays (`preload="none"`), plays inline, and never carries the `autoplay` attribute; with `autoplay` it is muted and started only while on screen, never for a visitor who prefers reduced motion. `aspectRatio` keeps `16:9`, `4:3` and `1:1` and now takes every aspect token and a custom `w:h`, per breakpoint, on the editor's Responsive tab. A stored video with no `source` is an embed.

  **`cms.Image`.** New optional props: `mobileSrc` / `mobileAssetId` (a `<picture>` source below the tablet width), `ratio` (per breakpoint; the frame reserves the space), `overlay` (`none`, `solid` or `gradient`, with direction and strength), and `caption` with `captionPlacement` (`below` or `beside`). `caption` is translatable. The image is now lazy-loaded and decoded asynchronously; with none of the new props set its markup and look are otherwise unchanged.

  **Video frames.** The hero's video above the content and the `cms.MediaText` video take `media.ratio` per breakpoint; unset is the 16:9 frame they had.

  **Rich-text images.** The TipTap `image` node gains `size` (a width in px or %) and `align` (`left`, `center`, `right`), rendered as `class="cmsc-rich-img cmsc-rich-img--<align>"` and `style="width: …"`; a new inline node `inlineImage` sets an image in the line of text. The editor's image dialog inserts and edits both. The sanitiser keeps a `width` in px or % on an `<img>` only; its policy's `cleanStyle` receives the element name as an optional second argument. New exports from `@endora-commerce/cms-components`: `richImageNode`, `inlineImageNode`, `RICH_IMAGE_SIZE_RE`, `RICH_IMAGE_ALIGNS`, `ImageDialog`, `RichImageChoice`; `overlayStyle` is exported from the section frame.

  **Fields.** `@endora-commerce/page-builder-core` exports `createAspectRatioField` (a responsive aspect-ratio field: a preset or a custom `w:h`, per breakpoint) and three field-text keys (`ratio.auto`, `ratio.custom`, `ratio.customValue`, translated in `mod-i18n`). `@endora-commerce/page-builder-admin` exports `ResponsiveRatioControl`, the image field's per-breakpoint ratio control, for ratios nested in a composite value. In the CMS editor the video's files and poster, and the image's mobile image, are picked from the asset library; every field of `cms.Video` and `cms.Image` is labelled in English and Polish.

- 3ccf23b: Layout options for the hero, the feature list, the statement, the stats, the call-to-action card and the media-and-text block.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

  - **Hero.** `gaps` (Space between items) offers Custom (px) with `gapsPx`, per breakpoint; before, a value other than a spacing step was ignored. With image or video media above the content, `mediaSpace` / `mediaSpacePx` set the space between the media and the texts (none by default), as `--cmsc-hero-media-space`.
  - **Feature list.** `innerSpace` (a spacing step) sets the space after the icon, below the title and between paragraphs (today's 8 px and 4 px by default). `iconPosition: 'beside'` puts the icon beside the title, the title and the text hanging beside it (`data-icon-position="beside"`).
  - **Statement.** Over a background image, `minHeight` (Default is today's 60 % of the screen's height; Auto, half, three quarters, the full screen or Custom px with `minHeightPx`), per breakpoint.
  - **Stats.** Beside an image, from the tablet up, a `layout` preset (6 + 6, 7 + 5, 5 + 7, 8 + 4, 4 + 8, 5 + 1 + 6, 6 + 1 + 5) places the image and the figures on a 12-column grid (mirrored for an image at the end); `layoutAdvanced` exposes the raw `imageSpan`, `figuresSpan` and `figuresOffset` instead; and `figuresAlign` puts the figures at the top, the bottom or spreads them over the image's height.
  - **Call-to-action card.** `cardRadius` (Default keeps today's 12 px; none, small, medium, large) and `imageInset` (`none` takes the image to the card's edges, `custom` with `imageInsetPx`).
  - **Media and text.** `sideBySide: 'desktop'` keeps media and text stacked on a tablet and places them side by side from 1024 px; unset is today's 768 px.

- 3ccf23b: The smaller texts of the content blocks take their own size, weight and line height.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

  - **Feature list.** `bodySize` / `bodySizePx`, `bodyWeight` and `bodyLineHeight` style every item's text (by default the small, muted line); `titleLineHeight` sets the item titles' line height.
  - **Hero.** The subheading and the statement take `…Weight`, `…LineHeight` and `…MaxWidth` / `…MaxWidthPx`, as the title does; the text takes `bodySize` / `bodySizePx` (Default is 16 px), `bodyWeight`, `bodyLineHeight` and `bodyMaxWidth` / `bodyMaxWidthPx`.
  - **Statement.** `headingLineHeight`; the supporting text's `bodySize` / `bodySizePx`, `bodyWeight` and `bodyLineHeight`.
  - **Stats.** The labels' `labelSize` / `labelSizePx` and `labelWeight`.
  - **Link list.** The row titles' `titleSize` / `titleSizePx` and `titleWeight`.
  - **Rich content.** `textSize` / `textSizePx` size the whole text.
  - Sizes are a type-scale step or Custom (px), per breakpoint on the Responsive tab, as are line heights and maximum widths; a weight is one value. A type-scale step brings the brand's line height, weight and letter spacing for it (`--cmsb-t-<step>-lh`, `-w`, `-ls`); a line height applies, and its field shows, only at a breakpoint whose size is Custom (px). One value for every width is written inline on the text; values that differ add `cmsc-pb-ts-size`, `cmsc-pb-ts-weight`, `cmsc-pb-ts-leading` or `cmsc-pb-ts-tracking` with `--pb-ts-<name>`, `-md` and `-lg`. The labels are translated (English and Polish).

- 3ccf23b: A heading that starts with an icon can hang its text beside the icon.

  `cms.Heading`'s **Hanging indent after a leading icon** (`hangingIcon`) renders the icon and the rest of the text in two boxes (`<span class="cmsc-hang">`), so a wrapped line starts under the text, not under the icon. `InlineRich` takes the same `hangingIcon` prop. A heading without the option, or without a leading icon, renders as before.

- 3ccf23b: Rich text gains a text size on selected words and more bullet-list markers.

  Nothing changes for content that does not use them: a rich text saved before renders the same markup.

  - **Text size.** The rich text toolbar's **Text size** sizes the selection with a type-scale step (`<span class="cmsc-fs cmsc-fs--<step>">`, sized per breakpoint by the stylesheet). It is stored as the `textSize` mark; the renderer and the sanitizer also accept a `font-size` in px from 8 to 200 on a `<span>` (`<span class="cmsc-fs" style="font-size: Npx">`), which the toolbar does not offer.
  - **List marker.** A bulleted list's **List marker** is **Disc** (default), **Check mark** (as the check list before), **Chevron** or **None** (`cmsc-list--chevron`, `cmsc-list--none`).
  - The server and the editor write the same markup. New `core` keys `pageBuilder.fieldText.textSize*` and `pageBuilder.fieldText.listMarker*` (English and Polish).

- 3ccf23b: A Simple Text block takes bold, italic, links and highlights.

  Its **Text** is edited like a heading's, in the side bar and on the canvas. A text saved before stays a plain string and renders as it did until it is edited; an edited text is stored as inline rich text (a one-paragraph document) and rendered in the same paragraph. `cms.Text`'s translatable path `text` is declared as rich text, which reads a stored plain string as plain text.

- 3ccf23b: The Button block gains a transparent outline and a border colour.

  - `cms.Button`'s outline fill keeps the section's background behind it, as before (it is the look of the `secondary` button it replaced). `transparentOutline` lets the background show through instead.
  - `borderColor` (a hex or brand colour) replaces the fill's border, for example a ring of its own around an icon-only outline button.
  - `ButtonView` takes an optional `look` (`transparentOutline`, `borderColor`); without it it renders as before.

- 3ccf23b: Carousel controls gain scheme-aware dots, an arrow glyph colour, per-breakpoint visibility and a place inside split slides.

  Nothing changes for content that does not use them: unset, every carousel renders the markup it had.

  - **Dots.** The dots of the Carousel, the product slider and the latest posts carousel follow the colour scheme: in a dark scheme the current dot is the scheme's text colour over faint dots (before, both were fixed greys and the current dot was hard to tell apart).
  - **Solid arrows.** `controls.arrowGlyphColor` sets the icon colour of a solid arrow (white by default), so a white solid arrow can carry a dark icon.
  - **Per breakpoint.** `controls.hideArrowsOn` and `controls.hideDotsOn` (the "Hide on" control: mobile, tablet, desktop) hide the arrows or the dots at those widths; a row of controls left empty there is removed.
  - **Header without a heading.** Arrows placed in the header of a carousel with no heading now stand at the header's end, as they do beside a heading (before, at its start).
  - **Inside split slides.** The Carousel's `controlsPlacement` accepts `slide`: each split slide draws the arrows and dots at the end of its text column, and only the slide on screen has operable controls. A carousel of other items keeps its controls below the slides there. `CarouselSlideControls` is exported for blocks that want to draw them.
  - **Markup.** A new root custom property (`--pb-arrow-glyph`) and classes (`cmsc-pb-carousel--arrows-off-*`, `--dots-off-*`, `cmsc-pb-carousel__controls--slide`, `--slide-fallback`); the editor fields carry English and Polish labels.

- 3ccf23b: The download tile gains look options: a colour scheme, background, border, corners, padding, title size, a full hover image and a round icon button.

  Unset, the tile looks as before (a light, bordered 8 px card with a type badge and a text label) and stays one download link.

  - `scheme` (light, muted or dark, on the tile itself), `cardBackground`, `cardBorder`, `cornerRadius`, `cardPadding` (a spacing step) and, per breakpoint, `titleSize` (a type-scale step or Custom with `titleSizePx`; a `titleSizePx` stored without a size reads as Custom); `showType: false` hides the file type badge.
  - `hoverImageLook: 'full'` shows the hover image in full under a dark gradient, the text turning white (the default stays the faint tint).
  - `linkLook: 'icon'` draws the link as a round 48 px download button pinned to the bottom end, ringed in the text colour; the link label stays in the link for screen readers.

- 3ccf23b: Carousel images gain a read-more label; the Image block's caption gains a placement, size and alignment per breakpoint.

  Unset, both blocks render as before.

  - `cms.CarouselImage`: `moreLabel` (translatable) shows a second line, such as "Read more", in a corner of its own over the image (`moreLabelPlacement`, bottom right by default), with an optional icon (`moreLabelIcon`); it is part of the item's link.
  - `cms.Image`: `captionPlacement` may differ per breakpoint (below or beside the image; a stored value applies to every breakpoint), and the caption takes `captionSize` (a type-scale step or Custom with `captionSizePx`; a `captionSizePx` stored without a size reads as Custom) and `captionAlign` per breakpoint.

- 3ccf23b: The newsletter sign-up block gains layout options: the button inside the field, topic columns and a visually hidden e-mail label.

  Unset, the form looks as before; the posted fields never change.

  - `buttonPlacement: 'inside'` puts the submit button inside the e-mail field's box, with `fieldShape` rounded (default) or `pill`.
  - `topicsColumns` (1–4) lays the topic checkboxes out as a grid of columns.
  - `hideEmailLabel` hides the e-mail label visually; it stays the field's label for screen readers.

- 3ccf23b: The button below a product grid or product slider can be centred or aligned right.

  `catalog.ProductGrid` and `catalog.ProductSlider` take `footerButtonAlign` (`start`, `center` or `end`, labelled Left, Center and Right), offered once the footer button has a label. Unset, the button stays at the start as before; the other values add `cmsc-pb-product-listing__footer--center` or `--end`.

- 3ccf23b: `cms.BackgroundPanel` gains **Transparent text box** (`textBoxTransparent`, a switch, off by default). On, the panel carries `data-text-box="transparent"` and its text box paints no background of its own, so the image shows through behind the text. Off or unset, the panel renders as before. English and Polish labels in `@endora-commerce/mod-cms`.
- 3ccf23b: `cms.Column` gains **Background outset (px)** (`outsetPx`, per breakpoint, Responsive tab). Set above 0, the column cell carries `data-pb-outset` and `--pb-col-outset(-md|-lg)`; its box — background, border and shadow — reaches that far past the column track on each side, and the box's content layer is padded back so the content stays in place. Unset or 0 everywhere, the column renders as before. `@endora-commerce/mod-cms` lists `outsetPx` among the Column's `responsiveFields`, with English and Polish labels.
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

- 3ccf23b: The download tile can link to a page or URL, and gains a minimum height; its title size now applies from the tablet up.

  - `linkTo: 'link'` with `link` (a page, product, category, file or URL) makes the tile one link to it — no file badge, no `download` attribute, the icon button pointing onwards. Unset, the tile links to its file as before.
  - `minHeightPx` (180 px by default).
  - Fix: a `titleSizePx` set for the tablet or desktop was overridden by the phone's value from 768 px (a stylesheet rule order); it now applies.

- 3ccf23b: Buttons inside blocks take the Button block's look options, and an icon-only button can be a pill.

  - `ButtonSpec` (`buttonSpecSchema`) gains optional `transparentOutline`, `borderColor` and `iconOnlyShape` (`'circle' | 'pill'`). A button saved before parses and renders as it did.
  - A hero's, a card's, a panel's, a header's or a listing's button renders them through the same `ButtonView` path as `cms.Button`, whose own block-level look options are unchanged and win over the spec's. `cms.Button` gains `iconOnlyShape`.
  - A pill is `cmsc-btn--icon-pill`, 1.15 times its height.
  - `createButtonSpecField` takes `look: false` (used for `cms.Button`); `BUTTON_LOOK_FIELDS` is exported, its labels translated once in the `core` bundle (`pageBuilder.sharedFields.button*`).

- 3ccf23b: The hero gains a title line height, an eyebrow colour, an eyebrow that can serve as a label and a social-proof caption placement and measure.

  Unset, the hero renders as before.

  - `titleLineHeight` per breakpoint (with a Custom title size); `eyebrowColor` over the hero's `textColor`, which colours every other text.
  - `eyebrowSize` (a type-scale step or Custom with `eyebrowSizePx`; an `eyebrowSizePx` stored without a size reads as Custom) and `eyebrowLineHeight` (with a Custom size) per breakpoint, and `eyebrowUppercase: false` for an eyebrow in its own case; the space after it is its item's in the element order.
  - `proofCaptionPlacement` (`beside` or `below`, per breakpoint) and `proofCaptionMaxWidthPx` per breakpoint.

- 3ccf23b: Image captions and image cards: a caption measure and two layout fixes.

  - `cms.Image` gains `captionMaxWidthPx` per breakpoint.
  - Fix: a caption below the image on phones and beside it from a wider breakpoint, with a set image width, was squeezed into the image's width there; the figure now holds the image at its width and the caption in a column of its own.
  - Fix: a caption on the same edge as the read-more label overlapped it on a narrow card; it now sits above the label's line (`cmsc-pb-carousel-image--more-clear-top|bottom`). Visible change for cards with both on one edge.

- 3ccf23b: Rich-text check and chevron list markers can take a colour of their own.

  `cms.RichContent` gains `listMarkerColor`; the markers read `--cmsc-list-marker`. Unset, a check stays the brand's primary colour and a chevron the text's, so stored lists look as before.

- 3ccf23b: Spacing and layout options for the media-and-text block, the background image panel, the feature list, the call-to-action card, the stats and the link list.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup. Values marked per breakpoint are written only for the breakpoints a value reaches.

  - **Media and text.** `innerSpace` and `stackedGap` (spacing steps) set the space below each heading and between paragraphs, and between stacked media and text; `bodySize` / `bodySizePx` (per breakpoint) and `bodyLineHeight` size every row's text; each of `rows` takes its own `verticalAlign` (unset or `inherit` follows the block's).
  - **Background image panel.** `mobileLayout: 'overlay'` lays the text over the image on phones, the image at its own height, instead of stacking them.
  - **Feature list.** `rowGapPx` (per breakpoint) spaces the rows apart from the gap; `listLineHeight` (per breakpoint, with a Custom text size) for lists in an item's text.
  - **Call-to-action card.** `cardPadding` (a spacing step) sets the card's padding, which an image inset measures from; a `layout` preset (6 + 6, 7 + 5, 5 + 7, 8 + 4, 4 + 8, from the tablet up) sets the image's width, with `layoutAdvanced` exposing the raw `imageColumns` (per breakpoint, columns of 12).
  - **Stats.** `labelLineHeight` (per breakpoint, with a Custom label size).
  - **Link list.** `dividerAfterLast` draws the rule under the last row too.
  - The editor fields carry English and Polish labels.

- 3ccf23b: Brand settings: a type and spacing scale for tablets and small desktops.

  The brand tokens take an optional `tierScale` with a `tablet` and a `smallDesktop` factor (0.5–2). `brandTokensToCss` then rebinds every type size and spacing step from 768 to 1023 px to the mobile value times the tablet factor, and from 1024 to 1279 px to the desktop value times the small-desktop factor. The gutters and the container are not scaled, nor are sizes a block sets in its own pixels.

  Without factors (or with 1) the CSS output is byte for byte what it was, and a stored set without `tierScale` parses as before. The **Brand** screen offers both factors in its Layout card, empty meaning 1, with English and Polish labels.

- 3ccf23b: Carousel controls: the dots at the start with the arrows at the end, an aligned row inside split slides, and arrows that stay when every slide fits.

  Nothing changes for content that does not use them: unset, every carousel renders the markup it had.

  - **Dots at the start, arrows at the end.** `controlsAlign` accepts `dots-start` per breakpoint (root `cmsc-pb-carousel--ctl(-md|-lg)-dots-start`) on the Carousel, the product slider and the latest posts carousel. The markup and its reading order are unchanged; the stylesheet moves the dots row first.
  - **Inside split slides.** A chosen `controlsAlign` now also aligns the controls drawn inside a split slide (`cmsc-pb-carousel__controls--al-*`, every breakpoint written). Unset, that row keeps its start alignment.
  - **Arrows when everything fits.** `controls.arrowsWhenFit` keeps the controls when every slide is already on screen: both arrows disabled (taking the disabled arrow look, on a looping carousel too) and the dots hidden with their space kept. Off, the controls hide as before. `CarouselShell` takes `keepArrowsWhenFit`.
  - The editor fields carry English and Polish labels.

- 3ccf23b: The carousel split slide takes its layout, corners and text look.

  Nothing changes for content that does not use them: every new option is optional, and a split slide saved before renders the same markup.

  - **Breakpoint.** `sideBySide: 'desktop'` keeps the media and the text stacked on a tablet and places them side by side from 1024 px (`data-side-by-side="desktop"`); unset is today's 768 px.
  - **Columns.** A `layout` preset (6 + 6, 7 + 5, 5 + 7, 8 + 4, 4 + 8, 5 + 1 + 6, 6 + 1 + 5), or with `layoutAdvanced` the raw `mediaSpan`, `textSpan` and `textOffset`, places the media and the text on a 12-column grid with columns between them (`.cmsc-pb-carousel-split--columns`, `--cmsc-split-media-col`, `--cmsc-split-text-col`), mirrored for media at the end; unset keeps two equal halves 40 px apart.
  - **Corners.** `mediaCornerRadius` (none, small, medium, large) rounds the media; unset is today's 8 px.
  - **Title and text.** `titleSize` / `titleSizePx`, `titleLineHeight`, `bodySize` / `bodySizePx` and `bodyLineHeight` per breakpoint (a line height with a Custom size), `titleWeight` and `bodyWeight`. `titleHangingIcon` hangs a title that starts with an inline icon beside it.
  - The editor fields carry English and Polish labels.

- 3ccf23b: The product listings' header lead look.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

  - **Product grid and product slider.** `leadSize` / `leadSizePx` (per breakpoint), `leadWeight` and `leadColor` for the header's lead, as the latest posts block's lead.
  - The editor fields carry English and Polish labels.

- 3ccf23b: Column layouts and stacking breakpoints for the media-and-text block, the call-to-action card, the stats and the carousel split slide.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup. Values marked per breakpoint are written only for the breakpoints a value reaches.

  - **Media and text.** With `layoutAdvanced` on, `mediaSpan`, `textSpan` and `textOffset` lay every row on a 12-column grid from the side-by-side breakpoint, in place of the split preset, mirrored on rows with the media at the end.
  - **Call-to-action card.** With an image: `mobileImagePosition: 'below'` puts the image after the text while the card is stacked; `sideBySide: 'desktop'` keeps the card stacked on tablets; `imageInsetPx` keeps one value.
  - **Stats.** With an image, `sideBySide: 'desktop'` stacks the image above the figures on tablets.
  - **Carousel split slide.** `bodyIndent: 'title'` starts the text where a hanging title's text starts, after its leading icon; `stackedGap` and `innerSpace` (spacing steps) set the space between stacked media and text, and below the title and above the slide's carousel controls.
  - The editor fields carry English and Polish labels.

- 3ccf23b: Text options for the media-and-text block, the call-to-action card, the heading, rich content, the accordion, the download tile and the image.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

  - **Media and text.** `headingLineHeight` (per breakpoint, with a Custom heading size), `bodyWeight`, and `listMarkerColor` for the check and chevron lists in every row's text.
  - **Call-to-action card.** `bodySize` / `bodySizePx` (per breakpoint) size the text and its list.
  - **Heading.** `textMaxWidth` / `textMaxWidthPx` (per breakpoint), the measure the other text blocks have.
  - **Rich content.** `listLineHeight` (per breakpoint, with a Custom text size).
  - **Accordion.** `titleLineHeight` (per breakpoint, with a Custom title size).
  - **Download tile.** `titleWeight`.
  - **Image.** With a mobile image, `desktopFrom: 'desktop'` keeps it on tablets too, as image fields already allow.
  - The editor fields carry English and Polish labels.

- 3ccf23b: Brand settings: desktop sizes that grow with the window, and button heights in the tier scale.

  All optional; a stored set without them parses as before and `brandTokensToCss` writes the same CSS byte for byte.

  - `tierScale.fluidDesktop` with `tierScale.fluidUntilPx` (else `layout.containerMaxPx`): from 1280 px, each desktop type size and spacing step is `clamp(<px × factor>px, <px × 100 / end>vw, <px>px)`, rising from the small-desktop factor to the full size. Needs a small-desktop factor below 1.
  - `tierScale.buttons: true` scales `--cmsb-btn-h-s|m|l` in the tablet, small-desktop and fluid blocks; icon-only and pill buttons follow.
  - The **Brand** screen's Layout card offers each one (empty or off stores nothing), with English and Polish labels.

- 3ccf23b: A column gap and an anchor of their own for the 12-column layouts of the media-and-text block, the carousel split slide and the stats.

  Nothing changes for content that does not use them: every new option is optional, a block saved before renders the same markup, and the columns keep today's gap.

  - **Column gap.** `columnGapPx` (per breakpoint) on `cms.MediaText`, `cms.CarouselSplit` and `cms.Stats` sets the space between the columns of 12. They no longer have to follow the page's side gutter. Left empty, the gap is the side gutter as before.
  - **Anchor.** `columnsAnchor: 'start' | 'end'` on `cms.MediaText` and `cms.CarouselSplit` starts the media-and-text pair at column 1 or ends it at column 12, whichever side the media is on. Left empty (`'media'`), a row with the media at the end still ends at column 12.
  - The editor fields carry English and Polish labels.

- 3ccf23b: Icon choices and a per-breakpoint feature layout: the feature list's icon position and item widths, a newsletter sign-up button icon, and the download tile's icon button glyph.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

  - **Feature list.** `iconPosition` takes a value per breakpoint, so the icon can sit beside the title on one breakpoint and above it on another; one stored position keeps its meaning. An item's `span` (1–12) sets its width in columns of 12 on desktops. The other items keep their share of the columns.
  - **Newsletter sign-up.** `buttonIcon`, an icon from the catalog, shows after the button's label.
  - **Download tile.** `iconButtonIcon`, an icon from the catalog, replaces the round icon button's glyph. Left empty, the tile shows the download arrow, or the onward arrow for a link.
  - **Icon catalog.** Adds `cloudDownload`.
  - The editor fields carry English and Polish labels.

- 3ccf23b: Line heights, weights, sizes and spacing for the call-to-action card, stats, media and text, rich content, carousel headers, the link list, latest posts and the testimonial.

  Nothing changes for content that does not use them: every new option is optional, and a block saved before renders the same markup.

  - **Call-to-action card.** `headingSpace` (a spacing step) sets the space below the heading. `bodyWeight` and `textMaxWidth` / `textMaxWidthPx` (per breakpoint) style the text.
  - **Stats.** `valueLineHeight` (per breakpoint, with a Custom value size).
  - **Media and text.** `featureBodySize` / `featureBodySizePx` (per breakpoint) and `featureBodyWeight` for every feature item's text.
  - **Rich content.** `textWeight`.
  - **Carousel headers.** `headingLineHeight` (per breakpoint, with a Custom heading size) on the carousel, the product slider and grid, and latest posts.
  - **Link list.** `titleLineHeight` (per breakpoint, with a Custom title size) for the row titles.
  - **Latest posts.** `leadWeight` for the header's lead.
  - **Testimonial.** `quoteSize` / `quoteSizePx` (per breakpoint).
  - The editor fields carry English and Polish labels.

- 3ccf23b: Page builder: one typography rule, 12-column layout presets and spacing steps.

  Content saved before these options renders the same markup.

  - **Typography.** A text sized by a type-scale step takes the brand's line height, weight and letter spacing for that step (`--cmsb-t-<step>-lh`, `-w`, `-ls`, with the built-in values as fallbacks; new class `cmsc-pb-ts-tracking`). A block's own line height applies, and its field shows, only at a breakpoint whose size is Custom (px). The text weights added in this release are one value.
  - **Layout presets.** The carousel split slide, the stats and the call-to-action card take a `layout` preset for their 12-column grid (6 + 6, 7 + 5, 5 + 7, 8 + 4, 4 + 8, 5 + 1 + 6, 6 + 1 + 5; the card offers the first five), the media first and mirrored with its side. `layoutAdvanced` (also on the media-and-text block, whose `split` stays its preset) shows the raw column numbers, which then win; raw numbers saved without the switch read as on.
  - **Spacing steps.** `innerSpace`, `stackedGap`, `cardPadding` and `headingSpace` take a spacing step (None, XS to XXL) from the brand's spacing scale.
  - **Size selects.** The hero's eyebrow, the download tile's title and the image caption take a size select (a type-scale step or Custom); a Custom px saved without a size reads as Custom.
  - The editor fields carry English and Polish labels.

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

- ecdd2f7: Two block presets, both optional; a stored block renders exactly as before.

  - `cms.Accordion`: `itemStyle` accepts `filled` (root class `cmsc-pb-accordion--filled`): each title bar sits on the colour scheme's surface tint (`--cmsc-surface-tint`, today's light neutral outside a scheme), the panel inset below it, items 8 px apart; the dividers fields are hidden for it, as for boxed items.
  - `cms.DownloadTile`: with the round icon button (`linkLook: 'icon'`), `iconButtonSize` (`s` 48 px as today, `m` 72 px, `l` 112 px; class `cmsc-pb-download-tile--icon-<s|m|l>`) and `iconButtonStyle` (`outline` as today, or `filled`: a disc in the text colour with the glyph in the card's background; class `cmsc-pb-download-tile--icon-filled`). Presets only — no px value and no colour.

  `mod-cms` ships the English and Polish editor labels of the new options.

- ecdd2f7: New Page Builder block `cms.PageNavigation` ("Page navigation", category Interactive): a row of jump links to sections of the same page.

  - **Storefront:** a `<nav>` with an accessible name around plain `<a href="#anchor">` links, so it works without JavaScript. A client island highlights the link of the section in view (`aria-current="true"`, `cmsc-pb-page-nav__link--active`), keeps it visible inside a list that scrolls sideways on narrow screens without moving the page, and, for a sticky bar, writes its height to `--cmsc-page-nav-h` so a jumped-to target clears the header and the bar. Following a link scrolls smoothly unless the reader prefers reduced motion. With no valid link the block renders nothing.
  - **Options:** links (label and section anchor, at most 20), accessible name, look `pill` (default) or `underline`, alignment per breakpoint, "Stick to the top while scrolling", spacing, border, hide on. Colours come from the brand tokens and the section's colour scheme.
  - **`@endora-commerce/cms-components`:** exports `PageNavigation`, `pageNavigationItems`, `PAGE_NAVIGATION_MAX_ITEMS`, `usePageNavigationSpy`, the `PageNavigationProps`/`PageNavigationItem` types, and a new optional render-context entry `pageNavigationText` (`CmsPageNavigationText`, hook `useCmsRenderPageNavigationText`) for the default accessible name in the page language. New stylesheet section `.cmsc-pb-page-nav*`.
  - **`@endora-commerce/page-builder-admin`:** exports `createAnchorField(label)`, the link field's in-page anchor picker (the page's section anchors, or free text normalised to the anchor grammar) as a field of its own. The link field is unchanged.
  - **`@endora-commerce/mod-cms`:** declares the block (translatable `label` and `items[].label`) with en/pl labels, and gives its links the anchor picker in the editor. Module documentation page _Page navigation_.

- ecdd2f7: A **Contact form** Page Builder block (`cms.ContactForm`) that e-mails a visitor's message to the shop and stores nothing.

  - **Block:** a fixed field set the server knows — name (shown by default), e-mail and message (always), phone, company, subject and a select with editor-defined options (on request), a required privacy consent and an optional marketing consent, both with inline rich labels. Per field: show, label, placeholder, required, and its width with two columns. Layout and look are presets: one or two columns, field look `boxed` / `underline` / `pill` from the colour scheme, label above or visually hidden, the submit button through the existing button look (no link) with its alignment, and editable "sent", "not accepted" and "unavailable" messages. Posts to the storefront's `/forms/contact` and works without JavaScript; with JavaScript it checks itself and shows the outcome inline. Unset words read the page language's defaults through the new optional `contactFormText` render-context entry.
  - **`ButtonView`:** an additive `type="submit"` rendering (a `<button type="submit">` with the same classes) and `disabled`; every existing rendering is unchanged.
  - **Endpoint:** `POST /api/v1/storefront/cms/contact-form` (public, rate limited to 10 submissions per client address in 10 minutes, honeypot field `website`) sends one e-mail per recipient through the platform mailer, Reply-To the visitor, written in the channel's default language, with a fixed subject and no `meta`, so nothing typed reaches the delivery record. Answers `400 VALIDATION_FAILED`, `409 CMS_CONTACT_FORM_UNAVAILABLE` (new error code: no recipients on the channel), `429`, `500`, and `503` with `cms` off.
  - **Setting:** `cms.contact_form_recipients` (`string_list`, per sales channel, group "Contact form", at most 10 valid addresses, refused otherwise), with the palette action `open-contact-form-settings`. `cms` now depends on `email` and `_i18n` (both non-deactivatable).
  - **Contracts:** `contactFormSubmissionSchema`, `contactFormSubmissionResponseSchema`, `contactFormEmailSchema`, `CONTACT_FORM_LIMITS`, `CONTACT_FORM_MAX_RECIPIENTS` and `ERROR_CODES.CMS_CONTACT_FORM_UNAVAILABLE`.

- ecdd2f7: `newsletter.Signup` picks its topics from the newsletter's tags and can collect subscriber attributes.

  - **Topics:** in the admin, a topic's tag is chosen by name from the newsletter's tags (`GET /api/v1/admin/newsletter/tags`); the block still stores the tag code. A stored code the list does not hold stays selected, and without the list (no `newsletter:read`, the module off) the code is typed as before.
  - **Subscriber attributes (new, optional `attributes`):** up to 10 of the newsletter's custom fields, rendered after the e-mail field and before the topics — a yes/no field as a checkbox, a text, number or date field as the matching input (text at most 500 characters). Each item stores `key`, `type` and `fieldLabel` (picked together in the admin from `GET /api/v1/admin/newsletter/custom-fields`; typed as a key and a type select elsewhere), plus an optional `label`, `placeholder` (not for a yes/no field) and `required`. The form posts `attr.<key>` and one hidden `attrSpec` per attribute; a required attribute left empty is refused in the browser and by the storefront handler with the new `fields` reason, whose message is the block's `messages.fields`, else the page language's text (`CmsRenderProvider`'s new optional `newsletterSignupText`), else English. With no attributes the block's markup is unchanged.
  - `@endora-commerce/page-builder-admin` exports `createNewsletterTagCodeField`, `createNewsletterCustomFieldField`, their controls and `withNewsletterAttributePick`; `mod-cms` swaps them into the block in its editor.
  - `mod-newsletter` declares `attributes[].label`, `attributes[].placeholder` and `messages.fields` as translatable, and ships the new field labels in English and Polish.

### Patch Changes

- 0e33ca9: Carousels (`cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts`) take their element ids from the block's own id instead of React's `useId()`, so the server and the browser always agree on them. `CarouselShell` gains an optional `instanceId` prop; without it the ids still come from `useId()`.
- 3ccf23b: Hero: a Custom "Space after" stored per breakpoint is read per breakpoint instead of rendering as 0 px.
- 0e33ca9: A colour that inherits the surrounding text colour shows as **Inherited (text color)** in the colour field instead of the raw `currentColor`.

  - `createColorField({ label, inherit: true })`: the field's empty state is `currentColor`. It shows an empty box with the **Inherited (text color)** placeholder and a swatch marked as inherited; picking a colour sets it, and **Inherit** (or emptying the box) returns to `currentColor`. Stored values are unchanged.
  - `cms.Icons` **Color** and `cms.Social` **Icon color** use it; a new icon or social list still stores `currentColor`.
  - Any colour field shows a stored `currentColor` or `inherit` as inherited, and the empty box's `transparent` placeholder is translated. New `core` keys `pageBuilder.fieldText.color.inherited`, `.inherit`, `.inheritFor` and `.transparent` (English and Polish).

- 0e33ca9: The page builder's component options panel is easier to read and no longer scrolls sideways at its usual width (about 20rem).

  - `@endora-commerce/page-builder-core`: every custom field control renders with `PB_FIELD_INPUT_CLASS`, which keeps it inside its column. The controls had named a Puck CSS-module class that Puck 0.23 renamed, so they rendered unstyled, as wide as their content, and the panel scrolled sideways wherever a colour field or a long select appeared. The colour field's swatch, text box and Palette button stay on one row that fits the panel, and each control has its own accessible name. A value per breakpoint nested inside an object or array item (an image's aspect ratio) shows one label and a Mobile / Tablet / Desktop switch instead of three columns of controls, and a breakpoint with its own value is marked; a top-level value per breakpoint stays a field of the Responsive tab. Top-level fields are separated by a rule again. New exports: `PB_FIELD_INPUT_CLASS`, `PB_FIELD_LABEL_CLASS`, `PB_FIELD_HINT_CLASS`, `FieldControlLabel`, `ResponsiveTiers`, `FIELD_TIERS`, and `PAGE_BUILDER_FIELD_TEXT`, `PageBuilderFieldTextProvider` and `useFieldText`, through which a host translates the package's own field controls. `PuckFieldLabel` takes Puck's `el`.
  - `@endora-commerce/page-builder-admin`: `PageBuilderFieldText` translates those controls from the `core` bundle and is mounted by `PageBuilderColorPaletteProvider`, so the page and e-mail editors both get it. The image field's aspect ratio uses the same breakpoint switch. The link and image fields use the shared input and label classes.
  - `@endora-commerce/cms-components`: the table and catalog fallback controls use the shared input class.
  - `@endora-commerce/mod-i18n`: `pageBuilder.fieldText.*` in English and Polish.

- 3ccf23b: Two visible fixes in the page builder's stylesheet.

  - **Hero social proof.** The social-proof image keeps its 40 px height. The generic picture rule, later in the stylesheet, made it its natural size and cropped it.
  - **Gradient highlight.** A gradient highlight that wraps onto several lines is one gradient across the whole phrase; before, the gradient started again on every line. A highlight on one line looks as before. This changes how wrapped gradient highlights already on pages look.

- 3ccf23b: Page builder fixes: column outsets keep the box's outer spacing, empty headings render nothing, and no React key warning on media-and-text videos.

  - A Column's background outset replaced the box's own outer spacing at the sides at every breakpoint, also where the outset was 0. The outset is now the cell's, and the box keeps its side spacing on top of it.
  - An inline heading holding only blank text or line breaks rendered an empty heading element (Media and text, Hero, carousel and tile titles); it now renders nothing. A published Heading block left empty keeps its box but writes no heading element.
  - `MediaTextMediaFrame` no longer spreads a props object holding `key` into `<video>` (React's development warning).

- 3ccf23b: A hero's social-proof caption placed below the image now always starts a line of its own.

  With the caption below the image at a breakpoint and a custom caption max width, a caption narrow enough to fit beside the image stayed beside it: the max width capped the full-width basis that was meant to break the line. The row now breaks before the caption whatever its width, and the max width still holds the caption to its measure. The space between the image and the caption is unchanged. Stylesheet only; the markup is the same.

- 3ccf23b: A text whose type token differs per breakpoint now takes each breakpoint's line height, weight and letter spacing from that breakpoint's token.

  Before, a carousel header heading set to Heading 3 on phones and Heading 2 on the desktop (and likewise a section heading, a hero text, a `cms.Heading` or an item text) took the desktop size but kept Heading 3's line height, weight and tracking. Such a text now carries `cmsc-pb-text-token` and `--pb-text-lh`, `--pb-text-w`, `--pb-text-ls` (`-md`, `-lg`) from each breakpoint's token; a breakpoint sized in Custom px keeps the class token's values, and a weight or line height the block sets itself still wins. **Visible change** for stored texts with a mixed token. A text with one token at every breakpoint renders exactly as before.

- 3ccf23b: A row's vertical alignment now applies on published pages, and a call-to-action card's two-column list follows the card's side-by-side breakpoint.

  - **Row.** Columns no longer stretch themselves, so **Align columns** (top, middle, bottom) places them on the storefront as it does in the editor. A row left on stretch, the default, looks the same. A stored `'center'` (the media-and-text wording) is read as `'middle'`.
  - **Call-to-action card.** With `sideBySide: 'desktop'`, a two-column list stays in one column on tablets while the card is stacked. Cards side by side from the tablet keep two columns from 768 px.

- ecdd2f7: Carousel arrows kept with **Keep the arrows when all slides fit** (`controls.arrowsWhenFit`) are legible again. Every carousel block (`cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts`, and split slides drawing the controls) still rendered both arrows, disabled, but drew them with the generic dimmed look — 40 % of an already light ring — so on a light or muted section, or over a slide, they were next to invisible. While the arrows are kept because everything fits, the shell now adds `cmsc-pb-carousel--arrows-kept` to the carousel root, and the stylesheet draws such a disabled arrow at full opacity on the colour scheme's background with its border and muted text colour (`--cmsb-bg`, `--cmsb-border`, `--cmsb-fg-muted`, today's literals outside a scheme). An explicit **Disabled arrow look** (light outline or colour) still wins. A carousel with the option off renders the same markup as before.
- ecdd2f7: **Behaviour change for storefronts:** an empty listing block renders nothing. `catalog.ProductSlider`, `catalog.ProductGrid`, `catalog.CategoryGrid` and `catalog.CategoryList` that resolve no items on the storefront now return no element — no box, no header and no untranslated "No products found" / "No categories found" sentence — as `blog.LatestPosts` already did. The editor preview keeps its explanatory note. No block option was added.
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
- Updated dependencies [0e33ca9]
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
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [c73366c]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [eeed924]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
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
  - @endora-commerce/contracts@0.109.0
  - @endora-commerce/page-builder-core@0.109.0

## 0.108.0

### Minor Changes

- e6f3a78: Unit prices are shown by the one rule of the owner ruling of 2026-10-25: two places when the third and fourth are zero, otherwise the significant places, up to four (`0,0125 zł`, `1,50 zł`, `1,505 zł`); line values and totals keep two.

  - `@endora-commerce/mod-invoices`: the invoice PDF's unit net price column (new `unitMoney` beside `money` in the PDF sections), the admin invoice screen and the template preview.
  - `@endora-commerce/mod-carts`, `@endora-commerce/mod-customers`: the admin cart and the customer's cart history.
  - `@endora-commerce/mod-comparisons`: a compared product's price on the screen, the canvas and the PDF (`1.50 PLN`, `0.0125 PLN`), where it was rounded to two places.
  - `@endora-commerce/mod-crm`: an Opportunity's value of a linked Quote Request adds the quote's line values, each rounded to the cent once, as the quote desk does; it rounded only the sum.
  - `@endora-commerce/cms-components`: the CMS product card's price; the package now depends on `@endora-commerce/contracts` for the rule.

### Patch Changes

- Updated dependencies [0bd5a2b]
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
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/page-builder-core@0.108.0

## 0.107.0

### Patch Changes

- 5b4312a: `sanitizeHtml` and `sanitizeRichHtml` now share one DOM-free sanitiser, so a server render and a client render of the same props produce identical markup. The input is tokenised and the output rebuilt from the tokens the policy admits: event handler attributes are always removed, `href`/`src` and other URL attributes keep only `http`, `https`, `mailto`, `tel` and relative URLs (character references are decoded before the scheme is read), and a `<` that does not start an emitted tag is escaped. With sanitising on, the tag and attribute allowlist is unchanged and is now applied on the server too. With sanitising off (trusted HTML), arbitrary elements and attributes are still kept, but scripts, event handlers, `srcdoc`, URLs outside the schemes above (including `data:`), and inline styles containing `url(` or `expression` are removed. `sanitizeRichHtml` keeps the markup the rich text editor writes — colour and alignment styles, `class`, link `target`/`rel`, image `title` — and drops other attributes.
- 39c8e03: `CmsProductCardView` formats its price in the language of the tree it is rendered in — `useBlockRenderEnvironment().language` from `@endora-commerce/page-builder-core/contributions`, which the storefront sets to the request's locale — instead of a hard-coded `pl-PL`. Product cards in `ProductGrid` and `ProductSlider`, which never passed a locale, now follow the shopper's language. An explicit `locale` prop on `CmsProductCardView` or `CmsProductCardLoader` still wins. A host that provides no block render environment gets that environment's default, `en`, where it used to get `pl-PL`.
- Updated dependencies [dd939be]
  - @endora-commerce/page-builder-core@0.107.0

## 0.106.0

### Patch Changes

- @endora-commerce/page-builder-core@0.106.0

## 0.105.0

### Patch Changes

- 964ada7: Catalogue blocks on a CMS page are part of the server-rendered HTML. `ProductGrid`,
  `ProductSlider`, `ProductCard`, `CategoryList` and `CategoryGrid` used to fetch their own data
  from an effect, so the document a crawler, a link preview or a browser without JavaScript received
  held a skeleton and no product or category at all.

  Each block now declares the data it needs, and the application rendering the page resolves it on
  the server:

  - `@endora-commerce/cms-components/utils/catalog-block-data` (new, importable from a Server
    Component) exports `collectCatalogBlockDataRequests(documents)`, `resolveCatalogBlockData(requests,
source)` and `catalogBlockDataKey(request)`. The resolver reads each distinct product, listing
    and the category tree once, in parallel with a bound of six, and leaves a failed read out so
    that only its block degrades.
  - `CatalogPreviewProvider` takes a new optional `data` prop — the resolved answers — and its
    `api` prop is now optional. With `data` present a block renders from it during the server
    render and during hydration: it does not fetch on mount and never shows its loading state. A
    request with no answer renders the block's existing empty state.
  - Without `data` nothing changes: the admin page builder still passes `api`, and a block with
    neither still fetches from an effect and shows its skeleton meanwhile.

  All of it is additive; no existing prop or export changed meaning.

  The storefront `endora new` writes does the resolving: `components/CatalogBlockData.tsx` is a
  Server Component that `CmsPageRenderer` and `Hook` mount around their Page Builder trees, and
  `lib/page-builder/catalog-block-data.ts` reads through `lib/api/catalog` with the request's
  context, so a block shows the sales channel's catalogue in the request's language and, for a
  signed-in buyer, that buyer's prices — fetched `no-store`, as the product listing's are.
  `CmsPageRenderer` now requires a `ctx` prop for that reason.

  A storefront that already exists keeps the source it was created with. Upgrading
  `@endora-commerce/cms-components` alone changes nothing there — its blocks keep fetching in the
  browser as before — until it mounts the provider with `data`: copy the two files above and wrap
  the `PageBuilderRender` call sites as the reference storefront does. Other render sites of the
  reference storefront (blog post bodies, category page content, the megamenu and the consent
  messages) are not wrapped yet and behave as before.

- @endora-commerce/page-builder-core@0.105.0

## 0.104.0

### Patch Changes

- @endora-commerce/page-builder-core@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/page-builder-core@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
  - @endora-commerce/page-builder-core@0.103.0

## 0.102.0

### Minor Changes

- 255b60b: The page builder's editor peer moves from `@measured/puck` to `@puckeditor/core`. Puck renamed
  its package at 0.21 (`npm install @measured/puck` now prints _"Puck has moved"_), and these
  packages now import `@puckeditor/core` 0.23 — the code, the types and the stylesheet
  (`@puckeditor/core/puck.css`).

  **What a consumer changes.** If your project declares the editor itself — an admin application
  that bundles `@endora-commerce/page-builder-admin`, `@endora-commerce/mod-cms` or any of the
  modules above, or a storefront rendering pages through `@endora-commerce/cms-components`:

  ```bash
  pnpm remove @measured/puck
  pnpm add @puckeditor/core@^0.23.0
  ```

  and rename the specifier in any import of your own (`'@measured/puck'` → `'@puckeditor/core'`,
  `'@measured/puck/puck.css'` → `'@puckeditor/core/puck.css'`). A project scaffolded with
  `create-endora-commerce` / `endora new instance` gets the new name at its root from this release
  on; an existing instance renames the one line in its root `package.json`. Leaving
  `@measured/puck` installed does not satisfy the peer — the two names are different packages —
  so a bundler resolves `@puckeditor/core` to nothing and the editor fails to build.

  **Stored content is unchanged.** Puck 0.21–0.23 changed no part of the page data shape: CMS
  pages, blocks, templates, blog bodies, e-mail templates, newsletter blocks and invoice templates
  persisted under 0.20 render and edit as they did, with no migration and no read-time adapter.

  **The editor looks and behaves as it did.** Three 0.21–0.23 defaults that reshape the editor are
  pinned back for every builder host through new exports of `@endora-commerce/page-builder-core/editor`:
  `withPuckLegacySideBar(plugins)` keeps the stacked Components + Outline side bar instead of the
  0.21 Plugin Rail, `PUCK_LEGACY_VIEWPORTS` keeps the 0.20 Small / Medium / Large viewports without
  the 0.21 full-width one (the CMS host keeps passing its own breakpoints), and `PUCK_LEGACY_DND`
  keeps the 0.20 fluid drag-and-drop instead of the 0.23 insertion line. A host of your own built on
  these packages can pass the same three to its `<Puck>`.

  `@puckeditor/core` 0.23 requires Node 20 or later, below this platform's own floor (22.17).

### Patch Changes

- Updated dependencies [255b60b]
  - @endora-commerce/page-builder-core@0.102.0

## 0.101.1

### Patch Changes

- @endora-commerce/page-builder-core@0.101.1

## 0.101.0

### Patch Changes

- 89b0de3: `pnpm install` no longer reports four unmet `@tiptap/core` peers under `@endora-commerce/cms-components`. The package declared `@tiptap/extension-color`, `-highlight`, `-image`, `-text-align` and `-text-style` at exactly `3.31.3` beside `@tiptap/core`, `@tiptap/react` and `@tiptap/starter-kit` at `^3.31.3`. Every Tiptap package peers on its siblings at its own exact version, so once `3.31.4` was published a fresh install took the caret entries forward and left the pinned extensions asking for a core that was no longer installed. All eight are now `^3.31.3` and resolve together. Nothing to do on upgrade; a project that pins Tiptap itself should pin the whole family at one version.
- @endora-commerce/page-builder-core@0.101.0

## 0.100.2

### Patch Changes

- 61bc20a: The eight `@tiptap/*` packages and `leaflet` are now regular `dependencies` of `@endora-commerce/cms-components` instead of optional peers. The package's entry point imports Tiptap statically and its `Map` component loads `leaflet`, so they were never optional for anyone who bundles it — and pnpm does not install an optional peer, so an instance scaffolded with `--module cms` could end up declaring none of them and its admin build stopped on `"TextStyle" is not exported by "__vite-optional-peer-dep:@tiptap/extension-text-style:…"`. Installing the package now brings them. An application that declared them by hand to satisfy the old peers can drop those entries; keeping them is harmless.
- @endora-commerce/page-builder-core@0.100.2

## 0.100.1

### Patch Changes

- @endora-commerce/page-builder-core@0.100.1

## 0.9.5

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [32fdf20]
  - @endora-commerce/page-builder-core@0.9.5

## 0.9.1

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

- Updated dependencies [8f61a6b]
  - @endora-commerce/page-builder-core@0.9.1

## 0.9.0

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

- Updated dependencies [0eeb9b5]
  - @endora-commerce/page-builder-core@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [e27bf6c]
  - @endora-commerce/page-builder-core@0.8.0

## 0.7.0

### Major Changes

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

- 11fc9f3: Renamed from `@b2b/cms-components` to `@endora-commerce/cms-components`. Nothing else
  about the package changed — same components, same `exports` subpaths, same stylesheet.

  Update the dependency and every specifier, including the CSS one:

  ```diff
  -"@b2b/cms-components": "workspace:^"
  +"@endora-commerce/cms-components": "workspace:^"
  ```

  ```diff
  -import { CmsRenderProvider } from '@b2b/cms-components';
  -import '@b2b/cms-components/styles.css';
  +import { CmsRenderProvider } from '@endora-commerce/cms-components';
  +import '@endora-commerce/cms-components/styles.css';
  ```

  Its peer `@endora-commerce/page-builder-core` is renamed in the same release; both
  specifiers must move together, or the application resolves two copies of the Page Builder
  runtime and its React context reads `null`.

- afedd32: `defaultPageBuilderConfig`'s hidden drawer is keyed `internal`, not `_internal`.

  ```ts
  // before
  defaultPageBuilderConfig.categories._internal; // { title: 'Internal', visible: false, … }
  // after
  defaultPageBuilderConfig.categories.internal;
  ```

  Same word, same title, same `visible: false`, same two components (`Column` and
  `Slide`) — only the key moves. A declared palette section's key is
  `^[a-z][a-z0-9_]*$` (`blockCategoryKeyRe` in `@endora-commerce/contracts`), which
  forbids a leading underscore, and this section becomes `mod-cms`' `internal`
  declaration.

  It is a major because the key is part of an exported object: anything indexing
  `categories._internal`, or deriving a translation key from it, has to move in the
  same release. In this repository that is one i18n key,
  `pageBuilder.categories._internal` in `@endora-commerce/mod-cms`' bundles, which
  moves with it.

- f66ce9b: `@endora-commerce/cms-components` now ships compiled JavaScript and declarations. `main`, `types` and
  every `exports` subpath resolve under `./dist`; `files` is `["dist"]`. `./styles.css`
  already pointed at `./dist/cms-components.css` and is unchanged — the `build` script now
  runs `tsc` first and the Tailwind step second.

  **What changes for you.** No import statement moves: `@endora-commerce/cms-components`,
  `@endora-commerce/cms-components/components/*`, `@endora-commerce/cms-components/schema/*` and the `./*` wildcard
  all keep their names and reach the same modules, one directory over. What can go is the
  `transpilePackages` entry, loader or bundler plugin you needed to compile its `.tsx`
  source. `"use client"` survives the emit as the first line of each file.

  **Five dependencies became optional peer dependencies**, and this is the part to read.
  The package imports `@tiptap/extension-color`, `@tiptap/extension-highlight`,
  `@tiptap/extension-image`, `@tiptap/extension-text-style` and `leaflet` from published
  source, and declared all five as **devDependencies** — which are not installed for you.
  Nothing said so: with the package distributed as TypeScript you compiled it yourself and
  your own install happened to satisfy them, or the import sat in a code path you never
  reached. Shipping `dist` makes them real specifiers in real emitted JavaScript, so they
  are now declared where a consumer can see them, beside the four Tiptap peers that were
  already there:

  ```
  peerDependencies:      + @tiptap/extension-color @tiptap/extension-highlight
                         + @tiptap/extension-image @tiptap/extension-text-style + leaflet
  peerDependenciesMeta:  all five optional
  ```

  Optional, so an install that does not want the rich-text editor or the map is not warned
  at. `leaflet` was already listed under `peerDependenciesMeta` with no matching
  `peerDependencies` entry, which declares nothing at all; it does now. If you render
  `RichContent` or `Map` and have not installed these, that was already broken and is now
  visible at install time instead of at runtime.

  **One hand-written declaration does not ship.** `src/types/leaflet.d.ts` is source, not
  emit, so it is not in `dist`. Nothing in the published surface references it — the
  `leaflet` import is dynamic and its type does not reach a public signature — but a change
  that puts it there would need the file published with it.

### Minor Changes

- 5fc0550: A stored Page Builder block whose owning module is absent now degrades to a visible,
  data-preserving placeholder instead of vanishing.

  **`@endora-commerce/cms-components`** gains `withMissingBlockPlaceholders(config, storedNames)`.
  Give it a Puck `Config` and the block names a stored document carries, and every name the
  config cannot render comes back keyed to a placeholder that names the block and its owning
  module. It adds no category entry: a degraded block stays editable where it already is and is
  insertable by nobody.

  ```diff
   const filtered = filterConfigByContext(merged, context);
  +const degraded = withMissingBlockPlaceholders(filtered, [...countBlockNames(doc).keys()]);
  ```

  It takes names rather than the document deliberately — a React caller needs a stable memo key,
  and a keystroke inside a text block moves the document without moving its names.

  **`makeMissingComponentConfig` gains a third, optional argument**, `{ visible?: boolean }`.
  Existing calls are unchanged: omitting it keeps the placeholder deciding for itself from the
  `?cms_admin=1` preview parameter, which is right for a customer-facing surface. Pass
  `{ visible: true }` on an editing surface, where the operator has to be told which module the
  block is waiting on.

  **`@endora-commerce/page-builder-core`** exports `countBlockNames`, `mapBlockNames`,
  `renameBlockNames` and their two types from the package root. They were reachable only through
  the `./migration` subpath, which still exports them, so no existing import changes. What that
  subpath quarantines is the frozen rename map; the walk itself is a generic "which node `type`
  values does this document hold" and is now needed at runtime.

  **`@endora-commerce/mod-cms`**'s `PageBuilderEditor` applies both. Its canvas previously
  rendered nothing at all for a block whose owner had been switched off — indistinguishable
  from a block somebody had deleted — because the placeholder it merged was built only for
  names the backend descriptor declares, and a switched-off module's blocks are filtered out
  of that descriptor. Every placeholder it did merge rendered an empty `<span>`, the
  `?cms_admin=1` parameter being set by nothing.

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

### Patch Changes

- 1f07b01: New package: `@endora-commerce/page-builder-admin`, the admin-side page-builder chrome and
  the e-mail builder (feature 091 P5b; owner ruling D-192, widened in name only by
  `admin-component-contribution.md` Z1.2).

  Two subpaths. **`.`** publishes the chrome any builder composes — `PageBuilderHeaderActions`
  with `PageBuilderHeaderShell` and `PageBuilderTemplateActions`, the `createImage*` /
  `createSlideImage` / `createVideo*` asset field factories, the `create*Slug*` catalog field
  factories, `PageBuilderColorPaletteProvider`, `ColorPaletteModal`,
  `PageBuilderOverlayBridge`, `QuickTooltip` / `wrapQuickTooltip`, the `action-bar-target`
  store and `emptyPageBuilderData` / `isEmptyPageBuilderData`. **`./email`** publishes the
  e-mail builder those primitives compose — `EmailEditorPane`, `EmailVariablesProvider`,
  `EmailSubjectWithVariables`, `mergeEmailVariables`, `createEmailBuilderEditorPlugin` and the
  three template operations `saveCanvasAsEmailTemplate`, `listEmailTemplatesForApply` and
  `loadEmailTemplateCanvas`.

  **Why a fourth `page-builder` family member rather than a directory in `cms`.** All of it
  lived in `admin/src/modules/cms/components/` and `admin/src/modules/_shared/email-builder/`,
  and none of it names `cms`: `cms` held the chrome because `cms` was the first builder
  written. `cms` publishing it would make `transactional_emails` depend on `cms` in order to
  build an e-mail, and the admin kit refuses it on shape — every file here is a Puck component
  or field factory, so the kit would put `@measured/puck` behind the admin design system for
  all 66 module packages.

  **It is in the `linked` group** with `@endora-commerce/page-builder-core`,
  `@endora-commerce/cms-components` and `@endora-commerce/email-components`, and it peers on
  all three plus `@endora-commerce/admin-kit`. The peer ranges are load-bearing rather than
  tidy: `PageBuilderColorPaletteProvider` wraps `page-builder-core`'s `ColorPaletteProvider`
  context and `EmailVariablesProvider` is a context of its own, so a consumer that resolves two
  copies of either gets a `null` context at runtime and no type error.

  **Nothing here is new code.** Every binding is the one that stood in `admin/src`, and
  `admin/src` keeps a re-export shim at each old path, so an existing `@/modules/cms/components/…`
  specifier resolves to the package's own binding rather than to a copy.

  `@endora-commerce/cms-components` is patched because nothing of its own changed: it is listed
  so the release records that this package compiles its source and peers on its range.

- a92d972: Comments only — no exported symbol, type or behaviour changes.

  Four `ComponentConfig.render` functions gain an `eslint-disable-next-line
react-hooks/rules-of-hooks` and the sentence explaining it: Puck mounts `render` as a React
  component, so the hook call inside it obeys the rules of hooks, and the linter objects to the
  field's name rather than to the call. It is recorded here because `tsc` does not strip
  comments, so the emitted `dist` differs.

- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [b9d15af]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [e1465e0]
  - @endora-commerce/page-builder-core@0.7.0
