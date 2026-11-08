---
title: Szablony dokumentów
description: Projektowanie dokumentów PDF generowanych przez platformę — porównania produktów, faktury i zapytania ofertowego — w Page Builderze, dla każdego rodzaju dokumentu, języka i kanału sprzedaży
---

# Szablony dokumentów

Szablony dokumentów pozwalają operatorowi zaprojektować układ dokumentów PDF generowanych przez
platformę, w tym samym Page Builderze co strony CMS i e-maile. W tym wydaniu korzystają z nich trzy
rodzaje dokumentów — **typy dokumentów**:

| Typ dokumentu | Dostarcza go | Powstaje, gdy |
| --- | --- | --- |
| **Porównanie produktów** | Compare Products | kupujący klika **PDF** na stronie porównania w sklepie |
| **Faktura** | Faktury | PDF faktury pobiera administrator lub klient, jest generowany ponownie albo dołączany do e-maila z fakturą |
| **Zapytanie ofertowe** | Zapytania ofertowe | handlowiec eksportuje zapytanie ofertowe do PDF lub wysyła je klientowi; szablon wybiera dla każdej oferty |

Typ dokumentu dostarcza moduł, do którego należą dane dokumentu, dlatego jest widoczny tylko wtedy,
gdy ten moduł jest włączony. Moduł decyduje też, jakich bloków mogą używać jego dokumenty.

## Gdzie to znaleźć

**Treści → Szablony dokumentów** w menu bocznym albo **⌘K** / **Ctrl+K** i wpisz *pdf*, *szablon
dokumentu*, *szablon faktury*, *invoice template*, *szablon oferty* lub *zapytanie ofertowe pdf*.
**Zarządzaj szablonami PDF** w oknie eksportu zapytania ofertowego otwiera kartę zapytania
ofertowego. Przycisk **Szablon PDF** na ekranie
**Porównania** otwiera kartę porównania produktów, a zakładka **Szablony** w **Fakturach** — kartę
faktury.

## Układ wbudowany, szablony i szablon domyślny

Każdy typ dokumentu ma **układ wbudowany**: układ dostarczany przez platformę. Jest używany zawsze,
gdy nie ma pasującego szablonu, i od niego zaczyna się każdy nowy szablon.

Typ dokumentu może mieć dowolnie wiele **szablonów**. Każdy szablon dotyczy **wszystkich kanałów
sprzedaży** albo **jednego kanału** — to jego zakres, wybierany przy tworzeniu i potem niezmienny. W
każdym zakresie **co najwyżej jeden szablon jest domyślny**. Dokument powstaje z:

1. dla zapytania ofertowego — szablonu wybranego przez handlowca dla tej oferty (dla wszystkich
   kanałów albo kanału oferty; usunięty zostaje zastąpiony szablonem domyślnym, o czym handlowiec
   jest informowany), a w jego braku
2. domyślnego szablonu kanału sprzedaży dokumentu, a w jego braku
3. domyślnego szablonu dla wszystkich kanałów, a w jego braku
4. układu wbudowanego.

Szablon, którego układ nie zawiera niczego do wydrukowania, jest traktowany jak nieistniejący i
używany jest następny w tej kolejności.

Utworzenie szablonu nie zmienia żadnego dokumentu: nowy szablon nie jest domyślny, chyba że zaznaczono
**Ustaw jako domyślny**. Bezpieczny sposób zmiany tego, co otrzymują klienci, to *duplikuj → edytuj →
ustaw jako domyślny*. Ustawienie szablonu jako domyślnego zastępuje w tym samym kroku poprzedni
szablon domyślny jego zakresu; usunięcie szablonu domyślnego wymaga potwierdzenia, które mówi, co
zostanie użyte zamiast niego.

## Edycja szablonu

Edytor oferuje **tylko bloki typu dokumentu, do którego należy szablon**:

