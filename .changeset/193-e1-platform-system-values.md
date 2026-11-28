---
'@endora-commerce/platform': minor
---

`FormRegistry.seal` refuses a deployment tightening that rejects one of a field's declared `systemValues` with the composition code `rule-excludes-system-value` (`specs/193-admin-form-extensions/` D-300.31). The refusal names the declaring module, the field and the value. A value is checked against the merged rule as the field-rule check would check it, and an empty value against a tightened `required`. A configuration that would make an owner's own system write fail at run time is therefore refused at boot. It is additive: a field without `systemValues` is sealed as before.
