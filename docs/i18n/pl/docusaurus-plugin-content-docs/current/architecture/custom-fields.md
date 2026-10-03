---
title: Pola niestandardowe dla encji rdzenia
---

# Pola niestandardowe

Operatorzy mogą dodawać pola do encji rdzenia **po wdrożeniu — jako dane, nigdy jako migrację
schematu czy wdrożenie kodu**. Warstwa pól niestandardowych to ogólny moduł, **niezależny od
encji**, który przejmuje *projekt* `product_attributes` z katalogu (typowane definicje, listy opcji,
etykiety dla poszczególnych języków) jako możliwość przekrojową — bez umieszczania w swoim rdzeniu
czegokolwiek specyficznego dla encji, do której pola należą.

## Obsługiwane encje

Pola niestandardowe są dostępne dla encji **Category, Order, Organization, CustomerAccount,
QuoteRequest i Product**. Każda z tych encji ma dodatkowy zbiór wartości w JSONB
(`{ [definitionKey]: value }`); właścicielem tej kolumny i zapisów do niej jest moduł encji. W
większości encji jest to kolumna `customFieldValues`; produkt korzysta zamiast tego z istniejącej
już kolumny `products.attribute_values` (zobacz *Powiązanie sprawdzania wartości* niżej). Atrybuty
produktu zostały połączone z tą warstwą przez **adapter**, a nie przepisane: ogólna warstwa jest
właścicielem tożsamości każdego atrybutu (klucz, etykiety dla poszczególnych języków, typ wartości,
wymagalność, opcje), a katalog przechowuje flagi zachowania we własnej tabeli rozszerzenia 1:1
(`product_attributes`) i pozostaje jedynym miejscem zapisu (zobacz *Encje zarządzane przez własny
moduł* niżej).

## Jak to działa

- **Definicje to dane.** Pole to wiersz w `custom_field_definitions` (`@GlobalEntity`):
  `entityType`, `key`, przetłumaczona `label` (z wartością domyślną), `valueType`, flaga `required`
  i — dla typów wyboru — lista wierszy `custom_field_options`. Dodanie, edycja lub usunięcie pola to
  zmiana danych w panelu administracyjnym; **bez migracji i bez wdrożenia**.
- **Sześć typów wartości**: `text`, `number`, `boolean`, `date`, `select` (jedna opcja),
  `multiselect` (wiele opcji).
- **Walidacja przy każdym zapisie.** Gdy rekord encji jest tworzony lub edytowany, ogólna warstwa
  sprawdza przesłane wartości względem definicji i **odrzuca każde pole osobno** przy każdym
  naruszeniu (zły typ, brak wymaganej wartości, nieznana opcja, wartość spoza zakresu), z błędem
  wskazującym pole. Następnie moduł encji zapisuje wartości we własnej kolumnie
  `customFieldValues`.
- **Odczyt razem z polami wbudowanymi.** Wartości są zwracane wszędzie tam, gdzie odczytywany jest
  rekord (szczegóły w panelu administracyjnym i odpowiednie odpowiedzi API).

## Podział odpowiedzialności

Ogólna warstwa odpowiada za **definicje i walidację**; moduł encji — za **zapis i audyt**:

- Moduł pól niestandardowych nigdy nie zapisuje do tabeli innej encji i nie audytuje jej zapisów.
  Moduł encji zapisuje własny rekord i audytuje własny zapis, a ogólną warstwę wywołuje tylko po to,
  by zwalidować wartości i odczytać definicje — dzięki temu granice modułów pozostają nienaruszone i
  nie ma podwójnego audytu.
- Zmiany definicji i opcji same są wrażliwymi zapisami i przechodzą przez **Command Bus**; moduł
  rejestruje swoje uprawnienia (`custom_fields:read`, `custom_fields:write`) i uczestniczy w cyklu
  życia modułów.

## Encje zarządzane przez własny moduł (`managedBy`)

Rejestr encji (`custom-field-registry.ts`) obsługuje ogólną właściwość `managedBy` we wpisie encji:
`{ moduleId, labelKey, route }`. Gdy jest ustawiona, definicje dla tej encji tworzy wskazany moduł
we własnym interfejsie, a ogólny ekran administracyjny staje się dla tego typu encji **tylko do
odczytu**: `POST` / `PATCH` / `DELETE` na `/api/v1/admin/custom-fields/definitions*` są odrzucane z
`409 host_managed`, a strona pól niestandardowych w panelu pokazuje encję tylko do odczytu, z
informacją i odnośnikiem do ekranu, który nią zarządza. O odmowie decyduje rejestr — ogólny rdzeń
sprawdza tylko obecność znacznika, nigdy to, który moduł zarządza encją (w logice rdzenia nie ma
identyfikatora żadnej encji).

