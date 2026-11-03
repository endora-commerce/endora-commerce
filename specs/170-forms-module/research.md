# Research: Forms — a form builder whose forms are placed on pages as Page Builder blocks

**Feature**: `specs/170-forms-module/` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)

Every decision is written *decision → rationale → rejected*. Facts are cited by path and were read
on `feat/170-forms-module` at `183445710`. Where a fact must be re-measured by the implementer, the
decision says **verify** and names the task that does it.

---

## Facts (read, not assumed)

| # | Fact | Where |
| --- | --- | --- |
| F-1 | A module contributes a Page Builder block from its own manifest (`blocks`, `blockCategories`); the block's React renderer lives in `@endora-commerce/cms-components` (`newsletter.Signup` → `NewsletterSignupForm.tsx`, `blog.LatestPosts`). The manifest validator refuses a block whose category the same manifest does not declare. | `packages/modules/newsletter/src/manifest.ts:186-235`, `packages/cms-components/src/index.ts:420-430` |
| F-2 | Server-side data for a block is declared as a **block-data request** (closed union, each kind with an owner module), resolved by the storefront on the server and read by the block from `CatalogPreviewProvider`; a request whose owner is absent is skipped. The editor supplies the same reads through `AdminCatalogPreviewProvider`. | `packages/cms-components/src/utils/block-data.ts:1-90`, `storefront/lib/page-builder/block-data.ts`, `packages/modules/cms/src/admin/components/AdminCatalogPreviewProvider.tsx` |
| F-3 | Feature 141's `./storefront` layer lets a module package ship its own renderer, but a contributed renderer gets data only from props, the CMS render context, or a client-side fetch in an effect (R2.2); the storefront registry is empty today. The editor loads module contributions only for names the bundle does **not** render (`namesToLoad`). | `specs/141-module-block-renderers/contracts/block-renderers.md` §2, `storefront/lib/page-builder/blocks.generated.ts`, `packages/modules/cms/src/admin/components/block-contributions.ts` |
| F-4 | `storefront/app/forms/contact/route.ts` is `cms.ContactForm`'s no-JS handler (303 back with `?contact=…&form=<blockId>#anchor`, JSON with `Accept: application/json`); `forms` is already in `RESERVED_TOP_LEVEL_SEGMENTS`, reconciled by `check:storefront-indexability` in both directions. | `storefront/app/forms/contact/route.ts`, `storefront/app/reserved-segments.ts:65-66` |
| F-5 | `apiMutate` forwards the `b2b_session` cookie when given, so a storefront handler can submit **as the signed-in customer**; the contact-form handler does not. | `storefront/lib/api/mutations.ts:60-110`, `storefront/lib/api/contact-form.ts` |
| F-6 | Anonymous storefront traffic runs under `mode: 'system'`; a signed-in customer under `single-org` (keyed by `customerAccountId`); a scoped admin under `allowed-set`; an unrestricted admin under `all`. | `packages/platform/src/kernel/actor-tenant-context.ts:76-79`, `packages/platform/src/tenancy/resolve-tenant-context.ts` |
| F-7 | For a `@CustomerScoped` entity **carrying `organizationId`**, the `allowed-set` arm filters `organizationId IN (allowed)` — a row with `organization_id IS NULL` never matches; `single-org` filters `customerAccountId = <own>`; `all`/`system` filter nothing. The column's presence is read from ORM metadata per query. | `packages/platform/src/tenancy/filters.ts:66-150` |
| F-8 | `NewsletterSubscriber` is the precedent: `@CustomerScoped`, nullable `customer_account_id` + `organization_id`, owner stamped from a *resolved* owner, never from e-mail; CHECK `customer_account_id is null or organization_id is not null`; no FK to `customer_accounts`. | `packages/modules/newsletter/src/backend/entities/newsletter-subscriber.entity.ts`, `…/migrations/20260830T212736_newsletter_organization_attribution.ts`, `…/services/subscriber.service.ts:40-260` |
| F-9 | `CustomerAccountLifecycleWritePort.anonymize` scrubs the account (e-mail, names, password) and records an audit row; it emits **no event** and there is **no participant registry**. It is called only by `customers`' `CustomerDeletionService.sweep`, after the soft-delete retention window. Accounts are never hard-deleted. `customer_accounts` is non-deactivatable; `customers` is switchable. | `packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts:437-460`, `packages/modules/customers/src/backend/services/customer-deletion-service.ts:86-100` |
| F-10 | `CustomerAccountReadPort.findByIds` returns records carrying `anonymizedAt` and `deletedAt`. | `packages/contracts/src/customer-accounts.ts:112-162` |
| F-11 | Outbound webhook types are pushed by their owner into `webhookEventRegistry` from a contribution-only boot hook (`nonBindingDependencies` kind `contributes-to`); `webhooks` bridges each through its own gated subscription, delivers the **event payload whole**, sends the type in `X-Webhook-Event-Type`, stores the payload on `webhook_deliveries.payload`, and offers/delivers a type only while its owner is present. Every offered type ends in `.v1` and has a strict schema in `packages/contracts`. | `packages/modules/webhooks/src/backend/services/webhook-event-registry.ts`, `…/webhook-delivery-worker.ts:50-70`, `…/entities/webhook-delivery.entity.ts:44`, `packages/modules/crm/src/backend/index.ts:898-919`, `packages/contracts/src/crm.ts:1380-1490` |
| F-12 | `EmailMailerPort.send` takes `replyTo` (added by 169), `kind`, `salesChannelId`, `html`; the delivery record keeps recipient, kind, subject, channel, outcome — never the body. `email` is non-deactivatable. | `packages/contracts/src/email.ts:106-190`, `specs/169-page-builder-contact-form/research.md` R-6 |
| F-13 | `TransactionalEmailSender.send` is keyed by one template `code` per platform, takes `variables`, `language`, `salesChannelId`, and has **no `replyTo`**; `transactional_emails` is now non-deactivatable. | `packages/contracts/src/transactional-emails.ts:303-372`, `packages/modules/transactional_emails/src/manifest.ts:76-80` |
| F-14 | `import_export` adapters are hard-coded inside `import_export`, read whole tables through owners' ports, take no filter, and run synchronously. In-module CSV export is the precedent elsewhere (`newsletter` subscribers, `orders`). | `packages/modules/import_export/src/backend/services/adapter.ts`, `packages/modules/newsletter/src/backend/routes.admin.ts:99-105` |
| F-15 | The cross-process cache pattern is a Redis pub/sub channel plus a TTL fallback (`CustomFieldDefinitionsCache`) or an `InProcessCacheLayer` the platform drops on module-state change; the storefront's Data Cache is dropped by tag through `StorefrontRevalidator` from an EventBus subscriber (`cms`). Next keeps only a `200` in its Data Cache, so a later `404` never replaces it. | `packages/modules/custom_fields/src/backend/services/custom-field-definitions-cache.ts`, `packages/platform/src/kernel/cache/in-process-cache-registry.ts`, `packages/modules/cms/src/backend/index.ts:640-664`, `packages/contracts/src/storefront-cache-tags.ts:43-52` |
| F-16 | The tasks clock is one BullMQ Job Scheduler (`upsertJobScheduler`, every 60 s, no job data), consumed through `ctx.worker`, presence checked first, work inside `enterSystemScope`, and built only where `processRunsWorkers` and `moduleQueueRedis` exist. | `packages/modules/tasks/src/backend/workers/tasks-reminders-worker.ts`, `packages/modules/tasks/src/backend/index.ts:784-801` |
| F-17 | `useGroupedReorder` (admin-kit) reorders items within and across sections and reorders sections, by pointer (native HTML5 drag, no dependency), touch and an ARIA grab-mode keyboard map, announcing every move. `@dnd-kit/core` is in `admin` and `admin-kit` only (Kanban). | `packages/admin-kit/src/components/reorder/useGroupedReorder.ts`, `packages/admin-kit/src/components/index.ts:118-123` |
| F-18 | Settings support `valueType: 'secret'` (encrypted at rest, never returned by read endpoints, readable server-side through `settingsReadPort.get`). | `packages/contracts/src/settings.ts:16-55`, `packages/modules/google_analytics/src/backend/services/ss-delivery.service.ts:70-90` |
| F-19 | `cmsPageReadPort.findStorefrontLinks(ids, { salesChannelId, language })` answers a page's logical path per language and omits pages the channel does not serve. `cms` is switchable. | `packages/contracts/src/cms.ts:1025-1060` |
| F-20 | The country list with translated labels is the `dictionaries` module's (non-deactivatable); the storefront already holds it in `DictionaryProvider` at the root layout; the backend validates a code with `dictionaryValidator.validateCountryCode`. | `storefront/app/layout.tsx:286`, `storefront/lib/dictionary/pickers/CountryPicker.tsx`, `packages/contracts/src/dictionary.ts:353-358` |
| F-21 | `pg_trgm` is created `if not exists` by module migrations that need it. | `packages/modules/catalog/src/migrations/20261022T182523_catalog_admin_name_keys.ts:37` |
| F-22 | Per-route rate limits use `config.rateLimit` with a `keyGenerator`; `request.ip` honours the deployment's trusted-proxy settings. | `specs/169-page-builder-contact-form/research.md` R-9 |
| F-23 | The platform's five published subpaths are `kernel`, `http`, `tenancy`, `commands`, `events`; `getTenantContext`, `withSystemScope` and the classification decorators are on `./tenancy`, `enterSystemScope` on `./kernel`. | `packages/cli/src/lib/platform-surface.ts:77-83`, `packages/platform/src/tenancy/index.ts:48-75` |

