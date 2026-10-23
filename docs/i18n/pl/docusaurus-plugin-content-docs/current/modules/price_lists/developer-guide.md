---
title: Ceny dla programistów
sidebar_label: Ceny dla programistów
sidebar_position: 2
description: Jak cenniki są przechowywane i wyceniane, zbiorcza usługa wyceny, przez którą czyta każdy konsument, pamięć podręczna, powierzchnia cen stojąca za sortowaniem według ceny, API administracyjne, porty i konwersja ze starego modelu.
---

# Ceny dla programistów

Jak moduł `price_lists` przechowuje i wylicza ceny oraz na czym może polegać inny moduł — albo moduł
nakładkowy (overlay). Co reguły oznaczają dla operatora, opisano na
[głównej stronie modułu](../price_lists.md); ekrany panelu administracyjnego — na stronie
[Edytor cenników](./price-book-editor.md).

Normatywne dokumenty projektowe są w repozytorium: zapis decyzji o modelu
(`specs/pricing/decision-record.md`), jego wektory testowe (`specs/pricing/worked-examples.md`),
bieżący stan kodu (`specs/pricing/current-model.md`), każda ścieżka odczytu z jej zmierzonym kosztem
(`specs/pricing/read-paths-and-performance.md`) oraz zasady pracy przy każdej zmianie dotyczącej ceny
(`specs/conventions/pricing.md`).

## Gdzie jest kod

Ścieżki są względne wobec pakietu tego modułu, `@endora-commerce/mod-price-lists`, chyba że wskazują inny pakiet.

| Obszar | Ścieżka |
| --- | --- |
| Kształty (Zod) — cenniki, wiersze, wyjaśnienie, kolejność, ceny bazowe, port zapisu | `packages/contracts/src/price-books.ts` |
| Kształty — cena na liście, cena pozycji, publikowane porty wyceny | `packages/contracts/src/price-lists.ts` |
| Funkcje dziesiętne wspólne dla serwera i podglądów w panelu | `packages/contracts/src/price-book-decimal.ts` |
| Czysty, trzystopniowy algorytm wyceny | `src/backend/services/book-resolver.ts` |
| Ustawienia kolejności, niezmienniki, tabela rang | `src/backend/services/precedence.ts` |
| Wczytanie partii (cenniki, wiersze, dane katalogu) i mapowanie wyników | `src/backend/services/book-pricing.ts` |
| Profile cenowe | `src/backend/services/pricing-profile.ts` |
| Usługa wyceny — zbiorcze punkty wejścia | `src/backend/services/pricing-service.ts` (kontrakt: `pricing-service.interface.ts`) |
| Zapisy przez Command Bus | `src/backend/services/price-book-service.ts`, `price-book-batch.ts`, `price-book-rules.ts` |
| Odczyty panelu (lista, wiersze, linie, etykiety) | `src/backend/services/price-book-reads.ts` |
| Zakres handlowca | `src/backend/services/price-book-scope.ts` |
| Pamięć podręczna i unieważnianie między procesami | `src/backend/services/pricing-cache.ts`, `pricing-generation.ts` |
| Powierzchnia cen i jej worker | `src/backend/services/price-surface.ts`, `workers/price-surface-worker.ts` |
| API administracyjne | `src/backend/routes.price-books.ts`; tryby prezentacji w `routes.ts` |
| API storefrontu | `src/backend/routes.storefront.ts` |
| Kompozycja — porty, worker, subskrypcje, powiązanie z kanałami | `src/backend/index.ts` |
| Ekrany panelu | `src/admin/`; komponent edytowalnej siatki w `packages/admin-kit/src/components/editable-grid/` |
| Cenniki demonstracyjne (E1–E3) | `src/backend/demo/` |

## Model danych

Właścicielem każdej tabeli jest `price_lists`, chyba że podano inaczej. Cennik w obecnym kształcie to
rozwinięcie dawnego cennika, dlatego tabele zachowały stare nazwy.

| Tabela | Zawiera |
| --- | --- |
| `price_lists` | Nagłówek cennika: `name`, `type` (`regular`, `sale`), `status` (`draft`, `scheduled`, `active`, `expired`), `starts_at`, `ends_at`, `currency_code` (niezmienne), `audience_kind` (`everyone`, `customer_groups`, `organizations`; niezmienne od `ever_activated`), `priority`, `is_system` (prawda tylko dla cenników cen bazowych; unikalne dla waluty), `version` (zmienia się przy każdym zapisie cennika). |
| `sales_channel_price_lists` | Zbiór kanałów — zarejestrowane powiązanie z kanałami sprzedaży (typ encji `price-list`), czytane i zapisywane wyłącznie przez `SalesChannelMembershipService` (zasada XII). Powiązanie, którego kanał przestaje oferować walutę, zostaje i jest *uśpione*. Cenniki cen bazowych nie mają powiązań. |
| `price_list_audience_members` | Zbiór odbiorców: `organization_id` albo `customer_group_id`, dokładnie jedno w wierszu, wszystkie rodzaju z nagłówka; klucze obce kasują wiersz przy trwałym usunięciu. |
| `price_list_matrix_entries` | Wiersze: wybór (`variant_id` z jego `product_id`; `product_id`; `category_id`; `attribute_key` + `attribute_value`; kategoria ∩ atrybut; albo nic = wszystkie produkty), `min_quantity`, `max_quantity`, `price_type` (`fixed`, `percent`, `amount`) z `amount` (numeric 14,4) albo `percent` (numeric 7,2 ze znakiem). |
| `price_list_product_lines` | Jeden wiersz na produkt mający wiersz w cenniku — stronicowanie siatki według linii. |
| `price_list_precedence` | Wersjonowana kolejność: dwanaście kodów komórek, `category_before_attribute`, `depth_mode`, `state`. Wersja 1 = HY jest instalowana jako aktywna; ścieżki zapisu jeszcze nie ma. |
| `price_profiles`, `price_profile_prices` | Powierzchnia cen (niżej). |
| `price_display_mode_overrides` | Tryby prezentacji dla organizacji, kategorii i produktu. |
| `cart_items.price_source` (`carts`), `order_items.price_source` (`orders`) | Który krok wycenił pozycję: `agreed`, `base`, `catalogue`, `buyer`, `sale`; `null` dla pozycji wycenionej przed tym wydaniem. |

