---
'@endora-commerce/mod-projects': patch
---

A linked quote request's amount is the one `quoteRequestReadPort.amountOf` publishes (issue #456).
- The link carries `agreement`, and the Linked records tab marks the quote request "Partially agreed" or "Not yet agreed".
- A quote request without any price shows `—`.
- Each line value is now rounded to the cent before the sum, as the quote desk and CRM do. Projects used to round the sum only.
