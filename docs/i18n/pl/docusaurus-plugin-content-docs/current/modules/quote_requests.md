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
| `PATCH /api/v1/quote-requests/:id` | klient | Edycja zapytania w statusie Pending, którego strona wewnętrzna jeszcze nie zmieniła — zob. *Edycja szkicu przez klienta*. |
| `POST /api/v1/quote-requests/:id/accept-revision` | klient | Akceptacja najnowszej wersji przygotowanej przez sprzedawcę (dotyczy też `Created from admin`). Wymaga oferty sprzedawcy z wyceną każdej pozycji — zob. *Uzgodnione ceny*. |
| `POST /api/v1/quote-requests/:id/reject-revision` | klient | Odrzucenie najnowszej wersji z opcjonalnym powodem. |
| `POST /api/v1/quote-requests/:id/resubmit` | klient | Skopiowanie starego zapytania do nowego, w statusie Pending, według bieżących cen klienta. |
| `POST /api/v1/quote-requests/:id/convert-to-order` | klient | Wypełnienie koszyka klienta pozycjami zapytania w statusie Approved po uzgodnionych cenach jednostkowych i zwrócenie adresu procesu zamówienia. |
| `GET /api/v1/admin/quote-requests` | administrator | Lista zawężona do przypisań opiekuna handlowego, z filtrami według statusu i organizacji. |
| `GET /api/v1/admin/quote-requests/:id` | administrator | Szczegóły z pełną tożsamością wykonawców w dzienniku zdarzeń oraz, dla każdej pozycji, ceną referencyjną i propozycją klienta — zob. *Cena referencyjna*. |
| `GET /api/v1/admin/quote-requests/:id/history` | administrator | Historia zapytania w postaci czytelnych wpisów — zob. *Historia*. |
| `POST /api/v1/admin/quote-requests` | administrator | Utworzenie w imieniu klienta → status `Created from admin`. |
| `PATCH /api/v1/admin/quote-requests/:id` | administrator | Zmiana zapytania w statusie Pending lub Created from admin → wymaga ponownej akceptacji klienta. |
| `POST /api/v1/admin/quote-requests/:id/approve` | administrator | Zatwierdzenie zapytania w statusie Pending, którego każda pozycja ma uzgodnioną cenę jednostkową. |
| `POST /api/v1/admin/quote-requests/:id/cancel` | administrator | Anulowanie z opcjonalnym powodem. |
| `POST /api/v1/admin/quote-requests/:id/assign` | administrator | Ustawienie `assignedAdminUserId` (wyłącznie informacyjne). |
| `GET`, `POST /api/v1/admin/quote-requests/list-views`; `PATCH`, `DELETE …/list-views/:id` | administrator | Zapisane widoki listy zapytań ofertowych — zob. *Zapisane widoki*. |
| `GET /api/v1/admin/sales-reps/:adminUserId/organizations` | administrator | Widok odwrotny — organizacje, za które odpowiada opiekun, z liczbą otwartych zapytań w każdej z nich. |
| `GET /api/v1/storefront/settings/quote-requests` | publiczny | Zwraca dwie flagi widoczności w storefroncie. |
| `GET /api/v1/quote-requests/price-negotiation` | klient | Obowiązująca wartość negocjacji cen zalogowanego klienta — zob. *Blokada negocjacji cen*. |
| `GET` / `PUT /api/v1/admin/organizations/:id/quote-price-negotiation` | administrator | Odczyt i ustawienie wartości negocjacji cen organizacji. Odczyt wymaga `customers:read`, zapis `customers:manage`. |
| `GET` / `PUT /api/v1/admin/customers/:id/quote-price-negotiation` | administrator | Odczyt i ustawienie nadpisania na koncie klienta, z wynikową obowiązującą wartością. Odczyt wymaga `customers:read`, zapis `customers:manage`. |

Treść żądania utworzenia i edycji szkicu przez klienta przyjmuje najwyżej **200 pozycji**; dłuższa
lista jest odrzucana z `400 VALIDATION_FAILED`.

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

## Cena referencyjna

Każda pozycja zapytania ofertowego ma **cenę referencyjną**: tyle, ile klient zapytania zapłaciłby
za ten produkt, wariant i ilość w zwykłym zamówieniu. Z nią sprzedawca porównuje propozycję
klienta.

- **Netto, za jednostkę podstawową.** To cena jednostkowa netto jednej sztuki podstawowej —
  jednostki, w której liczona jest ilość każdej pozycji — bez względu na jednostkę opakowania
  wybraną przez klienta. To cena, którą cenniki naliczają temu klientowi za produkt, wariant i
  ilość pozycji — cena bazowa, cena katalogowa dla wszystkich w kanale, cena organizacji lub grupy
  klientów klienta oraz cena promocyjna, gdy jest niższa (zob. stronę modułu `price_lists`) — w
  walucie zapytania, jeśli ją wskazuje, a w przeciwnym razie w domyślnej walucie kanału.
- **Ustalana na serwerze, dla właściciela zapytania, w kanale sprzedaży zapytania.** Właścicielem
  jest konto klienta, które złożyło zapytanie, i jego organizacja — także wtedy, gdy administrator
  organizacji edytuje szkic współpracownika. Cena przysłana przez klienta nigdy nie jest używana:
  nieznany klucz w treści żądania klienta jest pomijany.
- **Zapisywana w chwili zapytania.** Jest zapisywana przy każdym zapisie po stronie klienta —
  formularz w storefroncie, koszyk zamieniony na zapytanie, edycja szkicu, ponowne złożenie, szybkie
  zamówienie, lista zakupowa i zamówienie skopiowane do zapytania — i zostaje na cały czas życia
  zapytania; rewizja sprzedawcy jej nie zmienia. Edycja szkicu zachowuje zapisaną cenę
  niezmienionej pozycji, a dla zmienionej lub nowej ustala ją ponownie. Gdy ceny nie da się ustalić,
  pozycja nie zapisuje żadnej, a zapytanie i tak zostaje przyjęte.
- **Koszyk jest własnym punktem odniesienia.** Zapytanie utworzone z koszyka zapisuje cenę
  jednostkową każdej pozycji koszyka jako cenę referencyjną tej pozycji. **Nie** zapisuje jej jako
  propozycji klienta: takie pozycje nie mają proponowanej ceny.

Dla programistów: zapisywana cena referencyjna jest ustalana przez port `buyerLinePricePort` modułu
`price_lists` (`BuyerLinePricePort.resolveForBuyer` w `@endora-commerce/contracts`), który wycenia
wszystkie pozycje zapytania partiami, tą samą wyceną co koszyk; port nie sprawdza uprawnień, więc ten
moduł przekazuje właściciela zapytania, którego już autoryzował. *Bieżąca cena* na ekranach panelu
administracyjnego pochodzi z `POST /api/v1/admin/price-books/resolve`, chronionego uprawnieniem
`price_lists:read`.

Ekran szczegółów w panelu administracyjnym pokazuje dla każdej pozycji cenę referencyjną,
proponowaną przez klienta cenę jednostkową, różnicę między nimi jako kwotę ze znakiem i jako
procent ceny referencyjnej (dwa miejsca po przecinku) oraz uzgodnioną cenę jednostkową. Zakładka
zmiany pokazuje to samo obok pola uzgodnionej ceny, z różnicą wpisywanej ceny liczoną na bieżąco.
Pozycja bez zapisanej ceny referencyjnej — złożona, zanim ceny referencyjne były zapisywane,
dodana przez sprzedawcę albo należąca do zapytania utworzonego przez administratora — pokazuje
zamiast niej **bieżącą** cenę klienta w kanale zapytania, oznaczoną jako *cena bieżąca*, a nie
*cena z dnia zapytania*. Gdy różnicy nie da się policzyć — brak ceny, cena referencyjna w innej
walucie niż pozycja albo cena referencyjna równa `0` — ekran pokazuje `—`. Pusta uzgodniona cena
jest wstępnie wypełniana tą samą ceną właściwą dla klienta, a nie ceną, którą w storefroncie
widziałby sam administrator.

Cena referencyjna, propozycja klienta i `salesChannelId` zapytania są wyłącznie w odpowiedziach
**panelu administracyjnego**; API klienta ich nie zawiera.

Odbiorcy `quoteRequestReadPort.listItems` — eksporty i konektory — znajdują zapisaną cenę w
`referenceUnitPrice` i `referenceCurrency` (oba `null`, gdy żadnej nie zapisano). Pozycja
zamieniona z koszyka ma `desiredUnitPrice = null`; cenę z koszyka należy czytać z
`referenceUnitPrice`.

**Sumy.** Cena referencyjna nigdy nie zastępuje brakującej wartości w sumie. `totalAtCustomerPrice`
na liście klienta ma wartość `null` — wyświetlaną jako `—` — chyba że propozycję ma **każda**
pozycja; to ta sama reguła, którą lista w panelu administracyjnym stosowała już wcześniej. Zapytanie
zamienione z koszyka nie ma więc tej sumy, dopóki nie zostanie wycenione. Suma w cenach klienta na
liście w panelu administracyjnym przetrwa rewizje sprzedawcy, bo rewizja zachowuje propozycję
każdej pozycji. Wartość szansy w CRM dla zapytania bez propozycji i bez uzgodnionej ceny wynosi
`0`; pozycja po rewizji, której klient nie wycenił, jest wyceniana według propozycji przeniesionej
z ostatniej edycji szkicu przez klienta, dopóki sprzedawca nie ustali uzgodnionej ceny.

