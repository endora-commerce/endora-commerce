---
'@endora-commerce/admin-kit': patch
---

The asset upload now goes through the kit's 401 handling (issue #354). `uploadAsset` posts through the new `postMultipart` helper, exported from `./lib`. An expired session now notifies the `onUnauthorized` listeners and sends the operator back to sign in, and every failed upload is an `ApiError` instead of a plain `Error`. `AssetUploader` shows the server's message for a refused upload. `createApiClient` sends a `FormData` body as multipart instead of as JSON, and without a `fetchFn` it now looks up the global `fetch` on each request rather than once at creation.
