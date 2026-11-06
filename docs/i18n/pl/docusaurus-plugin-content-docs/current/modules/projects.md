---
title: Projekty
description: Projekty dla zera lub wielu organizacji, prowadzone przez własne etapy przez członków pełniących role projektowe
---

# Projekty (`projects`)

Moduł Projekty przechowuje **projekty**: pracę dla jednej lub wielu organizacji
— albo dla żadnej, czyli projekt wewnętrzny — prowadzoną przez własne
**etapy** przez **członków** pełniących **role projektowe**, takie jak
*Handlowiec* czy *Kierownik Projektu*.

## Co robi

Każdy projekt ma numer, np. `PRJ-000042`, nadawany przy utworzeniu i nigdy
nieużywany ponownie, tytuł, opcjonalną wartość z walutą oraz datę rozpoczęcia.
Projekt jest **otwarty**, dopóki trwa, a kończy się jako **zrealizowany** lub
**utracony**; zamknięty projekt można ponownie otworzyć.

Projekt dotyczy **zera lub wielu organizacji**. Projekt bez żadnej organizacji
to projekt **wewnętrzny**.

Każdy projekt ma własne **etapy** — nazwę, kolor i planowany czas trwania w
dniach — oraz własny **przebieg**: dozwolone przejścia między etapami. Otwarty
projekt jest zawsze dokładnie w jednym etapie.

Role projektowe to lista prowadzona przez operatora. Dwie istnieją od początku,
*Handlowiec* i *Kierownik Projektu*; można zmienić ich nazwy lub je
zarchiwizować, ale nie można ich usunąć. Rola to etykieta członka jednego
projektu: nie nadaje żadnych uprawnień. Ta sama osoba może pełnić różne role w
różnych projektach. Powody utraty projektu — *Cena*, *Wybór konkurencji*,
*Anulowany przez klienta*, *Brak decyzji* i *Inny powód* — to lista prowadzona
przez operatora w ten sam sposób.

## W panelu administracyjnym

Projekty są w menu bocznym w sekcji **Projekty i zadania → Projekty**
(`/projects`), dla administratorów, którzy mogą przeglądać projekty. Ich
konfiguracja jest w tej samej sekcji, dla administratorów, którzy mogą
konfigurować projekty: **Szablony** (`/projects/templates`), **Role projektowe**
(`/projects/roles`) i **Powody utraty** (`/projects/loss-reasons`). Jest tam też
**Analityka** (`/projects/analytics`), dla administratorów, którzy mogą
przeglądać analitykę projektów (zob. *Analityka*).

**Lista** pokazuje każdy projekt, który możesz zobaczyć: numer, tytuł,
organizacje — albo *Wewnętrzny* — bieżący etap z terminem, oznaczonym *Po
terminie*, gdy minie, wartość oraz kierowników projektu. Można ją zawęzić
według stanu, organizacji, do projektów, w których jesteś członkiem, albo
projektów dowolnego członka, według roli projektowej, którą ktoś w nich pełni,
według szablonu, z którego je utworzono, i według nazwy bieżącego etapu;
przeszukać po numerze lub tytule i posortować według daty utworzenia, wartości
lub terminu bieżącego etapu; projekty bez wartości lub terminu są zawsze na
końcu.

**Nowy projekt** (`/projects/new`) najpierw proponuje **szablony**: wybór
szablonu wypełnia opis, proponuje każdemu członkowi najpierw role szablonu i
wymienia etapy, które projekt z niego dostanie — z przebiegiem, blokadami,
alertami i zadaniami etapów — a te zmienia się w zakładce *Etapy* projektu, gdy
już istnieje. Bez szablonu formularz wymaga etapów, w kolejności — każdy z
nazwą, kolorem i planowanym czasem trwania w dniach, co najmniej jeden. W obu
przypadkach wymaga tytułu, a opcjonalnie organizacji, wartości z walutą, daty
rozpoczęcia, opisu oraz członków, każdego z rolami, które pełni; wszystko, co
wypełnił szablon, można nadal zmienić. Bez organizacji projekt jest wewnętrzny,
a formularz mówi, kto go zobaczy. Na końcu formularz pyta, **kto widzi
projekt** — zgodnie z ustawieniem modułu (domyślnie), wszyscy, którzy mogą
przeglądać projekty, albo jego członkowie i dopisane osoby, które wybiera się
wtedy w tym samym miejscu — i jednym zdaniem mówi, co ten wybór teraz oznacza
(zob. *Kto widzi projekt*). Formularz proponuje organizacje, do których masz
dostęp, i aktywnych administratorów: jego wypełnienie nie wymaga uprawnień
innych niż tworzenie projektów. Dalej są pola niestandardowe projektu, jeśli
operator jakieś zdefiniował (zob. *Pola niestandardowe*).

**Ekran projektu** pokazuje projekt, jego stan, wartość i organizacje. Pod
nimi jest **pasek etapów**: wszystkie etapy w kolejności, z zaznaczonym
bieżącym, jego termin i tylko to, co projekt może zrobić dalej — przycisk dla
każdego przejścia dozwolonego przez jego przebieg, *Zamknij jako zrealizowany*
tam, gdzie bieżący etap pozwala zakończyć projekt, oraz *Zamknij jako
utracony*, który pyta o powód utraty i opcjonalny komentarz. Zamknięty projekt
mówi, kiedy i w którym etapie się zakończył, i pozwala go *Otworzyć ponownie*.
Gdy w międzyczasie ktoś inny zmienił projekt albo inny moduł odrzuci zmianę,
ekran mówi dlaczego i pokazuje projekt w obecnym stanie; gdy zmianę odrzuci
blokada zakończenia, wymienia też otwarte zadania, które ją zatrzymały, każde
jako odnośnik do zadania.

*Usuń projekt* pyta przed usunięciem. Projekt z powiązanymi rekordami nie jest
usuwany: ekran to mówi, a rekordy trzeba najpierw odłączyć.

Jego zakładki:

- **Przegląd** — opis — z odwołaniami wyświetlanymi jako łącza, edytowany
  przyciskiem *Edytuj opis* (zob. *Notatki, wiadomości i odwołania*) — data
  rozpoczęcia, **kto widzi projekt** i członkowie według ról. Administrator, który może tworzyć i prowadzić projekty, zmienia
  tu, kto widzi projekt — te same trzy możliwości co w *Nowym projekcie* — i
  zapisuje to przyciskiem *Zapisz widoczność*; pozostali widzą, jakie jest to
  ustawienie i kto jest dopisany.
- **Etapy** — nazwa, kolor, planowany czas trwania, role odpowiedzialne, dni
  alertów, blokada zakończenia, informacja, czy z danego etapu można zakończyć
  projekt, oraz termin ustawiony ręcznie, zapisywane osobno dla każdego etapu; tutaj dodaje się etapy (na
  końcu), przesuwa je w górę lub w dół i usuwa. Gdy moduł Zadania jest
  włączony, każdy etap ma też listę **zadań etapu** — tytuł, liczbę dni od
  rozpoczęcia etapu do terminu zadania i odpowiedzialną rolę — zapisywaną w
  całości dla każdego etapu; etap, którego zadań nie udało się utworzyć przy
  wejściu projektu, mówi o tym i proponuje *Utwórz ponownie zadania etapu*.
  Pod etapami **przebieg** narysowany jako graf, w którym dodaje się i usuwa
  przejścia; etap, do którego nie prowadzi żadne przejście od pierwszego, jest
  wskazany w ostrzeżeniu.
- **Zadania** — gdy moduł Zadania jest włączony, dla administratorów, którzy
  mogą przeglądać zadania: wszystkie etapy w kolejności z ich zadaniami — numer
  (odnośnik do zadania), tytuł, status, osoba przypisana i termin, z
  oznaczeniem zadań po terminie — a dla administratorów, którzy mogą tworzyć
  zadania i edytować projekt, pole pod każdym etapem, które dodaje do niego
  zadanie po tytule. Dodanie zadania do projektu, wyjęcie go z projektu i
  usunięcie jednego z jego zadań — tutaj albo na ekranach zadań — wymaga
  uprawnienia do edycji projektów obok uprawnienia do zmieniania zadań.
- **Powiązane dokumenty** — zamówienia, zapytania ofertowe i szanse sprzedażowe
  podpięte do projektu (zob. *Podpinanie dokumentów*).
- **Historia etapów** — każde wejście do etapu, każde zamknięcie i każde
  ponowne otwarcie, od najnowszych, z tym, kto to zrobił i kiedy.
- **Notatki** i **Wiadomości** — zob. *Notatki, wiadomości i odwołania*.
  Karta *Wiadomości* pokazuje, ilu wiadomości jeszcze nie przeczytano.
- **Załączniki** — zob. *Załączniki*.
- **Historia zmian** — wszystko, co zrobiono z projektem, od najnowszych: kto,
  kiedy i jakie pola zmienił, wczytywane partiami przyciskiem *Pokaż wcześniejsze
  zmiany*. Notatka i wiadomość są odnotowywane przez długość, nigdy przez treść.
  Zmiana wartości lub pola niestandardowego pokazuje wartość przed zmianą i po
  niej — projekt przechowuje je sam; dziennik zdarzeń platformy, który nie jest
  prowadzony osobno dla każdej organizacji, wymienia tylko, *które* pola się
  zmieniły. Organizacja spoza Twojego zasięgu, do której projekt kiedyś
  należał, nie jest w niej wymieniana.

**Na ekranach dokumentów należących do projektu** — zamówienia, zapytania
ofertowego, szansy sprzedażowej, zadania — panel **Projekt** wskazuje projekt,
do którego dokument należy: jego numer jako odnośnik, tytuł, stan oraz bieżący
etap z terminem. Dokument spoza projektów albo z projektu, którego nie możesz
zobaczyć, nie pokazuje żadnego panelu.

**Na ekranie organizacji** panel **Projekty** wymienia projekty tej organizacji,
które możesz zobaczyć, od najnowszych — dziesięć najnowszych; gdy jest ich
więcej, panel podaje, ile ich jest, i prowadzi odnośnikiem *Wszystkie projekty*
do listy projektów — każdy z numerem jako odnośnikiem, tytułem, stanem i
bieżącym etapem. Administratorzy, którzy mogą tworzyć projekty, mają tam
przycisk *Nowy projekt*, który otwiera formularz z wybraną już organizacją.