## Historia

`GET /api/v1/admin/quote-requests/:id/history` — i zakładka Historia na ekranie szczegółów w
panelu administracyjnym — zamienia zapisane zdarzenia zapytania w czytelne wpisy, po polsku i po
angielsku:

- **Jeden wpis na decyzję.** Zapisy, które należą do siebie, są łączone: akceptacja klienta i
  zatwierdzenie, odrzucenie przez klienta i anulowanie, notatka administratora i zatwierdzenie oraz
  pary systemowe zapisywane przy utworzeniu zapytania, ponownym złożeniu i utworzeniu w imieniu
  klienta.
- **Kto to zrobił.** Każdy wpis wskazuje osobę, która działała, a nie autora zapytania:
  administratora imieniem, nazwiskiem i rolą, użytkownika klienta imieniem, nazwiskiem i adresem
  e-mail, a wygaśnięcie i zakończenie przez zamówienie jako *System*. Wykonawca, którego nie da się
  już ustalić, jest pokazywany jako nieznany użytkownik z zapisaną rolą, a reszta historii nadal
  się wyświetla. Nazwiska pojawiają się wyłącznie w panelu administracyjnym; API klienta nie
  ujawnia więcej niż wcześniej.
- **Co się zmieniło.** Zmiana wymienia, względem poprzedniej rewizji: dodane pozycje (z ilością i
  uzgodnioną ceną) i usunięte, ilość, uzgodnioną cenę, cenę proponowaną przez klienta, notatkę
  pozycji, notatkę nagłówka i termin ważności — każdą jako stara → nowa wartość. Pozycje są
  nazywane produktem i wariantem. Zmiany jednostki opakowania i pól niestandardowych nie są
  wymieniane. Wymieniane są też zmiany grup pozycji — *dodano grupę*, *usunięto grupę*, *zmieniono
  nazwę grupy* (z → na), pozycja *przeniesiona* z jednej grupy do innej (*Bez grupy* oznacza brak
  grupy) oraz *zmieniono kolejność pozycji*, gdy pozycje lub grupy jedynie przestawiono — zob.
  *Grupy pozycji*. Rewizja bez wymienionej zmiany brzmi *oferta wysłana ponownie bez zmian*. Powód lub
  notatka podane przy anulowaniu, odrzuceniu albo zatwierdzeniu są pokazywane.
- **Wartości nieprzeniesione z szansy sprzedażowej.** Gdy zapytanie utworzone z szansy
  sprzedażowej nie mogło przyjąć części jej wartości pól niestandardowych (zob. *Pola
  niestandardowe*), historia zawiera jeden wpis autorstwa *System*, *Nie przeniesiono wartości pól
  niestandardowych z szansy sprzedażowej*, który podaje numer szansy i wymienia każde pominięte
  pole — nazwą pola szansy z chwili pominięcia — wraz z powodem. Wpis nie pokazuje żadnej wartości i może go
  przeczytać każdy, kto może otworzyć zapytanie. Jest **widoczny tylko dla administratorów**: widok
  zapytania u klienta nigdy go nie pokazuje. Przeniesione wartości nie mają osobnego wpisu.
- **Ograniczona.** Historia odczytuje **100 najnowszych zdarzeń**. Gdy istnieją starsze, odpowiedź
  zawiera `truncated: true`, a zakładka informuje, że starsze wpisy nie są wyświetlane.

Zapytania złożone, zanim ta historia powstała, są opisywane na podstawie już zapisanych danych;
niczego się nie uzupełnia wstecz.

## Edycja szkicu przez klienta

Klient może edytować zapytanie w statusie `Pending` przez `PATCH /api/v1/quote-requests/:id` tyle
razy, ile chce, dopóki sprzedawca go nie **zmieni**. Gdy administrator zmienił zapytanie, edycja
jest odrzucana z `409 RFQ_NOT_DRAFT`, a klient składa zapytanie ponownie. Edycje klientów — także
edycja szkicu współpracownika przez administratora organizacji — nigdy nie zamykają szkicu.

- Edycja zachowuje wariant, notatkę i jednostkę opakowania każdej pozycji w postaci przysłanej.
- Endpoint przyjmuje najwyżej **30 edycji na minutę dla jednego zapytania**, liczonych
  osobno dla każdego klienta; kolejne dostają odpowiedź `429 RATE_LIMITED` z nagłówkiem
  `Retry-After`. Żądanie odrzucone przed uwierzytelnieniem nie jest liczone.

Rewizja sprzedawcy (`PATCH /api/v1/admin/quote-requests/:id`) zachowuje wariant, notatkę,
jednostkę opakowania, propozycję klienta i zapisaną cenę referencyjną każdej pozostającej
pozycji, o ile sprzedawca ich nie zmienił. Zapisana cena referencyjna zostaje także wtedy, gdy
sprzedawca zmienia ilość pozycji: rewizja sprzedawcy nigdy nie ustala jej ponownie. Pozycja dodana
przez sprzedawcę ma wybrany przez niego wariant i notatkę, a jednostki opakowania nie ma.

## Grupy pozycji

Operator może podzielić pozycje oferty na **nazwane grupy** — *Parter*, *Piętro*, *Opcje* — tak aby
długa oferta czytała się tak, jak klient myśli o zleceniu. Grupy służą **wyłącznie prezentacji**: nie
zmieniają żadnej ceny, rabatu, ilości ani sumy, a pogrupowana oferta daje dokładnie te same sumy co
te same pozycje bez grup.

**Gdzie.** Zakładka **Modyfikacja** oferty i ekran **Utwórz zapytanie ofertowe**, dopóki pozycje
oferty można edytować — w statusach *Created from admin* i *Pending*. W każdym innym statusie
grupowanie jest pokazywane tylko do odczytu, a zapis, który je przesyła, jest odrzucany jak każda
inna edycja pozycji (`409 RFQ_NOT_QUOTED`). Nie dochodzi żadne nowe uprawnienie: grupowanie wymaga
`rfqs:handle` i dostępu handlowca do organizacji oferty, tak jak edycja jej pozycji.

**Co może zrobić operator.**

- **Dodaj grupę** tworzy grupę i ustawia fokus w polu jej nazwy. Nazwa jest przycinana i ma od 1 do
  120 znaków; dwie grupy mogą mieć tę samą nazwę. Oferta ma najwyżej **50** grup — wtedy *Dodaj
  grupę* jest nieaktywne i mówi dlaczego. Pusta nazwa daje komunikat *Wpisz nazwę grupy.* i blokuje
  zapis.
- **Zmiana nazwy** grupy odbywa się w polu jej nazwy, **usunięcie** — jej przyciskiem usuwania.
  Usunięcie grupy nigdy nie usuwa pozycji: jej pozycje przechodzą, w swojej kolejności, do sekcji
  **Bez grupy**.
- **Przeniesienie pozycji** do innej grupy albo na wybrane miejsce we własnej: przeciągnięciem za
  uchwyt, z klawiatury — fokus na uchwycie, Spacja lub Enter, przesuwanie strzałkami (za ostatnią
  pozycją grupy pozycja wchodzi do następnej sekcji), Spacja lub Enter, aby upuścić, Escape, aby
  anulować — albo menu **Przenieś do grupy** pozycji, które nie wymaga przeciągania. Każde
  przeniesienie jest ogłaszane czytnikom ekranu.
- **Kolejność grup** zmienia się przeciągnięciem, z klawiatury albo przyciskami przesuwania grupy w
  górę i w dół. Sekcja **Bez grupy** jest zawsze ostatnia i nie można jej przesunąć, zmienić jej
  nazwy ani jej usunąć.
- Produkt dodany przyciskiem **Dodaj produkt** danej grupy trafia do tej grupy; każda inna dodana
  pozycja trafia do sekcji *Bez grupy*.
- Grupa opróżniona z pozycji **pozostaje**, dopóki nie zostanie usunięta, i jest pokazywana jako
  puste pole upuszczania (*Przeciągnij tu pozycje lub użyj opcji Przenieś do grupy.*). Puste grupy
  nigdy nie są pokazywane klientowi, drukowane ani przenoszone do zamówienia.
- **Jeden produkt w kilku pozycjach.** Ten sam produkt może być w kilku pozycjach — w różnych
  grupach albo dwa razy w jednej: *5 sztuk w Hali A, 3 w Hali B*. W zakładce *Modyfikacja* przycisk
  **Podziel pozycję** (obok *Przenieś do grupy*, przy pozycji o ilości 2 lub większej) pyta o ilość
  do przeniesienia na nową pozycję (od 1 do ilości pozycji minus 1) i o grupę nowej pozycji —
  domyślnie tę samą — po czym dodaje pozycję tego samego produktu, wariantu, jednostki opakowania,
  uzgodnionej ceny i propozycji klienta, zmniejszając pierwotną. Na ekranie tworzenia zapytania
  produkt, który już jest w zapytaniu, można po prostu dodać ponownie.

