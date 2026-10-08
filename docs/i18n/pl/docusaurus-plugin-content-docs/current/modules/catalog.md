---
title: catalog
sidebar_label: Katalog
description: Produkty, warianty, kategorie, atrybuty, kanały sprzedaży
---

# `catalog`

Katalog produktów: produkty (Products), warianty (ProductVariants), kategorie (Categories), atrybuty
(ProductAttributes) i kanały sprzedaży (SalesChannels). Odpowiada za wszystkie ścieżki odczytu, z
których korzysta storefront, oraz za edycję katalogu w panelu administracyjnym.

## API publiczne

Trasy administracyjne są chronione przez `catalog:read` (lista i odczyt) i `catalog:write` (zmiany).

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/catalog/products` | storefront / klucz API | Lista, wyszukiwanie i filtrowanie produktów w aktywnym kanale sprzedaży |
| `GET /api/v1/catalog/products/:idOrSlug` | storefront | Szczegóły produktu (bez ceny w niepublicznych kanałach sprzedaży) |
| `GET /api/v1/catalog/categories` | storefront | Zagnieżdżone drzewo kategorii |
| `GET /api/v1/catalog/categories/:id/content` | storefront | Treść strony jednej kategorii, dobrana do języka wywołującego |
| `GET /api/v1/catalog/filters` | storefront | Atrybuty, po których można filtrować w aktywnym kanale sprzedaży |
| `GET /api/v1/catalog/sitemap.xml` | roboty wyszukiwarek | Mapa witryny dla SEO |
| `GET /api/v1/admin/catalog/products?includeArchived` | administrator | Lista produktów w panelu (ze szkicami; wiersze zarchiwizowane na żądanie) |
| `GET /api/v1/admin/catalog/products/:id` | administrator | Szczegóły produktu |
| `POST /api/v1/admin/catalog/products` | administrator | Utworzenie produktu (`type` nie można zmienić po utworzeniu; `sku` można edytować) |
| `PATCH /api/v1/admin/catalog/products/:id` | administrator | Aktualizacja (łącznie z `sku`); zapisuje wpis audytu ze stateBefore / stateAfter; odrzuca z `409 sku_in_use`, gdy nowe SKU należy już do innego produktu |
| `DELETE /api/v1/admin/catalog/products/:id` | administrator | Archiwizacja (usunięcie miękkie) |
| `GET /api/v1/admin/catalog/attributes` | administrator | Lista atrybutów |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | administrator | Dane do listy wyboru — wszystkie atrybuty z żądaną flagą |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | administrator | Odczyt jednego atrybutu |
| `POST /api/v1/admin/catalog/attributes` | administrator | Utworzenie atrybutu (przyjmuje nowe flagi i `options[]` bezpośrednio w treści dla typów wyboru) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | administrator | Natychmiastowa zmiana `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isPriceRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition` (ponownie emituje `attribute.updated.v1`) |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | administrator | Usunięcie; odrzucane z `409 attribute_in_use_by_set`, dopóki odwołuje się do niego jakikolwiek zestaw atrybutów |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | administrator | Lista opcji atrybutów typu select/enum/multiselect |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | administrator | Dodanie opcji |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | administrator | Zmiana label / labelDefault / isDefault / sortOrder (wartości `value` opcji nie można zmienić) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | administrator | Usunięcie; odrzucane z `409 option_in_use`, dopóki którykolwiek produkt ma tę wartość |
| `POST /api/v1/admin/catalog/attribute-set-preview` | administrator | Podgląd, które atrybuty będą edytowalne, a które ukryte, gdy operator zmieni zestaw atrybutów produktu |
| `GET /api/v1/admin/catalog/categories` | administrator | Płaska lista, z której panel buduje drzewo |
| `POST /api/v1/admin/catalog/categories` | administrator | Utworzenie (kategoria nadrzędna musi istnieć) |
| `PATCH /api/v1/admin/catalog/categories/:id` | administrator | Aktualizacja; przy zmianie kategorii nadrzędnej sprawdzany jest łańcuch nowej kategorii nadrzędnej, aby odrzucić cykle (409) |
| `DELETE /api/v1/admin/catalog/categories/:id` | administrator | Usunięcie miękkie; odrzucane z 409, gdy odwołuje się do niej aktywna kategoria podrzędna |
| `GET /api/v1/admin/catalog/categories/:id/content` | administrator | Treść strony kategorii — jeden dokument Page Buildera na język ([Treść strony kategorii](./catalog/category-content.md)) |
| `PUT /api/v1/admin/catalog/categories/:id/content` | administrator | Zastąpienie treści strony kategorii; `null` ją czyści |
| `PUT /api/v1/catalog/products/by-sku/:sku` | klucz API | Idempotentne utworzenie lub aktualizacja (synchronizacja PIM) |

## Encje

`Product`, `ProductVariant`, `Category`, `ProductAttribute`, `SalesChannel` oraz tabele łączące
`product_categories`, `sales_channel_products`, `product_assets`.

## Emitowane zdarzenia

`product.created.v1`, `product.updated.v1`, `product.archived.v1`, `attribute.updated.v1`.
Odbiera je indeksowanie wyszukiwarki i są przekazywane subskrybentom webhooków.

`category.updated.v1` i `category.content.updated.v1` czyszczą pamięć podręczną kategorii w
storefroncie; pierwsze dodatkowo ponownie indeksuje produkty z poddrzewa zmienionej kategorii.

## Punkty rozszerzenia

- **Ceny w poszczególnych kanałach sprzedaży** — usługa zapytań dostaje kontekst kanału sprzedaży;
  nowe ograniczenia (np. katalogi dla segmentów klientów) dodaje się przez kompozycję w
  `catalog-query.service.ts`.
- **Unikalność sluga** — slug jest domyślnie unikalny we wszystkich kanałach sprzedaży; jeśli kolizje
  między językami staną się problemem, nadpisz mechanizm tworzenia slugów w
  `catalog-admin.service.ts`.

## Struktura i kompozycja produktu

Katalog zyskał kilka dodatkowych możliwości, każda z własną stroną:

- [Zestawy atrybutów](./catalog/attribute-sets.md) — wielokrotnego użytku schematy atrybutów
  przypisywane do produktów, z systemowym zestawem Default
- [Galeria produktu](./catalog/gallery-and-labels.md) — galeria zdjęć i filmów z regułami
  oznaczeń Base / Small / Thumbnail pilnowanymi przez bazę danych
- [Załączniki](./catalog/attachments.md) — pliki do pobrania (certyfikaty, specyfikacje techniczne,
  …) ze słownikiem typów
- [Powiązania produktów](./catalog/product-links.md) — produkty powiązane, droższe zamienniki i
  produkty uzupełniające, wyświetlane na stronie produktu i w koszyku
- [Produkty złożone](./catalog/composite-products.md) — `grouped` (stałe produkty podrzędne),
  `bundle` (konfigurowalne miejsca w zestawie), `virtual` (dostawa cyfrowa)

Obsługiwanych jest pięć typów produktu: `simple`, `configurable`, `grouped`, `bundle`, `virtual`.
`simple` i `configurable` to pierwotna para; pozostałe trzy dodano później.

## Rozszerzenia atrybutów na ścieżkach odczytu katalogu

Prace nad atrybutami dodały elementy, których storefront potrzebuje do wyświetlania rozbudowanych
informacji o produkcie, a moduły wyszukiwarki i promocji — do obsługi zapytań klientów. Edycję
atrybutów w pełni opisuje osobna strona [Atrybuty](./catalog/attributes.md); ta sekcja tylko
podsumowuje, co zmieniło się na ścieżkach odczytu katalogu.

### Nowe flagi atrybutów

`ProductAttribute` ma cztery flagi zachowania, pozycję liczbową i zastępczą etykietę dla brakujących
języków:

- `isPromoRule` (boolean) — atrybut jest dostępny na liście wyboru w kryterium `attribute` edytora
  reguł promocji
- `isVisibleOnProductPage` (boolean) — atrybut jest pokazywany na zakładce „Parametry produktu” na
  stronie produktu w storefroncie, gdy produkt ma jego wartość
- `isRequired` (boolean) — wymagany przy zapisie produktu, gdy atrybut należy do zestawu atrybutów
  produktu
- `filterPosition` (number) — klucz sortowania w panelu filtrów storefrontu (mniejsze wartości
  wyżej; remisy rozstrzyga etykieta)
- `labelDefault` (string) — wartość zastępcza, gdy w JSONB `label` brakuje klucza dla aktywnego
  języka

### Listy opcji

Atrybuty typu wyboru (`select`, `enum`, `multiselect`) mają uporządkowaną listę opcji — każdy wiersz
jest identyfikowany przez `(definition, value)` i ma etykiety w poszczególnych językach, etykietę
zastępczą, kolejność i flagę wartości domyślnej. Dawną kolumnę JSONB `enum_values: string[]` w
`product_attributes` wycofano migracją `20260505T060113_catalog_attribute_options_and_flags.ts`
(na rzecz tabeli katalogu `attribute_options`), a migracja
`20260723T230401_catalog_attributes_on_custom_fields.ts` przeniosła wiersze do ogólnej tabeli `custom_field_options`. Istniejące miejsca odczytu
odtwarzają na granicy API dawną postać listy opcji ze względu na zgodność wsteczną.

### Edytowalne SKU

`sku` produktu można zmieniać. Wewnętrznym, stałym odwołaniem we wszystkich powiązaniach między
modułami (pliki, powiązania produktów, pozycje zapytań ofertowych, …) jest UUID `Product.id`, który
nigdy się nie zmienia. Zmiana SKU zapisuje wpis audytu i jest odrzucana z `409 sku_in_use`, gdy nowa
wartość należy już do innego produktu.

### Zmiana zestawu atrybutów

Gdy operator przypisze produktowi inny zestaw atrybutów, formularz w panelu wyświetla się ponownie
tylko z atrybutami nowego zestawu. Wartości atrybutów spoza nowego zestawu pozostają po stronie
serwera w kolumnie JSONB — powrót do poprzedniego zestawu znów je pokazuje. Endpoint
`attribute-set-preview` pozwala edytorowi ostrzec operatora przed potwierdzeniem, które pola zostaną
ukryte, a które zachowane.

### Odczyty przez inne moduły

Dwie metody `CatalogQueryService` są używane ponad granicami modułów (udokumentowane porty usług):

- `comparableAttributeKeys(): string[]` — porównywarka
- `promoRuleAttributeKeys(): string[]` i `getAttributeWithOptions(key)` — promocje
- `buildVisibleAttributesProjection()` — wewnętrzna, używana przez odpowiedź ze szczegółami
  produktu do zbudowania `visibleAttributes[]`

## Atrybuty jako rozszerzenie pól niestandardowych {#atrybuty-jako-rozszerzenia-custom-field}

Przechowywanie definicji atrybutów połączono z ogólną warstwą pól niestandardowych modułu
`custom_fields` przez adapter, a nie przez przepisanie. W API HTTP nic się nie zmieniło — każdy
powyższy endpoint zachowuje swoją postać — ale model przechowywania i własności jest inny:

- **Atrybut produktu to rozszerzenie katalogu dla definicji pola niestandardowego encji produktu.**
  Ogólna tożsamość (`key`, `label` w poszczególnych językach i `labelDefault`, `valueType`,
  `required`) jest w wierszu `custom_field_definitions` z `entity_type = 'product'`. Tabela
  `product_attributes` pozostaje, przebudowana jako cienki wiersz rozszerzenia 1:1 (klucz obcy
  `custom_field_definition_id` z UNIQUE), zawierający tylko flagi zachowania katalogu
  (`isSearchable`, `isFilterable`, `isVariantAxis`, `displayAsSlider`, `isComparable`,
  `quickSearchable`, `isPromoRule`, `isPriceRule`, `filterPosition`, `isVisibleOnProductPage`,
  `channelScoped`,
  `languageScoped`, `massEditable`) oraz dwa ustawienia prezentacji (`selectDisplay`, `numericKind`),
  które bez strat zachowują dawne rozróżnienia `enum`/`select` i `number`/`price`. **Flagi pozostają
  własnością katalogu** — ogólny rdzeń nigdy ich nie interpretuje.
- **Opcje są w `custom_field_options`.** Tabeli katalogu `attribute_options` już nie ma; listy opcji
  to zwykłe opcje pola niestandardowego w definicji encji produktu.
- **Jedno miejsce zapisu: `/catalog/attributes`.** Zmiany atrybutów i opcji to polecenia katalogu,
  które tworzą, aktualizują lub usuwają definicję i rozszerzenie razem w jednej transakcji (z jednym
  wpisem audytu), korzystając z transakcyjnego API zapisu eksportowanego przez `custom_fields`.
  Ogólny ekran pól niestandardowych w panelu pokazuje definicje produktu tylko do odczytu i odrzuca
  zmiany z `409 host_managed`.
- **Migracja `20260723T230401_catalog_attributes_on_custom_fields.ts`** jednorazowo połączyła oba modele w jednej
  transakcji: utworzyła po jednej definicji dla każdego dawnego atrybutu (klucz, etykiety,
  przełożony typ wartości, wymagalność, deterministyczna kolejność), przeniosła wiersze
  `attribute_options` do `custom_field_options`, przepisała klucze `attribute_set_attributes` na
  identyfikatory definicji, dodała do `product_attributes` kolumny `custom_field_definition_id` /
  `select_display` / `numeric_kind`, usunęła powielone kolumny (`key`, `label`, `label_default`,
  `value_type`, `is_required`) i usunęła `attribute_options`. Migrację można cofnąć (`down()`
  przywraca dawną postać), a przy kolizji z zarezerwowanym kluczem przerywa się z wyraźnym błędem.
- **Wartości atrybutów nie zostały przeniesione** — `products.attribute_values`,
  `product_variants.variant_attribute_values` i `product_value_overrides` zachowują postać i
  pozostają własnością katalogu (encja jest właścicielem swoich danych).

Wewnętrzni odbiorcy (wyszukiwarka, szybkie zamówienie, porównywarka, masowa edycja, port promocji,
edytor zakresu) odczytują atrybuty przez eksportowany przez katalog `CatalogAttributeReadService`,
który łączy definicję i rozszerzenie w `CatalogAttributeView` o dawnej postaci.
