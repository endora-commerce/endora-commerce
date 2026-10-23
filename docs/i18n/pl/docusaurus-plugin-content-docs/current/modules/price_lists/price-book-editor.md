---
title: Edytor cenników
sidebar_label: Edytor cenników
sidebar_position: 1
description: Ekrany cenników w panelu administracyjnym — lista, tworzenie cennika, siatka cen, import i eksport CSV, duplikowanie, ceny bazowe w produkcie, wyjaśnienie ceny i ustawienia cenowe.
---

# Edytor cenników

Ta strona prowadzi przez ekrany modułu `price_lists` w panelu administracyjnym. Czym jest cennik i jak
platforma wybiera cenę, którą płaci kupujący, opisano na [głównej stronie modułu](../price_lists.md);
przeczytaj jej pierwsze sekcje, zanim zaczniesz konfigurować ceny.

| Ekran | Gdzie | Wymaga |
| --- | --- | --- |
| **Cenniki** — lista | pasek boczny *Cenniki*, `/price-lists`, ⌘K / CTRL+K *Cenniki* | `price_lists:read` |
| **Nowy cennik** | przycisk *Nowy cennik* na liście, `/price-lists/new`, ⌘K *Nowy cennik* | `price_lists:write` |
| **Cennik** — zakładki *Ustawienia* i *Ceny* | `/price-lists/<id>`, `?tab=prices` dla siatki | `price_lists:read`; zmiany wymagają `price_lists:write` |
| **Wyjaśnienie ceny** | `/price-lists/explain`, ⌘K *Wyjaśnienie ceny* oraz odnośniki z cennika, komórki siatki, produktu i organizacji | `price_lists:read` |
| **Ustawienia cenowe** | odnośnik *Ustawienia cenowe* na liście, `/price-lists/display-modes`, ⌘K *Ustawienia cenowe* | `price_lists:read`; zmiany wymagają `price_lists:write` |
| **Ceny bazowe** w produkcie | *Katalog → Produkty → (produkt) → Pricing* | `price_lists:read`; zmiany wymagają `price_lists:write` |
| **Wyjaśnij cenę dla tej organizacji** | strona szczegółów organizacji | `price_lists:read` |

Kontrolki, której nie możesz użyć, nie ma na ekranie, zamiast być wyłączoną: administrator z
uprawnieniem do odczytu widzi każdy ekran bez akcji edycji, zapisu, importu i usuwania.

## Lista cenników

Lista pokazuje każdy cennik, który możesz zobaczyć — cenniki cen bazowych, katalogowe, dla kupujących
i promocyjne — z nazwą, typem, stanem, walutą, liczbą kanałów sprzedaży, odbiorcami, priorytetem i
liczbą wierszy cen. Cennik, który nie może obowiązywać, ma oznaczenie *Nie obowiązuje nikogo* (cennik
grup klientów lub organizacji bez odbiorców) albo *Nie obowiązuje nigdzie* (brak kanału sprzedaży,
który sprzedaje w jego walucie). Cenniki cen bazowych są oznaczone jako *Ceny bazowe — PLN* i tak
dalej, po jednym na walutę.

