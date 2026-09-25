---
title: Blog
sidebar_position: 16
description: Posty redakcyjne z treścią Page Buildera, taksonomią (Categories + Tags) i feedami storefront
---

# Blog

Moduł Blog posiada redakcyjną powierzchnię bloga storefront — Posts,
Categories i Tags — składane w tym samym drag-and-drop **Page
Builderze**, który dostarcza [moduł CMS](../cms/index.md). Posty
dziedziczą kształt pól CMS Page (slug, cykl życia statusu, treść per język,
meta SEO) i dodają blog-specific affordances: drzewo Category nadrzędnej,
swobodne Tags, uporządkowane Related Posts i uporządkowane Related
Products.

| Entity         | Identifier             | Lifecycle                            | Embedded by                                              |
| -------------- | ---------------------- | ------------------------------------ | -------------------------------------------------------- |
| **Post**       | `slug` (per channel)   | `draft → published → archived`       | URL `<blog-prefix>/<slug>` on the storefront             |
| **Category**   | `slug` (per channel)   | `enabled` flag, tree-structured      | URL `<blog-prefix>/<slug>` (siblings of Posts) and tiles |
| **Tag**        | `code` (global)        | block-on-delete                      | URL `<blog-prefix>/tag/<code>` and per-Post chip strip   |

## Encje i graf referencji

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

Schemat żyje w całości w `037_blog_init.ts` (jedenaście nowych tabel, wszystkie
z prefiksem `blog_*`) i nigdy nie dotyka istniejących tabel.

## URL-e i routing

Storefront montuje pojedynczy Next.js catch-all pod
`storefront/app/(blog)/[[...slug]]/page.tsx`. Matcher czyta
channel-resolved `blog.url_prefix` z [modułu Settings](../settings/index.md)
i dispatchuje:

| URL pattern (after channel resolution) | Renders                              |
| -------------------------------------- | ------------------------------------ |
| `/<prefix>`                            | Indeks bloga — latest N + Categories pierwszego poziomu |
| `/<prefix>/tag/<code>`                 | Widok Tag — paginowane karty dla Tag |
| `/<prefix>/<slug>`                     | Strona Category (gdy slug pasuje do `blog_categories.slug`) |
| `/<prefix>/<slug>`                     | Strona Post (gdy slug pasuje do `blog_posts.slug`) |

Rozwiązywanie dispatch odbywa się w **jednym** wywołaniu backend — `GET /api/v1/blog/by-slug?slug=…` — które zwraca discriminated union (`{ kind: 'category' | 'post', … }`). Dwa kanały MOGĄ używać tego samego slug dla niepowiązanych encji (kontekst kanału rozstrzyga).

### Unikalność slug

Unikalność slug jest egzekwowana **per `(sales_channel, slug)` w unii
`blog_posts` i `blog_categories`**:

- Partial unique indexes na poziomie DB na każdym wierszu scope (`*_sales_channels`)
  łapią każdy bug aplikacji omijający check serwisowy.
- Helper `BlogSlugCollision.assertSlugAvailable` pobiera
  Postgres `pg_advisory_xact_lock` per `(channel, slug)`, żeby równoległy
  zapis nie wcisnął duplikatu mimo per-table indexes.
- Literal `tag` jest zarezerwowany jako slug (kolidowałby ze wzorcem URL
  `<prefix>/tag/<code>`).

## Cykl życia

### Posts

```
draft ─── publish ────► published ─── unpublish ───► draft
                            │                           │
                            │ archive                   │
                            ▼                           ▼
                        archived  ◄── unarchive ── (admin)
```

`published_at` jest ustawiane przy pierwszym przejściu do `published` i
zachowywane przez kolejne unpublish / archive (re-publikacja posta
nie resetuje daty publikacji). Post renderuje się na storefront, gdy:

```
status = 'published'
AND active = true
AND deleted_at IS NULL
AND requested-channel ∈ post.salesChannels
AND blog.enabled[channel] = true
```

### Categories

Categories niosą pojedynczą flagę `enabled` (bez draft / publish). Seedowany
wiersz `Default` jest chroniony systemowo — admini mogą go przemianować, zmienić
metadane lub odłączyć od kanałów, ale nie mogą go usunąć.

## Ochrona referencji

Pięć strażników blokuje operacje destrukcyjne:

1. **Usunięcie Tag z odwołującymi postami** → 409 `BLOG_TAG_IN_USE`.
2. **Usunięcie Category z odwołującymi postami** → 409 `BLOG_CATEGORY_IN_USE`.
3. **Usunięcie Category z wierszami potomnymi** → 409 `BLOG_CATEGORY_HAS_CHILDREN`.
4. **Usunięcie seedowanej Category `Default`** → 409 `BLOG_CATEGORY_PROTECTED`.
5. **Soft-delete Assetu biblioteki osadzonego w treści Post lub opisie Category** →
   409 `ASSET_REFERENCED` (deskryptory zarejestrowane w
   [rejestrze referencji Assets Library](../assets-library/index.md#asset-reference-registry)).

Relacja Post-as-Related-Post używa innego kontraktu:
**detach-on-delete**. Gdy Post jest soft-deletowany, każdy parent Post
`relatedPostIds` kurczy się atomowo. Admin widzi dialog potwierdzenia
listujący dotkniętych rodziców (sterowany przez probe
`/posts/:id/inbound-references`).

Relacja Post-as-Related-Product używa **soft-delete-+-storefront-filter**: soft-deletowany produkt jest niewidoczny przy następnym odczycie storefront; wiersz join pozostaje. Generyczny `ProductReferenceRegistry` może pojawić się w follow-up.

## Settings

| Code                  | Type    | Default | Notes                                                |
| --------------------- | ------- | ------: | ---------------------------------------------------- |
| `blog.enabled`        | boolean | `true`  | Wyłącza namespace per kanał.                         |
| `blog.url_prefix`     | string  | `blog`  | Pojedynczy segment URL, `^[a-z0-9-]+$`. Zarezerwowane segmenty Next.js są odrzucane. |
| `blog.latest_count`   | number  | `5`     | Latest posts na indeksie.                            |
| `blog.posts_per_page` | number  | `12`    | Rozmiar strony na widokach Category i Tag.           |

Zmiana dowolnego ustawienia `blog.*` usuwa platform-wide cache settings przy
write seam, potem emituje zdarzenie `EventBus`, które czyści cache storefront
(zob. Cache strategy poniżej).

## Role admin

Dwie role seedują się przy first boot przez `services/seed-roles.ts`:

| Code              | Default name      | Permissions                                          |
| ----------------- | ----------------- | ---------------------------------------------------- |
| `blog_manager`    | Blog Manager      | `blog.read`, `blog.write`                            |
| `content_manager` | Content Manager   | `blog.read`, `blog.write`, `cms.read`, `cms.write`   |

Obie są **chronione systemowo**: `AdminRoleService.remove` odmawia delete
z 409 `ADMIN_ROLE_PROTECTED`. Reconciler zachowuje nazwy edytowane przez admina
po rebootach i odświeża tylko kanoniczną tablicę permissions,
gdy odjechała.

## Storefront API

| Method | Path                                  | Returns                                                  |
| ------ | ------------------------------------- | -------------------------------------------------------- |
| GET    | `/api/v1/blog/by-channel`             | `BlogIndexResponse` — latest N + Categories pierwszego poziomu |
| GET    | `/api/v1/blog/by-slug?slug=…`         | Discriminated `BlogBySlugResponse` (category / post)     |
| GET    | `/api/v1/blog/tag-by-code?code=…`     | `BlogTagByCodeResponse` — paginowane posty dla Tag       |

Wszystkie trzy:

- czytają rozwiązany kanał + język z nagłówków requestu (`x-sales-channel`, `x-blog-language` / `accept-language`);
- czytają ustawienia `blog.*` z channel-aware Settings service;
- zwracają `404 BLOG_DISABLED` (lub `BLOG_POST_NOT_FOUND` / `BLOG_TAG_NOT_FOUND`), gdy rozwiązany scope nie ma pasującej treści;
- korzystają z Redis read-through [`BlogCacheService`](#cache-strategy).

## Strategia cache

Klucze żyją pod `blog:v1:<channelCode>:<language>:` w czterech kształtach:

```
blog:v1:<channel>:<language>:index
blog:v1:<channel>:<language>:category:<slug>:p<page>
blog:v1:<channel>:<language>:post:<slug>
blog:v1:<channel>:<language>:tag:<code>:p<page>
```

TTL: 5 minut (zgodnie z cache modułu CMS).

Invalidacja:

| Event                                  | Wipe                                            |
| -------------------------------------- | ----------------------------------------------- |
| Zapis Post / Category / Tag            | `BlogCacheService.invalidateAll()`              |
| Soft-delete lub zapis settings         | `BlogCacheService.invalidateAll()` via EventBus |

Granularne `invalidatePost(channelCode, slug)` i podobne są podpięte
na klasie cache pod przyszłą chirurgiczną invalidację (coarse
invalidation jest poprawna w v1; tempo zapisów jest niskie).

## Zależności cross-module

| Module                                       | What the blog reads                                         |
| -------------------------------------------- | ----------------------------------------------------------- |
| [Settings](../settings/index.md)             | Cztery ustawienia `blog.*` przez `settings.service.get`     |
| [Sales Channels](../sales_channels/index.md) | Rozwiązywanie kanału + fallback języka                |
| [Assets Library](../assets-library/index.md) | Podpisywanie URL assetów + rejestr referencji           |
| [CMS](../cms/index.md)                       | Envelope Page Buildera (`cmsContentEnvelopeSchema`)         |
| [Catalog](../catalog.md)                     | Rozwiązywanie kart produktów dla Related Products           |

Moduł blog nigdy nie importuje wnętrza innego modułu — każdy odczyt cross-module idzie przez udokumentowany port serwisowy.