**Paleta poleceń** (⌘K / Ctrl+K) proponuje pozycje *Projekty*, *Nowy projekt*,
*Szablony projektów* i *Analityka projektów* — każdą administratorom z
uprawnieniem, którego wymaga jej ekran. **Wyszukiwanie globalne** panelu
administracyjnego znajduje projekt po numerze, tytule lub nazwie jednej z jego
organizacji — wyłącznie wśród projektów, które możesz zobaczyć.

Bez uprawnienia do tworzenia i prowadzenia projektów ekran jest tylko do
odczytu: etapy, przebieg i historia są widoczne, ale niczego nie można zmienić.

**Szablony** (`/projects/templates`) wymienia szablony według nazwy z liczbą
etapów; zarchiwizowane są pokazywane na życzenie, oznaczone jako
*Zarchiwizowany*. Ekran szablonu — albo *Nowy szablon* — pozwala edytować jego
nazwę, domyślny opis i role projektowe oraz etapy z tymi samymi polami,
zadaniami etapów i grafem przebiegu co zakładka *Etapy* projektu; wszystko
zapisuje się razem przyciskiem *Zapisz szablon*. *Duplikuj* tworzy niezależną
kopię i ją otwiera; *Archiwizuj* usuwa szablon z wyboru w *Nowym projekcie*, a
*Przywróć* go przywraca.

## Prowadzenie projektu

**Tworzenie projektu.** Projekt tworzy się z tytułem i etapami, w kolejności;
opcjonalnie z opisem, wartością z walutą, datą rozpoczęcia (dzisiejszą, jeśli
jej nie podano), organizacjami, członkami z ich rolami oraz ustawieniem, kto go
widzi. Projekt dostaje numer, jest **otwarty** i zaczyna od **pierwszego
etapu**. Każda wskazana organizacja musi być dostępna dla osoby tworzącej
projekt, a każdy członek i każda dopisana osoba musi być aktywnym
administratorem. Członek może pełnić dowolną liczbę ról, także żadnej.

**Etapy.** Każdy etap ma nazwę, kolor, planowany czas trwania w dniach, role
odpowiedzialne za niego oraz informację, czy z tego etapu można zakończyć
projekt. Zakończenie jest dozwolone z ostatniego etapu, chyba że etapy mówią
inaczej. Etap przechowuje też to, czy jest **blokadą zakończenia** dla swoich
zadań, oraz własne **zadania etapu** — jedno i drugie opisano niżej w sekcji
*Zadania etapów i blokada zakończenia* — a także liczby dni przed terminem, w
które jego członkowie dostają alert (zob. *Alerty o terminach*). Etapy można dodawać (na końcu), zmieniać
im nazwę i kolor, zmieniać ich kolejność i usuwać — z wyjątkiem etapu, w którym
projekt jest, jedynego etapu projektu i etapu, który zawiera zadania.

**Przebieg.** Przejścia, które projekt może wykonać między etapami, są jego
własne. Domyślnie każdy etap przechodzi do następnego, a do etapu dodanego na
końcu prowadzi przejście z etapu, który był wcześniej ostatni. Przebieg można
zastąpić dowolnym zestawem przejść — z powrotem z *Dostawy* do *Projektu* albo z
pominięciem *Pilotażu*. Etap, do którego nie prowadzi żadne przejście od
pierwszego, jest dozwolony; projekt wskazuje go jako **nieosiągalny**, żeby
można było poprawić przebieg.

**Przenoszenie.** Projekt przechodzi tylko dozwolonym przejściem; każde inne
jest odrzucane i nic się nie zmienia. Wejście do etapu zapisuje dzień jego
rozpoczęcia — dzisiejszy, w strefie czasowej z `projects.alerts_time_zone` —
oraz jego termin: ten dzień plus planowany czas trwania etapu, albo ten sam
dzień przy czasie trwania zero. Termin ustawiony ręcznie — w zakładce *Etapy*,
gdzie wyczyszczenie pola przywraca termin liczony od rozpoczęcia etapu plus
planowany czas trwania — zostaje bez zmian, a pasek etapów informuje, że
ustawiono go ręcznie. Ponowne wejście do etapu rozpoczyna go od nowa.

**Zamykanie.** Projekt zamyka się jako **zrealizowany** z etapu, z którego
zakończenie jest dozwolone, albo jako **utracony** z dowolnego etapu — z
powodem utraty z listy i opcjonalnym komentarzem; zapisywany jest etap, w
którym projekt utracono. Zamknięty projekt można **ponownie otworzyć**: wraca do
etapu, w którym go zamknięto, a jego wynik zostaje wyczyszczony.

**Dwie osoby naraz.** Każde przejście, zamknięcie, ponowne otwarcie i edycja
wskazuje wersję projektu, na której ją wykonano. Jeśli w międzyczasie ktoś inny
zmienił projekt, zmiana jest odrzucana i nic nie zostaje zastosowane dwa razy:
trzeba odświeżyć projekt i spróbować ponownie.

**Historia.** Każde wejście do etapu, każde zamknięcie i każde ponowne otwarcie
to wiersz historii etapów projektu, z nazwami etapów takimi, jakie wtedy były,
z tym, kto to zrobił i kiedy; każda zmiana trafia też do dziennika audytu.

**Logika innych modułów.** Inny moduł albo wdrożenie może zarejestrować
sprawdzenie, które uruchamia się przed przejściem, zamknięciem lub ponownym
otwarciem i odrzuca je z własnym uzasadnieniem; wyłączonego modułu nie pyta
się. To, co się stało, jest potem ogłaszane jako zdarzenie.

Do niczego z tego nie jest potrzebny moduł Zadania: projekt przechodzi przez
swoje etapy także przy wyłączonych zadaniach.

## Zadania etapów i blokada zakończenia

Gdy moduł Zadania jest włączony, etapy projektu zawierają **zadania** — zadanie
projektu zawsze należy do jednego z jego etapów. Zadanie w projekcie jest
zwykłym zadaniem modułu Zadania (jego numer, osobę przypisaną, termin i status
opisuje strona Zadań) i widzą je tylko osoby, które mogą zobaczyć projekt: dla
każdego innego nie istnieje nigdzie — ani na liście zadań, ani w *Moich
zadaniach*, ani pod swoim adresem, nawet gdy jest mu przypisane.

**Blokada zakończenia.** Etap może być blokadą zakończenia. Projekt nie opuści
takiego etapu — przejściem ani zamknięciem jako zrealizowany z tego etapu —
dopóki któreś z zadań etapu nie ma statusu *wykonane* ani *anulowane*:
przejście jest odrzucane, nic się nie zmienia, a odmowa wymienia otwarte
zadania. Anulowane zadanie liczy się jako zakończone. Zamknięcia projektu jako
**utracony** blokada nigdy nie zatrzymuje. Etap, który nie jest blokadą,
wypuszcza projekt mimo otwartych zadań; zostają one w tym etapie.

**Zadania etapu.** Każdy etap może mieć listę **zadań etapu** — tytuł, opis,
rolę odpowiedzialną i przesunięcie terminu w dniach. Stają się prawdziwymi
zadaniami, gdy projekt **wchodzi** do etapu: z terminem w dniu rozpoczęcia
etapu plus przesunięcie i przypisane członkowi, który pełni rolę
odpowiedzialną, jeśli pełni ją dokładnie jeden aktywny członek; w przeciwnym
razie zadanie pozostaje nieprzypisane, a jego notatka wskazuje rolę — w języku
osoby, która czyta zadanie, i z bieżącą nazwą roli. Tworzy się
je raz na etap: ponowne wejście do etapu niczego nie tworzy. Zadania są
tworzone w imieniu osoby, która przeniosła projekt, i zapisywane we własnej
historii modułu Zadania. Etap bez zadań etapu niczego nie tworzy; zadania etapu
dodane do niego później zostaną utworzone przy następnym wejściu projektu do
tego etapu.

Jeśli moduł Zadania zawiedzie przy ich tworzeniu, projekt i tak jest w nowym
etapie, historia etapów podaje *Tworzenie zadań etapu nie powiodło się.*, a
zadania można utworzyć ponownie przyciskiem *Utwórz ponownie zadania etapu*
przy etapie w zakładce *Etapy*. Każde zadanie etapu powstaje **dokładnie raz**,
niezależnie od tego, jak tworzenie się nie powiodło i ile razy je ponowiono:
ponowienie tworzy tylko te, których jeszcze brakuje.

**Gdy moduł Zadania jest wyłączony**, projekt działa dalej z samymi swoimi
etapami i nic nie ginie:

- blokada zakończenia nie jest stosowana — projekt przechodzi dalej, a historia
  etapów podaje *Blokada zakończenia nie została zastosowana: moduł Zadania
  jest wyłączony.*;
- etap, do którego projekt wszedł przy wyłączonych zadaniach, nie tworzy swoich
  zadań etapu ani wtedy, ani później — historia etapów podaje *Zadania etapu
  nie zostały utworzone.*;
- etap można usunąć bez liczenia jego zadań;
- karta *Zadania* i zadania etapów na karcie *Etapy* nie są pokazywane;
- zadania etapów i blokady zostają zachowane i znów działają dla tego, co
  dzieje się po ponownym włączeniu modułu Zadania.

Usunięcie projektu usuwa razem z nim jego zadania. Gdy moduł Zadania jest
wyłączony, na razie zostają, ukryte, bo nikt nie może zobaczyć projektu, do
którego należą; etap usunięty w tym czasie także zachowuje swoje zadania.
**W ciągu piętnastu minut od ponownego włączenia modułu Zadania** są
porządkowane: zadania usuniętego projektu są usuwane, a zadania usuniętego
etapu zostają w swoim projekcie bez etapu — każda zmiana trafia do dziennika
zmian. Gdy moduł Projekty jest wyłączony, nic nie jest porządkowane: projektu,
o który nie można zapytać, nie uznaje się za usunięty.

## Szablony

