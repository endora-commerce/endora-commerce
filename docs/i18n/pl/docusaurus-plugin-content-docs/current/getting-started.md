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

> **Przed pierwszym publicznym wydaniem** pakietów nie ma jeszcze w publicznym rejestrze npm, więc
> `npx create-endora-commerce` i `npx @endora-commerce/cli` nie dają się rozwiązać. Do tego czasu
> uruchamiaj Endora Commerce z klonu repozytorium według jego pliku `README.md`, sekcja
> *Developing Endora Commerce*.

## Czego potrzebujesz

- **Node.js ≥ 22.18** — `package.json` instancji deklaruje ten sam zakres, a instalator odmawia
  startu na starszym Node, zamiast zapisać drzewo, które jego własny manifest odrzuca.
- **pnpm** — zapewnia go `corepack enable`. Jeśli w `PATH` nie ma ani `pnpm`, ani `corepack`,
  instalator odmawia i mówi dlaczego.
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
3. **Zapisuje sklep** jako osobne repozytorium obok instancji (tylko z wnętrza klonu repozytorium —
   zob. [Czego pierwsze uruchomienie nie daje](#czego-pierwsze-uruchomienie-nie-daje)).
4. **Uruchamia usługi deweloperskie** przez `docker compose` i zapisuje ich adresy w pliku `.env`
   instancji.
5. **Instaluje, generuje, buduje i migruje**, instaluje każdy moduł i tworzy Twojego
   administratora.
6. **Wgrywa dane demonstracyjne**, jeśli o nie poprosisz. Wgrywanie odbywa się na końcu, a błąd w
   nim nie przerywa instalacji.
7. **Wypisuje, co uruchomić dalej**, w tym każdą odpowiedź przyjętą jako rekomendacja i sposób jej
   odwrócenia.

Krok, który się nie powiedzie, kończy przebieg z własnym kodem wyjścia i wypisuje, co zostało do
zrobienia, więc możesz dokończyć ręcznie poleceniami, które zostały wyświetlone.

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

W terminalu instalator pyta o to, na co nie odpowiedziały Twoje flagi — **najwyżej siedem pytań**.
Pytanie, na które odpowiedziała flaga, nie jest zadawane; instalator wymienia takie odpowiedzi raz,
przed pierwszym pytaniem. Enter przyjmuje rekomendację tam, gdzie ona jest, a podsumowanie na końcu
wymienia każdą rekomendację przyjętą w ten sposób.

| Pytanie | Rekomendacja (Enter) | Flaga, która na nie odpowiada |
| --- | --- | --- |
| Gdzie ma trafić instancja | `./endora-commerce` | argument `<dir>` |
| Które części zapisać | wszystkie | `--without <member>`, `--no-storefront`, `--storefront-dir <path>` |
| Czy uruchomić usługi deweloperskie | tak | `--no-services` |
| Czy wgrać dane demonstracyjne | **brak** — musisz odpowiedzieć | `--demo` lub `--no-demo` |
| E-mail administratora | brak | `--admin-email <address>` |
| Hasło administratora | brak | `--admin-password <secret>` |
| Imię i nazwisko administratora | brak | `--admin-first-name <text>`, `--admin-last-name <text>` |

**Dane demonstracyjne celowo nie mają rekomendacji.** Sklep, który oceniasz, potrzebuje katalogu,
klientów i zamówień przed pierwszym ekranem; sklep, w którym będziesz sprzedawać, nie potrzebuje
żadnych. Pusta odpowiedź powoduje ponowne pytanie. Jeśli zmienisz zdanie, `pnpm run cli demo seed`
dodaje dane demonstracyjne, a `pnpm run cli demo reset` je wycofuje, nie ruszając Twoich własnych
wierszy.

**Administrator nigdy nie jest generowany.** Hasło to jedyna wartość, którą musisz zapamiętać, więc
nic go za Ciebie nie wymyśla i nic innego nie tworzy konta.

**Części** to członkowie instancji i sklep. Backend jest zapisywany zawsze. `admin` (panel
administracyjny) i `docs` (witrynę dokumentacji Twojej instancji) można pominąć przez
`--without admin` lub `--without docs`. Sklep jest zapisywany jako katalog **obok** instancji,
domyślnie `<dir>-storefront` — nigdy wewnątrz niej, gdzie wchłonąłby go workspace instancji.

## Bez pytań

Z `--non-interactive`, z `--dry-run`, w CI albo bez podłączonego terminala instalator o nic nie
pyta: każda odpowiedź to flaga. Przebieg, któremu którejś brakuje, kończy się **jedną** odmową
wymieniającą wszystkie brakujące flagi, zamiast zatrzymać się na pierwszej.

```bash
npx create-endora-commerce@latest my-shop --non-interactive --no-storefront --no-demo \
  --admin-email you@example.com --admin-password "$ADMIN_PASSWORD" \
  --admin-first-name Ada --admin-last-name Lovelace
```

`--dry-run` raportuje każdy plik i każdy krok, nic nie zapisuje do Twojego katalogu i niczego nie
uruchamia. Tam, gdzie potrzebuje pakietów wydania, nadal instaluje je do katalogu tymczasowego (bez
tego nie da się ustalić zestawu modułów), usuwa go i o tym informuje.

### Wszystkie flagi

| Flaga | Co robi |
| --- | --- |
| `<dir>` | Gdzie trafia instancja. Katalog musi być pusty albo zawierać wyłącznie umieszczony przez Ciebie plik `.env`. |
| `--admin-email`, `--admin-password`, `--admin-first-name`, `--admin-last-name` | Administrator, jako który się logujesz. Wymagane są wszystkie cztery. |
| `--demo` / `--no-demo` | Wgrać przykładowe dane każdego zainstalowanego modułu albo nie. Wymagana; bez wartości domyślnej. |
| `--no-services` | Nie uruchamiaj PostgreSQL, Redis, Meilisearch ani Mailpit i nie zapisuj ich adresów w `.env`. |
| `--without <member>` | Nie zapisuj `admin` lub `docs`. Wielokrotnie. |
| `--no-storefront` | Zapisz samą instancję. Poza klonem repozytorium wymagana w przebiegach nieinteraktywnych. |
| `--storefront-dir <path>` | Gdzie trafia sklep. Domyślnie `<dir>-storefront`; nie może leżeć wewnątrz instancji. |
| `--module <id>` | Zainstaluj jawnie wskazany zestaw modułów zamiast zestawu open source. Wielokrotnie. |
| `--deployment <name>` | Katalog w `apps/` na Twoje moduły nakładkowe i wartość `DEPLOYMENT`. Domyślnie: nazwa workspace'u. |
| `--registry <url>` | Instaluj `@endora-commerce/*` z tego rejestru. Zapisuje `.npmrc`, który odwołuje się do tokenu przez zmienną środowiskową, nigdy jako wartość. |
| `--topology single-host` / `three-host` | Który układ maszyn opisują przykładowe pliki wdrożeniowe w `deploy/`. Wybiera pliki; nic go później nie odczytuje. |
| `--non-interactive` | Nie pytaj o nic, nawet w terminalu. |
| `--dry-run` | Raportuj każdy plik i każdy krok; nic nie zapisuj do Twojego katalogu i niczego nie uruchamiaj. |

## Drugie polecenie: `pnpm run dev:all`

Uruchom je w katalogu głównym instancji. W jednym terminalu, z każdą linią oznaczoną nazwą warstwy,
startuje:

- **API** pod `http://localhost:3001`;
- **panel** — pakiet zbudowany przez instalację, serwowany na własnym porcie (`3002`, chyba że
  `PORT` panelu mówi inaczej);
- **sklep**, jeśli jest obok instancji w `<dir>-storefront`. Sklep w innym miejscu wskazujesz przez
  `pnpm run dev:all -- --storefront-dir <path>`.

Ctrl-C zatrzymuje wszystkie, a jeśli któryś się zakończy, pozostałe są zatrzymywane i wskazywany
jest ten, który się zakończył. Każda warstwa zachowuje własne polecenie — `pnpm run start` dla API,
`pnpm run preview:admin` dla panelu, własne `pnpm run dev` sklepu — i buduje się oraz wdraża
niezależnie; `dev:all` żadnego z nich nie zmienia.

Poczta wysyłana przez instancję w trybie deweloperskim trafia do Mailpit, którego adres wypisuje
pierwsze polecenie, i nigdy nie opuszcza Twojego komputera. `pnpm run dev:services:down` zatrzymuje
usługi deweloperskie, zachowując ich dane.

## Czego pierwsze uruchomienie nie daje

**Brak sklepu poza klonem repozytorium.** Sklep jest kopiowany z referencyjnego sklepu w
repozytorium Endora Commerce. Uruchomione gdziekolwiek indziej pytanie o części pokazuje sklep jako
odznaczony, z podanym powodem, i nie pozwala go zaznaczyć; przebieg nieinteraktywny wymaga
`--no-storefront`. Instancja, API i panel są bez niego kompletne.

**Dodanie sklepu później** to `endora new storefront <dir>`, uruchamiane z klonu repozytorium. Sklep
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

- [Moduły](./modules/README.md) — co robi każdy moduł, jego ustawienia, uprawnienia i ekrany.
- [Lista kontrolna pierwszego wdrożenia produkcyjnego](./deployment/first-deployment-checklist.md) —
  zanim instancja przyjmie prawdziwe zamówienia.
- [Drabina dostosowań](./architecture/customisation-ladder.md) i
  [moduły nakładkowe](./architecture/overlay-pattern.md) — zmiana zachowania bez edytowania
  platformy.
