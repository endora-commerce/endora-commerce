---
title: Dictionary
sidebar_position: 1
description: Seedowane dane referencyjne — Countries, Currencies, Languages — z możliwością reorder w adminie
---

# Dictionary

Moduł Dictionary to rejestr platformy dla kodów krajów, walut i języków.
Daje operatorom jeden Admin UI dla wspólnych danych referencyjnych używanych
przez adresy, reguły podatkowe, magazyny, kanały sprzedaży, promocje,
powiązania megamenu i scope języków bloga.

Moduł nie zastępuje legacy powierzchni HTTP Languages i Currencies.
Te endpointy pozostają dla kompatybilności wstecznej, podczas gdy nowa praca
admin i storefront powinna czytać przez moduł Dictionary.

## Workflow operatora

Otwórz `Admin -> Operations -> Dictionary`. Strona ma trzy zakładki:

- **Countries** — kod ISO kraju, flaga active, widoczność na storefront,
  etykieta domyślna, etykiety zlokalizowane i dozwolone języki dla każdego kraju.
- **Currencies** — kod ISO waluty, symbol, precyzja dziesiętna, flaga active,
  widoczność na storefront, etykieta domyślna i etykiety zlokalizowane.
- **Languages** — kod języka BCP-47, nazwa natywna, flaga active, widoczność
  na storefront, etykieta domyślna i etykiety zlokalizowane.

Dezaktywacja wpisu blokuje nowe zapisy wybierające ten kod, ale historyczne
rekordy mogą nadal czytać istniejącą wartość. To zamierzone: zamówienia,
adresy, scope treści i rekordy konfiguracji muszą pozostać audytowalne po
wycofaniu kodu z aktywnego użycia.

Etykiety zlokalizowane edytuje się z każdego wiersza. Odczyty rejestru
storefront wybierają żądane locale, gdy jest obecne, i fallback do etykiety
domyślnej, gdy brakuje tłumaczenia.

## Rejestr storefront

Klienci storefront czytają połączony rejestr przez:

```http
GET /api/v1/dictionary?locale=pl-PL
```

Odpowiedź zawiera tylko wpisy aktywne i widoczne na storefront. Jest cache'owana
w Redis, gdy Redis jest dostępny. Zapisy admin i endpoint invalidacji cache
operatora czyszczą ten rejestr.

Używaj rejestru do pickerów UI zamiast twardo zakodowanych list krajów, walut
lub języków. Moduł dostarcza współdzielone komponenty picker dla admin i
storefront.

## Port walidatora

Konsumenci backend dostają współdzielony walidator z composition root:

```ts
dictionaryValidator: dictionaries.handle.validator
```

Port udostępnia:

- `validateCountryCode(code, mode)`
- `validateCurrencyCode(code, mode)`
- `validateLanguageCode(code, mode)`

Użyj `create-or-change` przy nowym przypisaniu kodu. Użyj `unchanged` tylko gdy
update zachowuje ten sam historyczny kod już zapisany na rekordzie. Nieznane
kody są zawsze odrzucane. Nieaktywne kody są odrzucane przy nowych przypisaniach
i akceptowane tylko dla niezmienionych wartości historycznych.

Walidator ma krótki in-process LRU. Zapisy Dictionary invalidują LRU i cache
rejestru Redis razem.

## Punkty rozszerzenia

Gdy moduł przechowuje kod kraju, waluty lub języka:

1. Przyjmij walidator przez opcje plugin modułu.
2. Waliduj na granicy serwisu przed zapisem.
3. Konwertuj `DictionaryReferenceError` na odpowiedź `409` ze ścieżką pola.
4. Zachowaj odczyty historyczne; nie kaskaduj edycji wierszy konsumentów, gdy
   wpis słownika jest dezaktywowany.

Settings obecnie nie ma typowanego rodzaju wartości setting country/currency/language,
więc opcja walidatora słownika jest zarezerwowana pod przyszłe settings
sterowane metadanymi.
