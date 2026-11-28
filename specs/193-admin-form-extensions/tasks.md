# Tasks: Admin form extensions (193)

**Input**: `plan.md` (work packages and phases), `spec.md` (FR-001 – FR-127, D-300), `contracts/`.
**Tests first (Principle III).** In each work package, the tasks marked **[T]** are red tests. Write
each one, watch it fail, and then do the implementation tasks after it. `[P]` marks a task that can
run in parallel with others in the same phase (different files). Each work package is one merge
request, unless it says otherwise. Run `pnpm run build:packages` before running any test.
Regenerate artefacts (`composer:generate`, `manifests:generate`, `pnpm install --lockfile-only`) in
the merge request that changes their inputs.

## Phase 1: Hookable writers and contracts (H1, H2, H3, A run in parallel)

### WP-H1 `customer_accounts` (FR-110, FR-114, `contracts/hookable-writers.md` §1)
- [ ] T001 [T][P] `packages/contracts/src/customer-account-hooks.test.ts`: refs, action strings, phases.
- [ ] T002 [T][P] In `customer_accounts`' command tests, `expectHookableCommand` for `customer_account.create`, `customer_account.update_profile` and `customer.custom_fields.update`. Also a test proving that none of the three is reversible.
- [ ] T003 [T][P] Port test: `customerAccountCommandPort` forwards `options.extensions`, and an unclaimed key answers 422 `COMMAND_EXTENSION_UNCLAIMED`.
- [ ] T004 Add `packages/contracts/src/customer-account-hooks.ts` and export it from the barrel.
- [ ] T005 Add `hookData` and `outboxData` on the three Commands. Add the manifest `hookableActions`, the port `options`, and a changeset.

### WP-H2 `crm` (FR-111, FR-114, §2)
- [ ] T006 [T][P] Add `opportunity-hooks.test.ts`, the `expectHookableCommand` tests for `crm.opportunity.create` and `.update`, a test proving both are not reversible, and the port forwarding test.
- [ ] T007 Add `opportunity-hooks.ts`, the Command data, the manifest entries, `opportunityCommandPort` options, and a changeset.

### WP-H3 `catalog` (FR-112, FR-113, FR-114, §3)
- [ ] T008 [T][P] Add `product-hooks.test.ts`, and `expectHookableCommand` tests for `product.create`, `product.update`, `product.scoped_values.save` and `product.scoped_values.import`, with per-scope hook data. Add a test proving the four are not reversible.
- [ ] T009 [T][P] Tests that every product write of a bulk edit, inline and queued, runs as `product.bulk_update.item` and never as an action in `PRODUCT_HOOKABLE_ACTIONS`. The tests also cover that the action supplies `ProductUpdateHookData` and emits `product.updated.v1`, that it records the audit state of `product.update`, that a hook registered on it is refused at composition, and that a `product.update` hook runs for neither the bulk edit nor its undo (D-300.8).
- [ ] T010 Add `product-hooks.ts`, the Command data, the manifest entries, `catalogProductCommandPort` options, and a changeset.

### WP-A contracts (FR-001, FR-005, FR-010, FR-020, FR-022, FR-030, FR-040, FR-051, FR-070, FR-083, FR-091)
- [ ] T011 [T][P] Add `packages/contracts/src/admin-forms.test.ts`: the `defineFieldSet` and `defineAdminForm` literal-key types (`expectTypeOf`), and the Zod twins accepting and refusing each shape from `form-field-declaration.md` §1–§3.
- [ ] T012 [T][P] Add `admin-forms.vectors.ts` and condition-evaluator tests covering every operator, `isEmpty` semantics, and the depth and leaf caps.
- [ ] T013 [T][P] Schema tests for `FieldOverrideSchema`, `FieldValidationTighteningSchema`, `InputControlDeclarationSchema`, the `PLATFORM_INPUT_CONTROLS` and `FIELD_FORMATS` shapes, `AdminFieldContributionSchema`, `AdminFieldBehaviour`, and `EffectiveFormsResponseSchema` with `EffectiveTextSchema`.
- [ ] T014 [T][P] `modules.ts` tests for the manifest fields (`fieldSets`, `adminForms`, `formOverrides`, `inputControls`), `formOverrideGrants`, and the `DivergenceKind` members.
- [ ] T015 Implement `admin-forms.ts`. It holds the types, schemas, evaluator, vocabularies, `OPERATOR_KINDS`, `FIELD_RULE_CODES`, the `FormLayoutOverrideSource` port (`Container name:`) and `FORM_LAYOUT_CHANGED_CHANNEL`.
- [ ] T016 Add `AdminContributions.fields`, `.controls` and `.fieldBehaviours` in `admin-contributions.ts`. Add the manifest fields, grants and divergence kinds in `modules.ts`.
- [ ] T017 [P] Add the test-kit `expectFieldSetMatchesSchemas`. Its red test comes first, in `packages/test-kit`.
- [ ] T018 Add a changeset for contracts (additive).

