# Implementation Plan: Company registry lookup at storefront registration

**Branch**: `feat/173-registration-registry-lookup` | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/173-registration-registry-lookup/spec.md` (owner
decisions OD-1 – OD-7 binding — OD-5, the operator's choice of Polish sources, added later on
2026-11-05; OD-6 (toggle ships off) and OD-7 (registration does not write the registry's legal
name) resolve the former open questions Q1 and Q2)

## Summary

A business registering on the storefront chooses its country, types its NIP / EU VAT number and
fetches its company data; the form is pre-filled from the public registry and stays editable. The
feature **extends `organizations`** (no new module, no new dependency):

- **Lookup** — `POST /api/v1/organizations/registry-lookup`, anonymous, contract-first. Polish NIPs
  go, by default (`gus_mf`), to **GUS BIR1.1 and the Ministerstwo Finansów White List in parallel**
  (GUS for name, REGON and the structured address; the White List for the VAT status and as the GUS
  fallback); an operator setting can restrict them to **GUS only** (`gus` — no White List quota
  spent, VAT status not checked, no fallback) or **White List only** (`mf` — no GUS key needed).
  Other EU VAT numbers always go to **VIES**. A new module-internal `CompanyRegistryClient` port carries a structured
  record; the published `VatValidator` contract is untouched except for one new provider value.
- **GUS client** — hand-built SOAP 1.2 envelopes over `fetch`, a ~60-line MTOM/escaped-XML
  extractor that refuses DTDs, one in-memory session per process with single-flight login and key
  fingerprinting.
- **Abuse protection** — checksum before any call, per-IP route rate limit, a Redis answer cache by
  normalised tax ID, a Redis per-registry budget per time window (the White List's daily, leaving
  room for the admin flow), strict timeouts, fixed upstreams, fail-closed on Redis errors.
- **Provenance** — every lookup mints a server-side **ticket** (Redis, 2 h) holding the answer the
  buyer was shown; registration carries only the ticket id, and persists the snapshot as an
  `OrganizationTaxIdValidation` row (`origin: 'registration'`, plus the submitted values) in the
  same transaction.
- **Moderation** — the admin history gains origin, VAT/activity status, REGON, attempts and a
  per-field **divergence** between the registry and the submission, computed on read; a pending
  Organization's moderation actions show how many fields differ.
- **Configuration** — three `organizations` settings (on/off; Polish sources `gus_mf` | `gus` |
  `mf`; GUS credential reference), a Settings-screen warning for `gus` without a GUS credential
  (the existing `settings.setting.after` zone), a new
  credential type `organizations_gus_bir` contributed to `credentials`' registry, declared as
  non-binding edges so `credentials` stays switchable; a palette action to the settings.
- **Storefront** — the registration form becomes a client component on `useActionState` with one
  server action: works without JavaScript (the page comes back pre-filled, no form data in the
  URL, never the password) and, with JavaScript, looks up in place with loading state and a polite
  live region. The toggle reaches the storefront through
  `GET /api/v1/organizations/registration-options`, Next-tag-cached and revalidated on
  `settings.value_changed`.

## Technical Context

**Language/Version**: TypeScript 5.x strict; Node.js ≥ 22.17 (backend), React 19 / Next.js 15
(storefront), React 19 / Vite (admin)
**Primary Dependencies**: existing only — Fastify (+ `@fastify/rate-limit` already registered by the
host), MikroORM, Zod, ioredis (structural types), global `fetch`; Next.js server actions
**Storage**: PostgreSQL — three additive columns on `organization_tax_id_validations`; Redis —
answer cache, tickets, budgets (TTL-only)
**Testing**: Vitest — harness-free unit tests beside their subjects in
`packages/modules/organizations/src/**` and `packages/contracts/src/**`; harness contract tests in
`backend/test/contract/organizations/`; storefront Vitest + the Playwright conformance suite
**Target Platform**: Linux server (API + storefront)
**Project Type**: web (backend module package, contracts package, admin, storefront)
**Performance Goals**: lookup p95 < 3 s on a cache miss with healthy registries, < 200 ms on a hit
(SC-001); registration latency unchanged (one Redis `GET` added)
**Constraints**: ≤ 8 s per lookup; zero registry calls for invalid / unsupported / disabled /
over-limit (SC-003); White List daily budget below its documented per-IP limit (verify in T001)
**Scale/Scope**: registrations are tens to hundreds a day per deployment; the budgets, not the
traffic, bound outbound calls

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design. Verdict at the end.*

| Principle | How this design meets it |
| --- | --- |
| **I. Modular architecture (NN)** | `organizations` owns the lookup, its clients, the Redis keys, the settings, the credential type, the migration, the routes, the admin changes, the i18n and the docs. It reaches `credentials` only through the published `configurationTypeRegistry` contribution seam and the `credentialsService` port (`lazyPort`, after `effectiveState.isPresent('credentials')`), both declared as `nonBindingDependencies` (admin-surfaces §3). No import of another module's internals, no cross-module FK or SQL. Detachable: switching the setting off removes the feature; removing the code leaves three nullable/defaulted columns. |
| **II. API-first** | Every HTTP shape is a Zod schema in `packages/contracts` before a consumer (`public-api.md`, `admin-surfaces.md` §6). Changes to existing contracts are additive: an optional top-level `registryLookupId`, one new `VatValidationProvider` member, a newly typed admin history item that keeps every existing field. `minor` changesets. |
| **III. TDD (NN)** | Every FR traces to a named test (*Test plan* below); `tasks.md` orders each RED before its GREEN. The GUS client is test-first against fixture bodies whose framing the spike captured (T001). |
| IV. YAGNI & minimal dependencies | **No new runtime dependency** (research R-5: `fast-xml-parser` is an application dependency of `backend` imported by no source, and adding it to the module package was rejected). No DB table for tickets, no CAPTCHA, no settings for limits, no full GUS report, no GUS in the admin flow, no lookup at registration time. |
| V. TypeScript everywhere | Strict TS; request bodies, ticket and cache JSON parsed with Zod; registry responses parsed with Zod (MF, VIES) or the typed extractor (GUS). |
| **VI. Naming (NN)** | Routes kebab (`/organizations/registry-lookup`, `/organizations/registration-options`); JSON camelCase; columns snake (`origin`, `registry_details`, `submitted_values`); setting codes dot-namespaced under `organizations.registration.*`; credential type `organizations_gus_bir`; Redis prefix `b2b:org-registry-lookup:v1:`; migration class `Migration<STAMP>Organizations…` from the scaffolder. |
| VII. SEO & performance | The registration page stays server-rendered (`robots: noindex` unchanged) and fully functional without JavaScript; the options read is Data-Cache-backed. |
| **VIII. English (NN)** | All artefacts, code, comments, English docs in English; Polish only in bundles, the storefront `pl-PL` block and the PL docs mirror. Registry text is passed through verbatim (third-party text). |
| IX. UI reuse | Admin: existing `Card`, `Table`, `Alert`, `Badge` from `@endora-commerce/admin-kit/ui`; storefront: existing `b2b-auth` form classes, `CountryPicker`, the design system's buttons, the `role="status"` live-region pattern used across `storefront/components`. No new primitive. |
| X. Queue consumers | Not applicable: the lookup is a bounded synchronous request (≤ 8 s) a person is waiting for; nothing is long-running or repeatable. The registration write stays inline. |
| **XI. Multi-tenant isolation (NN)** | The only tenant-owned write is the validation row, `@OrgScoped()`, written for the Organization being created, inside `withOrgScope(organization.id, '<reason>')` on the registration's own EM — the narrowest sanctioned hatch, attributable. The ticket and cache are not tenant data (public registry answers keyed by tax ID; no Organization exists yet) and never reveal whether a tax ID belongs to an Organization. Admin reads stay behind the existing gate and the tenant-scoped EM (an out-of-scope Organization's history is indistinguishable from absent — existing behaviour, re-asserted in T051). No "no-organization" path: a lookup creates nothing; registration still creates the Organization first. |
| **XII. Sales-channel scoping (NN)** | No channel-scoped content is read: registry data and the toggle are channel-independent by owner decision OD-2. Registration's existing channel binding (feature 154) is untouched. |
| **XIII. Command Bus auditing (NN)** | The lookup endpoint writes no domain record (Redis only). The validation row is written inside the existing registration unit, whose audit is the existing `organization.register` entry; its `stateAfter` gains `registryLookup: { provider, outcome }` — **no new hand-placed audit call**, and `check:command-coverage` (organizations is a migrated module) keeps seeing one audited write path. Settings and credential writes go through the `settings` and `credentials` Commands. See Complexity Tracking for why registration itself is not converted to a Command here. |
| XIV. Entity-agnostic extensibility | The requirement is not "add a field": the three columns record provenance of an existing history entity, not customer-defined data. |
| **XV. Untouched core & overlay** | Generic core feature, no deployment data. A deployment tunes limits by overlaying the module's limits file only if it ever must; registries, endpoints and the test key are public facts. |
| **XVI. Command palette** | New action `open-registration-registry-lookup-settings` → `/settings` under `settings:read` (admin-surfaces §5); no new admin route. |
| **XVII. Operator-toggleable modules (NN)** | `organizations` is `nonDeactivatable`; the on/off is a feature **setting** read per request (research R-16). `credentials` stays switchable: its absence degrades Polish lookups to the White List (declared `degrades-without`), and the credential-type push is an unprobed contribution the host filters by owner. Off-state tests: toggle off → endpoint 404 identical to unknown route, options `enabled: false`, registration ignores tickets, storefront plain form; `credentials` off → GUS skipped, White List answers under `gus_mf`, `unavailable` under `gus`; restoration in both. |

**Cross-cutting checklist** (architect brief):

- *Admin permission manifest* — no new code (admin-surfaces §1); inventory test still runs.
- *Command palette* — one action (XVI).
- *pl + en i18n* — storefront `auth` keys (storefront-ux §7), admin module-bundle keys
  (admin-surfaces §9), setting labels, palette keys.
- *Settings module for configuration, secrets via the `secret` value type* — configuration is two
  settings; the secret is **not** a `secret` setting but a `credentials` credential, by owner
  decision OD-1 (research R-12 records the rejected `secret` alternative).
- *Auditing through the Command Bus* — XIII.
- *Tenant scoping* — XI.
- *Redis cache invalidation via the lifecycle pub/sub pattern* — the answer cache and tickets are
  TTL-only by design (research R-8: no platform write changes a registry's answer, and every reader
  checks the toggle first). The one consumer-visible cache, the storefront's
  `organizations:registration-options` tag, is invalidated on `settings.value_changed` through
  `StorefrontRevalidator`, the established settings → storefront path. The GUS session is
  self-invalidating by key fingerprint.

**Gate (pre-research)**: PASS. **Gate (post-design)**: PASS — no violation; one transparency entry
in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/173-registration-registry-lookup/
├── spec.md
├── plan.md                  # this file
├── research.md              # R-1 … R-18
├── data-model.md
├── contracts/
│   ├── public-api.md        # registration-options, registry-lookup, register extension
│   ├── gus-bir11-client.md  # envelopes, extraction, outcomes, session
│   ├── admin-surfaces.md    # settings, credential type, palette, admin API, panels, i18n
│   └── storefront-ux.md     # form, states, a11y, i18n
└── tasks.md
```

### Source code (repository root)

```text
packages/contracts/src/
├── organization-registry-lookup.ts          # NEW — request/response/options/admin-record schemas, countries
├── organization-registry-lookup.test.ts     # NEW
├── organizations.ts                         # VatValidationProvider += 'gus_pl'; registryLookupId
└── index.ts                                 # export the new file

packages/modules/organizations/
├── src/manifest.ts                          # 3 settings, codes, nonBindingDependencies ×2, palette action
├── src/migrations/<STAMP>_organizations_registry_lookup_provenance.ts   # NEW (scaffolded)
├── src/backend/
│   ├── index.ts                             # wiring: clients, lookup service, store, routes, boot hook, subscriber
│   ├── routes.registry-lookup.ts            # NEW — options + lookup routes
│   ├── routes.public.ts                     # register passes registryLookupId through
│   ├── routes.admin.ts                      # vat-validations item: origin, details, submitted, divergence
│   ├── entities/organization-tax-id-validation.entity.ts   # 3 properties; provider type
│   ├── entities/organization.entity.ts      # VatValidationProvider += 'gus_pl'
│   ├── services/registration-service.ts     # persist the registration row; audit stateAfter
│   ├── integrations/
│   │   ├── gus-bir-soap.ts (+ .test.ts)     # NEW — envelopes + extractor
│   │   ├── gus-bir-client.ts (+ .test.ts)   # NEW — CompanyRegistryClient for GUS
│   │   ├── fixtures/gus/*.txt               # NEW — synthetic-data fixtures
│   │   ├── ministerstwo-finansow-client.ts (+ .test.ts)  # search() extracted; validate() over it
│   │   └── vies-client.ts (+ .test.ts)                   # check() extracted; validate() over it
│   └── registry-lookup/                     # NEW directory
│       ├── company-registry-port.ts         # internal types (research R-2)
│       ├── tax-id.ts (+ .test.ts)           # normalisation + NIP checksum
│       ├── address-parsers.ts (+ .test.ts)  # White List + VIES one-line addresses
│       ├── registry-adapters.ts (+ .test.ts)# MF + VIES CompanyRegistryClient adapters
│       ├── merge.ts (+ .test.ts)            # research R-3 table
│       ├── limits.ts                        # TTLs, budgets, timeouts
│       ├── registry-lookup-store.ts (+ .test.ts)   # Redis: answer cache, tickets, budgets
│       ├── registry-lookup-service.ts (+ .test.ts) # orchestration
│       ├── registry-divergence.ts (+ .test.ts)     # research R-14
│       ├── registration-snapshot.ts (+ .test.ts)   # ticket → validation row values, outcome mapping
│       └── gus-credential.type.ts           # descriptor
├── src/admin/panels/VatValidationPanel.tsx  # origin, details, registry-vs-submitted card
├── src/admin/panels/ModerationActionsPanel.tsx   # divergence notice
├── src/admin/zones/PlSourcesWarning.tsx     # NEW — `settings.setting.after` warning (+ pl-sources-warning.ts/.test.ts)
├── src/admin/index.ts                       # contribute the zone
├── src/admin/pages/OrganizationDetail.tsx   # pass divergence count
├── i18n/en.json, i18n/pl.json
└── docs/organizations.md

backend/test/
├── helpers/test-server.ts                   # fake registry clients + in-memory budget/ticket store wiring
├── contract/kernel/harness-parity.test.ts   # contribution parity for the new name
└── contract/organizations/
    ├── registration-options.contract.test.ts         # NEW
    ├── registry-lookup.contract.test.ts              # NEW
    ├── registry-lookup-off.contract.test.ts          # NEW (toggle off; credentials off)
    ├── registry-lookup-rate-limit.contract.test.ts   # NEW (limiter enabled)
    ├── register-registry-lookup.contract.test.ts     # NEW
    └── vat-validations-registration.contract.test.ts # NEW

storefront/
├── app/(auth)/register/page.tsx             # server shell
├── app/(auth)/register/actions.ts           # NEW — registerFormAction, lookupCompanyAction
├── components/auth/RegisterForm.tsx         # NEW — client form
├── lib/auth/register-form-state.ts          # NEW
├── lib/api/registry-lookup.ts               # NEW
├── lib/api/auth.ts                          # registryLookupId on the payload
├── lib/i18n/messages/auth.ts                # keys
└── test/auth/*, test/lib/registry-lookup-api.test.ts, test/conformance/*

docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/organizations.md   # PL mirror (+ cache entry)
```

**Structure Decision**: one existing module package (`organizations`), the contracts package, the
storefront app, the backend harness. No new package or module.

## Design decisions (one line each; reasoning in research.md)

- **R-1** extend `organizations`; new `registry-lookup/` directory.
- **R-2** internal `CompanyRegistryClient` port; MF/VIES clients expose one raw call shared with
  `validate()`; `VatValidator` unchanged.
- **R-3** Polish NIP per operator mode: `gus_mf` GUS ∥ White List (default), `gus` GUS only, `mf`
  White List only; a merge table per mode; excluded registries not called, not charged, recorded as
  skipped; VIES never used for Polish VAT status.
- **R-4** BIR1.1 `Zaloguj` + `DaneSzukajPodmioty` (+ `GetValue` on empty), `sid` header, MTOM;
  no full report.
- **R-5** no XML dependency; extractor refuses DTDs, caps size.
- **R-6** White List / VIES address parsing best-effort; empty beats invented.
- **R-7** seven abuse layers; the shared Redis budget is the decisive one.
- **R-8** Redis answer cache + tickets + budgets, TTL-only; fail closed.
- **R-9** per-process GUS session, single-flight, key fingerprint, one re-login.
- **R-10** client `RegisterForm` on `useActionState`, `intent` dispatch, password never in state,
  no URL state; accepted no-JS Enter limitation.
- **R-11** `registration-options` endpoint, Next tag, `settings.value_changed` revalidation, fail
  closed.
- **R-12** credential type owned by `organizations`, `credential_ref` setting, non-binding edges.
- **R-13** top-level `registryLookupId`; one row per lookup in the registration transaction via
  `withOrgScope`; outcome mapping; audit via existing entry.
- **R-14** divergence computed on read with normalisation rules.
- **R-15** POST lookup, 200 for outcomes, unknown-route 404 when off, no new error code.
- **R-16** feature setting, routes always registered.
- **R-17** one normaliser for lookup and ticket matching; registration's own tax-ID rules
  untouched.
- **R-18** codes from the backend, prose in the storefront/admin bundles.

## Test plan (TDD — every FR to at least one test)

| FR | Test (RED first) |
| --- | --- |
| FR-001, FR-004 | `registry-lookup-service.test.ts` (routing per country); `registry-lookup.contract.test.ts` (each status over HTTP) |
| FR-002 | `tax-id.test.ts` (checksum table, prefixes, `GR`→`EL`, garbage); contract: invalid/unsupported → fakes record zero calls |
| FR-003, FR-003a | `merge.test.ts` (every row of every mode table in research R-3); `registry-lookup-service.test.ts` per mode (GUS skipped when unconfigured / credentials absent under `gus_mf`; WL zero calls under `gus`; GUS zero calls under `mf` with a credential present; non-PL always VIES whatever the mode); `registry-lookup.contract.test.ts` one scenario per mode |
| FR-005 | `gus-bir-client.test.ts` (address composition, unit choice, ceased); `address-parsers.test.ts`; `registry-adapters.test.ts` |
| FR-006 | `registry-lookup-store.test.ts` (ticket mint, 43-char id, TTL, Zod-rejected payload ⇒ absent) |
| FR-007 | `registry-lookup-service.test.ts` (fake clients that never resolve ⇒ answer ≤ deadline with fake timers) |
| FR-008 | `registry-lookup-rate-limit.contract.test.ts` on `setupBackendServer({ enableRateLimit: true })`: 11th request in the window ⇒ 429; `registry-lookup-store.test.ts` / `registry-lookup-service.test.ts`: budget exhaustion ⇒ `budget_exhausted`, zero client calls; under `gus` the White List budget counter is never incremented, under `mf` the GUS counter never is |
| FR-009 | `registry-lookup-service.test.ts` (second lookup ⇒ zero client calls, budget unchanged; per-status TTLs) |
| FR-010 | contract: response keys exactly the schema's; a tax ID of an existing Organization ⇒ same answer as an unknown one |
| FR-011 | `gus-bir-client.test.ts` (logger never receives key or sid); `registry-lookup.contract.test.ts` (response never contains them) |
| FR-012, FR-018 | storefront `register-registry-lookup.test.tsx` (on/off render); `registry-lookup-api.test.ts` (options fail closed) |
| FR-013, FR-017 | storefront `register-form-state.test.ts` (password excluded; values kept on refusal); `register-registry-lookup.test.tsx` (server render of returned state prefilled, hidden id set) |
| FR-014 | `register-registry-lookup.test.tsx` (live region mounted empty; loading disables button); conformance (axe) |
| FR-015 | `register-registry-lookup.test.tsx` (a message per status, both locales via `auth-pages-i18n.test.tsx`) |
| FR-016 | contract `register-registry-lookup.contract.test.ts` (submitted values stored, not registry values) |
| FR-019, FR-020 | contract `register-registry-lookup.contract.test.ts` (matching ticket ⇒ one row, `origin: 'registration'`, snapshot from Redis; mismatched tax ID / unknown / expired / toggle off ⇒ no row, 201); `registration-snapshot.test.ts` (outcome mapping table) |
| FR-021 | contract: registry fakes record zero calls during register; Redis ticket read failure ⇒ 201, no row |
| FR-022 | `registry-divergence.test.ts` (normalisation table); `vat-validations-registration.contract.test.ts` (item shape, divergence) |
| FR-023 | admin component test for `ModerationActionsPanel` notice (pending + count > 0 only) |
| FR-024 | existing VAT validation contract/integration tests unchanged and green; `ministerstwo-finansow-client.test.ts` / `vies-client.test.ts` characterise `validate()` before the extraction |
| FR-025 | `registry-lookup-off.contract.test.ts` (flip ⇒ 404 identical to an unknown path; options follow; restoration); unit: `settings.value_changed` for the two codes ⇒ one revalidation of the tag, other codes ⇒ none |
| FR-026 | `registry-lookup-off.contract.test.ts` (`credentials` deactivated ⇒ GUS fake not called, White List answers under `gus_mf`, `unavailable` and zero calls under `gus`; restored ⇒ GUS called); credential type registered with `apiKey` secret and `environment` endpoint |
| FR-026a | `registry-lookup-off.contract.test.ts` (mode switch applies to the next lookup with no restart; unknown stored value ⇒ `gus_mf`); `pl-sources-warning.test.ts` (warning only for that setting, draft `gus`, empty credential reference) |
| FR-026b | `registry-lookup-store.test.ts` (key includes the mode for PL); contract: lookup under `gus_mf`, switch to `mf`, same NIP ⇒ the White List fake is called again and the answer's `source` is `mf` |
| FR-027 | `registered-bundles-shape.test.ts`, `check:action-route-permissions`, `palette-coverage.test.ts` |
| FR-028 | storefront `tsc` (defineMessages); `registered-bundles-shape.test.ts`; `check:bundle-pairing`; `i18n:hardcoded` |
| FR-029 | `check:module-docs`, `check:docs-translations`, `build:docs` |

## Generated artefacts, changesets, documentation

- `pnpm --filter backend run composer:generate` after the migration (migration registry) and the
  manifest change; `pnpm --filter backend run manifests:generate` + `pnpm install --lockfile-only`
  if any package manifest changes (none expected); commit the artefacts in the same merge request.
- Changesets (`specs/conventions/release-intent.md`): `minor` for `@endora-commerce/contracts`
  (new schemas, widened union, optional field) and for the `organizations` module package.
- Docs: `packages/modules/organizations/docs/organizations.md` § *VAT-ID / NIP validation* extended
  with *Registry lookup at registration* (providers, routing, settings, GUS credential incl. the test
  environment, limits, what moderators see); Polish mirror and translation-cache entry under
  `docs/i18n/pl/…/modules/organizations.md`; `check:module-docs`, `check:docs-translations`.
- No `AGENTS.md` change beyond what `/speckit.plan`'s agent-context script writes (none needed: no
  new technology).

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| (transparency, not a violation) Registration keeps its hand-placed `recordAuditFromContext` rather than becoming a Command, and the new validation row rides in that unit | The row is part of creating the Organization; one unit, one audit entry (Principle XIII's co-transactional rule) | Converting registration to a Command is a refactor of an anonymous, pre-actor flow with its own owner questions (actor = none); splitting the row into its own Command would create two audit entries for one operation |
| New runtime dependency | **None** | — |

## Risks

| Risk | Mitigation |
| --- | --- |
| A BIR1.1 detail recorded in research R-4 is wrong (action URI, error spelling, MTOM framing) | T001 spike against the test environment before any client code; fixtures copy the captured framing |
| The White List daily limit is lower than assumed, or shared more than expected | Budget constant re-measured in T001; the budget is per Warsaw day; GUS still answers when the WL budget is spent |
| `request.ip` is the storefront's address in a deployment without trusted-proxy configuration | Documented in the module page; the global budget bounds harm regardless (R-7) |
| No-JS Enter key fetches instead of registering | Accepted (R-10); designer review T060 may choose the hidden-default-button technique instead |
| GUS returns several units / natural-person data | Unit selection rule (R-4); data stays in the ticket and the validation row of the registrant's own Organization; fixtures synthetic |
| Harness rate limit disabled (`disableRateLimit: true` by default) hides FR-008 | A dedicated contract file boots `setupBackendServer({ enableRateLimit: true })` (T041); the route's limit is an exported constant, as `CMS_CONTACT_FORM_RATE_LIMIT` is |

## Handoff summary for `endora-commerce-dev`

1. **Start with T001** (spike, throwaway, nothing committed): confirm research R-4 and R-6 facts
   against GUS test, White List and VIES; capture framing for fixtures; correct research if needed.
2. Build bottom-up, RED before GREEN, in `tasks.md` order: contracts → tax-ID normaliser →
   MF/VIES extraction (characterisation tests first) → GUS SOAP/client → merge → store → service →
   routes → registration persistence → admin → storefront → docs.
3. Do **not** add `fast-xml-parser` or any dependency; do **not** put `credentials` in
   `dependencies`; do **not** put `registryLookupId` inside `organization` in the register schema.
4. Never log the GUS key or sid; never echo the password into form state.
5. Spec OD-6 and OD-7 (formerly Q1, Q2): `registry_lookup_enabled` defaults to `false`;
   registration never writes the registry's legal name into `legalName`.
6. Run before reporting: `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, the
   targeted backend tests, `pnpm --filter '!backend' run test` for contracts/organizations/storefront,
   `check:naming`, `check:language`, `check:command-coverage`, `check:port-dependencies`,
   `check:entry-presence`, `check:module-docs`, `check:docs-translations`, `i18n:hardcoded`,
   `check:bundle-pairing`, the permission inventory and palette tests, `composer:check`.
