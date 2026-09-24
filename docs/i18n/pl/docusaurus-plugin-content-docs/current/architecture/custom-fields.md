---
title: Pola niestandardowe dla encji rdzeniowych
---

# Pola niestandardowe

Operatorzy mogą dodawać pola do encji rdzeniowych **w czasie wdrożenia — jako dane, nigdy migracja schematu ani deploy kodu**.
Warstwa Custom Fields to generyczny, **niezależny od encji hosta** moduł, który ponownie używa
*projektu* `product_attributes` katalogu (typowane definicje, listy opcji,
etykiety per locale) jako możliwości cross-cutting — bez osadzania jakiejkolwiek
troski specyficznej dla hosta w rdzeniu.

## Obsługiwane encje hosta

Pola niestandardowe są dostępne na **Category, Order, Organization, CustomerAccount,
QuoteRequest i Product**. Każda encja hosta niesie addytywny JSONB
worek wartości (`{ [definitionKey]: value }`); host posiada tę kolumnę i jej zapisy.
Dla większości hostów worek to kolumna `customFieldValues`; host produktu wiąże się
z istniejącą kolumną `products.attribute_values` (patrz wiązanie value-probe
poniżej). Atrybuty produktu zbiegły się na tej warstwie jako **adapter**, nie
przepisanie: generyczna warstwa posiada tożsamość każdego atrybutu
(klucz, etykiety per locale, typ wartości, required, opcje), podczas gdy katalog trzyma
flagi zachowania na własnej tabeli rozszerzenia 1:1 (`product_attributes`) i
pozostaje jedyną powierzchnią zapisu (patrz „Typy encji zarządzane przez hosta” poniżej).

## Jak to działa

- **Definicje to dane.** Pole to wiersz w `custom_field_definitions`
  (`@GlobalEntity`): `entityType`, `key`, zlokalizowana `label` (z fallbackiem domyślnym),
  `valueType`, flaga `required` i — dla typów select — lista wierszy
  `custom_field_options`. Dodanie, edycja lub usunięcie pola to zmiana
  danych przez powierzchnię admin; **bez migracji, bez deployu**.
- **Sześć typów wartości**: `text`, `number`, `boolean`, `date`, `select`
  (jedna opcja), `multiselect` (wiele opcji).
- **Walidowane przy każdym zapisie.** Gdy rekord hosta jest tworzony lub edytowany,
  generyczna warstwa waliduje przychodzący worek względem definicji i **odrzuca
  per pole** przy każdym naruszeniu (zły typ, brak required, nieznana opcja,
  poza zakresem) z błędem specyficznym dla pola. Host potem persystuje wartości
  we własnej kolumnie `customFieldValues`.
- **Odczyt obok pól natywnych.** Wartości wracają wszędzie tam, gdzie rekord jest
  czytany (szczegóły admin + odpowiednie odpowiedzi API).

## Podział odpowiedzialności

Generyczna warstwa posiada **definicje + walidację**; host posiada **persystencję
+ audyt**:

- Moduł custom-fields nigdy nie zapisuje do tabeli hosta i nie audytuje zapisu hosta. Host persystuje własny rekord i audytuje własny
  zapis, wołając generyczną warstwę tylko do walidacji wartości i odczytu definicji —
  więc granice modułów pozostają nienaruszone i nie ma podwójnego audytowania.
- Mutacje definicji / opcji same są wrażliwymi zapisami i działają przez
  **Command Bus**; moduł rejestruje swoje uprawnienia
  (`custom_fields:read`, `custom_fields:write`) i uczestniczy w cyklu życia
  modułu.

## Typy encji zarządzane przez hosta (`managedBy`)

Rejestr encji (`custom-field-registry.ts`) wspiera generyczną
możliwość `managedBy` na wpisie hosta: `{ moduleId, labelKey, route }`. Gdy
ustawiona, definicje tego hosta są autorowane przez nazwany moduł przez własną
powierzchnię, a generyczna powierzchnia admin staje się **tylko do odczytu** dla tego typu
encji: `POST` / `PATCH` / `DELETE` na `/api/v1/admin/custom-fields/definitions*`
są odrzucane z `409 host_managed`, a strona Custom Fields w admin renderuje
encję tylko do odczytu z informacją linkującą do zarządzającej powierzchni. Odmowa
jest sterowana rejestrem — generyczny rdzeń sprawdza tylko obecność markera,
nigdy który moduł zarządza (brak identyfikatora hosta w logice rdzenia).

