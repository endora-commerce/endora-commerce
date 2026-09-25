---
title: taxes
description: Resolver stawek podatkowych zawężony po kraju / typie produktu / statusie VAT
---

# `taxes`

Rozwiązywanie stawek podatkowych. Każdy wiersz `Tax` to
reguła zawężona przez zero lub więcej z `country`, `productType`,
`appliesToVatStatuses`.

## Publiczne API

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/taxes` | admin (`taxes:read`) | Lista reguł |
| `PUT /api/v1/admin/taxes/:code` | admin (`taxes:write`) | Upsert |
| `DELETE /api/v1/admin/taxes/:id` | admin (`taxes:write`) | Usunięcie |
| `GET /api/v1/admin/taxes/preview?country&productType&vatStatus` | admin (`taxes:read`) | Rozwiąż efektywną stawkę |

Wszystkie cztery wymuszały `catalog:write` do 2026-08-28 — w tym dwa odczyty,
więc zobaczenie stawki VAT wymagało uprawnienia do jej zmiany. Moduł posiada teraz
własne `taxes:read` i `taxes:write`, zadeklarowane w manifeście i nadawalne na
`/admin-roles`. To **czyste zerwanie**: rola, która docierała do tabeli podatków
przez kod zapisu katalogu, dostaje `taxes:read` (i `taxes:write`, by edytować)
explicite. Zobacz
`backend/test/contract/taxes/permission-authority.test.ts`.

Nic innego nie czyta stawki przez te trasy: `orders`, `carts`,
`product_feeds` i `quote_requests` rozwiązują ją in-process przez port
`taxService`, którego zmiana uprawnień nie dotyka.

## Algorytm rozwiązywania

`TaxService.taxRateFor({ country, productType, vatStatus })`:

1. Reguła **pasuje**, gdy każde pole zawężające jest albo null
   (nieograniczone), albo równe wejściu.
2. Spośród pasujących wygrywa reguła z **największą liczbą zawężonych pól**.
3. Remis specyficzności → `priority` desc → `createdAt` asc.
4. Gdy żadna reguła nie pasuje, wygrywa wiersz z `isDefault=true`.
5. Gdy nie ma też domyślnej, resolver zwraca `{ source: 'none' }` —
   odpowiedź **bez pola `rate` w ogóle**.

Punkt 5 to typ, nie konwencja. Skonfigurowana stawka 0% to
legitymna odpowiedź w niektórych jurysdykcjach, więc wraca jako
`{ source: 'default', rate: 0, taxId }` i wycenia zamówienie jak każda inna
stawka. „Nic nie jest skonfigurowane” to nie odpowiedź, więc nie niesie liczby,
którą wywołujący mógłby przypadkiem wydać: `ResolvedTax` to discriminated union,
a `.rate` nie kompiluje się, dopóki wywołujący nie zawęzi po `source`. Kiedyś
dzieliły jeden kształt `{ rate: 0, source: 'none' }`, i każdy konsument czytał
`.rate` — stąd nieskonfigurowane wdrożenie wyceniało 0% VAT na prawdziwych
fakturach.

Trzeci stan — brak modułu `taxes` — celowo nie jest w unii. Brak to nie wartość:
bramka portu podnosi kopertę 503 `MODULE_DISABLED` zanim rozwiązanie ruszy, więc
zamówienie, którego platforma nie może opodatkować, jest odrzucane, zamiast
opodatkowane kwotą, której nikt nie wybrał.

Invariant „co najwyżej jedna domyślna” egzekwuje partial unique index
`(is_default) WHERE is_default = true`. `upsertByCode` degraduje wcześniejszą
domyślną przed promocją nowej, żeby zamiana pozostała spójna.

## Encje

`Tax` — `code`, `name`, `rate` (0..1), nullable `country` /
`productType`, JSONB `appliesToVatStatuses`, `isDefault`, `priority`.

## Punkty rozszerzenia

- **VAT-OSS / one-stop-shop** — modeluj status kupującego osobno i
  emituj różne stawki per para krajów.
- **Wyzwalacze stawek obniżonych** — tablica `appliesToVatStatuses` to
  naturalne miejsce na dyskryminatory po stronie kupującego (np. consumer vs B2B).
- **Stawki per waluta** — dziś stawka jest niezależna od waluty. Dla VAT
  w różnych walutach raportowania dodaj kolumnę `currency` i kieruj resolver
  po walucie zamówienia.
