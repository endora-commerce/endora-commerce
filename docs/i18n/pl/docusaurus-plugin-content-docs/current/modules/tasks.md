---
title: Zadania
description: Zadania dla administratorów — wiele osób przypisanych, terminy, priorytety, etykiety, przebieg określony przez operatora, lista i tablica, komentarze, podzadania, powiązania, przypomnienia i dzienne podsumowanie — które inne moduły mogą przejmować przez kontekst zadania
---

# Zadania (`tasks`)

Moduł Zadania przechowuje **zadania**: pracę do wykonania przez osoby
korzystające z panelu administracyjnego. Zadanie ma tytuł, sformatowany opis,
dowolną liczbę osób przypisanych, termin (opcjonalnie z godziną), datę
rozpoczęcia, priorytet, etykiety, pola niestandardowe i załączniki. Przechodzi
przez statusy określone przez operatora, jest pokazywane jako lista albo jako
tablica, można je omawiać w komentarzach, dzielić na podzadania, wiązać
z szansami sprzedażowymi, zamówieniami i zapytaniami ofertowymi, których
dotyczy, a ono samo przypomina o sobie.

## Co robi

Każde zadanie ma numer, np. `TSK-000042`, nadawany przy utworzeniu i nigdy
nieużywany ponownie.

**Statusy.** Zadanie zawsze ma jeden **status** z **przebiegu** określonego
przez operatora: statusów i dozwolonych przejść między nimi (zob. *Konfiguracja
zadań*). Każdy status należy do jednej **kategorii** — *otwarte*, *zakończone*
albo *anulowane*. Zadanie w statusie zakończonym albo anulowanym jest
**zamknięte**; każde inne jest **otwarte**. Nowe zadanie zaczyna się
w statusie początkowym przebiegu. Świeża instalacja ma cztery statusy, a po
każdym może nastąpić każdy inny:

| Status | Kategoria |
| --- | --- |
| *Do zrobienia* (`todo`) | otwarte — status początkowy |
| *W toku* (`in_progress`) | otwarte |
| *Zrobione* (`done`) | zakończone |
| *Anulowane* (`cancelled`) | anulowane |

Gdy zadanie wchodzi w status zakończony, ta chwila jest zapisywana; wyjście
z niego znów ją czyści.

**Termin.** Zadanie może mieć termin, a do niego godzinę. Z godziną jest
**po terminie** od tej chwili, dopóki jest otwarte; z samą datą — od początku
następnego dnia. Daty są liczone w strefie czasowej z ustawień modułu Zadania
(zob. *Ustawienia*).

**Kto widzi zadanie.** Zadanie może istnieć samodzielnie albo należeć do
rekordu, którego właścicielem jest inny moduł — na przykład do projektu i
jednego z jego etapów. Ten rekord to **kontekst** zadania. Zadanie bez
kontekstu widzi każdy, kto może przeglądać zadania. Zadanie z kontekstem widzą
tylko osoby, którym moduł będący właścicielem kontekstu pozwala zobaczyć ten
rekord: kto nie widzi projektu, nie widzi też nigdzie jego zadań — ani na
liście, ani na tablicy, ani w wyszukiwaniu, ani w odwołaniu, ani pod ich
adresem. Dla takiej osoby to zadanie nie istnieje.

Dwa rodzaje zadań widzi jeszcze mniej osób:

- **Szkic** widzi tylko osoba, która go utworzyła — nikt inny,
  niezależnie od uprawnień. Nikt nie dostaje powiadomienia o szkicu,
  żadne jego przypomnienie nie jest wysyłane i nie liczy się on do blokady
  zakończenia żadnego projektu. Gdy jest gotowy, jego autor go **publikuje**;
  opublikowane zadanie nie może wrócić do szkicu.
- Zadanie **prywatne** widzi tylko osoba, która je utworzyła, oraz posiadacze
  uprawnienia *See private tasks* — na przykład gdy autor odszedł z firmy.
  Zadanie prywatne nie należy do żadnego rekordu i może być przypisane tylko
  swojemu autorowi.

Zadanie może być jednym i drugim. Powiązanie zadania z szansą sprzedażową,
zamówieniem albo zapytaniem ofertowym **nie** zmienia tego, kto je widzi.

Gdy moduł będący właścicielem kontekstu zostanie wyłączony, zadania tego
kontekstu znikają z modułu Zadania do czasu jego ponownego włączenia; nic nie
jest usuwane.

## W panelu administracyjnym

Zadania są w menu bocznym w sekcji **Projekty i zadania**: **Moje zadania**
(`/tasks/mine`) i **Zadania** (`/tasks`) dla administratorów, którzy mogą
przeglądać zadania, oraz **Ustawienia zadań** dla tych, którzy je konfigurują.

**Zadania** (`/tasks`) pokazuje każde zadanie, które możesz zobaczyć, jako
**listę** albo **tablicę** — przełącza się je polem *Widok*. Wybór jest
zapamiętywany dla ciebie na każdym urządzeniu, na którym się logujesz, a filtry
ustawione przed przełączeniem zostają.

- **Lista** pokazuje numer, tytuł, status, priorytet, etykiety, termin —
  oznaczony *Po terminie*, gdy minie, a zadanie jest wciąż otwarte — osoby
  przypisane i rekord, do którego zadanie należy. Rekord jest odnośnikiem,
  dopóki jest dla ciebie dostępny; rekord, którego nie możesz już zobaczyć albo
  którego moduł jest wyłączony, jest nazwany *Niedostępny rekord*, bez
  odnośnika. *Sortuj według* porządkuje listę według chwili utworzenia lub
  ostatniej zmiany, terminu, priorytetu, statusu (w kolejności przebiegu),
  numeru albo tytułu. Przechodzi się po niej stronami do przodu i do tyłu, po
  pięćdziesiąt zadań.
- **Tablica** ma jedną kolumnę na status, w kolejności przebiegu; każda podaje,
  ile zadań zawiera, i pokazuje pierwsze z nich, z *Pokaż więcej*. Karta
  pokazuje tytuł zadania i pola wybrane przez operatora (zob. *Konfiguracja
  zadań*) — domyślnie numer, osoby przypisane, termin, priorytet i etykiety.
  Przeciągnij kartę do innej kolumny, aby przenieść tam zadanie; z klawiatury —
  podnieś ją spacją albo Enterem, wybierz kolumnę strzałkami i upuść — albo
  użyj menu przeniesienia na karcie. Przejście, na które przebieg nie pozwala,
  jest odrzucane, a karta zostaje na miejscu. Bez uprawnienia do zmieniania
  zadań tablicę można oglądać, ale nie przenosić kart.
