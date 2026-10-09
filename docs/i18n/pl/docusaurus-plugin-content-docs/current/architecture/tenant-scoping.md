---
title: Izolacja tenantów
---

# Izolacja tenantów

Backend wymusza izolację tenantów **zabezpieczeniem na poziomie frameworka**, a nie klauzulami
`where` dopisywanymi w każdej usłudze z osobna. Każda utrwalana encja jest klasyfikowana raz, a
odczyty i zapisy są automatycznie ograniczane do tenanta wywołującego już w warstwie dostępu do
danych — izolacja działa więc nawet wtedy, gdy usługa zapomni o jawnym filtrze.

## Jak to działa

- **Kontekst `TenantContext`** — ustawiany raz na żądanie (albo zadanie w tle) na podstawie
  uwierzytelnionego użytkownika i przekazywany przez cały asynchroniczny łańcuch wywołań za pomocą
  `AsyncLocalStorage`. Jest wyznaczany po stronie serwera i **nigdy** nie pochodzi z treści
  żądania, parametrów zapytania ani nagłówków.
  - Klient → `single-org` (jego organizacja i konto klienta).
  - Administrator platformy → `all` (bez ograniczeń).
  - Administrator-handlowiec z ograniczonym zakresem → `allowed-set` (przypisane mu organizacje).
  - Worker, migracja, jawne obejście → `system`.
  - Klucz API powiązany z organizacją → `single-org` (jego organizacja i konto serwisowe);
    klucz niepowiązany i ruch anonimowy → `system`.

  **To mapowanie należy do platformy i dostaje je każda kompozycja.** `composeApp` instaluje je
  razem z hookiem zakresu żądania, więc instancja — której punkt wejścia wywołuje
  `composeApp({ deploymentRoot })` i nic więcej — działa z nim bez żadnej dodatkowej konfiguracji.
  Odpowiedzi należące do modułów są odczytywane przez porty rejestrowane przez skomponowane
  moduły: `customerRollupScopePort` (`customer_accounts`) dla rozszerzenia na poddrzewo w przypadku
  konta z włączonym roll-upem oraz `adminTenantScopePort` (`organizations`) dla organizacji, do
  których rola administratora daje dostęp. Kompozycja, która nie rejestruje żadnego z nich,
  **zawęża, a nie rozszerza**: klient pozostaje w swojej organizacji, a administrator nie ma
  dostępu do żadnej organizacji — `composeApp` zapisuje przy starcie ostrzeżenie, gdy brakuje
  `adminTenantScopePort`, co jest typowym objawem częściowej aktualizacji. Administrator jest
  zawężany tak samo, gdy moduł `organizations`, `admin_users` lub `admin_roles` jest nieobecny:
  trasy operujące na danych globalnych nadal odpowiadają, a pierwszy odczyt objęty izolacją
  odpowiada kodem 503 `MODULE_DISABLED` ze wskazaniem nieobecnego modułu zamiast pustym wynikiem.
  **Administrator bez roli jest odrzucany w ten sam sposób**: zasięg wynika z roli, więc bez niej
  administrator nie ma dostępu do żadnej organizacji, a pierwszy odczyt objęty izolacją odpowiada
  kodem 403 `ADMIN_ROLE_REQUIRED` — brak roli nigdy nie oznacza „wszystkie organizacje”.
  `ComposeAppOptions.buildTenantContext` zastępuje mapowanie we wdrożeniu, które tego potrzebuje,
  a zamiennik jest odrzucany — żądanie kończy się błędem — gdy na żądanie klienta lub klucza API
  powiązanego z organizacją odpowiada kontekstem `system` albo `all`, a na żądanie administratora
  kontekstem `system`.

  **O tym, czyje jest żądanie, decyduje trasa, a nie to, jakie ciasteczka są obecne.** Jedna
  przeglądarka może mieć jednocześnie sesję administratora i sesję klienta — operator zalogowany
  także w sklepie oraz każde żądanie wykonywane podczas impersonacji. Kontekst jest otwierany na
  podstawie bieżącego aktora, którym jest sesja klienta, o ile jest obecna, a rozstrzyga go
  zabezpieczenie samej trasy:
  - trasa za `requireAdmin` działa jako administrator i w zakresie administratora, a wykonane
    przez nią polecenie (Command) zapisuje administratora;
  - trasa za `requireCustomer` działa jako klient i w zakresie klienta — podczas impersonacji
    z zapisanym obok klienta administratorem, który go impersonuje;
  - trasa bez żadnego z nich zachowuje kontekst bieżącego aktora;
  - zabezpieczenie odrzuca żądanie, które niesie wyłącznie tę drugą sesję. Nigdy nie przechodzi
    na zakres tamtej sesji.

  Zabezpieczenie trasy jest jedynym źródłem obu odpowiedzi. Gdy zaakceptuje aktora, wywołuje
  `scopeRequestToActor(request)` (`@endora-commerce/platform/kernel`), a platforma wyznacza
  kontekst żądania ponownie, tym samym mapowaniem. Moduł publikujący własne zabezpieczenie, które
  wybiera między sesjami, wywołuje tę funkcję tak samo; nie przyjmuje ona kontekstu, więc nie da
  się nią żadnego wybrać.