| Typ dokumentu | Bloki |
| --- | --- |
| Porównanie produktów | Nagłówek porównania, Tabela porównania, Link do udostępniania oraz bloki ogólne: Nagłówek, Tekst, Obraz (z biblioteki zasobów), Odstęp, Linia, Podział strony |
| Faktura | Nagłówek, Strony, Pozycje, Podsumowanie VAT, Sumy, Uwagi, Odstęp, Separator, Logo, Stopka oraz bloki, które dla faktur udostępniają inne zainstalowane moduły (np. sekcja KSeF) |
| Zapytanie ofertowe | Nagłówek oferty, Nabywca i kontakt, Uwagi do oferty, Szczegóły oferty, **Tabela pozycji** oraz bloki ogólne |

Kanwa pokazuje każdy blok wypełniony **przykładowym dokumentem**; **Podgląd PDF** generuje
prawdziwy PDF kanwy — zapisanej lub nie — z tymi samymi przykładowymi danymi i niczego nie zapisuje.

**Ustawienia strony** (korzeń drzewa) określają rozmiar strony (A4 lub Letter), orientację
(automatyczną — poziomą od trzech porównywanych produktów — pionową lub poziomą), marginesy, bazowy
rozmiar czcionki, opcjonalny powtarzany tekst nagłówka i stopki oraz numery stron.

**Pola korespondencji** to symbole wpisywane w tekst, np. `{{date}}` albo `{{customerName}}`,
zastępowane podczas generowania PDF. Edytor wyświetla pola korespondencji danego typu dokumentu;
`{{page}}` i `{{pages}}` działają tylko w nagłówku, stopce i formacie numeru strony. Pole bez
wartości drukuje się jako puste; pole z literówką drukuje się tak, jak je wpisano.

**Języki.** Szablon zawiera jeden układ na każdy język. Porównanie produktów może zawierać każdy
aktywny język treści: kupujący otrzymuje układ w języku, w którym wyświetlany jest sklep, a w jego
braku w języku o tym samym języku bazowym, a potem po angielsku lub w pierwszym języku szablonu;
nazwy produktów i atrybutów, daty i ceny są drukowane w tym języku. Wybór języka, którego szablon
jeszcze nie ma, pozwala zacząć go od kopii edytowanego języka. Faktury są drukowane wyłącznie po
polsku, dlatego edytor faktury nie oferuje wyboru języka. Pusta etykieta bloku faktury jest
drukowana po polsku, podobnie jak stopka z pustą treścią; układ wbudowany pozostawia je wszystkie
puste. Etykieta, którą wpiszesz, jest drukowana dokładnie tak, jak ją wpisano, w dowolnym języku.

**Zapis** jest odrzucany, jeśli ktoś inny zapisał szablon po jego otwarciu; wczytaj go ponownie, aby
zobaczyć zmiany. Blok, którego moduł jest wyłączony, zostaje w szablonie, jest pokazywany jako
zastępczy i nie jest drukowany.

## Tabela pozycji

**Tabela pozycji** (kategoria *Dane*) drukuje pozycje dokumentu jako tabelę, której kolumny określa
szablon. Jest oferowana typowi dokumentu, który deklaruje pozycje — w tym wydaniu zapytaniu
ofertowemu.

- **Kolumny** — od 1 do 16, w ustalonej kolejności (przyciski przesuwania w górę i w dół działają z
  klawiatury). *Dodaj kolumnę* otwiera listę pól dokumentu, pogrupowaną (*Pozycja*, *Ceny*,
  *Atrybuty produktu*) i z wyszukiwaniem. Dla każdej kolumny: **nagłówek** (pusty drukuje nazwę pola
  w języku układu), **szerokość** (automatyczna, wypełnij resztę albo stała w punktach — stałe
  szerokości szersze niż strona są zmniejszane), **wyrównanie** (automatyczne: liczby i kwoty do
  prawej), **format** (miejsca po przecinku; dla kwot waluta jako symbol, kod albo bez waluty; dla
  dat krótki, średni albo długi), tekst drukowany, gdy pozycja **nie ma wartości**, oraz kiedy
  kolumna jest **pokazywana**: *Zawsze*, *Tylko gdy któraś pozycja ma wartość* albo *Nigdy* (kolumna
  zostaje w szablonie, ale się nie drukuje). Szerokość ukrytej kolumny przypada pozostałym.
- Pola oznaczone jako **Wewnętrzne** — w ofercie: cena katalogowa i rabaty — to wartości, których
  klienci nie widzą w innych miejscach. Można je drukować; oznaczenie jest ostrzeżeniem.
