---
sidebar_position: 1
title: API contracts
---

# API contracts

The platform exposes a single, documented HTTP surface, API-first. The
API is described in two complementary places:

1. **The live OpenAPI document** at `GET /api/v1/_openapi.json`
   (interactive reference at `GET /api/v1/_docs`). This is the **source of truth**
   for the runtime — generated at startup from the Zod schemas in
   `@endora-commerce/contracts` that Fastify itself validates against, so it cannot
   drift from the running server.
2. **Per-domain contract stubs**, listed under
   [Contract stubs](#contract-stubs) below
   — these document the *intent* of each surface in human terms (status
   codes, error envelopes, lifecycle constraints) and predate the
   running implementation. They remain the authoritative reference for
   non-runtime concerns: error code catalogue, idempotency contracts,
   audit-row guarantees, lifecycle invariants.

## Live OpenAPI

The API description is available to administrators whose admin role holds the
`platform.api_description.read` permission (*Read the API description*) and to
API keys issued with the `platform.api_description.read` scope. Anybody else is
answered `401 UNAUTHORIZED` (no administrator session or API key) or
`403 FORBIDDEN` (an administrator or a key without the code). The platform
administrator grants the permission on the **Roles** screen; a key with the
scope can be issued only by an administrator who holds it.

- **In the Admin Panel** — **System → API description** (or ⌘K / CTRL+K,
  *API description*) shows the document's title, version and endpoint count,
  downloads it as JSON, and opens the interactive reference
  (`GET /api/v1/_docs`, Swagger UI) in a new tab. The reference is served by
  the API itself and uses your administrator session.
- **From an integration** — send the key as a bearer token:

```bash
# In the root of an instance:
pnpm run dev:services && pnpm run dev
# In a checkout of the Endora Commerce repository: pnpm run dev:infra && pnpm --filter backend run dev
# in another shell, with a key issued with the platform.api_description.read scope:
curl -H "Authorization: Bearer sk_live_…" http://localhost:3001/api/v1/_openapi.json | jq .info
```

The reference page loads Swagger UI from jsDelivr at an exact
`swagger-ui-dist` version, with a Subresource Integrity digest on both files.

Every Fastify route is auto-registered into the document on boot via the
`onRoute` hook in `packages/platform/src/http/openapi.ts`; modules may opt into a
richer schema for any one route by calling
`openApiRegistry.registerPath({...})` directly.

## Contract stubs

| Domain | Stub |
| --- | --- |
| Catalog | [`catalog.contract.md`](https://github.com/) |
| Quote Requests | [`quote_requests.contract.md`](https://github.com/) |
| Orders | [`orders.contract.md`](https://github.com/) |
| Organizations | [`organizations.contract.md`](https://github.com/) |
| Credit Limits | [`credit_limits.contract.md`](https://github.com/) |

The stubs encode the *why* — what an error means, what a state machine
looks like, what counts as a breaking change. Use them when you need to
understand the rules of a surface; use the live OpenAPI when you need
the exact request/response shapes a running build serves today.

## Error envelope

Every non-2xx response uses one shape:

```json
{
  "error": {
    "code": "API_KEY_OUT_OF_SCOPE",
    "message": "Human-readable explanation.",
    "details": [{ "path": "scopes[0]", "issue": "must be a known scope" }],
    "requestId": "req_abc123…"
  }
}
```

`code` values come from the central catalogue in
`packages/contracts/src/errors.ts`. The `requestId` mirrors the
`X-Request-Id` response header — quote it in support tickets to make
server logs traceable.

## Pagination

All list endpoints use cursor pagination:

```http
GET /api/v1/orders?limit=50&cursor=eyJpZCI6IjAwMC...
```

The response shape is:

```json
{
  "data": [...],
  "pagination": { "limit": 50, "nextCursor": "...", "hasMore": true }
}
```

Schemas live in `packages/contracts/src/pagination.ts`.
