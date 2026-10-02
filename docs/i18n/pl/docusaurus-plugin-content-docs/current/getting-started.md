---
title: Pierwsze kroki
description: Instalacja nowej instancji Endora Commerce dwoma poleceniami — o co pyta instalator, które flagi na to odpowiadają i czego pierwsze uruchomienie jeszcze nie daje.
sidebar_position: 2
---

# Pierwsze kroki

Dwa polecenia uruchamiają Endora Commerce na Twoim komputerze: API, panel administracyjny i — tam,
gdzie da się go zapisać — sklep. Ta strona opisuje te dwa polecenia w całości: każde pytanie
instalatora, flagę, która na nie odpowiada, oraz dzisiejsze ograniczenia pierwszego uruchomienia.
Krótka wersja jest w pliku `README.md` repozytorium.

## Czego potrzebujesz

- **Node.js ≥ 22.18** — `package.json` instancji deklaruje ten sam zakres, a instalator odmawia
  startu na starszym Node, zamiast zapisać drzewo, które jego własny manifest odrzuca.
- **pnpm** — zapewnia go `corepack enable`. Bez niego instalator i tak działa: uruchamia przez
  corepack wersję pnpm przypiętą w tym wydaniu, a każde kolejne polecenie wypisuje w postaci, która
  potrzebuje tylko Node i npm — drugie polecenie to wtedy `npx --yes pnpm@<wersja> run dev:all`.
  Uruchom to, co wypisze. Jeśli w `PATH` nie ma ani `pnpm`, ani `corepack`, instalator odmawia i
  mówi dlaczego.
- **Docker z Compose v2** — dla usług deweloperskich (PostgreSQL, Redis, Meilisearch i
  przechwytywacz poczty Mailpit). Niepotrzebny z `--no-services`, gdy te usługi uruchamiasz sam.

## Dwa polecenia

```bash
npx create-endora-commerce@latest my-shop
cd my-shop && pnpm run dev:all
```

`create-endora-commerce` to tylko drzwi wejściowe: przekazuje każdy argument bez zmian do
`endora install` z pakietu `@endora-commerce/cli`. `npx @endora-commerce/cli install my-shop` to
to samo polecenie, a `--help` w każdej z tych form wypisuje wszystkie flagi. Nic na tej stronie nie
różni się między tymi dwoma zapisami.

### Co robi pierwsze polecenie

W tej kolejności, wypisując każde polecenie przed jego uruchomieniem:

1. **Pobiera pakiety, z których czyta.** Gdy obok katalogu docelowego nie ma zainstalowanego nic z
   Endora Commerce — co pod `npx` jest normą — najpierw instaluje pakiety tego wydania do katalogu
   tymczasowego, bo zestaw modułów odczytuje się z ich manifestów. Katalog tymczasowy jest usuwany,
   gdy tylko instancja zostanie zapisana; jeśli to się nie uda, zostaje, a jego ścieżka jest
   wypisywana. Ten krok działa, zanim cokolwiek trafi do Twojego katalogu, więc błąd w nim
   zostawia katalog docelowy nietknięty.
2. **Zapisuje instancję** — zwykły workspace pnpm, który należy do Ciebie. Platforma, powłoka panelu
   i każdy moduł przychodzą jako zależności; żaden plik platformy nie jest kopiowany do Twojego
   drzewa.