- Pole, które już nie istnieje (usunięty atrybut produktu), jest oznaczone jako *Nieznane pole*; jego
  kolumna drukuje tekst dla braku wartości, a dokument nadal powstaje.
- **Wiersz szczegółów** — opcjonalny, pod każdą pozycją: do 8 wpisów drukowanych jako „etykieta:
  wartość”, połączonych separatorem; wpis jest domyślnie drukowany *tylko gdy ma wartość*, a pod
  pozycją, dla której żaden wpis nie ma wartości, wiersz się nie pojawia.
- **Sumy** — do 10 sum dokumentu, każda z etykietą, zasadą (domyślnie *tylko gdy ma wartość*) i
  opcją *Wyróżnij*, drukowane pod tabelą, wyrównane do prawej.
- **Grupowanie** — jeden z trzech trybów (zob. *Grupowanie* niżej): **Grupy z dokumentu**
  (domyślny), **Według pola** albo **Bez grupowania**.
- Wygląd: tło nagłówka, kolory obramowania i pasków, paski w wierszach, rozmiar czcionki, odstęp
  poniżej oraz tekst drukowany zamiast tabeli, gdy nie ma pozycji.

Tabela powtarza wiersz nagłówka na każdej stronie i nigdy nie dzieli wiersza pozycji między strony.
Wiersz jest utrzymywany w całości, ale nie razem z sąsiednim: wiersz szczegółów pozycji albo wiersz
nagłówka grupy może wydrukować się u dołu strony, a następny wiersz na początku kolejnej. Kanwa
rysuje tabelę na przykładowych danych z tym samym formatowaniem co PDF; kolumna ukryta przez swoją
zasadę w przykładzie jest rysowana wyblakła.

### Grupowanie

- **Grupy z dokumentu** — drukuje grupy, które operator ułożył w samym dokumencie (w zapytaniu
  ofertowym: grupy pozycji z zakładki *Modyfikacja*). Każda grupa, która ma pozycję, dostaje
  **wiersz nagłówka** z nazwą, a przy włączonej opcji *Pokaż liczbę pozycji* (domyślnie) także z
  liczbą pozycji (*3 pozycje* / *3 items*); potem jej pozycje; potem **jeden wiersz sumy częściowej
  dla każdej sumy tabeli**, z tą samą etykietą i zasadą, policzony po pozycjach grupy i drukowany do
  prawej bez wyróżnienia (żaden, gdy tabela nie ma sum). Pozycje bez grupy następują pod
  **Nagłówkiem pozostałych pozycji** — pusty drukuje *Pozostałe pozycje* / *Other items* w języku
  układu; może zawierać pola korespondencji. Liczba porządkowa biegnie 1…n przez wszystkie grupy, a
  sumy dokumentu następują jak zwykle. Dokument bez grup — albo typ dokumentu, który ich nie ma i dla
  którego edytor pokazuje *Ten typ dokumentu nie ma grup.* — drukuje tabelę bez podziału, dokładnie
  tak jak wcześniej.
- **Według pola** — pozycje są grupowane w kolejności pierwszego wystąpienia wartości jednego pola,
  każda grupa pod nagłówkiem (pozycje bez wartości pod podaną nazwą), opcjonalnie z sumą częściową
  jednego pola liczbowego lub kwotowego.
- **Bez grupowania** — tabela jest zawsze bez podziału.

**Grupy z dokumentu to znaczenie nieskonfigurowanej tabeli.** Tabela zapisana, zanim to ustawienie
powstało — z pustym grupowaniem — jest odczytywana jako *Grupy z dokumentu*, więc układ wbudowany i
istniejące szablony drukują grupy pogrupowanej oferty bez żadnej edycji; aby szablon pozostał bez
podziału, wybierz *Bez grupowania*. Tabela grupowana według pola nadal tak działa. Kanwa pokazuje
grupy z przykładowych danych (przykład zapytania ofertowego ma dwie grupy i jedną pozycję bez
grupy).

Symbole w postaci `{{item.…}}` są zarezerwowane dla przyszłego bloku powtarzającego bloki dla każdej
pozycji; do tego czasu drukują się tak, jak je wpisano.

