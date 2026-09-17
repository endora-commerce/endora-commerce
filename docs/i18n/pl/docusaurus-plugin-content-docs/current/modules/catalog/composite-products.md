---
title: Produkty złożone
---

# Produkty złożone: grouped, bundle, virtual

Feature 002 wprowadza trzy typy produktów poza `simple` /
`configurable`. Każdy niesie payload dyskryminowany typem na PDP
i renderuje dedykowany komponent w strefie akcji storefront.

## Typy

### Grouped

Produkt nadrzędny ze stałą listą produktów podrzędnych w stałych
ilościach. Kupujący nie konfiguruje, które dzieci — kupuje cały zestaw.
Przypadek użycia: SKU „Starter kit” bundlujący dwa proste produkty w ilościach 2 i 1.

### Bundle

Produkt nadrzędny ze slotami nazwanymi, każdy z zakresem min / max ilości
i jednym lub więcej produktami opcji do wyboru. Przypadek użycia:
konfigurowalna stacja robocza, gdzie kupujący wybiera CPU (slot, min=1
max=1) i dodatki (slot, min=0 max=3).

### Virtual

Produkt cyfrowy z `downloadAssetId` (plik hostowany po stronie serwera) **lub**
`downloadUrl` (link zewnętrzny) — dokładnie jedno z dwóch MUSI być ustawione
(Zod refine + guard warstwy serwisu). Przypadek użycia: PDF e-booka, fulfilment
klucza licencyjnego, link do zewnętrznego portalu pobierania.

## Brak zagnieżdżonych kompozytów (research R-8)

Produkt grouped nie może zawierać innego grouped ani bundle jako dziecka.
Opcje slotu bundle też nie mogą być produktami grouped ani bundle.
Reguła jest egzekwowana w warstwie serwisu, bo ograniczenia CHECK PostgreSQL
nie mogą JOIN-ować `products`, żeby sprawdzić `type` wiersza FK. Wychodzi jako
`NESTED_COMPOSITE_NOT_ALLOWED` (400).

## Publiczne API

### Admin

| Verb + Path | Cel |
| --- | --- |
| `GET / POST / PATCH / DELETE /products/:id/grouped-items[/:itemId]` | CRUD grouped |
| `GET / POST / PATCH / DELETE /products/:id/bundle-slots[/:slotId]` | CRUD slotów bundle |
| `POST / DELETE /products/:id/bundle-slots/:slotId/options[/:optionId]` | CRUD opcji slotu |

### Storefront

| Verb + Path | Cel |
| --- | --- |
| `POST /api/v1/catalog/products/:idOrSlug/bundle-configuration/validate` | Czyste obliczenie: walidacja konfiguracji bundle kupującego |

Endpoint walidacji to jedyny POST na publicznej powierzchni katalogu.
Zwraca `{valid, errors[], resolvedSelections}` zamiast non-2xx — storefront
chce ustrukturyzowaną listę błędów, żeby podświetlić każdy problematyczny slot.

## Błędy walidacji (wewnątrz koperty odpowiedzi)

| Code | Kiedy |
| --- | --- |
| `MIN_NOT_MET` | Suma wybranej ilości slotu < `minQuantity` |
| `MAX_EXCEEDED` | Suma wybranej ilości slotu > `maxQuantity` |
| `UNKNOWN_OPTION` | `optionId` nie należy do slotu |

Odrzucenia na poziomie HTTP (400 `PRODUCT_TYPE_MISMATCH`, gdy produkt nie jest
bundle, 404 `PRODUCT_NOT_FOUND`) nadal obowiązują.

## Błędy CRUD

| Code | Status | Kiedy |
| --- | --- | --- |
| `PRODUCT_TYPE_MISMATCH` | 400 | Wywołanie endpointów grouped/bundle na złym typie rodzica |
| `NESTED_COMPOSITE_NOT_ALLOWED` | 400 | Produkt dziecka / opcji sam jest grouped lub bundle |
| `INVALID_QUANTITY_RANGE` | 400 | Slot `minQuantity > maxQuantity` |
| `OPTION_ALREADY_EXISTS` | 409 | Ten sam produkt opcji użyty ponownie w slocie |
| `GROUPED_ITEM_NOT_FOUND` | 404 | Brak `:itemId` |
| `BUNDLE_SLOT_NOT_FOUND` | 404 | Brak `:slotId` |
| `BUNDLE_SLOT_OPTION_NOT_FOUND` | 404 | Brak `:optionId` |

## Integracja ze storefrontem

`productDetail` niesie jedną z trzech gałęzi według `type`:

- `groupedItems[]` gdy type='grouped' — `{id, position, quantity, product{...}}`
- `bundleSlots[]` gdy type='bundle' — `{id, name, minQuantity, maxQuantity, position, options: [{id, defaultQuantity, position, product{...}}]}`
- `virtual` gdy type='virtual' — `{downloadAssetId, downloadUrl}`

PDP przełącza strefę akcji według typu:

| `product.type` | Komponent | UX |
| --- | --- | --- |
| `simple`, `configurable` | legacy Add-to-cart + RFQ + VariantPicker | bez zmian |
| `grouped` | `<GroupedSummary>` | Lista read-only + CTA „Dodaj bundle do koszyka” |
| `bundle` | `<BundleConfigurator>` | Select per slot + input ilości; CTA wyłączone, gdy wymagany slot niespełniony |
| `virtual` | `<VirtualCta>` | CTA „Kup i pobierz” + copy dostawy |

## Magazynowanie

- `grouped_items` (id, parent_product_id FK CASCADE, child_product_id
  FK RESTRICT, quantity, position; UNIQUE (parent, child); CHECK
  `quantity > 0` + `parent <> child`)
- `bundle_slots` (id, parent_product_id FK CASCADE, name jsonb,
  minQuantity / maxQuantity int; CHECK `min_quantity <= max_quantity` +
  `min_quantity >= 0` + `max_quantity > 0`)
- `bundle_slot_options` (id, slot_id FK CASCADE, option_product_id FK
  RESTRICT, default_quantity, position; UNIQUE (slot, option_product))

Pola pobierania virtual żyją na samej tabeli `products`
(`download_asset_id` FK nullable + `download_url` varchar nullable),
wprowadzone migracją US2.
