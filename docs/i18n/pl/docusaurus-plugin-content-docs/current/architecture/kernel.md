---
title: Kernel — granica, zakresy i kolejność kompozycji
---

# Kernel

Każdy moduł komponuje się przez kontener Awilix. **Kernel**
(`packages/platform/src/kernel/`) posiada kontener, szwy, przez które moduł się
rejestruje, oraz garść usług wspierających niemal każdy moduł. Ta strona
obejmuje trzy rzeczy, które musisz znać, zanim napiszesz lub zmienisz moduł:
**co kernel może i czego nie może zawierać**, **jak dociera się do stanu per-request**
oraz **kiedy rejestracje i hooki faktycznie się wykonują**.

To ostatnie nie jest dekoracja. Kolejność kompozycji złapała trzy konwersje
modułów, za każdym razem tak samo, i za każdym razem
wyglądało to jak brakująca rejestracja, a nie błąd kolejności.

## Granica

**Kernel posiada kształty i infrastrukturę platformy. Nigdy nie posiada zachowania
domenowego.**

| W kernelu | Dlaczego |
| --- | --- |
| `container.ts`, `compose.ts`, `module-context.ts`, `scope.ts` | Sama maszyna kompozycji |
| `ports/` — `require-admin`, `organizations`, `settings`, `sales-channel` | **Typy**; moduł-właściciel rejestruje implementację |
| `audit/` | Każdy audytowany zapis przechodzi przez jednego pisarza |
| `settings/`, `sales-channels/` | Odczyt settings i rozwiązanie kanału wspierają zachowanie w niemal każdym module, więc żaden nie może być bramkowany na którymkolwiek z nich |
| `lifecycle/` | Maszyna obecności: cache rejestru, resolver aktywacji, łącznik effective-state i opakowania bramkujące, przez które przechodzą trasy, workery i subskrybenci każdego modułu |
| `lazy-port.ts` | Jak moduł czyta port innego modułu bez jego zamrożenia |

Reguła, która z tego wynika: **kernel nie może importować z `src/modules/` ani
`src/apps/`** — moduł→kernel jest zawsze dozwolony, kernel→moduł nigdy.
`src/apps/` też jest po stronie zakazanej: moduł overlay to zwykły uczestnik
lifecycle, a dekoracja to kod per-deployment, więc kernel sięgający w którekolwiek
z nich to kernel różniący się per deployment.

### Peers kernela przestrzegają tej samej reguły

`src/http`, `src/events` i `src/tenancy` to **peers platformy przestrzegający kernela**,
i żaden z nich nie może importować `src/modules/` ani `src/apps/`.

| Peer | Czym jest | Dlaczego przestrzega |
| --- | --- | --- |
| `src/events/` | Jeden plik 81 linii: bus in-process oparty na `AsyncLocalStorage`, generyczny względem mapy zdarzeń, importujący tylko `node:async_hooks` | Brak rzeczownika domenowego w całym pliku |
| `src/tenancy/` | Straż izolacji tenantów: nazwy kolumn jako stringi, fragmenty `where` nad nieprzezroczystym polem, czysta funkcja actor→`TenantContext` | Pięć encji kernela bierze `@GlobalEntity()` stąd — warstwa persistence kernela bez tego nie istnieje |
| `src/http/` | Bootstrap Fastify, koperta błędu, rejestracja OpenAPI, kodowanie kursora, rejestr interceptorów | Cztery pliki kernela biorą `HttpError` stąd **jako wartość** |

Nie są opcjonalne dla kernela; bez nich się nie kompiluje. Zależność, bez której
kernel nie może się skompilować, a która sama może importować moduł, to kernel
importujący moduły z jednym dodatkowym skokiem — w terminach pakietów cykl
`kernel → http → mod-i18n → kernel`, a warunek wstępny F4 mówi, że pakiety nie
są cykliczne.

### Tematem jest teraz cały pakiet, nie lista peers

Wcześniejsze sformułowanie reguły peerów zostawiło trzy katalogi na zewnątrz —
`src/db` „nazywa każdy moduł z konstrukcji”, `src/overlay` to „rozwiązanie
per-deployment”, a `src/commands` siedzi *nad* kernelem, co to sformułowanie
oznaczyło jako „prawdziwy otwarty punkt, który F4 musi zamknąć”. Wszystkie trzy
były katalogami **aplikacji**, gdy to
pisano, i każde założenie poszło z relokacją: `packages/platform/src/db/`
nie importuje modułu (wygenerowane rejestry zostały w `backend/src`), `overlay/`
platformy to loader biorący root overlay i roszczenia id jako parametry, a F4
jest zamknięte.

Więcej: argument, na którym spoczywa reguła peerów, zmienił kształt. *Jeden
dodatkowy skok* liczył skoki między katalogami źródłowymi, które mogły stać się
**różnymi pakietami**. Nie stały się: `@endora-commerce/platform` kompiluje
każdy katalog pod `packages/platform/src` w jeden artefakt (`rootDir: ./src`,
`files: ["dist"]`) za jednym blokiem `dependencies`, a każdy pakiet modułu od
niego zależy. Specifier modułu gdziekolwiek pod `packages/platform/src` zamyka
cykl przy **zerze** skoków, niezależnie od katalogu, który go pisze, a odpowiedzią
jest pakiet, a nie dłuższa lista peers.

**Ta reguła jest egzekwowana.** `backend/scripts/check-kernel-boundary.ts` niesie
trzy reguły nad jedną zasadą. **Reguła A** odmawia relacji ORM z kernela do
modułu. **Reguła B**, poszerzona dwukrotnie od napisania, odmawia specifiere
importu nazywającego moduł z dowolnego pliku pod **rootem platformy**.
**Reguła C** odmawia go gdziekolwiek w domknięciu importu transitive kernela,
ilekolwiek skoków stamtąd.

**Rooty Reguły B są wyprowadzane i nigdzie nie są zapisane** — to katalogi
członka workspace deklarującego `endora: { type: "platform" }`, więc następny
katalog platformy jest oceniany przez istniejące. Były czteroelementowym
literałem aż do wylądowania tego wyprowadzenia, przy platformie, która urosła do
czternastu katalogów:
dziesięć było poza regułą w ogóle, w tym `composition/`, gdzie mieszka
`composeApp`. Mapa `exports` platformy to oczywista alternatywa wyprowadzenia
i **celowo nie jest używana** — odpowiada na *co konsument może nazwać*, a
`src/demo/` to prawdziwy katalog platformy bez własnego subpath — ale służy jako
niezależne potwierdzenie checka, więc opublikowany subpath nie nazywający
żadnego przechodzonego katalogu to exit 2.

**Reguła B odmawia obu pisowni adresu modułu**: względnego specifiere do
`src/modules/` lub `src/apps/` oraz **gołej nazwy npm** pakietu modułu. Druga
przyszła z tym samym poszerzeniem, na własnym warunku wycofania checka — mówił, że goły specifier
nie może dotrzeć do modułu, bo pakiet modułu nie istniał — a od zamknięcia F4
`backend/src/modules/` trzyma tylko `README.md`, więc goła nazwa to jedyna
pozostała pisownia.

B i C celowo nie są redundantne, i każda pokrywa ślepy punkt drugiej: B to
populacja, a jeden peer został kiedyś pominięty dokładnie dlatego, że nigdy nie
trafił na listę; C nie ma populacji do utraty, ale jest ślepa na pliki peerów, do
których kernel obecnie nie dociera. B w komunikacie nazywa linię, C nazywa
łańcuch.

Obie widzą każdy kształt specifiere — `import`, `import type`,
`export … from`, dynamiczne `import()`, `require()` oraz inline
`import('…').Type`, który własna konfiguracja ESLint repozytorium zachęca.
Import tylko typu to naruszenie jak każde inne: znika z bundla, ale nie z
`package.json`, a `prefer: 'type-imports'` ESLinta inaczej by przepierał
naruszenia obok reguły automatycznie.

Cztery importy szły kiedyś z `src/kernel/` do `src/modules/`:
`module-context.ts` brał trzy opakowania bramkujące, `ports/provide.ts` brał
`ModuleDisabledError` i `effectiveState`, a `ports/organizations.ts`
type-importował klasę encji `Organization`. Relokacja maszyny obecności —
`plugin-helpers.ts`, `registry-cache.ts`, `effective-state.ts`,
`activation-resolver.ts` i `module-registration.entity.ts` — do
`src/kernel/lifecycle/` rozwiązała pierwsze trzy. Czwarte rozwiązało się, gdy
port wziął strukturalny snapshot zamiast klasy encji, a wraz z nim jeden import
peer (`src/http/error-envelope.ts` sięgający `_i18n` po mapę tłumaczeń błędów,
teraz wstrzykiwaną).

`KERNEL_MODULE_IMPORTS_TO_DRAIN` jest więc **pusty** i zostaje jako dwukierunkowy
grzyb: niezledgerowany import psuje build **oraz** wpis ledgera, który już nie
opisuje importu, też go psuje. Wpis to dług z właścicielem, nigdy stałe
zwolnienie.

Jedno ograniczenie reguły pozostaje, celowe i podane w nagłówku skryptu:
współlokalizowany `*.test.ts` pod rootem platformy nie jest skanowany, bo test
może importować fixture i nie jest artefaktem, o który chodzi pakowaniu.

Najpierw próbowano prozy, i nie wytrzymała. `kernel/index.ts`, `tenancy/index.ts`
i `http/interceptors/registry.ts` wszystkie deklarują tę regułę w komentarzu
nagłówkowym; wszystkie trzy były prawdziwe, wszystkie trzy nieegzekwowane, a
plik, który ją złamał, i tak ją złamał. To argument za checkiem.

`ports/organizations.ts` pokazuje podział najwyraźniej. Kernel deklaruje
`OrganizationReadPort` — `loadEffectiveOrganization`, `assertCanTransact`,
`loadCartApprovalPolicy` — bo niemal każdy moduł musi czytać Organization.
**Nie implementuje go.** `organizations` rejestruje
`OrganizationContextService` pod tą nazwą, więc kształt jest platform-wide,
a zachowanie zostaje w module, który posiada tabelę.

Port typuje wartości zwrotne strukturalnym `OrganizationSnapshot`
należącym do kernela — `{ id, status }`, z `OrganizationStatus` z
`@endora-commerce/contracts` — zamiast klasy encji `Organization` modułu. To
cała powierzchnia, którą konsumenci portu używają: `promotions` czyta `status`,
a `carts` i `orders` odrzucają wartość zwrotną w ogóle, bo chcą rzutu.
TypeScript jest strukturalny, więc `OrganizationContextService` spełnia port
zwracając swoją encję, **bez warstwy mapowania i bez zmiany implementacji**.

**Encja zostaje w `organizations`, na stałe.** Relokacja jak `SalesChannel`
nie przenosi: `sales_channels` nie wysyła migracji, a jego tabela była już
`core`, podczas gdy `organizations` wysyła osiem migracji piszących tabelę
`organizations`, z czego sześć tworzy też tabele należące do modułu. Uczciwe
wykonanie to podział sześciu migracji, rename ośmiu zastosowanych klas i
skoordynowany rebuild bazy — dla portu konsumującego dwie właściwości
24-właściwościowej encji. `src/tenancy` to precedens, który czyni snapshot
słusznym, a nie tylko tanim: egzekwuje izolację tenantów znając Organization
jako UUID w kolumnie i nigdy jako klasę.

## Rejestracja: trzy szwy

`backend.ts` modułu eksportuje `registerModule(ctx)`. Są trzy sposoby
włożenia czegoś do kontenera, a wybór złego to najczęstszy komentarz review.

### `ctx.di.providePort(name, registration)` — port, który posiadasz

Użyj dla usługi, którą rozwiązują inne moduły. `providePort` owija rejestrację
w **bramkę transient**, która sprawdza effective state modułu, więc wywołujący
dostaje kopertę 503 `MODULE_DISABLED` zamiast półwykonanej operacji, gdy
moduł jest wyłączony.

```ts
ctx.di.providePort(
  'organizationRestrictionPort',
  ctx.asFunction(({ emFactory, auditLogService }: Cradle) =>
    new OrganizationRestrictionService(emFactory, auditLogService)).singleton(),
);
```

### `ctx.di.register({...})` — własne usługi i punkty wkładu

Użyj dla usług rozwiązywanych tylko przez twój moduł oraz **punktów wkładu**:
nazwy, którą domyślnie ustawiasz sensownie, a root kompozycji może nadpisać.

```ts
// Domyślnie: kompozycja bez poczty wychodzącej nic nie wysyła, co jest spójne.
cartAbandonmentNotifier: ctx.asFunction(() => undefined).singleton(),
```

Punkt wkładu to szew **root↔moduł** i tylko to. Moduł nie może pisać nazwy,
którą posiada inny moduł — `ctx.di.register` rości każdy klucz, który pisze,
a kernel rzuca `DuplicateRegistrationError` przy drugim pisarzu. Powód nie jest
mechaniczny: root siedzi poza grafem zależności manifestu i nie ma tablicy
`dependencies`, która mogłaby zapisać krawędź, więc wkład roota to jedyny zapis,
którego nie da się wyrazić jako port. Krawędź moduł↔moduł zawsze może być,
i dlatego musi być.

**Szew biegnie jedną stroną, a kernel to mówi.** Moduł nie może
pisać nazwy, którą dostarcza **root kompozycji**: `ctx.di.register` i
`ctx.di.providePort` rzucają `ForeignRegistrationError` dla nazwy, którą
kontener już trzyma, a żaden moduł nie rości. Ten zbiór jest wyprowadzany przy
każdej kompozycji i nigdzie nie jest zapisany — nazwa bez właściciela modułu to
nazwa zarejestrowana przez root — więc root, który zaczyna lub przestaje
dostarczać jedną, zmienia odpowiedź w tym samym przebiegu. Dopóki to nie
wylądowało, `registerValues` nie rościł własności, a `claim` rzucał tylko dla
*innego* modułu, więc dowolny moduł mógł zarejestrować `commandBus`,
zostać właścicielem i potem legalnie go dekorować: reguła dekoracji była
zamkiem od frontu domu, którego boczne drzwi były otwarte. Nie ma wyjątku
overlay, celowo. Deployment zmienia, do czego rozwiązuje się nazwa dostarczana
przez root, przez `ctx.di.decorate` z własnego modułu overlay, co utrzymuje core
delegujący przez wrap; przejęcie nazwy wprost odcina to dla każdego konsumenta
naraz, a zastąpienie musi być *bardziej* jednoznacznym aktem.

