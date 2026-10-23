---
title: orders
description: Składanie zamówień, statusy i ich przejścia, powiązanie z płatnością i dostawą
---

# `orders`

Składanie zamówień, ich cykl życia i kontrola dostępu. Łączy wyznaczanie cen w koszyku, rezerwację
stanów magazynowych, uruchomienie sterownika płatności, generowanie faktur i zapis do dziennika
audytu.

## API publiczne

Trasy administracyjne są chronione przez `orders:read` (odczyt) i `orders:write` (zmiany).

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `POST /api/v1/orders` | klient | Złożenie zamówienia z aktywnego koszyka |
| `GET /api/v1/orders` | klient | Lista zamówień ograniczona rolą (zwykły użytkownik lub administrator organizacji) |
| `GET /api/v1/orders/:id` | klient | Szczegóły zamówienia |
| `GET /api/v1/orders/:id/invoice` | klient | Pobranie faktury PDF |
| `GET /api/v1/admin/orders` | administrator | Lista wszystkich zamówień (we wszystkich organizacjach) |
| `GET /api/v1/admin/orders/:id` | administrator | Szczegóły zamówienia (bez ograniczenia do klienta) |
| `POST /api/v1/admin/orders/:id/status` | administrator | Zmiana statusu (audytowana) |
| `POST /api/v1/admin/orders/:id/payment-status` | administrator | Zmiana statusu płatności (audytowana) |

## Który kanał sprzedaży zapisuje zamówienie

Zamówienie zapisuje jeden kanał sprzedaży. Skąd on pochodzi, zależy od tego, kto
składa zamówienie:

| Miejsce | Kanał zamówienia |
| --- | --- |
| Sklep — `POST /api/v1/orders`, zakup jednym kliknięciem | Kanał **rozpoznany dla żądania**: `X-Sales-Channel`, `?salesChannel=`, mapa hostów, a w ostatniej kolejności kanał domyślny |
| Tworzenie zamówienia w panelu — `POST /api/v1/admin/orders` | Kanał wybrany przez operatora dla zamówienia (`salesChannelId` w treści żądania) |
| Klucz API — zewnętrzne przyjmowanie zamówień | Kanał, z którym powiązany jest klucz |

W sklepie opcjonalne pole `salesChannelId` w treści żądania nie wybiera kanału.
Żądanie bez tego pola jest składane w rozpoznanym kanale; żądanie z identyfikatorem
rozpoznanego kanału jest przyjmowane; żądanie wskazujące **inny** kanał — inny
istniejący, nieistniejący albo wyłączony — jest odrzucane odpowiedzią
`422 VALIDATION_FAILED` z `details.code = "order_sales_channel_mismatch"`
(szczegóły zawierają `requestedSalesChannelId` i `resolvedSalesChannelId`), zanim
cokolwiek zostanie zapisane — koszyk pozostaje bez zmian.

Przy tworzeniu zamówienia w panelu pole `salesChannelId` w treści żądania musi
wskazywać istniejący kanał: żądanie wskazujące kanał, którego nie ma, jest
odrzucane odpowiedzią `404 NOT_FOUND`, zanim cokolwiek zostanie zapisane — także
koszyk klienta. Zamawiane produkty są sprawdzane względem asortymentu **tego**
kanału, a nie kanału rozpoznanego dla samego żądania panelu — produkt, którego
wybrany kanał nie sprzedaje, jest odrzucany odpowiedzią `404 PRODUCT_NOT_FOUND`,
a produkt, który sprzedaje, jest przyjmowany, nawet jeśli kanał domyślny go nie
sprzedaje. Tworzenie zamówienia w panelu przyjmuje natomiast kanał, który istnieje,
ale jest wyłączony — sklep odrzuca taki kanał odpowiedzią `422`
`order_sales_channel_mismatch`. Produkt spoza asortymentu wybranego kanału jest
odrzucany, zanim koszyk klienta zostanie naruszony, więc koszyk pozostaje bez zmian.

Z kanału zamówienia odczytywane są:

- przy składaniu zamówienia — minimalna wartość zamówienia
  (`orders.min_order_value`), magazyny brane pod uwagę przy rezerwacji i ustawienia
  realizacji kanału, prefiks i sufiks numeru zamówienia, dodatkowi odbiorcy
  potwierdzenia oraz identyfikator kanału przekazywany walidatorom adapterów
  płatności i dostawy;
- później — dane sprzedawcy i sekwencja numerów jego faktur, język i kanał
  wiadomości e-mail o zamówieniu, płatności i przesyłce oraz to, czy zamówienie
  można ponowić (`orders.reorder_enabled`).

**Sklep musi wskazać kanał w samym żądaniu złożenia zamówienia.** Referencyjny
sklep przekazuje `X-Sales-Channel` przy składaniu zamówienia, podglądzie sumy
zamówienia, zakupie jednym kliknięciem i funkcji „zamów ponownie jako zapytanie
ofertowe”. Sklep utworzony we wcześniejszym wydaniu tego
nie robił; kroki opisuje strona *Aktualizacja instancji*.

### Co nie jest powiązane z kanałem zamówienia

- **Koszyk.** Koszyk powstaje w kanale domyślnym, niezależnie od kanału, w którym
  kupuje klient, i trzy rzeczy są ustalane dla kanału koszyka, a nie zamówienia:
  czy produkt można dodać (asortyment kanału rozpoznanego dla żądania
  *dodającego* — wyjątkiem jest opisane wyżej tworzenie zamówienia w panelu),
  ceny pozycji oraz promocje — przy składaniu zamówienia dokładnie
  tak jak w koszyku. W instancji z wieloma kanałami zamówienie może więc zostać
  zapisane w kanale, który nie sprzedaje jednego z jego produktów, w cenach kanału
  domyślnego, a promocja ograniczona do kanału innego niż domyślny nie obejmuje
  jeszcze zamówienia złożonego w tym kanale.
- **Kupujący.** Zapisanie kanału żądania nie wiąże kupującego z kanałem.
  `X-Sales-Channel` i `?salesChannel=` wysyła klient, a nic nie ogranicza kanałów,
  w których klient lub organizacja może składać zamówienia.

### Aktualizacja

**Instancja z więcej niż jednym kanałem sprzedaży.** Do tej pory zamówienie ze
sklepu, które nie przekazywało `salesChannelId` w treści żądania — czyli każde
zamówienie złożone przez referencyjny sklep — było zapisywane w kanale domyślnym,
niezależnie od tego, w którym kanale był kupujący. Nowe zamówienia składane w
sklepie kanału innego niż domyślny są teraz zapisywane w tym kanale, więc wszystko,
co wymieniono powyżej, jest odczytywane dla niego, a na liście zamówień i w
raportach pojawiają się pod tym kanałem. Istniejące zamówienia nie są zmieniane.

**Instancja z jednym kanałem sprzedaży.** Zamówienie ze sklepu docierało do
sprawdzenia minimalnej wartości zamówienia bez żadnego kanału, a ustawienie
odczytywane bez kanału zwraca wartość ogólną dla platformy. Teraz dociera z
identyfikatorem kanału domyślnego, więc minimalna wartość zamówienia ustawiona
**dla kanału domyślnego**, a nie dla wszystkich kanałów, jest egzekwowana przy
składaniu zamówienia, choć wcześniej nie była. Walidatory adapterów płatności i
dostawy również otrzymują identyfikator tego kanału, którego wcześniej nie
dostawały. Instancja, która ustawiła minimalną wartość ogólnie dla platformy albo
wcale, nie zauważy zmiany.

## Listy dozwolonych metod przy składaniu zamówienia

Organizację można ograniczyć do wybranych metod dostawy i płatności (zob. moduł `organizations`,
*Ograniczenia handlowe organizacji*). Złożenie zamówienia i oba podglądy odrzucają metodę spoza niepustej
listy odpowiedzią `400 VALIDATION_FAILED`:

| `error.details.code` | Zawiera też | Znaczenie |
| --- | --- | --- |
| `delivery_method_not_allowed_for_organization` | `deliveryMethodId` | Lista dozwolonych metod dostawy organizacji nie zawiera wybranej metody |
| `payment_method_not_allowed_for_organization` | `paymentMethodId` | Lista dozwolonych metod płatności organizacji nie zawiera wybranej metody |

