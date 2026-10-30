---
title: Page navigation
sidebar_label: Page navigation
sidebar_position: 4
description: A Page Builder block of jump links to the sections of the same page, highlighting the section in view, optionally sticky
---

# Page navigation

The **Page navigation** block is a row of links to the sections of the page it
sits on — "jump links". A shopper clicks *Offer* and the page scrolls to the
offer section; while they scroll, the link of the section in view is
highlighted. Use it at the top of a long page: a company page, a product
family page, a guide.

You find it in the Page Builder's block list under **Interactive**.

## Pointing the links at sections

Each link has a **Label** (the text shown) and a **Section anchor** (where it
leads).

1. Give every section you want to link to an anchor: select the **Section** and
   fill in its **Anchor** setting, for example `about`, `offer`, `contact`.
2. In the Page navigation block, add a link per section. Its **Section anchor**
   field lists the anchors of the sections on the page under *Sections on this
   page*; pick one. You can also type an anchor: it is tidied up when you leave
   the field (lower-case letters, digits and hyphens, starting with a letter).

Any element of the page with that id is a valid target, not only a section. If
no element on the canvas carries an anchor a link points at, the block shows a
warning under it in the editor; the link is still published.

A link with no label, or with an anchor that does not follow the rules above,
is not shown. A block holds at most 20 links. With no valid link at all, the
block shows nothing on the storefront and a note in the editor.

## Options

| Option | What it does |
| --- | --- |
| **Accessible name** | The name screen readers announce for the navigation. Empty: "On this page", in the page's language. |
| **Look** | **Pill** (default): the links sit in one rounded track and the active link is filled with the primary colour — inside a section with a colour scheme, with the scheme's text colour. **Underline**: a line under the bar and a thicker line under the active link. |
| **Stick to the top while scrolling** | Keeps the bar visible below the storefront header while the shopper scrolls. |
| **Align** | Left, center or right, per screen size (Responsive tab). |
| Outer and inner spacing, border | As on other blocks, per screen size. |
| **Hide on** | Hides the block on chosen screen sizes. |

The colours follow the brand settings and the colour scheme of the section the
block is in; there is no colour option of its own.

## How it behaves on the storefront

- **Without JavaScript** the block is a plain list of links in a `nav`
  landmark: every link still jumps to its section.
- **With JavaScript** the link of the section in view is highlighted and
  marked as the current one for assistive technology (`aria-current`). Exactly
  one link is highlighted at a time; when you scroll past the last linked
  section, it stays highlighted.
- **Smooth scrolling**: following a link scrolls smoothly, unless the
  shopper's device asks for reduced motion — then the jump is instant.
- **Sticky bar**: a jumped-to section starts below the storefront header and
  the bar, so its heading is never hidden behind them.
- **Phones**: when the links do not fit, the list scrolls sideways inside the
  block (the page itself never scrolls sideways), and the highlighted link is
  brought into view.
- Keyboard users reach every link with Tab; the focused link has a visible
  outline.

## Placing it inside a tab, a slide or a section

The block can sit anywhere a block can, including a tab panel or a carousel
slide. **Sticky** keeps the bar visible only inside its container: placed
directly on the page it stays for the whole page; inside a section, a tab or a
slide, it stays only while that container is on screen. For a bar that follows
the shopper down the whole page, place the block directly on the page, between
sections.

## Translation

The link labels and the accessible name are translated with the rest of the
page (Page Builder translation); the anchors are identifiers and are never
translated.
