---
title: Dane uwierzytelniające (Credentials)
description: Typowane konfiguracje danych uwierzytelniających wielokrotnego użytku (modele językowe, adapter e-mail), do których odwołują się ustawienia
---

# Dane uwierzytelniające (Credentials)

Moduł `credentials` pozwala operatorowi **raz zdefiniować konfigurację danych uwierzytelniających**
i odwoływać się do niej z wielu miejsc. Zamiast wpisywać ten sam klucz API w ustawieniach asystenta
AI, mechanizmu wektoryzacji wyszukiwarki i newslettera, tworzysz jedną konfigurację *Primary LLM* i
wskazujesz ją w każdym z tych ustawień. Zmieniasz klucz raz — każde miejsce, które z niego korzysta,
dostaje nową wartość bez dalszych zmian.

Pola z sekretami (klucze API, hasła) są **szyfrowane w bazie**, na granicy API **dostępne tylko do
zapisu** (nigdy nie są zwracane jawnym tekstem), **maskowane przy każdym odczycie** i **ukrywane w
dzienniku audytu**. Każde utworzenie, zmiana i usunięcie jest audytowane przez Command Bus.

## Dla właścicieli produktu i operatorów

### Czym jest konfiguracja danych uwierzytelniających

Konfiguracja to nazwana instancja **typu konfiguracji**, z własnym kodem. Od razu dostępne są dwa
typy:

- **LLM** — dostawcy **GPT** (OpenAI), **Gemini** (Google), **Claude** (Anthropic) i **DeepSeek**.
  Pola: **API Key** (sekret, wymagane), **Model** (wymagane), **Base URL** (opcjonalne).
- **Email adapter** — dostawcy **SMTP**, **Amazon SES** i **SendGrid**. Każdy dostawca ma własny
  zestaw pól z dokładnie jednym sekretem (SMTP `password`, SES `secretAccessKey`, SendGrid `apiKey`).

Wybrany typ i dostawca decydują, jakie pola pokazuje formularz.

### Tworzenie konfiguracji

1. Otwórz **Credentials** na pasku bocznym panelu (widoczne z uprawnieniem `credentials:read`).
2. Kliknij **New configuration**.
3. Wybierz **Type** (np. *LLM*) i **Provider** (np. *Claude*). Formularz pokaże pola tego
   dostawcy.
4. Wypełnij **Name** (np. `Primary LLM`) i **Code** (stały identyfikator, np. `primary-llm` — do
   niego odwołują się ustawienia), a potem pozostałe pola (API Key, Model, …).
5. Kliknij **Save.** Konfiguracja pojawia się na liście; każdy sekret jest pokazywany jako **set** —
   nigdy jako wartość.

Edycja działa tak samo. Przy edycji **typ i dostawca są zablokowane** (nie można ich zmienić —
utwórz nową konfigurację). Pozostawienie **pustego** pola sekretu **zachowuje zapisany sekret**;
wpisanie nowej wartości go zastępuje.

### Korzystanie z konfiguracji w ustawieniu

Niektóre ustawienia są typu **„credential reference”** i są ograniczone do jednego typu konfiguracji.
Takie ustawienie wyświetla się jako **lista wyboru pasujących konfiguracji** z przyciskiem
**Preview**:

1. Otwórz **Settings** i znajdź ustawienie z odwołaniem do danych uwierzytelniających (np. *LLM
   credentials* asystenta AI).
2. Wybierz konfigurację z listy — dostępne są tylko konfiguracje właściwego typu.
3. Kliknij **Preview**, aby bez opuszczania strony zobaczyć wskazaną konfigurację w trybie tylko do
   odczytu (z zamaskowanymi sekretami).

Aby wykorzystać konfigurację wielokrotnie, wskaż **tę samą** konfigurację w kilku ustawieniach. Gdy
raz zmienisz klucz w konfiguracji, wszystkie te ustawienia dostaną nową wartość.

### Bezpieczeństwo

- **Usunięcie jest blokowane, dopóki istnieje odwołanie.** Próba usunięcia konfiguracji, którą nadal
  wskazuje jakieś ustawienie, kończy się jasnym komunikatem z listą ustawień, które trzeba najpierw
  odłączyć.
- **Osierocone konfiguracje** (których typ nie jest już dostępny) są pokazywane tylko do odczytu
  („unavailable”) i nigdy nie powodują awarii ekranu.
- **Jawna wartość sekretu nigdy nie opuszcza serwera** — lista, szczegóły i podgląd maskują sekrety;
  odszyfrowuje je, w pamięci i tylko na potrzeby użycia, wyłącznie kod korzystający z nich po stronie
  serwera.

## Dla programistów

### Model

Typ konfiguracji to **opis rejestrowany w kodzie** (a nie wiersze w bazie):

