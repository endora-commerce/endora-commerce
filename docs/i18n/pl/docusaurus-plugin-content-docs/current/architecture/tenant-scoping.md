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

## Testy

Środowisko testowe backendu ustawia domyślny kontekst `system` (`backend/test/tenancy-setup.ts`),
dzięki czemu przygotowanie i sprzątanie danych bezpośrednio przez EntityManager działa bez
owijania każdego wywołania; obsługa żądań i tak nadpisuje go prawdziwym, zawężonym kontekstem,
więc zachowanie między tenantami jest testowane naprawdę. To środowisko nie przechodzi przez `composeApp`, więc
nie dołącza zapisu audytu, a jego wpisy obejścia trafiają tylko na stderr. Testy hosta mogą wywołać
`runWithoutTenantContext(fn)` (`packages/platform/src/tenancy/tenant-context.ts`), aby jawnie
sprawdzić odmowę przy braku kontekstu; tej funkcji nie ma w opublikowanym barrelu.
