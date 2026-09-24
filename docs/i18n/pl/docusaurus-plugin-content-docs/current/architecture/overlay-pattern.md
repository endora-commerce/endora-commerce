---
title: Wzorzec overlay (dostosowanie per deployment)
---

# Wzorzec overlay

Platforma to produkt **multi-deployment** — jeden codebase, wiele instalacji
klientów. Dostosowanie per deployment idzie przez **warstwę overlay per deployment**
rozwiązywaną deterministycznie w czasie buildu/kompozycji, nigdy przez edycję plików
core ani fork. Core pozostaje niezależny od
deploymentu, a build bare-core działa bez zmian.

## Jak to działa

- **Lokalizacja overlay** — własne moduły deploymentu żyją pod
  `backend/src/apps/<deployment>/modules/<id>/…`. Aktywny deployment wybiera
  zmienna środowiskowa `DEPLOYMENT` w czasie buildu; brak wartości (albo deployment
  bez katalogu overlay) oznacza build bare-core.
- **Moduł overlay posiada każdy plik, który wysyła.** Nic w nim nie shadowuje, nie
  zastępuje ani nie rozszerza pliku innego modułu. Nie ma klasyfikacji jego zawartości
  ani reguły, co może gdzie leżeć — to zwykły moduł należący do jednego klienta.
  (Nie zawsze tak było; patrz *Kiedyś było shadowowanie plików* poniżej.)
- **Jedno id, jeden właściciel** — id modułu overlay już zajęte przez core, pakiet
  modułu w workspace, zainstalowany pakiet albo inny moduł overlay powoduje odmowę
  kompozycji, wymieniając plik każdego roszczącego się.
- **Deterministyczne rozwiązywanie** — resolver (`backend/src/overlay/`) listuje
  katalogi modułów pod rootem overlay ze stabilnym sortowaniem. Identyczne wejścia
  dają identyczne rozwiązanie i identyczny **raport divergence**, więc rebuild
  nigdy nie dryfuje.
- **Raport divergence** — każdy build emituje zatwierdzony, deterministyczny zapis
  każdego sposobu, w jaki deployment różni się od core, w dwóch renderach z jednej
  derivacji: `divergence.generated.ts` dla programu i
  `divergence.generated.md` dla człowieka (`divergence.core.generated.*` dla bare
  core; per deployment pod `apps/<name>/`). Każdy wpis nazywa, co zostało zmienione,
  który z modułów deploymentu to zmienił, który moduł posiada to, co zostało
  zmienione, stopień [drabiny dostosowania](./customisation-ladder.md), na którym
  to siedzi, i zdanie, które deployment napisał, gdy to robił. Poprzednik rejestrował
  jeden fakt — które moduły overlay deployment dodaje — i przetrwał jako pole
  `overlayModules` raportu.
- **Własna deklaracja deploymentu** — `apps/<name>/divergence.ts`, pisana ręcznie
  i recenzowana, niesie trzy rzeczy, których spacer nie wyprodukuje: moduły, których
  ten deployment nie wysyła, kolejność owijania, gdy dwa jego moduły overlay dekorują
  jedną nazwę, i jedno zdanie na każdą wyprowadzoną divergence. Jest uzgadniana z
  raportem **w obie strony**: divergence bez zdania failuje build, i zdanie opisujące
  divergence, której już nie ma, też.

## Co możesz nadpisać

Każdy wiersz nazywa szew. Żaden nie nazywa ścieżki pliku, bo nie ma szwu, który
by ją przyjmował.

| Chcesz | Szew |
|------|------|
| Zmienić, co robi serwis core | `ctx.di.decorate('<name>', (inner) => …)` z własnego modułu overlay deploymentu — patrz *Nadpisania serwisów to dekoracje* poniżej |
| Dodać capability | moduł overlay tylko dla klienta pod `backend/src/apps/<deployment>/modules/<id>/`, wysyłający `backend.ts` i `manifest.ts` |
| Uruchomić przed lub po endpoincie innego modułu; wetować go; przepisać odpowiedź | `ctx.interceptors` |
| Zmienić zachowanie, które właściciel przewidział | port strategii, który właściciel publikuje, rejestrowany za `ctx.di.providePort` i czytany przez `lazyPort` |
| Zmienić konfigurację | Setting zadeklarowany w manifeście i `divergence.ts`, żeby pominąć moduł |
| Dodać tabele specyficzne dla klienta | z **modułu core**, czytane z overlay przez port tego modułu — moduł overlay nie wnosi schematu, patrz poniżej |
| **Zastąpić handler trasy w całości** | **Brak szwu. Nie oferowany.** Patrz *Jedna rzecz, na którą nie ma szwu* poniżej |

