---
title: Powierzchnia kontraktu
description: Na czym może polegać moduł nakładki, zainstalowany pakiet lub integracja, jak może się zmieniać każda część tej powierzchni i jak wycofanie dociera do ciebie wydanie przed usunięciem.
---

# Powierzchnia kontraktu

Moduł nakładki, zainstalowany pakiet albo integracja kompilują się względem pakietów platformy.
**Powierzchnia kontraktu** to ta ich część, na której wolno im polegać: opublikowane porty, akcje
z punktami zaczepienia (hookable actions) i ich dane, pola rozszerzeń manifestu oraz rozszerzalne
tabele hostów. Ta strona mówi, jak każda z tych części może się zmieniać między wydaniami — żebyś
wiedział, co aktualizacja może zepsuć i z jakim wyprzedzeniem się o tym dowiesz.

Platforma jest w serii `0.x`, a zakresy z daszkiem (`^`) nie chronią cię w niej: każde wydanie minor
może zepsuć konsumenta. Gwarancja z tej strony nie jest więc wersjonowaniem semantycznym. Jest nią
jedno wydanie ostrzeżenia.

## Zasada

> Element **stabilny** zostaje usunięty albo zmieniony niekompatybilnie dopiero w wydaniu **po**
> takim, które dostarczyło go oznaczonego `@deprecated`. Element **zamrożony** się nie zmienia.
> Element **tylko-addytywny** wyłącznie się rozrasta.

Metoda, którą dziś wywołujesz, może więc zniknąć, ale nie bez jednego wydania, w którym twój build
już cię przed tym ostrzegał.

## Poziomy

| Poziom | Może się zmienić | Jak dochodzi do usunięcia |
| --- | --- | --- |
| **zamrożony** | nigdy | wcale; następca to nowy element obok |
| **stabilny** | kompatybilnie w każdej chwili; niekompatybilnie tylko w wydaniu po takim, które dostarczyło element oznaczony `@deprecated` | wycofany w wydaniu N, usunięty w N+1 lub później |
| **tylko-addytywny** | tylko przez kompatybilne dodania | nigdy; następca łamiący zgodność dostaje nową wersjonowaną nazwę (`.v2`), a stara zostaje |

## Co znaczy „kompatybilny”

Zależy to od tego, w którą stronę wartość płynie między tobą a platformą:

| Kierunek | Ty… | Kompatybilne, gdy |
| --- | --- | --- |
| odczyt | czytasz wartość | pola są dodawane, nigdy usuwane ani zawężane |
| zapis | dostarczasz wartość | akceptowane wartości się poszerzają, a nowe pola są opcjonalne |
| wywołanie | wywołujesz metodę | przyjmuje to, co przyjmowała wcześniej, i zwraca nie więcej niż wcześniej — może więc dostać parametr **opcjonalny**, nigdy wymagany |
| tożsamość | podajesz literał | literał się nie zmienia |

## Co należy do powierzchni

| Rodzaj | Gdzie go znajdziesz | Poziom | Kierunek |
| --- | --- | --- | --- |
| Nazwa portu w kontenerze | wiersz `Container name:` w bloku dokumentacji portu w `@endora-commerce/contracts` albo w ścieżce `./ports` modułu | zamrożony | tożsamość |
| Metoda portu | każda metoda takiego portu | stabilny | wywołanie |
| Identyfikator akcji z punktem zaczepienia | stałe `HookableActionRef` w `@endora-commerce/contracts` | zamrożony (`action`, `objectType`); tylko-addytywny (`phases`) | tożsamość / zapis |
| Dane hooka i dane outboksu | argumenty typu `HookableActionRef` | tylko-addytywny | odczyt |
| Pola rozszerzeń manifestu | `hookableActions`, `schemaExtensions` i pola, które kolejne wydania dodają do schematu manifestu | stabilny | zapis |
| Rozszerzalna tabela hosta | `CUSTOM_FIELD_HOST_BINDINGS` (`table`, `valueColumn`, `ownerModuleId`) i klucz główny hosta | zamrożony | tożsamość |

Rodzaje zapowiedziane na kolejne wydania — deklaracje `extends` tabel pobocznych, punkty polityk
oraz `meta` i `outcome` middleware komend — dołączą do tej tabeli razem z wydaniem, które je
dostarczy.

**Poza powierzchnią**: ładunki zdarzeń domenowych, które mają własną zasadę (nowe pole jest
dodawane, usunięcie to nowe zdarzenie `.vN`); HTTP API, wersjonowane osobno; barrele pakietu
platformy; oraz komponenty admin-kit, do których nie sięga żaden kod po stronie serwera.

## Jak dociera do ciebie wycofanie

Wycofany element ma w bloku dokumentacji jeden z dwóch tagów:

```text
@deprecated since 0.113.0; use {@link OrganizationCommandPort.create} instead.
@deprecated since 0.113.0; no replacement: <reason>.
```

Wersja to wydanie, w którym wycofanie się ukazało. Edytor przekreśla symbol, build nakładki
instancji zgłasza każde użycie jako ostrzeżenie, a changeset w informacjach o wydaniu podaje stare
wywołanie i nowe. Usunięcie przychodzi w późniejszym wydaniu, nigdy w tym samym.

## Zmiany łamiące, które nie mogą czekać

Poprawka bezpieczeństwa albo wymuszona zmiana zależności może wyjątkowo złamać element bez wydania
wycofującego. Dzieje się to tylko na podstawie zapisanej decyzji właściciela i **zawsze z notą
aktualizacyjną**: [noty aktualizacyjne](../upgrading-an-instance.md) tego wydania mają sekcję, która
podaje element, decyzję i to, co twoja instancja musi zrobić. Czytaj noty aktualizacyjne przed każdą
aktualizacją; to w tej sekcji ogłaszana jest taka zmiana.

## Dla autorów modułów

- **Port zapisu jest portem swojego agregatu.** Rozszerzaj `<aggregate>CommandPort` agregatu zamiast
  publikować port skrojony pod jedno żądanie; każda metoda uruchamia tę samą audytowaną komendę co
  trasa panelu administracyjnego dla tej operacji. Zobacz [przewodnik po jądrze](./kernel.md).
- **Wycofaj, zanim usuniesz**, w powyższej składni, i napisz w changesecie, co konsument wywołuje
  zamiast tego.
- **Automatyczne porównanie jest zaplanowane.** Kolejne wydanie doda kontrolę, która porównuje
  powierzchnię z tagiem poprzedniego wydania i odrzuca usunięcie bez wcześniejszego wycofania. Do
  tego czasu zasady z tej strony pilnuje przegląd kodu.