```ts
interface ConfigurationTypeDescriptor {
  code: string;            // 'llm' | 'email_adapter' | …
  label: string;
  ownerModule: string;
  providers: ProviderVariant[];
}
interface ProviderVariant { code: string; label: string; fields: FieldDefinition[]; }
interface FieldDefinition {
  key: string;
  label: string;
  kind: 'string' | 'number' | 'boolean' | 'select';
  required: boolean;
  secret: boolean;         // secret ⇒ encrypted at rest, masked on read
  options?: { value: string; label: string }[];
  placeholder?: string;
}
```

Zapisana konfiguracja przechowuje `typeCode`, `providerCode` i zbiór wartości `values` (sekrety jako
zaszyfrowane struktury AES-256-GCM, pozostałe pola jako zwykłe wartości proste) w tabeli
`credential_configurations` (`@GlobalEntity`, wspólnej dla całej platformy).

Rdzeń modułu **nie zależy od konkretnych typów**: odczytuje opis tylko po to, by wyświetlić pola,
wyprowadzić walidację zapisu i ustalić, które pola są sekretami. Nigdy nie zawiera osobnej logiki dla
konkretnego `typeCode` / `providerCode` — znaczenie dostawcy zna kod, który z konfiguracji korzysta.

### Rejestracja nowego typu (punkt rozszerzenia)

Typ rejestruje się podczas instalacji dowolnego modułu, przez singleton wspólny dla całego procesu —
**bez zmiany rdzenia modułu credentials** (bezpieczne także dla modułów nakładkowych):

```ts
import { configurationTypeRegistry } from '@core/modules/credentials/services/registry-singleton.js';

configurationTypeRegistry.register({
  code: 'sms_gateway',
  label: 'SMS Gateway',
  ownerModule: 'my_module',
  providers: [
    {
      code: 'twilio',
      label: 'Twilio',
      fields: [
        { key: 'accountSid', label: 'Account SID', kind: 'string', required: true, secret: false },
        { key: 'authToken', label: 'Auth Token', kind: 'string', required: true, secret: true },
      ],
    },
  ],
});
```

Typ od razu pojawia się na liście typów w panelu (`GET /api/v1/admin/credentials/types`) i można
tworzyć jego konfiguracje.

### Typ wartości ustawienia `credential_ref`

Aby ustawienie mogło wskazywać konfigurację, zadeklaruj je w manifeście ustawień modułu:

```ts
{
  code: 'prompt_actions.llm_credentials',
  name: 'LLM credentials',
  valueType: 'credential_ref',
  configurationType: 'llm',   // only configurations of this type are selectable
  defaultValue: '',           // empty ⇒ not configured
}
```

`configurationType` jest **wymagane** w ustawieniach `credential_ref`, a w pozostałych — zabronione.
Zapisywaną wartością jest po prostu **kod** konfiguracji.

### Odczyt wskazanej konfiguracji (po stronie korzystającego kodu)

Odczyt to **wywołanie usługi po stronie serwera** (nigdy odpowiedź HTTP) — jedyna ścieżka zwracająca
odszyfrowane sekrety, wyłącznie do użycia w pamięci:

```ts
const code = await settings.get('prompt_actions.llm_credentials'); // → 'primary-llm'
const cred = code ? await credentials.resolve(code) : { status: 'not_configured' };
if (cred.status !== 'ok') throw new Error('LLM not configured'); // fail closed
callProvider(cred.providerCode, cred.values.apiKey, cred.values.model);
```

`resolve` zwraca wynik w postaci unii rozłącznej:

- `{ status: 'ok', typeCode, providerCode, values }` — sekrety odszyfrowane;
- `{ status: 'not_configured' }` — odwołanie nie jest ustawione albo jest puste;
- `{ status: 'unavailable', reason: 'missing' | 'inert_type' }` — usunięty kod albo niezarejestrowany
  typ.

Korzystający kod nigdy nie dostaje przez sieć konfiguracji innego typu ani jawnej wartości sekretu.

### Spójność przy usuwaniu

`CredentialsService.delete` najpierw wywołuje `SettingsService.listReferencesToConfiguration(code)`
(jedyny sposób, w jaki moduł credentials sięga do ustawień). Niepusty wynik blokuje usunięcie z
`409 CREDENTIAL_IN_USE` i zwraca `{ referencedBy: [{ settingCode, salesChannelCode? }] }`.

### Sekrety i konfiguracja

Sekrety są szyfrowane wspólnym mechanizmem platformy (AES-256-GCM) z kluczem z istniejącej zmiennej
środowiskowej **`SETTINGS_SECRET_ENCRYPTION_KEY`** — nie trzeba przygotowywać nowego sekretu. Zapis
sekretu bez klucza jest odrzucany (`SETTING_SECRET_KEY_MISSING`); przy starcie pojawia się
ostrzeżenie, jeśli klucz nie jest ustawiony.

### Uprawnienia

- `credentials:read` — podgląd konfiguracji i katalogu typów (z zamaskowanymi sekretami).
- `credentials:write` — tworzenie, edycja i usuwanie konfiguracji, łącznie z zapisem sekretów.