## Moduł overlay nie wnosi schematu

Moduł overlay per deployment wnosi rejestracje, trasy, dekoracje, interceptory,
uprawnienia, bundle i18n i manifest. **Nie wnosi schematu**: żadnej klasy `@Entity()`
ani migracji.

Ta strona kiedyś mówiła odwrotnie („wysyłaj nowy schemat jako moduł overlay tylko
dla klienta, który posiada własne tabele”), a generator odmawiał tego przez cały czas.

**Powód nie jest kolejnością migracji.** Ta strona kiedyś podawała jeden — że
kolejność wykonania rejestru migracji ma sens „tylko nad stałym zbiorem”, więc zbiór
zmieniający się per deployment nie ma jednej poprawnej kolejności do commitowania.
Ten argument zmierzono i jest fałszywy: dodanie migracji modułu-liścia zostawia
względną kolejność każdej istniejącej migracji dokładnie bez zmian, bo liść wnosi
krawędzie zależności tylko ze siebie. Wycofano; nie powtarzaj go.

Prawdziwy powód jest mniejszy i trzyma niezależnie od tego: **overlay żyje w tym
samym repozytorium i tym samym buildzie co core**, więc remedium jest zawsze dostępne
i nic nie kosztuje poza katalogiem. Deployment, który chce tabele specyficzne dla
klienta, wysyła je z modułu core i czyta z modułu overlay przez port tego modułu —
moduł overlay trzyma resztę: własne serwisy, trasy, dekoracje i uprawnienia. Zezwolenie
overlay na schemat dodałoby drugi mechanizm posiadania schematu i nie kupiłoby żadnej
capability, a to nie jest warte swojej wagi.

**Pakiet rozszerzenia to odwrotny przypadek.** Autor pakietu third-party nie ma
modułu core, z którego mógłby wysłać tabelę, więc ta sama reguła byłaby zakazem
całego programu pakietów rozszerzeń, a każda jego rodzina utrwala stan. Reguła
dlatego pozwala pakietowi własne encje i migracje. Ten mechanizm nie jest jeszcze
zbudowany — dziś jedyny schemat, który wykonuje działająca platforma, to core — więc
nic na tej stronie nie zmienia się dla deploymentu.

## Nadpisania serwisów to dekoracje

Nadpisanie serwisu przez klienta **owija** implementację core i deleguje do niej.
Nie shadowuje pliku i nie dziedziczy po core.

To własność poprawności, nie preferencja stylu. Zastąpienie serwisu oznacza, że
deployment przestaje dostawać poprawki core do nadpisanych metod w dniu napisania
override — cokolwiek core zrobi z tą metodą potem ląduje w klasie, której deployment
już nie instancjonuje, i nikt się dowie, dopóki zachowanie nie rozejdzie się w
produkcji. Wrapper trzyma core w ścieżce wywołania, więc poprawka core dociera
*i* zachowanie klienta przetrwa.

Dekorację pisze się z **własnego modułu overlay** deploymentu, w jego
`registerModule`, i nie ma innego sposobu, żeby ją napisać:

```ts
// backend/src/apps/acme/modules/acme_pricing/backend.ts
export function registerModule(ctx: ModuleContext): void {
  ctx.di.decorate<DecoratedPricing>('pricingService', (inner) => wrap(inner));
}
```

Nazywa **rejestrację**, nie plik, więc przeniesienie pliku przez core nic nie psuje,
a deployment może nadpisać drugi serwis bez edycji core jakiegokolwiek rodzaju.

Gdy dwa moduły dekorują tę samą rejestrację, kolejność owijania musi być zadeklarowana
— kompozycja failuje, zamiast wybierać po kolejności ładowania pakietów — i każda
zastosowana dekoracja pojawia się w raporcie override composera.

### Kiedyś był drugi mechanizm i jest wycofany

Do 2026-08 deployment mógł też wrzucić plik pod
`backend/src/apps/<deployment>/decorations/`, nazwany po rejestracji, którą owijał,
i eksportujący `decorate(inner)`. Jeśli czytasz drzewo klienta, które nadal ma jeden,
albo dokument, który nadal go opisuje, oto dlaczego zniknął i czemu nie warto go
wynajdywać na nowo.

