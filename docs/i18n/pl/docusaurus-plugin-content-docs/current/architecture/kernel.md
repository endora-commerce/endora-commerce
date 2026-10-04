---
title: Jądro — granica, zakresy i kolejność kompozycji
---

# Jądro

Każdy moduł jest składany przez kontener Awilix. **Jądro** (kernel,
`packages/platform/src/kernel/`) jest właścicielem kontenera, punktów rozszerzenia, przez które
moduł się rejestruje, oraz kilku usług, na których opiera się niemal każdy moduł. Ta strona omawia
trzy rzeczy, które musisz wiedzieć, zanim napiszesz lub zmienisz moduł: **co jądro może zawierać,
a czego nie**, **jak dociera się do stanu związanego z żądaniem** oraz **kiedy twoje rejestracje i
hooki faktycznie się wykonują**.

Ta ostatnia kwestia nie jest ozdobnikiem. Kolejność kompozycji zaskoczyła autorów trzech
przenoszonych modułów, za każdym razem w ten sam sposób, i za każdym razem wyglądało to na
brakującą rejestrację, a nie na błąd kolejności.

## Granica

**Jądro jest właścicielem kształtów i infrastruktury platformy. Nigdy nie jest właścicielem
zachowania domenowego.**

| W jądrze | Dlaczego |
| --- | --- |
| `container.ts`, `compose.ts`, `module-context.ts`, `scope.ts` | Sam mechanizm kompozycji |
| `ports/` — `require-admin`, `organizations`, `settings`, `sales-channel` | **Typy**; implementację rejestruje moduł, który jest ich właścicielem |
| `audit/` | Każdy audytowany zapis przechodzi przez jeden mechanizm zapisu |
| `settings/`, `sales-channels/` | Odczyt ustawień i rozstrzyganie kanału sprzedaży są potrzebne niemal każdemu modułowi, więc żadne z nich nie może zależeć od obecności jednego konkretnego modułu |
| `lifecycle/` | Mechanizm obecności: pamięć podręczna rejestru, rozstrzyganie aktywacji, łączenie stanu efektywnego i wrappery blokujące, przez które przechodzą trasy, workery i subskrybenci każdego modułu |
| `lazy-port.ts` | Jak moduł odczytuje port innego modułu, nie zamrażając go |

Wynika z tego reguła: **jądro nie może importować z `src/modules/` ani `src/apps/`** — import
moduł→jądro jest zawsze dozwolony, jądro→moduł nigdy. `src/apps/` też jest po stronie zakazanej:
moduł nakładkowy jest zwykłym uczestnikiem cyklu życia, a dekoracja to kod konkretnego wdrożenia,
więc jądro, które sięga do któregokolwiek z nich, byłoby jądrem różnym w każdym wdrożeniu.

### Sąsiednie katalogi jądra podlegają tej samej regule

`src/http`, `src/events` i `src/tenancy` to **katalogi platformy podlegające regułom jądra** i
żaden z nich również nie może importować z `src/modules/` ani `src/apps/`.

| Katalog | Czym jest | Dlaczego podlega regule |
| --- | --- | --- |
| `src/events/` | Jeden plik, 81 wierszy: działająca w procesie szyna zdarzeń oparta na `AsyncLocalStorage`, generyczna względem mapy zdarzeń, importująca tylko `node:async_hooks` | Nie ma w nim ani jednego pojęcia domenowego |
| `src/tenancy/` | Zabezpieczenie izolacji tenantów: nazwy kolumn jako stringi, fragmenty `where` dla nieprzezroczystego pola, czysta funkcja użytkownik→`TenantContext` | Pięć encji jądra bierze stąd `@GlobalEntity()` — bez tego warstwa trwałości jądra nie istnieje |
| `src/http/` | Uruchomienie Fastify, struktura błędów, rejestracja OpenAPI, kodowanie kursorów, rejestr interceptorów | Cztery pliki jądra biorą stąd `HttpError` **jako wartość** |

Nie są dla jądra opcjonalne; bez nich się nie kompiluje. Zależność, bez której jądro się nie
skompiluje, a która sama mogłaby importować moduł, oznacza jądro importujące moduły o jeden krok
dalej — w kategoriach pakietów to cykl `kernel → http → mod-i18n → kernel`, a przyjętym tu
warunkiem jest, że pakiety nie tworzą cykli.

### Regułą objęty jest teraz cały pakiet, a nie lista katalogów

Wcześniejsze sformułowanie reguły pomijało trzy katalogi — o `src/db` mówiło, że „z założenia
wymienia każdy moduł”, o `src/overlay`, że to „rozstrzyganie dla konkretnego wdrożenia”, a
`src/commands` leżało *nad* jądrem, co tamto sformułowanie oznaczało jako „prawdziwą otwartą
kwestię do zamknięcia”. Kiedy to pisano, wszystkie trzy były katalogami **aplikacji**, a każde z
tych założeń zniknęło wraz z przeniesieniem: `packages/platform/src/db/` nie importuje żadnego
modułu (wygenerowane rejestry zostały w `backend/src`), `overlay/` platformy to loader, który
przyjmuje katalog nakładki i zgłoszone identyfikatory jako parametry, a tamta kwestia jest
zamknięta.

Co więcej, zmienił się sam argument, na którym opiera się ta reguła. *Jeden dodatkowy krok*
liczył kroki między katalogami źródłowymi, które mogły stać się **różnymi pakietami**. Nie stały
się: `@endora-commerce/platform` kompiluje wszystkie swoje katalogi do jednego artefaktu
(`rootDir: ./src`, `files: ["dist"]`) z jednym blokiem `dependencies`, a każdy pakiet modułu od
niego zależy. Import modułu w dowolnym miejscu `packages/platform/src` zamyka więc cykl w **zero**
krokach, niezależnie od tego, który katalog go zawiera — a odpowiedzią jest cały pakiet, a nie
dłuższa lista katalogów.

**Ta reguła jest egzekwowana.** `backend/scripts/check-kernel-boundary.ts` realizuje tę jedną
zasadę trzema regułami. **Reguła A** odrzuca relację ORM z jądra do modułu. **Reguła B**,
dwukrotnie rozszerzana od czasu napisania, odrzuca import wskazujący moduł z dowolnego pliku w
**katalogu platformy**. **Reguła C** odrzuca taki import w dowolnym miejscu przechodniego
domknięcia importów jądra, niezależnie od liczby kroków.

**Katalogi reguły B są wyprowadzane i nigdzie nie są zapisane** — to katalogi członka workspace,
który deklaruje `endora: { type: "platform" }`, więc kolejny katalog platformy jest oceniany już
przez to, że istnieje. Do czasu wprowadzenia tego wyprowadzenia była to czteroelementowa lista
wpisana na stałe, przy platformie, która urosła do czternastu katalogów: dziesięć z nich było
całkowicie poza regułą, w tym `composition/`, gdzie znajduje się `composeApp`. Oczywistą
alternatywą byłoby wyprowadzanie z mapy `exports` platformy i **celowo** z niej nie korzystamy —
odpowiada ona na pytanie *co konsument może importować*, a `src/demo/` to prawdziwy katalog
platformy bez własnej ścieżki eksportu — ale służy kontroli jako niezależne potwierdzenie, więc
opublikowana ścieżka, która nie wskazuje żadnego sprawdzanego katalogu, kończy się kodem 2.

**Reguła B odrzuca oba sposoby zapisania adresu modułu**: ścieżkę względną do `src/modules/` lub
`src/apps/` oraz **samą nazwę pakietu npm** modułu. Druga część pojawiła się przy tym samym
rozszerzeniu, zgodnie z warunkiem wycofania zapisanym w samej kontroli — mówił on, że import po
nazwie pakietu nie może trafić do modułu, bo pakiety modułów nie istniały — a od tamtej pory
`backend/src/modules/` zawiera tylko `README.md`, więc nazwa pakietu to jedyny sposób zapisu, jaki
pozostał.

Reguły B i C celowo nie są zbędnym powtórzeniem — każda pokrywa martwy punkt drugiej: B działa na
określonym zbiorze plików, a jeden katalog został kiedyś pominięty właśnie dlatego, że nikt go nie
wpisał na listę; C nie ma zbioru, który mogłaby zgubić, ale nie widzi plików sąsiednich katalogów,
do których jądro dziś nie sięga. Komunikat reguły B wskazuje wiersz, komunikat reguły C — łańcuch
importów.

Obie widzą każdą postać importu — `import`, `import type`, `export … from`, dynamiczne `import()`,
`require()` oraz adnotację `import('…').Type` w treści, do której zachęca konfiguracja ESLint
samego repozytorium. Import samego typu to naruszenie jak każde inne: znika z bundla, ale nie z
`package.json`, a reguła ESLint `prefer: 'type-imports'` w przeciwnym razie automatycznie
przemycałaby naruszenia obok kontroli.

Kiedyś z `src/kernel/` do `src/modules/` prowadziły cztery importy: `module-context.ts` brał trzy
wrappery blokujące, `ports/provide.ts` brał `ModuleDisabledError` i `effectiveState`, a
`ports/organizations.ts` importował typ klasy encji `Organization`. Przeniesienie mechanizmu
obecności — `plugin-helpers.ts`, `registry-cache.ts`, `effective-state.ts`,
`activation-resolver.ts` i `module-registration.entity.ts` — do `src/kernel/lifecycle/` usunęło
pierwsze trzy. Czwarty zniknął, gdy port zaczął przyjmować strukturalny obraz organizacji zamiast
klasy encji, a wraz z nim zniknął jedyny import z sąsiedniego katalogu (`src/http/error-envelope.ts`
sięgał do `_i18n` po mapę tłumaczeń błędów, która teraz jest wstrzykiwana).

`KERNEL_MODULE_IMPORTS_TO_DRAIN` jest więc **pusta** i pozostaje zapadką działającą w obie strony:
niezarejestrowany import przerywa build **i** wpis w rejestrze, który nie opisuje już żadnego
importu, też go przerywa. Wpis to dług z właścicielem, a nigdy stałe zwolnienie.

Reguła ma jedno ograniczenie, celowe i opisane w nagłówku skryptu: plik `*.test.ts` leżący obok
kodu w katalogu platformy nie jest sprawdzany, bo test może importować dane testowe i nie jest
artefaktem, który interesuje proces pakowania.

Najpierw próbowano opisu słownego i to nie wystarczyło. `kernel/index.ts`, `tenancy/index.ts` i
`http/interceptors/registry.ts` opisują tę regułę w komentarzu nagłówkowym; wszystkie trzy opisy
były prawdziwe, żaden nie był egzekwowany, a jedyny plik, który ją łamał, i tak ją złamał. To jest
argument za kontrolą.

`ports/organizations.ts` najlepiej pokazuje ten podział. Jądro deklaruje `OrganizationReadPort` —
`loadEffectiveOrganization`, `assertCanTransact`, `loadCartApprovalPolicy` — bo niemal każdy moduł
musi odczytać organizację. **Nie** implementuje go. Moduł `organizations` rejestruje pod tą nazwą
`OrganizationContextService`, więc kształt jest wspólny dla całej platformy, a zachowanie zostaje w
module, który jest właścicielem tabeli.

Wartości zwracane przez port mają typ strukturalnego `OrganizationSnapshot` należącego do jądra —
`{ id, status }`, z `OrganizationStatus` pochodzącym z `@endora-commerce/contracts` — a nie klasy
encji `Organization` z modułu. Tylko z tego korzystają wywołujący port: `promotions` odczytuje
`status`, a `carts` i `orders` całkowicie ignorują zwracaną wartość, bo zależy im na rzuconym
wyjątku. TypeScript typuje strukturalnie, więc `OrganizationContextService` zwracający encję
spełnia wymagania portu **bez warstwy mapowania i bez zmiany implementacji**.

**Encja zostaje w `organizations` na stałe.** Przeniesienie jej tak, jak przeniesiono
`SalesChannel`, nie ma tu zastosowania: `sales_channels` nie ma żadnych migracji, a jego tabela
już należała do `core`, natomiast `organizations` ma osiem migracji, które wszystkie zapisują
tabelę `organizations`, a sześć z nich tworzy też tabele należące do modułu. Uczciwe wykonanie
oznaczałoby podział sześciu migracji, zmianę nazw ośmiu już wykonanych klas i skoordynowaną
przebudowę bazy danych — po to, by obsłużyć port, który korzysta z dwóch z 24 właściwości encji.
`src/tenancy` to precedens, który sprawia, że obraz strukturalny jest rozwiązaniem właściwym, a nie
tylko tanim: wymusza izolację tenantów, znając organizację jako UUID w kolumnie, a nigdy jako
klasę.

## Rejestracja: trzy punkty rozszerzenia

Plik `backend.ts` modułu eksportuje `registerModule(ctx)`. Coś można umieścić w kontenerze na trzy
sposoby, a wybór niewłaściwego to najczęstsza uwaga w przeglądach kodu.

### `ctx.di.providePort(name, registration)` — port, którego jesteś właścicielem

Używaj go dla usługi, którą pobierają inne moduły. `providePort` opakowuje rejestrację
**przejściową blokadą**, która sprawdza stan efektywny modułu, więc gdy moduł jest wyłączony,
wywołujący dostaje odpowiedź 503 `MODULE_DISABLED`, a nie operację wykonaną do połowy.

```ts
ctx.di.providePort(
  'organizationRestrictionPort',
  ctx.asFunction(({ emFactory, auditLogService }: Cradle) =>
    new OrganizationRestrictionService(emFactory, auditLogService)).singleton(),
);
```

### `ctx.di.register({...})` — własne usługi i punkty wpięcia

Używaj go dla usług, które pobiera tylko twój moduł, oraz dla **punktów wpięcia** (contribution
points): nazw, którym nadajesz rozsądną wartość domyślną, a które composition root może nadpisać.

```ts
// Default: a composition with no outbound mail sends nothing, which is coherent.
cartAbandonmentNotifier: ctx.asFunction(() => undefined).singleton(),
```

Punkt wpięcia to punkt rozszerzenia **między composition root a modułem** i tylko to. Moduł nie
może zapisać nazwy należącej do innego modułu — `ctx.di.register` zajmuje każdy klucz, który
zapisuje, a jądro rzuca `DuplicateRegistrationError` przy drugim zapisie. Powód nie jest
techniczny: composition root leży poza grafem zależności manifestów i nie ma tablicy
`dependencies`, w której dałoby się zapisać krawędź, więc wkład composition root to jedyny zapis,
którego nie da się wyrazić jako portu. Krawędź moduł↔moduł zawsze się da, więc zawsze tak musi być.

**Ten punkt rozszerzenia działa w jedną stronę i jądro to egzekwuje.** Moduł nie może też zapisać
nazwy dostarczanej przez **composition root**: `ctx.di.register` i `ctx.di.providePort` rzucają
`ForeignRegistrationError` dla nazwy, która już jest w kontenerze, a nie została zajęta przez żaden
moduł. Ten zbiór jest wyprowadzany przy każdej kompozycji i nigdzie nie jest zapisany — nazwa bez
modułu-właściciela to nazwa zarejestrowana przez composition root — więc composition root, który
zaczyna lub przestaje ją dostarczać, zmienia odpowiedź w tym samym uruchomieniu. Zanim to
wprowadzono, `registerValues` nie zajmowało żadnych nazw, a `claim` rzucało wyjątek tylko dla
*innego modułu*, więc dowolny moduł mógł zarejestrować `commandBus`, stać się jego właścicielem i
odtąd legalnie go dekorować: reguła dekoracji była zamkiem w drzwiach frontowych domu z otwartymi
drzwiami bocznymi. Celowo nie ma tu wyjątku dla nakładki. Wdrożenie zmienia to, co otrzymuje się
pod nazwą dostarczaną przez composition root, przez `ctx.di.decorate` w swoim module nakładkowym,
dzięki czemu rdzeń nadal deleguje przez opakowanie; przejęcie nazwy wprost odcięłoby to od razu
wszystkim konsumentom, a zastąpienie musi być czynnością *bardziej* jawną.

### `lazyPort<T>(ctx, 'name')` — odczyt cudzego portu

**Nigdy nie zapisuj portu innego modułu w singletonie.** `providePort` zwraca przejściową
blokadę; tryb ścisły Awilix nie pozwala rejestracji o dłuższym czasie życia jej przechwycić i ma
rację — przechwycona blokada odpowiadałaby nadal po wyłączeniu modułu.

```ts
// Resolves on every forwarded method call, so the gate stays live.
pricingService: lazyPort<PricingService>(ctx, 'pricingService'),
```