- **Gdzie** — `POST /api/v1/orders`, `POST /api/v1/orders/preview-total`,
  `POST /api/v1/admin/orders`, `POST /api/v1/admin/orders/preview`,
  `POST /api/v1/external/orders` oraz każde inne wywołanie `orderPlacementPort.placeOrder`. Zakup
  jednym kliknięciem nie dochodzi do tej odmowy: gdy lista wyklucza metodę domyślną, kupujący nie
  może z niego skorzystać (`one_click_unavailable`, powód `missing_defaults`).
- **Która organizacja** — ta, dla której składane jest zamówienie: organizacja zalogowanego
  kupującego, organizacja powiązana z kluczem API albo organizacja klienta, gdy zamówienie tworzy
  administrator. Żądanie nie może wskazać innej.
- **Pusta lista nie ogranicza** — pusta lista albo jej brak dopuszcza każdą aktywną metodę, a obie
  listy są niezależne.
- **Nic nie jest zapisywane** — nie powstaje zamówienie, rezerwacja stanu ani płatność, a koszyk
  klienta pozostaje bez zmian. Tworzenie zamówienia przez administratora i przyjęcie zamówienia
  kluczem API sprawdzają listy, zanim zastąpią koszyk.
- **Administratorów też to obowiązuje** — tak zostało postanowione: zamówienie utworzone w imieniu
  klienta podlega listom dozwolonych metod organizacji tego klienta i żadne ustawienie tego nie
  wyłącza. Formularz tworzenia pokazuje wszystkie metody; dla metody, na którą organizacja nie
  pozwala, podgląd i utworzenie zamówienia zwracają powyższą odmowę.
- **Gdy obie metody są spoza list**, odmowa dotyczy metody dostawy.
- **Gdy list nie da się odczytać**, żądanie kończy się odpowiedzią `500 INTERNAL` i zamówienie nie
  powstaje — tak samo odpowiadają obie listy metod.

## Metody a kanał sprzedaży zamówienia

Metodę dostawy lub płatności można także ograniczyć do kanałów sprzedaży (zobacz moduły
`delivery_methods` i `payment_methods`, *Kanały sprzedaży*). Składanie zamówienia i oba podglądy
odrzucają metodę, która nie jest dostępna w kanale **zamówienia**, odpowiedzią
`400 VALIDATION_FAILED`:

| `error.details.code` | Zawiera też | Znaczenie |
| --- | --- | --- |
| `delivery_method_not_in_sales_channel` | `deliveryMethodId`, `salesChannelId` | Metoda dostawy jest ograniczona do kanałów sprzedaży, a kanału zamówienia wśród nich nie ma |
| `payment_method_not_in_sales_channel` | `paymentMethodId`, `salesChannelId` | Metoda płatności jest ograniczona do kanałów sprzedaży, a kanału zamówienia wśród nich nie ma |

- **Gdzie** — te same trasy co dla list dozwolonych metod powyżej. Zakup jednym kliknięciem
  również tutaj nie dociera do odmowy: domyślna metoda, której kanał żądania nie udostępnia,
  sprawia, że kupujący nie kwalifikuje się do zakupu (`one_click_unavailable`, powód
  `missing_defaults`).
- **Który kanał** — ten, który zapisuje zamówienie; zobacz *Który kanał sprzedaży zapisuje
  zamówienie* powyżej.
- **Brak przypisania oznacza każdy kanał** — metoda nieprzypisana do żadnego kanału sprzedaży
  jest dostępna we wszystkich.
- **Nic nie jest zapisywane** — tak jak przy listach dozwolonych metod, a tworzenie zamówienia w
  panelu i przyjmowanie zamówień kluczem API sprawdzają to, zanim podmienią koszyk.

### Metoda, która nie przechodzi obu sprawdzeń

Obie odmowy są niezależne, a na każdej trasie listy dozwolonych metod organizacji są sprawdzane
**przed** kanałem zamówienia. Dlatego metoda, która jest jednocześnie poza listą dozwolonych metod
organizacji **i** niedostępna w kanale zamówienia, jest odrzucana z kodem listy
(`…_not_allowed_for_organization`); kod kanału (`…_not_in_sales_channel`) zwraca metoda, której
organizacja może używać — albo która nie ma listy — a kanał jej nie udostępnia.

To, gdzie między tymi dwoma sprawdzeniami wypada „metoda jest aktywna” i walidator adaptera,
zależy od trasy:

- **Składanie zamówienia w sklepie i zakup jednym kliknięciem** (`placeOrder`) — listy, potem
  aktywność metody, potem walidator jej adaptera, potem kanał.
- **Podgląd w sklepie** — listy, potem aktywność metody, potem kanał; walidator adaptera nie jest
  uruchamiany dla podglądu.
- **Tworzenie zamówienia w panelu i przyjmowanie zamówień kluczem API** — listy i kanał są
  sprawdzane najpierw, zanim koszyk klienta zostanie zmieniony; zamówienie przechodzi następnie
  przez `placeOrder`, które powtarza je wokół sprawdzenia aktywności i adaptera. Nieaktywna
  metoda, która jest też niedostępna w kanale, zwraca więc na tych dwóch trasach kod kanału, a w
  sklepie — „metoda nieaktywna”.
- **Podgląd w panelu** — listy, potem kanał; podgląd nie odrzuca nieaktywnej metody.

## Statusy i przejścia (konfigurowalne)

Cykl życia zamówienia **konfiguruje się w panelu administracyjnym**: statusy i dozwolone przejścia
są zapisane w tabelach `order_statuses` i `order_status_transitions`, wypełnianych przy instalacji
dziewięcioma domyślnymi statusami — `new` (początkowy, nie da się go usunąć), `pending`, `paid`,
`processing`, `shipment_ready`, `shipment_sent`, `completed` (końcowy), `on_hold`, `cancelled`
(końcowy) — wraz z predefiniowanymi przejściami oraz przejściami dostępnymi z każdego statusu
`→ on_hold` / `→ cancelled` (i `on_hold → any`). Administratorzy zarządzają nimi przez endpointy
`/api/v1/admin/orders/statuses` i `/transitions`; graf jest przechowywany w pamięci procesu i
sprawdzany ponownie przy każdej zmianie.

`OrderTransitionService.apply()` to jedyne miejsce, które rozstrzyga o przejściach: odrzuca
przejście, dla którego nie skonfigurowano krawędzi, albo przejście ze statusu końcowego, uruchamia
**zabezpieczenia wstępne** z możliwością zablokowania (`onOrderTransitionGuard`), a następnie
emituje zdarzenia według szablonu (niżej). Zdarzenia płatności i wysyłki wywołują automatyczne
przejścia przez `OrderStatusRegistry` (kolumny `statusOn*` odwołują się do tych kodów statusów);
`payment_status` pozostaje polem pochodnym, drugorzędnym.

## Co wynika z przejścia: działania następcze

Anulowanie zamówienia zwalnia to, co zamówienie trzymało: jego **rezerwacje stanów magazynowych**
oraz — w przypadku zamówienia złożonego w ramach limitu kredytowego — jego **rezerwację limitu**.
Oznaczenie takiego zamówienia jako opłaconego zwalnia rezerwację limitu. Te zwolnienia to
*działania następcze* przejścia.

Działanie następcze jest zapisywane **w tej samej transakcji co status**, jako wiersz w tabeli
`order_transition_effects`, i wykonywane zaraz potem, w tym samym żądaniu. W zwykłym przypadku
stan magazynowy i limit są więc zwolnione, zanim wywołujący dostanie odpowiedź. Zmieniło się to,
co dzieje się, gdy zwolnienia nie da się dokończyć:

- **Przejście i tak jest wykonane, a wywołujący dostaje taką odpowiedź.** Każda odmowa — nieznany
  status, brak skonfigurowanej krawędzi, status końcowy, blokada zabezpieczenia wstępnego — zapada,
  zanim cokolwiek zostanie zapisane. Po zatwierdzeniu statusu nic nie zamieni odpowiedzi w błąd.