### `lazyPort<T>(ctx, 'name')` — czytanie cudzego portu

**Nigdy nie czytaj portu innego modułu do singletona.** `providePort` zwraca
bramkę transient; strict mode Awilix odmawia dłuższej rejestracji, która by ją
schwytała, i słusznie — schwycona bramka odpowiadałaby dalej po wyłączeniu
modułu.

```ts
// Rozwiązuje przy każdym wywołaniu przekazywanej metody, więc bramka zostaje żywa.
pricingService: lazyPort<PricingService>(ctx, 'pricingService'),
```

**„Nie do singletona” znaczy „nie podczas wiązania”, koniec** — i dwa miejsca,
które wyglądają na zwolnione, nie są. **Root kompozycji** nie ma `ctx`, więc
nie może wołać `lazyPort`, ale odczyt bramkowanego portu na top level
`composeApp()` to to samo zamrożenie z gorszym promieniem: odczyt następuje po
`loadModulePresence()`, więc moduł wyłączony przez operatora rzuca
`ModuleDisabledError` z kompozycji, a `index.ts` zamienia to w
`process.exit(1)`. Kolejny start operatora ginie, a panel, z którego by to
cofnął, jest nieosiągalny. Root odkłada tak samo jak `lifecycleManifestRegistry`
— thunk rozwiązywany tam, gdzie używana jest wartość:

```ts
// Nie `container.cradle.searchReindexPort`: rozwiązywane, gdy prosisz o reindex.
catalogSearchReindex: async () => searchCradle().searchReindexPort.reindexAll(),
```

Odroczenie to minimum, nie cel. Jeśli to, co root odkłada, to **usługa, którą
właściciel mógłby zbudować**, odpowiedzią nie jest lepszy thunk — to
właściciel rejestrujący ją, a root forwardujący na tę nazwę. Każda usługa
zbudowana przez root jest niebramkowana, cokolwiek root z nią zrobi, więc
odpowiada po wyłączeniu modułu, a oba rooty budują ją nieco inaczej wcześniej
czy później. `ROOT_MODULE_VALUE_IMPORTS` to miejsce pomiaru; liczba usług,
które root konstruuje, to zero i zostaje zero.

**Body `ctx.routes`** to drugie. `defineModuleRoutes` bramkuje *żądania*;
sama rejestracja działa przy effective state modułu wewnątrz `buildServer`. Destrukturyzacja
własnego bramkowanego portu tam pyta bramkę, gdy aplikacja jest wiązana, i
wyłączenie modułu zatrzymuje start backendu zamiast jego tras. Weź przez
`lazyPort` — w handlerze bramka jest otwarta z konstrukcji, więc nic innego się
nie zmienia.

Oba były kiedyś żywe w drzewie; właściwość jest przypięta przez
`backend/test/integration/kernel/deactivated-boot.test.ts`.

Dwie reguły łatwe do przeoczenia:

- **Nazwa musi być literałem string.** `backend/scripts/check-port-dependencies.ts`
  czyta je statycznie; zmienna lub helper `port(ctx, name)` ukrywa rozwiązanie
  przed checkiem. Dokładnie ten helper ukrył kiedyś czternaście
  rozwiązań, z których kilka żaden root nie rejestrował, a check raportował czysto,
  podczas gdy pipeline mediów cicho nic nie produkował.
- **Zadeklaruj zależność.** Jeśli twój moduł rozwiązuje port należący do `X`,
  `X` należy do `manifest.dependencies`. Ta deklaracja czyni krawędź realną dla
  lifecycle, kolejności migracji i operatora wyłączającego `X`. Check portów psuje
  build bez tego.

## Dwa kształty krawędzi moduł↔moduł

| Kształt | Kto rozwiązuje | Bramkowany? | Kiedy | Użyj, gdy |
| --- | --- | --- | --- | --- |
| **Pull** — konsument rozwiązuje port dostawcy | konsument | tak — `ctx.di.providePort` | per call | konsument potrzebuje **odpowiedzi** |
| **Push przy starcie** — współtwórca rozwiązuje rejestr hosta w `ctx.onBoot` i woła mutator | współtwórca | **nie** — `ctx.di.register` | raz | współtwórca musi dodać **deskryptor** do zbioru, który host enumeruje |

Większość krawędzi to pull. Kształt push służy rejestrom — domyślne e-maile
transakcyjne, rejestry referencji, tabele adapterów — gdzie moduł wnosi coś,
co host później przechodzi.

**Rejestr wkładu nigdy nie jest bramkowanym portem.** Reguła:

> Rejestracja, której cały kontrakt brzmi *„dodaj nieaktywny deskryptor do tabeli,
> którą host później przechodzi”*, to `ctx.di.register` i **nigdy** nie jest
> bramkowana. Rejestracja, która liczy, decyduje, deszyfruje, wysyła, obciąża
> lub zapisuje w imieniu modułu-właściciela, to `providePort` i fail-closed.

Powód jest mechaniczny, nie stylistyczny. Hooki boot działają niezależnie od
effective state (patrz reguła 4 poniżej), a bramkowany port rzuca
`ModuleDisabledError` przy rozwiązaniu — więc bramkowanie rejestru oznacza, że
hook boot każdego współtwórcy rzuca w momencie, gdy operator wyłącza **hosta**,
i platforma nie startuje. `transactional_emails` ma siedmiu współtwórców;
`cms` ma jednego. Operator zepsuł następny start przełącznikiem, z którego
miał prawo skorzystać, a crash nazywał moduł, którego nie dotknął. (`transactional_emails`
od tego zadeklarowało się non-deactivatable, więc ten konkretny
przełącznik zniknął; reguła się nie zmieniła, `cms` nadal ją ćwiczy, a rejestr
zostaje niebramkowany, bo argument dotyczy kształtu szwu wkładu, nie tego, kto
może wyłączyć hosta.) `check-port-dependencies.ts` odmawia kształtu teraz, w
obu miejscach, gdzie może ugryźć: bramkowany port rozwiązany w hooku `ctx.onBoot`
i jeden zdestrukturyzowany w body `ctx.routes`.

Nic nie wycieka przez pozostawienie rejestru niebramkowanym, bo obie połowy są
rozdzielalne: `credentials` oddaje `configurationTypeRegistry` swobodnie
i trzyma `credentialsService` — który deszyfruje — jako port; `transactional_emails`
oddaje `emailDefaultsPort` i trzyma `templateEmailPort`, który wysyła.

**Host odpowiada na pytanie obecności zamiast tego, przy enumeracji.** To
właściwe miejsce: czy deskryptor powinien być żywy, zależy od **współtwórcy**,
a bramka na rejestracji hosta w ogóle tego nie wyraża. Każdy rejestr zapisuje
id modułu-współtwórcy przy każdym wpisie i deklaruje, **per rejestr**, czy wpis
jest honorowany, gdy jego właściciel jest nieobecny. Domyślnie: nie honorowany.
Honorowanie wymaga napisanego powodu przy klasie.

Dwie odpowiedzi są legitymne, a która jest słuszna, zależy od tego, czym jest wpis:

- **Skip** — dla wkładów *powierzchniowych*: interceptor, akcja palety,
  element storefrontu, grupa settings. Wyłączony moduł nie może wnosić niczego,
  co użytkownik widzi, więc `ctx.interceptors` stempluje `module: id`, a dispatch
  pomija wpisy, których właściciel nie jest włączony.
- **Honour** — dla *integralnościowych*: rejestry referencji odmawiające delete.
  Wyłączony `blog` nadal posiada posty osadzające asset, a pominięcie jego
  skanera pozwoliłoby operatorowi usunąć asset, który wraca uszkodzony, gdy
  `blog` wróci — dane utracone akcją, którą reguła aktywacji nazywa odwracalną.
  `EmailDefaultsRegistry` honoruje z innego powodu, napisanego przy klasie: jego
  wiersze są seedowane z osi **platformy**, więc skip nie usunąłby wiersza,
  tylko stworzyłby jeden z pustym szablonem.

Wszystkie cztery rejestry skonwertowane pod tą regułą honorują, każdy z powodem
na miejscu; polityki są przypięte przez
`backend/test/unit/kernel/contribution-seams.test.ts`
(`emailDefaultsPort`, `assetReferenceRegistry`, `cmsReferenceRegistry`,
`megamenuReferenceRegistry`).

**Dwa kolejne rejestry deklarują odwrotną politykę i są opracowanym przykładem
*skip***. `PaymentAdapterRegistry` i
`ShippingAdapterRegistry` stemplują moduł-współtwórcę przy każdym wpisie i
dzielą powierzchnię według pytającego: `get`, `resolve` i `list` filtrują po
effective state właściciela — kupujący nigdy nie widzi metody płatności, która
nie może przyjąć ich pieniędzy, a `resolve` podnosi zwykły `ModuleDisabledError` —
podczas gdy `entry`, `ownerOf`, `isRegistered` i `listAll` celowo nie filtrują,
bo ekran admin nadal pokazuje wiersz *i* powód niedostępności. Wyłączenie modułu
to nie odinstalowanie. Sonda obecności jest wstrzykiwana w singleton procesu
(`payment_methods/services/registry-singleton.ts`) zamiast wypalanej w klasę,
więc rejestr, który test buduje dla siebie, nadal odpowiada o adapterach,
które test zarejestrował.

Trzeci rejestr tej rodziny, `gatewayRefundRegistry`
(`payments/services/gateway-refund-registry.js`), to opracowany przykład
*innego okablowania*, jakie bierze szew wkładu: `stripe`,
`tpay`, `payu` i `autopay` **importują singleton** i wrzucają swój handler
refund, więc żadne rozwiązanie kontenera nie istnieje, które check mógłby zobaczyć.
Teraz zapisuje moduł-współtwórcę i deklaruje **skip**, a grunt warto zachować,
bo to argument, z którym spotyka się każda polityka po stronie pieniędzy:
wyłączona bramka nie może obciążać ani refundować przez API PSP, a skip nie
zdejmuje obowiązku — `PaymentRefundProvider` zapisuje `pending_manual` nazywając
moduł, który jest off, co dostaje deployment, który nigdy nie zainstalował
bramki. Sonda obecności jest podłączona w singletonie
(`payments/services/registry-singleton.ts`), nie w klasie, z powodu, który podaje
bliźniak: rejestr, który test buduje dla siebie, musi nadal odpowiadać o
handlerach, które test zarejestrował.

**Trzy kolejne skonwertowano później i nie dostały jednej odpowiedzi, bo
„zadeklaruj politykę” to pytanie, a nie sweep.** `ConfigurationTypeRegistry`
(`credentials`) deklaruje **skip**, na gruncie, który kolumna skip już daje:
typ konfiguracji to to, co ekran credentials oferuje do skonfigurowania i względem
czego walidowany jest zapis, więc capability wyłączone przez operatora nie jest
ani oferowane, ani tworzalne, a `resolve` podnosi `ModuleDisabledError` nazywając
współtwórcę. Współtwórca był już zapisany — deskryptor niesie `ownerModule` —
więc host miał id i po prostu go nie konsultował. Podział to adapter registries:
`entry`, `ownerOf`, `isRegistered` i `listAll` zostają ślepe na obecność, a
ścieżki, które je czytają, to te, które *renderują* przechowywaną konfigurację
i te, które redagują ją do snapshotu audytu, które muszą wiedzieć, która wartość
była sekretem. Sonda to trójstanowy `effectiveState.presenceOf`, nie `isPresent`:
ten rejestr to szew, przez który overlay lub moduł zewnętrzny wciska typ, więc
`ownerModule` może być stringiem, którego żaden manifest nie deklaruje, a
zlanie „unknown id” z „absent” odfiltrowałoby punkt rozszerzenia.

Dwa rejestry statusów zamówienia — `payment_methods:paymentOrderStatusRegistry`
i bliźniaczy z `delivery_methods` — deklarują **honour**, a powód jest taki, że
nie ma czego skipować. Ledger klasyfikuje je jako szwy wkładu, bo `payments` i
`shipments` czytają je przez granicę modułu, ale żaden moduł do nich nie
wnosi: zbiór opcji to `orderStatusSchema`, ustalony w compile time. Odczyty to
straże, nie powierzchnie — `has` jest pytane, zanim zamówienie przejdzie w
status, który nazwa settlement — więc skip zostawiłby opłacone lub wysłane
zamówienie cicho w starym statusie, a każdy kod w tabeli to jeden, w którym
live orders już są. Polityka jest strukturalna, a nie obiecana: klasa nie bierze
wejścia obecności, więc żaden odczyt nie może upuścić statusu bez zmiany polityki
najpierw. To, co operator traci wyłączając te moduły, niesie tam, gdzie należy —
każdy moduł zamyka własny katalog na własnym szwie, a `orders` deklaruje zdanie,
które dialog potwierdzenia wyrenderuje.
## Ledger konsekwencji deaktywacji

Odmowa przy flipie lifecycle staje się świadomym potwierdzeniem, więc platforma
może spocząć z **obecnym modułem zależnym od nieobecnego**. Każdy
szew między nimi potrzebuje odpowiedzi na „co się dzieje?”, a operator proszony
o akceptację flipu potrzebuje tej samej odpowiedzi, z nazwą, przed zapisem. Jest
jeden artefakt dla obu, i to jest jego sens, a nie oszczędność:
`lifecycle/services/deactivation-ledger.ts`.

`buildDeactivationLedger` przypisuje każdej krawędzi cross-module, której właściciela
operator może wyłączyć, jeden z czterech wyników:

| Wynik | Mechanizm |
| --- | --- |
| **fails closed** | odczyt w czasie wywołania bramkowanego portu lub rejestru, którego host *skipuje* wpis nieobecnego właściciela — wywołujący nic nie dostaje z powrotem, co jest tą samą odpowiedzią docierającą przy enumeracji zamiast przy porcie. Własny wpis `nonBindingDependencies` zależnego kind `refuses-without` dociera do tego samego wyniku i niesie zdanie dla operatora |
| **degrades** | własny wpis `nonBindingDependencies` zależnego kind `degrades-without`; jego `whenAbsent` to zdanie pokazywane operatorowi |
| **contributes** | push przy starcie do niebramkowanej tabeli, którą host filtruje, lub host, który celowo *honouruje* wpis nieobecnego właściciela |
| **schema-only** | krawędź `dependencies` bez odczytu kontenera pod spodem: deaktywacja nie zrzuca tabel, więc klucz obcy zostaje ważny |

### `refuses-without` — mówienie „fail-closed” bez wiązania operatora

