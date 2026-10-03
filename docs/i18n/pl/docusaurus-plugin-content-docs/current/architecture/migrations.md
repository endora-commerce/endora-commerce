---
title: Migracje bazy danych (nazewnictwo, rejestr i kolejność)
---

# Migracje bazy danych

Migracje to **pliki należące do modułu, nazwane znacznikiem czasu UTC**, rejestrowane raz w jednym
statycznym rejestrze i wykonywane **moduł po module, w kolejności topologicznej grafu zależności
manifestów modułów**. Znacznik czasu porządkuje wyłącznie migracje danego modułu. Nie ma
wspólnego dla całego repozytorium numeru migracji ani ręcznie utrzymywanej listy wykonania.

Wcześniejszy schemat porządkował migracje według znacznika czasu i *korygował* wynik grafem
zależności w horyzoncie 45 dni. Obecny to odwrócił: kolejnością jest graf, a horyzont, krawędzie
korygujące i błąd `unresolvable-order` zniknęły. Powód: zbiór modułów przestał być ustalany w
czasie budowania — zainstalowany pakiet npm zawiera własne encje i migracje, a jego autor nie zna
historii hosta, więc reguła porządkująca według znacznika czasu, który on wybiera, niczego nie
porządkuje.

Mechanizm tworzą dwa pliki, oba w `backend/src/db/`:

| Plik | Rola |
|------|------|
| `migrations-registry.generated.ts` | Jedyne miejsce rejestracji — jeden statyczny import i jeden wpis na migrację, pogrupowane według modułu-właściciela. **Generowany** przez `scripts/generate-composer.ts` na podstawie przejścia po systemie plików i zatwierdzany w repozytorium; nigdy nie edytowany ręcznie. |
| `migration-order.ts` | Czysta funkcja `orderMigrations()`, która oblicza kolejność wykonania, oraz znacznik graniczny `BASELINE_THROUGH` i `historicalBaselineOrder()`, jedyne miejsce wyprowadzające kolejność zamrożonej części historycznej. Bez operacji wejścia-wyjścia, bez zegara, bez ORM. |
| `@endora-commerce/platform/migrations` | `BASELINE_MIGRATIONS` — zamrożona część historyczna jako uporządkowana lista nazw klas, generowana przez `composer:generate`. Wewnętrzna dla hosta: żaden moduł nie może importować tej ścieżki. |

`mikro-orm.config.ts` tylko je łączy; nie zawiera żadnej wiedzy o kolejności.

## Dlaczego usunięto globalny licznik

Każda migracja zajmowała kiedyś „następny wolny numer” w całym repozytorium
(`001_foundation_init.ts` → `Migration001FoundationInit`). Ta konwencja zawiodła nawet według
własnych kryteriów:

- **Cztery numery użyto dwukrotnie**, za każdym razem w innym module: `044`
  (`catalog/044_product_status_inactive` i `catalog/044_product_value_overrides_init`),
  `068` (`prompt_actions` i `catalog`), `069` (`settings` i `carts`), `080` (`returns` i `pwa`).
- **Numer `078` całkowicie pominięto** — licznik nie niósł żadnej informacji, na której ktoś by
  polegał.
- **Kolejność na liście już rozjechała się z kolejnością numerów.** MikroORM przekazuje
  `migrationsList` do umzug *bez sortowania*, więc o tym, co faktycznie wykonały wdrożone bazy,
  decydowała kolejność w tablicy w pliku konfiguracyjnym, a nie numer w nazwie pliku. Tablica
  wyglądała tak: `…068_prompt_actions, 069_settings_secret, 068_product_packaging,
  069_cart_item…`.
- **Każda gałąź powodowała konflikt.** Dwie równoległe gałęzie dopisywały import i wpis w tym
  samym miejscu pliku o 565 wierszach, więc konflikt przy scalaniu był pewny nawet wtedy, gdy obie
  migracje nie miały ze sobą nic wspólnego.

Schemat ze znacznikiem czasu całkowicie usuwa potrzebę koordynacji: dwóch programistów na dwóch
gałęziach nie musi niczego uzgadniać, a rejestr jest podzielony według modułów, więc ich zmiany nie
dotykają tych samych wierszy.

## Konwencja nazewnictwa

Konwencja wygląda tak:

```text
<YYYYMMDDTHHmmss>_<SEGMENT>_<SLUG>.ts
```

| Część | Reguła |
|------|------|
| Znacznik czasu | UTC, stała szerokość (15 znaków), litera `T` na pozycji 8. Bez `Z` i bez separatorów. Można go sortować leksykograficznie. **Unikalny w obrębie własnego modułu** — dwa moduły mogą mieć ten sam znacznik, bo znacznik nie porządkuje niczego poza swoim modułem, a autorzy dwóch pakietów nie mogą się koordynować. |
| `<SEGMENT>` | Identyfikator modułu-właściciela bez początkowego podkreślenia; dosłownie `core` dla migracji przekrojowych w `packages/platform/src/migrations/`. |
| `<SLUG>` | `snake_case` (`[a-z0-9_]+`) opisujący zmianę. |

**Nazwa klasy jest wyprowadzana mechanicznie** z nazwy pliku: usuń rozszerzenie, zapisz każdy
segment końcówki oddzielony `_` w PascalCase (wielka jest tylko pierwsza litera segmentu, więc
`i18n` → `I18n`) i dodaj przedrostek `Migration` oraz znacznik czasu:

| Nazwa pliku | Nazwa klasy |
|----------|------------|
| `20260424T165847_core_foundation_init.ts` | `Migration20260424T165847CoreFoundationInit` |
| `20260507T091405_i18n_admin_i18n_init.ts` | `Migration20260507T091405I18nAdminI18nInit` |
| `20260724T193611_orders_order_placement_intents.ts` | `Migration20260724T193611OrdersOrderPlacementIntents` |

Normalizacja segmentu ma dokładnie dwa przypadki szczególne:

| Katalog właściciela | `<SEGMENT>` | `moduleId` w rejestrze |
|------------------|-------------|---------------------|
| `packages/modules/orders/src/migrations/` | `orders` | `'orders'` |
| `packages/modules/_i18n/src/migrations/` | `i18n` | `'_i18n'` |
| `packages/platform/src/migrations/` | `core` | `'core'` |

