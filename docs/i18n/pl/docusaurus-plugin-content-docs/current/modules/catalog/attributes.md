---
title: Atrybuty
---

# Atrybuty

**Atrybut** to pojedyncza nazwana właściwość, którą można przypiąć do
produktu — `color`, `gear_ratio`, `material`, `weight`. Atrybuty to
niższy poziom prymitywu konsumowany przez wszystko, co dekoruje produkt:
sidebar filtrów storefront, zakładkę PDP „Parametry produktu”,
stronę Compare, edytor reguł promocji, indeks wyszukiwania
i picker wariantów produktu configurable.

Atrybuty są grupowane w [Zestawy atrybutów](./attribute-sets.md), które
są potem przypinane do produktu, żeby edytor admina renderował tylko
pola potrzebne danej rodzinie. Ta strona opisuje sam atrybut; powiązanie
zestaw ↔ produkt jest na stronie Zestawy atrybutów.

## Anatomia

Każdy atrybut niesie:

| Field | Cel |
| --- | --- |
| `key` | Stabilny identyfikator URL-safe — `^[a-z][a-z0-9_]*$`, unikalny w całej platformie (case-insensitive). Używany w URL filtrów, payloadach wyszukiwania i kluczu JSONB produktu. |
| `label` | Mapa etykiet per locale `Record<bcp47-tag, string>`. |
| `labelDefault` | Etykieta fallback, gdy aktywny storefront / locale admina nie ma wpisu w `label`. |
| `valueType` | Jeden z `string`, `number`, `boolean`, `price`, `date`, `select`, `multiselect`, `enum`. |
| `options[]` | Posortowana lista opcji do wyboru — tylko dla `select` / `multiselect` / `enum`. Zobacz [Listy opcji](#listy-opcji) poniżej. |

Plus flagi behawioralne i pozycja numeryczna:

| Flag | Default | Konsumowane przez |
| --- | --- | --- |
| `isFilterable` | `false` | Sidebar filtrów storefront |
| `isSearchable` | `false` | Indeksator wyszukiwania (Meilisearch) |
| `isComparable` | `false` | Strona Compare storefront |
| `isVariantAxis` | `false` | Picker wariantów produktu configurable |
| `isRequired` | `false` | Walidator zapisu produktu (tylko gdy atrybut jest w przypisanym Attribute Set) |
| `isPromoRule` | `false` | Picker kryteriów reguły promocji |
| `isVisibleOnProductPage` | `false` | Zakładka PDP „Parametry produktu” |
| `displayAsSlider` | `false` | Sidebar storefront — renderuje suwak zakresu; tylko dla `valueType ∈ ('number','price')` |
| `filterPosition` | `0` | Klucz sortowania sidebar storefront (rosnąco; remisy alfabetycznie po rozwiązanej etykiecie) |

## Typy wartości

| Type | Storage | Notes |
| --- | --- | --- |
| `string` | string | Wolny tekst. |
| `number` | number | Numeryczny; wspiera `displayAsSlider` dla filtrów zakresu. |
| `boolean` | boolean | Dwa stany. |
| `price` | number | Kwota pieniężna — formatowana w aktywnej walucie / locale. Wspiera `displayAsSlider`. |
| `date` | ISO 8601 date string | |
| `select` | option `value` | Pojedynczy wybór z `options[]`. Co najwyżej jedna opcja może mieć `isDefault = true`. |
| `multiselect` | array of option `value`s | Wiele wyborów z `options[]`. Dowolna liczba opcji może mieć `isDefault = true`. |
| `enum` | option `value` | Ten sam kształt storage co `select`; renderuje się jako kompaktowa pigułka / segmented control na filtrach storefront i PDP zamiast dropdownu. |

Zmiana `valueType`, gdy jakikolwiek produkt niesie wartość, której nowy typ
nie może reprezentować, jest odrzucana z `attribute_type_change_unsafe` (FR-007).

## Listy opcji

Dla atrybutów `select` / `multiselect` / `enum` lista opcji jest
autorowana inline w edytorze atrybutu. Każda opcja niesie:

| Field | Cel |
| --- | --- |
| `value` | Stabilny identyfikator — `^[a-z0-9_-]{1,200}$`, unikalny w obrębie atrybutu. Kodowany w URL filtrów i zapisywany na każdym produkcie z tą wartością. |
| `label` | Mapa etykiet per locale `Record<bcp47-tag, string>`. |
| `labelDefault` | Etykieta fallback, gdy aktywny locale nie ma wpisu w `label`. |
| `isDefault` | Opcjonalna preselekcja na nowych produktach. `select` / `enum` pozwalają co najwyżej na jedną; `multiselect` na dowolną liczbę. |
| `sortOrder` | Kolejność renderowania; remisy łamane przez `value` ASC. |

**Wartości** opcji są niemutowalne, dopóki jakikolwiek produkt je niesie
(FR-026) — operator musi najpierw zmigrować zależne wartości. **Etykiety**
opcji można zawsze przemianować. Usunięcie opcji jest odrzucane z
`409 option_in_use`, dopóki jakikolwiek produkt niesie tę wartość
(FR-025).

## Publiczne API

Trasy admina są chronione przez `catalog:read` (list / get) /
`catalog:write` (mutacje).

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attributes` | admin | Lista atrybutów |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | admin | Payload pickera — każdy atrybut z żądaną flagą (US1) |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | admin | Odczyt pojedynczego atrybutu |
| `POST /api/v1/admin/catalog/attributes` | admin | Utworzenie atrybutu (flagi + inline `options[]` dla typów select-style) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | admin | Aktualizacja etykiet i hot-toggle `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition`. Re-emituje `attribute.updated.v1`. |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | admin | Usunięcie; odrzucane z `409 attribute_in_use_by_set`, dopóki jakikolwiek Attribute Set nadal się do niego odwołuje |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | Lista wierszy opcji dla atrybutów select / enum / multiselect |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | Dołączenie opcji |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | admin | Patch `label` / `labelDefault` / `isDefault` / `sortOrder` (option `value` niemutowalne per FR-026) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | admin | Usunięcie; odrzucane z `409 option_in_use`, dopóki jakikolwiek produkt niesie wartość |

Odczyty sidebar filtrów konsumują `GET /api/v1/catalog/filters` (zdefiniowane na
stronie [Catalog](../catalog.md)) — ten endpoint rozwiązuje aktualnie widoczne
atrybuty filtrowalne per Sales Channel i sortuje je według `filterPosition`.

## Błędy

| Code | Status | Kiedy |
| --- | --- | --- |
| `attribute_key_invalid` | 400 | `key` nie pasuje do `^[a-z][a-z0-9_]*$` |
| `duplicate_key` | 409 | Klucz atrybutu już istnieje (case-insensitive) |
| `attribute_in_use_by_set` | 409 | Usunięcie zablokowane: co najmniej jeden Attribute Set nadal odwołuje się do atrybutu |
| `attribute_type_change_unsafe` | 409 | Zmiana `valueType` odrzucona — jakiś produkt niesie wartość, której nowy typ nie może reprezentować |
| `default_option_ambiguous` | 409 | Więcej niż jedna opcja z `isDefault = true` na atrybucie `select` / `enum` |
| `option_in_use` | 409 | Usunięcie (lub rename wartości) zablokowane: produkt nadal niesie tę wartość opcji |
| `attribute_not_found` | 404 | Brak `:idOrKey` |
| `option_not_found` | 404 | Brak `:optionId` |

## Integracja ze storefrontem

### Sidebar filtrów (US5)

Strony kategorii i wyszukiwania renderują chip na każdy atrybut `isFilterable`,
który ma co najmniej jedną wartość w aktualnie widocznych produktach.
Chipy pojawiają się posortowane według `filterPosition` rosnąco, remisy
alfabetycznie po rozwiązanej etykiecie per locale. Atrybuty bez wartości na
bieżącej stronie są pomijane (brak pustego filtra).

### Zakładka PDP „Parametry produktu” (US6)

Każdy PDP ma zakładkę `Parametry produktu`, która listuje każdy
atrybut spełniający oba warunki:

- produkt ma wartość atrybutu, **oraz**
- atrybut ma flagę `isVisibleOnProductPage = true`.

Dla wartości `select` / `multiselect` / `enum` zakładka renderuje
per-locale etykietę opcji, nie surowe `value`. Pole payloadu szczegółów
składa `CatalogQueryService.buildVisibleAttributesProjection()`.

### Indeks wyszukiwania (US7)

Przełączenie `isSearchable` propaguje się do payloadu indeksatora Meilisearch
w następnym cyklu odświeżenia. Typy tekstowe (`string`, plus etykiety opcji
`select` / `multiselect` / `enum`) zasilają indeks leksykalny i (gdy włączony)
semantyczny; typy numeryczne / boolean / price / date zasilają filtry zakresu /
exact-match.

### Strona Compare

Wiersze porównania na storefront Compare listują każdy atrybut
z flagą `isComparable = true`, dla którego co najmniej jeden produkt w
porównaniu niesie wartość. Lista pochodzi z
`CatalogQueryService.comparableAttributeKeys()` (feature 007).

### Picker wariantów

Produkty configurable eksponują picker wariantów, którego osie pochodzą z
atrybutów z flagą `isVariantAxis = true` na aktualnie przypisanym Attribute Set
produktu.

## Magazynowanie

Od feature 061 (migracja `102`) atrybut jest podzielony między generyczną
warstwę Custom Fields, którą posiada moduł `custom_fields`, a rozszerzenie
własności katalogu. Kształt API powyżej jest bez zmian — powierzchnia admina
składa oba z powrotem w legacy form.

`custom_field_definitions` (własność `custom_fields`, wiersze z
`entity_type = 'product'`):

- `id uuid PK`, `key` (unikalny per entity type), `label jsonb`,
  `label_default`, `value_type` (generyczny zestaw sześciu typów: `text` |
  `number` | `boolean` | `date` | `select` | `multiselect`),
  `required`, `sort_order`. Legacy forma ośmiu wartości `valueType` jest
  wyprowadzana bijektywnie z typu generycznego plus refinements rozszerzenia
  poniżej (`enum` = `select` + `select_display='pill'`,
  `price` = `number` + `numeric_kind='price'`, ...).

`custom_field_options` (własność `custom_fields`):

- Wiersze opcji UNIQUE `(definition_id, value)` z per-locale
  `label`, `label_default`, `is_default`, `sort_order`. Własnościowa tabela
  katalogu `attribute_options` (feature 012, migracja
  `032`) została usunięta migracją `102` po przeniesieniu wierszy tutaj.

`product_attributes` (własność `catalog`) — 1:1 **rozszerzenie**:

- `id uuid PK` (stabilne — id atrybutów admin API przeżyły migrację),
  `custom_field_definition_id uuid NOT NULL UNIQUE` FK →
  `custom_field_definitions.id` ON DELETE RESTRICT.
- Flagi boolean: `is_searchable`, `is_filterable`, `is_variant_axis`,
  `is_comparable`, `quick_searchable`, `is_promo_rule`,
  `is_visible_on_product_page`, `display_as_slider`,
  `channel_scoped`, `language_scoped`, `mass_editable`.
- `filter_position int NOT NULL DEFAULT 0`.
- Refinements prezentacji: `select_display varchar(16) NULL`
  (`pill` = legacy `enum`, `dropdown` = legacy `select`) i
  `numeric_kind varchar(8) NULL` (`number` | `price`).
- Zduplikowane kolumny definicji (`key`, `label`, `label_default`,
  `value_type`, `is_required`) zostały usunięte migracją `102` — wiersz
  definicji jest jedynym źródłem prawdy dla nich.

`products.attribute_values jsonb` niesie mapę per produkt kluczowaną przez
`key` atrybutu (bez zmian od feature 061 — wartości nigdy się nie przeniosły).
Wartości są utrzymywane po stronie serwera, nawet gdy atrybut opuści aktualnie
przypisany Attribute Set produktu (FR-012) — powrót do zestawu je z powrotem
eksponuje.

Wszystkie mutacje atrybutów i opcji przechodzą przez Commands katalogu
za `/catalog/attributes` — generyczna powierzchnia admin Custom Fields
listuje definicje produktów read-only i odrzuca mutacje z
`409 host_managed`.

## Emitowane zdarzenia

- `attribute.updated.v1` — konsumowane przez indeksator wyszukiwania i
  bridgowane do subskrybentów webhook.

## Dziennik audytu

CRUD atrybutów i opcji zapisuje jeden `AuditLogEntry` na mutację
z `stateBefore` i `stateAfter`, żeby strona audytu pokazywała, kto
przełączył którą flagę.

## Konsumenci cross-module

Trzy metody na `CatalogQueryService` to udokumentowane porty serwisowe
per Constitution I:

- `comparableAttributeKeys(): string[]` — feature 007 (Compare).
- `promoRuleAttributeKeys(): string[]` + `getAttributeWithOptions(key)`
  — feature 012 / US8 (picker i resolver kryteriów Promotion Rule).
- `buildVisibleAttributesProjection()` — wewnętrzne, używane przez odpowiedź
  szczegółów PDP do złożenia payloadu `visibleAttributes[]`.

## Zobacz też

- [Zestawy atrybutów](./attribute-sets.md) — bundlowanie atrybutów w
  schematy per rodzina przypięte do produktu.
- [Catalog](../catalog.md) — moduł nadrzędny, łącznie z endpointem storefront
  `GET /api/v1/catalog/filters`, który konsumuje
  `filterPosition`.
- Indeksator Meilisearch modułu `search`, który konsumuje flagę
  `isSearchable`.
- Edytor Promotion Rule modułu `promotions`, który konsumuje flagę
  `isPromoRule`.
