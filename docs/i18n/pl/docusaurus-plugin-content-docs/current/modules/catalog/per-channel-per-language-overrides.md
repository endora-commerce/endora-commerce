---
title: Nadpisania dla kanału i języka
---

# Nadpisania dla kanału i języka

Katalog stosuje dla wartości atrybutów produktu **model wartości o czterech zakresach**. Ten sam
klucz atrybutu może mieć w jednym produkcie do czterech osobnych miejsc na wartość:

- `global` — jedna wartość dla wszystkich kanałów sprzedaży i wszystkich języków;
- `language` — jedna wartość dla każdego języka (np. systemowe Name, Description);
- `channel` — jedna wartość dla każdego kanału sprzedaży, do którego przypisano produkt;
- `channel+language` — jedna wartość dla każdej pary `(channel, language)`.

O tym, które z tych miejsc są dostępne dla danego atrybutu, decydują dwie flagi w definicji
atrybutu: `channelScoped` i `languageScoped`. Atrybuty systemowe `name` i `description` mają na
stałe włączone obie (stała backendu `SYSTEM_ATTRIBUTE_SCOPES`). Atrybuty zdefiniowane przez
użytkownika są domyślnie tylko globalne, a zakresy włącza się w edytorze atrybutów.

## Po co

Katalog B2B często potrzebuje dla tego samego produktu zarówno tekstów marketingowych różnych w
poszczególnych kanałach (hurt i detal), jak i tłumaczeń na różne języki. Dotychczasowy sposób
przechowywania — JSONB w `products.name` / `products.description` i płaski JSONB
`products.attribute_values` — pozwalał wyrazić tylko wymiar językowy. Model czterech zakresów
znosi to ograniczenie bez przepisywania podstawowego sposobu przechowywania: dodaje obok osobną
tabelę nadpisań, przechowującą wartości zależne od kanału, oraz jedną funkcję rozstrzygającą, która
przy odczycie łączy oba źródła.

## Sposób przechowywania

Globalne wartości bazowe pozostają tam, gdzie były zawsze:

- `products.name` (JSONB `Record<lang, string>`) — zależne od języka.
- `products.description` (JSONB `Record<lang, string>`) — zależne od języka.
- `products.attribute_values` (JSONB `Record<key, value>`) — domyślnie globalne. Gdy flaga
  `languageScoped` atrybutu ma wartość `true`, wartość wewnętrzna też jest indeksowana językiem:
  `Record<key, Record<lang, value>>`.

Wartości zależne od kanału trafiają do nowej tabeli:

```sql
create table "product_value_overrides" (
  "id"            uuid primary key default gen_random_uuid(),
  "product_id"    uuid not null references "products"("id") on delete cascade,
  "attribute_key" varchar(64) not null,
  "channel_id"    uuid not null references "sales_channels"("id") on delete cascade,
  "language_code" varchar(16) null,
  "value"         jsonb not null,         -- always wrapped { "v": <scalar | object> }
  "created_at"    timestamptz not null default now(),
  "updated_at"    timestamptz not null default now()
);
```

Unikalność krotki (produkt, atrybut, kanał, język) zapewniają **dwa indeksy częściowe**:

```sql
create unique index "product_value_overrides_channel_only_uniq"
  on "product_value_overrides" ("product_id", "attribute_key", "channel_id")
  where "language_code" is null;

create unique index "product_value_overrides_channel_lang_uniq"
  on "product_value_overrides" ("product_id", "attribute_key", "channel_id", "language_code")
  where "language_code" is not null;
```

W zwykłym ograniczeniu UNIQUE PostgreSQL traktuje każdy `NULL` jako odrębną wartość, więc jedynym
poprawnym sposobem wyrażenia, że „(kanał, NULL) i (kanał, NULL) to ten sam wiersz”, są dwa indeksy
częściowe — po jednym dla każdego przypadku `NULL`.

Do wyszukiwania w ciasnych pętlach funkcja rozstrzygająca używa zwykłego indeksu btree:

```sql
create index "product_value_overrides_product_attr_idx"
  on "product_value_overrides" ("product_id", "attribute_key");
```

Druga tabela — `product_editor_preferences` — przechowuje dla każdej pary (administrator, produkt)
ostatnio wybrane `(channelId, languageCode)`, aby strona edycji produktu ustawiała przełączniki tak
jak przy poprzedniej wizycie. Tabela nie ma klucza obcego do `sales_channels`, więc usunięty lub
odpięty kanał jest przy odczycie po prostu pomijany.