**Podsumowania.** Każda sekcja pokazuje liczbę pozycji oraz wartość netto, VAT i brutto — według tej
samej zasady, której używają sumy oferty — a tam, gdzie ekran pokazuje ceny katalogowe, także rabat
względem ceny katalogowej. Są przeliczane przy każdej edycji i przeniesieniu pozycji. Ekran
tworzenia nie pokazuje VAT, więc jego sekcje pokazują liczbę pozycji i wartość netto.

**Zapis.** Grupowanie zapisuje ten sam przycisk, który zapisuje pozycje — **Zapisz rewizję** albo
przycisk tworzenia — w tym samym zapisie, z tym samym sprawdzeniem współbieżności, i jest ono
utrwalane we wpisie audytu tego zapisu (`quote_request.modify` albo
`quote_request.create_on_behalf`, z nazwami grup i liczbą ich pozycji przed zmianą i po niej).
**Zapis, który zmienia tylko grupowanie, jest rewizją jak każda inna**: klient dostaje powiadomienie
i prośbę o jej akceptację. Zakładka **Historia** wymienia zmiany grupowania w każdej rewizji (zob.
*Historia*).

**Co widzi klient.** Oferta w storefroncie pokazuje każdą grupę, która ma pozycję, jako sekcję z
nagłówkiem, w kolejności, z jej pozycjami i podsumowaniem, a następnie pozycje bez grupy pod
nagłówkiem **Pozostałe pozycje**; oferta bez grup wygląda dokładnie tak jak wcześniej. Klient nie
może tworzyć, zmieniać nazw, usuwać ani przestawiać grup, a żadne żądanie klienta nie przyjmuje
grupowania. Porównanie z ostatnią rewizją, którą klient widział, mówi w jednym wpisie, że *zmieniono
układ pozycji*, i nie wymienia niczego więcej. Każda pozycja jest porównywana z własną: przy
produkcie w kilku pozycjach wpis wymienia grupę pozycji, której dotyczy — *Śruba (Hala B): ilość 3 →
2* — i tak samo robi *Historia* w panelu administracyjnym. Akceptacja i odrzucenie rewizji działają jak
wcześniej: grupowanie nigdy nie jest powodem odmowy akceptacji.

**Co zachowuje grupę pozycji.** Edycja szkicu przez klienta zachowuje w grupie każdą pozycję, którą
zachowuje. Klient API, który zapisuje pozycje oferty bez przesłania `groups`, zachowuje w grupie
każdą zachowaną pozycję, a nowe pozycje umieszcza w sekcji *Bez grupy*. Pozycja bez identyfikatora
jest dopasowywana do zapisanej pozycji tego samego produktu najpierw według grupy, potem według
ilości, a dopiero potem według kolejności — dlatego usunięcie jednej z dwóch pozycji produktu
zostawia drugą w jej grupie. **Ponowne złożenie** zaczyna
się bez grup: to nowe zapytanie, wycenione na nowo, które handlowiec grupuje ponownie. **Zamiana w
zamówienie** wypełnia koszyk w kolejności oferty, a zamówienie złożone z tego koszyka zachowuje grupy
— zob. stronę modułu zamówień.

**PDF** drukuje grupy — zob. *PDF oferty*.

**API.** `PATCH /api/v1/admin/quote-requests/:id` i `POST /api/v1/admin/quote-requests` przyjmują
opcjonalną listę `groups` — całe grupowanie, w kolejności wyświetlania, każda grupa jako
`{ key, id?, name }` (`id` zachowuje istniejącą grupę, grupa bez niego jest tworzona, a zapisana
grupa pominięta na liście jest usuwana) — oraz dla każdej pozycji opcjonalny `groupKey` (`null` =
bez grupy); pozycje przesyła się w kolejności wyświetlania. `groups` bez `items` daje odpowiedź
`400`; `id`, które nie jest grupą tej oferty, daje `422 VALIDATION_FAILED`. Nowa pozycja wydzielona
z zapisanej ma `splitFromId` (identyfikator zapisanej pozycji): zachowuje wtedy jej jednostkę
opakowania, propozycję klienta, uwagę i cenę referencyjną; `splitFromId`, które nie wskazuje pozycji
tej oferty, jest pomijane. Każda odpowiedź zawiera
`itemGroups` (`{ id, name, position }`) oraz dla każdej pozycji `groupId` i `position`, z pozycjami
w kolejności wyświetlania — odpowiedź dla administratora wymienia także puste grupy, odpowiedź dla
klienta tylko grupy, które mają pozycję. Publikowany port odczytu `quoteRequestReadPort.listItems`
zwraca `group` i `position` każdej pozycji, w kolejności wyświetlania.

## Minimalne ilości zamówienia i jednostki opakowania

Zapytania ofertowe stosują minimalne ilości zamówienia z katalogu — minimum produktu w sztukach i
minimum każdej jednostki opakowania w jednostkach, liczone ze wszystkich pozycji produktu w
zapytaniu (oba definiuje strona modułu Catalog). **Reguła zależy od tego, kto zapisuje, a nie od
trasy.**

**Jednostki opakowania wskazuje się identyfikatorem.** Pozycja klienta (utworzenie, edycja szkicu,
koszyk → zapytanie ofertowe) może nieść `packagingUnitId`. Musi to być bieżąca jednostka produktu
z tej pozycji; serwer zapisuje jej nazwę i base quantity z katalogu i ignoruje nazwę ani base
quantity przesłane w pozycji. Pozycja, która przesyła nazwę jednostki i base quantity bez
identyfikatora, jest przyjmowana tylko wtedy, gdy oba pasują do jednej z jednostek produktu.
Wszystko inne jest odrzucane w całości z kodem `422 PACKAGING_UNIT_MISMATCH`, bez zapisu;
`details.lines[]` podaje `index` i `reason` każdej błędnej pozycji. Każdy błąd identyfikatora —
nieznany, usunięty albo jednostka innego produktu — ma ten sam powód, `unknown_unit`, więc
odpowiedź nie zdradza niczego o innych produktach; nazwa dostaje `name_unknown` albo
`base_quantity_mismatch`. Odrzucana jest też edycja szkicu, która odsyła pozycję z zapisaną nazwą
jednostki niepasującą już do żadnej jednostki w katalogu. `packagingUnitId` jest zwracane w
odczycie dla panelu i dla klienta, a rewizja administratora zachowuje je na pozycjach, które
zostawia.

**Zapis klienta poniżej minimum jest odrzucany.** Utworzenie (`POST /api/v1/quote-requests` —
bezpośrednio, z koszyka, z szybkiego zamówienia, z listy zakupów albo przez sklonowanie jednego z
jego zamówień), edycja szkicu (`PATCH /api/v1/quote-requests/:id`) i ponowne złożenie
(`POST /api/v1/quote-requests/:id/resubmit`) odpowiadają kodem
`422 PRODUCT_BELOW_MINIMUM_QUANTITY` albo `422 PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY` z
`details.lines[]` dla każdej odrzuconej pozycji i niczego nie zapisują; zdanie i nazwy produktów są
w języku odpowiedzi (z nagłówka `Accept-Language` żądania, z uwzględnieniem wag q, a w przeciwnym
razie w domyślnym języku kanału). Kolejność sprawdzeń:
najpierw produkt, którego klient nie widzi albo którego kanał nie publikuje, jest odrzucany jako
nieznany, więc nic o nim nie zostaje ujawnione; potem jednostka opakowania, potem minima —
wszystko, zanim zostanie wyznaczona jakakolwiek cena referencyjna.

- **Edycja szkicu.** Pozycja, której klient nie zmienił — ten sam produkt, wariant, jednostka
  opakowania i ilość co w zapisanej pozycji — nie jest odrzucana, nawet poniżej minimum; jej sztuki
  nadal liczą się do łącznej ilości produktu, gdy sprawdzana jest inna pozycja tego produktu.
  Pozycja wskazuje jednostkę opakowania jej identyfikatorem, więc jednostka, której nazwę zmieniono
  w katalogu po zapisaniu pozycji, nadal jest tą samą jednostką, a pozycja pozostaje niezmieniona
  (i zachowuje zapisaną cenę referencyjną).
- **Ponowne złożenie** jest oceniane jak nowe zapytanie, bez zwolnienia, w sztukach (nie przenosi
  jednostki opakowania). Zapytanie, którego produkt już nie istnieje, jest odrzucane z kodem `404`.
- **Akceptacja albo odrzucenie rewizji** nigdy nie jest odrzucane z powodu minimów.

**Zapis administratora nigdy nie jest odrzucany z powodu minimum.** Utworzenie w imieniu klienta,
**Modyfikacja** (łącznie z wynegocjowanymi ilościami), sklonowanie zamówienia do zapytania
ofertowego z panelu i zbudowanie zapytania ofertowego z szybkiego zamówienia w panelu zapisują
pozycje poniżej minimum. Odczyt w panelu (`GET /api/v1/admin/quote-requests/:id`) daje każdej takiej
pozycji `minimumWarning` (`{ kind, minimum, packagingUnitName? }`), ocenione na bieżących pozycjach
zapytania, a ekran zapytania ofertowego pokazuje je jako plakietkę *Poniżej minimum* na pozycji, na
zakładkach **Przegląd** i **Modyfikacja**. Ostrzeżenie informuje i niczego nie blokuje; nigdy nie
trafia do odczytu klienta. Klonowanie do zapytania i budowanie z szybkiego zamówienia w panelu
nadal sprawdzają jednostkę opakowania.