Produkt nie ma własnej ceny: cena produktu to jego wiersze w cenniku cen bazowych każdej waluty. Pola
katalogu usunięte przez to wydanie wymieniono niżej, w sekcji *Aktualizacja ze starego modelu*.

Zasady zapisu (`price-book-rules.ts`, `price-book-batch.ts`): żadne dwa wiersze jednego cennika z tym
samym wyborem nie mogą mieć nachodzących na siebie zakresów ilości; cena stała wymaga wyboru innego
niż *wszystkie*; wiersz atrybutu tylko dla atrybutu z `isPriceRule` typu wyboru albo logicznego,
niezależnego od języka i kanału (sprawdzane ponownie przy wycenie, więc atrybut, który przestaje się
kwalifikować, po cichu przestaje wyceniać); cennik cen bazowych zawiera tylko wiersze produktów
(stałe) i wariantów (stałe, procentowe, kwotowe); najwyżej `PRICE_BOOK_MAX_ROWS` (5 000) wierszy na
cennik inny niż cennik cen bazowych i na partię.

## Wycena

### Dane wejściowe

Wycena wskazuje produkt (`id`, `attributeValues`), opcjonalny wariant, ilość, kanał sprzedaży (`id`,
`defaultCurrency`), opcjonalną walutę (domyślnie walutę kanału) i kupującego: organizację oraz — dla
zalogowanego klienta — `customerAccountId`. **Wywołujący wskazuje kupującego; nie wylicza grupy.**
Mechanizm stosuje wszędzie jedną regułę (`customer-group-rule.ts`, `effectiveCustomerGroupId`): jawne
`customerGroupId`, w przeciwnym razie własna grupa konta klienta, gdy konto należy do organizacji, a w
przeciwnym razie grupa organizacji. Łańcuch organizacji (od najbliższej) pochodzi z
`organizationInheritancePort.priceListOrgChain` modułu `organizations`.

Waluta, której kanał nie oferuje, niczego nie wycenia, także cen bazowych — zabezpieczenie odmawia w
razie wątpliwości i nigdy nie przelicza walut.

### Cenniki, które biorą udział

Jedno zapytanie wczytuje cenniki, które partia może napotkać (`book-pricing.ts`): cennik cen bazowych
waluty oraz każdy cennik niesystemowy ze `status in ('active', 'scheduled')`,
`starts_at <= now() < ends_at` (sprawdzane w zapytaniu, więc harmonogram działa dokładnie w swojej
chwili, a nie przy następnej aktualizacji statusów), w tej walucie, powiązany z kanałem przez
dozwolone podzapytanie powiązania (`entityIdsInChannelSubquery`), gdy kanał oferuje walutę, i którego
odbiorcami są wszyscy albo członek łańcucha kupującego lub jego efektywna grupa. **Identyfikator
cennika nigdy nie pochodzi od klienta** — ta klauzula `where` jest zabezpieczeniem izolacji
(zasada XI).

### Algorytm

`createBookResolver` (`book-resolver.ts`) jest czysty: czyta tylko to, co wczytała partia.

```text
1. BASE       the base book's variant row covering q (fixed, or a percent/amount
              of the product's base at q), else the product's fixed row      → b
2. CATALOGUE  best row of the regular *everyone* books, ranked by selection kind
              (variant > product > category ∩ attribute > category > attribute > all,
              category/attribute per the toggle); percent/amount off b        → C, else b
3. BUYER      best row of the regular organization-set and group-set books,
              ranked by the precedence's rank table; percent/amount off C     → R, else C
4. SALE       best row of the sale books — buyer cells by the rank table, then
              everyone rows by selection kind; percent/amount off C           → S
5. CHARGE     S when S < R (R becomes compareAt), else R; nothing → unpriced
```

W obrębie kroku klucz porządku jest pełny i leksykograficzny: **ranga komórki → głębokość w łańcuchu
→ priorytet (malejąco) → ilość początkowa (malejąco) → wynikowa kwota (rosnąco) → id cennika → id
wiersza**. Przy ustawieniu AF-N głębokość wyprzedza komórkę dla komórek organizacji. Wiersz, któremu
brakuje odniesienia (procent bez ceny bazowej), albo którego wynik jest poniżej zera, nie wycenia, a
sprawdzany jest następny kandydat; zero jest ceną. Wiersz produktu pasuje do każdego wariantu
produktu; linia wariantu dopasowuje wiersze atrybutów po wartościach produktu nałożonych przez
wartości osi wariantu; wiersz kategorii pasuje do własnych przypisań produktu do kategorii. Procenty
są stosowane z zaokrągleniem połówkowym w górę do czterech miejsc po przecinku, w arytmetyce
całkowitej (`matrix-decimal.ts`). Gdy żaden krok regularny nie wycenia pozycji, ale wycenia ją stały
wiersz promocyjny, naliczana jest cena promocyjna bez ceny porównawczej.

### Kolejność cen i jej tabela rang

