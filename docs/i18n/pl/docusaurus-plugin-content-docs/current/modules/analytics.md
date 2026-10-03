---
title: analytics
description: Zbieranie zdarzeń ze storefrontu, zestawienia w panelu administracyjnym i opcjonalne przekazywanie do GA4
---

# `analytics`

Dziennik zdarzeń, do którego można wyłącznie dopisywać, zasilany przez storefront i panel
administracyjny, oraz niewielka ścieżka odczytu zestawień dla pulpitu w panelu. Jeśli jest
skonfigurowany, opcjonalny mechanizm przekazywania kopiuje każde zebrane zdarzenie do Google
Analytics 4.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/analytics/events` | storefront / panel (bez uwierzytelniania) | Przyjęcie porcji zdarzeń (≤ 100) |
| `GET /api/v1/admin/analytics/summary` | administrator (`analytics:read`) | Sumy dla każdego typu i rozbicie dzienne w zadanym okresie |

## Typy zdarzeń

Schemat Zod na wejściu przyjmuje stały zbiór:

- `product.viewed`, `category.viewed`
- `product.added_to_cart`, `cart.abandoned`
- `order.placed`
- `search.performed`, `filter.clicked`

Dodanie nowego typu to jedna zmiana w `packages/contracts/src/analytics.ts`.

## Jak działa przyjmowanie zdarzeń

Storefront wysyła zdarzenia porcjami; schemat Zod na wejściu odrzuca całą porcję, jeśli którekolwiek
zdarzenie jest niepoprawne (dzięki temu storefront nie może odejść od zdefiniowanych typów).
Walidacja pojedynczego zdarzenia w usłudze nadal działa, gdy pole `properties` ma nieoczekiwaną
zawartość — takie zdarzenia trafiają do tablicy `rejected` w odpowiedzi, a reszta porcji zostaje
zapisana.

Endpoint zwraca `202 Accepted` z `{ accepted, rejected[] }`. Każdy zapisany wiersz zawiera
`X-Request-Id` z żądania, co pozwala powiązać wpisy w różnych logach.

## Zestawienia

`AnalyticsQueryService.summary({ from, to, salesChannelId? })` wykonuje dwa zapytania ograniczone
do okresu (sumy według typu oraz dzienne sumy według typu), korzystając z indeksów `(occurred_at)`
i `(type, occurred_at)`. Pulpit nigdy nie pyta o nieograniczony zakres.

## Przekazywanie do GA4

`buildForwarderFromEnv(env)` zwraca:

- `Ga4Forwarder` — gdy ustawione są zarówno `ANALYTICS_GA4_MEASUREMENT_ID`, jak i
  `ANALYTICS_GA4_API_SECRET`. Każde zebrane zdarzenie jest wysyłane do Measurement Protocol GA4
  bez czekania na odpowiedź; `client_id` jest wybierany kolejno z sessionId → customerAccountId →
  organizationId → `'anonymous'`, aby GA4 widział spójne ścieżki użytkowników.
- `NoopForwarder` — w przeciwnym razie. Przyjmowanie zdarzeń nigdy nie czeka na błąd
  przekazywania, a zdarzenia źródłowe i tak są trwale zapisane w `analytics_events`.

## Encje

`AnalyticsEvent` — `type`, `occurredAt`, `recordedAt`, opcjonalnie `salesChannelId`,
`customerAccountId`, `organizationId`, `sessionId`, `properties` (JSONB), `requestId`.

## Punkty rozszerzenia

- **Kolejni odbiorcy** — zaimplementuj interfejs `AnalyticsForwarder` i zarejestruj go w
  composition root (np. PostHog, Mixpanel, wewnętrzna hurtownia danych).
- **Wstępnie przeliczone zestawienia** — zapytanie pulpitu wystarcza przy setkach tysięcy zdarzeń;
  przy stałych wolumenach rzędu milionów utwórz tu dzienną tabelę zestawień i zapisuj do niej przy
  indeksowaniu.
