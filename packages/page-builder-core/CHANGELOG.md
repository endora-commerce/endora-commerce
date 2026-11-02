# @endora-commerce/page-builder-core

## 0.109.0

### Minor Changes

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

- 0e33ca9: A `cms.Column` can take another place in its Row per breakpoint, `cms.MediaText` item titles take a size and a weight, the carousel's filter bar can stay in one scrolling line, and a video's mobile version can have its own poster.

  Nothing changes for a page that does not use them: the default markup and look are the ones the blocks had.

  - **Column order per breakpoint.** `cms.Column` gains `stackOrder`, labelled **Order in the row**: `'auto'`, `'first'`, `'1'`–`'6'` or `'last'`, one value per breakpoint, on the Responsive tab. It is the vocabulary a block in a column already has. The published column cell writes it as `data-pb-order` and `--pb-order(-md|-lg)`, which the existing order rule reads as the CSS `order` of the Row's grid item. Only the visual order changes: the DOM, reading and focus order stay the stored order. The editor canvas keeps the stored order. `cms.Row` is unchanged. `@endora-commerce/page-builder-core` exports `createStackOrderField(label)` and `stackOrderAttributes(value)`, which `withHideOn` now uses too.
  - **Item titles in media and text.** `cms.MediaText` gains `featureTitleSize` (Default, a type-scale size or Custom px, per breakpoint), `featureTitleSizePx` and `featureTitleWeight` (Default or 300–800), applied to the item titles of every row. Unset, the titles keep their 16 px semibold look and markup. A choice wraps the title text in `span.cmsc-pb-media-text__feature-title-text`.
  - **Scrolling filter bar.** The carousel's `filter` gains `overflow: 'wrap' | 'scroll'`. Unset, the bar wraps as before. `scroll` adds `cmsc-pb-carousel__filter--scroll`: one line that scrolls sideways inside the block, with scroll snapping and no page overflow. The toolbar, its pressed state and its keys are unchanged. A button pressed with the pointer is scrolled into the bar's view.
  - **Mobile poster.** `cms.Video` (file source) and the video media of `cms.Hero` and `cms.MediaText` (and `cms.CarouselSplit`, which shares it) gain `mobilePosterAssetId` and `mobilePosterUrl`. The library image wins over the URL, and a relative URL is made absolute against the media origin. The mobile video takes it. One video with its own mobile poster renders the same file once per breakpoint, each with `preload="none"`. The admin's hero and media-and-text controls and the video's fields offer a library picker and a URL input.

  The `cms` bundle carries the English and Polish labels.

- 0e33ca9: The page, e-mail and document editors no longer show "(missing renderer)" blocks for the nodes inside a rich text.

  - `@endora-commerce/page-builder-core` exports `countComponentNames(doc)`: the Puck components a document places — an object whose `type` is a string beside a `props` object. `countBlockNames` is unchanged and still offers every `type`, as the block-name migrations and their report need.
  - The editors' degradation merge (`withMissingBlockPlaceholders`) now reads `countComponentNames`. Through `countBlockNames` it took each TipTap node and mark of a rich-text prop (`doc`, `paragraph`, `text`, `image`, `bold`, …) for a stored block and registered a placeholder for it.

- 0e33ca9: A colour that inherits the surrounding text colour shows as **Inherited (text color)** in the colour field instead of the raw `currentColor`.

  - `createColorField({ label, inherit: true })`: the field's empty state is `currentColor`. It shows an empty box with the **Inherited (text color)** placeholder and a swatch marked as inherited; picking a colour sets it, and **Inherit** (or emptying the box) returns to `currentColor`. Stored values are unchanged.
  - `cms.Icons` **Color** and `cms.Social` **Icon color** use it; a new icon or social list still stores `currentColor`.
  - Any colour field shows a stored `currentColor` or `inherit` as inherited, and the empty box's `transparent` placeholder is translated. New `core` keys `pageBuilder.fieldText.color.inherited`, `.inherit`, `.inheritFor` and `.transparent` (English and Polish).

