---
title: price_lists
sidebar_label: Cenniki
description: Cenniki — ceny bazowe w każdej walucie, ceny katalogowe, ceny dla kupujących i ceny promocyjne w kanałach sprzedaży oraz reguły, które decydują, ile płaci każdy kupujący.
---

# Cenniki (`price_lists`)

Każda cena, którą kupujący widzi albo płaci — na liście produktów, na stronie produktu, w
wyszukiwarce, w koszyku, w zamówieniu, jako cena referencyjna zapytania ofertowego, w zewnętrznym API
katalogu i w feedzie produktowym — pochodzi z **cenników**. Ta strona wyjaśnia, czym jest cennik i jak
platforma wybiera cenę, którą płaci kupujący. Dwie kolejne strony opisują szczegóły:

- [Edytor cenników](./price_lists/price-book-editor.md) — ekrany panelu administracyjnego krok po
  kroku: lista cenników, tworzenie cennika, siatka cen, import i eksport CSV, duplikowanie cennika,
  ceny bazowe w produkcie, wyjaśnienie ceny i *Ustawienia cenowe*.
- [Ceny dla programistów](./price_lists/developer-guide.md) — model danych, algorytm wyceny, jedyna
  dozwolona ścieżka odczytu, pamięć podręczna, powierzchnia cen stojąca za sortowaniem według ceny,
  API administracyjne, porty używane przez inne moduły oraz to, jak wydanie przekształciło stary
  model.

Modułu nie można wyłączyć na ekranie modułów: sprzedaż B2B to ceny kontraktowe, a bez tego modułu
każdy kupujący płaciłby bez ostrzeżenia cenę bazową.

## Idea w jednym akapicie

Każdy produkt ma **cenę bazową** w każdej walucie. Cennik **katalogowy** może zmienić tę cenę dla
wszystkich w wybranych kanałach sprzedaży. Cennik **dla kupującego** daje organizacji, zbiorowi
organizacji albo zbiorowi grup klientów ich własne ceny. Cennik **promocyjny** oferuje cenę czasową,
która jest naliczana tylko wtedy, gdy jest niższa od ceny, jaką kupujący zapłaciłby w przeciwnym
razie. Gdy kilka cenników wycenia ten sam produkt dla tego samego kupującego, o zwycięzcy decyduje
stała, jawna kolejność — **kolejność cen** — a **wyjaśnienie ceny** pokazuje dla dowolnego kupującego
i produktu, który cennik wygrał, a które przegrały.

## Czym jest cennik

Cennik ma **nagłówek** i **wiersze**.

Nagłówek ustala:

| Pole | Co oznacza |
| --- | --- |
| **Nazwa** | Po niej rozpoznajesz cennik. Zmiana nazwy nigdy nie zmienia tego, która cena wygrywa. |
| **Typ** | *Ceny regularne* — ceny, które płacą kupujący — albo *Ceny promocyjne*, naliczane tylko wtedy, gdy są niższe od zwykłej ceny kupującego. |
| **Waluta** | Dokładnie jedna. Po utworzeniu cennika nigdy się nie zmienia; aby ustalić ceny w innej walucie, zduplikuj cennik. |
| **Kanały sprzedaży** | Kanały, w których cennik obowiązuje. Każdy musi sprzedawać w walucie cennika. Kanał, który później przestaje oferować tę walutę, zostaje w cenniku jako *Nieaktywny*, a cennik przestaje w nim obowiązywać; gdy kanał znów oferuje walutę, cennik znów obowiązuje — bez żadnej zmiany w cenniku. |
| **Dla kogo są ceny** (odbiorcy) | *Wszyscy*, zbiór *grup klientów* albo zbiór *organizacji* — jeden rodzaj na cennik, nigdy mieszanka. Rodzaj nie zmienia się, odkąd cennik był aktywny. |
| **Harmonogram** | Opcjonalny początek i koniec. Cennik obowiązuje dokładnie od chwili początku do chwili końca. |
| **Priorytet** | Liczba całkowita. Rozstrzyga tylko między cennikami, które wyceniają ten sam rodzaj linii dla tego samego kupującego — wygrywa wyższa liczba — i nigdy nie pozwala ogólnej linii wygrać z bardziej szczegółową. |
| **Stan** | *Szkic*, *Zaplanowany*, *Aktywny* albo *Wygasły*. Szkic nigdy nie obowiązuje. Aktywacja zmienia stan cennika na *Aktywny*, a na *Zaplanowany*, gdy jego początek jest w przyszłości. *Przenieś do szkiców* znów wyłącza cennik z użycia. |

