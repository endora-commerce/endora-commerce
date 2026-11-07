---
title: Faktury
description: Generowanie faktur i faktur proforma w PDF oraz powiązanie z plikami
---

# Faktury (`invoices`)

Generuje faktury proforma i faktury końcowe w PDF, rejestruje je w module `assets` i wiąże z
zamówieniem, z którego pochodzą.

## API publiczne

Lista w panelu administracyjnym jest chroniona przez `orders:read`.

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/orders/:id/invoice` | klient | Pobranie faktury PDF (404 `INVOICE_NOT_READY`, dopóki status nie jest `ready`; potem odpowiedź binarna z odpowiednim Content-Type). Administrator pobiera fakturę ponownie przez ten sam endpoint, pod adresem storefrontu. |
| `GET /api/v1/admin/invoices` | administrator | Lista wszystkich faktur z `filter[status]` / `filter[orderId]`; domyślnie 50, najwyżej 200 |

## Generowanie

`invoice-service.ts#generate()` uruchamia się po `order.confirmed`: pobiera zamówienie, pozycje i
zapisaną kopię adresu kupującego, generuje PDF lekkim mechanizmem bez ciężkich zależności, zapisuje
plik przez moduł `assets` i zapisuje identyfikator pliku w zamówieniu. Błędy emitują
`invoice.generation_failed.v1` do kolejki ponowień w panelu administracyjnym.

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
z zatrzymaną kwotą jako zapłaconą.

Faktura wystawiona **po rozliczeniu zwrotu** obejmuje tylko to, co kupujący zatrzymał: nie ma
jeszcze faktury do skorygowania, więc sama faktura dokumentuje sprzedaż, która pozostała. Każda
pozycja zamówienia jest fakturowana w zamówionej ilości pomniejszonej o ilość z rozliczonych zwrotów
zamówienia (rodzaju *zwrot*, rozliczonych zwrotem pieniędzy albo środkami na koncie), niezależnie od
tego, czy pieniądze zostały już wypłacone; pozycja zwrócona w całości jest pomijana. Wymiana,
naprawa i reklamacja nie zmieniają żadnej pozycji. Pozycje dostawy, dopłaty za płatność i rabatu są
takie jak w zamówieniu, a VAT nadal liczy się dla każdej stawki od sumy wartości netto. Gdy moduł
`returns` jest wyłączony, każda pozycja jest fakturowana w zamówionej ilości.

**Kwota do zapłaty** to kwota brutto pomniejszona o to, co zapłacono, i nigdy nie jest ujemna. Gdy
zapłacono więcej niż kwota brutto, do zapłaty jest 0, a faktura podaje różnicę jako **nadpłatę**
(`overpayment` w API, wiersz *Nadpłata* na ekranie panelu i na PDF — etykieta jest ustawieniem
bloku podsumowania i tam można ten wiersz ukryć).

## Encje

`Invoice` (numer, daty wystawienia i dokumentu, odwołanie do pliku, `type ∈ {proforma, final}`).

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
