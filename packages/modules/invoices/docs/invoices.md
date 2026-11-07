---
title: Invoices
description: PDF invoice / proforma generation + asset linkage
---

# Invoices (`invoices`)

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

### Unit prices and line values

An invoice line carries the order line's **unit net price at up to four decimal places**
(`invoice_lines.unit_net_price`, `numeric(14,4)`), and its net value is the unit price × the
quantity rounded half-up to two places once — the order line's own net. The PDF's *Cena netto*
column shows the unit price with its significant places, up to four (0,0125), and two when the third
and fourth are zero; the value columns and the totals show two. A Polish invoice may state a unit
price this precisely: the VAT Act names the unit net price without fixing its decimal places.

### What a VAT invoice records as paid, and when it is not issued

A VAT invoice records as paid what was received for the order and kept:
each captured payment attempt, less everything refunded. An order recorded as
paid with nothing captured (a confirmed bank transfer), or with `payments`
absent, was received in its stored total. An order on credit terms is unpaid by
arrangement when it is invoiced, and nothing of it is counted as paid.

Every refund counts once, whichever way it was made:

- a refund through the payment gateway, as `payments` recorded it;
- a return settled with a **refund by bank transfer** (any order not paid
  through a gateway — the operator makes the transfer) or with a **credit to
  the credit limit**, as the return recorded it. A refund still waiting for a
  person to make it is not counted;
- an order an operator marked as **refunded** was refunded everything that was
  received for it: its whole total when nothing was captured, and what was
  captured otherwise — a refund settled by hand, for example after the gateway
  reported an amount the payment could not record. The mark is never added to
  refunds already recorded: a gateway refund on the payment counts once.

With the `returns` module switched off, only the refunds `payments` recorded
are deducted.

An order **refunded in full before it was invoiced** — the refunds equal what
was received and cover the whole order total — is not invoiced: there is no
sale left to document. Issuing answers `422 INVOICE_ORDER_REFUNDED` and draws
no number; automatic issuance skips the order and logs the reason. An order
refunded only in part is invoiced, with what was kept as paid.

An invoice issued **after a return was settled** lists only what the buyer
kept: there is no invoice yet to correct, so the invoice itself documents the
sale that is left. Each order line is invoiced at its ordered quantity less the
quantity of the order's settled returns (kind *return*, settled with a refund or
a credit), whether or not the money has been paid out yet; a line returned in
full is left off. A replacement, a repair and a complaint change no line. The
delivery, payment-surcharge and discount lines are the order's, unchanged, and
VAT is still calculated per rate on the sum of the nets. With the `returns`
module switched off, every line is invoiced at its ordered quantity.

The **amount due** is the gross less what was paid, and never negative. When
more was paid than the gross, the amount due is 0 and the invoice states the
difference as the **overpayment** (`overpayment` in the API, the
*Overpayment* row on the admin screen, *Nadpłata* on the PDF — the label is a
setting of the totals block, and the row can be hidden there).

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

## PDF templates

Invoice PDF layouts are designed in **Document templates → Invoice** (the
**Templates** tab of **Invoices** opens it; the former `/invoices/templates`
addresses redirect there). The invoice blocks — header, parties, line items,
VAT summary, totals, notes, spacer, divider, logo, footer — plus blocks other
installed modules contribute to invoices (a KSeF section) are the invoice
template's palette. Every invoice PDF — the administrator and customer
downloads, the regenerate, and the PDF attached to the invoice e-mail — is
produced from the default invoice template of the invoice's sales channel,
else the default for all channels, else the built-in invoice layout. Invoice
PDFs are printed in Polish.

The KSeF number is printed exactly once: by a placed block that prints it, or
otherwise by the header.

The former invoice-template administration API (`/api/v1/admin/invoice-templates*`)
is withdrawn; invoice templates are managed through
`/api/v1/admin/document-templates`. Invoicing cannot be switched on without
Document templates, and Document templates cannot be switched off while
invoicing is on.
