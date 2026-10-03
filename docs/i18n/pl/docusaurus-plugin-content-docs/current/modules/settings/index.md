---
title: Settings
sidebar_position: 1
description: Konfiguracja platformy sterowana manifestem, per kanał sprzedaży, z cache'owanym API odczytu
---

# Settings

Moduł Settings posiada konfigurację obejmującą całą platformę. Inne moduły
dodają własne grupy ustawień i pojedyncze ustawienia przez typowany manifest;
administratorzy platformy dostrajają wartości per kanał sprzedaży z Admin UI;
każdy moduł backendu czyta wartości przez jeden dobrze znany serwis.

## Pojęcia

- **Setting** — pojedynczy regulowany parametr. Niesie nazwę, globalnie unikalny
  kod maszynowy, typ wartości (`string` / `number` / `boolean` / `json` /
  `string_list` / `secret` / `credential_ref`), domyślną wartość z manifestu
  oraz zakres kanału sprzedaży
  (pusty zakres oznacza „dotyczy każdego kanału”).
- **Setting Value** — wartość wybrana przez admina dla pary `(setting, sales_channel)`.
  Zastępuje domyślną z manifestu dla tego kanału. Kolejność rozwiązywania jest
  zawsze: wartość per kanał → domyślna z manifestu.
- **Setting Group** — logiczna sekcja, pod którą powiązane ustawienia pojawiają
  się w Admin UI. Wbudowana grupa `general` jest chroniona systemowo. Usunięcie
  dowolnej innej grupy przypisuje jej ustawienia do `general` i zachowuje ich
  wartości.

## Dla autorów modułów — deklarowanie ustawień

Każdy moduł, który chce zarejestrować ustawienia lub grupy, buduje manifest
ustawień helperem z `@endora-commerce/contracts` i przekazuje go jako pole
`settings` manifestu modułu:

```ts
// packages/modules/<your_module>/src/manifest.ts
import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

const settings = defineModuleSettingsManifest({
  moduleCode: 'your_module',
  groups: [{ code: 'your_section', name: 'Your section' }],
  settings: [
    {
      code: 'your_module.base_url',
      name: 'Base URL',
      groupCode: 'your_section',          // optional — defaults to 'general'
      valueType: 'string',
      defaultValue: 'https://default.example',
      // salesChannelCodes: ['main', 'wholesale']  // optional — empty = all
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'your_module',
  // ...name, version, dependencies (w tym 'settings')...
  settings,
});
```

Nie ma listy, do której trzeba coś dopisać: manifesty ustawień są zbierane
z rejestru modułów
(`src/backend/services/registered-settings-manifests.ts` w tym module),
więc zadeklarowanie `settings` w manifeście to cała rejestracja. Wiersze
zapisuje mechanizm uzgadniający manifest, który idempotentnie wstawia brakujące
grupy i ustawienia — przy każdym starcie dla modułów rdzenia i modułów
nakładkowych wdrożenia, a przez `module:install` dla modułu zainstalowanego jako
pakiet. Ponowne uruchomienie jest zawsze bezpieczne; wartości wybrane przez
admina nigdy nie są nadpisywane.

### Gwarancje reconcilera

| Zachowanie | Wynik |
|----------|---------|
| Pierwsze zastosowanie | Wstawione nowe grupy + ustawienia; `owner_module` ustawiony na kod twojego modułu. |
| Ponowne zastosowanie (bez zmian) | No-op. |
| Ponowne zastosowanie (dodany wpis) | Wstawiane są tylko nowe wpisy. |
| Ponowne zastosowanie (zmienione `name`/`description`) | Aktualizowane w miejscu. |
| Ponowne zastosowanie (zmienione `valueType` lub `defaultValue`) | Odrzucone (`BreakingChangeRejected`), aby zachować ważność istniejących wartości per kanał. Żadna flaga CLI tego nie omija. Akceptowane są dwie zmiany: `string` → `secret` oraz nowa `defaultValue`, gdy wpis wymienia zapisaną wartość w `previousDefaultValues`. |
| Ponowne zastosowanie (wpis usunięty z manifestu) | Sync przy starcie ignoruje usunięcie — osierocone wiersze są logowane, ale nie usuwane. Ustawienia modułu usuwa tylko `module:uninstall`. |
| Konflikt kodu ustawienia z innym modułem | Reconciliation przerywa z jasnym błędem. |

## Dla administratorów platformy — edycja wartości

Otwórz `Admin → Operations → Settings`. Ustawienia są pogrupowane według sekcji
właściciela. Wybór jednego otwiera edytor po prawej; możesz:

- Zastosować wartość do **każdego kanału sprzedaży w zakresie** jednym kliknięciem.
- Zastosować wartość do **wybranego podzbioru** kanałów (edytor wymusza regułę
  „co najmniej jeden kanał”).
- **Zresetować** wartości per kanał do domyślnej z manifestu.

