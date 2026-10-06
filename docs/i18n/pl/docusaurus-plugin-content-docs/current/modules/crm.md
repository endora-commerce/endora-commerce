---
title: crm
description: Szanse sprzedażowe z konfigurowalnym przepływem statusów, za którym podążają powiązane zamówienia
---

# `crm`

Moduł CRM prowadzi **szanse sprzedażowe**: transakcje, nad którymi
handlowiec pracuje z jedną organizacją klienta — od pierwszego kontaktu do chwili, gdy szansa zostaje wygrana albo przegrana.

Ta strona rośnie razem z modułem. Wszystko, co oznaczono jako *wkrótce*, jest
zaprojektowane, ale jeszcze niedostępne.

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
| Szansa sprzedażowa | wiersz listy (`/crm/opportunities/:id`) | `crm:read` | Jej status i zmiany, na które pozwala przepływ, jej wartość, powiązane z nią zamówienia i zapytania ofertowe oraz to, co stało się z tymi zamówieniami po każdej zmianie; na kolejnych kartach — notatki, wiadomości, załączniki i **historia zmian**. |
| Tablica | **CRM → Tablica** (`/crm/board`) | `crm:read` | Te same szanse jako karty, w kolumnie dla każdego statusu. Posiadacz uprawnienia `crm:write` przenosi kartę do innego statusu. |
| Etykiety | **CRM → Etykiety** (`/crm/tags`) | `crm:configure` | Lista etykiet: dodawanie, zmiana nazwy i koloru oraz usuwanie oznaczeń, które można nadawać szansom. |
| Statusy i przepływ | **CRM → Statusy i przepływ** (`/crm/workflow`) | `crm:configure` | Statusy, przejścia między nimi, status zamówienia ustawiany przez każdy status szansy oraz status szansy, do którego prowadzi każdy status zamówienia. |

Codzienne ekrany są też w palecie poleceń (`⌘K` / `Ctrl+K`):
**Szanse sprzedażowe**, **Nowa szansa sprzedażowa** i **Tablica szans
sprzedażowych**.

Pierwsze przejście przez moduł, od początku do końca:

1. Na ekranie **Statusy i przepływ** sprawdź statusy — który jest początkowy,
   które zamykają szansę jako wygraną lub przegraną — oraz strzałki między
   nimi. W sekcji *Status zamówienia dla każdego statusu szansy* wybierz, co
   każdy status ma zrobić z powiązanym zamówieniem, i zapisz.
2. Na ekranie **Szanse sprzedażowe** kliknij **Nowa szansa**, podaj tytuł,
   organizację i walutę, a następnie utwórz szansę. Trafisz na jej ekran.
3. W sekcji *Powiązane zamówienia* wyszukaj zamówienie tej organizacji po
   numerze i je powiąż. Będzie podążać za statusem szansy, chyba że to dla
   niego odznaczysz.
4. W sekcji *Status* kliknij status, na który chcesz zmienić. Dostępne są
   tylko zmiany dozwolone przez przepływ.
5. W sekcji *Zmiany statusów zamówień* przeczytaj, co stało się z każdym
   powiązanym zamówieniem. Zamówienie, którego nie udało się przenieść, jest
   tam wymienione z przyczyną i dwoma przyciskami: **Ponów** i **Pomiń**;
   pozostaje tam przy każdej kolejnej wizycie, dopóki handlowiec nie użyje
   jednego z nich.

Administrator, który może tylko przeglądać, widzi te same ekrany bez
elementów, które cokolwiek zmieniają.

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
| `GET /api/v1/admin/crm/workflow` | `crm:read` | Skonfigurowane statusy wraz z liczbą szans w każdym z nich, przejścia między nimi, mapowania statusów zamówień oraz statusy wliczane do wartości obliczanej. |
| `POST /api/v1/admin/crm/statuses` | `crm:configure` | Dodanie statusu. |
| `PATCH /api/v1/admin/crm/statuses/:code` | `crm:configure` | Zmiana nazwy lub koloru statusu, zmiana jego rodzaju albo oznaczenie go jako początkowego. |
| `DELETE /api/v1/admin/crm/statuses/:code` | `crm:configure` | Usunięcie statusu, w którym nie ma żadnej szansy. |
| `PUT /api/v1/admin/crm/transitions` | `crm:configure` | Dodawanie i usuwanie przejść. |
| `PUT /api/v1/admin/crm/order-status-mappings` | `crm:configure` | Zastąpienie zbioru mapowań statusów zamówień. |

