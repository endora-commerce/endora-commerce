---
title: api_keys
---

# `api_keys`

Scoped bearer-token credentials for machine-to-machine integrations. The
plaintext token is shown once at creation; only its SHA-256 hash is stored.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/api-keys` | admin | List keys + last-used timestamps |
| `POST /api/v1/admin/api-keys` | admin | Create; returns the raw bearer **once** |
| `DELETE /api/v1/admin/api-keys/:id` | admin | Revoke |

External calls authenticate by sending `Authorization: Bearer sk_live_…`.
`requireApiKey(scope)` is a Fastify pre-handler exposed by the `api_keys`
plugin; route surfaces gate themselves with it
(`requireApiKey('catalog:write')`, etc.).

## Entities

`ApiKey` (name, keyHash, lastFour, scopes, status, lastUsedAt).

## Out-of-scope behaviour

A request with an authenticated key but the wrong scope returns
`403 API_KEY_OUT_OF_SCOPE` and writes an audit row with action
`api_key.out_of_scope` (per T220 contract test).

## Extension points

- **New scopes** — add the constant at the call site that introduces it;
  the service is scope-name-agnostic.
- **Per-key rate limit** — `api-key-service.authenticate` returns the key
  id; layer a per-key counter in the pre-handler or a downstream middleware.
