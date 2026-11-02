# @endora-commerce/mod-blog

## 0.109.0

### Minor Changes

- 0e33ca9: Blog posts get a main image, a public list endpoint and a _Latest posts_ page-builder block.

  - `@endora-commerce/mod-blog` adds `blog_posts.main_image_asset_id` (migration `20261023T063013_blog_post_main_image`, nullable, foreign key to the asset library), editable in the post editor through the asset library picker. Deleting an asset a post uses as its main image is refused like any other referenced asset (reference kind `blog_post_main_image`).
  - `GET /api/v1/blog/posts?limit=&categorySlug=` returns the newest published posts of the request's sales channel as post cards (`limit` 1–24, default 6; an unknown category returns `[]`; a channel with the blog disabled returns `[]`). Cards carry the primary category's name for a chip.
  - `@endora-commerce/contracts`: `blogPostsListQuerySchema`, `blogPostsListResponseSchema`, `BLOG_POSTS_LIST_MAX_LIMIT`, `BLOG_POSTS_LIST_DEFAULT_LIMIT`; `mainImageAssetId` on `blogPostSummarySchema` (required, nullable) and on the create and patch request schemas (optional); optional `primaryCategoryName` on `blogPostCardSchema`; `blog_post_main_image` in `assetReferenceKindSchema`.
  - `blog.LatestPosts` (declared by `@endora-commerce/mod-blog`, rendered by `@endora-commerce/cms-components` as `LatestPosts` with the `CmsBlogPostCard` type): the newest posts as a carousel or a grid, optionally from one category, with a header and a read-more label. It is resolved on the server through the block-data seam, renders nothing for customers when there are no posts, and disappears from the editor and the storefront when the blog module is off.

