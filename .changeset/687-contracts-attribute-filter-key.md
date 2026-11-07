---
'@endora-commerce/contracts': patch
---

Adds `attributeKeyShapeSchema`, the shape of an attribute key (snake_case starting with a letter, at most 64 characters), and `isAttributeKey(key)` (issue #687). `createAttributeRequestSchema` now takes its `key` rule from `attributeKeyShapeSchema`; what it accepts is unchanged.