Fail-closed to wynik, który platforma wnioskuje, gdy bramkowany port jest czytany
w czasie wywołania i nic o tym nie deklarowano. Do ruling ownera z 2026-08-25
był też *jedynym* wynikiem, którego zależny **nie mógł powiedzieć**: dwie
pisownie „czytam to i nie mam fallbacku” to `dependencies` i
`acknowledgedDependencies`, i obie wiążą lifecycle. Dla zależnego, który sam
deklaruje `activation.nonDeactivatable`, to zamienia kontrolkę aktywacji **właściciela**
w martwy przełącznik — operator go przełącza, odmowa przy flipie nazywa moduł,
który nigdy nie zniknie, i nic się nie dzieje. Kontrolka, która kłamie, jest
gorszą odpowiedzią niż którakolwiek alternatywa.

`nonBindingDependencies` ma więc trzeci kind. `refuses-without` mówi: operacja
odpowiada 503 `MODULE_DISABLED`, reszta deklarującego modułu działa dalej, a
kontrolka aktywacji właściciela nadal działa. Klasyfikuje `fails-closed` — to
sam zachowanie, które bramka już produkuje — a jego `whenAbsent` to to, co
dialog potwierdzenia operatora renderuje zamiast domyślnego tłumaczenia platformy:

```
orders — unavailable: checkout cannot take an order, because no payment
method is available
```

Trzy rzeczy trzymają to uczciwie, i żadna to słowo autora:

- **Nazwa musi być rejestracją `di.providePort`.** Niebramkowana rejestracja
  nadal się rozwiązuje lub rozwiązuje do niczego; w obu przypadkach nic nie
  odmawia. `check-port-dependencies.ts` raportuje `refusal-over-an-ungated-name` —
  lustro `contribution-over-a-gated-port`, i oba raz mówią jedno: pull z trybem
  awarii potrzebuje bramki, nieaktywny push nie może siedzieć za jedną.
- **Manifest deklarujący nie może wiązać właściciela.** `dependencies` i
  `acknowledgedDependencies` to dokładnie to, z czego `ModuleGatingGraph` buduje
  odmowę przy flipie, więc wpis twierdzący, że kontrolka właściciela nadal działa
  obok jednego z nich, to manifest mówiący obie rzeczy naraz. Reguła „jedna
  krawędź, jedno roszczenie, w jednym miejscu” `defineModuleManifest` odmawia
  pierwsza; check ponownie wyprowadza ten sam fakt dla manifestu zbudowanego bez
  helpera (`refusal-over-a-bound-owner`).
- **Musi nieść `whenAbsent`.** Bez niego wpis klasyfikuje dokładnie jak brak wpisu,
  więc zdanie to całość tego, co deklaracja kupuje (`refusal-without-a-sentence`).

Czwarta jest strukturalna, a nie checkowana: bramkowany port rozwiązany przy boot
lub przy wiązaniu to `gated-port-before-first-request`, które ledger przypisuje
**zanim** skonsultuje jakąkolwiek deklarację, więc żaden wpis tego nie ratuje.

Pisz zdanie dla operatora, który je przeczyta — *co* odmawia, w terminach
capability, nigdy „port rzuca”.

Krawędź bez żadnego jest raportowana po kształcie, a `check-port-dependencies.ts`
psuje build. Są trzy, każda to *fail-open*, a nie fail-closed: **schwytana**
rejestracja cross-module, czytana raz przy konstrukcji i odpowiadająca na zawsze;
odczyt **niebramkowanego rejestru, którego właściciel nie deklaruje polityki**;
oraz **bramkowany port rozwiązany przed pierwszym żądaniem**. Krawędzie do modułu,
którego platforma odmawia wyłączenia, nie niosą wpisu w ogóle — flip nie może
nastąpić, więc nie ma stanu do opisania.

`deactivationConsequencesFor` projektuje te same wpisy na wiersze widziane przez
operatora — i ta projekcja to połowa, która **nie** wyszła. Jedyny caller dziś to
`check-port-dependencies.ts`, w czasie buildu; dialog potwierdzenia i koperta 409
`MODULE_DEACTIVATION_UNCONFIRMED` są nadal w locie, a dzisiejszy dialog to goły
`window.confirm` nazywający moduł i nic więcej
(`admin/src/modules/platform/ModuleActivationControl.tsx`). Ustalone z wyprzedzeniem
jest, że jest **jedna** funkcja dla obu do wołania, więc gdy wylądują, zbiór id
w dialogu i zbiór id w `details.consequences` nie mogą się rozjechać: będą tym
samym wyrażeniem ocenionym dwa razy, a nie dwiema listami, które ktoś utrzymuje
w sync. Dwie niezależne kalkulacje „co przestanie działać” by się rozjechały, a
ta z CI byłaby kopią, której nikt nie czyta — dlatego klasyfikacja krawędzi to
nawet teraz nie księgowość CI. Pisz wpis dla operatora, który go przeczyta, nie
dla checka.

Dwie tabele niosą stały dług, obie dwukierunkowe jak każdy ledger tutaj.
`CONTRIBUTION_POLICY_STATED` nazywa rejestry, których host zdecydował, z decyzją
jako wartością, więc czytelnik nie musi otwierać klasy.
`REGISTRY_POLICIES_UNSTATED` nazywa te, które nie zdecydowały, każdy z tym, co by
go opróżniło — i wpis tam usprawiedliwia **jeden** kształt dla **jednej** nazwy,
bo capture nad tą samą nazwą to inna awaria z inną naprawą.

**Nie owijaj wywołania portu w goły `catch`.** `lazyPort` rozwiązuje wewnątrz
przekazywanego wywołania, więc `ModuleDisabledError` wychodzi w miejscu wywołania,
a `try { … } catch { return null }` cicho zamienia fail-closed w fail-open. Gdzie
degrade naprawdę należy, włóż go **w implementację właściciela** i wyraź w typie
zwrotnym portu — `allowedIdsFor(): Promise<string[] | null>` zwracające `null` dla
„brak restrykcji” to wzorzec.

**Ta reguła też jest egzekwowana**, przez `backend/scripts/check-port-catches.ts`.
Warto wiedzieć, co znalazł sweep, który ją uzbroił, bo trzy rodzaje,
które rozdziela, to trzy odpowiedzi na komentarz review o `catch`. Z 51 bloków
`try` sięgających bramkowanego portu, 27 już re-throwowało, a 24 nie, i te 24 to:

- **defensywne** — `catch` nad portem, którego typ zwrotny *już* mówi „nic nie
  stosuje”. `resolveLinePrice` odpowiada `null`; `taxRateFor` odpowiada
  `{ source: 'none' }` (wariant bez stawki — `rate: 0`, które czytało się jak
  odpowiedź, od tego czasu zniknęło); `applyToCart` odpowiada
  `discountTotal: 0`. `catch` nic nie kupił poza możliwością ukrycia 503, a jeden
  zapisał ukrytą odpowiedź w cache z TTL, więc powrót `price_lists` tego nie
  kończył. **Usuń go.**
- **degrade należący do właściciela** — patrz akapit wyżej.
- **wąska tolerancja, która jest poprawna** — per-item failure importu zapisany jako
  issue, kompensacyjny cleanup na ścieżce rollback, hit typeahead degradujący do
  zwykłego summary. Te zostawiają `catch` i dodają
  `rethrowIfModuleDisabled(error)` jako pierwszą linię. Powód: odpowiedź obecności
  dotyczy **całej operacji**, nigdy jednego elementu: `pim_ergonode` kiedyś
  raportował każdy atrybut, wariant, obraz i relację w źródle jako osobno zepsute
  i kończył run „sukcesem”, gdy jedynym prawdziwym zdaniem było, że `catalog` był
  wyłączony.

Zachowany `catch` mówi dlaczego w komentarzu, a „defensywne” nie jest dlaczego.

Dwa szczegóły, które check czyni explicite. **Warunkowy** re-throw
(`catch (e) { if (rare) throw e; }`) to naruszenie: `ModuleDisabledError`
rozszerza `HttpError`, więc test `statusCode === 409` przepuszcza go przez
przypadek, a nie decyzję. A **callback timera** w ogóle nie może re-throw —
sweep reconcile `ksef` pyta `effectiveState.isPresent` zanim startuje zamiast
tego, co uwolniło jego `catch`, by logować prawdziwe awarie sweep, które wcześniej
znikały obok odpowiedzi obecności.

Jedna rzecz celowo dozwolona: `catch` może przekazać błąd **delegatowi, który go
re-throwuje** — helper kończący na `throw <własny parametr>`
(`toCatalogHttpError(…): never`) lub wołający zawężenie w imieniu callera
(`ReturnEmailNotifier#contained`). Osiem miejsc w drzewie jest tak napisanych i
wszystkie osiem są poprawne.

### Co check może zobaczyć

Reguła dotyczy `catch`; ślepe punkty dotyczyły **jak port dociera**. Obie czytały
czysto przez miesiące:

- `catch` wokół **holdera**, a nie rozwiązania —
  `new CartPricingRecompute(em, lazyPort(ctx, 'pricingService'), cache)` docierany
  później jako `deps.cartPricingRecompute.recompute(…)`. Trzy siedziały na
  `GET /api/v1/cart` i renderowały pełny koszyk wyceniony ze starych snapshotów z
  wyłączonym `price_lists`;
- port, który **root wnosi** —
  `registerValues(container, { shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor() })`,
  rozwiązywany przez moduł jako zwykła nazwa cradle bez literału `lazyPort`
  gdziekolwiek na ścieżce. Pięć notifierów e-mail było niewidocznych z tego
  powodu, a licznik czytał `catches=42 violations=0` przed i po ich naprawie.

To jeden defekt, i zamykają go jednym mechanizmem: tabela aliasów to
**punkt stały nad wartościami niosącymi port**, a nie skan literałów `lazyPort`.
Wartość niesie bramkę, jeśli jest rozwiązaniem, jeśli jest z niego zbudowana,
jeśli jest przekazana fabryce, lub jeśli jest closure, którego body czyta jeden;
każda nazwa, do której taka wartość jest związana, staje się aliasem, i to
karmi następną rundę. Holder to jedna runda tej pętli, a klucz rejestracji roota
to druga. Poszerzenie przesunęło drzewo z `catches=42 violations=0` do
`catches=94 violations=24`.

Co **nie** niesie, jest równie load-bearing, i każde wykluczenie było opłacone
fałszywymi pozytywami: **wynik** wywołania (`proxy.applyToCart(…)` to bramkowane
wywołanie, zniżka, którą zwraca, to dane), **literał obiektu** (torba deps to
rekord — zbrudzenie go czyniło `this.deps.<anything>()` wywołaniem portu, 39 w
jednym runie), i **odczyt pola z portu**. Uruchom z `PORT_CATCH_WHY=1`, by zobaczyć
każdy alias z miejscem, które go wprowadziło.

**Alias jest widoczny tam, gdzie jego binding, i nigdzie indziej.**
`const` jest file-scoped, bo jest. **Klucz obiektu deps** jest module-scoped, bo
klasa odbierająca czyta go jako `this.deps.<key>` z innego pliku, a nazwa
właściwości nie jest leksykalnym bindingiem, który ktoś może shadowować.
**Parametr konstruktora lub funkcji** ma zakres pliku, który go *deklaruje* — kiedyś
miał zakres modułu, w którym siedział call site, co nie jest ani miejscem, gdzie
parametr jest w scope, ani — gdy callee żyje w innym module — miejscem, gdzie
można go w ogóle czytać. Rejestracja kontenera roota jest widoczna wszędzie, bo
nazwa kontenera jest globalna z konstrukcji.

Koszt błędu w tym był zmierzony i to nie szum. Budując `orderTransitionPort`,
autor nazwał parametr konstruktora `transitionService`;
niezwiązany lokal tej pisowni w `orders/prompt-tools.ts` stał się raportowanym
naruszeniem bez własnej zmiany kodu, a autor wyczyścił go przez rename parametru.
Rename ukrył `catch`, który jest prawdziwym fail-open — `OrderTransitionService.apply`
flushuje zmianę statusu, a potem uruchamia hook side-effects sięgający portu
release `credit_limits`, więc bulk change statusu raportował `failed` dla zamówień,
których status już się przesunął. **Fałszywy pozytyw, który autor może wyczyścić
tylko przez rename czegoś innego, nie dodaje tylko szumu; przesuwa kod.** Dwa
dokładnie tego kształtu stały w `pim_ergonode` i poszły z fixem: parametr
`walkStream(…, handle)` roszczący niezwiązaną właściwość cradle w `backend.ts`
oraz parametr `categoryPathOf(id, byId)` roszczący lokal `new Map(…)` w
schedule reconciler. Drugi niósł wpis ledgera.

Na scoping nałożone jest to, że **goły identyfikator rozwiązuje leksykalnie**: bliższy
binding, który *manifestnie* nie trzyma portu — literał, obiekt lub tablica
non-portów, `new`, którego argumenty to one — ukrywa szerszy alias. „Manifestnie”
to load-bearing słowo. Analiza carriage celowo under-approxymuje, więc
`carries` odpowiadające „nie” znaczy albo „nie port”, albo „nie da się tego
śledzić”, i tylko pierwsze może shadowować: `catalog` binduje
`const customFields = this.#requireCustomFields()`, które trzyma bramkowany port
`custom_fields` przez wywołanie, którego analiza nie śledzi, a odczyt tego jako
shadow zabrał sześć miejsc `catch` z populacji. Wywołanie, identyfikator, dostęp
do właściwości, closure, binding destructuring, import, zmienna `catch` i parametr
bez defaultu shadowują więc nic — kierunek wątpliwości to „raportuj”.

**Stara reguła miała argument bezpieczeństwa i przeżywa tam, gdzie faktycznie
została zrobiona.** Została zrobiona o tabeli `gatesOf` — merge *bramek* po nazwie,
co może tylko dodawać właścicieli i więc tylko utrudniać `OWNER LOCKED`. Ta
tabela jest nietknięta, a `gatesIn` celowo shadow-blind z tego samego powodu.
Argument nigdy nie był o **widoczności aliasów** i nie przenosi się na nią: szerszy
alias nie dodaje właścicieli do miejsca, wymyśla miejsce.

`PORT_CATCHES_TO_DRAIN` trzyma miejsca, gdzie pochłonięcie odpowiedzi jest nadal
najmniej złym zachowaniem, każde z powodem, w trzech kształtach, które wpisy
nazywają:

- **after the fact** — strzeżone wywołanie działa, gdy operacja, do której należy,
  już się commitowała (merge koszyka przy zakończonym logowaniu, bookkeeping
  dostarczenia webhooka). Re-throw raportowałby failure dla pracy, która się
  udała, i przy retry zrobiłby ją ponownie. Wpis webhook jest **permanentny** i
  mówi to: to self-edge, jedyna osiągalna odpowiedź obecności to flip *między*
  próbą HTTP a rekordem, a obie alternatywy — duplicate delivery albo sonda przed
  flip — są gorsze;
- **degrade, na który właściciel powinien odpowiadać** — caller słusznie serwuje
  bez modułu, więc `rethrowIfModuleDisabled` byłby *złą*
  naprawą. Odpowiedź należy do typu zwrotnego wkładu lub wpisu
  `nonBindingDependencies`, i wszystkie trzy wpisy tego kształtu przeniosły się
  tam: powiadomienie dzwonka odpowiada `'recorded' | 'not-present'` z recordera
  decydującego obecność przed bramką, dostępność katalogu to zadeklarowana krawędź
  `degrades-without` sondowana we wkładzie, który ją rozwiązuje, a
  listing Meilisearch fallbackuje do Postgres, bo `useMeili` pyta przed query,
  a nie łapie potem;
- **boot hook** — odpowiedzi obecności nie ma callera, który by dotarł, więc jest
  *decydowana* na górze hooka, pierwsza i poza każdym `try`. Poza, bo
  `runBootHooks` **nie** łapie — re-throwuje, więc `ModuleDisabledError` w środku
  albo abortuje boot, albo dzieli jeden cichy no-op z transient failure (patrz
  *Faza boot re-throwuje* poniżej; ten punkt mówił kiedyś odwrotnie).
  `product_feeds` i `pim_ergonode` reconcilują harmonogramy tak; co zostaje
  ledgerowane, to `catch` pod sondą, który pochłania zwykły failure, żeby
  niebootowalne API nigdy nie kosztowało więcej niż drifted schedule — zawężenie
  tych dwóch do re-throw próbowano i cofnięto, bo zmieniło to, z czym harness
  bootuje. Hook, który **contributuje** — deskryptor wrzucony do rejestru hosta
  filtrującego po obecności właściciela — nie dostaje sondy, bo sonda oznaczałaby,
  że moduł włączony w runtime nic nie wniósł aż do następnego restartu.

Czwarta odpowiedź jest **wyprowadzana, a nie pisana**: gdy każda bramka, którą
alias miejsca niesie, należy do modułu deklarującego `activation.nonDeactivatable`,
check raportuje `OWNER LOCKED`, a wpis ledgera nad tym czyta stale. `catch`
nadal jest i nadal jest nazwany — nadal połyka każdy inny błąd — ale nie ma
odpowiedzi obecności do dotarcia, więc nie ma czego drainować. Wyliczanie z
manifestów przy każdym runie to sens: właściciel, który odblokowuje moduł,
ponownie czerwieni każde miejsce spoczywające na tym locku w tym samym runie, bez
edycji ledgera, gdzie ręcznie napisane „locked” w stringu powodu poszłoby stale w
ciszy.

## Zakres requestu

Stan per-request żyje w scope kernela (`scope.ts`), docierany przez
`ctx.cradle<C>()` wewnątrz requestu. Jest **deklarowany, nie ambient**: usługa
dostaje to, czego potrzebuje, zamiast pytać runtime.

To celowe odwrócenie. Drzewo kiedyś eksponowało `getEm()` nad MikroORM
`RequestContext`, lookup oparty na AsyncLocalStorage: usługa docierała do
EntityManager requestu pytając runtime, więc to, czego mogła dotknąć, było
niewidoczne w sygnaturze i nietestowalne bez live request scope. Każdy moduł
bierze teraz explicite `emFactory`, a `getEm()` usunięto, żeby właściwość
trzymała się z konstrukcji.

`enterSystemScope(reason, fn, { entryPoint })` to szew dla pracy bez requestu
za nią — reconciles przy starcie, entry pointy CLI, workery. Istnieje, żeby
zapytania tenant-scoped miały jawny, audytowalny escape hatch zamiast
implicit.

## `ctx.log` — dokąd idzie linia logu modułu

`ctx.log` to własny logger platformy, związany z modułem. Każda linia, którą
pisze, niesie `module: '<your module id>'`, i niesie `reqId`, gdy pisana jest
podczas requestu, a autor nie nazywa żadnego z nich.

Kiedyś nie było ani jednego. Destynacja wybierana jest przez root kompozycji,
kompozycja działa przed `buildServer`, więc każdy root przekazywał to, co mógł
nazwać tak wcześnie: `composition.ts` przekazywał globalny `console`, a harness
testowy no-op. Ostrzeżenie modułu było więc niestrukturyzowane, nieskorelowane
z requestem, który je spowodował, poza strumieniem pino, który deployment wysyła
— i oba rooty nie zgadzały się, które z tych dwóch „nic” to jest, co jest
dokładnie klasą driftu, dla której istnieje `harness-parity.test.ts`.

Oba rooty przekazują teraz `platformLogger()`, który jest **late-bound**: czyta
destynację per linia zamiast ją capture'ować. `buildServer` podpina własną
instancję pino aplikacji w momencie, gdy istnieje, i odpina przy `onClose`.
To jedno miejsce attach dla wszystkich czterech entry pointów — `index.ts`,
`worker.ts` (buduje serwer, którego nigdy nie listenuje, dokładnie po to, by
pluginy modułów się zarejestrowały), harness testowy i runtime overlay — więc
żaden root nie może tego zapomnieć i oba nie mogą znów się rozjechać.

Request id czytany jest ze `requestMeta` scope platformy, nie z `request.log`.
Fastify `request.log` to `app.log.child({ reqId })` i nic więcej, więc linia z
`reqId` łączy się z własnymi liniami `req`/`res` Fastify identycznie; czytanie id
ze scope kupuje korelację na dowolnej głębokości bez przekazywania `request` —
i — load-bearing połowa — **nic nie retencjonuje**, gdzie capture requestu w
scope przypiąłby go tak długo, jak żyje jakikolwiek async resource stworzony
wewnątrz tego scope (patrz notatki retencji w `scope.ts`).

**Poza requestem nie ma request id, a linia nadal jest pisana.** Boot hook działa
przed `buildServer` w obu rootach, więc dociera do console fallback — gdzie linia
boot zawsze szła i gdzie czyta się boot failure. Worker, timer lub subscriber
EventBus działa po zbudowaniu aplikacji, więc dociera do pino aplikacji. Proces,
który komponuje moduły i nie buduje serwera, też dociera do fallback. Fallback to
prawdziwy write i nigdy no-op: zamiana niestrukturyzowanej linii w dropped byłaby
gorszą platformą niż ta, którą to zastąpiło.

`ctx.log` jest więc bezpieczny do trzymania. Cztery moduły oddają go usłudze
trzymającej go przez życie procesu (`invoices`, `payments`, `pwa`, `shipments`),
a destynacja i korelacja requestu czytane są per linia.

## Kolejność kompozycji — przeczytaj to, zanim napiszesz boot hook

Kompozycja działa w **jednym przebiegu** po wygenerowanej liście modułów, a każdy
boot hook działa raz, po każdej rejestracji i każdym wkładzie roota:

```
load module presence                 (PostgreSQL, awaited, fatal)
composeModules(MODULES)              (one call; registration resolves nothing)
…all root contributions…             (composedModules.contribute, bridges, eager reads)
runBootHooks()                       (once, after every contribution)
the Fastify app is built             (plugin bodies run)
registryCache.watch()                (Redis, non-fatal)
```

Kiedyś działały dwa przebiegi, podzielone listą `EARLY_PASS_MODULE_IDS`, żeby
ręcznie okablowany kod modułu roota mógł siedzieć *między* nimi. Nie ma już
ręcznego kodu modułu w żadnym rootcie, a to, co split nadal kupował, zmierzono:
13 z 26 członków nie było wymuszonych przez nic, a powód kolejności tras w
nagłówku był fałszywy (hook `onRequest` roota dodany przez plugin `fastify-plugin`
zarejestrowany *po* encapsulated child nadal działa dla tras tego childa). Jeden
przebieg spełnia każde ograniczenie kolejności dla wszystkich modułów naraz, czego
żaden podział zbioru modułów nie może, więc `composition-passes.ts` usunięto.

Cztery konsekwencje, w kolejności, w której gryzą:

**0. Obecność modułu ładowana jest przed pierwszą rejestracją modułu.**
`loadModulePresence()` działa jako krok kompozycji w `composeApp()`, bo każda
bramka downstream — rozwiązanie portu w boot hooku, decyzja pause
`defineModuleWorker`, handler `subscribeForModule` — pyta ten sam cache
in-memory, i większość pyta, zanim istnieje jakakolwiek trasa HTTP. Load żył
kiedyś w body pluginu `_lifecycle`, tj. wewnątrz `buildServer`, po
wszystkim na diagramie powyżej: cache odpowiadał „not installed” dla każdego
modułu i backend nie startował.

Dwie połowy, celowo różne co do rodzaju. **Load** czyta PostgreSQL, jest awaited
i fatal — `initOrm()` już czyni osiągalną bazę warunkiem wstępnym bootu, więc
to nie dodaje trybu awarii. **Watch** subskrybuje kanał powiadomień Redis, jest
uzbrojony po kompozycji i nigdy nie może zepsuć bootu: utrata oznacza *stale*, a
PostgreSQL — authority — nadal jest.

Odczyt obecności przed load rzuca `ModulePresenceNotLoadedError`. To ani jedna z
dwóch odpowiedzi: `false` to to, co zbiło platformę, a `true` uruchomiłoby pracę
wyłączonego modułu.

**1. Boot hook może rozwiązać cokolwiek.** Każdy moduł zarejestrował się, zanim
pierwszy hook działa, więc `ctx.onBoot` dociera do każdej rejestracji i każdego
wkładu roota. Kolejność rejestracji jest bez znaczenia z konstrukcji: `composeModules`
ustawia `registering = true` na cały call (`kernel/compose.ts`), a
`ctx.cradle()` odmawia rozwiązania, gdy jest ustawione, więc moduł nie obserwuje,
które moduły zarejestrowały się przed nim. Jeśli `registerModule` potrzebuje
wartości w czasie rejestracji, nie potrzebuje — weź ją leniwie (`lazyPort`, getter
lub cradle w miejscu użycia).

**2. Boot hooki działają przed każdym body pluginu.** Body pluginów działają, gdy
budowany jest Fastify app, po `runBootHooks()`. Wkład push-at-boot zawsze ląduje
przed reconcile hosta w body pluginu — z konstrukcji, nie szczęściem.

**3. Wkład roota ma dokładnie jeden legalny slot**: po
`composeModules(MODULES, …)` i przed `runBootHooks()`. Wcześniej własny default
modułu go nadpisuje — `registerValues` to goły
`container.register`, bez ledgera własności, więc wygrywa ostatni pisarz; później
boot hook mógł już przeczytać ten default. Okno ma znaczenie tylko dla wartości
czytanych *przy konstrukcji*; cokolwiek czytane per request lub per call jest
niewrażliwe — ale nie polegaj na tym bez powiedzenia. **Wartość hosta**, której
żaden moduł nie defaultuje (`redis`, `eventBus`, `commandBus`, `auditLogService`,
flagi `*RunWorkers`) nie ma takiego okna i rejestrowana jest tam, gdzie wartość
powstaje.

Ten slot to **metoda**, nie konwencja: `composeModules`
zwraca `ComposedModules`, a wkład to
`composedModules.contribute({ name: value })`. Obie krawędzie okna idą ze
kształtem, a nie z pamięci czytelnika — wczesna, bo nie ma obiektu do wołania,
dopóki każdy moduł się nie zarejestrował, późna, bo `runBootHooks()` je zamyka,
a późniejsze wołanie rzuca `ContributionWindowClosedError` cytując tę regułę.
Zamknięte przez *start* fazy boot, nie jej koniec: hooki działają w kolejności
rejestracji, więc wkład z wnętrza jednego jest już niewidoczny dla każdego hooka,
który działał przed nim. Pisanie `registerValues(container, …)` po
`composeModules` cicho otworzyłoby okno, więc `test/contract/kernel/harness-parity.test.ts`
odmawia tego w obu rootach — nad call pozostaje poprawne, i tam należy wartość
hosta.

**4. Boot hooki działają niezależnie od effective state.** `runBootHooks()` nie
konsultuje obecności modułu, więc hook wyłączonego modułu nadal działa. Dwie
konsekwencje, a druga kiedyś była tu zbyt wąsko podana.

Nigdy nie rozwiązuj **bramkowanego portu** z boot hooka: bramka ma prawdziwą
odpowiedź „nie” w tym momencie, a odpowiedzenie nią zabija boot. Jeśli nazwa to
rejestr wkładu, nie powinna była być portem — patrz reguła rejestrów wkładu
wyżej.

Jeśli hook wrzuca deskryptor do rejestru innego modułu, **host**
decyduje, czy wpis jest live, przy enumeracji, po id modułu-współtwórcy, które
zapisuje. „Host musi filtrować” to jedna z dwóch słusznych odpowiedzi, nie reguła:
*skip* pasuje do wkładów powierzchniowych — jak `ctx.interceptors` stempluje
`module: id` i dispatch pomija wpisy, których właściciel nie jest włączony — a
*honour* pasuje do integralnościowych, gdzie skip pozwoliłby cicho osierocić dane
nieobecnego modułu. Stanow, które, per rejestr, z powodem.

### Faza boot re-throwuje

`runBootHooks` owija każdy hook, przypisuje failure modułowi, który go
zarejestrował, i **re-throwuje**:

<!-- verbatim-from: packages/platform/src/kernel/compose.ts -->

```ts
try {
  await hook();
} catch (err) {
  if (alreadyNamesTheModule(err)) throw err;
  throw new ModuleCompositionError(moduleId, 'boot', err);
}
```

Dokumentacja mówiła odwrotnie przez miesiące — ta strona w dwóch miejscach i
ledger `check-port-catches.ts` — a twierdzenie było load-bearing:
dwa miejsca boot-hook były ledgerowane zamiast naprawione w przekonaniu, że kernel
centralnie połyka throw. Blok powyżej cytowany jest, a nie opisany, z tego powodu;
`check:doc-snippets` psuje tę stronę, jeśli przestaje pasować do źródła.

