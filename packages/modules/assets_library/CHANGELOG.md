# @endora-commerce/mod-assets-library

## 0.109.0

### Minor Changes

- 4bc5c7f: A library file follows the visibility of the records that use it (`specs/166-asset-reference-visibility/`). A file used only by records a reader may not see — a private or draft Task, a Project they are not a member of, an Opportunity outside their Organization reach — is hidden from that reader. The module now depends on `admin_roles` (to recognise the Platform administrator); no migration, no new permission.

  - **Hidden means absent.** The admin list, its search, the folder views and the shared file picker leave such files out, in SQL and before paging, so every page stays full. Every admin route that takes an asset id (detail, URL, rename, move, replace and previous-version restore, visibility, permalink set and remove, delete, restore) answers exactly as for a file that does not exist, before reading any body. Only the canonical uuid spelling of an id names a file there, in either case: any other spelling PostgreSQL would also read (no hyphens, braces, other grouping) answers as a missing file for every reader, the Platform administrator included. `move-many` skips a hidden id like a missing one (`movedCount` and the audit row's `assetIds` count what moved). A permalink conflict whose holder is hidden answers `details.assetId: null`.
  - **What stays visible.** A file nobody uses, or one used by an unrestricted kind (product gallery and attachments, category, CMS, blog, menus), is visible to every library reader, and so is a file with at least one record the reader may see. The Platform administrator (`*`) and system work (the retention sweep, storage checks, the deletion guard) see every file. The storage page's two counts stay library-wide.
  - **"Referenced by" lists only the records the reader may see**, on every route that answers an asset detail and through `assetsLibraryPort.getAsset`; `assetId` never reaches the wire.
  - **Delete protection counts every reference, whoever asks.** A refused delete (`409 ASSET_REFERENCED`) names only the references the reader may see; its translated message carries no number.
  - **Folder delete.** The recursive delete (`ifNonEmpty: 'deleteRecursively'`) refuses when a file the reader sees anywhere in the folder is still in use, naming those files' ids, and deletes or moves nothing. Files the deleting reader cannot see are never soft-deleted on their behalf: under all three modes — `cancel`, `moveContentsToParent` and `deleteRecursively` — they move to the deleted folder's parent (the root when there is none), so `cancel` deletes a folder that holds only files the reader cannot see. The `asset_folder.delete` audit row carries `stateBefore.rehomedAssetIds` (empty for an unrestricted reader), written in the same flush. The folder's permalink count leaves out files the reader cannot see.
  - **An owning module switched off** (either axis) hides the files used only by its records from every reader but the Platform administrator, and nobody — the Platform administrator included — can delete them; switching it back on restores every reader's view with no write. A module removed from the deployment (uninstalled and its package removed, or built without) reports no references, so its former files become ordinary unused files.
  - **Cost.** A restricted reader's list asks each reader-restricted contributor once per page, never once per file; the exclusion travels as one array parameter.

### Patch Changes

- bec2e83: Polish error messages are Polish sentences. 137 `errors.*` entries in these modules' `i18n/pl.json`
  bundles were placeholders — the word "Błąd:" followed by the error code lowercased, for example
  "Błąd: product not found." — and a request with `Accept-Language: pl` received them verbatim as
  `error.message`. Each is now a sentence in Polish, for example "Nie znaleziono produktu."

  Error codes, HTTP statuses and the English sentences are unchanged; a client matching on the code
  sees no difference.

- 1a88646: English error messages are English sentences. 137 `errors.*` entries in these modules'
  `i18n/en.json` bundles were the error code in Title Case with a full stop, for example
  "Product Not Found." or "Asset Legacy Locator Cannot Harden.", and a request in English received
  them verbatim as `error.message`. Each is now a sentence in sentence case, for example
  "Product not found." or "This file cannot be made private because it is stored at an address the
  platform did not issue. Upload it again first."

  Two Polish sentences were corrected to match what the code refuses: `CANNOT_MODIFY_SYSTEM_DEFAULT`
  (`mod-sales-channels`) now says the default sales channel can be neither deactivated nor deleted,
  and `MEGAMENU_TARGET_OUT_OF_SCOPE` (`mod-megamenu`) now names a page as well as a category.

  Error codes and HTTP statuses are unchanged; a client matching on the code sees no difference. A
  client that matched on the English message text must match the new sentences.

- d86466f: The command-palette actions of the content and marketing modules (`analytics`, `assets_library`, `blog`, `cms`, `google_analytics`, `google_tag_manager`, `linkedin_ads`, `megamenu`, `meta_ads`, `newsletter`, `pwa`, `seo`, `transactional_emails`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
- 3081882: `AssetReferenceRegistry.findReferencesMany` now attributes every reference to the asset it
  points at, so a recursive folder delete (`ifNonEmpty: 'deleteRecursively'`) refuses with
  409 `ASSET_REFERENCED` when any asset in the subtree is still used by a product, category,
  CMS page, blog post, menu item or record attachment (#535). It used to return an empty list
  for every asset and soft-delete in-use files. Every contributor is asked once for the whole
  folder (`specs/166-asset-reference-visibility/`).
- Updated dependencies [42b1038]
- Updated dependencies [5d192d3]
- Updated dependencies [9b45768]
- Updated dependencies [d2acc82]
- Updated dependencies [22604fa]
- Updated dependencies [c3165da]
- Updated dependencies [0e33ca9]
- Updated dependencies [e64ed74]
- Updated dependencies [e03e6a9]
- Updated dependencies [50338a6]
- Updated dependencies [0e33ca9]
- Updated dependencies [22604fa]
- Updated dependencies [0e33ca9]
- Updated dependencies [9ff8307]
- Updated dependencies [0e33ca9]
- Updated dependencies [07f3764]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [ea892d5]
- Updated dependencies [678fed1]
- Updated dependencies [dcbd154]
- Updated dependencies [a76d6ee]
- Updated dependencies [22604fa]
- Updated dependencies [9a38360]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [0e33ca9]
- Updated dependencies [bdef54c]
- Updated dependencies [1b4f2b7]
- Updated dependencies [d560d58]
- Updated dependencies [dd6deb2]
- Updated dependencies [3f697a3]
- Updated dependencies [df0a90e]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [3ccf23b]
- Updated dependencies [774d23e]
- Updated dependencies [4cb0a7d]
- Updated dependencies [0e33ca9]
- Updated dependencies [f148418]
- Updated dependencies [3ea1249]
- Updated dependencies [476c5aa]
- Updated dependencies [8ef189b]
- Updated dependencies [4bc5c7f]
- Updated dependencies [eba4fd8]
- Updated dependencies [61fc321]
- Updated dependencies [9b3e7f0]
- Updated dependencies [ecdd2f7]
- Updated dependencies [ecdd2f7]
- Updated dependencies [b7baf8a]
- Updated dependencies [1b1c43e]
- Updated dependencies [56e237d]
- Updated dependencies [d50b874]
- Updated dependencies [a166cfd]
- Updated dependencies [0a816a0]
- Updated dependencies [f261ed3]
- Updated dependencies [302e5ce]
- Updated dependencies [d68fb89]
- Updated dependencies [c73366c]
- Updated dependencies [b0a1e48]
- Updated dependencies [b25d8be]
- Updated dependencies [5038a3a]
- Updated dependencies [df95f59]
- Updated dependencies [1fd4822]
- Updated dependencies [9cb3c8d]
- Updated dependencies [0f5bcde]
- Updated dependencies [c72a83e]
- Updated dependencies [42189ce]
- Updated dependencies [d9053a7]
- Updated dependencies [23489bf]
- Updated dependencies [f40ce92]
- Updated dependencies [55864a1]
- Updated dependencies [ed85493]
- Updated dependencies [3174251]
- Updated dependencies [55864a1]
- Updated dependencies [11b0eb8]
- Updated dependencies [b8b6eed]
- Updated dependencies [2aa2c9b]
- Updated dependencies [883d192]
- Updated dependencies [5114576]
- Updated dependencies [8f7c38e]
- Updated dependencies [1846755]
  - @endora-commerce/admin-kit@0.109.0
  - @endora-commerce/platform@0.109.0
  - @endora-commerce/contracts@0.109.0

## 0.108.0

### Patch Changes

- Updated dependencies [0bd5a2b]
- Updated dependencies [4da88fd]
- Updated dependencies [291ec86]
- Updated dependencies [20af5d5]
- Updated dependencies [cf7a9c0]
- Updated dependencies [cf7a9c0]
- Updated dependencies [c8aa175]
- Updated dependencies [c8aa175]
- Updated dependencies [1284428]
- Updated dependencies [1df7a5e]
- Updated dependencies [14bcf1d]
- Updated dependencies [789f917]
- Updated dependencies [d231c48]
- Updated dependencies [e47b84b]
- Updated dependencies [9434cbc]
- Updated dependencies [87ac085]
- Updated dependencies [87f673d]
- Updated dependencies [ad341ed]
- Updated dependencies [e1b173f]
- Updated dependencies [ef1318e]
- Updated dependencies [f42bbaf]
- Updated dependencies [c781cd6]
- Updated dependencies [301a69f]
- Updated dependencies [1377dc8]
- Updated dependencies [af57b55]
- Updated dependencies [49d82dd]
- Updated dependencies [72f9cec]
- Updated dependencies [172597c]
- Updated dependencies [6f1e0ec]
- Updated dependencies [0d0a1c6]
- Updated dependencies [61a1188]
- Updated dependencies [56b075d]
- Updated dependencies [53e88c7]
- Updated dependencies [53e88c7]
- Updated dependencies [8e10ba1]
- Updated dependencies [eda7da8]
- Updated dependencies [359ee2b]
- Updated dependencies [8f0fd0e]
- Updated dependencies [cc98507]
- Updated dependencies [ced7b20]
- Updated dependencies [f3598cd]
- Updated dependencies [6177c81]
- Updated dependencies [2effab9]
- Updated dependencies [c8b20f6]
- Updated dependencies [29180cd]
- Updated dependencies [0f09369]
- Updated dependencies [52884d6]
- Updated dependencies [0071cd7]
- Updated dependencies [3e949eb]
- Updated dependencies [403ccc1]
- Updated dependencies [2b8bd26]
- Updated dependencies [8a2fc1b]
- Updated dependencies [ec14b96]
- Updated dependencies [a4cd906]
- Updated dependencies [3a9dc6e]
- Updated dependencies [5bddd11]
- Updated dependencies [5bddd11]
- Updated dependencies [4a05f32]
- Updated dependencies [a8919dc]
  - @endora-commerce/contracts@0.108.0
  - @endora-commerce/platform@0.108.0
  - @endora-commerce/admin-kit@0.108.0

## 0.107.0

### Minor Changes

- b8adc7f: Stable asset URLs: an asset's file can be replaced in place and its previous version restored, and soft-deleted assets and replaced files are now purged by a scheduled retention sweep.

  **Behaviour change for operators.** Soft-deleted assets are now actually hard-deleted. An hourly
  sweep removes at most 500 assets per run, oldest deletion first, once
  `assets.soft_delete_retention_days` have passed since their deletion — the setting **read when the
  sweep runs**, so a changed setting applies to assets already deleted, and the purge date the API
  reports (`DELETE /api/v1/admin/assets/:id`, its repeat, and the read model's `purgeAfterAt`)
  follows the current setting. The effective period is at least one day: `0` now means one day.
  Kept previous versions are purged on the same rule, counted from when they were replaced. An
  asset something still references is skipped and stays soft-deleted. **The first runs after
  upgrading purge every asset soft-deleted longer ago than the period**; an operator who wants to
  keep those assets lengthens the setting before upgrading. Each run writes one
  `assets_library.retention.sweep` log line, also when nothing was due, and a storage object the
  module stopped needing is retried by the sweep until it is gone.

  **Behaviour change for consumers.** `AssetSummary.url` / `AssetDetail.url`, `AssetRecord.storageUrl`
  (what the catalogue's product, gallery, attachment and Open Graph URLs come from) and
  `assetReadPort.resolvePublicUrls` (product feeds) now carry `?v=<contentVersion>` for public
  assets, and so does the transactional e-mail logo; signed private URLs, legacy rows and `data:`
  values are unchanged, and so is the stored `storageUrl` of a row with no storage key — a URL no
  adapter of this platform wrote. A replace changes the marker, so every embed picks up the new file and can be
  cached for a year. The stable, unversioned form is `fileUrl` and `GET /api/v1/admin/assets/:id/url`,
  and the new `AssetsLibraryService.resolveEmbedUrl(id)` answers the embed form. A CMS storefront page
  cached before a replace keeps serving the previous marker for up to five minutes (the CMS page
  cache's lifetime); that URL redirects to the current file when it is requested. A browser that
  already holds the old `?v=` URL in its cache — it was served as immutable — can keep showing the
  previous image until the CMS page cache has turned over and the page is reloaded. Clearing the CMS
  page cache when an asset changes is tracked in #363.

  **Behaviour change for the file URL.** `GET /assets/file/<id>` answers a public local asset with
  `Cache-Control: public, no-cache` (it was `public, max-age=31536000, immutable`), so a replaced file
  is picked up on the next request; the URLs the platform embeds carry `?v=<contentVersion>` and stay
  cacheable for a year, and a `v` that is no longer current redirects (`302`, `no-store`) to the current
  one. The route also answers `GET /assets/file/<permalink>` (one or more segments, matched
  case-insensitively). A private asset is checked for a valid signature before anything else: without
  one it answers `403` by id — also when it is soft-deleted, where it used to answer `410` — and `404`
  by permalink, exactly as for a name that does not exist. Public cloud assets reached through the
  route are redirected to their stable bucket URL. Redirects and error answers carry `no-store`,
  `X-Content-Type-Options: nosniff` and a fixed content policy, whatever the stored type.

  **Admin.** The asset detail drawer gains, all inside the drawer: the shareable link (the permalink
  URL, or else the stable file URL — never the versioned one) with a copy button and a notice when the
  asset is private; the permalink, validated as it is typed, with a confirmation before a set
  permalink is changed or removed and before a name another asset used is taken; **Replace file**,
  which accepts only the asset's own kind and confirms naming both files and how long the current one
  stays restorable; the previous version with **Restore**; and a warning before deleting an asset that
  has a permalink. Write controls need `assets.write`. The command palette (⌘K / CTRL+K) gains
  "Assets library" ("Biblioteka zasobów"), named like the sidebar entry and also found by "media",
  "media library" and "multimedia", opening the library for anyone holding `assets.read`.

  **Database (one migration, owned by this module).**

  - Eleven new columns on `assets`: `content_version` (backfilled with a random 12-character token
    for every existing row, and given the same kind of random default for rows written by raw SQL),
    `permalink`, and the nine `previous_*` columns of the one kept previous version.
    A permalink is unique case-insensitively, and a previous version is recorded in full or not at
    all (`previous_replaced_by` may stay empty for a system actor). Two partial indexes serve the
    retention sweep.
  - Two new tables, both platform-global and without foreign keys:
    `asset_permalink_releases` (one row per permalink that stopped being held) and
    `asset_object_cleanups` (storage objects still to delete).
  - Rolling back drops all of it. Every asset keeps being served, because the stored file key does
    not change.

  **Responses.** Every asset summary and detail now answers `fileUrl` (the stable file URL, unsigned
  even for a private asset), `permalink`, `permalinkUrl` (on the same public base as the file URL) and
  `contentVersion`; `assetReadPort` records carry `contentVersion` and `permalink`. Every existing
  member keeps its value.

  **Replace a file in place.** `POST /api/v1/admin/assets/:id/replace` (`assets.write`, multipart, one
  `file` part, an optional `expectedContentVersion` field before it) swaps an asset's file and keeps
  everything else: the id, the folder, the label, the alternate text, the visibility, every reference
  to it, its storage key and therefore every URL already handed out. It answers the updated detail,
  with a new `contentVersion`. The write runs as the audited Command `asset.replace` (before and after:
  filename, type, size, content version).

  - The replacement passes the same size, type and content policy as an upload. The configured
    maximum size now also applies to the bytes actually received — on an upload as well — so a
    tightened limit takes effect without a restart. On an S3 asset a replacement above 5 GiB is
    refused with `413` naming 5120 MB.
  - An asset keeps its kind: an image is replaced by an image (an SVG counts), a video by a video, a
    PDF by a PDF, and anything else by anything else, judged by what the new bytes are rather than the
    declared type. A mismatch is `415 ASSET_REPLACE_KIND_MISMATCH` with `details.currentKind` and
    `details.newKind`. A certificate stays a certificate. An admin's MIME override is cleared.
  - Two replaces racing on the same version: one wins, the other gets `409 ASSET_REPLACE_CONFLICT`.
    A soft-deleted asset answers `410`, a legacy row `409 ASSET_LEGACY_CANNOT_REPLACE`, an
    unconfigured storage backend `503`. The asset's own backend is used, whatever the active one is.
  - `expectedContentVersion` must come before the file part. Sent after it, the request answers
    `400 VALIDATION_FAILED`, refused once the new bytes are staged and before anything is committed,
    so nothing is replaced; it is never silently skipped.
  - The replaced file is kept as the asset's previous version under a random, private storage key; a
    further replace discards the one before. Staging and previous objects are recorded in
    `asset_object_cleanups` before they exist, so a failed or interrupted replace leaves nothing that
    is not either referenced or due for cleanup.
  - A visibility change now takes the asset's row lock, as a replace does.
  - The file route's `ETag` is now `"<id>-<contentVersion>"`: it changes when the file changes and no
    longer when only the label or folder does.

  **The previous version and its restore.** The asset detail now carries `previousVersion` — the
  replaced file's name, type, size, content version, when and by whom it was replaced, and
  `restorableUntil` (replaced at plus `assets.soft_delete_retention_days`) — or `null`, and
  `retentionDays`, that setting as the sweep reads it in whole days, which the replace confirmation
  names. `POST
/api/v1/admin/assets/:id/previous-version/restore` (`assets.write`) swaps it back: the body names
  both `expectedContentVersion` and `expectedPreviousContentVersion`, so a restore brings back
  exactly the file the admin saw, and either one being out of date answers
  `409 ASSET_REPLACE_CONFLICT`. The restored file keeps its own content version, so its old ETag and
  cached copies are valid again; the file it replaces becomes the previous version with a fresh
  retention period. Without a previous version the answer is `409 ASSET_NO_PREVIOUS_VERSION`. The
  write runs as the audited Command `asset.restore_previous_version`. `assets_library` now declares
  a dependency on `admin_users`, whose `adminUserReadPort` names the admin who replaced the file.

  **Permalinks.** `PUT /api/v1/admin/assets/:id/permalink` (`{ permalink, confirmReuse? }`) and
  `DELETE /api/v1/admin/assets/:id/permalink` (`assets.write`) set and remove an asset's
  operator-chosen permalink, as the audited Commands `asset.permalink_set` and
  `asset.permalink_remove`; setting the same value again, or removing none, writes nothing. A permalink
  is checked by the shared rule (`400 ASSET_PERMALINK_INVALID` with `details.code`) and is unique
  case-insensitively (`409 ASSET_PERMALINK_TAKEN` with the holder's id); a soft-deleted asset keeps
  its permalink, and setting or removing it answers `410 ASSET_GONE` until the asset is restored. A permalink that was changed, removed or freed by a purge can be taken at once, but
  when the asset that held it last was a **different** one the request answers
  `409 ASSET_PERMALINK_PREVIOUSLY_USED` until `confirmReuse: true` is sent — links already printed with
  that name will open the new asset — and the audit entry records which asset held it. The list
  search (`q`) also matches permalinks.

  **Files the library did not upload (owner ruling).** A row with no storage key — a file inserted
  directly into the database, such as the demo data's inline `data:` images — is refused like a legacy
  row: replace and restore answer `409 ASSET_LEGACY_CANNOT_REPLACE` instead of `503`. The asset detail
  gains `replaceable` (false for both kinds of row), and the drawer offers no **Replace file** for them,
  saying the new file has to be uploaded as a new asset.

  **Folder delete names permalinked files (owner ruling).** The folder delete confirmation now says how
  many files in the folder, at any depth, have a shareable link; the library moves a deleted folder's
  files to the parent folder, so those links keep working. The count comes from the new
  `GET /api/v1/admin/assets/folders/:folderId/permalink-count` (`assets.read`), which answers
  `{ data: { permalinkedAssets } }` over live assets and `404 ASSET_FOLDER_NOT_FOUND` for an unknown
  folder. The API option `deleteRecursively` of the folder delete moves the folder's assets to the
  trash without confirmation, so their permalinks answer `410` until the assets are restored.

  **Uploads take one file.** `POST /api/v1/admin/assets` now ignores a second file part and answers
  `201` with the asset the first one created; it used to answer `400 ASSET_UPLOAD_NO_FILE`. The replace
  route does the same.

  **Storage failures.** A storage failure during an upload or a replace answers
  `503 ASSET_STORAGE_UNAVAILABLE` with a generic, translated sentence instead of the adapter's own
  text, which could name a path, a bucket or an endpoint; the adapter's error is logged with the
  request.

  **Junk names on the file route.** `GET /assets/file/<name>` answers a name no permalink can be — a
  NUL byte, a character outside the permalink rule, more than 200 characters — with the same `404` as
  an unused name, without querying the database.

  **Retention floor.** `assets.soft_delete_retention_days` is now read as at least one day: `0`
  (or anything below one) behaves as one day, so a deletion or a replaced file is never due at once.

  **Storage.** Every storage backend can now copy one stored file over another on the server, and
  the cloud backends write two more headers on the objects they store: `Cache-Control: no-cache` and a
  `Content-Disposition` chosen by the serving policy — images, video, PDFs and plain text `inline`; SVG
  and every type a browser would not just display as `attachment`. The ACL of a copied object is always
  set explicitly from the asset's visibility. Objects stored before this release keep their headers
  until they are next written.

  **Error codes.** Seven new codes are declared with their English and Polish sentences:
  `ASSET_REPLACE_KIND_MISMATCH`, `ASSET_LEGACY_CANNOT_REPLACE`, `ASSET_REPLACE_CONFLICT`,
  `ASSET_NO_PREVIOUS_VERSION`, `ASSET_PERMALINK_TAKEN`, `ASSET_PERMALINK_PREVIOUSLY_USED` and
  `ASSET_PERMALINK_INVALID` (with one sentence per reason the permalink rule names).

  **Documentation.** The module page, in English and Polish, now says which URLs are stable and
  when, and gains sections on replacing a file, permalinks, the previous version and its restore,
  caching (with the CMS page-cache delay after a replace), cloud storage, operating a CDN in front
  of the API or the bucket, and retention and purge; the soft-delete section now describes the
  retention period as read when the sweep runs. The module map's summary line follows the page.

### Patch Changes

- 2a858cd: Uploaded files are stored and served under a stricter content policy, and private assets are checked before a storage redirect.

  - Uploads of HTML, XHTML, XML (including XSL) and JavaScript files are refused with
    `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`, judged by the declared MIME type and by the file extension,
    regardless of `assets.allowed_file_types`. SVG uploads are still accepted and are always stored
    as `image/svg+xml`.
  - `GET /assets/file/:assetId` now sends `X-Content-Type-Options: nosniff` and a
    `Content-Security-Policy` (`default-src 'none'; style-src 'unsafe-inline'; sandbox`, without
    `sandbox` for PDFs) on every response, and serves only raster images, SVG, video, audio, PDF and
    plain text `inline`; every other stored type is served as an `attachment`.
  - For a `private` asset on S3 or GCS, the same route now requires a valid signed token before it
    redirects to the storage URL, as it already did for local assets; without one it answers
    `403 ASSET_ACCESS_DENIED`. URLs from `GET /api/v1/admin/assets/:id/url` are unaffected.

- 1a89920: Make `assetsLibraryModule` honor `assets.soft_delete_retention_days` for single-asset and recursive-folder soft deletion. The setting is read when the purge runs, so a changed value applies to assets already deleted. Default to 30 days for missing, empty, non-numeric, negative or non-finite values, and treat any value below one day as one day — a stored `0` is read as 1 day.
- Updated dependencies [97d24cf]
- Updated dependencies [fcf4d09]
- Updated dependencies [09e72a3]
- Updated dependencies [70bb5e5]
- Updated dependencies [cd272e5]
- Updated dependencies [76f9757]
- Updated dependencies [05d0650]
- Updated dependencies [bf9881f]
- Updated dependencies [8397b0f]
- Updated dependencies [8397b0f]
- Updated dependencies [dd939be]
- Updated dependencies [d571d8c]
- Updated dependencies [34f97ae]
- Updated dependencies [f61fea3]
- Updated dependencies [afaa86a]
- Updated dependencies [248a9df]
- Updated dependencies [248a9df]
- Updated dependencies [b8adc7f]
- Updated dependencies [86a88fd]
- Updated dependencies [cb098b7]
- Updated dependencies [3d5a203]
- Updated dependencies [2933bf0]
- Updated dependencies [edac0be]
- Updated dependencies [fe48d6d]
- Updated dependencies [a57515b]
- Updated dependencies [4f9daef]
- Updated dependencies [5865c59]
- Updated dependencies [7d2d00f]
- Updated dependencies [e9a92b9]
- Updated dependencies [d76291d]
- Updated dependencies [1525d86]
- Updated dependencies [4e82450]
- Updated dependencies [ecd23de]
- Updated dependencies [0472475]
- Updated dependencies [dd9ab59]
- Updated dependencies [30c61d9]
- Updated dependencies [30c61d9]
- Updated dependencies [3acae57]
- Updated dependencies [b96321c]
- Updated dependencies [9d8f8c5]
  - @endora-commerce/admin-kit@0.107.0
  - @endora-commerce/contracts@0.107.0
  - @endora-commerce/platform@0.107.0

## 0.106.0

### Patch Changes

- Updated dependencies [fc23f9e]
- Updated dependencies [4be4642]
- Updated dependencies [9dd3b81]
- Updated dependencies [be99bb5]
- Updated dependencies [ddc9382]
  - @endora-commerce/contracts@0.106.0
  - @endora-commerce/platform@0.106.0
  - @endora-commerce/admin-kit@0.106.0

## 0.105.0

### Patch Changes

- dd6e23c: `413 ASSET_UPLOAD_TOO_LARGE` says what the limit is. Its sentence was a placeholder — "Asset Upload
  Too Large." in English and "Błąd: asset upload too large." in Polish — while the message it replaced
  named the configured maximum.

  The error now carries `details.maxFileSizeMb`, the value of the `assets.max_file_size_mb` setting,
  and both sentences name it: "The file is too large: the largest file that can be uploaded is 25 MB."

  The code and the status are unchanged; a client matching on either sees no difference.

- Updated dependencies [18ae962]
- Updated dependencies [1190180]
- Updated dependencies [a65b215]
- Updated dependencies [9260c36]
- Updated dependencies [3383720]
- Updated dependencies [202f0d9]
- Updated dependencies [0184be5]
- Updated dependencies [560f2e3]
- Updated dependencies [60cfd18]
- Updated dependencies [79bd849]
- Updated dependencies [31a2c0b]
- Updated dependencies [266cd38]
- Updated dependencies [bdb823b]
- Updated dependencies [8d4440f]
- Updated dependencies [8ca54eb]
- Updated dependencies [6b2ba06]
- Updated dependencies [be5b3ce]
- Updated dependencies [82ca6dd]
- Updated dependencies [38e8818]
- Updated dependencies [335750c]
- Updated dependencies [602e5ba]
- Updated dependencies [8ee69de]
  - @endora-commerce/contracts@0.105.0
  - @endora-commerce/platform@0.105.0
  - @endora-commerce/admin-kit@0.105.0

## 0.104.0

### Patch Changes

- Updated dependencies [32775d5]
- Updated dependencies [2f95785]
- Updated dependencies [32775d5]
- Updated dependencies [dbf6778]
- Updated dependencies [2d39d97]
- Updated dependencies [fcf6daa]
- Updated dependencies [5e2ade8]
- Updated dependencies [85793d6]
- Updated dependencies [d5ab69f]
- Updated dependencies [32775d5]
- Updated dependencies [f02494f]
- Updated dependencies [7af6470]
- Updated dependencies [1a15fdc]
  - @endora-commerce/admin-kit@0.104.0
  - @endora-commerce/contracts@0.104.0
  - @endora-commerce/platform@0.104.0

## 0.103.1

### Patch Changes

- @endora-commerce/admin-kit@0.103.1
  - @endora-commerce/contracts@0.103.1
  - @endora-commerce/platform@0.103.1

## 0.103.0

### Patch Changes

- Updated dependencies [d0e76fd]
- Updated dependencies [d0e76fd]
- Updated dependencies [08192f0]
- Updated dependencies [f052b7f]
- Updated dependencies [2b339d3]
- Updated dependencies [9eb7ed9]
- Updated dependencies [11c0962]
  - @endora-commerce/admin-kit@0.103.0
  - @endora-commerce/contracts@0.103.0
  - @endora-commerce/platform@0.103.0

## 0.102.0

### Patch Changes

- Updated dependencies [3f7f481]
- Updated dependencies [e29093b]
- Updated dependencies [e7fd44a]
- Updated dependencies [d8b4e1b]
  - @endora-commerce/platform@0.102.0
  - @endora-commerce/admin-kit@0.102.0
  - @endora-commerce/contracts@0.102.0

## 0.101.1

### Patch Changes

- 69a3717: The `fastify` peer is now `^5.11.0` instead of `^5`, so an install can no longer resolve Fastify 5.0–5.10. On those versions an async route handler that calls `reply.send()` without `return` throws `ERR_HTTP_HEADERS_SENT` as an uncaught exception from Fastify's onSend hook runner, and the process crash-loops; Fastify 5.11.0 catches that error and the server keeps running. An instance scaffolded by `endora new instance` now declares `fastify@^5.11.0` as well. Nothing to do on upgrade unless your project pins Fastify below 5.11 — move it to `^5.11.0` (the repository itself runs 5.12.5).
- Updated dependencies [69a3717]
  - @endora-commerce/platform@0.101.1
  - @endora-commerce/admin-kit@0.101.1
  - @endora-commerce/contracts@0.101.1

## 0.101.0

### Patch Changes

- 40ce6f4: `ASSETS_LIBRARY_HMAC_KEY` no longer accepts a placeholder as a signing key. A value beginning `change-me` — what the env examples carried — is not hex, so `HmacSigner.fromEnv` read it as raw bytes and signed private asset links with a string every copy of the example shares. It now throws, naming the key and `openssl rand -hex 32`, exactly where an unset key already did. The `deploy/` examples `endora new instance` writes leave the key empty, with the sentence saying what empty costs. A deployment still running on a copied placeholder will have its private asset links refused until a real key is set.
- Updated dependencies [89b0de3]
- Updated dependencies [667e9e1]
- Updated dependencies [be758bb]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d9cf1ad]
- Updated dependencies [d919418]
  - @endora-commerce/platform@0.101.0
  - @endora-commerce/admin-kit@0.101.0
  - @endora-commerce/contracts@0.101.0

## 0.100.2

### Patch Changes

- Updated dependencies [54c7417]
  - @endora-commerce/platform@0.100.2
  - @endora-commerce/admin-kit@0.100.2
  - @endora-commerce/contracts@0.100.2

## 0.100.1

### Patch Changes

- Updated dependencies [f988e26]
  - @endora-commerce/platform@0.100.1
  - @endora-commerce/admin-kit@0.100.1
  - @endora-commerce/contracts@0.100.1

## 0.10.8

### Patch Changes

- Updated dependencies [2ffcda5]
  - @endora-commerce/platform@0.14.0

## 0.10.7

### Patch Changes

- Updated dependencies [0af8db8]
- Updated dependencies [7b1f09e]
- Updated dependencies [8418b7d]
- Updated dependencies [a12d4bf]
- Updated dependencies [6738f35]
- Updated dependencies [9ef7f4b]
- Updated dependencies [1b3fb93]
  - @endora-commerce/contracts@0.17.0
  - @endora-commerce/admin-kit@0.9.7
  - @endora-commerce/platform@0.13.3

## 0.10.6

### Patch Changes

- Updated dependencies [8a88460]
  - @endora-commerce/contracts@0.16.0
  - @endora-commerce/admin-kit@0.9.6
  - @endora-commerce/platform@0.13.2

## 0.10.5

### Patch Changes

- 32fdf20: The `LICENSE` file in each package now names the copyright holder as Endora sp. z o.o.

  The MIT licence text is unchanged; only its copyright line moves from `Copyright (c) 2026 Endora`
  to `Copyright (c) 2026 Endora sp. z o.o.`, the registered legal entity. Nothing a package exports,
  declares or depends on changes. `@endora-commerce/contracts` and
  `@endora-commerce/mod-invoice-ledger` also carry a one-sentence rewording in an already-published
  `CHANGELOG.md` entry, with no change to what that entry says about the code.

- Updated dependencies [43f445d]
- Updated dependencies [b9c6686]
- Updated dependencies [f89d305]
- Updated dependencies [32fdf20]
- Updated dependencies [07f1e8c]
- Updated dependencies [67dfca3]
- Updated dependencies [f89d305]
- Updated dependencies [7392332]
  - @endora-commerce/contracts@0.15.0
  - @endora-commerce/admin-kit@0.9.5
  - @endora-commerce/platform@0.13.1

## 0.10.4

### Patch Changes

- Updated dependencies [d5778af]
- Updated dependencies [e267293]
- Updated dependencies [d6bfea0]
- Updated dependencies [8a05249]
- Updated dependencies [e67a074]
- Updated dependencies [b3b4286]
  - @endora-commerce/contracts@0.14.0
  - @endora-commerce/platform@0.13.0
  - @endora-commerce/admin-kit@0.9.4

## 0.10.3

### Patch Changes

- Updated dependencies [80751c2]
  - @endora-commerce/admin-kit@0.9.3

## 0.10.2

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0
  - @endora-commerce/admin-kit@0.9.2

## 0.10.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/admin-kit@0.9.1
  - @endora-commerce/platform@0.11.1

## 0.10.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/admin-kit@0.9.0
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0
  - @endora-commerce/admin-kit@0.8.2

## 0.9.0

### Minor Changes

- 02838b7: Nine modules now declare the environment inputs they own, in `manifest.env`, so a
  client who installs them can be told what to put in their `.env`. Each declaration
  carries an English and a Polish sentence, a requirement, and — for an `optional`
  one — what is lost without it.

  `health_checks` was the tenth until D-229 dissolved it into the platform; its two
  declarations went with it, and `search`'s `MEILISEARCH_URL` went with them,
  because the platform now declares that name and a module may not describe a
  platform input a second time.

  Nothing changes at runtime: no module reads a new variable and none changes how it
  reads an existing one. What changes is that the requirement is now on the wire, in
  the manifest the platform already carries, and reaches a consumer through the
  package's own `exports` map.

  Every module here declares only what it **owns**. The seven platform-owned names
  these modules read — `NODE_ENV`, `BACKEND_ROLE`, `STOREFRONT_BASE_URL`,
  `PUBLIC_API_BASE_URL`, `BACKEND_PUBLIC_URL`, `REVALIDATE_SECRET` and
  `SETTINGS_SECRET_ENCRYPTION_KEY` — are declared by `@endora-commerce/platform` and
  are deliberately not repeated here.

### Patch Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0
  - @endora-commerce/admin-kit@0.8.1

## 0.8.0

### Minor Changes

- 142fcdd: `AssetReadPort` gains `openAssetBytes(assetId)`, and `assets_library` answers it.

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

- eb01958: Every URL `assets_library` produces is absolute, and the module resolves the public API
  origin itself (owner ruling **D-223**).

  **What an upgrader sees.** `AssetDetail.url`, `AssetSummary.url`,
  `getAssetUrlResponse.url`, a CMS embed's `url` and a product feed's image URL all carry an
  origin now. On a deployment that never set `assets.local.public_url_base` — the shipped
  default, blank — the same asset used to answer `/assets/file/<id>`:

  ```diff
  -{ "url": "/assets/file/2b1c…" }
  +{ "url": "https://api.example.com/assets/file/2b1c…" }
  ```

  Nothing breaks on the day this lands: both frontend helpers (`toAbsoluteAssetUrl` in the
  storefront and in `@endora-commerce/admin-kit`) pass an absolute URL through untouched, and
  `absolutizeMediaUrl` in `@endora-commerce/cms-components` does the same. What does change is
  any consumer that **compares** or **stores** the string — a test asserting
  `'/assets/file/…'`, a cache key, a stored HTML body diffed against a fresh render. It is a
  `major` for that reason and not because a signature moved.

  **The precedence, which an operator may rely on.** A configured base still wins:
  `assets.local.public_url_base`, `assets.s3.public_base_url` and `assets.gcs.public_base_url`
  are unchanged in meaning. Blank now means _this deployment's public API origin_ for
  local-FS, and still means _the bucket's own origin_ for S3 and GCS — pointing a bucket
  object at the API host would name a host that does not serve those bytes. A configured base
  written as a path (`/media`) is rebased onto the API origin rather than left relative.

  **Two required options** — a module composed by the kernel gets them from
  `registerModule`, so this is only a break for a caller constructing the module by hand:
  `assetsLibraryModule({ publicApiBaseUrl })` and `new AdapterRegistry({ publicApiBaseUrl })`,
  plus `publicApiBaseUrl` on each adapter's own options. Required rather than optional
  deliberately: an omitted origin is not a failure, it is a host-relative URL inside an
  e-mail, a push payload and a partner's feed.

  `legacyAssetResolver` (the `storage_backend='legacy'` resolver) is now the factory
  `createLegacyAssetResolver(publicApiBaseUrl)`. It still serves a stored absolute URL
  verbatim; a stored host-relative one is rebased.

  **`@endora-commerce/platform`**: `absolutizePublicUrl` is no longer exported from
  `@endora-commerce/platform/composition`. It existed for the two composition-root sites that
  rebased an asset URL, and those are gone — a consumer that rebases a URL the module already
  made absolute is a consumer that can disagree with it. The declaration is untouched in
  `kernel/public-api-base-url.ts` and returns to the barrel the day an application needs one.
  `./composition` is a host-internal subpath, so no module could name it.

- e27bf6c: Every package that ships scannable UI now publishes its own Tailwind `@source`
  declarations at a new `./tailwind.css` subpath.

  A host compiling this package's utility classes no longer has to know where the
  package's sources are. Import the subpath from the stylesheet that builds your
  admin, and the package names its own layers:

  ```css
  @import 'tailwindcss';
  @import '@endora-commerce/mod-blog/tailwind.css';
  ```

  `@source` resolves relative to the stylesheet that declares it, so the paths hold
  wherever the package is installed. The file is generated from the package's layer
  inventory, ships in the tarball beside `package.json`, and its `dist` line is the one
  that matters to you — the `src` line beside it is inert in a published package and
  exists so that a checkout of this repository keeps scanning source in `dev`.

  **Nothing is removed or renamed**: every existing subpath resolves exactly as before.
  What is new is the obligation on the _host_ side, and it is a build error rather than a
  silent one. Before this, a host reached these packages with a glob over the monorepo
  (`@source "../../packages/**"`), which named a directory no installed tree has —
  and Tailwind reports nothing at all about a source that matches nothing, so such a host
  built green and rendered every screen unstyled. A host that now names a package that is
  not installed gets `Can't resolve`, and one whose tarball omits the file gets
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

  `@endora-commerce/cms-components` deliberately does **not** publish this subpath. It
  ships a finished, prefixed stylesheet at `./styles.css` and must not also be scanned by
  its host.

- 0ab2044: Publish the object store, the availability port and the batched category and
  asset reads `product_feeds` reached through a composition root.

  `@endora-commerce/contracts` gains four exports and one method, all additive:
  - `ObjectStoragePort` (container name `objectStoragePort`, owner
    `assets_library`) with `ObjectStore`, `ObjectStoragePutInput`,
    `ObjectStorageBackendCode` and `AssetByteStream`. A byte store for a module
    that keeps its own objects under its own locator prefix and creates no `Asset`
    row. `getForBackend` is **total** — `legacy` is a URL resolver for pre-013
    rows, not a store, so it is not in the code union and a consumer has no arm to
    probe for.
  - `InventoryAvailabilityPort`, the shape `inventoryAvailabilityPort` has always
    answered. The registration carried no type argument, so there was no name to
    import.
  - `CatalogCategoryReadPort.expandCategoryProductIds(categoryIds)` — the batched,
    live-narrowed, cycle-tolerant subtree walk. It is **not** a batched
    `listProductIdsInSubtree`: that one is structural by contract and is a
    recursive CTE with no cycle guard.
  - `AssetReadPort.resolvePublicUrls(assetIds)` — the stable public URL of each
    live, public asset, and nothing for the rest. Absence is the answer rather
    than an exception, because only the owner can tell a stable URL from an
    expiring signed one.

  Breaking, `@endora-commerce/mod-product-feeds`:
  - `ProductFeedsBridge` is **removed**. The module resolves the four ports above
    itself; a composition contributes nothing to it beyond deployment values.
  - `ProductFeedsModuleOptions.storageAdapters: ArtefactStorageAdapterProvider`
    becomes `objectStorage: ObjectStoragePort`. Pass the container's
    `objectStoragePort` instead of an adapter registry.
  - `ArtefactStorageAdapter` and `ArtefactStorageAdapterProvider` are removed from
    `services/artefact-store.js`; `ArtefactStorageBackend` is now
    `ObjectStorageBackendCode` and `ArtefactStorePort.open` returns a
    `node:stream` `Readable` rather than a `NodeJS.ReadableStream`.

  Breaking, `@endora-commerce/mod-catalog`:
  - `CatalogQueryService.expandCategoryProductIds` is **removed**. The same walk,
    unchanged, is `CatalogCategoryReadService.expandCategoryProductIds`, published
    on `catalogCategoryReadPort`. It is a category read and it now has one home.

### Patch Changes

- 034f190: Both modules declare `demo: false` — a decision recorded rather than a field filled in.

  The demo shop holds seven product-host custom-field definitions and about five hundred assets,
  and not one of them is either module's own demo data. A product attribute is a definition paired
  1:1 with a `catalog` extension row and written in one call; every demo asset is minted inside a
  loop over `catalog`'s products, with its filename and its generated image derived from the
  product it hangs off, and its id handed straight to one of `catalog`'s tables. Each is two
  modules' rows in one statement and belongs to whoever owns the instance.

  For `custom_fields` this also settles a question the feature's own artefacts left open, and
  settles it against the proposal: the definitions cannot be seeded here with the extension rows
  seeded by `catalog`, because `catalog` would then have to read `custom_field_definitions` to find
  the id its extension references, and a module's demo body may not read another module's table.

  Absent and `false` are different states, so this changes no behaviour: it says the modules owe
  nothing rather than leaving it undecided.

- Updated dependencies [16a9a6d]
- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [e27bf6c]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/admin-kit@0.8.0
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Minor Changes

- 27ca81d: `assets_library` and `custom_fields` ship their admin surfaces.

  **New `./admin` subpath on both packages.** `@endora-commerce/mod-assets-library` and
  `@endora-commerce/mod-custom-fields` each export `contributions` — an `AdminContributions`
  object — from `@endora-commerce/mod-<id>/admin`, and nothing else. Each declares one route
  and one sidebar entry; the route components are dynamic-import factories, so a consumer's
  bundler emits one chunk per screen. The routes are unchanged: `/assets-library` and
  `/custom-fields`, gated on `assets.read` and `custom_fields:read` respectively — the codes
  the hand-written host registrations carried.

  Four things a consumer has to know about that half:
  - **The subpath needs a build.** `./admin` resolves at `dist/admin/index.js`, emitted by
    each package's new `tsconfig.ui.json`; a checkout that has not run
    `pnpm run build:packages` cannot resolve it. Both packages' `build` and `typecheck`
    scripts now run two `tsc` invocations.
  - **`@endora-commerce/admin-kit`, `react` and `lucide-react` become peer dependencies of
    both**, and `react-router-dom` of `mod-custom-fields`. The kit is where every screen's
    design-system import resolves; `react` is peered rather than depended on so the
    application resolves one copy.
  - **Each package's `i18n/` bundle gains its own `nav.*.label`** — `nav.assetsLibrary.label`
    and `nav.customFields.label` — resolved in the module's own namespace instead of the
    shared `core` one. `appShell.nav.assetsLibrary` and `appShell.nav.customFields` are
    removed from `@endora-commerce/mod-i18n`'s bundle with the host rows that named them.
  - **`mod-custom-fields`' screen no longer reads the `core` namespace at all.** It rendered
    `customFields.title` and `customFields.description` out of the shared bundle beside four
    keys of its own; both were already written in this package's `i18n/{en,pl}.json`, so the
    shared reads were a second copy of two strings. `customFields.title` and
    `customFields.save` stay in `mod-i18n` because `@endora-commerce/admin-kit`'s
    `CustomFieldValuesPanel` renders them.

  **One repair inside `mod-assets-library`, and it is a deduplication a consumer can see.**
  `AssetDetailDrawer` carried a private `toAbsoluteAssetUrl` over its own
  `import.meta.env.VITE_API_BASE_URL` read with a `http://localhost:3001` fallback — a
  fourteenth copy of the function `@endora-commerce/admin-kit/lib` publishes. It takes the
  kit's now, which is the binding `LibraryPage` two files away was already taking. There is
  one implementation of it in the tree again.

  **Nothing is removed and no existing export changes shape**, so a consumer of either
  package's `./backend`, `./migrations`, `./ports` or root subpath is unaffected. Both
  modules declare `activation.nonDeactivatable`, so neither gains an operator-facing switch:
  what the new subpath adds is where the screens live, not whether they can be withdrawn.

- e637f56: Seven more modules become workspace packages (feature 080, T040b batch four):
  `assets_library`, `carts`, `custom_fields`, `customers`, `email`, `invoices` and
  `settings`. Each ships `dist` and resolves through its own `exports` map — the
  root for its manifest, `./backend` for `registerModule` plus the `entities`
  array, `./migrations` for its migration classes where it owns any — exactly as
  the forty-three packages before them.

  Three things a consumer of one of these packages should know.

  **`@endora-commerce/mod-carts`, `@endora-commerce/mod-custom-fields` and
  `@endora-commerce/mod-invoices` publish a `./ports` subpath.** It is type-only:
  `tsc` emits `export {};`, and it is where a consumer names
  `CartPlacementApplyPort`, `CustomFieldDefinitionApplyApi` and
  `InvoicePlacementApplyPort` instead of reaching into the owner's directory.

  ```ts
  import type { CartPlacementApplyPort } from '@endora-commerce/mod-carts/ports';
  ```

  The implementations stay behind their container names
  (`cartPlacementApplyPort`, `customFieldDefinitionApplyApi`,
  `invoicePlacementApplyPort`) and are resolved with `lazyPort`, never through
  this subpath.

  **`@endora-commerce/mod-settings` declares `entities` as an empty array.** The
  module owns no table — the settings store is the platform's — and the empty
  array is the statement, because the host reads a _missing_ export as `[]` and a
  forgotten one would be indistinguishable from an honest none.

  **No entity class is exported by name from any of the seven**, `import type`
  included (D-168). A consumer that must construct one takes it off the published
  `entities` array by name; `Cart`, `Invoice` and the rest are deliberately not
  importable.

### Patch Changes

- e969343: `assets_library` declares the fifteen error codes it owns.

  `manifest.ts` gains an `errorCodes` array — feature 090 Phase 3
  (`specs/090-module-owned-error-codes/`). Nothing the package exports changes
  shape. The observable difference for a consumer is that this module's error
  sentences are now routed by its own declaration rather than only by the prefix
  chain in `@endora-commerce/mod-i18n`, which continues to answer identically for
  every one of them: the list is the chain's own answer, copied from the frozen
  capture, and is asserted equal to it in both directions.

  No `tokens` are declared: none of the fifteen carries a refusal discriminator.
  `ASSET_KIND_NOT_SUPPORTED` is not here — it carries this module's prefix and is
  `catalog`'s, which declares it.

- 73da94f: Each of these packages now carries the unit tests that cover its own sources,
  and a `vitest` configuration and `test` script to run them.

  For a consumer the manifest is what changed: `vitest` joins `peerDependencies`
  and `devDependencies`, and `scripts.test` is `vitest run`. Both are rendered by
  `manifests:generate` from the package's own layer inventory, so they follow the
  test files rather than being declared by hand. Nothing exported moves: the test
  files are excluded from `tsconfig.build.json`'s emit and from the `files` list,
  so the published tarball is byte-identical apart from the manifest.

  Running them needs nothing but the package — that is the property that decided
  which files moved. A test that composes a backend server, reads a live Postgres
  or Redis, or names anything under `backend/` stayed where it was.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [68044b1]
- Updated dependencies [a85b425]
- Updated dependencies [4c9892c]
- Updated dependencies [972e7ed]
- Updated dependencies [b1589fd]
- Updated dependencies [316f44b]
- Updated dependencies [45e77bb]
- Updated dependencies [ebc08af]
- Updated dependencies [47c958f]
- Updated dependencies [b2552d5]
- Updated dependencies [7140eed]
- Updated dependencies [cebad9c]
- Updated dependencies [1d84094]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [214cbdb]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [e7bbadc]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/admin-kit@0.7.0
  - @endora-commerce/platform@0.7.0