Cennik można aktywować tylko wtedy, gdy obowiązywałby gdzieś i kogoś: potrzebuje co najmniej jednego
kanału sprzedaży, który sprzedaje w jego walucie, a cennik grup klientów lub organizacji — co
najmniej jednego odbiorcy.

Każdy **wiersz** wycenia jedną **linię** cennika dla progu ilościowego. Linia to jedno z:

| Linia | Wycenia |
| --- | --- |
| **Wszystkie produkty** | każdy produkt (tylko procentem albo korektą — nigdy jedną ceną stałą dla wszystkiego) |
| **Wartość atrybutu** | każdy produkt z tą wartością atrybutu, na przykład *color = red* |
| **Kategoria** | każdy produkt przypisany do tej kategorii (własne przypisanie produktu; podkategorie się nie liczą) |
| **Kategoria i wartość atrybutu** | produkty z tej kategorii, które mają tę wartość — na przykład czerwone produkty z kategorii *Screws* |
| **Produkt** | jeden produkt i wszystkie jego warianty |
| **Wariant** | jeden wariant produktu |

Linie atrybutów mogą tworzyć tylko atrybuty oznaczone jako **Reguły cennika** w *Katalog → Atrybuty*,
i tylko takie, których wartości są pojedynczym wyborem, wielokrotnym wyborem albo tak/nie i które nie
zależą od języka ani od kanału sprzedaży. Jeśli atrybut straci tę flagę (albo przestanie się
kwalifikować), jego linie przestają wyceniać — siatka pokazuje je jako *Nieaktywne* z przyczyną — i
znów wyceniają, gdy tylko atrybut znów się kwalifikuje. Wycena nigdy nie kończy się błędem z powodu
takiej linii.

Wiersz podaje cenę na jeden z trzech sposobów:

| Rodzaj | Wpisywany jako | Znaczenie |
| --- | --- | --- |
| **Cena stała** | `95` albo `95,50` | cena, do czterech miejsc po przecinku |
| **Procent** | `-5%`, `+20%` | rabat albo narzut, od −100 % (pozycja za darmo) do +1000 %, do dwóch miejsc po przecinku |
| **Korekta kwotowa** | `-3`, `+3` | kwota odejmowana albo dodawana |

Procent albo korekta jest liczona od **ceny odniesienia**: od ceny bazowej w cenniku katalogowym, od
ceny katalogowej w cennikach dla kupujących i promocyjnych (zob. niżej). Jeśli wynik wiersza byłby
poniżej zera, ten wiersz nie wycenia linii i sprawdzany jest następny kandydat; wynik równy dokładnie
zero jest poprawną ceną.

**Progi ilościowe.** Każdy wiersz zaczyna się od pewnej ilości („od 1”, „od 10”, „od 100”) i, jeśli
nie ma jawnego końca, obowiązuje do miejsca, w którym zaczyna się następny próg tej linii. Dwa wiersze
tej samej linii nie mogą na siebie nachodzić. Wiersz, który nie obejmuje zamawianej ilości, jej nie
wycenia, a wycena przechodzi do następnego kandydata — innego progu tej samej linii albo innej linii.

Cennik może mieć najwyżej 5 000 wierszy. Cenniki cen bazowych nie mają tego limitu, bo przechowują
cenę bazową każdego produktu w katalogu.

## Ceny bazowe

Każda waluta ma dokładnie jeden **cennik cen bazowych** — na liście widoczny jako *Ceny bazowe —
PLN*, *Ceny bazowe — EUR* i tak dalej. Obowiązuje każdego kupującego, w każdym kanale sprzedaży, który
sprzedaje w jego walucie, i jest zawsze aktywny: nie można zmienić jego nazwy, zaplanować go, nadać
mu priorytetu ani go usunąć.

- **Cena bazowa produktu** to cena stała, opcjonalnie z progami ilościowymi, w każdej walucie, w
  której sprzedajesz produkt. Ustawiasz ją w samym produkcie (*Katalog → Produkty*, zakładka
  *Pricing*) albo w siatce cennika cen bazowych.
