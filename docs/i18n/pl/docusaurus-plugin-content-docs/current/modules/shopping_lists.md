---
title: shopping_lists
description: Nazwane listy zakupów klienta, które można zamienić w koszyk lub zapytanie ofertowe
---

# `shopping_lists`

Nazwane listy pozycji (produkt, opcjonalnie wariant, ilość, opcjonalna notatka) należące do klienta.
Kupujący zapisują powtarzające się zamówienia, a potem jednym kliknięciem przenoszą wszystkie albo
wybrane pozycje do koszyka lub do szkicu zapytania ofertowego. Przy przenoszeniu produkty
zarchiwizowane są pomijane i zgłaszane, zamiast odrzucać całą operację.

## API publiczne

Wszystkie endpointy wymagają zalogowanej sesji klienta i są ograniczone do pary
`(customer, organization)` z sesji.

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/shopping-lists` | Listy kupującego wraz z pozycjami |
| `POST /api/v1/shopping-lists` | Utworzenie nowej listy |
| `GET /api/v1/shopping-lists/:id` | Jedna lista wraz z pozycjami |
| `PATCH /api/v1/shopping-lists/:id` | Zmiana nazwy |
| `DELETE /api/v1/shopping-lists/:id` | Usunięcie (razem z pozycjami) |
| `POST /api/v1/shopping-lists/:id/items` | Dodanie pozycji |
| `PATCH /api/v1/shopping-lists/:id/items/:itemId` | Zmiana ilości lub notatki |
| `DELETE /api/v1/shopping-lists/:id/items/:itemId` | Usunięcie pozycji |
| `POST /api/v1/shopping-lists/:id/convert-to-cart` | Dodanie pozycji do aktywnego koszyka; pozycje zarchiwizowane są pomijane i zgłaszane |
| `POST /api/v1/shopping-lists/:id/convert-to-rfq` | Dodanie pozycji do szkicu zapytania ofertowego; zwraca `rfqId`, aby można było przejść bezpośrednio do szkicu |

Oba przeniesienia przyjmują opcjonalne pole `itemIds: string[]` w treści żądania. Pusta lub
brakująca tablica oznacza „przenieś wszystkie pozycje z listy”.

## Jak działa przeniesienie

`ShoppingListService` dzieli wskazane pozycje według statusu produktu, do którego się odwołują:

- produkty `active` trafiają do koszyka lub zapytania ofertowego przez istniejące
  `CartService.addItem` / `RfqService.addItem`, dzięki czemu łączenie pozycji w koszyku i
  podnoszenie wersji szkicu zapytania odbywa się w jednym miejscu;
- produkty `archived` (albo pozycje, których produkt już nie istnieje) są zgłaszane w `skipped[]`
  z jednym z powodów:
  - `product_archived`
  - `product_not_found`
  - `variant_unavailable`

Odpowiedź HTTP to zawsze `200 OK` z `{ added, skipped }`, aby interfejs mógł pokazać przyjazny
komunikat zamiast traktować częściowy wynik jako błąd.

## Encje

`ShoppingList` — `(organizationId, customerAccountId, name)`.

`ShoppingListItem` — usuwany kaskadowo razem z listą. Odwołanie do `products` to celowo zwykła
kolumna uuid bez CASCADE, aby archiwizacja produktu nie usuwała historycznych pozycji; usługa
przenoszenia zgłasza je w raporcie pominiętych.

## Punkty rozszerzenia

- **Udostępnianie w organizacji** — encja nie ma dziś kolumny `isShared`; udostępnianie list całej
  organizacji wymaga dodania tej kolumny i jednego wiersza w `#owned()` w
  `shopping-list-service.ts`.
- **Terminy ważności list** — dodaj do `ShoppingList` pole `expiresAt` dla procesów zakupowych,
  które automatycznie archiwizują nieaktualne listy.
- **Przenoszenie wyłącznie do zapytania ofertowego** — przeniesienie już zwraca identyfikator
  zapytania; storefront może przekierować kupującego do szkicu, aby przed wysłaniem dodał notatkę.