- **Filtry**, te same dla listy i tablicy: status, otwarte lub zamknięte, osoba
  przypisana (ktokolwiek, ty albo nikt), utworzone przez (ktokolwiek albo ty),
  priorytet, etykiety (każda wybrana), termin od i do, tylko zadania po
  terminie, tylko podzadania, tylko zadania główne albo tylko zadania
  z podzadaniami, tylko twoje szkice (*Tylko moje szkice*), tylko
  zadania prywatne, pola niestandardowe zadań oznaczone jako filtry listy oraz
  wyszukiwanie po numerze lub tytule. *Pokaż na liście zadań* w panelu
  *Zadania* otwiera listę zadań jednego rekordu, a *Pokaż wszystkie zadania*
  wraca do całości.
- **Zapisane widoki** przechowują zestaw filtrów pod nazwą, tylko dla ciebie
  albo udostępniony każdemu, kto może przeglądać zadania, i działają tak samo
  dla listy i tablicy. Zmienić albo usunąć widok może tylko osoba, która go
  zapisała, albo administrator platformy. Widok, który wskazuje status,
  priorytet, etykietę albo osobę, której już nie ma, nadal się otwiera — pomija
  tę wartość i mówi o tym.

**Moje zadania** (`/tasks/mine`) to twoja otwarta praca: opublikowane zadania
przypisane do ciebie, które nie są zamknięte, najpierw te z najbliższym
terminem, na końcu te bez terminu, jako lista albo tablica, z tymi samymi
filtrami. Twoich szkiców tu nie ma — znajdziesz je filtrem *Tylko moje
szkice* na ekranie **Zadania**. Pole **Dzienne podsumowanie** u góry włącza
i wyłącza twoje podsumowanie oraz ustawia jego godzinę.

**Nowe zadanie** (`/tasks/new`) wymaga tytułu, a opcjonalnie opisu, osób
przypisanych — wybieranych po nazwisku spośród aktywnych administratorów, którzy
mogą przeglądać zadania, albo przyciskiem *Przypisz do mnie* — terminu
z godziną, daty rozpoczęcia, priorytetu i etykiet. *Utwórz zadanie* publikuje
je; *Zapisz jako szkic* zostawia je tylko dla ciebie. *Prywatne*
ogranicza osoby przypisane do ciebie. Zadanie utworzone tutaj nie należy do
żadnego rekordu: zadanie projektu dodaje się w zakładce *Zadania* projektu, do
jednego z jego etapów. Rozpoczęte z panelu *Zadania* rekordu jest z tym
rekordem powiązane; rozpoczęte przyciskiem *Dodaj podzadanie* zadania jest jego
podzadaniem.

**Ekran zadania** pokazuje jego numer i tytuł, status — z propozycją tylko tych
przejść, na które pozwala przebieg — oraz *Szkic* albo *Prywatne*, gdy
zadanie nim jest. Szkic pokazuje swojemu autorowi *Opublikuj*; autor
zadania bez rekordu może włączać i wyłączać *Prywatne*. Dalej:

- **Szczegóły** — opis z odwołaniami jako odnośnikami; osoby przypisane, termin
  z godziną, data rozpoczęcia, priorytet i etykiety, zmieniane przyciskiem
  *Edytuj* i zapisywane razem; *Przypisz do mnie*; kto i kiedy utworzył
  zadanie oraz kiedy zostało zakończone. *Usuń zadanie* pyta przed usunięciem
  i podaje, ile zadanie ma podzadań: stają się one zadaniami głównymi, nie są
  usuwane. Przycisk nie jest dostępny dla zadania rekordu, którego nie możesz
  zmieniać — projektu, którego nie możesz edytować — a ekran wyjaśnia dlaczego.
- **Podzadania** — ile jest zrobionych z ilu, każde ze statusem, osobami
  przypisanymi i terminem; *Dodaj podzadanie* i *Ustaw jako podzadanie…*.
  Podzadanie wskazuje swoje zadanie nadrzędne, z przyciskiem *Odłącz od
  zadania nadrzędnego*.
- **Komentarze**, **Załączniki** i **Historia**.
- Obok: **Przypomnienia**, **Należy do** — rekord, do którego należy zadanie,
  tak jak nazywa go jego moduł, z *Umieść w rekordzie*, *Przenieś* i *Usuń
  z rekordu* — **Powiązane rekordy**, **Powiązane zadania** i **pola
  niestandardowe** zadania.

Inne moduły mogą dodawać panele na końcu ekranu zadania. Bez uprawnienia do
zmieniania zadań ekran jest tylko do odczytu.

**Na innych rekordach.** Ekrany **szansy sprzedażowej**, **zamówienia**
i **zapytania ofertowego** kończą się panelem **Zadania**: powiązanymi z nim
zadaniami, które możesz zobaczyć, z ich statusem, osobami przypisanymi
i terminem, przyciskiem *Dodaj zadanie* — nowe zadanie od razu powiązane
z rekordem — oraz *Pokaż na liście zadań*.

**Paleta poleceń** (⌘K / CTRL+K) proponuje *Zadania*, *Moje zadania*, *Nowe
zadanie*, *Statusy i przejścia zadań*, *Priorytety zadań* i *Etykiety zadań*,
każde administratorom z uprawnieniem, którego wymaga jego ekran.
**Wyszukiwanie globalne** panelu znajduje zadanie po numerze lub tytule — tylko
wśród zadań, które możesz zobaczyć.

## Praca z zadaniami

**Tworzenie zadania.** Zadanie potrzebuje tylko tytułu. Dostaje numer, zaczyna
się w statusie początkowym przebiegu i zapamiętuje, kto je utworzył. Można je
umieścić w rekordzie innego modułu — w tym wydaniu w etapie projektu, który
autor może zobaczyć i edytować; zadanie projektu zawsze należy do jednego z jego
etapów. Zadania prywatnego nie można umieścić w rekordzie.

**Opis** to tekst sformatowany — pogrubienie, kursywa, przekreślenie,
odnośniki, listy wypunktowane i numerowane — pisany tym samym edytorem co
w szansach sprzedażowych i projektach. Podczas pisania może **odwoływać się**
do rzeczy: `@` do osoby, `@@` do dokumentu — zamówienia, zapytania ofertowego,
zadania, szansy sprzedażowej albo projektu, w jednej pogrupowanej liście —
i `@@@` do produktu. Każda grupa jest proponowana tylko wtedy, gdy jej moduł
jest włączony, i tylko komuś, kto może czytać ten rodzaj rekordu. Odwołanie
jest pokazywane jako odnośnik z aktualnym numerem albo nazwą tego, do czego się
odwołuje, temu, kto może to zobaczyć; każdemu innemu, gdy cel zniknął albo gdy
jego moduł jest wyłączony — jako niedostępne, bez ujawniania czegokolwiek
o celu. Opis napisany, zanim pojawiło się formatowanie, czyta się tak jak
wcześniej.

