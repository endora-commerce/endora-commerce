---
title: Feedy produktowe
description: Feedy produktowe w formacie dostawcy dla każdego kanału sprzedaży — generowanie według harmonogramu, adresy URL z tokenem do pobierania oraz wysyłka przez SFTP/FTP/HTTP
---

# Feedy produktowe

Moduł `product_feeds` zamienia katalog jednego kanału sprzedaży w **plik feedu w formacie
dostawcy** — dokument XML dla Google Merchant Center, katalog Meta, plik płaski dla marketplace'u —
publikuje go pod **stałym adresem URL z tokenem**, który dostawca pobiera anonimowo, i generuje go
ponownie według harmonogramu ustawionego osobno dla każdego feedu.

Feedy opuszczają platformę na dwa sposoby. **Pobieranie** (pull) jest sposobem pierwotnym i nadal
domyślnym: dostawca pobiera adres URL z tokenem albo administrator pobiera plik. **Wysyłka** (push)
pojawiła się później — każde udane generowanie może też wysłać plik na serwer partnera przez SFTP,
FTP lub HTTP. Oba sposoby są od siebie niezależne, więc feed może korzystać z obu.

## Dla operatorów

### Z czego składa się feed

Przy tworzeniu feed to cztery wybory i nic więcej:

| Wybór | Znaczenie |
| --- | --- |
| **Szablon** | Jakie pola zawiera plik, w jakiej kolejności i w jakim formacie (XML, CSV, TSV). |
| **Kanał sprzedaży** | Który katalog publikuje feed. Od kanału zależą też ceny i linki. |
| **Język** | W którym tłumaczeniu zapisywane są nazwy, opisy i ścieżki kategorii. |
| **Nazwa** | Po czym rozpoznasz feed. Publiczny adres URL wynika z feedu, a nie z nazwy. |

Wszystko inne — kryteria, harmonogram, sposób prezentacji ceny, cennik, kraj opodatkowania — ma
działającą wartość domyślną i można to zmienić później na karcie **Settings** feedu.

### Tworzenie pierwszego feedu

1. Przejdź do **Sales channels → Product feeds** i kliknij **New feed**.
2. Wybierz szablon **Google Merchant Center**, kanał, w którym sprzedajesz ten katalog, oraz język.
   W trakcie wybierania ekran pokazuje ustawienia, które z tego wynikają (walutę, sposób prezentacji
   ceny).
3. Zapisz, a następnie kliknij **Generate now** na stronie feedu.
4. Gdy generowanie się zakończy, karta **Feed link** pokaże adres URL. Wklej go w Merchant Center
   jako zaplanowane pobieranie.

Do pierwszego udanego generowania **celowo nie ma na ekranie adresu URL**: link, który odpowiada
`404`, jest gorszy niż brak linku.

### Pięć dostarczanych szablonów

Nie są równoważne, a różnicę widać, zanim wybierzesz któryś z nich.

| Szablon | Format | Szczegółowość | Stan |
| --- | --- | --- | --- |
| Google Merchant Center | XML (RSS 2.0 + `g:`) | Dla każdego wariantu | **Gotowy do użycia** |
| Katalog Meta | XML | Dla każdego wariantu | **Gotowy do użycia** |
| Plik płaski Amazon | TSV | Dla każdego produktu | **Punkt wyjścia** |
| eBay | CSV | Dla każdego produktu | **Punkt wyjścia** |
| Allegro | CSV | Dla każdego produktu | **Punkt wyjścia** |

„Gotowy do użycia” oznacza, że lista pól obejmuje cały zestaw pól wymaganych przez danego dostawcę.
„Punkt wyjścia” oznacza, że szablon zawiera tylko identyfikator, cenę, dostępność, link i zdjęcie —
pola potrzebne każdemu marketplace'owi — a atrybuty specyficzne dla danego marketplace'u należy
dodać samodzielnie w edytorze szablonu. Trzy szablony marketplace'ów są dostarczane jako szkielety,
bo ta wersja nie ma integracji z ich API, więc dokładny zestaw wymaganych pól zależy od konta.

Szablonów systemowych nie można edytować. Użyj **Duplicate** i edytuj kopię; oryginał pozostaje
taki, jakim dostarczyła go platforma, a usunięty szablon systemowy zostaje przywrócony przy
następnym uruchomieniu.

### Tworzenie i edycja szablonu

**Sales channels → Feed templates → New template** albo **Duplicate**. Edytor to wizualna lista pól
wyjściowych: każdy wiersz ma postać *nazwa wyjściowa ← źródło*, z opcjonalną wartością zastępczą i
flagą „wymagane przez dostawcę”.

- **Powiązania się wybiera, a nie wpisuje.** Lista źródeł pokazuje to, co istnieje w tej instalacji
  — pola produktu, atrybuty i pola niestandardowe, zdjęcia, ceny, ścieżki kategorii, kategorię
  dostawcy. Źródło, którego bieżący format wyjściowy nie potrafi wyrazić, jest pokazywane jako
  nieaktywne **wraz z powodem**, a nie ukrywane.
