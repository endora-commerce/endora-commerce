---
title: Pierwsze kroki
description: Instalacja nowej instancji Endora Commerce dwoma poleceniami — o co pyta instalator, co dostajesz, jak to uruchomić i gdzie się zalogować oraz jak rozdzielić API, panel administracyjny i sklep na osobne maszyny.
sidebar_position: 2
---

# Pierwsze kroki

Dwa polecenia wystarczą, żeby na Twoim komputerze działało Endora Commerce: API, panel
administracyjny i sklep. Ta strona opisuje te dwa polecenia w całości — o co pyta instalator, co
zapisuje, jak uruchomić wynik i gdzie się zalogować — a także ten sam instalator użyty do
rozdzielenia tych trzech części na osobne maszyny. Krótka wersja jest w pliku `README.md`
repozytorium.

## Czego potrzebujesz

- **Node.js ≥ 22.18** — `package.json` instancji deklaruje ten sam zakres, a instalator odmawia
  startu na starszym Node, zamiast zapisać drzewo, które jego własny manifest odrzuca.
- **pnpm** — zapewnia go `corepack enable`. Bez niego instalator i tak działa: uruchamia przez
  corepack wersję pnpm przypiętą w tym wydaniu, a każde kolejne polecenie wypisuje w postaci, która
  wymaga tylko Node i npm — drugie polecenie to wtedy `npx --yes pnpm@<wersja> run dev:all`.
  Uruchom to, co wypisze. Jeśli w `PATH` nie ma ani `pnpm`, ani `corepack`, instalator odmawia
  i mówi dlaczego.
- **Docker z Compose v2** — dla usług deweloperskich (PostgreSQL, Redis, Meilisearch i Mailpit,
  który przechwytuje pocztę). Niepotrzebny z `--no-services`, gdy te usługi uruchamiasz
  samodzielnie.

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

1. **Pobiera pakiety, z których czyta.** Gdy obok katalogu docelowego nie ma zainstalowanego nic
   z Endora Commerce — co pod `npx` jest normą — najpierw instaluje pakiety tego wydania do katalogu
   tymczasowego, bo zestaw modułów odczytuje z ich manifestów. Katalog tymczasowy jest usuwany,
   gdy tylko instancja zostanie zapisana; jeśli to się nie uda, zostaje, a instalator wypisuje jego
   ścieżkę. Ten krok wykonuje się, zanim cokolwiek trafi do Twojego katalogu, więc błąd w nim
   zostawia katalog docelowy nietknięty.
