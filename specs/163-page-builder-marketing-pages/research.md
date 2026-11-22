# Research: Page builder for corporate marketing pages

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-10-22

Each entry gives the decision, why it was chosen, and the alternatives that were rejected. The
evidence comes from a read of the tree at `origin/master` 6f66ea18e. Paths are repository-relative.
Item R-0 records the facts the decisions rest on.

---

## R-0. Facts the design rests on

### Page-builder stack

- **Puck and TipTap versions.** Puck is 0.23.0 (`@puckeditor/core`) and TipTap is 3.31.3.
- **Rendering.** The same components render in the admin canvas and on the storefront.
  - Every block file in `packages/cms-components` is `'use client'`.
  - `storefront/components/PageBuilderRender.tsx` is a client component: SSR followed by full
    hydration, with no islands.
- **Root versus slot.** A block's render receives no parent or depth information.
  - `resolveData` and `resolveFields` do receive `parent` (`null` at the root), but only the
    admin runs them.
  - `withHideOn` (`page-builder-core/src/visibility/with-hide-on.tsx`) already wraps every
    block's render.
- **Slot storage.** Slot children are stored inline in the parent's props.
  - Puck 0.23 supports slot fields inside `array` items.
  - The translation walker (`cms/src/backend/services/translation/extract.ts`, `componentsOf`)
    recurses into every slot automatically and judges each child by its own declaration.
- **Responsive styles.** Published styles are CSS custom properties per element, consumed by
  fixed `@media (min-width: 768px | 1024px)` rules in `packages/cms-components/styles/cms-components.css`.
- **Carousel.** `carousel/CarouselShell.tsx` is a custom native scroll-snap carousel with no
  library.
  - Slides per view are resolved in JavaScript from `useViewportBreakpointTier()`, whose server
    snapshot is 360 px. The server therefore always renders the mobile count, and the layout
    shifts after hydration.
  - It has no fade mode and no reduced-motion handling.
- **Tabs and Accordion.** Both take raw HTML panels through `sanitizeHtml`.
  - Tab ids are index-based, so two Tabs blocks on one page collide.
- **Rich-text sanitizer.** The rich-content policy (`utils/sanitize-html.ts`):
  - allows `class` and `style` globally;
  - keeps only `color`, `background-color` and `text-align` declarations;
  - strips `id`, `<details>`/`<summary>`, `div`, `button`, and `data-*` (except on `mark`).
- **Asset references.**
  - The render-time asset map collects only keys matching `/assetId$/i`
    (`content-tree-walker.ts`, `walk-asset-ids.ts`).
  - The reference index is value-based (`jsonb_path_exists … == uuid`), so key names do not
    matter there.
- **No host tokens in blocks.** `cms-components.css` states that it "references NO host CSS
  variable".
  - Button colours are hard-coded (`#1261a6`), and so are fonts
    (`typography.ts` `FONT_FAMILY_CSS`) and about 100 colour literals.
  - The admin preview iframe receives only `cms-components.css`, never the storefront theme.

### Settings and theming

- **Per-channel overrides.** Every setting can be overridden per sales channel. The read order
  is channel row, then global value, then default (`platform/src/kernel/settings/settings.service.ts`).
- **`json` settings.** A `json` setting is validated only as `unknown`. Shape checks go through
  `SettingWriteValidatorRegistryPort`.
- **Hidden settings.** `hidden: true` settings get a module-owned admin screen. Precedents are
  `pwa`, `invoices` and `newsletter`.
- **Settings writes are not Commands.**
  - `SettingsAdminService` writes the audit entry itself, drops the settings cache and emits
    `settings.value_changed`.
  - The colour-palette write in `cms` (`setColorPaletteWriter`) goes through it.
- **No storefront revalidation on settings writes.**
  - No settings write triggers a storefront revalidation.
  - `StorefrontRevalidator` (`platform/src/http/storefront-revalidator.ts`) exists, and CMS uses
    it on content change.
- **Storefront theme and fonts.**
  - The storefront theme is `sales_channels.theme_code` → `<html data-theme>`, with code-defined
    token sets in `storefront/app/globals.css`.
  - No server-rendered `<style>` exists today.
  - Fonts are one Google Fonts `@import`.
- **Font files in the asset library.** The asset library accepts `woff2`, `woff` and `ttf` by
  default and serves them as `attachment` with CORS from the global `@fastify/cors` allow-list
  (`CORS_ALLOWED_ORIGINS`).

### Data modules

- **Blog.**
  - Posts have **no image column**, so `toPostCard.mainImageUrl` is always null.
  - The storefront API has no category or limit filter: `/by-channel` returns `latestPosts`
    capped by `blog.latest_count`.
  - Blog declares no blocks.
- **SSR data for blocks is catalog-only and closed.** The seam is
  `cms-components/src/utils/catalog-block-data.ts` (`DECLARATIONS`, the request union),
  `storefront/components/CatalogBlockData.tsx` and the admin `AdminCatalogPreviewProvider`.
  - Spec 141's module renderer contract offers module blocks no server-data hook: only props, the
    render environment, or a client fetch in an effect.