**Zamówienie zaakceptowanego zapytania zachowuje jego ilości.** `convert-to-order` wypełnia koszyk
uzgodnionymi ilościami bez sprawdzania minimów; w koszyku każda pozycja wypełniona z zapytania jest
zwolniona, dopóki jej ilość równa się ilości z zapytania, a checkout honoruje to tylko wtedy, gdy
to zapytanie jest nadal ważne (strony modułów Carts i Orders). Gdy ten moduł jest wyłączony, nic
nie może potwierdzić zapytania, więc taki koszyk traci zwolnienia przy checkoucie.

Migracja `20261018T122118_quote_requests_item_packaging_unit_id.ts` dodaje
`quote_request_items.packaging_unit_id` (dopuszcza `null`, bez klucza obcego — nazwa i base
quantity jednostki pozostają skopiowane w pozycji).

## Blokada negocjacji cen

Administrator decyduje, czy klient może **proponować ceny** w zapytaniu ofertowym:

- **W organizacji** (`/organizations/:id`) — *Członkowie mogą proponować ceny*: dozwolone
  (domyślnie) albo niedozwolone, dla każdego konta klienta organizacji.
- **Na koncie klienta** (`/customers/:id`) — nadpisanie: *jak organizacja* (domyślnie),
  *dozwolone* albo *niedozwolone*. Ekran pokazuje wynikową wartość i to, czy pochodzi z
  nadpisania, czy z organizacji.

Obowiązująca wartość konta to jego nadpisanie, jeśli jest ustawione, w przeciwnym razie wartość
organizacji, a w ostateczności *dozwolone*. Nie ma wartości domyślnej dla całej platformy ani dla
kanału: wartość obowiązuje w każdym kanale sprzedaży, a dwóch członków jednej organizacji może mieć
różne wartości.

**Co spotyka zablokowanego klienta.**

- Szkic w storefroncie ukrywa pole proponowanej ceny i pokazuje cenę jednostkową z katalogu, tylko
  do odczytu, tam gdzie jest znana, z informacją, że zapytanie wyceni dział sprzedaży. Ceny wpisane
  wcześniej przez klienta zostają w szkicu w przeglądarce, ale nigdy nie są wysyłane. Storefront
  poznaje wartość z `GET /api/v1/quote-requests/price-negotiation`, który zwraca obowiązującą
  wartość zalogowanego klienta i nic więcej; jeśli ten odczyt się nie powiedzie, strona pokazuje
  pole — wyświetlanie działa w trybie otwartym.
- **Gwarancją jest API.** Utworzenie lub edycja szkicu przez klienta, w której pozycje mają
  proponowaną cenę — także `0` — jest odrzucana z `422 RFQ_PRICE_PROPOSAL_NOT_ALLOWED`, z
  przetłumaczonym komunikatem, i nic nie zostaje zapisane.
  O blokadzie decyduje to samo żądanie, które zapisuje zapytanie, i nigdy nie przepuszcza ono
  propozycji w razie wątpliwości: jeśli wartości właściciela nie da się odczytać, żądanie z
  propozycją kończy się błędem i niczego nie zapisuje, a żądanie bez propozycji nie potrzebuje
  blokady i przechodzi.
- Zamiana koszyka na zapytanie i ponowne złożenie nadal działają: nie niosą propozycji.

**Blokada wiąże właściciela zapytania, a nie osobę, która działa.** Przy utworzeniu i ponownym
złożeniu właścicielem jest działający klient; przy edycji szkicu przez administratora organizacji
— współpracownik, do którego szkic należy. Zablokowany administrator organizacji może więc
proponować ceny w szkicu niezablokowanego współpracownika, a niezablokowany nie może w szkicu
zablokowanego.

Blokada nie dotyczy strony sprzedawcy — tworzenia, zmiany i zatwierdzania przez administratora ani
uzgodnionej ceny — i nie zmienia propozycji już zapisanych. Jest odczytywana przy każdym żądaniu,
bez pamięci podręcznej, więc zmiana obowiązuje od następnego żądania.

**Kto ją widzi i zmienia.** Obie kontrolki to panele na ekranach organizacji i klienta, widoczne
dla ról z `customers:read`; zmiana wartości wymaga `customers:manage`, a bez niego kontrolka panelu
jest nieaktywna. Rola, która ma `customers:manage`, ale **nie** ma `customers:read`, nie widzi
panelu. Opiekun handlowy sięga tylko do organizacji, które może widzieć; każdy inny identyfikator
dostaje `404`. Organizacja bez przypisanego opiekuna handlowego jest widoczna dla każdego opiekuna
(zob. *Model widoczności*), więc każdy opiekun może zmienić jej blokadę; samą tę regułę opisuje
zgłoszenie #305. Nie dotyczy to kont jej klientów: podlegają filtrowi przypisanych
organizacji, więc żądanie opiekuna o panel konta — odczyt lub zmiana — dostaje `404`, a nadpisania
tych kont pozostają w gestii administratora platformy. Każda zmiana jest audytowanym zapisem, który zapisuje administratora, organizację
lub konto oraz starą i nową wartość.

**Moduł wyłączony.** Gdy ten moduł jest wyłączony, panele, cztery endpointy administracyjne, odczyt
w storefroncie i egzekwowanie znikają; zapisane wartości zostają i znów obowiązują po ponownym
włączeniu modułu.

## Model widoczności

Opiekun handlowy to administrator platformy z rolą `sales_representative`. Regułę widoczności
skupia w jednym miejscu predykat
`SalesRepAssignmentService.canSeeOrganization(adminUserId, organizationId)`:

1. Rola `platform_admin` → widzi każdą organizację.
2. W przeciwnym razie administrator widzi organizację wtedy i tylko wtedy, gdy łączy ich wiersz w
   `organization_sales_rep_assignments` LUB organizacja nie ma w tej tabeli żadnych wierszy
   (reguła zastępcza dla organizacji bez opiekuna — taką organizację widzi każdy opiekun handlowy).

Opiekun handlowy, który wskaże zapytanie ofertowe organizacji, której nie może widzieć, dostaje ten
sam `404` co dla nieistniejącego identyfikatora, na każdym endpoincie administracyjnym zapytań
ofertowych — szczegółach, historii i każdej akcji. (We wcześniejszych wersjach część z nich
odpowiadała `403`, co zdradzało, że zapytanie istnieje).

Klient z rolą `org_admin` we własnej organizacji widzi każde zapytanie ofertowe tej organizacji, a
nie tylko własne.

## Pola niestandardowe

Zapytania ofertowe przyjmują pola niestandardowe, definiowane na ekranie **Pola niestandardowe**.
Pola te podążają za tym modułem: gdy `quote_requests` jest wyłączony, nie są tam wyświetlane, nie
można ich tworzyć ani edytować i nie zwraca ich API definicji; pola, ich opcje i zapisane wartości
są zachowane i wracają bez zmian po ponownym włączeniu modułu.

### Wartości przenoszone do zapytania i z niego

Pole zapytania ofertowego może przekazywać swoją wartość dalej, a pole szansy sprzedażowej — do
zapytania ofertowego; ustawia się to dla każdego pola opcją **Przenoś wartość do: …** na ekranie
**Pola niestandardowe**, którego strona opisuje reguły (ten sam klucz, zgodny typ i opcje, zasada
widoczności). Wypełniane jest tylko puste pole i tylko raz:

- **Do zamówienia** złożonego z zaakceptowanego zapytania, przy składaniu — zob. stronę modułu
  zamówień.
- **Do szansy sprzedażowej**, którą moduł CRM otwiera dla zapytania albo do której dołącza
  zamówienie złożone z zapytania — zob. stronę modułu CRM.
- **Z szansy sprzedażowej** do zapytania, które administrator tworzy przyciskiem **Utwórz zapytanie
  ofertowe** na karcie *Powiązania* szansy. Wartości trafiają do zapytania, gdy moduł CRM powiąże je
  z szansą, w zmianie przypisanej **systemowi** (`quote_request.custom_fields.carry` w dzienniku
  audytu); utworzenie zapytania pozostaje przypisane administratorowi. Wartość, której nie da się
  przenieść, jest pomijana i wymieniana w *Historii* zapytania (zob. *Historia*), a zapytanie i tak
  powstaje. Zapytanie powiązane z szansą ręcznie nie otrzymuje niczego, podobnie jak zapytanie,
  które klient utworzył jako kopię zamówienia.

  **Wersja zmienia się tuż po utworzeniu.** Przeniesienie, które wypełnia pole, jest zmianą
  zapytania jak każda inna i podnosi jego `version`, a następuje tuż po tym, jak żądanie utworzenia
  odpowiedziało. Klient, który edytuje nowe zapytanie z wersją zwróconą w odpowiedzi na utworzenie,
  dostaje więc `409 VERSION_CONFLICT`, gdy wartości zostały już przeniesione: odczytaj zapytanie
  ponownie i wyślij wersję, którą zwraca teraz. Przeniesienie, które niczego nie wypełnia, nie
  zmienia wersji. Na czas odczytu i zapisu przeniesienie blokuje wiersz zapytania, więc nigdy nie
  nadpisuje edycji administratora wykonanej w tej samej chwili.