- **Wariant** albo **dziedziczy** cenę bazową produktu, albo ma **własną cenę**, albo jest
  **procentem** lub **kwotą** powyżej albo poniżej ceny bazowej produktu przy tej samej ilości.

Cena bazowa nigdy nie jest przeliczana między walutami: produkt z ceną bazową tylko w PLN nie ma w
EUR żadnej ceny. **Produkt bez ceny bazowej w danej walucie, którego nie wycenia żaden inny cennik,
nie ma w tej walucie ceny**: kupujący nie mogą dodać go do koszyka i widzą zamiast tego ścieżkę
zapytania ofertowego. Innej ceny zastępczej nie ma — produkt nie ma własnej ceny.

Cennik cen bazowych domyślnej waluty platformy istnieje zawsze; cennik cen bazowych innej waluty
powstaje przy pierwszym zapisie ceny bazowej w tej walucie.

## Jak wybierana jest cena, którą płaci kupujący

Cena jest zawsze wyliczana dla produktu (a jeśli jest wybrany — wariantu), ilości, kanału sprzedaży,
waluty i kupującego. Kupujący to gość albo organizacja — razem z jej organizacjami nadrzędnymi — oraz
**jedna grupa klientów**: własna grupa zalogowanego klienta, jeśli ją ma, a w przeciwnym razie grupa
jego organizacji.

Udział biorą tylko cenniki, które są teraz aktywne, w walucie żądania, w kanale żądania (gdy ten kanał
sprzedaje w tej walucie) i dla tego kupującego. Cena powstaje potem w czterech krokach:

1. **Cena bazowa** — wiersz bazowy wariantu, jeśli wariant go ma, a w przeciwnym razie wiersz
   produktu, w progu obejmującym ilość.
2. **Cena katalogowa** — najlepszy wiersz cenników regularnych dla *wszystkich* w tym kanale, jeśli
   któryś wycenia linię: linia wariantu przed linią produktu, przed linią kategorii i wartości
   atrybutu, przed linią kategorii, przed linią wartości atrybutu, przed linią wszystkich produktów.
   Procenty są liczone od ceny bazowej. Jeśli żaden taki wiersz nie wycenia linii, ceną katalogową
   jest cena bazowa.
3. **Cena kupującego** — najlepszy wiersz cenników regularnych dla organizacji i grupy klientów
   kupującego, według opisanej niżej kolejności cen. Procenty są liczone od **ceny katalogowej**.
   Jeśli żaden taki wiersz nie wycenia linii, ceną kupującego jest cena katalogowa.
4. **Cena promocyjna** — najlepszy wiersz cenników promocyjnych, które dotyczą kupującego (najpierw
   cenniki promocyjne jego organizacji i grupy, potem cenniki promocyjne dla wszystkich). Procenty są
   liczone od ceny katalogowej. Cena promocyjna jest **naliczana tylko wtedy, gdy jest ściśle niższa
   od ceny kupującego**; kupujący widzi wtedy swoją cenę przekreśloną. Cena promocyjna równa cenie
   kupującego lub wyższa nie jest naliczana i nic nie jest przekreślane — klient kontraktowy nigdy nie
   płaci więcej z powodu promocji.

Ponieważ procenty dla kupujących są liczone od ceny katalogowej, rabat kontraktowy podąża za ceną
kanału: jeśli kanał sprzedaje produkt za 120 zamiast 100, rabat kontraktowy 20 % daje 96.

Procenty są zaokrąglane połówkowo w górę do czterech miejsc po przecinku; koszyk zaokrągla kwoty
pozycji do dwóch, jak zawsze.

### Kolejność cen

Kupującego może wyceniać naraz kilka linii — cena jego organizacji za jeden produkt, rabat jego
organizacji na całą kategorię, cena jego grupy klientów za ten sam produkt. Każdy kandydat należy do
jednej z dwunastu **komórek**: dla kogo jest cennik (*organizacja* albo *grupa klientów*) × co wybiera
linia. Kolejność cen to porządek tych dwunastu komórek; wygrywa pierwsza komórka, w której jest
kandydat.

Platforma jest dostarczana z ustawieniem **Najpierw umowa, rabat ogólny na końcu (HY)**:

| # | Komórka | Przykład |
| --- | --- | --- |
| 1 | Organizacja × wariant | cena Acme za jeden wariant produktu Screws 0200 |
| 2 | Organizacja × produkt | cena Acme za Screws 0200 |
| 3 | Organizacja × kategoria i wartość atrybutu | cena Acme za czerwone produkty z kategorii Screws |
| 4 | Organizacja × kategoria | cena Acme za wszystko z kategorii Screws |
| 5 | Organizacja × wartość atrybutu | cena Acme za wszystko, co czerwone |
| 6 | Grupa klientów × wariant | cena klientów VIP za jeden wariant produktu Screws 0200 |
| 7 | Grupa klientów × produkt | cena klientów VIP za Screws 0200 |
| 8 | Grupa klientów × kategoria i wartość atrybutu | cena klientów VIP za czerwone produkty z kategorii Screws |
| 9 | Grupa klientów × kategoria | cena klientów VIP za wszystko z kategorii Screws |
| 10 | Grupa klientów × wartość atrybutu | cena klientów VIP za wszystko, co czerwone |
| 11 | Organizacja × wszystkie produkty | rabat Acme na wszystko |
| 12 | Grupa klientów × wszystkie produkty | rabat klientów VIP na wszystko |

Wynegocjowane ceny organizacji wygrywają więc z cenami jej grupy, z jednym wyjątkiem: ogólny rabat
organizacji na wszystko nie wygrywa z konkretną ceną, którą ma jej grupa klientów — inaczej mały rabat
ogólny sprawiałby, że ta organizacja płaci więcej niż każdy inny członek grupy. Linia kategorii
wygrywa z linią wartości atrybutu na każdym kroku.

W obrębie jednej komórki pozostałe remisy rozstrzyga kolejno:

1. **Bliższa organizacja** — linia własnej organizacji kupującego przed linią jej organizacji
   nadrzędnej, przed linią organizacji nadrzędnej wobec tamtej. Oddział bez własnej linii w danej
   komórce dostaje linię centrali.
2. **Priorytet** — wygrywa wyższa liczba.
3. **Wyższa ilość początkowa** — wiersz „od 100” przed wierszem „od 10”, który również obejmuje
   ilość.
4. **Niższa cena.**
5. Stały porządek wewnętrzny, dzięki któremu wynik nigdy nie zależy od czasu, od zmiany nazwy ani od
   tego, który cennik edytowano jako ostatni.

Obowiązująca kolejność jest widoczna tylko do odczytu w *Ustawieniach cenowych*. W kodzie istnieją
trzy inne ustawienia — *Najpierw odbiorca (AF)*, *Najpierw szczegółowość (SF)* i *Najpierw odbiorca,
najbliższa organizacja przed nadrzędnymi (AF-N)* — ale zmiana kolejności nie jest jeszcze dostępna:
pojawi się w jednym z kolejnych wydań, z podglądem skutków zmiany.

### Warianty

Wariant jest wyceniany w tych samych cennikach co jego produkt. Linia wariantu wygrywa z linią jego
produktu u tych samych odbiorców; **stała** cena produktu obowiązuje każdy wariant, chyba że wycenia
go linia wariantu z tej samej albo lepszej komórki; **procent** na produkcie zachowuje różnice między
jego wariantami. Linia atrybutu dopasowuje wariant po jego własnych wartościach osi (czerwony wariant
produktu pasuje do *color = red*), nałożonych na wartości produktu.

Na liście produktów produkt, którego warianty kosztują różnie, pokazuje najniższą cenę jako cenę
**„od”**; sortowanie i filtrowanie według ceny korzystają z tej najniższej ceny. Na stronie produktu
pokazywana jest cena wybranego wariantu, a koszyk nalicza cenę wariantu z pozycji.

## Gdzie pojawiają się ceny {#where-prices-appear}

Ten sam kupujący, produkt, wariant, ilość, kanał i waluta dają **tę samą cenę na każdej
powierzchni**: na listach produktów, w wynikach i podpowiedziach wyszukiwania, na stronie produktu, w
porównaniach, w produktach powiązanych, w koszyku i przy składaniu zamówienia, w formularzu zamówienia
w panelu administracyjnym, w zapytaniach ofertowych, w zewnętrznym API katalogu i w feedach
produktowych. Koszyk ponownie wycenia pozycję przy każdym dodaniu, połączeniu i zmianie ilości, a
złożenie zamówienia odrzuca koszyk, którego zapisana cena nie jest już aktualna
(`409 CART_PRICE_CHANGED`), więc kupujący sprawdza nową cenę przed zamówieniem.

