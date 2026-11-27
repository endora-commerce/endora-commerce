---
'@endora-commerce/test-kit': minor
---

`composeTestServer` builds the side-table loader registry from the composed manifests' `extends`, hands it to `composeModules` and registers `entityExtensionReads`, exactly as `composeApp` does (`specs/187-side-table-extensions/` B1), so a module's `ctx.entityExtensionLoaders` and a host port's `include` work in a test composition.
