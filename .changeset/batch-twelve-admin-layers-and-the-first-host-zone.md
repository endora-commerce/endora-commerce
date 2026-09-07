---
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-ksef': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-i18n': minor
---

`invoices`, `ksef` and `quote_requests` ship their admin surfaces, and the first zone whose
host is a module package.

**New `./admin` subpath on three packages.** `@endora-commerce/mod-invoices`,
`@endora-commerce/mod-ksef` and `@endora-commerce/mod-quote-requests` each export
`contributions` — an `AdminContributions` object — from `@endora-commerce/mod-<id>/admin`, and
nothing else. Eight routes and three sidebar entries between them, all at the paths and codes
the hand-written host registrations carried:

- `mod-invoices` — `/invoices` (the landing route), `/invoices/templates`,
  `/invoices/templates/:id` and `/invoices/:id`, all on `invoices:read`, which is the code
  every `GET` behind those four screens enforces; each screen keeps gating its own writes on
  `invoices:write` inside itself. One sidebar row, in the `sales` section at weight 500. The
  two template screens deliberately have no row: they are reached through
  `InvoiceSectionTabs`, which this package already owned.
- `mod-ksef` — `/ksef` on `ksef:read`. One sidebar row, `sales`, weight 600. Its glyph is
  `Receipt` rather than the `ReceiptText` the host table rendered by hand, because
  `KnownIconNameSchema` does not carry the second and `Receipt` is what this module's
  `open-ksef` palette action has always named.
- `mod-quote-requests` — `/quote-requests` (the landing route), `/quote-requests/new` and
  `/quote-requests/:id`, all on `rfqs:handle`, which is the module's only code and the one
  its admin routes build a single guard from. One sidebar row, `sales`, weight 400.

Route components are dynamic-import factories, so a consumer's bundler emits one chunk per
screen, and every screen resolves its design system through `@endora-commerce/admin-kit`.

**`@endora-commerce/contracts` gains one zone member and its props.**
`AdminZoneNameSchema` carries `'invoice.detail.after'` and `AdminZonePropsMap` maps it to the
new exported interface `InvoiceDetailZoneProps { invoiceId: string; kind: InvoiceKind;
ksefReferenceNumber: string | null }`. Additive: no existing member, props type or export
changes. A host mounts it with

```tsx
<AdminZone
  name="invoice.detail.after"
  props={{ invoiceId, kind, ksefReferenceNumber }}
/>
```

and a contributor declares
`zoneComponent('invoice.detail.after', () => import('./MyPanel.js'), { weight, requiredPermission })`,
whose module's default export is constrained to `ComponentType<InvoiceDetailZoneProps>`.

**`@endora-commerce/mod-ksef` publishes the first contribution into another package's screen.**
`InvoiceKsefPanel` is a zone component now — same rendering, same `ksef:read` gate, same
proforma guard — and `@endora-commerce/mod-invoices` renders the place rather than importing
the panel. Neither package names the other in any specifier. It is a zone and not a published
component because the panel's signature is three values in and nothing out; and it carries no
`match`, because the place has a single host and a single mount, and `match` has no negation to
write "not a proforma" with.

**`@endora-commerce/mod-i18n` loses four keys nothing renders any more** —
`appShell.nav.invoices`, `appShell.nav.ksef`, `appShell.nav.quoteRequests` and
`appShell.palette.sub.customerRfqs`. Each module's sidebar label is module-relative now
(`nav.invoices.label`, `nav.ksef.label`, `nav.quoteRequests.label`) and ships in that module's
own `i18n/` bundle in both shipped languages.
