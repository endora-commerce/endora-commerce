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
| `POST /api/v1/returns` | klient | Otwarcie sprawy zwrotu lub reklamacji |
| `GET /api/v1/returns` | klient | Lista spraw wywołującego albo całej organizacji (zob. *Kto może zgłosić, zobaczyć i prowadzić sprawę*) |
| `GET /api/v1/returns/:id` | klient | Szczegóły sprawy (tylko komentarze widoczne dla klienta) |
| `POST /api/v1/returns/:id/comments` | klient | Odpowiedź w sprawie |
| `POST /api/v1/returns/:id/select-delivery-method` | klient | Wybór metody dostawy zwrotu |
| `POST /api/v1/returns/:id/cancel` | klient | Wycofanie sprawy |
| `GET /api/v1/returns/reasons` | klient | Aktywne powody do formularza w storefroncie |
| `GET /api/v1/admin/returns` | administrator | Lista spraw z filtrowaniem i wyszukiwaniem oraz licznikami dla każdego statusu |
| `GET /api/v1/admin/returns/export` | administrator | Eksport bieżącego widoku do CSV |
| `POST /api/v1/admin/returns/bulk-transition` | administrator | Masowa zmiana statusu (pomija niedozwolone) |
| `GET /api/v1/admin/returns/:id` | administrator | Szczegóły sprawy (łącznie z komentarzami wewnętrznymi) |
| `POST /api/v1/admin/returns/:id/authorize` | administrator | Nadanie numeru RMA i przejście do `authorized` |
| `POST /api/v1/admin/returns/:id/reject` | administrator | Odrzucenie z obowiązkowym powodem |
| `POST /api/v1/admin/returns/:id/transition` | administrator | Kontrolowana zmiana statusu |
| `GET\|POST /api/v1/admin/returns/:id/settlement` | administrator | Wstępne wypełnienie / wykonanie rozliczenia |
| `GET\|POST /api/v1/admin/returns/:id/comments` | administrator | Lista / dodanie komentarza (widoczność i powiadomienie) |
| `GET\|POST /api/v1/admin/returns/:id/shipments` + `/:shipmentId/receive` | administrator | Przesyłki zwrotne |
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
trafia do dziennika audytu.

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
  kredytowy organizacji w `credit_limits`), wymiana albo naprawa. Przy rozliczeniu pieniędzmi lub
  środkami na koncie wymagana jest faktura korygująca (`invoices` rodzaju `correction`). Zamówienie,
  które nigdy nie zostało zafakturowane, nie ma dokumentu VAT do skorygowania, więc korekta nie
  powstaje: rozliczenie się udaje, zwrot jest zapisany w sprawie i w rekordzie płatności, a wynik
  zawiera `correctiveInvoice: { issued: false, reason: "order_not_invoiced" }`. Faktura wystawiona
  później obejmuje tylko to, co kupujący zatrzymał: zwrot rozliczony zwrotem pieniędzy albo
  środkami na koncie zmniejsza ilość w pozycji zamówienia, pozycja zwrócona w całości jest
  pomijana, a rabat, który oddał zwrot, zmniejsza pozycję rabatu na fakturze. Na zamówieniu, które
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
  jak ją wpisano, a wyższa jest odrzucana z `422 VALIDATION_FAILED` (`code: refund_exceeds_paid`)
  i nic nie zostaje zapisane: odśwież formularz i potwierdź. Wpis `return.settled` w dzienniku
  audytu odnotowuje kwotę domyślną, która się zmieniła (`recomputedDefaults`).
- **Żadna pozycja nie zwraca więcej, niż za nią zapłacono** — zwrot pieniędzy z reklamacji pomniejsza
  to, co pozostało w pozycji, której dotyczy, a jego niewchłonięta część pomniejsza to, co pozostało
  zapłacone za zamówienie: gdy zwrot tej pozycji został już o reklamację obniżony, ta kwota nie jest
  liczona drugi raz. Późniejszy
  zwrot tej pozycji nadal dostaje pełną kwotę domyślną, dopóki zwroty pozycji razem z reklamacją nie
  osiągną tego, co za nią zapłacono; od tej chwili sprawa pokazuje, a formularz rozliczenia proponuje,
  najwyżej to, co z niej zostało, a wpis w dzienniku audytu odnotowuje to ograniczenie (`lineCeilings`). Platforma
  nie wie, która sztuka wróciła. Przed rozliczeniem zwrotu sprawdź inne sprawy zamówienia pod kątem
  wcześniejszej reklamacji tej samej pozycji: jeśli wraca właśnie wadliwa sztuka, za którą
  zrekompensowano reklamację, obniż kwotę ręcznie.
