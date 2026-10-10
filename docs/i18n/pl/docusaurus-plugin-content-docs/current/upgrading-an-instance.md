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
tablicą, kalendarzem i analityką, w panelu administracyjnym. Instancja po aktualizacji go nie
ma — nie widać go na ekranie **Modules**, a `/crm/board` odpowiada *Page not found*. Żeby go
dodać, w katalogu głównym instancji:

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

**Zamówienie złożone w storefroncie jest zapisywane w kanale sprzedaży, w którym wykonano
żądanie.** `POST /api/v1/orders` brał dotąd kanał zamówienia z opcjonalnego pola `salesChannelId`
w treści żądania, a gdy go nie było — używał kanału domyślnego; teraz używa kanału rozpoznanego dla
żądania — `X-Sales-Channel`, `?salesChannel=`, mapa hostów, a w ostatniej kolejności kanał
domyślny — i odrzuca treść żądania, która wskazuje inny kanał. Co to oznacza, zależy od liczby
kanałów sprzedaży w instancji.

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

Przypisywanie kanałów sprzedaży wymaga `delivery_methods:write` / `payment_methods:write` i
niczego więcej; uprawnienia kanałów sprzedaży nie są potrzebne.

**Jeśli Twój własny moduł tworzy metodę dostawy lub płatności w swoim `installHook`**, funkcja
`bindToDefaultChannel` zniknęła z interfejsu tworzenia metod: usuń jej wywołanie po
`ensureMethodForAdapter`. Nic jej nie zastępuje — utworzona metoda jest dostępna w każdym kanale.
Źródła modułu nie skompilują się, dopóki tego nie zrobisz. Wcześniej opublikowana wersja modułu
nie jest kompilowana ponownie, więc zawiedzie później — błędem `TypeError` w `installHook`, gdy po
raz pierwszy będzie tworzyć swoją metodę — i trzeba ją wydać ponownie dla tego wydania.

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

Na ile zostało to sprawdzone: zachowanie backendu — kanał zamówienia, listę metod i odmowy —
nagłówek w każdym z siedmiu wywołań storefrontu oraz zmianę minimalnej wartości zamówienia w
instancji z jednym kanałem obejmują testy wydania. Powyższe zmiany w storefroncie naniesiono
dokładnie tak, jak je opisano, na cały katalog `storefront/` w postaci z wydania `0.104.0` —
siedem plików źródłowych i dwa pliki testów — po czym `tsc --noEmit` zakończył się powodzeniem, a
oba pliki testów przeszły; zrobiono to w repozytorium samej platformy, z pakietami tego wydania, a
nie w storefroncie utworzonym we wcześniejszym wydaniu, a ekranów panelu administracyjnego ani
składania zamówienia nie obejrzano w przeglądarce na instancji z dwoma kanałami.

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
