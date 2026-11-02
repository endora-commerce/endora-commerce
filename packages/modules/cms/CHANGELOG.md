# @endora-commerce/mod-cms

## 0.109.0

### Minor Changes

- 0e33ca9: The page editor's preview of a product listing shows the same line under each product name as the storefront, and the option says what each line is.

  - `@endora-commerce/contracts` exports `productSummaryText(description)` and `PRODUCT_SUMMARY_MAX_LENGTH`, moved from `@endora-commerce/mod-catalog`, which re-exports them from the same module path. The rule is unchanged.
  - `@endora-commerce/mod-cms`' admin preview maps a product's description to its card `summary` through it (`mapAdminProductToCmsSummary`), in the language its name is picked in. The summary line, and a Showcase card's default line, were always empty in the editor.
  - `catalog.ProductGrid` and `catalog.ProductSlider` label `cardTextLine` **Text under the product name**, with **Card style default (SKU; summary on Showcase)**, **Short description (from the product description)**, **SKU** and **None**, in English and Polish. The stored values are unchanged.

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

- 0e33ca9: New page-builder blocks for marketing pages, and ready-made sections in the editor.

  - `cms.MediaText` — rows of image or video beside a heading, rich text and buttons, with the split ratio, side, mobile order and vertical alignment per row.
  - `cms.BackgroundPanel` — content over a full-width, art-directed background image with an icon, heading, text and buttons; minimum height per breakpoint.
  - `cms.CtaCard` — a call-to-action card with an optional image side and decorative backdrop.
  - `cms.Statement` — a large statement heading and body, optionally full-bleed when it carries an image.
  - `cms.LinkList` — up to 50 rows of a title, a description and a button, with dividers.

  Each is exported from `@endora-commerce/cms-components` (`MediaText`, `BackgroundPanel`, `CtaCard`, `Statement`, `LinkList`, with their props types). `@endora-commerce/mod-cms` declares them, their translatable fields and their English and Polish labels.

  The page editor of `@endora-commerce/mod-cms` adds a _Ready-made sections_ group above the block list: a hero, media with text, a call-to-action card, a downloads carousel, a feature grid and a statement, each one `cms.Section` holding its block, inserted after the selected block's top-level Section (or at the end of the page). The preset trees are `SECTION_PRESETS` in `@endora-commerce/cms-components/editor/section-presets`.

- 0e33ca9: CMS pages get a breadcrumb parent, breadcrumb display options and a sharing image.

  - `@endora-commerce/mod-cms` adds four columns to `cms_pages` (migration `20261023T052237_cms_page_tree_and_share`): `parent_page_id` (self-reference, cleared when the parent is deleted), `breadcrumbs_visible` (default `true`), `breadcrumbs_scheme` (`light`, `muted` or `dark`, default `light`) and `share_image_asset_id`. The parent only shapes the breadcrumb trail; it never changes the page's URL. A parent that would create a cycle, or a tree deeper than eight levels, is refused with `422` (`CMS_PAGE_PARENT_CYCLE` for a cycle) and nothing is written or audited. Saving a page invalidates the cached pages below it.
  - The storefront page read returns `breadcrumbs: { visible, scheme, trail }` (each crumb's `slug` is `null` when the ancestor is not published on the request's sales channel), `share: { imageUrl }` (the page's own public image, else the new per-channel setting `cms.default_share_image_asset_id`) and `languages` (the page's languages that carry content). A page that sets nothing keeps today's trail and look.
  - The page editor adds a _Breadcrumbs_ card (parent page, visibility, scheme) and a _Sharing_ card (image from the asset library). Deleting an asset used as a sharing image is refused like any other referenced asset.
  - `@endora-commerce/contracts`: `cmsBreadcrumbsSchemeSchema` / `CmsBreadcrumbsScheme`; `parentPageId` on the admin page summary; `breadcrumbsVisible`, `breadcrumbsScheme` and `shareImageAssetId` on the page detail (all required in responses, optional on create and patch); `breadcrumbs`, `share` and `languages` on `cmsResolvedPageSchema`; `parentPageId` on `CmsPageRecord`; the error code `CMS_PAGE_PARENT_CYCLE`. Code that constructs these response objects or a `CmsPageRecord` must supply the new fields.

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

- 0e33ca9: The page builder's settings panel speaks one language: one switch for every on/off setting, and every label translated — the settings every block shares translated once.

  Nothing stored changes: a switch stores the same `true` / `false` the Yes/No choices stored.

  - `@endora-commerce/page-builder-core` exports `createToggleField({ label, defaultValue?, metadata? })` — a `role="switch"` button inside its label, operable by pointer and keyboard, showing the block's default while the prop is unset; with the responsive metadata it edits the breakpoint the Responsive tab selects — and `ToggleSwitch` for a custom control's own on/off setting. Every Yes/No radio of the bundled blocks, the row's "Clip content", a video's autoplay, muted, loop and controls, a carousel's loop, autoplay and equal heights, its arrows and dots (now **Show arrows** / **Show dots**), the border's **Show border**, the section reveal's desktop-only, a media-and-text video's autoplay and a link's **Open in new tab** are switches.
  - Shared fields carry their key: `withSharedFieldLabel(key, field)`, `sharedFieldLabel(field)` and `PAGE_BUILDER_SHARED_FIELD_KEYS` (editor name, Hide on, order in the column, box spacing, border, background, rounded corners, shadow, colour, typography, minimum height). The admin translates such a field from the `core` bundle's `pageBuilder.sharedFields.<key>` after the block's own key and before the English; a block that relabels a shared field keeps its own key. `applyPageBuilderTranslations` takes the shared resolver as a fifth argument, and translates the options a custom field carries.
  - The words inside the page builder's controls — spacing, border (a border side now labels its **Width (px)**, **Style** and **Color**), the per-breakpoint hints, the editor's name, the background control and the asset picker — come from the `core` bundle in English and Polish.
  - `withHideOn` puts **Hide on** back when a block's own `resolveFields` returns a field set without it (the heading, row, table and map had lost it).
  - Every bundled block's field and option labels resolve in Polish; the block keys are in the declaring module's bundle (`cms`, `catalog`, `blog`, `newsletter`), the shared ones in `core`. Labels use US spelling (**Color scheme**, **Center**), one wording (**Email**, **Alt text**, **Minimum height**, "Custom … (px)", **Rounded corners**), and side choices read **Left / Right**.

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