## Funkcja rozstrzygająca

Jedynym źródłem odpowiedzi na pytanie „jaką wartość pokazać?” jest
`packages/contracts/src/product-value-resolver.ts`. Ten sam plik TypeScript importują backend
(endpointy administracyjne, odczyt dla storefrontu, indeksowanie wyszukiwarki) i aplikacja panelu
administracyjnego. Podgląd wartości efektywnej w panelu z definicji nie może więc różnić się od
tego, co wyświetla storefront.

Algorytm — `resolveAttribute({ baseline, overrides, scope, ctx })` — przechodzi cztery kroki:

1. wartość `(channel + language)` — gdy atrybut zależy od kanału I od języka, a kontekst zawiera
   oba;
2. wartość `(channel-only)` — gdy atrybut zależy od kanału, a kanał jest w kontekście;
3. wartość bazowa `(global + language)` — dla atrybutów zależnych od języka wybiera żądany język z
   JSONB;
4. wartość bazowa `(global)` — pojedyncza wartość (albo wartość w języku podstawowym dla atrybutów
   zależnych od języka).

Wygrywa pierwsza niepusta wartość. Pusty string, `null`, pusty obiekt i pusta tablica są traktowane
jako „brak wartości” i algorytm przechodzi dalej. Funkcja zwraca zarówno wynik, JAK I znacznik
`source` wskazujący, skąd pochodzi odpowiedź — panel administracyjny wykorzystuje go, aby przy
każdym polu wyświetlić etykietę „channel + language override” / „global baseline”.

### Osierocone nadpisania

Administrator może z powrotem ustawić flagę `channelScoped` atrybutu na `false`, gdy nadpisania dla
kanałów są już zapisane. Funkcja rozstrzygająca po prostu pomija wtedy wiersze nadpisań atrybutu,
który przestał zależeć od kanału, więc storefront wraca do wartości bazowej bez utraty danych.
Osierocone wiersze może kiedyś usunąć zadanie porządkowe; ta funkcja tego nie wymaga.

## Zapis

Nadpisania zależne od kanału zapisuje się przez jeden endpoint administracyjny:

```
PATCH /api/v1/admin/catalog/products/:id/value-overrides
{
  "upserts": [
    { "attributeKey": "name",        "channelId": "<vip-uuid>", "languageCode": "en-US", "value": { "v": "VIP wholesale name (EN)" } },
    { "attributeKey": "description", "channelId": "<vip-uuid>", "languageCode": "pl-PL", "value": { "v": "Wholesale-only Polish copy" } }
  ],
  "deletes": [
    { "attributeKey": "description", "channelId": "<retail-uuid>", "languageCode": "en-US" }
  ]
}
```

Wszystkie żądane operacje wykonują się w jednej transakcji `em.transactional`. Handler najpierw
sprawdza każdy wpis według sześciu reguł i przy pierwszym błędzie wycofuje całość:

| Kod 422                             | Kiedy występuje |
| ----------------------------------- | -------------- |
| `attribute_unknown`                 | `attributeKey` nie jest ani atrybutem systemowym (`name`, `description`), ani wierszem w `product_attributes`. |
| `attribute_not_channel_scoped`      | atrybut ma `channelScoped=false`, więc nie ma wartości dla kanału. |
| `attribute_missing_language`        | atrybut ma `languageScoped=true`, ale wpis ma `languageCode=null`. |
| `channel_not_assigned_to_product`   | `channelId` nie występuje w `sales_channel_products` dla tego produktu. |
| `language_not_in_channel`           | `languageCode` nie jest `null` i nie występuje w tablicy `SalesChannel.languages` kanału. |
| `value_invalid`                     | opakowana wartość `value.v` nie pasuje do `valueType` atrybutu. |

Zapis wartości bazowych (Name / Description dla każdego języka; globalne `attribute_values`) się nie
zmienia — redaktorzy nadal korzystają z istniejących pól dla poszczególnych języków na zakładce
Details. Nadpisania dla kanałów są dodatkiem.

## Odczyt

Z funkcji rozstrzygającej korzystają trzy miejsca:

- **Endpoint administracyjny** —
  `GET /api/v1/admin/catalog/products/:id?channelId=&languageCode=&includeOverridesMap=true`
  zwraca wartości bazowe produktu ORAZ — jeśli podano parametry kontekstu — blok `resolved` z
  `name`, `description`, `attributeValues` i `sources`. Przy `includeOverridesMap=true` dołącza też
  pełną listę nadpisań, aby klient mógł pokazywać podgląd przy przełączaniu kontekstu.
- **Publiczny odczyt dla storefrontu** — kanał pobiera z nagłówka `x-sales-channel` (dotychczasowa
  konwencja), a język z `Accept-Language`. Warstwa nadpisań jest niewidoczna dla publicznego
  klienta.
- **Indeksowanie wyszukiwarki (Meilisearch)** — tworzy jeden dokument dla każdej pary
  `(product, channel)`. Pola `name` i `description` każdego dokumentu przechodzą przez funkcję
  rozstrzygającą z `channel.defaultLanguage` jako aktywnym językiem, więc nadpisania dla kanałów
  wpływają na wyniki wyszukiwania w storefroncie.

## Panel administracyjny

Zakładka **Details** strony edycji produktu ma nad istniejącymi polami dla języków panel
`<ProductScopeEditor>`. Panel:

1. Równolegle pobiera `GET /scope-context` (kanały przypisane do produktu, języki każdego kanału,
   podstawowy język panelu administracyjnego i zapamiętany wybór redaktora) oraz
   `GET /value-overrides`.
2. Wyświetla przełącznik kanału sprzedaży (Global i każdy przypisany kanał) oraz przełącznik języka
   ograniczony do języków aktywnego kanału (albo do sumy języków wszystkich kanałów przy Global).
3. Pokazuje efektywne Name i Description dla aktywnego kontekstu, z etykietą źródła przy każdym
   polu — `channel + language override` / `channel override` / `global baseline (language)` /
   `global baseline (fallback)` / `no value`.
4. Przy każdym polu oferuje działania „Add override” / „Edit override” / „Reset to Global”. Zmiany
   są zapisywane przez `PATCH /value-overrides` z optymistycznym odświeżeniem.
5. Zapisuje wybór redaktora `(channel, language)` przez `PUT /editor-preference` (z opóźnieniem,
   bez gwarancji), aby przy następnej wizycie ustawić ten sam kontekst.

Edycja jest możliwa dopiero po wybraniu konkretnego kanału. Przy Global (bez kanału) panel jest
tylko do odczytu, a tekst pomocy wyjaśnia, że nadpisania działają wyłącznie w obrębie kanału.

## Migracja

Wszystko wprowadza jedna migracja, `20260611T140346_catalog_product_value_overrides_init.ts`:

- dodaje do `product_attributes` kolumny logiczne `channel_scoped` i `language_scoped` (domyślnie
  `false`);
- tworzy `product_value_overrides` z dwoma częściowymi indeksami UNIQUE i indeksem btree
  `(product_id, attribute_key)`;
- tworzy `product_editor_preferences` (złożony klucz główny `(admin_user_id, product_id)`).

Nie ma migracji danych bazowych ani uzupełniania danych. `down()` jest dokładnym odwróceniem —
usuwa obie tabele i obie kolumny.

## Poza zakresem

- **Nadpisania atrybutów zdefiniowanych przez użytkownika w panelu administracyjnym** — panel
  pokazuje dziś tylko systemowe Name i Description. Endpoint PATCH przyjmuje nadpisania atrybutów
  użytkownika, a odczyt je rozstrzyga, ale aplikacja panelu nie ma jeszcze dla nich interfejsu
  zapisu.
- **Zmiana postaci publicznego odczytu dla storefrontu** — publiczny endpoint katalogu nadal
  zwraca `products.name` i `products.description` jako JSONB `Record<lang, string>`. Przejście na
  pojedynczą, rozstrzygniętą wartość to zmiana niezgodna wstecz dla konsumentów storefrontu i
  zostanie zrobione osobno.
- **Ponowne indeksowanie z uwzględnieniem kanału** — endpoint PATCH nie dodaje jeszcze do kolejki
  zadania ponownego indeksowania w Meilisearch dla każdego zmienionego kanału; zmianę uwzględni
  dopiero następna aktualizacja indeksu produktu (wywołana dowolną zmianą w katalogu). Osobne
  indeksowanie przy zapisie nadpisania to niewielka zmiana do zrobienia później.
