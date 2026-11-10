---
title: Pola niestandardowe
description: Typowane pola, które operator dodaje do zamówień, zapytań ofertowych, szans sprzedażowych i innych rekordów bez zmiany kodu, edytowane na jednym ekranie, dostępne jako filtry list w panelu i przenoszone z jednego rekordu do rekordu z niego utworzonego.
---

# Pola niestandardowe (`custom_fields`)

Pola niestandardowe pozwalają operatorowi dodać własne, typowane pola do rekordów platformy —
numer zamówienia zakupu klienta przy zamówieniu, region przy zapytaniu ofertowym, źródło leada
przy szansie sprzedażowej — jako dane, bez zmiany kodu i bez migracji. Pole definiuje się raz, na
ekranie **Pola niestandardowe** (`/custom-fields`), a od tej chwili jest wypełniane, pokazywane i —
tam, gdzie lista na to pozwala — używane do filtrowania wszędzie, gdzie obsługuje się rekordy tego
rodzaju.

## Rekordy, które przyjmują pola niestandardowe

| Rekordy | Dostępne | Może być filtrem listy |
| --- | --- | --- |
| Zamówienia | zawsze | tak — lista zamówień |
| Zapytania ofertowe | gdy moduł `quote_requests` jest włączony | tak — lista zapytań ofertowych |
| Szanse sprzedażowe | gdy moduł `crm` jest włączony | tak — lista szans sprzedażowych |
| Organizacje | zawsze | nie |
| Klienci | zawsze | nie |
| Kategorie | zawsze | nie |
| Produkty | zarządzane w **Katalog → Atrybuty**, tutaj tylko do odczytu | nie |

**Typ, który podąża za modułem, znika razem z nim.** Gdy moduł `quote_requests` jest wyłączony,
pola zapytań ofertowych nie są wyświetlane, nie można ich tworzyć ani edytować i nie zwraca ich API
definicji — dokładnie tak, jak pola szans sprzedażowych przy wyłączonym `crm`. Nic nie jest
usuwane: pola, ich opcje i wszystkie zapisane wartości wracają bez zmian po ponownym włączeniu
modułu.

## Tworzenie pola

Wybierz typ rekordu na ekranie **Pola niestandardowe** i naciśnij **Nowe pole** nad tabelą (albo
**Dodaj pole**, gdy typ nie ma jeszcze żadnego pola). Pole definiuje się w całości w jednym oknie —
tym samym formularzu, w którym później się je edytuje, z tymi samymi sekcjami w tej samej
kolejności:

1. **Definicja**
   - **Typ rekordu** — wstępnie ustawiony na typ widoczny na stronie; można wybrać każdy typ
     zarządzany na tym ekranie.
   - **Typ** — *Tekst*, *Liczba*, *Tak / Nie*, *Data*, *Pojedynczy wybór* lub *Wielokrotny wybór*.
   - **Klucz** — identyfikator pola: małe litery, cyfry i podkreślenia, zaczyna się od litery,
     najwyżej 64 znaki (`po_number`). Po utworzeniu pola nigdy się nie zmienia.
2. **Etykiety** — **etykieta domyślna** (wymagana) i po jednej etykiecie na każdy język panelu
   administracyjnego, dziś angielski i polski. Rekord pokazuje etykietę w języku czytającego, a gdy
   jej brak — etykietę domyślną.
3. **Opcje**, dla *Pojedynczego wyboru* i *Wielokrotnego wyboru* — **Dodaj opcję** dodaje wiersz z:
   - **zapisaną wartością**, którą przechowują rekordy — niepowtarzalną w obrębie pola;
   - **etykietą domyślną** (wymaganą) i etykietą w każdym języku panelu;
   - **Domyślna** — opcją, od której zaczyna nowy rekord. Pole *Pojedynczego wyboru* może mieć
     najwyżej jedną opcję domyślną, pole *Wielokrotnego wyboru* — kilka. Żadne nie musi jej mieć;
   - **Przesuń w górę** / **Przesuń w dół** — kolejnością, w jakiej opcje są oferowane, oraz
     **Usuń**.
   Opcje zapisują się razem z polem, więc nic nie zostaje zapisane przed naciśnięciem **Dodaj pole**.
4. **Reguły**
   - **Wymagane** — rekordu nie da się zapisać bez wartości.
   - **Kto widzi wartość** — *Wewnętrzne* (tylko administratorzy, domyślnie) albo *Klient* (wartość
     trafia też do klienta w sklepie oraz do integracji korzystających z zewnętrznego API).
   - **Dostęp w panelu** — *Edytowalne* (domyślnie), *Tylko do odczytu* albo *Ukryte*: jak pole
     wygląda w panelach administracyjnych, w których edytuje się rekordy. Zob. sekcję *Dostęp w
     panelu* poniżej.
   - **Zbieraj od kupującego podczas rejestracji** — dostępne tylko dla pól organizacji i klientów.
     Zob. sekcję *Zbieranie pola od kupującego* poniżej.