Równoległe edycje są wykrywane przez `expectedVersion` (timestamp ISO). Gdy ktoś
inny zmienił ustawienie od momentu otwarcia, zapis zwraca `409 VERSION_CONFLICT`
i baner prosi o odświeżenie i ponowienie — bez cichych nadpisań.

Grupy ustawień zarządzasz pod `Admin → Operations → Setting groups`.
Grupa `general` jest chroniona systemowo; platforma odmawia jej usunięcia.
Usunięcie dowolnej innej grupy przypisuje jej ustawienia do `general` i
zachowuje wartości per kanał.

Każda zmiana wartości i mutacja grupy trafia do wiersza `audit_log_entries` z
aktorem, akcją, celem i nową wartością.

## Dla konsumentów modułów — odczyt wartości

Inne moduły wstrzykują `SettingsService` z composition root i czytaj przez jedno
API. Wynik to zawsze albo wartość wybrana przez admina dla żądanego kanału, albo
domyślna z manifestu.

```ts
import { z } from 'zod';

// In your module's plugin:
const baseUrl = await settingsService.get(
  'your_module.base_url',
  request.salesChannelId,
  z.string().url(),
);
```

### Błędy

| Rzucany | Kiedy |
|--------|------|
| `SettingNotRegistered` | Kod nie ma wiersza w `settings`. Caller ma literówkę albo moduł, który powinien go zadeklarować, nie jest zainstalowany. |
| `SettingOutOfScopeForChannel` | Ustawienie zarejestrowano z jawnym zakresem kanału, a żądany kanał nie jest w tym zakresie. Wskazuje błąd programisty: konsumujący moduł nie powinien czytać tego ustawienia w tym kontekście. |
| `SettingValueShapeMismatch` | Zapisana wartość przeszła walidację Zod przy zapisie, ale nie przeszła schematu callera (np. admin ustawił wartość przez manifest z szerszym typem). Ujawniane jako fail-fast błędnej konfiguracji. |

### Wydajność

Uniwersalny getter jest na tyle tani, że można go swobodnie wołać ze ścieżek
requestów. Kolejność rozwiązywania:

1. Per-process LRU (1024 wpisy, wpisy starsze niż 30 s ignorowane).
2. Redis (`settings:v1:<code>:<channelId>`, TTL 1h).
3. Postgres (jedno wyszukanie po kluczu na `(setting_id, sales_channel_id)`).

Unieważnianie cache wisi na zdarzeniach EventBus, które serwis admina emituje
przy każdej mutacji wartości lub grupy. EventBus jest in-process, więc proces
zapisujący widzi zmianę natychmiast, a każdy inny proces — przy następnym
odczycie po oknie 30 s — invalidation usunęło wspólny wpis Redis, a lokalne
okno mierzone jest od momentu załadowania wartości, a nie od ostatniego odczytu,
więc nawet ustawienie czytane przy każdym requeście starzeje się.

To okno to górna granica, jak długo pominięte unieważnienie może być widoczne.
Dlatego operatorowa strona „clear cache” to narzędzie diagnostyczne, a nie
naprawcze: usuwa obie warstwy w procesie, który ją serwuje, i wspólne wpisy dla
wszystkich, a każdy inny proces zbiega w tym samym 30 s.

## CLI

Wiersze ustawień instalują i usuwają polecenia cyklu życia modułu, a nie
osobne polecenia:

```bash
# Instalacja modułu: uruchamia jego migracje i uzgadnia jego manifest ustawień.
pnpm --filter backend run module:install <module-id> [--dry-run] [--json]

# Miękkie odinstalowanie (domyślne): wyrejestrowuje ustawienia modułu i oznacza
# moduł jako odinstalowany; jego tabele i dane zostają. --hard dodatkowo cofa
# migracje modułu i wymaga --force.
pnpm --filter backend run module:uninstall <module-id> [--hard --force] [--json]
```

`module:uninstall` nadal przyjmuje `--remove-settings` i `--preserve-settings`
dla zgodności wstecznej: pierwsza oznacza `--hard --force`, druga nic nie robi.
Gramatyka argumentów i kody wyjścia należą do poleceń cyklu życia
`@endora-commerce/platform`; kody wyjścia wymienia strona Module Lifecycle. Oba polecenia zapisują wiersze `audit_log_entries`.

## Baza danych

Pięć tabel wprowadzonych migracją platformy
`packages/platform/src/migrations/20260430T101450_core_settings_init.ts`:

- `setting_groups` (z `is_system_protected` dla wbudowanego `general`)
- `settings` (FK → `setting_groups`, enum typu wartości, domyślna `jsonb`)
- `setting_values` (admin override per `(setting, sales_channel)`; UNIQUE)
- `setting_group_sales_channels` (zakres M:N)
- `setting_sales_channels` (zakres M:N; pusty = wszystkie kanały)

`setting_values.sales_channel_id` kaskadowo usuwa się, gdy kanał zniknie;
pozostałe powiązania tego samego ustawienia są zachowane.
