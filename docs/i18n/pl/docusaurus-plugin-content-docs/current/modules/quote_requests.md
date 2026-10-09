---
title: quote_requests
description: Cykl życia zapytania ofertowego (RFQ) — szkic → oferta → akceptacja lub odrzucenie
---

# `quote_requests`

Moduł zapytań ofertowych (Quote Requests) realizuje pętlę negocjacji B2B. Klient (albo opiekun
handlowy w jego imieniu) tworzy szkic zapytania ofertowego, druga strona je przegląda, każda ze
stron może zapytanie zmienić i zażądać jego ponownej, wyraźnej akceptacji, a zatwierdzone zapytanie
można zamienić w zamówienie przez standardowy proces zamówienia (checkout). Każde przejście jest
zapisywane w dzienniku zdarzeń, do którego można tylko dopisywać, więc strona szczegółów po stronie
klienta i ta w panelu administracyjnym pokazują tę samą historię w kolejności chronologicznej.

## Statusy

Sześć wartości, które zastąpiły zestaw z wczesnej wersji platformy:

- `Created from admin` — utworzone przez opiekuna handlowego lub administratora, czeka na akceptację
  klienta.
- `Pending` — wysłane przez klienta, czeka na odpowiedź strony wewnętrznej.
- `Approved` — zatwierdzone przez odpowiedzialną stronę.
- `Completed` — na podstawie tego zapytania złożono zamówienie.
- `Canceled` — odrzucone przez którąkolwiek ze stron (z opcjonalnym powodem).
- `Expired` — automatycznie przestawione przez worker wygasania po upływie skonfigurowanego czasu.

`Canceled`, `Completed` i `Expired` są statusami końcowymi.

## Publiczne API

Endpointy klienta wymagają sesji klienta; endpointy administracyjne są chronione uprawnieniem
`rfqs:handle`. Endpointy wykonujące zmiany (typu PATCH) przyjmują wersję w nagłówku `If-Match` na
potrzeby optymistycznej kontroli współbieżności, a akceptacja i odrzucenie wersji przez klienta
dodatkowo wymagają podania `expectedRevisionNumber`.

| Metoda + ścieżka | Odbiorca | Cel |
| --- | --- | --- |
| `GET /api/v1/quote-requests` | klient | Lista widocznych zapytań ofertowych (rola org-admin rozszerza widoczność na całą organizację). |
| `GET /api/v1/quote-requests/:id` | klient | Szczegóły, z opcjonalnym blokiem `comparisonAgainstLastSeen`, gdy zapytanie czeka na akceptację. |
| `POST /api/v1/quote-requests` | klient | Utworzenie i wysłanie w jednym wywołaniu. |
| `PATCH /api/v1/quote-requests/:id` | klient | Edycja zapytania w statusie Pending, którego strona wewnętrzna jeszcze nie ruszyła. |
| `POST /api/v1/quote-requests/:id/accept-revision` | klient | Akceptacja najnowszej wersji przygotowanej przez sprzedawcę (dotyczy też `Created from admin`). Wymaga oferty sprzedawcy z wyceną każdej pozycji — zob. *Uzgodnione ceny*. |
| `POST /api/v1/quote-requests/:id/reject-revision` | klient | Odrzucenie najnowszej wersji z opcjonalnym powodem. |
| `POST /api/v1/quote-requests/:id/resubmit` | klient | Skopiowanie starego zapytania do nowego, w statusie Pending, według bieżącego cennika klienta. |
| `POST /api/v1/quote-requests/:id/convert-to-order` | klient | Wypełnienie koszyka klienta pozycjami zapytania w statusie Approved po uzgodnionych cenach jednostkowych i zwrócenie adresu procesu zamówienia. |
| `GET /api/v1/admin/quote-requests` | administrator | Lista zawężona do przypisań opiekuna handlowego, z filtrami według statusu i organizacji. |
| `GET /api/v1/admin/quote-requests/:id` | administrator | Szczegóły z pełną tożsamością wykonawców w dzienniku zdarzeń. |
| `POST /api/v1/admin/quote-requests` | administrator | Utworzenie w imieniu klienta → status `Created from admin`. |
| `PATCH /api/v1/admin/quote-requests/:id` | administrator | Zmiana zapytania w statusie Pending lub Created from admin → wymaga ponownej akceptacji klienta. |
| `POST /api/v1/admin/quote-requests/:id/approve` | administrator | Zatwierdzenie zapytania w statusie Pending, którego każda pozycja ma uzgodnioną cenę jednostkową. |
| `POST /api/v1/admin/quote-requests/:id/cancel` | administrator | Anulowanie z opcjonalnym powodem. |
| `POST /api/v1/admin/quote-requests/:id/assign` | administrator | Ustawienie `assignedAdminUserId` (wyłącznie informacyjne). |
| `GET /api/v1/admin/sales-reps/:adminUserId/organizations` | administrator | Widok odwrotny — organizacje, za które odpowiada opiekun, z liczbą otwartych zapytań w każdej z nich. |
| `GET /api/v1/storefront/settings/quote-requests` | publiczny | Zwraca dwie flagi widoczności w storefroncie. |