- **Product card.** `CmsProductSummary` has no short description. Every product link is
  `/p/<slug>`.
- **Newsletter.**
  - `POST /api/v1/newsletter/subscribe` takes `{email, channelCode, tags?, customFields?, source?}`.
  - Tags are codes, and unknown codes are ignored.
  - Consent is recorded as a `consentAt` timestamp plus an audit entry.
  - Double opt-in is per channel.
  - The `cms.NewsletterSignup` block is a bare `<form action={actionUrl}>`.
- **CMS page.**
  - The page has no parent, sharing image or breadcrumb settings.
  - `generateMetadata` emits title, description, keywords and canonical, but no Open Graph.
  - Breadcrumbs are fixed at two levels.
  - Page writes are Commands (`cms_page.*`).
- **Languages are not in the URL.** The storefront picks a locale from a cookie or
  `Accept-Language`, and one URL serves every language.
- **Organization JSON-LD.** It exists (`storefront/components/seo/OrganizationJsonLd.tsx`, from
  `/api/v1/storefront/shop-info`) but renders only on `/`. It has no logo and no `sameAs`.
- **Seeders.** Only three seeders write page-builder content:
  - newsletter consent: `cms.Text`;
  - cookie consent: `cms.Text`;
  - conformance fixtures: `cms.Heading`.

  No demo seeder writes CMS pages.
- **Templates.** Nothing seeds templates. "Apply template" replaces the whole canvas.
  `row-layout-presets.ts` is the existing code-side preset precedent.

---

## R-1. Brand tokens are a `cms`-owned table, one complete set per scope

**Decision**:

- `cms` owns the table `cms_brand_tokens`, with columns `id`, `sales_channel_id` (null for the
  global row, unique with nulls not distinct), `tokens jsonb`, `version` and `updated_at`.
- The global row holds a complete `BrandTokens` object. A sales channel's override is another
  complete object in its own row.
- "Reset to global" deletes the channel row. With no global row, `DEFAULT_BRAND_TOKENS` apply.
- The shape is validated by `cmsBrandTokensSchema` in `packages/contracts/src/cms-brand.ts` at
  the write route.
- Read order: the channel row, then the global row, then the defaults. It is one indexed query
  for both rows.

**Rationale**:

- **One write path, one audit entry.** The Command that writes the row owns the write, its audit
  entry and its event in one transaction (R-2, Principle XIII).
- **`cms` is the consumer.** The tokens exist so that page-builder blocks render on-brand
  (FR-006), so `cms` owns them.
- **Whole-set overrides keep resolution trivial**, and the editor screen can show "inherits
  global" or "overridden" (spec Assumptions, channel brand overrides).
- **No cache of its own is needed.** The storefront caches the read under the `cms:brand` tag
  for 300 s and is revalidated on every write. The admin reads are rare.

**Alternatives rejected**:

- **A hidden `json` setting.** Settings writes audit by hand, after `em.flush()` and outside any
  transaction, and no `setting.*` Command exists. `platform/src/lifecycle/commands/activation.commands.ts`
  documents both facts. A Command over a settings write would therefore record two audit entries
  for one change, which gate 12 forbids. The kernel-side fix, a Command-only settings write as for
  module activation, changes `packages/platform` and a port many modules use.
- **Per-token inheritance**, storing a sparse channel object merged over the global one. It needs
  merge rules for nested scales, and nothing in the spec asks for partial inheritance
  (Principle IV).
- **A new `brand` module.** It would be a module with one table and one screen, and it would sit
  beside `cms` in every consumer.
- **Extending storefront `data-theme` packages.** The owner ruled for admin-editable tokens
  (Clarification Q1).

---

## R-2. Brand-token writes are one `cms` Command

**Decision**:

- `PUT /api/v1/admin/cms/brand-tokens` runs the Command `cms.brand_tokens.update` through
  `CommandBus.run`. The body is `{scope: 'all' | {salesChannelId}, tokens | null, expectedVersion}`,
  where `null` resets the scope.
- The Command upserts or deletes the scope's `cms_brand_tokens` row in its transaction, checking
  `version` for optimistic locking (409 on a mismatch).
- It records exactly one audit entry, with object `{type: 'cms_brand_tokens', id: 'global' |
  salesChannelId}` and before/after.
- After commit, `cms` calls `StorefrontRevalidator.revalidate(['cms:brand'])`.
- The route is gated by the new permission `cms.brand`.

**Rationale**: Principle XIII. The write, the audit entry and the event are one unit, and nothing
else audits the same change.

**Alternative rejected**: writing through the colour-palette pattern, a plain call to
`settingsAdminService` with no Command. That is the precedent for the palette, but new writes must
not copy it, and the settings service audits outside the transaction (R-1).

---

## R-3. Storefront delivery: one public read, CSS variables in a server `<style>`

**Decision**:

- **Public read.** `cms` adds `GET /api/v1/storefront/cms/brand-tokens`. It resolves the tokens
  for `getResolvedChannel(request)` and answers `{data: BrandTokens}`, or the built-in defaults
  when nothing is set.
