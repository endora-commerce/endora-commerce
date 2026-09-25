---
title: Credentials
description: Wielokrotnego użytku typowane konfiguracje poświadczeń (LLM, adapter e-mail) referencjonowane z ustawień
---

# Credentials

Moduł `credentials` pozwala operatorowi zdefiniować **wielokrotnego
użytku konfigurację poświadczeń raz** i referencjonować ją z wielu miejsc. Zamiast
wpisywać klucz API ponownie w ustawieniach asystenta AI, embeddera wyszukiwania
i newslettera, tworzysz jedną konfigurację *Primary LLM* i wskazujesz nią każde
ustawienie. Zmień klucz raz — każdy konsument pobiera nową wartość bez dalszych
edycji.

Pola tajne (klucze API, hasła) są **szyfrowane w spoczynku**, **write-only na
granicy** (nigdy nie zwracane w plaintext), **maskowane przy każdym odczycie** i
**redagowane w logu audytu**. Każde utworzenie / edycja / usunięcie jest audytowane
przez Command Bus.

## Dla Product Ownerów i operatorów

### Czym jest konfiguracja poświadczeń

Konfiguracja to nazwana, zakodowana instancja **typu konfiguracji**. Dwa typy
 są dostarczane out of the box:

- **LLM** — dostawcy **GPT** (OpenAI), **Gemini** (Google), **Claude**
  (Anthropic) i **DeepSeek**. Pola: **API Key** (tajne, wymagane),
  **Model** (wymagany), **Base URL** (opcjonalny).
- **Email adapter** — dostawcy **SMTP**, **Amazon SES** i **SendGrid**.
  Każdy dostawca ma własny zestaw pól z dokładnie jednym polem tajnym
  (SMTP `password`, SES `secretAccessKey`, SendGrid `apiKey`).

Wybrany typ i dostawca decydują, które pola pokazuje formularz.

### Tworzenie konfiguracji

1. Otwórz **Credentials** w sidebarze admina (widoczne z uprawnieniem
   `credentials:read`).
2. Kliknij **New configuration**.
3. Wybierz **Type** (np. *LLM*) i **Provider** (np. *Claude*). Formularz
   przeładuje się na pola tego dostawcy.
4. Wypełnij **Name** (np. `Primary LLM`) i **Code** (stabilny identyfikator
   jak `primary-llm` — to referencjonują ustawienia), potem pola
   (API Key, Model, …).
5. **Save.** Konfiguracja pojawia się na liście; każde pole tajne pokazuje się jako
   **set** — nigdy wartość.

Edycja działa tak samo. Przy edycji **typ i dostawca są zablokowane** (nie
można ich zmienić — utwórz nową konfigurację). Pozostawienie pola tajnego
**pustego zachowuje zapisane sekret**; wpisanie nowej wartości je zastępuje.

### Użycie konfiguracji z ustawienia

Niektóre ustawienia są typu **"credential reference"**, ograniczone do jednego
typu konfiguracji. Takie ustawienie renderuje się jako **picker pasujących
konfiguracji** plus przycisk **Preview**:

1. Otwórz **Settings** i znajdź ustawienie credential-reference (np. *LLM credentials*
   asystenta AI).
2. Wybierz konfigurację z dropdownu — oferowane są tylko konfiguracje właściwego typu.
3. Kliknij **Preview**, aby zobaczyć referencjonowaną konfigurację read-only (sekrety
   zamaskowane) bez opuszczania strony.

Przypisz **tę samą** konfigurację do kilku ustawień, aby ją wielokrotnie użyć. Zaktualizuj
klucz konfiguracji raz, a wszystkie rozwiążą nową wartość.

### Bezpieczeństwo

- **Usunięcie jest blokowane, dopóki istnieje referencja.** Próba usunięcia konfiguracji,
  na którą nadal wskazuje ustawienie, kończy się jasnym komunikatem wymieniającym
  dokładnie, które ustawienia trzeba najpierw odłączyć.
- **Osierocone konfiguracje** (których typ nie jest już dostępny) są pokazywane
  read-only („unavailable”) i nigdy nie crashują ekranu.