- 0e33ca9: An inline icon can have its own size and vertical offset, and a Section's or a Section group's image background and decorative backdrop can have a size, a repeat and a position.

  Nothing changes for content that does not use them: an icon with no size or offset is drawn at 1 em on the line as before, and a background with none of the new values renders the same markup and look.

  - **Inline icon size and offset.** The `inlineIcon` node of `InlineRichText` accepts optional `size` (`'0.5em'`–`'3em'` or `'8px'`–`'200px'`, `isInlineIconSize`) and `offset` (em of the text, −1 to 1, `isInlineIconOffset`), each also as `null`. `InlineRich` draws the icon at that size and moves it with `vertical-align`; `inlineIconPresentation` is exported for editors that draw it. `inlineIconNode` writes them as `data-cms-icon-size` / `data-cms-icon-offset`, the same through the DOM-free serializer and TipTap's, and reads them back. The icon dialog of the inline rich-text field sets both, edits a selected icon (**Edit icon**), and is translated through the page builder's field text.
  - **Background size, repeat and position.** `sectionBackgroundSchema` gains `size` and `repeat` for an image (`'cover' | 'contain' | 'auto' | {px} | {percent}` and `'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y'`), and `decorativeSize`, `decorativeRepeat` and `decorativePosition` for the decorative backdrop; `BACKGROUND_SIZE_KEYWORDS`, `BACKGROUND_REPEATS` and `backgroundSizeToCss` are exported. An image with a natural or fixed size or a repeat is painted as a CSS background (`.cmsc-section__tile`, with the mobile image below 768 px); `contain` keeps the picture. The backdrop's values are written on the section or the group's paint layer. The Section background field offers them, with `cover`, no repeat and the top position as the defaults.

  `@endora-commerce/mod-i18n` adds the English and Polish `pageBuilder.fieldText.section.*` and `pageBuilder.fieldText.inlineIcon.*` labels; the `cms` module's documentation describes both.

- 0e33ca9: The page builder's component options panel is easier to read and no longer scrolls sideways at its usual width (about 20rem).

  - `@endora-commerce/page-builder-core`: every custom field control renders with `PB_FIELD_INPUT_CLASS`, which keeps it inside its column. The controls had named a Puck CSS-module class that Puck 0.23 renamed, so they rendered unstyled, as wide as their content, and the panel scrolled sideways wherever a colour field or a long select appeared. The colour field's swatch, text box and Palette button stay on one row that fits the panel, and each control has its own accessible name. A value per breakpoint nested inside an object or array item (an image's aspect ratio) shows one label and a Mobile / Tablet / Desktop switch instead of three columns of controls, and a breakpoint with its own value is marked; a top-level value per breakpoint stays a field of the Responsive tab. Top-level fields are separated by a rule again. New exports: `PB_FIELD_INPUT_CLASS`, `PB_FIELD_LABEL_CLASS`, `PB_FIELD_HINT_CLASS`, `FieldControlLabel`, `ResponsiveTiers`, `FIELD_TIERS`, and `PAGE_BUILDER_FIELD_TEXT`, `PageBuilderFieldTextProvider` and `useFieldText`, through which a host translates the package's own field controls. `PuckFieldLabel` takes Puck's `el`.
  - `@endora-commerce/page-builder-admin`: `PageBuilderFieldText` translates those controls from the `core` bundle and is mounted by `PageBuilderColorPaletteProvider`, so the page and e-mail editors both get it. The image field's aspect ratio uses the same breakpoint switch. The link and image fields use the shared input and label classes.
  - `@endora-commerce/cms-components`: the table and catalog fallback controls use the shared input class.
  - `@endora-commerce/mod-i18n`: `pageBuilder.fieldText.*` in English and Polish.

