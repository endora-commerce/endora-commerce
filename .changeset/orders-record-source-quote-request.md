---
'@endora-commerce/mod-orders': minor
---

An order placed from an accepted quote request records it.

`sourceQuoteRequestId` has been on the order's API shape and in `orders.source_quote_request_id`
since the first release and was always `null`. It is now set when the order is placed from the
basket a quote conversion seeded — and only after the quote request has been read back through
`quoteRequestReadPort`:

- it belongs to the **same organization** as the order;
- it is still `Approved`;
- the basket still holds at least one of its lines, the same product and variant at the agreed
  unit price.

When any of the three fails, the order is placed as usual and records nothing; the reason is
logged at `warn`. No request body carries the field — the storefront, `POST
/api/v1/admin/orders` and the external order API cannot name a quote request. No route and no
response shape changes; **a consumer that assumed the field is always `null` now sees a UUID**
on such orders, in `GET /api/v1/orders/:id`, the admin order reads, the external API and
`OrderRecord`.

**A new non-binding edge**: `quote_requests` / `quoteRequestReadPort`, `degrades-without`. With
the Quote Requests module switched off or not installed, orders are placed exactly as before
and record no quote request.

**Breaking for anyone composing the module by hand**: `OrdersModuleOptions` and
`OrderServiceNeighbourPorts` gain a required accessor, `quoteRequestRead: () =>
QuoteRequestReadPort | null`. Return `null` to get the previous behaviour. The packaged
composition supplies it.
