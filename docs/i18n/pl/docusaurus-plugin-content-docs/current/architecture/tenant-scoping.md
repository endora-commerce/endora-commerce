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

## Przekraczanie tenantów (escape hatch)

**Jedyny** sankcjonowany sposób odczytu między organizacjami to audytowany, łatwy do
przeszukania escape hatch:

```ts
import { withSystemScope, withOrgScope } from '../../tenancy/escape-hatch.js';

// odczyt platformowy (raportowanie, uzgadnianie, migracje)
await withSystemScope('nightly reconciliation', () => em.find(Order, { status: 'paid' }));

// przypięcie do jednej organizacji (job w tle per org)
await withOrgScope(job.data.organizationId, 'rfq-expiry sweep', () => sweep());
```

Oba wymagają niepustego `reason` i emitują wpis audytu. Przeszukanie repozytorium pod
`withSystemScope|withOrgScope` wymienia każdy dostęp między org.

## Joby w tle

Konsumenci kolejek działają odłączeni od żądania, więc domyślnie **nie mają** contextu
i muszą go ustawić jawnie — w przeciwnym razie zapytanie objęte tenantem
fail-closed. Owiń przetwarzanie joba w `withSystemScope` (sweep platformowy) lub
`withOrgScope(orgId, …)` (job per org).

## Testy

Harness testowy ustawia domyślny context `system` (`test/tenancy-setup.ts`), żeby
seed/cleanup bezpośrednio przez EM działał bez owijania każdego miejsca; pipeline
żądań nadal nadpisuje go prawdziwym scoped context, więc zachowanie między tenantami
jest testowane na serio. Użyj `runWithoutTenantContext(fn)`, aby jawnie asercjonować
zachowanie fail-closed.