**„Nie w singletonie” oznacza „nie podczas łączenia aplikacji”, bez wyjątków** — a dwa miejsca,
które wyglądają na zwolnione z tej reguły, wcale nie są. **Composition root** nie ma `ctx`, więc
nie może wywołać `lazyPort`, ale odczyt blokowanego portu na najwyższym poziomie `composeApp()` to
to samo zamrożenie o gorszych skutkach: odczyt następuje po `loadModulePresence()`, więc moduł
wyłączony przez operatora rzuca `ModuleDisabledError` z kompozycji, a `index.ts` zamienia to w
`process.exit(1)`. Następny start, który wykona operator, się nie powiedzie, a panel, w którym
mógłby to cofnąć, będzie niedostępny. Composition root odracza odczyt tak samo, jak robi to
`lifecycleManifestRegistry` — przez funkcję wywoływaną tam, gdzie wartość jest potrzebna:

```ts
// Not `container.cradle.searchReindexPort`: resolved when the reindex is asked for.
catalogSearchReindex: async () => searchCradle().searchReindexPort.reindexAll(),
```

Odroczenie to minimum, a nie cel. Jeśli to, co composition root odracza, jest **usługą, którą
mógłby zbudować moduł-właściciel**, odpowiedzią nie jest lepsza funkcja odraczająca, tylko
rejestracja usługi przez właściciela i przekazanie przez composition root wywołań do tej nazwy.
Każda usługa zbudowana w composition root jest nieblokowana, cokolwiek root z nią zrobi, więc
odpowiada nadal po wyłączeniu modułu, a dwa composition rooty prędzej czy później zbudują ją
nieco inaczej. Mierzy to `ROOT_MODULE_VALUE_IMPORTS`; liczba usług budowanych przez composition
root wynosi zero i tak ma zostać.

Drugim takim miejscem jest **treść `ctx.routes`**. `defineModuleRoutes` blokuje *żądania*; sama
rejestracja wykonuje się w `buildServer` niezależnie od stanu efektywnego modułu. Pobranie tam
własnego blokowanego portu pyta więc blokadę w trakcie łączenia aplikacji, a wyłączenie modułu
uniemożliwia start backendu, zamiast wyłączyć jego trasy. Pobieraj port przez `lazyPort` — wewnątrz
handlera blokada jest z założenia otwarta, więc nic innego się nie zmienia.

Oba przypadki były kiedyś obecne w drzewie; tę właściwość utrwala
`backend/test/integration/kernel/deactivated-boot.test.ts`.

Dwie kolejne reguły, które łatwo przeoczyć:

- **Nazwa musi być literałem tekstowym.** `backend/scripts/check-port-dependencies.ts` odczytuje
  je statycznie; zmienna albo funkcja pomocnicza `port(ctx, name)` ukrywa przed nim pobranie
  portu. Właśnie taka funkcja ukryła kiedyś czternaście pobrań portów, z których kilku nie
  rejestrował żaden composition root, a kontrola przechodziła bez uwag, podczas gdy przetwarzanie
  mediów po cichu nic nie wytwarzało.
- **Zadeklaruj zależność.** Jeśli twój moduł pobiera port należący do `X`, `X` musi być w twoim
  `manifest.dependencies`. Ta deklaracja sprawia, że krawędź istnieje dla cyklu życia, dla
  kolejności migracji i dla operatora, który wyłącza `X`. Bez niej kontrola portów przerywa build.

## Dwa kształty krawędzi moduł↔moduł

| Kształt | Kto pobiera | Blokowane? | Kiedy | Kiedy używać |
| --- | --- | --- | --- | --- |
| **Pobranie (pull)** — konsument pobiera port dostawcy | konsument | tak — `ctx.di.providePort` | przy każdym wywołaniu | konsument potrzebuje **odpowiedzi** |
| **Wkład przy starcie (push)** — moduł wnoszący wkład pobiera rejestr hosta w `ctx.onBoot` i wywołuje metodę dodającą | moduł wnoszący wkład | **nie** — `ctx.di.register` | raz | moduł musi dodać **deskryptor** do zbioru, który host przegląda |

Większość krawędzi to pobrania. Kształt „push” służy rejestrom — domyślnym e-mailom
transakcyjnym, rejestrom referencji, tabelom adapterów — w których moduł dodaje coś, co host
później przegląda.

**Rejestr wkładów nigdy nie jest blokowanym portem.** Reguła:

> Rejestracja, której cały kontrakt brzmi *„dodaj bierny deskryptor do tabeli, którą host później
> przegląda”*, to `ctx.di.register` i **nigdy** nie jest blokowana. Rejestracja, która w imieniu
> modułu-właściciela coś oblicza, rozstrzyga, odszyfrowuje, wysyła, obciąża lub zapisuje, to
> `providePort` i w razie wątpliwości odmawia.

Powód jest techniczny, a nie stylistyczny. Hooki startowe wykonują się niezależnie od stanu
efektywnego (zobacz regułę 4 niżej), a blokowany port rzuca `ModuleDisabledError` przy pobraniu —
więc zablokowanie rejestru oznacza, że hook startowy każdego wnoszącego wkład modułu rzuci wyjątek
w chwili, gdy operator wyłączy **host**, i platforma nie wystartuje. `transactional_emails` ma
siedmiu takich wnoszących, `cms` — jednego. Operator zepsuł następny start, korzystając z
przełącznika, do którego miał prawo, a błąd wskazywał moduł, którego nawet nie dotknął.
(`transactional_emails` zadeklarował się od tego czasu jako niewyłączalny, więc ten konkretny
przełącznik zniknął; reguła się nie zmieniła, `cms` nadal z niej korzysta, a rejestr pozostaje
nieblokowany, bo argument dotyczy kształtu punktu wpięcia, a nie tego, kto może wyłączyć host).
`check-port-dependencies.ts` odrzuca teraz ten kształt w obu miejscach, w których może zaszkodzić:
blokowany port pobierany w hooku `ctx.onBoot` i pobierany w treści `ctx.routes`.

Pozostawienie rejestru bez blokady niczego nie ujawnia, bo obie części da się rozdzielić:
`credentials` udostępnia swój `configurationTypeRegistry` bez ograniczeń, a `credentialsService` —
który odszyfrowuje — pozostaje portem; `transactional_emails` udostępnia `emailDefaultsPort`, a
`templateEmailPort`, który wysyła, pozostaje portem.

**Zamiast tego host odpowiada na pytanie o obecność — przy przeglądaniu wpisów.** To właściwe
miejsce: to, czy deskryptor ma działać, zależy od modułu, który go **wniósł**, a blokada na
rejestracji hosta w ogóle nie potrafi tego wyrazić. Każdy rejestr zapisuje więc przy każdym wpisie
identyfikator modułu, który go wniósł, i deklaruje — **osobno dla każdego rejestru** — czy wpis
jest respektowany, gdy jego właściciela nie ma. Domyślnie nie jest. Respektowanie wymaga
pisemnego uzasadnienia w klasie.

Uprawnione są dwie odpowiedzi, a która jest właściwa, zależy od tego, czym jest wpis:

- **Pomiń** — dla wkładów będących *elementami interfejsu*: interceptora, akcji palety poleceń,
  elementu storefrontu, grupy ustawień. Wyłączony moduł nie może dodawać niczego, co widzi
  użytkownik, więc `ctx.interceptors` zapisuje `module: id`, a wykonanie pomija wpisy, których
  właściciel nie jest włączony.
- **Respektuj** — dla wkładów chroniących *integralność danych*: rejestrów referencji, które
  blokują usunięcie. Wyłączony `blog` nadal jest właścicielem wpisów osadzających plik, a
  pominięcie jego skanera pozwoliłoby operatorowi usunąć plik, który po ponownym włączeniu `blog`
  okazałby się uszkodzony — utrata danych w wyniku działania, które reguła o modułach
  przełączanych przez operatora uznaje za odwracalne. `EmailDefaultsRegistry` respektuje wpisy z
  innego powodu, zapisanego w klasie: jego wiersze są tworzone na podstawie osi **platformy**, więc
  pominięcie nie usunęłoby wiersza, tylko utworzyłoby wiersz z pustym szablonem.

Wszystkie cztery rejestry przeniesione na tę regułę respektują wpisy, każdy z uzasadnieniem na
miejscu; zasady te utrwala `backend/test/unit/kernel/contribution-seams.test.ts`
(`emailDefaultsPort`, `assetReferenceRegistry`, `cmsReferenceRegistry`,
`megamenuReferenceRegistry`).

**Dwa kolejne rejestry deklarują zasadę przeciwną i są wzorcowym przykładem *pomijania*.**
`PaymentAdapterRegistry` i `ShippingAdapterRegistry` zapisują przy każdym wpisie moduł, który go
wniósł, i dzielą swoje API według tego, kto pyta: `get`, `resolve` i `list` filtrują według stanu
efektywnego właściciela — kupujący nigdy nie zobaczy metody płatności, która nie może przyjąć jego
pieniędzy, a `resolve` rzuca zwykły `ModuleDisabledError` — natomiast `entry`, `ownerOf`,
`isRegistered` i `listAll` celowo nie filtrują, bo ekran administracyjny nadal pokazuje wiersz
*oraz* powód, dla którego jest niedostępny. Wyłączenie modułu to nie jego odinstalowanie. Sprawdzanie
obecności jest wstrzykiwane w singletonie procesu (`payment_methods/services/registry-singleton.ts`),
a nie wbudowane w klasę, więc rejestr zbudowany przez test na własny użytek nadal odpowiada o
adapterach, które ten test zarejestrował.

Trzeci rejestr z tej rodziny, `gatewayRefundRegistry`
(`payments/services/gateway-refund-registry.js`), to wzorcowy przykład *innego sposobu podłączenia*
punktu wpięcia: `stripe`, `tpay`, `payu` i `autopay` **importują singleton** i dodają do niego swój
handler zwrotów, więc nie istnieje pobranie z kontenera, które mogłaby zobaczyć jakakolwiek
kontrola. Rejestr zapisuje teraz moduł, który wniósł wpis, i deklaruje **pomijanie**, a
uzasadnienie warto zachować, bo z tym argumentem spotyka się każda zasada dotycząca pieniędzy:
wyłączona bramka płatności nie może obciążać ani zwracać środków przez API swojego operatora
płatności, a pominięcie nie usuwa zobowiązania — `PaymentRefundProvider` zapisuje
`pending_manual`, wskazując wyłączony moduł, czyli dokładnie to, co dostaje wdrożenie, które nigdy
tej bramki nie zainstalowało. Sprawdzanie obecności jest podłączone w singletonie
(`payments/services/registry-singleton.ts`), a nie w klasie, z tego samego powodu co u bliźniaczego
rejestru: rejestr zbudowany przez test na własny użytek musi nadal odpowiadać o handlerach, które
ten test zarejestrował.

**Trzy kolejne przeniesiono później i nie dostały jednej odpowiedzi, bo „zadeklaruj zasadę” to
pytanie, a nie hurtowa zmiana.** `ConfigurationTypeRegistry` (`credentials`) deklaruje
**pomijanie**, z uzasadnieniem, które daje już kolumna „pomiń”: typ konfiguracji to to, co ekran
danych uwierzytelniających oferuje do skonfigurowania i względem czego walidowany jest zapis, więc
możliwość wyłączona przez operatora nie jest ani oferowana, ani możliwa do utworzenia, a `resolve`
rzuca `ModuleDisabledError` wskazujący moduł, który ją wniósł. Ten moduł był już zapisany —
deskryptor zawiera `ownerModule` — więc host znał identyfikator, tylko z niego nie korzystał. Podział
jest taki sam jak w rejestrach adapterów: `entry`, `ownerOf`, `isRegistered` i `listAll` pozostają
niewrażliwe na obecność, a korzystają z nich ścieżki, które *wyświetlają* zapisaną konfigurację, i
te, które usuwają z niej sekrety na potrzeby migawki audytu — te muszą nadal wiedzieć, które
wartości były sekretami. Sprawdzaniem obecności jest tu trójstanowe `effectiveState.presenceOf`, a
nie `isPresent`: ten rejestr to punkt rozszerzenia, przez który moduł nakładkowy lub zewnętrzny
dodaje typ, więc `ownerModule` może być stringiem, którego nie deklaruje żaden manifest, a
utożsamienie „nieznanego identyfikatora” z „nieobecnym” usunęłoby cały punkt rozszerzenia.

Dwa rejestry statusów zamówień — `payment_methods:paymentOrderStatusRegistry` i jego bliźniak w
`delivery_methods` — deklarują **respektowanie**, bo nie ma tu czego pomijać. Rejestr skutków
klasyfikuje je jako punkty wpięcia, bo `payments` i `shipments` odczytują je ponad granicą modułu,
ale żaden moduł niczego do nich nie dodaje: zbiór opcji to `orderStatusSchema`, ustalony w czasie
kompilacji. Odczyty są zabezpieczeniami, a nie elementami interfejsu — `has` jest wywoływane, zanim
zamówienie zostanie przeniesione do statusu wskazanego przez rozliczenie — więc pomijanie
zostawiłoby opłacone lub wysłane zamówienie po cichu w starym statusie, a każdy kod w tabeli to
status, w którym są już działające zamówienia. Ta zasada wynika ze struktury, a nie z obietnicy:
klasa nie przyjmuje żadnej informacji o obecności, więc nie da się sprawić, by jakikolwiek odczyt
pominął status, bez wcześniejszej zmiany zasady. To, co operator traci, wyłączając te moduły,
opisano tam, gdzie trzeba — każdy moduł zamyka swój katalog we własnym punkcie rozszerzenia, a
`orders` deklaruje zdanie, które wyświetli okno potwierdzenia.

## Rejestr skutków wyłączenia

Odmowa w chwili przełączenia modułu w cyklu życia zmienia się w świadome potwierdzenie, więc
platforma może ustabilizować się w stanie, w którym **obecny moduł zależy od nieobecnego**. Każdy
punkt styku między nimi potrzebuje wtedy odpowiedzi na pytanie „co się stanie?”, a operator
proszony o zaakceptowanie przełączenia potrzebuje tej samej odpowiedzi, z nazwami, zanim zmiana
zostanie zapisana. Dla obu celów istnieje jeden artefakt — i to jest jego sensem, a nie
oszczędnością: `lifecycle/services/deactivation-ledger.ts`.

`buildDeactivationLedger` przypisuje każdej krawędzi między modułami, której właściciela operator
może wyłączyć, jeden z czterech skutków:

| Skutek | Mechanizm |
| --- | --- |
| **odmowa (fails closed)** | odczyt blokowanego portu w chwili wywołania albo odczyt rejestru, którego host *pomija* wpis nieobecnego właściciela — wywołujący nic nie dostaje, czyli otrzymuje tę samą odpowiedź, tyle że przy przeglądaniu wpisów zamiast przy porcie. Ten sam skutek daje wpis modułu zależnego w jego `nonBindingDependencies` rodzaju `refuses-without`, który dodatkowo przekazuje zdanie dla operatora |
| **degradacja (degrades)** | wpis modułu zależnego w jego `nonBindingDependencies` rodzaju `degrades-without`; jego `whenAbsent` to zdanie wyświetlane operatorowi |
| **wkład (contributes)** | wkład wnoszony przy starcie do nieblokowanej tabeli, którą host filtruje, albo host, który celowo *respektuje* wpis nieobecnego właściciela |
| **tylko schemat (schema-only)** | krawędź `dependencies` bez żadnego odczytu z kontenera: wyłączenie nie usuwa tabel, więc klucz obcy pozostaje prawidłowy |

### `refuses-without` — powiedzieć „odmawia”, nie wiążąc operatora

Odmowa to skutek, który platforma wnioskuje, gdy blokowany port jest odczytywany w chwili wywołania
i nic o nim nie zadeklarowano. Do decyzji właściciela z 2026-08-25 był to też *jedyny* skutek,
którego moduł zależny nie mógł **wyrazić**: dwa sposoby zapisania „odczytuję to i nie mam
zastępstwa” to były `dependencies` i `acknowledgedDependencies`, a oba wiążą cykl życia. Dla modułu
zależnego, który sam deklaruje `activation.nonDeactivatable`, zamienia to przełącznik aktywacji
**właściciela** w martwy przełącznik — operator go przełącza, odmowa wskazuje moduł, który nigdy
nie zniknie, i nic się nie dzieje. Przełącznik, który kłamie, jest gorszy od obu alternatyw.

`nonBindingDependencies` ma więc trzeci rodzaj. `refuses-without` oznacza: operacja odpowiada 503
`MODULE_DISABLED`, reszta deklarującego modułu działa dalej, a przełącznik aktywacji właściciela
nadal działa. Jest klasyfikowany jako `fails-closed` — to samo zachowanie, które już daje blokada —
a jego `whenAbsent` jest tym, co okno potwierdzenia dla operatora wyświetli zamiast przetłumaczonego
domyślnego komunikatu platformy:

```
orders — unavailable: checkout cannot take an order, because no payment
method is available
```

