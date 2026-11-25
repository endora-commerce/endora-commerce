---
title: Faktury
description: Faktury VAT, faktury proforma i faktury korygujące wystawiane do zamówień, z plikami PDF renderowanymi z szablonów dokumentów
---

# Faktury (`invoices`)

Wystawia faktury VAT, faktury proforma i faktury korygujące do zamówienia oraz renderuje ich pliki
PDF na żądanie z szablonu dokumentu faktury. Obok nich wyświetlane są dokumenty sprzedaży
zaimportowane z ERP (`origin: erp_import`, w tym dokumenty WZ).

## API publiczne

Trasy administracyjne są chronione własnymi kodami modułu: `invoices:read` do odczytu i pobierania,
`invoices:write` do wystawiania, ponownego generowania i wysyłki e-mailem.

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/admin/invoices` | administrator (`invoices:read`) | Lista z `filter[status]`, `filter[kind]`, `filter[orderId]`, `filter[orderNumber]`, `filter[salesChannelId]`, `filter[issuedFrom]` / `filter[issuedTo]`, `filter[totalMin]` / `filter[totalMax]`; domyślnie 50, najwyżej 200; od najnowszych, stronicowana nieprzezroczystym `pagination.cursor` przekazywanym z powrotem jako `?cursor=` |
| `GET /api/v1/admin/invoices/:id` | administrator (`invoices:read`) | Szczegóły faktury |
| `GET /api/v1/admin/invoices/:id/pdf` | administrator (`invoices:read`) | Pobranie pliku PDF renderowanego na żądanie |
| `POST /api/v1/admin/orders/:orderId/invoices` | administrator (`invoices:write`) | Wystawienie faktury VAT albo proformy (`kind`, opcjonalnie `saleDate`, `paymentDueDate`); `201` z fakturą i wynikiem wysyłki e-maila |
| `POST /api/v1/admin/invoices/:id/regenerate-pdf` | administrator (`invoices:write`) | Ponowne renderowanie, które ujawnia błąd szablonu; niczego nie zapisuje |
| `POST /api/v1/admin/invoices/:id/send-email` | administrator (`invoices:write`) | (Ponowna) wysyłka e-maila z fakturą, opcjonalnie z wyborem `mode` (`attachment` / `link`) |
| `GET /api/v1/orders/:id/invoices` | klient | Gotowe faktury zamówienia, które klient może zobaczyć |
| `GET /api/v1/orders/:id/invoices/:invoiceId/pdf` | klient | Pobranie jednej z nich; `404 NOT_FOUND`, dopóki nie jest `ready` |
| `GET /api/v1/account/organization/invoices` | klient | Dokumenty sprzedaży organizacji zaimportowane z ERP, wraz z załącznikami |
| `GET /api/v1/orders/:id/invoice` | klient | Pobieranie pojedynczej faktury, rejestrowane przez moduł `orders`: najnowszy dokument zamówienia rodzaju `invoice` w stanie `ready`, renderowany z szablonu faktury. Proforma ani korekta nie są tu nigdy zwracane, więc `404 INVOICE_NOT_READY`, dopóki żadna faktura nie jest `ready`. Pozostałe dokumenty są pod `…/invoices/:invoiceId/pdf` |

## Generowanie

Fakturę wystawia operator albo system: gdy zamówienie osiągnie status wskazany w
`invoices.auto_issue.trigger_status` (domyślnie pusty, czyli tylko wystawianie ręczne), subskrybent
`order.status_changed.v1` (`services/auto-issue-reactor.ts`) wystawia jedną fakturę VAT na
zamówienie. Działa idempotentnie i bez gwarancji: nieudana próba automatyczna jest zapisywana w logu
i pozostawia możliwość wystawienia ręcznego. Wystawienie zapisuje kopię pozycji zamówienia w
`invoice_lines`, pobiera numer i emituje `invoice.issued.v1` (korekta emituje
`invoice.corrected.v1`). Przy włączonym `invoices.email.send_on_issue` (domyślnie wyłączone) wysyłany
jest e-mail z fakturą, z plikiem PDF w załączniku albo z linkiem do panelu klienta
(`invoices.email.delivery_mode`, domyślnie `attachment`). Plik PDF nie jest przechowywany: każde
pobranie jest renderowane z szablonu dokumentu (zobacz *Szablony PDF*).

### Ceny jednostkowe i wartości pozycji

Pozycja faktury niesie **cenę jednostkową netto pozycji zamówienia z maksymalnie czterema miejscami
po przecinku** (`invoice_lines.unit_net_price`, `numeric(14,4)`), a jej wartość netto to cena
jednostkowa × ilość zaokrąglona raz, połówkowo w górę, do dwóch miejsc — własna wartość netto
pozycji zamówienia. Kolumna *Cena netto* w PDF pokazuje cenę jednostkową z jej znaczącymi miejscami,
do czterech (0,0125), a z dwoma, gdy trzecie i czwarte są zerami; kolumny wartości i sumy mają dwa
miejsca. Polska faktura może podawać cenę jednostkową z taką dokładnością: ustawa o VAT wymienia
cenę jednostkową netto, nie określając liczby miejsc po przecinku.

### Co faktura VAT zapisuje jako zapłacone i kiedy nie jest wystawiana

Faktura VAT zapisuje jako zapłacone to, co za zamówienie otrzymano i zatrzymano: każdą pobraną
próbę płatności pomniejszoną o wszystkie zwroty. Zamówienie oznaczone jako zapłacone bez pobranej
płatności (potwierdzony przelew) albo przy braku modułu `payments` otrzymano w zapisanej kwocie
całkowitej. Zamówienie z odroczonym terminem płatności (kredyt kupiecki) w chwili fakturowania jest
z założenia niezapłacone i nic z niego nie liczy się jako zapłacone.

Każdy zwrot liczy się raz, niezależnie od tego, jak go wykonano:

- zwrot przez bramkę płatności — tak, jak zapisał go moduł `payments`;
- zwrot rozliczony **przelewem** (każde zamówienie nieopłacone przez bramkę — przelew wykonuje
  operator) albo **uznaniem limitu kredytowego** — tak, jak zapisał go zwrot. Zwrot, który wciąż
  czeka na wykonanie przez człowieka, się nie liczy;
- zamówienie, które operator oznaczył jako **zwrócone**, zwrócono w całości tego, co za nie
  otrzymano: w całej kwocie, gdy nie pobrano płatności, a w przeciwnym razie w pobranej kwocie —
  to zwrot rozliczony ręcznie, na przykład po tym, jak bramka zgłosiła kwotę, której płatność nie
  mogła zapisać. Oznaczenie nigdy nie jest dodawane do zapisanych już zwrotów: zwrot przez bramkę
  zapisany na płatności liczy się raz.

Gdy moduł `returns` jest wyłączony, odejmowane są tylko zwroty zapisane przez `payments`.

Zamówienie **zwrócone w całości przed wystawieniem faktury** — zwroty są równe temu, co otrzymano,
i pokrywają całą kwotę zamówienia — nie jest fakturowane: nie ma już sprzedaży do udokumentowania.
Wystawienie zwraca `422 INVOICE_ORDER_REFUNDED` i nie pobiera numeru; automatyczne wystawianie
pomija zamówienie i zapisuje powód w logu. Zamówienie zwrócone tylko częściowo jest fakturowane,
z zatrzymaną kwotą jako zapłaconą. Zamówienie, którego **towary zwrócono w całości** przed
wystawieniem faktury — każda pozycja produktu wróciła w rozliczonych zwrotach, nic z nich nie
zatrzymano, a dostawa ani dopłata za płatność nie zostały zatrzymane — traktowane jest tak samo, niezależnie od tego, czy pieniądze
zostały już wypłacone (zwrot wciąż czeka na wykonanie przez człowieka albo na potwierdzenie bramki
płatności). Gdy dostawa lub dopłata zostaje zatrzymana, faktura jest wystawiana tylko z tą pozycją.
Odstąpienie konsumenta od całego zamówienia zwraca obie (zob. *Zwroty*), więc zamówienie B2C
zwrócone w całości zwykle nie zostawia niczego i wystawienie jest odrzucane. Dostawa obniżona przez
operatora do ceny zwykłej zostawia różnicę, która trafia na fakturę sama.

Faktura wystawiona **po rozliczeniu zwrotu** obejmuje tylko to, co kupujący zatrzymał: nie ma
jeszcze faktury do skorygowania, więc sama faktura dokumentuje sprzedaż, która pozostała. Każda
pozycja zamówienia jest fakturowana w zamówionej ilości pomniejszonej o ilość z rozliczonych zwrotów
zamówienia (rodzaju *zwrot*, rozliczonych zwrotem pieniędzy albo środkami na koncie), niezależnie od
tego, czy pieniądze zostały już wypłacone; pozycja zwrócona w całości jest pomijana. Wymiana,
naprawa i reklamacja nie zmieniają żadnej pozycji. Pozycje dostawy i dopłaty za płatność są takie
jak w zamówieniu, pomniejszone o to, co z nich zwróciło odstąpienie konsumenta; pozycja, z której
nic nie zostało, jest pomijana. Pozycja rabatu obejmuje tylko część przypadającą na zatrzymane towary: rabat
zamówienia pomniejszony o część, którą rozliczone zwroty oddały wraz ze zwrotem pieniędzy, i jest
pomijana, gdy nic z niego nie zostaje. VAT nadal liczy się dla każdej stawki od sumy wartości netto,
więc faktura co do grosza równa się temu, co pozostało zapłacone. Faktura proforma obejmuje te same
zatrzymane pozycje i nie jest odrzucana dla zamówienia zwróconego w całości. Gdy moduł `returns` jest
wyłączony, każda pozycja jest fakturowana w zamówionej ilości.

**Kwota zatrzymana przy zwrocie** — operator zatwierdził mniej niż domyślny zwrot, na przykład aby
zatrzymać opłatę manipulacyjną — jest częścią ceny towarów według ich stawki VAT (decyzja właściciela
z 2026-11-07). Faktura nalicza ją w osobnej pozycji *Kwota zatrzymana przy zwrocie: produkt*
(`line_kind: retained`), jednej dla każdej pozycji zamówienia, z której coś zatrzymano, według stawki
VAT tej pozycji. Jej kwota brutto to to, co zatrzymano; jej wartość netto to ta, przy której wiersz
VAT stawki równa się kwocie brutto zatrzymanych towarów powiększonej o tę kwotę, według tej samej
metody liczenia VAT dla każdej stawki. Na przykład z 3 × 10,00 netto przy 23 % wraca jedna sztuka,
jej domyślny zwrot to 12,30, a zatwierdzono 10,00: faktura obejmuje dwie zatrzymane sztuki i *Kwotę
zatrzymaną przy zwrocie* 1,87 netto i 2,30 brutto, a wiersz 23 % to 41,87 netto i 9,63 VAT — 51,50,
czyli to, co pozostało zapłacone. Dla nielicznych kwot, których żadna wartość netto nie daje według
tej reguły (0,03 przy 23 %), używana jest najbliższa wartość netto, a wiersz różni się o 0,01.
Zatrzymana kwota nie niesie części rabatu zamówienia: zwrócone towary oddają całą swoją część.
Zamówienie, którego wszystkie pozycje wróciły, jest fakturowane, gdy coś z nich zatrzymano, i
obejmuje tylko te pozycje. Gdy reklamacja zwróciła już część wartości pozycji, a zwrot tej pozycji
został z tego powodu obniżony, różnica jest fakturowana tak samo, a zwrot z reklamacji nadal jest
widoczny jako kwota do zapłaty (poniżej).

**Reklamacja, za którą zwrócono pieniądze przed wystawieniem faktury**, jest obecnie widoczna na
fakturze jako kwota do zapłaty: faktura obejmuje towary w całości, a zwrot z reklamacji pomniejsza
to, co zapłacono.

### Faktury korygujące

Zwrot albo reklamacja rozliczone zwrotem pieniędzy lub środkami na koncie **po** wystawieniu faktury
dostają fakturę korygującą (`kind: correction`), jedną na sprawę. Korekta uznaje kwoty brutto
według stawki VAT pozycji faktury, którą koryguje, i nigdy więcej niż to, co z faktury pozostało.
Wymiana albo naprawa nie przenosi pieniędzy i nie powoduje korekty.

**Zwrot** uznaje towary, które wróciły. Na fakturze wystawionej przy metodzie VAT liczonego dla każdej
stawki korekta wynika z tego, co faktura zatrzymuje:

- Gdy sprawa zwraca kwotę domyślną, faktura zatrzymuje w każdej stawce dokładnie VAT od sumy wartości
  netto zatrzymanych ilości: te same kwoty, które pokazałaby faktura wystawiona po zwrocie. Na
  przykład zwrot jednej sztuki z 3 × 10,01 netto przy 23 % (36,94 brutto) zwraca 12,32, a korekta
  uznaje 10,01 netto i 2,31 VAT, więc zostaje 20,02 netto i 4,60 VAT.
- Gdy operator zatwierdził niższą kwotę, faktura zatrzymuje resztę kwoty brutto w tej stawce,
  podzieloną na netto i VAT według tej samej reguły. Dla niektórych kwot żadna wartość netto nie daje
  dokładnie tej kwoty brutto (na przykład 6,00 z 12,32 przy 23 %). Wtedy sama korekta stosuje
  regułę, a to, co zatrzymuje faktura, może różnić się od niej o 0,01 w tej stawce aż do następnej
  korekty. Pieniądze zawsze zgadzają się co do grosza.
- Część rabatu zamówienia, która przypadała na zwrócone towary, jest uznawana z powrotem w pozycji
  0 %.
- Dostawa i dopłata za płatność są uznawane tylko przy odstąpieniu konsumenta: zwrocie, który
  zamyka odstąpienie od zamówienia B2C. Każda jest uznawana w osobnej pozycji (`lineKind`
  `delivery` albo `payment_surcharge`), nazwanej jak pozycja faktury i z jej stawką VAT (dziś 0 %),
  na kwotę zwróconą w rozliczeniu. Po odstąpieniu od całego zamówienia faktura po korekcie wynosi
  zero. Korekta, która uznałaby więcej z opłaty, niż faktura jeszcze za nią nalicza, jest odrzucana
  z `422 INVOICE_CORRECTION_EXCEEDS_CHARGE_REMAINING` (`details.code` to opłata, `delivery` albo
  `payment_surcharge`, wraz z `remaining` i `currency`), zanim zostaną przekazane
  jakiekolwiek pieniądze. Zwroty klientów firmowych nigdy ich nie uznają.

**Reklamacja** rozliczona pieniędzmi jest **obniżką ceny**: kupujący zatrzymuje towary, więc obniża się
ich cena, a żadna ilość nie wraca. Pozycja korekty nazywa się *Obniżka ceny (reklamacja RMA-…):
produkt* i ma ilość 0. Jej wartość netto to obniżka, a cena jednostkowa to obniżka rozłożona na
sztuki, które nadal są na fakturze. Nie uznaje rabatu, bo rabat zostaje przy zatrzymanych towarach,
i nie zmniejsza ilości, od której liczony jest późniejszy zwrot tej samej pozycji. Dla integracji,
która czyta pozycje korekty: pozycja towarowa z ilością 0 to obniżka ceny.

Korekta, która uznałaby w jednej stawce VAT więcej towarów, niż faktura nadal w niej nalicza, jest
odrzucana z `422 INVOICE_CORRECTION_EXCEEDS_RATE_REMAINING` (`details`: `taxRate`, `vatRatePercent`,
`remaining`, `currency`), zanim zostaną przeniesione jakiekolwiek pieniądze.

Pozostałe odmowy wystawienia faktury i korekty (zgłoszenie #633; każda była wcześniej
`VALIDATION_FAILED`):

| Odmowa | Kod | `details` |
| --- | --- | --- |
| NIP sprzedawcy i dane firmy nie są skonfigurowane | `422 INVOICE_SELLER_DATA_MISSING` | `setting` |
| Korekta w innej walucie niż korygowana faktura | `422 INVOICE_CORRECTION_CURRENCY_MISMATCH` | `requestedCurrency`, `invoiceCurrency`, `originalInvoiceId` |
| Suma korekty wyższa niż to, co uznają jej pozycje i opłaty, albo (`details.code: below_charges`) niższa niż same opłaty | `400 INVOICE_CORRECTION_TOTAL_EXCEEDS_LINES` | `total`, `linesTotal`, `currency` |

**Kwota do zapłaty** to kwota brutto pomniejszona o to, co zapłacono, i nigdy nie jest ujemna. Gdy
zapłacono więcej niż kwota brutto, do zapłaty jest 0, a faktura podaje różnicę jako **nadpłatę**
(`overpayment` w API, wiersz *Nadpłata* na ekranie panelu i na PDF — etykieta jest ustawieniem
bloku podsumowania i tam można ten wiersz ukryć).

## Zamówienia opłacane przez płatnika powiązanego {#orders-paid-by-a-related-payer}

Zamówienie złożone z płatnikiem powiązanym (moduł *Related payers*) ma migawkę danych rozliczeniowych
płatnika, więc faktura jest wystawiana na płatnika. Rejestr faktur zapisuje ją przy płatniku —
`payerOrganizationId ?? organizationId` — a zasięg listy faktur w panelu i jej filtr
*Organizacja na fakturze* używają tego samego wyrażenia, więc taka faktura widnieje przy płatniku, a
nie przy kupującym. Płatnik pobiera ją przez swój widok zamówienia tylko do odczytu.

## Encje

`Invoice` (numer, `kind ∈ {invoice, proforma, correction, wz}`, `status ∈ {pending, ready, cancelled}`,
`origin ∈ {platform, erp_import}`, daty wystawienia, sprzedaży i płatności, waluta i sumy; niezmienna
od statusu `ready`, zmieniana wyłącznie korektą).

`InvoiceLine` (niezmienny zapis jednej pozycji z chwili wystawienia). Jej `lineKind`
mówi, czym jest pozycja: `goods`, `delivery`, `payment_surcharge` lub `discount` na
fakturze i fakturze proforma; `price_reduction` jest zarezerwowane dla pozycji korekty.
Zapisuje go każda pozycja dokumentu wystawionego od tego wydania, także pozycje dostawy
i dopłaty za płatność ze stawką 0 %; nie zmienia żadnej kwoty. Pozycja wystawiona
wcześniej oraz pozycje towarów i rabatu w korekcie mają `null` i są rozróżniane jak dotąd: po tym,
czy wskazują pozycję zamówienia, i po znaku kwoty. Uznana w korekcie dostawa lub dopłata ma
`delivery` albo `payment_surcharge`.

## Numeracja

Dwie cechy numeru faktury pozornie sobie przeczą — obie są zamierzone:

- **kolejny numer** jest pobierany osobno dla każdej trójki `(kanał sprzedaży, rodzaj, rok)`, bez
  luk, z blokadą wiersza — `invoice_number_counters`;
- **numer faktury** jest unikalny w całej platformie — `invoices_number_unique`.

Pierwsze w drugie zamienia wzorzec zapisany w ustawieniu dla każdego rodzaju dokumentu, które może
mieć wartość osobną dla kanału sprzedaży:

| Rodzaj | Ustawienie | Wartość domyślna |
| --- | --- | --- |
| Faktura VAT | `invoices.numbering.invoice.pattern` | `FV {seq}/{channel}/{YYYY}` |
| Faktura proforma | `invoices.numbering.proforma.pattern` | `PRO {seq}/{channel}/{YYYY}` |
| Korekta | `invoices.numbering.correction.pattern` | `KOR {seq}/{channel}/{YYYY}` |

### Znaczniki

| Znacznik | Zamieniany na |
| --- | --- |
| `{seq}` | pobrany kolejny numer |
| `{seq:N}` | to samo, uzupełnione zerami do szerokości `N` |
| `{channel}` | `code` kanału sprzedaży, wielkimi literami |
| `{YYYY}` / `{YY}` | rok wystawienia, 4 lub 2 cyfry |
| `{MM}` | miesiąc wystawienia |

Reszta to stały tekst. `code` kanału jest niezmienny i unikalny, więc numeru już wygenerowanego z
`{channel}` nie unieważni zmiana nazwy kanału; po obu stronach znacznika zostaw separator, bo
`FV {channel}{seq}` zaciera granicę między dwoma polami o zmiennej długości i daje `FV A12` zarówno
dla (`a1`, 2), jak i (`a`, 12).

### Trzy odmowy i która z nich jest gwarancją

Ponieważ numeracja kolejna jest osobna dla każdego kanału, a numer faktury nie, dwa kanały, których
wzorce mogą dać ten sam ciąg znaków, to kolizja, która tylko czeka, by się wydarzyć. Między nią a
dokumentem trafiającym do klienta stoją trzy warstwy:

1. **Domyślny wzorzec zawiera `{channel}`**, więc utworzenie kanału sprzedaży nie przygotowuje
   kolizji. Domyślny kanał systemowy jest raz, przy starcie, przypisywany do historycznego wzorca
   `FV {seq}/{YYYY}` — seria numerów istniejącego wdrożenia nie zmienia postaci — i tylko dopóki
   nikt nie skonfigurował tego ustawienia.
2. **`400 INVOICE_NUMBER_PATTERN_COLLIDES`** przy zapisie ustawień, ze wskazaniem kanału, z którym
   wzorzec koliduje. Odrzuca *możliwą* kolizję: przy zapisie konfiguracji nic jeszcze nie jest
   zagrożone, więc ostrożna odmowa kosztuje tylko jedną poprawkę.
3. **`409 INVOICE_NUMBER_ALREADY_ISSUED`** przy wystawianiu, ze wskazaniem kanału, który już ma
   ten numer. To jest gwarancja — jedyny punkt kontroli, przez który przechodzi każdy numer — i
   odrzuca tylko *rzeczywisty* duplikat. Transakcja jest wycofywana, więc pobrany numer kolejny
   wraca i nie powstaje luka.

Wdrożenie, które już ma kolidującą konfigurację, jest zgłaszane przy starcie, raz dla każdej
kolidującej pary, i **nie jest blokowane**: dającą się naprawić pomyłkę w konfiguracji faktur nie
można zamieniać w awarię storefrontu.

## W dzienniku audytu

Wystawienie faktury i wystawienie korekty to każde jeden wpis w dzienniku audytu całej
platformy (`invoice.issued`, `invoice.corrected`). Ten dziennik czyta każdy, kto ma
`audit_log:read`, bez względu na to, które organizacje widzi, dlatego wpis nazywa dokument i nie
zawiera żadnej kwoty: jego numer, rodzaj, zamówienie, kanał sprzedaży, a przy korekcie — fakturę
pierwotną, liczbę pozycji obniżających cenę i rodzaje skorygowanych opłat (`chargeKinds`). Kwoty
są na samej fakturze. Wpisy zapisane przed tą zmianą zachowują kwoty, z którymi zostały zapisane.

## Punkty rozszerzenia

- **Schemat numeracji** — `services/invoice-number-generator.ts` zamienia wzorzec na numer
  (`formatInvoiceNumber`) i pobiera numer kolejny; `services/invoice-number-collisions.ts`
  rozstrzyga, czy dwa kanały mogą dać ten sam ciąg znaków. Dodaj znacznik w pierwszym pliku, a
  zestaw przykładów sprawdzanych w drugim go uwzględni.
- **E-fakturowanie** — dla KSeF, Peppol i podobnych systemów podłącz adapter wysyłki, który obsługuje
  zdarzenia `invoice.issued.v1`.

## Szablony PDF

Układy PDF faktur projektuje się w **Szablonach dokumentów → Faktura** (otwiera je zakładka
**Szablony** w **Fakturach**; dawne adresy `/invoices/templates` przekierowują tam). Paletę szablonu
faktury tworzą bloki faktury — nagłówek, strony, pozycje, podsumowanie VAT, sumy, uwagi, odstęp,
separator, logo, stopka — oraz bloki, które dla faktur udostępniają inne zainstalowane moduły (sekcja
KSeF). Każdy PDF faktury — pobierany przez administratora i przez klienta, generowany ponownie oraz
dołączany do e-maila z fakturą — powstaje z domyślnego szablonu faktury kanału sprzedaży faktury,
a w jego braku z domyślnego szablonu dla wszystkich kanałów, a w jego braku z wbudowanego układu
faktury. PDF faktur jest drukowany po polsku.

Numer KSeF jest drukowany dokładnie raz: przez umieszczony blok, który go drukuje, a w przeciwnym razie
przez nagłówek.

Dawne API administracji szablonami faktur (`/api/v1/admin/invoice-templates*`) zostało wycofane;
szablonami faktur zarządza się przez `/api/v1/admin/document-templates`. Fakturowania nie można
włączyć bez Szablonów dokumentów, a Szablonów dokumentów nie można wyłączyć, dopóki fakturowanie jest
włączone.

## Po scaleniu organizacji {#when-organizations-are-merged}

Faktury duplikatu przechodzą do organizacji, która zostaje. Wystawiony dokument, z nazwą
nabywcy, NIP-em i adresem w wydrukowanej postaci, nie zmienia się. Zobacz *Scalanie
zduplikowanych organizacji* w dokumentacji modułu Organizacje.
