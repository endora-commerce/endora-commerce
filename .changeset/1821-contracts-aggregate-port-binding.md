---
'@endora-commerce/contracts': minor
---

Each entry of `CUSTOM_FIELD_HOST_BINDINGS` now names its aggregate's write port in a new
`aggregatePort` field (`specs/186-aggregate-ports/`, issue #1821): `organizationCommandPort`,
`customerAccountCommandPort`, `orderCommandPort`, `quoteRequestCommandPort`,
`catalogProductCommandPort`, `catalogCategoryCommandPort`, `opportunityCommandPort`,
`projectCommandPort` and `taskCommandPort`. `CustomFieldHostBinding` gains the same required
member. It is a container name, the port a server-side custom-field write goes through once that
aggregate's port lands; it does not mean the port is registered yet. Code that only reads the
bindings needs no change. Code that builds a `CustomFieldHostBinding` value by hand now has to
supply `aggregatePort`.
