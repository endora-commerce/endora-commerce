---
'@endora-commerce/mod-import-export': patch
---

A products import row that fills a column named after a Page Builder content attribute (`specs/172-product-content-attributes/`) gets a per-row error naming the attribute, and is not imported; the row's other cells are still validated. Products exports never carry content attributes.
