---
title: invoices
---

# `invoices`

Generates proforma and final invoice PDFs, registers them under the
`assets` module, and links them from the originating Order.

## Public surface

Admin list is gated by `orders:read`.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/orders/:id/invoice` | customer | Download invoice PDF (404 `INVOICE_NOT_READY` until status='ready'; binary Content-Type once ready). Admin uses the same endpoint via the storefront origin to re-download. |
| `GET /api/v1/admin/invoices` | admin | List all invoices with `filter[status]` / `filter[orderId]`; default limit 50, capped at 200 |

## Generation flow

`invoice-service.ts#generate()` runs after `order.confirmed`: pulls the
Order + items + buyer Address snapshot, renders a PDF via a small,
dependency-light renderer, persists the bytes through the `assets` module,
and writes the asset id back onto the Order. Failures emit
`invoice.generation_failed.v1` for an admin retry queue.

## Entities

`Invoice` (number, issued/dated timestamps, asset reference,
`type ∈ {proforma, final}`).

## Extension points

- **Numbering scheme** — `invoice-numbering.ts` exposes a single
  `nextNumber(date, scope)` function; localize numbering rules there.
- **e-invoicing** — for KSeF / Peppol / similar, plug a sender adapter
  that consumes `invoice.issued.v1` events.

## PDF templates (page builder)

Admin route `/invoices/templates` edits a Puck tree of invoice sections
(`InvoiceHeader`, `InvoiceParties`, line/VAT tables, totals, notes, KSeF,
plus layout blocks: spacer, divider, logo, footer). Section props
personalize typography, column visibility, and labels; missing props keep
the historical default layout.

- `GET /api/v1/admin/invoice-templates/:id/preview` — PDF of the **saved**
  template content for that id (sample invoice fixture).
- `POST /api/v1/admin/invoice-templates/:id/preview` — same, with a draft
  `{ data }` body so authors can preview unsaved canvas state.
- Runtime issue path still uses `resolveTree(salesChannelId)` (active
  channel/global template).