- **Zwolnienie jest ponawiane aż do skutku.** Zadanie w tle uruchamia się co minutę i próbuje
  wykonać każde zaległe działanie, na które przyszła pora, wydłużając odstęp między próbami od
  jednej minuty do jednej godziny. Nie ma stanu „porzucone”; od piątego niepowodzenia każde
  kolejne jest zapisywane w logu na poziomie `warn` wraz z identyfikatorem zamówienia, rodzajem
  zwolnienia i ostatnim błędem.
- **Nawet odpowiedź nie zamieni tego w błąd.** Jeśli po zatwierdzeniu nie uda się odczytać
  zamówienia na potrzeby treści odpowiedzi, `POST /api/v1/admin/orders/:id/status`,
  `POST /api/v1/admin/orders/:id/payment-status` i `POST /api/v1/orders/:id/cancel` odpowiadają `200`
  z `{ data: { id, businessId, status, paymentStatus }, meta: { partial: true } }`
  (`orderCommittedWritePartialResponseSchema` w `@endora-commerce/contracts`). Sprawdź
  `meta.partial`, zanim potraktujesz `data` jako całe zamówienie, i odczytaj zamówienie ponownie,
  jeśli potrzebna jest reszta.
- **Działania następcze są od siebie niezależne.** Nieudane zwolnienie limitu nie wstrzymuje
  zwolnienia stanu magazynowego — i odwrotnie.
- **Zdarzenia zmiany statusu są emitowane zawsze** po zatwierdzeniu, bez względu na to, co stało
  się ze zwolnieniami.

Powtórzenie przejścia do statusu, który zamówienie już ma, niczego nie zmienia — i jest to
bezpieczne: to, co wynika ze statusu, jest zapisane obok niego i zostanie wykonane.

### Gdy moduł `inventory` lub `credit_limits` jest wyłączony

Działanie następcze, którego moduł-właściciel jest wyłączony, **czeka**. Dopóki moduł jest
wyłączony, nic w jego danych nie jest zapisywane, oczekiwanie nie liczy się jako nieudana próba, a
zwolnienie następuje w ciągu jednego przebiegu zadania w tle (minuty) od ponownego włączenia
modułu.

- Przy wyłączonym `inventory` anulowane zamówienie zachowuje swoje rezerwacje do czasu powrotu
  modułu.
- Przy wyłączonym `credit_limits` zamówienie złożone w ramach limitu nadal można anulować albo
  oznaczyć jako opłacone; jego rezerwacja zostanie zwolniona po powrocie modułu. Złożenie nowego
  zamówienia w ramach limitu kredytowego jest przy wyłączonym module nadal odrzucane.

### Na stronie zamówienia

Strona zamówienia w panelu administracyjnym pokazuje komunikat, dopóki zamówienie ma zaległe
działania następcze: które zwolnienie, czy czeka na moduł i ile prób się nie powiodło. Odpowiedź
administracyjna z zamówieniem zawiera te same informacje w polu `pendingEffects` — obecnym tylko
wtedy, gdy coś jest zaległe, i nigdy w odpowiedziach przeznaczonych dla kupującego.

### Naprawa zamówień pozostawionych przez wcześniejszą wersję

Zanim działania następcze zaczęły być zapisywane, zwolnienie, które się nie powiodło albo zostało
odrzucone, mogło zostawić zamówienie anulowane (albo opłacone), a mimo to nadal trzymające stan
magazynowy lub limit — i nic nie mogło go już potem zwolnić. Takie zamówienia nie mają wiersza
działania następczego. Znajduje je i naprawia polecenie dla operatora. Uruchom je w katalogu
głównym instancji:

```bash
# Wypisuje, co zostałoby zwolnione. Niczego nie zapisuje.
pnpm run cli orders transition-effects-repair

# Zwalnia.
pnpm run cli orders transition-effects-repair --apply
```

W klonie repozytorium Endora Commerce to samo polecenie ma postać
`pnpm --filter backend run cli orders transition-effects-repair`, z tymi samymi opcjami.
W instancji ta postać nie robi nic: członek backendu nazywa się tam inaczej, więc pnpm wypisuje
`No projects matched the filters` i kończy się kodem `0`, nie uruchamiając polecenia.

Przebieg próbny wypisuje każde zamówienie, które nadal trzyma rezerwacje stanów magazynowych lub
aktywną rezerwację limitu, choć powinno było je zwolnić — wraz z tym, co trzyma. `--apply` zapisuje
zwolnienia tym samym mechanizmem działań następczych, od razu próbuje je wykonać i tworzy jeden
wpis audytu na stronę zamówień; to, czego nie uda się dokończyć, ponawia zadanie w tle. Ponowne
uruchomienie niczego już nie znajduje.

**Po aktualizacji uruchom raz przebieg próbny** i przeczytaj listę, zanim ją zastosujesz:
zwolnienie zmienia liczniki zarezerwowanego stanu i dostępny limit. Naprawa nigdy nie uruchamia się
sama.

**Czego przebieg próbny nie pokaże.** Wypisuje to, co według własnych wierszy zamówienia zamówienie
trzyma. Jeśli ktoś już ręcznie poprawił licznik stanu dla któregoś z tych zamówień, zamówienie
nadal jest na liście — jego rezerwacja nie jest oznaczona jako zwolniona — a zastosowanie naprawy
obniży licznik po raz drugi, więc zarezerwowane będzie mniej, niż faktycznie trzymają aktywne
zamówienia (licznik nigdy nie spada poniżej zera, co ukrywa błąd, zamiast mu zapobiec). Takie
zamówienie pomiń albo napraw tylko wskazane zamówienia; obie opcje przyjmują identyfikator
zamówienia wypisany na liście w nawiasie i można je powtarzać:

```bash
pnpm run cli orders transition-effects-repair --apply --except=<identyfikator zamówienia>
pnpm run cli orders transition-effects-repair --apply --order=<identyfikator zamówienia>
```

Jeśli `inventory` lub `credit_limits` jest wyłączony, polecenie nie może zapytać tego modułu, co
trzymają zamówienia. Informuje o tym, naprawia resztę i należy je uruchomić ponownie po włączeniu
modułu.

## Encje

`Order`, `OrderItem`, `Payment`, `OrderStatus`, `OrderStatusTransition`, `OrderTransitionEffect`,
`OrderComment`, `OrderListSavedView`, `OrderItemGroup` (grupy pozycji zamówienia — zob. *Grupy
pozycji*) oraz kolumna `organizations.order_confirmation_emails` (właściciel:
`organizations`, odczyt przez port). `OrderItem` zapisuje kopię produktu, wariantu, ceny
jednostkowej i stawki podatku z chwili złożenia zamówienia, aby historyczne zamówienia nie zmieniały
się po zmianach cen i katalogu. Kopiuje też `price_source` pozycji koszyka — `agreed`, `base`,
`catalogue`, `buyer` albo `sale`, czyli krok wyceny w cennikach (albo uzgodnienie z oferty), który
ustalił cenę — do `order_items.price_source`; kolumna jest przechowywana na potrzeby raportowania i
przyszłej reguły promocji i nie wchodzi do odpowiedzi API zamówień.

## Emitowane zdarzenia

`order.created.v1`, `order.status_changed.v1`, `order.cancelled.v1`. Anulowanie jest ogłaszane jako
`order.status_changed.v1` z nowym statusem, a po nim jako `order.cancelled.v1` — z `orderId`,
`organizationId`, `salesChannelId`, statusem, z którego zamówienie anulowano (`from`), `actor`,
`reason` i `businessId` — gdy zapis anulujący zostanie zatwierdzony, niezależnie od ścieżki, która
anulowała zamówienie. `order.cancelled.v1` pozostaje wewnątrz szyny zdarzeń: webhooki wychodzące
dostarczają anulowanie jako `order.status_changed.v1`. Każde przejście X→Y emituje
dodatkowo cztery zdarzenia **według szablonu** (budowane przez `events/order-status-events.ts`):
`order.status.from_<x>_to_<y>.before`, `order.status.from_<x>.before` (synchroniczne, z możliwością
zablokowania) oraz `order.status.from_<x>_to_<y>.after`, `order.status.to_<y>.after` (po
zatwierdzeniu, odizolowane).

