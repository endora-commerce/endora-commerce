---
title: Brand settings
sidebar_label: Brand
sidebar_position: 2
description: One set of colours, colour schemes, fonts, type scale, buttons and spacing that every Page Builder block uses, set globally and optionally per sales channel
---

# Brand settings

The **Brand** screen holds the design decisions every Page Builder block
follows on the storefront: the colour palette, the three colour schemes, the
heading and body fonts, the type scale, the button shape and the spacing and
layout widths. Change the primary colour or the body font here once, and every
page built with the Page Builder follows — no page is edited and nothing is
rebuilt or redeployed.

Until somebody saves the screen, the built-in values apply, and they reproduce
the look the blocks had before the screen existed.

## Opening the screen

- **Navigation**: **Brand** (`/cms/brand`), next to the other CMS screens.
- **Command palette**: ⌘K / CTRL+K → "Brand settings" (also found by *brand*,
  *fonts*, *colours*, *colors*, *typography* or *theme*).
- **Permissions**: any role with **View CMS content** (`cms.read`) can open and
  read the screen. Saving needs **Edit brand settings** (`cms.brand`), which
  itself requires `cms.read`. Without it the fields are read-only and there is
  no Save button.

## What you can set

| Section | Settings |
| --- | --- |
| Colours | Primary and secondary colours with their hover colours, the text colour on each, a neutral scale from 50 to 900, and the **accent gradient** (start, end and angle) used by gradient highlights in headings. |
| Colour schemes | Light, muted and dark. Each has a background, text, muted text, border and link colour. The dark scheme can also have a **decorative backdrop**, an image a dark section may paint behind its content. A section chooses its scheme in the Page Builder, and every block inside it takes the scheme's colours. |
| Typography | The heading font and the body font (see [Fonts](#fonts)), and the type scale: Display, Heading 1–6, Lead, Body and Small, each with a mobile and a desktop size, line height, weight, letter spacing and whether it uses the heading or the body font. Heading 1–6 also apply to the headings written inside rich text (a Rich content block, a block's rich body). |
| Buttons | Corner shape (square, rounded or pill), the heights of small, medium and large buttons, the label weight and the label case. |
| Spacing | The named steps a section's top and bottom spacing is chosen from — none, extra small, small, medium, large, extra large, largest — each with a mobile and a desktop size. |
| Layout | The content width, the wide content width, and the side margin on mobile and on desktop. The content width is the page container — 1360 px, side margins included, until changed; set it wider for a wider frame on every CMS page: Contained sections, content held in the page container, and the page's breadcrumb trail all follow it. Two optional factors scale the type and the spacing steps between breakpoints: **Type and spacing scale on a tablet (768–1023 px)** multiplies the mobile sizes there (for example 1.15 for 15 % larger), and **Type and spacing scale on a small desktop (1024–1279 px)** the desktop sizes. Empty is 1: nothing changes. Sizes a block sets in pixels of its own (a **Custom (px)** size or space) are not scaled. Two further optional settings, off by default: **Grow the desktop sizes with the window after the small desktop** makes the sizes grow with the window width from the small-desktop factor at 1280 px to the full desktop sizes at **Full desktop sizes from (px, default the page container width)**; **Scale button heights with the type and spacing** applies the factors to the button heights too (an icon-only button follows, as it is sized from them). |

A **Preview** shows a sample in each of the three schemes with the values on
screen, before you save.

Blocks still accept a value of their own where it matters: a colour field can
hold a brand colour (stored as a reference such as `token:primary`, which
follows later brand changes) or any hex colour, and a heading can override its
size, font, weight or line height in its **Advanced** group.

## Global settings and channel overrides

The **Scope** card chooses what you edit:

- **All channels (global settings)** — the settings every sales channel uses
  unless it has an override.
- **A sales channel** — that channel's own brand. A channel without one shows
  **Inherits global**. **Override for this channel** starts the override as a
  **complete copy** of the global settings; nothing is applied until you save.

An override is a full copy, not a list of differences. **A later change to the
global settings does not reach a channel that has an override**; the screen
says so on every overridden channel. **Reset to global** (after a
confirmation) deletes the override, and the channel follows the global
settings again.

The storefront uses the effective set of the request's sales channel: the
channel's override, else the global settings, else the built-in values. The
Page Builder preview uses the effective set of the page's first assigned sales
channel, so an editor sees the channel's brand on the canvas.

## Contrast warnings

The screen warns, in a **Low contrast** notice, when a colour pair falls below
the WCAG 2.2 AA contrast ratio:

- each scheme's text, muted text and link against its background — 4.5:1;
- the text on primary and on secondary against the button fill and its hover
  fill — 4.5:1;
- each accent-gradient colour against each scheme's background — 3:1, the
  large-text threshold, because gradient highlights are used in large
  headings.

A warning never blocks saving: the brand owner decides. The save response
returns the same list.

## The decorative backdrop

The dark scheme's **Decorative backdrop** is any image from the Assets
Library, an SVG included. A Section with the dark scheme and **Decorative
backdrop** switched on paints it behind its content, covering the section from
its top centre.

How the backdrop is drawn is set on the section (or the section group) beside
the **Decorative backdrop** switch, not on this screen: **Backdrop size**
(Cover, the default; Contain; Natural size; or a width in px or %),
**Backdrop repeat** (none, the default; tile; across; down) and **Backdrop
position** (top, the default; centre, bottom, left or right). A tall group
covered by one image scales it to the group's height, which makes its details
large and soft; a width in px with **Repeat down** keeps the backdrop at its
own scale down the whole column, and keeps that size on every screen width.

The backdrop can also be given by address, in **Decorative backdrop URL**: an
`https://` address, or a path on your own site starting with `/` (for example
`/media/backdrop.svg`, which is loaded from the shop's API address, as a
library file is). The screen refuses any other address when you save. When
both are set, the file from the library is used.

- **Per section, or once for a group.** Each section paints its own copy, so
  two dark sections next to each other each show the backdrop from their own
  top, with an edge between them. To run one backdrop behind several sections,
  put them in a **Section group** with the dark scheme and **Decorative
  backdrop** switched on: the group paints it once, from its top, behind all its
  sections (see the CMS module page, "Section groups").
- **Animated SVG.** An SVG can carry its own CSS animation (soft moving lights,
  for example). The browser draws it as an image: it runs no script and loads
  nothing from outside the file, so keep everything — shapes, gradients and the
  `<style>` — inside the SVG.
- **Reduced motion.** The page cannot stop an animation inside an image, so the
  SVG has to: put the animation inside
  `@media (prefers-reduced-motion: no-preference)`, and a visitor who asks for
  reduced motion sees the static drawing — **where the browser evaluates that
  media query inside an SVG drawn as an image**. Support for it differs between
  browsers and versions, and a browser that does not evaluate it plays the
  animation, so check the asset in the browsers your shop supports and keep the
  motion slow and subtle. Animate with CSS, not with SMIL (`<animate>`), which
  the media query cannot stop.

An example that drifts a soft light slowly and stays still under reduced motion:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
  <style>
    .glow { transform-origin: 800px 450px; }
    @media (prefers-reduced-motion: no-preference) {
      .glow { animation: drift 24s ease-in-out infinite alternate; }
    }
    @keyframes drift { to { transform: translateX(120px) scale(1.15); } }
  </style>
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="50%">
      <stop offset="0" stop-color="#1d4ed8" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#1d4ed8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect class="glow" x="0" y="0" width="1600" height="900" fill="url(#g)"/>
</svg>
```

## Fonts

The heading font and the body font are each one of three kinds:

| Kind | What you enter | How it loads |
| --- | --- | --- |
| **System font** | A stack: sans-serif, serif or monospace. | Nothing is downloaded. |
| **Font files from the asset library** | A family name (for example `Acme Sans`), a fallback (sans-serif or serif) and up to eight font files, each with a weight (100–900) and a style (normal or italic). The picker lists Assets Library files whose type is `font/*`; prefer `woff2`. | The storefront writes one `@font-face` rule per file with `font-display: swap`, and preloads the regular upright face of the body font. |
| **Font service stylesheet** | A family name, a fallback, and the `https://` address of the service's stylesheet, for example `https://fonts.example.com/css?family=Acme+Sans`. | The storefront links the stylesheet in the page head. |

The fallback generic family always ends the font stack, so text renders while
the font loads or if it fails. A family name may hold letters, digits, spaces
and `-`, `_`, `.`; a stylesheet address must be `https:`. Font licensing is the
deployment's responsibility.

### Cross-origin font loading

Browsers load a font from another origin only when that origin allows it with
CORS. Asset-library fonts are served by the API (`/assets/file/<id>` on the
public API address), which is usually a different origin from the storefront:

- **`CORS_ALLOWED_ORIGINS`** in the API's environment must include the
  storefront's origin (for example `https://shop.example.com`). The
  storefront's other browser calls already need it there. The Brand screen's
  preview and the Page Builder canvas load the same files from the admin, so
  an admin served from another origin than the API needs its origin in the
  list too — which its own API calls already require.
- **Cloud storage**: when the Assets Library's storage backend answers with a
  redirect to a bucket URL, the bucket itself must send CORS headers that allow
  the storefront and admin origins. Configure that on the bucket.
- **Font services** send their own CORS headers; nothing is needed on your
  side.

A font blocked by CORS does not break the page: the fallback family is used.

## Saving, auditing and caching

- **Concurrent edits**: each scope has a version. If someone else saved the
  same scope since you loaded it, the save is refused, the latest version is
  loaded, and your changes are not applied.
- **Validation**: a value out of range is refused and the fields are named.
- **Audit**: each save is one Command, `cms.brand_tokens.update`, with exactly
  one audit entry on the object `cms_brand_tokens` (id `global` or the sales
  channel's id) carrying the settings before and after.
- **Storefront**: after the save commits, the storefront cache tag
  `cms:brand` is revalidated, so the next request uses the new settings. If
  revalidation is not configured or fails, the storefront picks the change up
  within five minutes. The manual cache flush in Settings revalidates the same
  tag (namespace `cms-brand`).

## For engineers

### Where the settings live

- **Table** `cms_brand_tokens`, owned by the `cms` module: one row per scope,
  `sales_channel_id` null for the global row (unique, nulls not distinct),
  `tokens` (JSONB, a complete set), `version`, `updated_at`. Reset deletes the
  scope's row.
- **Schema** `cmsBrandTokensSchema`, the built-in set `DEFAULT_BRAND_TOKENS`
  and the contrast check `assessBrandContrast` in
  `packages/contracts/src/cms-brand.ts`. The dark scheme's backdrop is
  `schemes.dark.decorativeAssetId` (a library asset) or
  `schemes.dark.decorativeUrl` (`brandMediaUrlSchema`: `https:` or a path
  starting with `/`, at most 2048 characters, with no quotes, parentheses,
  backslashes, angle brackets or whitespace); the asset wins when both are set.
  How a section or a group draws it is that block's: `decorativeSize`,
  `decorativeRepeat` and `decorativePosition` of its `background` value
  (`sectionBackgroundSchema` in `packages/contracts/src/page-builder-props.ts`),
  written inline as `background-size`, `background-repeat` and
  `background-position` over the stylesheet's `cover`, `no-repeat` and
  `top center`.
- **Service** `src/backend/services/brand-tokens-service.ts` and the screen
  `src/admin/pages/BrandPage.tsx`, both in the `cms` module's package.

### HTTP

| Method and path | Gate | Answers |
| --- | --- | --- |
| `GET /api/v1/admin/cms/brand-tokens[?salesChannelId=]` | `cms.read` | `{global, channel?, effective, warnings}` |
| `PUT /api/v1/admin/cms/brand-tokens` | `cms.brand` | Body `{scope: {kind: 'all'} \| {kind: 'channel', salesChannelId}, tokens \| null, expectedVersion}`; `200 {version, warnings}`, `409 VERSION_CONFLICT`, `400 VALIDATION_FAILED`, `404 UNKNOWN_SALES_CHANNEL`. `tokens: null` removes a channel override, or resets the global set to the built-in values. |
| `GET /api/v1/storefront/cms/brand-tokens` | public | The effective set of the resolved sales channel (the system default channel without a header); `cache-control: public, max-age=60`. |
| `GET /api/v1/admin/cms/page-builder/config?salesChannelId=` | `cms.read` | The descriptor's `brandTokens`, used by the editor preview. |

### Tokens as CSS variables

`brandTokensToCss(tokens, {assetUrl, mediaUrl})` in `@endora-commerce/cms-components`
(`packages/cms-components/src/brand/brand-css.ts`) turns a set into CSS
variables plus the font links. The storefront renders the result server-side
in `<head>` as `<style id="cmsb">` (`storefront/lib/theme/StorefrontDocument.tsx`),
fetched in `getServerContext()` with `revalidate: 300` and the tag `cms:brand`.
The admin injects the same output into the Page Builder iframe and into the
Brand screen's preview. Both pass `mediaUrl`, which rebases a backdrop URL
starting with `/` onto the public API address, as they do a relative video URL.

| Variables | From |
| --- | --- |
| `--cmsb-color-primary`, `-primary-hover`, `-secondary`, `-secondary-hover`, `-on-primary`, `-on-secondary` | Colours |
| `--cmsb-n-50` … `--cmsb-n-900` | Neutral scale |
| `--cmsb-grad` | Accent gradient |
| `--cmsb-fg`, `--cmsb-bg`, `--cmsb-fg-muted`, `--cmsb-border`, `--cmsb-link`, `--cmsb-decorative` | The light scheme on `:root`, rebound by each `[data-cmsb-scheme="light\|muted\|dark"]` rule |
| `--cmsb-font-heading`, `--cmsb-font-body` | Fonts |
| `--cmsb-t-<token>-size`, `-lh`, `-w`, `-ls`, `-font` | Type scale (`display`, `h1`–`h6`, `lead`, `body`, `small`) |
| `--cmsb-btn-radius`, `--cmsb-btn-h-s`, `-h-m`, `-h-l`, `--cmsb-btn-weight`, `--cmsb-btn-transform` | Buttons |
| `--cmsb-space-<step>` | Spacing (`none` … `xxl`) |
| `--cmsb-container`, `--cmsb-wide`, `--cmsb-gutter` | Layout |

Sizes that differ on desktop are rebound inside one
`@media (min-width: 1024px)` block. With a tablet factor other than 1
(`tierScale.tablet`), a `@media (min-width: 768px) and (max-width: 1023.98px)`
block before it rebinds every `--cmsb-t-<token>-size` and `--cmsb-space-<step>`
to the mobile value times the factor; with a small-desktop factor
(`tierScale.smallDesktop`), a `@media (min-width: 1024px) and (max-width:
1279.98px)` block after it does the same from the desktop values. The gutter
and the container are not scaled. Without factors neither block is written,
so the output is byte for byte the same as before. Two further optional
settings extend these blocks (each writes nothing while unset):

- `tierScale.fluidDesktop: true`, with a small-desktop factor below 1, adds a
  block from the small-desktop end to `tierScale.fluidUntilPx` (else
  `layout.containerMaxPx`) where every desktop type size and spacing step is
  `clamp(<value × factor>px, <value × 100 / end>vw, <value>px)` — the factor
  rising with the window width to 1 at the end;
- `tierScale.buttons: true` writes `--cmsb-btn-h-s|m|l` into the tablet,
  small-desktop and fluid blocks too, scaled the same way.

The small-desktop range always ends at 1279.98 px, as every block's
stylesheet assumes, and the gutter and the page container are the same at
every tier between phone and desktop. A block's own **Custom (px)** values are
written as literal px and are not scaled. Keys an earlier draft of this screen
stored (`smallDesktopUntilPx`, `blockPx`, `buttonLabels`, the per-tier
gutters and container, `fluidContainer`, `breadcrumbsPaddingYPx`,
`trackingMobileEm`) are dropped the next time the brand is saved and write
nothing meanwhile. For each heading level `h1`–`h6` whose
type style is set, the output also holds one rule giving that level's headings
inside rich text (`.cmsc-pb-rich-content`, `.cmsc-pb-rich`,
`.cmsc-pb-hero__body`, `.cmsc-pb-feature-list__body`) the level's size, line
height, weight and letter spacing. It is written here rather than in the
stylesheet because, with no brand, a rich body's headings take the host page's
own heading styles, which no fallback literal could restate. The storefront also sets
`--cmsb-header-offset`, the height of its sticky header, which anchored
sections use as their `scroll-margin-top`.

**Every use carries a fallback.** `packages/cms-components/styles/cms-components.css`
reads each variable as `var(--cmsb-…, <built-in literal>)`, and the built-in
literals equal `DEFAULT_BRAND_TOKENS`. A page rendered without
`<style id="cmsb">` — the `cms` module switched off, a failed read, or the
e-mail editor, which shares the stylesheet — therefore looks exactly as it did
before brand settings existed. The fallback-parity test
(`packages/cms-components/src/brand/fallback-parity.test.tsx`) holds that.
A block author writes the same way; see *Brand variables* in the
[Extending the Page Builder](./extending-page-builder.md) guide.

`brandTokensToCss` treats the set as untrusted: a non-hex colour, a family name
outside the allowed alphabet, a non-`https:` stylesheet address or a backdrop
URL the schema would refuse is dropped (the fallback then applies), asset and
backdrop URLs are written as escaped CSS strings, and no `<` can reach the
output.

### When the module is off

While `cms` is switched off, its brand routes do not answer, the storefront
renders without `<style id="cmsb">` and the fallbacks apply. The stored rows
are kept and apply again when the module is switched back on.