Re-throw to ustalone zachowanie. Boot hook działa podczas
kompozycji, zanim istnieje Fastify app: nie ma requestu do odpowiedzi i
degradowanej powierzchni do serwowania, więc połknięty failure oznaczałby start
platformy z kompozycją inną niż mówi kod — brakujący adapter płatności,
nieskaner referencji assetów, domyślny e-mail, którego nikt nie pushował — i
milczenie. `index.ts` zamienia throw w `process.exit(1)`, a
`test/integration/kernel/boot-failure.test.ts` przypina obie połowy: błąd nazywa
moduł i fazę, i żaden częściowo skomponowany serwer nigdy nie listenuje.

Zagrożenie argumentujące za łapaniem — moduł wyłączony przez operatora biorący
boot ze sobą — zamknięte jest strukturalnie, a nie przez `catch`. Bramkowany port
rozwiązany z boot hooka odmawia
`check:port-dependencies` (`gated-port-at-boot`), a każdy rejestr wkładu zostaje
niebramkowanym `ctx.di.register` z tego samego powodu, więc flip
przełącznika przez operatora nie podnosi `ModuleDisabledError` podczas kompozycji.
Co zostaje, to hook, którego własna praca pada — prawdziwy failure; moduł chcący
węższej tolerancji pisze ją **wewnątrz** własnego hooka i mówi dlaczego, jak
helper `reconcile` `product_feeds`. Ten helper nie jest redundantny względem
decyzji kernela — to jedyne stojące między drifted schedule a martwym bootem.

### Kompozycja bez wymaganego modułu nie dociera do fazy boot

`activation.nonDeactivatable` strzeże **wycofania**: orchestrator lifecycle
odmawia disable lub uninstall modułu, który to deklaruje, soft i hard, bez
`--force`. Późniejsza reguła dodała dwa **stany początkowe**, które analiza
manifestu może
zobaczyć — moduł, którego ten deployment nigdy nie wysłał, a który nazywa inny
manifest, oraz taki z wierszem `module_registrations`, którego boot reconciler nie
naprawi — i odmawia obu z `loadModulePresence`, zanim czytany jest rejestr.

Żaden nie widział stanu, który faktycznie psuje first boot. `invoices`
grandfatheruje wzorzec numeracji z hooka `ctx.onBoot`, którego zapis idzie przez
port `settings`, a `NumberingConfigurationService` celowo re-throwuje
`ModuleDisabledError` — zapis to cały sens hooka. Platforma bez `settings` więc
nie degradowała, tylko wychodziła, mówiąc:

```
[kernel] module 'invoices' failed in its boot hook: Module 'settings' is currently disabled.
```

Zły moduł i brak remedium. Nigdy nie widziano, bo na każdej bazie, gdzie platforma
bootowała raz, grandfather write już się stał i hook nie ma czego robić; tylko
genuinely first boot dociera do portu.

Owner ruled, że `settings` jest zbyt ważne, by było absent z deploymentu, więc
odpowiedzią jest uczynienie absence nieosiągalnym, a nie tolerancja `invoices`.
`composeModules` odmawia **zanim pierwszy moduł się zarejestruje**, gdy
kompozycja wymaga modułu, którego brakuje:

- wymagany zbiór to `requiredModulesFrom(manifests)`, wyprowadzany przez każdy
  root z manifestów, które komponuje, i przekazywany composerowi jako dane —
  composer dostaje trzy pola per moduł i nie może czytać manifestu. Nie ma listy
  nigdzie, więc wycofanie locka zmienia tę odmowę w tym samym runie;
- **„wymagany do zainstalowania” i „nie można wyłączyć” to ten sam zbiór, przez
  wyprowadzenie i decyzję.** Manifest nie potrzebuje drugiego pola: autor, który
  napisał *„platforma nie może działać bez tego”*, odpowiedział obiema pytaniami
  jednym zdaniem, i to zdanie drukuje odmowa;
- dwa findingi, bo mają różne remedia. `absent` znaczy skomponowany, a presence
  mówi inaczej → `module:enable <id>`. `not-composed` znaczy manifesty deklarują,
  a nic nie zarejestrowało → skomponowana lista modułów i indeks manifestu się
  nie zgadzają, więc `composer:generate` i rebuild. Tylko composer widzi drugie:
  `loadModulePresence` działa przed pierwszą rejestracją modułu, więc indeks
  manifestu i skomponowana lista, które się nie zgadzają, oba wyglądają poprawnie
  dla niego.

Trzy odmowy spoczywają teraz na jednej deklaracji manifestu, a reguła zamykająca
trzyma je trzema — *„dzielą deklarację i nie dzielą nic więcej: ani call
site, ani typ błędu, ani komunikat”*. `assertDeactivatable` odmawia **transition,
o który prosił operator**, i odpowiada kopertą HTTP; `assertLockedModulesPresent`
odmawia **deployment złożony źle**, z manifestów, zanim dotknięta jest baza;
`assertRequiredModulesPresent` odmawia **kompozycji, która dotarłaby do fazy boot
bez wymaganego modułu**, z tego, co faktycznie zarejestrowano i co mówi presence.

Jedna absence, której nie widzi, jest taka: moduł w ogóle
niewysłany zabiera manifest ze sobą, więc *„czy był locked?”* nie ma odpowiedzi
na tym szwie. Ten przypadek zostaje z `assertLockedModulesPresent`, które pyta
z deklaracji modułów, które zostały.

`test/integration/kernel/required-module-absent.test.ts` komponuje produkcyjny
root z wycofanym `settings` na osi platformy i przypina zdanie, które czyta
źle złożony deployment; `test/integration/kernel/deactivated-boot.test.ts` to
jego lustro i nie wycofuje już locked modułu, bo ten stan jest teraz odmawiany
z designu.

### Jedna rzecz, którą root nadal musi zrobić w kolejności

`EventBus.dispatch` awaituje handlery w **kolejności rejestracji**, więc
`composeSalesChannelsKernel` — który podpina invalidator cache kanału sprzedaży —
jest komponowany **przed** `composeModules(MODULES, …)` w obu rootach. Moduł
subskrybujący `sales_channels.identity_changed` przed nim uruchamia handler na
wartości sprzed zapisu.

**Cache settings był drugą połową tego zdania i już nią nie jest.**
Warto przeczytać dlaczego, bo ta sama naprawa jest dostępna dla pozostałego.
Kompozycja invalidatora pierwsza była działającym układem spoczywającym na dwóch
wypadkach. Po pierwsze, drop docierał do `SharedDropMarks.begin` synchronicznie,
więc był na czas tylko, gdy był handlerem *zero* — a wszystkie 65 modułów
rejestruje się w jednym przebiegu, którego kolejność jest bez znaczenia z designu,
więc nic nie zachowywało tej pozycji i nic by nie raportowało jej ruchu. Era
dwuprzebiegowa już zapisała symptom, pierwszy raz, gdy `meta_ads` i `linkedin_ads`
poszły przed nim. Po drugie, gorzej, `emit()` **wewnątrz** scope `EventBus.run`
jest buforowany, aż funkcja scope wróci — a `CommandBus.run` otwiera dokładnie
jeden per Command — więc żadna kolejność rejestracji nie uratowałaby zapisu i
read-back w jednym command.

Naprawą nie była trzecia korekta kolejności. `SettingsAdminService` —
jedyne miejsce, gdzie zmienia się wartość setting lub grupa — woła teraz
`SettingsCacheInvalidation` i **awaituje go**, po flush i przed emit. Drop jest
częścią zapisu, więc nic na busie nie może być wcześnie ani późno dla niego;
`attachSettingsCacheInvalidator` usunięto, a powód, dla którego pięć modułów
cytowało go w komentarzach („mój handler re-czyta setting, a invalidator jest
prede mną”), jest teraz prawdziwy z konstrukcji. Odrzucone alternatywy warto
nazwać: przypięcie kolejności checkiem czyni zależność explicite, ale ją zostawia;
tier priorytetu EventBus czyni kolejność koncepcją platformy, którą każdy
przyszły listener musi rościć — i żadna nie adresuje przypadku buffered scope.

Cache kanału sprzedaży nadal subskrybuje, więc reguła kolejności powyżej nadal
wiąże ten root. Opróżnienie go tą samą drogą to osobna zmiana.

Każda subskrypcja modułu w drzewie przechodzi przez `ctx.subscribe`, i to jest
teraz egzekwowane, a nie proszone. Moduł mógł kiedyś subskrybować gołym
`eventBus.on` z body pluginu: kolejność invalidatora nadal chroniła taki handler,
ale effective state modułu nie, bo tylko `subscribeForModule` go konsultuje.
Trasy i workery miały check szwu, subskrypcje nie, więc dwadzieścia dwa
nagromadziły się w dziewięciu modułach, podczas gdy taski konwersji każdego
modułu czytały done — a subscriber **pisze**, co czyni go gorszą połową luki:
faktura wystawiona, numerowana i e-mailowana, quote request flipped na Completed,
push do urządzenia klienta, lista zakupów utworzona — wszystko dla modułu, który
operator uważał za off.

`pnpm --filter backend run check:subscribe-seam` to grzyb. Czyta własne źródła
modułu pod kątem wywołania na receiverze w kształcie event bus, i niesie
`BARE_SUBSCRIPTIONS_TO_DRAIN`, **pusty** dwukierunkowy ledger: niezledgerowana
goła subskrypcja psuje build, i wpis ledgera, który już nie opisuje jednej, też
psuje. Kernel celowo poza zakresem — komponuje przed jakimkolwiek modułem i nie
ma effective state do bramkowania, więc invalidator cache kanału sprzedaży
subskrybuje bezpośrednio, co jest faktem kolejności, od którego zależy akapit
powyżej.

### Entry point bez callera decyduje obecność

Szew trasy bramkuje requesty; **body** pluginu to nie request. Działa przy boot
niezależnie od effective state modułu, więc timer startowany tam nadal strzela
po wyłączeniu modułu przez operatora — `price_lists` nadal flipował
`scheduled → active` i `active → expired` co pięć minut, co zmieniało to, co
klienci płacą. Callback timera też nie ma dokąd throw *to*, więc
`ModuleDisabledError` nie propaguje się stamtąd: podniesiony tam albo jest
połknięty przez `catch` na transient failures, albo zabija tick.

Callback **decyduje** więc — `if (!effectiveState.isPresent('<id>'))
return;`, pierwsze i poza każdym `try`, żeby wyłączony moduł i failed tick
nigdy nie dzielili jednego cichego no-op. Gdzie timer *jest* pętlą, jak w
self-rescheduling reindex tick `search`, gałąź off re-armuje i pomija pracę;
return bez re-arm zatrzymałby scheduler na życie procesu.

`pnpm --filter backend run check:entry-presence` to grzyb — było
`check:timer-presence`, dopóki populacja przestała być timerami — a to, co
widzi, jest węższe niż reguła: `setInterval`, `setTimeout`, którego callback
re-armuje timer lub woła z powrotem funkcję, która go uzbroiła, handler lifecycle
`process.on` i hook `ctx.onBoot` — we własnych źródłach modułu. Jednorazowy
deadline wewnątrz operacji, która już ma callera, jest poza zakresem.
Pierwsze dwa kształty żyją w `backend/scripts/lib/repeating-timers.ts` i są
czytane też przez `check-entry-scope.ts`. Ten check klasyfikował
entry pointy interval grepując `setInterval(`, więc reindex loop `search` był
poza populacją, którą liczył, a luka tam zostawała niewidoczna za liczbą,
która się nie ruszała. Dwa detektory jednego kształtu to sposób, w jaki driftują;
reguły zostają osobno — jeden pyta, czy callback decyduje obecność, drugi czy
miejsce otwiera scope — ale recognizer jest jeden.

#### Scope odpowiadany jest per site, bo odpowiedź na poziomie pliku to dysjunkcja

`check-entry-scope.ts` klasyfikował kiedyś **pliki**, a plik raportował
`scoped`, gdy *jeden* z jego entry pointów był poprawny. To nie teoretyczna
słabość: `kernel/lifecycle/registry-cache.ts` odświeżał
`module_registrations` i `settings` z handlera Redis pub/sub bez scope w ogóle,
a check nazywał plik scoped z poprawnie owiniętego `setInterval` 130 linii
niżej. Sześć plików w tym drzewie ma więcej niż jeden entry point, co jest
dokładnie miejscem, gdzie dysjunkcja może ukryć jeden.

Populacja to więc **sites**. Sześć klas: skrypt CLI i zadeklarowany program
zostają file-level — entry to własne top-level execution pliku — a każdy
`new Worker(...)`, każdy repeating timer, każde `x.on('message', …)` i każde
`process.on/once(...)` to osobny site. Dwie z tych klas są nowe, a jedna zamyka
lukę, której żadna klasa file-level nie mogła: `kernel/container.ts`
instaluje process-wide disposal `SIGINT`/`SIGTERM`, i nie jest pod żadnym
katalogiem `scripts/`, nie jest zadeklarowanym programem, nie konstruuje `Worker`
i nie startuje timera — check klasyfikujący pliki nie miał gdzie go włożyć, więc
handler nie był exempt, był absent. Dwa file-level sites pytane są nad plikiem
**minus** callbacki sites wewnątrz niego, więc program nie czyta się jako scoped
z `enterSystemScope`, który otwiera jego Worker.

Site jest scoped, gdy `enterSystemScope` / `enterPlatformScope` wołane jest w
własnym callbacku, lub **jeden hop** do funkcji bound w tym samym pliku — głębokość,
do której `check-port-catches` śledzi `this.<method>()`. Binding identifier
callback nie jest tym hopem: w `new Worker(QUEUE, processor, …)` `processor` *jest*
callbackiem. Dwa hopy, imported delegate i delegate `this.<method>()` są poza tym,
co analiza widzi, i wszystkie trzy czytają się jako **unscoped**, co jest
kierunkiem, w którym blind spot musi failować.

`NO_SCOPE_NEEDED` kluczowany jest jak ledgery `check-entry-presence` —
`<file>:<enclosing name>:<construct>`, line-independent, two-way — i jeden klucz
może pokryć dwa sites dzielące wszystkie trzy (`index.ts` rejestruje `SIGINT` i
`SIGTERM` w jednej funkcji). Nie oczekuje się, że będzie pusty: wpis mówi, dlaczego
site jest *słusznie* unscoped, z tym, co by to obaliło. Trzy handlery cache-and-connection
w nim to worked example — handler pub/sub, który tylko dropuje cached `Map`, nie
potrzebuje scope, bo refill dzieje się na stacku następnego callera, i wpis mówi
to jako falsifier: **w dniu, gdy reload zamiast drop, defekt wraca**.

