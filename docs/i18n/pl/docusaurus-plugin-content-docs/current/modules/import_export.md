---
title: import_export
description: Import / eksport CSV do masowej edycji encji
---

# `import_export`

Import i eksport CSV dla przypadków masowej edycji. Posiada mały kodek RFC-4180
(bez nowej zależności) oraz rejestr adapterów per encja.

## Publiczne API

| Verb + Path | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/export/:entity.csv` | admin (`catalog:write`) | Strumieniowe pobranie CSV z nagłówkami attachment |
| `POST /api/v1/admin/import/:entity` | admin (`catalog:write`) | Zastosowanie body `text/csv` w jednej transakcji |

## Obsługiwane encje

| Entity | Export | Import | Notes |
| --- | --- | --- | --- |
| `products` | ✓ | ✓ | Wielojęzyczne `name` / `description` zwijają się do jednego locale (`en-US`); `type` produktu jest niemutowalne po utworzeniu |
| `categories` | ✓ | ✓ | Rodzice rozwiązywani po `parent_slug`; wiersze muszą listować rodziców przed dziećmi |
| `stock` | ✓ | ✓ | Operatorzy edytują tylko `on_hand`; rezerwacje są read-only |
| `customers` | ✓ | — | Import celowo nieobsługiwany — masowe tworzenie kont wymaga historii haseł, która nie pasuje do uploadu CSV |
| `orders` | ✓ | — | Zamówienia powstają w flow checkout; import historycznych zamówień ominąłby stock, płatności i cykle limitów kredytowych |

## Semantyka importu

Każdy import działa w jednej transakcji MikroORM. Jeśli choć jeden wiersz
nie przejdzie walidacji, cała partia jest wycofywana, a odpowiedź zwraca
raport błędów z numerami wierszy (1-based, bez linii nagłówka, zgodnie z tym,
co pokazują arkusze kalkulacyjne). Dzięki temu ponowne uploady po poprawce
są deterministyczne.

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

- **Nowa encja** — zaimplementuj `ImportExportAdapter` (`name`,
  `exportHeader`, `exportRows`, opcjonalnie `importHeader` + `importRow`)
  i zarejestruj w `import-export-service.ts`.
- **Inny separator / dziwactwa Excela** — rozszerz `csv-codec.ts`. RFC
  4180 obejmuje typowe przypadki; gdy realny plik się wywraca, kodek jest
  jedynym miejscem ewolucji.
- **Strumieniowy export** — loader in-memory spokojnie obsługuje setki tysięcy
  wierszy; przy stałym eksporcie milionów wierszy zamień `serializeCsv` na
  async iterator pipujący do `reply.raw` Fastify.