- 0e33ca9: Alignment, gaps and text weights are set per breakpoint, beside each other on the Responsive tab, in every block that has them.

  Nothing changes for a stored page: a value stored as one alignment, one gap or one weight applies at every width and renders as before.

  - **Alignment** of `cms.Icons`, `cms.Social`, `cms.LogoStrip`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, `cms.Hero` and `cms.Tabs` is per breakpoint and reads **Left / Center / Right** (the tabs' third is **Stretch**). Alignments that differ write `data-align-md` / `data-align-lg` (and the classes the stylesheet reads); one alignment keeps today's markup.
  - **Gaps** of `cms.Social`, `cms.LogoStrip`, `catalog.ProductGrid` and `catalog.CategoryGrid` are a spacing step or **Custom gap (px)**, per breakpoint. A gap stored as a number reads as Custom with that number (`numericGapAsCustom`, carried by `resolveData`); gaps that differ go on `cmsc-pb-gap-tiers`. The grids' **Equal items height** is per breakpoint too, next to the columns and the view.
  - **Weights** — every block heading's, the feature list's and the hero's title weight and the media-and-text item title weight — are per breakpoint, right after the size. Weights that differ wrap the text in one `cmsc-pb-item-weight` span (`responsiveWeightProps`, `WeightSpan`); one weight stays the inline `font-weight`.
  - The registry's and the manifests' `responsiveFields` list the new responsive props.

- 0e33ca9: The page builder's settings panel speaks one language: one switch for every on/off setting, and every label translated — the settings every block shares translated once.

  Nothing stored changes: a switch stores the same `true` / `false` the Yes/No choices stored.

  - `@endora-commerce/page-builder-core` exports `createToggleField({ label, defaultValue?, metadata? })` — a `role="switch"` button inside its label, operable by pointer and keyboard, showing the block's default while the prop is unset; with the responsive metadata it edits the breakpoint the Responsive tab selects — and `ToggleSwitch` for a custom control's own on/off setting. Every Yes/No radio of the bundled blocks, the row's "Clip content", a video's autoplay, muted, loop and controls, a carousel's loop, autoplay and equal heights, its arrows and dots (now **Show arrows** / **Show dots**), the border's **Show border**, the section reveal's desktop-only, a media-and-text video's autoplay and a link's **Open in new tab** are switches.
  - Shared fields carry their key: `withSharedFieldLabel(key, field)`, `sharedFieldLabel(field)` and `PAGE_BUILDER_SHARED_FIELD_KEYS` (editor name, Hide on, order in the column, box spacing, border, background, rounded corners, shadow, colour, typography, minimum height). The admin translates such a field from the `core` bundle's `pageBuilder.sharedFields.<key>` after the block's own key and before the English; a block that relabels a shared field keeps its own key. `applyPageBuilderTranslations` takes the shared resolver as a fifth argument, and translates the options a custom field carries.
  - The words inside the page builder's controls — spacing, border (a border side now labels its **Width (px)**, **Style** and **Color**), the per-breakpoint hints, the editor's name, the background control and the asset picker — come from the `core` bundle in English and Polish.
  - `withHideOn` puts **Hide on** back when a block's own `resolveFields` returns a field set without it (the heading, row, table and map had lost it).
  - Every bundled block's field and option labels resolve in Polish; the block keys are in the declaring module's bundle (`cms`, `catalog`, `blog`, `newsletter`), the shared ones in `core`. Labels use US spelling (**Color scheme**, **Center**), one wording (**Email**, **Alt text**, **Minimum height**, "Custom … (px)", **Rounded corners**), and side choices read **Left / Right**.

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

### Patch Changes

- e03e6a9: **BREAKING — the admin screens follow the `active` | `inactive` status model, with Archive / Restore and an Archived filter.** Recorded at `minor`, which in a `0.x` series already takes every caret dependent out of range.

  - **admin-kit product browser.** `ProductBrowserStatusFilter` is `'all' | 'active' | 'inactive' | 'archived'` (was `'all' | 'active' | 'draft' | 'inactive'`) and `ProductBrowserCounts` is `{ all, active, inactive, archived }` (was `{ all, active, draft, inactive }`). The browser no longer sends `includeArchived=1`: its first three tabs list products that are not archived, and the new Archived tab sends `archived=only`.
  - **admin-kit `ProductBrowserItem`** gains an optional `archivedAt` (absent reads as not archived), and **`ProductBrowserRules`** gains `blockArchived`: an archived product is then shown but not selectable, with the reason `archived` (`productBrowser.reason.archived`), whatever its status, and the browser offers no Archived tab. `ProductSelectabilityReason` gains `'archived'`; the new `isProductArchived(row)` reads `archivedAt`. With `rules`, `ProductPicker` names an archived product beside its status.
  - **`@endora-commerce/mod-i18n` (`core`)**: `productBrowser.tab.draft` and `productBrowser.status.draft` are removed; `productBrowser.tab.archived`, `productBrowser.status.archived` and `productBrowser.reason.archived` are added, in English and Polish.
  - **page-builder-admin** `CatalogPickers`' product status filter offers All, Active and Inactive; `Draft` is gone.
  - **catalog admin.** The product editor's status selector and the scope controls offer Active and Inactive; a new product starts Inactive and the create request carries the selected status. The editor offers **Archive** or **Restore** (with `catalog:write`) behind a confirmation, shows an archived product's state beside its status, and says that setting Active does not restore it. The product list has _All · Active · Inactive · Archived_ with the counts above, hides archived products unless the Archived tab is chosen, shows an Archived badge beside the status, and asks `resolve-ids` for the same population; a saved view stores the Archived tab as `archived: 'only'`, and a view saved with `status: 'draft'` opens as All. The bulk dialog's _Set status_ offers Active and Inactive, and the dialog offers bulk **Archive** (or **Restore** on the Archived tab) as its own confirmed action, with a per-product result and a link to the operation, where it can be undone.
  - **orders** — creating an order refuses archived products in the browser and the quick search. **blog** — the related-products picker names inactive and archived products separately. **product feeds** — the criteria's status rule no longer offers `draft`.

- 0e33ca9: Blog post and category cards on the storefront show their main image. The storefront resolver was never handed an asset-URL resolver, so every card's `mainImageUrl` was `null`. `@endora-commerce/mod-blog` now resolves it through the asset library port by default; only a public asset is served, and a missing asset renders the card without an image.
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

- 0e33ca9: The dark scheme's decorative backdrop can be given as a URL, `cms.Tabs` can keep its tab bar in one scrolling line, and a `cms.Column` can distribute its blocks vertically and reorder them per breakpoint.

  Nothing changes for a page that does not use them: the default markup and look are the ones the blocks had.

  - **Backdrop by URL.** The brand tokens' schemes gain an optional `decorativeUrl`, validated by the new `brandMediaUrlSchema` and `BRAND_MEDIA_URL_RE` in `@endora-commerce/contracts`. It accepts an `https:` URL, or a path starting with `/`, of up to 2048 characters, with no quotes, parentheses, backslashes, angle brackets or whitespace. The library asset (`decorativeAssetId`) wins when both are set. `brandTokensToCss` takes a new `mediaUrl` option, which rebases a `/path` (the storefront and the admin pass their API origin). It checks the stored value again and writes it as an escaped CSS string. The brand screen has a **Decorative backdrop URL** field under the dark scheme's asset picker. `@endora-commerce/page-builder-core/brand-tokens` re-exports `BRAND_MEDIA_URL_RE`.
  - **Scrolling tab bar.** `cms.Tabs` gains `barOverflow: 'wrap' | 'scroll'`. Unset, it wraps as before. `scroll` adds `cmsc-pb-tabs--scroll` and keeps the bar in one line that scrolls sideways inside the block, with scroll snapping and no page overflow. The roles and the keyboard model are unchanged. A tab chosen with the pointer is scrolled into the bar's view. The tab focus ring (`.cmsc-pb-tabs__tab:focus-visible`), lost in an earlier stylesheet edit, is restored.
  - **Column distribution.** `cms.Column` gains `distribute`: `'start'` (the default), `'center'`, `'end'`, `'space-between'` or `'last-to-bottom'`. It is written as `data-pb-distribute`. The column's published block slot now carries the class `cmsc-pb-column-stack`.
  - **Block order per breakpoint.** `withHideOn` offers `stackOrder`: `'auto'`, `'first'`, `'1'`–`'6'` or `'last'`, one value per breakpoint, on the Responsive tab. The field appears only when the block's parent is in the new `BLOCK_ORDER_PARENTS` export (`['cms.Column']`), through a `resolveFields` it now adds to every wrapped block, so no block's static fields change. The value is written on the wrapper as `data-pb-order` and `--pb-order(-md|-lg)`, and the stylesheet reads it as the CSS `order`. Only the visual order changes: the DOM and focus order stay the stored order. `STACK_ORDER_VALUES` and the `StackOrder` type are exported.

  The `cms`, `catalog`, `blog` and `newsletter` bundles carry the English and Polish labels.

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

- 0e33ca9: The latest-posts block gains options for its post cards, its header lead and its header button.

  Nothing changes for content that does not use them: the default markup and look are the ones the block had.

  - **Card look.** `blog.LatestPosts` offers a card background (`cardBackground`, a hex or brand colour), card corners (`cardRadius`), card padding and text padding (`cardPadding` / `cardTextPadding`, a spacing step or Custom px, per breakpoint), the image ratio per breakpoint (`imageRatio`, any aspect token or a custom `w:h`; 2:1 by default), zoom on hover (`hoverZoom`), the category chip style (`chipStyle`: filled, outline or hidden), the card title size and weight per breakpoint (`cardTitleSize`, `cardTitleSizePx`, `cardTitleWeight`), and the read-more link's icon (arrow or plus), alignment (start or end) and weight.
  - **Header.** The lead takes a size per breakpoint and a colour (`leadSize`, `leadSizePx`, `leadColor`). The header button can sit below the lead (as before), at the end of the header or after the posts, per breakpoint (`headerButtonPlacement`), and can span the full width per breakpoint (`headerButtonFullWidth`).
  - **Markup.** The options are written as classes and custom properties on the block root (`cmsc-pb-latest-posts--*`, `--cmsc-post-*`); a button placed after the posts renders in `.cmsc-pb-latest-posts__action` after the carousel or grid. The shared carousel header (`carouselHeaderNode`, `CarouselHeaderBlock`) takes optional options for this; other blocks call it as before.
  - **Editor.** The new fields carry English and Polish labels; the responsive ones are on the Responsive tab.

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

- 3ccf23b: Carousel controls gain scheme-aware dots, an arrow glyph colour, per-breakpoint visibility and a place inside split slides.

  Nothing changes for content that does not use them: unset, every carousel renders the markup it had.

  - **Dots.** The dots of the Carousel, the product slider and the latest posts carousel follow the colour scheme: in a dark scheme the current dot is the scheme's text colour over faint dots (before, both were fixed greys and the current dot was hard to tell apart).
  - **Solid arrows.** `controls.arrowGlyphColor` sets the icon colour of a solid arrow (white by default), so a white solid arrow can carry a dark icon.
  - **Per breakpoint.** `controls.hideArrowsOn` and `controls.hideDotsOn` (the "Hide on" control: mobile, tablet, desktop) hide the arrows or the dots at those widths; a row of controls left empty there is removed.
  - **Header without a heading.** Arrows placed in the header of a carousel with no heading now stand at the header's end, as they do beside a heading (before, at its start).
  - **Inside split slides.** The Carousel's `controlsPlacement` accepts `slide`: each split slide draws the arrows and dots at the end of its text column, and only the slide on screen has operable controls. A carousel of other items keeps its controls below the slides there. `CarouselSlideControls` is exported for blocks that want to draw them.
  - **Markup.** A new root custom property (`--pb-arrow-glyph`) and classes (`cmsc-pb-carousel--arrows-off-*`, `--dots-off-*`, `cmsc-pb-carousel__controls--slide`, `--slide-fallback`); the editor fields carry English and Polish labels.

- 3ccf23b: Carousel controls: the dots at the start with the arrows at the end, an aligned row inside split slides, and arrows that stay when every slide fits.

  Nothing changes for content that does not use them: unset, every carousel renders the markup it had.

  - **Dots at the start, arrows at the end.** `controlsAlign` accepts `dots-start` per breakpoint (root `cmsc-pb-carousel--ctl(-md|-lg)-dots-start`) on the Carousel, the product slider and the latest posts carousel. The markup and its reading order are unchanged; the stylesheet moves the dots row first.
  - **Inside split slides.** A chosen `controlsAlign` now also aligns the controls drawn inside a split slide (`cmsc-pb-carousel__controls--al-*`, every breakpoint written). Unset, that row keeps its start alignment.
  - **Arrows when everything fits.** `controls.arrowsWhenFit` keeps the controls when every slide is already on screen: both arrows disabled (taking the disabled arrow look, on a looping carousel too) and the dots hidden with their space kept. Off, the controls hide as before. `CarouselShell` takes `keepArrowsWhenFit`.
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

- 4bc5c7f: Every asset reference these modules report is tagged with the `assetId` it points at, and each descriptor answers a batch of assets in one statement (`specs/166-asset-reference-visibility/`). The catalog's category content, CMS content and blog content scans used to run one JSON-path query per asset; each is now one query per batch, walking a document once however many assets are asked. Their references stay unrestricted: they never hide a library file.
- 91dfab5: Linking an existing library file by id refuses a file the administrator may not see in the library exactly as a missing one, and links nothing (`specs/166-asset-reference-visibility/` FR-006). This covers a product's gallery item, attachment and download file (on create), a category's main image, a blog post's and a blog category's main image, and a menu item's asset target and icon. Before, these links made such a file visible to every library reader. A file id that names no file now answers `404 NOT_FOUND` for the product download, the category image and the blog images, where it used to fail with a server error; the menu keeps its `400 MEGAMENU_ASSET_KIND_MISMATCH`.
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

- fdd026b: Every admin screen of these four modules can now be found from the command palette (⌘K / CTRL+K), with English and Polish labels and search keywords.

  - `@endora-commerce/mod-taxes` declares the `open-taxes` action for the tax-rule table (`taxes:read`).
  - `@endora-commerce/mod-blog` declares `open-blog-posts`, `open-blog-categories` and `open-blog-tags` (`blog.read`) beside the existing `new-post`.
  - `@endora-commerce/mod-carts` declares the `open-carts` action and a sidebar entry under _Sales_ for the platform-wide cart list (`carts:read`). The list was previously reachable only by typing its address.
  - `@endora-commerce/mod-mfa` declares the `open-security` action and a sidebar entry under _System_ for the signed-in admin's own two-factor authentication screen. Neither carries a permission code, like the screen itself: every admin manages their own second factor.

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
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
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
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [bec2e83]
- Updated dependencies [a166cfd]
- Updated dependencies [1a88646]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [d86466f]
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
  - @endora-commerce/mod-cms@0.109.0
  - @endora-commerce/page-builder-core@0.109.0

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
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/admin-kit@0.108.0
  - @endora-commerce/page-builder-admin@0.108.0
  - @endora-commerce/mod-cms@0.108.0
  - @endora-commerce/page-builder-core@0.108.0

## 0.107.0

### Minor Changes

- 8397b0f: Page Builder translation. A **Translate** action in the Page Builder toolbar translates the canvas of the language tab being edited — or only the selected component or text — with the LLM configured in Settings → Page Builder (`cms.page_builder.translation.enabled`, `…llm_credentials`, `…max_source_characters`; off by default), behind the new permission `cms.translate`, through `GET /api/v1/admin/cms/page-builder/translation` and `POST /api/v1/admin/cms/page-builder/translate`. The result is an unsaved change with _Restore previous content_; every request that sent text is audited as `cms.page_builder.translate`.

  For block authors: `BlockDefinition` gains an optional `translatable: [{ path, format? }]` (`format` `plain` | `tiptap` | `html`, paths like `items[].title`) naming the props that are prose; it is served on the Page Builder descriptor. A block without it is never sent to a model. Every CMS-context block of `cms` and `catalog` declares it. `PageBuilderHeaderActions` gains an optional `extraActions` slot, and the blog post and category editors pass the editor what the action needs.

### Patch Changes

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
- Updated dependencies [d70aeba]
- Updated dependencies [0bfab69]
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
  - @endora-commerce/mod-cms@0.107.0
  - @endora-commerce/page-builder-admin@0.107.0
  - @endora-commerce/page-builder-core@0.107.0

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
  - @endora-commerce/mod-cms@0.106.0
  - @endora-commerce/page-builder-admin@0.106.0
  - @endora-commerce/page-builder-core@0.106.0

## 0.105.0

### Patch Changes

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [2e355fb]
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
  - @endora-commerce/mod-cms@0.105.0
  - @endora-commerce/page-builder-admin@0.105.0
  - @endora-commerce/page-builder-core@0.105.0

## 0.104.0

### Minor Changes

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

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [bf51b0b]
- Updated dependencies [1bfbcea]
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
  - @endora-commerce/mod-cms@0.104.0
  - @endora-commerce/page-builder-admin@0.104.0
  - @endora-commerce/page-builder-core@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- Updated dependencies [7f6a4ba]
  - @endora-commerce/mod-cms@0.103.1
  - @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/page-builder-core@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [bb56a0d]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/mod-cms@0.103.0
  - @endora-commerce/page-builder-core@0.103.0
  - @endora-commerce/platform@0.103.0

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

- 489a0b6: Documentation: migrations are now named by the file that actually ships. The pages cited
  migrations by a retired numbering (`024_settings_init.ts`, "migration 102", `080_returns_init.ts`
  and others), which matches no file in any package. Each reference now gives the real
  timestamped filename, such as `20260611T140346_catalog_product_value_overrides_init.ts`, and
  says which module owns it where that is a different module. The organizations page also no
  longer claims that the `suspended` → `blocked` migration writes an audit-log entry: it writes
  an explanatory `blocked_reason` on each remapped row.
- Updated dependencies [3f7f481]
- Updated dependencies [489a0b6]
- Updated dependencies [489a0b6]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [255b60b]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/mod-cms@0.102.0
  - @endora-commerce/page-builder-core@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/mod-cms@0.101.1
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1
  - @endora-commerce/page-builder-core@0.101.1

## 0.101.0

### Patch Changes

- 5749604: Endora Commerce can be served from **one host with paths** — the storefront at `/`, the admin under `/admin`, the API under `/api` — as well as from one address per component.

  `@endora-commerce/cli`
  - **`endora install --public-url <origin>`** selects that layout. It stands for `--api-url <origin>`, `--storefront-url <origin>` and `--admin-url <origin>/admin`, each applied where the run has a use for it (so it works with `--only` on each machine in turn), and is refused beside any of the three. The API's address in this layout is the host itself — its routes already begin with `/api/v1` — so `--api-url` and `--storefront-url` still refuse a path, and now say why.
  - **`--admin-url` accepts a base path** after its origin (`https://example.com/admin`, or any other plain path; no trailing slash, query or fragment) and is accepted by a run that stands the admin up without the API, where it used to be refused. The path is written as `ADMIN_BASE_PATH=<path>/` into `admin/.env`.
  - **The scaffolded `admin/vite.config.ts` reads `ADMIN_BASE_PATH` as Vite's `base`** (default `/`). An instance scaffolded before this release gets the same by adding `base: env['ADMIN_BASE_PATH'] || '/'` to its own configuration.
  - With the API in the run, `ADMIN_BASE_URL` is the admin's whole address, path included, and `CORS_ALLOWED_ORIGINS` holds origins, each once. A port in an origin two components share is the proxy's, and is no longer written as either component's `PORT`.
  - The wizard, for a run that stands up only some components, asks how the three are reached before it asks any address: _one address each_, or _one address, with paths_ — which is then one question.
  - The closing block of such a run lists the routing the host owes: `/api/` and `/assets/file/` to the API unchanged, `/api/revalidate` exactly to the storefront, `/admin/` to the admin with its `index.html` as the fallback, everything else to the storefront.
  - **`deploy/nginx.paths.example.conf`** (single-host topology) is that routing for nginx, and `deploy/README.md` gains a section on it. `Dockerfile.admin` says how the image is built for a base path: a committed `admin/.env.production` holding `ADMIN_BASE_PATH=/admin/`.
  - **Both nginx examples forward `$http_host`** — the host with its port — as `Host` and `X-Forwarded-Host`, where they forwarded `$host`. Behind a proxy on any port but 80 or 443 the storefront refused every form submission (`x-forwarded-host … does not match origin`), because Next compares the two.
  - The storefront this CLI carries: its service worker leaves requests under `/admin` to the network, as it leaves `/api/`.

  `@endora-commerce/admin-shell`
  - **`AdminRoot` mounts its router under the bundle's base path.** New optional prop `basename`; by default it is derived from Vite's `import.meta.env.BASE_URL`, so a project built with `base: '/admin/'` gets a router under `/admin` with nothing else to set. With the default base nothing changes. New export `routerBasename(base)`.

  `@endora-commerce/mod-blog`, `@endora-commerce/mod-catalog`
  - Two admin screens linked with a raw absolute `href` (the _new category_ button of the blog category tree; the product links in the bulk-edit result list). Under a base path a raw `href` leaves the admin, and at the root it reloaded the application; both are the router's `Link` now.

- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/mod-cms@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0
  - @endora-commerce/page-builder-core@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/mod-cms@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2
  - @endora-commerce/page-builder-core@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/mod-cms@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1
  - @endora-commerce/page-builder-core@0.100.1

## 0.9.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0
  - @endora-commerce/mod-cms@0.10.8

## 0.9.7

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
  - @endora-commerce/mod-cms@0.10.7
  - @endora-commerce/page-builder-core@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/mod-cms@0.10.6
  - @endora-commerce/page-builder-core@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.9.5

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
  - @endora-commerce/mod-cms@0.10.5
  - @endora-commerce/page-builder-core@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.9.4

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
  - @endora-commerce/mod-cms@0.10.4
  - @endora-commerce/page-builder-core@0.9.4

## 0.9.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3
  - @endora-commerce/mod-cms@0.10.3

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2
  - @endora-commerce/mod-cms@0.10.2
  - @endora-commerce/page-builder-core@0.9.2

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

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/mod-cms@0.10.1
  - @endora-commerce/page-builder-core@0.9.1
  - @endora-commerce/platform@0.11.1

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

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0
  - @endora-commerce/mod-cms@0.10.0
  - @endora-commerce/page-builder-core@0.9.0

## 0.8.2

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/mod-cms@0.9.1
  - @endora-commerce/admin-kit@0.8.2
  - @endora-commerce/page-builder-core@0.8.2

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [02838b7]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/mod-cms@0.9.0
  - @endora-commerce/admin-kit@0.8.1
  - @endora-commerce/page-builder-core@0.8.1

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
- Updated dependencies [fa9e7d3]
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
  - @endora-commerce/mod-cms@0.8.0
  - @endora-commerce/page-builder-core@0.8.0

## 0.7.0

### Major Changes

- bd79430: **Breaking:** `@endora-commerce/mod-blog/backend` no longer exports any entity class by name.
  It exports one `entities` array instead (D-168).

  ```ts
  // before — eleven names, one per class
  import { BlogPost, BlogCategory } from '@endora-commerce/mod-blog/backend';

  // after — there is no replacement, and that is the point
  import { entities } from '@endora-commerce/mod-blog/backend';
  // entities: readonly [BlogCategory, BlogCategoryLanguage, BlogCategorySalesChannel,
  //   BlogPost, BlogPostCategory, BlogPostLanguage, BlogPostRelatedPost,
  //   BlogPostRelatedProduct, BlogPostSalesChannel, BlogPostTag, BlogTag]
  ```

  The array is the value a host's ORM registers, and it is what this package's consumers actually
  need: `configured-entities.ts` merges it into the entity set, and nothing else can usefully
  name an entity class. If you were importing one as a **type**, you were reaching into another
  module's internals — reach for the shape in `@endora-commerce/contracts` instead
  (`BlogPostDetail`, `BlogPostSummary`, `BlogCategoryTreeNode`, …), which is the published
  contract for every one of these rows. If you were relating to one with a MikroORM decorator,
  that was already forbidden (`check:kernel-boundary`, D-32).

  **Also fixed, and it was worse:** `@endora-commerce/mod-blog/migrations` now exports a
  `migrations` array beside the migration class it already named. It published only
  `export * from './20260506T081055_blog_init.js'`, and the platform's package loader refuses a
  `./migrations` export that declares no such array — so **an installed copy of this package
  stopped the host from booting**, with
  `the "./migrations" export of @endora-commerce/mod-blog exports no 'migrations' array`. The
  class name is unchanged, so no database sees a migration it has already applied as pending.

  Neither defect was reachable from this repository, which is why both shipped: a workspace
  member is linked rather than installed, and the host's committed entity registry imported the
  eleven classes directly. Packed into a tarball and installed into an instance — the way the
  package is actually consumed — the module registered **zero** entities, silently, once the
  migrations barrel stopped refusing the package outright.

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

- 6a9ae1d: New package: the Blog module, the first to leave `backend/src/modules/` (feature 080, T040b).

  It publishes three subpaths and no root wildcard, and every one of them serves compiled
  output (D-164):
  - `@endora-commerce/mod-blog` — the manifest. Isomorphic, `@endora-commerce/contracts` its
    only import, and the file the generated manifest index reads the module's identity,
    permissions, palette actions and activation control from.
  - `@endora-commerce/mod-blog/backend` — `registerModule(ctx)` plus the `entities` array the
    host's ORM registry spreads (see `blog-entities-array-d168.md`; this file described the
    eleven `@Entity()` classes as named exports, which they no longer are).
  - `@endora-commerce/mod-blog/migrations` — the `migrations` array the platform's package loader
    reads, and `Migration20260506T081055BlogInit` by name for the host's migration registry.

  `@endora-commerce/platform` is a `peerDependency` (D-160.2), and so are `@mikro-orm/*`,
  `fastify`, `ioredis` and `zod`. The package holds one copy of nothing: it resolves the host
  through the same `exports` map the application does, which is what keeps `HttpError`,
  `SalesChannel` and `effectiveState` single in the process.

  The manifest id stays `blog` — it is identity of record for the lifecycle registry, the
  settings store, the permission codes, the i18n bundle paths and the migration ownership
  (D-142). The npm name is only how npm keeps names unique.

### Patch Changes

- 54587bf: `blog` declares the nineteen error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied verbatim from the
  frozen capture, and is asserted equal to it in both directions.

  All nineteen already carry a written sentence in both `en` and `pl` in this
  package's own `i18n/` bundles, so no sentence moves and none is added. No
  `tokens`: no code this module raises passes a `details.code` discriminator.

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
- Updated dependencies [59c59c6]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [5fc0550]
- Updated dependencies [f66359f]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b8bd8c7]
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
- Updated dependencies [73da94f]
- Updated dependencies [661e80d]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [09df879]
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
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [afedd32]
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
  - @endora-commerce/mod-cms@0.7.0
  - @endora-commerce/page-builder-core@0.7.0
  - @endora-commerce/platform@0.7.0