Host produktu jest pierwszym użytkownikiem: `managedBy` wskazuje stronę modułu katalogu
`/catalog/attributes`, która pozostaje jedyną powierzchnią zapisu atrybutów
produktu.

## Wiązanie value-probe (`{table, column}`)

Strażniki zmian generycznej warstwy (`hasStoredValues`, `isOptionInUse` — za
odmowami `value_type_locked` i `option_in_use`) sondują worek wartości hosta przez
introspkcję JSONB tylko do odczytu. Cel sondy to per-encja **wiązanie storage**
`{ table, column }`: większość hostów wiąże się z kolumną `custom_field_values`,
podczas gdy host produktu wiąże się z `products.attribute_values`. Wiązanie
to czyste metadane storage — żadna logika hosta nie żyje w module generycznym.

## Szew apply transakcyjny (commandy hosta)

Moduły hosta zarządzające definicjami swojej encji (per `managedBy`) mutują
je przez eksportowane `CustomFieldDefinitionApplyApi`
(`applyCreate` / `applyUpdate` / `applyDelete` + warianty opcji). Każda
funkcja apply działa na **EntityManager dostarczonym przez wywołującego**, egzekwuje generyczne
niezmienniki (duplikat klucza, reguły opcji, blokada typu wartości, option-in-use) i
wykonuje **brak audytu i brak publikacji cache** — command hosta posiada transakcję,
zapisuje jeden wiersz audytu i publikuje unieważnienie cache definicji
po commit. To utrzymuje `custom_fields` jedynym pisarzem swoich
tabel, pozwalając commandowi hosta utrzymać definicję + własne
wiersze spójnie atomowo (Command Bus nie nestuje się).

## Nota zbieżności: atrybuty produktu

Zbieżność następuje jako **adapter**, nie przepisanie: atrybuty produktu stały się
definicjami Custom Field na hoście `product`, a katalog trzyma wiersz rozszerzenia 1:1
(`product_attributes`) dla flag zachowania i dopracowań prezentacji. Generyczny rdzeń zyskał tylko trzy niezależne od encji szwy
opisane powyżej (wpis rejestru `product` z `managedBy`, wiązanie sondy
`{table, column}` i szew apply) — zero logiki katalogu. Widok po stronie katalogu i wynik migracji są na
[stronie modułu katalogu](../modules/catalog.md#atrybuty-jako-rozszerzenia-custom-field).

## Zakres tenantów (dziedziczony)

**Wartości** custom-field żyją w kolumnach hosta, więc dziedziczą zakres tenantów rekordu hosta
za darmo: wartości na Order / Organization / Customer / QuoteRequest
należącym do org są zamknięte w tym samym tenantcie co rekord hosta —
generyczna warstwa nie dodaje nowej ścieżki scope. **Definicje** należą do
platformy (albo, jeśli scoped, do organizacji) spójnie z tym, jak scoped jest encja
hosta.

## Flagi możliwości hosta (punkt rozszerzenia)

Pole może nieść **nieprzezroczysty** obiekt `config` — flagi możliwości hosta takie jak
„filterable” albo „search-indexed”. Generyczny rdzeń **przechowuje, ale nigdy nie czyta go dla znaczenia**:
moduł *hosta* interpretuje flagę przez własny udokumentowany
punkt rozszerzenia (np. filtrowanie Category podnosi flagę `filterable`; możliwości Product
zostają na `product_attributes`). To trzyma troski tylko-katalogowe poza
generycznym rdzeniem — dokładnie ta rot, przed którą chroni ten podział, gdzie
`product_attributes` narastało `isVariantAxis` / `isPromoRule` / `filterPosition`,
aż przestało być wielokrotnego użytku.

## Retencja danych

Usunięcie definicji pola **nie** czyści zapisanych wartości: przestarzałe wartości są
zachowane uśpione (nie pokazywane, nie czytane), zamiast agresywnego usuwania, więc
pomyłkowe usunięcie jest odwracalne, a zapisy hosta nigdy nie kaskadują w utratę danych.

## Dodawanie pola niestandardowego

Zdefiniuj je z powierzchni custom-field w admin dla docelowego typu encji
(klucz + zlokalizowana etykieta + typ wartości + required + opcje). Potem renderuje się na
każdym rekordzie tego typu, a wartość round-tripuje przez ścieżki create/edit/read hosta —
bez zmiany kodu.