- **Globalne filtry MikroORM** (`org`, `customerAccount`) odczytują bieżący kontekst bezpośrednio
  w chwili wykonania zapytania i dodają warunek ograniczający do tenanta. Ponieważ odczytują
  kontekst przy każdym zapytaniu (a nie przy każdym forku EntityManagera), działają też w forkach
  tworzonych przez `em.transactional` i w każdym innym forku.
- **Odmowa w razie braku kontekstu (fail-closed)** — zapytanie do encji objętej izolacją wykonane
  **bez** kontekstu rzuca `MissingTenantContextError`. Zapomniany kontekst to głośny błąd, a
  nigdy cichy odczyt danych innego tenanta.

## Klasyfikacja encji

Do każdego pliku `*.entity.ts` dodaj **dokładnie jeden** dekorator klasyfikacji (w przeciwnym razie
kontrola CI `check-entity-tenant-classification.ts` przerwie build):

| Dekorator | Użyj, gdy encja… |
|-----------|----------------------|
| `@OrgScoped()` | ma kolumnę `organizationId` |
| `@CustomerScoped()` | ma kolumnę `customerAccountId`, a nie ma kolumny organizacji |
| `@TransitivelyScoped('Parent', 'fk')` | należy do organizacji przez agregat nadrzędny (np. `Invoice` → `Order`) |
| `@RuleScoped()` | wskazuje organizacje przez regułę lub JSONB, a nie kolumnę (np. `price_lists.applicationRule`) |
| `@GlobalEntity()` | jest globalna dla platformy albo jest konfiguracją (bez tenanta) |

`@OrgScoped` i `@CustomerScoped` podpinają filtr; pozostałe dekoratory to wyłącznie metadane — ich
egzekwowanie (tam, gdzie jest potrzebne) odbywa się jawnie w usłudze będącej właścicielem encji.

**Encję nadrzędną wskazuje się nazwą klasy, a nie samą klasą.** Oba łańcuchy przechodnie w tej
platformie przekraczają granicę modułu, a moduł, który stał się pakietem, publikuje tablicę
`entities`, a nie nazwane klasy encji — więc `@TransitivelyScoped(() => Order, 'orderId')`
wymagałoby importu, którego encja podrzędna nie może wykonać. Nazwa jest rozwiązywana leniwie w
rejestrze klasyfikacji, bo encja podrzędna jest zwykle importowana przed nadrzędną, a cały rejestr
jest uzgadniany raz przy starcie, w `backend/src/db/configured-entities.ts` — tuż po wykonaniu
wszystkich dekoratorów klasyfikacji, a zanim powstanie ORM. Nazwa, która nie wskazuje żadnej
encji — albo wskazuje więcej niż jedną — zatrzymuje start błędem `UnresolvableTenantParentError`.
Nie ma wartości zastępczej: encja objęta izolacją przechodnio nie ma własnej kolumny tenanta, więc
łańcuch, który po cichu przestałby się rozwiązywać, oznaczałby odczyt bez żadnej izolacji.

Filtra tenanta **nie piszesz** ręcznie — `em.find(MyEntity, { ...business filters })` jest już
ograniczone do bieżącego tenanta.

## Dostęp między tenantami (jawne obejście)

**Jedyny** dozwolony sposób odczytu danych wielu organizacji to audytowane, łatwe do wyszukania
w kodzie obejście. Moduł importuje je z opublikowanego barrela tenancy platformy:

```ts
import { withSystemScope } from '@endora-commerce/platform/tenancy';

// odczyt w skali platformy w wykonaniu, które ma już kontekst
// (raporty, uzgadnianie)
await withSystemScope('nightly reconciliation', () => em.find(Order, { status: 'paid' }));
```