Uczciwość tej deklaracji zapewniają trzy rzeczy i żadna z nich nie jest słowem autora:

- **Nazwa musi być rejestracją `di.providePort`.** Nieblokowana rejestracja dalej się rozwiązuje
  albo nie rozwiązuje się do niczego; w żadnym przypadku nic nie odmawia.
  `check-port-dependencies.ts` zgłasza wtedy `refusal-over-an-ungated-name` — lustrzane odbicie
  `contribution-over-a-gated-port` — a oba razem mówią jedną rzecz: pobranie, które może się nie
  udać, potrzebuje blokady, a bierny wkład nie może się za nią znajdować.
- **Deklarujący manifest nie może wiązać właściciela.** `dependencies` i
  `acknowledgedDependencies` są dokładnie tym, z czego `ModuleGatingGraph` buduje odmowę przy
  przełączeniu, więc wpis twierdzący, że przełącznik właściciela nadal działa, obok jednego z nich
  oznacza manifest, który mówi jednocześnie dwie sprzeczne rzeczy. Najpierw odrzuca to reguła
  `defineModuleManifest` „jedna krawędź, jedno stwierdzenie, w jednym miejscu”; kontrola
  wyprowadza ten sam fakt ponownie dla manifestu zbudowanego bez tej funkcji
  (`refusal-over-a-bound-owner`).
- **Wpis musi zawierać `whenAbsent`.** Bez niego wpis jest klasyfikowany dokładnie tak jak jego
  brak, więc zdanie to wszystko, co deklaracja daje (`refusal-without-a-sentence`).

Czwarta rzecz wynika ze struktury, a nie z kontroli: blokowany port pobierany przy starcie albo
podczas łączenia aplikacji to `gated-port-before-first-request`, który rejestr przypisuje **zanim**
sprawdzi jakąkolwiek deklarację, więc żaden wpis go nie uratuje.

Pisz to zdanie dla operatora, który je przeczyta — *co* odmawia, w kategoriach funkcji, nigdy
„port rzuca wyjątek”.

Krawędź, która nie dostała żadnego skutku, jest zgłaszana według kształtu, a
`check-port-dependencies.ts` przerywa wtedy build. Są trzy takie kształty, każdy oznacza
*przepuszczanie w razie wątpliwości* (fail-open), a nie odmowę: **przechwycona** rejestracja innego
modułu, odczytana raz przy konstrukcji i odpowiadająca już zawsze; odczyt **nieblokowanego
rejestru, którego właściciel nie zadeklarował zasady**; oraz **blokowany port pobrany przed
pierwszym żądaniem**. Krawędzie prowadzące do modułu, którego platforma nie pozwala wyłączyć, nie
mają żadnego wpisu — przełączenie nie może nastąpić, więc nie ma stanu do opisania.

`deactivationConsequencesFor` przekształca te same wpisy w wiersze widoczne dla operatora — i ta
część **nie została jeszcze** dostarczona. Dziś jej jedynym wywołującym jest
`check-port-dependencies.ts`, w czasie budowania; okno potwierdzenia i odpowiedź 409
`MODULE_DEACTIVATION_UNCONFIRMED` są jeszcze w przygotowaniu, a dzisiejsze okno to zwykłe
`window.confirm`, które podaje nazwę modułu i nic więcej
(`admin/src/modules/platform/ModuleActivationControl.tsx`). Ustalone z góry jest to, że będzie
**jedna** funkcja wywoływana przez oba miejsca, aby po ich wprowadzeniu zbiór identyfikatorów w
oknie i zbiór w `details.consequences` nie mogły się rozjechać: będą tym samym wyrażeniem
obliczonym dwa razy, a nie dwiema listami, które ktoś utrzymuje w zgodności. Dwa niezależne
obliczenia tego, „co przestanie działać”, rozjechałyby się, a to w CI byłoby kopią, której nikt nie
czyta — dlatego klasyfikacja krawędzi nie jest buchalterią dla CI nawet dziś. Pisz wpis dla
operatora, który go przeczyta, a nie dla kontroli.

Stały dług przechowują dwie tabele, obie działające w obie strony jak każdy inny rejestr w tym
repozytorium. `CONTRIBUTION_POLICY_STATED` wymienia rejestry, których host podjął decyzję, z tą
decyzją jako wartością, więc czytelnik nie musi otwierać klasy. `REGISTRY_POLICIES_UNSTATED`
wymienia te, które jeszcze nie podjęły decyzji, każdy z opisem, co by go usunęło z listy — a wpis
na tej liście usprawiedliwia **jeden** kształt dla **jednej** nazwy, bo przechwycenie tej samej
nazwy to inny błąd z inną poprawką.

**Nie obejmuj wywołania portu gołym `catch`.** `lazyPort` rozwiązuje port wewnątrz przekazanego
wywołania, więc `ModuleDisabledError` pojawia się w miejscu wywołania, a
`try { … } catch { return null }` po cichu zamienia odmowę w przepuszczanie. Tam, gdzie
degradacja naprawdę ma sens, umieść ją **wewnątrz implementacji właściciela** i wyraź w typie
zwracanym przez port — wzorcem jest `allowedIdsFor(): Promise<string[] | null>` zwracające `null`
jako „brak ograniczeń”.

**Ta reguła też jest egzekwowana**, przez `backend/scripts/check-port-catches.ts`. Warto wiedzieć,
co znalazł przegląd, który ją uruchomił, bo trzy rodzaje, które rozróżnia, to trzy odpowiedzi na
uwagę w przeglądzie kodu dotyczącą `catch`. Spośród 51 bloków `try` sięgających do blokowanego
portu 27 już rzucało wyjątek dalej, a 24 nie, i te 24 to były:

- **zabezpieczenia na wszelki wypadek** — `catch` wokół portu, którego typ zwracany *już* mówi
  „nic nie ma zastosowania”. `resolveLinePrice` zwraca `null`; `taxRateFor` zwraca
  `{ source: 'none' }` (wariant bez stawki — `rate: 0`, przez które dało się to odczytać jako
  odpowiedź, już zniknęło); `applyToCart` zwraca `discountTotal: 0`. `catch` nie dawał nic poza
  możliwością ukrycia odpowiedzi 503, a jeden z nich zapisywał ukrytą odpowiedź w pamięci
  podręcznej z TTL, więc powrót `price_lists` jej nie kończył. **Usuń go.**
- **degradacja, która należy do właściciela** — zobacz akapit wyżej.
- **wąska, poprawna tolerancja** — błąd importu pojedynczej pozycji zapisany jako problem,
  sprzątanie kompensujące na ścieżce wycofania, podpowiedź w wyszukiwarce, która degraduje się do
  zwykłego podsumowania. Takie miejsca zachowują `catch` i dodają `rethrowIfModuleDisabled(error)`
  jako pierwszy wiersz. Powód: odpowiedź o obecności dotyczy **całej operacji**, nigdy jednej
  pozycji. `pim_ergonode` zgłaszał kiedyś każdy atrybut, wariant, obraz i relację ze źródła jako
  osobno uszkodzone i kończył przebieg „sukcesem”, podczas gdy jedynym prawdziwym zdaniem było to,
  że `catalog` został wyłączony.

Zachowany `catch` mówi w komentarzu, dlaczego istnieje, a „na wszelki wypadek” nie jest
uzasadnieniem.

Kontrola jawnie rozstrzyga dwa szczegóły. **Warunkowe** rzucenie wyjątku dalej
(`catch (e) { if (rare) throw e; }`) jest naruszeniem: `ModuleDisabledError` dziedziczy po
`HttpError`, więc test `statusCode === 409` przepuszcza go przypadkiem, a nie z decyzji. A
**funkcja wywoływana przez timer** w ogóle nie może rzucić wyjątku dalej — zamiast tego przed
rozpoczęciem pyta `effectiveState.isPresent`, dzięki czemu jej `catch` może zapisywać w logu
prawdziwe błędy, które inaczej zniknęłyby obok odpowiedzi o obecności.

Jedną rzecz kontrola celowo dopuszcza: `catch` może przekazać błąd **funkcji, która rzuci go
dalej** — funkcji pomocniczej kończącej się `throw <its own parameter>`
(`toCatalogHttpError(…): never`) albo takiej, która w imieniu wywołującego wykonuje zawężenie
(`ReturnEmailNotifier#contained`). W drzewie jest osiem takich miejsc i wszystkie są poprawne.

### Co widzi kontrola

Reguła dotyczy `catch`; martwe punkty dotyczyły tego, **jak port trafia na miejsce**. Oba poniższe
przypadki przez miesiące przechodziły bez uwag:

- `catch` wokół **obiektu przechowującego** port, a nie wokół jego pobrania —
  `new CartPricingRecompute(em, lazyPort(ctx, 'pricingService'), cache)`, wywoływane później jako
  `deps.cartPricingRecompute.recompute(…)`. Trzy takie miejsca obsługiwały `GET /api/v1/cart` i przy
  wyłączonym `price_lists` wyświetlały pełny koszyk z cenami z nieaktualnych migawek;
- port **wnoszony przez composition root** —
  `registerValues(container, { shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor() })`,
  pobierany przez moduł jako zwykła nazwa z kontenera, bez literału `lazyPort` gdziekolwiek na tej
  ścieżce. Z tego powodu pięć modułów wysyłających powiadomienia e-mail było niewidocznych, a
  licznik pokazywał `catches=42 violations=0` zarówno przed ich naprawą, jak i po niej.

To jeden błąd i zamyka go jeden mechanizm: tabela aliasów jest **punktem stałym po wartościach
niosących port**, a nie wyszukiwaniem literałów `lazyPort`. Wartość niesie blokadę, jeśli jest
pobraniem portu, jeśli została z niego zbudowana, jeśli przekazano ją do fabryki albo jeśli jest
domknięciem, którego treść go odczytuje; każda nazwa, z którą taka wartość jest powiązana, staje się
aliasem, a to zasila kolejną rundę. Obiekt przechowujący to jedna runda tej pętli, a klucz
rejestracji composition root — kolejna. Po rozszerzeniu wynik dla drzewa zmienił się z
`catches=42 violations=0` na `catches=94 violations=24`.

Równie istotne jest to, co **nie** niesie blokady, a każde wyłączenie zostało okupione fałszywymi
alarmami: **wynik** wywołania (`proxy.applyToCart(…)` to blokowane wywołanie, a zwracany rabat to
dane), **literał obiektu** (worek zależności to rekord — oznaczenie go sprawiało, że każde
`this.deps.<anything>()` było wywołaniem portu, 39 razy w jednym przebiegu) oraz **pole odczytane z
portu**. Uruchom z `PORT_CATCH_WHY=1`, aby zobaczyć każdy alias wraz z miejscem, które go
wprowadziło.

**Alias jest widoczny tam, gdzie jest jego wiązanie, i nigdzie indziej.** `const` ma zasięg pliku,
bo taki ma w kodzie. **Klucz obiektu zależności** ma zasięg modułu, bo klasa, która go otrzymuje,
odczytuje go jako `this.deps.<key>` w innym pliku, a nazwa właściwości nie jest wiązaniem
leksykalnym, które ktokolwiek mógłby przesłonić. **Parametr konstruktora lub funkcji** ma zasięg
pliku, który go *deklaruje* — kiedyś miał zasięg modułu, w którym leżało wywołanie, czyli ani
miejsca, w którym parametr jest widoczny, ani — gdy wywoływana funkcja jest w innym module —
miejsca, z którego w ogóle można go odczytać. Rejestracja w kontenerze wykonana przez composition
root jest widoczna wszędzie, bo nazwa w kontenerze jest z definicji globalna.

Koszt pomyłki w tej sprawie zmierzono i nie jest to szum. Przy budowie `orderTransitionPort` autor
nazwał parametr konstruktora `transitionService`; niezwiązana zmienna lokalna o tej samej nazwie w
`orders/prompt-tools.ts` stała się zgłaszanym naruszeniem bez żadnej zmiany we własnym kodzie, a
autor usunął zgłoszenie, zmieniając nazwę parametru. Ta zmiana nazwy ukryła `catch`, który
naprawdę przepuszcza w razie wątpliwości — `OrderTransitionService.apply` zatwierdza zmianę
statusu, a potem wykonuje hook skutków ubocznych sięgający do portu zwalniania limitu w
`credit_limits`, więc masowa zmiana statusu zgłaszała `failed` dla zamówień, których status już się
zmienił. **Fałszywy alarm, który autor może usunąć tylko zmieniając nazwę czegoś innego, nie tylko
dodaje szumu; on przesuwa kod.** W `pim_ergonode` były jeszcze dwa przypadki dokładnie tego
kształtu i zniknęły razem z poprawką: parametr `walkStream(…, handle)` przejmujący niezwiązaną
właściwość kontenera w `backend.ts` oraz parametr `categoryPathOf(id, byId)` przejmujący lokalne
`new Map(…)` w mechanizmie uzgadniania harmonogramu. Ten drugi miał nawet wpis w rejestrze.

Ponadto **sam identyfikator rozwiązuje się leksykalnie**: bliższe wiązanie, które *w oczywisty
sposób* nie przechowuje portu — literał, obiekt lub tablica bez portów, `new` z takimi argumentami
— przesłania szerszy alias. Kluczowe jest słowo „w oczywisty sposób”. Analiza przenoszenia celowo
zaniża wynik, więc odpowiedź „nie” z `carries` oznacza albo „to nie port”, albo „nie umiem tego
prześledzić”, a przesłaniać może tylko to pierwsze: `catalog` wiąże
`const customFields = this.#requireCustomFields()`, co przechowuje blokowany port `custom_fields`
przez wywołanie, którego analiza nie śledzi, a potraktowanie tego jako przesłonięcia usunęło ze
zbioru sześć miejsc z `catch`. Wywołanie, identyfikator, dostęp do właściwości, domknięcie,
wiązanie przez destrukturyzację, import, zmienna `catch` i parametr bez wartości domyślnej niczego
więc nie przesłaniają — w razie wątpliwości „zgłoś”.

**Stara reguła miała argument bezpieczeństwa i obowiązuje on tam, gdzie naprawdę go
sformułowano.** Dotyczył tabeli `gatesOf` — łączenia *blokad* po nazwie, które może tylko dodawać
właścicieli, a więc tylko utrudniać spełnienie `OWNER LOCKED`. Ta tabela jest nietknięta, a
`gatesIn` z tego samego powodu celowo ignoruje przesłanianie. Tego argumentu nigdy nie
sformułowano w odniesieniu do **widoczności** aliasów i nie da się go na nią przenieść: szerszy
alias nie dodaje właścicieli do miejsca, tylko wymyśla miejsce.

`PORT_CATCHES_TO_DRAIN` zawiera miejsca, w których pochłonięcie odpowiedzi jest nadal najmniej złym
zachowaniem, każde z uzasadnieniem, w trzech kształtach nazwanych przez wpisy:

- **po fakcie** — chronione wywołanie wykonuje się, gdy operacja, do której należy, jest już
  zatwierdzona (scalenie koszyka po udanym logowaniu, ewidencja dostarczania webhooków). Rzucenie
  wyjątku dalej zgłosiłoby błąd pracy, która się udała, a przy ponowieniu wykonałoby ją jeszcze
  raz. Wpis dotyczący webhooków jest **stały** i mówi to wprost: to krawędź do samego siebie,
  jedyna możliwa odpowiedź o obecności to przełączenie *między* próbą HTTP a zapisem, a obie
  alternatywy — podwójne dostarczenie albo sprawdzenie wykonane przed przełączeniem — są gorsze;
- **degradacja, za którą powinien odpowiadać właściciel** — wywołujący słusznie działa dalej bez
  modułu, więc `rethrowIfModuleDisabled` byłoby *złą* poprawką. Odpowiedź należy do typu
  zwracanego przez wkład albo do wpisu `nonBindingDependencies`, i wszystkie trzy wpisy o tym
  kształcie zostały tam przeniesione: powiadomienie w panelu zwraca `'recorded' | 'not-present'`
  z mechanizmu zapisu, który rozstrzyga obecność przed blokadą, dostępność w katalogu to
  zadeklarowana krawędź `degrades-without` sprawdzana we wkładzie, który ją rozwiązuje, a listowanie
  z Meilisearch przechodzi na Postgresa, bo `useMeili` pyta przed zapytaniem, zamiast łapać wyjątek
  po nim;
