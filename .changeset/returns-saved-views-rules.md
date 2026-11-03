---
'@endora-commerce/mod-returns': minor
'@endora-commerce/contracts': minor
---

**Behaviour change for API clients** — the saved views of the admin Returns list follow the rules
of the order, product and quote request lists' saved views (#312), and the Returns list gains the
*Saved views* control.

`GET`/`POST /api/v1/admin/returns/list-views` and `PATCH`/`DELETE /api/v1/admin/returns/list-views/:id`
stay gated by `returns:read`, and change as follows:

- **`PATCH` and `DELETE` with an id that is not a UUID answer `404 NOT_FOUND`** (was `500 INTERNAL`).
- **Another admin's private view answers `404 NOT_FOUND`** on `PATCH` and `DELETE` (was `403 FORBIDDEN`),
  so a view the caller may not see is indistinguishable from one that does not exist.
- **A shared view can be changed or deleted by its owner or by a platform admin** — an admin whose
  access is not restricted to a set of organizations. Anyone else gets `403 FORBIDDEN` (before, only
  the owner could).
- **Names are stricter**: trimmed before they are stored, 1–160 characters (was 1–200, untrimmed, so
  `"   "` was accepted), and without control or format characters; a name breaking these answers
  `400 VALIDATION_FAILED`.
- **New `409 RETURN_SAVED_VIEW_NAME_TAKEN`** on `POST`, and on a `PATCH` that changes the name, when the
  view's owner already holds a view on the return list whose name differs only by letter case or
  surrounding spaces. The message is translated (English and Polish). Two admins may each use a name.
- **Size caps** — `filters` at most 8 KB of JSON (UTF-8), `visibleColumns` at most 64 entries of at
  most 64 characters, `sort.field` at most 64 characters; over a cap answers `400 VALIDATION_FAILED`.
- **`shared` is required on `POST`** (was optional, defaulting to `false`), as on the other lists;
  `sort` stays required.
- **List items and write answers carry `ownerAdminUserId`, `ownedByCaller` and `canModify`**, and the
  list is ordered by name (was by creation time).
- **`DELETE` answers `{ "data": { "deleted": "<id>" } }`** (was `{ "data": { "ok": true } }`).

Views saved before this release are kept exactly as stored — a blank name, a name over 160
characters or two names of one owner sharing a key included. No migration rewrites them: they are
listed as they are, a `PATCH` that leaves the name alone is never refused for it, and renaming one
must meet the rules above.

`@endora-commerce/contracts`: `returnSavedViewSortSchema`, `returnSavedViewSchema`,
`ReturnSavedViewDto`, `returnSavedViewCreateSchema` and `returnSavedViewUpdateSchema` are removed.
Use `createReturnSavedViewRequestSchema` and `updateReturnSavedViewRequestSchema` (with the types
`CreateReturnSavedViewRequest` and `UpdateReturnSavedViewRequest`) for the requests, and the shared
`savedListViewSchema` / `SavedListView` for a view. `ERROR_CODES.RETURN_SAVED_VIEW_NAME_TAKEN` is new.
