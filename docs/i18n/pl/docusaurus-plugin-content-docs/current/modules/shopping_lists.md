---
title: shopping_lists
description: Nazwane zestawy per klient konwertowalne do Cart lub RFQ
---

# `shopping_lists`

Nazwane zestawy wierszy (produkt, wariant?, ilość, notatka?) per klient.
Kupujący zapisują powtarzalne zamówienia, a następnie konwertują wszystkie
lub wybrany podzbiór pozycji do Cart albo szkicu Quote Request jednym kliknięciem.
Konwersje pomijają zarchiwizowane produkty i raportują je, zamiast odrzucać całą
partię.

## Publiczne API

Wszystkie endpointy wymagają uwierzytelnionej sesji klienta i są ograniczone do
pary `(customer, organization)` z sesji.

| Verb + Path | Cel |
| --- | --- |
| `GET /api/v1/shopping-lists` | Lista list kupującego wraz z pozycjami |
| `POST /api/v1/shopping-lists` | Utworzenie nowej listy |
| `GET /api/v1/shopping-lists/:id` | Jedna lista wraz z pozycjami |
| `PATCH /api/v1/shopping-lists/:id` | Zmiana nazwy |
| `DELETE /api/v1/shopping-lists/:id` | Usunięcie (kaskada do pozycji) |
| `POST /api/v1/shopping-lists/:id/items` | Dodanie pozycji |
| `PATCH /api/v1/shopping-lists/:id/items/:itemId` | Aktualizacja ilości / notatki |
| `DELETE /api/v1/shopping-lists/:id/items/:itemId` | Usunięcie |
| `POST /api/v1/shopping-lists/:id/convert-to-cart` | Dodanie pozycji do aktywnego koszyka; zarchiwizowane wiersze są pomijane + raportowane |
| `POST /api/v1/shopping-lists/:id/convert-to-rfq` | Dodanie pozycji do szkicu RFQ; zwraca `rfqId` do deep-linkowania |

Oba konwertery akceptują opcjonalne body `itemIds: string[]`. Pusta lub brakująca
tablica oznacza „konwertuj każdą pozycję na liście”.

## Semantyka konwersji

`ShoppingListService` partycjonuje żądane pozycje według statusu referencjonowanego
produktu:

- produkty `active` trafiają do koszyka / RFQ przez istniejące
  `CartService.addItem` / `RfqService.addItem`, aby agregacja koszyka i podbicia
  wersji szkicu RFQ pozostały w jednym miejscu.
- produkty `archived` (lub wiersze, których produkt już nie istnieje) są
  raportowane w `skipped[]` z jednym z:
  - `product_archived`
  - `product_not_found`
  - `variant_unavailable`

Odpowiedź HTTP to zawsze `200 OK` z `{ added, skipped }`, aby UI mogło pokazać
przyjazny komunikat zamiast traktować częściowy wynik jako błąd.

## Encje

`ShoppingList` — `(organizationId, customerAccountId, name)`.

`ShoppingListItem` — kaskadowo usuwa się wraz z listą nadrzędną. FK do
`products` to celowo zwykła kolumna uuid bez CASCADE, aby archiwizacja produktu
nie usuwała historycznych wierszy; serwis konwersji zgłasza je w raporcie
pominięć.

## Punkty rozszerzenia

- **Udostępnianie w Organization** — encja nie ma dziś kolumny `isShared`;
  org-wide sharing wymaga flipu kolumny plus jednej linii w `#owned()` w
  `shopping-list-service.ts`.
- **Terminy per lista** — rozszerz `ShoppingList` o `expiresAt` dla workflow
  zakupowych, które automatycznie archiwizują nieaktualne listy.
- **Tryb convert-to-quote-only** — konwerter już zwraca id RFQ; storefront może
  deep-linkować kupującego do szkicu, aby dodać notatkę wnioskodawcy przed
  wysłaniem.
