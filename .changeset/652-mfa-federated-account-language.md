---
'@endora-commerce/mod-mfa': patch
---

A federated (Google, Microsoft) customer sign-in records the language of the page it was started on, resolved against that sales channel: on the account it creates, and on an existing account that has none yet, once the sign-in has been accepted and before any second factor (issue #652). A language the account already has is never replaced, and a failed capture is logged without failing the sign-in. `SocialIdentityDeps.autoCreateCustomer` and `CustomerSignInContext` accept an optional `preferredLanguage`.
