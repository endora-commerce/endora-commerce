# Feature Specification: Admin form extensions — field slots, deployment field overrides, control replacement

**Feature Branch**: `spec/193-admin-form-extensions`
**Created**: 2026-11-27
**Status**: Draft, ruled. The owner answered OQ-193-1 to OQ-193-6 on 2026-11-27, recorded as
**D-300** (*Owner rulings* below). The architect rulings are in `research.md` (R-1 to R-26); the
phase 2 rulings D-300.9 to D-300.16 (2026-11-27) and the phase 3 and 4 rulings D-300.17 to
D-300.34 (2026-11-28) are architect rulings too, recorded below. No question is open. The
constitution amendment this feature drafted (XV, 4.6.0) was approved by the owner on 2026-11-27 and
merged in #2007 (Governance step 4).
**Input**: Issue #2006, "Admin form extensions: field slots, deployment field overrides, control
replacement". The owner approved its direction, and the issue compares the approach with Magento 2,
Sylius and Medusa v2.

**Related**:
- `specs/176-command-hooks-outbox/`: `Command.extensions`, `beforeCommit` hooks, `noteAuditChanges`.
- `specs/178-extensible-columns/`: the D2 `?extensions=` admin read wire. Its OD-178-6 deferred the
  HTTP `extensions` body field until "a host form can carry zone-contributed fields". This feature
  is that form.
- `specs/187-side-table-extensions/`: side tables and read-port loaders. Its OR-10 deferred admin
  HTTP reads; D-300.1 reopens it narrowly.
- `specs/188-policy-points/`: the precedent for a per-package, per-point grant.
- `specs/189-command-middleware/`: `contracts/module-origin.md`, the trust tier (D-296).
- `specs/190-overlay-full-modules/`: the overlay admin layer, `contracts/overlay-admin-layer.md`.
- `specs/180-one-save-zone-editors/`: one Save per editor.
- `specs/175-buyer-input-custom-fields/`: a custom field's admin access level, which is a
  presentation setting and not access control.
- Issue #2005, notes as custom-field hosts. It is in progress and independent of this feature (R-16).

## Context

Measured on `origin/master` at `419ffad74` (2026-11-27):

- **Admin extension today is zones only.** `AdminZoneNameSchema` in
  `packages/contracts/src/admin-contributions.ts` is a closed list of places, and each place
  receives a few ids as props. A contribution renders a panel beside the host's form and has no part
  in it. It cannot add an input among the host's fields, take part in the host's validation, or
  change a host field.
- **The only per-field place is `product.editor.field.after`.** `catalog` mounts it beside each
  editable product field (`DetailsTab.tsx`, `ProductEditor.tsx` and `ProductAttributesTab.tsx` under
  `packages/modules/catalog/src/admin/`). The `fieldPath` prop names the field, with one of `name`,
  `description`, `categories`, `gallery`, `attachments` or `attributeValues.<key>`. It adorns a field
  and writes nothing. Four paid PIM modules in `../paid-modules`
  (`pim_akeneo`, `pim_ergonode`, `pim_pimcore`, `pim_unopim`) contribute a protection toggle to it
  and read `fieldPath`. Those strings are therefore field keys already, but no declaration says so.
- **Core forms are hand-written JSX.** `OrganizationCreate.tsx`, for example, holds a
  `<Label>`/`<Input>` pair for each field. No form declares its fields, so nothing can be anchored on
  a field, overridden or checked.
- **Writes already have an extension carrier.** `Command.extensions` (176) reaches the hooks on an
  action, and `columnExtensionHook` (178) writes D2 columns from it. No admin HTTP body carries
  `extensions` yet (OD-178-6). Hookable actions are declared by `organizations`, `projects`,
  `quote_requests`, `promotions`, `newsletter` and `related_payers`. They are not yet declared by
  `catalog`, `customers`, `customer_accounts` or `crm`.
- **Operator-defined fields are a different mechanism.** Runtime custom fields cover them (XIV, D0),
  rendered by `CustomFieldValuesPanel`. Their admin access level (`edit`/`read`/`hidden`) is a
  presentation setting and not access control (`specs/conventions/custom-field-writes.md`). This
  feature keeps that rule for every field it touches.
- **A deployment cannot change what a core form offers.** `customisation-ladder.md` § *Reserved,
  and deliberately unnumbered: contribution overrides* states that nothing of the kind exists.

The need, taken from the issue: a deployment adds a field defined in code at a chosen place in a
core form. It relabels, hides, reorders or tightens a core field. It swaps a field's input control
for a compatible one. It adds masks, derived values and conditional fields. It does all of this
without editing core and without a rule that the UI enforces and the API ignores.

## Owner rulings *(binding; D-300, recorded 2026-11-27)*

- **D-300.1 (OQ-193-1 = A)**: Slot values are read through the host's admin detail read. A
  side-table loader opts in with `adminReads: true`, and the host serves its value on
  `?extensions=<moduleId>`. This narrowly reopens 187 OR-10 for the adopting hosts.
- **D-300.2 (OQ-193-2 = A)**: An installed package may override another module's field only under a
  deployment grant per (field set, package), on 188's terms.
- **D-300.3 (OQ-193-3 = A)**: A tightened rule binds every operator, API-key and system write of the
  entity. It does not bind buyer self-service writes.
- **D-300.4 (OQ-193-4 = A)**: A tightened `required` does not apply retroactively. It is checked on
  create and on any write that changes or clears the field.
- **D-300.5 (OQ-193-5 = C)**: All five hosts adopt in one release: organization, project, customer,
  opportunity and the product editor. The hookable-action declarations that `customer_accounts`,
  `crm` and `catalog` lack are part of this feature, first in dependency order. The product editor is
  a full work package, and its four paid PIM contributors keep working (FR-082).
- **D-300.6 (OQ-193-6 = B)**: Business operators get a run-time screen for presentation overrides
  only: label, help, placeholder, order or section, hidden, and read-only (R-21). Anything that
  changes what the API accepts stays deployment code (XV).
