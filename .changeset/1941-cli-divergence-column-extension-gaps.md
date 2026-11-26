---
'@endora-commerce/cli': patch
---

`endora generate`'s divergence report no longer under-reports overlay column extensions
(issue #1941).

- A `defineColumnExtension` imported under another name
  (`import { defineColumnExtension as extend }`) is recorded as a `column-extension` entry, as the
  unaliased call is.
- A declaration whose columns are not literal keys of an object literal — a spread inside
  `columns`, a spread beside it, or a `columns` value held in a variable — is reported as
  `computed-subject` instead of being recorded with a partial or empty column list.
- When the resolved `@endora-commerce/contracts` exports no usable `CUSTOM_FIELD_HOST_BINDINGS`,
  the derivation stops with an error naming the mismatch. Before, it read as an empty owner map and
  reported every column extension as `unowned-subject`.