- **hook startowy** — odpowiedź o obecności nie ma do kogo trafić, więc jest *rozstrzygana* na
  początku hooka, jako pierwsza i poza każdym `try`. Poza, bo `runBootHooks` **nie** łapie
  wyjątków — rzuca je dalej, więc `ModuleDisabledError` rzucony w środku albo przerwałby start,
  albo dzieliłby jedno ciche „nic nie rób” z przejściowym błędem (zobacz *Faza startu rzuca
  wyjątki dalej* niżej; ten punkt mówił kiedyś coś przeciwnego). `product_feeds` i `pim_ergonode`
  tak właśnie uzgadniają swoje harmonogramy; w rejestrze zostaje `catch` pod sprawdzeniem, który
  pochłania zwykły błąd, aby niemożliwe do uruchomienia API nigdy nie kosztowało więcej niż
  rozjechany harmonogram — próbowano zawęzić oba do rzucania dalej i wycofano to, bo zmieniało, z
  czym startuje środowisko testowe. Hook, który **wnosi wkład** — deskryptor dodawany do rejestru
  hosta filtrującego według obecności właściciela — nie dostaje sprawdzenia, bo oznaczałoby to, że
  moduł włączony w czasie działania nie wnosiłby niczego aż do następnego restartu.

Czwarta odpowiedź jest **wyprowadzana, a nie pisana**: gdy każda blokada niesiona przez alias w
danym miejscu należy do modułu, którego manifest deklaruje `activation.nonDeactivatable`, kontrola
zgłasza to miejsce jako `OWNER LOCKED`, a wpis w rejestrze dla niego staje się nieaktualny. `catch`
nadal tam jest i nadal jest nazwany — nadal pochłania wszystkie inne błędy — ale nie ma odpowiedzi
o obecności, która mogłaby do niego dotrzeć, więc nie ma czego usuwać. Sens tkwi w obliczaniu tego
z manifestów przy każdym uruchomieniu: właściciel, który odblokuje moduł, w tym samym przebiegu i
bez zmiany rejestru ponownie oznacza na czerwono każde miejsce, które opierało się na tej blokadzie,
podczas gdy ręcznie wpisane „zablokowane” w uzasadnieniu po cichu by się zdezaktualizowało.

## Zakres żądania

Stan związany z żądaniem znajduje się w zakresie jądra (`scope.ts`), dostępnym w trakcie żądania
przez `ctx.cradle<C>()`. Jest **deklarowany, a nie pobierany z otoczenia**: usługa dostaje to,
czego potrzebuje, zamiast pytać o to środowisko uruchomieniowe.

To celowe odwrócenie wcześniejszego podejścia. Drzewo udostępniało kiedyś `getEm()` oparte na
`RequestContext` z MikroORM, czyli wyszukiwaniu opartym na `AsyncLocalStorage`: usługa dostawała
EntityManager żądania, pytając o niego środowisko, więc to, do czego miała dostęp, było
niewidoczne w jej sygnaturze i nie dawało się przetestować bez działającego zakresu żądania. Dziś
każdy moduł przyjmuje jawne `emFactory`, a `getEm()` zostało usunięte, więc ta właściwość wynika z
samej konstrukcji.

`enterSystemScope(reason, fn, { entryPoint })` to punkt rozszerzenia dla pracy, za którą nie stoi
żadne żądanie — uzgadniania przy starcie, punktów wejścia CLI, workerów. Istnieje po to, by
zapytania do danych objętych izolacją tenantów miały jawne, audytowalne obejście, a nie ukryte.

## `ctx.log` — dokąd trafia wpis w logu modułu

`ctx.log` to własny logger platformy, powiązany z modułem. Każdy zapisany przez niego wiersz
zawiera `module: '<your module id>'`, a jeśli powstaje w trakcie żądania — także `reqId`, i autor
nie musi podawać żadnego z nich.

Kiedyś nie było ani jednego, ani drugiego. Miejsce docelowe wybiera composition root, kompozycja
odbywa się przed `buildServer`, więc każdy composition root przekazywał to, co był w stanie wskazać
na tak wczesnym etapie: `composition.ts` przekazywał globalne `console`, a środowisko testowe —
logger, który nic nie robił. Ostrzeżenie modułu było więc nieustrukturyzowane, niepowiązane z
żądaniem, które je spowodowało, i poza strumieniem pino, który zbiera wdrożenie — a oba composition
rooty nie zgadzały się nawet co do tego, który z tych dwóch braków to jest, czyli był to dokładnie
ten rodzaj rozjazdu, dla którego istnieje `harness-parity.test.ts`.

Oba composition rooty przekazują teraz `platformLogger()`, który jest **wiązany późno**: odczytuje
miejsce docelowe przy każdym wierszu, zamiast je zapamiętywać. `buildServer` podłącza własną
instancję pino aplikacji w chwili, gdy ona powstaje, i odłącza ją w `onClose`. To jedno miejsce
podłączenia dla wszystkich czterech punktów wejścia — `index.ts`, `worker.ts` (który buduje serwer,
choć nigdy nie nasłuchuje, właśnie po to, by zarejestrowały się pluginy modułów), środowiska
testowego i środowiska uruchomieniowego nakładki — więc żaden composition root nie może o nim
zapomnieć i oba nie mogą się w tej kwestii ponownie rozjechać.

Identyfikator żądania jest odczytywany z `requestMeta` zakresu platformy, a nie z `request.log`.
`request.log` w Fastify to `app.log.child({ reqId })` i nic więcej, więc wiersz zawierający `reqId`
łączy się z własnymi wierszami `req`/`res` Fastify dokładnie tak samo; odczyt identyfikatora z
zakresu daje powiązanie na dowolnej głębokości wywołań bez przekazywania `request`, a — co
najważniejsze — **niczego nie przetrzymuje**, podczas gdy zapamiętanie żądania w zakresie
trzymałoby je tak długo, jak żyje dowolny zasób asynchroniczny utworzony w tym zakresie (zobacz
uwagi o przetrzymywaniu w `scope.ts`).

**Poza żądaniem nie ma identyfikatora żądania, a wiersz i tak zostaje zapisany.** Hook startowy
wykonuje się w obu composition rootach przed `buildServer`, więc trafia do zastępczego `console` —
tam, gdzie zawsze trafiały wiersze ze startu i gdzie odczytuje się błędy startu. Worker, timer
albo subskrybent `EventBus` działa po zbudowaniu aplikacji, więc trafia do instancji pino
aplikacji. Proces, który składa moduły, ale nie buduje serwera, też trafia do wersji zastępczej.
Wersja zastępcza naprawdę zapisuje i nigdy nie jest pustą operacją: zamiana nieustrukturyzowanego
wiersza na zgubiony byłaby gorszą platformą niż ta, którą to zastąpiło.

Można więc bezpiecznie przechowywać `ctx.log`. Cztery moduły przekazują go usłudze, która trzyma go
przez cały czas życia procesu (`invoices`, `payments`, `pwa`, `shipments`), a zarówno miejsce
docelowe, jak i powiązanie z żądaniem są odczytywane przy każdym wierszu.

## Kolejność kompozycji — przeczytaj, zanim napiszesz hook startowy

Kompozycja wykonuje się w **jednym przebiegu** po wygenerowanej liście modułów, a każdy hook
startowy wykonuje się raz, po wszystkich rejestracjach i wszystkich wkładach composition root:

```
load module presence                 (PostgreSQL, awaited, fatal)
composeModules(MODULES)              (one call; registration resolves nothing)
…all root contributions…             (composedModules.contribute, bridges, eager reads)
runBootHooks()                       (once, after every contribution)
the Fastify app is built             (plugin bodies run)
registryCache.watch()                (Redis, non-fatal)
```

Kiedyś były dwa przebiegi, rozdzielone listą `EARLY_PASS_MODULE_IDS`, aby ręcznie podłączony kod
modułów w composition root mógł znaleźć się *między* nimi. W żadnym composition root nie ma już
ręcznie podłączonego kodu modułów, a to, co ten podział jeszcze dawał, zmierzono: 13 z 26 jego
elementów nie było przez nic wymuszonych, a powód związany z kolejnością tras, podany w jego
nagłówku, był fałszywy (główny hook `onRequest` dodany przez plugin `fastify-plugin` zarejestrowany
*po* hermetycznym pluginie potomnym i tak wykonuje się dla tras tego potomka). Jeden przebieg
spełnia naraz wszystkie ograniczenia kolejności dla wszystkich modułów, czego nie potrafi żaden
podział zbioru modułów, więc `composition-passes.ts` usunięto.

Cztery konsekwencje, w kolejności, w jakiej dają o sobie znać:

**0. Obecność modułów jest wczytywana, zanim zarejestruje się pierwszy moduł.**
`loadModulePresence()` wykonuje się jako krok kompozycji w `composeApp()`, bo każda blokada dalej —
pobranie portu w hooku startowym, decyzja `defineModuleWorker` o wstrzymaniu, handler
`subscribeForModule` — pyta tę samą pamięć podręczną, a większość pyta, zanim powstanie
jakakolwiek trasa HTTP. Wczytywanie odbywało się kiedyś w treści pluginu `_lifecycle`, czyli wewnątrz
`buildServer`, po wszystkim, co pokazuje powyższy schemat: pamięć podręczna odpowiadała „nie
zainstalowany” dla każdego modułu i backend się nie uruchamiał.

Dwie części celowo różnego rodzaju. **Wczytanie** czyta PostgreSQL, jest oczekiwane i jego błąd
jest krytyczny — `initOrm()` i tak czyni dostępną bazę danych warunkiem startu, więc nie dodaje to
nowego sposobu awarii. **Obserwowanie** subskrybuje kanał powiadomień w Redis, jest włączane po
kompozycji i nigdy nie może przerwać startu: jego utrata oznacza *nieaktualne dane*, a PostgreSQL —
źródło prawdy — nadal jest dostępny.

Odczyt obecności przed wczytaniem rzuca `ModulePresenceNotLoadedError`. To nie jest żadna z dwóch
odpowiedzi: `false` to dokładnie to, co położyło platformę, a `true` uruchomiłoby pracę wyłączonego
modułu.

**1. Hook startowy może pobrać cokolwiek.** Gdy wykonuje się pierwszy hook, wszystkie moduły są już
zarejestrowane, więc `ctx.onBoot` ma dostęp do każdej rejestracji i każdego wkładu composition
root. Kolejność rejestracji z założenia nie ma znaczenia: `composeModules` ustawia
`registering = true` na czas całego wywołania (`kernel/compose.ts`), a `ctx.cradle()` odmawia
pobierania, dopóki ta flaga jest ustawiona, więc moduł nie może zaobserwować, które moduły
zarejestrowały się przed nim. Jeśli wydaje ci się, że twoje `registerModule` potrzebuje wartości w
chwili rejestracji — to nie potrzebuje: pobierz ją leniwie (`lazyPort`, getter albo kontener w
miejscu użycia).

**2. Hooki startowe wykonują się przed treścią każdego pluginu.** Treści pluginów wykonują się
podczas budowania aplikacji Fastify, po `runBootHooks()`. Wkład wnoszony przy starcie zawsze trafia
więc do hosta, zanim ten wykona uzgadnianie w treści swojego pluginu — z założenia, a nie
szczęśliwym trafem.

**3. Wkład composition root ma dokładnie jedno dozwolone miejsce**: po
`composeModules(MODULES, …)`, a przed `runBootHooks()`. Wcześniej — nadpisze go wartość domyślna
modułu, bo `registerValues` to zwykłe `container.register` bez rejestru właścicieli, więc wygrywa
ostatni zapis; później — hook startowy mógł już odczytać wartość domyślną. To okno ma znaczenie
tylko dla wartości odczytywanych *przy konstrukcji*; to, co odczytuje się przy każdym żądaniu lub
wywołaniu, jest na nie niewrażliwe — ale nie polegaj na tym, nie mówiąc tego wprost. **Wartość
hosta**, której żaden moduł nie ustawia domyślnie (`redis`, `eventBus`, `commandBus`,
`auditLogService`, flagi `*RunWorkers`), nie ma takiego okna i jest rejestrowana tam, gdzie powstaje.

To miejsce jest **metodą**, a nie konwencją: `composeModules` zwraca `ComposedModules`, a wkład to
`composedModules.contribute({ name: value })`. Obie granice okna wynikają z kształtu, a nie z
pamięci czytelnika — wczesna, bo dopóki wszystkie moduły się nie zarejestrują, nie ma obiektu, na
którym można by ją wywołać; późna, bo `runBootHooks()` zamyka okno, a późniejsze wywołanie rzuca
`ContributionWindowClosedError` cytujący tę regułę. Okno zamyka się na *początku* fazy startu, a
nie na jej końcu: hooki wykonują się w kolejności rejestracji, więc wkład wniesiony z wnętrza
jednego z nich jest już niewidoczny dla wszystkich hooków wykonanych wcześniej. Zapis
`registerValues(container, …)` po `composeModules` po cichu otworzyłby okno ponownie, więc
`test/contract/kernel/harness-parity.test.ts` odrzuca go w obu composition rootach — przed
wywołaniem pozostaje poprawny i tam właśnie należy wartość hosta.

**4. Hooki startowe wykonują się niezależnie od stanu efektywnego.** `runBootHooks()` nie sprawdza
obecności modułów, więc hook wyłączonego modułu też się wykonuje. Wynikają z tego dwie
konsekwencje, a druga była tu kiedyś opisana zbyt wąsko.

Nigdy nie pobieraj **blokowanego portu** w hooku startowym: blokada ma w tym momencie prawdziwą
odpowiedź „nie”, a udzielenie jej przerywa start. Jeśli ta nazwa to rejestr wkładów, w ogóle nie
powinna być portem — zobacz regułę dotyczącą rejestrów wkładów wyżej.

Jeśli twój hook dodaje deskryptor do rejestru innego modułu, o tym, czy wpis jest aktywny,
decyduje **host** — przy przeglądaniu wpisów, na podstawie zapisanego identyfikatora modułu, który
go wniósł. „Host musi filtrować” to jedna z dwóch poprawnych odpowiedzi, a nie reguła: *pomijanie*
pasuje do wkładów będących elementami interfejsu — tak jak `ctx.interceptors` zapisuje
`module: id`, a wykonanie pomija wpisy, których właściciel nie jest włączony — a *respektowanie* do
wkładów chroniących integralność danych, gdzie pominięcie pozwoliłoby po cichu osierocić dane
nieobecnego modułu. Zadeklaruj, którą wybierasz, osobno dla każdego rejestru, z uzasadnieniem.

### Faza startu rzuca wyjątki dalej

`runBootHooks` opakowuje każdy hook, przypisuje błąd modułowi, który go zarejestrował, i **rzuca go
dalej**:

<!-- verbatim-from: packages/platform/src/kernel/compose.ts -->

```ts
try {
  await hook();
} catch (err) {
  if (alreadyNamesTheModule(err)) throw err;
  throw new ModuleCompositionError(moduleId, 'boot', err);
}
```

Dokumentacja przez miesiące twierdziła coś przeciwnego — ta strona w dwóch miejscach i rejestr
`check-port-catches.ts` — a to twierdzenie miało realne skutki: dwa miejsca w hookach startowych
zapisano w rejestrze zamiast je naprawić, w przekonaniu, że jądro centralnie pochłania wyjątki.
Dlatego powyższy blok jest cytatem, a nie opisem; `check:doc-snippets` przerywa build tej strony,
jeśli przestanie zgadzać się ze źródłem.

Rzucanie dalej to zachowanie przyjęte decyzją. Hook startowy wykonuje się podczas kompozycji,
zanim powstanie aplikacja Fastify: nie ma żądania, na które trzeba odpowiedzieć, ani okrojonej
funkcjonalności, którą można by udostępnić, więc pochłonięty błąd oznaczałby, że platforma startuje
z kompozycją inną niż ta, którą opisuje kod — bez adaptera płatności, bez zarejestrowanego skanera
referencji do plików, bez domyślnego e-maila, którego nikt nie dodał — i nic o tym nie mówi.
`index.ts` zamienia wyjątek w `process.exit(1)`, a `test/integration/kernel/boot-failure.test.ts`
utrwala obie części: błąd wskazuje moduł i fazę, a częściowo złożony serwer nigdy nie zaczyna
nasłuchiwać.

Zagrożenie, które przemawiałoby za łapaniem wyjątków — moduł wyłączony przez operatora, który
pociąga za sobą start — jest wyeliminowane strukturalnie, a nie przez `catch`. Blokowany port
pobierany w hooku startowym jest odrzucany przez `check:port-dependencies`
(`gated-port-at-boot`), a każdy rejestr wkładów pozostaje z tego samego powodu nieblokowanym
`ctx.di.register`, więc operator przełączający moduł nie może spowodować `ModuleDisabledError`
podczas kompozycji. Zostaje hook, którego własna praca się nie udaje, czyli prawdziwy błąd; moduł,
który chce węższej tolerancji, implementuje ją **wewnątrz** własnego hooka i uzasadnia, tak jak robi
to funkcja pomocnicza `reconcile` w `product_feeds`. Ta funkcja nie powtarza decyzji jądra — to
jedyne, co stoi między rozjechanym harmonogramem a nieudanym startem.

