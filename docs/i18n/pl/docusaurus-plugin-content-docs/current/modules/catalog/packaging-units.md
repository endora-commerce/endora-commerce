---
title: Jednostki opakowania
---

# Jednostki opakowania

Nazwane jednostki zamawiania przypisane do produktu — na przykład **Paleta** zawierająca 480 sztuk.
Pozwalają kupującym B2B zamawiać w jednostkach hurtowych bez wpisywania dokładnej liczby sztuk, a ta
informacja trafia aż do zamówienia i zapytania ofertowego.

## Dla operatora

Jednostkami opakowania zarządza się w sekcji **Inventory** karty produktu (tylko produkty typu
simple i configurable). Każda jednostka ma:

- **nazwę** (tekst operatora, np. `Paleta`, `Karton`) — unikalną w obrębie produktu,
- **base quantity** (liczba całkowita ≥ 1) — ile sztuk mieści jednostka,
- flagę **default** — jednostka wybrana domyślnie w storefroncie,
- **position** — kolejność, w jakiej jednostki są wyświetlane.

## Dla kupującego

Na stronie produktu lista wyboru oferuje dostępne jednostki oraz opcję *pojedynczej sztuki*.
Zamówienie jednostki dodaje do koszyka `baseQuantity × units` sztuk jako jedną pozycję, której
wyświetlana nazwa ma dopisek z jednostką — np. `Łożysko 6205-2RS (Paleta)`. Pozycja z jednostką
opakowania i zwykła pozycja z pojedynczymi sztukami tego samego produktu pozostają osobne.

## Co dzieje się z nazwą jednostki

Nazwa jednostki i base quantity są **kopiowane** do pozycji w chwili jej utworzenia, więc późniejsze
zmiany (albo usunięcie) jednostek opakowania produktu nigdy nie zmieniają historycznych koszyków,
zamówień ani zapytań ofertowych.

- **Koszyk** — `cart_items` zapisują kopię jednostki; serializacja koszyka buduje `displayName` z
  dopiskiem.
- **Zamówienie** — `order_items` dostają `packaging_unit_snapshot`, a nazwa jednostki jest
  dopisywana do `product_snapshot.name`, więc pokazuje ją każdy dokument zamówienia (szczegóły,
  faktura, CSV, e-mail).
- **Zapytanie ofertowe** — `quote_request_items` zapisują kopię jednostki i dopisują ją do
  `product_name`; zamiana koszyka w zapytanie ofertowe przenosi tę informację dalej.

## Ceny i dostępność

Ceny wyznacza istniejący mechanizm na podstawie wynikowej liczby sztuk (łącznie z progami
ilościowymi cennika) — nie ma osobnej ceny za jednostkę. Dostępność w magazynie i limity dla pozycji
są sprawdzane dla wynikowej liczby sztuk.

## API

- Zarządzanie w panelu: `GET/POST /api/v1/admin/catalog/products/:id/packaging-units`,
  `PATCH/DELETE …/:unitId`, `PATCH …/packaging-units/reorder` (chronione przez `catalog:read` /
  `catalog:write`).
- Publiczne: szczegóły produktu (`GET /api/v1/catalog/products/:idOrSlug`) zawierają opcjonalną
  tablicę `packagingUnits`.
- Koszyk: `POST /api/v1/cart/items` przyjmuje opcjonalne `packagingUnitId`; wynikowa ilość w pozycji
  to `baseQuantity × quantity`.

## Schemat

Tabela `product_packaging_units` (migracja
`20260611T140412_catalog_product_packaging_units.ts`): `id`, `product_id` (klucz obcy → `products`,
usuwany kaskadowo), `name`, `base_quantity` (`CHECK >= 1`), `position`, `is_default`, znaczniki
czasu; `UNIQUE (product_id, name)`. Dodatkowe kolumny z kopią danych, każdą dodaje moduł, do którego należy:
`cart_items` (`20260611T140413_carts_cart_item_packaging.ts`), `order_items`
(`20260611T140414_orders_order_item_packaging.ts`), `quote_request_items`
(`20260611T140415_quote_requests_qr_item_packaging.ts`).
