---
description: "Task list for feature 173 — company registry lookup at storefront registration"
---

# Tasks: Company registry lookup at storefront registration

**Input**: `specs/173-registration-registry-lookup/` — spec.md, plan.md, research.md, data-model.md,
contracts/
**Tests**: mandatory (Principle III). Inside every phase, the **RED** block is written and seen
failing before its **GREEN** block. A test task names the FR it proves.

**Placement rules**: harness-free tests sit beside their subjects in the package
(`specs/conventions/backend-test-suite.md`, feature 106); tests that need `setupBackendServer` go in
`backend/test/contract/organizations/`. `pnpm run build:packages` after editing any package, before
running anything.

## Format: `[ID] [P?] [Story] Description`

- **[P]** — different files, no dependency on an unfinished task.
- **[USn]** — the user story (spec.md) the task serves; Setup / Foundational / Polish carry none.

---

## Phase 1: Setup

- [x] T001 **Spike (throwaway — nothing enters the tree).** Done 2026-11-05; findings in research
  R-4 and R-6, corrections in `contracts/gus-bir11-client.md` §4. In a scratch directory outside the
  repository, call the GUS BIR1.1 **test** endpoint with the public test key: `Zaloguj`,
  `DaneSzukajPodmioty` for a legal-person NIP, a sole-trader NIP, an unknown NIP, a NIP with
  several units if one is found; `GetValue(KomunikatKod)` and `GetValue(StatusSesji)`; a search with
  a stale sid. Record: action URIs, the MTOM framing, both not-found spellings, the `KodPocztowy`
  format, session expiry. Read the current White List API documentation for the `search` daily
  limit and the 429 / limit error shape; call VIES for a German and a Polish number. **Update
  research R-4, R-6 and R-7 (`limits.ts` constants) and `contracts/gus-bir11-client.md` with any
  correction**, and keep the captured framing (not the data) for the fixtures of T008, T009 and T018.
- [x] T001a **White List host move (deadline 2026-12-01; owner ruling: ships in this feature's
  branch, as its first commit).** The White List moves to `https://wykazpodatnikowvat.mf.gov.pl`
  and the old `wl-api.mf.gov.pl` stops on 2026-12-01 (research R-6), which breaks today's admin
  "Validate now". A failing test pinning the default base URL of `MinisterstwoFinansowClient`,
  then the one-line change, the source comment, the module docs (EN + PL) and a changeset for
  `organizations`. If this feature cannot merge before 2026-12-01, cherry-pick that commit into its
  own merge request.
- [x] T002 Branch `feat/173-registration-registry-lookup` from `origin/master` (owner: one branch
  for everything, in the main checkout), `pnpm install`, `pnpm run build:packages`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: contracts, normalisation, the three registry clients, the merge, the Redis store, the
lookup service, the settings and the harness fakes. No user-visible behaviour yet.

### Tests first (RED)

- [x] T003 [P] `packages/contracts/src/organization-registry-lookup.test.ts` — request schema
  trims and upper-cases `country`; response schema accepts each row of `contracts/public-api.md`
  §2's table and rejects an unknown `status`; `registryLookupIdSchema` accepts exactly 43 base64url
  characters; `registrationOptionsResponseSchema`; `registerOrganizationRequestSchema` accepts a
  top-level `registryLookupId` and `AdminOrganizationCreateBodySchema` does **not** carry it;
  `VatValidationProvider` admits `gus_pl`; `REGISTRY_LOOKUP_COUNTRIES` has `PL`, `EL`, `XI` and no
  `GR`. (FR-001, FR-005, FR-019)
- [x] T004 [P] `packages/modules/organizations/src/backend/registry-lookup/tax-id.test.ts` — NIP
  checksum table (valid, last digit off by one, mod-11 = 10, nine/eleven digits), `PL` prefix,
  spaces/dashes/dots, EU prefix overriding the chosen country, `GR`→`EL`, bare digits with country
  `DE` going to VIES, a non-EU country ⇒ `unsupported_country`, `PL1234567890` ⇒ invalid. (FR-002)
