---
title: catalog
sidebar_label: Katalog
description: Produkty, warianty, kategorie, atrybuty, kanały sprzedaży
---

# `catalog`

Katalog produktów: produkty (Products), warianty (ProductVariants), kategorie (Categories), atrybuty
(ProductAttributes) i kanały sprzedaży (SalesChannels). Odpowiada za wszystkie ścieżki odczytu, z
których korzysta storefront, oraz za edycję katalogu w panelu administracyjnym.

## API publiczne

Trasy administracyjne są chronione przez `catalog:read` (lista i odczyt) i `catalog:write` (zmiany).

Odczyty storefrontu, które zawierają cenę — lista produktów, szczegóły produktu i
`/products/:idOrSlug/links` — przyjmują `?currency=` (kod ISO 4217). Odpowiedź jest wyceniana w
tej walucie, jeśli kanał sprzedaży ją oferuje, a w przeciwnym razie w walucie domyślnej kanału;
w obu przypadkach każda cena podaje swoją walutę. Niepoprawny kod jest odrzucany z
`400 VALIDATION_FAILED`.

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/catalog/products` | storefront / klucz API | Lista, wyszukiwanie i filtrowanie produktów w aktywnym kanale sprzedaży |
| `GET /api/v1/catalog/products/:idOrSlug` | storefront | Szczegóły produktu (bez kwoty, gdy tryb wyświetlania cen oglądającego to *Żaden*) |
| `GET /api/v1/catalog/categories` | storefront | Zagnieżdżone drzewo kategorii |
| `GET /api/v1/catalog/categories/:id/content` | storefront | Treść strony jednej kategorii, dobrana do języka wywołującego |
| `GET /api/v1/catalog/filters` | storefront | Atrybuty, po których można filtrować w aktywnym kanale sprzedaży |
| `GET /api/v1/catalog/sitemap.xml` | roboty wyszukiwarek | Mapa witryny dla SEO |
| `GET /api/v1/admin/catalog/products?status&archived` | administrator | Lista produktów w panelu. `status` to `active` albo `inactive` (każda inna wartość: `400 VALIDATION_FAILED`); `archived` to `exclude` (domyślnie), `include` albo `only` — dawne `includeArchived=1` oznacza `include`. `counts` to `{ all, active, inactive, archived }` — zob. *Status produktu i archiwizacja* |
| `GET /api/v1/admin/catalog/products/:id` | administrator | Szczegóły produktu |
| `POST /api/v1/admin/catalog/products` | administrator | Utworzenie produktu (`type` nie można zmienić po utworzeniu; `sku` można edytować) |
| `PATCH /api/v1/admin/catalog/products/:id` | administrator | Aktualizacja (łącznie z `sku`); zapisuje wpis audytu ze stateBefore / stateAfter; odrzuca z `409 sku_in_use`, gdy nowe SKU należy już do innego produktu |
| `DELETE /api/v1/admin/catalog/products/:id` | administrator | Usunięcie (miękkie) — to nie jest akcja Archiwizuj |
| `POST /api/v1/admin/catalog/products/:id/archive` | administrator (`catalog:write`) | Archiwizacja jednego produktu — zob. *Status produktu i archiwizacja* |
| `POST /api/v1/admin/catalog/products/:id/restore` | administrator (`catalog:write`) | Przywrócenie jednego zarchiwizowanego produktu |
| `GET`, `POST /api/v1/admin/catalog/products/list-views`; `PATCH`, `DELETE …/list-views/:id` | administrator | Zapisane widoki listy produktów — zob. *Zapisane widoki* niżej |
| `GET /api/v1/admin/catalog/attributes` | administrator | Lista atrybutów |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | administrator | Dane do listy wyboru — wszystkie atrybuty z żądaną flagą |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | administrator | Odczyt jednego atrybutu |
| `POST /api/v1/admin/catalog/attributes` | administrator | Utworzenie atrybutu (przyjmuje nowe flagi i `options[]` bezpośrednio w treści dla typów wyboru) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | administrator | Natychmiastowa zmiana `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isPriceRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition` (ponownie emituje `attribute.updated.v1`) |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | administrator | Usunięcie; odrzucane z `409 attribute_in_use_by_set`, dopóki odwołuje się do niego jakikolwiek zestaw atrybutów |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | administrator | Lista opcji atrybutów typu select/enum/multiselect |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | administrator | Dodanie opcji |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | administrator | Zmiana label / labelDefault / isDefault / sortOrder (wartości `value` opcji nie można zmienić) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | administrator | Usunięcie; odrzucane z `409 option_in_use`, dopóki którykolwiek produkt ma tę wartość |
| `POST /api/v1/admin/catalog/attribute-set-preview` | administrator | Podgląd, które atrybuty będą edytowalne, a które ukryte, gdy operator zmieni zestaw atrybutów produktu |
| `GET /api/v1/admin/catalog/categories` | administrator | Płaska lista, z której panel buduje drzewo |
| `POST /api/v1/admin/catalog/categories` | administrator | Utworzenie (kategoria nadrzędna musi istnieć) |
| `PATCH /api/v1/admin/catalog/categories/:id` | administrator | Aktualizacja; przy zmianie kategorii nadrzędnej sprawdzany jest łańcuch nowej kategorii nadrzędnej, aby odrzucić cykle (409) |
| `DELETE /api/v1/admin/catalog/categories/:id` | administrator | Usunięcie miękkie; odrzucane z 409, gdy odwołuje się do niej aktywna kategoria podrzędna |
| `GET /api/v1/admin/catalog/categories/:id/content` | administrator | Treść strony kategorii — jeden dokument Page Buildera na język ([Treść strony kategorii](./catalog/category-content.md)) |
| `PUT /api/v1/admin/catalog/categories/:id/content` | administrator | Zastąpienie treści strony kategorii; `null` ją czyści |
| `PUT /api/v1/catalog/products/by-sku/:sku` | klucz API | Idempotentne utworzenie lub aktualizacja (synchronizacja PIM); aktualizacja jest audytowana jako `product.update` ze wskazaniem klucza (`apiKeyId`) i nigdy nie podlega kontroli kompletności |

## Status produktu i archiwizacja

**Status** produktu to `active` albo `inactive` — globalnie oraz jako nadpisanie dla kanału
sprzedaży i dla pary kanał × język. `inactive` w dowolnym zakresie oznacza po prostu
**wyłączenie** w tym zakresie: produkt nie jest wyświetlany na listach, nie da się go wyszukać
ani zamówić, a jego strona odpowiada tak jak dla produktu, który nie istnieje. Wyłączenie
produktu nigdy go nie archiwizuje. Nowe i powielone produkty zaczynają jako `inactive`. Każda
inna wartość statusu jest odrzucana z `400 VALIDATION_FAILED` — w API panelu, przy zapisie
kluczem API `PUT /api/v1/catalog/products/by-sku/:sku` i w imporcie; archiwizacja nie jest
statusem.

**Archiwizacja** to osobna akcja obejmująca cały produkt, dostępna jako **Archiwizuj** i
**Przywróć** (`POST …/products/:id/archive`, `…/restore`) i wymagająca uprawnienia
`catalog:write`. Archiwizuj ustawia czas archiwizacji produktu i wycofuje go ze wszystkich
kanałów; Przywróć go czyści. Żadna z nich nie zmienia statusu w żadnym zakresie, a każda
zapisuje jeden wpis audytu z czasem archiwizacji przed i po. Archiwizacja produktu już
zarchiwizowanego albo przywrócenie produktu, który nie jest zarchiwizowany, odpowiada `200` i
niczego nie zmienia — bez wpisu audytu i bez zdarzenia.

- **Zbiorczo.** `POST /api/v1/admin/catalog/products/bulk-update` z
  `fields: { archived: true }` archiwizuje każdy zaznaczony produkt, a `false` je przywraca —
  każdy tą samą akcją i z własnym wpisem audytu. `archived` musi być jedynym polem żądania.
  Duże zaznaczenia działają jako zbiorcza operacja w tle, a jej cofnięcie przywraca każdy
  produkt do poprzedniego stanu. Operacja w tle zapisuje w audycie każdego produktu
  administratora, który jej zażądał, tak jak operacja wykonana od razu. Archiwizacja i
  przywracanie blokują produkt, więc dwie równoczesne archiwizacje jednego produktu
  archiwizują go raz.
- **Ustawienie `active` nigdy nie przywraca.** Zarchiwizowany produkt pozostaje zarchiwizowany
  niezależnie od statusu; przywraca go tylko Przywróć. Przywrócenie produktu `inactive`
  pozostawia go wyłączonym.
- **Produkty zarchiwizowane przed tą zmianą.** Do tego wydania produkt archiwizowało się,
  ustawiając go jako `inactive`. Każdy produkt, który w chwili aktualizacji jest `inactive`,
  pozostaje więc zarchiwizowany (z zachowanym czasem archiwizacji albo, gdy go nie miał, z
  czasem ostatniej zmiany) i **wymaga jawnego Przywróć**, aby wrócić — samo ustawienie `active`
  pozostawia go zarchiwizowanym.
- **Strona produktu.** Strona zarchiwizowanego produktu odpowiada `410 PRODUCT_ARCHIVED`
  („usunięty”), ale tylko kupującemu, który w przeciwnym razie mógłby go tam zobaczyć:
  sprawdzenie pomija archiwizację i czyta status globalny jako `active`, a wszystkie statusy
  kanału i pary kanał × język, przynależność do kanału, języki kanału, okno publikacji i
  odbiorcy nadal obowiązują. Wszędzie indziej, a także dla każdego produktu wyłączonego bez
  archiwizacji, strona odpowiada `404` dokładnie tak jak dla produktu, który nie istnieje.
- **Lista w panelu.** Zarchiwizowane produkty są domyślnie ukryte niezależnie od statusu;
  `archived=only` pokazuje tylko je, a `archived=include` pokazuje je obok pozostałych. Licznik
  i filtr `inactive` obejmują produkty wyłączone, ale niezarchiwizowane.
  Na liście produktów karta **Zarchiwizowane** ma własny adres, `/catalog/products/archived`,
  więc przycisk Wstecz przeglądarki i odświeżenie strony do niej wracają, a paleta poleceń
  (⌘K / CTRL+K) otwiera ją jako **Zarchiwizowane produkty** — wystarczy wpisać „archiwum” lub
  „archived”. Przy zaznaczeniu jej
  pasek oferuje Przywróć, Edycję zbiorczą i Usuń; **Edytuj cenę** jest widoczne na pozostałych
  kartach, ale nieaktywne, bo ceny ustawia się w cennikach.
- **Z asystenta AI panelu.** Narzędzia asystenta `catalog.archive_product` i
  `catalog.restore_product` (`catalog:write`) archiwizują i przywracają produkty po
  zatwierdzeniu pokazanego planu — tą samą akcją i z tym samym wpisem audytu, z Tobą jako
  wykonawcą; większe zaznaczenia działają jako opisana wyżej operacja zbiorcza. Narzędzie
  statusu, `catalog.set_product_status`, tylko włącza i wyłącza produkty, nigdy ich nie
  archiwizuje ani nie przywraca, a wyszukiwanie produktów asystenta pokazuje także
  zarchiwizowane i oznacza je.

### Status dla kanału i języka, zbiorczo

`POST /api/v1/admin/catalog/products/bulk-update` z
`fields: { scopedStatus: { channelId, languageCode, value } }` ustawia status każdego
zaznaczonego produktu w jednym zakresie — kanale sprzedaży (`languageCode: null`) albo
jednej parze kanał × język — na `active` lub `inactive`, albo usuwa tam nadpisanie
wartością `inherit`. W każdym produkcie zmienia się tylko ten zakres; pozostałe zakresy
i status globalny zostają bez zmian. Produkt, który nie należy do kanału, albo język,
którego kanał nie oferuje, jest pomijany i raportowany jako `scope_invalid` — produkt
nigdy nie zostaje dodany do kanału. `scopedStatus` nie może wystąpić razem ze `status`
w jednym żądaniu. Zmiana każdego produktu to jeden wpis audytu z nazwą zakresu; duże
zaznaczenia wykonują się jako operacja zbiorcza w tle, której cofnięcie przywraca każdy
zakres i raportuje produkty zmienione w międzyczasie.

### Kontrola kompletności przy włączaniu produktu

Gdy **zmiana statusu** dokonana przez operatora włącza produkt w kanale sprzedaży i
języku — status globalny, status kanału albo pary kanał × język, pojedynczo lub
zbiorczo — produkt musi mieć w tym języku: **nazwę** (własną nazwę w tym języku albo
nazwę nadpisaną dla tego kanału; nazwa w innym języku się nie liczy), **klucz URL**
(liczy się klucz globalny) oraz każdy **wymagany** atrybut zależny od języka ze swojego
zestawu atrybutów. Ustawienie **Completeness check when switching a product on**
(`catalog.scope_completeness_gate`, jedna wartość dla całej platformy) decyduje, co się
dzieje, gdy czegoś brakuje:

- **`warn`** (domyślnie) — zmiana zostaje zapisana, a odpowiedź wymienia braki dla
  każdego kanału i języka (`warnings`, rodzaj `completeness`).
- **`refuse`** — zmiana nie zostaje zapisana: `422 SCOPE_INCOMPLETE` wymienia każdy
  kanał i język wraz z brakami. Zmiana, która włączyłaby produkt w kilku miejscach, jest
  odrzucana w całości, jeśli którekolwiek z nich nie spełnia warunków. W edycji
  zbiorczej produkty spełniające warunki zostają zmienione, a pozostałe są pomijane jako
  `completeness_gate`.

Sprawdzana jest wyłącznie zmiana statusu. Produkt, który staje się dostępny, bo
dołącza do kanału, kanał zyskuje język, otwiera się jego okno publikacji, zmienia się
jego grupa odbiorców albo zostaje przywrócony z archiwum, nie jest sprawdzany — braki w
każdym kanale i języku pokazuje wtedy **przegląd zakresów** w edytorze produktu.
Ustawienie `active` dla zarchiwizowanego produktu jest sprawdzane jak każda zmiana
statusu, choć produkt pozostaje zarchiwizowany. Importy, synchronizacja z PIM i upsert
przez klucz API nigdy nie są sprawdzane.

## Ceny

**Produkt nie ma własnej ceny.** Każda cena jest wierszem cennika modułu `price_lists`: cena bazowa
produktu w każdej walucie, ceny jego wariantów oraz każda cena katalogowa, cena kupującego i cena
promocyjna. Cenę bazową produktu ustawia się w zakładce **Pricing** edytora produktu — panel *Ceny
bazowe* i lista cenników ustalających cenę produktu pochodzą z modułu `price_lists` — albo w siatce
cennika cen bazowych. Ceny wariantów ustawia się w tych samych miejscach, nigdy w samym wariancie.
Na stronie modułu `price_lists` opisano, jak wybierana jest cena, którą płaci kupujący.

- **Karty na listach, strona produktu i produkty powiązane** pokazują własną cenę oglądającego —
  ceny jego organizacji i grupy klientów w kanale sprzedaży i walucie żądania. Produkt, którego
  warianty kosztują różnie, pokazuje najniższą cenę jako cenę *od* (`ProductSummary.price` niesie
  `variesByVariant` i `maxAmount`); naliczona cena promocyjna niesie zwykłą cenę kupującego jako cenę
  porównawczą; przy włączonym `pricing.show_list_price` niższa cena kupującego niesie cenę katalogową
  jako `listPrice`. Produkt, którego nic nie wycenia, nie ma ceny i prowadzi do zapytania ofertowego.
- **Sortowanie i filtrowanie według ceny** — `?sort=price`, `?sort=-price`, `minPrice`, `maxPrice`
  w `GET /api/v1/catalog/products` — porządkują i wybierają według tej samej ceny dla ilości 1, którą
  karty pokazują temu oglądającemu, a dla produktu z wariantami według ceny *od*. Produkty z ceną
  zawsze są przed produktami bez ceny. Porządek według ceny zawsze pochodzi z PostgreSQL, nigdy z
  indeksu wyszukiwania. Przechodzenie kursorem przez porządek według ceny pokazuje każdy produkt raz,
  o ile jego cena się w tym czasie nie zmienia; produkt, którego cena zmieni się w trakcie, może
  pojawić się dwa razy albo wcale, jak przy każdym kursorze po bieżącej cenie. Strona może być krótsza,
  a nawet pusta, i mimo to mieć dalszy ciąg (`hasMore: true`), gdy większość odczytanych wierszy jest
  ukryta przed oglądającym; wtedy należy podążyć za jej kursorem.
  Kursor porządku według ceny i zakresu cen jest zapieczętowany: nie da się go odczytać ani zmienić,
  bo miejsce, od którego prowadzi dalej, może być produktem, którego oglądający nie widzi. Kursor,
  którego nie da się otworzyć — zmieniony, wydany przez wersję sprzed pieczętowania albo przed zmianą
  klucza sesji instancji — zaczyna listę od pierwszej strony.
- **Odczyt wskazanych produktów** — `?ids=<id>,<id>,…` w `GET /api/v1/catalog/products` zawęża
  listę do tych produktów: najwyżej 24 różne identyfikatory, każdy w formacie uuid, w przeciwnym
  razie `400 VALIDATION_FAILED`. Odpowiedź zawiera te z nich, które oglądający może zobaczyć,
  wycenione dokładnie tak jak każda karta na liście dla tego oglądającego, w kolejności samej listy —
  wywołujący, któremu zależy na własnej kolejności, porządkuje je według identyfikatorów. Ten
  parametr łączy się z pozostałymi filtrami, a odpowiedź zawsze pochodzi z PostgreSQL. W ten sposób
  są odczytywane produkty powiązane z wpisem na blogu.
- **Gdy tryb wyświetlania cen oglądającego to *Żaden*** — na przykład dla niezalogowanego
  odwiedzającego w kanale, który ukrywa ceny do czasu zalogowania — lista i szczegóły produktu nie
  zawierają kwoty, a sortowanie i zakres cen są dla tej strony odrzucane. Kanały sprzedaży nie mają
  już własnej flagi widoczności cen: o tym, co widzi każdy oglądający, decyduje tryb wyświetlania.

Dla programistów: ścieżki list wyceniają całą stronę jednym zbiorczym wywołaniem —
`resolveListingPrices` albo `resolveListingPriceDetails` tam, gdzie strona pokazuje podział
(`ProductSummary.resolvedPrice`: `basePrice`, `salePrice`, `listPrice`, `displayMode`) — przez
wycinki portu `pricingService` z `@endora-commerce/contracts`, przekazując organizację i konto
klienta oglądającego, a nie wyliczoną grupę. Porządek według ceny czyta `ListingPriceOrderPort`
(`orderByUnitPrice`, `pricedProductIds`) z wstępnie wyliczonej powierzchni cen modułu `price_lists`,
a końcówkę bez cen składa sam (`catalog-query.service.ts`). Zewnętrzne API katalogu wycenia przez
`resolveLinePrices` i buduje drabinę progów związanej organizacji z `listTierStarts`. Zapisy
produktów, kategorii i atrybutów publikują zdarzenia, które subskrybuje `price_lists`; czyszczą one
pamięć podręczną cen i oznaczają na powierzchni cen produkty, których dotyczy każde zdarzenie, do
odświeżenia przez workera powierzchni.

### Usunięte pola cen (uwaga migracyjna)

Wydanie, które wprowadziło cenniki w obecnym kształcie, usunęło *Default unit price* produktu
(klucze `defaultPrice` i `price` w `attributeValues` oraz pole edytora) oraz nadpisanie ceny wariantu
(`product_variants.price_override` i pole ceny w edytorze wariantu), bez konwersji żadnego z nich.
Tworzenie i aktualizacja produktu i wariantu oraz import produktów odrzucają te pola z kodem
`400 PRICE_SET_IN_PRICE_BOOKS` (`PRICE_FIELDS_REFUSED_ON_PRODUCTS`, `PRICE_FIELDS_REFUSED_ON_VARIANTS`
w `@endora-commerce/contracts`), informując, że ceny ustawia się w cennikach. Migracja katalogu
`20261022T111811_catalog_price_fields_removed.ts` usunęła kolumnę i klucze.

## Encje

`Product`, `ProductVariant`, `Category`, `ProductAttribute`, `SalesChannel`, tabele łączące
`product_categories`, `sales_channel_products`, `product_assets` oraz `ProductListSavedView`
(`product_list_saved_views`, zapisane widoki listy produktów).

## Zapisane widoki

Zapisany widok to nazwany zestaw filtrów listy produktów, który administrator może ponownie
zastosować jednym wyborem.

### Korzystanie z zapisanych widoków

Na pasku narzędzi listy produktów jest lista wyboru **Zapisane widoki**, której pierwsza pozycja to
**— Wybierz widok —**, a obok niej dwa przyciski: **Zapisz widok** i **Usuń widok**.

- **Co zapamiętuje widok.** Status, rodzaj i wyszukiwany tekst — i nic więcej. Filtry **Stan**,
  **Kategoria** i **Kanał** nie są zapisywane. Wybranie widoku ustawia status, rodzaj i
  wyszukiwanie na wartości z widoku (wartość, której lista już nie oferuje, wczytuje się jako
  *Wszystkie*), przywraca filtr Stan do *Wszystkie*, odrzuca to, co zmieniono i nie zapisano,
  czyści zaznaczenie wierszy i wraca na pierwszą stronę.
- **Zapisywanie.** **Zapisz widok** otwiera jedno okno z polem **Nazwa** i polem wyboru
  **Udostępnij wszystkim administratorom, którzy mają dostęp do tej listy**. Pole wyboru jest na
  początku odznaczone, więc nowy widok jest prywatny, dopóki go nie zaznaczysz. Nazwa jest
  wymagana, spacje na początku i na końcu są usuwane, a jej długość to najwyżej 160 znaków.
  Problemy są pokazywane przy polu i nic nie zostaje wysłane, dopóki ich nie poprawisz; odmowa
  serwera jest pokazywana w oknie, które pozostaje otwarte z wpisanymi danymi.
- **Prywatny czy udostępniony.** Widok prywatny widzisz tylko ty. Widok udostępniony widzi każdy
  administrator, który ma dostęp do listy produktów, z dopiskiem **(udostępniony)** po nazwie. Lista
  wyboru nie pokazuje, kto zapisał udostępniony widok.
- **Jedna nazwa na administratora.** Nie możesz mieć na tej liście dwóch widoków, których nazwy
  różnią się tylko wielkością liter albo spacjami na początku lub końcu. Okno odpowiada
  **Masz już widok o tej nazwie.**, zanim cokolwiek wyśle, a serwer także odrzuca taką nazwę.
  Litery ze znakami diakrytycznymi są innymi literami: *Wózki* i *Wozki* to dwie różne nazwy. Nazwy
  używane przez innych administratorów i nazwy z innych list się nie liczą.
- **Usuwanie.** **Usuń widok** jest aktywny tylko wtedy, gdy wybrany widok jest jednym z tych,
  które możesz usunąć. Prosi o potwierdzenie i podaje nazwę widoku — **Usunąć widok „…”?** — a dla
  widoku udostępnionego dodaje, że zniknie on dla wszystkich administratorów, którzy mają dostęp do
  tej listy. Nic nie zostaje usunięte, dopóki nie naciśniesz **Usuń**.
- **Kto może usunąć lub zmienić udostępniony widok.** Jego właściciel albo **każdy administrator,
  którego rola nie jest `sales_representative`** — nie tylko rola `platform_admin`: liczy się
  także rola niestandardowa, na przykład menedżer katalogu. **Takie usunięcie lub zmiana nie zostawia śladu audytu**: zapisane
  widoki nie trafiają do dziennika audytu. Weź to pod uwagę, przydzielając role, zanim zespół
  zacznie polegać na udostępnionych widokach. Opiekun handlowy może usuwać tylko własne widoki, a
  prywatnego widoku innego administratora nikt nie widzi i nikt nie może go usunąć.
- **Tylko zapis, wczytanie i usunięcie.** Panel administracyjny nie zmienia nazwy widoku, nie
  zmienia tego, czy jest udostępniony, i nie nadpisuje go bieżącymi filtrami; zamiast tego zapisz
  nowy widok i usuń stary. Liczba widoków nie jest ograniczona.

### API zapisanych widoków

| Metoda i ścieżka | Odpowiedź |
| --- | --- |
| `GET /api/v1/admin/catalog/products/list-views` | `200` — własne widoki wywołującego oraz wszystkie widoki udostępnione, posortowane po nazwie |
| `POST /api/v1/admin/catalog/products/list-views` | `201` — utworzony widok |
| `PATCH /api/v1/admin/catalog/products/list-views/:id` | `200` — zmieniony widok; dowolne z `name`, `shared`, `filters`. Panel administracyjny go nie wywołuje. Treść, która niczego nie zmienia — pusta albo z wartościami takimi jak zapisane — niczego nie zapisuje ani nie loguje i zwraca bieżący widok |
| `DELETE /api/v1/admin/catalog/products/list-views/:id` | `200` — `{ data: { deleted: <id> } }` |

- **Uprawnienie.** Wszystkie cztery trasy wymagają `catalog:read` — kodu, który chroni odczyt
  listy produktów; nie ma osobnego kodu uprawnienia. Żądanie bez aktora-administratora jest
  odrzucane z `401 UNAUTHORIZED`. Statyczny segment `list-views` ma pierwszeństwo przed
  `products/:id`.
- **Treść żądania.** `name` (po przycięciu 1–160 znaków, bez znaków sterujących ani formatujących
  Unicode), `shared` (wartość logiczna) i `filters` (obiekt, najwyżej 8192 bajty jako JSON
  w UTF-8). Lista produktów nie ma sortowania ani wyboru kolumn, więc widok nie przechowuje `sort`
  ani `visibleColumns`; te klucze są pomijane. Panel administracyjny zapisuje `filters` jako
  `{ status?, type?, q? }`, tylko te różne od domyślnych. Wszystko poza tymi granicami to
  `400 VALIDATION_FAILED`. Kształty to `createProductSavedViewRequestSchema` i
  `updateProductSavedViewRequestSchema` w `@endora-commerce/contracts`.
- **Dwie flagi zależne od wywołującego.** Każdy widok w odpowiedzi ma `ownedByCaller` i
  `canModify` — `true`, gdy wywołujący jest właścicielem widoku albo widok jest udostępniony, a
  wywołujący jest administratorem platformy w rozumieniu poniżej. Panel administracyjny włącza
  **Usuń widok** na podstawie `canModify`, a przed zapisem wstępnie, w miarę możliwości, sprawdza
  powtórzenie nazwy wśród wyświetlonych widoków z `ownedByCaller`. Rozstrzyga porównanie
  `lower(btrim(name))` po stronie serwera: nazwa przepuszczona przez to wstępne sprawdzenie nadal
  może zostać odrzucona z `409`.
- **Administrator platformy, na potrzeby zapisanych widoków,** to administrator, którego kontekst
  dzierżawy (tenant context) żądania ma `mode === 'all'` — każda rola poza `sales_representative`.
  Listy zamówień, produktów i zapytań ofertowych wyznaczają go tak samo, a w razie wątpliwości
  odmawiają: administrator, którego zasięgu nie da się ustalić, nie jest administratorem platformy.
- **Odmowy.** Nieistniejący widok i prywatny widok innego administratora to `404 NOT_FOUND` —
  nie da się ich odróżnić. Udostępniony widok, którego wywołujący nie jest właścicielem i którego
  nie może zmienić jako administrator platformy, to `403 FORBIDDEN`. Nazwa, której klucza
  właściciel widoku już używa na tej liście, to `409 PRODUCT_SAVED_VIEW_NAME_TAKEN`, *„Masz już zapisany widok o tej nazwie na liście produktów. Wybierz inną nazwę.”*, w języku żądania.
- **Klucz nazwy** to nazwa przycięta i zapisana małymi literami — bez usuwania znaków
  diakrytycznych. Zasada wiąże **właściciela** widoku: administrator platformy zmieniający nazwę
  udostępnionego widoku kolegi dostaje odmowę, gdy kolega już używa tego klucza. Utworzenie widoku
  i zmiana klucza nazwy biorą blokadę doradczą (advisory lock) w zakresie transakcji, kluczowaną
  właścicielem, a wspiera ją unikalny indeks na `(owner_admin_user_id, lower(name))`, więc dwa
  równoczesne zapisy pod jedną nazwą zostawiają dokładnie jeden widok.
- **Brak audytu.** Zapisane widoki to osobista konfiguracja interfejsu i nie przechodzą przez
  Command Bus. Gdy administrator zmienia lub usuwa widok, którego nie jest właścicielem, usługa
  zapisuje jeden wpis dziennika na poziomie `info`:
  `{ event: 'saved_view.updated' | 'saved_view.deleted', list: 'product_list_saved_views', viewId, ownerAdminUserId, actorAdminUserId }`.
  Ten wpis jest jedynym śladem.
- **Przechowywanie.** `product_list_saved_views` (`ProductListSavedView`) jest globalna dla
  platformy, a nie przypisana do organizacji: przechowuje wartości filtrów, nigdy wyniki listy, a
  każdy odczyt listy po zastosowaniu widoku odbywa się w zakresie osoby, która go wczytała.

## Emitowane zdarzenia

`product.created.v1`, `product.updated.v1`, `product.archived.v1`, `attribute.updated.v1`.
Odbiera je indeksowanie wyszukiwarki. Trzy zdarzenia produktów są też oferowane webhookom
wychodzącym (następna sekcja); `attribute.updated.v1` nie jest.

`category.updated.v1` i `category.content.updated.v1` czyszczą pamięć podręczną kategorii w
storefroncie; pierwsze dodatkowo ponownie indeksuje produkty z poddrzewa zmienionej kategorii.

## Zdarzenia oferowane webhookom wychodzącym

Moduł wnosi trzy typy zdarzeń do rejestru `webhookEventRegistry` modułu `webhooks`, więc
subskrypcja webhooka może je wskazać, dopóki oba moduły są obecne. Treść zdarzenia jest wysyłana
w całości; ścisłe schematy to `CATALOG_WEBHOOK_EVENT_SCHEMAS` w `@endora-commerce/contracts`.

| Zdarzenie | Kiedy jest wysyłane | Treść, poza `eventId` i `occurredAt` |
| --- | --- | --- |
| `product.created.v1` | Utworzono produkt — w panelu administracyjnym, przez zapis kluczem API, przez import albo synchronizację z PIM, albo przez powielenie innego produktu. | `productId` (UUID), `sku` — SKU, z którym produkt utworzono; może się później zmienić, `productId` nie. |
| `product.updated.v1` | Zapisano produkt albo utworzono, zmieniono lub usunięto jeden z jego wariantów. | `productId`, `changedFields` — nazwy pól produktu, których dotyczył zapis (`name`, `status`, `categoryIds`, …; `variants` przy zapisie wariantu). Same nazwy, lista otwarta, może być pusta. |
| `product.archived.v1` | Produkt zarchiwizowano akcją Archiwizuj — pojedynczo albo zbiorczo. Raz na każdą taką zmianę: archiwizacja produktu już zarchiwizowanego niczego nie wysyła. Zmiana statusu nigdy go nie wysyła: `inactive` to zwykłe wyłączenie. | `productId` |

- **Kolejność.** Archiwizuj wysyła `product.updated.v1` (z `archivedAt` w `changedFields`), a
  potem `product.archived.v1` — dla pojedynczego produktu i dla każdego produktu archiwizacji
  zbiorczej.
- **Przywrócenie nie ma własnego zdarzenia.** Przywróć wysyła `product.updated.v1` z `archivedAt`
  w `changedFields` i nic więcej. Włączenie albo wyłączenie produktu wysyła `product.updated.v1`
  ze `status`. Aby je rozróżnić, odczytaj produkt: odpowiedzią są jego `status` i `archivedAt`.
- **Cofnięcie.** Cofnięcie edycji zbiorczej wysyła `product.updated.v1` dla każdego produktu,
  który przywróciło, z nazwami przywróconych pól, oraz `product.archived.v1` tam, gdzie ponownie
  archiwizuje produkt.
- **Usunięcie nie jest dostarczane.** Usunięcie produktu emituje `product.deleted.v1` wyłącznie na
  działającej w procesie szynie zdarzeń; webhookom się go nie oferuje i nie jest przy tym wysyłane
  `product.archived.v1`. Odbiorca odwzorowujący katalog dowiaduje się o usunięciu z odczytu: API
  przestaje zwracać produkt. Jeśli usunięcia są dla ciebie istotne, uzgadniaj stan z pełną listą.
- **Po zatwierdzeniu zapisu.** Każde zdarzenie jest wysyłane dla zapisu, który został
  zatwierdzony. Zapis odrzucony albo wycofany nie wysyła niczego.
- **Treść nie opuszcza instancji.** W żadnym zdarzeniu nie ma nazwy, opisu, ceny, wartości atrybutu
  ani listy dozwolonych organizacji. Odbiorca odczytuje produkt przez API własnym kluczem.
- **Tylko subskrypcje obejmujące całą platformę.** Produkt nie jest danymi jednej organizacji, więc
  zdarzenia nie niosą `organizationId`, a subskrypcja powiązana z organizacją nigdy nie dostaje
  zdarzenia produktu.
- **Liczba zdarzeń.** Jedno zdarzenie na zapisany produkt. Edycja zbiorcza, import albo
  synchronizacja z PIM zapisują produkty pojedynczo, więc wysyłają jedno `product.updated.v1` na
  produkt; nic nie jest łączone w paczki. Gdy żadna subskrypcja nie wskazuje danego typu, nic nie
  trafia do kolejki.

## Punkty rozszerzenia

- **Listy w poszczególnych kanałach sprzedaży** — usługa zapytań dostaje kontekst kanału sprzedaży,
  a każda pokazywana cena jest wyceniana dla tego kanału; nowe ograniczenia (np. katalogi dla
  segmentów klientów) dodaje się przez kompozycję w `catalog-query.service.ts`.
- **Strefy edytora produktu** — edytor montuje strefy panelu, do których dokładają się inne
  moduły; `product.editor.seo.after`, na końcu karty SEO (właściwości: `productId`), to miejsce,
  w którym moduł SEO umieszcza link do edytora metatagów, dzięki czemu katalog go nie wymienia.
- **Unikalność sluga** — slug jest domyślnie unikalny we wszystkich kanałach sprzedaży; jeśli kolizje
  między językami staną się problemem, nadpisz mechanizm tworzenia slugów w
  `catalog-admin.service.ts`.

## Zasady zamawiania: minimalna ilość zamówienia i zwroty

Dwie zasady na produkcie decydują o tym, jak można go zamówić i czy można go odesłać. Obie edytuje
się na karcie **Zasady zamawiania** w zakładce **Inventory** edytora produktu.

> **Aktualizacja: każdy istniejący produkt zaczyna jako niepodlegający zwrotowi.** Produkt, na
> którym nikt nie ustawił **Podlega zwrotowi**, nie podlega zwrotowi — dotyczy to również każdego
> produktu, który istniał przed wprowadzeniem tego ustawienia. Pozycje zamówień złożonych po
> aktualizacji nie podlegają więc zwrotowi, dopóki nie oznaczysz ich produktów. Aby oznaczyć wiele
> naraz, zaznacz je na liście produktów i użyj **Edycja masowa → Podlega zwrotowi → Tak — podlega
> zwrotowi**. Zamówienia złożone przed aktualizacją pozostają bez zmian: ich pozycje podlegają
> zwrotowi na dotychczasowych zasadach.

### Minimalna ilość zamówienia

- **Minimalna ilość zamówienia (szt.)** — najmniejsza liczba sztuk produktu, jaką kupujący może
  zamówić w jednym zamówieniu. Opcjonalna; liczba całkowita od **1 do 1 000 000** albo puste pole,
  gdy minimum nie ma. Dotyczy tylko produktów `simple` i `configurable`: na produkcie `grouped`,
  `bundle` lub `virtual` karta o tym informuje, a API odrzuca to pole z kodem
  `422 VALIDATION_FAILED` wskazującym `minOrderQuantity`, przy tworzeniu i przy aktualizacji.
  Wartość spoza zakresu jest odrzucana z kodem `400 VALIDATION_FAILED`.
- **Minimum dla jednostki opakowania** — każda jednostka opakowania może mieć własną minimalną
  liczbę jednostek; zob. [Jednostki opakowania](./catalog/packaging-units.md).

Minimum ocenia się na **łącznej ilości produktu**: liczy się każda pozycja produktu w koszyku —
pozycje z pojedynczymi sztukami i z jednostkami opakowania, wszystkie warianty. Minimum jednostki
opakowania liczy jednostki tej jednostki zamówione dla produktu, we wszystkich wariantach. Oba
sprawdzenia są niezależne; koszyk musi spełnić każde ustawione minimum. Warianty dziedziczą
minimum produktu.

Stosuje je każda droga do koszyka, zapytania ofertowego albo zamówienia — koszyk, checkout, szybkie
zamówienie, zakup jednym kliknięciem, listy zakupowe, zapytania ofertowe, ekran tworzenia
zamówienia w panelu administracyjnym i zewnętrzne API zamówień. Strona każdego z tych modułów opisuje,
co jego ścieżka robi z pozycją poniżej minimum. Odmowa to `422 PRODUCT_BELOW_MINIMUM_QUANTITY`
(sztuki) albo `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` (jednostka opakowania), z komunikatem w
języku kupującego podającym produkt i minimum. Usunięcie pozycji jest zawsze dozwolone.

Produkt, którego kupujący nie może zobaczyć albo którego kanał sprzedaży z żądania nie publikuje,
jest na każdej ścieżce zgłaszany jako nieznany produkt — jego nazwa i minimum nigdy nie są
ujawniane.

Szczegóły produktu w storefroncie, lista produktów, wyniki wyszukiwania i porównanie niosą
`minOrderQuantity` (`null`, gdy minimum nie ma albo typ produktu go nie przyjmuje); tablica
`packagingUnits[]` w szczegółach produktu niesie `minOrderUnits` każdej jednostki. Storefront
zaczyna ilość od minimum i nie pozwala wybrać mniej.

### Podlega zwrotowi

**Podlega zwrotowi** (tak / nie, na każdym typie produktu) określa, czy kupujący może ująć produkt
w **zwrocie**. Nie ogranicza **reklamacji**. Domyślnie: nie.

Wartość jest **zapisywana na każdej pozycji zamówienia w chwili jego złożenia**
(`order_items.returnable_at_purchase`); późniejsza zmiana flagi nie zmienia żadnego złożonego już
zamówienia. Pozycja, której produktu nie dało się odczytać przy składaniu zamówienia, jest
zapisywana jako niepodlegająca zwrotowi. To, co moduł Returns robi z zapisaną wartością, opisuje
jego własna strona.

### Dla kanału sprzedaży

Obie zasady można nadpisać dla jednego kanału sprzedaży — **Zasady zamawiania** kanału w
zakresach produktu (`PATCH /api/v1/admin/catalog/products/:id/scopes`, pola
`minOrderQuantity` i `returnable` wpisu kanału; `null` przywraca wartość globalną).
Wartość kanału obowiązuje wszędzie, gdzie koszyk, zamówienie albo zapytanie ofertowe należy
do tego kanału: przy dodawaniu do koszyka, w widoku koszyka, przy przekazaniu do akceptacji,
w podglądzie zamówienia, przy składaniu zamówienia, w podglądzie zamówienia tworzonego przez
operatora, w zapytaniach ofertowych i w imporcie szybkiego zamówienia przez kupującego.
Minimum kanału równe 1 oznacza brak minimum w tym kanale niezależnie od wartości globalnej.
Przy składaniu zamówienia na każdej pozycji zapisywana jest flaga zwrotu z kanału
zamówienia, więc zwroty podążają za kanałem, w którym złożono zamówienie. Karta produktu i
lista produktów w sklepie podają minimum kanału żądania.

### Audyt i kopie

Ustawienie lub usunięcie którejkolwiek zasady trafia do dziennika audytu jak każda edycja
produktu, ze starą i nową wartością. **Edycja masowa → Podlega zwrotowi** zapisuje jeden wpis
audytu na każdy zmieniony produkt — do 200 produktów w jednym synchronicznym żądaniu, powyżej tej
liczby przez kolejkowaną edycję masową. Zmiana zasady nigdy nie zmienia istniejącego koszyka,
zamówienia, zapytania ofertowego ani zwrotu. **Duplicate** nie kopiuje żadnej z zasad: kopia
zaczyna bez minimum i jako niepodlegająca zwrotowi.

### API

| Pole | Gdzie | Wartości |
| --- | --- | --- |
| `minOrderQuantity` | `POST` / `PATCH /api/v1/admin/catalog/products[/:id]`, odpowiedź produktu w panelu | liczba całkowita `1…1000000` albo `null`, aby usunąć |
| `returnable` | to samo oraz `POST /api/v1/admin/catalog/products/bulk-update` | boolean |
| `minOrderUnits` | `POST` / `PATCH …/packaging-units[/:unitId]`, odpowiedź jednostki opakowania | liczba całkowita `1…1000000` albo `null`, aby usunąć |

Port odczytu katalogu (`CatalogProductReadPort`) podaje `minOrderQuantity` i `returnable` na każdym
rekordzie produktu oraz `minOrderUnits` na każdej jednostce opakowania, a do odczytów zbiorczych
dostaje metodę `listPackagingUnitsByProductIds`. Jak każda metoda tego portu nie stosuje żadnej
polityki widoczności: wywołujący przekazuje tylko identyfikatory produktów, które już sprawdził.

Migracja `20261016T082008_catalog_order_rules.ts` dodaje `products.min_order_quantity` (dopuszcza
`null`, `CHECK` 1–1 000 000), `products.returnable` (not null, domyślnie `false`) oraz
`product_packaging_units.min_order_units` (dopuszcza `null`, `CHECK` 1–1 000 000).

## Struktura i kompozycja produktu

Katalog zyskał kilka dodatkowych możliwości, każda z własną stroną:

- [Zestawy atrybutów](./catalog/attribute-sets.md) — wielokrotnego użytku schematy atrybutów
  przypisywane do produktów, z systemowym zestawem Default
- [Galeria produktu](./catalog/gallery-and-labels.md) — galeria zdjęć i filmów z regułami
  oznaczeń Base / Small / Thumbnail pilnowanymi przez bazę danych
- [Załączniki](./catalog/attachments.md) — pliki do pobrania (certyfikaty, specyfikacje techniczne,
  …) ze słownikiem typów
- [Powiązania produktów](./catalog/product-links.md) — produkty powiązane, droższe zamienniki i
  produkty uzupełniające, wyświetlane na stronie produktu i w koszyku
- [Produkty złożone](./catalog/composite-products.md) — `grouped` (stałe produkty podrzędne),
  `bundle` (konfigurowalne miejsca w zestawie), `virtual` (dostawa cyfrowa)

Obsługiwanych jest pięć typów produktu: `simple`, `configurable`, `grouped`, `bundle`, `virtual`.
`simple` i `configurable` to pierwotna para; pozostałe trzy dodano później.

## Bloki Page Buildera

Katalog deklaruje bloki produktów i kategorii Page Buildera. Ich dane są
odczytywane po stronie serwera, więc produkty są w HTML strony.

**Siatka produktów i slider produktów** (`catalog.ProductGrid`,
`catalog.ProductSlider`) zachowują wszystkie dotychczasowe opcje — źródło
produktów (wybrane produkty, kategoria, wyszukiwanie), limit, kolumny, odstęp i
widok — i dodają:

| Opcja | Znaczenie |
| --- | --- |
| Nagłówek | Opcjonalny tytuł, tekst wstępu i przycisk (np. „Zobacz wszystkie”) nad produktami. |
| Styl karty | Domyślna, kompaktowa, pozioma albo **showcase**: zdjęcie produktu na neutralnym tle, nazwa, krótki opis i link „więcej” — bez ceny i SKU. |
| Tekst pod nazwą produktu | Jeden wiersz pod nazwą na każdej karcie: domyślny dla stylu karty (SKU na karcie domyślnej, kompaktowej i poziomej, krótki opis na karcie showcase), **Krótki opis** (pierwsze słowa opisu produktu, najwyżej 160 znaków), SKU albo nic. Podgląd w edytorze stron pokazuje ten sam wiersz co sklep. |
| Grubość nazwy na karcie | Grubość nazwy produktu na każdej karcie: **Domyślna** (właściwa stylowi karty) albo 300–800. |
| Tło obrazu karty | Kolor pola za obrazem każdej karty: kolor marki albo wartość szesnastkowa. Puste pole zostawia jasnoszare tło właściwe stylowi karty. |
| Linia pod każdą kartą | **Brak** (jak dotąd) albo **Linia**: linia o grubości 1 px pod każdą kartą, w wybranym **kolorze linii** albo w neutralnym kolorze obramowania. W karcie z obramowaniem linią staje się jej dolna krawędź; karta „showcase” dostaje ją 16 px pod tekstem. |
| Etykieta linku karty | Tekst linku na karcie showcase; „More”, gdy pole jest puste. |
| Odstęp (siatka) | Stopień skali odstępów albo **Własny odstęp (px)**, dla każdego progu. Siatka zapisana z odstępem w pikselach otwiera się z wartością własną o tej liczbie i wygląda jak dotąd. Odstęp siatki kategorii działa tak samo. |
| Równa wysokość elementów (siatka) | Dla każdego progu, obok kolumn i widoku, na karcie **Responsive**; wartość zapisana wcześniej obowiązuje na każdej szerokości. Tak samo działa w siatce kategorii. |
| Przycisk pod produktami | Opcjonalny przycisk pod siatką lub sliderem. |

Slider przejmuje opcje karuzeli Page Buildera: liczbę slajdów w widoku dla
każdego progu, odstęp, efekt przesuwania lub przenikania, położenie strzałek i
kropek, wyjście do krawędzi okna i opcjonalne automatyczne przewijanie. Siatka
lub slider zapisane, zanim te opcje istniały, wyświetlają się jak wcześniej.
Aby nadać któremuś z tych bloków kotwicę, schemat kolorów, tło, odstępy lub
szerokość, umieść go w bloku **Sekcja** (`cms.Section`). Teksty nagłówka,
etykietę linku karty i etykietę
przycisku pod produktami można tłumaczyć akcją **Przetłumacz** w Page Builderze.

**Krótki opis produktu.** Lista produktów i szczegóły produktu w storefroncie
(`GET /api/v1/catalog/products`, `GET /api/v1/catalog/products/:idOrSlug`)
zwracają `summary`: opis produktu w języku żądania jako zwykły tekst, przycięty
na granicy słowa do najwyżej 160 znaków z `…`, albo `null`, gdy produkt nie ma
opisu. Powstaje z opisu, który odczyt i tak wczytuje, więc nie kosztuje
dodatkowego zapytania na produkt (`src/backend/services/product-summary-text.ts`
w pakiecie modułu).
Pokazuje go karta showcase.

## Rozszerzenia atrybutów na ścieżkach odczytu katalogu

Prace nad atrybutami dodały elementy, których storefront potrzebuje do wyświetlania rozbudowanych
informacji o produkcie, a moduły wyszukiwarki i promocji — do obsługi zapytań klientów. Edycję
atrybutów w pełni opisuje osobna strona [Atrybuty](./catalog/attributes.md); ta sekcja tylko
podsumowuje, co zmieniło się na ścieżkach odczytu katalogu.

### Nowe flagi atrybutów

`ProductAttribute` ma cztery flagi zachowania, pozycję liczbową i zastępczą etykietę dla brakujących
języków:

- `isPromoRule` (boolean) — atrybut jest dostępny na liście wyboru w kryterium `attribute` edytora
  reguł promocji
- `isVisibleOnProductPage` (boolean) — atrybut jest pokazywany na zakładce „Parametry produktu” na
  stronie produktu w storefroncie, gdy produkt ma jego wartość
- `isRequired` (boolean) — wymagany przy zapisie produktu, gdy atrybut należy do zestawu atrybutów
  produktu
- `filterPosition` (number) — klucz sortowania w panelu filtrów storefrontu (mniejsze wartości
  wyżej; remisy rozstrzyga etykieta)
- `labelDefault` (string) — wartość zastępcza, gdy w JSONB `label` brakuje klucza dla aktywnego
  języka

### Listy opcji

Atrybuty typu wyboru (`select`, `enum`, `multiselect`) mają uporządkowaną listę opcji — każdy wiersz
jest identyfikowany przez `(definition, value)` i ma etykiety w poszczególnych językach, etykietę
zastępczą, kolejność i flagę wartości domyślnej. Dawną kolumnę JSONB `enum_values: string[]` w
`product_attributes` wycofano migracją `20260505T060113_catalog_attribute_options_and_flags.ts`
(na rzecz tabeli katalogu `attribute_options`), a migracja
`20260723T230401_catalog_attributes_on_custom_fields.ts` przeniosła wiersze do ogólnej tabeli `custom_field_options`. Istniejące miejsca odczytu
odtwarzają na granicy API dawną postać listy opcji ze względu na zgodność wsteczną.

### Edytowalne SKU

`sku` produktu można zmieniać. Wewnętrznym, stałym odwołaniem we wszystkich powiązaniach między
modułami (pliki, powiązania produktów, pozycje zapytań ofertowych, …) jest UUID `Product.id`, który
nigdy się nie zmienia. Zmiana SKU zapisuje wpis audytu i jest odrzucana z `409 sku_in_use`, gdy nowa
wartość należy już do innego produktu.

### Zmiana zestawu atrybutów

Gdy operator przypisze produktowi inny zestaw atrybutów, formularz w panelu wyświetla się ponownie
tylko z atrybutami nowego zestawu. Wartości atrybutów spoza nowego zestawu pozostają po stronie
serwera w kolumnie JSONB — powrót do poprzedniego zestawu znów je pokazuje. Endpoint
`attribute-set-preview` pozwala edytorowi ostrzec operatora przed potwierdzeniem, które pola zostaną
ukryte, a które zachowane.

### Odczyty przez inne moduły

Dwie metody `CatalogQueryService` są używane ponad granicami modułów (udokumentowane porty usług):

- `comparableAttributeKeys(): string[]` — porównywarka
- `promoRuleAttributeKeys(): string[]` i `getAttributeWithOptions(key)` — promocje
- `buildVisibleAttributesProjection()` — wewnętrzna, używana przez odpowiedź ze szczegółami
  produktu do zbudowania `visibleAttributes[]`

## Atrybuty jako rozszerzenie pól niestandardowych {#atrybuty-jako-rozszerzenia-custom-field}

Przechowywanie definicji atrybutów połączono z ogólną warstwą pól niestandardowych modułu
`custom_fields` przez adapter, a nie przez przepisanie. W API HTTP nic się nie zmieniło — każdy
powyższy endpoint zachowuje swoją postać — ale model przechowywania i własności jest inny:

- **Atrybut produktu to rozszerzenie katalogu dla definicji pola niestandardowego encji produktu.**
  Ogólna tożsamość (`key`, `label` w poszczególnych językach i `labelDefault`, `valueType`,
  `required`) jest w wierszu `custom_field_definitions` z `entity_type = 'product'`. Tabela
  `product_attributes` pozostaje, przebudowana jako cienki wiersz rozszerzenia 1:1 (klucz obcy
  `custom_field_definition_id` z UNIQUE), zawierający tylko flagi zachowania katalogu
  (`isSearchable`, `isFilterable`, `isVariantAxis`, `displayAsSlider`, `isComparable`,
  `quickSearchable`, `isPromoRule`, `isPriceRule`, `filterPosition`, `isVisibleOnProductPage`,
  `channelScoped`,
  `languageScoped`, `massEditable`) oraz dwa ustawienia prezentacji (`selectDisplay`, `numericKind`),
  które bez strat zachowują dawne rozróżnienia `enum`/`select` i `number`/`price`. **Flagi pozostają
  własnością katalogu** — ogólny rdzeń nigdy ich nie interpretuje.
- **Opcje są w `custom_field_options`.** Tabeli katalogu `attribute_options` już nie ma; listy opcji
  to zwykłe opcje pola niestandardowego w definicji encji produktu.
- **Jedno miejsce zapisu: `/catalog/attributes`.** Zmiany atrybutów i opcji to polecenia katalogu,
  które tworzą, aktualizują lub usuwają definicję i rozszerzenie razem w jednej transakcji (z jednym
  wpisem audytu), korzystając z transakcyjnego API zapisu eksportowanego przez `custom_fields`.
  Ogólny ekran pól niestandardowych w panelu pokazuje definicje produktu tylko do odczytu i odrzuca
  zmiany z `409 host_managed`.
- **Migracja `20260723T230401_catalog_attributes_on_custom_fields.ts`** jednorazowo połączyła oba modele w jednej
  transakcji: utworzyła po jednej definicji dla każdego dawnego atrybutu (klucz, etykiety,
  przełożony typ wartości, wymagalność, deterministyczna kolejność), przeniosła wiersze
  `attribute_options` do `custom_field_options`, przepisała klucze `attribute_set_attributes` na
  identyfikatory definicji, dodała do `product_attributes` kolumny `custom_field_definition_id` /
  `select_display` / `numeric_kind`, usunęła powielone kolumny (`key`, `label`, `label_default`,
  `value_type`, `is_required`) i usunęła `attribute_options`. Migrację można cofnąć (`down()`
  przywraca dawną postać), a przy kolizji z zarezerwowanym kluczem przerywa się z wyraźnym błędem.
- **Wartości atrybutów nie zostały przeniesione** — `products.attribute_values`,
  `product_variants.variant_attribute_values` i `product_value_overrides` zachowują postać i
  pozostają własnością katalogu (encja jest właścicielem swoich danych).

Wewnętrzni odbiorcy (wyszukiwarka, szybkie zamówienie, porównywarka, masowa edycja, port promocji,
edytor zakresu) odczytują atrybuty przez eksportowany przez katalog `CatalogAttributeReadService`,
który łączy definicję i rozszerzenie w `CatalogAttributeView` o dawnej postaci.

## Wyszukiwanie globalne

Wyszukiwanie globalne w panelu administracyjnym (paleta poleceń, ⌘K / Ctrl+K) znajduje produkty i kategorie. Ten moduł udostępnia poniższe pola; to, które z nich są używane, wybiera się na ekranie konfiguracji wyszukiwania globalnego.

| Pole | Przeszukiwane domyślnie |
| --- | --- |
| Produkt: SKU | tak |
| Produkt: Nazwa | tak |
| Produkt: Klucz URL (slug) | nie |
| Produkt: Atrybuty szybkiego wyszukiwania | nie |
| Kategoria: Nazwa | tak |
| Kategoria: Klucz URL (slug) | tak |

Nazwy są dopasowywane we wszystkich językach i wyświetlane w języku administratora. Produkty nieaktywne i zarchiwizowane są znajdowane i pokazują swój status; usunięte produkty i kategorie nie są znajdowane. Wynik kategorii otwiera drzewo kategorii z wyróżnioną tą kategorią. Oba typy pojawiają się dla roli z uprawnieniem `catalog:read`.