- **Fetch.** The storefront fetches it in `getServerContext()` with `{ revalidate: 300, tags:
  ['cms:brand'] }`.
- **Injection.** `StorefrontDocument` renders `<style id="cmsb">` in `<head>`. Its content is
  produced by a pure function `brandTokensToCss(tokens)` that lives in `cms-components`
  (`src/brand/brand-css.ts`), so the admin uses the same function.
- **Fonts.** Font stylesheets or `@font-face` rules for asset-library fonts are emitted beside
  it, together with `<link rel="preload" as="font" crossorigin>` for the body font's regular
  weight.
- **Variable names and fallbacks.**
  - Every variable is namespaced `--cmsb-*`.
  - Every use in `cms-components.css` is `var(--cmsb-x, <today's literal>)`.
  - With no `<style id="cmsb">`, as in the e-mail editor, nothing changes.
- **Cache.** `cms` adds a `cms-brand` entry with `storefrontTags: ['cms:brand']` to
  `CACHE_NAMESPACES` (`packages/modules/settings/src/backend/services/cache-admin.service.ts`), so
  the manual cache flush also revalidates the tag.

**Rationale**:

- The change takes effect without a rebuild (FR-006a).
- The output is SSR-only, so there is no flash of the wrong brand.
- The package stays self-contained: the variables are its own and their fallbacks keep its
  "no host variable" behaviour.

**Alternatives rejected**:

- **Writing the tokens into `globals.css` at build time.** It requires a rebuild and contradicts
  FR-006a.
- **Reusing the storefront tier-1 tokens (`--brand-700` and similar).** They are code-defined per
  theme, and the page builder would then depend on the host theme.
- **Client-side injection.** It causes a flash and adds layout shift.

---

## R-4. Admin preview applies the same tokens inside the Puck iframe

**Decision**:

- `GET /api/v1/admin/cms/page-builder/config` accepts `?salesChannelId=`.
- The descriptor gains `brandTokens`: the effective set for that channel, or the global set.
- `PageBuilderEditor` passes the page's first assigned channel and injects
  `<style>{brandTokensToCss(tokens)}</style>` into the iframe document. It does this through
  Puck's `overrides.iframe`, which receives the iframe document.
- The brand screen previews a sample section in each colour scheme with the same function.

**Rationale**:

- FR-038 requires the preview to match the storefront.
- The descriptor already carries the palette and the breakpoints.

**Alternatives rejected**:

- **Loading the storefront theme CSS into the admin.** It is a different app's bundle and has no
  channel context.

---

## R-5. Fonts: system stack, asset-library files, or an external stylesheet

**Decision**: a font role (heading, body) is one of three kinds:

- `{kind: 'system', stack}`, a curated list;
- `{kind: 'asset', family, faces: [{weight, style, fileAssetId}]}`, where `woff2` is preferred;
- `{kind: 'stylesheet', family, url}`, where the URL is `https:` only. A font service such as
  Google Fonts or Adobe Fonts fits here.

Every emitted `font-family` ends in the generic fallback of the chosen kind (`sans-serif` or
`serif`). Asset fonts get `font-display: swap`.

**Rationale**:

- FR-006c names "uploaded to the asset library or a font service".
- `stylesheet` covers every service with no integration per vendor.

**Risk**: a cross-origin `@font-face` needs `Access-Control-Allow-Origin`. The asset route gets it
from the global CORS allow-list, which must include the storefront origin. That is already
required for the storefront's other API calls; the quickstart verifies it. Cloud storage backends
that redirect to bucket URLs need bucket CORS, which the operations docs note.

---

## R-6. Colour schemes are CSS variable sets switched by `data-scheme`

**Decision**:

- **Scheme tokens.** The tokens carry three schemes (`light`, `muted`, `dark`). Each has
  `background`, `text`, `textMuted`, `border` and `link`.
- **Section markup.** A section block with a scheme renders `data-cmsb-scheme="dark"`, which
  rebinds `--cmsb-fg`, `--cmsb-bg`, `--cmsb-fg-muted`, `--cmsb-border` and `--cmsb-link`.
  Everything inside reads those variables.
- **Button colours.** Button styles resolve their colours from the palette roles (`primary`,
  `secondary`, `light`, `dark`) in solid or outline form.
- **Colour fields.** The colour field gains token references: the value `token:primary` renders
  `var(--cmsb-color-primary)`. Hex values stay valid as per-block overrides.

**Rationale**:

- FR-002 asks for one switch that recolours every block in a section.
- Nested sections inherit through the cascade, so no React plumbing is needed.

**Alternatives rejected**:

- **Per-block colour props defaulting to scheme colours in JavaScript.** It duplicates the
  cascade, and SSR and hydration have to agree on it.

---

## R-7. Contrast warning is a pure function in `contracts`

**Decision**:

- `assessBrandContrast(tokens)` in `packages/contracts/src/cms-brand.ts` returns every
  foreground/background pair below 4.5:1, or below 3:1 for large display sizes. The pairs are:
  - each scheme's text, text-muted and link against its background;
  - each button's solid style, label against fill.