### Kompozycja bez wymaganego modułu nie dochodzi do fazy startu

`activation.nonDeactivatable` chroni przed **wycofaniem**: mechanizm cyklu życia odmawia wyłączenia
lub odinstalowania modułu, który to deklaruje, zarówno miękkiego, jak i twardego, bez `--force`.
Późniejsza reguła dodała dwa **stany początkowe**, które widać w analizie manifestów — moduł,
którego to wdrożenie nigdy nie dostarczyło, a który wskazuje inny manifest, oraz moduł z wierszem
w `module_registrations`, którego mechanizm uzgadniania przy starcie nie naprawi — i odrzuca oba w
`loadModulePresence`, zanim zostanie odczytany rejestr.

Żadna z tych reguł nie widziała stanu, który naprawdę psuje pierwszy start. `invoices` przenosi
swój dotychczasowy wzorzec numeracji w hooku `ctx.onBoot`, którego zapis przechodzi przez port
`settings`, a `NumberingConfigurationService` celowo rzuca `ModuleDisabledError` dalej — zapis to
cały sens tego hooka. Platforma bez `settings` nie degradowała się więc, tylko kończyła działanie z
komunikatem:

```
[kernel] module 'invoices' failed in its boot hook: Module 'settings' is currently disabled.
```

Niewłaściwy moduł i żadnej wskazówki, jak to naprawić. Nikt wcześniej tego nie widział, bo w każdej
bazie, na której platforma choć raz wystartowała, zapis przeniesienia już się odbył i hook nie ma
nic do zrobienia; do portu dociera tylko naprawdę pierwszy start.

Właściciel zdecydował, że `settings` jest zbyt ważny, by mogło go zabraknąć we wdrożeniu, więc
rozwiązaniem jest uczynienie jego braku niemożliwym, a nie nauczenie `invoices` tolerowania go.
`composeModules` odmawia **zanim zarejestruje się pierwszy moduł**, gdy brakuje modułu wymaganego
przez kompozycję:

- zbiór wymaganych modułów to `requiredModulesFrom(manifests)`, wyprowadzany przez każdy
  composition root z manifestów, które składa, i przekazywany do mechanizmu kompozycji jako dane —
  mechanizm kompozycji dostaje trzy pola dla każdego modułu i nie może czytać manifestów. Nigdzie
  nie ma listy, więc zdjęcie blokady zmienia tę odmowę w tym samym przebiegu;
- **„wymagany do instalacji” i „nie da się wyłączyć” to ten sam zbiór, z wyprowadzenia i z
  decyzji.** Manifest nie potrzebuje drugiego pola: autor, który napisał *„platforma nie działa bez
  tego”*, odpowiedział jednym zdaniem na oba pytania i właśnie to zdanie wypisuje odmowa;
- dwa rodzaje zgłoszeń, bo mają różne rozwiązania. `absent` oznacza, że moduł został złożony, a
  obecność mówi co innego → `module:enable <id>`. `not-composed` oznacza, że manifesty go deklarują,
  a nic go nie zarejestrowało → lista złożonych modułów nie zgadza się z indeksem manifestów, więc
  trzeba uruchomić `composer:generate` i zbudować ponownie. Drugi przypadek widzi tylko mechanizm
  kompozycji: `loadModulePresence` wykonuje się, zanim zarejestruje się pierwszy moduł, więc
  rozbieżne indeks manifestów i lista złożonych modułów oba wyglądają dla niego poprawnie.

Na jednej deklaracji w manifeście opierają się teraz trzy odmowy, a reguła domykająca utrzymuje je
jako trzy — *„dzielą deklarację i nic więcej: ani miejsca wywołania, ani typu błędu, ani
komunikatu”*. `assertDeactivatable` odrzuca **przejście, o które poprosił operator**, i odpowiada
na nie odpowiedzią HTTP; `assertLockedModulesPresent` odrzuca **źle złożone wdrożenie**, na
podstawie manifestów, zanim dotknie bazy danych; `assertRequiredModulesPresent` odrzuca
**kompozycję, która doszłaby do fazy startu bez wymaganego modułu**, na podstawie tego, co
faktycznie zostało zarejestrowane i co faktycznie mówi obecność.

Jedyny brak, którego nie widzi, to ten: moduł, który w ogóle nie został dostarczony, zabiera ze
sobą swój manifest, więc na pytanie *„czy był zablokowany?”* nie ma w tym miejscu odpowiedzi. Ten
przypadek pozostaje w gestii `assertLockedModulesPresent`, który pyta o to deklaracje modułów, które
zostały.

`test/integration/kernel/required-module-absent.test.ts` składa produkcyjny composition root z
`settings` wycofanym na osi platformy i utrwala zdanie, które przeczyta źle zbudowane wdrożenie;
`test/integration/kernel/deactivated-boot.test.ts` jest jego lustrzanym odbiciem i nie wycofuje już
zablokowanego modułu, bo ten stan jest teraz z założenia odrzucany.

### Jedyna rzecz, którą composition root nadal musi zrobić we właściwej kolejności

`EventBus.dispatch` czeka na swoje handlery w **kolejności rejestracji**, więc
`composeSalesChannelsKernel` — który podłącza unieważnianie pamięci podręcznej kanałów sprzedaży —
jest w obu composition rootach składany **przed** `composeModules(MODULES, …)`. Moduł, który
zasubskrybowałby `sales_channels.identity_changed` przed nim, wykonałby swój handler na wartości
sprzed zapisu.

**Kiedyś drugą połową tego zdania była pamięć podręczna ustawień, ale już nie jest.** Warto
przeczytać dlaczego, bo ta sama naprawa jest dostępna dla pozostałego przypadku. Składanie
unieważniania jako pierwszego było działającym układem opartym na dwóch przypadkach. Po pierwsze,
usunięcie wpisu docierało do `SharedDropMarks.begin` synchronicznie, więc zdążało tylko dopóki było
handlerem *zerowym* — a wszystkie 65 modułów rejestruje się teraz w jednym przebiegu, którego
kolejność z założenia nie ma znaczenia, więc nic nie zachowywało tej pozycji i nic nie zgłosiłoby
jej zmiany. Era dwóch przebiegów zanotowała już objaw, gdy po raz pierwszy przesunięto przed nie
`meta_ads` i `linkedin_ads`. Po drugie, i gorzej: `emit()` **wewnątrz** zakresu `EventBus.run` jest
buforowane, dopóki funkcja zakresu się nie zakończy — a `CommandBus.run` otwiera dokładnie jeden
taki zakres na polecenie — więc żadna kolejność rejestracji nie uratowałaby zapisu i ponownego
odczytu w ramach jednego polecenia.

Naprawa nie była trzecią poprawką kolejności. `SettingsAdminService` — jedyne miejsce, w którym
zmienia się wartość lub grupa ustawień — wywołuje teraz `SettingsCacheInvalidation` i **czeka na
nie**, po zatwierdzeniu zmian, a przed wyemitowaniem zdarzenia. Usunięcie z pamięci podręcznej jest
częścią zapisu, więc nic na szynie nie może być względem niego za wcześnie ani za późno;
`attachSettingsCacheInvalidator` usunięto, a uzasadnienie, które pięć modułów podawało w
komentarzach („mój handler ponownie odczytuje ustawienie, a unieważnianie jest przede mną”), jest
teraz prawdziwe z samej konstrukcji. Warto nazwać odrzucone alternatywy: utrwalenie kolejności
kontrolą czyni zależność jawną, ale jej nie usuwa; poziomy priorytetu w `EventBus` uczyniłyby
kolejność pojęciem platformy, które musiałby deklarować każdy przyszły słuchacz; a żadna z nich w
ogóle nie rozwiązuje przypadku buforowanego zakresu.

Pamięć podręczna kanałów sprzedaży nadal subskrybuje zdarzenia, więc powyższa reguła kolejności
nadal obowiązuje ten composition root. Usunięcie jej w ten sam sposób to osobna zmiana.

Każda subskrypcja modułu w drzewie przechodzi przez `ctx.subscribe` i jest to teraz egzekwowane, a
nie tylko zalecane. Moduł mógł kiedyś subskrybować przez zwykłe `eventBus.on` w treści pluginu:
opisana wyżej kolejność unieważniania nadal chroniła taki handler, ale stan efektywny modułu już
nie, bo sprawdza go tylko `subscribeForModule`. Trasy i workery miały swoje kontrole punktów
rozszerzenia, a subskrypcje żadnej, więc w dziewięciu modułach nazbierały się dwadzieścia dwie
takie subskrypcje, podczas gdy zadania przenoszenia każdego z tych modułów były oznaczone jako
wykonane — a subskrybent **zapisuje**, co czyni go gorszą połową tej luki: faktura wystawiona,
ponumerowana i wysłana e-mailem, zapytanie ofertowe przestawione na Completed, powiadomienie push
dostarczone na urządzenie klienta, lista zakupów utworzona — wszystko dla modułu, który operator
uważał za wyłączony.

Zapadką jest `pnpm --filter backend run check:subscribe-seam`. Szuka w źródłach modułu wywołań na
obiekcie o kształcie szyny zdarzeń i zawiera `BARE_SUBSCRIPTIONS_TO_DRAIN`, **pusty** rejestr
działający w obie strony: niezarejestrowana bezpośrednia subskrypcja przerywa build, a wpis w
rejestrze, który już żadnej nie opisuje, też. Jądro jest celowo poza zakresem — składa się przed
jakimkolwiek modułem i nie ma stanu efektywnego, od którego mogłoby zależeć, więc unieważnianie
pamięci podręcznej kanałów sprzedaży subskrybuje bezpośrednio, a od tego faktu zależy kolejność
opisana w poprzednim akapicie.

### Punkt wejścia bez wywołującego sam rozstrzyga obecność

Punkt rozszerzenia trasy blokuje żądania; **treść** pluginu nie jest żądaniem. Wykonuje się przy
starcie niezależnie od stanu efektywnego modułu, więc uruchomiony w niej timer działa dalej po
wyłączeniu modułu przez operatora — `price_lists` co pięć minut przestawiał `scheduled → active` i
`active → expired`, co zmienia ceny, jakie płacą klienci. Funkcja wywoływana przez timer nie ma
też *dokąd* rzucić wyjątku, więc `ModuleDisabledError` nie może się z niej wydostać: rzucony tam
zostaje albo pochłonięty przez `catch` przeznaczony dla przejściowych błędów, albo zatrzymuje
cykl. Funkcja timera **rozstrzyga** więc sama — `if (!effectiveState.isPresent('<id>')) return;`,
na samym początku i poza każdym `try`, aby wyłączony moduł i nieudany cykl nigdy nie dzieliły
jednego cichego „nic nie rób”. Tam, gdzie timer *jest* pętlą, jak w samoplanującym się cyklu
reindeksacji `search`, gałąź „wyłączony” planuje kolejne wywołanie i pomija pracę; powrót bez
ponownego zaplanowania zatrzymałby harmonogram na cały czas życia procesu.

Zapadką jest `pnpm --filter backend run check:entry-presence` — nazywała się
`check:timer-presence`, dopóki zbiór nie przestał składać się z samych timerów — a to, co widzi,
jest węższe niż reguła: `setInterval`, `setTimeout`, którego funkcja ponownie uruchamia timer albo
wywołuje funkcję, która go uruchomiła, handler cyklu życia `process.on` oraz hook `ctx.onBoot` — we
własnych źródłach modułu. Jednorazowy termin wewnątrz operacji, która już ma wywołującego, jest poza
zakresem. Dwa pierwsze kształty są zdefiniowane w `backend/scripts/lib/repeating-timers.ts` i
korzysta z nich także `check-entry-scope.ts`. Tamta kontrola klasyfikowała swoje punkty wejścia
oparte na interwałach, wyszukując `setInterval(`, więc pętla reindeksacji `search` była poza
liczonym zbiorem, a luka pozostawała niewidoczna za liczbą, która się nie zmieniała. Dwa detektory
tego samego kształtu to przepis na rozjazd; reguły pozostają osobne — jedna pyta, czy funkcja
rozstrzyga obecność, druga, czy miejsce otwiera zakres — ale mechanizm rozpoznawania jest jeden.

#### Zakres ocenia się dla każdego miejsca, bo ocena całego pliku to alternatywa

`check-entry-scope.ts` klasyfikował kiedyś **pliki**, a plik był oznaczany jako `scoped`, gdy tylko
*jeden* z jego punktów wejścia był poprawny. To nie jest słabość teoretyczna:
`kernel/lifecycle/registry-cache.ts` odświeżał `module_registrations` i `settings` z handlera Redis
pub/sub w ogóle bez zakresu, a kontrola uznawała plik za objęty zakresem dzięki poprawnie
opakowanemu `setInterval` 130 wierszy niżej. Sześć plików w tym drzewie ma więcej niż jeden punkt
wejścia, a to dokładnie tam alternatywa może któryś ukryć.

Zbiorem są więc **miejsca**. Sześć klas: skrypt CLI i zadeklarowany program pozostają na poziomie
pliku — punktem wejścia jest wykonanie najwyższego poziomu w tym pliku — a każde
`new Worker(...)`, każdy powtarzający się timer, każde `x.on('message', …)` i każde
`process.on/once(...)` to osobne miejsce. Dwie z tych klas są nowe, a jedna zamyka lukę, której
nie mogła zamknąć żadna klasa na poziomie pliku: `kernel/container.ts` instaluje w całym procesie
zwalnianie zasobów przy `SIGINT`/`SIGTERM`, a nie leży w żadnym katalogu `scripts/`, nie jest
zadeklarowanym programem, nie tworzy `Worker` i nie uruchamia timera — kontrola klasyfikująca pliki
nie miała go gdzie umieścić, więc handler nie był zwolniony z reguły, tylko w ogóle nieobecny. Dwa
miejsca na poziomie pliku są oceniane na podstawie pliku **bez** funkcji miejsc znajdujących się w
nim, więc program nie może zostać uznany za objęty zakresem dzięki `enterSystemScope` otwieranemu
przez jego Worker.

Miejsce jest objęte zakresem, gdy `enterSystemScope` / `enterPlatformScope` jest wywoływane w jego
własnej funkcji albo **o jeden krok** dalej, w funkcji zdefiniowanej w tym samym pliku — na tę samą
głębokość `check-port-catches` śledzi `this.<method>()`. Przekazanie identyfikatora funkcji nie jest
tym krokiem: w `new Worker(QUEUE, processor, …)` `processor` *jest* funkcją miejsca. Dwa kroki,
zaimportowana funkcja delegowana i delegowanie przez `this.<method>()` są poza zasięgiem analizy i
wszystkie trzy są uznawane za **nieobjęte zakresem** — w tę stronę musi się mylić martwy punkt.

`NO_SCOPE_NEEDED` ma klucze takie jak rejestry `check-entry-presence` —
`<file>:<enclosing name>:<construct>`, niezależne od numeru wiersza, działające w obie strony — a
jeden klucz może obejmować dwa miejsca, które dzielą wszystkie trzy części (`index.ts` rejestruje
`SIGINT` i `SIGTERM` w jednej funkcji). Nie oczekuje się, że ten rejestr się opróżni: wpis mówi,
dlaczego miejsce *słusznie* działa bez zakresu, i co by temu zaprzeczyło. Wzorcowym przykładem są
trzy handlery pamięci podręcznej i połączeń: handler pub/sub, który tylko usuwa zapamiętaną `Map`,
nie potrzebuje zakresu, bo ponowne wypełnienie następuje na stosie następnego wywołującego, a wpis
mówi to jako warunek zaprzeczający: **w dniu, w którym zacznie ponownie wczytywać zamiast usuwać,
błąd wróci**.

`TIMERS_WITHOUT_PRESENCE` i `BOOT_HOOKS_WITHOUT_PRESENCE` działają w obie strony jak rejestry
powyżej, ale w przeciwieństwie do nich nie oczekuje się, że się opróżnią: wpis mówi, dlaczego
miejsce słusznie działa dalej, gdy jego moduł jest wyłączony — podtrzymywanie dzierżawy blokady
cyklu życia należy do polecenia, które tę blokadę trzyma, a `_lifecycle` jest niewyłączalny.

#### Hook startowy należy do tego zbioru, a jednego jego kształtu nie naprawia sprawdzenie obecności

Nic w jądrze nie rozstrzyga obecności za hook startowy (zobacz *Faza startu rzuca wyjątki dalej*
wyżej), więc hook, który **wykonuje pracę**, ma ten sam obowiązek co funkcja timera:
`if (!effectiveState.isPresent('<own id>')) return;`, na samym początku i poza każdym `try`.
`product_feeds` przy każdym wdrożeniu zapisywał w Redis klucze harmonogramu BullMQ, mimo że moduł
był wyłączony; `pim_ergonode` robił to samo ze swoim harmonogramem importu, `inventory` tworzył
wiersze przypisań magazynów do kanałów, `blog` tworzył kategorię i dwie role, a `cms` uzgadniał
swoje domyślne hooki.

