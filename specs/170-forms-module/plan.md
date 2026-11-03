# Implementation Plan: Forms — a form builder whose forms are placed on pages as Page Builder blocks

**Branch**: `feat/170-forms-module` | **Date**: 2026-11-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/170-forms-module/spec.md` (owner-clarified 2026-11-02)

## Summary

A new operator-toggleable domain module **`forms`** (`packages/modules/forms`,
`@endora-commerce/mod-forms`) owns forms, immutable form versions, entries and entry notes. Operators
build forms on their own admin screens (drag-and-drop through admin-kit's `useGroupedReorder`,
conditional logic, per-language texts, live preview rendered by the storefront's own renderer) and
publish immutable versions. Editors place a published form with the Page Builder block **`forms.Form`**
— declared in `forms`' manifest, rendered by `@endora-commerce/cms-components` and fed server-side by
a new block-data kind, exactly as `newsletter.Signup` and `blog.LatestPosts` are. Shoppers submit
with or without JavaScript through `POST /forms/submit` on the storefront; the backend validates
against the published version with **one shared evaluator in `@endora-commerce/contracts`**, stores
an `@CustomerScoped` entry attributed from the session, and through one Command writes the entry, its
audit row and the domain event `forms.entry.submitted.v1` (also a webhook type). Notifications go
through the platform mailer from a module queue; retention and erasure reconciliation run on a
module Job Scheduler; anonymising a customer account erases that account's entries through a new
`customer_account.anonymized.v1` event plus a level-triggered reconciliation. No new runtime
dependency: CAPTCHA (Turnstile / hCaptcha) is verified with Node's `fetch`.

## Technical Context

**Language/Version**: TypeScript 5.x strict, Node.js ≥ 22.17, React 19
**Primary Dependencies**: existing only — Fastify (+ `@fastify/rate-limit`, already registered), MikroORM (PostgreSQL), Zod, BullMQ + ioredis, Puck (`@puckeditor/core`), Next.js 15, admin-kit primitives; no new runtime, dev or workspace dependency
**Storage**: PostgreSQL — four new tables owned by `forms` (`forms`, `form_versions`, `form_entries`, `form_entry_notes`), `pg_trgm` GIN indexes; four settings in the settings store; two BullMQ queues in Redis
**Testing**: Vitest — contracts unit, module co-located unit, backend contract + integration (real Postgres), cms-components and storefront SSR (+ axe), admin unit/interaction
**Target Platform**: backend (Fastify API + worker process), storefront (Next.js App Router, SSR), admin (Vite SPA)
**Project Type**: web monorepo (pnpm workspaces)
**Performance Goals**: no extra request on a page render beyond one cached definition read per Form block; submit p95 < 300 ms excluding CAPTCHA verification; export memory flat (keyset batches of 500)
**Constraints**: stored pages render byte-identically (SC-005); forms work without JavaScript except a CAPTCHA-protected form (OQ-2); a published change visible within 60 s (SC-006); no answers outside the entry (FR-055)
**Scale/Scope**: up to 100 fields per form; hundreds of forms; entries in the hundreds of thousands per deployment; 1 new module, 1 new block, 13 error codes, 5 permissions, 3 palette actions, 2 queues, 4 settings

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design. Verdict at the end.*

| Principle | How this design meets it |
| --- | --- |
| I. Modular architecture (NN) | `forms` owns its entities, services, routes, migration, i18n, docs and tests. Cross-module reach only through ports (`emailMailer`, `adminI18nService`, `customerAccountReadPort`, `dictionaryValidator`, `settingsReadPort`, `cmsPageReadPort`, `webhookEventRegistry`) via `lazyPort<T>(ctx, 'literal')` with contract types, and through EventBus events. `customer_accounts` gains an event, not a caller. The block's renderer sits in `cms-components` as the newsletter/blog precedent; `cms` admin reads `forms`' admin API over HTTP. Detachable: nothing depends on `forms`. |
| II. API-first | Every shape is a Zod schema in `packages/contracts/src/forms.ts` before any consumer; the public read/submit pair is the headless contract (FR-039). Additive changes only to `customer-accounts.ts`, `errors.ts`, `storefront-cache-tags.ts`. |
| III. TDD (NN) | `tasks.md` orders a RED test before every GREEN; every FR and acceptance scenario is traced to a test (SC-001). |
| IV. YAGNI & minimal dependencies | No new dependency (Complexity Tracking). No backend cache (R-21), no stored export file (R-18), no generic undo table (R-16), no hide-rules or free patterns (R-6, A-8). |
| V. TypeScript everywhere | Strict TS; every boundary (HTTP bodies, posted form data, queue payloads, CAPTCHA responses, cookies) parsed with Zod; types inferred. |
| VI. Naming (NN) | Module `forms` (plural snake), tables `forms`, `form_versions`, `form_entries`, `form_entry_notes`, FKs `form_id`/`entry_id`, routes `/api/v1/admin/forms/entries` (kebab), JSON camelCase, block `forms.Form`, queues `forms-notifications`/`forms-maintenance`. |
| VII. SEO & performance | The form is in the server HTML (block-data); no-JS submit with 303; hidden-by-condition state rendered on the server with no layout shift (R-28). |
| VIII. English working language (NN) | Comments and `/docs/` pages in English; Polish only in bundles, the storefront catalogue and the PL docs mirror. |
| IX. UI reuse | Builder composed from admin-kit (`useGroupedReorder`, `ContentLanguageTabs`, `CmsPagePicker`, `CountrySelect`, tables, dialogs); preview reuses the storefront renderer; one justified new component, `ConditionRuleEditor` (R-19). |
| X. Scalable queue consumers | Two BullMQ queues consumed through `ctx.worker`, atomic claims, idempotent handlers (message ids; deletes of what is due), producers only enqueue. Co-located in the existing worker process — low volume (one job per accepted entry; one tick per 15 min) and still separable entrypoints. |
| XI. Multi-tenant isolation (NN) | `FormEntry` `@CustomerScoped` with nullable account+organisation under an **equivalence** CHECK, server-stamped attribution, scoped admins see only their organisations' entries and no anonymous ones, out-of-scope ≡ absent, cross-tenant destructive writes need unrestricted scope, maintenance under `enterSystemScope`. Full review: `research.md` § *Principle XI review* — **compliant**. |
| XII. Sales-channel scoping (NN) | Every submission resolves its channel through the canonical resolver and fails closed (FR-035); recipients chosen by the entry's channel; the public read uses the request channel for languages and CMS page links; no `sales_channel_*` bridge is read. Cross-channel tests: per-channel recipients, unresolvable channel refused, a CMS page not served on the channel falls back. |
| XIII. Auditing via Command Bus (NN) | Every admin and domain write — including the public submit and the export — is a named Command (data-model §8); audit states never hold answers; the submit's event is dispatched once on commit. Undo of a status change is itself an audited Command with a conflict check. |
| XIV. Entity-agnostic extensibility | Not applicable: forms are their own field-definition system for their own entity; no core entity gains fields. Custom fields (feature 055) are not used for entries because answers are versioned per form, not per host entity (rejected in R-3's spirit). |
| XV. Untouched core & overlay | Generic: no client data in any file; a deployment customises through settings, forms and blocks; an overlay can contribute nothing here that it could not before. |
| XVI. Command palette | Three manifest actions with their gating codes; labels/keywords in both bundles. |
| XVII. Operator-toggleable (NN) | `activation: { settingCode: 'forms.enabled', default: true }`; routes/workers/subscribers through the seams; contribution boot hook only; block filtered by presence; storefront handler 404; webhook type absent; off-state test on both axes with restoration (R-29). |

**Cross-cutting checklist (architect brief)**: admin permission manifest — five codes with labels in
both bundles (contracts/admin-surfaces.md §1); command palette — three actions; pl + en — module
bundle, storefront catalogue namespace, cms block labels, docs PL mirror; Settings module — four
settings, the CAPTCHA secret as `secret`; Command Bus — every write (data-model §8); tenant scoping —
research § Principle XI review; Redis cache invalidation via lifecycle pub/sub — **no per-process
cache is introduced** (R-21): backend instances read Postgres, storefront entries are dropped by tag
and bounded by a 60 s TTL; a future in-process cache must register an `InProcessCacheLayer` or a
`b2b:forms:*` channel with TTL fallback.

**Verdict (pre-research)**: PASS. **Verdict (post-design)**: **PASS** — no violation; nothing in
Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/170-forms-module/
├── spec.md
├── plan.md                         # this file
├── research.md                     # facts F-1…F-23, Principle XI review, R-1…R-29, OQ-1…OQ-3
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── form-definition.md          # forms.ts + forms-logic.ts exports and behaviour
│   ├── admin-api.md
│   ├── public-api.md               # backend public API + storefront handler
│   ├── events-and-webhook.md
│   ├── blocks-and-storefront.md
│   ├── admin-surfaces.md
│   └── foreign-module-changes.md
├── checklists/requirements.md
└── tasks.md                        # /speckit.tasks
```