---

## Principle XI review — entry ownership (FR-045, FR-046) — **recorded as FR-046 requires**

**Classification.**

| Entity | Classification | Why |
| --- | --- | --- |
| `Form` (`forms`) | `@GlobalEntity()` | Operator content, like a CMS page; not about any customer (spec *Tenancy*). |
| `FormVersion` (`form_versions`) | `@GlobalEntity()` | Immutable snapshot of operator content. |
| `FormEntry` (`form_entries`) | **`@CustomerScoped()`** with `organizationId` | A submission is a customer's record when a customer made it; F-7 makes the column grant `allowed-set` reads. Same classification as `NewsletterSubscriber` (F-8). |
| `FormEntryNote` (`form_entry_notes`) | `@TransitivelyScoped('FormEntry', 'entryId')` | A note has no tenant of its own; it is reachable only through its entry (the CRM comment precedent). |

**The nullable organisation.** `customer_account_id` and `organization_id` are nullable **together**.
Unlike the newsletter's implication (F-8, which left R-6 open), the spec states both directions
(FR-045: "an entry naming an account MUST name an organisation; an entry naming none carries no
organisation"), so the constraint is an **equivalence**:

```sql
constraint form_entries_attribution_chk
  check ((customer_account_id is null) = (organization_id is null))
```

**The attribution constraint.** Both columns are stamped **by the server at the write** from
`request.actor` (`kind === 'customer'`) — the account id from the session, the organisation resolved
through `customerAccountReadPort.findById` (non-null since D-178; a non-resolving account refuses the
write rather than writing an owned row with no organisation, exactly `#organizationOf` in F-8). The
request body has no field for either; the public submission schema is `.strict()`. Attribution is
never derived from a typed e-mail address. MikroORM applies no filter to `INSERT` (F-8's migration
note), so the CHECK is the insert's only refusal and is covered by an integration test.

**Is an anonymous entry a "no-organization scoping path"? No.** Principle XI forbids a path on which
the guard *resolves a null tenant for a valid transacting customer*. Here:

- every signed-in customer's entry carries their organisation (equivalence CHECK), so no transacting
  customer's record is ever ownerless;
- an anonymous submitter is not a customer and has no tenant context to resolve; the request runs in
  the platform's `system` mode (F-6) — the existing, explicit mode for anonymous traffic, not an
  absence of filter;
- no read path resolves "organisation = null": the `allowed-set` predicate `organization_id IN (…)`
  can never match NULL (fail-closed), and only `all`/`system` — unrestricted actors — see ownerless
  rows. That is precisely FR-046.

This is the reasoning `NewsletterSubscriber` rests on, applied with a stricter constraint.

**The scoped-admin answer.**

| Actor (mode) | Sees |
| --- | --- |
| Unrestricted admin (`all`) | every entry, anonymous included |
| Scoped admin (`allowed-set`) | entries whose `organization_id` is in their set; **no anonymous entry** |
| Customer (`single-org`) | no read surface exists (out of scope: "my submissions"); the guard would restrict to their own account |
| Worker / maintenance (`system`, via `enterSystemScope`) | everything, attributed in the escape-hatch audit |

An out-of-scope entry answers exactly like a missing one: `404 FORM_ENTRY_NOT_FOUND`, same body,
for detail, mark-read, status, note and delete; the list, the search and the CSV export omit it.

**Writes that cross tenants by construction.** Deleting a form *with entries* (FK cascade) and
changing a form's retention period both remove entries regardless of who owns them. A scoped admin
must not be able to do that through a form-level permission, so both require an **unrestricted
admin scope** (`getTenantContext().mode === 'all'`) in addition to their codes and are refused with
`403 FORM_SCOPE_REQUIRED` otherwise. The retention worker and the anonymisation reconciliation run
under `enterSystemScope` with a non-empty reason (the sanctioned hatch, F-16).

**A form-level counter instead of a widened count.** The maximum-entries rule needs the count of a
form's non-spam entries **across all tenants**, while a signed-in submitter's request is
`single-org`. Counting through `withSystemScope` would write an escape-hatch audit row on every such
submission. Instead `forms.accepted_entry_count` (a column on a `@GlobalEntity`) is maintained by the
same Commands that change it (submit +1; to/from spam ∓1; delete, retention and erasure −n), with the
form row locked `for update` inside the submit transaction when a maximum is set; the maintenance pass
recomputes it under the system scope it already runs in (R-20).

**Cross-tenant tests required** (Principle XI, gate 10): scoped admin vs. two organisations and
anonymous rows for list, search, export, detail, mark-read, status, note, single and bulk delete —
out-of-scope indistinguishable from absent; the equivalence CHECK refuses both half-attributed
shapes; a body naming `customerAccountId`/`organizationId` is refused by `.strict()` and never
stamps; a signed-in submission stamps both; anonymous stamps neither; `FORM_SCOPE_REQUIRED` for a
scoped admin deleting a form with entries or changing retention; `check-entity-tenant-classification`
passes with the four classifications.

**Verdict: compliant.** FR-046 is **confirmed** as written, with two additions the review makes
binding: the attribution CHECK is an equivalence, and the two cross-tenant destructive writes
require an unrestricted scope.

---

## Decisions

### R-1 — A new module `forms`, owning forms, versions, entries and notes

**Decision.** New package `packages/modules/forms` (`@endora-commerce/mod-forms`, id `forms`, plural
snake case), copying `tasks`' skeleton (manifest, `src/backend/index.ts` as the single composition
file, `src/migrations/`, `src/admin/`, `i18n/` and `docs/` at the package root, tests beside their
subjects). Operator-toggleable and deactivatable (`forms.enabled`, default `true`).

