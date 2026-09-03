---
title: invoices
description: PDF invoice / proforma generation + asset linkage
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

## Numbering

Two facts about an invoice number pull in opposite directions, and both are
deliberate:

- the **sequence** is drawn per `(sales channel, kind, year)`, gap-free, under a
  row lock — `invoice_number_counters`;
- the **number** is unique across the whole platform — `invoices_number_unique`.

What turns the first into the second is a pattern, held in a Setting per
document kind and scopable per sales channel:

| Kind | Setting | Default |
| --- | --- | --- |
| VAT invoice | `invoices.numbering.invoice.pattern` | `FV {seq}/{channel}/{YYYY}` |
| Proforma | `invoices.numbering.proforma.pattern` | `PRO {seq}/{channel}/{YYYY}` |
| Correction | `invoices.numbering.correction.pattern` | `KOR {seq}/{channel}/{YYYY}` |

### Tokens

| Token | Renders |
| --- | --- |
| `{seq}` | the drawn sequence number |
| `{seq:N}` | the same, zero-padded to width `N` |
| `{channel}` | the sales channel's `code`, uppercased |
| `{YYYY}` / `{YY}` | the issue year, 4 or 2 digits |
| `{MM}` | the issue month |

Everything else is literal text. The channel `code` is immutable and unique, so
a number already rendered through `{channel}` can never be invalidated by a
rename; keep a separator on both sides of it, because `FV {channel}{seq}` loses
the boundary between two variable-length fields and renders `FV A12` for both
(`a1`, 2) and (`a`, 12).

### Three refusals, and which one is the guarantee

Because the sequence is per channel and the number is not, two channels whose
patterns can render one string are a duplicate waiting to happen. Three layers
stand between that and a customer's document:

1. **The shipped default carries `{channel}`**, so creating a sales channel
   does not arm a collision. The system-default channel is pinned once, at boot,
   to the historical `FV {seq}/{YYYY}` — an existing deployment's series does not
   change shape — and only while nobody has configured the setting.
2. **`400 INVOICE_NUMBER_PATTERN_COLLIDES`** on the settings write, naming the
   channel the pattern collides with. It refuses a *possible* collision: at a
   configuration write nothing is at stake, so a conservative refusal costs one
   edit.
3. **`409 INVOICE_NUMBER_ALREADY_ISSUED`** at issuance, naming the channel that
   already holds the number. This is the guarantee — it is the one chokepoint
   every number passes through — and it refuses only an *actual* duplicate. The
   transaction rolls back, so the counter draw is undone and no gap is left.

A deployment that is already configured into a collision is reported at boot,
once per colliding pair, and is **not** blocked: a fixable invoicing
misconfiguration must not become a storefront outage.

## Extension points

- **Numbering scheme** — `services/invoice-number-generator.ts` renders the
  pattern (`formatInvoiceNumber`) and draws the sequence;
  `services/invoice-number-collisions.ts` decides whether two channels can
  render one string. Add a token in the first and the probe grid in the second
  will compare it.
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
