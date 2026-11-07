---
'@endora-commerce/contracts': patch
---

Adds `ATTRIBUTE_FILTER_KEY_PATTERN` (`/^[a-z0-9_]+$/`), the shape of `<key>` in a product listing's `filter[attr.<key>]=<value>` (issue #687). Every attribute key `createAttributeRequestSchema` admits matches it.
