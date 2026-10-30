---
'@endora-commerce/cms-components': patch
---

**Behaviour change for storefronts:** an empty listing block renders nothing. `catalog.ProductSlider`, `catalog.ProductGrid`, `catalog.CategoryGrid` and `catalog.CategoryList` that resolve no items on the storefront now return no element — no box, no header and no untranslated "No products found" / "No categories found" sentence — as `blog.LatestPosts` already did. The editor preview keeps its explanatory note. No block option was added.
