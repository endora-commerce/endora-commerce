---
title: Module Lifecycle
description: Sterowane z CLI install / uninstall / enable / disable / status dla każdego modułu backendu + walidacja zależności + uzgodnienie przy pierwszym starcie
---

# Module Lifecycle

Podsystem wewnętrzny platformy, który zmienia każdy moduł backendu w pełnoprawnego obywatela cyklu życia: deklaratywny manifest, graf zależności, install / uninstall / enable / disable / status, trwały rejestr, transakcyjna instalacja z rollbackiem migracji oraz cache zbioru włączonych modułów per proces — odświeżany przez Redis pub/sub — który bramkuje trasy HTTP, workery BullMQ i subskrybentów zdarzeń bez restartu procesu.

Sam podsystem mieszka w `packages/platform/src/lifecycle/` — wewnątrz pakietu hosta, nie w katalogu modułu. To jedyny zarejestrowany moduł, którego sweep pakowania nie zamienia w osobny pakiet: maszyneria cyklu życia jest operatorską połową platformy, więc podróżuje z `@endora-commerce/platform` do każdej instancji, która w ogóle instaluje platformę, zamiast być osobnym pakietem, którego instancji mogłoby brakować. Jej id modułu to nadal `_lifecycle`, a wiodący podkreślnik nadal oznacza ją jako wewnętrzną dla platformy; każdy inny moduł backendu włącza się, eksportując stałą `manifest` ze swojego `manifest.ts`.

Tym, co zostaje w aplikacji, w `backend/src/lifecycle/`, jest okablowanie, które instancja i tak musi posiadać — i zostaje z powodu, a nie jako osad. **Wiązanie manifest–rejestr** (`registered-manifests.ts`) podaje deriverowi platformy trzy rzeczy, których platforma nie widzi — wygenerowany indeks manifestów tego drzewa, drzewo overlay danego wdrożenia i zainstalowane pakiety instancji — jako parametr, a nie jako sięgnięcie; a każda z pięciu komend `module:*` zachowuje dwudziestolinijkowy punkt wejścia, który otwiera ORM i Redis *tej* instancji i woła ciało komendy. Ciała, gramatyka argv i tabela kodów wyjścia są w pakiecie. **Czytnik** rozbieżności wdrożenia siedzi obok reszty maszynerii overlay w `backend/src/overlay/divergence-loader.ts`, bo ścieżka, którą składa, jest w drzewie wdrożenia, a to należy do klienta; platforma trzyma *parser* deklaracji i otrzymuje sparsowaną wartość.

Wszystko inne, co aplikacja nazywała kiedyś starą ścieżką, nazywa teraz przez `@endora-commerce/platform/lifecycle`. Ta podścieżka jest **zadeklarowana, ale nieopublikowana**: `node` i `tsc` rozwiązują ją dla hosta, jego punktów wejścia i drzewa testów, żadna opublikowana beczka jej nie niesie, a `check:platform-surface` zgłasza moduł, który ją nazwie, jako `host-internal-subpath`. Moduł, który mógłby nazwać tę powierzchnię, mógłby instalować, odinstalowywać, włączać i wyłączać swoje rodzeństwo.

## Powierzchnia publiczna