**Komórka** to odbiorcy × rodzaj wyboru — `org.variant`, `org.product`, `org.category_attribute`,
`org.category`, `org.attribute`, `org.all` oraz sześć komórek `group.*` (`PRICE_BOOK_CELL_CODES`).
Aktywna wersja `price_list_precedence` porządkuje te dwanaście; `buildRankTable` zamienia porządek na
rangę każdej komórki, pierwszy składnik klucza porządku. `validatePrecedence` pilnuje niezmienników: w
obrębie jednych odbiorców porządek wyboru jest stały (I1); `org.<rodzaj>` przed `group.<rodzaj>` (I2);
przełącznik kategorii/atrybutu jest wszędzie taki sam (I3); głębokość „najpierw najbliższa
organizacja” tylko z porządkiem AF (I5). Te niezmienniki spełnia dokładnie 266 konfiguracji, a
`precedence.test.ts` sprawdza wszystkie.

| Ustawienie | Porządek | Głębokość |
| --- | --- | --- |
| **HY** (instalowane jako wersja 1) | `org.variant`…`org.attribute`, `group.variant`…`group.attribute`, `org.all`, `group.all` | w obrębie komórki |
| AF | sześć komórek `org.*`, potem sześć komórek `group.*` | w obrębie komórki |
| SF | `org.variant`, `group.variant`, `org.product`, `group.product`, … | w obrębie komórki |
| AF-N | jak AF | najpierw najbliższa organizacja |

`PrecedenceStore` czyta aktywną wersję raz na generację cen i odmawia wyceny z brakującej albo
nieprawidłowej wersji, zamiast po cichu przyjąć zastępczą. `GET /api/v1/admin/price-books/precedence`
ją zwraca; każdy zapis pod `…/precedence` odpowiada `409 PRECEDENCE_CHANGE_UNAVAILABLE`, dopóki nie
powstanie proces zmiany.

### Wyjaśnienie

Każda wycena niesie swoje wyjaśnienie (`BookExplanation`): krok, komórkę, cennik i wiersz, użytą cenę
odniesienia, wersję kolejności i do dziesięciu uszeregowanych kandydatów kroku, który zdecydował. Jest
wewnętrzne dla kontraktu modułu; publikuje je `POST /api/v1/admin/price-books/resolve`.

## Jedyna ścieżka odczytu

**Konsument wycenia partiami, przez usługę wyceny.** Punkty wejścia (`PricingServiceContract`,
`pricing-service.interface.ts`) kosztują stałą liczbę zapytań niezależnie od liczby produktów lub
pozycji — cenniki, które biorą udział, ich wiersze dla partii, wiersze bazowe oraz dane katalogu
(kategorie, warianty z wartościami osi, kwalifikujące się atrybuty) przez porty modułu `catalog`, po
jednym wywołaniu i tylko wtedy, gdy potrzebuje ich któryś wiersz:

| Metoda | Do czego | Zwraca |
| --- | --- | --- |
| `resolveListingPrices` | lista przy ilości 1; produkty z wariantami są wyceniane w zakresie swoich wariantów | `Map<productId, ListingPrice>` — `{ source: 'price_list', amount, currency, priceListId, isSale, priceSource, compareAtAmount?, variesByVariant?, maxAmount? }` albo `{ source: 'none' }` |
| `resolveListingPriceDetails` | powierzchnia, która pokazuje podział (strona produktu, karty na stronie głównej, podpowiedzi wyszukiwania) | `ListingPriceDetail` — cena na liście, `basePrice` (cena regularna), `salePrice`, `displayMode`, `tiers { base, catalogue, buyer, sale }` i `listPrice`, gdy jest pokazywana |
| `resolveLinePrices` | wiele pozycji, każda przy własnej ilości i wariancie (koszyk, kontrola przy składaniu zamówienia, ceny referencyjne zapytań, podgląd zamówienia w panelu, zewnętrzne przyjmowanie zamówień, feedy, zewnętrzne API katalogu) | `Map<key, PricingLineResult \| null>` — `amount`, `currency`, `priceListId`, `isSale`, `source`, `compareAt`, `bracketStartQuantity` (ilość początkowa wiersza, który wycenił pozycję), `displayMode` |
| `resolveEngine`, `resolveLinePrice` | jeden produkt albo pozycja | nakładki na partię jednoelementową; nigdy nie wywołuj ich w pętli |
| `orderByUnitPrice`, `pricedProductIds`, `pageDisplayMode` | sortowanie i zakres cen (`ListingPriceOrderPort`) | obsługiwane z powierzchni cen |
| `namedListPrices` | feed przypięty do jednego cennika | własne wiersze tego cennika (na poziomie produktu), liczone od ceny katalogowej kanału, przy ilości 1; produktów, których cennik nie wycenia, nie ma w odpowiedzi |
| `listTierStarts` | drabina progów | ilości początkowe wierszy i progów bazowych, które mogą dotyczyć `(product, variant?, currency)` |

Konsumenci rozwiązują wpis kontenera `pricingService` przez jego opublikowany wycinek z
`@endora-commerce/contracts` — `ListingPricePort`, `ListingPriceDetailPort`, `LinePricesPort`,
`ListingPriceOrderPort`, `OrgLinePricePort` — za pomocą `lazyPort`, więc brak właściciela kończy się
odmową `MODULE_DISABLED` przy wywołaniu, a nie odpowiedzią nieaktualnej instancji. Kto co czyta:

| Konsument | Punkt wejścia |
| --- | --- |
| `catalog` — listy, strona produktu, produkty powiązane, karty na stronie głównej | `resolveListingPrices` / `resolveListingPriceDetails`; odpowiedź niosą `ProductSummary.price` i `ProductSummary.resolvedPrice` |
| `catalog` — sortowanie i zakres cen (`?sort=price`, `?sort=-price`, `minPrice`, `maxPrice`) | `orderByUnitPrice`, `pricedProductIds` |
| `catalog` — zewnętrzne API katalogu | `resolveLinePrices`; drabina progów przez `listTierStarts` |
| `search` — wyniki i podpowiedzi | `resolveListingPriceDetails` (indeks Meilisearch nie zawiera ceny) |
| `comparisons` | `resolveListingPrices` |
| `carts` — dodanie, łączenie, zmiana ilości, odczyt, kontrola przy składaniu zamówienia | `resolveLinePrices` wewnątrz `CartLinePricing.orderablePrices` |
| `orders` — składanie zamówienia, podgląd w panelu, zewnętrzne przyjmowanie | składanie kopiuje cenę pozycji koszyka i `price_source`; podgląd i przyjmowanie wywołują `resolveLinePrices` |
| `quote_requests` — ceny referencyjne | `BuyerLinePricePort.resolveForBuyer` (kontener `buyerLinePricePort`) |
| `product_feeds` | `resolveLinePrices` jako gość; `namedListPrices` dla feedu przypiętego do cennika |
| `organizations` — cenniki obowiązujące organizację | `PriceListReadPort.listForOrganization` (kontener `priceListReadPort`) |
| `carts` — odmowa dla produktu sprzedawanego wyłącznie na zapytanie | `ProductDisplayModePort` (kontener `productDisplayModePort`) |

`backend/test/integration/price_lists/pricing-surfaces-agree.test.ts` pilnuje, by każdy z nich
zwracał tę samą kwotę, walutę i źródło dla każdego kupującego z danych testowych, a testy tożsamości
`listing-prices-batch.test.ts` (partia = pojedyncze wywołanie), `line-prices-batch.test.ts` (partia =
jedno `resolveLinePrice` na klucz) i `price-surface-identity.test.ts` (porządek sortowania = ceny na
kartach) utrzymują ścieżki w zgodzie. Nowa ścieżka wyceny wymaga takiego samego testu tożsamości.

**Dekorowanie usługi wyceny z modułu nakładkowego.** Wdrożenie nadpisuje wycenę z własnego modułu
nakładkowego przez `ctx.di.decorate('pricingService', …)`. Dekoruj `resolveLinePrices` i
`resolveListingPrices` tak samo jak pojedyncze wywołania: koszyk, kontrola przy składaniu
zamówienia, ceny referencyjne zapytań i zewnętrzne API wyceniają partiami, więc nakładka tylko na
pojedyncze wywołanie zostawia je na rdzeniu. Wzorcem jest
`backend/src/apps/example/modules/example_overlay/backend.ts`.

## Pamięć podręczna i unieważnianie

- **W procesie**: `PricingCache`, LRU na 5 000 wpisów z TTL 60 s (`DEFAULT_PRICING_CACHE_TTL_MS`), z
  kluczem: profil cenowy, produkt, wariant i ilość; oraz zapamiętany profil dla łańcucha organizacji,
  grupy, kanału, waluty i wersji kolejności. Środowisko testowe ustawia TTL na 0.
- **Po zatwierdzeniu, wszędzie**: każdy audytowany zapis cennika przechodzi przez `CommandBus.run`, a
  po jego zatwierdzeniu `PricingGeneration.bump()` czyści warstwy tego procesu i publikuje
  komunikat na kanale Redis `b2b:price_lists:pricing-generation`; każdy proces API i workera
  subskrybuje go przy starcie i czyści własne warstwy. Podbicie oznacza też powierzchnię cen jako
  nieaktualną i prosi workera o przebudowę. Publikowanie działa w miarę możliwości: gdy komunikat
  przepadnie, nieaktualność w innym procesie ogranicza TTL 60 s.
- **Co podbija generację**: każdy zapis cennika (nagłówek, kanały, odbiorcy, wiersze, aktywacja,
  duplikat, usunięcie, ceny bazowe), aktualizacja statusów, która zmienia stan cennika, oraz zdarzenia
  katalogu i kanałów, które ten moduł subskrybuje — `product.created.v1`, `product.updated.v1`,
  `product.archived.v1`, `product.deleted.v1`, `category.updated.v1`, `attribute.updated.v1`,
  `sales_channels.identity_changed`, `sales_channels.lifecycle_changed`.

## Powierzchnia cen — sortowanie i zakres cen

Ceny dla konkretnego kupującego nie da się zindeksować w Meilisearch, a wycenianie całego katalogu
przy każdym żądaniu jest zbyt wolne, więc sortowanie według ceny i filtrowanie zakresem cen czytają
wstępnie wyliczoną **powierzchnię cen**.

- **Profil cenowy** (`price_profiles`) to kanał, waluta, wersja kolejności i posortowany wektor
  cenników dla kupujących, które obowiązują — `(cennik, rodzaj odbiorców, głębokość w łańcuchu)`.
  Kupujący z tymi samymi obowiązującymi cennikami współdzielą profil; goście i kupujący bez cennika
  dla kupującego współdzielą profil *dla wszystkich*.
- `price_profile_prices` przechowuje dla każdego profilu i generacji cenę każdego produktu przy
  ilości 1 (dla produktu z wariantami — najniższą cenę wariantu), najwyższą, cenę porównawczą i krok
  źródłowy. Profil dla wszystkich zawiera każdy wyceniony produkt; profil kupującego — tylko produkty,
  których odpowiedź się różni. Każdy wiersz jest wyliczany tym samym zbiorczym algorytmem, którego
  używają karty.
- Strona kupującego to **scalenie dwóch strumieni**: wiersze profilu kupującego, potem wiersze
  profilu dla wszystkich bez produktów, które ma pierwszy strumień — dwa strumienie w porządku
  indeksu niezależnie od liczby cenników.
