---
'@endora-commerce/mod-cms': minor
---

`cms` resolves its own asset embeds, through `assets_library`' published port.

`cmsAssetResolver` was a **contribution point**: the module registered the name
defaulted to `undefined`, and a composition root was expected to build the closure
out of `assets_library`' service and contribute it. It is the module's own
registration now, over `lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort')`,
with the edge already declared in this module's manifest `dependencies`.

**If your composition contributed `cmsAssetResolver`, you no longer have to**, and
you no longer should. Contributing it still wins — `contribute` overwrites, and the
registration is read from the cradle per call — but the closure you were writing is
a raw hold on another module's service, which is what the port replaces:

```diff
-composedModules.contribute({
-  cmsAssetResolver: async (assetId: string) => {
-    try {
-      const detail = await assetsLibrary.handle.service.getAsset(assetId);
-      return { url: detail.url, mimeType: detail.mimeType, filename: detail.filename,
-               label: detail.label, visibility: detail.visibility };
-    } catch {
-      return null;
-    }
-  },
-});
+// Nothing. `cms` registers it.
```

**What changes for a running platform**: a composition that never contributed the
name resolved every CMS asset embed to `{}`. That was this repository's own test
harness — `composition.ts` contributed it and `test-server.ts` did not — so a CMS
storefront response under test carried no asset detail at all, quietly, an empty
map being a plausible answer rather than a wrong one. There is no composition in
which the name is unset any more, and `CmsCradle.cmsAssetResolver` is
`CmsAssetResolver` rather than `CmsAssetResolver | undefined`.

The `catch` that answers `null` for an asset the library no longer has is kept —
`getAsset` throws 404 for a row that is gone, and a page embedding a deleted asset
renders without it — with `rethrowIfModuleDisabled` as its first line, so it cannot
also absorb the owner's refusal.

Three packages are touched with no release meaning of their own, and all three are
comments: `@endora-commerce/mod-assets-library`, whose barrel recorded the drain
condition this change meets; `@endora-commerce/mod-pim-ergonode`, whose barrel
described `assetsLibraryService` as a live composition-root bridge; and
`@endora-commerce/contracts`, where `AssetsLibraryPort`'s doc block named
`pim_ergonode` as its only consumer. The interface itself is unchanged — `cms`
takes `getAsset` and nothing was added to admit it, which is what publishing one is
for.