- The admin shows the result as a warning, and the save stays allowed (FR-006b).
- The write route returns the same list in its response.

**Rationale**:

- The admin and the server must agree.
- The computation is the WCAG relative-luminance formula and needs no dependency.

---

## R-8. Section settings are one `section` prop on section blocks; top level is a React context

**Decision**:

- **The prop.** A shared field group `createSectionSettingsField()` in
  `page-builder-core/src/fields/` stores one prop:

  ```ts
  section: {
    anchor?: string,
    scheme?: 'inherit'|'light'|'muted'|'dark',
    background?: SectionBackground,
    spaceTop?: Responsive<SpaceToken>, spaceBottom?: Responsive<SpaceToken>,
    width?: 'contained'|'wide'|'full',
    reveal?: RevealSetting,
  }
  ```

- **Detecting the top level.** `withHideOn` gains a `BlockDepthContext`.
  - It reads the depth and renders the block inside a provider with depth + 1.
  - The block body becomes a child component, so its hooks run under the provider.
  - `useSectionContext()` returns `{topLevel: depth === 0}`.
  - A section block applies `section` only when `topLevel` is true. Otherwise the settings are
    ignored at render time (FR-000).
- **Embedded content.** Embedded blocks and templates (`InsertBlock`, `InsertTemplate`) inherit
  the React context, so an embed placed at the top level of a page is a section.
- **Editor.** The `section` field is hidden through `resolveFields(…, {parent})` when
  `parent !== null`.
- **Anchors.**
  - Anchors are normalised to `^[a-z][a-z0-9-]{0,63}$` (FR edge case). The admin shows the
    normalised value as you type.
  - Duplicates within a page are refused at save by `CmsPageService.setContent`, with the minted
    code `CMS_DUPLICATE_ANCHOR`. The refusal names the anchor.
  - The rich-text heading anchors of R-14 are part of the same uniqueness set.
  - Reserved fragments are refused too: `main-content`, plus any id the storefront layout renders.
- **Spacing.** Spacing is padding inside the section, never margin. Adjacent sections therefore
  touch, and two dark sections read as one dark area (FR-005, acceptance 3).

**Rationale**:

- The owner ruling (Clarification Q2).
- The context needs no Puck internals and no stored "is top level" flag: the storefront never
  runs `resolveData`, so a stored flag would go stale when an editor moves a block.

**Alternatives rejected**:

- **Puck's internal `DropZoneProvider` depth.** It is not public API, and `SlotRender` does not
  increment it.
- **Persisting `isTopLevel` from `resolveData`.** It goes stale and is never recomputed on the
  storefront.

### R-8a. A decorative dark backdrop is per section; one continuous backdrop is not built

**Decision**:

- The tokens may carry a decorative backdrop for the dark scheme: an image or SVG asset plus a
  blend mode.
- A dark section with `background.decorative = true` paints it with `background-size: cover`,
  anchored top centre.
- A backdrop that runs continuously across a group of adjacent dark sections, as the spec's
  FR-005 second sentence asks, is **not** built.

**Rationale**:

- Puck renders the root content list itself. A block cannot span its siblings, and wrapping a
  group needs a root-level renderer that regroups children. That renderer would break
  drag-and-drop identity in the editor.
- Soft radial backdrops tolerate the per-section seam.
- SC-002 counts decorative detail as an accepted deviation.
- Owner ruling Q2 (2026-10-22) accepted this, and FR-005 is amended to "per dark section".

**Alternative rejected**: a root render that groups consecutive dark sections into one wrapper,
for the reason above.

---

## R-9. Section background with art direction and overlay

**Decision**:

- `SectionBackground` extends `BackgroundValue` (`page-builder-core/src/types/background.ts`)
  with:
  - `mobileImageAssetId` / `mobileImageUrl`;
  - `videoPosterAssetId`;
  - `mobileVideoAssetId`;
  - `overlay: {kind: 'none'|'solid'|'gradient', direction: 'to-top'|'to-bottom'|'to-left'|'to-right', strength: 0–100}`;
  - `position` (focal keyword);
  - `decorative?: boolean`.
- **Images** render as a positioned `<picture>` with `<source media="(max-width: 767.98px)">`
  rather than a CSS background. That gives `loading`, `fetchpriority` and decoding control.
- **Videos** render as two `<video muted playsinline loop preload="none" poster>` elements. CSS
  hides the one for the other breakpoint.
  - A small effect starts only the visible one, when `matchMedia` and `IntersectionObserver`
    agree.
  - It never starts it under `prefers-reduced-motion` (FR-012).
- **Field names** end in `AssetId`, so the asset map picks them up (R-0).

**Rationale**:

- Art direction (FR-010) and video per breakpoint (FR-012).
- `<source media>` inside `<video>` is not reliable across browsers.

**Alternative rejected**: CSS `image-set()` / `@media` backgrounds. They give no lazy loading or
priority control and need a per-block `<style>`.

---

## R-10. Typography: semantic level and visual size are separate props; inline rich text

**Decision**:

