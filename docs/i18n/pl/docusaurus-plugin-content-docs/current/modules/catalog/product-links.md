---
title: Powiązania produktów
---

# Powiązania produktów

Jednokierunkowe powiązania między produktami, które pozwalają proponować inne produkty na stronie
produktu i w koszyku. Trzy rodzaje:

- **Related** — sekcja „Powiązane produkty” na stronie produktu
- **Up-sell** — sekcja „Może Ci się spodobać” na stronie produktu
- **Cross-sell** — sekcja „Może Ci być potrzebne” na stronie koszyka

## Gwarancje na poziomie bazy danych

Migracja `20260429T123726_catalog_product_links.ts` wprowadza trzy ograniczenia, które uniemożliwiają zapisanie niepoprawnych powiązań:

- `UNIQUE (source_product_id, target_product_id, kind)` — ta sama para może wystąpić raz dla
  każdego rodzaju, nigdy dwa razy dla tego samego rodzaju
- `CHECK source_product_id <> target_product_id` — dodatkowa ochrona przed powiązaniem produktu z
  samym sobą, niezależna od API
- `CHECK kind IN ('related','up_sell','cross_sell')`

Obie kolumny kluczy obcych są usuwane kaskadowo razem z produktem: powiązanie traci sens, gdy znika
którakolwiek ze stron.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/products/:id/links?kind=...` | administrator | Lista powiązań z opcjonalnym filtrem rodzaju |
| `POST /api/v1/admin/catalog/products/:id/links` | administrator | Tworzenie wielu powiązań — transakcja „wszystko albo nic” |
| `DELETE /api/v1/admin/catalog/products/:id/links/:linkId` | administrator | Usunięcie jednego powiązania |
| `PUT /api/v1/admin/catalog/products/:id/links/:kind/order` | administrator | Zmiana kolejności według listy identyfikatorów |
| `GET /api/v1/catalog/products/:idOrSlug/links?kind=...` | storefront | Odczyt dla storefrontu; produkty zarchiwizowane i spoza kanału są pomijane po stronie serwera |

## Tworzenie wielu powiązań

`POST .../links` przyjmuje tablicę `links[]`, w której każdy wpis ma
`{targetProductId, kind, position?}`. Usługa sprawdza całą tablicę, zanim wstawi jakikolwiek wiersz:

1. Produkt źródłowy istnieje i nie jest zarchiwizowany (w przeciwnym razie 404)
2. Żaden wpis nie ma `targetProductId === sourceProductId` (400)
3. Wszystkie produkty docelowe istnieją (404 z identyfikatorem, który sprawił problem)
4. Żadna para `(source, target, kind)` jeszcze nie istnieje (409)

Jeśli którekolwiek sprawdzenie się nie powiedzie, **żaden wiersz nie zostaje wstawiony**. Odpowiada to
pracy administratora, który wysyła wybrany zestaw — częściowe zapisanie zaskoczyłoby kogoś, kto
dopiero kończy wybierać.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `SELF_LINK_NOT_ALLOWED` | 400 | source = target |
| `LINK_ALREADY_EXISTS` | 409 | Powtórzona trójka `(source, target, kind)` |
| `TARGET_PRODUCT_NOT_FOUND` | 404 | Brak produktu docelowego |
| `PRODUCT_LINK_NOT_FOUND` | 404 | Brak `:linkId` |

## Storefront

`productDetail.links` zawiera wstępnie pogrupowane tablice ograniczone do domyślnych rozmiarów:
`related[8]`, `upSell[4]`, `crossSell[4]`. Każdy wpis to powiązanie w postaci przeznaczonej dla
storefrontu, `{id, kind, position, product{id, sku, slug, name, primaryAssetUrl, price}}`, więc karta
produktu wyświetla się bez dodatkowego zapytania.

Komponent `<ProductLinksSections>` na stronie produktu wyświetla Related i Up-sell pod osobnymi
nagłówkami. Komponent `<CrossSellSection>` w koszyku pobiera powiązania cross-sell dla każdej pozycji
koszyka i usuwa duplikaty według identyfikatora produktu, aby ten sam produkt pojawił się raz, nawet
jeśli wskazuje go kilka pozycji koszyka.

## Przechowywanie

Jedna tabela `product_links` z powyższymi ograniczeniami oraz indeksami na
`(source_product_id, kind)` i `(target_product_id)`.
