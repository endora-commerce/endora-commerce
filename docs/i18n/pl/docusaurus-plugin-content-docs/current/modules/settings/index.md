---
title: Ustawienia
sidebar_position: 1
description: Konfiguracja platformy deklarowana w manifestach, z wartościami dla poszczególnych kanałów sprzedaży i API odczytu z pamięcią podręczną
---

# Ustawienia

Moduł ustawień (Settings) jest właścicielem konfiguracji całej platformy. Inne moduły dodają własne
grupy ustawień i pojedyncze ustawienia przez typowany manifest; administratorzy platformy dostosowują
wartości dla poszczególnych kanałów sprzedaży w panelu administracyjnym; każdy moduł backendu
odczytuje wartości przez jedną, dobrze znaną usługę.

## Pojęcia

- **Ustawienie (Setting)** — pojedynczy parametr do regulacji. Ma nazwę, unikalny w całej platformie
  kod maszynowy, typ wartości (`string` / `number` / `boolean` / `json` / `string_list` / `secret` /
  `credential_ref`), wartość domyślną z manifestu oraz zakres kanałów sprzedaży (pusty zakres
  oznacza „dotyczy każdego kanału”).
- **Wartość ustawienia (Setting Value)** — wartość wybrana przez administratora dla pary
  `(setting, sales_channel)`. Zastępuje w tym kanale wartość domyślną z manifestu. Kolejność
  ustalania wartości jest zawsze taka sama: wartość dla kanału → wartość domyślna z manifestu.
- **Grupa ustawień (Setting Group)** — logiczna sekcja, w której powiązane ustawienia pojawiają się
  w panelu administracyjnym. Wbudowana grupa `general` jest chroniona przez system. Usunięcie
  dowolnej innej grupy przenosi jej ustawienia do `general` i zachowuje ich wartości.

## Dla autorów modułów — deklarowanie ustawień