**Szablon** to struktura, od której może zacząć się nowy projekt — na przykład
*Aranżacja salonu* albo *Roczna umowa ramowa*: domyślny opis, role projektowe
oraz etapy ze wszystkim, co ma etap projektu — planowanym czasem trwania,
rolami odpowiedzialnymi, alertami o terminie, blokadą zakończenia, informacją,
czy z etapu można zakończyć projekt, i zadaniami etapu — a także przebieg
między nimi. Szablon nie ma organizacji, członków, wartości ani powiązanych
rekordów.

**Utworzenie projektu z szablonu** kopiuje to wszystko do nowego projektu:
etapy, przebieg, blokady, alerty, zadania etapów i domyślny opis. Kopia należy
do projektu. Zadania etapu **pierwszego etapu** stają się zadaniami w chwili
utworzenia projektu, a dalszego etapu — gdy projekt do niego wchodzi, jak w
każdym etapie. To, co wpisała osoba tworząca projekt, ma pierwszeństwo przed
szablonem — na przykład własny opis — a każdą część kopii można potem zmienić
w projekcie. Rolę szablonu można nadać członkowi nawet wtedy, gdy w
międzyczasie ją zarchiwizowano.

**Zmiana szablonu nie zmienia żadnego projektu.** Edycja, archiwizacja lub
usunięcie szablonu pozostawia każdy projekt z niego utworzony dokładnie takim,
jaki jest; projekt wskazuje szablon, z którego powstał, dopóki ten szablon
istnieje.

**Duplikowanie** szablonu tworzy niezależną kopię, nazwaną *… (kopia)*, którą
można zmieniać bez wpływu na oryginał. **Archiwizacja** szablonu usuwa go z
wyboru dla nowych projektów; szablon zostaje zachowany i można go przywrócić.

## Role projektowe

**Rola projektowa** mówi, co członek robi w jednym projekcie — *Handlowiec*,
*Kierownik Projektu* albo własna rola, na przykład *Projektant*, *Instalator*
czy *Opiekun klienta*. Role służą do określenia, kto co robi w projekcie, do
wskazania roli odpowiedzialnej za etap lub zadanie etapu oraz do określenia, jakie
role obejmuje szablon. Jedna osoba może pełnić w projekcie kilka ról, a jedną
rolę może pełnić kilka osób.

**Role projektowe nie są uprawnieniami.** Pełnienie roli — nawet *Kierownika
Projektu* — niczego nie nadaje ani niczego nie odbiera: o tym, co dana osoba
może zobaczyć i zrobić, decydują wyłącznie jej rola administratora z jej
uprawnieniami oraz reguły z sekcji *Kto widzi projekt*. Bycie członkiem
projektu, w dowolnej roli, jest jednym ze sposobów, by projekt *widzieć*, ale
nigdy sposobem, by go zmieniać.

**Role projektowe** (`/projects/roles`) wymieniają wszystkie role z nazwą w
każdym języku panelu administracyjnego. *Handlowiec* i *Kierownik Projektu* są
dostępne od początku i oznaczone jako **Wbudowana**.

- **Dodaj rolę** prosi o nazwę w każdym języku. Nazwa angielska jest wymagana:
  to ją widać w każdym języku, który nie ma własnej nazwy. Dwie role nie mogą
  mieć tej samej nazwy angielskiej, bez względu na wielkość liter — także jeśli
  jedna z nich jest zarchiwizowana; zamiast dodawać zarchiwizowaną rolę
  ponownie, przywróć ją.
- **Zmień nazwę** zmienia nazwy; rola pozostaje tą samą rolą wszędzie, gdzie
  jest używana. Nazwę roli wbudowanej też można zmienić.
- **Archiwizuj** usuwa rolę z wyboru — dla członka, etapu czy szablonu — ale
  zostawia ją w każdym projekcie i szablonie, który jej używa, oznaczoną jako
  zarchiwizowana. **Przywróć** znów ją oferuje. Zaznacz *Pokaż zarchiwizowane
  role*, aby je zobaczyć.
- **Usuń** usuwa rolę na stałe, i to tylko taką, której nic nie używa — żaden
  członek projektu, żaden etap ani zadanie etapu i żaden szablon. Roli
  wbudowanej nie można usunąć, podobnie jak roli w użyciu: zarchiwizuj ją.

## Powody utraty

**Powody utraty** (`/projects/loss-reasons`) to powody, z jakich projekt może
zostać zamknięty jako utracony; jeden z nich trzeba wybrać przy zamykaniu
projektu. *Cena*, *Wybór konkurencji*, *Anulowany przez klienta*, *Brak
decyzji* i *Inny powód* są dostępne od początku i oznaczone jako **Wbudowany**.
Ekran działa tak samo jak *Role projektowe*: powód dodaje się z nazwą w każdym
języku, można zmienić jego nazwę, zarchiwizować go i przywrócić, a usunąć taki,
z którego nie utracono żadnego projektu. Zarchiwizowany powód nie jest już
oferowany przy zamykaniu projektu i zostaje w projektach utraconych z jego
powodu.

## Kto widzi projekt

Decydują o tym dwie reguły, zawsze w tej kolejności.

**1. Dostęp do organizacji.** Administrator, który ma dostęp do wszystkich
organizacji — każda rola poza rolą przedstawiciela handlowego — widzi każdy
projekt. Przedstawiciel handlowy widzi projekt tylko wtedy, gdy **każda**
organizacja projektu jest do niego przypisana; projekt dla dwóch organizacji, z
których ma dostęp do jednej, dla niego nie istnieje. Projekt wewnętrzny widzą
tylko administratorzy z dostępem do wszystkich organizacji. Nic, co opisano
niżej, nie poszerza tej reguły.

**2. Widoczność.** W granicach swojego dostępu administrator widzi projekt,
gdy:

- ma uprawnienie *Wgląd we wszystkie projekty*, lub
- jest członkiem projektu, lub
- jest jedną z osób dopisanych do projektu, lub
- projekt jest otwarty dla wszystkich.

To, czy projekt jest otwarty dla wszystkich, jest wyborem samego projektu,
dokonywanym przy jego tworzeniu i zmienianym w zakładce *Przegląd* przez
administratora, który może tworzyć i prowadzić projekty:

| Wybór projektu | Kto go widzi, poza posiadaczami *Wglądu we wszystkie projekty* |
| --- | --- |
| *Zgodnie z ustawieniem modułu* (domyślnie) | Przy ustawieniu modułu **Kto widzi projekt** (`projects.visibility`) równym *everyone*: każdy, kto może przeglądać projekty. Przy *members* — domyślnym — jego członkowie i dopisane osoby. |
| *Wszyscy, którzy mogą przeglądać projekty* | Każdy, kto może przeglądać projekty, niezależnie od ustawienia modułu. |
| *Członkowie i dopisane osoby* | Jego członkowie i dopisane osoby, niezależnie od ustawienia modułu. |

Dopisane osoby to administratorzy wskazani w projekcie, choć nie są jego
członkami — ktoś, kto ma śledzić projekt, nie pracując przy nim. Wybiera się je
przy możliwości *Członkowie i dopisane osoby*; wybór innej możliwości usuwa je z
projektu.

*Wgląd we wszystkie projekty* (`projects:see_all`) znosi tę drugą regułę,
nigdy pierwszą: jego posiadacz widzi każdy projekt **w granicach swojego
dostępu**, a przedstawiciel handlowy z tym uprawnieniem nadal nie widzi
projektu organizacji, która nie jest do niego przypisana, ani żadnego projektu
wewnętrznego.

Projekt, którego ktoś nie może zobaczyć, nie istnieje dla niego nigdzie: ani na
liście, ani w jej łącznej liczbie, ani pod swoim adresem, ani jako kontekst
zadania w module Zadania. Adres takiego projektu odpowiada dokładnie tak samo
jak adres projektu, którego nigdy nie utworzono. Nikt też nie dostaje o nim
powiadomienia: zadanie projektu przypisane takiej osobie nie trafia do jej
dzwonka powiadomień — dostałaby numer zadania, którego nie może otworzyć.

## Włączanie i wyłączanie

Projekty to moduł opcjonalny. Jest domyślnie włączony, a operator wyłącza go i
włącza ponownie na ekranie **Moduły** panelu administracyjnego
(`/platform/modules`).

Gdy moduł jest wyłączony:

- pozycje *Projekty*, *Analityka*, *Szablony*, *Role projektowe* i *Powody
  utraty* oraz wszystkie ich ekrany znikają z panelu administracyjnego, podobnie
  jak panel *Projekt* na ekranach zamówień, zapytań ofertowych, szans
  sprzedażowych i zadań, panel *Projekty* na ekranie organizacji, pozycje palety
  poleceń i projekty w wyszukiwaniu globalnym;
- każdy endpoint `/api/v1/admin/projects…` odpowiada `503` z kodem
  `MODULE_DISABLED`;
- jego uprawnień nie można już nadać żadnej roli, a jego ustawień nie można
  zmieniać — z wyjątkiem samego przełącznika;
- nie jest wysyłany żaden alert o terminie;
- *Projekt* nie jest oferowany na ekranie pól niestandardowych, a jego pól nie
  można tam dodawać, zmieniać ani usuwać.

Nic nie jest usuwane. Każdy projekt, jego etapy i historia zostają w bazie
danych, a po ponownym włączeniu modułu wszystko wraca dokładnie do stanu
sprzed wyłączenia.

## Ustawienia

| Ustawienie | Domyślnie | O czym decyduje |
| --- | --- | --- |
| `projects.enabled` | włączone | Czy moduł jest włączony. |
| `projects.visibility` | `members` | Kto widzi projekt korzystający z ustawienia: `everyone` — wszyscy, którzy mogą przeglądać projekty, albo `members` — jego członkowie i dopisane osoby. |
| `projects.alerts_time_zone` | `Europe/Warsaw` | Strefa czasowa, w której liczony jest „dzisiejszy” dzień projektów — dzień rozpoczęcia etapu, to, czy jego termin minął, i dzień wysłania alertu o terminie, od 8:00 w tej strefie. Musi to być nazwa strefy czasowej IANA, np. `Europe/Warsaw`; każda inna wartość jest odrzucana przy zapisie. |

## Uprawnienia

