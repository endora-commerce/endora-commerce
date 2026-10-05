---
title: Aktualizacja instancji
description: Przeniesienie instancji Endora Commerce i jej storefrontu z jednego wydania na następne jednym poleceniem — co zmienia, czego nie rusza, co uruchomić ponownie i co zrobić w instancji, której CLI nie zna jeszcze tego polecenia.
sidebar_position: 4
---

# Aktualizacja instancji

Instancja nie zawiera kopii platformy: platforma, powłoka panelu administracyjnego i każdy moduł
to pakiety, od których zależy. Aktualizacja polega na przeniesieniu **wszystkich pakietów
wydania** razem na nową wersję, zainstalowaniu ich i uruchomieniu własnego `setup` instancji —
który generuje pliki, buduje, wykonuje migracje i instaluje każdy moduł dodany w wydaniu.

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
  [Bloki modułów w istniejącym storefroncie](#storefront-block-renderers).

## Po zakończeniu

Na koniec polecenie wymienia, co uruchomić ponownie:

```bash
pnpm run start                                   # API i jego workery
pnpm run preview:admin                           # setup zbudował panel od nowa
cd ../my-shop-storefront && pnpm run build && pnpm run start
```

Zaloguj się i otwórz **Modules** (`/platform/modules`), żeby sprawdzić, że lista się wczytuje.
Moduł nowy w wydaniu nie zostaje dodany do Twojej instancji przez aktualizację: zadeklaruj go
przez `pnpm add`, a potem uruchom `pnpm run setup`, który go zainstaluje.

Jeśli po aktualizacji pnpm zgłasza *unmet peer* dla pakietu zewnętrznego, nowe wydanie podniosło
zakres, który Twój `package.json` wciąż ma niższy. Podnieś go tam do zakresu podanego
w ostrzeżeniu i uruchom `pnpm install`.

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