**Osoby przypisane.** Zadanie ma dowolną liczbę osób przypisanych, do
dwudziestu — każda to aktywny administrator, który może przeglądać zadania,
a przy zadaniu rekordu, na przykład projektu, może też zobaczyć ten rekord.
Przypisanie kogokolwiek innego jest odrzucane z podaniem tej osoby, a wybór
osób przypisanych — na ekranie zadania i w formularzu nowego zadania
rozpoczętym w rekordzie — proponuje tylko te, które mogą. Przeniesienie zadania
do innego rekordu wymaga tego samego od osób, które przy nim zostają. Osoba,
która po przypisaniu straci dostęp do projektu, zostaje przy zadaniu, ale nie
dostaje o nim powiadomienia i nie znajduje go w *Moich zadaniach*. Osoba przypisana,
której konto zostanie później dezaktywowane, zostaje przy zadaniu z oznaczeniem
*nieaktywny*; nikt nie jest o niczym powiadamiany w jej imieniu i można ją
usunąć.

**Powiadomienia.** W dzwonku powiadomień panelu, tylko numerem zadania — nigdy
jego treścią — z odnośnikiem do zadania:

- nowa osoba przypisana, gdy zadanie zostanie utworzone albo później do niej
  przypisane, chyba że przypisała je sobie sama;
- osoba **nowo wspomniana** w opisie albo w komentarzu, jeden raz;
- przy nowym **komentarzu** osoby przypisane do zadania i jego autor, z
  wyjątkiem autora komentarza — a ktoś, kto jest w nim wspomniany i zarazem
  przypisany, dostaje jedno powiadomienie.

Nikt nie dostaje powiadomienia o zadaniu, którego nie może zobaczyć, o szkicu
ani o własnym działaniu. Gdy moduł *Admin notifications* jest
wyłączony, wszystko działa tak samo, a nikt nie dostaje powiadomień.

Każdy administrator ma dzwonek i czyta w nim własne powiadomienia, niezależnie
od roli: nie potrzebuje do tego żadnego uprawnienia. Uprawnienie *Podgląd
powiadomień wysyłanych do wszystkich administratorów* dodaje jedynie
powiadomienia kierowane jednocześnie do wszystkich administratorów.

**Zmiana statusu.** Zadanie przechodzi tylko przejściem, na które pozwala
przebieg; każde inne jest odrzucane z podaniem statusów, do których może
przejść. Pole statusu i tablica proponują tylko dozwolone. Zamknięcie zadania,
którego podzadania są wciąż otwarte, jest dozwolone: dowiadujesz się, ile jest
jeszcze otwartych, a one nie są zamykane.

**Priorytet i etykiety.** Zadanie ma najwyżej jeden priorytet z listy operatora
— *Pilny*, *Wysoki*, *Normalny* i *Niski*, dopóki operator jej nie zmieni —
i do pięćdziesięciu etykiet. Każdy, kto może zmieniać zadania, wybiera spośród
istniejących etykiet; nową tworzy tylko ktoś, kto konfiguruje zadania.

**Pola niestandardowe.** Pola niestandardowe, które operator określi dla
**zadań** na ekranie *Pola niestandardowe*, są pokazywane i zapisywane na
zadaniu tak jak na szansie sprzedażowej, mogą filtrować listę i tablicę, gdy są
oznaczone jako filtry listy, i mogą być pokazywane na karcie tablicy.

**Załączniki.** Do zadania można dołączyć plik do 25 MB — przesłany albo
wybrany z biblioteki multimediów przez kogoś, kto może ją czytać. Pliki HTML,
SVG, XML i JavaScript są odrzucane. Każdy załącznik pokazuje nazwę, rozmiar,
kto go dołączył i kiedy; może go pobrać każdy, kto widzi zadanie, a odłączyć —
ktoś, kto może je zmieniać. Plik zostaje w bibliotece multimediów, a biblioteka
odmawia usunięcia pliku używanego przez zadanie — także gdy moduł Zadania jest
wyłączony. W bibliotece multimediów plik używany tylko przez zadania, których
ktoś nie może zobaczyć — prywatne, szkice albo należące do rekordu przed nim
ukrytego — jest ukryty także przed nim, a kto nie widzi zadania, nie dołączy
jego pliku gdzie indziej.

**Komentarze.** Każdy, kto widzi zadanie, może je komentować tym samym
edytorem i z tymi samymi odwołaniami co w opisie. Komentarze są wymienione od
najstarszego, z autorem i czasem. Komentarz edytuje albo usuwa tylko jego
autor; usunięty komentarz zostawia znak, że został usunięty, a historia
zachowuje informację, że go napisano.

**Podzadania i powiązane zadania.** Zadanie ma najwyżej jedno zadanie
nadrzędne. Zadanie nie może stać się podzadaniem samego siebie ani jednego
ze swoich podzadań, a zagnieżdżenie głębsze niż pięć poziomów jest odrzucane.
Zadanie nadrzędne pokazuje, ile jego podzadań jest zrobionych z ilu — na
liście, na swojej karcie na tablicy i na swoim ekranie — licząc tylko
podzadania, które możesz zobaczyć. Usunięcie zadania nadrzędnego zmienia jego
podzadania w zadania główne. Dwa zadania można powiązać jako **powiązane**:
powiązanie jest widoczne na obu i można je usunąć z każdego z nich; wymaga
uprawnienia do zmieniania obu.

**Powiązane rekordy.** Zadanie można powiązać z maksymalnie dwudziestoma
szansami sprzedażowymi, zamówieniami i zapytaniami ofertowymi — każdy przez
kogoś, kto może go czytać — niezależnie od jednego rekordu, do którego może
należeć. Ponowne powiązanie tego samego rekordu zostawia jedno powiązanie.
Powiązany rekord, którego nie możesz zobaczyć, który zniknął albo którego moduł
jest wyłączony, jest pokazywany jako *Niedostępny rekord*; powiązanie zostaje
i znów pokazuje rekord, gdy jego moduł wróci.