Każdy wiersz to katalog, który istnieje. `_lifecycle` jest drugim modułem z początkowym
podkreśleniem i według tej samej reguły otrzymałby segment `lifecycle`, ale nie ma wiersza, bo nie
ma katalogu migracji: moduł jest częścią pakietu platformy, a jego jedyną tabelę tworzy
`20260506T200657_core_module_lifecycle_init.ts` wśród migracji przekrojowych, w segmencie `core`.

**Końcówka nazwy klasy musi zaczynać się od segmentu modułu** — i jest to teraz reguła, a nie tylko
skutek wyprowadzania nazwy ze ścieżki. To ona sprawia, że nazwy klas są globalnie unikalne bez
rejestru, przestrzeni nazw czy skrótu: identyfikatory modułów są unikalne w całej platformie, więc
`Migration<stamp>Orders…` nie może kolidować z migracją żadnego innego modułu. `orderMigrations()`
odrzuca naruszenie jako `unscoped-name` — to jedyne miejsce, w którym można sprawdzić nazwę z
pakietu — a `scripts/check-naming.sh` odrzuca je w drzewie rdzenia w czasie budowania. W chwili
wprowadzenia reguły spełniała ją już każda ze 141 migracji.

**Nazwa klasy to nazwa migracji zapisywana w `mikro_orm_migrations.name`.** Zmiana nazwy klasy
wykonanej migracji jest więc problemem bazy danych, a nie refaktoringiem: każda baza, która już ją
wykonała, widzi nową nazwę jako oczekującą. Nic w repozytorium nie zabrania takiej zmiany — ile
kosztuje i jak ją wdrożyć, opisuje sekcja „Blok bazowy i zmiana nazwy wykonanej migracji” niżej.

## Jak utworzyć migrację