## Phase 2: Platform and check (B and D run in parallel)

### WP-B platform (FR-011 (server half), FR-014, FR-021 – FR-024, FR-033, FR-041 – FR-045, FR-050 – FR-053, FR-060, FR-113, FR-124)
- [ ] T019 [T] `packages/platform/src/forms/seal.test.ts` with one red case per refusal code in `field-overrides.md` §3 and `form-field-declaration.md` §3, including the origin and grant cases (`foreign-override`, `PackageFormOverrideNotGrantedError` and the `InvalidFormOverrideGrantError` causes).
- [ ] T020 [T] `field-rule-check.test.ts` covering:
  - every `FIELD_RULE_CODES` entry;
  - conjunction merging;
  - `requiredWhen`;
  - the actor skip for buyer self-service (D-300.3);
  - `required` checked on create and on writes that change or clear the field only (D-300.4);
  - `writePermission` checked on changed fields only, with the system actor exempt;
  - scoped writers (FR-124);
  - a `ruleCheckOnly` writer;
  - the skip when no rule applies.
- [ ] T021 [T] Hook-runner test: the check runs before every module hook, ignores `commandHookOrder`, raises no `UnorderedCommandHooksError`, and a refusal rolls back with no audit entry and no outbox row.
- [ ] T022 [T] `fieldSlotHook` tests: an absent slice is a no-op; an invalid slice gives `FIELD_SLOT_INPUT_INVALID` with its paths; a write without permission gives `FIELD_WRITE_FORBIDDEN`; `noteAuditChanges` is called.
- [ ] T023 [T] Format validator tests from the shared vectors, plus `ctx.fieldFormats` registration and `format-without-validator`.
- [ ] T024 [T] Contract test for `GET /api/v1/admin/effective-forms` (D-300.9). It covers the response schema, presence filtering, layering core → code → operator through a stub `FormLayoutOverrideSource`, `operatorKinds`, the ETag, and a memo that changes on a presence change and on a `b2b:form-layout:changed` message.
- [ ] T025 Implement `forms/registry.ts`, `seal.ts`, `field-rule-check.ts`, `formats.ts` and `effective-forms.ts`. Add `ctx.fieldSets` and `ctx.fieldFormats` to `ModuleContext`, classify them in `SEAM_CLASSIFICATION` (own surface), and publish `fieldSlotHook` on `./kernel`.
- [ ] T026 T-B6: resolve an API-key actor's scopes for `writePermission`. Write the red test first. If no resolution exists, refuse with a documented code and record that in research R-12.
- [ ] T027 Add the route in `lifecycle/routes.admin.ts`; the `FIELD_RULE_VIOLATION`, `FIELD_WRITE_FORBIDDEN` and `FIELD_SLOT_INPUT_INVALID` codes; the `fieldRules.*` sentences in `_lifecycle`'s `en` and `pl` bundles; and the subscription to `FORM_LAYOUT_CHANGED_CHANNEL`.
- [ ] T028 [P] Add the test-kit `expectFieldSetWriters`, with its red test first.
- [ ] T029 Add a changeset for the platform.

### WP-D CLI and check (FR-002, FR-012, FR-031, FR-070)
- [ ] T030 [T][P] `packages/cli/src/lib/admin-forms.test.ts` with one red case per finding code in `field-slots.md` §6, and a shuffled-registration layout determinism test (SC-005).
- [ ] T031 [T][P] Divergence derivation tests for `form-override` and `form-override-grant`.
- [ ] T032 Implement `admin-forms.ts` and wire it into `endora generate`.
- [ ] T033 Add `backend/scripts/check-admin-forms.ts` and `check:admin-forms`, plus the `check-inventory.test.ts` entry, the `endora check` estate entry (`package`/admin), the `check-read-sizes.ts` band, the companion test, the `quality` job, and the `[admin-forms] read:` line.
- [ ] T034 Add the derivation in `lib/divergence.ts`.

