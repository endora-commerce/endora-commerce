---
'@endora-commerce/mod-catalog': patch
---

The product editor's Variants tab chooses a variant's attribute values from the product's variant axes (issue #1457). It offers one field per attribute of the product's attribute set marked as a variant axis, with the attribute's options, instead of a free-text `key=value, key=value` field that nothing checked. Every axis needs a value, two variants of a product cannot have the same values, and values are stored in the attribute's own type. The table shows one column per axis with the option labels in the admin language. A variant's axis values can now be edited. The create row no longer asks for stock, which the Inventory tab holds per warehouse, and the remove button is an icon button named for the variant's SKU. When the set has no variant axis the tab says so and links to the attribute sets. The API is unchanged.