- [x] T005 [P] `packages/modules/organizations/src/backend/integrations/ministerstwo-finansow-client.test.ts`
  — **characterisation** of today's `validate()` (Czynny ⇒ validated, Zwolniony ⇒ failed
  `not_active_vat_payer`, null subject, 404, 429, 5xx, timeout, bad shape) with a fake `fetch`, then
  the new `search(nip)` returning the parsed subject / not found / unavailable, including the T001
  shapes: `200` with `subject: null` ⇒ not found; `400 WL-115` ⇒ invalid; a body `code` `WL-1919`
  (any status) ⇒ `unavailable` / `rate_limited`; `WL-1188` ⇒ `unavailable` /
  `provider_maintenance`. (FR-024)
- [x] T006 [P] `packages/modules/organizations/src/backend/integrations/vies-client.test.ts` — same
  for `validate()` and the new `check(country, number)`. (FR-024)
- [x] T007 [P] `packages/modules/organizations/src/backend/registry-lookup/address-parsers.test.ts`
  — White List `"UL. X 1/2, 00-001 WARSZAWA"`, no comma, a right part without a postal code, two
  commas; VIES multi-line, single-line, `---`, empty. (FR-005)
- [x] T008 [P] `packages/modules/organizations/src/backend/integrations/gus-bir-soap.test.ts` —
  envelopes byte-for-byte (`contracts/gus-bir11-client.md` §2, key XML-escaped); envelope cut from
  an MTOM body; entity decoding (predefined + numeric); `<dane>` split and leaf read incl. `<Leaf/>`;
  DTD ⇒ `invalid_response`; > 256 KB ⇒ `invalid_response`. (FR-005, research R-5)
- [x] T009 [P] `packages/modules/organizations/src/backend/integrations/gus-bir-client.test.ts` —
  `contracts/gus-bir11-client.md` §4 table row by row; address composition and unit selection
  (research R-4); session reuse within 50 min, re-login after, single-flight under two concurrent
  lookups, re-login on fingerprint change, one retry on expired session; per-request and total
  timeouts with fake timers; **the logger and every returned value never contain the key or the
  sid**. (FR-003, FR-005, FR-007, FR-011)
- [x] T010 [P] `packages/modules/organizations/src/backend/registry-lookup/registry-adapters.test.ts`
  — MF adapter maps `statusVat` and parses the address; VIES adapter maps valid/invalid and `---`.
  (FR-004, FR-005)
- [x] T011 [P] `packages/modules/organizations/src/backend/registry-lookup/merge.test.ts` — one
  `describe` per Polish-sources mode, every row of research R-3's table for that mode (`gus_mf`,
  `gus`, `mf`); attempts preserved in order; an excluded registry appears as `skipped` /
  `excluded_by_setting`; under `gus` a found answer has `vatStatus: 'unknown'` and
  `vatStatusSource: null`; under `gus` GUS unavailable / not configured / over budget ⇒
  `unavailable` (never a White List answer). (FR-003)
- [x] T012 [P] `packages/modules/organizations/src/backend/registry-lookup/registry-lookup-store.test.ts`
  — against a structural fake Redis: answer cache TTL per status; ticket mint (43-char id, 2 h TTL,
  JSON validated on read, invalid JSON ⇒ absent), delete; answer key carries the Polish-sources
  mode for `PL` and `vies` otherwise (FR-026b); budget INCR with per-provider window
  (UTC hour vs Warsaw day, incl. a DST day), over budget ⇒ refused; every Redis error surfaces as a
  typed failure the service can map to `unavailable`. (FR-006, FR-008, FR-009)
- [x] T013 `packages/modules/organizations/src/backend/registry-lookup/registry-lookup-service.test.ts`
  — with fake clients that count calls: routing per country; invalid/unsupported ⇒ zero calls and
  zero Redis; GUS skipped when the credential resolver answers `null`; parallel legs; second lookup
  of the same ID ⇒ zero client calls and no budget consumed; budget exhausted ⇒ leg `unavailable`
  `budget_exhausted` without calling the client; Redis failure ⇒ `unavailable`, `lookupId: null`;
  never-resolving clients ⇒ answer within 8 s (fake timers); a ticket per consulted outcome; the
  answer never says whether the tax ID is registered. **Per mode**, with a GUS credential resolving:
  `gus_mf` ⇒ both clients called once, in parallel; `gus` ⇒ White List client **zero** calls and its
  budget counter untouched; `mf` ⇒ GUS client **zero** calls, credential resolver never invoked, GUS
  budget untouched. `gus` with the resolver answering `null` ⇒ `unavailable`, zero calls. A non-PL
  number ⇒ VIES only under each of the three modes; VIES never called for a PL NIP in any mode. The
  mode reader fails closed: a throwing or unknown value ⇒ `gus_mf`. A cached `gus_mf` answer is
  **not** served after the mode changes to `mf`. (FR-001 – FR-004, FR-003a, FR-006 – FR-010,
  FR-026a, FR-026b)

