---
title: search
description: Indeksator Meilisearch i warstwa zapytań
---

# `search`

Wyszukiwanie w katalogu oparte na Meilisearch. Moduł odpowiada za indeksator, który odwzorowuje
zdarzenia katalogu w osobnych indeksach dla każdego kanału sprzedaży, typowaną warstwę zapytań, dane
dla podpowiedzi w okienku wyszukiwania, zapisywanie fraz zatwierdzonych wyszukiwań na potrzeby
analityki oraz opcjonalne wyszukiwanie wspomagane przez LLM.

Kompozycja modułu subskrybuje zdarzenia katalogu (`product.created.v1`, `product.updated.v1`,
`product.archived.v1`, `attribute.updated.v1`) oraz zdarzenia ustawień (`settings.value_changed`),
nie importując niczego z wnętrza tych modułów.

## Publiczne API

| Metoda + ścieżka | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/search/suggest?q=…&limit=N` | storefront (bez uwierzytelnienia) | Dane dla podpowiedzi w okienku wyszukiwania; zwraca do `limit` wierszy `ProductSummary` uporządkowanych według trafności w Meilisearch |
| `POST /api/v1/search/record` | storefront (bez uwierzytelnienia) | Zapis na potrzeby analityki bez czekania na wynik; dla każdego zatwierdzonego wyszukiwania zapisuje w `search_phrase_records` jeden wiersz z frazą w dosłownym brzmieniu |
| `POST /api/v1/admin/search/llm/toggle` | administrator (`search:write`) | Nakładka na `search.llm.enabled`, która waliduje powiązane ustawienia; odmawia włączenia, gdy którekolwiek pole embedder.* jest puste dla któregokolwiek z docelowych kanałów |

Pełna strona wyników wyszukiwania korzysta z `GET /api/v1/catalog/products?q=…` — właścicielem tego
kontraktu jest katalog, a trasa `/search` w storefroncie po prostu ponownie eksportuje
`CatalogPage`. Nie ma osobnego kontraktu strony wyników.

## Ustawienia

Sześć ustawień w grupie `search`, rejestrowanych przez `packages/modules/search/src/manifest.ts`:

| Kod | Typ | Wartość domyślna | Cel |
| --- | --- | --- | --- |
| `search.popup.suggestion_count` | `number` | `8` | Ile produktów pokazuje okienko podpowiedzi w storefroncie; `0` wyłącza okienko, ale zatwierdzone wyszukiwanie nadal przechodzi do wyników |
| `search.popup.minimum_query_length` | `number` | `3` | Minimalna liczba znaków, zanim storefront wyśle zapytanie o podpowiedzi i zanim zostanie zapisany wiersz frazy |
| `search.llm.enabled` | `boolean` | `false` | Włącza w tym kanale hybrydowe wyszukiwanie Meilisearch — leksykalne i semantyczne |
| `search.llm.embedder_url` | `string` | `""` | Adres URL endpointu embeddera zgodnego z OpenAI (używanego przez Meilisearch) |
| `search.llm.embedder_api_key` | `string` | `""` | Klucz API embeddera (panel administracyjny maskuje to pole) |
| `search.llm.embedder_model` | `string` | `""` | Identyfikator modelu embeddera (np. `text-embedding-3-small`) |

Wszystkie sześć ustawień można zawęzić do kanału sprzedaży w ramach istniejącego modelu ustawień.
Okienko podpowiedzi w storefroncie odczytuje liczbę wyników i próg przy każdym żądaniu przez ogólną
metodę odczytu (`SettingsService.get`); przy jakimkolwiek błędzie odczytu (brak w pamięci podręcznej,
`SettingNotRegistered`) usługa podpowiedzi wraca do wartości domyślnych z manifestu, żeby chwilowy
problem z ustawieniami nigdy nie kończył się błędem 500 w okienku podpowiedzi.

## Wyszukiwanie wspomagane przez LLM

Włączenie `search.llm.enabled` dla kanału podłącza embedder Meilisearch do indeksu tego kanału.
Embedder jest rejestrowany pod umowną nazwą `default` z `source: 'openAi'`; parametr `url` sprawia,
że działa z dowolnym endpointem zgodnym z OpenAI (samym OpenAI, Azure OpenAI, warstwą zgodności z
OpenAI w Ollamie…).

Nakładka przełączająca (`POST /api/v1/admin/search/llm/toggle`) odmawia ustawienia `enabled=true`
dla kanału, w którym trzy pola embedder.* nie są w pełni wypełnione. Tablica `details[]` w
odpowiedzi z błędem wymienia każdą brakującą parę `(channelCode, settingCode)`, żeby panel
administracyjny mógł wskazać braki.

Reakcja na zmianę ustawienia (w `SearchEventSubscriber`) to dodatkowe zabezpieczenie: zaawansowany
użytkownik, który ustawi `search.llm.enabled=true` bezpośrednio żądaniem PUT przez ogólną trasę
ustawień w API administracyjnym (z pominięciem nakładki), **nie** zepsuje konfiguracji Meilisearch —
gdy trójka pól embedder.* jest niekompletna, mechanizm zapisuje ostrzeżenie w logu i zostawia indeks
bez zmian.

Wyłączenie nigdy nie jest odrzucane; wywoływane jest `index.resetEmbedders()`, więc kanał wraca do
zwykłego rankingu leksykalnego.

Meilisearch v1.11 udostępnia `embedders` dopiero po włączeniu eksperymentalnej funkcji
`vectorStore`; od v1.13 embeddery są stabilne. Obie wersje są obsługiwane bez dodatkowych kroków —
endpoint administracyjny nie uzależnia niczego od wersji Meilisearch.

## Zapisywanie fraz na potrzeby analityki

Każde zatwierdzone wyszukiwanie w storefroncie trafia jako jeden wiersz do `search_phrase_records`,
gdzie czeka na przyszłą agregację przez moduł analityki:

| Kolumna | Uwagi |
| --- | --- |
| `phrase` | Dosłowne brzmienie — bez poprawiania literówek i bez rozszerzania przez LLM |
| `phrase_normalized` | `lower(trim(phrase))`, ustawiane przy wstawieniu; pozwala agregować bez rozróżniania wielkości liter bez zmieniania dosłownej frazy |
| `sales_channel_id` | Klucz obcy → `sales_channels.id` (`ON DELETE RESTRICT` — usunięcie kanału musi być świadomą decyzją, a nie cichym skasowaniem historii) |
| `result_count` | Liczba produktów zwróconych przez wyszukiwanie; `0` dla fraz bez wyników |
| `recorded_at` | `timestamptz default now()` |

Indeksy:

- `idx_search_phrase_records_aggr` na `(sales_channel_id, phrase_normalized, recorded_at desc)` — obsługuje zapytanie modułu analityki „frazy w kanale i ich częstotliwość w danym okresie”.
- `idx_search_phrase_records_recent` na `(recorded_at desc)` — dla pulpitów operacyjnych.

Zapis działa bez czekania na wynik (`SearchPhraseRecorder.record(...)`): kończy się, gdy wiersz
został przyjęty do zapisu, a nie gdy został utrwalony, i przechwytuje każdy wyjątek, zapisując
ostrzeżenie w logu. Trasa nie czeka na obietnicę (`void recorder.record(...)`) i od razu zwraca
`202 { ok: true }`. Zapis na potrzeby analityki nie może więc opóźnić ani zepsuć odpowiedzi dla
storefrontu.

Frazy poniżej progu (krótsze niż `minimum_query_length` kanału) są po cichu ignorowane po stronie
serwera — to dodatkowe zabezpieczenie przed błędem interfejsu, który zalałby tabelę szczątkowymi
frazami.

## Indeksator i subskrybent zdarzeń

`SearchIndexer` zapisuje jeden dokument na produkt w indeksie kanału o nazwie
`products_<channel_code>`. Dokument odzwierciedla produkt z katalogu (id, sku, type, status, slug,
primaryAssetUrl, categoryIds, categorySlugs, attributes, createdAt, updatedAt) i dla każdego języka
oferowanego przez kanał zawiera `texts.<język>`: obowiązujące w tym kanale i języku `name` i
`description` produktu (`''` dla celowo pustego nadpisania), jego przeszukiwalne atrybuty tekstowe i
etykiety jego przeszukiwalnych opcji wyboru w tym języku. `attributes` zawiera tylko wartości
atrybutów innych niż tekstowe. Indeksator ustawia też w Meilisearch `searchableAttributes` (`sku`,
`texts`, `attributes`) i `filterableAttributes` na podstawie bieżących flag
`product_attributes.is_searchable` i `is_filterable`, a `sortableAttributes` — na podstawie
`SORTABLE_ATTRIBUTES` (zobacz *Sortowanie*).

**Wyszukiwanie tylko w języku kupującego.** Zapytanie przeszukuje wyłącznie język kupującego:
`texts.<L>.name`, `texts.<L>.description`, `texts.<L>.attributes` i `texts.<L>.options` oraz `sku` i
przeszukiwalne atrybuty inne niż tekstowe, gdzie `L` to język żądania dopasowany do języków kanału
sprzedaży (sprawdzany względem nich, zanim zostanie użyty). Zapytanie polskiego kupującego nigdy nie
trafia w tekst angielski. Produkt wyłączony w danym kanale i języku nie jest zwracany.

**Dokument nie zawiera ceny.** Ceny należą do oglądającego: ścieżka zapytań ustala je z cenników
(`price_lists`) przy uzupełnianiu wyników, więc indeks nigdy nie decyduje o tym, ile płaci
kupujący. Ceny dla konkretnego kupującego i tak nie da się zindeksować: jeden indeks na kanał
sprzedaży i jeden dokument na produkt oznaczają, że dodanie ceny do dokumentu pomnożyłoby indeks
przez liczbę klientów.

### Ceny w wynikach wyszukiwania

- **Wyniki i podpowiedzi** są wyceniane dla oglądającego — jego organizacji, grupy klientów i kanału
  sprzedaży — jednym zbiorczym wywołaniem `resolveListingPriceDetails` na stronę lub okno
  podpowiedzi, tą samą wyceną co lista produktów w katalogu, więc wynik wyszukiwania, karta w
  katalogu i koszyk pokazują tę samą cenę. Podpowiedzi są wyceniane w walucie żądania.
- Produkt z wariantami pokazuje najniższą cenę wariantu jako cenę **„od”**, a naliczona cena
  promocyjna niesie własną cenę kupującego jako cenę przekreśloną.
- Przy włączonym ustawieniu cenników `pricing.show_list_price` wynik niesie `listPrice` obok niższej
  ceny kupującego, tak samo jak karta w katalogu.
- **Sortowania ani filtrowania według ceny** (`?sort=price`, `?sort=-price`, `minPrice`,
  `maxPrice`) nigdy nie obsługuje Meilisearch: katalog kieruje taką listę do PostgreSQL, gdzie
  wstępnie wyliczona powierzchnia cen modułu `price_lists` porządkuje ją według cen, które karty
  pokazują temu oglądającemu.

### Sortowanie

Meilisearch odmawia sortowania po polu spoza `sortableAttributes` indeksu, więc pola, po których
ścieżka zapytań może sortować, są deklarowane raz, w `SORTABLE_ATTRIBUTES` (`search-indexer.ts`):
`createdAt` i `name`. Ta stała jest zarówno tym, co indeksator stosuje do indeksu każdego kanału, jak
i jedynym zbiorem pól, które może zwrócić `buildSort` — typ zwracany tej funkcji jest z niej
zbudowany, więc sortowanie po polu, którego indeksator nigdy nie zadeklarował, się nie skompiluje.

Cztery sposoby sortowania z kontraktu listy produktów odpowiadają następującym ustawieniom:

| `?sort=` | Meilisearch |
| --- | --- |
| `relevance` (lub brak) | brak — reguły rankingu silnika |
| `-createdAt` | `createdAt:desc` |
| `name` | `name:asc` |
| `-name` | `name:desc` |

Nazwa jest sortowana w języku kupującego: sortowanie działa na `texts.<L>.name`, oznaczonym jako
sortowalne dla każdego języka oferowanego przez kanał, więc kolejność widziana przez kupującego to
kolejność nazw, które czyta.

Nazwa *wyświetlana* na karcie wyniku nie pochodzi z indeksu. Każde trafienie jest przed udzieleniem
odpowiedzi ponownie odczytywane z Postgresa, a karta dostaje tę nazwę, którą dla kanału sprzedaży i
języka z żądania pokazuje karta na liście produktów katalogu: nazwę obowiązującą w tym miejscu
(kanał × język → kanał → globalna).

**Aktualizacja indeksu zbudowanego przed wprowadzeniem ustawień sortowania** wymaga ponownego
zindeksowania: ustawienia nigdy nie były stosowane (`sortableAttributes` było `[]` w każdym indeksie,
a każdą posortowaną listę po cichu obsługiwał zapasowy mechanizm w Postgresie), a `createdAt` nigdy
nie było zapisywane w dokumencie. Pełne ponowne indeksowanie stosuje jedno i drugie. Następuje
automatycznie przy kolejnym okresowym przebiegu w roli worker (`search.reindex_interval_minutes`,
domyślnie 10); wdrożenie bez okresowego przebiegu wymaga działania operatora — akcji **Reindex
products** w panelu administracyjnym albo `pnpm run cli search reindex` w katalogu głównym
instancji. Odświeżenie po
`attribute.updated.v1` ponownie stosuje ustawienia, ale nie zapisuje dokumentów, więc przywraca
sortowanie `name`, ale nie `-createdAt`.

### Wyszukiwanie po listach opcji

Dla atrybutów z flagą `isSearchable` ORAZ typem wartości wyboru (`select`, `enum`, `multiselect`)
indeksator ustala etykiety opcji w każdym języku kanału i zapisuje je w `texts.<język>.options`,
więc klient, który wpisze widoczny dla siebie tekst (np. „Czerwony”), znajdzie produkty, których
surową wartością jest klucz opcji (np. „red”). Etykiety są odczytywane raz na przebieg indeksowania.
Wyłączenie `isSearchable` usuwa etykiety opcji przy następnym odświeżeniu, w zwykłym rytmie
wyznaczanym przez zdarzenia.

### Aktualizacja do dokumentu z tekstami w językach (funkcja 172)

Pola dokumentu `name`, `description`, `localizedNames` i `searchableOptions` oraz wartości tekstowe w
`attributes` zastępuje `texts`. **Po aktualizacji uruchom jedno pełne ponowne indeksowanie**:
okresowy przebieg w roli worker robi to sam (`search.reindex_interval_minutes`); w przeciwnym razie
użyj akcji **Reindex products** w panelu administracyjnym albo `pnpm run cli search reindex`. Dopóki
indeks nie zostanie ponownie zindeksowany — jego przeszukiwalne atrybuty nie obejmują jeszcze
`texts` — sprawdzenie przy starcie wtyczki indeksuje go ponownie, a do tego czasu zapytania są
obsługiwane jak dotąd, bez ograniczenia do języka, a w dzienniku pojawia się ostrzeżenie. Rozmiar
indeksu rośnie wraz z liczbą języków oferowanych przez kanał.

`SearchEventSubscriber` utrzymuje indeksy w zgodności z katalogiem:

| Zdarzenie | Obsługa |
| --- | --- |
| `product.created.v1` | `indexer.upsertProduct(productId)` |
| `product.updated.v1` | `indexer.upsertProduct(productId)` |
| `product.archived.v1` | `indexer.deleteProduct(productId)` |
| `attribute.updated.v1` | `indexer.refreshAttributeSettings()` |
| `settings.value_changed` (gdy `settingCode === 'search.llm.enabled'`) | `indexer.attachEmbedderForChannel` / `detachEmbedderForChannel` |

Każda procedura obsługi przechwytuje własne błędy — chwilowa awaria Meilisearch nie psuje zapisu w
katalogu. Zapasowa ścieżka odczytu (`catalog/routes.public.ts`) utrzymuje wyszukiwanie w storefroncie
w działaniu przy nieaktualnym indeksie aż do następnego ręcznego `search:reindex`.

### Dostępność w kanale i języku

Od wprowadzenia zakresów danych produktu (`specs/163-product-data-scopes/`) produkt można włączyć lub wyłączyć w każdym kanale sprzedaży i w każdym języku kanału, nadać mu okno publikacji i odbiorców właściwych dla kanału. Indeksator pyta moduł `catalog` (`catalogProductAvailabilityPort.describeChannelAvailability`) zamiast czytać status produktu:

- produkt należący do kanału trafia do indeksu, gdy jest włączony w **co najmniej jednym** języku kanału; produkt zarchiwizowany lub usunięty nie jest włączony w żadnym;
- każdy dokument zawiera `liveLanguages` (języki kanału, w których produkt jest włączony), `publishFromMs` / `publishUntilMs` (obowiązujące okno w milisekundach od epoki; `0` i `Number.MAX_SAFE_INTEGER`, gdy okno jest otwarte) oraz obowiązujące w kanale `visibility` i `allowedOrganizationIds`. Wszystkie pięć to atrybuty filtrowalne;
- zapytanie dodaje filtr dla języka żądania (pierwszy znacznik `Accept-Language` dopasowany do języków kanału, w przeciwnym razie język domyślny), okna w chwili zapytania i odbiorców wywołującego, więc strona jest wycinana wyłącznie z dostępnych trafień. Lista dozwolonych organizacji służy tylko do filtrowania i nigdy nie trafia do odpowiedzi;
- przy uzupełnianiu wyników moduł `catalog` jest pytany ponownie (`filterAvailable`) o każde trafienie, więc nieaktualny dokument nie pokaże produktu, który nie jest już dostępny.

Około minuty po pierwszym uruchomieniu po aktualizacji proces workera doprowadza ustawienia każdego istniejącego indeksu kanału do aktualnego stanu bez ponownego indeksowania: pięć pól dostępności staje się filtrowalnych, więc zapytania nadal obsługuje indeks, zamiast przechodzić na PostgreSQL. Raz na uruchomienie odczytuje ustawienia każdego indeksu i zmienia je tylko tam, gdzie czegoś brakuje. Dokument zaindeksowany przed tą zmianą nadal nie ma nowych pól i jest obsługiwany jak dotąd. **Po aktualizacji uruchom ponowne indeksowanie każdego kanału sprzedaży** (operacja zbiorcza `search_reindex` albo opisane niżej polecenie CLI), aby filtry okna i języka działały dokładnie.

### Gdy indeks nie odpowiada

Mechanizm zapasowy pozostaje mechanizmem zapasowym — publiczny katalog nie może zwracać 503 tylko
dlatego, że wyszukiwarka ma problem — ale rozróżnia dwie sytuacje, które kiedyś były traktowane jak
jedna:

- **unreachable** — silnik nie działa, jest nieosiągalny albo przekracza limit czasu. To stan
  przejściowy. `catalog` zapisuje to w logu przy każdym żądaniu i wykonuje zapytanie o listę
  produktów w Postgresie; od nikogo nie oczekuje się niczego więcej.
- **refused** — silnik odpowiedział w ciągu milisekund, że nie wykona *tego* zapytania:
  `invalid_search_sort`, `index_not_found`, odrzucony klucz API. To stan deterministyczny, który sam
  nie minie, i błąd w tym, jak ten moduł skonfigurował indeks. Powód zapisywany w logu przez
  wywołującego podaje kod błędu samego Meilisearch, a `search` sam zgłasza go na poziomie `error` —
  raz dla każdego kodu, bo ustawienie indeksu to cecha wdrożenia, a publiczna lista produktów
  zgłaszałaby go w przeciwnym razie przy każdym żądaniu.

To rozróżnienie jest jedynym powodem, dla którego ten błąd mógł przetrwać na pięciu działających
indeksach: każda posortowana lista była obsługiwana zapasowo przez Postgres, a jedynym śladem był
wpis w logu `meilisearch unavailable` o silniku, który działał bez zarzutu.

## Integracja ze storefrontem

Nagłówek strony (`storefront/components/Header.tsx`) wyświetla `<form action="/search"
method="GET">` z osadzonym komponentem klienckim `<SearchAutocomplete>`, który stopniowo rozszerza
formularz:

- opóźnienie (debounce) 200 ms; AbortController anuluje nieaktualne żądania.
- Poniżej `minimum_query_length` kanału żądanie nie jest wysyłane.
- Obsługa klawiatury: ArrowUp/Down przesuwa zaznaczenie, Enter przechodzi do wybranej podpowiedzi,
  Escape zamyka okienko, kliknięcie poza nim je zamyka.
- Odpowiedź 503 z `/search/suggest` pokazuje w okienku pozycję „search temporarily unavailable”, nie
  psując statycznego formularza.
- Przy wyłączonym JavaScripcie formularz wysyła `?q=…` do `/search` w zwykły sposób (indeksowanie
  przez roboty nie wymaga JavaScriptu).

Strona `/search` (`storefront/app/(catalog)/search/page.tsx`) ponownie eksportuje `CatalogPage` —
lista, filtry, sortowanie, stronicowanie i stan pusty są identyczne jak w `/catalog`. Jedynym
zachowaniem specyficznym dla wyszukiwania jest zapis frazy na potrzeby analityki bez czekania na
wynik: gdy jest obecne `?q=`, strona czeka na `listProducts` (żeby `resultCount` miało sens), a
następnie wywołuje `void recordPhrase(...)`, ZANIM przekaże sterowanie do `CatalogPage`.

## Ponowne indeksowanie z wiersza poleceń

`search reindex` przechodzi przez każdy kanał sprzedaży i przesyła jego publiczne dane produktów do
Meilisearch. Polecenie jest idempotentne — można je bezpiecznie uruchomić po świeżym
`endora demo seed` albo zawsze wtedy, gdy indeks rozjedzie się z Postgresem.

To polecenie deklarowane w `manifest.ts` tego modułu i uruchamiane przez hosta, więc indeksuje przez
ten jeden `SearchIndexer`, który ma kompozycja, zamiast budować drugi:

```bash
# W instancji, z jej katalogu głównego:
pnpm run cli search reindex