`order.created.v1` niesie `orderId` i `organizationId`. Dla zamówienia, które administrator utworzył
z polem `origin` (zob. *Tworzenie w imieniu klienta* niżej), niesie także to `origin`, bez zmian;
dla każdego innego zamówienia tego klucza nie ma. Wartość trafia wszędzie tam, dokąd zdarzenie —
webhook wychodzący subskrybujący `order.created.v1` dostaje ją w treści.

`order.created.v1` jest emitowane po zatwierdzeniu transakcji składającej zamówienie, na każdej
ścieżce składania: subskrybent może odczytać zamówienie, które zdarzenie wskazuje, a nieudane
złożenie zamówienia niczego nie ogłasza.

## Operacje w panelu administracyjnym

- **Tworzenie w imieniu klienta** — `POST /api/v1/admin/orders` buduje koszyk klienta z pozycji
  wprowadzonych przez administratora i uruchamia `placeOrder` w imieniu klienta; klient dostaje
  e-mail z prośbą o opłacenie. Żądanie może nieść opcjonalne `origin: { type, id }`, mówiące, skąd
  zamówienie jest tworzone — `type` to identyfikator nadawcy pisany małymi literami (litery, cyfry,
  podkreślenia), `id` to UUID. Moduł sprawdza tylko kształt i przekazuje wartość dalej, nie czytając
  jej, w zdarzeniu `order.created.v1`: nie jest zapisywana, nie jest zwracana i niczego w zamówieniu
  nie zmienia. Moduł, który rozpoznaje `type`, może na nią zareagować — moduł CRM wiąże takie
  zamówienie z szansą, z której je utworzono. Przyjmuje je tylko to żądanie; zamówienie składane w
  sklepie nie może go ustawić. Ekran tworzenia (`/orders/new`) czyta to samo z adresu, gdy otwiera
  go inny ekran — `originType`, `originId`, do tego `organizationId`, `customerAccountId` i
  `salesChannelId` do wstępnego wyboru oraz `returnTo`, czyli ścieżkę w Admin UI, do której wraca
  się po utworzeniu zamówienia.
- **Lista** — `GET /api/v1/admin/orders` filtruje, sortuje i wyszukuje po stronie serwera, z
  licznikami dla każdego statusu; `GET …/export` zwraca CSV strumieniowo; zapisane widoki przez
  `…/list-views` — zob. *Zapisane widoki* niżej.
- **Operacje masowe** — `POST …/bulk/status` (zamówienia, które się kwalifikują, zmieniają status;
  pominięte są zgłaszane z powodem — pominięte zamówienie nie zmieniło statusu) oraz
  `…/bulk/print-invoices`.
- **Komentarze** — `…/:id/comments` dla administratora i klienta, z flagą widoczności dla klienta i
  powiadomieniem; zablokowane w zamówieniach o statusie końcowym.
  Platforma zapisuje tu też wewnętrzne **notatki systemowe** o wartościach pól niestandardowych,
  których nie przeniesiono do zamówienia — zob. *Notatka systemowa* niżej.
- **Ponowne zamówienie** — `…/:id/reorder` odtwarza koszyk (zależnie od ustawienia
  `orders.reorder_enabled`); **kopia jako zapytanie ofertowe** — `…/:id/clone-to-quote`.

### Ekran tworzenia zamówienia

**Sekcje Pozycje i podsumowanie zamówienia pojawiają się dopiero po wybraniu klienta i kanału
sprzedaży.** To dwie dane, których potrzebuje wycena; metoda płatności, metoda dostawy i adresy
niczego nie blokują. Dopóki obie nie są ustawione, jedna podpowiedź mówi, czego jeszcze brakuje.
Wyczyszczenie któregoś z tych pól znowu ukrywa obie sekcje, ale nie usuwa pozycji — wracają, gdy
pole zostanie ponownie ustawione. Ekran otwarty z `customerAccountId` i `salesChannelId` w adresie
od razu pokazuje sekcję **Pozycje**.

**Produkty dodaje się na dwa sposoby.**

- **Przeglądaj produkty** otwiera wspólną przeglądarkę produktów panelu administracyjnego na
  zakładce **Aktywne**: katalog podzielony na strony, z zakładkami statusów i ich licznikami,
  filtrem typu i wyszukiwaniem po SKU, slugu lub nazwie. Zaznaczenie przetrwa zmianę strony,
  rozmiaru strony i filtrów, a **Dodaj N** dodaje każdy zaznaczony produkt jako pozycję o ilości 1
  — najwyżej 200 naraz. Produkty nadrzędne typu grouped i bundle oraz produkty robocze i nieaktywne
  są widoczne z powodem i nie da się ich zaznaczyć. Produkt, który już jest w zamówieniu, można
  dodać ponownie: staje się osobną pozycją (na przykład w innej grupie).
- **Szybkie dodawanie po nazwie lub SKU**, obok, dopisuje jeden produkt według tych samych zasad.

Bez uprawnienia `catalog:read` obie te opcje są nieaktywne i każda pokazuje podpowiedź.

Każda pozycja pokazuje nazwę i SKU produktu, edytowalną ilość, cenę jednostkową, wartość pozycji
i akcję usunięcia. Zmiana ilości, klienta, kanału sprzedaży, metody dostawy albo metody płatności
ponownie wycenia pozycje przez `POST /api/v1/admin/orders/preview` (`orders:write`). Ilość, która
nie jest liczbą całkowitą równą 1 lub większą, oznacza pozycję, wyłącza ją z wyceny i blokuje
**Utwórz zamówienie**.

**Pozycja, której nie da się wycenić, pokazuje przyczynę i blokuje Utwórz zamówienie, dopóki
jej nie usuniesz albo nie usuniesz przyczyny.** Każda niedostępna pozycja ma dokładnie
jeden kod — pierwszy pasujący, w tej kolejności — i pokazuje jeden powód:

| Kod wyceny | Powód przy pozycji | Co zmienić |
| --- | --- | --- |
| `PRODUCT_NOT_FOUND` | *Brak ceny* | Produktu nie ma już w katalogu: usuń pozycję. |
| `PRODUCT_NOT_VISIBLE_TO_CUSTOMER` | *Klient nie widzi tego produktu* | Widoczność produktu albo jego lista dozwolonych organizacji wyklucza organizację klienta: zmień je przy produkcie w katalogu, wybierz innego klienta albo usuń pozycję. |
| `PRODUCT_NOT_IN_SALES_CHANNEL` | *Poza asortymentem tego kanału sprzedaży* | Wybierz kanał sprzedaży, którego asortyment zawiera produkt, dodaj produkt do asortymentu tego kanału albo usuń pozycję. |
| `QUOTE_ONLY` | *Brak ceny* | Cena produktu dla tego klienta jest dostępna tylko w ofercie: usuń pozycję albo utwórz zapytanie ofertowe. |
| `UNPRICED` | *Brak ceny* | Żaden cennik nie wycenia produktu dla tego klienta, kanału i waluty — nie ma nawet ceny bazowej: ustaw cenę bazową, usuń pozycję albo utwórz zapytanie ofertowe. |
| `BELOW_MINIMUM_QUANTITY` | *Poniżej minimum N szt.* | Łączna ilość produktu w zamówieniu jest poniżej jego minimalnej ilości zamówienia: zwiększ ilość albo usuń pozycję. |

`BELOW_MINIMUM_QUANTITY` niesie `minimum` i jest oceniany tylko na pozycjach, które przeszły
sprawdzenia powyżej, z sumowaniem pozycji każdego produktu. Pozycje są wyceniane z cenników dokładnie
tak, jak wyceniłby je koszyk klienta — jednym zbiorczym wywołaniem dla wszystkich pozycji, przy
ilości i wariancie każdej z nich — więc utworzone zamówienie ma ceny pokazane w podglądzie. Kod, którego ekran nie zna, też jest pokazywany jako *Brak ceny*. Pozostałe pozycje zachowują
ceny, a podsumowanie liczy tylko wycenione. Wycena sprawdza asortyment dokładnie tego kanału
sprzedaży, który wskazuje żądanie; `salesChannelId`, który nie wskazuje żadnego kanału, jest
odrzucany z `404 NOT_FOUND`, a ekran pokazuje *Nie udało się przeliczyć cen*, nie oznaczając żadnej
pozycji. Produkt usunięty miękko jest wyceniany jak dotąd. Utworzone zamówienie zawiera dokładnie
pozycje i ilości widoczne na ekranie, w treści żądania `POST /api/v1/admin/orders`.

