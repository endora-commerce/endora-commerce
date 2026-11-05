# Data model: Company registry lookup at storefront registration

Owner of everything below: **`organizations`**, except where a section names `contracts`.
Migration numbers are not assigned; the one migration is scaffolded with
`pnpm --filter backend run migration:new -- --module organizations --name registry-lookup-provenance`
and registered by `composer:generate` (`specs/conventions/module-migrations.md`).

---

## 1. `organization_tax_id_validations` — extended (existing table, `@OrgScoped()`)

Entity: `packages/modules/organizations/src/backend/entities/organization-tax-id-validation.entity.ts`.
Classification unchanged (organization-scoped). Three columns are added; every existing column keeps
its meaning.

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| `origin` | `varchar(16)` | no | `'admin'` | `'admin'` — an administrator's "Validate now" (every existing row); `'registration'` — the lookup a self-registration carried |
| `registry_details` | `jsonb` | yes | `null` | `RegistryDetails` (§1.1); written by registration rows; admin rows leave it `null` in this feature |
| `submitted_values` | `jsonb` | yes | `null` | `SubmittedCompanyValues` (§1.2); registration rows only |

Existing columns as written by a **registration** row:

| Column | Value |
| --- | --- |
| `organization_id` | the new Organization |
| `provider` | the leg that supplied the data (`gus_pl` / `mf_pl` / `vies`), else the first leg tried (research R-13) |
| `outcome` | mapped per research R-13's table |
| `tax_id_value` | the Organization's `taxId` exactly as submitted |
| `legal_name_returned` | the registry's legal name (≤ 255, truncated) |
| `address_returned` | `{ line1: street, postalCode, city, countryCode }` — the existing `ReturnedAddress` shape, so the existing panel and auto-fill keep reading it |
| `error_kind` | per research R-13 |
| `requested_by_admin_user_id` | `null` |
| `created_at` | registration time |

**Migration** (organizations-owned, additive, no backfill beyond the default):

```sql
alter table "organization_tax_id_validations"
  add column "origin" varchar(16) not null default 'admin',
  add column "registry_details" jsonb null,
  add column "submitted_values" jsonb null;
alter table "organization_tax_id_validations"
  add constraint "organization_tax_id_validations_origin_check"
  check ("origin" in ('admin', 'registration'));
```

`down` drops the constraint and the three columns. No index: the table is read by
`organization_id` (already indexed), newest first, at most 100 rows.

`VatValidationProvider` (both `packages/contracts/src/organizations.ts` and the entity file's
local type) gains `'gus_pl'`; `provider` is `varchar(32)`, so no DDL.

### 1.1 `RegistryDetails` (jsonb)

```ts
interface RegistryDetails {
  /** The Polish-sources mode the lookup ran under; null for a non-Polish lookup (always VIES). */
  plSources: 'gus_mf' | 'gus' | 'mf' | null;
  /** Which registry answered each field group. */
  dataSource: 'gus_pl' | 'mf_pl' | 'vies' | null;
  vatStatusSource: 'mf_pl' | 'vies' | null;
  regon: string | null;                                    // 9 or 14 digits
  vatPayerStatus: 'active' | 'exempt' | 'not_registered' | 'unknown';
  activityStatus: 'active' | 'ceased' | 'unknown';
  /** When the registries answered — may precede `created_at` by up to the ticket TTL. */
  fetchedAt: string;                                       // ISO-8601
  /** Was the answer served from the platform's cache. */
  fromCache: boolean;
  attempts: Array<{
    provider: 'gus_pl' | 'mf_pl' | 'vies';
    outcome: 'found' | 'not_found' | 'unavailable' | 'skipped';
    errorKind: string | null;   // 'not_configured', 'excluded_by_setting', 'budget_exhausted', 'network_timeout', 'gus_invalid_key', …
    durationMs: number | null;
  }>;
}
```

### 1.2 `SubmittedCompanyValues` (jsonb)

What the registrant submitted, captured at registration (not the Organization's current values —
research R-14):

```ts
interface SubmittedCompanyValues {
  name: string;
  taxId: string;
  registeredAddress: { street: string; postalCode: string; city: string; country: string };
}
```

No personal data of the registering user (e-mail, names, password) is stored here.

### 1.3 Read model (admin API, not persisted)

`divergence: Array<{ field: 'name' | 'street' | 'postalCode' | 'city' | 'country'; registry: string;
submitted: string }>` — computed by `computeRegistryDivergence` (research R-14) from
`legal_name_returned` / `address_returned` and `submitted_values`; `null` for an admin row, `[]`
for a registration row that matches.

---

## 2. `organizations` Organization row — unchanged schema

Registration after a matching ticket stamps the three existing summary columns
(`vat_validated_at`, `vat_validation_provider`, `vat_validation_outcome`) as the admin trigger does.
`legal_name` is **not** written (spec OD-7).

---

## 3. Redis structures (no schema; `organizations`-owned key prefix `b2b:org-registry-lookup:v1:`)

