---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-assets-library': minor
---

`AssetReadPort` gains `openAssetBytes(assetId)`, and `assets_library` answers it.

```ts
// new, on the existing `assetReadPort` container name
openAssetBytes(assetId: string): Promise<AssetBytes | null>;

// new exported type
interface AssetBytes { bytes: Uint8Array; mimeType: string }
```

The bytes of one live asset, buffered, with the MIME type they were stored under. It is the
question a composition root was answering for `invoices` — embedding the operator's logo in
an invoice PDF, which needs an inline `data:` URI because pdfmake resolves an `image:` by
fetching it, and fetching `/assets/file/<id>` from the process that is serving the request
deadlocks for a public asset and 403s for a private one.

**Absence is the answer, not an exception**, exactly as `resolvePublicUrls` states it. An id
that names no row, a soft-deleted one, a row on the `legacy` backend (a URL this library can
resolve and an object it cannot open) and a configured store that would not stream are all
`null`. The caller cannot tell "this asset is not there" from "the bucket did not answer",
so it is not the caller's decision to make.

**Here rather than on `AssetsLibraryPort`, and rather than left at the caller over
`ObjectStoragePort`.** It is a read, and a consumer that wants a logo must not thereby
acquire `upload`, `patchAsset` and `softDelete` — which is the argument `ObjectStoragePort`'s
own doc block makes in the other direction. A caller that opened the store itself would carry
three facts about this module's storage layout instead: that `legacy` has no `open`, that the
locator falls back to `storageUrl` when the column is empty, and that the stream has to be
drained.

`Uint8Array` and not `Buffer`, for the reason `AssetByteStream` gives: this package is
compiled by `@endora-commerce/admin-kit` with `types: ["vite/client"]`, so the `Buffer` global
is not in scope. `Buffer` satisfies the shape, so a Node caller passes one through unchanged.

**`minor` rather than `major`**, on this interface's own precedent: `resolvePublicUrls` was
added to it three days ago as a minor, and the reasoning holds here — the port's consumers are
callers, and its one implementer is the package that ships it, in the same release.
