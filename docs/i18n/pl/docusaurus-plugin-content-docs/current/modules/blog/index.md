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

Cały schemat znajduje się w `037_blog_init.ts` (jedenaście nowych tabel, wszystkie z przedrostkiem
`blog_*`) i nigdy nie zmienia istniejących tabel.

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
5. **Usunięcie miękkie pliku z biblioteki osadzonego w treści wpisu lub opisie kategorii** →
   409 `ASSET_REFERENCED` (deskryptory zarejestrowane w
   [rejestrze odwołań biblioteki mediów](../assets-library/index.md#asset-reference-registry)).

Powiązanie wpisu jako wpisu powiązanego działa inaczej: **odłączenie przy usunięciu**. Gdy wpis
zostaje usunięty miękko, lista `relatedPostIds` każdego wpisu, który go wskazywał, atomowo się
skraca. Administrator widzi okno potwierdzenia z listą tych wpisów (na podstawie
`/posts/:id/inbound-references`).

Powiązanie wpisu z produktem korzysta z **usunięcia miękkiego i filtrowania w storefroncie**:
produkt usunięty miękko jest niewidoczny przy następnym odczycie w storefroncie, a wiersz łączący
pozostaje. Ogólny `ProductReferenceRegistry` może powstać w ramach kolejnej zmiany.

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

Wszystkie trzy:

- odczytują wyznaczony kanał i język z nagłówków żądania (`x-sales-channel`, `x-blog-language` /
  `accept-language`);
- odczytują ustawienia `blog.*` z usługi ustawień uwzględniającej kanał;
- zwracają `404 BLOG_DISABLED` (albo `BLOG_POST_NOT_FOUND` / `BLOG_TAG_NOT_FOUND`), gdy w danym
  zakresie nie ma pasującej treści;
- korzystają z pamięci podręcznej w Redis przez [`BlogCacheService`](#cache-strategy).

## Strategia pamięci podręcznej {#cache-strategy}

Klucze mają przedrostek `blog:v1:<channelCode>:<language>:` i cztery postacie:

```
blog:v1:<channel>:<language>:index
blog:v1:<channel>:<language>:category:<slug>:p<page>
blog:v1:<channel>:<language>:post:<slug>
blog:v1:<channel>:<language>:tag:<code>:p<page>
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

## Zależności od innych modułów

| Moduł                                       | Co blog z niego odczytuje                                         |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Ustawienia](../settings/index.md)             | Cztery ustawienia `blog.*` przez `settings.service.get`     |
| [Kanały sprzedaży](../sales_channels/index.md) | Wyznaczanie kanału i język zastępczy                |
| [Biblioteka mediów](../assets-library/index.md) | Podpisywanie adresów plików i rejestr odwołań           |
| [CMS](../cms/index.md)                       | Strukturę treści Page Buildera (`cmsContentEnvelopeSchema`)         |
| [Katalog](../catalog.md)                     | Karty produktów dla powiązanych produktów           |

Moduł bloga nigdy nie importuje wnętrza innego modułu — każdy odczyt danych innego modułu przechodzi
przez udokumentowany port usługi.
