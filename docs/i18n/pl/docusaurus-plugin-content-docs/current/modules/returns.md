---
title: Zwroty
description: Zwroty i reklamacje (RMA) — zgłoszenie, weryfikacja, przesyłki zwrotne i rozliczenie według konfigurowalnego grafu statusów
---

# Zwroty (`returns`)

Zwroty i reklamacje (RMA). Obsługuje cykl życia sprawy zwrotu lub reklamacji dotyczącej
zrealizowanego zamówienia — zgłoszenie, weryfikację i nadanie numeru RMA, przesyłki zwrotne oraz
rozliczenie (zwrot pieniędzy, środki na koncie w sklepie, wymiana lub naprawa), łącznie z fakturą
korygującą. Działa na konfigurowalnym grafie statusów, tak jak moduł `orders`.

## API publiczne

Trasy administracyjne są chronione przez `returns:read` (odczyt) i `returns:write` (zmiany).

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/orders/:orderId/returnable` | klient | Pozycje, które można zwrócić, i warunki dla zamówienia |
| `POST /api/v1/returns` | klient | Otwarcie sprawy zwrotu lub reklamacji — do zamówienia albo reklamacji bez niego (zob. *Reklamacje bez zamówienia na platformie*) |
| `GET /api/v1/returns/form-config` | klient | Co oferuje formularz: reklamacje bez zamówienia, dowód zakupu, klauzule, limity plików |
| `POST /api/v1/returns/uploads` | klient | Przesłanie jednego pliku (multipart) przed złożeniem sprawy (zob. *Załączniki*) |
| `POST /api/v1/returns/:id/attachments` | klient | Dodanie jednego pliku (multipart) do złożonej sprawy |
| `GET /api/v1/returns/:id/attachments/:attachmentId/file` | klient | Pobranie pliku sprawy, którą wywołujący może zobaczyć |
| `GET /api/v1/returns` | klient | Lista spraw wywołującego albo całej organizacji (zob. *Kto może zgłosić, zobaczyć i prowadzić sprawę*) |
| `GET /api/v1/returns/:id` | klient | Szczegóły sprawy (tylko komentarze widoczne dla klienta) |
| `POST /api/v1/returns/:id/comments` | klient | Odpowiedź w sprawie |
| `POST /api/v1/returns/:id/select-delivery-method` | klient | Wybór metody dostawy zwrotu |
| `POST /api/v1/returns/:id/attachments` | klient | Dołączenie pliku do sprawy |
| `POST /api/v1/returns/:id/cancel` | klient | Wycofanie sprawy |
| `GET /api/v1/returns/reasons` | klient | Aktywne powody do formularza w storefroncie |
| `GET /api/v1/returns/guest/availability` | anonimowo | Czy ten kanał przyjmuje reklamacje od gości (zob. *Reklamacje od gości*) |
| `POST /api/v1/returns/guest/verifications` | anonimowo | Wysłanie jednorazowego linku potwierdzającego adres e-mail |
| `POST /api/v1/returns/guest/sessions`, `DELETE …/sessions/current` | anonimowo | Wykorzystanie linku do rozpoczęcia sesji gościa / zakończenie sesji |
| `GET /api/v1/returns/guest/form-config`, `POST …/guest/uploads`, `POST …/guest/cases` | sesja gościa | Konfiguracja formularza gościa, przesyłanie plików i złożenie reklamacji |
| `GET /api/v1/returns/track`, `POST …/track/comments`, `POST …/track/attachments`, `GET …/track/attachments/:attachmentId/file` | link do śledzenia | Odczyt sprawy, odpowiedź, dodanie pliku, pobranie pliku — token jest przesyłany w nagłówku `X-Returns-Tracking-Token` |
| `GET /api/v1/admin/returns` | administrator | Lista spraw z filtrowaniem i wyszukiwaniem oraz licznikami dla każdego statusu |
| `GET /api/v1/admin/returns/export` | administrator | Eksport bieżącego widoku do CSV |
| `POST /api/v1/admin/returns/bulk-transition` | administrator | Masowa zmiana statusu (pomija niedozwolone) |
| `GET /api/v1/admin/returns/:id` | administrator | Szczegóły sprawy (łącznie z komentarzami wewnętrznymi) |
| `POST /api/v1/admin/returns/:id/authorize` | administrator | Nadanie numeru RMA i przejście do `authorized` |
| `POST /api/v1/admin/returns/:id/reject` | administrator | Odrzucenie z obowiązkowym powodem |
| `POST /api/v1/admin/returns/:id/transition` | administrator | Kontrolowana zmiana statusu |
| `GET\|POST /api/v1/admin/returns/:id/settlement` | administrator | Wstępne wypełnienie / wykonanie rozliczenia |
| `POST\|DELETE /api/v1/admin/returns/:id/alternative-consent` | administrator | Zapisanie / wycofanie zgody konsumenta na inne rozliczenie niż zwrot pieniędzy (zob. *Odstąpienie konsumenta od umowy*) |
| `GET\|POST /api/v1/admin/returns/:id/comments` | administrator | Lista / dodanie komentarza (widoczność i powiadomienie; zob. *Powiadomienia*) |
| `GET /api/v1/admin/returns/notification-health` | administrator | Gdzie wiadomość o nowym zgłoszeniu nie trafia do nikogo (zob. *Powiadomienia*) |
| `GET\|POST /api/v1/admin/returns/:id/shipments` + `/:shipmentId/receive` | administrator | Przesyłki zwrotne |
| `GET /api/v1/admin/returns/:id/attachments/:attachmentId/file` | administrator | Pobranie pliku sprawy |
| `POST /api/v1/admin/returns/:id/guest/tracking-link` | administrator | Wysłanie gościowi nowego linku do śledzenia (zob. *Reklamacje od gości*) |
| `POST /api/v1/admin/returns/:id/guest/erase` | administrator (`returns:erase_personal_data`) | Natychmiastowe usunięcie danych osobowych gościa ze sprawy |
| `GET\|POST /api/v1/admin/returns/clauses`, `PATCH\|DELETE …/clauses/:id` | administrator | Klauzule formularza zwrotów (zob. *Klauzule*) |
| `GET\|POST /api/v1/admin/returns/list-views` | administrator | Własne zapisane widoki wywołującego i wszystkie udostępnione / zapisanie widoku |
| `PATCH\|DELETE /api/v1/admin/returns/list-views/:id` | administrator | Zmiana / usunięcie zapisanego widoku (właściciel albo administrator platformy w przypadku widoku udostępnionego) |
| `…/statuses`, `…/transitions`, `…/reasons`, `…/delivery-methods` | administrator | Konfiguracja |

## Kto może zgłosić, zobaczyć i prowadzić sprawę

W storefroncie zasięg kupującego wynika z jego roli w organizacji. Ten moduł deklaruje dwa uprawnienia
organizacji, które administrator organizacji nadaje poszczególnym rolom:

| Uprawnienie | Kod | Czy ma je *Członek* |
| --- | --- | --- |
| **Zgłaszanie zwrotów i reklamacji** | `returns.create` | tak (domyślne uprawnienie członka) |
| **Wyświetlanie zwrotów i reklamacji organizacji** | `returns.view_organization` | nie |

*Administrator* ma oba, tak jak ma każde uprawnienie. Jeden kod obejmuje zarówno zwroty, jak i
reklamacje: to jeden formularz i jedna trasa.

- **Zgłoszenie sprawy** (`POST /api/v1/returns`) wymaga `returns.create`. Bez niego żądanie zostaje
  odrzucone z kodem `403 ORGANIZATION_PERMISSION_REQUIRED`, wskazującym uprawnienie, zanim zamówienie
  zostanie odczytane; nic nie powstaje.
- **Do jakich zamówień można zgłosić sprawę**: do każdego zamówienia, które kupujący może odczytać —
  złożonego przez siebie oraz zamówienia współpracownika, gdy jego rola ma uprawnienie modułu `orders`
  **Wyświetlanie zamówień organizacji** (`orders.view_organization`). Zasada należy do modułu `orders`
  i działa przez `OrderReadPort.findByIdForCustomer`, więc zgadza się z listą zamówień. Zamówienie
  poza zasięgiem odpowiada `404` zarówno przy odczycie pozycji do zwrotu, jak i przy zgłoszeniu.
  Sprawa zgłoszona do zamówienia współpracownika jest zgłaszana w imieniu członka, który ją
  rozpoczął: to do niego trafiają jej e-maile, a współpracownik, który złożył zamówienie, widzi sprawę
  tylko z uprawnieniem `returns.view_organization`.
- **Wyświetlanie spraw** (`GET /api/v1/returns`, `GET /api/v1/returns/:id`): sprawy zgłoszone przez
  kupującego albo — z `returns.view_organization` — wszystkie sprawy jego organizacji, a w przypadku
  logowania centrali z włączonym roll-upem także jej poddrzewa. Roll-up poszerza zasięg, ale nigdy nie
  nadaje uprawnienia. Sprawa poza zasięgiem odpowiada `404`, nigdy `403`. Każda sprawa na liście
  zawiera `customerAccountId`, czyli członka, który ją zgłosił.
- **Prowadzenie sprawy** — komentowanie, dodawanie plików, wybór sposobu odesłania zwrotu i
  anulowanie — pozostaje w gestii członka, który ją zgłosił, niezależnie od uprawnień innych osób;
  każdemu innemu te żądania odpowiadają `404`. Żadne z nich nie wymaga `returns.create`, więc członek,
  którego rola straci to uprawnienie, nadal może prowadzić sprawy zgłoszone wcześniej. Odczyt pozycji
  zamówienia, które można zwrócić, również nie wymaga uprawnienia.

Przed wprowadzeniem ról organizacji każdy kupujący — także administrator — widział i zgłaszał sprawy
tylko do zamówień, które sam złożył. *Członek* zachowuje dokładnie ten zakres; administrator widzi
teraz wszystkie sprawy organizacji i może zgłosić sprawę do zamówienia współpracownika.

W storefroncie:

- **Zwroty** (`/returns`) to lista spraw, które członek może zobaczyć. Sprawa współpracownika jest
  oznaczona *Zgłoszone przez współpracownika*. **Zgłoś nowy zwrot** widzi tylko członek, którego
  rola ma `returns.create`; strona zamówienia pokazuje swój przycisk zwrotu lub reklamacji według
  tej samej reguły.
- Bez `returns.create` strona nowej sprawy (`/returns/new`) zamiast formularza wyjaśnia: *„Twoja rola nie obejmuje uprawnienia „Zgłaszanie zwrotów i reklamacji”, więc nie możesz zgłosić zwrotu ani reklamacji. Jeśli go potrzebujesz, poproś administratora organizacji.”*
- Sprawa współpracownika otwiera się tylko do odczytu. Strona nie pokazuje pola komentarza,
  dodawania załączników, wyboru metody dostawy zwrotu ani przycisku anulowania i wyjaśnia to w
  jednym zdaniu: *„To zgłoszenie złożył współpracownik. Możesz je przeglądać, ale dodawać wiadomości i wprowadzać zmiany może tylko osoba, która je złożyła.”* Wiadomości zgłaszającego są podpisane *Współpracownik*, a nie *Ty*.

Gdy moduł jest wyłączony, oba uprawnienia znikają z katalogu uprawnień organizacji i z efektywnych
uprawnień każdego członka; zapisane w roli nadanie zostaje zachowane i znów działa po ponownym
włączeniu modułu.

## Statusy i przejścia (konfigurowalne)

Cykl życia sprawy **konfiguruje się w panelu administracyjnym** (`return_statuses` i
`return_status_transitions`, wypełniane przy instalacji). Domyślnie:

- **new** (początkowy) → **authorized** → **received** → **resolved** → **closed** (końcowy)
- **rejected** (końcowy) — dostępny z new / authorized / received; **cancelled** (końcowy) — z new /
  authorized.

Przejścia są egzekwowane; statusu początkowego nie można zmienić; ze statusów końcowych nie prowadzą
żadne przejścia. Każde przejście emituje zdarzenia `return.status.*` before/after według szablonu i
trafia do dziennika audytu — z informacją, czy podano powód (`hasReason`), nigdy z jego treścią.

## Powiadomienia

Każda z poniższych wiadomości to wiadomość transakcyjna, którą operator edytuje i może wyłączyć w
**Maile transakcyjne** (grupa *returns*); domyślne treści są po angielsku i po polsku. Wiadomość
jest wysyłana w języku kanału sprzedaży sprawy i nazywa sprawę jej **oznaczeniem**: numerem RMA, gdy
już go nadano, a do tego czasu znakiem `#` i pierwszymi ośmioma znakami identyfikatora sprawy
(`#3F9A21C0`). To samo oznaczenie jest tekstem odnośnika na liście spraw w panelu i tytułem strony
szczegółów, a wyszukiwarka w panelu znajduje po nim sprawę, z `#` albo bez.

