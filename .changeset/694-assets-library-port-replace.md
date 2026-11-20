---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-assets-library': minor
---

`AssetsLibraryPort` gains `replace(input: AssetReplaceInput): Promise<AssetDetail>`, and
`@endora-commerce/contracts` exports `AssetReplaceInput` (`assetId`, `filename`, `declaredMime`,
`stream: AssetUploadStream`, `declaredSize`, optional `expectedContentVersion`). It replaces an
asset's file in place, as `POST /api/v1/admin/assets/:id/replace` does — except that the route's
pre-checks (the administrator visibility check) are not part of the port: the asset keeps its id,
storage key and every URL already handed out, answers a new `contentVersion`, and keeps the replaced
file as its previous version. It runs Command `asset.replace` and refuses with the route's
`HttpError` codes — `ASSET_NOT_FOUND`, `ASSET_GONE`, `ASSET_LEGACY_CANNOT_REPLACE`,
`ASSET_REPLACE_KIND_MISMATCH` and `ASSET_REPLACE_CONFLICT`. A module keeping an asset in step with
an external source should call it instead of uploading a new asset and soft-deleting the old one,
which changes the URL and loses the previous version.

The method is required on the interface, so a hand-written `AssetsLibraryPort` (a test fake, for
example) has to add it.
