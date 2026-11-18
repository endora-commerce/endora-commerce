---
'@endora-commerce/page-builder-core': patch
---

`enhancePageBuilderComponent` now handles a component whose `resolveFields` returns a Promise, which Puck allows (issue #1027). Before, it spread the Promise itself, so the editor showed the Name field alone and dropped every field the component resolved. Synchronous `resolveFields` behaves as before.
