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

Storefront ma jedną trasę Next.js przechwytującą wszystkie ścieżki,
`storefront/app/(blog)/[[...slug]]/page.tsx`. Mechanizm dopasowania odczytuje wyznaczone dla kanału
`blog.url_prefix` z [modułu ustawień](../settings/index.md) i kieruje żądanie:

| Wzorzec adresu (po wyznaczeniu kanału) | Wyświetla                              |
| -------------------------------------- | ------------------------------------ |
| `/<prefix>`                            | Strona główna bloga — najnowsze wpisy i kategorie pierwszego poziomu |
| `/<prefix>/tag/<code>`                 | Widok tagu — stronicowane karty wpisów z tym tagiem |
| `/<prefix>/<slug>`                     | Strona kategorii (gdy slug pasuje do `blog_categories.slug`) |
| `/<prefix>/<slug>`                     | Strona wpisu (gdy slug pasuje do `blog_posts.slug`) |

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
| `blog.url_prefix`     | string  | `blog`  | Jeden segment adresu, `^[a-z0-9-]+$`. Segmenty zarezerwowane przez Next.js są odrzucane. |
| `blog.latest_count`   | number  | `5`     | Liczba najnowszych wpisów na stronie głównej bloga.                            |
| `blog.posts_per_page` | number  | `12`    | Liczba wpisów na stronie w widokach kategorii i tagu.           |

Zmiana dowolnego ustawienia `blog.*` czyści wspólną pamięć podręczną ustawień w miejscu zapisu, a
potem emituje zdarzenie `EventBus`, które czyści pamięć podręczną storefrontu (zobacz *Strategia
pamięci podręcznej* niżej).

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
| GET    | `/api/v1/blog/by-channel`             | `BlogIndexResponse` — najnowsze wpisy i kategorie pierwszego poziomu |
| GET    | `/api/v1/blog/by-slug?slug=…`         | `BlogBySlugResponse` w postaci unii rozłącznej (kategoria / wpis)     |
| GET    | `/api/v1/blog/tag-by-code?code=…`     | `BlogTagByCodeResponse` — stronicowane wpisy z danym tagiem       |
| GET    | `/api/v1/blog/posts?limit=…&categorySlug=…` | `{ data: BlogPostCard[] }` — najnowsze opublikowane wpisy, od najnowszego |

`/posts` zasila blok najnowszych wpisów. `limit` to 1–24 (domyślnie 6); większa
wartość daje `400`. Nieznany `categorySlug` daje pustą listę zamiast 404, więc
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