- **Heading props.** `cms.Heading` gets `level: 'h1'…'h6'|'p'` and `size: TypeToken`. The tokens
  are `display`, `h1`–`h6`, `lead`, `body` and `small`.
- **Type scale.** Each token has a `{mobile, desktop}` size, line-height, weight and tracking.
  Desktop applies at ≥ 1024 px (the existing desktop tier).
- **Heading text.** The `text` prop becomes an **inline rich-text document** (TipTap, single
  block). Its marks are bold, italic, link, line break, and a new mark `emphasis` with
  `variant: 'gradient'|'accent'|'muted'`, which renders `<span class="cmsc-em cmsc-em--gradient">`.
- **Shared factory.** The same field factory, `createInlineRichTextField`, serves every short
  rich heading in the new and reshaped blocks: hero title, subheading and statement, statement
  headings, card titles.
- **Translation.** Translatable paths declare `format: 'tiptap'`.

**Rationale**:

- FR-007 and FR-008.
- The translation codec already preserves marks.
- A mark is what editors expect ("select a phrase, click highlight"). Markup conventions such as
  `*phrase*` are not.

**Alternatives rejected**:

- **A separate `highlight` text field.** It cannot express a highlight in the middle of a
  heading.
- **Markdown-like markers.** They are invisible rules for editors and translators.

---

## R-11. Buttons and links: one `ButtonSpec` and one `LinkValue` for every block

**Decision**:

- `contracts` defines `LinkValue`:

  ```ts
  { kind: 'url'|'page'|'product'|'category'|'asset'|'anchor',
    href?, slug?, fileAssetId?, anchor?, target? }
  ```

- **Field factory.** The link field `createLinkField` in `page-builder-admin` generalises
  `ButtonLinkFields.tsx` and reuses the existing page, product and category pickers plus the
  asset picker.
- **Href resolution.** `resolveLinkHref(link, env)` is a pure helper in `cms-components`.
  - `page` → `/<slug>`, `product` → `/p/<slug>`, `category` → `/c/<slug>`.
  - `asset` → the asset URL from the render-time map, then the fallback `/assets/file/<id>`.
  - `anchor` → `#<anchor>`.
- **`ButtonSpec`.**

  ```ts
  { label, link: LinkValue,
    style: 'primary'|'secondary'|'light'|'dark', fill: 'solid'|'outline',
    size: 'small'|'medium'|'large',
    icon?: IconName, iconPosition?: 'start'|'end'|'only' }
  ```

  `iconPosition: 'only'` is the round icon-only button. Its `label` becomes the accessible name.
- **Where it is used.**
  - `cms.Button` adopts it.
  - Hero, MediaText, CtaCard, BackgroundPanel and Statement take `buttons: ButtonSpec[]`.

**Rationale**:

- FR-009 and FR-011.
- One shape gives one renderer, one translation path (`buttons[].label`) and one picker.

---

## R-12. Carousel: keep the native scroll-snap shell; one block with item blocks in a slot

**Decision**:

- **One block.** `cms.ContentSlider` keeps its name and is relabelled "Carousel". `cms.ImageSlider`
  is removed (FR-041a).
- **Items.** The slot `slides` allows these item blocks, all in the hidden category:
  - `cms.Slide`: free content, the existing block.
  - `cms.CarouselImage`: a wide image or gallery photo with a mobile image, an aspect ratio per
    breakpoint and an optional caption and link.
  - `cms.CarouselSplit`: media and an icon, title, rich text and buttons.
  - `cms.LinkTile`: an image, a title, a link label and a link.
  - `cms.DownloadTile`: a title, a subtitle, `fileAssetId`, and an optional hover image.
- **Breakpoint behaviour** moves to CSS, so the server renders the correct count with no layout
  shift.
  - `slidesPerView` and `gap` become `--pb-spv`, `-md` and `-lg` custom properties.
  - The slide width is `calc((100% - (spv - 1) * gap) / spv)`.
  - Fractional values give the peek.
  - JavaScript only drives the arrows, the dots and autoplay.
- **New options.**
  - `effect: 'slide'|'fade'`. Fade stacks the slides in one grid cell with `opacity`
    transitions, and the active index comes from the controls.
  - `controls: 'header'|'below'|'overlay'`.
  - `bleed: 'none'|'end'|'both'`.
  - Controls are hidden automatically when `scrollWidth <= clientWidth`.
  - Autoplay is off by default and paused on hover, focus and reduced motion.
- **Accessibility.** The arrows are `<button>` elements with accessible names. The track is
  `role="region"` with `aria-roledescription="carousel"`, and each slide is
  `aria-roledescription="slide"` with "n of m".

**Rationale**:

- FR-019 to FR-022.
- No new dependency (Principle IV). The shell already works with slots and in the editor.
- The CSS move fixes today's shift from the mobile count to the desktop count on hydration, which
  bears on SC-005a.

**Alternatives rejected**:

- **Swiper or Embla.** A new runtime dependency of 30–40 kB that buys nothing scroll-snap plus
  about 100 lines cannot do.
- **Keeping ImageSlider's array items.** Arrays cannot hold rich text and buttons, and an array
  beside a slot means two ways to make one carousel.