## Uprawnienia

| Uprawnienie | Pozwala |
| --- | --- |
| `document_templates:read` | na listę, edytor (tylko odczyt) i **Podgląd PDF** |
| `document_templates:write` | na tworzenie, zmianę nazwy, zapis, ustawianie i usuwanie oznaczenia domyślnego, duplikowanie i usuwanie |

Gdy szablony faktur zostały tu przeniesione, każda rola mogąca przeglądać faktury otrzymała
`document_templates:read`, a każda rola mogąca edytować faktury także `document_templates:write` —
jednorazowo; uprawnienie odebrane później nie jest przywracane. Każda zmiana szablonu jest zapisywana
w dzienniku audytu.

## Wyłączanie modułów

- **Szablony dokumentów wyłączone** — znikają ekrany, pozycja w menu, akcja palety i przycisk
  **Szablon PDF** porównania, a API odpowiada `MODULE_DISABLED`; PDF porównania działa dalej ze stałym
  układem. Modułu nie można wyłączyć, dopóki włączone są **Faktury**, bo z niego powstaje każdy PDF
  faktury. Szablony są zachowywane i wracają bez zmian po ponownym włączeniu.
- **Compare Products, Faktury albo Zapytania ofertowe wyłączone** — dany typ dokumentu, jego bloki i
  szablony znikają z ekranów i z API; nic nie jest usuwane. Gdy **Szablony dokumentów** są
  wyłączone, zapytań ofertowych nie można eksportować ani wysyłać jako PDF; szablon zapamiętany dla
  każdej oferty zostaje zachowany.

## Limity

Szablon zawiera do 10 języków, do 200 bloków i 20 obrazów na język oraz do 512 KiB treści; tekst
może mieć do 5 000 znaków. Tabela porównania drukuje od 1 do 8 produktów na tabelę i kontynuuje w
następnej tabeli. Tabela pozycji ma od 1 do 16 kolumn, do 8 wpisów szczegółów i do 10 sum.

## API

`/api/v1/admin/document-templates` — typy dokumentów (`/types`, `/types/:code`,
`/types/:code/builder-config`), szablony (lista, odczyt, tworzenie lub duplikowanie, zmiana nazwy,
zapis jednego języka, ustawianie i usuwanie oznaczenia domyślnego, usuwanie) oraz `POST /preview`.
Szczegóły typu dokumentu wymieniają jego kolekcje pozycji — pola w żądanym języku, przykładowe
pozycje i sumy — na potrzeby edytora, oraz `sampleSections` — grupy z przykładu, puste dla typu,
który ich nie deklaruje. Kody błędów: `DOCUMENT_TEMPLATE_NOT_FOUND`, `DOCUMENT_TYPE_NOT_AVAILABLE`,
`DOCUMENT_TEMPLATE_INVALID`, `DOCUMENT_TEMPLATE_IS_DEFAULT`, `DOCUMENT_TEMPLATE_NOT_SELECTABLE`,
`DOCUMENT_RENDER_FAILED`.

Moduł dodaje typ dokumentu, rejestrując go — z blokami, informacją, czy korzysta z bloków ogólnych,
polami korespondencji, przykładowymi danymi, układem wbudowanym, językami, domyślnymi ustawieniami
strony, informacją, czy dla pojedynczego dokumentu można wybrać szablon, oraz **kolekcjami pozycji** —
w `documentTypeRegistry`, a dokumenty generuje przez `documentRenderPort`, przekazując własne dane.
Typ, który deklaruje kolekcję pozycji (jej pola, wartości pozycji i sumy), otrzymuje Tabelę pozycji
bez pisania renderera ani edytora; kolekcja, która deklaruje też swoje **sekcje** — nazwę każdej
grupy, jej pozycje i sumy oraz pozycje bez grupy — otrzymuje *Grupy z dokumentu* (lista sekcji,
której tabela nie może użyć, jest jednorazowo logowana, a tabela drukuje się bez podziału i nigdy
nie przerywa generowania dokumentu); typ z wyborem szablonu dla pojedynczego dokumentu pyta port
`listChoices` o szablony, które można wybrać dla jednego dokumentu.
