---
title: import_export
description: CSV import / export for bulk-edit entities
---

# `import_export`

CSV import and export for the bulk-edit cases. Owns a small RFC-4180 codec
(no new dependency) and a per-entity adapter registry.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/import-export/entities` | admin (any entity code below) | The entities this caller may use, with `canExport` / `canImport` |
| `GET /api/v1/admin/export/:entity.csv` | admin (the entity's export code) | Streaming CSV download with attachment headers |
| `POST /api/v1/admin/import/:entity` | admin (the entity's import code) | Apply a `text/csv` body inside a single transaction |

## Supported entities

Each entity is gated by the permission that protects the same rows on the owning module's
own routes, so the centre opens nothing a role cannot already reach there. A caller must hold
at least one of these codes to reach the centre at all, and is offered only the entities whose
code they hold.

| Entity | Export | Import | Export code | Import code | Notes |
| --- | --- | --- | --- | --- | --- |
| `products` | ✓ | ✓ | `catalog:read` | `catalog:write` | Multilingual `name` / `description` collapse to a single locale (`en-US`); product `type` is immutable post-create |
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

## Import semantics

Every import runs inside one MikroORM transaction. If any single row
fails validation, the entire batch rolls back and the response surfaces a
row-numbered error report (1-based, excluding the header line, matching
what spreadsheet apps display). This makes re-uploads after a fix
deterministic.

```http
POST /api/v1/admin/import/products
Content-Type: text/csv

sku,status,visibility,name_en,description_en
SKU-001,active,public,Updated name,Updated description.
```

Response:

```json
{
  "data": {
    "imported": 1,
    "errors": []
  }
}
```

If a row fails (e.g. unknown SKU):

```json
{
  "data": {
    "imported": 0,
    "errors": [
      { "rowNumber": 3, "reason": "unknown sku: SKU-XYZ" }
    ]
  }
}
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
