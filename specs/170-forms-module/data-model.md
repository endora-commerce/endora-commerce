# Data model: Forms (`specs/170-forms-module/`)

Owner of every table below: module `forms` (`packages/modules/forms`). One migration, scaffolded with
`pnpm --filter backend run migration:new -- --module forms --name init` (never a hand-picked number;
`specs/conventions/module-migrations.md`). No foreign key to another module's table, so no
cross-module DDL and nothing for `fk-dependency-drift`; ordering follows the manifest
`dependencies` (R-2).

Naming: tables plural snake case, FKs `{singular}_id`, JSON camelCase (Principle VI).

---

## 1. `forms` — `Form` (`@GlobalEntity()`)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `key` | varchar(64) | no | unique; `^[a-z][a-z0-9_]{0,63}$`; live (R-4) |
| `name` | varchar(200) | no | admin-facing; live |
| `default_language` | varchar(16) | no | BCP-47; must be a storefront language at create |
| `status` | varchar(16) | no | `draft` \| `published` \| `closed`; index |
| `definition` | jsonb | no | the **working copy**, `FormDefinition` (§3) |
| `revision` | integer | no | default 1; optimistic concurrency (R-26) |
| `published_version_id` | uuid | yes | FK `form_versions(id)` `on delete set null`, deferrable; null while `draft` |
| `published_version_number` | integer | no | default 0 (0 = never published) |
| `recipients` | jsonb | no | `string[]` ≤ 10 e-mails; default `[]`; live |
| `channel_recipients` | jsonb | no | `Record<salesChannelId, string[]>`, each ≤ 10, ≤ 50 channels; default `{}`; live; **replaces** the default list on that channel (A-2) |
| `retention_days` | integer | yes | 1–3 650; null = keep (A-12); live |
| `accepted_entry_count` | integer | no | default 0; non-spam entries (Principle XI review) |
| `created_by_admin_user_id` | uuid | yes | |
| `updated_by_admin_user_id` | uuid | yes | |
| `created_at`, `updated_at` | timestamptz | no | |

Indexes: `forms_key_unique` (unique `key`), `forms_status_idx`, `forms_retention_idx` on
`(retention_days)` where not null.

**State transitions** (`status`):

```text
draft ──publish──▶ published ──close──▶ closed
  ▲                 │  ▲                 │
  │                 └──┴──publish (next version, stays published)
  │                         reopen ◀─────┘ (back to published; a closed form may also publish)
(duplicate creates a new draft)
delete: any state; with entries → requires confirmation + forms:entries_write + unrestricted scope
```

Publish from `closed` creates the next version and leaves the form `closed` (reopen is explicit).

## 2. `form_versions` — `FormVersion` (`@GlobalEntity()`)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `form_id` | uuid | no | FK `forms(id)` `on delete cascade` |
| `number` | integer | no | 1…n; unique `(form_id, number)` |
| `definition` | jsonb | no | the frozen `FormDefinition` (§3), validated by `definitionIssues` = none |
| `default_language` | varchar(16) | no | copied at publish |
| `published_at` | timestamptz | no | |
| `published_by_admin_user_id` | uuid | yes | |

Immutable: the service has no update path; an integration test asserts a publish never rewrites an
earlier row.

## 3. `FormDefinition` (JSON, `formDefinitionSchema` in `packages/contracts/src/forms.ts`)

```ts
interface FormDefinition {
  schemaVersion: 1;
  sections: FormSection[];                 // 1…30, ordered
  behaviour: FormBehaviour;
  restrictions: FormRestrictions;
  texts: Record<string /* language */, Record<string /* textId */, string>>;
}

interface FormSection {
  id: string;                              // stable element id, ^[A-Za-z0-9_-]{1,40}$
  columns: 1 | 2 | 3;
  visibility?: VisibilityRule;
  fields: FormField[];                     // ordered; total fields across sections ≤ 100
}
```

### 3.1 Fields (discriminated union on `type`)

Common to **input** fields: `id`, `key` (`^[a-z][a-z0-9_]{0,63}$`, unique among input fields),
`width` (1…section.columns), `required` (boolean), `visibility?`, `shareWithIntegrations` (boolean,
default `false`). Layout elements (`content`, `section_break`) carry `id`, `width`, `visibility?`.

