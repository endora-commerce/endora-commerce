---
title: import_export
description: Import i eksport CSV do masowej edycji encji
---

# `import_export`

Import i eksport CSV do masowej edycji danych. Moduł ma własny, niewielki koder i dekoder RFC 4180
(bez nowej zależności) oraz rejestr adapterów dla poszczególnych encji.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/import-export/entities` | administrator (dowolne uprawnienie encji z tabeli niżej) | Encje, z których może korzystać wywołujący, z polami `canExport` / `canImport` |
| `GET /api/v1/admin/export/:entity.csv` | administrator (uprawnienie eksportu encji) | Pobranie CSV strumieniowo, z nagłówkami pliku do pobrania |
| `POST /api/v1/admin/import/:entity` | administrator (uprawnienie importu encji) | Zastosowanie treści `text/csv` w jednej transakcji |

## Obsługiwane encje

Każda encja wymaga uprawnienia, które chroni te same dane na trasach modułu będącego ich
właścicielem, więc centrum nie otwiera niczego, czego rola nie może już zobaczyć tam. Aby w ogóle
wejść do centrum, trzeba mieć co najmniej jedno z tych uprawnień; wywołujący widzi tylko encje,
do których ma uprawnienie.

| Encja | Eksport | Import | Uprawnienie eksportu | Uprawnienie importu | Uwagi |
| --- | --- | --- | --- | --- | --- |
| `products` | ✓ | ✓ | `catalog:read` | `catalog:write` | Wielojęzyczne `name` / `description` są sprowadzane do jednego języka (`en-US`); `type` produktu nie można zmienić po utworzeniu |
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

## Jak działa import

Każdy import działa w jednej transakcji MikroORM. Jeśli choć jeden wiersz nie przejdzie walidacji,
cała operacja jest wycofywana, a odpowiedź zawiera raport błędów z numerami wierszy (liczonymi od 1,
bez wiersza nagłówka, tak jak w arkuszach kalkulacyjnych). Dzięki temu ponowne przesłanie pliku po
poprawce daje przewidywalny wynik.

```http
POST /api/v1/admin/import/products
Content-Type: text/csv

sku,status,visibility,name_en,description_en
SKU-001,active,public,Updated name,Updated description.
```

Odpowiedź:

```json
{
  "data": {
    "imported": 1,
    "errors": []
  }
}
```

Gdy wiersz się nie powiedzie (np. nieznane SKU):

```json
{
  "data": {
    "imported": 0,
    "errors": [
      { "rowNumber": 3, "reason": "unknown sku: SKU-XYZ" }
    ]
  }
}
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
