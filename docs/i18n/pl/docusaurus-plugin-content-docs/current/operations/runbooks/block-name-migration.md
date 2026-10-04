---
title: Aktualizacja po zmianie nazw bloków Page Buildera
---

# Aktualizacja po zmianie nazw bloków Page Buildera

Jedno z wydań zmienia nazwy wszystkich bloków Page Buildera zapisanych w bazie. Blok zapisany jako
`Row` staje się `cms.Row`; `EmailOrderSummary` staje się `orders.EmailOrderSummary`. Nazwa, pod
którą blok jest zapisany, mówi teraz, do którego modułu należy — dzięki temu moduł można wyłączyć,
zainstalować z rejestru albo zastąpić bez cichego konfliktu nazw między modułami.

**Treść się nie zmienia.** Zmiana dotyczy tylko typu bloku i nie narusza jego właściwości,
kolejności ani języka. Wykonuje ją pięć zwykłych migracji, po jednej dla każdego modułu, który jest
właścicielem zmienianych tabel.

Ta strona to lista kontrolna przed aktualizacją. Wykonuj kroki po kolei.

---

## 1. Uruchom raport

```bash
pnpm run cli cms block-names
```

Uruchom je w katalogu głównym instancji. W klonie repozytorium Endora Commerce to samo polecenie
ma postać `pnpm --filter backend run cli -- cms block-names`.

To polecenie **tylko odczytuje** dane. Uruchom je na produkcyjnej bazie, zanim zdecydujesz o
aktualizacji; nie wykonuje `update`, `insert` ani `delete`.

Wypisuje jeden wiersz dla każdej zapisanej nazwy bloku w każdej kolumnie, z liczbą węzłów i
wierszy, które ją zawierają, oraz informacją, co się z nią stanie:

```
cms_pages.content
  Column                                  1 nodes     1 rows  will-be-renamed -> cms.Column
  NotAKnownBlock                          1 nodes     1 rows  unrecognised
  ProductGrid                             1 nodes     1 rows  will-be-renamed -> catalog.ProductGrid
  Row                                     1 nodes     1 rows  will-be-renamed -> cms.Row
  -- 4 distinct: 3 will be renamed, 0 already namespaced, 1 unrecognised
```

Są trzy kategorie, a decyzji wymaga tylko jedna:

| Kategoria | Co oznacza | Co zrobić |
| --- | --- | --- |
| `will-be-renamed -> <new name>` | Platforma zna ten blok. Migracja zmieni jego nazwę. | Nic. |
| `already-namespaced` | Nazwa już wskazuje właściciela. W niezaktualizowanej bazie to blok z modułu, który zainstalowałeś. | Nic. |
| `unrecognised` | Żaden element tej platformy nie używa tej nazwy. | Przeczytaj §2. |

## 2. Zdecyduj, co zrobić z nierozpoznanymi nazwami

**Migracja nie przerwie się na takiej nazwie i nie odłoży jej na bok.** Zostawia wartość bajt w
bajt bez zmian i ją zgłasza. Błąd na jednym ręcznie edytowanym wierszu zatrzymałby całą aktualizację,
a jedynym rozwiązaniem byłaby ręczna edycja JSONB; odłożenie wartości na bok zniszczyłoby jedyny
ślad tego, jaka to była nazwa.

Potem dzieje się to samo co z blokiem, którego moduł-właściciel jest wyłączony:

- **storefront niczego nie wyświetla** w miejscu bloku i nie zgłasza błędu;
- **edytor w panelu pokazuje zastępczy element** z nazwą bloku i **zachowuje jego właściwości** —
  po zapisaniu i przeładowaniu treść nadal jest na miejscu.

Nierozpoznana nazwa oznacza blok, który przestaje się wyświetlać — w sposób odwracalny. Jeśli
któryś jest ważny, przed aktualizacją ustal, skąd pochodzi — z modułu, który odinstalowałeś, z
ręcznej edycji wiersza, z własnego bloku w forku — i albo przywróć komponent, który go wyświetla,
albo zaakceptuj jego brak.

## 3. Zrób backup

**To jest twoja droga powrotu.** `down()` istnieje we wszystkich pięciu migracjach i dokładnie
odwraca zmiany nazw wykonane przez platformę, ale nie jest zabezpieczeniem: nie przywróci nazwy,
która nigdy nie miała postaci sprzed migracji, i nie cofnie niczego innego, co zmieniło wydanie.

## 4. Aktualizacja

Pięć migracji wykonuje się razem z pozostałymi. To zwykłe migracje: bez flagi, bez osobnego kroku,
bez przestoju poza czasem samej migracji. Są niezależne od siebie i od każdej innej migracji w
wydaniu.

## 5. Uruchom raport ponownie i porównaj wyniki

```bash
pnpm run cli cms block-names
```

Muszą być spełnione dwa warunki — to cała weryfikacja:

- każdy wiersz z **`will-be-renamed -> X`** brzmi teraz **`X … already-namespaced`**;
- zbiór **`unrecognised`** się nie zmienił — ani liczebnie, ani co do zawartości.

Jeśli po aktualizacji nazwa nadal ma kategorię `will-be-renamed`, coś w działającej platformie
zapisało ją ponownie po migracji — dane początkowe albo uzgadnianie przy starcie. Zgłoś to; zmiana
nazw jest idempotentna, więc ponowne uruchomienie migracji jest bezpieczne, ale źródło trzeba
naprawić.

---

## FAQ

**Czy mogę uruchomić migrację dwa razy?** Tak, za drugim razem nic się nie dzieje. Każda nazwa,
*z której* mapa zmienia nazwę, nie ma przedrostka, a każda, *na którą* zmienia, ma kropkę, więc
drugi przebieg nie ma nic do zrobienia. To właściwość samej mapy, a nie sprawdzenie w migracji.

**Czy blok, którego tekst zawiera słowo "Row", zostanie uszkodzony?** Nie. Migracja przechodzi po
zapisanym JSON i zmienia tylko `type` bloku. Tekst sformatowany, atrybut `alt` i właściwość z surowym
HTML pozostają bez zmian, niezależnie od treści.

**A treść w języku, którego nie używam?** Zmiana obejmuje każdy język w zapisanej strukturze;
klucze samej struktury — kody języków, wersja schematu — pozostają nietknięte.

**Mam szablon, który wyświetlał moduł, który usunąłem.** Ma kategorię `unrecognised`. Zobacz §2.