Gdy ten moduł jest wyłączony, nic nie jest przenoszone do zapytania ofertowego ani z niego i nic nie
jest odtwarzane po jego powrocie. Dla integratorów: zapisane zdarzenie ma typ
`custom-field-carry-skipped`; w `GET /api/v1/admin/quote-requests/:id/history` jest to wpis o
`kind` `custom_field_carry_skipped`, którego `customFieldCarry` zawiera `source` (`entityType:
"opportunity"`, `recordId`, `reference`) i `skipped` (`key`, `reason`, `label`).

### Filtry pól niestandardowych na liście

Pole zapytania ofertowego z włączoną opcją **Używaj jako filtra listy** jest dostępne jako filtr na
liście zapytań ofertowych, opisany w twoim języku: tekst, który zawiera, zakres liczb lub dat, tak
lub nie albo jedna lub więcej opcji. Zapytanie bez wartości tego pola nigdy nie pasuje. Filtr
stosuje serwer, więc zawęża całą listę — sumę i każdą stronę — a nie tylko już wczytane zapytania;
status, wyszukiwanie, sortowanie i stronicowanie działają obok niego. Każdy filtr jest pokazany jako
usuwalna etykieta, zapisuje się w adresie strony i w zapisanych widokach, a jego zmiana wraca do
pierwszej strony listy.

Jeśli adres zawiera filtr, który nie jest już dostępny, lista mówi o tym, podając nazwę pola, i
oferuje **Usuń ten filtr**. Zapisany widok z takim filtrem pomija go przy wczytaniu, z komunikatem,
który go nazywa. Wywołujący API przesyłają filtry jako `customFieldFilters` w
`GET /api/v1/admin/quote-requests`, a dostępne pola odczytują z
`GET /api/v1/admin/quote-requests/custom-field-filters` (`rfqs:handle`). Odwrócony zakres (`min` większe niż `max`, `from` późniejsze niż `to`) lub operator niepasujący do typu pola daje `400` `VALIDATION_FAILED`.

## Zapisane widoki

Zapisany widok to nazwane ustawienie listy zapytań ofertowych — jej filtrów, sortowania i kolumn —
które administrator może ponownie zastosować jednym wyborem.

### Korzystanie z zapisanych widoków

Na pasku narzędzi listy zapytań ofertowych jest lista wyboru **Zapisane widoki**, której pierwsza
pozycja to **— Wybierz widok —**, a obok niej dwa przyciski: **Zapisz widok** i **Usuń widok**.

- **Co zapamiętuje widok.** Siedem rzeczy: zakres **Widoczność**, organizację, wybrane statusy,
  wyszukiwany tekst, filtry pól niestandardowych, sortowanie i widoczne kolumny. Wybranie widoku
  zastępuje wszystkie siedem wartościami z widoku, odrzuca to, co zmieniono i nie zapisano, i wraca
  na pierwszą stronę. Status lub kolumna, których lista już nie zna, są pomijane; filtr pola
  niestandardowego, który nie jest już dostępny, jest pomijany z komunikatem, który go nazywa;
  widok bez kolumn pokazuje kolumny domyślne; widok bez poprawnego zakresu otwiera się w twoim
  domyślnym zakresie.
- **Widok nigdy nie poszerza tego, co widzisz.** Przechowuje wartości filtrów, nigdy wyniki. Po
  wczytaniu widoku lista jest odczytywana z *twoimi* uprawnieniami i *twoimi* organizacjami,
  niezależnie od tego, kto widok zapisał. *Moje organizacje* oznacza organizacje przypisane do
  ciebie, administratora, który wczytuje widok — a nie do tego, kto go zapisał — a *Wszystkie*
  nadal pokazuje tylko to, co wolno ci widzieć. Organizacja jest zapisana jako identyfikator:
  jeśli jest poza twoim zasięgiem, jej nazwa nie jest pokazywana, a lista jest po prostu pusta.
- **Zapisywanie.** **Zapisz widok** otwiera jedno okno z polem **Nazwa** i polem wyboru
  **Udostępnij wszystkim administratorom, którzy mają dostęp do tej listy**. Pole wyboru jest na
  początku odznaczone, więc nowy widok jest prywatny, dopóki go nie zaznaczysz. Nazwa jest
  wymagana, spacje na początku i na końcu są usuwane, a jej długość to najwyżej 160 znaków.
  Problemy są pokazywane przy polu i nic nie zostaje wysłane, dopóki ich nie poprawisz; odmowa
  serwera jest pokazywana w oknie, które pozostaje otwarte z wpisanymi danymi.
- **Prywatny czy udostępniony.** Widok prywatny widzisz tylko ty. Widok udostępniony widzi każdy
  administrator, który ma dostęp do listy zapytań ofertowych, z dopiskiem **(udostępniony)** po nazwie. Lista
  wyboru nie pokazuje, kto zapisał udostępniony widok.
- **Jedna nazwa na administratora.** Nie możesz mieć na tej liście dwóch widoków, których nazwy
  różnią się tylko wielkością liter albo spacjami na początku lub końcu. Okno odpowiada
  **Masz już widok o tej nazwie.**, zanim cokolwiek wyśle, a serwer także odrzuca taką nazwę.
  Litery ze znakami diakrytycznymi są innymi literami: *Łódź* i *Lodz* to dwie różne nazwy. Nazwy
  używane przez innych administratorów i nazwy z innych list się nie liczą.
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
- **Dwa znaczenia „administratora platformy” na tej liście.** Powyższa zasada nie jest tą, którą
  stosuje *Model widoczności*: domyślny zakres listy i widoczność wszystkich organizacji nadal
  zależą od dosłownej roli `platform_admin`. Administrator z rolą niestandardową może więc usunąć
  udostępniony widok kolegi, a mimo to otwiera listę w zakresie *Moje organizacje*.
- **Tylko zapis, wczytanie i usunięcie.** Panel administracyjny nie zmienia nazwy widoku, nie
  zmienia tego, czy jest udostępniony, i nie nadpisuje go bieżącym ustawieniem; zamiast tego zapisz
  nowy widok i usuń stary. Liczba widoków nie jest ograniczona.
- **Gdy zapytania ofertowe są wyłączone,** zapisane widoki znikają razem z resztą modułu, ale nie są
  usuwane. Po ponownym włączeniu modułu każdy widok jest taki, jak był.

### API zapisanych widoków

| Metoda i ścieżka | Odpowiedź |
| --- | --- |
| `GET /api/v1/admin/quote-requests/list-views` | `200` — własne widoki wywołującego oraz wszystkie widoki udostępnione, posortowane po nazwie |
| `POST /api/v1/admin/quote-requests/list-views` | `201` — utworzony widok |
| `PATCH /api/v1/admin/quote-requests/list-views/:id` | `200` — zmieniony widok; dowolne z `name`, `shared`, `filters`, `sort`, `visibleColumns`. Panel administracyjny go nie wywołuje. Treść, która niczego nie zmienia — pusta albo z wartościami takimi jak zapisane — niczego nie zapisuje ani nie loguje i zwraca bieżący widok |
| `DELETE /api/v1/admin/quote-requests/list-views/:id` | `200` — `{ data: { deleted: <id> } }` |

- **Uprawnienie.** Wszystkie cztery trasy wymagają `rfqs:handle` — kodu, który chroni listę — i są
  zarejestrowane za bramką obecności modułu razem z resztą jego tras panelu. Nie ma osobnego kodu
  uprawnienia. Żądanie bez aktora-administratora jest odrzucane z `401 UNAUTHORIZED`. Statyczny
  segment `list-views` ma pierwszeństwo przed `quote-requests/:id`.
- **Stan wyłączony.** Gdy `quote_requests` nie jest faktycznie obecny, wszystkie cztery odpowiadają
  tak jak `GET /api/v1/admin/quote-requests` — `503 MODULE_DISABLED`. Wiersze w
  `quote_request_list_saved_views` pozostają nietknięte.
- **Treść żądania.** `name` (po przycięciu 1–160 znaków, bez znaków sterujących ani formatujących
  Unicode), `shared` (wartość logiczna), `filters` (obiekt, najwyżej 8192 bajty jako JSON
  w UTF-8), opcjonalne `sort` (`{ field, dir }`, `field` najwyżej 64 znaki, `dir` to `asc` albo
  `desc`, albo `null`) oraz opcjonalne `visibleColumns` (najwyżej 64 identyfikatory po najwyżej
  64 znaki albo `null`). Panel administracyjny zapisuje `filters` jako
  `{ scope, organizationId?, status?, q? }`. Wszystko poza tymi granicami to
  `400 VALIDATION_FAILED`. Kształty to `createQuoteRequestSavedViewRequestSchema` i
  `updateQuoteRequestSavedViewRequestSchema` w `@endora-commerce/contracts`.
- **Wczytanie to nowy odczyt listy.** Wartości widoku tylko ustawiają kontrolki listy; lista jest
  następnie odczytywana zwykłym `GET /api/v1/admin/quote-requests` jako osoba wczytująca, więc
  serwer stosuje jej własną widoczność, a `scope=mine` odnosi się do niej. Widok nigdy nie zawiera
  nazwy organizacji.
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
  To celowo nie jest własny test modułu `role.code === 'platform_admin'`, którego używa
  widoczność listy.
