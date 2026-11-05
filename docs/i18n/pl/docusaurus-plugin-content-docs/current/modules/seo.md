---
title: seo
description: Wyznaczanie meta tagów, mapa witryny XML z pamięcią podręczną, ustawienia robots dla wyszukiwarek i llms.txt
---

# `seo`

Wyznaczanie meta tagów dla każdej strony, publiczna mapa witryny XML oraz to, co wyszukiwarki
dowiadują się o całym sklepie danego kanału sprzedaży.

## API publiczne

| Metoda i ścieżka | Kto | Przeznaczenie |
| --- | --- | --- |
| `GET /api/v1/catalog/sitemap.xml` | roboty wyszukiwarek | Mapa witryny XML z pamięci podręcznej; gdy jest nieaktualna, jest generowana od razu w trakcie żądania |
| `GET /api/v1/storefront/seo/robots-policy` | sklep | Domyślna polityka robots kanału sprzedaży, którego dotyczy żądanie, w postaci `{ index, follow }` |
| `GET /api/v1/storefront/seo/crawler-files` | sklep | To, z czego powstają pliki `robots.txt` i `llms.txt` kanału sprzedaży, którego dotyczy żądanie: jego własne instrukcje i dodatkowa treść wraz z polityką, nazwą sklepu i informacją, czy sklep jest otwarty dla anonimowych odwiedzających. Odpowiada także w sklepie dla nich zamkniętym |
| `GET /api/v1/admin/seo/crawler-files/preview` | administrator (`settings:read`) | Podgląd pliku `robots.txt` albo `llms.txt` kanału sprzedaży — domyślnego kanału systemowego, gdy żaden nie został wskazany: część generowana przez jego sklep, pobrana z tego sklepu, obok zapisanego tekstu |
| `GET /api/v1/admin/seo/sitemap` | administrator (`catalog:write`) | Jeden wiersz na kanał sprzedaży: adres sklepu, czas ostatniego wygenerowania, rozmiar, liczba adresów URL |
| `POST /api/v1/admin/seo/sitemap/:channelCode/regenerate` | administrator (`catalog:write`) | Wymuszenie ponownego wygenerowania dla tego kanału |
| `GET /api/v1/admin/seo/sitemap/:channelCode/status` | administrator (`catalog:write`) | Czas ostatniego wygenerowania, rozmiar i liczba adresów URL dla tego kanału |
| `GET /api/v1/admin/seo/sitemap/:channelCode/xml` | administrator (`catalog:write`) | Zapisany XML tego kanału, do podglądu lub pobrania (`?download=1`) |
| `GET /api/v1/admin/seo/meta/product/:id` | administrator (`catalog:read`) | Metadane produktu w danym zakresie (`?channelId=`, `?languageCode=`): własna albo dziedziczona wartość każdego pola, wyznaczone metadane i źródło każdej wartości |
| `GET /api/v1/admin/seo/meta/:entityType/:entityId` | administrator (`catalog:write`) | Wyznaczone meta tagi kategorii lub strony CMS w danym języku (`?locale=`) i wiersz nadpisania w tym języku |
| `PUT /api/v1/admin/seo/meta/:entityType/:entityId` | administrator (`catalog:write`) | Utworzenie lub aktualizacja nadpisania kategorii lub strony CMS w danym języku (`locale` w treści żądania); dla produktu odpowiedź to `422 VALIDATION_FAILED` |
| `DELETE /api/v1/admin/seo/meta/:entityType/:entityId` | administrator (`catalog:write`) | Usunięcie nadpisania kategorii lub strony CMS w danym języku (`?locale=`); dla produktu odpowiedź to `422 VALIDATION_FAILED` |

## Roboty wyszukiwarek

**Ustawienia → SEO → Domyślne robots** decyduje o tym, co wyszukiwarki dowiadują się o każdej
stronie sklepu danego kanału sprzedaży. To przełącznik, którym można wyłączyć cały sklep
z wyników wyszukiwania — kopię testową, wersję demonstracyjną, sklep przed otwarciem — bez
zmieniania jakiejkolwiek strony.

| Wybór | O co prosi wyszukiwarki |
| --- | --- |
| `INDEX, FOLLOW` (domyślnie) | o nic: każda strona mówi to, co mówiła wcześniej |
| `NOINDEX, FOLLOW` | aby nie pokazywały stron sklepu w wynikach, ale podążały za ich linkami |
| `INDEX, NOFOLLOW` | aby pokazywały strony, ale nie podążały za ich linkami |
| `NOINDEX, NOFOLLOW` | aby nie pokazywały stron i nie podążały za ich linkami |

Cztery opcje to same dyrektywy i w każdym języku wyglądają tak samo. Jak każde ustawienie, to
również ma wartość dla wszystkich kanałów sprzedaży oraz wartości dla poszczególnych kanałów;
własna wartość kanału ma pierwszeństwo, a jej zresetowanie przywraca dziedziczenie. Zmiana
wymaga uprawnienia `settings:write` i jest zapisywana w dzienniku audytu: kto ją wprowadził,
kiedy i jaką wartość zapisał. Paleta poleceń (⌘K / CTRL+K) otwiera ekran Ustawień pod hasłem
*Roboty wyszukiwarek*.

### Co robi z tym sklep

Dla kanału, którego ustawienie coś ogranicza, sklep dodaje dyrektywę do odpowiedzi wysyłanych
dla tego kanału, w dwóch postaciach:

- nagłówek odpowiedzi `X-Robots-Tag` — na każdej stronie, także na stronach „nie znaleziono"
  (`404`) i na stronie offline, w `/sitemap.xml`, na zoptymalizowanych obrazach (`/_next/image`)
  i na plikach z katalogu `public/`;
- jeden dodatkowy element `<meta name="robots">` w sekcji `<head>` stron, które sklep renderuje
  dla żądania.

Trzy rodzaje odpowiedzi są poza tym zakresem i żadnego z nich wyszukiwarka nie indeksuje:

- pliki skryptów i stylów samego builda w `/_next/static` nie mają ani nagłówka, ani elementu;
- przekierowanie zadeklarowane w pliku `next.config.js` sklepu (na przykład dawne adresy
  `/cms/…`) nie ma ani jednego, ani drugiego — odpowiedź powstaje, zanim uruchomi się
  middleware sklepu;
