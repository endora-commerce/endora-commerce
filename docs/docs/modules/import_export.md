---
title: import_export
---

# `import_export`

CSV import and export for the bulk-edit cases. Owns a small RFC-4180 codec
(no new dependency) and a per-entity adapter registry.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/export/:entity.csv` | admin (`catalog:write`) | Streaming CSV download with attachment headers |
| `POST /api/v1/admin/import/:entity` | admin (`catalog:write`) | Apply a `text/csv` body inside a single transaction |

## Supported entities

| Entity | Export | Import | Notes |
| --- | --- | --- | --- |
| `products` | ✓ | ✓ | Multilingual `name` / `description` collapse to a single locale (`en-US`); product `type` is immutable post-create |
| `categories` | ✓ | ✓ | Parents resolved by `parent_slug`; rows must list parents before children |
| `stock` | ✓ | ✓ | Operators only edit `on_hand`; reservations are read-only |
| `customers` | ✓ | — | Import is intentionally unsupported — bulk account provisioning needs a password story that doesn't fit a CSV upload |
| `orders` | ✓ | — | Orders are produced by the checkout flow; importing historical orders would bypass stock, payment, and credit-limit lifecycles |

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

- **New entity** — implement `ImportExportAdapter` (`name`,
  `exportHeader`, `exportRows`, optional `importHeader` + `importRow`)
  and register in `import-export-service.ts`.
- **Different delimiter / Excel quirks** — extend `csv-codec.ts`. RFC
  4180 covers the common cases; if a real-world file fails, the codec is
  the single place to evolve.
- **Streaming export** — the in-memory loader fits hundreds of thousands
  of rows comfortably; for sustained million-row exports, swap
  `serializeCsv` for an async iterator that pipes into Fastify's
  `reply.raw`.
