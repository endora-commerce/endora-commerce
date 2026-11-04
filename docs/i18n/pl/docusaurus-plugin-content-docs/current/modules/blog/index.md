---
title: Blog
sidebar_position: 16
description: Wpisy redakcyjne z treścią z Page Buildera, kategoriami i tagami oraz listami wpisów w storefroncie
---

# Blog

Moduł bloga odpowiada za redakcyjną część storefrontu — wpisy, kategorie i tagi — tworzone w tym
samym edytorze **Page Builder** (przeciągnij i upuść), który dostarcza [moduł CMS](../cms/index.md).
Wpisy przejmują budowę pól strony CMS (slug, statusy w cyklu życia, treść w poszczególnych językach,
meta tagi SEO) i dodają elementy typowe dla bloga: drzewo kategorii nadrzędnych, dowolne tagi oraz
uporządkowane listy powiązanych wpisów i powiązanych produktów.

| Encja         | Identyfikator             | Cykl życia                            | Gdzie się pojawia                                              |
| -------------- | ---------------------- | ------------------------------------ | -------------------------------------------------------- |
| **Wpis**       | `slug` (w obrębie kanału)   | `draft → published → archived`       | Adres `<blog-prefix>/<slug>` w storefroncie             |
| **Kategoria**   | `slug` (w obrębie kanału)   | flaga `enabled`, struktura drzewa      | Adres `<blog-prefix>/<slug>` (na tym samym poziomie co wpisy) i kafelki |
| **Tag**        | `code` (globalny)        | blokada usunięcia, gdy jest używany                      | Adres `<blog-prefix>/tag/<code>` i lista tagów przy każdym wpisie   |

## Encje i graf odwołań

```
   blog_categories  ── parent_id ──┐ self-FK tree (NO ACTION)
                          │       ▼
                          ├─── blog_post_categories ───────► blog_posts
                          │                                       │
                          │                              ┌────────┼─────────┐
                          ▼                              ▼        ▼         ▼
              blog_post_categories                  blog_post_tags  blog_post_related_posts (self-FK)
                                                          │                  │
                                                          ▼                  │
                                                      blog_tags              │
                                                                             ▼
                                                              blog_post_related_products → catalog.products
```

Schemat znajduje się w `20260506T081055_blog_init.ts` (jedenaście nowych tabel, wszystkie z przedrostkiem
`blog_*`) i nigdy nie zmienia istniejących tabel. Migracja
`20261023T063013_blog_post_main_image.ts` dodaje `blog_posts.main_image_asset_id`
(opcjonalne, z odwołaniem do `assets`).

## Obraz główny

Wpis ma opcjonalny **Obraz główny**, wybierany z biblioteki zasobów w edytorze
wpisu. Jest pokazywany na kartach wpisów — na stronie głównej bloga, w listach
kategorii i tagów oraz w bloku najnowszych wpisów Page Buildera. API panelu
przekazuje go jako `mainImageAssetId` (tworzenie, zmiana i szczegóły), a karty
w storefroncie jako `mainImageUrl`: publiczny adres zasobu albo `null`, gdy
wpis nie ma obrazu lub zasób nie jest publiczny.

## Adresy i trasy

Storefront serwuje blog z jednej trasy Next.js przechwytującej wszystkie ścieżki,
`storefront/app/blog/[[...slug]]/page.tsx`. Publicznym adresem jest `blog.url_prefix` kanału z
[modułu ustawień](../settings/index.md): middleware storefrontu odczytuje routing bloga dla kanału
(`GET /api/v1/blog/routing`, przechowywany przez minutę dla każdego kanału) i kieruje `/<prefix>/…` na
tę trasę, po prefiksie języka dodawanym przez ustawienie adresów kanału (`/pl/aktualnosci/…`). Trasy:

| Wzorzec adresu (po wyznaczeniu kanału) | Wyświetla                              |
| -------------------------------------- | ------------------------------------ |
| `/<prefix>`                            | Strona główna bloga — najnowsze wpisy i kategorie pierwszego poziomu |
| `/<prefix>/tag/<code>`                 | Widok tagu — stronicowane karty wpisów z tym tagiem |
| `/<prefix>/<slug>`                     | Strona kategorii (gdy slug pasuje do `blog_categories.slug`) |
| `/<prefix>/<slug>`                     | Strona wpisu (gdy slug pasuje do `blog_posts.slug`) |

Gdy prefiks jest inny niż `blog`, żądanie `/blog/…` dostaje odpowiedź **301** do tego samego widoku
pod prefiksem; tak samo — gdy moduł SEO jest włączony — żądanie **dawnego prefiksu** kanału. Zmiana
adresu bloga nie psuje więc zapisanych linków. Blog zapamiętuje każdy prefiks, którego kanał używał;
dawny prefiks można usunąć (`DELETE /api/v1/admin/blog/addresses/:id`), a wtedy przestaje
przekierowywać.

Każdy adres bloga w odpowiedzi dla storefrontu — karty wpisów, kafelki kategorii, tagi, okruszki,
własny `url` wpisu — składa backend funkcją `blogPath` z `@endora-commerce/contracts`, więc zawiera już
prefiks języka i prefiks bloga. Storefront nie składa żadnego adresu sam.

Rozstrzygnięcie odbywa się w **jednym** wywołaniu backendu — `GET /api/v1/blog/by-slug?slug=…` —
które zwraca unię rozłączną (`{ kind: 'category' | 'post', … }`). Dwa kanały MOGĄ używać tego samego
sluga dla niezwiązanych encji (rozstrzyga kontekst kanału).

### Unikalność sluga

Slug jest unikalny **w obrębie pary `(sales_channel, slug)`, łącznie dla `blog_posts` i
`blog_categories`**:

- Częściowe indeksy unikalne w bazie danych na każdym wierszu zakresu (`*_sales_channels`)
  wychwytują każdy błąd aplikacji, który ominąłby sprawdzenie w usłudze.
- Funkcja pomocnicza `BlogSlugCollision.assertSlugAvailable` zakłada blokadę
  `pg_advisory_xact_lock` Postgresa dla pary `(channel, slug)`, aby równoległy zapis nie wprowadził
  duplikatu mimo osobnych indeksów w każdej tabeli.
- Słowo `tag` jest zarezerwowane i nie może być slugiem (kolidowałoby ze wzorcem adresu
  `<prefix>/tag/<code>`).

## Cykl życia

### Wpisy

```
draft ─── publish ────► published ─── unpublish ───► draft
                            │                           │
                            │ archive                   │
                            ▼                           ▼
                        archived  ◄── unarchive ── (admin)
```

`published_at` jest ustawiane przy pierwszym przejściu do `published` i zachowywane przy kolejnych
wycofaniach z publikacji i archiwizacji (ponowna publikacja wpisu nie zmienia daty publikacji). Wpis
jest wyświetlany w storefroncie, gdy:

```
status = 'published'
AND active = true
AND deleted_at IS NULL
AND requested-channel ∈ post.salesChannels
AND blog.enabled[channel] = true
```

### Kategorie

Kategorie mają tylko flagę `enabled` (bez szkicu i publikacji). Tworzona przy instalacji kategoria
`Default` jest chroniona przez system — administratorzy mogą zmienić jej nazwę, metadane albo
odłączyć ją od kanałów, ale nie mogą jej usunąć.

## Ochrona odwołań

Operacje usuwające dane blokuje pięć zabezpieczeń:

