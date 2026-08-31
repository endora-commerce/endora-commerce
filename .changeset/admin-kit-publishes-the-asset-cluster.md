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

Both components resolve their copy through `useTranslation('assets_library')`, so the
strings stay in the owner's bundle and nothing about the rendered output moves.
