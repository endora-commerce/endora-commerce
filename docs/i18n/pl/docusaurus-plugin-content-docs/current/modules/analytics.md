---
title: analytics
description: Ingest zdarzeń storefront + agregacja w adminie + opcjonalny forwarder GA4
---

# `analytics`

Append-only log zdarzeń zasilany przez storefront i admin, plus mała ścieżka
odczytu agregacji dla dashboardu admina. Opcjonalny forwarder GA4 mirroruje
każde zaingestowane zdarzenie do Google Analytics, gdy jest skonfigurowany.

## Publiczne API

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `POST /api/v1/analytics/events` | storefront / admin (no auth) | Ingest batcha zdarzeń (≤ 100) |
| `GET /api/v1/admin/analytics/summary` | admin (`analytics:read`) | Sumy per typ + breakdown dzienny dla okna |

## Typy zdarzeń

Granica Zod akceptuje stały zestaw, zgodnie z FR-110:

- `product.viewed`, `category.viewed`
- `product.added_to_cart`, `cart.abandoned`
- `order.placed`
- `search.performed`, `filter.clicked`

Dodanie nowego typu to jedna edycja w
`packages/contracts/src/analytics.ts`.

## Semantyka ingestu

Storefront wysyła batche; schemat Zod na granicy odrzuca cały batch,
jeśli którekolwiek zdarzenie jest źle uformowane (storefront nie może
dryfować unii typów). Walidacja per zdarzenie w serwisie nadal działa, gdy
pole `properties` jest nieoczekiwane — takie zdarzenia trafiają do tablicy
`rejected` w odpowiedzi, a reszta batcha ląduje.

Endpoint zwraca `202 Accepted` z `{ accepted, rejected[] }`. Każdy zapisany
wiersz mirroruje `X-Request-Id` z requestu do korelacji między logami.

## Agregacja

`AnalyticsQueryService.summary({ from, to, salesChannelId? })` wykonuje dwa
zapytania ograniczone oknem (sumy per typ, dzienne sumy per typ) względem
indeksów `(occurred_at)` i `(type, occurred_at)`. Dashboard nigdy nie
odpytuje nieograniczonego zakresu.

## Forwarder GA4

`buildForwarderFromEnv(env)` zwraca:

- `Ga4Forwarder` — gdy ustawione są zarówno `ANALYTICS_GA4_MEASUREMENT_ID`, jak i
  `ANALYTICS_GA4_API_SECRET`. Każdy ingest jest fire-and-forget POST'owany
  do Measurement Protocol GA4; `client_id` jest bucketowany przez sessionId →
  customerAccountId → organizationId → `'anonymous'`, żeby GA4 widział spójne
  ścieżki użytkownika.
- `NoopForwarder` — w przeciwnym razie. Ingest nigdy nie blokuje na failure
  forwardera, a zdarzenia źródłowe są trwałe w `analytics_events` niezależnie
  od tego.

## Encje

`AnalyticsEvent` — `type`, `occurredAt`, `recordedAt`, opcjonalne
`salesChannelId`, `customerAccountId`, `organizationId`, `sessionId`,
`properties` (JSONB), `requestId`.

## Punkty rozszerzenia

- **Nowi konsumenci** — zaimplementuj interfejs `AnalyticsForwarder` i
  zarejestruj w composition root (np. PostHog, Mixpanel, wewnętrzny data
  warehouse).
- **Pre-agregowane rollup'y** — zapytanie dashboardu jest w porządku przy
  setkach tysięcy zdarzeń; przy utrzymywanych wolumenach milionowych
  zmaterializuj tutaj dzienną tabelę rollup i niech indexer składa inserty
  w nią.