2. **Sprawdza maszynę** — porty i nazwę projektu Compose, których zamierza użyć — i zmienia to, co
   jest już zajęte. Zobacz [Gdy port albo nazwa są już zajęte](#when-a-port-or-a-name-is-already-taken).
3. **Zapisuje instancję** — zwykły workspace pnpm, który należy do Ciebie. Platforma, powłoka panelu
   i każdy moduł przychodzą jako zależności; żaden plik platformy nie jest kopiowany do Twojego
   drzewa.
4. **Zapisuje sklep** jako osobne repozytorium obok instancji. Jego pliki przychodzą razem
   z instalatorem: to kopia sklepu referencyjnego, już przygotowana do samodzielnego działania —
   zobacz [Sklep](#sklep).
5. **Instaluje zależności instancji i uruchamia usługi deweloperskie** przez `docker compose`,
   zapisując ich adresy w pliku `.env` instancji.
6. **Generuje, buduje i migruje**, instaluje każdy moduł i tworzy Twojego administratora.
7. **Wgrywa dane demonstracyjne**, jeśli o nie poprosisz. Błąd w tym kroku nie przerywa instalacji.
8. **Instaluje zależności sklepu.**
9. **Wypisuje, co uruchomić dalej**, w tym każdą odpowiedź przyjętą jako rekomendacja i sposób jej
   odwrócenia.

Krok, który się nie powiedzie, kończy instalację własnym kodem wyjścia, a instalator wypisuje, co
zostało do zrobienia, zaczynając od tego właśnie kroku — możesz więc dokończyć ręcznie. Hasło
administratora nigdy nie jest wypisywane: tam, gdzie polecenie go wymaga, lista pokazuje
`<password>`, a Ty wpisujesz w to miejsce swoje.

### Co dostajesz

Dwa katalogi obok siebie, oba Twoje:

| Katalog | Co to jest |
| --- | --- |
| `my-shop/` | **Instancja**: `package.json` (lista modułów), `backend/` (punkty wejścia API i workera), `admin/`, `docs/`, `apps/my-shop/` (Twoje własne moduły — zobacz [Utwórz swój pierwszy moduł](./create-your-first-module.md)), `deploy/` (przykładowe pliki produkcyjne), `compose.dev.yml` i `.env`. |
| `my-shop-storefront/` | **Sklep** — aplikacja Next.js z własnym plikiem `.env`. |

Po `pnpm run dev:all`:

| Co | Adres | |
| --- | --- | --- |
| Sklep | `http://localhost:3000` | |
| API | `http://localhost:3001` | dokument OpenAPI jest pod `/api/v1/_openapi.json` |
| Panel administracyjny | `http://localhost:3002` | zaloguj się adresem e-mail administratora i hasłem podanym podczas instalacji |
| Mailpit | `http://localhost:8025` | każda wiadomość e-mail wysłana przez instancję w trybie deweloperskim |

To wartości domyślne. Jeśli instalator zmienił któryś port, podsumowanie na końcu wypisuje wybrany
adres — i to ten należy otworzyć.

### Jakie moduły instaluje

Bez `--module` instalator instaluje **każdy moduł zestawu open source**, każdy włączony. Podaje
przy tym, ile ich jest i dlaczego. Wszystko, czego nie używasz, możesz wyłączyć w panelu na ekranie
**Modules** (`/platform/modules`): wyłączony moduł zachowuje się tak, jakby nie był zainstalowany,
zachowuje swoje dane i wraca w tym samym stanie, gdy włączysz go ponownie. Niektórych modułów nie da
się wyłączyć, bo platforma bez nich nie działa; ekran Modules pokazuje, których.

Lista modułów nie jest tu powtarzana — to sekcja [Moduły](./modules/README.md) tej witryny,
generowana z samych modułów.

`--module <id>` (wielokrotnie lub po przecinku) instaluje zamiast tego jawnie wskazany zestaw.
Zestaw jest uzupełniany o zależności wskazanych modułów i zostaje odrzucony, jeśli pomija moduł, bez
którego platforma nie działa. Większość osób tego nie potrzebuje: wyłączenie modułu to jedno
kliknięcie, a dodanie modułu, którego nie zainstalowano, to edycja manifestu, instalacja
i migracja.

## O co pyta

W terminalu instalator pyta o to, na co nie odpowiedziały Twoje flagi — to **siedem pytań**, gdy
instaluje wszystkie części. Pytanie, na które odpowiedziała flaga, nie pada; instalator raz, przed
pierwszym pytaniem, mówi, które odpowiedzi wziął z flag. Enter przyjmuje rekomendację tam, gdzie
ona jest, a podsumowanie na końcu wymienia każdą rekomendację przyjętą w ten sposób.

| Pytanie | Rekomendacja (Enter) | Flaga, która na nie odpowiada |
| --- | --- | --- |
| W którym katalogu zapisać | `./endora-commerce` | argument `<dir>` |
| Które części działają na tej maszynie | wszystkie | `--only <component>`, `--without <member>`, `--no-storefront`, `--storefront-dir <path>` |
| Czy uruchomić usługi deweloperskie | tak | `--no-services` |
| Czy wgrać dane demonstracyjne | **brak** — musisz odpowiedzieć | `--demo` lub `--no-demo` |
| E-mail administratora | brak | `--admin-email <address>` |
| Hasło administratora | brak | `--admin-password <secret>` |
| Imię i nazwisko administratora | brak | `--admin-first-name <text>`, `--admin-last-name <text>` |

**Części** to lista do zaznaczenia: trzy komponenty, które instalator może przygotować — `api`,
`admin` i `storefront` — oraz `docs`, witryna dokumentacji Twojej instancji. Wpisz numer wiersza,
żeby go przełączyć, i naciśnij Enter, żeby zatwierdzić. Pozostawienie wszystkich wierszy
zaznaczonych to instalacja opisana dotąd na tej stronie. Odznaczenie komponentu jest tym samym, co
wskazanie pozostałych przez `--only`: instalator pomija wtedy pytania, które przestały mieć sens,
a zamiast nich pyta, gdzie są pozostałe komponenty — zobacz
[Komponenty na osobnych maszynach](#one-component-per-machine). `docs` pomija się przez
`--without docs`. Sklep jest zapisywany w katalogu **obok** instancji, domyślnie
`<dir>-storefront` — nigdy wewnątrz niej, gdzie wchłonąłby go workspace instancji.

**Dane demonstracyjne celowo nie mają rekomendacji.** Sklep, który oceniasz, potrzebuje katalogu,
klientów i zamówień, zanim zobaczysz pierwszy ekran; sklep, w którym będziesz sprzedawać, nie
potrzebuje żadnych. Pusta odpowiedź powoduje ponowne pytanie. `--demo` dodaje też do listy modułów
jeden pakiet, `@endora-commerce/demo-composition`: to on łączy przykładowe dane modułów w jeden
sklep — produkty demonstracyjne sprzedawane w domyślnym kanale, administratorów demonstracyjnych
z przypisanymi rolami. Jeśli zmienisz zdanie, `pnpm add -w @endora-commerce/demo-composition`,
a potem `pnpm run cli demo seed` dodają dane demonstracyjne, a `pnpm run cli demo reset` je
wycofuje, nie ruszając Twoich własnych danych.

**Administrator nigdy nie jest generowany.** Hasło to jedyna wartość, którą musisz zapamiętać, więc
nic nie wymyśla go za Ciebie i nic innego nie tworzy konta. Hasło nie jest widoczne podczas
wpisywania i żaden krok go nie wypisuje.

## Bez pytań

Z `--non-interactive`, z `--dry-run`, w CI albo bez podłączonego terminala instalator o nic nie
pyta: każda odpowiedź to flaga. Jeśli którejś brakuje, instalator kończy się **jedną** odmową
wymieniającą wszystkie brakujące flagi, zamiast zatrzymać się na pierwszej.

```bash
npx create-endora-commerce@latest my-shop --non-interactive --no-demo \
  --admin-email you@example.com --admin-password "$ADMIN_PASSWORD" \
  --admin-first-name Ada --admin-last-name Lovelace
```

`--dry-run` wypisuje każdy plik i każdy krok, nic nie zapisuje w Twoim katalogu i niczego nie
uruchamia. Jeśli potrzebuje pakietów wydania, nadal instaluje je do katalogu tymczasowego (bez tego
nie da się ustalić zestawu modułów), usuwa go i o tym informuje.

## Gdy port albo nazwa są już zajęte {#when-a-port-or-a-name-is-already-taken}

Komputer, na którym działa już jakiś PostgreSQL, inny sklep albo druga instancja, to zwykła
sytuacja, dlatego instalator sprawdza to, zanim cokolwiek zapisze.

- **Usługi deweloperskie.** Jeśli port, który publikuje któraś z nich, jest zajęty — na przykład
  przez inny PostgreSQL na `5432` — instalator wybiera wolny, zapisuje go w `.env` instancji
  w zmiennej, którą czyta Compose (`POSTGRES_PORT`, `REDIS_PORT`, `MEILISEARCH_PORT`,
  `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`), wyprowadza z niego adres usługi i o tym informuje.
  Portu, który samodzielnie ustawisz w `.env`, nigdy nie zmienia: jeśli jest zajęty, instalator
  zatrzymuje się, niczego nie zapisując.
- **API, panel i sklep** (`3001`, `3002`, `3000`). Zajęty port domyślny zostaje zastąpiony wolnym
  — pierwszym wolnym, licząc od domyślnego plus 10000, czyli `13001` — i zapisany jako `PORT` tam,
  skąd dana warstwa go czyta: w `.env` instancji, w `admin/.env`, w `.env` sklepu. Wszystko, co
  wskazuje ten adres, zmienia się razem z nim: panel jest budowany pod nowy adres API, wskazują go
  oba adresy backendu w sklepie, a `CORS_ALLOWED_ORIGINS` w API wpuszcza przeniesiony panel
  i sklep. `PORT`, który ustawisz samodzielnie, jest używany bez zmian; jeśli port API jest
  zajęty, mówi o tym podsumowanie na końcu.
- **Projekt Compose.** Compose nazywa projekt tak jak jego katalog, więc dwie instancje o nazwie
  `shop` dzieliłyby jeden zestaw kontenerów i jedną bazę danych. Jeśli projekt o tej nazwie ma już
  na tej maszynie kontenery albo wolumeny, usługi deweloperskie dostają własną nazwę
  (`<dir>-<sześć znaków>`), zapisaną w `.env` jako `COMPOSE_PROJECT_NAME` i podaną w wyniku
  instalatora. `pnpm run dev:services` i `dev:services:down` jej używają, bo Compose czyta ten
  plik. Wartości `COMPOSE_PROJECT_NAME`, którą ustawisz samodzielnie, instalator nigdy nie
  zastępuje: jeśli jest zajęta, odmawia.

## Komponenty na osobnych maszynach {#one-component-per-machine}

W większej instalacji API, panel administracyjny i sklep działają każde na własnym serwerze. Taką
instalację opisują dwie rzeczy i obie podaje się instalatorowi flagami: **które komponenty to
uruchomienie instaluje na tej maszynie** (`--only`) oraz **pod jakimi adresami przeglądarka
znajduje wszystkie trzy** — każdy pod własną nazwą albo wszystkie na jednym hoście, pod różnymi
ścieżkami.

### Które komponenty instaluje to uruchomienie

`--only` wskazuje komponenty, które **to uruchomienie** instaluje na **tej maszynie**. O tym, gdzie
są pozostałe, instalator dowiaduje się z ich adresów (origin) — schemat i host, opcjonalnie port,
bez ścieżki (`https://api.example.com`).

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
| `api` | instancja, bez projektu `admin` | brak | instalacja, usługi, setup, administrator, dane demonstracyjne na życzenie | administrator, `--demo` albo `--no-demo` |
| `api,admin` | instancja | brak | jak `api` | jak `api` |
| `api,storefront` | instancja, bez projektu `admin` | obok niej | jak `api`, potem instalacja sklepu | jak `api` |
| `admin` | instancja, **z** projektem `backend` | brak | `pnpm install`, `pnpm run build:admin` | `--api-url` |
| `storefront` | **sam sklep** — bez instancji | w `<dir>` | `pnpm install` sklepu | `--api-url`, `--storefront-url`, `--revalidate-secret` |
| `admin,storefront` | instancja, z projektem `backend` | obok niej | `pnpm install`, `pnpm run build:admin`, instalacja sklepu | oba wiersze powyżej |

**Bez `api` instalator nie dotyka żadnej bazy danych.** Nie uruchamia żadnej usługi, niczego nie
migruje, nie tworzy administratora i nie wgrywa danych — a flagi, które mają sens tylko z API
(`--demo`, `--no-demo`, `--admin-email` i pozostałe flagi administratora, `--no-services`), odrzuca,
zamiast je ignorować. Gdy instalator nie zapisuje instancji, z tego samego powodu odrzuca
`--without`, `--module`, `--deployment` i `--topology`.

**Sam panel to wciąż to samo drzewo instancji.** Ekrany panelu pochodzą z pakietów modułów
zainstalowanych w instancji, więc panel budowany osobno nadal potrzebuje tej listy: instalator
zapisuje całe drzewo, razem z projektem `backend`, wykonuje `pnpm install` i buduje z niego jedną
rzecz — `admin/dist`. Adres API trafia do `admin/.env` jako `VITE_API_BASE_URL`. Katalog
`admin/dist` możesz serwować przez `pnpm run preview:admin` albo dowolnym serwerem plików
statycznych, który na nieznane ścieżki odpowiada plikiem `index.html`.

**Sam sklep dostaje sekret — nigdy nowy.** `REVALIDATE_SECRET` to jedna wartość przechowywana na
dwóch maszynach. Instalacja z `api` i bez sklepu generuje ją raz (albo zapisuje tę, którą podasz),
umieszcza w `.env` instancji, mówi, w którym pliku, i jej nie wypisuje. Skopiuj ją stamtąd do
`--revalidate-secret` na maszynie sklepu. `--sales-channel <code>` wskazuje kanał sprzedaży,
w którym sprzedaje sklep; pominięta oznacza `default` — kod, z którym platforma tworzy swój
domyślny kanał.

**W terminalu** te same wybory są pytaniami. Odznacz komponent na liście części, a instalator
zapyta, pod jakimi adresami dostępne są wszystkie trzy — każdy pod własnym albo wszystkie pod
jednym, ze ścieżkami — a potem o adresy, których ten układ wymaga. Bez API pyta o adres API,
a w przypadku sklepu także o adres samego sklepu, kod kanału sprzedaży i `REVALIDATE_SECRET`
(niewidoczny podczas wpisywania). Z API proponuje trzy adresy z wartościami deweloperskimi, a Enter
zostawia każdy z nich bez zmian.

Gdy podany adres jest adresem `localhost` z portem — `--storefront-url http://localhost:4000` —
jest to zarazem port, na którym ten komponent działa na tej maszynie: instalator zapisuje go jako
`PORT` tam, skąd komponent go czyta. Wyjątkiem jest adres `localhost` podany jako `--public-url`:
jego port należy do reverse proxy, więc żaden komponent go nie zajmuje.

### Pod jakimi adresami są dostępne

Obsługiwane są dwa układy. W obu wszystkie trzy komponenty pozostają w jednej witrynie (same-site),
czego wymagają ciasteczka sesji.

#### Każdy pod własną nazwą

`api.example.com`, `admin.example.com`, `shop.example.com`. To właśnie opisują `--api-url`,
`--admin-url` i `--storefront-url`, jak w przykładzie powyżej. Trzy nazwy muszą należeć do jednej
rejestrowalnej domeny.

#### Jeden host, ze ścieżkami {#one-host-with-paths}

Sklep pod `/`, panel pod `/admin`, API pod `/api`:

```bash
npx create-endora-commerce@latest my-shop --public-url https://example.com
```

`--public-url` to trzy adresy w jednej fladze — `--api-url https://example.com`,
`--storefront-url https://example.com` i `--admin-url https://example.com/admin` — i podana obok
którejkolwiek z tych trzech jest odrzucana. Działa zarówno z `--only`, na każdej maszynie po kolei,
jak i bez niej — gdy wszystkie trzy komponenty stoją na jednej maszynie za jednym reverse proxy.

Trzy rzeczy są w tym układzie inne:

- **Adresem API jest sam host**, a nie `https://example.com/api`. Ścieżki API i tak zaczynają się
  od `/api/v1`, więc to, co odpowiada na hoście, przekazuje `/api/` dalej bez zmian. `--api-url`
  ze ścieżką jest odrzucana — z takim właśnie wyjaśnieniem.
- **Panel jest budowany pod swoją ścieżkę.** Instalator zapisuje `ADMIN_BASE_PATH=/admin/`
  w `admin/.env`; adresy zasobów panelu i adresy jego ekranów zaczynają się właśnie tam. Podobnie
  jak adres API, ta wartość jest ustalana w chwili budowania panelu. `--admin-url` przyjmuje
  dowolną ścieżkę bazową (`https://example.com/back-office`), nie tylko `/admin`.
- **Coś musi kierować ruch według ścieżki**, a podsumowanie na końcu wymienia trasy: `/api/`
  i `/assets/file/` do API; dokładnie `/api/revalidate` do sklepu (to jedyna trasa pod `/api`
  należąca do sklepu); `/admin/` do panelu, z plikiem `index.html` dla każdej ścieżki, której
  panel nie ma; wszystko pozostałe do sklepu. Plik `deploy/nginx.paths.example.conf` w instancji
  to te same trasy zapisane dla nginx.

W tym układzie żądania przeglądarki są same-origin, więc `CORS_ALLOWED_ORIGINS` — które instalator
nadal zapisuje, z tym jednym adresem — ma znaczenie tylko dla klienta spod innego adresu. Strona
sklepu pod `/admin` albo `/api` nigdy nie będzie osiągalna, więc zarezerwuj oba słowa
w ustawieniu zarezerwowanych segmentów modułu `cms`.

### Co maszyny muszą o sobie wiedzieć

Podsumowanie instalacji, która obejmuje tylko część komponentów, wypisuje poniższe punkty. Żadnego
z nich nie da się sprawdzić z jednej maszyny, bo druga strona każdego jest gdzie indziej.

1. **API wpuszcza przeglądarkę według adresu (origin).** `CORS_ALLOWED_ORIGINS` w `.env` API musi
   zawierać publiczne adresy panelu i sklepu dokładnie tak, jak wysyła je przeglądarka: schemat,
   host, port, bez końcowego ukośnika. Zapisują to `--admin-url` i `--storefront-url` podane przy
   instalacji API; adres, którego nie podasz, zostaje przy wartości deweloperskiej
   (`http://localhost:3002`, `http://localhost:3000`).
2. **Adres API jest ustalany w chwili budowania panelu i sklepu.** `VITE_API_BASE_URL`
   i `NEXT_PUBLIC_API_BASE_URL` trafiają do zbudowanych plików, więc zmiana adresu API oznacza
   ponowne zbudowanie obu, a nie restart.
3. **Trzy publiczne adresy muszą być same-site** — w jednej rejestrowalnej domenie albo na jednym
   hoście ze ścieżkami. Ciasteczka sesji mają `SameSite=Lax`, więc przeglądarka nie wysyła ich ze
   strony w innej witrynie. Nic tego za Ciebie nie sprawdza.
4. **Panel pokazuje ekrany modułów zainstalowanych w jego własnym drzewie.** Zbuduj go z tego
   samego wydania co API i z tą samą listą `--module`, jeśli API ją dostało.
5. **API i sklep mają jeden `REVALIDATE_SECRET`**, a `STOREFRONT_BASE_URL` w API to adres sklepu:
   ta para pozwala API poprosić sklep o odświeżenie strony z cache. Przy dwóch różnych wartościach
   sklep odrzuca każde odświeżenie i nic tego nie zgłasza.

## Wszystkie flagi

| Flaga | Co robi |
| --- | --- |
| `<dir>` | Gdzie trafia instancja — albo sklep, z `--only storefront`. Katalog musi być pusty albo zawierać wyłącznie umieszczony przez Ciebie plik `.env`. |
| `--only <component>` | Które z `api`, `admin`, `storefront` to uruchomienie instaluje na tej maszynie. Wielokrotnie albo po przecinku. Brak: wszystkie trzy. |
| `--public-url <origin>` | Jeden host ze ścieżkami: sklep pod `/`, panel pod `/admin`, API pod `/api`. Zastępuje trzy poniższe flagi adresów; podana obok którejkolwiek z nich jest odrzucana. |
| `--api-url <origin>` | Publiczny adres API. Wymagana, gdy w `--only` nie ma `api`; z `api` — adres, który API dostaje jako własny publiczny. |
| `--admin-url <origin>[/<path>]` | Gdzie dostępny jest panel. Z `api`: jego wpis w `CORS_ALLOWED_ORIGINS` i `ADMIN_BASE_URL`. Z `admin`: ścieżka bazowa, pod którą budowany jest panel, jeśli adres ją zawiera. |
| `--storefront-url <origin>` | Gdzie dostępny jest sklep. Wymagana dla sklepu bez `api`; z `api` — wpis na liście adresów dozwolonych przez API i `STOREFRONT_BASE_URL`. |
| `--sales-channel <code>` | Kanał sprzedaży, w którym sprzedaje sklep instalowany bez `api`. Domyślnie `default`. |
| `--revalidate-secret <secret>` | Sekret wspólny dla API i sklepu. Wymagana dla sklepu bez `api`; w pozostałych przypadkach, gdy jej nie podasz, sekret jest generowany raz, zapisywany i nigdy nie wypisywany. |
| `--admin-email`, `--admin-password`, `--admin-first-name`, `--admin-last-name` | Administrator, jako który się logujesz. Wymagane są wszystkie cztery, gdy instalowane jest API. |
| `--demo` / `--no-demo` | Wgrać przykładowe dane każdego zainstalowanego modułu albo nie. Wymagana, gdy instalowane jest API; bez wartości domyślnej. |
| `--no-services` | Nie uruchamiaj PostgreSQL, Redis, Meilisearch ani Mailpit i nie zapisuj ich adresów w `.env`. |
| `--without <member>` | Nie zapisuj `admin` lub `docs`. Wielokrotnie. |
| `--no-storefront` | Zapisz samą instancję, bez sklepu obok niej. |
| `--storefront-dir <path>` | Gdzie trafia sklep. Domyślnie `<dir>-storefront`; nie może leżeć wewnątrz instancji. |
| `--module <id>` | Zainstaluj jawnie wskazany zestaw modułów zamiast zestawu open source. Wielokrotnie. |
| `--deployment <name>` | Katalog w `apps/` na Twoje moduły nakładkowe i wartość `DEPLOYMENT` w `.env`. Domyślnie: nazwa workspace'u. |
| `--registry <url>` | Instaluj `@endora-commerce/*` z tego rejestru — w instancji i w sklepie. W każdym z nich zapisuje `.npmrc`, który odwołuje się do tokenu przez zmienną środowiskową, nigdy przez wartość. |
| `--topology single-host` / `three-host` | Który układ maszyn opisują przykładowe pliki wdrożeniowe w `deploy/`. Wybiera pliki; nic jej później nie odczytuje. |
| `--non-interactive` | Nie pytaj o nic, nawet w terminalu. |
| `--dry-run` | Wypisz każdy plik i każdy krok; nic nie zapisuj w katalogu i niczego nie uruchamiaj. |

## Drugie polecenie: `pnpm run dev:all`

Uruchom je w katalogu głównym instancji. W jednym terminalu, z każdą linią oznaczoną nazwą warstwy,
startuje:

- **API** pod `http://localhost:3001` albo na porcie `PORT` ustawionym w pliku `.env` instancji;
- **panel** — zbudowany podczas instalacji, serwowany na własnym porcie: `3002` albo `PORT`
  z `admin/.env`;
- **sklep**, jeśli jest obok instancji w `<dir>-storefront` — w trybie deweloperskim, na `3000`
  albo na `PORT` z jego własnego `.env`. Sklep w innym miejscu wskazujesz przez
  `pnpm run dev:all --storefront-dir <path>`.

Ctrl-C zatrzymuje wszystkie, a jeśli któraś warstwa się zakończy, pozostałe są zatrzymywane
i polecenie mówi, która to była. Każda warstwa zachowuje własne polecenie — `pnpm run start` dla
API, `pnpm run preview:admin` dla panelu, własne `pnpm run dev` sklepu — i każdą buduje się oraz
wdraża niezależnie; `dev:all` żadnego z nich nie zmienia. `pnpm run dev` uruchamia samo API
i restartuje je, gdy edytujesz własne moduły.

Poczta wysyłana przez instancję w trybie deweloperskim trafia do Mailpit, którego adres wypisuje
pierwsze polecenie, i nigdy nie opuszcza Twojego komputera. `pnpm run dev:services:down` zatrzymuje
usługi deweloperskie, zachowując ich dane; `pnpm run dev:services` uruchamia je ponownie.

## Tworzenie administratora {#creating-an-administrator}

Instalator tworzy administratora, jako który się logujesz. Każde kolejne konto — dla współpracownika
albo w miejsce utraconego — tworzy się z wiersza poleceń i właśnie dlatego ekran logowania panelu
odsyła tutaj. Polecenie jest wszędzie to samo; sposób jego wywołania zależy od tego, gdzie działa
platforma:

| Gdzie | Polecenie |
| --- | --- |
| Instancja na Twoim komputerze (z jej katalogu głównego) | `pnpm run admin:create -- --email=… --password=… --first-name=… --last-name=…` |
| Obraz produkcyjny | `node dist/cli.js admin_users create --email=… --password=… --first-name=… --last-name=…`, uruchamiane w kontenerze backendu — zobacz [D1 listy kontrolnej pierwszego wdrożenia](./deployment/first-deployment-checklist.md#d1-utwórz-bootstrap-administratora-potem-go-zawęź) |
| Klon repozytorium Endora Commerce | `pnpm --filter backend run admin:create -- --email=… --password=… --first-name=… --last-name=…` |

`--password-stdin` zamiast `--password=…` odczytuje hasło ze standardowego wejścia, dzięki czemu nie
trafia ono na listę procesów, do polecenia wypisywanego przez menedżer pakietów ani do historii
powłoki — instalator tworzy Twojego administratora właśnie w ten sposób.

Konto otrzymuje rolę `platform_admin` — wszystkie uprawnienia — chyba że przekażesz `--role=<code>`
z kodem istniejącej już roli; sama rola powstaje przy pierwszym uruchomieniu. Ponowne uruchomienie
polecenia dla istniejącego adresu e-mail ustawia na nowo hasło, imię i nazwisko oraz rolę tego
konta — w ten sposób odzyskuje się też utracone hasło. Jeśli nie masz dostępu do powłoki na
maszynie, na której działa platforma, poproś o utworzenie konta osobę, która nią zarządza.

## Sklep

Instalator zapisuje sklep obok instancji, chyba że odznaczysz go w pytaniu o części albo podasz
`--no-storefront`. To kopia sklepu referencyjnego dostarczana razem z instalatorem, więc nie wymaga
klonu repozytorium Endora Commerce: każdy plik jest już przepisany tak, by działał samodzielnie,
a pakiety `@endora-commerce/*`, od których zależy, są w wersjach z wydania, które instalujesz. Od
tej chwili to Twoje repozytorium — nic go nie aktualizuje i nic nie wysyła żadnych informacji
z powrotem.

W tej kopii pominięto jedną rzecz, a instalator ją wymienia: wzorcowe zrzuty ekranu sklepu
referencyjnego, używane w jego testach wizualnych. To obrazy sklepu referencyjnego z maszyny, na
której je zapisano; `pnpm exec playwright test --update-snapshots` zapisuje Twoje własne. Wewnątrz
klonu repozytorium sklep jest kopiowany z klonu, razem ze zrzutami.

`pnpm run dev:all` uruchamia sklep w trybie deweloperskim razem z pozostałymi warstwami. Żeby
serwować go tak jak na produkcji, zbuduj go i uruchom w katalogu sklepu:

```bash
pnpm run build && pnpm run start
```

`start` serwuje to, co zbudowało `build`, na porcie `PORT` z pliku `.env` sklepu; jeśli sklep nie
został zbudowany, mówi, żeby uruchomić `pnpm run build`.

**Dodanie sklepu później** to `endora new storefront <dir>`, uruchamiane z dowolnego miejsca. Sklep
i instancja muszą mieć jeden wspólny sekret, `REVALIDATE_SECRET` — klucz, którym backend prosi
sklep o odświeżenie strony z cache. Gdy instalator zapisuje oba drzewa, generuje tę wartość raz
i zapisuje ją w obu. Gdy sklep dochodzi później, nic tego za Ciebie nie zrobi:

1. Wybierz jedną wartość (na przykład `openssl rand -hex 32`).
2. Ustaw ją jako `REVALIDATE_SECRET` w pliku `.env` instancji i ustaw tam `STOREFRONT_BASE_URL` na
   adres sklepu.
3. Przekaż sklepowi tę samą wartość — `endora new storefront <dir> --revalidate-secret <value>` —
   albo wpisz ją w jego własnym `.env`.

Bez kroku 2 backend po prostu nie prosi sklepu o odświeżanie, a strony zmieniają się dopiero po
wygaśnięciu cache. Przy dwóch różnych wartościach sklep odrzuca każde odświeżenie i nic tego nie
zgłasza.

## Z Twojego komputera na produkcję

Wszystko powyżej to środowisko deweloperskie: usługi działają w Dockerze na Twoim komputerze,
a sklep w trybie deweloperskim. To, czego potrzebujesz do następnego kroku, instancja ma we własnym
katalogu `deploy/`, a każdy plik w nim jest **przykładem** — nic go nie stosuje i nic go później
nie odczytuje. Skopiuj to, czego potrzebujesz, na swoje maszyny i od tej chwili utrzymuj
samodzielnie.

- `deploy/README.md` — kolejność uruchamiania całości i to, co maszyny muszą o sobie wiedzieć.
- `deploy/Dockerfile.backend` i `deploy/Dockerfile.admin` — przykładowe obrazy dla API (i jego
  konsumentów kolejek) oraz dla zbudowanego panelu. Budują się z katalogu głównego instancji;
  polecenia i każdy `--build-arg` są w nagłówku każdego z plików. Argument `DEPLOYMENT` obrazu
  backendu ma domyślnie wartość wdrożenia tej instancji, więc obraz zbudowany bez niego i tak
  składa Twoje moduły nakładkowe; pusta wartość buduje samą platformę.
- Przykładowy plik Compose i `.env.example` dla układu maszyn wybranego przez `--topology`:
  `single-host` (domyślny) umieszcza wszystkie warstwy na jednej maszynie; `three-host` zapisuje
  po jednym pliku Compose i jednym `.env.example` na maszynę — dla backendu, sklepu i panelu.
- `deploy/nginx.example.conf` — blok reverse proxy dla każdej publicznej nazwy — oraz
  `deploy/nginx.paths.example.conf`, jego odpowiednik dla układu
  [jeden host ze ścieżkami](#one-host-with-paths). Użyj jednego albo drugiego.

Zanim instancja przyjmie prawdziwe zamówienia, przejdź
[listę kontrolną pierwszego wdrożenia produkcyjnego](./deployment/first-deployment-checklist.md):
sekrety do wygenerowania, ustawienia, które możesz wybrać tylko Ty, i dane startowe, których nie
wolno wgrać.

## Co dalej

- [Utwórz swój pierwszy moduł](./create-your-first-module.md) — samouczek na 20 minut, który dodaje
  własny moduł do właśnie zainstalowanej instancji.
- [Moduły](./modules/README.md) — co robi każdy moduł, jego ustawienia, uprawnienia i ekrany.
- [Cykl życia modułu](./modules/lifecycle.md) — instalowanie, włączanie, wyłączanie
  i odinstalowywanie modułu z wiersza poleceń.
- [Drabina dostosowań](./architecture/customisation-ladder.md) i
  [moduły nakładkowe](./architecture/overlay-pattern.md) — zmiana zachowania bez edytowania
  platformy.
- [Lista kontrolna pierwszego wdrożenia produkcyjnego](./deployment/first-deployment-checklist.md) —
  zanim instancja przyjmie prawdziwe zamówienia.