| Wiadomość | Do kogo | Kiedy |
| --- | --- | --- |
| *Nowy zwrot lub reklamacja* (`return_new_case`) | adresy z ustawienia **Odbiorcy powiadomień o nowych zgłoszeniach** | po złożeniu sprawy |
| *Otrzymaliśmy zwrot lub reklamację* (`return_submitted`) | klient, który złożył sprawę | po złożeniu sprawy |
| *Wiadomość w sprawie zwrotu lub reklamacji* (`return_comment_added`) | klient, który złożył sprawę | operator dodaje komentarz widoczny dla klienta z opcją *Powiadom klienta e-mailem* |
| *Zmiana statusu zwrotu lub reklamacji* (`return_status_entered`) | klient, który złożył sprawę | sprawa wchodzi w status oznaczony *E-mail do klienta po wejściu* |

- **Odbiorcy powiadomień o nowych zgłoszeniach** — ustawienie `returns.new_case_recipients` w
  **Ustawienia → Zwroty**, globalnie albo dla kanału sprzedaży (lista kanału zastępuje globalną).
  Używanych jest do 10 adresów. Wpis, który nie jest adresem e-mail, jest pomijany przy wysyłce i
  odnotowywany w dzienniku jako `invalid_recipient`; pozostałe adresy i tak dostają wiadomość. Dopóki
  dla kanału nie skonfigurowano żadnego adresu, strona **Zwroty → Workflow** pokazuje ostrzeżenie z
  odnośnikiem do ustawienia.
- **Potwierdzenie** — trafia do konta, które złożyło sprawę, także gdy zamówienie złożył
  współpracownik.
- **Komentarze** — nowy komentarz jest wewnętrzny, dopóki operator nie zaznaczy *Widoczny dla
  klienta*. *Powiadom klienta e-mailem* jest dostępne tylko dla komentarza widocznego, a API odrzuca
  je dla wewnętrznego (422 `VALIDATION_FAILED`, szczegół `notify_requires_customer_visible`).
  Komentarz dodany z tą opcją ma w wątku oznaczenie *Zlecono wysłanie e-maila*. Komentarze dodane
  przed tym wydaniem nigdy nie są wysyłane.
- **Wiadomości o statusie** — status oznacza się w kolumnie **E-mail do klienta po wejściu** na
  stronie **Zwroty → Workflow**. Wiadomość jest wysyłana, gdy operator albo platforma (na przykład
  przy odebraniu przesyłki zwrotnej) przeniesie sprawę w ten status; nigdy, gdy zrobi to sam klient
  (anulując swoją sprawę), i nigdy przy złożeniu sprawy — obejmuje to potwierdzenie, więc oznaczenie
  statusu początkowego działa tylko przy późniejszym przejściu w niego. Oznaczenie statusu niczego nie
  wysyła do spraw, które już go mają. *Authorized* i *Rejected* nie można oznaczyć: wysyłają własną
  wiadomość, więc klient dostaje jedną wiadomość na przejście.
- **Dzwonek w panelu** — każdy aktywny administrator, który może przeglądać zwroty (`returns:read`),
  dostaje jeden wpis na nową sprawę z jej rodzajem, oznaczeniem i datą złożenia oraz odnośnikiem do
  niej. Wpis nie podaje klienta ani organizacji. Gdy moduł **Admin notifications** (`admin_notifications`) jest
  wyłączony, żaden wpis nie powstaje i nic więcej się nie zmienia.
- **Goście** — sprawa złożona przez gościa (zob. *Reklamacje od gości*) ma własne wiadomości,
  wysyłane na potwierdzony adres i zawierające prywatny link do śledzenia sprawy zamiast odnośnika
  do konta:

  | Wiadomość | Kiedy |
  | --- | --- |
  | *Potwierdzenie adresu e-mail do reklamacji gościa* (`return_guest_verification`) | gość prosi o link do formularza reklamacji |
  | *Otrzymaliśmy reklamację (do gościa)* (`return_guest_submitted`) | gość składa sprawę |
  | *Wiadomość w sprawie reklamacji (do gościa)* (`return_guest_comment_added`) | operator dodaje widoczny komentarz z opcją *Powiadom klienta e-mailem* |
  | *Zmiana statusu reklamacji (do gościa)* (`return_guest_status_entered`) | sprawa wchodzi w status oznaczony *E-mail do klienta po wejściu* |
  | *Reklamacja autoryzowana (do gościa)* (`return_guest_authorized`) | sprawa zostaje autoryzowana |
  | *Reklamacja odrzucona (do gościa)* (`return_guest_rejected`) | sprawa zostaje odrzucona, z powodem |
  | *Nowy link do śledzenia reklamacji (do gościa)* (`return_guest_link_reissued`) | operator wysyła nowy link do śledzenia |

  Potwierdzenia adresu i potwierdzenia złożenia **nie można wyłączyć**: pierwsze jest jedynym
  sposobem, w jaki gość może rozpocząć reklamację, drugie — jedyną trwałą drogą gościa do sprawy.
  Potwierdzenie dla gościa wychodzi więc także wtedy, gdy `return_submitted` jest wyłączone dla
  posiadaczy kont. Pozostałe podlegają tym samym przełącznikom co ich odpowiedniki dla kont.
  Wiadomość *Nowy zwrot lub reklamacja* do sklepu nazywa gościa `{imię i nazwisko} (gość)` i nie
  podaje organizacji; wpis w dzwonku dla sprawy gościa trafia tylko do administratorów, którzy
  mogą widzieć sprawy gości. Po usunięciu danych osobowych gościa nic więcej nie jest do niego
  wysyłane.
- **Doręczanie** — wiadomości i wpisy w dzwonku są wysyłane z kolejki `returns-notifications` po
  zapisaniu czynności, która je wywołała, więc nigdy jej nie spowalniają, nie przerywają ani nie
  cofają. Nieudana wysyłka jest ponawiana; wiadomość, która już wyszła, nie jest wysyłana drugi raz.
  Wiadomość niewysłana — wyłączona, bez odbiorcy, bez serwera poczty — jest odnotowywana w dzienniku
  z powodem.

