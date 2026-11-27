# Feature Specification: Admin form extensions — field slots, deployment field overrides, control replacement

**Feature Branch**: `spec/193-admin-form-extensions`
**Created**: 2026-11-27
**Status**: Draft. The architect rulings are in `research.md` (R-1 to R-20). Six questions are
open for the owner (*Open questions* below, OQ-193-1 to OQ-193-6). No D-number has been assigned
yet. The owner's answers are recorded as one when they are given.
**Input**: Issue #2006, "Admin form extensions: field slots, deployment field overrides, control
replacement". The owner approved its direction, and the issue compares the approach with Magento 2,
Sylius and Medusa v2.

**Related**:
- `specs/176-command-hooks-outbox/`: `Command.extensions`, `beforeCommit` hooks, `noteAuditChanges`.
- `specs/178-extensible-columns/`: the D2 `?extensions=` admin read wire. Its OD-178-6 deferred the
  HTTP `extensions` body field until "a host form can carry zone-contributed fields". This feature
  is that form.
- `specs/187-side-table-extensions/`: side tables and read-port loaders. Its OR-10 deferred admin
  HTTP reads; see OQ-193-1.
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
field only under a deployment grant (OQ-193-2). A deployment may override any core field within
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
- **A deployment that tightens `required` on a field that existing records lack.** OQ-193-4.
- **Buyer self-service writes, such as storefront registration.** OQ-193-3.
- **A field key renamed by its owner.** The old key remains a deprecated alias for one release, and
  overrides and anchors on it are warned (FR-071).
- **An override on a product field.** No product field set exists until the product editor adopts
  (OQ-193-5). Until then, `product.editor.field.after` is unchanged.

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
  `slot-owner-not-a-dependency`. It MUST report `ambiguous-slot-order` as a warning.
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
- **FR-015**: The form MUST read slot values from the host's admin detail read. [NEEDS
  CLARIFICATION: OQ-193-1, which asks whether to reopen 187 OR-10 so that side-table loaders may opt
  into `?extensions=` admin reads, or to have each slot read its own module's route.]
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
  effectively required on a create form while being hidden or read-only there with no derivation),
  `foreign-override` and `override-owner-not-a-dependency`. Each refusal MUST name the module, the
  field set, the field and the remedy.
- **FR-022**: The tightened `validation` vocabulary MUST be: `required`, `minLength`, `maxLength`,
  `min`, `max`, `pattern`, `options` (a subset of the core enum) and `format`. Each value MUST be
  checked against the core bounds, and only a narrowing is admitted.
- **FR-023**: `_lifecycle` MUST serve `GET /api/v1/admin/forms`. It returns the effective overrides
  of every declared form, filtered by presence and computed from the composition (§2 of
  `contracts/field-overrides.md`). It is gated by an authenticated admin with no permission code, on
  `/api/v1/admin/module-presence`'s terms. The admin MUST take every override from it and MUST NOT
  bundle a second copy.
- **FR-024**: The admin MUST refresh the effective forms whenever it refreshes module presence. The
  server MUST compute them per process from the composition and the effective presence, so they need
  no cache key of their own.
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
  permissions (the kernel's `AdminPermissionChecker`) or an API key's scopes. A violation refuses with
  `403 FIELD_WRITE_FORBIDDEN`. A system actor is not subject to it.
- **FR-044**: Masks and derivations MUST be admin-layer code (`AdminContributions.fieldBehaviours`)
  that constrains the UI only. A mask MUST declare in the override, as data, whether it has a
  server-side `pattern`. A derivation MUST pre-fill only while the target is untouched, and the server
  MUST NOT recompute it.
- **FR-045**: Which writers a field-rule check binds MUST follow OQ-193-3. Whether a tightened
  `required` binds existing records MUST follow OQ-193-4. [NEEDS CLARIFICATION: OQ-193-3 and
  OQ-193-4.]

### Trust tiers, presence and permissions

- **FR-050**: Slot fields MUST be open to every origin, on the terms zone contributions are open on
  today: the slot module depends on the field set's owner.
- **FR-051**: `formOverrides` MUST be honoured from origin `deployment`, and from origin `package`
  only under a `formOverrideGrants` entry in the deployment's `divergence.ts` (per field set, per
  package, with a reason), following 189 `contracts/module-origin.md` §5. Origin `core` MUST NOT
  override another module's field set. [NEEDS CLARIFICATION: OQ-193-2, which asks whether installed
  packages may be granted overrides at all.]
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