**Rationale.** Domain ownership: forms, versions and entries form one aggregate family with their own
lifecycle, permissions, retention and integrations. FR-002 forbids depending on `cms`, so the module
cannot live in `cms`.

**Rejected.** Growing `cms` (FR-002; `cms` is switchable and would take entries with it); growing
`newsletter` (a different domain; it depends on `cms`); converting `cms.ContactForm` (owner: out of
scope).

### R-2 — Dependencies: only non-deactivatable owners bind; `cms` and `webhooks` do not

**Decision.** Manifest `dependencies`: `_i18n`, `audit_logs`, `auth`, `customer_accounts`,
`dictionaries`, `email`, `sales_channels`, `settings` — all non-deactivatable (verified for each in
T001), so the edges cost an operator no switch. `nonBindingDependencies`:

- `cms` / `cmsPageReadPort` — `degrades-without`; `whenAbsent`: *"A confirmation that leads to a CMS
  page shows the confirmation message instead."* Presence asked in front of the gate.
- `webhooks` / `webhookEventRegistry` — `contributes-to` (crm's wording, F-11).

**Rationale.** US10-6 (forms work with CMS off) and FR-002. Nothing depends on `forms`.

**Rejected.** `cms` in `dependencies` — FR-002, and it would make `cms`' switch refuse while `forms`
is on.

### R-3 — Versioning storage: immutable version rows, each a full JSON snapshot

**Decision.** `form_versions` holds one row per publish (`form_id`, `number` 1…n, `definition` jsonb
validated by `formDefinitionSchema`, `published_at`, `published_by_admin_user_id`). Rows are never
updated; the form row points at the latest (`published_version_id`) and carries the editable
working copy (`forms.definition`). Every entry references its version (`form_version_id`).

**Rationale.** FR-009/FR-010 need an entry to render with its own version's labels and options;
an immutable row makes that a join, and the definition is already one validated document shared by
admin, storefront and server (FR-007), so storing it as that document avoids a second schema.

**Rejected.** A JSON array of snapshots on `forms` (unbounded row growth, rewritten on every publish,
no FK from entries); normalised per-version field/option tables (≈15 field shapes × versions, a
migration per new field type, and the contract would still be the JSON shape); copying labels into
every entry (duplication; FR-055 wants answers in one place, not labels in thousands).

### R-4 — What a version freezes and what stays live

**Decision.** The **snapshot** (versioned) is everything a shopper sees or that decides acceptance:
sections, fields, logic, every text in every language (messages, confirmation e-mail texts
included), confirmation behaviour, CAPTCHA requirement, restrictions (maximum entries, availability
window, signed-in only), the submitter e-mail designation and the "Share with integrations" flags.
**Live** (form row, effective on save): `name`, `key`, `status` (close/reopen), recipients and
per-channel recipients, retention period, default language.

**Rationale.** FR-009 "editing a published form MUST NOT change what shoppers see until the next
publish" — restrictions and messages are shopper-visible, so they are frozen; recipients and
retention are not shopper-visible and must act immediately (A-2, US9); status is the explicit
close/reopen switch (FR-008). FR-064 requires the share flag "recorded in the form version".

**Rejected.** Freezing recipients (a recipient change would need a republish to stop mail going to a
departed colleague); keeping restrictions live (breaks FR-009 literally).

### R-5 — The shared contract and the logic evaluator live in `@endora-commerce/contracts`

**Decision.** `packages/contracts/src/forms.ts` (Zod: definition, settings, admin and public API
shapes, events, limits, error codes) and `packages/contracts/src/forms-logic.ts` (pure, browser-safe:
`visibleElements(definition, answers)`, `validateSubmission(definition, input, ctx)`,
`definitionIssues(definition)` incl. cycle detection, `resolveTexts(definition, language)`,
`textCompleteness(definition, languages)`), both exported from `src/index.ts`, tests beside them.

**Rationale.** Three consumers must evaluate identically (FR-032): the backend (`mod-forms`), the
storefront renderer (`cms-components`, client) and the admin preview. All three already depend on
`contracts`; the contracts package already hosts pure rule functions
(`product-value-resolver.ts`, `text-normalization.ts`, `assertBlockRules` in `modules.ts`). One
implementation is the only way "identically" is a fact rather than a hope; one test suite drives it.

**Rejected.** A `mod-forms` subpath (`cms-components` would import a module package — refused by
`check:block-renderers`' import rule in spirit and a dependency from the generic renderer onto a
switchable module); the platform (`check:platform-surface`: modules may use five barrels, the
storefront may use none, and domain logic does not belong in the host); a new workspace package
`@endora-commerce/forms-logic` (a package, a release line and a build step for ~600 lines that
`contracts` already has the shape for — Principle IV).

### R-6 — Conditional logic: semantics and evaluation

**Decision.**

- A rule is `{ connective: 'and' | 'or', groups: Condition[][] }`: conditions **inside** a group are
  joined by `connective`, groups by the opposite one (FR-030: `and` inside ⇒ `(A∧B) ∨ C`). An empty
  rule is "always visible".
- `Condition = { fieldId, operator, value? }`, operators `equals`, `not_equals`, `greater_than`,
  `less_than`, `contains`, `not_contains`, `is_empty`, `is_not_empty`, each allowed per referenced
  type by one table in `forms-logic.ts` (numbers and dates compare; choice fields compare option
  values; `contains` on text and checkbox groups; empty tests everywhere).
- Visibility is computed in **topological order** of the dependency graph: a field is visible iff its
  section is visible and its own rule holds; a hidden field's value counts as **empty** for every
  condition (FR-032, US3-6). Hidden values are **dropped** before validation and never stored.
- `definitionIssues` refuses, with element ids: duplicate/missing/ill-formed keys, choice field
  without options, duplicate option values, condition referencing a missing field or a layout
  element, operator not allowed for the type, a **cycle** (DFS over field→field and section→field
  edges, a field inside a section depending on a field of the same chain counts), >1 submitter
  e-mail field, min > max, invalid redirect URL (absolute `http(s)`), invalid CMS page reference
  shape, limits of R-27, privacy/terms not required, marketing consent required or pre-ticked.

**Rationale.** One deterministic algorithm used by preview, storefront and server (R-5); a DAG makes
"identical" independent of field order.

**Rejected.** Regex/free patterns (A-8); "hide" rules in addition to "show" (doubles the matrix for no
spec requirement); iterative fixpoint without cycle refusal (non-terminating on cycles, FR-033).

### R-7 — Translation model: one structure, per-language text maps with default-language fallback

**Decision.** The definition carries `texts: Record<language, Record<textId, string>>` with stable
text ids derived from element ids (`form.title`, `fields.<fieldId>.label`, `fields.<fieldId>.options.
<optionId>`, `sections.<sectionId>.title`, `messages.closed`, `email.confirmation.subject`, …; full
list in `data-model.md` §3.6). Resolution per language: own text if non-blank → the form's default
language → for messages and buttons, the built-in translated default (storefront catalogue / module
bundle) → empty. `textCompleteness` reports, per storefront language, the text ids that fall back
(FR-018 warning, US7-2). Rich texts (content, consents, confirmation message) use the Page Builder
rich-text format and render through `sanitizeRichHtml`.

**Rationale.** US7-1 demands that structure, logic and validation are shared by every language;
text ids keyed by element **id** (not field **key**) survive a key rename. The fallback is the one
the platform already uses (`translationAt` in `packages/contracts/src/scoped-translations.ts`; CMS
page translations inherit the default).

**Rejected.** CMS's per-language document trees (`cmsContentEnvelopeSchema.languages`) — they let
structure diverge per language, which US7-1 forbids; per-language columns (unbounded languages).

### R-8 — The `forms.Form` block: declared by `forms`, rendered by `cms-components`, data by block-data

**Decision.**

- **Declaration** in `packages/modules/forms/src/manifest.ts`: `blocks: [{ name: 'forms.Form',
  category: 'forms', contexts: ['cms'], translatable: [] }]` and `blockCategories: [{ key: 'forms',
  … }]` (merged by key with `cms`' and `newsletter`'s). `translatable: []` because the block holds no
  prose (FR-003).
- **Props**: `formId` (uuid) plus presets `fieldLook` (`boxed`|`underline`|`pill`), `size`
  (`s`|`m`|`l`), `buttonLook` (the existing `BUTTON_SPEC_OBJECT_FIELDS` look), `align`
  (`start`|`center`), `showTitle`, `showDescription`. The colour scheme is the page's (FR-005).
- **Storefront renderer** `packages/cms-components/src/components/forms/` (`FormBlock.tsx`,
  `FormField.tsx`, `form-block-state.ts`), registered in `defaultPageBuilderConfig`
  (`packages/cms-components/src/index.ts`) like `newsletter.Signup`.
- **Server data**: a new block-data kind `{ kind: 'form', formId }` owned by `forms`
  (`blockDataOwnerOf`), resolved by the storefront through `storefront/lib/api/forms.ts`
  (`GET /api/v1/storefront/forms/:formId`) and in the editor through the admin preview read.
- **Editor**: the picker (`createFormPickerField`, `packages/page-builder-admin/src/chrome/
  FormPickers.tsx`) on the `BlogCategoryPicker`/`NewsletterPickers` pattern, swapped in by
  `packages/modules/cms/src/admin/components/FormBlockFields.tsx` (as `NewsletterSignupFields.tsx`
  does); "Create a new form" opens `/forms/new` in a new tab and the list refetches on focus.

**Rationale.** FR-037 and Principle VII need the form in the server HTML, which today only the
block-data seam provides (F-2); F-3 rules out a module-shipped renderer getting server data. Two
modules already follow exactly this split (F-1).

**Rejected.** Feature 141's `./storefront` layer in `mod-forms` (no SSR data seam: the form would be
fetched in an effect and absent without JavaScript); the definition in block props (FR-003); a
forms-owned editor contribution (ignored for a bundled block, F-3 — changing `namesToLoad` is a
platform change this feature does not need).