## Kto autoryzował sprawę

Wejście w status *Authorized* — przyciskiem **Autoryzuj**, przyciskami statusów w sprawie albo
akcją masową na liście — nadaje numer RMA, zapisuje czas i zapisuje administratora, który to zrobił.
Szczegóły sprawy pokazują to na karcie *Zgłoszenie* jako `{czas}, autoryzował(a) {imię i nazwisko}`; lista ma kolumnę **Autoryzował(a)**, według której nie można sortować, a eksport CSV
zawiera `reference` i `authorizedBy`.

- Administrator, którego konto już nie istnieje, jest pokazywany jako *były administrator*.
- Sprawy autoryzowane przed tym wydaniem zostały uzupełnione z dziennika audytu przy instalacji
  wydania. Gdy dziennik audytu nikogo nie wskazuje, autoryzujący jest pokazywany jako *nieznany*.

## Reklamacje bez zamówienia na platformie

Sklep może przyjmować reklamacje towarów kupionych przez klienta gdzie indziej — w sklepie
stacjonarnym, u dystrybutora, na innym marketplace. Włącz **Reklamacje bez zamówienia na
platformie** (`returns.off_platform_complaints_enabled`) w **Ustawienia → Zwroty**, globalnie albo
dla kanału sprzedaży. Domyślnie ustawienie jest wyłączone.

- **W storefroncie** — *Zgłoś zwrot lub reklamację* oferuje nad listą zamówień *Kupiłeś gdzie
  indziej? Złóż reklamację bez zamówienia*. Klient bez zamówień dostaje to jako główną akcję.
  Formularz pyta o produkt (do pięciu, każdy z ilością, powodem i opisem, opcjonalnie numerem
  seryjnym i z własnymi zdjęciami wady); klient dodaje i usuwa produkty w formularzu. Produkt nie
  musi być w katalogu — produkt wycofany ze sprzedaży zgłasza się nazwą modelu. Pole produktu
  wyszukuje w katalogu sklepu i przyjmuje też wpisaną nazwę modelu:
  produkt wybrany z podpowiedzi jest sprawdzany w kanale sprzedaży, a jego nazwa kopiowana do
  sprawy; bez JavaScriptu pole przyjmuje tylko nazwę modelu. Wybrany produkt, którego kanał nie
  sprzedaje, jest odrzucany przy tej pozycji, a nazwa zostaje, by wysłać ją ponownie jako wpisany
  model. Formularz pyta też o datę zakupu, opcjonalny numer paragonu lub faktury, dowód zakupu i
  inne dokumenty, dane kontaktowe i adres, na który produkt ma wrócić. Kontakt i adres są
  wypełnione z konta i jego adresu dostawy; zmiana w formularzu nie zmienia żadnego z nich.
  Formularz działa bez JavaScriptu.
- **Dowód zakupu** — przy włączonym **Wymagany dowód zakupu** (`returns.proof_of_purchase_required`)
  reklamacja bez zamówienia jest przyjmowana tylko z plikiem typu *Dowód zakupu*. Na sprawy do
  zamówień ustawienie nie wpływa.
- **Wyłączenie** — nowe reklamacje bez zamówienia są odrzucane (`403 RETURN_OFF_PLATFORM_DISABLED`);
  już złożone zostają i są prowadzone jak dotąd.
- **Sprawa** — to zawsze reklamacja, bez zamówienia i bez kwot. Lista w panelu oznacza ją *Kupione
  gdzie indziej* i pozwala filtrować po **Pochodzeniu**; szczegóły pokazują zakup, kontakt i adres
  zwrotny tak, jak podał je klient.
- **Ponowne wysłanie** — formularz niesie klucz zgłoszenia, więc ponowne wysłanie (podwójne
  kliknięcie, przycisk *Wstecz* przeglądarki) zwraca już złożoną sprawę.

## Reklamacje od gości

Sklep, który przyjmuje reklamacje bez zamówienia na platformie, może przyjmować je także od osób
**bez konta klienta** — kogoś, kto kupił produkt w sklepie stacjonarnym albo u dystrybutora i nigdy
się nie zarejestrował. Włącz **Reklamacje od gości** (`returns.guest_complaints_enabled`) w
**Ustawienia → Zwroty**, globalnie albo dla kanału sprzedaży. Domyślnie ustawienie jest wyłączone i
działa tylko wtedy, gdy dla tego samego kanału włączone są **Reklamacje bez zamówienia na
platformie**: bez nich opcja dla gości nigdzie się nie pojawia, a reklamacja gościa jest odrzucana
(`403 RETURN_GUEST_COMPLAINTS_DISABLED`).

- **W storefroncie** — niezalogowany odwiedzający, który otwiera obszar zwrotów albo formularz
  *kupione gdzie indziej*, dostaje wybór: *Zaloguj się* (po zalogowaniu wraca na tę samą stronę)
  albo *Kontynuuj bez konta*. Przy wyłączonym ustawieniu jest kierowany do logowania, jak dotąd.
- **Potwierdzenie adresu e-mail** — gość wpisuje adres e-mail i dostaje jednorazowy link ważny
  60 minut. Strona odpowiada tymi samymi słowami bez względu na adres, więc nigdy nie zdradza, czy
  adres ma konto; gdy ma, sama wiadomość (którą widzi tylko właściciel adresu) dodaje, że
  reklamacje złożone po zalogowaniu pojawiają się na koncie. Nowszy link zastępuje poprzedni.
  Prośby są ograniczane na adres i na klienta, bez informowania o tym odwiedzającego. Otwarcie linku
  pokazuje stronę *Kontynuuj*; link zostaje wykorzystany dopiero po kliknięciu, więc skaner poczty,
  który otwiera odnośniki, go nie zużyje.
- **Sesja gościa** — kliknięcie rozpoczyna 24-godzinną sesję gościa w tym kanale sprzedaży,
  przechowywaną w ciasteczku przeglądarki. Link, który już nie działa, pokazuje stronę z propozycją
  wysłania nowego; adres jest wypełniony tylko wtedy, gdy o link prosiła ta sama przeglądarka. Gdy
  przeglądarka ma jeszcze aktywną sesję gościa, po prostu przechodzi do formularza.
- **Formularz** — formularz *kupione gdzie indziej* z niezmienionymi zasadami: produkty, dane
  zakupu, dowód zakupu, klauzule i pliki. Adres e-mail jest tym potwierdzonym i nie można go
  zmienić; imię i nazwisko, telefon i adres zwrotny gość wpisuje sam, nic nie jest wypełniane z
  góry. Gość składa tylko reklamacje — nigdy zwrot i nigdy do zamówienia na platformie. Do 5 spraw
  na sesję i 10 na adres w ciągu 24 godzin.
- **Sprawa** — **nie ma konta klienta ani organizacji** i nigdy nie jest przypisywana do konta,
  nawet gdy jej adres e-mail pasuje do jakiegoś konta albo gość jest przy składaniu zalogowany.
  Klient, którego adres ma sprawa, nie widzi jej na swoim koncie.
- **Link do śledzenia** — strona potwierdzenia i każda wiadomość do gościa zawierają prywatny link
  do strony ze sprawą: jej statusem, powodem odrzucenia, jeśli jest, produktami, zakupem, danymi
  kontaktowymi i adresem w podanej postaci, widocznymi komentarzami i plikami. **Każdy, kto ma link,
  widzi sprawę**, i strona to mówi. Dopóki sprawa jest otwarta, gość odpowiada i dodaje tam pliki
  (do 20 komentarzy na sprawę w ciągu 24 godzin); po zamknięciu strona jest tylko do odczytu. Link
  przestaje działać **90 dni po zamknięciu sprawy**, po usunięciu danych gościa albo po zastąpieniu
  go nowym; niedziałający link pokazuje jedną neutralną stronę, która nie mówi, czy sprawa istnieje.
- **Wysłanie nowego linku do śledzenia** — na stronie sprawy *Dane gościa → Wyślij nowy link do
  śledzenia* (z `returns:write`) wysyła nowy link na potwierdzony adres i od razu unieważnia stary.
  Użyj tego, gdy gość zgubił link albo przez pomyłkę go komuś przekazał. Zmiana sekretu sesji
  platformy (`SESSION_COOKIE_SECRET`) unieważnia od razu wszystkie linki gości; wyślij nowe linki
  gościom, których sprawy są jeszcze otwarte.
- **Kto widzi sprawy gości** — tylko administratorzy, którzy mogą widzieć sprawy wszystkich
  organizacji. Administrator ograniczony do części organizacji i przedstawiciel handlowy nie znajdą
  spraw gości na liście, w jej licznikach, w wyszukiwarce, w eksporcie ani w zapisanych widokach, a
  otwarcie takiej sprawy po adresie daje odpowiedź *nie znaleziono*. Na liście sprawa gościa jest
  oznaczona *Gość*, a filtr **Pochodzenie** oferuje *Kupione gdzie indziej – gość* i *Kupione gdzie
  indziej – klient* obok *Zamówienie na platformie* i *Kupione gdzie indziej*. Wyszukiwarka znajduje
  sprawy gości po dokładnym adresie e-mail z kontaktu. Eksport CSV ma kolumnę `guest`. Na stronie
  sprawy karta kontaktu pokazuje *Potwierdzony e-mail*, do kiedy działa link do śledzenia i kiedy
  zostaną usunięte dane osobowe; komentarze gościa mają oznaczenie *Gość*.
