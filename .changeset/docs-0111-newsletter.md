---
'@endora-commerce/mod-newsletter': patch
---

The module's documentation page describes the sending provider as it works: the SMTP connection is an Email adapter credential chosen in `newsletter.email_credentials`, the provider screen holds the sender and send rate, and without a credential campaign e-mail goes to the console sink rather than being refused with `NEWSLETTER_PROVIDER_NOT_CONFIGURED`. Deactivating a subscriber is listed among the audited actions. English and Polish.