**Przypomnienia.** Ktoś, kto może zmieniać zadanie, może dodać do niego do
dziesięciu przypomnień, każde **o określonej dacie i godzinie** albo **przed
terminem** — 15 minut, godzinę, dzień, dwa dni albo tydzień przed — dla siebie
i dowolnych osób przypisanych do zadania. W tej chwili każdy odbiorca dostaje
jedno powiadomienie w dzwonku i jeden e-mail z nazwą zadania i odnośnikiem.
Przypomnienie przed terminem przesuwa się razem z terminem i jest wysyłane
ponownie w nowej chwili; gdy termin zostanie usunięty, przypomnienie też jest
usuwane, a historia zadania o tym mówi. Nic nie jest wysyłane odbiorcy, który
nie może już zobaczyć zadania albo którego konto dezaktywowano, ani w sprawie
zadania zamkniętego, usuniętego albo będącego szkicem. Jeśli platforma
nie działała w tej chwili, przypomnienie jest wysyłane raz po jej powrocie —
jeśli od tej chwili minęło mniej niż 24 godziny; starsze nie jest wysyłane.
Widzisz przypomnienia, które ustawiłeś, i te, które cię wymieniają; *Wysłane*
oznacza takie, które już wyszło. Przypomnienie może usunąć ten, kto je ustawił,
albo ktoś, kto może zmieniać zadanie.

**Dzienne podsumowanie.** Włącz je w *Moich zadaniach* i wybierz godzinę: każdego
dnia o tej godzinie w strefie czasowej zadań dostajesz jedno powiadomienie
i jeden e-mail z listą swoich otwartych zadań z terminem na ten dzień oraz tych
po terminie. W dniu bez takich zadań nic nie jest wysyłane; zadanie, którego
termin przypada później tego samego dnia, trafia do podsumowania następnego
dnia. Podsumowanie jest wyłączone, dopóki go nie włączysz.

**Szkice i zadania prywatne.** *Zapisz jako szkic* zostawia
nowe zadanie tylko dla ciebie: nikt nie dostaje o nim powiadomienia, żadne jego
przypomnienie nie jest wysyłane i nikt inny go nigdzie nie znajdzie — nawet
posiadacz *See private tasks*. *Opublikuj* zmienia je w zwykłe zadanie, a osoby
przypisane i osoby wspomniane w opisie dostają powiadomienie jak o nowym
zadaniu. Zadanie prywatne jest oznaczone *Prywatne*; posiadacz *See private
tasks* może czytać i usuwać cudze zadanie prywatne, ale niczego w nim nie
zmienia.

**Usunięcie zadania** usuwa je na stałe; jego podzadania stają się zadaniami
głównymi.

Dodanie zadania do rekordu, wyjęcie go z rekordu — bez rekordu albo do innego —
i usunięcie zadania rekordu to zmiany w pracy tego rekordu, więc decyduje o nich
moduł rekordu: w przypadku projektu ktoś, kto może edytować projekt.
Przeniesienie zadania między etapami jednego projektu i każda inna zmiana
zadania wymaga tylko uprawnienia do zmieniania zadań.

**Historia.** Każda zmiana zadania — jego pól, osób przypisanych, statusu,
priorytetu, etykiet, zadania nadrzędnego, powiązań, załączników, przypomnień,
edytowanych lub usuniętych komentarzy, publikacji i prywatności — jest
zapisywana z informacją, kto i kiedy jej dokonał, a historia zadania wymienia
je od najnowszej. Historia zapisuje długość opisu, nigdy jego treść. Projekt,
który zadanie opuściło, a którego nie możesz zobaczyć, nie jest w niej
wymieniony.

Wartości, które pokazuje historia — tytuł zadania, jego notatka z rekordu, dla
którego zostało utworzone, wartości pól niestandardowych i nazwa pliku
załącznika — są przechowywane przy zadaniu i pokazywane tylko temu, kto może je
zobaczyć. Dziennik audytu całej platformy, który czyta każdy z
`audit_log:read` bez względu na to, co widzi, mówi, co się zmieniło
(`changedFields`, `changedCustomFields`), i nie zawiera żadnej z tych wartości.
Wpisy zapisane przed tą zmianą zachowują swoje wartości i są pokazywane tak, jak
zostały zapisane.

Wartości pól niestandardowych — i to, których pól niestandardowych dotyczyła
zmiana — historia pokazuje tylko temu, kto ma także `custom_fields:read`, tak
jak przy szansach sprzedażowych i projektach; dla każdego innego są pomijane w
każdym wpisie.

## Konfiguracja zadań

Posiadacze *Configure tasks* docierają do tych ekranów z **Ustawień zadań**
w menu bocznym i z palety poleceń; każdy z nich prowadzi do pozostałych.

**Statusy i przebieg** (`/tasks/settings/workflow`). Dodawaj, zmieniaj nazwy —
po angielsku i po polsku — kolory i kolejność statusów, usuwaj je; oznaczaj
status początkowy; dodawaj i usuwaj przejścia na grafie przebiegu, tym samym
edytorze co w zamówieniach i szansach sprzedażowych. Przebieg jest odrzucany,
chyba że dokładnie jeden status jest początkowy i otwarty, co najmniej jeden
jest zakończony i co najmniej jeden anulowany. Status, w którym są zadania, nie
może zmienić kategorii i jest usuwany dopiero po wybraniu statusu, do którego
przechodzą jego zadania — każde przejście trafia do historii zadania. Na tym
samym ekranie **Karta na tablicy** określa, które pola pokazuje karta i w jakiej
kolejności — najwyżej sześć spośród: numeru, osób przypisanych, terminu,
priorytetu, etykiet, daty rozpoczęcia, rekordu, do którego zadanie należy,
zrobionych podzadań, chwili utworzenia, ostatniej zmiany i dowolnego pola
niestandardowego zadań.

**Priorytety** (`/tasks/settings/priorities`). Dodawaj, zmieniaj nazwy — po
angielsku i po polsku — kolory i kolejność priorytetów; sortowanie po
priorytecie stosuje tę kolejność, od najpilniejszego, a zadania bez priorytetu
są na końcu. Usunięcie priorytetu, który mają zadania, wymaga wybrania, jaki
priorytet — albo żaden — dostaną zamiast niego, i zapisuje to w historii
każdego zadania.

**Etykiety** (`/tasks/settings/tags`). Dodawaj, zmieniaj nazwy i kolory
etykiet, usuwaj je. Nazwy są unikalne bez względu na wielkość liter, do 64
znaków. Usunięcie etykiety wymaga potwierdzenia i zdejmuje ją ze wszystkich
zadań, które ją mają; usunięcie jest zapisywane raz, na etykiecie, z liczbą
zadań, które ją miały.

**Ustawienia ogólne** (`/tasks/settings/general`). **Strefa czasowa**, w której
moduł Zadania liczy „dziś”: kiedy zadanie z samą datą terminu staje się
zadaniem po terminie, kiedy jest wysyłane przypomnienie przed taką datą oraz
o której godzinie przychodzi dzienne podsumowanie.