### Implementation (GREEN)

- [x] T014 `packages/contracts/src/organization-registry-lookup.ts` (schemas per
  `contracts/public-api.md`, `contracts/admin-surfaces.md` §6, data-model §6), export from
  `packages/contracts/src/index.ts`; in `packages/contracts/src/organizations.ts` add `'gus_pl'` to
  `VatValidationProvider` and the top-level optional `registryLookupId`. `pnpm --filter
  @endora-commerce/contracts run build`. Makes T003 green.
- [x] T015 [P] `registry-lookup/tax-id.ts` — T004 green.
- [x] T016 [P] Extract `search()` in `integrations/ministerstwo-finansow-client.ts` and `check()` in
  `integrations/vies-client.ts`; rewrite `validate()` over them with no behaviour change — T005,
  T006 green.
- [x] T017 [P] `registry-lookup/address-parsers.ts` — T007 green.
- [x] T018 [P] `integrations/gus-bir-soap.ts` and the synthetic fixtures
  `integrations/fixtures/gus/*.txt` (framing from T001, data invented) — T008 green.
- [x] T019 `integrations/gus-bir-client.ts` — T009 green.
- [x] T020 [P] `registry-lookup/company-registry-port.ts`, `registry-lookup/registry-adapters.ts` —
  T010 green.
- [x] T021 [P] `registry-lookup/merge.ts` — T011 green.
- [x] T022 `registry-lookup/limits.ts` (TTLs, budgets, windows, timeouts from research R-7/R-8 as
  corrected by T001) and `registry-lookup/registry-lookup-store.ts` — T012 green.
- [x] T023 `registry-lookup/registry-lookup-service.ts` — T013 green.
- [x] T024 `packages/modules/organizations/src/manifest.ts` — `REGISTRY_LOOKUP_ENABLED`,
  `GUS_CREDENTIALS` and `REGISTRY_LOOKUP_PL_SOURCES` in `ORGANIZATIONS_SETTING_CODES`; the three
  settings (`contracts/admin-surfaces.md` §2; `registry_lookup_enabled` default `false` per spec
  OD-6; `registry_lookup_pl_sources` `enumOptions: ['gus_mf', 'gus', 'mf']`,
  default `'gus_mf'`, description warning that `gus` without a GUS credential means no Polish
  lookup); the two
  `nonBindingDependencies` (§3). `registry-lookup/gus-credential.type.ts` (data-model §5).
