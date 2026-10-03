---
title: taxes
description: Wyznaczanie stawek podatkowych według kraju, typu produktu i statusu VAT
---

# `taxes`

Wyznaczanie stawek podatkowych. Każdy wiersz `Tax` to reguła zawężona przez dowolną liczbę (także
zero) z pól `country`, `productType`, `appliesToVatStatuses`.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/taxes` | administrator (`taxes:read`) | Lista reguł |
| `PUT /api/v1/admin/taxes/:code` | administrator (`taxes:write`) | Utworzenie lub aktualizacja |
| `DELETE /api/v1/admin/taxes/:id` | administrator (`taxes:write`) | Usunięcie |
| `GET /api/v1/admin/taxes/preview?country&productType&vatStatus` | administrator (`taxes:read`) | Wyznaczenie obowiązującej stawki |

Do 2026-08-28 wszystkie cztery wymagały `catalog:write` — łącznie z dwoma odczytami, więc samo
zobaczenie stawki VAT wymagało uprawnienia do jej zmiany. Moduł ma teraz własne `taxes:read` i
`taxes:write`, zadeklarowane w manifeście i możliwe do przyznania na `/admin-roles`. To **zmiana
bez okresu przejściowego**: rola, która miała dostęp do tabeli podatków dzięki uprawnieniu do
zapisu w katalogu, musi jawnie dostać `taxes:read` (i `taxes:write`, aby edytować). Zobacz
`backend/test/contract/taxes/permission-authority.test.ts`.

Nic innego nie odczytuje stawki przez te trasy: `orders`, `carts`, `product_feeds` i
`quote_requests` wyznaczają ją w procesie przez port `taxService`, którego zmiana uprawnień nie
dotyczy.

## Algorytm wyznaczania stawki

`TaxService.taxRateFor({ country, productType, vatStatus })`:

1. Reguła **pasuje**, gdy każde pole zawężające jest puste (bez ograniczenia) albo równe wartości
   wejściowej.
2. Spośród pasujących reguł wygrywa ta, która ma **najwięcej wypełnionych pól zawężających**.
3. Przy remisie decyduje `priority` malejąco, a potem `createdAt` rosnąco.
4. Gdy żadna reguła nie pasuje, wygrywa wiersz z `isDefault=true`.
5. Gdy nie ma też reguły domyślnej, funkcja zwraca `{ source: 'none' }` — odpowiedź **w ogóle bez
   pola `rate`**.

Punkt 5 wynika z typu, a nie z konwencji. Skonfigurowana stawka 0% to w niektórych jurysdykcjach
prawidłowa odpowiedź, więc jest zwracana jako `{ source: 'default', rate: 0, taxId }` i wycenia
zamówienie jak każda inna stawka. „Nic nie skonfigurowano” to nie jest odpowiedź, więc nie zawiera
liczby, którą wywołujący mógłby przez przypadek użyć: `ResolvedTax` to unia rozłączna, a `.rate`
nie skompiluje się, dopóki wywołujący nie zawęzi typu po `source`. Kiedyś oba przypadki miały jeden
kształt, `{ rate: 0, source: 'none' }`, a każdy konsument czytał `.rate` — dlatego nieskonfigurowane
wdrożenie naliczało 0% VAT na prawdziwych fakturach.

Trzeci stan — brak modułu `taxes` — celowo nie należy do unii. Brak modułu to nie wartość: blokada
portu zwraca odpowiedź 503 `MODULE_DISABLED`, zanim wyznaczanie w ogóle się zacznie, więc zamówienie,
którego platforma nie potrafi opodatkować, jest odrzucane, a nie opodatkowane kwotą, której nikt nie
wybrał.

Regułę „najwyżej jedna stawka domyślna” wymusza częściowy indeks unikalny
`(is_default) WHERE is_default = true`. `upsertByCode` zdejmuje oznaczenie z dotychczasowej stawki
domyślnej, zanim nada je nowej, dzięki czemu zamiana pozostaje spójna.

## Encje

`Tax` — `code`, `name`, `rate` (0..1), opcjonalne `country` / `productType`, JSONB
`appliesToVatStatuses`, `isDefault`, `priority`.

## Punkty rozszerzenia

- **VAT-OSS (procedura one-stop-shop)** — modeluj status kupującego osobno i wyznaczaj różne stawki
  dla każdej pary krajów.
- **Warunki stawek obniżonych** — tablica `appliesToVatStatuses` to naturalne miejsce na
  rozróżnienia po stronie kupującego (np. konsument i firma).
- **Stawki zależne od waluty** — dziś stawka nie zależy od waluty. Dla VAT raportowanego w różnych
  walutach dodaj kolumnę `currency` i wyznaczaj stawkę według waluty zamówienia.
