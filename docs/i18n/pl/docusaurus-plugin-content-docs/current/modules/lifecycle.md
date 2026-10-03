---
title: Cykl życia modułu
description: Instalacja, odinstalowanie, włączanie, wyłączanie i status każdego modułu backendu z poziomu CLI, walidacja zależności i uzgadnianie stanu przy pierwszym starcie
---

# Cykl życia modułu

Wewnętrzny podsystem platformy, dzięki któremu każdy moduł backendu w pełni uczestniczy w cyklu życia: deklaratywny manifest, graf zależności, polecenia install / uninstall / enable / disable / status, trwały rejestr, transakcyjna instalacja z wycofaniem migracji przy błędzie oraz przechowywany w pamięci każdego procesu zbiór włączonych modułów — odświeżany przez Redis pub/sub — który bez restartu procesu blokuje lub odblokowuje trasy HTTP, workery BullMQ i subskrybentów zdarzeń.

Sam podsystem znajduje się w pakiecie hosta — w katalogu `lifecycle/` pakietu `@endora-commerce/platform` — a nie w katalogu modułu. To jedyny zarejestrowany moduł, którego przenoszenie modułów do pakietów nie zamienia w osobny pakiet: mechanizm cyklu życia to część platformy przeznaczona dla operatora, więc trafia razem z `@endora-commerce/platform` do każdej instancji, która w ogóle instaluje platformę, zamiast być osobnym pakietem, którego instancji mogłoby zabraknąć. Jego identyfikator modułu to nadal `_lifecycle`, a podkreślenie na początku nadal oznacza, że jest wewnętrzny dla platformy; każdy inny moduł backendu dołącza do cyklu życia, eksportując stałą `manifest` ze swojego pliku `manifest.ts`.

W aplikacji, w `backend/src/lifecycle/`, zostaje to, co instancja i tak musi mieć u siebie — i zostaje celowo, a nie jako pozostałość. **Powiązanie manifestów z rejestrem** (`registered-manifests.ts`) przekazuje mechanizmowi wyprowadzającemu stan w platformie trzy rzeczy, których platforma sama nie widzi — wygenerowany indeks manifestów tego drzewa, drzewo nakładki wdrożenia i pakiety zainstalowane w instancji — jako parametr, a nie przez bezpośrednie sięganie do nich. Każde z pięciu poleceń `module:*` ma tu dwudziestowierszowy punkt wejścia, który otwiera ORM i Redis *tej* instancji i wywołuje właściwą implementację. Implementacje, składnia argumentów i tabela kodów wyjścia są w pakiecie. **Czytnik** deklaracji rozbieżności wdrożenia leży obok reszty mechanizmu nakładki, w `backend/src/overlay/divergence-loader.ts`, bo ścieżka, którą składa, prowadzi do drzewa wdrożenia, a to należy do klienta; platforma ma *parser* deklaracji i otrzymuje już sparsowaną wartość.

Wszystko inne, co aplikacja importowała kiedyś ze starej ścieżki, importuje teraz z `@endora-commerce/platform/lifecycle`. Ta ścieżka jest **zadeklarowana, ale nieopublikowana**: `node` i `tsc` rozwiązują ją dla hosta, jego punktów wejścia i drzewa testów, żaden opublikowany plik zbiorczy (barrel) jej nie eksportuje, a `check:platform-surface` zgłasza moduł, który ją importuje, jako `host-internal-subpath`. Moduł z dostępem do tego API mógłby instalować, odinstalowywać, włączać i wyłączać inne moduły.

## API publiczne

| Metoda i ścieżka | Przeznaczenie |
| --- | --- |
| `GET /api/v1/admin/modules` | Lista tylko do odczytu: identyfikator każdego modułu, stan (`installing` / `installed` / `disabled` / `uninstalled` / `not-installed`), wersja (zarejestrowana i ta na dysku), zadeklarowane zależności oraz ewentualne flagi (`orphan`, `pending-upgrade`, `dep-missing`, `dep-disabled`). Uprawnienie: `platform.modules.read`. |
| `POST /api/v1/admin/modules/:id/activation` | Przełącznik **operatora** — treść żądania `{"active": true \| false}`. Zapisuje zadeklarowane w manifeście ustawienie aktywacji modułu, a nie rejestr; to właśnie to wywołanie wykonuje ekran Moduły w panelu administracyjnym (`/platform/modules`). Uprawnienie: `platform.modules.activate`. |

