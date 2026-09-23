---
title: currencies
description: Pula akceptowanych kodów ISO 4217 + domyślna waluta
---

# `currencies`

Instalacyjna pula akceptowanych kodów walut ISO 4217 (T238 /
FR-105). Odzwierciedla moduł `languages`.

## Publiczne API

| Verb + Path | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/currencies` | `currencies:read` | Pełna lista |
| `PUT /api/v1/admin/currencies/:code` | `currencies:write` | Upsert |
| `POST /api/v1/admin/currencies/:code/default` | `currencies:write` | Promocja na domyślną (atomowo degraduje poprzednią domyślną) |
| `DELETE /api/v1/admin/currencies/:code` | `currencies:write` | Usunięcie (odrzucone dla domyślnej) |

`GET /api/v1/i18n/config` odpowiada też aktywnymi walutami i domyślną, i jest
trasą **`languages`**, a nie tego modułu: składa oba katalogi w jeden publiczny
payload i czyta połowę tego modułu przez `currencyReadPort`. Zobacz [languages](./languages.md).

## Uprawnienia

`currencies:read` i `currencies:write`, własne modułu od 2026-08-29.

Cztery trasy powyżej żyły w `languages` do tego momentu i wymuszały
`catalog:write` — wszystkie cztery, w tym odczyt listy — więc operator, który
mógł edytować opis produktu, mógł też dodać walutę, dezaktywować, usunąć i
promować jedną na domyślną sklepu. Nic w tym repozytorium nie woła tych tras:
ekran walut w adminie to `dictionaries`
(`/api/v1/admin/dictionary/currencies/*`, gated na `dictionary.write`), co jest
drugimi drzwiami do tej tabeli i osobnym pytaniem.

`test/contract/currencies/permission-authority.test.ts` przypina oba kierunki —
rola z kodami katalogu jest odrzucana, rola z parą jest obsłużona — i
asertuje, że in-process `currencyReadPort`, przez który każdy inny moduł czyta
walutę, jest nietknięty przez przeniesienie.

## Domyślne

Ten sam wzorzec partial-unique-index co `languages`. Migracja bootstrap
seeduje `PLN` (domyślna) i `EUR`; wartości symboli są przechowywane przez
literały Unicode Postgresa, więc źródło migracji pozostaje ASCII.

## Encje

`Currency` — naturalny klucz główny na kod ISO 4217; `label`,
`symbol`, `isDefault`, `isActive`, `sortOrder`.

## Punkty rozszerzenia

- **Domyślna per kanał sprzedaży** — gdy kanał sprzedaży ma własną walutę,
  gate'uj `priceFor(cart)` w module `orders` na walutę skonfigurowaną kanału,
  a nie globalną domyślną.
- **Dostawca kursów wymiany** — poza zakresem tutaj; integruj przez moduł
  `integrations`, gdy potrzebny jest realny adapter.
