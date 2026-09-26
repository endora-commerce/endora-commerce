---
'@endora-commerce/mod-pim-ergonode': patch
'@endora-commerce/mod-comarch-xl': patch
'@endora-commerce/mod-ksef': patch
'@endora-commerce/mod-infakt': patch
---

These modules decide whether to build and register their queue consumers from the platform's `processRunsWorkers` host value. `pim_ergonode`, `pim_pimcore` and `comarch_xl` no longer resolve their own `*RunWorkers` flag, and `ksef` and `infakt` no longer read `BACKEND_ROLE` themselves. (`pim_unopim` made the same move and left this repository with feature 134 before a release carried it; its version with the change is cut from the paid-modules repository.)

Behaviour in production is unchanged — `composeApp` derives `processRunsWorkers` from `BACKEND_ROLE` exactly as those reads did. A composition that registers the module itself must now register `processRunsWorkers` (the platform's `composeApp` and the test kit's `composeTestServer` both do); a hand-built container in a test that registered one of the old flags should register `processRunsWorkers` instead. The modules require a platform release that registers it.

`@endora-commerce/mod-pim-pimcore` carries this change as well; it has left for the paid-modules repository, and its next version is cut there.
