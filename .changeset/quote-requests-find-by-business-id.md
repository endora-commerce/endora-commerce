---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-quote-requests': minor
---

`QuoteRequestReadPort` gains `findByBusinessId(businessId)`, answering the quote carrying a
human-facing business id or `null`.

It exists because `comarch_xl` needs it: an ERP offer names the quote it answers by the
reference a person read off the document, never by the uuid. The connector had been reading
`quote_requests` with a raw `select`, which crosses the module boundary without any
specifier naming it and keeps returning rows after an operator has switched
`quote_requests` off. Consumers resolve it through the container name
`quoteRequestReadPort`, as they do the other three methods.