- 0e33ca9: A rich-text "read more" can place its summary and open upwards, an accordion gains look options, both open and close with an animation, and a highlighted phrase can take any brand colour or hex.

  Nothing changes for content that does not use them: the default markup and look are the ones the blocks had.

  - **Read more position and reveal above.** The rich-text `readMore` node gains `chevronPosition` (`'start' | 'center' | 'end'`, `'start'` by default) and `revealAbove` (`false` by default). They add `cmsc-read-more--center` / `--end` and `cmsc-read-more--reveal-above` to the `<details>`, the same through the DOM-free serializer and TipTap's, and are parsed back from them. The sanitiser is unchanged. Reveal above shows the open passage's content above its summary through CSS order only: the summary stays the first child and the one control. The rich-text toolbar gains **Read more position** and **Show the revealed text above the summary**.
  - **Animated open and close.** A read-more passage animates its `::details-content` height and an accordion panel its height and opacity, only without reduced motion and only where the browser supports `interpolate-size` (instant elsewhere). An accordion animates only after hydration (`data-animate`), so a panel open by default does not animate on page load. Every accordion panel stays in the server HTML, `hidden` while closed.
  - **Accordion look.** `cms.Accordion` gains `icon` (`'plus' | 'chevron'`), `itemStyle` (`'plain' | 'boxed'`), `dividers` (`'none' | 'between' | 'all'`, for plain items) and `titlePadding` / `titlePaddingPx` (a spacing token or Custom px per breakpoint, on the Responsive tab). Each is unset by default and writes nothing then.
  - **Emphasis colour.** The inline rich-text `emphasis` mark accepts an optional `color` (`#rrggbb` or `token:<role>`, `null` as unset) in `inlineRichTextSchema`. It renders `data-cms-em-color` and an inline `color` on the variant's span, in `InlineRich` and through both TipTap serializers. A colour outside that grammar renders today's span. The rich-text sanitiser keeps `data-cms-em-color` on a `<span>` with a colour value only. The inline toolbar gains **Highlight colour** (brand colours, a hex, **Remove colour**). The translation codec carries the mark unchanged.
  - **Labels.** The new toolbar and dialog labels are page-builder field text (`pageBuilder.fieldText.emphasisColor.*`, `pageBuilder.fieldText.readMore.*`), and the accordion fields are labelled in English and Polish.

- 0e33ca9: The rich text's image dialog picks an image from the asset library where the host provides a picker, and its width row lays out properly.

  - `@endora-commerce/page-builder-core` exports `PageBuilderImagePickerProvider`, `useImagePicker()` and the types `PageBuilderImagePicker`, `PageBuilderImagePickerProps` and `PickedImage` (`{ url, alt? }`): a host's image picker for controls that cannot import the admin. Without a provider `useImagePicker()` answers `null`.
  - The image dialog of `RichContentEditorField` (`@endora-commerce/cms-components`), used by every rich text in the page and e-mail builders, offers **Image source: Asset library / URL** when a picker is provided: the library first for a new image, the URL for an existing one. The chosen image's address is inserted, and its alternative text when the field is empty. Without a picker only the URL, as before. The stored image node does not change.
  - The **Width** number takes the row and its unit select a fixed 76 px; they no longer fight over one width.
  - `@endora-commerce/page-builder-admin` provides the asset library as that picker inside `PageBuilderColorPaletteProvider`, and exports `AdminImagePicker` and `pickedImageFromAsset(asset, language)`: the asset's stable `fileUrl`, made absolute, and its alternative text in the admin's language first.
  - `@endora-commerce/mod-i18n` carries the dialog's new copy (`pageBuilder.fieldText.richImage.*`) in English and Polish.

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

