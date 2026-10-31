---
'@endora-commerce/admin-kit': patch
---

`SalesChannelPicker` reports a list response with no `items` as a failed load again, instead of throwing at render. The translation change in the previous release moved the mapping out of the load's promise chain, so a malformed body stopped reaching its error handler and crashed the screen holding the picker.
