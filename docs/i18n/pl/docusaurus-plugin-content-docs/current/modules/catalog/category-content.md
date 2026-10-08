---
title: Treść strony kategorii
---

# Treść strony kategorii

Treść, którą operator przygotowuje dla strony jednej kategorii w sklepie — wprowadzenie, baner,
poradnik zakupowy — wyświetlana nad listą produktów. Jest to dokument Page Buildera, więc może
zawierać wszystko, co oferuje Page Builder, w tym tekst formatowany w bloku tekstu sformatowanego.

## Dla operatorów

Otwórz **Katalog → Kategorie** i w wierszu kategorii wybierz **Treść**. Ekran treści zawiera:

- przełącznik **języka** — treść jest przechowywana osobno dla każdego języka, tak jak nazwa
  kategorii. Każdy język ma własny dokument, a dla języka pozostawionego bez treści sklep pokazuje
  treść w innym języku zamiast pustego miejsca;
- obszar roboczy **Page Buildera** dla wybranego języka;
- przycisk **Zapisz treść** — jedno zapisanie utrwala wszystkie edytowane języki.

Sklep pokazuje zapisaną zmianę przy następnej wizycie na stronie kategorii.

Aby usunąć treść, usuń z dokumentu wszystkie bloki i zapisz. Kategoria bez treści pokazuje listę
produktów dokładnie tak jak dotąd.

Akcja **Treść** jest widoczna tylko wtedy, gdy włączony jest moduł dostarczający Page Builder
(moduł CMS) i masz do niego dostęp. Zapisana już treść pozostaje zachowana, gdy ten moduł jest
wyłączony.

## W sklepie

Strona kategorii wyświetla treść między nagłówkiem kategorii a paskiem narzędzi listy, wyłącznie
na **pierwszej stronie** listy — klient przeglądający kolejne strony produktów nie widzi
wprowadzenia ponownie nad każdą z nich.

Dokument jest dobierany do jednego języka w tej kolejności: język klienta, domyślny język kanału
sprzedaży, angielski, a następnie dowolny język, który ma treść. Język, którego dokument nie
zawiera żadnego bloku, jest pomijany.

Treść podlega widoczności kategorii: kategoria nieaktywna albo znajdująca się pod nieaktywną
kategorią nadrzędną nie ma strony, a jej treść nie jest udostępniana.

Bloki rysuje renderer Page Buildera w storefroncie — ten sam, który rysuje strony CMS — więc HTML
wpisany przez operatora jest oczyszczany w ten sam sposób, a blok należący do wyłączonego modułu
nie jest rysowany.

## Dla integratorów

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/catalog/categories/:id/content` | storefront | Dokument dobrany do nagłówka `Accept-Language` wywołującego: `{ categoryId, language, content }`. `content` ma wartość `null`, gdy nie przygotowano treści. `404` dla kategorii, której nie zawiera drzewo kategorii |
| `GET /api/v1/admin/catalog/categories/:id/content` | administrator (`catalog:read`) | Cała koperta: `{ categoryId, content }`, gdzie `content` = `{ languages: { "<code>": <document> } }` albo `null` |
| `PUT /api/v1/admin/catalog/categories/:id/content` | administrator (`catalog:write`) | Zastępuje kopertę. `{ "content": null }` ją czyści |

Koperta jest taka sama jak dla strony CMS i jest ograniczona do 1 MiB danych JSON łącznie dla
wszystkich języków. Każdy dokument jest przechowywany w postaci zapisanej przez Page Builder i
ten moduł nie interpretuje jego zawartości.

Lista kategorii (`GET /api/v1/admin/catalog/categories`) ani drzewo kategorii **nie** zawierają
treści; nie trafia ona też do indeksu wyszukiwarki, plików produktowych, importu ani eksportu.

Zapis uruchamia polecenie `category.content.update` — wpis audytu rejestruje, które języki
zawierała koperta, a nie same dokumenty — i emituje `category.content.updated.v1`, po którym
czyszczona jest pamięć podręczna kategorii w storefroncie. Nie emituje `category.updated.v1`,
więc zapis treści nie powoduje ponownego indeksowania produktów kategorii.

Schematy to `categoryContentEnvelopeSchema`, `putCategoryContentRequestSchema`,
`adminCategoryContentSchema` i `categoryPageContentSchema` w `@endora-commerce/contracts`.

## Dostarczanie edytora

Ekran treści jest właścicielem dokumentu, ale nie edytora: renderuje strefę panelu
administracyjnego `category.content.editor` i zapisuje to, co strefa zgłosi. Moduł, który ma
Page Builder, wnosi tam komponent; jego właściwości to `{ categoryId, language, data, onChange }`,
gdzie `data` to dokument do otwarcia, a `onChange` zgłasza każdą zmianę. Moduł wnoszący edytor
nigdy nie zapisuje.