- 0e33ca9: The page builder's settings panel speaks one language: one switch for every on/off setting, and every label translated — the settings every block shares translated once.

  Nothing stored changes: a switch stores the same `true` / `false` the Yes/No choices stored.

  - `@endora-commerce/page-builder-core` exports `createToggleField({ label, defaultValue?, metadata? })` — a `role="switch"` button inside its label, operable by pointer and keyboard, showing the block's default while the prop is unset; with the responsive metadata it edits the breakpoint the Responsive tab selects — and `ToggleSwitch` for a custom control's own on/off setting. Every Yes/No radio of the bundled blocks, the row's "Clip content", a video's autoplay, muted, loop and controls, a carousel's loop, autoplay and equal heights, its arrows and dots (now **Show arrows** / **Show dots**), the border's **Show border**, the section reveal's desktop-only, a media-and-text video's autoplay and a link's **Open in new tab** are switches.
  - Shared fields carry their key: `withSharedFieldLabel(key, field)`, `sharedFieldLabel(field)` and `PAGE_BUILDER_SHARED_FIELD_KEYS` (editor name, Hide on, order in the column, box spacing, border, background, rounded corners, shadow, colour, typography, minimum height). The admin translates such a field from the `core` bundle's `pageBuilder.sharedFields.<key>` after the block's own key and before the English; a block that relabels a shared field keeps its own key. `applyPageBuilderTranslations` takes the shared resolver as a fifth argument, and translates the options a custom field carries.
  - The words inside the page builder's controls — spacing, border (a border side now labels its **Width (px)**, **Style** and **Color**), the per-breakpoint hints, the editor's name, the background control and the asset picker — come from the `core` bundle in English and Polish.
  - `withHideOn` puts **Hide on** back when a block's own `resolveFields` returns a field set without it (the heading, row, table and map had lost it).
  - Every bundled block's field and option labels resolve in Polish; the block keys are in the declaring module's bundle (`cms`, `catalog`, `blog`, `newsletter`), the shared ones in `core`. Labels use US spelling (**Color scheme**, **Center**), one wording (**Email**, **Alt text**, **Minimum height**, "Custom … (px)", **Rounded corners**), and side choices read **Left / Right**.

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

- 3ccf23b: Rich text gains a text size on selected words and more bullet-list markers.

  Nothing changes for content that does not use them: a rich text saved before renders the same markup.

  - **Text size.** The rich text toolbar's **Text size** sizes the selection with a type-scale step (`<span class="cmsc-fs cmsc-fs--<step>">`, sized per breakpoint by the stylesheet). It is stored as the `textSize` mark; the renderer and the sanitizer also accept a `font-size` in px from 8 to 200 on a `<span>` (`<span class="cmsc-fs" style="font-size: Npx">`), which the toolbar does not offer.
  - **List marker.** A bulleted list's **List marker** is **Disc** (default), **Check mark** (as the check list before), **Chevron** or **None** (`cmsc-list--chevron`, `cmsc-list--none`).
  - The server and the editor write the same markup. New `core` keys `pageBuilder.fieldText.textSize*` and `pageBuilder.fieldText.listMarker*` (English and Polish).

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

- 3ccf23b: Buttons inside blocks take the Button block's look options, and an icon-only button can be a pill.

  - `ButtonSpec` (`buttonSpecSchema`) gains optional `transparentOutline`, `borderColor` and `iconOnlyShape` (`'circle' | 'pill'`). A button saved before parses and renders as it did.
  - A hero's, a card's, a panel's, a header's or a listing's button renders them through the same `ButtonView` path as `cms.Button`, whose own block-level look options are unchanged and win over the spec's. `cms.Button` gains `iconOnlyShape`.
  - A pill is `cmsc-btn--icon-pill`, 1.15 times its height.
  - `createButtonSpecField` takes `look: false` (used for `cms.Button`); `BUTTON_LOOK_FIELDS` is exported, its labels translated once in the `core` bundle (`pageBuilder.sharedFields.button*`).

### Patch Changes

