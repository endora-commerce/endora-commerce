# Tasks: Custom-field writes — admin parity, admin access levels and buyer input at registration

**Input**: `specs/175-buyer-input-custom-fields/` — plan.md (work packages WP-0 – WP-11), spec.md
(US1 – US6, FR-001 – FR-048), research.md (R-1 – R-13), data-model.md, contracts/, quickstart.md
**Tests**: required — Principle III (TDD, non-negotiable). In every phase the failing-test task comes
before the implementation task it covers; run it red before writing the implementation.

**Organisation**: phases follow the plan's work packages in dependency order (the coordinator's and
the plan's split by owning module). Tasks carry the user-story label(s) they serve; WP-0 (contracts),
the check estate and governance are cross-cutting and carry none, as the template's
Setup/Foundational/Polish phases do.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: parallelisable — different files, no dependency on an incomplete task
- **[USn]**: the spec's user story — US1 registration, US2 admin opens a field, US3 refusals,
  US4 admin parity, US5 admin access, US6 personal data
- Paths are repository-relative to `/Users/alandolina/Sites/endora-commerce-open`

---

## Phase 1: Setup

- [X] T001 Build the workspace and record a green baseline before any change: `pnpm run build:packages`, then `pnpm --filter backend exec vitest run test/contract/custom_fields test/contract/organizations/register.test.ts test/contract/organizations/admin-organization-create.contract.test.ts` and `pnpm --filter admin exec vitest run test/kit/kit-custom-field-values.test.tsx`; note any pre-existing failure in the hand-off so it is not attributed to this feature

---

## Phase 2: WP-0 — `@endora-commerce/contracts` (Foundational — blocks every other WP)

**Purpose**: every wire shape of `contracts/*.md` first (Principle II). Bump: minor.

- [X] T002 [P] Write failing schema tests in `packages/contracts/src/custom-fields.buyer-input.test.ts`: `customFieldInputSurfaceSchema` = `['organization.register']`; `customFieldAdminAccessSchema`; `createCustomFieldDefinitionSchema` defaults `customerInput: []`, `adminAccess: 'edit'`; `updateCustomFieldDefinitionSchema` leaves both absent; `customFieldDefinitionSchema` requires both; `customFieldEntityTypeInfoSchema.customerInputSurfaces` defaults `[]`; `customFieldValidationErrorSchema.code` accepts `not_open_for_input` and `too_many_keys`; `inputSurfaceFieldsResponseSchema` parses the example in `specs/175-buyer-input-custom-fields/contracts/input-surface-read.md` and refuses a `page_builder` field
- [X] T003 [P] Write failing schema tests in `packages/contracts/src/organizations-custom-field-values.test.ts`: `registerOrganizationRequestSchema` accepts optional `organization.customFieldValues` and `firstUser.customFieldValues` and still parses a body without them; `AdminOrganizationCreateBodySchema` inherits `customFieldValues`; `adminDirectMemberToRoleRequestSchema` (`.strict()`, `packages/contracts/src/organization-roles.ts:177`) accepts `customFieldValues` and still refuses unknown keys
- [X] T004 [P] Write failing schema tests in `packages/contracts/src/admin-create-custom-field-values.test.ts`: `createCategoryRequestSchema` (`catalog.ts:1365`), `adminCreateOrderRequestSchema` (`orders.ts:732`) and `adminCreateQuoteRequestSchema` (`quote-requests.ts:622`) each accept optional `customFieldValues`, and each still parses its existing fixtures unchanged
- [X] T005 Implement in `packages/contracts/src/custom-fields.ts`: the two enums and types; `customerInput`/`adminAccess` on `customFieldDefinitionSchema` (`:121`), create (`:150`, with defaults), update (`:165`, optional), `CustomFieldDefinitionRecord` (`:515`); `customerInputSurfaces` on `customFieldEntityTypeInfoSchema` (`:188`); the two error codes (`:213`); `validateForCustomerInput` on `CustomFieldValuePort` (`:639`) with the doc comment of `contracts/custom-field-definitions.md` §5; `inputSurfaceFieldSchema` + `inputSurfaceFieldsResponseSchema`; the `CustomFieldWriteDeclaration` type (§6) — makes T002 green
- [X] T006 Implement in `packages/contracts/src/organizations.ts` (`registerOrganizationRequestSchema`, `:187`: `customFieldValues` inside `organization` and `firstUser`) and `packages/contracts/src/organization-roles.ts` (`adminDirectMemberToRoleRequestSchema`) — makes T003 green
- [X] T007 [P] Add `customFieldValues?: Record<string, unknown>` with the "already validated by the caller" doc comment to `CustomerAccountCreateInput` in `packages/contracts/src/customer-accounts.ts:273`
- [X] T008 [P] Add `customFieldValues: customFieldValuesSchema.optional()` to `createCategoryRequestSchema` in `packages/contracts/src/catalog.ts`, `adminCreateOrderRequestSchema` in `packages/contracts/src/orders.ts` and `adminCreateQuoteRequestSchema` in `packages/contracts/src/quote-requests.ts` — makes T004 green
- [X] T009 Build and verify contracts: `pnpm --filter @endora-commerce/contracts run build && pnpm --filter @endora-commerce/contracts run typecheck && pnpm --filter @endora-commerce/contracts run test`; then `pnpm -r run typecheck` to surface every exhaustive switch over the error-code enum; write `.changeset/175-contracts-custom-field-writes.md` (`@endora-commerce/contracts`: minor — name every new export and the two new error codes)