Operacje zmieniające rejestr (instalacja, odinstalowanie, włączenie, wyłączenie) są w v1 celowo
dostępne wyłącznie z CLI. Obie osie są niezależne, a moduł działa tylko wtedy, gdy obie na to
pozwalają: `module:enable` / `module:disable` należą do osoby utrzymującej wdrożenie, przełącznik
aktywacji — do osoby prowadzącej biznes, i żadna z osi nie nadpisuje drugiej.

## Polecenia CLI

Wszystkie polecenia są zdefiniowane w `backend/package.json`:

```bash
pnpm --filter backend run module:install <id> [--dry-run] [--json]
pnpm --filter backend run module:uninstall <id> [--hard] [--force] [--json]
pnpm --filter backend run module:enable <id> [--json]
pnpm --filter backend run module:disable <id> [--cascade] [--json]
pnpm --filter backend run module:status [<id>] [--filter=<state>] [--json]
```

### W instancji

Instancja — drzewo, które zapisuje `npx create-endora-commerce` — ma te same pięć poleceń w swoim
katalogu głównym; przyjmują te same argumenty i zwracają te same kody wyjścia:

```bash
pnpm run module:install <id> [--dry-run] [--json]     # or: pnpm run module:install --all
pnpm run module:uninstall <id> [--hard] [--force] [--json]
pnpm run module:enable <id> [--json]
pnpm run module:disable <id> [--cascade] [--json]
pnpm run module:status [<id>] [--filter=<state>] [--json]
```