- 0e33ca9: `cms.Tabs` and `cms.Accordion` panels hold blocks, and the rich-text block gains anchors, a check list, a read-more toggle and button-styled links.

  **Tabs and Accordion — panel content moved to `items[].panel`.** Each item's panel is now a slot of blocks at `items[].panel` (any block except `cms.Column`, `cms.Tabs` and `cms.Accordion`) instead of the HTML string at `items[].content`. Stored content is not rewritten: an item that still holds `items[].content` renders that HTML, sanitised as before, and the editor moves it into the slot as one `cms.RichContent` block the first time the page is opened (`tabsFromLegacy`, `accordionFromLegacy`). The translation declaration keeps `items[].content`, so unopened pages stay translatable; blocks in a panel translate through their own declarations. Code that writes page documents should write `items: [{ title, panel: [{ type: 'cms.RichContent', props: { id, … } }] }]` rather than `items: [{ title, content: '<p>…</p>' }]`; the exported `TabItem` and `AccordionItem` types now extend `PanelItem`.

  Both blocks are now fully accessible: unique ids per instance, `aria-controls`, every panel rendered on the server (hidden ones with `hidden`), arrow, Home and End keys on the tab list with roving focus. `cms.Tabs` adds `effect: 'none' | 'fade'`; `cms.Accordion`'s `defaultOpen` also accepts a list of indexes. The page-builder outline in `@endora-commerce/page-builder-core` lists blocks inside a panel.

  **Rich text** (`cms.RichContent` and the TipTap extensions in `@endora-commerce/cms-components`): headings may carry an anchor (`id`, normalised to the section-anchor pattern) and be visually hidden; bullet lists may be check lists; a read-more block renders as `<details class="cmsc-read-more"><summary>`; a link may render as a button (`cmsc-btn` style and fill); and text may carry the `emphasisMark`. New exports: `emphasisMark`, `readMoreNode`, `readMoreSummaryNode`, `readMoreContent`, `richContentAttributes`, `BUTTON_LINK_VARIANTS`. The sanitiser now keeps `details`, `summary` and `open`, and an `id` on `h1`–`h6` only when it matches the anchor pattern; everything it dropped before it still drops. No new TipTap package is required.

  **Rich text renders on the server.** `htmlFromTiptap` (and `resolveRichContentHtml`, `coerceRichContentProps`, every block's rich body) no longer goes through TipTap's `generateHTML`, which needs a DOM and returned `''` on the server: a DOM-free serializer walks the same schema and node and mark `renderHTML` specs, so a body stored only as TipTap JSON is in the server HTML and hydrates without a mismatch. The output passes through the same sanitiser; a colour stays in the notation it was stored in (a browser's DOM used to rewrite it as `rgb()`). `cms.RichContent` now takes its text, heading, link and quote colours from the section's colour scheme and its body size, line height and heading font from the brand tokens, each with its previous literal as the fallback (`.cmsc-pb-rich-content`); the body text of the new blocks uses the brand body font and a heading inside a rich body the brand heading font (with no brand tokens both inherit the page's font, as before); an image inside a rich body never grows wider than its column; and the `cms.Tabs` tab list wraps instead of running past a narrow screen.

- eeed924: `endora new module` scaffolds a package whose co-located tests are type-checked: the test patterns are excluded in `tsconfig.build.json` (the emit) rather than in `tsconfig.json` (the type-check), and a package with an admin layer gets a `tsconfig.ui.build.json` that extends `tsconfig.ui.json` and adds only the test exclusion. A package scaffolded earlier keeps working; to have its `src/**/*.test.ts` files type-checked, make the same move by hand and point the `build` script's UI compile at `tsconfig.ui.build.json`.

  `contextAdmits` is also exported from `@endora-commerce/page-builder-core/context-admits`, a module that imports nothing but a type, so a Node program can use the rule without compiling the editor. The export from the package root is unchanged.

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

## 0.108.0

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

## 0.107.0

### Minor Changes

- dd939be: Document-template editor support (`specs/152-compare-pdf-template/`).

  - `@endora-commerce/page-builder-core/contributions`: `DocumentSampleProvider` and
    `useDocumentSample<T>()` — the sample document an editor hands its block renderers (`null`
    outside a provider) — and the `DocumentBlockEditorConfig` type, the default export of an admin
    block contribution for the `document` context.
  - `PageBuilderContext` / `PAGE_BUILDER_CONTEXTS` gain `'document'`; `contextAdmits` admits nothing
    into or out of it.
  - `@endora-commerce/page-builder-core/editor` re-exports `Puck`, so an editor in a module package
    mounts the same `@puckeditor/core` copy the outline and overlay helpers read their context from.

### Patch Changes

- Updated dependencies [fcf4d09]
- Updated dependencies [70bb5e5]
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
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/contracts@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0

## 0.105.0

### Patch Changes

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0

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

## 0.103.1

### Patch Changes

- @endora-commerce/contracts@0.103.1

## 0.103.0

### Minor Changes

- d0e76fd: New subpath `@endora-commerce/page-builder-core/contributions` — what a module package ships its Page Builder renderers in, and what a surface composes them with. Types `StorefrontContributions`, `StorefrontBlockConfig`, `PageBuilderBlockEditorConfig`, `BlockRenderFunction`, `BlockRenderEnvironment` and `BlockPresence`; `useBlockRenderEnvironment()` (the request language and the preview flag) with `BlockRenderEnvironmentProvider`; and the composition steps `withContributedBlocks`, `withPresence`, `isOwnerPresent`, `withBlockBoundary` (one failing block degrades to a placeholder, on the server and in the browser), `fieldsFromDescriptor`, `editorConfigFromDescriptor` and `neutralBlockPreview`. Nothing existing changes.

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
  - @endora-commerce/contracts@0.103.0

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

- @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- @endora-commerce/contracts@0.100.1

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

## 0.9.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0

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
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0

## 0.9.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0

## 0.9.2

### Patch Changes

- Updated dependencies [b413e2d]
  - @endora-commerce/contracts@0.13.0

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
  - @endora-commerce/contracts@0.11.0

## 0.8.2

### Patch Changes

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0

## 0.8.1

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0

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

- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [4eeb5cd]
- Updated dependencies [9eb0cb6]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [5ba2e97]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0

## 0.7.0

### Major Changes

- 11fc9f3: Renamed from `@b2b/page-builder-core` to `@endora-commerce/page-builder-core`. Nothing
  else about the package changed — same `exports` subpaths, same React contexts and hooks.

  Update the dependency and every specifier, root and subpath alike:

  ```diff
  -"@b2b/page-builder-core": "workspace:^"
  +"@endora-commerce/page-builder-core": "workspace:^"
  ```

  ```diff
  -import { DEFAULT_BREAKPOINTS } from '@b2b/page-builder-core/types/responsive';
  -import { usePageBuilderPuck } from '@b2b/page-builder-core/editor';
  +import { DEFAULT_BREAKPOINTS } from '@endora-commerce/page-builder-core/types/responsive';
  +import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor';
  ```

  This package is a **peer** dependency of `@endora-commerce/cms-components` and
  `@endora-commerce/email-components` and ships React contexts, so the application has to
  resolve exactly one copy of it. Rename it in the same install as those two: a tree that
  holds `@b2b/page-builder-core` for one consumer and `@endora-commerce/page-builder-core`
  for another resolves two copies, and a provider in one against a consumer in the other is
  a `null` context at runtime, not a type error.

- f66ce9b: `@endora-commerce/page-builder-core` now ships compiled JavaScript and declarations. `main`, `types`
  and all nine `exports` subpaths resolve under `./dist`; `files` is `["dist"]`.

  **What changes for you.** The package no longer hands you TypeScript. Every subpath keeps
  its public name and its target file, one directory over:

  ```
  '@endora-commerce/page-builder-core'                            ./src/index.ts        → ./dist/index.js
  '@endora-commerce/page-builder-core/client'                     ./src/client.ts       → ./dist/client.js
  '@endora-commerce/page-builder-core/editor'                     ./src/editor.ts       → ./dist/editor.js
  '@endora-commerce/page-builder-core/types/responsive'           ./src/types/…         → ./dist/types/…
  '@endora-commerce/page-builder-core/fields/hide-on-field'       ./src/fields/….tsx    → ./dist/fields/….js
  ```

  so no import statement changes — but the `transpilePackages` entry, loader or bundler
  plugin you needed to compile its source does, and can go. `ResponsiveProp`,
  `DEFAULT_BREAKPOINTS`, `defineComponent` and the rest keep their names and shapes.

  **`"use client"` is preserved verbatim**, as the first line of each emitted file, above
  the injected JSX-runtime import. That is a property of `tsc`'s emit, and it is why this
  package is compiled rather than bundled: module merging is what hoists a directive out of
  place, and no bundler runs here.

  **React and `@measured/puck` remain optional peer dependencies.** This package ships React
  contexts and hooks, so the consuming application must resolve exactly one copy of it —
  two copies mean a provider in one and a consumer in the other, which is a `null` context
  at runtime and not a type error. That is also why its version moves together with
  `@endora-commerce/cms-components` and `@endora-commerce/email-components`.

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

- 727cbf5: Publish the four readers of a Page Builder block name.

  ```ts
  import {
    formatBlockName,
    isNamespaced,
    ownerOf,
    parseBlockName,
    type ParsedBlockName,
  } from '@endora-commerce/page-builder-core';
  // or, from a migration, which wants none of this package's React:
  import { ownerOf } from '@endora-commerce/page-builder-core/block-name';

  parseBlockName('catalog.ProductGrid'); // { owner: 'catalog', local: 'ProductGrid' }
  parseBlockName('Row'); // null
  ownerOf('orders.EmailOrderSummary'); // 'orders'
  isNamespaced('Row'); // false
  formatBlockName('catalog', 'ProductGrid'); // 'catalog.ProductGrid'
  ```

  A block name is `<ownerModuleId>.<LocalName>` and is persisted, so **import these
  rather than splitting the string yourself** — that is the whole point of the
  export, and the next release adds a CI check that refuses a second copy.

  Two asymmetries are deliberate, and a consumer should know which side of each it
  is on. **`parseBlockName` and `ownerOf` answer `null`** where the string is not a
  well-formed block name, because the callers that matter are a data migration and
  an operator report, both of which meet unrecognised names as a matter of course
  and must leave the row byte-identical. **`formatBlockName` throws**, because
  writing an unparseable name persists a node nothing can ever render.

  **`isNamespaced` is stricter than `name.includes('.')`.** They agree on every
  name in the pre-migration vocabulary, none of which contains a dot; they differ
  on a _malformed_ dotted name such as `acme.banner`, which the lax test would
  report as already namespaced and this one reports as unrecognised — which is the
  classification that gets it in front of an operator.

  This package now depends on `@endora-commerce/contracts`, which authors the name
  grammar (`blockNameRe`) that the manifest schema also has to enforce. It is a
  workspace dependency and pulls in no third-party package a consumer of the
  contracts is not already resolving.

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

- b9d15af: Adds `contextAdmits(declared, target)` — the one implementation of _"does a block
  declared for these contexts appear in this palette"_.

  If you were writing `contexts.includes(context)` to decide whether a block belongs
  in a palette, that is right for `cms`, `email` and `invoice` and **wrong for
  `newsletter`**: the platform admits every `email` block into the newsletter
  palette, and no block declares `newsletter` at all. Import `contextAdmits`
  instead.

  Nothing is removed and no behaviour changes. `filterConfigByContext` and
  `getDisallowedComponentNames` now call it rather than each carrying their own
  copy of the rule — they had one apiece, one positive and one negated, and the two
  were proved equivalent over all 64 subset/context combinations before the
  extraction rather than after.

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
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
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
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a47dcc8]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [bbf9258]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
