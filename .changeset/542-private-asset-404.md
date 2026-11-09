---
'@endora-commerce/mod-assets-library': minor
---

**Behaviour change for HTTP consumers** (issue #542): `GET /assets/file/<asset id>` now answers a request for a **private** asset that carries no signature, or an expired or invalid one, with `404 ASSET_NOT_FOUND` — the same status, code, body and headers as an id that names nothing. It answered `403 ASSET_ACCESS_DENIED`, which let anyone holding an id confirm that a private asset exists. The permalink form already answered `404`. A soft-deleted private asset answers `404` without a valid signature and `410 ASSET_GONE` with one, as before.

A client that branched on `403` / `ASSET_ACCESS_DENIED` from the file route to mean "exists but needs a signed link" must treat `404` as "missing or not visible without a signature" and obtain a signed URL (`GET /api/v1/admin/assets/:id/url`, or the URL `AssetsLibraryPort` hands out) as before. The `ASSET_ACCESS_DENIED` code stays in `ERROR_CODES` of `@endora-commerce/contracts`; the file route no longer emits it. No exported TypeScript shape changes.