- **Żadne żądanie nie buduje powierzchni.** Zapis oznacza profile jako nieaktualne; nieaktualny profil
  nadal podaje poprzednią generację, dopóki worker nie podmieni przebudowanej w jednej transakcji.
  Profil nigdy niezbudowany jest rejestrowany, jego budowa jest zlecana, a żądanie dostaje odpowiedź
  od razu: zawężenie do najwyżej 5 000 produktów (kategoria, wynik wyszukiwania) jest porządkowane na
  podstawie bieżącej wyceny, strona bez zawężenia — z powierzchni dla wszystkich (przybliżenie), a
  gdy nie ma żadnej powierzchni, fragment jest `unordered` i katalog podaje swój domyślny porządek.
  Ceny na kartach są zawsze wyliczane na bieżąco, więc opóźniać się może tylko porządek.
- **Worker** obsługuje kolejkę BullMQ `price_lists.surface` (jedno scalone zadanie, trzy próby z
  wykładniczo rosnącym odstępem), jest podłączony przez `ctx.worker`, więc zatrzymuje się razem z
  modułem, i działa tylko w procesie, który obsługuje kolejki (`BACKEND_ROLE` nieustawione, `all`
  albo `worker`), mającym połączenie Redis dla kolejek. Najpierw buduje profile nigdy niezbudowane,
  potem nieaktualne (profil dla wszystkich przed profilami kupujących). Bez działającego workera
  powierzchnia nigdy nie powstaje, a strony sortowane według ceny korzystają z opisanych wyżej
  rozwiązań zastępczych.

Zmierzone z `PERF_RUN=true` w `backend/test/perf/price_lists/price-surface.bench.ts` (50 000
produktów, 1 000 organizacji): wyniki są w `specs/pricing/read-paths-and-performance.md` §7.

## Aktualizacja statusów

`PriceListStatusWorker.sweep()` działa co pięć minut w procesie API (interwał w procesie, pomijany,
gdy modułu nie ma) i zmienia **stan** cennika — `scheduled → active` w chwili początku,
`active → expired` w chwili końca — na potrzeby widoku w panelu. Nie decyduje o żadnej cenie:
obowiązywanie jest sprawdzane w chwili żądania. Aktualizacja, która zmienia stan cennika, podbija
generację cen. Punktem wywołania dla testów jest `POST /api/v1/admin/price-books/internal/sweep`.

## API administracyjne

Ścieżka bazowa `/api/v1/admin/price-books`. Odczyty wymagają `price_lists:read`, zapisy —
`price_lists:write`. Schematy są w `packages/contracts/src/price-books.ts`. Każdy zapis to jedno
`CommandBus.run` z jednym wpisem audytu na `objectType: 'price_list'`, zawierającym stan przed zmianą
i po niej; audytowane akcje to `price_list.create`, `update`, `channels_replace`, `activate`,
`draftify`, `expire`, `duplicate`, `delete`, `rows_replace`, `base_prices_set` i
`show_list_price_set`.

| Metoda i ścieżka | Do czego służy |
| --- | --- |
| `GET /` | Lista cenników: `type`, `status`, `currency`, `channelId`, `audienceKind`, `memberId`, `search`, `page`, `pageSize`; z `productId` (i `variantId`) tylko cenniki z wierszem wskazującym go bezpośrednio, każdy z `matches`. `meta.creatableAudienceKinds` mówi, jakiego rodzaju cenniki wywołujący może tworzyć. |
| `POST /` | Utworzenie szkicu: `name`, `type`, `currencyCode`, `channelIds`, `audience { kind, memberIds }`, `priority`, `startsAt`, `endsAt`. |
| `GET /:id` | Jeden cennik: nagłówek, `channels[]` z `dormant`, odbiorcy, `version`, `everActivated`, `rowCount`, `tierStarts`, `writable`. |
| `PATCH /:id` | Nazwa, priorytet, daty, kanały, odbiorcy — z `expectedVersion` w treści albo nagłówkiem `If-Match`. Nie waluta ani typ; rodzaj odbiorców tylko przed pierwszą aktywacją; nic w cenniku cen bazowych. |
| `POST /:id/activate`, `POST /:id/draftify` | Zmiany stanu. |
| `POST /:id/duplicate` | `name`, `channelIds`, `currencyCode`, `audience`, `amountMultiplier` (ciąg dziesiętny, domyślnie `1`): kopia jako szkic; ceny stałe i korekty kwotowe mnożone z zaokrągleniem połówkowym w górę do 4 miejsc, procenty bez zmian. |
| `DELETE /:id` | Usunięcie cennika z wierszami, odbiorcami i kanałami; dla cennika cen bazowych `403`. |
| `GET /:id/rows` | Wiersze, stronicowane (`selectionKind`, `productId`, `variantId`, `categoryId`, `attributeKey`, `search`), każdy z `labels`, `naturalKey`, `inactiveReason` i `targetDeleted`. |
| `GET /:id/lines` | Strony siatki dzielone według linii (`kind`, `search`, `page`, `pageSize` ≤ 500), warianty zagnieżdżone pod produktem, `meta.totalLines`; koszt strony nie rośnie z cennikiem. |
| `GET /:id/product-lines?productIds=` | Które z najwyżej 200 produktów mają już linię w cenniku. |
| `PUT /:id/rows` | Jedna partia, jedno audytowane polecenie: `{ expectedVersion, mode: 'merge' \| 'replace', upsert, delete }`, najwyżej 5 000 wierszy. Wiersz wskazuje wybór identyfikatorami (`selection`) albo kluczem naturalnym (`key`: `productSku`, `variantSku`, `categoryPath`, `attribute { key, valueCode }`). Wiersz bez id, którego wybór i `minQuantity` są równe zapisanemu wierszowi, zastępuje go. |
| `PUT /:id/rows?dryRun=true` | Ta sama treść, bez zapisu: `{ version, resolved, diff { added, changed, removed, unchangedCount }, errors }`. Zatwierdzenie to ta sama treść bez `dryRun`, z wersją zwróconą przez podgląd. |
| `GET /base-prices?productId=`, `PUT /base-prices/:productId` | Ceny bazowe produktu w każdej walucie, `{ byCurrency: { CODE: { product: Tier[], variants: { [variantId]: VariantBaseRow \| null } } } }`; jedno polecenie dla wszystkich walut, tworzące cennik cen bazowych waluty przy pierwszym użyciu. Handlowiec dostaje przy zapisie `403`. |
| `GET /targets/organizations?search=` albo `?ids=`, `…/customer-groups`, `…/categories`, `…/attributes`, `…/sales-channels?currency=`, `…/currencies` | Listy wyboru. Organizacje są zawężone do zakresu wywołującego; atrybuty to tylko kwalifikujące się atrybuty z `isPriceRule`, z ich opcjami. |
| `POST /resolve` | Wyjaśnienie: `{ salesChannelId?, currencyCode?, buyer { organizationId?, customerAccountId? }, lines [{ key, productId, variantId?, quantity }] }` (≤ 200 pozycji; bez kanału = domyślny kanał systemu). Każda pozycja: `price { amount, currency, source, compareAt? }` albo `null` oraz `explanation { tier, cell, bookId, bookName, rowId, reference, precedenceVersion, candidates[] }`. Organizacja albo klient, których wywołujący nie może zobaczyć, dają ten sam `404` co nieznane. |
| `GET /precedence` | Aktywna wersja: `version`, `cells`, `categoryBeforeAttribute`, `depthMode`, `preset`. |
| `GET /settings/show-list-price`, `PUT /settings/show-list-price` | Ustawienie `pricing.show_list_price`, `{ value: boolean }`; zapis to jedno audytowane polecenie. |
| `POST /internal/sweep` | Tylko dla testów: jedno wykonanie aktualizacji statusów. |