- **Odstąpienie konsumenta od umowy zwraca koszt dostawy i dopłatę za płatność**
  (art. 13 ust. 1 dyrektywy 2011/83/UE, art. 32 ust. 1 ustawy o prawach konsumenta).
  Sprawa, z którą wraca ostatnia zwracana sztuka zamówienia B2C (organizacja zamówienia jest
  organizacją prywatną), zwraca oprócz towaru również koszt dostawy i dopłatę za płatność.
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
  Kwota wyższa niż zapłacona jest odrzucana z `422 VALIDATION_FAILED`
  (`code: refund_exceeds_paid`). W API `deliveryRefundAmount` i `surchargeRefundAmount` działają
  inaczej niż kwoty pozycji. Pole pominięte jest rozliczane według kwoty domyślnej przeliczonej przy
  rozliczeniu. Pole wysłane jest rozliczane dokładnie na tę kwotę, także `0`, o ile nie przekracza
  maksimum. Kwota, którą sprawa pokazywała przy otwarciu, może do tego czasu przekraczać maksimum
  i wtedy jest odrzucana. Formularz rozliczenia wysyła tylko kwotę, którą zmieniłeś. `totalRefundAmount`
  sprawy obejmuje wtedy opłaty, więc jest wyższy niż suma pozycji. Szczegóły sprawy podają je jako
  `chargeRefunds`, a wpis `return.settled` w dzienniku audytu odnotowuje maksimum i zatwierdzoną
  kwotę każdej z nich (`charges`). Zwrot klienta firmowego i każda reklamacja działają bez zmian.

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
  zwrotu, dla obu rodzajów; suma powyżej niej jest odrzucana z kodem `422 VALIDATION_FAILED`,
  `details.code: 'qty_exceeds_returnable'`. Wpisy są nadal zapisywane tak, jak je przesłano.
- **Kolejność sprawdzeń.** Pozycja spoza zamówienia (`details.code: 'unknown_line'`) jest zgłaszana
  przed jakimkolwiek błędem ilości, sprawdzenie ilości poprzedza sprawdzenie powodu
  (`unknown_reason`), a podleganie zwrotowi jest sprawdzane na końcu. Sprawy otwarte, zanim produkt
  oznaczono jako niepodlegający zwrotowi, nigdy nie są oceniane ponownie.

**Po aktualizacji żaden istniejący produkt nie podlega zwrotowi.** Flaga jest domyślnie wyłączona,
więc pozycje zamówień złożonych po wydaniu nie podlegają zwrotowi, dopóki produkt nie zostanie
oznaczony w katalogu jako podlegający zwrotowi — zaznacz produkty na liście produktów i użyj
**Edycja masowa → Podlega zwrotowi → Tak — podlega zwrotowi**. Zamówienia złożone przed wydaniem
pozostają bez zmian: ich pozycje nie mają zapisanej wartości i nadal podlegają zwrotowi.

## Interfejsy między modułami

Moduł odczytuje i zmienia dane innych domen wyłącznie przez udokumentowane porty, nigdy przez
importy wnętrza innych modułów:

- `OrderReadPort.findByIdForCustomer` (orders) — czy kupujący może odczytać zamówienie, do którego
  zgłasza sprawę (własne albo współpracownika z `orders.view_organization`).
- `OrganizationPermissionPort` (organizations) — `returns.create` i `returns.view_organization`,
  sprawdzane przy każdym żądaniu.
- `OrderReturnContextPort` (orders) — kwoty zapłacone za każdą pozycję i czas osiągnięcia statusu
  kończącego realizację oraz `returnableAtPurchase` każdej pozycji (`true`/`false` zapisane przy
  składaniu zamówienia, `null` dla zamówienia złożonego, zanim zaczęto je zapisywać). Moduł Orders
  podaje fakt; zasada dla `null` — podlega zwrotowi — należy do tego modułu. Port podaje też koszt
  dostawy i dopłatę za płatność zamówienia.
- `OrganizationDetailsPort` (organizations) — czy organizacja zamówienia jest organizacją prywatną
  (B2C), od czego zależy, czy odstąpienie zwraca dostawę i dopłatę.
- `PaymentRefundPort` (payments) — wykonanie zwrotu, odpowiedź `pending_manual`, gdy nie ma
  integracji z operatorem płatności, albo odmowa, gdy bramka, która przyjęła płatność, jest
  wyłączona.
- `CorrectiveInvoicePort` (invoices) — utworzenie faktury `correction` albo odpowiedź, że korekta nie
  jest potrzebna, bo zamówienie nie ma faktury. Odstąpienie konsumenta zamykające zamówienie
  podaje też zwracaną dostawę i dopłatę (`charges`).
- `CreditTopupPort` (credit_limits) — zasilenie limitu kredytowego organizacji.
- `ShipmentService` (shipments) — opcjonalna przesyłka z towarem na wymianę.

## Schemat

Migracja `20260625T144227_returns_init.ts` tworzy `return_cases`, `return_case_items`, `return_case_comments`,
`return_statuses`, `return_status_transitions`, `return_reasons`, `return_delivery_methods`,
`refunds`, `return_shipments`, `return_case_attachments`, `return_list_saved_views` oraz sekwencję
`return_cases_rma_seq`.

Migracja `20261108T125405_returns_case_charge_refunds.ts` dodaje do `return_cases` cztery
kolumny: `default_delivery_refund`, `approved_delivery_refund`, `default_surcharge_refund`
i `approved_surcharge_refund`, każda domyślnie `0.00`. Istniejące sprawy zachowują `0.00`.