- **FR-080**: The first release MUST adopt the forms that OQ-193-5 selects. The recommended first set
  is `organizations`' create and edit forms (research R-16).
- **FR-081**: A host MUST NOT adopt a form until each writer that FR-041 relies on is a declared
  hookable action with `beforeCommit`. Hosts without hookable actions (`customers`,
  `customer_accounts`, `crm`, `catalog`) declare them first, in the same release train.
- **FR-082**: The product field set MUST keep the existing `fieldPath` strings as its keys, so
  `product.editor.field.after` and its four external contributors are unchanged (R-16).

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

## Open questions *(for the owner)*

Each question has options and a recommendation. Everything else was ruled by the architect in
`research.md`.

- **OQ-193-1: How does a form read slot values?**
  A. Reopen 187 OR-10 narrowly. A side-table loader may opt in with `adminReads: true`, and each
  adopting host's admin detail read serves its values on `?extensions=<moduleId>`, the wire 178
  already has for `organizations`. This is the one-developer-day cost R-17 of 187 measured, per host.
  B. Each slot reads its value from its own module's admin route.
  C. Slots write only, with no value shown after save.
  **Recommendation: A.** The value arrives with the record and its version, in one request. B costs
  one request per contributing module per form open, and a second concurrency story. C does not meet
  the need.
- **OQ-193-2: May an installed package override another module's field?**
  A. Only under a deployment grant per (field set, package), on 188's terms.
  B. Never. Only the deployment may.
  C. Freely, as for slots.
  **Recommendation: A.** It is consistent with D-296 and 188. A package that needs it, for example a
  PIM module making synced fields read-only, has a sanctioned path, and the deployment still decides.
- **OQ-193-3: Which writes does a tightened rule bind?**
  A. Every operator, API-key and system write of the entity, but not buyer self-service actions
  (registration), whose storefront forms this feature does not extend.
  B. Operator and API-key writes only. System integrations are exempt.
  C. Every write, buyer self-service included.
  **Recommendation: A.** "Imports, ports and the API cannot bypass it" is the issue's requirement. A
  buyer cannot satisfy a rule whose field their form cannot show, so C would break registration
  until a storefront feature exists.
- **OQ-193-4: Does a tightened `required` bind records that predate it?**
  A. It does not apply retroactively. It is checked on create, and on any write that changes or
  clears the field. An unrelated write to a legacy record still succeeds.
  B. Every write re-checks, on the custom-field SD-2 rule.
  **Recommendation: A.** Under B, adding a rule blocks moderation, status and integration writes on
  every legacy record until someone backfills them. A backfill is the deployment's own data task.
- **OQ-193-5: Which forms come first, and in which release?**
  A. Organization create and edit in the first release. Project, customer and opportunity follow in
  the next release, after `customers`, `customer_accounts` and `crm` declare their hookable actions.
  The product editor comes after that (R-16).
  B. As A, with the product editor in the first release.
  C. All five in one release.
  **Recommendation: A.** `organizations` already has hookable actions, the D2 read wire, custom
  fields and one Save, so it proves the mechanism with the smallest core change. The product editor
  is 100 KB of scope-aware JSX with four external contributors, and adopting it first would put the
  riskiest adoption on the critical path.
- **OQ-193-6: Should business operators edit overrides at run time?**
  A. Not in this feature. Overrides are deployment code, and the override shape stays pure data, so
  a Settings-backed source can be added later without changing it.
  B. Add now a Settings screen where an operator relabels, hides or reorders fields.
  **Recommendation: A.** Tightened rules change what the API accepts, and that belongs to the
  deployment's reviewed code (XV). A runtime editor for presentation alone is a separate product
  decision, and the shape does not block it.

## Assumptions

- `0.113.0`'s MikroORM 7 move, 187's loaders (merged in #1967 and #1991) and 189's `ModuleOrigin`
  are on `master` before implementation starts.
- The storefront is out of scope. Buyer forms keep `customerInput` custom fields (175).
- Operator-defined fields remain runtime custom fields (XIV, D0). Placing custom-field definitions
  at anchors is a possible follow-up and is not part of this feature.
- A deployment that needs a value-type change that several deployments share asks for a core change
  under the breaking-change rules. The replacement pattern is for one deployment's need
  (`contracts/field-replacement-pattern.md` §5).
