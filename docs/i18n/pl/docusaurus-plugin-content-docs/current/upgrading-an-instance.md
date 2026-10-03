---
title: Aktualizacja instancji
description: Przeniesienie instancji Endora Commerce i jej sklepu z jednego wydania na następne jednym poleceniem — co zmienia, czego nie rusza, co uruchomić ponownie i co zrobić w instancji, której CLI nie zna jeszcze tego polecenia.
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

- `@endora-commerce/contracts` jest w Twoim `package.json` przypięty do **dokładnej** wersji, żeby
  zawsze była zainstalowana tylko jedna jego kopia. `pnpm update` przesuwa wszystkie pozostałe
  pakiety, a ten zostawia, więc instalują się dwie kopie i pnpm wypisuje ostrzeżenie *unmet peer*
  dla każdego modułu.
- Przed `1.0.0` zakres `^0.101.0` kończy się poniżej `0.102.0`, więc `pnpm update` w ogóle nie
  sięga następnego wydania minor.
- Przepisuje zakresy Twoich pozostałych zależności — `"react": "^19"` staje się `"^19.3.0"` —
  i nigdy nie przesuwa pakietu, który pnpm zainstalował sam jako peer, na przykład
  `@endora-commerce/page-builder-core`.

## Zanim zaczniesz

- **Zrób commit**, żeby aktualizacja była jednym diffem do przeczytania i cofnięcia: `package.json`
  każdego członka, `pnpm-lock.yaml` i dwa takie same pliki sklepu.
- **Zrób kopię zapasową bazy danych.** `setup` wykonuje migracje nowego wydania, a migracje nie
  działają wstecz. Z tego samego powodu polecenie odmawia wersji starszej niż zainstalowana.
- **Zatrzymaj API i jego konsumentów kolejek**, żeby nic nie obsługiwało żądań w czasie zmiany
  schematu.
- **Podejrzyj wynik** poleceniem `pnpm run upgrade --dry-run`: każdy zakres, który by przesunęło,
  każdy wpis pliku blokady, który by usunęło, i każde polecenie, które by uruchomiło. Niczego nie
  zapisuje i niczego nie uruchamia.

## Co robi

1. Najpierw wszystko sprawdza: że działa w instancji, że platforma jest zainstalowana, że wersja
   istnieje i że **każdy** pakiet wydania zadeklarowany w Twoich manifestach jest opublikowany
   w tej wersji. Każdy problem trafia do jednego komunikatu i nic nie zostaje zapisane.
2. W każdym `package.json` instancji — w katalogu głównym, w `backend/`, `admin/` i `docs/` —
   oraz w sklepie obok niej przesuwa każdy pakiet wydania na nową wersję. Dokładne przypięcie
   pozostaje dokładne, a `^` pozostaje `^`. Żadna inna linia się nie zmienia.
3. W każdym `pnpm-lock.yaml` usuwa wpisy, które wskazują pakiet wydania w innej wersji, żeby pnpm
   rozwiązał je ponownie — także peery, które zainstalował sam.
4. Uruchamia `pnpm install` i `pnpm run setup` w instancji, a potem `pnpm install` w sklepie.
   Każde polecenie jest wypisywane, zanim się wykona.

Jeśli instancja jest już w żądanej wersji, polecenie to mówi i niczego nie zmienia.

### Czego nie rusza

- **Pakietów, które nie należą do wydania.** O tym, które należą, decyduje samo wydanie, a nie
  zakres `@endora-commerce/`, więc płatny moduł wersjonowany osobno i każdy pakiet zewnętrzny
  zachowują zakres, który wpisałeś. Każdy pominięty pakiet z tego zakresu jest wymieniony
  w wyniku.
- **Zależności, która nie jest zakresem wersji** — `file:`, `link:`, `workspace:`, tag. Zostaje
  wymieniona i zachowana.
- **Własnych plików sklepu.** Sklep to Twoje repozytorium; przesuwają się tylko jego pakiety
  wydania. `--no-storefront` zostawia go całkowicie w spokoju, a `--storefront-dir <path>`
  wskazuje sklep, który nie leży obok instancji.

## Po zakończeniu

Na koniec polecenie wymienia, co uruchomić ponownie:

```bash
pnpm run start                                   # API i jego konsumenci kolejek
pnpm run preview:admin                           # setup przebudował paczkę panelu
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
- Instalator `0.100.x` nie zapisywał sklepu poza klonem repozytorium. Utwórz go poleceniem
  `endora new storefront` — zobacz [Sklep](./getting-started.md#sklep).
- Instalator `0.100.x` nie zmieniał zajętego portu, więc zanim cokolwiek uruchomisz, sprawdź, czy
  `.env` nie wskazuje bazy danych innego środowiska.

## Instancja niespójna od początku

Instancja utworzona ze starszego wydania już po opublikowaniu nowszej poprawki instaluje nowszą
poprawkę każdego pakietu poza `@endora-commerce/contracts`, który przypina do starszej; instalacja
wypisuje *unmet peer @endora-commerce/contracts* raz na moduł. `pnpm run upgrade` — albo, przed
tym poleceniem, dwa polecenia powyżej — ustawia wszystkie pakiety na jedną wersję.

## Bez CLI

To, co robi polecenie, można zrobić ręcznie: w każdym `package.json` instancji i sklepu ustaw
każdy pakiet `@endora-commerce/*` należący do wydania na nową wersję, zachowując `^` i dokładne
przypięcia; usuń `pnpm-lock.yaml` i uruchom `pnpm install` (co przesuwa też Twoje pozostałe
zależności w ramach ich zakresów); potem uruchom `pnpm run setup`, a w sklepie `pnpm install`.