| Czasownik + ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/modules` | Lista tylko do odczytu: id każdego modułu, stan (`installing` / `installed` / `disabled` / `uninstalled` / `not-installed`), wersja (zarejestrowana kontra ta na dysku), zadeklarowane zależności oraz ewentualne flagi (`orphan`, `pending-upgrade`, `dep-missing`, `dep-disabled`). Uprawnienie: `platform.modules.read`. |

Operacje modyfikujące (install, uninstall, enable, disable) są w v1 celowo dostępne wyłącznie z CLI.

## Komendy CLI

Każda komenda jest okablowana w `backend/package.json`:

```bash
pnpm --filter backend run module:install <id> [--dry-run] [--json]
pnpm --filter backend run module:uninstall <id> [--hard] [--force] [--json]
pnpm --filter backend run module:enable <id> [--json]
pnpm --filter backend run module:disable <id> [--cascade] [--json]
pnpm --filter backend run module:status [<id>] [--filter=<state>] [--json]
```

Kontrakt kodów wyjścia:

| Kod | Znaczenie |
| --- | --- |
| 0 | Sukces (albo stan już docelowy — no-op). |
| 64 | Błędne użycie: nieznane id, złe argv, `--hard` bez `--force` poza tty. |
| 65 | Manifest nieprawidłowy (błąd Zod), zduplikowane id, cykl. |
| 66 | Konflikt: brakujące zależności przy instalacji / zależni blokują uninstall lub disable. |
| 70 | Błąd wewnętrzny podczas instalacji (migracja / ustawienia / hook). |
| 75 | Blokada niedostępna albo przeterminowany wiersz `installing`. |
| 77 | Odmowa: moduł deklaruje się jako `nonDeactivatable`, tak przy `disable`, jak i przy `uninstall`. |

### Modułu `nonDeactivatable` nie da się wycofać na tej osi w ogóle

Manifest, który deklaruje `activation: { nonDeactivatable: true, reason }`, odmawia **zarówno**
`module:disable`, jak i `module:uninstall` — miękkiego i twardego tak samo — z kodem 77 i bez
flagi obejścia. Uninstall to disable plus sweep ustawień plus, przy `--hard`, cofnięcie
migracji, więc deklaracja, która zabrania mniejszej operacji, nie może dopuszczać większej.
Odmowa jest podnoszona po no-opie `already-uninstalled`, a przed sprawdzeniem zależnych, więc
nic się nie wykonuje i nic nie jest zapisywane. Jeśli deklaracja jest dla modułu błędna,
poprawką jest manifest.

Wiersz rejestru będący **sierotą** — wiersz, którego moduł nie ma manifestu na dysku — nie jest
tym objęty: strażnik czyta manifest, a sprzątanie sierot to jedyna praca, którą uninstall
wykonuje, a nic innego jej nie robi.

Dawne `pnpm modules:install` / `pnpm modules:uninstall` (liczba mnoga) wypisują komunikat o deprecjacji i przekierowują do formy pojedynczej. Zostaną usunięte w następnym wydaniu minor.

## Kształt pliku manifestu

Każdy moduł eksportuje stałą `manifest` z `packages/modules/<id>/src/manifest.ts`:

```typescript
import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

export const manifest = defineModuleManifest({
  id: 'pricing',
  name: 'Pricing',
  description: 'Customer-group pricing with brackets and display modes.',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels'],
  settings: defineModuleSettingsManifest({
    moduleCode: 'pricing',
    groups: [{ code: 'pricing', name: 'Pricing' }],
    settings: [
      { code: 'pricing.default_display_mode',
        name: 'Default price display mode',
        valueType: 'string',
        defaultValue: 'gross_only',
        groupCode: 'pricing' },
    ],
  }),
});

export async function installHook({ em, log }) {
  // Opcjonalny. Uruchamiany raz przy pierwszej instalacji, wewnątrz transakcji instalacji.
  // Służy do zasiania domyślnej treści; idempotentny przy ponownym uruchomieniu po błędzie.
}