`withSystemScope` wymaga niepustego uzasadnienia (`reason`) i emituje jeden wpis audytu obejścia.
Przeszukanie repozytorium pod kątem `withSystemScope` i `enterSystemScope` wylicza każdy dostęp do
danych wielu organizacji.

### Jak dostęp między tenantami trafia do audytu

Każde poszerzenie zakresu jest zapisywane dwa razy:

- **Ustrukturyzowana linia na stderr**, zapisywana synchronicznie w chwili wywołania:
  `{"level":"info","msg":"tenant.escape_hatch","scope":"system","reason":"…"}`, a do tego
  `organizationId` dla zakresu przypiętego do organizacji i `entryPoint` dla zakresu, który otwiera
  `enterSystemScope`.
- **Wiersz w `audit_log_entries`** z akcją `tenant.escape_hatch`. Dziennik audytu w panelu
  administracyjnym pokazuje te wiersze jako *Dostęp między organizacjami*. `composeApp` dołącza
  zapis do każdego serwera, workera i polecenia CLI, które składa aplikację, zarówno w tym
  repozytorium, jak i w instancji wygenerowanej ze scaffoldu. Polecenia operatorskie `module:*` nie
  składają aplikacji, więc dołączają zapis same.

Wiersz jest zapisywany **asynchronicznie**. Obejście jest często używane, zanim powstanie
jakakolwiek transakcja (w hooku uwierzytelniania, w pierwszej linii zadania workera, w mechanizmie
uzgadniającym przy starcie), a większość takich dostępów to odczyty. Wiersz audytu w transakcji
wywołującego zostałby wycofany razem z nieudanym odczytem i wymazałby dostęp, który naprawdę
nastąpił. Dlatego wpis jest przechwytywany w chwili wywołania i zapisywany mniej więcej co 10 sekund
na osobnym forku EntityManagera. Wywołujący nigdy nie czeka na zapis audytu.

Identyczne dostępy w jednym oknie są **agregowane, a nie próbkowane**. Dwa dostępy trafiają do
jednego wiersza tylko wtedy, gdy mają ten sam zakres, uzasadnienie, docelową organizację, moduł,
punkt wejścia, aktora i impersonację. Wiersz liczy każde wystąpienie:

| Kolumna | Wartość |
|---|---|
| `object_type`, `object_id` | `organization` i jej identyfikator dla zakresu przypiętego do organizacji; w pozostałych przypadkach `tenant_scope` i `system` |
| `actor_admin_user_id`, `impersonated_customer_account_id` | administrator, który spowodował dostęp, i klient, w którego imieniu działał, jeśli taki jest |
| `request_id`, `ip_address`, `user_agent` | ustawiane, gdy wszystkie wystąpienia w wierszu pochodzą z jednego żądania |
| `acted_at` | pierwsze wystąpienie |
| `state_after` | `scope`, `reason`, `organizationId`, `module`, `entryPoint`, `occurrences`, `firstAt`, `lastAt`, do 20 identyfikatorów `requestIds` oraz `actor`: rodzaj i identyfikator aktora, a także `context`, czyli uzasadnienie zakresu, w którym wywołujący już działał, na przykład `actor:anonymous` dla anonimowego żądania sklepu |

Agregacja ma znaczenie, bo dwa dostępy odbywają się przy każdym uwierzytelnionym żądaniu sklepu:
`auth: resolve customer org` i `tenant: resolve customer roll-up flag`. Pole `module` jest
ustalane na podstawie stosu wywołań. Wskazuje pakiet modułu albo moduł overlay, który wykonał
wywołanie, `platform` dla jądra i `host` dla punktu wejścia aplikacji.

**Nieudany zapis niczego nie gubi.** Linia na stderr jest już zapisana. Partia wraca do kolejki,
scalona ze wszystkim, co zarejestrowano w międzyczasie, i jest ponawiana przy następnym cyklu, a w
logu pojawia się `tenant.escape_hatch.persist_failed`. Przy długiej awarii ponad 5000 różnych
oczekujących wpisów zostaje złożonych w jeden wiersz przepełnienia na zakres i moduł, więc awaria
kosztuje szczegóły, ale zachowuje liczbę wystąpień. Przy zamykaniu `dispose()` wykonuje ostatni
zapis. Wszystko, czego nadal nie udało się zapisać, trafia na stderr jako jedna linia
`tenant.escape_hatch.unpersisted` na wiersz. Polecenie operatorskie, które nigdy nie otworzyło bazy
danych, nie odczytało danych żadnej organizacji i wypisuje swoje wpisy jako
`tenant.escape_hatch.not_persisted`.

