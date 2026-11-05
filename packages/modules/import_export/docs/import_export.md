---
title: import_export
description: CSV import / export for bulk-edit entities
---

# `import_export`

CSV import and export for the bulk-edit cases. Owns a small RFC-4180 codec
(no new dependency), a per-entity adapter registry and the **import profiles**
the products import maps source languages with.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/import-export/entities` | admin (any entity code below) | The entities this caller may use, with `canExport` / `canImport` |
| `GET /api/v1/admin/export/:entity.csv` | admin (the entity's export code) | Streaming CSV download with attachment headers |
| `POST /api/v1/admin/import/:entity` | admin (the entity's import code) | Apply a `text/csv` body (the products file at most 10 MiB; other entities the server's default limit) |
| `GET /api/v1/admin/import-export/profiles?entity=products` | admin (`catalog:write`) | List the import profiles |
| `GET /api/v1/admin/import-export/profiles/:id` | admin (`catalog:write`) | One import profile |
| `POST /api/v1/admin/import-export/profiles` | admin (`catalog:write`) | Create an import profile |
| `PATCH /api/v1/admin/import-export/profiles/:id` | admin (`catalog:write`) | Change an import profile |
| `DELETE /api/v1/admin/import-export/profiles/:id` | admin (`catalog:write`) | Delete an import profile |
| `GET /api/v1/admin/import-export/channel-targets` | admin (`catalog:write`) | The channels a profile may target: id, code and languages only |

## Supported entities

Each entity is gated by the permission that protects the same rows on the owning module's
own routes, so the centre opens nothing a role cannot already reach there. A caller must hold
at least one of these codes to reach the centre at all, and is offered only the entities whose
code they hold.

| Entity | Export | Import | Export code | Import code | Notes |
| --- | --- | --- | --- | --- | --- |
| `products` | ✓ | ✓ | `catalog:read` | `catalog:write` | Global, Channel and Channel × language columns; the import needs a profile and applies one product at a time; product `type` is immutable post-create |
| `categories` | ✓ | ✓ | `catalog:read` | `catalog:write` | Parents resolved by `parent_slug`; rows must list parents before children |
| `stock` | ✓ | ✓ | `inventory:read` | `inventory:write` | Operators only edit `on_hand`; reservations are read-only |
| `customers` | ✓ | — | `customers:read` | — | Import is intentionally unsupported — bulk account provisioning needs a password story that doesn't fit a CSV upload |
| `orders` | ✓ | — | `orders:read` | — | Orders are produced by the checkout flow; importing historical orders would bypass stock, payment, and credit-limit lifecycles |

A sales representative restricted to assigned organizations exports only those
organizations' customers and orders — the same rows the customers and orders lists show them.

The customers sheet has the columns `email`, `organization_name`, `first_name`, `last_name`,
`organization_role_name`, `organization_role_kind`, `email_verified_at` and `last_login_at`.
`organization_role_name` is the name of the role the account holds in its organization (the
English label for the predefined *Administrator* and *Member* roles, a custom role's own name).
`organization_role_kind` is `administrator`, `member` or `custom`. They replace the `role` column
(`organization_admin` / `regular_user`) of earlier releases.

## Import semantics (every entity except products)

The import runs inside one transaction. If any single row fails validation, the entire batch
rolls back and the response lists the errors by row number, the header line being row 1, which
matches what spreadsheet apps display. This makes re-uploads after a fix deterministic.

## The products import

### Import profiles

A products import always runs with an **import profile**:
`POST /api/v1/admin/import/products?profileId=<uuid>`. Without one the answer is
`422 IMPORT_PROFILE_REQUIRED`; an unknown id is `404 IMPORT_PROFILE_NOT_FOUND`.

A profile says:

- `sourceLanguageForGlobal` — the file locale whose values become the **Global** value
  (for example `en_US`), or `null` when no locale writes Global;
- `localeMapping` — for each source locale (and optionally a source channel), the sales channel
  and language pairs it writes to.

The profile is read once when the run starts, so editing it during a run changes nothing for
that run. Profile names are unique, ignoring case (`409 IMPORT_PROFILE_NAME_TAKEN`). In the
admin, the **Import profiles** section of the Import / Export screen lists, creates, edits and
deletes profiles; it is shown only to operators holding `catalog:write`.

### Dry run first

`&dryRun=true` parses, maps and validates the whole file, including the catalog's own checks,
and writes nothing. The admin screen always runs it first and shows, before **Apply import**:

- the number of rows that would be imported and refused;
- for each column, how many cells hold `NULL` and how many hold `INHERIT`;
- one warning per source locale the profile does not map, with the number of products affected;
- the refused rows and the refused cells.

### One transaction per product

Each product row applies in its own transaction. A refused row leaves the other rows applied,
and a refused cell leaves the rest of its row applied. Re-running the same file is safe: it
writes the same values again.

### Columns

| Column | Meaning |
| --- | --- |
| `sku` | The product key (required). |
| `id`, `slug`, `type` | Written by the export, ignored by the import. |
| `visibility` | Global only. |
| `name`, `description`, `urlKey`, `status`, `minOrderQuantity`, `returnable`, `attribute:<key>` | The **Global** value. |
| `<field>@<channel code>` | The **Channel** value, for example `name@pl_b2b_vip`. |
| `<field>@<channel code>/<language>` | The **Channel × language** value, for example `description@pl_retail/en-US`. Not for `minOrderQuantity` or `returnable`, which have no such level. |
| `<field>[<locale>]`, `<field>[<locale>\|<source channel>]` | A source-locale value, written where the profile maps that locale. |

`minOrderQuantity` is a number, `returnable` is `true` or `false`, and a multiselect attribute
lists its option values separated by `|`.

A Page Builder content attribute is edited on the product content screen only, so it is never
exported, and a non-empty cell under its `attribute:<key>` column is refused for that cell
(`content_attribute`); the rest of the row is imported.

A header that matches none of these rules, two headers naming the same column, an unknown
channel code or a language the channel does not offer refuses the **whole file**
(`400 VALIDATION_FAILED`, nothing imported). A file is also refused above 50 000 rows or
500 columns. A price column is refused: prices are set in price books.

**Upgrading from a file with per-language columns.** Before feature 174 the products file carried
one column per language, such as `name_en` or `description_pl`. Those headers now refuse the
whole file. Rename each to the scope it should write: `name_en` becomes `name@<channel>/en-US` for
each channel that sells in English, or `name[en_US]` with a profile that maps `en_US`.

### Cell values

| Cell | Meaning |
| --- | --- |
| empty | No change. |
| `NULL` (exactly, whole cell) | Deliberately empty. On `minOrderQuantity`: no minimum. On a multiselect: nothing selected. |
| `INHERIT` (exactly, whole cell) | Remove the own value and use the value of the level above. |
| `\NULL`, `\INHERIT` | The texts `NULL` and `INHERIT`. |
| anything else | The value. |

The tokens are upper case and must fill the whole cell: `null` or ` NULL ` is ordinary text.
`NULL` on a required field (`name`, `urlKey`, a required attribute), `NULL` on `status`,
`visibility` or `returnable`, and `INHERIT` on a Global column are refused for that cell.

**Formula guard.** Spreadsheet programs run a cell that starts with `=`, `+`, `-`, `@`, a tab or
a carriage return as a formula. The export therefore prefixes such a text with `'`, and the
import removes exactly one leading `'` from a text column. Select and multiselect columns count as
text here: their option values can come from a PIM. Numeric and boolean columns are never changed.

