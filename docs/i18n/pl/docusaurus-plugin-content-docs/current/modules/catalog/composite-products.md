---
title: Produkty złożone
---

# Produkty złożone: grouped, bundle, virtual

Katalog obsługuje trzy typy produktów oprócz `simple` / `configurable`. Każdy ma na stronie produktu
własną część danych zależną od typu i wyświetla osobny komponent w obszarze akcji storefrontu.

## Typy

### Grouped (grupa)

Produkt nadrzędny ze stałą listą produktów podrzędnych w stałych ilościach. Kupujący nie wybiera
produktów podrzędnych — kupuje cały zestaw. Przykład: SKU „Starter kit”, który łączy dwa proste
produkty w ilościach 2 i 1.

### Bundle (zestaw konfigurowalny)

Produkt nadrzędny z nazwanymi miejscami (slotami), z których każde ma zakres ilości (min / max) i
jeden lub więcej produktów do wyboru. Przykład: konfigurowalna stacja robocza, w której kupujący
wybiera procesor (slot, min=1, max=1) i dodatki (slot, min=0, max=3).

### Virtual (cyfrowy)

Produkt cyfrowy z `downloadAssetId` (plik przechowywany na serwerze) **albo** `downloadUrl` (link
zewnętrzny) — MUSI być ustawione dokładnie jedno z nich (sprawdzają to Zod `refine` i zabezpieczenie
w usłudze). Przykłady: e-book w PDF, dostarczenie klucza licencyjnego, link do zewnętrznego portalu
z plikami do pobrania.

## Bez zagnieżdżania produktów złożonych

Produkt grouped nie może zawierać jako produktu podrzędnego innego produktu grouped ani bundle.
Opcjami w slotach zestawu bundle też nie mogą być produkty grouped ani bundle. Reguła jest
egzekwowana w usłudze, bo ograniczenia CHECK w PostgreSQL nie mogą łączyć się z `products`, aby
sprawdzić `type` wskazywanego wiersza. Błąd to `NESTED_COMPOSITE_NOT_ALLOWED` (400).

## API publiczne

### Panel administracyjny

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET / POST / PATCH / DELETE /products/:id/grouped-items[/:itemId]` | Zarządzanie produktami w grupie |
| `GET / POST / PATCH / DELETE /products/:id/bundle-slots[/:slotId]` | Zarządzanie slotami zestawu |
| `POST / DELETE /products/:id/bundle-slots/:slotId/options[/:optionId]` | Zarządzanie opcjami slotu |

### Storefront

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `POST /api/v1/catalog/products/:idOrSlug/bundle-configuration/validate` | Samo obliczenie: sprawdzenie konfiguracji zestawu wybranej przez kupującego |

Endpoint walidacji to jedyne żądanie POST w publicznym API katalogu. Zwraca
`{valid, errors[], resolvedSelections}` zamiast odpowiedzi spoza 2xx — storefront potrzebuje
ustrukturyzowanej listy błędów, aby wyróżnić każdy slot z problemem.

## Błędy walidacji (w treści odpowiedzi)

| Kod | Kiedy |
| --- | --- |
| `MIN_NOT_MET` | Łączna wybrana ilość w slocie < `minQuantity` |
| `MAX_EXCEEDED` | Łączna wybrana ilość w slocie > `maxQuantity` |
| `UNKNOWN_OPTION` | `optionId` nie należy do slotu |

Odmowy na poziomie HTTP (400 `PRODUCT_TYPE_MISMATCH`, gdy produkt nie jest zestawem bundle, 404
`PRODUCT_NOT_FOUND`) nadal obowiązują.

## Błędy przy zarządzaniu

| Kod | Status | Kiedy |
| --- | --- | --- |
| `PRODUCT_TYPE_MISMATCH` | 400 | Wywołanie endpointów grouped/bundle dla produktu nadrzędnego innego typu |
| `NESTED_COMPOSITE_NOT_ALLOWED` | 400 | Produkt podrzędny albo opcja sam jest typu grouped lub bundle |
| `INVALID_QUANTITY_RANGE` | 400 | W slocie `minQuantity > maxQuantity` |
| `OPTION_ALREADY_EXISTS` | 409 | Ten sam produkt użyty ponownie jako opcja w slocie |
| `GROUPED_ITEM_NOT_FOUND` | 404 | Brak `:itemId` |
| `BUNDLE_SLOT_NOT_FOUND` | 404 | Brak `:slotId` |
| `BUNDLE_SLOT_OPTION_NOT_FOUND` | 404 | Brak `:optionId` |

## Storefront

`productDetail` zawiera jedną z trzech części, zależnie od `type`:

- `groupedItems[]` przy type='grouped' — `{id, position, quantity, product{...}}`
- `bundleSlots[]` przy type='bundle' — `{id, name, minQuantity, maxQuantity, position, options: [{id, defaultQuantity, position, product{...}}]}`
- `virtual` przy type='virtual' — `{downloadAssetId, downloadUrl}`

Strona produktu wybiera obszar akcji według typu:

| `product.type` | Komponent | Działanie |
| --- | --- | --- |
| `simple`, `configurable` | dotychczasowe Add-to-cart, zapytanie ofertowe i VariantPicker | bez zmian |
| `grouped` | `<GroupedSummary>` | Lista tylko do odczytu i przycisk „Dodaj zestaw do koszyka” |
| `bundle` | `<BundleConfigurator>` | Wybór dla każdego slotu i pole ilości; przycisk jest nieaktywny, dopóki wymagany slot nie jest wypełniony |
| `virtual` | `<VirtualCta>` | Przycisk „Kup i pobierz” i opis sposobu dostarczenia |

## Przechowywanie

- `grouped_items` (id, parent_product_id FK CASCADE, child_product_id FK RESTRICT, quantity,
  position; UNIQUE (parent, child); CHECK `quantity > 0` i `parent <> child`)
- `bundle_slots` (id, parent_product_id FK CASCADE, name jsonb, minQuantity / maxQuantity int; CHECK
  `min_quantity <= max_quantity`, `min_quantity >= 0` i `max_quantity > 0`)
- `bundle_slot_options` (id, slot_id FK CASCADE, option_product_id FK RESTRICT, default_quantity,
  position; UNIQUE (slot, option_product))

Pola produktu cyfrowego są w samej tabeli `products`: opcjonalny klucz obcy `download_asset_id` i
opcjonalne `download_url` (varchar).
