---
'@endora-commerce/contracts': patch
---

New export `UUID_SHAPE_PATTERN`: the shape `isUuidShape` checks, as an unanchored regular-expression source that matches either case without a flag, for a pattern that has to find a uuid inside a longer value (an address, a `kind:id` token). `uuidShapeSchema`, `REFERENCE_TOKEN_SOURCE` and the record rich-text reader are built from it, so the package carries one spelling of a uuid's shape; what each of them accepts is unchanged (issue #781).