- 3ccf23b: `cms.BackgroundPanel` gains **Transparent text box** (`textBoxTransparent`, a switch, off by default). On, the panel carries `data-text-box="transparent"` and its text box paints no background of its own, so the image shows through behind the text. Off or unset, the panel renders as before. English and Polish labels in `@endora-commerce/mod-cms`.
- 3ccf23b: The storefront page payload's `breadcrumbs.trail[].name` is now each ancestor's page **name**, the same source as the current page's crumb. It used to be the ancestor's meta title in the served language, falling back to the name, so one trail mixed browser titles and page names. A storefront that wants another label per crumb must now read it elsewhere.
- 3ccf23b: A CMS save or publish answers once the storefront has dropped its cached copy, so the next storefront request shows the new content.

  - `@endora-commerce/platform`: `StorefrontRevalidator` logs a call the storefront refuses (`{ status, tags }`; a 401 means `REVALIDATE_SECRET` differs between the backend and the storefront) and gives up after `timeoutMs` (new option, default 3000 ms). Both used to pass silently.
  - `@endora-commerce/mod-cms`: `CmsContentInvalidator` awaits its `publish` callback, which may now return a promise (`CmsModuleOptions.publishContentChange: (change) => void | Promise<void>`). The module dispatches `cms.content_changed.v1` in an EventBus scope and its storefront-revalidation subscriber returns the revalidation, so a page, block, template or hook write waits for it (bounded by the revalidator's timeout, never failing the write).

- 3ccf23b: `cms.Column` gains **Background outset (px)** (`outsetPx`, per breakpoint, Responsive tab). Set above 0, the column cell carries `data-pb-outset` and `--pb-col-outset(-md|-lg)`; its box — background, border and shadow — reaches that far past the column track on each side, and the box's content layer is padded back so the content stays in place. Unset or 0 everywhere, the column renders as before. `@endora-commerce/mod-cms` lists `outsetPx` among the Column's `responsiveFields`, with English and Polish labels.
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

### Patch Changes

- 0e33ca9: Restrained motion for page-builder sections, off by default. A `cms.Section` can fade up as it scrolls into view, and `cms.Hero` and `cms.Statement` can reveal their statement word by word (`reveal: { effect: 'none' | 'fade-up' | 'words', desktopOnly }`). `cms.LinkTile` and `cms.CarouselSplit` gain an optional `hoverZoom` on their image. Nothing moves under `prefers-reduced-motion`, in the editor canvas or without `IntersectionObserver`, and content already on screen when the page loads is shown as is, so the largest paint is never delayed.

  `@endora-commerce/cms-components` exports `useReveal`, `RevealValue`, `splitWords`, `countWords`, `splitHtmlWords` and `WORD_CLASS`; `InlineRich` accepts `wordStart`. `@endora-commerce/mod-cms` adds the field labels in English and Polish.

- 0e33ca9: An accordion's title weight can differ per breakpoint, and the space below an open panel and after an open item can be set.

  Nothing changes for content that does not use them: the default markup and look are the ones the block had.

  - **Title weight per breakpoint.** `cms.Accordion`'s `titleWeight` accepts a value per breakpoint as well as one weight, on the Responsive tab. A single stored weight renders as before (an inline weight on every title). Weights that differ write `--cmsc-acc-title-weight` / `-md` / `-lg` on the root with the class `cmsc-pb-accordion--title-weight`; a breakpoint without a weight of its own keeps the usual weight.
  - **Space below an open panel.** `panelPaddingBottom` / `panelPaddingBottomPx`: a spacing token or a Custom px per breakpoint for the space under an open panel's content (12 px when unset). It opens and closes with the panel.
  - **Space after an open item.** `openItemGap` / `openItemGapPx`: a spacing token or a Custom px per breakpoint, used instead of the item gap after an item whose panel is open (a breakpoint left unset uses the item gap). It follows the panel's animation.
  - **Labels.** The new fields are labelled in English and Polish.

- 0e33ca9: The page, e-mail and document editors no longer show "(missing renderer)" blocks for the nodes inside a rich text.

  - `@endora-commerce/page-builder-core` exports `countComponentNames(doc)`: the Puck components a document places — an object whose `type` is a string beside a `props` object. `countBlockNames` is unchanged and still offers every `type`, as the block-name migrations and their report need.
  - The editors' degradation merge (`withMissingBlockPlaceholders`) now reads `countComponentNames`. Through `countBlockNames` it took each TipTap node and mark of a rich-text prop (`doc`, `paragraph`, `text`, `image`, `bold`, …) for a stored block and registered a placeholder for it.

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

- 0e33ca9: A "read more" passage revealed above its summary now animates. A link tile's title and label take a resting colour. An accordion gains a title colour, a divider under the title and an icon size.

  Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

  - **Reveal above animates.** Revealed above, the `<details>` is a flex column, so its `::details-content` kept its content height and the passage opened in one frame. Inside the existing animation block (no reduced motion, `interpolate-size` and `::details-content` supported) the stylesheet now sets `min-block-size: 0` on it.
  - **Resting tile colours.** `cms.LinkTile` gains `titleColor` and `labelColor` (`#rrggbb` or `token:<role>`), the colours of the title and of the text-link label at rest. A label shown as a button keeps the button's colours. A hover colour (`titleHoverColor`, `labelHoverColor`) still wins on hover and keyboard focus. Unset, the tile's markup is unchanged.
  - **Accordion title colour, divider position, icon size.** `cms.Accordion` gains `titleColor` (the trigger's colour; the icon follows it), `dividerPosition` (`'item' | 'title'`, for plain items; under the title, an item's line sits between its title and its panel) and `iconSize` (`'s' | 'm' | 'l' | 'custom'`, 16 / 20 / 24 px) with `iconSizePx`. Each is unset by default and writes nothing then.
  - **Labels.** The new fields are labelled in English and Polish.

- 0e33ca9: A URL in the image, icon, logo strip, announcement bar and map marker links, and in the social links, passes the same safe-URL rule as every other link of the page builder: it starts with `https://`, `http://`, `mailto:`, `tel:` or `/`.

  - Any other URL — `javascript:`, `data:`, `vbscript:`, a protocol-relative `//host`, a relative path without a leading `/`, a bare `#fragment` — renders no link: the image, icon, logo, text or marker label stays, unlinked. A social link keeps its icon and name, with the `#` it already had when no address was set.
  - This holds for a URL stored before these blocks took the shared link (`href`) and for a link of kind `url` alike. A safe URL renders as before.
  - `blockLinkTarget` now resolves every kind, a URL included, through `resolveLinkHref`.

- 0e33ca9: Tabs can colour a tab under the pointer, and the panel change can visibly animate as a crossfade or a slide.

  Nothing changes for a tab block that does not use them: with no hover colour and the instant panel change, the markup and look are the ones the block had.

  - **Hover look.** `cms.Tabs` `tabStyle` gains `hoverBackground` and `hoverColor` (a brand token or a hex). Once one is set, the block writes `--cmsc-tabs-hover-bg` / `--cmsc-tabs-hover-fg` and the class `cmsc-pb-tabs--hover`. On pointer devices a tab that is not selected takes those colours under the pointer, with a 200 ms colour transition that is dropped under reduced motion.
  - **Panel change.** `effect` gains `slide` beside `none` (the default) and `fade`. `fade` is now a crossfade: the outgoing panel fades out over the incoming one, and the panels' height animates from one to the other. `slide` adds a short sideways shift in the direction of travel. With an animated effect the panels sit in a `.cmsc-pb-tabs__panels` box. Every panel stays in the server HTML. While the outgoing panel is still shown it is `inert` and `aria-hidden`, and it is `hidden` again after 300 ms. The tab roles, ids and keyboard model are unchanged. Under reduced motion the change is instant.
  - **Removed rule.** The stylesheet no longer has the load-time `.cmsc-pb-tabs--fade .cmsc-pb-tabs__panel:not([hidden])` fade-in or its `cmsc-pb-tabs-fade` keyframes. The crossfade above replaces them.

  The `cms` bundle carries the English and Polish labels for the hover colours and the slide.

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

- 3ccf23b: A heading that starts with an icon can hang its text beside the icon.

  `cms.Heading`'s **Hanging indent after a leading icon** (`hangingIcon`) renders the icon and the rest of the text in two boxes (`<span class="cmsc-hang">`), so a wrapped line starts under the text, not under the icon. `InlineRich` takes the same `hangingIcon` prop. A heading without the option, or without a leading icon, renders as before.

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

- 4bc5c7f: Every asset reference these modules report is tagged with the `assetId` it points at, and each descriptor answers a batch of assets in one statement (`specs/166-asset-reference-visibility/`). The catalog's category content, CMS content and blog content scans used to run one JSON-path query per asset; each is now one query per batch, walking a document once however many assets are asked. Their references stay unrestricted: they never hide a library file.
- ecdd2f7: Two block presets, both optional; a stored block renders exactly as before.

  - `cms.Accordion`: `itemStyle` accepts `filled` (root class `cmsc-pb-accordion--filled`): each title bar sits on the colour scheme's surface tint (`--cmsc-surface-tint`, today's light neutral outside a scheme), the panel inset below it, items 8 px apart; the dividers fields are hidden for it, as for boxed items.
  - `cms.DownloadTile`: with the round icon button (`linkLook: 'icon'`), `iconButtonSize` (`s` 48 px as today, `m` 72 px, `l` 112 px; class `cmsc-pb-download-tile--icon-<s|m|l>`) and `iconButtonStyle` (`outline` as today, or `filled`: a disc in the text colour with the glyph in the card's background; class `cmsc-pb-download-tile--icon-filled`). Presets only — no px value and no colour.

  `mod-cms` ships the English and Polish editor labels of the new options.

- ecdd2f7: `newsletter.Signup` picks its topics from the newsletter's tags and can collect subscriber attributes.

  - **Topics:** in the admin, a topic's tag is chosen by name from the newsletter's tags (`GET /api/v1/admin/newsletter/tags`); the block still stores the tag code. A stored code the list does not hold stays selected, and without the list (no `newsletter:read`, the module off) the code is typed as before.
  - **Subscriber attributes (new, optional `attributes`):** up to 10 of the newsletter's custom fields, rendered after the e-mail field and before the topics — a yes/no field as a checkbox, a text, number or date field as the matching input (text at most 500 characters). Each item stores `key`, `type` and `fieldLabel` (picked together in the admin from `GET /api/v1/admin/newsletter/custom-fields`; typed as a key and a type select elsewhere), plus an optional `label`, `placeholder` (not for a yes/no field) and `required`. The form posts `attr.<key>` and one hidden `attrSpec` per attribute; a required attribute left empty is refused in the browser and by the storefront handler with the new `fields` reason, whose message is the block's `messages.fields`, else the page language's text (`CmsRenderProvider`'s new optional `newsletterSignupText`), else English. With no attributes the block's markup is unchanged.
  - `@endora-commerce/page-builder-admin` exports `createNewsletterTagCodeField`, `createNewsletterCustomFieldField`, their controls and `withNewsletterAttributePick`; `mod-cms` swaps them into the block in its editor.
  - `mod-newsletter` declares `attributes[].label`, `attributes[].placeholder` and `messages.fields` as translatable, and ships the new field labels in English and Polish.

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

