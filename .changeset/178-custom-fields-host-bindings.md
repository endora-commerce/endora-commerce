---
'@endora-commerce/mod-custom-fields': patch
---

The host storage binding reads `CUSTOM_FIELD_HOST_BINDINGS` from `@endora-commerce/contracts` instead of a module-internal copy (`specs/178-extensible-columns/` FR-010). Same tables, same columns; no behaviour change.