export async function uninstallHook({ em, hard, log }) {
  // Opcjonalny. `hard === true` oznacza, że operator wybrał usunięcie danych.
}
```

Pola manifestu:

- `id` (wymagane, string) — musi odpowiadać nazwie katalogu pakietu modułu (`packages/modules/<id>/`); regex `^_?[a-z][a-z0-9_]*$`.
- `name` (wymagane, string) — czytelna dla człowieka nazwa wyświetlana (1–120 znaków).
- `description` (opcjonalne, string) — do 2000 znaków.
- `version` (wymagane, string) — semver-lite (`MAJOR.MINOR.PATCH` plus opcjonalny sufiks `-prerelease`).
- `dependencies` (wymagane, tablica stringów) — id modułów, które platforma musi mieć zainstalowane przed tym. Walidowane względem rejestru manifestów przy starcie.
- `license` (opcjonalne, enum `'core' | 'pro' | 'enterprise'`) — zarezerwowane pod przyszłe bramkowanie edycji; deklarowane i audytowane, ale w v1 nieegzekwowane.
- `settings` (opcjonalne) — kształt `ModuleSettingsManifest`; ścieżka instalacji cyklu życia uruchamia na nim istniejący reconciler ustawień.
- `i18n` (opcjonalne) — kształt `{ bundlesDir: string }`; gdy jest obecny, ścieżka instalacji czyta `<modulePath>/<bundlesDir>/<lang>.json` dla każdego wspieranego języka Admin UI i robi UPSERT paczki do `translation_bundles`. Miękki uninstall zachowuje paczki; twardy je usuwa.
- `actions` (opcjonalne) — kształt `ModuleAction[]`; wbudowana lista deklaracji akcji palety poleceń (id, klucz etykiety, ikona, trasa docelowa, opcjonalne wymagane uprawnienie, waga, słowa kluczowe). Ścieżka instalacji robi UPSERT każdej zadeklarowanej akcji do `module_actions` i przycina wiersze, których nowy manifest już nie deklaruje; twardy uninstall je usuwa. Pełny schemat i zachowanie po stronie operatora opisuje strona modułu [Admin Command Palette Actions](./admin-actions.md).
- `permissions` (opcjonalne) — przypisywalne kody ról administracyjnych tego modułu. Każdy wpis `{ code, label, module? }` jest scalany do `GET /api/v1/admin/permissions`, gdy moduł jest włączony. Każdy literał `requireAdmin('…')` na trasach administracyjnych modułu musi tu wystąpić (albo w rdzeniowym `PERMISSION_CATALOGUE` dla kodów współdzielonych). CI egzekwuje to przez `permission-inventory.test.ts`.

## Maszyna stanów cyklu życia

```text
                  ┌─────────────────────────────────────┐
                  │                                     │
            (install attempt)                           │
                  │                                     │
                  ▼                                     │
            ┌──────────┐                                │
   (no row) │installing│  ──fail──→  ┌──────────┐ ←─┐   │
            └────┬─────┘             │uninstalled│   │   │
                 │                   └────┬─────┘   │   │
                 │success                 │         │   │
                 ▼                        │         │   │
            ┌──────────┐                  │         │   │
   ┌──────→ │installed │ ←────install─────┤         │   │
   │        └────┬─────┘                  │         │   │
   │             │ disable                │         │   │
   │             ▼                        │         │   │
   │        ┌──────────┐                  │         │   │
   └enable──│ disabled │ ──uninstall───────┘         │   │
            └──────────┘                                │
                                                        │
            ─── all states can re-enter installing on   │
                an explicit re-install attempt ─────────┘