### Source Code (repository root)

```text
packages/modules/forms/                       # NEW module package (@endora-commerce/mod-forms)
├── package.json                              # first render by manifests:generate
├── README.md, LICENSE, CHANGELOG.md          # rendered by manifests:generate
├── tsconfig*.json, vitest.config.ts, tailwind.css   # copied from packages/modules/tasks
├── i18n/{en,pl}.json                         # flat bundles
├── docs/forms.md
└── src/
    ├── manifest.ts                           # settings, activation, deps, permissions, actions, errorCodes, blocks
    ├── migrations/{index.ts, <stamp>_forms_init.ts}
    ├── backend/
    │   ├── index.ts                          # the single composition file (sections per area)
    │   ├── manifest.test.ts
    │   ├── entities/{form,form-version,form-entry,form-entry-note}.entity.ts
    │   ├── routes/{routes.forms.ts, routes.entries.ts, routes.public.ts}
    │   ├── services/
    │   │   ├── form-service.ts, form-commands.ts, form-warnings.ts, form-public-read.ts
    │   │   ├── submission/{submission-service.ts, availability.ts, attribution.ts, captcha-verifier.ts, honeypot.ts}
    │   │   ├── entry-service.ts, entry-commands.ts, entry-export.ts
    │   │   ├── notification-composer.ts, notification-dispatch.ts
    │   │   ├── erasure-service.ts, retention-service.ts, counter-repair.ts
    │   │   └── forms-errors.ts
    │   └── workers/{forms-notifications-worker.ts, forms-maintenance-worker.ts}
    └── admin/
        ├── index.ts, api.ts
        ├── pages/{FormsListPage,FormCreatePage,FormBuilderPage,EntriesListPage,EntryDetailPage}.tsx
        └── components/{FieldPalette,BuilderCanvas,FieldInspector,ConditionRuleEditor,TranslatableText,
                        NotificationsPanel,FormSettingsPanel,FormPreview,EntryFilters,EntryAnswers,EntryNotes}.tsx
                        (2026-11-03 owner review: TranslationsPanel replaced by the in-builder
                        language switch and TranslatableText)

packages/contracts/src/forms.ts, forms-logic.ts, forms-logic.fixtures.ts (+ tests), index.ts, errors.ts,
                     storefront-cache-tags.ts, customer-accounts.ts
packages/cms-components/src/components/forms/*, index.ts, schema/component-types.ts,
                     utils/block-data.ts, hooks/use-block-data.ts, components/render-context.tsx, styles/
packages/page-builder-admin/src/chrome/FormPickers.tsx, index.ts
packages/modules/cms/src/admin/components/{FormBlockFields.tsx, PageBuilderEditor.tsx, AdminCatalogPreviewProvider.tsx}, i18n
packages/modules/customer_accounts/src/backend/{services/customer-account-lifecycle-ports.ts, index.ts}
storefront/app/forms/submit/route.ts, app/reserved-segments.ts (comment), lib/api/forms.ts,
           lib/page-builder/{forms-context.ts, block-data.ts}, components/CmsPageRenderer.tsx,
           lib/i18n/messages/forms.ts, lib/i18n/messages.ts
backend/test/contract/forms/*, backend/test/integration/forms/*, storefront/test/forms/*,
           storefront/test/ssr/forms-block.test.tsx
docs/i18n/pl/…/modules/forms.md, docs/translation-cache/pl/…  (+ generated module reference)
.changeset/170-*.md
```

