---
title: crm
description: Szanse sprzedażowe z konfigurowalnym przepływem statusów, za którym podążają powiązane zamówienia
---

# `crm`

Moduł CRM prowadzi **szanse sprzedażowe**: transakcje, nad którymi
handlowiec pracuje z jedną organizacją klienta — od pierwszego kontaktu do chwili, gdy szansa zostaje wygrana albo przegrana.

## Co robi

Szansa należy do dokładnie jednej organizacji i przechodzi przez **przepływ
statusów** konfigurowany przez operatora: zbiór statusów oraz dozwolonych
przejść między nimi. Każdy status jest jednego z trzech rodzajów:

- **open** — nad szansą nadal trwa praca;
- **won** — szansa jest zamknięta, a transakcja doszła do skutku;
- **lost** — szansa jest zamknięta bez transakcji.

Świeża instalacja zaczyna od domyślnego przepływu sześciu statusów:

| Kod | Rodzaj | Przechodzi do |
| --- | --- | --- |
| `new` (status początkowy) | open | `qualified`, `lost` |
| `qualified` | open | `proposal`, `lost` |
| `proposal` | open | `negotiation`, `won`, `lost` |
| `negotiation` | open | `won`, `lost` |
| `won` | won | — |
| `lost` | lost | `new` |

Zamknięta szansa nie musi być zakończona: ze statusu `lost` można wrócić do
`new`, więc transakcję, która odżywa, otwiera się ponownie, zamiast wprowadzać
ją od nowa.

Szanse są widoczne zgodnie z organizacjami, które administrator może
oglądać. Administrator ograniczony do wybranych organizacji widzi wyłącznie
ich szanse; z jego perspektywy szansa innej organizacji nie istnieje.

## W Admin UI

Moduł dodaje do menu bocznego grupę **CRM**, bezpośrednio pod grupą
*Sprzedaż*. Administrator widzi te pozycje, na które pozwala jego rola, a samą
grupę — tylko wtedy, gdy widoczna jest przynajmniej jedna z nich.

| Ekran | Gdzie | Uprawnienie | Do czego służy |
| --- | --- | --- | --- |
| Szanse sprzedażowe | **CRM → Szanse sprzedażowe** (`/crm/opportunities`) | `crm:read` | Wszystkie szanse, które możesz zobaczyć, z wyszukiwaniem i filtrami: stan, status, organizacja, handlowiec, etykiety, kanał sprzedaży i data utworzenia. |
| Nowa szansa | przycisk **Nowa szansa** (`/crm/opportunities/new`) | `crm:write` | Ręczne utworzenie szansy: tytuł, organizacja i waluta są wymagane; osoba kontaktowa, kanał sprzedaży, szacowana wartość, planowana data zamknięcia i opis — opcjonalne. |
| Szansa sprzedażowa | wiersz listy (`/crm/opportunities/:id`) | `crm:read` | Nagłówek, pasek etapów z obecnym statusem i dozwolonymi z niego zmianami — wstecz i dalej — panel informacji po prawej oraz karty: *Przegląd*, **Powiązania** (zamówienia i zapytania ofertowe szansy), **Wydarzenia** (to, co dla niej zaplanowano, z przypomnieniami), *Notatki*, *Wiadomości*, *Załączniki* i **Historia zmian**. Zobacz *Ekran szansy sprzedażowej*. |
| Tablica | **CRM → Tablica** (`/crm/board`) | `crm:read` | Te same szanse jako karty, w kolumnie dla każdego statusu. Posiadacz uprawnienia `crm:write` przenosi kartę do innego statusu. |
| Kalendarz | **CRM → Kalendarz** (`/crm/calendar`) | `crm:read` | Wydarzenia zaplanowane w otwartych szansach, które możesz zobaczyć — w miesiącu, tygodniu, dniu albo jako lista. Każde wydarzenie otwiera swoją szansę. Zobacz *Kalendarz*. |
| Analityka | **CRM → Analityka** (`/crm/analytics`) | `crm:analytics` | Pięć wskaźników dla wybranego zakresu dni: czas obsługi, czas w każdym statusie, najskuteczniejsi handlowcy, najcenniejsze szanse i średnia wartość. |
| Etykiety | **CRM → Etykiety** (`/crm/tags`) | `crm:configure` | Lista etykiet: dodawanie, zmiana nazwy i koloru oraz usuwanie oznaczeń, które można nadawać szansom. |
| Statusy i przepływ | **CRM → Statusy i przepływ** (`/crm/workflow`) | `crm:configure` | Statusy, przejścia między nimi, status zamówienia ustawiany przez każdy status szansy, status szansy, do którego prowadzi każdy status zamówienia, statusy liczone do wartości wyliczanej oraz pola widoczne na karcie na tablicy. |

Codzienne ekrany są też w palecie poleceń (`⌘K` / `Ctrl+K`):
**Szanse sprzedażowe**, **Nowa szansa sprzedażowa**, **Tablica szans
sprzedażowych**, **Analityka CRM** i **Kalendarz CRM**.

Pierwsze przejście przez moduł, od początku do końca:

1. Na ekranie **Statusy i przepływ** sprawdź statusy — który jest początkowy,
   które zamykają szansę jako wygraną lub przegraną — oraz strzałki między
   nimi. W sekcji *Status zamówienia dla każdego statusu szansy* wybierz, co
   każdy status ma zrobić z powiązanym zamówieniem, i zapisz.
2. Na ekranie **Szanse sprzedażowe** kliknij **Nowa szansa**, podaj tytuł,
   organizację i walutę, a następnie utwórz szansę. Trafisz na jej ekran.
3. Na karcie **Powiązania**, w sekcji *Powiązane zamówienia*, wyszukaj
   zamówienie tej organizacji po numerze i je powiąż. Będzie podążać za
   statusem szansy, chyba że to dla niego odznaczysz.
4. Na pasku etapów u góry kliknij status, na który chcesz zmienić. Widać tylko
   zmiany dozwolone przez przepływ z obecnego statusu, w grupach *Wstecz*
   i *Dalej*.
5. W sekcji *Zmiany statusów zamówień*, pod paskiem, przeczytaj, co stało się
   z każdym powiązanym zamówieniem. Zamówienie, którego nie udało się przenieść, jest
   tam wymienione z przyczyną i dwoma przyciskami: **Ponów** i **Pomiń**;
   pozostaje tam przy każdej kolejnej wizycie, dopóki handlowiec nie użyje
   jednego z nich.

Administrator, który może tylko przeglądać, widzi te same ekrany bez
elementów, które cokolwiek zmieniają.

## Ekran szansy sprzedażowej

Pod nagłówkiem ekran jednej szansy ma dwie kolumny: po lewej to, nad czym
pracujesz — jej status, a pod nim karty — a po prawej, obok tego wszystkiego,
panel z informacjami o niej.

**Nagłówek** zawiera tytuł ze statusem obok, a pod nim jeden dyskretny wiersz:
numer, organizację, osobę prowadzącą szansę — albo *Nieprzypisana* — oraz kanał
sprzedaży, jeśli jest ustawiony. Po prawej są przyciski **Edytuj**
(`crm:write`) i **Usuń** (`crm:configure`).

**Pasek etapów**, na górze lewej kolumny, podaje **obecny status** i pokazuje,
dokąd szansa może z niego przejść — i nic więcej. Przepływ nie jest prostą
linią, więc pasek jej nie rysuje: statusu, na który Twój przepływ nie pozwala
z obecnego miejsca, nie ma na ekranie.

- **Wstecz** to zmiany na status wcześniejszy w kolejności ustawionej na
  ekranie **CRM → Statusy i przepływ** oraz zmiany, które ponownie otwierają
  zamkniętą szansę.
- **Dalej** to zmiany na status późniejszy oraz każda zmiana zamykająca szansę,
  oznaczona jako *wygrana* albo *przegrana* — niezależnie od tego, które
  miejsce status zamykający zajmuje na Twojej liście.
- Strona, po której nie ma żadnej zmiany, nie jest pokazywana. Gdy przepływ nie
  pozwala na żadną zmianę, pasek o tym informuje; przy zamkniętej szansie widać
  też, jak i kiedy została zamknięta.
- Dla posiadacza uprawnienia `crm:write` **każda zmiana jest przyciskiem**,
  a jego naciśnięcie to ta sama zmiana statusu, z tymi samymi regułami, co
  w pozostałych miejscach modułu. Opcjonalny **powód** wpisuje się w polu pod
  paskiem. Osoba mająca tylko `crm:read` widzi te same zmiany jako zwykły tekst.
- **Pasek nie udaje historii i nie liczy etapów.** Mówi, gdzie szansa jest
  i dokąd może przejść; gdzie była, mówi karta *Historia zmian*.
- Jeśli nie uda się wczytać kolejności statusów, wszystkie zmiany nadal są
  dostępne: zamykające szansę w grupie *Dalej*, pozostałe w grupie *Możliwe
  zmiany*, z informacją, że nie udało się ich uporządkować.

To, co stało się z powiązanymi zamówieniami po zmianie statusu — oraz każda
zmiana, której zamówienie odmówiło, dopóki nie zostanie ponowiona albo
pominięta — jest wypisane bezpośrednio pod paskiem, niezależnie od otwartej
karty.

**Karty**, pod nim w lewej kolumnie:

| Karta | Co na niej jest |
| --- | --- |
| **Przegląd** | Opis, pola niestandardowe oraz — po naciśnięciu **Edytuj** — formularz edycji. |
| **Powiązania** | *Powiązane zamówienia* i *Powiązane zapytania ofertowe*: wiązanie, odłączanie, przełącznik *Podąża za szansą*, przyciski **Utwórz zamówienie** i **Utwórz zapytanie ofertowe**. Na karcie widać liczbę powiązanych dokumentów. |
| **Wydarzenia** | To, co zaplanowano dla szansy — rozmowa, spotkanie, termin — jako lista i we własnym kalendarzu, każde z opcjonalnym przypomnieniem. Na karcie widać liczbę wydarzeń, które jeszcze się nie zakończyły. Zobacz *Wydarzenia i przypomnienia*. |
| **Notatki**, **Wiadomości** | Dwie rozmowy. Na karcie **Notatki** widać liczbę notatek, a na karcie **Wiadomości** — liczbę wiadomości, których jeszcze nie przeczytałeś. |
| **Załączniki** | Pliki. Na karcie widać liczbę załączonych plików. |
| **Historia zmian** | Wszystko, co zrobiono z szansą, od najnowszych zmian. |

**Liczba przy etykiecie karty** mówi, ile się za nią kryje, a karta, za którą
nic się nie kryje, nie pokazuje liczby — liczba zawsze więc oznacza, że jest co
otworzyć. Na kartach *Powiązania*, *Notatki* i *Załączniki* jest to liczba
pozycji: powiązanych dokumentów, notatek, plików. Na karcie *Wydarzenia* —
liczba wydarzeń, które jeszcze się nie zakończyły. Na karcie *Wiadomości* —
liczba wiadomości, których jeszcze nie przeczytałeś; zobacz *Notatki i
wiadomości wewnętrzne*. Liczby przychodzą razem z szansą, są więc widoczne,
zanim otworzysz którąkolwiek kartę, a każda zmienia się, gdy dodasz lub usuniesz
pozycję na jej karcie. To, co w tym czasie doda ktoś inny, pojawi się po
odświeżeniu strony. Czytnik ekranu odczytuje każdą liczbę razem z tym, co ona
liczy — „Notatki, liczba pozycji: 3”, „Wydarzenia, nadchodzące: 2”,
„Wiadomości, nieprzeczytane: 1”.

Otwarta karta jest częścią adresu — `/crm/opportunities/:id?tab=links`,
i odpowiednio `events`, `notes`, `messages`, `attachments` oraz `history` — dzięki czemu
zostaje po odświeżeniu strony i można ją wysłać innej osobie. Adres bez nazwy
karty albo z nazwą karty, która nie istnieje, otwiera *Przegląd*. Powrót z
ekranu **Utwórz zamówienie** albo **Utwórz zapytanie ofertowe** otwiera kartę
**Powiązania**, na której pojawia się nowy dokument.

**Informacje**, w jednym panelu po prawej — od nagłówka w dół, obok paska
etapów i dowolnej otwartej karty — każda jako mała etykieta nad wartością. Na
wąskim ekranie panel jest po pasku etapów, a przed kartami, więc wartość
i termin nigdy nie trafiają pod długą kartę:

| Grupa | Informacje | Co można tu zmienić |
| --- | --- | --- |
| **Wartość i termin** | Wartość oraz to, czy jest wpisana ręcznie, czy wyliczana; planowana data zamknięcia. | Sposób ustalania wartości, jednym przyciskiem. |
| **Klient i handlowiec** | Organizacja (odnośnik do jej ekranu), osoba kontaktowa, handlowiec. | Handlowca. |
| **Klasyfikacja** | Kanał sprzedaży, źródło szansy, jej etykiety. | Etykiety. |
| **Rekord** | Numer, data utworzenia i ostatniej zmiany oraz — po zamknięciu — data zamknięcia. | — |

Informacja bez wartości jest pokazana jako pusta, a nie pominięta. Wszystko,
czego nie zmienia się w samym panelu — tytuł, opis, osobę kontaktową, kanał
sprzedaży, planowaną datę zamknięcia i kwotę — zmienia się przyciskiem
**Edytuj**.

## Konfigurowanie przepływu

Przepływ należy do operatora. Status ma **kod** (małe litery, cyfry
i podkreślenia; po utworzeniu nigdy się nie zmienia), nazwę w każdym języku,
rodzaj, kolor oraz wagę, która ustala jego kolejność na ekranie. Dokładnie
jeden status jest **statusem początkowym** — tym, w którym zaczyna nowa
szansa — i musi to być status otwarty.

Przejście to skierowany krok z jednego statusu do drugiego. Szansa może
wykonać tylko skonfigurowany krok, więc zbiór przejść wyznacza to, co kontrolka
statusu proponuje handlowcowi. Status zamykający może mieć
przejścia wychodzące: ponowne otwarcie jest przejściem jak każde inne. Na
ekranie **Statusy i przepływ** przejścia są narysowane jako graf; nowe dodaje
się, wybierając jego dwa końce pod grafem albo klikając **Połącz** i dwa
statusy, a usuwa — zaznaczając jego strzałkę.

Zmiana, która zepsułaby przepływ, jest odrzucana, a odmowa wskazuje regułę,
którą by naruszyła:

| Reguła | Co chroni |
| --- | --- |
| `exactly_one_initial` | Status początkowy jest jeden — nigdy żaden i nigdy dwa. |
| `initial_must_be_open` | Nowa szansa nie zaczyna jako zamknięta. |
| `won_status_required` | Szansę zawsze da się zamknąć jako wygraną. |
| `lost_status_required` | Szansę zawsze da się zamknąć jako przegraną. |
| `transition_unknown_status` | Przejście łączy dwa istniejące statusy. |
| `mapping_unknown_status` | Mapowanie wskazuje istniejący status szansy. |
| `mapping_duplicate` | Status szansy mapuje się na jeden status zamówienia, a nie na kilka. |
| `mapping_duplicate_order_status` | Status zamówienia przesuwa szansę do jednego statusu, a nie do kilku. |

Statusu, w którym znajdują się szanse, nie można usunąć ani zmienić jego
rodzaju; najpierw trzeba przenieść szanse. Statusu początkowego również nie
można usunąć — należy oznaczyć inny status jako początkowy, a dopiero potem
usunąć ten. Usunięcie statusu usuwa razem z nim jego przejścia i mapowania.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/workflow` | `crm:read` | Skonfigurowane statusy wraz z liczbą szans w każdym z nich, przejścia między nimi, mapowania statusów zamówień oraz statusy liczone do wartości wyliczanej. |
| `POST /api/v1/admin/crm/statuses` | `crm:configure` | Dodanie statusu. |
| `PATCH /api/v1/admin/crm/statuses/:code` | `crm:configure` | Zmiana nazwy lub koloru statusu, zmiana jego rodzaju albo oznaczenie go jako początkowego. |
| `DELETE /api/v1/admin/crm/statuses/:code` | `crm:configure` | Usunięcie statusu, w którym nie ma żadnej szansy. |
| `PUT /api/v1/admin/crm/transitions` | `crm:configure` | Dodawanie i usuwanie przejść. |
| `PUT /api/v1/admin/crm/order-status-mappings` | `crm:configure` | Zastąpienie zbioru mapowań statusów zamówień. |
| `PUT /api/v1/admin/crm/value-counting-statuses` | `crm:configure` | Zastąpienie statusów liczonych do wartości wyliczanej (zob. *Które statusy się liczą*). |

Każdy z tych zapisów zwraca cały przepływ w stanie po zmianie — poza ostatnim,
który odpowiada `202` (zob. *Które statusy się liczą*).

## Praca z szansą

Szansę tworzy się dla jednej organizacji i w jednej walucie; żadnej z nich nie
można później zmienić. Szansa otrzymuje własny numer (`OPP-000123`) i zaczyna
w statusie początkowym. Może mieć opis, osobę kontaktową — która musi należeć
do tej organizacji — kanał sprzedaży, wartość oraz przewidywaną datę
zamknięcia.

Przeniesienie szansy zapisuje, kto ją przeniósł, kiedy, z którego statusu do
którego oraz powód, jeśli został podany. Wejście w status rodzaju **won** lub
**lost** zamyka szansę i zapisuje ten moment; wyjście z takiego statusu otwiera
ją ponownie.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities` | `crm:read` | Lista z wyszukiwaniem (tytuł, numer, nazwa organizacji), filtrami według statusu, stanu (`open` / `won` / `lost`), organizacji, handlowca, etykiet, kanału sprzedaży i daty utworzenia, z sortowaniem i stronicowaniem. |
| `POST /api/v1/admin/crm/opportunities` | `crm:write` | Utworzenie szansy. |
| `GET /api/v1/admin/crm/opportunities/:id` | `crm:read` | Jedna szansa wraz ze statusami, do których może przejść, powiązanymi zamówieniami i każdą odrzuconą zmianą zamówienia. |
| `PATCH /api/v1/admin/crm/opportunities/:id` | `crm:write` | Edycja. Odczytaną wersję należy przesłać w nagłówku `If-Match`; nieaktualna jest odrzucana kodem `409`, a nagłówek, który nie jest wersją — w cudzysłowie, jak podaje ją `ETag`, albo bez — kodem `400`. |
| `DELETE /api/v1/admin/crm/opportunities/:id` | `crm:configure` | Usunięcie szansy razem z jej powiązaniami i historią. |
| `POST /api/v1/admin/crm/opportunities/:id/transition` | `crm:write` | Przeniesienie szansy do innego statusu. |

## Edycja i usuwanie szansy

