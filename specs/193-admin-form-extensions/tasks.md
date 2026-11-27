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
- [ ] T009 [T][P] A test that `product.bulk_update` supplies `hookData` and stays undeclared as hookable.
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
- [ ] T024 [T] Contract test for `GET /api/v1/admin/forms`. It covers the response schema, presence filtering, layering core → code → operator through a stub `FormLayoutOverrideSource`, `operatorKinds`, the ETag, and a memo that changes on a presence change and on a `b2b:form-layout:changed` message.
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
- [ ] T035 [T] `reads.test.ts`: the loader is consulted when `adminReads` is set; omitted when `adminReads` is absent; omitted when the module is off; called once per module; `loader-and-columns-on-one-host` is refused.
- [ ] T036 Implement `adminReads` and loader consultation in `schema-extensions/reads.ts`, and pass the loader registry in `compose-app.ts`.

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
- [ ] T053 [T] `expectFieldSetMatchesSchemas(PRODUCT_FIELD_SET)`, plus `expectFieldSetWriters` for the four hookable writers (scoped) and `product.bulk_update` as rule-check-only.
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
