---
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/contracts': minor
---

The quote request screen shows its opportunity.

`quote_requests` mounts a new admin zone, `quote_request.detail.after`
(`QuoteRequestDetailZoneProps { quoteRequestId }` in the contracts), once at the
end of a quote request's screen. It names no contributor: with nothing
contributed the zone renders nothing and the screen is exactly as it was.

CRM contributes the panel the order screen already has, for a quote request:
the linked opportunity, or — for a holder of `crm:write` — linking to an open
opportunity of the request's organization and creating one that is linked when
it is saved (`linkDocumentKind=quote_request` on the create form).
`GET /api/v1/admin/crm/documents/quote_request/:id/opportunity` now answers for
that kind — `crm:read` and `rfqs:handle`; `503 MODULE_DISABLED` while the Quote
Requests module is off — where it answered `422`.

Attaching a media-library file to an opportunity by its id
(`POST …/attachments { assetId }`) now needs `assets.read` as well as
`crm:write`. Uploading a file is unchanged.