Istniał, bo warstwa overlay poprzedzała zmianę, która uczyniła moduł overlay zwykłym
uczestnikiem kompozycji. Moduł overlay był wtedy `plugin.ts` nad zamrożonym kontekstem
siedmiu pól: nie mógł sięgnąć do kontenera, więc nie mógł niczego dekorować, a
deployment chcący owijać serwis nie miał dokąd sięgnąć. Ta zmiana dała modułowi overlay
pełny `ModuleContext` — `ctx.di.decorate` włącznie — co zostawiło szew plikowy bez
własnej capability.

Był też, jak wysłany, udokumentowaną capability, która cicho nic nie robiła dla
każdej rejestracji poza jedną. Loader czytał *każdy* plik w tym katalogu i kluczował
mapę po nazwie rejestracji z nazwy pliku; jedyny konsument szukał jednego
hard-coded klucza i wyrzucał resztę mapy. Deployment dodający `decorations/command-bus.ts`
dostawał brak wrapa, brak ostrzeżenia i brak błędu. Rozszerzenie wymagało edycji
core per rejestrację — dokładnie sprzężenia, które wzorzec overlay ma usunąć.

**Jedna rzecz naprawdę została oddana.** Plik importował `*.interface.ts` właściciela,
więc `tsc` trzymał wrapper przy tym interfejsie i odmawiał w chwili zmiany interfejsu
— pierwotna bramka kontraktu. `ctx.di.decorate<T>` asertuje `T` w miejscu wywołania
i nie porównuje go z niczym, więc owinięty kształt jest deklarowany **strukturalnie**,
a dryf interfejsu wychodzi w runtime zamiast przy buildzie. Gdy deployment chce bramkę
z powrotem, droga to opublikowanie interfejsu przez moduł właściciela na subpath `./ports`
pakietu i nazwanie go tam przez overlay: reach type-only `./ports` nie jest reach
przez granicę modułu, a zmiana kształtu opublikowanego typu kosztuje major version.

### Dekorowanie przez właścicieli to wyłącznie sprawa deploymentu

`ctx.di.decorate` odmawia modułowi, który owija rejestrację, której sam nie
zarejestrował. Powód: dekoracja przepisuje, co *każdy* konsument tej nazwy rozwiązuje:
moduł core mogący owijać `commandBus` obserwuje każdy audytowany zapis w platformie,
ten owijający `auditLogService` zmienia to, co audyt rejestruje, a ten owijający port
odczytu innego modułu siedzi między konsumentem a właścicielem bez niczego zadeklarowanego
gdziekolwiek. Moduł potrzebujący innego zachowania od innego modułu prosi o szew — port,
punkt contribution, zdarzenie — co jest sprzężeniem, które manifest deklaruje, a checki
widzą. Nazwa zarejestrowana przez root kompozycji jest odmawiana tą samą regułą: żaden
moduł jej nie posiada, więc żaden nie może jej owijać.

Moduł overlay jest jedynym wyjątkiem, bo to inny akt. Deployment owijający core to szew
dostosowania, który opisuje ta strona; core owijający core to sprzężenie, które nic nie
deklaruje. Wyjątek nie jest roszczeniem modułu o siebie — wygenerowany composer oznacza
wpis `overlay: true` z roota, pod którym moduł został odkryty,
`backend/src/apps/<deployment>/modules/`, więc core nie ma jak tego asertować, a
`overlay:check` failuje na ręcznie edytowanym artefakcie.

**Wyjątek kończy się na zainstalowanym pakiecie rozszerzenia.** Overlay może
owijać wszystko, co rejestruje core albo inny z własnych modułów deploymentu, i nie
może owijać rejestracji należącej do pakietu zainstalowanego z `node_modules` —
`PackageDecorationNotOfferedError`, odmowa przy kompozycji, nazywając overlay, pakiet
i rejestrację. Powód: nie ma niczego, względem czego napisać wrap — mapa `exports` pakietu
publikuje `registerModule`, encje, migracje i `./ports`, a nazwy kontenera, które
rejestruje wewnętrznie, nie publikuje żaden z nich, więc nazwa może się zmienić w patch
release. Bramka `*.interface.ts`, którą niósł wycofany szew plikowy, też się nie
przeniosła — dla pakietu kompilator trzymałby deployment przy `dist/*.d.ts` napisanym
przez kogoś, kogo deployment nie zatrudnia. Komunikat mówi *not offered yet* zamiast
*forbidden* i nazywa wyjście: pakiet deklarujący, które rejestracje są dekorowalne,
`./ports` jako naturalny dom, gdzie zmiana kształtu kosztuje major version bump. Do
tego czasu poproś autora pakietu o port, zdarzenie albo użyj interceptora wokół jego tras.