- [x] T025 `packages/modules/organizations/src/backend/index.ts` — register
  `organizationsRegistryClients` (`{ gusPl, mfPl, vies }`, production sharing **one**
  `MinisterstwoFinansowClient` and **one** `ViesClient` instance with `organizationsTaxIdClients`, so
  one throttle per registry), the store (on the cradle's `redis`), and the lookup service with a
  per-lookup Polish-sources reader (`REGISTRY_LOOKUP_PL_SOURCES`, fail-closed to `gus_mf`) and a GUS
  credential resolver — called only when the mode includes GUS — that reads `GUS_CREDENTIALS`
  fail-closed, checks
  `effectiveState.isPresent('credentials')`, then `lazyPort<CredentialsPort>(ctx,
  'credentialsService').resolve(code)`. Add the **contribution** boot hook pushing
  `gusBirConfigurationType` into `configurationTypeRegistry` (unprobed, the `product_feeds` shape).
- [x] T026 `backend/test/helpers/test-server.ts` — contribute fake `organizationsRegistryClients`
  (deterministic by NIP suffix, counting calls, exposing a "delay forever" switch) beside the existing
  `organizationsTaxIdClients` fakes; update `backend/test/contract/kernel/harness-parity.test.ts` for
  the new contribution name. `pnpm run build:packages`; `pnpm --filter backend run
  check:port-dependencies` and `check:entry-presence` clean.

**Checkpoint**: unit suites of contracts and organizations green; nothing user-visible yet.

---

## Phase 3: User Story 1 — The registration form is filled from the registry (P1) — MVP

**Goal**: with the lookup on, a buyer fetches company data (JS and no-JS) and registers; the
registry snapshot is persisted with the new Organization.
**Independent Test**: spec US1.

### Tests (RED)

- [x] T027 [P] [US1] `backend/test/contract/organizations/registration-options.contract.test.ts` —
  setting on ⇒ `{ enabled: true, countries: REGISTRY_LOOKUP_COUNTRIES in picker form }`; off ⇒
  `{ enabled: false, countries: [] }`; reachable on a store closed to anonymous visitors; the answer
  is identical under all three Polish-sources modes (`PL` always listed, no mode field). (FR-018,
  FR-025)
- [x] T028 [P] [US1] `backend/test/contract/organizations/registry-lookup.contract.test.ts` — found
  via GUS (structured address, VAT status from the WL fake, source `gus`); GUS unconfigured ⇒ WL data
  with parsed address, source `mf`; GUS failing ⇒ WL; EU number ⇒ VIES; response keys exactly the
  schema's; `Cache-Control: no-store`; a repeated lookup ⇒ fakes record one call; a tax ID belonging
  to an existing Organization ⇒ same body shape as an unknown company's; the body never contains the
  fake key or sid. **One scenario per Polish-sources mode** (spec US1 scenarios 1 – 4): `gus_mf` as
  above; `gus` ⇒ `source: 'gus'`, `vatStatus: 'unknown'`, White List fake zero calls; `mf` with a GUS
  credential configured ⇒ `source: 'mf'`, WL VAT status, GUS fake zero calls; and an EU number ⇒
  VIES under each mode. Switching `gus_mf` → `mf` and repeating a NIP ⇒ the WL fake is called again,
  `source: 'mf'` (FR-026b). (FR-001, FR-003 – FR-006, FR-009 – FR-011)
- [x] T029 [P] [US1] `packages/modules/organizations/src/backend/registry-lookup/registration-snapshot.test.ts`
  — ticket + submission ⇒ validation-row values: research R-13's outcome table including the
  `gus`-mode row (`unverified` / `vat_status_not_checked`) as distinct from the `gus_mf` WL-failure
  row (`deferred` / `vat_status_unavailable`), `registry_details.plSources`, `provider` choice,
  `address_returned` in the existing `ReturnedAddress` shape, `registry_details`,
  `submitted_values` without any user data; ticket/submission mismatch after normalisation ⇒ `null`.
  (FR-019, FR-020)
- [x] T030 [US1] `backend/test/contract/organizations/register-registry-lookup.contract.test.ts` —
  lookup then register with the returned `registryLookupId` and an edited street ⇒ 201; exactly one
  `organization_tax_id_validations` row, `origin = 'registration'`, snapshot equal to what the
  lookup answered (not to anything in the register body), `submitted_values` equal to the body; the
  Organization stores the **submitted** street; summary columns stamped; the `organization.register`
  audit row's `stateAfter.registryLookup` set; the ticket is gone from Redis; registry fakes record
  zero calls during the register request. (FR-016, FR-019 – FR-021)
- [x] T031 [P] [US1] `storefront/test/auth/register-form-state.test.ts` — `valuesFromFormData`
  never yields a password; a found lookup merges company values and the answer's country; a refusal
  keeps values and the lookup. (FR-013, FR-016, FR-017)
- [x] T032 [P] [US1] `storefront/test/lib/registry-lookup-api.test.ts` — options read with the
  `organizations:registration-options` tag and `revalidate: 300`, any error ⇒ disabled; lookup posts
  the schema body and forwards `x-forwarded-for`; 429 ⇒ `rate_limited`. (FR-018, FR-008)
- [x] T033 [US1] `storefront/test/auth/register-registry-lookup.test.tsx` — enabled ⇒ country and
  tax ID first, "Fetch company data" button with `name="intent" value="lookup"` and
  `formNoValidate`, hint, an empty `role="status"` region; a server render of a **found** state
  (the no-JS round trip) ⇒ company inputs carry the registry values, the hidden `registryLookupId` is
  set, the password input is empty, the found + VAT messages are in the region; the URL carries
  nothing. (FR-012 – FR-014)

### Implementation (GREEN)

- [x] T034 [US1] `packages/modules/organizations/src/backend/routes.registry-lookup.ts` — the two
  routes per `contracts/public-api.md` §1–2 (rate-limit config exported as a constant; toggle read
  per request, fail-closed; unknown-route 404 when off), registered from `index.ts` through
  `ctx.routes`. T027, T028 green.
- [x] T035 [US1] Scaffold the migration: `pnpm --filter backend run migration:new -- --module
  organizations --name registry-lookup-provenance`; fill `up`/`down` per data-model §1; add the
  three properties to `entities/organization-tax-id-validation.entity.ts` (`origin` with default
  `'admin'`, `registryDetails`, `submittedValues`) and `'gus_pl'` to the entity's provider type;
  `pnpm --filter backend run composer:generate`; commit the regenerated migration registry.
- [x] T036 [US1] `registry-lookup/registration-snapshot.ts` — T029 green.
- [x] T037 [US1] `services/registration-service.ts` — accept a `registryLookup` collaborator (toggle
  reader + store); after the Organization row, read the ticket, build the row with T036, write it
  inside `withOrgScope(organization.id, '<reason>')` on the same EM, stamp the summary, add
  `registryLookup` to the audit `stateAfter`; delete the ticket after commit (best effort). A Redis
  error on the read ⇒ no row, an `info` log, registration continues. `routes.public.ts` passes
  `body.registryLookupId`; `index.ts` wires the collaborator. T030 green.
- [x] T038 [US1] `storefront/lib/api/registry-lookup.ts` (`getRegistrationOptions`,
  `lookupCompany`) and `registryLookupId` on `RegisterOrganizationPayload` in
  `storefront/lib/api/auth.ts` — T032 green.
- [x] T039 [US1] `storefront/lib/auth/register-form-state.ts`, `storefront/app/(auth)/register/actions.ts`
  (`registerFormAction`, `lookupCompanyAction`), `storefront/components/auth/RegisterForm.tsx`, the
  page shell in `storefront/app/(auth)/register/page.tsx`, and the `auth.register.lookup.*` keys in
  both blocks of `storefront/lib/i18n/messages/auth.ts` (`contracts/storefront-ux.md`). T031, T033
  green; update `storefront/test/auth/auth-pages-i18n.test.tsx` and
  `storefront/test/auth/register-customer-closed-store.test.tsx` for the new component.

**Checkpoint**: US1 demonstrable end to end with fake registries; MVP.

---

## Phase 4: User Story 2 — A failed or negative lookup never stops a registration (P1)

**Goal**: every negative outcome has its message and a registration still succeeds.
**Independent Test**: spec US2.

### Tests (RED)

- [x] T040 [US2] Extend `registry-lookup.contract.test.ts` — invalid NIP and unsupported country ⇒
  their status, `lookupId: null`, fakes record zero calls; not found; WL exempt / not registered ⇒
  `found` with that VAT status; GUS unit with an end date ⇒ `activityStatus: 'ceased'`; every leg
  delayed forever ⇒ `unavailable` within 8 s; budget pre-filled in Redis ⇒ `unavailable`, zero
  calls; Redis made to fail ⇒ `unavailable`. Mode `gus`: GUS fake failing, delayed forever,
  over budget, and no credential selected ⇒ each `unavailable` with the White List fake at **zero**
  calls (spec US2 scenario 4a); mode `mf`: White List failing ⇒ `unavailable` with the GUS fake at
  zero calls. (FR-002, FR-003, FR-007, FR-008, FR-015, SC-003)
- [x] T041 [P] [US2] `backend/test/contract/organizations/registry-lookup-rate-limit.contract.test.ts`
  on `setupBackendServer({ enableRateLimit: true })` — the 11th lookup from one address within the
  window ⇒ `429 RATE_LIMITED`; another address unaffected. (FR-008)
- [x] T042 [US2] Extend `register-registry-lookup.contract.test.ts` — after each of not found,
  unavailable, VAT inactive: register ⇒ 201 (SC-002), with the mapped row (not found ⇒ `failed`
  `not_found`; unavailable ⇒ `deferred`); a ticket for a **different** tax ID, an unknown ticket and
  an expired ticket ⇒ 201 and **no** row; a register refused with 409 (e-mail taken) leaves the
  ticket usable for the retry. Mode `gus`: a found lookup then register ⇒ row `unverified` /
  `vat_status_not_checked`, `registry_details.plSources = 'gus'`, the White List attempt
  `skipped` / `excluded_by_setting`; a `gus`-mode `unavailable` lookup then register ⇒ 201. A ticket
  minted under `gus_mf` and registered after the mode changed to `mf` ⇒ the row records the ticket's
  `plSources` (`gus_mf`), not the current one. (FR-017, FR-020, FR-021)
- [x] T043 [P] [US2] Extend `storefront/test/auth/register-registry-lookup.test.tsx` — one render per
  status (`not_found`, `unavailable`, `invalid_tax_id`, `unsupported_country`, `rate_limited`,
  `found` + `noDetails`, `found` + `ceased`, `found` + each VAT status) shows its message and leaves
  the company fields as they were; a returned registration refusal shows the error in a
  `role="alert"` element, keeps every value but the password and keeps the hidden reference.
  (FR-015, FR-017)

### Implementation (GREEN)

- [x] T044 [US2] Close whatever T040 – T043 expose in `registry-lookup-service.ts`,
  `routes.registry-lookup.ts`, `registration-service.ts`, `RegisterForm.tsx` and `actions.ts`
  (refusal returns state instead of the `?error=` redirect; the page ignores a stale `?error=`).

**Checkpoint**: US1 + US2 hold; no lookup outcome can block a registration.

---

## Phase 5: User Story 3 — The operator controls the lookup and its GUS key (P1)

**Goal**: on/off without restart; Polish sources selectable per OD-5 with a Settings-screen warning;
GUS credential optional; `credentials` stays switchable.
**Independent Test**: spec US3.

### Tests (RED)

- [x] T045 [US3] `backend/test/contract/organizations/registry-lookup-off.contract.test.ts` —
  toggle off ⇒ lookup answers byte-identically to `POST /api/v1/organizations/no-such-route`
  (status, headers that matter, body); options `enabled: false`; a register carrying a valid ticket ⇒
  201 and no row; toggle on again ⇒ lookup answers and the ticket path works (restoration).
  `credentials` **deactivated** (operator axis) ⇒ GUS fake not called, WL answers under `gus_mf`
  and `unavailable` with zero calls under `gus`; restored ⇒ GUS called. No GUS credential selected ⇒
  WL only under `gus_mf`, `unavailable` under `gus`. Changing `registry_lookup_pl_sources` takes
  effect on the next lookup with no restart; a stored value outside the three ⇒ treated as
  `gus_mf`; non-PL lookups unchanged by every mode (spec US3 scenarios 4a, 6). A GUS credential created through the credentials API
  with type `organizations_gus_bir` ⇒ `GET` shows the key masked; the type lists `apiKey` as secret
  and `environment` as an endpoint field. (FR-009, FR-025, FR-026, FR-026a, FR-026b, US3 scenarios
  1, 3 – 6)
- [x] T046 [P] [US3] Unit test beside the subscriber (e.g.
  `packages/modules/organizations/src/backend/registry-lookup/registration-options-revalidation.test.ts`)
  — `settings.value_changed` for either registration code ⇒ one
  `revalidate(['organizations:registration-options'])`; any other code — including
  `registry_lookup_pl_sources`, which the options answer does not reflect — ⇒ none. (FR-025)
- [x] T047 [P] [US3] Extend `storefront/test/auth/register-registry-lookup.test.tsx` — options
  disabled ⇒ no button, no hint, no status region, field order as specified. (FR-012)
- [x] T047a [P] [US3] `packages/modules/organizations/src/admin/zones/pl-sources-warning.test.ts` —
  the pure decision: warning only for `organizations.registration.registry_lookup_pl_sources`, only
  when the draft is `gus` and the stored GUS credential reference is empty; `gus_mf`, `mf`, a
  non-empty reference, another setting code, and an unreadable reference ⇒ no warning. (FR-026a)

### Implementation (GREEN)

- [x] T048 [US3] `index.ts` — `ctx.subscribe('settings.value_changed', …)` filtering the two codes
  (`registry_lookup_enabled`, `gus_credentials`)
  and calling a `StorefrontRevalidator` (`STOREFRONT_BASE_URL`, `REVALIDATE_SECRET`, the
  `google_tag_manager` shape) for the tag. T046 green; T045 green with T025's wiring.
- [x] T049 [US3] Palette action `open-registration-registry-lookup-settings`
  (`contracts/admin-surfaces.md` §5) in `manifest.ts`; `settingLabels.*` and `actions.*` keys in
  `packages/modules/organizations/i18n/en.json` and `pl.json`.
  `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`,
  `pnpm --filter backend run check:action-route-permissions`,
  `pnpm --filter admin exec vitest run test/unit/palette-coverage.test.ts` green. (FR-027, FR-028)
- [x] T049a [US3] `src/admin/zones/pl-sources-warning.ts` + `src/admin/zones/PlSourcesWarning.tsx`
  contributed to `settings.setting.after` from `src/admin/index.ts` (the `seo` `zoneComponent`
  shape), reading the stored credential reference through the settings admin API; the
  `settingsWarning.plSourcesGusWithoutCredential` and `settingLabels.…registry_lookup_pl_sources.*`
  keys in both bundles (`contracts/admin-surfaces.md` §2a, §9). T047a green; `i18n:hardcoded`
  clean; `pnpm --filter backend run composer:generate` if the admin zone registry is generated.
  (FR-026a)

**Checkpoint**: US1 – US3 hold; the feature can ship with the moderation view still basic.

---

## Phase 6: User Story 4 — The moderator sees the registry snapshot and the divergence (P2)

**Goal**: the admin history shows origin, registry details and per-field divergence; pending
Organizations show a divergence notice.
**Independent Test**: spec US4.

### Tests (RED)

- [x] T050 [P] [US4] `packages/modules/organizations/src/backend/registry-lookup/registry-divergence.test.ts`
  — research R-14's rules: case, diacritics, punctuation, whitespace, street prefixes, postal digits,
  each legal-form equivalence; a registry-empty field is never a divergence; a real difference lists
  both values. (FR-022)
- [x] T051 [US4] `backend/test/contract/organizations/vat-validations-registration.contract.test.ts`
  — after a lookup + register with an edited street, `GET …/vat-validations` items parse with
  `organizationTaxIdValidationRecordSchema`, the registration row has `origin`, `registryDetails`,
  `submittedValues` and `divergence: [{ field: 'street', … }]`; an admin "Validate now" row has
  `origin: 'admin'` and nulls, and the POST behaves as before; a sales-rep admin scoped to another
  Organization gets the same answer as for a non-existent Organization (Principle XI). (FR-022,
  FR-024)
- [x] T052 [P] [US4] Pure view helpers beside the admin panels, e.g.
  `packages/modules/organizations/src/admin/panels/vat-validation-view.test.ts` — newest
  registration row selection, rows for the registry-vs-submitted card, the notice shown only for
  `pending_verification` with a count > 0. (FR-022, FR-023)

### Implementation (GREEN)

- [x] T053 [US4] `registry-lookup/registry-divergence.ts`; `routes.admin.ts` maps items through the
  contracts schema with `origin`, `registryDetails`, `submittedValues`, `divergence`. T050, T051
  green.
- [x] T054 [US4] `src/admin/panels/vat-validation-view.ts`, `VatValidationPanel.tsx` (origin column,
  details cell, registry-vs-submitted card, `gus_pl` label), `ModerationActionsPanel.tsx`
  (`registryDivergenceCount` notice), `pages/OrganizationDetail.tsx` (passes the count); keys in the
  module bundle (`contracts/admin-surfaces.md` §9). T052 green;
  `pnpm --filter backend run i18n:hardcoded` clean for the touched files.

**Checkpoint**: all four stories hold.

---

## Phase 7: Polish and cross-cutting concerns

- [x] T055 [P] Documentation: `packages/modules/organizations/docs/organizations.md` — new section
  *Registry lookup at registration* under *VAT-ID / NIP validation* (providers and routing, the three
  Polish-sources modes and when to choose each — `gus` keeps the White List quota for "Validate now"
  but needs a working GUS credential, or Polish lookups stop — the three settings, creating the GUS credential incl. the test environment and key, limits and caching,
  trusted-proxy note for per-client limits, what moderators see, the no-JS behaviour). Polish mirror
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/organizations.md` and its translation
  cache entry (`docs/docs/contributing/documentation-i18n.md`). `pnpm --filter backend run
  check:module-docs`, `check:docs-translations`. (FR-029)
- [x] T056 [P] Changesets: `minor` for `@endora-commerce/contracts` and for the `organizations`
  package (`specs/conventions/release-intent.md`); `pnpm changeset:status`.
- [x] T057 [P] Storefront conformance: add the register page with the lookup enabled and a found
  state to `storefront/test/conformance/` (axe, WCAG 2.2 AA). (FR-014) — written as
  `register-registry-lookup.spec.ts` (research, implementation deviation 9); **not run locally**
  (no Playwright browsers on the machine, and it needs a served storefront and backend).
- [x] T058 Generated artefacts: `pnpm --filter backend run composer:generate` and
  `composer:check`; `manifests:generate` + `pnpm install --lockfile-only` only if a package manifest
  changed. Grep `backend/test/**` for anything the change moved or renamed (`AGENTS.md` traps).
- [x] T059 Full verification: `pnpm run build:packages`; `pnpm -r run typecheck`; `pnpm -r run lint`;
  targeted backend tests for every file above; `pnpm --filter '!backend' run test`;
  `pnpm run check:naming && pnpm run check:language`; `pnpm --filter backend run
  check:command-coverage`, `check:port-dependencies`, `check:entry-presence`,
  `check:subscribe-seam`, `check:bundle-pairing`, `i18n:hardcoded`; the permission inventory
  (`backend/test/contract/admin_users/permission-inventory.test.ts`).
- [x] T060 Designer review (`endora-commerce-designer`, `.claude/skills/ux-laws/SKILL.md`): the
  storefront states table, focus behaviour, the no-JS Enter limitation (research R-10 — keep or
  switch to a hidden default button), Polish copy in both bundles, the admin card and notice.
- [x] T061 Owner sign-off on spec Q1 (toggle default) and Q2 (registry legal name at registration):
  resolved 2026-11-05 as OD-6 (default `false`) and OD-7 (no `legalName` write).

---

## Dependencies and execution order

- **T001** before T008 – T009 and T018 – T019 (fixtures and protocol facts) and before T022
  (constants). T002 before any code.
- **Phase 2** blocks every story. Inside it: T003 → T014; T004 → T015; T005/T006 → T016;
  T007 → T017; T008 → T018; T009 → T019; T010 → T020; T011 → T021; T012 → T022; T013 → T023
  (needs T015 – T022); T024 → T025 → T026.
- T047a → T049a (the warning zone needs only T024's setting code).
- **US1** (Phase 3) needs Phase 2. **US2** extends US1's tests and code. **US3** needs T034 and
  T037 for its contract test; T046/T048 are independent of US1. **US4** needs T035 – T037 (rows to
  read).
- **Polish** after the stories it documents.

## Parallel examples

- After T002: T003 – T012 in parallel (all different files); T013 after T015 – T022 exist as stubs.
- Phase 3 RED: T027, T028, T029, T031, T032 in parallel; T030 and T033 after their dependencies'
  stubs.
- Phase 6: T050 and T052 in parallel with T051.

## Implementation strategy

1. **MVP = Phases 1 – 3**: a buyer fetches and registers; the snapshot is stored.
2. Phase 4 hardens every negative path (ship-blocking: OD-3).
3. Phase 5 makes it operable (ship-blocking: OD-2, the default ships off, OD-6).
4. Phase 6 gives moderators the divergence view (P2; may ship in a second merge request).
5. Phase 7 before the merge request is opened; never commit straight to `master`.
