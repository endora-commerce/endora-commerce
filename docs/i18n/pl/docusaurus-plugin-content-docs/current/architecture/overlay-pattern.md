---
title: Wzorzec nakładki (dostosowanie dla wdrożenia)
---

# Wzorzec nakładki

Platforma jest produktem dla **wielu wdrożeń** — jeden kod źródłowy, wiele instalacji u różnych
klientów. Dostosowanie konkretnego wdrożenia odbywa się przez **warstwę nakładkową (overlay)
danego wdrożenia**, rozwiązywaną deterministycznie w czasie budowania i kompozycji — nigdy przez
edycję plików rdzenia (core) ani przez fork. Rdzeń nie zależy od żadnego wdrożenia, a build samego
rdzenia działa bez zmian.

## Jak to działa

- **Położenie nakładki** — własne moduły wdrożenia znajdują się w
  `backend/src/apps/<deployment>/modules/<id>/…`. Aktywne wdrożenie wybiera zmienna środowiskowa
  `DEPLOYMENT` w czasie budowania; jeśli nie jest ustawiona (albo wdrożenie nie ma katalogu
  nakładki), powstaje build samego rdzenia.
- **Moduł nakładkowy jest pełnoprawnym modułem i właścicielem każdego pliku, który zawiera.** Może
  mieć własne tabele i migracje, publikować port dla innych modułów wdrożenia oraz dostarczać ekran
  panelu administracyjnego z akcjami palety poleceń — pod tymi samymi zabezpieczeniami co pakiet
  modułu. Żaden jego plik nie przesłania, nie zastępuje ani nie rozszerza pliku innego modułu; to
  zwykły moduł, który po prostu należy do jednego klienta. (Nie zawsze tak było; zobacz
  *Przesłanianie plików zostało wycofane* poniżej).
- **Płaski i niebędący pakietem** — moduł jest bezpośrednim podkatalogiem `modules/` i nie ma
  własnego `package.json`, `tsconfig*.json` ani konfiguracji bundlera. Dwa odrębne zakresy
  odpowiedzialności to dwa sąsiednie moduły i zadeklarowana zależność; zobacz *Układ modułu
  nakładkowego* poniżej.
- **Jeden identyfikator, jeden właściciel** — jeśli identyfikator modułu nakładkowego jest już
  zajęty przez rdzeń, pakiet modułu w workspace, zainstalowany pakiet albo inny moduł nakładkowy,
  kompozycja kończy się błędem, który wskazuje plik każdego z modułów zgłaszających ten
  identyfikator.
- **Deterministyczne rozwiązywanie** — resolver (`backend/src/overlay/`) wylicza katalogi modułów
  w katalogu głównym nakładki w stabilnej kolejności. Te same dane wejściowe dają ten sam wynik i
  ten sam **raport rozbieżności**, więc ponowny build nigdy nie daje innego rezultatu.
- **Raport rozbieżności** — każdy build tworzy deterministyczny zapis wszystkich różnic między
  wdrożeniem a rdzeniem, zatwierdzany w repozytorium w dwóch postaciach wyprowadzonych z jednego
  źródła: `divergence.generated.ts` dla programu i `divergence.generated.md` dla człowieka
  (`divergence.core.generated.*` dla samego rdzenia; dla każdego wdrożenia w `apps/<name>/`).
  Każdy wpis podaje, co zmieniono, który moduł wdrożenia to zmienił, który moduł jest właścicielem
  zmienionego elementu, na którym stopniu [drabiny dostosowań](./customisation-ladder.md) leży ta
  zmiana i jakim zdaniem wdrożenie ją uzasadniło. Poprzednik raportu zapisywał tylko jeden fakt —
  które moduły nakładkowe dodaje wdrożenie — i ta informacja przetrwała jako pole
  `overlayModules`.
- **Własna deklaracja wdrożenia** — `apps/<name>/divergence.ts`, pisana ręcznie i podlegająca
  przeglądowi, zawiera trzy rzeczy, których nie da się wyprowadzić z drzewa plików: moduły, których
  to wdrożenie nie zawiera, kolejność opakowywania, gdy dwa jego moduły nakładkowe dekorują tę
  samą nazwę, oraz po jednym zdaniu uzasadnienia dla każdej wyprowadzonej rozbieżności. Deklarację
  porównuje się z raportem **w obie strony**: build kończy się błędem zarówno przy rozbieżności bez
  uzasadnienia, jak i przy uzasadnieniu rozbieżności, której już nie ma.

## W instancji

Wszystko na tej stronie opisano z perspektywy repozytorium platformy, w którym drzewo nakładki
wdrożenia referencyjnego to `backend/src/apps/`. W **instancji** — drzewie, które zapisuje
`npx create-endora-commerce` — ten sam wzorzec ma krótsze ścieżki i trzy własne polecenia:

- **Położenie** — `apps/<deployment>/modules/<id>/` w katalogu głównym instancji, obok
  `apps/<deployment>/divergence.ts`.
- **Aktywne wdrożenie** — `DEPLOYMENT=<deployment>` w pliku `.env` instancji, zapisane przez
  instalator. Bez tej wartości instancja startuje jako sama platforma i żaden z jej modułów
  nakładkowych nie zostaje złożony.
