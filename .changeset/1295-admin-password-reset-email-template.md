---
'@endora-commerce/mod-customers': patch
---

The password-reset e-mail an operator sends with **Reset password** on the admin customer screen is now a transactional e-mail, `customer_password_reset_by_admin` (issue #1295). It was a hard-coded English message: it is now sent in the default sales channel's language, with English and Polish default content, and its wording and branding can be edited under **Transactional emails** like every other customer e-mail. It cannot be switched off, because it is how the customer gets back into the account. The plain English message is still sent when no template definition exists.

`mod-customers` now depends on `transactional_emails` and declares `@endora-commerce/email-components` as a peer dependency.