**Rename cost**: none. The kept name avoids touching `puck-action-guards.ts`, the action bar,
`row-layout-presets.ts` and the CSS selectors. Removing `cms.ImageSlider` touches the files
listed in plan § *Blast radius*.

---

## R-13. Tabs and Accordion panels become slots inside array items

**Decision**:

- `items[]` keeps `label` / `title` and replaces the HTML `content` with
  `content: {type: 'slot', disallow: ['cms.Column', 'cms.Tabs', 'cms.Accordion']}`.
- **Tabs.**
  - Adds `variant: 'pills'` and `effect: 'none'|'fade'`.
  - Ids come from `useId()`, which fixes the collision.
  - The full WAI-ARIA tabs keyboard model: arrows, Home and End.
  - Every panel is server-rendered. Inactive panels carry `hidden`, so their content is in the
    HTML.
- **Accordion** panels are server-rendered with `hidden` until expanded.
- **Translation.** Only `items[].label` / `items[].title` remain translatable paths. Panel content
  is translated through the child blocks (R-0).

**Rationale**: FR-023 and FR-024. Puck 0.23 supports slots in array items, and the walker already
recurses into them.

**Alternative rejected**: `<details>` for the accordion. It cannot enforce single-open mode, and
its search-in-page behaviour differs per browser.

---

## R-14. Rich text extensions and sanitizer additions

**Decision**: these TipTap extensions are added in `rich-content-shared.ts`, and the
rich-content policy in `utils/sanitize-html.ts` is extended with exactly these additions:

| Capability | Editor (extension) | Output | Policy change |
| --- | --- | --- | --- |
| Highlight phrase | mark `emphasis` (R-10) | `<span class="cmsc-em cmsc-em--…">` | none (`class` allowed) |
| Read more | node `readMore` (block content) | `<details class="cmsc-read-more"><summary>…</summary>…</details>` | allow `details` (`open`) and `summary` |
| Check-mark list | attribute `listStyle` on `bulletList` | `<ul class="cmsc-list--check">` | none |
| Button link | attribute `variant` on `link` | `<a class="cmsc-btn cmsc-btn--primary-solid">` | none |
| Heading anchor | attribute `anchor` on `heading` | `<h2 id="…">` | allow `id` on `h1`–`h6`, value matching the anchor pattern of R-8 |
| Visually hidden heading | attribute `srOnly` on `heading` | `<h2 class="cmsc-sr-only">` | none |

**Rationale**:

- FR-025.
- `<details>` needs no script, and its content stays in the HTML (SC-005).
- Every new value is a class or a pattern-checked `id`, so no new attack surface appears.

**Alternative rejected**: a `div[data-read-more]` toggled by script. It would allow `div`, and
the passage would depend on JavaScript.

---

## R-15. Dynamic blocks follow the catalog precedent

**Decision**:

- **Where the code lives.** `blog.LatestPosts` and `newsletter.Signup` are declared in their
  owning modules' manifests, as `catalog.*` blocks are. Their React code lives in `cms-components`.
- **Server data seam.** It is generalised from catalog-only to a closed union that also accepts
  blog requests.
  - `catalog-block-data.ts` becomes `block-data.ts`, with request kinds `products-by-slugs`,
    `products-list`, `categories` and `blog-posts`.
  - `storefront/components/CatalogBlockData.tsx` becomes `BlockData.tsx`, and its source gains
    `listBlogPosts`.
  - The admin preview provider gains the blog reader.
- **Blog additions.**
  - A migration adds `blog_posts.main_image_asset_id uuid null`. The blog admin editor gains the
    field. `toPostCard` starts returning real images.
  - `GET /api/v1/blog/posts?limit=&categorySlug=` is a channel-scoped, language-resolved card
    list, `limit` ≤ 24.
- **Off state.** It is inherited: the storefront presence filter drops `blog.*` blocks while
  `blog` is off. The block-data resolver skips a request whose owner is absent, and the editor
  shows the existing "module off" note.

**Rationale**:

- The SSR content requirement (FR-022, Principle VII) rules out spec 141's client-fetch path.
- The catalog precedent is in production and tested.
- One more request kind in a closed union is smaller than designing a module-owned server-data
  hook.

**Alternative rejected**: a module-owned server-data extension point, in which a module's
`./storefront` export declares an async resolver. It is the right long-term shape, but it is a
platform contract change with its own spec, because it changes how `PageBuilderRender`'s RSC
boundary works. It is noted as a follow-up in the plan.

---

## R-16. Product card gains an optional summary line

**Decision**:

- `CmsProductSummary` gains `summary: string | null`. The public product list and product reads
  fill it from the product's existing description: plain text, truncated at a word boundary to
  160 characters, in the request language.
- The card gains `variant: 'showcase'`: image on a neutral backdrop, name, summary, and a "more"
  link with a label.
- ProductGrid and ProductSlider expose `cardVariant`, `ctaLabel` and an optional header
  (heading, lead, "see all" `ButtonSpec`).

**Rationale**: FR-027 asks for a short description, and products have no dedicated field.
Deriving one avoids a catalog schema change.

