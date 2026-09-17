---
title: catalog
sidebar_label: Catalog
description: Produkty, warianty, kategorie, atrybuty, kanały sprzedaży
---

# `catalog`

Katalog produktów: Products, ProductVariants, Categories,
ProductAttributes i SalesChannels. Posiada wszystkie ścieżki odczytu, od
których zależy storefront, oraz powierzchnię autorską po stronie admina.

## Publiczne API

Trasy admina są chronione przez `catalog:read` (list / get) /
`catalog:write` (mutacje).

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/catalog/products` | storefront / API key | Lista/szukaj/filtruj produkty w aktywnym Sales Channel |
| `GET /api/v1/catalog/products/:idOrSlug` | storefront | Szczegóły produktu (cena pominięta na niepublicznych Sales Channels) |
| `GET /api/v1/catalog/categories` | storefront | Zagnieżdżone drzewo kategorii |
| `GET /api/v1/catalog/filters` | storefront | Atrybuty filtrowalne dla aktywnego Sales Channel |
| `GET /api/v1/catalog/sitemap.xml` | crawlers | Mapa witryny SEO |
| `GET /api/v1/admin/catalog/products?includeArchived` | admin | Lista produktów admin (z draftami; wiersze zarchiwizowane opt-in) |
| `GET /api/v1/admin/catalog/products/:id` | admin | Szczegóły produktu |
| `POST /api/v1/admin/catalog/products` | admin | Utworzenie produktu (`type` niemutowalne po utworzeniu; `sku` edytowalne per feature 012 / US3) |
| `PATCH /api/v1/admin/catalog/products/:id` | admin | Aktualizacja (łącznie z `sku`); zapisuje wiersz audytu ze stateBefore / stateAfter; odmawia z `409 sku_in_use`, gdy nowe SKU należy już do innego produktu |
| `DELETE /api/v1/admin/catalog/products/:id` | admin | Archiwizacja (soft) |
| `GET /api/v1/admin/catalog/attributes` | admin | Lista atrybutów |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | admin | Payload pickera — każdy atrybut z żądaną flagą (feature 012 / US1) |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | admin | Odczyt pojedynczego atrybutu |
| `POST /api/v1/admin/catalog/attributes` | admin | Utworzenie atrybutu (akceptuje nowe flagi + inline `options[]` dla typów select-style) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | admin | Hot-toggle `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition` (re-emituje `attribute.updated.v1`) |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | admin | Usunięcie; odmawia z `409 attribute_in_use_by_set`, dopóki jakikolwiek Attribute Set nadal się odwołuje (feature 012 / US1) |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | Lista wierszy opcji dla atrybutów select/enum/multiselect (feature 012 / US4) |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | Dołączenie opcji |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | admin | Patch label / labelDefault / isDefault / sortOrder (option `value` niemutowalne per FR-026) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | admin | Usunięcie; odmawia z `409 option_in_use`, dopóki jakikolwiek produkt niesie wartość (FR-025) |
| `POST /api/v1/admin/catalog/attribute-set-preview` | admin | Podgląd, które atrybuty Set będą edytowane / ukryte, gdy operator przełączy Attribute Set produktu (feature 012 / US2) |
| `GET /api/v1/admin/catalog/categories` | admin | Płaska lista, UI składa w drzewo |
| `POST /api/v1/admin/catalog/categories` | admin | Utworzenie (rodzic musi istnieć) |
| `PATCH /api/v1/admin/catalog/categories/:id` | admin | Aktualizacja; reparenting przechodzi łańcuch nowego rodzica, żeby odmówić cykli (409) |
| `DELETE /api/v1/admin/catalog/categories/:id` | admin | Soft-delete; odrzuca z 409, gdy aktywne dziecko nadal odwołuje się do wiersza |
| `PUT /api/v1/catalog/products/by-sku/:sku` | API key | Idempotentny upsert (sync PIM) |

## Encje

`Product`, `ProductVariant`, `Category`, `ProductAttribute`,
`SalesChannel`, plus mosty M:N
`product_categories`, `sales_channel_products`, `product_assets`. Autorytatywny
diagram ER jest w `specs/001-b2b-platform-foundation/data-model.md`
w repozytorium źródłowym.

## Emitowane zdarzenia

`product.created.v1`, `product.updated.v1`, `product.archived.v1`,
`attribute.updated.v1`. Konsumowane przez indeksator wyszukiwania i bridgowane do
subskrybentów webhook.

## Punkty rozszerzenia

- **Ceny per Sales Channel** — serwis query dostaje kontekst SalesChannel;
  nowe gating (np. katalogi per segment klienta) dodajesz przez kompozycję w
  `catalog-query.service.ts`.
- **Unikalność slug** — slug jest unikalny we wszystkich Sales Channels domyślnie;
  nadpisz slugifier w `catalog-admin.service.ts`, jeśli kolizje locale staną się
  problemem.

## Rozszerzenia feature 002

Katalog urósł o kilka powierzchni capability w feature 002. Każda ma
własną stronę:

- [Zestawy atrybutów](./catalog/attribute-sets.md) — wielokrotnie używane schematy
  atrybutów przypięte do Products, z systemowym Default
- [Galeria produktu](./catalog/gallery-and-labels.md) — galeria obrazu / wideo
  z invariantami etykiet Base / Small / Thumbnail egzekwowanymi na poziomie bazy
- [Załączniki](./catalog/attachments.md) — pliki do pobrania
  (certyfikaty, specyfikacje techniczne, ...) ze słownikiem typów
- [Powiązania produktów](./catalog/product-links.md) — Related, Up-sell,
  Cross-sell napędzające cross-merchandising na PDP i w koszyku
- [Produkty złożone](./catalog/composite-products.md) — `grouped`
  (stałe dzieci), `bundle` (konfigurowalne sloty), `virtual` (dostawa
  cyfrowa)

Obsługiwanych jest teraz pięć typów produktu: `simple`, `configurable`,
`grouped`, `bundle`, `virtual`. `simple` i `configurable` to oryginały
foundation 001; pozostałe trzy dodano w 002.

## Rozszerzenia feature 012

Feature 012 (Attributes) dodał powierzchnię operacyjną, której storefront
potrzebuje do renderowania bogatych informacji o produkcie, a moduły search /
promotions potrzebują do rozwiązywania zapytań klientów. Dedykowana strona
[Atrybuty](./catalog/attributes.md) opisuje w pełni powierzchnię autorską
atrybutów — ta sekcja tylko podsumowuje, co zmieniło się na ścieżkach odczytu
Catalog.

### Nowe flagi atrybutów

`ProductAttribute` dostaje cztery flagi behawioralne + pozycję numeryczną +
fallback etykiety per locale:

- `isPromoRule` (boolean) — kwalifikacja pickera dla wariantu kryterium `attribute`
  edytora Promotion Rule
- `isVisibleOnProductPage` (boolean) — pokaż atrybut na zakładce storefront PDP
  „Parametry produktu”, gdy produkt niesie wartość
- `isRequired` (boolean) — egzekwowane przy zapisie produktu, gdy atrybut jest
  częścią Attribute Set produktu
- `filterPosition` (number) — klucz sortowania sidebar filtrów storefront
  (niższe wcześniej; remisy łamane etykietą)
- `labelDefault` (string) — fallback, gdy aktywny locale nie ma pasującego klucza
  w per-locale JSONB `label`

### Listy opcji (US4)

Typy atrybutów select-style (`select`, `enum`, `multiselect`) niosą uporządkowaną
listę opcji — każdy wiersz kluczowany przez `(definition, value)` z
per-locale label + fallback + sort order + flagą default. Legacy kolumna
`enum_values: string[]` JSONB na `product_attributes` została
wycofana migracją 032 (do własnościowej tabeli katalogu
`attribute_options`), a feature 061 / migracja 102 przeniosła
wiersze do generycznej tabeli `custom_field_options`. Istniejący czytelnicy
projektują listę opcji z powrotem w legacy formę dla kompatybilności wstecznej
na granicy API.

### Edytowalne SKU (US3)

`sku` produktu jest mutowalne. Wewnętrzne kanoniczne odwołanie dla każdego
linku cross-module (assets, links, pozycje RFQ, ...) to UUID `Product.id`,
który nigdy się nie zmienia. Aktualizacja SKU zapisuje wiersz audytu i
odmawia z `409 sku_in_use`, gdy nowa wartość należy już do innego produktu.

### Zamiana Attribute Set (US2)

Gdy operator przypisze inny Attribute Set do Product, formularz admina
re-renderuje się, pokazując tylko atrybuty nowego Set. Wartości atrybutów
poza nowym Set pozostają w kolumnie JSONB po stronie serwera
(FR-012) — powrót do poprzedniego zestawu je z powrotem eksponuje. Endpoint
`attribute-set-preview` pozwala edytorowi ostrzec operatora, które pola
zostaną ukryte vs. zachowane, zanim potwierdzi.

### Powierzchnia odczytu cross-module

Dwie metody na `CatalogQueryService` przekraczają granice modułów (udokumentowane
porty serwisowe per Constitution I):

- `comparableAttributeKeys(): string[]` — feature 007 (Compare)
- `promoRuleAttributeKeys(): string[]` + `getAttributeWithOptions(key)`
  — feature 012 / US8 (Promotions)
- `buildVisibleAttributesProjection()` — wewnętrzne, używane przez odpowiedź
  szczegółów PDP do złożenia payloadu `visibleAttributes[]`

## Feature 061 — atrybuty jako rozszerzenia Custom Field

Feature 061 zbiegł magazyn definicji atrybutów na generyczną warstwę Custom
Fields, którą posiada moduł `custom_fields` (feature 055),
kształtowaną jak adapter per Constitution Principle XIV. Na powierzchni HTTP
nic się nie zmieniło — każdy endpoint powyżej zachowuje kształt — ale model
magazynowania i własności jest inny:

- **Atrybut produktu to rozszerzenie katalogu definicji Custom Field hosta
  produktu.** Generyczna tożsamość (`key`, per-locale `label` +
  `labelDefault`, `valueType`, `required`) żyje na wierszu
  `custom_field_definitions` z `entity_type = 'product'`. Tabela
  `product_attributes` pozostaje, przebudowana jako cienki wiersz rozszerzenia 1:1
  (`custom_field_definition_id` UNIQUE FK) niosący tylko flagi behawioralne
  katalogu (`isSearchable`, `isFilterable`,
  `isVariantAxis`, `displayAsSlider`, `isComparable`,
  `quickSearchable`, `isPromoRule`, `filterPosition`,
  `isVisibleOnProductPage`, `channelScoped`, `languageScoped`,
  `massEditable`) plus dwa refinements prezentacji (`selectDisplay`,
  `numericKind`), które zachowują bezstratnie legacy rozróżnienia `enum`/`select` i
  `number`/`price`. **Flagi pozostają własnością katalogu**
  — generyczny core nigdy ich nie interpretuje.
- **Opcje żyją w `custom_field_options`.** Własnościowa tabela katalogu
  `attribute_options` zniknęła; listy opcji to zwykłe wiersze opcji Custom Field
  na definicji hosta produktu.
- **Jedna powierzchnia zapisu: `/catalog/attributes`.** Mutacje atrybutów i
  opcji to Commands katalogu tworzące/aktualizujące/usuwające definicję i
  rozszerzenie razem w jednej transakcji (jeden wiersz audytu), używając
  transakcyjnego apply seam eksportowanego przez
  `custom_fields`. Generyczna powierzchnia admin Custom Fields listuje
  definicje produktów read-only i odmawia mutacji z
  `409 host_managed`.
- **Migracja `102_attributes_on_custom_fields.ts`** wykonała jednorazową
  konwergencję w jednej transakcji: backfill jednej definicji per legacy atrybut
  (key, labels, zmapowany value type, required, deterministyczny sort order),
  przeniosła wiersze `attribute_options`
  do `custom_field_options`, re-keyowała `attribute_set_attributes` na
  id definicji, dodała `custom_field_definition_id` /
  `select_display` / `numeric_kind` do `product_attributes`, usunęła
  zduplikowane kolumny (`key`, `label`, `label_default`,
  `value_type`, `is_required`) i usunęła `attribute_options`. Migracja
  jest odwracalna (`down()` przywraca legacy kształt) i
  abortuje głośno przy kolizji reserved-key.
- **Wartości atrybutów się nie przeniosły** — `products.attribute_values`,
  `product_variants.variant_attribute_values` i
  `product_value_overrides` zachowują kształt i własność katalogu
  (host posiada swoje dane).

Wewnętrzni konsumenci (search, quick order, comparisons, bulk edit,
port promotions, edytor scope) czytają atrybuty przez
eksportowany przez katalog `CatalogAttributeReadService`, który składa
definicję i rozszerzenie w legacy-shaped
`CatalogAttributeView`.
