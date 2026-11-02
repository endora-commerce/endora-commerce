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
| Ponowne zastosowanie (dodane lub usunięte `multiline`) | Aktualizacja w miejscu; zapisane wartości pozostają nietknięte. |
| Ponowne zastosowanie (zmienione `valueType` lub `defaultValue`) | Odrzucane (`BreakingChangeRejected`), żeby istniejące wartości dla kanałów pozostały poprawne. Żadna flaga CLI tego nie omija. Przyjmowane są dwie zmiany: `string` → `secret` oraz nowa `defaultValue`, gdy wpis wymienia zapisaną wartość w `previousDefaultValues`. |
| Ponowne zastosowanie (wpis usunięty z manifestu) | Synchronizacja przy starcie pomija usunięcie — osierocone wiersze są odnotowywane w logu, ale nie są usuwane. Ustawienia modułu usuwa tylko `module:uninstall`. |
| Kod ustawienia koliduje z innym modułem | Uzgadnianie zostaje przerwane z czytelnym błędem. |

### Tłumaczenie nazw i opisów

`name` i `description` w manifeście są po angielsku i to je pokazuje ekran ustawień, chyba że
własna paczka tłumaczeń modułu mówi inaczej. Aby pokazać ustawienie w języku administratora, dodaj
poniższe klucze do plików `i18n/en.json` i `i18n/pl.json`, które moduł już dostarcza — płaskie
klucze, jak każdy inny klucz w paczce:

| Klucz | Zastępuje |
|-----|----------|
| `settingLabels.<setting code>.name` | `name` ustawienia |
| `settingLabels.<setting code>.description` | `description` ustawienia |
| `settingGroups.<group code>.name` | `name` grupy |

Kod zapisuje się w całości, razem z kropkami. Dla manifestu powyżej:

```json
{
  "settingGroups.your_section.name": "Twoja sekcja",
  "settingLabels.your_module.base_url.name": "Bazowy adres URL",
  "settingLabels.your_module.base_url.description": "Adres, pod którym usługa jest dostępna."
}
```

Rozstrzyganie odbywa się osobno dla każdego klucza: język administratora, potem angielski, potem
tekst zadeklarowany w manifeście. Każdy klucz jest opcjonalny, więc moduł, który nie dostarcza
żadnego z nich, wygląda dokładnie tak jak wcześniej, a ustawienia można tłumaczyć po jednym. Ze
sposobu wyszukiwania wynikają trzy rzeczy:

- **Czytana jest wyłącznie paczka modułu będącego właścicielem** — tego, którego manifest ustawień
  zadeklarował wiersz (`moduleCode`, który musi być równy `id` modułu, żeby jego paczka została
  znaleziona). Klucz dla ustawienia innego modułu jest ignorowany.
- **Teksty w manifeście pozostają wymagane i pozostają angielskie.** To je zwraca API, to je widzi
  administrator, gdy paczka jest niedostępna, i to je — obok przetłumaczonego tekstu — dopasowuje
  filtr na ekranie ustawień.
- **Tekst jest pokazywany tak, jak go zapisano.** Nie ma podstawiania parametrów, więc nawiasy
  klamrowe w etykiecie są dosłowne.

Opcje ustawienia zadeklarowanego z `enumOptions` są przechowywanymi wartościami i są pokazywane bez
tłumaczenia. Grupa utworzona przez operatora w widoku `Setting groups` nie ma modułu-właściciela i
zachowuje nadaną jej nazwę.

### Tekst wielowierszowy

Ustawienie typu `string` jest edytowane w polu jednowierszowym. Zadeklaruj `multiline: true`, gdy
wartością jest tekst, w którym podziały wierszy mają znaczenie — blok instrukcji, fragment kodu,
notka w stopce:

```ts
{
  code: 'your_module.footer_note',
  name: 'Footer note',
  groupCode: 'your_section',
  valueType: 'string',
  defaultValue: '',
  multiline: true,
},
```

Ekran ustawień edytuje wtedy wartość w polu wielowierszowym, a tekst jest zapisywany dokładnie tak,
jak został wpisany: zachowane są podziały wierszy, puste wiersze, wcięcia i końcowy znak nowego
wiersza. Nic poza tym się nie zmienia — wartość nadal jest typu `string`, odczytuje się ją przez
`settingsService.get(code, channelId, z.string())` i jest rozstrzygana dla kanału sprzedaży tak jak
każde inne ustawienie.