- **Odmowy.** Nieistniejący widok i prywatny widok innego administratora to `404 NOT_FOUND` —
  nie da się ich odróżnić. Udostępniony widok, którego wywołujący nie jest właścicielem i którego
  nie może zmienić jako administrator platformy, to `403 FORBIDDEN`. Nazwa, której klucza
  właściciel widoku już używa na tej liście, to `409 RFQ_SAVED_VIEW_NAME_TAKEN`, *„Masz już zapisany widok o tej nazwie na liście zapytań ofertowych. Wybierz inną nazwę.”*, w języku żądania.
- **Klucz nazwy** to nazwa przycięta i zapisana małymi literami — bez usuwania znaków
  diakrytycznych. Zasada wiąże **właściciela** widoku: administrator platformy zmieniający nazwę
  udostępnionego widoku kolegi dostaje odmowę, gdy kolega już używa tego klucza. Utworzenie widoku
  i zmiana klucza nazwy biorą blokadę doradczą (advisory lock) w zakresie transakcji, kluczowaną
  właścicielem, a wspiera ją unikalny indeks na `(owner_admin_user_id, lower(name))`, więc dwa
  równoczesne zapisy pod jedną nazwą zostawiają dokładnie jeden widok.
- **Brak audytu.** Zapisane widoki to osobista konfiguracja interfejsu i nie przechodzą przez
  Command Bus. Gdy administrator zmienia lub usuwa widok, którego nie jest właścicielem, usługa
  zapisuje jeden wpis dziennika na poziomie `info`:
  `{ event: 'saved_view.updated' | 'saved_view.deleted', list: 'quote_request_list_saved_views', viewId, ownerAdminUserId, actorAdminUserId }`.
  Ten wpis jest jedynym śladem.

## PDF oferty: eksport i wysyłka do klienta

Handlowiec zamienia zapytanie ofertowe w PDF na jego ekranie w panelu administracyjnym, w **każdym
statusie** oferty. Dwa przyciski w nagłówku strony otwierają to samo okno:

- **Eksportuj PDF** pobiera PDF, nazwany numerem oferty.
- **Wyślij PDF do klienta** wysyła go e-mailem.

Oba są widoczne tylko wtedy, gdy włączony jest moduł **Szablony dokumentów** (wysyłka wymaga też
e-maili transakcyjnych, których nie można wyłączyć), i oba wymagają uprawnienia `rfqs:handle` oraz
dostępu handlowca do organizacji oferty — tak samo jak otwarcie oferty. Nie dochodzi żadne nowe
uprawnienie.

**Szablon.** Okno oferuje szablony typu *Zapytanie ofertowe* zaprojektowane w **Szablonach
dokumentów**, które dotyczą kanału sprzedaży oferty — szablony dla wszystkich kanałów i szablony tego
kanału, nigdy innego. Zaznaczony jest szablon **zapamiętany** dla tej oferty, a w jego braku szablon
domyślny kanału oferty, potem szablon domyślny dla wszystkich kanałów; gdy żadnego nie ma, oferowany
jest tylko **układ wbudowany**. Wybranie innego szablonu i wyeksportowanie lub wysłanie PDF
zapamiętuje go dla oferty — dla każdego handlowca — a zmiana jest zapisywana w dzienniku audytu;
pozostawienie zaznaczonego szablonu domyślnego niczego nie zapamiętuje, więc późniejsza zmiana
szablonu domyślnego obejmie także tę ofertę. Zapamiętany szablon, który usunięto, nigdy nie jest
czyszczony automatycznie: okno o tym informuje i używany jest szablon domyślny. Zapamiętanie szablonu
nie zmienia oferty, jej wersji ani numeru wersji, więc nigdy nie koliduje ze zmianą wprowadzaną
przez współpracownika. **Zarządzaj szablonami PDF** w oknie prowadzi do szablonów ofert, jeśli
handlowiec może przeglądać szablony dokumentów.

**Język.** Okno oferuje języki, które ma wybrany szablon, z zaznaczonym domyślnym językiem kanału
sprzedaży oferty (dla oferty bez kanału — językiem domyślnego kanału systemowego). Według niego
drukowane są wszystkie teksty, liczby, kwoty i daty; w nim powstaje też e-mail.

**Co drukuje PDF.** **Bieżące** pozycje i ceny oferty, przygotowane dla handlowca, który o PDF prosi:
nagłówek (numer, data, data ważności, wersja), organizację nabywcy z NIP i adresem, klienta
składającego zapytanie i przypisanego opiekuna handlowego, uwagi do oferty, tabelę pozycji, pola
dodatkowe oferty widoczne dla klientów oraz teksty i logo dodane w szablonie. Pozycje bez
uzgodnionej ceny drukują pustą cenę, a sumy wymagające wszystkich cen są pomijane — według tej samej
zasady co ekrany oferty.

Tabela pozycji oferuje dla każdej pozycji pola: liczba porządkowa, nazwa produktu, wariant, SKU,
ilość, opakowanie, ilość w opakowaniach, **cena katalogowa**, cena proponowana przez klienta, cena
po rabacie, cena jednostkowa brutto, **rabat %**, **rabat na sztuce**, **rabat pozycji**,
**wartość wg cennika**, wartość netto, stawka VAT, VAT, wartość brutto, uwagi do pozycji oraz po
jednym polu dla każdego atrybutu produktu widocznego na stronie produktu (np. atrybutu *czas
realizacji* sklepu). Sumy: razem wg cennika, rabaty, razem netto, stawka VAT, VAT, razem brutto.

- **Cena katalogowa** to cena zapisana przy składaniu pozycji (zob. *Cena referencyjna*). **Rabat**
  istnieje tylko wtedy, gdy uzgodniona cena jest niższa od ceny katalogowej w tej samej walucie; w
  przeciwnym razie pola rabatu nie mają wartości, więc kolumna pokazywana *tylko gdy któraś pozycja
  ma wartość* znika, gdy nikt nie dostał rabatu.
- Pola wyróżnione pogrubieniem są **wewnętrzne**: klienci nie widzą ich w innych miejscach. Szablon
  może je drukować, a edytor oznacza każdą kolumnę, wpis szczegółów i sumę, która to robi.
- **VAT** jest liczony od sumy netto według jednej stawki VAT oferty, a `brutto = netto + VAT`, jak
  na ekranach oferty; kolumna VAT pozycji jest zaokrąglana dla każdej pozycji osobno i może różnić
  się od sumy VAT o grosz.
- SKU i atrybuty są odczytywane z katalogu w chwili tworzenia PDF; produkt usunięty w międzyczasie
  drukuje zapisaną nazwę bez SKU i atrybutów.

Układ wbudowany drukuje liczbę porządkową, produkt, SKU, ilość, opakowanie, cenę katalogową i rabat %
(obie tylko wtedy, gdy któraś pozycja ma rabat), cenę po rabacie, stawkę VAT, wartość netto i
brutto, uwagi pod pozycją oraz sumy — po angielsku i po polsku.

**Grupy w PDF.** Pogrupowana oferta drukuje każdą grupę, która ma pozycję, jako wiersz nagłówka — jej
nazwę i liczbę pozycji — potem jej pozycje, a następnie wiersz sumy częściowej dla każdej sumy
tabeli, policzonej po pozycjach grupy; pozycje bez grupy następują pod nagłówkiem **Pozostałe
pozycje** (*Other items*), a po nich jak dotąd sumy oferty. Liczba porządkowa biegnie 1…n przez
wszystkie grupy. Układ wbudowany i każdy szablon zapisany, zanim powstały grupy, drukują je bez
żadnej zmiany; szablon może zamiast tego drukować ofertę bez podziału albo grupować ją według pola
(ustawienie *Grupowanie* tabeli pozycji, opisane na stronie Szablonów dokumentów). Oferta bez grup
drukuje się dokładnie tak jak wcześniej. Gdy **Szablony dokumentów** są wyłączone, PDF nie powstaje,
jak opisano wyżej, a grupowanie na wszystkich ekranach działa bez zmian.

**Wysyłka.** *Wyślij PDF do klienta* podpowiada adres e-mail klienta, który złożył zapytanie.
Handlowiec może go usunąć i dodać inne adresy — dowolne poprawne adresy, najwyżej **5**, powtórzenia
są łączone — oraz opcjonalną wiadomość osobistą do 2 000 znaków. Każdy adres otrzymuje osobny e-mail
**PDF zapytania ofertowego** z PDF w załączniku, w wybranym języku. Temat i treść e-maila edytuje
się — dla każdego języka i kanału sprzedaży — albo wyłącza e-mail w **Szablonach e-maili**; jego
zmienne to `quote.number`, `quote.validUntil`, `customer.name`, `salesRep.name`, `salesRep.email`,
`channel.name` i `message`.

Udana wysyłka dodaje do **Historii** oferty wpis **Wysłano PDF** (kto wysłał, na jakie adresy, z
jakim szablonem, w jakim języku i z jaką wiadomością) oraz jeden wiersz
`quote_request.send_document` w dzienniku audytu — nigdy sam PDF. Klienci nie widzą go we własnej
historii. Gdy serwer poczty odrzuci jeden adres, a przyjmie inny, PDF pozostaje wysłany na
przyjęte adresy, okno wymienia odrzucone, a zapisywane są tylko przyjęte. Wysyłka jest odrzucana,
bez żadnego zapisu, gdy:

