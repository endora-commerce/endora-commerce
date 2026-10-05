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

**CRM analytics.**

- **Five reads under `/api/v1/admin/crm/analytics/`**, each gated by the new permission
  **`crm:analytics`** and taking `from`, `to` (`YYYY-MM-DD`, both included, UTC) and optional
  `salesChannelId`, `assignedAdminUserId`: `handling-time` (creation to closing, over the
  opportunities closed in the range, with won and lost apart), `time-in-status` (average
  length of the stays that began in the range, per status; `statusCode` repeats),
  `rep-effectiveness` (opportunities closed as won per calendar month and assignee, with
  their value per currency), `top-opportunities` (`OpportunitySummary` rows, the highest
  values per currency; `limit` is per currency, `basis` is `created` or `closed`) and
  `average-value` (per currency, over the opportunities created in the range). Amounts in
  different currencies are never added. Figures are computed live, each from one grouped
  statement, and are confined to the organizations the caller may see. A range that ends
  before it begins answers 422.
- **A new screen, CRM → Analytics** (`/crm/analytics`), with a sidebar row between *Board* and
  *Tags* and a command-palette action, `open-crm-analytics`. Two figures are drawn as charts
  through the design system's `EChart`; each chart has a table of the same numbers under it.
- The request and response schemas of these reads were already exported from
  `@endora-commerce/contracts`; they are served now.