| `type` | Type-specific | Answer stored |
| --- | --- | --- |
| `text` | `minLength?`, `maxLength?` (≤ 1 000), `pattern?`: `digits` \| `letters` \| `alphanumeric` \| `url`, `defaultValue?` | string, single line |
| `email` | `submitterEmail` (boolean; ≤ 1 per form), `defaultValue?` | string, lower-cased |
| `phone` | `defaultValue?` | string matching `^\+?[0-9][0-9 ()./-]{3,30}$` |
| `number` | `min?`, `max?`, `step?`, `defaultValue?` | number |
| `textarea` | `minLength?`, `maxLength?` (≤ 10 000), `defaultValue?` | string |
| `select` / `radio` | `options: { id, value }[]` (1…200, unique `value`), `defaultValue?` (a value) | option value |
| `checkboxes` | `options`, `minSelected?`, `maxSelected?`, `defaultValue?: string[]` | string[] |
| `checkbox` | `defaultChecked?` | boolean |
| `datetime` | `mode`: `date` \| `time` \| `datetime`, `earliest?`, `latest?` (same format as mode) | `YYYY-MM-DD` \| `HH:mm` \| `YYYY-MM-DDTHH:mm` |
| `country` | `allowedCountries?: string[]` (ISO 3166-1 alpha-2), `defaultValue?` | country code |
| `address` | `parts: Record<'street'\|'line2'\|'postalCode'\|'city'\|'country', { enabled, required }>` (`street`, `city` always enabled) | `{ street?, line2?, postalCode?, city?, country? }` |
| `hidden` | `source`: `static` \| `page_url` \| `page_title` \| `query_param` \| `referrer`; `staticValue?`; `paramName?` (`^[A-Za-z0-9_.-]{1,64}$`) | string ≤ 1 000, plain text |
| `privacy_consent` / `terms` | (required forced true when visible) | `{ given: true, text }` in `consents` (§4) |
| `marketing_consent` | `required` forced false, never pre-ticked | `{ given: boolean, text }` in `consents` |
| `content` | — (rich text in `texts`) | — |
| `section_break` | — (title in `texts`) | — |

### 3.2 `VisibilityRule`

```ts
interface VisibilityRule {
  connective: 'and' | 'or';                // inside each group; groups use the opposite
  groups: Condition[][];                   // 1…10 groups, total conditions ≤ 20
}
interface Condition {
  fieldId: string;                         // an input field's element id
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than'
          | 'contains' | 'not_contains' | 'is_empty' | 'is_not_empty';
  value?: string | number;                 // absent for the two empty tests
}
```

Operator applicability (one table, `FORM_CONDITION_OPERATORS_BY_TYPE`): text-like (`text`, `email`,
`phone`, `textarea`, `hidden`) → equals, not_equals, contains, not_contains, empty tests; `number`,
`datetime` → equals, not_equals, greater_than, less_than, empty tests; `select`, `radio`, `country` →
equals, not_equals, empty tests; `checkboxes` → contains, not_contains, empty tests; `checkbox` and
the consents → equals (`"true"`/`"false"`), empty tests; `address` → empty tests.

### 3.3 `FormBehaviour`

```ts
interface FormBehaviour {
  confirmation:
    | { type: 'message' }                                  // text: messages.success
    | { type: 'redirect'; url: string }                    // absolute http(s), ≤ 2 048
    | { type: 'page'; cmsPageId: string };                 // falls back to the message (FR-038)
  captchaRequired: boolean;
  confirmationEmail: { enabled: boolean; includeSummary: boolean };
}
```

### 3.4 `FormRestrictions`

```ts
interface FormRestrictions {
  maxEntries: number | null;           // 1…1 000 000; non-spam entries count
  availableFrom: string | null;        // ISO date-time (UTC)
  availableUntil: string | null;       // ISO date-time (UTC), > availableFrom when both set
  signedInOnly: boolean;
}
```

