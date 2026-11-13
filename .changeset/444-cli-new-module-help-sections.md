---
'@endora-commerce/cli': patch
---

`endora --help` now lists every sidebar section `new module --admin` accepts, read from
`AdminNavSectionNameSchema` in `@endora-commerce/contracts` — the set the flag is validated
against — instead of a hand-written list that had gone stale and omitted `crm` and `work`.