- **Kolejność można zmieniać samą klawiaturą.** Chwyć wiersz klawiszem `Space`, przesuń go
  strzałkami `↑`/`↓` lub `Alt+↑/↓`, upuść klawiszem `Space`, anuluj klawiszem `Escape`. Każde
  przesunięcie jest ogłaszane czytnikowi ekranu. Na urządzeniach dotykowych każdy wiersz ma osobne
  przyciski przesuwania, a długie listy oferują **⋮ → Move to position…**.
- **Podgląd ocenia wersję roboczą.** Wybierz przykładowy produkt i zobacz dla każdego pola wartość,
  którą zawierałby plik, jej pochodzenie (źródło lub wartość zastępcza) oraz to, czy pozycja
  zostałaby wysłana, czy pominięta. Podgląd niczego nie zapisuje — ani generowania, ani wpisu w
  dzienniku audytu.
- **Problemy są pokazywane na bieżąco**, na pasku nad listą. Przycisk **Save** nigdy nie jest
  wyłączany z powodu błędu walidacji; zamiast tego mówi, co jest nie tak.
- Usunięcie pola wymaganego przez dostawcę wymaga jednego potwierdzenia, w którym podana jest
  konsekwencja. Taka zmiana nie jest ani po cichu akceptowana, ani blokowana.

Szablony przenosi się między instalacjami jako JSON: **Export…** przy szablonie, **Import** na
liście szablonów. Dokument nie zawiera identyfikatorów, znaczników czasu, tokenów ani powiązań z
feedami, więc dwukrotny eksport niezmienionego szablonu daje pliki identyczne co do bajtu. Pole,
którego źródło nie istnieje w docelowej instalacji, jest importowane jako **niepowiązane** i
zgłaszane; generowanie feedu opartego na szablonie z niepowiązanymi polami kończy się błędem, który
wymienia każde z nich, zamiast publikować plik z lukami.

### Zawężanie feedu do części katalogu

Sekcja **Criteria** na karcie Settings to ten sam kreator reguł, którego używają promocje i cenniki.
Pusta reguła oznacza „każdy kwalifikujący się produkt tego kanału”. Kryterium kategorii obejmuje
całe jej poddrzewo.

Podczas edycji panel pokazuje **bieżącą liczbę dopasowań**. Jest ona liczona na podstawie tych
samych cen i tego samego zawężenia do kanału, których użyje następne generowanie, więc to liczba
pozycji, które generowanie weźmie pod uwagę — a nie szacunek.

Dwóch rzeczy reguła nigdy nie zrobi:

- **nie poszerzy feedu.** Produkt aktywny, niezarchiwizowany, należący do kanału tego feedu i
  widoczny dla anonimowego odwiedzającego — to minimum, którego żadne kryterium nie obniży.
  „Widoczny dla anonimowego odwiedzającego” to pełny warunek, a nie tylko przełącznik `public`:
  produkt publiczny, **ale** zarezerwowany dla wskazanych organizacji, nie trafia do feedu, bo plik
  pobiera Google, a link, którego nikt spoza tych organizacji nie otworzy, reklamuje stronę 404 — i
  zdradza istnienie asortymentu, który ktoś inny dostał na wyłączność;
- **nie dopasuje po cichu wszystkiego.** Kryterium wskazujące atrybut, który został w międzyczasie
  usunięty, kończy generowanie błędem konfiguracji, zamiast po cichu dopasować cały katalog.

Jeśli reguła nic nie dopasuje, generowanie kończy się stanem `empty`, a **wcześniej opublikowany
plik jest nadal udostępniany**. Panel ostrzega o tym przed zapisem, a nie po nim.

### Mapowanie kategorii (Google i Meta)

Obaj dostawcy posługują się własną taksonomią produktów. Platforma dostarcza te taksonomie
(5 595 kategorii Google i 2 967 kategorii Meta, każdą po angielsku i po polsku), więc generowanie
feedu nigdy nie zależy od połączenia z Google ani Meta.

Ekran mapowania otworzysz z palety poleceń (⌘K / CTRL+K → *Feed category mapping*). Zmapuj kategorię
sklepu na węzeł dostawcy, a każda kategoria podrzędna to odziedziczy, chyba że ma własne
mapowanie; gdy zastosowanie ma kilka przypisanych kategorii, wygrywa — deterministycznie — najgłębsza
zmapowana. Pasek pokrycia pokazuje, ile kategorii jest zmapowanych, ile dziedziczy mapowanie, a ile
nie ma go wcale.

- Kategoria **bez mapowania** nie jest błędem: pole jest pomijane, a pozycja i tak trafia do pliku,
  z ostrzeżeniem w generowaniu, żebyś mógł ją odnaleźć.
