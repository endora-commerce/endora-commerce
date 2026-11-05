# Contract: admin surfaces, settings and credential type

Owner: `organizations`. Read with `specs/conventions/module-admin-surfaces.md` and
`specs/conventions/module-i18n.md`.

## 1. Permissions

**No new permission code.** The three settings are edited on the generic Settings screen under the
core `settings:*` codes; the credential is edited on the Credentials screen under `credentials`'
codes; the VAT validation history stays behind its existing gate
(`requireAdmin('customers:manage')`, `routes.admin.ts`). The permission inventory test
(`backend/test/contract/admin_users/permission-inventory.test.ts`) is run to confirm nothing moved.

## 2. Settings (manifest `settings.settings[]`, group `organizations`)

```ts
{
  code: ORGANIZATIONS_SETTING_CODES.REGISTRY_LOOKUP_ENABLED,   // 'organizations.registration.registry_lookup_enabled'
  name: 'Registration — company registry lookup',
  description:
    'Lets a business registering on the storefront fetch its company data (legal name, address, VAT status) from the public registry by tax ID: GUS REGON and the Ministry of Finance VAT White List for Polish NIPs, VIES for other EU VAT numbers. The data only pre-fills the form; the customer can change it and registration never depends on it. The registry answer is kept with the new organization for moderation. When off, the storefront shows the manual form and the lookup endpoint is absent.',
  groupCode: 'organizations',
  valueType: 'boolean',
  defaultValue: false,   // spec OD-6
},
{
  code: ORGANIZATIONS_SETTING_CODES.GUS_CREDENTIALS,           // 'organizations.registration.gus_credentials'
  name: 'Registration — GUS REGON credentials',
  description:
    'The GUS REGON (BIR1.1) credential configuration (Credentials screen) whose user key the company lookup uses for Polish NIPs. Optional: without it, or when it cannot be used, Polish lookups use the Ministry of Finance VAT White List alone, whose address is less structured.',
  groupCode: 'organizations',
  valueType: 'credential_ref',
  configurationType: 'organizations_gus_bir',
  defaultValue: '',
},
```

```ts
{
  code: ORGANIZATIONS_SETTING_CODES.REGISTRY_LOOKUP_PL_SOURCES, // 'organizations.registration.registry_lookup_pl_sources'
  name: 'Registration — registries for Polish NIPs',
  description:
    'Which public registries the company lookup asks for a Polish NIP. gus_mf (default): GUS REGON for the name and the structured address, together with the Ministry of Finance VAT White List for the VAT status; the White List also supplies the data when GUS is not configured or does not answer. gus: GUS REGON only — the White List is never asked, which keeps its daily limit for "Validate now" on the organization screen; the VAT status is not checked. Without a working GUS credential, gus means there is no lookup for Polish NIPs at all. mf: the White List only — no GUS key needed, but the address arrives as one line and is split as well as possible; GUS is never asked. EU VAT numbers from other countries always use VIES.',
  groupCode: 'organizations',
  valueType: 'string',
  enumOptions: ['gus_mf', 'gus', 'mf'],
  defaultValue: 'gus_mf',
},
```

Polish and English labels: `settingLabels.organizations.registration.registry_lookup_enabled.name`
/ `.description` and the same for `gus_credentials` and `registry_lookup_pl_sources`, in
`i18n/en.json` and `i18n/pl.json`. The default of `registry_lookup_enabled` is `false` (spec OD-6).

### 2a. Warning: `gus` without a GUS credential

