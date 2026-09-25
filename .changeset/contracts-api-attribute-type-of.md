---
'@endora-commerce/contracts': patch
---

Adds `apiAttributeTypeOf(valueType, displayAsSlider)`, exported beside `attributeValueTypeSchema` and `apiAttributeTypeSchema`: the one definition of how a stored attribute value type and its slider flag project onto the API attribute type. A slider flag on `number` or `price` answers `slider` and is ignored elsewhere; `string`, `boolean` and `date` answer `input`; `enum` and `select` answer `select`. Nothing existing changes.
