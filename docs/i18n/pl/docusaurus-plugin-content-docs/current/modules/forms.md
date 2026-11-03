---
title: Formularze
description: Kreator formularzy — formularze z sekcjami, logiką warunkową i tłumaczeniami, umieszczane na stronach blokiem Formularz, z zapisanymi zgłoszeniami, notatkami, eksportem CSV, powiadomieniami e-mail, okresem przechowywania i zdarzeniem webhooka
---

# Formularze

Moduł **Formularze** pozwala budować własne formularze — formularz kontaktowy, zapytanie
ofertowe, ankietę, zapisy na wydarzenie — i umieszczać je na dowolnej stronie Page Buildera
blokiem **Formularz** (`forms.Form`). Każde wysłanie jest zapisywane jako **zgłoszenie**, które
zespół czyta, obsługuje i eksportuje w panelu administracyjnym. Zgłoszenie może powiadomić sklep
e-mailem, potwierdzić odbiór osobie, która je wysłała, i trafić do innego systemu przez webhook.

Moduł jest opcjonalny: operator włącza go i wyłącza na ekranie **Moduły** panelu
administracyjnego (`/platform/modules`). Gdy jest wyłączony, nic nie ginie (zobacz
[Wyłączenie modułu](#switching-the-module-off)).

## Formularze a blok Formularz kontaktowy {#forms-and-the-contact-form-block}

Blok **Formularz kontaktowy** modułu CMS (`cms.ContactForm`) pozostaje bez zmian i działa dalej.
Oba służą czemu innemu:

| | Formularz kontaktowy (`cms.ContactForm`) | Formularz (`forms.Form`) |
| --- | --- | --- |
| Pola | Stały zestaw | Dowolne pola, w sekcjach i kolumnach |
| Wysłania | Tylko e-mail, **nic nie jest zapisywane** | Zapisane zgłoszenia ze statusami, notatkami i eksportem |
| Logika | Brak | Pola i sekcje pokazywane lub ukrywane zależnie od wcześniejszych odpowiedzi |
| Tłumaczenia | Tylko teksty wbudowane | Każdy tekst formularza, dla każdego języka sklepu |
| Odbiorcy | Jedno ustawienie na kanał sprzedaży | Dla formularza, z osobną listą dla kanału sprzedaży |
| Integracje | Brak | Zdarzenie i webhook `forms.entry.submitted.v1` |

Strony, które już używają bloku Formularz kontaktowy, wyglądają dokładnie tak jak wcześniej.
Nic nie zamienia jednego bloku w drugi.

## Gdzie to znaleźć {#where-to-find-it}

- **Menu boczne**: **Formularze** (lista formularzy) i **Zgłoszenia z formularzy**.
- **Paleta poleceń** (⌘K / CTRL+K): „Formularze”, „Nowy formularz” i „Zgłoszenia z formularzy”.
- **Uprawnienia**:

| Uprawnienie | Pozwala |
| --- | --- |
| Przeglądanie formularzy (`forms:read`) | Lista formularzy, kreator tylko do odczytu, wybór formularza w bloku |
| Tworzenie i edycja formularzy (`forms:write`) | Tworzenie, edycja, publikowanie, zamykanie, ponowne otwieranie, duplikowanie i usuwanie formularzy |
| Przeglądanie zgłoszeń z formularzy (`forms:entries_read`) | Lista zgłoszeń i szczegóły zgłoszenia |
| Obsługa i usuwanie zgłoszeń z formularzy (`forms:entries_write`) | Statusy, notatki i usuwanie zgłoszeń |
| Eksport zgłoszeń z formularzy (`forms:entries_export`) | Eksport CSV |

Usunięcie formularza **razem** ze zgłoszeniami i zmiana **okresu przechowywania** formularza
wymagają uprawnień *Tworzenie i edycja formularzy* **oraz** *Obsługa i usuwanie zgłoszeń
z formularzy*, a także administratora, który widzi wszystkie organizacje — zobacz
[Zgłoszenia a organizacje](#entries-and-organisations).

## Budowanie formularza {#building-a-form}

Otwórz **Formularze → Nowy formularz**, podaj nazwę formularza i jego język domyślny (jeden
z języków, w których działają sklepy). Formularz dostaje **klucz** utworzony z nazwy — stały
identyfikator używany w eksporcie i przez integracje. Klucz można zmienić, ale każdy klucz jest
niepowtarzalny wśród formularzy.

Nowy formularz jest **szkicem**: klienci go nie widzą, dopóki go nie opublikujesz. Kreator ma
cztery karty — *Pola*, *Ustawienia*, *Powiadomienia* i *Wersje* — a nad nimi wspólny dla nich
przełącznik [języka treści](#translations).

### Pola {#fields}

Panel *Formularz* na górze zawiera nazwę formularza — widoczną tylko dla administratorów — oraz
teksty, które klienci widzą wokół pól: tytuł, opis i tekst przycisku wysyłania.

Przeciągnij pole z palety do sekcji albo naciśnij je, aby dodać je do sekcji, którą edytujesz;
każdy ruch można też wykonać klawiaturą. Wybierz pole, aby edytować je w panelu obok układu
formularza; jego ustawienia są podzielone na podstawowe, walidację, logikę warunkową i integracje. Sekcja ma układ 1, 2 lub 3 kolumn, a każde pole zajmuje
w nich określoną szerokość. Na wąskim ekranie sklep układa wszystkie pola w jednej kolumnie.

Rodzaje pól:

- **tekst jednowierszowy**, **tekst wielowierszowy**, **e-mail**, **telefon** (numery
  międzynarodowe), **liczba**;
- **lista rozwijana**, **przyciski opcji**, **grupa pól wyboru**, **pojedyncze pole wyboru** —
  każda opcja ze stałą wartością i etykietą do przetłumaczenia;
- **data/godzina** — data, godzina albo data z godziną;
- **kraj** — nazwy krajów w języku klienta, opcjonalnie tylko wybrane kraje;
- **adres** — ulica i numer, dodatkowy wiersz, kod pocztowy, miasto i kraj, każda część z własną
  etykietą i oznaczeniem wymagalności;
- **pole ukryte** — stała wartość albo wartość wzięta ze strony: jej adres, jej tytuł, wskazany
  parametr adresu URL albo adres strony odsyłającej. Wartość jest skracana do limitu pola i zawsze
  zapisywana oraz pokazywana jako zwykły tekst;
- **treść** (tekst sformatowany) i **podział sekcji**, które o nic nie pytają;
- **zgoda na przetwarzanie danych**, **zgoda marketingowa** i **akceptacja regulaminu** — pole
  wyboru z tekstem sformatowanym, który może zawierać odnośniki. Zgłoszenie zapisuje, czy zgodę
  wyrażono, **i dokładny tekst, który był pokazany**, aby można było ją później udowodnić. Zgoda na
  przetwarzanie danych i akceptacja regulaminu są zawsze wymagane, gdy są widoczne; zgoda
  marketingowa nigdy nie jest wymagana ani zaznaczona z góry.

Każde pole do wypełnienia ma etykietę, opcjonalny tekst zastępczy, opcjonalną podpowiedź,
oznaczenie wymagalności, opcjonalną wartość domyślną i szerokość. Opcje sprawdzania zależą od
rodzaju pola: długość tekstu, minimum, maksimum i krok liczby, najwcześniejsza i najpóźniejsza
data, ile opcji grupy pól wyboru można zaznaczyć, a dla tekstu jednowierszowego wzorzec wybrany
z gotowych (tylko cyfry, tylko litery, litery i cyfry, adres strony WWW). Każdy wbudowany komunikat
o błędzie można zastąpić własnym, osobno dla każdego pola.

Jedno pole e-mail można oznaczyć jako **e-mail osoby wysyłającej**. Jego odpowiedź staje się
adresem Reply-To powiadomienia dla sklepu i adresem e-maila potwierdzającego.

Pole można też oznaczyć opcją **Udostępniaj integracjom** — zobacz
[Integracje: zdarzenie webhooka](#integrations-the-webhook-event).

**Podgląd** obok kreatora pokazuje formularz tak, jak wyświetli go sklep, razem z logiką
warunkową obliczaną na podstawie tego, co wpiszesz w podglądzie.

### Logika warunkowa {#conditional-logic}

Pole albo całą sekcję można pokazać tylko wtedy, gdy pozwalają na to wcześniejsze odpowiedzi.
Reguła składa się z **grup warunków**: w grupie warunki łączy się spójnikiem *i* albo *lub*, do
wyboru, a grupy łączy się tym drugim — można więc zapisać „(A i B) lub C”.

Dostępne operatory to *równa się*, *nie równa się*, *większe niż*, *mniejsze niż*, *zawiera*,
*nie zawiera*, *jest puste* i *nie jest puste*; każdy jest oferowany tylko tam, gdzie ma sens dla
rodzaju pola, którego dotyczy.

Pole ukryte przez własną regułę albo regułę swojej sekcji nigdy nie jest wymagane; to, co w nim
wpisano, jest odrzucane i nie jest zapisywane, a inne reguły traktują je jako puste. Sklep
i serwer obliczają reguły tak samo, więc klient nie może wysłać odpowiedzi na pole, którego nie
widział.

### Wersje — publikowanie {#versions-publishing}

**Opublikuj** zamraża kopię roboczą jako nową, numerowaną **wersję**; klienci zawsze dostają
najnowszą opublikowaną wersję. Edycja opublikowanego formularza niczego dla klientów nie zmienia,
dopóki nie opublikujesz go ponownie. Każde zgłoszenie zapisuje wersję, według której zostało
przyjęte, a jego szczegóły i eksport pokazują je z etykietami i opcjami tej wersji.

Publikacja jest odrzucana, z powodem pokazanym przy elemencie, którego dotyczy, gdy formularz nie
jest poprawny: powtórzony lub brakujący klucz pola, pole wyboru bez opcji, reguła odwołująca się do
pola, które nie istnieje, albo zależna od samej siebie w kółko, więcej niż jedno pole e-maila osoby
wysyłającej, minimum większe od maksimum albo adres przekierowania, który nie jest adresem WWW.

Kreator **ostrzega** też, nie blokując publikacji, gdy na którymś kanale nikt nie dostaje
powiadomień o nowych zgłoszeniach, gdy formularz wymaga CAPTCHA, która nie jest skonfigurowana,
i gdy brakuje tekstów w którymś języku sklepu.

Opublikowany formularz można **zamknąć** — zostaje na swoich stronach i pokazuje komunikat
o zamknięciu — i później **otworzyć ponownie**. Formularz można **zduplikować** jako nowy szkic.
Formularz bez zgłoszeń można od razu usunąć; przy formularzu ze zgłoszeniami trzeba potwierdzić,
że zgłoszenia też zostaną usunięte. Jeśli ktoś inny zapisał formularz, odkąd go otworzyłeś, Twój
zapis zostanie odrzucony: wczytaj formularz ponownie i wprowadź zmianę jeszcze raz.

Karta *Wersje* pokazuje każdą opublikowaną wersję z datą i autorem.

### Powiadomienia {#notifications}

- **Powiadomienie dla sklepu** — do 10 adresów, które dostają e-mail o każdym nowym zgłoszeniu,
  z widocznymi odpowiedziami, nazwą formularza i stroną, z której go wysłano, w domyślnym języku
  kanału sprzedaży zgłoszenia. Kanał sprzedaży może mieć **własną listę**, która zastępuje na nim
  listę domyślną; pusta lista nie wysyła tam nic. Odbiorców zapisuje się osobno i obowiązują od
  następnego zgłoszenia — bez publikowania. Nigdy nie pojawiają się w sklepie ani w publicznej
  definicji formularza.
- **Reply-To** — gdy formularz ma pole e-maila osoby wysyłającej i zostało ono wypełnione,
  odpowiedź na powiadomienie trafia do osoby, która wysłała formularz.
- **E-mail potwierdzający** — opcjonalnie osoba wysyłająca dostaje e-mail z Twoim tematem i treścią,
  w języku, którego użyła, i — jeśli tak ustawisz — z podsumowaniem odpowiedzi. Jest wysyłany
  najwyżej raz na zgłoszenie i nigdy dla zgłoszenia oznaczonego jako spam.

E-maile są wysyłane w tle; błąd poczty nigdy nie powoduje odrzucenia zgłoszenia. Każda próba
wysyłki jest widoczna w rejestrze wysyłek e-mail platformy. Rejestr wysyłek nigdy nie przechowuje
odpowiedzi.

### Ustawienia {#settings}

- **Po wysłaniu** — komunikat (Twój albo wbudowane podziękowanie), przekierowanie pod inny adres
  albo strona CMS pokazana w języku klienta. Bez modułu CMS albo gdy strony nie da się pokazać,
  wyświetlany jest komunikat.
- **Ograniczenia** — maksymalna liczba zgłoszeń (spam się nie liczy), okres dostępności (od, do;
  każdą granicę można zostawić otwartą) i **tylko zalogowani klienci**. Serwer egzekwuje każde
  z nich, a blok pokazuje odpowiedni komunikat — zamknięty, jeszcze nieotwarty, pełny albo „zaloguj
  się, aby wysłać ten formularz” — który możesz napisać i przetłumaczyć; domyślne komunikaty są
  przetłumaczone.
- **Ochrona przed spamem** — zobacz [Ochrona przed spamem](#spam-protection).
- **Okres przechowywania** — zobacz [Okres przechowywania](#retention).

### Tłumaczenia {#translations}

Każdy tekst, który piszesz — tytuł i opis, etykiety, teksty zastępcze, podpowiedzi, etykiety opcji,
treści, teksty zgód, komunikaty, potwierdzenie oraz temat i treść e-maila — można napisać dla
każdego języka sklepu. Przełącznik **języka treści** na górze kreatora pokazuje języki sklepów,
zaczynając od języka domyślnego formularza; karty *Pola*, *Ustawienia* i *Powiadomienia* oraz
podgląd zawsze pokazują wybrany język.

W języku domyślnym edytujesz wszystko. W innym języku edytujesz tylko teksty, każdy w miejscu,
w którym występuje w kreatorze: pola, sekcje, zapisywane wartości opcji, reguły, walidacja
i pozostałe ustawienia są zablokowane, więc formularz ma te same pola, opcje i reguły w każdym
języku. Pusty tekst pokazuje jako podpowiedź tekst w języku domyślnym, bo właśnie ten tekst widzą
klienci; po wyczyszczeniu tekstu znów jest używany tekst domyślny.

Obok przełącznika każdy język z brakującymi tekstami jest oznaczony liczbą braków; wybierz to
oznaczenie, aby otworzyć ten język przy pierwszym brakującym tekście. Teksty wbudowane — komunikaty
sprawdzania, przycisk wysyłki, wyniki — są przetłumaczone razem ze sklepem.

## Umieszczanie formularza na stronie {#placing-a-form-on-a-page}

W Page Builderze dodaj blok **Formularz** z kategorii *Formularze* i wybierz formularz. Lista
pokazuje formularze, które możesz zobaczyć, z ich statusem, a **Utwórz nowy formularz** otwiera
ekran formularzy; formularz utworzony w ten sposób można wybrać bez przeładowania edytora.
Redaktor bez uprawnienia *Przeglądanie formularzy* zamiast listy widzi wyjaśnienie.

Blok przechowuje tylko odwołanie do formularza i jego wygląd: wygląd pól (w ramce, podkreślenie
albo zaokrąglony), rozmiar (S, M, L), wygląd przycisku wysyłki, wyrównanie oraz to, czy pokazać
tytuł i opis formularza. Przejmuje kolory strony. Cała reszta — pola, logika, odbiorcy,
komunikaty — należy do formularza, więc po publikacji zmiana formularza trafia na każdą stronę,
która go pokazuje, w ciągu mniej więcej minuty.

Ten sam formularz może być na kilku stronach, a także dwa razy na jednej: każdy blok pokazuje
własny wynik i własne błędy.

Szkic formularza nie pokazuje klientom niczego; w edytorze komunikat w bloku wyjaśnia, dlaczego
formularz nie jest widoczny.

### Bez JavaScriptu {#without-javascript}

Formularz działa bez JavaScriptu: jest wysyłany do sklepu, który przenosi klienta z powrotem na
tę samą stronę i do tego samego bloku z wynikiem, a jeśli coś było źle — z jego odpowiedziami
i błędami. Wszystkie pola warunkowe są wtedy widoczne, a serwer odrzuca odpowiedzi na pola, które
reguły ukrywają. Z JavaScriptem wynik pokazuje się w miejscu formularza.

Formularza, który **wymaga CAPTCHA**, nie da się wysłać bez JavaScriptu, bo obaj dostawcy
potrzebują swojego skryptu: blok pokazuje wtedy przetłumaczoną informację, że formularz potrzebuje
JavaScriptu, aby sprawdzić, czy wysyła go człowiek. Formularze bez CAPTCHA działają bez JavaScriptu
w pełni.

## Ochrona przed spamem {#spam-protection}

- Każdy formularz ma ukryte **pole-pułapkę**. Wysłanie, które je wypełnia, dostaje odpowiedź, że
  zostało przyjęte, ale nic nie jest zapisywane, wysyłane ani publikowane.
- Liczba wysłań jest **ograniczona dla każdego adresu**: 10 w ciągu 10 minut. Powyżej limitu klient
  dostaje prośbę, by spróbował później.
- Wysłanie ma ograniczony rozmiar (256 KB), a każda odpowiedź — długość.
- **CAPTCHA** — jeden dostawca dla całego sklepu, **Cloudflare Turnstile** albo **hCaptcha**,
  ustawiany w **Ustawienia → grupa Forms**: *CAPTCHA provider*, *CAPTCHA site key* i *CAPTCHA
  secret key* (klucz tajny jest przechowywany w postaci zaszyfrowanej i nigdy więcej nie jest
  pokazywany). Następnie włącz **Wymagaj weryfikacji CAPTCHA** w każdym formularzu, który jej
  potrzebuje. Gdy formularz jej wymaga, a dostawca jest skonfigurowany, serwer odrzuca wysłanie,
  którego dostawca nie potwierdził, a gdy dostawca nie odpowiada — prosi klienta, by za chwilę
  spróbował ponownie. Formularz, który wymaga CAPTCHA bez skonfigurowanego dostawcy, jest wysyłany
  bez sprawdzenia, a kreator o tym ostrzega.

Skrypt dostawcy jest ładowany tylko na stronach z formularzem, który go wymaga. To treść podmiotu
zewnętrznego: wymień dostawcę w swojej polityce prywatności.

## Zgłoszenia {#entries}

**Zgłoszenia z formularzy** pokazują wszystkie zgłoszenia, które możesz zobaczyć, od najnowszych.
Można je filtrować według formularza, statusu, daty i kanału sprzedaży oraz przeszukiwać e-mail
osoby wysyłającej i odpowiedzi tekstowe.

Zgłoszenie zawiera odpowiedzi na pola, które były widoczne, formularz i wersję, kanał sprzedaży,
język, stronę, z której je wysłano, czas, zgody z pokazanymi tekstami, a gdy wysłał je zalogowany
klient — jego konto klienta i organizację. To przypisanie pochodzi z sesji, nigdy z adresu e-mail
wpisanego w formularz.

- **Statusy** — *nowy*, *przeczytany*, *zamknięty* i *spam*. Otwarcie zgłoszenia zmienia status
  z *nowy* na *przeczytany*; możesz ustawić dowolny status, także z powrotem *nowy*, i cofnąć
  zmianę.
- **Notatki** — wewnętrzne notatki z autorem i czasem. Notatki nigdy nie są pokazywane klientowi
  ani wysyłane w e-mailu czy zdarzeniu.
- **Eksport** — *Eksportuj CSV* pobiera zgłoszenia wybranego formularza z ustawionymi filtrami:
  identyfikator zgłoszenia, formularz, wersja, status, kanał, język, czas wysłania i strona, a potem
  po jednej kolumnie na każdy klucz pola ze wszystkich wersji formularza. Wartość, którą arkusz
  kalkulacyjny uruchomiłby jako formułę, jest unieszkodliwiana. Notatki nie są eksportowane. Duże
  eksporty są przesyłane strumieniowo, więc nie blokują panelu.
- **Usuwanie** — jednego zgłoszenia albo zaznaczonych, po potwierdzeniu. Usunięcie jest
  ostateczne: zgłoszenie i jego notatki znikają, a w dzienniku zdarzeń nie zostaje nic
  z odpowiedzi.

Każda zmiana — formularza, statusu zgłoszenia, notatki, usunięcie, eksport — jest zapisywana
w dzienniku zdarzeń bez odpowiedzi.

### Zgłoszenia a organizacje {#entries-and-organisations}

Administrator, który widzi tylko niektóre organizacje (na przykład przedstawiciel handlowy),
widzi wyłącznie zgłoszenia klientów tych organizacji i żadnych zgłoszeń anonimowych. Zgłoszenie,
którego nie może zobaczyć, wygląda dokładnie tak jak zgłoszenie, które nie istnieje.

Dwie zmiany usuwają zgłoszenia **wszystkich** organizacji naraz — usunięcie formularza razem ze
zgłoszeniami i zmiana jego okresu przechowywania. Taki administrator dostaje przy nich odmowę
z informacją, że może to zrobić tylko administrator, który widzi wszystkie organizacje
(`FORM_SCOPE_REQUIRED`).

## Okres przechowywania {#retention}

Na karcie *Ustawienia* sekcja **Okres przechowywania** określa, jak długo zgłoszenia formularza
są przechowywane. Gdy włączona jest opcja **Usuwaj zgłoszenia automatycznie** i podany jest okres
od 1 do 3650 dni, zadanie w tle uruchamiane co 15 minut usuwa zgłoszenia starsze niż ten okres,
razem z ich notatkami. Bez okresu zgłoszenia są przechowywane, dopóki ktoś ich nie usunie.

Okres obowiązuje od chwili zapisania — nie jest częścią wersji i nie wymaga publikacji. Przed
zapisaniem panel mówi, ile istniejących zgłoszeń usunie nowy okres, i zapisuje go dopiero po
potwierdzeniu, bo usuniętych zgłoszeń nie da się przywrócić. Każda partia usunięta przez zadanie
jest zapisywana w dzienniku zdarzeń z formularzem, datą graniczną i liczbą.

## Usunięci i zanonimizowani klienci {#deleted-and-anonymised-customers}

Gdy konto klienta zostaje **zanonimizowane** — to nieodwracalny krok, który usuwa dane osobowe
usuniętego konta, gdy nie można go już przywrócić — każde zgłoszenie przypisane do tego konta jest usuwane razem z notatkami, w tym samym
kroku. Konto, które jest tylko usunięte i nadal można je przywrócić, zachowuje swoje zgłoszenia,
które wracają razem z nim.

**Zgłoszenia wysłane bez logowania nie są dopasowywane**, nawet jeśli mają ten sam adres e-mail:
platforma nie łączy zgłoszenia z osobą na podstawie wpisanego adresu. Aby zrealizować żądanie
usunięcia danych obejmujące takie zgłoszenia, wyszukaj adres na liście zgłoszeń i usuń znalezione
zgłoszenia ręcznie.

Jeśli konto zanonimizowano, gdy moduł Formularze był wyłączony, jego zgłoszenia usunie pierwsze
uruchomienie zadania w tle po ponownym włączeniu modułu.

## Integracje: zdarzenie webhooka {#integrations-the-webhook-event}

Dla każdego przyjętego zgłoszenia moduł publikuje zdarzenie **`forms.entry.submitted.v1`**, które
można zasubskrybować na ekranie **Webhooki**. Jego treść zawiera identyfikator zgłoszenia,
identyfikator i klucz formularza, wersję, kanał sprzedaży, organizację (albo jej brak), język,
stronę i czas wysłania. Nigdy nie zawiera notatek, odbiorców ani tekstów zgód.

**Odpowiedzi są dołączane tylko dla pól oznaczonych _Udostępniaj integracjom_** w kreatorze,
według klucza pola — ustawienie dotyczy pojedynczego pola, domyślnie jest wyłączone i zapisuje się
w każdej wersji. Gdy żadne pole nie jest oznaczone, zdarzenie nie zawiera odpowiedzi, a integracja
odczytuje zgłoszenie przez API panelu administracyjnego z uprawnieniem *Przeglądanie zgłoszeń
z formularzy*. Dla trafienia w pole-pułapkę ani dla odrzuconego wysłania żadne zdarzenie nie jest
publikowane.

Udostępnione odpowiedzi opuszczają sklep razem z webhookiem, **a ponadto są przechowywane
w rejestrze wysyłek webhooków i w zadaniu wysyłki, dopóki moduł webhooków ich nie wyczyści**.
Usunięcie zgłoszenia nie usuwa tych kopii. Udostępniaj tylko odpowiedzi, które wysłałbyś poza
sklep.

## Wyłączenie modułu {#switching-the-module-off}

Gdy moduł Formularze jest wyłączony, zachowuje się tak, jakby nie był zainstalowany: edytor nie
oferuje bloku Formularz, a strona, która go zawiera, nie pokazuje w sklepie niczego w jego
miejscu (edytor oznacza blok jako brakujący); znikają ekrany formularzy, pozycje w menu bocznym,
akcje palety poleceń i grupa ustawień Forms; każdy adres API formularzy jest odrzucany; zadania
w tle i e-maile zatrzymują się; a zdarzenie webhooka nie jest ani oferowane, ani wysyłane.

Nic nie jest usuwane. Formularze, wersje, zgłoszenia, notatki i ustawienia zostają, a po
ponownym włączeniu modułu wszystko wraca — wtedy wysyłane są oczekujące e-maile, a pierwsze
uruchomienie zadania w tle stosuje okresy przechowywania i anonimizacje klientów, które nastąpiły
w międzyczasie.