## Ustawienia

| Kod | Domyślnie | Znaczenie |
| --- | --- | --- |
| `tasks.enabled` | włączone | Czy moduł jest włączony — zmienia się to na ekranie **Moduły**. |
| `tasks.time_zone` | `Europe/Warsaw` | Strefa czasowa IANA, w której moduł Zadania liczy daty. Zmienia się ją w **Ustawieniach zadań → Ustawienia ogólne**. |
| `tasks.board_card_fields` | numer, osoby przypisane, termin, priorytet, etykiety | Pola pokazywane na karcie tablicy, w kolejności. Zmienia się je w sekcji **Karta na tablicy** **Ustawień zadań**, która proponuje istniejące pola. |

## Włączanie i wyłączanie

Zadania to moduł opcjonalny. Domyślnie jest włączony, a operator wyłącza go —
i włącza z powrotem — na ekranie **Moduły** panelu administracyjnego
(`/platform/modules`).

Gdy jest wyłączony:

- z panelu znikają pozycje *Moje zadania*, *Zadania* i *Ustawienia zadań*
  oraz każdy ekran zadania, a także zakładka *Zadania* projektu i jego zadania
  etapów, panele *Zadania* szans sprzedażowych, zamówień i zapytań ofertowych,
  akcje palety poleceń i zadania w wyszukiwaniu globalnym;
- każdy endpoint `/api/v1/admin/tasks…` odpowiada `503` z kodem
  `MODULE_DISABLED`, a jego ustawień nie można zmienić;
- żadne przypomnienie ani podsumowanie nie jest wysyłane i nic się nie
  gromadzi: po powrocie modułu przypomnienie, którego chwila minęła mniej niż
  24 godziny wcześniej, jest wysyłane raz, starsze nigdy, a wychodzi tylko
  podsumowanie z bieżącego dnia;
- jego uprawnień nie można już nadać roli;
- inne moduły nie mogą ani czytać, ani tworzyć zadań: moduł, który pokazuje
  zadania na własnych ekranach, pokazuje je jako niedostępne, a zadanie
  wspomniane w ich tekstach jest pokazywane jako niedostępne.

Nic nie jest usuwane. Każde zadanie zostaje w bazie danych, a po ponownym
włączeniu modułu wszystko wraca dokładnie do stanu sprzed wyłączenia.
Jedynym wyjątkiem, który jest nadrabiany, jest projekt — albo etap — usunięty
przy wyłączonym module Zadania: w ciągu piętnastu minut od jego ponownego
włączenia zadania usuniętego projektu są usuwane, a zadania usuniętego etapu
zostają w swoim projekcie bez etapu — każda zmiana trafia do dziennika zmian.

## Uprawnienia

| Kod | Na co pozwala |
| --- | --- |
| `tasks:read` | Przeglądanie zadań — listy, tablicy, *Moich zadań*, pojedynczego zadania, jego komentarzy, załączników i historii — z uwzględnieniem kontekstu każdego zadania, szkiców i zadań prywatnych; komentowanie widocznych zadań; zapisane widoki i własne dzienne podsumowanie. |
| `tasks:write` | Tworzenie, zmienianie, przypisywanie, wiązanie, ustawianie przypomnień i usuwanie zadań. Wymaga `tasks:read`. |
| `tasks:configure` | Konfigurowanie przebiegu, priorytetów, etykiet, karty na tablicy i strefy czasowej. Wymaga `tasks:read`. |
| `tasks:see_private` | Widzenie cudzych zadań prywatnych — tylko odczyt i usuwanie, nigdy zmiana, i nigdy cudze szkice. Wymaga `tasks:read`. |

## Aktualizacja z pierwszej wersji

- **Statusy można teraz konfigurować.** Cztery dotychczasowe statusy stają się
  domyślnym przebiegiem, z dozwolonym każdym przejściem między nimi, więc
  wszystko działa jak wcześniej, dopóki operator tego nie zmieni, a każde
  zadanie zachowuje swój status. Blokada zakończenia projektu traktuje każdy
  status zakończony i anulowany jako zamknięty.
- **Dotychczasowe osoby przypisane zostają** jako pierwsza osoba przypisana
  każdego zadania. Każde zadanie jest opublikowane i nie ma priorytetu,
  etykiet, daty rozpoczęcia ani godziny terminu.
- **Dla integracji:** pole `assignedAdminUserId` zadania zostało zastąpione
  przez `assigneeIds` (`assignees` w odpowiedziach API), status to kod
  z kategorią, `PATCH /api/v1/admin/tasks/:id` nie przyjmuje już `status`
  (służy do tego `POST …/:id/status`), `DELETE …/:id` odpowiada `200`
  z `{ data: { subtasksDetached } }` zamiast `204`, a zdarzenie
  `tasks.task.assigned.v1` zostało zastąpione przez
  `tasks.task.assignees_changed.v1` (zob. *Zdarzenia*).

## Dla programistów

### API

Każda trasa jest pod `/api/v1/admin/tasks`; kształty żądań i odpowiedzi to
schematy Zod z `@endora-commerce/contracts` (`tasks.ts`). Zadanie, którego
pytający nie może zobaczyć — przez jego kontekst, cudzy szkic albo
zadanie prywatne bez `tasks:see_private` — daje `404` `TASK_NOT_FOUND`,
dokładnie tak jak zadanie, które nie istnieje.

