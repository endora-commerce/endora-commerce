---
'@endora-commerce/mod-promotions': patch
---

The promotion rule evaluator types an attribute's value type with the contract's `AttributeValueType` instead of a copied union, so it follows the vocabulary as it grows (`page_builder`, `specs/172-product-content-attributes/`). No behaviour change: a `page_builder` attribute is never a promotion rule.