Na ekranie szansy przycisk **Edytuj** — w nagłówku, dla posiadacza
uprawnienia `crm:write` — otwiera formularz na karcie *Przegląd*, niezależnie
od tego, która karta była otwarta: tytuł,
opis, osoba kontaktowa, kanał sprzedaży, planowana data zamknięcia i
wartość. Organizacja i waluta są pokazane i nie można ich zmienić. Wartość jest
**wpisana ręcznie** albo **wyliczana z powiązanych dokumentów**; wpisana kwota
zostaje zachowana na czas pokazywania wyliczonej.

Zapis wysyła tylko zmienione pola. Jeśli szansa została w międzyczasie
zmieniona — przez inną osobę albo przez zmianę statusu wykonaną przez Ciebie
przy otwartym formularzu — nic nie zostaje zapisane, a formularz o tym
informuje: naciśnij **Wczytaj szansę ponownie**, aby zobaczyć aktualną wersję,
i wprowadź zmiany jeszcze raz. Nic nie jest nadpisywane po cichu.

Zmiana statusu może mieć **powód**: wpisz go w polu pod paskiem etapów,
zanim naciśniesz status. Powód jest opcjonalny i zostaje zapisany razem
ze zmianą.

**Usuń**, w nagłówku ekranu, jest dla posiadacza uprawnienia `crm:configure`.
Najpierw pyta o potwierdzenie, a następnie usuwa szansę razem z historią
statusów i powiązaniami; same powiązane zamówienia pozostają bez zmian.

## Tablica

**CRM → Tablica** pokazuje szanse, które możesz zobaczyć, jako karty — po
jednej kolumnie dla każdego statusu, w kolejności przepływu. Nagłówek kolumny
podaje liczbę szans w tym statusie i ich wartość, osobną sumę dla każdej
waluty; karta pokazuje tytuł szansy oraz pola wybrane dla karty — dopóki nikt
ich nie zmieni: numer, organizację, wartość, osobę, do której jest przypisana,
oraz etykiety (zob. *Co pokazuje karta* poniżej). Tytuł na karcie otwiera
szansę.

Kartę można przenieść do innego statusu na dwa sposoby i oba robią dokładnie
to samo, co pasek etapów na ekranie szansy — łącznie z powiązanymi
zamówieniami:

- **Przeciągnij ją** do innej kolumny: myszą; na ekranie dotykowym — po
  krótkim przytrzymaniu karty; albo klawiaturą — ustaw fokus na uchwycie przy
  lewej krawędzi karty, naciśnij spację lub Enter, aby ją podnieść, strzałki w
  lewo i w prawo, aby wybrać kolumnę, spację lub Enter, aby ją upuścić, oraz
  Escape, aby anulować. Gdy karta jest podniesiona, kolumny, do których
  przepływ nie pozwala jej przenieść, są przygaszone i oznaczone, a upuszczenie
  na taką kolumnę niczego nie zmienia.
- **Użyj menu „Przenieś do…” na karcie**, które zawiera dokładnie te statusy,
  na które przepływ pozwala z bieżącego statusu karty. Nie wymaga ono żadnego
  przeciągania.

Karta przenosi się od razu. Jeśli zmiana zostanie odrzucona — przepływ już na
nią nie pozwala, zablokowała ją reguła biznesowa albo ktoś przeniósł szansę
wcześniej — karta wraca do swojej kolumny, a przyczyna pojawia się nad tablicą.
Jeśli zmiana się powiedzie, ale powiązane zamówienie nie mogło za nią podążyć,
szansa pozostaje przeniesiona: karta zostaje oznaczona, a powiadomienie nad
tablicą wymienia każde takie zamówienie z przyczyną i prowadzi do szansy, gdzie
zmianę można ponowić albo pominąć.

Pole wyszukiwania oraz filtry organizacji, handlowca, etykiet, kanału sprzedaży
i daty utworzenia są takie same jak na liście i zawężają każdą kolumnę — jej
karty, liczbę i sumy. Kolumna, która zawiera więcej szans, niż pokazuje, podaje
ich liczbę i ma przycisk **Pokaż więcej**.

Tablica nigdy nie jest wyższa niż okno: kolumna z wieloma kartami przewija się
osobno, pod nagłówkiem, który zostaje na miejscu, więc pozostałe kolumny są
cały czas pod ręką. Przepływ, który ma więcej statusów, niż mieści się obok
siebie, przewija się w poziomie — paskiem przewijania pod tablicą, gestem
przesunięcia albo strzałkami, gdy fokus jest na samej tablicy.

Administrator, który może tylko przeglądać, widzi tablicę bez uchwytów i bez
menu.

### Co pokazuje karta

Karta zawsze pokazuje tytuł szansy. To, co widać pod tytułem, wybierasz
samodzielnie: na ekranie **CRM → Statusy i przepływ** sekcja **Karta na
tablicy** zawiera listę pól widocznych na karcie, w kolejności, oraz pola,
które można dodać. Osoba, która może konfigurować CRM, trafia tam również z
tablicy, przyciskiem **Pola na karcie**.

- **Pola szansy sprzedażowej**: numer, organizacja, osoba kontaktowa,
  handlowiec, wartość, kanał sprzedaży, etykiety, planowana data zamknięcia,
  źródło (utworzona ręcznie, z zamówienia albo z zapytania ofertowego), daty
  utworzenia, ostatniej zmiany i zamknięcia oraz liczba powiązanych zamówień i
  powiązanych zapytań ofertowych — ta ostatnia tylko wtedy, gdy moduł Zapytań
  ofertowych jest włączony.
- **Pola niestandardowe**: każde pole zdefiniowane dla szans sprzedażowych na
  ekranie **Pola niestandardowe**. Zdefiniuj tam „Źródło pozyskania”, dodaj je
  tutaj — i jest na karcie.

Karta pokazuje **najwyżej sześć** pól poza tytułem, żeby dało się ją odczytać
jednym spojrzeniem; sekcja podaje, ile pól wybrano, i przestaje proponować
kolejne, gdy karta jest pełna. Przyciski **Przesuń wyżej** i **Przesuń niżej**
ustalają kolejność, a nic się nie zmienia, dopóki nie klikniesz **Zapisz**.
Wybór jest jeden dla całej platformy — każdy użytkownik widzi taką samą kartę.

Dopóki nikt tego nie zmieni, karta pokazuje to, co zawsze: numer i
organizację, wartość, handlowca i etykiety. Pole, dla którego szansa nie ma
wartości, nie pojawia się na karcie tej szansy, a długi tekst jest ucinany po
dwóch wierszach. Pole niestandardowe, które zostanie później usunięte, po
prostu znika z kart, z filtrów i z tej sekcji; niczego nie trzeba porządkować.

### Filtrowanie po tym, co pokazują karty

Tablica ma filtr dla każdego pola widocznego na kartach, odpowiedni do rodzaju
pola:

| Pole | Filtr |
| --- | --- |
| Niestandardowe pole tekstowe | tekst, który zawiera |
| Liczba albo kwota — wartość, niestandardowa liczba, liczby powiązanych dokumentów | wartość najmniejsza i największa |
| Data — planowana data zamknięcia, ostatnia zmiana, zamknięcie, niestandardowa data | od dnia, do dnia |
| Tak / nie | tak albo nie; „nie” obejmuje też szanse, w których pola nigdy nie ustawiono |
| Jedna z listy, kilka z listy, źródło | jedna lub więcej opcji; szansa pasuje, gdy ma dowolną z nich |
| Osoba kontaktowa | jedna osoba, po wybraniu organizacji — dla użytkowników, którzy mogą edytować szanse |

Filtry organizacji, handlowca, etykiet, kanału sprzedaży i daty utworzenia są
dostępne zawsze, niezależnie od tego, co pokazuje karta, a pole wyszukiwania
znajduje szansę po numerze. Filtry się łączą:
pokazywane, liczone i sumowane są tylko szanse spełniające wszystkie naraz.
Filtr wartości porównuje kwotę niezależnie od waluty.

**Filtry są zapisane w adresie tablicy.** Odśwież stronę, dodaj ją do zakładek
albo wyślij link współpracownikowi — zostaną zastosowane te same filtry.
Przycisk **Wyczyść filtry** usuwa wszystkie. Link zapisany przed zmianą karty
nadal się otwiera: filtr po polu, którego nie ma już na karcie, jest pomijany.

### Dla integratorów

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/board` | `crm:read` | Po jednej kolumnie dla każdego statusu, w kolejności przepływu: status, `count`, `valueTotals` dla każdej waluty, pierwsze `perColumn` szans (domyślnie 50, najwyżej 200) oraz `hasMore`; a także `cardFields` — pola widoczne na karcie, w kolejności. Przyjmuje filtry listy z wyjątkiem `statusCode` i `state` — także filtr handlowca i filtr etykiet, w tym samym znaczeniu — oraz `fieldFilters`. |
| `GET /api/v1/admin/crm/board/card-fields` | `crm:read` | `fields`: pola widoczne na karcie, w kolejności. `available`: wszystkie pola, które można wybrać. `maxFields`: 6. |
| `PUT /api/v1/admin/crm/board/card-fields` | `crm:configure` | Treść `{ "fields": ["builtin:organization", "custom:lead_source"] }` — odwołania do pól, w kolejności. W odpowiedzi konfiguracja po zmianie. `422` dla odwołania, które nie wskazuje żadnego pola. |

Przeniesienie karty to `POST /api/v1/admin/crm/opportunities/:id/transition`;
tablica nie ma do tego własnej operacji zapisu. Kolejne karty kolumny pochodzą
z punktu końcowego listy, zawężonego do tego statusu.

Pole wskazuje się odwołaniem: `builtin:<klucz>` dla pola szansy (`number`,
`organization`, `contact`, `assignee`, `value`, `salesChannel`, `tags`,
`expectedCloseDate`, `source`, `createdAt`, `updatedAt`, `closedAt`,
`linkedOrders`, `linkedQuoteRequests`) oraz `custom:<klucz pola>` dla pola
niestandardowego.

Każda karta tablicy zawiera `cardValues`: obiekt o kluczach będących
odwołaniami, z wartością każdego wybranego pola, które nie jest już składową
karty — imię i nazwisko osoby kontaktowej, nazwa kanału sprzedaży, źródło,
liczby powiązanych dokumentów i wartości niestandardowe — i żadnego pola,
którego nie wybrano. Punkt końcowy listy zwraca tę samą składową, gdy zostanie
wywołany z `cardValues=true`.

`fieldFilters`, na tablicy i na liście, to zakodowany w adresie obiekt JSON o
kluczach będących odwołaniami: `{"custom:lead_source":{"in":["referral"]},"builtin:value":{"min":"1000"}}`.
Operatory to `contains` (tekst), `min` / `max` (liczby i kwoty, jako napisy
dziesiętne), `from` / `to` (daty, `YYYY-MM-DD`, oba dni włącznie), `is` (tak /
nie) oraz `in` (opcje oraz identyfikator konta klienta osoby kontaktowej).
Odwołanie do pola, którego nie ma na karcie, jest pomijane; parametr, który
nie jest poprawnym obiektem JSON tej postaci, kończy się odpowiedzią `400`.

## Wiązanie zamówień

Istniejące zamówienie można powiązać z szansą. Zamówienie musi należeć do
organizacji szansy, a jedno zamówienie należy do **co najwyżej jednej**
szansy — próba powiązania zamówienia już powiązanego jest odrzucana ze
wskazaniem szansy, do której ono należy.

Każde powiązanie ma przełącznik **podążaj za statusem szansy**, domyślnie
włączony. Wyłącz go dla zamówienia, które ma pozostać powiązane — dla
informacji albo ze względu na jego wartość — ale nie ma być przenoszone.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/links` | `crm:write` i `orders:read` | Powiązanie zamówienia. |
| `PATCH /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` i `orders:read` | Włączenie lub wyłączenie podążania za statusem. |
| `DELETE /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` | Usunięcie powiązania. |

**Zamówienie pokazuje moduł Zamówienia.** Powiązanie zamówienia i decyzja, czy
ma ono podążać za szansą, wymagają `orders:read` oprócz `crm:write` — bez niego
odpowiedzią jest `403`; usunięcie powiązania wymaga tylko `crm:write`. Osoba,
która czyta szansę bez `orders:read`, widzi, że zamówienie jest powiązane, i
nic poza tym — jest ono na liście jako **niedostępne**, bez numeru, statusu i
kwoty, a odrzucona zmiana statusu zamówienia jest pokazywana bez jego numeru.
Admin UI pokazuje wybór zamówienia i przełącznik podążania osobie, która ma oba
uprawnienia, a pozostałym mówi, czego brakuje.

Przeniesienie szansy przenosi podążające za nią zamówienia **bez względu na
to, kto ją przenosi**: o tym, jakiego statusu zamówienia wymaga dane przejście,
zdecydowała osoba z uprawnieniem `crm:configure`, więc przenoszący szansę nie
potrzebuje `orders:write`.

## Zamówienia podążające za szansą

**Mapowanie** mówi: gdy szansa wchodzi w *ten* status, poproś jej powiązane
zamówienia o przejście w *tamten* status zamówienia. Jeden status szansy
mapuje się na co najwyżej jeden status zamówienia, a status bez mapowania
nikogo o nic nie prosi.

Gdy szansa się przesuwa, każde powiązane zamówienie, które za nią podąża,
jest proszone osobno. Prośba przechodzi przez własne reguły przepływu
zamówień — przejścia skonfigurowane dla zamówień i wszystko inne, co może
odrzucić zmianę zamówienia — dokładnie tak, jakby administrator zmienił
zamówienie ręcznie. Niczego się nie wymusza.

**Przesunięcie szansy pozostaje w mocy bez względu na odpowiedź zamówień.**
Odmowa nie jest błędem: szansa została przesunięta, a obok podany jest los
każdego zamówienia.

| Wynik | Co stało się z zamówieniem |
| --- | --- |
| `applied` | Przeszło do zmapowanego statusu. |
| `already_there` | Było już w zmapowanym statusie; nic się nie zmieniło. |
| `not_permitted` | Przepływ zamówień nie ma przejścia z bieżącego statusu zamówienia do zmapowanego — albo zamówienie jest w statusie końcowym. |
| `vetoed` | Coś, co obserwuje zmiany zamówień, odrzuciło tę zmianę; podany jest powód. |
| `unknown_status` | Mapowanie wskazuje status zamówienia, który już nie istnieje. Popraw mapowanie. |
| `not_found` | Powiązane zamówienie już nie istnieje. |
| `failed` | Prośba nie została dokończona. Podany jest powód i można ją ponowić. |

Każdy wynik poza dwoma pierwszymi pozostaje przy szansie jako **nierozwiązany**,
dopóki ktoś się nim nie zajmie:

- **Ponów** prosi zamówienie jeszcze raz — po poprawieniu mapowania albo gdy
  zamówienie przeszło do statusu, z którego zmapowany jest osiągalny.
  Zamówienie jest proszone o to, na co status szansy mapuje się *teraz*.
