---
title: Migracje bazy danych (nazewnictwo, rejestr i kolejność)
---

# Migracje bazy danych

Migracje to **pliki lokalne dla modułu z nazwami w znaczniku czasu UTC**, zarejestrowane
raz w jednym statycznym rejestrze i wykonywane **moduł po module, w kolejności
topologicznej grafu zależności manifestów modułów** (feature `081`). Znacznik czasu
porządkuje własne migracje modułu i nic poza tym. Nie ma repo-wide numeru migracji ani
ręcznie utrzymywanej listy wykonania.

Feature `065` porządkował po znaczniku czasu i *korygował* wynik grafem zależności w
horyzoncie 45 dni. Feature `081` to odwrócił: graf jest kolejnością, a horyzont,
krawędzie korekcyjne i błąd `unresolvable-order` zniknęły. Powód: zbiór modułów
przestał być ustalony w czasie buildu — zainstalowany pakiet npm wysyła własne encje
i migracje, a jego autor nie zna historii hosta, więc reguła porządkująca po
znaczniku, który wybierze, nie porządkuje niczego.

Mechanizm niosą dwa pliki, oba pod `backend/src/db/`:

| Plik | Rola |
|------|------|
| `migrations-registry.generated.ts` | Jedyny punkt rejestracji — jeden statyczny import + jeden wpis na migrację, pogrupowane według modułu właściciela. **Generowany** z przejścia po filesystem przez `scripts/generate-composer.ts` i commitowany; nigdy nie edytowany ręcznie. |
| `migration-order.ts` | Czysta funkcja `orderMigrations()` obliczająca kolejność wykonania, plus znak wodny `BASELINE_THROUGH` i `historicalBaselineOrder()`, jedyna derivacja kolejności zamrożonego prefiksu. Bez I/O, bez zegara, bez ORM. |
| `@endora-commerce/platform/migrations` | `BASELINE_MIGRATIONS` — zamrożony historyczny prefiks jako uporządkowana lista nazw klas, generowana przez `composer:generate`. Host-internal: żaden moduł nie może nazwać tego subpath. |

`mikro-orm.config.ts` tylko je łączy; nie trzyma wiedzy o kolejności.

## Dlaczego usunięto globalny licznik

Każda migracja kiedyś rościła sobie „następny wolny numer” w całym repo
(`001_foundation_init.ts` → `Migration001FoundationInit`). Ta konwencja sama w sobie
zawiodła:

- **Cztery numery użyto dwukrotnie**, każdy przez inny moduł: `044`
  (`catalog/044_product_status_inactive` vs `catalog/044_product_value_overrides_init`),
  `068` (`prompt_actions` vs `catalog`), `069` (`settings` vs `carts`), `080`
  (`returns` vs `pwa`).
- **`078` pominięto całkowicie** — licznik nie niósł informacji, na której ktokolwiek
  polegał.
- **Kolejność listy już rozeszła się z kolejnością numeryczną.** MikroORM przekazuje
  `migrationsList` do umzug *niesortowaną*, więc kolejność tablicy w pliku konfiguracyjnym
  — nie numer w nazwie pliku — to, co faktycznie wykonały wdrożone bazy. Tablica szła
  `…068_prompt_actions, 069_settings_secret, 068_product_packaging,
  069_cart_item…`.
- **Każda gałąź konfliktowała.** Dwie równoległe gałęzie dodawały import i wpis w tym
  samym miejscu 565-liniowego pliku, więc konflikt merge był gwarantowany nawet gdy
  dwie migracje nie miały ze sobą nic wspólnego.

Schemat ze znacznikiem czasu usuwa krok koordynacji: dwóch developerów na dwóch gałęziach
nigdy nie trzeba uzgadniać, a rejestr jest partycjonowany per moduł, więc ich edycje
nie dotykają tych samych linii.

## Konwencja nazewnictwa

Jedyna autorytatywna wypowiedź jest w
`specs/065-manifest-aware-migrations/contracts/naming-convention.md`. W skrócie:

```text
<YYYYMMDDTHHmmss>_<SEGMENT>_<SLUG>.ts
```

| Część | Reguła |
|------|------|
| Znacznik czasu | UTC, stała szerokość (15 znaków), literalne `T` na indeksie 8. Bez `Z`, bez separatorów. Sortowalne leksykograficznie. **Unikalne w obrębie własnego modułu** — dwa moduły mogą legalnie dzielić ten sam stamp, bo po feature `081` stamp nie porządkuje niczego poza modułem, a dwóch autorów pakietów nie da się skoordynować. |
| `<SEGMENT>` | Id modułu właściciela z odciętym wiodącym `_`; literalne `core` dla migracji cross-cutting w `backend/src/db/migrations/`. |
| `<SLUG>` | `snake_case` (`[a-z0-9_]+`) opisujące zmianę. |

**Nazwa klasy jest wyprowadzana mechanicznie** z nazwy pliku: usuń rozszerzenie,
PascalCase każdego segmentu oddzielonego `_` z ogona (tylko pierwszy znak każdego
segmentu wielką literą, więc `i18n` → `I18n`), i prefiks `Migration` + znacznik czasu:

| Nazwa pliku | Nazwa klasy |
|----------|------------|
| `20260424T165847_core_foundation_init.ts` | `Migration20260424T165847CoreFoundationInit` |
| `20260507T091405_i18n_admin_i18n_init.ts` | `Migration20260507T091405I18nAdminI18nInit` |
| `20260724T193611_orders_order_placement_intents.ts` | `Migration20260724T193611OrdersOrderPlacementIntents` |

Normalizacja segmentu ma dokładnie dwa przypadki specjalne:

| Katalog właściciela | `<SEGMENT>` | `moduleId` w rejestrze |
|------------------|-------------|---------------------|
| `packages/modules/orders/src/migrations/` | `orders` | `'orders'` |
| `packages/modules/_i18n/src/migrations/` | `i18n` | `'_i18n'` |
| `packages/platform/src/lifecycle/migrations/` | `lifecycle` | `'_lifecycle'` |
| `backend/src/db/migrations/` | `core` | `'core'` |

**Ogon nazwy klasy musi zaczynać się od segmentu modułu**, i to reguła już teraz, nie
tylko konsekwencja wyprowadzania nazwy ze ścieżki (feature `081`). To, co czyni nazwy
klas globalnie unikalnymi bez rejestru, namespace ani hasha: id modułów są unikalne
platform-wide, więc `Migration<stamp>Orders…` nie może kolidować z migracją innego
modułu. `orderMigrations()` odmawia naruszenia jako `unscoped-name` — jedyne miejsce,
gdzie nazwa pakietu może być sprawdzona — a `scripts/check-naming.sh` odmawia tego
w drzewie core w czasie buildu. Wszystkie 141 migracji już to spełniały, gdy reguła
weszła.

**Nazwa klasy to nazwa migracji zapisywana w `mikro_orm_migrations.name`.**
Zmiana nazwy klasy zastosowanej migracji to więc problem bazy, nie refaktor:
każda baza, która ją już uruchomiła, widzi nową nazwę jako oczekującą. Nic w
repozytorium nie zabrania rename — patrz „Zmiana nazwy zastosowanej migracji” poniżej,
co to kosztuje i jak to wysłać.

## Jak utworzyć migrację