Trzy endpointy przypisujące opiekuna handlowego *do* organizacji — `GET`, `POST` i `DELETE` pod
`/api/v1/admin/organizations/:id/sales-reps` — należą do modułu **organizations** i są chronione
uprawnieniem `organizations:assign-sales-rep`, a nie `rfqs:handle`. Kiedyś były rejestrowane tutaj,
a ten podział nie jest kosmetyczny: przypisanie opiekuna opisuje organizację, więc musi działać
także wtedy, gdy moduł zapytań ofertowych jest wyłączony, i nie może być chronione kodem uprawnienia
modułu, który może zniknąć. Jedyny pozostały wyżej endpoint odczytuje zapytania ofertowe i jest
chroniony przez `rfqs:handle` właśnie po to, by znikał razem z tym modułem.

## Uzgodnione ceny

Zapytanie ofertowe staje się zamówieniem wyłącznie po cenach jednostkowych uzgodnionych przez
sprzedawcę. Uzgodnioną cenę jednostkową pozycji ustawia operator — zmieniając zapytanie
(`PATCH /api/v1/admin/quote-requests/:id`) albo tworząc je w imieniu klienta — a do tego czasu
pozostaje ona pusta. Pusta uzgodniona cena nigdy nie jest odczytywana jako liczba: nic nie zastępuje
jej zerem, ceną oczekiwaną przez klienta ani ceną z cennika.

Zależą od niej trzy operacje, a każda odpowiada `409`, gdy reguła nie jest spełniona:

| Operacja | Odmowa, gdy | Kod |
| --- | --- | --- |
| `accept-revision` | Sprzedawca nie złożył oferty, którą można zaakceptować: zapytanie nie ma statusu `Created from admin` i nie czeka na akceptację przez klienta wersji przygotowanej przez sprzedawcę. | `RFQ_NOT_QUOTED` |
| `accept-revision` | Oferta sprzedawcy pozostawia pozycję bez uzgodnionej ceny jednostkowej. | `QUOTE_INCOMPLETE` |
| `approve` (administrator) | Którakolwiek pozycja nie ma uzgodnionej ceny jednostkowej. | `QUOTE_INCOMPLETE` |
| `convert-to-order` | Którakolwiek pozycja nie ma uzgodnionej ceny jednostkowej. | `QUOTE_INCOMPLETE` |

W praktyce oznacza to, że:

- Operator, który chce zatwierdzić zapytanie w postaci złożonej przez klienta, najpierw wycenia
  każdą pozycję, a dopiero potem zatwierdza. Nie ma skrótu „zatwierdź po cenie z cennika”.
- Reguły dotyczą **braku** ceny. Uzgodniona cena jednostkowa równa dokładnie `0`, wpisana przez
  operatora — pozycja z bezpłatną próbką — jest uzgodnioną ceną jak każda inna, a takie zapytanie
  można zaakceptować, zatwierdzić i zamówić.
- `reject-revision` pozostaje bez zmian: klient nadal może wycofać zapytanie, na które sprzedawca
  jeszcze nie odpowiedział.
