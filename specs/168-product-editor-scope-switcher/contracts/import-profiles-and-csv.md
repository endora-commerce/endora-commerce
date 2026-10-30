# Contract: import profiles and the products CSV (FR-043, FR-048, FR-110…FR-114)

Owner: `import_export` (profiles, CSV codec use, adapter); `catalog` (`catalogBulkImportPort`). Decision: research
R14. Data: `data-model.md` §11.

## 1. Profile routes — all `catalog:write` (no new permission code)

| Route | Command | Body / answer |
| --- | --- | --- |
| `GET /api/v1/admin/import-export/profiles?entity=products` | — | `{ data: ImportProfile[] }` |
| `GET /api/v1/admin/import-export/profiles/:id` | — | `{ data: ImportProfile }` |
| `POST /api/v1/admin/import-export/profiles` | `import_profile.create` | `{ name, entity: 'products', sourceLanguageForGlobal, localeMapping }` → `201 { data }` |
| `PATCH /api/v1/admin/import-export/profiles/:id` | `import_profile.update` | partial of the above |
| `DELETE /api/v1/admin/import-export/profiles/:id` | `import_profile.delete` | `204` |

`ImportProfile = { id, name, entity, sourceLanguageForGlobal: string | null, localeMapping:
PimLocaleMappingEntry[], createdAt, updatedAt }` (`packages/contracts/src/import-export.ts`, new section).
Name unique case-insensitively → `409 IMPORT_PROFILE_NAME_TAKEN`. Unknown id → `404 IMPORT_PROFILE_NOT_FOUND`.
Target channel ids are not validated against current channels at save (a deleted channel is reported per row at
import, FR-042); the admin warns on a target whose channel no longer exists. Routes are gated by the any-of gate
**and** `requireAdmin('catalog:write')` (literal, inventory-visible).

## 2. Import

`POST /api/v1/admin/import/products?profileId=<uuid>` — `profileId` required for products (`422
IMPORT_PROFILE_REQUIRED`); other entities unchanged.

### 2.1 Column grammar (header row)

| Column | Meaning |
| --- | --- |
| `sku` | key (unchanged) |
| `name`, `description`, `urlKey`, `status`, `attribute:<key>`, and the other Global fields of today's file | Global value |
| `<field>@<channel code>` | the Channel scope |
| `<field>@<channel code>/<language>` | the C×L scope (only for fields whose set has CL) |
| `<field>[<locale>]`, `<field>[<locale>\|<source channel>]` | a source-locale value, mapped by the profile (`pim-locale-mapping.md` §2); the profile's `sourceLanguageForGlobal` locale writes Global |

Unknown channel code or a language the channel does not offer in a **header** → file error (no row imported).

### 2.2 Cells

Decoded with `decodeCsvScopedCell` (`write-encoding.md`): empty = no change, `NULL` = empty, `INHERIT` = inherit,
`\`-escaped text. Refusals (`required_empty`, `not_emptyable`, `inherit_at_global`) are field errors in the report;
the row's other fields apply. A scope column and a mapped locale column landing on the same (field, scope) in one
row → row error `IMPORT_CELL_CONFLICT`. A mapped target the product is not valid for → reported for that row
(FR-042). Unmapped locale columns → one run warning per locale naming the count of affected products (FR-041,
SC-005). Protection does not exist for CSV (it is a PIM-connector concept, FR-046).

### 2.3 Report additions

`BulkImportReport` gains `warnings: Array<{ kind: 'unmapped_locale'; locale; sourceChannel; products: number }>`
and per-row `fieldErrors: Array<{ column; code }>`.

## 3. Export

`GET /api/v1/admin/export/products.csv` writes `sku`, every Global column, and one `<field>@<channel>` /
`<field>@<channel>/<language>` column per (field, scope) where **any** exported product holds an own value; a
product without an own value there gets `INHERIT` in that column; a deliberately empty value `NULL`; text that
equals a token is escaped. Export uses no profile. Export → re-import of the unchanged file (with any profile)
writes nothing (FR-114; test `backend/test/integration/import_export/products-csv-roundtrip.test.ts`).

## 4. Admin

The `/import-export` page gains an **Import profiles** section (list, create / edit dialog with the mapping table
— source locale, source channel, target channel × language multi-select from the channels API — and the source
language for Global; delete with confirmation) and a profile `Select` in the products import step, required.
Shown only with `catalog:write`. i18n keys under `importProfiles.*` in `import_export/i18n/{en,pl}.json`. The
`open-import-export-center` action gains keywords `profile`, `profil`, `mapping`, `mapowanie`; no new route, so
`palette-coverage.test.ts` needs no new action or exemption.

## 5. Off state (XVII)

`import_export` off: profile routes answer the module-disabled refusal like every other route of the module; the
section and the palette action are absent; profiles are kept and come back on re-activation. Test:
`backend/test/contract/import_export/import-profiles-off-state.test.ts`.