**Structure decision**: one new module package plus additive changes to `contracts`,
`cms-components`, `page-builder-admin`, `cms` (admin only), `customer_accounts` (one event) and the
storefront, all listed in `contracts/foreign-module-changes.md`.

## Composition (`packages/modules/forms/src/backend/index.ts`)

Per `specs/conventions/module-composition.md`, one file, one section per area:

1. **Own services** — `ctx.di.register` (form, entry, submission, export, notification, erasure,
   retention services; `formsStorefrontRevalidator` built like cms' from `STOREFRONT_BASE_URL` /
   `REVALIDATE_SECRET`, already declared environment inputs).
2. **Foreign ports** — `lazyPort<EmailMailerPort>(ctx, 'emailMailer')`,
   `lazyPort<AdminI18nTranslatePort>(ctx, 'adminI18nService')`,
   `lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort')`,
   `lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator')`, `settingsReadPort`,
   `lazyPort<CmsPageReadPort>(ctx, 'cmsPageReadPort')` behind `effectiveState.isPresent('cms')`
   decided in front of the gate (no `catch` around it — `check:port-catches`).
3. **Routes** — `ctx.routes(app => { admin forms; admin entries; public })`.
4. **Subscribers** — `ctx.subscribe(FORMS_EVENTS.ENTRY_SUBMITTED, enqueueNotification)`,
   `ctx.subscribe(FORMS_EVENTS.FORM_CHANGED, revalidate)`,
   `ctx.subscribe(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT, eraseForAccount)`.
