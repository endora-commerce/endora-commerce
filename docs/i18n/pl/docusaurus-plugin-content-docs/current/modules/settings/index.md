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
  `string_list`), domyślną wartość z manifestu oraz zakres kanału sprzedaży
  (pusty zakres oznacza „dotyczy każdego kanału”).
- **Setting Value** — wartość wybrana przez admina dla pary `(setting, sales_channel)`.
  Zastępuje domyślną z manifestu dla tego kanału. Kolejność rozwiązywania jest
  zawsze: wartość per kanał → domyślna z manifestu.
- **Setting Group** — logiczna sekcja, pod którą powiązane ustawienia pojawiają
  się w Admin UI. Wbudowana grupa `general` jest chroniona systemowo. Usunięcie
  dowolnej innej grupy przypisuje jej ustawienia do `general` i zachowuje ich
  wartości.

## Dla autorów modułów — deklarowanie ustawień

Każdy moduł, który chce zarejestrować ustawienia lub grupy, eksportuje sąsiedni
plik `manifest.ts` używając helpera z `@endora-commerce/contracts`:

```ts
// packages/modules/<your_module>/src/manifest.ts
import { defineModuleSettingsManifest } from '@endora-commerce/contracts';

export const settingsManifest = defineModuleSettingsManifest({
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
```

Dołącz manifest do tablicy w `backend/src/composition.ts` — reconciler uruchamiany
przy starcie przechodzi po każdym wpisie i idempotentnie wstawia brakujące
wiersze. Ponowne uruchomienie jest zawsze bezpieczne; wartości wybrane przez
admina nigdy nie są nadpisywane.

### Gwarancje reconcilera

| Zachowanie | Wynik |
|----------|---------|
| Pierwsze zastosowanie | Wstawione nowe grupy + ustawienia; `owner_module` ustawiony na kod twojego modułu. |
| Ponowne zastosowanie (bez zmian) | No-op. |
| Ponowne zastosowanie (dodany wpis) | Wstawiane są tylko nowe wpisy. |
| Ponowne zastosowanie (zmienione `name`/`description`) | Aktualizowane w miejscu. |
| Ponowne zastosowanie (zmienione `valueType` lub `defaultValue`) | Odrzucone bez `--force`, aby zachować ważność istniejących wartości per kanał. |
| Ponowne zastosowanie (wpis usunięty z manifestu) | Sync przy starcie ignoruje usunięcie — osierocone wiersze są logowane, ale nie usuwane. Tylko `modules:uninstall` jest destrukcyjny. |
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

Dwa skrypty są dostarczane z backendem:

```bash
# Idempotentnie zsynchronizuj manifest modułu z bazą danych.
pnpm --filter backend run modules:install <module-code> [--force] [--dry-run]

# Usuń ustawienia + grupy modułu. Flaga jest wymagana — nie ma domyślnej.
# --remove-settings usuwa wszystko należące do modułu (kaskadowo usuwa wartości
# per kanał); --preserve-settings zostawia wszystko, aby przyszła re-instalacja
# podniosła wiersze bez zmian.
pnpm --filter backend run modules:uninstall <module-code> \
    (--remove-settings | --preserve-settings)
```

Oba polecenia zapisują wiersze `audit_log_entries`. Kody wyjścia `modules:install`:
`0` sukces, `64` błędne użycie, `65` nieprawidłowy manifest, `66` konflikt,
`70` błąd wewnętrzny.

## Baza danych

Pięć tabel wprowadzonych migracją `024_settings_init.ts`:

- `setting_groups` (z `is_system_protected` dla wbudowanego `general`)
- `settings` (FK → `setting_groups`, enum typu wartości, domyślna `jsonb`)
- `setting_values` (admin override per `(setting, sales_channel)`; UNIQUE)
- `setting_group_sales_channels` (zakres M:N)
- `setting_sales_channels` (zakres M:N; pusty = wszystkie kanały)

`setting_values.sales_channel_id` kaskadowo usuwa się, gdy kanał zniknie;
pozostałe powiązania tego samego ustawienia są zachowane.

## Zobacz też

- Specyfikacja: `specs/004-settings-module/spec.md`
- Plan implementacji: `specs/004-settings-module/plan.md`
- Kontrakt: `specs/004-settings-module/contracts/settings-004.contract.md`
- Konstytucja: Zasady I (Modular), III (TDD), V (TS + Zod), VI (Naming)