`TIMERS_WITHOUT_PRESENCE` i `BOOT_HOOKS_WITHOUT_PRESENCE` są dwukierunkowe jak
ledgery powyżej, ale w przeciwieństwie do nich nie oczekuje się, że będą puste:
wpis mówi, dlaczego site słusznie działa, gdy moduł jest off — heartbeat lease
lifecycle lock należy do command trzymającego lock, a `_lifecycle` jest
non-deactivatable.

#### Boot hook jest w tej populacji, a jeden jego kształt nie naprawia się sondą

Nic w kernelu nie decyduje obecności dla boot hooka (patrz *Faza boot re-throwuje*
wyżej), więc hook, który **robi pracę**, niesie ten sam obowiązek co callback
timera: `if (!effectiveState.isPresent('<own id>')) return;`, pierwsze i poza
każdym `try`. `product_feeds` pisał klucze schedulera BullMQ do Redis przy każdym
deploy z modułem off; `pim_ergonode` robił to samo dla harmonogramu importu,
`inventory` tworzył wiersze przypisań magazyn/kanał, `blog` seedował kategorię i
dwie role, `cms` reconcilował seedowane Hooks.

Hook, który tylko **contributuje** — wrzuca nieaktywny deskryptor do rejestru
innego modułu — **nie** może sondować. Host filtruje je po współtwórcy przy
enumeracji, więc nieobecny współtwórca już nic nie kosztuje, a sonda oznaczałaby,
że moduł, który operator włącza z powrotem w runtime, nic nie wnosi aż do
następnego restartu.

Hook robiący **obie** rzeczy jest splitowany, zanim zastosuje się którakolwiek
odpowiedź, a check raportuje to jako własny kind (`mixed-boot-hook`) z „split it
first” jako remedium. To nie stylistyka. `blog` i `cms` każdy rejestrował scanner
asset-reference obok własnej pracy, a `assets_library` konsultuje ten rejestr
przed każdym soft-delete — polityka enumeracji rejestru to *honoured*, gdy
współtwórca absent, bo wiersze wyłączonego modułu nadal osadzają assety. Sondowanie
połączonego hooka przy deploy z `blog` off daje brak blog scanner: Library usuwa
wtedy asset referencjonowany przez post bloga, a operator spotyka szkodę jako
zepsuty obraz po włączeniu modułu. Dwa z pięciu working hooks w drzewie były
mixed, dlatego check, którego jedyna rada to „add probe at top”, uczyłby złej
naprawy w 40% tego, co znajduje.
`backend/test/integration/blog/asset-reference-while-off.test.ts` i bliźniak `cms`
przypinają konsekwencję: komponują moduł **gdy jest off** i asertują, że
referencjonowany asset nadal nie może być usunięty.

Moduł deklarujący `activation.nonDeactivatable` jest poza populacją boot-hook —
nie ma stanu, w którym jego hooki działają, gdy jest absent. To wyprowadzenie
żyje w `backend/scripts/lib/switchable-modules.ts` i jest współdzielone z
`OWNER LOCKED` `check-port-catches`, więc właściciel wycofujący lock
ponownie czerwieni oba checki w tym samym runie, bez edycji ledgera.

### Cache nad obecnością porównuje generację, nie powiadomienie

`b2b:module:state-changed` ogłasza zmianę, której efekt na `registryCache` jest
jeszcze round-trip PostgreSQL stąd: `refreshFromDb` instaluje nowe mapy i jest
`async`. Konsument memoizujący cokolwiek wyprowadzone z obecności i dropujący
memo **w subscriberze** rebuilduje więc z obecności *przed* zmianą i trzyma
wynik aż do następnej wiadomości — która może nigdy nie nadejść. `admin_actions`
robiło dokładnie to: request palety lądujący w oknie cache'ował
akcje wyłączonego modułu na stałe, a defekt był niezależny od tego, który z dwóch
handlerów `on('message')` zarejestrowano pierwszy, bo okno otwiera asynchroniczność
refresh, a nie kolejność listenerów. To ta sama rodzina co invalidacje cache
powyżej — invalidation, której poprawność jest funkcją kolejności dispatch.

Odpowiedzią kernela jest **pull**, `effectiveState.presenceVersion()`: licznik,
który cache rejestru przesuwa, gdy completed load instaluje obecność różniącą się
od poprzedniej. Konsument zapisuje numer, pod którym snapshot był zbudowany, i
porównuje przy każdym odczycie:

```ts
const version = this.presence.version();
if (version !== this.cachedPresenceVersion) {
  this.cachedPresenceVersion = version;
  this.invalidate();
}
```

Nic się nie rejestruje, więc nie ma kolejności do zepsucia, a usługa zbudowana po
refresh nadal czyta właściwy numer. Przesuwa się na **content**, nie na refresh
count: każdy proces refreshuje przy każdej zmianie stanu, a degraded timer co
pięć sekund, więc counter per refresh dropowałby memo za każdym razem i czynił
bezwartościowym podczas outage Redis. Trzymaj subscriber, jeśli nadal zasługuje —
pokrywa inputy, których obecność nie rusza, jak install przepisujący wiersze
`module_actions` lub bundle tłumaczeń — ale nie może być tym, na czym spoczywa
poprawność odpowiedzi.

### Pisanie rationale kolejności, które nie gnije

Zlanie dwóch przebiegów unieważniło nic w kodzie i piętnaście komentarzy w nim
— plus dwa rationale już raz skorygowane. To nie problem porządku: trzy razy w
tej pracy implementer czytał jedno z nich, wierzył i spędzał sesję na defekcie,
którego nie było. Wychodzą dwie reguły, i dotyczą każdego wyjaśnienia *kiedy*
coś się dzieje.

**Nazwij mechanizm, nie współrzędne.** Rationale „accessor nie jest przypisany
aż `composition.ts:3240`, a hooki działają o `:2122`” psuje się, gdy którykolwiek
numer się ruszy, i nic tego nie mówi: żaden test nie obejmuje komentarza, a
czytelnik nie ma powodu wątpić w liczbę. To samo rationale jako „orchestrator
budowany jest po skomponowaniu modułów, więc accessor odpowiada `undefined` podczas
rejestracji” przeżywa każdą edycję, która nie zmienia mechanizmu — a jeśli
mechanizm się zmieni, zdanie wyraźnie dotyczy rzeczy, która się zmieniła. Gdzie
referencja naprawdę pomaga, niech będzie **symbolem** lub **plikiem plus symbolem**
(guard `registering` `compose.ts`, `installGatingGraph` `presence-load.ts`), nigdy
numerem linii.

**Nie pisz counterfactual w czasie przeszłym.** „Reconcile tutaj znalazłby pusty
rejestr i raportował success” czyta się jak raport incydentu; następny czytelnik
bierze to jako dowód, że platforma kiedyś tak psuła, i szuka outage. Jeśli zagrożenie
jest hipotetyczne, powiedz to w pierwszym zdaniu — `test/unit/_i18n/reconcile-timing.test.ts`
otwiera „everything below is about a move that was never made” dokładnie z tego
powodu, po akapicie pod nim, który już kiedyś wprowadził w błąd. Jeśli zagrożenie
jest realne i przeszłe, nazwij decyzję lub commit, który je zamknął, w tym samym
tchem, jak `api_keys/backend.ts` z emerytowanym wpisem `EARLY_PASS_MODULE_IDS`.

To samo dotyczy ledgerów w `check-port-dependencies.ts`: sweep staleness strzela,
gdy właściciel **rejestruje nazwę**, co nie jest tym samym faktem co konwersja
właściciela, więc powód „still hand-wired” gnije bez psucia buildu. Pisz powód
każdego wpisu jako stwierdzenie o nazwie.
## Praca install-time: jedyny szew to `manifest.ts`

`ctx.onBoot` to jedyny lifecycle hook, który niesie `ModuleContext`. Nie ma
`ctx.onInstall` ani `ctx.onUninstall`: istniały kiedyś, composition
sink je zbierał, i nikt ich nigdy nie uruchomił, więc je usunięto. Powód
jest strukturalny, a nie porządek. Kernel komponuje **działający proces**;
orchestrator lifecycle zarządza **inwentarzem deploymentu**, i tylko pierwszy
z nich ma kontener. `module:install` buduje statyczny rejestr z
`REGISTERED_MANIFESTS`, otwiera ORM i Redis, i nigdy nie woła
`composeApp` — więc hook przekazany kontenerowi nie mógłby odpalić nawet w
zasadzie, bez komponowania wszystkich 65 modułów, żeby zainstalować jeden.

Moduł potrzebujący pracy install-time eksportuje ją z `manifest.ts`:

```ts
// packages/modules/custom_fields/src/manifest.ts
export const uninstallHook: ModuleUninstallHook = async (ctx) => {
  if (!ctx.hard) return;                 // soft uninstall drops nothing
  const em = ctx.em as EntityManager;
  await em.getConnection().execute('truncate table "custom_field_definitions" cascade');
};
```

`backend/scripts/generate-composer.ts` wykrywa export i emituje go do
`backend/src/manifest-index.generated.ts`, jedynego wygenerowanego rejestru
manifestów; rejestru nigdy nie edytujesz. Ten sam generator emituje composer,
`db/entities-registry.generated.ts` i `db/migrations-registry.generated.ts`
z tego samego tree walk — jedna komenda, więc dwa artefakty odświeżane dwiema
komendami nie mogą znów driftować. Uruchom
`pnpm --filter backend run composer:generate` i commituj wynik.

Sześć właściwości, wszystkie load-bearing i żadna oczywista z sygnatury hooka.
Są przypięte przez
`backend/test/unit/_lifecycle/orchestrator.test.ts`.

**1. Hook jest idempotentny z kontraktu, nie z konwencji.** To nie „raz per
deployment”. Failed install parkuje wiersz rejestru na `uninstalled`, więc
następny `module:install` uruchamia hook ponownie; tak samo cykl soft-uninstall →
install. Pisz go tak, by drugi run był no-op.

**2. Padający install hook abortuje install.** Orchestrator revertuje każdą
migrację zastosowaną *w tym runie*, w reverse, ustawia wiersz na `uninstalled` z
`lastInstallError`, audytuje `module.install_failed` i podnosi
`LifecycleError('install-failed')` — exit CLI 70. Nie połykaj błędów w hooku, żeby
„być bezpiecznym”: głośne padanie *jest* bezpiecznym zachowaniem i jedynym,
które zostawia instancję w stanie sprzed install.

**3. Padający uninstall hook abortuje uninstall i nic nie usuwa.** Hook działa
przed sweep settings, przed revert migracji i przed dotknięciem wiersza rejestru,
więc throw zostawia moduł dokładnie tak, jak był.

**4. `ctx.hard` rozróżnia soft od destructive.** Soft uninstall znaczy „ten
deployment nie niesie już modułu”; jest odwracalny i nie może zrzucać wierszy.
Hard uninstall znaczy, że schema też idzie. Destructive cleanup żyje za
`if (!ctx.hard) return;`.

**5. Żaden hook nie odpala przy aktywacji ani deaktywacji, i żaden nie może tam
być dodany.** To operator axis obecności modułu — `module:enable`,
`module:disable` i Setting aktywacji `/platform/modules` zostawiają oba hooki
nietknięte. Off jest odwracalny i nic nie zrzuca; uninstall nie jest i jest.

**6. Kontekst hooka to `{ em, redis, log, module }` — plus `hard` przy
uninstall — i nie może nieść usług.** Hook potrzebujący współpracownika
konstruuje go z `em`. Nic nie rozwiązuje się z kontenera tutaj, bo w procesie,
który go uruchamia, nie ma kontenera.

## Komendy operatora: deklaracja, którą host uruchamia

Komenda operatora modułu — reindex, sweep, bootstrap — to export `cliCommands`
tego samego `manifest.ts`, w którym żyją install hooks, a host ją woła. Nigdy
nie jest skryptem bootstrapping platformy dla siebie.

```ts
// packages/modules/search/src/manifest.ts
export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
  {
    name: 'reindex',
    summary: "Rebuild every sales channel's Meilisearch index from PostgreSQL.",
    run: async (context) => (await import('./cli/reindex.js')).reindex(context),
  },
];
```

```bash
pnpm --filter backend run cli -- --list          # every command this instance offers
pnpm --filter backend run cli -- search reindex  # or the alias: pnpm search:reindex
```

Ten sam tree walk i ten sam `detectHookExport`, który niosą `installHook`,
podnoszą to, więc dociera do core, per-deployment overlay module i
**zainstalowanego pakietu rozszerzenia** na identycznych warunkach — co jest
całym powodem kształtu. Plik pod `node_modules` nie może nazwać specifiere
rozwiązującego do `backend/src/composition.ts` instancji, a core script
nazywający jeden to cykl moduł → root → moduł. Wywołanie więc się odwraca:
`backend/src/cli.ts` komponuje raz i woła moduł. To one-to-one z Magento 2, gdzie
moduł wysyła klasę command plus deklarację pod `CommandListInterface`, a
`bin/magento` bootstrappuje aplikację i konstruuje command z wstrzykniętymi
zależnościami.

Pięć rzeczy, które są decyzjami, a nie detalem:

**1. Body żyje w `packages/modules/<id>/src/backend/cli/<name>.ts`, a
deklaracja `await import()`uje je.** Wygenerowany indeks manifestów importowany
jest przez każdy statyczny check script i przez `src/db/configured-migrations.ts`;
statyczny import klienta Meilisearch lub grafu usług zależnego od ORM pociągnąłby
go do wszystkich. To reguła, którą już followuje `lifecycleParticipant`.

**2. Handler dostaje `ModuleContext`, nie cradle.** Rozwiązuje z
`lazyPort<T>(ctx, 'literalName')`, znak w znak to, co pisze `backend.ts`, więc
`check:port-dependencies` widzi krawędź cross-module. Odczyt
`scope.cradle.someForeignPort` to niezadeklarowana krawędź raportująca czysto —
failure, który dał helper `port(ctx, name)`, gdzie czternaście rozwiązań
chowało się za zmienną. Czytanie **własnej** rejestracji modułu z
`ctx.cradle<T>()` jest OK i czasem konieczne: `lazyPort` zwraca proxy
odpowiadające każdej właściwości funkcją, żeby forwardować wywołanie metody, więc
nested reach jak `handle.indexer.reindexAll()` type-checkuje, a potem pada z
*"is not a function"*.

