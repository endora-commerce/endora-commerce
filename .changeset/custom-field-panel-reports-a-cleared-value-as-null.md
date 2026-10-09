---
'@endora-commerce/admin-kit': patch
---

`CustomFieldValuesPanel` reports a cleared number, date or select as `null` instead of `undefined`.

The hosts send the edited bag as JSON, which omits a key whose value is `undefined`, and the server keeps the stored value of a key the request does not name. Clearing one of those three field types on a customer, organization, order or quote request and pressing *Save* therefore reported success and left the old value in place. `null` survives serialisation and is what the server reads as "clear this".

A host that reads the bag handed to `save` or `onChange` now sees `null` where it saw `undefined` for a cleared number, date or select. Text (`''`) and multiselect (`[]`) are unchanged.
