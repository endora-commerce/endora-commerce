---
'@endora-commerce/mod-i18n': patch
---

Removes two shared admin strings nothing reads any more: `returns.filter.rmaNumber` and `returns.search.placeholder` (en, pl). The returns list's search box now searches by RMA number, case reference or full contact e-mail, and its label, placeholder and chip are the `returns` module's own `list.search.*` keys (`specs/181-guest-complaints/` design review A-2). An overlay that translated either removed key can drop its entry.
