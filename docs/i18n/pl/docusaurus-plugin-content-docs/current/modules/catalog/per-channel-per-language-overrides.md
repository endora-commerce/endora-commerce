---
title: Nadpisania per kanał i język
---

# Nadpisania per kanał i język

Catalog stosuje **cztero-scope'owy model wartości** dla wartości atrybutów
produktu. Ten sam klucz atrybutu może trzymać do czterech adresowalnych slotów
na produkt:

- `global` — jedna wartość we wszystkich Sales Channel i wszystkich językach;
- `language` — jedna wartość per język (np. systemowe Name, Description);
- `channel` — jedna wartość per Sales Channel, do którego produkt jest przypisany;
- `channel+language` — jedna wartość per para `(channel, language)`.

Które sloty są adresowalne dla danego atrybutu regulują dwie flagi na definicji
atrybutu, `channelScoped` i `languageScoped`. Systemowe atrybuty `name` i
`description` są przypięte channel-scoped + language-scoped przez stałą backend
(`SYSTEM_ATTRIBUTE_SCOPES`). Atrybuty zdefiniowane przez użytkownika domyślnie
są tylko globalne i opt-in przez edytor atrybutów.

## Po co

Katalog B2B rutynowo potrzebuje nakładać kanałowo-specyficzny copy marketingowy
(wholesale vs. retail) i tłumaczenia językowe na ten sam produkt. Legacy storage —
JSONB na `products.name` / `products.description` + płaski
`products.attribute_values` JSONB — wyrażał tylko wymiar językowy. Model
czterech scope'ów podnosi ten sufit bez przepisywania baseline storage; dodaje
siostrzeczną tabelę overrides trzymającą sloty channel-aware i jedną funkcję
resolver łączącą oba przy odczycie.

## Kształt magazynowania

Globalny baseline nadal żyje tam, gdzie zawsze:

- `products.name` (`Record<lang, string>` JSONB) — language-scoped.
- `products.description` (`Record<lang, string>` JSONB) — language-scoped.
- `products.attribute_values` (`Record<key, value>` JSONB) — global domyślnie.
  Gdy flaga `languageScoped` atrybutu to `true`, wewnętrzna wartość sama jest
  kluczowana językiem: `Record<key, Record<lang, value>>`.

Sloty channel-aware lądują w nowej tabeli:

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

Krotka (product, attribute, channel, language) jest unikalna pod
**dwoma partial indexami**:

```sql
create unique index "product_value_overrides_channel_only_uniq"
  on "product_value_overrides" ("product_id", "attribute_key", "channel_id")
  where "language_code" is null;

create unique index "product_value_overrides_channel_lang_uniq"
  on "product_value_overrides" ("product_id", "attribute_key", "channel_id", "language_code")
  where "language_code" is not null;
```

PostgreSQL traktuje `NULL` jako distinct w zwykłym UNIQUE constraint, więc
jedyny poprawny sposób modelowania „(channel, NULL) i (channel, NULL) to ten
sam wiersz” to dwa partial indexy — jeden na każdą semantykę NULL.

Ścieżka lookup używana przez resolver w ciasnych pętlach to zwykły btree:

```sql
create index "product_value_overrides_product_attr_idx"
  on "product_value_overrides" ("product_id", "attribute_key");
```

Druga tabela — `product_editor_preferences` — przechowuje per-(admin
user, product) ostatnio wybrane `(channelId, languageCode)`, żeby strona edycji
produktu seedowała przełączniki z poprzedniej wizyty edytora.
Nie ma FK do `sales_channels`, więc usunięty / odpięty kanał jest cicho
tolerowany przy odczycie.

## Resolver

Jedno źródło prawdy dla „jaką wartość pokazać?” żyje w
`packages/contracts/src/product-value-resolver.ts`. Ten sam plik TypeScript
jest importowany przez backend (endpointy admin, ścieżka odczytu storefront,
indeksator wyszukiwania) i admin SPA. Z definicji podgląd effective-value
admina nie może odjechać od tego, co renderuje storefront.

Algorytm — `resolveAttribute({ baseline, overrides, scope, ctx })`
— przechodzi cztery kroki:

1. slot `(channel + language)` — gdy atrybut jest channel-scoped
   AND language-scoped AND kontekst niesie oba;
2. slot `(channel-only)` — gdy channel-scoped AND kanał jest w kontekście;
3. baseline `(global + language)` — dla language-scoped atrybutów
   wybierz żądany język z JSONB;
4. baseline `(global)` — pojedyncza wartość (lub pick języka primary dla
   language-scoped attrs).

Pierwszy niepusty slot wygrywa. Pusty string, `null`, pusty obiekt,
pusta tablica są traktowane jako „brak” i przechodzą dalej. Funkcja
zwraca zarówno rozwiązaną wartość, JAK I tag `source` wskazujący, który
slot dał odpowiedź — admin UI konsumuje to, żeby renderować badge
„channel + language override” / „global baseline” per pole.

### Tolerancja osieroconych

Administrator może przełączyć flagę `channelScoped` atrybutu z powrotem na
`false` po tym, jak channel overrides zostały już zapisane. Resolver po prostu
pomija wiersze override, których atrybut nie jest już channel-scoped, więc
storefront wraca do baseline bez utraty danych. Przyszły maintenance pass może
usunąć osierocone wiersze; ten feature tego nie wymaga.

