---
'@endora-commerce/admin-kit': patch
'@endora-commerce/admin-shell': patch
---

Both packages now declare `"sideEffects": ["*.css"]` in `package.json`. No JavaScript file in either package does anything when it is imported, so a bundler can drop every barrel member a consumer does not use. The CSS files the packages ship (`theme.css`, `tailwind.css`) are still treated as side-effectful, so a stylesheet imported from JavaScript is kept.

The exported API does not change. In this repository's admin build, the entry chunk shrank from 2454.5 kB to 806.8 kB (gzip: 774.6 kB to 231.6 kB). A consumer that imported from the barrels gets a smaller bundle and does not need to change anything.
