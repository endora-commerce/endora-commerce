---
'@endora-commerce/mod-mfa': minor
---

Issue #1279 — federated (Google / Microsoft) customer sign-in completes on the storefront's own host, so it works when the API is served from another host.

- `GET /api/v1/auth/customer/oauth/:provider/start` requires `binding` (`customerFederatedSignInStartQuerySchema`); without it the browser is sent to `/login?error=sign_in_failed` and a warning names the parameter. The digest is kept with the OAuth transaction.
- The customer callback sets no `b2b_session`, `b2b_mfa_challenge` or `b2b_cart_merge_flash`. After the same checks as before (binding, provider code, account, sales-channel access, second-factor decision) it stores a single-use hand-off in Redis (`mfa:oauth:handoff:<sha256 of the code>`, 60 seconds) and redirects with `Referrer-Policy: no-referrer` to `<origin>/auth/federated/complete?code=…`. `<origin>`, and the origin of every customer `/login?error=…` redirect, is the started-on channel's `sales_channels.storefront_url`, else `STOREFRONT_BASE_URL`.
- New `POST /api/v1/auth/customer/oauth/exchange` (`salesChannelAccess: 'open'`, 120 requests a minute per client address, `503 MODULE_DISABLED` while the module is off). It takes the code with `GETDEL`, then checks the binding, the request's sales channel and the account's pending-sign-in generation; any failure is `400 MFA_FEDERATED_HANDOFF_INVALID`. A session hand-off creates the session (`Set-Cookie: b2b_session`) and runs `customerSignInCompletionPort` over the forwarded cookies, so the signed-out basket is carried over here rather than in the callback; a challenge hand-off answers its `challengeId`. Nothing secret is logged.
- `ChallengeStore` gains `issueFederatedHandoff`, `takeFederatedHandoff` and `isCurrentGeneration`; `MfaModuleOptions` gains `readChannelStorefrontUrl`.
- The module ships its documentation page (`docs/mfa.md`): the redirect URIs to register, `MFA_OAUTH_*`, and the per-channel storefront address. `MFA_FEDERATED_HANDOFF_INVALID` is declared in the manifest with its EN and PL sentences.
- The Admin UI's federated sign-in is unchanged.