**Checkpoint**: contracts built; every later WP compiles against them.

---

## Phase 3: WP-1 — `custom_fields` (blocks WP-2, WP-4, WP-5, WP-10)

**Goal**: definition attributes, invariants, buyer-input validator, public read (US1, US2, US3).
**Independent test**: T014 + T015 green against a fresh database.

### Tests first

- [X] T010 [P] [US2] Extend `packages/modules/custom_fields/src/backend/services/custom-field-registry.test.ts`: `customerInputSurfacesOf('organization')` and `('customer')` are `['organization.register']`; every other supported type answers `[]`
- [X] T011 [P] [US2] [US5] Write failing tests in `packages/modules/custom_fields/src/backend/services/definition-customer-input.test.ts`: the four refusals of research R-4 (`customer_input_unsupported`, `customer_input_audience` in both change directions, `customer_input_value_type`, `admin_access_required` in both directions), deduplicated/sorted `customerInput`, defaults on create, the same invariants through the `apply*` seam (`custom-field-definition-apply.ts`), and `adminAccess`/`customerInput` present on the published record
- [X] T012 [P] [US3] Write failing tests in `packages/modules/custom_fields/src/backend/services/value-customer-input.test.ts` for `validateForCustomerInput`: closed key, unknown key, key of another entity type → `not_open_for_input`; 51 keys → `too_many_keys` with the definition source stub asserting it was never called; `required` enforced only among open definitions; whitespace-only text = empty; 1 001-char text → `out_of_range`; each of `text`/`number`/`boolean`/`date`/`select`/`multiselect` coerced exactly as `coerce` does; a `page_builder` definition can never be open; `undefined` values → `{}`
- [X] T013 [P] [US1] Write failing tests in `packages/modules/custom_fields/src/backend/routes.public.test.ts` for `GET /api/v1/custom-fields/input-surfaces/:surface`: only open fields per entity type in `sortOrder`; `Accept-Language: pl` label with `labelDefault` fallback (field and option labels); unknown surface → `200` with `entities: {}`; no value, `audience`, `adminAccess` or `config` in the body
- [X] T014 [P] [US2] Write failing contract test `backend/test/contract/custom_fields/definition-customer-input.contract.test.ts`: admin create/update round-trip of both attributes, the four 422 reasons with `details.reason` and `details.key`, existing definitions read `[]`/`edit` after migration, `GET …/entity-types` answers `customerInputSurfaces`
- [X] T015 [P] [US1] Write failing contract test `backend/test/contract/custom_fields/input-surface-read.contract.test.ts`: reachable anonymously on a store closed to anonymous visitors; a definition change of `organization`/`customer` is answered on the next read; the storefront revalidation call is made for the surface tag (assert on the test revalidator)

### Implementation

