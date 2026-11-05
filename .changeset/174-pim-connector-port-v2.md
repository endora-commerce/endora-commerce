---
'@endora-commerce/mod-pim-connector': minor
---

**Breaking for external connectors — locale mapping and the scope write port v2 (feature 174).**

A PIM's locales no longer map to a language scope: the connection's mapping names which locale writes Global and which channel and language each locale writes. A connector writes through `catalogProductScopeWritePort.applyScopes` v2 — cells `{ scope, field, value }` in the write encoding (absent = no change, `null` = deliberately empty, `{ "inherit": true }` = inherit). It may write the name, description, attributes, gallery alt text, attachment names and descriptions, packaging-unit names, status, publication window and URL key; every other field is refused per cell with `not_supported`. `catalogProductValueOverrideWritePort` and `seoMetaWritePort` are gone, so a connector built on them must move to v2 in this release.