| Kod | Na co pozwala |
| --- | --- |
| `projects:read` | Przeglądanie projektów — listy, pojedynczego projektu i jego historii etapów — z zastrzeżeniem obu reguł z sekcji *Kto widzi projekt*; także nazw, z których wybierają filtry listy i pola formularzy (organizacji w granicach swojego dostępu, administratorów). |
| `projects:write` | Tworzenie, edycja i usuwanie projektów; ustawianie ich organizacji, członków, etapów i przebiegu; przenoszenie, zamykanie i ponowne otwieranie; podpinanie i odpinanie dokumentów — dokument danego rodzaju wymaga też uprawnienia do przeglądania tego rodzaju (zob. *Podpinanie dokumentów*); razem z `tasks:write` dodawanie zadania do projektu, wyjmowanie go z projektu i usuwanie jego zadań. Wymaga `projects:read`. |
| `projects:see_all` | Wgląd we wszystkie projekty w granicach swojego dostępu, niezależnie od ustawienia modułu i wyboru samego projektu (zob. *Kto widzi projekt*). Wymaga `projects:read`; nigdy nie poszerza dostępu do organizacji. |
| `projects:configure` | Tworzenie, edycja, duplikowanie, archiwizacja i przywracanie szablonów; dodawanie, zmiana nazwy, archiwizacja, przywracanie i usuwanie ról projektowych i powodów utraty. Wymaga `projects:read`; każdy, kto może przeglądać projekty, może odczytać szablony, role i powody utraty, aby użyć ich w projekcie. |
| `projects:analytics` | Przeglądanie analityki projektów (zob. *Analityka*) — każdy wskaźnik liczony spośród projektów, które możesz zobaczyć. Wymaga `projects:read`. |

Rola projektowa nie jest jednym z tych uprawnień: jej pełnienie nie nadaje
żadnego uprawnienia (zob. *Role projektowe*).

## Podpinanie dokumentów

Zakładka **Powiązane dokumenty** projektu wymienia podpięte do niego
zamówienia, zapytania ofertowe i szanse sprzedażowe, każdy rodzaj w osobnej
grupie: każdy dokument z numerem — odnośnikiem do niego — statusem i kwotą.

- **Podpiąć można tylko dokumenty organizacji projektu.** Wybór każdego rodzaju
  przeszukuje po numerze własną listę tego rodzaju dla wybranej organizacji —
  przy jednej organizacji dla niej. Projekt wewnętrzny nie ma organizacji, więc
  nie można do niego niczego podpiąć.
- **Dokument należy najwyżej do jednego projektu.** Podpięcie dokumentu, który
  jest już w innym projekcie, jest odrzucane z informacją, który projekt go ma —
  jeśli możesz ten projekt zobaczyć; w przeciwnym razie tylko z informacją, że
  należy do jakiegoś projektu.
- **To, co pokazuje podpięty dokument, należy do jego własnego modułu.** Numer,
  status i kwota są widoczne tylko dla osoby, która może przeglądać dokumenty
  danego rodzaju — zamówienia, zapytania ofertowe (obsługa zapytań ofertowych)
  albo szanse sprzedażowe (przeglądanie CRM); pozostali widzą dokument jako
  *Niedostępny*. To samo uprawnienie jest potrzebne, aby podpiąć dokument tego
  rodzaju.
- **Gdy CRM albo zapytania ofertowe są wyłączone**, ich powiązania zostają i są
  pokazywane jako niedostępne, nie można dodawać nowych, a po ponownym włączeniu
  modułu wracają w niezmienionej postaci. Reszta projektu działa dalej.
- **Dokument, który już nie istnieje** — szansa sprzedażowa usunięta w CRM;
  zamówień i zapytań ofertowych nigdy się nie usuwa — jest pokazywany jako
  niedostępny i można go odpiąć ręcznie.
- **Odpięcie** nie wymaga niczego poza prowadzeniem projektu i działa także dla
  niedostępnego dokumentu.
- **Organizacji z podpiętym dokumentem nie można usunąć z projektu**, dopóki jej
  dokumenty nie zostaną odpięte; projektu z podpiętymi dokumentami nie można
  usunąć, dopóki wszystkie nie zostaną odpięte.

Każde podpięcie i każde odpięcie jest zapisywane w historii projektu.

## Notatki, wiadomości i odwołania

Projekt ma dwa wątki, oba **wewnętrzne** — żaden klient nigdy ich nie widzi, ani
w sklepie, ani nigdzie indziej:

- **Notatki** to to, co osoby prowadzące projekt chcą zapamiętać. Notatkę może
  edytować lub usunąć tylko osoba, która ją napisała — nawet posiadanie
  wszystkich uprawnień nie czyni cudzej notatki Twoją. Usunięta notatka znika z
  listy; historia zmian odnotowuje, że ją usunięto, ale nie jej treść.
- **Wiadomości** to rozmowa w projekcie. Wysłanej wiadomości nie może zmienić
  ani usunąć nikt. Wysłanie jej powiadamia **wszystkich członków projektu**
  oprócz autora — dzwonkiem, który wskazuje projekt numerem, nigdy treścią
  wiadomości. Karta *Wiadomości* pokazuje, ile wiadomości innych osób jeszcze
  nie przeczytano; otwarcie jej oznacza je jako przeczytane.

W opisie, notatkach i wiadomościach można podczas pisania **odwoływać się do
rzeczy**:

| Wpisz | Aby odwołać się do | Dostępne dla |
| --- | --- | --- |
| `@` | osoby | administratorów, którzy mogą tworzyć i prowadzić projekty; lista podaje tylko osoby, które mogą widzieć projekt |
| `@@` | dokumentu — jedna lista w grupach: zamówienia, zapytania ofertowe, zadania, szanse sprzedażowe, projekty | zamówienia z uprawnieniem do przeglądania zamówień, zapytania ofertowe z uprawnieniem do ich obsługi, zadania z uprawnieniem do przeglądania zadań, szanse sprzedażowe z uprawnieniem do przeglądania CRM; projekty — każdy inny projekt, który możesz zobaczyć — zawsze; zamówienia i zapytania ofertowe to te organizacji projektu — żadne w projekcie wewnętrznym; w formularzu **Nowy projekt** — te organizacji wybranych w formularzu |
| `@@@` | produktu | administratorów, którzy mogą przeglądać katalog |

To samo robią przyciski nad polem — *Wspomnij osobę*, *Wstaw dokument*,
*Wstaw produkt*. Odwołanie jest wyświetlane jako łącze z aktualnym numerem lub
nazwą tego, do czego się odnosi — temu, kto może to zobaczyć; pozostałym, a
także gdy moduł, do którego należy, jest wyłączony lub gdy rzecz już nie
istnieje, jako niedostępne, bez numeru. Grupa listy `@@`, której moduł jest
wyłączony, nie jest oferowana.

**Osoba nowo wspomniana** w opisie, notatce lub wiadomości dostaje jedno
powiadomienie — wskazujące projekt numerem i autora, nigdy treść — i tylko
wtedy, gdy może widzieć projekt (zob. *Kto widzi projekt*). Nikt nie dostaje
powiadomienia o wspomnieniu samego siebie, a członek wspomniany w wiadomości
dostaje to jedno powiadomienie, nie drugie za wiadomość. Przy wyłączonym module
powiadomień nikt nie jest powiadamiany, a wszystko i tak zostaje zapisane.

## Załączniki

Karta **Załączniki** wymienia pliki projektu — nazwę, rozmiar, kto i kiedy je
dołączył — każdy z przyciskiem *Pobierz*. *Dodaj plik* (albo upuszczenie pliku
na pole) przesyła plik i dołącza go w jednym kroku; może to zrobić każdy, kto
może tworzyć i prowadzić projekty. Plik trafia do biblioteki mediów jako
**prywatny**, a obowiązują go zasady biblioteki dotyczące typów i rozmiarów
plików. Plik, który przeglądarka by wykonała — strona HTML, obraz SVG, dokument
XML, skrypt — jest odrzucany. *Usuń* odłącza plik; sam plik zostaje w
bibliotece mediów.

**Biblioteka mediów nie usunie pliku, którego używa projekt**, i wskazuje ten
projekt numerem tym, którzy mogą go zobaczyć — także wtedy, gdy moduł Projekty
jest wyłączony. Najpierw odłącz plik od projektu. Plik używany tylko przez
projekty, których ktoś nie jest członkiem, jest przed nim ukryty w bibliotece
mediów. Odnośnik do pobrania jest przygotowywany w chwili
kliknięcia *Pobierz* i ważny przez kilka minut.

## Alerty o terminach

Etap może mieć **alerty** — pełne dni przed terminem, od 1 do 365, każdy raz,
np. `7, 1` — ustawiane w zakładce *Etapy* projektu albo w szablonie, z którego
nowy projekt je kopiuje.

**W dniu, w którym do terminu zostaje tyle dni**, od 8:00 w strefie czasowej z
`projects.alerts_time_zone`, **każdy członek** projektu, który może go widzieć,
dostaje informację — w dzwonku powiadomień i e-mailem — że etap ma termin w
danym dniu i ile dni zostało. Powiadomienie w dzwonku otwiera projekt w
zakładce *Etapy*; e-mail podaje numer projektu, etap, termin i liczbę
pozostałych dni, w języku panelu administracyjnego członka, i nie zawiera
linku. Każdy alert jest wysyłany **raz** dla danego terminu:

- tylko dla **bieżącego etapu** **otwartego** projektu — nic dla etapu, z
  którego projekt już wyszedł, i nic dla zamkniętego projektu;
- **nigdy wstecz**: projekt, który wchodzi do etapu po dniu alertu, albo termin
  przesunięty tak, że dzień alertu minął, nie wysyła nic za ten dzień; wejście
  do etapu w dniu alertu nadal wysyła go tego dnia;
- termin **przesunięty** na nową datę wysyła swoje alerty ponownie, raz, dla
  nowej daty;
- **tylko członkom** — nie osobom dopisanym do projektu i nie posiadaczom roli,
  którzy nie są członkami; a spośród nich tylko tym, którzy w chwili wysłania
  alertu mogą widzieć projekt: aktywnym administratorom z uprawnieniem do
  przeglądania projektów, mającym w zasięgu każdą organizację projektu.
  Członek dezaktywowany albo spoza zasięgu jest pomijany.

