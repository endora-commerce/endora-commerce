---
title: Atrybuty
---

# Atrybuty

**Atrybut** to pojedyncza nazwana właściwość, którą można przypisać do produktu — `color`,
`gear_ratio`, `material`, `weight`. Atrybuty są podstawowym elementem, z którego korzysta wszystko,
co opisuje produkt: panel filtrów w storefroncie, zakładka „Parametry produktu” na stronie produktu,
strona porównania, edytor reguł promocji, indeks wyszukiwarki i wybór wariantu produktu
konfigurowalnego.

Atrybuty są grupowane w [zestawy atrybutów](./attribute-sets.md), które przypisuje się do produktu,
aby edytor w panelu pokazywał tylko pola potrzebne danej rodzinie produktów. Ta strona opisuje sam
atrybut; przypisanie zestawu do produktu opisuje strona o zestawach atrybutów.

## Budowa

Każdy atrybut ma:

| Pole | Przeznaczenie |
| --- | --- |
| `key` | Stały identyfikator, bezpieczny w adresach URL — `^[a-z][a-z0-9_]*$`, unikalny w całej platformie (bez rozróżniania wielkości liter). Używany w adresach filtrów, danych wyszukiwarki i jako klucz w JSONB produktu. |
| `label` | Etykiety w poszczególnych językach, `Record<bcp47-tag, string>`. |
| `labelDefault` | Etykieta zastępcza, gdy dla aktywnego języka storefrontu lub panelu nie ma wpisu w `label`. |
| `valueType` | Jedno z `string`, `number`, `boolean`, `price`, `date`, `select`, `multiselect`, `enum`, `page_builder`. |
| `options[]` | Posortowana lista opcji do wyboru — tylko dla `select` / `multiselect` / `enum`. Zobacz [Listy opcji](#listy-opcji) niżej. |

Do tego flagi zachowania i pozycja liczbowa:

| Flaga | Wartość domyślna | Kto z niej korzysta |
| --- | --- | --- |
| `isFilterable` | `false` | Panel filtrów w storefroncie |
| `isSearchable` | `false` | Indeksowanie wyszukiwarki (Meilisearch) |
| `isComparable` | `false` | Strona porównania w storefroncie |
| `isVariantAxis` | `false` | Wybór wariantu produktu konfigurowalnego |
| `isRequired` | `false` | Walidacja zapisu produktu (tylko gdy atrybut należy do przypisanego zestawu atrybutów) |
| `isPromoRule` | `false` | Wybór kryteriów w regułach promocji |
| `isPriceRule` | `false` | Cenniki (moduł `price_lists`) — w panelu **Reguły cennika**: czy cennik może wyceniać produkty według wartości tego atrybutu, w linii *wartości atrybutu* albo *kategorii i wartości atrybutu*. Kwalifikuje się tylko atrybut pojedynczego wyboru, wielokrotnego wyboru albo tak/nie, niezależny od języka i od kanału sprzedaży. Wariant jest dopasowywany po własnych wartościach osi, nałożonych na wartości produktu. Wyłączenie flagi dezaktywuje linie, które korzystają z atrybutu — przestają wpływać na ceny, siatka cen pokazuje je jako *Nieaktywne*, a po ponownym włączeniu flagi znów obowiązują; nigdy nie powoduje to błędu wyceny. |
| `isVisibleOnProductPage` | `false` | Zakładka „Parametry produktu” na stronie produktu |
| `displayAsSlider` | `false` | Panel filtrów — wyświetla suwak zakresu; tylko dla `valueType ∈ ('number','price')` |
| `filterPosition` | `0` | Klucz sortowania w panelu filtrów (rosnąco; remisy alfabetycznie według etykiety w danym języku) |

## Typy wartości

| Typ | Sposób zapisu | Uwagi |
| --- | --- | --- |
| `string` | string | Dowolny tekst. |
| `number` | number | Liczba; obsługuje `displayAsSlider` dla filtrów zakresu. |
| `boolean` | boolean | Dwa stany. |
| `price` | number | Kwota — formatowana według aktywnej waluty i języka. Obsługuje `displayAsSlider`. |
| `date` | data w formacie ISO 8601 | |
| `select` | `value` opcji | Jeden wybór z `options[]`. Najwyżej jedna opcja może mieć `isDefault = true`. |
| `multiselect` | tablica wartości `value` opcji | Wiele wyborów z `options[]`. Dowolna liczba opcji może mieć `isDefault = true`. |
| `enum` | `value` opcji | Zapis taki sam jak `select`; w filtrach storefrontu i na stronie produktu wyświetla się jako zwarte przyciski zamiast listy rozwijanej. |
| `page_builder` | jeden dokument Page Buildera na język, przechowywany poza `attribute_values` | **Treść Page Builder** — zobacz [Treść produktu](./product-content.md). |

Zmiana `valueType` jest odrzucana z `attribute_type_change_unsafe`, gdy którykolwiek produkt ma
wartość, której nowy typ nie potrafi przedstawić.

### Treść Page Builder

Atrybut `page_builder` przechowuje dla każdego produktu jeden dokument Page Buildera na język. Treść
edytuje się na osobnym ekranie, a sklep pokazuje ją w zakładce opisu na stronie produktu
([Treść produktu](./product-content.md)). Ustawienia tego typu są stałe:

- jego języki to języki jego dokumentów, dlatego nigdy nie jest `scopable`: nie ma wartości dla
  kanału sprzedaży ani dla języka kanału;
- `isSearchable`, `isFilterable`, `isVariantAxis`, `displayAsSlider`, `isComparable`,
  `quickSearchable`, `isPromoRule`, `isPriceRule`, `massEditable`, `isRequired`,
  `isVisibleOnProductPage` i `scopable` pozostają `false`. Ustawienie którejkolwiek z nich przy
  tworzeniu lub zmianie jest odrzucane z `400 VALIDATION_FAILED`, z osobną pozycją dla każdego
  ustawienia, i nic nie zostaje zapisane;
- atrybut nie ma opcji;
- typu nie można zmienić ani zmienić na niego typu innego atrybutu (`409`).

Edytor atrybutu ukrywa te ustawienia dla tego typu, a lista pokazuje flagi wiersza jako
zablokowane. Typ jest dostępny wyłącznie dla produktów.

## Listy opcji

Dla atrybutów `select` / `multiselect` / `enum` listę opcji tworzy się bezpośrednio w edytorze
atrybutu. Każda opcja ma:

| Pole | Przeznaczenie |
| --- | --- |
| `value` | Stały identyfikator — `^[a-z0-9_-]{1,200}$`, unikalny w obrębie atrybutu. Używany w adresach filtrów i zapisywany w każdym produkcie z tą wartością. |
| `label` | Etykiety w poszczególnych językach, `Record<bcp47-tag, string>`. |
| `labelDefault` | Etykieta zastępcza, gdy dla aktywnego języka nie ma wpisu w `label`. |
| `isDefault` | Opcjonalne wstępne zaznaczenie w nowych produktach. `select` / `enum` pozwalają na najwyżej jedną; `multiselect` — na dowolną liczbę. |
| `sortOrder` | Kolejność wyświetlania; remisy rozstrzyga `value` rosnąco. |

**Wartości** opcji nie można zmienić, dopóki ma je jakikolwiek produkt — operator musi najpierw
przenieść zależne wartości. **Etykiety** opcji można zmieniać w każdej chwili. Usunięcie opcji jest
odrzucane z `409 option_in_use`, dopóki jakikolwiek produkt ma tę wartość.

## API publiczne

Trasy administracyjne są chronione przez `catalog:read` (lista i odczyt) i `catalog:write` (zmiany).

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attributes` | administrator | Lista atrybutów |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | administrator | Dane do listy wyboru — wszystkie atrybuty z żądaną flagą |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | administrator | Odczyt jednego atrybutu |
| `POST /api/v1/admin/catalog/attributes` | administrator | Utworzenie atrybutu (flagi i `options[]` bezpośrednio w treści dla typów wyboru) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | administrator | Zmiana etykiet i natychmiastowa zmiana `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isPriceRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition`. Ponownie emituje `attribute.updated.v1`. |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/usage` | administrator (`catalog:read`) | Co napotka usunięcie atrybutu: `{ attributeSetCount, productValueCount, productContentCount }` — zobacz [Usuwanie atrybutu](#usuwanie-atrybutu) |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | administrator (`catalog:write`) | Usunięcie atrybutu dowolnego typu; odrzucane z `409`, dopóki zawiera go zestaw atrybutów albo produkt ma jego wartość — zobacz [Usuwanie atrybutu](#usuwanie-atrybutu) |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | administrator | Lista opcji atrybutów select / enum / multiselect |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | administrator | Dodanie opcji |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | administrator | Zmiana `label` / `labelDefault` / `isDefault` / `sortOrder` (wartości `value` opcji nie można zmienić) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | administrator | Usunięcie; odrzucane z `409 option_in_use`, dopóki którykolwiek produkt ma tę wartość |

Panel filtrów korzysta z `GET /api/v1/catalog/filters` (opisanego na stronie
[katalogu](../catalog.md)) — ten endpoint wyznacza widoczne obecnie atrybuty filtrowalne w danym
kanale sprzedaży i sortuje je według `filterPosition`.

## Usuwanie atrybutu

Akcja **Usuń** jest dostępna w każdym wierszu listy atrybutów, niezależnie od typu. Okno
potwierdzenia najpierw odczytuje `GET …/attributes/:idOrKey/usage` i pokazuje, co blokuje usunięcie
i co zostanie usunięte razem z atrybutem:

| Licznik | Znaczenie | Skutek |
| --- | --- | --- |
| `attributeSetCount` | Zestawy atrybutów, które zawierają atrybut | Blokuje: najpierw usuń go z tych zestawów |
| `productValueCount` | Produkty z wartością tego klucza — na produkcie, jako nadpisanie w kanale sprzedaży albo na wariancie | Blokuje: najpierw wyczyść te wartości |
| `productContentCount` | Produkty z treścią atrybutu `page_builder` | Treść zostaje usunięta razem z atrybutem |

Usunięty produkt nie jest liczony i nie blokuje usunięcia. Okno i samo usunięcie korzystają z tego
samego zapytania, więc odmowa może wynikać tylko ze zmiany wprowadzonej po otwarciu okna; okno
pokazuje wtedy komunikat API.

Usunięcie kasuje definicję atrybutu, jego opcje, jego treść i ustawienia katalogu w jednej
transakcji, z jednym wpisem audytu (`catalog.attribute.delete`, którego stan „przed” podaje liczbę
usuniętych treści). Następnie emituje `attribute.updated.v1` z kluczem oraz `isSearchable` i
`isFilterable` ustawionymi na `false`, dzięki czemu indeks wyszukiwarki i cenniki przestają używać
tego klucza.

Warunki promocji, wiersze cenników i reguły feedów, które używają atrybutu, nie blokują usunięcia
ani nie są usuwane — katalog ich nie widzi. Przestają pasować do produktów: warunek promocji na tym
kluczu nie pasuje już do żadnej pozycji koszyka, wiersz cennika jest pokazywany jako nieaktywny, a
feed, którego reguła wyboru wskazuje ten klucz, przy następnym uruchomieniu zapisuje błąd
konfiguracji. Okno potwierdzenia mówi o tym jednym zdaniem. Popraw je albo usuń na ich własnych
ekranach.

**Zmiana zachowania (funkcja 172).** Nadpisanie w kanale sprzedaży albo wartość wariantu blokuje
teraz usunięcie, tak jak zawsze blokowała je wartość na produkcie; wartość na usuniętym produkcie
już go nie blokuje; usunięcie emituje teraz `attribute.updated.v1`.

## Błędy

| Kod | Status | Kiedy |
| --- | --- | --- |
| `attribute_key_invalid` | 400 | `key` nie pasuje do `^[a-z][a-z0-9_]*$` |
| `duplicate_key` | 409 | Klucz atrybutu już istnieje (bez rozróżniania wielkości liter) |
| `attribute_in_use_by_set` | 409 | Usunięcie zablokowane: odwołuje się do niego co najmniej jeden zestaw atrybutów |
| `attribute_type_change_unsafe` | 409 | Odrzucona zmiana `valueType` — któryś produkt ma wartość, której nowy typ nie potrafi przedstawić |
| `default_option_ambiguous` | 409 | Więcej niż jedna opcja z `isDefault = true` w atrybucie `select` / `enum` |
| `option_in_use` | 409 | Usunięcie (albo zmiana wartości) zablokowane: produkt nadal ma tę wartość opcji |
| `attribute_not_found` | 404 | Brak `:idOrKey` |
| `option_not_found` | 404 | Brak `:optionId` |

## Storefront

### Panel filtrów

Strony kategorii i wyszukiwania pokazują filtr dla każdego atrybutu `isFilterable`, który ma co
najmniej jedną wartość wśród aktualnie widocznych produktów. Filtry są posortowane rosnąco według
`filterPosition`, a remisy — alfabetycznie według etykiety w danym języku. Atrybuty bez wartości na
bieżącej stronie są pomijane (nie ma pustych filtrów).

### Zakładka „Parametry produktu”

Zakładka `Parametry produktu` na stronie produktu wymienia każdy atrybut spełniający oba warunki:

- produkt ma wartość tego atrybutu, **oraz**
- atrybut ma flagę `isVisibleOnProductPage = true`.

Dla wartości `select` / `multiselect` / `enum` zakładka pokazuje etykietę opcji w danym języku, a nie
surowe `value`. To pole w szczegółach produktu buduje
`CatalogQueryService.buildVisibleAttributesProjection()`.

Każdy wiersz pokazuje etykietę atrybutu i sformatowaną wartość — nigdy klucz techniczny ani surową
zapisaną wartość. Atrybut bez flagi widoczności nigdy się nie pojawia, a sama zakładka jest
pokazywana tylko wtedy, gdy co najmniej jeden atrybut spełnia warunki. Treść Page Builder nigdy
się w niej nie pojawia.

### Indeks wyszukiwarki

Zmiana `isSearchable` trafia do danych indeksowanych w Meilisearch w następnym cyklu odświeżania.
Typy tekstowe (`string` oraz etykiety opcji `select` / `multiselect` / `enum`) zasilają indeks
leksykalny i (jeśli jest włączony) semantyczny; typy liczbowe, logiczne, cenowe i daty zasilają
filtry zakresu i dokładnego dopasowania.

### Strona porównania

Wiersze na stronie porównania w storefroncie to wszystkie atrybuty z flagą `isComparable = true`, dla
których co najmniej jeden porównywany produkt ma wartość. Listę dostarcza
`CatalogQueryService.comparableAttributeKeys()`.

### Wybór wariantu

Produkty konfigurowalne mają wybór wariantu, którego osie pochodzą z atrybutów z flagą
`isVariantAxis = true` w zestawie atrybutów obecnie przypisanym do produktu.

## Przechowywanie

Od migracji `20260723T230401_catalog_attributes_on_custom_fields.ts` atrybut jest podzielony między ogólną warstwę pól niestandardowych, należącą do
modułu `custom_fields`, a rozszerzenie należące do katalogu. Opisana wyżej postać API się nie
zmieniła — panel składa obie części z powrotem w dawną postać.

`custom_field_definitions` (należy do `custom_fields`, wiersze z `entity_type = 'product'`):

- `id uuid PK`, `key` (unikalny w obrębie typu encji), `label jsonb`, `label_default`, `value_type`
  (ogólny zestaw sześciu typów: `text` | `number` | `boolean` | `date` | `select` | `multiselect`),
  `required`, `sort_order`. Dawny zestaw ośmiu wartości `valueType` jest wyprowadzany jednoznacznie
  z typu ogólnego i opisanych niżej ustawień rozszerzenia (`enum` = `select` +
  `select_display='pill'`, `price` = `number` + `numeric_kind='price'`, …).

`custom_field_options` (należy do `custom_fields`):

- Wiersze opcji z UNIQUE `(definition_id, value)`, z `label` w poszczególnych językach,
  `label_default`, `is_default`, `sort_order`. Tabela katalogu `attribute_options` (migracja
  `20260505T060113_catalog_attribute_options_and_flags.ts`) została usunięta w migracji
  `20260723T230401_catalog_attributes_on_custom_fields.ts` po przeniesieniu wierszy tutaj.

`product_attributes` (należy do `catalog`) — **rozszerzenie** 1:1:

- `id uuid PK` (stały — identyfikatory atrybutów w API panelu przetrwały migrację),
  `custom_field_definition_id uuid NOT NULL UNIQUE` z kluczem obcym do
  `custom_field_definitions.id` ON DELETE RESTRICT.
- Flagi logiczne: `is_searchable`, `is_filterable`, `is_variant_axis`, `is_comparable`,
  `quick_searchable`, `is_promo_rule`, `is_price_rule`, `is_visible_on_product_page`,
  `display_as_slider`,
  `scopable`, `mass_editable`.
- `filter_position int NOT NULL DEFAULT 0`.
- Ustawienia prezentacji: `select_display varchar(16) NULL` (`pill` = dawne `enum`, `dropdown` =
  dawne `select`) i `numeric_kind varchar(8) NULL` (`number` | `price`).
- Powielone kolumny definicji (`key`, `label`, `label_default`, `value_type`, `is_required`) usunięto
  w migracji `20260723T230401_catalog_attributes_on_custom_fields.ts` — jedynym źródłem tych danych jest wiersz definicji.

`products.attribute_values jsonb` zawiera mapę wartości produktu z kluczem `key` atrybutu; same
wartości nigdy stamtąd nie zostały przeniesione. Wartości są zachowywane po stronie serwera nawet
wtedy, gdy atrybut przestaje należeć do zestawu przypisanego do produktu — powrót do tego zestawu
znów je pokazuje.

Wszystkie zmiany atrybutów i opcji przechodzą przez polecenia katalogu pod `/catalog/attributes` —
ogólny ekran pól niestandardowych w panelu pokazuje definicje produktu tylko do odczytu i odrzuca
zmiany z `409 host_managed`.

## Emitowane zdarzenia

- `attribute.updated.v1` — przy utworzeniu, zmianie i usunięciu; odbiera je indeksowanie
  wyszukiwarki i jest przekazywane subskrybentom webhooków.

## Dziennik audytu

Każda zmiana atrybutu lub opcji zapisuje jeden `AuditLogEntry` ze `stateBefore` i `stateAfter`, aby
strona audytu pokazywała, kto zmienił którą flagę.

## Odbiorcy w innych modułach

Trzy metody `CatalogQueryService` to udokumentowane porty usług, przez które korzystają z katalogu
inne moduły — żaden moduł nie sięga do wnętrza katalogu:

- `comparableAttributeKeys(): string[]` — strona porównania w storefroncie.
- `promoRuleAttributeKeys(): string[]` i `getAttributeWithOptions(key)` — wybór i obsługa kryteriów
  w regułach promocji.
- `buildVisibleAttributesProjection()` — wewnętrzna, używana przez odpowiedź ze szczegółami produktu
  do zbudowania `visibleAttributes[]`.

`isPriceRule` nie ma własnej metody. Moduł `price_lists` odczytuje tę flagę przez
`catalogAttributeReadPort` — `listByFlag('isPriceRule')` zwraca atrybuty, które może wskazać linia
cennika, a pole `isPriceRule` w widoku każdego atrybutu pozwala odrzucić atrybut bez tej flagi — raz
na każdą partię wyceny, więc zmiana flagi działa przy następnej wycenie; zdarzenie
`attribute.updated.v1` dodatkowo czyści pamięć podręczną cen i oznacza na powierzchni cen produkty
wybierane przez wiersze cenników z tym atrybutem. Lista wyboru w edytorze cenników korzysta z
`GET /api/v1/admin/price-books/targets/attributes`, który zwraca tylko kwalifikujące się atrybuty z
ich wartościami.

## Zobacz też

- [Zestawy atrybutów](./attribute-sets.md) — łączenie atrybutów w schematy dla rodzin produktów
  przypisywane do produktu.
- [Katalog](../catalog.md) — moduł nadrzędny, łącznie z endpointem storefrontu
  `GET /api/v1/catalog/filters`, który korzysta z `filterPosition`.
- Indeksowanie Meilisearch w module `search`, które korzysta z flagi `isSearchable`.
- Edytor reguł promocji w module `promotions`, który korzysta z flagi `isPromoRule`.