- strony „nie znaleziono" (`404`) i statycznie zbudowana strona `/offline` mają nagłówek, ale
  nie mają dodatkowego elementu. Obie same deklarują `noindex, nofollow`.

**Ustawienie wyłącznie dodaje ograniczenia.** Strona, która sama deklaruje `noindex` — koszyk,
kasa, strony konta — zachowuje własny tag niezależnie od wyboru, a wtedy ma dwa tagi robots.
Wyszukiwarka, która odczytuje kilka dyrektyw robots dla jednego adresu, stosuje najbardziej
restrykcyjną z nich, więc ustawienie nigdy nie sprawi, że prywatna strona stanie się
indeksowalna. Przy `INDEX, FOLLOW` nic nie jest dodawane, a odpowiedzi sklepu są takie same jak
przed wprowadzeniem tego ustawienia.

### Dlaczego `robots.txt` pozostaje otwarty

*Domyślne robots* nie zmienia pliku `robots.txt`, a kanał z `NOINDEX` nie może go zamykać wpisem
`Disallow: /`. Robot musi pobrać stronę, żeby odczytać, że nie wolno jej indeksować; strona,
której nie wolno mu pobrać, nadal może trafić do wyników — po samym adresie — jeśli linkują do
niej inne witryny.

To samo dotyczy tego, co operator wpisuje do pliku — zobacz niżej
[*Nie używaj ich, aby zniknąć z wyników wyszukiwania*](#nie-używaj-ich-aby-zniknąć-z-wyników-wyszukiwania).

### Ile trwa wprowadzenie zmiany

Sklep pyta backend o politykę kanału najwyżej raz na minutę, więc zapisana zmiana obowiązuje
w sklepie w ciągu minuty lub dwóch. Wyszukiwarki uwzględniają ją przy kolejnej wizycie na każdej
stronie, co trwa dni lub tygodnie; strona, która jest już w indeksie, znika z niego dopiero po
ponownym odwiedzeniu przez robota.

Odczyt polityki nie spowalnia sklepu, gdy backend odpowiada wolno. Sklep, który zna już politykę
kanału, daje odświeżeniu ułamek sekundy, a potem dalej serwuje to, co zna, i pozwala odświeżeniu
dokończyć się w tle.

### Gdy moduł jest wyłączony

Wyłączenie modułu `seo` na ekranie modułów platformy wycofuje ustawienie: sklep w ciągu minuty
lub dwóch przestaje wysyłać nagłówek i dodatkowy tag, więc **kanał ustawiony na `NOINDEX` znów
staje się indeksowalny**. Ustawienie przechodzi w tryb tylko do odczytu i zachowuje zapisaną
wartość, pozycje w palecie poleceń znikają, a `GET /api/v1/storefront/seo/robots-policy`
odpowiada `503` `MODULE_DISABLED`. Ponowne włączenie modułu przywraca działanie zapisanej
wartości.

Własne instrukcje `robots.txt` są wycofywane razem z nim, na tych samych zasadach: plik
`robots.txt` wraca do reguł generowanych przez sklep i pozostaje dostępny, ustawienie
przechodzi w tryb tylko do odczytu i zachowuje tekst, a po ponownym włączeniu modułu tekst jest
znów serwowany.

Plik `llms.txt` znika razem z modułem, i to w całości: gdy moduł jest wyłączony, sklep odpowiada
na `/llms.txt` „nie znaleziono”, ponieważ cały ten plik należy do tej funkcji. Dodatkowa treść
pozostaje zapisana, jej ustawienie przechodzi w tryb tylko do odczytu, a po ponownym włączeniu
modułu plik jest znów serwowany.

### Dwa ograniczenia

- **Pliki serwowane przez backend nie są objęte.** Zdjęcia produktów i inne przesłane media
  serwuje backend, pod własnym adresem, bez nagłówka `X-Robots-Tag`. Strony kanału z `NOINDEX`
  znikają z wyszukiwarek; pliki jego obrazów nadal może znaleźć wyszukiwarka grafiki, która
  trafi do nich bezpośrednio.
- **Świeżo uruchomiony sklep jeszcze nic nie wie.** Sklep przechowuje ostatnio odczytaną
  politykę w pamięci własnego procesu i stosuje ją dalej, gdy backend jest niedostępny. Sklep
  uruchomiony w czasie, gdy backend jest niedostępny, nie ma czego zastosować i do pierwszego
  udanego odczytu serwuje strony tego kanału bez domyślnej dyrektywy. To także jedyny moment,
  w którym odpowiedź czeka na politykę: na pierwszy odczyt kanału po uruchomieniu sklep czeka
  do dwóch sekund, jeden raz. Żadna strona nigdy nie kończy się błędem dlatego, że nie udało się
  odczytać polityki.

### Sklep utworzony przed tą funkcją

Dyrektywę nakładają pliki samego sklepu: `middleware.ts` i `app/layout.tsx`, własne
instrukcje — jego plik `app/robots.txt/route.ts`, a `llms.txt` — jego plik
`app/llms.txt/route.ts`. Sklep utworzony z wcześniejszego wydania
działa dalej ze zaktualizowanym backendem, ale **ignoruje te ustawienia**, dopóki te pliki nie
zostaną zaktualizowane: ekran Ustawień pokazuje wybór i tekst, a nic w takim sklepie ich nie
stosuje — jego `robots.txt` pozostaje plikiem, z którym sklep został zbudowany, a pliku
`llms.txt` nie ma wcale. Ekran Ustawień
informuje o tym tam, gdzie ma na to dowód: gdy sklep odpowiada backendowi, nie potwierdzając,
że obsługuje te ustawienia, wiersz *Domyślne robots* i oba podglądy informują, że sklep może
działać w starszej wersji, która ich nie stosuje. Lista plików do
skopiowania oraz plik do usunięcia są podane w informacjach o wydaniu: sklep, który zachowa stary
plik `app/robots.ts` obok nowej trasy, nadal serwuje stary plik, a build tego nie zgłasza.

### Dla własnego sklepu

`GET /api/v1/storefront/seo/robots-policy` jest publiczny i ustala kanał sprzedaży na podstawie
nagłówka `X-Sales-Channel` żądania, a gdy go brak — przyjmuje domyślny kanał systemowy:

```json
{ "data": { "index": false, "follow": false } }
```

Odpowiedź jest wysyłana z `Cache-Control: no-store`; zakłada się, że buforuje ją odbiorca.
Schemat to `storefrontRobotsPolicyResponseSchema` w `@endora-commerce/contracts`; odbiorca
powinien ignorować pola, których nie zna, aby kolejne wydanie mogło dodać nowe.

Statusy należy traktować różnie. `503` z `error.code: "MODULE_DISABLED"` oraz `404` oznaczają,
że polityki nie ma — nie należy stosować żadnej. Każdy inny błąd, także `500`, oznacza, że
polityki nie udało się odczytać: należy zachować ostatnio odczytaną. Punkt końcowy odpowiada
`500`, a nie „brak ograniczeń", gdy zapisana wartość nie jest jedną z czterech opcji — do czego
trzeba wiersza zapisanego z pominięciem API ustawień.

## Własne instrukcje `robots.txt`

**Ustawienia → SEO → Własne instrukcje robots.txt** to tekst, który sklep dopisuje do pliku
`robots.txt` kanału sprzedaży — reguły dla konkretnego robota, dodatkowy wpis `Disallow`,
`Crawl-delay`. Domyślnie jest pusty, a pusty tekst pozostawia plik dokładnie takim, jaki był.

### Co zawiera plik i w jakiej kolejności

1. **Reguły generowane przez sklep.** Zamykają rodziny adresów, które nigdy nie są indeksowane —
   koszyk, kasę, konto, strony logowania, `/api/` — i wskazują mapę witryny. Odzwierciedlają
   trasy samego sklepu; nie są ustawieniem i na ekranie Ustawień nie da się ich edytować ani
   usunąć.
2. **Pusty wiersz.**
3. **Twój tekst**, w takiej postaci, w jakiej został wpisany.

Na przykład po zapisaniu dla kanału wierszy `User-agent: GPTBot` i `Disallow: /`:

```text
User-Agent: *
Allow: /
Disallow: /api/
Disallow: /account
…
Disallow: /offline

Sitemap: https://shop.example.com/sitemap.xml

User-agent: GPTBot
Disallow: /
```

Tekst jest serwowany **tak, jak został wpisany**: każdy znak zostaje zachowany, w tej samej
kolejności — wcięcia, puste wiersze, komentarze. Ujednolicane są dwie rzeczy dotyczące końców
wierszy: każdy koniec wiersza jest serwowany jako znak nowego wiersza (LF), niezależnie od tego,
jak tekst został zapisany, a plik zawsze kończy się dokładnie jednym. Pomijany jest też jeden
niewidoczny znak: znacznik kolejności bajtów (BOM) na samym początku tekstu, który niektóre
edytory dodają przy zapisie pliku — robot nie rozpoznałby wiersza, do którego jest doklejony.
Nic w tekście nie jest sprawdzane ani poprawiane; wiersz, którego robot nie rozumie, jest
serwowany jak każdy inny.

**Grupa napisana dla jednego robota zastępuje dla niego reguły generowane.** Robot stosuje się
do grupy, która go wymienia, i pomija wtedy grupę `*`, więc po wierszu `User-agent: GPTBot`
i Twoich regułach GPTBot nie widzi już generowanych wierszy `Disallow`. Powtórz je w tej grupie,
jeśli nadal mają go obowiązywać. Samych wierszy generowanych nie da się zmienić, ale wpis `Allow`
tej samej długości co generowany `Disallow` ma przed nim pierwszeństwo. To, czy stronę można
indeksować, nie zależy od żadnej z tych rzeczy: strony zamykane przez te reguły same deklarują
`noindex`.

Jak każde ustawienie, to również ma wartość dla wszystkich kanałów sprzedaży oraz wartości dla
poszczególnych kanałów, a własna wartość kanału ma pierwszeństwo — także pusta, która sprawia,
że kanał nie ma własnych instrukcji niezależnie od tekstu dla wszystkich kanałów. Tekst jednego
kanału nigdy nie trafia do pliku innego kanału. **Reset** usuwa własny tekst kanału, więc kanał
znów dziedziczy tekst dla wszystkich kanałów; zresetowanie także jego pozostawia same reguły
generowane. Zmiana tekstu wymaga uprawnienia `settings:write` i jest zapisywana w dzienniku
audytu.

### Podgląd

Pod polem ekran Ustawień pokazuje plik `robots.txt`, który serwuje sklep danego kanału
sprzedaży, jako **jeden blok, który jest tym plikiem** — ten sam tekst, linia po linii, który
pobiera robot:

- najpierw linie generowane przez sklep, wraz z jego linią `Sitemap:`, oznaczone etykietą
  **Generowane przez sklep · tylko do odczytu**. Należą do sklepu, a panel administracyjny za
  każdym razem pyta o nie sklep, zamiast przechowywać kopię, która mogłaby się zdezaktualizować;
- potem pusta linia, a po niej Twoje linie, oznaczone paskiem po lewej stronie i etykietą
  **Twoje instrukcje**.

Nagłówek mówi, na który plik patrzysz. Gdy nic nie czeka na zapisanie, jest to **robots.txt
serwowany obecnie**. Gdy tylko pole zaczyna różnić się od zapisanej wartości, blok podąża za
tym, co wpisujesz, a nagłówek zmienia się na **robots.txt po zapisaniu** — plik, który sklep
będzie serwował po zapisaniu; do tego czasu sklep nadal serwuje poprzednią wersję, o czym
podgląd informuje. Podgląd niczego nie zmienia w tym, co serwuje sklep.

Podgląd dotyczy kanału sprzedaży wybranego u góry ekranu Ustawień. W trybie **Wszystkie
kanały** pokazuje wynik dla jednego kanału, który wybierasz w podglądzie, i wymienia kanały
mające własną wartość — tekst dla wszystkich kanałów ich nie dotyczy, a po wybraniu jednego
z nich podgląd pokazuje plik, który ten kanał faktycznie serwuje. Administratorowi, który nie
może wyświetlać listy kanałów sprzedaży, pokazywany jest domyślny kanał systemowy.

W kanale sprzedaży, w którym *Domyślne robots* ma wartość `NOINDEX`, podgląd informuje, że
`robots.txt` celowo pozostaje otwarty, i ostrzega, gdy Twój tekst zabrania wszystkim robotom
pobierania czegokolwiek (`Disallow: /`) — zobacz
[dlaczego `robots.txt` pozostaje otwarty](#dlaczego-robotstxt-pozostaje-otwarty).

Administrator, który może przeglądać ustawienia, ale nie może ich zmieniać, również widzi
podgląd.

#### Gdy podgląd nie może pokazać pliku

Podgląd nigdy nie pokazuje reguł, których przed chwilą nie pobrał. W każdym z poniższych
przypadków Twój własny tekst jest nadal widoczny, osobno, a zapisywanie działa jak zwykle:

| Komunikat w podglądzie | Co oznacza | Co zrobić |
| --- | --- | --- |
| *Nie udało się połączyć ze sklepem* | Sklep nie odpowiedział w ciągu trzech sekund, odrzucił połączenie, odpowiedział błędem lub przekierowaniem albo czymś, co nie jest tekstowym plikiem `robots.txt` | Sprawdź, czy sklep działa i czy **Storefront URL** kanału to jego rzeczywisty adres — taki, pod którym sklep sam odpowiada, a nie taki, który do niego przekierowuje. **Sprawdź ponownie** pyta jeszcze raz. Przyczynę podaje log serwera |
| *Ten kanał sprzedaży nie ma skonfigurowanego adresu sklepu* | Nie ustawiono ani ustawienia **Storefront URL** kanału, ani zmiennej `STOREFRONT_BASE_URL`, więc nie ma adresu, pod który można zapytać | Ustaw **Ustawienia → Sales Channels → Storefront URL** dla tego kanału |
| *Ten sklep nie potwierdził, że obsługuje własne instrukcje* | Sklep odpowiedział plikiem `robots.txt`, ale bez nagłówka, którym przedstawia się aktualny sklep. Najczęściej działa w wersji sprzed tej funkcji, która serwuje wyłącznie reguły generowane — pokazane jako plik — i ignoruje Twój tekst oraz *Domyślne robots*. Tak samo wygląda serwer proxy usuwający ten nagłówek oraz sklep zaktualizowany tylko częściowo | Zaktualizuj sklep — zobacz [sklep utworzony przed tą funkcją](#sklep-utworzony-przed-tą-funkcją) — i sprawdź poleceniem `curl -sI <sklep>/robots.txt`, czy dociera nagłówek `X-Endora-Crawler-Files`. Odpowiadający komunikat pojawia się w wierszu *Domyślne robots* |
| *Ten adres jest wspólny dla wszystkich kanałów sprzedaży* | Adres pochodzi ze zmiennej `STOREFRONT_BASE_URL`, jednej dla wszystkich kanałów, więc podgląd dotyczy tego wspólnego sklepu | Nic, jeśli instancja ma jeden sklep. Gdy każdy kanał ma własny sklep, ustaw **Storefront URL** każdego kanału |

#### O co backend pyta sklep

Aby pokazać reguły generowane, backend wysyła jedno żądanie do sklepu danego kanału:
`GET <origin adresu sklepu kanału>/robots.txt?part=system`, z kodem kanału w nagłówku
`X-Sales-Channel`. Żądanie jest wysyłane wyłącznie dla zalogowanego administratora, który może
przeglądać ustawienia, wyłącznie pod skonfigurowany adres — nic z tego, co wysyła przeglądarka
administratora, nie jest jego częścią — i wyłącznie do originu tego adresu: ścieżka i parametry
zapisane w skonfigurowanym adresie nie są używane, ponieważ `robots.txt` znajduje się
w katalogu głównym witryny. Żądanie nie podąża za przekierowaniami, czeka najwyżej trzy sekundy,
odczytuje najwyżej 512 KiB, przyjmuje wyłącznie `text/plain` i nie wysyła ciasteczek ani danych
uwierzytelniających. Nic z odpowiedzi nie jest zapisywane.

Sklep musi więc być osiągalny **z backendu** pod skonfigurowanym adresem. Sklep, który jest
publiczny, ale nieosiągalny z sieci backendu, w podglądzie jest pokazywany jako niedostępny,
a poza tym działa bez zmian.

### Limit rozmiaru

Tekst może mieć najwyżej **64 KiB** (65 536 bajtów w UTF-8 — litera spoza ASCII zajmuje dwa
bajty lub więcej). Większy tekst jest odrzucany przy zapisie, z komunikatem podającym limit,
a tekst zapisany wcześniej nadal obowiązuje. Wyszukiwarki czytają tylko pierwsze 500 KiB pliku
`robots.txt`; limit sprawia, że cały plik mieści się w tym z dużym zapasem.

### Nie używaj ich, aby zniknąć z wyników wyszukiwania

Plik `robots.txt` określa, co robot może **pobrać**. Nie określa, co wyszukiwarka **pokazuje**.
Strona, której nie wolno pobrać, nadal może pojawić się w wynikach — po samym adresie, bez
opisu — jeśli linkują do niej inne witryny.

Aby wyłączyć sklep z wyników wyszukiwania, ustaw *Domyślne robots* na `NOINDEX`. I nie dodawaj do
tego `Disallow: /`: robot, któremu nie wolno pobrać strony, nigdy nie odczyta umieszczonego na
niej `noindex`, więc reguła, która wygląda na mocniejszą, wyłącza tę, która działa. Nic, co
zostanie tu wpisane, nie sprawi, że strona deklarująca `noindex` stanie się indeksowalna; może
najwyżej sprawić, że roboty tego nie zobaczą.

### Za serwerem proxy lub siecią CDN

Plik jest inny dla każdego kanału sprzedaży, a sklep rozpoznaje kanał po nagłówku żądania
`X-Sales-Channel`. Wysyła plik z nagłówkami `Cache-Control: public, max-age=60`
i `Vary: X-Sales-Channel`. Dla tego, co stoi przed sklepem obsługującym więcej niż jeden kanał,
wynikają z tego dwie rzeczy:

- serwer proxy musi sam ustawiać `X-Sales-Channel`, osobno dla każdego hosta, i nie może
  przepuszczać wartości przysłanej przez odwiedzającego — inaczej odwiedzający sam wybiera, czyj
  plik zobaczy;
- współdzielona pamięć podręczna, która pomija `Vary` dla takiego nagłówka, musi uwzględniać go
  w kluczu pamięci podręcznej albo w ogóle nie przechowywać `/robots.txt` — inaczej plik jednego
  kanału zostanie podany dla innego.

Sklep obsługujący jeden kanał nie potrzebuje żadnej z nich; jego serwer proxy może ten nagłówek
usuwać.

### Ile trwa wprowadzenie zmiany w pliku

Sklep pyta backend o tekst kanału najwyżej raz na minutę i pozwala robotowi przechowywać plik
przez kolejną minutę, więc zapisana zmiana jest serwowana w ciągu około dwóch minut. Wyszukiwarki
pobierają `robots.txt` według własnego harmonogramu, zwykle mniej więcej raz na dobę.

### Gdy tekstu nie da się odczytać

Sklep, który choć raz odczytał tekst kanału, serwuje tę wersję tak długo, jak długo backend
jest niedostępny. Sklep, który tego nie zrobił — uruchomiony w czasie, gdy backend nie
działał — do pierwszego udanego odczytu odpowiada na `robots.txt` kodem `503`
z `Retry-After: 120`, zamiast serwować same reguły generowane.

To celowe i różni się od zachowania stron. Plik `robots.txt` zwrócony z kodem `200` jest pełnym
oświadczeniem o tym, co wolno pobierać, więc plik, w którym po cichu zabrakłoby Twoich wierszy
`Disallow`, byłby zgodą, której nie udzielono. Wyszukiwarka odczytuje `503` jako „zapytaj
później” i nadal korzysta z kopii, którą już ma. Żaden klient nie czyta tego pliku, więc nic, co
widzi klient, od niego nie zależy.

Na pierwszy odczyt kanału po uruchomieniu sklep czeka do dwóch sekund — a żądanie pliku
`robots.txt` wykonuje dwa takie odczyty jeden po drugim: domyślnej polityki robots kanału,
a potem jego tekstu. Gdy backend przyjmuje połączenia, ale nie odpowiada, pierwsze żądanie może
więc trwać od czterech do pięciu sekund. Następnie sklep przez pięć sekund nie pyta ponownie
i odpowiada od razu. Gdy moduł `seo` jest wyłączony oraz gdy backend nie ma tej funkcji, sklep
serwuje same reguły generowane z kodem `200` — to są odpowiedzi, a nie błędy.

### Odczyt tekstu we własnym sklepie

`GET /api/v1/storefront/seo/crawler-files` jest publiczny i ustala kanał sprzedaży tak samo jak
`robots-policy`:

```json
{
  "data": {
    "index": true,
    "follow": true,
    "robotsTxtCustom": "User-agent: GPTBot\nDisallow: /\n",
    "llmsTxtAdditional": "## About\n\nWe sell bolts.\n",
    "shop": { "name": "Endora Demo" },
    "anonymousAccess": true
  }
}
```

`robotsTxtCustom` i `llmsTxtAdditional` to teksty ustalone dla kanału, dokładnie w zapisanej
postaci — backend nie zmienia w nich żadnego znaku, także końców wierszy. `index` i `follow`
powtarzają politykę kanału, a `shop.name` to skonfigurowana nazwa sklepu albo pusty ciąg znaków.
`anonymousAccess` ma wartość `false` w sklepie zamkniętym dla anonimowych odwiedzających — zob.
[w sklepie zamkniętym dla anonimowych odwiedzających](#w-sklepie-zamkniętym-dla-anonimowych-odwiedzających);
backend sprzed tego ustawienia go nie wysyła, a jego brak oznacza `true`. W odróżnieniu od
wszystkich innych anonimowych odczytów takiego sklepu na ten odczyt jest udzielana odpowiedź.
Schemat to `storefrontCrawlerFilesResponseSchema` w `@endora-commerce/contracts`; pakiet
eksportuje też `composeCrawlerFile(base, extra)` — funkcję, którą referencyjny sklep łączy to, co
generuje, z tekstem — oraz `CRAWLER_TEXT_MAX_BYTES`.

Odpowiedź jest wysyłana z `Cache-Control: no-store`. Statusy należy traktować tak jak dla
`robots-policy`: `503` `MODULE_DISABLED` oraz `404` oznaczają, że własnego tekstu nie ma; każdy
inny błąd, także `500`, oznacza, że tekstu nie udało się odczytać, a wtedy `robots.txt` powinien
być ostatnio serwowaną wersją albo odpowiedzią `503` — nie plikiem bez tekstu.

**Części odpowiedzi zawodzą niezależnie od siebie.** Zapisana wartość, której nie można
serwować, wymaga wiersza zapisanego z pominięciem API ustawień, a to, co punkt końcowy z nią
robi, zależy od tego, który plik jej potrzebuje:

- nieczytelne instrukcje `robots.txt` — wartość, która nie jest tekstem albo jest dłuższa, niż
  można zapisać — powodują błąd całej odpowiedzi, `500`, zamiast odpowiedzi z pustym tekstem;
- nieczytelna wartość ustawienia *Domyślne robots* albo nieczytelna treść `llms.txt` jest
  **wymieniana z nazwy** w dodatkowym polu, `"unreadable": ["policy"]` albo
  `["llmsTxtAdditional"]`, a reszta odpowiedzi jest podawana. `index` i `follow` mają wtedy
  wartość `false`, a `llmsTxtAdditional` jest puste; żadnego z nich nie należy brać za zapisaną
  wartość.

Dlatego plik `robots.txt`, który nie potrzebuje żadnej z tych rzeczy, jest nadal serwowany
w kanale, którego wiersz *Domyślne robots* zawiera coś, czego nikt nie potrafi zinterpretować,
a plik `llms.txt`, który potrzebuje obu, nie jest: dopóki którakolwiek jest wymieniona, należy
odpowiadać `503`. Pola nie ma, gdy wszystko udało się odczytać; nieznane nazwy należy pomijać.
Sam punkt `robots-policy` nadal odpowiada dla takiego wiersza `500`, więc strony zachowują
ostatnio znaną dyrektywę.

`robots.txt` referencyjnego sklepu odpowiada też na `GET /robots.txt?part=system` samymi
regułami generowanymi, a jego `llms.txt` odpowiada na `GET /llms.txt?part=base` samą częścią
generowaną — obie odpowiedzi mają nagłówek `Cache-Control: no-store`, ponieważ każda jest plikiem
bez tekstu operatora pod adresem, który pamięć podręczna mogłaby pomylić z właściwym — i każdą
odpowiedź obu plików oznacza nagłówkiem `X-Endora-Crawler-Files: 1`.

## Dodatkowa treść `llms.txt`

`llms.txt` to plik tekstowy w katalogu głównym witryny, który mówi asystentom AI, czym jest
witryna i gdzie zaczyna się jej publiczna treść — konwencja nowsza i mniej ustalona niż
`robots.txt` ([llmstxt.org](https://llmstxt.org)). Sklep serwuje taki plik dla każdego kanału sprzedaży, pod
adresem `/llms.txt`, a **Ustawienia → SEO → Dodatkowa treść llms.txt** to tekst, który do niego
dodaje. Ustawienie jest domyślnie puste, a plik składa się wtedy z samej części generowanej.

### Co zawiera plik i w jakiej kolejności

1. **Część generowana przez sklep**: nazwa sklepu jako nagłówek, linki do jego głównych
   publicznych stron — strony głównej, katalogu, wyszukiwarki, bloga, strony kontaktowej — oraz
   link do mapy witryny, każdy z pełnym adresem.
2. **Pusty wiersz.**
3. **Twój tekst**, dokładnie tak, jak został wpisany — opis sklepu, linki do stron, które
   asystent powinien przeczytać w pierwszej kolejności, wszystko, na co pozwala konwencja.

Na przykład z krótkim opisem zapisanym dla kanału:

```text
# Endora Demo

## Pages

- [Home](https://shop.example.com/)
- [Catalog](https://shop.example.com/catalog)
- [Search](https://shop.example.com/search)
- [Blog](https://shop.example.com/blog)
- [Contact](https://shop.example.com/kontakt)

## Sitemap

- [Sitemap](https://shop.example.com/sitemap.xml)

## About

We sell industrial fasteners to businesses across Poland.
```

Nazwa sklepu to ustawienie **Shop name** kanału sprzedaży; kanał bez nazwy jest nazywany adresem
hosta sklepu. Część generowana wymienia wyłącznie strony publiczne, które wolno indeksować — tę
samą listę, od której zaczyna się mapa witryny — i nigdy adresu, który `robots.txt` zamyka przed
robotami (koszyk, zamówienie, konto, strony logowania). Strona z listy, której w danej chwili
nie ma, jest pomijana: link do bloga nie jest wpisywany, gdy moduł `blog` jest wyłączony albo
kanał nie ma bloga. Adresy używają jednego publicznego adresu sklepu, tak jak mapa witryny:
sklep obsługujący kilka kanałów sprzedaży podaje ten sam adres w pliku każdego kanału, z nazwą
sklepu właściwą dla kanału. Część generowana jest po angielsku i nie można jej edytować na ekranie
Ustawień.

Twój tekst jest serwowany **tak, jak został wpisany**, na tych samych zasadach co instrukcje
`robots.txt`: każdy znak zostaje zachowany, końce wierszy są serwowane jako znak LF, plik kończy
się dokładnie jednym, a znacznik kolejności bajtów na samym początku jest pomijany. Jak każde
ustawienie przyjmuje wartość dla wszystkich kanałów sprzedaży i wartość dla każdego kanału,
wartość kanału ma pierwszeństwo — także pusta — a tekst jednego kanału nigdy nie jest serwowany
w pliku innego kanału. **Reset** usuwa własny tekst kanału. Zmiana wymaga uprawnienia
`settings:write` i jest zapisywana w dzienniku audytu. Tekst może mieć najwyżej **64 KiB**, czyli
tyle, ile instrukcje `robots.txt`, a dłuższy jest odrzucany z komunikatem, który podaje limit.

### Kiedy plik `llms.txt` nie jest serwowany

**Kanał sprzedaży, którego ustawienie *Domyślne robots* ma wartość `NOINDEX`, nie ma pliku
`llms.txt`**, niezależnie od dodatkowej treści: sklep odpowiada na `/llms.txt` „nie znaleziono”.
Sklep, który prosi wyszukiwarki, aby trzymały się z daleka, nie zaprasza jednocześnie asystentów
AI. Tekst pozostaje zapisany i jest znów serwowany, gdy tylko kanał zezwoli na indeksowanie.
Samo `NOFOLLOW` niczego nie wycofuje.

Plik nie jest też serwowany, gdy moduł `seo` jest wyłączony — zobacz
[gdy moduł jest wyłączony](#gdy-moduł-jest-wyłączony).

To jedyne miejsce, w którym oba pliki się różnią. `robots.txt` jest serwowany w każdym stanie
i w kanale z `NOINDEX` celowo pozostaje otwarty; `llms.txt` jest wycofywany.

### Podgląd pliku `llms.txt`

Pod polem ekran Ustawień pokazuje plik `llms.txt` serwowany przez sklep danego kanału sprzedaży,
tak samo jak [podgląd `robots.txt`](#podgląd): **jeden blok, który jest plikiem**, najpierw
linie generowane, a potem Twoje linie oznaczone paskiem i etykietą **Twoja treść**, pod
nagłówkiem **llms.txt serwowany obecnie** albo — gdy pole różni się od zapisanej wartości —
**llms.txt po zapisaniu**. Wybór kanału w trybie **Wszystkie kanały**, informacja o kanałach
z własną wartością oraz komunikaty dla sklepu, z którym nie można się połączyć albo który nie ma
skonfigurowanego adresu, są takie same jak tam.

W kanale sprzedaży, którego ustawienie *Domyślne robots* ma wartość `NOINDEX`, nie ma pliku do
pokazania i podgląd informuje o tym zamiast bloku: **llms.txt nie jest serwowany**, wraz
z przyczyną. Zmiana ustawienia *Domyślne robots* z powrotem i jej zapisanie przywraca blok.

Komunikat *Ten sklep nie potwierdził, że serwuje plik llms.txt* oznacza, że sklep odpowiedział
bez nagłówka, którym przedstawia się aktualny sklep — najczęściej dlatego, że działa w wersji,
w której pliku `llms.txt` w ogóle nie ma. Zobacz
[sklep utworzony przed tą funkcją](#sklep-utworzony-przed-tą-funkcją).

Aby pokazać część generowaną, backend pyta sklep kanału o `/llms.txt?part=base`, dokładnie na
zasadach opisanych w części [o co backend pyta sklep](#o-co-backend-pyta-sklep). Jedna różnica
w tym, czego odpowiedź pozwala się dowiedzieć administratorowi z prawem odczytu ustawień: gdy
skonfigurowany adres odpowiada „nie znaleziono” bez nagłówka sklepu, ten podgląd informuje, że
sklep nie potwierdził, że serwuje plik, a nie że nie udało się z nim połączyć — adres, pod
którym odpowiada jakiś serwer WWW, da się więc odróżnić od adresu, pod którym nie odpowiada nic.

### Ile trwa wprowadzenie zmiany i co się dzieje, gdy pliku nie da się odczytać

Tak jak w przypadku `robots.txt`: zapisana zmiana — tekstu albo ustawienia *Domyślne robots* —
jest serwowana w ciągu około dwóch minut, a plik jest wysyłany z nagłówkami
`Cache-Control: public, max-age=60` i `Vary: X-Sales-Channel`, więc to, co stoi
[przed sklepem](#za-serwerem-proxy-lub-siecią-cdn), musi traktować `/llms.txt` tak samo jak
`/robots.txt`. Odpowiedź „nie znaleziono” jest wysyłana z `Cache-Control: no-store`.

Sklep, który raz odczytał konfigurację kanału, serwuje tę wersję pliku dalej, gdy backend jest
niedostępny. Sklep, który jej nie odczytał, odpowiada na `/llms.txt` kodem `503` z nagłówkiem
`Retry-After: 120` aż do pierwszego udanego odczytu — nigdy plikiem bez Twojego tekstu i nigdy
plikiem w kanale, który mógł zostać ustawiony na `NOINDEX`.

## W sklepie zamkniętym dla anonimowych odwiedzających

Kanał sprzedaży z wyłączonym przełącznikiem *otwarty dla anonimowych odwiedzających* każdemu
anonimowemu odwiedzającemu — a robot nim jest — pokazuje stronę logowania. Nie ma w nim niczego do
pobrania, umieszczenia w wynikach ani przeczytania, a jego mapa witryny jest pusta. Pliki
`robots.txt` i `llms.txt` są mimo to serwowane i mówią dokładnie to:

- **`robots.txt`** zamyka cały sklep dla wszystkich robotów i nie wskazuje mapy witryny:

  ```text
  User-Agent: *
  Disallow: /
  ```

- **`llms.txt`** podaje nazwę sklepu, tak jak część generowana, i informuje, że jego treść jest
  dostępna tylko dla zalogowanych klientów. Nie wymienia żadnej strony ani mapy witryny:

  ```text
  # Endora Trade

  > The content of this store is available to signed-in customers only.
  ```

**Zamknięty sklep ma pierwszeństwo przed ustawieniami.** W zamkniętym sklepie nie są serwowane ani
własne instrukcje `robots.txt`, ani dodatkowa treść `llms.txt`: grupa napisana dla jednego robota
zastąpiłaby dla niego `Disallow: /` i otworzyła mu sklep, a dodatkowa treść wskazywałaby strony,
których nikt anonimowo nie przeczyta. Oba teksty są zachowywane i wracają do plików, gdy tylko
sklep zostanie otwarty dla anonimowych odwiedzających. Z tego samego powodu *Domyślne robots* nie
ma tu wpływu na żaden z plików: zamknięty sklep ustawiony na `NOINDEX` nadal ma swój `llms.txt`,
bo ten plik nikogo do niczego nie zaprasza.

Zmiana przełącznika dociera do plików na tych samych zasadach co każda inna zmiana — w ciągu
około dwóch minut. Sklep otwarty dla anonimowych odwiedzających serwuje oba pliki dokładnie tak,
jak opisano wyżej. Gdy moduł `seo` jest wyłączony, sklep nie odróżnia sklepu zamkniętego od
otwartego i — jak w każdym sklepie — serwuje generowany `robots.txt` i nie serwuje `llms.txt`.

Podglądy na ekranie Ustawień nie uwzględniają jeszcze zamkniętego sklepu: pokazują Twój tekst
połączony z częścią generowaną, a zamknięty sklep serwuje powyższy plik bez niego.

## Wyznaczanie meta tagów

### Produkty: zakres globalny, kanału, kanału × języka

Metadane produktu — tytuł, opis, tytuł, opis i obraz Open Graph — podlegają zakresom produktu:

| Zakres | Wskazywany przez | Obowiązuje |
| --- | --- | --- |
| Globalny | żadne z nich | we wszystkich kanałach sprzedaży i językach |
| Kanał sprzedaży | `channelId` | we wszystkich językach tego kanału |
| Kanał sprzedaży × język | `channelId` i `languageCode` | w tym języku w tym kanale |

Nie ma zakresu produktu dla samego języka; aktualizacja usuwa nadpisania produktów zapisane
wyłącznie dla języka (zob. *Aktualizacja* niżej). Każde pole jest wyznaczane osobno, z
najwęższego zakresu, który je zawiera: kanał × język, potem kanał, potem zakres globalny, a na
końcu wartość wyprowadzona z produktu — jego obowiązująca nazwa i opis w tym kanale i języku. Pole
zapisane w zakresie jako celowo puste zatrzymuje tam łańcuch, a strona używa wtedy wartości
wyprowadzonej.

**Edycja w edytorze produktu.** Sekcja SEO edytora produktu pokazuje każde pole w zakresie
edytora, z „Użyj wartości z *zakresu nadrzędnego*”, i zapisuje je razem z resztą produktu jednym
poleceniem (`product.scoped_values.save`) — jednym wpisem w dzienniku zdarzeń, którego komórki
mają nazwy `seo:<pole>@<zakres>`. Tytuł i tytuł Open Graph mają najwyżej 160 znaków, opisy 400, a
adres obrazu 2 048; adres obrazu to adres `http(s)` bez danych użytkownika. Odrzucone pole odrzuca
cały zapis. Ogólne `PUT` i `DELETE /api/v1/admin/seo/meta/product/:id` odpowiadają
`422 VALIDATION_FAILED` (`reason: product_seo_saved_with_product`); edytor na ekranie SEO prowadzi
w przypadku produktu do edytora produktu. Gdy moduł `seo` jest wyłączony, zapis produktu, który
zawiera pola SEO, jest odrzucany z kodem `503 MODULE_DISABLED`; zapis bez nich działa bez zmian.
Duplikowanie produktu kopiuje jego metadane we wszystkich zakresach.

**Odczyt.** `GET /api/v1/admin/seo/meta/product/:id` (`catalog:read`) zwraca w zakresie
wskazanym przez `channelId` i `languageCode` własną wartość albo dziedziczenie każdego pola,
wyznaczone metadane i źródło każdej wartości. Język bez kanału jest odrzucany z kodem
`422 VALIDATION_FAILED`; kanał, do którego produkt nie należy, albo język, którego kanał nie
oferuje — z kodem `422 SCOPE_INVALID`.

**Dla innych modułów.** `seoProductMetaWritePort` odczytuje i zapisuje metadane produktu w
dowolnym zakresie, w transakcji wywołującego, bez własnego wpisu w dzienniku zdarzeń; wywołują go
zapis i duplikowanie z modułu `catalog`, które najpierw sprawdzają zakres.

**Strona produktu je wyświetla.** Strona produktu w sklepie bierze tytuł, opis i znaczniki Open
Graph z tego wyznaczania, dla kanału sprzedaży i języka żądania. Gdy moduł `seo` jest wyłączony,
strona pokazuje metadane wyprowadzone z produktu, a po ponownym włączeniu modułu wszystkie
nadpisania wracają.

### Kategorie i strony CMS

Nadpisanie kategorii lub strony CMS należy do języka (`locale`) i obowiązuje we wszystkich
kanałach sprzedaży; żądanie bez języka dotyczy nadpisania `en-US`. `channelId` dla kategorii lub
strony CMS jest odrzucany z kodem `422 VALIDATION_FAILED`. Każde pole jest wyznaczane z nadpisania
dla języka, a potem z wartości wyprowadzonej z encji (nazwa kategorii i automatyczne
podsumowanie). Nadpisanie nigdy nie obowiązuje w innym języku.

**W panelu.** Edytor meta tagów na ekranie SEO wczytuje język kategorii lub strony od razu po jego
wybraniu (**Załaduj** odczytuje go ponownie). Opuszczenie języka z niezapisanymi zmianami wymaga
potwierdzenia, a **Użyj dziedziczonego** pyta przed usunięciem pokazanego nadpisania.

**Każda zmiana trafia do dziennika zdarzeń.** Zapis nadpisania to jeden wpis
`seo_meta_override.upsert`, usunięcie — jeden wpis `seo_meta_override.delete`, każdy z pełnym
nadpisaniem przed zmianą i po niej. Aby przywrócić wcześniejszą wersję, zapisz wartości ze stanu
*przed* tego wpisu. Usunięcie nieistniejącego nadpisania niczego nie zmienia i nie tworzy wpisu.

### Aktualizacja

Aktualizacja usuwa każde nadpisanie produktu zapisane dla języka bez kanału sprzedaży — takiego
zakresu już nie ma. Nadpisania kategorii i stron CMS pozostają bez zmian. Metadane produktu, które
były tylko w nadpisaniu dla języka, należy wprowadzić ponownie w kanale i języku albo w zakresie
globalnym.

Tytuł i opis są skracane do 60 / 160 znaków z wielokropkiem. Skracanie odbywa się w jednej funkcji
pomocniczej, więc zmiany limitów SEO wprowadza się w jednym miejscu.

## Mapa witryny

`SitemapGeneratorService.regenerate()` przechodzi przez produkty, kategorie i strony CMS kanału,
buduje bezwzględne adresy URL względem adresu sklepu kanału i zapisuje treść XML w wierszu
`sitemap_cache` kanału. Produkt pojawia się raz dla każdego języka, w którym jest dostępny
w kanale, a każdy adres URL używa obowiązującego tam klucza URL produktu — klucza kanału × języka,
w przeciwnym razie klucza kanału, a w ostatniej kolejności klucza globalnego — z prefiksem ścieżki
danego języka.

Trasa publiczna (`GET /catalog/sitemap.xml`) zwraca treść z pamięci podręcznej; gdy wiersz jest
starszy niż `staleAfterMs` (domyślnie 6 h), mapa jest generowana od razu w trakcie żądania. Zmiana
produktu, która wpływa na zawartość mapy — jego status (globalny, w kanale lub w kanale i języku),
archiwizacja, okres publikacji (również chwila, w której ten okres się zaczyna lub kończy), grupa
odbiorców (globalna lub kanału) albo klucze URL — oznacza
mapy wszystkich kanałów w pamięci podręcznej jako nieaktualne, więc następne żądanie buduje je od
nowa. Odpowiedź ma nagłówek `Cache-Control: public, max-age=3600`, więc poprawnie działające CDN
przechowują ją przez godzinę.

## Tylko to, co widzi anonimowy użytkownik

Produkt trafia do mapy witryny kanału tylko tam, gdzie w chwili generowania jest w tym kanale
dostępny dla anonimowego odwiedzającego: należy do kanału, nie jest zarchiwizowany ani usunięty,
jest włączony w danym języku kanału, mieści się w okresie publikacji i obejmuje go obowiązujący zakres
odbiorców (kanału, a gdy go nie ma — globalny). Produkt wyłączony globalnie, ale włączony w kanale,
trafia do mapy; produkt wyłączony w kanale — nie. Pomijane są też kategorie usunięte miękko.

Zasada jest prosta: robotom wyszukiwarek udostępnia się wyłącznie to, co może zobaczyć anonimowy
klient.

## Encje

`SeoMetaOverride` (entityType, entityId, salesChannelId?, locale?, title?, description?, ogTitle?,
ogDescription?, ogImageUrl?). Wiersz produktu nie ma ani `salesChannelId`, ani `locale` (zakres
globalny), ma `salesChannelId` (kanał) albo oba (kanał × język); wiersz kategorii lub strony CMS ma
`locale`. W wierszu produktu pole `null` dziedziczy, a `''` jest celowo puste. `SitemapCache` (pojedynczy klucz, treść, urlCount, byteSize, generatedAt).
`ogImageUrl` nadpisania to adres `http(s)` albo ścieżka zaczynająca się od pojedynczego `/`; każda
inna wartość jest odrzucana z `400 VALIDATION_FAILED`.

## Punkty rozszerzenia

- **Strony CMS** — gdy powstanie moduł CMS, podłącz jego slug i treść do
  `MetaTagResolverService.loadRuleSource()` i `SitemapGeneratorService.regenerate()`.
- **Indeks map witryny** — dla katalogów powyżej 50 000 adresów URL podziel mapę na mapy dla
  poszczególnych sekcji i zwracaj `<sitemapindex>` z trasy tego modułu.
- **Generowanie według harmonogramu** — w produkcyjnym composition root podłącz powtarzalne zadanie
  BullMQ, które co noc wywołuje `regenerate()`.