```

Miękki uninstall zachowuje dane: wiersze ustawień są usuwane, wiersz rejestru zostaje ze `state = 'uninstalled'`, schema i tabele danych pozostają nietknięte. Ponowna instalacja tego samego modułu wykorzystuje już nałożone migracje i kończy się w sekundy — ale **nie** przywraca konfiguracji: ustawienia, które sweep usunął, są odtwarzane z wartości domyślnych manifestu, włącznie z wyborem aktywacji modułu. Od wstrzymania modułu bez utraty jego konfiguracji jest `module:disable`.

Twardy uninstall (`--hard`) dodatkowo cofa migracje modułu i usuwa wiersz rejestru. Migracje do cofnięcia są rozwiązywane z `MIGRATION_REGISTRY` (`backend/src/db/migrations-registry.generated.ts`) po zadeklarowanym `moduleId`, sortowane rosnąco i cofane w odwrotnej kolejności — patrz [Database Migrations](../architecture/migrations.md#module-uninstall-migration-revert). Moduł, który nie posiada żadnej zarejestrowanej migracji, loguje ostrzeżenie i nie cofa niczego; twardy uninstall polega wtedy na jego `uninstallHook`.

## Jak działa disable (bramkowanie funkcji bez restartu)

Gdy moduł jest wyłączony, platforma dezaktywuje trzy warstwy przez wrappery:

1. **Trasy HTTP** zarejestrowane przez `defineModuleRoutes(moduleId, register)` — wrapper instaluje hook `onRequest`, który zwraca `503 Service Unavailable` z `{error:{code:'MODULE_DISABLED',details:{module:'<id>'}}}` i `Retry-After: 60`.
2. **Workery BullMQ** zarejestrowane przez `defineModuleWorker(moduleId, worker)` — pauzowane przy disable, wznawiane przy enable.
3. **Subskrybenci zdarzeń** zarejestrowani przez `subscribeForModule(moduleId, bus, event, handler)` — handler jest no-opem, gdy moduł jest wyłączony.

Odmówiony moduł jest nazwany w `details.module` w **każdej** odpowiedzi `MODULE_DISABLED`, nie tylko na bramce tras: id podróżuje na samym `ModuleDisabledError`, więc rozwiązanie portu i wywołanie `requireModuleEnabled` odpowiadają tym samym kształtem. Musi to być `details`, a nie pole obok `code`, ponieważ koperta błędu zastępuje widoczny dla operatora komunikat zarejestrowanym zdaniem dla jego **kodu**, a `MODULE_DISABLED` to jeden kod dla każdego bramkowanego portu w platformie — to id modułu zamienia „Module Disabled.” w zdanie, na które operator może zareagować, a `errors.MODULE_DISABLED` interpoluje `{module}` dokładnie z tego szczegółu.

Zbiór włączonych modułów jest cache'owany per proces i odświeżany przez Redis pub/sub na kanale `b2b:module:state-changed`; odczyty z cache są O(1) w pamięci (~50 µs).

## Dodanie nowego modułu — przewodnik

Opracowany przykład dla fikcyjnego modułu `coupons`, który zależy od `pricing` i `sales_channels`.

### 1. Utwórz pakiet

```text
packages/modules/coupons/
├── package.json            generated by `manifests:generate` — never hand-written
├── i18n/{en,pl}.json
├── docs/coupons.md
└── src/
    ├── manifest.ts
    ├── migrations/
    └── backend/
        ├── entities/
        ├── services/
        ├── routes.admin.ts
        └── index.ts        exports registerModule(ctx)
```

### 2. Napisz manifest

```typescript
// packages/modules/coupons/src/manifest.ts
import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