- Gdy zacznie obowiązywać nowsza wersja taksonomii, a zmapowany przez Ciebie węzeł już nie istnieje,
  mapowanie zostaje zachowane i oznaczone jako **nieaktualne** — nigdy nie jest zastępowane
  zgadywaniem ani usuwane. Ekran wyświetla nieaktualne mapowania do przejrzenia. Wersja zaczyna
  obowiązywać dopiero wtedy, gdy zatwierdzisz ją na ekranie
  [Aktualizacje taksonomii](#taxonomy-updates); sama instalacja wersji niczego nie zmienia.
- Powyżej 1 000 kategorii sklepu ekran zamiast drzewa pokazuje stronicowaną płaską listę
  pogrupowaną według kategorii nadrzędnej, z tymi samymi wierszami i tym samym paskiem pokrycia.

### Aktualizacje taksonomii {#taxonomy-updates}

Google i Meta reorganizują swoje listy kategorii raz lub dwa razy w roku. Platforma potrafi
sprawdzić, czy jest nowsza lista, i ją zainstalować — a zainstalowanie jej **niczego nie zmienia**,
dopóki tego nie zatwierdzisz.

**Domyślnie sprawdzanie jest wyłączone, a stan wyłączony jest w pełni obsługiwany.** Przy
wyłączonym przełączniku platforma nie wysyła żadnych żądań na zewnątrz: nie ma sprawdzania według
harmonogramu, sprawdzania ręcznego ani próby połączenia przy starcie. Wiele instalacji celowo działa
w ten sposób, a instalacja odcięta od sieci (air-gapped) musi tak działać. Włączenie to jedno
ustawienie na ekranie, który przed przełączeniem podaje dokładne adresy, z którymi platforma będzie
się łączyć.

**Włączanie.** *Settings → Taxonomy updates* (`product_feeds_taxonomy`):

| Ustawienie | Działanie |
| --- | --- |
| Check for new taxonomy revisions | Główny przełącznik. Domyślnie wyłączony. |
| When to check | Wyrażenie cron interpretowane w strefie **UTC**. Domyślnie poniedziałek, 04:00. Te listy zmieniają się raz lub dwa razy w roku, więc częstsze sprawdzanie nic nie daje. |
| Google / Meta category list (English, Polish) | Cztery adresy, z których pobierane są pliki. Jeśli platforma nie może połączyć się z dostawcami bezpośrednio, wskaż wewnętrzną kopię lub serwer proxy — to obsługiwane rozwiązanie dla wdrożenia za serwerem proxy. Tylko `https`. |
| Category lists kept per provider | Ile wersji przechowywać. Lista używana, najnowsza lista, o której nikt jeszcze nie zdecydował, oraz każda lista zawierająca kategorię, na którą wskazuje któreś z Twoich mapowań, nigdy nie są usuwane, niezależnie od tej wartości. |

**Co robi sprawdzenie.** Pobiera oba pliki językowe dostawcy, sprawdza, czy rzeczywiście są listą
kategorii, i porównuje je z tym, co już masz. Jeśli lista faktycznie się różni, zostaje zainstalowana
jako **nieaktywna**: Twoje feedy nadal korzystają z dotychczasowej listy, status żadnego mapowania
się nie zmienia, a jedynym widocznym skutkiem jest nowy wiersz na ekranie *Product feeds → Taxonomy
updates* (⌘K / CTRL+K → *Taxonomy updates*). Jeśli plik się nie zmienił, nic nie powstaje.

**Jak czytać wynik sprawdzenia.** Ekran wyświetla każde sprawdzenie z jego wynikiem, a gdy coś
poszło nie tak — z powodem sformułowanym tak, by było jasne, **po czyjej stronie leży problem**:

| Powód | Znaczenie |
| --- | --- |
| `transport` | Ten serwer nie mógł połączyć się z dostawcą — zwykle z powodu braku dostępu do internetu, serwera proxy lub zapory sieciowej. Wskaż jako adres źródła serwer proxy lub wewnętrzną kopię pliku. |
| `not_found` | Dostawca nie publikuje już pliku pod tym adresem. Znajdź aktualny adres w jego dokumentacji i zaktualizuj ustawienie. To jedyny błąd, który wywołuje powiadomienie — raz przy przejściu w stan błędu, a nie przy każdym sprawdzeniu. |
| `http_status` | Dostawca odpowiedział błędem. Zwykle jest to chwilowy problem po jego stronie; następne sprawdzenie spróbuje ponownie. |
| `not_taxonomy` | Pod adresem jest strona internetowa — często ekran logowania albo komunikat serwera proxy. Otwórz adres w przeglądarce, żeby zobaczyć, co faktycznie zwraca. |
| `empty` / `truncated` / `too_large` | Pobrany plik był pusty, niekompletny albo większy, niż platforma akceptuje. Nic nie zostało zainstalowane. |
| `no_nodes` / `implausible` | Plik został pobrany, ale nie udało się odczytać z niego żadnych kategorii albo odczytano ich zdecydowanie za mało. Nic nie zostało zainstalowane. |
| `incomplete_languages` | Plik w jednym języku został pobrany, a w drugim nie. Lista jest instalowana tylko wtedy, gdy oba pliki są kompletne. |

**W każdym z tych przypadków feedy pozostają nienaruszone** i nadal korzystają z już zainstalowanej
listy. Nieudane sprawdzenie nigdy nie powoduje błędu generowania ani startu i nigdy nie ponawia
prób lawinowo — ponowną próbą jest następne zaplanowane sprawdzenie, a przycisk *Check now* jest dla
niecierpliwych.

**Zatwierdzanie.** Wersja zaczyna obowiązywać dopiero po zatwierdzeniu, a do przycisku zatwierdzenia
można dojść wyłącznie przez podgląd skutków. Podgląd jest liczony na Twoich rzeczywistych danych i
mówi to, co naprawdę musisz wiedzieć: ile Twoich mapowań wymagałoby wskazania nowej kategorii, ile
znowu zaczęłoby działać i — co najważniejsze — ile kategorii sklepu **w ogóle przestałoby wysyłać
kategorię dostawcy**, łącznie z tymi, które dziedziczą mapowanie po kategorii nadrzędnej.
Zatwierdzenie jest audytowane, atomowe i odwracalne: powrót do wcześniejszej listy to ta sama akcja
wykonana na wcześniejszym wierszu.

Żądanie przenosi liczby, które zobaczyłeś w podglądzie, więc jeśli ktoś inny zmieni mapowania, gdy
Twój podgląd jest otwarty, zatwierdzenie zostanie odrzucone, a liczby przeliczone. W tym mechanizmie
nic nie może zmienić zawartości feedu bez tego, by ktoś przeczytał ten ekran i kliknął przycisk.

### Harmonogram

Na karcie Settings wybierz gotowe ustawienie (co godzinę, co 4 godziny, codziennie…) albo **Custom**
z pięciopolowym wyrażeniem cron i strefą czasową IANA. Własne wyrażenie jest powtarzane prostym
językiem („Co 4 godziny, w minucie 0”), a najbliższe uruchomienie jest zawsze widoczne.

- Uruchomienie, które przypada, gdy poprzednie generowanie wciąż trwa, jest **pomijane z podaniem
  powodu** — nigdy nie trafia do kolejki za nim. Pominięte uruchomienia są wyszarzone na liście
  generowań.
- Panel ostrzega, gdy średni czas generowania feedu zbliża się do odstępu między uruchomieniami.
- Wyłączenie feedu zatrzymuje zarówno harmonogram, jak i publiczny adres URL.
- Źródłem prawdy o harmonogramach jest Postgres; kolejka to indeks pochodny odbudowywany przy
  starcie, więc wyczyszczenie Redisa niczego nie traci.

### Link i jego wymiana

Publiczny adres URL zawiera losowy token. Karta **Feed link** pokazuje go w całości, gdy tylko feed
ma ważny token, razem z przyciskiem kopiowania, żebyś mógł skopiować go ponownie przy każdej zmianie
konfiguracji u dostawcy.

Przechowywane są dwie rzeczy: skrót (hash) tokena, który jako jedyny jest porównywany przez publiczny
endpoint, oraz sam token, zaszyfrowany kluczem `SETTINGS_SECRET_ENCRYPTION_KEY` — tym samym, którego
używają już sekrety ustawień i dane uwierzytelniające. Zaszyfrowana kopia jest odczytywana tylko
wtedy, gdy administrator otwiera feed, nigdy przy publicznym żądaniu.

Każdy, kto ma link, może odczytać plik, a plik zawiera Twoje ceny. Traktuj link jak dane
uwierzytelniające: udostępnij go dostawcy, który go potrzebuje, i wymień go, jeśli wycieknie.

- We wdrożeniu **bez `SETTINGS_SECRET_ENCRYPTION_KEY`** oraz w przypadku linków wydanych przed tą
  wersją platformy karta pokazuje tylko początek tokena. Wymień link, żeby dostać taki, który można
  skopiować.
- **Rotate** wydaje nowy adres URL i unieważnia stary **natychmiast**, bez okresu przejściowego.
  Dostawca, który wciąż ma skonfigurowany stary adres, przestaje dostawać aktualizacje, dopóki nie
  wkleisz nowego.
- **Revoke** zostawia feed bez publicznego adresu URL i usuwa przechowywaną kopię tokena razem z jego
  skrótem. Pobieranie pliku przez administratora nadal działa.
- Adres URL zwraca nagłówek `Cache-Control: private` i obsługuje `If-None-Match`, więc ponowna
  weryfikacja po stronie dostawcy jest tania.
- Endpoint ma limit żądań (domyślnie 60 na minutę); dostawcy pobierają plik kilka razy dziennie.

Pobranie wygenerowanego pliku w panelu administracyjnym wymaga uprawnienia **Manage product feeds**,
a nie tylko **View product feeds** — plik zawiera Twoje ceny.

### Jak czytać wynik generowania

Każde generowanie tworzy wiersz z licznikami: rozważone, wysłane, pominięte, ostrzeżenia. Otwórz go,
żeby zobaczyć problemy z poszczególnymi pozycjami, **pogrupowane według powodu**, z SKU każdej
pozycji, której dotyczą, i eksportem pełnej listy do CSV.

| Powód | Znaczenie |
| --- | --- |
| `missing_price` | Nie znaleziono ceny dla waluty i cennika feedu. |
| `missing_image` | Produkt nie ma publicznie dostępnego zdjęcia. |
| `private_image_asset` | Zdjęcia istnieją, ale nie są publiczne, więc nie można było opublikować stałego adresu URL. |
| `missing_required_field` | Pole wymagane przez dostawcę okazało się puste i nie miało wartości zastępczej — pozycja została pominięta. |
| `missing_translation` | Brak wartości w języku feedu; użyto języka zastępczego. |
| `unresolvable_link` | Kanał nie ma skonfigurowanego adresu URL storefrontu. |
| `unmapped_provider_category` | Nie zastosowano żadnego mapowania kategorii; pole zostało pominięte. |
| `stale_provider_category_mapping` | Zmapowany węzeł nie istnieje w zainstalowanej wersji taksonomii. |
| `zero_tax_rate_on_gross_feed` | Feed z cenami brutto nie znalazł reguły podatkowej dla swojego kraju opodatkowania. |

Błędy generowania to coś innego niż problemy z pozycjami: kończą generowanie i niczego nie publikują.

| Błąd | Znaczenie |
| --- | --- |
| `channel_unavailable` | Kanał feedu nie istnieje lub jest wyłączony. Nic nie zostaje opublikowane — feed nigdy nie rozszerza się na cały katalog. |
| `unbound_template_fields` | Szablon ma pola niepowiązane z żadnym źródłem (zwykle po imporcie). |
| `unknown_attribute` | Kryteria wskazują atrybut, który już nie istnieje. |
| `skip_threshold_exceeded` | Pominięto ponad połowę rozważonych pozycji, więc dobry plik nie został zastąpiony złym. |
| `storage_unavailable` | Magazyn plików odrzucił plik. |
| `worker_lost` | Worker przestał działać w trakcie generowania; blokada została zwolniona, a częściowy plik usunięty. |

Gdy generowanie kończy się błędem, administrator dostaje powiadomienie — **raz przy przejściu w stan
błędu**, a nie przy każdym uruchomieniu, więc feed zepsuty od doby nie zapełnia listy powiadomień.

### Uprawnienia

| Kod | Daje dostęp do |
| --- | --- |
| `product_feeds:read` | Przeglądania feedów, szablonów, historii generowań, problemów i mapowań kategorii. |
| `product_feeds:write` | Tworzenia i edycji feedów i szablonów, generowania, wymiany lub unieważniania linku, mapowania kategorii i pobierania wygenerowanych plików. |

Administrator z dostępem tylko do odczytu widzi każdy ekran, a kontrolki zapisu są **widoczne, ale
nieaktywne** i każda wyjaśnia dlaczego — nigdy nie są ukrywane.

### Ustawienia

W **Settings → Product feeds**:

| Ustawienie | Wartość domyślna | Działanie |
| --- | --- | --- |
| Generated files kept per feed | 3 | Starsze pliki są usuwane po udanym generowaniu; opublikowany plik jest zawsze zachowywany. |
| Maximum concurrent feed generations | 2 | Na proces workera. |
| Skipped-item share that fails a run | 0.5 | Powyżej tego udziału generowanie kończy się błędem zamiast publikacji. |
| Stale run timeout (minutes) | 30 | Generowanie, które przez ten czas nie dało znaku życia, jest uznawane za utracone. |
| Recorded issues per run | 1000 | Limit zapisanych problemów z pozycjami; nadmiar jest zgłaszany. |
| Public feed requests per minute | 60 | Limit żądań do anonimowego adresu URL. |
| Category-mapping tree limit | 1000 | Powyżej tej liczby ekran mapowania używa stronicowanej płaskiej listy. |

---

### Dostarczanie feedu na serwer partnera

Google i Meta same pobierają link, więc większość feedów nie wymaga tu żadnych ustawień.
Marketplace'y i integracje z systemami ERP zwykle oczekują czegoś odwrotnego: pliku umieszczonego na
serwerze, który regularnie sprawdzają. Właśnie to konfiguruje karta **Delivery** feedu.

Feed ma **najwyżej jeden** serwer docelowy, a dostarczanie włącza się i wyłącza niezależnie od jego
konfiguracji — możesz więc skonfigurować partnera teraz i zacząć wysyłkę w przyszłym tygodniu albo
wstrzymać wysyłkę bez utraty ustawień.

| Protokół | Działanie | Pola |
| --- | --- | --- |
| **SFTP** | Przesyła plik przez SSH. Zalecany wybór. | Host, port, użytkownik, hasło **lub** klucz prywatny, katalog |
| **FTP** | Przesyła plik przez FTP, najpierw próbując FTPS. | Host, port, użytkownik, hasło, katalog |
| **HTTP Server / API / GraphQL** | Wysyła plik metodą `POST` pod adres URL. | Adres URL żądania, nagłówki |

Trzy ostatnie to **jeden mechanizm pod trzema nazwami**. Dokumentacja partnera może nazywać jego
endpoint API albo endpointem GraphQL; platforma i tak wysyła to samo żądanie, a wybór zmienia tylko
etykietę na ekranie.

#### Kiedy następuje dostarczenie

Po generowaniu, które **zakończyło się udaną publikacją**, i tylko wtedy. Generowanie zakończone
błędem, puste albo pominięte, bo poprzednie jeszcze trwało, niczego nie wysyła — plik, który partner
już ma, jest nadal aktualny, a ponowne wysłanie zapowiadałoby zmianę, która nie nastąpiła.

Jeśli przesyłanie się nie powiedzie, generowanie pozostaje udane, a opublikowany link nadal działa.
Dostarczenie jest ponawiane kilka razy z rosnącym odstępem; jeśli nadal się nie udaje, ponawianie
ustaje, a administrator dostaje powiadomienie. Każda próba — udana czy nie — jest widoczna na liście
pod kartą, razem z powodem.

#### Sekrety

Hasła, klucze prywatne i każdy nagłówek, którego nazwa wskazuje, że zawiera token (`Authorization`,
`X-Api-Key` i podobne), są przechowywane w postaci zaszyfrowanej i **nigdy nie są ponownie
pokazywane**. Zapisany sekret wyświetla się jako `[redacted]`, a pozostawienie tej wartości bez zmian
go zachowuje — dzięki temu zmiana ścieżki katalogu nie może po cichu skasować hasła.

#### Dwie odmowy, o których warto wiedzieć

- **Dla protokołów HTTP adres `http://` jest odrzucany.** Nagłówek uwierzytelniający jest wysyłany
  razem z żądaniem, więc adres musi zaczynać się od `https://`.
- **Adresy prywatne i wewnętrzne są odrzucane**, w tym `169.254.169.254` i wszystko w Twojej własnej
  sieci. Feed zawiera cały katalog z cenami; platforma wyśle go tylko tam, dokąd da się dotrzeć z
  publicznego internetu.

Sam protokół FTP z założenia przesyła dane bez szyfrowania. Platforma prosi każdy serwer FTP o TLS i
wraca do zwykłego FTP tylko wtedy, gdy serwer odmówi, ale jeśli partner udostępnia SFTP, wybierz SFTP.

#### Test połączenia

**Test connection** sprawdza, czy serwer docelowy jest osiągalny i czy dane uwierzytelniające
działają, bez wysyłania feedu. W przypadku SFTP i FTP zapisuje i od razu usuwa jeden mały plik, bo
katalog bez prawa zapisu to właśnie ten błąd, którego test samego połączenia by nie wykrył. Test ma
limit wywołań dla każdego feedu.

## Dla inżynierów

### Struktura

```
packages/modules/product_feeds/src/backend/
├── entities/          9 tables, all @GlobalEntity (no tenant column anywhere)
├── services/          selection, resolution, serializers, runs, tokens, taxonomies
├── commands/          feed / template / taxonomy-mapping Commands
├── workers/           generation consumer + stale-run reaper
├── seeds/             the five predefined templates
├── data/taxonomies/   bundled Google + Meta revisions (see PROVENANCE.md)
├── routes.admin.ts    /api/v1/admin/product-feeds
├── routes.templates.ts /api/v1/admin/feed-templates, /feed-previews/*
├── routes.taxonomies.ts /api/v1/admin/feed-taxonomies
└── routes.public.ts   GET /api/v1/public/product-feeds/:token
```

Kontrakty znajdują się w `packages/contracts/src/product-feeds.ts`; warstwa panelu
administracyjnego — w `packages/modules/product_feeds/src/admin/`.

### Potok generowania

```
selection (ids only, keyset on products.id)
  → hydrate a batch of 500
    → resolve each item (pure)
      → serialize (one chunk per item)
        → artefactStore.put(stream)
→ publish by flipping ONE pointer, after put() resolves
```

Cztery właściwości, za które odpowiada ten potok:

- **Nic nie jest buforowane.** Źródłem pozycji jest generator asynchroniczny, serializatory emitują
  jeden fragment na pozycję, adapter magazynu plików przyjmuje `Readable`, a `em.clear()` jest
  wywoływane po każdej partii — zarówno w pętli selekcji, jak i w pętli hydratacji, bo `emFactory()`
  tworzy fork, a EntityManager żyjący przez całe generowanie trzyma każdy wiersz, którego dotknął.
  Pomiar dla 100 000 produktów: 38 MB XML w 205 s, ze szczytowym zużyciem sterty **+18,5 MB** ponad
  poziom bazowy, rosnącym o około 107 bajtów na każdą kolejną pozycję
  (`backend/test/perf/product_feeds/generation-100k.test.ts`, `PERF_RUN=true`).
- **Problem z pojedynczą pozycją nigdy nie przerywa generowania.** Pominięcia i ostrzeżenia są
  zapisywane dla każdej pozycji; generowanie kończy tylko błąd konfiguracji.
- **Publikacja to jedno przestawienie wskaźnika po skompletowaniu obiektu.** Generowanie zakończone
  błędem, puste albo przekraczające próg pominięć nigdy nie zmienia `published_artefact_id`.
- **Nakładające się generowania są odrzucane, a nie kolejkowane.** Przejęcie generowania to
  warunkowy `UPDATE` na `product_feeds.current_run_id`; przegrany zapisuje
  `skipped(already_running)`.

Pozostały przyrost pamięci opisany wyżej nie pochodzi od pozycji: to lista identyfikatorów członków
kanału, materializowana przed stronicowaniem (około 90 bajtów na produkt w kanale). To O(kanał), a
nie O(feed).

### Dostarczanie

Dostarczanie to **efekt uboczny po publikacji**, podpięty w tym samym punkcie rozszerzenia co
retencja i powiadomienie o nieudanym generowaniu: `deliverArtefact` to opcjonalny port w
`FeedGenerationDeps`, wywoływany w gałęzi publikacji i nigdzie indziej. To umiejscowienie jest
samym wymaganiem — generowanie, które niczego nie opublikowało, nie może niczego dostarczyć — i
zarazem tym, co oddziela błąd dostarczenia od generowania, które w chwili próby przesłania już się
zakończyło.

```
run publishes  →  deliverArtefact?(feedId, runId, artefactId)   [port, optional]
                    → enqueue on product_feeds.deliver
                      → resolve config + secrets
                        → adapter.send(stream, target)          [transport SPI]
                          → record attempt
```

Bez Redisa port dostarcza plik **od razu, w tym samym procesie**, zamiast umieszczać zadanie w
kolejce. W przeciwnym razie wdrożenie jednoprocesowe pozwoliłoby operatorowi skonfigurować serwer
docelowy, nie zobaczyć żadnego błędu i nigdy niczego nie dostarczyć.

Dwie tabele, obie należące do modułu: `product_feed_deliveries` (jeden wiersz na feed, wymuszony
indeksem unikalnym) i `product_feed_delivery_attempts` (tylko dopisywanie, z limitem na feed).

**Nie ma kolumny z sekretem.** `credential_code` wskazuje konfigurację modułu `credentials`, który
odpowiada za szyfrowanie danych w bazie i maskowanie przy odczycie; podział na nagłówki z sekretem i
bez niego wykonuje `isSecretDeliveryHeader` w pakiecie kontraktów — celowo na podstawie reguły, a nie
pola wyboru dla operatora. `credentials` jest więc w manifeście zależnością *usługową*, a nie
wynikającą z klucza obcego.

Interfejs SPI transportu (`services/delivery/delivery-adapter.interface.ts`) przyjmuje `Readable`,
nigdy `Buffer`, z tego samego powodu co serializatory — i jest punktem rozszerzenia dla modułu
nakładkowego, który chce obsłużyć niestandardowy protokół partnera. `HttpDeliveryAdapter` korzysta z
reguł adresów z `taxonomy-source-url.ts`, zamiast je kopiować: dwa zabezpieczenia przed SSRF w
jednym module to jedno, które zostanie naprawione, i drugie, które nie zostanie.

Nic, co jest zapisywane przy próbie dostarczenia, nie jest daną uwierzytelniającą. `target` to
postać do wyświetlenia z ukrytymi sekretami, a każdy komunikat o błędzie przechodzi przez
`delivery-redaction.ts`, które działa **na podstawie wartości** — dostaje dokładnie te sekrety,
których dotyczy operacja, i usuwa te ciągi znaków, zamiast zgadywać, jak wygląda hasło.

Środowisko testowe wstrzykuje adaptery, które odmawiają każdej wysyłki, z tego samego powodu, dla
którego wstrzykuje moduł pobierania taksonomii niezdolny do pobierania: żaden test w tym
repozytorium nie może nigdzie wysłać katalogu z cenami.

### Zawężenie do kanału

Przynależność do kanału jest odczytywana **wyłącznie** przez wstrzyknięty port
`SalesChannelMembershipService.listEntityIdsForChannel`; moduł nigdy nie odpytuje tabel łączących
`sales_channel_*`. Minimalne warunki kwalifikacji, reguła operatora i kursor stronicowania (keyset)
są łączone jawnym `$and` — nigdy rozwinięciem obiektu, które po cichu gubi zdublowany klucz `id` i
kiedyś całkowicie wyłączyło zawężenie do kanału dla kryteriów kategorii.

Nie ma gałęzi, która przepuszczałaby w razie wątpliwości: kanał, którego nie da się ustalić albo
który jest nieaktywny, zgłasza `ChannelUnavailableError`, a generowanie kończy się odmową.
Zabezpieczeniem przed regresją jest `backend/test/integration/product_feeds/channel-isolation.test.ts`,
który sprawdza też publiczny adres URL, bo ten endpoint nie wymaga uwierzytelnienia.

### Audyt

Każdy zapis wykonywany przez operatora jest poleceniem (Command):
`product_feeds.feed.create|update|delete|duplicate`, `product_feeds.token.rotate|revoke`,
`product_feeds.run.start`, `product_feeds.template.create|update|duplicate|delete|import`,
`product_feeds.taxonomy_mapping.set`, `product_feeds.taxonomy_revision.promote` i
`product_feeds.taxonomy_check.start`. Każde z nich zapisuje dokładnie jeden wpis w dzienniku audytu,
przypisany do administratora, który je wykonał; cały import szablonu to jeden wpis, a nie jeden na
pole.

Dwa ostatnie warto czytać razem. Zatwierdzenie wersji taksonomii to **jedyny** zapis w mechanizmie
aktualizacji, który zmienia zawartość feedu, dlatego jest poleceniem; ręczne uruchomienie
sprawdzenia jest audytowane, bo zapisuje, kto poprosił platformę o wysłanie żądania na zewnątrz —
dokładnie tak, jak `product_feeds.run.start` zapisuje, kto zlecił generowanie.

Praca maszynowa — generowanie według harmonogramu, czyszczenie starych plików, zwalnianie
porzuconych generowań, odwzorowanie harmonogramów w Redisie, instalacja taksonomii oraz
**sprawdzenie taksonomii według harmonogramu razem z nieaktywną wersją, którą może zainstalować** —
**niczego nie zapisuje** w dzienniku audytu, a każdy taki zapis ma znacznik
`command-coverage-ignore: <reason>`, żeby kontrola statyczna pozostała rzetelna. Sprawdzenie według
harmonogramu jest pracą maszynową właśnie dlatego, że nie może zmienić wyniku: wiersz audytu dla
każdego cotygodniowego sprawdzenia w każdej instalacji zagrzebałby faktyczne decyzje operatora w
szumie, a tabela historii sprawdzeń jest pełniejszym zapisem niż wpis w dzienniku audytu. Pilnuje
tego `backend/test/integration/product_feeds/command-coverage.test.ts`.

### Taksonomie dostawców

Wersja taksonomii trafia do bazy danych dokładnie na dwa sposoby i oba tworzą ten sam rodzaj wiersza.

**Dostarczana z platformą.** Wersje są zapisane na dysku w
`data/taxonomies/<providerCode>/<revision>/<language>.txt` i instaluje je przy starcie mechanizm
uzgadniający, w jednej transakcji na wersję. Ta ścieżka nie otwiera żadnego połączenia sieciowego i
nigdy nie otwierała. Instalacja bieżącego zestawu (8 562 węzły w czterech plikach) trwa około
**2 sekund**; potem pliki nie są już otwierane, bo najpierw sprawdzana jest baza danych. Dostarczona
wersja jest oznaczana jako bieżąca tylko wtedy, gdy dostawca nie ma jeszcze bieżącej wersji — w
świeżej bazie dotyczy to każdej pierwszej instalacji, a w długo działającej oznacza, że aktualizacja
platformy nie może po cichu zastąpić wersji wybranej przez operatora.

**Pobierana od dostawcy.** Opcjonalne sprawdzenie, **domyślnie wyłączone**, pobiera pliki
opublikowane przez dostawcę i instaluje zmienioną wersję jako **nieaktywną** (zobacz
[Aktualizacje taksonomii](#taxonomy-updates)). Taka wersja nie może sama zacząć obowiązywać.

**Generowanie nigdy nie zależy od połączenia z dostawcą.** Generowanie odczytuje obowiązującą wersję
z Postgresa i z nikim się nie łączy, więc dostawca niedostępny, powolny albo zwracający bzdury daje
nieudane *sprawdzenie*, nigdy nieudane ani zmienione *generowanie* — a instalacja z wyłączonym
przełącznikiem w ogóle nie wysyła żądań na zewnątrz.

Instalacja bez dostarczonych danych uruchamia się normalnie: ekran mapowania informuje, że nie
zainstalowano żadnej taksonomii, a `g:google_product_category` jest traktowane jako niezmapowane, co
pomija to pole, ale pozycja i tak trafia do pliku.

Pochodzenie dostarczanych plików dostawców, ich zmierzone rozmiary i **otwarte pytanie o licencję**
opisuje `packages/modules/product_feeds/src/backend/data/taxonomies/PROVENANCE.md`. Wycofanie danych
sprowadza się do usunięcia katalogu wersji danego dostawcy; kodu nie trzeba zmieniać.

### Kolejki

Dwa elementy BullMQ, rejestrowane tylko wtedy, gdy `BACKEND_ROLE !== 'api'`:

- `product_feeds.generate` — jedno zadanie na generowanie; worker je przejmuje, po każdej partii
  sygnalizuje, że działa, generuje plik, publikuje go, a następnie stosuje retencję. Zadanie jest
  idempotentne przy ponownym dostarczeniu.
- wspólne dla modułu czyszczenie co 5 minut, które zwalnia przejęcia bez aktualnego sygnału życia,
  oznacza generowanie jako `failed(worker_lost)` i usuwa częściowy obiekt.

Harmonogramy poszczególnych feedów to BullMQ Job Schedulers o kluczach `feed:<id>`; mechanizm
uzgadniający przy starcie tworzy lub aktualizuje harmonogram każdego włączonego feedu z
harmonogramem i usuwa każdy harmonogram `feed:*`, który nie ma już odpowiednika.

### Przechowywanie plików

Pliki przechodzą przez adapter magazynu plików modułu Biblioteka mediów (Assets Library), ale pod
własnym prefiksem tego modułu (`product-feeds/…`), zawsze jako **prywatne** i nigdy jako wiersze
`Asset`: nie są mediami biblioteki, nie mogą pojawiać się w przeglądarce mediów i nie mogą być
dostępne pod publicznym adresem URL zasobu. Publiczna trasa feedu przesyła strumieniowo sam obiekt —
dzięki temu wymiana tokena rzeczywiście odbiera dostęp.

### Testy

```bash
pnpm --filter backend exec vitest run test/unit/product_feeds
pnpm --filter backend exec vitest run test/contract/product_feeds
pnpm --filter backend exec vitest run test/integration/product_feeds
PERF_RUN=true pnpm --filter backend exec vitest run test/perf/product_feeds
```

Wspólne środowisko testowe celowo łączy ten moduł **bez Redisa i bez BullMQ** — uruchamia się raz na
plik testowy w jednym procesie potomnym, a połączenia z kolejką już wcześniej wyłączały w nim setki
plików błędem „too many clients”. Testy wywołują bezpośrednio
`productFeeds.generation.generateNow(...)`. Środowisko testowe kieruje też mechanizm uzgadniający
taksonomie do nieistniejącego katalogu, więc dostarczane pliki danych czyta wyłącznie
`taxonomy-bundled-data.test.ts`.

### Celowo poza zakresem tej wersji

- Dostarczanie e-mailem i API konkretnych marketplace'ów (Amazon SP-API, eBay, Allegro). Wysyłka
  obejmuje tylko SFTP, FTP i HTTP — zobacz **Dostarczanie** wyżej.
- Feedy przyrostowe, uzupełniające lub różnicowe — każde generowanie tworzy cały plik od nowa.
- Wiele krajów lub walut w jednym pliku; zamiast tego zduplikuj feed.
- Pobieranie taksonomii w czasie działania.