### Report

```json
{
  "data": {
    "imported": 2,
    "dryRun": true,
    "errors": [{ "rowNumber": 4, "reason": "unknown sku: SKU-XYZ" }],
    "fieldErrors": [{ "rowNumber": 3, "column": "name@pl_b2b_vip", "code": "required_empty" }],
    "cellCounts": [{ "column": "description@pl_retail/pl-PL", "null": 3, "inherit": 1 }],
    "warnings": [{ "kind": "unmapped_locale", "locale": "fr_FR", "sourceChannel": null, "products": 7 }]
  }
}
```

The report lists at most 1 000 row errors and 1 000 refused cells. When there are more, it also
carries `"truncated": { "errors": <all row errors>, "fieldErrors": <all refused cells> }`; fix the
listed ones and check the file again.

### Export

`GET /api/v1/admin/export/products.csv` uses no profile. It writes the Global columns and one
`<field>@<channel>` or `<field>@<channel>/<language>` column wherever any product holds its own
value. A product that inherits there gets `INHERIT`, a deliberately empty value `NULL`, and a
text equal to a token is escaped. Importing the exported file unchanged writes nothing new.

```http
POST /api/v1/admin/import/products?profileId=7c2e…&dryRun=true
Content-Type: text/csv

sku,name,name@pl_b2b_vip/pl-PL,description@pl_retail,minOrderQuantity
SKU-001,Drill X,Wiertarka X,NULL,5
```

## Extension points

- **New entity** — implement `ImportExportAdapter` (`name`, `owners`,
  `exportPermission`, `exportHeader`, `exportRows`, optional
  `importPermission` + `importHeader` + `importRows`), register it in
  `import-export-service.ts`, and add its codes to the any-of gate in
  `routes.ts` and the admin route's `requiredPermission`.
- **Different delimiter / Excel quirks** — extend `csv-codec.ts`. RFC
  4180 covers the common cases; if a real-world file fails, the codec is
  the single place to evolve.
- **Streaming export** — the in-memory loader fits hundreds of thousands
  of rows comfortably; for sustained million-row exports, swap
  `serializeCsv` for an async iterator that pipes into Fastify's
  `reply.raw`.