- **Rozliczenie** — jak każda reklamacja bez zamówienia na platformie: *Wymiana*, *Naprawa* albo
  *Rozliczono poza platformą* (zob. *Rozliczenie sprawy bez zamówienia na platformie*).

### Usuwanie danych osobowych gościa

Gość nie ma konta, które można usunąć, więc platforma usuwa ze sprawy jego dane kontaktowe, adres
zwrotny i pliki po określonym czasie od jej **zamknięcia** — od wejścia w status końcowy
(*Closed*, *Rejected* albo *Cancelled*). Ten czas to **Przechowywanie danych gości (dni)**
(`returns.guest_data_retention_days`), domyślnie 90; wartość poniżej 30 jest traktowana jako 30, a
powyżej 3650 jako 3650. Produkty, dane zakupu, statusy, komentarze i rozstrzygnięcie zostają w
dokumentacji sklepu; sprawa pokazuje, kiedy usunięto jej dane, a jej link do śledzenia przestaje
działać.

- **Zamykaj rozliczone sprawy.** Czas liczy się od zamknięcia, nie od rozliczenia: sprawa
  pozostawiona w statusie *Resolved* przechowuje dane gościa bez końca. Ponowne otwarcie zamkniętej
  sprawy przesuwa usunięcie na okres po jej następnym zamknięciu.
- **Na żądanie** — gdy gość prosi o wcześniejsze usunięcie danych, znajdź jego sprawy, wyszukując na
  liście jego adres e-mail, a potem w każdej wybierz *Dane gościa → Usuń dane osobowe* i potwierdź.
  Działa w każdym statusie, nie można tego cofnąć, a do gościa nie zostanie już wysłana żadna
  wiadomość. Wymaga uprawnienia **Usuwanie danych osobowych gości w zwrotach i reklamacjach**
  (`returns:erase_personal_data`, które wymaga `returns:read`); nadaj je w **Rolach administratorów**
  osobom obsługującym żądania osób, których dane dotyczą.
- **Wyłączony moduł** — codzienny przebieg `returns-maintenance` nie działa, gdy moduł `returns` jest
  wyłączony, więc usunięcie, którego termin wtedy przypada, zostaje odłożone; wykonuje się przy
  pierwszym przebiegu po ponownym włączeniu modułu.
- **Anonimizacja konta klienta nie dotyczy spraw gości** z tym samym adresem e-mail: nie należą do
  tego konta. Usuń ich dane osobno, jak wyżej.
- **Zapisy potwierdzeń** — adresy wpisane w storefroncie są usuwane po 7 dniach od prośby, bez
  względu na to, czy złożono sprawę.

## Załączniki

Klient dołącza do sprawy pliki: zdjęcia, dowód zakupu i inne dokumenty. JPEG, PNG, WebP lub PDF, do
10 MB każdy, do 30 MB na jedno wysłanie i 10 plików na sprawę. Typ jest sprawdzany na podstawie
zawartości pliku, nie jego nazwy.

- **Przesyłanie** — plik jest najpierw przesyłany (`POST /api/v1/returns/uploads`), a potem
  składany razem ze sprawą (`attachments: [{ uploadId }]`); plik przesłany i nigdy niezłożony jest
  usuwany po 24 godzinach. Po złożeniu sprawy klient dodaje pliki na jej stronie
  (`POST /api/v1/returns/:id/attachments`). Odrzucony plik dostaje odpowiedź
  `422 RETURN_ATTACHMENT_REJECTED` z powodem.
- **Plik jednego produktu** — zdjęcie wady może należeć do jednej pozycji sprawy: wyślij
  `attachments: [{ uploadId, line }]`, gdzie `line` to pozycja w `lines` żądania (od 0), albo
  `returnCaseItemId` przy pliku dodanym później. Pozycja, której sprawa nie ma, jest odrzucana z
  powodem `unknown_line`. Plik bez pozycji należy do całej sprawy; strona sprawy w panelu pokazuje
  pliki pozycji przy tym produkcie, a pozostałe w *Załącznikach*.
- **Kto je widzi** — pliki są przechowywane prywatnie: pobierają je tylko klient, który złożył
  sprawę, współpracownik, który może widzieć sprawy organizacji, i administratorzy z `returns:read`.
  Są udostępniane do pobrania, nigdy nie są wyświetlane na stronach sklepu.
- **Pliki gościa** — gość przesyła pliki w sesji gościa przed złożeniem sprawy, a potem przez link do
  śledzenia, z tymi samymi typami i limitami. Pobierają je tylko link do śledzenia tej sprawy i
  administratorzy, którzy mogą widzieć sprawy gości; pliku przesłanego w jednej sesji gościa nie
  może złożyć inna sesja ani klient. Pliki gościa są usuwane razem z jego danymi osobowymi.
- **Zmiana w tym wydaniu** — `attachmentAssetIds` w `POST /api/v1/returns` i treść JSON
  `{ assetId }` w `POST /api/v1/returns/:id/attachments` zostały usunięte: prześlij plik, a potem
  wyślij `attachments: [{ uploadId }]`, albo wyślij plik jako multipart na `/:id/attachments`. Stare
  wywołania wiązały dowolny identyfikator zasobu bez sprawdzenia, a nic nie wyświetlało tego
  powiązania. Załączniki zapisane po staremu zostają w bazie danych, z typem *Inne*, ale nie są
  wyświetlane w sprawie i nie da się ich pobrać.

## Klauzule

**Zwroty → Warunki** (także w palecie poleceń) zawiera klauzule wyświetlane w formularzu zwrotów:
etykietę, treść i opcjonalnie link do pełnych warunków, w każdym języku, dla zwrotów, reklamacji
albo obu, we wszystkich kanałach sprzedaży albo w jednym. Klauzula *Wymaga akceptacji* — klient ją
zaznacza, a bez tego sprawa jest odrzucana — albo jest *Tylko informacją*.

- Sprawa zapisuje wyświetlone z nią klauzule w wyświetlonym języku, z czasem akceptacji; szczegóły w
  panelu pokazują je w sekcji *Wyświetlone warunki*.
- Zmiana treści lub linku klauzuli rozpoczyna nową wersję. Klient, który wysyła formularz, gdy
  warunki się zmieniły, jest proszony o ponowne przeczytanie i akceptację
  (`422 RETURN_CLAUSES_NOT_ACCEPTED`).
- Etykieta i treść są wymagane w języku domyślnym. Klient widzi je w swoim języku, a gdy go brak —
  w domyślnym.

## Rozliczenie sprawy bez zamówienia na platformie

Reklamacja bez zamówienia na platformie nie ma płatności do zwrotu ani faktury do korekty.
**Rozlicz** oferuje *Wymianę*, *Naprawę* i *Rozliczono poza platformą* — to ostatnie dla
reklamacji, którą sklep rozwiązał inaczej (zwrot w sklepie, bon). Wymaga notatki, jak to zrobiono,
widocznej tylko dla zespołu. Zwrot pieniędzy, kredyt kupiecki i faktura korygująca są odrzucane
(`422 RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`). *Rozliczono poza platformą* przenosi sprawę do
*Rozwiązanej* z każdego otwartego statusu.

## Usuwanie danych osobowych

Gdy konto klienta zostaje zanonimizowane, jego sprawy zachowują pozycje, dane zakupu i komentarze,
a tracą dane kontaktowe, adres zwrotny i wszystkie pliki. Sprawa pokazuje, kiedy to nastąpiło. Jeśli
moduł `returns` był wtedy wyłączony, codzienny przebieg `returns-maintenance` nadrabia to po jego
ponownym włączeniu. Sprawy gości z tym samym adresem e-mail nie należą do konta i nie są
zmieniane; zob. *Usuwanie danych osobowych gościa*.

## Najważniejsze zachowania

- **Uprawnienie do zwrotu i okres bezpłatnego zwrotu** — sprawę można otworzyć, gdy zamówienie
  osiągnie status kończący realizację; okres bezpłatnego zwrotu (`returns.free_return_days`,
  domyślnie **14**, ustawowy termin na odstąpienie od umowy z art. 9 dyrektywy 2011/83) liczy się
  od tej chwili i decyduje, kto ponosi koszt przesyłki zwrotnej. Tą chwilą jest realizacja
  zamówienia zapisana przez moduł `orders` (`orders.completed_at`), której późniejsza edycja
  zamówienia nie przesuwa; we wcześniejszych wydaniach była nią ostatnia edycja zamówienia. Zob. *Liczenie
  terminów* poniżej.
- **Numeracja RMA** — `${prefix}${sequence}${suffix}` z `returns.rma_number_prefix` /
  `returns.rma_number_suffix`, nadawana przy autoryzacji, unikalna i nigdy nieużywana ponownie.
- **Zwroty częściowe i wielokrotne** — ilość w każdej pozycji jest ograniczona do pozostałej ilości
  możliwej do zwrotu, bez ilości objętych już sprawami, które nie zostały odrzucone ani anulowane.
