---
'@endora-commerce/mod-settings': minor
---

`400 SETTING_VALUE_SHAPE_MISMATCH` says what the setting accepts. Two refusals share the code — a
value of the wrong type, and a value an enumerated setting does not offer — and both were answered
with "Setting value does not match the required shape.", while the messages that sentence replaced
named the expected type and listed the options.

Each refusal now names itself in `details.code` and has its own sentence, in English and Polish:

- `wrong_type` — `details.settingCode`, `details.valueType`: "The value of "inventory.threshold"
  must be of type "number"."
- `not_an_option` — `details.settingCode`, `details.allowedValues` (the options joined with ", "),
  `details.enumOptions` (the same options as an array): "The value of "pricing.display_mode" must
  be one of: gross_only, net_only, both, none."

**One shape changes for a client that read `details`.** The wrong-type refusal used to answer
`details` as a bare array of `{ path, issue }`; that array is now `details.issues`, inside the
object that carries the fields above. The option refusal used to carry no `details` at all. The
code and the status are unchanged.