- [X] T016 [US2] Scaffold the migration — `pnpm --filter backend run migration:new -- --module custom_fields --name definition_customer_input_admin_access` (never pick a number) — and fill it with the `up`/`down` SQL of `data-model.md` §1 in the generated file under `packages/modules/custom_fields/src/migrations/`; run `pnpm --filter backend run composer:generate` and stage `backend/src/db/migrations-registry.generated.ts`
- [X] T017 [US2] Add `customerInput` (jsonb, default `[]`) and `adminAccess` (varchar 16, default `'edit'`) to `packages/modules/custom_fields/src/backend/entities/custom-field-definition.entity.ts`, including `OptionalProps`
- [X] T018 [US2] Add the `customerInputSurfaces` marker to `SupportedEntityMeta`, set it on `organization` and `customer`, and add `customerInputSurfacesOf` in `packages/modules/custom_fields/src/backend/services/custom-field-registry.ts`; expose it in the entity-types listing in `packages/modules/custom_fields/src/backend/routes.admin.ts` — makes T010 green
- [X] T019 [US2] [US5] Enforce the R-4 invariants on the resulting definition in `packages/modules/custom_fields/src/backend/services/custom-field-definition.service.ts` and `custom-field-definition-apply.ts`; map both attributes into the published record and DTO — makes T011 and T014 green
- [X] T020 [US3] Implement `validateForCustomerInput` in `packages/modules/custom_fields/src/backend/services/custom-field-value.service.ts` (research R-3 order of work, reusing `coerce` at `:176`, a 1 000-char buyer text limit beside `DEFAULT_TEXT_MAX`) — makes T012 green
- [X] T021 [US1] Create `packages/modules/custom_fields/src/backend/routes.public.ts` (`salesChannelAccess: 'open'`, `request.responseLanguage()`, definitions from the per-entity cache) and register it with `ctx.routes` in `packages/modules/custom_fields/src/backend/index.ts`; construct a `StorefrontRevalidator` (`@endora-commerce/platform/http`) and revalidate tag `custom-fields:input-surface:<surface>` after any committed definition/option change of an entity type that declares a surface, beside `publishInvalidate` — makes T013 and T015 green
- [X] T022 [US2] [US3] Declare the new `details.reason` tokens on `CUSTOM_FIELD_DEFINITION_INVALID` in `packages/modules/custom_fields/src/manifest.ts` and add en + pl sentences for the four definition refusals and the two value codes to `packages/modules/custom_fields/i18n/en.json` and `pl.json`; run `pnpm --filter backend run check:error-translations`
- [X] T023 Write `.changeset/175-custom-fields-buyer-input-admin-access.md` (`@endora-commerce/mod-custom-fields`: minor — buyer input, admin access, public read, migration)

**Checkpoint**: `pnpm --filter @endora-commerce/mod-custom-fields run test` and T014/T015 green.

---

## Phase 4: WP-3 — `customer_accounts` [parallel with WP-1 and WP-8 after WP-0]

**Goal**: the account create stores a validated bag (US1); anonymisation clears it (US6).

- [X] T024 [P] [US1] Write failing test `packages/modules/customer_accounts/src/backend/services/customer-account-create-custom-fields.test.ts`: `create({ …, customFieldValues })` persists the bag as given; absent → `{}`
- [X] T025 [P] [US6] Write failing test `packages/modules/customer_accounts/src/backend/services/customer-account-anonymize-custom-fields.test.ts`: `anonymize` sets `customFieldValues` to `{}`; the audit `before` holds only `email`; the `customer_account.anonymized.v1` payload holds ids only
- [X] T026 [US1] Persist `input.customFieldValues ?? {}` in `create` in `packages/modules/customer_accounts/src/backend/services/customer-account-ports.ts:360` — makes T024 green
- [X] T027 [US6] Clear `account.customFieldValues = {}` in `anonymize` in `packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.ts:463` — makes T025 green
- [X] T028 [US6] Write and pass `backend/test/integration/customer_accounts/anonymize-custom-fields.test.ts`: an account registered with a `phone` value, anonymised by the retention path, reads `customFieldValues: {}` and no audit row or event carries the phone (SC-008)

