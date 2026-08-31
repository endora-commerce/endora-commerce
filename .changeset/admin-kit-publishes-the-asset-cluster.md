---
'@endora-commerce/admin-kit': minor
---

Publishes the Assets-Library picker cluster: `AssetPicker`, `AssetUploader` and
`AssetFieldPicker` on `./components`, `toAbsoluteAssetUrl` on `./lib`, and the three
requests they make (`listAssets`, `fetchAssetDetail`, `uploadAsset`) beside them on
`./components`.

They were the last of feature 091's Group A pickers, left unpublished because
`AssetFieldPicker`'s module knowledge was a **component** — `assets_library`' own
`AssetPicker` — rather than a request, so there looked to be nothing to rebuild.
Measured, `AssetPicker` is one `GET`, `AssetUploader` is one multipart `POST` over the
`apiBaseUrl` this package already publishes, and every type all three name
(`AssetSummary`, `AssetDetail`, `ListAssetsResponse`) is `@endora-commerce/contracts`'.
So the cluster took the same exit the three data pickers took: the components build
their own requests and hold no module code.

**If you rendered a picker through the admin's `@/modules/assets_library/…` paths**,
name the package instead — those files are gone, and the shim that remains is at
`@/components/asset-picker/AssetFieldPicker` only.

```diff
-import { AssetPicker } from '@/modules/assets_library/components/AssetPicker';
-import { AssetUploader } from '@/modules/assets_library/components/AssetUploader';
-import { toAbsoluteAssetUrl } from '@/modules/assets_library/lib/asset-url';
-import { assetsLibraryClient } from '@/modules/assets_library/api/assets-library-client';
+import {
+  AssetPicker,
+  AssetUploader,
+  fetchAssetDetail,
+} from '@endora-commerce/admin-kit/components';
+import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
```

`AssetUploader`'s `defaults` prop is typed `AssetUploadFields` rather than the module
client's `UploadFields`; the shape is unchanged. `assetsLibraryClient.uploadAsset` and
its `UploadFields` type are removed from the admin's own client, which had no caller
left once the uploader moved — a second live copy of one multipart `POST` is not
something to keep.

**The components' copy is `core`'s now, not `assets_library`'s** (R-1). A translation
namespace is module knowledge on the same test that permits an HTTP path: the schema
crossing a path is in a peer dependency both sides compile, and a bundle is not — it is
shipped by a module package this one may not depend on, and a key that did not travel
renders `core.assetPicker.empty` at the operator rather than failing to compile. The
eleven keys the two components read moved: three reuse `core`'s existing
`common.action.close`, `common.state.loading` and `common.action.search` (the last added
to that family), and eight are new under `assetPicker.*`. Rendered output is unchanged in
both shipped languages.

**If you translate this admin**, `assets_library`'s bundle loses nine keys —
`common.close`, `picker.empty`, `picker.searchPlaceholder`, `picker.uploadNew` and the five
`uploader.*` — and `_i18n`'s gains nine. `uploader.triggerCurrentFolder`, `common.loading`
and `common.search` stay where they are: the module's own screens still read them.
