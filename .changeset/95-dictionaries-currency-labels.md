---
'@endora-commerce/mod-dictionaries': patch
---

The seeded English labels of the Polish zloty and the Icelandic krona are spelled as ISO 4217
spells them in English (`Polish zloty`, `Icelandic krona`). Only a fresh install sees the
change — the reconciler never rewrites an existing currency row — and the Polish name
(`Polski złoty`) is a translation row, unchanged.