Nadpisania trybów prezentacji mają własne ścieżki:
`GET /api/v1/admin/pricing/display-mode-overrides?scope=`, `GET` i
`PUT /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` (`{ mode }` albo
`{ mode: 'inherit' }`, aby usunąć nadpisanie).

**Wersje.** `version` zmienia się przy każdym zapisie cennika. `PATCH /:id` i `PUT /:id/rows` muszą
wskazać wersję, względem której powstały; bez niej odpowiadają `400`, a względem starszej —
`409 PRICE_BOOK_STALE` z `details.currentVersion`, niczego nie zapisując.

**Odmowy.**

| Kod | Status | Kiedy |
| --- | --- | --- |
| `PRICE_BOOK_CHANNEL_CURRENCY` | 400 | kanał ze zbioru nie oferuje waluty cennika (szczegóły go wskazują) |
| `PRICE_BOOK_AUDIENCE_KIND` | 400 | odbiorcy dwóch rodzajów albo odbiorca, który nie istnieje lub jest innego rodzaju |
| `PRICE_BOOK_IMMUTABLE_FIELD` | 409 | zmiana waluty, typu, rodzaju odbiorców cennika, który był aktywny, albo nagłówka cennika cen bazowych |
| `PRICE_BOOK_NOT_APPLICABLE` | 409 | aktywacja cennika bez nieuśpionego kanału albo bez odbiorcy |
| `PRICE_BOOK_STALE` | 409 | zapis względem starszej wersji |
| `PRICE_BOOK_ROW_OVERLAP` | 409 | każdy odrzucony wiersz nachodzi na inny wiersz z tym samym wyborem |
| `PRICE_BOOK_ROW_SHAPE` | 400 | każdy inny odrzucony wiersz (kod koperty, gdy błędy są mieszane) |
| `PRICE_BOOK_ROW_TARGET`, `PRICE_BOOK_ROW_LIMIT` | — | kody poszczególnych wierszy w `details.errors` (`PRICE_BOOK_ROW_LIMIT` jest też kodem koperty, gdy każdy błąd dotyczy limitu) |
| `PRECEDENCE_CHANGE_UNAVAILABLE` | 409 | każdy zapis pod `…/precedence` |

Odrzucona partia wymienia **każdy** błędny wiersz w `details.errors: [{ index?, rowId?, field, code,
reason, message }]` — `index` to pozycja wiersza w `upsert`, `rowId` — zapisany wiersz. `reason` to
jedna z wartości `PRICE_BOOK_ROW_ERROR_REASONS` (`fixed_on_all`, `rows_overlap`, `product_unknown`,
`attribute_not_selectable`, `base_book_kind`, …); to ją tłumaczy klient — angielski `message` służy
dziennikom.

**Zakres handlowca.** Odczytywany z kontekstu izolacji żądania, nigdy z treści żądania
(`price-book-scope.ts`): cennik organizacji z jakimkolwiek odbiorcą spoza zakresu wywołującego
odpowiada na każdej trasie dokładnie tak jak brakujący cennik — `404`, bez obecności na listach i w
licznikach; cenniki dla wszystkich i grup klientów są tylko do odczytu (`403`); handlowiec może
tworzyć i wskazywać tylko organizacje ze swojego zakresu. `writable` w cenniku i
`meta.creatableAudienceKinds` na liście mówią klientowi, co oferować.

## API storefrontu