- **Pomiń** przyjmuje odmowę do wiadomości i zostawia zamówienie tam, gdzie
  jest.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/propagations/:propagationId/retry` | `crm:write` | Ponowna prośba do zamówienia. |
| `POST /api/v1/admin/crm/opportunities/:id/propagations/:propagationId/dismiss` | `crm:write` | Przyjęcie odmowy do wiadomości. |

## Zamówienie, które przesuwa swoją szansę

Mapowanie działa też w drugą stronę: gdy powiązane zamówienie osiągnie *ten*
status zamówienia, szansa sprzedażowa przechodzi do *tamtego* statusu. Jeden
status zamówienia mapuje się na najwyżej jeden status szansy; kilka statusów
zamówienia może prowadzić do tego samego.

Nie ma znaczenia, kto zmienił zamówienie — administrator, zaksięgowana
płatność czy nadana przesyłka. Szansa podąża za nim przez własny przepływ:
przejście musi istnieć, wszystko, co zarejestrowano, aby je odrzucać, może je
odrzucić, a wszystko, co nasłuchuje zmiany statusu szansy, usłyszy także tę.
Zmiana jest zapisywana jako spowodowana przez zamówienie i wskazuje je; żaden
administrator nie jest zapisywany jako jej autor.

| Sytuacja | Co się dzieje |
| --- | --- |
| Zamówienie nie podąża za szansą (podążanie za statusem jest wyłączone) albo nie jest powiązane z żadną | Nic. |
| Szansa jest już zamknięta — wygrana albo przegrana | Nic. **Mapowanie nigdy nie otwiera ponownie zamkniętej szansy.** |
| Przepływ nie ma przejścia ze statusu szansy do statusu z mapowania albo coś je odrzuciło | Szansa zostaje tam, gdzie była, a pominięta zmiana jest na niej zapisywana razem z powodem. |
| Mapowanie jest oznaczone *tylko gdy każde powiązane zamówienie tam jest* | Szansa czeka, aż każde powiązane zamówienie, które za nią podąża, znajdzie się w statusie zamówienia zmapowanym na ten sam status szansy. |

**Mapowania w obu kierunkach nie tworzą pętli.** Zmiana przechodzi jeden krok
i się zatrzymuje:

- gdy szansa zmienia status, a jej zamówienia za nią podążają, zmiany tych
  zamówień są rozpoznawane jako własne zmiany szansy i nie przesuwają jej
  ponownie;
- gdy zamówienie przesuwa swoją szansę, żadne inne zamówienie tej szansy nie
  jest proszone o podążanie.

Na ekranie **Statusy i przepływ** te mapowania to druga tabela, *Status szansy
dla każdego statusu zamówienia*: jeden wiersz dla każdego statusu zamówienia,
wybór statusu szansy, do którego on prowadzi, oraz pole wyboru **Dopiero gdy są
tam wszystkie powiązane zamówienia**. Pole jest zaznaczane automatycznie, gdy
wybrany status zamyka szansę — jedno dostarczone zamówienie z trzech nie
powinno wygrywać transakcji — a w pozostałych przypadkach zostaje puste; przed
zapisaniem można je zmienić w obie strony. Mapowanie, którego status zamówienia
został w międzyczasie usunięty z przepływu zamówień, zostaje w tabeli z
oznaczeniem *już nie istnieje*, dopóki w jego wierszu nie zostanie wybrane *Nie
zmieniaj szansy*. Przycisk **Zapisz mapowania** zapisuje obie tabele naraz.

W API mapowanie wysyła się na ten sam adres co mapowania w przód, z
`direction: "order_to_opportunity"` i opcjonalnie z `requireAllOrders`. Zbiór
jest zastępowany w całości, oba kierunki razem:

```json
{
  "mappings": [
    { "direction": "opportunity_to_order", "opportunityStatusCode": "won", "orderStatusCode": "completed" },
    { "direction": "order_to_opportunity", "orderStatusCode": "completed", "opportunityStatusCode": "won", "requireAllOrders": true }
  ]
}
```

`GET /api/v1/admin/crm/workflow` podaje `orderStatusKnown` dla każdego
mapowania. Wartość zmienia się na `false`, gdy moduł Zamówień odpowie, że taki
status zamówienia nie istnieje, i wraca do `true`, gdy zamówienie następnym
razem go przyjmie; mapowanie, którego nikt jeszcze nie użył, ma `true`.

Gdy moduł jest wyłączony, zmiana statusu zamówienia niczego nie przesuwa i nie
jest później nadrabiana.

## Kto prowadzi szansę

Każda szansa sprzedażowa ma najwyżej jedną **osobę przypisaną** — tę, która nad
nią pracuje. Przypisany może zostać każdy aktywny administrator, który ma
dostęp do organizacji szansy.

Gdy szansa jest tworzona bez wskazania, kto ją prowadzi, osoba przypisana jest
wybierana spośród handlowców przypisanych do organizacji tej szansy:

1. osoba tworząca szansę, jeśli jest jednym z nich;
2. w przeciwnym razie handlowiec przypisany do organizacji najdłużej;
3. w przeciwnym razie nikt — szansa powstaje jako nieprzypisana.

Handlowiec, którego konto zostało dezaktywowane, jest pomijany. Żądanie, które
wskazuje osobę przypisaną albo wprost mówi, że jej nie ma, jest wykonywane
dosłownie i reguła nie ma zastosowania.

Handlowców przypisuje się do organizacji na ekranie samej organizacji, na
karcie handlowców — ta lista należy do modułu Organizacje, a opisana wyżej
reguła tylko ją odczytuje.

**Przypisanie nie decyduje o tym, kto widzi szansę.** Handlowiec ograniczony do
wybranych organizacji widzi każdą szansę tych organizacji, niezależnie od tego,
kto ją prowadzi — i nie widzi szansy innej organizacji, nawet jeśli jest do
niego przypisana.

W Admin UI:

- **W formularzu nowej szansy** pole *Handlowiec* jest opcjonalne. Jeśli
  zostanie puste, wybiera opisana wyżej reguła; jeśli wskażesz osobę, szansa
  jest jej.
- **Na ekranie szansy** pole *Handlowiec* — w panelu informacji po prawej —
  pokazuje, kto ją prowadzi.
  Posiadacz uprawnienia `crm:write` zmienia to w tym samym miejscu: wybranie
  osoby od razu przypisuje jej szansę, a wyczyszczenie pola zostawia szansę
  nieprzypisaną. Niczego nie trzeba zapisywać.
- **Na liście** jest kolumna *Handlowiec*, a lista i tablica mają filtr
  *Handlowiec*: **Dowolny**, **Moje**, **Nieprzypisane** albo **Wybrana
  osoba…** — ta ostatnia opcja dodaje pole wyboru osoby.
- Handlowiec, którego konto zostało w międzyczasie dezaktywowane, jest
  oznaczony jako **nieaktywny** wszędzie, gdzie pojawia się jego imię i
  nazwisko: na liście, na kartach tablicy i na ekranie szansy. Szansa pozostaje
  jego, dopóki ktoś jej nie przypisze komuś innemu.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `POST /api/v1/admin/crm/opportunities/:id/assign` | `crm:write` | Przypisanie, zmiana przypisania albo — z `{ "adminUserId": null }` — jego zdjęcie. Odpowiedzią jest szansa. |
| `GET /api/v1/admin/crm/opportunities?assignedAdminUserId=…` | `crm:read` | `me` — szanse wywołującego, `unassigned` — nieprzypisane, albo identyfikator administratora. |

Osoby, która nie jest aktywnym administratorem albo nie ma dostępu do
organizacji szansy, nie można przypisać: żądanie jest odrzucane z kodem
`CRM_ASSIGNEE_INVALID`. Edycja szansy również może
zmienić osobę przypisaną — na tej samej zasadzie.

Osoba dowiaduje się, że szansa została jej przypisana — z dzwonka powiadomień
w Admin UI, z odnośnikiem do szansy. Wpis nazywa szansę jej numerem, nigdy
tytułem, i nie powstaje dla osoby, która nie ma już dostępu do organizacji
szansy. To samo dotyczy szansy utworzonej automatycznie. Nikt nie jest
powiadamiany o tym, że sam wziął szansę. Dzwonek należy do modułu
**Powiadomienia administratora**: gdy ten moduł jest wyłączony, przypisywanie
działa dokładnie tak samo, a nikt nie dostaje powiadomienia. **Wpis jest
wyświetlany w języku czytającego**, po angielsku albo po polsku — ten sam wpis
brzmi inaczej dla dwóch osób, które używają różnych języków. Moduł zapisuje
zdanie po angielsku obok zdania tłumaczonego, więc wpis pozostaje czytelny, po
angielsku, także wtedy, gdy moduł CRM jest wyłączony.

Każde przypisanie trafia do historii zmian szansy, a inne moduły mogą na nie
reagować: `crm.opportunity.assigned.v1` niesie nową i poprzednią osobę
przypisaną.

## Etykiety

**Etykieta** to krótkie oznaczenie z kolorem — *Klient kluczowy*, *Przetarg*,
*Odnowienie* — które szansa sprzedażowa może nosić, w dowolnej liczbie. Lista
etykiet jest jedna dla całej platformy.

- Nazwy etykiet są unikalne bez względu na wielkość liter: *Przetarg*
  i *PRZETARG* to ta sama nazwa, a druga zostanie odrzucona z kodem
  `CRM_TAG_NAME_TAKEN`.
- Zmiana nazwy albo koloru etykiety zmienia ją na każdej szansie, która ją
  nosi.
- Usunięcie etykiety zdejmuje ją z każdej szansy, która ją nosiła. Nic innego
  w tych szansach się nie zmienia.
- Listę szans można filtrować po etykietach. Kilka etykiet oznacza *wszystkie
  naraz*: szansa pojawia się na liście tylko wtedy, gdy nosi każdą ze
  wskazanych etykiet.
- Przy każdej etykiecie widać, ile szans ją nosi — liczone po szansach, które
  pytająca osoba może zobaczyć, a nie po całej platformie.

Zarządzanie listą etykiet jest konfiguracją i wymaga `crm:configure`.
Nadawanie etykiet szansie to codzienna praca i wymaga `crm:write`.

W Admin UI:

- **CRM → Etykiety** to lista etykiet z informacją, ile widocznych dla Ciebie
  szans ma każdą z nich. Przycisk **Dodaj etykietę** otwiera krótki formularz
  z nazwą i kolorem; ołówek zmienia nazwę lub kolor; kosz usuwa etykietę — po
  potwierdzeniu, które podaje, ile szans ją straci.
- **Na ekranie szansy** pole *Etykiety* — w panelu informacji po prawej —
  pokazuje jej etykiety. Posiadacz
  uprawnienia `crm:write` zaznacza je i odznacza na liście poniżej; każda
  zmiana jest zapisywana od razu.
- **W formularzu nowej szansy** pole *Etykiety* pozwala nadać je od początku.
- **Na liście i na tablicy** filtr *Etykiety (wszystkie naraz)* zawęża widok do
  szans, które mają każdą zaznaczoną etykietę. Lista pokazuje etykiety szansy
  pod jej tytułem, a tablica — na karcie.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/tags` | `crm:read` | Lista etykiet według nazwy, każda z `usageCount`. |
| `POST /api/v1/admin/crm/tags` | `crm:configure` | Utworzenie etykiety: `{ "name", "color"? }`. |
| `PATCH /api/v1/admin/crm/tags/:id` | `crm:configure` | Zmiana nazwy albo koloru. |
| `DELETE /api/v1/admin/crm/tags/:id` | `crm:configure` | Usunięcie etykiety i zdjęcie jej z każdej szansy. |
| `PUT /api/v1/admin/crm/opportunities/:id/tags` | `crm:write` | Zastąpienie etykiet szansy: `{ "tagIds": [...] }`. Odpowiedzią jest szansa. |
| `GET /api/v1/admin/crm/opportunities?tagId=…&tagId=…` | `crm:read` | Szanse noszące każdą ze wskazanych etykiet. |

Tworzenie i edycja szansy również mogą ustawić jej etykiety, przez `tagIds`.
Etykieta, która nie istnieje, jest odrzucana i nic się nie zmienia.

## Notatki i wiadomości wewnętrzne

Osoby pracujące nad szansą sprzedażową piszą w niej na dwa sposoby.

**Notatka** to coś do zapamiętania — co powiedział klient, co ustalono, co
zrobić dalej. Autor notatki może ją edytować albo usunąć; nikt inny nie może,
bez względu na uprawnienia. Przy edytowanej notatce widać, że była edytowana.
Usunięta notatka znika z listy. Historia zmian szansy odnotowuje, że notatka
została napisana, zmieniona albo usunięta, przez kogo i jak była długa —
nigdy jej treść.

**Wiadomość** jest częścią rozmowy między osobami pracującymi nad szansą.
Wiadomości są wyświetlane w kolejności wysłania, a **wiadomości nie można
zmienić ani usunąć po wysłaniu** — nie może tego zrobić ani autor, ani nikt
inny: próba jest odrzucana z kodem `CRM_MESSAGE_IMMUTABLE`. O wiadomości
dowiadują się osoba przypisana do szansy i wszyscy, którzy już napisali w tej
rozmowie — poza nadawcą — z dzwonka powiadomień w Admin UI, z odnośnikiem do
szansy. Wpis nazywa szansę jej numerem i nie zawiera niczego z treści
wiadomości, a nie powstaje dla osoby, która nie ma już dostępu do organizacji
szansy. **Nikt inny nie jest powiadamiany, chyba że wiadomość o nim
wspomina** (zob. *Wspominanie osoby, zamówienia albo produktu przez @*):
pierwsza wiadomość w szansie, która nie ma przypisanej osoby i nie wspomina
nikogo, nie powiadamia nikogo. Wpis jest wyświetlany w języku czytającego,
tak jak wpis o przypisaniu. Gdy moduł **Powiadomienia administratora** jest
wyłączony, wiadomość jest zapisywana tak samo, a nikt nie dostaje powiadomienia.

**Jedno i drugie jest wewnętrzne.** Ani notatka, ani wiadomość nie ma
ustawienia, które pokazałoby ją klientowi, i nic, co klient może otworzyć —
zamówienie, zapytanie ofertowe, jego konto — ich nie zawiera.

W Admin UI szansa ma kartę **Notatki** i kartę **Wiadomości**. Każda pokazuje
wpisy od najstarszego, z autorem i datą, a posiadaczowi uprawnienia `crm:write`
— także pole pod listą, w którym pisze się następny wpis.

- Na karcie **Notatki** przy własnych notatkach są przyciski **Edytuj** i
  **Usuń**; przy notatkach innych osób ich nie ma. Zmieniona notatka jest
  oznaczona jako *edytowano*. Usunięcie wymaga potwierdzenia.
- Na karcie **Wiadomości** niczego nie można edytować ani usunąć, o czym karta
  informuje nad rozmową.

**Nieprzeczytane wiadomości.** Karta *Wiadomości* pokazuje, ilu wiadomości
szansy jeszcze nie przeczytałeś, a otwarcie karty oznacza ich przeczytanie:
liczba znika, gdy tylko rozmowa pojawi się na ekranie. Licznik jest wyłącznie
twój — to, że rozmowę przeczytał ktoś inny, niczego u ciebie nie zmienia — i
działa tak samo dla osoby, która może czytać szanse, ale nie może w nich pisać.
Wiadomość, którą napisałeś sam, nigdy nie jest nieprzeczytana. Wiadomość, która
nadejdzie po otwarciu karty, znów jest nieprzeczytana i pokaże się przy
następnym wczytaniu szansy. Czytanie nie zostawia śladu w szansie: w historii
zmian nic się nie pojawia.

Po aktualizacji modułu do wydania, które wprowadza licznik, nikt nie zastaje
dotychczasowych rozmów jako nieprzeczytanych: dla szansy, której od tego czasu
nie otwierałeś, liczą się tylko wiadomości napisane po aktualizacji.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/comments?kind=note` | `crm:read` | Notatki szansy, od najstarszej. `kind=message` — rozmowa. Parametr `kind` jest wymagany. |
| `POST /api/v1/admin/crm/opportunities/:id/comments` | `crm:write` | Dodanie: `{ "kind": "note" \| "message", "body" }`. |
| `PATCH /api/v1/admin/crm/opportunities/:id/comments/:commentId` | `crm:write` | Edycja notatki: `{ "body" }`. Tylko autor. |
| `DELETE /api/v1/admin/crm/opportunities/:id/comments/:commentId` | `crm:write` | Usunięcie notatki. Tylko autor. |
| `POST /api/v1/admin/crm/opportunities/:id/messages/read` | `crm:read` | Informacja, że przeczytałeś rozmowę aż do wskazanej wiadomości: `{ "throughMessageId" }`. Odpowiedź: `{ "unreadMessageCount" }` — ile wiadomości pozostaje dla ciebie nieprzeczytanych. |

Edycja albo usunięcie cudzej notatki kończy się odpowiedzią 403; próba zrobienia
tego z wiadomością — odpowiedzią 409 `CRM_MESSAGE_IMMUTABLE`, niezależnie od
tego, kto pyta.

`GET /api/v1/admin/crm/opportunities/:id` zawiera pola `noteCount`,
`attachmentCount` i `unreadMessageCount`. Ostatnie jest liczone dla
administratora, który pyta: dwóch administratorów czytających tę samą szansę
dostaje dwie liczby. Oznaczenie wiadomości jako przeczytanych przesuwa wyłącznie
twój własny znacznik i nigdy wstecz; `throughMessageId` musi wskazywać
wiadomość tej szansy, w przeciwnym razie odpowiedzią jest 404. To, jak daleko
przeczytał każdy administrator, jest przechowywane w tabeli
`crm_opportunity_message_reads` — jeden wiersz na administratora i szansę — i
znika razem z szansą, gdy zostanie ona usunięta. Tabela
`crm_message_read_baselines` przechowuje jedną chwilę, od której liczone są
nieprzeczytane wiadomości dla osoby, która nie ma jeszcze znacznika.

## Załączniki

Brief, rysunek, podpisana oferta — do szansy sprzedażowej można dołączać pliki.

**Do dodania pliku wystarcza uprawnienie `crm:write`.** Plik trafia do
mechanizmu przesyłania samego CRM, który zapisuje go w **bibliotece mediów**
jako plik prywatny i w tym samym kroku dołącza do szansy. Żadne uprawnienie
biblioteki mediów nie jest potrzebne, więc handlowiec, który nie ma dostępu do
biblioteki mediów, nadal może dodać plik do szans, nad którymi pracuje.

Sam plik jest przechowywany w bibliotece mediów, a szansa przechowuje odnośnik
do niego. Wynikają z tego trzy rzeczy.

**O tym, jaki plik jest dopuszczalny, decyduje biblioteka mediów.** Dozwolone
typy plików i limit rozmiaru ustawione dla biblioteki mediów obowiązują
załącznik dokładnie tak, jak każdy inny przesyłany plik, a plik, którego
biblioteka nie przyjmie, jest odrzucany z jej własną odpowiedzią. Niezależnie
od tego załącznik może mieć najwyżej **25 MB**, bez względu na to, na co
pozwala biblioteka.

**Załącznik jest plikiem prywatnym.** Plik, który biblioteka mediów
przechowuje jako publiczny, ma adres, który może otworzyć każdy, dlatego plik
przesłany przez CRM jest zawsze zapisywany jako prywatny, a plik publiczny jest
odrzucany jako załącznik.

**Pliku, który jest załączony, nie można usunąć z biblioteki mediów.**
Biblioteka odmawia i wskazuje szansę po jej numerze. Najpierw trzeba usunąć
załącznik. Dotyczy to także czasu, gdy moduł CRM jest wyłączony — załączniki
nadal istnieją, a ochrona razem z nimi.

Każdy, kto może czytać szansę, może pobrać jej załączniki; żadne uprawnienie
biblioteki mediów nie jest potrzebne. Każdy załącznik na liście ma odnośnik do
pobrania ważny przez kilka minut — aby dostać świeży, wystarczy ponownie
odczytać listę. Odnośnik pobiera plik; plik nigdy nie jest otwierany jako
strona.

**Plik, który przeglądarka by uruchomiła, nie jest przyjmowany jako
załącznik**: HTML, SVG, XML i JavaScript — rozpoznawane po nazwie pliku i po
jego typie; wystarczy jedno z nich. Przesłanie pliku i załączenie po `assetId`
odpowiadają wtedy `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED` i nic nie jest
zapisywane.

W Admin UI szansa ma kartę **Załączniki**: listę plików z nazwą, rozmiarem,
osobą, która plik dodała, i datą dodania.

- **Dodaj plik** — albo upuszczenie pliku na obszar z przerywaną ramką —
  przesyła jeden plik i dołącza go do szansy. Przycisk jest dostępny dla
  każdego, kto ma uprawnienie `crm:write`. Plik większy niż 25 MB jest
  odrzucany jeszcze przed wysłaniem; plik, którego biblioteka mediów nie
  przyjmuje, jest odrzucany z podaną przez nią przyczyną.
- Przycisk pobierania przygotowuje świeży odnośnik w chwili kliknięcia i
  pobiera plik. Jeśli pliku nie ma już w bibliotece mediów,
  ekran o tym informuje i niczego nie otwiera.
- Kosz usuwa załącznik po potwierdzeniu. Plik pozostaje w bibliotece mediów.

Osoba, która może tylko czytać, widzi listę i przyciski pobierania.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/attachments` | `crm:read` | Załączniki, od najstarszego: nazwa pliku, typ, rozmiar, kto załączył oraz `url`. |
| `POST /api/v1/admin/crm/opportunities/:id/attachments/upload` | `crm:write` | Przesłanie pliku i załączenie go: `multipart/form-data` z jedną częścią `file`. |
| `POST /api/v1/admin/crm/opportunities/:id/attachments` | `crm:write` i `assets.read` | Załączenie pliku, który już jest w bibliotece mediów jako prywatny: `{ "assetId" }`. |
| `DELETE /api/v1/admin/crm/opportunities/:id/attachments/:attachmentId` | `crm:write` | Usunięcie załącznika. Plik zostaje w bibliotece mediów. |

Odpowiedzią na przesłanie pliku jest nowy załącznik. Dla pliku większego niż
25 MB odpowiedzią jest 413 `CRM_ATTACHMENT_TOO_LARGE`, a odmowy samej
biblioteki mediów — 413 `ASSET_UPLOAD_TOO_LARGE`, 415
`ASSET_UPLOAD_TYPE_NOT_ALLOWED` — są przekazywane bez zmian. Dla szansy
niedostępnej dla pytającej osoby odpowiedzią jest 404, zanim cokolwiek zostanie
zapisane, a plik, który został zapisany, ale nie dał się załączyć, jest z
biblioteki mediów usuwany.