Alerty są sprawdzane co piętnaście minut, więc alert przychodzi w ciągu
kwadransa od 8:00. Przy wyłączonym module powiadomień członkowie dostają tylko
e-mail; operator może wyłączyć lub zmienić ten e-mail na ekranie szablonów
e-maili (*Stage deadline alert*). Gdy moduł Projekty jest wyłączony, żaden
alert nie jest wysyłany ani zużywany: alert przypadający na ten dzień wyjdzie,
gdy moduł zostanie włączony ponownie tego samego dnia.

## Pola niestandardowe

Operator dodaje do projektów własne pola — region budowy, numer umowy,
powierzchnię — na ekranie **Pola niestandardowe** (`/custom-fields`), gdzie
*Projekt* jest jednym z typów rekordów, tak jak *Zamówienie* i *Szansa
sprzedażowa*. Każde pole ma typ (tekst, liczba, tak/nie, data, jeden wybór lub
kilka wyborów) i może być wymagane.

Pola są na zakładce *Przegląd* projektu, pod członkami, oraz w formularzu
**Nowy projekt**, po sekcji *Kto widzi ten projekt*. Osoba z prawem edycji
zmienia je na zakładce i zapisuje przyciskiem *Zapisz pola niestandardowe*; w
formularzu są wysyłane razem z projektem. Każdy inny, kto może zobaczyć projekt,
je odczytuje. Wartość niezgodna z polem — puste pole wymagane, liczba, która nie
jest liczbą, wybór spoza listy — jest odrzucana, a pole zostaje wskazane; nic
nie jest zapisywane. Pole wymagane dodane po utworzeniu projektu jest wymagane
przy następnym zapisie pól tego projektu, a nie przy innej edycji.

- Wartości pól są pokazywane tylko temu, kto **może zobaczyć projekt** (*Kto
  widzi projekt*), i tylko administratorowi, który może też przeglądać pola
  niestandardowe (`custom_fields:read`); bez tego uprawnienia pola ani ich
  wartości w historii zmian nie są pokazywane.
- Każda zmiana pola jest w **historii zmian** projektu — *Zmieniono pola
  niestandardowe*, z wartością każdego zmienionego pola przed zmianą i po niej;
  wartości, z którymi projekt utworzono, są we wpisie *Utworzono projekt*.
  Projekt przechowuje te wartości sam: dziennik zdarzeń platformy, który nie
  jest prowadzony osobno dla każdej organizacji, wymienia tylko zmienione pola.
- Pole oznaczone na ekranie pól niestandardowych jako **filtr listy** jest
  oferowane jako filtr listy projektów, obok jej własnych filtrów — administratorowi,
  który może też przeglądać pola niestandardowe (`custom_fields:read`). Filtr,
  którego pole nie jest już oferowane, jest wskazany nad listą wraz z możliwością
  jego usunięcia.
- Pole usunięte na ekranie pól niestandardowych nie jest już pokazywane w żadnym
  projekcie.

Gdy moduł Projekty jest wyłączony, *Projekt* nie jest oferowany na ekranie pól
niestandardowych, a jego pól nie można tam zmieniać; one i wszystkie wartości
zostają i wracają razem z modułem.

## Analityka

**Analityka** (`/projects/analytics`) pokazuje, jak szły projekty w wybranym
okresie — w tym miesiącu, w poprzednim, w ostatnich 90 dniach, w tym roku albo
we własnym zakresie dni — i można ją zawęzić do projektów utworzonych z jednego
**szablonu**, projektów jednej **organizacji** i projektów prowadzonych przez
jednego **kierownika projektu**.

| Wskaźnik | Co liczy |
| --- | --- |
| **Projekty w okresie** | *Otwarte*: projekty utworzone w okresie. *Zakończone* i *utracone*: projekty zamknięte w nim w jeden lub drugi sposób. *Odsetek zakończonych* to zakończone spośród wszystkich zamkniętych — zakończonych i utraconych. |
| **Średni czas trwania** | Od utworzenia projektu do jego zamknięcia, w dniach, osobno dla zakończonych i dla utraconych — dla projektów zamkniętych w okresie. |
| **Średni czas na etapie** | Jak długo projekty pozostają na każdym etapie, w dniach. Pobyt trwa od wejścia na etap — przy utworzeniu projektu, przeniesieniu na ten etap albo ponownym otwarciu — do następnego przeniesienia albo zamknięcia. Liczone są pobyty rozpoczęte w okresie, które **już się zakończyły**: etap, na którym projekt nadal jest, nie jest jeszcze liczony. |
| **Na którym etapie projekty są tracone** | Projekty utracone w okresie, według etapu, na którym były w chwili utraty — od najczęstszego, każdy z udziałem we wszystkich utratach. |
| **Powody utraty** | Te same projekty według powodu wybranego przy zamknięciu, każdy z udziałem. |
| **Wartość utraconych projektów** | Ile były warte projekty utracone w okresie, w każdej walucie osobno. |
| **Średnia wartość projektu** | Średnia wartość projektów utworzonych w okresie, w każdej walucie osobno, i z ilu projektów jest liczona. |
| **Kierownicy projektów z największą liczbą zakończonych projektów** | Członkowie z rolą *Kierownik Projektu* w projektach zakończonych w okresie, według liczby zakończonych — najwyżej dziesięciu. |
| **Najcenniejsze otwarte projekty** | Projekty utworzone w okresie, które są nadal otwarte, pięć najcenniejszych w każdej walucie, każdy z odnośnikiem do projektu. |

Każdy wskaźnik:

- **liczy tylko projekty, które możesz zobaczyć** — obowiązują obie reguły z
  sekcji *Kto widzi projekt*, więc dwie osoby mogą zobaczyć dla tego samego
  okresu różne liczby;
- podaje **okres i liczbę projektów, z których został policzony**, a wskaźnik
  kwot podaje też, ile projektów **pominął, bo nie miały wartości**;
- pokazuje **kwoty w każdej walucie osobno**: kwoty w dwóch walutach nigdy nie
  są sumowane i nie ma wskaźnika dla wszystkich walut naraz;
- grupuje **etapy według nazwy**, bez względu na wielkość liter i otaczające
  spacje, bo każdy projekt ma własne etapy — *Montaż* w jednym projekcie i
  *montaż* w innym to jeden wiersz. Etap jest nazwany tak, jak nazywał się,
  gdy projekt na niego wszedł albo został na nim utracony, więc późniejsza
  zmiana nazwy etapu nie przesuwa dawnych pobytów ani utrat.

Pod każdym wykresem jest tabela z tymi samymi liczbami. Dni są liczone w
**strefie czasowej raportów** — ustawieniu *Strefa czasowa raportów* w sekcji
*Analityka* ekranu ustawień, domyślnie `UTC`: zakres zaczyna się o północy jego
pierwszego dnia i kończy o północy po ostatnim, obie w tej strefie. Gdy moduł
Analityka jest wyłączony, dni są liczone w `UTC`. Gotowe zakresy (*Ten
miesiąc*, …) biorą dzisiejszą datę z Twojego komputera.

Gdy moduł Projekty jest wyłączony, ekranu i jego pozycji w menu bocznym nie
ma, a wskaźniki nie są udostępniane.

## Dla programistów

### API