Obejmują zarówno pakiety modułów zainstalowane w instancji, jak i jej własne moduły nakładkowe w
`apps/<deployment>/modules/`. Działające API i worker dowiadują się o zmianie wprowadzonej
którymkolwiek z tych poleceń bez restartu. Moduł nakładkowy zawierający katalog `migrations/` albo
`entities/` zatrzymuje każde z nich, zanim zostanie otwarta baza danych — zobacz
[Wzorzec nakładki](../architecture/overlay-pattern.md#zabezpieczenia-odmawiające-w-razie-wątpliwości).

W wydaniach do `0.100.2` włącznie polecenia `module:enable`, `module:disable` i miękkie
`module:uninstall` wypisywały w instancji komunikat o powodzeniu, niczego nie zmieniając, a twarde
odinstalowanie było odrzucane. Zaktualizuj instancję do nowszego wydania — zobacz
[Aktualizacja instancji](../upgrading-an-instance.md#before-the-command).

Znaczenie kodów wyjścia:

| Kod | Znaczenie |
| --- | --- |
| 0 | Powodzenie (albo moduł już jest w docelowym stanie — nic do zrobienia). |
| 64 | Błędne użycie: nieznany identyfikator, błędne argumenty, `--hard` bez `--force` poza terminalem. |
| 65 | Nieprawidłowy manifest (błąd walidacji Zod), zduplikowany identyfikator, cykl zależności. |
| 66 | Konflikt: brak zależności przy instalacji albo moduły zależne blokują odinstalowanie lub wyłączenie. |
| 70 | Błąd wewnętrzny podczas instalacji (migracja, ustawienia albo hook). |
| 75 | Blokada niedostępna albo przeterminowany wiersz `installing`. |
| 77 | Odmowa: moduł deklaruje się jako `nonDeactivatable` — dotyczy zarówno `disable`, jak i `uninstall`. |

### Modułu `nonDeactivatable` w ogóle nie da się wycofać na tej osi

Manifest, który deklaruje `activation: { nonDeactivatable: true, reason }`, odrzuca **zarówno**
`module:disable`, jak i `module:uninstall` — miękkie i twarde — z kodem 77 i bez flagi, która by
to obchodziła. Odinstalowanie to wyłączenie plus usunięcie ustawień plus, przy `--hard`, cofnięcie
migracji, więc deklaracja, która zabrania mniejszej operacji, nie może dopuszczać większej. Odmowa
następuje po sprawdzeniu, czy moduł nie jest już odinstalowany (`already-uninstalled`, nic do
zrobienia), a przed sprawdzeniem modułów zależnych, więc nic się nie wykonuje i nic nie zostaje
zapisane. Jeśli deklaracja jest dla danego modułu błędna, poprawia się manifest.

**Osierocony** wiersz rejestru — wiersz, którego moduł nie ma na dysku manifestu — nie jest tym
objęty: zabezpieczenie odczytuje manifest, a sprzątanie osieroconych wierszy to jedyne zadanie
odinstalowania, którego nie wykonuje nic innego.

Dawne polecenia `pnpm modules:install` / `pnpm modules:uninstall` (w liczbie mnogiej) wypisują ostrzeżenie o wycofaniu i przekazują wywołanie do wersji w liczbie pojedynczej. Zostaną usunięte w następnym wydaniu minor.

## Postać pliku manifestu

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
  // Opcjonalny. Uruchamiany raz, przy pierwszej instalacji, wewnątrz transakcji instalacji.
  // Służy do utworzenia domyślnych danych; po błędzie można go bezpiecznie uruchomić ponownie.
}

export async function uninstallHook({ em, hard, log }) {
  // Opcjonalny. `hard === true` oznacza, że operator zdecydował się usunąć dane.
}
```

Pola manifestu:

- `id` (wymagane, string) — musi odpowiadać nazwie katalogu pakietu modułu (`packages/modules/<id>/`); wyrażenie regularne `^_?[a-z][a-z0-9_]*$`.
- `name` (wymagane, string) — nazwa wyświetlana dla ludzi (1–120 znaków).
- `description` (opcjonalne, string) — do 2000 znaków.
- `version` (wymagane, string) — uproszczony semver (`MAJOR.MINOR.PATCH` z opcjonalnym przyrostkiem `-prerelease`).
- `dependencies` (wymagane, tablica stringów) — identyfikatory modułów, które platforma musi zainstalować przed tym modułem. Sprawdzane przy starcie względem rejestru manifestów.
- **Pola `license` nie ma.** Manifest, który nadal je deklaruje, nie jest odrzucany; klucz jest pomijany. Licencją pakietu modułu jest pole `license` w jego `package.json`, które `manifests:generate` kopiuje z pola `license` w katalogu głównym repozytorium, chyba że moduł obok manifestu eksportuje `packageLicense` — tę deklarację opisuje `LICENSE-COMMERCIAL.md` w katalogu głównym repozytorium. Platforma nigdy nie odczytuje licencji w czasie działania: żaden moduł nie jest z jej powodu włączany, odrzucany ani ograniczany.
- `settings` (opcjonalne) — postać `ModuleSettingsManifest`; instalacja uruchamia na nim istniejący mechanizm uzgadniania ustawień.
- `i18n` (opcjonalne) — postać `{ bundlesDir: string }`; jeśli pole jest obecne, instalacja odczytuje `<modulePath>/<bundlesDir>/<lang>.json` dla każdego języka obsługiwanego przez panel administracyjny i zapisuje (UPSERT) pakiet tłumaczeń w `translation_bundles`. Miękkie odinstalowanie zachowuje pakiety tłumaczeń; twarde je usuwa.
- `actions` (opcjonalne) — postać `ModuleAction[]`; lista deklaracji akcji palety poleceń (id, klucz etykiety, ikona, trasa docelowa, opcjonalne wymagane uprawnienie, waga, słowa kluczowe). Instalacja zapisuje (UPSERT) każdą zadeklarowaną akcję w `module_actions` i usuwa wiersze, których nowy manifest już nie deklaruje; twarde odinstalowanie usuwa je wszystkie. Pełny schemat i zachowanie po stronie operatora opisuje strona modułu [akcji palety poleceń](./admin-actions.md).
- `permissions` (opcjonalne) — kody uprawnień tego modułu, które można przypisywać rolom administracyjnym. Każdy wpis `{ code, label, module? }` trafia do `GET /api/v1/admin/permissions`, gdy moduł jest włączony. Każdy literał `requireAdmin('…')` na trasach administracyjnych modułu musi się tu znaleźć (albo w `PERMISSION_CATALOGUE` rdzenia, jeśli kod jest współdzielony). CI pilnuje tego przez `permission-inventory.test.ts`.

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

Miękkie odinstalowanie zachowuje dane: wiersze ustawień są usuwane, wiersz rejestru zostaje ze stanem `state = 'uninstalled'`, a schemat i tabele z danymi pozostają nietknięte. Ponowna instalacja tego samego modułu korzysta z już wykonanych migracji i trwa kilka sekund — ale **nie** przywraca konfiguracji: usunięte ustawienia są tworzone na nowo z wartości domyślnych z manifestu, łącznie z decyzją o aktywacji modułu. Do wstrzymania modułu bez utraty konfiguracji służy `module:disable`.

Twarde odinstalowanie (`--hard`, które poza terminalem wymaga też `--force`) dodatkowo cofa migracje modułu i usuwa wiersz rejestru. W instancji migracje do cofnięcia są odczytywane z rejestru migracji zainstalowanych pakietów — tego samego, z którego budowany jest `mikro-orm.config` instancji — a moduł nakładkowy nie ma żadnych migracji; `pnpm run migrate`, a potem `pnpm run module:install <id>` przywracają twardo odinstalowany moduł, z pustymi tabelami. W tym repozytorium migracje do cofnięcia są wybierane z `MIGRATION_REGISTRY` (`backend/src/db/migrations-registry.generated.ts`) według zadeklarowanego `moduleId`, sortowane rosnąco i cofane w odwrotnej kolejności — zobacz [Migracje bazy danych](../architecture/migrations.md#module-uninstall-migration-revert). Moduł, który nie ma żadnej zarejestrowanej migracji, zapisuje w logu ostrzeżenie i niczego nie cofa; twarde odinstalowanie polega wtedy na jego `uninstallHook`.

## Jak działa wyłączanie (blokowanie funkcji bez restartu)

Gdy moduł jest wyłączony, platforma wyłącza trzy warstwy za pomocą wrapperów:

1. **Trasy HTTP** zarejestrowane przez `defineModuleRoutes(moduleId, register)` — wrapper dodaje hook `onRequest`, który zwraca `503 Service Unavailable` z `{error:{code:'MODULE_DISABLED',details:{module:'<id>'}}}` i nagłówkiem `Retry-After: 60`.
2. **Workery BullMQ** zarejestrowane przez `defineModuleWorker(moduleId, worker)` — wstrzymywane przy wyłączeniu, wznawiane przy włączeniu.
3. **Subskrybenci zdarzeń** zarejestrowani przez `subscribeForModule(moduleId, bus, event, handler)` — gdy moduł jest wyłączony, handler nic nie robi.

Wyłączony moduł, z powodu którego odrzucono żądanie, jest podawany w `details.module` w **każdej** odpowiedzi `MODULE_DISABLED`, a nie tylko w blokadzie tras: identyfikator jest częścią samego `ModuleDisabledError`, więc rozwiązanie portu i wywołanie `requireModuleEnabled` zwracają odpowiedź tej samej postaci. Musi to być `details`, a nie pole obok `code`, ponieważ obsługa błędów zastępuje komunikat widoczny dla operatora zdaniem zarejestrowanym dla **kodu** błędu, a `MODULE_DISABLED` to jeden kod dla wszystkich blokowanych portów w platformie — to identyfikator modułu zamienia „Module Disabled.” w zdanie, na podstawie którego operator może coś zrobić, a `errors.MODULE_DISABLED` wstawia `{module}` właśnie z tego pola.

Zbiór włączonych modułów jest przechowywany w pamięci każdego procesu i odświeżany przez Redis pub/sub na kanale `b2b:module:state-changed`; odczyt to operacja O(1) w pamięci (~50 µs).

## Dodawanie nowego modułu krok po kroku

Przykład dla fikcyjnego modułu `coupons`, który zależy od `pricing` i `sales_channels`.

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

Utwórz szkielet migracji we własnym katalogu `migrations/` modułu — nigdy nie wybieraj numeru:

```bash
pnpm --filter backend run migration:new -- --module coupons --name coupons_init
```

```text
packages/modules/coupons/src/migrations/20260805T141530_coupons_init.ts
```

Przedrostek `<YYYYMMDDTHHmmss>` to znacznik czasu UTC, a nie numer kolejny; nazwa klasy jest mechanicznie wyprowadzana z nazwy pliku. Zarejestruj migrację poleceniem `pnpm --filter backend run composer:generate`, które na podstawie przejścia po systemie plików generuje `backend/src/db/migrations-registry.generated.ts`; zatwierdź ten artefakt razem z migracją. **Niezarejestrowana migracja się nie wykona**, a zadeklarowany w jej wpisie `moduleId` jest tym, po czym przy twardym odinstalowaniu wybierane są migracje do cofnięcia. Konwencję nazewnictwa, reguły kolejności i walidator rozjazdu kluczy obcych — który wymaga, by klucz obcy między modułami miał pokrycie we wpisie `dependencies` manifestu — opisuje strona [Migracje bazy danych](../architecture/migrations.md).

### 4. Zarejestruj moduł

Niczego nie edytuje się tu ręcznie. `backend/src/manifest-index.generated.ts` jest
**generowany**: przejście po drzewie odnajduje każdy katalog modułu eksportujący `manifest.ts`
w postaci wymaganej przez cykl życia, razem z opcjonalnymi eksportami `installHook` /
`uninstallHook`. To jedyny plik, który importuje manifesty — `registered-manifests.ts` wyprowadza
z niego `REGISTERED_MANIFESTS`, więc istnieje jeden generowany rejestr i jedno polecenie, które
go odświeża. Wygeneruj go ponownie i zatwierdź wynik:

```bash
pnpm --filter backend run composer:generate
```

Własny `package.json` pakietu modułu też jest generowany, innym poleceniem, a jego wynik zmienia
deklaracje workspace — dlatego od razu uruchom instalację i zatwierdź razem z nim
`pnpm-lock.yaml`:

```bash
pnpm --filter backend run manifests:generate
pnpm install --lockfile-only
```

`composer:generate` **nie** jest częścią `pnpm --filter backend run build`, choć kiedyś było:
build, który ponownie wyprowadza zatwierdzony artefakt, zapisuje wynik we własnym katalogu
wyjściowym, a nie w drzewie źródeł, więc kopia robocza z nieaktualnym artefaktem buduje się bez
błędów i niczego nie zgłasza — a obraz produkcyjny, zawierający tylko `backend/`, `packages/` i
`scripts/`, w ogóle nie może uruchomić generatora, który przechodzi po całym workspace. Build
przerywa `pnpm --filter backend run overlay:check`, gdy zatwierdzony artefakt jest nieaktualny
względem drzewa — to jedyny rozjazd, który wciąż jest możliwy, odkąd tablica powstaje z przejścia
po drzewie.

### 5. Zarejestruj trasy, workery i subskrybentów przez punkty rozszerzenia modułu

Wszystko, co moduł wnosi do działającego procesu, rejestruje się w jego funkcji `registerModule`,
przez `ModuleContext` przekazywany przez kontener jądra:

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

**Wrappery blokujące wyłączony moduł nakładają te trzy funkcje, a nie ty.** `ctx.routes` opakowuje
rejestrację w `defineModuleRoutes(module.id, …)`, więc każda trasa modułu kuponów zwraca
`503 MODULE_DISABLED` z `Retry-After: 60`, dopóki moduł jest wyłączony — i tak samo zachowa się
trasa, którą ktoś doda do tej rejestracji za rok. Właśnie dlatego blokuje się w miejscu rejestracji,
a nie w każdym handlerze z osobna. `ctx.worker` i `ctx.subscribe` robią to samo przez
`defineModuleWorker` i `subscribeForModule`. `ctx.worker` przyjmuje **utworzony** obiekt `Worker`,
a nie fabrykę.

**Nie możesz sam wywołać tych wrapperów — i to jest decyzja, a nie tylko zalecenie.**
`@endora-commerce/platform` publikuje pięć ścieżek importu i żadnych ścieżek głębszych, więc
ścieżka względna, którą ten krok kiedyś pokazywał (`'../../kernel/lifecycle/plugin-helpers.js'`),
z pakietu modułu nie prowadzi do niczego — a import po nazwie pakietu nie pomaga, bo
`defineModuleRoutes`, `defineModuleWorker`, `subscribeForModule`, `pauseWorkersFor` i
`resumeWorkersFor` **nie** są eksportowane z pliku zbiorczego `./kernel`. To decyzja zapisana w
samym pliku zbiorczym, który oznacza wrappery workerów i subskrypcji jako przeznaczone wyłącznie
dla aplikacji: ich publikacja otworzyłaby ponownie, przez import po nazwie pakietu, furtkę, którą
`check:subscribe-seam` zamknął dla ścieżek względnych. Import któregokolwiek z nich kończy się
błędem `tsc` i jest zgłaszany przez `pnpm --filter backend run check:platform-surface` jako
`unpublished-symbol`.

Jedyny wrapper, który plik zbiorczy publikuje, to `requireModuleEnabled` — dla punktu wejścia,
który **nie ma ani portu, ani żądania**. Nie jest to furtka dla modułów: jedyne miejsce, w którym
jest wywoływany, to własny plik platformy `cli/module-commands.ts`, publikowany jako wewnętrzna
ścieżka hosta `@endora-commerce/platform/cli`, z którego aplikacja korzysta przez plik
reeksportujący `backend/src/cli/module-commands.ts`. Tam **host** pyta — raz, zanim zbuduje
kontekst — o moduł, który zadeklarował polecenie operatora, które host za chwilę uruchomi. Handler
z `cliCommands` dostaje zwykły `ModuleContext` i korzysta z tych samych punktów rozszerzenia co
wszystko powyżej.

### 6. Zainstaluj lokalnie

```bash
pnpm --filter backend run module:install coupons
```

Oczekiwany wynik:

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

Programowanie sterowane testami jest obowiązkowe: każdy moduł ma testy jednostkowe, kontraktowe i integracyjne. Podsystem cyklu życia udostępnia gotowe dane testowe w `backend/test/fixtures/manifests/{basic-graph,cyclic-graph,deep-graph}/` do testowania schematu manifestu i grafu zależności.

## Punkty rozszerzenia

- **Własne kroki instalacji i odinstalowania**: wyeksportuj `installHook` / `uninstallHook` z pliku `manifest.ts` modułu. Hooki działają w transakcji instalacji, więc rzucony wyjątek cofa migracje i ustawienia.

## Instrukcja dla operatora

Jeśli polecenie cyklu życia wielokrotnie kończy się kodem 75 („lock-busy”), poprzednie uruchomienie mogło przerwać się w trakcie instalacji. Sprawdź to poleceniem:

```bash
redis-cli get b2b:module:lifecycle:lock
```

Jeśli wartość jest starsza niż pięć minut, blokada wygasła — powtarzające się błędy 75 przy przeterminowanym kluczu w Redis wskazują na zablokowany wiersz `state='installing'` w `module_registrations`. Sprawdź go przez `pnpm module:status` i wykonaj kroki naprawcze z instrukcji [Zawieszona blokada cyklu życia modułu](../operations/runbooks/module-lifecycle-stuck-lock.md).

## Testy

- Jednostkowe: `backend/test/unit/_lifecycle/{dep-graph,manifest-loader,manifest-schema.zod,lock,registry-cache}.test.ts`.
- Kontraktowe: `backend/test/contract/_lifecycle/{cli-install,cli-uninstall,cli-enable,cli-disable,cli-status,manifest-schema}.contract.test.ts`.
- Integracyjne (wymagają działających Postgresa i Redisa): znajdują się w `backend/test/integration/_lifecycle/`, ale uruchamia się je w środowiskach z działającą bazą deweloperską.
