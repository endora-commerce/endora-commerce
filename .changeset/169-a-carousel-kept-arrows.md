---
'@endora-commerce/cms-components': patch
---

Carousel arrows kept with **Keep the arrows when all slides fit** (`controls.arrowsWhenFit`) are legible again. Every carousel block (`cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts`, and split slides drawing the controls) still rendered both arrows, disabled, but drew them with the generic dimmed look — 40 % of an already light ring — so on a light or muted section, or over a slide, they were next to invisible. While the arrows are kept because everything fits, the shell now adds `cmsc-pb-carousel--arrows-kept` to the carousel root, and the stylesheet draws such a disabled arrow at full opacity on the colour scheme's background with its border and muted text colour (`--cmsb-bg`, `--cmsb-border`, `--cmsb-fg-muted`, today's literals outside a scheme). An explicit **Disabled arrow look** (light outline or colour) still wins. A carousel with the option off renders the same markup as before.
