---
title: Aktualizacja po zmianie nazw bloków Page Buildera
---

# Aktualizacja po zmianie nazw bloków Page Buildera

Jedno wydanie zmienia nazwy wszystkich bloków Page Buildera zapisanych w bazie. Blok
zapisany jako `Row` staje się `cms.Row`; `EmailOrderSummary` staje się
`orders.EmailOrderSummary`. Nazwa, pod którą blok jest zapisany, mówi teraz, który moduł go
posiada — to pozwala wyłączyć moduł, zainstalować go z rejestru lub zastąpić bez cichego
konfliktu nazw między modułami.

**Treść się nie zmienia.** Rewrite zamienia typ bloku i nie dotyka propów, kolejności ani
języka. Działa jako pięć zwykłych migracji, po jednej na moduł właściciela przepisywanych
tabel.

Ta strona to pre-flight. Wykonuj kroki po kolei.

---

## 1. Uruchom raport

```bash
pnpm --filter backend run cli -- cms block-names
```

To jest **tylko odczyt**. Uruchom na produkcyjnej bazie, zanim zdecydujesz o upgrade; nie
wykonuje `update`, `insert` ani `delete`.

Wypisuje jedną linię na zapisaną nazwę bloku, na kolumnę, z liczbą węzłów i wierszy, które
ją niosą, oraz co się z nią stanie:

```
cms_pages.content
  Column                                  1 nodes     1 rows  will-be-renamed -> cms.Column
  NotAKnownBlock                          1 nodes     1 rows  unrecognised
  ProductGrid                             1 nodes     1 rows  will-be-renamed -> catalog.ProductGrid
  Row                                     1 nodes     1 rows  will-be-renamed -> cms.Row
  -- 4 distinct: 3 will be renamed, 0 already namespaced, 1 unrecognised
```

Trzy klasyfikacje, a tylko jedna wymaga decyzji:

| Klasyfikacja | Co oznacza | Co zrobić |
| --- | --- | --- |
| `will-be-renamed -> <new name>` | Platforma zna ten blok. Migracja go przemianuje. | Nic. |
| `already-namespaced` | Już ma właściciela. Na niezaktualizowanej bazie to blok z modułu, który zainstalowałeś. | Nic. |
| `unrecognised` | Nic na tej platformie nie rości sobie tej nazwy. | Przeczytaj §2. |

## 2. Zdecyduj, co zrobić z nierozpoznanymi nazwami

**Migracja nie padnie na jednej i nie umieści jej w kwarantannie.** Zostawia wartość
bajt-identyczną i ją raportuje. Fail na jednym ręcznie edytowanym wierszu zatrzymałby cały
upgrade bez remedium poza ręczną edycją JSONB; kwarantanna zniszczyłaby jedyny dowód, jaka
to była nazwa.

Potem dzieje się to samo, co przy bloku, którego moduł właściciel jest wyłączony:

- **storefront nic nie renderuje** tam, gdzie był blok, i nic nie rzuca;
- **edytor admin pokazuje placeholder** z nazwą bloku i **zachowuje propsy** — zapisz,
  przeładuj i treść nadal jest.

Nierozpoznana nazwa to blok, który przestaje się renderować, odwracalnie. Jeśli któryś
ważny, ustal skąd pochodzi przed upgrade — moduł, który odinstalowałeś, ręczna edycja
wiersza, własny blok forka — i albo przywróć renderer, albo zaakceptuj degradację.

## 3. Zrób backup

**To jest ścieżka restore.** `down()` istnieje we wszystkich pięciu migracjach i jest
dokładny dla nazw przemianowanych przez platformę, ale to nie siatka bezpieczeństwa: nie
przywróci nazwy, która nigdy nie miała formy sprzed migracji, i nie cofnie niczego innego,
co zrobiło wydanie.

## 4. Upgrade

Pięć migracji uruchamia się razem z resztą. To zwykłe migracje: bez flagi, bez osobnego
kroku, bez downtime poza samą migracją. Są niezależne od siebie i od każdej innej migracji
w wydaniu.

## 5. Uruchom raport ponownie i porównaj diff

```bash
pnpm --filter backend run cli -- cms block-names
```

Muszą być prawdziwe dwie rzeczy — to cała weryfikacja:

- każda linia z **`will-be-renamed -> X`** teraz brzmi **`X … already-namespaced`**;
- zbiór **`unrecognised`** jest niezmieniony — rozmiar i skład.

Jeśli nazwa nadal jest `will-be-renamed` po upgrade, coś w działającej platformie zapisało
ją ponownie po migracji — seeder albo boot reconciler. Zgłoś to; rename jest idempotentny,
więc ponowne uruchomienie migracji jest bezpieczne, ale źródło trzeba naprawić.

---

## FAQ

**Czy mogę uruchomić migrację dwa razy?** Tak, drugi raz nic nie robi. Każda nazwa, którą
mapa przemianowuje *z*, jest goła, a każda *na* ma kropkę, więc drugi przebieg nie ma co
robić. To właściwość mapy, a nie check w migracji.

**Czy blok, którego tekst wspomina "Row", zostanie uszkodzony?** Nie. Rewrite schodzi po
zapisanym JSON i zamienia `type` bloku. Rich-text, atrybut `alt` i prop raw-HTML przechodzą
bez zmian, niezależnie od treści.

**A treść w języku, którego nie używam?** Każdy język w zapisanej kopercie jest
przepisywany; klucze samej koperty — kody języków, wersja schematu — pozostają nietknięte.

**Mam szablon, który renderował moduł, który usunąłem.** Jest `unrecognised`. Zob. §2.
