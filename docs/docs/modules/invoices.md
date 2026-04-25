---
title: invoices
---

# `invoices`

Generates proforma and final invoice PDFs, registers them under the
`assets` module, and links them from the originating Order.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/orders/:id/invoice` | customer | Download invoice PDF (404 until generated; binary Content-Type once ready) |
| `POST /api/v1/admin/orders/:id/invoice/regenerate` | admin | Force a fresh PDF |
| `GET /api/v1/admin/invoices` | admin | List all invoices |

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
