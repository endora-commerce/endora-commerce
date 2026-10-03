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
- **Moduł nakładkowy jest właścicielem każdego pliku, który zawiera.** Żaden jego plik nie
  przesłania, nie zastępuje ani nie rozszerza pliku innego modułu. Jego zawartość nie jest w żaden
  sposób klasyfikowana i nie ma reguł, co wolno mu gdzie umieścić — to zwykły moduł, który po
  prostu należy do jednego klienta. (Nie zawsze tak było; zobacz *Przesłanianie plików zostało
  wycofane* poniżej).
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
  nakładkowy: `manifest.ts`, `backend.ts` i oba pliki `i18n/`. Odrzuca, podając powód, flagi, które
  żądają czegoś, czym moduł nakładkowy być nie może — tabeli (`--entities`), ekranu w panelu
  administracyjnym (`--admin`, `--action`) czy opublikowanego portu (`--ports`). Konsumenta kolejki
  albo subskrypcję zdarzenia dopisuje się ręcznie w `backend.ts`, przez `ctx.worker(…)` i
  `ctx.subscribe(…)`.
- **Bez kroku budowania** — Node wczytuje TypeScript modułu nakładkowego bezpośrednio, usuwając
  typy, więc moduł pisze się w podzbiorze języka, który na to pozwala: bez `enum`, bez `namespace`
  i bez właściwości deklarowanych w parametrach konstruktora.
- **Raport rozbieżności** — `pnpm run generate` zapisuje
  `apps/<deployment>/divergence.generated.md` i — już po zapisaniu raportu — kończy się kodem 1,
  dopóki wyprowadzona rozbieżność nie ma uzasadnienia w `divergence.ts` albo uzasadnienie opisuje
  rozbieżność, której już nie ma. `pnpm run setup` uruchamia to polecenie, więc żaden z tych
  przypadków nie przejdzie niezauważony.
- **Cykl życia** — `pnpm run module:install <id>`, `module:enable`, `module:disable`,
  `module:uninstall` i `module:status` traktują moduł nakładkowy tak samo jak każdy inny.

Całość krok po kroku pokazuje [Utwórz swój pierwszy moduł](../create-your-first-module.md).

## Co możesz nadpisać

Każdy wiersz wskazuje punkt rozszerzenia. Żaden nie wskazuje ścieżki pliku, bo żaden punkt
rozszerzenia nie przyjmuje ścieżki.

| Chcesz | Punkt rozszerzenia |
|------|------|
| Zmienić działanie usługi rdzenia | `ctx.di.decorate('<name>', (inner) => …)` z własnego modułu nakładkowego wdrożenia — zobacz *Nadpisanie usługi to dekoracja* poniżej |
| Dodać nową możliwość | moduł nakładkowy tylko dla tego klienta w `backend/src/apps/<deployment>/modules/<id>/`, zawierający `backend.ts` i `manifest.ts` |
| Wykonać kod przed endpointem innego modułu lub po nim, zablokować go albo przepisać jego odpowiedź | `ctx.interceptors` |
| Zmienić zachowanie, które właściciel przewidział jako zmienne | port strategii publikowany przez właściciela, rejestrowany przez `ctx.di.providePort` i odczytywany przez `lazyPort` |
| Zmienić konfigurację | ustawienie zadeklarowane w manifeście, a `divergence.ts`, aby pominąć moduł |
| Dodać tabele specyficzne dla klienta | w **module rdzenia**, odczytywane z nakładki przez port tego modułu — moduł nakładkowy nie wnosi schematu, zobacz niżej |
| **Zastąpić w całości handler trasy** | **Brak punktu rozszerzenia. Nie jest oferowane.** Zobacz *Jedyna rzecz bez punktu rozszerzenia* poniżej |

## Moduł nakładkowy nie wnosi schematu

Moduł nakładkowy wdrożenia wnosi rejestracje, trasy, dekoracje, interceptory, uprawnienia, pakiety
tłumaczeń i18n oraz manifest. **Nie wnosi schematu**: ani klasy `@Entity()`, ani migracji.

Ta strona twierdziła kiedyś coś przeciwnego („dostarcz nowy schemat jako moduł nakładkowy tylko
dla klienta, będący właścicielem własnych tabel”), a generator przez cały ten czas na to nie
pozwalał.