- **Szkielet** — `pnpm exec endora new module <id> --name … --description …` tworzy tam moduł
  nakładkowy: `manifest.ts`, `backend.ts` i oba pliki `i18n/`. `--entities` dodaje encję w
  `entities/` i jej pierwszą migrację w `migrations/`; `--ports` dodaje `ports.ts` i wywołanie
  `ctx.di.providePort`, które rejestruje port; `--admin` i `--action` dodają `admin/index.tsx`,
  ekran i jego wpis w palecie poleceń. Odrzuca, podając powód, `--worker` i `--subscriber`: każde z
  nich to jedno wywołanie w `backend.ts`, `ctx.worker(…)` albo `ctx.subscribe(…)`.
  `pnpm exec endora new migration <id> --name <slug>` tworzy kolejną migrację modułu.
- **Build** — `pnpm run build` uruchamia `endora build overlays`, które kompiluje `apps/` własnym
  `tsc -p backend/tsconfig.apps.json` instancji do `backend/dist/apps` i kopiuje obok kodu katalog
  `i18n/` każdego modułu; `pnpm run dev` robi to samo przy każdej zmianie. API, worker i każde
  polecenie `module:*` uruchamiają skompilowany kod i najpierw porównują go z `apps/`: zmiana, której
  nie przebudowano, moduł, którego nigdy nie zbudowano, albo skompilowany plik bez źródła
  zatrzymują je, ze wskazaniem obu plików. `pnpm run typecheck` sprawdza kod nakładek z włączonym
  `erasableSyntaxOnly`, więc pisz zwykły TypeScript: bez `enum`, bez `namespace` i bez właściwości
  deklarowanych w parametrach konstruktora.
- **Raport rozbieżności** — `pnpm run generate` zapisuje
  `apps/<deployment>/divergence.generated.md` i — już po zapisaniu raportu — kończy się kodem 1,
  dopóki wyprowadzona rozbieżność nie ma uzasadnienia w `divergence.ts` albo uzasadnienie opisuje
  rozbieżność, której już nie ma. `pnpm run setup` uruchamia to polecenie, więc żaden z tych
  przypadków nie przejdzie niezauważony.
- **Cykl życia** — `pnpm run module:install <id>`, `module:enable`, `module:disable`,
  `module:uninstall` i `module:status` traktują moduł nakładkowy tak samo jak każdy inny.
  `pnpm run migrate` wykonuje jego migracje, `module:status <id>` je wymienia, wyłączenie modułu
  albo miękkie odinstalowanie zachowuje jego tabele i wiersze, a `module:uninstall --hard` je
  wycofuje.

Całość krok po kroku pokazuje [Utwórz swój pierwszy moduł](../create-your-first-module.md).

## Co możesz nadpisać

Każdy wiersz wskazuje punkt rozszerzenia. Żaden nie wskazuje ścieżki pliku, bo żaden punkt
rozszerzenia nie przyjmuje ścieżki.

| Chcesz | Punkt rozszerzenia |
|------|------|
| Zmienić działanie usługi rdzenia | `ctx.di.decorate('<name>', (inner) => …)` z własnego modułu nakładkowego wdrożenia — zobacz *Nadpisanie usługi to dekoracja* poniżej |
| Dodać nową możliwość | moduł nakładkowy tylko dla tego klienta w `backend/src/apps/<deployment>/modules/<id>/`, zawierający `backend.ts` i `manifest.ts` |
| Wykonać kod przed endpointem innego modułu lub po nim, zablokować go albo przepisać jego odpowiedź | `ctx.interceptors` |
| Wziąć udział w zapisie, który właściciel zadeklarował jako dostępny dla hooków — dodać własny wiersz albo go odrzucić | hook polecenia, `ctx.commandHooks` |
| Odrzucać albo mierzyć każde polecenie (Command), którego akcja pasuje do filtra | middleware poleceń, `ctx.commandMiddleware` — `admit` albo `observe`; zobacz *Przeniesienie wrappera szyny na middleware poleceń* poniżej |
| Zmienić zachowanie, które właściciel przewidział jako zmienne | port strategii publikowany przez właściciela, rejestrowany przez `ctx.di.providePort` i odczytywany przez `lazyPort` |
| Zmienić konfigurację | ustawienie zadeklarowane w manifeście, a `divergence.ts`, aby pominąć moduł |
| Dodać tabele specyficzne dla klienta | własne tabele modułu nakładkowego: tabela poboczna, której jest właścicielem, albo zadeklarowane kolumny rozszerzające w rozszerzalnej tabeli rdzenia — zobacz *Moduł nakładkowy jest właścicielem swojego schematu* poniżej |
| Współdzielić usługę między dwoma modułami wdrożenia | port, który właściciel rejestruje przez `ctx.di.providePort`, z typami w `ports.ts` właściciela |
| **Zastąpić w całości handler trasy** | **Brak punktu rozszerzenia. Nie jest oferowane.** Zobacz *Jedyna rzecz bez punktu rozszerzenia* poniżej |

## Moduł nakładkowy jest właścicielem swojego schematu {#an-overlay-module-owns-its-schema}

Od wydania 0.113.0 moduł nakładkowy wdrożenia może mieć własne encje i migracje, zarówno w
instancji, jak i we własnym drzewie `apps/` repozytorium platformy. Wnosi je tak samo jak
zainstalowany pakiet i obowiązują go te same reguły:

- **Encje** — `backend.ts` eksportuje `entities`, tablicę klas encji modułu, i każda klasa encji w
  jego katalogu `entities/` musi się w niej znaleźć. Każda encja ma dokładnie jeden dekorator
  tenantowy (`@OrgScoped`, `@CustomerScoped`, `@TransitivelyScoped`, `@RuleScoped` albo
  `@GlobalEntity`), a dekoratory MikroORM importuje z `@mikro-orm/decorators/legacy`. Proces z encją
  bez klasyfikacji nie startuje.
