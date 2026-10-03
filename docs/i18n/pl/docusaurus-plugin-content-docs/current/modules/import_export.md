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
| `GET /api/v1/admin/export/:entity.csv` | administrator (`catalog:write`) | Pobranie CSV strumieniowo, z nagłówkami pliku do pobrania |
| `POST /api/v1/admin/import/:entity` | administrator (`catalog:write`) | Zastosowanie treści `text/csv` w jednej transakcji |

## Obsługiwane encje

| Encja | Eksport | Import | Uwagi |
| --- | --- | --- | --- |
| `products` | ✓ | ✓ | Wielojęzyczne `name` / `description` są sprowadzane do jednego języka (`en-US`); `type` produktu nie można zmienić po utworzeniu |
| `categories` | ✓ | ✓ | Kategorie nadrzędne są wskazywane przez `parent_slug`; wiersze kategorii nadrzędnych muszą występować przed podrzędnymi |
| `stock` | ✓ | ✓ | Operatorzy zmieniają tylko `on_hand`; rezerwacje są tylko do odczytu |
| `customers` | ✓ | — | Import celowo nieobsługiwany — masowe tworzenie kont wymaga historii haseł, której nie da się przekazać w pliku CSV |
| `orders` | ✓ | — | Zamówienia powstają w procesie checkoutu; import historycznych zamówień ominąłby stany magazynowe, płatności i limity kredytowe |

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

- **Nowa encja** — zaimplementuj `ImportExportAdapter` (`name`, `exportHeader`, `exportRows`,
  opcjonalnie `importHeader` i `importRow`) i zarejestruj go w `import-export-service.ts`.
- **Inny separator albo specyfika Excela** — rozszerz `csv-codec.ts`. RFC 4180 obejmuje typowe
  przypadki; gdy rzeczywisty plik sprawi problem, to jedyne miejsce, które trzeba zmienić.
- **Eksport strumieniowy** — wczytywanie do pamięci bez problemu obsługuje setki tysięcy wierszy;
  przy regularnym eksporcie milionów wierszy zastąp `serializeCsv` asynchronicznym iteratorem
  przekazującym dane do `reply.raw` w Fastify.
