---
'@endora-commerce/mod-cms': minor
---

The CMS contributes the Page Builder canvas to the catalogue's new `product.content.editor` admin zone (`specs/172-product-content-attributes/`): the full block palette and the **Translate** action, for one product content attribute in one language. The catalogue owns the document and the save; the contribution never saves, and it needs the CMS module's read permission. With the CMS off the zone has no member and product content is not rendered on the storefront.
