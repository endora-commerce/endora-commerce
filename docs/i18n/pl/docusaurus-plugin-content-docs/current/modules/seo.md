---
title: seo
description: Wyznaczanie meta tagów i mapa witryny XML z pamięcią podręczną
---

# `seo`

Wyznaczanie meta tagów dla każdej strony oraz publiczna mapa witryny XML.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/catalog/sitemap.xml` | roboty wyszukiwarek | Mapa witryny XML z pamięci podręcznej; gdy jest nieaktualna, jest generowana od razu w trakcie żądania |
| `POST /api/v1/admin/seo/sitemap/regenerate` | administrator (`catalog:write`) | Wymuszenie ponownego wygenerowania |
| `GET /api/v1/admin/seo/sitemap/status` | administrator | Czas ostatniego wygenerowania, rozmiar i liczba adresów URL |
| `GET /api/v1/admin/seo/meta/:entityType/:entityId` | administrator | Wyznaczone meta tagi i wiersz nadpisania dla (encja, język) |
| `PUT /api/v1/admin/seo/meta/:entityType/:entityId` | administrator | Utworzenie lub aktualizacja nadpisania (dla danego języka) |
| `DELETE /api/v1/admin/seo/meta/:entityType/:entityId` | administrator | Usunięcie nadpisania (wracają wartości wyznaczane z reguły) |

## Wyznaczanie meta tagów

`MetaTagResolverService.resolve({ entityType, entityId, locale })` zwraca
`{ title, description, openGraph, source, locale }`. Kolejność:

1. Wyszukanie wiersza nadpisania dla pary (encja, język).
2. Jeśli pole jest ustawione w nadpisaniu, zostaje użyte dosłownie.
3. W przeciwnym razie używana jest reguła wyprowadzona z encji (nazwa i opis produktu, nazwa
   kategorii i automatyczne podsumowanie).
4. Wartość zastępcza języka dla każdego pola: gdy produkt nie ma tekstu w `pl-PL`, reguła używa
   `en-US`, a potem dowolnego dostępnego języka.

Tytuł i opis są skracane do 60 / 160 znaków z wielokropkiem. Skracanie odbywa się w jednej funkcji
pomocniczej, więc zmiany limitów SEO wprowadza się w jednym miejscu.

## Mapa witryny

`SitemapGeneratorService.regenerate()` przechodzi przez aktywne produkty z publiczną widocznością
oraz niezarchiwizowane i nieusunięte kategorie, buduje bezwzględne adresy URL względem
`STOREFRONT_BASE_URL` i zapisuje treść XML w jednym wierszu `sitemap_cache`.

Trasa publiczna (`GET /catalog/sitemap.xml`) zwraca treść z pamięci podręcznej; gdy wiersz jest
starszy niż `staleAfterMs` (domyślnie 6 h), mapa jest generowana od razu w trakcie żądania.
Odpowiedź ma nagłówek `Cache-Control: public, max-age=3600`, więc poprawnie działające CDN
przechowują ją przez godzinę.

## Tylko to, co widzi anonimowy użytkownik

Mapa witryny pomija:
- produkty ze `status != 'active'`
- produkty z `visibility != 'public'`
- wiersze zarchiwizowane (`archivedAt`) i usunięte miękko (`deletedAt`)
- kategorie usunięte miękko

Zasada jest prosta: robotom wyszukiwarek udostępnia się wyłącznie to, co może zobaczyć anonimowy
klient.

## Encje

`SeoMetaOverride` (entityType, entityId, locale, title?, description?, ogTitle?, ogDescription?,
ogImageUrl?), `SitemapCache` (pojedynczy klucz, treść, urlCount, byteSize, generatedAt).

## Punkty rozszerzenia

- **Strony CMS** — gdy powstanie moduł CMS, podłącz jego slug i treść do
  `MetaTagResolverService.loadRuleSource()` i `SitemapGeneratorService.regenerate()`.
- **Indeks map witryny** — dla katalogów powyżej 50 000 adresów URL podziel mapę na mapy dla
  poszczególnych sekcji i zwracaj `<sitemapindex>` z trasy tego modułu.
- **Generowanie według harmonogramu** — w produkcyjnym composition root podłącz powtarzalne zadanie
  BullMQ, które co noc wywołuje `regenerate()`.