Hook, który tylko **wnosi wkład** — dodaje bierny deskryptor do rejestru innego modułu — **nie
może** sprawdzać obecności. Host filtruje takie wpisy według modułu, który je wniósł, przy
przeglądaniu, więc nieobecny moduł i tak nic go nie kosztuje, a sprawdzenie oznaczałoby, że moduł
ponownie włączony przez operatora w czasie działania nie wnosiłby niczego aż do następnego restartu.

Hook, który robi **jedno i drugie**, trzeba rozdzielić, zanim którakolwiek z tych odpowiedzi będzie
miała zastosowanie, a kontrola zgłasza go jako osobny rodzaj (`mixed-boot-hook`) z zaleceniem
„najpierw go rozdziel”. To nie jest kwestia stylu. `blog` i `cms` rejestrowały skaner referencji do
plików obok własnej pracy, a `assets_library` sprawdza ten rejestr przed każdym miękkim usunięciem —
zasada przeglądania tego rejestru to *respektowanie* wpisów nieobecnego modułu właśnie dlatego, że
wiersze wyłączonego modułu nadal osadzają pliki. Dodaj sprawdzenie do połączonego hooka, a
wdrożenie startujące z wyłączonym `blog` nie będzie miało skanera bloga: biblioteka usunie wtedy
plik, do którego odwołuje się wpis na blogu, a operator zobaczy szkodę jako uszkodzony obraz po
ponownym włączeniu modułu. Dwa z pięciu hooków wykonujących pracę w drzewie były mieszane — dlatego
kontrola, której jedyną radą byłoby „dodaj sprawdzenie na początku”, uczyłaby złej naprawy w 40%
znalezionych przypadków. `backend/test/integration/blog/asset-reference-while-off.test.ts` i jego
odpowiednik dla `cms` utrwalają ten skutek: składają moduł **gdy jest wyłączony** i sprawdzają, że
pliku, do którego jest odwołanie, nadal nie da się usunąć.

Moduł, którego manifest deklaruje `activation.nonDeactivatable`, jest poza zbiorem hooków
startowych — nie ma stanu, w którym jego hooki wykonują się pod jego nieobecność. To wyprowadzenie
znajduje się w `backend/scripts/lib/switchable-modules.ts` i jest wspólne z `OWNER LOCKED` w
`check-port-catches`, więc właściciel, który zdejmie blokadę, w tym samym przebiegu ponownie oznacza
na czerwono obie kontrole, bez edycji żadnego rejestru.

### Pamięć podręczna oparta na obecności porównuje generację, a nie powiadomienie

`b2b:module:state-changed` ogłasza zmianę, której wpływ na `registryCache` wymaga jeszcze
odczytu z PostgreSQL: nowe mapy instaluje `refreshFromDb`, a ta funkcja jest `async`. Konsument,
który zapamiętuje cokolwiek wyprowadzonego z obecności i czyści to zapamiętanie **w subskrybencie**,
odbudowuje więc dane z obecności *sprzed* zmiany i trzyma wynik do następnego komunikatu — który
może nigdy nie nadejść. Dokładnie tak robił `admin_actions`: żądanie palety poleceń, które trafiło
w to okno, na stałe zapamiętywało akcje wyłączonego modułu, a błąd nie zależał od tego, który z
dwóch handlerów `on('message')` zarejestrowano pierwszy, bo okno otwiera asynchroniczność
odświeżania, a nie kolejność słuchaczy. To ta sama rodzina co opisane wyżej unieważnienia pamięci
podręcznej — unieważnienie, którego poprawność zależy od kolejności wysyłki.

Odpowiedzią jądra jest **pobieranie**, `effectiveState.presenceVersion()`: licznik, który pamięć
podręczna rejestru zwiększa, gdy zakończone wczytanie instaluje obecność o treści innej niż
poprzednia. Konsument zapamiętuje numer, przy którym zbudował migawkę, i porównuje go przy każdym
odczycie:

```ts
const version = this.presence.version();
if (version !== this.cachedPresenceVersion) {
  this.cachedPresenceVersion = version;
  this.invalidate();
}
```

Nic się nie rejestruje, więc nie ma kolejności, którą można pomylić, a usługa utworzona po
odświeżeniu nadal odczytuje właściwy numer. Licznik zmienia się przy zmianie **treści**, a nie
liczby odświeżeń: każdy proces odświeża dane przy każdej zmianie stanu, a timer trybu awaryjnego
odświeża co pięć sekund, więc licznik zwiększany przy każdym odświeżeniu czyściłby zapamiętanie za
każdym razem i czynił je bezużytecznym podczas awarii Redis. Zostaw subskrybenta, jeśli nadal się
przydaje — obejmuje dane wejściowe, których obecność nie zmienia, np. instalację, która przepisuje
wiersze `module_actions` albo pakiety tłumaczeń — ale nie może to być element, na którym opiera się
poprawność odpowiedzi.

### Jak pisać uzasadnienie kolejności, które się nie zdezaktualizuje

Połączenie dwóch przebiegów w jeden nie unieważniło niczego w kodzie, za to unieważniło piętnaście
komentarzy — i dwa uzasadnienia, które już raz poprawiano. To nie jest kwestia porządku: trzy razy
w ramach tej zmiany osoba implementująca przeczytała jeden z nich, uwierzyła mu i spędziła sesję
nad błędem, który nie istniał. Wynikają z tego dwie reguły, które dotyczą każdego wyjaśnienia,
*kiedy* coś się dzieje.

**Nazywaj mechanizm, a nie współrzędne.** Uzasadnienie w rodzaju „akcesor jest przypisywany dopiero
w `composition.ts:3240`, a hooki wykonują się w `:2122`” staje się błędne w chwili, gdy zmieni się
którakolwiek liczba, i nic o tym nie informuje: żaden test nie obejmuje komentarza, a czytelnik nie
ma powodu wątpić w liczbę. To samo uzasadnienie zapisane jako „orkiestrator jest budowany po
złożeniu modułów, więc akcesor zwraca `undefined` podczas rejestracji” przetrwa każdą zmianę, która
nie zmienia mechanizmu — a jeśli mechanizm się zmieni, widać, że zdanie dotyczy właśnie tego, co
się zmieniło. Tam, gdzie odwołanie naprawdę pomaga, niech będzie **symbolem** albo **plikiem i
symbolem** (zabezpieczenie `registering` w `compose.ts`, `installGatingGraph` w
`presence-load.ts`), nigdy numerem wiersza.

**Nie pisz hipotetycznego scenariusza w czasie przeszłym.** „Uzgadnianie w tym miejscu nie
znalazłoby rejestru i zgłosiłoby sukces” brzmi jak raport z incydentu; następny czytelnik uzna to
za dowód, że platforma kiedyś tak się zepsuła, i zacznie szukać awarii. Jeśli zagrożenie jest
hipotetyczne, powiedz to w pierwszym zdaniu — `test/unit/_i18n/reconcile-timing.test.ts` zaczyna
się od „wszystko poniżej dotyczy przeniesienia, którego nigdy nie wykonano” właśnie z tego powodu,
po tym jak akapit pod spodem już raz kogoś wprowadził w błąd. Jeśli zagrożenie jest prawdziwe i
przeszłe, w tym samym zdaniu wskaż decyzję albo commit, który je usunął, tak jak robi to
`api_keys/backend.ts` przy wycofanym wpisie `EARLY_PASS_MODULE_IDS`.

To samo dotyczy rejestrów w `check-port-dependencies.ts`: sprawdzanie aktualności uruchamia się,
gdy właściciel **zarejestruje nazwę**, a to nie ten sam fakt co przeniesienie właściciela na nowy
mechanizm, więc uzasadnienie zapisane jako „nadal podłączane ręcznie” dezaktualizuje się, nie
przerywając żadnego buildu. Zapisuj uzasadnienie każdego wpisu jako stwierdzenie o nazwie.

## Praca przy instalacji: jedynym punktem rozszerzenia jest `manifest.ts`

`ctx.onBoot` to jedyny hook cyklu życia dostępny w `ModuleContext`. Nie ma `ctx.onInstall` ani
`ctx.onUninstall`: kiedyś istniały, mechanizm kompozycji je zbierał, ale nic ich nigdy nie
wykonywało, więc zostały usunięte. Powód jest strukturalny, a nie porządkowy. Jądro składa
**działający proces**; mechanizm cyklu życia zarządza **inwentarzem wdrożenia**, a kontener ma
tylko pierwszy z nich. `module:install` buduje statyczny rejestr z `REGISTERED_MANIFESTS`, otwiera
ORM i Redis i nigdy nie wywołuje `composeApp` — więc hook przekazany do kontenera nie mógłby się
wykonać nawet w teorii, chyba że składałoby się wszystkie 65 modułów po to, by zainstalować jeden.

Moduł, który potrzebuje pracy przy instalacji, eksportuje ją ze swojego `manifest.ts`:

```ts
// packages/modules/custom_fields/src/manifest.ts
export const uninstallHook: ModuleUninstallHook = async (ctx) => {
  if (!ctx.hard) return;                 // soft uninstall drops nothing
  const em = ctx.em as EntityManager;
  await em.getConnection().execute('truncate table "custom_field_definitions" cascade');
};
```

`backend/scripts/generate-composer.ts` wykrywa ten eksport i zapisuje go w
`backend/src/manifest-index.generated.ts`, jedynym generowanym rejestrze manifestów; rejestru nigdy
nie edytujesz ręcznie. Ten sam generator na podstawie tego samego przejścia po drzewie tworzy
composer, `db/entities-registry.generated.ts` i `db/migrations-registry.generated.ts` — jedno
polecenie, więc dwa artefakty odświeżane dwoma poleceniami nie mogą się już rozjechać. Uruchom
`pnpm --filter backend run composer:generate` i zatwierdź wynik.

Sześć właściwości, wszystkie istotne i żadna nieoczywista z samej sygnatury hooka. Utrwala je
`backend/test/unit/_lifecycle/orchestrator.test.ts`.

**1. Hook jest idempotentny z kontraktu, a nie z konwencji.** To nie jest „raz na wdrożenie”.
Nieudana instalacja zostawia wiersz rejestru w stanie `uninstalled`, więc następne
`module:install` wykona hook ponownie; tak samo cykl miękkie odinstalowanie → instalacja. Pisz go
tak, by drugie wykonanie niczego nie zmieniało.

**2. Błąd hooka instalacyjnego przerywa instalację.** Mechanizm cyklu życia cofa w odwrotnej
kolejności każdą migrację wykonaną *w tym przebiegu*, ustawia wiersz na `uninstalled` z
`lastInstallError`, zapisuje w audycie `module.install_failed` i rzuca
`LifecycleError('install-failed')` — kod wyjścia CLI 70. Nie pochłaniaj błędów w hooku „dla
bezpieczeństwa”: głośny błąd *jest* bezpiecznym zachowaniem i jedynym, które zostawia instancję w
stanie sprzed instalacji.

**3. Błąd hooka odinstalowującego przerywa odinstalowanie i niczego nie usuwa.** Hook wykonuje się
przed usunięciem ustawień, przed cofnięciem migracji i zanim zostanie zmieniony wiersz rejestru,
więc wyjątek zostawia moduł dokładnie w poprzednim stanie.

**4. `ctx.hard` odróżnia odinstalowanie miękkie od niszczącego.** Miękkie odinstalowanie oznacza
„to wdrożenie już nie zawiera tego modułu”; jest odwracalne i nie może usuwać wierszy. Twarde
odinstalowanie oznacza, że znika też schemat. Niszczące sprzątanie umieszcza się za
`if (!ctx.hard) return;`.

**5. Żaden z hooków nie wykonuje się przy aktywacji ani dezaktywacji i nie wolno ich tam dodawać.**
To oś obecności należąca do operatora — `module:enable`, `module:disable` i ustawienie aktywacji
na `/platform/modules` nie uruchamiają żadnego z tych hooków. Wyłączenie jest odwracalne i niczego
nie usuwa; odinstalowanie nie jest odwracalne i usuwa.

**6. Kontekst hooka to `{ em, redis, log, module }` — plus `hard` przy odinstalowaniu — i nie może
zawierać usług.** Hook, który potrzebuje współpracownika, tworzy go z `em`. Nic nie jest tu
pobierane z kontenera, bo w procesie, który wykonuje hook, nie ma kontenera.

## Polecenia operatora: deklaracja, którą wykonuje host

Polecenie operatora należące do modułu — reindeksacja, porządkowanie, inicjalizacja — to eksport
`cliCommands` z tego samego pliku `manifest.ts`, w którym są hooki instalacyjne, a wywołuje je
host. Nigdy nie jest to skrypt, który sam uruchamia platformę.

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
# W instancji, z jej katalogu głównego:
pnpm run cli --list            # każde polecenie, które oferuje ta instancja
pnpm run cli search reindex