| Metoda i ścieżka | Uprawnienie | Odpowiedź |
| --- | --- | --- |
| `GET /api/v1/admin/projects` | `projects:read` | Strona projektów oraz liczba projektów widocznych dla wywołującego: `{ items, nextCursor, total }`. Filtry: `state` (powtarzalny), `organizationId`, `memberId` (identyfikator administratora lub `me`), `roleId`, `templateId`, `stageName` (nazwa bieżącego etapu), `q` (numer lub tytuł), `sort` (`createdAt` — domyślnie, `value` albo `deadline` — termin bieżącego etapu; projekty bez wartości lub terminu są zawsze na końcu), `order` (`asc` lub `desc`, domyślnie `desc`), `cursor`, `limit` (najwyżej 100) oraz `customFieldFilters` — pola niestandardowe oznaczone jako filtry listy, jako JSON, w kształcie przyjmowanym przez listy zamówień, zapytań ofertowych i szans sprzedażowych; pole, którego lista nie oferuje, to `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE` z jego nazwą. |
| `GET /api/v1/admin/projects/custom-field-filters` | `projects:read` | `{ data: CustomFieldListFilterField[] }` — pola niestandardowe projektów oznaczone jako filtry listy. |
| `POST /api/v1/admin/projects` | `projects:write` | `201` `{ data: ProjectDetail }`. Bez `templateId` pole `stages` jest wymagane; z nim struktura szablonu jest kopiowana, a `stages` jest odrzucane (`422`), zaś nieznany lub zarchiwizowany szablon to `422` `PROJECT_TEMPLATE_NOT_FOUND`. `customFieldValues` jest sprawdzane względem pól niestandardowych projektu także wtedy, gdy go brak — brak pola wymaganego to `422` `CUSTOM_FIELD_VALUE_INVALID`, po jednym problemie na pole, z kluczem pola w `path`. |
| `GET /api/v1/admin/projects/:id` | `projects:read` | `{ data: ProjectDetail }` albo `404` `PROJECT_NOT_FOUND` — tak samo dla projektu, który nie istnieje, jak dla takiego, którego wywołujący nie może zobaczyć. |
| `PATCH /api/v1/admin/projects/:id` | `projects:write` | Tytuł, opis, wartość, data rozpoczęcia, `visibility` (`inherit`, `everyone` albo `members_and_listed`) i `viewerIds` (cała lista dopisanych osób — widzą one projekt bez względu na `visibility`; panel administracyjny dopisuje osoby tylko przy `members_and_listed`), razem z `version`; `409` `PROJECT_CHANGED`, gdy projekt zmienił się od odczytu, `422` `PROJECT_MEMBER_INVALID` dla nowo dopisanej osoby, która nie jest aktywnym administratorem. Zmiana tego, kto widzi projekt, trafia do dziennika zdarzeń osobno od zmiany treści (`projects.project.visibility_set`, `projects.project.viewers_set`). `customFieldValues` wymienia pola, które zmienia — pozostałe zachowują wartości, `null` czyści pole — i jest odrzucane tak jak przy tworzeniu; trafia do dziennika zdarzeń osobno (`projects.project.custom_fields_update`). |
| `DELETE /api/v1/admin/projects/:id` | `projects:write` | `204`; `409` `PROJECT_HAS_LINKS`, dopóki są podpięte dokumenty. |
| `GET /api/v1/admin/projects/lookups/organizations` | `projects:read` | `{ data: { id, name }[] }` — organizacje, do których wywołujący ma dostęp, według nazwy (`q`) albo jedna według `id`; najwyżej `limit` (50). |
| `GET /api/v1/admin/projects/lookups/admin-users` | `projects:read` | `{ data: { id, name, email }[] }` — aktywni administratorzy według imienia i nazwiska lub adresu e-mail (`q`) albo jeden według `id`; najwyżej `limit` (50). |
| `GET /api/v1/admin/projects/visibility-setting` | `projects:read` | `{ data: { setting } }` — bieżąca wartość ustawienia modułu `projects.visibility`. |
| `PUT /api/v1/admin/projects/:id/organizations` | `projects:write` | Cały zestaw → szczegóły projektu albo `{ data: { id, outOfReach: true } }`, gdy wywołujący ograniczony do części organizacji usunął je wszystkie — projekt jest wewnętrzny i poza jego zasięgiem; `422` `PROJECT_ORGANIZATION_OUT_OF_SCOPE`; `409` `PROJECT_ORGANIZATION_IN_USE` przy usuwaniu organizacji, do której należy podpięty dokument. |
| `PUT /api/v1/admin/projects/:id/members` | `projects:write` | Cały zestaw członków i ich ról; `422` `PROJECT_MEMBER_INVALID`. |
| `POST /api/v1/admin/projects/:id/stages` | `projects:write` | `201` `{ data: ProjectStage }`, dodany na końcu. |
| `PATCH /api/v1/admin/projects/:id/stages/:stageId` | `projects:write` | Dowolny atrybut; `deadlineOn` ustawia termin ręcznie, `null` przywraca termin liczony jako początek + czas trwania. |
| `DELETE /api/v1/admin/projects/:id/stages/:stageId` | `projects:write` | `204`; `409` `PROJECT_STAGE_CURRENT`, `PROJECT_STAGE_LAST` lub `PROJECT_STAGE_HAS_TASKS`. |
| `PUT /api/v1/admin/projects/:id/stages/order` | `projects:write` | Identyfikatory wszystkich etapów w nowej kolejności. |
| `PUT /api/v1/admin/projects/:id/moves` | `projects:write` | Cały przebieg → `{ data: { moves, unreachableStageIds } }`. |
| `POST /api/v1/admin/projects/:id/move` | `projects:write` | `{ toStageId, version }` → `{ data: { project, entry, createdTaskIds, notes } }` — `createdTaskIds` to zadania etapu utworzone przez przejście, `notes` to, co zapisał wpis (`gate_not_applied_tasks_off`, `stage_tasks_skipped`, `tasks_materialize_failed`); `409` `PROJECT_MOVE_NOT_PERMITTED`, `PROJECT_STAGE_GATE_OPEN_TASKS` (`details.openTaskCount`; `details.openTasks`: `{ id, number, title }[]` tylko dla wywołującego z `tasks:read`), `PROJECT_CHANGED` lub `PROJECT_GUARD_REFUSED`. |
| `POST /api/v1/admin/projects/:id/close` | `projects:write` | `{ outcome: 'completed', version }` albo `{ outcome: 'lost', lossReasonId, comment?, version }`; `409` `PROJECT_COMPLETION_NOT_PERMITTED` albo, przy zakończeniu, `PROJECT_STAGE_GATE_OPEN_TASKS`; `422` `PROJECT_LOSS_REASON_INVALID`. |
| `POST /api/v1/admin/projects/:id/reopen` | `projects:write` | `{ version }` → powrót do etapu, w którym projekt zamknięto. |
| `GET /api/v1/admin/projects/:id/stage-history` | `projects:read` | Każde wejście do etapu, zamknięcie i ponowne otwarcie, od najstarszych. |
| `PUT /api/v1/admin/projects/:id/stages/:stageId/tasks` | `projects:write` | `{ tasks: StageTaskDefinition[] }` (najwyżej 100), zastępuje zadania etapu → `{ data: ProjectStage }`; `422` dla nieznanej roli odpowiedzialnej. |
| `POST /api/v1/admin/projects/:id/stages/:stageId/materialize-tasks` | `projects:write` | Ponownie tworzy zadania etapu po zapisanym błędzie — `tasksMaterializeFailed` etapu — → `{ data: { created } }`; w innym przypadku `409` `PROJECT_STAGE_TASKS_NOT_RETRYABLE`, a przy wyłączonym module Zadania `503` `MODULE_DISABLED`. |
| `GET /api/v1/admin/projects/:id/tasks` | `projects:read` | `{ data: { tasksAvailable, stages: [{ stageId, tasks: TaskSummary[] }] } }`, w kolejności etapów; `tasksAvailable: false` i brak etapów, gdy moduł Zadania jest wyłączony albo czytający nie ma `tasks:read`. |
| `GET /api/v1/admin/projects/:id/links` | `projects:read` | `{ data: ProjectLink[] }`, od najstarszych: `{ id, kind, recordId, available, number?, status?, amount?, currency?, href?, linkedBy, linkedAt }`. Pola dokumentu są obecne tylko przy `available` — czytający ma kod odczytu właściciela (`orders:read`, `rfqs:handle`, `crm:read`), jego moduł jest włączony, a dokument nadal istnieje. |
| `POST /api/v1/admin/projects/:id/links` | `projects:write` | `{ kind: 'order' \| 'quote_request' \| 'opportunity', recordId }` → `201` `{ data: ProjectLink }`. `503` `MODULE_DISABLED`, gdy moduł danego rodzaju jest wyłączony; `403` bez kodu odczytu właściciela; `404` `PROJECT_RECORD_NOT_FOUND` dla dokumentu, który nie istnieje lub jest poza zasięgiem wywołującego; `422` `PROJECT_LINK_ORGANIZATION_MISMATCH` dla dokumentu organizacji, której projekt nie ma; `409` `PROJECT_RECORD_ALREADY_LINKED`, którego `details.project` (`{ id, number, title }`) wskazuje projekt zawierający dokument tylko wywołującemu, który może ten projekt zobaczyć. |
| `DELETE /api/v1/admin/projects/:id/links/:linkId` | `projects:write` | `204`; `404` dla powiązania innego projektu albo nieistniejącego. |
| `GET /api/v1/admin/projects/records/:kind/:recordId/project` | `projects:read` | `{ data: ProjectSummary }` — projekt, do którego należy `order`, `quote_request`, `opportunity` lub `task` (przez swój kontekst); `404` `PROJECT_NOT_FOUND` jednakowo dla dokumentu spoza projektów i dla dokumentu z projektu, którego wywołujący nie może zobaczyć. Wymaga też kodu odczytu danego rodzaju (`403`) i włączonego modułu (`503`). |
| `GET /api/v1/admin/projects/:id/comments?kind=note\|message` | `projects:read` | `{ data: ProjectComment[] }`, od najstarszych, bez usuniętych notatek; każdy z `references` — tym, co jego tokeny oznaczają dla czytającego. |
| `POST /api/v1/admin/projects/:id/comments` | `projects:write` | `{ kind, body }` → `201` `{ data: ProjectComment }`. Wiadomość powiadamia każdego członka, który może widzieć projekt, oprócz autora; nowo wspomniana osoba, która może go widzieć, dostaje jedno powiadomienie. |
| `PATCH /api/v1/admin/projects/:id/comments/:commentId`, `DELETE …` | `projects:write` | Notatka — tylko przez autora; dla kogokolwiek innego `403` `PROJECT_NOTE_NOT_AUTHOR`; wiadomość — nigdy, `409` `PROJECT_MESSAGE_IMMUTABLE`. `DELETE` zachowuje wiersz, oznaczony. |
| `POST /api/v1/admin/projects/:id/messages/read` | `projects:read` | `{ throughMessageId }` → `{ data: { unreadMessageCount } }`; znacznik przeczytania wywołującego, który przesuwa się tylko do przodu. Nie trafia do dziennika zmian. |
| `GET /api/v1/admin/projects/:id/attachments` | `projects:read` | `{ data: ProjectAttachment[] }`, każdy z odnośnikiem do pobrania ważnym przez kilka minut. |
| `POST /api/v1/admin/projects/:id/attachments/upload` | `projects:write` | `multipart/form-data` z jedną częścią `file` → `201`; zapisany jako prywatny, potem dołączony — plik, którego nie udało się dołączyć, jest wycofywany. `415` dla treści aktywnej lub typu odrzucanego przez bibliotekę, `413` `PROJECT_ATTACHMENT_TOO_LARGE` powyżej 25 MB oraz własny limit rozmiaru biblioteki. |
| `POST /api/v1/admin/projects/:id/attachments` | `projects:write` **i** `assets.read` | `{ assetId }` prywatnego, istniejącego pliku, który nie jest treścią aktywną → `201` (`200` dla pliku już dołączonego); `422` dla pliku publicznego lub takiego, którego nie ma — także dołączonego do projektu, którego wywołujący nie może widzieć. |
| `DELETE /api/v1/admin/projects/:id/attachments/:attachmentId` | `projects:write` | `204`; plik zostaje w bibliotece. |
| `GET /api/v1/admin/projects/:id/history` | `projects:read` | `RecordHistoryPage` — dziennik zmian projektu, od najnowszych, `limit` i nieprzezroczysty `cursor`, sięgający 499 wpisów wstecz (`truncated` na ostatniej stronie, gdy jest ich więcej). Zapis, który zmienił wartość lub pola niestandardowe, jest zwracany z nimi przed zmianą i po niej — `valueAmount` (dwa miejsca po przecinku, tak jak przechowuje ją projekt) / `valueCurrency` i `customFieldValues` zmienionych pól, z własnej tabeli projektu `project_value_changes` — a jego wpis w dzienniku zdarzeń tylko je wymienia (`changedFields` / `changedCustomFields` oraz `valueChangeId`, którego odpowiedź nie zawiera). Pola niestandardowe, przez wartość lub nazwę, tylko dla posiadacza `custom_fields:read`; żadnej organizacji spoza zasięgu czytelnika ani dokumentu podpięcia, które ją wskazywało. |
| `GET /api/v1/admin/projects/lookups/mentionable` | `projects:write` | `?projectId=&q=` → `{ data: { id, name, email }[] }` — aktywni administratorzy z `projects:read`, którzy mogą widzieć projekt (bez `projectId` — każdy posiadacz `projects:read`); najwyżej 20. |
| `GET /api/v1/admin/projects/lookups/documents` | `projects:write` | `?projectId=&q=` → `RecordDocumentLookupResponse` (`{ groups: { kind, items }[] }`, bez opakowania w `data`) — lista `@@`, w schemacie, który odpowiada też `GET /crm/lookups/documents` w CRM; grupa tylko z jej uprawnieniem do odczytu i włączonym modułem, najwyżej 10 w grupie. Zanim projekt powstanie, `organizationIds` (powtarzalny) wskazuje organizacje, których zamówienia i zapytania ofertowe są oferowane — liczą się tylko te w zasięgu wywołującego, a organizacja poza zasięgiem jest pomijana bez słowa; obok `projectId` jest ignorowany. |
| `GET /api/v1/admin/projects/roles`, `…/loss-reasons` | `projects:read` | Słowniki z polem `label` w języku czytającego; `active=true` pomija zarchiwizowane wiersze. |
| `POST /api/v1/admin/projects/roles`, `…/loss-reasons` | `projects:configure` | `{ defaultName, name }` (`name`: nazwa dla każdego języka) → `201` `{ data }`. `code` powstaje z `defaultName` — rozdzielany `_`, z `_2`, `_3`…, gdy inny wiersz już go ma — i nigdy się nie zmienia. `409` `PROJECT_DICTIONARY_NAME_TAKEN` dla nazwy domyślnej, którą ma inny wiersz tego samego słownika, bez względu na wielkość liter. |
| `PATCH /api/v1/admin/projects/roles/:id`, `…/loss-reasons/:id` | `projects:configure` | `defaultName` i/lub `name`, które zastępuje nazwy we wszystkich językach → `{ data }`; `404` `PROJECT_DICTIONARY_ENTRY_NOT_FOUND`, `409` `PROJECT_DICTIONARY_NAME_TAKEN`. |
| `POST …/roles/:id/archive`, `…/restore` (i to samo pod `loss-reasons`) | `projects:configure` | `{ data }`. |
| `DELETE /api/v1/admin/projects/roles/:id`, `…/loss-reasons/:id` | `projects:configure` | `204`; `409` `PROJECT_DICTIONARY_ENTRY_SYSTEM` dla wiersza wbudowanego, `409` `PROJECT_DICTIONARY_ENTRY_IN_USE` dla wiersza, którego używa projekt lub szablon. |
| `GET /api/v1/admin/projects/templates` | `projects:read` | `{ data: ProjectTemplateSummary[] }` według nazwy; `active=true` pomija zarchiwizowane szablony. |
| `GET /api/v1/admin/projects/templates/:id` | `projects:read` | `{ data: ProjectTemplateDetail }` albo `404` `PROJECT_TEMPLATE_NOT_FOUND`. |
| `POST /api/v1/admin/projects/templates`, `PUT …/templates/:id` | `projects:configure` | Cały szablon w jednym body (`ProjectTemplateBody`: nazwa, opis, `roleIds`, `stages` — każdy z `key` i swoimi `tasks`, `moves` wskazujące etapy po kluczu — pominięte oznacza przejście każdego etapu do następnego) → `201` / `200` `{ data: ProjectTemplateDetail }`. Klucz, który jest identyfikatorem jednego z etapów szablonu, zachowuje identyfikator tego etapu. |
| `POST /api/v1/admin/projects/templates/:id/duplicate` | `projects:configure` | `201` `{ data: ProjectTemplateDetail }` — niezależna kopia. |
| `POST /api/v1/admin/projects/templates/:id/archive`, `…/restore` | `projects:configure` | `{ data: ProjectTemplateDetail }`. |