### R-9 — Storefront submit path: `POST /forms/submit`

**Decision.** New handler `storefront/app/forms/submit/route.ts`. The block posts to
`localizePath('/forms/submit')` with hidden `formId`, `blockId`, `returnTo`, `anchor`, the hidden
page-context values (R-11) and the honeypot. `forms` stays one reserved segment (the comment in
`reserved-segments.ts` gains the second handler). While `forms` is absent the handler answers `404`;
`/forms/contact` keeps checking `cms` only.

**Rationale.** A static sibling of `contact` can never collide with it; the form id is a body field
anyway (it is in the posted form). Same 303/JSON contract as F-4, so one mental model.

**Rejected.** `app/forms/[formId]/route.ts` (works — Next prefers the static `contact` — but makes
`/forms/contact` and a form id share a namespace forever); a server action (no 303 contract for a
headless client, FR-039); `/api/forms/…` (`api` is language-neutral, and the 303 must keep the page's
language prefix, F-4).

### R-10 — No-JS outcome and re-displaying the shopper's answers

**Decision.** The handler answers `303` to the same path with `?formsBlock=<blockId>&formsOutcome=
accepted|error&formsAttempt=<random id>#<anchor>`. On a validation error it also sets one cookie
`forms_attempt` — `HttpOnly; SameSite=Lax; Secure` (when HTTPS); `Path=<returnTo path>`;
`Max-Age=300` — holding `{ attemptId, blockId, errors, answers }` as base64url JSON within a
3 800-byte budget: answers are kept in field order until the budget is reached, the rest dropped
with `truncated: true`, which the block reports ("some answers must be entered again"). The page
render reads the cookie **only when `formsAttempt` matches its `attemptId`**, so a reload of the
clean URL shows nothing. With JavaScript the block posts with `Accept: application/json`, keeps its
own state and shows the outcome inline; no cookie is set.

