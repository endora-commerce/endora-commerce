---
'@endora-commerce/mod-assets-library': patch
---

Four asset-library refusals now name, in English and Polish, what the thrower's English message
already said. The codes and statuses are unchanged; **`details` gained keys**, and a client that
compares `details` for equality will see them:

- `409 ASSET_FOLDER_NAME_CONFLICT` — `details.name`, the folder name asked for (on create and on
  rename). "A folder named "{name}" already exists here. Choose a different name."
- `409 ASSET_FOLDER_NOT_EMPTY` — `details.subfolderCount` and `details.assetCount`, counting only
  the files the caller may see, as the message already did. "This folder is not empty (subfolders:
  {subfolderCount}, assets: {assetCount}). Move or delete its subfolders and assets first."
- `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED` — refused by `assets.allowed_file_types`:
  `details.code: 'not_allowed_by_policy'`, `details.fileType` (the declared type, or the sniffed
  one when the content disagrees) and `details.allowedTypes` (the setting's list, comma-joined).
  "Files of type "{fileType}" cannot be uploaded to the asset library. Allowed types:
  {allowedTypes}." A document a browser would run: `details.code: 'active_content'`, "HTML, XHTML,
  XML and JavaScript files cannot be uploaded to the asset library." The same code raised by the
  CRM and project attachment uploads is unchanged and has no `details`.
- `409 ASSET_NO_PREVIOUS_VERSION` past `restorableUntil` — `details.code: 'retention_expired'`
  beside the existing `details.restorableUntil`. It used to answer "This asset has no previous
  version to restore."; it now says "The previous version is past its retention period and can no
  longer be restored."

`details.code` is the refusal token the error envelope reads to pick
`errors.<CODE>.<token>`; branch on it rather than on the message.