**Najwyżej 200 pozycji.** `POST /api/v1/admin/orders` i `POST /api/v1/admin/orders/preview` w
pierwszym kroku odrzucają więcej niż 200 pozycji, z kodem `422 VALIDATION_FAILED` i `details: {
code: 'too_many_items', maximum: 200 }`, zanim oceniona zostanie którakolwiek pozycja. Tworzenie
zamówienia odrzuca też żądanie, w którym łączna ilość produktu jest poniżej jego minimum, z błędem
minimum i `details.lines[]` kluczowanym `index` pozycji.

**Grupy pozycji.** Pozycje na ekranie można podzielić na nazwane grupy — *Dodaj grupę*, zmiana
nazwy, usunięcie, przeciąganie, klawiatura i menu *Przenieś do grupy* przy każdej pozycji, dokładnie
tak jak w zakładce *Modyfikacja* zapytania ofertowego; *Dodaj produkt* danej grupy dodaje do tej
grupy, każde inne dodanie — do sekcji *Bez grupy*. Każda grupa pokazuje liczbę pozycji oraz wartość
netto, VAT i brutto obok bieżącego podsumowania cen; w tym celu wycena zwraca dla każdej wycenionej
pozycji `taxRate` (ułamek, `0.23`, z tego samego źródła co suma podatku w podsumowaniu; brak go przy
pozycji, której nie da się wycenić), a VAT grupy to suma netto × stawka po jej pozycjach.
Przeniesienie pozycji między grupami nie wycenia zamówienia ponownie. Każda grupa musi mieć nazwę,
zanim przycisk **Utwórz zamówienie** stanie się aktywny. Co zamówienie zachowuje, opisuje sekcja
*Grupy pozycji* niżej.

**Podziel pozycję.** Pozycja o ilości 2 lub większej ma obok *Przenieś do grupy* przycisk *Podziel
pozycję*. Pyta on o ilość do przeniesienia na nową pozycję (od 1 do ilości pozycji minus 1) i o grupę
nowej pozycji — domyślnie tę samą — po czym dodaje pozycję tego samego produktu z tą ilością,
zmniejszając pierwotną. Tak jeden produkt trafia do dwóch grup: na przykład 5 sztuk do *Hali A* i 3
do *Hali B*. Każda pozycja jest wyceniana według własnej ilości.

## Wartości pól niestandardowych przeniesione do zamówienia

Zamówienie może otrzymać wartości pól niestandardowych z rekordu, z którego powstało — dla każdego
pola z włączoną opcją **Przenoś wartość do: Zamówienie** (ustawianą na ekranie **Pola
niestandardowe**; reguły — ten sam klucz, zgodny typ i opcje, zasada widoczności — opisuje strona
tamtego modułu). Wypełniane jest tylko puste pole zamówienia i tylko raz.

- **Z zapytania ofertowego, przy składaniu zamówienia.** Gdy klient składa zamówienie z koszyka
  wypełnionego zamówieniem zaakceptowanego zapytania ofertowego, a zamówienie zapisuje to zapytanie
  (decydują te same reguły co dotąd: zapytanie nadal zatwierdzone, niewykorzystane przez inne
  zamówienie, z organizacji klienta, co najmniej jedna uzgodniona pozycja nadal w koszyku), wartości
  zapytania — w stanie z tej chwili — są zapisywane razem z samym zamówieniem. Są częścią jego
  utworzenia, a nie późniejszą edycją. Nic nie jest przenoszone, gdy zamówienie nie zapisuje
  zapytania ofertowego albo gdy moduł zapytań ofertowych jest wyłączony.
- **Z szansy sprzedażowej.** Zamówienie, które administrator tworzy z szansy sprzedażowej (**Utwórz
  zamówienie** na jej karcie *Powiązania*), otrzymuje wartości szansy, gdy moduł CRM powiąże je z tą
  szansą — w osobnej zmianie przypisanej **systemowi**; utworzenie zamówienia pozostaje przypisane
  administratorowi. Zamówienie powiązane z szansą ręcznie nie otrzymuje niczego.
- **Nie w drugą stronę.** **Kopia jako zapytanie ofertowe** nie przenosi żadnej wartości.
- **Nic nie kończy się błędem.** Wartość, której nie da się przenieść, jest pomijana, a zamówienie i
  tak zostaje złożone lub powiązane.

Przy zamówieniu złożonym w imieniu klienta wpis audytu `order.place_on_behalf` wymienia przeniesione
klucze jako `carriedCustomFieldKeys`. Zamówienie złożone przez samego klienta, jak dotąd, nie tworzy
wpisu audytu. Przeniesione wartości są w zamówieniu od początku, więc odczytują je subskrybenci
`order.created.v1`.

### Notatka systemowa

Gdy wartość zostanie pominięta, karta **Komentarze** zamówienia zawiera jedną notatkę autorstwa
**System** dla danego złożenia lub powiązania, oznaczoną jako *Wewnętrzny*: *Nie przeniesiono z
zapytania ofertowego …:* lub *Nie przeniesiono z szansy sprzedażowej …:*, a pod spodem po jednej
linii na każde pominięte pole — nazwa pola, z którego pochodzi, z chwili pominięcia, i powód (zamówienie nie ma pola o tym
kluczu, pole ma inny typ, pole widoczne dla klientów miałoby dostać wartość pola wewnętrznego,
wartość nie pasuje do pola). Może ją przeczytać każdy, kto może otworzyć zamówienie; nie pokazuje
żadnej wartości.

Notatka nigdy nie jest pokazywana klientowi — ani w sklepie, ani w endpoincie komentarzy klienta — i
nie wysyła powiadomień. Nie ma autora: `systemNote` w odpowiedzi z komentarzami dla administratora
(`GET /api/v1/admin/orders/:id/comments`) zawiera jej strukturę — `kind`
(`custom_field_carry_skipped`), `source` (`entityType`, `recordId`, `reference`) i `skipped`
(`key`, `reason`, `label`) — a `body` zawiera angielskie zdanie dla odbiorcy, który go nie tłumaczy.
Każdy inny komentarz zwraca `systemNote: null`.

## Filtry pól niestandardowych

Pole niestandardowe zamówienia z włączoną opcją **Używaj jako filtra listy** (ustawianą na ekranie
**Pola niestandardowe**) jest dostępne jako filtr wśród filtrów zaawansowanych listy zamówień,
opisany w twoim języku: tekst, który zawiera, zakres liczb lub dat, tak lub nie albo jedna lub
więcej opcji. Zamówienie bez wartości tego pola nigdy nie pasuje. Każdy filtr pola
niestandardowego jest pokazany jako usuwalna etykieta obok pozostałych aktywnych filtrów, zawęża
sumę i każdą stronę, a jego zmiana wraca do pierwszej strony listy. Filtry są w adresie strony,
więc przefiltrowaną listę można dodać do zakładek lub udostępnić, a **eksport CSV** eksportuje te
same zamówienia.

Jeśli adres zawiera filtr, który nie jest już dostępny — jego opcję wyłączono albo pole usunięto —
lista mówi o tym, podając nazwę pola, i oferuje **Usuń ten filtr**; eksport CSV nie jest dostępny,
dopóki filtr nie zostanie usunięty. Wywołujący API przesyłają filtry jako `customFieldFilters` w
`GET /api/v1/admin/orders` i `GET /api/v1/admin/orders/export`, a dostępne pola odczytują z
`GET /api/v1/admin/orders/custom-field-filters` (`orders:read`). Odwrócony zakres (`min` większe niż `max`, `from` późniejsze niż `to`) lub operator niepasujący do typu pola daje `400` `VALIDATION_FAILED`.

## Zapisane widoki

Zapisany widok to nazwany zestaw filtrów listy zamówień, który administrator może ponownie
zastosować jednym wyborem.

### Korzystanie z zapisanych widoków

Na pasku narzędzi listy zamówień jest lista wyboru **Zapisane widoki**, której pierwsza pozycja to
**— Wybierz widok —**, a obok niej dwa przyciski: **Zapisz widok** i **Usuń widok**.