**Rationale.** FR-037 requires answers and errors after a no-JS refusal; the data is the shopper's
own, stays in their browser, is unreadable by script and expires in minutes.

**Rejected.** Answers in the query string (personal data in URLs, history, logs; length limits); a
server-side stash in Redis keyed by a token (a copy of personal data outside the entry, FR-055);
encrypting the cookie (the storefront has no secret to encrypt with — `storefront/lib/env.mjs`
declares none — and adding one is an environment input for data the user already owns).

### R-11 — Public backend API and the page context of hidden fields

**Decision.** `GET /api/v1/storefront/forms/:formId?language=` always answers `200` with
`availability: 'open' | 'closed' | 'not_yet_open' | 'full' | 'unavailable'` (draft, deleted and
never-existing ids are all `unavailable`, with no definition); `POST /api/v1/storefront/forms/
:formId/entries` accepts. Hidden-field page context (`page_url`, `page_title`, `query_param`,
`referrer`) is computed **by the storefront on the server** at render (path + query from the render
location, title from the page data, referrer from the request's `Referer`) and posted as hidden
inputs; the backend treats every value as untrusted plain text capped at 1 000 characters.

**Rationale.** FR-039 headless parity (same contract as the reference storefront); `200` for every
state lets the storefront's 60 s Data Cache heal by itself (F-15: a cached `200` is never replaced by
a `404`) and leaks no existence. Without JavaScript the page context can only come from the server.

**Rejected.** `404` for drafts/deleted forms (stale `200` survives in the Data Cache); computing
hidden values only client-side (no-JS loses them).

### R-12 — The submission pipeline and its order

**Decision.** Backend, in this order (each step a unit-tested function in
`packages/modules/forms/src/backend/services/submission/`):