`multiline` jest przyjmowane tylko przy `valueType: 'string'` i nie razem z `enumOptions`; każde
inne połączenie jest odrzucane podczas parsowania manifestu. To cecha prezentacji, uzgadniana z
manifestem przy każdym uzgadnianiu, więc późniejsze dodanie lub usunięcie flagi nie jest zmianą
niezgodną wstecz i nie narusza zapisanych wartości. API panelu administracyjnego zwraca ją jako
`multiline` przy każdym ustawieniu — na potrzeby modułu, który renderuje własny edytor.

Dwa ograniczenia. Edytory, które ekran ustawień dobiera według konwencji, mają pierwszeństwo przed
`multiline`: ustawienie z `enumOptions` zachowuje listę rozwijaną, a `string`, którego kod kończy
się na `_asset_id` albo wskazuje obraz i kończy się na `_url`, zachowuje edytor zasobu lub obrazu.
Usunięcie flagi niczego też nie przepisuje: zapisana wartość zachowuje podziały wierszy do chwili,
gdy operator następnym razem zmieni ją w polu jednowierszowym, które ich nie pomieści.

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
akcją, obiektem i nową wartością. Zapis lub przywrócenie wartości zapisuje też przechowywaną
wartość, którą zastąpiono lub usunięto, więc przeglądarka dziennika audytu pokazuje stan przed i po
obok siebie. Jest to wartość przechowywana na poziomie, którego dotyczy zapis — wartość dla
wszystkich kanałów albo własna wartość danego kanału — a nie wartość, którą kanał faktycznie
otrzymywał: pierwszy zapis odnotowuje `stored: false`, a nie wartość domyślną z manifestu.
Ustawienie typu `secret` jest zapisywane jako `[redacted]` po obu stronach.

## Informacje o sklepie

Grupa **Shop information** (`shop`) zawiera dane o sklepie, które publikuje
storefront: `shop.name`, `shop.address`, `shop.contact_email`,
`shop.support_email`, `shop.phone`, `shop.contact_form_recipient_emails` oraz
dwa ustawienia dla wyszukiwarek:

| Ustawienie | Typ | Co to jest |
| --- | --- | --- |
| `shop.logo_asset_id` | `string` | **Shop logo** — publiczny obraz z biblioteki zasobów, wybierany w oknie wyboru zasobu. Puste oznacza brak logo. |
| `shop.social_profiles` | `string_list` | **Social profiles** — pełne adresy `https://` profili organizacji w serwisach społecznościowych i innych witrynach, po jednym na wpis. Zapis zawierający inną wartość jest odrzucany z `422 VALIDATION_FAILED` i nic nie zostaje zapisane. |

Storefront odczytuje je przez `GET /api/v1/storefront/shop-info`, które zwraca
`logoUrl` (publiczny adres zasobu logo albo `null`, gdy ustawienie jest puste
albo zasób zniknął lub nie jest publiczny) i `socialProfiles` (tylko wpisy
`https:`). Publikuje oba w danych strukturalnych `Organization`, jako `logo` i
`sameAs`, na stronie głównej i na każdej stronie CMS. Odczyt logo jest powodem,
dla którego ten moduł zależy od `assets_library`.

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

Wiersze ustawień instalują i usuwają polecenia cyklu życia modułu, a nie osobne polecenia.
Uruchamiaj je w katalogu głównym instancji:

```bash
# Install a module: runs its migrations and reconciles its settings manifest.
pnpm run module:install <module-id> [--dry-run] [--json]

# Soft uninstall (default): unregisters the module's settings and marks the
# module uninstalled; its tables and data stay. --hard also reverts the
# module's migrations and must be combined with --force.
pnpm run module:uninstall <module-id> [--hard --force] [--json]
```

W klonie repozytorium Endora Commerce te same dwa polecenia mają postać
`pnpm --filter backend run module:install` i
`pnpm --filter backend run module:uninstall`, z tymi samymi argumentami.

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