## Phase 3: Read wire and kit (B2 and C)

### WP-B2 admin reads (FR-015)
- [x] T035 [T] `reads.test.ts`: the loader is consulted when `adminReads` is set; omitted when `adminReads` is absent; omitted when the module is off; called once per module; `loader-and-columns-on-one-host` is refused.
- [x] T036 Implement `adminReads` and loader consultation in `schema-extensions/reads.ts`, and pass the loader registry in `compose-app.ts`.

### WP-C admin-kit (FR-004, FR-011, FR-016, FR-032 (client), FR-044, FR-052, FR-061, FR-062)
- [ ] T037 [T] Layout algorithm unit tests (`field-slots.md` §5), shared with T030's vectors.
- [ ] T038 [T] `DeclaredFormSection` tests covering:
  - overrides applied (label from a bundle, and from operator text in the reader's language);
  - hidden and read-only;
  - `visibleWhen`;
  - slots rendered and filtered by presence and permission;
  - a module control falling back when its module is off;
  - client rule errors from the vectors;
  - server `details` mapped by path, including `extensions.<moduleId>.<key>`;
  - submission split into core fields and `extensions`, with hidden and read-only fields omitted;
  - the switched-off slot notice.
- [ ] T039 [T] Accessibility (axe) check of a declared form with slots.
- [ ] T040 Implement `lib/forms/`, `components/declared-form/` and `components/controls/` (platform controls wrapping the existing kit inputs, labels from the `core` bundle), and the effective-forms provider beside `getModulePresence`.
- [ ] T041 Run a read-only check of the paid-modules consumers of the kit and the contracts (`grep ../paid-modules`). This feature only adds API, and nothing is tightened.

## Phase 4: First adopter

### WP-E1 organizations (FR-013, FR-080, FR-081; SC-001, SC-002, SC-004, SC-006)
- [ ] T042 [T] `expectFieldSetMatchesSchemas(ORGANIZATION_FIELD_SET, …)` and `expectFieldSetWriters` for `create`, `admin_patch`, `set_custom_field_values` and `register`. `register` is listed and skipped for buyer actors.
- [ ] T043 [T] Contract tests:
  - `POST` and `PATCH /api/v1/admin/organizations` with `extensions` produce an atomic create with a fixture side row and one audit entry with `changedFields`;
  - an unclaimed key gives 422;
  - `?extensions=` serves an `adminReads` loader;
  - a hidden field is still writable through the API (I-9).
- [ ] T044 [T] Admin tests: the existing `OrganizationCreate` and `OrganizationDetail` tests pass unedited after the render swap.
- [ ] T045 Add `packages/contracts/src/organization-form.ts`, the manifest entries, `ctx.fieldSets`, the body fields, and the render-path swap. Regenerate artefacts.

## Phase 5: Remaining adopters and the operator layer (in parallel)

### WP-E2 projects
- [ ] T046 [T] Field-set, writer and contract tests, including `?extensions=` on the project detail read, and tests showing the existing UI tests are unchanged.
- [ ] T047 Add `project-form.ts`, the manifest, writers, body fields, the read wire, and the swap of the `ProjectCreate.tsx` and detail editable sections.

### WP-E3 customers / customer_accounts (FR-083)
- [ ] T048 [T] Field-set and writer tests for the `customer_account` set (owner `customer_accounts`) and the `customer.edit` form (declared by `customers`), including the dependency check. Contract tests for `PATCH /api/v1/admin/customers/:id/custom-fields` and the profile route with `extensions`. A test that the existing `CustomerDetail` behaviour is unchanged.
- [ ] T049 Add `customer-account-form.ts`, the manifests of both modules, the writers on the H1 actions, the read wire, and the swap.

### WP-E4 crm
- [ ] T050 [T] Field-set, writer and contract tests for the opportunity create and update routes with `extensions`, and a test that the existing UI is unchanged.
- [ ] T051 Add `opportunity-form.ts`, the manifest, writers, the read wire, and the `OpportunityCreatePage.tsx` and detail swap.

### WP-P1 product editor, declare first (FR-120, FR-125, FR-126, `contracts/product-editor-adoption.md`)
- [ ] T052 [T] Record `ProductEditor.adoption-snapshot.test.tsx`: the accessible structure at global, channel and locale scope, recorded against the current editor (green now, held from here on).
- [ ] T053 [T] `expectFieldSetMatchesSchemas(PRODUCT_FIELD_SET)`, plus `expectFieldSetWriters` for the four hookable writers (scoped) and `product.bulk_update.item` as rule-check-only.
- [ ] T054 Add `scripts/check-paid-admin-layers.sh` (read-only typecheck and build of `../paid-modules` PIM admin layers against the built packages; exit 0 with a notice when they are absent). Document running it in the catalog MR template note.
- [ ] T055 Add `product-form.ts` (the keys from §1), the manifest, `ctx.fieldSets`, and the module-local key-to-`fieldPath` map. Make no render change.

### WP-L1 custom_fields operator layer, backend (FR-090 – FR-095, FR-097 – FR-100)
- [ ] T056 [T] Command tests for `custom_fields.form_layout.set`:
  - every `FORM_LAYOUT_OVERRIDE_INVALID` code;
  - `language-missing`;
  - the version conflict 409;
  - reversible undo with a conflict report;
  - audit before and after.
- [ ] T057 [T] `reset` and `rekey` tests: an alias row is rewritten once at boot by a system actor, idempotently; then the `orphaned` and `no-longer-accepted` statuses.
- [ ] T058 [T] Route contract tests for the four routes in `operator-form-layout.md` §2, the permission gates, and the precedence statuses (`code-hidden`, `code-read-only`, `position-fallback`, `owner-absent`).
- [ ] T059 [T] Invalidation test: after commit, the local cache drops, a message is published on `b2b:form-layout:changed`, and a second process's memo changes. A lost subscription is bounded by the TTL.
- [ ] T060 [T] Permission inventory (`custom_fields:forms`), labels in `en` and `pl`, and `check:action-route-permissions` for the new action.
- [ ] T061 Scaffold the migration with `pnpm --filter backend run migration:new`. Add the `@GlobalEntity` entity, the Commands, the routes, the `FormLayoutOverrideSource` provider, the cache and invalidation, the manifest permission and errors, and the i18n entries.

## Phase 6: Product sections, screens, fixture

### WP-P2 to P6 product sections (FR-121, FR-122, FR-124; one MR each, in order: Content, Availability, Identity, Categories, Media)
- [ ] T062 [T] For each section, a test that a label, hidden or read-only override and a slot apply to that section at all three scopes.
- [ ] T063 Swap each section to `DeclaredFormSection` with renderers wrapping `EditorField` (`labelOverride`, `helpOverride`, `presentationReadOnly`), keeping the existing `note` zone mounts.
- [ ] T064 Gate for each MR: T052 snapshots green; `batch-fifteen-surfaces.module-owned-surface.test.tsx` unedited and green; existing catalog editor tests unedited and green; `check-paid-admin-layers.sh` run and recorded.

### WP-P7 product attributes family (FR-123)
- [ ] T065 [T] Tests for a family-member override and anchor (`attributeValues.color`), and a notice when the attribute no longer exists.
- [ ] T066 Adopt `ProductAttributesTab.tsx`, then run the T064 gate.

### WP-L2 operator screen (FR-096; US8)
- [ ] T067 [T] Screen tests:
  - layers shown with their sources;
  - locks with reasons;
  - no hide control on a required field;
  - per-language inputs, and a save refused when a language is missing;
  - reset per layer;
  - read-only without `custom_fields:forms`;
  - one Save session.
- [ ] T068 [T] Palette coverage, bundle-shape and axe tests.
- [ ] T069 Add `FormLayoutPage.tsx`, `FormLayoutEditorPage.tsx`, the routes, the sidebar entry, the `actions.openFormLayout` palette action, and the bundles.

### WP-F platform screen (FR-072; US7)
- [ ] T070 [T] Screen test: switched-off modules are listed, and the origin badge comes from `defineEnumLabels`. Add the palette coverage test.
- [ ] T071 Add `FormExtensionsPage.tsx`, the `_lifecycle` palette action, and its i18n entries.

### WP-G example overlay (US1 – US5; SC-001, SC-002, SC-004)
- [ ] T072 [T] 4-path parity integration test: form, admin API, import row and port, for each fixture rule on organization and one rule on `product.update` and `product.scoped_values.save`.
- [ ] T073 [T] Off-state integration test on the deployment database (template `overlay-notes-fixture-off-state.test.ts`): responses and audit rows byte-identical to bare core; switching back on restores everything.
- [ ] T074 [T] Replacement-pattern test: the core field is hidden, the slot sits in its place, and a projection mismatch is refused.
- [ ] T075 Add `backend/src/apps/example/modules/form_extension_fixture/` with its manifest, side table (migration via `migration:new`), `fieldSlotHook`, overrides, `divergence.ts` reasons, admin layer and bundles.

## Phase 7: Documentation and closure (WP-DOC; FR-073)
- [ ] T076 Add `docs/docs/architecture/admin-form-extensions.md` and its Polish twin. Cover the guide, the trust table, the replacement pattern, the operator layer and the permissions anchor.
- [ ] T077 In `customisation-ladder.md` (en and pl), replace the *Reserved, and deliberately unnumbered* section.
- [ ] T078 Add the contract-surface rows in `specs/conventions/contract-surface.md`. Add a *Form extensions* host-adoption checklist in `module-admin-surfaces.md`.
- [ ] T079 Add the addenda for 178 OD-178-6 (closed) and 187 OR-10 (narrowly reopened by D-300.1). Add the upgrade note (additive), and confirm the constitution 4.6.0 sign-off is recorded.
- [ ] T080 Release verification: `pnpm -r run typecheck`, `pnpm -r run lint`, `pnpm --filter '!backend' run test`, `check:admin-forms`, the permission inventory and palette coverage per deployment, and `workflow_dispatch` of `backend-suite.yml` (D-198).

## Phase 2 ruling follow-ups (D-300.9 to D-300.16, R-24)

These are added to the work package named on each line. WP-D merges before WP-B, because WP-B
imports `applyFieldMoves` from WP-D's contracts change.
- [ ] T081 [T] WP-D: move `formLayout` and its types into `packages/contracts/src/admin-forms.ts` as `formLayout` and `applyFieldMoves`, with code-point comparisons. `FORM_LAYOUT_VECTORS` moves to the contracts test, and the CLI imports the function (D-300.14).
- [ ] T082 [T] WP-D: `required-not-fillable` in `check:admin-forms`, covering a `readOnly` override on an effectively required create-form field with no `fieldBehaviours` entry of the same module on that form (D-300.12). Also: name the cycle members in `unknown-anchor`, and fire `duplicate-slot-key` on disjoint forms when `type` or `writePermission` differ (D-300.15).
- [ ] T083 [T] WP-D: the #2020 contracts fixes, which are `_?` in `inputControlIdRe`, the `defineFieldSet` comment and `formOverrideGrants[].reason` `.max(280)` (D-300.16).
- [ ] T084 [T] WP-B: `Command.buyerSelfService`, inherited through the bus lineage and passed as `FieldRuleCheckContext.buyerSelfService`, with the honour rule of D-300.10.
- [ ] T085 [T] WP-B: `requiredWhen` is held when a field its condition reads changed (D-300.11).
- [ ] T086 [T] WP-B: composition's `required-not-fillable` refuses `hidden` only (D-300.12). `effective-forms.ts` uses `applyFieldMoves` with per-key effective moves (D-300.14). The route moves to `/api/v1/admin/effective-forms` (D-300.9; done). The changeset gets a **Breaking change** paragraph (D-300.13).
- [ ] T087 [T] WP-C: client rules hold the same set as the server on edit forms (D-300.11). A read-only field that a present derivation targets is submitted (D-300.12). The layout comes from the contracts' `formLayout` (D-300.14).
- [ ] T088 [T] WP-E1 and WP-E3: `buyerSelfService` on `organization.register`, on `customer_account.register_standalone`, and on the invitation acceptance through `CustomerAccountMemberWritePort.create`'s new optional input. Add a test that lists every storefront route reaching a field-set writer (D-300.10).
- [ ] T089 [T] WP-L1: an operator `hidden` or `readOnly` on an effectively required create-form field is refused with no exemption (D-300.12).

## Phase 3 ruling follow-ups (D-300.17 to D-300.25, R-25)

These are added to the work package named on each line.
- [ ] T090 [T] (WP-C, #2032) an operator change to a key the kit renders read-only (core or slot) is dropped and warned once per key in development, and a derived or defaulted value is not dropped (D-300.18).
- [ ] T091 [T] (WP-C, #2032) on an edit form a derivation whose `from` field changes and then changes back returns its target to the loaded value, and the submission omits the target (D-300.20).
- [ ] T092 [T] (WP-C, #2032) `GET /api/v1/admin/effective-forms` answers `Cache-Control: private, no-cache` (assert in `routes.admin.forms.test.ts`, `patch` platform changeset), and the route's stale "pending the architect's ruling" note goes (D-300.21).
- [ ] T093 [T] (WP-C, #2032) `flattenExtensions` types a module's value as `Record<string, unknown> | null`, following D-300.24.
- [ ] T094 [T] (WP-L1) `EffectiveSlotOverrideSchema`, `SLOT_OPERATOR_KINDS` and `forms[].slots` in contracts; `formLayout` honours `hidden` for a slot's wire key, keeping its anchor, with a `FORM_LAYOUT_VECTORS` case; `effective-forms.ts` serves slot rows (presence, `no-longer-accepted`, `position-fallback`) and its header is corrected; `custom_fields.form_layout.set` admits slot keys per `operator-form-layout.md` §2, where `before`/`after` wins over `section`; the detail response's `slots` array carries `status` and the `position-fallback` notice; `fieldSlotHook` refuses a schema that does not accept `{}` (D-300.17).
- [ ] T095 [T] (WP-L2) the kit applies `forms[].slots` (label and help in the reader's language only, hidden, position to anchor), and the screen computes `orphaned` for an `active` slot row that no present, permitted slot contribution of the form declares (D-300.17).
- [ ] T096 [T] (WP-B2, #2033) the `columnExtensions` reader passed by `composeApp` and `composeTestServer` throws before `schemaExtensionContextRecorded()`; a `composeTestServer` test refuses a module with `adminReads` columns and an `adminReads` loader on `organizations` (D-300.22, D-300.23).
- [ ] T097 [T] (WP-B2, #2033) `ExtensionAttributesSchema`'s per-module value is `z.record(z.string(), z.json()).nullable()` and `ExtensionAttributeMap` follows; a non-object, non-null `adminReads` loader value fails the read with `EntityExtensionLoaderOutputError`; the `adminReads` doc comment and the contracts changeset say so (D-300.24). `null` for a record with no value stays (D-300.25).

## Phase 4 ruling follow-ups (D-300.26 to D-300.30, R-26)

All five go into WP-E1 (branch `feat/193-e1`) before it merges.
- [ ] T098 [T] (WP-E1) `OrganizationConvertToCompanyHookData.organization` (after-state `OrganizationRecord`), filled by `organization.convert_to_company`, with the outbox data unchanged; `CONVERT_WRITES = ['name', 'registeredAddress', 'vatStatus']`; `name` accepts `validation`; an `expectFieldSetWriters` case and a parity test refusing a tightened `name` on the conversion; an additive contracts changeset (D-300.26).
- [ ] T099 (WP-E1) No code: `organization.update` stays a rule-check-only writer under the widened FR-113 (D-300.27).
- [ ] T100 (WP-E1) The `organization-field-set.ts` header states that the merge's grant, not `writePermission`, governs what a merge copies (D-300.28). WP-DOC repeats it on the permissions section of `admin-form-extensions.md` (en and pl).
- [ ] T101 [T] (WP-E1) `DeclaredFormProvider`'s `form` prop is required; the kit's header example and tests pass it; a test for the mismatch throw (D-300.29).
- [ ] T102 [T] (WP-E1) `composeModuleForTest` mounts an unsealed `FormRegistry` unless `options.formRegistry` is given and exposes it as `formRegistry`; a test-kit test composes a module that calls `ctx.fieldSets`; a `minor` test-kit changeset (D-300.30).

## Dependencies (summary)

```text
H1 ─┐        ┌─ B2 ─┐
H2 ─┤        │      ├─ E1 ─┬─ E2
H3 ─┤  A ─┬─ B ─────┤      ├─ E3 (H1)
    │     │  └─ C ──┘      ├─ E4 (H2)
    │     └─ D             ├─ P1 (H3) ─ P2…P6 ─ P7
    │                      └─ G (E1, P1)
    └──────────────────────  L1 (B) ─ L2 (C) ;  F (B) ;  DOC last
```
