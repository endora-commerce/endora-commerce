---
'@endora-commerce/mod-quick-order': patch
---

A default ordering address must now be one of the target organization's own, live addresses (`addresses`). `PUT /api/v1/quick-order/preferences` and `PUT /api/v1/admin/quick-order/preferences` refuse any other address — the buyer's personal-book (`customers`) address, or another organization's — with `403 ADDRESS_NOT_OWNED`, the code `orders` uses, instead of failing on the preference table's foreign key with a 500 (issue #769). The resolved defaults likewise accept organization-book addresses only, so the module no longer reads `customerAddressReadPort`: the `customers` non-binding dependency and the exported `customerAddressesOrAbsent` helper are removed.