- **Co zapamiętuje widok.** Wszystkie filtry listy zamówień — status, status płatności, kanał
  sprzedaży, metodę płatności, metodę dostawy, zakres dat, wyszukiwany tekst, nazwy organizacji i
  klienta, zakres kwoty oraz filtry pól niestandardowych — a także sortowanie i widoczne kolumny.
  Filtr pola niestandardowego, który przy wczytaniu widoku nie jest już dostępny, zostaje pominięty
  z komunikatem, który go nazywa, a reszta widoku się wczytuje. Wybranie widoku zastępuje je
  wszystkie wartościami z widoku: filtr, którego widok nie zawiera, zostaje wyczyszczony, to, co
  zmieniono i nie zapisano, przepada, a lista wraca na pierwszą stronę.
- **Zapisywanie.** **Zapisz widok** otwiera jedno okno z polem **Nazwa** i polem wyboru
  **Udostępnij wszystkim administratorom, którzy mają dostęp do tej listy**. Pole wyboru jest na
  początku odznaczone, więc nowy widok jest prywatny, dopóki go nie zaznaczysz. Nazwa jest
  wymagana, spacje na początku i na końcu są usuwane, a jej długość to najwyżej 160 znaków.
  Problemy są pokazywane przy polu i nic nie zostaje wysłane, dopóki ich nie poprawisz; odmowa
  serwera jest pokazywana w oknie, które pozostaje otwarte z wpisanymi danymi.
- **Prywatny czy udostępniony.** Widok prywatny widzisz tylko ty. Widok udostępniony widzi każdy
  administrator, który ma dostęp do listy zamówień, z dopiskiem **(udostępniony)** po nazwie. Lista
  wyboru nie pokazuje, kto zapisał udostępniony widok.
- **Jedna nazwa na administratora.** Nie możesz mieć na tej liście dwóch widoków, których nazwy
  różnią się tylko wielkością liter albo spacjami na początku lub końcu. Okno odpowiada
  **Masz już widok o tej nazwie.**, zanim cokolwiek wyśle, a serwer także odrzuca taką nazwę.
  Litery ze znakami diakrytycznymi są innymi literami: *Zamówienia* i *Zamowienia* to dwie różne
  nazwy. Nazwy używane przez innych administratorów i nazwy z listy produktów lub zapytań
  ofertowych się nie liczą. Widoki, których nazwy powtarzały się już przed wprowadzeniem tej
  zasady, pozostały bez zmian.
- **Usuwanie.** **Usuń widok** jest aktywny tylko wtedy, gdy wybrany widok jest jednym z tych,
  które możesz usunąć. Prosi o potwierdzenie i podaje nazwę widoku — **Usunąć widok „…”?** — a dla
  widoku udostępnionego dodaje, że zniknie on dla wszystkich administratorów, którzy mają dostęp do
  tej listy. Nic nie zostaje usunięte, dopóki nie naciśniesz **Usuń**.
- **Kto może usunąć lub zmienić udostępniony widok.** Jego właściciel albo **każdy administrator,
  którego rola nie jest `sales_representative`** — nie tylko rola `platform_admin`: liczy się
  także rola niestandardowa. **Takie usunięcie lub zmiana nie zostawia śladu audytu**: zapisane
  widoki nie trafiają do dziennika audytu. Weź to pod uwagę, przydzielając role, zanim zespół
  zacznie polegać na udostępnionych widokach. Opiekun handlowy może usuwać tylko własne widoki, a
  prywatnego widoku innego administratora nikt nie widzi i nikt nie może go usunąć.
- **Tylko zapis, wczytanie i usunięcie.** Panel administracyjny nie zmienia nazwy widoku, nie
  zmienia tego, czy jest udostępniony, i nie nadpisuje go bieżącymi filtrami; zamiast tego zapisz
  nowy widok i usuń stary. Liczba widoków nie jest ograniczona.

### API zapisanych widoków

| Metoda i ścieżka | Odpowiedź |
| --- | --- |
| `GET /api/v1/admin/orders/list-views` | `200` — własne widoki wywołującego oraz wszystkie widoki udostępnione, posortowane po nazwie |
| `POST /api/v1/admin/orders/list-views` | `201` — utworzony widok |
| `PATCH /api/v1/admin/orders/list-views/:id` | `200` — zmieniony widok; dowolne z `name`, `shared`, `filters`, `sort`, `visibleColumns`. Panel administracyjny go nie wywołuje. Treść, która niczego nie zmienia — pusta albo z wartościami takimi jak zapisane — niczego nie zapisuje ani nie loguje i zwraca bieżący widok |
| `DELETE /api/v1/admin/orders/list-views/:id` | `200` — `{ data: { deleted: <id> } }` |

- **Uprawnienie.** Wszystkie cztery trasy wymagają `orders:read`; nie ma osobnego kodu
  uprawnienia. Żądanie bez aktora-administratora jest odrzucane z `401 UNAUTHORIZED`.
- **Treść żądania.** `name` (po przycięciu 1–160 znaków, bez znaków sterujących ani formatujących
  Unicode), `shared` (wartość logiczna), `filters` (obiekt, najwyżej 8192 bajty jako JSON w
  UTF-8), `sort` (`{ field, dir }`, `field` najwyżej 64 znaki, `dir` to `asc` albo `desc`;
  wymagane przy tworzeniu) oraz opcjonalne `visibleColumns` (najwyżej 64 identyfikatory po
  najwyżej 64 znaki albo `null` dla kolumn domyślnych). Wszystko poza tymi granicami to
  `400 VALIDATION_FAILED`. Kształty to `createOrderSavedViewRequestSchema` i
  `updateOrderSavedViewRequestSchema` w `@endora-commerce/contracts`.
- **Dwie flagi zależne od wywołującego.** Każdy widok w odpowiedzi ma `ownedByCaller` i
  `canModify` — `true`, gdy wywołujący jest właścicielem widoku albo widok jest udostępniony, a
  wywołujący jest administratorem platformy w rozumieniu poniżej. Panel administracyjny włącza
  **Usuń widok** na podstawie `canModify`, a przed zapisem wstępnie, w miarę możliwości, sprawdza
  powtórzenie nazwy wśród wyświetlonych widoków z `ownedByCaller`. Rozstrzyga porównanie
  `lower(btrim(name))` po stronie serwera: nazwa przepuszczona przez to wstępne sprawdzenie nadal
  może zostać odrzucona z `409`.
- **Administrator platformy, na potrzeby zapisanych widoków,** to administrator, którego kontekst
  dzierżawy (tenant context) żądania ma `mode === 'all'` — każda rola poza `sales_representative`.
  Listy zamówień, produktów i zapytań ofertowych wyznaczają go tak samo, a w razie wątpliwości
  odmawiają: administrator, którego zasięgu nie da się ustalić, nie jest administratorem platformy.
- **Odmowy.** Nieistniejący widok i prywatny widok innego administratora to `404 NOT_FOUND` —
  nie da się ich odróżnić. Udostępniony widok, którego wywołujący nie jest właścicielem i którego
  nie może zmienić jako administrator platformy, to `403 FORBIDDEN`. Nazwa, której klucza
  właściciel widoku już używa na tej liście, to `409 ORDER_SAVED_VIEW_NAME_TAKEN`, *„Masz już
  zapisany widok o tej nazwie na liście zamówień. Wybierz inną nazwę.”*, w języku żądania.
- **Klucz nazwy** to nazwa przycięta i zapisana małymi literami, porównywana w PostgreSQL jako
  `lower(btrim(name))` — bez usuwania znaków diakrytycznych. Zasada wiąże **właściciela** widoku:
  administrator platformy zmieniający nazwę udostępnionego widoku kolegi dostaje odmowę, gdy kolega
  już używa tego klucza. Utworzenie widoku i zmiana klucza nazwy biorą blokadę doradczą
  (advisory lock) w zakresie transakcji, kluczowaną właścicielem, więc dwa równoczesne zapisy pod
  jedną nazwą zostawiają dokładnie jeden widok. Wiersze w `order_list_saved_views`, które już
  dzieliły klucz, pozostawiono bez zmian; zasada dotyczy tylko zapisów, a zapisana nazwa może być
  dłuższa, niż pozwala reguła zapisu.
