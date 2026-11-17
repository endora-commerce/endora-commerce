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
QuoteRequest, Opportunity i Product**. Dwie z nich **podążają za modułem właścicielskim**:
QuoteRequest za `quote_requests`, a Opportunity za `crm`. Gdy właściciela nie ma, typ znika z
panelu administracyjnego i z API definicji całkowicie — nie jest wyświetlany, tworzony ani
edytowany — a jego definicje, opcje i zapisane wartości są zachowane i wracają bez zmian razem z
modułem. Każda z tych encji ma dodatkowy zbiór wartości w JSONB
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
  rekord — administratorowi zawsze, a każdemu innemu tylko wtedy, gdy pozwala na to **widoczność**
  pola (następna sekcja).

## Widoczność: kto odczytuje wartości pola

Każda definicja określa, komu zwracane są zapisane wartości pola:

| Widoczność | Kto odczytuje wartości |
|---|---|
| `internal` | Wyłącznie administratorzy. Wartości nigdy nie opuszczają API administracyjnego. |
| `customer` | Administratorzy **oraz** odpowiedzi encji przeznaczone dla osób spoza administracji: odpowiedzi sklepu dla klienta i odpowiedzi zewnętrznego API (klucz API). |

- **Nowe pole jest `internal`**, dopóki autor nie wybierze inaczej — w formularzu definicji („Kto
  widzi wartość”) albo polem `audience` w `POST /api/v1/admin/custom-fields/definitions`. Notatka,
  ocena kredytowa czy flaga ryzyka zamodelowana jako pole niestandardowe pozostaje więc w panelu
  administracyjnym, dopóki ktoś świadomie jej nie udostępni. Widoczność istniejącego pola zmienia
  się na tym samym ekranie albo przez `PATCH …/definitions/:id`; zmiana działa od następnego
  odczytu i nie modyfikuje zapisanych wartości.
- **Sama aktualizacja niczego nie zmienia.** Definicje istniejące przed wprowadzeniem tego atrybutu
  zostały zmigrowane do `customer`, ponieważ ich wartości były już zwracane klientom. Po
  aktualizacji przejrzyj je i przenieś do `internal` wszystko, co nigdy nie miało być pokazywane.
- **Gdzie to dziś obowiązuje.** Dwie encje zwracają wartości pól niestandardowych osobom spoza
  administracji: **Zamówienie** (odpowiedzi dla klienta pod `/api/v1/orders` i odpowiedzi
  zewnętrzne pod `/api/v1/external/orders`) oraz **Zapytanie ofertowe** (szczegóły zapytania
  klienta pod `/api/v1/quote-requests/:id`). Wartości kategorii, organizacji, kont klientów i szans
  sprzedażowych są zwracane wyłącznie w trasach administracyjnych. W każdym przypadku obiekt
  `customFieldValues` zachowuje swój kształt i po prostu zawiera mniej kluczy.
- **Wartość bez definicji jest traktowana jak wewnętrzna.** Po usunięciu pola jego zapisane
  wartości pozostają w rekordach (zob. *Retencja danych*) i nie są zwracane ani klientowi, ani
  integracji. Z tego samego powodu klucza, pod którym wciąż istnieją zapisane wartości, nie da się
  **utworzyć ponownie jako `customer`**: żądanie jest odrzucane z kodem `409`. Utwórz pole jako
  `internal`, przejrzyj zawartość rekordów, a dopiero potem zmień widoczność.
- **Zmiana widoczności może dotrzeć do wszystkich odpowiedzi nawet po 5 sekundach.** Definicje są
  przechowywane w pamięci podręcznej każdego procesu API przez 5 sekund. Proces, który obsłużył
  zmianę, stosuje ją natychmiast i powiadamia pozostałe; proces, do którego powiadomienie nie
  dotrze, zwraca poprzednią widoczność do czasu wygaśnięcia swojej kopii. Po przeniesieniu pola do
  `internal` odczekaj 5 sekund, zanim zaczniesz na tym polegać.
- **Atrybutów produktu to nie dotyczy.** Typ `product` jest zarządzany przez moduł encji: o tym,
  czy kupujący widzi atrybut, decydują własne flagi atrybutów katalogu.