Każdy z tych zapisów zwraca cały przepływ w stanie po zmianie.

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
| `PATCH /api/v1/admin/crm/opportunities/:id` | `crm:write` | Edycja. Odczytaną wersję należy przesłać w nagłówku `If-Match`; nieaktualna jest odrzucana kodem `409`. |
| `DELETE /api/v1/admin/crm/opportunities/:id` | `crm:configure` | Usunięcie szansy razem z jej powiązaniami i historią. |
| `POST /api/v1/admin/crm/opportunities/:id/transition` | `crm:write` | Przeniesienie szansy do innego statusu. |

## Edycja i usuwanie szansy

Na ekranie szansy przycisk **Edytuj** — obok nagłówka *Szczegóły*, dla
posiadacza uprawnienia `crm:write` — zamienia szczegóły w formularz: tytuł,
opis, osoba kontaktowa, kanał sprzedaży, planowana data zamknięcia i
wartość. Organizacja i waluta są pokazane i nie można ich zmienić. Wartość jest
**wpisana ręcznie** albo **wyliczana z powiązanych dokumentów**; wpisana kwota
zostaje zachowana na czas pokazywania wyliczonej.

Zapis wysyła tylko zmienione pola. Jeśli szansa została w międzyczasie
zmieniona — przez inną osobę albo przez zmianę statusu wykonaną przez Ciebie
przy otwartym formularzu — nic nie zostaje zapisane, a formularz o tym
informuje: naciśnij **Wczytaj szansę ponownie**, aby zobaczyć aktualną wersję,
i wprowadź zmiany jeszcze raz. Nic nie jest nadpisywane po cichu.

Zmiana statusu może mieć **powód**: wpisz go w polu pod przyciskami statusów,
zanim naciśniesz jeden z nich. Powód jest opcjonalny i zostaje zapisany razem
ze zmianą.

**Usuń**, w nagłówku ekranu, jest dla posiadacza uprawnienia `crm:configure`.
Najpierw pyta o potwierdzenie, a następnie usuwa szansę razem z historią
statusów i powiązaniami; same powiązane zamówienia pozostają bez zmian.

## Tablica

**CRM → Tablica** pokazuje szanse, które możesz zobaczyć, jako karty — po
jednej kolumnie dla każdego statusu, w kolejności przepływu. Nagłówek kolumny
podaje liczbę szans w tym statusie i ich wartość, osobną sumę dla każdej
waluty; karta pokazuje tytuł szansy, numer, organizację, wartość, osobę, do
której jest przypisana, oraz etykiety. Tytuł na karcie otwiera szansę.

Kartę można przenieść do innego statusu na dwa sposoby i oba robią dokładnie
to samo, co przyciski statusów na ekranie szansy — łącznie z powiązanymi
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
i daty utworzenia są takie same jak na liście i zawężają każdą kolumnę — jej karty, liczbę i
sumy. Kolumna, która zawiera więcej szans, niż pokazuje, podaje ich liczbę i
ma przycisk **Pokaż więcej**.