Załączanie po `assetId` jest przeznaczone dla integracji, która sama umieściła
plik w bibliotece mediów; Admin UI z niego nie korzysta. Wymaga uprawnienia
odczytu biblioteki mediów, `assets.read`, oprócz `crm:write`: wskazanie pliku
biblioteki po identyfikatorze jest odczytem biblioteki, więc załączyć go może
tylko osoba, która mogłaby otworzyć go w bibliotece. Przesłanie własnego pliku
wymaga samego `crm:write`. Załączenie pliku,
który szansa już ma, niczego nie zmienia, a odpowiedzią jest istniejący
załącznik. Plik, którego nie ma w bibliotece mediów — albo który jest załączony
do szansy niedostępnej dla pytającej osoby — jest odrzucany jak plik, który nie
istnieje. Jeśli plik zniknął z biblioteki mediów, jego załącznik nadal jest na
liście, pod dawną nazwą, bez odnośnika.

## Wydarzenia i przypomnienia

**Wydarzenie** to coś zaplanowanego dla szansy sprzedażowej — rozmowa,
spotkanie, termin. Należy do tej jednej szansy i nie da się go przenieść do
innej; nie ma wydarzenia bez szansy.

Wydarzenie ma:

- **nazwę** (wymaganą, do 200 znaków) i opcjonalny **opis** do 5000 znaków.
  Opis jest zwykłym tekstem: skróty z `@` nie są w nim dostępne;
- **jeden dzień**. Albo godzinę początku i końca tego samego dnia, przy czym
  koniec jest późniejszy niż początek, albo **Cały dzień** — samą datę, bez
  godzin. Wydarzenie nie może trwać przez północ: takie spotkanie to dwa
  wydarzenia;
- opcjonalnie **jedno przypomnienie** — datę i godzinę.

Wydarzenia są planem szansy, a nie własnością autora. Inaczej niż notatkę,
**każde** wydarzenie szansy może edytować i usunąć każdy posiadacz uprawnienia
`crm:write`, który tę szansę widzi — bez względu na to, kto je dodał. Gdy dwie
osoby zapisują to samo wydarzenie, obowiązuje późniejszy zapis. Dodanie albo
zmiana wydarzenia nie liczy się jako edycja szansy, więc nigdy nie powoduje
odrzucenia formularza edycji, który ma otwarty ktoś inny.

Usunięcie szansy usuwa jej wydarzenia i żadne z ich przypomnień nie zostaje
wysłane. Zamknięcie szansy niczego nie usuwa — zobacz niżej *Zamknięte
szanse*.

### Karta Wydarzenia

**Wydarzenia** to trzecia karta szansy, po karcie *Powiązania*. Jej etykieta
podaje liczbę wydarzeń, które jeszcze się nie zakończyły.

- **Dodaj wydarzenie** (`crm:write`) otwiera okno. **Otwórz kalendarz**
  prowadzi do ekranu **CRM → Kalendarz**.
- Wydarzenia są wypisane w dwóch grupach: **Nadchodzące** — jeszcze
  niezakończone, od najbliższego — i **Minione**, od najnowszego; widać
  pierwsze dziesięć, a potem przycisk *Pokaż wszystkie minione wydarzenia*.
  Wiersz pokazuje termin wydarzenia, jego nazwę, pierwsze dwie linie opisu i
  to, co stało się z przypomnieniem. Posiadacz uprawnienia `crm:write` ma przy
  każdym wierszu **Edytuj** i **Usuń**; usunięcie wymaga potwierdzenia.
- Pod listą te same wydarzenia są narysowane w kalendarzu tej jednej szansy,
  w widoku **Miesiąc** albo **Tydzień**. Kalendarza nie ma, dopóki szansa nie
  ma wydarzeń, ani na ekranie węższym niż 640 px, gdzie kalendarzem jest
  lista.
- Osoba, która ma tylko `crm:read`, widzi listę i kalendarz, ale nic, co
  dodaje, zmienia albo usuwa.

Okno dodawania i edycji:

| Pole | Co zawiera |
| --- | --- |
| **Nazwa** | Wymagana. |
| **Cały dzień** | Po zaznaczeniu obie godziny znikają z formularza, a wydarzenie obejmuje całą datę. |
| **Data** | Nowe wydarzenie otwiera się z dzisiejszą datą. |
| **Od**, **Do** | Nowe wydarzenie dostaje propozycję: od najbliższej pełnej godziny, na jedną godzinę. Zmiana pola *Od* przesuwa *Do* o tyle samo. Koniec, który nie jest późniejszy niż początek, jest odrzucany, zanim cokolwiek zostanie wysłane. |
| **Opis** | Opcjonalny. |
| **Ustaw przypomnienie** | Domyślnie odznaczone. Podpowiedź pod polem mówi, kto dostanie przypomnienie. |
| **Data i godzina przypomnienia** | Pojawia się po zaznaczeniu *Ustaw przypomnienie*, od razu ustawiona na początek wydarzenia — albo na 9:00 w jego dniu, gdy wydarzenie trwa cały dzień. Podąża za początkiem, dopóki nie zmienisz jej ręcznie. Czas, który nie jest w przyszłości, jest odrzucany. |

Przy edycji wydarzenia czas przypomnienia, którego nie ruszono, nie jest
ponownie porównywany z zegarem, więc wydarzeniu, którego przypomnienie już
wysłano, nadal można zmienić nazwę. Zapisanie **innego** czasu przypomnienia,
w przyszłości, uzbraja przypomnienie od nowa: zostanie wysłane jeszcze raz, o
nowej porze. Odznaczenie *Ustaw przypomnienie*, przeniesienie przypomnienia
na inną porę albo usunięcie wydarzenia zatrzymuje oczekujące przypomnienie —
nawet w minucie, w której przypada jego termin, gdy platforma już je pobrała
do wysyłki.

### Kto dostaje przypomnienie i jak

Przypomnienie w chwili zapisania nie ma adresata. **O tym, kto je dostanie,
rozstrzyga się w chwili, gdy przypada jego termin:**

1. osoba, do której szansa jest przypisana **w tej chwili** — a nie ta, do
   której była przypisana, gdy dodawano wydarzenie;
2. w przeciwnym razie osoba, która dodała wydarzenie. Tak jest, gdy szansa nie
   ma handlowca, a także wtedy, gdy handlowiec nie spełnia warunków;
3. w przeciwnym razie nikt: nic nie jest wysyłane, a przy wydarzeniu widać, że
   nie było kogo powiadomić.

Osoba spełnia warunki, gdy w tej chwili zachodzą wszystkie trzy: jej konto
jest **aktywne**, jej rola ma uprawnienie **`crm:read`** i **widzi ona
organizację szansy**. Te same trzy warunki dotyczą handlowca i osoby, która
dodała wydarzenie — kto nie mógłby już otworzyć szansy, nie dowiaduje się, co
w niej zaplanowano.

Przypomnienie trafia więc do tego, kto prowadzi szansę, gdy nadejdzie termin
— niekoniecznie do osoby, która zaznaczyła *Ustaw przypomnienie*.

Przypomnienie trafia do odbiorcy najwyżej dwiema drogami:

- **Dzwonek powiadomień — zawsze.** Wpis podaje nazwę wydarzenia, jego
  początek i numer szansy — *Przypomnienie: Oddzwonić w sprawie oferty,
  12 października 2026, 10:00 (Europe/Warsaw) — szansa sprzedażowa
  OPP-000042* — i otwiera szansę na karcie **Wydarzenia** z zaznaczonym tym
  wydarzeniem. Data i godzina są zapisane w języku odbiorcy — *October 12,
  2026, 10:00 AM (Europe/Warsaw)* dla osoby, której Admin UI jest po
  angielsku — i w strefie czasowej, w której zapisano wydarzenie, podanej
  obok; przy wydarzeniu całodniowym jest sama data. Powstają w chwili wysyłki
  przypomnienia, więc osoba, która później zmieni język, zachowuje datę w
  dawnym zapisie. Znak nowej linii w nazwie wydarzenia jest oddawany jako
  spacja.
- **Dodatkowo e-mail, gdy osoba nie jest online.** Kto jest online, dostaje
  tylko wpis w dzwonku.

**Co znaczy „online”.** Osoba jest online, gdy w ciągu ostatnich pięciu minut
Admin UI wykonał w jej imieniu jakieś żądanie. Otwarty Admin UI pyta o nowe
powiadomienia co 30 sekund, więc w praktyce online znaczy *ma Admin UI otwarty
w przeglądarce* — na dowolnym urządzeniu. Nie wiadomo, czy ktokolwiek patrzy
na ekran: osoba, która odeszła od biurka i zostawiła otwartą kartę
przeglądarki, dostanie wpis w dzwonku, a e-maila nie. Po zamknięciu
przeglądarki albo wylogowaniu osoba przestaje być online najpóźniej po pięciu
minutach.

**E-mail** to mail transakcyjny **Event reminder** (`crm_event_reminder`).
Zawiera te same trzy informacje co wpis w dzwonku — nazwę wydarzenia, jego
początek i numer szansy — i jest napisany w języku Admin UI odbiorcy: po
polsku, gdy odbiorca wybrał polski, a w pozostałych przypadkach po angielsku.
Wysyłany jest z oprawą wspólną dla całej platformy, a nie z oprawą kanału
sprzedaży.

**E-mail nie zawiera odnośnika.** Wskazuje szansę jej numerem i prosi o
otwarcie jej w Admin UI; odnośnik prowadzący do szansy ma wpis w dzwonku. Ani
wpis w dzwonku, ani e-mail nigdy nie zawierają opisu wydarzenia ani tytułu
szansy.

Temat i treść e-maila operator zmienia, osobno dla każdego języka, na ekranie
**Maile transakcyjne** (`/transactional-emails`) i tam też może go wyłączyć.
Dostępne zmienne to `event.name`, `event.when` i `opportunity.number`.
**E-mail, który nie wyszedł, nigdy nie kosztuje wpisu w dzwonku** — wyłączony
przez operatora, brak adresu na koncie odbiorcy, serwer poczty, który
odmawia: wpis w dzwonku i tak powstaje, przy wydarzeniu widać przypomnienie
wysłane przez dzwonek, a w logu serwera jest powód, dla którego e-mail nie
został wysłany.

Gdy moduł **Powiadomienia administratora** jest wyłączony, dzwonka nie ma, więc e-mail
jest wysyłany bez względu na to, czy osoba jest online. Gdy nie ma ani
dzwonka, ani wysłanego e-maila, przy wydarzeniu widać, że przypomnienia nie
udało się dostarczyć.

**Instancja bez skonfigurowanego serwera poczty.** Bez połączenia SMTP
(`SMTP_URL` albo `SMTP_HOST` z pozostałymi polami) platforma zapisuje każdy
e-mail w logu serwera, zamiast go wysłać, i uznaje go za wysłany.
Przypomnienie dla osoby, która nie jest online, jest wtedy pokazywane jako
wysłane przez dzwonek *oraz* e-mailem, choć żadna wiadomość nie dotarła do
skrzynki. Wpis w dzwonku czeka na powrót tej osoby; zanim zaczniesz polegać na
e-mailu, skonfiguruj SMTP.

### Kiedy przypomnienie jest wysyłane, a kiedy nie

Przypomnienia są sprawdzane raz na minutę, więc przypomnienie przychodzi
najpóźniej minutę po swoim terminie. Każde jest dostarczane **najwyżej raz**.

- **Z opóźnieniem — do 24 godzin.** Przypomnienie, którego nie dało się wysłać
  w terminie — platforma nie działała, CRM był wyłączony, szansa była
  zamknięta — jest wysyłane, gdy tylko stanie się to możliwe, o ile mieści się
  to w 24 godzinach od jego terminu.
- **Spóźnione o więcej niż 24 godziny jest pomijane**: nie zostaje wysłane i
  jest pokazywane jako takie, które *przepadło*.
- **Wstrzymane, dopóki szansa jest zamknięta.** Dla zamkniętej szansy nic nie
  jest wysyłane, a przypomnienie się nie zużywa: otwórz szansę ponownie w
  ciągu 24 godzin od terminu przypomnienia, a zostanie wysłane wtedy. Później
  *przepada* — i tak jest pokazywane, nawet gdy szansa nadal jest zamknięta.
- **Nie jest wysyłane, gdy CRM jest wyłączony** — z tym samym limitem 24
  godzin.
- **Przerwane.** Jeśli serwer zatrzyma się w trakcie dostarczania, nie da się
  ustalić, czy wpis w dzwonku powstał. Przypomnienie nie jest ponawiane —
  groziłoby to drugim wpisem — a po dziesięciu minutach przy wydarzeniu widać,
  że wysyłka została przerwana i przypomnienie mogło nie dotrzeć.

Co karta Wydarzenia mówi o każdym przypomnieniu:

| Karta mówi | Znaczenie |
| --- | --- |
| *Przypomnienie zaplanowane na …* | Jeszcze przed terminem. |
| *Przypomnienie na … jest wstrzymane, dopóki szansa jest zamknięta* | Nic nie zostanie wysłane, dopóki szansa nie zostanie ponownie otwarta. |
| *Przypomnienie wysłane … — dzwoneczek powiadomień* (oraz, albo zamiast niego, *e-mail*) | Dostarczone: kiedy i którą z dwóch dróg. |
| *Przypomnienie na … przepadło — nie zostało wysłane* | Znaleziono je spóźnione o więcej niż 24 godziny. |
| *Przypomnienie na …: nie było kogo powiadomić* | Ani handlowiec, ani osoba, która dodała wydarzenie, nie spełniali warunków. |
| *Przypomnienia na … nie udało się dostarczyć* | Dzwonek jest wyłączony i żaden e-mail nie wyszedł. |
| *Wysyłka przypomnienia na … została przerwana — mogło nie dotrzeć* | Proces, który je wysyłał, zatrzymał się, zanim zapisał wynik. Wysyłka nie jest powtarzana. |

### Zamknięte szanse

Zamknięta szansa — wygrana albo przegrana — **zachowuje kartę Wydarzenia**,
swoje wydarzenia i możliwość ich edycji. Dopóki jest zamknięta, zmieniają się
dwie rzeczy, o czym karta informuje w notce: jej wydarzeń **nie widać w
Kalendarzu**, a jej przypomnienia są **wstrzymane**. Ponowne otwarcie szansy
przywraca jedno i drugie; zamknięcie ani ponowne otwarcie nie zmienia żadnego
wydarzenia.

### Strefy czasowe

Platforma nie ma ustawienia strefy czasowej, więc wydarzenie ma własną:
strefę czasową przeglądarki, z której je zapisano.

- Wydarzenie **z godzinami** to jedna chwila, ta sama dla wszystkich. Każdy
  widzi ją według własnego czasu lokalnego.
- Wydarzenie **całodniowe** to data, ta sama dla wszystkich, gdziekolwiek je
  czytają.
- **Regułę jednego dnia ocenia się w strefie czasowej, z której wydarzenie
  jest zapisywane.** Wydarzenie od 23:00 do 23:30 w Warszawie mieści się w
  jednym dniu i jest przyjmowane, choć dla osoby w Tokio wypada następnego
  dnia rano. W drugą stronę: wydarzenie zaplanowane w Warszawie na
  16:30 – 17:30, którego godzinę ktoś później **zmienia z przeglądarki w
  Tokio**, jest oceniane tam — gdzie trwa od 23:30 do 00:30 — i odrzucane.
  Zmiana samej nazwy albo opisu nie powoduje ponownej oceny godzin.
- Wpis w dzwonku i e-mail nie mają przeglądarki, za którą mogłyby podążać,
  więc podają czas w strefie czasowej samego wydarzenia i ją nazywają.

### W historii zmian

Dodanie, zmiana i usunięcie wydarzenia są wpisami w historii zmian szansy —
*Dodano wydarzenie*, *Zmieniono wydarzenie*, *Usunięto wydarzenie* — z
informacją, kto i kiedy, z nazwą wydarzenia, tym, czy trwa cały dzień, jego
początkiem i końcem oraz czasem przypomnienia. Treści opisu w historii nie
ma: jest tylko jego długość. To, co stało się z przypomnieniem, również nie
jest wpisem; widać to na karcie Wydarzenia.

