---
'@endora-commerce/mod-import-export': minor
'@endora-commerce/contracts': patch
---

An import of an export-only entity is refused with an error code of its own instead of
`VALIDATION_FAILED`, and a sentence in English and Polish (issue #644, part of #86). **A caller
that matches on `VALIDATION_FAILED` for this refusal now sees the specific code.** The HTTP status
is unchanged. Until now the answer was the English *"Import is not supported for "orders"."* in
every language, with the entity's machine slug inside the text.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/import/:entity` for an export-only entity (`customers`, `orders`) | `405 VALIDATION_FAILED`, *"Import is not supported for "<entity>"."* | `405 IMPORT_NOT_SUPPORTED` | `entity` |

The sentence does not name the entity; the slug travels as `details.entity`. A profile of another
entity and a products file whose shape is wrong stay `VALIDATION_FAILED`. The code is a member of
`ERROR_CODES` in `@endora-commerce/contracts`, declared by the `import_export` manifest, and the
module's documentation page names it. No setting, permission or migration changes.