Administrator, który może tylko przeglądać, widzi tablicę bez uchwytów i bez
menu.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/board` | `crm:read` | Po jednej kolumnie dla każdego statusu, w kolejności przepływu: status, `count`, `valueTotals` dla każdej waluty, pierwsze `perColumn` szans (domyślnie 50, najwyżej 200) oraz `hasMore`. Przyjmuje filtry listy z wyjątkiem `statusCode` i `state` — także filtr handlowca i filtr etykiet, w tym samym znaczeniu. |

Tablica nie ma własnej operacji zapisu: przeniesienie karty to
`POST /api/v1/admin/crm/opportunities/:id/transition`. Kolejne karty kolumny
pochodzą z endpointu listy, zawężonego do tego statusu.

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
| `POST /api/v1/admin/crm/opportunities/:id/links` | `crm:write` | Powiązanie zamówienia. |
| `PATCH /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` | Włączenie lub wyłączenie podążania za statusem. |
| `DELETE /api/v1/admin/crm/opportunities/:id/links/:linkId` | `crm:write` | Usunięcie powiązania. |

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
nią pracuje. Przypisany może zostać każdy aktywny administrator.

Gdy szansa jest tworzona bez wskazania, kto ją prowadzi, osoba przypisana jest
wybierana spośród Handlowców przypisanych do organizacji tej szansy:

1. osoba tworząca szansę, jeśli jest jednym z nich;
2. w przeciwnym razie Handlowiec przypisany do organizacji najdłużej;
3. w przeciwnym razie nikt — szansa powstaje jako nieprzypisana.

Handlowiec, którego konto zostało dezaktywowane, jest pomijany. Żądanie, które
wskazuje osobę przypisaną albo wprost mówi, że jej nie ma, jest wykonywane
dosłownie i reguła nie ma zastosowania.

**Przypisanie nie decyduje o tym, kto widzi szansę.** Handlowiec ograniczony do
wybranych organizacji widzi każdą szansę tych organizacji, niezależnie od tego,
kto ją prowadzi — i nie widzi szansy innej organizacji, nawet jeśli jest do
niego przypisana.

W Admin UI:

- **W formularzu nowej szansy** pole *Handlowiec* jest opcjonalne. Jeśli
  zostanie puste, wybiera opisana wyżej reguła; jeśli wskażesz osobę, szansa
  jest jej.
- **Na ekranie szansy** sekcja *Handlowiec* pokazuje, kto ją prowadzi.
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

Osoby, która nie jest aktywnym administratorem, nie można przypisać: żądanie
jest odrzucane z kodem `CRM_ASSIGNEE_INVALID`. Edycja szansy również może
zmienić osobę przypisaną — na tej samej zasadzie.

Osoba dowiaduje się, że szansa została jej przypisana — z dzwonka powiadomień
w Admin UI, z odnośnikiem do szansy. Nikt nie jest powiadamiany o tym, że sam
wziął szansę. Dzwonek należy do modułu **Powiadomienia administratora**: gdy
ten moduł jest wyłączony, przypisywanie działa dokładnie tak samo, a nikt nie
dostaje powiadomienia.

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
- **Na ekranie szansy** sekcja *Etykiety* pokazuje jej etykiety. Posiadacz
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
Usunięta notatka znika z listy, a jej treść zostaje w historii zmian szansy.

**Wiadomość** jest częścią rozmowy między osobami pracującymi nad szansą.
Wiadomości są wyświetlane w kolejności wysłania, a **wiadomości nie można
zmienić ani usunąć po wysłaniu** — nie może tego zrobić ani autor, ani nikt
inny: próba jest odrzucana z kodem `CRM_MESSAGE_IMMUTABLE`. O wiadomości
dowiadują się osoba przypisana do szansy i wszyscy, którzy już napisali w tej
rozmowie — poza nadawcą — z dzwonka powiadomień w Admin UI, z odnośnikiem do
szansy. Gdy moduł **Powiadomienia administratora** jest wyłączony, wiadomość
jest zapisywana tak samo, a nikt nie dostaje powiadomienia.

**Jedno i drugie jest wewnętrzne.** Ani Notatka, ani Wiadomość nie ma
ustawienia, które pokazałoby ją klientowi, i nic, co klient może otworzyć —
Zamówienie, zapytanie ofertowe, jego konto — ich nie zawiera.

W Admin UI szansa ma kartę **Notatki** i kartę **Wiadomości**. Każda pokazuje
wpisy od najstarszego, z autorem i datą, a posiadaczowi uprawnienia `crm:write`
— także pole pod listą, w którym pisze się następny wpis.

- Na karcie **Notatki** przy własnych notatkach są przyciski **Edytuj** i
  **Usuń**; przy notatkach innych osób ich nie ma. Zmieniona notatka jest
  oznaczona jako *edytowano*. Usunięcie wymaga potwierdzenia.
- Na karcie **Wiadomości** niczego nie można edytować ani usunąć, o czym karta
  informuje nad rozmową.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/comments?kind=note` | `crm:read` | Notatki szansy, od najstarszej. `kind=message` — rozmowa. Parametr `kind` jest wymagany. |
