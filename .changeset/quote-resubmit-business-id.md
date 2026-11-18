---
"@endora-commerce/mod-quote-requests": patch
---

A re-submitted quote request draws its number from the business-id generator like any other request. It used to keep the entity's `QR-<uuid>` placeholder, which then appeared in the admin notifications, the request lists, its PDF and its e-mails.

**Behaviour change on upgrade.** A migration gives every request still named by a `QR-<uuid>` placeholder a number from the sequence, oldest first, wrapped in the configured prefix and suffix. Numbers that are not the placeholder are never touched. Texts already rendered from a placeholder — sent e-mails, downloaded PDFs, stored notification titles — keep it.