**3. Obecność decyduje host, zanim istnieje context.** Command nie ma trasy do
bramkowania, workera do owinięcia ani rozwiązania portu, na którym wisi transient
gate, więc **deklaracja** to szew:
własne `cli/module-commands.ts` platformy — `@endora-commerce/platform/cli`,
docierane przez aplikację przez re-export shim w `src/cli/module-commands.ts`
— woła `requireModuleEnabled` dla modułu
deklarującego command — pierwsze, poza każdym `try`, zanim poprosi o context.
Autor modułu nie pisze check obecności i nie może go zapomnieć, bo do tego
właśnie służy bramka. Pytane jest id deklarującego
modułu i nigdy właściciela: ta odpowiedź należy do bramki `providePort` właściciela,
a pytanie dwa razy to sposób, w jaki te dwie zaczynają się nie zgadzać.

**4. `--list` i `--help` odpowiadane są, zanim cokolwiek się otworzy.** To
pytania o *deklarację*, więc host czyta
`resolvedManifestEntries()` — tylko manifesty, bez bazy — i odpowiada. Dlatego
`help` to właściwość danych na deklaracji, a nie coś, co body drukuje:
credential `audit_logs read` to dostęp hosta, nie działający connection string,
więc musi móc powiedzieć, co robi, zanim to zrobi.

**5. Pięć komend `module:*` to inna rodzina i nie mogą się konwertować.**
`install`, `uninstall`, `enable`, `disable` i `status` działają **na**
platformie, a nie z nią. Kompozycja uruchamia `reconcileExistingModules`, który
wstawia `state='installed'` dla każdego wysłanego manifestu bez wiersza — więc
komponujące `module:install X` znalazłoby `X` już installed i zwróciło
`already-installed`, bez migracji, reconcile setting ani install hook, z exit code 0.
Komenda platformy musi móc działać na platformie, która jeszcze nie jest w stanie,
który komenda ma stworzyć.

Warto powiedzieć, co komponowanie **kosztuje**, żeby nie odkryć tego późno: każdy
boot hook działa (są idempotentnymi zbiegami, więc to latency i szum logu, a nie
nowy stan), padający bierze command down nazywając własny moduł, a environment
deploymentu staje się warunkiem wstępnym — osiągalny PostgreSQL i, w produkcji,
skonfigurowany public origin. Czego **nie** kosztuje: queue consumer ani timer:
każde `ctx.worker(` i każdy timer modułu siedzi w body `ctx.routes(…)` działającym
przy rejestracji Fastify, a ten proces nigdy nie buduje serwera.

## Checki

| Skrypt | Czego odmawia |
| --- | --- |
| `check-kernel-boundary.ts` | relacji ORM z kernela do modułu lub z modułu do innego modułu; **oraz** specifiere importu pod `src/kernel/**` rozwiązującego do `src/modules/` lub `src/apps/` — każdy kształt, `import type` włącznie. Niesie `KERNEL_MODULE_IMPORTS_TO_DRAIN`, dwukierunkowy grzyb trzymający jedną krawędź, którą eskalowano zamiast naprawić |
| `check-port-dependencies.ts` | nazwy rozwiązanej, której nikt nie posiada; właściciela spoza dependencies manifestu resolvera; singletona capture'ującego bramkowany port — **włącznie z tym, który moduł sam dostarcza**; **bramkowanego portu rozwiązanego z hooka `ctx.onBoot` lub body `ctx.routes`**; roota shadowującego port modułu; obliczonej nazwy portu; **oraz krawędzi do switchable modułu bez zdefiniowanego zachowania, gdy ten moduł jest off** (ledger konsekwencji deaktywacji powyżej) |
| `check-port-catches.ts` | `catch` wokół wywołania bramkowanego portu, który nie przepuszcza `ModuleDisabledError` — bezwarunkowy re-throw, `rethrowIfModuleDisabled`, nazwanie błędu lub delegate re-throwujący go. Śledzi port przez holder i przez wkład roota. Niesie `PORT_CATCHES_TO_DRAIN`, dwukierunkowy grzyb, i wyprowadza `OWNER LOCKED` z manifestów dla miejsca, którego każda bramka ma `nonDeactivatable` owner |
| `check-container-imports.ts` | importu `awilix` bezpośrednio przez moduł zamiast przez `ModuleContext` |
| `check-entry-scope.ts` | **site** entry point non-HTTP bez ustanowionego scope. Sześć klas: skrypt CLI i plik `package.json` w `src/` uruchamiany jako własny proces — oba file-level, po jednym site, własne top-level execution pliku — plus jeden site per `new Worker(...)`, per repeating timer, per `x.on('message', …)` i per `process.on/once(...)`. Klasa timer to *kształt*, nie konstruktor: czyta `lib/repeating-timers.ts`, współdzielone z `check-entry-presence.ts`, więc `setTimeout`, który callback re-armuje, liczy się. Drugie źródło populacji to w ogóle nie kształt: klasy kształtów napisano z tego, co drzewo trzymało w tamtym czasie, a `src/seeds/dev-catalog-seed.ts` — top-level `main()` truncating i repopulating tabel dziesięciu modułów — nie było żadnym z nich, więc `unscoped=0` nic o nim nie mówiło. **Populacja to sites, nie pliki** — patrz poniżej. Linia drukuje `sites=` i `files=`, żeby poszerzenie, które nie ruszyło rozmiaru populacji, było widoczne jako nie ruszyło niczego |
| `check-channel-resolution.ts` | surowego odczytu nagłówka `x-sales-channel` poza resolverem; powierzchni storefront re-rozwiązującej kanał requestu; odczytu settings, którego argument kanału może być stringiem nie będącym uuid kanału; id kanału wymyślonego default parameter lub fallbackiem `randomUUID()`. Działa `--enforce` w CI |
| `test/contract/kernel/harness-parity.test.ts` | driftu między dwoma rootami kompozycji jako explicite ledger — włącznie `ROOT_MODULE_VALUE_IMPORTS`: każdy import **wartości** roota z `src/modules/**`, kluczowany po właścicielu, z tym, co musi się stać, by drainować, i „no root constructs a module-owned service” względem nazwanej allow-list |

Ta tabela to własne checki kernela. **Cały** inventory — włącznie
`check-command-coverage.ts`, `check-subscribe-seam.ts`, `check-doc-snippets.ts`,
`check-error-translations.ts`, `check-entity-tenant-classification.ts`,
`overlay:check`, dwa shell checki bez toolchain i bramkę footprint pdfmake —
jest wyliczony w `backend/test/unit/scripts/check-inventory.test.ts`,
który pada, gdy istnieje skrypt `check-*` bez wpisu, i gdy wpis nazywa skrypt,
którego nie ma. Przeczytaj następną sekcję, zanim dodasz jeden.

Check czyta trzy kształty rozwiązania, a trzeci wymagał drugiego przebiegu, żeby
być poprawnym: parametr cradle fabryki (destructured lub nazwany),
inline `ctx.cradle<C>()`, i **którykolwiek z nich związany najpierw z lokalem** —
`const cradle = ctx.cradle<C>()` i `const cradle = (): C => ctx.cradle<C>()`.
Piętnaście modułów używało jednej z dwóch form aliasu i każdy odczyt przez nie
był niewidoczny, włącznie z bramkowanymi portami destructured w body `ctx.routes`.
Gdzie alias jest czytany, decyduje werdykt, dokładnie jak inline read: `cradle().x`
wewnątrz fabryki `asFunction` to **capture**, bo body fabryki działa, gdy Awilix
konstruuje rejestrację.

Check portów niesie cztery allow-listy, wszystkie mające drainować, a nie rosnąć:
`HOST_REGISTERED_PORTS` (root rejestrujący w imieniu modułu), potem
`WIRING_RESOLUTIONS_TO_DRAIN` — bramkowane porty nadal destructured w body
`ctx.routes`, gdy check nauczył się widzieć kształt, **teraz
puste** — `ALIAS_HIDDEN_RESOLUTIONS`, odczyty ukryte aliasem, których naprawa to
decyzja manifestu z konsekwencją widoczną dla operatora, a nie one-liner,
**też puste**, odkąd `commerceModule` dostał accessor konstruktora,
oraz `REGISTRY_POLICIES_UNSTATED`, dług polityki ledgera. **Nowy** wpis psuje
build.

Czytaj rozmiar pierwszej listy z jej historią. Napisana jako residue konwersji
i drainowała tak — każdy wpis, którego właściciel się skonwertował, usunięto, a
check pada, gdy jeden przeżyje właściciela. **Ile wpisów zostało, nie jest tu
zapisane**: ten akapit mówił *„28"* i nazywał cztery bridge, z których trzy od
tego czasu emerytowano, więc to był count faktu wyprowadzonego i lista ruchomej
populacji w jednym zdaniu.
`HOST_REGISTERED_PORTS` w `backend/scripts/check-port-dependencies.ts`
odpowiada na obie. Dwa kształty to większość tego, co zostało — *kto pyta*
(`customerContextResolver`, `cartActorResolver`, `adminAuditActorResolver` i reszta
rodziny actor, gdzie produkcja czyta `request.actor`, a harness `request.testActor`)
i *czy ta kompozycja uruchamia tego konsumenta*
(`pwaRunWorkers`, `searchRunWorkers`, `webhooksRunWorkers`). Trzeci kształt —
*bridge, który root składa przez granice, do których moduł nie może sięgać* —
jest drainowany, jeden właściciel na raz, do portów, które właściciel
publikuje.

Dwa sposoby, w jakie wpis tutaj gnije bez psucia buildu, i oba warto znać, zanim
mu zaufasz. Kilka komentarzy per-entry nadal mówi „still hand-wired” o module,
który się skonwertował: sygnał staleness strzela tylko, gdy właściciel sam
rejestruje port. A wpis, którego nazwy **żaden root już nie wnosi**, jest
niewidoczny dla każdego findingu tej tabeli — sweep `unsupplied` pyta, czy jakiś
moduł nadal *rozwiązuje* niezarejestrowaną nazwę, więc emerytowany bridge
zostawia opis wkładu, którego nie ma. `returnsBridge` siedział tu tydzień tak.
Usuń wpis w merge request, który emerytuje nazwę.

Porty
należące do modułu `nonDeactivatable` nie są na tej liście i nigdy nie będą:
wyłączenie jest wyliczane z manifestów, bo bramka, której orchestrator odmawia
zamknięcia na obu osiach, nie ma stanu, w którym może rzucić. Drugie wyłączenie
nie jest już skryptu: krawędź, której nie da się zadeklarować, bo deklaracja
zamknęłaby cykl manifestu, deklarowana jest w manifeście modułu rozwiązującego jako
`acknowledgedDependencies` — `organizations`
rozwiązujące `addressService` to worked example, bo `addresses` deklaruje
`organizations`, a tenancy root musi zainstalować pierwszy. Siedzi w manifeście,
a nie tutaj, bo odmowa zależności flip-time lifecycle czyta tę samą
deklarację: gdy krawędzie żyły tylko w tym skrypcie, operator
mógł wyłączyć właściciela acknowledged portu pod live resolution i nic nie
odmawiało flipu. Przykład, który to znalazł, to
`catalog` rozwiązujący `price_lists:pricingService`; `price_lists` od tego czasu
stał się core, więc ten konkretny flip zamknięty deklaracją właściciela —
ale mechanizm nie dotyczy tego, które moduły akurat są core, a krawędź nadal
deklarowana jest tam, gdzie obaj czytelnicy widzą.

### Pisanie checka, który może zrobić się czerwony

Sześć checków okazało się słabszych niż własny opis w jeden tydzień. Jeden
chodził po `*.entity.ts` i inspektował dekoratory relacji, podczas gdy nagłówek
mówił o importach; jeden nie widział module-local cradle alias, a poszerzenie
przesunęło 0 naruszeń na 21 w 17 modułach; jeden scanner dopasowywał **4 z 492**
enforcement sites, bo `\.` w regex nie było opcjonalne; subskrypcje EventBus nie
miały grzyba, dopóki nie nagromadziło się dwadzieścia dwa — liczba, którą ta
strona podała poprawnie 190 linii wcześniej i błędnie tu przez tydzień, co jest
sposobem, w jaki zła liczba przeżywa: dokument sprzeczny sam ze sobą czyta się
jak dwóch autorów, a nie błąd. Żaden z nich nie był nieuwagą, i żaden się nie
ogłosił: **zielony wynik nie da się odróżnić od checka, który patrzył w nic**,
i nic w repozytorium nie wymuszało rozróżnienia. Wychodzi osiem reguł.

**Weź input jako parametr.** Check, którego analiza czyta dysk, może działać tylko
na drzewie, a na czystym drzewie zgadza się z funkcją zwracającą `[]`.
`checkSubscribeSeam({ sources })`, `checkDocument(doc, read)` i
`compareArtifact(path, expected, read)` biorą to, co czytają, więc testy prowadzą
je nad źródłami, których repozytorium nie zawiera — jedyny sposób, by zobaczyć
regułę odpalającą na kształcie, dla którego została napisana. Trzymaj CLI jako
cienki `main` dostarczający prawdziwego readera.

**Fixture wchodzi na górze analizy.** „Robi się czerwony na syntetycznym fixture”
samo w sobie nie wystarcza, a counter-example był sam guard: wpis inventory dla
`check-entry-scope` podawał `violationsOf` **pre-classified record**, więc
dowodził ostatniej funkcji w łańcuchu, podczas gdy classifier — zepsuta część —
nigdy nie działał. Ten classifier greppował `setInterval(`, nie widział
self-rescheduling `setTimeout`, a live luka siedziała za nim tak długo,
jak proof czytał zielono. **Fixture wchodzący poniżej defektu
nie może go złapać.** Proof więc startuje od tego, co check czyta w prawdziwym
runie — source text, mapa plików, wstrzyknięty reader, fixture tree na dysku —
i każdy etap, którego check jest właścicielem, population filter i classifier
włącznie, działa w drodze do asercji. Każdy wpis inventory deklaruje
`enters: 'top'` dokładnie z tego powodu, a cokolwiek innego idzie do
`PROOFS_ENTERING_BELOW` z tym, co podniosłoby je.

**Dowód zestawu kształtów, nie jednego istniejącego, gdy pisano.** Proof może
wejść na górze i nadal testować jedną z pięciu pisowni, a potem cztery piąte
checku mogą oślepnąć za piątym czerwonym. `check-subscribe-seam`
nazywa trzy sygnały, a jego fixture — `eventBus.on('inventory.adjusted.v1', …)` —
spełniał dwa naraz, więc żaden nie mógł paść sam; `check-entry-presence`
nazywał trzy konstrukty i dowodził `setInterval`; `check-channel-resolution`
nazywa cztery sygnały i dowodził jeden. Gdzie nagłóvek checka wylicza zbiór,
inventory niesie jeden proof per member, każdy fixture zawężony tak, by mógł
tripować tylko sygnał, po który nazwany, i każdy asertujący **kind** findingu,
a nie goły count.