- **Rozliczenie** — domyślna kwota zwrotu dla pozycji to kwota zapłacona za zwracaną ilość i nigdy
  jej nie przekracza. Dla zamówienia złożonego przy metodzie VAT liczonego dla każdej stawki ta kwota
  to spadek wartości towarów, które kupujący zatrzymuje: to, co pozostało zapłacone, pomniejszone o
  wartość zatrzymanych towarów po zwrocie (VAT dla każdej stawki od zatrzymanych wartości netto,
  pomniejszony o przypadający na nie rabat), więc może różnić się o grosz od wartości samych
  zwracanych sztuk, a wszystkie zwroty zamówienia razem nadal zwracają dokładnie to, co zapłacono. Sposoby rozliczenia: zwrot pieniędzy, środki na koncie (zasilają limit
  kredytowy organizacji w `credit_limits`), wymiana albo naprawa; odstąpienie konsumenta od umowy
  rozlicza się zwrotem pieniędzy, chyba że zapisano zgodę konsumenta na inne rozliczenie (zob.
  *Odstąpienie konsumenta od umowy*). Przy rozliczeniu pieniędzmi lub
  środkami na koncie wymagana jest faktura korygująca (`invoices` rodzaju `correction`). Zamówienie,
  które nigdy nie zostało zafakturowane, nie ma dokumentu VAT do skorygowania, więc korekta nie
  powstaje: rozliczenie się udaje, zwrot jest zapisany w sprawie i w rekordzie płatności, a wynik
  zawiera `correctiveInvoice: { issued: false, reason: "order_not_invoiced" }`. Faktura wystawiona
  później obejmuje tylko to, co kupujący zatrzymał: zwrot rozliczony zwrotem pieniędzy albo
  środkami na koncie zmniejsza ilość w pozycji zamówienia, pozycja zwrócona w całości jest
  pomijana, a rabat, który niosły zwrócone towary, zmniejsza pozycję rabatu na fakturze. To, co
  zatrzymano — kwota domyślna pomniejszona o kwotę zatwierdzoną — jest fakturowane jako część ceny towarów według stawki VAT pozycji (zob.
  *Faktury*). Na zamówieniu, które
  zostało zafakturowane, korekta zwrotu uznaje zwrócone towary i zostawia na fakturze VAT dla każdej
  stawki od wartości netto, które kupujący zatrzymał.
- **Zwrot pieniędzy z reklamacji jest obniżką ceny** — reklamacja rozliczona zwrotem pieniędzy albo
  środkami na koncie zostawia towary u kupującego, więc na zafakturowanym zamówieniu jej korekta
  uznaje zatwierdzoną kwotę według stawki VAT pozycji jako obniżkę ceny: ilość 0, bez części rabatu
  zamówienia i bez wpływu na ilość, od której liczony jest późniejszy zwrot tej pozycji. Reklamacja
  rozwiązana wymianą albo naprawą nie powoduje korekty. Reklamacja, za którą zwrócono pieniądze
  przed wystawieniem faktury, jest obecnie widoczna na fakturze jako kwota do zapłaty.
- **Domyślna kwota zwrotu jest przeliczana przy rozliczeniu** — kwota, którą sprawa pokazuje po
  otwarciu, jest wstępna. Rozliczenie przelicza ją, jedno rozliczenie zamówienia naraz, na podstawie
  spraw rozliczonych do tej chwili. Towary z tego, co kupujący zatrzymuje, zdejmuje tylko zwrot
  rozliczony zwrotem pieniędzy albo środkami na koncie; sprawa odrzucona, rozwiązana wymianą albo
  naprawą i każda reklamacja niczego nie zdejmują. Kwota może więc zmienić się o grosz lub dwa, gdy
  sprawy są rozliczane w innej kolejności, niż je otwarto, albo po odrzuceniu wcześniejszej sprawy.
  Formularz rozliczenia pokazuje przeliczoną kwotę. Zatwierdzona kwota równa kwocie domyślnej, którą
  sprawa pokazywała, jest rozliczana według przeliczonej kwoty domyślnej, niższa kwota zostaje tak,
  jak ją wpisano, a wyższa jest odrzucana z `422 RETURN_REFUND_EXCEEDS_PAID`
  i nic nie zostaje zapisane: odśwież formularz i potwierdź. Wpis `return.settled` w dzienniku
  audytu wymienia pozycje, których kwota domyślna się zmieniła (`recomputedDefaultItemIds`), bez kwot.
- **Żadna pozycja nie zwraca więcej, niż za nią zapłacono** — zwrot pieniędzy z reklamacji pomniejsza
  to, co pozostało w pozycji, której dotyczy, a jego niewchłonięta część pomniejsza to, co pozostało
  zapłacone za zamówienie: gdy zwrot tej pozycji został już o reklamację obniżony, ta kwota nie jest
  liczona drugi raz. Późniejszy
  zwrot tej pozycji nadal dostaje pełną kwotę domyślną, dopóki zwroty pozycji razem z reklamacją nie
  osiągną tego, co za nią zapłacono; od tej chwili sprawa pokazuje, a formularz rozliczenia proponuje,
  najwyżej to, co z niej zostało, a wpis w dzienniku audytu wymienia pozycję, której dotyczy to ograniczenie (`ceilingBoundItemIds`). Platforma
  nie wie, która sztuka wróciła. Przed rozliczeniem zwrotu sprawdź inne sprawy zamówienia pod kątem
  wcześniejszej reklamacji tej samej pozycji: jeśli wraca właśnie wadliwa sztuka, za którą
  zrekompensowano reklamację, obniż kwotę ręcznie.
- **Odstąpienie konsumenta od umowy zwraca koszt dostawy i dopłatę za płatność**
  (art. 13 ust. 1 dyrektywy 2011/83/UE, art. 32 ust. 1 ustawy o prawach konsumenta).
  Sprawa, z którą wraca ostatnia zwracana sztuka zamówienia B2C (organizacja zamówienia jest
  organizacją osobistą), zwraca oprócz towaru również koszt dostawy i dopłatę za płatność.
  Muszą być spełnione wszystkie warunki:
  - sprawa jest zwrotem, a nie reklamacją;
  - z tą sprawą wróciła każda sztuka każdej pozycji zamówienia, w zwrotach rozliczonych zwrotem
    pieniędzy albo zasileniem limitu. Zamówienia z pozycją, której nie można było zwrócić, nie da
    się zwrócić w całości, więc nigdy nie zwraca ono tych opłat;
  - sprawa jest rozliczana zwrotem pieniędzy albo zasileniem limitu. Wymiana i naprawa nie zwracają
    żadnej z opłat, a kwota wyższa niż 0 wysłana dla nich jest odrzucana.

  Częściowe odstąpienie nie zwraca żadnej z opłat, a formularz rozliczenia ich nie proponuje.
  Formularz rozliczenia pokazuje wiersz *Koszt dostawy* i wiersz *Dopłata za płatność*, każdy z
  zapłaconą kwotą jako maksimum. Wiersz jest wypełniony pełną kwotą, gdy sprawę otwarto w terminie
  na odstąpienie: 14 dni od zakończenia realizacji zamówienia albo `returns.free_return_days`
  kanału, jeśli ten termin jest dłuższy. Kanał ustawiony na `0` nadal ma 14 dni. Po terminie wiersz
  zaczyna się od 0 i możesz podnieść kwotę do tego, co zapłacono. Jeśli klient wybrał droższą
  dostawę niż najtańszy zwykły sposób, obniż kwotę dostawy do ceny tego sposobu (art. 13 ust. 2).
  Kwota wyższa niż zapłacona jest odrzucana z `422 RETURN_REFUND_EXCEEDS_PAID`
  (`details.code` `delivery` albo `surcharge`). W API `deliveryRefundAmount` i `surchargeRefundAmount` działają
  inaczej niż kwoty pozycji. Pole pominięte jest rozliczane według kwoty domyślnej przeliczonej przy
  rozliczeniu. Pole wysłane jest rozliczane dokładnie na tę kwotę, także `0`, o ile nie przekracza
  maksimum. Kwota, którą sprawa pokazywała przy otwarciu, może do tego czasu przekraczać maksimum
  i wtedy jest odrzucana. Formularz rozliczenia wysyła tylko kwotę, którą zmieniłeś. `totalRefundAmount`
  sprawy obejmuje wtedy opłaty, więc jest wyższy niż suma pozycji. Szczegóły sprawy podają je jako
  `chargeRefunds`, a wpis `return.settled` w dzienniku audytu wymienia zwrócone opłaty
  (`refundedCharges`), bez kwot. Zwrot klienta firmowego i każda reklamacja działają bez zmian.

  W zamówieniu z fakturą korekta zwraca dostawę i dopłatę w osobnych wierszach, ze stawką VAT,
  z jaką faktura je naliczyła (dziś 0 %). Gdy wszystko wróciło i zostało zwrócone, faktura po
  korekcie wynosi zero. W zamówieniu bez faktury wystawiona później faktura nalicza tylko to, co
  zostało z każdej opłaty, i pomija wiersz, z którego nic nie zostało. Dostawa ekspresowa obniżona
  do ceny zwykłej trafia więc na fakturę sama, na kwotę różnicy. Gdy zwrócono wszystko, nie
  zostaje żadna sprzedaż i wystawienie faktury jest odrzucane.

  Sprawy rozliczone przed tą zmianą pozostają bez zmian. Jak znaleźć zamówienia B2C zwrócone
  w całości bez zwrotu kosztu dostawy, opisuje przewodnik aktualizacji.
