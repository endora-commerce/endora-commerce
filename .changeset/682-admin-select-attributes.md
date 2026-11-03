---
'@endora-commerce/mod-catalog': patch
---

Catalog → Attributes in the admin now handles `select` (dropdown single-select) attributes. When
you edit one, the locked Type field shows `select` instead of `string`, and the options editor is
shown so you can add, rename and remove its options, as for `enum` and `multiselect`. `select` can
also be chosen when you create an attribute, with its initial options entered as comma-separated
values.
