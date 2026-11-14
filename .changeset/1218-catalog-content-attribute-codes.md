---
'@endora-commerce/mod-catalog': minor
'@endora-commerce/contracts': patch
---

The two refusals that feature 172 added for Page Builder content attributes have error codes of
their own instead of `VALIDATION_FAILED`, and a sentence in English and Polish that names the
values in `details` (issue #1218, part of #86). **A caller that matches on `VALIDATION_FAILED` for
these refusals, or reads `details` as a list of `{ path, issue }` on the update, now sees the
specific code and an object.** No status changes: both stay as they were (`409` and `400`).

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `PATCH /api/v1/admin/catalog/attributes/:idOrKey` (type changed to or from `page_builder`) | `409 VALIDATION_FAILED`, `The value type of a Page Builder content attribute cannot be changed.` | `409 ATTRIBUTE_VALUE_TYPE_LOCKED`, token `page_builder` | `attributeKey` |
| `PATCH /api/v1/admin/catalog/attributes/:idOrKey` (a stored content attribute switches on a setting it holds off) | `400 VALIDATION_FAILED`, `details: [{ path, issue }]` per setting | `400 CONTENT_ATTRIBUTE_CAPABILITY_LOCKED` | `attributeKey`, `capabilities` (the settings, joined) |

On create, where the request itself names the `page_builder` type, a locked setting stays
`400 VALIDATION_FAILED` with one detail per setting. The other sites features 172 and 174 added
were reviewed and keep their answers: the content size ceiling, an unknown attribute set or
category, a malformed scope, URL key or import call stay `VALIDATION_FAILED`, and the scoped
editor's refusals already have codes. `CONTENT_ATTRIBUTE_CAPABILITY_LOCKED` is a new member of
`ERROR_CODES` in `@endora-commerce/contracts`, declared by the `catalog` manifest, which also
declares the token `page_builder` on `ATTRIBUTE_VALUE_TYPE_LOCKED`; the module's documentation
lists both. No setting, permission or migration changes.
