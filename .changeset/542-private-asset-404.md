---
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/contracts': minor
---

**Behaviour change for HTTP consumers** (issue #542): `GET /assets/file/<asset id>` now answers a request for a **private** asset that carries no signature, or an expired or invalid one, with `404 ASSET_NOT_FOUND` — the same status, code, body and headers as an id that names nothing. It answered `403 ASSET_ACCESS_DENIED`, which let anyone holding an id confirm that a private asset exists. The permalink form already answered `404`. A soft-deleted private asset answers `404` without a valid signature and `410 ASSET_GONE` with one, as before.

A client that branched on `403` / `ASSET_ACCESS_DENIED` from the file route to mean "exists but needs a signed link" must treat `404` as "missing or not visible without a signature" and obtain a signed URL (`GET /api/v1/admin/assets/:id/url`, or the URL `AssetsLibraryPort` hands out) as before.

**Removed export:** nothing raises `ASSET_ACCESS_DENIED` any more, so `ERROR_CODES.ASSET_ACCESS_DENIED` is removed from `@endora-commerce/contracts`, together with the module's manifest declaration and its `errors.ASSET_ACCESS_DENIED` translations. Code that compared an error's `code` against `ERROR_CODES.ASSET_ACCESS_DENIED` no longer compiles; drop the comparison, or compare against `ERROR_CODES.ASSET_NOT_FOUND` if the intent was "the file route refused this id".
