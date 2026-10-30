---
'@endora-commerce/cms-components': minor
'@endora-commerce/page-builder-admin': minor
'@endora-commerce/mod-cms': minor
---

New Page Builder block `cms.PageNavigation` ("Page navigation", category Interactive): a row of jump links to sections of the same page.

- **Storefront:** a `<nav>` with an accessible name around plain `<a href="#anchor">` links, so it works without JavaScript. A client island highlights the link of the section in view (`aria-current="true"`, `cmsc-pb-page-nav__link--active`), keeps it visible inside a list that scrolls sideways on narrow screens without moving the page, and, for a sticky bar, writes its height to `--cmsc-page-nav-h` so a jumped-to target clears the header and the bar. Following a link scrolls smoothly unless the reader prefers reduced motion. With no valid link the block renders nothing.
- **Options:** links (label and section anchor, at most 20), accessible name, look `pill` (default) or `underline`, alignment per breakpoint, "Stick to the top while scrolling", spacing, border, hide on. Colours come from the brand tokens and the section's colour scheme.
- **`@endora-commerce/cms-components`:** exports `PageNavigation`, `pageNavigationItems`, `PAGE_NAVIGATION_MAX_ITEMS`, `usePageNavigationSpy`, the `PageNavigationProps`/`PageNavigationItem` types, and a new optional render-context entry `pageNavigationText` (`CmsPageNavigationText`, hook `useCmsRenderPageNavigationText`) for the default accessible name in the page language. New stylesheet section `.cmsc-pb-page-nav*`.
- **`@endora-commerce/page-builder-admin`:** exports `createAnchorField(label)`, the link field's in-page anchor picker (the page's section anchors, or free text normalised to the anchor grammar) as a field of its own. The link field is unchanged.
- **`@endora-commerce/mod-cms`:** declares the block (translatable `label` and `items[].label`) with en/pl labels, and gives its links the anchor picker in the editor. Module documentation page *Page navigation*.
