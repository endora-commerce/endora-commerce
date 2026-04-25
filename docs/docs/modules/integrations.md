---
title: integrations
---

# `integrations`

Stores per-vendor credentials (`encryptedConfig`) for external systems.
Per-vendor adapters live outside the core; this module is the credential
+ status registry they read.

## Public surface

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/integrations` | List configured integrations |
| `POST /api/v1/admin/integrations` | Create + run synchronous `testConnection` |
| `PATCH /api/v1/admin/integrations/:id` | Update name / config / status |
| `DELETE /api/v1/admin/integrations/:id` | Remove (encrypted blob is deleted) |
| `POST /api/v1/admin/integrations/:id/test` | Re-run the connection test on demand |

## Entities

`ExternalIntegration` (kind, vendor, encryptedConfig, status, lastTestedAt,
lastError). Config never leaves the row decrypted; only the per-vendor
adapter exposes a method that reads it.

## Test-connection contract

`testConnection(integrationId)` resolves to
`{ ok, status, testedAt, message? }`. On failure it sets
`status='error'` and records `lastError`; on success it transitions to
`'active'`. The synchronous run during create surfaces credential typos at
configuration time rather than first traffic.

## Extension points

- **Per-vendor adapter** — implement an adapter that takes a decrypted
  config and registers itself under `kind/vendor`; the
  `integration-service` looks up by these.
- **Encryption-at-rest** — the encryption helper is pluggable for KMS /
  HSM environments; default uses AES-256-GCM with a key from
  `INTEGRATION_ENCRYPTION_KEY`.
