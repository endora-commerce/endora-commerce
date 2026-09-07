---
title: Credentials
description: Reusable typed credential configurations (LLM, email adapter) referenced from settings
---

# Credentials

The `credentials` module (feature `058`) lets an operator define a **reusable
credential configuration once** and reference it from many places. Instead of
re-typing an API key into the AI-assistant settings, the search-embedder
settings, and the newsletter settings, you create a single *Primary LLM*
configuration and point each setting at it. Change the key once — every
consumer picks up the new value with no further edits.

Secret fields (API keys, passwords) are **encrypted at rest**, **write-only at
the boundary** (never returned in plaintext), **masked on every read**, and
**redacted in the audit log**. Every create / edit / delete is audited through
the Command Bus.

## For Product Owners & operators

### What a credential configuration is

A configuration is a named, coded instance of a **configuration type**. Two
types ship out of the box:

- **LLM** — providers **GPT** (OpenAI), **Gemini** (Google), **Claude**
  (Anthropic), and **DeepSeek**. Fields: **API Key** (secret, required),
  **Model** (required), **Base URL** (optional).
- **Email adapter** — providers **SMTP**, **Amazon SES**, and **SendGrid**.
  Each provider has its own field set with exactly one secret field
  (SMTP `password`, SES `secretAccessKey`, SendGrid `apiKey`).

The type and provider you pick decide which fields the form shows.

### Creating a configuration

1. Open **Credentials** in the admin sidebar (visible with the
   `credentials:read` permission).
2. Click **New configuration**.
3. Pick a **Type** (e.g. *LLM*) and a **Provider** (e.g. *Claude*). The form
   redraws to that provider's fields.
4. Fill in a **Name** (e.g. `Primary LLM`) and a **Code** (a stable identifier
   like `primary-llm` — this is what settings reference), then the fields
   (API Key, Model, …).
5. **Save.** The configuration appears in the list; every secret field shows as
   **set** — never the value.

Editing works the same way. On edit, the **type and provider are locked** (they
cannot change — create a new configuration instead). Leaving a secret field
**blank keeps the stored secret**; typing a new value replaces it.

### Using a configuration from a setting

Some settings are of the **"credential reference"** kind, constrained to one
configuration type. Such a setting renders as a **picker of matching
configurations** plus a **Preview** button:

1. Open **Settings** and find the credential-reference setting (e.g. an AI
   assistant's *LLM credentials*).
2. Select your configuration from the dropdown — only configurations of the
   right type are offered.
3. Click **Preview** to see the referenced configuration read-only (secrets
   masked) without leaving the page.

Assign the **same** configuration to several settings to reuse it. Update the
configuration's key once and all of them resolve the new value.

### Safety

- **Delete is blocked while referenced.** Trying to delete a configuration that
  a setting still points at fails with a clear message listing exactly which
  settings to detach first.
- **Orphaned configurations** (whose type is no longer available) are shown
  read-only ("unavailable") and never crash the screen.
- **No plaintext ever leaves the server** — list, detail, and preview all mask
  secrets; only the server-side consumer path decrypts, in memory, for use.

## For developers

### Model

A configuration type is a **code-registered descriptor** (not database rows):

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

A saved configuration stores `typeCode` + `providerCode` + a `values` bag
(secret fields hold AES-256-GCM envelopes, non-secret fields hold plain
scalars) in the `credential_configurations` table (`@GlobalEntity`,
platform-global).

The credentials **core is type-agnostic** (Constitution Principle XIV): it reads
a descriptor only to render fields, derive the write-validator, and learn which
fields are secret. It never branches on a specific `typeCode` / `providerCode` —
provider meaning lives with the consumer.

### Registering a new type (the extension point)

Register from any module's install path via the process-wide singleton — **no
change to the credentials core** is required (Principle XV, overlay-safe):

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

The type immediately appears in the admin type picker (`GET
/api/v1/admin/credentials/types`) and is creatable.

### The `credential_ref` settings value type

To let a setting reference a configuration, declare it in a module's settings
manifest:

```ts
{
  code: 'prompt_actions.llm_credentials',
  name: 'LLM credentials',
  valueType: 'credential_ref',
  configurationType: 'llm',   // only configurations of this type are selectable
  defaultValue: '',           // empty ⇒ not configured
}
```

`configurationType` is **required** for `credential_ref` settings and forbidden
otherwise. The stored value is simply the configuration **code**.

### Resolving a reference (consumer side)

Resolution is a **server-side service call** (never an HTTP response) — the one
path that returns decrypted secrets, for in-memory use only:

```ts
const code = await settings.get('prompt_actions.llm_credentials'); // → 'primary-llm'
const cred = code ? await credentials.resolve(code) : { status: 'not_configured' };
if (cred.status !== 'ok') throw new Error('LLM not configured'); // fail closed
callProvider(cred.providerCode, cred.values.apiKey, cred.values.model);
```

`resolve` returns a discriminated result:

- `{ status: 'ok', typeCode, providerCode, values }` — secrets decrypted;
- `{ status: 'not_configured' }` — the reference is unset/empty;
- `{ status: 'unavailable', reason: 'missing' | 'inert_type' }` — a deleted
  code or an unregistered type.

A consumer never receives a foreign configuration and never a plaintext secret
over the wire.

### Delete integrity

`CredentialsService.delete` first calls
`SettingsService.listReferencesToConfiguration(code)` (the only channel by which
credentials reaches settings — Principle I). A non-empty result blocks the
delete with `409 CREDENTIAL_IN_USE`, carrying `{ referencedBy: [{ settingCode,
salesChannelCode? }] }`.

### Secrets & configuration

Secret fields reuse the platform's AES-256-GCM envelope codec keyed by the
existing **`SETTINGS_SECRET_ENCRYPTION_KEY`** env var — no new secret to
provision. Writing a secret without the key fails closed
(`SETTING_SECRET_KEY_MISSING`); boot warns if the key is unset.

### Permissions

- `credentials:read` — view configurations and the type catalogue (secrets
  masked).
- `credentials:write` — create / edit / delete configurations, including
  writing secret fields.
