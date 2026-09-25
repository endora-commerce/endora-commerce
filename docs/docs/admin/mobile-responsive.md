---
title: Admin panel — mobile layout
---

# Admin panel — mobile layout

The Supplier admin panel is usable on smartphone browsers. There is no separate native app: the same React SPA adapts below the **`lg` breakpoint (1024px)**.

## Breakpoints

| Viewport | Shell |
|----------|--------|
| ≥ 1024px | Persistent sidebar (248px or 64px rail). `⌘B` / `Ctrl+B` toggles rail mode. |
| &lt; 1024px | Single-column layout. Hamburger opens an overlay navigation drawer. |

## Lists and tables

- **`ResponsiveTable`** — renders a standard table on desktop and **card rows** on mobile. Each list must mark at least one **primary** column for the card headline.
- **`b2b-table-scroll`** — fallback wrapper when a wide table cannot be cardified yet. Scroll is confined to the table region; the page itself must not scroll horizontally.

## Touch reorder

Surfaces that reorder rows via HTML5 drag also expose **Move up / Move down** buttons (`TouchReorderButtons`) with 44px hit targets.

## Page Builder (Puck)

The CMS/Blog Puck editors are scrollable on mobile. Precise drag placement may remain easier on desktop; document known gaps found during manual testing.

## QA checklist

Manual smoke: Chrome DevTools → iPhone 12 Pro (390px) or custom 320px width.