- **Wyłączona bramka płatności blokuje rozliczenie.** Rozliczenia pieniężne zamówień opłaconych
  przez bramkę wywołują moduł operatora płatności, który przyjął płatność; gdy operator wyłączył ten
  moduł — albo wdrożenie go nie oferuje — rozliczenie zwraca `503 MODULE_DISABLED` z nazwą modułu i
  nagłówkiem `Retry-After`. Nic się nie zmienia: sprawa zachowuje status, nie powstaje wiersz
  `refunds`, nie jest wystawiana faktura korygująca i nie wychodzi e-mail do klienta. Jedyna
  potrzebna naprawa to ponowne włączenie modułu. To co innego niż wdrożenie, które w ogóle **nie
  ma** integracji zwrotów z operatorem płatności — tam rozliczenie nadal kończy się stanem
  `pending_manual`, aby człowiek wypłacił pieniądze ręcznie, bo nie ma czego włączyć.
- **Zapisane widoki na liście zwrotów** — kontrolka *Zapisane widoki* nad listą zapisuje jej filtry
  statusu, rodzaju i numeru RMA oraz sortowanie (lista nie ma wyboru kolumn), prywatnie albo jako
  widok udostępniony każdemu administratorowi, który może otworzyć listę. Cztery trasy `list-views`
  wymagają `returns:read` i podlegają tym samym regułom co zapisane widoki list zamówień, produktów
  i zapytań ofertowych: nazwa jest przycinana, ma od 1 do 160 znaków i nie zawiera znaków
  sterujących ani formatujących; jeden administrator nie może mieć dwóch widoków, których nazwy
  różnią się tylko wielkością liter lub spacjami na brzegach (`409 RETURN_SAVED_VIEW_NAME_TAKEN`);
  `filters` jest ograniczone do 8 KB, `visibleColumns` do 64 pozycji po 64 znaki, a `sort.field` do
  64 znaków; `shared` i `sort` są wymagane przy tworzeniu. Prywatny widok innego administratora i
  identyfikator, który nie jest UUID, dają `404`; widok udostępniony zmienia lub usuwa jego
  właściciel albo administrator, którego dostęp nie jest ograniczony do zbioru organizacji (w
  przeciwnym razie `403`). Pozycje listy zawierają `ownedByCaller` i `canModify`, a `DELETE`
  odpowiada `{ data: { deleted: <id> } }`. Widoki zapisane przed wprowadzeniem tych reguł zachowują
  nazwy w zapisanej postaci — także puste i zdublowane — dopóki właściciel ich nie zmieni lub nie
  usunie; zmiana, która nie dotyczy nazwy, nigdy nie jest z tego powodu odrzucana.

## Odmowy

Każda odmowa poniżej ma własny kod i zdanie po angielsku i po polsku, które wymienia wartości z
`details`. Kupujący czyta je w języku, o który poprosił storefront, operator — w swoim. Do zgłoszenia
#625 były to odpowiedzi `VALIDATION_FAILED`, zwykle z powodem w `details.code`; status się nie
zmienił. Kod statusu trafia do `details.statusCode`, bo `details.code` jest miejscem na token odmowy.

| Kod | Status | Kiedy | `details` |
| --- | --- | --- | --- |
| `RETURN_ORDER_NOT_ELIGIBLE` | `422` | `POST /api/v1/returns` — zamówienie nie jest jeszcze zrealizowane | `orderId` |
| `RETURN_QUANTITY_EXCEEDS_RETURNABLE` | `422` | `POST /api/v1/returns` — pozycja żąda więcej, niż można jeszcze zwrócić | `orderItemId`, `requested`, `remaining` |
| `RETURN_REASON_INACTIVE` | `422` | `POST /api/v1/returns` — powód został wyłączony (sprawa do zamówienia lub reklamacja bez zamówienia) | `reasonId` |
| `RETURN_COMMENTS_CLOSED` | `409` | komentarz do sprawy w statusie końcowym | `returnCaseId`, `statusCode` |
| `RETURN_CASE_CLOSED` | `409` | `POST /api/v1/returns/:id/select-delivery-method`, `POST /api/v1/returns/:id/attachments` lub `POST /api/v1/returns/track/attachments` dla sprawy w statusie końcowym | `returnCaseId`, `statusCode` |
| `RETURN_DELIVERY_METHOD_UNAVAILABLE` | `422` | ta sama trasa — metoda dostawy zwrotu nie jest oferowana | `returnDeliveryMethodId` |
| `RETURN_SETTLEMENT_IN_PROGRESS` | `409` | `POST /api/v1/admin/returns/:id/settlement` — trwa rozliczanie innego zwrotu z tego zamówienia; spróbuj ponownie | `orderId` |
| `RETURN_REFUND_EXCEEDS_PAID` | `422` | ta sama trasa — zwrot wyższy niż dopuszczalny, dla pozycji albo, z `code` `delivery` / `surcharge`, dla opłaty | `returnCaseItemId` (pozycja), `requested`, `maximum`, `currency` |
| `RETURN_REFUND_GATEWAY_FAILED` | `502` | ta sama trasa — bramka płatności odrzuciła zwrot; nic nie zostaje rozliczone | `settlementState`, `failureReason` (słowa bramki), `providerDetails` |
| `RETURN_STATUS_CODE_TAKEN` | `409` | `POST /api/v1/admin/returns/statuses` — inny status ma już ten kod | `statusCode` |
| `RETURN_STATUS_TERMINAL_HAS_TRANSITIONS` | `409` / `422` | oznaczenie statusu z przejściami wychodzącymi jako końcowego (`code` `mark_terminal`) albo przejście ze statusu końcowego w `PUT …/transitions` (`code` `add_transition`) | `statusCode` oraz `outgoingCount` albo `toStatusCode` |
| `RETURN_STATUS_NOT_DELETABLE` | `409` | usunięcie statusu początkowego (`code` `initial`) | `statusCode` |
| `RETURN_STATUS_IN_USE` | `409` | usunięcie statusu, w którym są sprawy | `statusCode`, `caseCount` |

Kwoty są ciągami z dwoma miejscami po przecinku. Nieznana pozycja zamówienia lub zwrotu, nieznany
identyfikator powodu, brak metody płatności zwrotu, pusty powód odrzucenia i przejście wskazujące
nieistniejący status nadal dają `VALIDATION_FAILED`.

## Liczenie terminów

Oba terminy, które ocenia ten moduł — okres bezpłatnego zwrotu kanału i ustawowy termin konsumenta
na odstąpienie od umowy — liczą się od tej samej chwili: wejścia zamówienia w status kończący
realizację (`completingStatusEnteredAt` z `OrderReturnContextPort`). Zamówienie, które nie zostało
zrealizowane, nie rozpoczęło żadnego z nich. Platforma nie zna daty doręczenia (sukces przesyłki
oznacza przyjęcie paczki przez przewoźnika, co następuje wcześniej, niż konsument ją otrzyma), więc
zrealizowanie zamówienia przez operatora jest najbliższym dostępnym faktem; strona Orders prosi
operatorów, by realizowali zamówienie, gdy towar został doręczony. Moduł nie odczytuje do tego
modułu Shipments, więc jego wyłączenie nie zmienia żadnego z terminów.

- **Dni kalendarzowe w `returns.time_zone`.** Termin *n* dni kończy się z końcem *n*-tego dnia
  kalendarzowego po dniu realizacji, w strefie wskazanej przez ustawienie (nazwa IANA, domyślnie
  `Europe/Warsaw`, ustawiana także dla kanału sprzedaży; strefa nieznana środowisku jest
  odrzucana). Samego dnia realizacji się nie wlicza.
- **Weekendy.** Ostatni dzień przypadający w sobotę lub niedzielę przesuwa się na najbliższy
  poniedziałek. Święta nie są uwzględniane: nie ma kalendarza świąt.
- **Termin ustawowy** wynosi 14 dni bez względu na `returns.free_return_days` — kanał ustawiony na
  `0` lub na mniej dni nie może go skrócić.
- **7 dni karencji.** Operator może zrealizować zamówienie, zanim paczka dotrze, dlatego odstąpienie
  od umowy pozostaje możliwe jeszcze przez 7 dni kalendarzowych po późniejszym z dwóch końców:
  terminu ustawowego i okresu bezpłatnego zwrotu kanału. Odstąpienie złożone w okresie karencji jest
  przyjmowane i oznaczane jako złożone po terminie ustawowym, do oceny operatora.

We wcześniejszych wydaniach okres bezpłatnego zwrotu kończył się dokładnie `free_return_days × 24 h` po
ostatniej edycji zamówienia. Teraz kończy się do jednego dnia później (do trzech przy weekendzie),
nigdy wcześniej. Termin ustawowy i okres karencji wylicza `domain/withdrawal-period.ts`; funkcja
odstąpienia od umowy, która z nich korzysta, pojawi się w kolejnym wydaniu.

## Odstąpienie konsumenta od umowy

Konsument, który kupuje na odległość, może odstąpić od umowy w ustawowym terminie bez podawania
przyczyny i otrzymuje wtedy zwrot tym samym sposobem płatności, chyba że wyraźnie zgodzi się na inny
(dyrektywa 2011/83 art. 9 i 13 ust. 1; w Polsce art. 27 i 32 ustawy o prawach konsumenta). Ten moduł
odróżnia taką sprawę od każdego innego zwrotu i rozlicza ją zgodnie z tym.