- **Plaintext nigdy nie opuszcza serwera** — lista, szczegóły i podgląd maskują
  sekrety; tylko ścieżka konsumenta po stronie serwera deszyfruje, w pamięci, do użycia.

## Dla developerów

### Model

Typ konfiguracji to **deskryptor rejestrowany kodem** (nie wiersze bazy):

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

Zapisana konfiguracja przechowuje `typeCode` + `providerCode` + worek `values`
(pola tajne trzymają koperty AES-256-GCM, pola nietajne trzymają zwykłe
skalary) w tabeli `credential_configurations` (`@GlobalEntity`,
platform-global).

Rdzeń credentials **jest agnostyczny typowo**: czyta
deskryptor tylko po to, by renderować pola, wyprowadzić walidator zapisu i
dowiedzieć się, które pola są tajne. Nigdy nie rozgałęzia się po konkretnym
`typeCode` / `providerCode` — znaczenie dostawcy żyje u konsumenta.

### Rejestracja nowego typu (punkt rozszerzenia)

Rejestruj ze ścieżki install dowolnego modułu przez process-wide singleton — **bez
zmiany rdzenia credentials** (overlay-safe):

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

Typ natychmiast pojawia się w pickerze typów admina (`GET
/api/v1/admin/credentials/types`) i można go utworzyć.

### Typ wartości ustawienia `credential_ref`

Aby ustawienie referencjonowało konfigurację, zadeklaruj je w manifeście ustawień modułu:

```ts
{
  code: 'prompt_actions.llm_credentials',
  name: 'LLM credentials',
  valueType: 'credential_ref',
  configurationType: 'llm',   // only configurations of this type are selectable
  defaultValue: '',           // empty ⇒ not configured
}
```

`configurationType` jest **wymagane** dla ustawień `credential_ref` i zabronione
inaczej. Zapisana wartość to po prostu **code** konfiguracji.

### Rozwiązywanie referencji (strona konsumenta)

Rozwiązywanie to **wywołanie serwisu po stronie serwera** (nigdy odpowiedź HTTP) —
jedyna ścieżka zwracająca odszyfrowane sekrety, tylko do użycia w pamięci:

```ts
const code = await settings.get('prompt_actions.llm_credentials'); // → 'primary-llm'
const cred = code ? await credentials.resolve(code) : { status: 'not_configured' };
if (cred.status !== 'ok') throw new Error('LLM not configured'); // fail closed
callProvider(cred.providerCode, cred.values.apiKey, cred.values.model);
```

`resolve` zwraca wynik dyskryminowany:

- `{ status: 'ok', typeCode, providerCode, values }` — sekrety odszyfrowane;
- `{ status: 'not_configured' }` — referencja jest nieustawiona/pusta;
- `{ status: 'unavailable', reason: 'missing' | 'inert_type' }` — usunięty
  code lub niezarejestrowany typ.

Konsument nigdy nie dostaje obcej konfiguracji ani plaintext sekretu
przez wire.

### Integralność usuwania

`CredentialsService.delete` najpierw woła
`SettingsService.listReferencesToConfiguration(code)` (jedyny kanał, przez który
credentials dociera do settings). Niepusty wynik blokuje
usunięcie z `409 CREDENTIAL_IN_USE`, niosąc `{ referencedBy: [{ settingCode,
salesChannelCode? }] }`.

### Sekrety i konfiguracja

Pola tajne używają platformowego kodeka koperty AES-256-GCM kluczowanego istniejącą
zmienną env **`SETTINGS_SECRET_ENCRYPTION_KEY`** — bez nowego sekretu do
provisioning. Zapis sekretu bez klucza kończy się fail closed
(`SETTING_SECRET_KEY_MISSING`); start ostrzega, jeśli klucz jest nieustawiony.

### Uprawnienia

- `credentials:read` — podgląd konfiguracji i katalogu typów (sekrety
  zamaskowane).
- `credentials:write` — tworzenie / edycja / usuwanie konfiguracji, w tym
  zapis pól tajnych.
