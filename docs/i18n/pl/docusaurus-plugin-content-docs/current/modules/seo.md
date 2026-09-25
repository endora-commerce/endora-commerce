---
title: seo
description: Resolver meta-tagów + cache'owana mapa witryny XML
---

# `seo`

Rozwiązywanie meta-tagów per strona oraz publiczna mapa witryny XML.

## Publiczne API

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/catalog/sitemap.xml` | crawlers | Cache'owana mapa witryny XML; przy przeterminowaniu przechodzi do inline regenerate |
| `POST /api/v1/admin/seo/sitemap/regenerate` | admin (`catalog:write`) | Wymuszenie świeżej budowy |
| `GET /api/v1/admin/seo/sitemap/status` | admin | Znacznik czasu ostatniej generacji + rozmiar + liczba URL |
| `GET /api/v1/admin/seo/meta/:entityType/:entityId` | admin | Rozwiązane meta + wiersz override dla (entity, locale) |
| `PUT /api/v1/admin/seo/meta/:entityType/:entityId` | admin | Upsert override (per locale) |
| `DELETE /api/v1/admin/seo/meta/:entityType/:entityId` | admin | Usunięcie override (resolver wraca do outputu reguły) |

## Rozwiązywanie meta-tagów

`MetaTagResolverService.resolve({ entityType, entityId, locale })` zwraca
`{ title, description, openGraph, source, locale }`. Kolejność rozwiązywania:

1. Wyszukanie wiersza override per-(entity, locale).
2. Gdy pole jest ustawione w override, użycie go dosłownie.
3. W przeciwnym razie fallback do reguły wyprowadzonej z encji (nazwa Product +
   opis, nazwa Category + auto-summary).
4. Fallback locale per pole: gdy Product nie ma tekstu `pl-PL`, reguła
   używa `en-US`, potem dowolnego dostępnego locale.

Title i description są obcinane przy 60 / 160 znakach z wielokropkiem.
Obcinanie żyje w jednym helperze, więc zmiany budżetu SEO następują w
jednym miejscu.

## Mapa witryny

`SitemapGeneratorService.regenerate()` przechodzi aktywne produkty z
publiczną widocznością, niezarchiwizowane i nieusunięte kategorie, stempluje
bezwzględne URL względem `STOREFRONT_BASE_URL` i zapisuje payload XML do
singletonowego wiersza `sitemap_cache`.

Trasa publiczna (`GET /catalog/sitemap.xml`) zwraca cache'owany payload;
gdy wiersz jest starszy niż `staleAfterMs` (domyślnie 6 h), regeneruje
inline. Nagłówek `Cache-Control: public, max-age=3600` jest ustawiany na
odpowiedzi, aby poprawnie zachowujące się CDN trzymały payload przez godzinę.

## Filtrowanie tylko dla anonimowych

Mapa witryny wyklucza:
- produkty ze `status != 'active'`
- produkty z `visibility != 'public'`
- zarchiwizowane (`archivedAt`) i soft-deleted (`deletedAt`) wiersze
- soft-deleted kategorie

Kontrakt jest prosty: tylko to, co anonimowy Customer może zobaczyć, jest
kiedykolwiek eksponowane crawlerom.

## Encje

`SeoMetaOverride` (entityType, entityId, locale, title?, description?,
ogTitle?, ogDescription?, ogImageUrl?), `SitemapCache` (singleton key,
payload, urlCount, byteSize, generatedAt).

## Punkty rozszerzenia

- **Strony CMS** — gdy moduł CMS zostanie dostarczony, podłącz jego slug + body
  do `MetaTagResolverService.loadRuleSource()` i
  `SitemapGeneratorService.regenerate()`.
- **Indeks map witryn** — dla katalogów > 50 000 URL, podziel na mapy per sekcja
  i emituj `<sitemapindex>` z trasy tego modułu.
- **Zaplanowana regeneracja** — podłącz powtarzalny BullMQ w produkcyjnym
  composition root, który wywołuje `regenerate()` nocnie.