Ta sekcja dotyczy **własnych** modułów tego repozytorium — członka workspace, który deklaruje
`endora: { type: 'module', id }`, modułu w katalogu źródeł aplikacji albo migracji przekrojowych
w `packages/platform/src/migrations/`. Oba poniższe polecenia wymagają struktury tego repozytorium. Jeśli
piszesz moduł dostarczany jako instalowany pakiet npm, żadne z nich nie jest dla ciebie dostępne:
przejdź do sekcji
[Jak utworzyć migrację w pakiecie rozszerzenia](#jak-utworzyć-migrację-w-pakiecie-rozszerzenia).

```bash
pnpm --filter backend run migration:new -- --module orders --name placement_intents
```

Generator szkieletu (`backend/scripts/new-migration.ts`):

1. sprawdza `--module` względem identyfikatorów zarejestrowanych w **wygenerowanym indeksie
   manifestów** (plus dosłownego `core`) i jeśli nie ma dopasowania, wypisuje poprawne
   identyfikatory;
2. wyznacza **wolny znacznik czasu UTC**, przesuwając się o pełne sekundy, dopóki żaden plik
   migracji w drzewie go nie używa. Unikalność w całym drzewie to kwestia porządku, a nie
   kolejności: wymagana jest tylko unikalność w obrębie modułu;
3. **podnosi znacznik czasu powyżej `BASELINE_THROUGH`.** Bieżący czas może nadal być
   *wcześniejszy* niż `BASELINE_THROUGH = 20260801T000000`; zwykły znacznik trafiłby wtedy do
   zamrożonej części historycznej, której kolejność jest historią i nigdy nie jest przeliczana —
   migracja byłaby uporządkowana według tej historii zamiast według `dependencies` jej modułu.
   Generator zapisuje więc znacznik o sekundę późniejszy niż granica;
4. zapisuje plik z szablonu we własnym katalogu `migrations/` modułu i odrzuca miejsce docelowe,
   którego nie znalazłby generator rejestru — generator szkieletu zapisujący tam, gdzie nic nie
   czyta, tworzy migrację, która nigdy się nie wykona, i nic o tym nie mówi.

**Położenie tego katalogu jest wyznaczane, a nigdy wpisywane.** Odpowiedzi na wszystkie trzy
powyższe pytania — które identyfikatory są poprawne, które znaczniki są zajęte, gdzie trafia plik —
pochodzą z `backend/scripts/lib/module-roots.ts`, tego samego wyprowadzenia, z którego korzystają
kontrole statyczne: odnajdywany jest wygenerowany indeks manifestów, a katalog modułu to albo
katalog w katalogu źródeł aplikacji, albo członek workspace deklarujący
`endora: { type: 'module', id }`. Katalog `migrations/` pakietu modułu to wtedy katalog, który jego
własna mapa `exports` publikuje jako `./migrations`. Do 2026-08-30 każda z tych odpowiedzi była
ścieżką wpisaną na stałe jako `backend/src/modules`, dlatego po opróżnieniu tego katalogu narzędzie
odpowiadało `Valid ids are: core.` dla każdego modułu w tym repozytorium.

Zarejestruj migrację, generując ponownie zatwierdzony rejestr, i zatwierdź oba pliki:

```bash
pnpm --filter backend run composer:generate
```

Generator przechodzi po katalogu platformy `packages/platform/src/migrations/` i po własnym katalogu `migrations/` każdego modułu,
odnajdywanym tak samo jak przez generator szkieletu, wyprowadza każdą nazwę klasy z nazwy pliku i
odrzuca — zamiast pomijać — plik, którego nie potrafi przypisać: nierozpoznany plik `.ts` w katalogu
migracji, klasę, której plik nie eksportuje, dwa pliki dające tę samą nazwę albo migrację w
`src/apps/<deployment>/` (moduły nakładkowe nie mogą zawierać migracji, więc zarejestrowanie takiej
migracji byłoby nową możliwością, a nie skutkiem ubocznym generowania listy).

**Niezarejestrowana migracja się nie wykona.** Rejestr to lista statycznych importów, a nie wzorzec
wieloznaczny (wyszukiwanie po wzorcu wymaga dynamicznego `import()` plików `.ts` w czasie
działania, czego loader ESM w Node nie potrafi przekształcić i co psuje się w Vitest — z tego samego
powodu istnieje `entities-registry.generated.ts`, generowany tym samym poleceniem). Zabezpieczenie
porównujące w obie strony, `backend/test/unit/db/migrations-registry.test.ts`, przerywa build dla
pliku bez wpisu, wpisu bez pliku, nazwy klasy niezgodnej z nazwą pliku, zadeklarowanego `moduleId`
niezgodnego z katalogiem właściciela, segmentu w nazwie pliku niezgodnego z identyfikatorem modułu,
nierozpoznanego pliku `.ts` w katalogu `migrations/` i każdego pozostałego pliku z numerem `NNN_`.

`mikro-orm migration:create` / `migration:generate` **nie** są dopuszczalne: zapisują do jednej
skonfigurowanej ścieżki i nie mogą wiedzieć, do którego modułu należy migracja.

:::note Pliki pomocnicze
W katalogu `migrations/` może leżeć plik pomocniczy `.ts`, który nie jest migracją, ale musi być na
jawnej liście wyjątków zabezpieczenia — dziś jest na niej dokładnie jeden wpis,
`packages/modules/quote_requests/src/migrations/status-mapping.ts`. Lista istnieje po to, by
literówka w nazwie pliku migracji kończyła się głośnym błędem, a nie cichym zniknięciem migracji z
mechanizmu migracji.
:::

## Jak utworzyć migrację w pakiecie rozszerzenia

Wszystko powyżej dotyczy własnego drzewa tego repozytorium. Moduł dostarczany jako **instalowany**
pakiet npm (`endora.type: "module"` w jego `package.json`) nie może uruchomić żadnego z tych
poleceń: `migration:new` odnajduje moduł przez członków workspace tej kopii repozytorium i jej
wygenerowany indeks manifestów, a żadne z nich nie sięga do `node_modules`, natomiast oba
generowane rejestry celowo obejmują tylko rdzeń — to, które pakiety zainstalowała instancja, jest
faktem dotyczącym *procesu*, a nie drzewa, więc artefakt zatwierdzony w repozytorium nie może
twierdzić, że to wie. Host odnajduje więc migracje pakietu w czasie działania, przez własny eksport
`./migrations` pakietu.

**Nie ma do tego generatora szkieletu i nie jest potrzebny.** Poprawną migrację pakietu pisze się
ręcznie, a cała jej postać mieści się na tej stronie. (`endora new migration` jest planowane jako
podpolecenie programu `@endora-commerce/cli`; gdy powstanie, będzie generować dokładnie to, co
opisano poniżej, a ta sekcja będzie do niego odsyłać).

Działający przykład jest w tym repozytorium: **`backend/acceptance/fixture-package/`** —
syntetyczny pakiet modułu zewnętrznego, budowany i instalowany z archiwum przez testy akceptacyjne
pakowania, którego jedyna migracja tworzy prawdziwą tabelę w prawdziwej bazie danych.

### 1. Napisz plik migracji

Umieść go w katalogu `src/migrations/` swojego pakietu, z nazwą utworzoną tak jak w rdzeniu:

```
<YYYYMMDDTHHmmss>_<your module segment>_<slug>.ts
```

| Część | Reguła |
|------|------|
| Znacznik czasu | UTC, stała szerokość (15 znaków), litera `T` na pozycji 8. Bez `Z` i bez separatorów. |
| `<segment>` | Identyfikator twojego modułu — pole `endora.id` w twoim `package.json` — bez początkowego podkreślenia. |
| `<slug>` | `snake_case` (`[a-z0-9_]+`) opisujący zmianę. |

**Nazwa klasy jest mechanicznie wyprowadzana z tej nazwy pliku**: usuń rozszerzenie, zapisz każdy
segment końcówki oddzielony `_` w PascalCase (tylko pierwsza litera, więc `i18n` → `I18n`) i dodaj
przedrostek `Migration` oraz znacznik czasu. Eksportuj ją jako eksport nazwany.

| `endora.id` | Nazwa pliku | Nazwa klasy |
|-------------|----------|------------|
| `acceptance_probe` | `20260821T120000_acceptance_probe_init.ts` | `Migration20260821T120000AcceptanceProbeInit` |
| `acme_gateway` | `20260901T093000_acme_gateway_payouts.ts` | `Migration20260901T093000AcmeGatewayPayouts` |

W przypadku pakietu *nazwa pliku* to konwencja, której host nigdzie nie odczytuje — host dostaje
klasy, a nie ścieżki. **Nazwa klasy nie jest konwencją.** To string, który host zapisuje w
`mikro_orm_migrations.name`, i dotyczą jej dwie reguły:

- **Jej końcówka musi zaczynać się od `PascalCase(<your module segment>)`.** To sprawia, że nazwy
  klas są globalnie unikalne we wszystkich modułach, które platforma może złożyć — *łącznie z
  twoim*, i to jest jedyny powód istnienia tej reguły: identyfikatory modułów są unikalne w całej
  platformie (wyszukiwanie odrzuca pakiet, który zgłasza zajęty już identyfikator, a
  `composeModules` sprawdza unikalność, zanim zarejestruje się pierwszy moduł), więc nazwa
  zawężona identyfikatorem modułu nie może kolidować z nazwą modułu rdzenia ani innego dostawcy. Nie
  robi tego żaden rejestr, przestrzeń nazw ani skrót. Nazwanie pliku tak jak wyżej daje poprawną
  nazwę klasy bez dodatkowego wysiłku.
- **Nigdy nie zmienia się jej po tym, jak gdziekolwiek została wykonana.** Host wyznacza
  oczekujące migracje jako „nazwy, których nie ma w `mikro_orm_migrations`”, więc zmiana nazwy w
  wersji 1.2 twojego pakietu to dla każdej bazy, która wykonała starą wersję, *nowa* migracja, która
  zostanie ponownie wykonana na schemacie, który już ją zawiera. Zamiast tego dostarcz nową
  migrację.

Klasa migracji z danych testowych, przytoczona dosłownie — komentarz nagłówkowy nad nią w źródle
opisuje reguły, których przestrzega:

<!-- verbatim-from: backend/acceptance/fixture-package/src/migrations/20260821T120000_acceptance_probe_init.ts -->

```ts
export class Migration20260821T120000AcceptanceProbeInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "acceptance_probe_rows" (
        "id" uuid not null,
        "organization_id" uuid null,
        "label" text not null,
        "created_at" timestamptz not null default now(),
        constraint "acceptance_probe_rows_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "acceptance_probe_rows_organization_id_index" on "acceptance_probe_rows" ("organization_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "acceptance_probe_rows" cascade;`);
  }
}
```

### 2. Wpisz ją do eksportu `./migrations` — nic innego tego nie zrobi

Punkt wejścia `./migrations` twojego pakietu eksportuje tablicę klas migracji (same klasy albo
pary `{ name, class }`, w których `name` musi być równe nazwie klasy). Host odczytuje tę tablicę,
oznacza każdy wpis jako `origin: 'external'` i wstawia cały łańcuch do kolejności wykonania na
pozycji topologicznej twojego modułu. Działającym przykładem jest
`backend/acceptance/fixture-package/src/migrations/index.ts`.

:::danger To jedyny błąd, który jest cichy
**Plik migracji, którego nie ma w tablicy `./migrations`, nigdy się nie wykona**, a pierwszym
objawem jest błąd zapytania do nieistniejącej tabeli. W drzewie rdzenia ten sam błąd eliminuje
generator — `composer:generate` przechodzi po katalogu, a zabezpieczenie porównujące w obie strony
przerywa build dla pliku bez wpisu. **Pakiet nie ma odpowiednika i nie dostanie go tutaj**: z
założenia nic w hoście nie przeszukuje pakietu. Utrzymywanie kompletności tej tablicy to zadanie
autora i żadna kontrola w tym repozytorium nie zrobi tego za ciebie.
:::

Wszystko inne kończy się głośnym błędem — zobacz *Gdy pomylisz się w nazewnictwie* niżej.

### 3. Zadeklaruj w `dependencies` manifestu każdy moduł, do którego tabel się odwołujesz

Kolejność wykonania to przejście topologiczne po grafie zależności manifestów, więc wpis w
`dependencies` manifestu to **jedyna rzecz**, która umieszcza twoją migrację za tabelą, do której
się odwołuje. Jeśli twoja migracja dodaje klucz obcy do `orders`, twój manifest deklaruje `orders` —
to i tylko to sprawia, że ograniczenie da się nałożyć na świeżej bazie danych. Dane testowe
deklarują `auth` właśnie z tego rodzaju powodu.

Nie ma innej dźwigni. Przesunięcie znacznika czasu tego nie zrobi (zobacz niżej), a krawędzi
kolejności dla pojedynczej migracji nie ma.

### Co porządkuje znacznik czasu, a czego nie

To ta część, która jest odwrotnością tego, czego uczy schemat z numeracją kolejną, i to ona
sprawia, że ręczne pisanie migracji jest bezpieczne:

- **W obrębie twojego modułu** znacznik czasu to cała kolejność: twoje migracje wykonują się
  rosnąco według znacznika, jedna po drugiej. Dwie twoje migracje z tym samym znacznikiem to błąd
  (`duplicate-timestamp`).
- **Między modułami znacznik czasu nic nie znaczy.** Dwa moduły mogą mieć ten sam. Zamiana
  znaczników dwóch migracji w niepowiązanych modułach nie zmienia wynikowej kolejności. Wybierając
  znacznik, nie przesuniesz swojej migracji względem migracji hosta — ani innego dostawcy — w żadną
  stronę.

Cała reguła dotycząca znacznika dla autora pakietu brzmi więc: **późniejszy niż twoja najnowsza
migracja.** Nie musisz znać historii hosta, i dobrze, bo jej nie znasz.

### `BASELINE_THROUGH` to fakt drzewa rdzenia i ciebie nie dotyczy

Generator szkieletu w rdzeniu podnosi każdy nowy znacznik rdzenia powyżej `BASELINE_THROUGH`
(`20260801T000000`), a konwencje tego repozytorium nakazują autorom rdzenia nigdy nie tworzyć
migracji z tym znacznikiem lub wcześniejszym. **To polecenie nie jest skierowane do ciebie, a
furtki, przed którą ostrzega, w twoim przypadku nie ma.** Przynależność do części bazowej jest
kwestią **tożsamości**:

```
isBaseline(entry) ⇔ entry.class.name ∈ BASELINE_MIGRATIONS
```

`BASELINE_MIGRATIONS` to uporządkowana lista 112 nazw klas, którą `@endora-commerce/platform`
publikuje w ścieżce `./migrations` — własna historia tej platformy, którą dostajesz, instalując
platformę. Twojej migracji na niej nie ma i nie może się na nią dostać, więc **twój znacznik w ogóle
nie jest porównywany z granicą**. Wybierz znacznik wcześniejszy — nawet o lata — a twoja migracja
nadal będzie w bloku otwartym, nadal na pozycji topologicznej twojego modułu, nadal uporządkowana
według `dependencies` twojego manifestu; bez tej gwarancji wsteczny znacznik pakietu zewnętrznego
trafiłby przed własną migrację fundamentu platformy (zmierzono: indeks 0 ze 143).

Przynależność wymagała kiedyś dwóch warunków, `(entry.origin ?? 'core') === 'core'` **i**
znacznika, a to pierwszy zamykał tę furtkę. Zastąpiono go, bo odpowiada na pytanie *„czy to
pochodzi z buildu hosta”* zamiast *„czy to jedna z migracji, których kolejność jest historią”* — a
to te same pytania tylko dopóki każdy moduł jest kompilowany razem z aplikacją. W chwili, gdy moduły
są instalowanymi pakietami, jak w instancji, pierwsze pytanie daje `false` dla każdego z nich:
część bazowa kurczy się ze 112 wpisów do 11, przesuwa się 181 ze 182 pozycji, a sześć migracji
trafia przed migrację, która tworzy tabelę, z której korzystają. Reguła tożsamości zamyka tę samą
furtkę jeszcze szczelniej, bo nazwy nie może sobie przypisać przychodzący pakiet.

I tak wybierz rozsądny znacznik. Ale wybieraj go z myślą o własnym łańcuchu, a nie o łańcuchu hosta.

### Gdy pomylisz się w nazewnictwie

Wszystkie cztery reguły nazewnictwa są egzekwowane w kroku 1 `orderMigrations()`, do którego host
dochodzi podczas inicjalizacji ORM. Każda rzuca `MigrationOrderError` wskazujący twoją klasę, twój
moduł i odpowiednią sekcję kontraktu — zanim wykona się jakakolwiek migracja i bez niczego
wykonanego do połowy:

| Błąd | Co oznacza |
|-------|---------------|
| `unparsable-name` | Nazwa klasy nie ma postaci `Migration<YYYYMMDDTHHmmss><PascalCaseTail>` albo znacznik nie wskazuje rzeczywistej chwili UTC. |
| `unscoped-name` | Końcówka nie zaczyna się od segmentu twojego modułu. Komunikat podaje oczekiwany przedrostek. |
| `duplicate-name` | Dwie migracje w całej kompozycji mają tę samą nazwę klasy — twoja i czyjaś albo dwie twoje. To klucz w bazie danych, więc musi być unikalny globalnie. |
| `duplicate-timestamp` | Dwie **twoje** migracje mają ten sam znacznik. Przesuń jedną o pełną sekundę, jednocześnie w nazwie pliku i w nazwie klasy. |

:::note To zatrzymuje cały host, a nie tylko twój moduł
`MigrationOrderError` jest rzucany podczas inicjalizacji ORM hosta, więc błąd w nazewnictwie w
zainstalowanym pakiecie uniemożliwia start platformy, zamiast wyłączyć pakiet, który go popełnił. Ta
asymetria — *cykl* zależności zadeklarowany przez pakiet jest dziesięć wierszy dalej łagodzony do
ostrzeżenia, z podanym powodem, że manifest obcego autora nie może blokować migracji schematu
sklepu — to znana, otwarta kwestia. Dopóki nie zostanie rozstrzygnięta, traktuj błąd w
nazewnictwie jak awarię w cudzym sklepie.
:::

### Co pakiet może zawierać, a czego nie

Pakiet może zawierać encje i migracje. **Moduł nakładkowy wdrożenia** w `backend/src/apps/` nie
może (generator odrzuca jedno i drugie) — jego rozwiązanie jest zawsze dostępne i kosztuje tylko
jeden katalog: utwórz tabelę w module rdzenia i odczytuj ją przez port tego modułu. Autor zewnętrzny
nie ma modułu rdzenia i dlatego odpowiedź jest inna. Zobacz
`docs/docs/architecture/overlay-pattern.md`.


## Reguły kolejności

`orderMigrations()` (`backend/src/db/migration-order.ts`) to czysta funkcja: te same dane wejściowe,
ten sam wynik, bez bazy danych, bez zegara, bez środowiska. Wynikowa kolejność to połączenie
**dwóch bloków**.

**1. Blok bazowy — zamrożona część historyczna.** Każdy wpis, którego nazwa klasy jest na liście
publikowanej przez `@endora-commerce/platform` jako `BASELINE_MIGRATIONS`, w kolejności, w jakiej
występuje na tej liście. Ten blok jest starszy niż obecny schemat: napisano go i wykonano w
kolejności ręcznie utrzymywanej tablicy, której manifesty nie opisują — przeczą jej w 37 miejscach
— więc wygenerowanie go w jakikolwiek inny sposób daje kolejność, której świeża baza nie potrafi
wykonać. Jest zamknięty, nigdy nie rośnie (generator szkieletu podnosi każdy nowy znacznik rdzenia
powyżej granicy) i nic nie powinno próbować go opróżniać.

Lista jest **generowana** przez `composer:generate` z tego, co zatwierdzony rejestr rdzenia wnosi
do `BASELINE_THROUGH` (`20260801T000000`) włącznie — granica jest więc regułą czasu generowania i
żaden test przynależności w czasie działania jej nie sprawdza. Lista znajduje się w pakiecie
platformy, bo to dane o historii *tej platformy*: klient dostaje ją, instalując platformę, a
poprawkę do niej — przez `pnpm update`. Żaden moduł nie może importować tej ścieżki.

Jej 112 nazw jest też utrwalonych jako literał zatwierdzony w
`backend/test/unit/db/migration-order-baseline.test.ts`, w kolejności, w jakiej wykonała je baza
danych, zapisanej przed przepisaniem algorytmu porządkowania. Tego literału nigdy się nie
generuje ponownie — wartość bazowa obliczona z kodu, którego ma pilnować, niczego nie mierzy — a
wygenerowana lista jest z nim porównywana nazwa po nazwie i pozycja po pozycji. To sprawia, że
wygenerowanemu artefaktowi można ufać, a nie tylko, że jest deterministyczny.

Przynależność zależy od **tożsamości** i od niczego więcej — to najsilniejsza postać tej reguły,
jaką ten blok kiedykolwiek miał. Test oparty wyłącznie na znaczniku pozwala migracji spoza
zatwierdzonego rejestru dołączyć do części, której kolejność jest faktem historycznym: zmierzono,
że migracja pakietu ze znacznikiem `20250101T000000` trafiła na indeks 0, przed własną migrację
fundamentu platformy. Przez jakiś czas zamykało to dodatkowe wymaganie `origin === 'core'`, a
koniunkcja odpowiadała na pytanie *„pochodzi z buildu tego repozytorium”*, choć używano jej w
znaczeniu *„jest jedną z migracji, których kolejność jest historią”* — dwa pytania, które pokrywają
się tylko dopóki każdy moduł jest kompilowany razem z aplikacją. Nazwy przychodzący pakiet w ogóle
nie może sobie przypisać, cokolwiek deklaruje o swoim pochodzeniu, więc o pochodzenie wpisu nikt już
nie pyta.

**2. Blok otwarty — wszystko inne, moduł po module.** Moduły są sortowane topologicznie według
grafu kolejności, remisy rozstrzyga rosnąco identyfikator modułu, a migracje każdego modułu są
umieszczane razem, rosnąco według znacznika czasu.

- **Graf kolejności** ma identyfikatory modułów jako węzły i `dependencies` z manifestów jako
  krawędzie i **nie odczytuje żadnej innej tablicy manifestu** — ani
  `acknowledgedDependencies`, ani `nonBindingDependencies`, bo żadna z nich nie jest deklaracją
  kolejności.
- Pseudomoduł `core` jest pierwszy. Niczego nie deklaruje i nikt go nie deklaruje, więc zawsze jest
  gotowy; tabele każdego modułu leżą za tabelami startowymi.
- **Znacznik czasu nigdy nie przekracza granicy modułu.** Jeśli moduł `A` deklaruje `B`, każda
  otwarta migracja `A` występuje po każdej otwartej migracji `B` — niezależnie od tego, jak daleko
  od siebie są ich znaczniki i w którą stronę. Nie ma horyzontu.
- **Determinizm.** Sortowanie topologiczne opróżnia zbiór gotowych modułów według najmniejszego
  identyfikatora, więc wynikowa kolejność jest identyczna bajt po bajcie przy każdej permutacji
  danych wejściowych i w każdym przebiegu. Podanie wyniku ponownie na wejście daje ten sam wynik.

Zagrożenie, przed którym to chroni: gałąź A dodaje w środę migrację `catalog`, a gałąź B dodaje w
poniedziałek migrację `orders`, której klucz obcy wskazuje kolumnę tworzoną przez gałąź A. `orders`
przechodnio zależy od `catalog`, więc cały blok `catalog` jest umieszczany pierwszy i świeża baza
wykonuje migracje bez problemu — bez zmiany numeracji i bez koordynacji między gałęziami. W
poprzednim schemacie działało to tylko wtedy, gdy oba znaczniki dzieliło najwyżej 45 dni; teraz
działa bezwarunkowo.

### Cykle są zgłaszane, a nie rzucane jako wyjątek

Jeśli graf kolejności ma silnie spójną składową złożoną z więcej niż jednego modułu, kolejność i
tak zostaje obliczona: migracje tej składowej są umieszczane w jednym ciągłym bloku, w kolejności
znaczników czasu w całej składowej — to reguła bloku bazowego zastosowana lokalnie i jedyna
określona odpowiedź, gdy deklaracje nie zawierają kolejności. Składowa wraca jako **diagnostyka**,
a żaden wyjątek nie jest rzucany.

To celowe. W poprzednim schemacie graf był korektą, więc odrzucenie cyklu nic nie kosztowało. Dziś
graf jest podstawowym źródłem kolejności, a manifest może przyjść z `node_modules`, więc wyjątek
oznaczałby, że *jeden źle zadeklarowany pakiet obcego autora blokuje migrację schematu rdzenia w
tym sklepie*. Zamiast tego reagują trzy miejsca:

| Miejsce | Reakcja |
|--------|----------|
| `backend/test/unit/db/module-graph.test.ts` | sprawdza, że w zatwierdzonych manifestach jest **zero** diagnostyk — cykl w tym repozytorium nadal oznacza czerwony build |
| `backend/src/db/mikro-orm.config.ts` | zapisuje w logu każdą diagnostykę na poziomie `warn`, wymieniając jej elementy |
| mechanizm `_lifecycle` | odrzuca instalację, której pojawienie się zamyka cykl, wymieniając wszystkie elementy i kończąc się kodem `65` |

Te trzy reakcje różnią się celowo, a różnica wynika z tego, gdzie każda działa. Cykl **w tym
repozytorium** to błąd kogoś, kto może go naprawić, zanim cokolwiek zostanie wydane, więc oznacza
czerwony build. Cykl **w działającej platformie** jest już wdrożony, więc platforma to zgłasza i
działa dalej — nic innego, co mogłaby zrobić, nie poprawiłoby sytuacji operatora. Cykl, który ma
się dopiero **pojawić**, jest odrzucany, bo instalacja to jedyny moment, w którym odmowa nic nie
kosztuje: nic zależnego od modułu jeszcze nie istnieje, a operator jest właśnie przy konsoli.

Odmowa dotyczy tylko instalowanego modułu: przeglądany graf to zbiór zainstalowanych modułów plus
ten moduł, a odrzucana jest tylko składowa, która go zawiera. Pętla między dwoma już
zainstalowanymi modułami nie blokuje instalacji trzeciego — to odtworzyłoby, jedno polecenie
później, dokładnie ten paraliż całej platformy, któremu zapobiega reguła „bez wyjątku”. Graf jest
przeglądany przez `findModuleCycles` z `migration-order.ts`, więc lista elementów, którą operator
widzi przy instalacji, jest tą samą listą, którą wypisałoby ostrzeżenie przy starcie.

### Zaakceptowane ograniczenie

Migracja dodana później MOŻE zmienić względną kolejność dwóch migracji, które niektóre bazy **już
wykonały**. Dla tych baz jest to nieszkodliwe: umzug wyznacza oczekujące migracje jako
`list.filter(name ∉ executed)`, więc wykonana migracja jest pomijana niezależnie od jej pozycji na
liście. Zmierzono to na prawdziwej bazie zbudowanej w poprzedniej kolejności, a następnie odczytanej
w obecnej: **pending 0, executed 142, `up()` applied 0**. Świeże bazy obejmuje zadanie backendu w
CI, które w każdym pipeline tworzy pustą bazę i wykonuje cały łańcuch.

## Co oznacza `dependencies` w manifeście

Tablica `dependencies` w manifeście modułu jest teraz **jedynym** źródłem kolejności między
modułami, więc musi być rzetelna — ale nadal oznacza **konieczność przy instalacji**, a nie „każdą
tabelę, do której mam klucz obcy”. Czytaj ją jako: *ten moduł nie może działać bez tamtego.*

Gdy dwa moduły wyglądają na wzajemnie zależne, o tym, który kierunek zachować, decydują trzy
reguły pierwszeństwa:

- **Reguła 1 — moduł bazowy platformy.** Moduł bazowy platformy (`settings`, `audit_logs`, …)
  nigdy nie zależy od modułu domenowego.
- **Reguła 2 — właściciel tabeli łączącej.** Właściciel tabeli łączącej nigdy nie zależy od tego,
  co łączy; to moduł domenowy, który nie może działać bez połączenia, deklaruje właściciela tabeli
  łączącej. (`sales_channels` jest właścicielem `sales_channel_products`; `catalog` deklaruje
  `sales_channels`, a nie odwrotnie — zgodnie z zawężaniem treści do kanału sprzedaży).
- **Reguła 3 — moduł bazowy izolacji tenantów.** `organizations` jest modułem bazowym izolacji
  tenantów i nigdy nie zależy od modułów, których dane należą do tenantów.

**Każda pominięta krawędź musi mieć komentarz w manifeście, który by ją zadeklarował**, wskazujący
klucze obce, których dotyczy, regułę, która ją pomija, oraz cykl, który by utworzyła, jeśli
tworzy. Wzorcowy przykład: `packages/modules/organizations/src/manifest.ts`.

Cykl w grafie to **czerwony build** — `module-graph.test.ts` kończy się błędem przy każdej
diagnostyce. Nie jest to błąd startu: zobacz „Cykle są zgłaszane, a nie rzucane jako wyjątek” wyżej.

## Walidator rozjazdu kluczy obcych

Uzupełniony graf jest pilnowany przez blokującą kontrolę:
`backend/test/unit/db/fk-dependency-drift.test.ts`.

Wyprowadza ona **każdy klucz obcy między modułami** z SQL migracji (z treści instrukcji
`create table` / `alter table`, dopasowując `references "<table>"`), przypisuje każdą tabelę do
modułu-właściciela (najpierw na podstawie deklaracji `tableName` w encjach, potem jawnej listy w
`backend/test/unit/db/table-owner-overrides.ts` dla tabel łączących, do których nie przyznaje się
żadna encja) i sprawdza, czy moduł odwołujący się **przechodnio deklaruje** moduł, do którego się
odwołuje, w `dependencies` swojego manifestu.

- To **czysty test jednostkowy**: bez bazy danych i bez uruchamiania ORM, wykonuje się w ramach
  `pnpm --filter backend run test:unit` w znacznie mniej niż sekundę.
- **Nie ma żadnego wpływu na działanie platformy.** Nic w `backend/src/` go nie importuje, nie
  wpływa na `orderMigrations()`, a jego pliki leżą w drzewie testów. Sprawdza *dane wejściowe*,
  z których korzysta algorytm porządkowania, i nic więcej.
- Tabela utworzona przez migrację, do której nie przyznaje się żadna encja ani wpis na liście
  nadpisań, **przerywa** kontrolę, podobnie jak klucz obcy, którego celu nie da się przypisać do
  modułu. Nic nie jest pomijane po cichu.

Komunikat błędu wygląda tak:

```text
[fk-drift] undeclared cross-module foreign key:
  orders.order_placement_intents → api_keys
  module "orders" references module "api_keys" but does not declare it
  (transitively) in packages/modules/orders/src/manifest.ts.

  Fix one of:
    (a) add 'api_keys' to `dependencies` in orders/manifest.ts  ← usually this
    (b) if the edge must stay undeclared (it would create a cycle), add an entry to
        backend/test/unit/db/acknowledged-fk-edges.ts with a reason and the cycle.
