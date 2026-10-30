---
title: CMS
sidebar_position: 1
description: Page Builder authoring surface — Pages, Blocks, Templates, Hooks — per channel + language
---

# CMS

The CMS module is the platform's editorial surface. It owns four entities
authored through a drag-and-drop **Page Builder** and surfaced on the
storefront with full sales-channel and language scoping.

| Entity      | Identifier        | Lifecycle                            | Embedded by                                   |
| ----------- | ----------------- | ------------------------------------ | --------------------------------------------- |
| **Page**    | `slug` (per channel) | `draft → published → archived`       | URL on the storefront                         |
| **Block**   | `code` (per channel) | `active` flag                        | Pages (`InsertBlock`) and Hooks (attachment)  |
| **Template**| `code` (per channel) | always-visible (no flag)             | Blueprints for pages/blocks (**Save as template** / **Apply template**). Legacy `InsertTemplate` embeds still resolve at runtime. |
| **Hook**    | `code` (global)      | `active` flag, system-protected seed | Storefront layouts (`<Hook code="..." />`)    |

## Entities and the reference graph

The entity graph at runtime:

```
       Hook ──── attachment ────┐
                                ▼
                            Block ─── InsertBlock ───┐
                                                     ▼
                            Template (blueprint) ──> Page / Block canvas (Save as / Apply template)
                            Template ── InsertTemplate (legacy) ──> Page (slug-routed)
```

Content templates (`cms_templates`) are reusable Page Builder layouts (Save as template / Apply template). Email and invoice templates stay in their own admin lists and storage. Embedding via `InsertTemplate` is withdrawn from the component drawer; existing trees still render.

Reference protection runs on every delete:

- A **Block** referenced by a Page, a Template, or a Hook attachment cannot be deleted (HTTP `409 CMS_REFERENCED`).
- A **Template** referenced by a Page or a Block cannot be deleted.
- A **Hook** flagged `is_system=true` cannot be deleted (`409 CMS_HOOK_SYSTEM_PROTECTED`); admin-created Hooks are deletable.

Every reference scan is a JSONB walk over the entity's `content` envelope (`page→block`, `page→template`, `block→template`, `template→block`) plus a foreign-key check on `cms_hook_block_attachments` for `hook→block`.

The same `content` JSONB is scanned by the **Assets Library reference registry** — deleting an Asset embedded in a CMS component's `props` is similarly refused.

## Page Builder authoring

The Page Builder is built on **Puck** (`@puckeditor/core`). Its blocks are
declared in the manifests of the modules that own them and are drawn by
`@endora-commerce/cms-components`, both in the admin canvas and on the
storefront, so the preview and the published page match. Colours, fonts,
the type scale, buttons and spacing come from the brand settings, edited once
on the [Brand](./brand.md) screen.

### Blocks

