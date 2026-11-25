---
'@endora-commerce/mod-quote-requests': minor
---

**`quoteRequestCommandPort` — server-side writes on a quote request** (issue #1824). Another module, an overlay or an integration worker creates, revises, assigns, approves and cancels a quote request, sets its custom-field values alone and e-mails its PDF through the published port, with the ambient actor (the system actor under `withSystemScope`) and an optional `source` code recorded in the audit entry. With `quote_requests` off, resolving the port answers `503 MODULE_DISABLED`; a consumer declares `quote_requests` in `dependencies` or as a `refuses-without` `nonBindingDependencies` edge.

The operator's writes are now Commands run on the Command Bus (Principle XIII), and the admin routes and the port run the same ones: `quote_request.create_on_behalf`, `.modify`, `.approve`, `.cancel` and `.assign` (previously hand-audited inside their transaction), plus the new `quote_request.custom_fields.update` for the port's values-only write. The admin endpoints answer, audit, notify and emit exactly as before; command hooks now see these writes, though none is declared hookable yet. `quote_request.send_document` accepts a `source` and command-hook `extensions` too.
