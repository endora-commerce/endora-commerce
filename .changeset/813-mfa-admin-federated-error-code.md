---
'@endora-commerce/mod-mfa': minor
---

**Breaking (redirect contract):** a refused federated sign-in on the Admin UI surface now redirects to `/login?error=<code>` with a bare `federatedSignInErrorCodeSchema` code (for example `/login?error=no_matching_account`), as the storefront surface has since #789. It used to redirect with a URL-encoded English sentence (`/login?error=No%20account%20matches%20this%20provider...`). The internal `ADMIN_LOGIN_ERROR_SENTENCE` table is removed. An Admin UI that prints `?error=` verbatim now shows the code; take `@endora-commerce/admin-kit` and `@endora-commerce/admin-shell` from the same release, which word it (issue #813).