Feasible with the existing Settings UI: `SettingRowEditor.tsx` renders the admin zone
**`settings.setting.after`** under each non-secret setting, with props `{ settingCode, ownerModule,
channelCode, draftText, dirty }` (`draftText` is the field's text for a `string` setting), and
`seo` contributes previews to it. `organizations` contributes
`src/admin/zones/PlSourcesWarning.tsx` through its `src/admin/index.ts`:

- renders nothing unless `settingCode === 'organizations.registration.registry_lookup_pl_sources'`;
- when `draftText === 'gus'` and the stored value of `organizations.registration.gus_credentials`
  (read once through the settings admin API the screen already calls, under `settings:read`) is
  empty → an admin-kit `Alert` (warning variant, icon + text):
  `settingsWarning.plSourcesGusWithoutCredential` — "With 'gus' and no GUS credential selected,
  Polish NIPs cannot be looked up at all. Select a GUS REGON credential below, or choose gus_mf or
  mf.";
- it cannot tell whether a selected credential actually resolves (that needs `credentials`'
  resolution, which no admin endpoint offers); the setting's description covers that case in words;
- a read failure renders nothing (the description still warns); the zone never blocks a save.

The decision logic is a pure function (`pl-sources-warning.ts`, unit-tested beside it).

## 3. Manifest dependency declarations

Added to `nonBindingDependencies` (not `dependencies` — research R-12):

```ts
{
  moduleId: 'credentials',
  name: 'configurationTypeRegistry',
  kind: 'contributes-to',
  reason: 'Feature 173. A push, from a contribution-only boot hook, of the GUS REGON credential type ' +
    'this module owns. The registry enumerates only types whose owner is present; nothing is read back. ' +
    'Not `dependencies`: this module is the non-deactivatable tenancy root, so the edge would make ' +
    '`credentials.enabled` a dead switch.',
},
{
  moduleId: 'credentials',
  name: 'credentialsService',
  kind: 'degrades-without',
  whenAbsent: 'the registration company lookup cannot use GUS; Polish lookups use the Ministry of Finance VAT White List alone',
  reason: 'Feature 173 (research R-12). The lookup asks whether `credentials` is present, then resolves ' +
    'the GUS credential through this port per lookup; an absent owner or an unresolvable credential ' +
    'is the documented "GUS not configured" path (owner decision OD-1). The `cms` translation precedent.',
},
```

## 4. Credential type

`organizations_gus_bir` — data-model §5. Pushed from a separate **contribution** boot hook in
`organizations/src/backend/index.ts` (unprobed; `specs/conventions/module-activation.md` item 3 —
and the module is non-deactivatable, so `check:entry-presence` exempts it by manifest).

## 5. Command palette (Principle XVI)

```ts
{
  id: 'open-registration-registry-lookup-settings',
  labelKey: 'actions.openRegistrationRegistryLookupSettings.label',
  descriptionKey: 'actions.openRegistrationRegistryLookupSettings.description',
  icon: 'Settings',
  // The generic Settings screen has no per-group address (the cms / google_tag_manager precedent).
  targetRoute: '/settings',
  requiredPermission: 'settings:read',
  keywords: ['registration', 'registry', 'lookup', 'vat', 'vies', 'company', 'tax'],
  keywordsKey: 'actions.openRegistrationRegistryLookupSettings.keywords',
  weight: <next free weight after the module's existing actions>,
}
```

Keywords are English and each must appear in some registered `en.json`
(`backend/test/unit/_i18n/registered-bundles-shape.test.ts`); `nip`, `regon`, `gus`, `rejestracja`
go in the Polish `keywordsKey` value (and `NIP, REGON, GUS` in the English one, as technical
tokens). `check:action-route-permissions` confirms `settings:read` is the code enforced on
`/settings`.

## 6. Admin API — `GET /api/v1/admin/organizations/:id/vat-validations` (extended)

Gate unchanged. Item shape, now a Zod schema in `contracts`
(`organizationTaxIdValidationRecordSchema`); additions in **bold**:

```ts
{
  id: string; provider: 'vies' | 'mf_pl' | 'format_only' | 'gus_pl';
  outcome: VatValidationOutcome; taxIdValue: string;
  legalNameReturned: string | null; addressReturned: VatReturnedAddress | null;
  errorKind: string | null; requestedByAdminUserId: string | null; createdAt: string;
  **origin: 'admin' | 'registration';**
  **registryDetails: RegistryDetails | null;**          // data-model §1.1
  **submittedValues: SubmittedCompanyValues | null;**   // data-model §1.2
  **divergence: Array<{ field: 'name' | 'street' | 'postalCode' | 'city' | 'country'; registry: string; submitted: string }> | null;**
}
```

`POST …/vat-validations` (the admin trigger) answers the same item shape with `origin: 'admin'`,
`registryDetails: null`, `submittedValues: null`, `divergence: null`; its behaviour is unchanged
(FR-024).

## 7. `VatValidationPanel` (`src/admin/panels/VatValidationPanel.tsx`)

- `provider` type widened with `gus_pl`; provider label `GUS REGON`.
- History table: an **Origin** column (`Administrator` / `Registration`), and a **Details** cell for
  registration rows: the Polish-sources mode in force (from `registryDetails.plSources`), VAT status
  (`not_checked` wording for an `unverified` / `vat_status_not_checked` row), activity status, REGON,
  and the attempts that failed or were excluded ("GUS: timed out", "White List: not asked
  (setting)").
- Above the table, when the newest **registration** row exists: a "Registry data at registration"
  card — source and fetch time, then a definition list of name / street / postal code / city /
  country with the registry's value and the submitted value side by side; each differing field
  carries a warning icon **and** the text "Differs" (never colour alone, WCAG 1.4.1); with no
  difference, one line "The submitted company data matches the registry."
- The existing "Validate now" / "Validate + apply legal name" buttons and their rules unchanged.
- New strings in the module bundle (`useTranslation('organizations')`), not in `_i18n`'s legacy
  block.

## 8. `ModerationActionsPanel` (`src/admin/panels/ModerationActionsPanel.tsx`)

New optional prop `registryDivergenceCount?: number`, passed by `OrganizationDetail.tsx` from the
newest registration row. When the Organization is `pending_verification` and the count is > 0: an
`Alert` (warning variant, icon + text) "Fields differing from the registry: {count}. See VAT
validation below." with a link scrolling to the VAT panel's heading. Phrased without a plural form
because the admin kit's resolver (`packages/admin-kit/src/i18n/`) has no plural rules.

## 9. Admin i18n keys (module bundle, flat, EN + PL)

| Key | English |
| --- | --- |
| `settingLabels.organizations.registration.registry_lookup_enabled.name` | Registration — company registry lookup |
| `settingLabels.organizations.registration.registry_lookup_enabled.description` | (as §2) |
| `settingLabels.organizations.registration.gus_credentials.name` | Registration — GUS REGON credentials |
| `settingLabels.organizations.registration.gus_credentials.description` | (as §2) |
| `actions.openRegistrationRegistryLookupSettings.label` | Registration company lookup settings |
| `actions.openRegistrationRegistryLookupSettings.description` | Switch the registry lookup on or off, choose the registries for Polish NIPs and the GUS credentials |
| `settingLabels.organizations.registration.registry_lookup_pl_sources.name` | Registration — registries for Polish NIPs |
| `settingLabels.organizations.registration.registry_lookup_pl_sources.description` | (as §2) |
| `settingsWarning.plSourcesGusWithoutCredential` | With "gus" and no GUS credential selected, Polish NIPs cannot be looked up at all. Select a GUS REGON credential below, or choose gus_mf or mf. |
| `vatValidation.plSources.gus_mf` / `.gus` / `.mf` | GUS + White List / GUS only / White List only |
| `vatValidation.attempt.reason.excluded_by_setting` | not asked (setting) |
| `vatValidation.vatStatus.not_checked` | VAT status not checked |
| `actions.openRegistrationRegistryLookupSettings.keywords` | NIP, REGON, GUS |
| `vatValidation.provider.gus_pl` | GUS REGON |
| `vatValidation.column.origin` | Origin |
| `vatValidation.column.details` | Details |
| `vatValidation.origin.admin` | Administrator |
| `vatValidation.origin.registration` | Registration |
| `vatValidation.registry.heading` | Registry data at registration |
| `vatValidation.registry.fetchedFrom` | From {source}, fetched {when} |
| `vatValidation.registry.column.field` | Field |
| `vatValidation.registry.column.registry` | Registry |
| `vatValidation.registry.column.submitted` | Submitted |
| `vatValidation.registry.field.name` / `.street` / `.postalCode` / `.city` / `.country` | Company name / Street / Postal code / City / Country |
| `vatValidation.registry.differs` | Differs |
| `vatValidation.registry.matches` | The submitted company data matches the registry. |
| `vatValidation.registry.empty` | The registry returned no company data. |
| `vatValidation.vatStatus.active` / `.exempt` / `.not_registered` / `.unknown` | Active VAT payer / VAT exempt / Not registered for VAT / VAT status unknown |
| `vatValidation.activity.ceased` | Activity ceased |
| `vatValidation.regon` | REGON {regon} |
| `vatValidation.attempt.failed` | {provider}: {reason} |
| `vatValidation.attempt.reason.network_timeout` / `.network_error` / `.not_configured` / `.budget_exhausted` / `.gus_invalid_key` / `.gus_session` / `.rate_limited` / `.other` | timed out / unreachable / not configured / lookup budget used up / key rejected / session error / rate limited / failed |
| `moderation.registryDivergence` | Fields differing from the registry: {count}. See VAT validation below. |

Polish texts are written with the implementation and reviewed by the designer (tasks T060).
