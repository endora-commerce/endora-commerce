# Assets Library

The Assets Library is the platform's digital-asset substrate. It owns:

- A central catalogue of files (images, video, PDFs, documents) reusable
  across Product media, Product attachments, Category main images, and CMS
  pages.
- A folder tree for organising assets.
- Pluggable storage backends — Local filesystem, Amazon S3, GCP Cloud
  Storage — configured from Settings, exactly one active at a time.
- Public/private visibility per asset.
- Reference protection: assets in use by Catalog or CMS cannot be deleted
  until every reference is detached.

## Quick start

1. **Active adapter** — open Settings → Storage and pick one of `local`, `s3`,
   or `gcs`. Defaults to `local`.
2. **Local FS** — set `assets.local.base_dir` (default `var/assets`). The
   admin server creates the directory tree at upload time. Set
   `assets.local.public_url_base` if the backend is fronted by a different
   public hostname (e.g. behind a reverse proxy).
3. **Amazon S3** — set `assets.s3.bucket`, `assets.s3.region`,
   `assets.s3.access_key_id`, `assets.s3.secret_access_key`. Optional:
   `assets.s3.endpoint` (for S3-compatible providers like MinIO),
   `assets.s3.prefix`, `assets.s3.public_base_url` (CDN base URL prefix).
4. **GCP Cloud Storage** — set `assets.gcs.bucket` and either
   `assets.gcs.service_account_json` (paste the full JSON) or rely on
   ambient credentials. Optional: `assets.gcs.prefix`,
   `assets.gcs.public_base_url`.
5. **Test the connection** — `POST /api/v1/admin/assets/storage/self-check`.
   Returns `{ ok: true }` on success or `{ ok: false, reason: ... }` on
   misconfiguration. The dashboard is at `GET /api/v1/admin/assets/storage/state`.

## Upload constraints

Two settings gate uploads, both checked before any byte reaches the active
adapter:

- `assets.allowed_file_types` — list of file extensions or MIME types
  (e.g. `["jpg", "png", "image/jpeg", "application/pdf"]`). The sentinel
  `["*"]` (default) disables the gate. Wildcards like `image/*` match any
  MIME under that prefix. The check considers both the declared MIME and
  the magic-number-sniffed MIME (file-type) and rejects when either fails.
- `assets.max_file_size_mb` — integer cap in MB. `0` (default) disables
  the cap.

## Visibility & private URLs

Each asset has `visibility ∈ {public, private}`. Public URLs are stable;
private URLs are short-lived (TTL = `assets.private_url_ttl_sec`, default
300s) and re-issued by the admin or storefront on every read.

For the **local FS** adapter, private URLs are HMAC-signed by the backend.
The signing key is sourced from the `ASSETS_LIBRARY_HMAC_KEY` env var
(generate with `openssl rand -hex 32`); rotate to invalidate every
outstanding private URL.

For **S3** and **GCS**, private URLs are V4-signed through the vendor SDK;
nothing in the backend needs to be configured beyond the credentials.

## Soft-delete & hard-delete

Deletes go through a two-step lifecycle:

1. `DELETE /api/v1/admin/assets/:id` → soft-delete. Sets `deletedAt` and
   `purgeAfterAt = now + assets.soft_delete_retention_days` (default 30).
   The asset disappears from listings and pickers but remains recoverable
   via `POST /api/v1/admin/assets/:id/restore`.
2. The repeating `HardDeleteAssetWorker` finalises after `purgeAfterAt`:
   removes the row and asks the adapter to delete the underlying file.
   If the backend cannot remove the file (read-only mount, revoked
   credentials, network partition), the row stays and `pendingCleanup` is
   set to `true`; the worker retries on the next tick.

## Reference protection (FR-030) {#asset-reference-registry}

Soft-delete is rejected with `409 ASSET_REFERENCED` when any of the
following points at the asset:

- `gallery_items.asset_id` (Product gallery)
- `product_attachments.asset_id` (Product attachments)
- `products.download_asset_id` (virtual-download products)
- `categories.main_image_asset_id` (Category main image)
- `cms_pages.body` containing a `{ type: "asset_ref", assetId }` node

The reference list is included in the error envelope's `details` array so
the admin UI can show "in use by" prompts.

## Pluggable storage adapters

Each backend implements the `StorageAdapter` SPI in
`backend/src/modules/assets_library/services/storage/`. Adding a fourth
backend (Azure Blob, Backblaze B2, …) is a matter of dropping in a new
class that implements:

```ts
selfCheck(): Promise<{ ok: boolean; reason?: string }>;
newLocator({ assetId, originalFilename }): string;
put({ locator, mimeType, visibility, stream, sizeBytes }): Promise<void>;
resolveUrl({ locator, visibility, ttlSec? }): Promise<{ url; expiresAt }>;
open({ locator }): Promise<NodeJS.ReadableStream>;
delete({ locator }): Promise<void>;
setVisibility?({ locator, visibility }): Promise<void>;
```

…and registering it in `AdapterRegistry.build`. See the existing
`LocalFsStorageAdapter`, `S3StorageAdapter`, and `GcsStorageAdapter` for
templates.

## Legacy escape hatch

Pre-013 `assets` rows whose `storage_url` was an absolute URL are tagged
`storage_backend = 'legacy'` at migration time. The legacy resolver
returns the URL verbatim for `public` assets and refuses to flip them to
`private` (we cannot sign URLs we didn't issue) — surfaces as
`409 ASSET_LEGACY_LOCATOR_CANNOT_HARDEN` to the admin. Re-upload through
the active adapter to upgrade.