### Dla integratorów i operatorów

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/events` | `crm:read` | Wydarzenia szansy, według początku; najwyżej 500. |
| `POST /api/v1/admin/crm/opportunities/:id/events` | `crm:write` | Dodanie wydarzenia: `{ "name", "description", "allDay", "startsAt", "endsAt", "timeZone", "remindAt" }`. |
| `PATCH /api/v1/admin/crm/opportunities/:id/events/:eventId` | `crm:write` | Zmiana przesłanych pól. Reguły są stosowane do wydarzenia w kształcie, jaki miałoby po zmianie. `"remindAt": null` usuwa przypomnienie. |
| `DELETE /api/v1/admin/crm/opportunities/:id/events/:eventId` | `crm:write` | Usunięcie wydarzenia. |

- `startsAt` i `endsAt` to chwile w formacie ISO 8601 z przesunięciem;
  `endsAt` jest wyłączne. `timeZone` to nazwa IANA strefy, w której wybrano
  godziny — `Europe/Warsaw`. Dla `"allDay": true` obie chwile to lokalna
  północ rozpoczynająca datę i następna lokalna północ, w tej strefie.
- Wydarzenie w odpowiedzi ma `allDayDate` — datę wydarzenia całodniowego,
  `null` dla wydarzenia z godzinami — oraz `reminder`: `null` albo
  `{ at, state, handledAt, channels }`, gdzie `state` to jedno z:
  `scheduled`, `paused`, `sent`, `missed`, `no_recipient`, `undeliverable`,
  `interrupted`, a `channels` wymienia `bell`, `email` albo oba, gdy stan to
  `sent`.
- `GET /api/v1/admin/crm/opportunities/:id` zwraca `upcomingEventCount` —
  liczbę, którą pokazuje etykieta karty.
- Szansa, której pytająca osoba nie może zobaczyć, odpowiada na wszystkich
  czterech trasach 404 `CRM_OPPORTUNITY_NOT_FOUND`, dokładnie tak jak szansa,
  która nie istnieje; `:eventId`, który nie jest wydarzeniem tej szansy,
  odpowiada 404 `NOT_FOUND`. Niepoprawnie zbudowana treść żądania odpowiada
  400 `VALIDATION_FAILED` — tak samo jak `startsAt`, `endsAt` albo `remindAt`
  spoza zakresu `0001-01-03T00:00:00Z` … `9999-12-30T00:00:00Z`. Poprawnie zbudowane wydarzenie, które odrzucają
  reguły, odpowiada **422** `VALIDATION_FAILED` z polami `details.field` i
  `details.rule`: `ends_before_start`, `spans_days`, `not_whole_day`,
  `unknown_time_zone` albo `reminder_in_past`.

Wydarzenia są przechowywane w tabeli `crm_opportunity_events`, którą tworzy
migracja modułu. Wydarzenie nie ma własnej organizacji: dociera się do niego
przez jego szansę i widzą je dokładnie te osoby, które mogą zobaczyć tę
szansę.

Przypomnienia dostarcza worker działający w tle na kolejce
`crm-event-reminders`, który budzi się co 60 sekund i odczytuje z tabeli to,
czego termin już przypadł. **Instancja, w której nie działa proces workerów,
nie dostarcza żadnego przypomnienia**; to, czego termin minął, zostanie
wysłane — z opóźnieniem do 24 godzin — gdy worker zacznie działać. W Redis
jest tylko zegar, więc wyczyszczenie Redis nie gubi żadnego przypomnienia, a
kilka procesów workerów może działać jednocześnie i żadne przypomnienie nie
zostanie wysłane dwa razy.

Dodanie, zmiana ani usunięcie wydarzenia nie publikuje żadnego zdarzenia
platformy i nie jest oferowane webhookom wychodzącym.

## Kalendarz

**CRM → Kalendarz** (`/crm/calendar`) pokazuje wydarzenia z wielu szans
naraz. Otwiera się dla roli z uprawnieniem `crm:read` i jest w palecie
poleceń jako **Kalendarz CRM**.

### Które wydarzenia są widoczne

- **Tylko wydarzenia otwartych szans.** Szansa w statusie, który ją zamyka —
  jako wygraną albo przegraną — nie ma w Kalendarzu żadnego ze swoich
  wydarzeń. Po ponownym otwarciu wracają. Na jej karcie Wydarzenia widać je
  przez cały czas.
- **Tylko wydarzenia szans, które możesz zobaczyć** — jak wszędzie w module.
- **Czyje wydarzenia** — to zależy od zasięgu twojego dostępu:

| Kto | Co pokazuje Kalendarz |
| --- | --- |
| Administrator, który może zobaczyć **każdą** organizację | Wydarzenia każdej otwartej szansy. Przełącznik **Moje / Wszystkie** zawęża Kalendarz do szans przypisanych do tej osoby. Kalendarz otwiera się na *Wszystkie*, gdzie przy każdym wydarzeniu jest też podany handlowiec szansy. |
| Administrator ograniczony do zbioru organizacji — handlowiec | Tylko wydarzenia szans **przypisanych do tej osoby**, w obrębie tych organizacji. Przełącznika nie ma. |

Kalendarz handlowca nigdy nie pokazuje więc szansy innej osoby, nawet z
organizacji, którą mają wspólną — choć handlowiec może taką szansę otworzyć i
przeczytać jej kartę Wydarzenia. Szansy nadal przypisanej do kogoś, kto
stracił dostęp do jej organizacji, również nie ma w jego Kalendarzu.

**Zmiana handlowca przenosi wszystkie wydarzenia szansy naraz.** Wydarzenie
nie ma własnego handlowca: to, w czyim Kalendarzu jest, wynika z tego, do
kogo szansa jest przypisana w chwili odczytu Kalendarza. Po zmianie handlowca
wydarzenia są w Kalendarzu nowej osoby, a u poprzedniej już ich nie ma — nie
trzeba niczego przenosić — a każde przypomnienie, którego termin jeszcze nie
przypadł, trafi do nowego handlowca.

### Widoki i nawigacja

| Widok | Co pokazuje |
| --- | --- |
| **Miesiąc** | Sześć tygodni, od poniedziałku. Do trzech wydarzeń dziennie — całodniowe jako pierwsze — oraz *+N więcej*, które otwiera ten dzień w widoku *Dzień*. |
| **Tydzień** | Siedem dni od poniedziałku: wiersz wydarzeń całodniowych, a pod nim godziny dnia, każde wydarzenie o swojej porze i o swojej długości. Wydarzenia, które się nakładają, stoją obok siebie. Linia wskazuje bieżącą godzinę w dzisiejszym dniu. Widok otwiera się przewinięty do 7:00. |
| **Dzień** | To samo dla jednego dnia. |
| **Lista** | Lista dni, w których są wydarzenia, na 30 dni od wybranej daty. |

- **Dziś**, **Poprzedni** i **Następny** przesuwają o miesiąc, tydzień, dzień
  albo 30 dni, zależnie od widoku; **Przejdź do daty** przenosi do wskazanej
  daty; tytuł nazywa pokazywany zakres.
- Widok, data i wybór *Moje / Wszystkie* są w adresie —
  `/crm/calendar?view=week&date=2026-10-12&scope=mine` — więc odświeżenie
  strony i przesłany odnośnik pokazują to samo. `view` to `month`, `week`,
  `day` albo `agenda`; `scope` to `mine` albo `all`. Wartości domyślnych w
  adresie nie ma, więc sam `/crm/calendar` zawsze otwiera bieżący miesiąc na
  dzisiejszym dniu. Adres z `scope=all` otwarty przez osobę, która nie ma
  takiego wyboru, pokazuje jej własne wydarzenia, a nie błąd.
- **Na telefonie Kalendarz jest Listą.** Przy szerokości poniżej 640 px
  pokazuje listę bez względu na widok podany w adresie i nie ma przełącznika
  widoków.
- **Każde wydarzenie jest odnośnikiem do swojej szansy.** Otwiera szansę na
  karcie **Wydarzenia** z zaznaczonym tym wydarzeniem
  (`/crm/opportunities/:id?tab=events&event=…`). Przy wydarzeniu widać godzinę
  początku, nazwę oraz numer i tytuł szansy; dzwonek oznacza wydarzenie z
  przypomnieniem.
- **Kalendarz niczego nie zmienia.** Nie ma przycisku dodającego wydarzenie i
  niczego nie da się przeciągnąć: wydarzenie dodaje się, edytuje i usuwa w
  jego szansie.

Godziny są podane w strefie czasowej twojej przeglądarki, którą ekran nazywa
pod paskiem narzędzi. Są zapisane tak, jak zapisuje je język twojego Admin UI
— 13:05 po polsku, 01:05 PM po angielsku. Tydzień zaczyna się w poniedziałek
w obu językach.

Gdy w zakresie nic nie zaplanowano, Kalendarz to mówi i proponuje powrót do
dzisiejszego dnia; mówi też, że wczytuje dane i że wczytywanie się nie udało
— wtedy z przyciskiem **Ponów**.

### Limity

- Jeden odczyt obejmuje **najwyżej 45 dni** — tyle, ile potrzeba na sześć
  tygodni miesiąca z zapasem dnia z każdej strony. Szerszy zakres odpowiada
  400, tak samo jak `from` albo `to` spoza zakresu `0001-01-03T00:00:00Z` …
  `9999-12-30T00:00:00Z`.
- Jeden odczyt zwraca **najwyżej 500 wydarzeń**, pierwsze 500 według
  początku. Gdy było ich więcej, Kalendarz informuje, że zakres jest
  niepełny, i proponuje krótszy zakres albo *Moje*.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/calendar/events?from=…&to=…&scope=…` | `crm:read` | Wydarzenia, które nachodzą na zakres od `from` (włącznie) do `to` (wyłącznie) — obie wartości to chwile w formacie ISO 8601 — według początku. `scope` to `mine` albo `all` i jest opcjonalne. |

Odpowiedź to `{ data, meta }`. Pozycja `data` zawiera `id`, `name`, `allDay`,
`startsAt`, `endsAt`, `allDayDate`, `hasReminder` oraz `opportunity` — `id`,
`number`, `title` i `assignee` — i nigdy opisu. `meta` to
`{ scope, scopes, truncated }`: `scope` to zakres faktycznie zastosowany,
`scopes` — te, o które pytająca osoba może prosić, a `truncated` ma wartość
`true`, gdy pasowało więcej niż 500 wydarzeń. **O zakresie decyduje serwer**:
osoba ograniczona do zbioru organizacji dostaje odpowiedź dla `mine`, o
cokolwiek zapytano. Ta trasa nie odpowiada 404 — zwraca tylko to, co pytająca
osoba może zobaczyć.

Wydarzenie całodniowe to data w jego **własnej** strefie czasowej, więc dla
osoby daleko na wschód albo zachód ta data może się zaczynać poza dniami,
które pokazuje jej ekran. Dlatego Admin UI prosi o jeden dzień więcej z
każdej strony tego, co rysuje, a wydarzenie całodniowe umieszcza według
`allDayDate`.

## Analityka

Ekran **CRM → Analityka** pokazuje, jak przebiegały szanse sprzedażowe w
wybranym zakresie dni. Otwiera się dla roli z uprawnieniem `crm:analytics`.

Wybierz zakres — bieżący miesiąc, poprzedni miesiąc, ostatnie 90 dni, bieżący
rok albo dwie własne daty — oraz, jeśli chcesz, jeden kanał sprzedaży i jednego
handlowca. Wszystkie wskaźniki są od razu przeliczane. Kierownik, który ma
dostęp tylko do wybranych organizacji, dostaje wskaźniki wyłącznie dla nich.

| Wskaźnik | Co oznacza | Które szanse są liczone |
| --- | --- | --- |
| Średni czas obsługi szansy | Średni czas od utworzenia szansy do jej zamknięcia. Podawany łącznie dla wszystkich zamkniętych szans oraz osobno dla wygranych i przegranych. | Zamknięte w wybranym zakresie. Szansa otwarta ponownie nie jest liczona, dopóki nie zostanie znów zamknięta. |
| Średni czas w statusie | Jak długo szansa pozostaje w statusie: od zmiany, która ją do niego wprowadziła, do jej następnej zmiany — średnio dla każdego wejścia w ten status. Szansa, która nadal jest w statusie, jest liczona do chwili obecnej. Można wybrać pokazywane statusy albo zobaczyć wszystkie. | Każde wejście w status, które nastąpiło w wybranym zakresie. |
| Najskuteczniejsi handlowcy | Ile szans każdy handlowiec zamknął jako wygrane i ile były warte — za cały zakres oraz miesiąc po miesiącu (miesiące kalendarzowe, w czasie UTC). Handlowiec to osoba, do której szansa jest przypisana **teraz**: szansa przypisana komuś innemu już po wygranej liczy się obecnej osobie. | Zamknięte jako wygrane w wybranym zakresie i przypisane do kogoś. |
| Najcenniejsze szanse | Dziesięć szans o najwyższej wartości, każda z odnośnikiem do szansy. Można wybrać, czy zakres dotyczy daty utworzenia, czy daty zamknięcia. | Utworzone — albo zamknięte — w wybranym zakresie i mające wartość. |
| Średnia wartość szansy | Średnia wartość szansy sprzedażowej. | Utworzone w wybranym zakresie i mające wartość. |

**Kwoty w różnych walutach nigdy nie są sumowane.** Platforma nie ma kursów
walut, dlatego każdy wskaźnik dotyczący wartości jest podawany osobno dla
każdej waluty: średnia dla każdej waluty, lista najcenniejszych szans dla
każdej waluty oraz wartość wygranych szans handlowca dla każdej waluty.

**Wartość** szansy to ta, która jest na niej pokazana: kwota wpisana ręcznie
albo — gdy szansa ma wartość wyliczaną — kwota wyliczona z powiązanych z nią
dokumentów. „Najcenniejsze” oznacza najwyższą wartość i nic więcej: moduł nie
zna kosztów ani marży, więc żaden wskaźnik nie jest tu zyskiem.

**Dni i miesiące są liczone w czasie UTC**, a zakres obejmuje obie swoje daty
w całości.

Czas w statusie i ranking handlowców są przedstawione na wykresach. Pod każdym
wykresem jest tabela z tymi samymi liczbami, więc żadna informacja nie jest
podana wyłącznie na wykresie.