- d86466f: The command-palette actions of the content and marketing modules (`analytics`, `assets_library`, `blog`, `cms`, `google_analytics`, `google_tag_manager`, `linkedin_ads`, `megamenu`, `meta_ads`, `newsletter`, `pwa`, `seo`, `transactional_emails`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
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
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [3ccf23b]
- Updated dependencies [0e33ca9]
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
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
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
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
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
- Updated dependencies [eeed924]
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
  - @endora-commerce/page-builder-admin@0.109.0
  - @endora-commerce/cms-components@0.109.0
  - @endora-commerce/page-builder-core@0.109.0
  - @endora-commerce/llm-client@0.109.0

## 0.108.0

### Patch Changes

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
- Updated dependencies [e6f3a78]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/admin-kit@0.108.0
  - @endora-commerce/page-builder-admin@0.108.0
  - @endora-commerce/cms-components@0.108.0
  - @endora-commerce/llm-client@0.108.0
  - @endora-commerce/page-builder-core@0.108.0

## 0.107.0

### Minor Changes

- 8397b0f: Page Builder translation. A **Translate** action in the Page Builder toolbar translates the canvas of the language tab being edited — or only the selected component or text — with the LLM configured in Settings → Page Builder (`cms.page_builder.translation.enabled`, `…llm_credentials`, `…max_source_characters`; off by default), behind the new permission `cms.translate`, through `GET /api/v1/admin/cms/page-builder/translation` and `POST /api/v1/admin/cms/page-builder/translate`. The result is an unsaved change with _Restore previous content_; every request that sent text is audited as `cms.page_builder.translate`.

  For block authors: `BlockDefinition` gains an optional `translatable: [{ path, format? }]` (`format` `plain` | `tiptap` | `html`, paths like `items[].title`) naming the props that are prose; it is served on the Page Builder descriptor. A block without it is never sent to a model. Every CMS-context block of `cms` and `catalog` declares it. `PageBuilderHeaderActions` gains an optional `extraActions` slot, and the blog post and category editors pass the editor what the action needs.

- 0bfab69: The four CMS list screens are now reachable from the command palette (⌘K / CTRL+K): **CMS Pages**, **CMS Blocks**, **CMS Templates** and **CMS Hooks**, in English and Polish. Until now the palette offered only _New page_, so an operator could reach the lists through the sidebar alone.

  Each entry opens its list screen (`/cms/pages`, `/cms/blocks`, `/cms/templates`, `/cms/hooks`), is shown only to a role holding `cms.read` — the code those screens enforce — and draws the same icon as its sidebar row. The entries are declared in the `cms` manifest (`open-pages`, `open-blocks`, `open-templates`, `open-hooks`), so switching the module off removes them with the rest of its surface. _New page_ is unchanged.

### Patch Changes

- d70aeba: `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId` for a block that is not attached to the hook answers `404 CMS_BLOCK_NOT_FOUND` ("CMS Hook attachment not found."), as it was always meant to. It answered `200` with the unchanged attachment list, because the not-found check read a `rowCount` field the database driver's result does not carry. A block that is attached is reordered exactly as before, and detaching a block that is not attached still answers `204`.
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
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
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
- Updated dependencies [5b4312a]
- Updated dependencies [39c8e03]
- Updated dependencies [1525d86]
- Updated dependencies [ad55813]
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
  - @endora-commerce/llm-client@0.107.0
  - @endora-commerce/page-builder-admin@0.107.0
  - @endora-commerce/page-builder-core@0.107.0
  - @endora-commerce/cms-components@0.107.0

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
  - @endora-commerce/page-builder-admin@0.106.0
  - @endora-commerce/page-builder-core@0.106.0
  - @endora-commerce/cms-components@0.106.0

## 0.105.0

### Patch Changes

- 2e355fb: Every admin write to a CMS block, a CMS template and a CMS hook now runs through the Command Bus
  and leaves one audit entry, written in the write's own transaction and attributed to the acting
  admin. Page writes already did; these three kinds changed the row and recorded nothing, so "who
  edited this block" or "who detached it from that hook" could not be answered afterwards.

  - **Blocks** — `objectType: 'cms_block'`, actions `cms_block.create`, `cms_block.update`,
    `cms_block.set_content`, `cms_block.delete`.
  - **Templates** — `objectType: 'cms_template'`, actions `cms_template.create`,
    `cms_template.update`, `cms_template.set_content`, `cms_template.delete`.
  - **Hooks** — `objectType: 'cms_hook'`, actions `cms_hook.create`, `cms_hook.update`,
    `cms_hook.delete`, and for the blocks attached to a hook `cms_hook.attach_block`,
    `cms_hook.reorder_block`, `cms_hook.detach_block`. An attachment has no id of its own, so its
    entries carry the hook id as `objectId` and name the block and its position in the state.

  An entry records the facts an operator sets — name, code, active flag, description, languages,
  sales channels and version — on each side of the write; a content save records the language and
  the version it produced rather than the content tree, as a page's does. A refused write, a patch
  that names no field, and detaching or reordering a block that was not attached record nothing.

  Routes, request and response shapes and status codes are unchanged. Deleting a block, a template
  or a hook, and detaching a block, now run inside a transaction; they ran as bare statements
  before. `CmsBlockService`, `CmsTemplateService` and `CmsHookService` take the `CommandBus` as
  their second constructor argument; the module's own composition supplies it, so a host composed
  through `composeApp` or the test kit's `composeTestServer` needs no change.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [964ada7]
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
  - @endora-commerce/cms-components@0.105.0
  - @endora-commerce/page-builder-admin@0.105.0
  - @endora-commerce/page-builder-core@0.105.0

## 0.104.0

### Minor Changes

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

### Patch Changes

- bf51b0b: The CMS page, block and template editors no longer squeeze the Page Builder on
  mid-width screens.

  The settings panel becomes a column beside the builder from 1800px instead of
  1536px: between the two, the canvas was under 300px wide and the builder's
  toolbar clipped its own title. Below 1800px the panel still sits above the
  canvas, and it now starts collapsed there when editing existing content, so the
  builder is on the first screen; "Show settings" opens it. A choice the operator
  has already made is kept, a new page, block or template still opens the panel,
  and a refused save still reveals it.

- 1bfbcea: The CMS page, block and template editors put the Page Builder first.

  The metadata card and the scope card used to sit in a row above the canvas, so every visit to an
  editor began by scrolling past them. They are now a settings panel beside the canvas — a column to
  its right from 1536 px of viewport, a block above it below that — and a **Hide settings / Show
  settings** button over the canvas puts the panel away to give the builder the full width. The
  choice is remembered per browser.

  The panel opens by itself where it is needed: for a new page, block or template, which cannot be
  saved without a name and a scope, and whenever a save is refused, so a validation error is never
  behind a collapsed panel. The content language tabs moved to sit directly above the canvas they
  switch.

  Nothing about what is saved changed — the same fields, the same requests. No exported symbol
  changed either: the shell is the module's own and `@endora-commerce/mod-cms/admin-ui` still
  publishes only `PageBuilderEditor`, so the blog editors that render that canvas are untouched.

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

- 9d6dfbc: Every Page Builder editor is laid out the same way: the blog post, blog category and
  transactional e-mail editors join the CMS ones.

  **`@endora-commerce/page-builder-admin` publishes the editor shell.** New exports on `.`:
  `PageBuilderEditorLayout`, `usePageBuilderEditorSettingsPanel`,
  `PAGE_BUILDER_EDITOR_SETTINGS_STORAGE_KEY`, `PAGE_BUILDER_EDITOR_TWO_COLUMN_MIN_WIDTH` and the
  types `PageBuilderEditorLayoutProps` and `PageBuilderEditorSettingsPanel`. It is the layout the CMS
  editors already have — canvas as the main column, the entity's cards in a settings panel that is a
  column beside it from 1800 px, a block above it below that, collapsed by default there, always open
  for a new entity, revealed when a save is refused, the choice remembered per browser — moved out of
  `cms` so that a module does not have to depend on `cms` to lay out an editor. Three shapes: with a
  settings panel; without one (`settings` omitted — the canvas has the page); and `builder={null}`
  for an entity that has no canvas yet, where the cards are the page and nothing collapses. Its four
  strings are `pageBuilder.editorLayout.*` in the `core` bundle (`@endora-commerce/mod-i18n`).

  **Blog post and blog category editors.** The Page Builder is the main column and the fields are in
  the settings panel, grouped: Metadata, Scope, Search engines (SEO), then for a post Tags, Related
  posts, Related products and Lifecycle. **One Save replaces "Save metadata" and "Save content" /
  "Save description"**: it is in the header with "Save and exit", sends the same requests (the fields,
  then the canvas only if it was edited), and a save that cannot go through names what is missing and
  opens the panel instead of leaving a disabled button. Publish / Unpublish moved to the header;
  Archive is in the Lifecycle card. The canvas now follows the language tab, and saving tags or
  related content no longer puts the stored content back under unsaved canvas edits. A new post or
  category, which has no canvas until it exists, shows the fields as the page. `mod-blog` gains
  `@endora-commerce/page-builder-admin` as an optional peer dependency, next to the
  `@endora-commerce/mod-cms` one it already had. Removed bundle keys: `common.saveContent`,
  `common.saveDescription`, `common.saveMetadata`, `messages.contentSaved`,
  `messages.descriptionSaved`.

  **Transactional e-mail, e-mail block and e-mail template editors.** The canvas takes the full
  editor width and starts on the first screen; the scope, the language and the subject sit on one row
  above it instead of in three stacked cards. These editors deliberately have **no** settings panel:
  those fields say which message is on the canvas or are part of it. Their labels and messages are
  now translated (`pl` included) instead of hard-coded English. A save without a subject is refused
  on the screen, with a sentence that names the field and the cursor put in it, instead of the API's
  generic validation error; `EmailSubjectWithVariables` (`@endora-commerce/page-builder-admin/email`)
  gains the optional `invalid` and `describedBy` props that carry it.

  **`mod-cms`**: no visible change. Its three editors import the shell from
  `@endora-commerce/page-builder-admin`; the `editorLayout.*` keys left its bundle for `core`. The
  shell was never exported from `cms` (`./admin-ui` still publishes only `PageBuilderEditor`), so no
  import breaks. The remembered choice keeps its storage slot, `b2b-admin.cms-editor.settings-panel`,
  so operators who already chose keep their choice — and it now applies to the blog editors too.
  One behaviour differs: when a refused save opens the panel, the page scrolls to the top of the
  editor, so the message is on screen with the fields under it, rather than to the panel alone.

  No request, response or payload shape changed.

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
- Updated dependencies [9d6dfbc]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/page-builder-admin@0.104.0
  - @endora-commerce/page-builder-core@0.104.0
  - @endora-commerce/platform@0.104.0
  - @endora-commerce/cms-components@0.104.0

## 0.103.1

### Patch Changes

- 7f6a4ba: The Page Builder extension guide this package ships no longer says that every storefront runs
  `blocks:generate`. That is true of a storefront created by release `0.103.0` or later. A storefront
  created earlier keeps its source through an upgrade — `endora upgrade` moves its packages only — so
  it has no `blocks:generate` script, no `lib/page-builder/` and no rule for a switched-off module's
  block until its owner brings those files over. The guide now says so and names where the steps
  are: _Upgrading an instance_, under _Module blocks in an existing storefront_. No code changes.
- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/cms-components@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/page-builder-admin@0.103.1
  - @endora-commerce/page-builder-core@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Minor Changes

- d0e76fd: The CMS editor renders a module's block with the renderer that module contributes through its `./admin` layer, and a declared block nothing renders is now insertable and editable from its declared fields behind a neutral preview — it used to be a placeholder with no editable field. The documentation page _Extending the Page Builder_ describes how a module package ships its renderers. Adds the `pageBuilder.blockPreview.unavailable` string (English and Polish).

### Patch Changes

- bb56a0d: Every admin write to a CMS page now runs through the Command Bus and leaves one audit entry,
  written in the write's own transaction and attributed to the acting admin. Creating, updating,
  saving content, publishing, archiving, unarchiving and deleting a page each used to change the
  row and record nothing, so "who published this page" could not be answered afterwards.

  The entries carry `objectType: 'cms_page'`, the page id as `objectId`, and one of seven actions:
  `cms_page.create`, `cms_page.update`, `cms_page.set_content`, `cms_page.publish`,
  `cms_page.archive`, `cms_page.unarchive` and `cms_page.delete`. An entry records the page's name,
  slug, status, languages, sales channels, meta and version on each side of the write; a content
  save records the language and the version it produced rather than the content tree. A refused
  write, a patch that names no field and a delete of a page that is not there record nothing.

  Routes, request and response shapes and status codes are unchanged. A host composed through
  `composeApp` or the test kit's `composeTestServer` needs no change: both already register the
  `commandBus` the module now resolves. A composition assembled by hand must register one, or the
  module's boot fails with `Could not resolve 'commandBus'`.

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/page-builder-admin@0.103.0
  - @endora-commerce/page-builder-core@0.103.0
  - @endora-commerce/platform@0.103.0
  - @endora-commerce/cms-components@0.103.0

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

- 489a0b6: Documentation: "Extending the Page Builder" now describes how a module contributes a block
  today — by declaring `blocks` and `blockCategories` in its own module manifest, with a
  `<module id>.<Name>` block name — instead of calling `PageBuilderRegistry.register` from
  `composition.ts`, which no longer exists. It states the two rules `defineModuleManifest`
  enforces, that a duplicate name throws `DuplicateBlockNameError` rather than overwriting, that
  `contexts` is required, and that a module published outside this repository cannot add a
  renderer to `@endora-commerce/cms-components` without changing that package.
- 489a0b6: Documentation: migrations are now named by the file that actually ships. The pages cited
  migrations by a retired numbering (`024_settings_init.ts`, "migration 102", `080_returns_init.ts`
  and others), which matches no file in any package. Each reference now gives the real
  timestamped filename, such as `20260611T140346_catalog_product_value_overrides_init.ts`, and
  says which module owns it where that is a different module. The organizations page also no
  longer claims that the `suspended` → `blocked` migration writes an audit-log entry: it writes
  an explanatory `blocked_reason` on each remapped row.
- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [255b60b]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/page-builder-core@0.102.0
  - @endora-commerce/page-builder-admin@0.102.0
  - @endora-commerce/cms-components@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/cms-components@0.101.1
  - @endora-commerce/contracts@0.101.1
  - @endora-commerce/page-builder-admin@0.101.1
  - @endora-commerce/page-builder-core@0.101.1

## 0.101.0

### Patch Changes

- Updated dependencies [89b0de3]
- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/cms-components@0.101.0
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0
  - @endora-commerce/page-builder-admin@0.101.0
  - @endora-commerce/page-builder-core@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [61bc20a]
- Updated dependencies [54c7417]
  - @endora-commerce/cms-components@0.100.2
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2
  - @endora-commerce/page-builder-admin@0.100.2
  - @endora-commerce/page-builder-core@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/cms-components@0.100.1
  - @endora-commerce/contracts@0.100.1
  - @endora-commerce/page-builder-admin@0.100.1
  - @endora-commerce/page-builder-core@0.100.1

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
  - @endora-commerce/page-builder-admin@0.9.7
  - @endora-commerce/page-builder-core@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/page-builder-admin@0.9.6
  - @endora-commerce/page-builder-core@0.9.6
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
  - @endora-commerce/cms-components@0.9.5
  - @endora-commerce/page-builder-admin@0.9.5
  - @endora-commerce/page-builder-core@0.9.5
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
  - @endora-commerce/page-builder-admin@0.9.4
  - @endora-commerce/page-builder-core@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/page-builder-admin@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/page-builder-admin@0.9.2
  - @endora-commerce/page-builder-core@0.9.2

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
  - @endora-commerce/cms-components@0.9.1
  - @endora-commerce/page-builder-admin@0.9.1
  - @endora-commerce/page-builder-core@0.9.1
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
  - @endora-commerce/cms-components@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/page-builder-admin@0.9.0
  - @endora-commerce/page-builder-core@0.9.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2
  - @endora-commerce/page-builder-admin@0.8.2
  - @endora-commerce/page-builder-core@0.8.2

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

- bd596a9: The sales-channel bridge tables are declared by the modules that own them, not by the platform.

  **`@endora-commerce/platform`** — `SalesChannelMembershipService` no longer holds a map total over
  `ChannelMemberEntityTypeSchema`. It resolves `{ table, entityIdColumn }` through a new
  `ChannelBridgeRegistry`, which each owning module fills at compose time, and a composition root
  contributes as the container name `salesChannelBridgeRegistry`. `composeSalesChannelsKernel` takes
  an optional `bridgeRegistry` and returns the one it used on `SalesChannelsKernel.bridgeRegistry`.

  For a consumer the visible change is at the call site: a membership call for an entity type **no
  installed module registered** now refuses with `503 MODULE_DISABLED`, naming the entity type in
  `error.details`, **before** it reaches the database. It previously executed SQL against the table
  the map named, which on an instance that never installed the owning module is a relation that does
  not exist — inside whatever transaction the caller had already opened. `ChannelMemberEntityType`
  is unchanged and stays the published vocabulary; the registry decides which of its members are
  live.

  `SalesChannelMembershipService`'s constructor takes the registry as an optional fourth argument,
  defaulting to the process-level one, so an existing construction site compiles and runs unchanged.

  **The module packages** — each now exports `salesChannelBridges`, the bridge or bridges it owns,
  from its `./backend` subpath, and registers them from a boot hook. `catalog` owns two (`product`
  and `category`); the other seven own one each. The registration is a contribution and carries no
  presence probe: the rows outlive an operator switching the module off, so the bridge stays
  readable, exactly as the asset-reference and language-reference registries state for their own
  contributions.

  **`@endora-commerce/mod-sales-channels`** — `SalesChannelsService` held a second copy of the same
  nine triples, read by the channel-delete sweep, justified by a circular import that had not existed
  since the membership service moved into the kernel. It is gone; the service takes the registry as a
  new required constructor argument, in fifth position, and the delete sweep iterates the bridges
  that are actually registered — so a channel can be deleted on an instance that never installed
  `cms`.

- 2fe0b8d: Each sales-channel bridge table is now created by the module that owns its far side.

  Under D-226 a bridge between an always-present near side and a switchable far side belongs to the
  far side. All nine `sales_channel_*` tables move accordingly, so an instance that does not install
  `cms` no longer carries a migration corpus naming `cms_pages`.

  **Nothing is re-offered to a database you have already migrated, and no reset is required.**
  `mikro_orm_migrations` stores the migration class **name** and no checksum — measured on
  `@mikro-orm/migrations@6.6.13`: `MigrationStorage.ensureTable()` builds `id`, `name` and
  `executed_at`, `logMigration` inserts `{ name }`, and `getPendingMigrations()` is `umzug.pending()`
  over those names. No class is renamed and no stamp moves, so the two edited bodies are not pending
  anywhere.

  **`@endora-commerce/platform`** — two frozen migrations lose statements and keep their class names.
  `Migration20260430T170044CoreSalesChannelsPromote` loses eight `create table "sales_channel_*"`
  statements with their indexes from `up()` and the matching eight `drop table` from `down()`;
  `Migration20260424T165847CoreFoundationInit` loses `create table "sales_channel_products"`, its
  index and its `drop table`. Everything those migrations do to a kernel table is untouched — the
  channel identity columns, the backfills, the one-system-default partial unique index and the
  `quote_requests.sales_channel_id` column all stay exactly where they were. `BASELINE_MIGRATIONS` is
  byte-identical, so no position in the frozen prefix moves.

  **Each far-side module** gains one migration (`@endora-commerce/mod-catalog` gains two, for
  `sales_channel_products` and `sales_channel_categories`). Each is a `create table if not exists`
  carrying the frozen statement's own column list, primary key, both foreign keys and index, plus a
  `create index if not exists`, and each drops its own table in `down()`. On a database that has
  applied the frozen migrations every one of them is a no-op: measured on a throwaway database
  migrated at the previous release and then upgraded, all nine relations keep their `pg_class` OID,
  so no table is recreated and no row is touched. On a fresh database they are the creation, later in
  the computed order than before — which is where they have to be for an instance that omits one of
  these modules to migrate at all.

  **One behaviour changes on purpose.** A hard uninstall reverts by registry `moduleId`, so
  `module:uninstall --hard cms` now drops `sales_channel_cms_pages` along with the rest of that
  module's schema. That is the ownership rule doing what it says, and it is what an operator would
  expect of a table whose far side has just been removed.

  The published `ChannelMemberEntityTypeSchema` vocabulary is unchanged, and no wire shape moves.

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
  - @endora-commerce/page-builder-admin@0.8.1
  - @endora-commerce/page-builder-core@0.8.1

## 0.8.0

### Minor Changes

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

- fa9e7d3: `cms` resolves its own asset embeds, through `assets_library`' published port.

  `cmsAssetResolver` was a **contribution point**: the module registered the name
  defaulted to `undefined`, and a composition root was expected to build the closure
  out of `assets_library`' service and contribute it. It is the module's own
  registration now, over `lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort')`,
  with the edge already declared in this module's manifest `dependencies`.

  **If your composition contributed `cmsAssetResolver`, you no longer have to**, and
  you no longer should. Contributing it still wins — `contribute` overwrites, and the
  registration is read from the cradle per call — but the closure you were writing is
  a raw hold on another module's service, which is what the port replaces:

  ```diff
  -composedModules.contribute({
  -  cmsAssetResolver: async (assetId: string) => {
  -    try {
  -      const detail = await assetsLibrary.handle.service.getAsset(assetId);
  -      return { url: detail.url, mimeType: detail.mimeType, filename: detail.filename,
  -               label: detail.label, visibility: detail.visibility };
  -    } catch {
  -      return null;
  -    }
  -  },
  -});
  +// Nothing. `cms` registers it.
  ```

  **What changes for a running platform**: a composition that never contributed the
  name resolved every CMS asset embed to `{}`. That was this repository's own test
  harness — `composition.ts` contributed it and `test-server.ts` did not — so a CMS
  storefront response under test carried no asset detail at all, quietly, an empty
  map being a plausible answer rather than a wrong one. There is no composition in
  which the name is unset any more, and `CmsCradle.cmsAssetResolver` is
  `CmsAssetResolver` rather than `CmsAssetResolver | undefined`.

  The `catch` that answers `null` for an asset the library no longer has is kept —
  `getAsset` throws 404 for a row that is gone, and a page embedding a deleted asset
  renders without it — with `rethrowIfModuleDisabled` as its first line, so it cannot
  also absorb the owner's refusal.

  The mapping is `createAssetEmbedResolver` in
  `src/backend/services/asset-embed-resolver.ts`, exported from nothing: it is a
  function of the port rather than of the `ModuleContext`, which is what lets its
  test stub `AssetsLibraryPort` and compose no container.

  Three packages are touched with no release meaning of their own, and all three are
  comments: `@endora-commerce/mod-assets-library`, whose barrel recorded the drain
  condition this change meets; `@endora-commerce/mod-pim-ergonode`, whose barrel
  described `assetsLibraryService` as a live composition-root bridge; and
  `@endora-commerce/contracts`, where `AssetsLibraryPort`'s doc block named
  `pim_ergonode` as its only consumer. The interface itself is unchanged — `cms`
  takes `getAsset` and nothing was added to admit it, which is what publishing one is
  for.

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
  - @endora-commerce/page-builder-admin@0.8.0
  - @endora-commerce/page-builder-core@0.8.0
  - @endora-commerce/cms-components@0.8.0

## 0.7.0

### Major Changes

- 316f44b: `@endora-commerce/admin-kit` publishes four generic members that sat under a module's
  admin directory and were rendered from another's (feature 091, P8).

  **`./components` gains `ContentLanguageTabs` and `ScopePicker`.**
  - `ContentLanguageTabs({ languages, activeLanguage, onChange })` — a tab strip over
    content language codes. Its props type is `ContentLanguageTabsProps`.
  - `ScopePicker({ value, onChange })` — sales channels and the content languages inside
    them. Its props type is `ScopePickerProps` and its value type is **`ScopePickerValue`**,
    which is `CmsScopeValue` renamed: `{ salesChannelIds: string[]; languages: string[] }`,
    field for field. A consumer importing `CmsScopeValue` from `mod-cms`' admin code renames
    the type and changes nothing else.
  - `listScopeSalesChannels(pageSize?)` and `fetchScopeSalesChannel(code)` come with it. The
    picker called `sales_channels`' admin API client; it now builds both `GET`s from the
    published `apiClient` and the contract's own `SalesChannelListResponse` /
    `SalesChannelDetail`, so the kit holds no module code.

  **`./ui` gains `Section`** — `Section({ title, action?, className?, children })` and
  `SectionProps`. A heading, an optional action beside it and a slot; it is a layout
  primitive, which is why it is here and not on `./components`.

  **`./lib` gains the three invoice e-mail-outcome helpers** — `invoiceEmailNotSentReason`,
  `sendInvoiceEmailMessage` and `issueInvoiceNotice`, plus the `Translate` type they take.
  Signatures are unchanged: each still receives the caller's scope-bound `t`.

  **`@endora-commerce/mod-cms`' bundle loses six keys** and `@endora-commerce/mod-i18n`'s
  gains them under new names, because the two components now render out of `core` (ruling
  R-1: a translation namespace is module knowledge). None of the six had another reader.

  | gone from `mod-cms`      | arrives in `mod-i18n`           |
  | ------------------------ | ------------------------------- |
  | `languageTabs.empty`     | `contentLanguageTabs.empty`     |
  | `languageTabs.ariaLabel` | `contentLanguageTabs.ariaLabel` |
  | `scope.title`            | `scopePicker.title`             |
  | `fields.languages`       | `scopePicker.languages`         |
  | `scope.selectChannel`    | `scopePicker.selectChannel`     |
  | `scope.loadingLanguages` | `scopePicker.loadingLanguages`  |

  Every value is carried across unchanged in both shipped languages. **A consumer that
  supplies its own bundle has to move all six**: a key left in the `cms` scope does not fail
  to compile and does not 404 — it renders `core.scopePicker.title` into the operator's screen
  as a label.

  The invoice e-mail helpers move no key. All twelve they read —
  `invoices.emailNotSent.<reason>` (seven), `invoices.emailSent`,
  `invoices.emailNotSentNotice` and three `orderDetail.issueInvoice.*` — were already
  `mod-i18n`'s in both languages and in neither `mod-invoices`' bundle nor `mod-orders`'.

- 09df879: The shared admin page-builder chrome's copy moves out of `mod-cms`' bundle and into
  `mod-i18n`'s, which the admin serves under the synthetic `core` scope (feature 091 P5a;
  ruling R-1: a translation namespace is module knowledge, and this copy is nobody's).

  **`@endora-commerce/mod-cms`' bundle loses 33 keys**, every one of them under
  `pageBuilder.*` and every one of them read only by `PageBuilderHeaderActions.tsx` — the
  header shell, the template actions and the header tools that `cms`, `invoices` and the
  e-mail builder all render. The blocks that moved whole are
  `pageBuilder.saveAsTemplate.*` (9), `pageBuilder.applyTemplate.*` (9),
  `pageBuilder.copyLanguage.*` (8, minus `emptySource`), `pageBuilder.clearCanvas.*` (5) and
  `pageBuilder.fullscreen.*` (2). The bundle keeps its other 65 `pageBuilder.*` keys —
  `components.*`, `categories.*`, `drawer.*`, `copyLanguage.emptySource` and the rest — which
  belong to `cms`' own screens, and it keeps `common.saving`, `fields.name` and `fields.code`,
  which its editors read.

  **`@endora-commerce/mod-i18n` gains those 33 plus three new `common.*` entries**:
  `common.state.saving`, `common.field.name` and `common.field.code`. They are additions
  rather than moves because `cms` reads its own copies of the same three concepts from its own
  screens; no existing `core` key carried those values.

  **What a consumer that supplies its own bundle has to do:** move the 33 `pageBuilder.*` keys
  from the `cms` scope into `core`, and add the three `common.*` entries. A key left behind
  does not fail to compile and does not 404 — it renders `core.pageBuilder.clearCanvas.button`
  into the operator's screen as a label.

  `common.state.saving` is `"Saving…"` / `"Zapisywanie…"`, with the typographic ellipsis its
  `common.state.loading` sibling uses, where `cms`' own `common.saving` is `"Saving..."`. That
  is the one rendered character this release changes.

### Minor Changes

- 59c59c6: `cms` and `blog` ship their admin screens, and `cms` publishes its page-builder canvas.

  **Two packages' `./admin` subpath is new, and `@endora-commerce/mod-cms` gains a second UI
  subpath.** Eighteen routes and seven sidebar entries between them, at the paths the
  hand-written host registrations carried, plus `./admin-ui` on `cms` for the one component
  another module renders. The exported symbol on `./admin` is the same one every other module
  package uses — `contributions`, an `AdminContributions` object, and nothing else.
  - `@endora-commerce/mod-cms` — **new `./admin` subpath**, exporting `contributions`. Eleven
    routes: `/cms` and `/cms/pages` (the landing route) on `cms.read`, `/cms/pages/:id`,
    `/cms/blocks`, `/cms/blocks/:id`, `/cms/templates`, `/cms/templates/:id` and `/cms/hooks`
    on `cms.read`, and `/cms/pages/new`, `/cms/blocks/new` and `/cms/templates/new` on
    **`cms.write`**. `/cms` is a second declaration of the page list rather than a redirect,
    because a redirect would be the consuming application's route and not this module's. Four
    sidebar rows, in the `content` section at weights 100 to 400.
  - `@endora-commerce/mod-blog` — **new `./admin` subpath**, exporting `contributions`. Seven
    routes: `/blog/posts` (the landing route), `/blog/posts/:id`, `/blog/categories`,
    `/blog/categories/:id` and `/blog/tags` on `blog.read`, and `/blog/posts/new` and
    `/blog/categories/new` on **`blog.write`**. Three sidebar rows, in the `content` section at
    weights 600 to 800.

  **The five create routes take the write code, and that is a behaviour change for a consumer
  rendering these routes.** Each create screen exists to write — `POST /api/v1/admin/cms/pages`
  and its four siblings enforce the write code — and each module's own palette action
  (`new-page`, `new-post`) already advertised that code. The routes were ungated while they
  belonged to the admin application, so a read-only operator could open a form whose save then
  refused. The five create controls are gated on the same code in this release — the _New page_,
  _New block_, _New template_, _New post_ and _New category_ buttons and the category tree's
  _+ Child_ — so the dead end is closed at both ends. `@endora-commerce/mod-sales-channels`
  ships the identical split for `/sales-channels/new` and `@endora-commerce/mod-credentials` for
  `/credentials/new`.

  **`CategoryTreeNode` takes a new required prop.** It is not exported from any subpath, so this
  affects nobody outside the package; it is recorded because the prop is `canCreate: boolean`
  and required rather than optional — a caller that forgets it does not compile, which is the
  direction a permission gate has to fail in.

  **`@endora-commerce/mod-cms` — new `./admin-ui` subpath, exporting `PageBuilderEditor` and the
  `PageBuilderData` type.** This is the Puck canvas the CMS page, block and template editors
  render and that `@endora-commerce/mod-blog`'s post and category editors render too. Its props
  are `data` in and `onChange` back, so the consumer decides that it appears — a published
  component rather than something the owner contributes to a place of its own choosing. It is
  not in `@endora-commerce/admin-kit` because it is a `@measured/puck` host and the kit is what
  every module's admin layer compiles against, and not in
  `@endora-commerce/page-builder-admin` because it calls this module's API client, reads this
  module's translation namespace and lays the CMS page container out — that package holds the
  builder chrome that names no module at all.

  **`@endora-commerce/mod-blog` gains `@endora-commerce/mod-cms` as a peer dependency**, which
  is what a published component costs: the reach survives into the emitted JavaScript, so a
  consumer bundling `blog`'s admin layer must resolve `cms`. It is not a `dependency` — a module
  reaches another through a port declared in its manifest, never through npm — and it is not
  optional. A consumer that installs `@endora-commerce/mod-blog` without `@endora-commerce/mod-cms`
  will fail to resolve `@endora-commerce/mod-cms/admin-ui` at bundle time. There is no runtime
  half to worry about: `blog`'s module manifest already declares `cms` in its `dependencies`, so
  a platform where `cms` is absent or switched off is one where `blog` cannot be activated
  either.

  **`@endora-commerce/mod-cms` and `@endora-commerce/mod-blog` ship new i18n keys, and
  `@endora-commerce/mod-i18n` loses seven.** `nav.cmsPages.label`, `nav.cmsBlocks.label`,
  `nav.cmsTemplates.label`, `nav.cmsHooks.label`, `nav.blogPosts.label`,
  `nav.blogCategories.label` and `nav.blogTags.label` are in the two modules' own
  `i18n/{en,pl}.json`; `appShell.nav.cmsPages`, `appShell.nav.cmsBlocks`,
  `appShell.nav.cmsTemplates`, `appShell.nav.cmsHooks`, `appShell.nav.blogPosts`,
  `appShell.nav.blogCategories` and `appShell.nav.blogTags` are removed from the shared bundle
  in both shipped languages, nothing rendering them any more. **A consumer resolving one of
  those seven keys out of the `core` namespace will get a raw key**; each has a
  module-namespaced replacement above.

  **Neither module declares a new palette action, and neither loses one.** `cms` has declared
  `new-page` and `blog` `new-post` all along, and the admin application's own palette table
  never carried a hand-written row for either — so unlike batches 10, 13 and 14 there was
  nothing to convert.

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

- f66359f: The stored Page Builder block names are namespaced, once, by five migrations.

  Each of the five table-owning modules rewrites **its own** columns — `cms` three, `blog`
  two, `transactional_emails` three, `newsletter` two, `invoices` one — with a recursive
  `pg_temp` function generated from `FROZEN_BLOCK_RENAMES`. A migration belongs to the module
  that owns the **table**, never to the module that owns the new name, so no new manifest
  `dependencies` edge arises: a block name is a string value inside a JSONB document, not a
  foreign key.

  The rewrite is **structural**: it replaces the value of a `type` property in a node position
  and nothing else. Twelve of the 74 names are ordinary English words (`Row`, `Text`, `Image`,
  `Map`, `Button`, …) that occur throughout shop content, so a textual substitution would
  corrupt a `RawHtml` block's markup and every `alt` attribute in the shop.

  It is **idempotent by construction** — every key of the map is bare and every value is
  dotted, so a second run finds nothing — and it **cannot fail on its input**: a name the map
  does not hold is left byte-identical and reported, never quarantined. `down()` applies the
  inverse over the identical walk.

  `cms` gains an operator command for the pre-flight:

  ```
  pnpm --filter backend run cli -- cms block-names
  ```

  Read-only, across all eleven columns, classifying every stored name as _will be renamed →
  new name_, _already namespaced_ or _unrecognised_. Run it before upgrading, resolve or accept
  the unrecognised set, take a backup, upgrade, and run it again: every _will be renamed_
  becomes _already namespaced_ and the unrecognised set is unchanged.

  `catalog`, `orders` and `ksef` are patch-bumped because their block declarations are now what
  the registry serves — the eight `catalog` blocks, the eight `orders` ones and
  `ksef.InvoiceSection` were previously registered as `cms`' and `invoices`'.

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

- 661e80d: Fourteen new packages: the **second** batch of modules to leave `backend/src/modules/`
  (feature 080, T040b). Five moved one at a time, then ten together; these fourteen are the
  same shape as the ten, and the properties below hold fourteen times over.

  **One changeset, not fourteen**, for the reason batch one gives: a changeset is written for
  the consumer of a package, and a package that did not exist a moment ago has no upgrader to
  instruct. What genuinely differs per package is its layer inventory, and that is the table.

  Every subpath is compiled output (D-164); none has a root wildcard; each package's `.` is
  its `manifest.ts`, where the generated manifest index reads the module's identity, its
  `dependencies`, its permission codes, its command-palette actions, its settings and its
  activation control.

  | Package                                     | Subpaths                         | Entities                                                                                                                                                                                                                                                                                                                                       | Migrations | Ships          |
  | ------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------- |
  | `@endora-commerce/mod-admin-notifications`  | `.`, `./backend`, `./migrations` | `AdminNotificationRead`, `AdminNotification`                                                                                                                                                                                                                                                                                                   | 1          | `dist`         |
  | `@endora-commerce/mod-api-keys`             | `.`, `./backend`, `./migrations` | `ApiKey`                                                                                                                                                                                                                                                                                                                                       | 1          | `dist`         |
  | `@endora-commerce/mod-linkedin-ads`         | `.`, `./backend`, `./migrations` | `LinkedInConversionMapping`                                                                                                                                                                                                                                                                                                                    | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-sales-channels`       | `.`, `./backend`                 | —                                                                                                                                                                                                                                                                                                                                              | —          | `dist`, `i18n` |
  | `@endora-commerce/mod-shopping-lists`       | `.`, `./backend`, `./migrations` | `ShoppingListItem`, `ShoppingList`                                                                                                                                                                                                                                                                                                             | 2          | `dist`         |
  | `@endora-commerce/mod-delivery-methods`     | `.`, `./backend`, `./migrations` | `DeliveryMethod`                                                                                                                                                                                                                                                                                                                               | 2          | `dist`         |
  | `@endora-commerce/mod-prompt-actions`       | `.`, `./backend`, `./migrations` | `PromptActionRequest`                                                                                                                                                                                                                                                                                                                          | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-mfa`                  | `.`, `./backend`, `./migrations` | `MfaEnrolment`, `MfaOrganizationPolicy`, `MfaRecoveryCode`, `MfaSocialIdentity`                                                                                                                                                                                                                                                                | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-webhooks`             | `.`, `./backend`, `./migrations` | `WebhookDelivery`, `Webhook`                                                                                                                                                                                                                                                                                                                   | 3          | `dist`         |
  | `@endora-commerce/mod-transactional-emails` | `.`, `./backend`, `./migrations` | `EmailBlockSalesChannel`, `EmailBlock`, `EmailTemplateSalesChannel`, `EmailTemplate`, `TransactionalEmailContent`, `TransactionalEmail`                                                                                                                                                                                                        | 2          | `dist`, `i18n` |
  | `@endora-commerce/mod-cms`                  | `.`, `./backend`, `./migrations` | `CmsBlock`, `CmsHookBlockAttachment`, `CmsHook`, `CmsPage`, `CmsTemplate`                                                                                                                                                                                                                                                                      | 2          | `dist`, `i18n` |
  | `@endora-commerce/mod-pwa`                  | `.`, `./backend`, `./migrations` | `PushMessageDelivery`, `PushMessage`, `PushSubscription`, `PwaIconRendition`                                                                                                                                                                                                                                                                   | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-newsletter`           | `.`, `./backend`, `./migrations` | `NewsletterAutomationRun`, `NewsletterAutomation`, `NewsletterCampaignSubscriber`, `NewsletterCampaign`, `NewsletterCustomField`, `NewsletterEmailBlockSalesChannel`, `NewsletterEmailBlock`, `NewsletterEngagementEvent`, `NewsletterSendRecord`, `NewsletterSubscriberTag`, `NewsletterSubscriber`, `NewsletterSuppression`, `NewsletterTag` | 1          | `dist`, `i18n` |
  | `@endora-commerce/mod-returns`              | `.`, `./backend`, `./migrations` | `Refund`, `ReturnCaseAttachment`, `ReturnCaseComment`, `ReturnCaseItem`, `ReturnCase`, `ReturnDeliveryMethod`, `ReturnListSavedView`, `ReturnReason`, `ReturnShipment`, `ReturnStatusTransition`, `ReturnStatus`                                                                                                                               | 2          | `dist`, `i18n` |

  **`./backend` publishes `registerModule(ctx)` and an `entities` array, and no entity class by
  name** (D-168) — type-only exports included, which this batch measured rather than assumed:
  two packages published their entities' row types so the dev seed could name them, and
  `module-package-entity-surface.test.ts` refused both, in as many words — _"that is the one
  thing that makes a foreign module's `import type { … }` compile"_. The exports are gone and
  the seed takes each class off the published array by name.

  **One of the fourteen owns no table and says so with an empty array rather than by
  omission.** `@endora-commerce/mod-sales-channels` exports `entities: readonly never[] = []`.
  The distinction is not cosmetic: the platform's package loader answers a _missing_ export
  with `[]`, so "this module has no table" and "somebody forgot the array" would otherwise
  arrive as one silence, whose only symptom is a query against a table nobody created.

  **One package publishes a type on `./backend` that is not an entity**, and it is there
  because a composition root has to name a contribution it supplies:
  `@endora-commerce/mod-shopping-lists` re-exports `ShoppingListService`. A root cannot reach
  a package's internal file — `rootDir` makes a relative specifier into `packages/` TS6059
  even for an `import type` — so a contribution shape has to be on a published subpath or it
  is unnameable.

  **Two packages declare a `@fastify/*` dependency nothing imports.**
  `@endora-commerce/mod-mfa` peers on `@fastify/cookie` and `@endora-commerce/mod-pwa` on
  `@fastify/multipart`, because `reply.setCookie`, `request.isMultipart()` and
  `request.file()` are declaration-merging augmentations rather than imports. Inside the
  application those arrived ambiently through the host's own dependency; a package compiles
  against its own manifest, where an unnamed dependency does not exist. Both write
  `import type {} from '@fastify/…'`, which is type-only: the plugin is still the host's to
  register.

  **`@endora-commerce/mod-newsletter` and `@endora-commerce/mod-pwa` also carry a companion
  `@types/*` in `devDependencies`** — `@types/nodemailer` and `@types/web-push` — which the
  manifest generator now derives. Nothing imports a `@types` package; the compiler finds it
  through `node_modules/@types`, which inside a package is the package's own declaration, so
  a module importing a JS-only library did not build until this landed.

- 1f07b01: The fifteen `pageBuilder.colorPalette.*` strings move from `mod-cms`' bundle into
  `mod-i18n`'s, in both shipped languages (feature 091, P5b — the remedy P5a applied to the
  other thirty-three chrome keys, arriving for the one chrome file P5a's set did not include).

  `ColorPaletteModal` is the shared page-builder chrome's, not `cms`' screen: `cms`,
  `invoices` and the e-mail builder all render it, and it now ships in
  `@endora-commerce/page-builder-admin`. A package cannot depend on one module's bundle for
  strings three modules read, and a namespace is resolved at runtime by string — so a key the
  namespace does not carry renders `cms.pageBuilder.colorPalette.title` into the operator's
  screen instead of failing. The keys therefore live where the reader does, which for chrome
  is the synthetic `core` scope `mod-i18n` serves.

  **If you ship a translation override** keyed `cms.pageBuilder.colorPalette.*`, re-key it to
  `core.pageBuilder.colorPalette.*`. The fifteen keys, their values and both languages are
  otherwise unchanged; no other `cms` key moves, and the other sixty-five `pageBuilder.*` keys
  in `mod-cms`' bundle are its own screens' and stay.

- afedd32: Six modules declare the Page Builder blocks they own — all 74 of them.

  Each package's exported `manifest` gains `blocks` and `blockCategories`, and each
  ships the `blocks.<local>.label`, `blocks.<local>.description` and
  `blocks.category.<key>` entries for them in `i18n/en.json` and `i18n/pl.json`:

  | Package                    | Blocks              | Category declarations  |
  | -------------------------- | ------------------- | ---------------------- |
  | `mod-cms`                  | 30                  | 8 CMS sections         |
  | `mod-catalog`              | 8 (5 CMS, 3 e-mail) | 2                      |
  | `mod-orders`               | 8 e-mail            | 1 (`order`)            |
  | `mod-transactional-emails` | 17 e-mail           | 4                      |
  | `mod-invoices`             | 10 invoice          | 1 (`invoice`)          |
  | `mod-ksef`                 | 1 invoice           | 1 (`invoice`, joining) |

  **Nothing reads these declarations yet.** The Page Builder registry is still
  populated from the single hand-written `register('cms', …)` call, the three Puck
  configs are still keyed by the bare names, and no stored document changes. Read
  the block `name`s as the names those blocks will have, not as names anything
  resolves today.

  Two `(key, context)` sections are declared by two modules each and **merge**:
  the e-mail `content` section (`mod-transactional-emails` names it,
  `mod-catalog` joins) and the `invoice` section (`mod-invoices` names it,
  `mod-ksef` joins). A joining declaration carries its own `titleKey` and omits
  `weight` and `visible`, so it cannot take a presentation its author did not
  intend to take while still being able to title the section on its own when the
  namer is switched off.

  Three sections change owner or gain a member, which is the point of the exercise
  rather than a side effect: the CMS `catalog` section is `mod-catalog`'s (`cms`
  hand-writes it and owns no block in it); the e-mail `order` section is
  `mod-orders`'; `cms.InsertTemplate` and `transactional_emails.EmailInsertTemplate`
  gain a section, having had none; and `transactional_emails.EmailColumn` moves into
  a new hidden `internal` section.

  `mod-cms`' bundles rename one key: `pageBuilder.categories._internal` becomes
  `pageBuilder.categories.internal`, following the category key in
  `@endora-commerce/cms-components`. The rendered title is unchanged.