1. route `bodyLimit` 256 KiB → `413 FORM_SUBMISSION_TOO_LARGE`; rate limit (R-15) → `429`;
2. resolve channel (`getResolvedChannel`, fail closed per FR-035) and language (`?language` /
   `Accept-Language`, constrained to the channel's languages, else its default);
3. load the form + published version; availability (status, window, signed-in-only against
   `request.actor`, maximum) → `409 FORM_NOT_ACCEPTING` with token;
4. honeypot filled → answer the accepted body, store/send/publish nothing (FR-040);
5. `validateSubmission` (contract) → `400 FORM_SUBMISSION_INVALID` with
   `details.fields[] = { fieldKey, code, message }` (message in the submission language; operator
   override text when set);
6. CAPTCHA (R-14) **after** validation, so a refused form never burns a single-use token;
7. attribution (Principle XI review);
8. one Command `forms.entry.submit` (lock form row when a maximum is set, re-check the maximum,
   insert entry, `accepted_entry_count + 1`, audit **without answers**, event
   `forms.entry.submitted.v1` dispatched once on commit);
9. answer `201 { status: 'accepted', confirmation }`.

**Rationale.** Cheap refusals first; the only external call last before the write; the Command makes
write, audit and event one unit (Principle XIII).

**Rejected.** CAPTCHA before validation (a shopper who mistyped an e-mail must solve again);
recording honeypot hits as spam entries (A-4).

### R-13 — Notifications: the platform mailer, a module queue, built-in translated texts

**Decision.** Shop notification and confirmation go through `emailMailer` (`EmailMailerPort`):
`replyTo` = submitter e-mail answer (when visible and present), `kind` `forms.entry_notification` /
`forms.entry_confirmation`, `salesChannelId` the entry's, **no `meta`**, fixed subject
(`mail.notification.subject` with the form name) for the shop, the operator's subject for the
confirmation. Built-in wording is the module bundle's (`mail.*` keys, en + pl) through
`adminI18nService.translate('forms', key, language)`; operator wording comes from the entry's
version. They are sent by a **queue**: the `forms.entry.submitted.v1` subscriber enqueues
`{ entryId, shopLanguage }` on `forms-notifications`; the worker loads the entry, skips it if gone or
`spam`, sends one message per recipient (`messageId` `forms-<entryId>-shop-<key>`, the key a short SHA-256 of entry id and lower-cased address — T141) and at most one
confirmation (`forms-<entryId>-confirmation`, `confirmation_sent_at` stamped), retrying with
backoff. A send failure never reaches the shopper (FR-059) and is in `email`'s delivery records.
**Co-location (Principle X):** the worker runs in the existing worker process like every module
consumer; volume is one job per accepted entry, low enough to co-locate, and it stays a separable
`ctx.worker` entrypoint.

**Rationale.** A-15 allows the direct mailer; per-form operator texts and per-form recipients do not
fit a one-template-per-code system, and Reply-To is not on `TransactionalEmailSendInput` (F-13).
A queue makes up to eleven sends retryable and idempotent without holding the shopper's request, and
carries only an id — answers never enter Redis (FR-055).

**Rejected.** `transactional_emails` templates (one platform-wide template for every form; no
Reply-To; operator texts per form would become free-form variables); in-request sends (169 chose it
for a store-nothing form; here a stored entry makes retry the better contract, and eleven SMTP calls
in a request are seconds of latency).

### R-14 — CAPTCHA: one provider per deployment, server-side verification, fail closed

**Decision.** Settings `forms.captcha_provider` (`none` | `turnstile` | `hcaptcha`, default `none`),
`forms.captcha_site_key` (string), `forms.captcha_secret_key` (`secret`). Verification is a
server-side `fetch` (Node's global, `AbortSignal.timeout(5000)`) to
`https://challenges.cloudflare.com/turnstile/v0/siteverify` or `https://api.hcaptcha.com/siteverify`
with `secret`, `response` and `remoteip`; `success !== true` → `400 FORM_CAPTCHA_FAILED`;
network error, timeout or non-2xx → `503 FORM_CAPTCHA_UNAVAILABLE` (retryable; A-5 fail closed).
The public definition carries `captcha: { provider, siteKey }` only when the version requires it
**and** a provider is configured; the block loads the provider's script in an effect only then
(FR-042). A required-but-unconfigured CAPTCHA is a builder warning (US6-4) and is not enforced.

**Rationale.** A-5: no new runtime dependency — `fetch` is Node ≥ 22; the GA Measurement Protocol
client is the precedent for a server-side provider call.

**Rejected.** A provider SDK (dependency for one POST); a `credential_ref` (`credentials` module) —
FR-062 names Settings with a `secret`; fail-open on outage (A-5).

### R-15 — Honeypot, rate limit, size

**Decision.** Honeypot input named `hp_extra` (`autocomplete="off"`, `tabindex="-1"`,
`aria-hidden`, visually hidden) — not `website`, which browser autofill targets. Rate limit
`{ max: 10, timeWindow: '10 minutes', keyGenerator: (r) => \`forms-submit:${r.ip}\` }` on the submit
route, the storefront forwarding the shopper's `x-forwarded-for` (169's contract, F-22). Size: route
`bodyLimit` 262 144 bytes; the storefront handler refuses a `content-length` above the same before
parsing.

**Rationale.** FR-040/041/036, the 169 approach.

**Rejected.** Per-form keys (a bot rotates forms); a Redis global cap (YAGNI, as 169).

### R-16 — Statuses, notes, read-on-open and undo

**Decision.** Statuses `new` → `read` (on open) and any → any by an employee (FR-048). Opening the
detail calls `POST …/forms/entries/:id/mark-read` (gated `forms:entries_read`, Command
`forms.entry.mark_read`, a no-op without audit when not `new`); `GET` stays side-effect free so
integrators reading entries do not mark them. Status change `PATCH …/:id/status { status,
expectedStatus }` (Command `forms.entry.status_change`); the UI's *Undo* re-issues it with the
previous status and `expectedStatus` = the new one, refused `409 FORM_ENTRY_STATUS_CONFLICT` when the
entry moved meanwhile — all-or-nothing per record, audited (Principle XIII "safe undo"). Notes are
append-only (Command `forms.entry.note_add`). Deletion is irreversible (data minimisation) and offers
no undo.

**Rejected.** A `GET` with a write; the platform's bulk reversible-operation table (built for bulk
edits — YAGNI for a single field).

### R-17 — Anonymisation reaches entries: a new owner event plus a level-triggered reconciliation

**Decision.** (a) `customer_accounts` publishes `customer_account.anonymized.v1`
(`{ eventId, occurredAt, customerAccountId, organizationId }`, strict schema in
`packages/contracts/src/customer-accounts.ts`) from `anonymize` after its write and audit — the only
foreign-module change of substance (`contracts/foreign-module-changes.md` §1). (b) `forms` subscribes
with `ctx.subscribe` and deletes that account's entries and notes (Command `forms.entries.erase_for_
account`, `withSystemScope('forms: erase the entries of an anonymised customer account')`, counter
adjusted). (c) The maintenance pass (R-20) reconciles: the distinct `customer_account_id`s of
`form_entries` in pages of 500 → `customerAccountReadPort.findByIds` → delete the entries of every
account with `anonymizedAt != null` or that no longer resolves.

**Rationale.** FR-047 asks for the same lifecycle step (the subscriber runs inside the sweep's
dispatch) **and** for no attributed entry to outlive an anonymisation that happened while `forms`
was off (the subscriber is gated, so it misses those; the reconciliation is state-based and runs
when the module is next present). No module internals are imported: an event and a published read
port (Principle I).

**Rejected.** A participant registry the sweep awaits (couples `customers`' sweep to every
participant's failure; a gated participant still misses the off window, so the reconciliation would
be needed anyway); reconciliation only (not "the same lifecycle step"); matching entries by e-mail
(FR-047 forbids it).

**[NEEDS CLARIFICATION → OQ-1]** "Deleted or anonymised": the platform never hard-deletes an account;
*deleted* is a reversible soft-delete within the retention window, after which the sweep anonymises.
Default taken: entries are erased at **anonymisation** (the irreversible step), so restoring a
soft-deleted account within its window restores its entries too.

### R-18 — Entries list, search and CSV export: in-module, streamed, neutralised

**Decision.**

- **List**: `GET /api/v1/admin/forms/entries` with `formId`, `status[]`, `submittedFrom`/`To`,
  `salesChannelId`, `q`, keyset cursor on `(submitted_at desc, id desc)`, page size ≤ 100.
- **Search** (A-10): substring, case-insensitive, over `submitter_email` and `search_text` — a
  column the submit Command fills with the lower-cased text answers (single-line, multi-line,
  e-mail, phone, hidden excluded) capped at 20 000 characters — `ILIKE '%q%'` backed by GIN
  `gin_trgm_ops` indexes (`pg_trgm` created `if not exists`, F-21).
- **Export**: `GET /api/v1/admin/forms/entries/export` (same filters, `forms:entries_export`) streams
  CSV: UTF-8 BOM, metadata columns `entry_id, form_key, form_version, status, sales_channel, language,
  submitted_at, page_url`, then one column per field key across **all versions of the filtered
  form** (address expanded to `<key>.street|line2|postal_code|city|country`, checkbox groups joined
  by `; `, consents `yes|no`); reads in keyset batches of 500 so memory is flat; every cell starting
  with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` (formula neutralisation). Export requires
  `formId` (columns are per form). One Command `forms.entries.export` audits the filter and the row
  count, never values.