Wskaźniki są obliczane w chwili, gdy ekran o nie pyta; nic nie jest zapisywane
z wyprzedzeniem.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/analytics/handling-time` | `crm:analytics` | `averageSeconds` i `closedCount` oraz ta sama para dla `won` i dla `lost`. |
| `GET /api/v1/admin/crm/analytics/time-in-status` | `crm:analytics` | Wiersz dla każdego statusu: `statusCode`, `averageSeconds`, `sampleCount`. Powtórzony parametr `statusCode=` wybiera statusy; bez niego — wszystkie statusy przepływu w jego kolejności. |
| `GET /api/v1/admin/crm/analytics/rep-effectiveness` | `crm:analytics` | Wiersz dla każdego miesiąca kalendarzowego i handlowca: `month` (`YYYY-MM`), `adminUser`, `wonCount` oraz `wonValue` dla każdej waluty. |
| `GET /api/v1/admin/crm/analytics/top-opportunities` | `crm:analytics` | Szanse o najwyższej wartości: `limit` (domyślnie 10, najwyżej 100) **dla każdej waluty**, w kolejności walut, a potem od najwyższej. `basis=created`, o ile nie podano `basis=closed`. |
| `GET /api/v1/admin/crm/analytics/average-value` | `crm:analytics` | Wiersz dla każdej waluty: `currency`, `average`, `count`. |

Każdy punkt przyjmuje `from` i `to` (`YYYY-MM-DD`) oraz opcjonalnie
`salesChannelId` i `assignedAdminUserId`. Dla zakresu, który kończy się przed
swoim początkiem, odpowiedzią jest 422. Wskaźnik, dla którego nie ma czego
uśredniać, ma wartość `null`, a nie zero.

## Zapytania ofertowe i wartość wyliczana

### Wiązanie zapytań ofertowych

Zapytanie ofertowe wiąże się z szansą sprzedażową tak samo jak zamówienie, tym
samym punktem końcowym, z `"documentKind": "quote_request"`. Musi należeć do
organizacji szansy i należy do co najwyżej jednej szansy. Szansa może mieć
kilka zapytań ofertowych i kilka zamówień.

Powiązane zapytanie ofertowe jest na liście z numerem, statusem i wartością.
**Zapytanie ofertowe pokazuje moduł Zapytania ofertowe**: powiązanie zapytania
i lista zapytań do powiązania wymagają `rfqs:handle` — uprawnienia, z którym
ten moduł odczytuje zapytanie — oprócz `crm:write`; bez niego odpowiedzią jest
`403`. Osoba, która czyta szansę bez `rfqs:handle`, widzi, że zapytanie
ofertowe jest powiązane, i nic poza tym; jest ono na liście jako niedostępne.
Usunięcie powiązania wymaga tylko `crm:write`.
Przełącznik „podążaj za statusem szansy” nic dla niego nie znaczy: zapytanie
ofertowe zachowuje własny status.

**Zamówienie złożone z powiązanego zapytania ofertowego samo dołącza do
szansy.** Gdy klient zamawia zaakceptowane zapytanie ofertowe, zamówienie
zapisuje, z którego zapytania powstało, a jeśli to zapytanie jest powiązane z
szansą, zamówienie zostaje powiązane z tą samą szansą (`linkSource:
"quote_conversion"`) — jeden raz, niezależnie od tego, czy szansa jest jeszcze
otwarta, czy już zamknięta, i niezależnie od ustawienia
`crm.auto_create_from_orders`: takie zamówienie nigdy nie dostaje własnej
szansy. Od tej chwili jest powiązanym zamówieniem jak każde inne: obejmują je
mapowania statusów zamówień, a wartość szansy je uwzględnia.

Zamówienie zapisuje swoje zapytanie ofertowe, gdy zostaje złożone z koszyka,
który klient wypełnił przyciskiem *Złóż zamówienie z tej oferty* na stronie
zaakceptowanego zapytania w storefroncie, o ile zapytanie jest nadal
zatwierdzone, a w koszyku wciąż jest co najmniej jedna pozycja w uzgodnionej
cenie. Dodanie
produktu albo zmiana ilości niczego tu nie zmienia. Z koszyka opróżnionego i
wypełnionego na nowo ręcznie albo takiego, w którym nie została żadna
uzgodniona pozycja, powstaje zwykłe zamówienie: nie wiąże się samo, a zapytanie
ofertowe pozostaje otwarte. Gdy moduł zapytań ofertowych jest wyłączony,
zamówienie jest składane jak zwykle i nie zapisuje żadnego zapytania.

### Wartość szansy

Wartość szansy jest albo **wpisana ręcznie**, albo **wyliczana** z powiązanych
dokumentów — do wyboru dla każdej szansy (`valueMode`: `manual` lub
`computed`). Wpisana kwota zostaje zachowana po przełączeniu na wyliczanie i
wraca po ponownym przełączeniu na tryb ręczny.

Wartość wyliczana to suma:

- każdego powiązanego **zamówienia**, którego status jest statusem liczonym, w
  kwocie **sumy zamówienia** — kwoty brutto, którą płaci klient: towary,
  podatek, dostawa i ewentualna dopłata za płatność, pomniejszone o rabaty;
- każdego powiązanego **zapytania ofertowego**, którego status jest statusem
  liczonym, w kwocie **sumy ilość × cena jednostkowa** po jego pozycjach. Cena
  jednostkowa to cena uzgodniona, a dopóki żadnej nie uzgodniono — cena, o którą
  prosił klient. Ceny w zapytaniach ofertowych są **netto** — to kwota, którą
  ekran zapytania ofertowego pokazuje jako sumę netto.

Te dwie kwoty nie mają tej samej podstawy i żadna nie jest przeliczana: każdy
dokument liczy się w kwocie, którą pokazuje jego własny ekran.

**Liczone raz.** Zamówienie złożone z powiązanego zapytania ofertowego i to
zapytanie to jedna transakcja: dopóki liczy się zamówienie, zapytanie ofertowe
jest pomijane, więc wartością jest kwota zamówienia, a nie suma obu. Zamówienie
i zapytanie ofertowe, które są powiązane z szansą, ale nie mają ze sobą nic
wspólnego, są liczone oba.

**Jedna waluta.** Szansa ma jedną walutę i nic nie jest przeliczane. Dokument w
innej walucie, który w przeciwnym razie by się liczył, jest pomijany, a szansa
go wskazuje: `excludedDocuments` na szansie wymienia każdy taki dokument jako
`{ kind, id, reason: "currency_mismatch" }`. Zapytanie ofertowe z pozycjami w
kilku walutach liczy pozycje w walucie szansy i również jest wskazywane.

Wartość podąża za dokumentami: jest przeliczana, gdy dokument zostaje powiązany
albo odwiązany, gdy powiązane zamówienie zmienia status, gdy powiązane
zapytanie ofertowe zostaje zmienione, zatwierdzone, anulowane albo wygasa, oraz
gdy tryb zmienia się na wyliczany. Wartość podąża za **statusem** zamówienia,
nie za jego kwotą: zamówienie, którego suma zmieniła się bez zmiany statusu,
oraz zapytanie ofertowe, które przechodzi w status `Completed`, zostaną
uwzględnione przy najbliższym przeliczeniu. Przeliczenie nie jest wpisem w
historii szansy.

**Ekran samej szansy zawsze pokazuje aktualną kwotę.** Otwarcie szansy wylicza
jej wartość z powiązanych dokumentów w ich bieżącym stanie i zleca
przeliczenie, gdy zapisana kwota jest inna. Lista, tablica i analityka czytają
kwotę zapisaną, więc mogą pozostawać w tyle za ekranem szansy, dopóki
przeliczenie w tle się nie wykona — zwykle chwilę, a dłużej, gdy kolejka jest
zajęta albo jej proces nie działa.

### Które statusy się liczą

To, które statusy sprawiają, że dokument się liczy, jest częścią konfiguracji
przepływu, i **nic się nie liczy, dopóki nie zostanie to ustawione**: przy
pustej konfiguracji wartość wyliczana wynosi 0.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `PUT /api/v1/admin/crm/value-counting-statuses` | `crm:configure` | Zastąpienie zbioru: `{ "order": ["paid", "completed"], "quoteRequest": ["Approved"] }`. |

`order` zawiera kody statusów zamówień; `quoteRequest` — dowolne z `Created
from admin`, `Pending`, `Canceled`, `Approved`, `Completed`, `Expired`.
Bieżący zbiór to `valueCountingStatuses` w odpowiedzi
`GET /api/v1/admin/crm/workflow`.

Punkt końcowy odpowiada **202**: zbiór jest zapisany, a każda szansa z
wartością wyliczaną jest następnie przeliczana w tle (kolejka
`crm-value-recalculation`). Do tego czasu szanse pokazują kwoty poprzedniej
konfiguracji.

### Gdy moduł Zapytań ofertowych jest wyłączony

CRM nie wymaga modułu Zapytań ofertowych. Gdy jest on wyłączony:

- szanse, ich zamówienia i wszystko inne działają dalej;
- powiązane zapytanie ofertowe nadal jest na liście, jako **niedostępne** — bez
  numeru, statusu i wartości;
- nie dodaje niczego do wartości wyliczanej;
- próba powiązania zapytania ofertowego kończy się odpowiedzią
  `503 MODULE_DISABLED`; istniejące powiązanie nadal można usunąć.

Nic nie ginie: po ponownym włączeniu powiązania znów pokazują swoje dokumenty.
Wartość wyliczana uwzględni zapytania ofertowe przy najbliższym przeliczeniu.

### W Admin UI

Na ekranie szansy sprzedażowej:

- **Powiązane zapytania ofertowe**, na karcie **Powiązania** — lista z numerem,
  statusem i wartością netto każdego z nich, pod sekcją *Powiązane
  zamówienia*. Posiadacz
  uprawnienia `crm:write` wyszukuje zapytania ofertowe organizacji po numerze
  i wiąże je albo odłącza. Wyszukiwarka podpowiada zapytania otwarte; zamknięte
  znajdziesz, wpisując jego pełny numer. Powiązanie wymaga także
  `rfqs:handle`; bez niego sekcja informuje o tym, zamiast pokazywać
  wyszukiwarkę.
- **Wartość**, w panelu informacji po prawej — kwota oraz informacja, czy
  jest *wpisana ręcznie*, czy jest to *wartość wyliczana*; jeden przycisk przełącza między nimi. Przy wartości
  wyliczanej widać każdy dokument **pominięty** w sumie, wraz z powodem, oraz
  przypomnienie, że Twój własny szacunek jest zachowany.

Na ekranie **CRM → Statusy i przepływ** sekcja *Statusy liczone do wartości
wyliczanej* to dwie listy pól wyboru — statusy zamówień i statusy zapytań
ofertowych — zapisywane razem. Przycisk *Ten i wszystkie kolejne* zaznacza
status zamówienia i wszystkie następne. Po zapisaniu ekran informuje, że
wartości są przeliczane w tle: dopóki przeliczanie się nie zakończy, listy
i tablica pokazują jeszcze kwoty według poprzednich ustawień.

Gdy moduł Zapytania ofertowe jest wyłączony, lista zapytań znika z szansy,
która żadnego nie ma; szansa, która je ma, pokazuje je jako niedostępne
i wyjaśnia dlaczego, a ekran przepływu proponuje wyłącznie statusy zamówień.

## Szanse tworzone automatycznie

Dwa ustawienia sprawiają, że CRM sam otwiera szansę sprzedażową. Oba są
domyślnie **wyłączone**, a włącza się je na ekranie **Ustawienia** platformy,
w grupie *CRM*. Ich nazwy są tam wyłącznie po angielsku: ustawienia platformy
nie mają jeszcze tłumaczonych etykiet.

| Ustawienie | Gdy jest włączone |
| --- | --- |
| `crm.auto_create_from_orders` | Każde zamówienie złożone od tej chwili dostaje własną szansę. Ustawienie może być różne dla kanałów sprzedaży; decyduje kanał zamówienia. |
| `crm.auto_create_from_quote_requests` | Każde zapytanie ofertowe utworzone od tej chwili — przesłane przez klienta albo przygotowane przez administratora — dostaje własną szansę. Wymaga włączonego modułu Zapytań ofertowych. |

Szansa utworzona w ten sposób:

- należy do organizacji dokumentu, a w przypadku zamówienia — do kanału
  sprzedaży zamówienia;
- zaczyna w statusie początkowym przepływu;
- jest przypisywana zgodnie z regułą domyślną — do najdłużej przypisanego,
  aktywnego handlowca organizacji, który dostaje powiadomienie — albo do nikogo,
  gdy organizacja żadnego nie ma;
- ma w tytule numer dokumentu i nazwę organizacji;
- jest powiązana z dokumentem, a jej wartość jest z niego **wyliczana** (patrz
  *Zapytania ofertowe i wartość wyliczana*), w walucie dokumentu;
- zapisuje, skąd pochodzi: `source` ma wartość `order` albo `quote_request`.

Co **nie** jest tworzone:

- nic dla dokumentu, który jest już powiązany z szansą;
- nic dla zamówienia, które zapisuje zapytanie ofertowe powiązane z szansą —
  zamówienie dołącza do tej szansy, niezależnie od ustawień (zob. *Wiązanie
  zapytań ofertowych*);
  zamówienie nie zapisuje swojego zapytania ofertowego, więc to jeszcze nie
  działa (zob. *Wiązanie zapytań ofertowych*);
- nic dla dokumentów, które istniały przed włączeniem ustawienia;
- nic, gdy moduł CRM jest wyłączony, i nic później dla dokumentów złożonych w
  tym czasie;
- nic dla zamówienia ani zapytania ofertowego utworzonego z poziomu szansy:
  taki dokument zostaje powiązany z tą szansą, niezależnie od ustawień (zob.
  *Tworzenie zamówienia albo zapytania ofertowego z poziomu szansy*).

Zamówienie albo zapytanie ofertowe, które administrator tworzy w imieniu
klienta na ekranie samego dokumentu, jest dokumentem jak każdy inny i dostaje
swoją szansę.

Każdy dokument dostaje co najwyżej jedną szansę, bez względu na to, ile razy
jego złożenie zostanie ogłoszone.

Szansa dla zapytania ofertowego nie ma kanału sprzedaży, a jej ustawienie jest
odczytywane dla całej platformy, nie dla kanału: moduł Zapytań ofertowych nie
publikuje kanału, w którym zapytanie zostało przesłane.

## Tworzenie zamówienia albo zapytania ofertowego z poziomu szansy

Na karcie **Powiązania** szansy sekcja *Powiązane zamówienia* ma przycisk
**Utwórz zamówienie**, a sekcja *Powiązane zapytania ofertowe* — przycisk
**Utwórz zapytanie ofertowe**. Każdy otwiera własny ekran tworzenia platformy —
ten z **Zamówień** albo z **Zapytań ofertowych** — od razu zawężony do
organizacji szansy: wyszukiwanie klienta podpowiada osoby z tej organizacji,
osoba kontaktowa szansy jest już wybrana, a w zamówieniu także jej kanał
sprzedaży.

Wypełnij ekran jak zwykle i zapisz. Wracasz do szansy, na jej kartę
**Powiązania**, która informuje, że nowy
dokument jest właśnie wiązany, a potem — że został powiązany; od tej chwili
jest na jej liście, a w historii zmian ma oznaczenie *Utworzono z tej szansy*.
Tak utworzone zamówienie podąża za statusem szansy jak każde powiązane
zamówienie, a oba rodzaje dokumentów liczą się do wartości wyliczanej.

Czego się spodziewać:

- **Bez drugiej szansy.** Przy włączonym tworzeniu automatycznym dokument
  utworzony z poziomu szansy zostaje powiązany z tą szansą i nie dostaje
  własnej.
- **Tylko ta sama organizacja.** Ekran tworzenia pozwala wybrać dowolnego
  klienta, którego widzisz. Jeśli zapiszesz dokument dla klienta innej
  organizacji, dokument powstanie, ale **nie** zostanie powiązany: po powrocie
  szansa o tym informuje i podaje odnośnik do dokumentu. W samej szansie nic
  się nie zmienia.
- **Kto widzi przyciski.** *Utwórz zamówienie* wymaga `crm:write` i
  `orders:write`; *Utwórz zapytanie ofertowe* wymaga `crm:write` i
  `rfqs:handle`. Ekrany tworzenia wyszukują też klientów, co wymaga
  `customers:read`.
- **Gdy moduł Zapytań ofertowych jest wyłączony**, przycisku *Utwórz zapytanie
  ofertowe* nie ma. *Utwórz zamówienie* działa bez zmian.
- **Gdy moduł CRM jest wyłączony**, ekrany tworzenia działają dokładnie tak
  jak zawsze i nic nie jest wiązane — ani wtedy, ani później.

Dla integratorów: powiązanie tworzą subskrybenci modułu nasłuchujący zdarzeń
`order.created.v1` i `rfq.created_by_admin.v1`, na podstawie pola `origin`,
które te zdarzenia niosą — `{ type: 'crm_opportunity', id: <id szansy> }`.
Moduły Zamówień i Zapytań ofertowych przekazują tę wartość dalej, nie czytając
jej. Moduł CRM wiąże tylko wtedy, gdy szansa istnieje i należy do tej samej
organizacji co dokument oraz — tam, gdzie zdarzenie wskazuje administratora,
który utworzył dokument, jak robi to zdarzenie zapytania ofertowego — gdy ten
administrator ma dostęp do organizacji szansy; w przeciwnym razie zapisuje
ostrzeżenie w logu i traktuje dokument jak utworzony bez pola `origin`.
Zdarzenie dostarczone dwukrotnie wiąże raz. Żaden punkt końcowy modułu CRM nie
bierze w tym udziału, a samodzielne wysłanie `origin` w żądaniu do
któregokolwiek z punktów końcowych tworzenia ma ten sam skutek.

## Historia zmian

Każda szansa sprzedażowa ma historię tego, co się z nią działo, od najnowszych
wpisów: jej utworzenie, każda edycja, każda zmiana statusu, każde powiązanie i
odwiązanie zamówienia lub zapytania ofertowego, każde przypisanie, zmiana
etykiet, notatka, wiadomość, załącznik i wydarzenie.

Każdy wpis mówi, **kiedy**, **co** (`action`), **kto** (`actor`) oraz jaki był
stan **przed** i **po**:

- `actor.kind` ma wartość `admin` z identyfikatorem i imieniem osoby albo
  `system` — nikt nie zrobił tego ręcznie: szansę przesunęło zamówienie albo
  szansa została utworzona automatycznie;
- zmiana statusu zawiera `before.status` i `after.status`, przyczynę
  (`after.cause`: `manual`, `order_status` albo `system`), zamówienie, które ją
  spowodowało, jeśli było nim zamówienie (`after.causeOrderId`), oraz wpisany
  przez kogoś powód;
- edycja zawiera pola w brzmieniu sprzed zmiany i po niej.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/history` | `crm:read` | Historia zmian, od najnowszych. `limit` (domyślnie 50, najwyżej 200) i `cursor` służą do stronicowania. |

Historia zmian to ślad audytowy platformy dla tej szansy, więc nie może
rozminąć się z tym, co się wydarzyło — a **każdy, kto może czytać szansę, może
czytać jej historię**. Uprawnienie otwierające dziennik audytu całej platformy
nie jest potrzebne.

Pięć rzeczy, o których warto wiedzieć:

- Notatka albo wiadomość jest w historii jako fakt, że została napisana,
  zmieniona albo usunięta — przez kogo i jak była długa. Jej treści tam nie
  ma: czyta się ją na kartach *Notatki* i *Wiadomości*.
- Wydarzenie jest w historii z nazwą i godzinami, ale nigdy z treścią opisu.
  Wysłanie przypomnienia nie jest wpisem.
- Przeliczenie wartości wyliczanej nie jest wpisem: wpisem jest zmiana, która
  je spowodowała — powiązanie, status zamówienia.
- Wpis, który zawiera opis — utworzenie szansy, edycja opisu — zawiera także
  `references`, dokładnie tak jak sama szansa: jak nazywają się osoby,
  zamówienia i produkty wspomniane w tym tekście, dla czytającego. Tekst jest
  zwracany tak, jak został zapisany.
- Historia sięga 499 wpisów wstecz. Gdy szansa ma ich więcej, ostatnia strona
  zwraca `"truncated": true` obok `pagination`, a karta informuje, że istnieją
  wcześniejsze zmiany, które nie są pokazane; w przeciwnym razie wartość to
  `false`, a karta informuje, że to cała historia. `hasMore` oznacza wyłącznie
  to, że jest następna strona, o którą można zapytać.

Na ekranie **Dziennik audytu** całej platformy te same wpisy są pokazywane
wśród wszystkich pozostałych, jako te same zdania.

W Admin UI historia to karta **Historia zmian** szansy sprzedażowej. Każdy
wpis jest zdaniem — *Zmieniono status szansy sprzedażowej*, *Dodano notatkę* —
z informacją, kto i kiedy to zrobił. Zmiana statusu pokazuje oba statusy z
nazwy; jeśli spowodowało ją zamówienie, wpis wskazuje to zamówienie i prowadzi
do niego. Edycja wymienia zmienione pola: jak było i jak jest. Wartości pól
niestandardowych są wymienione po jednej w wierszu, pod własnymi etykietami pól
— albo pod ich kodami dla osoby bez `custom_fields:read` — a status zamówienia
jest pokazywany z nazwy, wyłącznie osobie z uprawnieniem `orders:read`.
Zmieniony opis czyta się tak jak na karcie *Przegląd*: wspomniana w nim osoba,
zamówienie albo produkt są pokazywane z nazwy, nigdy jako znacznik. Przycisk
*Pokaż wcześniejsze zmiany* wczytuje kolejną stronę.

## Odwołania do produktów i zamówień

Opis szansy sprzedażowej, notatka i wiadomość mogą wspominać **produkt** albo
**zamówienie**. Wzmianka to znacznik w tekście:

```text
[[product:<identyfikator produktu>]]
[[order:<identyfikator zamówienia>]]
```

Tekst jest zapisywany i zwracany dokładnie tak, jak został napisany — jako
zwykły tekst; nic w nim nie jest traktowane jak znaczniki HTML. Obok każdego
takiego tekstu API zwraca `references`: jeden wpis na każdy wspomniany produkt
lub zamówienie, w kolejności występowania, każdy raz.

```json
{
  "type": "product",
  "id": "5d0c…",
  "available": true,
  "label": "Folia stretch 500 mm",
  "url": "/catalog/products/5d0c…"
}
```

- `label` to **aktualna** nazwa produktu w języku czytającego albo numer
  zamówienia — sprawdzane przy każdym odczycie tekstu, więc produkt po zmianie
  nazwy pokazuje nową nazwę.
- `url` to miejsce, do którego wzmianka prowadzi w Admin UI.
- Produkt, który już nie istnieje, oraz zamówienie organizacji niedostępnej dla
  czytającego wracają z `"available": false`, **bez nazwy i bez odnośnika**.
  Wzmianka zostaje w tekście; nic o jej celu nie jest pokazywane.

Znacznik, który nie jest poprawny — nieznany typ, coś, co nie jest
identyfikatorem — jest po prostu tekstem.

`references` znajduje się na szansie (dla jej `description`) oraz na każdej
notatce i wiadomości (dla jej `body`). Nie ma osobnego punktu końcowego.

W Admin UI pole opisu oraz pola notatki i wiadomości mają pod sobą przyciski,
wśród nich **Wstaw zamówienie** i **Wstaw produkt**. Każdy otwiera
wyszukiwarkę; wybranie
wyniku wstawia go do tekstu w miejscu kursora — **jako nazwę, nigdy jako
znacznik**: podczas pisania pole pokazuje numer zamówienia albo nazwę produktu
jako małą etykietę, a znacznik jest tylko tym, co zostaje zapisane. Po zapisaniu
tekst pokazuje w tym miejscu tę nazwę jako odnośnik, a dla celu, który zniknął
albo którego nie możesz zobaczyć — *Produkt niedostępny* /
*Zamówienie niedostępne* — zarówno w zapisanym tekście, jak i w polu otwartym
do edycji; to, czego nie widzisz, jest zapisywane z powrotem bez zmian. Nazwę widzi tylko osoba, która mogłaby otworzyć sam
cel: numer zamówienia wymaga `orders:read`, a nazwa produktu —
`catalog:read`.

Obie wyszukiwarki należą do katalogu i do modułu Zamówienia, dlatego przycisk
*Wstaw produkt* widzi rola, która ma także `catalog:read`, a *Wstaw
zamówienie* — rola z `orders:read`; proponowane są wyłącznie zamówienia
organizacji tej szansy. Znacznik wpisany albo wklejony ręcznie jest zapisywany
bez żadnego z tych uprawnień, a osobie bez uprawnienia pokazuje się jako
niedostępny.

## Wspominanie osoby, zamówienia albo produktu przez @

Te same trzy pola — opis, notatka, wiadomość — przyjmują wzmiankę prosto z
klawiatury:

| Wpisz | Aby wspomnieć | Dostępne dla |
| --- | --- | --- |
| `@` | **osobę** — użytkownika Admin UI, który może czytać szanse sprzedażowe | każdego, kto pisze tekst |
| `@@` | **zamówienie** organizacji tej szansy | roli, która ma także `orders:read` |
| `@@@` | **produkt** | roli, która ma także `catalog:read` |

Wpisz `@` na początku tekstu albo po spacji, a lista otworzy się **tam, gdzie
piszesz** — pod tym wierszem albo nad nim, gdy poniżej nie ma miejsca; pisz
dalej, aby ją zawęzić — imię, nazwisko, numer zamówienia, nazwa albo SKU
produktu. **Strzałki** poruszają po liście, **Enter** albo **Tab** wybiera,
**Escape** zamyka ją i zostawia to, co wpisano. Wybór zastępuje `@` i litery
po nim wzmianką — pokazywaną jako **@Tomasz Nowak**, jako numer zamówienia albo
jako nazwa produktu — a zdanie pisze się dalej:

```text
@Tomasz Nowak - przejmij temat
```

**Pole pokazuje nazwy, nigdy znaczniki** — dla wzmianki właśnie wybranej i dla
każdej, która już jest w tekście otwartym do edycji. Wzmianka zachowuje się jak
jeden znak: strzałki ją przeskakują, a **Backspace** albo **Delete** usuwa ją w
całości. Pole jest zwykłym tekstem — wklejana treść trafia do niego jako tekst,
z podziałem na wiersze i bez formatowania — a **Ctrl+Z** / **Ctrl+Shift+Z**
cofają i ponawiają zmiany, przy czym wzmianka to jeden krok. Znacznik wpisany
albo wklejony ręcznie zamienia się w nazwę, gdy pole ją zna, a w przeciwnym
razie zostaje taki, jak go wpisano, i jest rozpoznawany przy zapisie tekstu.
Szybko wpisane `@@` albo `@@@` otwiera tylko tę listę, o którą chodzi;
pojedynczy `@` otwiera listę osób po krótkiej chwili.

Znak `@` w środku wyrazu — adres e-mail — niczego nie otwiera, podobnie jak
`@`, po którym następuje spacja. Skrót, którego Twoja rola nie ma, zostawia
znaki dokładnie tak, jak je wpisano. Wiersz pod polem wymienia skróty, które
masz, a przycisk **Wspomnij osobę** obok *Wstaw zamówienie* i *Wstaw produkt*
robi to samo.

Wzmianka o osobie jest zapisywana tak jak dwie pozostałe, jako znacznik, i
wraca w `references`:

```text
[[admin_user:<identyfikator administratora>]]
```

```json
{
  "type": "admin_user",
  "id": "8a1f…",
  "available": true,
  "label": "Tomasz Nowak",
  "url": null
}
```

- `label` to **aktualne** imię i nazwisko osoby. Każdy, kto czyta tekst, widzi
  je jako **@Tomasz Nowak**, wyróżnione w zdaniu.
- `url` ma zawsze wartość `null`: wzmianka o osobie nie jest odnośnikiem.
- Osoba, która została w międzyczasie usunięta albo dezaktywowana, wraca z
  `"available": false`, bez imienia i nazwiska, i jest pokazywana jako *Osoba
  niedostępna*.

**Kogo można wspomnieć.** Lista proponuje aktywnych administratorów, którzy
mają `crm:read` i widzą organizację tej szansy — wzmianka to wezwanie, żeby
przyjść i spojrzeć, więc dotyczy tylko kogoś, kto może to zrobić.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/lookups/mentionable?q=…&organizationId=…` | `crm:write` | Osoby, które można wspomnieć w tekście, według imienia i nazwiska: `id`, `name`. Z `organizationId` — tylko osoby, które widzą tę organizację, i nikt, gdy nie widzi jej pytający. |

**Kto dostaje powiadomienie.** Gdy opis, notatka albo wiadomość zostają
zapisane, każda wspomniana osoba, **o której nie wspominał tekst zastępowany**,
dostaje jeden wpis na dzwonku powiadomień, z odnośnikiem do szansy:

```text
Anna Kowalska mentioned you in opportunity OPP-000042
```

- Wpis nazywa szansę jej numerem, a autora — imieniem i nazwiskiem. Nie zawiera
  niczego z treści.
- Jeden wpis na osobę przy jednym zapisie, niezależnie od tego, ile razy tekst
  ją wymienia. Ponowne zapisanie tego samego tekstu albo przeredagowanie go
  wokół tej samej wzmianki nie powiadamia nikogo; usunięcie wzmianki i
  przywrócenie jej powiadamia tę osobę ponownie.
- **Nikt nie dostaje powiadomienia o wspomnieniu samego siebie**, a wpis nie
  powstaje dla osoby, która nie ma `crm:read`, została dezaktywowana albo nie
  widzi organizacji szansy. Znacznik jest tekstem i można go wpisać ręcznie,
  dlatego rozstrzyga się to przy zapisie tekstu, a nie na liście.
- W wiadomości wspomniana osoba dostaje ten wpis **zamiast** wpisu, który
  dostaje uczestnik rozmowy — nie oba.
- Wpis jest wyświetlany w języku czytającego — wiersz powyżej to jego postać
  angielska — i nie powstaje, gdy moduł **Powiadomienia administratora** jest
  wyłączony; tekst jest zapisywany tak samo.

Wzmianka nie zmienia niczego więcej: nie przypisuje szansy, nie daje nikomu
dostępu do niej i nie jest częścią żadnego zdarzenia ani webhooka.

## Powiadamianie innych systemów: webhooki

Trzy rzeczy, które dzieją się z szansą sprzedażową, mogą być wysyłane do innego
systemu przez **webhooki** platformy: jej utworzenie, zmiana statusu i
zamknięcie. Na ekranie *Webhooki* pojawiają się wśród typów zdarzeń, które
subskrypcja może wybrać, i są dostarczane jak każdy inny webhook — podpisane,
ponawiane, widoczne na liście wysyłek.

| Typ zdarzenia | Wysyłane, gdy |
| --- | --- |
| `crm.opportunity.created.v1` | szansa zostaje utworzona — ręcznie albo automatycznie |
| `crm.opportunity.status_changed.v1` | szansa przechodzi do innego statusu, bez względu na to, co ją przesunęło |
| `crm.opportunity.closed.v1` | szansa wchodzi w status, który ją zamyka — jako wygraną albo przegraną |

Zamknięcie jako wygrana i jako przegrana to **jedno** zdarzenie: o tym, które,
mówi `outcome`. Przejście do statusu zamykającego wysyła zarówno
`status_changed`, jak i `closed`.

**Wysyłane jest samo zdarzenie**, dokładnie z tymi polami i żadnym innym:

```json
{
  "eventId": "8f0c2c2e-3f0b-4d0a-9a55-0d5e6b7a1c11",
  "occurredAt": "2026-10-05T12:00:00.000Z",
  "opportunityId": "5d0c7c1e-6a0f-4f55-8a53-0f3f7cbe0a01",
  "number": "OPP-000123",
  "organizationId": "6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02",
  "source": "manual"
}
```

`crm.opportunity.created.v1` — `source` ma wartość `manual`, `order` albo
`quote_request`.

```json
{
  "eventId": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
  "occurredAt": "2026-10-05T12:05:00.000Z",
  "opportunityId": "5d0c7c1e-6a0f-4f55-8a53-0f3f7cbe0a01",
  "number": "OPP-000123",
  "organizationId": "6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02",
  "salesChannelId": null,
  "from": "negotiation",
  "to": "won",
  "fromKind": "open",
  "toKind": "won",
  "actor": { "kind": "admin", "adminUserId": "0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01" },
  "cause": "manual",
  "reason": "Contract signed"
}
```

`crm.opportunity.status_changed.v1` — `actor.kind` ma wartość `admin` (z
`adminUserId`) albo `system`; `cause` to `manual`, `order_status` albo `system`,
a gdy zmianę spowodowało zamówienie, wskazuje je `causeOrderId`. `reason` to
krótki tekst wpisany przez kogoś przy tej zmianie albo `null`.

```json
{
  "eventId": "c3a1f0de-52c7-4d0c-8a44-2f7e7a9f3b10",
  "occurredAt": "2026-10-05T12:05:00.000Z",
  "opportunityId": "5d0c7c1e-6a0f-4f55-8a53-0f3f7cbe0a01",
  "organizationId": "6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02",
  "outcome": "won",
  "value": "1500.00",
  "currency": "PLN"
}
```

`crm.opportunity.closed.v1` — `outcome` ma wartość `won` albo `lost`; `value`
to wartość szansy w chwili zamknięcia albo `null`, gdy szansa jej nie ma.

Na czym można polegać:

- **Żaden wolny tekst szansy nie jest nigdy wysyłany**: ani tytuł, ani opis,
  ani notatka, ani wiadomość. Jedynym tekstem jest `reason`, czyli to, co
  wpisano przy jednej zmianie statusu.
- **`organizationId` jest zawsze obecne**, więc subskrypcja przypisana do
  jednej organizacji dostaje tylko szanse tej organizacji.
- **Wersja jest w nazwie.** Zdarzenie `.v1` zachowuje swoje pola. Pole może
  zostać do niego dodane; jeśli kiedyś trzeba będzie jakieś usunąć albo
  zmienić jego nazwę, będzie to nowe zdarzenie `.v2`, oferowane obok starego.

Gdy moduł Webhooków jest wyłączony, szanse działają jak zawsze i nic nie jest
wysyłane — a to, co wydarzyło się w tym czasie, nie jest wysyłane później. Gdy
wyłączony jest moduł CRM, jego trzy typy zdarzeń nie są oferowane; subskrypcja,
która wskazuje któryś z nich, zostaje zachowana i po prostu nic nie dostaje,
dopóki CRM nie wróci.

## Pola niestandardowe

Szansa sprzedażowa może mieć Twoje własne pola — „Źródło kontaktu”,
„Konkurent”, „Data decyzji” — definiowane bez wdrożenia.

**Definiowanie.** Otwórz **Pola niestandardowe** w Admin UI i
wybierz typ rekordu **Szansa sprzedażowa**. Pole ma klucz, etykietę w każdym
języku, typ (tekst, liczba, tak/nie, data, jedna pozycja z listy, kilka pozycji
z listy) i może być wymagane. To istniejący ekran pól niestandardowych
platformy; szanse sprzedażowe są na nim kolejnym typem rekordu, obok zamówień,
organizacji, klientów i zapytań ofertowych.

**Wypełnianie.** Pola pojawiają się w formularzu tworzenia szansy oraz w sekcji
**Pola niestandardowe** na karcie *Przegląd* szansy, z etykietami w Twoim
języku. Na ekranie szansy mają własny przycisk **Zapisz pola niestandardowe**;
w formularzu tworzenia zapisują się razem z szansą.

- Wartość niezgodna z definicją pola — puste pole wymagane, pozycja spoza
  listy, tekst zamiast liczby — jest odrzucana, a komunikat pojawia się przy tym
  polu. Nic nie zostaje zapisane.
- Pole wymagane trzeba wypełnić przy ręcznym tworzeniu szansy oraz przy każdym
  zapisie pól niestandardowych. Zmiana czegokolwiek innego — tytułu, wartości,
  statusu — nigdy go nie wymaga, więc pole oznaczone dziś jako wymagane nie
  blokuje pracy nad wczorajszymi szansami.
- Szansa utworzona automatycznie nie ma wartości niestandardowych, dopóki ktoś
  ich nie uzupełni.
- Po usunięciu pola jego wartości przestają być pokazywane.

**Kto je widzi.** Wartości niestandardowe widzi każdy, kto widzi szansę, i nikt
inny: są częścią szansy. Do wyświetlenia pól potrzebne jest także uprawnienie
`custom_fields:read`, bo lista pól pochodzi z modułu Pola niestandardowe — rola
z uprawnieniem `crm:read` powinna je mieć. Osoba bez niego nie widzi sekcji pól
niestandardowych; jeśli pole wymagane odrzuci jej nową szansę, formularz wskaże
to pole w komunikacie o błędzie.

**Dla integratorów.** `POST` i `PATCH /api/v1/admin/crm/opportunities`
przyjmują opcjonalny obiekt `customFieldValues` z kluczami pól, a szansa zwraca
`customFieldValues`. W `PATCH` obiekt wymienia pola, które zmienia; pominięcie
go pozostawia wszystkie wartości bez zmian. Odrzucona wartość daje odpowiedź
`422 CUSTOM_FIELD_VALUE_INVALID` z jednym wpisem `{ path, issue }` na pole.
Zapis jest częścią wpisu audytowego samej szansy — osobnego wpisu nie ma.

**Gdy CRM jest wyłączony**, *Szansa sprzedażowa* nie jest oferowana na ekranie
pól niestandardowych, istniejące definicje jej pól są **ukryte** — nie ma ich
na liście, a odczyt definicji po identyfikatorze odpowiada `404` — i żadnej nie
można utworzyć, zmienić ani usunąć (`409`). Nic nie jest usuwane: ponowne
włączenie CRM przywraca definicje i wszystkie zapisane wartości.

## Szanse sprzedażowe na ekranie organizacji

Ekran organizacji kończy się panelem **Otwarte szanse sprzedażowe**: szanse
prowadzone z tą organizacją, które nie zostały jeszcze wygrane ani przegrane, od
najnowszej — każda z numerem i tytułem (odnośnik do szansy), statusem i
wartością. **Nowa szansa** otwiera formularz tworzenia z wybraną już
organizacją.

- Panel widzi każdy, kto ma uprawnienie `crm:read`; **Nowa szansa** wymaga
  `crm:write`.
- Panel pokazuje dziesięć najnowszych szans, a gdy jest ich więcej, prowadzi do
  listy szans.
- Osoba ograniczona do wybranych organizacji widzi panel tylko na ekranach tych
  organizacji — tak jak każdą inną listę szans.
- Gdy CRM jest wyłączony, ekran organizacji nie pokazuje niczego z CRM — ani
  panelu, ani nagłówka, ani żadnego zapytania.

Ostatnia aktywność na pulpicie nazywa szansę jej tytułem i prowadzi do jej
ekranu. Gdy CRM jest wyłączony albo gdy ktoś nie może zobaczyć danej szansy,
wpis pozostaje, ale bez tytułu i bez odnośnika.

## Szansa na ekranie zamówienia i zapytania ofertowego

Ekran zamówienia kończy się panelem **Powiązana szansa**, niezależnie od
otwartej karty.

- **Zamówienie powiązane z szansą** pokazuje numer i tytuł szansy (odnośnik do
  niej), jej status, przypisanego handlowca i wartość.
- **Zamówienie niepowiązane** informuje o tym i daje osobie z uprawnieniem
  `crm:write` dwie akcje:
  - **Powiąż z szansą** wyświetla otwarte szanse organizacji, do której należy
    zamówienie (sto najnowszych); wybierz jedną i potwierdź. Zamówienie należy
    najwyżej do jednej szansy i tylko do szansy własnej organizacji — odmowa
    jest pokazywana w panelu.
  - **Utwórz szansę** otwiera formularz tworzenia z wybraną organizacją
    zamówienia. Po zapisaniu szansy zamówienie zostaje z nią powiązane, a
    szansa się otwiera. Jeśli powiązanie zostanie odrzucone, szansa i tak jest
    już utworzona: formularz o tym informuje i prowadzi do niej, a zamówienie
    można powiązać z ekranu samej szansy.
- Panel widzi każdy, kto ma uprawnienie `crm:read`. Bez niego oraz przy
  wyłączonym CRM ekran zamówienia wygląda dokładnie tak jak bez modułu — bez
  panelu, nagłówka, pustego miejsca i bez żadnego zapytania.

**Ekran zapytania ofertowego kończy się takim samym panelem**, dla zapytania
ofertowego: pokazuje szansę, z którą jest ono powiązane, albo — osobie z
`crm:write` — *Powiąż z szansą* i *Utwórz szansę*, które niosą zapytanie
ofertowe zamiast zamówienia. Kto jest na tym ekranie, ma `rfqs:handle`, którego
wymaga powiązanie zapytania ofertowego. Gdy moduł Zapytań ofertowych jest
wyłączony, nie ma ani tego ekranu, ani panelu; panel zamówienia działa bez
zmian.

Dla integratorów: `GET /api/v1/admin/crm/documents/order/{orderId}/opportunity`
(`crm:read` i `orders:read`) zwraca `{ "data": <podsumowanie szansy> }` albo `{ "data": null }`
dla zamówienia bez powiązania. Zamówienie, które nie istnieje albo którego
wywołujący nie może zobaczyć, daje `404 CRM_DOCUMENT_NOT_FOUND` — tę samą
odpowiedź w obu przypadkach, niezależnie od tego, czy jest powiązane. Rodzaj
inny niż rodzaj dokumentu daje `422`.
`…/documents/quote_request/{quoteRequestId}/opportunity` odpowiada tak samo dla
zapytania ofertowego i wymaga `crm:read` oraz `rfqs:handle`; gdy moduł Zapytań
ofertowych jest wyłączony, odpowiada `503 MODULE_DISABLED` — każdemu. Formularz
tworzenia przyjmuje w adresie `linkDocumentKind=order` albo `quote_request` i
`linkDocumentId=<id dokumentu>` obok `organizationId`.

Dla autorów modułów: panel jest wkładem CRM do stref Admin UI
`order.detail.after` i `quote_request.detail.after`, które osadzają moduły
Zamówienia i Zapytania ofertowe i do których może wnosić każdy moduł. Żaden z
nich nie importuje CRM ani nie deklaruje od niego zależności.

## Własna logika przy zmianie statusu

Inny moduł — zwykle moduł nakładkowy danego wdrożenia — może zareagować na
przejście szansy ze statusu X do statusu Y, a także je odrzucić. Oba punkty
zaczepienia są opublikowane w `@endora-commerce/contracts`; żaden nie wymaga
zmiany w CRM.

**Reakcja na przejście** polega na subskrypcji zdarzenia. Dla przejścia z `x`
do `y` CRM emituje, w tej kolejności:

| Zdarzenie | Kiedy |
| --- | --- |
| `crm.opportunity.status.from_<x>_to_<y>.before` | przed zapisaniem zmiany |
| `crm.opportunity.status.from_<x>.before` | przed zapisaniem zmiany |
| `crm.opportunity.status_changed.v1` | po zapisaniu i po tym, jak poproszono powiązane zamówienia |
| `crm.opportunity.status.from_<x>_to_<y>.after` | jak wyżej |
| `crm.opportunity.status.to_<y>.after` | jak wyżej |
| `crm.opportunity.closed.v1` | jak wyżej, gdy `y` zamyka szansę |

Nazwy buduje funkcja `opportunityStatusEventName`, więc subskrybent nie
zapisuje wzorca ręcznie. Subskrybent nie może zatrzymać przejścia, a jego błąd
go nie cofa.

```ts
import { opportunityStatusEventName } from '@endora-commerce/contracts';

ctx.subscribe(opportunityStatusEventName('toAfter', { to: 'won' }), async (event) => {
  await notifyFinance(event.opportunityId);
});
```

**Odrzucenie przejścia** polega na zarejestrowaniu strażnika. Strażnik
wskazuje przejścia, które obserwuje — ze statusu, do statusu albo oba — i
odmawia, rzucając `OpportunityTransitionVetoError`. Zdanie, które rzuca, czyta
handlowiec; gdy strażnik odmawia, nic nie jest zapisywane.

```ts
import {
  OpportunityTransitionVetoError,
  type OpportunityTransitionGuardRegistryPort,
} from '@endora-commerce/contracts';
import { lazyPort } from '@endora-commerce/platform/kernel';

