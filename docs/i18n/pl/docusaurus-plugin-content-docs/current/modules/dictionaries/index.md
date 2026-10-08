---
title: Słowniki
sidebar_position: 1
description: Dane słownikowe tworzone przy instalacji — kraje, waluty, języki — z możliwością zmiany kolejności w panelu
---

# Słowniki

Moduł słowników to rejestr platformy dla kodów krajów, walut i języków. Daje operatorom jeden ekran
w panelu administracyjnym dla wspólnych danych słownikowych, z których korzystają adresy, reguły
podatkowe, magazyny, kanały sprzedaży, promocje, przypisania megamenu i języki bloga.

Moduł nie zastępuje dawnych API HTTP dla języków i walut. Te endpointy pozostają ze względu na
zgodność wsteczną, ale nowy kod w panelu i storefroncie powinien odczytywać dane przez moduł
słowników.

## Praca operatora

Otwórz `Admin -> Operations -> Dictionary`. Strona ma trzy zakładki:

- **Countries** — kod ISO kraju, flaga aktywności, widoczność w storefroncie, etykieta domyślna,
  etykiety w poszczególnych językach i dozwolone języki dla każdego kraju.
- **Currencies** — kod ISO waluty, symbol, liczba miejsc po przecinku, flaga aktywności, widoczność
  w storefroncie, etykieta domyślna i etykiety w poszczególnych językach.
- **Languages** — wszystkie języki ISO 639-1 oraz regionalne znaczniki BCP-47 dodane przez sklep:
  kod, nazwa angielska i nazwa w danym języku, kraje, w których język jest używany, flaga
  aktywności, etykieta domyślna i etykiety w poszczególnych językach.

Dezaktywacja wpisu blokuje nowe zapisy z tym kodem, ale istniejące rekordy nadal mogą go odczytywać.
To zamierzone: zamówienia, adresy, zakresy treści i rekordy konfiguracji muszą pozostać możliwe do
skontrolowania także po wycofaniu kodu z bieżącego użycia.

Etykiety w poszczególnych językach edytuje się w każdym wierszu. Odczyt dla storefrontu wybiera
żądany język, jeśli jest dostępny, a gdy tłumaczenia brakuje — etykietę domyślną.

## Katalog języków

Zakładka Languages zawiera wszystkie języki ISO 639-1 — 183 kody dwuliterowe — obok dwóch języków
regionalnych dostarczanych z platformą: `en-US` i `pl-PL`. Przy każdym języku widać kraje, w których
jest używany, w postaci kodów krajów. Listę można przeszukiwać po kodzie, nazwie lub kraju,
filtrować według statusu i przeglądać stronami.

**Język na liście jest dostępny, a nie aktywny.** Katalog trafia do słownika jako nieaktywny. Tylko
aktywny język jest proponowany w kanałach sprzedaży, pojawia się w rejestrze dla storefrontu i w
`GET /api/v1/i18n/config` oraz może otrzymać przetłumaczoną etykietę. Aby zacząć używać języka,
aktywuj go w jego wierszu. Znacznik regionalny, którego katalog nie zawiera, na przykład `de-AT` lub
`pt-BR`, nadal tworzy się przyciskiem **Add language**.

Katalog to dane słownikowe uzupełniane przy starcie backendu, więc instalacja starsza niż katalog
otrzyma go przy pierwszym uruchomieniu po aktualizacji. Uzupełnianie tylko wstawia brakujące wiersze:
wiersz, który został zmieniony lub aktywowany, nigdy nie jest nadpisywany, a usunięty wiersz katalogu
wraca przy następnym starcie — zamiast usuwać, pozostaw go nieaktywnym. Język jest wiązany tylko z
krajami obecnymi w zakładce Countries; po dodaniu kraju jego języki zostaną powiązane przy następnym
starcie.

## Rejestr dla storefrontu

Storefront odczytuje połączony rejestr przez:

```http
GET /api/v1/dictionary?locale=pl-PL
```

Odpowiedź zawiera tylko wpisy aktywne i widoczne w storefroncie. Gdy Redis jest dostępny, jest
przechowywana w jego pamięci podręcznej. Zapisy w panelu i endpoint unieważniania pamięci podręcznej
dla operatora czyszczą ten rejestr.

Korzystaj z rejestru w listach wyboru zamiast wpisanych na stałe list krajów, walut czy języków.
Moduł dostarcza wspólne komponenty list wyboru dla panelu i storefrontu.

## Port walidacji

Kod backendu dostaje wspólny mechanizm walidacji z composition root:

```ts
dictionaryValidator: dictionaries.handle.validator
```

Port udostępnia:

- `validateCountryCode(code, mode)`
- `validateCurrencyCode(code, mode)`
- `validateLanguageCode(code, mode)`

Używaj `create-or-change` przy nowym przypisaniu kodu, a `unchanged` tylko wtedy, gdy aktualizacja
zachowuje ten sam kod historyczny, który już jest zapisany w rekordzie. Nieznane kody są zawsze
odrzucane. Nieaktywne kody są odrzucane przy nowych przypisaniach i akceptowane tylko dla
niezmienionych wartości historycznych.

Mechanizm walidacji ma krótką pamięć podręczną LRU w procesie. Zapisy w słownikach unieważniają
razem LRU i pamięć podręczną rejestru w Redis.

## Punkty rozszerzenia

Gdy moduł przechowuje kod kraju, waluty albo języka:

1. Przyjmij mechanizm walidacji przez opcje pluginu modułu.
2. Sprawdzaj kod w usłudze przed zapisem.
3. Zamieniaj `DictionaryReferenceError` na odpowiedź `409` ze ścieżką pola.
4. Zachowuj odczyty historyczne; nie zmieniaj kaskadowo wierszy innych modułów, gdy wpis słownika
   zostaje dezaktywowany.

Ustawienia nie mają dziś typowanego rodzaju wartości dla kraju, waluty ani języka, więc opcja
walidacji słownikowej jest zarezerwowana dla przyszłych ustawień opisywanych metadanymi.