**Uczyń zakres skanu właściwością reguły, nie nazwy pliku.** Dwa checki wyliczały
`*.entity.ts`. Nic w repozytorium nie egzekwuje tego suffixu, więc encja
zadeklarowana w `entities/index.ts` nie była *unclassified* dla nich — była
unread, a unread i clean drukują tę samą linię. Chodź po drzewie, pre-filtruj na
to, o czym reguła (`@Entity(`, dekorator relacji), i niech parse decyduje.

**Nie leksuj ręcznie.** Prawie każdy check source-level zaczyna ignorując
komentarze, a napisany jako uporządkowana para regexów ten krok jest zły w obu
kolejnościach. Block-comments-first, linia `//` kończąca się globem trasy otwiera
block comment biegnący do następnego prawdziwego terminatora: `harness-parity.test.ts`
stracił **1135 z 2767 linii harnessa** tak, a `runBootHooks(`,
`errorEnvelope` i `resolvePreferredLanguage` były niewidoczne dla każdej
asercji `not.toContain` w pliku — zielono, bo tekst zniknął.
Line-comments-first otwiera symetryczną dziurę: `//` w block comment zabiera
własny terminator tego bloku, a opener biegnie dalej. W obu kolejnościach token
komentarza w **string literal** — `'/*'` w teście wildcard-MIME `assets_library`,
`'image/*, */*;q=0.5'` w nagłówku Accept `pim_ergonode` — otwiera lub zamyka
komentarz, którego nie ma. Jest więc jedna implementacja,
`backend/scripts/lib/source-text.ts`, pytająca parser, które spany są komentarzami,
zamiast porządkować dwa przebiegi; `typescript` jest już inputem dziewiętnastu
checków, a scanner wiedzący, czym jest string literal, nie ma kolejności do
zepsucia. Blankuje zamiast usuwać, więc numer linii w wyniku nadal jest numerem
linii w źródle. Gdzie konsument chce więcej niż usunięte komentarze, czytaj
węzły wprost — `check-diacritic-folds` robi to, bo cztery pliki celowo cytują
zły one-liner, a implementacja text-level raportowałaby dokumentację napisana,
by zapobiec defektowi, a `check-entry-scope` też to robi: niósł czwartą
kopię tej pary regex, a jego per-site rewrite pyta syntax tree o każde pytanie,
które kiedyś zadawał tekstowi, więc kopia zniknęła, a nie została przekonwertowana.
Jego pozostały text pass to **pre-filter** decydujący, które 54 z 1458 plików
docierają do parsera, i celowo over-inclusive — komentarz cytujący `new Worker(...)`
kosztuje jeden parse i nie może kosztować findingu.

**Daj „nic nie przeczytano” własny exit code.** Exit 2, odróżniony od clean (0)
i od znalezionych naruszeń (1), gdy lista plików, routing table lub resolution
count wraca pusta w drzewie mającym setki. To nie defensive coding:
`pnpm --filter backend run i18n:hardcoded` rozwiązywał default root względem
working directory, nie znalazł pliku z `backend/` i drukował „0 finding(s) across
0 file(s)" z exit 0 tak długo, jak istniał. `check-pdfmake-footprint.sh` wychodził
0, gdy pdfmake nie był zainstalowany, więc jedyny stan, w którym nic nie mierzył,
był też stanem, w którym raportował budżet spełniony.

**Drukuj, co przeczytałeś, nie tylko co znalazłeś — i drukuj *krótki* przypadek,
nie tylko pusty.** Exit 2 odpowiada „input był pusty”. Nie odpowiada „input był
7% siebie”, co faktycznie się zdarza: 1364 z 1469 plików `.ts` pod `backend/src`
żyje w `src/modules`, więc przeniesienie tego drzewa zostawia osiem checków
czytających pozostałe 105 plików, nie znajdujących nic złego w nich i drukujących
`violations=0`. Ten sam kształt dotarł do siedmiu członków —
definicja populacji wykluczająca live entry point, plik ukrywający site
w środku, spread omijający excess property checking,
comment stripper jedzący 41% pliku przed match i populacja zdefiniowana
obecnością samej rzeczy checkowanej, więc jej brak był niewykrywalny. Każdy
z nich to check, którego output mówił, co znalazł, i nigdy, co przeczytał. Każdy
check więc drukuje jedną linię w jednej gramatyce, z
`backend/scripts/lib/read-size.ts` lub jego shell twin `scripts/lib/read-size.sh`:

```
[entry-scope] read: files=1459 sites=47 sources=manifest-index:65/65,package-scripts:18/18
[nul-bytes]   read: files=8288 sources=self-reported
```

`files` to to, co walk **otworzył** — nigdy pliki, w których wylądował finding,
bo te ruszają się z findingami i nie odpowiadają na pytanie; `sites` to drobniejsza
populacja, gdzie check ma jedną, bo defekty site-level powyżej to dokładnie
przypadek, gdzie file count stał w miejscu, a site count się ruszył; a `sources` to
**niezależne** wyprowadzenie, względem którego rozmiar jest uzgadniany, bo check
liczący własną populację i potem ją raportujący powiedział to samo dwa razy.
Dla module walk to wyprowadzenie to wygenerowany indeks manifestów, przez
`scripts/lib/module-population.ts` — każdy zarejestrowany moduł musi dać source,
co jest podłogą, dla której nikt nie musi wybierać liczby. Gdzie naprawdę nie ma
żadnego, token to literal `self-reported`, a powód żyje w
`READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE`. Reporter odmawia trzech kształtów
z exit 2 — nic nie przeczytano, oczekiwanie zera i walk krótszy niż oczekiwanie
— a `backend/test/unit/scripts/check-read-size.test.ts` spawnuje każdy check i
trzyma wydrukowane liczby w paśmie zapisanym w
`backend/test/helpers/check-read-sizes.ts` (−10% / +50%, asymetrycznie celowo:
dolna krawędź to kierunek defektu, górna tylko zatrzymuje record przed staniem
się stale, gdy drzewo rośnie).

**To pasmo ratchetuje ślepotę i nie może ratchetować staleness, więc ten sam run
drukuje obok drift report.** Zapisana wartość poszła źle trzy razy w dziesięć dni,
dwa razy cicho, i każda siedziała wygodnie w paśmie: na `check-admin-surface`
podłoga jest 241 sites poniżej rekordu, więc drain batch ruszający o 41 nigdy
nie może być odmówiony. Run miał liczbę za każdym razem — parsował, porównywał,
znajdował in-band i odrzucał. Teraz mówi to
zamiast, w `afterAll`, przy każdym runie, zielonym czy czerwonym, jeden blok
`[read-size drift]` nazywający każdy zapisany wpis, który już nie opisuje drzewa,
z zapisaną wartością, obserwowaną, signed delta i tym, ile slacku do krawędzi
zużył ten ruch. Nagłówek to spis —
`3 drifted, 32 agree, 0 not measured, of 35 recorded` — bo raport mówiący nic,
gdy nic nie driftowało, nie da się odróżnić od raportu, który nie działał,
co jest defektem nieujawnionego odczytu przybywającym w instrument zbudowany,
by na niego odpowiedzieć; wpis, którego run nie zmierzył, nazwany jest
*not measured* i nigdy nie
liczony jako agreeing. Nie dodaje asercji i żadnej nie osłabia. Istnieje, bo
obie preskrypcje w sile — re-record w merge request, który ruszył, i czytaj liczbę
z merged tree — zakładają, że autor wie, *które* wpisy jego zmiana ruszyła, a to
mapowanie to kalkulacja, którą każdy check wykonuje, a nie coś, co checklist może
powiększyć. Formatter to `backend/test/helpers/read-size-drift.ts`, a jego
gramatyka jest normatywna.

**Ledger jest two-way albo allow-list.** Niezledgerowane naruszenie pada,
*i* wpis, który już nie opisuje naruszenia, pada. Druga połowa to ta, która gnije:
`PORT_CATCHES_TO_DRAIN`, `BARE_SUBSCRIPTIONS_TO_DRAIN`,
`UNTRANSLATED_ERROR_CODES` i `HARDCODED_STRINGS_BASELINE` sweepują stale entries,
a każdy wpis niesie powód jako stwierdzenie o nazwanej rzeczy — patrz „Pisanie
rationale kolejności, które nie gnije” wyżej, dlaczego „still hand-wired” nim
nie jest. **Escape hatch w checku też jest ledgerem**: `command-coverage-ignore`
miało 185 wpisów i zero sweep przez długi czas, więc ignore napisany dla zapisu,
który się przeniósł, nadal exemptował metodę, która już nie potrzebowała exempt,
a następny zapis dodany tam dziedziczył exempt. Gdy stały dług jest zbyt duży na
powód per wpis — 274 hard-coded strings w 47 ekranach admin — wpis staje się
**plikiem**, a wartość **liczbą**, co ratchetuje w obie strony bez proszenia
nikogo o napisanie tego samego zdania 274 razy.

**Check w żadnym jobie CI jest gorszy niż brak checka**, bo istnienie implikuje
pokrycie. Dwa nie działały nigdzie przez długi czas, a jeden cytowano jako *the*
gate reguły English-only dla stringów user-facing — twierdzenie, którego
repozytorium nie wspierało. Powód, dla którego check jest unwired, prawie
nigdy nie brzmi „właściwość przestała mieć znaczenie”: to stały dług (zrób grzyb)
albo założenie environment, którego nikt nie przeczytał ponownie (bramka pdfmake
miała niby potrzebować zainstalowanego `node_modules`, który job `quality` musiałby
dodać, a ten job ma go w `before_script` od zawsze). Pole `job` inventory to
miejsce, gdzie ta decyzja jest zapisana, a `none` musi być uzasadnione w wpisie.

Punkt egzekucji to `backend/test/unit/scripts/check-inventory.test.ts`. Wylicza
każdy skrypt `check-*`, i dla każdego **uruchamia własną analizę checka, od góry,
nad syntetycznym naruszeniem każdego kształtu, który twierdzi, że odmawia, i
asertuje, że wraca finding tego kind**. To celowo więcej niż „istnieje companion
test file”: plik pod ścieżką nic nie dowodzi, co jest failure, o który chodzi
całej tej sekcji. Companion test nazwany w wpisie to miejsce na detail kształtu —
asercja na message, ledger, exit code — podczas gdy inventory trzyma kształt
przed zniknięciem, gdy ten plik jest edytowany. Inventory przypina też, który job
CI uruchamia każdy check i porównuje z `.gitlab-ci.yml`, więc check cicho
opuszczający job musi to powiedzieć, a także czy check ujawnia
rozmiar tego, co przeczytał, z liczbami w
`backend/test/helpers/check-read-sizes.ts` i dwukierunkowym `READ_SIZE_DEFERRED`
dla wszystkiego, co tego nie robi.

### Benchmark asertuje, że coś zmierzył, zanim asertuje, jak długo to trwało

Sekcja powyżej dotyczy reguły, która nie widzi. Ta dotyczy tego samego defektu w
**pomiarze**, i łatwiej ją przeoczyć, bo liczba, którą benchmark drukuje, nigdy
nie jest *błędna* — po prostu nie dotyczy rzeczy, dla której ktoś ją czyta.
`test/perf/catalog-list.bench.ts` seedowało syntetyczny korpus należący do żadnego
kanału sprzedaży, więc `filterByChannel` dropowało każdy wiersz (channel scoping
fail-closed), a strona, którą mierzyło, zawierała zero summaries. Raportowało
p95 7 ms i było zielone od dnia, gdy wylądowało channel scoping; z korpusem
bound do kanału ten sam odczyt mierzy 13–18 ms, cała różnica to per-summary work,
który nigdy nie działał. **Budżet spełniony mierząc nic i budżet
spełniony będąc szybkim wyglądają identycznie w CI.**

Pytanie do benchmarku więc brzmi jak do checka: *gdyby rzecz mierzona cicho
nic nie robiła, czy to zauważy?* Wychodzą cztery reguły.

**Liczy pracę, w tej samej pętli, która mierzy czas, i asertuje count pierwszy.**
Nie smoke test w sąsiednim pliku — timed run sam niesie dowód: summaries per page,
projected attributes, cart lines served, up-sell candidates returned, products
emitted, carts swept, registry entries resolved. Asertuj ten count **przed**
asercją latency, żeby run mierzący nic padał mówiąc to, a nie padając na budżet
z niewyjaśnionym marginesem — albo gorzej, przechodząc.

**Drukuj, co zmierzono obok czasu trwania.** Każda linia `[perf/*]` niesie własny
mianownik, bo czytelnik logu benchmarku zwykle porównuje dwa runy tygodnie apart,
a p95, które spadło o połowę, bo fixture przestał produkować wiersze, jest
nieodróżnialne od p95, które spadło o połowę, bo kod przyspieszył.

**Konsumuj wynik.** Microbenchmark odrzucający return value mierzy wywołanie, które
V8 może wyeliminować. `enabled-check.bench.ts` liczyło odpowiedzi zamiast tego,
a uczciwa liczba wyszła wyżej niż ta raportowana — co jest korektą, nie regresją.

**Warunek wstępny scenariusza to asercja, nie komentarz.** „Cold path” to było
`redis.del` na two-layer cache: per-process LRU przed Redis nadal odpowiadał,
więc cold scenario mierzyła warm i obie drukowały 0.1 ms. Pętla teraz dropuje
obie warstwy i asertuje miss cache przed startem. Gdzie fixture czyni pomiar
realnym — channel membership, wiersze `product_links` dla up-sell strip — seed
go, potem asertuj, że endpoint go zwrócił.

Gdzie guard potem robi budżet czerwony, **raportuj; nie podnoś budżetu**. Rozróżnienie
„jesteśmy wolniejsi niż mówiliśmy” od „nigdy tego nie mierzyliśmy” to cała
wartość guarda, a liczba przesunięta, by zrobić build zielonym, niszczy obie.

Jedna caveat ta sama incydent ujawnił: te benchmarki są gated na `PERF_RUN`
i **żaden job CI go nie ustawia**, więc nic w pipeline nigdy nie wykonało jednego.
`test/perf/catalog/visible-attributes.bench.ts` rzucało zamiast mierzyć od dnia,
gdy wylądowało channel scoping, a `pnpm --filter backend run test:perf`
to jedyne, co by to powiedziało. Uruchom lokalnie, gdy dotykasz hot path; scheduled
job to stały dług.