### 3.5 Validation rules (`definitionIssues`, refused at publish — FR-011, FR-033)

`duplicate_key`, `invalid_key`, `missing_options`, `duplicate_option_value`, `unknown_condition_field`,
`condition_on_layout_element`, `operator_not_allowed`, `cyclic_visibility`, `multiple_submitter_email`,
`min_above_max`, `invalid_redirect_url`, `invalid_page_reference`, `consent_must_be_required`,
`marketing_consent_required`, `width_exceeds_columns`, `too_many_fields`, `too_many_sections`,
`too_many_options`, `too_many_conditions`, `invalid_window`, `missing_default_language_label`
(an input field with no label in the default language). Each issue: `{ code, elementId, path }`.
Saving a working copy validates the **shape** only (so a half-built form can be saved); publishing
validates the rules.

### 3.6 Text ids (`texts[language][textId]`)

`form.title`, `form.description`, `form.submitLabel`;
`sections.<sectionId>.title`, `sections.<sectionId>.description`;
`fields.<fieldId>.label`, `.placeholder`, `.help`, `.content` (content, consents: rich), `.title`
(section_break), `.defaultText` (text-like default value, translatable), `.options.<optionId>`,
`.parts.<part>.label`, `.errors.<code>` (operator override of a built-in message, R-24);
`messages.success` (rich), `messages.closed`, `messages.notYetOpen`, `messages.full`,
`messages.signIn`; `email.confirmation.subject`, `email.confirmation.body` (rich).

Resolution: requested language (non-blank) → `defaultLanguage` → built-in default for `messages.*`,
`form.submitLabel` and `.errors.*` → `''`.

## 4. `form_entries` — `FormEntry` (`@CustomerScoped()`)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `form_id` | uuid | no | FK `forms(id)` `on delete cascade` |
| `form_version_id` | uuid | no | FK `form_versions(id)` `on delete cascade` |
| `form_version_number` | integer | no | denormalised for list/export |
| `sales_channel_id` | uuid | no | the resolved channel (FR-035); no FK (cross-module) |
| `language` | varchar(16) | no | |
| `page_url` | varchar(2048) | yes | same-origin path + query from the storefront; plain text |
| `submitted_at` | timestamptz | no | |
| `answers` | jsonb | no | `Record<fieldKey, AnswerValue>` — **visible input fields only** (FR-032) |
| `consents` | jsonb | no | `{ fieldKey, kind: 'privacy'\|'marketing'\|'terms', given, text }[]` — `text` is the sanitised HTML shown, in the submission language (FR-029) |
| `submitter_email` | varchar(320) | yes | the submitter e-mail answer, lower-cased; null when hidden/absent |
| `search_text` | text | no | lower-cased text answers, ≤ 20 000 chars (R-18) |
| `status` | varchar(16) | no | `new` \| `read` \| `closed` \| `spam`; default `new` |
| `confirmation_sent_at` | timestamptz | yes | FR-058 at most once |
| `customer_account_id` | uuid | yes | server-stamped from the session |
| `organization_id` | uuid | yes | server-stamped from the account |
| `created_at`, `updated_at` | timestamptz | no | |

Constraints and indexes:

- `form_entries_attribution_chk` — `check ((customer_account_id is null) = (organization_id is null))`
  (Principle XI review: an equivalence, stricter than the newsletter's implication).
- `form_entries_status_chk` — status in the four values.
- `form_entries_form_submitted_idx` `(form_id, submitted_at desc, id desc)` — list and keyset.
- `form_entries_submitted_idx` `(submitted_at desc, id desc)` — list without a form filter.
- `form_entries_status_idx`, `form_entries_channel_idx` `(sales_channel_id)`,
  `form_entries_organization_idx` `(organization_id)`,
  `form_entries_customer_account_id_index` `(customer_account_id)` (the tenant-key index, named as
  the newsletter's).
- `form_entries_email_trgm_idx` GIN `(submitter_email gin_trgm_ops)`,
  `form_entries_search_trgm_idx` GIN `(search_text gin_trgm_ops)`; `create extension if not exists
  pg_trgm` first in the migration.

`AnswerValue = string | number | boolean | string[] | { street?: string; line2?: string;
postalCode?: string; city?: string; country?: string }`.

**State transitions** (`status`): `new → read` on open (automatic, once); any → any by an employee
(`new`, `read`, `closed`, `spam`). Changing to/from `spam` moves `forms.accepted_entry_count`.

**Lifecycle**: created by the submit Command only; deleted by an employee (single/bulk), by
retention, by account erasure (R-17), or by form deletion (cascade). Never updated except `status`
and `confirmation_sent_at`.

## 5. `form_entry_notes` — `FormEntryNote` (`@TransitivelyScoped('FormEntry', 'entryId')`)

| Column | Type | Null | Notes |
| --- | --- | --- | --- |
| `id` | uuid PK | no | |
| `entry_id` | uuid | no | FK `form_entries(id)` `on delete cascade`; index |
| `body` | text | no | 1…5 000 chars, plain text |
| `author_admin_user_id` | uuid | yes | from the ambient actor |
| `created_at` | timestamptz | no | |

Append-only. Never in any e-mail, event, export or public response (FR-049).

## 6. Settings (`forms` group, platform-wide)

| Code | Type | Default | Notes |
| --- | --- | --- | --- |
| `forms.enabled` | boolean | `true` | activation control (Principle XVII) |
| `forms.captcha_provider` | string, enum `none`\|`turnstile`\|`hcaptcha` | `none` | |
| `forms.captcha_site_key` | string | `''` | public; carried in the public definition |
| `forms.captcha_secret_key` | **secret** | `''` | never returned by any read (F-18) |

## 7. Derived values the API computes (not stored)

- `warnings` on the admin form read: `no_recipients` (no default list and no override for some active
  channel), `captcha_not_configured` (version or working copy requires it, provider `none` or keys
  empty), `untranslated` (`{ language, missing: number }[]` over the storefront languages of active
  channels).
- `availability` on the public read: `open` | `closed` | `not_yet_open` | `full` | `unavailable`
  (`sign_in_required` is a renderer decision from `restrictions.signedInOnly` and the viewer; the
  server enforces it at submit).

## 8. Audit actions (Command Bus)

`forms.form.create`, `forms.form.update`, `forms.form.publish`, `forms.form.close`,
`forms.form.reopen`, `forms.form.duplicate`, `forms.form.delete`, `forms.form.recipients_update`,
`forms.form.retention_update`, `forms.entry.submit`, `forms.entry.mark_read`,
`forms.entry.status_change`, `forms.entry.note_add`, `forms.entry.delete`, `forms.entries.delete`
(bulk), `forms.entries.export`, `forms.entries.retention_delete`,
`forms.entries.erase_for_account`. Before/after states carry ids, status, version numbers, counts and
filter values — **never** `answers`, `consents`, `submitter_email`, `search_text` or note bodies
(FR-053, FR-055). Settings writes are audited by `settings`' own path.

## 9. Events

| Name | Payload | Emitted | Consumers |
| --- | --- | --- | --- |
| `forms.entry.submitted.v1` | `FormEntrySubmittedEventV1Schema` (`contracts/events-and-webhook.md`) | submit Command, on commit; never for honeypot hits | `webhooks` bridge; `forms` notification enqueuer |
| `forms.form.changed` | `{ eventId, occurredAt, formId }` | publish/close/reopen/delete Commands, on commit | `forms` storefront revalidation |
| `customer_account.anonymized.v1` *(new, owned by `customer_accounts`)* | `{ eventId, occurredAt, customerAccountId, organizationId }` | `anonymize` | `forms` erasure subscriber |

## 10. Queues

| Queue | Job data | Producer | Consumer |
| --- | --- | --- | --- |
| `forms-notifications` | `{ entryId, shopLanguage }` | `forms.entry.submitted.v1` subscriber | notification worker (`ctx.worker`), attempts 5, exponential backoff |
| `forms-maintenance` | `{}` (Job Scheduler, every 15 min) | `upsertJobScheduler` at worker start | maintenance worker: retention, erasure reconciliation, counter repair |

Queue names contain no `:` (`check:queue-names`).