- **Która sprawa jest odstąpieniem konsumenta.** Zwrot (`return`, nigdy reklamacja) zgłoszony przez
  organizację **osobistą** (taką, jaką każdy konsument otrzymuje przy zakupie; nigdy firmę), w czasie,
  gdy odstąpienie od umowy jest jeszcze możliwe dla tego zamówienia: ustawowe 14 dni, dłuższy okres
  bezpłatnego zwrotu kanału i 7 dni karencji po obu (zob. *Liczenie terminów*). Odpowiedź ustala się
  w chwili zgłoszenia sprawy, a szczegóły sprawy podają ją jako `consumerWithdrawal`; widok sprawy w
  panelu administracyjnym oznacza ją jako **Odstąpienie konsumenta**. Zwrot organizacji osobistej
  zgłoszony po okresie karencji jest zwrotem handlowym na zasadach sklepu i nic z poniższego go nie
  dotyczy. O tym, czy organizacja jest *osobista*, decyduje chwila złożenia zamówienia: zamówienie
  złożone, gdy organizacja była osobista, pozostaje zamówieniem konsumenta także po tym, jak operator
  przekształci tę organizację w firmę. Przedsiębiorca na jednoosobowej działalności kupujący przez organizację firmową może mieć
  to samo prawo (art. 38a); platforma nie potrafi tego rozpoznać, więc taką sprawę operator prowadzi
  ręcznie.
- **Sprawy zgłoszone przed tym wydaniem** nie mają odpowiedzi (`consumerWithdrawal: null`) i są
  traktowane jak zwykłe zwroty. Ich klasyfikacja wymaga danych organizacji, których migracja nie może
  odczytać, dlatego otwarte sprawy sklasyfikuje w tle jedno z kolejnych wydań.
- **Domyślnie zwrot pieniędzy.** Formularz rozliczenia zaczyna od **Zwrot pieniędzy** na sposób
  płatności zamówienia (`defaultRefundPaymentMethodId` w danych wstępnych rozliczenia). Sposób
  płatności wybiera się po nazwie z listy sposobów płatności sklepu, na której sposób zamówienia jest
  pierwszy i oznaczony; gdy listy nie da się odczytać, formularz pokazuje pole na identyfikator
  sposobu. Środki na koncie, wymiana i naprawa są widoczne, ale nie można ich wybrać, dopóki nie zapisano zgody konsumenta, a rozliczenie je
  odrzuca z `422 RETURN_ALTERNATIVE_RESOLUTION_CONSENT_REQUIRED` (`details.resolution` wskazuje
  odrzucony sposób). Dane wstępne wymieniają je w `consentRequiredFor` i nadal podają wszystkie sposoby
  w `resolutionOptions`. Zwroty firm i reklamacje się nie zmieniają.
- **Inny sposób płatności ostrzega, ale nie blokuje.** Zamówienia płaconego przy odbiorze nie da się
  zwrócić „tym samym sposobem”, a przyjętą praktyką jest wtedy przelew. Formularz pokazuje
  ostrzeżenie, rozliczenie przechodzi, a jego wpis w dzienniku zdarzeń (`return.settled`) zawiera
  `consumerWithdrawal: true` i `refundMethodDiffers: true`.
- **Zapisanie zgody konsumenta.** Zgoda zwykle dociera do sklepu e-mailem albo telefonicznie.
  Operator z uprawnieniem `returns:write` zapisuje ją w panelu **Odstąpienie konsumenta od umowy**
  sprawy: na co konsument się zgodził (środki na koncie, wymiana albo naprawa), kiedy (nie w
  przyszłości i nie przed zgłoszeniem sprawy) oraz dowód o długości do 2000 znaków, na przykład
  *„E-mail klienta z 10 listopada 2026, zgłoszenie nr 123”*. Rozliczenie przyjmuje wtedy ten sposób,
  a dwa pozostałe nadal odrzuca. Ponowne zapisanie zastępuje wcześniejszą zgodę. **Wycofaj zgodę**
  usuwa ją po potwierdzeniu, które mówi, co zostanie utracone: notatka z dowodem jest usuwana, a
  historia zachowuje informację, że zgodę zarejestrowano i wycofano. Obie czynności trafiają do dziennika zdarzeń (`return_case.alternative_consent.record` i
  `.revoke`) z operatorem jako wykonawcą; wpis zawiera sposób rozliczenia, chwilę i źródło, ale nie
  treść dowodu, która zostaje w sprawie. Po rozliczeniu sprawy zgoda jest zamrożona: obie czynności
  odpowiadają `409` (`details.code: 'consent_frozen'`). Sprawy w **statusie końcowym** skonfigurowanego
  przebiegu (`rejected`, `cancelled` albo dowolny status, który operator oznaczył jako końcowy) nie da
  się już rozliczyć, więc jej zgoda jest również zamknięta: obie czynności odpowiadają `409`
  (`details.code: 'case_closed'`), nic nie jest zapisywane, a panel pokazuje zapisaną zgodę tylko do
  odczytu, bez akcji. Czas wyrażenia zgody jest pokazywany w strefie czasowej przeglądarki operatora,
  podanej obok. Sprawa, która nie jest odstąpieniem
  konsumenta, odpowiada `422` (`details.code: 'not_consumer_withdrawal'`).
- **Dane osobowe.** Oświadczenie o odstąpieniu od umowy, które ten moduł będzie przechowywał, trzyma
  imię i nazwisko oraz adres e-mail konsumenta w dwóch osobnych kolumnach, które można wyczyścić,
  zachowując samo oświadczenie jako dowód sklepu.

Funkcja odstąpienia od umowy w sklepie (art. 11a, dodany dyrektywą (UE) 2023/2673 i stosowany od
19 czerwca 2026), e-mail z potwierdzeniem otrzymania i 14-dniowy termin zwrotu płatności pojawią się
w kolejnych wydaniach.

## Produkty podlegające zwrotowi

O tym, czy pozycję można zwrócić, decyduje flaga **Podlega zwrotowi** produktu w stanie z chwili
złożenia zamówienia — moduł Orders zapisuje ją na każdej pozycji zamówienia przy jego składaniu, a
późniejsze zmiany produktu nie dotyczą już złożonych zamówień. Flagę ustawia się na produkcie w
katalogu (opisuje ją strona modułu Catalog, łącznie z ustawianiem jej dla wielu produktów naraz
przez **Edycję masową**).

- **Odpowiedź dla każdej pozycji.** `GET /api/v1/orders/:orderId/returnable` podaje dla każdej
  pozycji `returnable` (zawsze obecne), a dla pozycji, której nie można zwrócić —
  `notReturnableReason: 'product_not_returnable'`. Pozycja zamówienia złożonego, zanim flagę
  zaczęto zapisywać, nie ma zapisanej wartości i **jest traktowana jako podlegająca zwrotowi**.
- **`eligible` dotyczy tylko spraw rodzaju zwrot.** Werdykt dla zamówienia ma kolejność
  pierwszeństwa: `order_not_completing`, `fully_returned`, potem `no_returnable_lines`.
  `eligible: false` z `reason: 'no_returnable_lines'` oznacza, że w zamówieniu zostały jeszcze
  ilości, ale żadna na pozycji podlegającej zwrotowi: **zwrotu nie można otworzyć, ale reklamację
  nadal tak.**
- **Zwrot wskazujący pozycję niepodlegającą zwrotowi jest odrzucany.** `POST /api/v1/returns` z
  `kind: 'return'` odpowiada kodem `422 RETURN_LINE_NOT_RETURNABLE`, gdy którakolwiek wskazana
  pozycja została zapisana jako niepodlegająca zwrotowi, z `details.productName` (pierwsza taka
  pozycja), `details.orderItemIds[]` i `details.lines[]` (`orderItemId`, `productName`)
  wymieniającymi każdą taką pozycję. Nic nie jest zapisywane.
- **Reklamacje nigdy nie są ograniczane** flagą: `complaint` może wskazać dowolną pozycję
  zamówienia. **Za pozycję bez prawa zwrotu domyślnie nic nie jest zwracane**: taka pozycja
  reklamacji jest zapisywana z zatwierdzoną kwotą zwrotu `0`, a jej domyślna kwota zwrotu pozostaje
  kwotą zapłaconą — najwyższą, jaką operator może zatwierdzić. Widok sprawy w panelu oznacza pozycję
  jako **Bez prawa zwrotu przy zakupie**, a formularz rozliczenia zaczyna dla niej od `0`, więc
  zwrot pieniędzy lub środków następuje tylko wtedy, gdy operator wpisze kwotę. Szczegóły sprawy
  podają dla każdej pozycji `returnableAtPurchase` (`true`, `false` albo `null` dla pozycji złożonej,
  zanim ta wartość była zapisywana).
- **Powtórzone pozycje są sumowane.** Gdy żądanie wskazuje jedną pozycję zamówienia więcej niż raz,
  ilości są sumowane dla każdej pozycji zamówienia, a suma jest porównywana z ilością pozostałą do
  zwrotu, dla obu rodzajów; suma powyżej niej jest odrzucana z kodem
  `422 RETURN_QUANTITY_EXCEEDS_RETURNABLE`. Wpisy są nadal zapisywane tak, jak je przesłano.
- **Kolejność sprawdzeń.** Pozycja spoza zamówienia (`details.code: 'unknown_line'`) jest zgłaszana
  przed jakimkolwiek błędem ilości, sprawdzenie ilości poprzedza sprawdzenie powodu
  (`unknown_reason` albo `RETURN_REASON_INACTIVE` dla powodu, który wyłączono), a podleganie zwrotowi jest sprawdzane na końcu. Sprawy otwarte, zanim produkt
  oznaczono jako niepodlegający zwrotowi, nigdy nie są oceniane ponownie.