**Owner ruling Q3** (2026-10-22) accepted the derivation and the fallback.

**Risk**: where the description lives (a column or an attribute value) and whether the list read
can include it without an extra query is checked in Phase 1's drift check. If it costs a query
per product, the fallback is an editor-entered subtitle per manually picked product, and
`summary` stays null for dynamic sources.

---

## R-17. Newsletter signup posts to a storefront route handler

**Decision**:

- `newsletter.Signup` is the module-backed sign-up. Whether it replaces `cms.NewsletterSignup` is
  open. The old block's free `actionUrl` (an external form endpoint) cannot move into a block that
  disappears while `newsletter` is off, and the plan's § *Extend, don't narrow* forbids losing
  it silently. This is decided with the owner in T076. Its fields are:
  - `heading` and `text`;
  - `placeholder` and `buttonLabel`;
  - `topics: [{label, tagCode}]`, optional, rendered as a checkbox group;
  - `consentLabel`, inline rich text with a link;
  - `layout: 'inline'|'boxed'`.
- **Submission.** The form posts to `/newsletter/subscribe`, a new storefront route handler
  (`storefront/app/newsletter/subscribe/route.ts`). The handler:
  - checks that `consent=on` and that the e-mail is well formed;
  - calls the existing `subscribeNewsletter({email, channelCode, tags, source: 'cms-block'})`;
  - redirects back with `?newsletter=pending|active|error#<anchor>`.

  With JavaScript, the block submits with `fetch` and shows the message inline. Without it, the
  redirect shows the same message.
- **Consent record.** It is the existing `consentAt` plus the audit entry. The source
  `cms-block` tells this sign-up apart from the others.
- **No backend change** in `newsletter`.

**Rationale**:

- FR-029.
- `cms-components` cannot import `next/*` (spec 141 R2.3). A plain form keeps the page working
  without JavaScript.
- The newsletter module already records the consent.

**Alternative rejected**: posting from the browser straight to the backend API. That needs the
channel code on the client and CORS on a write route.

---

## R-18. Page parent, breadcrumbs and sharing image

**Decision**:

- **Migration in `cms`.** It adds to `cms_pages`:
  - `parent_page_id uuid null references cms_pages(id) on delete set null`;
  - `breadcrumbs_visible boolean not null default true`;
  - `breadcrumbs_scheme text not null default 'light'`, with a check constraint for
    `light`/`muted`/`dark`;
  - `share_image_asset_id uuid null`.
- **Writes.** The `cms_page.update` Command refuses three cases with `CMS_PAGE_PARENT_CYCLE`:
  - a parent equal to the page;
  - a parent whose ancestor chain contains the page;
  - a chain deeper than 8 levels.
- **Storefront resolution.**
  - `cmsResolvedPageSchema` gains:

    ```ts
    breadcrumbs: { visible, scheme, trail: [{ name, slug: string | null }] }
    share: { imageUrl: string | null }
    ```

  - The trail is resolved for the request's channel from `cms_page_sales_channels`, which `cms`
    owns.
  - A parent that is not published in that channel gives `slug: null`, which renders as text
    (FR-030a).
  - The sharing image falls back to the new setting `cms.default_share_image_asset_id`.
- **Storefront rendering.** `[...slug]/page.tsx` renders the trail and the scheme, and hides the
  breadcrumbs when `visible` is false. `generateMetadata` gains `openGraph` (title, description,
  image, locale) and `twitter.card`.
- **JSON-LD.** Breadcrumb items become absolute URLs (`siteUrl()`), which fixes today's relative
  `item`.

**Rationale**:

- The owner ruling (Clarification Q3).
- Delete-set-null implements "deleting a parent clears the field" (FR-030a) in the database.

---

## R-19. Language alternates: the storefront has no per-language URLs

**Decision**:

- FR-034 ("announce each language alternate") cannot be met as `hreflang` links, because one
  storefront URL serves every language (R-0).
- The plan emits `og:locale` for the served language and `og:locale:alternate` for the page's
  other languages. `<html lang>` is already correct.
- `hreflang` is deferred until language-prefixed URLs exist. Owner ruling Q1 (2026-10-22)
  accepted this, and FR-034 is amended.

**Alternative rejected**: `hreflang` alternates that all point at the same URL. Search engines
treat that as an error.

---

## R-20. Organization structured data on every CMS page, from settings

**Decision**:

- The settings module's `ShopInfoSchema` gains `logoUrl` (from a new setting
  `shop.logo_asset_id`) and `socialProfiles: string[]` (from a new setting
  `shop.social_profiles`, of type `string_list` and validated as `https:` URLs).
- `OrganizationJsonLd` emits `logo` and `sameAs`, and renders on the home page and on every CMS
  page.

**Rationale**:

- FR-035.
- The Organization component and its data source already exist. Extending them is the smallest
  change.

---

## R-21. Motion is CSS-first, opt-in and safe without JavaScript

**Decision**:

- **Settings.** `section.reveal` and the block-level `reveal` are
  `{effect: 'none'|'fade-up'|'words', desktopOnly: boolean}`.
