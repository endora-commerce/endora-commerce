---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
---

Two additions to the new CRM module, in the same first release as `crm-module.md` describes.
Nothing here changes behaviour a released version had.

**Adding a file to an opportunity needs `crm:write` and nothing else.**

- **`POST /api/v1/admin/crm/opportunities/:id/attachments/upload`** (`crm:write`,
  `multipart/form-data` with one `file` part) stores the file in the media library as a
  private asset and attaches it in one request, answering the attachment. The media library's
  own upload endpoint asks for `assets.write`, which a sales rep need not hold; this one goes
  through the library's published `assetsLibraryPort.upload`, so the library's allowed file
  types, its size limit as currently set, its content sniffing and its storage backend apply
  unchanged, and its refusals (`ASSET_UPLOAD_TOO_LARGE`, `ASSET_UPLOAD_TYPE_NOT_ALLOWED`) are
  passed on as they are. An opportunity outside the caller's scope answers 404 before
  anything is stored.
- **`OPPORTUNITY_ATTACHMENT_MAX_BYTES`** (25 MB) and the error code
  **`CRM_ATTACHMENT_TOO_LARGE`** (413) are new in `@endora-commerce/contracts`: the bound on
  what that route reads into memory, whatever the media library allows.
- **The Attachments tab offers *Add a file* to every holder of `crm:write`**, by button or by
  dropping a file, and no longer asks for `assets.write`. `@endora-commerce/mod-crm` gains
  `@fastify/multipart` as a peer dependency.