**Rationale.** FR-050/052; F-14 shows `import_export` cannot filter and would make
`import_export` read `forms` through a port it would have to depend on; streaming keeps large
exports off the event loop's memory and the admin waits only for its download.

**Rejected.** An `import_export` adapter (no filters, sync whole-table, a new edge from a switchable
module); a background export job with a stored file (a stored copy of answers, FR-055; YAGNI until
volumes demand it — revisit if one form exceeds ~100 000 entries).

### R-19 — Admin surfaces composed from admin-kit

**Decision.** Routes `/forms` (list, landing), `/forms/new`, `/forms/:id` (builder: *Fields*,
*Settings*, *Notifications*, *Versions*, live preview pane, and a content-language switch in its
header — 2026-11-03 owner review: it replaced a *Translations* tab), `/forms/entries` (entries list,
sidebar), `/forms/entries/:id`. Reused: `useGroupedReorder` (fields in sections, sections among
themselves, keyboard + pointer + touch, announced — FR-015/FR-069), `ContentLanguageTabs`
(the builder's content-language switch), `CmsPagePicker` (confirmation page; hidden with a note when `cms` is
absent), `CountrySelect`/`useCountriesQuery` (country subset), `Select`/`Input`/`Button`/
`MultiSelect`, `ResponsiveTable`, `PaginationFooter`, `RowActionMenu`, `ModalDialog`,
`StickyFormActions`. The palette→canvas insertion is a drop target per section driven by the same
native drag events plus an "Add field" menu per section for the keyboard. The **preview** renders
`cms-components`' `FormBlock` in preview mode with the working copy, so it is the storefront's
renderer (FR-017). One net-new component, the **condition editor** (`ConditionRuleEditor.tsx`):
admin-kit's `RuleBuilder` is typed to `PromotionRule` and lacks `contains`/`is empty`/per-type
operator tables; widening it is a change to three live promotion screens (Principle IX
justification; the designer may promote it later).

**Rejected.** `@dnd-kit/core` in the module (works, but `useGroupedReorder` already provides the
accessible behaviour with no dependency, A-18); a forms-owned renderer for the preview (two renderers
would drift, FR-017).

### R-20 — One maintenance clock: retention, erasure reconciliation, counter repair

**Decision.** Queue `forms-maintenance` with one Job Scheduler (`every: 15 min`, no data), consumed
through `ctx.worker`, built only where `processRunsWorkers` and `moduleQueueRedis` exist (F-16). Each
tick: presence first (`effectiveState.isPresent('forms')`, outside any `try`), then three passes each
`hasWork` probe → `enterSystemScope(reason, run)`: **retention** (per form with `retention_days`,
delete entries `submitted_at < now − days` in batches of 500, notes by FK cascade, counter −n,
one Command per batch `forms.entries.retention_delete` auditing form id, cutoff and count),
**erasure reconciliation** (R-17 c), **counter repair** (recompute `accepted_entry_count` per form).
A refused tick while off is left waiting by the platform's work gate; the job resumes on reactivation
(US9-3).

**Rationale.** Principle X: durable queue, atomic claim (BullMQ), idempotent passes (deleting what is
due is idempotent), separable entrypoint; low volume ⇒ co-located (one sentence, as required).

**Rejected.** A `setInterval` sweeper (Principle X prohibits it); one scheduler per form (unbounded
schedulers for no benefit).

### R-21 — FR-063: no backend cache; storefront Data Cache by tag; every state a `200`

