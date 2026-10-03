---
title: Izolacja tenantów (multi-tenant)
---

# Izolacja tenantów

Backend wymusza izolację multi-tenant na poziomie **frameworka**, a nie przez
klauzule `where` w poszczególnych serwisach. Każda
trwała encja jest klasyfikowana raz, a odczyty i zapisy są automatycznie ograniczane
do tenantu wywołującego na warstwie dostępu do danych — izolacja działa nawet wtedy, gdy
serwis zapomni o jawnym filtrze.

## Jak to działa

- **Ambient `TenantContext`** — ustawiany raz na żądanie (lub job w tle) na podstawie
  uwierzytelnionego aktora i przenoszony przez łańcuch wywołań async przez
  `AsyncLocalStorage`. Jest wyprowadzany po stronie serwera i **nigdy** nie pochodzi z
  body żądania, query string ani nagłówków.
  - Klient → `single-org` (jego organizacja + konto klienta).
  - Admin platformy → `all` (bez ograniczeń).
  - Admin handlowca z zakresem → `allowed-set` (przypisane organizacje).
  - Worker / migracja / escape hatch → `system`.
- **Globalne filtry MikroORM** (`org`, `customerAccount`) czytają ambient context
  bezpośrednio w czasie zapytania i dodają predykat tenantowy. Ponieważ czytają context
  per zapytanie (a nie per fork), działają na sub-forkach `em.transactional` i każdym
  innym forku.
- **Fail-closed** — zapytanie przeciw encji objętej tenantem **bez** ambient context
  rzuca `MissingTenantContextError`. Zapomniany context to głośny błąd,
  nigdy cichy odczyt między tenantami.

## Klasyfikacja encji

Dodaj **dokładnie jeden** dekorator klasyfikacji do każdego `*.entity.ts` (w przeciwnym razie
check CI `check-entity-tenant-classification.ts` blokuje build):

| Dekorator | Użyj, gdy encja… |
|-----------|----------------------|
| `@OrgScoped()` | ma kolumnę `organizationId` |
| `@CustomerScoped()` | ma kolumnę `customerAccountId` i brak kolumny org |
| `@TransitivelyScoped('Parent', 'fk')` | jest objęta org przez agregat nadrzędny (np. `Invoice` → `Order`) |
| `@RuleScoped()` | trafia do org przez regułę/JSONB, nie kolumnę (np. `price_lists.applicationRule`) |
| `@GlobalEntity()` | jest globalna/platformowa / konfiguracyjna (bez tenantu) |

`@OrgScoped` / `@CustomerScoped` dołączają filtr; pozostałe to tylko metadane —
egzekwowanie (tam, gdzie potrzebne) jest jawne w serwisie właściciela.

**Rodzic tranzytywny jest nazwany nazwą klasy, nie samą klasą.** Oba łańcuchy
tranzytywne tej platformy przekraczają granicę modułu, a moduł,
który stał się pakietem, publikuje tablicę `entities` i nie nazwaną klasę encji — więc
`@TransitivelyScoped(() => Order, 'orderId')` byłby importem, którego dziecko nie może
napisać. Nazwa jest rozwiązywana leniwie w rejestrze klasyfikacji, bo dziecko jest
rutynowo importowane przed rodzicem, a cały rejestr jest uzgadniany raz przy starcie, w
`backend/src/db/configured-entities.ts`, tuż po uruchomieniu każdego dekoratora
klasyfikacji i przed powstaniem ORM. Nazwa, która nie rozwiązuje się do niczego —
albo do więcej niż jednej encji — zatrzymuje start z
`UnresolvableTenantParentError`. Nie ma fallbacku: encja tranzytywnie objęta nie ma
własnej kolumny tenantowej, więc łańcuch, który cicho przestał się rozwiązywać, byłby
odczytem bez tenantu.

**Nie piszesz filtra tenantowego ręcznie** — `em.find(MyEntity, { ...business filters })`
jest już ograniczone do ambient tenantu.

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
Domyślnie jest to ustrukturyzowana linia `tenant.escape_hatch` na stderr, a nie wiersz
`audit_log_entries`. Przeszukanie repozytorium pod kątem `withSystemScope` i `enterSystemScope`
wylicza każdy dostęp do danych wielu organizacji.

`@endora-commerce/platform/tenancy` to jedna z pięciu ścieżek platformy, które moduł może
importować (`kernel`, `http`, `tenancy`, `commands`, `events`); `check:platform-surface` zgłasza
moduł importujący jakąkolwiek inną ścieżkę platformy.

**Przypięcie pracy do jednej organizacji nie jest dostępne dla modułów.** Platforma implementuje
`withOrgScope(organizationId, reason, fn)` obok `withSystemScope`
(`packages/platform/src/tenancy/escape-hatch.ts`), ale funkcji nie ma w opublikowanym barrelu, bo
w chwili jego wydzielenia nie używał jej żaden moduł. Moduł, który dziś potrzebuje zadania dla
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
więc zachowanie między tenantami jest testowane naprawdę. Testy hosta mogą wywołać
`runWithoutTenantContext(fn)` (`packages/platform/src/tenancy/tenant-context.ts`), aby jawnie
sprawdzić odmowę przy braku kontekstu; tej funkcji nie ma w opublikowanym barrelu.
