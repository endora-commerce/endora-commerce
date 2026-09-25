---
title: search
description: Indeksator Meilisearch + most query
---

# `search`

Wyszukiwanie katalogu oparte na Meilisearch. Posiada indeksator odzwierciedlający zdarzenia
Catalog w indeksy per-Sales-Channel, typowany most query, feed popup typeahead,
ingest analityki dla zatwierdzonych fraz wyszukiwania
oraz opt-in wyszukiwania wspomaganego LLM.

Composition root modułu subskrybuje zdarzenia Catalog
(`product.created.v1`, `product.updated.v1`, `product.archived.v1`,
`attribute.updated.v1`) oraz zdarzenia Settings
(`settings.value_changed`) bez importów do wnętrza żadnego z modułów.

## Publiczne API

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/search/suggest?q=…&limit=N` | storefront (no auth) | Feed popup typeahead; zwraca do `limit` wierszy `ProductSummary` posortowanych według trafności Meilisearch |
| `POST /api/v1/search/record` | storefront (no auth) | Fire-and-forget ingest analityki; persystuje jeden verbatim wiersz w `search_phrase_records` na zatwierdzone wyszukiwanie |
| `POST /api/v1/admin/search/llm/toggle` | admin (`search:write`) | Wrapper cross-setting-validating wokół `search.llm.enabled`; odmawia włączenia, gdy jakiekolwiek pole embedder.* jest puste dla dowolnego kanału docelowego |

Pełna strona wyników wyszukiwania ponownie używa `GET /api/v1/catalog/products?q=…` —
catalog posiada ten kontrakt, a trasa storefront `/search` po prostu
re-eksportuje `CatalogPage`. Nie ma równoległego kontraktu strony wyników.

## Settings

Sześć gałek żyje pod grupą `search`, rejestrowanych przez
`packages/modules/search/src/manifest.ts`:

| Code | Type | Default | Purpose |
| --- | --- | --- | --- |
| `search.popup.suggestion_count` | `number` | `8` | Ile produktów pokazuje popup storefront; `0` tłumi popup, ale zatwierdzone wyszukiwanie nadal nawiguje |
| `search.popup.minimum_query_length` | `number` | `3` | Minimalna liczba znaków, zanim storefront wyśle suggest i zanim recorder zapisze wiersz |
| `search.llm.enabled` | `boolean` | `false` | Włącza hybrydowe wyszukiwanie leksykalne + semantyczne Meilisearch na tym kanale |
| `search.llm.embedder_url` | `string` | `""` | URL endpointu embeddera kompatybilnego z OpenAI (używany przez Meilisearch) |
| `search.llm.embedder_api_key` | `string` | `""` | Klucz API embeddera (Admin UI maskuje input) |
| `search.llm.embedder_model` | `string` | `""` | Identyfikator modelu embeddera (np. `text-embedding-3-small`) |

Wszystkie sześć są sales-channel-scoped przez istniejący model Settings. Popup
storefront czyta count + threshold per request przez
uniwersalny getter (`SettingsService.get`); przy dowolnym błędzie read (cache
miss, `SettingNotRegistered`) serwis suggest fallbackuje do
domyślnych z manifestu, aby hiccup Settings nigdy nie 500-ował popup.

## Wyszukiwanie wspomagane LLM

Przełączenie `search.llm.enabled` na włączone dla kanału dołącza embedder Meilisearch
do indeksu tego kanału. Rejestrujemy embedder pod dobrze znanym imieniem `default`
z `source: 'openAi'`; parametr `url` sprawia, że działa z dowolnym endpointem
kompatybilnym z OpenAI (sam OpenAI,
Azure OpenAI, OpenAI shim Ollama, …).

Wrapper toggle (`POST /api/v1/admin/search/llm/toggle`) odmawia
ustawienia `enabled=true` dla kanału, którego trzy pola embedder.*
nie są w pełni wypełnione. Envelope błędu `details[]` wymienia
każdą brakującą parę `(channelCode, settingCode)`, aby Admin UI mógł
podświetlić luki.

Reaktor (w `SearchEventSubscriber`) to belt-and-braces: power user PUT-ujący
`search.llm.enabled=true` bezpośrednio przez generyczną trasę admin Settings
(omijając wrapper) **nie** zatruwa
Meilisearch — reaktor warn-loguje i zostawia indeks w spokoju, gdy triplet
embedder.* jest niekompletny.

Wyłączenie nigdy nie odmawia; reaktor woła `index.resetEmbedders()`, więc
kanał wraca do zwykłego rankingu leksykalnego.

Meilisearch v1.11 bramkuje `embedders` za experimental feature `vectorStore`;
v1.13+ traktuje embedders jako stabilne. Oba są
wspierane transparentnie — endpoint admin nie bramkuje na wersji
Meilisearch.

## Ingest analityki

Każde zatwierdzone wyszukiwanie storefront ląduje jednym wierszem w
`search_phrase_records` do przyszłej agregacji przez moduł Analytics:

| Column | Notes |
| --- | --- |
| `phrase` | Verbatim — bez korekty literówek ani ekspansji LLM |
| `phrase_normalized` | `lower(trim(phrase))`, utrzymywane przy insert; wspiera agregację case-insensitive bez przepisywania verbatim phrase |
| `sales_channel_id` | FK → `sales_channels.id` (`ON DELETE RESTRICT` — usunięcie kanału musi być świadomą decyzją, a nie cichym usunięciem historii) |
| `result_count` | Liczba produktów zwróconych przez wyszukiwanie; `0` dla dead-end phrases |
| `recorded_at` | `timestamptz default now()` |

Indeksy:

- `idx_search_phrase_records_aggr` na `(sales_channel_id, phrase_normalized, recorded_at desc)` — wspiera zapytanie modułu analityki „frazy per kanał i częstotliwość w oknie".
- `idx_search_phrase_records_recent` na `(recorded_at desc)` — dla dashboardów ops.

Recorder jest fire-and-forget (`SearchPhraseRecorder.record(...)`):
wraca, gdy wiersz został zakolejkowany, nie gdy persystowany, i
połyka każdy wyjątek przez warn-log. Trasa przekazuje
promise bez await (`void recorder.record(...)`) i zwraca
`202 { ok: true }` natychmiast. Odpowiedź storefront nie jest
więc opóźniana ani psuta przez persystencję analityki.

Frazy poniżej progu (krótsze niż
`minimum_query_length` kanału) są cicho no-op'owane server-side jako
belt-and-braces przeciw bugowi UI zalewającemu tabelę stub
phrases.

## Indeksator + subscriber zdarzeń

`SearchIndexer` zapisuje jeden dokument na produkt w indeksie per-channel
o nazwie `products_<channel_code>`. Kształt dokumentu niesie powierzchnię
produktu katalogu (id, sku, name, description, type, status,
slug, primaryAssetUrl, categoryIds, categorySlugs, attributes,
searchableOptions, createdAt, updatedAt). Indeksator także ustawia
Meilisearch `searchableAttributes` + `filterableAttributes` z live flag
`product_attributes.is_searchable` + `is_filterable`, oraz
`sortableAttributes` z `SORTABLE_ATTRIBUTES` (zobacz *Sortowanie*).

**Dokument nie niesie ceny.** Kiedyś niósł jedną, skopiowaną z legacy
atrybutu katalogu `attributes.defaultPrice` — nie z żadnej listy cen —
i nie był czytany na ścieżce query, która rozwiązuje cenę viewer'a z
`price_lists` przy hydrate, więc indeks nie może decydować, ile płaci
kupujący. Cena per-kupujący nie może być zindeksowana
w żadnym przypadku: jeden indeks na sales channel i jeden dokument na produkt
oznacza, że wycenienie dokumentu pomnożyłoby korpus przez bazę klientów.
Legacy atrybut nadal jest indeksowany pod
`attributes.defaultPrice`, gdzie nazwa mówi, czym jest.

### Sortowanie

Meilisearch odmawia sortu na polu spoza
`sortableAttributes` indeksu, więc pola, po których ścieżka query może sortować,
deklarowane są raz, w `SORTABLE_ATTRIBUTES` (`search-indexer.ts`):
`createdAt` i `name`. Ta stała jest zarówno tym, co indeksator stosuje
do każdego indeksu kanału, jak i alfabetem, z którego `buildSort` może emitować — jego
typ zwracany jest z niej zbudowany, więc sort nazywający pole, którego indeksator
nigdy nie zadeklarował, nie kompiluje się.

Cztery sorty kontraktu listingu mapują się tak:

| `?sort=` | Meilisearch |
| --- | --- |
| `relevance` (or absent) | none — ranking rules silnika |
| `-createdAt` | `createdAt:desc` |
| `name` | `name:asc` |
| `-name` | `name:desc` |

Zindeksowane `name` jest rozwiązane w domyślnym języku kanału,
czyli języku, w którym renderuje się listing, więc kolejność widziana przez kupującego
to kolejność, po której posortowano.

**Upgrade indeksu zbudowanego przed zastosowaniem ustawień sortowania** wymaga reindex: ustawienia
nigdy nie były stosowane (`sortableAttributes` było `[]` na każdym
indeksie, a każdy posortowany listing był cicho odpowiadany przez Postgres
fallback), a `createdAt` nigdy nie było zapisywane w dokumencie. Pełny
reindex stosuje oba. Dzieje się automatycznie przy następnym okresowym
sweep w roli worker (`search.reindex_interval_minutes`, domyślnie
10); deployment bez sweep wymaga kroku operatora — akcji admin **Reindex products**
lub `pnpm --filter backend run
search:reindex`. Odświeżenie `attribute.updated.v1` ponownie stosuje
ustawienia, ale nie zapisuje dokumentów, więc przywraca sort `name`, a
nie `-createdAt`.

### `searchableOptions` — wyszukiwanie list opcji

Dla atrybutów z flagą `isSearchable` ORAZ select-style
`valueType` (`select`, `enum`, `multiselect`) indeksator rozwiązuje
etykietę opcji per-locale i dołącza ją do pola dokumentu
`searchableOptions: string[]`. Ustawienia Meilisearch zawierają
`searchableOptions` w `searchableAttributes`, więc klient szukający
renderowanego tekstu, który widzi (np. "Czerwony"), trafia produkty, których
surowa wartość to klucz opcji (np. "red"). Wyłączenie `isSearchable`
usuwa etykiety opcji z `searchableOptions` przy następnym refresh
w istniejącym event-driven cadence.

`SearchEventSubscriber` utrzymuje indeksy w sync:

| Event | Handler |
| --- | --- |
| `product.created.v1` | `indexer.upsertProduct(productId)` |
| `product.updated.v1` | `indexer.upsertProduct(productId)` |
| `product.archived.v1` | `indexer.deleteProduct(productId)` |
| `attribute.updated.v1` | `indexer.refreshAttributeSettings()` |
| `settings.value_changed` (when `settingCode === 'search.llm.enabled'`) | `indexer.attachEmbedderForChannel` / `detachEmbedderForChannel` |

Wszystkie handlery połykają własne błędy — przejściowa awaria Meilisearch
nie psuje ścieżki zapisu katalogu. Zarezerwowany fallback
na ścieżce read (`catalog/routes.public.ts`) utrzymuje wyszukiwanie storefront
funkcjonalne ze stale index, dopóki następny offline `search:reindex`.

### Gdy indeks nie odpowiada

Fallback pozostaje fallbackiem — publiczny katalog nie może 503
bo search jest nieszczęśliwy — ale rozróżnia dwa fakty, które kiedyś
były scalone w jeden:

- **unreachable** — silnik jest down, unroutable lub timeoutuje.
  Przejściowe. `catalog` loguje to per request i ponownie uruchamia listing
  przez Postgres; nic więcej od nikogo się nie oczekuje.
- **refused** — silnik odpowiedział w milisekundach, że nie uruchomi
  *tego* query: `invalid_search_sort`, `index_not_found`,
  odrzucony klucz API. Deterministyczne, samo nie minie, i defekt
  w konfiguracji indeksu przez ten moduł. String reason logowany przez callera
  nazywa własny kod błędu Meilisearch, a `search`
  raportuje go sam na poziomie `error` — raz na kod, bo ustawienie indeksu
  to fakt deploymentu, a publiczny listing inaczej raportowałby go przy każdym requeście.

To rozróżnienie jest całym powodem, dla którego defekt mógł przeżyć na pięciu
live indeksach: każdy posortowany listing fallbackował do Postgres, a
jedyny ślad to linia czytająca `meilisearch unavailable`
o silniku, który był up i healthy.

## Integracja storefront

Nagłówek strony (`storefront/components/Header.tsx`) renderuje
`<form action="/search" method="GET">` z progresywnie ulepszonym
komponentem klienckim `<SearchAutocomplete>` w środku:

- debounce 200 ms; AbortController anuluje stale fetch'e.
- Poniżej `minimum_query_length` kanału nie leci request.
- Model klawiatury: ArrowUp/Down do ruchu selekcji, Enter do nawigacji
  do wybranej sugestii, Escape do zamknięcia, klik poza do dismiss.
- 503 z `/search/suggest` pokazuje pozycję „search temporarily
  unavailable" w popup bez psucia statycznego formularza.
- Przy wyłączonym JS formularz post'uje `?q=…` do `/search` natywnie
  (JS nie jest wymagany do crawlability).

Strona `/search` (`storefront/app/(catalog)/search/page.tsx`)
re-eksportuje `CatalogPage` — listing, filtry, sort, paginacja
i empty state są identyczne jak `/catalog`. Jedyna specyficzna dla search
behaviour to fire-and-forget analityki: gdy `?q=` jest obecne,
strona await'uje `listProducts` (aby `resultCount` miał sens), potem
`void recordPhrase(...)` PRZED delegacją do `CatalogPage`.

## CLI reindex

`search reindex` przechodzi przez każdy Sales Channel i pcha jego publiczną
powierzchnię produktu do Meilisearch. Idempotentne — bezpieczne po
świeżym `endora demo seed` lub gdy indeks odbiega od Postgres.

To polecenie deklarowane w `manifest.ts` tego modułu i uruchamiane przez host,
więc reindexuje przez jeden `SearchIndexer`, który trzyma composition,
zamiast budować drugi:

```bash
pnpm --filter backend run search:reindex
# or, addressing the host binary directly:
pnpm --filter backend exec tsx src/cli.ts search reindex
```

Ciało to `packages/modules/search/src/backend/cli/reindex.ts`.

## Testowanie

- `backend/test/contract/search/public-suggest.contract.test.ts` (7 cases) — happy path, limit override, threshold, oversize, missing q, limit OOB.
- `backend/test/contract/search/public-record.contract.test.ts` (7 cases) — happy path, default `result_count`, channel pinning, empty/oversize/negative validation, below-threshold no-op.
- `backend/test/contract/search/admin-llm-toggle.contract.test.ts` (5 cases) — incomplete-config refusal (every embedder.* permutation), full-config success, disable always succeeds, unauthenticated → 401.
- `backend/test/integration/search/manifest-reconcile.test.ts` (2 cases) — group + 6 settings seeded with correct defaults; idempotent re-apply.
- `backend/test/integration/search/embedder-reactor.test.ts` (3 cases) — attach on enable=true, detach on flip-back-to-false, no event-fire when wrapper refuses the toggle.
- `backend/test/integration/search/event-subscriber.test.ts` (existing) — catalog-event-driven indexing.
- `backend/test/integration/search/catalog-via-meilisearch.test.ts` (existing) — env-flag-dispatched read path.
- `backend/test/integration/search/sort-order.test.ts` (6 cases) — each of the four sorts served by Meilisearch (`x-search-backend` is the load-bearing assertion: Postgres answers all four, so the order alone cannot tell a served page from a fallback), the declared `sortableAttributes`, and the absence of the indexed `price`.
- `backend/test/unit/search/search-sort-attributes.test.ts` (4 cases) — `buildSort` emits only fields `SORTABLE_ATTRIBUTES` declares.
- `backend/test/unit/search/search-degrade-observability.test.ts` (3 cases) — a refused query names the engine's error code and is reported once; an unreachable one is not reported twice.

Ostatnie dwa nie wymagają serwisów; reszta działa na real Postgres +
real Meilisearch.

## Punkty rozszerzenia

- **Custom rankers** — Meilisearch wspiera custom ranking rules per
  index; indeksator może pchać zestaw reguł, gdy Admin UI dostanie
  per-channel weighting affordance.
- **Embedder-source enum** — `search.llm.embedder_source` z wartościami
  `openAi | huggingFace | rest | userProvided` pozwoliłby pojedynczemu
  kanałowi wybrać providera niekompatybilnego z OpenAI bez zmiany nazw trzech
  ustawień credential.
- **Zarezerwowany fallback** — już zaimplementowany: gdy Meilisearch jest
  niedostępny, ścieżka read katalogu degraduje do Postgres ILIKE
  search przez `catalog-query.service.ts`, aby storefront nigdy nie był
  w pełni zepsuty.
