---
title: currencies
description: Lista akceptowanych kodów walut ISO 4217 i waluta domyślna
---

# `currencies`

Lista kodów walut ISO 4217 akceptowanych w danej instalacji. Odpowiednik modułu `languages`.

## API publiczne

| Metoda i ścieżka | Uprawnienie | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/currencies` | `currencies:read` | Pełna lista |
| `PUT /api/v1/admin/currencies/:code` | `currencies:write` | Utworzenie lub aktualizacja |
| `POST /api/v1/admin/currencies/:code/default` | `currencies:write` | Ustawienie jako domyślnej (w tej samej operacji zdejmuje to oznaczenie z poprzedniej) |
| `DELETE /api/v1/admin/currencies/:code` | `currencies:write` | Usunięcie (odrzucane dla waluty domyślnej) |

`GET /api/v1/i18n/config` zwraca też aktywne waluty i walutę domyślną, ale jest trasą modułu
**`languages`**, a nie tego modułu: łączy oba katalogi w jedną publiczną odpowiedź, a część
dotyczącą walut odczytuje przez `currencyReadPort`. Zobacz [languages](./languages.md).

## Uprawnienia

`currencies:read` i `currencies:write`, należące do tego modułu od 2026-08-29.

Do tego czasu cztery powyższe trasy znajdowały się w `languages` i wymagały `catalog:write` —
wszystkie cztery, łącznie z odczytem listy — więc operator, który mógł edytować opis produktu, mógł
też dodać walutę, dezaktywować ją, usunąć i ustawić jako domyślną walutę sklepu. Nic w tym
repozytorium nie wywołuje tych tras: ekran walut w panelu administracyjnym należy do `dictionaries`
(`/api/v1/admin/dictionary/currencies/*`, chroniony przez `dictionary.write`), co stanowi drugą
drogę do tej tabeli i jest osobną kwestią.

`test/contract/currencies/permission-authority.test.ts` sprawdza oba kierunki — rola z kodami
katalogu jest odrzucana, rola z tą parą uprawnień jest obsługiwana — oraz to, że działający w
procesie `currencyReadPort`, przez który każdy inny moduł odczytuje walutę, nie został zmieniony
przy przeniesieniu.

## Wartości domyślne

Ten sam wzorzec częściowego indeksu unikalnego co w `languages`. Migracja inicjalizująca tworzy
`PLN` (domyślną) i `EUR`; symbole są zapisane jako literały Unicode Postgresa, więc kod migracji
pozostaje w ASCII.

## Encje

`Currency` — naturalny klucz główny w postaci kodu ISO 4217; `label`, `symbol`, `isDefault`,
`isActive`, `sortOrder`.

## Punkty rozszerzenia

- **Waluta domyślna dla kanału sprzedaży** — gdy kanał sprzedaży ma własną walutę, uzależnij
  `priceFor(cart)` w module `orders` od waluty skonfigurowanej dla kanału, a nie od globalnej waluty
  domyślnej.
- **Dostawca kursów walut** — poza zakresem tego modułu; gdy potrzebny jest prawdziwy adapter,
  integruj go przez moduł `integrations`.