## Ścieżka zapisu

Channel-aware overrides lądują przez jeden endpoint admin:

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

Wszystkie żądane operacje działają w jednym przebiegu `em.transactional`.
Handler waliduje każdy wpis z góry wobec sześciu reguł i
cofa wszystko przy pierwszej porażce:

| 422 code                            | Triggered when |
| ----------------------------------- | -------------- |
| `attribute_unknown`                 | `attributeKey` nie jest ani atrybutem systemowym (`name`, `description`), ani wierszem w `product_attributes`. |
| `attribute_not_channel_scoped`      | `channelScoped=false` atrybutu, więc nie ma slotu channel. |
| `attribute_missing_language`        | `languageScoped=true` atrybutu, ale slot ma `languageCode=null`. |
| `channel_not_assigned_to_product`   | `channelId` nie jest w `sales_channel_products` dla produktu. |
| `language_not_in_channel`           | `languageCode` jest non-null i nie jest w tablicy `SalesChannel.languages` kanału. |
| `value_invalid`                     | opakowane `value.v` nie pasuje do `valueType` atrybutu. |

Baseline write path (Name / Description per język; global
`attribute_values`) jest bez zmian — edytorzy nadal używają istniejących
inputów locale obok siebie na zakładce Details. Channel overrides są addytywne.

## Ścieżki odczytu

Trzech konsumentów przechodzi przez resolver:

- **Endpoint admin** — `GET /api/v1/admin/catalog/products/:id?channelId=&languageCode=&includeOverridesMap=true`
  zwraca baseline produktu PLUS, gdy przekazano parametry kontekstu, blok
  `resolved` z `name`, `description`, `attributeValues`,
  `sources`. Gdy `includeOverridesMap=true`, pełna lista override jest
  dołączona dla podglądów przełączników po stronie klienta.
- **Publiczny odczyt storefront** — bierze kanał z nagłówka
  `x-sales-channel` (istniejąca konwencja) i język z
  `Accept-Language`. Warstwa override jest niewidoczna dla klienta publicznego.
- **Indeksator wyszukiwania (Meilisearch)** — buduje jeden dokument per
  para `(product, channel)`. Pola `name` i `description` każdego dokumentu
  przechodzą przez resolver z `channel.defaultLanguage`
  jako aktywnym językiem, więc per-channel overrides trafiają do
  rankingu wyszukiwania storefront.

## Admin UI

Zakładka **Details** strony edycji produktu dostaje panel
`<ProductScopeEditor>` nad istniejącymi inputami locale. On:

1. Ładuje równolegle `GET /scope-context` (kanały przypisane do produktu +
   języki każdego kanału + primary admin language platformy +
   zapamiętaną preferencję edytora) i `GET /value-overrides`.
2. Renderuje przełącznik Sales Channel (Global + każdy przypisany kanał)
   i przełącznik Language zawężony do języków aktywnego kanału
   (lub unii wszystkich języków kanałów przy Global).
3. Pokazuje rozwiązane Name + Description dla aktywnego kontekstu z badge
   źródła per pole — `channel + language override` / `channel
   override` / `global baseline (language)` / `global baseline
   (fallback)` / `no value`.
4. Oferuje affordance „Add override” / „Edit override” / „Reset to Global”
   per pole. Edycje idą przez `PATCH /value-overrides`
   z optymistycznym odświeżeniem.
5. Persistuje wybór edytora `(channel, language)` przez
   `PUT /editor-preference` (debounced, best-effort), żeby następna wizyta
   seedowała ten sam kontekst.

Affordance edycji są gated na wybrany konkretny kanał.
Pod Global / bez kanału panel jest read-only, a help string wyjaśnia,
że overrides działają tylko per-channel.

## Migracja

Jedna migracja `043_product_value_overrides_init.ts` dostarcza wszystko:

- dodaje kolumny boolean `channel_scoped` + `language_scoped` do
  `product_attributes` (default `false`);
- tworzy `product_value_overrides` z dwoma partial UNIQUE
  indexami i btree `(product_id, attribute_key)`;
- tworzy `product_editor_preferences` (composite PK
  `(admin_user_id, product_id)`).

Brak migracji danych baseline. Brak backfillu. `down()` to
dokładna inwersja — drop dwóch tabel i dwóch kolumn.

## Czego nie ma w scope

- **Overrides atrybutów zdefiniowanych przez użytkownika w admin UI** — panel
  pokazuje dziś tylko systemowe Name + Description. Overrides atrybutów
  użytkownika są akceptowane przez endpoint PATCH i rozwiązywane przy odczycie,
  ale admin SPA nie eksponuje jeszcze affordance zapisu dla nich.
- **Zmiana kształtu publicznego odczytu storefront** — `products.name` i
  `products.description` nadal wysyłają się jako `Record<lang, string>` JSONB
  na publicznym endpoincie katalogu. Przejście na rozwiązany scalar to
  breaking change dla konsumentów storefront i jest follow-upem.
- **Enqueue reindex channel-aware** — endpoint PATCH nie
  enqueue'uje jeszcze joba reindex Meilisearch per dotknięty kanał; następny
  upsert per produkt (napędzany dowolną mutacją katalogu) to podniesie.
  Dedykowany reindex przy zapisie override to mały follow-up.