| `GET /api/v1/admin/projects/analytics/summary` | `projects:analytics` | `{ opened, completed, lost, completionRate }` — `completionRate` to `null`, gdy nic nie zostało zamknięte. |
| `GET /api/v1/admin/projects/analytics/durations` | `projects:analytics` | `{ completedAverageDays, completedCount, lostAverageDays, lostCount }` — od utworzenia do zamknięcia, dla projektów zamkniętych w okresie. |
| `GET /api/v1/admin/projects/analytics/time-in-stage` | `projects:analytics` | `{ stageName, averageDays, sampleCount }[]` dla każdej nazwy etapu, z pobytów rozpoczętych w okresie i zakończonych, w kolejności, w jakiej etapy są zwykle przechodzone. |
| `GET /api/v1/admin/projects/analytics/losses` | `projects:analytics` | `{ byStage: { stageName, count, share }[], byReason: { lossReasonId, code, name, count, share }[], lostValue: { currency, amount }[] }` dla projektów utraconych w okresie; `name` w języku czytelnika. |
| `GET /api/v1/admin/projects/analytics/value` | `projects:analytics` | `{ average: { currency, amount, count }[] }` dla projektów utworzonych w okresie. |
| `GET /api/v1/admin/projects/analytics/top-open` | `projects:analytics` | `ProjectSummary[]` — otwarte projekty utworzone w okresie, po pięć w każdej walucie, według waluty, od najcenniejszego. |
| `GET /api/v1/admin/projects/analytics/managers` | `projects:analytics` | `{ adminUser: { id, name }, completedCount }[]` — osoby z rolą `project_manager` w projektach zakończonych w okresie, najwyżej dziesięć. |

Każda ścieżka analityki przyjmuje `from` i `to` (`YYYY-MM-DD`, oba włącznie,
dni w strefie czasowej raportów, `analytics.reporting_time_zone`, którą moduł
`analytics` posiada i udostępnia przez bramkowany `reportingTimeZonePort` —
domyślnie `UTC`, a gdy `analytics` jest wyłączony, też `UTC`: krawędź
`degrades-without`, sprawdzana przed portem w `services/reporting-time-zone.ts`) oraz opcjonalnie `templateId`, `organizationId` i `projectManagerId`;
okres kończący się przed początkiem to `400`. Każda odpowiada
`{ from, to, projectCount, excluded: { noValue }, data }`: `projectCount` to
liczba projektów, które okres i filtry wybierają dla danego wskaźnika spośród
tych, które wywołujący może zobaczyć, a `excluded.noValue` — ile z nich
wskaźnik kwot pominął, bo nie miały wartości.

Kształty żądań i odpowiedzi to schematy Zod z `@endora-commerce/contracts`
(`projects.ts`).

### Strażnicy etapów i zdarzenia

Moduł lub wdrożenie odrzuca przejście, zamknięcie albo ponowne otwarcie,
rejestrując strażnika w `projectStageGuardRegistry`
(`ProjectStageGuardRegistryPort` z `@endora-commerce/contracts`) z haka
startowego służącego wyłącznie do kontrybucji i deklarując krawędź jako
`contributes-to`. Strażnik jest pytany — z projektem, etapami i rodzajem
(`move`, `close_completed`, `close_lost`, `reopen`) — zanim cokolwiek zostanie
zapisane, i odpowiada `{ allow: true }` albo `{ allow: false, reason }`;
odmowa to `409` `PROJECT_GUARD_REFUSED` z uzasadnieniem jako komunikatem.
Strażnik wyłączonego modułu jest pomijany.

Po każdym zatwierdzonym zapisie moduł emituje, jeden raz:
`projects.project.created.v1`, `projects.stage.moved.v1` (z nazwami etapów
takimi, jakie wtedy były), `projects.project.closed.v1` (z wynikiem, etapem i —
przy utracie — kodem powodu utraty), `projects.project.reopened.v1` oraz
`projects.record.linked.v1` / `projects.record.unlinked.v1` (z projektem,
rodzajem dokumentu i jego identyfikatorem). Podpięcie i odpięcie to audytowane
polecenia `projects.project.link_add` i `.link_remove`.

Każda zmiana roli projektowej lub powodu utraty to jedno audytowane polecenie —
`projects.role.create`, `.update`, `.archive`, `.restore`, `.delete` z
`objectType: 'project_role'` oraz to samo w `projects.loss_reason.*` z
`objectType: 'project_loss_reason'`.

### Kontekst zadań `project`

Moduł jest właścicielem typu kontekstu zadań `project`, rejestrowanego w
`taskContextRegistry` modułu Zadania z haka startowego służącego wyłącznie do
kontrybucji (zob. stronę Zadań, *Konteksty zadań*). Zadanie projektu ma
`contextType: 'project'`, identyfikator projektu jako `contextId` i
identyfikator jednego z jego etapów jako `contextGroupId`; jego etykieta to
`<numer> <tytuł>`, odnośnik prowadzi do `/projects/:id`, a etykietą grupy jest
nazwa etapu. Każda odpowiedź przechodzi przez `ProjectAccess`, więc moduł
Zadania pokazuje zadania projektu dokładnie tym osobom, które mogą zobaczyć
projekt. Aby umieścić zadanie w etapie, utwórz je przez
`POST /api/v1/admin/tasks` z tym kontekstem. `canChangeTasks` deskryptora
odpowiada „tak” tylko posiadaczowi `projects:write`, który widzi projekt, więc
umieszczenie zadania w projekcie, wyjęcie go z projektu i usunięcie jednego z
jego zadań wymagają tego uprawnienia obok `tasks:write`; przeniesienie zadania
między etapami projektu — nie.

Moduł odczytuje i zapisuje zadania wyłącznie przez `taskReadPort` i
`taskWritePort`, po ustaleniu, że moduł Zadania jest obecny (krawędzie
`degrades-without`). Zadania etapu są tworzone po zatwierdzeniu własnej
transakcji przejścia, każde przez osobne audytowane polecenie
`tasks.task.create`, każde z identyfikatorem definicji zadania etapu jako
`sourceKey`: `createMany` tworzy klucz, którego projekt jeszcze nie ma, a dla
klucza, który już ma, zwraca identyfikator istniejącego zadania, więc
ponowienie jest idempotentne. Dlatego `created` w odpowiedzi
`materialize-tasks` liczy zadania etapu po ponowieniu, łącznie z tymi
z wcześniejszych prób.

