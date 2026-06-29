# Invoices module (feature 047)

Generates, numbers, renders, corrects, and emails invoices for orders.

## What works today

- **Issuance** — manual (`POST /api/v1/admin/orders/:orderId/invoices`) and
  automatic when an order reaches the configured trigger status
  (`invoices.auto_issue.trigger_status`, per channel). Idempotent per
  `(order, kind)`; blocked with 422 when seller settings are missing.
- **Numbering** — gap-free, row-locked counter per `(sales_channel, kind, year)`
  with a configurable pattern (`invoices.numbering.<kind>.pattern`) supporting
  `{seq}`, `{seq:N}`, `{YYYY}`, `{YY}`, `{MM}`. Resets yearly.
- **PDF** — pdfmake renderer with a built-in generic layout modelled on the
  reference invoice (seller w/ NIP + bank, buyer, line table, per-rate VAT
  summary, totals, amount-in-words, KSeF area). Rendered on demand. KSeF is
  **layout-ready only** — no live integration.
- **Corrections** — the returns `CorrectiveInvoicePort` draws correction-sequence
  numbers (when an original invoice exists), references the original, snapshots
  corrected lines, and caps the credited total at the original gross.
- **Email** — `invoice_issued` transactional-email definition (admin-editable via
  the `transactional_emails` module); sent on issue (per channel) or on demand,
  with the PDF attached (`attachment` mode) or a storefront download link
  (`link` mode). Idempotent, best-effort.
- **Customer access** — `GET /api/v1/orders/:id/invoices` and `.../:invoiceId/pdf`
  (ownership-guarded); surfaced on the storefront order page.
- **WYSIWYG templates (US6)** — a seeded global generic template + optional
  per-channel templates, authored in a dedicated Puck editor in the admin
  (`/invoices/templates`). The PDF renderer maps the template's Puck tree to
  pdfmake sections (`InvoiceHeader`, `InvoiceParties`, `InvoiceLineItems`,
  `InvoiceVatSummary`, `InvoiceTotals`, `InvoiceNotes`, `InvoiceKsef`), falling
  back to the built-in layout when no valid template applies (FR-016). Endpoints
  under `/api/v1/admin/invoice-templates` (list/get/create, `PUT content/:lang`,
  `GET .../preview`, page-builder config).
- **Settings** — seller VAT/NIP + company data (JSON), numbering patterns,
  auto-issue trigger, email toggle + delivery mode, storefront base URL — all
  global + per-channel.

## Settings

`invoices.seller.tax_id`, `invoices.seller.company_data`,
`invoices.auto_issue.trigger_status`, `invoices.email.send_on_issue`,
`invoices.email.delivery_mode`, `invoices.numbering.{invoice,proforma,correction}.pattern`,
`invoices.storefront_base_url`.

## Permissions

`invoices:read`, `invoices:write`.

## Deferred / follow-ups

- The invoice Puck config lives in the **admin module** (not
  `packages/cms-components`) — invoice authoring is admin-only and the real
  layout is server-side pdfmake; this avoids coupling invoice components into the
  shared CMS/email component package.
- Invoice lines currently itemize **products only**; delivery/discount lines are
  not yet itemized (totals are internally consistent).
- Audit-log entries are written on issue (`invoice.issued`) and correction
  (`invoice.corrected`).
- PDF is rendered on demand; caching into `assets_library` (`pdf_asset_id`) is a
  future optimization.
- A dedicated admin invoice detail page (management actions live on the list).
