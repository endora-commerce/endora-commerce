---
title: languages
description: Pula obsługiwanych tagów BCP-47 + helper fallback tłumaczeń
---

# `languages`

Instalacyjna pula obsługiwanych tagów językowych BCP-47. Posiada publiczną
ścieżkę read `i18n/config`, z której storefront + admin budują pickery
języków, oraz mały `LocaleService` implementujący regułę fallback tłumaczeń.

## Publiczne API

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/i18n/config` | storefront / admin | Aktywne języki + waluty + skonfigurowane domyślne |
| `GET /api/v1/admin/languages` | admin | Pełna lista, w tym nieaktywne wiersze |
| `PUT /api/v1/admin/languages/:code` | admin | Upsert |
| `POST /api/v1/admin/languages/:code/default` | admin | Promocja na domyślny (atomowo degraduje poprzedni domyślny) |
| `DELETE /api/v1/admin/languages/:code` | admin | Usunięcie (odrzucone dla domyślnego) |

Katalog walut ma ten sam kształt pod `/api/v1/admin/currencies`, a te trasy są
**`currencies`** — zobacz [currencies](./currencies.md). Były zarejestrowane tutaj do 2026-08-29,
na `catalog:write`, serwując tabelę innego modułu bez caller'a w tym repozytorium. Co ten
moduł nadal komponuje, to
`GET /api/v1/i18n/config`, które odpowiada oboma katalogami i obiema domyślnymi
w jednym publicznym payloadzie i czyta połowę walutową przez `currencyReadPort`.

Cztery trasy admin języków powyżej wymuszają `catalog:write`. To sąsiadujące roszczenie
tego samego rodzaju i nie zostało naprawione.

## Domyślne

Dokładnie zero lub jeden wiersz w `languages` ma `is_default = true`,
wymuszane przez partial unique index na `(is_default) WHERE is_default =
true`. Ustawienie nowego domyślnego uruchamia parę demote-then-promote w jednej
transakcji MikroORM, aby partial unique index nigdy nie został naruszony
w trakcie.

`LanguageService.setDefault()` odrzuca wiersze z `isActive=false`
(`409 VALIDATION_FAILED`), a ścieżka `remove()` odmawia usunięcia wiersza,
który jest aktualnie domyślny.

## Bootstrap

Migracja 012 wstawia dwa wiersze, aby quickstart działał bez kroku admin:
- `en-US` — domyślny, aktywny
- `pl-PL` — aktywny

Wartości `label` i `symbol` (waluty) po stronie klienta zapisywane są
literałami Unicode Postgres `U&'…'`, aby plik źródłowy migracji pozostał
ASCII-only (artefakty inżynierskie pozostają anglojęzyczne i ASCII-only;
wiersz runtime odzwierciedla to, co storefront powinien renderować).

## Fallback tłumaczeń (`LocaleService`)

`LocaleService.pickLocalizedValue(record, requestedLocale, defaultLocale?)`
implementuje łańcuch lookup:

1. żądany locale, jeśli obecny w rekordzie.
2. skonfigurowany domyślny locale, jeśli podany i obecny.
3. pierwsza obecna wartość w rekordzie.
4. pusty string.

`resolveRequestLocale(acceptLanguageHeader, activeLocales)` parsuje nagłówek
`Accept-Language` (z wagami q) i zwraca najwyższy priorytet dopasowania
z aktywnej puli języków, z fallbackiem language-only, aby
`en-GB` pasował do `en-US`. Fallback do skonfigurowanego domyślnego, gdy nic
nie pasuje.

Lookup domyślnego locale jest cache'owany na 60 sekund; mutacje admin wołają
`invalidateDefault()`, aby cache wyczyścił się natychmiast po zmianie.

## Encje

`Language` — naturalny primary key na kod BCP-47; `label`,
`isDefault`, `isActive`, `sortOrder`.

## Punkty rozszerzenia

- **Domyślny per Sales Channel** — gdy Sales Channel ma własny
  język, podepnij resolver przed
  `LocaleService.resolveRequestLocale()` i użyj domyślnego kanału
  zamiast globalnego.
- **Translation pull/push** — emituj zdarzenie domenowe, gdy zmienia się pole
  zlokalizowane, i pozwól integracji konsumować je dla zewnętrznego workflow
  tłumaczeń.