```

**Opcja (a) jest prawie zawsze właściwa.** Po listę wyjątków sięgaj tylko wtedy, gdy deklaracja
krawędzi utworzyłaby cykl — i wtedy musisz podać uzasadnienie, regułę pierwszeństwa i opis cyklu.

### Lista uznanych krawędzi

`backend/test/unit/db/acknowledged-fk-edges.ts` zawiera krawędzie celowo pominięte przez reguły
pierwszeństwa — obecnie 15, dopasowywanych po parze modułów `(from, to)`. Każdy wpis zawiera
`from`, `to`, `via` (konkretne pary tabel, aby było widać zasięg), niepuste `reason`, `rule` oraz
opis `cycle`.

Lista ma **sprawdzaną minimalność**, więc nie może tylko rosnąć:

| Asercja | Skutek |
|-----------|--------|
| M1 | Wpis, którego klucz obcy już nie istnieje, kończy się błędem jako nieaktualny. |
| M2 | Wpis, którego para modułów jest już spełniona przez graf manifestów, kończy się błędem jako zbędny. |
| M3 | Puste `reason`, nieznana `rule` albo pusty `cycle` kończą się błędem. |
| M4 | Powtórzona para `(from, to)` kończy się błędem. |
| M5 | Szesnasty wpis kończy się błędem — podniesienie limitu to widoczna decyzja podlegająca przeglądowi, a nie ciche dopisanie. |

:::note `cycle` znaczy więcej niż „cykl, który by się zamknął”
Według pomiaru na dostarczonym grafie tylko **6 z 15** wpisów rzeczywiście zamyka cykl
(`organizations → customer_accounts`; `sales_channels → catalog / cms / customer_accounts /
promotions`; `settings → sales_channels`), a `organizations → inventory` zamyka go dopiero wtedy,
gdy zadeklarowana jest też krawędź mostu `sales_channels`. Zamiast wymyślać ścieżki, pozostałe
wpisy zawierają jawne stwierdzenie „samo w sobie nie tworzy cyklu — pominięte, ponieważ …”
wskazujące powód z reguł pierwszeństwa. M3 i tak sprawdza, że pole nie jest puste.
:::

## Typowe błędy i ich naprawa

Wszystkie poniższe błędy są rzucane **w czasie budowania konfiguracji** — czyli przy pierwszym
imporcie `mikro-orm.config.ts` — jako `MigrationOrderError` z komunikatem wskazującym, co zrobić.

| Objaw | Przyczyna | Naprawa |
|---------|-------|-----|
| `module "orders" has two migrations stamped 20260801T000001` | Dwie gałęzie utworzyły migrację w tej samej sekundzie **w jednym module** (często: obie zostały podniesione do tej samej granicy `BASELINE_THROUGH + 1s`), a potem je scalono. | Przesuń jedną z nich o pełną sekundę — zmień nazwę pliku **i** klasy, a potem wygeneruj rejestr ponownie. W obrębie modułu znacznik czasu to cała kolejność, więc kolizja jest głośna i wskazuje obie klasy, zamiast po cichu zmieniać kolejność. Ten sam znacznik w dwóch *różnych* modułach jest dozwolony i nie jest zgłaszany. |
| `migration "…" is owned by module "orders", so it must be named Migration…Orders…` | Końcówka nazwy klasy migracji nie zaczyna się od segmentu jej modułu. | Zmień nazwę klasy (i pliku, z którego jest wyprowadzana). Nazwa to klucz, pod którym baza zapisuje wykonane migracje; zawężenie jej do modułu sprawia, że jest unikalna w całej platformie. |
| `migration "…" declares the unknown owning module "x"` | Zupełnie nowy moduł, którego manifestu nie ma w wygenerowanym indeksie. | `pnpm --filter backend run manifest-index:generate` |
| `migration class "…" does not match the naming convention` | Plik napisany albo przemianowany ręcznie; klasa i nazwa pliku się nie zgadzają. | Wyprowadź nazwę klasy z nazwy pliku ponownie (zobacz tabelę wyżej) albo utwórz szkielet od nowa. |
| Zabezpieczenie porównujące w obie strony wskazuje plik lub klasę | Migracja na dysku bez wpisu w rejestrze albo odwrotnie. | `pnpm --filter backend run composer:generate` i zatwierdzenie artefaktu. |
| `db:fresh` kończy się błędem na kluczu obcym, który łańcuch powinien był już utworzyć | Moduł odwołujący się nie deklaruje modułu, który jest właścicielem tabeli docelowej. | Dodaj go do `dependencies` w `manifest.ts` modułu odwołującego się albo przenieś ograniczenie do migracji należącej do modułu, który jest właścicielem tabeli odwołującej się. **Nie zmieniaj znacznika czasu** — znacznik nie naprawi problemu kolejności między modułami, a `fk-dependency-drift.test.ts` i tak przerwie build z powodu niezadeklarowanej krawędzi. |

Dwie rzeczy nigdy nie naprawiają niespodzianki w kolejności: **przesunięcie wiersza w
wygenerowanym rejestrze** (kolejność deklaracji to nie kolejność wykonania, a ponowne
wygenerowanie ją przywraca) oraz **podbicie znacznika czasu** (znacznik nie porządkuje niczego poza
własnym modułem). Rozwiązaniem jest zawsze `dependencies` w manifeście.

## Blok bazowy i zmiana nazwy wykonanej migracji

`mikro_orm_migrations` zapisuje wykonane migracje **po nazwie**, a te nazwy to nazwy klas. Nazwa
klasy jest mechanicznie wyprowadzana z nazwy pliku, więc **przeniesienie pliku migracji zmienia jej
nazwę**: przeniesienie `modules/settings/migrations/20260430T101450_settings_init.ts` do
`db/migrations/` wymusza segment `core`, a `Migration20260430T101450SettingsInit` staje się
`Migration20260430T101450CoreSettingsInit`.

Wcześniejszy schemat zawierał zamrożoną mapę zmian nazw i asercję przy starcie, która utrwalała
każdą historyczną nazwę klasy, aby baza wdrożona w starym schemacie nie wykonała ponownie 112
migracji. Obie zostały później wycofane: nie ma żadnej wdrożonej bazy, a asercja uniemożliwiała
uprawnione przeniesienie. Została **pozycyjna** granica `BASELINE_THROUGH`, która ustala tylko
*kolejność* bloku historycznego. Zmiana nazwy klasy w tym bloku nie wpływa na wynikową kolejność
**po ponownym wygenerowaniu opublikowanej listy bazowej** — do bloku trafia się po nazwie, więc
dopóki nie uruchomi się `composer:generate`, przemianowanej klasy nie ma na liście, trafia do bloku
otwartego, a `instance-migration-order.test.ts` zgłasza ją w obu kierunkach.

Dla istniejącej bazy danych zmiana ma jednak skutki. Po zmianie nazwy umzug — który wyznacza
oczekujące migracje jako `list.filter(name not in executed)` — widzi nową nazwę jako niewykonaną i
ponownie wykonuje migrację na schemacie, który już ją zawiera:

- `pnpm --filter backend run test` kończy się błędem w `globalSetup`, które wykonuje
  `migrator.up()`, z komunikatem w rodzaju `relation "settings" already exists`. Wtedy każdy plik
  testów kończy się błędem, a komunikat wskazuje migrację, a nie zmianę, która to spowodowała.
- `pnpm run dev` kończy się tak samo przy starcie.
- Dzięki `allOrNothing: true` i `transactional: true` ponowne wykonanie jest wycofywane, a nie
  wykonywane do połowy: tracisz przebieg, a nie bazę danych.

Zmiana nazwy wymaga więc skoordynowanej przebudowy bazy **deweloperskiej** — każdy programista
uruchamia `pnpm --filter backend run db:reset` w tym samym czasie, w którym następuje scalenie.

Zestaw testów nie wymaga żadnej interwencji. Zmigrowany szablon, z którego klonowane jest każde
uruchomienie, nazywa się `<base>_tpl_<digest>`, a skrót obejmuje uporządkowane nazwy klas migracji i
treść każdego pliku migracji — więc przemianowana klasa to *inny* zestaw migracji, a następne
uruchomienie buduje własny szablon, zamiast próbować wykonać cokolwiek ponownie w istniejącym. CI
buduje pustą bazę i też nie wymaga interwencji. `db:fresh` i `db:reset` czytają `backend/.env` i
domyślnie działają na bazie **deweloperskiej**, więc gdy chodzi ci o inną bazę, zawsze podawaj
`DATABASE_URL` jawnie.

## Cofanie migracji przy odinstalowaniu modułu {#module-uninstall-migration-revert}

Twarde odinstalowanie modułu cofa jego migracje. Są wybierane z `MIGRATION_REGISTRY` według
`moduleId`, sortowane rosnąco i cofane w odwrotnej kolejności przez
`migrator.down({ migrations: [name] })`. Rosnące sortowanie nazw jednego modułu *jest* kolejnością
wynikową — `orderMigrations()` gwarantuje chronologię w obrębie modułu — co pozwala mechanizmowi
cyklu życia importować rejestr (czyste dane) bez importowania `mikro-orm.config.ts`.

Zastąpiło to wyszukiwanie według wzorca nazwy pliku (`^\d+_<moduleId>_` tylko w
`backend/src/db/migrations/`), które nigdy nie mogło działać: szukało migracji modułów w złym
katalogu i przekazywało nazwy plików tam, gdzie zapisane są nazwy klas, więc twarde odinstalowanie
po cichu **niczego** nie cofało i tylko zapisywało wpis w logu. Jeśli moduł nie ma żadnej
zarejestrowanej migracji, mechanizm cyklu życia zapisuje ostrzeżenie i niczego nie cofa — twarde
odinstalowanie polega wtedy na `uninstallHook` modułu.

Przez to `moduleId` w rejestrze ma znaczenie wykraczające poza kolejność: **umieszczaj migrację w
module, który jest właścicielem tabel, do których zapisuje.** Migracje ustawień i kanałów sprzedaży
były kiedyś umieszczone w swoich modułach, choć właścicielem tych tabel jest jądro, więc
`modules:uninstall --hard settings` usuwało `settings`, `setting_groups` i `setting_values`.
`backend/test/unit/db/kernel-migration-ownership.test.ts` przerywa teraz build, gdy migracja
należąca do modułu zapisuje do tabeli należącej do jądra; oba zbiory są wyprowadzane (z drzewa encji
i z SQL każdej migracji), a nigdy wyliczane ręcznie.
