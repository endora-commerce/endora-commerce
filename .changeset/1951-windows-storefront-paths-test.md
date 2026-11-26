---
'@endora-commerce/cli': patch
---

`endora new storefront`'s tracked-file mapping is now `storefrontRelativePaths`, with a regression
test that proves the Windows case with `path.win32` (issue #1951). No behaviour change.