| Sytuacja | Odpowiedź |
| --- | --- |
| E-mail *PDF zapytania ofertowego* jest wyłączony, nie skonfigurowano serwera poczty albo e-mail nie jest skonfigurowany | `409 QUOTE_REQUEST_PDF_EMAIL_UNAVAILABLE` (`details.code`: `deactivated`, `no_transport`, `no_definition`) |
| PDF jest większy niż 10 MiB | `422 QUOTE_REQUEST_PDF_TOO_LARGE` |
| Serwer poczty odrzucił wszystkie adresy | `502 QUOTE_REQUEST_PDF_SEND_FAILED` |
| Ponad 10 wysyłek jednego administratora w ciągu minuty | `429 RATE_LIMITED` |

**API** (wszystkie trasy wymagają `rfqs:handle` i dostępu do oferty; `503 MODULE_DISABLED`, gdy
szablony dokumentów są wyłączone):

| Trasa | Cel |
| --- | --- |
| `GET /api/v1/admin/quote-requests/:id/document-templates` | szablony, zapamiętany szablon, szablon domyślny, języki, podpowiadany język i e-mail klienta |
| `PUT /api/v1/admin/quote-requests/:id/document-template` | zapamiętanie szablonu (`{ documentTemplateId }`, `null` usuwa wybór) |
| `GET /api/v1/admin/quote-requests/:id/pdf?templateId=&language=` | PDF; nagłówki `X-Document-Template-Id`, `-Version`, `-Source`, `-Missing` |
| `POST /api/v1/admin/quote-requests/:id/pdf/send` | `{ recipients, templateId?, language?, message? }` → `{ sent, failed, templateId, templateSource, requestedTemplateMissing }` |

Same szablony projektuje się w **Szablonach dokumentów**; edytor i tabelę pozycji opisuje strona
tego modułu.

## Ustawienia

Modułem sterują trzy ustawienia — wszystkie w grupie `quote_requests`, konfigurowane przez
istniejący moduł ustawień.

| Kod | Typ | Wartość domyślna | Działanie |
| --- | --- | --- | --- |
| `quote_requests.expiry_days` | integer | `0` | Wygaszanie zapytań w statusie Pending lub Created from admin po N dniach bez aktywności, o ile nie niosą oferty, która jest jeszcze ważna. Osobno dla każdego kanału sprzedaży: każde zapytanie podlega wartości swojego kanału, a `0` wyłącza kanał z wygaszania. Ustawienie wartości wygasza istniejące zaległości — zobacz *Zadania w tle*. |
| `quote_requests.show_add_to_quote_on_card` | boolean | `true` | Pokazuje lub ukrywa przycisk „Add to quote” na kartach produktów w storefroncie. |
| `quote_requests.show_add_to_quote_on_pdp` | boolean | `true` | Pokazuje lub ukrywa przycisk „Add to quote” na stronach produktów. |

## Zadania w tle

Zadanie wygaszania działa **co 30 minut** w każdym procesie, który obsługuje kolejki
(`BACKEND_ROLE=worker` albo `all`): to harmonogram zadań BullMQ na kolejce
`quote_requests.expiry.sweep`, który instaluje sam moduł. Gdy moduł jest wyłączony, żadne
uruchomienie się nie wykonuje.

### Które zapytania wygasza