> **After rebase onto master (issue #802):** master's own anonymisation scrub already clears the whole custom-field bag inside its transactional audit, and pins it in `customer-account-lifecycle-ports.test.ts` and `customers/customer-deletion-service.test.ts`. T025, T027 and T028's own tests and change were dropped as duplicates; FR-026/FR-027 and SC-008 trace to those master tests.
- [X] T029 Write `.changeset/175-customer-accounts-custom-field-values.md` (`@endora-commerce/mod-customer-accounts`: minor)

---

## Phase 5: WP-8 — declarations in `crm`, `projects`, `tasks`, `customers` [parallel after WP-0]

**Goal**: hosts that already satisfy FR-015 declare it (US4, FR-020). Shapes in `data-model.md` §5.

- [X] T030 [P] [US4] Export `customFieldWrites` (create `POST /api/v1/admin/crm/opportunities` `CreateOpportunityRequestSchema`; update `PATCH …/:id` `UpdateOpportunityRequestSchema`) `satisfies CustomFieldWriteDeclaration[]` from `packages/modules/crm/src/manifest.ts`
- [X] T031 [P] [US4] Same for projects (`CreateProjectBodySchema` / `UpdateProjectBodySchema`, `POST /api/v1/admin/projects`, `PATCH …/:id`) in `packages/modules/projects/src/manifest.ts`
- [X] T032 [P] [US4] Same for tasks (`CreateTaskBodySchema` / `UpdateTaskBodySchema`, `POST /api/v1/admin/tasks`, `PATCH /api/v1/admin/tasks/:id`) in `packages/modules/tasks/src/manifest.ts`
- [X] T033 [P] [US4] Export the `customer` `values` declaration (`PATCH /api/v1/admin/customers/:id/custom-fields`, `customFieldValuesSchema`) from `packages/modules/customers/src/manifest.ts`
- [X] T034 Run `pnpm --filter backend run manifests:generate`; if any module `package.json` changed, run `pnpm install --lockfile-only` and stage `pnpm-lock.yaml`; confirm `pnpm --filter backend run manifests:check`; write `.changeset/175-host-declarations.md` (`@endora-commerce/mod-crm`, `mod-projects`, `mod-tasks`, `mod-customers`: patch — `customFieldWrites` export)

---

## Phase 6: WP-2 — admin panel and definition editor (`@endora-commerce/admin-kit`, `custom_fields` admin)

**Goal**: admin access in the panel (US5) and the two new definition options (US2). Depends on WP-0;
end-to-end needs WP-1.

- [X] T035 [P] [US5] Extend `admin/test/kit/kit-custom-field-values.test.tsx` with failing cases: `read` renders value without an input, `hidden` not rendered, the bag passed to `save` and to `onChange` contains only `edit` keys (and a stored `read` value is absent from it), a 422 entry for a non-`edit` key renders "<label> (<level>) … Custom fields screen", all-hidden renders nothing
- [X] T036 [P] [US2] [US5] Write failing test `admin/test/modules/custom_fields/definition-form-customer-input.test.tsx`: the registration option shows only when `entityTypeInfo.customerInputSurfaces` is non-empty, is disabled with a reason for `internal` audience and `page_builder`; the admin-access select exists for every type with its help sentence; `read`/`hidden` disabled while required (and vice versa); list badges "Registration", "Read-only", "Hidden"; the draft sends `customerInput`/`adminAccess`
- [X] T037 [US5] Implement admin access in `packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx` (project the outgoing bag to `edit` keys at `:143` and in `set`/`onChange`; read-only rendering; refusal message); add the panel strings under `customFields.*` in `packages/modules/_i18n/i18n/en.json` and `pl.json` — makes T035 green
- [X] T038 [US2] [US5] Implement the options and badges in `packages/modules/custom_fields/src/admin/components/DefinitionBehaviourFields.tsx`, `DefinitionForm.tsx`, `packages/modules/custom_fields/src/admin/lib/definition-draft.ts`, `packages/modules/custom_fields/src/admin/pages/CustomFieldsPage.tsx` and `packages/modules/custom_fields/src/admin/api/custom-fields-client.ts`; strings in `packages/modules/custom_fields/i18n/{en,pl}.json` — makes T036 green
- [X] T039 [US5] Verify the admin-access selector also reaches catalog attributes (host-managed `product` definitions edited on `/catalog/attributes` through the apply seam): write a failing `admin/test/modules/catalog/AttributesManager.admin-access.test.tsx` (modelled on the existing `AttributesManager.page-builder.test.tsx`), then wire the field in the catalog attribute editor under `packages/modules/catalog/src/admin/`
- [X] T040 Run `pnpm --filter backend run i18n:hardcoded` (no new finding) and write `.changeset/175-admin-kit-admin-access.md` (`@endora-commerce/admin-kit`: minor — the bag handed to `save`/`onChange` carries `edit` keys only; `read`/`hidden` rendering)

---

## Phase 7: WP-4 — `organizations` (registration + admin creates) — MVP core

**Goal**: US1 + US3 end to end on the API; US4 for Organization and member creates. Depends on WP-1,
WP-3 (WP-2 for the screens).
**Independent test**: T041 + T042 green; `register.test.ts` unchanged and green.

- [X] T041 [P] [US1] [US3] Write failing unit test `packages/modules/organizations/src/backend/services/registration-service.custom-fields.test.ts` with stub ports: both groups validated before any `em.create` (call-order spy); refusals of both groups merged into one 422 with `organization.`/`firstUser.` prefixes; Organization created with `customFieldValues`; `accounts.write.create` receives the person bag; audit `organization.register` carries `customFieldKeys` and no value; port absent + values → `not_open_for_input` per key; port absent + no values → unchanged behaviour
- [X] T042 [P] [US1] [US3] Write failing contract test `backend/test/contract/organizations/register-custom-fields.contract.test.ts`: US1 scenarios 1, 2, 4, 5, 7; US3 scenarios 1–7 (including a `hidden` closed field); for each refusal zero Organizations, accounts and channel bindings (SC-002); one closed-field attempt per value type and per entity type (SC-003); the body must name `organization.register` and `not_open_for_input` (it is the buyer-input declaration's `test`)
- [X] T043 [P] [US4] Write failing contract test `backend/test/contract/organizations/admin-create-custom-fields.contract.test.ts`: `POST /api/v1/admin/organizations` and `POST /api/v1/admin/organizations/:id/members` store values, refuse a missing required field creating nothing, carry values in the audit row; the admin create applies the administrator's rules (an internal, non-open field is accepted there) while registration refuses it (FR-023)
- [X] T044 [US1] [US3] Implement research R-5 in `packages/modules/organizations/src/backend/services/registration-service.ts` (validation before `em.create` at `:173`; `customFieldValues` on the Organization and in `accounts.write.create` at `:213`; `customFieldKeys` in the audit entry) — makes T041 and T042 green
- [X] T045 [US4] Implement the two admin creates in `packages/modules/organizations/src/backend/routes.admin.ts` (`POST /api/v1/admin/organizations` at `:531`: `validateAndMerge('organization', {}, values)` inside the creating command; `POST …/members` at `:787`: validate `customer` values before `accounts.write.create`) and the service the create route calls — makes T043 green
- [X] T046 [P] [US4] Write failing admin tests `admin/test/modules/organizations/organization-create-custom-fields.test.tsx` and `admin/test/modules/organizations/member-direct-create-custom-fields.test.tsx`: the embedded panel renders, its bag is sent as `customFieldValues`, 422 entries map to `fieldErrors`
- [X] T047 [US4] Add the embedded `CustomFieldValuesPanel` to `packages/modules/organizations/src/admin/pages/OrganizationCreate.tsx` and to the member direct-create dialog in `packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx` (the `POST …/members` call at `:260`) — makes T046 green
- [X] T048 [US4] Export `customFieldWrites` from `packages/modules/organizations/src/manifest.ts`: organization create/update, customer create (`adminDirectMemberToRoleRequestSchema`), invitation exemption with its reason, and two `buyer-input` entries (`organization` at `organization.customFieldValues`, `customer` at `firstUser.customFieldValues`, `test: backend/test/contract/organizations/register-custom-fields.contract.test.ts`)
- [X] T049 Write `.changeset/175-organizations-custom-field-values.md` (`@endora-commerce/mod-organizations`: minor)

**Checkpoint — MVP (API)**: an operator can open fields and a registration stores them; refusals create nothing.

---

## Phase 8: WP-5 — `catalog` (category create) [parallel with WP-6, WP-7]

- [X] T050 [P] [US4] Write failing contract test `backend/test/contract/catalog/admin-category-create-custom-fields.contract.test.ts`: values stored on create, required refused with nothing created, audit carries values
- [X] T051 [P] [US4] Write failing admin test `admin/test/modules/catalog/category-custom-fields.test.tsx`: category create and edit show the panel and send `customFieldValues`
- [X] T052 [US4] Validate and assign values inside the create in `packages/modules/catalog/src/backend/services/category-admin.service.ts:222` (and the `POST /api/v1/admin/catalog/categories` handler in `packages/modules/catalog/src/backend/routes.admin.ts:1213` if it narrows the body) — makes T050 green
- [X] T053 [US4] Add the panel (embedded on create, saving on edit through `PATCH …/categories/:id`) to the category form in `packages/modules/catalog/src/admin/pages/CategoriesTree.tsx` / `CategoryContentPage.tsx` — makes T051 green
- [X] T054 [US4] Export `customFieldWrites` from `packages/modules/catalog/src/manifest.ts`: category create/update; `product` create and update exempt ("host-managed: values are catalog attribute values written by the catalog's attribute surfaces")
- [X] T055 Write `.changeset/175-catalog-category-create-values.md` (`@endora-commerce/mod-catalog`: minor)

---

## Phase 9: WP-6 — `orders` (admin order create) [parallel with WP-5, WP-7]

- [X] T056 [P] [US4] Write failing contract test `backend/test/contract/orders/admin-create-custom-fields.contract.test.ts` (values stored, required refused with no order, audit carries values)
- [X] T057 [P] [US4] Write failing admin test `admin/test/modules/orders/order-create-custom-fields.test.tsx`
- [X] T058 [US4] Validate and assign values in `packages/modules/orders/src/backend/services/order-creation-admin-service.ts` inside its create command — makes T056 green
- [X] T059 [US4] Add the embedded panel to `packages/modules/orders/src/admin/pages/OrderCreatePage.tsx` — makes T057 green
- [X] T060 [US4] Export `customFieldWrites` (create `POST /api/v1/admin/orders`; values `PATCH /api/v1/admin/orders/:id/custom-fields`) from `packages/modules/orders/src/manifest.ts`
- [X] T061 Write `.changeset/175-orders-admin-create-values.md` (`@endora-commerce/mod-orders`: minor)

---

## Phase 10: WP-7 — `quote_requests` (admin create on behalf) [parallel with WP-5, WP-6]

- [X] T062 [P] [US4] Write failing contract test `backend/test/contract/quote_requests/admin-create-custom-fields.contract.test.ts`: values stored, required refused, audit; with `quote_requests` switched off the create answers as absent (US4 scenario 4)
- [X] T063 [P] [US4] Write failing admin test `admin/test/modules/quote_requests/rfq-create-custom-fields.test.tsx`
- [X] T064 [US4] Validate and assign values in `createOnBehalf` in `packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts` — makes T062 green
- [X] T065 [US4] Add the embedded panel to `packages/modules/quote_requests/src/admin/pages/RfqCreatePage.tsx` — makes T063 green
- [X] T066 [US4] Export `customFieldWrites` (create `POST /api/v1/admin/quote-requests`; update `PATCH …/:id` `adminPatchQuoteRequestSchema`) from `packages/modules/quote_requests/src/manifest.ts`
- [X] T067 Write `.changeset/175-quote-requests-admin-create-values.md` (`@endora-commerce/mod-quote-requests`: minor)

---

## Phase 11: WP-10 — reference storefront (US1)

**Goal**: the registration form renders open fields generically and round-trips them (FR-031 – FR-033).
Depends on WP-1, WP-4.

- [X] T068 [P] [US1] Write failing test `storefront/test/register-custom-fields.test.tsx`: each value type renders with an accessible label and required marker in the right section; unticked boolean submits `false`; a failed field read renders the plain form; a refused submission returns every value but the password, including both groups, with per-field errors placed by the `organization.`/`firstUser.` prefix, and nothing in the URL
- [X] T069 [US1] Create `storefront/lib/api/custom-field-input.ts` (`apiGet` of `/api/v1/custom-fields/input-surfaces/organization.register`, `revalidate: 300`, tag `custom-fields:input-surface:organization.register`, `safeParse`, fail-closed)
- [X] T070 [US1] Create `storefront/components/auth/CustomFieldInputs.tsx` (research R-10 control per value type; names `cf.organization.<key>` / `cf.customer.<key>`)
- [X] T071 [US1] Wire it: fetch in `storefront/app/(auth)/register/page.tsx`, render both sections in `storefront/components/auth/RegisterForm.tsx`, parse the groups and map refusals in `registerFormAction` in `storefront/app/(auth)/register/actions.ts:62` (extend the `useActionState` state) — makes T068 green
- [X] T072 [US1] Add en + pl strings for the section headings and the two value codes to `storefront/lib/i18n/messages/auth.ts`; run `pnpm --filter backend run i18n:hardcoded` (storefront ledger unchanged)

---

## Phase 12: WP-9 — check estate: `check:custom-field-writes` (lands last)

**Goal**: FR-043 – FR-045; US4 scenario 7 within the owner-accepted scope (declared collection path or
its `/:id` only). Red proofs can be written from WP-0 on; the repository run turns green only after
WP-4 – WP-8.

- [X] T073 [P] [US4] Write failing rule tests `packages/cli/test/custom-field-writes-rule.test.ts`, one red proof per finding kind entering at source text / fixture tree: `entity-type-undeclared`, `create-without-values`, `update-without-values`, `declared-route-missing`, `undeclared-write-route`, `exemption-without-reason`, `surface-without-contract`, `surface-without-test`, `computed-declaration`; plus a clean fixture
- [X] T074 [US4] Implement the rule in `packages/cli/src/rules/custom-field-writes.ts` (literal-AST read of `customFieldWrites`, route reconstruction reused from `packages/cli/src/rules/action-route-permissions.ts`, Zod introspection of the built contracts, printed exemptions) — makes T073 green
- [X] T075 [US4] Write failing spawned test `backend/test/unit/scripts/check-custom-field-writes.test.ts` (exit 0 on the tree, 1 on a fixture finding, 2 on an empty/short walk or unbuilt contracts; one read line)
- [X] T076 [US4] Implement the repository host `backend/scripts/check-custom-field-writes.ts` (module walk roots, `refuseVacuousModulePopulation`, `reportReadSize` with `sources=entity-types:9/9,manifest-index:N/N`) and add `"check:custom-field-writes"` to `backend/package.json` — makes T075 green
- [X] T077 Meet the estate obligations: entry in `backend/test/unit/scripts/check-inventory.test.ts`; estate verdict `package` in `packages/cli/src/check/estate.ts`; row in `specs/conventions/check-inventory.md`; module-walk residue guard in `backend/test/unit/scripts/moved-module-tree.test.ts`; job lines in `.gitlab-ci.yml` (`quality:static`, beside `check:action-route-permissions` at `:492`) and `.github/workflows/quality.yml` (beside `:140`)
  - *2026-11-06*: both CI lines sit in the `quality` job, beside `check:action-route-permissions` — the job that line is in; `quality:static` runs only the two shell checks.
- [X] T078 Record the read size in `backend/test/helpers/check-read-sizes.ts` measured from a **fresh** `git worktree` per `specs/conventions/check-estate.md` (never from this checkout; leave other entries' drift alone); run `pnpm --filter backend exec vitest run test/unit/scripts/check-read-size.test.ts test/unit/scripts/check-inventory.test.ts`
- [X] T079 Write `.changeset/175-cli-custom-field-writes-rule.md` (`@endora-commerce/cli`: minor — new rule in `endora check`)

---

## Phase 13: WP-11 — governance, documentation, release intent

- [X] T080 Write `specs/conventions/custom-field-writes.md` — the one home of the rules: admin parity (FR-015, SD-1, declaring every admin create/update in `customFieldWrites`, exemptions with reasons, the check's discovery scope accepted on 2026-11-06), admin access (OD-8, FR-007, SD-2 — not access control), buyer input (OD-1 – OD-4, FR-011 – FR-014, how to add a surface)
- [X] T081 Add one row to the *Where the rest of it lives* table in `AGENTS.md` routing "Adding or changing a custom-field write path — an admin create/update of a custom-field host, a buyer input surface, or admin access" to `specs/conventions/custom-field-writes.md` (pointer only, no restated rule); run `pnpm --filter backend exec vitest run test/unit/docs/agents-router.test.ts`
- [X] T082 [P] [US2] [US5] Update `packages/modules/custom_fields/docs/custom_fields.md` (EN): buyer input and its surface, the audience rule, the limits, admin access with the explicit statement that `read`/`hidden` are a panel convenience and **not access control** (API, filters, export and audit unchanged) (FR-048)
- [X] T083 [P] [US1] [US4] Update `packages/modules/organizations/docs/organizations.md` (EN): registration fields; admin create values; a section for storefronts scaffolded before 175 documenting the FR-029 read, the two registration groups and the refusal shape, with a minimal Server Component example (FR-034, OD-9); no links to sibling module pages or the site tree
- [X] T084 Translate both pages to Polish: update `docs/translation-cache/pl/packages--modules--custom_fields--docs--custom_fields.md.json` and `docs/translation-cache/pl/packages--modules--organizations--docs--organizations.md.json` and the materialised `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/custom_fields.md` and `…/modules/organizations.md` per `docs/docs/contributing/documentation-i18n.md`; run `pnpm --filter backend run check:docs-translations` and `pnpm --filter backend run check:module-docs`
- [X] T085 Release intent: confirm one changeset per meaning exists (T009, T023, T029, T034, T040, T049, T055, T061, T067, T079), none `major`; run `pnpm changeset:status` and `pnpm --filter backend run check:release-intent -- --since origin/master`

---

## Phase 14: Final verification

- [X] T086 Regenerate and confirm every generated artefact is committed: `pnpm --filter backend run composer:generate`, `pnpm --filter backend run manifests:check` (on drift: `manifests:generate` + `pnpm install --lockfile-only`, stage `pnpm-lock.yaml`), `git status` shows no unstaged generated file
- [X] T087 `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm run check:naming && pnpm run check:language`, `pnpm --filter backend run i18n:hardcoded`, `pnpm --filter backend run check:error-translations`, `pnpm --filter backend run check:custom-field-writes`, `pnpm --filter backend run check:port-catches`, `pnpm --filter backend run check:module-boundary`
- [X] T088 Targeted tests: every test file named in T002 – T083, plus the existing `backend/test/contract/organizations/register.test.ts`, `register-registry-lookup.contract.test.ts`, `admin-organization-create.contract.test.ts` and `admin/test/kit/kit-custom-field-values.test.tsx` (FR-026: unchanged behaviour without values)
- [X] T089 `pnpm --filter '!backend' run test` (every package suite, admin and storefront included) and `pnpm --filter backend run test:unit:fast`
- [X] T090 Moved/deleted-file sweep (AGENTS.md traps): `git diff --name-status origin/master -- . | grep -E '^(D|R)'`; for every path listed, `grep -rn '<basename>' backend/test/` and fix any reference; expected result: no deletions or renames in this feature — record that in the hand-off
- [ ] T091 Complete backend suite once before the merge request (D-198: contract/integration do not run pre-merge): `pnpm run dev:infra:test` then `pnpm --filter backend run test`; walk `specs/175-buyer-input-custom-fields/quickstart.md` §1–§4 by hand
  - *2026-11-06*: the complete suite ran against the test database (28 files red, every one red on a clean `origin/master` worktree too or needing Meilisearch on `:7700`, which the test infrastructure did not run). **Open:** the quickstart walk §1–§4 needs the owner's running instance and is not done.

---

## Dependencies & execution order

```text
T001 → WP-0 (T002–T009)
WP-0 → WP-1 (T010–T023) ∥ WP-3 (T024–T029) ∥ WP-8 (T030–T034) ∥ WP-9 tests (T073)
WP-0 → WP-2 (T035–T040)        [end-to-end checks need WP-1]
WP-1 + WP-3 → WP-4 (T041–T049) [screens T046–T047 need WP-2]
WP-1 + WP-2 → WP-5 (T050–T055) ∥ WP-6 (T056–T061) ∥ WP-7 (T062–T067)
WP-1 + WP-4 → WP-10 (T068–T072)
WP-4 … WP-8 → WP-9 green (T074–T079)  — merge last or with all declarations
all → WP-11 (T080–T085) → final verification (T086–T091)
```

Story completion: US2 after WP-1 + WP-2; US3 and US1 (API) after WP-4; US1 (form) after WP-10;
US4 after WP-4 – WP-9; US5 after WP-2; US6 after WP-3.

## Parallel examples

- After WP-0: `T010, T011, T012, T013, T014, T015` (WP-1 tests) ∥ `T024, T025` ∥ `T030 – T033` ∥ `T073`.
- After WP-1 + WP-2: `T050, T051` ∥ `T056, T057` ∥ `T062, T063`, then each WP's implementation in parallel.
- WP-11: `T082 ∥ T083`.

## Implementation strategy

- **MVP slice**: WP-0 → WP-1 → WP-3 → WP-4 (T001 – T049 minus T034, T046 – T047) — buyer input
  through the API with every refusal and the Organization/account writes; then WP-10 for the reference
  form. This delivers US1 – US3 and the owner's original request.
- **Increment 2**: WP-2 (US5 + definition editor for US2) and WP-5 – WP-8 (US4 parity).
- **Increment 3**: WP-9 (check, last) and WP-11 (convention, docs, release intent).
- If split into several merge requests, keep WP-9 out until every declaration is in, so
  `quality:static` is never red on `master`.

## FR → task coverage

| FR | Tasks |
| --- | --- |
| FR-001 – FR-004 | T002, T005, T010, T011, T014, T016 – T019, T022 |
| FR-005 – FR-007 | T002, T005, T011, T016 – T019, T035 – T038 (FR-007: no backend reader — asserted by T043's "internal field accepted on admin path" and T035) |
| FR-008 | T014, T015, T019, T021 |
| FR-009 | T005, T014, T019 |
| FR-010 – FR-014 | T002, T005, T012, T020, T022, T041, T042 |
| FR-015 | T004, T008, T043, T045, T050, T052, T056, T058, T062, T064 |
| FR-016 | T050 – T055 |
| FR-017 | T056 – T061 |
| FR-018 | T003, T006, T043, T045, T047, T048 |
| FR-019 | T062 – T067 |
| FR-020 | T030 – T034 |
| FR-021 | T043, T050, T056, T062 |
| FR-022 – FR-028 | T003, T006, T007, T024, T026, T041 – T045 |
| FR-029, FR-030 | T002, T013, T015, T021 |
| FR-031 – FR-033 | T068 – T072 |
| FR-034 | T083, T084 |
| FR-035, FR-036 | T036, T038, T039 |
| FR-037, FR-038 | T035, T037 |
| FR-039 | T046, T047, T051, T053, T057, T059, T063, T065 |
| FR-040 | T038 (no new permission; existing `custom_fields:write`) — verified by T087's typecheck of manifests and T036 |
| FR-041, FR-042 | T025, T027, T028 |
| FR-043 – FR-045 | T048, T054, T060, T066, T030 – T033, T073 – T078 |
| FR-046 | T080, T081 |
| FR-047 | T022, T037, T038, T072, T040 |
| FR-048 | T082 – T084 |

Every FR maps to at least one task. SC-001 (zero-code collection on a scaffolded instance) is verified
by hand in T091 via the quickstart, not by an automated test.