Dekoracje są **stosowane po tym, jak każdy moduł się zarejestrował**, nie przy
wywołaniu. Z której tablicy moduł był skomponowany, nie ma znaczenia dla tego, co może
owijać, a dekoracja nazwy, której nic nie rejestruje, oznacza dokładnie to, a nie „jeszcze
nie”. Kolejność w drain to kolejność wywołań, dlatego jeden moduł dekorujący nazwę dwa
razy jest jednoznaczny, a dwa moduły dekorujące ją — nie.

Wcześniejsze nadpisanie serwisu shadowowało
`modules/<id>/services/<name>.ts` i zastępowało klasę core. To też wycofano,
całkowicie: plik `services/` pod modułem overlay to teraz po prostu jeden z własnych
plików modułu, bo moduł overlay posiada wszystko, co wysyła.

## Kiedyś było shadowowanie plików i jest wycofane

Do 2026-09 ta strona opisywała drugi mechanizm: plik overlay pod tą samą ścieżką
względem modułu co plik core *shadowował* go, z taksonomią nadpisywalnych rodzajów
(`route`, `config`), dwoma odrzuconymi (`schema`, `other`), polityką konfliktów i
trzema odmowami w czasie buildu. Jeśli czytasz drzewo klienta, starszą specyfikację
albo dokument, który nadal to opisuje, oto dlaczego zniknęło i czemu nie warto go
wynajdywać na nowo.

**Nic z tego, co działało, nie zostało oddane**, i to zmierzone, nie asertowane.
`git log -S` po całej historii `backend/src/overlay/` znajduje dokładnie jeden loader
shadowowanego pliku kiedykolwiek napisany — `loadOverlayServiceClasses`, dla
`service` — a usunięto go celowo, zastępując `ctx.di.decorate` z powodu
podanego w sekcji powyżej. `route` i `config` nigdy nie miały loadera: output `overrides`
resolvera miał dokładnie jednego konsumenta w historii drzewa, generator raportu
divergence (wtedy generator override-manifest), który serializował go do artefaktu
audytu. Override trasy nigdy nie zmieniał tego, co działająca platforma serwowała,
na żadnym deploymentzie, w żadnym stanie drzewa.

**I przestało nawet klasyfikować.** Skan indeksował core z `backend/src/modules`,
który nie trzyma modułu od zakończenia packaging sweep 2026-08-28. Przy pustym indeksie
każdy katalog overlay kończył na „zupełnie nowy moduł roszczący ten id” zanim spojrzał
na jeden plik, więc wszystkie trzy odmowy poniżej były nieosiągalne — w tym ta, której
całym zadaniem było zatrzymać deployment wysyłający migrację, która nigdy by nie
poszła. Martwa straż fail-closed jest gorsza niż brak straży: autor, który jej ufa,
dostaje ciszę.

Wycofano z tym: **Conflict** (dwa overlay na jedną jednostkę core), **Unknown target**
(plik overlay bez odpowiednika w core) i **Schema override** (plik overlay pod
`entities/` albo `migrations/` modułu core). Sama reguła schematu *nie* jest wycofana —
moduł overlay nadal nie wnosi schematu, a `generate-composer.ts` to odmawia, bo to
jedyne miejsce, które może powiedzieć, że tabela nigdy by nie powstała.

**Dlaczego nie naprawiono zamiast wycofać.** Shadowowanie pliku wewnątrz opublikowanego
pakietu nie jest spójną operacją. Platforma komponuje moduł przez
`@endora-commerce/mod-<id>/backend`, którego mapa `exports` wskazuje na `dist`, więc
sprawienie, by jeden plik overlay zastąpił jeden z nich, oznaczałoby przechwycenie
rozwiązywania Node dla jednego pliku jednego pakietu — ponowne wprowadzenie *źródła*
tego pakietu do grafu, który już trzyma jego build output. Dwie reguły odmawiają kształtów,
które by to wymagały: ta, dlatego pakiet modułu w ogóle wysyła `dist`, i
`check:singleton-identity`, którego cały temat to to, że dwukrotna ewaluacja jednego
pakietu duplikuje wartości module-scope **w ciszy**. Zrobienie tego na poziomie
specifiera — wskazanie pakietu na kopię deploymentu — unika podwójnej ewaluacji i
zastępuje cały moduł, co jest forkowaniem modułu zamiast nadpisywaniem jednego, a to
jest to, przed czym istnieje reguła nienaruszonego core.