- **Dla modułu encji.** Przepuść zapisany zbiór wartości przez
  `CustomFieldValuePort.projectForCustomer(entityType, bag)` w tym jednym serializatorze, który
  odpowiada osobom spoza administracji, i nigdy nie zwracaj tam surowej kolumny. Metoda korzysta z
  pamięci podręcznej definicji dla typu encji, więc wywołanie jej raz na wiersz listy nie kosztuje
  zapytania na wiersz. Żadna trasa nie pozwala osobie spoza administracji *zapisywać* wartości pól
  niestandardowych.

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
[strona modułu katalogu](../modules/catalog.md#attributes-as-custom-field-extensions).

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

## Filtry list (`listFilter`)

`listFilter` to atrybut definicji, który ogólny rdzeń **interpretuje** — jeden z dwóch, obok
opisanego niżej `carryTo` — dlatego jest kolumną obok `required`, a nie flagą w `config`. Definicja z włączonym atrybutem jest dostępna jako
filtr na liście swojej encji w panelu, a to ogólna warstwa zamienia filtry żądania na SQL — inaczej
każda lista encji miałaby własną kopię tych samych sześciu predykatów.

- **To rejestr decyduje, które typy mogą go mieć.** Wpis każdego typu encji w rejestrze deklaruje
  `listFilter`; dziś robią to `order`, `quote_request` i `opportunity`. Ustawienie go dla innego
  typu jest odrzucane, a punkt końcowy `entity-types` publikuje tę flagę, żeby panel oferował opcję
  tylko tam, gdzie ma ona zastosowanie. Włączenie lub wyłączenie nie zmienia żadnej zapisanej
  wartości.
- **Port.** `custom_fields` publikuje `CustomFieldListFilterPort`: `listFilterable(entityType)`
  zwraca definicje oferowane przez listę, a `condition(entityType, filters)` zamienia wszystkie
  filtry żądania na **jeden** warunek — `select t."id" from "<tabela encji>" t where …`, z każdym
  kluczem i wartością jako parametrem — albo zgłasza błąd, wymieniając każdy klucz, który nie jest
  oferowany. Lista encji opakowuje ten warunek jako `id in (…)` w każdej wykonywanej instrukcji
  (wiersze, suma, liczniki), więc filtr zawęża cały wynik, a nie stronę, i działa w obrębie
  własnego zakresu tenanta i widoczności tej encji.
- **Korzysta z powiązania przechowywania.** Warunek sprawdza to samo powiązanie `{ table, column }`
  encji co opisane wyżej zabezpieczenia zmian, więc encję można filtrować bez kodu specyficznego
  dla niej w ogólnym module.
- **Semantyka.** `contains` (bez względu na wielkość liter), `in` (którakolwiek z opcji; dla
  wielokrotnego wyboru — którakolwiek z posiadanych), `is` oraz zakresy `min`/`max` i `from`/`to` z
  oboma końcami. Rekord bez wartości nigdy nie pasuje. Wartości jednego pola łączy OR; pola oraz
  własne filtry listy łączy AND. Najwyżej 10 pól i 100 wartości `in` na żądanie.
- **Odmowa nigdy nie jest cicha.** Klucz nieznany, innego typu albo nieoferowany jest odrzucany z
  `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE` i nazwany, a nie pomijany — pominięty filtr pokazuje
  operatorowi więcej rekordów, niż chciał, i nic o tym nie mówi. Z tego samego powodu operator,
  który nie pasuje do typu pola (np. `contains` na polu Tak/Nie), jest odrzucany z `400`
  `VALIDATION_FAILED`, a zakres dat lub liczb porównuje tylko zapisaną datę lub liczbę, więc
  wartość zapisana pod wcześniejszym typem ani nie pasuje, ani nie psuje listy.
- **Brak w sklepie.** Żaden filtr pola niestandardowego nie trafia do sklepu ani do punktów
  końcowych dla kluczy API.

### Dlaczego tablica CRM zachowuje własne predykaty

Tablica szans sprzedażowych filtruje po tym, co pokazują jej **karty** — polach wbudowanych i
niestandardowych, łącznie z osobą kontaktową — i pomija pole, którego karta już nie pokazuje, żeby
stary link nadal się otwierał. Ta reguła należy do tablicy, nie do definicji, i obejmuje pola, o
których ogólna warstwa nic nie wie. Dlatego tablica zachowuje własne predykaty, a `listFilter`
stosuje tylko **lista** szans: jej odwołania `custom:` przechodzą przez port i są odrzucane, gdy
nie są oferowane, a tablica — i żądanie listy kontynuujące jedną z jej kolumn (`cardValues=true`)
— zachowują regułę karty.

## Przenoszenie wartości (`carryTo`)

`carryTo` to drugi atrybut definicji, który ogólny rdzeń interpretuje. Definicja zapytania
ofertowego, zamówienia lub szansy sprzedażowej wymienia w nim typy encji, do których jej wartości są
przenoszone, gdy rekord jednego z tych typów powstaje z rekordu tej encji albo zostaje z nim
połączony — zawsze do definicji o **tym samym kluczu** w typie docelowym i tylko do pustej wartości.
Strona operatora jest opisana na stronie modułu `custom_fields`; ta sekcja mówi, jak to zbudowano.

- **Przechowywanie.** `custom_field_definitions.carry_to` — tablica `jsonb` typów encji, najwyżej
  dwa, bez powtórzeń, domyślnie `[]` — jedna kolumna, niezależnie od tego, jakie pary rejestr
  dopuści w przyszłości. Para jest z niej wyprowadzana i nigdy nie jest przechowywana jako osobny
  wiersz, dlatego usunięcie definicji docelowej zostawia opcję źródła w stanie, w jakim ją
  skonfigurowano.
- **O tym, jakie pary istnieją, decyduje rejestr.** Każdy wpis `custom-field-registry.ts` może
  zadeklarować `carryTargets`: `quote_request` → `order`, `opportunity`; `order` → `opportunity`;
  `opportunity` → `quote_request`, `order`. Nic innego nie jest oferowane. `GET …/entity-types`
  zwraca tę listę zawężoną do typów docelowych, których moduł właściciela jest obecny, a
  `GET …/definitions` usuwa z `carryTo` każdy typ docelowy z nieobecnym właścicielem. `PATCH`
  dołącza te ukryte elementy z powrotem, więc zapis przy wyłączonym `crm` nigdy nie gubi
  zachowanego „przenoś do szansy sprzedażowej”.
- **Jedna reguła zgodności, trzy miejsca użycia.** `assessCustomFieldCarry(source, target)` w
  `@endora-commerce/contracts` jest czystą funkcją — bez operacji wejścia-wyjścia — i zwraca
  wszystkie powody w stałej kolejności: `target_missing`, `value_type_mismatch` (bez rozszerzania
  typów), `options_missing` (pola wyboru: **wartości** opcji źródła, których brakuje w polu
  docelowym), `audience_mismatch` (źródło `internal` do celu `customer`). Polecenia definicji
  używają jej, by odrzucić włączenie przenoszenia (`422 CUSTOM_FIELD_CARRY_INCOMPATIBLE`, a
  `pair_unsupported` i `target_unavailable` dokłada samo polecenie); ekran panelu — na własnej
  liście definicji — do oznaczenia *Niezgodne* i ostrzeżeń przed zmianą; port przenoszenia — przy
  konwersji. Oceniany jest tylko nowo dodany typ docelowy, więc edycja nigdy nie kończy się błędem
  dlatego, że przenoszenie rozjechało się wcześniej.

### Port przenoszenia: `custom_fields` oblicza, zapisuje właściciel celu

`custom_fields` udostępnia `customFieldCarryPort` (`CustomFieldCarryPort` w
`packages/contracts/src/custom-fields.ts`). Jego jedyna metoda, `plan({ sourceType, targetType,
sourceValues, targetValues })`, zwraca `{ values, carried, skipped }`: zbiór wartości celu z
dołączonymi przeniesionymi wartościami, klucze, które przeniosła, oraz każdy pominięty klucz z
powodem. Niczego nie zapisuje, niczego nie audytuje i nie emituje zdarzeń — podział
odpowiedzialności z zasady XIV zostaje zachowany:

- nieobecny moduł właściciela któregokolwiek z typów → pusty plan: nic nie jest przenoszone, nic
  zapisywane ani odkładane na później;
- brane są pod uwagę tylko definicje źródłowe, których `carryTo` wskazuje cel i których wartość nie
  jest pusta; wartość uśpiona (jej definicję usunięto) jest pomijana bez wpisu;
- niepusta wartość celu zostaje i nie jest ani liczona, ani zapisywana;
- brak definicji docelowej, niezgodność typu lub widoczności pomija klucz z tym powodem; w
  przeciwnym razie wartość jest sprowadzana do postaci definicji **docelowej**, a wartość, której ta
  nie przyjmuje — między innymi opcja, której cel nie ma — jest pomijana jako `value_invalid`.
  Opcje są więc oceniane osobno dla każdej wartości w chwili konwersji, niezależnie od tego, co
  pokazywała tabela definicji;
- niezwiązane definicje docelowe z `required` nigdy nie są sprawdzane, więc moduł encji nie może
  uruchamiać `validateAndMerge` na połączonym zbiorze wartości;
- każde pominięcie ma `label` — kopię `labelDefault` i etykiet w poszczególnych językach definicji
  **źródłowej** z tej chwili — więc wpis historii nazywa pole w języku czytającego bez odczytu
  definicji i bez `custom_fields:read`. Moduły zapisują pominięcie przez
  `customFieldCarrySkipRecord`, który zachowuje `key`, `reason` i `label`, a resztę odrzuca.

`custom_fields` nie da się wyłączyć, więc wywołujący pobierają port leniwie i nie muszą sprawdzać
jego obecności.

**Wywołującym jest zawsze właściciel rekordu docelowego**, z bieżącym zbiorem wartości celu, w
zapisie, który tworzy lub łączy rekord:

| Para | Wywołujący | Gdzie zapisywane są wartości i wpis o pominięciu |
| --- | --- | --- |
| Zapytanie ofertowe → zamówienie | `orders` | w transakcji składania zamówienia, w wierszu `Order` i w jednym komentarzu z ustawionym `system_note` |
| Zapytanie ofertowe → szansa sprzedażowa, zamówienie → szansa sprzedażowa | `crm` | w poleceniu `crm.opportunity.create` lub `crm.opportunity.link_add`; pominięcia trafiają do jego wpisu audytu jako `after.customFieldCarry` |
| Szansa sprzedażowa → zapytanie ofertowe | `quote_requests` | we własnym poleceniu `quote_request.custom_fields.carry`; pominięcia jako jedno zdarzenie `custom-field-carry-skipped`, widoczne tylko dla administratorów |
| Szansa sprzedażowa → zamówienie | `orders` | we własnym poleceniu `order.custom_fields.carry`; pominięcia jako jedna notatka systemowa |

Żaden moduł nie czyta więc tabel innego: wartości źródłowe przychodzą przez porty odczytu i
zdarzenia, których wywołujący już używał, a właściciel celu zachowuje swój rekord, swój zapis i swój
audyt.

### Porty odbiorcze: szansa sprzedażowa → zamówienie / zapytanie ofertowe

Zamówienie lub zapytanie ofertowe utworzone z szansy sprzedażowej jest z nią wiązane później, przez
subskrybenta `crm`, po zatwierdzeniu utworzenia dokumentu. Gdy to powiązanie z pochodzeniem
powstaje — i tylko wtedy, więc reguła, która decyduje o powiązaniu, decyduje też o przeniesieniu —
`crm` przekazuje wartości szansy właścicielowi dokumentu przez
`CustomFieldCarryReceiverPort.receiveCarriedValues`, udostępniany jako `orderCustomFieldCarryPort`
przez `orders` i `quoteRequestCustomFieldCarryPort` przez `quote_requests`:

- jedno polecenie właściciela, w systemowym kontekście `crm`, więc przeniesione wartości są
  przypisane **systemowi**, a utworzenie dokumentu pozostaje przypisane administratorowi, który go
  utworzył;
- `not-found` zarówno dla rekordu, który nie istnieje, jak i dla rekordu innej organizacji — jedna
  odpowiedź, więc nic nie wycieka; w pozostałych przypadkach `applied`, nawet gdy nic nie
  przeniesiono;
- zasada „tylko do pustego pola” sprawia, że drugie wywołanie niczego więcej nie przenosi;
  wywołanie, które nic nie przenosi i niczego nie pomija, niczego nie zapisuje i nie trafia do
  audytu;
- `crm` sprawdza, czy `quote_requests` jest obecny, zanim pobierze jego port odbiorczy, a `orders`
  już jest wiążącą zależnością `crm`.

Ręczne powiązanie na karcie *Powiązania* szansy sprzedażowej nie przekazuje żadnego przeniesienia,
podobnie jak zamówienie → zapytanie ofertowe (**kopia jako zapytanie ofertowe**, wykonywana przez
klienta): żadne z nich nie jest konwersją, przy której wartości są przenoszone.

## Przechowywanie danych

Usunięcie definicji pola **nie** usuwa zapisanych wartości: nieaktualne wartości są zachowywane w
uśpieniu (nie są pokazywane ani odczytywane), zamiast być od razu kasowane, więc pomyłkowe usunięcie
da się cofnąć, a zapisy encji nigdy nie prowadzą kaskadowo do utraty danych.

## Dodawanie pola niestandardowego

Zdefiniuj pole na ekranie pól niestandardowych w panelu administracyjnym, dla wybranego typu encji
(klucz, przetłumaczona etykieta, typ wartości, wymagalność, widoczność, opcje). Od tej chwili pole pojawia się
w każdym rekordzie tego typu, a jego wartość jest zapisywana i odczytywana przez zwykłe ścieżki
tworzenia, edycji i odczytu encji — bez zmiany kodu.