- **Brak audytu.** Zapisane widoki to osobista konfiguracja interfejsu i nie przechodzą przez
  Command Bus. Gdy administrator zmienia lub usuwa widok, którego nie jest właścicielem, usługa
  zapisuje jeden wpis dziennika na poziomie `info`:
  `{ event: 'saved_view.updated' | 'saved_view.deleted', list: 'order_list_saved_views', viewId, ownerAdminUserId, actorAdminUserId }`.
  Ten wpis jest jedynym śladem.
- **Przechowywanie.** `order_list_saved_views` (`OrderListSavedView`) jest globalna dla platformy,
  a nie przypisana do organizacji: przechowuje wartości filtrów, nigdy wyniki listy, a każdy odczyt
  listy po zastosowaniu widoku odbywa się w zakresie osoby, która go wczytała.

## Zamówienie złożone z zaakceptowanego zapytania ofertowego

Zamówienie złożone z koszyka wypełnionego zaakceptowanym zapytaniem ofertowym zapisuje to zapytanie
w polu `sourceQuoteRequestId` (`orders.source_quote_request_id`). Moduł zapytań ofertowych kończy
zapytanie, gdy zobaczy takie zamówienie, a inne moduły odczytują to pole, aby ustalić, którym
zamówieniem stało się zapytanie.

Koszyk niesie jedynie deklarację, a przy składaniu zamówienia jest ona sprawdzana z zapytaniem
ofertowym w jego bieżącym stanie. Zamówienie zapisuje zapytanie, gdy spełnione są wszystkie cztery
warunki:

- zapytanie należy do **tej samej organizacji** co zamówienie;
- zapytanie jest nadal w statusie `Approved` — nie zostało anulowane, nie wygasło i nie jest już
  zakończone;
- **żadne inne zamówienie nie zapisało już tego zapytania** — gdy dwie osoby z jednej organizacji
  zamieniły to samo zapytanie w koszyk, zapytanie przypada pierwszemu złożonemu zamówieniu,
  a drugie jest zwykłym zamówieniem;
- w koszyku wciąż jest co najmniej jedna jego pozycja — ten sam produkt i wariant w uzgodnionej
  cenie jednostkowej.

W przeciwnym razie zamówienie i tak zostaje złożone, lecz niczego nie zapisuje; odmowa trafia do
logu i nie jest pokazywana kupującemu. Żadne żądanie nie przyjmuje tego pola: ani storefront, ani
ekran tworzenia zamówienia w panelu administracyjnym, ani zewnętrzne API zamówień nie mogą wskazać
zapytania ofertowego.

Gdy moduł zapytań ofertowych jest wyłączony, zamówienia są składane dokładnie tak jak dotąd i nie
zapisują żadnego zapytania.

## Grupy pozycji

Zamówienie może pokazywać pozycje w **nazwanych grupach** — *Hala A*, *Hala B* — z pozycjami bez
grupy pod nagłówkiem **Pozostałe pozycje**. Grupy służą wyłącznie prezentacji: nie zmieniają żadnej
ceny, ilości ani sumy. Zamówienie otrzymuje je na jeden z dwóch sposobów i **nigdy ich później nie
zmienia**: żaden ekran ani API nie edytuje grupowania złożonego zamówienia.

**Z zaakceptowanego zapytania ofertowego.** Gdy przy składaniu zamówienia zostaje zapisane zapytanie
ofertowe, z którego pochodzi koszyk (zob. poprzednią sekcję), zamówienie kopiuje grupy oferty w tej
samej transakcji. Każda pozycja zamówienia jest dopasowywana do pozycji oferty: najpierw wszystkie
pozycje z **tym samym produktem, wariantem, uzgodnioną ilością i uzgodnioną ceną jednostkową**, potem
według produktu, wariantu i ceny, potem według produktu, wariantu i ilości, a na końcu wyłącznie
według **produktu i wariantu**, przy czym każda pozycja oferty jest użyta raz. Dzięki temu produkt
rozdzielony w ofercie na dwie grupy — 5 sztuk w jednej, 3 w drugiej, po tej samej cenie — zachowuje
każdą pozycję w jej grupie. Dopasowana
pozycja przejmuje grupę i miejsce pozycji oferty; pozycja, która do niczego nie pasuje — dodana do
koszyka po zamianie albo zmieniona tak, że już nie pasuje — trafia do sekcji *Pozostałe pozycje*, za
dopasowanymi. Grupa oferty, do której nie trafiła żadna pozycja, nie jest kopiowana. Gdy przy
składaniu zamówienia zapytanie nie zostaje zapisane albo moduł zapytań ofertowych jest wyłączony,
zamówienie jest składane bez grup, a poza tym dokładnie tak jak wcześniej. Późniejsza zmiana oferty
nie rusza grup zamówienia.

**Z ekranu tworzenia zamówienia.** Operator układa pozycje w grupy przed utworzeniem zamówienia (zob.
*Ekran tworzenia zamówienia*); zamówienie powstaje z nimi w tej samej transakcji, a odrzucone
utworzenie nie zapisuje żadnej grupy. Grupy bez pozycji nie są tworzone. **Jeden produkt może być w
kilku pozycjach** — w dwóch różnych grupach albo dwa razy w jednej: każda pozycja żądania staje się
osobną pozycją zamówienia, we własnej grupie, wycenioną według własnej ilości (minimalna ilość
zamówienia produktu jest nadal oceniana na sumie jego pozycji). `POST /api/v1/admin/orders` przyjmuje opcjonalną listę `groups` (`{ key, name }`, w
kolejności wyświetlania, najwyżej 50, nazwy od 1 do 120 znaków) i dla każdej pozycji opcjonalny
`groupKey`. Grupowanie jest utrwalane we wpisie audytu `order.place_on_behalf` (nazwa i liczba
pozycji każdej grupy); własne złożenie zamówienia przez kupującego, jak dotąd, nie trafia do audytu.

**Gdzie są pokazywane.** Ekran zamówienia w panelu administracyjnym i strona zamówienia kupującego
pokazują każdą grupę jako sekcję z nagłówkiem, pozycjami i podsumowaniem — liczba pozycji, netto,
VAT i brutto, sumujące wiersze nad nim — a następnie *Pozostałe pozycje*. Zamówienie bez grup i
każde zamówienie złożone, zanim powstały grupy, wygląda dokładnie tak jak wcześniej. Każda odpowiedź
z zamówieniem — dla administratora, klienta i zewnętrznego API zamówień — zawiera `itemGroups`
(`{ id, name, position }`) oraz dla każdej pozycji `groupId` i `position`, z pozycjami w kolejności
wyświetlania; integracja, która je pomija, działa dalej.

**Co nie przenosi grup.** Faktury, zwroty, ponowne zamówienie (wypełnia koszyk), *zamów ponownie
jako zapytanie ofertowe*, koszyk i checkout, e-maile, webhooki i przyjmowanie zamówień przez
zewnętrzne API. Nie ma PDF zamówienia.

## Minimalne ilości zamówienia przy składaniu zamówienia

Składanie zamówienia stosuje minimalne ilości zamówienia z katalogu do każdej pozycji koszyka —
minimum produktu w sztukach i minimum każdej jednostki opakowania w jednostkach, liczone ze
wszystkich pozycji produktu (oba definiuje strona modułu Catalog). To ostatnie słowo na każdej
ścieżce, która kończy się zamówieniem: checkout, zakup jednym kliknięciem, ponowne zamówienie,
koszyk wypełniony z zapytania ofertowego, tworzenie zamówienia w panelu administracyjnym i
zewnętrzne API zamówień.

- **Przed jakimkolwiek skutkiem ubocznym.** Sprawdzenie działa w transakcji składania zamówienia
  zaraz po odczytaniu koszyka — przed sprawdzeniem wartości zamówienia i limitu kredytowego,
  numerem zamówienia oraz jakąkolwiek rezerwacją stanu lub kredytu. Odmowa niczego nie zapisuje.
