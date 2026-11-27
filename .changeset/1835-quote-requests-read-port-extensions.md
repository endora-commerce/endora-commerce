---
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/contracts': minor
---

`QuoteRequestReadPort.findById`, `findByBusinessId` and `findByIds` accept a trailing `options?: EntityExtensionReadOptions` and return `WithEntityExtensions<QuoteRequestRecord>` (`specs/187-side-table-extensions/` B2). `include: ['extensions.<moduleId>']` attaches that module's side-table values for `quote_requests.QuoteRequest` to the quotes found under the caller's scope, through the platform's `entityExtensionReads`. Additive: without `include` every method answers exactly what it answered before.