ctx.onBoot(() => {
  lazyPort<OpportunityTransitionGuardRegistryPort>(ctx, 'opportunityTransitionGuardRegistry').register({
    ownerModuleId: 'acme_rules',
    match: { to: 'won' },
    guard: (event) => {
      if (event.reason === null) throw new OpportunityTransitionVetoError('Say why the deal was won.', event.from, event.to);
    },
  });
});
```

Moduł rejestrujący strażnika deklaruje to w swoim manifeście:
`nonBindingDependencies: [{ moduleId: 'crm', name: 'opportunityTransitionGuardRegistry', kind: 'contributes-to' }]`.
Strażnik należący do wyłączonego modułu jest pomijany — moduł, który jest
wyłączony, niczego nie odrzuca.

**Strażnik działa bez względu na to, co powoduje przejście** — osoba, inny
moduł przez port albo powiązane zamówienie przez mapowanie. Gdy przejście
spowodowało zamówienie, odmowy nie ma kto przeczytać: szansa zostaje tam, gdzie
była, a pominięta zmiana jest na niej zapisywana razem ze zdaniem strażnika
(zob. *Zamówienie, które przesuwa swoją szansę*).

Dla innych modułów publikowane są jeszcze dwa zdarzenia, niezwiązane ze
statusem: `crm.opportunity.assigned.v1` (nowa i poprzednia osoba przypisana)
oraz `crm.opportunity.document_linked.v1`, emitowane przy każdym powiązaniu
zamówienia albo zapytania ofertowego — ręcznym, automatycznym albo wynikającym
z utworzenia dokumentu z poziomu szansy — z polami `opportunityId`,
`organizationId`, `documentKind`, `documentId` i `linkSource`. Żadne z nich nie
jest oferowane jako webhook.

## Odczyt i zmiana statusu szansy z innego modułu

Dla programistów. Inny moduł albo nakładka wdrożenia pracuje z szansami przez
dwa opublikowane porty — nigdy przez tabele ani klasy CRM. Oba typy eksportuje
`@endora-commerce/contracts`.

| Nazwa w kontenerze | Typ | Co robi |
| --- | --- | --- |
| `opportunityReadPort` | `OpportunityReadPort` | `findById(id)`, `findByDocument(kind, documentId)` i `listOpenForOrganization(organizationId)`. Każda zwraca zwykłe wartości `OpportunityRecord` — id, numer, tytuł, organizację, kod i rodzaj statusu, osobę przypisaną, wartość, walutę, daty — albo `null` / pustą listę. |
| `opportunityTransitionPort` | `OpportunityTransitionPort` | `applyStatus({ opportunityId, to, actor, reason? })` przeprowadza szansę przez skonfigurowany przepływ, razem ze strażnikami i zdarzeniami, i zwraca wynik jako wartość. |

```ts
import type { OpportunityTransitionPort } from '@endora-commerce/contracts';
import { lazyPort } from '@endora-commerce/platform/kernel';

const opportunities = lazyPort<OpportunityTransitionPort>(ctx, 'opportunityTransitionPort');

const outcome = await opportunities.applyStatus({
  opportunityId,
  to: 'won',
  actor: { kind: 'system' },
  reason: 'Contract signed in the ERP',
});
if (!outcome.applied && outcome.reason !== 'already_there') {
  // 'not_found' | 'unknown_status' | 'not_permitted' | 'vetoed', with `detail`
}
```

- **Odmowa jest wartością, nie wyjątkiem.** `applied: true` niesie `from` i
  `to`. `already_there` oznacza, że szansa jest już tam, gdzie miała być, i nic
  nie zapisano. `not_found` obejmuje także szansę spoza organizacji
  wywołującego. `not_permitted` oznacza, że przepływ nie ma takiego przejścia;
  `vetoed` — że odmówił strażnik, a `detail` to jego własne zdanie.
- **Wywołuj port po własnym zatwierdzeniu transakcji**, nigdy w jej trakcie:
  port otwiera własną.
- **Odczyty i zmiany działają w zakresie organizacji wywołującego.** Wywołujący
  ograniczony do wybranych organizacji nie odczyta ani nie przesunie szansy
  innej organizacji.
- **Zadeklaruj zależność w manifeście.** Moduł, który nie może działać bez CRM,
  wpisuje `crm` w `dependencies`. Moduł, który może, wpisuje go w
  `nonBindingDependencies` z `kind: 'degrades-without'`, nazwą portu i zdaniem
  `whenAbsent`, które operator przeczyta przed wyłączeniem CRM.
- **Gdy CRM jest wyłączony, oba porty odmawiają**: pobranie któregokolwiek
  rzuca `ModuleDisabledError` (HTTP `503 MODULE_DISABLED`). Nie otaczaj
  wywołania gołym `catch` — moduł, który ma działać dalej, pyta najpierw
  `effectiveState.isPresent('crm')`.

Aby reagować na zmianę statusu, a nie ją wywoływać, subskrybuj zdarzenia albo
zarejestruj strażnika — opisuje to sekcja o własnej logice przy zmianie statusu.

## Włączanie i wyłączanie

CRM jest modułem opcjonalnym. Domyślnie jest włączony, a operator wyłącza go
i włącza ponownie na ekranie **Moduły** w Admin UI (`/platform/modules`).

Gdy jest wyłączony:

- każdy punkt końcowy `/api/v1/admin/crm/…` odpowiada kodem `503` z kodem
  błędu `MODULE_DISABLED`;
- jego ekrany, grupa w menu bocznym, pozycje palety poleceń i ustawienia
  znikają z Admin UI;
- jego uprawnień nie można już nadać roli;
- nic, co moduł robiłby w tle, się nie dzieje — w szczególności **nie jest
  wysyłane żadne przypomnienie o wydarzeniu**. Przypomnienie, którego termin
  przypadł, gdy moduł był wyłączony, zostanie wysłane po jego ponownym
  włączeniu, o ile mieści się to w 24 godzinach od terminu; później jest
  pokazywane jako takie, które przepadło.

Nic nie jest usuwane. Każda szansa, jej historia, jej wydarzenia i konfiguracja przepływu
pozostają w bazie danych, a po ponownym włączeniu modułu wszystko wraca
dokładnie do poprzedniego stanu.

## Uprawnienia

| Kod | Na co pozwala |
| --- | --- |
| `crm:read` | Przeglądanie szans sprzedażowych, tablicy, kalendarza, przepływu statusów i listy etykiet; czytanie historii zmian szansy, jej wydarzeń, notatek i wiadomości oraz pobieranie jej załączników. Warto nadawać je razem z `orders:read` i `custom_fields:read` (zob. niżej). |
| `crm:write` | Tworzenie i edycja szans, przenoszenie ich w przepływie, przypisywanie handlowca, nadawanie etykiet, wiązanie i odłączanie zamówień oraz zapytań ofertowych, wybór między wartością wpisaną a wyliczaną, ponawianie lub pomijanie odmowy zmiany zamówienia, pisanie notatek i wiadomości, przesyłanie, dodawanie i usuwanie załączników oraz dodawanie, edycja i usuwanie wydarzeń — czyichkolwiek, nie tylko własnych. |
| `crm:configure` | Zmiana przepływu — statusów, przejść i mapowań statusów zamówień w obu kierunkach oraz statusów liczonych do wartości wyliczanej — zarządzanie listą etykiet oraz usuwanie szansy. |
| `crm:analytics` | Otwieranie ekranu Analityka i odczyt jego pięciu wskaźników. |

Rola z uprawnieniem `crm:read` powinna mieć także `orders:read` i
`custom_fields:read`: szansa pokazuje powiązane z nią zamówienia, odczytywane z
modułu Zamówienia, oraz swoje pola niestandardowe, których definicje pochodzą z
modułu Pola niestandardowe. Ekran **Role** podpowiada oba.
Uprawnienia `crm:write`, `crm:configure` i `crm:analytics` opierają się na
`crm:read`: ekran Analityka nazywa statusy i podpowiada filtry kanału sprzedaży
oraz handlowca na podstawie tego, co odczytuje `crm:read`.

**To, co należy do innego modułu, widzi osoba, która może to tam odczytać.**
Szansa otwiera się z samym `crm:read` — wtedy powiązane zamówienie albo
zapytanie ofertowe jest na liście jako niedostępne, a zamówienia i produkty
wspomniane w tekstach nie są nazywane. `orders:read` pokazuje powiązane albo
wspomniane zamówienie i pozwala je powiązać; `rfqs:handle` robi to samo dla
zapytania ofertowego; `catalog:read` nazywa wspomniany produkt. Dokument
pominięty w wartości wyliczanej jest nazywany na tej samej zasadzie. Sama
wartość jest własną liczbą szansy i widzi ją każdy, kto może czytać szansę.

**Do wypełnienia formularza nic więcej nie jest potrzebne.** Pola wyboru
organizacji, kanału sprzedaży, handlowca i osoby kontaktowej — w filtrach listy i tablicy oraz w formularzach
— korzystają z własnych list podpowiedzi modułu CRM, więc handlowiec nie
potrzebuje uprawnień do przeglądania klientów, kanałów sprzedaży ani
administratorów, żeby pracować z szansą. Lista podpowiedzi jest zawężona do
organizacji, które dana osoba może zobaczyć, i zawiera wyłącznie nazwę, po
której się wybiera.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/lookups/organizations?q=…` | `crm:read` | Organizacje widoczne dla pytającego, według nazwy: `id`, `name`. Parametr `id=…` zwraca jedną. |
| `GET /api/v1/admin/crm/lookups/sales-channels` | `crm:read` | Wszystkie kanały sprzedaży: `id`, `code`, `name` w każdym języku, `active`, `systemDefault` oraz waluty, w których kanał sprzedaje. |
| `GET /api/v1/admin/crm/lookups/assignees?q=…` | `crm:read` | Aktywni administratorzy, według imienia i nazwiska: `id`, `name`. |
| `GET /api/v1/admin/crm/lookups/mentionable?q=…&organizationId=…` | `crm:write` | Aktywni administratorzy z uprawnieniem `crm:read` — osoby, które można wspomnieć w tekście: `id`, `name`. |
| `GET /api/v1/admin/crm/lookups/contacts?organizationId=…&q=…` | `crm:write` | Członkowie jednej organizacji widocznej dla pytającego: `id`, `name`, `email`. |
| `GET /api/v1/admin/crm/lookups/quote-requests?organizationId=…&q=…` | `crm:write` i `rfqs:handle` | Zapytania ofertowe jednej organizacji widocznej dla pytającego, które można powiązać: otwarte oraz to, którego numer wpisano w całości. `id`, `number`, `status`. Gdy moduł Zapytania ofertowe jest wyłączony, odpowiedzią jest `503`. |

Waluty proponowane przy tworzeniu szansy to te, w których sprzedają aktywne
kanały sprzedaży.

**Wydarzenia i kalendarz nie mają własnego uprawnienia.** Uprawnienie
`crm:read` jest też tym, które trzeba mieć, żeby **dostać** przypomnienie o
wydarzeniu. To, co pokazuje
czyjś kalendarz — wydarzenia wszystkich czy tylko własne — wynika z tego, czy
ta osoba może zobaczyć każdą organizację, czy tylko ich zbiór, a nie z kodu
uprawnienia (zobacz *Kalendarz*).

Żadna rola nie otrzymuje uprawnień CRM automatycznie. Nadaje się je na
ekranie **Role**.

## Ustawienia

Na ekranie **Ustawienia** platformy, w grupie *CRM*. Nazwy ustawień są tam
wyłącznie po angielsku.

| Ustawienie | Domyślnie | Znaczenie |
| --- | --- | --- |
| `crm.enabled` | włączone | Przełącznik opisany powyżej. |
| `crm.auto_create_from_orders` | wyłączone | Każde zamówienie złożone od tej chwili dostaje własną szansę. Ustawienie może być różne dla kanałów sprzedaży; decyduje kanał zamówienia. |
| `crm.auto_create_from_quote_requests` | wyłączone | Każde zapytanie ofertowe utworzone od tej chwili — przesłane przez klienta albo przygotowane przez administratora — dostaje własną szansę. Wymaga włączonego modułu Zapytań ofertowych. |
| `crm.board_card_fields` | numer, organizacja, wartość, handlowiec, etykiety | Pola widoczne na karcie na tablicy, w kolejności, jako lista odwołań do pól. Zmieniaj je w sekcji **Karta na tablicy** na ekranie **CRM → Statusy i przepływ**, która proponuje istniejące pola, a nie tutaj. |

Wydarzenia, przypomnienia i kalendarz nie dodają żadnego ustawienia. E-mail z
przypomnieniem zmienia się i wyłącza na ekranie **Maile transakcyjne**, pod
nazwą *Event reminder*; to, jak często przypomnienia są sprawdzane, pięć
minut, które decydują o tym, że osoba jest online, i 24 godziny, po których
spóźnione przypomnienie jest pomijane, są stałe.

## Czego moduł nie robi

Rzeczy, których operator może szukać, a których w tym wydaniu nie ma:

- **Import i eksport** szans sprzedażowych — nie ma ani importu z pliku, ani
  eksportu.
- **E-mail, z jednym wyjątkiem.** Przypomnienie o wydarzeniu może być także
  e-mailem (zobacz *Wydarzenia i przypomnienia*). Każde inne powiadomienie
  trafia wyłącznie na dzwonek w Admin UI, a wiadomość jest wewnętrzna — dla
  osób pracujących nad szansą.
- **Wydarzenia wielodniowe i cykliczne.** Wydarzenie trwa jeden dzień; targi,
  które trwają trzy dni, to trzy wydarzenia, a cotygodniową rozmowę dodaje się
  tydzień po tygodniu.
- **Ręczne zmiany w kalendarzu.** Niczego się w nim nie przeciąga ani nie
  rozciąga i nie tworzy się w nim wydarzeń: Kalendarz jest widokiem, a
  wydarzenia dodaje się w ich szansie.
- **Rodzaje i kolory wydarzeń.** Jest jeden rodzaj wydarzenia, rysowany jednym
  kolorem; nie ma kategorii, pola na miejsce ani uczestników i nikogo się na
  nie nie zaprasza.
- **Wydarzenia bez szansy** — kalendarz osobisty.
- **Synchronizacja z innym kalendarzem.** Nie ma synchronizacji z Google
  Calendar ani z Outlookiem i nie ma eksportu iCalendar.
- **Odnośnik w e-mailu z przypomnieniem.** E-mail wskazuje szansę jej
  numerem; odnośnik do niej ma wpis w dzwonku.
- **Ustawienie strefy czasowej.** Kalendarz podąża za przeglądarką każdej
  osoby.
- **Wydarzenia w innych miejscach modułu.** Wydarzenia nie są oferowane
  webhookom wychodzącym, nie pojawiają się w analityce i nie są polem karty na
  tablicy.
- **Wyszukiwanie globalne.** Szanse znajduje się na ich liście i tablicy, a nie
  przez wyszukiwarkę Admin UI.
- **Zysk.** Każdy wskaźnik jest wartością; kosztów ani marży nie ma.

## Dane demonstracyjne

Dane demonstracyjne są opcjonalne: instancja, która sprzedaje naprawdę, nie
potrzebuje żadnych, a powstają dopiero po uruchomieniu `endora demo seed`.
Wtedy CRM dostaje lejek, na który można popatrzeć:

- **Trzy etykiety** — `Key account`, `Upsell` i `Tender`. To własne dane
  demonstracyjne modułu.
- **Dwanaście szans** dla demonstracyjnej organizacji, po dwie w każdym statusie
  domyślnego przepływu (nowa, zakwalifikowana, oferta, negocjacje, wygrana,
  przegrana). Sześć jest przypisanych do jednego demonstracyjnego handlowca,
  pięć do drugiego, a jedna do nikogo. Jedenaście ma wartość wpisaną ręcznie;
  jedna ma wartość wyliczaną z powiązanych dokumentów i jest warta zero, dopóki
  nic nie zostanie z nią powiązane.
- **Historię** każdej z nich, rozłożoną na trzy miesiące przed zasileniem,
  dzięki czemu ekran analityki ma zamknięte szanse, czas w statusie i więcej
  niż jeden miesiąc do pokazania.
- **Notatki** przy czterech z nich i wymianę **wiadomości wewnętrznych** przy
  jednej — jedna notatka wskazuje demonstracyjny produkt, jedna wiadomość
  wspomina osobę; demonstracyjnego kupującego jako osobę kontaktową przy
  czterech; etykiety przy dziewięciu.
- **Osiem wydarzeń** w sześciu z ośmiu otwartych szans — wizyty u klienta,
  rozmowy i dwa całodniowe terminy — dzięki czemu kalendarz i karta Wydarzenia
  nie są puste. Ich daty liczone są od dnia zasilenia: siedem przypada w
  ciągu dwóch tygodni po nim, a jedno pięć dni przed nim. **Żadne nie ma
  przypomnienia**, więc zasilone demo nie tworzy wpisu w dzwonku i nie wysyła
  e-maila. Cztery zamknięte szanse nie mają wydarzeń.

Szanse tworzy pakiet kompozycji demo (`@endora-commerce/demo-composition`),
ponieważ każda należy do organizacji i do administratora — a to rekordy innych
modułów. Instancja, która nie zainstalowała tego pakietu, dostaje tylko trzy
etykiety.

Czego demonstracyjny lejek nie ma:

- **Żadnego powiązanego zamówienia ani zapytania ofertowego.** Sklep
  demonstracyjny nie zawiera ani jednych, ani drugich, więc żadna szansa nie ma
  powiązanego dokumentu i żadna nie pokazuje synchronizacji ze statusem
  zamówienia. Żeby ją zobaczyć, utwórz zamówienie z demonstracyjnej szansy.
- **Żadnej historii zmian.** Zakładka Historia zasilonej szansy jest pusta: demo
  zapisuje rekordy bezpośrednio, z datami wstecz, a zakładka pokazuje tylko to,
  co zrobiono przez Admin UI albo API. Wszystko, co zrobisz z demonstracyjną
  szansą później, jest zapisywane jak zwykle.
- **Żadnych mapowań.** Konfiguracja przepływu zostaje dokładnie taka, jak po
  instalacji.

Ponowne zasilenie nie zmienia niczego, co już istnieje: szansa, którą
przesunięto albo edytowano, zostaje taka, jak ją zostawiono — a szansa
zasilona, zanim pojawiły się wydarzenia, nie dostaje żadnego; żeby je mieć,
wykonaj reset i zasil dane ponownie.
`endora demo reset` usuwa dwanaście szans i trzy etykiety wraz ze wszystkim,
co jest do tych szans dołączone, i nic, co utworzono samodzielnie.

**Uruchamiaj `endora demo reset` przy włączonym module CRM.** Gdy moduł jest
wyłączony, jego rekordy pozostają nietknięte — także demonstracyjne szanse — a
demonstracyjnej organizacji, do której należą, nie da się usunąć, więc reset
zatrzymuje się z błędem na `organizations`. Włącz CRM i uruchom go ponownie.