**Sortowanie i filtrowanie według ceny** podąża za cenami pokazywanymi na kartach produktów, dla
każdego kupującego — kupujący z własnymi cenami kontraktowymi widzi listę w porządku swoich cen.
Porządek pochodzi z cen wyliczanych przez platformę w tle: po zmianie ceny karty od razu pokazują
nową cenę, a porządek sortowania nadąża, gdy tylko wykona się odświeżanie w tle. Odświeżanie
przelicza tylko produkty, które zmiana może przesunąć, dla kupujących, do których sięga, więc linia
cennika, cena bazowa albo edycja produktu pojawia się w porządku w ciągu około pół sekundy w
pomiarach platformy, także w trakcie dużego importu produktów. Zmiana, która sięga całego katalogu —
linia dla wszystkich produktów albo tylko dla wartości atrybutu, zmiana ponad 10 000 produktów naraz
albo zmiana kanału sprzedaży — przelicza porządek w całości dla każdej grupy kupujących, do której
sięga, co w dużym katalogu z wieloma cennikami kontraktowymi trwa kilka minut: platforma zakłada
dla niej pięć minut przy około 200 takich grupach (zmierzono 4 min 35 s przy 202), wobec jednej
minuty dla każdej innej zmiany. Przyspieszenie tego opisuje zgłoszenie #416.

**Cena katalogowa obok ceny kupującego.** Po włączeniu ustawienia *Pokazuj cenę katalogową obok ceny
kupującego* (*Ustawienia cenowe*, domyślnie wyłączone) kupujący, którego cena jest niższa od ceny
katalogowej, widzi obie na stronie produktu, na listach produktów, w wynikach wyszukiwania i w
podpowiedziach — *Cena katalogowa 100,00 · Twoja cena 95,00*. Kupujący, którego cena jest równa cenie
katalogowej lub wyższa, widzi jedną cenę. Gdy naliczana jest cena promocyjna, kupujący widzi tylko dwie
ceny: przekreśloną cenę katalogową i cenę promocyjną jako *Twoja cena*; jego zwykła cena kontraktowa
nie jest pokazywana jako trzecia liczba. Przy wyłączonym ustawieniu naliczona cena promocyjna
przekreśla własną cenę kupującego. Koszyk i składanie zamówienia zawsze pokazują tylko naliczaną cenę.

**Tryby prezentacji** decydują, jak ceny są pokazywane — tylko brutto, tylko netto, obie albo wcale.
Tryb *none* ukrywa wszystkie ceny i zastępuje *Dodaj do koszyka* przyciskiem *Dodaj do zapytania
ofertowego*; koszyk również odrzuca taki produkt (`400 CART_PRODUCT_QUOTE_ONLY`). Tryb ustawia się dla
całej platformy (osobno dla zalogowanych i anonimowych odwiedzających) i można go nadpisać dla
organizacji, kategorii i produktu; wygrywa najbardziej szczegółowe ustawienie. Tryby prezentacji
ustawia się w *Ustawieniach cenowych* oraz w edytorach organizacji i kategorii.

## Przykłady — sklep demonstracyjny

Sklep demonstracyjny (`pnpm run cli demo seed`) zawiera trzy scenariusze, na podstawie których
zaprojektowano model, z dokładnymi liczbami. Jego dane:

- *Screws 0200* — czerwony, w kategorii *Screws*, cena bazowa 100,00 PLN;
- *Screws 0032* — niebieski, w kategorii *Screws*, cena bazowa 50,00 PLN;
- *Bolts 0025* — czerwony, w kategorii *Bolts*, cena bazowa 30,00 PLN;
- organizacja *Acme B2B (demo)*, członek grupy klientów *VIP*.

Trzy scenariusze są **alternatywami**: po wczytaniu danych demonstracyjnych cenniki E3 są aktywne,
a cenniki E1 i E2 są szkicami. Aby zobaczyć E1 albo E2, aktywuj cenniki tego scenariusza, a pozostałe przenieś do szkiców.