| `POST /api/v1/admin/crm/opportunities/:id/comments` | `crm:write` | Dodanie: `{ "kind": "note" \| "message", "body" }`. |
| `PATCH /api/v1/admin/crm/opportunities/:id/comments/:commentId` | `crm:write` | Edycja notatki: `{ "body" }`. Tylko autor. |
| `DELETE /api/v1/admin/crm/opportunities/:id/comments/:commentId` | `crm:write` | Usunięcie notatki. Tylko autor. |

Edycja albo usunięcie cudzej notatki kończy się odpowiedzią 403; próba zrobienia
tego z wiadomością — odpowiedzią 409 `CRM_MESSAGE_IMMUTABLE`, niezależnie od
tego, kto pyta.

## Załączniki

Brief, rysunek, podpisana oferta — do szansy sprzedażowej można dołączać pliki.

Sam plik jest przechowywany w **bibliotece mediów**. Najpierw jest tam
przesyłany, a szansa przechowuje odnośnik do niego. Wynikają z tego dwie rzeczy.

**Załącznik jest plikiem prywatnym.** Plik, który biblioteka mediów
przechowuje jako publiczny, ma adres, który może otworzyć każdy, dlatego plik
publiczny jest odrzucany jako Załącznik. Biblioteka mediów zapisuje przesłany
plik jako publiczny, o ile nie wskazano inaczej: plik przeznaczony dla szansy
przesyła się z `visibility: "private"`.

**Pliku, który jest załączony, nie można usunąć z biblioteki mediów.**
Biblioteka odmawia i wskazuje szansę po jej numerze. Najpierw trzeba usunąć
Załącznik. Dotyczy to także czasu, gdy moduł CRM jest wyłączony — załączniki
nadal istnieją, a ochrona razem z nimi.

Każdy, kto może czytać szansę, może pobrać jej załączniki; żadne uprawnienie
biblioteki mediów nie jest potrzebne. Każdy Załącznik na liście ma odnośnik do
pobrania ważny przez kilka minut — aby dostać świeży, wystarczy ponownie
odczytać listę.

W Admin UI szansa ma kartę **Załączniki**: listę plików z nazwą, rozmiarem,
osobą, która plik dodała, i datą dodania.

- **Dodaj plik** przesyła plik do biblioteki mediów jako prywatny i dołącza go
  do szansy. Przesyłanie korzysta z mechanizmu biblioteki mediów, więc rola
  potrzebuje uprawnienia `assets.write` oprócz `crm:write`; rola bez niego
  widzi zamiast przycisku zdanie, które to wyjaśnia.
- Przycisk pobierania przygotowuje świeży odnośnik w chwili kliknięcia i
  otwiera plik w nowej karcie. Jeśli pliku nie ma już w bibliotece mediów,
  ekran o tym informuje i niczego nie otwiera.
- Kosz usuwa Załącznik po potwierdzeniu. Plik pozostaje w bibliotece mediów.

