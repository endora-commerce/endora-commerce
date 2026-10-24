---
title: Aktualizacja instancji
description: Przeniesienie instancji Endora Commerce i jej storefrontu z jednego wydania na następne jednym poleceniem — co zmienia, czego nie rusza, co uruchomić ponownie i co zrobić w instancji, której CLI nie zna jeszcze tego polecenia.
sidebar_position: 4
---

# Aktualizacja instancji

Instancja nie zawiera kopii platformy: platforma, powłoka panelu administracyjnego i każdy moduł
to pakiety, od których zależy. Aktualizacja polega na przeniesieniu **wszystkich pakietów
wydania** razem na nową wersję, zainstalowaniu ich i uruchomieniu własnego `setup` instancji —
który generuje pliki, buduje, wykonuje migracje i instaluje każdy moduł zadeklarowany
w instancji. Moduł nowy w wydaniu nie jest jednym z nich, dopóki go nie zadeklarujesz: zobacz
[Dodawanie modułu, który jest nowy w wydaniu](#adding-a-new-module).

Robi to jedno polecenie:

```bash
pnpm run upgrade             # do najnowszego wydania
pnpm run upgrade 0.102.0     # do wskazanego wydania
```

Uruchom je w katalogu głównym instancji. Jeśli instancję utworzyło wydanie, którego CLI nie ma
polecenia `upgrade`, zobacz [Instancje utworzone przed tym poleceniem](#before-the-command).

## Nie używaj `pnpm update`

`pnpm update` wygląda na oczywisty wybór, a zostawia instancję w stanie, który działa — do czasu —
i kończy się kodem `0`:

- Twój `package.json` przypina pakiety wydania do **dokładnych** wersji, żeby drzewo instalowało
  to samo każdego dnia i tylko jedną kopię każdego pakietu. `pnpm update` nigdy nie przesuwa
  dokładnego przypięcia, więc w instancji utworzonej przez wydanie późniejsze niż `0.101.x` nie
  zmienia żadnego z nich. W instancji utworzonej przez `0.101.x` lub starsze dokładny jest tylko
  `@endora-commerce/contracts`: `pnpm update` przesuwa wszystkie pozostałe pakiety, a ten
  zostawia, więc instalują się dwie kopie i pnpm wypisuje ostrzeżenie *unmet peer* dla każdego
  modułu.
- Przed `1.0.0` zakres `^0.101.0` kończy się poniżej `0.102.0`, więc `pnpm update` w ogóle nie
  sięga następnego wydania minor.
- Przepisuje zakresy Twoich pozostałych zależności — `"react": "^19"` staje się `"^19.3.0"` —
  i nigdy nie przesuwa pakietu, który pnpm zainstalował sam jako peer, na przykład
  `@endora-commerce/page-builder-core`.

## Zanim zaczniesz

- **Zatwierdź (commit) bieżący stan**, żeby aktualizacja była jednym diffem do przeczytania
  i cofnięcia: `package.json` każdego członka, `pnpm-lock.yaml` i te same dwa pliki storefrontu.
- **Zrób kopię zapasową bazy danych.** `setup` wykonuje migracje nowego wydania, a migracje nie
  działają wstecz. Z tego samego powodu polecenie odrzuca wersję starszą niż zainstalowana.
- **Zatrzymaj API i jego workery (konsumentów kolejek)**, żeby nic nie obsługiwało żądań w czasie
  zmiany schematu.
- **Podejrzyj wynik** poleceniem `pnpm run upgrade --dry-run`: każdy zakres, który by przesunęło,
  każdy wpis pliku blokady, który by usunęło, i każde polecenie, które by uruchomiło. Niczego nie
  zapisuje i niczego nie uruchamia.

## Co robi

1. Najpierw wszystko sprawdza: że działa w instancji, że platforma jest zainstalowana, że wersja
   istnieje i że **każdy** pakiet wydania zadeklarowany w Twoich manifestach jest opublikowany
   w tej wersji. Każdy problem trafia do jednej odmowy i nic nie zostaje zapisane.
2. W każdym `package.json` instancji — w katalogu głównym, w `backend/`, `admin/` i `docs/` —
   oraz w storefroncie obok niej przesuwa każdy pakiet wydania na nową wersję. Dokładne
   przypięcie pozostaje dokładne, a `^` pozostaje `^`. Żadna inna linia się nie zmienia.
3. W każdym `pnpm-lock.yaml` usuwa wpisy, które wskazują pakiet wydania w innej wersji, żeby pnpm
   rozwiązał je ponownie — także peery, które zainstalował sam.
4. Uruchamia `pnpm install` i `pnpm run setup` w instancji, a potem `pnpm install` w repozytorium
   storefrontu. Każde polecenie jest wypisywane, zanim się wykona.

Jeśli instancja jest już w żądanej wersji, polecenie to mówi i niczego nie zmienia.

### Czego nie rusza

- **Pakietów, które nie należą do wydania.** O tym, które należą, decyduje samo wydanie, a nie
  zakres `@endora-commerce/`, więc moduł wersjonowany osobno, poza wydaniem, i każdy pakiet
  zewnętrzny zachowują zakres, który wpisałeś. Każdy pominięty pakiet z tego zakresu jest
  wymieniony w wyniku.
- **Zależności, która nie jest zakresem wersji** — `file:`, `link:`, `workspace:`, tag. Zostaje
  wymieniona i zachowana.
- **Własnych plików storefrontu.** Storefront to Twoje repozytorium; przesuwają się tylko jego
  pakiety wydania. `--no-storefront` zostawia go całkowicie w spokoju, a
  `--storefront-dir <path>` wskazuje storefront, który nie leży obok instancji. Storefront
  zachowuje więc źródła, z którymi powstał: gdy wydanie zmienia storefront, jaki dostaje nowa
  instalacja, Twój zyska tę zmianę dopiero wtedy, gdy sam ją przeniesiesz — zmianę z wydania
  `0.103.0` opisuje sekcja
  [Bloki modułów w istniejącym storefroncie](#storefront-block-renderers), a dwie z wydania
  `0.104.0` — sekcja [Po aktualizacji do wydania 0.104.0](#after-0-104-0), a zmiany z wydania
  `0.105.0` — sekcja [Po aktualizacji do wydania 0.105.0](#after-0-105-0).

## Po zakończeniu

Na koniec polecenie wymienia, co uruchomić ponownie:

```bash
pnpm run start                                   # API i jego workery
pnpm run preview:admin                           # setup zbudował panel od nowa
cd ../my-shop-storefront && pnpm run build && pnpm run start
```

Zaloguj się i otwórz **Modules** (`/platform/modules`), żeby sprawdzić, że lista się wczytuje.

Jeśli po aktualizacji pnpm zgłasza *unmet peer* dla pakietu zewnętrznego, nowe wydanie podniosło
zakres, który Twój `package.json` wciąż ma niższy. Podnieś go tam do zakresu podanego
w ostrzeżeniu i uruchom `pnpm install`.

### Dodawanie modułu, który jest nowy w wydaniu {#adding-a-new-module}

Aktualizacja przesuwa pakiety, które Twoja instancja już deklaruje. Moduł, który pojawia się
w wydaniu po raz pierwszy, do nich nie należy, więc po aktualizacji nie jest ani zainstalowany,
ani widoczny na ekranie **Modules** — chyba że wymaga go moduł zainstalowany w instancji: wtedy
pierwszy krok `setup`, `endora generate`, sam go deklaruje i instaluje. Żeby mieć każdy inny, zadeklaruj jego pakiet w głównym
`package.json` i uruchom `setup` — w katalogu głównym instancji:

```bash
pnpm add -w -E @endora-commerce/mod-<name>@<version>
pnpm run setup
```

`<version>` to wydanie, w którym jest instancja — wersja, jaką `@endora-commerce/platform` ma
w głównym `package.json`. Potem uruchom ponownie API i podgląd panelu, jak wyżej: `setup` wykonał
migracje modułu, zainstalował go i zbudował panel od nowa.

Obie flagi mają znaczenie:

- **`-w`** — katalog główny instancji jest katalogiem głównym workspace'u, a lista modułów to
  jego `dependencies`. Bez tej flagi pnpm 9 odmawia z błędem `ERR_PNPM_ADDING_TO_ROOT`.
- **`-E` i wersja** — każdy pakiet wydania jest w tym pliku przypięty dokładnie do jednej wersji.
  Bez nich pnpm zapisuje dla tego jednego pakietu zakres `^<version>`, a instalacja, która
  rozwiązuje go od nowa, może wybrać dla niego późniejsze wydanie poprawkowe niż dla reszty: to
  niespójny zestaw opisany w sekcji
  [Instancja niespójna od początku](#instancja-niespójna-od-początku). `pnpm run upgrade`
  zachowuje dokładne przypięcie jako dokładne, a `^` jako `^`, więc zakres zapisany tutaj
  pozostaje zakresem.

O tym, czy moduł jest po instalacji włączony, decyduje deklaracja samego modułu; podaje to sekcja
wydania, które go wprowadza.

## Jeśli krok się nie powiedzie

Polecenie kończy się kodem wyjścia tego kroku i wypisuje, co zostało, jako polecenia do wpisania.
Manifesty wskazują już nową wersję, więc ponowne `pnpm run upgrade <version>` zaczyna od
instalacji. Samo `pnpm run setup` zawsze można bezpiecznie uruchomić ponownie.

## Instancje utworzone przed tym poleceniem {#before-the-command}

Polecenie `upgrade` należy do `@endora-commerce/cli`. Instancja utworzona przez wydanie `0.101.x`
lub starsze ma CLI bez niego i nie ma skryptu `upgrade`. Zainstaluj CLI wydania, na które
przechodzisz, i uruchom polecenie przez nie:

```bash
pnpm add -D -w @endora-commerce/cli@<version>
pnpm exec endora upgrade <version>
```

Żeby od tej chwili mieć `pnpm run upgrade`, dodaj `"upgrade": "endora upgrade"` do `scripts`
w głównym `package.json`.

### Instancje utworzone w wydaniu 0.100.x

Zmierzone z `0.100.2` do `0.101.1`: powyższe polecenia aktualizują instancję i naprawiają to, co
naprawiły pakiety platformy — ekran **Modules** się wczytuje, a `module:enable`,
`module:disable` i `module:uninstall` działają. Trzech rzeczy nie naprawiają pakiety i aktualizacja
ich nie zmienia:

- Dwóch plików, których instalator `0.100.x` nie zapisał — linii `DEPLOYMENT` w `.env` i zależności
  `@endora-commerce/contracts`. Zobacz
  [Instancje utworzone w wydaniu 0.100.2 lub wcześniejszym](./create-your-first-module.md#older-instances).
- Instalator `0.100.x` nie zapisywał storefrontu poza klonem repozytorium. Utwórz go poleceniem
  `endora new storefront` — zobacz [Sklep](./getting-started.md#sklep).
- Instalator `0.100.x` nie zmieniał zajętego portu, więc zanim cokolwiek uruchomisz, sprawdź, czy
  `.env` nie wskazuje bazy danych innego środowiska.

### Instancje utworzone przed wydaniem 0.102.0 {#puck-rename}

Wydanie `0.102.0` przeniosło Page Builder z `@measured/puck` na `@puckeditor/core` — Puck
zmienił nazwę pakietu w wersji 0.21 — a aktualizacja nie zmienia tej nazwy w Twoich plikach. Gdy
`pnpm run upgrade` się zakończy, zastąp `"@measured/puck"` wpisem
`"@puckeditor/core": "^0.23.0"` w każdym `package.json`, który go deklaruje (w katalogu głównym
instancji i w storefroncie), a w swoich plikach — w `app/`, `components/` i `test/` storefrontu
oraz we wszystkim, co Twoje, w `admin/src` lub w module nakładkowym (overlay) — zmień importy
`'@measured/puck'` na `'@puckeditor/core'` i `'@measured/puck/puck.css'` na
`'@puckeditor/core/puck.css'`. Znajdzie je w każdym z drzew
`grep -rl "@measured/puck" --exclude-dir=node_modules .`. Potem uruchom `pnpm install` w obu.
Bez tej zmiany `pnpm run build` storefrontu kończy się błędem sprawdzania typów. Zapisane strony,
bloki i szablony nie wymagają zmian.

### Po aktualizacji do wydania 0.103.0 {#after-0-103-0}

Wydanie `0.103.0` usuwa błąd izolacji tenantów w każdej instancji utworzonej z opublikowanych
pakietów do wydania `0.102.0` włącznie: żądania nie były ograniczane do organizacji klienta ani
klucza API, który je wysyłał, zasięg administratora nie wynikał z jego roli, a wpisy audytu nie
zapisywały administratora, który wykonał operację. **Poprawką jest sama aktualizacja.** Niczego
w instancji nie trzeba w tym celu edytować — `backend/src/index.ts` zostaje bez zmian.

**Przenieś wszystkie pakiety `@endora-commerce/*` razem.** `pnpm run upgrade` tak robi. Jeśli
ustawiasz wersje ręcznie, nie zostaw żadnego z tyłu: gdy platforma jest zaktualizowana,
a `@endora-commerce/mod-organizations` zostaje we wcześniejszej wersji, żaden administrator —
także administrator platformy — nie ma dostępu do żadnej organizacji, a ekrany ograniczone do
organizacji są puste. Backend zapisuje wtedy przy starcie ostrzeżenie, w którym pada nazwa
`adminTenantScopePort`.

Trzy rzeczy, których aktualizacja nie zrobi za Ciebie.

**Przypisz rolę każdemu kontu administratora, które jej nie ma.** Uprawnienia administratora
i organizacje, do których ma dostęp, wynikają z roli przypisanej do konta. Konto bez roli było
dotąd traktowane jak konto z dostępem do wszystkich organizacji; od wydania `0.103.0` jest
odrzucane. Nadal może się zalogować i wylogować, a każda trasa panelu chroniona uprawnieniem —
oraz pierwszy odczyt danych organizacji na każdej innej — odpowiada `403 ADMIN_ROLE_REQUIRED`.
Aktualizacja nie przypisuje takim kontom żadnej roli, bo każda domyślna oznaczałaby nadanie
dostępu, o którym nikt nie zdecydował. Backend przy każdym starcie zapisuje ostrzeżenie z liczbą
takich kont; brak ostrzeżenia oznacza, że ich nie ma.

Administrator, który może się zalogować, wybiera rolę na ekranie **Użytkownicy**. Gdy nie może
żaden, uruchom w katalogu głównym instancji:

```bash
pnpm run admin:create -- --email=<adres e-mail konta> --password-stdin \
  --first-name=<imię> --last-name=<nazwisko> [--role=<kod>]
```

Polecenie znajduje konto po adresie e-mail i je aktualizuje: przypisuje rolę administratora
platformy (`platform_admin`) albo rolę wskazaną przez `--role`, **i ustawia podane hasło** —
dotychczasowe hasło konta przestaje działać. Ustawia też konto jako aktywne, więc nie uruchamiaj
go dla konta, które celowo zdezaktywowano. `--password-stdin` wczytuje hasło, co najmniej
12 znaków, ze standardowego wejścia. Od tego wydania każda instancja ma rolę `platform_admin`:
każdy start upewnia się, że istnieje, i nie da się jej już usunąć. Zobacz
[Każdy administrator ma rolę](./modules/admin_users.md#każdy-administrator-ma-rolę).

Jeśli coś Twojego tworzy konta administratorów przez API, musi teraz przesyłać rolę już przy
tworzeniu: `POST /api/v1/admin/admin-users` bez `adminRoleId` oraz `PATCH`, który ustawia je na
`null`, odpowiadają `400 ADMIN_USER_ROLE_REQUIRED`.

**Uruchom raz przebieg próbny naprawy zamówień.** Wcześniejsze wydanie mogło zostawić zamówienie
anulowane albo opłacone, a mimo to nadal trzymające stan magazynowy lub rezerwację limitu
kredytowego — i nic nie zwalnia ich samo. W katalogu głównym instancji, gdy `pnpm run upgrade`
się zakończy:

```bash
pnpm run cli orders transition-effects-repair           # wypisuje, niczego nie zapisuje
pnpm run cli orders transition-effects-repair --apply   # zwalnia to, co wymieniła lista
```

Przeczytaj listę, zanim ją zastosujesz: zwolnienie zmienia liczniki zarezerwowanego stanu
i dostępny limit. `--except=<identyfikator zamówienia>` pomija zamówienie,
a `--order=<identyfikator zamówienia>` naprawia tylko wskazane — zobacz
[Naprawa zamówień pozostawionych przez wcześniejszą wersję](./modules/orders.md#naprawa-zamówień-pozostawionych-przez-wcześniejszą-wersję).
Polecenie, które wypisuje `No projects matched the filters`, niczego nie uruchomiło, niezależnie
od kodu wyjścia: to `pnpm --filter backend …`, czyli postać dla klonu repozytorium Endora
Commerce, wpisana w instancji.

**Dodaj jedną linię do `vitest.config.mts` storefrontu.** Własne testy `.tsx` storefrontu kończą
się błędem *Failed to parse source for import analysis*, gdy jego instalacja wybierze Vite 8.
Obok bloku `esbuild` w tym pliku dodaj:

```ts
oxc: { jsx: { runtime: 'automatic', importSource: 'react' } },
```

#### Bloki modułów w istniejącym storefroncie {#storefront-block-renderers}

Od wydania `0.103.0` pakiet modułu może zawierać komponenty, które wyświetlają w storefroncie
jego własne bloki Page Buildera, a storefront utworzony przez wydanie `0.103.0` lub nowsze
podłącza je sam. **Storefront utworzony wcześniej nie zyskuje tego przez aktualizację**:
aktualizacja przesuwa jego pakiety, a nie źródła. Po aktualizacji buduje się i wyświetla strony,
które wyświetlał wcześniej. Czego mu brakuje:

- blok, który wyświetla wyłącznie pakiet modułu, nie jest rysowany — nie ma skryptu
  `blocks:generate`, który znalazłby pakiet, ani niczego, co zaimportowałoby jego komponent;
- blok modułu, który wyłączyłeś, nie jest ukrywany, podczas gdy nowszy storefront nie wyświetla
  w jego miejscu niczego;
- nie ma pliku `lib/page-builder/local-blocks.tsx` na blok, który storefront wyświetla sam.

Jeśli nie korzystasz z żadnej z tych rzeczy, możesz zostawić storefront bez zmian. Żeby go
uzupełnić, weź pliki ze storefrontu zapisanego przez nowe CLI. Utwórz go obok swojego — ustawienia
wczyta z pliku `.env`, który skopiujesz, a nic nie zostanie zainstalowane ani uruchomione:

```bash
mkdir ../storefront-0.103.0
cp ../my-shop-storefront/.env ../storefront-0.103.0/.env
pnpm exec endora new storefront ../storefront-0.103.0
```

Następnie przenieś z tego katalogu do swojego storefrontu:

1. **Skopiuj pliki, które są nowe**: `components/BlockRenderScope.tsx`, katalog
   `lib/page-builder/`, `scripts/block-discovery.mjs`, `scripts/generate-blocks.mjs`,
   `app/blocks.generated.css` oraz testy `test/block-registry.test.ts`
   i `test/ssr/module-blocks.test.tsx`.
2. **Weź nową wersję plików, które się zmieniły** — a jeśli któryś edytowałeś, nanieś różnicę
   ręcznie: `components/PageBuilderRender.tsx`, `app/layout.tsx`, `app/globals.css`,
   `app/blog/_components/BlogCategoryPage.tsx`, `app/blog/_components/BlogPostBody.tsx`,
   `components/Megamenu/MenuCmsBlockEmbed.tsx`, `lib/api/module-presence.ts`,
   `scripts/theme-discovery.mjs` oraz testy `test/lib/module-presence.test.ts`
   i `test/ssr/block-degradation.test.tsx`.
   `diff -ru ../my-shop-storefront ../storefront-0.103.0` pokazuje każdą różnicę, obok Twoich
   własnych zmian.
3. **Dodaj skrypt do `package.json`** i uruchamiaj go w `dev` i `build`, po `themes:generate`:

   ```json
   "dev": "pnpm run themes:generate && pnpm run blocks:generate && node --env-file-if-exists=.env node_modules/next/dist/bin/next dev",
   "build": "pnpm run themes:generate && pnpm run blocks:generate && next build && pnpm run check:themes",
   "blocks:generate": "node scripts/generate-blocks.mjs",
   ```

4. Jeśli Twój storefront gdziekolwiek sam montuje komponent `<Render>` z Pucka, użyj tam
   `PageBuilderRender`: to jedyne miejsce, w którym stosowane są bloki modułów i reguła
   wyłączonego modułu.
5. Uruchom `pnpm run typecheck`, `pnpm test` i `pnpm run build`, a potem usuń katalog, z którego
   kopiowałeś.

Na ile ta procedura została sprawdzona: na storefroncie utworzonym przez wydanie `0.102.0`
i od tego czasu nieedytowanym daje te same pliki, które ma storefront `0.103.0`, a sprawdzanie
typów, testy i build przechodzą. Nie sprawdzono jej na storefroncie, którego pliki zmieniono, ani
przez wyświetlenie bloku modułu w storefroncie uzupełnionym w ten sposób — przed wdrożeniem
sprawdź strony, które zawierają treść z Page Buildera.

### Po aktualizacji do wydania 0.104.0 {#after-0-104-0}

`pnpm run upgrade 0.104.0` to cała aktualizacja: niczego w instancji nie trzeba w tym celu
edytować. Poniżej: jeden moduł, którego aktualizacja nie dodaje, trzy rzeczy, które po niej
działają inaczej, oraz to, co warto przenieść do istniejącego storefrontu i do własnego kodu.

**Nowy moduł, CRM, nie zostaje dodany przez aktualizację.** `0.104.0` to pierwsze wydanie modułu
`crm` (`@endora-commerce/mod-crm`): szanse sprzedaży z konfigurowalnym przepływem statusów,
tablicą, kalendarzem i analityką, w panelu administracyjnym. Instancja utworzona w wydaniu
`0.103.x` lub wcześniejszym po aktualizacji go nie ma — nie widać go na ekranie **Modules**, a
`/crm/board` odpowiada *Page not found*. (Instancja utworzona przez instalator wydania `0.104.0`
już deklaruje ten pakiet, a `pnpm add` odpowiada *Already up to date*.) Żeby go dodać, w katalogu
głównym instancji:

```bash
pnpm add -w -E @endora-commerce/mod-crm@0.104.0
pnpm run setup
```

Jeśli instancja jest już w nowszym wydaniu, wpisz jego wersję zamiast `0.104.0` — obie flagi
opisuje sekcja [Dodawanie modułu, który jest nowy w wydaniu](#adding-a-new-module). Potem uruchom
ponownie API i podgląd panelu.

- **Po instalacji jest włączony.** `setup` go instaluje, a od ponownego uruchomienia moduł jest
  aktywny, z sekcją **CRM** w menu bocznym. Jeśli chcesz mieć pakiet bez tej funkcji, wyłącz moduł
  na ekranie **Modules** (`/platform/modules`): jego ekrany, uprawnienia i ustawienia znikają,
  jego trasy odpowiadają `503 MODULE_DISABLED`, a nic nie zostaje usunięte.
- **Żadna rola nie dostaje jego uprawnień.** `crm:read`, `crm:write`, `crm:configure`
  i `crm:analytics` nie są automatycznie nadawane żadnej roli. Administrator platformy ma
  wszystkie uprawnienia i widzi moduł od razu; każdej innej roli, która ma z niego korzystać,
  nadaj te cztery.
- **Dane demonstracyjne.** W instancji z załadowanym sklepem demonstracyjnym
  `pnpm run cli demo seed` dodaje demonstracyjny lejek sprzedaży. `pnpm run cli demo reset`
  wycofuje go niezależnie od tego, czy CRM jest włączony; trzy demonstracyjne etykiety wycofuje
  tylko reset uruchomiony przy włączonym CRM.

Co robi moduł, opisuje strona [CRM](./modules/crm.md).

**Trzy rzeczy działają po aktualizacji inaczej.** Żadna nie wymaga kroku, chyba że chcesz
zachować wcześniejsze zachowanie.

- **Na frazę wyszukiwania odpowiada moduł wyszukiwania.** `GET /api/v1/catalog/products` z frazą
  (`q`) — to, co czyta strona `/search` storefrontu — było dotąd obsługiwane z bazy danych,
  chyba że ustawiono `CATALOG_SEARCH_BACKEND=meilisearch`. Gdy zmienna nie jest ustawiona, fraza
  trafia teraz do modułu `search`, o ile jest włączony: wyniki są uporządkowane według trafności
  i wybaczają literówkę, a fragment ze środka słowa lub SKU już nie pasuje. Żeby zachować
  wcześniejsze zachowanie, ustaw `CATALOG_SEARCH_BACKEND=postgres` w pliku `.env` instancji.
- **Zapytania ofertowego z niewycenioną pozycją nie da się zatwierdzić ani zamienić na
  zamówienie.** Akceptacja, zatwierdzenie i zamiana zapytania ofertowego na zamówienie odpowiadają
  teraz `409`, dopóki któraś pozycja nie ma uzgodnionej ceny jednostkowej. Zapytania, które już
  ma status `Approved` i taką pozycję, nie da się zamienić na zamówienie; w tym statusie jego
  pozycji nie można edytować, więc pozostaje złożyć je ponownie (`resubmit`). Żeby je znaleźć:

  ```sql
  select distinct qr.id, qr.business_id
    from quote_requests qr
    join quote_request_items it on it.quote_request_id = qr.id
   where qr.status = 'Approved' and it.agreed_unit_price is null;
  ```

  To samo zapytanie z `qr.status = 'Completed'` wypisuje zapytania ofertowe, z których w ten
  sposób już złożono zamówienia; same zamówienia pozostają bez zmian.
- **Słownik zawiera każdy język ISO 639-1.** Brakujące wiersze są dodawane przy pierwszym starcie
  po aktualizacji jako nieaktywne, więc nic, co czyta aktywne języki, się nie zmienia; `en-US`
  i `pl-PL` pozostają jedynymi aktywnymi, dopóki nie aktywujesz kolejnego. Dodany wiersz, który
  usuniesz, wraca przy następnym starcie — zamiast usuwać, zostaw go nieaktywnym.

**W istniejącym storefroncie**, który zachowuje źródła, z którymi powstał:

- W `lib/api/cms.ts` zmień tag pamięci podręcznej przy pobraniu `getCmsPageIndex` z `'cms:page'`
  na `CMS_STOREFRONT_CACHE_TAGS.pageIndex`, importowany z `@endora-commerce/contracts`. Bez tej
  zmiany wszystko działa dalej, a nowo opublikowana strona CMS trafia do `sitemap.xml` dopiero
  po upływie 60-sekundowego okna pamięci podręcznej.
- Kategoria może teraz mieć treść z Page Buildera, edytowaną przez akcję **Content** w drzewie
  kategorii. Storefront pokazuje ją tylko wtedy, gdy ją wyświetla. Storefront zapisany przez CLI
  wydania `0.104.0` to robi: `app/(catalog)/c/[slug]/page.tsx` wywołuje
  `getCategoryPageContent(node.id, ctx)`, funkcję z `lib/api/catalog.ts`, i rysuje wynik
  komponentem `components/CategoryContent.tsx`. Żeby je przenieść, utwórz storefront, z którego
  skopiujesz pliki, tak jak w sekcji
  [Bloki modułów w istniejącym storefroncie](#storefront-block-renderers).

**`@dnd-kit/core` to nowa zależność peer pakietu `@endora-commerce/admin-kit`.** pnpm sam
instaluje brakujący peer, o ile tego nie wyłączyłeś, więc instancja nie musi nic robić. Jeśli
Twój `.npmrc` ustawia `auto-install-peers=false`, dodaj `"@dnd-kit/core": "^6.3.1"` do
`dependencies` w `admin/package.json`, który deklaruje ten pakiet, i uruchom `pnpm install`.

**Jeśli Twój własny kod implementuje port platformy albo buduje jeden z jej rekordów** — moduł
nakładkowy albo dubler testowy — cztery kształty z `@endora-commerce/contracts` zyskały wymagany
element i taki kod nie skompiluje się, dopóki go nie ma: `CartRecord.sourceQuoteRequestId`
(`null`, gdy koszyk nie powstał z zapytania ofertowego), `CatalogAttributeView.isPriceRule`
(`false`), `AuthSessionReadPort.lastSeenByAdminUser` i `LanguageSeedPort.ensureSeeded`.

Na ile zostało to sprawdzone: aktualizacja z `0.103.1`, w instancji utworzonej z demonstracyjnym
zestawem modułów, przeszła do końca z pnpm 9 i bez żadnej ręcznej edycji, a panel i niezmieniony
storefront zbudowały się potem i wyświetlały swoje strony; następnie dodano `crm` poleceniami
`pnpm add -w` i `setup` — po instalacji był włączony. Dokładną postać `pnpm add` podaną wyżej
uruchomiono w pomocniczym workspace'ie, a nie w zaktualizowanej instancji. Nie sprawdzono
wyłączenia `crm`, obu zmian w storefroncie, instancji z `auto-install-peers=false` ani instancji
z modułami nakładkowymi; to, co ta sekcja o nich mówi, pochodzi z dzienników zmian wydania.

### Po aktualizacji do wydania 0.105.0 {#after-0-105-0}

`pnpm run upgrade 0.105.0` przenosi pakiety i wykonuje migracje wydania, a instancja uruchamia się
potem bez edycji żadnego ze swoich plików. To wydanie zmienia zachowanie: sposób logowania
administratorów i czas życia sesji, kanał sprzedaży, do którego należy zamówienie i metoda, to,
kto odczytuje pole niestandardowe, oraz szereg odpowiedzi API. Ta sekcja mówi, co zrobić i w
jakiej kolejności, a potem — co działa inaczej, osobno dla każdego czytelnika:
[operatorów](#after-0-105-0-operators), [klientów API i integratorów](#after-0-105-0-api),
[autorów modułów i modułów nakładkowych](#after-0-105-0-authors) oraz właściciela
[istniejącego storefrontu](#after-0-105-0-storefront).

#### Co zrobić i w jakiej kolejności {#after-0-105-0-steps}

Przed aktualizacją:

1. **Odczytaj `quote_requests.expiry_days`** — *Automatyczne wygaszenie oczekujących po (dni)* na
   karcie Zapytania ofertowe w **Ustawieniach** — dla domyślnego kanału sprzedaży. Przy `0`,
   wartości domyślnej, nic z tego nie wynika. Przy każdej innej wartości zadanie wygaszające,
   które od tego wydania rzeczywiście działa, w pierwszych przebiegach po aktualizacji wygasza
   każde otwarte zapytanie ofertowe nieaktywne przez tyle dni. Jeśli chcesz najpierw przejrzeć
   otwarte zapytania, ustaw wcześniej `0`; regułę opisuje punkt *Zapytania ofertowe wygasają* w
   części [Dla operatorów](#after-0-105-0-operators).
2. **W instancji z jednym kanałem sprzedaży odczytaj `orders.min_order_value`.** Ustawione dla
   kanału domyślnego, a nie dla wszystkich kanałów, nie było egzekwowane dla zamówień ze
   storefrontu, a teraz jest.
3. **Jeśli Twoje zadanie uruchamia `demo reset`**, zdecyduj, czy jego wiersz poleceń potrzebuje
   `--force-delete-financial-records`: bez tej flagi reset odmawia teraz wycofania danych
   demonstracyjnych, w których przyjęto płatność albo wystawiono fakturę.

Po aktualizacji, zanim instancja znów przyjmie ruch:

4. **Za reverse proxy sprawdź, czy ustawiono `TRUSTED_PROXY_HOPS` albo `TRUSTED_PROXY_ADDRESSES`**
   w środowisku backendu. Żadna z tych zmiennych nie jest nowa. Nowy jest limit błędnych haseł
   administratora liczony dla adresu klienta: bez jednej z nich każde żądanie ma adres proxy, więc
   pięć błędnych haseł do jednego konta, wysłanych przez kogokolwiek, opóźnia logowanie na to
   konto z każdego urządzenia, na którym wcześniej się na nie nie zalogowano. Jak dobrać wartość,
   mówi
   [punkt G3 listy kontrolnej pierwszego wdrożenia](./deployment/first-deployment-checklist.md#g3-wskaż-backendowi-któremu-serwerowi-pośredniczącemu-wolno-podawać-adres-ip-klienta).
5. **W instancji z więcej niż jednym kanałem sprzedaży** — a jest nią każda instancja z
   załadowanymi danymi demonstracyjnymi — przejrzyj każdą metodę dostawy i
   płatności (*Metody dostawy i płatności są udostępniane w wybranych kanałach sprzedaży* poniżej)
   i wprowadź zmiany z części [W istniejącym storefroncie](#after-0-105-0-storefront).
6. **Przejrzyj definicje pól niestandardowych** na ekranie Pola niestandardowe. Aktualizacja
   oznacza każdą istniejącą definicję jako `customer`, więc nic, co klienci i integracje dotąd
   otrzymywali, nie zostaje wycofane. Każde pole, którego wartości są przeznaczone tylko dla
   administratorów, przestaw na `internal`.
7. **Jeśli skrypt albo integracja wywołuje `POST /api/v1/admin/i18n/reload` lub
   `GET /api/v1/admin/i18n/coverage`**, nadaj roli administratora, jako który się loguje,
   uprawnienie `settings:write` dla pierwszej trasy i `settings:read` dla drugiej.
8. **Tylko w publicznej instancji demonstracyjnej, która celowo publikuje hasło administratora**,
   rozważ `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off` — punkt *Logowanie administratora jest ograniczane*
   poniżej mówi, kiedy i co ta zmienna wyłącza.
9. **Zbuduj własne moduły ponownie z tym wydaniem.** Źródła, które implementują jeden z portów
   wymienionych w części [Dla autorów modułów i modułów nakładkowych](#after-0-105-0-authors), nie
   skompilują się, dopóki ich nie zmienisz, a moduł, który tworzy metodę dostawy lub płatności,
   trzeba wydać ponownie.

W dowolnym momencie:

10. Dodaj trzy wiersze do pliku `.gitignore` instancji, który zachowuje treść, z jaką powstał:

    ```
    docs/build/
    docs/.docusaurus/
    backend/var/
    ```

    Zbudowanie strony dokumentacji instancji zapisuje dwa pierwsze katalogi, a gdy git je śledzi,
    różnica po aktualizacji to już nie `package.json` każdego członka workspace'u i plik
    blokady — w aktualizacji opisanej na końcu tej sekcji były to 162 pliki. Jeśli któryś z nich
    jest już w repozytorium, uruchom raz `git rm -r --cached docs/build docs/.docusaurus`: git
    nigdy nie ignoruje pliku, który śledzi. `backend/var/` to miejsce, w którym zapisywane są
    pliki przesłane do biblioteki zasobów, dopóki `assets.local.base_dir` ma wartość domyślną
    `var/assets`. Plik `.gitignore` z żadnego wydania go nie obejmuje, więc katalog pojawia się
    jako nieśledzony obok różnicy z aktualizacji. To dane Twojego sklepu, a nie źródła: trzymaj
    go poza repozytorium i twórz jego kopię zapasową razem z bazą danych — baza odtworzona bez
    niego zawiera zasoby, których plików brakuje.
11. W instancji z załadowanym sklepem demonstracyjnym uruchom ponownie `pnpm run cli demo seed`.
    Demonstracyjna rola `sales_representative` dostała przy tworzeniu kod uprawnienia, którego
    nie deklaruje żaden moduł, przez co edytor ról odrzuca każdy zapis tej roli odpowiedzią
    `400 Unknown permission(s): organizations:read.assigned`; ponowne załadowanie danych wycofuje
    ten kod z roli i niczego więcej w niej nie zmienia.

#### Dla operatorów {#after-0-105-0-operators}

**Logowanie administratora jest ograniczane.** Hasło albo kod drugiego składnika dla konta
administratora można próbować tylko kilka razy z rzędu: pięć błędnych prób z jednego adresu na
jedno konto albo dwadzieścia na jedno konto ze wszystkich adresów łącznie rozpoczyna opóźnienie
jednej minuty, które podwaja się z każdą kolejną błędną próbą, najwyżej do piętnastu minut. W
czasie opóźnienia próba otrzymuje odpowiedź `429 ADMIN_AUTHENTICATION_THROTTLED`, a poprawne hasło
również jest odrzucane. Nic nie jest blokowane na stałe: licznik zeruje udana próba, a bez niej
jest zapominany trzydzieści minut po pierwszej błędnej.

- Zakończone logowanie hasłem zostawia na urządzeniu plik cookie `b2b_admin_device`. To nie jest
  sesja i niczego nie daje; urządzenie, które go ma, jest liczone we własnym limicie pięciu prób,
  a nie w limicie dwudziestu dla konta, więc błędne hasła wysyłane przez kogoś innego nie
  odcinają administratora od urządzenia, z którego już korzystał.
- Żeby wyzerować wszystkie liczniki jednego konta, w katalogu głównym instancji:

  ```bash
  pnpm run cli admin_users unlock --email=<their e-mail>
  ```

  W obrazie produkcyjnym to samo polecenie to
  `node dist/cli.js admin_users unlock --email=<their e-mail>`, uruchomione w kontenerze backendu.
  Pierwszy wiersz jego wyjścia podaje, na której instancji Redis zadziałało.
- Każde opóźnienie rozpoczęte dla istniejącego konta zapisuje jeden wpis w dzienniku audytu,
  `admin_user.authentication_throttled`.
- Liczniki są przechowywane w Redis. Dopóki Redis nie odpowiada, logowanie jest odrzucane
  odpowiedzią `503 ADMIN_AUTHENTICATION_UNAVAILABLE`.
- **Publiczna instancja demonstracyjna.** Limit dwudziestu prób zakłada, że hasło jest tajne. W
  instancji, która celowo publikuje adres e-mail i hasło administratora, każdy odwiedzający jest
  urządzeniem logującym się po raz pierwszy i korzysta z tego wspólnego limitu. W takiej
  instancji, i tylko w takiej, ustaw `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off` w środowisku backendu i
  uruchom go ponownie. Zmienna wyłącza liczenie błędnych **haseł** dla całego konta i nic więcej —
  limit dla adresu, limit dla znanego urządzenia, oba limity kodów drugiego składnika i
  opóźnienia pozostają — a backend, dopóki limit jest wyłączony, zapisuje ostrzeżenie w logu
  przy każdym starcie. Działa wyłącznie dokładna wartość `off`. To nie jest ustawienie i nie da
  się go zmienić w panelu administracyjnym. Plik `compose.prod.yml` zapisany przez wcześniejsze
  wydanie nie przekazuje tej zmiennej do backendu: dodaj
  `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT: ${ADMIN_AUTH_ACCOUNT_WIDE_LIMIT}` obok wiersza
  `TRUSTED_PROXY_ADDRESSES`. Nie ustawiaj jej tam, gdzie hasła administratorów nie są publiczne.

Liczby są stałymi modułu, a nie ustawieniami. Zobacz
[Ograniczanie powtarzanych błędnych haseł i kodów](./modules/admin_users.md#ograniczanie-powtarzanych-błędnych-haseł-i-kodów).

**Zmiana danych uwierzytelniających kończy sesje uzyskane przed nią.** Spodziewaj się, że
administratorzy i klienci zostaną wylogowani na pozostałych urządzeniach tam, gdzie dotąd nie
byli:

- administrator, który zmienia własne hasło albo wyłącza własne uwierzytelnianie dwuskładnikowe,
  kończy wszystkie pozostałe sesje konta i zachowuje tę, z której dokonano zmiany;
- dezaktywacja albo usunięcie administratora kończy wszystkie sesje konta, a sesja konta, które
  nie jest aktywne, jest odrzucana niezależnie od tego, czy cokolwiek ją unieważniło;
- `pnpm run admin:create` uruchomione ponownie dla istniejącego konta zastępuje jego hasło, jak
  dotąd, a teraz kończy też wszystkie sesje tego konta;
- klient, który zmienia hasło albo wyłącza uwierzytelnianie dwuskładnikowe, kończy wszystkie
  pozostałe sesje konta; użycie odnośnika resetującego hasło kończy je wszystkie, podobnie jak
  zresetowanie drugiego składnika klienta przez administratora.

Każda z tych operacji wycofuje też logowanie rozpoczęte i niedokończone — oczekujące wyzwanie
drugiego składnika albo bilet konfiguracji. Klucze API nie są sesjami i pozostają bez zmian.
Zobacz [Sesje a zmiana hasła](./modules/admin_users.md#sesje-a-zmiana-hasła).

**Żeby zmienić własne hasło, administrator podaje obecne.** Ekran profilu ma pole *Obecne hasło*
nad polem *Nowe hasło*, wymagane tylko wtedy, gdy wpisano nowe hasło, a nowe hasło równe obecnemu
jest odrzucane. Reset hasła innego administratora na ekranie **Users** oraz `admin:create`
pozostają bez zmian.

**Czas bezczynności do wylogowania obowiązuje każdego administratora.**
`admin.idle_logout_minutes` trafia teraz do każdego zalogowanego administratora. Administrator,
którego rola nie obejmuje `settings:read`, był wylogowywany po wbudowanych 60 minutach niezależnie
od ustawienia, a teraz jest wylogowywany po skonfigurowanym czasie.

**Pole niestandardowe ma odbiorców.** Każda definicja mówi, komu zwracane są jej wartości:
`internal` — tylko administratorom — albo `customer` — także w odpowiedziach dla klienta
dotyczących jego zamówień i zapytań ofertowych oraz w zewnętrznych (dla klucza API) odpowiedziach
z zamówieniami. Definicje istniejące przed aktualizacją mają `customer`; pole utworzone od teraz
ma `internal`, chyba że autor wybierze inaczej w formularzu definicji (*Kto widzi wartość*).
Zmiana odbiorców działa od następnego odczytu, a do każdego procesu API może dotrzeć z opóźnieniem
do pięciu sekund. Zobacz
[Widoczność: kto odczytuje wartości pola](./architecture/custom-fields.md#widoczność-kto-odczytuje-wartości-pola).

**Zapytania ofertowe wygasają.** Zadanie wygaszające, które opisuje dokumentacja modułu
`quote_requests`, teraz działa: co 30 minut, w każdym procesie obsługującym kolejki, dopóki moduł
jest włączony. `quote_requests.expiry_days = 0`, wartość domyślna, wyłącza je. W przeciwnym razie
zapytanie, które nadal ma status `Pending` albo `Created from admin`, od tylu dni nie dostało
żadnego wpisu w historii i nie zawiera oferty, której termin ważności jeszcze nie minął,
otrzymuje status `Expired`.

- **Włączenie ustawienia albo obniżenie jego wartości wygasza zaległości.** Reguła dotyczy
  wszystkiego, co jest otwarte, a nie liczy się od dnia ustawienia — a instancja, która ma już to
  ustawienie, trafia na te zaległości w pierwszych przebiegach po tej aktualizacji.
- Jeden przebieg wygasza najwyżej 500 zapytań, od najstarszych; większe zaległości są
  obsługiwane w kolejnych przebiegach.
- Dla zapytania, które powinno było wygasnąć ponad 24 godziny przed przebiegiem, który do niego
  dotarł, nie jest zapisywany rekord powiadomienia. Wpis w historii nadal powstaje, a
  `rfq.expired.v1` nadal jest emitowane.
- Zadanie odczytuje wartość domyślnego kanału sprzedaży i stosuje ją do zapytań z każdego kanału;
  kanał ustawiony na `0` nie jest wyjątkiem.

Zobacz [Zadania w tle](./modules/quote_requests.md#zadania-w-tle).

**Zamówienie złożone w storefroncie jest zapisywane w kanale sprzedaży, w którym wykonano
żądanie.** `POST /api/v1/orders` brał dotąd kanał zamówienia z opcjonalnego pola `salesChannelId`
w treści żądania, a gdy go nie było — używał kanału domyślnego; teraz używa kanału rozpoznanego dla
żądania — `X-Sales-Channel`, `?salesChannel=`, mapa hostów, a w ostatniej kolejności kanał
domyślny — i odrzuca treść żądania, która wskazuje inny kanał. Co to oznacza, zależy od liczby
kanałów sprzedaży w instancji. Instancja z załadowanymi danymi demonstracyjnymi ma dwa —
`pl_retail`, domyślny, oraz `pl_b2b_vip` — więc dotyczy jej przypadek *Więcej niż jeden*, tutaj i
przy metodach poniżej.

- **Jeden kanał sprzedaży.** Zmienić może się jedna rzecz. Jeśli `orders.min_order_value` jest
  ustawione **dla kanału domyślnego**, a nie dla wszystkich kanałów, to nie było egzekwowane dla
  zamówień ze storefrontu, a teraz jest. Jeśli nie masz pewności, który to przypadek, sprawdź
  wartość w **Ustawieniach** przed aktualizacją.
- **Więcej niż jeden.** Nowe zamówienia składane w storefroncie kanału innego niż domyślny są
  zapisywane w tym kanale, a nie w domyślnym, i obowiązują dla nich jego minimalna wartość
  zamówienia, magazyny, ustawienia realizacji, numeracja zamówień, dane sprzedawcy i numeracja
  faktur oraz język wiadomości e-mail. Istniejące zamówienia nie są zmieniane. Koszyki nadal
  powstają w kanale domyślnym, więc ceny pozycji i promocje takiego zamówienia są nadal z kanału
  domyślnego, a każdy produkt został sprawdzony względem kanału żądania, które dodało go do
  koszyka, a nie względem kanału zamówienia — zobacz *Który kanał sprzedaży zapisuje zamówienie*
  na stronie modułu `orders`.

**Metody dostawy i płatności są udostępniane w wybranych kanałach sprzedaży.** Na ekranach
`/delivery-methods` i `/payment-methods` każda metoda ma teraz pole **Kanały sprzedaży**, a wybór
jest egzekwowany: storefront pokazuje tylko metody dostępne w kanale, w którym kupuje klient, a
zamówienie z metodą niedostępną w jego kanale jest odrzucane. Metoda nieprzypisana do żadnego
kanału jest dostępna w każdym kanale.

- **Jeden kanał sprzedaży.** Nic się nie zmienia: każda metoda jest dostępna w jedynym kanale,
  niezależnie od tego, czy jest do niego przypisana, czy nie jest przypisana do żadnego.
- **Więcej niż jeden: przejrzyj każdą metodę.** Kolumna **Kanały sprzedaży** na obu ekranach
  pokazuje stan każdej z nich.
  - Przypisane **tylko do kanału domyślnego**, a więc po aktualizacji niedostępne przy składaniu
    zamówienia w pozostałych kanałach: każda metoda utworzona dotąd w panelu administracyjnym, bo
    ekrany nie dawały innej możliwości, oraz każda metoda utworzona przez moduł bramki płatności
    lub przewoźnika **we wcześniejszym wydaniu** w instancji, która była już uruchomiona. Nic nie
    poszerza ich za Ciebie — takiej metody nie da się odróżnić od ograniczonej celowo.
  - Nieprzypisane **do żadnego kanału**, a więc dostępne w każdym kanale: każda metoda tworzona
    przez moduł od tego wydania, niezależnie od chwili instalacji; metody utworzone przez moduł we
    wcześniejszym wydaniu podczas pierwszej konfiguracji instancji, przed jej pierwszym
    uruchomieniem; oraz metody z danych demonstracyjnych.

  Otwórz każdą metodę i wybierz jej kanały albo odznacz wszystkie, aby była dostępna wszędzie.
- **Metoda dostawy utworzona w panelu administracyjnym we wcześniejszym wydaniu może nie być
  oferowana przy składaniu zamówienia w żadnym kanale**, niezależnie od liczby kanałów w
  instancji — i nie była też przed aktualizacją. Ekran nie wysyłał adaptera, więc metoda została
  zapisana z własnym kodem jako adapterem, a jeśli ten kod nie jest kluczem zarejestrowanego
  adaptera, nie ma czym jej oferować. To wydanie oznacza taki wiersz jako *Nieoferowana przy
  składaniu zamówienia*, wraz z przyczyną. Otwórz metodę i wybierz adapter w nowym polu
  **Adapter** — *Wysyłka własna (ręczna)* dla przesyłek, które nadajesz samodzielnie. Od tej
  chwili jest oferowana w kanałach, do których jest przypisana, czyli dla metody utworzonej w ten
  sposób — tylko w kanale domyślnym. Metod płatności to nie dotyczy: nie dało się utworzyć metody
  z adapterem, który nie jest zarejestrowany.

Przypisywanie kanałów sprzedaży wymaga `delivery_methods:write` / `payment_methods:write` i
niczego więcej; uprawnienia kanałów sprzedaży nie są potrzebne.

**Listy dozwolonych metod organizacji obowiązują przy każdym sposobie składania zamówienia.**
Metoda dostawy lub płatności spoza niepustej listy dozwolonych metod organizacji, dla której
składane jest zamówienie, jest odrzucana przy składaniu zamówienia i przy jego podglądzie — w
storefroncie, przy przyjmowaniu zamówień z kluczem API oraz wtedy, gdy administrator tworzy
zamówienie dla klienta. Żadne ustawienie nie zwalnia z tego administratora: formularz tworzenia
pokazuje każdą metodę, a podgląd i utworzenie odrzucają tę, której organizacja nie dopuszcza.
Pusta lista, jak dotąd, niczego nie ogranicza. Zobacz
[Listy dozwolonych metod przy składaniu zamówienia](./modules/orders.md#listy-dozwolonych-metod-przy-składaniu-zamówienia).

**Adapter metody dostawy wybiera się na ekranie `/delivery-methods`.** Formularz ma wymagane pole
wyboru **Adapter**. Metoda, której adaptera nie dostarcza żaden włączony moduł, jest oznaczona
jako *Nieoferowana przy składaniu zamówienia* wraz z przyczyną, a naprawia się ją, otwierając ją
i wybierając zarejestrowany adapter; nic nie jest za Ciebie przepisywane ani usuwane. Adaptera
metody, do której odwołują się przesyłki, nie da się zmienić: ustaw metodę jako nieaktywną i
utwórz drugą dla innego adaptera.

**Ekran Webhooks oferuje te typy zdarzeń, które są dostarczane, i żadnych innych.** Zapisana
subskrypcja, która wskazuje typ przez nic niedostarczany, zostaje zachowana, jest na ekranie
oznaczona jako niedostarczana i niczego nie otrzymuje, jak dotąd. Dostarczanych jest sześć typów,
których dotąd nie dostarczano: `product.created.v1`, `product.updated.v1`,
`product.archived.v1`, `rfq.created.v1`, `rfq.expired.v1` i `credit_limit.adjusted.v1`. Nic nie
jest grupowane — subskrypcja `product.updated.v1` otrzymuje jedno dostarczenie na każdy produkt
zapisany przez import albo edycję zbiorczą. Zobacz
[Które zdarzenia są dostarczane](./modules/webhooks.md#które-zdarzenia-są-dostarczane).

**Wiadomość e-mail, która została tylko zapisana w logu serwera, nie jest odnotowywana jako
wysłana.** W instancji bez `SMTP_URL` wiersze `email_deliveries` są zapisywane z
`status = 'logged'` zamiast `'sent'` (wiersze zapisane wcześniej zachowują `sent`), wystawienie
faktury albo ponowne wysłanie jej wiadomości z panelu administracyjnego informuje, że wiadomości
nie wysłano, bo nie skonfigurowano serwera poczty, a przypomnienie o wydarzeniu CRM jest
odnotowywane jako dostarczone wyłącznie do dzwonka powiadomień.

**`demo reset` to jedna transakcja i odmawia, gdy dane demonstracyjne obejmują dokumenty
finansowe.** Albo kończy się w całości, albo niczego nie zmienia. Wycofuje też to, co zostało po
korzystaniu ze sklepu demonstracyjnego w ramach organizacji demonstracyjnej — zamówienia, koszyki,
zapytania ofertowe, adresy i podobne; te wiersze są usuwane, a dane innej organizacji pozostają
nietknięte. Polecenie kończy się kodem 1, zanim cokolwiek usunie, gdy organizacja demonstracyjna
ma płatność opłaconą lub zwróconą, fakturę albo korektę, rekord systemu księgowego albo zwrot, i
wypisuje, ile każdego z nich znalazło. Zamówienia złożone i nigdy nieopłacone się nie liczą. Żeby
usunąć dokumenty finansowe razem z resztą:

```bash
pnpm run cli demo reset --force-delete-financial-records
```

Flaga jest odczytywana wyłącznie z tego wiersza poleceń. Pełną listę tego, co się liczy, podaje
strona [Pierwsze kroki](./getting-started.md).

**Endpoint stanu podaje wydanie.** Pole `version` w `GET /api/v1/_health` to wersja pakietu
`@endora-commerce/platform` załadowanego przez proces — `0.105.0` — albo `unknown`, podczas gdy
dotąd każda instancja podawała `0.0.0`. Monitoring, który porównywał to pole z `0.0.0`, albo
wdrożenie, które sterowało nim zmienną `npm_package_version`, wymaga zmiany. Panel administracyjny
pokazuje to samo wydanie jako znaczek pod logotypem w menu bocznym. Zobacz
[Pole `version`](./operations/health-endpoint.md#pole-version).

**W dzienniku audytu przybywa wpisów i ubywa szumu.** Każdy zapis bloku, szablonu albo hooka CMS
wykonany w panelu zostawia teraz wpis w dzienniku audytu (`cms_block.*`, `cms_template.*`,
`cms_hook.*`), tak jak dotąd zapisy stron. Zmiana własnego hasła przez administratora jest
zapisywana jako `admin_user.change_password` z `via: 'self_service'`, a nie jako
`admin_user.update`. A cztery zadania cykliczne — domykanie następstw zamówień, przypomnienia o
wydarzeniach CRM, porządkowanie przebiegów plików produktowych i przegląd statusów cenników —
nie zapisują już wiersza `tenant.escape_hatch` w przebiegu, który nie ma nic do zrobienia, co w
spokojnej instancji dawało kilka tysięcy wierszy dziennie.

Trzy drobniejsze rzeczy: administrator, którego konto nie ma roli, widzi o tym komunikat w panelu
administracyjnym; karty szansy sprzedaży w CRM pokazują liczniki, a migracja, która dodaje
liczniki nieprzeczytanych wiadomości, oznacza każdą wiadomość napisaną przed nią jako przeczytaną
przez wszystkich; a kampania newslettera bez kanału sprzedaży jest podglądana i wysyłana z
identyfikacją wizualną kanału domyślnego.

#### Dla klientów API i integratorów {#after-0-105-0-api}

Uwierzytelnianie i autoryzacja:

- **Zabezpieczenie trasy odpowiada przed walidacją treści żądania.** Na każdej trasie, która
  deklaruje zabezpieczenie sesją, uprawnieniem albo kluczem API, żądanie bez ważnych danych
  uwierzytelniających otrzymuje `401`, a bez uprawnienia `403`, niezależnie od treści. Klient,
  który dla niepoprawnej treści wysłanej bez danych uwierzytelniających oczekiwał
  `400 VALIDATION_FAILED`, zobaczy `401`/`403`. Uprawniony klient z niepoprawną treścią otrzymuje
  to samo `400` co dotąd, a treść odrzucana przez sam parser — błędny JSON, nieobsługiwany typ
  mediów, treść ponad limit — nadal otrzymuje odpowiedź jako pierwsza.
- **`PATCH /api/v1/admin/me` wymaga `currentPassword` do zmiany hasła.** `password` bez tego pola
  to `400 VALIDATION_FAILED`; błędne — `403 CURRENT_PASSWORD_INVALID`; nowe hasło równe obecnemu —
  `400 NEW_PASSWORD_UNCHANGED`. Odrzucone żądanie niczego nie zmienia, także imienia i nazwiska
  wysłanych razem z nim. Żądanie bez `password` działa jak dotąd.
- **Trasy danych uwierzytelniających administratora mogą odpowiedzieć
  `429 ADMIN_AUTHENTICATION_THROTTLED`**, z nagłówkiem `Retry-After` i tą samą liczbą w
  `error.details.retryAfterSeconds`, albo `503 ADMIN_AUTHENTICATION_UNAVAILABLE`:
  `POST /api/v1/auth/admin/login`, obecne hasło w `PATCH /api/v1/admin/me`,
  `POST /api/v1/auth/admin/mfa/verify`, `POST /api/v1/admin/account/mfa/disable` i
  `POST /api/v1/admin/account/mfa/recovery-codes/regenerate`. Trasy klientów pozostają bez zmian.
- **Jedno wyzwanie drugiego składnika dopuszcza pięć kodów**, dla klientów i administratorów,
  niezależnie od tego, jak są wysyłane; kolejny kod to `429 MFA_TOO_MANY_ATTEMPTS`, a logowanie
  zaczyna się od nowa.
- **Sesja konta administratora, które jest zdezaktywowane albo usunięte, otrzymuje
  `401 UNAUTHORIZED`** na każdej trasie panelu; trasa z kodem uprawnienia odpowiadała jej
  `403 FORBIDDEN`. Aktywne konto bez uprawnienia nadal otrzymuje `403`.
- **Przy logowaniu klienta `403 ACCOUNT_BLOCKED` pojawia się tylko wtedy, gdy hasło jest
  poprawne.** Błędne hasło do zablokowanego konta to `401 INVALID_CREDENTIALS`.
- **`POST /api/v1/admin/i18n/reload` wymaga `settings:write`, a
  `GET /api/v1/admin/i18n/coverage` wymaga `settings:read`**; sesja bez tego kodu otrzymuje `403`.
- **Subskrypcje push należą do tego, kto je utworzył.**
  `DELETE /api/v1/storefront/pwa/subscriptions` usuwa subskrypcję tylko wtedy, gdy żądanie zawiera
  jej własne klucze — `{ endpoint, keys: { p256dh, auth } }` — albo sesję klienta, do którego
  należy; w obu przypadkach odpowiada `204`. `POST` na tę samą ścieżkę aktualizuje już
  zarejestrowany endpoint na podstawie tego samego dowodu, a w przeciwnym razie odpowiada `201` z
  nowym `id` i niczego nie zapisuje.

Zamówienia, metody i zapytania ofertowe:

- **`POST /api/v1/orders` zapisuje kanał rozpoznany dla żądania.** `salesChannelId` w treści,
  które wskazuje inny kanał, to `422 VALIDATION_FAILED` z
  `details.code = "order_sales_channel_mismatch"`. Przestań wysyłać to pole i podaj kanał w
  `X-Sales-Channel`.
- **Składanie zamówienia i jego podgląd odrzucają metodę, której nie dopuszcza kanał zamówienia
  albo organizacja** — `400 VALIDATION_FAILED` z `error.details.code` równym
  `delivery_method_not_in_sales_channel`, `payment_method_not_in_sales_channel`,
  `delivery_method_not_allowed_for_organization` albo
  `payment_method_not_allowed_for_organization`, na `POST /api/v1/orders`,
  `POST /api/v1/orders/preview-total`, `POST /api/v1/admin/orders`,
  `POST /api/v1/admin/orders/preview` i `POST /api/v1/external/orders`. Na ostatniej z nich odmowa
  z powodu listy dozwolonych metod już istniała; jej `error.message` kończy się teraz *"… is not
  available to this Organization."*, `error.details` jest obecne, a gdy obie metody są spoza
  list, wskazywana jest metoda dostawy. Dopasowuj po `error.details.code`.
- **`GET /api/v1/delivery-methods` i `GET /api/v1/payment-methods` zwracają metody kanału
  rozpoznanego dla żądania.** Klient, który nie wysyła `X-Sales-Channel`, otrzymuje odpowiedź dla
  kanału domyślnego. Zakup jednym kliknięciem działa tak samo:
  `GET /api/v1/quick-order/one-click/eligibility` odpowiada
  `{ enabled: false, reason: "missing_defaults" }`, gdy domyślna metoda kupującego nie jest
  dostępna w kanale żądania.
- **`salesChannelIds` w `PUT /api/v1/admin/{delivery,payment}-methods/:code`**: pominięte —
  zostawia przypisanie bez zmian (a nową metodę przypisuje do kanału domyślnego), jak dotąd;
  **`[]` usuwa teraz wszystkie przypisania**, udostępniając metodę w każdym kanale, podczas gdy
  dotąd było ignorowane; identyfikator, który nie wskazuje żadnego kanału sprzedaży, to
  `400 VALIDATION_FAILED`, a nie `500`.
- **`PUT /api/v1/admin/delivery-methods/:code` odpowiada `409` na zmianę `adapter`** metody, do
  której odwołują się przesyłki. Wiersze `GET /api/v1/admin/delivery-methods` zawierają
  `availability: { ownerModule, available, ownerPresence }`, a
  `GET /api/v1/admin/delivery-methods/adapters` wymienia adaptery do wyboru. Utworzenie metody bez
  `adapter` nadal przyjmuje kod metody jako adapter: wysyłaj to pole i odczytuj
  `availability.available` z odpowiedzi.
- **Odpowiedzi z zamówieniami.** Odpowiedzi dla klienta i zewnętrzne zawierają
  `placedOnBehalf: boolean` i nie zawierają już `placedOnBehalfByAdminUserId`; odpowiedzi dla
  panelu zawierają oba pola. Zastąp `order.placedOnBehalfByAdminUserId !== null` przez
  `order.placedOnBehalf`. `customFieldValues` w tych odpowiedziach zawiera tylko pola, których
  odbiorcą jest `customer`.
- **Odpowiedzi dla klienta nie zawierają identyfikatorów administratorów.** Odpowiedzi z
  zapytaniami ofertowymi dla klienta nie zawierają już `createdByAdminUserId` i
  `assignedAdminUserId`, a ich `events[]` — `actorAdminUserId` (`actorRoleLabel` nadal mówi, kto
  działał); odpowiedzi z komentarzami do zamówienia dla klienta nie zawierają już
  `authorAdminUserId` — komentarz, którego `authorCustomerAccountId` ma wartość `null`, napisał
  pracownik. Odpowiedzi dla panelu pozostają bez zmian.
- **Z dwóch równoczesnych przejść jednego zapytania ofertowego wygrywa jedno.** Akceptacja albo
  odrzucenie przez kupującego, edycja przez klienta oraz zatwierdzenie, rewizja, anulowanie albo
  przypisanie przez sprzedawcę, które przegrywają z innym przejściem albo z zadaniem
  wygaszającym, otrzymują `409 VERSION_CONFLICT`.

Pola niestandardowe, webhooki i zdarzenia:

- **`POST /api/v1/admin/custom-fields/definitions` bez `audience` tworzy pole `internal`.** Wyślij
  `"audience": "customer"` dla pola, które mają odczytywać klienci i integracje. Ponowne
  utworzenie, jako `customer`, usuniętego klucza, który nadal ma zapisane wartości, to
  `409 CUSTOM_FIELD_DEFINITION_INVALID`: utwórz pole jako `internal`, a potem zmień odbiorców.
  `PATCH …/definitions/:id` przyjmuje `audience` i nie zeruje już `config`, gdy treść go nie
  wymienia.
- **`eventTypes` webhooka są walidowane.** `POST /api/v1/admin/webhooks` i
  `PATCH /api/v1/admin/webhooks/:id` odpowiadają `422 WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE`, z
  odrzuconymi nazwami w `error.details.eventTypes`, dla typu, który nie jest ani wbudowany, ani
  wniesiony przez włączony moduł. Sprawdzana jest tylko nazwa, którą zapis dodaje; zapisana
  subskrypcja zachowuje nazwy, które ma. Dostarczane w tym wydaniu: `order.created.v1` i
  `order.status_changed.v1`; `crm.opportunity.created.v1`, `crm.opportunity.status_changed.v1` i
  `crm.opportunity.closed.v1`, dopóki `crm` jest włączony; oraz sześć nowych, dopóki ich moduł
  jest włączony — `product.created.v1`, `product.updated.v1`, `product.archived.v1`,
  `rfq.created.v1`, `rfq.expired.v1` i `credit_limit.adjusted.v1`.
  `GET /api/v1/admin/webhooks/event-types` zwraca typy wniesione przez moduły. Zdarzenia
  produktów trafiają wyłącznie do subskrypcji ogólnoplatformowych.
- **Wniesiony typ zdarzenia jest dostarczany tylko wtedy, gdy jego moduł jest włączony**; zapisane
  subskrypcje zostają zachowane i w tym czasie niczego nie otrzymują.
- **`order.created.v1` jest ogłaszane po zatwierdzeniu transakcji zamówienia**, więc nieudane
  złożenie zamówienia niczego nie ogłasza. `rfq.expired.v1` zyskuje `organizationId` i występuje
  tylko tam, gdzie działa zadanie wygaszające. `product.archived.v1` jest teraz emitowane zawsze,
  gdy status produktu zmienia się na `inactive`.

Kody błędów i drobniejsze zmiany:

- **Dwie odmowy dotyczące pozycji koszyka mają własny kod zamiast `VALIDATION_FAILED`**:
  `400 CART_PRODUCT_QUOTE_ONLY` (`details.productId`), którym poza `POST /api/v1/cart/items` mogą
  odpowiedzieć także szybkie zamówienie, zakup jednym kliknięciem, dodanie listy zakupów do
  koszyka, tworzenie zamówienia w panelu i przyjmowanie zamówień z kluczem API; oraz
  `422 CART_QUANTITY_INVALID`, do którego nie prowadzi żadna trasa HTTP — otrzymuje go moduł
  wywołujący `CartWritePort.addItem` w procesie.
- **`details` zyskało pola**, przy niezmienionym kodzie i statusie: `409 LIMIT_INSUFFICIENT` —
  `availableAmount`, `orderTotal` (napisy z dwoma miejscami po przecinku) i `currency`;
  `409 STOCK_UNAVAILABLE` — `productId`, `sku`, `productName` i `requestedQuantity`;
  `413 ASSET_UPLOAD_TOO_LARGE` — `maxFileSizeMb`; `403 API_KEY_OUT_OF_SCOPE` — `requiredScope`.
  Klient, który porównywał `error.message`, zobaczy dłuższe zdania, teraz także po polsku.
- **`details` zmieniło kształt w `400 SETTING_VALUE_SHAPE_MISMATCH`.** To obiekt z
  `details.code` — `wrong_type` albo `not_an_option` — oraz `settingCode`; tablica
  `{ path, issue }`, którą odmowa z powodu typu zwracała jako samo `details`, to teraz
  `details.issues`, a odmowa z powodu opcji zawiera `allowedValues` i `enumOptions`.
- **Niepoprawny identyfikator to `404`, a nie `500`**, na każdej trasie
  `/api/v1/admin/customers/:id…` (`CUSTOMER_NOT_FOUND`) i na samoobsługowych trasach adresów
  (`CUSTOMER_ADDRESS_NOT_FOUND`).
- **`GET /api/v1/catalog/products` wycina stronę z produktów, które pasują.** Na domyślnej
  ścieżce listy strona zawiera `limit` pasujących produktów, o ile tyle istnieje, a `hasMore` ma
  wartość `true` tylko wtedy, gdy istnieje kolejny. `filter[category]` wskazujące kategorię,
  która nie istnieje, zwraca jedną pustą stronę z `hasMore: false`. Kształt odpowiedzi i format
  kursora pozostają bez zmian.
- **`POST /api/v1/organizations/register` odpowiada `emailVerificationSent: false`** w instancji
  bez serwera poczty, w której wiadomość została tylko zapisana w logu.
- **Nowe elementy**: `idleLogoutMinutes` w `GET /api/v1/admin/me`;
  `GET /api/v1/admin/platform-info` (`{ "version": string | null }`, dla każdego zalogowanego
  administratora); `noteCount`, `attachmentCount` i `unreadMessageCount` w szansie sprzedaży CRM
  oraz `POST /api/v1/admin/crm/opportunities/:id/messages/read`.

#### Dla autorów modułów i modułów nakładkowych {#after-0-105-0-authors}

**Zabezpieczenie zadeklarowane na trasie działa przed walidacją.** Łańcuch `preHandler`, który
trasa deklaruje we własnych opcjach, jest przy rejestracji trasy przenoszony do jej
`preValidation`; żadne miejsce wywołania się nie zmienia, a moduł zbudowany z wcześniejszą
platformą jest objęty bez ponownego budowania. Dwie rzeczy do sprawdzenia we własnym kodzie:

- Funkcja przekazana jako `preHandler` trasy widzi `request.body` sparsowane, ale
  **niezwalidowane** — dowolną wartość JSON — oraz `request.params` / `request.query` bez
  konwersji i wartości domyślnych ze schematu. Praca wymagająca zwalidowanego żądania należy do
  handlera, do interceptora API albo do `preHandler` dodanego przez `addHook` w zasięgu Twojej
  wtyczki.
- `addHook('preHandler')` w zasięgu wtyczki działa teraz **po** zabezpieczeniach trasy. To, co
  zabezpieczenie trasy odczytuje z żądania, musi się tam znaleźć w `onRequest` albo
  `preValidation`.

Zobacz [Kiedy działa zabezpieczenie](./architecture/permissions.md#kiedy-działa-zabezpieczenie).

**Kod, który implementuje opublikowany port albo buduje jeden z jego rekordów, nie skompiluje
się, dopóki nie ma nowego elementu** — własna implementacja w module nakładkowym albo dubler
testowy o typie portu:

| Gdzie | Nowy wymagany element |
| --- | --- |
| `AdminPermissionChecker` (`@endora-commerce/platform`) | `isActiveAdministrator(adminUserId)` |
| `SalesChannelMembershipPort` (`@endora-commerce/platform`) | `entityIdsInChannelSubquery`, `filterEntityIdsAvailableInChannel`, `clearChannelsForEntity` |
| `MfaLoginPort` | `invalidatePending(subject)` |
| `CustomFieldValuePort` | `projectForCustomer(entityType, bag)` |
| `DeliveryMethodReadPort`, `PaymentMethodReadPort` | `isAvailableInChannel(id, salesChannelId)` |
| `CustomFieldDefinitionRecord`, `CreateCustomFieldDefinitionRequest` | `audience` |
| `Order` (typ wywnioskowany) | `customFieldValues` (`{}`), `placedOnBehalf` |

Wiersze bez podanego pakietu dotyczą `@endora-commerce/contracts`. Moduł, który zwraca wartości pól
niestandardowych komuś innemu niż administrator, przepuszcza zapisany zbiór wartości przez
`CustomFieldValuePort.projectForCustomer` w swoim serializatorze.

**Usunięte.** `AdminAuthService.changePassword` w `@endora-commerce/mod-admin-users`, razem z
czwartym argumentem konstruktora tej klasy — jedyną implementacją jest
`AdminUserService.updateSelf`, a `AdminUserService.update` nie przyjmuje już `password`.
`ChallengeStore.recordFailedAttempt` w `@endora-commerce/mod-mfa`, zastąpione przez `takeAttempt`
i `returnAttempt`. Oraz `bindToDefaultChannel`:

**Jeśli Twój własny moduł tworzy metodę dostawy lub płatności w swoim `installHook`**, funkcja
`bindToDefaultChannel` zniknęła z interfejsu tworzenia metod: usuń jej wywołanie po
`ensureMethodForAdapter`. Nic jej nie zastępuje — utworzona metoda jest dostępna w każdym kanale.
Źródła modułu nie skompilują się, dopóki tego nie zrobisz. Wcześniej opublikowana wersja modułu
nie jest kompilowana ponownie, więc zawiedzie później — błędem `TypeError` w `installHook`, gdy po
raz pierwszy będzie tworzyć swoją metodę — i trzeba ją wydać ponownie dla tego wydania. Instancji,
która ma już wiersz tej metody, to nie dotyczy, bo hook wykonuje to wywołanie tylko dla wiersza,
który właśnie utworzył. Nie ma mechanizmu tworzenia metody ograniczonej do wybranych kanałów;
ogranicz ją w panelu administracyjnym.

**Wyniki wysyłki poczty zyskały `logged`.** `EmailMailerSendOutcome`, `TransactionalSendOutcome`,
`EmailDeliveryStatus` i `InvoiceEmailNotSentReason` mają nowy element, którym konsolowy mailer
odpowiada zamiast `sent`. Kod z wyczerpującym `switch` po jednym z nich przestaje się kompilować,
dopóki nie obsłuży `logged`; kod, który odczytuje `outcome.reason` po
`outcome.status !== 'sent'`, musi najpierw zawęzić typ do `'suppressed'`; kod, który porównuje z
`=== 'sent'`, kompiluje się dalej i traktuje teraz wiadomość zapisaną w logu jako niewysłaną.
`logged` nie jest błędem i nie ma czego ponawiać.

**Kompozycja danych demonstracyjnych i kod resetu działają wewnątrz transakcji resetu.**

- Obiekt zwracany przez `createDemoComposition` musi deklarować
  `withdrawsInsideTransaction: true`. Reset na kompozycji, która tego nie robi, jest odrzucany,
  zanim się zacznie.
- Kod `demo.reset` modułu i `withdraw` kompozycji muszą zapisywać przez `EntityManager`, który
  otrzymują (`em.nativeDelete`, `em.execute`), a nie przez `em.getConnection().execute(…)`: samo
  połączenie jest poza transakcją, a w czasie resetu drugie połączenie jest odrzucane komunikatem
  *a reset body wrote outside the reset transaction*.
- `@endora-commerce/platform/demo` eksportuje `DemoResetRefusedError`, którym kompozycja odmawia
  resetu z komunikatem, oraz `DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`.

**Zachowania, na które może trafić Twój kod.**

- `AdminPasswordVerificationPort.verifyPassword` może teraz odrzucić wywołanie odpowiedzią `429`
  albo `503` limitu logowania, zamiast zawsze zwracać wartość logiczną, i przyjmuje opcjonalny
  trzeci argument opisujący pochodzenie żądania. Moduł, który sam weryfikuje dane uwierzytelniające
  administratora, korzysta z tych samych liczników przez `adminAuthenticationThrottlePort`.
- `AuthSessionPort.destroyAllForAdmin` i `destroyAllForCustomer` przyjmują opcjonalne
  `{ exceptSessionId }`. Implementacja, która je ignoruje, nadal przechodzi sprawdzenie typów i
  kończy także sesję wywołującego.
- `validateUseOnStorefront` adaptera płatności lub dostawy otrzymuje identyfikator kanału
  zamówienia w `salesChannelId` przy zamówieniu ze storefrontu, podczas gdy dotąd otrzymywało
  `null`.
- Subskrybent `order.created.v1` albo `promotion.used.v1` na szynie zdarzeń w procesie działa po
  zatwierdzeniu transakcji zamówienia. `product.archived.v1` jest teraz emitowane na każdej
  ścieżce, która zmienia status produktu na `inactive`, a zapis czeka na subskrybentów.
- Moduł udostępnia własne zdarzenia webhookom, dopisując ich nazwy do `webhookEventRegistry` w
  hooku startowym i deklarując krawędź jako `contributes-to`.
- `CustomFieldValuesPanel` w `@endora-commerce/admin-kit` przekazuje do `save` i `onChange`
  `null`, a nie `undefined`, dla wyczyszczonej liczby, daty albo pola wyboru.
- Nadpisanie motywu, które styluje dolną krawędź `.b2b-sidebar__brand`, należy przenieść na
  `.b2b-sidebar__brand-row`, do którego należy teraz linia oddzielająca.
- `npm_package_version` nie jest już zadeklarowaną zmienną środowiskową platformy.

**Jeśli sam konstruujesz te klasy**, a nie przez `composeApp` albo zestaw testowy:
`CmsBlockService`, `CmsTemplateService` i `CmsHookService` przyjmują `CommandBus` jako drugi
argument konstruktora; `PasswordResetService` przyjmuje port sesji jako drugi argument, a port
audytu jako trzeci; `makeEnqueuer` w `@endora-commerce/mod-google-analytics` przyjmuje drugi,
wymagany argument; a cykliczne konsumenty z `mod-orders`, `mod-crm`, `mod-product-feeds` i
`mod-price-lists` przyjmują pytanie, czy przebieg ma coś do zrobienia — dziennik zmian każdego
pakietu wymienia te elementy.

#### W istniejącym storefroncie {#after-0-105-0-storefront}

**W istniejącym storefroncie**, który zachowuje źródła, z jakimi go utworzono, ani wywołania
dotyczące zamówień, ani oba katalogi metod nie informują backendu, w którym kanale jest kupujący:
są wykonywane bez kontekstu żądania, więc nagłówek `X-Sales-Channel` nie jest wysyłany i backend
rozpoznaje dla nich kanał domyślny. W instancji z jednym kanałem sprzedaży to poprawna odpowiedź i
niczego nie trzeba zmieniać. W instancji z więcej niż jednym wprowadź wszystkie poniższe zmiany
razem — przy tylko części z nich składanie zamówienia pokazywałoby metody jednego kanału, a
zamówienie trafiałoby do innego i byłoby odrzucane:

- W `lib/api/orders.ts` dodaj `import type { RequestContext } from './client';`, dodaj ostatni
  parametr `ctx: RequestContext` do funkcji `placeOrder`, `previewOrderTotal` i
  `cloneOrderToQuote` oraz dodaj `ctx,` do obiektu opcji, który każda z nich podaje do `apiMutate`.
- W `lib/api/quick-order.ts`, który już importuje `RequestContext`, zrób to samo dla
  `placeOneClickOrder` (`apiMutate`) i `getOneClickEligibility` (`apiGetAuthed`).
- W `lib/api/methods.ts`:
  - zmień pierwszy import na `import { apiGet, type RequestContext } from './client';`;
  - dodaj parametr do obu eksportowanych funkcji i przekaż go dalej —
    `listDeliveryMethods(ctx: RequestContext)` zwracające
    `withModuleAbsence(() => fetchDeliveryMethods(ctx), [])` oraz
    `listPaymentMethods(ctx: RequestContext)` zwracające
    `withModuleAbsence(() => fetchPaymentMethods(ctx), [])`;
  - dodaj ten sam parametr do obu prywatnych funkcji, `fetchDeliveryMethods(ctx: RequestContext)`
    i `fetchPaymentMethods(ctx: RequestContext)`, i w każdej przekaż `ctx` jako drugi argument jej
    wywołania `apiGet`.
- W plikach `test/checkout/delivery-catalogue-absence.test.tsx` i
  `test/checkout/payment-catalogue-absence.test.tsx`, które utworzony storefront zawiera i które
  obejmuje jego `tsconfig.json`, obie funkcje są wywoływane bez argumentu — po cztery razy w każdym
  pliku. Zmień każde `listDeliveryMethods()` na `listDeliveryMethods({})` i każde
  `listPaymentMethods()` na `listPaymentMethods({})`. Bez tego sprawdzenie typów storefrontu kończy
  się błędem `Expected 1 arguments, but got 0` w tych dwóch plikach. Pomiń ten krok, jeśli je
  usunąłeś.
- Przekaż kontekst w miejscach wywołań. `getServerContext` jest już importowany we wszystkich
  czterech plikach:
  - `app/(commerce)/checkout/page.tsx`: komponent strony zawiera
    `const { locale } = await getServerContext();` — zmień to na
    `const { locale, ctx } = await getServerContext();` i przekaż `ctx` do znajdujących się niżej
    wywołań `listDeliveryMethods` i `listPaymentMethods`. W `submitAction`, osobnej funkcji, dodaj
    `const { ctx } = await getServerContext();` przed wywołaniem `placeOrder` i przekaż `ctx` jako
    ostatni argument.
  - `app/(account)/preferences/page.tsx`: ta sama zmiana wiersza
    `const { locale } = await getServerContext();` i `ctx` przekazane do obu wywołań list.
  - `app/(catalog)/p/[slug]/page.tsx`: komponent strony **ma już** `ctx` w zasięgu, więc przekaż
    go do `getOneClickEligibility` i niczego nie deklaruj; w `oneClickAction`, osobnej funkcji,
    dodaj `const { ctx } = await getServerContext();` przed wywołaniem `placeOneClickOrder` i
    przekaż `ctx`.
  - `app/(account)/orders/[id]/page.tsx`, w `reorderToQuoteAction`: dodaj
    `const { ctx } = await getServerContext();` przed wywołaniem `cloneOrderToQuote` i przekaż
    `ctx`.

`getServerContext()` bierze kanał z nagłówka `x-sales-channel` żądania, które otrzymuje sam
storefront — tego samego, który Twoje reverse proxy albo middleware już ustawia dla każdego hosta,
aby strony renderowały się we właściwym kanale.

Trzy kolejne zmiany, których storefront utworzony we wcześniejszym wydaniu nie otrzymuje:

- **Usuwanie subskrypcji push.** W `lib/api/pwa.ts` funkcja `unsubscribeFromPush()` wysyła sam
  endpoint, na co backend reaguje teraz tylko dla zalogowanego klienta, do którego subskrypcja
  należy. Wysyłaj razem z nim klucze — przed `fetch` odczytaj
  `const json = subscription.toJSON();` i ustaw treść żądania na

  ```ts
  body: JSON.stringify({
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' },
  }),
  ```

  Bez tego wyłączenie powiadomień w przeglądarce bez zalogowanego klienta zostawia subskrypcję
  zarejestrowaną w backendzie, dopóki usługa push nie zgłosi, że już jej nie ma.
- **Bloki katalogu w HTML renderowanym na serwerze.** `ProductGrid`, `ProductSlider`,
  `ProductCard`, `CategoryList` i `CategoryGrid` na stronie CMS nadal pobierają dane w
  przeglądarce, jak dotąd, dopóki storefront nie rozwiąże ich danych na serwerze. Storefront
  zapisany przez CLI wydania `0.105.0` to robi: weź z niego `components/CatalogBlockData.tsx` i
  `lib/page-builder/catalog-block-data.ts`, weź jego `components/CmsPageRenderer.tsx` i
  `components/Hook.tsx` oraz przekaż `ctx` do `CmsPageRenderer` w `app/page.tsx` i
  `app/(content)/[...slug]/page.tsx` — ta właściwość jest tam wymagana. Utwórz storefront, z
  którego skopiujesz pliki, tak jak w sekcji
  [Bloki modułów w istniejącym storefroncie](#storefront-block-renderers).
- **Twoje własne typy.** `lib/api/rfq.ts` deklaruje `createdByAdminUserId`, `assignedAdminUserId`
  i `actorAdminUserId`, których odpowiedzi dla klienta już nie zawierają; referencyjny storefront
  nie odczytywał żadnego z nich. Jeśli Twój kod je odczytuje — albo
  `placedOnBehalfByAdminUserId` zamówienia — odczyta teraz `undefined`.

Storefront zapisany przez CLI wydania `0.105.0` ma też w stopce wzmiankę o platformie; istniejący
jej nie zyskuje.

Na ile zostało to sprawdzone: instancję utworzoną przez instalator wydania `0.104.0` z danymi
demonstracyjnymi — API, panel i storefront — zaktualizowano poleceniem `pnpm run upgrade 0.105.0`
z pnpm 9, z pakietami wydania udostępnionymi z lokalnego rejestru, i polecenie przeszło do końca.
Co w niej zaobserwowano:

- wykonały się dokładnie dwie migracje, odbiorców pól niestandardowych i znaczników przeczytania
  wiadomości CRM; endpoint stanu i znaczek w panelu administracyjnym podają `0.105.0`;
- pięć błędnych haseł administratora otrzymuje `401`, a szóste
  `429 ADMIN_AUTHENTICATION_THROTTLED` z `Retry-After: 60`, co ustępuje po upływie opóźnienia albo
  po poleceniu `unlock`; żądanie bez sesji i z niepoprawną treścią otrzymuje `401`;
- metody utworzone w panelu przed aktualizacją są dostępne tylko w kanale domyślnym, metody
  utworzone przez moduły — w każdym kanale, a metoda przypisana do innego kanału jest tam
  dostępna; metoda dostawy utworzona w panelu była oznaczona jako *Nieoferowana przy składaniu
  zamówienia*, a wybranie adaptera to naprawiło;
- zamówienie albo jego podgląd są odrzucane dla metody, której kanał nie oferuje, dla treści
  wskazującej inny kanał i dla metody spoza listy dozwolonych metod organizacji, a po każdej
  odmowie koszyk i liczba zamówień były bez zmian;
- ze storefrontem w postaci zapisanej przez `0.104.0` składanie zamówienia w kanale innym niż
  domyślny pokazuje metody kanału domyślnego, a zamówienie jest zapisywane w kanale domyślnym; z
  powyższymi zmianami — naniesionymi dokładnie tak, jak je opisano, na siedem plików źródłowych i
  dwa pliki testów, przy czym każdy cytowany fragment został znaleziony — pokazuje metody tego
  kanału, zamówienie jest zapisywane w tym kanale, a `tsc --noEmit`, testy storefrontu i
  `next build` kończą się powodzeniem;
- każda istniejąca definicja pola niestandardowego zachowuje `customer`, a jej wartość nadal jest
  w zamówieniu kupującego; definicja utworzona później ma `internal` i jej wartości tam nie ma;
- szansa sprzedaży CRM sprzed aktualizacji nie pokazuje nikomu licznika nieprzeczytanych, a
  wiadomość napisana później jest nieprzeczytana tylko dla drugiego administratora;
- subskrypcja webhooka sprzed aktualizacji się wczytuje, a nieznany typ zdarzenia to `422`.

Nie sprawdzono: instancji starszej niż `0.104.0`, instancji z modułami nakładkowymi ani modułu,
który nadal wywołuje `bindToDefaultChannel`; zmiennych proxy, limitu dla całego konta i
`ADMIN_AUTH_ACCOUNT_WIDE_LIMIT`, limitu kodów drugiego składnika ani sesji kończonych przez zmianę
danych uwierzytelniających; zadania wygaszającego zapytania ofertowe; zakupu jednym kliknięciem,
strony preferencji ani ponownego zamówienia jako zapytania ofertowego w działaniu; formularza
tworzenia zamówienia w panelu ani przyjmowania zamówień z kluczem API; `demo reset`; dostarczenia
webhooka; zmian w storefroncie dotyczących subskrypcji push i bloków katalogu, wiersza w
`compose.prod.yml` ani wierszy `.gitignore` dla `backend/var/`; ani odtworzenia kopii zapasowej.
To, co ta sekcja o nich mówi, pochodzi z dzienników zmian wydania, sprawdzonych ze źródłami tego
wydania.

### Po aktualizacji do wydania 0.106.0 {#after-0-106-0}

`pnpm run upgrade 0.106.0` przenosi 73 pakiety wydania z `0.105.0` i wykonuje jego jedyną migrację,
która dodaje kolumnę do tabeli `settings` i nie przepisuje żadnego wiersza; instancja uruchamia się
potem bez edycji żadnego ze swoich plików, a wydanie nie dodaje żadnej zmiennej środowiskowej ani
żadnego uprawnienia. To, co dodaje, znajduje się na karcie SEO w **Ustawieniach**: storefront
kanału sprzedaży można wyłączyć z wyszukiwarek, dopisać mu własne reguły do `robots.txt` i nadać
mu plik `llms.txt` — i żadna z tych trzech rzeczy nie dociera do storefrontu utworzonego we
wcześniejszym wydaniu, dopóki jego pliki nie zostaną zaktualizowane. Ta sekcja mówi, co zrobić i w
jakiej kolejności, a potem — co działa inaczej, osobno dla każdego czytelnika:
[operatorów](#after-0-106-0-operators), [klientów API i integratorów](#after-0-106-0-api),
[autorów modułów i modułów nakładkowych](#after-0-106-0-authors) oraz właściciela
[istniejącego storefrontu](#after-0-106-0-storefront).

#### Co zrobić i w jakiej kolejności {#after-0-106-0-steps}

Przed aktualizacją: nic poza tym, co opisuje [Zanim zaczniesz](#zanim-zaczniesz). Migracja
`Migration20261011T135250CoreSettingsMultiline` dodaje kolumnę `settings.multiline boolean not null
default false`, nie wymaga żadnego uzupełnienia danych i nie zmienia wartości ani znaczenia
żadnego ustawienia. Cofaj ją wyłącznie razem z pakietami: kod tego wydania oczekuje tej kolumny,
więc cofnięcie samej migracji zostawia instancję, która nie uruchomi się, podczas gdy cofnięcie
jej w ramach obniżenia wersji `@endora-commerce/platform` i `@endora-commerce/mod-settings` traci
tylko tę flagę.

Po aktualizacji, zanim instancja znów przyjmie ruch:

1. **Zdecyduj, czy storefront przejmie pliki z tego wydania.** Trzy nowe ustawienia na karcie SEO —
   *Domyślne robots*, *Własne instrukcje robots.txt* i *Dodatkowa treść llms.txt* — pojawiają się w
   każdej zaktualizowanej instancji, a storefront utworzony we wcześniejszym wydaniu nie reaguje na
   żadne z nich: kanał ustawiony na `NOINDEX` nadal jest indeksowany, `robots.txt` pozostaje
   plikiem, z którym storefront został zbudowany, i nic nie serwuje `llms.txt`. Wiersz *Domyślne
   robots* i oba podglądy informują o tym, dopóki tak jest. Zmiany opisuje część
   [W istniejącym storefroncie](#after-0-106-0-storefront); dopóki nie zostaną wprowadzone, nie
   polegaj na tych ustawieniach.
2. **W storefroncie, który obsługuje więcej niż jeden kanał sprzedaży za reverse proxy albo siecią
   CDN**, spraw, by proxy samo ustawiało nagłówek `X-Sales-Channel`, osobno dla każdego hosta, i nie
   przekazywało dalej wartości przysłanej przez odwiedzającego. Po zaktualizowaniu storefrontu
   `robots.txt` i `llms.txt` różnią się między kanałami, a kanał wskazuje właśnie ten nagłówek. W
   nginx to jeden wiersz w bloku `location` storefrontu —
   `proxy_set_header X-Sales-Channel "<kod kanału tego hosta>";` we wdrożeniu wielokanałowym albo
   `proxy_set_header X-Sales-Channel "";`, aby usunąć nagłówek we wdrożeniu jednokanałowym, którego
   poza tym zmiana nie dotyczy. Plik `nginx.example.conf`, z którym utworzono instancję, nie
   zawiera tego wiersza; `deploy/nginx.example.conf` w repozytorium platformy pokazuje oba warianty,
   zakomentowane. Współdzielona pamięć podręczna, która ignoruje `Vary` dla tego nagłówka, musi
   włączyć go do klucza albo nie buforować `/robots.txt`.
3. **Ustaw *Domyślne robots* dla każdego kanału sprzedaży, którego storefront ma pozostać poza
   wyszukiwarkami** — `NOINDEX, FOLLOW` albo `NOINDEX, NOFOLLOW`, w **Ustawienia → SEO** — i nie
   dopisuj do tego `Disallow: /` we własnych instrukcjach `robots.txt`: robot, któremu nie wolno
   pobrać strony, nigdy nie odczyta jej `noindex`. Przy zaktualizowanym storefroncie
   `curl -sI https://<twój sklep>/ | grep -i x-robots-tag` pokazuje nagłówek w ciągu minuty lub
   dwóch.
4. **Sprawdź, czy `robots.txt` storefrontu nadal serwuje to, co powinien.** Po wprowadzeniu zmian
   z części [W istniejącym storefroncie](#after-0-106-0-storefront) lista tras w wyniku budowania
   musi pokazywać `ƒ /robots.txt`, a nie `○ /robots.txt`, a
   `curl -sI https://<twój sklep>/robots.txt | grep -i x-endora-crawler-files` musi wypisać
   nagłówek. Jeśli lista tras nadal pokazuje `○`, plik `app/robots.ts` nie został usunięty i stary
   plik z czasu budowania nadal wygrywa — po cichu. Jeśli edytowano listę `disallow` w
   `app/robots.ts`, te same wiersze muszą teraz być w `ROBOTS_SYSTEM_RULES` w
   `lib/seo/robots-system-rules.ts`.

W dowolnym momencie:

5. Jeśli utrzymujesz ustawienie `cms.reserved_slug_segments`, dodaj do niego `robots.txt` i
   `llms.txt`, tak jak zmiany w storefroncie dodają je do `RESERVED_TOP_LEVEL_SEGMENTS` w
   `app/reserved-segments.ts`.
6. **Zbuduj własne moduły ponownie z tym wydaniem tylko wtedy**, gdy któryś z Twoich testów
   konstruuje `SettingWriteValidationInput` albo renderuje samodzielnie `SettingRowEditor` lub
   `SettingsPage` — część [Dla autorów modułów i modułów nakładkowych](#after-0-106-0-authors)
   mówi, czego każdy z nich potrzebuje. Moduł, który tylko dostarcza `SettingWriteValidator` albo
   tylko deklaruje ustawienia, nie wymaga zmian.

#### Dla operatorów {#after-0-106-0-operators}

**Storefront kanału sprzedaży można wyłączyć z wyszukiwarek jednym ustawieniem: Ustawienia → SEO →
Domyślne robots.** Do wyboru są `INDEX, FOLLOW` (wartość domyślna), `NOINDEX, FOLLOW`,
`INDEX, NOFOLLOW` i `NOINDEX, NOFOLLOW`, dla wszystkich kanałów sprzedaży albo osobno dla kanału.
Dla kanału, którego wartość coś ogranicza, zaktualizowany storefront dodaje dyrektywę do tego, co
serwuje w tym kanale: nagłówek `X-Robots-Tag` na stronach (także na stronach „nie znaleziono” i na
stronie offline), na `/sitemap.xml`, na `/_next/image` i na plikach z katalogu `public/`, oraz
jeden dodatkowy element `<meta name="robots">` w `<head>` stron renderowanych dla żądania. Strony
„nie znaleziono” i statycznie zbudowana strona `/offline` niosą nagłówek bez dodatkowego elementu —
obie same deklarują `noindex, nofollow` — a przekierowania zadeklarowane w `next.config.js` i pliki
w `/_next/static` nie niosą ani jednego, ani drugiego. Ustawienie tylko dodaje ograniczenia: strona,
która sama deklaruje `noindex`, zachowuje własny tag, a `robots.txt` się nie zmienia. Przy
wartości domyślnej nic nie jest dodawane. Zapisana zmiana obowiązuje w storefroncie w ciągu minuty
lub dwóch. Dwa ograniczenia: pliki serwowane przez backend (zdjęcia produktów i inne przesłane
media) nie niosą `X-Robots-Tag`, a storefront uruchomiony, gdy jego backend jest nieosiągalny,
serwuje strony bez domyślnej dyrektywy aż do pierwszego udanego odczytu. Ustawienie jest też
osiągalne z palety poleceń jako *Roboty wyszukiwarek* dla posiadacza `settings:read`. Zobacz
[Roboty wyszukiwarek](./modules/seo.md#roboty-wyszukiwarek).

**Do `robots.txt` kanału sprzedaży można dopisać reguły: Ustawienia → SEO → Własne instrukcje
robots.txt.** Tekst jest dopisywany po regułach, które storefront generuje sam — za nimi,
oddzielony jednym pustym wierszem — dla wszystkich kanałów sprzedaży albo osobno dla kanału.
Generowane reguły (zamknięte rodziny adresów i wiersz `Sitemap:`) się nie zmieniają i nie można ich
edytować ani usunąć z ekranu Ustawień. Bez tekstu `robots.txt` jest bajt w bajt tym, czym był;
zresetowanie ustawienia usuwa tekst; zapisana zmiana jest serwowana w ciągu około dwóch minut.

- Tekst jest serwowany tak, jak go napisano: każdy znak jest zachowany, w tej samej kolejności, i
  nic w nim nie jest walidowane. Dwie rzeczy dotyczące końców wierszy są ujednolicane — każdy
  koniec wiersza jest serwowany jako znak nowej linii (`LF`), niezależnie od tego, czy zapisano go
  jako `LF`, `CRLF` czy `CR`, a plik kończy się dokładnie jednym — a jeden znacznik kolejności
  bajtów (`U+FEFF`) na samym początku tekstu nie jest serwowany, bo robot nie rozpoznaje wiersza, do
  którego jest doklejony.
- Generowanych wierszy nie da się zmienić, ale ich skutek dla jednego robota — tak: grupa
  napisana dla robota wskazanego z nazwy zastępuje dla niego grupę `*`. Powtórz w takiej grupie
  generowane reguły, jeśli mają go nadal dotyczyć. Indeksowanie od tego nie zależy — strony, które
  te reguły zamykają, same deklarują `noindex`.
- Tekst może mieć najwyżej **64 KiB** (65 536 bajtów UTF-8). Większy jest odrzucany przy zapisie
  odpowiedzią `400 SEO_CRAWLER_TEXT_TOO_LARGE` z komunikatem podającym limit, a zapisany wcześniej
  tekst zostaje zachowany.
- **`robots.txt` nie usuwa stron z wyników wyszukiwania.** Decyduje o tym, co robot może pobrać.
  Aby storefront pozostał poza wyszukiwarkami, użyj *Domyślne robots* = `NOINDEX` i nie dopisuj do
  tego `Disallow: /`. Opis ustawienia mówi o tym, po angielsku i po polsku.

Zobacz [Własne instrukcje `robots.txt`](./modules/seo.md#własne-instrukcje-robotstxt).

**Pod polem znajduje się podgląd pliku, który serwuje storefront wybranego kanału**, jako jeden
blok będący tym plikiem: wiersze generowane przez storefront, oznaczone jako tylko do odczytu,
potem pusty wiersz, potem Twoje wiersze, oznaczone paskiem i etykietą. Gdy nic nie jest
niezapisane, nagłówek brzmi *robots.txt serwowany obecnie*; w miarę pisania blok podąża za polem,
a nagłówek zmienia się na *robots.txt po zapisaniu* — plik, który storefront będzie serwował po
zapisaniu; do tego czasu serwuje poprzednią wersję. W widoku **Wszystkie kanały** wybierasz kanał
do podglądu, a podgląd wymienia kanały, które mają własną wartość i których zmiana w związku z tym
nie dotyczy. W kanale, którego *Domyślne robots* to `NOINDEX`, mówi, że `robots.txt` celowo
pozostaje otwarty, i ostrzega, gdy Twój tekst zabrania wszystkim robotom pobierania czegokolwiek.
Administrator, który może odczytywać ustawienia, ale nie może ich zmieniać, też go widzi, a temu,
kto nie może wyświetlać listy kanałów sprzedaży, pokazywany jest systemowy kanał domyślny.
Podgląd niczego nie zmienia w tym, co serwuje storefront.

Generowane reguły nie są kopiowane do backendu ani do panelu administracyjnego: za każdym razem
backend pyta o nie storefront kanału. Dlatego **storefront musi być osiągalny z backendu pod
adresem skonfigurowanym dla kanału** — ustawienie **Storefront URL** kanału, a w jego braku
`STOREFRONT_BASE_URL`. Gdy nie jest, podgląd o tym informuje i pokazuje sam Twój tekst; zapis
nigdy nie jest blokowany. Trzy komunikaty i co z każdym zrobić:

- *Nie udało się połączyć ze sklepem* — brak odpowiedzi w ciągu trzech sekund, odrzucone
  połączenie, błąd, przekierowanie albo odpowiedź, która nie jest plikiem tekstowym. Sprawdź, czy
  storefront działa i czy skonfigurowany adres to ten, pod którym sam odpowiada. Wiersz dziennika
  serwera `seo: the crawler-file preview could not show the storefront’s part` podaje przyczynę.
- *Ten kanał sprzedaży nie ma skonfigurowanego adresu sklepu* — ustaw **Storefront URL** dla
  kanału albo `STOREFRONT_BASE_URL`.
- *Ten sklep nie potwierdził, że obsługuje własne instrukcje* — odpowiedział bez nagłówka
  `X-Endora-Crawler-Files`. Zwykle storefront został utworzony w wydaniu sprzed tych ustawień:
  serwuje tylko swoje generowane reguły i ignoruje zarówno własne instrukcje, jak i *Domyślne
  robots*. Tak samo wygląda proxy, które usuwa ten nagłówek, albo storefront zaktualizowany tylko
  częściowo. Odpowiednia informacja pojawia się w wierszu *Domyślne robots*, żeby nie uznać sklepu
  za wyłączony z wyszukiwarek, gdy jego storefront może ignorować to ustawienie. Wprowadź zmiany z
  części [W istniejącym storefroncie](#after-0-106-0-storefront) i sprawdź, czy nagłówek dociera.

Backend wysyła jedno żądanie na podgląd: `GET <origin>/robots.txt?part=system`, wyłącznie do
originu skonfigurowanego adresu, z kodem kanału w nagłówku `X-Sales-Channel`. Nie podąża za
przekierowaniem, czeka najwyżej trzy sekundy, czyta najwyżej 512 KiB, przyjmuje wyłącznie
`text/plain`, nie wysyła ciasteczek ani danych uwierzytelniających i niczego nie zapisuje. Ścieżka
ani zapytanie w skonfigurowanym adresie nie są używane. Adresy prywatne i pętli zwrotnej **nie**
są odrzucane, bo własny storefront instancji jest rutynowo osiągany pod takim adresem; o tym, kto
może wskazać adres kanału, decyduje jak dotąd posiadanie `settings:write`.

**Storefront serwuje `llms.txt` osobno dla każdego kanału sprzedaży, a Ty możesz go uzupełnić:
Ustawienia → SEO → Dodatkowa treść llms.txt.** `/llms.txt` to plik tekstowy, który mówi
asystentom AI, czym jest sklep i gdzie są jego publiczne strony. Zaktualizowany storefront serwuje
po jednym dla każdego kanału sprzedaży: część generowaną — nazwę sklepu, odnośniki do strony
głównej, katalogu, wyszukiwania, bloga i strony kontaktowej oraz do mapy witryny — a po niej tekst
zapisany w tym ustawieniu. Ustawienie jest domyślnie puste, przyjmuje wartość dla wszystkich
kanałów sprzedaży i wartość osobno dla kanału jak każde inne i mieści najwyżej 64 KiB — limit
instrukcji `robots.txt`. Zapisana zmiana jest serwowana w ciągu około dwóch minut. Adresy w
generowanej części używają jedynego publicznego originu storefrontu (`NEXT_PUBLIC_SITE_URL`,
ustalonego przy budowaniu storefrontu), tak jak mapa witryny: storefront obsługujący kilka kanałów
sprzedaży podaje ten origin w pliku każdego kanału, z nazwą sklepu właściwą dla tego kanału. Dwie
rzeczy, które warto wiedzieć, zanim na nim polegasz:

- **Kanał sprzedaży, którego *Domyślne robots* to `NOINDEX`, nie ma `llms.txt`.** Storefront
  odpowiada tam na `/llms.txt` „nie znaleziono”, niezależnie od zawartości ustawienia: sklep, który
  prosi wyszukiwarki, by trzymały się z daleka, nie zaprasza asystentów AI. Tekst jest zachowany i
  serwowany ponownie, gdy kanał zezwoli na indeksowanie. `robots.txt` to nie dotyczy — w takim
  kanale pozostaje otwarty, jak dotąd.
- **Wyłączenie modułu `seo` wycofuje ten plik**, razem z polityką *Domyślne robots* i własnymi
  instrukcjami `robots.txt` (poniżej).

Pod polem znajduje się podgląd, taki sam jak przy *Własnych instrukcjach robots.txt*: jeden blok
będący plikiem, z Twoimi wierszami oznaczonymi w środku, pod nagłówkiem *llms.txt serwowany
obecnie* albo *llms.txt po zapisaniu*. W kanale `NOINDEX` zamiast bloku mówi *llms.txt nie jest
serwowany*, z podaniem przyczyny. Komunikaty dla storefrontu, z którym nie udało się połączyć,
który nie ma skonfigurowanego adresu albo nie potwierdził, że serwuje plik, są tymi, które pokazuje
podgląd `robots.txt`, a żądanie, które backend wysyła w tym celu, jest ograniczone tak samo — jedno
`GET <origin>/llms.txt?part=base`, bez podążania za przekierowaniem, trzy sekundy, 512 KiB,
wyłącznie `text/plain`, nic z żądania administratora w środku. Jak dotąd adresy prywatne i pętli
zwrotnej nie są odrzucane, a ten podgląd mówi posiadaczowi `settings:read` nieco więcej o
skonfigurowanym adresie niż podgląd `robots.txt`: `404` bez nagłówka storefrontu jest zgłaszane
jako „nie potwierdził, że serwuje plik llms.txt”, a nie jako „nie udało się połączyć”, więc adres,
pod którym odpowiada jakiś serwer HTTP, da się odróżnić od takiego, pod którym nie odpowiada nic.
Zobacz [Dodatkowa treść `llms.txt`](./modules/seo.md#dodatkowa-treść-llmstxt).

**Wyłączenie modułu `seo` wycofuje wszystkie trzy.** Storefront nie wysyła domyślnej dyrektywy
robots, więc kanał ustawiony na `NOINDEX` znów jest indeksowany, dopóki moduł nie zostanie
ponownie włączony; `robots.txt` jest serwowany z samymi generowanymi regułami; a `llms.txt` nie
jest serwowany. Zapisane wartości są zachowane i obowiązują ponownie po włączeniu modułu. Opis
modułu i jego ustawienie aktywacji na ekranie `/platform/modules` mówią o tym. Zobacz
[Gdy moduł jest wyłączony](./modules/seo.md#gdy-moduł-jest-wyłączony).

**`robots.txt` nie zależy już od tego, czy *Domyślne robots* da się odczytać.** Wartość *Domyślne
robots* spoza czterech dostępnych — co wymaga wiersza zapisanego z pominięciem API ustawień —
sprawiała, że `GET /api/v1/storefront/seo/crawler-files` odpowiadało `500`, więc świeżo
uruchomiony storefront odpowiadał na `robots.txt` tego kanału kodem `503`, choć ten plik nigdy od
tego ustawienia nie zależał. Endpoint odpowiada teraz i wskazuje, czego nie udało się odczytać.
Taki kanał zachowuje swój `robots.txt`; jego `llms.txt`, który od tego ustawienia zależy, odpowiada
`503`, dopóki wartość nie zostanie naprawiona przez ponowne zapisanie *Domyślne robots*. Korzysta
na tym także niezaktualizowany storefront: jego `robots.txt` również jest serwowany.

**Ślad audytowy zmiany wartości ustawienia zapisuje wartość sprzed zmiany.** Dotąd
`setting.global_value_set` i `setting.value_set` niosły tylko `stateAfter`, a oba resety
(`setting.global_value_reset`, `setting.value_reset`) odnotowywały, że wartość została usunięta,
nie odnotowując której. Każde z tych czterech zdarzeń niesie teraz także `stateBefore`:

```json
{ "settingCode": "your_module.base_url", "value": "https://old.example", "valueType": "string", "stored": true }
```

a w dwóch akcjach dotyczących kanału dodatkowo `salesChannelId`. Przeglądarka dziennika audytu już
renderuje `stateBefore` obok `stateAfter`, więc poprzednia wartość pojawia się tam bez żadnej
dalszej zmiany. `value` to wartość **zapisana** na poziomie, na którym następuje zapis — wartość
dla wszystkich kanałów przy zapisie lub resecie dla wszystkich kanałów, własna wartość danego
kanału przy zapisie lub resecie dla kanału — a nie wartość, do której kanał się rozstrzygnął:
pierwszy zapis odnotowuje `"value": null, "stored": false`, nie wartość domyślną z manifestu ani
odziedziczoną wartość dla wszystkich kanałów. `stored` odróżnia „nic nie było zapisane” od
zapisanego `null`, który ustawienie typu `json` może zgodnie z prawem przechowywać. Poprzednia
wartość ustawienia typu `secret` jest odnotowywana jako `"[redacted]"`, dokładnie tak, jak już
była odnotowywana jego nowa wartość — ani tekst jawny, ani zapisany szyfrogram nie trafia do śladu
audytowego — a `credential_ref` odnotowuje po obu stronach kod konfiguracji, jak dotąd. Sam zapis
się nie zmienia, odrzucony zapis nadal niczego nie odnotowuje, a wpisy zapisane przed tym wydaniem
zachowują pusty stan sprzed zmiany.

**Ekran Ustawień może pokazywać nazwę i opis ustawienia w języku administratora.** Dotąd pokazywał
`name` i `description` zadeklarowane w manifeście ustawień, po angielsku, niezależnie od języka, w
którym pracuje administrator. Teraz najpierw szuka ich we własnym pakiecie tłumaczeń modułu
będącego właścicielem ustawienia, a gdy brakuje klucza, wraca do zadeklarowanego tekstu; filtr na
ekranie dopasowuje przetłumaczoną nazwę i opis tak samo jak zadeklarowane, a opcje ustawienia z
`enumOptions` są wartościami zapisywanymi i pozostają nieprzetłumaczone. **Dla operatora nic się
nie zmienia, dopóki moduł nie dostarczy tych kluczy.** Wydanie dodaje tylko sam mechanizm
wyszukiwania i żadne istniejące wcześniej ustawienie nie jest przez niego tłumaczone; jedynym
modułem, który w tym wydaniu dostarcza klucze, jest `seo` — dla swojej grupy i czterech ustawień
(*SEO włączone*, *Domyślne robots*, *Własne instrukcje robots.txt*, *Dodatkowa treść llms.txt*), po
angielsku i po polsku. Własny moduł dodaje je tak, jak opisuje część
[Dla autorów modułów i modułów nakładkowych](#after-0-106-0-authors).

**Ustawienie może być wielowierszowe.** Ustawienie typu `string`, które jego moduł tak zadeklaruje,
jest edytowane na ekranie Ustawień w polu wielowierszowym, które dokładnie zachowuje końce
wierszy, puste wiersze, wcięcia i końcowy znak nowej linii; pole jest nazwane po ustawieniu na
potrzeby technologii wspomagających, a wiersz pod nim, który podgląda wartość domyślną i bieżącą,
pokazuje jeden skrócony wiersz zamiast całego tekstu. W tym wydaniu takimi ustawieniami są oba
teksty SEO. Każde istniejące wcześniej ustawienie pozostaje jednowierszowe, więc ekran Ustawień
wygląda i zachowuje się dokładnie tak jak dotąd, dopóki zainstalowany moduł nie zadeklaruje tej
flagi.

#### Dla klientów API i integratorów {#after-0-106-0-api}

- **Dwa publiczne endpointy storefrontu rozstrzygane dla kanału.**
  `GET /api/v1/storefront/seo/robots-policy` odpowiada `{ "data": { "index", "follow" } }` z
  `Cache-Control: no-store`; `503 MODULE_DISABLED`, gdy moduł `seo` jest wyłączony; i `500` — nigdy
  odpowiedzią zezwalającą — gdy zapisana wartość nie jest jedną z czterech dostępnych.
  `GET /api/v1/storefront/seo/crawler-files` odpowiada
  `{ "data": { "index", "follow", "robotsTxtCustom", "llmsTxtAdditional", "shop": { "name" } } }` z
  `Cache-Control: no-store`, `503 MODULE_DISABLED`, gdy moduł jest wyłączony, i `500` — nigdy pustym
  tekstem — gdy zapisanych instrukcji `robots.txt` nie da się zaserwować. Jego `data` ma opcjonalny
  element **`unreadable`**: nazwy elementów, których backend nie zdołał odczytać z tego, co
  zapisano — `'policy'` (`index` i `follow` są wtedy oba `false` i znaczą „nieznane”) oraz
  `'llmsTxtAdditional'` (ten element jest wtedy `''` i znaczy „nieznane”). Brakuje go, gdy
  wszystko udało się odczytać, a konsument, który odczytuje z tego endpointu `index`, `follow` lub
  `llmsTxtAdditional`, powinien traktować wymieniony element jako nieznany, a nie jako jego
  wartość. Oba schematy odrzucają elementy, których nie znają, więc późniejsze wydanie może dodać
  nowy bez odrzucenia odpowiedzi przez starszego konsumenta. Kanał sprzedaży to rozstrzygnięty
  kanał żądania, jak na każdej trasie storefrontu.
- **Endpoint podglądu dla administratorów.**
  `GET /api/v1/admin/seo/crawler-files/preview?file=robots|llms&salesChannelCode=<code>`, chroniony
  uprawnieniem `settings:read`. `salesChannelCode` jest opcjonalny i oznacza systemowy kanał
  domyślny; odpowiedź wskazuje kanał, którego dotyczy, i jeden z pięciu stanów: `ok`,
  `storefront-outdated` (storefront odpowiedział bez nagłówka `X-Endora-Crawler-Files`; brak
  `base`), `not-served` (`404` **z** nagłówkiem — brak pliku dla tego kanału, czym jest `llms.txt` w
  kanale `NOINDEX`), `storefront-unreachable` i `address-unknown`.
- **Zapis zbyt długiego tekstu dla robotów odpowiada `400 SEO_CRAWLER_TEXT_TOO_LARGE`** z
  komunikatem podającym limit 65 536 bajtów UTF-8; zapisany wcześniej tekst zostaje zachowany.
- **`SettingDto` zyskuje `multiline: boolean`**, które `GET /api/v1/admin/settings` i
  `GET /api/v1/admin/settings/:code` teraz zawsze wysyłają. Odczytaj je, jeśli renderujesz własny
  edytor ustawienia.
- **Cztery akcje audytu zyskują `stateBefore`** — `setting.global_value_set`, `setting.value_set`,
  `setting.global_value_reset` i `setting.value_reset` — w kształcie podanym w części
  [Dla operatorów](#after-0-106-0-operators). `stateAfter` zachowuje swój kształt.
- **Szczegóły automatyzacji newslettera** — `GET /api/v1/admin/newsletter/automations/:id` oraz
  odpowiedź każdego zapisu, który zwraca szczegóły — niosą `salesChannelId: null` dla
  automatyzacji bez przypisanego kanału sprzedaży, także po ponownym wczytaniu rekordu z bazy
  danych; wcześniej tego elementu w nich brakowało. Lista, która nigdy tego elementu nie niosła,
  się nie zmienia.
- **Nowe w `@endora-commerce/contracts`**, wszystko eksportowane z korzenia pakietu i z podścieżki
  `seo`: `storefrontRobotsPolicySchema`, `storefrontRobotsPolicyResponseSchema` oraz typy
  `StorefrontRobotsPolicy` i `StorefrontRobotsPolicyResponse`; `storefrontCrawlerFilesSchema`,
  `storefrontCrawlerFilesResponseSchema`, typy `StorefrontCrawlerFiles` i
  `StorefrontCrawlerFilesResponse`, `CRAWLER_FILES_UNREADABLE_POLICY` i
  `CRAWLER_FILES_UNREADABLE_LLMS_TXT`; `composeCrawlerFile(base, extra)` — opisane wyżej złączenie
  części generowanej z tekstem operatora, którym storefront serwuje plik, a podgląd go renderuje;
  `CRAWLER_TEXT_MAX_BYTES` i `ERROR_CODES.SEO_CRAWLER_TEXT_TOO_LARGE`;
  `adminCrawlerFilePreviewQuerySchema`, `adminCrawlerFilePreviewResponseSchema`,
  `adminCrawlerFilePreviewSchema`, `adminCrawlerFilePreviewStateSchema`, `adminCrawlerFileSchema`
  i ich wywnioskowane typy; oraz `CRAWLER_FILES_CAPABILITY_HEADER` (`X-Endora-Crawler-Files`) —
  nagłówek odpowiedzi, którym storefront informuje, że serwuje pliki dla robotów w bieżący sposób.
- **`SettingWriteValidationInput` zyskuje `proposedValue`** — wartość, którą proponuje zapis
  ustawienia, obok rzutowania na kanały, które już niósł. Zapis dla wszystkich kanałów nie dociera
  do żadnego kanału mającego własną wartość, więc w instancji, w której każdy kanał ją ma,
  proponowana wartość nie była w rzutowaniu żadnego kanału i walidator, którego reguła dotyczy
  samej wartości, nie mógł jej zobaczyć. Kod, który *konstruuje* to wejście, musi teraz podać ten
  element; zobacz [Dla autorów modułów i modułów nakładkowych](#after-0-106-0-authors).

#### Dla autorów modułów i modułów nakładkowych {#after-0-106-0-authors}

**Ustawienie typu `string` można zadeklarować jako wielowierszowe.** Dodaj `multiline: true` do
jego wpisu w manifeście ustawień modułu:

```ts
defineModuleSettingsManifest({
  moduleCode: 'your_module',
  settings: [
    {
      code: 'your_module.footer_note',
      name: 'Footer note',
      valueType: 'string',
      defaultValue: '',
      multiline: true,
    },
  ],
});
```

Nic więcej się nie zmienia: wartość nadal jest typu `string`, jest odczytywana przez
`SettingsService.get` jak dotąd i rozstrzyga się dla kanału sprzedaży jak każde inne ustawienie.
To, co wpisano, jest tym, co zapisano. `SettingManifestEntrySchema` przyjmuje `multiline` tylko
przy `valueType: 'string'` i nie razem z `enumOptions`; każda inna kombinacja zawodzi przy
parsowaniu manifestu, z błędem wskazanym na `multiline`. Flaga dotyczy prezentacji, `ManifestReconciler`
utrzymuje ją w zgodzie z manifestem przy każdym starcie w obu kierunkach, więc jej późniejsze
dodanie lub usunięcie nie jest zmianą łamiącą zgodność i nigdy nie dotyka zapisanej wartości.

**Moduł może dołożyć coś pod ustawieniem, które zadeklarował: strefa `settings.setting.after`.**
`AdminZoneNameSchema` ma nowy element, montowany przez ekran Ustawień raz na wiersz ustawienia,
pod polem. Dołóż do niej, aby pokazać, co z ustawienia wynika — podgląd, konsekwencję, ostrzeżenie:

```ts
import { zoneComponent, type AdminContributions } from '@endora-commerce/admin-kit/contributions';

export const contributions: AdminContributions = {
  zones: [
    zoneComponent('settings.setting.after', () => import('./zones/FooterNotePreview.js'), {
      match: { settingCode: 'your_module.footer_note' },
      requiredPermission: 'settings:read',
    }),
  ],
};
```

Komponent otrzymuje `SettingsSettingAfterZoneProps`: `settingCode`, `ownerModule`, `channelCode`
(edytowany kanał sprzedaży albo `null` dla wartości dla wszystkich kanałów), `draftText` (tekst w
polu **w tej chwili**, zapisany lub nie, dla ustawienia typu `string`; `null` dla każdego innego
typu wartości) oraz `dirty`. Zawęź przez `match` po `settingCode` albo `ownerModule` — fragment
niedopasowanego wkładu nigdy nie jest pobierany. Właściwości płyną w jedną stronę: wkład nie może
zmienić wartości ani wstrzymać zapisu wiersza i powinien powiedzieć słowami, gdy to, co pokazuje,
nie jest jeszcze zapisane. Strefa nie jest montowana dla ustawienia typu `secret`, więc wkład nigdy
nie otrzymuje roboczej wartości sekretu. Wkład znika razem ze swoim modułem, a zawodzący wkład nie
pociąga za sobą wiersza. Oba podglądy SEO są wkładami do tej strefy.

**Jeśli sam renderujesz `SettingRowEditor`.** Edytor wiersza w `@endora-commerce/mod-settings`
montuje teraz strefę, więc musi być renderowany pod `AdminContributionsProvider` i dostawcami
sesji, jak każdy ekran hosta montujący strefę. Panel administracyjny już to robi; test, który
renderuje wiersz albo `SettingsPage` samodzielnie, potrzebuje wokół nich tych dostawców.

**Moduł może tłumaczyć nazwy i opisy własnych ustawień.** Ekran Ustawień szuka ich w pakiecie
tłumaczeń modułu będącego właścicielem pod trzema rodzinami kluczy i wraca do zadeklarowanego
tekstu, gdy klucza brakuje:

| Klucz | Zastępuje |
| --- | --- |
| `settingLabels.<kod ustawienia>.name` | `name` ustawienia |
| `settingLabels.<kod ustawienia>.description` | `description` ustawienia |
| `settingGroups.<kod grupy>.name` | `name` grupy |

Kod jest zapisywany w całości, z kropkami, a klucze są płaskie jak każdy inny klucz w pakiecie
tłumaczeń. Dla modułu `your_module`, który deklaruje ustawienie `your_module.base_url` w grupie
`your_section`, dodaj do `i18n/pl.json` (a angielskie brzmienie do `i18n/en.json`):

```json
{
  "settingGroups.your_section.name": "Twoja sekcja",
  "settingLabels.your_module.base_url.name": "Bazowy adres URL",
  "settingLabels.your_module.base_url.description": "Adres, pod którym usługa jest dostępna."
}
```

Rozstrzyganie odbywa się dla każdego klucza z osobna — język administratora, potem angielski,
potem tekst z manifestu — więc ustawienia można tłumaczyć pojedynczo. Odczytywany jest wyłącznie
pakiet tłumaczeń modułu, którego manifest ustawień zadeklarował dany wiersz (jego `moduleCode`,
który musi być równy `id` modułu); klucz dla ustawienia innego modułu jest ignorowany. Tekst jest
pokazywany tak, jak go napisano, bez podstawiania parametrów. `name` i `description` w manifeście
pozostają wymagane: to je zwraca API i to one są ostatnim wariantem zapasowym.

**Kod, który konstruuje `SettingWriteValidationInput`, musi podać `proposedValue`** — zwykle
test wywołujący walidator bezpośrednio. Moduł, który dostarcza `SettingWriteValidator`, nie
wymaga zmian, a taki, którego reguła dotyczy samej wartości, może ją teraz tam odczytać.

**`check:channel-resolution` nie zgłasza już nagłówka, który jest wysyłany.** Pierwszy sygnał tej
reguły oznacza każdy literał tekstowy `x-sales-channel`, bo moduł nie może odczytywać tego nagłówka
z żądania — robi to resolver. Zgłaszany był również moduł, który sam wysyła żądanie do innego
serwera i wskazuje w nim kanał sprzedaży. Klucz literału obiektu pod właściwością `headers:` —
`fetch(url, { headers: { 'X-Sales-Channel': channel.code } })` — jest teraz wyłączony z reguły, tak
jak już wcześniej tablica `allowedHeaders` polityki CORS. Co nadal jest zgłaszane: dostęp
indeksowy do obiektu nagłówków, argument `.get(...)`, nazwa trzymana w stałej, klucz obliczany,
deklaracja destrukturyzująca oraz *przypisanie* destrukturyzujące
(`({ headers: { 'x-sales-channel': code } } = request)`, także jako zmienna pętli `for…of` lub
`for…in`), które ma wyłączony kształt, a jest odrzucane ze względu na swoje położenie.

**`@endora-commerce/mod-seo` deklaruje `lucide-react` jako opcjonalną zależność peer**, tak jak
pozostałe pakiety modułów z powierzchnią w panelu administracyjnym; aplikacja, która ma panel
administracyjny, już ją ma.

#### W istniejącym storefroncie {#after-0-106-0-storefront}

**Istniejący storefront nie zmienia się przez aktualizację i dopóki nie zostanie zaktualizowany,
ignoruje wszystkie trzy ustawienia.** `endora new storefront` kopiuje wzorzec raz, a potem projekt
należy do Ciebie. Przy zaktualizowanym backendzie i starszym storefroncie ekran Ustawień pokazuje
trzy ustawienia i nic na nie nie reaguje: kanał ustawiony na `NOINDEX` nadal jest indeksowany,
`robots.txt` pozostaje plikiem, z którym storefront został zbudowany, i nic nie serwuje
`llms.txt`. Aby przejąć te funkcje, przenieś poniższe zmiany ze wzorcowego storefrontu do projektu
storefrontu, zachowując własne edycje. Storefront do kopiowania utwórz tak, jak opisuje
[Bloki modułów w istniejącym storefroncie](#storefront-block-renderers). Trzy grupy budują jedna na
drugiej i **trzeba je wprowadzać w tej kolejności**; każdą można przejąć bez następnych.

**1. *Domyślne robots* — cztery pliki, bez podnoszenia zależności.** Nie importują niczego z
pakietu, którego wcześniejszy storefront by nie miał, więc nic nie trzeba podnosić, aby się
zbudowały i działały:

- `lib/seo/crawler-policy.ts` — nowy: odczytuje politykę, buforuje ją na minutę dla kanału i
  zachowuje ostatnio odczytaną wartość, gdy backend jest nieosiągalny;
- `lib/seo/robots-directive.ts` — nowy: co polityka umieszcza w odpowiedzi;
- `middleware.ts` — zmieniony: odczyt polityki, nagłówek odpowiedzi, nagłówek żądania dla layoutu
  i rozszerzony `config.matcher`. Middleware działa teraz dla każdej ścieżki poza `/_next/static`
  (dotąd pomijał pliki publiczne, `/sitemap.xml`, `/robots.txt`, `/manifest.webmanifest` i
  `/_next/image`); dla tych ścieżek tylko dodaje nagłówek. Zmierzone na wzorcowym storefroncie,
  kosztuje to plik publiczny około jednej milisekundy. Storefront, który już zna politykę kanału,
  nigdy nie czeka na odświeżenie dłużej niż ułamek sekundy; czeka się tylko na pierwszy odczyt po
  starcie, najwyżej dwie sekundy, raz;
- `app/layout.tsx` — zmieniony: renderuje dodatkowy `<meta name="robots">` w obu dokumentach,
  które zwraca. Nie przenoś dyrektywy do eksportu `metadata` layoutu: własne `robots` strony
  zastępuje tam `robots` layoutu, więc zostałaby pominięta na każdej stronie, która je deklaruje.

Potem zbuduj storefront ponownie. `curl -sI https://<twój sklep>/ | grep -i x-robots-tag` pokazuje
nagłówek po zapisaniu wartości ograniczającej. Testy wzorcowego storefrontu dla tych plików
(`test/seo/crawler-policy.test.ts`, `robots-directive.test.ts`, `middleware-robots.test.ts`,
`middleware-effect.test.ts`, `layout-robots.test.ts`, `layout-outage-render.test.tsx` i
`test/conformance/robots-directive.spec.ts`) można skopiować opcjonalnie; jeden z nich,
`crawler-policy.test.ts`, porównuje własne sprawdzenie odpowiedzi w storefroncie z opublikowanym
schematem i dlatego wymaga w projekcie storefrontu `@endora-commerce/contracts` w tym wydaniu lub
nowszym; nic innego w tej grupie tego nie wymaga.

**2. Własne instrukcje `robots.txt` — `robots.txt` staje się trasą, a projekt potrzebuje
`@endora-commerce/contracts` w wersji `0.106.0` lub nowszej.** `lib/seo/robots-txt.ts` importuje
`composeCrawlerFile` z `@endora-commerce/contracts/seo`, czego cztery powyższe pliki nie
potrzebowały. `middleware.ts` i `app/layout.tsx` nie zmieniają się w tej grupie:

- **usuń** `app/robots.ts`. Musi zniknąć i nic Ci nie powie, jeśli nie zniknął: gdy istnieje
  razem z `app/robots.txt/route.ts`, Next buduje się bez ostrzeżenia, dalej serwuje stary plik z
  czasu budowania i nigdy nie dociera do nowej trasy. Lista tras w wyniku budowania pokazuje, który
  wygrał — `○ /robots.txt` to stary plik, `ƒ /robots.txt` to nowa trasa;
- **dodaj** `app/robots.txt/route.ts` — trasę;
- **dodaj** `lib/seo/robots-txt.ts` — to, czym trasa odpowiada, i kiedy odpowiada `503`;
- **dodaj** `lib/seo/robots-system-rules.ts` — generowane reguły, przeniesione bez zmian z
  `app/robots.ts`. **Jeśli edytowano listę `disallow` w Twoim `app/robots.ts`, przenieś te zmiany
  do `ROBOTS_SYSTEM_RULES` w tym pliku**;
- **zastąp** `lib/seo/crawler-policy.ts` nową wersją. Odczytuje teraz pliki dla robotów obok
  domyślnej polityki robots i porzuca odczyt z backendu, który zamrożony proces zostawił w
  zawieszeniu, zamiast czekać na niego w nieskończoność;
- **edytuj** `app/reserved-segments.ts`: dodaj `'robots.txt'` do `RESERVED_TOP_LEVEL_SEGMENTS` i
  dodaj ten sam wpis do ustawienia `cms.reserved_slug_segments` wdrożenia, jeśli je utrzymujesz;
- w `test/seo/route-declarations.test.ts`, jeśli go skopiowano, zastąp import z
  `'../../app/robots'` importem `ROBOTS_SYSTEM_RULES` i `robotsSitemapUrl` z
  `'../../lib/seo/robots-system-rules'`, tak jak robi to wersja wzorcowa.

Potem zbuduj storefront ponownie;
`curl -sI https://<twój sklep>/robots.txt | grep -i x-endora-crawler-files` pokazuje nagłówek, gdy
serwuje już nowa trasa. Czym trasa odpowiada:

- `200` z generowanymi regułami i tekstem kanału; `Content-Type: text/plain; charset=utf-8`,
  `Cache-Control: public, max-age=60`, `Vary: X-Sales-Channel`, `X-Endora-Crawler-Files: 1`. Dotąd
  plik był prerenderowany i wysyłany z `Cache-Control: public, max-age=0, must-revalidate` i
  `Content-Type: text/plain`;
- samymi generowanymi regułami, gdy moduł `seo` jest wyłączony, oraz wobec backendu, który nie ma
  tej funkcji;
- **`503` z `Retry-After: 120`**, gdy tekstu kanału nie da się odczytać, a proces storefrontu nigdy
  go nie odczytał — zamiast plikiem, który po cichu pomija reguły operatora. Proces, który raz
  odczytał tekst, serwuje tę wersję tak długo, jak backend jest nieosiągalny. Storefront
  uruchomiony, gdy jego backend nie działa, odpowiada więc na `robots.txt` kodem `503`, dopóki
  backend nie wróci; stron to nie dotyczy;
- `GET /robots.txt?part=system` odpowiada samymi generowanymi regułami, bez pytania backendu przez
  trasę, i jest wysyłane z `Cache-Control: no-store`.

Origin w wierszu `Sitemap:` to nadal `NEXT_PUBLIC_SITE_URL` wkompilowany przy budowaniu. Testy
wzorcowego storefrontu dla tych plików (`test/seo/robots-system-rules.test.ts` z jego fixture
`test/seo/__fixtures__/robots-before.txt`, `test/seo/robots-txt-route.test.ts` oraz uzupełnienia
w `test/seo/crawler-policy.test.ts`) można skopiować opcjonalnie. Fixture to własne generowane
reguły wzorca z originem `http://localhost:3000`; projekt, który zmienił swoją listę, dostosowuje
fixture do niej.

**3. `llms.txt` — zakłada, że grupy 1 i 2 są na miejscu**: `lib/seo/crawler-policy.ts`,
`lib/seo/robots-txt.ts`, `lib/seo/robots-system-rules.ts`, `lib/seo/robots-directive.ts` i
`app/robots.txt/route.ts` istnieją, a `app/robots.ts` jest usunięty. `middleware.ts` i
`app/layout.tsx` nie zmieniają się także w tej grupie:

- **dodaj** `app/llms.txt/route.ts` — trasę;
- **dodaj** `lib/seo/llms-txt.ts` — to, czym trasa odpowiada, i kiedy odpowiada `404` i `503`;
- **dodaj** `lib/seo/llms-txt-base.ts` — część generowaną. Wymienia `SITEMAP_STATIC_ROUTES` z
  Twojego `app/sitemap.ts`; **jeśli zmieniono tę listę, nadaj każdej ze swoich tras tytuł w
  `LLMS_TXT_PAGE_TITLES`** i wskaż w `LLMS_TXT_CONDITIONAL_PAGES` te z nich, które mogą odpowiedzieć
  „nie znaleziono”;
- **dodaj** `lib/seo/llms-txt-pages.ts` — czy strona warunkowa jest w tej chwili serwowana (dziś:
  blog), zapamiętywane dla kanału w pamięci podręcznej eksportowanej przez
  `lib/seo/crawler-policy.ts`;
- **dodaj** `lib/seo/crawler-file-response.ts` — nagłówki i tymczasową awarię wspólne dla obu
  plików;
- **zastąp** `lib/seo/robots-txt.ts` i `lib/seo/crawler-policy.ts` nowymi wersjami. Pierwszy bierze
  teraz nagłówki z `crawler-file-response.ts`; drugi odczytuje `unreadable` i eksportuje pamięć
  podręczną kanału, z której korzysta pytanie o stronę;
- **edytuj** `lib/seo/robots-directive.ts`: `isDocumentPath` musi odpowiadać `false` dla
  `/llms.txt`, tak jak wersja wzorcowa. **Nie pomijaj tego kroku**: bez niego storefront nadal
  serwuje plik, ale gdy backend jest nieosiągalny, odpowiada na `/llms.txt` stroną awarii zamiast
  ostatnią znaną wersją;
- **edytuj** `app/reserved-segments.ts`: dodaj `'llms.txt'` do `RESERVED_TOP_LEVEL_SEGMENTS` i
  dodaj ten sam wpis do ustawienia `cms.reserved_slug_segments` wdrożenia, jeśli je utrzymujesz;
- **upewnij się, że nie ma pliku `public/llms.txt`.** Plik w tym miejscu jest serwowany zamiast
  trasy — dla każdego kanału, bez tekstu operatora i w kanale ustawionym na `NOINDEX` — a ani
  budowanie, ani serwer tego nie zgłaszają.
  `curl -sI https://<twój sklep>/llms.txt | grep -i x-endora-crawler-files` pokazuje nagłówek, gdy
  odpowiada trasa.

Potem zbuduj storefront ponownie — lista tras w wyniku budowania pokazuje `ƒ /llms.txt`. Testy
wzorcowego storefrontu dla tych plików (`test/seo/llms-txt-base.test.ts`,
`test/seo/llms-txt-route.test.ts` oraz uzupełnienia w `test/seo/crawler-policy.test.ts`,
`test/seo/robots-txt-route.test.ts`, `test/seo/middleware-robots.test.ts` i
`test/seo/middleware-effect.test.ts`) można skopiować opcjonalnie.

**Podpis w stopce.** Storefront utworzony przez CLI `0.106.0` pokazuje podpis „Built with ❤️ using
Endora Commerce” jako ostatni wiersz stopki — osobny wiersz pod wszystkim, co stopka renderuje
(kolumnami, wierszem praw autorskich i tym, co moduł dodaje przez hooki `footer.bottom` i
`footer.copyright`), wyśrodkowany, w jednym wierszu, dopóki szerokość na to pozwala, ze znakiem
Endora Commerce obok nazwy produktu — podczas gdy dotąd siedział wewnątrz wiersza praw autorskich,
między danymi firmy a odnośnikami prawnymi. Odnośnik i jego parametry UTM się nie zmieniają.
Istniejący storefront się nie zmienia; aby przejąć ten układ, wprowadź tę samą zmianę w
`components/Footer.tsx` w projekcie storefrontu.

**Własny storefront**, który nie pochodzi od wzorca, serwuje pliki na tych samych zasadach:
`GET /robots.txt?part=system` odpowiada samymi jego generowanymi regułami, a
`GET /llms.txt?part=base` generowaną częścią `llms.txt`, oba jako `text/plain` z
`X-Endora-Crawler-Files: 1`, a kanał bez `llms.txt` odpowiada `404` z tym samym nagłówkiem; bez
nagłówka podgląd traktuje storefront jako nieaktualny. Odpowiada `503` zamiast plikiem, dopóki
`unreadable` w `GET /api/v1/storefront/seo/crawler-files` wskazuje `policy` lub
`llmsTxtAdditional`. Zobacz [Dla własnego sklepu](./modules/seo.md#dla-własnego-sklepu).

Jak dalece to sprawdzono: to, co mówi ta sekcja, pochodzi z dzienników zmian wydania, sprawdzonych
ze źródłami tego wydania — trasami i manifestem ustawień modułu `seo`, migracją platformy,
kontraktami, plikami wzorcowego storefrontu i przykładową konfiguracją nginx. W chwili pisania tej
sekcji żadna instancja nie została zaktualizowana z `0.105.0` poleceniem
`pnpm run upgrade 0.106.0` i w żadnym storefroncie utworzonym we wcześniejszym wydaniu nie
wprowadzono trzech powyższych grup plików; kolejność kroków, wiersz dla proxy i zmiany w
storefroncie nie były wypróbowane.

### Po aktualizacji do wydania 0.107.0 {#after-0-107-0}

`pnpm run upgrade 0.107.0` przenosi pakiety wydania z `0.106.0` i wykonuje jego migracje — piętnaście,
w tym jedną należącą do nowego modułu szablonów dokumentów. Wydanie przynosi trzy pakiety, których
wcześniej nie było — `@endora-commerce/mod-document-templates`, `@endora-commerce/mod-admin-search`
i `@endora-commerce/llm-client` — i **jeden z nich nie jest opcjonalny**: instancja, która
deklaruje `@endora-commerce/mod-invoices`, potrzebuje także
`@endora-commerce/mod-document-templates`, a krok `setup` aktualizacji sam go deklaruje i instaluje. Wydanie nie dodaje żadnej zmiennej środowiskowej. Dodaje
pięć uprawnień (`platform.api_description.read`, `document_templates:read`,
`document_templates:write`, `admin_search:configure` i `cms.translate`) i przenosi uprawnienia
importu i eksportu do modułów, do których należą dane.

Najwięcej zmienia się w tym, kto może korzystać z kanału sprzedaży. Każdy kanał ma teraz
przełącznik *Open to anonymous visitors*, który po aktualizacji jest włączony, a zalogowany klient
jest obsługiwany w kanale tylko wtedy, gdy jego organizacja jest do tego kanału przypisana.
Migracja danych tworzy te przypisania dla istniejących organizacji, więc nic się nie zmienia dla
klienta, który składał zamówienia tam, gdzie kupuje — ale przypisania warto przejrzeć, zanim
instancja znów przyjmie ruch. Koszyki należą do kanału, w którym zostały napełnione, złożenie
zamówienia sprawdza ceny koszyka, opis API nie jest już publiczny, a kilka ekranów i odpowiedzi się
zmienia. Ta sekcja mówi, co zrobić i w jakiej kolejności, a potem — co działa inaczej, osobno dla
każdego czytelnika: [operatorów](#after-0-107-0-operators),
[klientów API i integratorów](#after-0-107-0-api),
[autorów modułów i modułów nakładkowych](#after-0-107-0-authors) oraz właściciela
[istniejącego storefrontu](#after-0-107-0-storefront).

#### Co zrobić i w jakiej kolejności {#after-0-107-0-steps}

Przed aktualizacją:

1. **Jeśli projektowano szablony faktur, zapisz, co zawierają.** Szablony faktur przeniesiono do
   nowego modułu *Document templates* i nic nie jest przenoszone automatycznie:
   `Migration20261017T075839InvoicesDropInvoiceTemplates` usuwa tabelę `invoice_templates`, a PDF-y
   faktur — zarówno pobierane, jak i dołączane do e-maili — używają wbudowanego układu typu
   dokumentu faktury (dawnego szablonu ogólnego), dopóki operator nie ustawi szablonu faktury jako
   domyślnego w **Document templates**. Cofnięcie migracji odtwarza pustą tabelę, nie jej wiersze;
   jedyną kopią jest kopia zapasowa bazy danych.
2. **Odczytaj `assets.soft_delete_retention_days`** — *Soft-delete retention before hard-delete
   (days)* w grupie *Storage* w **Ustawieniach**, domyślnie 30. Od tego wydania zasoby przeniesione
   do kosza są trwale usuwane przez cogodzinne zadanie, gdy od ich usunięcia minie tyle dni, a
   **pierwsze uruchomienia po aktualizacji usuwają każdy zasób, który leży w koszu dłużej**, do 500
   na uruchomienie. Jeśli chcesz te zasoby zachować, wydłuż to ustawienie przed aktualizacją.
   Wartość mniejsza niż jeden jest odczytywana jako jeden dzień.
3. **W instancji z więcej niż jednym kanałem sprzedaży odczytaj `quote_requests.expiry_days`** —
   *Auto-expire pending after (days)* na karcie Quote Requests w **Ustawieniach** — dla każdego
   kanału, który ma własną wartość. Zadanie wygaszania trzyma się teraz wartości kanału danego
   zapytania ofertowego, podczas gdy wcześniej stosowało wartość kanału domyślnego do wszystkich:
   przy pierwszych uruchomieniach kanał z niższą wartością niż domyślna wygasza zaległe zapytania,
   które były nieaktywne tak długo, a kanał ustawiony na `0` przestaje wygaszać.

Sama aktualizacja:

4. **Uruchom `pnpm run upgrade 0.107.0`.** `invoices` wymienia teraz `document_templates` wśród
   `dependencies` w swoim manifeście i **jeśli instancja deklaruje `@endora-commerce/mod-invoices`**,
   krok `setup` aktualizacji dodaje `@endora-commerce/mod-document-templates` do głównego
   `package.json`, w wersji, w której zadeklarowana jest platforma, i instaluje go przed
   czymkolwiek innym. Jego pierwszy krok, `endora generate`, pochodzi już z właśnie
   zainstalowanego wydania i wypisuje wiersz:

   ```text
   declared @endora-commerce/mod-document-templates 0.107.0 in package.json — invoices needs document_templates (dependencies)
   ```

   Zatwierdź zmienione `package.json` i `pnpm-lock.yaml` razem z resztą aktualizacji. Jeśli krok
   `setup` się nie zakończył, uruchom `pnpm run setup` ponownie — kontynuuje od tego miejsca.
   Ręcznie musi go zadeklarować tylko instancja, w której `setup` pominięto albo która nie
   uruchamia `generate`:

   ```bash
   pnpm add -w -E @endora-commerce/mod-document-templates@0.107.0
   pnpm run setup
   ```

   Bez tego modułu wdrożenie, które składa `invoices`, odmawia uruchomienia i go wymienia:

   ```text
   This deployment will not boot: it composes modules whose declarations it does not satisfy.

     document_templates — not shipped by this deployment, and it is needed:
         invoices — dependencies
   ```

   Reszta opisu [Dodawanie modułu, który jest nowy w wydaniu](#adding-a-new-module) obowiązuje —
   flagi i to, co uruchomić ponownie. *Document templates* startuje włączony i nie da się go
   wyłączyć, dopóki włączony jest `invoices`. Pozostałe zależności dodane w wydaniu — `quote_requests`
   od `price_lists` i `transactional_emails`, `invoices` i `api_keys` od `admin_roles`,
   `assets_library` od `admin_users` — wskazują moduły, których nie da się wyłączyć i które każda
   instancja już deklaruje, więc nie wymagają niczego.

   Migracje, które wykonuje `setup`, w kolejności ich znaczników czasu:

   | Migracja | Moduł | Co robi |
   | --- | --- | --- |
   | `Migration20261014T115049QuoteRequestsItemReferencePrice` | `quote_requests` | Trzy kolumny dopuszczające `null` w `quote_request_items` na cenę referencyjną |
   | `Migration20261014T115053QuoteRequestsNegotiationPolicies` | `quote_requests` | Dwie tabele, `quote_request_org_policies` i `quote_request_account_policies` |
   | `Migration20261014T170531CatalogProductListSavedViews` | `catalog` | Tabela `product_list_saved_views` |
   | `Migration20261014T173236QuoteRequestsQuoteRequestListSavedViews` | `quote_requests` | Tabela `quote_request_list_saved_views` |
   | `Migration20261016T131148PriceListsPriceMatrixEntries` | `price_lists` | Tabela `price_list_matrix_entries` |
   | `Migration20261016T172243PwaPushNotificationPreferences` | `pwa` | Tabela `push_notification_preferences` |
   | `Migration20261017T071754DocumentTemplatesInit` | `document_templates` | Tabela `document_templates`, gdy moduł zostanie zadeklarowany |
   | `Migration20261017T075839InvoicesDropInvoiceTemplates` | `invoices` | Usuwa `invoice_templates` — zob. krok 1 |
   | `Migration20261017T142116QuoteRequestsQuoteRequestDocumentTemplate` | `quote_requests` | Kolumna `quote_requests.document_template_id` dopuszczająca `null` |
   | `Migration20261017T142121QuoteRequestsQuoteRequestEventPdfSent` | `quote_requests` | Dopuszcza typ zdarzenia `pdf-sent` |
   | `Migration20261018T074021CartsCartItemAgreedPrice` | `carts` | Trzy kolumny dopuszczające `null` w `cart_items` na uzgodnioną ilość i cenę z oferty |
   | `Migration20261018T101912CoreSalesChannelsAnonymousAccess` | platforma | `sales_channels.anonymous_access boolean not null default true` |
   | `Migration20261018T104644OrganizationsChannelAccessBackfill` | `organizations` | Przypisuje każdej organizacji jej kanały sprzedaży — zob. krok 7 |
   | `Migration20261018T141739AssetsLibraryAssetVersionsPermalinks` | `assets_library` | Jedenaście kolumn w `assets`, dwie tabele na stałe linki i sprzątanie magazynu |
   | `Migration20261019T043854CartsChannelBackfill` | `carts` | Zapisuje koszyk bez kanału w domyślnym kanale systemowym |

   Instancja, która deklaruje `@endora-commerce/mod-admin-search`, nie wykonuje dla niego żadnej
   migracji: moduł nie ma własnych tabel.

Po aktualizacji, zanim instancja znów przyjmie ruch:

5. **Nadaj ponownie uprawnienia do importu i eksportu.** Każda encja na ekranie Import / Export
   wymaga teraz uprawnienia, które chroni te same wiersze w module, do którego należą, podczas gdy
   wcześniej każda encja wymagała `catalog:write`:

   | Encja | Eksport | Import |
   | --- | --- | --- |
   | `products`, `categories` | `catalog:read` | `catalog:write` |
   | `stock` | `inventory:read` | `inventory:write` |
   | `customers` | `customers:read` | — |
   | `orders` | `orders:read` | — |

   Rola, która eksportowała klientów, zamówienia lub stany magazynowe albo importowała stany na
   podstawie `catalog:write`, potrzebuje `customers:read`, `orders:read`, `inventory:read` lub
   `inventory:write` nadanych w **Admin roles** (`/admin-roles`). Rola z `catalog:read` może teraz
   eksportować produkty i kategorie. Ekran i jego pozycja w menu bocznym otwierają się dla roli z
   którymkolwiek kodem z tabeli, a karta każdej encji pokazuje tylko te kontrolki, na które rola
   pozwala.
6. **Nadaj `platform.api_description.read` tym, którzy czytają opis API.**
   `GET /api/v1/_openapi.json` i `GET /api/v1/_docs` odpowiadają tylko administratorowi, którego
   rola ma ten kod, albo kluczowi API wydanemu z tym kodem w zakresach; wszyscy inni dostają `401`
   (brak sesji administratora i klucza) albo `403` (sesja lub klucz bez kodu). Rola administratora
   platformy ma wszystkie uprawnienia i nie wymaga niczego. Skrypt lub proces budowania, który pobiera
   dokument — generator klienta, test kontraktu — potrzebuje klucza API z zakresem
   `platform.api_description.read`, wydanego przez administratora, który ma ten kod, i wysyła go tak
   jak każdy klucz. W panelu administracyjnym dokument jest na nowym ekranie
   **System → API description**.
7. **Przejrzyj przypisania organizacji do kanałów sprzedaży i nie zamykaj żadnego kanału, dopóki
   storefront nie zostanie zaktualizowany.** Po aktualizacji każdy kanał jest otwarty dla
   niezalogowanych odwiedzających, tak jak każdy kanał był wcześniej, a zalogowany klient jest
   obsługiwany w kanale tylko wtedy, gdy jego organizacja jest do tego kanału przypisana. Migracja
   `Migration20261018T104644OrganizationsChannelAccessBackfill` przypisała każdej organizacji
   domyślny kanał systemowy oraz każdy kanał, w którym ma co najmniej jedno zamówienie. W instancji
   z jednym kanałem sprzedaży obejmuje to wszystkich i nic się nie zmienia. W instancji z kilkoma
   kanałami **organizacja, której klienci korzystają z innego kanału, nie składając w nim
   zamówienia** — zarejestrowana w drugim sklepie i bez zamówień albo wysyłająca tam tylko zapytania
   ofertowe — dostaje teraz w tym kanale odmowę przy logowaniu, z komunikatem *„To konto nie ma
   dostępu do tego sklepu.”* Otwórz każdą taką organizację w panelu administracyjnym i zaznacz kanał
   w jej panelu **Kanały sprzedaży**. Potem zdecyduj dla każdego kanału, czy pozostaje otwarty dla
   niezalogowanych odwiedzających — [Kanały sprzedaży i to, kto może z nich korzystać](#after-0-107-0-channel-access)
   mówi, co oznacza każdy wybór — ale **wyłączaj *Open to anonymous visitors* dopiero wtedy, gdy
   storefront ma pliki z części [W istniejącym storefroncie](#after-0-107-0-storefront)**, a w
   domyślnym kanale systemowym dopiero wtedy, gdy wiesz, jak docierają wywołania zwrotne płatności i
   przewoźników z modułów spoza wydania.
8. **W storefroncie, który obsługuje więcej niż jeden kanał sprzedaży przez nagłówek
   `X-Sales-Channel`**, a nie przez `SALES_CHANNEL_HOST_MAP`, zaktualizuj storefront, zanim klienci
   znów zaczną napełniać koszyki. Koszyk należy teraz do kanału, w którym jest napełniany, a storefront
   utworzony we wcześniejszym wydaniu wskazuje kanał tylko w tych wywołaniach backendu, które
   przekazują go jawnie; każde inne wywołanie backend przypisuje sam — według mapy hostów, a bez niej
   do domyślnego kanału systemowego. Do tego wydania nie miało to znaczenia dla koszyka, który
   istniał w kanale domyślnym bez względu na sklep. Od teraz koszyk kanału domyślnego i koszyk
   sklepu to dwa różne koszyki.
9. **Sprawdź, kto może nadawać jakie uprawnienia.** Administrator nadaje teraz tylko uprawnienia,
   które ma jego własna rola — w roli, w roli konta administratora, w zakresach klucza API — a rolę
   tworzoną przez platformę lub moduł, w tym `platform_admin`, może zmienić tylko posiadacz
   uprawnienia wieloznacznego `*`. Jeśli administrator z delegowanymi uprawnieniami zarządza rolami,
   użytkownikami lub kluczami API dla innych, nadaj jego roli uprawnienia, które on rozdaje, albo
   zostaw te zmiany posiadaczowi `*`.

W dowolnym momencie:

10. **Zdecyduj o powiadomieniach push dla ofert.** W sklepie z włączonymi powiadomieniami push
    zapytania ofertowe teraz je wysyłają: gdy administrator tworzy zapytanie dla klienta, modyfikuje,
    zatwierdza lub anuluje je i gdy zapytanie wygasa. Wcześniej nie wysyłały ich nigdy, choć
    przełącznik istniał. Jeśli ich nie chcesz, wyłącz tę kategorię ustawieniem
    `pwa.push_quote_status_enabled` na ekranie PWA.
11. **Zainstaluj `@endora-commerce/mod-admin-search`, jeśli paleta poleceń ma znajdować rekordy** —
    zamówienia, zapytania ofertowe, szanse sprzedaży, organizacje, klientów, produkty i kategorie.
    Moduł jest opcjonalny; bez niego paleta znajduje ekrany i akcje jak dotąd. Zadeklaruj go tak, jak
    opisuje [Dodawanie modułu, który jest nowy w wydaniu](#adding-a-new-module); startuje włączony.
12. **Zbuduj własne moduły ponownie z tym wydaniem.** Kod, który implementuje lub konstruuje któryś z
    portów i kształtów wymienionych w części
    [Dla autorów modułów i modułów nakładkowych](#after-0-107-0-authors), nie skompiluje się, dopóki
    nie zostanie zmieniony, a moduł, który odbiera wywołanie zwrotne dostawcy, ma deklarację do
    dodania.
13. **Zaktualizuj storefront** zgodnie z częścią [W istniejącym storefroncie](#after-0-107-0-storefront).
    Bez tego zamówienie, strona produktu i logowanie działają jak wcześniej; zamknięte sklepy, ekran
    braku dostępu, wybór powiadomień push, blokada negocjacji cen i język PDF-a porównania — nie.

#### Dla operatorów {#after-0-107-0-operators}

##### Kanały sprzedaży i to, kto może z nich korzystać {#after-0-107-0-channel-access}

**Każdy kanał sprzedaży ma przełącznik *Open to anonymous visitors*** w formularzu kanału w
**Sales channels**. Jest włączony w każdym istniejącym kanale i w każdym nowym.

- **Włączony** — każdy może przeglądać sklep; zalogowany klient może z niego korzystać, gdy jego
  organizacja jest przypisana do kanału.
- **Wyłączony** — sklep obsługuje wyłącznie zalogowanych klientów. Zaktualizowany storefront z każdej
  strony kieruje niezalogowanego odwiedzającego na stronę logowania z komunikatem, że sklep jest dla
  zalogowanych klientów biznesowych; nie dostaje on niczego z katalogu, cen ani treści, mapa strony
  sklepu jest pusta, jego `robots.txt` zabrania wszystkiego i nie wskazuje mapy strony, a jego
  `llms.txt` podaje nazwę sklepu i mówi, że treść jest tylko dla zalogowanych klientów. Rejestracja
  firmy pozostaje na stronie logowania, a zarejestrowana tam organizacja otrzymuje ten kanał — więc
  przy automatycznej moderacji wchodzi każdy, kto zarejestruje firmę, a przy ręcznej nikt, dopóki
  operator nie zatwierdzi organizacji. Samodzielna rejestracja klienta indywidualnego (B2C) nie jest
  oferowana, a logowanie przez zewnętrznego dostawcę (Google, Microsoft) nie tworzy tam nowego konta.
  Lista kanałów oznacza zamknięty kanał etykietą *Sign-in required*. Pokazywanie cen niezalogowanym
  odwiedzającym to osobne ustawienie i ma znaczenie tylko w sklepie otwartym.

Backend stosuje regułę do każdego żądania spoza `/api/v1/admin/`, gdy jego kanał zostanie wyznaczony:
żądanie anonimowe w zamkniętym kanale dostaje `403 SALES_CHANNEL_SIGN_IN_REQUIRED`, a żądanie
klienta — także administratora działającego jako klient — w kanale, do którego jego organizacja nie
jest przypisana, `403 SALES_CHANNEL_NOT_PERMITTED`. Reguła nie dotyczy administratorów ani kluczy
API. Kilka tras jest osiągalnych w każdym aktywnym kanale, bo wywołujący musi do nich dotrzeć, aby
zostać klientem sklepu, albo nim nie jest: logowanie i wylogowanie, drugi składnik i logowanie przez
zewnętrznego dostawcę, reset hasła, weryfikacja e-maila, rejestracja firmy, zaproszenia, tożsamość
kanału, konfiguracja języków, słowniki czytane przez formularz rejestracji, polityka robotów i pliki
dla robotów, pobieranie plików produktowych i linki newslettera w e-mailach.

**To, które organizacje mogą korzystać z kanału, ustawia się w organizacji**, w nowym panelu
**Kanały sprzedaży** na jej stronie: odczyt z `customers:read` lub `customers:manage`, zmiana z
`customers:manage`. Organizacja zachowuje co najmniej jeden kanał. Każdy dodany lub usunięty kanał to
jeden wiersz w dzienniku audytu, a zmiana obowiązuje od razu na serwerze, który ją wprowadził, i na
każdym innym w ciągu 30 sekund. Klient, którego organizacja nie jest przypisana, dostaje odmowę przy
logowaniu — hasłem, drugim składnikiem lub przez zewnętrznego dostawcę — zanim powstanie sesja;
klient, któremu przypisanie usunięto w trakcie sesji, widzi w zaktualizowanym storefroncie ekran
*Brak dostępu do tego sklepu* z listą sklepów, z których może korzystać, każdy jako link, gdy
ustawienie **Storefront URL** kanału jest wypełnione.

**Jaki kanał dostaje nowa organizacja.** Firma zarejestrowana w sklepie dostaje kanał tego sklepu;
organizacja osobista utworzona przy rejestracji klienta indywidualnego lub logowaniu przez
zewnętrznego dostawcę dostaje kanał, w którym odwiedzający się zarejestrował; organizacja utworzona w
panelu administracyjnym dostaje kanały wybrane w formularzu; każda inna ścieżka tworzenia daje
domyślny kanał systemowy. Przyjęcie zaproszenia nie zmienia żadnego przypisania. **New
organization** (`/organizations/new`, przycisk na liście organizacji i akcja palety
`new-organization`, `customers:manage`) tworzy organizację w panelu administracyjnym — zduplikowany
NIP jest odrzucany, tak jak przy rejestracji.

**Zanim zamkniesz domyślny kanał systemowy**, dowiedz się, gdzie docierają wywołania zwrotne
dostawców. Powiadomienie bramki płatności, webhook przewoźnika czy adres powrotu od dostawcy
przychodzą bez sesji i zwykle bez kanału, więc są żądaniem anonimowym w domyślnym kanale
systemowym: jeśli moduł, który je odbiera, nie zadeklaruje trasy jako otwartej, po zamknięciu tego
kanału dostają `403`, a powiadomienia dostawcy przestają docierać. `POST /api/v1/payments/receive` i
`POST /api/v1/shipments/receive` są wywoływane z sesją administratora lub kluczem API, których
reguła nie dotyczy; moduł bramki lub przewoźnika, który odbiera żądanie samego dostawcy, musi
zadeklarować tę trasę, jak opisuje część
[Dla autorów modułów i modułów nakładkowych](#after-0-107-0-authors).

Zobacz [Otwieranie i zamykanie sklepu dla niezalogowanych odwiedzających](./modules/sales_channels/admin-usage.md#anonymous-access)
oraz [Kanały sprzedaży](./modules/organizations.md#kanały-sprzedaży) na stronie modułu organizacji.

##### Koszyki, ceny i składanie zamówień

**Koszyk należy do sklepu, w którym jest napełniany.** Klient ma jeden aktywny koszyk na kanał
sprzedaży, wyceniany, objęty promocjami i sprawdzany pod kątem „tylko na zapytanie” w tym kanale,
podczas gdy wcześniej każdy koszyk był tworzony i wyceniany w domyślnym kanale systemowym. Token
koszyka niezalogowanego odwiedzającego wskazuje koszyk tylko w jednym sklepie, a napełnianie koszyka
w innym sklepie zaczyna nowy. Łączenie przy logowaniu łączy tylko koszyk anonimowy ze sklepu, w
którym klient się loguje. Złożenie zamówienia z koszykiem innego kanału jest odrzucane z
`422 ORDER_SALES_CHANNEL_MISMATCH`, zanim cokolwiek zostanie zarezerwowane lub zapisane, a koszyk
zostaje zachowany. Migracja `Migration20261019T043854CartsChannelBackfill` zapisała każdy koszyk bez
kanału w domyślnym kanale systemowym; jeśli klient miał już tam aktywny koszyk, koszyk bez kanału
pozostaje bez zmian i nie jest już osiągalny. Zobacz
[Jeden koszyk na sklep](./modules/carts.md#jeden-koszyk-na-sklep).

**Cena pozycji koszyka jest zawsze ceną dla jej bieżącej ilości**, a złożenie zamówienia to
sprawdza:

- dodanie kolejnych sztuk produktu, zmiana ilości, łączenie koszyka przy logowaniu i ponowne
  zamówienie zapisują cenę dla ilości wynikowej, więc próg ilościowy dotyczy zamawianej ilości, a
  ponowne zamówienie jest wyceniane według dzisiejszych cen;
- produkt, któremu cenę nadaje ani cennik, ani jego własna cena, jest odrzucany z
  `422 CART_PRODUCT_UNPRICED`, podczas gdy wcześniej był dodawany po `0.00`; produkt sprzedawany
  tylko na zapytanie jest odrzucany z `400 CART_PRODUCT_QUOTE_ONLY` niezależnie od tego, czy jest w
  cenniku;
- pozycja utworzona z zaakceptowanego zapytania ofertowego zachowuje uzgodnioną cenę tylko przy
  uzgodnionej ilości, a przy każdej innej jest wyceniana z cennika. Koszyk przekształcony z oferty
  **przed** tym wydaniem nie ma uzgodnionej ilości, więc jego pozycje są przy składaniu zamówienia
  wyceniane z cennika; ponowne przekształcenie oferty przywraca uzgodnione ceny;
- przy składaniu zamówienia pozycja, której zapisana cena nie jest już ceną, po jakiej można ją
  zamówić, daje `409 CART_PRICE_CHANGED`. Nic nie jest zapisywane, koszyk jest aktualizowany, a
  kupujący składa zamówienie ponownie po jego przejrzeniu. Istniejący storefront pokazuje tę odmowę
  na stronie błędu zamówienia z kodem błędu przed zdaniem; zaktualizowany pokazuje samo zdanie.

Zobacz [Ceny pozycji](./modules/carts.md#ceny-pozycji).

**Tworzenie zamówienia w panelu administracyjnym używa wybranego kanału.**
`POST /api/v1/admin/orders` sprawdza produkty względem asortymentu kanału zamówienia, a nie żądania
administratora, i odrzuca nieistniejący kanał sprzedaży z `404`, podczas gdy wcześniej składał
zamówienie w domyślnym kanale systemowym. Ekran **Create order** pokazuje *Items* i podsumowanie po
wybraniu klienta i kanału, dodaje produkty przez wspólną przeglądarkę produktów (do 200 naraz) lub
szybkie wyszukiwanie i mówi przy każdej pozycji, dlaczego produktu nie można zamówić: klient go nie
widzi albo nie ma go w asortymencie kanału. Podgląd zamówienia również odrzuca nieznany kanał z
`404`.

##### Uprawnienia i to, kto może je nadawać

- **Import i eksport** podlegają uprawnieniom modułów, do których należą dane — tabela jest w kroku 5.
- **Opis API** odczytuje się z `platform.api_description.read` — krok 6. Nowy ekran
  **System → API description** (`/api-description`, dostępny też w palecie poleceń) pokazuje tytuł,
  wersję i liczbę punktów końcowych dokumentu, pobiera go jako JSON i otwiera interaktywną dokumentację
  pod własnym adresem API. Strona dokumentacji ładuje z jsDelivr przypiętą wersję `swagger-ui-dist`,
  `5.33.3`, z sumą integralności dla każdego pliku, podczas gdy wcześniej ładowała wersję aktualną
  w danej chwili.
- **Administrator nadaje tylko to, co ma jego rola.** Zapisanie roli z uprawnieniem, którego
  wykonujący nie ma, albo zmiana roli, która już je ma, daje `403 ADMIN_ROLE_GRANT_EXCEEDED` z
  listą kodów; rolę tworzoną przez platformę lub moduł zmienia tylko posiadacz `*` (w przeciwnym
  razie `409 ADMIN_ROLE_PROTECTED`). Przypisanie roli daje `403 ADMIN_ROLE_GRANT_EXCEEDED`, jeśli
  wykonujący nie ma każdego uprawnienia, które ona nadaje, a administratora, którego rola ma coś,
  czego wykonujący nie ma, ten nie może edytować, ustawić mu hasła, dezaktywować ani usunąć
  (`403 ADMIN_USER_OUTRANKS_ACTOR`). Klucz API jest wydawany tylko z zakresami, które ma rola
  wydającego administratora (`403 API_KEY_SCOPE_NOT_HELD`).
- **Nowe uprawnienia.** `document_templates:read` i `document_templates:write` (jednorazowy krok
  przy pierwszym uruchomieniu nadaje pierwsze każdej roli z `invoices:read`, a każdej roli z
  `invoices:write` także drugie, i zapisuje to w dzienniku audytu), `admin_search:configure` (po
  których polach szuka wyszukiwanie globalne, gdy ten moduł jest zainstalowany), `cms.translate`
  (akcja *Translate* w Page Builderze) i `platform.api_description.read`. `invoices:write` ma teraz
  etykietę *Issue/correct invoices and configure invoicing*.

##### Logowanie i konta

- **Modułu `mfa` nie da się wyłączyć, dopóki administratorzy muszą używać drugiego składnika.**
  Wyłączenie go na ekranie **Modules** daje `409 MFA_DEACTIVATION_BLOCKED`, dopóki włączone jest
  `mfa.admin.totp_enforced`, i niczego nie zmienia; najpierw wyłącz ten wymóg. Ponowne włączenie
  `mfa` nigdy nie jest odrzucane.
- **Zmiana miejsca, do którego zapisane poświadczenie wysyła swoje sekrety, wymaga ponownego
  wpisania sekretów.** Zapisanie poświadczenia ze zmienionym polem punktu końcowego — *Base URL*
  modelu LLM, host SMTP — daje `422 CREDENTIAL_SECRET_REENTRY_REQUIRED`, chyba że każdy zapisany
  sekret rekordu zostanie wpisany ponownie w tym samym zapisie; formularz oznacza te pola, gdy tylko
  punkt końcowy zostanie zmieniony. Poświadczenie zapisane bez zmiany punktu końcowego zachowuje
  swoje sekrety jak wcześniej.
- **Logowanie klienta, drugi składnik klienta i prośby o reset hasła mają limity na konto**, tak jak
  logowanie administratora: 50 błędnych haseł w 30 minut z urządzenia, na którym konto się nie
  logowało, 10 z takiego, na którym się logowało; 20 błędnych kodów drugiego składnika w 30 minut,
  10 ze znanego urządzenia; 5 próśb o reset na godzinę. Powyżej limitu odpowiedź to
  `429 CUSTOMER_AUTHENTICATION_THROTTLED` z `Retry-After`. Udane logowanie ustawia plik cookie
  `b2b_customer_device`, który oznacza znane urządzenie — istniejący storefront go nie przekazuje,
  więc jego klienci są liczeni według pierwszego limitu, dopóki storefront nie zostanie
  zaktualizowany. Prośba o nowy link resetujący unieważnia wcześniejsze, niewykorzystane.
- **Logowanie przez zewnętrznego dostawcę podlega regułom logowania hasłem**, w storefroncie i w
  panelu administracyjnym: kończy się tylko w przeglądarce, która je rozpoczęła, konto z drugim
  składnikiem trafia na ekran drugiego kroku zamiast zostać zalogowane, a zablokowane konto klienta
  dostaje odmowę z tym samym zdaniem co przy logowaniu hasłem. Sesja klienta, którego konto jest
  zablokowane, usunięte lub nie istnieje, jest traktowana jak wylogowana.
- **Błędny kod lub hasło na ekranach drugiego składnika po zalogowaniu nie wylogowuje już
  administratora.** Potwierdzenie konfiguracji, wyłączenie drugiego składnika i ponowne generowanie
  kodów odzyskiwania odpowiadają na błędny kod `403 MFA_INVALID_CODE`, a na błędne hasło
  `403 CURRENT_PASSWORD_INVALID`; wcześniej odpowiadały `401`, które panel administracyjny traktuje
  jak wygasłą sesję.

##### Biblioteka mediów

- **Nie można przesyłać plików HTML, XHTML, XML (w tym XSL) ani JavaScript**, niezależnie od
  `assets.allowed_file_types`: `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED`, według zadeklarowanego typu i
  rozszerzenia. SVG jest nadal przyjmowany i zapisywany jako `image/svg+xml`. Plik tych typów
  przesłany wcześniej pozostaje w bibliotece i jest serwowany do pobrania.
- **Pliki są serwowane ze stałym nagłówkiem polityki treści** i `X-Content-Type-Options: nosniff`;
  obrazy rastrowe, SVG, wideo, audio, PDF i zwykły tekst są wyświetlane w przeglądarce, każdy inny
  typ jest pobierany. Prywatny zasób w S3 lub GCS jest przekierowywany do magazynu tylko z ważnym
  podpisanym linkiem, tak jak zasób lokalny już był (w przeciwnym razie `403 ASSET_ACCESS_DENIED`).
- **Plik zasobu można podmienić w miejscu**, z zachowaniem identyfikatora, folderu, etykiety,
  widoczności, każdego odwołania i każdego wydanego już adresu; podmieniony plik można przywrócić
  jako poprzednią wersję przez `assets.soft_delete_retention_days`. Zasób może mieć **stały link**,
  serwowany pod `/assets/file/<permalink>`. Oba są w panelu zasobu, za uprawnieniem `assets.write`;
  biblioteka jest też w palecie poleceń jako *Assets library*.
- **Osadzane adresy zasobów mają `?v=<wersja treści>`**, więc podmieniony plik zostaje pobrany, a
  osadzenie może być buforowane przez rok; `GET /assets/file/<id>` jest teraz wysyłany z
  `Cache-Control: public, no-cache`. Strona CMS zbuforowana przed podmianą może przez maksymalnie
  pięć minut serwować poprzednią wersję.
- **Zasoby w koszu są trwale usuwane** po `assets.soft_delete_retention_days` — krok 2. Każde
  uruchomienie zadania zapisuje jeden wiersz dziennika `assets_library.retention.sweep`.

Zobacz [Które adresy są stałe](./modules/assets-library/index.md#które-adresy-są-stałe) oraz
[Przechowywanie i trwałe usuwanie](./modules/assets-library/index.md#retention-and-purge).

##### Dokumenty i PDF-y

- **Document templates** (`document_templates`) to miejsce, w którym projektuje się układy PDF, w
  Page Builderze, dla typu dokumentu i kanału sprzedaży, po jednym układzie na język. Obsługuje
  fakturę, porównanie produktów i zapytanie ofertowe. Ekrany szablonów faktur przeniesiono tam:
  `/invoices/templates` przekierowuje do nich, a PDF faktury wysyłany e-mailem jest teraz
  generowany dokładnie tak jak pobierany. Zobacz [Document templates](./modules/document-templates.md).
- **Ekran zapytania ofertowego oferuje *Export PDF* i *Send PDF to customer*** w każdym stanie,
  dopóki szablony dokumentów są włączone. Wysyłka przesyła PDF na maksymalnie pięć adresów przez nowy
  e-mail transakcyjny `quote_request_pdf`, edytowalny i wyłączalny jak każdy inny, i pojawia się w
  historii oferty.
- **PDF porównania** korzysta z szablonu, w języku, w którym kupujący przegląda sklep, jeśli kanał go
  oferuje: kupujący przeglądający sklep po polsku dostaje teraz polski PDF.

##### Zapytania ofertowe

- **Każda pozycja oferty zapisuje cenę referencyjną** — ile klient zapłaciłby w zwykłym zamówieniu w
  kanale zapytania — pokazywaną w panelu administracyjnym obok propozycji klienta i ceny uzgodnionej.
  Koszyk przekształcony w zapytanie ofertowe nie zapisuje już swoich cen jako propozycji klienta.
- **Blokada negocjacji cen dla klienta.** W organizacji (domyślnie dozwolone) oraz, jako nadpisanie,
  na koncie klienta administrator decyduje, czy klienci mogą proponować ceny. Utworzenie lub edycja
  szkicu z proponowaną ceną, gdy właścicielowi zapytania nie wolno, jest odrzucana z
  `422 RFQ_PRICE_PROPOSAL_NOT_ALLOWED`. Panele wymagają `customers:read` do odczytu i
  `customers:manage` do zmiany.
- **Czytelna historia** na ekranie zapytania ofertowego, łącząca zapisy jednej decyzji i wskazująca,
  kto działał.
- **Przedstawiciel handlowy spoza organizacji zapytania dostaje `404`**, jak dla nieistniejącego
  zapytania, podczas gdy wcześniej dostawał `403`.
- **Najwyżej 200 pozycji** przy tworzeniu lub edycji szkicu przez klienta (powyżej `400`). Klient
  może wielokrotnie edytować oczekujący szkic, dopóki administrator go nie zmodyfikuje, do 30 edycji
  na minutę na zapytanie.

##### Ceny, katalog i listy

- **Cenniki zyskują macierz cen** (karta *Price matrix* cennika): jeden wpis wycenia produkt,
  kategorię, wartość atrybutu, kategorię z wartością atrybutu albo wszystkie produkty, opcjonalnie
  dla organizacji i przedziału ilości, ceną stałą lub rabatem procentowym. Wybór według atrybutu
  używa atrybutów oznaczonych *Price list rules*. Zobacz [Cenniki](./modules/price_lists.md).
- **Dodawanie produktów do cennika** otwiera wspólną przeglądarkę produktów i dodaje do 200 produktów
  w jednym kroku. Systemowy cennik *Default* nadal nie przyjmuje produktów w ten sposób.
- **Odczyty katalogu w storefroncie mogą być wyceniane w walucie kupującego**, jeśli kanał ją
  obsługuje. W walucie innej niż domyślna waluta kanału produkt, któremu cenę nadaje tylko jego
  własna cena, nie ma ceny na liście, zamiast pokazywać własną cenę w niewłaściwej walucie.
- **Zapisane widoki** na liście produktów i liście zapytań ofertowych, a na liście zamówień zapis i
  usuwanie przez okna dialogowe zamiast monitów przeglądarki. Dwa widoki jednego administratora na
  jednej liście nie mogą różnić się tylko wielkością liter.
- **Nowo utworzony produkt jest od razu wyszukiwalny**, bez pierwszej edycji.
- **Listy CMS** — Pages, Blocks, Templates, Hooks — są w palecie poleceń.

##### Powiadomienia, newsletter i AI

- **Powiadomienia push o statusie.** Dwa ustawienia, `pwa.push_order_status_enabled` i
  `pwa.push_quote_status_enabled` (domyślnie włączone, globalnie i dla kanału), włączają obie
  kategorie; klient wybiera dla swojego konta w zaktualizowanym storefroncie. Powiadomienia o
  zamówieniach są w języku kanału, nazywają status tak jak sklep i otwierają zamówienie.
  Powiadomienia o ofertach zaczynają być wysyłane — krok 10.
- **Śledzenie otwarć i kliknięć newslettera** włączają dwa nowe ustawienia,
  `newsletter.tracking.opens_enabled` i `newsletter.tracking.clicks_enabled`, domyślnie wyłączone.
  Gdy są wyłączone, kampanie są wysyłane bez śledzenia, jak wcześniej.
- **Page Builder potrafi tłumaczyć** płótno karty języka lub zaznaczenie modelem LLM skonfigurowanym
  w *Settings → Page Builder* (`cms.page_builder.translation.enabled`, domyślnie wyłączone), za
  uprawnieniem `cms.translate`. Każde żądanie jest zapisywane w dzienniku audytu.
- **Konfiguracje LLM obsługują DeepSeek i dowolny punkt końcowy zgodny z OpenAI** przez nowego
  dostawcę *OpenAI-compatible (custom endpoint)*; każdy *Base URL* modelu LLM musi być bezwzględnym
  adresem `http://` lub `https://`.

##### Wszystko inne, co widzi operator

- **Globalne wyszukiwanie w panelu administracyjnym**, gdy zainstalowano
  `@endora-commerce/mod-admin-search` (krok 11): paleta szuka rekordów od minimalnej długości
  (`admin_search.minimum_query_length`, domyślnie 3), a każdy typ podlega widoczności swojej listy w
  panelu; `/global-search` pokazuje pełne wyniki. Zobacz [Admin search](./modules/admin-search.md).
- **Ekran ustawień** nie pokazuje już wartości jednego kanału sprzedaży pod nagłówkiem innego, gdy
  lista jeszcze się wczytywała w chwili zmiany „Editing for”.
- **Menu boczne** pokazuje numer wydania w osobnej sekcji, pod logo.
- **Podglądy e-maili** w edytorze e-maili i w podglądzie kampanii newslettera są rysowane w ramkach,
  które nie uruchamiają skryptów.
- **`order.cancelled.v1` jest emitowane** przy anulowaniu zamówienia, więc subskrybent napisany pod
  to zdarzenie teraz działa.

#### Dla klientów API i integratorów {#after-0-107-0-api}

- **Opis API wymaga uprawnienia.** `GET /api/v1/_openapi.json` i `GET /api/v1/_docs` wymagają sesji
  administratora, którego rola ma `platform.api_description.read`, albo klucza API z tym zakresem:
  `401 UNAUTHORIZED` bez żadnego z nich, także z sesją klienta, `403 FORBIDDEN` bez kodu. Obie
  odpowiedzi mają `Cache-Control: private, no-store`. `GET /api/v1/admin/api-description` serwuje
  ten sam dokument w przestrzeni administracyjnej. `apiKeyScopeSchema` przyjmuje nowy zakres.
- **Dostęp do kanału sprzedaży.** Każde żądanie storefrontu jest rozstrzygane po wyznaczeniu kanału:
  `403 SALES_CHANNEL_SIGN_IN_REQUIRED` dla żądania anonimowego w zamkniętym kanale,
  `403 SALES_CHANNEL_NOT_PERMITTED` dla klienta, którego organizacja nie jest przypisana, oba z
  `details.channelCode`. `POST /api/v1/auth/customer/login` odpowiada tym drugim po poprawnym haśle
  (błędne nadal daje najpierw `401`) i nie ustawia pliku cookie.
  `GET /api/v1/storefront/sales-channel` zawiera `anonymousAccess`, a nowe
  `GET /api/v1/storefront/sales-channel/access` mówi wywołującemu, czy może korzystać ze sklepu, a
  klientowi z odmową — z których sklepów może; nigdy nie odmawia. Panel administracyjny:
  `GET`/`PUT /api/v1/admin/organizations/:id/sales-channels`,
  `GET /api/v1/admin/organizations/sales-channel-options`, `POST /api/v1/admin/organizations`;
  `anonymousAccess` w kształtach administracyjnych kanału sprzedaży (przy tworzeniu domyślnie
  `true`). `GET /api/v1/storefront/seo/crawler-files` zawiera opcjonalne `anonymousAccess` — brak
  traktuj jako `true`.
- **Koszyki per kanał.** Każda trasa koszyka storefrontu dotyczy koszyka kanału żądania; pozycja
  koszyka innego kanału daje `404`. Złożenie zamówienia z koszykiem innego kanału daje
  `422 ORDER_SALES_CHANNEL_MISMATCH`.
- **Złożenie zamówienia sprawdza ceny.** `409 CART_PRICE_CHANGED` z `details.lines` — `productId`,
  `variantId`, `quantity`, `previousUnitPrice`, `currentUnitPrice` (`null`, gdy pozycji nie można
  już zamówić) i `currency`. Odczytaj koszyk ponownie i złóż zamówienie jeszcze raz. Dodanie
  produktu bez ceny daje `422 CART_PRODUCT_UNPRICED`.
- **Zamówienia w panelu administracyjnym.** `POST /api/v1/admin/orders` i
  `POST /api/v1/admin/orders/preview` odpowiadają na nieznany `salesChannelId` `404 NOT_FOUND`.
  Podgląd podaje dwa nowe powody niedostępności pozycji, `PRODUCT_NOT_VISIBLE_TO_CUSTOMER` i
  `PRODUCT_NOT_IN_SALES_CHANNEL`, po jednym na pozycję w kolejności, jaką podaje
  `ADMIN_ORDER_PREVIEW_MESSAGE_PRECEDENCE`; `messages[].code` pozostaje ciągiem znaków, więc
  nieznany kod traktuj jako ogólne „niedostępne”.
- **Import i eksport.** `GET /api/v1/admin/import-export/entities` wymienia tylko to, co wywołujący
  może eksportować lub importować, każdą pozycję z `canExport` i `canImport`; trasy eksportu i
  importu odpowiadają `403` bez uprawnienia danej encji, a `405` przy imporcie encji tylko do
  eksportu, którą wywołujący może eksportować.
- **Zmienione kody odpowiedzi.**
  - Trasy samoobsługi drugiego składnika (`…/activate`, `…/disable`, `…/recovery-codes/regenerate`
    pod `/api/v1/admin/account/mfa` i `/api/v1/account/mfa`) odpowiadają `403 MFA_INVALID_CODE` i
    `403 CURRENT_PASSWORD_INVALID`, podczas gdy wcześniej odpowiadały `401`. Wyzwania przy
    logowaniu zachowują `401`.
  - Przedstawiciel handlowy spoza organizacji zapytania ofertowego dostaje `404` na każdej
    administracyjnej trasie zapytań ofertowych.
  - Żądanie ograniczone limitem odpowiada `429 RATE_LIMITED` w standardowej kopercie błędu, z
    `Retry-After`, podczas gdy wcześniej odpowiadało `500 INTERNAL`.
  - Treść, której serwer nie potrafi odczytać, daje `400` (pusta z
    `Content-Type: application/json` lub niepoprawna), `413` (ponad limit rozmiaru) albo `415`
    (brak parsera dla typu), każda z `VALIDATION_FAILED`, podczas gdy wcześniej dawała `500`.
  - `PATCH /api/v1/admin/cms/hooks/:id/attachments/:blockId` dla bloku, który nie jest dołączony,
    odpowiada `404 CMS_BLOCK_NOT_FOUND`.
  - `POST /api/v1/admin/assets` z dwiema częściami plikowymi odpowiada `201` dla pierwszej z nich.
- **Nowe odmowy.** `415 ASSET_UPLOAD_TYPE_NOT_ALLOWED` przy przesyłaniu HTML, XHTML, XML lub
  JavaScript; `409 MFA_DEACTIVATION_BLOCKED` przy wyłączaniu `mfa`, gdy wymuszony jest TOTP
  administratorów; `422 CREDENTIAL_SECRET_REENTRY_REQUIRED` (`details.fields`) przy zmianie punktu
  końcowego poświadczenia bez jego sekretów; `403 ADMIN_ROLE_GRANT_EXCEEDED`,
  `409 ADMIN_ROLE_PROTECTED`, `403 ADMIN_USER_OUTRANKS_ACTOR` i `403 API_KEY_SCOPE_NOT_HELD` z
  reguły nadawania; `429 CUSTOMER_AUTHENTICATION_THROTTLED` i
  `503 CUSTOMER_AUTHENTICATION_UNAVAILABLE` przy logowaniu klienta;
  `422 RFQ_PRICE_PROPOSAL_NOT_ALLOWED`; oraz `400` dla ponad 200 pozycji przy tworzeniu lub edycji
  szkicu zapytania ofertowego przez klienta.
- **Przyjmowanie zdarzeń analitycznych.** `POST /api/v1/analytics/events` zapisuje tożsamość
  wyznaczoną przez serwer — zalogowanego klienta, kanał żądania — i ignoruje `customerAccountId`,
  `organizationId` i `salesChannelId` w treści, które nadal przechodzą walidację. Limit to 60 partii
  na minutę na adres klienta.
- **Linki śledzące newslettera** to `GET /api/v1/newsletter/open.gif?token=…` i
  `GET /api/v1/newsletter/click?token=…&u=…`. Dawne formy ze ścieżką, do których podpisany token był
  za długi, zostały usunięte.
- **Adresy zasobów.** `url` i `storageUrl` zasobu publicznego zawierają `?v=<contentVersion>`;
  stałą formą jest nowe `fileUrl`. Podsumowania i szczegóły zyskują `fileUrl`, `permalink`,
  `permalinkUrl` i `contentVersion`; szczegóły zyskują `previousVersion`, `retentionDays` i
  `replaceable`. Nowe trasy: `POST /api/v1/admin/assets/:id/replace`,
  `POST …/previous-version/restore`, `PUT`/`DELETE …/permalink`,
  `GET /api/v1/admin/assets/folders/:folderId/permalink-count`.
- **Usunięte: API szablonów faktur.** `/api/v1/admin/invoice-templates` i jego trasy zostały
  usunięte; użyj `/api/v1/admin/document-templates` z `documentType: 'invoices.invoice'`.
- **Nowe w tym wydaniu**, wszystko addytywne: historia zapytania ofertowego
  (`GET /api/v1/admin/quote-requests/:id/history`), negocjacja cen
  (`…/organizations/:id/quote-price-negotiation`, `…/customers/:id/quote-price-negotiation`,
  `GET /api/v1/quote-requests/price-negotiation`), PDF zapytania ofertowego
  (`/api/v1/admin/quote-requests/:id/pdf`, `…/pdf/send`, `…/document-templates`,
  `…/document-template`), macierz cen (`/api/v1/admin/price-lists-engine/:id/matrix`) i dodawanie
  zbiorcze (`…/:id/products/bulk-add`), zapisane widoki
  (`/api/v1/admin/catalog/products/list-views`, `/api/v1/admin/quote-requests/list-views`),
  preferencje push (`GET`/`PUT /api/v1/storefront/pwa/preferences`), wyszukiwanie globalne
  (`/api/v1/admin/global-search…`), tłumaczenie w Page Builderze
  (`/api/v1/admin/cms/page-builder/translat…`), `?currency=` w odczytach katalogu oraz
  `salesChannelId` w `GET /api/v1/admin/products/:id/resolved-price`, który teraz odpowiada `404`
  dla kupującego, który nie istnieje albo którego przedstawiciel handlowy nie może widzieć.
- **Zapisane widoki zamówień.** Pozycje mają `ownedByCaller` i `canModify`; nazwa zajęta przez inny
  widok właściciela daje `409 ORDER_SAVED_VIEW_NAME_TAKEN`; `PATCH`, który niczego nie zmienia,
  niczego nie zapisuje; identyfikator, który nie jest UUID, daje `404`; brak sesji administratora
  daje `401`.

#### Dla autorów modułów i modułów nakładkowych {#after-0-107-0-authors}

**Zadeklaruj jako otwartą dla reguły dostępu do kanału każdą trasę, do której odwiedzający dociera
przed zalogowaniem albo która przychodzi bez kanału storefrontu.** Dotyczy to tras logowania,
rejestracji i odzyskiwania konta, linków w e-mailach, pobierania plików produktowych i — przypadku
najłatwiejszego do przeoczenia — **wywołań zwrotnych dostawców płatności i przewoźników oraz
adresów powrotu od dostawców**:

```ts
app.post(
  '/api/v1/payments/acme/notify',
  { config: { salesChannelAccess: 'open' } },
  async (request, reply) => {
    // Still resolved to a channel, and still behind this route's own guards.
  },
);
```

Bez tego trasa dostaje `403` w chwili, gdy operator zamknie kanał, do którego jest przypisywana — dla
wywołania zwrotnego jest to domyślny kanał systemowy. Opcja jest otypowana w `FastifyContextConfig`
Fastify przez barrel `./http` platformy. Pomija tylko krok dostępu: trasa nadal jest przypisywana do
kanału i zachowuje własne warunki dostępu. Nie deklaruj jej na niczym, co pokazuje lub zmienia
katalog, ceny, koszyk lub zamówienia sklepu. `SalesChannelAccessPort` (`salesChannelAccessPort`,
`./kernel`) rozstrzyga regułę dla ścieżki, która nie ma jeszcze sesji. Zobacz
[Dostęp do kanału: trasy, które muszą pozostać otwarte](./modules/sales_channels/developer-guide.md#dostęp-do-kanału-trasy-które-muszą-pozostać-otwarte).

**Zmiany, po których kod się nie kompiluje albo nie składa.** Kod, który implementuje, konstruuje lub
wywołuje którykolwiek z poniższych elementów, wymaga zmiany:

| Co | Zmiana |
| --- | --- |
| `CartCustomerContext` (`@endora-commerce/contracts`) | `salesChannelId` jest **wymagane**: każdy wywołujący `CartReadPort` / `CartWritePort` wskazuje kanał, o którego koszyk chodzi |
| `PersonalOrganizationProvisionInput` (`@endora-commerce/mod-organizations/ports`) | wymagane `salesChannelId: string \| null` |
| `CatalogProductReadPort` | nowa wymagana metoda `listProductIdsByAttributeValue({ key, value, match })` |
| `OrderReadPort` | nowa wymagana metoda `findStatusDefinition(code)` |
| `DocumentRenderPort` | nowa wymagana metoda `listChoices({ documentType, salesChannelId })` |
| `CartPlacementApplyPort` (`@endora-commerce/mod-carts/ports`) | nowe `findPriceDrift` i `refreshLinePrices` |
| `CartService` | nowy wymagany argument konstruktora `ProductDisplayModePort` po `channelMembership`; `getOrCreateForAnon(em, token, salesChannelId)` zwraca `Cart \| null` |
| `CartsDeps` | `cartCouponService`, `cartConversionService`, `pushLineToShoppingList` i `appendShoppingListToCart` są wymagane |
| `PriceListTargetReads` | wymagane `catalogAttributeRead` — dla ręcznie budowanego `PriceListService` lub `PricingService` |
| `MfaModuleOptions` | wymagane `customerChannelAccess` |
| `AnalyticsIngestService.ingest` | wymagany `context` (`IngestContext`) |
| `customerOrgResolver` (`mod-customer-accounts`) | odpowiada `{ organizationId, active }` lub `null`; aktualizuj razem z nim `mod-auth` |
| `customerSocialLoginPort` | `resolveByEmail` odpowiada `{ id, organizationId, blocked }`, `autoCreate(email, { salesChannelId })` odpowiada `{ id, organizationId }` |
| `AssetSummary`, `AssetDetail`, `AssetRecord` | nowe wymagane pola (`fileUrl`, `permalink`, `permalinkUrl`, `contentVersion`; `retentionDays`, `replaceable`) dla kodu, który je buduje |
| `OrderSavedView` | wymagane `ownedByCaller` i `canModify` dla kodu, który go buduje |
| `buildServer` | nie montuje już tras opisu API; w procesie czytaj `app.apiDescription()`, a `registerOpenApiRoutes` usunięto |

**Nowe porty i punkty styku.** `BuyerLinePricePort` (`buyerLinePricePort`, z `price_lists`) — cena
jednostkowa netto, jaką kupujący zapłaciłby za każdą pozycję w kanale; `ProductDisplayModePort`
(`productDisplayModePort`); `MfaDeactivationGuardPort`; `CustomerAuthenticationThrottlePort` oraz,
w `./kernel`, `AuthenticationAttemptThrottle`; `AdminSearchProviderRegistryPort`
(`adminSearchProviderRegistry`) — dodaj dostawcę z haka startowego, który tylko wnosi wkład, aby
rekordy modułu dało się znaleźć; `DocumentTypeRegistryPort` (`documentTypeRegistry`) i
`DocumentRenderPort` (`documentRenderPort`) — rejestracja typu dokumentu i jego generowanie;
`AdminRolePort.upsertByCode(input, { grantor })` — przekaż `grantor` dla zapisu wykonywanego w
imieniu administratora; `createLlmAdapter` z `@endora-commerce/llm-client`, przeniesiony z
`mod-prompt-actions`. `BlockDefinition` zyskuje opcjonalne ścieżki `translatable`, a blok bez nich
nigdy nie jest wysyłany do modelu. Pole poświadczenia, które wskazuje, dokąd wysyłane są sekrety,
deklaruje `endpoint: true`, chyba że jest polem `format: 'url'`, które liczy się domyślnie.

**`order.cancelled.v1` jest emitowane**, a jego treść rośnie z `{ orderId }` do `orderId`,
`organizationId`, `salesChannelId`, `from`, `actor`, `reason` i `businessId`. Pozostaje na
wewnątrzprocesowej szynie zdarzeń; webhooki wychodzące nadal dostarczają anulowanie jako
`order.status_changed.v1`.

**Admin kit.** `ProductBrowserDialog`, `ProductBrowserTrigger` i `productSelectability`;
`ModalDialog` i `SavedViewsControl`; `AssetUploader` zyskuje `upload` i `accept`. Ich teksty są w
pakiecie `core` modułu `@endora-commerce/mod-i18n` w tym wydaniu.

**Zależności równorzędne.** `mod-quote-requests` deklaruje `@fastify/rate-limit` (`^10`), które host
platformy już rejestruje; `mod-cms` i `mod-prompt-actions` deklarują `@endora-commerce/llm-client`,
który pnpm instaluje razem z nimi, tak jak inne zależności równorzędne.

#### W istniejącym storefroncie {#after-0-107-0-storefront}

**Istniejący storefront nie zmienia się przez aktualizację.** `endora new storefront` kopiuje
wzorzec raz, a potem projekt należy do Ciebie; aktualizacja przenosi jego pakiety, których poniższe
pliki potrzebują w wersji `0.107.0`. Dopóki jego pliki nie zostaną zaktualizowane, działa z
zaktualizowanym backendem w sklepie otwartym dla niezalogowanych odwiedzających: katalog, koszyk,
zamówienie i logowanie działają jak wcześniej, w granicach podanych przy każdej grupie. To, czego
nie robi, opisano przy każdej grupie. Storefront do kopiowania utwórz tak, jak opisuje
[Bloki modułów w istniejącym storefroncie](#storefront-block-renderers), i przejmuj grupy w tej
kolejności. Tam, gdzie edytowano plik, nanieś jego różnicę ręcznie; `diff -ru` między Twoim
storefrontem a nowym pokazuje każdą różnicę obok Twoich własnych zmian. Kilka plików należy do więcej
niż jednej grupy — nową wersję weź raz.

**1. Dostęp do kanału sprzedaży — wymagany, zanim jakikolwiek kanał zostanie zamknięty dla
niezalogowanych odwiedzających, oraz w storefroncie, który obsługuje kilka kanałów przez
`X-Sales-Channel`.** Storefront wskazuje swój kanał w każdym wywołaniu backendu, kieruje
odwiedzającego zamkniętego sklepu na stronę logowania, pokazuje odmowę logowania i ekran braku
dostępu oraz przestaje oferować rejestrację klienta indywidualnego w zamkniętym sklepie. Bez tego
zamknięty sklep odpowiada na wywołania stron storefrontu `403`, a klient z odmową nie ma ekranu,
który mówi dlaczego.

- **nowe**: `components/ChannelAccessDenied.tsx`, `lib/api/channel-headers.ts`,
  `lib/auth/sign-in-errors.ts`, `lib/channel/channel-header.ts`, `lib/channel/channel-identity.ts`,
  `lib/channel/closed-store.ts`, `lib/actions/sign-out.ts`, `lib/dictionary/browser.ts`,
  `lib/dictionary/types.ts`, `components/account/SignOutButton.tsx`, `lib/cart-action-failure.ts`;
- **zmienione**: `middleware.ts` — oznacza `x-sales-channel` kanałem, który backend wyznacza dla
  tego storefrontu, gdy nie zrobiło tego proxy, i kieruje odwiedzającego zamkniętego sklepu do
  logowania; `app/layout.tsx`, `app/page.tsx`, `app/sitemap.ts`, `app/globals.css`;
  `app/(auth)/login/page.tsx`, `app/(auth)/login/mfa/page.tsx`,
  `app/(auth)/register-customer/page.tsx`; `app/(catalog)/c/[slug]/page.tsx`,
  `app/(catalog)/catalog/page.tsx`, `app/(catalog)/p/[slug]/page.tsx`,
  `app/(catalog)/search/page.tsx`; `app/compare/page.tsx`, `app/compare/share/[token]/page.tsx`;
  `app/pwa/subscriptions/route.ts`; komponenty `CompareToggle`, `ComparisonTable`, `Header`,
  `MfaCodeForm`, `ProductCard`, `ProductCardActions`, `ProductGrid`, `SearchAutocomplete`,
  `SharedComparisonTable`, `SocialLoginButtons`, `analytics/AnalyticsProvider`,
  `analytics/GtmProvider`, `inventory/NotifyWhenAvailableDialog` i `mobile/MobileSearchOverlay`;
  oraz w `lib/`: `analytics/gtag.ts`, `analytics/gtm/dataLayer.ts`, `api/cart.ts`, `api/client.ts`,
  `api/comparisons.ts`, `api/mutations.ts`, `api/newsletter.ts`, `api/pwa-server.ts`, `api/rfq.ts`,
  `api/sales-channel.ts`, `api/search.ts`, `api/speculation-rules.ts`,
  `dictionary/DictionaryProvider.tsx`, `dictionary/client.ts`, `i18n/messages.ts` i
  `server-context.ts`. Ta sama zmiana dotyka `lib/seo/crawler-policy.ts` i
  `lib/seo/crawler-file-response.ts`, które istnieją tylko w storefroncie, który przejął grupy SEO z
  wydania 0.106.0; grupa 2 je zastępuje.

Wzorzec pilnuje statycznym testem, by każde wywołanie backendu przechodziło przez pomocnika kanału;
jeśli utrzymujesz testy storefrontu z `test/`, skopiuj je razem z plikami.

**2. Pliki dla robotów w zamkniętym sklepie — zakłada trzy grupy SEO z wydania
[0.106.0](#after-0-106-0-storefront) i grupę 1 powyżej.** Zastąp `lib/seo/crawler-policy.ts`,
`lib/seo/crawler-file-response.ts`, `lib/seo/robots-txt.ts`, `lib/seo/llms-txt.ts` i
`lib/seo/llms-txt-base.ts` oraz dodaj nową funkcję `renderClosedStoreRobotsTxt` do
`lib/seo/robots-system-rules.ts` — reszta tego pliku, `ROBOTS_SYSTEM_RULES` z ewentualnymi Twoimi
regułami, się nie zmienia. W zamkniętym sklepie `robots.txt` zabrania wtedy wszystkiego i nie wskazuje
mapy strony, a `llms.txt` podaje nazwę sklepu i mówi, że treść jest tylko dla zalogowanych klientów;
własne instrukcje i dodatkowa treść operatora są zachowane i wracają po otwarciu sklepu. Pliki
otwartego sklepu się nie zmieniają.

**3. Limity logowania klientów.** `lib/session.ts`, `lib/api/auth.ts`, `lib/api/mfa.ts` i
`app/(auth)/password-reset/request/page.tsx`: storefront przekazuje plik cookie `b2b_customer_device`
przy logowaniu, drugim kroku i prośbie o reset oraz zachowuje ten, który ustawia backend. Bez nich
każda próba jest liczona według limitu urządzenia, na którym konto się nie logowało.

**4. Wybór powiadomień push i wylogowanie.** `app/(account)/account/page.tsx`,
`app/(account)/layout.tsx`, `components/account/SignOutButton.tsx`,
`components/pwa/PushNotificationsToggle.tsx` (nowy), `components/pwa/PushPreferencesForm.tsx`
(nowy), `components/pwa/PushOptIn.tsx`, `lib/api/pwa.ts` i `lib/api/pwa-server.ts`. Profil konta
zyskuje wybór powiadomień o zamówieniach i ofertach oraz przełącznik wyłączający powiadomienia;
wylogowanie zwalnia subskrypcję push przeglądarki. Bez nich klient dostaje obie kategorie, które
oferuje operator.

**5. Blokada negocjacji cen w szkicu zapytania ofertowego.** `app/(commerce)/quote-request/actions.ts`,
`app/(commerce)/quote-request/page.tsx`, `components/rfq/RfqDraftView.tsx` i `lib/api/rfq.ts`. Bez
nich klient z zablokowanymi propozycjami widzi pole propozycji i dostaje `422` przy wysłaniu
propozycji.

**6. Mniejsze poprawki.** `app/(commerce)/checkout/page.tsx` — strona błędu pokazuje zdanie
backendu, także dla `CART_PRICE_CHANGED`, bez kodu na początku; `app/(catalog)/p/[slug]/page.tsx`,
`lib/cart-action-failure.ts` i `lib/i18n/messages.ts` — strona produktu opisuje błędy koszyka w
języku kupującego; `app/compare/page.tsx`, `components/ComparisonTable.tsx` i
`lib/api/comparisons.ts` — PDF porównania jest zamawiany w wyświetlanym języku i z wyświetlanymi
wierszami; `lib/api/catalog.ts` — odczyty katalogu w wybranej walucie; `components/Breadcrumbs.tsx`
i `app/(catalog)/p/[slug]/page.tsx` — dane strukturalne produktu i ścieżki nawigacji renderowane
przez `JsonLd`.

Następnie uruchom `pnpm run typecheck`, `pnpm test` i `pnpm run build` i usuń katalog, z którego
kopiowano. **Własny storefront**, który nie wywodzi się ze wzorca, musi zrobić trzy rzeczy, aby
działać z zamkniętym sklepem: wskazywać swój kanał w każdym wywołaniu backendu, także z
przeglądarki; kierować odwiedzającego do logowania przy `403 SALES_CHANNEL_SIGN_IN_REQUIRED`; oraz
pokazywać `403 SALES_CHANNEL_NOT_PERMITTED`, odczytując z
`GET /api/v1/storefront/sales-channel/access` sklepy, z których klient może korzystać.

Jak dalece to sprawdzono: to, co mówi ta sekcja, pochodzi z opisów zmian (changesetów) wydania,
sprawdzonych ze źródłami tego wydania — manifestami, migracjami, trasami i historią wzorcowego
storefrontu między `v0.106.0` a `0.107.0`. W chwili pisania tej sekcji żadna instancja nie została
zaktualizowana z `0.106.0` poleceniem `pnpm run upgrade 0.107.0`, do żadnej instancji deklarującej
`mod-invoices` nie dodano po aktualizacji `mod-document-templates` i w żadnym storefroncie
utworzonym we wcześniejszym wydaniu nie wprowadzono powyższych grup plików; kolejność kroków i
zmiany w storefroncie nie były wypróbowane.

### Po aktualizacji do wydania 0.108.0 {#after-0-108-0}

`pnpm run upgrade 0.108.0` przenosi pakiety wydania z `0.107.0` i wykonuje jego migracje —
dwadzieścia dwie, z czego dwanaście dotyczy nowego modelu cen i jego edytora. **Wydanie zastępuje
sposób przechowywania i wyliczania cen w jednym kroku, bez okresu zgodności**: cenniki wcześniejszych
wydań, z ich regułami stosowania (Application rule), listami produktów i przedziałami ilościowymi,
stają się **cennikami w nowym modelu**, a produkt nie ma już własnej ceny. Ceny bazowe, które
instancja naliczała z cennika *Default*, zostają zachowane; **każdy inny cennik aktualizacja
usuwa** i nic go nie przenosi — jedynym wyjątkiem jest cennik, do którego przypięty jest feed
produktowy: zostaje jako pusty, wygasły cennik (krok 3). Przeczytaj poniższe kroki, zanim uruchomisz polecenie. Ta sekcja
opisuje zmianę cen; pozostałe zmiany wydania są w dziennikach zmian poszczególnych pakietów. Mówi,
co zrobić i w jakiej kolejności, a potem — co działa inaczej dla
[operatorów](#after-0-108-0-operators),
[klientów API i integratorów](#after-0-108-0-api),
[autorów modułów i modułów nakładkowych](#after-0-108-0-authors) oraz właściciela
[istniejącego storefrontu](#after-0-108-0-storefront). Sam model opisuje strona
[Cenniki](./modules/price_lists.md), a pełną listę tego, co usunięto, wraz z zamiennikami —
[uwaga migracyjna](./modules/price_lists/developer-guide.md#upgrading-from-the-old-model-migration-note)
w przewodniku dla deweloperów.

#### Co zrobić i w jakiej kolejności {#after-0-108-0-steps}

Przed aktualizacją:

1. **Zapisz każdy cennik inny niż *Default*: jego ceny, kogo wyceniał i w których kanałach.**
   `Migration20261022T111815PriceListsPriceBooksConversion` usuwa każdy cennik z regułą stosowania —
   kontrakty grup klientów i organizacji, promocje, cenniki katalogowe — razem z listą produktów,
   przedziałami, regułą i pozycjami macierzy cen, a potem usuwa stare tabele. Cennik, do którego
   przypięty jest feed produktowy, zostaje zamiast tego wycofany z użycia (krok 3), ale jest pusty,
   więc jego ceny i tak przepadają. To, co wyceniały, trzeba po aktualizacji wprowadzić ponownie jako
   cenniki; kopia bazy danych z
   [Zanim zaczniesz](#zanim-zaczniesz) jest jedyną kopią tych wierszy.
2. **Zapisz cenę każdego produktu, który ma *Default unit price*, ale nie ma wiersza w cenniku
   *Default*.** `Migration20261022T111811CatalogPriceFieldsRemoved` usuwa `defaultPrice` i `price`
   z wartości atrybutów każdego produktu oraz kolumnę `product_variants.price_override`; żadne z nich
   nie jest przenoszone. Produkt wyceniany tylko przez *Default unit price* po aktualizacji **nie ma
   ceny** — koszyk odrzuca go z kodem `422 CART_PRODUCT_UNPRICED` — dopóki nie wpisze się dla niego
   ceny bazowej. *Price override* wariantu nigdy nie był naliczany, więc jego usunięcie nie zmienia
   żadnej ceny.
3. **Feed produktowy przypięty do cennika innego niż *Default*: nic nie trzeba robić.** Feed
   produktowy przypięty do cennika, który aktualizacja usuwa, pozostaje przypięty do wycofanej kopii
   tego cennika: pustego, wygasłego cennika dla wszystkich, bez kanału sprzedaży i z tym samym id, o
   nazwie `<name> (removed by the 0.108.0 upgrade)` (dawna nazwa jest skracana tak, by całość
   mieściła się w 200 znakach). Strona feedu ostrzega, że jego cennik nie jest aktywny, a następne
   generowanie feedu wycofuje opublikowany plik, więc link odpowiada tak, jakby feed nigdy nie
   został wygenerowany — dopóki nie przypniesz feedu do cennika, który obowiązuje, albo go nie
   odepniesz (krok 9). Wycofany cennik możesz usunąć, gdy przestanie być potrzebny; feed nadal do
   niego przypięty ostrzega wtedy, że jego cennik już nie istnieje.
4. **Jeśli Twoja integracja zapisuje ceny przez `priceListAdminPort`** — zwykle import cen
   konektora PIM — przygotuj jej nową wersję: port został usunięty, a zastępuje go
   `priceBookWritePort`. Konektor zbudowany dla starego portu nie może w tym wydaniu zapisywać cen.
   Odpowiedniki metoda po metodzie są w
   [uwadze migracyjnej](./modules/price_lists/developer-guide.md#upgrading-from-the-old-model-migration-note)
   przewodnika dla deweloperów.

Sama aktualizacja:

5. **Uruchom `pnpm run upgrade 0.108.0`.** `setup` wykonuje migracje moduł po module, w kolejności
   zależności modułów, a migracje jednego modułu — w kolejności ich znaczników czasu; dlatego każda
   migracja `catalog`, w tym usunięcie pól cen, wykonuje się przed konwersją. Według modułów:

   | Migracja | Moduł | Co robi |
   | --- | --- | --- |
   | `Migration20261016T082008CatalogOrderRules` | `catalog` | `products.min_order_quantity`, `products.returnable`, `product_packaging_units.min_order_units` |
   | `Migration20261022T111811CatalogPriceFieldsRemoved` | `catalog` | Usuwa `product_variants.price_override`, `defaultPrice` i `price` — zob. krok 2 |
   | `Migration20261022T182523CatalogAdminNameKeys` | `catalog` | Zapisane, zindeksowane klucze nazwy i wyszukiwania w panelu na `products` oraz rozszerzenie `pg_trgm` |
   | `Migration20261019T103522CustomFieldsDefinitionListFilter` | `custom_fields` | `custom_field_definitions.list_filter`, `false` dla każdego istniejącego pola |
   | `Migration20261020T110920CustomFieldsDefinitionCarryTo` | `custom_fields` | `custom_field_definitions.carry_to`, puste dla każdego istniejącego pola |
   | `Migration20261016T082022OrdersOrderItemReturnableAtPurchase` | `orders` | `order_items.returnable_at_purchase`, może być `null` |
   | `Migration20261020T172007OrdersOrderItemGroups` | `orders` | Tabela `order_item_groups`, `order_items.group_id` i `position` |
   | `Migration20261021T164807OrdersOrderCommentSystemNote` | `orders` | `order_comments.system_note`, może być `null` |
   | `Migration20261021T165247OrdersOrderItemsPriceSource` | `orders` | `order_items.price_source`, może być `null` |
   | `Migration20261018T122118QuoteRequestsItemPackagingUnitId` | `quote_requests` | `quote_request_items.packaging_unit_id`, może być `null` |
   | `Migration20261020T171341QuoteRequestsQuoteRequestItemGroups` | `quote_requests` | Tabela `quote_request_item_groups`, `quote_request_items.group_id` i `position` |
   | `Migration20261021T164808QuoteRequestsQuoteRequestEventCarrySkipped` | `quote_requests` | Dopuszcza typ zdarzenia `custom-field-carry-skipped` |
   | `Migration20261020T131018PwaPreferencesOrganizationAttributionCheck` | `pwa` | Ograniczenie `CHECK` na `push_notification_preferences` |
   | `Migration20261021T165244CartsCartItemsPriceSource` | `carts` | `cart_items.price_source`, może być `null` |
   | `Migration20261023T195611ProductFeedsRunWithdrawalReason` | `product_feeds` | `product_feed_runs.withdrawal_reason`, może być `null` — dla generowania, które wycofało opublikowany plik |
   | `Migration20261023T234605ProductFeedsPriceListFkDropped` | `product_feeds` | Usuwa `product_feeds_price_list_fk`, więc wycofany cennik można później usunąć; wykonuje się po konwersji |
   | `Migration20261021T165239PriceListsPriceBooksExpand` | `price_lists` | Nagłówek cennika, zbiory odbiorców i kanałów, rozszerzone wiersze, wersja kolejności 1, tabele powierzchni cen |
   | `Migration20261021T232310PriceListsPriceBooksVersion` | `price_lists` | `price_lists.version` i `ever_activated` |
   | `Migration20261022T012134PriceListsPriceSurfaceGenerations` | `price_lists` | Generacje powierzchni cen |
   | `Migration20261022T111815PriceListsPriceBooksConversion` | `price_lists` | Konwersja — zob. krok 1 i niżej |
   | `Migration20261022T182527PriceListsProductLines` | `price_lists` | Tabela `price_list_product_lines`, wypełniona na podstawie zapisanych wierszy |
   | `Migration20261023T152351PriceListsPriceSurfaceTargetedMarks` | `price_lists` | Tabela `price_profile_stale_products` i `price_profiles.revision` do odświeżania powierzchni cen tylko tam, gdzie to potrzebne |

   Konwersja wykonuje się w jednej transakcji: tworzy jeden **cennik cen bazowych** na każdą walutę
   użytą w przedziale cennika *Default* oraz na domyślną walutę platformy; zamienia każdy przedział
   cennika *Default* w stały wiersz cennika cen bazowych swojej waluty; usuwa każdy inny cennik
   poza tym, do którego odwołuje się jeszcze inna tabela — przypięty feed — który wycofuje z użycia
   jako pusty, wygasły cennik z tym samym id (krok 3);
   usuwa stare tabele i kolumny. `Migration20261022T182523CatalogAdminNameKeys` dodaje do
   `products` cztery kolumny generowane, a każda z nich przepisuje tabelę pod blokadą wyłączną —
   w pomiarze platformy 3,5–7 s na kolumnę przy 50 000 produktów — co jest jeszcze jednym powodem,
   by API pozostało zatrzymane.

Po aktualizacji, zanim instancja znów przyjmie ruch:

6. **Upewnij się, że działa konsument kolejek.** Listy sortowane i filtrowane według ceny są
   porządkowane według cen, które z wyprzedzeniem wylicza worker `price_lists.surface`; działa on w
   procesie, który obsługuje kolejki (`BACKEND_ROLE` nieustawione, `all` albo `worker`) i ma
   połączenie Redis dla kolejek — [Konsumenci kolejek](./operations/queue-consumers.md).
   Aktualizacja niczego nie buduje: pierwsze żądanie sortowane według ceny w każdym kanale
   sprzedaży i walucie rejestruje to, czego potrzebuje, i zleca to workerowi, a do czasu, aż worker
   to zbuduje, dostaje domyślny porządek katalogu — z poprawnymi cenami na kartach produktów. Bez
   konsumenta sortowanie według ceny nigdy nie porządkuje według ceny.
7. **Sprawdź ceny bazowe.** Otwórz zakładkę *Pricing* kilku produktów: ceny pochodzące z cennika
   *Default* są tam, dla każdej waluty. Wpisz cenę bazową każdego produktu z kroku 2.
8. **Utwórz ponownie cenniki**, które zastępują cenniki z kroku 1, w **Cennikach** (`/price-lists`
   albo ⌘K / CTRL+K → *Cenniki*). Cennik ma jedną walutę, zbiór kanałów sprzedaży, odbiorców —
   wszystkich, wybrane grupy klientów albo wybrane organizacje — i linie; niczego nie wycenia,
   dopóki nie zostanie aktywowany. *Wyjaśnienie ceny* (`/price-lists/explain`) pokazuje dla
   kupującego i produktu, która linia zdecydowała o cenie.
9. **Przypnij ponownie feedy z kroku 3 albo je odepnij** przez API feedów produktowych
   (`PATCH /api/v1/admin/product-feeds/:id` z `priceListId` — id cennika albo `null`); w panelu nie
   ma jeszcze do tego kontrolki (zgłoszenie #414). Przypnij każdy do cennika, który obowiązuje
   kogokolwiek w kanale feedu: *Aktywny* albo *Zaplanowany* w swoich datach, przypisany do kanału feedu i dla wszystkich. Feed przypięty do
   każdego innego cennika nie publikuje z niego żadnych cen — strona feedu mówi dlaczego — a jego
   następne generowanie kończy się stanem *Wycofany* i wycofuje opublikowany plik, więc link
   odpowiada tak jak dla feedu nigdy niewygenerowanego, dopóki cennik znów nie zacznie obowiązywać.
   Wycofanie nie jest błędem: nie wywołuje powiadomienia i niczego nie dostarcza.

W dowolnym momencie:

10. **Nadaj `catalog:read` każdej roli, która ma `price_lists:write`.** Dodawanie linii produktów do
    cennika korzysta z przeglądarki produktów katalogu, którą chroni `catalog:read`; edytor ról w
    *Admin roles* (`/admin-roles`) pokazuje brak dla roli, która go nie ma, z dodaniem jednym
    kliknięciem. Oba kody uprawnień cenników się nie zmieniły; ich etykiety brzmią teraz *View price
    books and display modes* oraz *Edit price books, base prices and display modes*.
11. **W instancji z danymi sklepu demonstracyjnego** uruchom `pnpm run cli demo reset`, a potem
    `pnpm run cli demo seed`: konwersja usunęła dawne cenniki wersji demonstracyjnej, a ponowne
    wczytanie przywraca jej ceny bazowe i cenniki przykładów ze strony
    [Cenniki](./modules/price_lists.md).

#### Dla operatorów {#after-0-108-0-operators}

- **Cenniki działają w nowym modelu.** Pozycja paska bocznego *Cenniki* otwiera listę cenników; pole
  *Default unit price* w edytorze produktu, kolumna *Price override* w tabeli wariantów i strefa
  *Linked price lists* produktu zniknęły, a ceny bazowe produktu są w jego zakładce *Pricing*.
  *Ustawienia cenowe* (⌘K / CTRL+K) zawierają tryby prezentacji, przełącznik pokazywania ceny
  katalogowej obok ceny kupującego (`pricing.show_list_price`, domyślnie wyłączony) i kolejność cen,
  tylko do odczytu.
- **Jak ustalana jest cena** — cena bazowa, cena katalogowa dla wszystkich w kanale, cena
  kontraktowa kupującego i cena promocyjna naliczana tylko wtedy, gdy jest niższa — opisuje strona
  [Cenniki](./modules/price_lists.md), z przykładami.
- **Zmiana ceny pojawia się na liście sortowanej według ceny w ciągu około pół sekundy** w
  pomiarach platformy; zmiana, która sięga całego katalogu — linia dla wszystkich produktów albo
  tylko dla wartości atrybutu, ponad 10 000 produktów naraz, zmiana kanału sprzedaży — trwa do około
  pięciu minut przy mniej więcej 200 grupach kupujących z własnymi cennikami (zmierzono około 4 min 35 s
  przy 201; przyspieszenie opisuje zgłoszenie #416). Ceny na kartach produktów nigdy
  się nie opóźniają.
- **Import produktów odrzuca plik z kolumną ceny** — `default_price`, `defaultPrice`, `price`,
  `price_override` albo `priceOverride` — z kodem `400 PRICE_SET_IN_PRICE_BOOKS` i niczego nie
  importuje. Ceny importuje się przez import CSV cenników albo konektorem PIM przez
  `priceBookWritePort`.

#### Dla klientów API i integratorów {#after-0-108-0-api}

- **Dawne trasy cen w API administracyjnym zostały usunięte**: `/api/v1/admin/price-lists-engine/…`,
  `/api/v1/admin/pricing/rule-targets/…`, `/api/v1/admin/products/:id/price-lists` i
  `/api/v1/admin/products/:id/resolved-price`. Zastępuje je `/api/v1/admin/price-books/…`:
  `GET ?productId=` dla cenników produktu i `POST /api/v1/admin/price-books/resolve` dla wyliczonej
  ceny z wyjaśnieniem.
- **Zapis katalogu, który podaje cenę, jest odrzucany**: `POST`/`PATCH
  /api/v1/admin/catalog/products[/:id]` z `attributeValues.defaultPrice` albo
  `attributeValues.price` oraz zapis wariantu z `priceOverride` zwracają
  `400 PRICE_SET_IN_PRICE_BOOKS` i niczego nie zapisują. Ceny bazowe zapisuje się przez
  `PUT /api/v1/admin/price-books/base-prices/:productId`.
- **`GET /api/v1/storefront/products/:id/resolved-price` uczciwie opisuje produkt bez ceny**:
  `baseListId`, `basePrice` i `quantityBracket` mają wszystkie wartość `null`, podczas gdy wcześniej
  `baseListId` był pustym tekstem. Kwoty są tekstami dziesiętnymi
  (`{ "amount": "199.0000", "currency": "PLN" }`), tak jak trasa zawsze je wysyłała. Odpowiedź
  zawiera też `source` (który krok wycenił produkt), `compareAt` oraz — gdy sklep ją pokazuje —
  `listPrice`.
- **Kody błędów macierzy cen zniknęły** (`PRICE_MATRIX_ENTRY_NOT_FOUND`,
  `PRICE_MATRIX_ENTRY_OVERLAP`, `PRICE_MATRIX_ATTRIBUTE_NOT_ELIGIBLE`, `PRICE_MATRIX_ENTRY_LIMIT`);
  zastępują je kody cenników, `PRICE_BOOK_*` i `PRECEDENCE_CHANGE_UNAVAILABLE`.
- **Feed produktowy przypięty do cennika** publikuje tylko wtedy, gdy cennik jest *Aktywny* albo
  *Zaplanowany* w swoich datach, w kanale feedu i dla wszystkich. Generowanie feedu, którego cennik
  nie obowiązuje, kończy się nowym stanem `withdrawn` z `withdrawalReason` (powód; `null` w każdym
  innym generowaniu), czyści opublikowany plik, a publiczny URL odpowiada `404`; klient, który
  obsługuje wyczerpująco każdy stan generowania, ma jeden przypadek więcej. Kod błędu
  `price_list_unavailable`, którego nic nie zgłaszało, został usunięty. Feed w API administracyjnym (`GET /api/v1/admin/product-feeds`, `GET …/:id`)
  zawiera `pinnedPriceBookWarning`: powód, dla którego cennik nie jest publikowany, albo `null`.

#### Dla autorów modułów i modułów nakładkowych {#after-0-108-0-authors}

- **`priceListAdminPort` został usunięty; zastępuje go `priceBookWritePort`** — ceny bazowe dla
  każdej waluty, wskazywane produktem i walutą zamiast id cennika, zapisywane jednym audytowanym
  poleceniem.
- **`@endora-commerce/contracts` nie zawiera już reguły stosowania ani dawnych kształtów cennika,
  przedziałów i macierzy**, `ListingPrice` traci wariant `source: 'product'`, a `PriceListRecord` /
  `PriceListReadPort` mają nowy kształt dla cenników. Każde usunięcie jest wymienione razem z
  zamiennikiem w dzienniku zmian pakietu.
- **Moduł nakładkowy, który dekoruje `pricingService`,** musi dekorować także zbiorcze punkty
  wejścia (`resolveLinePrices`, `resolveListingPrices`), a nie tylko pojedyncze wywołania; koszyk,
  kontrola przy składaniu zamówienia i ceny referencyjne zapytań wyceniają przez partię.
- **Moduł, którego zdarzenia decydują o cenie,** podbija `PricingGeneration` jak dotąd;
  `bump(change?)` przyjmuje teraz `SurfaceChange`, który mówi, co zmiana przesunęła, a podbicie bez
  niego sprawia, że powierzchnia cen przebudowuje każdy profil.
- **Własny port wyceny feedów** musi implementować `namedListPublishability` obok
  `namedListPrices`, która przyjmuje teraz `salesChannelId` feedu.

#### W istniejącym storefroncie {#after-0-108-0-storefront}

Trasy cen, które wywołuje storefront, zachowują swoje ścieżki, więc storefront utworzony we
wcześniejszym wydaniu nadal pokazuje ceny. Czego nie pokazuje, dopóki nie przeniesie się do niego
plików ze storefrontu wydania: własnej ceny wybranego wariantu na stronie produktu, ceny promocyjnej
pokazanej jako przekreślona cena katalogowa obok *Twojej ceny*, ceny kupującego jako ceny
porównawczej na kartach produktów i ceny katalogowej obok niższej ceny kupującego. Te pliki to
`app/(catalog)/p/[slug]/page.tsx`, `app/page.tsx`, `components/ProductCard.tsx`,
`components/PriceTag.tsx`, `components/VariantPicker.tsx`, `components/SearchAutocomplete.tsx`,
`components/pricing/BaseSalePriceBlock.tsx`, `components/pricing/PdpPriceToggle.tsx`,
`lib/api/pricing.ts` (gdzie `ResolvedPrice.baseListId` ma teraz typ `string | null`) i teksty cen w
`lib/i18n/messages.ts`. Selektor wariantów wcześniejszego storefrontu pokazywał *Price override*
wariantu; to pole nie jest już wysyłane, więc selektor nie pokazuje ceny wariantu, dopóki nie
przeniesie się `VariantPicker.tsx`.

Tę sekcję napisano 23.10.2026 na podstawie gałęzi wydania zmiany cen
(`feat/160-pricing-model-v2`), sprawdzając ją z migracjami, manifestami, trasami i historią
wzorcowego storefrontu od `v0.107.0`. W chwili pisania żadna instancja nie została zaktualizowana
poleceniem `pnpm run upgrade 0.108.0`; kolejność kroków i zmiany w storefroncie nie były
wypróbowane.

## Instancja niespójna od początku

Instalator `0.101.x` lub starszy zapisywał każdy pakiet wydania z `^` poza
`@endora-commerce/contracts`. Uruchomiony po opublikowaniu nowszego wydania poprawkowego,
instalował to wydanie poprawkowe każdego pakietu poza `@endora-commerce/contracts`, który
zostawał przy starszym; instalacja wypisuje *unmet peer @endora-commerce/contracts* raz na moduł.
`pnpm run upgrade` — albo, przed tym poleceniem, dwa polecenia powyżej — ustawia wszystkie
pakiety na jedną wersję. Późniejsze instalatory zapisują każdy pakiet wydania dokładnie w wersji,
którą instalujesz, więc nowa instancja nigdy nie jest niespójna.

## Bez CLI

To, co robi polecenie, można zrobić ręcznie: w każdym `package.json` instancji i storefrontu
ustaw każdy pakiet `@endora-commerce/*` należący do wydania na nową wersję, zachowując `^`
i dokładne przypięcia; usuń `pnpm-lock.yaml` i uruchom `pnpm install` (co przesuwa też Twoje
pozostałe zależności w ramach ich zakresów); potem uruchom `pnpm run setup`, a w repozytorium
storefrontu `pnpm install`.
