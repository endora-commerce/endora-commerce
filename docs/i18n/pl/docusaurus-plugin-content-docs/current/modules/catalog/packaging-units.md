---
title: Jednostki opakowania
---

# Jednostki opakowania

Nazwane jednostki zamawiania przypięte do produktu — na przykład **Paleta** o
wartości 480 sztuk. Pozwalają kupcom B2B zamawiać w jednostkach hurtowych bez
wpisywania dokładnej liczby sztuk i niosą ten kontekst aż do zamówienia i
zapytania ofertowego.

## Dla operatorów

Zarządzaj jednostkami opakowania w sekcji **Inventory** karty produktu (tylko
produkty simple i configurable). Każda jednostka ma:

- **nazwę** (tekst operatora, np. `Paleta`, `Karton`) — unikalną w obrębie produktu,
- **base quantity** (liczba całkowita ≥ 1) — ile bazowych sztuk mieści jednostka,
- flagę **default** — jednostkę wstępnie wybraną na storefront,
- **position** — kolejność, w jakiej jednostki się pojawiają.

## Dla kupców

Na stronie produktu selektor oferuje dostępne jednostki plus opcję *pojedynczej
sztuki*. Zamówienie jednostki dodaje `baseQuantity × units` sztuk do koszyka jako
jedną linię, której wyświetlana nazwa dostaje dopisek jednostki — np.
`Łożysko 6205-2RS (Paleta)`. Linia z jednostką opakowania i zwykła linia
pojedynczej sztuki tego samego produktu pozostają osobne.

## Jak podróżuje etykieta

Nazwa jednostki i base quantity są **snapshotowane** na linii w momencie
utworzenia, więc późniejsze edycje (lub usunięcie) jednostek opakowania produktu
nigdy nie zmieniają historycznych koszyków, zamówień ani zapytań ofertowych.

- **Cart** — `cart_items` snapshotują jednostkę; serializer koszyka składa
  `displayName` z sufiksem.
- **Order** — `order_items` dostają `packaging_unit_snapshot`, a nazwa jednostki
  jest doklejana do `product_snapshot.name`, więc każdy dokument zamówienia
  (szczegóły, faktura, CSV, e-mail) ją pokazuje.
- **Quote request** — `quote_request_items` snapshotują jednostkę i doklejają ją
  do `product_name`; konwersja cart → quote-request niesie kontekst dalej.

## Ceny i dostępność

Ceny używają istniejącego silnika na wynikowej ilości bazowych sztuk (łącznie z
progami ilościowymi cennika) — nie ma osobnej ceny per jednostka. Dostępność
magazynowa i limity per linia są oceniane na wynikowej liczbie sztuk.

## Powierzchnia API

- Admin CRUD: `GET/POST /api/v1/admin/catalog/products/:id/packaging-units`,
  `PATCH/DELETE …/:unitId`, `PATCH …/packaging-units/reorder`
  (gated przez `catalog:read` / `catalog:write`).
- Publiczne: szczegóły produktu (`GET /api/v1/catalog/products/:idOrSlug`)
  zawierają opcjonalną tablicę `packagingUnits`.
- Cart: `POST /api/v1/cart/items` akceptuje opcjonalne `packagingUnitId`; wynikowa
  ilość linii to `baseQuantity × quantity`.

## Schemat

Tabela `product_packaging_units` (migracja 068): `id`, `product_id`
(FK → `products`, cascade delete), `name`, `base_quantity`
(`CHECK >= 1`), `position`, `is_default`, timestamps; `UNIQUE (product_id,
name)`. Additive kolumny snapshot: `cart_items` (069), `order_items` (070),
`quote_request_items` (071).