5. **Workers** — inside `ctx.routes` where `app.log` exists, `startFormsNotifications` and
   `startFormsMaintenance` with `attach: (w) => ctx.worker(w, { logger: app.log })`, built only when
   `processRunsWorkers && moduleQueueRedis` (tasks' shape).
6. **Contribution boot hook** — webhook event types (no presence probe). No work boot hook.
7. **Entities export** — the `entities` array on `./backend` (D-168 shape).

## Migrations

- One migration `forms_init` scaffolded by
  `pnpm --filter backend run migration:new -- --module forms --name init` (UTC stamp after
  `BASELINE_THROUGH`, class `Migration<STAMP>FormsInit`), creating the four tables, constraints,
  indexes and `create extension if not exists pg_trgm` (data-model §§1–5). The circular FK
  (`forms.published_version_id` → `form_versions`) is added after both tables.
- Register with `pnpm --filter backend run composer:generate`; commit
  `backend/src/db/migrations-registry.generated.ts` and `entities-registry.generated.ts`.
- No cross-module FK or DML, so `fk-dependency-drift` and `check:module-boundary` R1/R2 have nothing to
  report; order follows the manifest `dependencies`.
- `backend/test/integration/forms/migration.test.ts` applies up/down on a fresh database.

## Generated artefacts to regenerate (and commit in the same MR)

1. `pnpm --filter backend run manifests:generate` — first render of
   `packages/modules/forms/package.json` (+ `LICENSE`, `README.md`), then **`pnpm install`**,
   **build the package**, and run `manifests:generate` again (`module-migrations.md`: a package with
   no `dist` is refused on later runs); it also adds the dependency lines in `backend/package.json` and
   `admin/package.json`.
2. `pnpm install --lockfile-only` — commit `pnpm-lock.yaml` beside every `manifests:generate`.
3. `pnpm --filter backend run composer:generate` — manifest index, migrations and entities
   registries, `admin/src/modules.generated.ts`, `admin/src/tailwind.generated.css`, docs sidebar and
   module map, the module reference page; never merge these by hand (regenerate on conflict).
4. `pnpm --filter @endora-commerce/cms-components run build` — `dist/cms-components.css`.
5. `UPDATE_OPENAPI_BASELINE=1 pnpm --filter backend exec vitest run test/contract/kernel/openapi-baseline.test.ts`.
6. Check: `pnpm --filter backend run composer:check`, `manifests:check`, `overlay:check`.

## Off-state test plan (`specs/conventions/module-activation.md` item 6)

`backend/test/integration/forms/off-state.test.ts`, both axes (`deactivated`,
`platform-unavailable`) via `withModuleOff`, each followed by full restoration, `expectModuleAbsent`
(so `check:off-state-coverage` counts it):

- **API**: every `/api/v1/admin/forms*`, `/api/v1/admin/forms/entries*` and
  `/api/v1/storefront/forms*` route read off the OpenAPI baseline (tasks' `baselineProbes`) answers
  `503 MODULE_DISABLED`.
- **Admin**: no palette action (`servedActions`), no `forms` settings group editable, the
  descriptor (`GET` page-builder descriptor) does not list `forms.Form`, the webhooks event-type list
  omits `forms.entry.submitted.v1`.
- **Configuration not editable**: a write to `forms.captcha_provider` is refused while the activation
  control stays writable.
- **Business logic**: the maintenance tick does nothing (no delete, no escape-hatch audit row); a
  queued notification job is left waiting and drains on return; the anonymisation subscriber does not
  run, and the next tick after reactivation erases the entries (FR-047).
- **Storefront**: `storefront/test/forms/forms-submit-route.test.ts` (404 while absent) and
  `storefront/test/ssr/module-blocks.test.tsx` (a stored `forms.Form` renders nothing, the rest of the
  page unchanged).
- **Restoration**: forms, versions, entries, notes, settings and a page holding the block are
  byte-identical after re-enable (SC-008).
- **CMS off, forms on** (US10-6): forms and entries screens and APIs work; the confirmation page
  degrades to the message.

## Changesets (`specs/conventions/release-intent.md`)

One file per meaning, written for the consumer, `minor` at most (0.x series):

- `.changeset/170-forms-module.md` — `@endora-commerce/mod-forms`: minor (new module).
- `.changeset/170-contracts-forms.md` — `@endora-commerce/contracts`: minor (`forms.ts`,
  `forms-logic.ts`, `FORM_*` error codes, `FORMS_STOREFRONT_CACHE_TAGS`).
- `.changeset/170-customer-account-anonymized-event.md` — `@endora-commerce/contracts` minor and
  `@endora-commerce/mod-customer-accounts` minor (the event, emitted by `anonymize`).
- `.changeset/170-cms-components-form-block.md` — `@endora-commerce/cms-components`: minor
  (`forms.Form` renderer, `form` block-data kind, `forms` render-context entry).
- `.changeset/170-page-builder-admin-form-picker.md` — `@endora-commerce/page-builder-admin`: minor.
- `.changeset/170-cms-form-block-fields.md` — `@endora-commerce/mod-cms`: patch (editor fields and
  labels for `forms.Form`).

Package names are verified against each `package.json` at T003; `check:release-intent -- --since`
must pass.

## Test inventory (by layer)

| Layer | Location | Command |
| --- | --- | --- |
| Contracts unit | `packages/contracts/src/forms*.test.ts` | `pnpm --filter @endora-commerce/contracts run test` |
| Module unit | `packages/modules/forms/src/**/*.test.ts` | `pnpm --filter @endora-commerce/mod-forms run test` |
| Backend contract | `backend/test/contract/forms/*` | `pnpm --filter backend exec vitest run test/contract/forms` |
| Backend integration | `backend/test/integration/forms/*` (real Postgres) | `pnpm --filter backend exec vitest run test/integration/forms` |
| cms-components | `packages/cms-components/src/components/forms/*.test.tsx`, `utils/block-data.test.ts` | `pnpm --filter @endora-commerce/cms-components run test` |
| Storefront | `storefront/test/forms/*`, `storefront/test/ssr/forms-block.test.tsx` | `pnpm --filter storefront exec vitest run test/forms test/ssr/forms-block.test.tsx` |
| Admin | `packages/modules/forms/src/admin/**/*.test.tsx`, `admin/test/unit/palette-coverage.test.ts` | `pnpm --filter @endora-commerce/mod-forms run test`, `pnpm --filter admin exec vitest run test/unit/palette-coverage.test.ts` |

## Implementation phases (mirrors `tasks.md`)

1. Setup — package skeleton, manifest, contracts (schemas + evaluator), errors.
2. Foundational — entities, migration, generated artefacts, composition skeleton, tenancy tests.
3. US1 Build & publish (P1) · 4. US2 Place & submit (P1) · 5. US3 Validation & logic (P1) ·
6. US4 Entries (P1) · 7. US5 Notifications (P1) — **MVP = phases 1–7**.
8. US6 Spam & restrictions (P2) · 9. US7 Languages (P2) · 10. US10 Off-state (P2) ·
11. US8 Event & webhook (P3) · 12. US9 Retention (P3) · 13. US11 Docs (P3) · 14. Verification.

## Risks and how the plan contains them

| Risk | Containment |
| --- | --- |
| Client and server visibility drift | One evaluator in `contracts` + a shared fixture set run by three suites (form-definition.md B12). |
| A scoped admin destroys other tenants' entries through a form-level setting | `FORM_SCOPE_REQUIRED` on delete-with-entries and retention (Principle XI review). |
| Answers leak into Redis, logs or audit | Queue payloads carry ids; audit states carry no answers (data-model §8); a test greps the audit rows and the job data of a submission for a sentinel answer. |
| No-JS re-display overflows the cookie | 3 800-byte budget with `truncated` notice (R-10), tested at the boundary. |
| Generated-artefact conflicts with parallel branches | Regenerate, never hand-merge (`module-admin-surfaces.md` last section). |
| `cms-components` and the forms package release out of step | Lockstep versioning: one `fixed` group (release-intent.md). |

## Complexity Tracking

No Constitution violation and **no new runtime dependency**. CAPTCHA verification is a server-side
`fetch` (Node ≥ 22 global) to the provider's `siteverify` endpoint; drag-and-drop reuses admin-kit's
dependency-free `useGroupedReorder`; CSV is written in-module; `pg_trgm` is an existing Postgres
extension already used by three modules. Nothing to justify.