- Zapytania, które otrzymało status `Approved` z niewycenioną pozycją, zanim te reguły zaczęły
  obowiązywać, nie da się zamienić na zamówienie. Jego pozycji nie można już edytować, więc
  rozwiązaniem jest `resubmit`, które tworzy nowe zapytanie do wyceny przez sprzedawcę.

## Model widoczności

Opiekun handlowy to administrator platformy z rolą `sales_representative`. Regułę widoczności
skupia w jednym miejscu predykat
`SalesRepAssignmentService.canSeeOrganization(adminUserId, organizationId)`:

1. Rola `platform_admin` → widzi każdą organizację.
2. W przeciwnym razie administrator widzi organizację wtedy i tylko wtedy, gdy łączy ich wiersz w
   `organization_sales_rep_assignments` LUB organizacja nie ma w tej tabeli żadnych wierszy
   (reguła zastępcza dla organizacji bez opiekuna — taką organizację widzi każdy opiekun handlowy).

Klient z rolą `org_admin` we własnej organizacji widzi każde zapytanie ofertowe tej organizacji, a
nie tylko własne.

## Ustawienia

Modułem sterują trzy ustawienia — wszystkie w grupie `quote_requests`, konfigurowane przez
istniejący moduł ustawień.

| Kod | Typ | Wartość domyślna | Działanie |
| --- | --- | --- | --- |
| `quote_requests.expiry_days` | integer | `0` | Automatyczne wygaszanie zapytań w statusie Pending lub Created from admin po N dniach. `0` wyłącza wygaszanie. |
| `quote_requests.show_add_to_quote_on_card` | boolean | `true` | Pokazuje lub ukrywa przycisk „Add to quote” na kartach produktów w storefroncie. |
| `quote_requests.show_add_to_quote_on_pdp` | boolean | `true` | Pokazuje lub ukrywa przycisk „Add to quote” na stronach produktów. |

## Zadania w tle

`RfqExpiryWorker.sweep()` jest uruchamiany co 30 minut przez podstawowy harmonogram BullMQ. Odczytuje
`quote_requests.expiry_days` z migawki ustawień; gdy wartość wynosi 0, nic nie robi. W przeciwnym
razie przestawia na `Expired` każdy wiersz w statusie Pending lub Created from admin, dla którego
`updated_at < now() - INTERVAL <expiryDays> days`, zapisuje dla każdego z nich jedno zdarzenie
`expired` i wysyła powiadomienia obu stronom.

## Model danych

Trzy tabele uzupełniające podstawowe `quote_requests` i `quote_request_items`:

- `quote_request_revisions` — pełna migawka przy każdej zmianie.
- `quote_request_events` — historia, do której można tylko dopisywać (jeden wiersz na każde
  przejście stanu lub zmianę, z ładunkiem w postaci unii dyskryminowanej).
- `quote_request_notification_events` — jeden wiersz na parę odbiorca × kanał; unikalność na
  `(quote_request_id, source_event_id, recipient*, channel)` sprawia, że ponowienia są
  idempotentne.

`organization_sales_rep_assignments` — relacja wiele-do-wielu między organizacjami a
administratorami, z której korzysta opisany wyżej model widoczności — **nie** należy do tych tabel:
jej właścicielem jest moduł `organizations`, dla którego opisuje ona organizację, a moduł zapytań
ofertowych sięga po nią przez port `organizationSalesRepScopePort` modułu `organizations`.

Główny wiersz `quote_requests` przechowuje bieżący stan oraz `current_revision_number`,
`last_customer_seen_revision_number` i `awaiting_customer_revision_acceptance`. Zestawienie dla
klienta „co się zmieniło od ostatniej wizyty” jest liczone przy odczycie przez porównanie wersji
wskazywanej przez `last_customer_seen_revision_number` z wersją wskazywaną przez
`current_revision_number`.

### `sales_channel_id` dopuszcza null i tak pozostanie

Każde zapytanie zapisuje kanał sprzedaży, w którym powstało, ustalony na podstawie kanału żądania.
Kolumna dopuszcza wartość null i tak już zostanie.