| Metoda i ścieżka | Uprawnienie | Odpowiedź |
| --- | --- | --- |
| `GET /` | `tasks:read` | `{ items, nextCursor, prevCursor? }`. Filtry: `status`, `statusCategory`, `assignee` (`me`, `none` albo identyfikator; dowolny z nich), `creator` (`me` albo identyfikator), `priority` (kody albo `none`), `tagId` (każda), `dueFrom`, `dueTo`, `overdue`, `linkedKind` z `linkedId`, `parentId`, `isSubtask`, `hasSubtasks`, `draft` (własne pytającego), `private`, `customFieldFilters`, `q`; `sort` (`created`, `number`, `title`, `due`, `priority`, `status`, `updated`) i `dir`; `cursor`, `limit` (najwyżej 100). Nieznany status, priorytet albo etykieta nie pasuje do niczego. |
| `GET /mine` | `tasks:read` | `{ data }` — otwarte, opublikowane zadania pytającego, według terminu, bez terminu na końcu (najwyżej 500); te same filtry. |
| `GET /board` | `tasks:read` | `{ data: { columns: [{ status, count, items, hasMore }] } }`, jedna kolumna na status w kolejności przebiegu; filtry listy i `perColumn` (najwyżej 50, domyślnie 25). |
| `POST /` | `tasks:write` | `{ title, description?, assigneeIds?, dueOn? \| dueAt?, startOn?, priorityCode?, tagIds?, customFieldValues?, context?, parentTaskId?, links?, draft?, private? }` → `201` `{ data: TaskDetail }`. |
| `GET /:id` | `tasks:read` | `{ data: TaskDetail }` — z `references`, `links`, `subtaskItems`, `relatedTasks`, przypomnieniami pytającego (`reminders`) i `permissions { canChange, canDelete, canPublish }`. |
| `PATCH /:id` | `tasks:write` | Dowolne pole treści tworzenia poza `draft`; `assigneeIds` zastępuje, `addAssigneeIds` / `removeAssigneeIds` dodają i usuwają; `parentTaskId: null` odłącza; `private` tylko autor. |
| `POST /:id/status` | `tasks:write` | `{ to, from }` → `{ data: { task, openSubtasks } }`; `409` `TASK_TRANSITION_FORBIDDEN` (`details.allowedTargets`), `409` `TASK_TRANSITION_CONFLICT`, gdy zadanie w międzyczasie opuściło `from`, `422` `TASK_STATUS_UNKNOWN`. |
| `POST /:id/publish` | `tasks:write` | Szkic autora staje się zadaniem; `409` `TASK_ALREADY_PUBLISHED`. Cudzy szkic daje `404`. |
| `DELETE /:id` | `tasks:write` albo `tasks:read` z `tasks:see_private` dla zadania prywatnego | `200` `{ data: { subtasksDetached } }` — dawne podzadania, które pytający może zobaczyć. |
| `GET /:id/history` | `tasks:read` | Ślad audytowy zadania, od najnowszego (`RecordHistoryPage`). |
| `GET`, `POST /:id/comments`; `PATCH`, `DELETE /:id/comments/:commentId` | `tasks:read` | Komentarze od najstarszego, z rozwiązanymi odwołaniami; cudzy komentarz daje `403` `FORBIDDEN`. |
| `GET`, `POST /:id/attachments`; `POST /:id/attachments/upload`; `DELETE /:id/attachments/:attachmentId` | `tasks:read` do listy, `tasks:write` do zmian | `{ assetId }` dołącza plik z biblioteki (z uprawnieniem biblioteki do odczytu); `upload` przyjmuje plik multipart; `413` / `415` `TASK_ATTACHMENT_REFUSED`. |
| `PUT`, `DELETE /:id/relations/:otherId` | `tasks:write` dla obu | `204`, idempotentne w obie strony. |
| `POST /:id/links`; `DELETE /:id/links/:linkId` | `tasks:write` | `{ kind, id }` → `201` nowe powiązanie, `200` istniejące; `422` `TASK_LINK_INVALID`. |
| `GET`, `POST /:id/reminders`; `DELETE /:id/reminders/:reminderId` | `tasks:read` do listy, `tasks:write` do dodania | `{ remindAt }` albo `{ offsetMinutes }` oraz `recipientIds`; `422` `TASK_REMINDER_INVALID`. Usuwa je jego autor albo posiadacz `tasks:write`. |
| `GET /lookups/assignees`, `/lookups/mentionable`, `/lookups/documents`, `/lookups/records`, `/lookups/contexts` | `tasks:write` (`mentionable`: `tasks:read`) | Listy wyboru: osoby przypisane, osoby do wspomnienia, lista dokumentów pod `@@` (grupy `order`, `quote_request`, `task`, `opportunity`, `project`, każda dla jej czytelników, gdy jej moduł jest włączony), cele powiązań oraz projekty z etapami. |
| `GET /custom-field-filters` | `tasks:read` | Pola niestandardowe zadań, których można użyć jako filtrów listy. |
| `GET /workflow`; `POST /statuses`; `PATCH`, `DELETE /statuses/:code`; `PUT /transitions` | `tasks:read` do odczytu, `tasks:configure` do zmian | Każdy zapis zwraca cały przebieg; `422` `TASK_WORKFLOW_INVALID` (`details.rule`); usunięcie używanego statusu wymaga `?replacement=`; `409` `TASK_STATUS_IN_USE_TOO_MANY` powyżej 5000 zadań. |
| `GET`, `POST /priorities`; `PATCH`, `DELETE /priorities/:code` | `tasks:read` do odczytu, `tasks:configure` do zmian | Jak statusy; `replacement` może być `none`. |
| `GET`, `POST /tags`; `PATCH`, `DELETE /tags/:id` | `tasks:read` do odczytu, `tasks:configure` do zmian | `409` `TASK_TAG_NAME_TAKEN`. |
| `GET`, `PUT /board/card-fields`; `GET`, `PUT /settings/time-zone` | `tasks:read` do odczytu, `tasks:configure` do zmian | Zapisywane własnym audytowanym zapisem modułu Ustawienia. |
| `GET`, `POST /list-views`; `PATCH`, `DELETE /list-views/:id` | `tasks:read` | Zapisane widoki; `409` `TASK_VIEW_NAME_TAKEN`. |
| `GET`, `PUT`, `DELETE /me/digest` | `tasks:read` | Podsumowanie pytającego: `{ hour }` albo `null`, gdy jest wyłączone. |

Każdy zapis odrzuca też `403` `TASK_PRIVATE_READ_ONLY` posiadacza
`tasks:see_private` pracującego na cudzym zadaniu prywatnym, `422`
`TASK_PRIVATE_ASSIGNEE` dla każdego poza autorem w zadaniu prywatnym, `422`
`TASK_PARENT_CYCLE` i `TASK_HIERARCHY_TOO_DEEP` dla hierarchii oraz `422`
`TASK_PRIORITY_UNKNOWN` / `TASK_TAG_UNKNOWN` dla priorytetu albo etykiety,
których nie ma. Wybór listy albo tablicy to preferencja administratora
`listViewModes` (`tasks`, `tasks-mine`), obsługiwana przez moduł Admin users.

`context` zapisywany przez API musi należeć do włączonego modułu, który
wymienia rekord jako widoczny dla ciebie, i — gdy rekord ma grupy, jak etapy
projektu — wskazywać jedną z nich; w przeciwnym razie `422`
`TASK_CONTEXT_INVALID`. `context` zadania jest odczytywany jako `{ type, id,
groupId, available, label, href, groupLabel }`. Gdy moduł będący właścicielem
nie opisuje już rekordu, `available` ma wartość `false`, `label` brzmi
*Niedostępny rekord* w twoim języku, a `href` i `groupLabel` mają wartość
`null`.