**Decision.** The backend public read is a primary-key read of the form and its published version,
**uncached** — every API instance reads Postgres, so there is nothing per instance to invalidate. The
storefront fetch is `next: { revalidate: 60, tags: [FORMS_STOREFRONT_CACHE_TAGS.form(id)] }` (new
entry in `packages/contracts/src/storefront-cache-tags.ts`). Every command that changes what the
public read answers (publish, close, reopen, delete) emits the internal `forms.form.changed`
(`{ formId }`) on commit; a `ctx.subscribe` handler posts the tag through a module-owned
`StorefrontRevalidator` (cms' wiring, F-15). Because every state answers `200` (R-11), the 60 s
revalidation alone also bounds staleness when the revalidation call fails or a storefront runs more
than one instance — SC-006 holds either way.

**Rationale.** FR-063 "across every running instance": backend instances share Postgres; storefront
instances are bounded by the TTL and accelerated by the tag.

**Rejected.** A Redis read-through cache (an invalidation surface for a PK read); an in-process LRU
with a pub/sub channel (`CustomFieldDefinitionsCache` pattern) — justified for hot validation paths,
not for one read per page render. **If** a later change adds an in-process cache, it must register an
`InProcessCacheLayer` or a `b2b:forms:*` pub/sub channel with a TTL fallback, per F-15.

### R-22 — Webhook and domain event `forms.entry.submitted.v1`

**Decision.** Event name `forms.entry.submitted.v1`, strict schema `FormEntrySubmittedEventV1Schema`:
`eventId`, `occurredAt`, `eventType` (literal), `entryId`, `formId`, `formKey`, `formVersion`
(number), `salesChannelId`, `organizationId` (uuid | null), `language`, `pageUrl` (string | null),
`submittedAt`, `answers` (record keyed by field key, **only** visible fields whose version marks
`shareWithIntegrations`; `{}` when none). Never notes, recipients or consent texts (consent
**fields** may be shared as booleans if marked). Emitted by the submit Command on commit; contributed
to `webhookEventRegistry` from a contribution-only boot hook (`FORMS_WEBHOOK_EVENT_TYPES`). A
subscription bound to an organisation receives only that organisation's entries (F-11 filter);
anonymous entries reach platform-wide subscriptions only. **Disclosed consequence**: shared answers
also persist in `webhook_deliveries.payload` under the webhooks module's own retention — the
documentation and the builder's flag tooltip say so (SC-007 "beyond what FR-064 permits").

**Rationale.** FR-064/065; every offered type carries `.v1` and a strict schema (F-11), and the
bridge sends the payload whole, so the event **is** the webhook payload.

**[NEEDS CLARIFICATION → OQ-3]** The spec writes `forms.entry.submitted`; the plan uses the platform's
versioned spelling `forms.entry.submitted.v1`.

### R-23 — Settings and activation

**Decision.** Settings group `forms`: `forms.enabled` (boolean, default `true`, activation control),
`forms.captcha_provider`, `forms.captcha_site_key`, `forms.captcha_secret_key` (`secret`) — all
platform-wide (channel `null`), edited on the generic Settings screen. No palette action for them;
the builder's CAPTCHA warning links to `/settings`.

**Rejected.** Recipients as Settings (A-2: per form); a dedicated forms settings screen (the generic
one edits these four, Principle IX).

### R-24 — Strings: who translates what

**Decision.** (Per `specs/conventions/module-i18n.md`.)

| String | Reader's language known? | Where |
| --- | --- | --- |
| Admin labels, palette, permissions, errors | admin request | `packages/modules/forms/i18n/{en,pl}.json` (flat) |
| Refusal sentences and per-field messages from the API | request language | module bundle via the error envelope / `adminI18nService`; codes on the wire too |
| Storefront built-ins (button default, outcomes, closed/not-yet-open/sign-in defaults, CAPTCHA/no-JS notice, client-side messages) | page language | `storefront/lib/i18n/messages/forms.ts` (both locales via `defineMessages`), passed to the renderer as `formsText` in the CMS render context (the `contactFormText` precedent) |
| Operator texts | per language in the definition | R-7 |
| Shop notification / confirmation wording | channel default / submission language | module bundle `mail.*` |
| Webhook payload | no reader | codes and data only |
| Country names | page language | storefront `DictionaryProvider` → render context `formCountries` |

### R-25 — Error codes

`FORM_NOT_FOUND` 404 · `FORM_KEY_TAKEN` 409 · `FORM_DEFINITION_INVALID` 400 (`details.issues[]`,
tokens = issue codes) · `FORM_REVISION_CONFLICT` 409 · `FORM_HAS_ENTRIES` 409 · `FORM_SCOPE_REQUIRED`
403 · `FORM_NOT_ACCEPTING` 409 (tokens `closed`, `not_yet_open`, `full`, `sign_in_required`,
`unavailable`) · `FORM_SUBMISSION_INVALID` 400 (`details.fields[]`) · `FORM_SUBMISSION_TOO_LARGE` 413
· `FORM_CAPTCHA_FAILED` 400 · `FORM_CAPTCHA_UNAVAILABLE` 503 · `FORM_ENTRY_NOT_FOUND` 404 ·
`FORM_ENTRY_STATUS_CONFLICT` 409. Each declared in the manifest `errorCodes` and
`packages/contracts/src/errors.ts` in the change that adds its first raise site, with sentences under
`errors.<CODE>` in both bundles (`check:error-translations`).

### R-26 — Concurrency

**Decision.** `forms.revision` (int) increments on every save; every write names `expectedRevision`;
a mismatch is `409 FORM_REVISION_CONFLICT` ("changed by someone else"). Publishing names the revision
it publishes, so a version is always the copy the operator looked at.

### R-27 — Limits (A-13, adjusted)

Fields per form 100 · sections 30 · options per choice field 200 · conditions per rule 20 (groups 10)
· single-line answer and hidden value 1 000 chars · multi-line 10 000 · rich operator text 20 000 ·
key 64 (`^[a-z][a-z0-9_]{0,63}$`) · name 200 · recipients 10 per list, channel overrides ≤ 50 ·
note 5 000 · retention 1–3 650 days · bulk delete 200 ids · submission body 262 144 bytes · checkbox
group selections ≤ options. All in `FORMS_LIMITS` (`packages/contracts/src/forms.ts`).

### R-28 — Accessibility of the rendered form (FR-069)

`<form noValidate>` with server-shaped validation; every input has a `<label for>` (visually hidden
only for the `underline`/`pill` looks' placeholder-led variant, never absent); `aria-required`,
`aria-describedby` → help and error ids; an error summary (`role="alert"`, focusable, linked to the
fields) rendered on the server for the no-JS path and focused first on a JS refusal, then focus moves
to the first invalid field; errors carry an icon and text (never colour alone); radio and checkbox
groups in `<fieldset><legend>`; date/time native inputs; the honeypot hidden from assistive tech.
Conditionally hidden elements render with the `hidden` attribute from the server-side evaluation of
default values, plus a `<noscript><style>` that reveals them for the no-JS path — so JS users see the
right initial state with no layout shift (CLS), and no-JS users see every field (the server applies
the rules). Axe runs over SSR output in `storefront/test/ssr/forms-block.test.tsx` (SC-004).

### R-29 — Off-state (Principle XVII)

Routes through `ctx.routes` (503 `MODULE_DISABLED`), workers through `ctx.worker`, subscribers through
`ctx.subscribe`; boot hooks split — a **contribution** hook (webhook types; no presence probe) and no
work hook. The block disappears through the presence-filtered descriptor and the storefront presence
set; the storefront handler answers `404`; `webhookEventRegistry.list()` omits the type while the
owner is absent; settings group hidden by `settings`. The off-state test covers both axes
(`deactivated`, `platform-unavailable`) and restoration (plan § *Off-state test plan*).

---

## Open questions for the owner

| # | Question | Default the plan takes | Blocks |
| --- | --- | --- | --- |
| **OQ-1** | FR-047 "deleted or anonymised": should a **soft-delete** (reversible within the retention window) already erase attributed entries? | No — erase at **anonymisation**; restore keeps entries. | nothing; T-tasks of US4 implement the default |
| **OQ-2** | A form that requires CAPTCHA cannot be submitted without JavaScript (both providers need script). Is a translated `<noscript>` notice an acceptable exception to FR-037 for such forms? | Yes — notice "This form needs JavaScript to verify you are not a robot"; forms without CAPTCHA work fully without JS. | nothing |
| **OQ-3** | Event type spelling: `forms.entry.submitted` (spec) or `forms.entry.submitted.v1` (every offered webhook type so far)? | `forms.entry.submitted.v1`. | nothing; a rename is one constant before release |
