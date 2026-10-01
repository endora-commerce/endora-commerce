---
'@endora-commerce/cli': patch
---

`endora check`'s estate no longer lists `check:root-dispositions`. The rule held this repository's top-level entries to a disposition record used once, by the history filter that produced the public repository; it has been retired from the repository, and it was `repository-only`, so no module package was ever checked against it.