Zapis audytu sam nie korzysta z obejścia, więc niczego nie rejestruje i nie może wywołać rekurencji.
Modułu `audit_logs` nie da się wyłączyć. Zapis tych wierszy i tak od niego nie zależy, bo zapis i
tabela `audit_log_entries` należą do platformy. Moduł dostarcza tylko przeglądarkę.

`@endora-commerce/platform/tenancy` to jedna z pięciu ścieżek platformy, które moduł może
importować (`kernel`, `http`, `tenancy`, `commands`, `events`); `check:platform-surface` zgłasza
moduł importujący jakąkolwiek inną ścieżkę platformy.

**Przypięcie pracy do jednej organizacji nie jest dostępne dla modułów.** Platforma implementuje
`withOrgScope(organizationId, reason, fn)` obok `withSystemScope`
(`packages/platform/src/tenancy/escape-hatch.ts`), ale funkcji nie ma w opublikowanym barrelu:
decyzja D-285 zostawia ją wyłącznie platformie, dopóki moduł nie będzie potrzebował pracy
przypiętej do jednej organizacji, której nie da się bezpiecznie wyrazić zakresem systemowym
z jawnym ograniczeniem do `organizationId` (`specs/conventions/module-composition.md`,
punkt 10a). Moduł, który dziś potrzebuje zadania dla
jednej organizacji, uruchamia je w zakresie systemowym i sam filtruje po `organizationId`.

## Zadania w tle

Konsumenci kolejek działają niezależnie od żądań, więc domyślnie **nie mają** kontekstu i muszą go
ustawić jawnie — w przeciwnym razie zapytanie do encji objętej izolacją zostanie odrzucone.
Uruchom zadanie w `enterSystemScope(reason, fn)` z `@endora-commerce/platform/kernel`: otwiera ono
w jednym kroku systemowy kontekst tenanta i zakres rozwiązywania platformy oraz emituje ten sam
wpis audytu obejścia co `withSystemScope`. `withSystemScope` służy do poszerzenia wykonania, które
ma już kontekst, na przykład handlera trasy.

### Cykliczne zadanie, które nie ma nic do zrobienia, nie otwiera zakresu

Zadanie cykliczne — BullMQ Job Scheduler albo timer — to jedyny wywołujący, przy którym agregacja
audytu nie działa: jego takty są od siebie dalej niż jedno okno zapisu, więc zakres otwierany przy
każdym takcie to jeden wiersz `tenant.escape_hatch` na takt, niezależnie od tego, czy takt cokolwiek
zrobił. Worker uruchamiany co sześćdziesiąt sekund zapisuje 1440 wierszy na dobę w instancji, w
której nic się nie wydarzyło, a te wiersze zasłaniają wpisy, których szuka audytor. Dziennik audytu
służy do zapisywania tego, co się wydarzyło.

Dlatego takt zadania cyklicznego **najpierw pyta, a zakres otwiera tylko wtedy, gdy jest praca**:

```ts
export async function runSweepTick(deps: SweepDeps): Promise<void> {
  let hasWork = true;
  try {
    hasWork = await deps.service.hasSweepWork(); // bez zakresu: anyRowExists(…), tak albo nie
  } catch (error) {
    rethrowIfModuleDisabled(error); // wyłączenie modułu nigdy nie jest pochłaniane
    hasWork = true; // nie wiadomo — działaj jak dotąd, z zakresem i wierszem audytu
  }
  if (!hasWork) return;
  await enterSystemScope('orders: sweep outstanding order follow-ups', () => deps.service.sweep());
}
```

Pytanie działa **bez** kontekstu tenanta, więc nie może przejść przez encję objętą izolacją — taki
odczyt celowo kończy się błędem `MissingTenantContextError`. Jest to surowe zapytanie do własnych
tabel modułu i obowiązują je cztery reguły. To one sprawiają, że nie staje się ono sposobem na
ominięcie audytu:

1. **Zwraca jedną wartość logiczną.** `select exists(…)` i nic więcej: żadnego wiersza, żadnego
   identyfikatora, żadnej organizacji, żadnej liczby. Wywołujący, który dowiaduje się tylko „idź i
   sprawdź”, nie odczytał danych żadnego tenanta — dlatego nie ma czego zapisywać. Pytanie, które
   zwraca cokolwiek więcej, jest nieaudytowanym odczytem między tenantami. W takim przypadku otwórz
   zakres. Pytanie nie wykonuje własnego zapytania: przekazuje źródła wierszy `from … where …` do
   `anyRowExists` (`services/scheduled-work-probe.ts` w module), które buduje `select exists(…)`
   i zwraca `true` albo `false`. Nie ma listy kolumn, którą wywołujący mógłby poszerzyć.
   `backend/test/unit/tenancy/scheduled-work-probes.test.ts` wymienia pytania i kończy się błędem,
   gdy któreś z nich samo cokolwiek odczytuje, więc nowe pytanie dopisuje się do tej listy.
   Zapytania wykonanego przed otwarciem zakresu inną drogą ten test nie widzi — wychwyci je tylko
   przegląd kodu.
2. **Jest własnym warunkiem zadania.** `false` musi oznaczać, że przebieg niczego by nie odczytał
   ani nie zapisał. Pytanie węższe niż przebieg to praca, która po cichu nigdy się nie wykona,
   dlatego każdy warunek zapisz **raz** i niech czytają go oba miejsca — przebieg, żeby działać,
   pytanie, żeby zapytać. Jeśli przebieg wybiera wiersze przez ORM i nie może współdzielić
   zapytania, zostaw dwa i pokryj każdą gałąź testem, w którym tylko ta gałąź sprawia, że takt
   wykonuje swoją pracę. Jeśli dokładny warunek wymaga czegoś, co należy do zakresu — ustawienia
   albo portu innego modułu — zadaj szersze pytanie, które może się mylić tylko w stronę `true`.
3. **Jego odpowiedź nigdy nie trafia do przebiegu.** Praca odczytuje wszystko ponownie wewnątrz
   zakresu. Pytanie rozstrzyga, *czy* zakres zostanie otwarty, nigdy *co* się w nim wykona.
4. **Pytanie zakończone błędem liczy się jako `true`.** Takt działa wtedy dokładnie tak jak
   wcześniej, razem z wierszem audytu. Błąd pytania może kosztować jeden wiersz i nigdy nie może
   go oszczędzić.

Pytanie niczego nie zmienia w rozstrzyganiu obecności modułu. Takt, który sam rozstrzyga obecność,
robi to przed pytaniem, więc wyłączony moduł o nic nie pyta swoich tabel; konsument zatrzymywany
razem z modułem przez mechanizm workerów platformy w ogóle nie dochodzi do pytania.

Pytanie to jedno zapytanie na takt, ale niekoniecznie odczyt z indeksu: kosztuje tyle, ile własny
wybór wierszy przebiegu. Jeśli tabela jest duża, załóż indeks na warunek.

Takt, który ma pracę, jest zapisywany dokładnie tak jak dotąd. To samo dotyczy każdego zadania,
które jest pracą z definicji — konsumenta kolejki, który dostał zadanie do wykonania, zaplanowanego
generowania feedu, sprawdzenia taksonomii. Przed nimi nie umieszczaj pytania. Jeśli nie da się
uczciwie zadać pytania bez zakresu, zostaw zakres tam, gdzie jest, i zaakceptuj wiersz: nadmiarowy
wiersz audytu to szum, a brakujący to luka.

Ta reguła dotyczy wyłącznie taktów zadań cyklicznych. Wejścia do zakresu wykonywane przy starcie
procesu (`boot: …`) nadal są zapisywane po jednym wierszu każde.

## Testy

Środowisko testowe backendu ustawia domyślny kontekst `system` (`backend/test/tenancy-setup.ts`),
dzięki czemu przygotowanie i sprzątanie danych bezpośrednio przez EntityManager działa bez
owijania każdego wywołania; obsługa żądań i tak nadpisuje go prawdziwym, zawężonym kontekstem,
więc zachowanie między tenantami jest testowane naprawdę. To środowisko nie przechodzi przez `composeApp`, więc
nie dołącza zapisu audytu, a jego wpisy obejścia trafiają tylko na stderr. Testy hosta mogą wywołać
`runWithoutTenantContext(fn)` (`packages/platform/src/tenancy/tenant-context.ts`), aby jawnie
sprawdzić odmowę przy braku kontekstu; tej funkcji nie ma w opublikowanym barrelu.
