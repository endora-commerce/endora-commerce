---
title: api_keys
description: Bearer-token integration credentials
---

# `api_keys`

Scoped bearer-token credentials for machine-to-machine integrations. The
plaintext token is shown once at creation; only its SHA-256 hash is stored.
A key may additionally carry a **distributor binding**
(Organization + Sales Channel + service Customer Account) and an optional
expiry, turning it into a partner credential for the `/api/v1/external/*`
namespace, which the *Partner API access* integration guide documents in full.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/api-keys` | admin | List keys + last-used timestamps, binding, expiry |
| `POST /api/v1/admin/api-keys` | admin | Create; returns the raw bearer **once** |
| `DELETE /api/v1/admin/api-keys/:id` | admin | Revoke |

External calls authenticate by sending `Authorization: Bearer sk_live_…`.
`requireApiKey(scope)` and `requireBoundApiKey(scope)` are Fastify
pre-handlers exposed by the `api_keys` plugin; route surfaces gate themselves
with them (`requireApiKey('catalog:write')`,
`requireBoundApiKey('orders:write')`, etc.).

## Scope enum

Creation validates scopes against the typed catalog in
`packages/contracts/src/api-keys.ts` (`apiKeyScopeSchema`):

| Scope | Meaning |
| --- | --- |
| `catalog:read` | PIM reads (unbound) and the external catalog surface (bound) |
| `catalog:write` | PIM by-SKU upsert — **unbound keys only** |
| `orders:read` | External order reads — **bound keys only** |
| `orders:write` | External order intake — **bound keys only** |

Enforcement stays membership-based, so legacy free-text scopes on existing
keys remain readable and enforceable — only creation is validated.

## Binding model

The binding is all-or-none and **immutable post-create** (token-shown-once
lifecycle; rebinding means revoking and issuing a new key). Creation rules,
validated server-side and mirrored inline in the admin form:

| Rule | Detail |
| --- | --- |
| B1 | Any `orders:*` scope ⇒ binding required |
| B2 | Binding present ⇒ `catalog:write` forbidden (PIM writes stay unbound-only) |
| B3 | The service Customer Account must be active and belong to the bound Organization |
| B4 | Organization and Sales Channel must exist (the channel need not be active at creation — the key simply fails closed while it is inactive) |
| B5 | `expiresAt`, when present, must be a future instant |

At request time a bound key derives a single-org tenant context and a pinned
sales channel (an explicit `X-Sales-Channel` header naming a different channel
is refused with `403 API_KEY_CHANNEL_MISMATCH`). An unbound key keeps the
legacy system context and header/host/default channel resolution.

## Expiry

`expiresAt` is optional and applies to both key modes. Once the instant
passes, `authenticate` refuses the key with `401 UNAUTHORIZED` — the same
refusal as a revoked key.

## Entities

`ApiKey` (name, keyHash, lastFour, scopes, status, lastUsedAt, and the
nullable binding/expiry columns `organizationId`, `salesChannelId`,
`customerAccountId`, `expiresAt`).

## Out-of-scope / gate behaviour

- Wrong scope ⇒ `403 API_KEY_OUT_OF_SCOPE` + audit row `api_key.out_of_scope`.
- Unbound key on a bound-only endpoint ⇒ `403 API_KEY_NOT_BOUND` + audit row
  `api_key.not_bound`.
- Channel mismatch ⇒ `403 API_KEY_CHANNEL_MISMATCH` + audit row
  `api_key.channel_mismatch`.

## Extension points

- **New scopes** — extend `apiKeyScopeSchema` in `@endora-commerce/contracts` and gate the
  new surface at its call site; the service is scope-name-agnostic at
  enforcement time.
- **Per-key rate limit** — `api-key-service.authenticate` returns the key
  id; layer a per-key counter in the pre-handler or a downstream middleware.
