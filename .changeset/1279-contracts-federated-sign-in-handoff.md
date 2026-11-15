---
'@endora-commerce/contracts': minor
---

Issue #1279 — the federated customer sign-in hand-off, for storefronts served from another host than the API.

- `FEDERATED_SIGN_IN_COMPLETE_PATH` (`'/auth/federated/complete'`), the storefront landing route the customer OAuth callback sends the browser to with a single-use `?code=`, and `FEDERATED_SIGN_IN_HANDOFF_TTL_SECONDS` (`60`), how long that code can be redeemed.
- `customerFederatedSignInStartQuerySchema` — the customer `start` query: optional `next` (at most 2048 characters) and `salesChannel`, and the required `binding`, the lower-case hex SHA-256 of the secret the storefront keeps in its own binding cookie.
- `federatedSignInExchangeRequestSchema` (`.strict()`: `code` and the raw `binding` secret, both 43-character base64url) and `federatedSignInExchangeResponseSchema` — `{ data: { status: 'authenticated', redirectPath, cartMerge } }` with the session in `Set-Cookie`, or `{ data: { status: 'mfaRequired', challengeId, redirectPath } }`. `redirectPath` is root-relative and never `//`.
- `ERROR_CODES.MFA_FEDERATED_HANDOFF_INVALID`, the one refusal of the exchange.
- The types `CustomerFederatedSignInStartQuery`, `FederatedSignInExchangeRequest` and `FederatedSignInExchangeResponse`.