Filtruj po nazwie, typie, stanie, walucie, kanale sprzedaży, rodzaju odbiorców i odbiorcy. Filtry są
przechowywane w adresie strony, więc przefiltrowaną listę można dodać do zakładek albo wysłać
współpracownikowi; zapisane widoki nie są jeszcze dostępne na tej liście (zgłoszenie #408).

## Tworzenie cennika

*Nowy cennik* prowadzi przez pięć kroków, w tej kolejności, i tworzy cennik jako **szkic**:

1. **Nazwa i typ** — *Ceny regularne* albo *Ceny promocyjne*.
2. **Waluta** — jedna, na stałe. Krok wymienia waluty, w których sprzedają twoje kanały sprzedaży,
   wraz z kanałami sprzedającymi w każdej z nich.
3. **Kanały sprzedaży** — oferowane są tylko kanały, które sprzedają w wybranej walucie; krok wymienia
   pominięte kanały i podaje powód. Można utworzyć cennik bez kanału i dodać kanał później, ale do
   tego czasu cennik nigdzie nie obowiązuje.
4. **Odbiorcy** — *Wszyscy*, *Grupy klientów* albo *Organizacje*, z listą wyboru odbiorców wybranego
   rodzaju.
5. **Harmonogram i priorytet** — zostaw daty puste, aby cennik obowiązywał od aktywacji i bez końca.
   Priorytet rozstrzyga tylko między cennikami, które wyceniają ten sam rodzaj linii dla tego samego
   kupującego.

Handlowiec ma do wyboru tylko *Organizacje*, i tylko własne organizacje.

## Zakładka *Ustawienia* cennika

Nagłówek pokazuje nazwę cennika, oznaczenie cennika cen bazowych (jeśli nim jest), stan, typ i walutę
oraz trzy akcje: **Duplikuj**, **Wyjaśnij cenę** (wyjaśnienie ceny wypełnione kanałem i walutą tego
cennika oraz — dla cennika z jedną organizacją — tą organizacją) i **Zobacz historię** (dziennik
audytu przefiltrowany do tego cennika).

Zakładka *Ustawienia* pozwala zmienić nazwę, kanały sprzedaży, odbiorców, harmonogram i priorytet, a
zapisuje je przycisk **Zapisz zmiany**. Waluta jest widoczna, ale nigdy nie można jej edytować — aby
ustalić ceny w innej walucie, zduplikuj cennik. Rodzaj odbiorców nie zmienia się, odkąd cennik był
aktywny. Kanał, który nie sprzedaje już w walucie cennika, jest pokazywany jako *Nieaktywny — kanał
nie oferuje już PLN*.

**Aktywuj** i **Przenieś do szkiców** zmieniają stan cennika. Gdy cennika nie można aktywować, ekran
mówi, czego brakuje — kanału sprzedaży, który sprzedaje w tej walucie, albo odbiorcy — i proponuje
krok, który to naprawia.

**Usuń** jest w osobnej sekcji na dole, z dala od zapisu, i prosi o potwierdzenie, podając nazwę
cennika i liczbę jego wierszy cen. Usunięcia nie można cofnąć.

Cenniki cen bazowych nie mają żadnej z tych akcji: nie można zmienić ich nazwy, zaplanować ich, nadać
im priorytetu, przenieść ich do szkiców, zduplikować ich ani ich usunąć.

Jeśli ktoś inny zapisał cennik po tym, jak go otworzyłeś, twój zapis jest odrzucany z komunikatem
*Ten cennik zmienił się od chwili otwarcia* i akcją **Wczytaj ponownie**; nic nie jest po cichu
nadpisywane.

## Siatka cen (zakładka *Ceny*)

Siatka to edytor wierszy cennika: **jedna linia na wybór** — cały katalog, wartość atrybutu,
kategoria, kategoria i wartość atrybutu, produkt, wariant — i **jedna kolumna na próg ilościowy**
używany gdziekolwiek w cenniku („Od 1”, „Od 10”, „Od 100”). Linie biegną od najogólniejszej do
najbardziej szczegółowej, alfabetycznie w obrębie rodzaju; notka nad siatką przypomina, że o tym,
która linia wygrywa dla kupującego, decyduje kolejność cen, i prowadzi do niej w *Ustawieniach
cenowych*.

### Dodawanie linii

**Dodaj linie** oferuje:

- **Produkty…** — przeglądarkę produktów katalogu, w której zaznaczasz wiele produktów naraz.
  Produkt, który już jest w cenniku, nie jest dodawany ponownie; siatka podaje jego nazwę.
  Przeglądarka wymaga `catalog:read`.
- **Kategoria…**, **Wartość atrybutu…**, **Kategoria i wartość atrybutu…** — listy wyboru, które
  oferują tylko atrybuty oznaczone jako *Reguły cennika*, mogące wybierać ceny.
- **Wszystkie produkty** — linię dla całego katalogu (tylko procent albo korekta).

**Dodaj próg ilościowy** dodaje kolumnę od ilości 2 lub większej. Linia produktu z wariantami ma
**Pokaż warianty**: każdy wariant jest podlinią, pustą, dopóki wariant nie ma własnej ceny.

### Wpisywanie cen

Wpisz w komórkę:

| Wpisujesz | Komórka zawiera |
| --- | --- |
| `95`, `95,50`, `1 234,50 zł` | cenę stałą (akceptowane są przecinek lub kropka dziesiętna, spacje i symbol waluty) |
| `-5%`, `+20%` | rabat 5 %, narzut 20 % |
| `-3`, `+3` | korektę kwotową −3 albo +3 |

Komórka pokazuje rodzaj ceny słowami i ikoną, nigdy samym kolorem. Procent mówi, od czego jest
liczony: *ceny bazowej* w cenniku katalogowym, *ceny katalogowej* w cenniku dla kupujących lub
promocyjnym, *ceny bazowej produktu* w linii wariantu cennika cen bazowych. Wartość, której nie da się
odczytać, ma za dużo miejsc po przecinku albo jest procentem spoza −100 % … +1000 %, jest oznaczana w
komórce z przyczyną i nigdy nie jest wysyłana.

**Pusta komórka dziedziczy** najbliższy niższy próg linii, pokazany przygaszonym tekstem —
*dziedziczy od 1: −5 %*. Gdy linia nie ma niższego progu, komórka pokazuje *brak ceny*: linia nie
wycenia tej ilości, a wycenia ją inna linia albo cena bazowa.

**Szczegóły komórki** (z menu komórki) pozwalają ustawić zakres ilości niezgodny z kolumnami, na
przykład 25–49 (dostaje własną kolumnę), pokazują, co dziedziczy pusta komórka, czyszczą komórkę i
otwierają **Skąd ta cena?** — wyjaśnienie ceny dla tego produktu.

### Praca z klawiaturą i arkuszem kalkulacyjnym

Z siatki można w pełni korzystać bez myszy: strzałki, Home/End, PageUp/PageDown, Tab i Shift+Tab
przesuwają; Enter albo F2 zaczyna edycję, a Enter ją zatwierdza; Escape anuluje; Delete czyści;
Ctrl/⌘+C i Ctrl/⌘+V kopiują i wklejają prostokątne bloki z arkusza kalkulacyjnego i do niego
(rozdzielane tabulatorem lub średnikiem); Ctrl/⌘+D wypełnia w dół; Ctrl/⌘+Z i Ctrl/⌘+Shift+Z cofają i
ponawiają. Wklejenie wypełnia komórki od komórki z fokusem; wiersze wykraczające poza widoczne linie
są pomijane z komunikatem.

**Zmień zaznaczone…** wprowadza jedną zmianę w każdej zaznaczonej komórce — *Ustaw procent*, *Ustaw
korektę kwotową*, *Pomnóż ceny stałe przez* albo *Wyczyść zaznaczone komórki* — i cofa się ją jednym
krokiem.

### Zapisywanie

Każda zmiana pozostaje **niezapisana**, dopóki nie naciśniesz **Zapisz ceny**; obok widać liczbę
niezapisanych zmian, a opuszczenie strony wymaga potwierdzenia. Zapis wysyła wszystkie zmiany jedną
partią i tworzy jeden wpis w dzienniku audytu. W trakcie zapisu przycisk pokazuje postęp i nie da się
go nacisnąć dwa razy.

- Jeśli serwer odrzuci część wierszy — nachodzenie na inny wiersz tej samej linii, cenę stałą w linii
  wszystkich produktów, produkt albo kategorię, które już nie istnieją — oznaczana jest **każda**
  odrzucona komórka z przyczyną, a wszystkie twoje zmiany zostają, gotowe do poprawienia.
- Jeśli ktoś inny zapisał cennik po tym, jak go otworzyłeś, siatka o tym informuje, zachowuje twoje
  niezapisane zmiany i po ponownym wczytaniu proponuje **Zastosuj ponownie moje zmiany** albo
  **Odrzuć moje zmiany**.

### Duże cenniki

Siatka dzieli się na strony według **linii** — 50, 100 albo 200 linii na stronę — i nigdy nie rozdziela
progów jednej linii ani wariantów produktu między strony. **Szukaj linii** znajduje linie po nazwie
produktu, SKU, kategorii albo wartości atrybutu na wszystkich stronach, a filtr **Rodzaj linii**
zawęża do jednego rodzaju. Niezapisane zmiany na innych stronach są zachowywane podczas przechodzenia
między stronami i wyszukiwania.

Linie, które niczego nie wyceniają, są pokazywane jako *Nieaktywne* z przyczyną — atrybut, który
stracił *Reguły cennika* albo został usunięty, usunięty produkt, wariant lub kategoria — i nadal się
otwierają.

Cennik inny niż cennik cen bazowych może mieć najwyżej 5 000 wierszy cen; siatka odrzuca zmianę, która
przekroczyłaby ten limit, jeszcze przed zapisem.

### Cenniki cen bazowych w siatce

Cennik cen bazowych otwiera się w tej samej siatce, ograniczonej do **linii produktów i wariantów**.
Cena bazowa produktu jest ceną stałą; linia wariantu to cena stała, procent albo korekta kwotowa ceny
bazowej jego produktu.

## Eksport i import CSV

**Plik CSV → Eksportuj do pliku CSV** pobiera cennik (albo linie, które pokazuje bieżące wyszukiwanie i
filtr) w stałym formacie cennika — jeden wiersz na próg, UTF-8 ze znacznikiem kolejności bajtów,
rozdzielany średnikiem, z przecinkiem dziesiętnym, gdy panel jest po polsku, a z kropką w przeciwnym
razie, co mówi nazwa pliku (`<cennik>-<data>-pl.csv` albo `-en.csv`). Plik otwiera się poprawnie w
arkuszu kalkulacyjnym z polskimi ustawieniami. Ponad 5 000 wierszy jest zapisywanych w numerowanych
plikach po najwyżej 5 000 wierszy, z których każdy można zaimportować osobno.

| Kolumna (angielska) | Kolumna (polska) | Wartość |
| --- | --- | --- |
| `kind` | `rodzaj` | `all`, `attribute`, `category`, `category_attribute`, `product`, `variant` |
| `product_sku` | `sku_produktu` | dla `product` i `variant` |
| `variant_sku` | `sku_wariantu` | dla `variant` |
| `category_path` | `sciezka_kategorii` | slugi kategorii od korzenia, połączone znakiem `/` |
| `attribute_key` | `kod_atrybutu` | dla `attribute` i `category_attribute` |
| `attribute_value` | `wartosc_atrybutu` | kod opcji |
| `min_quantity` | `od_ilosci` | liczba całkowita, 1 lub więcej |
| `max_quantity` | `do_ilosci` | liczba całkowita albo puste pole, gdy zakres nie ma końca |
| `price_kind` | `typ_ceny` | `fixed`, `percent`, `amount` |
| `value` | `wartosc` | cena stała; procent ze znakiem (`+20`, `-5`); kwota ze znakiem |

**Plik CSV → Importuj z pliku CSV…** czyta plik w tym formacie — z przecinkiem albo średnikiem, z
przecinkiem albo kropką dziesiętną, w UTF-8 ze znacznikiem kolejności bajtów albo bez niego, albo w
Windows-1250 (gdy plik nie jest w UTF-8, ekran pokazuje jego pierwsze wiersze i prosi o potwierdzenie
kodowania). Plik większy niż 5 MB albo z ponad 5 000 wierszy, z nieznaną, brakującą lub zdublowaną
kolumną albo pusty jest odrzucany przed czymkolwiek innym.

Wybierz sposób importu:

- **Scal** (domyślnie) — wiersze z pliku są dodawane albo zmieniane; pozostałe wiersze cennika
  zostają.
- **Zastąp** — wiersze cennika stają się dokładnie takie jak w pliku; podgląd podaje, ile wierszy
  zostałoby usuniętych.

**Podgląd** pochodzi z serwera, który sprawdza dokładnie tę partię, którą by zapisał, i niczego nie
zapisuje: liczby i listy wierszy dodanych, zmienionych (przed → po) oraz — w trybie zastępowania —
usuniętych, a także każdy wiersz, którego nie da się zaimportować, z numerem wiersza pliku i
przyczyną (nieznane SKU, wariant, ścieżka kategorii albo wartość atrybutu, atrybut, który nie może
wybierać cen, nieczytelna liczba, nachodzenie zakresów, wiersz, którego cennik cen bazowych nie może
zawierać). Podglądu z jakimkolwiek odrzuconym wierszem nie można zatwierdzić: popraw plik i prześlij
go ponownie albo użyj **Pobierz odrzucone wiersze** — w tym samym formacie z dodatkową kolumną
`reason`, którą import pomija, więc poprawiony plik importuje się w takiej postaci.

**Importuj zmiany: N** zapisuje partię jako jedną zmianę w dzienniku audytu, względem wersji cennika,
z której powstał podgląd. Jeśli w międzyczasie ktoś zapisał cennik, import jest odrzucany i
proponowany jest nowy podgląd. Importu nie można wykonać, gdy siatka ma niezapisane zmiany tego samego
cennika — najpierw je zapisz albo odrzuć. Wyeksportowany cennik zaimportowany bez zmian daje podgląd
*Brak zmian*.

## Duplikowanie cennika

**Duplikuj** otwiera okno wypełnione danymi cennika: nazwą z dopiskiem *(kopia)*, tymi samymi
kanałami sprzedaży, walutą i odbiorcami oraz polem **Pomnóż ceny stałe przez** równym 1. Zmień
dowolne z nich — inną walutę z mnożnikiem kursu, inną organizację jako odbiorcę. Ceny stałe i korekty
kwotowe są mnożone (z zaokrągleniem połówkowym w górę do czterech miejsc po przecinku); **procenty są
kopiowane bez zmian**. Kanały, które nie sprzedają w nowo wybranej walucie, są oznaczane przed
wysłaniem. Kopia jest szkicem i otwiera się po utworzeniu; oryginał pozostaje nietknięty. Kopia
zachowuje typ, priorytet i harmonogram oryginału.

## Ceny bazowe w produkcie

Zakładka **Pricing** edytora produktu kończy się panelem **Ceny bazowe**, dostarczanym przez ten
moduł. Jest dostępny, gdy produkt już istnieje.

- Jeden blok na każdą walutę, w której sprzedaje którykolwiek kanał sprzedaży: cena produktu *od 1* i
  **Dodaj próg** dla kolejnych progów, z których każdy zaczyna się powyżej poprzedniego.
- Dla produktu z wariantami każdy wariant: *Dziedziczy cenę produktu*, *Własna cena*, *Procent* albo
  *Korekta kwotowa*, z wynikową ceną pokazaną jako oznaczony **podgląd**, zaokrąglony tak jak na
  serwerze. Wariant, którego własna cena ma progi ilościowe, edytuje się w siatce cennika cen bazowych.
- Panel informuje, gdy produkt nie ma ceny bazowej w danej walucie — kupujący płacący w niej nie mogą
  go zamówić — albo nie ma jej wcale.
- **Zapisz ceny** zapisuje panel; to własny przycisk panelu, oddzielny od zapisu produktu, a
  opuszczenie zakładki albo strony z niezapisanymi cenami wymaga potwierdzenia (jeden zapis dla całej
  strony to zgłoszenie #407). Błędna wartość jest zgłaszana przy jej polu.
- **Otwórz ceny bazowe** otwiera siatkę cennika cen bazowych; **Skąd ta cena?** otwiera wyjaśnienie
  ceny dla tego produktu.

Pod nim, tylko do odczytu, **Cenniki ustalające cenę tego produktu** wymieniają każdy cennik z
wierszem wskazującym bezpośrednio ten produkt albo jeden z jego wariantów — cennik, jego odbiorców i
cenę ustalaną przez każdy wiersz — z odnośnikiem do siatki cennika.

Handlowiec widzi ceny bazowe, ale nie może ich zmieniać.

## Wyjaśnienie ceny

Wyjaśnienie ceny odpowiada na pytanie *„ile ten kupujący płaci za ten produkt i dlaczego?”*. Wybierz:

- **kanał sprzedaży** (gdy żadnego nie wybierzesz — kanał domyślny) i **walutę** (gdy żadnej nie
  wybierzesz — walutę kanału);
- **kupującego** — gościa, organizację albo klienta (wybór klienta wymaga `customers:read`);
  handlowiec ma do wyboru tylko własne organizacje;
- jedną lub więcej **linii** — produkt, opcjonalnie wariant, i ilość.

**Wyjaśnij** pokazuje dla każdej linii cenę; jej **źródło** — *Cena bazowa*, *Cena katalogowa*, *Cena
kupującego* albo *Cena promocyjna*; komórkę, która o niej zdecydowała, słowami (*Cennik organizacji,
linia produktu*); cennik (z odnośnikiem) i wiersz (**Otwórz wiersz** otwiera siatkę na tej linii);
**cenę odniesienia**, od której liczono procent albo korektę; wersję kolejności; oraz **przegrane** —
pozostałych kandydatów kroku, który zdecydował o cenie (najwyżej dziesięciu), w kolejności rangi. Przy
naliczonej cenie promocyjnej pokazuje też cenę regularną, z którą promocja wygrała. Dla linii bez ceny
mówi, że nie stosuje się do niej żadna cena bazowa, katalogowa, kupującego ani promocyjna, i proponuje
**Ustaw cenę bazową**.

Otwarte z cennika, komórki siatki, produktu albo organizacji wyjaśnienie ceny jest wypełnione danymi
z tego miejsca.

## Ustawienia cenowe

*Ustawienia cenowe* (`/price-lists/display-modes`) zawierają trzy rzeczy:

- **Tryby prezentacji** — tryby dla całej platformy dla zalogowanych i anonimowych odwiedzających
  (`pricing.default_display_mode`, `pricing.unauthenticated_display_mode`) oraz nadpisania dla
  organizacji, kategorii i produktu.
- **Ceny w sklepie** — *Pokazuj cenę katalogową obok ceny kupującego* (`pricing.show_list_price`,
  domyślnie wyłączone). Zapis tego ustawienia trafia do dziennika audytu, a kupujący widzą zmianę od
  następnej odsłony strony. Co wtedy widzą kupujący, opisano na
  [głównej stronie](../price_lists.md#where-prices-appear).
- **Kolejność cen** (`#precedence`) — obowiązujące ustawienie, jego wersję, dwanaście komórek w
  kolejności z przykładem każdej, informację, czy linia kategorii wygrywa z linią wartości atrybutu, i
  uwagę, że zmiana kolejności będzie możliwa w jednym z kolejnych wydań. Niczego tu nie można zmienić.

## Handlowcy

Handlowiec pracuje na tych samych ekranach, z tymi różnicami:

- Lista pokazuje cenniki organizacji, w których każdy odbiorca jest jedną z jego organizacji, oraz
  cenniki dla wszystkich i dla grup klientów. Cennika wskazującego jakąkolwiek inną organizację nie
  ma na liście, a jego adres pokazuje *Nie znaleziono cennika*, dokładnie tak jak dla cennika, który
  nie istnieje.
- Cenniki dla wszystkich, cenniki grup klientów i cenniki cen bazowych otwierają się tylko do
  odczytu, bez akcji edycji, zapisu, importu, duplikowania i usuwania.
- Tworzenie albo duplikowanie cennika oferuje tylko *Organizacje*, i tylko własne; listy wyboru
  odbiorców i wybór kupującego w wyjaśnieniu ceny wymieniają tylko jego organizacje.
