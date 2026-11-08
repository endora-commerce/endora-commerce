---
'@endora-commerce/mod-crm': patch
---

A linked quote request's value, and its share of a computed opportunity value, is the amount `quoteRequestReadPort.amountOf` publishes (issue #456); CRM no longer values the lines itself. A linked quote request carries `partiallyAgreed` and is marked "Partially agreed" on the opportunity's links. A quote request whose currency differs from the opportunity's is now left out as a whole, rather than counting its lines in the opportunity's currency.
