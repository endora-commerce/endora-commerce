---
'@endora-commerce/mod-import-export': minor
---

**Breaking — the products CSV addresses scopes by column, and the old per-language headers refuse the whole file (feature 174).**

- Headers are `<field>`, `<field>@<channel code>` and `<field>@<channel code>/<language>`; cells use the write encoding: an empty cell is no change, `NULL` (whole cell) is deliberately empty, `INHERIT` removes the own value, and `\NULL` / `\INHERIT` are the literal words. Export writes the tokens; the formula guard `'` is added on export and stripped on import, on select, enum and multiselect cells too.
- **A file with a 163 per-language header such as `name_en` or `description_pl` is refused as a whole.** Rename each to the scope it should write — `name_en` becomes `name@<channel>/en-US`, or `name` for the Global value — before importing.
- **Import profiles** (`/api/v1/admin/import-export/profiles`, `catalog:write`) map a source file's locales and channels to scopes; `GET /api/v1/admin/import-export/channel-targets` lists the channels a mapping may target.
- The import report is capped and carries `truncated: { errors, fieldErrors }`; the 10 MiB body limit applies to `POST /api/v1/admin/import/products` only.
- The report's `imported` counts a row only when at least one of its cells applied: a row whose every cell was refused (a field error each) counts 0. A row error that refuses the whole product is shown by its label in the admin, never as a raw code.
- A non-empty cell under a Page Builder content attribute's `attribute:<key>` column is refused as the field error `content_attribute`; the rest of the row is imported.