- **Words.** At render time, `words` splits the target text into
  `<span class="cmsc-w" style="--i:n">` with whitespace preserved. The server output therefore
  contains the full text.
- **Pending state.** One tiny client hook (`useReveal`) adds `data-cmsc-reveal="pending"` on
  mount. It does nothing when `matchMedia('(prefers-reduced-motion: reduce)')` matches, or when
  the viewport is below 1024 px and `desktopOnly` is set. It flips to `"done"` through
  `IntersectionObserver`, once.
- **CSS.** The hidden pre-state applies only under `[data-cmsc-reveal="pending"]`. Without
  JavaScript, content is visible (FR-037).
- **Hover zoom.** `hoverZoom: boolean` on image-bearing blocks is a CSS transform, disabled under
  reduced motion.

**Alternative rejected**: GSAP-class animation libraries. They add a runtime dependency for
effects CSS covers.

---

## R-22. Section presets are code-side, inserted from the editor

**Decision**:

- `cms-components/src/editor/section-presets.ts` exports six presets (FR-042), each a function
  `(t) => ComponentData` that builds a block tree with placeholder copy in the editor's language.
  The six are hero, media and text, call-to-action card, downloads, feature grid and statement.
- The copy comes from `cms` i18n keys `presets.*`.
- A "Section presets" panel in the editor's block drawer inserts the tree at the drop position,
  using Puck's `insert` action. This follows `ROW_LAYOUT_PRESETS`.

**Rationale**:

- Nothing seeds templates, and "apply template" replaces the canvas (R-0).
- Code-side presets are versioned with the blocks they build, so they cannot rot as database
  rows can.
- The `check-block-names` scan covers their tree literals.

**Alternative rejected**: presets seeded as CMS templates. That needs a new seed port, and
"apply template" would replace the page instead of inserting a section.

**Amended (issue #1684, 2026-11-22).** Placeholder copy a preset inserts is operator content
seeded into the document, not admin chrome. The storefront prints it as stored. It therefore
follows the *edited content language*, not the admin language. Each preset reads that language
through `PageBuilderContentLocaleProvider` (page-builder-core, PR #1790) and takes its copy from a
per-language table beside `section-presets.ts`, falling back to `en` for a language with no row.
Preset functions take the resolved content strings in place of `t`. The `cms` bundle's
`presets.*` keys keep only the drawer's own chrome (preset names, descriptions, status).
**Alternative rejected**: an admin-kit hook that loads a second shipped bundle and translates in
it. That is new kit API and a second request per editor, it limits content languages to the admin
bundles that ship, and it handles content as if it were admin chrome.

---

## R-23. Performance budget is met without image resizing

**Decision**: the following measures meet SC-005a:

- **Images.**
  - `<picture>` with art direction (R-9).
  - `loading="lazy"` and `decoding="async"` on every image except a top-level hero's media, which
    gets `fetchpriority="high"` and `loading="eager"`.
  - `width`/`height` or `aspect-ratio` custom properties on every media frame, so no layout shift
    occurs.
- **Videos.** `preload="none"` plus a poster.
- **Breakpoint layout in CSS.** Carousel slides per view and section widths are CSS, not
  JavaScript (R-12).
- **Fonts.** The preloaded body font (R-3) and `font-display: swap`.
- **No new runtime dependency** in the storefront bundle.

The quickstart measures a rebuilt landing page with Lighthouse on the "Moto G Power / Slow 4G"
profile.

**INP** (SC-005a, Principle VII: below 200 ms). The whole page-builder tree hydrates (R-0), so:

- interactive behaviour (carousel controls, tabs, reveal, sign-up) attaches in effects;
- no block does work on hydration beyond reading its props;
- the Gate measures INP with a scripted interaction run.

If INP fails, islands for static blocks are decided before merge, not deferred.

---

## R-24. Field labels become translatable through manifest keys

**Decision**:

- `page-builder-i18n.ts` (cms admin) already resolves block labels from `labelKey`. It is
  extended to resolve field labels from the keys `blocks.<block>.fields.<field>.label`, and
  option labels from `…options.<value>`.
- The English label in the component config stays the fallback.
- New and reshaped blocks ship keys in `en` and `pl` (FR-039). Unchanged blocks keep English
  until touched.

**Rationale**: it is the existing mechanism, extended rather than duplicated (Principle IX).

---

## R-25. Demo seed and fixtures

**Decision**:

- **The two consent seeders** write `cms.Text` with an `html` prop. `cms.Text` is not reshaped,
  so they stay unchanged.
- **The conformance fixture** (`backend/scripts/conformance/seed-storefront-fixtures.ts`) writes
  `cms.Heading` with `text`. It is rewritten to the new inline-document shape in the phase that
  reshapes `cms.Heading`.
- **No demo seeder writes CMS pages.** The plan does not add one.
- **Gate.** The final phase runs `pnpm run setup` on a scratch database plus the demo seed, and
  loads every seeded CMS block and page through the storefront. The local working pages used to
  compare against the reference stay outside the tree (spec Assumptions).

**Rationale**: FR-041.