# W klonie repozytorium Endora Commerce:
pnpm --filter backend run search:reindex
# albo bezpośrednio przez plik wykonywalny hosta:
pnpm --filter backend exec tsx src/cli.ts search reindex
```

Implementacja znajduje się w `packages/modules/search/src/backend/cli/reindex.ts`.

## Testy

- `backend/test/contract/search/public-suggest.contract.test.ts` (7 przypadków) — ścieżka poprawna, nadpisanie limitu, próg, zbyt długie zapytanie, brak `q`, limit poza zakresem.
- `backend/test/contract/search/public-record.contract.test.ts` (7 przypadków) — ścieżka poprawna, domyślne `result_count`, przypięcie kanału, walidacja wartości pustych, zbyt długich i ujemnych, ignorowanie fraz poniżej progu.
- `backend/test/contract/search/admin-llm-toggle.contract.test.ts` (5 przypadków) — odmowa przy niepełnej konfiguracji (każda kombinacja pól embedder.*), powodzenie przy pełnej konfiguracji, wyłączenie zawsze się udaje, brak uwierzytelnienia → 401.
- `backend/test/integration/search/manifest-reconcile.test.ts` (2 przypadki) — grupa i 6 ustawień z poprawnymi wartościami domyślnymi; ponowne zastosowanie jest idempotentne.
- `backend/test/integration/search/embedder-reactor.test.ts` (3 przypadki) — podłączenie po ustawieniu enable=true, odłączenie po powrocie do false, brak zdarzenia, gdy nakładka odmawia przełączenia.
- `backend/test/integration/search/event-subscriber.test.ts` (istniejący) — indeksowanie wyzwalane zdarzeniami katalogu.
- `backend/test/integration/search/catalog-via-meilisearch.test.ts` (istniejący) — ścieżka odczytu wybierana flagą środowiskową.
- `backend/test/integration/search/sort-order.test.ts` (6 przypadków) — każdy z czterech sposobów sortowania obsłużony przez Meilisearch (kluczowa jest asercja na `x-search-backend`: Postgres obsługuje wszystkie cztery, więc sama kolejność nie odróżni strony z Meilisearch od zapasowej), zadeklarowane `sortableAttributes` i brak zindeksowanego pola `price`.
- `backend/test/unit/search/search-sort-attributes.test.ts` (4 przypadki) — `buildSort` zwraca tylko pola zadeklarowane w `SORTABLE_ATTRIBUTES`.
- `backend/test/unit/search/search-degrade-observability.test.ts` (3 przypadki) — odrzucone zapytanie podaje kod błędu silnika i jest zgłaszane raz; nieosiągalność nie jest zgłaszana podwójnie.

Dwa ostatnie nie wymagają usług; pozostałe działają na prawdziwym Postgresie i prawdziwym
Meilisearch.

## Punkty rozszerzenia

- **Własne reguły rankingu** — Meilisearch obsługuje własne reguły rankingu dla każdego indeksu;
  indeksator może przesyłać zestaw reguł, gdy panel administracyjny dostanie możliwość ustawiania wag
  dla poszczególnych kanałów.
- **Wybór źródła embeddera** — ustawienie `search.llm.embedder_source` z wartościami
  `openAi | huggingFace | rest | userProvided` pozwoliłoby wybrać dla danego kanału dostawcę
  niezgodnego z OpenAI bez zmiany nazw trzech ustawień z danymi uwierzytelniającymi.
- **Zapasowa ścieżka odczytu** — już zaimplementowana: gdy Meilisearch jest niedostępny, ścieżka
  odczytu katalogu przechodzi na wyszukiwanie ILIKE w Postgresie przez `catalog-query.service.ts`, żeby
  storefront nigdy nie przestawał działać całkowicie.