A page is built as a stack of **Sections**: `cms.Section` is the one block
that carries the [section settings](#section-settings) described below, and
it holds any other blocks. Feature 163 (page builder for marketing pages)
added, reshaped and removed blocks; the last column says what changed.

| Block | Palette label | What it is, and what changed |
| --- | --- | --- |
| `cms.Section` | Section | **New.** A band of the page with its own anchor, colour scheme, background, spacing, width, content position and entrance reveal, holding any blocks. It stands only at the top level of a page, or in a Section group. |
| `cms.SectionGroup` | Section group | **New.** Holds Sections and paints one colour scheme, background and decorative backdrop behind all of them, with no seam between them; optional space above and below and an anchor. It stands only at the top level of a page. See [Section groups](#section-groups). |
| `cms.Row` | Row | Columns layout container. Unchanged. |
| `cms.Column` | Column | A column inside a Row. **Extended** with **Distribute blocks vertically** (from the top, which is the default, center, to the bottom, space between, or the last block to the bottom); a block placed in a column can take another **Order in the column** per breakpoint, and the column itself another **Order in the row**: see [Columns: distribution and order](#columns-distribution-and-order). A column can also span rows of its Row and start at a given column or row per breakpoint: see [Columns: placement in the row's grid](#columns-placement-in-the-rows-grid). |
| `cms.Heading` | Heading | **Reshaped.** The text is inline rich text (bold, italic, link, three highlight styles, an icon from the icon catalog: see [Icons in headings and captions](#icons-in-headings-and-captions)). The semantic level (`h1`–`h6` or a paragraph) is chosen apart from the visual size, which is a type-scale token. Font, size, weight, style and line height stay available as **Custom** overrides in an "Advanced" group. |
| `cms.Text` | Simple Text | Body text with typography controls; it reads the brand tokens as defaults. **Extended** with a maximum text width per breakpoint (narrow, medium, wide or Custom px; none by default), which follows the text's alignment. |
| `cms.RichContent` | Rich Content | TipTap rich text. **Extended** with collapsible "read more" text, a check-mark list, links shown as buttons, heading anchors, visually hidden headings, the three highlight styles and a maximum text width per breakpoint. Its headings follow the brand's type scale once one is set (see [Rich-text headings and the type scale](#rich-text-headings-and-the-type-scale)). An image in the text takes a **Width** in px or %, an **Alignment** (left, center, right) and **In the line of text**, which sets it inside a sentence (a logo, a small avatar group); the same applies to every rich body of the other blocks. In the admin, **Image source** picks the image from the **Asset library** (its alternative text is filled in when the asset has one and the field is still empty) or takes a **URL**. |
| `cms.Button` | Button | **Reshaped.** One button described by a style (`primary`, `secondary`, `light`, `dark`), a fill (`solid`, `outline`, `text`), a size, an optional icon (before, after, or icon only), colour overrides and a link. Today's `ghost` variant is the `text` fill. |
| `cms.Image` | Image | **Extended.** A **Mobile image** shown below the tablet width, an **Aspect ratio** per breakpoint (Responsive tab; a preset or a custom `w:h`, the image's own ratio by default), an **Overlay** (solid or gradient, with direction and strength) and an optional **Caption** below or beside the image — an image with a sentence next to it, such as a small avatar group. **Full width** is the existing Width option; inside a Section with the **Bleed** width the image reaches the window's edges. The image is loaded lazily; with a ratio its space is reserved before it loads. With none of these set it looks as before. |
| `cms.Icons`, `cms.Social`, `cms.Spacer` | Icons, Social, Spacer / Divider | Unchanged. |
| `cms.Hero` | Hero / CTA banner | **Reshaped.** Media (solid colour, gradient, image with a mobile alternative, or self-hosted video with a poster and a **Video aspect ratio** per breakpoint for a video above the text, 16:9 by default) behind or above the text; eyebrow, title, subheading and statement, each with its own level and size; rich body text; up to six buttons; social proof (image and caption); **Overlay (darkens the background media)**, minimum height, alignment and an optional entrance reveal; the overlay's **Type** is none, solid or gradient, and only the settings that type uses are shown (the strength for solid and gradient, the direction for a gradient). **Elements: order and spacing** puts the eyebrow, title, subheading, statement, text, buttons and social proof in any order (unlisted ones follow in the default order), and each listed element can take a **Space after** it (a spacing size or a **Custom** px value); left on **Default**, an element keeps **Space between items**, or the default spacing when that is not set. **Media width: Full window width** lets an image or video reach the window's edges while the text stays in the hero. A video's mobile alternative is a library video, or a **Mobile video URL** with the URL source. **Poster source** sets where both stills come from: the **Asset library** (**Poster image**, **Mobile poster image**) or **URL** (**Poster URL**, **Mobile poster URL**); the mobile poster is the still shown before the mobile video plays, so a video of another shape is not shown cropped. The title takes a **Title weight** and a **Title max width** per breakpoint: see [Headings: weight and width](#headings-weight-and-width). |
| `cms.MediaText` | Media and text | **New.** Image or video (from the Assets Library or, with **Video source: URL**, by address, each with an optional mobile video shown below the tablet width, and with a **Video aspect ratio** per breakpoint, 16:9 by default) beside text, with side, mobile order, column split, vertical alignment, feature items with icons, buttons, a footnote, and repeated rows that can alternate sides. A video takes an optional **Mobile poster image** or **Mobile poster URL** for the mobile video. **Item title size** (a type-scale size or **Custom (px)**, per breakpoint) and **Item title weight** (300–800) restyle every feature item's title; left on **Default**, the titles stay 16 px semibold. |
| `cms.BackgroundPanel` | Background image panel | **New.** An image with a text panel on one side. To take it edge to edge, put it in a Section with the **Bleed** or **Full** width. **Transparent text box** (off by default) leaves the text panel without its scheme background, so the image shows through behind the text; choose the scheme so the text reads on the image. |
| `cms.CtaCard` | Call-to-action card | **New.** A boxed call to action in its own colour scheme, with a list, buttons, an optional image and the brand's decorative backdrop. |
| `cms.Statement` | Statement | **New.** A large statement or quote, optionally over an image that fills the block, with an optional word-by-word reveal and a maximum text width per breakpoint. A Section with the **Bleed** width takes it edge to edge. |
| `cms.LinkList` | Link list | **New.** Rows of title, description and button, with an optional divider. |
| `cms.FeatureList` | Feature list | **Reshaped.** Columns per breakpoint, uploaded SVG icons that take the text colour, rich item text, an optional image below the grid. |
| `cms.Stats` | Stats | **Reshaped.** Key figures with an optional heading and image. |
| `cms.Testimonial` | Testimonial | **Reshaped.** Adds an image and an image-overlay layout; the card layout is the default. |
| `cms.Video` | Video | **Extended.** **Source: Embed** (YouTube, Vimeo or a page URL, as before: the **Video URL** and the **Provider**) or **Video file**. For a file, **File source** sets where the video and its optional mobile version (shown below the tablet width) come from: the **Asset library** (**Video file**, **Mobile video file**) or **URL** (**Video URL**, **Mobile video URL**); **Poster source** does the same for the **Poster image** and **Mobile poster image**, or the **Poster URL** and **Mobile poster URL**. Only the fields of the chosen sources are shown. A video saved before the sources existed opens on the source its values imply — a URL with no library file is the URL source — and plays as before: with no source chosen, a library file or image wins over a URL. The **Aspect ratio** takes every preset and a custom `w:h`, per breakpoint (Responsive tab). A file loads nothing until it plays; with **Autoplay** it plays muted, only while on screen and never for a visitor who prefers reduced motion; otherwise the visitor starts it with its controls. **Rounded corners** (none, small, medium, large) round the player's frame; the default, medium, is the 8 px it always had. An autoplaying file is always muted, so **Muted** is offered only for a file that does not autoplay. |
| `cms.LogoStrip`, `cms.Map`, `cms.SimpleTable` | Logo strip, Map, Table | Unchanged. |
| `cms.AnnouncementBar` | Announcement bar | Unchanged. |
| `cms.ContentSlider` | Carousel | **Reshaped** into the one carousel: a header (heading, lead, button), slides per view per breakpoint (1–8, in steps of 0.25), slide or fade effect, arrow placement per breakpoint, an arrow style, shape, size and colour, dots, bleed to the viewport edge, optional autoplay. The same items can be laid out as a grid of columns per breakpoint, and an optional filter bar shows only the items with one tag. The slides per view are CSS, so the server and the browser render the same layout. See [Carousels: controls, grid and filter](#carousels-controls-grid-and-filter). |
| `cms.CarouselImage`, `cms.CarouselSplit`, `cms.LinkTile`, `cms.DownloadTile` | Carousel image, Carousel split slide, Link tile, Download tile | **New** carousel items, offered only inside a carousel. Each item, and a free-content slide, carries optional tags for the carousel's filter. A carousel image's caption over the image can sit on a scrim (a gradient from its edge or an even tint). A link tile's image ratio can differ per breakpoint. A carousel image takes **Image – rounded corners** (and its caption **Caption – rounded corners**), a link tile **Rounded corners** (none, small, medium, large; medium, 8 px, by default). A carousel image's caption, and a link tile's title and label, take a size per breakpoint and a font; a link tile's label is a text link with an arrow, a button or hidden. A download tile is a single download link to an Assets Library file; when the file is gone, customers see nothing and the preview shows a warning. |
| `cms.Tabs`, `cms.Accordion` | Tabs, Accordion | **Reshaped.** Each panel holds blocks instead of one HTML text, every panel is in the server-rendered HTML, and keyboard navigation follows the WAI-ARIA patterns. Tabs gain an animated panel change (fade or slide) and a tab bar look: the bar's background and border (a capsule around pills), the active and other tabs' colours, a hover colour for the other tabs, a **Tab size** per breakpoint (small, medium or large; medium when not set), and the **Space below the tab bar** (a spacing size or a **Custom** px value, per breakpoint; 12 px when not set). A panel in columns is a Row inside it: see [Tabs: a panel in columns](#tabs-a-panel-in-columns). **Tabs that do not fit** either wrap onto more lines (the default) or stay in one line that scrolls sideways inside the block, snapping to a tab; the page itself never scrolls sideways, and the keyboard works the same in both. Accordion item titles can be headings (H2–H6, the trigger inside the heading) with a size from the type scale; by default they are not headings and keep their look. |
| `cms.NewsletterSignup` | External newsletter form | Kept as the form that posts to **any external endpoint** (`actionUrl`). Gained an optional consent checkbox. The platform's own newsletter sign-up is the `newsletter.Signup` block below. |
| `cms.ContactFormEmbed`, `cms.RawHtml`, `cms.RawJs`, `cms.InsertBlock` | Contact / form embed, Raw HTML, Raw JS, Insert Block | Unchanged. `InsertBlock` embeds a Block by `code`; a Section in an embed placed at the top level of a page renders as a section. |
| `cms.InsertTemplate` | Insert Template | Legacy: kept for existing trees and **not** in the drawer palette. Prefer Save as / Apply template. |
| ~~`cms.ImageSlider`~~ | — | **Removed.** Use the Carousel with **Carousel image** items, which carry every caption option the image slider had. |

Blocks owned by other modules appear in the same palette while their module is
present:

| Block | Owner | What changed |
| --- | --- | --- |
| `blog.LatestPosts` | `blog` | **New.** The newest published posts of the channel, as a carousel or a grid. |
| `newsletter.Signup` | `newsletter` | **New.** Subscribes through the newsletter module, with optional topics and a required consent checkbox; works without JavaScript. |
| `catalog.ProductGrid`, `catalog.ProductSlider` | `catalog` | **Reshaped.** A header, a card variant (including a `showcase` card with a short summary), a "more" link label and a footer button; the slider takes the carousel options. |

**An empty listing shows nothing.** A product grid, product slider, category grid,
category list or latest posts block that finds nothing to show (no product in its
category, no post yet) leaves no trace on the storefront: no box, no heading, no
sentence. In the editor its preview still says why it is empty.

### Content saved before a block changed shape

A reshaped block keeps every option it had: the option-parity test
(`packages/cms-components/src/components/option-parity.test.ts`) maps each
field the block had before the reshape to its new counterpart. Stored content
is not migrated in the database, and it does not need to be:

- **A reshaped block renders stored content as before.** Each reshaped block
  carries a mapping from its earlier props (`heroFromLegacy`,
  `headingFromLegacy`, `buttonFromLegacy`, `contentSliderFromLegacy`, and so on)
  that runs when it renders. When an editor opens the page, the editor converts
  the block to the new shape, and the next save stores it. A stored tab or
  accordion panel written as HTML keeps rendering as that HTML until the page is
  opened, when it moves into the panel as a **Rich Content** block.
- **A hero's spacing list moves into its element list.** A hero saved with
  **Space after an element** keeps its spaces on the storefront. When the page is
  opened, each space moves to its element in **Elements: order and spacing**,
  which then lists every element in the order shown — nothing moves on the page.
- **A removed block degrades to the missing-block placeholder.** A stored
  `cms.ImageSlider` renders nothing for customers, the rest of the page renders
  normally, and the editor shows the placeholder where it was. Rebuild it as a
  Carousel.

### Section settings

The **Section** block (`cms.Section`) carries the section settings — anchor,
colour scheme, background, spacing, width, content position and an entrance
reveal — and a slot that holds any other blocks. Each setting is a field of
its own. Width, Space above, Space below, Content position and Overlap with the
previous section are set per breakpoint on the editor's **Responsive** tab: choose Base (mobile), Tablet or Desktop in
its **Scope settings** and edit the value for that breakpoint, as on a Row. The
other settings are on the **General** tab, with the anchor and the entrance
reveal last. No other block carries section settings; a block outside a
Section renders exactly as it does on its own.

A Section stands only at the **top level** of a page, or in a
[Section group](#section-groups). Every other slot — a row's columns, a tab or
accordion panel, a carousel slide, another Section — refuses it, and the
editor undoes a drop into one. A Section embedded with
`InsertBlock` at the top level of a page renders as a section. With nothing
set, a Section is neutral: no colour, the contained width and the `l` spacing.

| Setting | Options |
| --- | --- |
| Anchor | A fragment name such as `contact`, so that `/page#contact` scrolls to the section. See [Anchors](#anchors). |
| Color scheme | Inherit, Light, Muted, Dark. The scheme sets the text, heading, link, border and button colours of every block inside the section. |
| Background | None, solid colour, gradient, image or video. An image takes an optional mobile image, a focal position, a **size** (Cover, the default; Contain, the whole image; Natural size; or a width in px or %) and a **repeat** (none, the default; tile; across; down); a video takes a poster and an optional mobile video. An overlay (solid or gradient, with direction and strength) can sit above the media. On the dark scheme, **Decorative backdrop** paints the brand's decorative image; with it switched on, **Backdrop size**, **Backdrop repeat** and **Backdrop position** set how it is drawn (Cover from the top centre, not repeated, until changed). A size in px keeps the image or backdrop that size on every screen width. With a mobile image or mobile video, **Mobile image or video shown on** sets where it gives way to the desktop one: **Phones (below 768 px)**, the default, or **Phones and tablets (below 1024 px)**. |
| Space above / Space below | Responsive tab. A step of the brand spacing scale (`none`, `xs`, `s`, `m`, `l`, `xl`, `xxl`) or a pixel value, per breakpoint; a breakpoint left on **Inherit** takes the one below it. Spacing is padding, so two adjacent dark sections touch and read as one dark area. |
| Width | Responsive tab. Contained, Wide, Full, Viewport (the full viewport wide and at least the full viewport tall), Bleed (content to the edges) or Custom, which shows **Custom max width (px)**: one maximum width in pixels. Set it per breakpoint for a section that is, say, **Bleed** on phones (a box edge to edge) and **Contained** from the desktop up; a width chosen once applies at every breakpoint, as before. A Custom width wider than the page container widens the section beyond the container, centred, up to the window less the page's side margin; narrower than the container, it stays inside it. |
| Content width | Shown with Full, Viewport or Bleed: the background keeps that extent and the content sits in the page container, the wide frame, to the edges or in a custom max width. A dark band across the whole screen with its content in the container is **Bleed** with content width **Page container**; only **Viewport** also makes the section the full screen tall. Left unset, the width's own content frame applies. |
| Content position | Responsive tab. Top, Middle or Bottom, per breakpoint: where the content sits when the section is taller than it, as a Viewport section is. |
| Overlap with the previous section | Responsive tab. A step of the brand spacing scale or a pixel value, per breakpoint; **None** until set. The section's content moves up by that much over the bottom of the section before it and is drawn above that section's background, while this section's own background stays in place, for example an image that rises into a dark band of features. Keep it within the previous section's space below, or its content is covered. The first block of a page overlaps nothing. In the editor the content is not moved, so the previous section stays easy to select; a hatched band at the top of the section shows how far it will overlap on the previewed breakpoint. |
| Entrance reveal | None or fade-up, optionally on desktop only. See [Motion](#motion). |

A newsletter sign-up inside a Section with an anchor brings the visitor back
to that anchor after a sign-up without JavaScript.

**An empty Section takes no space.** When none of a Section's blocks shows
anything on the page — a news list with no posts yet, a product list with no
products, or blocks hidden on that breakpoint with **Hide on** — the published
Section drops its space above and below (and its overlap and minimum height),
so the page shows no blank band. A Section with a background image or video
keeps its size, since the media is its content. The editor always shows the
Section with its space, so you can drop blocks into it. Browsers without
support for the CSS `:has()` selector (older than 2023) show the empty space
as before.

### Section groups

A **Section group** (`cms.SectionGroup`) holds a run of Sections and paints
one background behind all of them. Use it when several adjacent Sections share
a dark band with the brand's decorative backdrop: on separate Sections each one
paints its own copy of the backdrop from its own top, so a hard edge shows at
every boundary; in a group the backdrop is painted once, from the group's top,
and runs on behind every Section in it.

A group stands only at the **top level** of a page, and its slot accepts
**Sections only**: the editor undoes a drop of any other block into it, and of
a group into any slot. Its settings:

| Setting | Options |
| --- | --- |
| Color scheme | Inherit, Light, Muted, Dark. The Sections in the group take this scheme unless they set their own. |
| Background | The same choices as a Section's: none, solid colour, gradient, image or video, with the overlay, and on the dark scheme **Decorative backdrop**. It is painted once, across the full window width, behind all the group's Sections. |
| Space above / Space below | Responsive tab. A step of the brand spacing scale or a pixel value, per breakpoint; **None** until set, since the Sections carry their own spacing. |
| Anchor | A fragment name for the whole group, as a Section's. |

While the group paints — it has a scheme or a background — a Section in it
with no background of its own and the group's scheme (or **Inherit**) is
transparent, so the group's background shows through it. A Section that sets
a background, a decorative backdrop or another scheme paints it as usual, for
example a light band inside a dark group. With neither a scheme nor a
background, the group paints nothing and its Sections look as they would
without it.

Inside a group a Section keeps everything else: its width, spacing, content
width, anchor and overlap. The first Section of a group can overlap the block
before the group (the group's own space above is covered first); the first
Section of a group that opens the page overlaps nothing. An empty Section in a
group takes no space, as anywhere, and a group none of whose Sections shows
anything drops its own space above and below too. A group stored inside
another block (which the editor refuses) renders its Sections' content only.

### Colour schemes

The three schemes — light, muted and dark — are defined once on the
[Brand](./brand.md) screen. A section with a scheme renders
`data-cmsb-scheme="light|muted|dark"`, which rebinds the scheme variables
(`--cmsb-fg`, `--cmsb-bg`, `--cmsb-fg-muted`, `--cmsb-border`,
`--cmsb-link`) for everything inside it. Colour fields in the blocks also
accept a brand colour: the colour picker lists **Brand colors** first and
stores a token such as `token:primary`, which follows later brand changes.
A hex value stays available as an override.

Inside a section with a scheme, the blocks' secondary text — feature
descriptions, product SKUs and stock, category counts, an inactive or active
tab — takes the scheme's muted or main text colour, so it stays legible on the
dark scheme. The light grey behind a link tile's or a carousel image's picture
gives way to the section's own background, so artwork with a transparent
background shows no light card on a dark section; an item with no image yet
shows a faint tint of the scheme's text colour instead. A bordered product
card takes the scheme's background and border, and an active pill tab inverts
the scheme's colours. Outside a section with a scheme, all of these look as
they did before.

### Anchors

A Section's anchor and a heading anchor in Rich Content become element ids,
and a button, a rich-text link or a link field of the **In-page anchor** kind
can target them. The editor normalises what is typed — lower case, ASCII,
hyphens, a leading letter, at most 64 characters — so `Contact Us!` becomes
`contact-us` and `9x` becomes `a-9x`. The link field lists the anchors on the
current canvas: the anchors of its top-level Sections and Section groups, and
of the Sections inside a group.

Saving page, block or template content is refused with `422` when an anchor
breaks one of two rules, checked per language tree:

| Error | When |
| --- | --- |
| `CMS_DUPLICATE_ANCHOR` (`details.anchor`) | The same anchor is used twice in one language's content. A section anchor and a heading anchor conflict with each other; the same anchor in two languages is allowed. |
| `CMS_RESERVED_ANCHOR` (`details.anchor`) | The anchor is an id the storefront layout already uses: `main-content`, `cmsb`, `cmsb-header-offset`, `b2b-locale`, `b2b-currency`, `ga-gtag-src`, `ga-gtag-init`, `gtm-init`. |

The reserved list is `RESERVED_ANCHORS` in
`packages/contracts/src/page-builder-values.ts`, re-exported by the storefront
as `storefront/app/reserved-anchors.ts`. Only the anchors of top-level
Sections, of top-level Section groups and of the Sections inside a group
count, because only they render an id. A
refused save writes nothing and records no audit entry. The storefront
offsets the scroll target by its sticky header
(`scroll-margin-top: var(--cmsb-header-offset)`).

### Section presets

The block drawer offers ready-made sections — hero, media and text,
call-to-action card, downloads, feature grid and statement — assembled from
the blocks above with neutral placeholder copy in the editor's language.
Each preset is a Section holding its block. Inserting one adds it at the top
level, after the selected block's top-level Section or at the end of the page,
without replacing the canvas; when the selected block is in a Section of a
Section group, the preset goes into that group, after its Section; everything in it is then edited like any other block. The presets
are code (`packages/cms-components/src/editor/section-presets.ts`), versioned
with the blocks they build, and their copy is in the `cms` bundle under
`presets.*`.

### Parent page and breadcrumbs

The page editor's **Breadcrumbs** card sets:

- **Parent page** — the page shown before this one in the breadcrumb trail.
  It changes the page's address only with the option below. A page cannot be its own parent or
  be placed under one of its subpages, and the tree is at most eight levels
  deep; a refused choice answers `422 CMS_PAGE_PARENT_CYCLE`. Deleting the
  parent clears the field on its children.
- **Include the parent page's path in the address** — off by default, so a
  page keeps its flat `/<slug>`. On, the page is served under its parent's
  address: `/<parent path>/<slug>`. The parent's own address follows the same
  rule, so a tree whose lower pages all opt in gives addresses such as
  `/services/consulting/workshops`. See *Nested page
  addresses* below.
- **Show breadcrumbs** — on by default.
- **Breadcrumb color scheme** — light (the default, which paints nothing),
  muted or dark. On muted and dark the links take the scheme's muted text
  colour (its text colour on hover) and the current page its text colour.
- **Show the breadcrumbs over the first section** — off by default. On, the
  trail lies over the top of the page's first section (a hero, for example)
  instead of in a band above it, and nothing on the page moves down: no band is
  painted, and the trail keeps the brand's page container and side margin.
  Choose the **dark** scheme for a light trail on a dark image. The first
  section is not padded for the trail automatically — give it enough top
  padding (its **Space above**, or the hero's own) so the trail does not cover
  its content.

The storefront renders *Home › ancestors › page*. Every crumb is labelled with
the page's **name** — the current page's and each ancestor's alike (until
2026-10-27 an ancestor showed its meta title instead). An ancestor that is not
published in the request's sales channel is shown as plain text, not as a
link, and its slug never leaks across channels. The trail sits in the brand's
page container and side margin, so it lines up with the page content. On the
muted or dark scheme the painted band holds its own space below the trail, so
a dark first section follows it with no light strip in between. The trail's
`BreadcrumbList` structured data uses absolute URLs. The fields are
stored on `cms_pages` (`parent_page_id`, `breadcrumbs_visible`,
`breadcrumbs_scheme`, `breadcrumbs_overlay`, `share_image_asset_id`) and are
part of the `cms_page.update` audit entry.

### Nested page addresses

A page's **public path** is its own slug, or — when **Include the parent
page's path in the address** is on (`parentPathInUrl`, stored as
`cms_pages.parent_path_in_url`) — its parent's public path, a `/` and its
slug. The path is computed when the page is read, per sales channel, from the
slug each channel serves a page under; it is never stored. So:

- **Renaming or moving a parent moves every nested page below it.** The old
  address stops answering; there is no automatic redirect from it.
- **The page's own slug keeps answering**, with a permanent (308) redirect to
  its path, so links made before the option was switched on keep working.
- **A parent the channel does not serve** leaves the page at its own slug in
  that channel.
- **Two pages cannot share an address in one channel.** A save that would
  give a page — or a nested page below it — an address another page already
  has is refused with `409 CMS_SLUG_CONFLICT`, and nothing is written.
- The first segment of a nested address is the top page's slug, which the
  reserved-segment rule already checks, so a nested page cannot shadow a
  storefront route such as `/p/…`, `/c/…`, `/cart` or `/account`.

The page editor shows the resulting address under **Public address**. The
storefront's breadcrumb links, canonical link, `og:url` and sitemap use the
path, and a Page Builder link to a page is rendered at the page's path in the
request's channel.

### Name, slug and description per language

A page's **Name**, **Slug** and **Description** in the *Page metadata* card
are its defaults. The **Language version** card gives each language of the
page its own name, slug and description, next to that language's meta title,
meta description and meta keywords. A field left empty uses the page's own
value, which the card shows greyed out as a hint. The card edits the language
the canvas shows: the language tabs in the card and above the canvas switch
both. While a language's slug has not been typed, it follows that language's
name, as a new page's slug follows its name.

The overrides are stored in `cms_pages.translations`
(`{ "<lang>": { "name", "slug", "description" } }`, `{}` for a page that
overrides nothing) and are part of the `cms_page.update` audit entry. An
override counts only while the page has its language: removing a language
from the page keeps its overrides stored but unused, and adding the language
back brings them back. The API refuses an override of a language the page does
not have with `400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.

On the storefront:

- **Each language is served at its own slug** — and, for a nested page, at its
  ancestors' slugs in that language, under that language's path prefix, as a
  product's address is: `/pl/o-nas` in Polish, `/en/about-us` in English (`/o-nas`
  when the channel does not prefix its default language — see *Sales channels*).
- **A page is found by its slug in any of its languages**, and by its own slug,
  and served in the visitor's language. When the address asked for is not the
  page's address in that language — a visitor switched language on the page —
  the storefront answers a permanent (308) redirect to the right one.
- **Two pages cannot share an address in one channel and one language.** The
  same slug may be one page's in Polish and another page's in English. A save
  that breaks this is refused with `409 CMS_SLUG_CONFLICT` (`details.language`
  names the language) and nothing is written.
- The page's name in the served language is its title fallback and its crumb in
  every breadcrumb trail, and a Page Builder link to a page is rendered at the
  page's address in the served language.
- The canonical link is the served language's address; every language is a
  `hreflang` alternate, and the sitemap lists every language's address with
  the others as alternates. The reserved-segment rule checks every language's
  slug.

The description is the page's internal note and is not shown on the storefront.
The page list's search finds a page by its name or slug in any language.

### Sharing image and search metadata

The page editor's **Sharing** card picks a **Sharing image** from the Assets
Library — about 1200 × 630 px suits most networks. Without one, the page uses
the setting `cms.default_share_image_asset_id` (**Settings → Page Builder →
Default sharing image**, settable per sales channel). Only public assets are
published. An asset used as a sharing image cannot be deleted
(`409 ASSET_REFERENCED`).

The storefront then emits, for a CMS page and for a CMS-backed home page:

- `og:image` and `twitter:card` `summary_large_image` when an image exists
  (`summary` otherwise);
- `og:locale` for the served language and `og:locale:alternate` for the
  page's other languages that have content. A CMS page also has `hreflang`
  links, one per language, because each language has its own address (see
  *Name, slug and description per language*). The CMS-backed home page has
  none: `/` serves every language;
- `Organization` structured data with the shop logo and social profiles from
  the Settings module (`shop.logo_asset_id`, `shop.social_profiles`).

### Headings: weight and width

A block's heading keeps the look of its size until you choose otherwise. Two
options change it:

- **Heading weight**: **Default** (the size's own weight, as before) or a
  weight from Light (300) to Extra bold (800).
- **Heading max width**, per breakpoint on the Responsive tab: **None (full
  width)** by default, **Narrow**, **Medium**, **Wide** (about 36, 48 and
  60 rem) or **Custom (px)**. A long heading then wraps at that width; in a
  centred block it stays centred.

Both are on the media-and-text block, the background image panel, the
call-to-action card, the link list, the feature list, the stats, and the
header of the carousel, the product grid and slider, and the latest posts.
The statement takes the weight only: its **Max text width** already holds the
heading and the text. On the hero the same pair is **Title weight** and
**Title max width**.

Smaller texts take a weight too: the feature list's **Title weight** (every
item title), a carousel image's **Caption weight**, a link tile's **Title
weight** and **Label weight**, and the product listings' **Card title
weight** (the product name on every card). **Default** keeps each one's look.

The carousel and the product card read the brand's **body font**, as the other
blocks' texts do: the filter bar, the header's lead and the cards' texts follow
the brand screen. With no brand font set they keep the page's font.

### Icons in headings and captions

Every text edited as inline rich text — a heading, a block's title, a carousel
image's caption — can hold an icon from the same icon catalog the feature list
and the icon block use. Place the cursor, choose **Insert icon** in the text's
toolbar and pick an icon; search by name. The icon sits on the line of text, at
the text's size and in its colour (inside a gradient highlight it takes the
accent colour), and is removed like a character.

In the same dialog, before picking the icon, **Icon size** sets its size:
**Text size (1 em)**, the default; **Relative to the text (em)**, from 0.5 to 3
times the text's size, so the icon scales with the heading on every screen; or
**Fixed (px)**, from 8 to 200 pixels. **Vertical offset (em)** raises the icon
(a positive value, up to 1) or lowers it (a negative value, down to −1), in
units of the text's size; left empty, the icon sits on the line as before. To
change an icon already in the text, select it (for example with the arrow
keys) and choose **Edit icon**: the dialog opens with its values, **Apply**
keeps the icon and writes the new size and offset, and picking another icon
replaces it.

The icon is decoration: it is hidden from screen readers, so the heading is
read by its words alone, and it is not sent for translation — a translated
heading keeps it where the translation puts it.

### Rich-text headings and the type scale

Headings written inside rich text — a Rich Content block and the text of the
media-and-text block, the call-to-action card, the hero, the feature list and
the other blocks with a rich body — follow the **type scale** of the
[brand settings](./brand.md): a Heading 4 in the text takes the Heading 4 size
(mobile and desktop), line height, weight and letter spacing. Until a type scale
is set for a heading level, headings of that level keep their look as before.

### Text sizes, line heights and spacing in blocks

The smaller texts of the content blocks take their own look, each option empty
or on **Default** until you choose otherwise, so a block already on a page keeps
its look. Three rules hold for every block:

- **A size is a step of the type scale or Custom (px).** A step (**Body**,
  **Lead**, **Heading 4** …) brings the brand's line height, weight and letter
  spacing of that step with it, at every breakpoint — so a text set to **Body**
  looks like body text everywhere. Sizes are set per breakpoint on the
  **Responsive** tab.
- **A line height is offered with a Custom (px) size only.** A step already has
  its own; a line height (a multiple of the size, for example 1.5) applies only
  at a breakpoint whose size is Custom (px).
- **A weight is one value for every breakpoint.** It wins over the step's own
  weight. A weight saved per breakpoint by an earlier version of these options
  is read as its desktop value, else its base value.

Spaces inside a block are one step of the brand spacing scale (**None**,
**XS** … **XXL**), not a pixel value per element; a step has its own phone and
desktop size, so it follows the breakpoints and the brand.

- **Feature list**: **Text size**, **Text weight** and **Text line height** for
  every item's text (by default a small, muted line); **Title line height**
  with a Custom title size; **Space inside each item** — the space after the
  icon, below the title and between the paragraphs. **Icon position: Beside
  the title** puts the icon at the start of the title, and the title and the
  text hang beside it: a wrapped line starts under the text, not under the
  icon.
- **Hero**: the subheading and the statement take a **weight**, a **line
  height** (with a Custom size) and a **max width**, like the title; the text
  takes a **Text size** (16 px by default), **weight**, **line height** and
  **max width**. The hero has one **Text color** for all its texts; the eyebrow
  may take its own **Eyebrow color** as an accent. **Space between items**
  offers **Custom (px)**. With media **Above the content**, **Space below the
  media** sets the space between the image or video and the texts (none by
  default). The social-proof image keeps its 40 px height.
- **Statement**: **Heading line height** (with a Custom heading size), and the
  supporting text's **size**, **weight** and **line height**. Over a background
  image, **Minimum height** (**Default** is 60 % of the screen's height; also
  half, three quarters, the full screen, **Auto** or **Custom (px)**).
- **Stats**: the labels' **size** and **weight** (their colour is the scheme's
  muted text; **Value color** stays the figures' accent). Beside an image, from
  the tablet up, **Layout (image – figures)** places the image and the figures
  on 12 columns (see *Layouts on 12 columns* below), and **Figures vertical
  position**: **Center** (default), **Top**, **Bottom** or **Spread over the
  image height**.
- **Link list**: **Row title size** and **Row title weight**.
- **Call-to-action card**: **Rounded corners** (**Default** keeps today's) and
  **Image inset**: the card's padding by default, **None** (the image reaches
  the card's edges) or **Custom (px)**, one value for every breakpoint.
- **Media and text**: **Side by side from** the tablet (768 px, default) or the
  desktop (1024 px); below it the media and the text stack, in the **Order on
  mobile**.
- **Rich content**: **Text size** and **Text weight** for the whole text; its
  lists follow them.
- **Row**: **Space between rows (px)** is set per breakpoint; one value saved
  before applies at every width.

In any rich text, the toolbar's **Text size** sizes the selected words with a
step of the type scale, and **List marker** chooses the markers of a bulleted
list: **Disc** (default), **Check mark**, **Chevron** or **None**. The page and
the editor render both the same. Words sized in pixels by an earlier version of
the toolbar keep their size until a step is chosen for them. A check mark is
drawn in the brand's primary colour and a chevron in the text's colour; a
block's **List marker color** (Rich content, Media and text) gives both
markers a colour of their own, for example white ticks on a dark Section.

A **Simple Text** block takes bold, italic, links and highlights: its text is
edited like a heading's. A text saved before keeps its plain text until it is
edited.

A heading that starts with an icon can hang its text beside the icon:
**Hanging indent after a leading icon** keeps a wrapped line under the text,
which starts 0.35 em after the icon.

#### Layouts on 12 columns

Media and its text side by side — the **Carousel split slide**, **Stats**
beside an image and the **Call-to-action card** with an image — take a
**Layout** from the side-by-side width up: **Default** (two equal halves, as
before) or a preset of columns of 12, named media first — **6 – 6**, **7 – 5**,
**5 – 7**, **8 – 4**, **4 – 8**, and **5 – 1 – 6** or **6 – 1 – 5** with a
column between (not on the card). With the media on the right the layout is
mirrored. **Advanced layout (columns of 12)** shows the widths in columns, the
columns between and **Columns aligned to** instead, and they win over the
preset while the switch is on; widths saved before the switch existed open with
it on. **Media and text** keeps its **Split (media – text)** as the layout and
offers the same switch for its widths in columns of 12.

A **gradient highlight** that wraps onto several lines is one gradient across
the whole phrase: each line continues it rather than starting it again.

### Carousels: controls, grid and filter

The options below are on the Carousel; the arrow placement, style,
alignment and the loop apply to the product slider and the latest posts
carousel as well.

| Option | Where | What it does |
| --- | --- | --- |
| **Arrow placement** | Responsive tab | Below the slides, in the header or over the slides, chosen per breakpoint. For example, arrows in the header on desktop and below the slides on a phone. |
| **Arrow style**, **shape**, **size**, **colour** | Controls (General tab) | Style: the default light circle, an outline or a solid fill. Shape: round or square. Size: 32, 36 (default) or 44 px. Colour: a brand colour or a hex value, used for the outline and icon, or as the fill. With nothing chosen the arrows look as before. |
| **Arrow icon** | Controls (General tab) | **Chevron** (default, as before) or **Arrow**, a drawn arrow from the icon catalog. The buttons, their names for screen readers and their style options stay the same. |
| **Next arrow style** | Controls (General tab) | **Same as the arrow style** (default), or a style of its own for the next arrow: for example an outline previous arrow beside a solid next one. Shape, size and colour stay shared. |
| **Controls alignment** | Responsive tab | Where the arrows and dots below the slides sit, per breakpoint: **Center** (default), **At the start**, **At the end**, **Spread out**, or **Arrows at both ends** with the dots centred between them. Only the position changes: the keyboard order stays previous, dots, next. |
| **Align the controls to** | General tab | **The content edge** (default) or **The first slide**: the arrows and dots below the slides line up with the first slide instead of the content. With **Bleed past the content edge**, the controls then end where the first slide ends rather than at the content's edge. Arrows in the header or over the slides do not move. |
| **Loop at the ends** | General tab | **Yes** (default, as before): the previous arrow on the first slide goes to the last one, and the next arrow on the last slide back to the first. **No**: the carousel stops at its ends, and the arrow that cannot go further is disabled — a screen reader announces it as unavailable and the Tab key skips it; if it had the keyboard focus, the focus moves to the other arrow. Autoplay then stops on the last slide. |
| **Disabled arrow look (no loop)** | Controls (General tab) | How an arrow disabled at an end looks: **Dimmed** (default), **Light outline (dark backgrounds)** — a transparent arrow with a faint white outline — or **Color**, an outline in the **Disabled arrow color** (a brand colour or a hex value). |
| **Layout** | General tab | **Carousel** (default) or **Grid**. A grid shows every item in **Columns** per breakpoint (1–6, set on the Responsive tab), with no arrows, dots or autoplay. Every item kind works in both. |
| **Filter** | General tab | **Show a filter bar**, the **“All” label** (left empty, the page language's word is shown) and the **tags to filter by**, each with the label visitors see. **Bar style**: **Pills** (default) or **Underlined tabs**, a line under the bar with the chosen tag underlined. **Bar alignment**: **Left** (default), **Center** or **Right**. **Buttons that do not fit**: **Wrap onto more lines** (default) or **Scroll in one line**. |

To filter, give each item its **Tags** (comma-separated, for example
`offices, retail`) and list the same tags in the carousel's filter. Tags are
compared without regard to case or surrounding spaces. Only the labels are
translated; the tags stay as they are.

The filter bar is a row of toggle buttons that wraps on a narrow screen; with
**Scroll in one line** it stays one line that the visitor swipes sideways
instead, snapping to a button, and a button reached with the keys or tapped
scrolls into view without pushing the page sideways. The
keyboard moves between the buttons with the arrow keys, Home and End, and a
screen reader hears how many items are shown after each change. Filtering
happens in the browser only: every item is in the server-rendered HTML, so a
search engine and a visitor without JavaScript see them all.

A carousel image's **Caption scrim** darkens the image behind a caption placed
over it, for legibility on a busy photo: a gradient from the caption's edge,
or an even tint, at a strength of 0–90 %. With a scrim, the caption drops its
own dark box unless you gave it a background colour.

A carousel image's **Caption size** and a link tile's **Title size** and
**Label size** are a type-scale size (Small, Body, Lead, Heading 1–6, Display)
or a **Custom (px)** value, chosen per breakpoint on the Responsive tab;
**Caption font**, **Title font** and **Label font** pick the brand's heading
or body font, and **Caption weight**, **Title weight** and **Label weight** a
weight from 300 to 800. Left on **Default**, the caption stays 14 px semibold
and the title 18 px semibold, as before. A link tile's **Label style** is a **Text
link with an arrow** (default), a **Button** in the primary button's look, or
**None**; the whole tile stays a single link either way.

A carousel image's **Caption hover color** and a link tile's **Title hover
color** and **Label hover color** (a brand colour or a hex value) change that
text's colour while the pointer is over the item or the item has the keyboard
focus, with a short fade between the two colours — at once for a visitor who
prefers reduced motion. The label colour applies to the text-link label; a
label shown as a button keeps the button's own hover look. Left empty, the
text keeps its colour.

A link tile's **Title color** and **Label color** (a brand colour or a hex
value) set the colour of its title and of its text-link label at rest, so a
hover colour has a colour to change from — for example a grey title that turns
white on hover. A label shown as a button keeps the button's colours. Left
empty, the title and the label keep their usual colours.

Both colours are set per breakpoint on the **Responsive** tab, so a tile can
rest in one colour on phones and tablets and in another on desktop — for
example a white title over the image on narrow screens and a dark one under it
on wide screens. A colour set for one breakpoint applies from that breakpoint
up until a wider one has its own; a breakpoint below the first one with a
colour keeps the usual colour. A colour set before this option existed is the
colour of every breakpoint, as before. A hover colour still wins on hover.

A carousel image's **Caption weight** and a link tile's **Title weight** and
**Label weight** are set per breakpoint on the **Responsive** tab too, so a
tile title can be regular on phones and tablets and medium on desktop. A weight
set for one breakpoint applies from that breakpoint up until a wider one has
its own; a breakpoint below the first one with a weight, or left on
**Default**, keeps the usual weight. A weight set before this option existed is
the weight of every breakpoint, as before.

### Carousel controls, buttons, download tiles and image cards: look options

Every option below is unset by default, and a page saved before them looks as
it did.

**Carousel controls** (the Carousel, the product slider and the latest posts
carousel, under **Controls**):

| Option | What it does |
| --- | --- |
| **Arrow icon color (solid style)** | The glyph of a **Solid** arrow (or a solid next arrow), white by default — so a white solid arrow can carry a black icon. Shown once an arrow style is Solid. |
| **Hide the arrows on**, **Hide the dots on** | The breakpoints (mobile, tablet, desktop) where the arrows or the dots are not shown, for example arrows only from the desktop up while phones and tablets swipe. A row of controls left with nothing to show there is removed, so it leaves no gap. |

The dots follow the colour scheme: in a dark Section the current dot is the
scheme's light text colour over faint dots, so it stays visibly current.

Arrows placed **In the header** show even when the carousel has no heading:
the header then holds only the arrows, at its end, as beside a heading. The
Carousel's **Arrow placement** also offers **Inside each split slide (under
its text)**: every **Carousel split slide** shows the arrows and dots at the
end of its text column, and only the slide on screen has working controls (the
others are hidden from the keyboard and screen readers). Like the other
placements it is chosen per breakpoint, for example below the slides on a
phone and under the text from the tablet up. A carousel whose items are not
split slides keeps its controls below the slides there. Free-content slides
(**Slide**) cannot hold the controls.

The product slider's and product grid's **Button below the products** takes a
**Button alignment**: **Left** (default), **Center** or **Right**.

**Button** (`cms.Button`):

- Its **Outline** fill is filled with the Section's background, as the
  `secondary` button it replaced was. **Transparent outline fill** lets the
  background show through instead (offered with an outline fill).
- **Border color** replaces the fill's border colour, for example a grey ring
  around an icon-only outline button. An **Icon only** button is as large as
  its **Size** option (small, medium or large, from the brand's button heights).

**Download tile**: **Card color scheme** (as the Section, light, muted or
dark), **Card background**, **Card border** (on by default), **Rounded
corners**, **Card padding** (a step of the spacing scale), **Title size** (a
step of the type scale or **Custom (px)**, per breakpoint) and **Show the file
type** (on by default). **Image on hover** is the default **Faint tint** or
**Full image with a dark gradient**, the text turning white over it. **Link
look** is the default **Text label** or a 48 px **Round icon button** at the
bottom end, ringed in the text colour; its label is still read by screen
readers. With the round icon button, **Icon button size** is **Small** (48 px,
as before), **Medium** (72 px) or **Large** (112 px), and **Icon button style**
is **Outline** (the ring, as before) or **Filled**: a disc in the text colour
with the icon in the card's background colour. The whole tile stays one download link, and tiles in a carousel row
keep equal heights.

**Carousel image**: a **Read-more label** (for example "Read more") shown over
the image in a corner of its own — **Read-more label placement**, bottom right
by default — apart from the caption, with an optional **Read-more label
icon**. It is 14 px semibold, 12 px from its corner, takes the caption's text
colour when one is set and is part of the item's link.

**Image** caption: **Caption placement** is chosen per breakpoint (for example
below the image on phones and beside it from the tablet up), and the caption
takes a **Caption size** (a step of the type scale or **Custom (px)**) and a
**Caption alignment** per breakpoint; it keeps the scheme's muted text colour.

### Buttons in blocks, hero texts, download tiles and image captions: more options

Every option below is unset by default, and a page saved before them looks as
it did.

**Buttons inside blocks** — a Hero's buttons, a card's or a panel's, a
section or listing header's button, the buttons of Media and text — take the
look options the **Button** block has: **Transparent outline fill** and
**Border color**. An icon-only button can also be a **Pill** instead of a
**Circle** (**Icon-only button shape**), 1.15 times as wide as it is tall — for
example a "scroll down" control slightly wider than tall. The Button block
offers the pill too; its other look options stay where they were.

**Hero**:

- **Title line height** per breakpoint, with a Custom title size. The hero's
  **Text color** colours all its texts; **Eyebrow color** gives the eyebrow an
  accent of its own.
- The eyebrow can serve as a label above the body: **Eyebrow size** (a step of
  the type scale or **Custom (px)**, per breakpoint, with an **Eyebrow line
  height** for a Custom size) and **Eyebrow in capitals** (on by default)
  switched off for a label in its own case. Put it where it belongs and set the
  space after it in **Elements: order and spacing**, as for any element.
- The **Social proof** caption: **Social proof caption placement** beside the
  image (default) or below it, per breakpoint — for example below on phones and
  beside from the tablet up —, and a **Custom social proof caption max width
  (px)** per breakpoint. It keeps the small, muted text.

**Download tile**:

- **Links to** a file (default) or **A page or URL**: the tile then takes a
  **Link** (a page, a product, a category, a file or a URL) instead of a file,
  has no file-type badge, and its round icon button points onwards. A tile
  whose link leads nowhere is not shown to customers; the editor shows a
  warning in its place.
- **Custom minimum height (px)**, one value for every breakpoint (180 px by
  default).
- A Custom title size now applies from the tablet up as well (it was read on
  phones only).

**Carousel image**: a caption on the same edge as the read-more label — both
at the bottom, or both at the top — now sits above the label's line instead of
sharing it, so the two never overlap on a narrow card.

**Image** caption: **Custom caption max width (px)**, per breakpoint. A
caption placed below the image on phones and
beside it from a wider breakpoint now gets a column of its own there, beside an
image of a set width, instead of being squeezed into the image's width.

An inline heading left empty — a Heading block, a Media and text heading, a
Hero's title — writes no empty heading element on the page; a Heading block
keeps its spacing.

### Tabs: a panel in columns

A tab's panel holds blocks, so a panel laid out in columns is a **Row** placed in
it; no dedicated layout is needed. For example, a panel with a short text on the
left, an image in the middle and a text with a button on the right:

1. Select the Tabs block and open the tab in the sidebar; drop a **Row** into its
   **Panel** and pick **3 columns**.
2. Set each **Column**'s width on the Responsive tab, for example 3, 5 and 4 of
   12 on desktop and 12 each on a phone, where the columns then stack.
3. Fill the columns: a Heading and an Image with a caption (the social-proof
   line) in the first, an Image in the second, a Rich Content text and a Button
   in the third.

A panel accepts any block except a Column on its own (columns live in a Row),
another Tabs or Accordion block, and a Section. Every panel, with its columns,
is in the server-rendered HTML. The **Space below the tab bar** sets the gap
between the bar and the panel.

On a phone, many tabs wrap onto two or more lines. Set **Tabs that do not fit**
to **Scroll in one line** to keep a single line that the visitor swipes
sideways instead; the bar snaps to a tab, a tab reached with the arrow keys or
chosen with a tap scrolls into view, and nothing wider than the screen pushes
the page sideways.

The **Tab size** is set per breakpoint on the Responsive tab: for example small
pills on a phone and medium ones from a tablet up. With one size for every
breakpoint the tabs look as they did with the size in the tab bar's look.

**Tab background on hover** and **Tab text on hover** (in the tab bar's look,
a brand colour or a hex) colour a tab that is not selected while the pointer is
over it, with a short colour transition; on a touch screen nothing sticks after
a tap. Left unset, the tabs do not change on hover, as before.

The **Panel change** is **Instant** by default. **Fade** crossfades: the
panel going out fades away over the one coming in, and the block's height
follows smoothly from one panel to the other. **Slide** adds a short sideways
shift in the direction of travel (a tab further on comes in from the end side).
Every panel stays in the server-rendered HTML; while the outgoing panel is
still fading it cannot be focused or read by a screen reader, and the arrow
keys, Home and End work as with an instant change. Visitors who ask their
system for reduced motion get the instant change.

### Columns: distribution and order

A column that is taller than its blocks (the Row stretches its columns to the
tallest one, which is its default vertical alignment) can spread them with
**Distribute blocks vertically**:

| Option | Effect |
| --- | --- |
| From the top | Today's stack, the default. |
| Center | The blocks sit together in the middle of the column. |
| To the bottom | The blocks sit together at the bottom. |
| Space between | The first block at the top, the last at the bottom, the others spread evenly. |
| Last block to the bottom | The blocks stack from the top and the last one goes to the bottom, for example a social-proof line under a text. |

A block inside a column can also take another place on a given screen size,
without a second copy hidden with **Hide on**: select the block and, on the
Responsive tab, set **Order in the column** for that breakpoint — **First**,
**Last**, or **Position 1** to **Position 6** (blocks left **As placed** come
before numbered ones). A breakpoint with no value of its own takes the one
below it. For example, a social-proof image first in its column on desktop and
last on a phone: **Last** on the base breakpoint, **First** on desktop.

The order changes what the visitor **sees**, not the page's structure: a screen
reader still reads the blocks, and the Tab key still moves through them, in
the order they are placed in the editor. Reorder only where both orders make
sense. The editor canvas also keeps the placed order, so dragging blocks works
on what the outline shows; the published page shows the order per breakpoint.
In a column where a distribution
or an order is set, the blocks are laid out as a flex column, so the vertical
margins of two neighbouring blocks add up instead of overlapping.

A whole column can move the same way inside its Row: select the **Column** and,
on the Responsive tab, set **Order in the row** for a breakpoint, with the same
choices. For example, in a Row of two columns that stack on a phone, the second
column first on a phone and in its place on desktop: **First** on the base
breakpoint, **As placed** on desktop. As with blocks, only what the visitor
sees moves — a screen reader and the Tab key follow the columns in the order
they are placed — and the editor canvas keeps the placed order.

### Columns: placement in the row's grid

A Row lays its columns out on a grid of twelve tracks; **Width** says how many
tracks a column takes. On the Responsive tab, a **Column** can also be placed on
that grid per breakpoint:

| Option | Values | Effect |
| --- | --- | --- |
| **Height in rows** | 1 row (default) to 4 rows | The column spans that many rows of the Row, so the columns next to it can stack beside it. |
| **Start at column** | Next free place (default), 1 to 12 | The track the column starts at. A start that would push the column past the twelfth track at that breakpoint's width is moved left so the column fits. |
| **Start at row** | Next free place (default), 1 to 4 | The row the column starts at. |

A breakpoint with no value of its own takes the one below it. As soon as one
column of a Row is placed, that Row fills the free places of its grid in order
(dense packing), so a column given only a start column takes the first free row
of that track. A column left at one row and the next free place on every
breakpoint renders exactly as before.

For example, a side column with a short item at its bottom next to two tall
columns, which stack one under another on a phone. Add four columns, each
**Width** 12 on the base breakpoint and 4 on desktop, in the order they should
be read: **A** (the top of the side column), **B**, **C** and **D** (the item
under A). Then, on desktop only, set **Height in rows** to 2 rows on B and C, and
**Start at column** 1 (optionally **Start at row** 2) on D. On desktop, A and D
share the first track and B and C span both rows; on a phone, A, B, C and D
stack in that order. D exists once: no second copy is hidden per breakpoint.

As with the order, the placement changes what the visitor **sees**, not the
page's structure: a screen reader and the Tab key follow the columns in the
order they are placed in the editor, so place them in an order that also reads
well. The editor canvas keeps the placed order and the widths, without the
placement, so dragging columns works on what the outline shows; the published
page shows the placement per breakpoint.

### Columns: a background wider than the column

A Column's **Background outset (px)**, on the **Responsive** tab, makes its box
— its background, border and shadow — reach that many pixels past the column
on each side, while the column's content stays where it was: a grey box a
little wider than the text column beside it. Set it per breakpoint, for example
**0** on phones, where the column already spans the screen, and **24** from the
desktop up. Left at 0 (the default) the box is as wide as the column. The
outset reaches into the gap between the columns and past the Row's edge, so
keep it within the space around the column. The column box's own **Outer
spacing** at the sides still applies on top of the outset, at every
breakpoint — a breakpoint whose outset is 0 shows the box with its own margins.

### Mobile images: phones only, or phones and tablets

An image with a **Mobile image** — the **Image** block, a Hero, a Media and
text block, any block whose image field offers one — shows the mobile image on
phones and the main image from the tablet width up (768 px). **Mobile image
shown on** (offered once a mobile image is set) moves that switch to the
desktop width: **Phones and tablets (below 1024 px)** keeps the mobile art on
tablets too, for a tall image that suits a tablet better than the wide desktop
one. A Section's or Section group's background has the same setting, **Mobile
image or video shown on**, for its mobile image or mobile video. Left at
**Phones (below 768 px)** nothing is stored and the image switches as before.

### Split slides, carousel controls and block spacing

Every option below is empty or off by default, and a page saved before them
looks as it did. Options marked *per breakpoint* are set on the **Responsive**
tab; a breakpoint without its own value takes the one below it, and a
breakpoint no value reaches keeps the block's own look.

**Carousel split slide**:

- **Side by side from** the tablet (768 px, default) or the desktop (1024 px);
  below it the media and the text stack, media first.
- **Layout (media – text)** on 12 columns from the side-by-side width up (see
  *Layouts on 12 columns*); **Default** keeps two equal halves.
- **Rounded corners** of the media (8 px by default; **None** for square).
- **Title size** and **Text size**, *per breakpoint*, each with a line height
  for a Custom size, and a **Title weight** and a **Text weight**.
- **Hanging indent after a leading icon**: a title that starts with an icon
  (a check mark, for example) hangs beside it, so a wrapped line starts under
  the text.

**Carousel controls** (the Carousel, the product slider and the latest posts
carousel):

- **Controls alignment** also offers **Dots at the start, arrows at the end**.
  Chosen, the alignment applies to the controls inside a split slide too (left
  unset, those start at the text's left edge).
- **Keep the arrows when all slides fit** (under **Controls**): when every
  slide is already on screen the arrows stay, both disabled, and the dots are
  hidden; off, the controls disappear as before. Kept arrows are not dimmed:
  they rest on the colour scheme's background with its border and muted text
  colour, so they stay readable on a light, muted or dark Section and over a
  slide. A chosen **Disabled arrow look** — **Light outline** or **Color** — is
  used instead, and is offered for this case on a looping carousel too.

**Media and text**: **Text size** for every row's text, *per breakpoint*, with
a **Text line height** for a Custom size; **Space between the heading and the
paragraphs** and **Space between media and text when stacked**, each a step of
the spacing scale. Each of **More rows** has its own **Vertical alignment**;
**Same as the block** (or empty) follows the block's.

**Background image panel**: **Layout on mobile** — **Image and text stacked**
(default) or **Text over the image**, which keeps the mobile image at its own
height (a tall mobile image keeps its shape) with the text over its top or
bottom, by **Text on mobile**.

**Feature list**: **Space between rows (px)**, *per breakpoint*, apart from the
gap, which then spaces the columns only; **Line height of lists in the text**,
*per breakpoint*, with a Custom text size.

**Call-to-action card**: **Card padding**, a step of the spacing scale (an
image inset is measured from it), and with an image a **Layout (image – text)**
from the tablet up (half the card by default; see *Layouts on 12 columns*).

**Stats**: **Label line height**, *per breakpoint*, with a Custom label size.

**Link list**: **Divider after the last row**, offered while **Divider between
rows** is on.

### Stacking breakpoints, column layouts and more text options

As above, every option below is empty by default, a page saved before them
looks as it did, and options marked *per breakpoint* are set on the
**Responsive** tab.

**Hero**: a social-proof caption placed **Below the image** always starts a
line of its own, also with a **Custom social proof caption max width (px)**
narrow enough to fit beside the image.

**Media and text**:

- With **Advanced layout (columns of 12)**, **Media width** and **Text width**
  in columns of 12 and the **Columns between the media and the text**, from the
  side-by-side width up — as on the carousel split slide. Any one set lays every
  row on a 12-column grid (the media 6 columns and none between unless set, the
  text the rest), mirrored on a row with the media on the right, in place of
  the **Split (media – text)**; for example 5 and 5 columns one column apart.
- **Heading line height** (with a Custom heading size, *per breakpoint*), a
  **Text weight**, and the **List marker color** of the check and chevron lists
  in every row's text.

**Call-to-action card** (with an image):

- **Image position when stacked**: **Above the text** (default) or **Below the
  text**; an image inset then runs along the sides and the bottom.
- **Side by side from** the tablet (768 px, default) or the desktop (1024 px);
  below it the card stacks as on a phone.
- **Custom image inset (px)** is one value for every breakpoint.
- **Text size**, *per breakpoint*, with a Custom (px) size; the list follows
  it.

**Stats** (with an image): **Side by side from** the tablet (default) or the
desktop; below it the image sits above the figures.

**Carousel split slide**:

- **Text indent**, offered with the hanging indent on: **Aligned with the title
  text** starts the text below where the title's text starts, after the
  leading icon and its space. Only a title that starts with an icon is
  indented.
- **Space between media and text when stacked**, and **Space between the
  title, the text and the controls** (the controls a carousel places inside its
  slides), each a step of the spacing scale.

**Image**: with a mobile image, **Mobile image shown on** phones only (below
768 px, default) or phones and tablets (below 1024 px), as for image fields.

**Heading**: **Max text width**, *per breakpoint* — a named measure or a
Custom (px) width; a centred or right-aligned heading keeps its alignment.

**Rich Content**: **List line height**, *per breakpoint*, with a Custom text
size.

**Accordion**: **Title line height**, *per breakpoint*, with a Custom title
size.

**Product grid** and **Product slider**: the header's **Lead size** (a type
token or Custom px, *per breakpoint*), **Lead weight** and **Lead color**.

**Download tile**: **Title weight**.

### Type sizes per breakpoint

A text whose size is a different type token per breakpoint — for example a
carousel heading at Heading 3 on phones and Heading 2 on the desktop, a hero
title, a section heading or a Heading block — now takes each breakpoint's line
height, weight and letter spacing from that breakpoint's token as well (until
2026-10-28 they stayed the first breakpoint's). A weight the block sets itself
still wins; a line height applies at a Custom (px) breakpoint only.

### Column gaps, column anchors, row alignment and more options

As above, every option below is empty by default, a page saved before them
looks as it did, and options marked *per breakpoint* are set on the
**Responsive** tab.

**Columns of 12** — on **Media and text**, the **Carousel split slide** and
**Stats** (with an image), once a layout on 12 columns is chosen:

- **Space between columns (px)**, *per breakpoint*. Left empty, the gap is the
  page's side gutter, as before; set it (for example 16 px) to keep the
  columns where you place them whatever the gutter.
- **Columns aligned to** (**Media and text** and the split slide, with
  **Advanced layout (columns of 12)**): **The media side** (default) keeps a
  row with the media on the right ending at column 12 — for example text in
  columns 2–6 and media in 8–12. **Start (column 1)** starts the pair at column
  1 on either side — text 1–5 and media 7–11 — and **End (column 12)** ends it
  at column 12.

**Row**: **Align columns** (top, middle, bottom) now places the columns on a
published page as it does in the editor; until 2026-10-28 each column stretched
to the row's height whatever was chosen. A row left on **Stretch** (the
default) looks as before. A row saved with `center` — the word **Media and
text** uses for the same choice — is read as middle.

**Call-to-action card**:

- **Side by side from: Desktop (1024 px)** now keeps a two-column list in one
  column on a tablet as well, while the card is stacked; a card side by side
  from the tablet keeps its two columns from 768 px.
- **Space below the heading**, a step of the spacing scale (16 px by default).
- **Text weight**, and **Max text width** (a named measure or Custom px, *per
  breakpoint*), for the card's text.

**Stats**: **Value line height**, *per breakpoint*, with a Custom value size. A
breakpoint below the first Custom one keeps the value size's own line height.

**Media and text**: **Item text size** (a type token or Custom px, *per
breakpoint*) and **Item text weight** for every feature item's text (15 px and
muted by default).

**Rich Content**: **Text weight**; its lists follow it.

**Feature list**:

- **Icon position** is set *per breakpoint* — for example beside the title on a
  tablet and above it from 1024 px. One position saved before applies to every
  breakpoint.
- An item's **Width on desktops (columns of 12)**: from 1024 px the list is
  laid out on 12 columns, that item spans its width and the others keep their
  share of the **Columns** (for example 6 of 12 with two columns).
- **Title weight** was already set per breakpoint.

**Carousel**, **Product slider**, **Product grid** and **Latest posts**: the
header's **Heading line height**, *per breakpoint*, with a Custom heading size;
a breakpoint below the first Custom one keeps the heading size's own. **Latest
posts** also takes a **Lead weight**.

**Link list**: **Row title line height**, *per breakpoint*, with a Custom row
title size.

**Newsletter sign-up**: a **Button icon** from the icon catalog after the
button's label (none by default).

**Testimonial**: **Quote size** — a type token or Custom px, *per breakpoint*
(1.15 rem by default).

**Download tile** (with the round icon button): **Icon button icon**, a glyph
from the icon catalog — for example the cloud download added to the catalog;
left empty, a file's tile shows the download arrow and a link's tile the arrow
pointing on.

### Box margins and padding per breakpoint

**Outer spacing** (margin) and **Inner spacing** (padding) of every block that
has them are set per breakpoint on the **Responsive** tab: choose Base
(mobile), Tablet or Desktop in its **Scope settings** and enter the values for
that breakpoint, for example 16 px below a heading on phones and 32 px on the
desktop. A breakpoint without its own value takes the one below it.

### Full-width buttons and a chevron "read more"

- **Full-width buttons.** A **Button** block has a **Width** on the **Responsive** tab: **Fit the
  label** (the default) or **Full width**, which stretches the button across its box. Set it per
  breakpoint, for example full width on phones and fitted from the tablet up. The blocks with a
  list of buttons — **Hero**, **Media and text**, **Call-to-action card**, **Background image
  panel** and the **Carousel split slide** — have a **Button width** for the whole list:
  at **Full width** the buttons stack, each across the box. Left unset, the buttons look as before.
- **"Read more" as a chevron.** In rich text, put the cursor in a "read more" passage and press
  **Read more as a chevron** (⌄) in the toolbar. The passage then opens with a bare chevron
  instead of its summary line, and the chevron turns when it opens. The summary text stays the
  control's name for screen readers, so keep it meaningful ("Show the details"). In the editor
  the summary stays visible and editable. Press the button again to go back to the text summary.

### "Read more" placement, accordion look and highlight colours

- **Where the "read more" sits.** With the cursor in a "read more" passage, **Read more
  position** in the rich-text toolbar puts its summary — the text or the chevron — at the
  **Start** of the line (the default), in the **Center** or at the **End**. **Show the revealed
  text above the summary** (⤒) makes the passage open upwards: while it is open, its text shows
  above the summary, which stays the one control under it. Only the order on screen changes:
  keyboard users and screen readers still meet the summary first, as before. A browser that
  cannot reorder a "read more" passage shows the text below the summary. In the editor the text
  stays below the summary, to edit, and an arrow before the summary marks the passage.
- **Accordion look.** An **Accordion** block has an **Icon** — **Plus and minus** (the default)
  or a **Chevron** that turns when its item opens, placed at the end of the title's line —,
  **Items** — **Plain**, **Boxed** (each item in a bordered box, its title and panel inset
  from the edge; left unset, the **Style** decides as before: *Bordered* is boxed) or
  **Filled** (each title on a softly tinted bar taken from the colour scheme — a faint dark
  tint on the light schemes, a faint light one on the dark scheme — with its panel inset
  below it, items 8 px apart and no dividers) —,
  **Dividers** for plain items — **None**, **Between items**, or **Above, between and below**
  (left unset, the **Style** draws its usual line under each item) — and a **Title padding**
  above and below each title on the **Responsive** tab: a spacing size or a **Custom** px value
  per breakpoint (12 px when not set). Every panel is still in the page's HTML, closed panels
  hidden until opened.
- **Accordion title colour, divider and icon size.** **Title color** (a brand colour or a hex
  value) colours every item's title and its icon; left empty, they keep the text's colour.
  **Divider position** draws the line of an item that has one **Under the item** (the
  default) or **Under the title**, so an open item shows its line between the title and the
  panel; with **Between items** the last title has no line, and boxed items are not affected.
  **Icon size** is **Small (16 px)**, **Medium (20 px)**, **Large (24 px)** or a **Custom (px)**
  value; left unset, the icon follows the title's text size as before.
- **Accordion spacing and title weight.** On the **Responsive** tab, **Space above the open
  panel** sets the space between an item's title (or its line, with the line under the title)
  and its open panel, and **Space between items** the space from one item to the next; each is
  a spacing size or a **Custom (px)** value per breakpoint. A breakpoint left unset keeps the
  usual spacing: no space above a panel (12 px under a title line), none between plain items,
  8 px between boxed or filled ones. **Space below the open panel** sets the space under an open
  panel's content (12 px when unset), and **Space after an open item** the space from an open
  item to the next title, used instead of **Space between items** while the item is open (a
  breakpoint left unset uses the space between items); both are a spacing size or a
  **Custom (px)** value per breakpoint and open and close with the panel. **Title weight** sets
  how bold every title is — **Default** (the usual semibold) or a weight from **Light (300)** to
  **Extra bold (800)** — once for every width or, on the **Responsive** tab, per breakpoint; a
  breakpoint below the first one with a weight keeps the usual weight.
- **Opening and closing animate.** A "read more" passage and an accordion item open and close
  with a short animation of their height. Visitors who ask their system for reduced motion see
  them open at once, and so do browsers that cannot animate to a content's own height. An
  accordion item open when the page loads does not animate in.
- **Highlight colours.** In a heading, a block's title or a caption, select a phrase and choose
  **Highlight colour** in the text's toolbar. Pick one of the **Brand colours** — the phrase
  then follows the brand screen's colour — or type or pick a **Custom colour (hex)**, and
  **Apply**. The phrase keeps its highlight style (accent, muted or gradient; accent when it had
  none) and reads in that colour; a gradient phrase becomes solid text in it. **Remove colour**
  takes the colour off and keeps the highlight. Choose a colour that keeps the text readable on
  its background. A translated heading keeps the highlight and its colour on the translated
  words.

### The settings panel

Every block's settings follow the same conventions, so a setting reads and
behaves alike wherever it appears:

- **Order.** The content first, then the layout, the look, spacing and borders,
  and **Hide on**. A text's **weight** sits next to its **size**, both on the
  **Responsive** tab, and is set per breakpoint like the size (a weight saved as
  one value keeps applying at every width).
- **Only what applies is shown.** For example the autoplay interval only with
  **Autoplay** on, the arrows' look only while **Show arrows** is on, the
  controls' placement only while arrows or dots show, the look of a disabled
  arrow only for a carousel that does not loop, a carousel image's caption look
  only once it has a caption, the image side only with an image, a row's
  **Vertical position** only with a **Minimum height**, the **Divider position**
  only where the accordion's items have lines, and **Muted** only for a video
  that does not play automatically (an autoplaying video file is always muted).
- **One switch for every on/off setting**, in place of Yes/No choices; it stores
  the same values, so saved pages are unchanged.
- **Alignment is per breakpoint** in the icons, social links, logo strip,
  feature list, stats, statement, hero and tabs, and reads **Left / Center /
  Right** everywhere (a side reads **Left / Right**). A value saved before
  applies at every width.
- **Gaps** are a spacing step or **Custom gap (px)**, per breakpoint, in the
  social links, logo strip, product grid and category grid too; a gap saved as a
  number of pixels opens as Custom with that number and renders as before.
- **Custom values in pixels** read "Custom … (px)", and every custom maximum
  width takes 160–2000 px.
- **Rounded corners** is the name of every corner setting; a block with two of
  them names each (**Image – rounded corners**, **Caption – rounded corners**).
- **Images and videos** offer the **Asset library** first, and a new image starts
  on it. An image saved with no source and a URL keeps its URL.
- **Links** in the image, icon, logo strip, announcement bar and map markers
  are the same link as a button's: a page, product, category, file, a section
  of this page or a URL, with **Open in new tab** (shown once the link leads
  somewhere). A URL saved before reads as a URL link with the same target and
  renders as before; the editor moves it into the new link when the block is
  opened. Every URL, here and in the social links, must start with `https://`,
  `http://`, `mailto:`, `tel:` or `/`, as in every other link: any other address
  (for example `javascript:`) renders the image, icon, logo or text without a
  link, and a social link without its address.
- **Item open at first** (accordion) and **Tab shown at first** (tabs) are
  chosen from the items' titles instead of typing a number.
- **New blocks follow the section's colours**: a new text and new icons or
  social links take the section's text colour, and a new announcement bar the
  brand's primary colour. Blocks already on a page keep theirs. The icons' and
  social links' **Color** then reads **Inherited (text color)**; picking a
  colour sets one, and **Inherit** returns to the text colour.
- **The settings are translated** in the admin's language, including the
  settings every block shares (name, **Hide on**, spacing, border, background,
  corners, shadow, typography), which are translated once for all blocks.

### Motion

Motion is opt-in and restrained:

- **Entrance reveal** of a Section (none or fade-up), and a block-level
  reveal on the hero and the statement (none, fade-up, or words appearing one
  by one); each can be limited to desktop.
- **Hover zoom** on carousel images, carousel split slides and link tiles.
- Carousel autoplay is off unless switched on, pauses on hover and focus, and
  has a pause button.

Nothing moves for a visitor who prefers reduced motion, and every text is in
the server-rendered HTML and visible before any script runs: the hidden
starting state is applied by a script only after the page has loaded, and
content already on screen is left as it is. The one exception the page cannot
control is an animated SVG chosen as the dark scheme's decorative backdrop: it
stops under reduced motion only if the SVG itself says so (see
[The decorative backdrop](./brand.md#the-decorative-backdrop)).

### Preview viewports

Puck Mobile / Tablet / Desktop frames use logical widths **360 / tabletMin /
max(desktopMin, 1280)**. Zoom is Puck’s built-in `transform: scale` inside an
iframe (`waitForStyles: true`). Prefer the viewport switcher over browser
resize when checking responsive props — CSS `@media` rules resolve against the
iframe width, while editing-tier JS uses the selected viewport width.

The content tree is persisted in a JSONB envelope:

```jsonc
{
  "schema_version": 1,
  "languages": {
    "pl-PL": { /* Puck Data tree */ },
    "en-US": { /* Puck Data tree */ }
  }
}
```

`schema_version` is bumped only when the storage shape of a node changes. The boot-time `content-schema-upgrader` walks every saved tree and rewrites nodes in place; current components start at `schema_version=1`.

## Translating content with AI

The Page Builder can machine-translate a canvas into the language of the tab
being edited, with a language model the operator chose. It is **off by
default**.

**Setting it up.** In **Settings → Page Builder**:

| Setting | Meaning |
| --- | --- |
| `cms.page_builder.translation.enabled` | Shows the **Translate** button. Default off. |
| `cms.page_builder.translation.llm_credentials` | The LLM configuration from the **Credentials** screen whose provider, model and API key the button uses. OpenAI, Anthropic, Google, DeepSeek and any OpenAI-compatible endpoint (through the configuration's Base URL) are supported. |
| `cms.page_builder.translation.max_source_characters` | The most text, in characters, one click may send — default 40 000, allowed 1 000–200 000. A higher limit translates longer pages at once but costs more per click and keeps the editor waiting longer on one request, which a slow provider or a proxy timeout can cut off. |

All three are platform-wide and apply to the next click without a restart. The
command palette (⌘K / CTRL+K → "translation") opens the Settings screen. A role
needs the permission **Translate Page Builder content with AI**
(`cms.translate`) to see the button; editing content still needs the content's
own write permission.

**What leaves the platform.** Only the texts of the canvas — headings,
paragraphs, button labels, list items, alternative texts and so on — are sent
to the chosen model's provider. Links, product and category references, block
codes, colours, custom HTML and scripts, editor-only block names and SEO fields
are never sent and never changed. Formatting inside rich text travels as
numbered tags and placeholders such as `{{customer.firstName}}` are checked to
come back unchanged; a text whose answer loses either keeps its original
wording.

**Using it.** The button sits in the Page Builder toolbar beside **Copy from
language** and names what it will translate:

- **Translate all content** — nothing is selected. By default the current tab's
  canvas is translated and its language is detected; the dialog can instead
  take another language tab as the source (its unsaved edits included), which
  replaces this tab's canvas.
- **Translate component** — a block is selected: that block and every block
  nested inside it. A block that has no translatable text disables the button.
- **Translate selection** — text is selected in a text or rich-text field:
  only those words. A selection that crosses formatting (part bold) or spans
  several paragraphs is translated as whole paragraphs, and the notice says so.

The result replaces the canvas as an **unsaved change**: read it, fix it and
save as usual, or click **Restore previous content** in the notice, which is
offered until the next save, translation or tab change. A translation can be
cancelled while it runs; a cancelled or failed translation leaves the canvas
unchanged.

**States.** With the setting off there is no button. Switched on without
usable credentials, or with the **Credentials** module switched off, the button
is shown disabled with the reason. Content above the size limit is refused
before anything is sent.

**Audit.** Every request that sent text to a provider — completed, partly
completed or failed — leaves one audit entry `cms.page_builder.translate` with
the editor, the content (type and id), the languages, the provider and model,
the number of texts and characters, the limit in effect, the scope and the
outcome. The text itself is never recorded.

## Sales-channel + language scoping

Every Page, Block, Template, and Hook is bound to one or more sales
channels (M:N join with the `code`/`slug` denormalised onto the join row
to enforce per-channel uniqueness at the DB level). The same `slug` may
exist in two channels — they're independent rows. Languages live as a
JSONB array on each entity; the storefront resolver follows the standard
platform fallback rule (requested → channel default → 404).

The admin's `ScopePicker` restricts the per-channel language list to
each channel's configured language set; saving a Page whose `languages`
includes a code unsupported by any assigned channel returns
`400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`.

## Seeded Hooks

23 base Hook codes are seeded with `is_system=true` at boot via an
idempotent reconciler. They cover the standard storefront insertion
points:

```
header.top
homepage.top, homepage.bottom
footer.before, footer.top, footer.bottom, footer.after, footer.copyright
category.top, category.bottom
product.top, product.bottom, product.buttons.after
search.top, search.bottom
page.top, page.bottom
cms.page.top, cms.page.bottom
login.top, login.bottom
register.top, register.bottom
```

Each `<Hook code="…" />` server component fetches
`/api/v1/cms/hooks/by-code` with the resolved channel + language and
renders every active attached Block in `position` order. Empty
attachments + failed fetches both render nothing — Hooks must not break a
page render.

## HTTP surface

### Admin (`/api/v1/admin/cms`)

| Method  | Path                                                | Purpose                                         |
| ------- | --------------------------------------------------- | ----------------------------------------------- |
| GET     | `/pages`                                            | Paginated Page list with filters.               |
| POST    | `/pages`                                            | Create a Page (always starts as `draft`).       |
| GET     | `/pages/:id`                                        | Detail with full content envelope + version.    |
| PATCH   | `/pages/:id`                                        | Edit metadata, including `parentPageId`, `parentPathInUrl`, `breadcrumbsVisible`, `breadcrumbsScheme`, `breadcrumbsOverlay`, `shareImageAssetId` and `translations` (the per-language name, slug and description, replaced whole); honours `If-Match` via `version`. A cyclic or too-deep parent answers `422 CMS_PAGE_PARENT_CYCLE`; an address another page has answers `409 CMS_SLUG_CONFLICT`. |
| PUT     | `/pages/:id/content/:language`                      | Save the Page Builder tree per language. A duplicate or reserved anchor answers `422 CMS_DUPLICATE_ANCHOR` / `CMS_RESERVED_ANCHOR`. |
| POST    | `/pages/:id/{publish,archive,unarchive}`            | Lifecycle transitions.                          |
| DELETE  | `/pages/:id`                                        | Hard delete (channels are cascade-unbound).     |
| Same    | `/blocks/*`                                         | Same shape; per-channel-unique `code`; reference-protected on delete. |
| Same    | `/templates/*`                                      | Same shape minus `active` flag.                 |
| GET     | `/hooks`, `/hooks/:id`                              | List + detail with attachment count.            |
| POST    | `/hooks`                                            | Create an admin (non-system) Hook.              |
| PATCH   | `/hooks/:id`                                        | Edit name / active / scope; `code` is immutable.|
| DELETE  | `/hooks/:id`                                        | Refused with 409 when `is_system=true`.         |
| GET / POST / PATCH / DELETE | `/hooks/:id/attachments[/:blockId]` | Attach / reorder / detach Blocks on a Hook.     |
| GET     | `/page-builder/config?salesChannelId=`              | Merged Page Builder descriptor (metadata only), with `brandTokens`: the effective brand set of the named channel, or the global set. |
| GET     | `/brand-tokens?salesChannelId=`                     | The global set, the named channel's override, the effective set and its contrast warnings. `cms.read`. See [Brand](./brand.md). |
| PUT     | `/brand-tokens`                                     | Save the global set or one channel's override (`tokens: null` resets it). `cms.brand`. |
| GET     | `/page-builder/translation`                         | Translation capability: `ready` (provider, model), `disabled`, `not_configured` or `unavailable`, plus the size limit. `cms.translate`. |
| POST    | `/page-builder/translate`                           | Translate a canvas (optionally one component or a selected text) into a language; nothing is stored. `cms.translate`. |

### Storefront (`/api/v1/cms`)

| Method | Path                              | Returns                                                        |
| ------ | --------------------------------- | -------------------------------------------------------------- |
| GET    | `/pages/by-slug?slug=…&language=…`| Resolved Page with `embeds.blocks`, `embeds.templates`, assets. `slug` takes the page's whole public path in any of its languages; a nested page's own slug also resolves.|
| GET    | `/blocks/by-code?code=…&language=…`| Resolved Block (single, channel-filtered, active-only).       |
| GET    | `/hooks/by-code?code=…&language=…`| Ordered active Block list for the named Hook.                  |

The resolved Page also carries `path` (its public path in the channel and the
served language), `url` (that path as the storefront links it, under the
language's path prefix), `alternates` (`{language, url}` for
every language it is served in), `name` in the served language,
`breadcrumbs` (`visible`, `scheme`, `overlay: true` only when the trail lies
over the first section, and the `trail` of ancestors, each
`{name, slug, path}` with `slug` and `path` null for one not published in the
channel), `share.imageUrl` and `languages`.

The brand tokens have their own public read,
`GET /api/v1/storefront/cms/brand-tokens`: the effective set for the resolved
channel, with `cache-control: public, max-age=60`.

Channel resolution prefers the `X-Sales-Channel` header, then falls back
to the system-default channel. Language resolution prefers `?language=`,
then `Accept-Language`, then the channel's configured default.

## Storefront resolution + Redis cache

The single `StorefrontResolver` service answers all three storefront
read operations with one query for the root entity, one batched query
per embed type (`InsertBlock` / `InsertTemplate`) per recursion level,
and one batched call to `assetsLibrary.resolveUrl` for every embedded
asset. Recursion is capped at depth 3; cycles or deeper graphs degrade
to a `MissingComponentPlaceholder` rendered admin-side.

Resolved payloads are cached in Redis with a 5-minute TTL under three
key families:

```
cms:v1:page:<slug>:<channel>:<language>
cms:v1:block:<code>:<channel>:<language>
cms:v1:hook:<code>:<channel>:<language>
```

Invalidation runs on every Page / Block / Template / Hook write:

- Page write → drops `cms:v1:page:<slug>:*` for every slug the page is bound to.
- Block write → drops the block's own keys + every page-keyed and every hook-keyed entry (we don't yet track which pages or hooks inline which block; coarse drop is acceptable at platform scale).
- Template write → drops every CMS-namespace key.
- Hook / attachment write → drops the hook's keys.

### The storefront's own cache

The storefront keeps a second copy of every CMS read in Next's Data Cache for
60 seconds, tagged from `CMS_STOREFRONT_CACHE_TAGS` in
`@endora-commerce/contracts`. Dropping the Redis keys alone would leave that
copy standing, so after a write has committed and the Redis keys are gone the
module publishes `cms.content_changed.v1` on the EventBus and answers it
itself by posting the matching tags to the storefront's `/api/revalidate`:

| Write | Tags revalidated |
| --- | --- |
| Page | `cms:page:<slug>` for every slug of the page, `cms:page-index` |
| Block | `cms:block:<code>`, `cms:page`, `cms:hook` |
| Template | `cms:page` |
| Hook / attachment | `cms:hook:<code>` |
| Brand settings | `cms:brand` — posted straight after the save commits, not through the event |

The manual cache flush on the Settings module's cache screen revalidates the
same tag through its `cms-brand` namespace.

A saved or published page is therefore the next request's page: the write
dispatches the change in an EventBus scope and answers only once the storefront
has dropped the tags, so even a request sent the moment the save returns gets
the new content. Revalidation needs `STOREFRONT_BASE_URL` and
`REVALIDATE_SECRET` on the backend and **the same** secret on the storefront;
without them it is skipped and the 60-second window is the fallback (the first
request after the window then still gets the previous render once, while the
storefront refetches). It is best-effort: a storefront that cannot be reached,
does not answer within 3 seconds, or refuses the call is logged and never fails
the save. A refusal with status 401 means the two secrets differ.

Another module that caches CMS content inside an answer of its own subscribes
to the same event through `ctx.subscribe`; `megamenu` does, for the blocks a
menu inlines. The payload is `CmsContentChange`: the kind (`page`, `block`,
`template`, `hook`) and the slugs or codes that changed.

Performance target: page resolution with 5 embedded Blocks + 3 embedded
Templates returns in &lt; 200 ms p95 cold; warm path returns in &lt; 5 ms.

## Migration from legacy `cms_pages`

Previously, `cms_pages` carried `path` + `body` (per-language HTML) and a
`status` enum. Migration `20260505T130214_cms_init.ts` adds the new column set
(`slug`, `name`, `active`, `content`, `languages`, `version`, `meta_*`)
and backfills every row idempotently:

- `slug = path`
- `name = title['en-US']` (best effort)
- `active = (status = 'published')`
- `content` envelope built from `body` with each language's HTML wrapped in a single `Text` node carrying `tiptapHtml`
- `languages` array = non-empty body keys
- bound to the platform's default sales channel via `cms_page_sales_channels`

Re-running the backfill against a partially-migrated state is a no-op.
The legacy `path`, `title`, and `body` columns survive for one release as
mirrors; the asset-ref scan covers `body` for backward compatibility.

## Extending the Page Builder

Other modules declare their blocks in their own manifest and ship the renderers
in their own package. See the
[Extending the Page Builder](./extending-page-builder) guide: the manifest
declaration, the three renderer layers and the block stylesheet.

## Error codes

`CMS_PAGE_NOT_FOUND`, `CMS_BLOCK_NOT_FOUND`, `CMS_TEMPLATE_NOT_FOUND`,
`CMS_HOOK_NOT_FOUND`, `CMS_SLUG_CONFLICT`, `CMS_CODE_CONFLICT`,
`CMS_REFERENCED`, `CMS_HOOK_SYSTEM_PROTECTED`,
`CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`, `CMS_SCHEMA_UPGRADE_FAILED`,
`CMS_DUPLICATE_ANCHOR` and `CMS_RESERVED_ANCHOR` (422, with `details.anchor`),
`CMS_PAGE_PARENT_CYCLE` (422), and for the
translation `CMS_TRANSLATION_DISABLED`, `CMS_TRANSLATION_NOT_CONFIGURED`,
`CMS_TRANSLATION_UNAVAILABLE` (409), `CMS_TRANSLATION_TOO_LARGE` (413, with the
configured `limit`), `CMS_TRANSLATION_SELECTION_NOT_FOUND` (422) and
`CMS_TRANSLATION_PROVIDER_FAILED` (502, `details.code` one of
`credentials_rejected`, `rate_limited`, `unavailable`, `timeout`, `malformed`).

All envelopes follow the platform-wide error contract in
`packages/contracts/src/errors.ts`.