**E1 — cena dla wszystkich na kategorię i wartość atrybutu.** Cennik *E1 — red screws for everyone
(demo)*: regularny, dla wszystkich, jedna linia *Screws* ∩ *color = red*, cena stała 120.

| Kupujący | Produkt | Płaci | Dlaczego |
| --- | --- | --- | --- |
| gość | Screws 0200 | 120,00 | linia katalogowa wycenia czerwone wkręty |
| gość | Screws 0032 | 50,00 | niebieski: linia nie pasuje, więc cena bazowa |
| gość | Bolts 0025 | 30,00 | czerwony, ale nie wkręt: cena bazowa |
| Acme | Screws 0200 | 120,00 | Acme nie ma w tym scenariuszu własnego cennika |

**E2 — umowa organizacji.** Cennik *E2 — Acme B2B contract (demo)*: regularny, dla organizacji
Acme, *Screws* −10 %, *Screws 0200* −20 %.

| Kupujący | Produkt | Płaci | Dlaczego |
| --- | --- | --- | --- |
| Acme | Screws 0200 | 80,00 | linia produktu (−20 %) wygrywa z linią kategorii (−10 %) |
| Acme | Screws 0032 | 45,00 | linia kategorii |
| Acme | Bolts 0025 | 30,00 | nic nie pasuje: cena bazowa |
| inna organizacja | Screws 0200 | 100,00 | nie jest odbiorcą: cena bazowa |

Gdy aktywny jest także E1, Acme płaci za Screws 0200 96,00: −20 % jest liczone od ceny katalogowej
120, a nie od ceny bazowej.

**E3 — organizacja w grupie klientów.** Cenniki *E3 — VIP customers (demo)* (dla grupy klientów VIP,
*Screws 0200* −10 %) oraz *E3 — Acme B2B terms (demo)* (dla organizacji Acme, *Screws 0200* −5 %,
*Screws* −15 %).

| Kupujący | Produkt | Płaci | Dlaczego |
| --- | --- | --- | --- |
| Acme | Screws 0200 | 95,00 | *Organizacja × produkt* (−5 %) to najlepsza komórka; linia kategorii (85,00) i linia VIP (90,00) przegrywają |
| inna organizacja z grupy VIP | Screws 0200 | 90,00 | linia VIP |
| Acme | Screws 0032 | 42,50 | linia kategorii Acme (−15 %) |
| oddział Acme | Screws 0200 | 95,00 | odziedziczona po centrali |
| gość albo organizacja spoza VIP | Screws 0200 | 100,00 | cena bazowa |

Wyjaśnienie ceny odpowiada na każdy wiersz tych tabel, podając zwycięski cennik, komórkę, cenę
odniesienia i przegrane linie.

## Kto może co

| Uprawnienie | Daje |
| --- | --- |
| `price_lists:read` | listę cenników, ustawienia i ceny każdego cennika, ceny bazowe, wyjaśnienie ceny, *Ustawienia cenowe* |
| `price_lists:write` | tworzenie, zmienianie, aktywowanie, planowanie, duplikowanie, importowanie i usuwanie cenników; ceny bazowe; tryby prezentacji; ustawienie ceny katalogowej. Dodawanie linii produktów korzysta też z przeglądarki produktów katalogu, więc rola edytująca cenniki potrzebuje także `catalog:read` (mówi o tym edytor ról na `/admin-roles`). |

**Handlowcy** — administratorzy, których rola ogranicza do własnych organizacji — widzą i edytują
tylko cenniki organizacji, w których **każdy** odbiorca jest jedną z ich organizacji. Cenniki dla
wszystkich, cenniki grup klientów i ceny bazowe są dla nich tylko do odczytu. Cennik, który wskazuje
jakąkolwiek organizację spoza ich zakresu, dla nich nie istnieje: nie ma go na liście, a jego adres
pokazuje tę samą stronę co cennik, którego nigdy nie utworzono. Tworząc cennik, mogą wybrać tylko
*Organizacje*, i tylko własne.

Każda zmiana cennika — jego ustawień, kanałów, odbiorców, wierszy, aktywacji, duplikat, usunięcie — oraz
każda zmiana cen bazowych i ustawienia ceny katalogowej jest zapisywana w dzienniku audytu z
administratorem i stanem przed zmianą i po niej; *Zobacz historię* w cenniku otwiera jego wpisy.

## Znane ograniczenia