5. **Zachowanie**
   - **Używaj jako filtra listy** — dostępne tylko dla zamówień, zapytań ofertowych i szans
     sprzedażowych. Zob. [Filtry list](#filtry-list).
   - **Przenoś wartość do: …** — jedno pole wyboru na każdy typ rekordu, do którego wartość może
     trafić, każde z własną linią pomocy, dostępne tylko dla zapytań ofertowych, zamówień i szans
     sprzedażowych. Zob. sekcję *Przenoszenie wartości między zapytaniami ofertowymi, zamówieniami
     i szansami sprzedażowymi* poniżej.

Przycisk **Dodaj pole** tworzy pole ze wszystkim powyżej w jednym kroku. Zanim cokolwiek zostanie
wysłane, okno sprawdza format klucza, etykietę domyślną, to, czy każda opcja ma zapisaną wartość
nieużywaną przez inną opcję i etykietę domyślną, oraz liczbę opcji domyślnych; każdy problem jest
opisany przy polu, którego dotyczy, a fokus przechodzi do pierwszego z nich. Odmowa serwera jest
pokazywana tak samo — na przykład klucz użyty już w danym typie rekordu przy kluczu — a okno
zachowuje wszystko, co wpisano.

**Usuń** (kosz) prosi o potwierdzenie w miejscu, zanim pole zostanie usunięte. Tworzenie, edycja i
usuwanie pól wymaga uprawnienia `custom_fields:write`; administrator z samym `custom_fields:read`
widzi tylko tabelę, bez żadnych kontrolek, które ją zmieniają.

## Edycja pola

Każdy wiersz tabeli ma przycisk **Edytuj** (ołówek). Otwiera ten sam formularz co **Nowe pole**. Typ
rekordu, klucz i typ są pokazane jako stały tekst; resztę można zmienić:

- **Etykiety** — domyślną (wymaganą) i etykietę w każdym języku panelu.
- **Opcje** pola wyboru — każdą opcję zmienia się osobno, od razu, bez naciskania **Zapisz**:
  - jej etykietę domyślną i etykiety w poszczególnych językach, zapisywane po opuszczeniu pola lub
    naciśnięciu Enter;
  - **Domyślna** — opcja wstępnie wybrana dla nowego rekordu; w polu *Pojedynczego wyboru* najpierw
    odznacz bieżącą opcję domyślną, a potem zaznacz inną;
  - **Przesuń w górę** / **Przesuń w dół** — zmienia kolejność, w jakiej opcja jest oferowana;
  - **Usuń** — po potwierdzeniu w oknie. Opcji, którą ma jeszcze którykolwiek rekord, nie można
    usunąć: okno mówi o tym przy opcji, podając jej etykietę, i prosi, by najpierw zmienić wartość
    tych rekordów;
  - **Dodaj opcję** — z zapisaną wartością, której nie używa inna opcja, i etykietami.
  **Zapisana wartość** opcji nigdy się nie zmienia — to ją przechowują rekordy — więc zmiana
  etykiety opcji nie psuje żadnego rekordu ani filtra.
- **Wymagane** — po włączeniu okno wyjaśnia skutki: istniejące rekordy zachowują swoje wartości,
  a rekord bez wartości tego pola będzie jej wymagał przy następnej edycji jego pól
  niestandardowych. Nic nie jest uzupełniane automatycznie.
- **Kto widzi wartość** — ten sam wybór, który daje kolumna *Widoczne dla* w tabeli. Zmiana, po
  której przenoszenie wartości przestałoby działać, najpierw pyta o potwierdzenie, tak jak w tabeli.
- **Dostęp w panelu** i **Zbieraj od kupującego podczas rejestracji**, z tymi samymi regułami co
  przy tworzeniu pola.
- **Używaj jako filtra listy**, tam gdzie typ rekordu na to pozwala.
- **Przenoś wartość do: …**, tam gdzie typ rekordu na to pozwala — jedno pole wyboru na każdy typ
  docelowy, każde z własną linią pomocy.

Zmiany opcji zapisują się od razu, więc po pierwszej z nich przycisk **Anuluj** w oknie zmienia się
w **Zamknij**. **Zapisz** wysyła tylko to, co zmieniono, a gdy nic się nie zmieniło — nic. Jeśli zmiana zostanie
odrzucona, okno pozostaje otwarte z podanym powodem. Każda zmiana trafia do dziennika audytu jako
zmiana pola.

**Czego nie da się zmienić.** Klucz, typ rekordu i typ są stałe po utworzeniu pola; żeby je zmienić,
utwórz nowe pole. Opcji w użyciu nie można usunąć. Żadna edycja nie zmienia wartości, którą rekord
już ma.

## Dostęp w panelu

Niektóre pola utrzymuje integracja albo własny kod instancji — sumę kontrolną synchronizacji,
zewnętrzny numer klienta — i administrator nie powinien zmienić ich przypadkiem. **Dostęp w panelu**
określa, jak takie pole wygląda w panelach administracyjnych, w których edytuje się rekordy
(zamówienie, organizacja, klient, kategoria, zapytanie ofertowe):

| Dostęp w panelu | W panelu administracyjnym |
| --- | --- |
| *Edytowalne* (domyślnie) | pole do wpisania wartości, jak każde inne |
| *Tylko do odczytu* | etykieta i zapisana wartość (myślnik, gdy jej brak), bez pola do wpisania |
| *Ukryte* | niewidoczne |

Zapis panelu wysyła tylko pola edytowalne, więc wartość tylko do odczytu albo ukryta nigdy nie
zostanie z panelu nadpisana — także taka, którą integracja zapisała już po otwarciu strony. Jeśli
zapis zostanie odrzucony z powodu pola tylko do odczytu albo ukrytego (na przykład jego zapisana
wartość przestała pasować do pola), panel podaje, o które pole chodzi, i że zmienia się je na
ekranie **Pola niestandardowe**.

**Dostęp w panelu to wygoda panelu administracyjnego, a nie kontrola dostępu.** Pola tylko do
odczytu i ukryte można nadal odczytywać i zapisywać przez API, mogą być filtrami list, a eksport i
dziennik audytu obejmują je dokładnie tak jak pola edytowalne. Kto może edytować rekord przez API,
ten może zmienić te wartości; żeby odciąć kogoś od wartości, użyj uprawnień, a nie dostępu w panelu.

**Pole wymagane musi pozostać edytowalne.** Pole nie może być jednocześnie wymagane i tylko do
odczytu albo ukryte: każdy zapis rekordu sprawdza wszystkie pola wymagane, więc pole wymagane,
którego nikt nie może wypełnić w panelu, uniemożliwiłoby tam zapis każdego rekordu bez wartości.
Formularz wyłącza *Tylko do odczytu* i *Ukryte*, dopóki zaznaczone jest **Wymagane**, a
**Wymagane** — dopóki pole nie jest edytowalne, w obu przypadkach z podaniem powodu. Tabela
definicji pokazuje każde pole niezależnie od dostępu w panelu, z oznaczeniem *Tylko do odczytu*
albo *Ukryte*.

Atrybuty produktów mają to samo ustawienie, na ekranie **Katalog → Atrybuty**.

## Zbieranie pola od kupującego

Pole może wypełnić kupujący w formularzu rejestracji w sklepie — wtedy informacje potrzebne o nowym
kliencie biznesowym (skąd o was wie, branża, numer telefonu) przychodzą razem z rejestracją, a nie w
późniejszym e-mailu. Zaznacz w polu **Zbieraj od kupującego podczas rejestracji**:

- Pola **organizacji** pojawiają się w sekcji firmy formularza rejestracji B2B i są zapisywane w
  nowej organizacji; pola **klienta** pojawiają się w sekcji danych osobowych i są zapisywane na
  koncie osoby, która się rejestruje.
- Sklep pokazuje zaznaczone pola, każde z etykietą w języku sklepu, z oznaczeniem pól wymaganych,
  bez zmiany kodu; zmiana na ekranie **Pola niestandardowe** dociera do formularza w ciągu kilku
  minut.
- **Zbierać można tylko pola widoczne dla klientów.** Opcja jest niedostępna, z podaniem powodu,
  dopóki *Kto widzi wartość* ma wartość *Wewnętrzne* — kupujący nigdy nie jest proszony o wartość,
  której nie mógłby potem odczytać — oraz dla pola Page Builder. Zmiana zbieranego pola na
  *Wewnętrzne* jest odrzucana, dopóki opcja jest zaznaczona.
- Zbierane pole może być w panelu tylko do odczytu albo ukryte, chyba że jest wymagane.
- Tabela definicji oznacza zbierane pola etykietą *Rejestracja*.

**Co kupujący może wysłać, a co jest odrzucane.** Rejestracja przyjmuje wartości tylko dla pól
zaznaczonych do rejestracji — każdy inny klucz, pole wewnętrzne, pole drugiego typu rekordu albo
nieistniejące jest **odrzucane, nigdy pomijane**, a rejestracja nie dochodzi do skutku. Wymagane
zbierane pole musi zostać wypełnione; wymagane pole, które nie jest zbierane, nie jest wymagane przy
rejestracji. Każda wartość jest sprawdzana tak jak wartość wpisana przez administratora (typ, opcje,
daty, liczby), a do tego obowiązują trzy limity dla anonimowego autora: tekst ma najwyżej 1 000
znaków po usunięciu spacji z początku i końca, tekst złożony z samych spacji liczy się jako pusty, a
jednorazowo można wysłać najwyżej 50 pól jednego typu rekordu. Każda odmowa jest podana przy swoim
polu, w języku kupującego; odrzucona rejestracja niczego nie tworzy.

Zebrana wartość jest daną osobową jak reszta konta: anonimizacja klienta czyści jego wartości pól
niestandardowych, a wpis rejestracji w dzienniku audytu zapisuje, które pola wypełniono, nigdy ich
wartości.

Zbieranie od kupującego jest dziś dostępne w jednym formularzu — rejestracji B2B. Storefront
utworzony przed wprowadzeniem tej opcji wymaga niewielkiej zmiany, żeby pokazać pola; opisuje ją
dokumentacja modułu `organizations`.

## Filtry list

**Używaj jako filtra listy** udostępnia pole jako filtr na liście jego rekordów w panelu: na liście
zamówień dla pola zamówienia, na liście zapytań ofertowych dla pola zapytania ofertowego, na liście
szans sprzedażowych dla pola szansy. Kolumna *Filtr listy* w tabeli na ekranie **Pola
niestandardowe** pokazuje, które pola są filtrami list. Włączenie lub wyłączenie tej opcji nie
zmienia żadnej zapisanej wartości.

Filtr jest opisany etykietą pola w języku administratora (w razie braku — etykietą domyślną) i
działa zależnie od typu:

| Typ | Filtr | Rekord pasuje, gdy |
| --- | --- | --- |
| Tekst | tekst, który zawiera | jego wartość zawiera ten tekst, bez względu na wielkość liter |
| Liczba | najmniejsza i największa wartość, obie opcjonalne | jego wartość mieści się w zakresie, z oboma końcami |
| Data | od dnia, do dnia, oba opcjonalne | jego data mieści się w zakresie, z oboma dniami |
| Tak / Nie | *Dowolnie*, *Tak* lub *Nie* | *Tak* pasuje do tak, *Nie* do nie |
| Pojedynczy wybór | jedna lub więcej opcji | ma którąkolwiek z nich |
| Wielokrotny wybór | jedna lub więcej opcji | ma którąkolwiek z nich |

**Rekord bez wartości nigdy nie pasuje** do filtra pola niestandardowego — nawet do *Nie* w polu
tak/nie. Kilka wartości jednego pola pasuje do którejkolwiek z nich; filtry różnych pól oraz
własne filtry listy muszą pasować wszystkie. Filtr zawęża całą listę — jej sumę i każdą stronę —
a nie tylko wiersze na ekranie, i nie wychodzi poza to, co administrator może zobaczyć.

Na każdej liście filtry są w adresie strony, więc przefiltrowaną listę można dodać do zakładek albo
wysłać współpracownikowi, a zmiana filtra wraca do pierwszej strony listy. Na listach zamówień i
zapytań ofertowych filtry są też pokazane jako usuwalne etykiety obok pozostałych aktywnych filtrów
i są zapamiętywane w zapisanych widokach.

**Filtr, który nie jest już dostępny.** Jeśli od zapisania adresu wyłączono opcję pola albo
usunięto pole, lista odrzuca żądanie, mówi o tym, podając nazwę pola, i oferuje **Usuń ten filtr**.
Zapisany widok jest za to sprawdzany przy wczytaniu: niedostępny już filtr zostaje z niego usunięty,
z komunikatem, który go nazywa, zanim lista zostanie pobrana, a reszta widoku się wczytuje. Opcja
usunięta od tego czasu z pola znika z filtra bez komunikatu — żaden rekord nie może jej mieć.

**Szanse sprzedażowe: lista i tablica są niezależne.** Filtry tablicy wynikają z tego, co pokazują
jej karty; filtry pól niestandardowych listy szans sprzedażowych wynikają z tej opcji. Pole może być
jednym, nie będąc drugim. Pole karty tablicy, które nie jest filtrem listy, nie filtruje listy szans
— link, który filtrował nim listę, jest odrzucany do czasu włączenia opcji — a tablica, łącznie z
*Pokaż więcej*, działa bez zmian.

W sklepie ani w żadnym punkcie końcowym dla kluczy API nie ma filtrów pól niestandardowych.
Filtrowanie po polu *wewnętrznym* jest narzędziem administratora i nie ujawnia niczego, czego lista
i tak nie pokazywała.

## Przenoszenie wartości między zapytaniami ofertowymi, zamówieniami i szansami sprzedażowymi

Gdy jeden rekord powstaje z drugiego — zamówienie złożone z zapytania ofertowego, szansa sprzedażowa
otwarta dla zamówienia — pole może przekazać swoją wartość polu **o tym samym kluczu** w nowym
rekordzie. Pole zapytania ofertowego `order_source` z wartością *Targi* daje wtedy zamówieniu
złożonemu z tego zapytania `order_source` o wartości *Targi*, bez ponownego wpisywania.

### Pary

Opcja jest ustawiana w polu, **z którego** wartość pochodzi. Dostępnych jest pięć par:

| Pole w | może przenosić wartość do | kiedy |
| --- | --- | --- |
| Zapytaniach ofertowych | Zamówień | klient składa zamówienie z zaakceptowanego zapytania ofertowego (zob. *Zamówienia*) |
| Zapytaniach ofertowych | Szans sprzedażowych | CRM otwiera szansę sprzedażową dla zapytania |
| Zamówieniach | Szans sprzedażowych | CRM otwiera szansę sprzedażową dla zamówienia albo zamówienie dołącza do szansy zapytania ofertowego, z którego zostało złożone |
| Szansach sprzedażowych | Zapytań ofertowych | administrator tworzy zapytanie ofertowe z szansy sprzedażowej |
| Szansach sprzedażowych | Zamówień | administrator tworzy zamówienie z szansy sprzedażowej |

Żaden inny typ rekordu nie oferuje tej opcji: pole kategorii, produktu, klienta ani organizacji nie
ma pola wyboru **Przenoś wartość do: …**. Pole zamówienia nie oferuje *Zapytania ofertowego* —
zapytanie ofertowe, które klient sklonował z zamówienia, nie otrzymuje żadnej przeniesionej
wartości. Pola, które podążają za modułem, podążają za nim także tutaj: gdy moduł `crm` jest
wyłączony, żadne pole wyboru nie wskazuje szans sprzedażowych, a pola szans nie są wyświetlane; gdy
wyłączony jest `quote_requests`, to samo dotyczy zapytań ofertowych — i nic nie jest przenoszone do
tych rekordów ani z nich. Opcje są zachowywane i znów działają po powrocie modułu; rekordy
utworzone w międzyczasie nie są później uzupełniane.

### Co jest przenoszone i kiedy

- **Raz, w chwili połączenia rekordów.** Wartość jest przenoszona, gdy nowy rekord powstaje albo
  zostaje połączony ze źródłem — i tylko wtedy. Późniejsza edycja któregokolwiek z rekordów nie
  zmienia drugiego. Włączenie lub wyłączenie opcji nie zmienia żadnej zapisanej wartości i nie
  uzupełnia rekordów utworzonych wcześniej.
- **Tylko do pustego pola.** Jeśli nowy rekord ma już wartość dla tego klucza — wpisaną ręcznie albo
  przeniesioną z wcześniejszego dokumentu — ta wartość zostaje. Gdy dwa zamówienia z różnymi
  wartościami dołączają do jednej szansy sprzedażowej, pierwsze wypełnia jej pole, a drugie go nie
  zmienia.
- **Tylko wartość.** Puste pole źródłowe niczego nie przenosi i nigdy nie czyści pola docelowego.
  Wartość pozostawiona na rekordzie przez pole, które później usunięto, nie jest przenoszona.
- **Tylko w obrębie jednej organizacji.** Oba rekordy zawsze należą do tej samej organizacji; z pary
  rekordów różnych organizacji nic nie jest przenoszone.
- **Nigdy nie przeszkadza.** Przenoszenie nigdy nie sprawia, że składanie zamówienia przez klienta,
  zamówienie lub zapytanie ofertowe tworzone przez administratora albo szansa sprzedażowa kończą
  się błędem. Inne wymagane pole pozostawione puste w nowym rekordzie nie blokuje przeniesienia
  wartości, a przenoszenie nie dodaje żadnego nowego powodu odrzucenia rekordu.
- **Ręczne powiązanie niczego nie przenosi.** Powiązanie istniejącego zamówienia lub zapytania
  ofertowego z szansą sprzedażową na karcie *Powiązania* szansy albo z panelu *Powiązana szansa*
  dokumentu nie przenosi żadnej wartości w żadną stronę i niczego nie zapisuje.

### Kiedy można włączyć opcję

**Przenoś wartość do: …** zostaje przyjęte tylko wtedy, gdy docelowy typ rekordu ma pole o tym samym
kluczu, które może przyjąć wartość. W przeciwnym razie zapis jest odrzucany, okno pozostaje
otwarte, a komunikat podaje powód:

| Odmowa | Znaczenie |
| --- | --- |
| Brak pola o tym kluczu w typie docelowym | Najpierw utwórz pole w docelowym typie rekordu. |
| Inny typ | Oba pola muszą mieć ten sam typ. Nic nie jest rozszerzane: *Pojedynczy wybór* nie przenosi się do *Wielokrotnego wyboru*, a żaden typ — do *Tekstu*. Komunikat podaje oba typy. |
| Brakujące opcje | W polu wyboru każda zapisana wartość opcji tego pola musi istnieć w polu docelowym. Etykiety mogą się różnić, a pole docelowe może mieć więcej opcji. Komunikat wymienia brakujące wartości. |
| Widoczne dla klientów | To pole jest *Wewnętrzne*, a pole docelowe — *Klient*. Wartość wewnętrzna stałaby się widoczna dla klientów, więc zapis jest odrzucany — najpierw zmień, kto widzi wartość, w jednym z dwóch pól. Przenoszenie z *Klienta* do *Wewnętrznego* oraz między polami o tej samej widoczności jest dozwolone. |
| Wyłączony moduł | Moduł docelowego typu rekordu jest wyłączony. |

Przenoszenie nie zmienia widoczności żadnego pola: wartość przeniesioną do pola **docelowego** widzi
ten, kto może czytać to pole. Włączenie lub wyłączenie opcji jest zmianą pola jak każda inna i trafia
do dziennika audytu.

**Widoczność pola szansy sprzedażowej dotyczy dokumentu, do którego trafia wartość.** Szanse
sprzedażowe widzą tylko administratorzy, więc *kto widzi wartość* nie zmienia niczego w samej szansie.
Rozstrzyga natomiast, dokąd wartość może trafić: pole szansy ustawione na *Klient* może przenosić
wartość do pola zamówienia lub zapytania ofertowego widocznego dla klientów, a wtedy klient widzi tę
wartość w tym zamówieniu lub zapytaniu. Zostaw pole szansy jako *Wewnętrzne* — to ustawienie
domyślne — chyba że jego wartość jest przeznaczona dla klienta.

### Zmiana pola, które przenosi lub przyjmuje wartość

Pole, które bierze udział w przenoszeniu, nadal można zmienić lub usunąć. Przed zmianą, po której
wartości przestałyby być przenoszone, ekran ostrzega i wymienia każde pole po drugiej stronie, w
postaci *typ rekordu · klucz*:

| Zamierzasz | Ostrzeżenie pojawia się, gdy | Przycisk, który kontynuuje |
| --- | --- | --- |
| usunąć opcję (**Usuń** w oknie) | pole przenoszące wartość do tego pola ma tę opcję | **Usuń opcję mimo to** |
| dodać opcję (**Dodaj opcję**) | to pole przenosi wartość do pola, które tej opcji nie ma | **Dodaj opcję mimo to** |
| zmienić w tabeli, *kto widzi wartość* | to pole stałoby się widoczne dla *Klienta*, a przenosi do niego pole *Wewnętrzne*, albo stałoby się *Wewnętrzne*, a przenosi do pola widocznego dla *Klienta* | **Zmień widoczność mimo to** |
| usunąć pole (kosz) | pole przenosi wartość do jakiegokolwiek pola lub ją od niego przyjmuje | **Usuń pole mimo to** |

Przyciski usunięcia opcji i pola są czerwone, jak każda nieodwracalna akcja. **Anuluj** niczego nie
zmienia. Zmiana, która nie przerywa żadnego przenoszenia, pyta o tyle samo co wcześniej — a tam,
gdzie pojawia się ostrzeżenie, zastępuje ono zwykłe potwierdzenie usunięcia, zamiast dodawać drugie.
Typu pola nie można zmienić na tym ekranie, więc nie ma dla niego ostrzeżenia.

Kontynuowanie zostawia opcję **Przenoś wartość do: …** bez zmian. Kolumna **Przenosi do** w tabeli
wymienia typy rekordów, do których pole przenosi wartość; przenoszenie, które przestało działać, jest
oznaczone jako **Niezgodne**, z powodem — brakującym polem, dwoma typami, brakującymi opcjami albo
widocznością — wypisanym pod oznaczeniem. Oznaczenie znika, gdy tylko pola znów do siebie pasują
albo opcja zostanie wyłączona.

### Wartość, która nie została przeniesiona

Oznaczenie jest ostrzeżeniem, a nie wyłącznikiem: przenoszenie oznaczone jako *Niezgodne* nadal
działa, a każda wartość jest oceniana względem pola docelowego **w takim stanie, w jakim jest w
chwili tworzenia rekordu**. Wartość wyboru, której opcję pole docelowe w międzyczasie zyskało, jest
przenoszona; przenoszenie, które tabela pokazywała jako poprawne, zostaje pominięte, jeśli pole
docelowe do tego czasu przestało pasować.

Wartość, której nie da się przenieść, jest pomijana, rekord i tak powstaje, a nowy rekord mówi, czego
w nim zabrakło — **jeden** wpis na jedno przeniesienie, z każdym pominiętym polem wymienionym raz,
razem z powodem:

| Rekord docelowy | Gdzie jest wpis |
| --- | --- |
| Zamówienie | wewnętrzna notatka *Systemu* w komentarzach zamówienia — nigdy niepokazywana klientowi i niewysyłająca powiadomień |
| Zapytanie ofertowe | wpis *Systemu* w historii zapytania — tylko w panelu administracyjnym, nigdy w widoku zapytania u klienta |
| Szansa sprzedażowa | wpis jej utworzenia albo dołączenia zamówienia w jej *Historii zmian* |

Powody to: pole docelowe o tym kluczu nie istnieje, pole docelowe ma inny typ, pole docelowe jest
widoczne dla klientów, a pole źródłowe — wewnętrzne, albo wartość nie pasuje do pola docelowego — na
przykład opcja wyboru, której pole docelowe nie ma. Przeniesienie, w którym nic nie pominięto,
niczego nie zapisuje.

Każdy wpis nazywa pole **etykietą pola, z którego pochodzi wartość, z chwili, w której wartość
została pominięta**, w języku czytającego, więc każdy, kto może zobaczyć rekord, wie, o które pole chodzi — nie potrzeba do tego
`custom_fields:read`, a późniejsza zmiana nazwy lub usunięcie pola nie zmienia wpisu. Wpis zawiera
tylko nazwę pola i powód, nigdy wartość; same wartości pól niestandardowych są jak dotąd widoczne
tylko z `custom_fields:read`. Wpis zapisany, zanim nazwy pól zaczęto w nim przechowywać, nazywa pole
jego kluczem — bieżąca definicja pola nie jest odczytywana.

## Dla integratorów

| Metoda + ścieżka | Uprawnienie | Cel |
| --- | --- | --- |
| `GET /api/v1/admin/custom-fields/entity-types` | `custom_fields:read` | Obecnie dostępne typy encji, każdy z `listFilter`: czy jego pola mogą być filtrami list, `carryTargets`: typy, do których jego pola mogą przenosić wartości, bez typu, którego moduł jest wyłączony, oraz `customerInputSurfaces`: powierzchnie danych od kupującego, na których można otworzyć jego pola (`organization.register` dla `organization` i `customer`, w pozostałych przypadkach `[]`). |
| `GET /api/v1/admin/custom-fields/definitions?entityType=…` | `custom_fields:read` | Pola danego typu, każde z `listFilter` i `carryTo` — typami, do których przenosi wartość (bez typu, którego moduł jest wyłączony). |
| `POST /api/v1/admin/custom-fields/definitions` | `custom_fields:write` | Tworzy pole; `listFilter` jest opcjonalne, a dla typu, który go nie obsługuje, odrzucane z `422`; `carryTo` jest opcjonalne (domyślnie `[]`); `customerInput` (powierzchnie, na których pole jest otwarte, domyślnie `[]`) i `adminAccess` (`edit`, `read` lub `hidden`, domyślnie `edit`) są opcjonalne. |
| `PATCH /api/v1/admin/custom-fields/definitions/:id` | `custom_fields:write` | Zmienia `labelDefault`, `label`, `required`, `audience`, `listFilter`, `carryTo` (całą nową listę), `customerInput` (całą nową listę) lub `adminAccess`; nieobecne pola zostają bez zmian. Oceniany jest tylko **nowo dodany** element `carryTo`, więc ponowne wysłanie przenoszenia, które w międzyczasie stało się niezgodne, jest przyjmowane, a element wskazujący wyłączony moduł zostaje zachowany niezależnie od wysłanej listy. |
| `POST`, `PATCH`, `DELETE …/definitions/:id/options[/:optionId]` | `custom_fields:write` | Dodaje, zmienia (etykiety, `isDefault`, `sortOrder` — nigdy `value`) lub usuwa opcję. `409` dla opcji w użyciu. |
| `GET /api/v1/custom-fields/input-surfaces/:surface` | brak — anonimowo, także w sklepie zamkniętym dla anonimowych odwiedzających | Pola otwarte na powierzchni danych od kupującego, dla każdego typu encji w ich kolejności: `key`, `valueType`, `required`, `label` i `label` opcji w języku żądania (z etykietą domyślną, gdy brak tłumaczenia), `options` i `sortOrder`. Nigdy zapisana wartość, widoczność, dostęp w panelu ani pole wewnętrzne. Nieznana powierzchnia daje `200` z `entities: {}`. |

Każda definicja zwraca `customerInput` i `adminAccess`. `adminAccess` odczytują wyłącznie panele
administracyjne: żaden endpoint nie przyjmuje, nie zwraca, nie filtruje, nie eksportuje ani nie
audytuje wartości inaczej z jego powodu.

Ścieżki definicji i opcji odmawiają z tymi kodami:

| Status | Kod | Kiedy | `details` |
| --- | --- | --- | --- |
| `409` | `CUSTOM_FIELD_OPTION_IN_USE` | usunięcie opcji, którą ma jeszcze któryś rekord | `value`, `label` — zapisana wartość i domyślna etykieta opcji |
| `409` | `CUSTOM_FIELD_VALUE_TYPE_LOCKED` | zmiana typu wartości pola, gdy rekordy mają wartości | `key` |
| `409` | `CUSTOM_FIELD_STORED_VALUES_EXIST` | utworzenie pola widocznego dla *Klienta* pod kluczem, którego wartości zostawiło na rekordach usunięte pole — najpierw utwórz je jako wewnętrzne | `key` |
| `422` | `CUSTOM_FIELD_DEFINITION_INVALID` | niepoprawna definicja, w tym `listFilter` dla typu rekordu, który go nie obsługuje (`list_filter_unsupported`), oraz cztery odmowy dotyczące danych od kupującego i dostępu w panelu: `customer_input_unsupported` (powierzchnia, której typ rekordu nie oferuje), `customer_input_audience` (pole otwarte na powierzchni, a *Wewnętrzne*), `customer_input_value_type` (pole Page Builder otwarte na powierzchni) i `admin_access_required` (pole wymagane, a tylko do odczytu albo ukryte) | `code` i `reason` dla tych czterech oraz `key` |
| `422` | `CUSTOM_FIELD_CARRY_INCOMPATIBLE` | włączenie elementu `carryTo`, którego typ docelowy nie może przyjąć | `code` — `target_missing`, `value_type_mismatch`, `options_missing`, `audience_mismatch`, `pair_unsupported` (para, która nie jest oferowana, w tym własny typ pola) lub `target_unavailable` (moduł typu docelowego jest wyłączony); `targetEntityType`, `key`; `sourceValueType` i `targetValueType` przy niezgodności typów; `missingOptionValues` (tekst rozdzielony przecinkami) i `missingOptionValueList` (tablica) przy brakujących opcjach |

Trzy listy przyjmują filtry jako parametr żądania:

- `GET /api/v1/admin/orders`, `GET /api/v1/admin/orders/export` i
  `GET /api/v1/admin/quote-requests` przyjmują `customFieldFilters` — zakodowany w URL obiekt JSON
  z kluczami pól: `{"region":{"in":["north"]},"weight":{"min":"1.5"}}`.
- `GET /api/v1/admin/crm/opportunities` przyjmuje te same filtry jako odwołania `custom:<key>` w
  `fieldFilters`.
- Każda lista zwraca swoje dostępne pola pod `…/custom-field-filters` — `GET
  /api/v1/admin/orders/custom-field-filters`, `…/quote-requests/custom-field-filters` i
  `…/crm/opportunities/custom-field-filters`.

Operatory to `contains`, `in`, `is`, `min` / `max` (liczby dziesiętne jako tekst) oraz `from` / `to`
(`YYYY-MM-DD`). Najwyżej 10 pól i łącznie 100 wartości `in` na żądanie. Pole, które nie jest filtrem
danej listy, daje `400` `CUSTOM_FIELD_FILTER_UNAVAILABLE` z odrzuconym kluczem w `details.key`.
Odwrócony zakres — `min` większe niż `max`, `from` późniejsze niż `to` — oraz operator, który nie
pasuje do typu pola (na przykład `contains` dla liczby), dają `400` `VALIDATION_FAILED` z nazwą pola
i operatora: żadne z nich nie jest pomijane.

Wartość wysłana przez kupującego na powierzchni danych od kupującego jest odrzucana standardową
odmową pól niestandardowych platformy, `422` `CUSTOM_FIELD_VALUE_INVALID`, z jednym wpisem
`details` na pole, z jego `code` i z `message` sformułowanym dla kupującego w języku żądania —
który nigdy nie podaje klucza ani nie powtarza wartości. Dwa kody występują tylko tam:
`not_open_for_input` (pole nie jest otwarte na powierzchni albo nie istnieje) i `too_many_keys`
(więcej niż 50 pól jednego typu rekordu). Pozostałe — `missing_required`, `wrong_type`,
`out_of_range`, `unknown_option`, `duplicate_option` — to te same kody, z którymi odrzucane są
wartości administratora. Która ścieżka przenosi wartości i jak nazywa każde pole w `details`,
decyduje moduł gospodarza: dla rejestracji opisuje to dokumentacja modułu `organizations`.