Deskryptor implementuje też `existingContexts(ids)`, na które odpowiada
`ProjectAccess.existingWithStages` — jedno zapytanie po `projects`
i `project_stages`, udzielające odpowiedzi tylko aktorowi systemowemu. Przebieg
porządkujący modułu Zadania wywołuje je, aby znaleźć zadania projektów i etapów
usuniętych przy wyłączonym module Zadania (zob. stronę modułu Zadania, *Konteksty
zadań*).

Notatka nieprzypisanego zadania etapu jest zapisywana jako
rola odpowiedzialna (`role:<id>`), a nie jako zdanie; `renderNote` deskryptora
formułuje ją w języku każdego czytającego.

### Notatki, wiadomości, odwołania i załączniki

Notatka lub wiadomość to wiersz `project_comments`, a jej odwołania — indeks w
`project_references` (`source_kind` `description` lub `comment`) odbudowywany
przez polecenie zapisujące tekst — `projects.project.note_add`, `.note_update`,
`.note_delete`, `.message_add` oraz `.create` i `.update` samego projektu. Wpisy
dziennika zawierają identyfikator, rodzaj i długość komentarza, nigdy jego
treść: dziennik zmian nie jest ograniczony do dzierżawcy. Odwołania są
rozwiązywane przy każdym odczycie, jednym wywołaniem na rodzaj, przez porty i
uprawnienia do odczytu ich właścicieli — `orderReadPort`,
`quoteRequestReadPort` i `opportunityReadPort` (oba przez `linked-records.ts`),
`taskReadPort` (przez `project-tasks.ts`, po `present()`),
`catalogProductReadPort` i `adminUserReadPort`; przywołany projekt jest czytany
przez `ProjectAccess`, więc widzi go tylko ktoś, kto może go zobaczyć.

Powiadomienia przechodzą przez `adminNotificationRecordPort` (krawędź
`degrades-without`: obecność modułu jest rozstrzygana najpierw i nic nie jest
przechwytywane) z rodzajami `projects.project.message` i
`projects.project.mention`, przedmiotem `project`, i są zapisywane dopiero po
zatwierdzeniu zapisu; każdy odbiorca jest najpierw sprawdzany przez
`ProjectAccess.canSeeAs`. Tytuł wpisu dzwonka wskazuje projekt numerem, a autora
imieniem i nazwiskiem, i jest tłumaczony przez `notifications.<key>.title` z
pakietu tego modułu.

Załącznik to identyfikator zasobu w `project_attachments`, odczytywany przez
`assetReadPort` i pobierany przez odnośnik podpisany przez `assetsLibraryPort`.
Moduł rejestruje w `assetReferenceRegistry` skaner z haka rozruchowego służącego
wyłącznie do wkładu, bez sprawdzania obecności — dzięki temu biblioteka nie
usunie pliku, którego używa projekt (`kind` `project_attachment`, etykieta
`Project PRJ-…`), także przy wyłączonym module Projekty — oraz w
`auditReferenceRegistry` resolver dla `project`, dzięki któremu dziennik zmian
nazywa numerem i tytułem projekt, który czytający może widzieć.

### Alerty o terminach

Jeden harmonogram zadań BullMQ, `projects-stage-alerts`, co piętnaście minut, z
zadaniem bez danych i jednym konsumentem naraz w procesie, podłączany przez
`ctx.worker` tylko w procesie uruchamiającym workery
(`workers/stage-alert-worker.ts`). Każde wywołanie najpierw rozstrzyga obecność
modułu, potem zadaje jednobitowe pytanie poza jakimkolwiek zakresem tenanta
(`anyRowExists`, przez kopię `scheduled-work-probe.ts` w module) i wchodzi w
zakres systemowy tylko wtedy, gdy coś przypada — wywołanie bez pracy nie
zapisuje wpisu audytu `tenant.escape_hatch`.

Przebieg (`services/stage-alert-service.ts`) rezerwuje każdy alert
przypadający dziś w strefie alertów, od 8:00: jeden wiersz
`project_stage_alert_deliveries` na (etap, liczba dni, termin), wstawiany z
`on conflict do nothing` wobec tego unikalnego klucza i zatwierdzany, zanim
cokolwiek zostanie dostarczone — dwa przebiegi naraz rezerwują więc każdy alert
raz, a przesunięty termin to nowy klucz. Dostarczanie odbywa się poza
transakcją: każdy członek jest sprawdzany przez `ProjectAccess.canSeeAs`,
powiadamiany przez `adminNotificationRecordPort` (rodzaj
`projects.project.stage_deadline`, przedmiot `project`, zdanie
`notifications.stageDeadline.title`) oraz e-mailem transakcyjnym
`projects_stage_deadline_alert` (zmienne `project.number`, `stage.name`,
`stage.deadline`, `alert.daysLeft`; domyślna treść po angielsku i po polsku
przekazywana do `emailDefaultsPort` z haka startowego służącego wyłącznie do
wkładu). Następnie wiersz otrzymuje wynik — `bell_email`, `bell`, `email`,
`no_recipient` albo `undeliverable` — i liczbę powiadomionych członków.
Rezerwacja, której dostarczenie nie powiodło się, zanim cokolwiek wyszło, wraca
do następnego wywołania; proces, który zginie między rezerwacją a zapisem
wyniku, zostawia alert, który nigdy nie zostanie wysłany dwa razy. Instrukcje
rezerwacji i zapisu wyniku przechodzą przez Command Bus bez wpisu audytu: to
ewidencja, a nie zmiana projektu.

### Podpięte dokumenty i ich właściciele

Powiązanie przechowuje dokument przez wartość i zapamiętuje jego organizację,
odczytaną od właściciela raz, w chwili podpięcia; klucz obcy z `project_links`
do organizacji projektu nie pozwala usunąć tej organizacji, dopóki dokument jest
podpięty. Dokumenty są odczytywane przez opublikowane porty ich właścicieli —
`orderReadPort` (zależność wiążąca), `quoteRequestReadPort` i
`opportunityReadPort` (oba `degrades-without`) — zawsze w zasięgu wywołującego,
a obecność wyłączalnego właściciela jest ustalana, zanim zapyta się jego port.

### Pola niestandardowe

*Projekt* to typ rekordu `project` modułu `custom_fields`
(`SUPPORTED_ENTITIES.project`: właściciel `projects`, należy do organizacji,
filtr listy, bez celów przenoszenia); jego wartości to kolumna
`custom_field_values` tabeli `projects`. Moduł sprawdza i scala zestaw wartości
przez `customFieldValueService.validateAndMerge` przed poleceniem, które go
zapisuje, a wartości projektu zwraca przez `project()`, który pomija wartość
pola usuniętego; filtr listy to warunek na identyfikatorach z
`customFieldListFilterPort`, przecięty ze zbiorem widocznych projektów.
`custom_fields` to zależność wiążąca i nie można go wyłączyć. Wpis dziennika
zdarzeń wymienia pola niestandardowe zmienione przez zapis
(`changedCustomFields`), nigdy ich wartości; wartości przed zmianą i po niej to
wiersz `project_value_changes`, na który wpis wskazuje (`valueChangeId`),
zapisany w tym samym poleceniu. `GET /projects/:id/history` zwraca wartości w
miejsce nazw, jedne i drugie tylko czytelnikowi z uprawnieniem
`custom_fields:read`.

### Analityka

Każdy wskaźnik to jedno zapytanie SQL z grupowaniem na `projects` — a dla czasu
na etapie i etapu utraty także na `project_stage_entries`, których wiersze
zachowują nazwy etapów takie, jakie były — z predykatem `ProjectAccess` dla
czytelnika; czytelnik bez dostępu do żadnej organizacji dostaje puste wskaźniki
i żadne zapytanie nie jest wykonywane. Nic nie jest czytane projekt po
projekcie: nazwisko kierownika projektu i karta najcenniejszego projektu są
czytane potem, dla kilku wierszy, które zwróciło zapytanie. Usługa to
`services/analytics-service.ts`, zakres i proporcje — `domain/analytics-range.ts`.

### Odczyt projektów z innego modułu

`projectReadPort` (`ProjectReadPort` z `@endora-commerce/contracts`) to jedyne
wejście, przez które inny moduł, moduł nakładkowy lub wdrożenie odczytuje
projekty. Jest bramkowany: rozwiązanie go przy wyłączonym module Projekty
zgłasza błąd, a wywołanie odpowiada `503` `MODULE_DISABLED` — rozwiązuj go
przez `lazyPort` i deklaruj krawędź jako `degrades-without` ze zdaniem
`whenAbsent`.

| Metoda | Co zwraca |
| --- | --- |
| `findById(id)` | Projekt jako `ProjectRecord` — `id`, `number`, `title`, `state`, `currentStageId`, `currentStageName`, `organizationIds`, `valueAmount`, `valueCurrency`, `templateId`, `closedAt`, `createdAt` — albo `null`. |
| `findByRecord(kind, id)` | Projekt, do którego podpięto `order`, `quote_request` lub `opportunity`, jako `ProjectRecord`, albo `null`. |

Obie metody odpowiadają w imieniu wywołującego, przez `ProjectAccess` w jego
własnym kontekście dzierżawy: projekt, który nie istnieje, projekt poza
zasięgiem wywołującego i projekt, którego nie może on zobaczyć, to ten sam
`null`. Odpowiedź jest zwykłym obiektem, nigdy encją.

`./backend` eksportuje też **`nextProjectNumber(em)`** — wejście modułu do jego
sekwencji numerów: kolejny numer `PRJ-…` dla kodu, który zapisuje projekty bez
polecenia (Command), na przykład dla kompozycji demo; jeden format i jedna
sekwencja, niezależnie od tego, kto tworzy projekt.

### Jedna ścieżka odczytu

Każda tabela należąca do projektu jest sklasyfikowana jako **rule-scoped**:
żaden filtr ORM jej nie zawęża, a moduł sam egzekwuje obie reguły z sekcji *Kto
widzi projekt*, w jednym miejscu — w usłudze `ProjectAccess`. Każda lista,
liczba i odczyt po identyfikatorze w module albo zawiera jej predykat SQL, albo
zaczyna od projektu, który ona zwróciła, a własny test modułu odrzuca odczyt
tabeli projektu w każdym innym miejscu. Kod dodawany do tego modułu odczytuje
projekty przez nią.
