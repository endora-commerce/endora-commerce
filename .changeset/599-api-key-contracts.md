---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-api-keys': patch
---

API key replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes `apiKeyListResponseSchema` / `ApiKeyListResponse` for `GET /api/v1/admin/api-keys`, a `data` array of `apiKeySchema` rows. The rows were already described, but the list envelope was not.
- `mod-api-keys` builds every key reply as the contract's `ApiKey` instead of `Record<string, unknown>`. The list handler returns `ApiKeyListResponse` and the create handler returns `{ data: CreateApiKeyResponse }`. The admin API keys page uses the contract's `ApiKeyListResponse` instead of a hand-written interface. Nothing on the wire changes.
