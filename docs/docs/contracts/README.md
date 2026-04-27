---
sidebar_position: 1
title: API contracts
---

# API contracts

The platform exposes a single, documented HTTP surface (Constitution
Principle II — API-First). The API is described in two complementary
places:

1. **The live OpenAPI document** at `GET /api/v1/_openapi.json`
   (HTML viewer at `GET /api/v1/_docs`). This is the **source of truth**
   for the runtime — generated at startup from the Zod schemas in
   `@b2b/contracts` that Fastify itself validates against, so it cannot
   drift from the running server.
2. **Per-domain contract stubs** in
   [`specs/001-b2b-platform-foundation/contracts/`](https://github.com/)
   — these document the *intent* of each surface in human terms (status
   codes, error envelopes, lifecycle constraints) and predate the
   running implementation. They remain the authoritative reference for
   non-runtime concerns: error code catalogue, idempotency contracts,
   audit-row guarantees, lifecycle invariants.

## Live OpenAPI

In a development environment:

```bash
pnpm run dev:infra && pnpm --filter backend run dev
# in another shell:
curl http://localhost:3001/api/v1/_openapi.json | jq .info
open  http://localhost:3001/api/v1/_docs           # Swagger UI in the browser
```

Every Fastify route is auto-registered into the document on boot via the
`onRoute` hook in `backend/src/http/openapi.ts`; modules may opt into a
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