### Konteksty zadań

Moduł Zadania nie wymienia żadnego innego modułu. Moduł, który chce mieć
własne zadania, rejestruje **kontekst zadania** — typ kontekstu, którego jest
właścicielem, np. `project` — i od tej chwili zadania mogą mieć ten typ,
identyfikator jednego z jego rekordów oraz, opcjonalnie, identyfikator grupy
w rekordzie (etapu projektu).

Rejestr to wpis kontenera `taskContextRegistry` (`TaskContextRegistryPort`).
Jest rejestrowany bez bramki, więc wpisuj do niego z **hooka startowego
służącego tylko do wkładu, bez sprawdzania obecności**, a krawędź zadeklaruj
w `nonBindingDependencies` swojego manifestu jako `contributes-to`:

```ts
ctx.onBoot(() => {
  lazyPort<TaskContextRegistryPort>(ctx, 'taskContextRegistry').register({
    contextType: 'project',
    ownerModuleId: 'projects',
    allVisibleContextIds: () => /* every record id the caller may see */,
    visibleContextIds: (ids) => /* which of these ids the caller may see */,
    describe: (ids) => /* id → { label, href, groups: groupId → label } */,
    canSeeAs: (adminUserId, id) => /* may that administrator see this record? */,
    canChangeTasks: (id) => /* may the caller add, take out or delete a task of this record? */,
    existingContexts: (ids) => /* id → the group ids it has now, for each id that still exists */,
  });
});
```

Kontrakt, którego deskryptor przestrzega:

- **Każda metoda poza `existingContexts` działa w kontekście tenanta
  pytającego.** Odpowiadaj za pytającego, dokładnie tak jak twoje własne
  ekrany.
- `allVisibleContextIds()` to wstępny filtr listy: lista i tablica zadań pytają
  o niego raz na żądanie i zawężają zapytanie do tych identyfikatorów, więc
  strony pozostają dokładne. Niech będzie tani.
- `visibleContextIds(ids)` odpowiada dla pojedynczego zadania albo kilku.
- `describe(ids)` określa, jak zadanie pokazuje swój kontekst: etykietę, adres
  w panelu i etykiety grup rekordu.
- `canSeeAs(adminUserId, id)` to jedyna metoda, która odpowiada za **kogoś
  innego**: czy ten administrator, według własnych uprawnień i zasięgu, może
  zobaczyć rekord. Jest pytana, zanim ktokolwiek dostanie powiadomienie
  o zadaniu rekordu — osoba przypisana, wspomniana, przy komentarzu,
  przypomnieniu, podsumowaniu; `false` — albo wyłączony właściciel — oznacza,
  że nikt nie dostaje powiadomienia.
- `canChangeTasks(id)` decyduje, czy pytający może zmienić, jakie zadania ma
  rekord: wstawić zadanie **do** niego (utworzyć je tam albo przenieść tam),
  wyjąć jedno **z** niego (odłączyć je przez `context: null` albo przenieść do
  innego rekordu) albo **usunąć** jedno z jego zadań. Przeniesienie zadania
  między grupami tego samego rekordu i edycja zadania na miejscu nie są
  sprawdzane. Projekty odpowiadają „tak” posiadaczowi `projects:write`, który
  widzi projekt; `false` odrzuca wstawianie i wyjmowanie z `422`
  `TASK_CONTEXT_INVALID`, a usuwanie z `403` `FORBIDDEN`.
- `renderNote(note, language)`, opcjonalna, formułuje w języku czytającego
  notatkę, którą twój moduł zostawił na zadaniu przy jego tworzeniu
  (`contextNote` z `taskWritePort.createMany`). Zapisuj klucz, a nie zdanie —
  Projekty zapisują rolę odpowiedzialną — a zdanie zwracaj tutaj; bez tej
  metody notatka jest pokazywana tak, jak ją zapisano.
- `existingContexts(ids)`, opcjonalna, odpowiada, **które z tych rekordów wciąż
  istnieją i jakie grupy mają teraz** — mapą z każdego istniejącego
  identyfikatora na zbiór identyfikatorów jego grup. Jest pytana **wyłącznie
  w imieniu aktora systemowego**, przez opisany niżej przebieg porządkujący,
  i musi odpowiadać bez względu na to, kto może widzieć rekordy.
  **Identyfikator, którego brak w odpowiedzi, powoduje usunięcie zadań tego
  rekordu**, więc identyfikator, za który twój moduł nie może ręczyć — którego
  nie może odczytać albo którego nie rozpoznaje — musi zostać zwrócony jako
  istniejący. Grupa, której brak w zbiorze istniejącego rekordu, wyjmuje
  z niej zadania rekordu. Moduł bez tej metody nigdy nie jest porządkowany.
- Jeden typ kontekstu ma jednego właściciela; zarejestrowanie drugiego, innego
  deskryptora dla zajętego już typu zatrzymuje backend przy starcie.
- **Zasada odmawia w razie wątpliwości.** Zadanie, którego typu kontekstu nikt
  nie zarejestrował albo którego właściciel jest wyłączony, jest ukryte na
  listach, tablicach, w liczbach i pod identyfikatorem, a wraca, gdy
  właściciel wróci. System — zadanie w tle bez administratora za nim — nigdy
  nie jest zawężany.

**Przebieg porządkujący.** Właściciel kontekstu usuwa zadania usuwanego rekordu
przez `taskWritePort.deleteInContext` — ale tylko wtedy, gdy moduł Zadania jest
włączony. To, co usunięto przy wyłączonym module, znajduje trzeci przebieg
workera `tasks-reminders`, uruchamiany najwyżej co **piętnaście minut**: dla
każdego **obecnego** właściciela implementującego `existingContexts` czyta
różne konteksty, które wskazują jego zadania, po 500 naraz, i pyta o nie
właściciela. Każde zadanie rekordu, który zniknął, jest usuwane poleceniem
usuwania modułu (`deleteTaskCommand(id, auditLog, { reason, onlyIn })` —
ponownie odczytane pod blokadą, pozostawione, jeśli w międzyczasie zostało
przeniesione, z odłączeniem podzadań) z powodem `context_gone` we wpisie
audytu; każde zadanie istniejącego rekordu, którego grupa zniknęła, traci grupę
— wpis audytu `tasks.task.update` z powodem `context_group_gone`. Jedno
polecenie na zadanie, każde z własnym wpisem audytu. Wyłączony właściciel nie
jest pytany, więc nic z jego rekordów nie jest uznawane za usunięte; przebieg
bez pracy nie wchodzi w zakres systemowy.

### Odczyt i zapis zadań z innego modułu

