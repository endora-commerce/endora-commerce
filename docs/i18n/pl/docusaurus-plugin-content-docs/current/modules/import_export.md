---
title: import_export
description: Import i eksport CSV do masowej edycji encji
---

# `import_export`

Import i eksport CSV do masowej edycji danych. Moduł ma własny, niewielki koder i dekoder RFC 4180
(bez nowej zależności), rejestr adapterów dla poszczególnych encji oraz **profile importu**, według
których import produktów mapuje języki źródłowe.

## API publiczne

| Metoda + ścieżka | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/import-export/entities` | administrator (dowolne uprawnienie encji z tabeli poniżej) | Encje dostępne dla wywołującego, z `canExport` / `canImport` |
| `GET /api/v1/admin/export/:entity.csv` | administrator (uprawnienie eksportu encji) | Strumieniowe pobranie CSV z nagłówkami załącznika |
| `POST /api/v1/admin/import/:entity` | administrator (uprawnienie importu encji) | Zastosowanie treści `text/csv` (plik produktów najwyżej 10 MiB; pozostałe encje domyślny limit serwera) |
| `GET /api/v1/admin/import-export/profiles?entity=products` | administrator (`catalog:write`) | Lista profili importu |
| `GET /api/v1/admin/import-export/profiles/:id` | administrator (`catalog:write`) | Jeden profil importu |
| `POST /api/v1/admin/import-export/profiles` | administrator (`catalog:write`) | Utworzenie profilu importu |
| `PATCH /api/v1/admin/import-export/profiles/:id` | administrator (`catalog:write`) | Zmiana profilu importu |
| `DELETE /api/v1/admin/import-export/profiles/:id` | administrator (`catalog:write`) | Usunięcie profilu importu |
| `GET /api/v1/admin/import-export/channel-targets` | administrator (`catalog:write`) | Kanały, do których profil może zapisywać: tylko identyfikator, kod i języki |

## Obsługiwane encje

Każda encja wymaga uprawnienia, które chroni te same dane na trasach modułu będącego ich
właścicielem, więc centrum nie otwiera niczego, czego rola nie może już zobaczyć tam. Aby w ogóle
wejść do centrum, trzeba mieć co najmniej jedno z tych uprawnień; wywołujący widzi tylko encje,
do których ma uprawnienie.

| Encja | Eksport | Import | Uprawnienie eksportu | Uprawnienie importu | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `products` | ✓ | ✓ | `catalog:read` | `catalog:write` | Kolumny globalne, kanału oraz kanału i języka; import wymaga profilu i zapisuje produkty pojedynczo; `type` produktu nie można zmienić po utworzeniu |
| `categories` | ✓ | ✓ | `catalog:read` | `catalog:write` | Kategorie nadrzędne są wskazywane przez `parent_slug`; wiersze kategorii nadrzędnych muszą występować przed podrzędnymi |
| `stock` | ✓ | ✓ | `inventory:read` | `inventory:write` | Operatorzy zmieniają tylko `on_hand`; rezerwacje są tylko do odczytu |
| `customers` | ✓ | — | `customers:read` | — | Import celowo nieobsługiwany — masowe tworzenie kont wymaga historii haseł, której nie da się przekazać w pliku CSV |
| `orders` | ✓ | — | `orders:read` | — | Zamówienia powstają w procesie checkoutu; import historycznych zamówień ominąłby stany magazynowe, płatności i limity kredytowe |

Przedstawiciel handlowy ograniczony do przypisanych organizacji eksportuje tylko klientów
i zamówienia tych organizacji — te same wiersze, które widzi na listach klientów i zamówień.

Arkusz klientów ma kolumny `email`, `organization_name`, `first_name`, `last_name`,
`organization_role_name`, `organization_role_kind`, `email_verified_at` i `last_login_at`.
`organization_role_name` to nazwa roli, którą konto ma w swojej organizacji (angielska etykieta
dla ról predefiniowanych *Administrator* i *Member*, własna nazwa roli niestandardowej).
`organization_role_kind` przyjmuje wartość `administrator`, `member` lub `custom`. Zastępują one
kolumnę `role` (`organization_admin` / `regular_user`) z wcześniejszych wersji.

## Jak działa import (każda encja poza produktami)

Import działa w jednej transakcji. Jeśli którykolwiek wiersz nie przejdzie walidacji, cała paczka
jest wycofywana, a odpowiedź podaje błędy według numerów wierszy (wiersz nagłówka to wiersz 1),
tak jak pokazują je arkusze kalkulacyjne. Dzięki temu ponowne wgranie poprawionego pliku daje
przewidywalny wynik.

## Import produktów

### Profile importu

Import produktów zawsze korzysta z **profilu importu**:
`POST /api/v1/admin/import/products?profileId=<uuid>`. Bez profilu odpowiedź to
`422 IMPORT_PROFILE_REQUIRED`; nieznany identyfikator to `404 IMPORT_PROFILE_NOT_FOUND`.

Profil określa:

- `sourceLanguageForGlobal` — język pliku, którego wartości stają się wartością **globalną**
  (na przykład `en_US`), albo `null`, gdy żaden język nie zapisuje wartości globalnej;
- `localeMapping` — dla każdego języka źródłowego (i opcjonalnie kanału źródłowego) pary kanał
  sprzedaży i język, do których zapisuje.

Profil jest odczytywany raz na początku przebiegu, więc jego zmiana w trakcie przebiegu nie wpływa
na ten przebieg. Nazwy profili są unikalne bez względu na wielkość liter
(`409 IMPORT_PROFILE_NAME_TAKEN`). W panelu administracyjnym sekcja **Profile importu** na ekranie
Import / Eksport pozwala przeglądać, tworzyć, edytować i usuwać profile; widzą ją tylko operatorzy
z uprawnieniem `catalog:write`.

### Najpierw import próbny

`&dryRun=true` analizuje, mapuje i waliduje cały plik, łącznie z kontrolami katalogu, i niczego nie
zapisuje. Ekran panelu zawsze wykonuje go najpierw i przed **Zastosuj import** pokazuje:

- liczbę wierszy, które zostałyby zaimportowane i odrzucone;
- dla każdej kolumny liczbę komórek `NULL` i `INHERIT`;
- jedno ostrzeżenie na każdy język źródłowy, którego profil nie mapuje, z liczbą produktów, których
  dotyczy;
- odrzucone wiersze i odrzucone komórki.

### Jedna transakcja na produkt

Każdy wiersz produktu jest zapisywany we własnej transakcji. Odrzucony wiersz nie cofa pozostałych
wierszy, a odrzucona komórka nie cofa reszty swojego wiersza. Ponowne uruchomienie tego samego pliku
jest bezpieczne: zapisuje te same wartości jeszcze raz.

### Kolumny

| Kolumna | Znaczenie |
| --- | --- |
| `sku` | Klucz produktu (wymagany). |
| `id`, `slug`, `type` | Zapisywane przez eksport, pomijane przez import. |
| `visibility` | Tylko poziom globalny. |
| `name`, `description`, `urlKey`, `status`, `minOrderQuantity`, `returnable`, `attribute:<key>` | Wartość **globalna**. |
| `<field>@<channel code>` | Wartość **kanału**, na przykład `name@pl_b2b_vip`. |
| `<field>@<channel code>/<language>` | Wartość **kanału i języka**, na przykład `description@pl_retail/en-US`. Nie dotyczy `minOrderQuantity` ani `returnable`, które nie mają tego poziomu. |
| `<field>[<locale>]`, `<field>[<locale>\|<source channel>]` | Wartość języka źródłowego, zapisywana tam, dokąd profil mapuje ten język. |

`minOrderQuantity` to liczba, `returnable` to `true` albo `false`, a atrybut wielokrotnego wyboru
podaje wartości opcji rozdzielone znakiem `|`.

Atrybut z treścią Page Builder edytuje się wyłącznie na ekranie treści produktu, dlatego nigdy nie
jest eksportowany, a niepusta komórka w jego kolumnie `attribute:<key>` jest odrzucana dla tej komórki
(`content_attribute`); reszta wiersza jest importowana.

Nagłówek niepasujący do żadnej z tych reguł, dwa nagłówki wskazujące tę samą kolumnę, nieznany kod
kanału albo język, którego kanał nie oferuje, powodują odrzucenie **całego pliku**
(`400 VALIDATION_FAILED`, nic nie zostaje zaimportowane). Plik jest odrzucany także powyżej
50 000 wierszy lub 500 kolumn. Kolumna ceny jest odrzucana: ceny ustawia się w cennikach.

**Aktualizacja pliku z kolumnami dla języków.** Przed funkcją 174 plik produktów miał osobną
kolumnę dla każdego języka, na przykład `name_en` albo `description_pl`. Takie nagłówki powodują
teraz odrzucenie całego pliku. Zmień nazwę każdego z nich na zakres, który ma zapisywać: `name_en`
staje się `name@<channel>/en-US` dla każdego kanału sprzedającego po angielsku albo `name[en_US]`
z profilem, który mapuje `en_US`.

### Wartości komórek

| Komórka | Znaczenie |
| --- | --- |
| pusta | Bez zmian. |
| `NULL` (dokładnie, cała komórka) | Celowo puste. Dla `minOrderQuantity`: brak minimum. Dla atrybutu wielokrotnego wyboru: nic nie jest wybrane. |
| `INHERIT` (dokładnie, cała komórka) | Usuń własną wartość i użyj wartości z poziomu wyżej. |
| `\NULL`, `\INHERIT` | Teksty `NULL` i `INHERIT`. |
| cokolwiek innego | Wartość. |

Tokeny są pisane wielkimi literami i muszą wypełniać całą komórkę: `null` albo ` NULL ` to zwykły
tekst. `NULL` w polu wymaganym (`name`, `urlKey`, wymagany atrybut), `NULL` w `status`,
`visibility` lub `returnable` oraz `INHERIT` w kolumnie globalnej są odrzucane dla tej komórki.

**Ochrona przed formułami.** Arkusze kalkulacyjne wykonują komórkę zaczynającą się od `=`, `+`,
`-`, `@`, tabulatora albo znaku powrotu karetki jako formułę. Dlatego eksport poprzedza taki tekst
znakiem `'`, a import usuwa dokładnie jeden początkowy `'` z kolumny tekstowej. Kolumny wyboru
i wielokrotnego wyboru są tu traktowane jak tekstowe: wartości ich opcji mogą pochodzić z PIM.
Kolumny liczbowe i logiczne nigdy nie są zmieniane.

### Raport

```json
{
  "data": {
    "imported": 2,
    "dryRun": true,
    "errors": [{ "rowNumber": 4, "reason": "unknown sku: SKU-XYZ" }],
    "fieldErrors": [{ "rowNumber": 3, "column": "name@pl_b2b_vip", "code": "required_empty" }],
    "cellCounts": [{ "column": "description@pl_retail/pl-PL", "null": 3, "inherit": 1 }],
    "warnings": [{ "kind": "unmapped_locale", "locale": "fr_FR", "sourceChannel": null, "products": 7 }]
  }
}
```

Raport wymienia najwyżej 1 000 błędów wierszy i 1 000 odrzuconych komórek. Gdy jest ich więcej,
zawiera też `"truncated": { "errors": <wszystkie błędy wierszy>, "fieldErrors": <wszystkie odrzucone komórki> }`;
popraw wymienione i sprawdź plik ponownie.

### Eksport

`GET /api/v1/admin/export/products.csv` nie korzysta z profilu. Zapisuje kolumny globalne oraz
jedną kolumnę `<field>@<channel>` lub `<field>@<channel>/<language>` wszędzie tam, gdzie którykolwiek
produkt ma własną wartość. Produkt, który w tym miejscu dziedziczy, dostaje `INHERIT`, celowo pusta
wartość to `NULL`, a tekst równy tokenowi jest poprzedzany znakiem ucieczki. Import niezmienionego
pliku z eksportu nie zapisuje niczego nowego.

```http
POST /api/v1/admin/import/products?profileId=7c2e…&dryRun=true
Content-Type: text/csv

sku,name,name@pl_b2b_vip/pl-PL,description@pl_retail,minOrderQuantity
SKU-001,Drill X,Wiertarka X,NULL,5
```

## Punkty rozszerzenia

- **Nowa encja** — zaimplementuj `ImportExportAdapter` (`name`, `owners`, `exportPermission`,
  `exportHeader`, `exportRows`, opcjonalnie `importPermission`, `importHeader` i `importRows`),
  zarejestruj go w `import-export-service.ts` i dopisz jego uprawnienia do bramki „dowolne z”
  w `routes.ts` oraz do `requiredPermission` trasy panelu administracyjnego.
- **Inny separator albo specyfika Excela** — rozszerz `csv-codec.ts`. RFC 4180 obejmuje typowe
  przypadki; gdy rzeczywisty plik sprawi problem, to jedyne miejsce, które trzeba zmienić.
- **Eksport strumieniowy** — wczytywanie do pamięci bez problemu obsługuje setki tysięcy wierszy;
  przy regularnym eksporcie milionów wierszy zastąp `serializeCsv` asynchronicznym iteratorem
  przekazującym dane do `reply.raw` w Fastify.