# W klonie repozytorium Endora Commerce:
pnpm --filter backend run cli -- --list
pnpm --filter backend run cli -- search reindex  # albo alias: pnpm search:reindex
```

To samo przejście po drzewie i ta sama funkcja `detectHookExport`, które obsługują `installHook`,
wykrywają też ten eksport, więc działa on tak samo dla rdzenia, modułu nakładkowego wdrożenia i
**zainstalowanego pakietu rozszerzenia** — i to jest jedyny powód takiego kształtu. Plik w
`node_modules` nie może zaimportować niczego, co prowadziłoby do `backend/src/composition.ts`
instancji, a skrypt rdzenia, który by to zrobił, tworzy cykl moduł → composition root → moduł.
Wywołanie jest więc odwrócone: `backend/src/cli.ts` składa aplikację raz i wywołuje moduł. To
dokładny odpowiednik Magento 2, gdzie moduł dostarcza klasę polecenia i deklarację w
`CommandListInterface`, a `bin/magento` uruchamia aplikację i tworzy polecenie ze wstrzykniętymi
zależnościami.

Pięć rzeczy, które są decyzjami, a nie szczegółami:

**1. Implementacja leży w `packages/modules/<id>/src/backend/cli/<name>.ts`, a deklaracja ładuje ją
przez `await import()`.** Wygenerowany indeks manifestów importuje każdy skrypt kontroli statycznej
i `src/db/configured-migrations.ts`; statyczny import klienta Meilisearch albo grafu usług
zależnych od ORM wciągnąłby go do nich wszystkich. Tę samą regułę stosuje już
`lifecycleParticipant`.

**2. Handler dostaje `ModuleContext`, a nie kontener.** Pobiera porty przez
`lazyPort<T>(ctx, 'literalName')`, znak w znak tak, jak pisze się to w `backend.ts`, więc
`check:port-dependencies` widzi krawędź między modułami. Odczyt `scope.cradle.someForeignPort` to
niezadeklarowana krawędź, która przechodzi kontrolę bez uwag — ten sam błąd, który powodowała
funkcja `port(ctx, name)`, za której zmienną ukryło się czternaście pobrań portów. Odczyt
rejestracji **własnego** modułu przez `ctx.cradle<T>()` jest w porządku, a czasem konieczny:
`lazyPort` zwraca proxy, które na każdą właściwość odpowiada funkcją, aby móc przekazać wywołanie
metody, więc zagnieżdżony odczyt w rodzaju `handle.indexer.reindexAll()` przechodzi kontrolę typów,
a potem kończy się błędem *„is not a function”*.

**3. O obecności decyduje host, zanim powstanie kontekst.** Polecenie nie ma trasy do zablokowania,
workera do opakowania ani pobrania portu, na którym można zawiesić przejściową blokadę, więc
punktem rozszerzenia jest **deklaracja**: własny plik platformy `cli/module-commands.ts` —
`@endora-commerce/platform/cli`, z którego aplikacja korzysta przez plik reeksportujący
`src/cli/module-commands.ts` — wywołuje `requireModuleEnabled` dla modułu, który zadeklarował
polecenie — jako pierwsze, poza każdym `try`, zanim poprosi o kontekst. Autor modułu nie pisze
sprawdzenia obecności i nie może o nim zapomnieć, a to właśnie jest zadanie blokady. Pytanie
dotyczy identyfikatora modułu deklarującego, nigdy właściciela portu: ta odpowiedź należy do
blokady `providePort` właściciela, a pytanie o nią dwa razy to prosta droga do tego, by obie
odpowiedzi się rozjechały.

**4. Na `--list` i `--help` host odpowiada, zanim cokolwiek otworzy.** To pytania o *deklarację*,
więc host odczytuje `resolvedManifestEntries()` — tylko manifesty, bez bazy danych — i odpowiada.
Dlatego `help` jest właściwością danych w deklaracji, a nie czymś, co wypisuje implementacja:
uprawnieniem `audit_logs read` jest dostęp do hosta, a nie działający adres połączenia, więc
polecenie musi umieć powiedzieć, co robi, zanim będzie w stanie to zrobić.

**5. Pięć poleceń `module:*` to inna rodzina i nie wolno ich przenosić na ten mechanizm.**
`install`, `uninstall`, `enable`, `disable` i `status` działają **na** platformie, a nie z jej
pomocą. Kompozycja wykonuje `reconcileExistingModules`, które wstawia `state='installed'` dla
każdego dostarczonego manifestu bez wiersza — więc `module:install X` wykonujące kompozycję
zastałoby `X` już zainstalowany i zwróciło `already-installed`, nie wykonując żadnej migracji, nie
uzgadniając żadnego ustawienia i nie uruchamiając hooka instalacyjnego, z kodem wyjścia 0.
Polecenie platformy musi działać na platformie, która jeszcze nie jest w stanie, który to polecenie
ma dopiero utworzyć.

Warto powiedzieć, ile kompozycja **kosztuje**, żeby nie odkrywać tego za późno: wykonuje się każdy
hook startowy (to idempotentne doprowadzanie do stanu docelowego, więc kosztem jest czas i szum w
logach, a nie nowy stan), błąd któregokolwiek przerywa polecenie ze wskazaniem jego modułu, a
środowisko wdrożenia staje się warunkiem wstępnym — dostępny PostgreSQL, a na produkcji
skonfigurowany publiczny adres. Kompozycja **nie** uruchamia natomiast konsumentów kolejek ani
timerów: każde wywołanie `ctx.worker(` i każdy timer modułu znajduje się w treści `ctx.routes(…)`,
która wykonuje się przy rejestracji w Fastify, a ten proces nigdy nie buduje serwera.

## Kontrole

| Skrypt | Co odrzuca |
| --- | --- |
| `check-kernel-boundary.ts` | relację ORM z jądra do modułu albo z modułu do innego modułu; **oraz** każdy import w `src/kernel/**` prowadzący do `src/modules/` lub `src/apps/` — w każdej postaci, łącznie z `import type`. Zawiera `KERNEL_MODULE_IMPORTS_TO_DRAIN`, zapadkę działającą w obie strony, przechowującą jedyną krawędź, którą przekazano do decyzji zamiast naprawić |
| `check-port-dependencies.ts` | pobieraną nazwę, której nikt nie jest właścicielem; właściciela, którego nie ma w zależnościach manifestu modułu pobierającego; singleton przechwytujący blokowany port — **także port dostarczany przez ten sam moduł**; **blokowany port pobierany w hooku `ctx.onBoot` albo w treści `ctx.routes`**; composition root przesłaniający port modułu; nazwę portu obliczaną w kodzie; **oraz krawędź do modułu, który można wyłączyć, bez określonego zachowania na czas jego wyłączenia** (rejestr skutków wyłączenia opisany wyżej) |
| `check-port-catches.ts` | `catch` wokół wywołania blokowanego portu, który nie przepuszcza `ModuleDisabledError` — przez bezwarunkowe rzucenie dalej, `rethrowIfModuleDisabled`, jawne wskazanie tego błędu albo funkcję, która rzuca go dalej. Śledzi port przez obiekt przechowujący i przez wkład composition root. Zawiera `PORT_CATCHES_TO_DRAIN`, zapadkę działającą w obie strony, i wyprowadza z manifestów `OWNER LOCKED` dla miejsca, w którym każda blokada ma właściciela `nonDeactivatable` |
| `check-container-imports.ts` | moduł importujący `awilix` bezpośrednio zamiast przez `ModuleContext` |
| `check-entry-scope.ts` | **miejsce** wejścia spoza HTTP, które nie otwiera zakresu. Sześć klas: skrypt CLI i plik w `src/`, który `package.json` uruchamia jako osobny proces — oba na poziomie pliku, po jednym miejscu, wykonanie najwyższego poziomu w pliku — oraz po jednym miejscu na każde `new Worker(...)`, każdy powtarzający się timer, każde `x.on('message', …)` i każde `process.on/once(...)`. Klasa timera to *kształt*, a nie konstruktor: korzysta z `lib/repeating-timers.ts`, wspólnego z `check-entry-presence.ts`, więc liczy się też `setTimeout`, który funkcja ponownie uruchamia. Drugie źródło zbioru w ogóle nie jest kształtem: klasy kształtów spisano z tego, co drzewo zawierało w danym momencie, a `src/seeds/dev-catalog-seed.ts` — `main()` na najwyższym poziomie, czyszczące i ponownie wypełniające tabele kilkunastu modułów — nie pasował do żadnej, więc `unscoped=0` nic o nim nie mówiło. **Zbiorem są miejsca, a nie pliki** — zobacz niżej. Wynik wypisuje `sites=` i `files=`, aby rozszerzenie, które nie zmieniło liczebności zbioru, było widoczne jako takie, które niczego nie zmieniło |
| `check-channel-resolution.ts` | bezpośredni odczyt nagłówka `x-sales-channel` poza mechanizmem rozstrzygania; element storefrontu ponownie rozstrzygający kanał żądania; odczyt ustawienia, którego argument kanału może być stringiem niebędącym UUID kanału; identyfikator kanału wymyślony przez parametr domyślny albo zastępczy `randomUUID()`. W CI działa z `--enforce` |
| `test/contract/kernel/harness-parity.test.ts` | rozjazd między dwoma composition rootami, w postaci jawnego rejestru — łącznie z `ROOT_MODULE_VALUE_IMPORTS`: każdym importem **wartości**, który composition root bierze z `src/modules/**`, z kluczem według właściciela i opisem, co musi się stać, by go usunąć, oraz regułą „żaden composition root nie tworzy usługi należącej do modułu” z nazwaną listą wyjątków |

Ta tabela obejmuje kontrole samego jądra. **Pełny** inwentarz — łącznie z
`check-command-coverage.ts`, `check-subscribe-seam.ts`, `check-doc-snippets.ts`,
`check-error-translations.ts`, `check-entity-tenant-classification.ts`, `overlay:check`, dwiema
kontrolami powłoki niewymagającymi narzędzi i kontrolą rozmiaru pdfmake — wylicza
`backend/test/unit/scripts/check-inventory.test.ts`, który kończy się błędem, gdy istnieje skrypt
`check-*` bez wpisu albo gdy wpis wskazuje skrypt, którego nie ma. Zanim dodasz nową kontrolę,
przeczytaj następną sekcję.

Kontrola rozpoznaje trzy postacie pobrania, a trzecia wymagała drugiego podejścia: parametr
kontenera w fabryce (destrukturyzowany albo nazwany), `ctx.cradle<C>()` w treści oraz **każde z
nich najpierw przypisane do zmiennej lokalnej** — `const cradle = ctx.cradle<C>()` i
`const cradle = (): C => ctx.cradle<C>()`. Piętnaście modułów korzystało z jednej z tych dwóch
postaci aliasu, a każdy odczyt przez nie był niewidoczny, łącznie z blokowanymi portami
destrukturyzowanymi w treści `ctx.routes`. O wyniku decyduje miejsce odczytu aliasu, dokładnie tak
jak przy odczycie bezpośrednim: `cradle().x` w fabryce `asFunction` to **przechwycenie**, bo treść
fabryki wykonuje się, gdy Awilix tworzy rejestrację.

Kontrola portów ma cztery listy wyjątków i wszystkie mają się kurczyć, a nie rosnąć:
`HOST_REGISTERED_PORTS` (composition root rejestrujący w imieniu modułu),
`WIRING_RESOLUTIONS_TO_DRAIN` — blokowane porty wciąż destrukturyzowane w treści `ctx.routes` w
chwili, gdy kontrola nauczyła się widzieć ten kształt, **dziś pusta** —
`ALIAS_HIDDEN_RESOLUTIONS`, odczyty ukryte przez alias, których naprawa jest decyzją w manifeście
ze skutkiem widocznym dla operatora, a nie poprawką w jednym wierszu, **też pusta**, odkąd
`commerceModule` dostał akcesory w konstruktorze — oraz `REGISTRY_POLICIES_UNSTATED`, dług zasad
w rejestrze skutków. **Nowy** wpis przerywa build.

Liczebność pierwszej listy czytaj z uwzględnieniem jej historii. Powstała jako pozostałość po
przenoszeniu modułów i tak też była opróżniana — każdy wpis, którego właściciel został
przeniesiony, usunięto, a kontrola kończy się błędem, gdy wpis przetrwa swojego właściciela. **Ile
wpisów zostało, nie jest tu zapisane**: ten akapit mówił *„28”* i wymieniał cztery mosty, z których
trzy zostały od tego czasu wycofane, czyli w jednym zdaniu podawał liczbę wyprowadzanego faktu i
listę zmieniającego się zbioru. Na oba pytania odpowiada `HOST_REGISTERED_PORTS` w
`backend/scripts/check-port-dependencies.ts`. Większość pozostałych wpisów to dwa kształty — *kto
pyta* (`customerContextResolver`, `cartActorResolver`, `adminAuditActorResolver` i reszta rodziny
użytkowników, gdzie produkcja odczytuje `request.actor`, a środowisko testowe `request.testActor`)
oraz *czy ta kompozycja uruchamia tego konsumenta* (`pwaRunWorkers`, `searchRunWorkers`,
`webhooksRunWorkers`). Trzeci kształt — *most, który composition root składa ponad granicami, przez
które moduł nie może sięgać* — jest usuwany, po jednym właścicielu naraz, na rzecz portów
publikowanych przez właściciela.

Wpis może się tu zdezaktualizować na dwa sposoby, nie przerywając buildu, i warto znać oba, zanim
któremuś zaufasz. Kilka komentarzy przy wpisach nadal mówi „nadal podłączane ręcznie” o module,
który został przeniesiony: sygnał nieaktualności pojawia się dopiero wtedy, gdy właściciel sam
zarejestruje port. A wpis, którego nazwy **nie dostarcza już żaden composition root**, jest
niewidoczny dla wszystkich zgłoszeń tej tabeli — sprawdzenie `unsupplied` pyta, czy jakiś moduł
nadal *pobiera* niezarejestrowaną nazwę, więc wycofany most zostawia opis wkładu, którego już nie
ma. Tak przez tydzień przetrwał tu `returnsBridge`. Usuń wpis w tym samym pull requeście, który
wycofuje nazwę.

Portów należących do modułu `nonDeactivatable` nie ma na tej liście i nigdy nie będzie: to
zwolnienie jest obliczane z manifestów, bo blokada, której mechanizm cyklu życia nie pozwala
zamknąć na żadnej osi, nie ma stanu, w którym mogłaby rzucić wyjątek. Drugie zwolnienie nie należy
już do skryptu: krawędź, której nie da się zadeklarować, bo deklaracja zamknęłaby cykl manifestów,
deklaruje się w manifeście modułu pobierającego jako `acknowledgedDependencies` — wzorcowym
przykładem jest `organizations` pobierające `addressService`, bo `addresses` deklaruje
`organizations`, a moduł bazowy izolacji tenantów musi zostać zainstalowany jako pierwszy. Deklaracja
jest w manifeście, a nie tutaj, bo z tej samej deklaracji korzysta odmowa przy przełączaniu modułu
w cyklu życia: dopóki krawędzie istniały tylko w tym skrypcie, operator mógł wyłączyć właściciela
uznanego portu pod działającym pobraniem i nic nie odmawiało przełączenia. Przypadkiem, który to
ujawnił, było pobieranie `price_lists:pricingService` przez `catalog`; `price_lists` stał się od
tego czasu częścią rdzenia, więc to konkretne przełączenie zamyka deklaracja samego właściciela —
ale mechanizm nie zależy od tego, które moduły akurat należą do rdzenia, a krawędź nadal jest
zadeklarowana tam, gdzie widzą ją obaj odbiorcy.

### Jak napisać kontrolę, która potrafi zgłosić błąd

W ciągu jednego tygodnia okazało się, że sześć kontroli jest słabszych niż ich własny opis. Jedna
przeglądała `*.entity.ts` i sprawdzała dekoratory relacji, choć jej nagłówek mówił o importach;
jedna nie widziała lokalnego w module aliasu kontenera, a jej rozszerzenie zamieniło 0 naruszeń w
21 w 17 modułach; jeden skaner dopasowywał **4 z 492** miejsc egzekwowania, bo `\.` w jego
wyrażeniu regularnym nie był opcjonalny; subskrypcje `EventBus` w ogóle nie miały zapadki, dopóki
nie nazbierało się ich dwadzieścia dwie — ta liczba była na tej stronie podana poprawnie 190
wierszy wcześniej, a tu przez tydzień błędnie, i właśnie tak przetrwa błędna liczba: dokument,
który sam sobie przeczy, wygląda na dzieło dwóch autorów, a nie na błąd. Żaden z tych przypadków
nie był niedbałością i żaden nie dał o sobie znać: **zielonego wyniku nie da się odróżnić od
kontroli, która niczego nie obejrzała**, a nic w repozytorium nie wymuszało tego rozróżnienia.
Wynika z tego osiem reguł.

**Przyjmuj dane wejściowe jako parametr.** Kontrolę, której analiza czyta dysk, można uruchomić
tylko na drzewie, a na czystym drzewie daje ten sam wynik co funkcja zwracająca `[]`.
`checkSubscribeSeam({ sources })`, `checkDocument(doc, read)` i
`compareArtifact(path, expected, read)` przyjmują to, co czytają, więc ich testy mogą uruchamiać je
na źródłach, których w repozytorium nie ma — a to jedyny sposób, by zobaczyć, że reguła reaguje na
kształt, dla którego ją napisano. CLI niech będzie cienką funkcją `main`, która dostarcza
prawdziwy mechanizm odczytu.

**Dane testowe wchodzą na samym początku analizy.** „Zgłasza błąd na syntetycznych danych” samo w
sobie nie wystarcza, a kontrprzykładem było samo zabezpieczenie: wpis inwentarza dla
`check-entry-scope` przekazywał do `violationsOf` **wcześniej sklasyfikowany rekord**, więc
dowodził działania ostatniej funkcji w łańcuchu, a klasyfikator — czyli właśnie zepsuta część —
nigdy się nie wykonywał. Ten klasyfikator szukał `setInterval(`, nie widział samoplanującego się
`setTimeout` i przez cały czas, gdy dowód był zielony, kryła się za nim prawdziwa luka. **Dane
testowe wchodzące poniżej błędu nie mogą go wykryć.** Dowód zaczyna się więc od tego, co kontrola
czyta w prawdziwym przebiegu — tekstu źródłowego, mapy plików, wstrzykniętego mechanizmu odczytu,
drzewa danych testowych na dysku — a w drodze do asercji wykonuje się każdy etap należący do
kontroli, łącznie z filtrem zbioru i klasyfikatorem. Każdy wpis inwentarza deklaruje właśnie w tym
celu `enters: 'top'`, a wszystko inne trafia do `PROOFS_ENTERING_BELOW` z opisem, czego trzeba, by
to podnieść.

**Dowodź całego zbioru kształtów, a nie tego jednego, który istniał w chwili pisania.** Dowód może
wchodzić na samym początku i nadal sprawdzać jeden z pięciu sposobów zapisu, a wtedy cztery piąte
kontroli może oślepnąć za czerwonym wynikiem piątego. `check-subscribe-seam` wymienia trzy sygnały,
a jego dane testowe — `eventBus.on('inventory.adjusted.v1', …)` — spełniały dwa z nich naraz, więc
żaden nie mógł zawieść osobno; `check-entry-presence` wymieniała trzy konstrukcje, a dowodziła
`setInterval`; `check-channel-resolution` wymienia cztery sygnały, a dowodziła jednego. Tam, gdzie
nagłówek kontroli wylicza zbiór, inwentarz zawiera po jednym dowodzie dla każdego elementu, każdy z
danymi zawężonymi tak, by mogły uruchomić tylko sygnał, od którego pochodzi nazwa, i każdy sprawdza
**rodzaj** zgłoszenia, a nie samą liczbę.

**Zakres skanowania niech będzie właściwością reguły, a nie nazwy pliku.** Dwie kontrole wyliczały
`*.entity.ts`. Nic w repozytorium nie wymusza tego przyrostka, więc encja zadeklarowana w
`entities/index.ts` nie była dla nich *niesklasyfikowana* — była nieprzeczytana, a nieprzeczytane i
czyste dają ten sam wiersz wyniku. Przechodź po drzewie, filtruj wstępnie po tym, czego dotyczy
reguła (`@Entity(`, dekorator relacji), a decyzję zostaw parserowi.

**Nie pisz własnego analizatora leksykalnego.** Niemal każda kontrola na poziomie źródeł zaczyna od
pominięcia komentarzy, a zapisany jako uporządkowana para wyrażeń regularnych ten krok jest błędny
w obu kolejnościach. Gdy najpierw usuwa się komentarze blokowe, wiersz `//` kończący się wzorcem
trasy otwiera komentarz blokowy, który ciągnie się do następnego prawdziwego zakończenia:
`harness-parity.test.ts` stracił w ten sposób **1135 z 2767 wierszy** środowiska testowego, a
`runBootHooks(`, `errorEnvelope` i `resolvePreferredLanguage` były niewidoczne dla każdej asercji
`not.toContain` w pliku — zielone, bo tekstu nie było. Gdy najpierw usuwa się komentarze
jednowierszowe, otwiera się symetryczna dziura: `//` wewnątrz komentarza blokowego zabiera ze sobą
jego zakończenie, a komentarz ciągnie się dalej. A w obu kolejnościach znak komentarza wewnątrz
**literału tekstowego** — `'/*'` w teście wieloznacznych typów MIME w `assets_library`,
`'image/*, */*;q=0.5'` w nagłówku Accept w `pim_ergonode` — otwiera lub zamyka komentarz, którego
nie ma. Jest więc jedna implementacja, `backend/scripts/lib/source-text.ts`, która pyta parser,
które fragmenty są komentarzami, zamiast układać dwa przebiegi; `typescript` jest już danymi
wejściowymi dla dziewiętnastu kontroli, a skaner, który wie, czym jest literał tekstowy, nie ma
kolejności do pomylenia. Zamienia komentarze na puste znaki zamiast je usuwać, więc numer wiersza w
wyniku nadal jest numerem wiersza w źródle. Gdy potrzeba czegoś więcej niż usunięcia komentarzy,
czytaj bezpośrednio węzły — robi tak `check-diacritic-folds`, właśnie dlatego, że cztery pliki
celowo cytują błędny jednowierszowy kod, a implementacja na poziomie tekstu zgłaszałaby
dokumentację napisaną po to, by temu błędowi zapobiec, i robi tak też `check-entry-scope`: miała
czwartą kopię tej pary wyrażeń regularnych, a jej przepisanie na ocenę każdego miejsca zadaje
drzewu składni każde pytanie, które wcześniej zadawała tekstowi, więc kopia zniknęła, a nie
została przerobiona. Jej pozostały przebieg tekstowy to **filtr wstępny**, który decyduje, które
54 z 1458 plików trafią do parsera, i celowo jest zbyt szeroki — komentarz cytujący
`new Worker(...)` kosztuje jedno parsowanie i nie może kosztować zgłoszenia.

**Daj stanowi „nic nie przeczytano” własny kod wyjścia.** Kod 2, różny od braku naruszeń (0) i od
znalezionych naruszeń (1), zawsze gdy lista plików, tabela tras albo liczba pobrań okaże się pusta
w drzewie, w którym jest ich setki. To nie jest programowanie defensywne:
`pnpm --filter backend run i18n:hardcoded` rozwiązywało swój domyślny katalog względem katalogu
roboczego, nie znajdowało żadnego pliku z `backend/` i przez cały czas swojego istnienia wypisywało
„0 finding(s) across 0 file(s)” z kodem 0. `check-pdfmake-footprint.sh` kończył się kodem 0, gdy
pdfmake nie był zainstalowany, więc jedyny stan, w którym niczego nie mierzył, był jednocześnie
stanem, w którym zgłaszał dotrzymanie budżetu.

**Wypisuj to, co przeczytałeś, a nie tylko to, co znalazłeś — i wypisuj przypadek *zbyt mały*, a
nie tylko pusty.** Kod 2 odpowiada na „dane wejściowe były puste”. Nie odpowiada na „dane wejściowe
to 7% samych siebie”, a to właśnie się zdarza: 1364 z 1469 plików `.ts` w `backend/src` leży w
`src/modules`, więc przeniesienie tego drzewa zostawia osiem kontroli czytających pozostałe 105
plików, nieznajdujących w nich nic złego i wypisujących `violations=0`. Ten sam kształt objął
siedem przypadków — definicję zbioru, która pomijała działający punkt wejścia, plik, który ukrywał
w sobie miejsce, operator rozproszenia omijający sprawdzanie nadmiarowych właściwości,
usuwanie komentarzy, które zjadało 41% pliku przed dopasowaniem, oraz zbiór zdefiniowany przez
obecność dokładnie tego, co było sprawdzane, przez co nie dało się wykryć jego braku. Każda z nich
była kontrolą, której wynik mówił, co znalazła, i nigdy nie mówił, co przeczytała. Każda kontrola
wypisuje więc jeden wiersz w jednej gramatyce, z `backend/scripts/lib/read-size.ts` albo jego
odpowiednika dla powłoki, `scripts/lib/read-size.sh`:

```
[entry-scope] read: files=1459 sites=47 sources=manifest-index:65/65,package-scripts:18/18
[nul-bytes]   read: files=8288 sources=self-reported
```

`files` to to, co przejście **otworzyło** — nigdy pliki, w których znalazło się zgłoszenie, bo ta
liczba zmienia się wraz ze zgłoszeniami i nie odpowiada na pytanie; `sites` to drobniejszy zbiór,
jeśli kontrola go ma, bo opisane wyżej błędy na poziomie miejsc to dokładnie przypadek, w którym
liczba plików stała w miejscu, a liczba miejsc się zmieniła; a `sources` to **niezależne**
wyprowadzenie, z którym porównywana jest liczebność, bo kontrola, która sama oblicza swój zbiór i
potem go zgłasza, powiedziała to samo dwa razy. Dla przejścia po modułach tym wyprowadzeniem jest
wygenerowany indeks manifestów, przez `scripts/lib/module-population.ts` — każdy zarejestrowany
moduł musi wnieść źródło, a to dolna granica, dla której nikt nie musi wybierać liczby. Tam, gdzie
naprawdę go nie ma, wartością jest dosłownie `self-reported`, a powód znajduje się w
`READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE`. Mechanizm raportowania odrzuca z kodem 2 trzy kształty —
nic nie przeczytano, oczekiwanie równe zeru i przejście krótsze niż oczekiwanie — a
`backend/test/unit/scripts/check-read-size.test.ts` uruchamia każdą kontrolę i porównuje wypisane
liczby z przedziałem zapisanym w `backend/test/helpers/check-read-sizes.ts` (−10% / +50%, celowo
niesymetrycznie: dolna granica to kierunek błędu, a górna tylko zapobiega dezaktualizacji zapisu,
gdy drzewo rośnie).

**Ten przedział jest zapadką na ślepotę, ale nie na dezaktualizację, więc ten sam przebieg wypisuje
obok raport odchyleń.** Zapisana wartość okazała się błędna trzy razy w ciągu dziesięciu dni, dwa
razy po cichu, i za każdym razem mieściła się swobodnie w przedziale: w `check-admin-surface`
dolna granica jest 241 miejsc poniżej zapisu, więc zmiana o 41 wprowadzona przez porcję poprawek
nigdy nie zostanie odrzucona. Przebieg za każdym razem znał tę liczbę — sparsował ją, porównał,
stwierdził, że mieści się w przedziale, i wyrzucił. Teraz zamiast tego ją wypisuje, w `afterAll`,
w każdym przebiegu, zielonym czy czerwonym: jeden blok `[read-size drift]` wskazujący każdy zapisany
wpis, który nie opisuje już drzewa, z wartością zapisaną, zaobserwowaną, różnicą ze znakiem i
informacją, jaką część zapasu do granicy ta zmiana zużyła. Nagłówek to spis —
`3 drifted, 32 agree, 0 not measured, of 35 recorded` — bo raportu, który nic nie mówi, gdy nic
się nie zmieniło, nie da się odróżnić od raportu, który się nie wykonał, a to byłby błąd
nieujawnionego odczytu, który pojawia się w samym narzędziu zbudowanym, by na niego odpowiedzieć;
wpis, którego przebieg nie mógł zmierzyć, jest wskazywany jako *not measured* i nigdy nie jest
liczony jako zgodny. Raport nie dodaje żadnej asercji i żadnej nie osłabia. Istnieje, bo obie
obowiązujące zasady — zapisz wartość ponownie w pull requeście, który ją zmienił, i odczytaj liczbę
ze scalonego drzewa — zakładają, że autor wie, *które* wpisy zmieniła jego zmiana, a to
przyporządkowanie jest obliczeniem, które wykonuje każda kontrola, a nie czymś, co można rozszerzyć
listą kontrolną. Formatowaniem zajmuje się `backend/test/helpers/read-size-drift.ts`, a jego
gramatyka jest wiążąca.

**Rejestr działa w obie strony albo jest listą wyjątków.** Niezarejestrowane naruszenie przerywa
build, *a* wpis, który nie opisuje już naruszenia, też. To ta druga połowa się psuje:
`PORT_CATCHES_TO_DRAIN`, `BARE_SUBSCRIPTIONS_TO_DRAIN`, `UNTRANSLATED_ERROR_CODES` i
`HARDCODED_STRINGS_BASELINE` są sprawdzane pod kątem nieaktualnych wpisów, a każdy wpis ma
uzasadnienie zapisane jako stwierdzenie o tym, co wskazuje — dlaczego „nadal podłączane ręcznie”
nim nie jest, wyjaśnia sekcja „Jak pisać uzasadnienie kolejności, które się nie zdezaktualizuje”
wyżej. **Jawne wyłączenie w kontroli też jest rejestrem**: `command-coverage-ignore` miał 185
wpisów i przez długi czas nikt nie sprawdzał ich aktualności, więc wyłączenie napisane dla zapisu,
który potem przeniesiono, nadal zwalniało metodę, która tego już nie potrzebowała, a następny
dodany tam zapis dziedziczył zwolnienie. Gdy stały dług jest zbyt duży, by każdy wpis miał
uzasadnienie — 274 teksty wpisane na stałe na 47 ekranach panelu — wpisem staje się **plik**, a
wartością liczba, co działa jako zapadka w obie strony i nie wymaga pisania tego samego zdania 274
razy.

**Kontrola, której nie uruchamia żadne zadanie CI, jest gorsza niż brak kontroli**, bo samo jej
istnienie sugeruje pokrycie. Dwie przez długi czas nie działały nigdzie, a jedną z nich przywoływano
jako *tę* kontrolę, która pilnuje reguły tylko angielskiego w tekstach dla użytkowników —
twierdzenie, którego repozytorium nie potwierdzało. Powodem, dla którego kontrola nie jest
podłączona, prawie nigdy nie jest „ta właściwość przestała mieć znaczenie”: to stały dług (zamień
go w zapadkę) albo założenie dotyczące środowiska, którego nikt nie sprawdził ponownie (o kontroli
pdfmake mówiono, że wymaga zainstalowanego `node_modules`, które musiałoby dodać zadanie `quality`,
a to zadanie od zawsze instaluje je w `before_script`). Tę decyzję zapisuje się w polu `job`
inwentarza, a wartość `none` trzeba we wpisie uzasadnić.

Miejscem egzekwowania jest `backend/test/unit/scripts/check-inventory.test.ts`. Wylicza każdy
skrypt `check-*` i dla każdego **uruchamia własną analizę kontroli, od jej początku, na
syntetycznym naruszeniu każdego kształtu, który kontrola deklaruje, że odrzuca, i sprawdza, że
wraca zgłoszenie tego rodzaju**. To celowo więcej niż „istnieje towarzyszący plik testu”: plik pod
jakąś ścieżką niczego nie dowodzi, a o tym właśnie jest cała ta sekcja. Towarzyszący test wskazany
we wpisie to miejsce na szczegóły kształtu — asercję na komunikacie, rejestr, kod wyjścia — a
inwentarz pilnuje, by kształt nie zniknął przy edycji tamtego pliku. Inwentarz utrwala też, które
zadanie CI uruchamia każdą kontrolę, i porównuje to z `.gitlab-ci.yml`, więc kontrola, która po
cichu opuszcza zadanie, musi to zadeklarować, oraz to, czy kontrola ujawnia, ile przeczytała —
same liczby są w `backend/test/helpers/check-read-sizes.ts`, a to, co ich nie ujawnia, trafia do
działającego w obie strony `READ_SIZE_DEFERRED`.

### Benchmark najpierw sprawdza, że coś zmierzył, a dopiero potem, ile to trwało

Poprzednia sekcja dotyczy reguły, która nie widzi. Ta dotyczy tego samego błędu w **pomiarze** i
łatwiej go przeoczyć, bo liczba wypisywana przez benchmark nigdy nie jest *błędna* — po prostu nie
dotyczy tego, po co ktoś ją czyta. `test/perf/catalog-list.bench.ts` tworzył syntetyczny zbiór
danych, który nie należał do żadnego kanału sprzedaży, więc `filterByChannel` odrzucał każdy
wiersz (zawężanie do kanału odmawia w razie wątpliwości), a mierzona strona zawierała zero
podsumowań. Zgłaszał p95 równe 7 ms i był zielony od dnia wprowadzenia zawężania do kanału; po
przypisaniu danych do kanału ten sam odczyt trwa 13–18 ms, a cała różnica to praca na
podsumowaniach, która nigdy się nie wykonywała. **Budżet dotrzymany dlatego, że nic nie mierzono, i
budżet dotrzymany dlatego, że jest szybko, wyglądają w CI identycznie.**

Benchmarkowi trzeba więc zadać to samo pytanie co kontroli: *gdyby mierzona rzecz po cichu nic nie
robiła, czy by to zauważył?* Wynikają z tego cztery reguły.

**Licz pracę w tej samej pętli, która ją mierzy, i najpierw sprawdzaj tę liczbę.** Nie test dymny w
sąsiednim pliku — sam mierzony przebieg ma zawierać dowód: podsumowania na stronę, rzutowane
atrybuty, obsłużone pozycje koszyka, zwróconych kandydatów do sprzedaży dodatkowej, wygenerowane
produkty, przetworzone koszyki, rozwiązane wpisy rejestru. Sprawdzaj tę liczbę **przed** asercją
czasu, aby przebieg, który nic nie zmierzył, kończył się błędem, który to mówi, a nie
przekroczeniem budżetu o niewyjaśnioną wartość — albo, co gorsza, jego dotrzymaniem.

**Wypisuj obok czasu to, co zmierzono.** Każdy wiersz `[perf/*]` zawiera własny mianownik, bo osoba
czytająca log benchmarku zwykle porównuje dwa przebiegi oddalone o tygodnie, a p95, które spadło o
połowę, bo dane testowe przestały dawać wiersze, jest nie do odróżnienia od p95, które spadło o
połowę, bo kod przyspieszył.

**Korzystaj z wyniku.** Mikrobenchmark, który odrzuca zwracaną wartość, mierzy wywołanie, które V8
może całkowicie wyeliminować. `enabled-check.bench.ts` zaczął zamiast tego liczyć odpowiedzi, a
uczciwa liczba okazała się wyższa niż ta, którą wcześniej zgłaszał — i to jest poprawka, a nie
regresja.

**Warunek wstępny scenariusza to asercja, a nie komentarz.** „Zimna ścieżka” była wywołaniem
`redis.del` na dwuwarstwowej pamięci podręcznej: lokalna dla procesu pamięć LRU przed Redis nadal
odpowiadała, więc scenariusz zimny mierzył ciepły i oba wypisywały 0,1 ms. Pętla usuwa teraz obie
warstwy i przed startem sprawdza, że pamięć podręczna zgłasza chybienie. Tam, gdzie to dane testowe
sprawiają, że pomiar jest prawdziwy — przynależność do kanału, wiersze `product_links` dla paska
sprzedaży dodatkowej — utwórz je, a potem sprawdź, że endpoint je zwrócił.

Jeśli zabezpieczenie wykaże wtedy przekroczenie budżetu, **zgłoś to; nie podnoś budżetu**.
Odróżnienie „jesteśmy wolniejsi, niż deklarowaliśmy” od „nigdy tego nie mierzyliśmy” to cała
wartość tego zabezpieczenia, a liczba przesunięta po to, by build był zielony, niszczy oba.

Jedno zastrzeżenie, które ujawnił ten sam incydent: te benchmarki zależą od `PERF_RUN`, a **żadne
zadanie CI go nie ustawia**, więc w pipeline nigdy nie wykonał się żaden z nich.
`test/perf/catalog/visible-attributes.bench.ts` od wprowadzenia zawężania do kanału rzucał
wyjątek, zamiast mierzyć czas, a jedynym, co by to wykazało, jest
`pnpm --filter backend run test:perf`. Uruchamiaj go lokalnie, gdy zmieniasz gorącą ścieżkę;
zadanie uruchamiane według harmonogramu to stały dług.