Dodano ją jako dopuszczającą null celowo: wdrożenie, które ją wprowadziło, nie mogło zakładać, że
mechanizm ustalający domyślny kanał przy starcie już zadziałał — to zwykły schemat etapowy: dodaj
kolumnę dopuszczającą null, zacznij ją zapisywać, uzupełnij stare wiersze, zmień na `NOT NULL`.
Środkowego kroku nie da się tu wykonać. Między migracją, która dodała kolumnę, a zmianą, która
zaczęła ją wypełniać, nic do niej nie zapisywało, więc każde zapytanie z tego okresu ma `null`, a
żaden zapis nie mówi, z którego kanału pochodziło. Przypisanie tym wierszom domyślnego kanału
systemowego nie odtworzyłoby pochodzenia, tylko by je zmyśliło — a zabezpieczenie przed usuwaniem
kanału sprzedaży zaczęłoby odmawiać usunięcia na podstawie dowodu wymyślonego przez platformę.

Wdrożenie, które naprawdę potrzebuje kolumny bez wartości null, usuwa wiersze z wartością null albo
uzupełnia każdy wiersz ze źródła, które zna odpowiedź. Nie ma skryptu uzupełniającego i celowo nigdy
nie będzie.

## Powiadomienia

Każde przejście stanu jest rozsyłane przez `RfqNotificationService` do właściwych odbiorców (do
klienta przy działaniach administratora, do opiekunów handlowych i administratorów platformy przy
działaniach klienta, do obu stron przy wygaśnięciu). Wysyłane są powiadomienia w obu kanałach —
e-mail i na koncie klienta. Ograniczenie unikalności w `quote_request_notification_events` gwarantuje
jednokrotne dostarczenie dla każdej trójki (przejście, odbiorca, kanał).

## Zamiana na zamówienie

`POST /api/v1/quote-requests/:id/convert-to-order` wypełnia koszyk klienta pozycjami zapytania
ofertowego w statusie `Approved`, w uzgodnionych cenach jednostkowych, i oznacza koszyk zapytaniem,
z którego został wypełniony. Zamówienie złożone z tego koszyka zapisuje je
(`source_quote_request_id`) — o ile zapytanie jest nadal w statusie `Approved`, a w koszyku wciąż
jest co najmniej jedna pozycja w uzgodnionej cenie; strona modułu zamówień opisuje, kiedy
oznaczenie przepada.

Gdy powstaje zamówienie z wypełnionym `source_quote_request_id`, subskrybent wewnątrz modułu
przestawia źródłowe zapytanie ofertowe na `Completed`, wypełnia `converted_order_id` i wysyła
powiadomienie `completed`. Zakończonego zapytania ofertowego nie można zamówić po raz drugi,
a konwersja jest odrzucana, dopóki którakolwiek pozycja nie ma uzgodnionej ceny jednostkowej
(zob. *Uzgodnione ceny*).
Subskrybent czeka, aż zamówienie zostanie zatwierdzone w bazie — najwyżej nieco ponad dwie
sekundy — i niczego nie kończy dla zamówienia innej organizacji.

Gdy ten moduł jest wyłączony, wypełniony wcześniej koszyk nadal można zamówić, w uzgodnionych
cenach, jako zwykłe zamówienie: nie zapisuje ono zapytania ofertowego, a zapytanie nie zostaje
zakończone.

## Utworzone przez administratora: zdarzenie i jego pochodzenie

Zapytanie ofertowe, które administrator tworzy przez `POST /api/v1/admin/quote-requests`, jest
ogłaszane na wewnętrznej szynie zdarzeń jako `rfq.created_by_admin.v1` — raz, po zapisaniu jego
wierszy:

| Pole | Znaczenie |
| --- | --- |
| `rfqId` | Nowe zapytanie ofertowe. |
| `organizationId` | Organizacja, dla której je utworzono. |
| `adminUserId` | Administrator, który je utworzył. |
| `origin` | To, co żądanie utworzenia niosło jako `origin`, albo `null`. |

`rfq.created.v1` pozostaje zdarzeniem zapytania przesłanego przez samego klienta i na tej ścieżce
**nie** jest emitowane, więc nic, co go nasłuchuje, nie zaczyna widzieć zapytań przygotowanych przez
administratora.