Osoba, która może tylko czytać, widzi listę i przyciski pobierania.

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/crm/opportunities/:id/attachments` | `crm:read` | Załączniki, od najstarszego: nazwa pliku, typ, rozmiar, kto załączył oraz `url`. |
| `POST /api/v1/admin/crm/opportunities/:id/attachments` | `crm:write` | Załączenie pliku z biblioteki mediów: `{ "assetId" }`. |
| `DELETE /api/v1/admin/crm/opportunities/:id/attachments/:attachmentId` | `crm:write` | Usunięcie załącznika. Plik zostaje w bibliotece mediów. |

Załączenie pliku, który szansa już ma, niczego nie zmienia, a odpowiedzią jest
istniejący Załącznik. Plik, którego nie ma w bibliotece mediów — albo który
jest załączony do szansy niedostępnej dla pytającej osoby — jest odrzucany jak
plik, który nie istnieje. Jeśli plik zniknął z biblioteki mediów, jego
Załącznik nadal jest na liście, pod dawną nazwą, bez odnośnika.

## Zapytania ofertowe i wartość wyliczana

### Wiązanie zapytań ofertowych

Zapytanie ofertowe wiąże się z szansą sprzedażową tak samo jak zamówienie, tym
samym punktem końcowym, z `"documentKind": "quote_request"`. Musi należeć do
organizacji szansy i należy do co najwyżej jednej szansy. Szansa może mieć
kilka zapytań ofertowych i kilka zamówień.

Powiązane Zapytanie ofertowe jest na liście z numerem, statusem i wartością.
Przełącznik „podążaj za statusem szansy” nic dla niego nie znaczy: Zapytanie
ofertowe zachowuje własny status.

Gdy z powiązanego zapytania ofertowego zostaje złożone zamówienie, zamówienie
samo wiąże się z tą samą szansą (`linkSource: "quote_conversion"`). Działa to
wtedy, gdy zamówienie zapisuje, z którego zapytania ofertowego powstało.

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
zapytanie to jedna transakcja. Dopóki liczy się zamówienie, Zapytanie ofertowe
jest pomijane.

**Jedna waluta.** Szansa ma jedną walutę i nic nie jest przeliczane. Dokument w
innej walucie, który w przeciwnym razie by się liczył, jest pomijany, a szansa
go wskazuje: `excludedDocuments` na szansie wymienia każdy taki dokument jako
`{ kind, id, reason: "currency_mismatch" }`. Zapytanie ofertowe z pozycjami w
kilku walutach liczy pozycje w walucie szansy i również jest wskazywane.

Wartość podąża za dokumentami: jest przeliczana, gdy dokument zostaje powiązany
albo odwiązany, gdy powiązane zamówienie zmienia status, gdy powiązane
Zapytanie ofertowe zostaje zmienione, zatwierdzone, anulowane albo wygasa, oraz
gdy tryb zmienia się na wyliczany. Przeliczenie nie jest wpisem w historii
szansy.

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
- powiązane Zapytanie ofertowe nadal jest na liście, jako **niedostępne** — bez
  numeru, statusu i wartości;
- nie dodaje niczego do wartości wyliczanej;
- próba powiązania zapytania ofertowego kończy się odpowiedzią
  `503 MODULE_DISABLED`; istniejące powiązanie nadal można usunąć.

Nic nie ginie: po ponownym włączeniu powiązania znów pokazują swoje dokumenty.
Wartość wyliczana uwzględni zapytania ofertowe przy najbliższym przeliczeniu.

### W Admin UI

Na karcie **Przegląd** szansy sprzedażowej:

- **Powiązane zapytania ofertowe** — lista z numerem, statusem i wartością
  netto każdego z nich, obok sekcji *Powiązane zamówienia*. Posiadacz
  uprawnienia `crm:write` wyszukuje zapytania ofertowe organizacji po numerze
  i wiąże je albo odłącza. Wyszukiwarka podpowiada zapytania otwarte; zamknięte
  znajdziesz, wpisując jego pełny numer. Do powiązania nie jest potrzebne
  uprawnienie do obsługi zapytań ofertowych.
- **Wartość** — kwota oraz informacja, czy jest *wpisana ręcznie*, czy jest to
  *wartość wyliczana*; jeden przycisk przełącza między nimi. Przy wartości
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
domyślnie **wyłączone**.

| Ustawienie | Gdy jest włączone |
| --- | --- |
| `crm.auto_create_from_orders` | Każde zamówienie złożone od tej chwili dostaje własną szansę. Ustawienie może być różne dla kanałów sprzedaży; decyduje kanał zamówienia. |
| `crm.auto_create_from_quote_requests` | Każde Zapytanie ofertowe przesłane przez klienta od tej chwili dostaje własną szansę. Wymaga włączonego modułu Zapytań ofertowych. |

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
- nic dla zamówienia złożonego z zapytania ofertowego powiązanego z szansą —
  zamówienie dołącza do tej szansy, niezależnie od ustawień;
- nic dla dokumentów, które istniały przed włączeniem ustawienia;
- nic, gdy moduł CRM jest wyłączony, i nic później dla dokumentów złożonych w
  tym czasie;
- nic dla zapytania ofertowego, które administrator tworzy w Admin UI w
  imieniu klienta: tylko Zapytanie ofertowe przesłane przez klienta ogłasza się
  samo. (Zamówienie złożone przez administratora w imieniu klienta jest
  zamówieniem jak każde inne i dostaje swoją szansę.)

Każdy dokument dostaje co najwyżej jedną szansę, bez względu na to, ile razy
jego złożenie zostanie ogłoszone.

Szansa dla zapytania ofertowego nie ma kanału sprzedaży, a jej ustawienie jest
odczytywane dla całej platformy, nie dla kanału: moduł Zapytań ofertowych nie
publikuje kanału, w którym zapytanie zostało przesłane.

## Historia zmian

Każda szansa sprzedażowa ma historię tego, co się z nią działo, od najnowszych
wpisów: jej utworzenie, każda edycja, każda zmiana statusu, każde powiązanie i
odwiązanie zamówienia lub zapytania ofertowego, każde przypisanie, zmiana
etykiet, notatka, wiadomość i Załącznik.

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

Trzy rzeczy, o których warto wiedzieć:

- Notatka, która została zmieniona albo usunięta, zostaje w historii ze swoją
  treścią, taką, jaka była.
- Przeliczenie wartości wyliczanej nie jest wpisem: wpisem jest zmiana, która
  je spowodowała — powiązanie, status zamówienia.
- Historia sięga 500 wpisów wstecz.

Na ekranie **Dziennik audytu** całej platformy te same wpisy są pokazywane
wśród wszystkich pozostałych, jako te same zdania.

W Admin UI historia to karta **Historia zmian** szansy sprzedażowej. Każdy
wpis jest zdaniem — *Zmieniono status szansy sprzedażowej*, *Dodano notatkę* —
z informacją, kto i kiedy to zrobił. Zmiana statusu pokazuje oba statusy z
nazwy; jeśli spowodowało ją zamówienie, wpis wskazuje to zamówienie i prowadzi
do niego. Edycja wymienia zmienione pola: jak było i jak jest. Przycisk *Pokaż
wcześniejsze zmiany* wczytuje kolejną stronę.

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

W Admin UI pole opisu oraz pola notatki i wiadomości mają dwa przyciski:
**Wstaw produkt** i **Wstaw zamówienie**. Każdy otwiera wyszukiwarkę; wybranie
wyniku wpisuje token w miejscu kursora. Po zapisaniu tekst pokazuje w tym
miejscu nazwę produktu albo numer zamówienia jako odnośnik, a dla celu, który
zniknął albo którego nie możesz zobaczyć — *Produkt niedostępny* /
*Zamówienie niedostępne*.

Obie wyszukiwarki należą do katalogu i do modułu Zamówienia, dlatego przycisk
*Wstaw produkt* widzi rola, która ma także `catalog:read`, a *Wstaw
zamówienie* — rola z `orders:read`; proponowane są wyłącznie zamówienia
organizacji tej szansy. Token wpisany albo wklejony ręcznie działa bez żadnego
z tych uprawnień.

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
ctx.subscribe(opportunityStatusEventName('toAfter', { to: 'won' }), async (event) => {
  await notifyFinance(event.opportunityId);
});
```

