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
ani widoczny na ekranie **Modules**. Żeby go mieć, zadeklaruj jego pakiet w głównym
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