**Po aktualizacji żaden istniejący produkt nie podlega zwrotowi.** Flaga jest domyślnie wyłączona,
więc pozycje zamówień złożonych po wydaniu nie podlegają zwrotowi, dopóki produkt nie zostanie
oznaczony w katalogu jako podlegający zwrotowi — zaznacz produkty na liście produktów i użyj
**Edycja masowa → Podlega zwrotowi → Tak — podlega zwrotowi**. Zamówienia złożone przed wydaniem
pozostają bez zmian: ich pozycje nie mają zapisanej wartości i nadal podlegają zwrotowi.

## W dzienniku audytu

Sprawa zwrotu to rekord organizacji, a dziennik audytu całej platformy czyta każdy, kto ma
`audit_log:read`, bez względu na to, które organizacje widzi. Dlatego wpisy sprawy nazywają i
liczą, a nie zawierają żadnej kwoty ani wolnego tekstu: `return.settled` zapisuje sposób
rozliczenia, walutę, stan rozliczenia i wynik korekty, a pozycje i opłaty, których dotyczy, przez
identyfikator albo rodzaj; `return.status_changed` zapisuje status i to, czy podano powód. Kwoty
są w sprawie i w jej zwrocie pieniędzy. Powód podany przy zmianie statusu trafia do zdarzeń statusu, które
ta zmiana emituje, i nie jest zapisywany nigdzie indziej. Wpisy
zapisane przed tą zmianą zachowują to, z czym zostały zapisane.

Reklamacja bez zamówienia na platformie rozliczona poza platformą zapisuje `offPlatform: true` i to,
czy podano notatkę, nigdy samą notatkę. Złożenie sprawy (`return_case.create`), dodanie pliku i
zmiana klauzuli są zapisywane bez tekstu klienta i klauzuli. Usunięcie danych konta
(`return_case.erase_personal_data`) zapisuje liczbę spraw i plików oraz nazwy usuniętych pól.

Czynności gościa są zapisywane z `by: 'guest'` i bez wykonawcy: złożenie sprawy
(`return_case.create`, z identyfikatorem sesji gościa), komentarz przez link do śledzenia
(`return_case.comment.add_by_guest`, z długością komentarza, nigdy z jego treścią) i plik
(`return_case.attachment.add`). *Wyślij nowy link do śledzenia* (`return_case.tracking_link.reissue`)
zapisuje numery wersji linku, nigdy sam link. Usunięcie danych gościa (`return_case.guest_data.erase`)
zapisuje, czy powodem był upływ okresu przechowywania, czy żądanie, liczbę plików i nazwy usuniętych
pól. Żaden wpis nie zawiera adresu e-mail, imienia i nazwiska, telefonu, adresu, komentarza ani linku
gościa.

## Interfejsy między modułami

Moduł odczytuje i zmienia dane innych domen wyłącznie przez udokumentowane porty, nigdy przez
importy wnętrza innych modułów:

- `OrderReadPort.findByIdForCustomer` (orders) — czy kupujący może odczytać zamówienie, do którego
  zgłasza sprawę (własne albo współpracownika z `orders.view_organization`).
- `OrganizationPermissionPort` (organizations) — `returns.create` i `returns.view_organization`,
  sprawdzane przy każdym żądaniu.
- `OrganizationDetailsPort.findById` (organizations) — czy organizacja sprawy jest osobista,
  odczytywane raz, przy zgłoszeniu zwrotu.
- `OrderReturnContextPort` (orders) — kwoty zapłacone za każdą pozycję i czas osiągnięcia statusu
  kończącego realizację, sposób płatności zamówienia oraz `returnableAtPurchase` każdej pozycji (`true`/`false` zapisane przy
  składaniu zamówienia, `null` dla zamówienia złożonego, zanim zaczęto je zapisywać). Moduł Orders
  podaje fakt; zasada dla `null` — podlega zwrotowi — należy do tego modułu. Port podaje też koszt
  dostawy i dopłatę za płatność zamówienia.
- `OrganizationDetailsPort` (organizations) — czy organizacja zamówienia jest organizacją osobistą
  (B2C), od czego zależy, czy odstąpienie zwraca dostawę i dopłatę.
- `PaymentRefundPort` (payments) — wykonanie zwrotu, odpowiedź `pending_manual`, gdy nie ma
  integracji z operatorem płatności, albo odmowa, gdy bramka, która przyjęła płatność, jest
  wyłączona.
- `CorrectiveInvoicePort` (invoices) — utworzenie faktury `correction` albo odpowiedź, że korekta nie
  jest potrzebna, bo zamówienie nie ma faktury. Odstąpienie konsumenta zamykające zamówienie
  podaje też zwracaną dostawę i dopłatę (`charges`).
- `CreditTopupPort` (credit_limits) — zasilenie limitu kredytowego organizacji.
- `ShipmentService` (shipments) — opcjonalna przesyłka z towarem na wymianę.
- `TransactionalEmailSender` (transactional_emails) — wszystkie wiadomości tego modułu.
- `CustomerAccountReadPort` (customer_accounts) — adres i imię oraz nazwisko składającego sprawę.
- `AdminUserReadPort` (admin_users) — imię i nazwisko autoryzującego oraz administratorzy, do których
  trafia wpis w dzwonku o nowej sprawie; `PermissionReadPort` (admin_roles) — którzy z nich mają
  `returns:read`.
- `AdminNotificationRecordPort` (admin_notifications) — wpisy w dzwonku, tylko gdy ten moduł jest
  obecny.
- `AdminI18nTranslatePort` (_i18n) — *były administrator* i *nieznany* w eksporcie CSV w języku
  administratora.
- `ObjectStoragePort` (assets_library) — zawartość załączników, przechowywana prywatnie.
- `CatalogProductAvailabilityPort` (catalog) — czy produkt wskazany w reklamacji bez zamówienia
  istnieje w kanale, i jego nazwa.
- `TransactionalEmailStatePort` (transactional_emails) — czy wiadomość z potwierdzeniem jest
  włączona, żeby storefront obiecywał ją tylko wtedy.
- `AdminTenantScopePort` (organizations) — czy administrator może widzieć sprawy wszystkich
  organizacji, od czego zależy, kto dostaje wpis w dzwonku dla sprawy gościa.
- Pieczęć kursora platformy — podpisuje linki potwierdzające i linki do śledzenia gości sekretem
  sesji, więc platforma nie przechowuje żadnego linku.

## Schemat

Migracja `20260625T144227_returns_init.ts` tworzy `return_cases`, `return_case_items`, `return_case_comments`,
`return_statuses`, `return_status_transitions`, `return_reasons`, `return_delivery_methods`,
`refunds`, `return_shipments`, `return_case_attachments`, `return_list_saved_views` oraz sekwencję
`return_cases_rma_seq`.

Migracja `20261108T023047_returns_consumer_withdrawal.ts` dodaje do `return_cases` kolumny odstąpienia
konsumenta od umowy (`consumer_withdrawal`, kolumny zgody i fakty terminu zwrotu płatności) oraz
tworzy `return_withdrawal_statements`. Nie dotyka tabel innych modułów, więc istniejących spraw nie
klasyfikuje.

Migracja `20261108T125405_returns_case_charge_refunds.ts` dodaje do `return_cases` cztery
kolumny: `default_delivery_refund`, `approved_delivery_refund`, `default_surcharge_refund`
i `approved_surcharge_refund`, każda domyślnie `0.00`. Istniejące sprawy zachowują `0.00`.

Migracja `20261113T145001_returns_authorizer_status_notifications.ts` dodaje
`return_cases.authorized_by_admin_user_id` i `return_statuses.notify_customer_on_entry` (`false` dla
każdego statusu) oraz uzupełnia autoryzującego w sprawach już autoryzowanych na podstawie
najnowszego wpisu dziennika audytu jądra, który wskazuje administratora.

Migracja `20261113T155433_returns_off_platform_complaints.ts` sprawia, że `return_cases.order_id`
może być pusty — sprawa bez zamówienia musi być reklamacją z datą zakupu — i dodaje kolumny zakupu,
kontaktu, adresu zwrotnego, zaakceptowanych klauzul, notatki rozliczenia, klucza zgłoszenia i
usunięcia danych. `return_case_items` dostaje opcjonalną pozycję zamówienia i produkt oraz
`serial_number`; `return_case_attachments` dostaje organizację, klienta, typ, nazwę, typ i rozmiar
pliku, miejsce przechowywania i czas wygaśnięcia niezłożonego pliku; organizacja istniejących
załączników jest uzupełniana z ich sprawy. Migracja tworzy `return_case_clauses`. Jej wycofanie jest
odrzucane, dopóki istnieje sprawa bez zamówienia na platformie.

Migracja `20261116T104415_returns_guest_complaints.ts` sprawia, że `return_cases.customer_account_id`
może być pusty — sprawa bez konta to reklamacja gościa bez zamówienia na platformie i nigdy nie ma
organizacji — i dodaje sesję gościa, która złożyła sprawę, czas potwierdzenia adresu i wersję linku
do śledzenia. `return_case_comments` dostaje `author_guest`; `return_case_attachments` dostaje sesję
gościa, która przesłała plik, i `uploaded_by_guest`. Migracja tworzy `return_guest_verifications`:
jeden wiersz na każdy żądany link, który po wykorzystaniu staje się sesją gościa i przechowuje tylko
skrót tokenu sesji. Jej wycofanie jest odrzucane, dopóki istnieje sprawa gościa.