**Odrzucenie przejścia** polega na zarejestrowaniu strażnika. Strażnik
wskazuje przejścia, które obserwuje — ze statusu, do statusu albo oba — i
odmawia, rzucając `OpportunityTransitionVetoError`. Zdanie, które rzuca, czyta
handlowiec; gdy strażnik odmawia, nic nie jest zapisywane.

```ts
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

## Włączanie i wyłączanie

CRM jest modułem opcjonalnym. Domyślnie jest włączony, a operator wyłącza go
i włącza ponownie na ekranie **Moduły** w Admin UI (`/platform/modules`).

Gdy jest wyłączony:

- każdy punkt końcowy `/api/v1/admin/crm/…` odpowiada kodem `503` z kodem
  błędu `MODULE_DISABLED`;
- jego ekrany, grupa w menu bocznym, pozycje palety poleceń i ustawienia
  znikają z Admin UI;
- jego uprawnień nie można już nadać roli;
- nic, co moduł robiłby w tle, się nie dzieje.

Nic nie jest usuwane. Każda szansa, jej historia i konfiguracja przepływu
pozostają w bazie danych, a po ponownym włączeniu modułu wszystko wraca
dokładnie do poprzedniego stanu.

## Uprawnienia

| Kod | Na co pozwala |
| --- | --- |
| `crm:read` | Przeglądanie szans sprzedażowych, tablicy, przepływu statusów i listy etykiet; czytanie historii zmian szansy, jej notatek i wiadomości oraz pobieranie jej załączników. |
| `crm:write` | Tworzenie i edycja szans, przenoszenie ich w przepływie, przypisywanie handlowca, nadawanie etykiet, wiązanie i odłączanie zamówień oraz zapytań ofertowych, wybór między wartością wpisaną a wyliczaną, ponawianie lub pomijanie odmowy zmiany zamówienia, pisanie notatek i wiadomości, dodawanie i usuwanie załączników (przesłanie nowego pliku wymaga też uprawnienia `assets.write` biblioteki mediów). |
| `crm:configure` | Zmiana przepływu — statusów, przejść i mapowań statusów zamówień w obu kierunkach oraz statusów liczonych do wartości wyliczanej — zarządzanie listą etykiet oraz usuwanie szansy. |

Rola z uprawnieniem `crm:read` powinna mieć także `orders:read`: szansa
pokazuje powiązane z nią zamówienia, a te są odczytywane z modułu Zamówienia.
Uprawnienia `crm:write` i `crm:configure` opierają się na `crm:read`.

**Nic więcej nie jest potrzebne.** Pola wyboru organizacji, kanału sprzedaży,
handlowca i osoby kontaktowej — w filtrach listy i tablicy oraz w formularzach
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
| `GET /api/v1/admin/crm/lookups/contacts?organizationId=…&q=…` | `crm:write` | Członkowie jednej organizacji widocznej dla pytającego: `id`, `name`, `email`. |
| `GET /api/v1/admin/crm/lookups/quote-requests?organizationId=…&q=…` | `crm:write` | Zapytania ofertowe jednej organizacji widocznej dla pytającego, które można powiązać: otwarte oraz to, którego numer wpisano w całości. `id`, `number`, `status`. Gdy moduł Zapytania ofertowe jest wyłączony, odpowiedzią jest `503`. |

Waluty proponowane przy tworzeniu szansy to te, w których sprzedają aktywne
kanały sprzedaży.

Żadna rola nie otrzymuje uprawnień CRM automatycznie. Nadaje się je na
ekranie **Role**.

## Ustawienia

| Ustawienie | Domyślnie | Znaczenie |
| --- | --- | --- |
| `crm.enabled` | włączone | Przełącznik opisany powyżej. |
| `crm.auto_create_from_orders` | Każde zamówienie złożone od tej chwili dostaje własną szansę. Ustawienie może być różne dla kanałów sprzedaży; decyduje kanał zamówienia. |
| `crm.auto_create_from_quote_requests` | Każde Zapytanie ofertowe przesłane przez klienta od tej chwili dostaje własną szansę. Wymaga włączonego modułu Zapytań ofertowych. |

## Wkrótce

- Tworzenie zamówienia albo zapytania ofertowego z poziomu szansy.
- Analityka: czas obsługi, czas w poszczególnych statusach, wyniki
  handlowców.