1. **Usunięcie tagu, którego używają wpisy** → 409 `BLOG_TAG_IN_USE`.
2. **Usunięcie kategorii, do której należą wpisy** → 409 `BLOG_CATEGORY_IN_USE`.
3. **Usunięcie kategorii, która ma kategorie podrzędne** → 409 `BLOG_CATEGORY_HAS_CHILDREN`.
4. **Usunięcie kategorii `Default` utworzonej przy instalacji** → 409 `BLOG_CATEGORY_PROTECTED`.
5. **Usunięcie miękkie pliku z biblioteki osadzonego w treści wpisu lub opisie kategorii albo użytego jako obraz główny wpisu** →
   409 `ASSET_REFERENCED` (deskryptory zarejestrowane w
   [rejestrze odwołań biblioteki mediów](../assets-library/index.md#asset-reference-registry)).

Powiązanie wpisu jako wpisu powiązanego działa inaczej: **odłączenie przy usunięciu**. Gdy wpis
zostaje usunięty miękko, lista `relatedPostIds` każdego wpisu, który go wskazywał, atomowo się
skraca. Administrator widzi okno potwierdzenia z listą tych wpisów (na podstawie
`/posts/:id/inbound-references`).

Powiązanie wpisu z produktem korzysta z **usunięcia miękkiego i filtrowania w storefroncie**:
produkt usunięty miękko jest niewidoczny przy następnym odczycie w storefroncie, a wiersz łączący
pozostaje. Ogólny `ProductReferenceRegistry` może powstać w ramach kolejnej zmiany.

### Powiązane produkty w storefroncie

Dane wpisu zwracane przez `GET /api/v1/blog/by-slug` wskazują powiązane produkty **wyłącznie po
identyfikatorach** — `relatedProductIds`, w kolejności zapisanej w edytorze — ponieważ są
przechowywane w pamięci podręcznej dla kanału sprzedaży i języka, wspólnej dla wszystkich
odwiedzających, więc nie mogą zawierać niczego, co dotyczy jednego z nich.

Storefront odczytuje te produkty **jednym** zapytaniem o listę produktów katalogu, w imieniu
odwiedzającego: `GET /api/v1/catalog/products?ids=…` (najwyżej 24, pierwsze z wpisu). Każda
karta jest więc tą samą kartą produktu, którą temu odwiedzającemu pokazuje lista katalogu:

- tylko produkty, które odwiedzający może zobaczyć w danym kanale — produkt usunięty,
  nieopublikowany, spoza kanału albo z ograniczoną widocznością jest pomijany, a pozostałe
  zachowują kolejność z wpisu;
- cena, którą silnik cen wyznacza dla odwiedzającego — według kanału sprzedaży, wybranej waluty,
  organizacji i konta klienta — pokazana jako netto, brutto albo obie, zgodnie z trybem
  wyświetlania cen, albo *Cena na zapytanie*, gdy tryb wyświetlania to `none`, i sformatowana
  w języku strony.

Pasek nie jest wyświetlany, gdy wpis nie wskazuje żadnego produktu, który odwiedzający może
zobaczyć, ani gdy katalog jest niedostępny. Starsze pole `relatedProducts` (`BlogProductCard`)
jest przestarzałe: żadna konfiguracja go nie wypełniała i zostanie usunięte w jednym z kolejnych
wydań minor.

## Ustawienia

| Kod                  | Typ    | Wartość domyślna | Uwagi                                                |
| --------------------- | ------- | ------: | ---------------------------------------------------- |
| `blog.enabled`        | boolean | `true`  | Wyłącza blog w danym kanale.                         |
| `blog.url_prefix`     | string  | `blog`  | Jeden segment adresu, `^[a-z0-9-]+$`. Zobacz *Adres bloga* niżej. |
| `blog.url_prefix_by_language` | json | `{}` | Prefiks dla języka, zastępujący dla niego `blog.url_prefix`: `{"pl-PL": "aktualnosci", "en-US": "news"}`. |
| `blog.latest_count`   | number  | `5`     | Domyślna liczba wpisów w bloku Page Buildera *Najnowsze wpisy*. |
| `blog.posts_per_page` | number  | `12`    | Liczba wpisów na stronie głównej bloga oraz w widokach kategorii i tagu. |

Zmiana dowolnego ustawienia `blog.*` czyści wspólną pamięć podręczną ustawień w miejscu zapisu, a
potem emituje zdarzenie `EventBus`, które czyści pamięć podręczną storefrontu (zobacz *Strategia
pamięci podręcznej* niżej).

### Adres bloga

Zapis `blog.url_prefix` ocenia sam blog, przez walidatory zapisu modułu ustawień — tak samo na
ekranie ustawień, jak w API ustawień. Wartość jest odrzucana, gdy:

- nie jest jednym segmentem z małych liter, cyfr i łączników — `400 BLOG_URL_PREFIX_INVALID`;
- jest segmentem zarezerwowanym przez storefront: `api`, `tag`, `author` i pozostałymi segmentami,
  które rezerwuje blog, albo jednym z `cms.reserved_slug_segments` wdrożenia —
  `409 BLOG_URL_PREFIX_RESERVED`;
- jest prefiksem języka dowolnego kanału sprzedaży (`pl`, `en`, …) albo pierwszym segmentem sluga
  strony CMS w kanale — `409 BLOG_URL_PREFIX_CONFLICT`.

Samo `blog` jest zawsze przyjmowane. W drugą stronę: strona CMS, której slug zaczyna się od bieżącego
lub dawnego prefiksu bloga w kanale, jest odrzucana z `409 CMS_SLUG_RESERVED` (`claimedBy: "blog"`) —
gdy moduł bloga jest wyłączony, nie rezerwuje niczego.

### Prefiks dla języka

`blog.url_prefix_by_language` nadaje językowi własny prefiks — `/pl/aktualnosci/…` i
`/en/news/…` w jednym kanale — i podlega tym samym regułom, dla każdego języka; język, którego
kanał nie ma, jest odrzucany z `400 BLOG_URL_PREFIX_INVALID`. Język bez wpisu używa
`blog.url_prefix`. Żądanie bloga w danym języku pod prefiksem innego języka dostaje `301` na
właściwy. Każdy prefiks, którego język używał, zostaje zapamiętany jako dawny adres, tak jak
dla prefiksu domyślnego kanału.

Ekran **Blog → Adresy bloga** w panelu wyświetla dla każdego kanału sprzedaży bieżące i dawne
prefiksy i pozwala usunąć dawny.

## Języki

Wpis lub kategoria istnieje w storefroncie w przypisanych mu językach. Żądany w innym języku
daje `404` i nie pojawia się na żadnej liście w tym języku — na stronie głównej bloga, w
kategorii, w tagu, w `/posts`, w powiązanych wpisach, jako etykieta kategorii na karcie ani w
okruszkach wpisu. Język żądania jest najpierw dopasowywany do języków kanału (`en` znajduje
`en-US`). Kategoria bez żadnego przypisanego języka — utworzona przy instalacji `Default` —
jest w każdym.

Aby opublikowany wpis był napisany w każdym ze swoich języków, jego publikacja oraz zapis już
opublikowanego są odrzucane z `422 BLOG_LANGUAGE_INCOMPLETE`, gdy w przypisanym języku brakuje
nazwy — albo treści, jeśli wpis ma treść w jakimkolwiek języku. Szczegóły podają każde brakujące
`<pole>.<język>`. Szkic może być niekompletny. Kategoria wymaga nazwy w każdym swoim języku przy
każdym zapisie.

## Adresy w poszczególnych językach

Wpis lub kategoria może mieć **klucz adresu w każdym języku** — `jak-wybrac-wiertarke` po
polsku, `how-to-choose-a-drill` po angielsku — ustawiany w karcie **Adres** edytora dla
edytowanego języka. Język bez klucza używa bazowego sluga. Klucz:

- działa tylko we własnym języku;
- jest unikalny w kanale sprzedaży i języku wśród wpisów **i** kategorii
  (`409 BLOG_URL_KEY_TAKEN`); ten sam klucz w innym języku jest wolny;
- po zmianie zostawia **przekierowanie**, a bazowy slug języka z własnym kluczem też
  przekierowuje — przekierowania wskazują wpis, nigdy klucz, więc się nie łańcuchują, i działają
  tylko przy włączonym module SEO;
- może przejąć przekierowanie innego wpisu dopiero po potwierdzeniu w edytorze
  (`409 BLOG_URL_KEY_REDIRECT_TAKEOVER_REQUIRED`, potem ten sam `PUT` z `confirmTakeover`).

Zmiana bazowego sluga zostawia dawny slug jako przekierowanie w każdym języku bez klucza.
Odpowiedzi dla wpisu i kategorii zawierają `alternates` — ścieżkę w każdym języku kanału, w
którym istnieją — które storefront zapisuje jako linki `hreflang` i wykorzystuje w przełączniku
języka. Każdy zapis kluczy to jedno audytowane polecenie (`blog.url_keys.update`,
`blog.url_redirect.delete`).

## Autorzy

Wpis może wskazać jednego **autora**: administratora wybieranego w edytorze spośród aktywnych
(`GET /api/v1/admin/blog/author-candidates`, `blog.write` — bez uprawnień administratora;
odpowiada tylko imionami i avatarami). Storefront pokazuje imię i nazwisko autora, avatar oraz
*o mnie* w języku strony (a gdy go brak — w domyślnym języku kanału) na stronie wpisu, imię i
nazwisko na kartach, a w danych strukturalnych wpisu — autora jako `Person`. Avatar i *o mnie*
edytuje się na stronie własnego profilu administratora (zobacz moduł `admin_users`).
Nieaktywny administrator nadal jest pokazywany jako autor; usunięty — nie, i nic o nim nie
zostaje przy wpisie. Odpowiedź z wpisem jest w pamięci podręcznej tylko z identyfikatorem
autora, więc zmiana profilu widać od razu. `GET /api/v1/blog/posts?authorId=…` zwraca wpisy
jednego autora.

## Role w panelu administracyjnym

Przy pierwszym uruchomieniu `services/seed-roles.ts` tworzy dwie role:

| Kod              | Nazwa domyślna      | Uprawnienia                                          |
| ----------------- | ----------------- | ---------------------------------------------------- |
| `blog_manager`    | Blog Manager      | `blog.read`, `blog.write`                            |
| `content_manager` | Content Manager   | `blog.read`, `blog.write`, `cms.read`, `cms.write`   |

Obie są **chronione przez system**: `AdminRoleService.remove` odmawia ich usunięcia z 409
`ADMIN_ROLE_PROTECTED`. Mechanizm uzgadniania zachowuje nazwy zmienione przez administratora po
kolejnych uruchomieniach i odświeża tylko kanoniczną listę uprawnień, gdy się od niej różni.

## API storefrontu

| Metoda | Ścieżka                                  | Zwraca                                                  |
| ------ | ------------------------------------- | -------------------------------------------------------- |
| GET    | `/api/v1/blog/by-channel?page=…`      | `BlogIndexResponse` — strona wpisów (`posts.data`, `posts.pagination`) według `posts_per_page`, kategorie pierwszego poziomu na stronie 1 |
| GET    | `/api/v1/blog/by-slug?slug=…`         | `BlogBySlugResponse` w postaci unii rozłącznej (kategoria / wpis)     |
| GET    | `/api/v1/blog/tag-by-code?code=…`     | `BlogTagByCodeResponse` — stronicowane wpisy z danym tagiem       |
| GET    | `/api/v1/blog/posts?page=…&perPage=…&categorySlug=…&tagCode=…&authorId=…` | `{ data: BlogPostCard[], pagination }` — opublikowane wpisy, od najnowszego, strona po stronie |
| GET    | `/api/v1/blog/routing`                | `BlogRoutingResponse` — prefiks kanału dla każdego języka i dawne prefiksy; `404 BLOG_DISABLED`, gdy blog jest w kanale wyłączony |

W panelu, dla adresów bloga: `GET /api/v1/admin/blog/addresses?salesChannelId=…` (`blog.read`)
wyświetla bieżące i dawne prefiksy, a `DELETE /api/v1/admin/blog/addresses/:id` (`blog.write`)
usuwa dawny — jako audytowane polecenie `blog.url_prefix.forget`.

`/posts` zasila blok najnowszych wpisów i każdego klienta headless. `perPage` (albo jego
starsza nazwa `limit`) to 1–24, domyślnie 6; większa wartość daje `400`. `pagination` podaje
`page`, `perPage`, `totalItems` i `totalPages`; strona poza ostatnią daje pustą listę z
prawdziwymi sumami (strony samego storefrontu dają w tym miejscu `404`). Filtry można łączyć. Nieznany `categorySlug` daje pustą listę zamiast 404, więc
blok, którego kategorię usunięto, po prostu nic nie pokazuje. Kanał z
`blog.enabled = false` także zwraca pustą listę. Każda karta zawiera
`mainImageUrl`, `primaryCategoryName` (etykietę kategorii) i `url`
(`/<blog-prefix>/<slug>`).

Wszystkie cztery:

- odczytują wyznaczony kanał i język z nagłówków żądania (`x-sales-channel`, `x-blog-language` /
  `accept-language`);
- odczytują ustawienia `blog.*` z usługi ustawień uwzględniającej kanał;
- zwracają `404 BLOG_DISABLED` (albo `BLOG_POST_NOT_FOUND` / `BLOG_TAG_NOT_FOUND`), gdy w danym
  zakresie nie ma pasującej treści — z wyjątkiem `/posts`, które zwraca pustą listę;
- korzystają z pamięci podręcznej w Redis przez [`BlogCacheService`](#cache-strategy).

## Strategia pamięci podręcznej {#cache-strategy}

Klucze mają przedrostek `blog:v1:<channelCode>:<language>:` i pięć postaci:

```
blog:v1:<channel>:<language>:index
blog:v1:<channel>:<language>:category:<slug>:p<page>
blog:v1:<channel>:<language>:post:<slug>
blog:v1:<channel>:<language>:tag:<code>:p<page>
blog:v1:<channel>:<language>:list:<categorySlug|*>:n<limit>
```

TTL: 5 minut (tak samo jak w pamięci podręcznej modułu CMS).

Unieważnianie:

| Zdarzenie                                  | Co jest czyszczone                                            |
| -------------------------------------- | ----------------------------------------------- |
| Zapis wpisu, kategorii lub tagu            | `BlogCacheService.invalidateAll()`              |
| Usunięcie miękkie albo zapis ustawień         | `BlogCacheService.invalidateAll()` przez EventBus |

Dokładniejsze `invalidatePost(channelCode, slug)` i podobne metody są już dostępne w klasie pamięci
podręcznej na potrzeby przyszłego, wybiórczego unieważniania (w v1 czyszczenie całości jest
poprawne, bo zapisów jest mało).

## Blok Page Buildera: najnowsze wpisy

Moduł bloga deklaruje jeden blok Page Buildera, `blog.LatestPosts` (sekcja
palety *Treść*, etykieta **Najnowsze wpisy**), który pokazuje najnowsze
opublikowane wpisy kanału sprzedaży strony w jej języku:

| Opcja | Znaczenie |
| --- | --- |
| Nagłówek | Opcjonalny tytuł, tekst wstępu i przycisk nad wpisami. |
| Liczba wpisów | Ile wpisów, 1–12 (domyślnie 6). Na karcie **Data**. |
| Kategoria | Tylko wpisy z tej kategorii; puste oznacza wszystkie. Na karcie **Data**, wybierana spośród kategorii bloga (blok nadal zapisuje slug kategorii, więc blok zapisany wcześniej się nie zmienia). |
| Układ | Karuzela (z opcjami karuzeli: liczba slajdów w widoku dla każdego progu, odstęp, efekt, strzałki i kropki) albo siatka (liczba kolumn dla każdego progu). |
| Etykieta „czytaj więcej” | Tekst linku na każdej karcie. |

Każda karta pokazuje obraz główny (2:1), kategorię główną, tytuł i link
„czytaj więcej”.

**Wygląd karty i nagłówka.** Każda z tych opcji jest domyślnie nieustawiona, co
zachowuje opisaną wyżej kartę; opcje oznaczone *dla każdego progu* ustawia się
na karcie **Responsywność**, a próg bez wartości pokazuje wartość domyślną.

| Opcja | Znaczenie |
| --- | --- |
| Tło karty | Kolor marki albo wartość szesnastkowa pod całą kartą; bez ustawienia — tło sekcji. |
| Zaokrąglone narożniki | Narożniki karty: brak, małe, średnie (domyślnie, 8 px) albo duże. |
| Odstęp wewnątrz karty | Odstęp wokół obrazu i tekstu karty, krok odstępów albo Własny (px) — *dla każdego progu*. |
| Odstęp wokół tekstu | Odstęp nad tekstem pod obrazem i po jego bokach — *dla każdego progu*; bez ustawienia 16 px nad tekstem i nic po bokach. |
| Proporcje obrazu | Proporcje ramki obrazu, gotowe albo Własne (`w:h`) — *dla każdego progu*. |
| Powiększenie po najechaniu | Obraz lekko się powiększa, gdy karta jest wskazana kursorem lub ma fokus (nie przy ograniczonym ruchu). |
| Etykieta kategorii | Wypełniona (domyślnie), obrys albo ukryta. |
| Rozmiar / grubość tytułu karty | Rozmiar z typografii albo Własny (px) i grubość — *dla każdego progu*. |
| Ikona / wyrównanie / grubość linku „czytaj więcej” | Strzałka albo plus za etykietą, link na początku albo na końcu karty i jego grubość. |
| Rozmiar / kolor wprowadzenia | Rozmiar (*dla każdego progu*) i kolor tekstu wstępu w nagłówku. |
| Położenie przycisku nagłówka | Pod wprowadzeniem (domyślnie), na końcu nagłówka (na wysokości wprowadzenia) albo za wpisami i ich przyciskami nawigacji — *dla każdego progu*. |
| Szerokość przycisku nagłówka | Dopasowana do etykiety albo pełna szerokość — *dla każdego progu*. | Wpisy są odczytywane po stronie serwera przez
`GET /api/v1/blog/posts`, więc są w HTML strony. Gdy wpisów nie ma, klienci
nic nie widzą, a podgląd w edytorze pokazuje „No posts”. Jak każdy blok
sekcji, na najwyższym poziomie strony ma ustawienia sekcji (kotwicę, schemat
kolorów, tło, odstępy, szerokość). Teksty nagłówka i linku „czytaj więcej”
można tłumaczyć akcją **Przetłumacz** w Page Builderze.

Gdy moduł bloga jest wyłączony, blok nie jest oferowany w palecie, zapisany blok
nic nie wyświetla, `/api/v1/blog/posts` nie odpowiada, a storefront nie pyta o
wpisy.

## Zależności od innych modułów

| Moduł                                       | Co blog z niego odczytuje                                         |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Ustawienia](../settings/index.md)             | Cztery ustawienia `blog.*` przez `settings.service.get`     |
| [Kanały sprzedaży](../sales_channels/index.md) | Wyznaczanie kanału i język zastępczy                |
| [Biblioteka mediów](../assets-library/index.md) | Podpisywanie adresów plików i rejestr odwołań           |
| [CMS](../cms/index.md)                       | Strukturę treści Page Buildera (`cmsContentEnvelopeSchema`)         |
| [Katalog](../catalog.md)                     | Nic: storefront odczytuje powiązane produkty z publicznej listy (`?ids=`) w imieniu odwiedzającego |

Moduł bloga nigdy nie importuje wnętrza innego modułu — każdy odczyt danych innego modułu przechodzi
przez udokumentowany port usługi.