- **D-300.7**: Principle XV is amended to state what a deployment may and may not adjust on a core
  form, and that operator overrides are presentation only (constitution 4.6.0, drafted on #2010's 4.5.0). Approved by the
  owner on 2026-11-27 and merged in #2007.
- **D-300.8** *(architect ruling, 2026-11-27, raised by WP-H3; within 176 §6, so no owner answer is
  needed)*: Each product write of a bulk edit runs as its own action, `product.bulk_update.item`. It
  is never declared hookable and is a rule-check-only writer. Module hooks on `product.update`
  therefore never see a bulk edit, on the inline path or the queued one, and its undo leaves no hook
  state behind. A module that must observe bulk edits and their undo listens to
  `product.updated.v1`, which both emit. An invariant that must bind bulk edits is a field rule.
  The reasoning is in R-22 § *The bulk edit (D-300.8)*.

### Phase 2 architect rulings *(D-300.9 to D-300.16, 2026-11-27, raised by WP-B and WP-D)*

None of these changes an owner answer, so none needs one. D-300.11 extends D-300.4's reasoning to
the other rule kinds and was accepted (owner, 2026-11-27; recorded on #2026). The reasoning and
the rejected alternatives are in R-24.

- **D-300.9** *(architect ruling, raised by WP-B)*: The effective forms are served at
  `GET /api/v1/admin/effective-forms`. `/api/v1/admin/forms` and `/:id` beneath it are the `forms`
  module's form list (`specs/170-forms-module/`), and a second owner of the path refuses the boot
  (`FST_ERR_DUPLICATED_ROUTE`). FR-023 and `contracts/field-overrides.md` §2 are amended (R-24.1).
- **D-300.10** *(architect ruling, raised by WP-B)*: A write is buyer self-service when its actor is
  a customer acting for itself (`kind: 'customer'`, no acting admin), or when it runs as, or below,
  a Command that declares `buyerSelfService: true`. An anonymous storefront request resolves to a
  `system` actor, which the check cannot tell apart from a worker or an integration callback, so
  the storefront's root Command states what it is. The registration Commands and the invitation
  acceptance set it, and every child Command they run (`customer_account.create` included)
  inherits it. The flag is honoured only on an actor with no acting admin whose kind is `system` or
  `customer`. On an admin or API-key actor, and under impersonation, it is ignored. Without the
  flag a `system` actor stays bound (R-24.2). *Amended by D-300.31:* the flag is set per call, by
  the caller that knows it is a buyer, not by the Command type. `createStandalone`'s options and
  `CustomerAccountMemberWritePort.create`'s input carry `buyerSelfService?: true`, and only the
  storefront callers pass it. Server code running as a `system` actor can therefore declare itself
  buyer self-service. The guard stops admin, API-key and impersonated actors only, so the flag is
  a statement that server code makes and review holds it to.
- **D-300.11** *(architect ruling, raised by WP-B)*: D-300.4's non-retroactivity applies to every
  rule kind, not only to `required`. On an update a field is held to its rules only when the write
  changed or cleared it. `requiredWhen` is also held when the write changed a field its condition
  reads. A create holds every field it sets, and `required` on every field. The admin form holds the
  same set (R-24.3).
- **D-300.12** *(architect ruling, raised by WP-B)*: `required-not-fillable` is split by what each
  instrument can see. Composition refuses `hidden` on a field that is effectively required on a
  create form, with no exemption, because a hidden field is never submitted. `check:admin-forms`
  refuses `readOnly` there unless a `fieldBehaviours` entry of the module that sets `readOnly`
  targets the field on that form. The admin form submits a read-only field that a present
  derivation targets. No data flag is added (R-24.4).
- **D-300.13** *(architect ruling, raised by WP-B)*: `ModuleContext.fieldSets` and
  `ModuleContext.fieldFormats` are required members. They ship as `minor`, with a
  **Breaking change** paragraph in the platform changeset, as `entityExtensionLoaders` did (#1835,
  owner ruling on #1983) (R-24.5).
- **D-300.14** *(architect ruling, raised by WP-D)*: The layout algorithm (`contracts/field-slots.md`
  §5) has one implementation, `formLayout` in `@endora-commerce/contracts`, beside
  `evaluateFieldCondition`. Its step 1 is exported on its own as `applyFieldMoves`. The CLI check,
  the platform's effective-forms response and the admin kit all call it. Every comparison in it is
  by code point, never `localeCompare` (R-24.6).
- **D-300.15** *(architect ruling, raised by WP-D)*: WP-D's readings of `contracts/field-slots.md` §6
  are ratified, with two conditions. `unknown-anchor` names the cycle's members when it reports an
  anchor cycle. `duplicate-slot-key` also fires on disjoint forms when the contributions disagree on
  `type` or `writePermission` (R-24.7).
- **D-300.16** *(architect ruling, issue #2020)*: `inputControlIdRe` gains `_?`, the `defineFieldSet`
  comment is corrected, and `formOverrideGrants[].reason` is capped at 280. All three go into WP-D's
  merge request. The declaration-level refusals the spec did not list are kept and are now listed.
  `minLength > maxLength` stays a composition refusal (`override-contradiction`). The CLI reader of
  `formOverrideGrants` is WP-D's and is done (R-24.8).

### Phase 3 architect rulings *(D-300.17 to D-300.25, 2026-11-28, raised by WP-C and WP-B2)*

None of these changes an owner answer, so none needs one. The reasoning and the rejected
alternatives are in R-25.

- **D-300.17** *(architect ruling, raised by WP-C)*: Operator overrides on slot fields stay in scope
  (FR-091). The effective-forms response gains, per form, an optional `slots` array: the operator
  rows on slot keys (`<moduleId>.<key>`) of effectively present modules, carrying `label`, `help`,
  `position` and `hidden`. The kit applies them; `formLayout` honours `hidden` for a slot's wire key
  and keeps its anchor. When a row sets both `section` and `before` or `after`, the `before` or
  `after` wins. In the operator screen's detail response, slot rows have their own array. Their
  `status` and `position-fallback` are the server's, and `orphaned` is the screen's. A slot value is
  never required: `fieldSlotHook` refuses a schema that does not accept `{}`, so hiding a slot
  cannot make a create fail. The contracts, platform and `custom_fields` halves land in WP-L1, the
  kit and screen half in WP-L2. Nothing changes in WP-C (R-25.1).
- **D-300.18** *(architect ruling, raised by WP-C)*: The host's input honours `readOnly`. The kit
  does not wrap a field in `<fieldset disabled>`. The kit drops an operator change to a field it
  renders read-only, so what the form shows is what it submits (R-25.2).
- **D-300.19** *(architect ruling, raised by WP-C)*: The client rules check only what the
  field-rule check checks: the merged tightenings, `requiredWhen`, formats and the integer format.
  The core declaration's `required` and bounds remain the host's own validation, as before it
  adopted. `field-rules.md` §6's "the same effective rules" means exactly this (R-25.3).
- **D-300.20** *(architect ruling, raised by WP-C)*: On an edit form a derivation writes its target
  only while one of its `from` fields differs from its loaded value and the operator has not edited
  the target. When every `from` field is back at its loaded value, the target returns to its loaded
  value. Opening a record never rewrites a stored value. FR-044 and `field-rules.md` §4 are aligned
  (R-25.4).
- **D-300.21** *(architect ruling, raised by WP-C)*: The provider's plain GET is accepted. The
  browser's HTTP cache revalidates against the `ETag`. The route states that explicitly with
  `Cache-Control: private, no-cache`, and the kit never sets `If-None-Match` or a fetch `cache`
  mode itself (R-25.5).
- **D-300.22** *(architect ruling, raised by WP-B2)*: `loader-and-columns-on-one-host` refuses only
  a module whose loader **and** D2 columns both opt into `adminReads` on one host. Those are the
  only two that would answer one `extensions.<moduleId>` key. Columns without `adminReads` beside an
  `adminReads` loader are legitimate (R-25.6).
- **D-300.23** *(architect ruling, raised by WP-B2)*: The refusal stays at loader registration
  (rule L4). The column reader that the composition roots pass to the registry refuses to answer
  before the ORM configuration has recorded its declarations, so a reordering fails loudly instead
  of skipping L4 (R-25.7).
- **D-300.24** *(architect ruling, raised by WP-B2)*: An `adminReads` loader's value is an object
  keyed by field, or `null`. `ExtensionAttributesSchema`'s per-module value becomes
  `record<string, json> | null`, not any JSON value. A loader that answers anything else fails the
  read with `EntityExtensionLoaderOutputError` (R-25.8).
- **D-300.25** *(architect ruling, raised by WP-B2)*: A served module with no value for a record
  answers `null` under its key, as the 187 read ports do. An absent key still means that the module
  is not served there: not requested, not opted in, absent or switched off (R-25.9).

### Phase 4 architect rulings *(D-300.26 to D-300.34, 2026-11-28, raised by WP-E1)*

None of these changes an owner answer, so none needs one. D-300.28 and D-300.31 apply D-300.3 and
constitution 4.6.0 XV ("every write the Command Bus runs for that entity") to writes WP-E1 had left
unregistered. The reasoning and the rejected alternatives are in R-26.

- **D-300.26** *(architect ruling, raised by WP-E1)*: `name` accepts `validation`, as
  `contracts/form-field-declaration.md` §4 shows. `OrganizationConvertToCompanyHookData` gains
  `organization: OrganizationRecord`, the after-state, as `OrganizationUpdateHookData` carries it.
  This amends `specs/176-command-hooks-outbox/contracts/organization-hookable-actions.md` (#1057).
  176 FR-031 limits only the outbox, and hook data is additive-only, so the change is additive.
  The outbox data stays ids, codes and field names. The conversion's writer then projects `name`.
  `taxId` and `registeredAddress` stay presentation only: `taxId` because
  `organization.tax_id.change` carries no tax ID (R-9), and `registeredAddress` because a
  composite admits no tightening. `parentId` and `status` stay presentation only for now, because
  their other writers (the hierarchy moves, moderation) are not registered. Registering them as
  rule-check-only writers (D-300.27) is the route when a case asks for it. This goes into WP-E1
  (R-26.1).
- **D-300.27** *(architect ruling, raised by WP-E1)*: `organization.update`, the integration
  port's write, is a rule-check-only writer, and that is correct. FR-113 is widened: a Command that
  is not a declared hookable action may be a rule-check-only writer whether or not it is
  reversible (R-26.2).
- **D-300.28** *(architect ruling, raised by WP-E1; re-ruled after review)*: A merge is held to
  the survivor's rules, with no exception.
  - `organization.merge.start` becomes a writer of the outcome it fixes. Its hook data gains
    `survivor: { after, changed }`, the survivor's field values after the operator's choices,
    computed by the finalize's own rules. A chosen value that breaks a tightened rule is refused
    at start with `422 FIELD_RULE_VIOLATION`, before anything moves. A changed field whose
    `writePermission` the admin lacks is refused with `403 FIELD_WRITE_FORBIDDEN`. The e-mail
    union is not a choice but is held all the same, with its own remedy.
  - `organization.merge.finalize` becomes a rule-check-only writer, as the backstop. It runs in a
    system scope, so it is held to validation only.
  - The merge screen maps a refusal's `details[].path` onto that field's choice and offers the
    survivor's value.
  - `organizationCommandPort.startMerge` runs with the ambient actor (192 FR-062): an admin is
    held as on the screen, and a system actor is held to validation and, as FR-043 says, not to
    `writePermission`.
  - The up-front lock of a choice the admin may not make is a later improvement, not the control.

  This goes into WP-E1 (R-26.3).
- **D-300.29** *(architect ruling, raised by WP-E1)*: `DeclaredFormProvider` takes a **required**
  `form` prop, the form its `declared` controller was built for, and throws when the ids differ.
  `check:admin-forms` reads that prop. `field-slots.md` §3 now shows the kit's real shape:
  `useDeclaredForm({ form, …, render })` plus `<DeclaredFormProvider form declared>`. This goes
  into WP-E1 (R-26.4).
- **D-300.30** *(architect ruling, raised by WP-E1)*: `composeModuleForTest` mounts an unsealed
  `FormRegistry` by default. It accepts one as an option and exposes it on the composed module, so
  that no adopter's unit test meets the "mounts no form registry" throw. This goes into WP-E1
  (R-26.5).
- **D-300.31** *(architect ruling, raised by the review of WP-E1)*: Personal-organization
  provisioning is held like any other write.
  - Every provisioning path runs one `organizations` Command, `organization.personal.provision`.
    It runs as a child of the caller's Command where there is one, and as a root Command
    otherwise: in the federated sign-in seam (under its system actor) and on the repair and
    detach paths. It is a rule-check-only writer, and it writes `name`, `status`, `vatStatus`,
    `registeredAddress` and `taxId` only, so no rule on another field can refuse it.
  - The storefront registration passes `buyerSelfService` on its `createStandalone` call, and the
    federated seam sets it on its root, so both are skipped (D-300.3, D-300.10 as amended). A
    system `createStandalone` call without the flag, the repair port and the operator's
    detach-to-personal are bound.
  - The writer reports only the derived `name` as what the actor chose. A fixed value is never
    checked against `writePermission`, so an operator's detach is never refused for
    `'vat_exempt'`. Validation still holds every field the writer writes.
  - A field declaration gains `systemValues`: the fixed values a system path writes (`vatStatus`
    `'vat_exempt'`). Composition refuses a tightening that rejects one
    (`rule-excludes-system-value`). With the writer's narrow `writes`, no deployment rule can
    refuse a provisioning on a value it did not derive from the person.

  This goes into WP-E1 (R-26.6).
- **D-300.32** *(architect ruling, raised by the review of WP-E1)*: Anonymisation is an erasure.
  It runs outside the Command Bus and is held to no rule, so XV's MUST does not reach it and erasure
  can never be refused. That rests on an existing Principle XIII deviation: the scrub writes and
  audits outside the bus under a `command-coverage-ignore` category the escape-hatch list does not
  recognise. The deviation is tracked in #2039, together with the owner question it raises. A
  scrubbed row that breaks a later rule is tolerated, as any stored value is (D-300.4). Moving the
  scrub onto the bus, as XIII requires, needs that owner decision first, and it must keep erasure
  unrefusable. No code change (R-26.7).
- **D-300.33** *(architect ruling, raised by WP-E1's implementation)*: The federated sign-in seam is
  now a Command, `customer_account.register_social`. It declares `buyerSelfService` and runs
  `organization.personal.provision` as its child. This is ratified as D-300.31's first branch (a
  child where there is a caller Command), and the seam is no longer a write outside the bus. The
  action is already listed in `customer_accounts`' manifest `buyerSelfServiceActions`, and nothing
  more is declared. It joins the D-300.10 roots in `contracts/hookable-writers.md` §1 and the T088
  inventory. Like `register_standalone`, it writes the `customer_account` record itself, so WP-E3
  registers both registration Commands as writers of the `customer_account` field set (R-26.8).
- **D-300.34** *(architect ruling, raised by WP-E1's implementation)*:
  `PersonalOrganizationService.provisionFor(em, input)` is removed. A public method that writes an
  Organization with no rule check and no audit is a standing XIII trap, whatever its comment says.
  The tests that used it run `provisionCommand(input, { child: true }).run({ em })` through a
  module-local helper beside them that the package does not export. This goes into WP-E1 (R-26.8).

## User Scenarios & Testing *(mandatory)*

### User Story 1: A module adds its own field to a core form (Priority: P1)

A module author, whether a core module, an installed package or a deployment's overlay module,
contributes a field to the organization form, for example an "ERP customer number" placed after the
tax ID. The value is stored in the module's own side table and saved by the form's one Save, in the
same transaction as the organization.

**Why this priority**: This is the most common request, and the other stories build on its
machinery: declared field keys, the layout engine and the `extensions` write path.

**Independent Test**: A fixture overlay contributes one slot field to `organization.edit` and
`organization.create`. An operator creates an organization with the field filled and then edits
it. The side-table row exists after create, the audit entry lists the field name, and switching the
module off removes the field without changing anything else.

**Acceptance Scenarios**:

1. **Given** a module that declares a slot anchored `after: taxId` on the organization field set and
   a `beforeCommit` hook on `organization.create` and `organization.admin_patch`, **When** an
   operator opens the create form, **Then** the field renders directly after the tax ID, with its
   label taken from the contributing module's own bundle.
2. **Given** that form filled in, **When** the operator saves, **Then** one request carries the core
   fields and `extensions.<moduleId>`, one Command writes the organization and the side-table row,
   and one audit entry records `extensions.<moduleId>.changedFields`.
3. **Given** a value the module's schema refuses, **When** the operator saves, **Then** nothing is
   written, and the error appears on the slot field.
4. **Given** the contributing module is switched off, **When** any operator opens the form, **Then**
   the field is absent, the request carries no `extensions.<moduleId>`, and the organization's
   create, update, response and audit entry are byte-identical to a deployment without the module.
5. **Given** two modules anchored `after: taxId` with the same weight, **When** the form renders,
   **Then** the order is the documented tie-break (module id, then field key) on every render and
   every process, and the form-extension check reports the pair as `ambiguous-slot-order`.
6. **Given** a slot anchored on a key the field set does not declare, **When** the admin build or
   `endora generate` runs, **Then** it refuses with `unknown-anchor`, naming the field set, the key and
   the declared keys.

---

### User Story 2: A deployment adapts a core field within what the field accepts (Priority: P1)

A deployment's overlay module relabels "Tax ID" to "NIP", adds help text, moves "Parent
organization" into another section, hides an optional field it never uses, and makes an optional
phone field required with at most 20 characters.

**Why this priority**: It is the second half of the issue's core need. Without it, field slots
leave every core field as it is.

**Independent Test**: The fixture overlay declares five overrides on the organization field set.
The form renders them. An API `PATCH` that breaks the tightened rule is refused with the same field
error the form shows. Switching the overlay module off restores the core form and the core rules.

**Acceptance Scenarios**:

1. **Given** an override `label` on `taxId` whose key is in the overlay's own bundle in `en` and
   `pl`, **When** an operator opens either organization form, **Then** the label is the overlay's
   text in the operator's language.
2. **Given** an override `hidden` on a field the field set declares required, **When** the platform
   composes, **Then** composition is refused with `hidden-required-field`, naming the field set, the
   field and the module.
3. **Given** an override of a kind the field does not list in `accepts`, **When** the platform
   composes, **Then** composition is refused with `override-not-accepted`, listing what the field
   accepts.
4. **Given** a tightened rule `required` plus `maxLength: 20` on an optional field, **When** an
   operator saves the form without it, a script calls the admin API without it, an import row lacks
   it, or a port call omits it, **Then** each is refused with `422 FIELD_RULE_VIOLATION`, naming the
   field, in the caller's language, and nothing is written.
5. **Given** an override that loosens a core rule, such as a `maxLength` above the core maximum or an
   option outside the core enum, **When** the platform composes, **Then** it is refused with
   `override-loosens-rule`.
6. **Given** two modules of one deployment overriding the `label` of one field, **When** the platform
   composes, **Then** it is refused with `override-conflict`, naming both. Two tightened validation
   rules on one field compose by conjunction, and a pair that no value can satisfy is refused with
   `override-contradiction`.
7. **Given** a `hidden` or `readOnly` override, **When** an API caller writes that field, **Then** the
   write is accepted exactly as core accepts it. Hiding and read-only are presentation and never
   access control (FR-062).

---

### User Story 3: A deployment replaces a field's input control (Priority: P2)

A deployment renders a customer's phone with the platform's `tel` control and a contact address with
`email`. It also tries to put a `number` control on a string field.

**Why this priority**: The value is high and the cost is low once overrides exist. It is a P2
because the field must accept the `control` override first.

**Independent Test**: Overrides `control: 'platform.tel'` on a string field and `control:
'platform.number'` on another string field. The first renders and enforces the `tel` format on the
server. The second is refused at composition.

**Acceptance Scenarios**:

1. **Given** a string field that accepts `control`, **When** a deployment overrides it with
   `platform.email`, **Then** the form renders the e-mail control, and every write path refuses a
   value that is not an e-mail address with `422 FIELD_RULE_VIOLATION` (code `format`).
2. **Given** a string field, **When** a deployment overrides it with `platform.number`, **Then**
   composition is refused with `control-type-mismatch`, naming the control's output type and the
   field's value type.
3. **Given** a control a module contributes, declared with an output type and a format that its
   backend registers a validator for, **When** a deployment selects it, **Then** it renders, and the
   server enforces the format. A control that claims a format no validator is registered for is
   refused at composition with `format-without-validator`.
4. **Given** the module that contributes a selected control is switched off, **Then** the field falls
   back to its core control, and the format that control implied is no longer enforced. The override
   behaves as if the module were not installed.

---

### User Story 4: Field behaviour holds on every write path (Priority: P2)

A deployment masks a postal code as `NN-NNN`, pre-fills a field from another field, shows "Reason"
only when status is `blocked`, and makes "Reason" required in that case.

**Why this priority**: Behaviour without a server counterpart creates the drift the issue
criticises in Magento and Sylius. The rule that it must hold on the server is the point of the story.

**Independent Test**: The overlay declares a `requiredWhen` rule on a core field and a mask on
another. An API write that breaks `requiredWhen` is refused, and the masked value is stored as the
control emitted it.

**Acceptance Scenarios**:

1. **Given** `visibleWhen: { field: 'status', op: 'equals', value: 'blocked' }`, **When** status is
   anything else, **Then** the field is not rendered, and its value is not sent, so the stored value
   is kept.
2. **Given** `requiredWhen` with the same condition, **When** any write path saves `status: blocked`
   without the field, **Then** it is refused with `FIELD_RULE_VIOLATION` (code `required`). The form
   evaluates the same condition with the same evaluator and shows the error before it submits.
3. **Given** a derivation that pre-fills field B from field A, **When** the operator has not edited
   B, **Then** B follows A in the form. The server does not recompute B. A derivation is a suggestion
   and not an invariant (R-11). An invariant is a validation rule.
4. **Given** a mask with an accompanying `pattern`, **When** an import writes a value that breaks
   the pattern, **Then** it is refused. A mask without a `pattern` constrains the UI only, and the
   override declaration says so (FR-044).

---

### User Story 5: A deployment changes a core field's value type through the replacement pattern (Priority: P2)

A deployment needs a core field's value as a structured value, for example a free-text "Industry"
as a select from the deployment's own list, or a single text as two parts. It follows the documented
**field replacement pattern** (`contracts/field-replacement-pattern.md`). It does not change the
core type.

**Why this priority**: It closes the most common reason for forking a core form. The cost is
documentation and a worked example. It needs no new mechanism.

**Independent Test**: The example overlay applies the pattern to one optional core string field.
The core field is hidden. The new field is slotted where the core field was and stored in the
overlay's side table. The core field is filled with a compatible projection, so core search and
export keep working. An API write whose projection disagrees with the new value is refused.

**Acceptance Scenarios**:

1. **Given** the pattern applied, **When** an operator edits the record, **Then** they see one field,
   the new one, in the core field's place.
2. **Given** the projection option, **When** the record is saved, **Then** the core field holds the
   projection of the new value, in the same Command. The overlay's `beforeCommit` hook refuses a
   write whose core value disagrees with the projection, so an API caller that writes only one of
   the two is told so.
3. **Given** a required core field, **When** a deployment tries the pattern, **Then** `hidden` is
   refused (FR-021). The guide shows the required-field variant instead: the core field is read-only
   and derived from the new field, and it is not hidden.

---

### User Story 6: Who may do what is enforced, not documented (Priority: P1)

A core module may contribute fields only to its own forms or by an owner's invitation, which the
field set is. An installed package may contribute slot fields, and it may override another module's
field only under a deployment grant (D-300.2). A deployment may override any core field within
`accepts`. A field may require a write permission, which the server enforces.

**Why this priority**: The trust tiers are what make US1 to US5 safe to offer at all.

**Acceptance Scenarios**:

1. **Given** an installed package that declares `formOverrides`, **When** the deployment's
   `divergence.ts` grants it no override on that field set, **Then** composition is refused with
   `PackageFormOverrideNotGrantedError`, naming the package, the field set and the grant field.
2. **Given** a core module that declares an override on another module's field set, **When** the
   platform composes, **Then** it is refused with `foreign-override`. Core changes another core
   module's form by editing the owner, never by overriding it.
3. **Given** a field with `writePermission: 'customers:credit'`, **When** an admin without that code
   changes the field through the form, the API or an import, **Then** the write is refused with
   `403 FIELD_WRITE_FORBIDDEN`, naming the field. The form renders that field read-only for that
   admin. An unchanged value in the same request is not a refusal.
4. **Given** the deployment's overrides, **When** the divergence report is generated, **Then** it
   lists each override with the module that declared it, the field it targets, its kind and the
   deployment's reason.

---

### User Story 7: An operator can see how a deployment changed a form (Priority: P3)

A platform administrator opens *Platform → Form extensions* and sees, for each declared form, its
fields, the active overrides with their module and origin, and the slot fields with their module.
A module that is switched off shows as "switched off".

**Acceptance Scenarios**:

1. **Given** `platform.modules.read`, **When** the administrator opens the screen from the sidebar
   or with ⌘K "Form extensions", **Then** it lists every declared form, read-only.
2. **Given** a module that declares an override and is switched off, **Then** its override is listed
   as switched off, and the form renders without it.

---

### User Story 8: A business operator adjusts a form's presentation at run time (Priority: P2)

An administrator holding `custom_fields:forms` opens *Custom fields → Form layout*, picks
"Organization: edit", relabels "Tax ID" in English and Polish, moves "Parent organization" into
another section, hides an unused optional field, and marks a field read-only. No deploy is needed.
Each change is an audited Command and can be undone.

**Why this priority**: D-300.6. It lets the business tune a form without a developer. It is a P2
because the mechanism (US1, US2) has to exist first.

**Independent Test**: Through the screen, relabel, move, hide and set read-only on four fields of
`organization.edit`. The form shows the changes in every running process within the invalidation
bound. An API write to the hidden and the read-only field is accepted unchanged. Undoing the Command
restores the previous layout.

**Acceptance Scenarios**:

1. **Given** a field whose `accepts` lists `label`, **When** the operator saves a relabel, **Then** the
   form shows it in the operator's language. A relabel MUST carry text for every supported admin
   language. The screen refuses to save with one language missing.
2. **Given** a field that core declares required, **Then** the screen offers no *Hide* control. A
   request that tries anyway is refused with `422 FORM_LAYOUT_OVERRIDE_INVALID` (code
   `hidden-required-field`).
3. **Given** a deployment-code override that already sets the label, **When** the operator opens the
   field, **Then** the screen shows the code value as the current default, names the deployment module
   that set it, and lets the operator override it. *Reset* returns to the code value, not to core.
4. **Given** a deployment-code override that hides a field, **Then** the screen shows the field as
   hidden by the deployment, and the operator cannot unhide it.
5. **Given** a field that does not accept `position`, **Then** the field cannot be dragged.
6. **Given** an operator without `custom_fields:forms`, **Then** the screen is read-only. The write
   routes answer `403`, and the palette action "Form layout" is hidden.
7. **Given** an operator override on a field whose host module is switched off, **Then** the screen
   lists the override as belonging to a switched-off module and keeps it. Switching the module back
   on restores it.
8. **Given** an operator override on a key that the owner renamed (an alias), **Then** at the next
   boot the platform rewrites the override to the live key with an audited system Command. After the
   alias is removed, a row that still names it is shown as orphaned, ignored by the form, and can be
   deleted.

---

### User Story 9: Every adopted host declares its writers (Priority: P1)

`customer_accounts`, `crm` and `catalog` publish hookable actions for the Commands that write their
field sets. Field-rule checks and slot hooks can then reach every write path, as they do for
`organizations` and `projects` (D-300.5, FR-110).

**Acceptance Scenarios**:

1. **Given** the published refs, **When** a module registers a `beforeCommit` hook on
   `customer_account.update_profile`, `crm.opportunity.update` or `product.update`, **Then** it runs
   inside the Command and can veto the write, under 176's semantics.
2. **Given** a write that a stored-revert undo reverses, for example each product write of a product
   bulk edit, **Then** it runs under its own action, which is not hookable (176 §6). That action is
   registered as a **rule-check-only writer**, so a tightened rule still binds it, while module and
   slot hooks cannot attach to it (FR-113, D-300.8).
3. **Given** a module with a `beforeCommit` or `afterCommit` hook on `product.update`, **When** an
   operator bulk-edits products and then undoes the edit, **Then** the hook runs for neither. Each
   product write and each undone product emits `product.updated.v1` (D-300.8).

---

### User Story 10: The product editor adopts without a rewrite (Priority: P1)

The product editor adopts section by section. Its existing `EditorField` renderers, including scope
handling, are kept inside `DeclaredFormSection`. The `product.editor.field.after` mounts stay where
they are, with the same props. The four PIM modules render their protection toggles unchanged
(FR-082, FR-120 to FR-127).

**Acceptance Scenarios**:

1. **Given** no override and no slot, **When** the adopted editor renders at any scope, **Then** its
   accessible structure (the roles, names and order of the fields, sections and zone mounts) equals
   the pre-adoption snapshot.
2. **Given** a deployment override relabelling `name`, **When** the editor renders at a channel
   scope, **Then** the label applies at every scope, and scope inheritance is unchanged.
3. **Given** a tightened `maxLength` on `name`, **When** any writer saves a scoped value over the
   limit, at any scope, **Then** it is refused. A tightened `required` binds the global value only,
   because an absent scoped value means the value is inherited (FR-124).

---

### Edge Cases

- **A slot anchored on a field that an override hides.** The slot renders in the hidden field's
  place. This is how the replacement pattern positions its field (R-4).
- **A section-anchored slot in a section an override emptied.** The section renders when it holds at
  least one visible field, so the slot keeps it visible.
- **An override that moves a field into a section another form of the field set lacks.** Refused at
  composition with `unknown-section`. Sections are declared per form.
- **A condition that names a field another module contributes.** Refused with
  `condition-foreign-field`. A condition may name core fields of the field set and the declaring
  module's own slot fields, which are the only values the server-side check can see (R-11).
- **A field whose declared writers do not all project it.** That field cannot accept `validation`,
  `requiredWhen` or `writePermission`. An `accepts` list that names one of them is refused on the
  owner's side with `accepts-unenforceable` (`contracts/form-field-declaration.md` §3), because the
  platform cannot enforce the rule on every write.
- **A switched-off slot module whose operator still has the form open.** Save answers
  `422 COMMAND_EXTENSION_UNCLAIMED` for that key. The form refreshes presence, drops the field with
  the notice the save session already shows for a switched-off participant, and keeps the operator's
  other changes staged.
- **A deployment that tightens `required` on a field that existing records lack.** The rule does not
  apply retroactively (D-300.4). A write that does not touch the field succeeds, and a write that
  clears it is refused.
- **Buyer self-service writes, such as storefront registration.** Not bound (D-300.3). An anonymous
  registration runs under a `system` actor, so its root Command declares `buyerSelfService: true`
  and its children inherit it (D-300.10).
- **A deployment adds `maxLength` to a field that existing records exceed.** An update that does not
  touch the field succeeds. An update that sets it must satisfy the rule (D-300.11).
- **An operator and a deployment override set the same label.** The operator's wins. Reset returns to
  the deployment's value (FR-094).
- **An operator override survives a deploy that removes `label` from a field's `accepts`.** The
  removal goes through a deprecation release (R-2). In the removal release, the row is ignored and
  shown as `no-longer-accepted`.
- **A field key renamed by its owner.** The old key remains a deprecated alias for one release, and
  overrides and anchors on it are warned (FR-071).
- **A product field with keys from a family (`attributeValues.<key>`).** An override or anchor may
  name one member of the family, for example `attributeValues.color`. The member is validated against
  the attribute definitions at render time and in the operator screen, not at composition, because
  attributes are data (FR-123).

## Requirements *(mandatory)*

### Field sets and forms

- **FR-001**: `@endora-commerce/contracts` MUST publish `defineFieldSet` and `defineAdminForm`
  (`contracts/form-field-declaration.md`). A **field set** belongs to one host entity of one owning
  module. It declares field keys, each with a value type, required-ness, core bounds and `accepts`.
  An **admin form** names a field set, its sections in order, and the keys each section shows in
  order.
- **FR-002**: Field-set ids and form ids MUST be declared in the owner's contracts file beside the
  host's Zod schemas, and listed in the owner's manifest (`fieldSets`, `adminForms`). A form id the
  admin renders that no manifest lists, or a listed form no host renders, MUST be refused by the
  form-extension check (`unrendered-form`, `undeclared-form`), on `check:admin-zones`' terms.
- **FR-003**: Every declared field's value type and core bounds MUST agree with the host's write
  contract (the create and update body schemas). A test helper, `expectFieldSetMatchesSchemas`,
  holds the agreement in the owner's tests.
- **FR-004**: A host form that adopts a declared form MUST render its own fields through the
  admin-kit layout primitive (`DeclaredFormSection`, `contracts/field-slots.md` §3). That primitive
  applies the effective overrides, slots and conditions, so an adopting host does not implement any
  of them itself.
- **FR-005**: Field keys, section keys, field value types and `accepts` MUST be contract surface
  under `specs/conventions/contract-surface.md`, with the rows `contracts/form-field-declaration.md`
  §5 adds.

### Field slots

- **FR-010**: `AdminContributions` MUST gain `fields`. A slot field names the field set and,
  optionally, the forms. It also carries a module-local key, a value type, an anchor (a field key or
  a section key), a position (`before`/`after` for a field, `start`/`end` for a section), an integer
  weight, an optional `requiredPermission` for rendering, an optional `writePermission`, and a
  component factory. The key on the wire is `<moduleId>.<localKey>`. The module id is the registry
  entry's key and is never a declared field (D-142).
- **FR-011**: The layout order MUST be deterministic: core keys in declared order after overrides,
  then the slots on each anchor and position by `(weight, moduleId, localKey)`. A slot may anchor on
  a core key, a section, or a slot field of its own module. It MUST NOT anchor on another module's
  slot.
- **FR-012**: The form-extension analysis (`packages/cli/src/lib/admin-forms.ts`) MUST run in this
  repository as `check:admin-forms`, judged for bare core and for each deployment on disk, and in an
  instance from `endora generate`. It MUST refuse `unknown-field-set`, `unknown-form`,
  `unknown-anchor`, `foreign-slot-anchor`, `position-anchor-mismatch`, `duplicate-slot-key` and
  `slot-owner-not-a-dependency`. It MUST also refuse `required-not-fillable` for a field that is
  effectively required on a create form while read-only there with no derivation (D-300.12). It MUST
  report `ambiguous-slot-order` as a warning.
- **FR-013**: A slot field's value MUST travel in the host Command's `extensions.<moduleId>`, as an
  object keyed by local key. The adopting host's admin create and update bodies MUST accept an
  optional `extensions` object (at most 8 module keys) and forward it to the Command, which makes this
  feature the follow-up OD-178-6 named. A key no present hook module claims MUST be answered by the
  existing `422 COMMAND_EXTENSION_UNCLAIMED`.
- **FR-014**: The contributing module MUST write the value with a `beforeCommit` hook on the host's
  hookable actions, into its own side table (187) or its own D2 columns (178), and report the field
  names with `noteAuditChanges`. The platform MUST publish `fieldSlotHook(…)` on `./kernel`. It
  validates the slice against the module's Zod schema, refusing with `422 FIELD_SLOT_INPUT_INVALID`
  and paths `extensions.<moduleId>.<key>`. It enforces `writePermission`, writes through the
  module's callback, and notes the changes.
- **FR-015**: The form MUST read slot values from the host's admin detail read (D-300.1). A
  side-table loader MAY declare `adminReads: true`. Each adopting host's admin detail route MUST
  serve `?extensions=<moduleId>[,…]` from D2 columns or `adminReads` loaders, omitting an absent or
  switched-off module's key. A served module with no value for a record MUST answer `null` under its
  key (D-300.25). An `adminReads` loader's value MUST be an object keyed by field, or `null`
  (D-300.24). A module MUST NOT serve both D2 columns and a loader under one key on one host. That
  means both opting into `adminReads`, and composition refuses it at loader registration
  (`loader-and-columns-on-one-host`, D-300.22, D-300.23).
- **FR-016**: A slot field MUST NOT be a save-session participant. Its value is part of the host's
  one request, folded into the host part (`specs/conventions/module-admin-surfaces.md` § *Zone-panel
  editors save once*, item 3).

### Deployment field overrides

- **FR-020**: `ModuleManifestSchema` MUST accept `formOverrides`, an array of pure-data overrides
  (`contracts/field-overrides.md` §1). Each override targets one `fieldSet.fieldKey`, optionally
  narrowed to named forms, and carries any of `label`, `help`, `placeholder`, `position`, `default`,
  `readOnly`, `hidden`, `control`, `validation`, `visibleWhen`, `requiredWhen` and `writePermission`,
  plus a required `reason`.
- **FR-021**: Composition MUST refuse each of these, before the first module registers:
  `override-not-accepted`, `hidden-required-field`, `override-loosens-rule`, `override-conflict`
  (two modules set one presentation attribute of one field), `override-contradiction`,
  `unknown-field`, `unknown-section`, `control-type-mismatch`, `format-without-validator`,
  `condition-foreign-field`, `default-on-hidden`, `required-not-fillable` (a field that is
  effectively required on a create form while being hidden there; the read-only case is
  `check:admin-forms`', FR-012, D-300.12),
  `foreign-override`, `override-owner-not-a-dependency` and `rule-excludes-system-value` (a
  tightening rejects a value the field declares in `systemValues`, D-300.31). Each refusal MUST
  name the module, the field set, the field and the remedy.
- **FR-022**: The tightened `validation` vocabulary MUST be: `required`, `minLength`, `maxLength`,
  `min`, `max`, `pattern`, `options` (a subset of the core enum) and `format`. Each value MUST be
  checked against the core bounds, and only a narrowing is admitted.
- **FR-023**: `_lifecycle` MUST serve `GET /api/v1/admin/effective-forms` (D-300.9). It returns
  the effective overrides of every declared form, filtered by presence and computed from the
  composition (§2 of `contracts/field-overrides.md`). It is gated by an authenticated admin with no
  permission code, on `/api/v1/admin/module-presence`'s terms. It answers an `ETag` and
  `Cache-Control: private, no-cache` (D-300.21). The admin MUST take every override from it and
  MUST NOT bundle a second copy.
- **FR-024**: The admin MUST refresh the effective forms whenever it refreshes module presence, and
  after any operator-layout write. The server MUST compute them per process from the composition, the
  effective presence and the operator layer. The memo MUST be invalidated by
  `b2b:form-layout:changed`, which is announced after every committed operator-layout Command, with a
  TTL bound if a subscription is lost (FR-097).
- **FR-025**: An override's `label`, `help` and `placeholder` MUST be keys relative to the declaring
  module's bundle, present in `en` and `pl`. `help` follows the 280-character budget and `hint`
  follows the 80-character budget of `specs/conventions/module-i18n.md`.

### Input controls

- **FR-030**: `@endora-commerce/contracts` MUST publish `PLATFORM_INPUT_CONTROLS`, the data half of
  the admin-kit controls. Each entry has an id `platform.<name>`, an output value type and an optional
  format. `@endora-commerce/admin-kit` MUST supply their components.
- **FR-031**: A module MAY declare `inputControls` in its manifest (data) and the matching
  `controls` in its admin layer (component). The form-extension check MUST refuse a declaration
  without a component, and a component without a declaration.
- **FR-032**: A control MAY replace a field's control only when its output value type fits the
  field's value type under the compatibility table (`contracts/input-controls.md` §2). Otherwise
  composition refuses with `control-type-mismatch`.
- **FR-033**: A control's format MUST be enforced on every write path that the field's writers
  cover. Platform formats (`email`, `tel`, `url`) are validated by the platform. A module format
  `<moduleId>.<name>` MUST have a validator registered with `ctx.fieldFormats(…)` by its declaring
  module, and is otherwise refused with `format-without-validator`.

### Field behaviour and server enforcement

- **FR-040**: `@endora-commerce/contracts` MUST publish the field-condition schema and one pure
  evaluator, `evaluateFieldCondition`. The admin form and the server-side check MUST both call it.
- **FR-041**: The platform MUST enforce `validation`, `requiredWhen`, control formats and
  `writePermission` in a **field-rule check**. It runs in the `beforeCommit` phase of every action a
  field set lists as a writer, before any module hook, over the projection of the writer's hook data
  that the field set declares (`contracts/field-rules.md` §2). It reads hook data, writes nothing,
  and is exempt from hook ordering.
- **FR-042**: A violation MUST refuse the Command with `422 FIELD_RULE_VIOLATION` and `details: [{
  path: '<fieldKey>', code, params }]`, worded per entry in the request's language, with an optional
  `message` key from the declaring module's bundle. A refused Command writes nothing and records no
  audit entry.
- **FR-043**: `writePermission` MUST be checked only for fields whose value the Command changed,
  comparing the projection's before-state with its after-state. It is checked against the admin's
  permissions (the kernel's `AdminPermissionChecker`) or an API key's scopes. Until a key's scopes
  reach the Command, a bound API key that changes such a field is refused (R-12). A violation
  refuses with `403 FIELD_WRITE_FORBIDDEN`. A system actor is not subject to it.
- **FR-044**: Masks and derivations MUST be admin-layer code (`AdminContributions.fieldBehaviours`)
  that constrains the UI only. A mask MUST declare in the override, as data, whether it has a
  server-side `pattern`. A derivation MUST pre-fill only while the operator has not edited the target
  in this form session, and the server MUST NOT recompute it. On an edit form it MUST write the target
  only while one of its `from` fields differs from its loaded value, and the target MUST return to its
  loaded value when none does, so opening a record never rewrites a stored value (D-300.20). A
  read-only field that a present derivation targets is submitted with its derived value
  (D-300.12).
- **FR-045**: The field-rule check MUST bind every operator, API-key and system write, and MUST skip
  buyer self-service writes (D-300.3): a customer acting for itself, or a write run as or below a
  Command that declares `buyerSelfService: true` under an actor with no acting admin (D-300.10). On
  create every rule MUST be checked. On an update a field MUST be checked only when the update
  changes or clears it, and `requiredWhen` also when the update changes a field its condition reads
  (D-300.4, D-300.11).

### Trust tiers, presence and permissions

- **FR-050**: Slot fields MUST be open to every origin, on the terms zone contributions are open on
  today: the slot module depends on the field set's owner.
- **FR-051**: `formOverrides` MUST be honoured from origin `deployment`, and from origin `package`
  only under a `formOverrideGrants` entry in the deployment's `divergence.ts` (per field set, per
  package, with a reason), following 189 `contracts/module-origin.md` §5. Origin `core` MUST NOT
  override another module's field set (D-300.2).
- **FR-052**: Every slot, override, control and behaviour of a module that is not effectively present
  MUST be absent everywhere, as if the module were never installed (XVII). The form renders the core
  field, the server enforces the core rules, and the effective-forms response omits the module.
- **FR-053**: Switching a module off MUST keep its side-table data (187 FR-061). It MUST NOT change
  the host's own writes, responses or audit rows.
- **FR-060**: A field set MAY declare `writePermission` on a core field. A deployment override MAY
  add one where the field accepts `writePermission`. Neither MAY remove one.
- **FR-061**: The form MUST render a field read-only when the operator lacks its `writePermission`,
  as a mirror of FR-043.
- **FR-062**: `hidden`, `readOnly` and `visibleWhen` MUST be presentation. No API endpoint may read
  them to accept, refuse, filter or answer anything. Per-field read access control is out of scope.

### Divergence, introspection and documentation

- **FR-070**: `DivergenceKind` MUST gain `form-override` and `form-override-grant`. Slot fields are
  the module's own surface (`notRecorded`), and the hooks behind them are already `command-hook`
  divergences.
- **FR-071**: A field key the owner renames MUST stay accepted as a deprecated alias for one release.
  Overrides and anchors that name an alias MUST be warned during that release and refused after it.
- **FR-072**: The admin shell MUST add a read-only `/platform/form-extensions` screen, gated by
  `platform.modules.read`, with a palette action declared by `_lifecycle` (XVI). The screen reuses
  the policy-points screen's primitives (IX).
- **FR-073**: The Docusaurus site MUST gain `architecture/admin-form-extensions.md` and its Polish
  translation, covering the guide, the replacement pattern and the trust table.
  `customisation-ladder.md` MUST replace its *Reserved, and deliberately unnumbered* section with
  this mechanism's rung, in both languages.

### Core form adoption

- **FR-080**: One release MUST adopt all five hosts (D-300.5): `organization.create` and
  `organization.edit` (`organizations`), `project.create` and `project.edit` (`projects`),
  `customer.edit` (rendered by `customers` over the `customer_account` field set of
  `customer_accounts`), `opportunity.create` and `opportunity.edit` (`crm`), and `product.edit`
  (`catalog`).
- **FR-081**: A host MUST NOT adopt a form until each writer that FR-041 relies on is a declared
  hookable action with `beforeCommit`, or a rule-check-only writer (FR-113).
- **FR-082**: The product field set MUST keep the existing `fieldPath` strings as its keys, so
  `product.editor.field.after` and its four external contributors are unchanged (R-16).
- **FR-083**: An admin form MAY be declared by the module whose screen renders it, which differs from
  the field set's owner when the screen and the entity have different owners (`customers` /
  `customer_accounts`). The declaring module MUST depend on the field set's owner.

### Operator form layout (D-300.6, R-21)

- **FR-090**: `custom_fields` MUST own the operator layer. That means the table
  `custom_field_form_layout_overrides` (one row per form and field key, platform-global), its
  Commands, its routes and its screen. A migration scaffolded with `migration:new` creates the table.
- **FR-091**: An operator override MUST carry only the kinds `label`, `help`, `placeholder`,
  `position` (section, before or after), `hidden` and `readOnly`. Each kind MUST be in the field's
  `accepts`. `hidden` MUST NOT be set on a core-required field, and neither `hidden` nor `readOnly`
  may be set on a field that is effectively required on a create form. The operator layer cannot
  see a derivation, so this refusal has no exemption (D-300.12). Slot fields accept `label`, `help`,
  `position` and `hidden`. The effective forms serve a present module's slot rows to the kit, which
  applies them (D-300.17).
- **FR-092**: `label`, `help` and `placeholder` MUST be per-language maps over the supported admin
  languages (`en`, `pl`), all present. Each is at most 200 characters, and `help` follows the
  280-character budget. For a language added to the platform later, the field falls back to the code
  value, or to core. It never falls back to another language.
- **FR-093**: Writes MUST be Commands: `custom_fields.form_layout.set` (one form, a batch of fields)
  and `custom_fields.form_layout.reset` (one form, some or all fields). Both MUST be reversible
  (pre-state captured per row, undo with a conflict report) and audited with before and after.
- **FR-094**: Precedence, per field and kind, MUST be core < deployment code (and granted packages)
  < operator, for `label`, `help`, `placeholder` and `position`. `hidden` and `readOnly` MUST only
  add: an operator cannot unhide or make writable what code hid or made read-only. Reset MUST remove
  the operator layer only.
- **FR-095**: The permission `custom_fields:forms` ("Manage form layout") MUST gate the write routes.
  `custom_fields:read` gates the read routes. Both are registered following
  `specs/conventions/module-admin-surfaces.md`, with labels in `en` and `pl`.
- **FR-096**: The screen MUST live at `/custom-fields/forms` and `/custom-fields/forms/:formId`, with
  the palette action "Form layout". It MUST show, per field, the core value, the code value (with its
  module) and the operator value, the kinds the field accepts, and locks with reasons. It MUST reuse
  the kit's reorder, `FormField`, `EditorSection` and save-session primitives (IX).
- **FR-097**: After commit, the Command MUST announce `b2b:form-layout:changed`. Every process drops
  its effective-forms memo, and the in-process operator-layer cache has a 60-second TTL as the bound
  when a subscription is lost.
- **FR-098**: An operator override on a field set whose owner is not effectively present MUST be
  ignored by the effective forms and kept. `custom_fields` is non-deactivatable, so the layer itself
  is never switched off.
- **FR-099**: During a key's deprecation release, `custom_fields` MUST rewrite rows that name the
  alias to the live key, once, at boot, through the system Command
  `custom_fields.form_layout.rekey`. After the alias is removed, a row on an unknown key MUST be
  ignored and listed as `orphaned`, and a row whose kind is no longer accepted MUST be ignored and
  listed as `no-longer-accepted`. Both can be deleted from the screen.
- **FR-100**: Operator overrides MUST NOT change what any API endpoint accepts, refuses or answers.

### Hookable writers for the remaining hosts (D-300.5, R-22)

- **FR-110**: `customer_accounts` MUST publish `CUSTOMER_ACCOUNT_HOOKABLE_ACTIONS` (`create`,
  `updateProfile`, `customFieldsUpdate`) in `packages/contracts/src/customer-account-hooks.ts`, with
  both phases, hook data that carries the after-state record and `changedFields`, and names-only
  outbox data.
- **FR-111**: `crm` MUST publish `OPPORTUNITY_HOOKABLE_ACTIONS` (`create`, `update`) in
  `opportunity-hooks.ts`.
- **FR-112**: `catalog` MUST publish `PRODUCT_HOOKABLE_ACTIONS` (`create`, `update`,
  `scopedValuesSave`, `scopedValuesImport`) in `product-hooks.ts`. The scoped-value hook data carries
  `{ productId, scope, after, changedFields }` per saved scope.
- **FR-113**: A write that a stored-revert undo reverses MUST NOT run under a hookable action
  (176 §6). This includes a per-record Command that a reversible parent operation composes, not
  only a Command that is itself reversible. Such a write MUST run under an action of its own that is
  never declared hookable. It MAY be registered as a rule-check-only writer,
  `ctx.fieldSets(... { ruleCheckOnly: true })`, which admits the field-rule check alone, and then
  it MUST supply `hookData`. Undo actions are not writers. In `catalog`, each product write of a
  bulk edit runs as `product.bulk_update.item`, a rule-check-only writer, on the inline and the
  queued path alike, and never as `product.update`. The summary entry `product.bulk_update` is an
  audit row, not a Command, and is not a writer (D-300.8). Any other Command that is not a declared
  hookable action MAY likewise be a rule-check-only writer, reversible or not. In `organizations`,
  `organization.update` (the integration port's write), `organization.merge.finalize` and
  `organization.personal.provision` are, so that a rule binds the port, the merge and the
  provisioning as it binds the form and the API (SC-002, D-300.27, D-300.28, D-300.31).
- **FR-114**: Each new action MUST have `expectHookableCommand` tests, be listed in its owner's
  manifest `hookableActions`, and be announced in a changeset (additive).

### Product editor adoption (D-300.5, R-23)

- **FR-120**: `PRODUCT_FIELD_SET` MUST declare the editor's fields with the keys FR-082 fixes, plus
  `type`, `attributeSetId`, `urlKey`, `status`, `audience` and `window`, and the key family
  `attributeValues.*`.
- **FR-121**: The editor MUST adopt section by section, each in its own merge request. Each section's
  `DeclaredFormSection` renderer MUST wrap the existing `EditorField` (scope, inheritance, view and
  `globalOnly` unchanged) rather than replace it.
- **FR-122**: Every existing `product.editor.field.after` mount MUST stay, at its current place,
  with its current props (`productId`, `fieldPath`, `scope`, `languageCodes`, `saveSession`). The
  per-file mount counts that the module-owned-surface test holds MUST stay unchanged.
- **FR-123**: A family member (`attributeValues.<code>`) MAY be the target of an override or an
  anchor. Composition validates only the family. The operator screen and the editor check the member
  against the live attribute definitions, and ignore a member that no longer exists, with a notice.
- **FR-124**: For scoped writers, bounds, `pattern`, `format` and `options` MUST apply to the value at
  every scope it is saved at. A tightened `required` MUST bind the global value only.
- **FR-125**: An accessible-structure snapshot of the editor, taken before adoption at global,
  channel and locale scope, MUST equal the adopted editor with no override, after every section's
  merge request.
- **FR-126**: Each catalog merge request MUST typecheck and build the four paid PIM modules' admin
  layers against the built packages (read-only, `../paid-modules`). A failure blocks the merge.
- **FR-127**: The product slot-field write path MUST be `product.update` and `product.create`. Slot
  fields are global-scope only in this feature.

### Key Entities

- **Field set**: the declared, typed fields of one host entity: keys, value types, bounds,
  required-ness, `accepts`, `writePermission`, and the writers that project it. It is owned by the
  host's module.
- **Admin form**: a layout over one field set, with ordered sections and ordered keys. A field set
  may have several forms, such as create and edit.
- **Slot field**: a field a module contributes to a field set's forms. It has a value type and an
  anchor, it is rendered by the module's component, and it is written by the module's hook.
- **Field override**: data that changes how one core field is offered or tightens how it is
  validated. It is declared by a deployment module, or by a granted package.
- **Input control**: a component with a declared output value type and an optional format.
- **Operator layout override**: a row owned by `custom_fields`, one per form and field. It holds
  presentation kinds only, with per-language text, and is written by reversible audited Commands.
- **Field condition**: a small boolean expression over the field values of one form, evaluated by
  one shared function on the client and on the server.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A deployment adds a coded field to the organization form, persisted atomically and
  audited, with **zero** edits under `packages/modules/organizations/`.
- **SC-002**: For every tightened rule in the fixture overlay, the same input is refused with the
  same `details[].code` through the form, the admin API, an import row and a port call (4 of 4 paths).
- **SC-003**: Every refusal in FR-012 and FR-021 has a red test that names its code, and **0** of
  them can reach a running process: they fail at build or at composition.
- **SC-004**: With the fixture overlay switched off, the organization's create and update responses
  and audit rows are byte-identical to bare core, and the form shows no field of it.
- **SC-005**: The same deployment produces the same layout order on every render and in every
  process. A shuffled-registration test gives an identical order.
- **SC-006**: Adopting the organization forms leaves the existing admin behaviour unchanged: the
  organization admin tests pass without edits other than the render-path swap. The four PIM modules'
  `product.editor.field.after` contributions compile and render unchanged.
- **SC-007**: The effective-forms response adds at most one request per admin session refresh. It is
  fetched once, beside module presence, and never per form.
- **SC-008**: An operator layout change is visible in every running process within 60 seconds, and
  within one request when pub/sub is healthy. It is undoable, and an API write to the same fields is
  unchanged by it.
- **SC-009**: All five hosts ship in one release with the 4-path parity test (SC-002) passing for
  each, and the four PIM modules build unchanged against it.

## Open questions

None. OQ-193-1 to OQ-193-6 were answered by the owner on 2026-11-27 and are recorded above as D-300.
`research.md` R-21 to R-23 rule on everything the answers left to the architect.

## Assumptions

- `0.113.0`'s MikroORM 7 move, 187's loaders (merged in #1967 and #1991) and 189's `ModuleOrigin`
  are on `master` before implementation starts.
- The storefront is out of scope. Buyer forms keep `customerInput` custom fields (175).
- Operator-defined fields remain runtime custom fields (XIV, D0). Placing custom-field definitions
  at anchors is a possible follow-up and is not part of this feature.
- A deployment that needs a value-type change that several deployments share asks for a core change
  under the breaking-change rules. The replacement pattern is for one deployment's need
  (`contracts/field-replacement-pattern.md` §5).
