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

Lista domyślna ma trzy własne ścieżki: `GET /api/v1/shopping-lists/default` (tworzona przy
pierwszym odczycie, jeśli jej brak), `POST /api/v1/shopping-lists/default/items` oraz
`POST /api/v1/shopping-lists/:id/set-default`.

## Uprawnienia w organizacji

Moduł deklaruje dwa uprawnienia organizacji, które administrator organizacji przyznaje rolom
(`organizations`). Oba są domyślne dla członka, więc rola *Członek* organizacji ma je od początku
i dla dotychczasowych członków nic się nie zmienia.

| Kod | Etykieta | Czego wymaga |
| --- | --- | --- |
| `shopping_lists.create` | Tworzenie i edycja list zakupowych | `POST /api/v1/shopping-lists`, `PATCH` / `DELETE …/:id`, `POST …/:id/items`, `PATCH` / `DELETE …/:id/items/:itemId`, `DELETE …/:id/items`, `POST …/default/items`, `POST …/:id/set-default` |
| `shopping_lists.convert` | Zamiana list zakupowych na zapytania ofertowe i koszyki | `POST …/:id/convert-to-cart` (razem z `carts.create`), `POST …/:id/convert-to-rfq` (razem z `quote_requests.create`) |

- **Odczyt pozostaje otwarty.** Lista własnych list, odczyt jednej z nich i odczyt listy domyślnej
  nie wymagają uprawnienia.
- **Przeniesienie wymaga dwóch uprawnień**: `shopping_lists.convert` oraz uprawnienia do
  utworzenia celu, które deklarują `carts` i `quote_requests`. To dwa osobne sprawdzenia, w tej
  kolejności; odmowa wskazuje pierwsze brakujące.
- **Odmowa** to `403 ORGANIZATION_PERMISSION_REQUIRED` z kodem i przetłumaczoną etykietą w
  `details`, udzielana, zanim treść żądania albo lista zostaną odczytane.
- **Zapisanie pozycji koszyka na liście** (`POST /api/v1/cart/items/:itemId/save-to-shopping-list`)
  to ścieżka modułu `carts`; także ona wymaga `shopping_lists.create`.
- **Lista domyślna nadal powstaje** dla każdego nowego członka organizacji, niezależnie od jego
  roli: należy do platformy, a nie jest zapisem członka.
- **Po wyłączeniu** modułu oba uprawnienia znikają z edytora ról i z efektywnych uprawnień każdego
  członka; przyznane uprawnienia pozostają zapisane i obowiązują ponownie po włączeniu modułu.

W storefroncie członek bez `shopping_lists.create` nadal czyta swoje listy. Strona list i strona
listy nie pokazują tworzenia, zmiany nazwy, usuwania, zmiany ilości ani usuwania pozycji; *Dodaj do
listy zakupów* nie jest dostępne na stronie produktu ani na kartach produktów, a *Zapisz na liście*
— przy pozycji koszyka. Strona wyjaśnia to w jednym zdaniu: *„Twoja rola pozwala przeglądać listy zakupów, ale nie pozwala ich
zmieniać.”* Przeniesienie listy (wszystkich pozycji albo zaznaczonych) do koszyka jest dostępne tylko
z `shopping_lists.convert` i `carts.create`, a do zapytania ofertowego — tylko z
`shopping_lists.convert` i `quote_requests.create`.

## Jak działa przeniesienie

`ShoppingListService` dzieli wskazane pozycje według statusu produktu, do którego się odwołują:

- produkty `active` trafiają do koszyka jedną partią przez `addItems` koszyka (ocenianą razem z
  koszykiem, więc obowiązują minimalne ilości zamówienia), a do zapytania ofertowego przez
  `RfqService.createForCustomer`, które stosuje sprawdzenie minimum dla zapisów klienta;
- produkty `archived` (albo pozycje, których produkt już nie istnieje) są zgłaszane w `skipped[]`
  z jednym z powodów:
  - `product_archived`
  - `product_not_found`
  - `variant_unavailable`
  - `below_minimum` (tylko koszyk) — łączna ilość produktu w koszyku po zamianie pozostałaby poniżej
    minimalnej ilości zamówienia; pominięcie niesie `minimum`, którego pozycja nie osiągnęła.

Produkt, którego kupujący nie może już zobaczyć albo którego kanał nie publikuje, jest pomijany
jako `product_not_found` — dokładnie tak jak usunięty produkt, bez nazwy i bez minimum. Każda inna
pozycja jest nadal dodawana; zamiana nie jest wycofywana.

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