- **Co odpowiada.** Pozycja, której rekord produktu zniknął → `404 PRODUCT_NOT_FOUND` z
  `details.cartItemIds`. Pozycja poniżej minimum → `422 PRODUCT_BELOW_MINIMUM_QUANTITY` albo
  `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` z `details.lines[]`, po jednym wpisie na każdą
  odrzuconą pozycję (`cartItemId`, `productId`, `productName`, `kind`, `minimum`,
  `packagingUnitName`). Zdanie i nazwy produktów są w języku, w którym udzielana jest odpowiedź:
  zapisanym języku administratora, w przeciwnym razie w języku z nagłówka `Accept-Language` żądania
  (z uwzględnieniem wag q), a w ostateczności w domyślnym języku kanału.
- **Podgląd checkoutu mówi to samo wcześniej.** `POST /api/v1/orders/preview-total` zwraca
  `belowMinimumLines[]` — pozycje, które składanie zamówienia by odrzuciło, z tymi samymi
  zwolnieniami; pozycja, której produkt zniknął, ma `kind: 'product_unavailable'` i nie ma nazwy
  ani minimum. Storefront je wymienia i wyłącza **Place order**. Podgląd nie zakłada blokady, więc
  przy wyścigu rozstrzyga składanie zamówienia.
- **Koszyk wypełniony z zaakceptowanego zapytania ofertowego.** Moduł Carts zwalnia każdą pozycję
  wypełnioną z zapytania, dopóki jej ilość równa się ilości z zapytania. Składanie zamówienia i
  podgląd honorują to zwolnienie **tylko wtedy, gdy zapytanie ofertowe jest w tej chwili nadal
  ważne**: istnieje, należy do organizacji kupującego, ma nadal status `Approved` — nie jest
  anulowane ani wygasłe, a jego ważność się nie skończyła — żadne zamówienie go jeszcze nie
  zapisuje, a koszyk wciąż zawiera co najmniej jedną jego pozycję w uzgodnionej cenie. W przeciwnym
  razie każda pozycja jest oceniana jak każda inna. Sprawdzenie i jego blokada działają na początku
  składania zamówienia, więc o zwolnieniu decyduje się, zanim cokolwiek zostanie zapisane. Gdy moduł
  Quote Requests jest wyłączony, nic nie może potwierdzić zapytania i żadna pozycja nie jest
  zwolniona.
  Sprawdzenie podglądu jest też udostępnione jako `orderQuoteSourcePort`, o które pyta moduł Carts
  przy przekazaniu koszyka do akceptacji, więc przekazanie ocenia pozycję wypełnioną z zapytania
  tak jak podgląd; składanie zamówienia potwierdza zapytanie ponownie.
- **Zewnętrzne API zamówień** (`POST /api/v1/external/orders`) i tworzenie zamówienia w panelu
  budują koszyk z żądania i oceniają łączną ilość każdego produktu ze wszystkich pozycji żądania;
  żądanie poniżej minimum jest odrzucane w całości, z `details.lines[]` kluczowanym `index`. Żądanie
  jest oceniane samodzielnie — zastępowany koszyk nie liczy się do niczego — i odrzucane, **zanim**
  koszyk klienta zostanie naruszony, więc odrzucone żądanie zostawia ten koszyk dokładnie takim,
  jakim był. To samo dotyczy pozycji bez ceny albo sprzedawanej wyłącznie na zapytanie: jest
  wyceniana, zanim koszyk zostanie zastąpiony. Żadne
  z nich nie przenosi jednostki opakowania, więc działa tam tylko minimum w sztukach. **Oba
  odrzucają więcej niż 200 pozycji** z kodem `422 VALIDATION_FAILED`,
  `details.code = 'too_many_items'` — w zewnętrznym API jest to sprawdzane jako pierwsze, zanim
  wymagany będzie nagłówek `Idempotency-Key`, i nie zostawia żadnego rekordu idempotencji.

## Podleganie zwrotowi w chwili zakupu

Każda pozycja zamówienia zapisuje, czy jej produkt podlegał zwrotowi w chwili złożenia zamówienia
(`order_items.returnable_at_purchase`), na każdej ścieżce składania zamówienia. Późniejsze zmiany
flagi **Podlega zwrotowi** produktu jej nie zmieniają. Pozycja, której rekordu produktu albo flagi
nie dało się odczytać przy składaniu zamówienia, jest zapisywana jako **niepodlegająca zwrotowi**,
nigdy pusta. Pozycje zamówień złożonych przed powstaniem tej kolumny mają `null`, co moduł Returns
traktuje jako podleganie zwrotowi. Wartość trafia do modułu Returns przez `OrderReturnContextPort`
(`returnableAtPurchase` na każdej pozycji); Returns nie odczytuje żadnej tabeli modułu Orders.
Składanie zamówienia zapisuje ją niezależnie od tego, czy moduł Returns jest włączony.

Migracja `20261016T082022_orders_order_item_returnable_at_purchase.ts` dodaje tę kolumnę
(dopuszcza `null`).

## Ustawienia

`orders.min_order_value` (liczba; dotyczy checkoutu i tworzenia zamówień w panelu),
`orders.reorder_enabled` (wartość logiczna), `orders.confirmation_recipients` (lista stringów) —
wszystkie globalnie albo dla kanału sprzedaży. Do tego `order_confirmation_emails` dla każdej
organizacji. E-mail z potwierdzeniem trafia do klienta, a w kopii do listy organizacji i listy z
ustawień (bez gwarancji doręczenia, nigdy nie blokuje składania zamówienia).

## E-mail z potwierdzeniem zamówienia

Po udanym checkoucie `OrderService.placeOrder` wysyła e-mail z potwierdzeniem (po zatwierdzeniu
transakcji, bez gwarancji doręczenia — błąd poczty nigdy nie wycofuje złożonego zamówienia).
Wiadomość budowana przez `email-templates/order-confirmation.ts` zawiera zamówione produkty z
kwotami, metodę dostawy i jej koszt, metodę płatności z ewentualną dopłatą (np. `+5.00 PLN` przy
pobraniu), zastosowane rabaty, podsumowanie wartości zamówienia oraz adresy dostawy i do faktury.
Wiersz płatności jest generowany przez rejestr szablonów e-mail płatności
(`payments/services/payment-email-renderer.ts`) — klucz `renderers.email` adaptera zastępuje domyślny
szablon platformy.

## Punkty rozszerzenia

- **Adaptery płatności** — zobacz moduł `payment_methods`. `placeOrder` rozpoczyna płatność przez
  `PaymentAdapterRegistry`; nowe metody rejestrują adapter zamiast zmieniać usługę zamówień.
- **Zakres dostępu** — `order-access-service.ts` to jedyne miejsce egzekwujące regułę dostępu dla
  zwykłego użytkownika, administratora organizacji i administratora platformy; nowe rodzaje
  użytkowników dodaje się właśnie tam.
- **Panele na ekranie zamówienia** — strefa panelu administracyjnego `order.detail.after` jest
  osadzona raz, na końcu ekranu zamówienia, pod jego zakładkami, i przekazuje wkładowi
  `{ orderId }`. Moduł dodaje panel, deklarując `zoneComponent('order.detail.after', …)` we
  własnych wkładach do panelu administracyjnego; ten moduł nie wymienia żadnego z nich. Gdy nikt
  nic nie wnosi — nie ma takiego modułu, moduł jest wyłączony albo osoba nie ma uprawnienia
  wymaganego przez panel — strefa nie renderuje niczego, a ekran jest dokładnie taki jak bez niej.

## Wyszukiwanie globalne

Wyszukiwanie globalne w panelu administracyjnym (paleta poleceń, ⌘K / Ctrl+K) znajduje zamówienia. Ten moduł udostępnia poniższe pola; to, które z nich są używane, wybiera się na ekranie konfiguracji wyszukiwania globalnego.

| Pole | Przeszukiwane domyślnie |
| --- | --- |
| Numer zamówienia | tak |
| Nazwa organizacji | tak |
| Imię i nazwisko lub e-mail klienta | tak |
| Nazwa firmy do faktury | nie |
| NIP do faktury | nie |

Wynik pokazuje numer zamówienia, organizację, datę złożenia, wartość i status, a jego wybranie otwiera zamówienie. Dokładnie pasujący numer zamówienia jest pokazywany jako pierwszy. Zamówienia pojawiają się dla roli z uprawnieniem `orders:read`, a przedstawiciel handlowy widzi tylko zamówienia przypisanych mu organizacji — te same, które pokazuje mu lista zamówień.