Żądanie utworzenia może nieść opcjonalne `origin: { type, id }`, mówiące, skąd zapytanie jest
tworzone — `type` to identyfikator nadawcy pisany małymi literami (litery, cyfry, podkreślenia),
`id` to UUID. Moduł sprawdza tylko kształt i przekazuje wartość dalej, nie czytając jej, razem ze
zdarzeniem: nie jest zapisywana, nie jest zwracana i niczego w zapytaniu nie zmienia. Moduł, który
rozpoznaje `type`, może na nią zareagować — moduł CRM wiąże takie zapytanie z szansą, z której je
utworzono. Endpoint klienta takiego pola nie przyjmuje.

Ekran tworzenia (`/quote-requests/new`) czyta to samo z adresu, gdy otwiera go inny ekran:
`originType` i `originId`, `organizationId` i `customerAccountId` do wstępnego wyboru klienta oraz
`returnTo`, czyli ścieżkę w Admin UI, do której wraca się po utworzeniu zapytania.

## Zdarzenia oferowane webhookom wychodzącym

Moduł wnosi dwa typy zdarzeń do rejestru `webhookEventRegistry` modułu `webhooks`, więc
subskrypcja webhooka może je wskazać, dopóki oba moduły są włączone. Treść zdarzenia jest wysyłana
w całości; ścisłe schematy to `QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS` w `@endora-commerce/contracts`.

| Zdarzenie | Kiedy jest wysyłane | Treść, poza `eventId` i `occurredAt` |
| --- | --- | --- |
| `rfq.created.v1` | Klient składa zapytanie ofertowe. Zapytanie utworzone przez administratora to `rfq.created_by_admin.v1`, którego webhookom się nie oferuje. | `rfqId` (UUID), `organizationId` (UUID) |
| `rfq.expired.v1` | Zadanie wygaszania przenosi zapytanie ofertowe do statusu `Expired`. Jedno zdarzenie na zapytanie. | `rfqId`, `organizationId` |

- **Treść nie opuszcza instancji.** Zdarzenia niosą dwa identyfikatory i nic z samego zapytania:
  żadnej pozycji, ilości, ceny, notatki, klienta ani administratora. Odbiorca odczytuje zapytanie
  ofertowe przez API z własnymi uprawnieniami.
- **Dane jednej organizacji.** Subskrypcja obejmująca całą platformę dostaje zdarzenia wszystkich
  organizacji. Subskrypcja powiązana z organizacją dostaje tylko zdarzenia, których
  `organizationId` wskazuje tę organizację — nigdy innej.
- **Po zapisie.** `rfq.created.v1` jest wysyłane po zapisaniu zapytania, jego pozycji i historii;
  odrzucone zgłoszenie nie wysyła niczego. `rfq.expired.v1` jest wysyłane po zapisaniu zmiany
  statusu.
- **Gdy moduł jest wyłączony**, żaden z tych typów nie jest oferowany, a nowa subskrypcja na nie
  jest odrzucana; zapisane subskrypcje zostają i nic nie dostają, dopóki moduł nie zostanie
  włączony ponownie.

Żadne inne zdarzenie zapytań ofertowych nie jest dostarczane do webhooków: zatwierdzenie, zmiana,
anulowanie i zamiana na zamówienie są ogłaszane wyłącznie na działającej w procesie szynie zdarzeń.

## Panele na ekranie zapytania ofertowego

Strefa panelu administracyjnego `quote_request.detail.after` jest osadzona raz, na końcu ekranu
zapytania ofertowego, pod kartą z jego zakładkami, i przekazuje wkładowi `{ quoteRequestId }`.
Moduł dodaje panel, deklarując `zoneComponent('quote_request.detail.after', …)` we własnych
wkładach do panelu administracyjnego; ten moduł nie wymienia żadnego z nich i żadnego nie
importuje. Gdy nikt nic nie wnosi — nie ma takiego modułu, moduł jest wyłączony albo osoba nie ma
uprawnienia wymaganego przez panel — strefa nie renderuje niczego, a ekran jest dokładnie taki jak
bez niej. Moduł CRM wnosi szansę, z którą zapytanie ofertowe jest powiązane.