Pierwszym użytkownikiem jest produkt: `managedBy` wskazuje stronę `/catalog/attributes` modułu
katalogu, która pozostaje jedynym miejscem zapisu atrybutów produktu.

## Powiązanie sprawdzania wartości (`{table, column}`)

Zabezpieczenia zmian w ogólnej warstwie (`hasStoredValues`, `isOptionInUse` — stojące za odmowami
`value_type_locked` i `option_in_use`) sprawdzają zbiór wartości encji przez odczyt JSONB tylko do
odczytu. Miejsce sprawdzania to dla każdej encji **powiązanie z kolumną** `{ table, column }`:
większość encji korzysta z kolumny `custom_field_values`, a produkt z
`products.attribute_values`. To powiązanie to wyłącznie metadane o przechowywaniu — w ogólnym
module nie ma żadnej logiki konkretnej encji.

## Transakcyjne API zapisu definicji (polecenia modułu encji)

Moduły zarządzające definicjami własnej encji (przez `managedBy`) zmieniają je przez eksportowane
`CustomFieldDefinitionApplyApi` (`applyCreate` / `applyUpdate` / `applyDelete` oraz warianty dla
opcji). Każda z tych funkcji działa na **EntityManagerze dostarczonym przez wywołującego**, pilnuje
ogólnych niezmienników (powtórzony klucz, reguły opcji, blokada typu wartości, opcja w użyciu) i
**niczego nie audytuje ani nie publikuje unieważnienia pamięci podręcznej** — polecenie modułu
encji zarządza transakcją, zapisuje jeden wiersz audytu i po zatwierdzeniu publikuje unieważnienie
pamięci podręcznej definicji. Dzięki temu `custom_fields` pozostaje jedynym modułem zapisującym do
swoich tabel, a polecenie modułu encji może atomowo utrzymać spójność definicji i własnych wierszy
(Command Bus nie obsługuje zagnieżdżania).

## Uwaga o połączeniu: atrybuty produktu

Połączenie odbyło się przez **adapter**, a nie przez przepisanie: atrybuty produktu stały się
definicjami pól niestandardowych dla encji `product`, a katalog przechowuje wiersz rozszerzenia 1:1
(`product_attributes`) z flagami zachowania i ustawieniami prezentacji. Ogólny rdzeń zyskał tylko
trzy opisane wyżej punkty rozszerzenia niezależne od encji (wpis `product` w rejestrze z
`managedBy`, powiązanie sprawdzania `{table, column}` i API zapisu definicji) — bez żadnej logiki
katalogu. Spojrzenie od strony katalogu i wynik migracji opisuje
[strona modułu katalogu](../modules/catalog.md#atrybuty-jako-rozszerzenia-custom-field).

## Izolacja tenantów (dziedziczona)

**Wartości** pól niestandardowych są przechowywane w kolumnach encji, więc bez dodatkowej pracy
dziedziczą izolację tenantów rekordu: wartości w zamówieniu, organizacji, kliencie czy zapytaniu
ofertowym należącym do organizacji są ograniczone do tego samego tenanta co rekord — ogólna warstwa
nie dodaje nowej ścieżki zawężania. **Definicje** należą do platformy (albo, jeśli są zawężone, do
organizacji), zgodnie z tym, jak zawężona jest sama encja.

## Flagi możliwości encji (punkt rozszerzenia)

Pole może mieć **nieprzezroczysty** obiekt `config` — flagi możliwości encji, takie jak
„filterable” czy „search-indexed”. Ogólny rdzeń **przechowuje go, ale nigdy nie interpretuje**:
flagę interpretuje moduł *encji* przez własny, udokumentowany punkt rozszerzenia (np. filtrowanie
kategorii korzysta z flagi `filterable`; możliwości produktu pozostają w `product_attributes`). Dzięki
temu sprawy dotyczące wyłącznie katalogu nie trafiają do ogólnego rdzenia — to dokładnie ten rozrost,
przed którym chroni ten podział: `product_attributes` obrastało w `isVariantAxis` / `isPromoRule` /
`filterPosition`, aż przestało nadawać się do ponownego użycia.

## Przechowywanie danych

Usunięcie definicji pola **nie** usuwa zapisanych wartości: nieaktualne wartości są zachowywane w
uśpieniu (nie są pokazywane ani odczytywane), zamiast być od razu kasowane, więc pomyłkowe usunięcie
da się cofnąć, a zapisy encji nigdy nie prowadzą kaskadowo do utraty danych.

## Dodawanie pola niestandardowego

Zdefiniuj pole na ekranie pól niestandardowych w panelu administracyjnym, dla wybranego typu encji
(klucz, przetłumaczona etykieta, typ wartości, wymagalność, opcje). Od tej chwili pole pojawia się
w każdym rekordzie tego typu, a jego wartość jest zapisywana i odczytywana przez zwykłe ścieżki
tworzenia, edycji i odczytu encji — bez zmiany kodu.