3. **Zapisuje sklep** jako osobne repozytorium obok instancji. Jego pliki przychodzą razem z
   instalatorem: to kopia sklepu referencyjnego, już przygotowana do samodzielnego działania — zob.
   [Sklep](#sklep).
4. **Uruchamia usługi deweloperskie** przez `docker compose` i zapisuje ich adresy w pliku `.env`
   instancji. Jeśli port, który publikuje któraś z nich, jest już zajęty na Twoim komputerze — na
   przykład inny PostgreSQL na `5432` — instalator wybiera wolny, zapisuje go w `.env` (na przykład
   `POSTGRES_PORT=15432`), wyprowadza z niego adres i informuje o tym. Portu, który ustawisz w
   `.env` samodzielnie, nigdy nie zmienia: jeśli jest zajęty, instalator zatrzymuje się, zanim
   cokolwiek zapisze. Panel (`3002`) i sklep (`3000`) są traktowane tak samo: zajęty port zostaje
   zastąpiony wolnym, zapisany jako `PORT` w `admin/.env` albo w `.env` sklepu i dodany do
   `CORS_ALLOWED_ORIGINS` w API, żeby przeglądarka nadal była wpuszczana.
5. **Instaluje, generuje, buduje i migruje**, instaluje każdy moduł i tworzy Twojego
   administratora.
6. **Wgrywa dane demonstracyjne**, jeśli o nie poprosisz. Wgrywanie odbywa się na końcu, a błąd w
   nim nie przerywa instalacji.
7. **Wypisuje, co uruchomić dalej**, w tym każdą odpowiedź przyjętą jako rekomendacja i sposób jej
   odwrócenia.

Krok, który się nie powiedzie, kończy przebieg z własnym kodem wyjścia i wypisuje, co zostało do
zrobienia, zaczynając od kroku, który się nie powiódł, więc możesz dokończyć ręcznie. Hasło
administratora nigdy nie jest wypisywane: tam, gdzie polecenie go wymaga, lista pokazuje
`<password>`, a Ty wpisujesz w to miejsce swoje.

### Jakie moduły instaluje

Bez `--module` instalator instaluje **każdy moduł zestawu open source**, każdy włączony. Przebieg
podaje, ile ich jest i dlaczego. Wszystko, czego nie używasz, możesz wyłączyć w panelu w sekcji
**Moduły** (`/platform/modules`): wyłączony moduł zachowuje się tak, jakby nie był zainstalowany,
zachowuje swoje dane i wraca w tym samym stanie, gdy włączysz go ponownie. Niektórych modułów nie da
się wyłączyć, bo platforma bez nich nie działa; ekran Moduły pokazuje, których.

Lista modułów nie jest tu powtarzana — to sekcja [Moduły](./modules/README.md) tej witryny,
generowana z samych modułów.

`--module <id>` (wielokrotnie lub po przecinku) instaluje zamiast tego jawnie wskazany zestaw.
Zestaw jest domykany o własne zależności modułów i zostaje odrzucony, jeśli pomija moduł, bez
którego platforma nie działa. Większość osób tego nie potrzebuje: wyłączenie modułu to jedno
kliknięcie, a dodanie modułu, którego nie zainstalowano, to edycja manifestu, instalacja i
migracja.

## O co pyta

W terminalu instalator pyta o to, na co nie odpowiedziały Twoje flagi — **siedem pytań**, gdy
stawia wszystkie części; uruchomienie, które stawia tylko niektóre, pyta zamiast tego o pozostałe
(zob. [Jeden komponent na maszynę](#one-component-per-machine)). Pytanie, na które odpowiedziała
flaga, nie jest zadawane; instalator wymienia takie odpowiedzi raz,
przed pierwszym pytaniem. Enter przyjmuje rekomendację tam, gdzie ona jest, a podsumowanie na końcu
wymienia każdą rekomendację przyjętą w ten sposób.

| Pytanie | Rekomendacja (Enter) | Flaga, która na nie odpowiada |
| --- | --- | --- |
| Gdzie ma trafić instancja | `./endora-commerce` | argument `<dir>` |
| Które części uruchamia ta maszyna | wszystkie | `--only <component>`, `--without <member>`, `--no-storefront`, `--storefront-dir <path>` |
| Czy uruchomić usługi deweloperskie | tak | `--no-services` |
| Czy wgrać dane demonstracyjne | **brak** — musisz odpowiedzieć | `--demo` lub `--no-demo` |
| E-mail administratora | brak | `--admin-email <address>` |
| Hasło administratora | brak | `--admin-password <secret>` |
| Imię i nazwisko administratora | brak | `--admin-first-name <text>`, `--admin-last-name <text>` |

**Dane demonstracyjne celowo nie mają rekomendacji.** Sklep, który oceniasz, potrzebuje katalogu,
klientów i zamówień przed pierwszym ekranem; sklep, w którym będziesz sprzedawać, nie potrzebuje
żadnych. Pusta odpowiedź powoduje ponowne pytanie. `--demo` dodaje też do listy modułów jeden
pakiet, `@endora-commerce/demo-composition`: to on łączy przykładowe wiersze modułów w jeden sklep
— produkty demonstracyjne sprzedawane w domyślnym kanale, administratorów demonstracyjnych z
przypisanymi rolami. Jeśli zmienisz zdanie, `pnpm add -w @endora-commerce/demo-composition`, a potem
`pnpm run cli demo seed` dodają dane demonstracyjne, a `pnpm run cli demo reset` je wycofuje, nie
ruszając Twoich własnych wierszy.

**Administrator nigdy nie jest generowany.** Hasło to jedyna wartość, którą musisz zapamiętać, więc
nic go za Ciebie nie wymyśla i nic innego nie tworzy konta.

**Części** to trzy komponenty, które uruchomienie może postawić — `api`, `admin` i `storefront` —
oraz `docs`, witryna dokumentacji Twojej instancji. Pozostawienie wszystkich wierszy zaznaczonych
to uruchomienie opisane dotąd na tej stronie. Odznaczenie komponentu jest tym samym, co wskazanie
pozostałych przez `--only`, i o tym jest sekcja
[Jeden komponent na maszynę](#one-component-per-machine); `docs` pomija się przez
`--without docs`. Sklep jest zapisywany jako katalog **obok** instancji, domyślnie
`<dir>-storefront` — nigdy wewnątrz niej, gdzie wchłonąłby go workspace instancji.

## Bez pytań

Z `--non-interactive`, z `--dry-run`, w CI albo bez podłączonego terminala instalator o nic nie
pyta: każda odpowiedź to flaga. Przebieg, któremu którejś brakuje, kończy się **jedną** odmową
wymieniającą wszystkie brakujące flagi, zamiast zatrzymać się na pierwszej.

```bash
npx create-endora-commerce@latest my-shop --non-interactive --no-demo \
  --admin-email you@example.com --admin-password "$ADMIN_PASSWORD" \
  --admin-first-name Ada --admin-last-name Lovelace
```

`--dry-run` raportuje każdy plik i każdy krok, nic nie zapisuje do Twojego katalogu i niczego nie
uruchamia. Tam, gdzie potrzebuje pakietów wydania, nadal instaluje je do katalogu tymczasowego (bez
tego nie da się ustalić zestawu modułów), usuwa go i o tym informuje.

## Jeden komponent na maszynę {#one-component-per-machine}

W większej instalacji API, panel administracyjny i sklep działają każde na własnym serwerze.
`--only` wskazuje komponenty, które **to uruchomienie** stawia na **tej maszynie**, a o tym, gdzie
są pozostałe, uruchomienie dowiaduje się z adresu origin — schemat i host, opcjonalny port, bez
ścieżki (`https://api.example.com`).

```bash
# on the API server
npx create-endora-commerce@latest api --only api --no-demo \
  --api-url https://api.example.com \
  --admin-url https://admin.example.com --storefront-url https://shop.example.com \
  --admin-email you@example.com --admin-password "$ADMIN_PASSWORD" \
  --admin-first-name Ada --admin-last-name Lovelace

# on the admin server — no database, no service, no administrator
npx create-endora-commerce@latest admin --only admin --api-url https://api.example.com

# on the storefront server — no instance at all
npx create-endora-commerce@latest shop --only storefront \
  --api-url https://api.example.com --storefront-url https://shop.example.com \
  --revalidate-secret "$REVALIDATE_SECRET"
```

| `--only` | Zapisane w `<dir>` | Sklep | Co uruchamia | Wymagane poza `<dir>` |
| --- | --- | --- | --- | --- |
| *(brak)* albo wszystkie trzy | instancja | obok niej | wszystko z tej strony | administrator, `--demo` albo `--no-demo` |
| `api` | instancja, bez członka admin | brak | instalacja, usługi, setup, administrator, dane demonstracyjne na życzenie | administrator, `--demo` albo `--no-demo` |
| `api,admin` | instancja | brak | jak `api` | jak `api` |
| `api,storefront` | instancja, bez członka admin | obok niej | jak `api`, potem instalacja sklepu | jak `api` |
| `admin` | instancja, **z** członkiem backend | brak | `pnpm install`, `pnpm run build:admin` | `--api-url` |
| `storefront` | **sam sklep** — bez instancji | w `<dir>` | `pnpm install` sklepu | `--api-url`, `--storefront-url`, `--revalidate-secret` |
| `admin,storefront` | instancja, z członkiem backend | obok niej | `pnpm install`, `pnpm run build:admin`, instalacja sklepu | oba wiersze powyżej |

**Bez `api` uruchomienie nie dotyka żadnej bazy danych.** Nie uruchamia żadnej usługi, niczego nie
migruje, nie tworzy administratora i niczego nie wgrywa — a flagi, które mają sens tylko z API
(`--demo`, `--no-demo`, `--admin-email` i pozostałe flagi administratora, `--no-services`), odrzuca,
zamiast je ignorować. Uruchomienie, które nie zapisuje instancji, z tego samego powodu odrzuca
`--without`, `--module`, `--deployment` i `--topology`.

**Sam panel to to samo drzewo instancji.** Ekrany panelu pochodzą z pakietów modułów, które
instaluje instancja, więc panel budowany osobno nadal potrzebuje tej listy: uruchomienie zapisuje
całe drzewo, razem z członkiem backend, wykonuje `pnpm install` i buduje z niego jedną rzecz —
`admin/dist`. Adres API trafia do `admin/.env` jako `VITE_API_BASE_URL`. Serwuj `admin/dist` przez
`pnpm run preview:admin` albo dowolnym serwerem plików statycznych, który na nieznane ścieżki
odpowiada plikiem `index.html`.

**Sam sklep dostaje sekret, nigdy nowy.** `REVALIDATE_SECRET` to jedna wartość przechowywana na
dwóch maszynach. Uruchomienie z `api` i bez sklepu generuje ją raz (albo zapisuje tę, którą
podasz), umieszcza w `.env` instancji, mówi, w którym pliku, i jej nie wypisuje. Skopiuj ją stamtąd
do `--revalidate-secret` na maszynie sklepu. `--sales-channel <code>` wskazuje kanał sprzedaży, na
którym sprzedaje sklep; pominięty, oznacza `default` — kod, z którym platforma tworzy swój domyślny
kanał.

### Co maszyny są sobie winne

Podsumowanie uruchomienia, które stawia tylko część komponentów, wypisuje te cztery rzeczy. Żadnej
z nich nie da się sprawdzić z jednej maszyny.

1. **API wpuszcza przeglądarkę według adresu origin.** `CORS_ALLOWED_ORIGINS` w `.env` API musi
   zawierać publiczne adresy panelu i sklepu dokładnie tak, jak wysyła je przeglądarka: schemat,
   host, port, bez końcowego ukośnika. Zapisują to `--admin-url` i `--storefront-url` podane przy
   uruchomieniu API; adres, którego nie podasz, zostaje przy wartości deweloperskiej
   (`http://localhost:3002`, `http://localhost:3000`).
2. **Adres API jest ustalany w chwili budowania panelu i sklepu.** `VITE_API_BASE_URL` i
   `NEXT_PUBLIC_API_BASE_URL` są zapisywane w paczkach, więc zmiana adresu API oznacza ponowne
   zbudowanie obu, a nie restart.
3. **Trzy publiczne adresy muszą być same-site** — w jednej rejestrowalnej domenie, jak
   `api.example.com`, `admin.example.com` i `shop.example.com`. Ciasteczka sesji mają
   `SameSite=Lax`, więc przeglądarka nie wysyła ich ze strony w innej witrynie. Nic tego za Ciebie
   nie sprawdza.
4. **Panel pokazuje ekrany modułów, które zainstalowało jego własne drzewo.** Zbuduj go z tego
   samego wydania co API i z tą samą listą `--module`, jeśli API ją dostało.

Gdy podany adres jest adresem `localhost` z portem — `--storefront-url http://localhost:4000` —
jest to zarazem port, na którym ten komponent jest serwowany na tej maszynie: uruchomienie
zapisuje go jako `PORT` tam, skąd komponent go odczytuje.

### Wszystkie flagi

| Flaga | Co robi |
| --- | --- |
| `<dir>` | Gdzie trafia instancja. Katalog musi być pusty albo zawierać wyłącznie umieszczony przez Ciebie plik `.env`. |
| `--only <component>` | Które z `api`, `admin`, `storefront` to uruchomienie stawia na tej maszynie. Wielokrotnie albo po przecinku. Brak: wszystkie trzy. |
| `--api-url <origin>` | Publiczny adres API. Wymagana, gdy w `--only` nie ma `api`; z `api` — to, co API dostaje jako własny publiczny adres. |
| `--admin-url <origin>` | Gdzie serwowany jest panel — dla `CORS_ALLOWED_ORIGINS` w API. Tylko z `api`. |
| `--storefront-url <origin>` | Gdzie serwowany jest sklep. Wymagana dla sklepu bez `api`; z `api` — wpis na liście dozwolonych adresów API i `STOREFRONT_BASE_URL`. |
| `--sales-channel <code>` | Kanał sprzedaży, na którym sprzedaje sklep postawiony bez `api`. Domyślnie `default`. |
| `--revalidate-secret <secret>` | Sekret wspólny dla API i sklepu. Wymagana dla sklepu bez `api`; w pozostałych przypadkach, gdy jej nie podasz, generowana raz, zapisywana i nigdy nie wypisywana. |
| `--admin-email`, `--admin-password`, `--admin-first-name`, `--admin-last-name` | Administrator, jako który się logujesz. Wymagane są wszystkie cztery, gdy uruchomienie stawia API. |
| `--demo` / `--no-demo` | Wgrać przykładowe dane każdego zainstalowanego modułu albo nie. Wymagana, gdy uruchomienie stawia API; bez wartości domyślnej. |
| `--no-services` | Nie uruchamiaj PostgreSQL, Redis, Meilisearch ani Mailpit i nie zapisuj ich adresów w `.env`. |
| `--without <member>` | Nie zapisuj `admin` lub `docs`. Wielokrotnie. |
| `--no-storefront` | Zapisz samą instancję, bez sklepu obok niej. |
| `--storefront-dir <path>` | Gdzie trafia sklep. Domyślnie `<dir>-storefront`; nie może leżeć wewnątrz instancji. |
| `--module <id>` | Zainstaluj jawnie wskazany zestaw modułów zamiast zestawu open source. Wielokrotnie. |
| `--deployment <name>` | Katalog w `apps/` na Twoje moduły nakładkowe i wartość `DEPLOYMENT`. Domyślnie: nazwa workspace'u. |
| `--registry <url>` | Instaluj `@endora-commerce/*` z tego rejestru — w instancji i w sklepie. W każdym z nich zapisuje `.npmrc`, który odwołuje się do tokenu przez zmienną środowiskową, nigdy jako wartość. |
| `--topology single-host` / `three-host` | Który układ maszyn opisują przykładowe pliki wdrożeniowe w `deploy/`. Wybiera pliki; nic go później nie odczytuje. |
| `--non-interactive` | Nie pytaj o nic, nawet w terminalu. |
| `--dry-run` | Raportuj każdy plik i każdy krok; nic nie zapisuj do Twojego katalogu i niczego nie uruchamiaj. |

## Drugie polecenie: `pnpm run dev:all`

Uruchom je w katalogu głównym instancji. W jednym terminalu, z każdą linią oznaczoną nazwą warstwy,
startuje:

- **API** pod `http://localhost:3001` albo na porcie `PORT` ustawionym w pliku `.env` instancji;
- **panel** — pakiet zbudowany przez instalację, serwowany na własnym porcie: `3002` albo `PORT` z
  `admin/.env`, który instalator zapisuje, gdy `3002` był zajęty;
- **sklep**, jeśli jest obok instancji w `<dir>-storefront` — na `3000` albo na `PORT` z jego
  własnego `.env`. Sklep w innym miejscu wskazujesz przez
  `pnpm run dev:all --storefront-dir <path>`.

Ctrl-C zatrzymuje wszystkie, a jeśli któryś się zakończy, pozostałe są zatrzymywane i wskazywany
jest ten, który się zakończył. Każda warstwa zachowuje własne polecenie — `pnpm run start` dla API,
`pnpm run preview:admin` dla panelu, własne `pnpm run dev` sklepu — i buduje się oraz wdraża
niezależnie; `dev:all` żadnego z nich nie zmienia.

Poczta wysyłana przez instancję w trybie deweloperskim trafia do Mailpit, którego adres wypisuje
pierwsze polecenie, i nigdy nie opuszcza Twojego komputera. `pnpm run dev:services:down` zatrzymuje
usługi deweloperskie, zachowując ich dane.

## Tworzenie administratora {#creating-an-administrator}

Instalator tworzy administratora, którym się logujesz. Każde kolejne konto — dla współpracownika
albo w miejsce utraconego — tworzy się z wiersza poleceń i właśnie dlatego ekran logowania panelu
odsyła tutaj. Polecenie jest wszędzie to samo; sposób jego wywołania zależy od tego, gdzie działa
platforma:

| Gdzie | Polecenie |
| --- | --- |
| Instancja na Twoim komputerze (z jej katalogu głównego) | `pnpm run admin:create -- --email=… --password=… --first-name=… --last-name=…` |
| Obraz produkcyjny | `node dist/cli.js admin_users create --email=… --password=… --first-name=… --last-name=…`, uruchamiane w kontenerze backendu — zobacz [D1 listy kontrolnej pierwszego wdrożenia](./deployment/first-deployment-checklist.md#d1-utwórz-bootstrap-administratora-potem-go-zawęź) |
| Klon repozytorium Endora Commerce | `pnpm --filter backend run admin:create -- --email=… --password=… --first-name=… --last-name=…` |

`--password-stdin` zamiast `--password=…` odczytuje hasło ze standardowego wejścia, dzięki czemu nie
trafia ono na listę procesów, do wypisywanego przez menedżer pakietów polecenia skryptu ani do
historii powłoki — instalator tworzy Twojego administratora właśnie w ten sposób.

Konto otrzymuje rolę `platform_admin` — wszystkie uprawnienia — chyba że przekażesz `--role=<code>`
z kodem istniejącej już roli; sama rola powstaje przy pierwszym uruchomieniu. Ponowne uruchomienie
dla istniejącego adresu e-mail ustawia na nowo hasło, imię i nazwisko oraz rolę tego konta — w ten
sposób odzyskuje się też utracone hasło. Jeśli nie masz dostępu do powłoki na maszynie, na której
działa platforma, poproś o utworzenie konta osobę, która ją obsługuje.

## Sklep

Instalator zapisuje sklep obok instancji, chyba że odznaczysz go w pytaniu o części albo podasz
`--no-storefront`. To kopia sklepu referencyjnego, która przychodzi wewnątrz instalatora, więc nie
wymaga klonu repozytorium Endora Commerce: każdy plik jest już przepisany tak, by działał
samodzielnie, a pakiety `@endora-commerce/*`, od których zależy, są w wersjach wydania, które
instalujesz. Od tej chwili to Twoje repozytorium — nic go nie aktualizuje i nic nie raportuje z
powrotem.

W tej kopii pominięto jedną rzecz, a instalator ją wymienia: wzorcowe zrzuty ekranu sklepu
referencyjnego do jego testów wizualnych. To obrazy sklepu referencyjnego z maszyny, która je
zapisała; `pnpm exec playwright test --update-snapshots` zapisuje Twoje własne. Wewnątrz klonu
repozytorium sklep jest kopiowany z klonu, razem ze zrzutami.

Aby zobaczyć sklep, zbuduj go i uruchom — `pnpm run build && pnpm run start` w katalogu sklepu —
albo pozwól, by `pnpm run dev:all` uruchomiło go w trybie deweloperskim razem z pozostałymi
warstwami.

**Dodanie sklepu później** to `endora new storefront <dir>`, uruchamiane skądkolwiek. Sklep
i instancja muszą dzielić jeden sekret, `REVALIDATE_SECRET` — klucz, którym backend prosi sklep o
odświeżenie strony z cache. Gdy instalator zapisuje oba drzewa, generuje tę wartość raz i zapisuje
ją w obu. Gdy sklep dochodzi później, nic tego za Ciebie nie zrobi:

1. Wybierz jedną wartość (na przykład `openssl rand -hex 32`).
2. Ustaw ją jako `REVALIDATE_SECRET` w pliku `.env` instancji i ustaw tam `STOREFRONT_BASE_URL` na
   adres sklepu.
3. Przekaż sklepowi tę samą wartość — `endora new storefront <dir> --revalidate-secret <value>` —
   albo wpisz ją w jego własnym `.env`.

Bez kroku 2 backend po prostu nie prosi sklepu o odświeżanie, a strony zmieniają się dopiero po
wygaśnięciu cache. Przy dwóch różnych wartościach sklep odrzuca każde odświeżenie i nic tego nie
zgłasza.

## Co dalej

- [Utwórz swój pierwszy moduł](./create-your-first-module.md) — samouczek na 20 minut, który dodaje
  własny moduł do właśnie zainstalowanej instancji.
- [Moduły](./modules/README.md) — co robi każdy moduł, jego ustawienia, uprawnienia i ekrany.
- [Lista kontrolna pierwszego wdrożenia produkcyjnego](./deployment/first-deployment-checklist.md) —
  zanim instancja przyjmie prawdziwe zamówienia.
- [Drabina dostosowań](./architecture/customisation-ladder.md) i
  [moduły nakładkowe](./architecture/overlay-pattern.md) — zmiana zachowania bez edytowania
  platformy.