Każdy moduł, który chce zarejestrować ustawienia lub grupy, buduje manifest ustawień funkcją
pomocniczą z `@endora-commerce/contracts` i przekazuje go jako pole `settings` manifestu modułu:

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
  // ...name, version, dependencies (include 'settings')...
  settings,
});
```

Nie ma listy, do której trzeba coś dopisać: manifesty ustawień są zbierane z rejestru modułów
(`src/backend/services/registered-settings-manifests.ts` w tym module), więc zadeklarowanie
`settings` w manifeście to cała rejestracja. Wiersze zapisuje mechanizm uzgadniający manifest, który
idempotentnie wstawia brakujące grupy i ustawienia — przy każdym starcie dla modułów rdzenia i
modułów nakładkowych wdrożenia, a przez `module:install` dla modułu zainstalowanego jako pakiet.
Ponowne uruchomienie jest zawsze bezpieczne; wartości wybrane przez administratora nigdy nie są
nadpisywane.

### Gwarancje mechanizmu uzgadniającego

| Sytuacja | Wynik |
|----------|---------|
| Pierwsze zastosowanie | Wstawiane są nowe grupy i ustawienia; `owner_module` otrzymuje kod Twojego modułu. |
| Ponowne zastosowanie (bez zmian) | Nic się nie dzieje. |
| Ponowne zastosowanie (dodany wpis) | Wstawiane są tylko nowe wpisy. |
| Ponowne zastosowanie (zmienione `name`/`description`) | Aktualizacja w miejscu. |
| Ponowne zastosowanie (zmienione `valueType` lub `defaultValue`) | Odrzucane (`BreakingChangeRejected`), żeby istniejące wartości dla kanałów pozostały poprawne. Żadna flaga CLI tego nie omija. Przyjmowane są dwie zmiany: `string` → `secret` oraz nowa `defaultValue`, gdy wpis wymienia zapisaną wartość w `previousDefaultValues`. |
| Ponowne zastosowanie (wpis usunięty z manifestu) | Synchronizacja przy starcie pomija usunięcie — osierocone wiersze są odnotowywane w logu, ale nie są usuwane. Ustawienia modułu usuwa tylko `module:uninstall`. |
| Kod ustawienia koliduje z innym modułem | Uzgadnianie zostaje przerwane z czytelnym błędem. |

## Dla administratorów platformy — edycja wartości

Otwórz `Admin → Operations → Settings`. Ustawienia są pogrupowane według sekcji, do której należą.
Wybranie ustawienia otwiera edytor po prawej stronie; możesz w nim:

- Zastosować wartość do **każdego kanału sprzedaży w zakresie** jednym kliknięciem.
- Zastosować wartość do **wybranych kanałów** (edytor wymaga wskazania co najmniej jednego kanału).
- **Przywrócić** w kanałach wartość domyślną z manifestu.

Równoczesne zmiany są wykrywane przez `expectedVersion` (znacznik czasu ISO). Jeśli ktoś inny zmienił
ustawienie, odkąd je otworzyłeś, zapis zwraca `409 VERSION_CONFLICT`, a komunikat prosi o odświeżenie
i ponowienie próby — nic nie jest po cichu nadpisywane.

Grupami ustawień zarządzasz w `Admin → Operations → Setting groups`. Grupa `general` jest chroniona
przez system i platforma odmawia jej usunięcia. Usunięcie dowolnej innej grupy przenosi jej
ustawienia do `general` i zachowuje wartości ustawione dla kanałów.

Każda zmiana wartości i każda zmiana grupy trafia do wiersza `audit_log_entries` z wykonawcą,
akcją, obiektem i nową wartością.

## Dla modułów korzystających z ustawień — odczyt wartości

Inne moduły wstrzykują `SettingsService` z kompozycji i odczytują wartości przez jedno API. Wynikiem
jest zawsze albo wartość wybrana przez administratora dla żądanego kanału, albo wartość domyślna z
manifestu.

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

| Zgłaszany błąd | Kiedy |
|--------|------|
| `SettingNotRegistered` | Kod nie ma wiersza w `settings`. Wywołujący popełnił literówkę albo moduł, który powinien deklarować to ustawienie, nie jest zainstalowany. |
| `SettingOutOfScopeForChannel` | Ustawienie zarejestrowano z jawnym zakresem kanałów, a żądany kanał do niego nie należy. Oznacza to błąd programisty: moduł korzystający z ustawienia nie powinien go odczytywać w tym kontekście. |
| `SettingValueShapeMismatch` | Zapisana wartość przeszła walidację Zod przy zapisie, ale nie spełnia schematu wywołującego (np. administrator ustawił wartość przez manifest z szerszym typem). Zgłaszane natychmiast jako błąd konfiguracji. |

### Wydajność

Ogólna metoda odczytu jest na tyle tania, że można ją swobodnie wywoływać przy obsłudze żądań.
Kolejność ustalania wartości:

1. Pamięć podręczna LRU w procesie (1024 wpisy, wpisy starsze niż 30 s są pomijane).
2. Redis (`settings:v1:<code>:<channelId>`, TTL 1 h).
3. Postgres (jedno wyszukanie po kluczu `(setting_id, sales_channel_id)`).

Unieważnianie pamięci podręcznej opiera się na zdarzeniach EventBus, które usługa administracyjna
emituje przy każdej zmianie wartości lub grupy. EventBus działa w obrębie procesu, więc proces, który
zapisał zmianę, widzi ją od razu, a każdy inny proces — przy pierwszym odczycie po upływie 30 s:
unieważnienie usunęło wspólny wpis w Redisie, a lokalne okno jest liczone od chwili wczytania
wartości, a nie od ostatniego odczytu, więc nawet ustawienie odczytywane przy każdym żądaniu w końcu
się przedawnia.

To okno wyznacza górną granicę czasu, przez jaki pominięte unieważnienie może być widoczne. Dlatego
też strona „clear cache” dla operatora jest narzędziem diagnostycznym, a nie naprawczym: czyści obie
warstwy w procesie, który ją obsługuje, oraz wspólne wpisy dla wszystkich, a każdy inny proces
uzgadnia się w tym samym oknie 30 s.

## Wiersz poleceń

Wiersze ustawień instalują i usuwają polecenia cyklu życia modułu, a nie osobne polecenia:

```bash
# Install a module: runs its migrations and reconciles its settings manifest.
pnpm --filter backend run module:install <module-id> [--dry-run] [--json]

# Soft uninstall (default): unregisters the module's settings and marks the
# module uninstalled; its tables and data stay. --hard also reverts the
# module's migrations and must be combined with --force.
pnpm --filter backend run module:uninstall <module-id> [--hard --force] [--json]
```

`module:uninstall` nadal przyjmuje `--remove-settings` i `--preserve-settings` ze względu na zgodność
wsteczną: pierwsza flaga oznacza `--hard --force`, druga nic nie robi. Gramatyka argumentów i kody
wyjścia należą do poleceń cyklu życia `@endora-commerce/platform`; kody wyjścia wymienia strona Module
Lifecycle. Oba polecenia zapisują wiersze w `audit_log_entries`.

## Baza danych

Pięć tabel wprowadzonych migracją platformy
`packages/platform/src/migrations/20260430T101450_core_settings_init.ts`:

- `setting_groups` (z `is_system_protected` dla wbudowanej grupy `general`)
- `settings` (klucz obcy → `setting_groups`, typ wyliczeniowy dla typu wartości, wartość domyślna w
  `jsonb`)
- `setting_values` (wartość ustawiona przez administratora dla pary `(setting, sales_channel)`;
  UNIQUE)
- `setting_group_sales_channels` (zakres wiele-do-wielu)
- `setting_sales_channels` (zakres wiele-do-wielu; pusty = wszystkie kanały)

Wiersze `setting_values` są usuwane kaskadowo po usunięciu kanału wskazanego w `sales_channel_id`;
pozostałe powiązania tego samego ustawienia są zachowywane.