## Jedna rzecz, na którą nie ma szwu

**Nie ma sposobu, żeby zastąpić handler trasy w całości.** `ctx.interceptors`
uruchamia się po własnych strażnikach `preHandler` trasy i po walidacji schematu:
pre-interceptor może wetować przez rzucenie zarejestrowanego `HttpError` i może
zastąpić zwalidowane body, a post-interceptor może zastąpić payload, ale żaden nie
może podstawić handlera.

To nie regresja wprowadzona przez wycofanie — shadowowanie trasy nigdy też nie
zastępowało handlera. Jest tu powiedziane wprost, a nie domyślnie, w idiomie, którego
już używa `PackageDecorationNotOfferedError`: not offered, nazywając wyjście. Uczciwa
sekwencja dla deploymentu, któremu to potrzebne, to dekoracja serwisu, którego handler
woła — tam zwykle siedzi zachowanie — albo prośba do modułu właściciela o port. Jeśli
realny deployment okaże się potrzebować więcej, to feature z prawdziwym wymaganiem za
sobą i nie powinien być uzasadniany mechanizmem, który nigdy nie działał.

## Straże fail-closed

Każdą straż z tej listy da się sprowokować. Build failuje — nigdy nie rozwiązuje
w ciszy — gdy:

- **Kolizja id modułu** — moduł overlay roszczący id już trzymane przez core, pakiet
  modułu w workspace, zainstalowany pakiet albo inny moduł overlay. Odmowa wymienia
  plik każdego roszczącego się.
- **Schemat overlay** — klasa `@Entity()` albo migracja pod `backend/src/apps/`,
  odmawiane przez `generate-composer.ts`.
- **Brak manifestu** — katalog modułu overlay bez `manifest.js`/`manifest.ts`.
  Odmowa nazywa oba kandydaty.
- **Backend nierejestrowalny** — moduł overlay, którego `backend.js`/`backend.ts`
  nie eksportuje `registerModule`. (Katalog *bez* entry pointu backend jest pomijany
  celowo: deployment może wysłać moduł bez połowy serwerowej.)
- **Niejednoznaczna dekoracja** — dwa moduły dekorują jedną rejestrację bez zadeklarowanej
  kolejności.
- **Obca dekoracja** — moduł core dekoruje rejestrację, której nie posiada.
- **Dekoracja pakietu** — overlay dekoruje rejestrację należącą do zainstalowanego
  pakietu rozszerzenia; not offered yet, a odmowa to mówi.

## Straże nadal obowiązują

Dekoracja owija *implementację*, nigdy szew straży: kod overlay działa pod tą samą
izolacją tenantów, scopingiem kanału sprzedaży i audytem Command Bus co core.
Moduły overlay to zwykli uczestnicy lifecycle i
muszą rejestrować uprawnienia oraz przejść check inventory uprawnień per deployment.

## Dodawanie overlay

```bash
# 1. Dodaj moduł overlay deploymentu (wysyła backend.ts, nigdy plugin.ts):
#    backend/src/apps/acme/modules/acme_loyalty/{manifest,backend}.ts

# 2. Nadpisz serwis core z jego registerModule, po nazwie rejestracji:
#    ctx.di.decorate('pricingService', (inner) => wrap(inner))

# 3. Powiedz dlaczego, we własnej deklaracji deploymentu:
#    backend/src/apps/acme/divergence.ts, `reasons`, kluczowane własnym kluczem wpisu
#    — `decoration:acme_loyalty:pricingService`

# 4. Wyrenderuj raport divergence deploymentu i commituj oba rendery:
DEPLOYMENT=acme pnpm --filter backend run overlay:divergence

# 5. Sprawdź, że każda divergence jest wyprowadzona, posiadana i wyjaśniona, oraz że
#    zatwierdzone artefakty to to, co produkuje to drzewo:
pnpm --filter backend run check:divergence
pnpm --filter backend run overlay:check
```

**Którego szwu sięgnąć i co każdy kosztuje** to
[drabina dostosowania](./customisation-ladder.md). Przeczytaj ją przed napisaniem
czegokolwiek z powyższego: stopień 3 nie jest dostępny dla deploymentu chcącego
podstawić implementację, a ta strona to mówi, zamiast wysyłać do mechanizmu, który
ci odmówi.
