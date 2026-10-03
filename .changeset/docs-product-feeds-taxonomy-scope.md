---
'@endora-commerce/mod-product-feeds': patch
---

Documentation: the out-of-scope list no longer says runtime taxonomy downloads are excluded,
which contradicted the optional taxonomy check the same page documents. What stays out of scope
is adopting a downloaded taxonomy automatically: a fetched revision is installed inactive and
comes into use only when an operator promotes it.
