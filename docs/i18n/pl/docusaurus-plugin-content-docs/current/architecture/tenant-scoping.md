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
w kodzie obejście:

```ts
import { withSystemScope, withOrgScope } from '../../tenancy/escape-hatch.js';

// odczyt w skali platformy (raporty, uzgadnianie, migracje)
await withSystemScope('nightly reconciliation', () => em.find(Order, { status: 'paid' }));

// przypięcie do jednej organizacji (zadanie w tle dla jednej organizacji)
await withOrgScope(job.data.organizationId, 'rfq-expiry sweep', () => sweep());
```

Obie funkcje wymagają niepustego uzasadnienia (`reason`) i zapisują wpis audytu. Przeszukanie
repozytorium pod kątem `withSystemScope|withOrgScope` wylicza każdy dostęp do danych wielu
organizacji.

## Zadania w tle

Konsumenci kolejek działają niezależnie od żądań, więc domyślnie **nie mają** kontekstu i muszą go
ustawić jawnie — w przeciwnym razie zapytanie do encji objętej izolacją zostanie odrzucone. Owiń
przetwarzanie zadania w `withSystemScope` (operacja w skali całej platformy) albo
`withOrgScope(orgId, …)` (zadanie dla jednej organizacji).

## Testy

Środowisko testowe ustawia domyślny kontekst `system` (`test/tenancy-setup.ts`), dzięki czemu
przygotowanie i sprzątanie danych bezpośrednio przez EntityManager działa bez owijania każdego
wywołania; obsługa żądań i tak nadpisuje go prawdziwym, zawężonym kontekstem, więc zachowanie
między tenantami jest testowane naprawdę. Aby jawnie sprawdzić odmowę przy braku kontekstu, użyj
`runWithoutTenantContext(fn)`.