Każde uruchomienie odczytuje `quote_requests.expiry_days` **dla każdego kanału sprzedaży** i
stosuje do zapytania wartość jego własnego kanału — zobacz
[Osobno dla każdego kanału sprzedaży](#per-sales-channel). `0` — wartość domyślna — wyłącza kanał
z wygaszania; przy `0` wszędzie zadanie nic nie robi. W przeciwnym razie zapytanie przechodzi do statusu `Expired`, gdy spełnione są
**wszystkie trzy** warunki:

1. **Jest nadal otwarte** — `Pending` albo `Created from admin`. Obejmuje to zapytanie czekające
   na pierwszą odpowiedź sprzedawcy i ofertę czekającą na kupującego.
2. **Nic się z nim nie działo przez `expiry_days` jego kanału.** Zegarem jest najnowszy wpis w historii
   zapytania — wpisy, które widzą obie strony. Zegar uruchamiają na nowo: złożenie zapytania,
   edycja przez klienta, rewizja albo notatka sprzedawcy. **Nie** uruchamiają go: otwarcie
   zapytania przez klienta (które jedynie oznacza rewizję jako widzianą), przypisanie do innego
   administratora ani żaden inny zapis, który nie dodaje wpisu do historii.
3. **Nie niesie oferty, która jest jeszcze ważna.** Gdy sprzedawca nadał ofercie termin ważności
   (`expiresInDays` → `expiresAt`), ten termin ma pierwszeństwo przed `expiry_days`: zadanie nigdy
   nie wygasza zapytania, dopóki termin jest przed nami, bez względu na to, jak długo nic się nie
   działo. Gdy termin minął albo sprzedawca go nie ustawił, reguła bezczynności działa jak dla
   każdego innego zapytania.

Zadanie nie wygasza zapytania *dlatego*, że minął termin ważności. Ten termin jest egzekwowany,
gdy kupujący akceptuje ofertę albo zamienia ją na zamówienie (`410`); sam z siebie nie zamyka
zapytania.

### Co robi jedno uruchomienie

- **Jedno zapytanie naraz.** Zmiana statusu, wpis `expired` w historii i rekordy powiadomień
  jednego zapytania są zatwierdzane razem, a `rfq.expired.v1` jest emitowane dopiero potem.
  Zapytanie, przy którym coś się nie powiodło, zostaje bez zmian; proces zostawia je w spokoju na
  dwie godziny i potem próbuje ponownie, więc zapytania, które stale się nie udają, nie
  wstrzymują pozostałych.
- **Nie może wejść w czyjąś odpowiedź.** Kupujący, który akceptuje albo odrzuca, oraz sprzedawca,
  który zatwierdza, zmienia, anuluje albo przypisuje, trzymają zapytanie na czas zapisu. Zadanie
  pomija trzymane zapytanie, a odpowiedź na zapytanie, które zadanie właśnie wygasiło, jest
  odrzucana z `409 VERSION_CONFLICT`: zachodzi dokładnie jedno z dwojga.
- **Ograniczona paczka.** Jedno uruchomienie wygasza najwyżej 500 zapytań, od najstarszych.
  Większe zaległości są nadrabiane w kolejnych uruchomieniach.
- **Bez rekordu powiadomienia dla wygaśnięcia, które jest starą wiadomością.** Zapytanie, które
  powinno było wygasnąć ponad 24 godziny przed uruchomieniem, które do niego dotarło, zostaje
  wygaszone, dostaje wpis w historii i jest ogłaszane jako `rfq.expired.v1` jak każde inne, ale
  nie powstaje dla niego żaden rekord powiadomienia. Czym dziś jest rekord powiadomienia, opisuje
  sekcja *Powiadomienia* poniżej.
- **Bezczynne uruchomienie jest ciche.** Gdy nic nie czeka na wygaszenie, uruchomienie nie wchodzi
  w zakres systemowy i nie zapisuje wiersza audytu `tenant.escape_hatch`.

### Włączenie wygasza zaległości

`expiry_days` nie działa od dnia, w którym zostało ustawione: działa na wszystko, co jest otwarte.
**Zmiana z `0` na `N` wygasza, w kolejnych uruchomieniach, każde otwarte zapytanie, z którym nic
się nie działo dłużej niż `N` dni** — w instancji, która przez rok działała z wartością `0`, może
to być większość otwartych zapytań. To samo dotyczy zmniejszenia wartości. Zapytania z ofertą,
która jest jeszcze ważna, pozostają nietknięte (warunek 3), a dla tych, które powinny były wygasnąć
ponad 24 godziny wcześniej, nie powstaje rekord powiadomienia.

Wydania do 0.104.0 włącznie opisywały to zadanie i nigdy go nie uruchamiały, więc instancja, w
której `expiry_days` jest już ustawione, trafi na te same zaległości przy pierwszych
uruchomieniach po aktualizacji. Ustaw `0` przed aktualizacją, aby najpierw przejrzeć otwarte
zapytania.

### Osobno dla każdego kanału sprzedaży {#per-sales-channel}

`expiry_days` można ustawić dla wszystkich kanałów i nadpisać dla jednego, a zadanie respektuje
jedno i drugie: zapytanie podlega wartości ustalonej dla kanału sprzedaży, w którym je złożono.
Kanał ustawiony na `0` jest wyłączony z wygaszania, niezależnie od innych kanałów, a kanał z
własną liczbą dni podlega właśnie jej. Zapytanie bez kanału — złożone, zanim zapytania zaczęły go
zapisywać, albo przez narzędzie, które go nie ustawiło — podlega wartości kanału domyślnego.

Wpis `expired` w historii zapisuje wartość, która miała zastosowanie do zapytania.

Do czasu tej poprawki zadanie odczytywało jedną wartość, kanału domyślnego, i stosowało ją do
każdego zapytania. Instancja, która miała już inną wartość ustawioną dla jakiegoś kanału, zobaczy
więc jej działanie przy pierwszych uruchomieniach po aktualizacji — kanał z niższą wartością
wygasi swoje zaległe, nieaktywne zapytania, a kanał ustawiony na `0` przestanie wygaszać.

## Model danych

Trzy tabele uzupełniające podstawowe `quote_requests` i `quote_request_items`:

- `quote_request_revisions` — pełna migawka przy każdej zmianie.
- `quote_request_events` — historia, do której można tylko dopisywać (jeden wiersz na każde
  przejście stanu lub zmianę, z ładunkiem w postaci unii dyskryminowanej).
- `quote_request_notification_events` — jeden wiersz na parę odbiorca × kanał; unikalność na
  `(quote_request_id, source_event_id, recipient*, channel)` sprawia, że ponowienia są
  idempotentne.

`quote_request_items` przechowuje zapisaną cenę referencyjną w `reference_unit_price`,
`reference_currency` i `reference_captured_at` — wszystkie trzy ustawione albo wszystkie trzy
`null`.

Blokadę negocjacji cen przechowują dwie tabele: `quote_request_org_policies` (jeden wiersz na
organizację, która ma ustawioną wartość) i `quote_request_account_policies` (jeden wiersz na konto
klienta z nadpisaniem; `null` = jak organizacja). Brak wiersza oznacza wartość domyślną. Usunięcie
organizacji lub konta klienta usuwa jego wiersz i nic poza nim — żadne zapytanie ofertowe nie
odwołuje się do żadnej z tych tabel.

`quote_requests.document_template_id` przechowuje szablon PDF zapamiętany dla oferty (zob. *PDF
oferty*) albo `null`. Nie ma klucza obcego: szablon należy do modułu szablonów dokumentów, a usunięty
szablon zostawia identyfikator na miejscu, więc eksport wraca do szablonu domyślnego i o tym
informuje. Zapis zmienia `updated_at`, ale nie `version`. Wiersz `quote_request_events` typu
`pdf-sent` zapisuje każdą udaną wysyłkę *Wyślij PDF do klienta*; jest widoczny tylko w historii w
panelu administracyjnym.

`quote_request_item_groups` przechowuje grupy pozycji oferty — `name` i `position` każdej grupy,
usuwane razem z zapytaniem ofertowym. `quote_request_items` przechowuje `group_id` każdej pozycji
(`null` = bez grupy; usunięcie grupy ustawia go na `null`) i jej `position` w obrębie sekcji. Migawka
pozycji w każdej rewizji zapisuje także grupę i miejsce pozycji, więc historia i porównanie klienta
opisują grupowanie tak, jak pokazano je klientowi. Oferta utworzona, zanim powstały grupy, jest
odczytywana jako niepogrupowana, z pozycjami w pierwotnej kolejności.

`quote_request_list_saved_views` przechowuje zapisane widoki listy (zob. *Zapisane widoki*). Jest
globalna dla platformy, a nie przypisana do organizacji: przechowuje wartości filtrów, nigdy
zapytania ofertowe, i nie jest usuwana, gdy moduł zostaje wyłączony.

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

Każde przejście stanu **zapisuje**, kogo należy powiadomić: `RfqNotificationService` zapisuje po
jednym wierszu na odbiorcę i kanał (`email`, `in_app`) w `quote_request_notification_events`, ze
statusem `queued` — klienta przy działaniach administratora, opiekunów handlowych i administratorów
platformy przy działaniach klienta, obie strony przy wygaśnięciu. Ograniczenie unikalności w tej
tabeli pilnuje, by na każdą trójkę (przejście, odbiorca, kanał) przypadał jeden wiersz.

**Tych wierszy na razie nic nie doręcza.** Żaden proces nie odczytuje tej tabeli, więc dla żadnego
przejścia zapytania ofertowego nie jest wysyłany e-mail ani powiadomienie na koncie; wiersze
pozostają w statusie `queued`. Są zapisem, z którego korzystałby proces doręczający. Jedyny e-mail,
który ten moduł wysyła, to jawna akcja *Wyślij PDF do klienta* (zob. *PDF oferty*), doręczana, gdy
handlowiec czeka, i zapisywana w historii oferty.

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
| `rfq.expired.v1` | Zadanie wygaszania (`RfqExpiryWorker.sweep()`) przenosi zapytanie ofertowe do statusu `Expired`. Jedno zdarzenie na zapytanie. Nic innego go nie wysyła, więc występuje tylko tam, gdzie to zadanie działa. | `rfqId`, `organizationId` |

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

## Pozycje na ekranie tworzenia zapytania ofertowego

Ekran panelu administracyjnego, na którym tworzy się zapytanie ofertowe w imieniu klienta
(`/quote-requests/new`, wysyłany jako `POST /api/v1/admin/quote-requests`), dodaje produkty na dwa
sposoby:

- **Przeglądaj produkty** otwiera wspólną przeglądarkę produktów panelu administracyjnego na
  zakładce **Aktywne**: katalog podzielony na strony, z zakładkami statusów i ich licznikami,
  filtrem typu i wyszukiwaniem po SKU, slugu lub nazwie. Zaznaczenie przetrwa zmianę strony,
  rozmiaru strony i filtrów, a **Dodaj N** dodaje każdy zaznaczony produkt jako pozycję o ilości 1
  — najwyżej 200 naraz. Produkty robocze i nieaktywne można dodać; produkty nadrzędne typu grouped
  i bundle są widoczne z powodem i nie da się ich zaznaczyć. Produkt, który już jest w zapytaniu,
  można dodać ponownie jako osobną pozycję — na przykład, by umieścić go w drugiej grupie.
- **Szybkie dodawanie po nazwie lub SKU**, obok, dopisuje jeden produkt według tych samych zasad.

Bez uprawnienia `catalog:read` obie te opcje są nieaktywne i każda pokazuje podpowiedź.

Każda pozycja pokazuje nazwę i SKU produktu, edytowalną ilość (liczbę całkowitą), edytowalną
uzgodnioną cenę jednostkową i akcję usunięcia.

**Uzgodniona cena jednostkowa jest wstępnie wypełniana bieżącą ceną klienta** przez
`POST /api/v1/admin/price-books/resolve` dla wybranego klienta i ilości w pozycji, przy
najwyżej czterech żądaniach naraz. Cena jest wypełniana dopiero po wybraniu klienta z organizacją —
pozycje dodane wcześniej są wtedy uzupełniane — a odpowiedź jest stosowana tylko wtedy, gdy nadal
pasuje do produktu, ilości i klienta pozycji. Gdy żadna cena nie zostanie wyznaczona, pole zostaje
puste. **Cena wpisana ręcznie nigdy nie jest nadpisywana**: zmiana ilości jej nie zmienia. Cena
wypełniona wstępnie podąża natomiast za ilością: jest wyznaczana ponownie dla każdej nowej poprawnej
ilości i czyszczona, gdy tylko ilość przestaje być liczbą całkowitą równą 1 lub większą — nie
odpowiada już wtedy żadnej ilości — a po poprawieniu ilości jest wyznaczana ponownie. Zmiana
klienta czyści każdą cenę, która nie została wpisana ręcznie, i wyznacza ją ponownie dla nowego
klienta, więc taka cena może stać się pusta.

**Niekompletna pozycja blokuje zapytanie zamiast z niego znikać.** Pozycja bez uzgodnionej ceny
albo z ilością, która nie jest liczbą całkowitą równą 1 lub większą, jest oznaczona, a **Utwórz
zapytanie ofertowe** pozostaje nieaktywne, dopóki nie zostanie poprawiona albo usunięta; wysyłana
jest każda pozycja widoczna na ekranie. Suma bieżąca liczy pozycje, które mają i poprawną ilość, i
cenę. Klient bez organizacji nadal wywołuje dotychczasowe ostrzeżenie, bo zapytanie ofertowe jej
wymaga.

## Panele na ekranie zapytania ofertowego

Strefa panelu administracyjnego `quote_request.detail.after` jest osadzona raz, na końcu ekranu
zapytania ofertowego, pod kartą z jego zakładkami, i przekazuje wkładowi `{ quoteRequestId }`.
Moduł dodaje panel, deklarując `zoneComponent('quote_request.detail.after', …)` we własnych
wkładach do panelu administracyjnego; ten moduł nie wymienia żadnego z nich i żadnego nie
importuje. Gdy nikt nic nie wnosi — nie ma takiego modułu, moduł jest wyłączony albo osoba nie ma
uprawnienia wymaganego przez panel — strefa nie renderuje niczego, a ekran jest dokładnie taki jak
bez niej. Moduł CRM wnosi szansę, z którą zapytanie ofertowe jest powiązane.

## Wyszukiwanie globalne

Wyszukiwanie globalne w panelu administracyjnym (paleta poleceń, ⌘K / Ctrl+K) znajduje zapytania ofertowe. Ten moduł udostępnia poniższe pola; to, które z nich są używane, wybiera się na ekranie konfiguracji wyszukiwania globalnego.

| Pole | Przeszukiwane domyślnie |
| --- | --- |
| Numer zapytania ofertowego | tak |
| Nazwa organizacji | tak |
| Imię i nazwisko lub e-mail klienta | tak |
| Uwagi klienta | nie |

Wynik pokazuje numer, organizację, datę złożenia i status, a jego wybranie otwiera zapytanie ofertowe. Zapytania ofertowe pojawiają się dla roli z uprawnieniem `rfqs:handle`, z taką samą widocznością organizacji jak na liście zapytań ofertowych.