const settings = defineModuleSettingsManifest({
  moduleCode: 'coupons',
  groups: [{ code: 'coupons.policies', name: 'Coupon policies' }],
  settings: [
    {
      code: 'coupons.policies.max_per_customer',
      name: 'Max coupons per customer',
      valueType: 'integer',
      defaultValue: 5,
      groupCode: 'coupons.policies',
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'coupons',
  name: 'Coupons',
  description: 'Promotional codes redeemable at checkout.',
  version: '1.0.0',
  dependencies: ['settings', 'sales_channels', 'pricing'],
  settings,
});

export async function installHook({ em, log }) {
  log.info('coupons: seeding default policy presets');
  // await em.persistAndFlush(...);
}

export async function uninstallHook({ em, hard, log }) {
  if (hard) {
    log.info('coupons: deregistering external coupon webhook');
  }
}
```

### 3. Napisz migracje

Wygeneruj migrację do własnego katalogu `migrations/` modułu — nigdy nie wybieraj numeru:

```bash
pnpm --filter backend run migration:new -- --module coupons --name coupons_init
```

```text
packages/modules/coupons/src/migrations/20260805T141530_coupons_init.ts
```

Prefiks `<YYYYMMDDTHHmmss>` to znacznik czasu UTC, nie numer w sekwencji; nazwa klasy jest wyprowadzana mechanicznie z nazwy pliku. Zarejestruj ją przez `pnpm --filter backend run composer:generate`, które emituje `backend/src/db/migrations-registry.generated.ts` z przejścia po systemie plików; zacommituj artefakt razem z migracją. **Niezarejestrowana migracja nie uruchamia się**, a zadeklarowane w tym wpisie `moduleId` jest tym, po czym orkiestrator dopasowuje migracje do cofnięcia na ścieżce twardego uninstalla. Konwencję nazewniczą, reguły kolejności i walidator dryfu FK — który wymaga, by międzymodułowy klucz obcy był pokryty wpisem `dependencies` w manifeście — opisuje [Database Migrations](../architecture/migrations.md).

### 4. Zarejestruj moduł

Nie ma tu nic do ręcznej edycji. `backend/src/manifest-index.generated.ts` jest
**generowany**: każdy katalog modułu, który eksportuje `manifest.ts` w kształcie
cyklu życia, jest odnajdywany przez przejście po drzewie, razem z opcjonalnymi eksportami
`installHook` / `uninstallHook`. To jedyny plik, który importuje manifest —
`registered-manifests.ts` wyprowadza z niego `REGISTERED_MANIFESTS`, więc jest jeden
generowany rejestr i jedna komenda, która go odświeża. Wygeneruj ponownie i zacommituj wynik:

```bash
pnpm --filter backend run composer:generate
```

Własny `package.json` pakietu modułu też jest generowany, przez drugą komendę, a jego
wyjście zmienia to, co deklaruje workspace — więc uruchom instalację tym samym tchem i
zacommituj z nią `pnpm-lock.yaml`:

```bash
pnpm --filter backend run manifests:generate
pnpm install --lockfile-only
```

`composer:generate` **nie** jest wpięte w `pnpm --filter backend run build`, a kiedyś było: build,
który ponownie wyprowadza zacommitowany artefakt, zapisuje swoją odpowiedź do własnego wyjścia,
a nie do drzewa, więc checkout z nieaktualnym artefaktem buduje się czysto i niczego nie zgłasza
— a obraz produkcyjny, który zawiera tylko `backend/`, `packages/` i `scripts/`, nie jest w
stanie uruchomić generatora przechodzącego po całym workspace. To `pnpm --filter backend run overlay:check`
jest tym, co wywala build, gdy zacommitowany artefakt jest nieaktualny względem drzewa — jedyny
dryf, jaki nadal jest możliwy, odkąd tablica jest przejściem po drzewie.

### 5. Zarejestruj trasy, workery i subskrybentów przez własne szwy modułu

Wszystko, co moduł wnosi do działającego procesu, jest rejestrowane z jego
`registerModule`, przez `ModuleContext`, który podaje mu kontener kernela:

```typescript
// packages/modules/coupons/src/backend/index.ts
import type { ModuleContext } from '@endora-commerce/platform/kernel';

export function registerModule(ctx: ModuleContext): void {
  ctx.routes(async (app) => {
    await registerCouponsAdminRoutes(app, ctx.cradle<CouponsCradle>());
  });

  ctx.worker(new Worker('coupons.expiry', processor, { connection: redis }));

  ctx.subscribe('orders.placed', async (payload) => {
    await handleOrderPlaced(payload);
  });
}
```

**Wrappery bramkujące nakładają te trzy szwy, nie ty.** `ctx.routes`
opakowuje rejestrację w `defineModuleRoutes(module.id, …)`, więc każda trasa kuponów
zwraca `503 MODULE_DISABLED` z `Retry-After: 60`, dopóki moduł jest wyłączony — i tak samo
robi trasa, którą ktoś doda do tej rejestracji za rok, co jest właśnie sensem bramkowania
na szwie rejestracji zamiast per handler. `ctx.worker` i `ctx.subscribe` robią to samo
dla `defineModuleWorker` i `subscribeForModule`. `ctx.worker` przyjmuje **skonstruowany**
`Worker`, a nie fabrykę.

**Nie możesz wywołać wrapperów samodzielnie, i jest to rozstrzygnięte, a nie
odradzane.** `@endora-commerce/platform` publikuje pięć podścieżek i żadnych
ścieżek głębokich, więc relatywny specyfikator, który ten krok kiedyś pokazywał
(`'../../kernel/lifecycle/plugin-helpers.js'`), nie rozwiązuje się z pakietu modułu
— a zapis bare go nie ratuje, bo
`defineModuleRoutes`, `defineModuleWorker`, `subscribeForModule`,
`pauseWorkersFor` i `resumeWorkersFor` **nie** są eksportowane z beczki
`./kernel`. To decyzja zapisana w samej beczce, która klasyfikuje
wrappery workera i subskrypcji jako przeznaczone wyłącznie dla aplikacji: ich publikacja
otworzyłaby ponownie, przez specyfikator bare, szew, który `check:subscribe-seam` zamknął
po ścieżce relatywnej. Import nazywający któryś z nich wywala `tsc` i jest raportowany przez
`pnpm --filter backend run check:platform-surface` jako `unpublished-symbol`.

Jedynym wrapperem, który beczka publikuje, jest `requireModuleEnabled`, dla punktu
wejścia, który **nie ma portu i nie ma żądania**. Nie jest to furtka dla
modułu: jego jedyne miejsce wywołania w drzewie to własne
`cli/module-commands.ts` platformy, publikowane host-wewnętrznie jako
`@endora-commerce/platform/cli` i osiągane
przez aplikację przez shim re-eksportujący w `backend/src/cli/module-commands.ts`,
gdzie **host** pyta o moduł, który zadeklarował komendę operatorską, jaką host właśnie
zamierza uruchomić — raz, zanim zbuduje kontekst. Handler `cliCommands` dostaje
zwykły `ModuleContext` i korzysta z tych samych szwów co wszystko powyżej.

### 6. Zainstaluj lokalnie

```bash
pnpm --filter backend run module:install coupons
```

Oczekiwane wyjście:

```text
[install] coupons 1.0.0
  ✓ dependencies satisfied (settings, sales_channels, pricing)
  ✓ migrations applied: Migration20260805T141530CouponsInit
  ✓ settings reconciled: +1 group, +1 setting
  ✓ i18n bundles installed: en, pl
  ✓ admin actions reconciled: +1 row
  ✓ install hook completed (12 ms)
  ✓ registry updated: state=installed
done in 380 ms
```

### 7. Napisz testy

Rozwój sterowany testami jest nienegocjowalny: każdy moduł dostarcza testy jednostkowe, kontraktowe i integracyjne. Podsystem cyklu życia udostępnia gotowe helpery fixture w `backend/test/fixtures/manifests/{basic-graph,cyclic-graph,deep-graph}/` do testowania schematu manifestu i grafu zależności.

## Punkty rozszerzeń

- **Własne kroki install / uninstall**: wyeksportuj `installHook` / `uninstallHook` z `manifest.ts` modułu. Hooki dzielą transakcję instalacji, więc wyjątek cofa migracje i ustawienia.
- **Bramkowanie po poziomie licencji** (planowane): pole `license` manifestu jest przechowywane i audytowane; przyszły pipeline komponowania edycji odmówi włączenia płatnego modułu na edycji niepłatnej.

## Runbook operatora

Jeśli komenda cyklu życia wielokrotnie kończy się kodem 75 („lock-busy”), poprzedni przebieg mógł się wywalić w trakcie instalacji. Zdiagnozuj przez:

```bash
redis-cli get b2b:module:lifecycle:lock
```

Jeśli wartość jest starsza niż pięć minut, blokada wygasła — powtarzające się błędy 75 przy przeterminowanym kluczu Redis wskazują na zablokowany wiersz `state='installing'` w `module_registrations`. Obejrzyj go przez `pnpm module:status` i wykonaj kroki naprawcze z [Stuck Module-Lifecycle Lock](../operations/runbooks/module-lifecycle-stuck-lock.md).

## Testy

- Jednostkowe: `backend/test/unit/_lifecycle/{dep-graph,manifest-loader,manifest-schema.zod,lock,registry-cache}.test.ts`.
- Kontraktowe: `backend/test/contract/_lifecycle/{cli-install,cli-uninstall,cli-enable,cli-disable,cli-status,manifest-schema}.contract.test.ts`.
- Integracyjne (wymagają żywego Postgresa + Redisa): napisane pod `backend/test/integration/_lifecycle/`, ale uruchamiane w środowiskach, w których baza deweloperska jest podniesiona.