### Patch Changes

- b8bd8c7: `cms` declares the ten error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied verbatim from the
  frozen capture, and is asserted equal to it in both directions.

  `CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE` is among them despite naming two other
  modules' nouns — it is this module's refusal, raised twice in
  `cms-page-service.ts` — and `CMS_REFERENCED` is the cross-entity reference guard
  for pages, blocks and templates rather than a narrowing of `assets_library`'s
  `ASSET_REFERENCED`. Going the other way, the seven raises this module makes of
  `VERSION_CONFLICT` and `VALIDATION_FAILED` are the platform's codes and are not
  declared here.

  All ten already carry a written sentence in both `en` and `pl` in this package's
  own `i18n/` bundles, so no sentence moves and none is added. No `tokens`: none
  of the 32 raises of these codes passes a `details.code` discriminator.

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
- Updated dependencies [5fc0550]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [11fc9f3]
- Updated dependencies [afedd32]
- Updated dependencies [f66ce9b]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [b9d15af]
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
- Updated dependencies [1f07b01]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
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
- Updated dependencies [a92d972]
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
  - @endora-commerce/page-builder-core@0.7.0
  - @endora-commerce/cms-components@0.7.0
  - @endora-commerce/platform@0.7.0
  - @endora-commerce/page-builder-admin@0.7.0