Ta sekcja dotyczy **własnych** modułów tego repozytorium — członka workspace deklarującego
`endora: { type: 'module', id }`, modułu pod rootem źródeł aplikacji albo migracji
cross-cutting pod `backend/src/db/migrations/`. Oba polecenia poniżej wymagają layoutu
tego repozytorium. Jeśli piszesz moduł wysyłany jako zainstalowany pakiet npm, żadne
z nich nie jest dostępne: przejdź do
[Jak utworzyć migrację w pakiecie rozszerzenia](#jak-utworzyć-migrację-w-pakiecie-rozszerzenia).

```bash
pnpm --filter backend run migration:new -- --module orders --name placement_intents
```

Scaffolder (`backend/scripts/new-migration.ts`):

1. waliduje `--module` względem id, które **wygenerowany indeks manifestów** rejestruje
   (plus literal `core`), i wypisuje poprawne id, gdy nie pasuje;
2. rozwiązuje **wolny znacznik UTC**, przesuwając o pełne sekundy, dopóki żaden plik
   migracji nigdzie w drzewie go nie używa. Wolność w całym drzewie to porządek, nie
   kolejność: wymagana jest tylko unikalność per moduł;
3. **clampuje znacznik powyżej `BASELINE_THROUGH`.** Dzisiejszy zegar ścienny może być
   nadal *wcześniejszy* niż `BASELINE_THROUGH = 20260801T000000`; naiwny stamp wylądowałby
   wtedy w zamrożonym historycznym prefiksie, którego kolejność to historia i nigdy nie
   jest przeliczana — migracja byłaby uporządkowana tą historią zamiast zależnościami
   modułu. Scaffolder emituje stamp jedną sekundę za znakiem wodnym;
4. zapisuje plik z szablonu do własnego katalogu `migrations/` modułu i odmawia celu,
   którego generator rejestru nie podniesie — scaffolder piszący tam, gdzie nic nie czyta,
   produkuje migrację, która nigdy nie uruchomi się i nic nie mówi.

**Gdzie ten katalog leży, jest rozwiązywane i nigdy nie jest wypisywane.** Wszystkie trzy
pytania powyżej — które id są poprawne, które stampy są zajęte, gdzie idzie plik — biorą się
z `backend/scripts/lib/module-roots.ts`, tej samej derivacji, którą dzieli estate checków
statycznych: lokalizowany jest wygenerowany indeks manifestów, a katalog modułu to albo
jeden pod rootem źródeł aplikacji, albo członek workspace deklarujący
`endora: { type: 'module', id }`. Katalog `migrations/` pakietu modułu to katalog, który
jego mapa `exports` publikuje jako `./migrations`. Każdy z nich był literałem ścieżki
czytającym `backend/src/modules`, dopóki 2026-08-30, dlatego narzędzie odpowiadało
`Valid ids are: core.` dla każdego modułu w tym repozytorium, gdy F4 opróżniło ten katalog.

Zarejestruj ją przez regenerację commitowanego rejestru i commit obu plików:

```bash
pnpm --filter backend run composer:generate
```

Generator przechodzi `src/db/migrations/` i każdy `src/modules/<id>/migrations/`,
wyprowadza nazwę klasy z nazwy pliku i odmawia — zamiast pomijać — pliku, którego nie
może umieścić: nierozpoznanego `.ts` w katalogu migracji, klasy, której plik nie
eksportuje, dwóch plików wyprowadzających tę samą nazwę albo migracji pod
`src/apps/<deployment>/` (moduły overlay nie mogą wysyłać migracji, więc rejestracja
jednej byłaby nową capability zamiast efektu ubocznego generowania listy).

**Niezarejestrowana migracja nie uruchamia się.** Rejestr to lista statycznych importów,
nie glob (odkrywanie glob wymaga runtime dynamicznego `import()` `.ts`, czego loader ESM
Node nie transformuje i co psuje się pod Vitest — ten sam powód, dla którego istnieje
`entities-registry.generated.ts`, i emituje to samo polecenie). Straż round-trip
`backend/test/unit/db/migrations-registry.test.ts` failuje build dla pliku bez wpisu,
wpisu bez pliku, nazwy klasy niezgodnej z nazwą pliku, zadeklarowanego `moduleId`
sprzecznego z katalogiem właściciela, segmentu nazwy pliku sprzecznego z id modułu,
nierozpoznanego pliku `.ts` w katalogu `migrations/` i każdego pozostałego pliku
`NNN_`-numerowanego.

`mikro-orm migration:create` / `migration:generate` **nie są sankcjonowane**: piszą
do jednej skonfigurowanej ścieżki i nie znają modułu właściciela.

:::note Pliki pomocnicze
Niemigracyjny helper `.ts` może żyć w katalogu `migrations/`, ale musi być na
jawnej allow-liście straży — dziś dokładnie jeden wpis,
`packages/modules/quote_requests/src/migrations/status-mapping.ts`. Allow-list istnieje,
żeby literówka w nazwie pliku migracji failowała głośno zamiast cicho znikać z migratora.
:::

## Jak utworzyć migrację w pakiecie rozszerzenia

Wszystko powyżej to drzewo tego repozytorium. Moduł wysyłany jako **zainstalowany** pakiet
npm (`endora.type: "module"` w `package.json`) nie może uruchomić żadnego z poleceń:
`migration:new` rozwiązuje moduł przez członków workspace tego checkoutu i wygenerowany
indeks manifestów, a żaden z nich nie sięga `node_modules`, i oba wygenerowane rejestry
są celowo core-only — które pakiety instancja zainstalowała, to fakt o *procesie*, nie
o drzewie, więc commitowany artefakt nie może twierdzić, że to wie. Host odkrywa migracje
pakietu w runtime przez własny export `./migrations`.

**Nie ma scaffoldera i nie jest wymagany.** Poprawna migracja pakietu jest pisana ręcznie,
a cały kształt mieści się na tej stronie. (`endora new migration` jest planowane jako
subcommand binarnego `@endora-commerce/cli`; gdy wejdzie, wyemituje dokładnie to, co
poniżej, a ta sekcja będzie na nie wskazywać.)

Przykład pracy jest w tym repozytorium:
**`backend/acceptance/fixture-package/`** — syntetyczny pakiet modułu third-party,
zbudowany i zainstalowany z spakowanego tarballa przez run akceptacji packagingu, którego
jedna migracja tworzy prawdziwą tabelę w prawdziwej bazie.

### 1. Napisz plik migracji

Umieść go pod `src/migrations/` pakietu, nazwany tak jak core:

```
<YYYYMMDDTHHmmss>_<your module segment>_<slug>.ts
```

| Część | Reguła |
|------|------|
| Znacznik czasu | UTC, stała szerokość (15 znaków), literalne `T` na indeksie 8. Bez `Z`, bez separatorów. |
| `<segment>` | Id modułu — pole `endora.id` w `package.json` — z odciętym wiodącym `_`. |
| `<slug>` | `snake_case` (`[a-z0-9_]+`) opisujące zmianę. |

**Nazwa klasy jest wyprowadzana mechanicznie z tej nazwy pliku**: usuń rozszerzenie,
PascalCase każdego segmentu oddzielonego `_` z ogona (tylko pierwszy znak, więc `i18n` → `I18n`),
i prefiks `Migration` + znacznik czasu. Eksportuj jako named export.

| `endora.id` | Nazwa pliku | Nazwa klasy |
|-------------|----------|------------|
| `acceptance_probe` | `20260821T120000_acceptance_probe_init.ts` | `Migration20260821T120000AcceptanceProbeInit` |
| `acme_gateway` | `20260901T093000_acme_gateway_payouts.ts` | `Migration20260901T093000AcmeGatewayPayouts` |

Dla pakietu *nazwa pliku* to konwencja, której host nie czyta — host dostaje klasy, nie
ścieżki. **Nazwa klasy nie jest konwencją.** To string, który host zapisuje w
`mikro_orm_migrations.name`, i dwa bity reguł:

- **Ogon musi zaczynać się od `PascalCase(<your module segment>)`.** To czyni nazwy klas
  globalnie unikalnymi w całej kompozycji modułów platformy — *w tym twoje*, i to cały
  powód reguły: id modułów są unikalne platform-wide (discovery odmawia pakietu roszczącego
  się już zajęte, a `composeModules` asertuje unikalność przed pierwszą rejestracją),
  więc nazwa scoped przez id modułu nie może kolidować z core ani innym vendorem. Nie ma
  rejestru, namespace ani hasha robiącego tę robotę. Nazwanie pliku jak wyżej daje zgodną
  nazwę klasy za darmo.
- **Nigdy nie jest zmieniana po zastosowaniu gdziekolwiek.** Host liczy oczekujące migracje
  jako „nazwy spoza `mikro_orm_migrations`”, więc rename w wersji 1.2 pakietu to *nowa*
  migracja dla każdej bazy, która uruchomiła starą, i zostanie ponownie zastosowana
  względem schematu, który już ją ma. Wyślij nową migrację zamiast tego.

Migracja fixture, dosłownie — komentarz nad nią w źródle rejestruje reguły, których
się trzymała:

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

### 2. Wymień ją w eksporcie `./migrations` — nic innego tego nie zrobi

Entry point `./migrations` pakietu eksportuje tablicę klas migracji (gołe klasy albo pary
`{ name, class }`, których `name` musi równać się własnej klasie). Host czyta tę tablicę,
taguje każdy wpis `origin: 'external'` i wstawia łańcuch w kolejność wykonania na pozycji
topologicznej modułu. `backend/acceptance/fixture-package/src/migrations/index.ts`
to przykład pracy.

:::danger To jedyny błąd, który jest cichy
**Plik migracji, którego tablica `./migrations` nie wymienia, nigdy nie uruchomi się**,
a pierwszy objaw to błąd zapytania względem tabeli, która nie istnieje. W drzewie core
równoważny błąd zamyka generator — `composer:generate` przechodzi katalog, a straż
round-trip failuje build dla pliku bez wpisu. **Pakiet nie ma równoważnika i nie dostanie
go tutaj**: nic w hoście nie grepuje pakietu, z założenia. Utrzymanie tej tablicy kompletnej
to praca autora, i żaden check w tym repozytorium nie zrobi tego za ciebie.
:::

Reszta failuje głośno — patrz *Gdy nazewnictwo jest błędne* poniżej.

### 3. Zadeklaruj w `dependencies` manifestu każdy moduł, którego tabele referencjonujesz

Kolejność wykonania to topologiczny przejście grafu zależności manifestu, więc wpis
`dependencies` w manifeście to **jedyne**, co stawia migrację po tabeli, którą
referencjonuje. Jeśli migracja dodaje klucz obcy do `orders`, manifest deklaruje `orders`
— to, i tylko to, czyni constraint stosowalnym na świeżej bazie. Fixture deklaruje `auth`
dokładnie z tego powodu.

Nie ma innej dźwigni. Przesunięcie znacznika tego nie zrobi (patrz poniżej), i nie ma
krawędzi kolejności per migracja.

### Co znacznik czasu porządkuje, a czego nie

To część odwrotna od tego, czego uczy schemat numeracji sekwencyjnej, i to, co czyni
ręczne autorstwo bezpiecznym:

- **W obrębie modułu** znacznik to cała kolejność: migracje idą rosnąco po stampie,
  ciągle. Dwie własne migracje dzielące stamp to błąd (`duplicate-timestamp`).
- **Między modułami znacznik nic nie znaczy.** Dwa moduły mogą legalnie dzielić jeden.
  Permutacja stampów dwóch migracji w niepowiązanych modułach nie zmienia emitowanej
  kolejności. Nie przesuniesz migracji względem hosta — ani innego vendora — wyborem
  stampu, w żadnym kierunku.

Cała reguła stampu dla autora pakietu to więc: **nowszy niż twoja najnowsza migracja.**
Nie potrzebujesz wiedzy o historii hosta, co jest szczęśliwe, bo jej nie masz.

### `BASELINE_THROUGH` to fakt drzewa core i nie dotyczy ciebie

Scaffolder core clampuje każdy nowy stamp core powyżej `BASELINE_THROUGH` (`20260801T000000`),
a `AGENTS.md` tego repozytorium mówi autorom core, żeby nigdy nie scaffoldować migracji
na lub przed nim. **Ta instrukcja nie jest do ciebie skierowana, a drzwi, przed którymi
ostrzega, tam nie ma.** Członkostwo w baseline to **tożsamość**:

```
isBaseline(entry) ⇔ entry.class.name ∈ BASELINE_MIGRATIONS
```

`BASELINE_MIGRATIONS` to uporządkowana lista 112 nazw klas, którą `@endora-commerce/platform`
publikuje na subpath `./migrations` — własna historia tej platformy, którą dostajesz
instalując platformę. Twoja migracja na niej nie jest i nie może do niej dołączyć, więc
**twój stamp nigdy nie jest porównywany ze znakiem wodnym w ogóle**. Wybierz stamp poniżej
— nawet lata poniżej — a migracja nadal jest w otwartym bloku, nadal na pozycji
topologicznej modułu, nadal uporządkowana przez `dependencies` manifestu; bez tej gwarancji
back-dated stamp third-party wylądowałby przed własną migracją fundamentu platformy
(zmierzone: indeks 0 z 143).

Członkostwo kiedyś brało dwa warunki, `(entry.origin ?? 'core') === 'core'` **i** stamp,
a pierwszy zamykał te drzwi. Zastąpiono je, bo odpowiada *„czy to wyszło z buildu hosta”*
zamiast *„czy to jedna z migracji, których kolejność to historia”* — dwa pytania takie
same tylko dopóki każdy moduł jest skompilowany w aplikacji. W chwili, gdy moduły są
zainstalowanymi pakietami, jak w instancji, pierwsze odpowiada `false` dla każdego z nich:
prefiks spada z 112 wpisów do 11, 181 z 182 pozycji się przesuwa, a sześć migracji kończy
uporządkowanych przed migracją tworzącą dotykaną tabelę. Reguła tożsamości zamyka te
same drzwi ciaśniej, bo nazwy nie może rościć się przybywający pakiet — patrz
`specs/110-instance-repository/contracts/instance-migration-order.md`.

Wybierz sensowny stamp i tak. Ale dla własnego łańcucha, nie dla hosta.

### Gdy nazewnictwo jest błędne

Wszystkie cztery reguły nazewnictwa są egzekwowane w `orderMigrations()` Step 1, do
którego host dochodzi inicjalizując ORM. Każda rzuca `MigrationOrderError` nazywając
klasę, moduł i sekcję kontraktu — zanim jakakolwiek migracja uruchomi się, i bez
niczego w połowie zastosowanego:

| Błąd | Co oznacza |
|-------|---------------|
| `unparsable-name` | Nazwa klasy nie jest `Migration<YYYYMMDDTHHmmss><PascalCaseTail>`, albo stamp nie nazywa prawdziwej chwili UTC. |
| `unscoped-name` | Ogon nie zaczyna się od segmentu modułu. Komunikat podaje oczekiwany prefiks. |
| `duplicate-name` | Dwie migracje w całej kompozycji dzielą nazwę klasy — twoja i czyjaś, albo dwie twoje. To klucz bazy, więc musi być globalnie unikalna. |
| `duplicate-timestamp` | Dwie **twoje** migracje dzielą stamp. Przesuń jedną o pełną sekundę, w nazwie pliku i nazwie klasy razem. |

:::note To zatrzymuje hosta, nie tylko twój moduł
`MigrationOrderError` jest podnoszony podczas inicjalizacji ORM hosta, więc błąd
nazewnictwa w zainstalowanym pakiecie uniemożliwia start platformy zamiast wyłączenia
pakietu, który go zrobił. Ta asymetria — *cykl* zadeklarowany przez pakiet jest złagodzony
do ostrzeżenia dziesięć linii dalej, z podanego powodu, że cudzy manifest nie może
zatrzymać migracji schematu sklepu — to znane otwarte pytanie, zapisane w
`specs/deferred-defects.md`. Dopóki nie będzie odpowiedzi, traktuj błąd nazewnictwa
jako awarię w cudzym sklepie.
:::

### Co pakiet może, a czego nie może wysyłać

Pakiet może wysyłać encje i migracje. **Moduł overlay per deployment** pod
`backend/src/apps/` nie może (generator odmawia obu) — jego remedium jest zawsze dostępne
i nic nie kosztuje poza katalogiem: posiadaj tabelę z modułu core i czytaj przez port
tego modułu. Autor third-party nie ma modułu core, dlatego odpowiedź się różni. Patrz
`docs/docs/architecture/overlay-pattern.md`.


## Reguły kolejności

`orderMigrations()` (`backend/src/db/migration-order.ts`) to czysta funkcja: te same
wejścia, ten sam wynik, bez bazy, bez zegara, bez środowiska. Emitowana kolejność to
konkatenacja **dwóch bloków**.

**1. Blok baseline — zamrożony historyczny prefiks.** Każdy wpis, którego nazwa klasy
jest na liście, którą `@endora-commerce/platform` publikuje jako `BASELINE_MIGRATIONS`,
emitowany w kolejności, którą ta lista trzyma. Ten blok jest sprzed feature `065`: był
pisany i stosowany w ręcznie utrzymywanej kolejności tablicy, której manifesty nie
opisują — sprzeczają się z nią w 37 miejscach — więc emitowanie go inaczej produkuje
kolejność, której świeża baza nie może zastosować. Jest zamknięty, nigdy nie rośnie
(scaffolder clampuje każdy nowy stamp core powyżej znaku wodnego), i nic nie powinno
próbować go opróżniać.

Lista jest **generowana** przez `composer:generate` z tego, co commitowany rejestr core
wnosi na lub przed `BASELINE_THROUGH` (`20260801T000000`) — więc znak wodny to reguła
czasu generacji, a żaden runtime test członkostwa go nie pyta. Żyje w pakiecie platformy,
bo to dane o *historii tej platformy*: klient dostaje je instalując platformę, a korektę
przez `pnpm update`. Żaden moduł nie może nazwać tego subpath.

Jego 112 nazw jest też przypiętych jako commitowany literal w
`backend/test/unit/db/migration-order-baseline.test.ts`, w kolejności, w jakiej baza je
zastosowała, uchwyconej przed przepisaniem algorytmu kolejności. Ten literal nigdy nie
jest regenerowany — baseline przeliczony z kodu, który strzeże, nic nie mierzy — a
wygenerowana lista jest trzymana względem niego, nazwa po nazwie i pozycja po pozycji.
To czyni wygenerowany artefakt godnym zaufania, a nie tylko deterministycznym.

Członkostwo jest **tożsamością** i niczym więcej, najsilniejszą formą reguły, jaką ten
blok miał. Test tylko-stamp pozwalał migracji, która przyszła spoza commitowanego
rejestru, dołączyć do prefiksu, którego kolejność to historyczny fakt: zmierzone,
migracja pakietu ze stamp `20250101T000000` była emitowana na indeksie 0, przed własną
migracją fundamentu platformy. Zamknięto to na czas, wymagając też `origin === 'core'`,
a koniunkcja odpowiadała *„wyszło z buildu tego repozytorium”*, używana w sensie
*„jest jedną z migracji, których kolejność to historia”* — dwa pytania zbiegające się
tylko dopóki każdy moduł jest skompilowany. **Nazwy** w ogóle nie może rościć się
przybywający pakiet, cokolwiek deklaruje o origin, więc o pochodzeniu wpisu nie pyta się
już wcale.

**2. Otwarty blok — wszystko inne, moduł po module.** Moduły sortuje się topologicznie
po grafie kolejności, remisy łamane rosnącym id modułu, a migracje każdego modułu
emituje ciągle w rosnącej kolejności stampów.

- **Graf kolejności** ma węzły id modułów i krawędzie `dependencies` manifestu i **nie
  czyta żadnej innej tablicy manifestu** — ani `acknowledgedDependencies`, ani
  `nonBindingDependencies`, z których żadna nie jest roszczeniem kolejności.
- Pseudomodul `core` sortuje się pierwszy. Nic nie deklaruje i nic go nie deklaruje,
  więc zawsze jest gotowy; tabele każdego modułu siedzą downstream od tabel bootstrap.
- **Stamp nigdy nie przekracza granicy modułu.** Jeśli moduł `A` deklaruje `B`, każda
  otwarta migracja `A` idzie po każdej otwartej migracji `B` — jak daleko apart ich
  stampy i w dowolnym kierunku chronologicznym. Nie ma horyzontu.
- **Determinizm.** Sort topologiczny opróżnia ready set najmniejszym id modułu,
  więc emitowana kolejność jest bajtowo identyczna między permutacjami wejścia i między
  runami. Podanie wyjścia z powrotem daje to samo wyjście.

Zagrożenie, dla którego to istnieje: gałąź A dodaje migrację `catalog` w środę, gałąź B
dodaje migrację `orders` w poniedziałek, której klucz obcy celuje w kolumnę z gałęzi A.
`orders` zależy tranzytywnie od `catalog`, więc cały blok `catalog` emituje się pierwszy
i świeża baza stosuje się czysto — bez renumeracji i bez koordynacji między gałęziami.
Pod feature `065` działało to tylko, gdy dwa stampy były w 45 dniach od siebie; teraz
działa bezwarunkowo.

### Cykle są raportowane, nie rzucane

Jeśli graf kolejności ma silnie spójną składową większą niż jeden moduł, kolejność nadal
jest liczona: migracje składowej emituje się jako jeden ciągły blok w kolejności stampów
w całej składowej — reguła bloku baseline, stosowana lokalnie, i jedyna zdefiniowana
odpowiedź, gdy deklaracje nie niosą kolejności. Składowa wraca jako **diagnostyka**, i
nic nie jest rzucane.

To celowe. Pod feature `065` graf był korekcją, więc odmowa cyklu nic nie kosztowała.
Teraz graf jest główną kolejnością, a manifest może przyjść z `node_modules`, więc throw
oznaczałby *jeden cudzo źle zadeklarowany pakiet zatrzymuje migrację core schematu tego
sklepu*. Trzech czytelników reaguje zamiast tego:

| Czytelnik | Reakcja |
|--------|----------|
| `backend/test/unit/db/module-graph.test.ts` | asertuje **zero** diagnostyk nad commitowanymi manifestami — cykl w tym repozytorium nadal to czerwony build |
| `backend/src/db/mikro-orm.config.ts` | loguje każdą diagnostykę na `warn`, nazywając członków |
| orchestrator `_lifecycle` | odmawia instalacji, której przybycie zamyka cykl, nazywając każdego członka i wychodząc z `65` |

Trzy reakcje różnią się celowo, a różnica to miejsce, w którym każda siedzi. Cykl
**w tym repozytorium** to błąd kogoś, kto może go naprawić przed wysyłką, więc to
czerwony build. Cykl **na działającej platformie** jest już wdrożony, więc platforma
mówi o tym i dalej serwuje — nic innego nie zostawiłoby operatora lepiej. Cykl, który
ma **nadejść**, jest odmawiany, bo instalacja to jedyny moment, gdy odmowa nic nie kosztuje:
nic downstream modułu jeszcze nie istnieje, a operator stoi tuż obok.

Odmowa jest scoped do przybywającego modułu: graf, który przechodzi, to zainstalowany
zbiór plus ten moduł, i odmawiana jest tylko składowa go trzymająca. Pętla między dwoma
już zainstalowanymi modułami nie blokuje instalacji trzeciego — odtworzyłoby to, jedno
polecenie później, dokładnie platform-wide stall, przed którym istnieje reguła no-throw.
Przechodzi graf z `findModuleCycles` z `migration-order.ts`, więc lista członków, którą
operator czyta przy prompt instalacji, to ta sama lista, którą wypisałby boot warning.

### Zaakceptowane ograniczenie

Migracja dodana później MOŻE zmienić względną kolejność dwóch migracji, które niektóre
bazy **już zastosowały**. To nieszkodliwe dla tych baz: umzug liczy oczekujące jako
`list.filter(name ∉ executed)`, więc zastosowana migracja jest odfiltrowana niezależnie
od pozycji na liście. Zmierzone na prawdziwej bazie zbudowanej pod kolejnością feature
`065`, a potem odczytanej z kolejnością feature `081`: **pending 0, executed
142, `up()` applied 0**. Świeże bazy są pokryte jobem CI backend, który tworzy pustą
bazę i stosuje cały łańcuch w każdym pipeline.

## Co oznacza `dependencies` w manifeście

Tablica `dependencies` manifestu modułu jest teraz **całym** wejściem kolejności
cross-module, więc musi być uczciwa — ale nadal oznacza **konieczność w czasie instalacji**,
nie „każdą tabelę, do której trzymam klucz obcy”. Czytaj to jako: *ten moduł nie może
działać bez tamtego.*

Gdy dwa moduły wyglądają na wzajemnie zależne, trzy reguły precedencji decydują, który
kierunek zostawić:

- **Reguła 1 — korzeń platformy.** Moduł platform-root (`settings`, `audit_logs`, …)
  nigdy nie zależy od modułu domenowego.
- **Reguła 2 — właściciel mostu.** Właściciel tabeli junction nigdy nie zależy od tego,
  co most łączy; moduł domenowy, który nie może działać bez mostu, deklaruje właściciela
  mostu. (`sales_channels` posiada `sales_channel_products`; `catalog`
  deklaruje `sales_channels`, nie odwrotnie — zgodnie z Zasadą XII.)
- **Reguła 3 — korzeń tenancy.** `organizations` to korzeń tenancy (Zasada XI) i
  nigdy nie zależy od modułów należących do tenantów.

**Każda upuszczona krawędź musi być skomentowana w manifeście, który by ją deklarował**,
nazywając klucze obce, które pokrywa, regułę, która ją upuszcza, i cykl, który stworzyłby,
gdzie go tworzy. Patrz `packages/modules/organizations/src/manifest.ts` dla przykładu
pracy.

Cykl w grafie to **czerwony build** — `module-graph.test.ts` failuje na każdej
diagnostyce. To nie błąd bootu: patrz „Cykle są raportowane, nie rzucane” powyżej.

## Walidator FK-drift

Backfillowany graf jest zamknięty blokującym checkiem:
`backend/test/unit/db/fk-dependency-drift.test.ts`.

Wyprowadza **każdy cross-module foreign key** z SQL migracji (ciała `create table` /
`alter table` w zakresie statementu, dopasowując `references "<table>"`), rozwiązuje
każdą tabelę do modułu właściciela (deklaracje `tableName` encji najpierw, potem
jawnie wyliczone `backend/test/unit/db/table-owner-overrides.ts` dla tabel mostu, których
żadna encja nie rości), i asertuje, że moduł referencjonujący **tranzytywnie deklaruje**
moduł referencjonowany w `dependencies` manifestu.

- To **czysty test jednostkowy**: bez bazy, bez bootstrapu ORM, działa w
  `pnpm --filter backend run test:unit` w znacznie poniżej sekundy.
- **Nie ma żadnego efektu runtime**. Nic pod `backend/src/` tego nie importuje, nie
  wpływa na `orderMigrations()`, a artefakty żyją w drzewie testów. Waliduje *wejście*,
  które konsumuje algorytm kolejności, nic więcej.
- Tabela stworzona migracją, której nie rości żadna encja ani override, **failuje**
  check, i tak samo klucz obcy, którego celu nie da się rozwiązać do modułu. Nigdy
  nie pomija cicho.

Błąd brzmi:

```text
[fk-drift] undeclared cross-module foreign key:
  orders.order_placement_intents → api_keys
  module "orders" references module "api_keys" but does not declare it
  (transitively) in backend/src/modules/orders/manifest.ts.

  Fix one of:
    (a) add 'api_keys' to `dependencies` in orders/manifest.ts  ← usually this
    (b) if the edge must stay undeclared (it would create a cycle), add an entry to
        backend/test/unit/db/acknowledged-fk-edges.ts with a reason and the cycle.
```

**Opcja (a) jest prawie zawsze właściwa.** Sięgnij po allow-list tylko gdy deklaracja
krawędzi stworzyłaby cykl — i wtedy jesteś winien powód, regułę precedencji i opis cyklu.

### Allow-list uznanych krawędzi

`backend/test/unit/db/acknowledged-fk-edges.ts` trzyma krawędzie, które reguły precedencji
celowo upuszczają — dziś 15, dopasowanych po parze modułów `(from, to)`. Każdy wpis
nosi `from`, `to`, `via` (konkretne pary tabel, dla blast radius), niepusty
`reason`, `rule` i stwierdzenie `cycle`.

Lista jest **asertowana minimalnością**, więc nie może rosnąć monotonicznie:

| Asercja | Efekt |
|-----------|--------|
| M1 | Wpis, którego underlying foreign key już nie istnieje, failuje jako stale. |
| M2 | Wpis, którego para modułów jest już spełniona przez graf manifestów, failuje jako dead weight. |
| M3 | Pusty `reason`, nieznana `rule` albo pusty `cycle` failują. |
| M4 | Duplikat pary `(from, to)` failuje. |
| M5 | 16. wpis failuje — cap to widoczny, recenzowalny akt, nie cichy append. |

:::note `cycle` ma szerszą semantykę niż „cykl, który to zamyka”
Zmierzone względem wysłanego grafu, tylko **6 z 15** wpisów faktycznie zamyka cykl
(`organizations → customer_accounts`; `sales_channels → catalog / cms /
customer_accounts / promotions`; `settings → sales_channels`), a
`organizations → inventory` zamyka jeden dopiero gdy zadeklarowana jest też krawędź
mostu `sales_channels`. Zamiast wymyślać ścieżki, pozostałe wpisy niosą jawne
stwierdzenie „no cycle on its own — dropped because …” nazywające powód precedencji.
M3 nadal asertuje, że pole jest niepuste w obu przypadkach.
:::

## Tryby awarii i ich naprawy

Wszystkie rzucają w **czasie budowy konfiguracji** — tj. przy pierwszym imporcie
`mikro-orm.config.ts` — z `MigrationOrderError` i actionable komunikatem.

| Objaw | Przyczyna | Naprawa |
|---------|-------|-----|
| `module "orders" has two migrations stamped 20260801T000001` | Dwie gałęzie scaffoldowały w tej samej sekundzie **w jednym module** (częste: obie były clampowane do tego samego floor `BASELINE_THROUGH + 1s`) i potem zmergowane. | Przesuń jedną o pełną sekundę — zmień nazwę pliku **i** klasy, potem regeneruj. W module stamp to cała kolejność, więc kolizja jest głośna i nazywa obie klasy zamiast cicho przesuwać. Dwie *różne* moduły dzielące stamp są legalne i nie są raportowane. |
| `migration "…" is owned by module "orders", so it must be named Migration…Orders…` | Klasa migracji, której ogon nie zaczyna się od segmentu modułu. | Zmień nazwę klasy (i pliku, który ją wyprowadza). Nazwa to klucz bazy dla tego, co uruchomiono; scoping przez moduł utrzymuje unikalność platform-wide. |
| `migration "…" declares the unknown owning module "x"` | Całkowicie nowy moduł, którego manifestu nie ma w wygenerowanym indeksie. | `pnpm --filter backend run manifest-index:generate` |
| `migration class "…" does not match the naming convention` | Plik pisany lub zmieniany ręcznie; klasa i nazwa pliku się nie zgadzają. | Wyprowadź ponownie nazwę klasy z nazwy pliku (patrz tabela powyżej) albo scaffolduj od nowa. |
| Straż round-trip failuje nazywając plik/klasę | Migracja na dysku bez wpisu rejestru albo odwrotnie. | `pnpm --filter backend run composer:generate` i commit artefaktu. |
| `db:fresh` failuje na kluczu obcym, który łańcuch powinien już stworzyć | Moduł referencjonujący nie deklaruje modułu właściciela referencjonowanej tabeli. | Dodaj go do `dependencies` w `manifest.ts` modułu referencjonującego albo przenieś constraint do migracji należącej do modułu właściciela tabeli referencjonującej. **Nie dotykaj znacznika** — po feature `081` stamp nie naprawia problemu kolejności cross-module, a `fk-dependency-drift.test.ts` i tak failuje build dla niezadeklarowanej krawędzi. |

Dwie rzeczy nigdy nie naprawiają niespodzianki kolejności: **przesunięcie linii w
wygenerowanym rejestrze** (kolejność deklaracji nie jest kolejnością wykonania, a
regeneracja ją przywraca) i **podbicie znacznika** (stamp nie porządkuje niczego poza
własnym modułem). Remedium to zawsze `dependencies` manifestu.

## Blok baseline i zmiana nazwy zastosowanej migracji

`mikro_orm_migrations` rejestruje wykonane migracje **po nazwie**, a te nazwy to
nazwy klas. Nazwa klasy jest wyprowadzana mechanicznie z nazwy pliku, więc **przeniesienie
pliku migracji ją zmienia**: przeniesienie
`modules/settings/migrations/20260430T101450_settings_init.ts` do `db/migrations/`
wymusza segment `core`, a `Migration20260430T101450SettingsInit` staje się
`Migration20260430T101450CoreSettingsInit`.

Feature `065` wysłał zamrożoną mapę rename i asercję boot-time pinującą każdą
pre-`065` nazwę klasy, żeby baza wdrożona pod starym schematem nie uruchomiła ponownie
112 migracji. Feature `072` wycofał oba: nie ma wdrożonej bazy, a asercja czyniła
legalną relokację niemożliwą. Został **znak wodny pozycji** `BASELINE_THROUGH`, który
naprawia tylko *kolejność* bloku pre-`065`. Rename klasy wewnątrz niego to no-op dla
emitowanej kolejności **po regeneracji opublikowanej listy baseline** — blok jest
wchodzony po nazwie, więc dopóki `composer:generate` nie uruchomisz, renamed klasa nie
jest na liście, dołącza do otwartego bloku, a `instance-migration-order.test.ts`
raportuje ją w obu kierunkach.

To nie jest no-op dla istniejącej bazy. Po rename umzug — liczący oczekujące jako
`list.filter(name not in executed)` — widzi nową nazwę jako niezastosowaną i uruchamia
migrację ponownie względem schematu, który już ją ma:

- `pnpm --filter backend run test` failuje w `globalSetup`, który uruchamia `migrator.up()`,
  z czymś w stylu `relation "settings" already exists`. Każdy plik testowy potem failuje,
  a komunikat nazywa migrację, nie zmianę, która to spowodowała.
- `pnpm run dev` failuje tak samo przy bootcie.
- `allOrNothing: true` i `transactional: true` oznaczają, że replay się wycofuje zamiast
  stosować w połowie: tracisz run, nie bazę.

Rename wysyła się więc ze skoordynowanym rebuildem **dev** bazy — każdy developer uruchamia
`pnpm --filter backend run db:reset` w tym samym oknie co merge.

Suite testów nie potrzebuje interwencji. Od issue #289 sklonowany szablon migracji,
z którego każde wywołanie startuje, nazywa się `<base>_tpl_<digest>`, a digest obejmuje
uporządkowane nazwy klas migracji i treść każdego pliku migracji — więc renamed klasa to
*inny* zestaw migracji, a następne wywołanie buduje własny szablon zamiast próbować
ponownie stosować cokolwiek do tego, który masz. CI buduje pustą bazę i też nie potrzebuje
interwencji. `db:fresh` i `db:reset` czytają `backend/.env` i domyślnie celują w bazę
**dev**, więc zawsze przekaż `DATABASE_URL` jawnie, gdy chodzi o cokolwiek innego.

## Cofanie migracji przy odinstalowaniu modułu

Hard-uninstall modułu cofa jego migracje. Rozwiązywane są z
`MIGRATION_REGISTRY` filtrowane po `moduleId`, sortowane rosnąco i cofane w odwrotnej
kolejności przez `migrator.down({ migrations: [name] })`. Sortowanie nazw jednego modułu
rosnąco *jest* rozwiązaną kolejnością — `orderMigrations()` gwarantuje chronologię
wewnątrz modułu — co pozwala orchestratorowi importować rejestr (czyste dane) bez
importu `mikro-orm.config.ts`.

Zastąpiło to skan wzorca nazwy pliku (`^\d+_<moduleId>_` tylko względem
`backend/src/db/migrations/`), który nigdy nie mógł działać: szukało w złym katalogu
migracji lokalnych modułu i przekazywało stemy nazw plików tam, gdzie zapisane nazwy to
nazwy klas, więc hard-uninstall cicho cofał **nic** i tylko logował. Jeśli moduł nie ma
zarejestrowanej migracji, orchestrator loguje ostrzeżenie i nic nie cofa — hard-uninstall
polega wtedy na `uninstallHook` modułu.

To czyni `moduleId` rejestru load-bearing poza kolejnością: **złóż migrację pod modułem,
który posiada tabele, które pisze.** Dopóki feature `072` T020 migracje settings i
sales-channel były nadal składane pod swoimi modułami, choć kernel posiada te tabele,
więc `modules:uninstall --hard settings` dropował `settings`, `setting_groups` i
`setting_values`. `backend/test/unit/db/kernel-migration-ownership.test.ts`
teraz failuje build, gdy migracja należąca do modułu pisze do tabeli należącej do kernela;
oba zbiory są wyprowadzane (z drzewa encji i z SQL każdej migracji), nigdy wyliczane.

---

Pełny design, kontrakty i uzasadnienie:

- **`specs/081-per-module-migration-order/contracts/`** — `ordering-algorithm.md` (bieżąca
  normatywna wypowiedź kolejności, zastępująca w całości tę z `065`) i
  `migration-identity.md` (scoping nazw klas i unikalność stampów per moduł).
- **`specs/065-manifest-aware-migrations/contracts/`** — `naming-convention.md` §1 i
  §2 nadal są jedynymi rozpoznawaczami, których może używać jakiekolwiek narzędzie;
  `contracts/fk-dependency-check.md` nadal opisuje walidator FK-drift.
  `contracts/ordering-algorithm.md` tam jest **superseded**.
- Zamrożona mapa rename i accessor `getMigrator`, które opisują kontrakty `065`, zostały
  wycofane przez feature `072`; patrz `specs/072-module-kernel-di/MIGRATION-RESET.md`.
