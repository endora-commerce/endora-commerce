---
title: Analityka
description: Zbieranie zdarzeń ze storefrontu, zestawienia w panelu administracyjnym i opcjonalne przekazywanie do GA4
---

# Analityka (`analytics`)

Dziennik zdarzeń, do którego można wyłącznie dopisywać, zasilany przez storefront i panel
administracyjny, oraz niewielka ścieżka odczytu zestawień dla pulpitu w panelu. Jeśli jest
skonfigurowany, opcjonalny mechanizm przekazywania kopiuje każde zebrane zdarzenie do Google
Analytics 4.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/analytics/events` | storefront / panel (bez uwierzytelniania) | Przyjęcie porcji zdarzeń (≤ 100) |
| `GET /api/v1/admin/analytics/summary` | administrator (`analytics:read`) | Sumy dla każdego typu i rozbicie dzienne w zadanym okresie |

Moduł włącza się i wyłącza ustawieniem `analytics.enabled` (domyślnie włączone, zmieniane na
ekranie **Moduły**, `/platform/modules`). Gdy jest wyłączony, żadne zdarzenie nie jest
przyjmowane, pulpity i ich API znikają, a nic nie jest przekazywane do GA4; zebrane już zdarzenia
zostają i wracają po ponownym włączeniu.

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

Endpoint zwraca `202 Accepted` z `{ data: { accepted, rejected[] } }`. Każdy zapisany wiersz
zawiera `X-Request-Id` z żądania, co pozwala powiązać wpisy w różnych logach.

To, kto wysłał porcję i w którym kanale sprzedaży, ustala serwer dla danego żądania: konto
i organizację zalogowanego klienta (dla każdego innego wywołującego — żadne) oraz kanał
sprzedaży żądania. Pola `customerAccountId`, `organizationId` i `salesChannelId`, które zdarzenie
może nadal zawierać, są przyjmowane i pomijane. Jeden adres klienta może wysłać 60 porcji na
minutę; powyżej tego endpoint odpowiada `429`.

## Zestawienia

`AnalyticsQueryService.summary({ from, to, salesChannelId? })` wykonuje dwa zapytania ograniczone
do okresu (sumy według typu oraz dzienne sumy według typu), korzystając z indeksów `(occurred_at)`
i `(type, occurred_at)`. Pulpit nigdy nie pyta o nieograniczony zakres. Oba liczą tylko
zdarzenia organizacji, które odczytujący może zobaczyć: dla administratora z ograniczonym
dostępem do organizacji — przedstawiciela handlowego — zdarzenia organizacji, do których ma
dostęp, i żadnego zdarzenia bez organizacji.

## Przekazywanie do GA4

`buildForwarderFromEnv(env)` zwraca:

- `Ga4Forwarder` — gdy ustawione są zarówno `ANALYTICS_GA4_MEASUREMENT_ID`, jak i
  `ANALYTICS_GA4_API_SECRET`. Każde zebrane zdarzenie jest wysyłane do Measurement Protocol GA4
  bez czekania na odpowiedź; `client_id` jest wybierany kolejno z sessionId → customerAccountId →
  organizationId → `'anonymous'`, aby GA4 widział spójne ścieżki użytkowników.
- `NoopForwarder` — w przeciwnym razie. Przyjmowanie zdarzeń nigdy nie czeka na błąd
  przekazywania, a zdarzenia źródłowe i tak są trwale zapisane w `analytics_events`.

## Strefa czasowa raportów

Ustawienie **Strefa czasowa raportów** (`analytics.reporting_time_zone`, w sekcji
*Analityka* ekranu ustawień) to kalendarz, w którym raporty liczą dni: raport za
zakres dni bierze każdy dzień od północy do północy w tej strefie. Jest to nazwa
strefy czasowej IANA, np. `Europe/Warsaw`, albo `UTC` — wartość domyślna; strefa,
której środowisko uruchomieniowe nie zna, jest odrzucana z `422`
`VALIDATION_FAILED`. Liczą w niej analityka projektów i analityka CRM.

Inne moduły odczytują je przez bramkowany port `reportingTimeZonePort`
(`ReportingTimeZonePort` w `@endora-commerce/contracts`, `timeZone()`), nigdy przez
kod ustawienia. Moduł czytający deklaruje krawędź `degrades-without`, najpierw
sprawdza obecność tego modułu i liczy w `UTC`, gdy Analityka jest wyłączona.

## Encje

`AnalyticsEvent` — `type`, `occurredAt`, `recordedAt`, opcjonalnie `salesChannelId`,
`customerAccountId`, `organizationId`, `sessionId`, `properties` (JSONB), `requestId`.

## Punkty rozszerzenia

- **Kolejni odbiorcy** — zaimplementuj interfejs `AnalyticsForwarder` i zarejestruj go w
  composition root (np. PostHog, Mixpanel, wewnętrzna hurtownia danych).
- **Wstępnie przeliczone zestawienia** — zapytanie pulpitu wystarcza przy setkach tysięcy zdarzeń;
  przy stałych wolumenach rzędu milionów utwórz tu dzienną tabelę zestawień i zapisuj do niej przy
  indeksowaniu.

## Po scaleniu organizacji {#when-organizations-are-merged}

Zdarzenia zapisane dla duplikatu są przepinane na organizację, która zostaje, więc raporty
pokazują obie historie jako jednego klienta. Ten krok może się zakończyć chwilę po zakończeniu
samego scalania. Zobacz *Scalanie zduplikowanych organizacji* w dokumentacji modułu Organizacje.
