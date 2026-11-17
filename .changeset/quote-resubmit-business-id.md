---
"@endora-commerce/mod-quote-requests": patch
---

A re-submitted quote request draws its number from the business-id generator like any other request. It used to keep the entity's `QR-<uuid>` placeholder, which then appeared in the admin notifications, the request lists, its PDF and its e-mails. Requests already re-submitted keep the number they have.
