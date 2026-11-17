---
'@endora-commerce/admin-kit': minor
---

`@endora-commerce/admin-kit/lib` exports `defineEnumLabels(keys)`, with the types `EnumLabels<V>` and `EnumTranslate`. A module declares an enum once, as a map from each value its API sends to the catalogue key that names it. It then renders `labels.label(t, value)` and builds a filter from `labels.options(t)`. A value the map does not declare is shown as itself rather than as a missing-key placeholder, and an empty value is shown as a dash. Pass the published union as the type argument (`defineEnumLabels<RfqStatus>({ … })`) to make a missing value a type error.
