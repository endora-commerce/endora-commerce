---
'@endora-commerce/mod-projects': patch
---

A linked quote request's amount is the one `quoteRequestReadPort.amountOf` publishes (issue #456), and the link carries `partiallyAgreed`, shown as a "Partially agreed" marker on the Linked records tab. Each line value is now rounded to the cent before the sum, as the quote desk and CRM do; Projects used to round the sum only.