| Metoda i ścieżka | Zwraca |
| --- | --- |
| `GET /api/v1/storefront/products/:id/resolved-price?quantity=&currency=&variantId=` | Dla oglądającego (organizacja i klient z sesji, w przeciwnym razie gość): `resolvedPrice { basePrice, salePrice, baseListId, saleListId, displayMode, currencyCode, quantityBracket, source, compareAt, listPrice? }`. `basePrice` to **regularna** cena oglądającego — kupującego, katalogowa albo bazowa — a `salePrice` jest ustawiona tylko wtedy, gdy naliczana jest cena promocyjna; `listPrice` — tylko przy włączonym `pricing.show_list_price`, gdy cena dla wszystkich jest wyższa od naliczanej. |
| `GET /api/v1/storefront/pricing/display-mode/:productId` | Sam tryb prezentacji. |

Obie są wyceniane dla oglądającego, którego wyznacza jedna funkcja. Odpowiedź wyceniona dla
organizacji ma `Cache-Control: private, no-store`; anonimowa nie jest oznaczana. Listy katalogu i
wyniki wyszukiwania niosą tę samą odpowiedź w `ProductSummary.resolvedPrice`, więc storefront nie
wywołuje `resolved-price` dla każdej karty.

## Porty dla innych modułów

| Nazwa w kontenerze | Kontrakt (`@endora-commerce/contracts`) | Do czego służy |
| --- | --- | --- |
| `pricingService` | `ListingPricePort`, `ListingPriceDetailPort`, `LinePricesPort`, `ListingPriceOrderPort`, `OrgLinePricePort` | każdy odczyt ceny (wyżej) |
| `buyerLinePricePort` | `BuyerLinePricePort.resolveForBuyer({ buyer, salesChannelId, currencyCode?, lines })` | cena jednostkowa netto, którą wskazany kupujący płaci teraz za każdą pozycję; bez sprawdzania uprawnień — wywołujący przekazuje kupującego, którego autoryzował |
| `priceListReadPort` | `PriceListReadPort` — `findById`, `findByIds`, `listAll`, `listActive`, `listForOrganization({ organizationChain, customerGroupId })` | nagłówki cenników; cenniki obowiązujące organizację przez jej własne członkostwo, członkostwo przodka albo jej grupę, każdy z `reason` i `depth` w łańcuchu |
| `productDisplayModePort` | `ProductDisplayModePort.resolveDisplayMode` | tryb prezentacji produktu dla kupującego |
| `priceBookWritePort` | `PriceBookWritePort` | **ceny bazowe** produktu, dla importu cen z innego modułu |

### `priceBookWritePort`

Port wewnątrzprocesowy, przez który inny moduł — import cen konektora PIM — zapisuje ceny bazowe.
Wywołania, które zastąpił, zestawiono niżej, w sekcji *Aktualizacja ze starego modelu*.

```ts
interface PriceBookWritePort {
  basePrices(productId: string): Promise<ProductBasePrices>;
  replaceProductBaseTiers(productId: string, tiersByCurrency: Record<string, BasePriceTier[]>): Promise<ProductBasePrices>;
  replaceBasePrices(productId: string, write: BasePricesWrite): Promise<ProductBasePrices>;
  booksPricingProduct(productId: string, variantId?: string | null): Promise<PriceBookSummary[]>;
}
```

- Oba zapisy to polecenie cen bazowych z panelu (`PriceBookService.setBasePrices`): jedno wykonanie
  Command Bus (`price_list.base_prices_set`, jeden wpis audytu z wykonawcą, którego Command Bus
  ustala w zakresie wywołującego), zmiana wersji każdego dotkniętego cennika cen bazowych, podbicie
  generacji cen po zatwierdzeniu. `replaceProductBaseTiers` zastępuje progi produktu we wskazanych
  walutach i zachowuje wiersze wariantów; `replaceBasePrices` to dokładnie
  `PUT …/base-prices/:productId`.
- Cennik cen bazowych jest wskazywany przez **walutę**, nigdy przez id; waluta bez cennika cen
  bazowych dostaje go w tym samym poleceniu. Kwoty są ciągami dziesiętnymi.
- Walidacja i odmowy są takie jak w API administracyjnym: `400 VALIDATION_FAILED` z `details`,
  `404 NOT_FOUND` dla nieznanego produktu.
- `booksPricingProduct` to lista z panelu przefiltrowana po `productId`, wszystkie strony, każdy
  cennik widoczny.
- Odmawia w razie wątpliwości: rozwiązanie go, gdy modułu `price_lists` nie ma, rzuca
  `ModuleDisabledError` (`503 MODULE_DISABLED`). Rozwiązuj go przy każdym użyciu przez `lazyPort`,
  nigdy nie przechowuj instancji.

Wiersze cenników innych niż cenniki cen bazowych zapisuje się wyłącznie przez API administracyjne.

## Stan wyłączenia, kanały i izolacja

- `price_lists` deklaruje `activation.nonDeactivatable`: operator nie może go wyłączyć. Wdrożenie,
  które go nie instaluje, sprawia, że każdy port wyceny odmawia z `MODULE_DISABLED`; worker i
  subskrypcje są podłączone przez `ctx.worker` i `ctx.subscribe`, więc nic z tego nie działa, gdy
  modułu nie ma, a wiersze powiązania z kanałami zostają.
- Zbiór kanałów jest czytany i zapisywany wyłącznie przez `SalesChannelMembershipService`; usunięcie
  kanału sprzedaży czyści jego powiązania przez ścieżkę usuwania kanału w jądrze, jak każde inne
  powiązanie.
- Usunięcie waluty pozostaje odrzucane, dopóki używa jej jakikolwiek cennik, także cennik cen
  bazowych (moduł zgłasza swój opis do `currencyReferenceRegistry`).

## Aktualizacja ze starego modelu (uwaga migracyjna) {#upgrading-from-the-old-model-migration-note}

To wydanie zastąpiło stary model cen w jednym kroku, bez okresu zgodności:

