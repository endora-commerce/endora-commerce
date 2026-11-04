---
'@endora-commerce/mod-custom-fields': minor
---

The `page_builder` value type (`specs/172-product-content-attributes/`) is admissible only on entity types whose registry entry carries the new `pageBuilderValues` marker, which only `product` does. Creating such a definition on any other entity type is refused with `value_type_unsupported`, and changing a definition's value type to or from `page_builder` with `value_type_locked`. A `page_builder` value never coerces (`wrong_type`) and offers no list-filter operator. The generic definition form does not offer the type.