- **Kolejności cen nie można jeszcze zmienić.** Obowiązuje wyłącznie ustawienie HY; proces zmiany, z
  podglądem skutków, pojawi się w jednym z kolejnych wydań.
- **Promocje działają dodatkowo na ceny promocyjne i kontraktowe.** Promocja koszyka nie wie jeszcze,
  czy pozycja jest wyceniona ceną promocyjną albo kontraktową; wykluczanie takich pozycji pojawi się w
  jednym z kolejnych wydań.
- **Panel cen bazowych w produkcie ma własny przycisk *Zapisz ceny***, oddzielny od zapisu edytora
  produktu, i pyta przed opuszczeniem go z niezapisanymi zmianami. Jeden zapis dla całej strony
  produktu to zgłoszenie #407.
- **Lista cenników nie ma zapisanych widoków**; jej filtry są przechowywane w adresie strony, więc
  przefiltrowaną listę można dodać do zakładek i udostępnić (zgłoszenie #408).
- **Tuż po dużym imporcie** stronicowanie i wyszukiwanie w siatce bardzo dużego cennika (dziesiątki
  tysięcy linii) mogą trwać nieco dłużej, dopóki baza danych nie odświeży statystyk, co robi sama
  wkrótce potem (zgłoszenie #409).
- **Zakładka *Variants* edytora produktu nie pokazuje wariantów produktu nieaktywnego ani produktu
  spoza domyślnego kanału sprzedaży**, bo odczytuje je przez odczyt storefrontu (zgłoszenie #410).
  Panel cen bazowych tego problemu nie ma: odczytuje każdy wariant.
- **Etykiety zakładek edytora produktu inne niż *Ceny* są po angielsku** w polskim panelu
  (zgłoszenie #413).
- **Czytniki ekranu odczytują znaczek promocji w sklepie jako „Zapytaj o ofertę”**; widoczny tekst jest
  poprawny (zgłoszenie #411).
- **Porządek sortowania opóźnia się względem zmiany ceny** o czas odświeżania w tle — zwykle poniżej
  sekundy, a do około pięciu minut przy zmianie, która sięga całego katalogu (zob. *Gdzie
  pojawiają się ceny*; zgłoszenie #416); ceny na kartach nigdy się nie opóźniają. Sortowanie według
  ceny wymaga działających workerów platformy.
- **Zewnętrzne API katalogu** wycenia organizację klucza API z grupą klientów tej organizacji, a nie
  z własną grupą powiązanego konta klienta, a jego zbiorcze żądanie cen wskazuje wyłącznie SKU
  produktów.
- **Feedy produktowe wyceniają produkty, nie warianty**, dla ilości 1, a feed przypina się do
  cennika tylko przez API administracyjne — żaden ekran feedu tego nie ustawia (zgłoszenie #414).

## Aktualizacja ze starych cenników (uwaga migracyjna)

Wydanie, które wprowadziło cenniki w obecnym kształcie, zastąpiło poprzedni model cen w jednym kroku.
W instancji, która go używała:

- **Ceny bazowe zostały zachowane.** Każda cena starego cennika *Default* stała się ceną bazową w
  swojej walucie.
- **Wszystkich pozostałych cenników już nie ma** — razem z ich regułą stosowania, produktami i
  przedziałami ilościowymi oraz macierzą cen. Ceny, które zawierały, utwórz ponownie jako cenniki.
  Cennik, do którego był przypięty feed produktowy, zostaje jako pusty, nieaktywny cennik o nazwie
  `<old name> (removed by the 0.108.0 upgrade)`, który można usunąć, gdy feed zostanie przypięty do
  jego zamiennika.
- **Nie ma już *Default unit price* produktu ani nadpisania ceny wariantu** i nie zostały one
  przeniesione: edytor produktu nie ma tych pól, a zapisy produktów i import produktów je odrzucają
  (`400 PRICE_SET_IN_PRICE_BOOKS`). Produkt, który miał tylko *Default unit price*, a nie miał ceny w
  cenniku *Default*, nie ma ceny, dopóki nie wpiszesz ceny bazowej w jego zakładce *Pricing*.

Co zrobiły migracje i które wywołania API zastąpiły usunięte, opisano na stronie
[Ceny dla programistów](./price_lists/developer-guide.md#upgrading-from-the-old-model-migration-note).
