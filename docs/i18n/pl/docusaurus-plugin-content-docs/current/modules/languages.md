---
title: languages
description: Lista obsługiwanych znaczników języków BCP-47 i reguła wartości zastępczej dla tłumaczeń
---

# `languages`

Lista znaczników języków BCP-47 obsługiwanych w danej instalacji. Moduł udostępnia publiczny odczyt
`i18n/config`, na podstawie którego storefront i panel administracyjny budują wybór języka, oraz
niewielki `LocaleService` z regułą wartości zastępczej dla tłumaczeń.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/i18n/config` | storefront / panel | Aktywne języki i waluty oraz skonfigurowane wartości domyślne |
| `GET /api/v1/admin/languages` | administrator | Pełna lista, łącznie z nieaktywnymi wierszami |
| `PUT /api/v1/admin/languages/:code` | administrator | Utworzenie lub aktualizacja |
| `POST /api/v1/admin/languages/:code/default` | administrator | Ustawienie jako domyślnego (w tej samej operacji zdejmuje to oznaczenie z poprzedniego) |
| `DELETE /api/v1/admin/languages/:code` | administrator | Usunięcie (odrzucane dla języka domyślnego) |

Katalog walut ma taką samą postać pod `/api/v1/admin/currencies`, ale te trasy należą do modułu
**`currencies`** — zobacz [currencies](./currencies.md). Do 2026-08-29 były rejestrowane tutaj, z
uprawnieniem `catalog:write`, i obsługiwały tabelę innego modułu, choć nic w tym repozytorium ich
nie wywoływało. Ten moduł nadal składa `GET /api/v1/i18n/config`, który w jednej publicznej
odpowiedzi zwraca oba katalogi i obie wartości domyślne, a część dotyczącą walut odczytuje przez
`currencyReadPort`.

Cztery powyższe trasy administracyjne dla języków wymagają `catalog:write`. To podobny problem tego
samego rodzaju i nie został jeszcze naprawiony.

## Wartości domyślne

W tabeli `languages` co najwyżej jeden wiersz ma `is_default = true`, co wymusza częściowy indeks
unikalny na `(is_default) WHERE is_default = true`. Ustawienie nowego języka domyślnego wykonuje
zdjęcie oznaczenia ze starego i nadanie go nowemu w jednej transakcji MikroORM, aby indeks nie
został naruszony w trakcie.

`LanguageService.setDefault()` odrzuca wiersze z `isActive=false` (`409 VALIDATION_FAILED`), a
`remove()` odmawia usunięcia wiersza, który jest obecnie domyślny.

## Dane początkowe

Migracja `20260425T161557_languages_currencies_init.ts` wstawia dwa wiersze, aby szybki start działał bez żadnych kroków w panelu:
- `en-US` — domyślny, aktywny
- `pl-PL` — aktywny

Wartości `label` i `symbol` (dla walut) widoczne dla klientów są zapisane literałami Unicode
Postgresa `U&'…'`, aby plik migracji pozostał wyłącznie w ASCII (artefakty inżynierskie pozostają po
angielsku i w ASCII; wiersz w bazie odpowiada temu, co ma wyświetlić storefront).

## Wartość zastępcza tłumaczeń (`LocaleService`)

`LocaleService.pickLocalizedValue(record, requestedLocale, defaultLocale?)` szuka wartości w tej
kolejności:

1. żądany język, jeśli rekord go zawiera;
2. skonfigurowany język domyślny, jeśli został podany i rekord go zawiera;
3. pierwsza wartość obecna w rekordzie;
4. pusty string.

`resolveRequestLocale(acceptLanguageHeader, activeLocales)` odczytuje nagłówek `Accept-Language`
(z wagami q) i zwraca najlepiej dopasowany język spośród aktywnych, z dopasowaniem po samym języku,
dzięki któremu `en-GB` pasuje do `en-US`. Gdy nic nie pasuje, zwraca skonfigurowany język domyślny.

Odczyt języka domyślnego jest przechowywany w pamięci podręcznej przez 60 sekund; zmiany w panelu
wywołują `invalidateDefault()`, aby pamięć podręczna została wyczyszczona od razu po zmianie.

## Encje

`Language` — naturalny klucz główny w postaci kodu BCP-47; `label`, `isDefault`, `isActive`,
`sortOrder`.

## Punkty rozszerzenia

- **Język domyślny dla kanału sprzedaży** — gdy kanał sprzedaży ma własny język, wstaw przed
  `LocaleService.resolveRequestLocale()` mechanizm wyznaczania i używaj języka domyślnego kanału
  zamiast globalnego.
- **Wymiana tłumaczeń z systemami zewnętrznymi** — emituj zdarzenie domenowe przy zmianie
  przetłumaczonego pola i pozwól integracji przekazywać je do zewnętrznego procesu tłumaczeń.
