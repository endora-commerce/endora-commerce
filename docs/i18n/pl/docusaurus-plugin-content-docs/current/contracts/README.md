---
sidebar_position: 1
title: Kontrakty API
---

# Kontrakty API

Platforma udostępnia jedno, udokumentowane API HTTP, projektowane zgodnie z podejściem API-first. API jest opisane w dwóch uzupełniających się miejscach:

1. **Dokument OpenAPI na żywo** pod `GET /api/v1/_openapi.json`
   (interaktywna dokumentacja pod `GET /api/v1/_docs`). To **źródło prawdy** o działającym
   API — jest generowany przy starcie ze schematów Zod w `@endora-commerce/contracts`, którymi
   Fastify sam waliduje żądania, więc nie może różnić się od działającego serwera.
2. **Opisy kontraktów dla poszczególnych domen**, wymienione w sekcji
   [Opisy kontraktów](#opisy-kontraktów) poniżej — opisują zwykłym językiem *zamierzone* działanie
   każdego obszaru API (kody statusu, struktura błędów, ograniczenia cyklu życia) i powstały przed
   implementacją. Pozostają wiążącym źródłem dla kwestii, których nie widać w działającym API:
   katalogu kodów błędów, kontraktów idempotencji, gwarancji dotyczących wpisów audytu i
   niezmienników cyklu życia.

## OpenAPI na żywo

Opis API jest dostępny dla administratorów, których rola administracyjna ma uprawnienie
`platform.api_description.read` (*Odczyt opisu API*), oraz dla kluczy API wydanych z zakresem
`platform.api_description.read`. Każdy inny dostaje `401 UNAUTHORIZED` (brak sesji
administratora i klucza API) albo `403 FORBIDDEN` (administrator lub klucz bez tego kodu).
Administrator platformy nadaje uprawnienie na ekranie **Role**; klucz z tym zakresem może wydać
tylko administrator, który sam je ma.

- **W panelu administracyjnym** — **System → Opis API** (albo ⌘K / CTRL+K, *Opis API*) pokazuje
  tytuł, wersję i liczbę endpointów dokumentu, pozwala pobrać go jako JSON i otwiera w nowej karcie
  interaktywną dokumentację (`GET /api/v1/_docs`, Swagger UI). Dokumentację serwuje samo API i
  korzysta ona z Twojej sesji administratora.
- **Z integracji** — wyślij klucz jako token bearer:

```bash
# W katalogu głównym instancji:
pnpm run dev:services && pnpm run dev
# W klonie repozytorium Endora Commerce: pnpm run dev:infra && pnpm --filter backend run dev
# in another shell, with a key issued with the platform.api_description.read scope:
curl -H "Authorization: Bearer sk_live_…" http://localhost:3001/api/v1/_openapi.json | jq .info
```

Strona dokumentacji wczytuje Swagger UI z jsDelivr w dokładnie przypiętej wersji
`swagger-ui-dist`, z sumą kontrolną Subresource Integrity dla obu plików.

Każda trasa Fastify jest przy starcie automatycznie dodawana do dokumentu przez hook
`onRoute` w `packages/platform/src/http/openapi.ts`; moduły mogą uzupełnić schemat dowolnej trasy, wywołując bezpośrednio
`openApiRegistry.registerPath({...})`.

## Opisy kontraktów

| Domena | Opis kontraktu |
| --- | --- |
| Catalog | [`catalog.contract.md`](https://github.com/) |
| Quote Requests | [`quote_requests.contract.md`](https://github.com/) |
| Orders | [`orders.contract.md`](https://github.com/) |
| Organizations | [`organizations.contract.md`](https://github.com/) |
| Credit Limits | [`credit_limits.contract.md`](https://github.com/) |

Opisy kontraktów wyjaśniają *dlaczego* — co oznacza błąd, jak wyglądają statusy i przejścia, co
uznaje się za zmianę niezgodną wstecz. Korzystaj z nich, gdy chcesz zrozumieć reguły danego obszaru
API; z OpenAPI na żywo — gdy potrzebujesz dokładnej postaci żądań i odpowiedzi w obecnym buildzie.

## Struktura błędu

Każda odpowiedź spoza zakresu 2xx ma tę samą postać:

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

Wartości `code` pochodzą z centralnego katalogu w `packages/contracts/src/errors.ts`. `requestId`
odpowiada nagłówkowi odpowiedzi `X-Request-Id` — podawaj go w zgłoszeniach do wsparcia, aby można było
odnaleźć wpisy w logach serwera.

## Paginacja

Wszystkie endpointy zwracające listy korzystają z paginacji kursorowej:

```http
GET /api/v1/orders?limit=50&cursor=eyJpZCI6IjAwMC...
```

Postać odpowiedzi:

```json
{
  "data": [...],
  "pagination": { "limit": 50, "nextCursor": "...", "hasMore": true }
}
```

Schematy znajdują się w `packages/contracts/src/pagination.ts`.