- **Migracje** — katalog `migrations/` modułu, czytany plik po pliku: nie ma pliku indeksu ani
  rejestru. Każdy plik ma nazwę `<YYYYMMDDTHHmmss>_<module>_<slug>.ts` i eksportuje jedną klasę,
  której nazwa wynika z nazwy pliku. Kolejność łańcucha wyznaczają `dependencies` w manifeście
  modułu, więc migracja odwołująca się do tabeli rdzenia wykonuje się po tej, która ją utworzyła.
- **Zabezpieczenie przed zapisem do cudzego schematu, bez wyjątku** — migracja nakładki może
  zapisywać wyłącznie tabele mapowane przez własne encje modułu, dokładnie tak jak migracja
  zainstalowanego pakietu. Przynależność do wdrożenia nic tu nie zmienia.
- **Kolumny rozszerzające** — moduł nakładkowy może zadeklarować `schemaExtensions` w rozszerzalnej
  tabeli rdzenia, tak jak zainstalowany pakiet; zobacz
  [Zadeklarowane kolumny rozszerzające](./schema-extensions.md).
- **Udział w scalaniu** — tabela wskazująca organizację (lub inny scalany host) określa, co
  scalanie robi z wierszami organizacji scalanej, w `merge.participates` manifestu i przez
  `ctx.merge.participate`, tak jak w pakiecie. Bez tej deklaracji kontrola pokrycia odrzuca drzewo.
- **Przeniesienie zachowuje identyfikator** — moduł przeniesiony później z nakładki do pakietu
  zachowuje identyfikator modułu, więc migracje, które baza danych już zapisała, nadal się
  zgadzają.

`apps/example/modules/example_erp_keys/` w repozytorium platformy to referencyjny moduł nakładkowy,
który warto skopiować: tabela poboczna przy `organizations` z migracją, wypełniający ją hook
polecenia, port w `ports.ts`, ekran panelu administracyjnego z akcją palety poleceń oraz krok
scalania organizacji. Przy scalaniu organizacja docelowa bez klucza ERP przejmuje klucz organizacji
scalanej; organizacja docelowa z kluczem go zachowuje, a klucz scalanej zostaje przy niej po
archiwizacji i jest wymieniony w podglądzie scalania. Uzgodnienie tego klucza w systemie ERP należy
do integratora: platforma nie może wiedzieć, który rekord ERP powinien pozostać.

**Powód, dla którego kiedyś tego odmawiano, wycofano.** Moduł nakładkowy nie wnosił kiedyś schematu,
bo nakładka znajduje się w tym samym repozytorium i w tym samym buildzie co rdzeń, więc tabelę
zawsze można dostarczyć w module rdzenia. W instancji to nie obowiązuje: instancja zależy od
wydanych pakietów i nie ma drzewa rdzenia, w którym mogłaby umieścić tabelę. Drugi podawany
kiedyś powód — że kolejność migracji ma sens „tylko dla stałego zbioru” — sprawdzono pomiarem i
okazał się fałszywy: dodanie migracji modułu-liścia nie zmienia względnej kolejności żadnej
istniejącej migracji. Nie powtarzaj żadnego z nich.