| Key | Value | TTL | Writer | Readers |
| --- | --- | --- | --- | --- |
| `answer:<CC>:<sources>:<taxId>` — `<sources>` = the Polish-sources mode for `PL`, `vies` otherwise | `RegistryLookupAnswer` | found 6 h · not found 30 min · unavailable 60 s | lookup service | lookup service |
| `ticket:<lookupId>` | `RegistryLookupSnapshot` | 2 h; deleted after a registration commits | lookup service | registration |
| `budget:<provider>:<window>` | integer counter | window + 1 h | lookup service | lookup service |

```ts
/** The merged answer of one lookup (research R-3), as cached. */
interface RegistryLookupAnswer {
  status: 'found' | 'not_found' | 'unavailable';
  country: string;              // ISO-3166 alpha-2; 'GR' is stored as 'EL' only inside VIES calls
  taxId: string;                // normalised, without prefix
  plSources: 'gus_mf' | 'gus' | 'mf' | null;   // null unless country is PL
  record: CompanyRegistryRecord | null;   // research R-2
  dataSource: 'gus_pl' | 'mf_pl' | 'vies' | null;
  vatStatusSource: 'mf_pl' | 'vies' | null;
  attempts: RegistryDetails['attempts'];
  fetchedAt: string;
}

/** What a ticket holds: the answer the buyer was shown, plus whether it came from cache. */
interface RegistryLookupSnapshot extends RegistryLookupAnswer {
  version: 1;
  lookupId: string;             // 43-char base64url
  fromCache: boolean;
  issuedAt: string;
}
```

`<lookupId>` is 32 random bytes (`crypto.randomBytes`), base64url. Validation on read: the JSON is
parsed with a Zod schema; a value that fails is treated as absent.

---

## 4. Settings (manifest, `organizations`, group `organizations`, platform-wide)

| Code | Value type | Default | Notes |
| --- | --- | --- | --- |
| `organizations.registration.registry_lookup_enabled` | `boolean` | `false` — spec OD-6 | read per request; fail-closed reader (`false` on any error) |
| `organizations.registration.gus_credentials` | `credential_ref`, `configurationType: 'organizations_gus_bir'` | `''` | empty ⇒ no GUS: White List only under `gus_mf`, no Polish lookup under `gus`, irrelevant under `mf` |
| `organizations.registration.registry_lookup_pl_sources` | `string`, `enumOptions: ['gus_mf', 'gus', 'mf']` | `'gus_mf'` | owner decision OD-5; read per lookup; unreadable / unknown ⇒ `gus_mf`; non-Polish lookups ignore it |

All three added to `ORGANIZATIONS_SETTING_CODES` (`src/manifest.ts`) as `REGISTRY_LOOKUP_ENABLED`,
`GUS_CREDENTIALS` and `REGISTRY_LOOKUP_PL_SOURCES`; the mode's values as an exported
`REGISTRY_LOOKUP_PL_SOURCES = ['gus_mf', 'gus', 'mf'] as const` beside the internal port types
(`registry-lookup/company-registry-port.ts`). The first defaults to `false` (spec OD-6). Labels: `settingLabels.<code>.name|description` in the module bundle.

---

## 5. Credential configuration type (registered on `credentials`' registry, owned by `organizations`)

```ts
export const ORGANIZATIONS_GUS_CREDENTIAL_TYPE = 'organizations_gus_bir';
export const gusBirConfigurationType: ConfigurationTypeDescriptor = {
  code: 'organizations_gus_bir',
  label: 'GUS REGON registry (BIR1.1)',
  ownerModule: 'organizations',
  providers: [{
    code: 'bir11',
    label: 'BIR1.1',
    fields: [
      { key: 'apiKey', label: 'User key', kind: 'string', required: true, secret: true },
      { key: 'environment', label: 'Environment', kind: 'select', required: true, secret: false,
        endpoint: true,
        options: [{ value: 'production', label: 'Production' }, { value: 'test', label: 'Test' }] },
    ],
  }],
};
```

Stored and encrypted by `credentials`; `organizations` stores nothing of it.

---

## 6. Contracts (`packages/contracts`)

New file `packages/contracts/src/organization-registry-lookup.ts`, exported from `index.ts`:

- `REGISTRY_LOOKUP_COUNTRIES` — `['PL', 'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL',
  'ES', 'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'RO', 'SE', 'SI',
  'SK', 'XI'] as const` (the form's country picker uses ISO `GR`; the normaliser maps it).
- `registryLookupRequestSchema`, `registryLookupResponseSchema`,
  `registrationOptionsResponseSchema`, `registryLookupIdSchema`.
- `organizationTaxIdValidationRecordSchema` — the admin history item, now typed (it was ad hoc in
  `routes.admin.ts`), including `origin`, `registryDetails`, `submittedValues`, `divergence`.

Changed in `packages/contracts/src/organizations.ts`:

- `VatValidationProvider` += `'gus_pl'`.
- `registerOrganizationRequestSchema` += top-level `registryLookupId: registryLookupIdSchema.optional()`.

Exact shapes: `contracts/public-api.md` and `contracts/admin-surfaces.md`.

---

## 7. State transitions

```text
lookup ──(found | not_found | unavailable)──▶ ticket (2 h)
ticket ──registration, toggle on, same tax ID──▶ validation row (origin=registration) ──▶ ticket deleted
ticket ──registration, toggle off / other tax ID / refused──▶ ticket kept until TTL
ticket ──TTL──▶ gone (registration proceeds with no row)
```