**Powodem nie jest kolejność migracji.** Ta strona podawała kiedyś taki powód — że kolejność
wykonywania w rejestrze migracji ma sens „tylko dla stałego zbioru”, więc zbiór różny dla każdego
wdrożenia nie ma jednej poprawnej kolejności, którą można zatwierdzić w repozytorium. Ten argument
sprawdzono pomiarem i okazał się fałszywy: dodanie migracji modułu-liścia nie zmienia względnej
kolejności żadnej istniejącej migracji, bo liść wnosi wyłącznie krawędzie zależności wychodzące od
siebie. Argument wycofano; nie powtarzaj go.

Prawdziwy powód jest skromniejszy i obowiązuje niezależnie od tamtego: **nakładka znajduje się w
tym samym repozytorium i w tym samym buildzie co rdzeń**, więc rozwiązanie jest zawsze pod ręką i
kosztuje tylko jeden katalog. Wdrożenie, które potrzebuje tabel specyficznych dla klienta, dostarcza
je w module rdzenia i odczytuje z modułu nakładkowego przez port tego modułu — moduł nakładkowy
zachowuje całą resztę: własne usługi, trasy, dekoracje i uprawnienia. Dopuszczenie schematu w
nakładce dodałoby drugi mechanizm posiadania schematu, nie dając żadnej nowej możliwości, a to nie
jest warte swojej ceny.

**Pakiet rozszerzenia to przypadek odwrotny.** Autor pakietu zewnętrznego nie ma modułu rdzenia, w
którym mógłby dostarczyć tabelę, więc ta sama reguła nie byłaby dla niego ograniczeniem do
obejścia, lecz zakazem całego programu pakietów rozszerzeń — a każda ich rodzina przechowuje stan.
Reguła pozwala więc pakietowi na własne encje i migracje. Ten mechanizm nie jest jeszcze zbudowany —
dziś jedynym schematem, który wykonuje działająca platforma, jest schemat rdzenia — więc dla
wdrożenia nic na tej stronie się nie zmienia.

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

**Wyjątek nie obejmuje zainstalowanych pakietów rozszerzeń.** Nakładka może opakować wszystko, co
rejestruje rdzeń albo inny moduł tego samego wdrożenia, ale nie może opakować rejestracji należącej
do pakietu zainstalowanego z `node_modules` — kompozycja odrzuca to błędem
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
`entities/` albo `migrations/` modułu rdzenia). Sama reguła dotycząca schematu *nie* została
wycofana — moduł nakładkowy nadal nie wnosi schematu, a próba jest odrzucana, a nie ignorowana: w
tym repozytorium przez `generate-composer.ts`, a w instancji przez polecenia wymienione niżej, w
sekcji *Zabezpieczenia odmawiające w razie wątpliwości*.

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
zabezpieczeniach `preHandler` trasy i po walidacji schematu: interceptor wstępny może zablokować
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
- **Schemat w nakładce** — klasa `@Entity()` albo migracja w `backend/src/apps/`, odrzucana przez
  `generate-composer.ts`. W instancji katalog `migrations/` lub `entities/` albo klasę `@Entity()`
  w `apps/<deployment>/modules/` odrzucają — wskazując każdy plik i sposób naprawy —
  `pnpm run generate`, `pnpm run migrate`, każde polecenie `module:*` oraz API i worker przy
  starcie. Nawet w drzewie, w którym nigdy nie uruchomiono `generate`, nie da się więc złożyć
  modułu korzystającego z nieistniejącej tabeli.
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

## Zabezpieczenia nadal obowiązują

Dekoracja opakowuje *implementację*, nigdy punkt, w którym działa zabezpieczenie: kod nakładki
podlega tej samej izolacji tenantów, temu samemu zawężaniu do kanału sprzedaży i temu samemu
audytowi przez Command Bus co rdzeń. Moduły nakładkowe są zwykłymi uczestnikami cyklu życia —
muszą rejestrować swoje uprawnienia i przejść kontrolę inwentarza uprawnień w każdym wdrożeniu.

## Dodawanie nakładki

```bash
# 1. Dodaj moduł nakładkowy wdrożenia (zawiera backend.ts, nigdy plugin.ts):
#    backend/src/apps/acme/modules/acme_loyalty/{manifest,backend}.ts

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