Dwa porty, oba za bramką — rozwiązanie któregokolwiek przy wyłączonym module
Zadania rzuca wyjątek, a wywołanie odpowiada `503` `MODULE_DISABLED`.
Rozwiązuj je przez `lazyPort` i deklaruj jako `degrades-without` ze zdaniem
`whenAbsent`.

| Port | Metody |
| --- | --- |
| `taskReadPort` (`TaskReadPort`) | `findById`, `findByIds`, `search` (numer albo tytuł), `listInContext`, `listOpenInContext` (kategoria otwarta i nie szkic — pytanie blokady zakończenia), `countInContext`. `TaskRecord` ma `status` (kod), `statusCategory`, `closed`, `assigneeIds`, `dueAt`, `draft` i `private`. Zawężane pełną regułą widoczności dla administratora — kontekst, szkice, zadania prywatne — ale nie dla systemu. |
| `taskWritePort` (`TaskWritePort`) | `createMany({ context, tasks })` — najwyżej 100 zadań, każde `{ title, description?, assigneeIds?, dueOn?, contextGroupId?, contextNote?, sourceKey? }`, opublikowane, w statusie początkowym przebiegu; jedno audytowane polecenie `tasks.task.create` i jedno zdarzenie `tasks.task.created.v1` na każde utworzone zadanie; odrzucane z `TASK_CONTEXT_INVALID`, gdy żaden włączony moduł nie jest właścicielem typu kontekstu, i z `TASK_ASSIGNEE_INVALID`, gdy osoba przypisana nie jest aktywnym administratorem — zanim cokolwiek zostanie zapisane. Czy osoba przypisana może zobaczyć rekord, rozstrzyga moduł, do którego rekord należy — projekt przypisuje każde zadanie etapu członkowi z jego rolą — więc port o to nie pyta, w przeciwieństwie do ekranów i API zadań. `deleteInContext({ contextType, contextId })` — wszystkie zadania jednego rekordu, każde przez osobne audytowane polecenie `tasks.task.delete`. |

**`sourceKey` czyni tworzenie idempotentnym.** Zadanie z `sourceKey` (do 100
znaków) jest tworzone tylko wtedy, gdy kontekst nie ma zadania z tym kluczem;
`ids` w odpowiedzi są w kolejności wejścia, a identyfikator istniejącego
zadania stoi tam, gdzie o nie pytano. Klucz powtórzony w jednym wywołaniu jest
tworzony raz, a dwa jednoczesne wywołania z tymi samymi kluczami tworzą każde
zadanie raz — rozstrzyga unikalny klucz bazy danych, a przegrany zwraca
identyfikator zwycięzcy. Projekty przekazują identyfikator definicji każdego
zadania etapu i dzięki temu *Utwórz ponownie zadania etapu* można bezpiecznie
powtarzać.

Wywołuj `createMany` **po zatwierdzeniu własnej transakcji**: każde zadanie
jest zapisywane we własnej transakcji.

`./backend` eksportuje też **`nextTaskNumber(em)`**, dostęp modułu do jego
sekwencji numerów — następny numer `TSK-…` w transakcji wywołującego, dla
kodu zapisującego zadania bez polecenia, np. kompozycji demo; jeden format
i jedna sekwencja, niezależnie od tego, kto tworzy zadanie.

### Powiadomienia, przypomnienia i podsumowanie

Wpisy w dzwonku przechodzą przez `adminNotificationRecordPort` (krawędź
`degrades-without`), z tematem `task`, po zatwierdzeniu zapisu:
`tasks.task.assigned`, `tasks.task.mention`, `tasks.task.comment`,
`tasks.task.reminder` i `tasks.digest.daily`. Każdy odbiorca jest najpierw
sprawdzany, czy może zobaczyć zadanie — `tasks:read`, szkice i zadania
prywatne oraz `canSeeAs` kontekstu.

Wpis w dzwonku przypomnienia jest zapisywany przez **`recordWithin(em,
input)`**, współtransakcyjną metodę portu: w tej samej transakcji co wiersz
doręczenia przypomnienia, unikalny dla przypomnienia i odbiorcy. Dlatego wpis
w dzwonku powstaje **dokładnie raz**, nawet gdy dwa workery wykonują przebieg
jednocześnie, a e-mail — wysyłany po zatwierdzeniu jako e-mail transakcyjny
`tasks_task_reminder` — **najwyżej raz**: awaria między zatwierdzeniem
a wysłaniem gubi e-mail i zostawia wpis w dzwonku. Przypomnienie spóźnione
o ponad 24 godziny jest zapisywane jako `expired`, a dla odbiorcy, który nie
może już dostać powiadomienia — jako `skipped`; żadne z nich niczego nie
wysyła. Podsumowanie zajmuje dzień każdego subskrybenta, zanim wyśle
`tasks_daily_digest`, więc wychodzi najwyżej raz dziennie.

Wszystkie trzy przebiegi — przypomnienia co minutę, podsumowanie i przebieg
porządkujący najwyżej co piętnaście minut — działają w jednym harmonogramie
zadań BullMQ `tasks-reminders`, podpinanym przez `ctx.worker` tylko w procesie,
który uruchamia workery. Takt najpierw ustala obecność modułu, potem zadaje
jednobitowe pytanie każdego przebiegu poza zakresem tenanta i wchodzi
w zakres systemowy tylko dla przebiegu, który ma pracę; takt bez pracy nie
zapisuje wpisu audytu `tenant.escape_hatch`.

### Zdarzenia

| Zdarzenie | Treść |
| --- | --- |
| `tasks.task.created.v1` | `{ taskId, contextType, contextId, contextGroupId, assigneeIds }` |
| `tasks.task.status_changed.v1` | `{ taskId, from, to, toCategory, contextType, contextId, contextGroupId }` — `from` i `to` to kody statusów. |
| `tasks.task.assignees_changed.v1` | `{ taskId, added, removed }` — **zastępuje** `tasks.task.assigned.v1` |
| `tasks.task.deleted.v1` | `{ taskId, contextType, contextId }` |

Każde jest emitowane raz na polecenie, po jego zatwierdzeniu. Zmiana kilku
rodzajów naraz — `PATCH` z nowym tytułem i nowymi osobami przypisanymi — to
jedno polecenie na rodzaj, każde z własnym wpisem audytu. **Szkic nie
emituje żadnych zdarzeń**, dopóki nie zostanie opublikowany:
`tasks.task.created.v1` jest emitowane przy publikacji, z osobami przypisanymi,
które zadanie ma w tej chwili. Usunięcie statusu albo priorytetu przenosi jego
zadania z jednym wpisem audytu na zadanie i bez zdarzeń.
