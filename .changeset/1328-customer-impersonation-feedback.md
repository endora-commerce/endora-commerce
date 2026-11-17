---
'@endora-commerce/mod-customers': minor
'@endora-commerce/admin-kit': minor
---

The admin customer detail's **Impersonate** now asks for an optional reason before it starts a support session, and sends it with the start, so it is stored outside the audit log. After the start the screen says the session is open, links to the storefront and offers **End support session**. It does not offer a second start while that session is open. A refused start stays in the dialog with the refusal (issue #1328).

The **E-mail language** row names the language in the admin's language, for example "English (US)", with the tag beside it.

`@endora-commerce/admin-kit/lib` exports `storefrontBaseUrl`, the storefront origin read from `VITE_STOREFRONT_BASE_URL` (default `http://localhost:3000`).