**Nigdy nie jest oferowana** zmiana schematu innego modułu: kolumny, ograniczenia, indeksu ani
klasy encji rdzenia nie da się nadpisać z modułu nakładkowego ani z żadnego innego miejsca. To
opisuje [drabina danych](./customisation-ladder.md#the-data-ladder-where-new-data-lives).

## Układ modułu nakładkowego {#overlay-module-layout}

```text
apps/<deployment>/
├── divergence.ts                 # deklaracja wdrożenia (pisana ręcznie)
├── divergence.generated.{ts,md}  # wyprowadzony raport
└── modules/
    └── <id>/                     # jeden moduł; <id> = identyfikator z manifestu
```

Kilka nazw w `<id>/` odczytuje coś innego niż sam moduł, więc są stałe:

| Ścieżka | Kto ją odczytuje | Wymagana |
| --- | --- | --- |
| `manifest.ts` | loader, który po nim rozpoznaje moduł | tak |
| `backend.ts` | loader: `registerModule`, `entities`, `schemaExtensions` | nie — moduł może nie mieć części serwerowej |
| `i18n/en.json`, `i18n/pl.json` | `i18n.bundlesDir` w manifeście | gdy moduł ma jakąkolwiek etykietę |
| `migrations/` | wykrywanie schematu, plik po pliku | gdy moduł ma własny schemat |
| `admin/index.tsx` | build panelu administracyjnego wdrożenia | gdy moduł ma ekran w panelu |
| `ports.ts` | sąsiedni moduł nakładkowy, wyłącznie przez `import type` | gdy moduł publikuje port |

Cała reszta — `entities/`, `services/`, `hooks/`, `routes.ts` — to nazwy wybrane przez sam moduł.
`manifest.ts` głębiej niż w `<id>/` jest odrzucany jako `nested-module`, a `package.json`,
`tsconfig*.json` albo konfiguracja `tsup`, `vite` lub `vitest` wewnątrz modułu — jako
`package-in-disguise`: cały kod nakładek wdrożenia kompiluje jeden projekt. Gdy moduł obejmuje dwa
odrębne zakresy, utwórz dwa sąsiednie moduły i zadeklaruj zależność.

**Między dwoma modułami nakładkowymi przechodzą tylko typy portów.** Moduł może importować
`ports.ts` sąsiada, i nic poza nim, przez `import type`, gdy oba należą do tego samego wdrożenia,
a `dependencies` w jego manifeście wymieniają sąsiada; port rozwiązuje wtedy przez `lazyPort`. Każdy
inny import między dwoma modułami nakładkowymi jest odrzucany, ze wskazaniem każdego
niespełnionego warunku.

**Warstwa panelu administracyjnego jest per wdrożenie.** `admin/index.tsx` eksportuje te same
`contributions` co warstwa `./admin` pakietu i trafia wyłącznie do buildu panelu własnego
wdrożenia. Pokrycie palety poleceń i inwentarz uprawnień ocenia się dla tego wdrożenia.

## Nadpisanie usługi to dekoracja

Nadpisanie usługi przez klienta **opakowuje** implementację rdzenia i deleguje do niej wywołania.
Nie przesłania pliku i nie dziedziczy po klasie rdzenia.

To kwestia poprawności, a nie stylu. Zastąpienie usługi oznacza, że od dnia napisania nadpisania
wdrożenie przestaje otrzymywać poprawki rdzenia do nadpisanych metod — wszystko, co rdzeń później
zmieni w tej metodzie, trafia do klasy, której wdrożenie już nie tworzy, i nikt się o tym nie
dowie, dopóki zachowanie nie rozjedzie się na produkcji. Wrapper zostawia rdzeń na ścieżce
wywołania, więc poprawka rdzenia dociera do wdrożenia, *a* zachowanie klienta ją przetrwa.

Dekorację pisze się we **własnym module nakładkowym** wdrożenia, w jego funkcji `registerModule`,
i nie da się jej napisać nigdzie indziej:

```ts
// backend/src/apps/acme/modules/acme_pricing/backend.ts
export function registerModule(ctx: ModuleContext): void {
  ctx.di.decorate<DecoratedPricing>('pricingService', (inner) => wrap(inner));
}
```

Dekoracja wskazuje **rejestrację**, a nie plik, więc przeniesienie pliku w rdzeniu niczego nie
psuje, a wdrożenie może nadpisać kolejną usługę bez jakiejkolwiek zmiany w rdzeniu.

Gdy dwa moduły dekorują tę samą rejestrację, kolejność opakowywania trzeba zadeklarować —
kompozycja kończy się wtedy błędem, zamiast wybierać według kolejności wczytywania pakietów — a
każda zastosowana dekoracja pojawia się w raporcie nadpisań composera.

### Istniał drugi mechanizm i został wycofany

Do 2026-08 wdrożenie mogło też umieścić plik w `backend/src/apps/<deployment>/decorations/`,
nazwany tak jak opakowywana rejestracja i eksportujący `decorate(inner)`. Jeśli czytasz drzewo
klienta, które wciąż go zawiera, albo dokument, który wciąż go opisuje — oto dlaczego zniknął i
dlaczego nie warto go odtwarzać.

Istniał, bo warstwa nakładkowa powstała wcześniej niż zmiana, która uczyniła moduł nakładkowy
zwykłym uczestnikiem kompozycji. Moduł nakładkowy był wtedy plikiem `plugin.ts` działającym na
zamrożonym kontekście z siedmioma polami: nie miał dostępu do kontenera, więc nie mógł niczego
dekorować, a wdrożenie, które chciało opakować usługę, nie miało innej drogi. Tamta zmiana dała
modułowi nakładkowemu pełny `ModuleContext` — łącznie z `ctx.di.decorate` — przez co mechanizm
plikowy przestał dawać cokolwiek, czego nie dawał już kontekst.

W dostarczonej postaci była to też udokumentowana możliwość, która po cichu nie robiła nic dla
wszystkich rejestracji poza jedną. Loader wczytywał *każdy* plik w tym katalogu i budował mapę,
której kluczem była nazwa rejestracji wyprowadzona z nazwy pliku; jedyny konsument tej mapy
odczytywał jeden klucz wpisany na stałe, a resztę wyrzucał. Wdrożenie, które dodało
`decorations/command-bus.ts`, nie dostawało ani opakowania, ani ostrzeżenia, ani błędu. Obsługa
kolejnej rejestracji wymagała zmiany w rdzeniu — dokładnie tego powiązania, które wzorzec nakładki
ma usuwać.

**Jedną rzecz rzeczywiście utracono.** Plik importował `*.interface.ts` właściciela, więc `tsc`
pilnował, by wrapper był zgodny z tym interfejsem, i zgłaszał błąd w chwili zmiany interfejsu — to
była pierwotna kontrola kontraktu. `ctx.di.decorate<T>` przyjmuje `T` jako założenie w miejscu
wywołania i z niczym go nie porównuje, więc kształt opakowywanego obiektu deklaruje się
**strukturalnie**, a rozjazd interfejsu wychodzi w czasie działania zamiast w czasie budowania. Jeśli
wdrożenie chce odzyskać tę kontrolę, moduł właściciela powinien opublikować swój interfejs w
ścieżce `./ports` swojego pakietu, a nakładka powinna importować go stamtąd: import samych typów z
`./ports` nie jest sięganiem przez granicę modułu, a zmiana kształtu opublikowanego typu wymaga
nowej wersji głównej.

### Dekorowanie cudzych rejestracji należy wyłącznie do wdrożenia

`ctx.di.decorate` odrzuca moduł, który próbuje opakować rejestrację, której sam nie zarejestrował.
Powód: dekoracja zmienia to, co otrzymuje *każdy* konsument danej nazwy. Moduł rdzenia, któremu
wolno by było opakować `commandBus`, widziałby każdy audytowany zapis w platformie; moduł
opakowujący `auditLogService` zmieniałby to, co zapisuje audyt; a moduł opakowujący port odczytu
innego modułu stawałby między konsumentem a właścicielem, nigdzie tego nie deklarując. Moduł, który
potrzebuje innego zachowania od innego modułu, prosi go o punkt rozszerzenia — port, punkt
wpięcia (contribution point), zdarzenie — czyli o powiązanie, które deklaruje manifest i które
widzą kontrole. Nazwa zarejestrowana przez composition root jest odrzucana na tej samej zasadzie:
nie należy do żadnego modułu, więc żaden moduł nie może jej opakować.

Jedynym wyjątkiem jest moduł nakładkowy, bo to zupełnie inna czynność. Wdrożenie opakowujące rdzeń
to właśnie punkt dostosowania opisany na tej stronie; rdzeń opakowujący rdzeń to powiązanie, którego
nikt nie deklaruje. Wyjątku nie przyznaje sobie sam moduł — wygenerowany composer oznacza wpis
jako `overlay: true` na podstawie katalogu, w którym moduł został znaleziony,
`backend/src/apps/<deployment>/modules/`, więc rdzeń nie ma jak się pod niego podszyć, a
`overlay:check` kończy się błędem przy ręcznie poprawionym artefakcie.

**Wyjątek nie obejmuje zainstalowanych pakietów rozszerzeń ani zabezpieczeń szyny.** Nakładka
może opakować wszystko, co rejestruje rdzeń albo inny moduł tego samego wdrożenia, oraz każdą
nazwę dostarczaną przez composition root (`redis`, `orm`, `requireAdmin`, …) — z wyjątkiem
czterech punktów zabezpieczeń opisanych niżej. Nie może opakować rejestracji należącej do pakietu
zainstalowanego z `node_modules` — kompozycja odrzuca to błędem
`PackageDecorationNotOfferedError`, który wskazuje nakładkę, pakiet i rejestrację. Powód: nie ma
kontraktu, *względem* którego można napisać opakowanie. Mapa `exports` pakietu publikuje
`registerModule`, encje, migracje i `./ports`, ale żadna z tych ścieżek nie publikuje nazw, pod
którymi pakiet rejestruje coś wewnętrznie w kontenerze, więc nazwa może się zmienić w wydaniu
poprawkowym. Kontrola przez `*.interface.ts`, którą dawał wycofany mechanizm plikowy, też się tu
nie przenosi — w przypadku pakietu kompilator wiązałby wdrożenie z plikiem `dist/*.d.ts` napisanym
przez kogoś, kogo wdrożenie nie zatrudnia. Komunikat mówi *not offered yet* („jeszcze nie
oferowane”), a nie *forbidden* („zabronione”), i wskazuje wyjście: pakiet deklarujący, które z jego
rejestracji można dekorować, najlepiej w `./ports`, gdzie zmiana kształtu wymaga podniesienia
wersji głównej. Do tego czasu poproś autora pakietu o port lub zdarzenie albo użyj interceptora na
jego trasach.

**Czterech punktów zabezpieczeń nie da się dekorować od wydania 0.114.0.** `commandBus`,
`auditLogService`, `eventBus` i `emFactory` to nazwy, przez które egzekwuje się izolację tenantów
i audyt zapisów. Dekoracja jednej z nich przez nakładkę jest **przestarzała w 0.113.0** — nadal się
składa, raz zapisuje w logu `kernel.decoration.deprecated` i jest ostrzeżeniem
`deprecated-decoration` w raporcie rozbieżności — a **od 0.114.0 jest odrzucana**. Każda ma
zamiennik:

| Zamiast dekorować | Użyj |
| --- | --- |
| `commandBus` | middleware poleceń: `admit`, aby odrzucić, `observe`, aby mierzyć; hook polecenia dla jednej zadeklarowanej akcji |
| `auditLogService` | middleware `observe` dla dodatkowego odbiorcy albo odczyt `audit_log_entries` dla trwałego; samego zapisu audytu nie da się zastąpić |
| `eventBus` | `ctx.subscribe`, aby zareagować; hook `afterCommit` dla trwałego dostarczenia |
| `emFactory` | nic — zawężania do tenanta nie da się nadpisać; poproś moduł właściciela o port |

Dekoracje są **stosowane dopiero po zarejestrowaniu się wszystkich modułów**, a nie w chwili
wywołania. Z której listy moduł został złożony, nie ma więc wpływu na to, co może opakować, a
dekoracja nazwy, której nic nie rejestruje, oznacza dokładnie to, a nie „jeszcze nie”. Kolejność
stosowania dekoracji to kolejność wywołań, dlatego jeden moduł dekorujący nazwę dwa razy jest
jednoznaczny, a dwa moduły dekorujące tę samą nazwę — nie.

Starszy sposób nadpisywania usługi przesłaniał plik `modules/<id>/services/<name>.ts` i
zastępował klasę rdzenia. Ten mechanizm również wycofano, i to całkowicie: plik w `services/`
modułu nakładkowego jest teraz po prostu jednym z plików tego modułu, bo moduł nakładkowy jest
właścicielem wszystkiego, co zawiera.

## Przesłanianie plików zostało wycofane

Do 2026-09 ta strona opisywała jeszcze jeden mechanizm: plik nakładki umieszczony pod tą samą
ścieżką względną modułu co plik rdzenia *przesłaniał* go. Istniała taksonomia rodzajów, które
można było nadpisać (`route`, `config`), dwa rodzaje odrzucane (`schema`, `other`), zasady
rozwiązywania konfliktów i trzy odmowy w czasie budowania. Jeśli czytasz drzewo klienta, starszą
specyfikację albo dokument, który wciąż to opisuje — oto dlaczego zniknęło i dlaczego nie warto
tego odtwarzać.

**Nie utracono niczego, co działało** — i to wynika z pomiaru, a nie z założenia. `git log -S` na
całej historii `backend/src/overlay/` znajduje dokładnie jeden loader przesłanianego pliku, jaki
kiedykolwiek napisano — `loadOverlayServiceClasses`, dla `service` — i został on celowo usunięty i
zastąpiony przez `ctx.di.decorate` z powodu podanego w poprzedniej sekcji. `route` i `config` nigdy
nie miały loadera: wynik `overrides` resolvera miał w całej historii drzewa tylko jednego
konsumenta — generator raportu rozbieżności (wtedy generator manifestu nadpisań), który zapisywał
go do artefaktu audytowego. Nadpisanie trasy nigdy więc nie zmieniło tego, co serwowała działająca
platforma, w żadnym wdrożeniu i w żadnym stanie drzewa.

**Mechanizm przestał nawet klasyfikować pliki.** Skaner budował indeks rdzenia z
`backend/src/modules`, w którym od zakończenia przenoszenia modułów do pakietów 2026-08-28 nie ma
żadnego modułu. Przy pustym indeksie każdy katalog nakładki od razu uznawano za „całkiem nowy moduł
zgłaszający ten identyfikator”, zanim obejrzano choć jeden plik, więc żadna z trzech odmów
wymienionych niżej nie mogła się wydarzyć — w tym ta, której jedynym zadaniem było zatrzymanie
wdrożenia dostarczającego migrację, która nigdy by się nie wykonała. Martwe zabezpieczenie, które
miało odmawiać w razie wątpliwości, jest gorsze niż brak zabezpieczenia: autor, który mu ufa,
dostaje ciszę.

Wraz z mechanizmem wycofano odmowy: **Conflict** (dwie nakładki na ten sam element rdzenia),
**Unknown target** (plik nakładki bez odpowiednika w rdzeniu) i **Schema override** (plik nakładki w
`entities/` albo `migrations/` modułu rdzenia). To, czemu służyła ostatnia z nich, *nie* zostało
wycofane: żadna nakładka nie zmienia schematu innego modułu. Własne `entities/` i `migrations/`
modułu nakładkowego to jego własny schemat, pilnowany przez zabezpieczenie przed zapisem do
cudzego schematu — zobacz *Moduł nakładkowy jest właścicielem swojego schematu* wyżej.

**Dlaczego mechanizmu nie naprawiono, tylko wycofano.** Przesłonięcie pliku wewnątrz
opublikowanego pakietu nie jest spójną operacją. Platforma składa moduł przez
`@endora-commerce/mod-<id>/backend`, którego mapa `exports` wskazuje na `dist`, więc zastąpienie
jednego z tych plików plikiem nakładki wymagałoby przechwycenia rozwiązywania modułów przez Node
dla jednego pliku jednego pakietu — czyli ponownego wprowadzenia *kodu źródłowego* pakietu do
grafu, który zawiera już jego zbudowaną wersję. Dwie reguły wykluczają takie rozwiązania: ta, z
powodu której pakiet modułu w ogóle zawiera `dist`, oraz `check:singleton-identity`, która
pilnuje, by jeden pakiet nie był wykonywany dwa razy, bo wtedy wartości z zasięgu modułu
duplikują się **po cichu**. Zrobienie tego na poziomie specyfikatora — skierowanie nazwy pakietu na
kopię należącą do wdrożenia — unika podwójnego wykonania, ale zastępuje cały moduł. To już fork
modułu, a nie nadpisanie, czyli dokładnie to, przed czym chroni reguła nienaruszonego rdzenia.

## Jedyna rzecz bez punktu rozszerzenia

**Nie da się zastąpić w całości handlera trasy.** `ctx.interceptors` działa po własnych
zabezpieczeniach trasy i po walidacji schematu: interceptor wstępny może zablokować
żądanie, rzucając zarejestrowany `HttpError`, i może podmienić zwalidowaną treść żądania, a
interceptor końcowy może podmienić treść odpowiedzi, ale żaden nie może podstawić innego handlera.

To nie jest regresja spowodowana wycofaniem przesłaniania — przesłonięcie trasy też nigdy nie
zastępowało handlera. Mówimy o tym wprost, a nie przez przemilczenie, tak samo jak robi to
`PackageDecorationNotOfferedError`: nie jest oferowane i wskazujemy wyjście. Wdrożenie, które tego
potrzebuje, powinno zdekorować usługę wywoływaną przez handler — zwykle tam właśnie znajduje się
zachowanie — albo poprosić moduł właściciela o port. Jeśli prawdziwe wdrożenie będzie potrzebować
czegoś więcej, będzie to nowa funkcja z rzeczywistym wymaganiem i nie należy jej uzasadniać
mechanizmem, który nigdy nie działał.

## Zabezpieczenia odmawiające w razie wątpliwości

Każde zabezpieczenie z tej listy da się wywołać. Build kończy się błędem — nigdy nie rozstrzyga
niczego po cichu — gdy wystąpi:

- **Kolizja identyfikatora modułu** — moduł nakładkowy zgłasza identyfikator zajęty już przez
  rdzeń, pakiet modułu w workspace, zainstalowany pakiet albo inny moduł nakładkowy. Komunikat
  wskazuje plik każdego z nich.
- **Układ** — manifest zagnieżdżony głębiej w module (`nested-module`) albo `package.json` lub
  konfiguracja buildu wewnątrz modułu (`package-in-disguise`), odrzucane przez build nakładek i
  każdy proces, który rozwiązuje moduły nakładkowe, ze wskazaniem pliku i sposobu naprawy.
- **Nieaktualny build** — skompilowany kod nakładek niezgodny z `apps/`: zmiana, której nie
  przebudowano (`stale`), moduł, którego nigdy nie zbudowano (`unbuilt`), skompilowany plik bez
  źródła (`orphan`). API, worker i każde polecenie `module:*` odmawiają wtedy startu.
- **Encja bez klasyfikacji** — encja nakładki bez dekoratora tenantowego albo z więcej niż jednym
  zatrzymuje każdy proces konfigurujący ORM, zanim otworzy połączenie. Tak samo klasa encji w
  `entities/`, której brakuje w eksporcie `entities` modułu, oraz plik migracji, którego nazwa,
  klasa albo segment modułu do siebie nie pasują.
- **Zapis do cudzej tabeli** — migracja nakładki dotykająca tabeli, której nie mapują jej własne
  encje, odrzucana przy `migrate` przez zabezpieczenie przed zapisem do cudzego schematu.
- **Import między modułami nakładkowymi** — cokolwiek innego niż `import type` z `ports.ts`
  sąsiada, od którego manifest importującego zależy; zgłaszane przez `check:module-boundary` w tym
  repozytorium i przez `pnpm run generate` w instancji.
- **Brak manifestu** — katalog modułu nakładkowego bez `manifest.js`/`manifest.ts`. Komunikat
  wymienia obie nazwy.
- **Backend bez rejestracji** — moduł nakładkowy, którego `backend.js`/`backend.ts` nie eksportuje
  `registerModule`. (Katalog w ogóle *bez* punktu wejścia backendu jest celowo pomijany: wdrożenie
  może dostarczyć moduł bez części serwerowej).
- **Niejednoznaczna dekoracja** — dwa moduły dekorują tę samą rejestrację bez zadeklarowanej
  kolejności.
- **Dekoracja cudzej rejestracji** — moduł rdzenia dekoruje rejestrację, której nie jest
  właścicielem.
- **Dekoracja pakietu** — nakładka dekoruje rejestrację należącą do zainstalowanego pakietu
  rozszerzenia; to jeszcze nie jest oferowane i komunikat odmowy to mówi.
- **Dekoracja punktu zabezpieczeń** — nakładka dekoruje `commandBus`, `auditLogService`,
  `eventBus` albo `emFactory`: ostrzeżenie w 0.113.0, odmowa od 0.114.0.

## Zabezpieczenia nadal obowiązują

Dekoracja opakowuje *implementację*, nigdy punkt, w którym działa zabezpieczenie: kod nakładki
podlega tej samej izolacji tenantów, temu samemu zawężaniu do kanału sprzedaży i temu samemu
audytowi przez Command Bus co rdzeń, a zachowanie przekrojowe dla poleceń wnosi się jako
zadeklarowane middleware poleceń. Moduły nakładkowe są zwykłymi uczestnikami cyklu życia — muszą
rejestrować swoje uprawnienia i przejść kontrolę inwentarza uprawnień w każdym wdrożeniu.

To, co moduł nakładkowy może wnieść do cudzych modułów, wynika z **miejsca, w którym platforma go
znalazła**, a nigdy z tego, co sam deklaruje: ma pochodzenie `deployment`, bo loader wykrył go w
`apps/<deployment>/modules/`, niezależnie od tego, czy ma własną tabelę. To pochodzenie może
wnieść middleware poleceń `admit`, czego zainstalowany pakiet rozszerzenia (pochodzenie
`package`) zrobić nie może.

## Przeniesienie wrappera szyny na middleware poleceń {#moving-a-bus-wrap-to-command-middleware}

Wdrożenie, które mierzyło lub ograniczało częstotliwość zapisów, opakowując `commandBus`,
przenosi to opakowanie na middleware poleceń przed wydaniem 0.114.0. Przed — jedna dekoracja,
która robi obie rzeczy:

```ts
// apps/acme/modules/acme_write_limits/backend.ts — przestarzałe w 0.113.0, odrzucane od 0.114.0
ctx.di.decorate<Bus>('commandBus', (inner) => ({
  ...inner,
  async run(command) {
    if (overLimit(command)) throw new HttpError(429, 'RATE_LIMITED', 'Too many writes');
    const started = performance.now();
    try { return await inner.run(command); }
    finally { metrics.observe(command.action, performance.now() - started); }
  },
}));
```

Widziała tylko polecenie przekazane do `run`, nigdy poleceń podrzędnych, które ono uruchamia;
działała dalej, gdy jej moduł był wyłączony; a nic dalej nie potrafiło odróżnić jej odmowy od
nieudanego zapisu. Po — to samo zachowanie jako dwa zadeklarowane middleware, a dekoracja
usunięta. Manifest deklaruje oba, z ich filtrami:

```ts
// apps/acme/modules/acme_write_limits/manifest.ts
export const acmeWriteLimitsErrorCodes = defineModuleErrorCodes(['ACME_WRITE_LIMITS_RATE_LIMITED']);

export const manifest = defineModuleManifest({
  id: 'acme_write_limits',
  // …
  errorCodes: [{ code: 'ACME_WRITE_LIMITS_RATE_LIMITED' }],
  commandMiddleware: [
    { id: 'quote-rate-limit', phase: 'admit', actions: ['quote_request.create'] },
    { id: 'write-metrics', phase: 'observe', actions: '*' },
  ],
});
```

a `backend.ts` rejestruje kod pod tymi samymi identyfikatorami i fazami:

```ts
// apps/acme/modules/acme_write_limits/backend.ts
import { CommandRefusedError } from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { acmeWriteLimitsErrorCodes } from './manifest.js';

export function registerModule(ctx: ModuleContext): void {
  ctx.commandMiddleware([
    {
      id: 'quote-rate-limit',
      phase: 'admit',
      admit: (meta) => {
        if (meta.organizationId !== null && overLimit(meta.organizationId)) {
          throw new CommandRefusedError(acmeWriteLimitsErrorCodes.ACME_WRITE_LIMITS_RATE_LIMITED, {
            status: 429,
            retryAfterSeconds: 60,
          });
        }
      },
    },
    {
      id: 'write-metrics',
      phase: 'observe',
      observe: (outcome) => {
        metrics.observe(outcome.root.action, outcome.committed, outcome.durationMs);
      },
    },
  ]);
}
```

- **`admit`** działa, zanim polecenie cokolwiek zrobi — przed otwarciem transakcji — i także dla
  pasującego polecenia podrzędnego. Dostaje wyłącznie metadane (akcję, obiekt, wykonawcę,
  organizację, identyfikator żądania, pochodzenie w łańcuchu poleceń) i może jedynie przepuścić
  polecenie albo rzucić `CommandRefusedError` z kodem zadeklarowanym przez moduł. Odrzucone
  polecenie niczego nie zapisuje i nie tworzy wpisu w dzienniku audytu; wywołujący dostaje kod i
  status. Ma limit czasu (domyślnie 100 ms, najwyżej 500 ms), a po jego przekroczeniu odmawia.
- **`observe`** działa po zatwierdzeniu albo wycofaniu przebiegu i piszący nigdy na nie nie czeka.
  Dostaje wynik — czy zatwierdzono, kod odmowy lub błędu, czas trwania i każde polecenie, którego
  przebieg próbował — jako identyfikatory, kody i wartości logiczne, i niczego nie może zmienić.
  Wyjątek rzucony w nim trafia do logu i jest pomijany.
- Oba są pomijane, gdy ich moduł jest wyłączony, i oba pojawiają się w raporcie rozbieżności jako
  `command-middleware`. Dwa moduły wdrożenia z nakładającymi się filtrami `admit` i bez zależności
  między nimi porządkuje się w `divergence.ts` (`commandMiddlewareOrder`), w przeciwnym razie
  kompozycja odmawia.

`apps/example/modules/example_overlay/backend.ts` w repozytorium platformy rejestruje middleware
`observe` w tym kształcie:

<!-- verbatim-from: backend/src/apps/example/modules/example_overlay/backend.ts -->
```ts
ctx.commandMiddleware([
  {
    id: 'organization-timing',
    phase: 'observe',
    observe: (outcome, { log }) => {
      log.info(
        {
          root: outcome.root.action,
          committed: outcome.committed,
          errorCode: outcome.errorCode,
          commands: outcome.commands.length,
          durationMs: Math.round(outcome.durationMs * 10) / 10,
        },
        'example_overlay.organization-timing',
      );
    },
  },
]);
```

:::note Polecenia operatora nie uruchamiają middleware
Command Bus, który polecenie operatora buduje dla siebie poza aplikacją — dziś polecenia cyklu
życia rozszerzeń schematu — **nie uruchamia middleware poleceń ani hooków poleceń**. Jego
polecenia nadal są audytowane. `admit` to biznesowa bramka reguł dla ścieżek aplikacji; nie
polegaj na nim, aby zatrzymać polecenie serwisowe uruchomione przez kogoś z dostępem do powłoki i
bazy danych.
:::

## Dodawanie nakładki

```bash
# 1. Dodaj moduł nakładkowy wdrożenia (zawiera backend.ts, nigdy plugin.ts):
#    backend/src/apps/acme/modules/acme_loyalty/{manifest,backend}.ts
#    — z entities/ i migrations/, jeśli ma własną tabelę

# 2. Nadpisz usługę rdzenia w jego registerModule, po nazwie rejestracji:
#    ctx.di.decorate('pricingService', (inner) => wrap(inner))

# 3. Uzasadnij to we własnej deklaracji wdrożenia:
#    backend/src/apps/acme/divergence.ts, `reasons`, pod kluczem wyprowadzonego wpisu
#    — `decoration:acme_loyalty:pricingService`

# 4. Wygeneruj raport rozbieżności wdrożenia i zatwierdź obie jego postacie:
DEPLOYMENT=acme pnpm --filter backend run overlay:divergence

# 5. Sprawdź, czy każda rozbieżność jest wyprowadzona, ma właściciela i uzasadnienie oraz czy
#    zatwierdzone artefakty są tym, co generuje to drzewo:
pnpm --filter backend run check:divergence
pnpm --filter backend run overlay:check
```

**Po który punkt rozszerzenia sięgnąć i ile każdy kosztuje** — to opisuje
[drabina dostosowań](./customisation-ladder.md). Przeczytaj ją, zanim napiszesz cokolwiek z
powyższych: stopień 3 nie jest dostępny dla wdrożenia, które chce podstawić własną implementację,
i tamta strona mówi to wprost, zamiast odsyłać cię do mechanizmu, który cię odrzuci.
