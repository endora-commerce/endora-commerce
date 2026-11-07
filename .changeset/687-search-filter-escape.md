---
'@endora-commerce/mod-search': patch
---

The Meilisearch filter expression escapes `\` before `"` in attribute filter values and in the category slug, so a value ending in a backslash is one literal instead of a refused query and a Postgres fallback (issue #687). `buildFilterExpression` refuses an attribute key that does not match `ATTRIBUTE_FILTER_KEY_PATTERN` with `400 VALIDATION_FAILED`.
