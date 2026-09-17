---
title: Powiązania produktów
---

# Powiązania produktów

Skierowane powiązania między produktami, które napędzają cross-merchandising na
PDP i w koszyku. Trzy rodzaje:

- **Related** — sekcja „Powiązane produkty” na PDP
- **Up-sell** — „Może Ci się spodobać” na PDP
- **Cross-sell** — „Może Ci być potrzebne” na stronie koszyka

## Gwarancje na poziomie bazy

Migracja 022 dostarcza trzy ograniczenia, które uniemożliwiają niepoprawne dane
linków:

- `UNIQUE (source_product_id, target_product_id, kind)` — ta sama para może
  wystąpić raz na rodzaj, nigdy dwa razy dla tego samego rodzaju
- `CHECK source_product_id <> target_product_id` — dodatkowa ochrona przed
  self-linkami poza warstwą API
- `CHECK kind IN ('related','up_sell','cross_sell')`

Obie kolumny FK kaskadują przy usunięciu produktu: wiersze linków nie mają
wartości, gdy zniknie któraś ze stron.

## Publiczne API

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/products/:id/links?kind=...` | admin | Lista linków z opcjonalnym filtrem po rodzaju |
| `POST /api/v1/admin/catalog/products/:id/links` | admin | Masowe tworzenie — transakcja all-or-nothing |
| `DELETE /api/v1/admin/catalog/products/:id/links/:linkId` | admin | Usunięcie pojedynczego linku |
| `PUT /api/v1/admin/catalog/products/:id/links/:kind/order` | admin | Zmiana kolejności według listy id |
| `GET /api/v1/catalog/products/:idOrSlug/links?kind=...` | storefront | Odczyt storefront; zarchiwizowane / ograniczone kanałem cele filtrowane po stronie serwera |

## Semantyka masowego tworzenia

`POST .../links` przyjmuje tablicę `links[]`, gdzie każdy wpis ma
`{targetProductId, kind, position?}`. Serwis waliduje całą partię przed
wstawieniem jakiegokolwiek wiersza:

1. Produkt źródłowy istnieje i nie jest zarchiwizowany (w przeciwnym razie 404)
2. Żaden wpis nie ma `targetProductId === sourceProductId` (400)
3. Wszystkie cele istnieją (404 z id sprawiającym problem)
4. Żadna para `(source, target, kind)` jeszcze nie istnieje (409)

Jeśli którykolwiek check się nie powiedzie, **żaden wiersz nie jest wstawiany**.
To odpowiada UX admina wysyłającego wyselekcjonowaną partię — częściowe
wstawienia zaskoczyłyby admina, który dopiero kończy wybór.

## Błędy

| Code | Status | Kiedy |
| --- | --- | --- |
| `SELF_LINK_NOT_ALLOWED` | 400 | source = target |
| `LINK_ALREADY_EXISTS` | 409 | Duplikat `(source, target, kind)` |
| `TARGET_PRODUCT_NOT_FOUND` | 404 | Brakujące id celu |
| `PRODUCT_LINK_NOT_FOUND` | 404 | Brak `:linkId` |

## Integracja ze storefrontem

`productDetail.links` niesie wstępnie pogrupowane tablice obcięte do domyślnych
rozmiarów strony (research §US4 + spec.md US4 Assumptions): `related[8]`,
`upSell[4]`, `crossSell[4]`. Każdy wpis to link w kształcie storefront
`{id, kind, position, product{id, sku, slug, name, primaryAssetUrl, price}}`, więc
karta listingu renderuje się bez dodatkowego fetcha.

Komponent PDP `<ProductLinksSections>` renderuje Related i Up-sell pod własnymi
nagłówkami. Komponent koszyka `<CrossSellSection>` pobiera linki cross-sell per
pozycja koszyka i deduplikuje po id produktu, żeby ten sam cel pokazał się raz,
nawet gdy dotarł przez wiele pozycji koszyka.

## Magazynowanie

Pojedyncza tabela `product_links` z powyższymi ograniczeniami plus indeksy na
`(source_product_id, kind)` i `(target_product_id)`.
