---
'@endora-commerce/cli': patch
---

`HOST_INTERNAL_SUBPATHS` gains `packages` and `overlay`, each with the sentence saying why it
is not public API (`specs/110-instance-repository/` T113 and T114). Every consumer of
`@endora-commerce/cli/lib/platform-surface.js` derives the two classes from this record, so
`check:platform-surface`, `published-surface.test.ts` and `host-package.test.ts` all follow
without a second list. `PUBLISHED_SUBPATHS` is unchanged: nothing became public API.