| Usunięte | Zastąpione przez |
| --- | --- |
| Reguła stosowania (Application rule) cennika | nagłówek cennika: jedna waluta, zbiór kanałów i zbiór odbiorców |
| Lista produktów i przedziały cenowe każdego cennika oraz cennik *Default* | cennik cen bazowych każdej waluty z wierszami produktów i wariantów |
| Zakładka macierzy cen i jej współrzędne organizacji i waluty | wiersze cennika, dla odbiorców i waluty cennika |
| *Default unit price* produktu (`defaultPrice` / `price` w `attributeValues`) | cena bazowa produktu, ustawiana w zakładce *Pricing* |
| Nadpisanie ceny wariantu (`product_variants.price_override`) | wiersz wariantu w cenniku cen bazowych albo w dowolnym innym cenniku |
| `/api/v1/admin/price-lists-engine/…`, `/api/v1/admin/pricing/rule-targets/…`, `/api/v1/admin/products/:id/price-lists`, `/api/v1/admin/products/:id/resolved-price` | `/api/v1/admin/price-books/…` (`GET ?productId=` dla cenników produktu, `POST /resolve` dla wyliczonej ceny) |
| `priceListAdminPort` | `priceBookWritePort` |
| `listBracketMinQuantities` | `listTierStarts` |

Migracje, które się wykonały:

1. **`price_lists`, rozszerzenie** (`20261021T165239_price_lists_price_books_expand.ts` i kolejne):
   nowe tabele i kolumny, powiązanie z kanałami i wersja kolejności 1 = HY.
2. **`catalog`** (`20261022T111811_catalog_price_fields_removed.ts`), wykonywana najpierw ze względu na
   kolejność modułów: usunęła `product_variants.price_override` i klucze `defaultPrice` oraz `price`
   z `attribute_values` każdego produktu. **Żadne z nich nie zostało przeniesione**: nadpisanie ceny
   wariantu nigdy nie było naliczane, a cena domyślna produktu miała znaczenie tylko dla produktów bez
   przedziału w cenniku *Default*.
3. **`price_lists`, konwersja** (`20261022T111815_price_lists_price_books_conversion.ts`), w jednej
   transakcji, czytająca tylko własne tabele i tabelę `sales_channels` jądra: jeden cennik cen
   bazowych na każdą walutę użytą w przedziale cennika *Default* oraz na domyślną walutę platformy
   (cennik domyślnej waluty zachowuje id `00000000-0000-4000-8000-00000000d51b`); każdy przedział
   cennika *Default* stał się stałym wierszem produktu w cenniku cen bazowych swojej waluty; każdy inny
   cennik został usunięty razem z listą produktów, przedziałami, regułą i pozycjami macierzy; stare
   tabele i kolumny zostały usunięte; typ `base` zmienił nazwę na `regular`.

Dla opiekunów importu cen napisanego dla usuniętego `priceListAdminPort`:

| Usunięte wywołanie `priceListAdminPort` | Zamiennik w `priceBookWritePort` |
| --- | --- |
| `getById(priceListId)` | brak — cennik cen bazowych wskazuje się walutą |
| `listProducts(priceListId)` | `basePrices(productId)` → `byCurrency[code].product` i `.variants` |
| `addProduct(priceListId, productId)` | brak — cenniki nie mają listy produktów; wystarczy zapisać progi produktu |
| `replaceBrackets(priceListId, productId, bracketsByCurrency)` | `replaceProductBaseTiers(productId, tiersByCurrency)` albo `replaceBasePrices(productId, { byCurrency })` |
| `summarizeBracketsForProduct(productId)` | `booksPricingProduct(productId)` |

Co to oznacza dla instancji: ceny bazowe pochodzące z cennika *Default* zostały zachowane; **żadnego
innego cennika już nie ma** i trzeba je utworzyć ponownie jako cenniki (dane demonstracyjne odtwarza
`pnpm run cli demo reset`); a produkt, który miał tylko *Default unit price* i nie miał przedziału w
cenniku *Default*, **nie ma ceny**, dopóki nie wpisze się dla niego ceny bazowej. Zapisy produktów i
wariantów oraz import produktów odrzucają teraz `defaultPrice`, `price` i `priceOverride` z kodem
`400 PRICE_SET_IN_PRICE_BOOKS`. Pliki changeset wydania wymieniają każde usunięte wywołanie razem z
jego zamiennikiem.

## Testy

| Co | Gdzie |
| --- | --- |
| Wektory przykładów (E1–E3, kolejność, promocje, priorytet, progi ilościowe, odbiorcy, kanały, narzuty, warianty) | `backend/test/integration/price_lists/worked-examples/` |
| Pełne sprawdzenie kolejności, klucz porządku algorytmu i jego własności | `src/backend/services/precedence.test.ts`, `book-resolver.test.ts` |
| Zgodność wszystkich powierzchni; partia = pojedyncze wywołanie; porządek sortowania = karty | `backend/test/integration/price_lists/pricing-surfaces-agree.test.ts`, `listing-prices-batch.test.ts`, `line-prices-batch.test.ts`, `price-surface-identity.test.ts` |
| Odczyt koszyka = składanie zamówienia | `backend/test/integration/carts/cart-read-equals-placement.test.ts` |
| API administracyjne, zakres, wersje, podgląd bez zapisu, usunięte trasy | `backend/test/contract/price_lists/` |
| Konwersja; świeża instalacja; scenariusze demonstracyjne | `backend/test/integration/price_lists/conversion.test.ts`, `fresh-install.test.ts`, `demo-scenarios.test.ts` |
| Wydajność (`PERF_RUN=true`) | `backend/test/perf/price_lists/price-surface.bench.ts`, `book-resolver.bench.ts`, `book-lines-page.bench.ts`, `editor-import-save.bench.ts` |
