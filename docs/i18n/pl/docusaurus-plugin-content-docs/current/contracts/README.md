---
sidebar_position: 1
title: Kontrakty API
---

# Kontrakty API

Platforma udostępnia jedną, udokumentowaną powierzchnię HTTP (Constitution Principle II — API-First). API jest opisane w dwóch uzupełniających się miejscach:

1. **Dokument OpenAPI na żywo** pod `GET /api/v1/_openapi.json`
   (przeglądarka HTML pod `GET /api/v1/_docs`). To **źródło prawdy**
   dla runtime — generowane przy starcie ze schematów Zod w
   `@endora-commerce/contracts`, którymi Fastify sam waliduje żądania, więc nie może
   rozjechać się z działającym serwerem.
2. **Stuby kontraktów per domena** w
   [`specs/001-b2b-platform-foundation/contracts/`](https://github.com/)
   — dokumentują *intencję* każdej powierzchni w ludzkim języku (kody
   statusu, koperty błędów, ograniczenia cyklu życia) i są starsze od
   działającej implementacji. Pozostają autorytatywną referencją dla
   kwestii spoza runtime: katalog kodów błędów, kontrakty idempotencji,
   gwarancje wierszy audytu, niezmienniki cyklu życia.

## OpenAPI na żywo

W środowisku deweloperskim:

```bash
pnpm run dev:infra && pnpm --filter backend run dev
# in another shell:
curl http://localhost:3001/api/v1/_openapi.json | jq .info
open  http://localhost:3001/api/v1/_docs           # Swagger UI in the browser
```

Każda trasa Fastify jest automatycznie rejestrowana w dokumencie przy starcie przez hook
`onRoute` w `packages/platform/src/http/openapi.ts`; moduły mogą wzbogacić schemat dowolnej trasy, wywołując bezpośrednio
`openApiRegistry.registerPath({...})`.

## Stuby kontraktów

| Domain | Stub |
| --- | --- |
| Catalog | [`catalog.contract.md`](https://github.com/) |
| Quote Requests | [`quote_requests.contract.md`](https://github.com/) |
| Orders | [`orders.contract.md`](https://github.com/) |
| Organizations | [`organizations.contract.md`](https://github.com/) |
| Credit Limits | [`credit_limits.contract.md`](https://github.com/) |

Stuby kodują *dlaczego* — co oznacza błąd, jak wygląda maszyna stanów,
co uznaje się za breaking change. Używaj ich, gdy potrzebujesz zrozumieć
reguły powierzchni; używaj OpenAPI na żywo, gdy potrzebujesz
dokładnych kształtów request/response, które dzisiejszy build serwuje.

## Koperta błędu

Każda odpowiedź inna niż 2xx ma jeden kształt:

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

Wartości `code` pochodzą z centralnego katalogu w
`packages/contracts/src/errors.ts`. `requestId` odpowiada nagłówkowi odpowiedzi
`X-Request-Id` — podaj go w zgłoszeniach supportowych, aby logi serwera były śledzalne.

## Paginacja

Wszystkie endpointy list używają paginacji kursorowej:

```http
GET /api/v1/orders?limit=50&cursor=eyJpZCI6IjAwMC...
```

Kształt odpowiedzi:

```json
{
  "data": [...],
  "pagination": { "limit": 50, "nextCursor": "...", "hasMore": true }
}
```

Schematy znajdują się w `packages/contracts/src/pagination.ts`.
